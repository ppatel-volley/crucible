import { readFile, writeFile, mkdir } from "node:fs/promises"
import { join, dirname } from "node:path"
import { resolvePaths } from "../config/paths.js"
import type { TokenSet } from "../types.js"

function getTokenPath(): string {
    const paths = resolvePaths()
    return join(paths.configDir, "tokens.json")
}

export async function saveTokens(tokens: TokenSet): Promise<void> {
    const path = getTokenPath()
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify(tokens, null, 2), "utf-8")
}

export async function loadTokens(): Promise<TokenSet | null> {
    try {
        const content = await readFile(getTokenPath(), "utf-8")
        return JSON.parse(content) as TokenSet
    } catch {
        return null
    }
}

export function isTokenExpired(tokens: TokenSet): boolean {
    // Consider expired if within 5 minutes of expiry
    return Date.now() > tokens.expiresAt - 5 * 60 * 1000
}

export async function clearTokens(): Promise<void> {
    const { rm } = await import("node:fs/promises")
    try {
        await rm(getTokenPath())
    } catch {
        /* ignore if file doesn't exist */
    }
}
