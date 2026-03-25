import { readFile, readdir, stat } from "node:fs/promises"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import type {
    AssembledContext,
    ContextAssemblerOptions,
    ContextFile,
    ContextPriority,
} from "../types.js"

const DEFAULT_TOKEN_BUDGET = 180_000

/** Rough token estimate: ~4 chars per token. */
function estimateTokens(content: string): number {
    return Math.ceil(content.length / 4)
}

/** Recursively walk a directory and return all file paths. */
async function walkDir(dir: string): Promise<string[]> {
    let entries
    try {
        entries = await readdir(dir, { withFileTypes: true })
    } catch {
        return []
    }
    const files: string[] = []
    for (const entry of entries) {
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
            files.push(...(await walkDir(fullPath)))
        } else {
            files.push(fullPath)
        }
    }
    return files
}

/** Check whether a file exists and is a regular file. */
async function fileExists(path: string): Promise<boolean> {
    try {
        const s = await stat(path)
        return s.isFile()
    } catch {
        return false
    }
}

interface PrioritySpec {
    priority: ContextPriority
    patterns: string[]
    /** If true, match against the relative path; otherwise match the exact filename. */
    glob: boolean
}

const REQUIRED_FILES = ["AGENTS.md", "AGENTS-PROJECT.md", "AGENTS-REACT-TS.md", "crucible.json"]

const HIGH_DIRS = ["packages/shared/src"]
const HIGH_EXTENSIONS = new Set([".ts", ".tsx"])

const MEDIUM_DIRS = ["apps/display/src", "apps/controller/src"]
const MEDIUM_EXTENSIONS = new Set([".ts", ".tsx"])

const LOW_FILES = ["package.json", "tsconfig.json", "tsconfig.base.json", "vite.config.ts", "vite.config.js"]

/**
 * Collect files at a given priority from the game directory.
 * Returns absolute paths.
 */
async function collectRequired(gamePath: string): Promise<string[]> {
    const results: string[] = []
    for (const file of REQUIRED_FILES) {
        const fullPath = join(gamePath, file)
        if (await fileExists(fullPath)) {
            results.push(fullPath)
        }
    }
    return results
}

async function collectFromDirs(
    gamePath: string,
    dirs: string[],
    extensions: Set<string>,
): Promise<string[]> {
    const results: string[] = []
    for (const dir of dirs) {
        const fullDir = join(gamePath, dir)
        const files = await walkDir(fullDir)
        for (const file of files) {
            const ext = file.substring(file.lastIndexOf("."))
            if (extensions.has(ext)) {
                results.push(file)
            }
        }
    }
    return results
}

async function collectLow(gamePath: string): Promise<string[]> {
    const results: string[] = []
    for (const file of LOW_FILES) {
        const fullPath = join(gamePath, file)
        if (await fileExists(fullPath)) {
            results.push(fullPath)
        }
    }
    // Also pick up tsconfig*.json variants
    try {
        const entries = await readdir(gamePath)
        for (const entry of entries) {
            if (entry.startsWith("tsconfig") && entry.endsWith(".json") && !LOW_FILES.includes(entry)) {
                results.push(join(gamePath, entry))
            }
            if (entry.startsWith("vite.config.") && !LOW_FILES.includes(entry)) {
                results.push(join(gamePath, entry))
            }
        }
    } catch {
        // directory doesn't exist — fine
    }
    return results
}

function getVgfDocsPath(): string {
    // Resolve relative to this source file's location: ../../../context/BUILDING_TV_GAMES.md
    // At runtime this file is at packages/crucible/dist/agent/context.js
    // The bundled doc is at packages/crucible/context/BUILDING_TV_GAMES.md
    const thisDir = typeof __dirname !== "undefined"
        ? __dirname
        : fileURLToPath(new URL(".", import.meta.url))
    return join(thisDir, "..", "..", "context", "BUILDING_TV_GAMES.md")
}

/**
 * Assemble context files from a game project directory, prioritised by importance
 * and constrained to a token budget.
 */
export async function assembleContext(
    options: ContextAssemblerOptions,
): Promise<AssembledContext> {
    const { gamePath, tokenBudget = DEFAULT_TOKEN_BUDGET, loadVGFDocs = false } = options

    const files: ContextFile[] = []
    let totalTokens = 0
    let truncated = false
    const missedFiles: string[] = []

    // Build ordered list of (priority, absolutePaths)
    const levels: Array<{ priority: ContextPriority; paths: string[] }> = [
        { priority: "required", paths: await collectRequired(gamePath) },
        { priority: "high", paths: await collectFromDirs(gamePath, HIGH_DIRS, HIGH_EXTENSIONS) },
        { priority: "medium", paths: await collectFromDirs(gamePath, MEDIUM_DIRS, MEDIUM_EXTENSIONS) },
        { priority: "low", paths: await collectLow(gamePath) },
    ]

    if (loadVGFDocs) {
        const vgfPath = getVgfDocsPath()
        levels.push({ priority: "reference", paths: [vgfPath] })
    }

    for (const level of levels) {
        for (const absPath of level.paths) {
            let content: string
            try {
                content = await readFile(absPath, "utf-8")
            } catch {
                // File unreadable — skip silently
                missedFiles.push(relative(gamePath, absPath))
                continue
            }

            const tokens = estimateTokens(content)

            if (totalTokens + tokens > tokenBudget) {
                truncated = true
                missedFiles.push(relative(gamePath, absPath))
                continue
            }

            files.push({
                path: relative(gamePath, absPath),
                content,
                tokens,
                priority: level.priority,
            })
            totalTokens += tokens
        }
    }

    return { files, totalTokens, truncated, missedFiles }
}
