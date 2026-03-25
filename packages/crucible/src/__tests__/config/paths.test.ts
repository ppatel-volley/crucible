import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { join } from "node:path"
import { resolvePaths, _resetEnsuredDirs } from "../../config/paths.js"

describe("resolvePaths", () => {
    const originalPlatform = process.platform
    const originalEnv = { ...process.env }

    beforeEach(() => {
        _resetEnsuredDirs()
    })

    afterEach(() => {
        Object.defineProperty(process, "platform", { value: originalPlatform })
        process.env = { ...originalEnv }
    })

    describe("Linux/macOS defaults", () => {
        it("uses XDG defaults when no env vars set", () => {
            Object.defineProperty(process, "platform", { value: "linux" })
            delete process.env.XDG_CONFIG_HOME
            delete process.env.XDG_DATA_HOME

            const home = require("node:os").homedir()
            const paths = resolvePaths()

            expect(paths.configDir).toBe(join(home, ".config", "crucible"))
            expect(paths.configFile).toBe(join(home, ".config", "crucible", "config.json"))
            expect(paths.dataDir).toBe(join(home, ".local", "share", "crucible"))
            expect(paths.gamesDir).toBe(join(home, "crucible-games"))
            expect(paths.sessionsDir).toBe(join(home, ".local", "share", "crucible", "sessions"))
        })

        it("respects XDG_CONFIG_HOME", () => {
            Object.defineProperty(process, "platform", { value: "linux" })
            process.env.XDG_CONFIG_HOME = "/custom/config"

            const paths = resolvePaths()
            expect(paths.configDir).toBe(join("/custom/config", "crucible"))
        })

        it("respects XDG_DATA_HOME", () => {
            Object.defineProperty(process, "platform", { value: "linux" })
            process.env.XDG_DATA_HOME = "/custom/data"

            const paths = resolvePaths()
            expect(paths.dataDir).toBe(join("/custom/data", "crucible"))
            expect(paths.sessionsDir).toBe(join("/custom/data", "crucible", "sessions"))
        })
    })

    describe("Windows", () => {
        it("uses APPDATA and LOCALAPPDATA", () => {
            Object.defineProperty(process, "platform", { value: "win32" })
            process.env.APPDATA = "C:\\Users\\test\\AppData\\Roaming"
            process.env.LOCALAPPDATA = "C:\\Users\\test\\AppData\\Local"

            const paths = resolvePaths()

            expect(paths.configDir).toBe(join("C:\\Users\\test\\AppData\\Roaming", "crucible"))
            expect(paths.dataDir).toBe(join("C:\\Users\\test\\AppData\\Local", "crucible"))
        })
    })

    describe("overrides", () => {
        it("allows partial overrides", () => {
            const paths = resolvePaths({
                configDir: "/override/config",
                gamesDir: "/override/games",
            })

            expect(paths.configDir).toBe("/override/config")
            expect(paths.configFile).toBe(join("/override/config", "config.json"))
            expect(paths.gamesDir).toBe("/override/games")
        })

        it("allows configFile override independent of configDir", () => {
            const paths = resolvePaths({
                configFile: "/specific/path/my-config.json",
            })

            expect(paths.configFile).toBe("/specific/path/my-config.json")
        })
    })
})
