import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
    createProcessWriter,
    formatProcessStatus,
} from "../../dev/output.js"
import type { DevProcessName } from "../../types.js"

describe("output", () => {
    let stdoutSpy: ReturnType<typeof vi.spyOn>
    let stderrSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true)
        stderrSpy = vi
            .spyOn(process.stderr, "write")
            .mockImplementation(() => true)
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    describe("createProcessWriter", () => {
        it("returns an object with stdout and stderr functions", () => {
            const writer = createProcessWriter("server")
            expect(writer).toHaveProperty("stdout")
            expect(writer).toHaveProperty("stderr")
            expect(typeof writer.stdout).toBe("function")
            expect(typeof writer.stderr).toBe("function")
        })

        it("stdout writer outputs the line with the correct prefix to stdout", () => {
            const writer = createProcessWriter("server")
            writer.stdout("hello world")

            expect(stdoutSpy).toHaveBeenCalledOnce()
            const output = stdoutSpy.mock.calls[0]![0] as string
            expect(output).toContain("[server]")
            expect(output).toContain("hello world")
            expect(output.endsWith("\n")).toBe(true)
        })

        it("stderr writer outputs to stderr with the correct prefix", () => {
            const writer = createProcessWriter("display")
            writer.stderr("error occurred")

            expect(stderrSpy).toHaveBeenCalledOnce()
            const output = stderrSpy.mock.calls[0]![0] as string
            expect(output).toContain("[display]")
            expect(output).toContain("error occurred")
            expect(output.endsWith("\n")).toBe(true)
        })

        it("labels are padded to equal width for all process names", () => {
            const names: DevProcessName[] = [
                "server",
                "display",
                "controller",
            ]
            const writers = names.map((name) => createProcessWriter(name))

            // Write a line from each process
            for (const writer of writers) {
                writer.stdout("test")
            }

            // Extract the prefix portion (everything before " test\n")
            const outputs = stdoutSpy.mock.calls.map(
                (call) => call[0] as string,
            )

            // Strip ANSI codes to compare visual width
            const stripAnsi = (str: string) =>
                str.replace(
                    // eslint-disable-next-line no-control-regex
                    /\u001B\[[0-9;]*m/g,
                    "",
                )

            const prefixes = outputs.map((output) => {
                const stripped = stripAnsi(output)
                // Prefix is everything before " test\n"
                const idx = stripped.indexOf(" test\n")
                return stripped.slice(0, idx)
            })

            // All prefixes should have the same length
            const lengths = prefixes.map((p) => p.length)
            expect(lengths[0]).toBe(lengths[1])
            expect(lengths[1]).toBe(lengths[2])
        })

        it("different process names get different colour functions", () => {
            const serverWriter = createProcessWriter("server")
            const displayWriter = createProcessWriter("display")

            serverWriter.stdout("line")
            displayWriter.stdout("line")

            const serverOutput = stdoutSpy.mock.calls[0]![0] as string
            const displayOutput = stdoutSpy.mock.calls[1]![0] as string

            // The outputs should differ because different ANSI colour codes are applied
            // (unless chalk is disabled, in which case they differ by label text)
            expect(serverOutput).not.toBe(displayOutput)
        })
    })

    describe("formatProcessStatus", () => {
        it("includes the prefix and message", () => {
            const result = formatProcessStatus("controller", "started")

            expect(result).toContain("[controller]")
            expect(result).toContain("started")
        })

        it("returns a string (not writing to stdout/stderr)", () => {
            const result = formatProcessStatus("server", "crashed")

            expect(typeof result).toBe("string")
            expect(stdoutSpy).not.toHaveBeenCalled()
            expect(stderrSpy).not.toHaveBeenCalled()
        })
    })
})
