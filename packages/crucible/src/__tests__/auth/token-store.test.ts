import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { join } from "node:path"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { saveTokens, loadTokens, isTokenExpired, clearTokens } from "../../auth/token-store.js"
import type { TokenSet } from "../../types.js"

// Mock resolvePaths to use a temp directory
let tempDir: string

vi.mock("../../config/paths.js", () => ({
    resolvePaths: () => ({
        configDir: tempDir,
        configFile: join(tempDir, "config.json"),
        dataDir: tempDir,
        gamesDir: join(tempDir, "games"),
        sessionsDir: join(tempDir, "sessions"),
    }),
}))

const sampleTokens: TokenSet = {
    accessToken: "access-abc-123",
    refreshToken: "refresh-xyz-789",
    idToken: "id-token-value",
    expiresAt: Date.now() + 3600 * 1000, // 1 hour from now
    email: "test@example.com",
}

beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "crucible-token-test-"))
})

afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
})

describe("saveTokens + loadTokens", () => {
    it("round-trips token data correctly", async () => {
        await saveTokens(sampleTokens)
        const loaded = await loadTokens()

        expect(loaded).toEqual(sampleTokens)
    })
})

describe("loadTokens", () => {
    it("returns null when no file exists", async () => {
        const loaded = await loadTokens()
        expect(loaded).toBeNull()
    })
})

describe("isTokenExpired", () => {
    it("returns false for a fresh token", () => {
        const tokens: TokenSet = {
            ...sampleTokens,
            expiresAt: Date.now() + 3600 * 1000, // 1 hour from now
        }
        expect(isTokenExpired(tokens)).toBe(false)
    })

    it("returns true for an expired token", () => {
        const tokens: TokenSet = {
            ...sampleTokens,
            expiresAt: Date.now() - 1000, // 1 second ago
        }
        expect(isTokenExpired(tokens)).toBe(true)
    })

    it("returns true when within 5 minutes of expiry", () => {
        const tokens: TokenSet = {
            ...sampleTokens,
            expiresAt: Date.now() + 4 * 60 * 1000, // 4 minutes from now (< 5 min buffer)
        }
        expect(isTokenExpired(tokens)).toBe(true)
    })

    it("returns false when just outside the 5-minute buffer", () => {
        const tokens: TokenSet = {
            ...sampleTokens,
            expiresAt: Date.now() + 6 * 60 * 1000, // 6 minutes from now (> 5 min buffer)
        }
        expect(isTokenExpired(tokens)).toBe(false)
    })
})

describe("clearTokens", () => {
    it("removes the token file", async () => {
        await saveTokens(sampleTokens)
        const before = await loadTokens()
        expect(before).not.toBeNull()

        await clearTokens()
        const after = await loadTokens()
        expect(after).toBeNull()
    })

    it("does not throw when no file exists", async () => {
        await expect(clearTokens()).resolves.toBeUndefined()
    })
})
