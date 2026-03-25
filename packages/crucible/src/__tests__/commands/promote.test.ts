import { describe, it, expect, vi, beforeEach } from "vitest"
import { Command } from "commander"
import { registerPromoteCommand, runPromoteCommand } from "../../commands/promote.js"
import type { CrucibleConfig, CruciblePaths } from "../../types.js"

vi.mock("../../config/paths.js", () => ({
    resolvePaths: vi.fn(),
}))

vi.mock("../../config/config.js", () => ({
    loadConfig: vi.fn(),
}))

vi.mock("node:fs/promises", () => ({
    stat: vi.fn(),
}))

import { resolvePaths } from "../../config/paths.js"
import { loadConfig } from "../../config/config.js"
import { stat } from "node:fs/promises"
import { CrucibleError } from "../../util/errors.js"

const mockPaths: CruciblePaths = {
    configDir: "/tmp/crucible-config",
    configFile: "/tmp/crucible-config/config.json",
    dataDir: "/tmp/crucible-data",
    gamesDir: "/tmp/crucible-games",
    sessionsDir: "/tmp/crucible-data/sessions",
}

const mockConfig: CrucibleConfig = {
    userEmail: "test@volley.com",
    defaultEnvironment: "dev",
    githubOrg: "ppatel-volley",
    registryApiUrls: {},
    agentModel: "claude-sonnet-4-20250514",
    gamesDir: null,
    templateSource: { type: "github", repo: "volley/template", ref: "main" },
}

describe("registerPromoteCommand", () => {
    it("registers command with correct name and required options", () => {
        const program = new Command()
        registerPromoteCommand(program)

        const cmd = program.commands.find((c) => c.name() === "promote")
        expect(cmd).toBeDefined()
        expect(cmd!.description()).toBe("Promote game to next environment")

        // Check that --from and --to are registered as required options
        const optionFlags = cmd!.options.map((o) => o.long)
        expect(optionFlags).toContain("--from")
        expect(optionFlags).toContain("--to")
        expect(optionFlags).toContain("--confirm")
    })
})

describe("runPromoteCommand", () => {
    beforeEach(() => {
        vi.resetAllMocks()
        vi.mocked(resolvePaths).mockReturnValue(mockPaths)
        vi.mocked(loadConfig).mockResolvedValue(mockConfig)
    })

    it("throws CRUCIBLE-301 for missing game", async () => {
        vi.mocked(stat).mockRejectedValue(new Error("ENOENT"))

        await expect(
            runPromoteCommand("nonexistent-game", { from: "dev", to: "staging" }),
        ).rejects.toThrow(CrucibleError)

        try {
            await runPromoteCommand("nonexistent-game", { from: "dev", to: "staging" })
        } catch (err) {
            expect(err).toBeInstanceOf(CrucibleError)
            expect((err as CrucibleError).code).toBe("CRUCIBLE-301")
        }
    })

    it("throws CRUCIBLE-200 for invalid source environment", async () => {
        vi.mocked(stat).mockResolvedValue({} as any)

        await expect(
            runPromoteCommand("my-game", { from: "banana", to: "staging" }),
        ).rejects.toThrow(CrucibleError)

        try {
            await runPromoteCommand("my-game", { from: "banana", to: "staging" })
        } catch (err) {
            expect(err).toBeInstanceOf(CrucibleError)
            expect((err as CrucibleError).code).toBe("CRUCIBLE-200")
            expect((err as CrucibleError).message).toContain("banana")
        }
    })

    it("throws CRUCIBLE-200 for invalid target environment", async () => {
        vi.mocked(stat).mockResolvedValue({} as any)

        await expect(
            runPromoteCommand("my-game", { from: "dev", to: "banana" }),
        ).rejects.toThrow(CrucibleError)

        try {
            await runPromoteCommand("my-game", { from: "dev", to: "banana" })
        } catch (err) {
            expect(err).toBeInstanceOf(CrucibleError)
            expect((err as CrucibleError).code).toBe("CRUCIBLE-200")
            expect((err as CrucibleError).message).toContain("banana")
        }
    })

    it("throws CRUCIBLE-200 when promoting to prod without --confirm", async () => {
        vi.mocked(stat).mockResolvedValue({} as any)

        await expect(
            runPromoteCommand("my-game", { from: "staging", to: "prod" }),
        ).rejects.toThrow(CrucibleError)

        try {
            await runPromoteCommand("my-game", { from: "staging", to: "prod" })
        } catch (err) {
            expect(err).toBeInstanceOf(CrucibleError)
            expect((err as CrucibleError).code).toBe("CRUCIBLE-200")
            expect((err as CrucibleError).message).toContain("confirmation")
        }
    })

    it("throws CRUCIBLE-200 when promoting to prod with wrong --confirm value", async () => {
        vi.mocked(stat).mockResolvedValue({} as any)

        await expect(
            runPromoteCommand("my-game", { from: "staging", to: "prod", confirm: "wrong-name" }),
        ).rejects.toThrow(CrucibleError)

        try {
            await runPromoteCommand("my-game", { from: "staging", to: "prod", confirm: "wrong-name" })
        } catch (err) {
            expect(err).toBeInstanceOf(CrucibleError)
            expect((err as CrucibleError).code).toBe("CRUCIBLE-200")
        }
    })

    it("throws CRUCIBLE-601 'not yet implemented' for valid inputs", async () => {
        vi.mocked(stat).mockResolvedValue({} as any)

        // Non-prod promotion (no --confirm needed)
        await expect(
            runPromoteCommand("my-game", { from: "dev", to: "staging" }),
        ).rejects.toThrow(CrucibleError)

        try {
            await runPromoteCommand("my-game", { from: "dev", to: "staging" })
        } catch (err) {
            expect(err).toBeInstanceOf(CrucibleError)
            expect((err as CrucibleError).code).toBe("CRUCIBLE-601")
            expect((err as CrucibleError).message).toContain("not yet implemented")
        }
    })

    it("throws CRUCIBLE-601 for valid prod promotion with correct --confirm", async () => {
        vi.mocked(stat).mockResolvedValue({} as any)

        try {
            await runPromoteCommand("my-game", { from: "staging", to: "prod", confirm: "my-game" })
        } catch (err) {
            expect(err).toBeInstanceOf(CrucibleError)
            expect((err as CrucibleError).code).toBe("CRUCIBLE-601")
        }
    })
})
