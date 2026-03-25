import { randomUUID } from "node:crypto"
import { readFile, writeFile, readdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { resolvePaths, ensureDir } from "../config/paths.js"
import type { AgentSession } from "../types.js"

/**
 * Create a new session.
 */
export function createSession(gameId: string, gamePath: string): AgentSession {
    const now = new Date().toISOString()
    return {
        sessionId: randomUUID(),
        gameId,
        gamePath,
        createdAt: now,
        lastActiveAt: now,
        messages: [],
        tokenUsage: { inputTokens: 0, outputTokens: 0 },
    }
}

/**
 * Save a session to disk.
 */
export async function saveSession(session: AgentSession): Promise<void> {
    const paths = resolvePaths()
    await ensureDir(paths.sessionsDir)
    const filePath = join(paths.sessionsDir, `${session.sessionId}.json`)
    await writeFile(filePath, JSON.stringify(session, null, 2), "utf-8")
}

/**
 * Load a session by ID.
 */
export async function loadSessionById(sessionId: string): Promise<AgentSession | null> {
    const paths = resolvePaths()
    const filePath = join(paths.sessionsDir, `${sessionId}.json`)
    try {
        const data = await readFile(filePath, "utf-8")
        return JSON.parse(data) as AgentSession
    } catch {
        return null
    }
}

/**
 * Find the most recent non-expired session for a game.
 * Used by --resume flag.
 */
export async function findLatestSession(gameId: string): Promise<AgentSession | null> {
    const paths = resolvePaths()
    let files: string[]
    try {
        files = await readdir(paths.sessionsDir)
    } catch {
        return null
    }

    const jsonFiles = files.filter((f) => f.endsWith(".json"))
    let latest: AgentSession | null = null
    let latestTime = -1

    for (const file of jsonFiles) {
        try {
            const data = await readFile(join(paths.sessionsDir, file), "utf-8")
            const session = JSON.parse(data) as AgentSession
            if (session.gameId !== gameId) continue
            if (isSessionExpired(session)) continue
            const activeTime = new Date(session.lastActiveAt).getTime()
            if (activeTime > latestTime) {
                latestTime = activeTime
                latest = session
            }
        } catch {
            // Skip malformed files
        }
    }

    return latest
}

/**
 * Check if a session is expired (24 hours since lastActiveAt).
 */
export function isSessionExpired(session: AgentSession): boolean {
    const expiry = 24 * 60 * 60 * 1000 // 24 hours in ms
    const lastActive = new Date(session.lastActiveAt).getTime()
    return Date.now() - lastActive > expiry
}

/**
 * Update session's lastActiveAt and append messages.
 */
export function updateSession(
    session: AgentSession,
    newMessages: AgentSession["messages"],
    tokenUsage: { inputTokens: number; outputTokens: number },
): AgentSession {
    return {
        ...session,
        lastActiveAt: new Date().toISOString(),
        messages: [...session.messages, ...newMessages],
        tokenUsage: {
            inputTokens: session.tokenUsage.inputTokens + tokenUsage.inputTokens,
            outputTokens: session.tokenUsage.outputTokens + tokenUsage.outputTokens,
        },
    }
}

/**
 * Delete a session file.
 */
export async function deleteSession(sessionId: string): Promise<void> {
    const paths = resolvePaths()
    const filePath = join(paths.sessionsDir, `${sessionId}.json`)
    try {
        await rm(filePath)
    } catch {
        // Ignore if not found
    }
}
