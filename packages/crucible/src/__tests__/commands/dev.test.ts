import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Command } from "commander"
import { registerDevCommand, runDevCommand } from "../../commands/dev.js"
import type { CrucibleConfig, CruciblePaths, DevSession } from "../../types.js"

// Mock all external dependencies
vi.mock("../../dev/orchestrator.js", () => ({
    startDevSession: vi.fn(),
    stopDevSession: vi.fn(),
}))

vi.mock("../../config/paths.js", () => ({
    resolvePaths: vi.fn(),
}))

vi.mock("../../config/config.js", () => ({
    loadConfig: vi.fn(),
}))

vi.mock("../../util/logger.js", () => ({
    createLogger: vi.fn(),
}))

vi.mock("../../util/process.js", () => ({
    setupSignalHandlers: vi.fn(),
}))

vi.mock("node:fs/promises", () => ({
    stat: vi.fn(),
}))

import { startDevSession, stopDevSession } from "../../dev/orchestrator.js"
import { resolvePaths } from "../../config/paths.js"
import { loadConfig } from "../../config/config.js"
import { createLogger } from "../../util/logger.js"
import { setupSignalHandlers } from "../../util/process.js"
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

const mockSession: DevSession = {
    ports: { server: 8090, display: 3000, controller: 5174 },
    pids: { server: 1234, display: 1235, controller: 1236 },
    gamePath: "/tmp/crucible-games/my-game",
    gameId: "my-game",
}

function setupMocks(): void {
    vi.mocked(resolvePaths).mockReturnValue(mockPaths)
    vi.mocked(loadConfig).mockResolvedValue(mockConfig)

    const mockSpinner = { succeed: vi.fn(), fail: vi.fn(), update: vi.fn(), stop: vi.fn() }
    vi.mocked(createLogger).mockReturnValue({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        success: vi.fn(),
        fail: vi.fn(),
        spinner: vi.fn().mockReturnValue(mockSpinner),
    })

    vi.mocked(setupSignalHandlers).mockImplementation(() => {})
}

describe("registerDevCommand", () => {
    it("registers the dev command with correct name and options", () => {
        const program = new Command()
        registerDevCommand(program)

        const devCmd = program.commands.find((cmd) => cmd.name() === "dev")
        expect(devCmd).toBeDefined()
        expect(devCmd!.description()).toBe("Start local development server for a game")

        const portServerOpt = devCmd!.options.find((o) => o.long === "--port-server")
        expect(portServerOpt).toBeDefined()

        const portDisplayOpt = devCmd!.options.find((o) => o.long === "--port-display")
        expect(portDisplayOpt).toBeDefined()

        const portControllerOpt = devCmd!.options.find((o) => o.long === "--port-controller")
        expect(portControllerOpt).toBeDefined()
    })
})

describe("runDevCommand", () => {
    beforeEach(() => {
        setupMocks()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it("throws error when game directory does not exist", async () => {
        vi.mocked(stat).mockRejectedValue(new Error("ENOENT: no such file or directory"))

        await expect(runDevCommand("nonexistent-game", {})).rejects.toThrow(CrucibleError)
        await expect(runDevCommand("nonexistent-game", {})).rejects.toThrow(
            /Game "nonexistent-game" not found/,
        )
    })

    it("calls startDevSession with correct gamePath and gameId", async () => {
        vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as any)
        vi.mocked(startDevSession).mockResolvedValue(mockSession)

        // runDevCommand awaits forever after setup, so we need to race it
        const promise = runDevCommand("my-game", {})

        // Give it a tick to run through the async setup
        await vi.waitFor(() => {
            expect(startDevSession).toHaveBeenCalledWith({
                gamePath: expect.stringContaining("my-game"),
                gameId: "my-game",
                ports: {},
            })
        })

        // Don't await the promise — it intentionally never resolves
    })

    it("passes port overrides when specified", async () => {
        vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as any)
        vi.mocked(startDevSession).mockResolvedValue(mockSession)

        const promise = runDevCommand("my-game", {
            portServer: 9090,
            portDisplay: 4000,
            portController: 6174,
        })

        await vi.waitFor(() => {
            expect(startDevSession).toHaveBeenCalledWith({
                gamePath: expect.stringContaining("my-game"),
                gameId: "my-game",
                ports: { server: 9090, display: 4000, controller: 6174 },
            })
        })
    })

    it("calls setupSignalHandlers for cleanup", async () => {
        vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as any)
        vi.mocked(startDevSession).mockResolvedValue(mockSession)

        const promise = runDevCommand("my-game", {})

        await vi.waitFor(() => {
            expect(setupSignalHandlers).toHaveBeenCalledWith(expect.any(Function))
        })
    })

    it("uses config.gamesDir when set", async () => {
        vi.mocked(loadConfig).mockResolvedValue({
            ...mockConfig,
            gamesDir: "/custom/games",
        })
        vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as any)
        vi.mocked(startDevSession).mockResolvedValue(mockSession)

        const promise = runDevCommand("my-game", {})

        await vi.waitFor(() => {
            expect(startDevSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    gamePath: expect.stringMatching(/custom[\\/]games[\\/]my-game/),
                }),
            )
        })
    })
})
