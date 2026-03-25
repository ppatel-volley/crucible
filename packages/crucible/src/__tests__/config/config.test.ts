import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { CruciblePaths } from "../../types.js"
import { loadConfig, saveConfig, updateConfig } from "../../config/config.js"
import { DEFAULT_CONFIG } from "../../config/schema.js"
import { _resetEnsuredDirs } from "../../config/paths.js"

function makePaths(dir: string): CruciblePaths {
    return {
        configDir: dir,
        configFile: join(dir, "config.json"),
        dataDir: join(dir, "data"),
        gamesDir: join(dir, "games"),
        sessionsDir: join(dir, "data", "sessions"),
    }
}

describe("config read/write", () => {
    let tempDir: string
    let paths: CruciblePaths

    beforeEach(async () => {
        _resetEnsuredDirs()
        tempDir = await mkdtemp(join(tmpdir(), "crucible-test-"))
        paths = makePaths(tempDir)
    })

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true })
    })

    it("loadConfig returns defaults when file is missing", async () => {
        const config = await loadConfig(paths)
        expect(config).toEqual(DEFAULT_CONFIG)
    })

    it("saveConfig + loadConfig roundtrip", async () => {
        const custom = { ...DEFAULT_CONFIG, githubOrg: "my-org", defaultEnvironment: "prod" as const }
        await saveConfig(paths, custom)
        const loaded = await loadConfig(paths)
        expect(loaded).toEqual(custom)
    })

    it("updateConfig merges partial updates", async () => {
        await saveConfig(paths, DEFAULT_CONFIG)
        const updated = await updateConfig(paths, { githubOrg: "new-org" })
        expect(updated.githubOrg).toBe("new-org")
        expect(updated.defaultEnvironment).toBe(DEFAULT_CONFIG.defaultEnvironment)

        const reloaded = await loadConfig(paths)
        expect(reloaded.githubOrg).toBe("new-org")
    })

    it("updateConfig works on missing file (starts from defaults)", async () => {
        const updated = await updateConfig(paths, { agentModel: "claude-opus-4-20250514" })
        expect(updated.agentModel).toBe("claude-opus-4-20250514")
        expect(updated.githubOrg).toBe(DEFAULT_CONFIG.githubOrg)
    })
})
