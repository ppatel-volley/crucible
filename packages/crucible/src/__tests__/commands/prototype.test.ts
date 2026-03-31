import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Command } from "commander"
import { registerPrototypeCommand, runPrototypeCommand } from "../../commands/prototype.js"
import type { CrucibleConfig, CruciblePaths } from "../../types.js"
import { CrucibleError } from "../../util/errors.js"

// Mock all external dependencies
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
    writeFile: vi.fn(),
    rm: vi.fn(),
}))

vi.mock("execa", () => ({
    execa: vi.fn(),
}))

import { resolvePaths } from "../../config/paths.js"
import { loadConfig } from "../../config/config.js"
import { createLogger } from "../../util/logger.js"
import { stat } from "node:fs/promises"
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

describe("registerPrototypeCommand", () => {
    it("registers with correct name and options", () => {
        const program = new Command()
        registerPrototypeCommand(program)

        const cmd = program.commands.find((c) => c.name() === "prototype")
        expect(cmd).toBeDefined()
        expect(cmd!.description()).toBe("Deploy game to Kubernetes via Bifrost for prototype testing")

        const sourceOpt = cmd!.options.find((o) => o.long === "--source")
        expect(sourceOpt).toBeDefined()

        const watchOpt = cmd!.options.find((o) => o.long === "--watch")
        expect(watchOpt).toBeDefined()

        const depsOpt = cmd!.options.find((o) => o.long === "--dependencies")
        expect(depsOpt).toBeDefined()

        const deleteOpt = cmd!.options.find((o) => o.long === "--delete")
        expect(deleteOpt).toBeDefined()

        const registryOpt = cmd!.options.find((o) => o.long === "--registry")
        expect(registryOpt).toBeDefined()

        const portOpt = cmd!.options.find((o) => o.long === "--port")
        expect(portOpt).toBeDefined()
    })
})

describe("runPrototypeCommand", () => {
    beforeEach(() => {
        setupMocks()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it("throws CRUCIBLE-301 when game does not exist", async () => {
        vi.mocked(stat).mockRejectedValue(new Error("ENOENT: no such file or directory"))

        await expect(
            runPrototypeCommand("nonexistent-game", {
                watch: false,
                delete: false,
                registry: "bifrost-registry.volley-services.net",
                port: 3000,
            }),
        ).rejects.toThrow(CrucibleError)

        await expect(
            runPrototypeCommand("nonexistent-game", {
                watch: false,
                delete: false,
                registry: "bifrost-registry.volley-services.net",
                port: 3000,
            }),
        ).rejects.toThrow(/Game "nonexistent-game" not found/)
    })

    it("--delete calls kubectl delete gameprototype", async () => {
        vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as any)
        vi.mocked(execa).mockResolvedValue({} as any)

        await runPrototypeCommand("my-game", {
            watch: false,
            delete: true,
            registry: "bifrost-registry.volley-services.net",
            port: 3000,
        })

        expect(execa).toHaveBeenCalledWith("kubectl", [
            "delete",
            "gameprototype",
            "my-game",
            "--ignore-not-found",
        ])
    })

    it("--delete throws CRUCIBLE-901 on kubectl failure", async () => {
        vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as any)
        vi.mocked(execa).mockRejectedValue(new Error("kubectl not found"))

        await expect(
            runPrototypeCommand("my-game", {
                watch: false,
                delete: true,
                registry: "bifrost-registry.volley-services.net",
                port: 3000,
            }),
        ).rejects.toThrow(CrucibleError)

        try {
            vi.mocked(execa).mockRejectedValue(new Error("kubectl not found"))
            await runPrototypeCommand("my-game", {
                watch: false,
                delete: true,
                registry: "bifrost-registry.volley-services.net",
                port: 3000,
            })
        } catch (err) {
            expect(err).toBeInstanceOf(CrucibleError)
            expect((err as CrucibleError).code).toBe("CRUCIBLE-901")
        }
    })

    it("deploy flow checks kubectl access then applies CRD", async () => {
        vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as any)

        // Mock kubectl cluster-info (access check)
        const mockExeca = vi.mocked(execa)
        mockExeca
            .mockResolvedValueOnce({} as any) // cluster-info
            .mockResolvedValueOnce({ stdout: "https://github.com/Volley-Inc/crucible-game-my-game.git" } as any) // git remote get-url
            .mockResolvedValueOnce({} as any) // kubectl apply
            .mockResolvedValueOnce({ stdout: "Running,my-game.my-game-prototype.svc.cluster.local," } as any) // kubectl get (poll)
            .mockResolvedValueOnce({ stdout: JSON.stringify({ status: { phase: "Running", hostname: "my-game.my-game-prototype.svc.cluster.local", dependencies: {} } }) } as any) // kubectl get (full)

        await runPrototypeCommand("my-game", {
            watch: false,
            delete: false,
            registry: "bifrost-registry.volley-services.net",
            port: 3000,
        })

        // Verify kubectl cluster-info was called (access check)
        expect(mockExeca).toHaveBeenCalledWith("kubectl", ["cluster-info", "--request-timeout=5s"])

        // Verify kubectl apply was called
        expect(mockExeca).toHaveBeenCalledWith("kubectl", expect.arrayContaining(["apply", "-f"]))
    })

    it("deploy flow throws CRUCIBLE-904 when kubectl not available", async () => {
        vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as any)
        vi.mocked(execa).mockRejectedValue(new Error("kubectl not found"))

        await expect(
            runPrototypeCommand("my-game", {
                watch: false,
                delete: false,
                registry: "bifrost-registry.volley-services.net",
                port: 3000,
            }),
        ).rejects.toThrow(/Cannot connect to Kubernetes cluster/)
    })

    it("parses --dependencies, --registry, --port options correctly", () => {
        const program = new Command()
        registerPrototypeCommand(program)

        const cmd = program.commands.find((c) => c.name() === "prototype")!

        // Verify registry default
        const registryOpt = cmd.options.find((o) => o.long === "--registry")
        expect(registryOpt!.defaultValue).toBe("bifrost-registry.volley-services.net")

        // Verify port default
        const portOpt = cmd.options.find((o) => o.long === "--port")
        expect(portOpt!.defaultValue).toBe(3000)

        // Verify dependencies is optional (not mandatory) but requires a value when used
        const depsOpt = cmd.options.find((o) => o.long === "--dependencies")
        expect(depsOpt!.optional).toBeFalsy()
        expect(depsOpt!.mandatory).toBeFalsy()
    })
})
