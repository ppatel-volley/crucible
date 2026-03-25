import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Command } from "commander"
import { registerAgentCommand, runAgentCommand } from "../../commands/agent.js"
import type { AgentSession, AssembledContext, CrucibleConfig, CruciblePaths } from "../../types.js"

// Mock all external dependencies
vi.mock("../../agent/context.js", () => ({
    assembleContext: vi.fn(),
}))

vi.mock("../../agent/runner.js", () => ({
    runAgentTurn: vi.fn(),
}))

vi.mock("../../agent/session.js", () => ({
    createSession: vi.fn(),
    saveSession: vi.fn(),
    findLatestSession: vi.fn(),
    updateSession: vi.fn(),
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

vi.mock("node:fs/promises", () => ({
    stat: vi.fn(),
}))

import { assembleContext } from "../../agent/context.js"
import { createSession, saveSession, findLatestSession, updateSession } from "../../agent/session.js"
import { resolvePaths } from "../../config/paths.js"
import { loadConfig } from "../../config/config.js"
import { createLogger } from "../../util/logger.js"
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

const mockContext: AssembledContext = {
    files: [{ path: "src/index.ts", content: "// hello", tokens: 10, priority: "required" }],
    totalTokens: 10,
    truncated: false,
    missedFiles: [],
}

const mockSession: AgentSession = {
    sessionId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    gameId: "my-game",
    gamePath: "/tmp/crucible-games/my-game",
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    messages: [],
    tokenUsage: { inputTokens: 0, outputTokens: 0 },
}

function setupMocks(): void {
    vi.mocked(resolvePaths).mockReturnValue(mockPaths)
    vi.mocked(loadConfig).mockResolvedValue(mockConfig)
    vi.mocked(createSession).mockReturnValue(mockSession)
    vi.mocked(saveSession).mockResolvedValue(undefined)
    vi.mocked(findLatestSession).mockResolvedValue(null)
    vi.mocked(updateSession).mockReturnValue(mockSession)
    vi.mocked(assembleContext).mockResolvedValue(mockContext)

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
}

describe("registerAgentCommand", () => {
    it("registers the agent command with correct name and options", () => {
        const program = new Command()
        registerAgentCommand(program)

        const agentCmd = program.commands.find((cmd) => cmd.name() === "agent")
        expect(agentCmd).toBeDefined()
        expect(agentCmd!.description()).toBe("Start an AI agent session for a game")

        // Check options
        const resumeOpt = agentCmd!.options.find((o) => o.long === "--resume")
        expect(resumeOpt).toBeDefined()

        const modelOpt = agentCmd!.options.find((o) => o.long === "--model")
        expect(modelOpt).toBeDefined()
    })
})

describe("runAgentCommand", () => {
    let savedEnv: string | undefined

    beforeEach(() => {
        savedEnv = process.env.ANTHROPIC_API_KEY
        setupMocks()
    })

    afterEach(() => {
        if (savedEnv !== undefined) {
            process.env.ANTHROPIC_API_KEY = savedEnv
        } else {
            delete process.env.ANTHROPIC_API_KEY
        }
        vi.restoreAllMocks()
    })

    it("throws error when game directory does not exist", async () => {
        const enoent = new Error("ENOENT: no such file or directory") as NodeJS.ErrnoException
        enoent.code = "ENOENT"
        vi.mocked(stat).mockRejectedValue(enoent)

        await expect(runAgentCommand("nonexistent-game", { resume: false })).rejects.toThrow(CrucibleError)
        await expect(runAgentCommand("nonexistent-game", { resume: false })).rejects.toThrow(
            /Game directory not found/,
        )
    })

    it("throws error when ANTHROPIC_API_KEY is not set", async () => {
        delete process.env.ANTHROPIC_API_KEY
        vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as any)

        await expect(runAgentCommand("my-game", { resume: false })).rejects.toThrow(CrucibleError)
        await expect(runAgentCommand("my-game", { resume: false })).rejects.toThrow(
            /Anthropic API key not found/,
        )
    })

    it("creates a new session when --resume is not used", async () => {
        process.env.ANTHROPIC_API_KEY = "test-key"
        vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as any)

        // We need to abort after context assembly to avoid the readline loop.
        // Make assembleContext throw to bail out after session creation.
        vi.mocked(assembleContext).mockRejectedValue(new Error("bail-out-for-test"))

        await expect(runAgentCommand("my-game", { resume: false })).rejects.toThrow("bail-out-for-test")

        expect(createSession).toHaveBeenCalledWith("my-game", expect.stringContaining("my-game"))
        expect(findLatestSession).not.toHaveBeenCalled()
    })

    it("attempts to find latest session when --resume is used", async () => {
        process.env.ANTHROPIC_API_KEY = "test-key"
        vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as any)
        vi.mocked(findLatestSession).mockResolvedValue(mockSession)

        // Bail out after session resolution
        vi.mocked(assembleContext).mockRejectedValue(new Error("bail-out-for-test"))

        await expect(runAgentCommand("my-game", { resume: true })).rejects.toThrow("bail-out-for-test")

        expect(findLatestSession).toHaveBeenCalledWith("my-game")
        // Should NOT call createSession since we found an existing session
        expect(createSession).not.toHaveBeenCalled()
    })

    it("creates a new session when --resume is used but no session exists", async () => {
        process.env.ANTHROPIC_API_KEY = "test-key"
        vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as any)
        vi.mocked(findLatestSession).mockResolvedValue(null)

        vi.mocked(assembleContext).mockRejectedValue(new Error("bail-out-for-test"))

        await expect(runAgentCommand("my-game", { resume: true })).rejects.toThrow("bail-out-for-test")

        expect(findLatestSession).toHaveBeenCalledWith("my-game")
        expect(createSession).toHaveBeenCalledWith("my-game", expect.stringContaining("my-game"))
    })
})
