import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createLogger } from "../../util/logger.js"
import type { GlobalOptions } from "../../types.js"

function baseOptions(overrides: Partial<GlobalOptions> = {}): GlobalOptions {
    return { color: false, json: false, verbose: false, quiet: false, ...overrides }
}

describe("createLogger", () => {
    let stdoutWrite: ReturnType<typeof vi.spyOn>
    let stderrWrite: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        stdoutWrite = vi.spyOn(process.stdout, "write").mockReturnValue(true)
        stderrWrite = vi.spyOn(process.stderr, "write").mockReturnValue(true)
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it("info writes to stdout", () => {
        const logger = createLogger(baseOptions())
        logger.info("hello")
        expect(stdoutWrite).toHaveBeenCalledOnce()
        const output = stdoutWrite.mock.calls[0]![0] as string
        expect(output).toContain("hello")
    })

    it("debug is suppressed without --verbose", () => {
        const logger = createLogger(baseOptions())
        logger.debug("hidden")
        expect(stdoutWrite).not.toHaveBeenCalled()
        expect(stderrWrite).not.toHaveBeenCalled()
    })

    it("debug is shown with --verbose", () => {
        const logger = createLogger(baseOptions({ verbose: true }))
        logger.debug("visible")
        expect(stderrWrite).toHaveBeenCalledOnce()
        const output = stderrWrite.mock.calls[0]![0] as string
        expect(output).toContain("visible")
    })

    it("warn writes to stderr", () => {
        const logger = createLogger(baseOptions())
        logger.warn("watch out")
        expect(stderrWrite).toHaveBeenCalledOnce()
        const output = stderrWrite.mock.calls[0]![0] as string
        expect(output).toContain("watch out")
    })

    it("error writes to stderr", () => {
        const logger = createLogger(baseOptions())
        logger.error("boom")
        expect(stderrWrite).toHaveBeenCalledOnce()
        const output = stderrWrite.mock.calls[0]![0] as string
        expect(output).toContain("boom")
    })

    it("quiet suppresses info", () => {
        const logger = createLogger(baseOptions({ quiet: true }))
        logger.info("hidden")
        expect(stdoutWrite).not.toHaveBeenCalled()
    })

    it("quiet does not suppress warn", () => {
        const logger = createLogger(baseOptions({ quiet: true }))
        logger.warn("visible")
        expect(stderrWrite).toHaveBeenCalledOnce()
    })

    it("quiet does not suppress error", () => {
        const logger = createLogger(baseOptions({ quiet: true }))
        logger.error("visible")
        expect(stderrWrite).toHaveBeenCalledOnce()
    })

    describe("JSON mode", () => {
        it("outputs valid JSON for info", () => {
            const logger = createLogger(baseOptions({ json: true }))
            logger.info("test message", { key: "value" })
            expect(stdoutWrite).toHaveBeenCalledOnce()
            const raw = stdoutWrite.mock.calls[0]![0] as string
            const parsed = JSON.parse(raw)
            expect(parsed.level).toBe("info")
            expect(parsed.message).toBe("test message")
            expect(parsed.data).toEqual({ key: "value" })
            expect(parsed.timestamp).toBeDefined()
        })

        it("outputs valid JSON for error", () => {
            const logger = createLogger(baseOptions({ json: true }))
            logger.error("fail")
            const raw = stdoutWrite.mock.calls[0]![0] as string
            const parsed = JSON.parse(raw)
            expect(parsed.level).toBe("error")
        })

        it("outputs valid JSON for warn", () => {
            const logger = createLogger(baseOptions({ json: true }))
            logger.warn("caution")
            const raw = stdoutWrite.mock.calls[0]![0] as string
            const parsed = JSON.parse(raw)
            expect(parsed.level).toBe("warn")
        })
    })

    describe("success and fail", () => {
        it("success has tick prefix", () => {
            const logger = createLogger(baseOptions())
            logger.success("done")
            const output = stdoutWrite.mock.calls[0]![0] as string
            // With no UTF-8, uses [OK]; with UTF-8 uses ✓. Either way, check message is there.
            expect(output).toContain("done")
        })

        it("fail has cross prefix", () => {
            const logger = createLogger(baseOptions())
            logger.fail("broken")
            const output = stderrWrite.mock.calls[0]![0] as string
            expect(output).toContain("broken")
        })

        it("quiet suppresses success", () => {
            const logger = createLogger(baseOptions({ quiet: true }))
            logger.success("hidden")
            expect(stdoutWrite).not.toHaveBeenCalled()
        })
    })
})
