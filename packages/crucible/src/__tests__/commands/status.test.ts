import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Command } from "commander"
import { registerStatusCommand, runStatusCommand, getBifrostStatus } from "../../commands/status.js"
import type { CrucibleConfig, CruciblePaths } from "../../types.js"

// Mock all external dependencies
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

vi.mock("execa", () => ({
    execa: vi.fn(),
}))

import { resolvePaths } from "../../config/paths.js"
import { loadConfig } from "../../config/config.js"
import { readdir, readFile } from "node:fs/promises"
import { execa } from "execa"

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

describe("registerStatusCommand", () => {
    it("registers with correct name, optional game-id, and --env option", () => {
        const program = new Command()
        registerStatusCommand(program)

        const cmd = program.commands.find((c) => c.name() === "status")
        expect(cmd).toBeDefined()
        expect(cmd!.description()).toBe("Check game status across environments")

        const envOpt = cmd!.options.find((o) => o.long === "--env")
        expect(envOpt).toBeDefined()

        // Verify game-id argument is optional (wrapped in brackets in usage)
        expect(cmd!.usage()).toContain("[game-id]")
    })
})

describe("runStatusCommand — single game", () => {
    let consoleSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        setupMocks()
        consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it("shows prototype status when GamePrototype exists and is Running", async () => {
        vi.mocked(readFile).mockResolvedValue(
            JSON.stringify({ displayName: "Scottish Trivia" }),
        )
        vi.mocked(execa).mockResolvedValue({
            stdout: JSON.stringify({
                status: {
                    phase: "Running",
                    hostname: "scottish-trivia.scottish-trivia-prototype.svc.cluster.local",
                    dependencies: {},
                },
            }),
        } as any)

        await runStatusCommand("scottish-trivia", {})

        const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n")
        expect(output).toContain("scottish-trivia")
        expect(output).toContain("Scottish Trivia")
        expect(output).toContain("Running")
        expect(output).toContain("scottish-trivia.scottish-trivia-prototype.svc.cluster.local")
    })

    it("shows 'No prototype deployed' when GamePrototype doesn't exist", async () => {
        vi.mocked(readFile).mockResolvedValue(
            JSON.stringify({ displayName: "My Game" }),
        )
        vi.mocked(execa).mockRejectedValue(new Error("not found"))

        await runStatusCommand("my-game", {})

        const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n")
        expect(output).toContain("my-game")
        expect(output).toContain("No prototype deployed")
    })

    it("shows 'Building' phase with build ref", async () => {
        vi.mocked(readFile).mockResolvedValue(
            JSON.stringify({ displayName: "My Game" }),
        )
        vi.mocked(execa).mockResolvedValue({
            stdout: JSON.stringify({
                status: {
                    phase: "Building",
                    buildRef: "my-game-build-abc12345",
                },
            }),
        } as any)

        await runStatusCommand("my-game", {})

        const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n")
        expect(output).toContain("Building")
        expect(output).toContain("Build pod: my-game-build-abc12345")
    })
})

describe("runStatusCommand — all games", () => {
    let consoleSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        setupMocks()
        consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it("lists multiple games with their prototype status", async () => {
        vi.mocked(readdir).mockResolvedValue([
            { name: "scottish-trivia", isDirectory: () => true },
            { name: "emoji-party", isDirectory: () => true },
        ] as any)

        const mockExeca = vi.mocked(execa)
        // First call: scottish-trivia — Running
        mockExeca.mockResolvedValueOnce({
            stdout: JSON.stringify({
                status: { phase: "Running", hostname: "scottish-trivia.proto.local" },
            }),
        } as any)
        // Second call: emoji-party — Failed
        mockExeca.mockResolvedValueOnce({
            stdout: JSON.stringify({
                status: { phase: "Failed" },
            }),
        } as any)

        await runStatusCommand(undefined, {})

        const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n")
        expect(output).toContain("scottish-trivia")
        expect(output).toContain("emoji-party")
        expect(output).toContain("Running")
        expect(output).toContain("Failed")
        expect(output).toContain("2 game(s) found.")
    })

    it("handles empty games directory", async () => {
        vi.mocked(readdir).mockResolvedValue([] as any)

        await runStatusCommand(undefined, {})

        const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n")
        expect(output).toContain("No games found")
    })
})

describe("getBifrostStatus", () => {
    afterEach(() => {
        vi.restoreAllMocks()
    })

    it("returns exists:true with phase when kubectl succeeds", async () => {
        vi.mocked(execa).mockResolvedValue({
            stdout: JSON.stringify({
                status: {
                    phase: "Running",
                    hostname: "test.proto.local",
                    buildRef: "build-123",
                    dependencies: { db: { type: "postgres" } },
                },
            }),
        } as any)

        const result = await getBifrostStatus("test-game")

        expect(result.exists).toBe(true)
        expect(result.phase).toBe("Running")
        expect(result.hostname).toBe("test.proto.local")
        expect(result.buildRef).toBe("build-123")
        expect(result.dependencies).toEqual({ db: { type: "postgres" } })
        expect(execa).toHaveBeenCalledWith("kubectl", [
            "get", "gameprototype", "test-game", "-o", "json",
        ])
    })

    it("returns exists:false when kubectl fails", async () => {
        vi.mocked(execa).mockRejectedValue(new Error("kubectl: not found"))

        const result = await getBifrostStatus("nonexistent-game")

        expect(result.exists).toBe(false)
        expect(result.phase).toBeUndefined()
        expect(result.hostname).toBeUndefined()
    })
})
