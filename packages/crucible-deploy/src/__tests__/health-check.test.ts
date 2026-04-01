import { describe, it, expect, vi, beforeEach } from "vitest"
import { checkHealth, pollHealth } from "../lib/health-check.js"

describe("checkHealth", () => {
    beforeEach(() => {
        vi.restoreAllMocks()
    })

    it("returns healthy on 200 response", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({ status: 200 })
        )

        const result = await checkHealth("https://example.com/health")
        expect(result.healthy).toBe(true)
        expect(result.statusCode).toBe(200)
        expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    })

    it("returns unhealthy on non-200 response", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({ status: 503 })
        )

        const result = await checkHealth("https://example.com/health")
        expect(result.healthy).toBe(false)
        expect(result.statusCode).toBe(503)
    })

    it("returns unhealthy with error on network failure", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockRejectedValue(new Error("ECONNREFUSED"))
        )

        const result = await checkHealth("https://example.com/health")
        expect(result.healthy).toBe(false)
        expect(result.error).toContain("ECONNREFUSED")
    })
})

describe("pollHealth", () => {
    beforeEach(() => {
        vi.restoreAllMocks()
    })

    it("returns immediately on healthy response", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({ status: 200 })
        )

        const result = await pollHealth("https://example.com/health", 5_000, 100)
        expect(result.healthy).toBe(true)
    })

    it("retries until healthy", async () => {
        let callCount = 0
        vi.stubGlobal(
            "fetch",
            vi.fn().mockImplementation(() => {
                callCount++
                if (callCount < 3) {
                    return Promise.resolve({ status: 503 })
                }
                return Promise.resolve({ status: 200 })
            })
        )

        const result = await pollHealth(
            "https://example.com/health",
            10_000,
            50
        )
        expect(result.healthy).toBe(true)
        expect(callCount).toBe(3)
    })

    it("returns unhealthy after timeout", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({ status: 503 })
        )

        const result = await pollHealth(
            "https://example.com/health",
            200,
            50
        )
        expect(result.healthy).toBe(false)
        expect(result.statusCode).toBe(503)
    })
})
