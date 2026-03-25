import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { readFile, readdir, stat, rm, mkdir, cp } from "node:fs/promises"
import { join, extname } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { executeCreate, writeGeneratedFiles } from "../../commands/create.js"
import type { CrucibleConfig, CruciblePaths, Logger, GeneratedFile } from "../../types.js"

const FIXTURE_DIR = join(__dirname, "..", "fixtures", "template-sample")

function makeTmpDir(): string {
    return join(tmpdir(), `crucible-create-test-${randomUUID()}`)
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
            return {
                succeed() {},
                fail() {},
                update() {},
                stop() {},
            }
        },
    }
}

function createTestConfig(templatePath: string): CrucibleConfig {
    return {
        userEmail: "test@volley.com",
        defaultEnvironment: "dev",
        githubOrg: "ppatel-volley",
        registryApiUrls: {},
        agentModel: "claude-sonnet-4-20250514",
        gamesDir: null,
        templateSource: { type: "local", path: templatePath },
    }
}

function createTestPaths(gamesDir: string): CruciblePaths {
    return {
        configDir: join(tmpdir(), "crucible-config-test"),
        configFile: join(tmpdir(), "crucible-config-test", "config.json"),
        dataDir: join(tmpdir(), "crucible-data-test"),
        gamesDir,
        sessionsDir: join(tmpdir(), "crucible-sessions-test"),
    }
}

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

