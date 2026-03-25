import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { mkdtemp, rm, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AgentSession } from "../../types.js"

// --- Mocks ---

let tempDir: string

const mockResolvePaths = vi.fn()
const mockEnsureDir = vi.fn().mockResolvedValue(undefined)

vi.mock("../../config/paths.js", () => ({
    resolvePaths: (...args: unknown[]) => mockResolvePaths(...args),
    ensureDir: (...args: unknown[]) => mockEnsureDir(...args),
    _resetEnsuredDirs: vi.fn(),
}))

const {
    createSession,
    saveSession,
    loadSessionById,
    findLatestSession,
    isSessionExpired,
    updateSession,
    deleteSession,
} = await import("../../agent/session.js")

beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "crucible-session-test-"))
    mockResolvePaths.mockReturnValue({
        configDir: tempDir,
        configFile: join(tempDir, "config.json"),
        dataDir: tempDir,
        gamesDir: tempDir,
        sessionsDir: join(tempDir, "sessions"),
    })
    // ensureDir should actually create the directory for integration-style tests
    const { mkdir } = await import("node:fs/promises")
    mockEnsureDir.mockImplementation(async (dir: string) => {
        await mkdir(dir, { recursive: true })
    })
})

afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
    vi.restoreAllMocks()
})

describe("createSession", () => {
    it("returns a valid session with UUID, correct gameId/gamePath, and timestamps", () => {
        const session = createSession("my-game", "/path/to/game")

        expect(session.sessionId).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        )
        expect(session.gameId).toBe("my-game")
        expect(session.gamePath).toBe("/path/to/game")
        expect(session.createdAt).toBe(session.lastActiveAt)
        expect(new Date(session.createdAt).getTime()).not.toBeNaN()
        expect(session.messages).toEqual([])
        expect(session.tokenUsage).toEqual({ inputTokens: 0, outputTokens: 0 })
    })
})

describe("saveSession + loadSessionById", () => {
    it("round-trips a session to disk and back", async () => {
        const session = createSession("my-game", "/path/to/game")
        await saveSession(session)

        const loaded = await loadSessionById(session.sessionId)
        expect(loaded).toEqual(session)
    })

    it("returns null for a non-existent session ID", async () => {
        const loaded = await loadSessionById("non-existent-id")
        expect(loaded).toBeNull()
    })
})

describe("findLatestSession", () => {
    it("finds the most recent session for a game", async () => {
        const older = createSession("my-game", "/path/to/game")
        // Manually set an older lastActiveAt
        const olderSession: AgentSession = {
            ...older,
            lastActiveAt: new Date(Date.now() - 3600_000).toISOString(),
        }
        await saveSession(olderSession)

        const newer = createSession("my-game", "/path/to/game")
        await saveSession(newer)

        const found = await findLatestSession("my-game")
        expect(found).toEqual(newer)
    })

    it("ignores expired sessions", async () => {
        const expired: AgentSession = {
            ...createSession("my-game", "/path/to/game"),
            lastActiveAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
        }
        await saveSession(expired)

        const found = await findLatestSession("my-game")
        expect(found).toBeNull()
    })

    it("returns null when no sessions exist", async () => {
        const found = await findLatestSession("my-game")
        expect(found).toBeNull()
    })

    it("ignores sessions for a different game", async () => {
        const session = createSession("other-game", "/path/to/other")
        await saveSession(session)

        const found = await findLatestSession("my-game")
        expect(found).toBeNull()
    })
})

describe("isSessionExpired", () => {
    it("returns false for a fresh session", () => {
        const session = createSession("my-game", "/path/to/game")
        expect(isSessionExpired(session)).toBe(false)
    })

    it("returns true for a 25-hour-old session", () => {
        const session: AgentSession = {
            ...createSession("my-game", "/path/to/game"),
            lastActiveAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
        }
        expect(isSessionExpired(session)).toBe(true)
    })
})

describe("updateSession", () => {
    it("appends messages and accumulates token usage", () => {
        const session = createSession("my-game", "/path/to/game")

        const updated = updateSession(
            session,
            [{ role: "user", content: "hello" }, { role: "assistant", content: "hi" }],
            { inputTokens: 100, outputTokens: 50 },
        )

        expect(updated.messages).toEqual([
            { role: "user", content: "hello" },
            { role: "assistant", content: "hi" },
        ])
        expect(updated.tokenUsage).toEqual({ inputTokens: 100, outputTokens: 50 })

        // Second update accumulates
        const updated2 = updateSession(
            updated,
            [{ role: "user", content: "more" }],
            { inputTokens: 200, outputTokens: 100 },
        )

        expect(updated2.messages).toHaveLength(3)
        expect(updated2.tokenUsage).toEqual({ inputTokens: 300, outputTokens: 150 })
        expect(new Date(updated2.lastActiveAt).getTime()).toBeGreaterThanOrEqual(
            new Date(updated.lastActiveAt).getTime(),
        )
    })
})

describe("deleteSession", () => {
    it("removes the session file", async () => {
        const session = createSession("my-game", "/path/to/game")
        await saveSession(session)

        // Verify it exists
        const loaded = await loadSessionById(session.sessionId)
        expect(loaded).not.toBeNull()

        await deleteSession(session.sessionId)

        const loadedAfter = await loadSessionById(session.sessionId)
        expect(loadedAfter).toBeNull()
    })

    it("does not throw when deleting a non-existent session", async () => {
        await expect(deleteSession("non-existent-id")).resolves.toBeUndefined()
    })
})
