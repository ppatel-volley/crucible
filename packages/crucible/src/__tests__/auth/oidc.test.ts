import { describe, it, expect } from "vitest"
import {
    generateCodeVerifier,
    generateCodeChallenge,
    generateState,
    buildAuthUrl,
} from "../../auth/oidc.js"
import type { OIDCConfig } from "../../types.js"

describe("generateCodeVerifier", () => {
    it("returns a URL-safe string of at least 43 characters", () => {
        const verifier = generateCodeVerifier()
        expect(verifier.length).toBeGreaterThanOrEqual(43)
        // base64url charset: A-Z, a-z, 0-9, -, _
        expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
    })

    it("returns unique values on successive calls", () => {
        const a = generateCodeVerifier()
        const b = generateCodeVerifier()
        expect(a).not.toBe(b)
    })
})

describe("generateCodeChallenge", () => {
    it("returns a valid base64url hash of the verifier", () => {
        const verifier = generateCodeVerifier()
        const challenge = generateCodeChallenge(verifier)
        // SHA-256 produces 32 bytes = 43 base64url chars (no padding)
        expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/)
        expect(challenge.length).toBe(43)
    })

    it("produces deterministic output for same input", () => {
        const verifier = "test-verifier-value"
        const a = generateCodeChallenge(verifier)
        const b = generateCodeChallenge(verifier)
        expect(a).toBe(b)
    })
})

describe("generateState", () => {
    it("returns a 32-character hex string", () => {
        const state = generateState()
        expect(state).toMatch(/^[0-9a-f]{32}$/)
    })

    it("returns unique values on successive calls", () => {
        const a = generateState()
        const b = generateState()
        expect(a).not.toBe(b)
    })
})

describe("buildAuthUrl", () => {
    const config: OIDCConfig = {
        issuer: "https://auth.example.com",
        clientId: "test-client-123",
    }

    const baseParams = {
        redirectUri: "http://127.0.0.1:9999/callback",
        codeChallenge: "test-challenge-abc",
        state: "test-state-xyz",
    }

    it("includes all required params", () => {
        const url = buildAuthUrl(config, baseParams)
        const parsed = new URL(url)

        expect(parsed.origin).toBe("https://auth.example.com")
        expect(parsed.pathname).toBe("/authorize")
        expect(parsed.searchParams.get("client_id")).toBe("test-client-123")
        expect(parsed.searchParams.get("response_type")).toBe("code")
        expect(parsed.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:9999/callback")
        expect(parsed.searchParams.get("code_challenge")).toBe("test-challenge-abc")
        expect(parsed.searchParams.get("code_challenge_method")).toBe("S256")
        expect(parsed.searchParams.get("state")).toBe("test-state-xyz")
    })

    it("uses default scopes when not provided", () => {
        const url = buildAuthUrl(config, baseParams)
        const parsed = new URL(url)
        expect(parsed.searchParams.get("scope")).toBe("openid email profile")
    })

    it("uses custom scopes when provided", () => {
        const url = buildAuthUrl(config, { ...baseParams, scopes: ["openid", "custom"] })
        const parsed = new URL(url)
        expect(parsed.searchParams.get("scope")).toBe("openid custom")
    })
})