describe("executeCreate", () => {
    let tmpDir: string
    let fixtureClone: string
    let gamesDir: string

    beforeEach(async () => {
        tmpDir = makeTmpDir()
        fixtureClone = join(tmpDir, "fixture")
        gamesDir = join(tmpDir, "games")
        await mkdir(tmpDir, { recursive: true })
        await cp(FIXTURE_DIR, fixtureClone, { recursive: true })
        await mkdir(gamesDir, { recursive: true })
    })

    afterEach(async () => {
        await rm(tmpDir, { recursive: true, force: true })
    })

    it("happy path: creates game from local template with all expected files", async () => {
        const logger = createSilentLogger()
        const config = createTestConfig(fixtureClone)
        const paths = createTestPaths(gamesDir)

        const result = await executeCreate(
            {
                displayName: "Scottish Trivia",
                description: "A trivia game about Scotland",
                skipGithub: true,
                skipInstall: true,
            },
            config,
            paths,
            logger,
        )

        expect(result.gameId).toBe("scottish-trivia")
        expect(result.gamePath).toBe(join(gamesDir, "scottish-trivia"))

        const gamePath = result.gamePath

        // Directory exists
        const dirStat = await stat(gamePath)
        expect(dirStat.isDirectory()).toBe(true)

        // crucible.json exists and is valid JSON
        const crucibleJsonRaw = await readFile(join(gamePath, "crucible.json"), "utf-8")
        const crucibleJson = JSON.parse(crucibleJsonRaw)
        expect(crucibleJson.name).toBe("scottish-trivia")
        expect(crucibleJson.displayName).toBe("Scottish Trivia")
        expect(crucibleJson.description).toBe("A trivia game about Scotland")
        expect(crucibleJson.checksums.dockerfile).toMatch(/^[a-f0-9]{64}$/)
        expect(crucibleJson.checksums.ciWorkflow).toMatch(/^[a-f0-9]{64}$/)

        // Dockerfile exists and checksum matches crucible.json
        const dockerfileContent = await readFile(join(gamePath, "Dockerfile"), "utf-8")
        expect(dockerfileContent.length).toBeGreaterThan(0)
        const { createHash } = await import("node:crypto")
        const actualDockerChecksum = createHash("sha256").update(dockerfileContent).digest("hex")
        expect(actualDockerChecksum).toBe(crucibleJson.checksums.dockerfile)

        // CI workflow exists
        const ciWorkflow = await readFile(
            join(gamePath, ".github", "workflows", "crucible-deploy.yml"),
            "utf-8",
        )
        expect(ciWorkflow.length).toBeGreaterThan(0)

        // .npmrc exists
        const npmrc = await readFile(join(gamePath, ".npmrc"), "utf-8")
        expect(npmrc).toContain("//registry.npmjs.org/:_authToken=${NPM_TOKEN}")

        // Zero hello-weekend/HelloWeekend/@hello-weekend references in any text file
        // (crucible.json is excluded — "template": "hello-weekend" is intentional metadata)
        const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".json", ".yaml", ".yml", ".md", ".sh"])
        const allFiles = await walkDir(gamePath)
        for (const filePath of allFiles) {
            const ext = extname(filePath).toLowerCase()
            if (!TEXT_EXTENSIONS.has(ext)) continue
            if (filePath.endsWith("crucible.json")) continue
            const content = await readFile(filePath, "utf-8")
            expect(content).not.toContain("hello-weekend")
            expect(content).not.toContain("HelloWeekend")
            expect(content).not.toContain("@hello-weekend")
        }

        // package.json name is kebab-case game name
        const rootPkg = JSON.parse(await readFile(join(gamePath, "package.json"), "utf-8"))
        expect(rootPkg.name).toBe("scottish-trivia")

        // Template artifacts removed
        await expect(stat(join(gamePath, "AGENTS.md"))).rejects.toThrow()
        await expect(stat(join(gamePath, "learnings"))).rejects.toThrow()
    })

    it("throws CRUCIBLE-202 when target directory already exists", async () => {
        const logger = createSilentLogger()
        const config = createTestConfig(fixtureClone)
        const paths = createTestPaths(gamesDir)

        // Pre-create the target directory
        await mkdir(join(gamesDir, "scottish-trivia"), { recursive: true })

        await expect(
            executeCreate(
                {
                    displayName: "Scottish Trivia",
                    skipGithub: true,
                    skipInstall: true,
                },
                config,
                paths,
                logger,
            ),
        ).rejects.toThrow(/CRUCIBLE-202|already exists/)
    })

    it("throws validation error for invalid name", async () => {
        const logger = createSilentLogger()
        const config = createTestConfig(fixtureClone)
        const paths = createTestPaths(gamesDir)

        // "!!!" produces empty kebab
        await expect(
            executeCreate(
                {
                    displayName: "!!!",
                    skipGithub: true,
                    skipInstall: true,
                },
                config,
                paths,
                logger,
            ),
        ).rejects.toThrow(/CRUCIBLE-200|Invalid game name/)

        // "a" produces single char kebab which is < 3
        await expect(
            executeCreate(
                {
                    displayName: "a",
                    skipGithub: true,
                    skipInstall: true,
                },
                config,
                paths,
                logger,
            ),
        ).rejects.toThrow(/CRUCIBLE-200|Invalid game name/)
    })

    it("rolls back directory on template clone failure", async () => {
        const logger = createSilentLogger()
        // Point to a non-existent template source to trigger failure
        const config = createTestConfig(join(tmpDir, "non-existent-template"))
        const paths = createTestPaths(gamesDir)

        const gamePath = join(gamesDir, "rollback-game")

        await expect(
            executeCreate(
                {
                    displayName: "Rollback Game",
                    skipGithub: true,
                    skipInstall: true,
                },
                config,
                paths,
                logger,
            ),
        ).rejects.toThrow()

        // Verify the directory was cleaned up
        const exists = await stat(gamePath).then(() => true).catch(() => false)
        expect(exists).toBe(false)
    })
})

describe("writeGeneratedFiles", () => {
    let tmpDir: string

    beforeEach(async () => {
        tmpDir = makeTmpDir()
        await mkdir(tmpDir, { recursive: true })
    })

    afterEach(async () => {
        await rm(tmpDir, { recursive: true, force: true })
    })

    it("writes files and creates parent directories", async () => {
        const files: GeneratedFile[] = [
            { path: "Dockerfile", content: "FROM node:22\n", checksum: "abc" },
            { path: ".github/workflows/ci.yml", content: "name: CI\n", checksum: "def" },
        ]

        await writeGeneratedFiles(tmpDir, files)

        const dockerfile = await readFile(join(tmpDir, "Dockerfile"), "utf-8")
        expect(dockerfile).toBe("FROM node:22\n")

        const ci = await readFile(join(tmpDir, ".github", "workflows", "ci.yml"), "utf-8")
        expect(ci).toBe("name: CI\n")
    })
})
