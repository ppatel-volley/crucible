import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { mkdir, writeFile, readFile, readdir, stat, rm } from "node:fs/promises"
import { join, extname } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { cloneTemplate, replaceTokens, removeTemplateArtifacts } from "../../template/engine.js"
import { buildTokenMap } from "../../template/tokens.js"
import { generateCrucibleJson } from "../../template/crucible-json.js"
import { executeCreate } from "../../commands/create.js"
import type { CrucibleConfig, CruciblePaths, Logger } from "../../types.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
    return join(tmpdir(), `crucible-e2e-${randomUUID()}`)
}

function createSilentLogger(): Logger {
    return {
        debug() {},
        info() {},
        warn() {},
        error() {},
        success() {},
        fail() {},
        spinner() {
            return { succeed() {}, fail() {}, update() {}, stop() {} }
        },
    }
}

function createTestConfig(templatePath: string, gamesDir?: string): CrucibleConfig {
    return {
        userEmail: "test@volley.com",
        defaultEnvironment: "dev",
        githubOrg: "ppatel-volley",
        registryApiUrls: {},
        agentModel: "claude-sonnet-4-20250514",
        gamesDir: gamesDir ?? null,
        templateSource: { type: "local", path: templatePath },
    }
}

function createTestPaths(gamesDir: string): CruciblePaths {
    return {
        configDir: join(tmpdir(), "crucible-config-e2e"),
        configFile: join(tmpdir(), "crucible-config-e2e", "config.json"),
        dataDir: join(tmpdir(), "crucible-data-e2e"),
        gamesDir,
        sessionsDir: join(tmpdir(), "crucible-sessions-e2e"),
    }
}

/** Recursively walk a directory and return all file paths. */
async function walkDir(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true })
    const files: string[] = []
    for (const entry of entries) {
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
            files.push(...(await walkDir(fullPath)))
        } else {
            files.push(fullPath)
        }
    }
    return files
}

/**
 * Scaffold a minimal hello-weekend template in the given directory.
 * Produces files that mirror the real template enough to exercise
 * cloning, token replacement, and artefact removal.
 */
async function scaffoldMinimalTemplate(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true })

    // Root package.json
    await writeFile(
        join(dir, "package.json"),
        JSON.stringify(
            {
                name: "hello-weekend",
                private: true,
                workspaces: ["apps/*", "packages/*"],
                devDependencies: { "@hello-weekend/shared": "workspace:*" },
            },
            null,
            2,
        ) + "\n",
    )

    // Server source
    const serverSrc = join(dir, "apps", "server", "src")
    await mkdir(serverSrc, { recursive: true })
    await writeFile(
        join(serverSrc, "index.ts"),
        [
            'import { HelloWeekendState } from "@hello-weekend/shared";',
            "",
            "export class HelloWeekendServer {",
            '  readonly name = "hello-weekend";',
            "  start() { console.log('hello-weekend server running'); }",
            "}",
            "",
        ].join("\n"),
    )

    // Server package.json
    await writeFile(
        join(dir, "apps", "server", "package.json"),
        JSON.stringify(
            { name: "@hello-weekend/server", version: "0.1.0" },
            null,
            2,
        ) + "\n",
    )

    // Shared types
    const sharedSrc = join(dir, "packages", "shared", "src")
    await mkdir(sharedSrc, { recursive: true })
    await writeFile(
        join(sharedSrc, "types.ts"),
        [
            "export interface HelloWeekendState {",
            "  gameId: string;",
            "  hello-weekend: boolean;",
            "}",
            "",
        ].join("\n"),
    )

    // Template artefacts
    await writeFile(join(dir, "AGENTS.md"), "# Agents\n")
    await writeFile(join(dir, "CLAUDE.md"), "# Claude\n")
    await writeFile(join(dir, "README.md"), "# hello-weekend template\n")

    const claudeDir = join(dir, ".claude")
    await mkdir(claudeDir, { recursive: true })
    await writeFile(join(claudeDir, "settings.json"), "{}\n")

    // Fake .git directory (should be excluded during clone)
    const gitDir = join(dir, ".git")
    await mkdir(gitDir, { recursive: true })
    await writeFile(join(gitDir, "config"), "[core]\n\tbare = false\n")
}

