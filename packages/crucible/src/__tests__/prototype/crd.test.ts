import { describe, it, expect } from "vitest"
import {
    parseDependencies,
    generateGamePrototypeCRD,
    serializeGamePrototypeCRD,
} from "../../prototype/crd.js"

describe("parseDependencies", () => {
    it("parses multiple dependencies correctly", () => {
        const result = parseDependencies("scores:postgres,cache:redis")
        expect(result).toEqual({
            scores: { type: "postgres" },
            cache: { type: "redis" },
        })
    })

    it("handles a single dependency", () => {
        const result = parseDependencies("assets:s3")
        expect(result).toEqual({
            assets: { type: "s3" },
        })
    })

    it("throws on invalid dependency type", () => {
        expect(() => parseDependencies("foo:mysql")).toThrow(
            'Invalid dependency type: "mysql"',
        )
    })

    it("handles empty string and returns empty object", () => {
        const result = parseDependencies("")
        expect(result).toEqual({})
    })
})

describe("generateGamePrototypeCRD", () => {
    it("generates correct CRD with all fields", () => {
        const crd = generateGamePrototypeCRD({
            gameId: "my-game",
            imageTag: "abc123",
            registryHost: "my-registry.io",
            port: 8080,
            websocket: false,
            env: { NODE_ENV: "production", DEBUG: "true" },
            dependencies: "scores:postgres,cache:redis,assets:s3",
        })

        expect(crd).toEqual({
            apiVersion: "volley.weekend.com/v1alpha1",
            kind: "GamePrototype",
            metadata: { name: "my-game" },
            spec: {
                image: "my-registry.io/my-game:abc123",
                port: 8080,
                websocket: false,
                env: { NODE_ENV: "production", DEBUG: "true" },
                dependencies: {
                    scores: { type: "postgres" },
                    cache: { type: "redis" },
                    assets: { type: "s3" },
                },
            },
        })
    })

    it("uses defaults for port, websocket, and registry", () => {
        const crd = generateGamePrototypeCRD({
            gameId: "test-game",
            imageTag: "v1",
        })

        expect(crd.spec.image).toBe(
            "registry.prototypes.svc.cluster.local:5000/test-game:v1",
        )
        expect(crd.spec.port).toBe(3000)
        expect(crd.spec.websocket).toBe(true)
        expect(crd.spec.env).toBeUndefined()
        expect(crd.spec.dependencies).toBeUndefined()
    })

    it("includes dependencies when provided", () => {
        const crd = generateGamePrototypeCRD({
            gameId: "dep-game",
            imageTag: "latest",
            dependencies: "db:postgres",
        })

        expect(crd.spec.dependencies).toEqual({
            db: { type: "postgres" },
        })
    })
})

describe("serializeGamePrototypeCRD", () => {
    it("produces valid YAML string with all fields", () => {
        const crd = generateGamePrototypeCRD({
            gameId: "my-game",
            imageTag: "abc123",
            port: 3000,
            websocket: true,
            env: { NODE_ENV: "production" },
            dependencies: "scores:postgres,cache:redis",
        })

        const yaml = serializeGamePrototypeCRD(crd)

        expect(yaml).toContain("apiVersion: volley.weekend.com/v1alpha1")
        expect(yaml).toContain("kind: GamePrototype")
        expect(yaml).toContain("  name: my-game")
        expect(yaml).toContain(
            "  image: registry.prototypes.svc.cluster.local:5000/my-game:abc123",
        )
        expect(yaml).toContain("  port: 3000")
        expect(yaml).toContain("  websocket: true")
        expect(yaml).toContain('    NODE_ENV: "production"')
        expect(yaml).toContain("    scores:")
        expect(yaml).toContain("      type: postgres")
        expect(yaml).toContain("    cache:")
        expect(yaml).toContain("      type: redis")
    })

    it("generates source-based CRD without image field", () => {
        const crd = generateGamePrototypeCRD({
            gameId: "my-game",
            sourceUrl: "https://github.com/Volley-Inc/crucible-game-my-game.git",
            sourceRevision: "main",
        })

        expect(crd.spec.source).toEqual({
            url: "https://github.com/Volley-Inc/crucible-game-my-game.git",
            revision: "main",
        })
        expect(crd.spec.image).toBeUndefined()

        const yaml = serializeGamePrototypeCRD(crd)
        expect(yaml).toContain("  source:")
        expect(yaml).toContain("    url: https://github.com/Volley-Inc/crucible-game-my-game.git")
        expect(yaml).toContain("    revision: main")
        expect(yaml).not.toContain("  image:")
    })

    it("omits optional fields when not set", () => {
        const yaml = serializeGamePrototypeCRD({
            apiVersion: "volley.weekend.com/v1alpha1",
            kind: "GamePrototype",
            metadata: { name: "minimal-game" },
            spec: {
                image: "registry.local/minimal-game:v1",
            },
        })

        expect(yaml).toContain("apiVersion: volley.weekend.com/v1alpha1")
        expect(yaml).toContain("kind: GamePrototype")
        expect(yaml).toContain("  name: minimal-game")
        expect(yaml).toContain("  image: registry.local/minimal-game:v1")
        expect(yaml).not.toContain("port:")
        expect(yaml).not.toContain("websocket:")
        expect(yaml).not.toContain("env:")
        expect(yaml).not.toContain("dependencies:")
    })
})
