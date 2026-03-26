import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Command } from "commander"
import { registerPublishCommand, runPublishCommand, runPreFlightChecks } from "../../commands/publish.js"
import type { CrucibleConfig, CruciblePaths, CrucibleJson } from "../../types.js"

vi.mock("../../config/paths.js", () => ({
    resolvePaths: vi.fn(),
}))

vi.mock("../../config/config.js", () => ({
    loadConfig: vi.fn(),
}))

vi.mock("node:fs/promises", () => ({
    stat: vi.fn(),
    readFile: vi.fn(),
}))

vi.mock("../../git/operations.js", () => ({
    createGitOperations: vi.fn(),
}))

vi.mock("../../git/validation.js", () => ({
    computeFileChecksum: vi.fn(),
}))

vi.mock("../../util/logger.js", () => ({
    createLogger: vi.fn(() => ({
        spinner: vi.fn(() => ({
            succeed: vi.fn(),
            fail: vi.fn(),
            update: vi.fn(),
            stop: vi.fn(),
        })),
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        success: vi.fn(),
        fail: vi.fn(),
    })),
}))

import { resolvePaths } from "../../config/paths.js"
import { loadConfig } from "../../config/config.js"
import { stat, readFile } from "node:fs/promises"
import { createGitOperations } from "../../git/operations.js"
import { computeFileChecksum } from "../../git/validation.js"
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

const validCrucibleJson: CrucibleJson = {
    name: "my-game",
    displayName: "My Game",
    description: "A test game",
    author: "test@volley.com",
    version: "0.1.0",
    gameId: "my-game",
    tile: { imageUrl: "", heroImageUrl: "" },
    createdAt: "2026-01-01T00:00:00.000Z",
    template: "hello-weekend",
    templateVersion: "1.0.0",
    checksums: {
        dockerfile: "abc123def456abc123def456abc123def456abc123def456abc123def456abc123de",
        ciWorkflow: "fed321cba654fed321cba654fed321cba654fed321cba654fed321cba654fed321cb",
    },
}

function setupMocks(): void {
    vi.mocked(resolvePaths).mockReturnValue(mockPaths)
    vi.mocked(loadConfig).mockResolvedValue(mockConfig)
}

function setupPreFlightMocks(overrides?: {
    isClean?: boolean
    crucibleJsonRaw?: string | null
    dockerfileChecksum?: string
    hasRemote?: boolean
}): void {
    const opts = {
        isClean: true,
        crucibleJsonRaw: JSON.stringify(validCrucibleJson),
        dockerfileChecksum: validCrucibleJson.checksums.dockerfile,
        hasRemote: true,
        ...overrides,
    }

    vi.mocked(createGitOperations).mockReturnValue({
        init: vi.fn(),
        add: vi.fn(),
        commit: vi.fn(),
        push: vi.fn(),
        addRemote: vi.fn(),
        getHeadSha: vi.fn(),
        isClean: vi.fn().mockResolvedValue(opts.isClean),
        hasRemote: vi.fn().mockResolvedValue(opts.hasRemote),
    })

    if (opts.crucibleJsonRaw === null) {
        vi.mocked(readFile).mockRejectedValue(new Error("ENOENT: no such file or directory"))
    } else {
        vi.mocked(readFile).mockResolvedValue(opts.crucibleJsonRaw as any)
    }

    vi.mocked(computeFileChecksum).mockResolvedValue(opts.dockerfileChecksum)
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
        setupPreFlightMocks()

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

describe("runPreFlightChecks", () => {
    afterEach(() => {
        vi.restoreAllMocks()
    })

    it("passes when git is clean, checksums match, and remote exists", async () => {
        setupPreFlightMocks()
        await expect(runPreFlightChecks("/tmp/crucible-games/my-game")).resolves.toBeUndefined()
    })

    it("fails with CRUCIBLE-202 when git is dirty", async () => {
        setupPreFlightMocks({ isClean: false })

        try {
            await runPreFlightChecks("/tmp/crucible-games/my-game")
            expect.unreachable("Should have thrown")
        } catch (err) {
            expect(err).toBeInstanceOf(CrucibleError)
            expect((err as CrucibleError).code).toBe("CRUCIBLE-202")
            expect((err as CrucibleError).message).toContain("Uncommitted changes detected")
        }
    })

    it("fails with CRUCIBLE-801 when Dockerfile checksum doesn't match", async () => {
        setupPreFlightMocks({ dockerfileChecksum: "0000000000000000000000000000000000000000000000000000000000000000" })

        try {
            await runPreFlightChecks("/tmp/crucible-games/my-game")
            expect.unreachable("Should have thrown")
        } catch (err) {
            expect(err).toBeInstanceOf(CrucibleError)
            expect((err as CrucibleError).code).toBe("CRUCIBLE-801")
            expect((err as CrucibleError).message).toContain("Dockerfile checksum mismatch")
        }
    })

    it("fails with CRUCIBLE-200 when crucible.json is missing", async () => {
        setupPreFlightMocks({ crucibleJsonRaw: null })

        try {
            await runPreFlightChecks("/tmp/crucible-games/my-game")
            expect.unreachable("Should have thrown")
        } catch (err) {
            expect(err).toBeInstanceOf(CrucibleError)
            expect((err as CrucibleError).code).toBe("CRUCIBLE-200")
            expect((err as CrucibleError).message).toContain("Invalid or missing crucible.json")
        }
    })

    it("fails with CRUCIBLE-203 when no origin remote", async () => {
        setupPreFlightMocks({ hasRemote: false })

        try {
            await runPreFlightChecks("/tmp/crucible-games/my-game")
            expect.unreachable("Should have thrown")
        } catch (err) {
            expect(err).toBeInstanceOf(CrucibleError)
            expect((err as CrucibleError).code).toBe("CRUCIBLE-203")
            expect((err as CrucibleError).message).toContain("No GitHub remote configured")
        }
    })
})
