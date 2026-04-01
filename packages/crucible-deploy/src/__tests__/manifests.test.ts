import { describe, it, expect } from "vitest"
import { renderManifests, renderIrsaTemplate } from "../lib/manifests.js"
import { validateGameId } from "../lib/constants.js"
import type { ManifestContext } from "../types.js"

const baseCtx: ManifestContext = {
    gameId: "scottish-trivia",
    env: "dev",
    namespace: "crucible-dev",
    image: "375633680607.dkr.ecr.us-east-1.amazonaws.com/crucible-games:scottish-trivia-abc123-42",
    accountId: "375633680607",
    oidcProvider: "oidc.eks.us-east-1.amazonaws.com/id/TEST123",
}

describe("renderManifests", () => {
    it("produces valid multi-document YAML", () => {
        const result = renderManifests(baseCtx)
        const docs = result.split("---")
        // ServiceAccount, Deployment, Service, Ingress, ScaledObject, NetworkPolicy
        expect(docs).toHaveLength(6)
    })

    it("includes the game ID in all resources", () => {
        const result = renderManifests(baseCtx)
        expect(result).toContain("name: scottish-trivia")
        expect(result).toContain("app: scottish-trivia")
    })

    it("sets the correct namespace", () => {
        const result = renderManifests(baseCtx)
        expect(result).toContain("namespace: crucible-dev")
    })

    it("sets the correct image", () => {
        const result = renderManifests(baseCtx)
        expect(result).toContain(
            "image: 375633680607.dkr.ecr.us-east-1.amazonaws.com/crucible-games:scottish-trivia-abc123-42"
        )
    })

    it("includes crucible-deploy managed-by label", () => {
        const result = renderManifests(baseCtx)
        expect(result).toContain("crucible.volley.tv/managed-by: crucible-deploy")
    })

    // --- ServiceAccount ---

    it("includes IRSA role annotation on ServiceAccount", () => {
        const result = renderManifests(baseCtx)
        expect(result).toContain(
            "eks.amazonaws.com/role-arn: arn:aws:iam::375633680607:role/crucible-game-scottish-trivia-dev"
        )
    })

    // --- Deployment ---

    it("sets security context (non-root, read-only, drop ALL)", () => {
        const result = renderManifests(baseCtx)
        expect(result).toContain("runAsNonRoot: true")
        expect(result).toContain("readOnlyRootFilesystem: true")
        expect(result).toContain("allowPrivilegeEscalation: false")
        expect(result).toContain("- ALL")
    })

    it("sets resource requests and limits", () => {
        const result = renderManifests(baseCtx)
        expect(result).toContain("cpu: 100m")
        expect(result).toContain("memory: 128Mi")
        expect(result).toContain("cpu: 500m")
        expect(result).toContain("memory: 512Mi")
    })

    it("sets readiness and liveness probes with game-specific paths", () => {
        const result = renderManifests(baseCtx)
        expect(result).toContain("path: /scottish-trivia/health/ready")
        expect(result).toContain("path: /scottish-trivia/health")
    })

    it("sets terminationGracePeriodSeconds to 35", () => {
        const result = renderManifests(baseCtx)
        expect(result).toContain("terminationGracePeriodSeconds: 35")
    })

    it("includes preStop sleep for graceful WebSocket drain", () => {
        const result = renderManifests(baseCtx)
        expect(result).toContain('command: ["sleep", "30"]')
    })

    it("injects Datadog env vars", () => {
        const result = renderManifests(baseCtx)
        expect(result).toContain("DD_ENV")
        expect(result).toContain("DD_SERVICE")
        expect(result).toContain("DD_AGENT_HOST")
    })

    // --- Service ---

    it("maps port 80 to targetPort 8080", () => {
        const result = renderManifests(baseCtx)
        expect(result).toContain("port: 80")
        expect(result).toContain("targetPort: 8080")
    })

    // --- Ingress ---

    it("uses per-game ALB group", () => {
        const result = renderManifests(baseCtx)
        expect(result).toContain(
            "alb.ingress.kubernetes.io/group.name: crucible-dev"
        )
    })

    it("sets correct host based on environment", () => {
        const result = renderManifests(baseCtx)
        expect(result).toContain(
            "host: crucible-games-dev.volley-services.net"
        )
    })

    it("uses game-specific path prefix", () => {
        const result = renderManifests(baseCtx)
        expect(result).toContain("path: /scottish-trivia")
        expect(result).toContain("pathType: Prefix")
    })

    it("sets ALB idle timeout to 3600s for WebSocket", () => {
        const result = renderManifests(baseCtx)
        expect(result).toContain("idle_timeout.timeout_seconds=3600")
    })

    it("enables sticky sessions", () => {
        const result = renderManifests(baseCtx)
        expect(result).toContain("stickiness.enabled=true")
    })

    // --- ScaledObject ---

    it("configures KEDA scale-to-zero", () => {
        const result = renderManifests(baseCtx)
        expect(result).toContain("minReplicaCount: 0")
        expect(result).toContain("maxReplicaCount: 5")
    })

    it("includes Prometheus triggers for game-specific metrics", () => {
        const result = renderManifests(baseCtx)
        expect(result).toContain(
            'crucible_pending_activations{game_id="scottish-trivia"}'
        )
        expect(result).toContain(
            'crucible_active_sessions{game_id="scottish-trivia"}'
        )
    })

    // --- NetworkPolicy ---

    it("allows ingress on port 8080", () => {
        const result = renderManifests(baseCtx)
        expect(result).toContain("port: 8080")
    })

    it("allows egress to DNS, HTTPS, and Redis", () => {
        const result = renderManifests(baseCtx)
        expect(result).toContain("port: 53")
        expect(result).toContain("port: 443")
        expect(result).toContain("port: 6379")
    })

    // --- Environment variations ---

    it("renders staging namespace correctly", () => {
        const ctx = { ...baseCtx, env: "staging", namespace: "crucible-staging" }
        const result = renderManifests(ctx)
        expect(result).toContain("namespace: crucible-staging")
        expect(result).toContain("host: crucible-games-staging.volley-services.net")
        expect(result).toContain("alb.ingress.kubernetes.io/group.name: crucible-staging")
    })

    it("renders prod namespace correctly", () => {
        const ctx = { ...baseCtx, env: "prod", namespace: "crucible-production" }
        const result = renderManifests(ctx)
        expect(result).toContain("namespace: crucible-production")
        expect(result).toContain("host: crucible-games-prod.volley-services.net")
    })
})

