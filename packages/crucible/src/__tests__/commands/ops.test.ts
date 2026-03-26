import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Command } from "commander"
import { registerLogsCommand } from "../../commands/logs.js"
import { registerStatusCommand } from "../../commands/status.js"
import { registerListCommand, runListCommand, readGameInfo, formatTimeAgo } from "../../commands/list.js"
import type { CrucibleConfig, CruciblePaths } from "../../types.js"

vi.mock("../../config/paths.js", () => ({
    resolvePaths: vi.fn(),
}))

vi.mock("../../config/config.js", () => ({
    loadConfig: vi.fn(),
}))

vi.mock("node:fs/promises", () => ({
    readdir: vi.fn(),
    readFile: vi.fn(),
}))

import { resolvePaths } from "../../config/paths.js"
import { loadConfig } from "../../config/config.js"
import { readdir, readFile } from "node:fs/promises"

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
        vi.mocked(readFile).mockRejectedValue(new Error("ENOENT"))

        await runListCommand({})

        expect(readdir).toHaveBeenCalledWith(mockPaths.gamesDir, { withFileTypes: true })
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("game-alpha"))
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("game-beta"))
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("2 game(s) found."))

        consoleSpy.mockRestore()
    })

    it("shows display name and version from crucible.json", async () => {
        const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})
        vi.mocked(readdir).mockResolvedValue([
            { name: "scottish-trivia", isDirectory: () => true, isFile: () => false },
        ] as any)
        vi.mocked(readFile).mockResolvedValue(
            JSON.stringify({
                displayName: "Scottish Trivia",
                version: "0.1.0",
                template: "hello-weekend",
                createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
            }),
        )

        await runListCommand({})

        const allOutput = consoleSpy.mock.calls.map((c) => c[0]).join("\n")
        expect(allOutput).toContain("scottish-trivia")
        expect(allOutput).toContain("Scottish Trivia")
        expect(allOutput).toContain("0.1.0")
        expect(allOutput).toContain("hello-weekend")
        expect(allOutput).toContain("2d ago")
        expect(allOutput).toContain("1 game(s) found.")

        consoleSpy.mockRestore()
    })

    it("handles directories without crucible.json gracefully", async () => {
        const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})
        vi.mocked(readdir).mockResolvedValue([
            { name: "not-a-game", isDirectory: () => true, isFile: () => false },
        ] as any)
        vi.mocked(readFile).mockRejectedValue(new Error("ENOENT"))

        await runListCommand({})

        const allOutput = consoleSpy.mock.calls.map((c) => c[0]).join("\n")
        expect(allOutput).toContain("not-a-game")
        expect(allOutput).toContain("(no crucible.json)")

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

describe("readGameInfo", () => {
    it("parses crucible.json fields correctly", async () => {
        vi.mocked(readFile).mockResolvedValue(
            JSON.stringify({
                displayName: "Emoji Party",
                version: "0.2.0",
                template: "hello-weekend",
                createdAt: "2026-03-20T12:00:00Z",
            }),
        )

        const info = await readGameInfo("/tmp/games", "emoji-party")

        expect(info.gameId).toBe("emoji-party")
        expect(info.displayName).toBe("Emoji Party")
        expect(info.version).toBe("0.2.0")
        expect(info.template).toBe("hello-weekend")
        expect(info.createdAt).toBe("2026-03-20T12:00:00Z")
        expect(info.hasCrucibleJson).toBe(true)
    })

    it("returns fallback values when crucible.json is missing", async () => {
        vi.mocked(readFile).mockRejectedValue(new Error("ENOENT"))

        const info = await readGameInfo("/tmp/games", "orphan-dir")

        expect(info.gameId).toBe("orphan-dir")
        expect(info.displayName).toBe("orphan-dir")
        expect(info.hasCrucibleJson).toBe(false)
    })
})

describe("formatTimeAgo", () => {
    it("returns '—' for empty string", () => {
        expect(formatTimeAgo("")).toBe("—")
    })

    it("returns minutes for recent times", () => {
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
        expect(formatTimeAgo(fiveMinAgo)).toBe("5m ago")
    })

    it("returns hours for times within a day", () => {
        const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
        expect(formatTimeAgo(threeHoursAgo)).toBe("3h ago")
    })

    it("returns days for older times", () => {
        const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
        expect(formatTimeAgo(tenDaysAgo)).toBe("10d ago")
    })
})
