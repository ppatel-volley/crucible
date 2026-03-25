import { describe, it, expect } from "vitest"
import { validateConfig, DEFAULT_CONFIG, CrucibleConfigSchema } from "../../config/schema.js"

describe("CrucibleConfigSchema", () => {
    it("accepts a valid config", () => {
        const config = validateConfig(DEFAULT_CONFIG)
        expect(config).toEqual(DEFAULT_CONFIG)
    })

    it("accepts config with github template source", () => {
        const data = {
            ...DEFAULT_CONFIG,
            templateSource: { type: "github", repo: "org/repo", ref: "v1.0" },
        }
        const config = validateConfig(data)
        expect(config.templateSource).toEqual({ type: "github", repo: "org/repo", ref: "v1.0" })
    })

    it("accepts config with local template source", () => {
        const data = {
            ...DEFAULT_CONFIG,
            templateSource: { type: "local", path: "/some/path" },
        }
        const config = validateConfig(data)
        expect(config.templateSource).toEqual({ type: "local", path: "/some/path" })
    })

    it("rejects invalid defaultEnvironment", () => {
        const data = { ...DEFAULT_CONFIG, defaultEnvironment: "invalid" }
        expect(() => validateConfig(data)).toThrow()
    })

    it("rejects missing required fields", () => {
        expect(() => validateConfig({})).toThrow()
    })

    it("rejects invalid templateSource type", () => {
        const data = { ...DEFAULT_CONFIG, templateSource: { type: "ftp", url: "x" } }
        expect(() => validateConfig(data)).toThrow()
    })
})

describe("DEFAULT_CONFIG", () => {
    it("has sensible defaults", () => {
        expect(DEFAULT_CONFIG.githubOrg).toBe("Volley-Inc")
        expect(DEFAULT_CONFIG.defaultEnvironment).toBe("dev")
        expect(DEFAULT_CONFIG.userEmail).toBeNull()
        expect(DEFAULT_CONFIG.gamesDir).toBeNull()
        expect(DEFAULT_CONFIG.templateSource.type).toBe("github")
    })
})
