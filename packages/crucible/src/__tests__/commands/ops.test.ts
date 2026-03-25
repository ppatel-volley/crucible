import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Command } from "commander"
import { registerLogsCommand } from "../../commands/logs.js"
import { registerStatusCommand } from "../../commands/status.js"
import { registerListCommand, runListCommand } from "../../commands/list.js"
import type { CrucibleConfig, CruciblePaths } from "../../types.js"

vi.mock("../../config/paths.js", () => ({
    resolvePaths: vi.fn(),
}))

vi.mock("../../config/config.js", () => ({
    loadConfig: vi.fn(),
}))

vi.mock("node:fs/promises", () => ({
    readdir: vi.fn(),
}))

import { resolvePaths } from "../../config/paths.js"
import { loadConfig } from "../../config/config.js"
import { readdir } from "node:fs/promises"

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

describe("registerLogsCommand", () => {
    it("registers with correct name and options", () => {
        const program = new Command()
        registerLogsCommand(program)

        const logsCmd = program.commands.find((cmd) => cmd.name() === "logs")
        expect(logsCmd).toBeDefined()
        expect(logsCmd!.description()).toBe("View game server logs")

        const followOpt = logsCmd!.options.find((o) => o.short === "-f" && o.long === "--follow")
        expect(followOpt).toBeDefined()

        const linesOpt = logsCmd!.options.find((o) => o.long === "--lines")
        expect(linesOpt).toBeDefined()

        const envOpt = logsCmd!.options.find((o) => o.long === "--env")
        expect(envOpt).toBeDefined()
    })

    it("has correct defaults (follow: false, lines: 100, env: dev)", () => {
        const program = new Command()
        registerLogsCommand(program)

        const logsCmd = program.commands.find((cmd) => cmd.name() === "logs")
        expect(logsCmd).toBeDefined()

        // Parse with only the required argument to check defaults
        const opts = logsCmd!.opts()
        expect(opts.follow).toBe(false)
        expect(opts.lines).toBe(100)
        expect(opts.env).toBe("dev")
    })
})

describe("registerStatusCommand", () => {
    it("registers with correct name, optional game-id argument, and --env option", () => {
        const program = new Command()
        registerStatusCommand(program)

        const statusCmd = program.commands.find((cmd) => cmd.name() === "status")
        expect(statusCmd).toBeDefined()
        expect(statusCmd!.description()).toBe("Check game status across environments")

        const envOpt = statusCmd!.options.find((o) => o.long === "--env")
        expect(envOpt).toBeDefined()
    })

    it("game-id is optional (command name is 'status [game-id]')", () => {
        const program = new Command()
        registerStatusCommand(program)

        const statusCmd = program.commands.find((cmd) => cmd.name() === "status")
        expect(statusCmd).toBeDefined()

        // Commander stores the registered name including arguments
        // An optional argument uses square brackets
        const args = statusCmd!.registeredArguments
        expect(args.length).toBe(1)
        expect(args[0]!.required).toBe(false)
    })
})

describe("registerListCommand", () => {
    it("registers with correct name and --env option", () => {
        const program = new Command()
        registerListCommand(program)

        const listCmd = program.commands.find((cmd) => cmd.name() === "list")
        expect(listCmd).toBeDefined()
        expect(listCmd!.description()).toBe("List local games and their publish status")

        const envOpt = listCmd!.options.find((o) => o.long === "--env")
        expect(envOpt).toBeDefined()
    })
})

describe("runListCommand", () => {
    beforeEach(() => {
        vi.mocked(resolvePaths).mockReturnValue(mockPaths)
        vi.mocked(loadConfig).mockResolvedValue(mockConfig)
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it("lists game directories from gamesDir", async () => {
        const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})
        vi.mocked(readdir).mockResolvedValue([
            { name: "game-alpha", isDirectory: () => true, isFile: () => false },
            { name: "game-beta", isDirectory: () => true, isFile: () => false },
            { name: "some-file.txt", isDirectory: () => false, isFile: () => true },
        ] as any)

        await runListCommand({})

        expect(readdir).toHaveBeenCalledWith(mockPaths.gamesDir, { withFileTypes: true })
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("game-alpha"))
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("game-beta"))
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("2 game(s) found."))

        consoleSpy.mockRestore()
    })

    it("handles empty/missing gamesDir gracefully", async () => {
        const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})
        vi.mocked(readdir).mockRejectedValue(new Error("ENOENT: no such file or directory"))

        await runListCommand({})

        expect(consoleSpy).toHaveBeenCalledWith("No games found. Run `crucible create` to get started.")

        consoleSpy.mockRestore()
    })
})