// ---------------------------------------------------------------------------
// Test 1: Template cloning from local source
// ---------------------------------------------------------------------------
describe("e2e: template cloning from local source", () => {
    let templateDir: string
    let targetDir: string

    beforeEach(async () => {
        templateDir = makeTmpDir()
        targetDir = makeTmpDir()
        await scaffoldMinimalTemplate(templateDir)
    })

    afterEach(async () => {
        await rm(templateDir, { recursive: true, force: true })
        await rm(targetDir, { recursive: true, force: true })
    })

    it("copies files and excludes .git and node_modules", async () => {
        // Also add a node_modules dir to ensure exclusion
        const nm = join(templateDir, "node_modules", "some-pkg")
        await mkdir(nm, { recursive: true })
        await writeFile(join(nm, "index.js"), "module.exports = {}")

        await cloneTemplate({ type: "local", path: templateDir }, targetDir)

        // Source files should exist
        const pkg = await readFile(join(targetDir, "package.json"), "utf-8")
        expect(pkg).toContain("hello-weekend")

        const serverIndex = await readFile(
            join(targetDir, "apps", "server", "src", "index.ts"),
            "utf-8",
        )
        expect(serverIndex).toContain("HelloWeekendServer")

        // .git must NOT be copied
        await expect(stat(join(targetDir, ".git"))).rejects.toThrow()

        // node_modules must NOT be copied
        await expect(stat(join(targetDir, "node_modules"))).rejects.toThrow()
    })
})

// ---------------------------------------------------------------------------
// Test 2: Token replacement removes all template references
// ---------------------------------------------------------------------------
describe("e2e: token replacement removes all template references", () => {
    let targetDir: string

    beforeEach(async () => {
        targetDir = makeTmpDir()
        await scaffoldMinimalTemplate(targetDir)
        // Remove .git so it doesn't interfere with walking
        await rm(join(targetDir, ".git"), { recursive: true, force: true })
    })

    afterEach(async () => {
        await rm(targetDir, { recursive: true, force: true })
    })

    it("replaces all hello-weekend / HelloWeekend / @hello-weekend references", async () => {
        const tokenMap = buildTokenMap("My Test Game")
        await replaceTokens({ targetPath: targetDir, tokenMap })

        const TEXT_EXTS = new Set([".ts", ".tsx", ".json", ".yaml", ".yml", ".md", ".sh"])
        const allFiles = await walkDir(targetDir)

        for (const filePath of allFiles) {
            const ext = extname(filePath).toLowerCase()
            if (!TEXT_EXTS.has(ext)) continue

            const content = await readFile(filePath, "utf-8")
            expect(content, `${filePath} still has hello-weekend`).not.toContain("hello-weekend")
            expect(content, `${filePath} still has HelloWeekend`).not.toContain("HelloWeekend")
            expect(content, `${filePath} still has @hello-weekend`).not.toContain("@hello-weekend")
        }

        // Verify new names appear
        const rootPkg = await readFile(join(targetDir, "package.json"), "utf-8")
        expect(rootPkg).toContain("my-test-game")

        const serverIndex = await readFile(
            join(targetDir, "apps", "server", "src", "index.ts"),
            "utf-8",
        )
        expect(serverIndex).toContain("MyTestGame")
        expect(serverIndex).toContain("@my-test-game")

        const serverPkg = await readFile(
            join(targetDir, "apps", "server", "package.json"),
            "utf-8",
        )
        expect(serverPkg).toContain("@my-test-game")
    })
})

