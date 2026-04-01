import { describe, it, expect, vi, beforeEach } from "vitest"
import { registerGame, fetchGame } from "../lib/registry-client.js"

describe("fetchGame", () => {
    beforeEach(() => {
        vi.restoreAllMocks()
    })

    it("returns game record on 200", async () => {
        const mockGame = {
            gameId: "test-game",
            updatedAt: "2026-03-31T12:00:00Z",
            environments: {},
        }
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: () => Promise.resolve(mockGame),
            })
        )

        const result = await fetchGame("https://api.example.com", "test-game")
        expect(result).toEqual(mockGame)
    })

    it("returns null on 404", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({ ok: false, status: 404 })
        )

        const result = await fetchGame("https://api.example.com", "test-game")
        expect(result).toBeNull()
    })

    it("throws on other error statuses", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: false,
                status: 500,
                statusText: "Internal Server Error",
            })
        )

        await expect(
            fetchGame("https://api.example.com", "test-game")
        ).rejects.toThrow("Failed to fetch game: 500")
    })
})

describe("registerGame", () => {
    const basePayload = {
        displayName: "Test Game",
        author: "test@volley.com",
        imageTag: "test-abc123-1",
        commitSha: "abc123",
        version: "0.1.0",
        status: "healthy" as const,
        environment: "dev",
    }

    beforeEach(() => {
        vi.restoreAllMocks()
    })

    it("registers successfully on first attempt", async () => {
        const fetchMock = vi.fn()
        // First call: fetchGame (GET)
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: () =>
                Promise.resolve({
                    gameId: "test-game",
                    updatedAt: "2026-03-31T12:00:00Z",
                    environments: {},
                }),
        })
        // Second call: PUT
        fetchMock.mockResolvedValueOnce({ ok: true, status: 200 })
        vi.stubGlobal("fetch", fetchMock)

        await expect(
            registerGame("https://api.example.com", "test-game", basePayload)
        ).resolves.toBeUndefined()

        // Verify PUT was called with expectedUpdatedAt
        const putCall = fetchMock.mock.calls[1]
        expect(putCall[0]).toBe("https://api.example.com/games/test-game")
        expect(putCall[1].method).toBe("PUT")
        const body = JSON.parse(putCall[1].body)
        expect(body.expectedUpdatedAt).toBe("2026-03-31T12:00:00Z")
    })

    it("registers new game without expectedUpdatedAt", async () => {
        const fetchMock = vi.fn()
        // GET returns 404 (new game)
        fetchMock.mockResolvedValueOnce({
            ok: false,
            status: 404,
        })
        // PUT succeeds
        fetchMock.mockResolvedValueOnce({ ok: true, status: 200 })
        vi.stubGlobal("fetch", fetchMock)

        await expect(
            registerGame("https://api.example.com", "new-game", basePayload)
        ).resolves.toBeUndefined()

        const body = JSON.parse(fetchMock.mock.calls[1][1].body)
        expect(body.expectedUpdatedAt).toBeUndefined()
    })

    it("retries on 409 conflict", async () => {
        const fetchMock = vi.fn()
        // Attempt 1: GET
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: () =>
                Promise.resolve({
                    gameId: "test-game",
                    updatedAt: "2026-03-31T12:00:00Z",
                    environments: {},
                }),
        })
        // Attempt 1: PUT returns 409
        fetchMock.mockResolvedValueOnce({
            ok: false,
            status: 409,
            text: () => Promise.resolve("Conflict"),
        })
        // Attempt 2: GET (re-fetch)
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: () =>
                Promise.resolve({
                    gameId: "test-game",
                    updatedAt: "2026-03-31T12:01:00Z",
                    environments: {},
                }),
        })
        // Attempt 2: PUT succeeds
        fetchMock.mockResolvedValueOnce({ ok: true, status: 200 })
        vi.stubGlobal("fetch", fetchMock)

        await expect(
            registerGame("https://api.example.com", "test-game", basePayload)
        ).resolves.toBeUndefined()

        expect(fetchMock).toHaveBeenCalledTimes(4) // 2 GETs + 2 PUTs
    })

    it("throws after non-409 error", async () => {
        const fetchMock = vi.fn()
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: () =>
                Promise.resolve({
                    gameId: "test-game",
                    updatedAt: "2026-03-31T12:00:00Z",
                    environments: {},
                }),
        })
        fetchMock.mockResolvedValueOnce({
            ok: false,
            status: 500,
            text: () => Promise.resolve("Internal error"),
        })
        vi.stubGlobal("fetch", fetchMock)

        await expect(
            registerGame("https://api.example.com", "test-game", basePayload)
        ).rejects.toThrow("Registry API returned 500")
    })
})
