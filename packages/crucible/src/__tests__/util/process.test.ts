import { describe, it, expect, vi, afterEach } from "vitest"
import { runProcess, killProcessTree } from "../../util/process.js"

describe("runProcess", () => {
    it("captures stdout", async () => {
        const result = await runProcess("node", ["-e", 'console.log("hello world")'])
        expect(result.stdout).toContain("hello world")
        expect(result.exitCode).toBe(0)
    })

    it("captures stderr", async () => {
        const result = await runProcess("node", ["-e", 'console.error("oops")'])
        expect(result.stderr).toContain("oops")
    })

    it("returns non-zero exit code on failure", async () => {
        const result = await runProcess("node", ["-e", "process.exit(42)"])
        expect(result.exitCode).toBe(42)
    })

    it("streams stdout via callback", async () => {
        const lines: string[] = []
        await runProcess("node", ["-e", 'console.log("line1"); console.log("line2")'], {
            onStdout: (line) => lines.push(line),
        })
        expect(lines.some((l) => l.includes("line1"))).toBe(true)
        expect(lines.some((l) => l.includes("line2"))).toBe(true)
    })

    it("streams stderr via callback", async () => {
        const lines: string[] = []
        await runProcess("node", ["-e", 'console.error("err1")'], {
            onStderr: (line) => lines.push(line),
        })
        expect(lines.some((l) => l.includes("err1"))).toBe(true)
    })

    it("timeout terminates process", async () => {
        const result = await runProcess(
            "node",
            ["-e", "setTimeout(() => {}, 30000)"],
            { timeout: 500 },
        )
        // execa sets exitCode to undefined or non-zero on timeout; we map undefined to 1
        expect(result.exitCode).not.toBe(0)
    }, 10000)
})

describe("killProcessTree", () => {
    it("kills a running process tree", async () => {
        // Start a long-running child process
        const { execa } = await import("execa")
        const child = execa("node", ["-e", "setTimeout(() => {}, 30000)"], { reject: false })
        // Give the process a moment to start
        await new Promise((resolve) => setTimeout(resolve, 200))
        expect(child.pid).toBeDefined()
        await killProcessTree(child.pid!)
        const result = await child
        // Process should have been killed
        expect(result.exitCode).not.toBe(0)
    }, 10000)
})
