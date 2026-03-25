import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Command } from "commander"
import { registerPublishCommand, runPublishCommand } from "../../commands/publish.js"
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

function setupMocks(): void {
    vi.mocked(resolvePaths).mockReturnValue(mockPaths)
    vi.mocked(loadConfig).mockResolvedValue(mockConfig)
}

describe("registerPublishCommand", () => {
    it("registers the publish command with correct name and options", () => {
        const program = new Command()
        registerPublishCommand(program)

        const publishCmd = program.commands.find((cmd) => cmd.name() === "publish")
        expect(publishCmd).toBeDefined()
        expect(publishCmd!.description()).toBe("Publish game to registry — pushes to GitHub and monitors CI pipeline")

        const timeoutOpt = publishCmd!.options.find((o) => o.long === "--timeout")
        expect(timeoutOpt).toBeDefined()

        const envOpt = publishCmd!.options.find((o) => o.long === "--env")
        expect(envOpt).toBeDefined()
    })
})

describe("runPublishCommand", () => {
    beforeEach(() => {
        setupMocks()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it("throws CRUCIBLE-301 when game directory does not exist", async () => {
        vi.mocked(stat).mockRejectedValue(new Error("ENOENT: no such file or directory"))

        await expect(runPublishCommand("nonexistent-game", { timeout: 10, env: "dev" })).rejects.toThrow(CrucibleError)
        await expect(runPublishCommand("nonexistent-game", { timeout: 10, env: "dev" })).rejects.toThrow(
            /Game "nonexistent-game" not found/,
        )
    })

    it("throws CRUCIBLE-200 for invalid environment", async () => {
        vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as any)

        try {
            await runPublishCommand("my-game", { timeout: 10, env: "invalid-env" })
            expect.unreachable("Should have thrown")
        } catch (err) {
            expect(err).toBeInstanceOf(CrucibleError)
            expect((err as CrucibleError).code).toBe("CRUCIBLE-200")
            expect((err as CrucibleError).message).toContain('Invalid environment "invalid-env"')
        }
    })

    it("throws CRUCIBLE-501 not yet implemented for valid inputs", async () => {
        vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as any)

        try {
            await runPublishCommand("my-game", { timeout: 10, env: "dev" })
            expect.unreachable("Should have thrown")
        } catch (err) {
            expect(err).toBeInstanceOf(CrucibleError)
            expect((err as CrucibleError).code).toBe("CRUCIBLE-501")
            expect((err as CrucibleError).message).toContain("not yet implemented")
        }
    })
})
