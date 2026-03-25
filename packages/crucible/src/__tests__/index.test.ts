import { describe, it, expect } from "vitest"
import { execa } from "execa"
import { join } from "node:path"

const CLI_PATH = join(__dirname, "..", "index.ts")

async function runCLI(args: string[] = [], env: Record<string, string> = {}) {
    try {
        const result = await execa("npx", ["tsx", CLI_PATH, ...args], {
            env: { ...process.env, ...env, NO_COLOR: "1" },
            reject: false,
        })
        return result
    } catch (error) {
        return error as any
    }
}

describe("crucible CLI", () => {
    it("should output help text and exit 0", async () => {
        const result = await runCLI(["--help"])
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain("Build TV games with AI")
        expect(result.stdout).toContain("crucible")
    })

    it("should output version 0.1.0 and exit 0", async () => {
        const result = await runCLI(["--version"])
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain("0.1.0")
    })

    it("should exit with error for unknown command", async () => {
        const result = await runCLI(["nonexistent-command"])
        expect(result.exitCode).not.toBe(0)
        expect(result.stderr).toContain("unknown command")
    })

    it("should parse --json flag correctly", async () => {
        const result = await runCLI(["--json", "--help"])
        expect(result.exitCode).toBe(0)
        // The --json flag should appear in help output as a recognised option
        expect(result.stdout).toContain("--json")
    })

    it("should parse --no-color flag correctly", async () => {
        const result = await runCLI(["--no-color", "--help"])
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain("--no-color")
    })
})