// ---------------------------------------------------------------------------
// Test 3: Template artefact removal
// ---------------------------------------------------------------------------
describe("e2e: template artefact removal", () => {
    let targetDir: string

    beforeEach(async () => {
        targetDir = makeTmpDir()
        await scaffoldMinimalTemplate(targetDir)
        // Remove .git so it doesn't interfere
        await rm(join(targetDir, ".git"), { recursive: true, force: true })
    })

    afterEach(async () => {
        await rm(targetDir, { recursive: true, force: true })
    })

    it("removes AGENTS.md, CLAUDE.md, README.md, .claude/ but keeps game source", async () => {
        const removed = await removeTemplateArtifacts(targetDir)

        // Artefacts are gone
        expect(removed).toContain("AGENTS.md")
        expect(removed).toContain("CLAUDE.md")
        expect(removed).toContain("README.md")
        expect(removed).toContain(".claude")

        await expect(stat(join(targetDir, "AGENTS.md"))).rejects.toThrow()
        await expect(stat(join(targetDir, "CLAUDE.md"))).rejects.toThrow()
        await expect(stat(join(targetDir, "README.md"))).rejects.toThrow()
        await expect(stat(join(targetDir, ".claude"))).rejects.toThrow()

        // Game source still present
        const serverIndex = await readFile(
            join(targetDir, "apps", "server", "src", "index.ts"),
            "utf-8",
        )
        expect(serverIndex).toContain("HelloWeekendServer")

        const sharedTypes = await readFile(
            join(targetDir, "packages", "shared", "src", "types.ts"),
            "utf-8",
        )
        expect(sharedTypes).toContain("HelloWeekendState")
    })
})

// ---------------------------------------------------------------------------
// Test 4: crucible.json generation is valid
// ---------------------------------------------------------------------------
describe("e2e: crucible.json generation", () => {
    it("produces valid JSON with required fields and 64-char hex checksums", () => {
        const tokenMap = buildTokenMap("My Test Game")

        const result = generateCrucibleJson({
            tokenMap,
            author: "test@volley.com",
            description: "A wee test game",
            dockerfileChecksum: "a".repeat(64),
            ciWorkflowChecksum: "b".repeat(64),
            templateVersion: "0.1.0",
        })

        // Parses as valid JSON
        const parsed = JSON.parse(result.content)

        // Required fields
        expect(parsed.name).toBe("my-test-game")
        expect(parsed.displayName).toBe("My Test Game")
        expect(parsed.gameId).toBe("my-test-game")
        expect(parsed.version).toBe("0.1.0")
        expect(parsed.checksums).toBeDefined()

        // Checksums are 64-char hex
        expect(parsed.checksums.dockerfile).toMatch(/^[a-f0-9]{64}$/)
        expect(parsed.checksums.ciWorkflow).toMatch(/^[a-f0-9]{64}$/)

        // Generated file metadata
        expect(result.path).toBe("crucible.json")
        expect(result.checksum).toMatch(/^[a-f0-9]{64}$/)
    })
})

// ---------------------------------------------------------------------------
// Test 5: Full create flow (mocked GitHub)
// ---------------------------------------------------------------------------
vi.mock("../../api/index.js", () => ({
    getGitHubToken: vi.fn(() => "fake-gh-token"),
    createGitHubClient: vi.fn(() => ({})),
    createGameRepo: vi.fn(async () => ({
        cloneUrl: "https://github.com/ppatel-volley/crucible-game-my-test-game.git",
        htmlUrl: "https://github.com/ppatel-volley/crucible-game-my-test-game",
        fullName: "ppatel-volley/crucible-game-my-test-game",
    })),
    deleteGameRepo: vi.fn(async () => {}),
}))

vi.mock("../../git/index.js", () => ({
    createGitOperations: vi.fn(() => ({
        init: vi.fn(async () => {}),
        add: vi.fn(async () => {}),
        commit: vi.fn(async () => "abc123"),
        push: vi.fn(async () => {}),
        addRemote: vi.fn(async () => {}),
        getHeadSha: vi.fn(async () => "abc123"),
        isClean: vi.fn(async () => true),
        hasRemote: vi.fn(async () => false),
    })),
}))

