import { join, relative, normalize } from "node:path"
import { appendFile, mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import { resolvePaths } from "../config/paths.js"
import type { FileRestrictionResult, FileRestrictionViolation } from "../types.js"

const DENIED_PATTERNS = [
    "Dockerfile",
    ".github/**",
    ".npmrc",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "node_modules/**",
    ".git/**",
    "crucible.json",
]

const ALLOWED_PATTERNS = [
    "apps/server/src/**",
    "apps/display/src/**",
    "apps/controller/src/**",
    "packages/shared/src/**",
    "apps/*/package.json",
    "packages/*/package.json",
]

/**
 * Match a file path against a glob pattern.
 * Supports `*` (single segment wildcard) and `**` (multi-segment wildcard).
 */
export function globMatch(pattern: string, filePath: string): boolean {
    // Exact match shortcut
    if (pattern === filePath) return true

    const patternParts = pattern.split("/")
    const pathParts = filePath.split("/")

    return matchParts(patternParts, 0, pathParts, 0)
}

function matchParts(
    pattern: string[],
    pi: number,
    path: string[],
    fi: number,
): boolean {
    // Both exhausted — match
    if (pi === pattern.length && fi === path.length) return true
    // Pattern exhausted but path remains — no match
    if (pi === pattern.length) return false

    const seg = pattern[pi]

    if (seg === "**") {
        // ** can match zero or more path segments
        // Try matching the rest of the pattern at every remaining position
        for (let i = fi; i <= path.length; i++) {
            if (matchParts(pattern, pi + 1, path, i)) return true
        }
        return false
    }

    // Path exhausted but pattern remains (and it's not **)
    if (fi === path.length) return false

    if (seg === "*") {
        // * matches exactly one segment (any value)
        return matchParts(pattern, pi + 1, path, fi + 1)
    }

    // Literal match
    if (seg === path[fi]) {
        return matchParts(pattern, pi + 1, path, fi + 1)
    }

    return false
}

/**
 * Normalise a file path: forward slashes, relative to gamePath.
 */
function normalisePath(filePath: string, gamePath: string): string {
    // Normalise separators to forward slashes
    let normalised = normalize(filePath).replace(/\\/g, "/")
    const gameRoot = normalize(gamePath).replace(/\\/g, "/")

    // If absolute, make relative
    if (normalised.startsWith("/") || /^[a-zA-Z]:/.test(normalised)) {
        normalised = relative(gamePath, filePath).replace(/\\/g, "/")
    }

    // Strip leading ./ if present
    if (normalised.startsWith("./")) {
        normalised = normalised.slice(2)
    }

    // Strip leading gameRoot prefix if still present
    const prefix = gameRoot.endsWith("/") ? gameRoot : gameRoot + "/"
    if (normalised.startsWith(prefix)) {
        normalised = normalised.slice(prefix.length)
    }

    return normalised
}

/**
 * Check whether a file path is allowed to be modified by the AI agent.
 * Deny-first: denied patterns are checked before allowed patterns.
 * Anything not explicitly allowed is denied by default.
 */
export function checkFileRestriction(
    filePath: string,
    gamePath: string,
): FileRestrictionResult {
    const normalised = normalisePath(filePath, gamePath)

    // 1. Check denied patterns first
    for (const pattern of DENIED_PATTERNS) {
        if (globMatch(pattern, normalised)) {
            return {
                allowed: false,
                reason: `Path matches denied pattern: ${pattern}`,
                deniedPattern: pattern,
            }
        }
    }

    // 2. Check allowed patterns
    for (const pattern of ALLOWED_PATTERNS) {
        if (globMatch(pattern, normalised)) {
            return { allowed: true }
        }
    }

    // 3. Default deny
    return {
        allowed: false,
        reason: "Path is not in any allowed pattern",
    }
}

/**
 * Append a violation record as a JSON line to the audit log.
 * Creates the file and parent directories if they don't exist.
 */
export async function logViolation(
    violation: FileRestrictionViolation,
    auditLogPath?: string,
): Promise<void> {
    const logPath = auditLogPath ?? join(resolvePaths().dataDir, "agent-audit.log")
    await mkdir(dirname(logPath), { recursive: true })
    const line = JSON.stringify(violation) + "\n"
    await appendFile(logPath, line, "utf-8")
}