describe("renderIrsaTemplate", () => {
    it("produces valid CloudFormation template", () => {
        const result = renderIrsaTemplate(baseCtx)
        expect(result).toContain("AWSTemplateFormatVersion")
        expect(result).toContain("Resources:")
        expect(result).toContain("GameRole:")
    })

    it("sets correct role name", () => {
        const result = renderIrsaTemplate(baseCtx)
        expect(result).toContain(
            "RoleName: crucible-game-scottish-trivia-dev"
        )
    })

    it("scopes S3 access to the game's prefix", () => {
        const result = renderIrsaTemplate(baseCtx)
        expect(result).toContain(
            "arn:aws:s3:::crucible-clients-dev/scottish-trivia/*"
        )
    })

    it("references correct service account", () => {
        const result = renderIrsaTemplate(baseCtx)
        expect(result).toContain(
            "system:serviceaccount:crucible-dev:scottish-trivia"
        )
    })

    it("includes project tags", () => {
        const result = renderIrsaTemplate(baseCtx)
        expect(result).toContain("Key: Project")
        expect(result).toContain("Value: crucible")
        expect(result).toContain("Key: GameId")
        expect(result).toContain("Value: scottish-trivia")
    })

    it("outputs the role ARN", () => {
        const result = renderIrsaTemplate(baseCtx)
        expect(result).toContain("!GetAtt GameRole.Arn")
    })

    it("uses provided OIDC provider", () => {
        const result = renderIrsaTemplate(baseCtx)
        expect(result).toContain("oidc.eks.us-east-1.amazonaws.com/id/TEST123")
    })

    it("throws when OIDC provider is not set", () => {
        const ctx = { ...baseCtx, oidcProvider: undefined }
        // Also clear env var
        const orig = process.env.EKS_OIDC_PROVIDER
        delete process.env.EKS_OIDC_PROVIDER
        expect(() => renderIrsaTemplate(ctx)).toThrow("OIDC provider not set")
        process.env.EKS_OIDC_PROVIDER = orig
    })
})

describe("validateGameId", () => {
    it("accepts valid game IDs", () => {
        expect(() => validateGameId("scottish-trivia")).not.toThrow()
        expect(() => validateGameId("space-invaders")).not.toThrow()
        expect(() => validateGameId("game123")).not.toThrow()
        expect(() => validateGameId("abc")).not.toThrow()
    })

    it("rejects IDs with uppercase", () => {
        expect(() => validateGameId("Scottish-Trivia")).toThrow("Invalid game ID")
    })

    it("rejects IDs with special characters", () => {
        expect(() => validateGameId("game_one")).toThrow("Invalid game ID")
        expect(() => validateGameId("game/one")).toThrow("Invalid game ID")
        expect(() => validateGameId("game one")).toThrow("Invalid game ID")
    })

    it("rejects IDs with leading/trailing hyphens", () => {
        expect(() => validateGameId("-game")).toThrow("Invalid game ID")
        expect(() => validateGameId("game-")).toThrow("Invalid game ID")
    })

    it("rejects IDs that are too short", () => {
        expect(() => validateGameId("ab")).toThrow("Invalid game ID")
    })
})