describe("e2e: full create flow with mocked GitHub", () => {
    let tmpDir: string
    let templateDir: string
    let gamesDir: string

    beforeEach(async () => {
        tmpDir = makeTmpDir()
        templateDir = join(tmpDir, "template")
        gamesDir = join(tmpDir, "games")
        await mkdir(gamesDir, { recursive: true })
        await scaffoldMinimalTemplate(templateDir)
        // Remove .git from template so clone doesn't trip over it unexpectedly
        await rm(join(templateDir, ".git"), { recursive: true, force: true })
    })

    afterEach(async () => {
        await rm(tmpDir, { recursive: true, force: true })
    })

    it("creates a complete game directory with all generated files", async () => {
        const logger = createSilentLogger()
        const config = createTestConfig(templateDir, gamesDir)
        const paths = createTestPaths(gamesDir)

        const result = await executeCreate(
            {
                displayName: "My Test Game",
                description: "A fine wee test game",
                skipGithub: true,
                skipInstall: true,
            },
            config,
            paths,
            logger,
        )

        expect(result.gameId).toBe("my-test-game")

        const gamePath = result.gamePath

        // Game directory created at expected path
        const dirStat = await stat(gamePath)
        expect(dirStat.isDirectory()).toBe(true)
        expect(gamePath).toBe(join(gamesDir, "my-test-game"))

        // Token replacement completed — no hello-weekend references
        const TEXT_EXTS = new Set([".ts", ".tsx", ".json", ".yaml", ".yml", ".md", ".sh"])
        const allFiles = await walkDir(gamePath)
        for (const filePath of allFiles) {
            const ext = extname(filePath).toLowerCase()
            if (!TEXT_EXTS.has(ext)) continue
            if (filePath.endsWith("crucible.json")) continue // template field is intentional
            const content = await readFile(filePath, "utf-8")
            expect(content, `${filePath} still has hello-weekend`).not.toContain("hello-weekend")
            expect(content, `${filePath} still has HelloWeekend`).not.toContain("HelloWeekend")
            expect(content, `${filePath} still has @hello-weekend`).not.toContain("@hello-weekend")
        }

        // crucible.json exists and is valid
        const crucibleRaw = await readFile(join(gamePath, "crucible.json"), "utf-8")
        const crucible = JSON.parse(crucibleRaw)
        expect(crucible.name).toBe("my-test-game")
        expect(crucible.displayName).toBe("My Test Game")
        expect(crucible.checksums.dockerfile).toMatch(/^[a-f0-9]{64}$/)
        expect(crucible.checksums.ciWorkflow).toMatch(/^[a-f0-9]{64}$/)

        // Dockerfile exists
        const dockerfile = await readFile(join(gamePath, "Dockerfile"), "utf-8")
        expect(dockerfile.length).toBeGreaterThan(0)

        // Template artefacts removed
        await expect(stat(join(gamePath, "AGENTS.md"))).rejects.toThrow()
        await expect(stat(join(gamePath, "CLAUDE.md"))).rejects.toThrow()
    })
})

// ---------------------------------------------------------------------------
// Test 6: Nested node_modules excluded from template clone
// ---------------------------------------------------------------------------
describe("e2e: nested node_modules excluded from template clone", () => {
    let templateDir: string
    let targetDir: string

    beforeEach(async () => {
        templateDir = makeTmpDir()
        targetDir = makeTmpDir()
        await scaffoldMinimalTemplate(templateDir)

        // Add nested node_modules inside apps/controller
        const controllerDir = join(templateDir, "apps", "controller")
        const nestedNm = join(controllerDir, "node_modules", "some-dep")
        await mkdir(nestedNm, { recursive: true })
        await writeFile(join(nestedNm, "index.js"), "module.exports = {}")
        await writeFile(join(controllerDir, "index.ts"), "export default {}")
    })

    afterEach(async () => {
        await rm(templateDir, { recursive: true, force: true })
        await rm(targetDir, { recursive: true, force: true })
    })

    it("excludes apps/controller/node_modules but keeps apps/controller/", async () => {
        await cloneTemplate({ type: "local", path: templateDir }, targetDir)

        // apps/controller/ should exist
        const controllerStat = await stat(join(targetDir, "apps", "controller"))
        expect(controllerStat.isDirectory()).toBe(true)

        // apps/controller/index.ts should exist
        const indexContent = await readFile(
            join(targetDir, "apps", "controller", "index.ts"),
            "utf-8",
        )
        expect(indexContent).toContain("export default")

        // apps/controller/node_modules should NOT exist
        await expect(
            stat(join(targetDir, "apps", "controller", "node_modules")),
        ).rejects.toThrow()
    })
})
