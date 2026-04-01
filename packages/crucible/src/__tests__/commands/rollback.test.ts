import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Command } from "commander"
import { registerRollbackCommand, runRollbackCommand } from "../../commands/rollback.js"
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

vi.mock("execa", () => ({
    execa: vi.fn(),
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

function setupMocks(): void {
    vi.mocked(resolvePaths).mockReturnValue(mockPaths)
    vi.mocked(loadConfig).mockResolvedValue(mockConfig)
}

describe("registerRollbackCommand", () => {
    it("registers the rollback command with correct name and options", () => {
        const program = new Command()
        registerRollbackCommand(program)

        const rollbackCmd = program.commands.find((cmd) => cmd.name() === "rollback")
        expect(rollbackCmd).toBeDefined()
        expect(rollbackCmd!.description()).toBe("Rollback to a previous game version")

        const toOpt = rollbackCmd!.options.find((o) => o.long === "--to")
        expect(toOpt).toBeDefined()

        const envOpt = rollbackCmd!.options.find((o) => o.long === "--env")
        expect(envOpt).toBeDefined()
    })
})

describe("runRollbackCommand", () => {
    beforeEach(() => {
        setupMocks()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it("throws CRUCIBLE-301 when game directory does not exist", async () => {
        vi.mocked(stat).mockRejectedValue(new Error("ENOENT: no such file or directory"))

        await expect(runRollbackCommand("nonexistent-game", { env: "dev" })).rejects.toThrow(CrucibleError)
        await expect(runRollbackCommand("nonexistent-game", { env: "dev" })).rejects.toThrow(
            /CRUCIBLE-301|not found/,
        )
    })

    it("throws CRUCIBLE-200 for invalid environment", async () => {
        vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as any)

        await expect(runRollbackCommand("my-game", { env: "banana" })).rejects.toThrow(CrucibleError)
        await expect(runRollbackCommand("my-game", { env: "banana" })).rejects.toThrow(
            /CRUCIBLE-200|Invalid environment/,
        )
    })

    it("throws CRUCIBLE-701 when kubectl rollout undo fails", async () => {
        vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as any)

        const { execa } = await import("execa")
        vi.mocked(execa).mockRejectedValue(new Error("kubectl: deployment not found"))

        await expect(runRollbackCommand("my-game", { env: "dev" })).rejects.toThrow(CrucibleError)
        try {
            await runRollbackCommand("my-game", { env: "dev" })
        } catch (err) {
            expect((err as CrucibleError).code).toBe("CRUCIBLE-701")
        }
    })

    it("succeeds when kubectl rollout undo and status both succeed", async () => {
        vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as any)

        const { execa } = await import("execa")
        vi.mocked(execa).mockResolvedValue({ stdout: "deployment rolled back", stderr: "" } as any)

        // Should not throw
        await runRollbackCommand("my-game", { env: "dev" })
    })
})
