import { randomBytes, createHash } from "node:crypto"
import type { OIDCConfig, TokenSet } from "../types.js"

/** Generate a PKCE code verifier (43-128 chars, URL-safe) */
export function generateCodeVerifier(): string {
    return randomBytes(32).toString("base64url")
}

/** Generate a PKCE code challenge from a verifier (S256) */
export function generateCodeChallenge(verifier: string): string {
    return createHash("sha256").update(verifier).digest("base64url")
}

/** Generate a random state parameter */
export function generateState(): string {
    return randomBytes(16).toString("hex")
}

/** Build the authorization URL */
export function buildAuthUrl(
    config: OIDCConfig,
    params: {
        redirectUri: string
        codeChallenge: string
        state: string
        scopes?: string[]
    },
): string {
    const url = new URL(`${config.issuer}/authorize`)
    url.searchParams.set("client_id", config.clientId)
    url.searchParams.set("response_type", "code")
    url.searchParams.set("redirect_uri", params.redirectUri)
    url.searchParams.set("code_challenge", params.codeChallenge)
    url.searchParams.set("code_challenge_method", "S256")
    url.searchParams.set("state", params.state)
    url.searchParams.set("scope", (params.scopes ?? ["openid", "email", "profile"]).join(" "))
    return url.toString()
}

/** Exchange an auth code for tokens */
export async function exchangeCodeForTokens(
    config: OIDCConfig,
    params: {
        code: string
        codeVerifier: string
        redirectUri: string
    },
): Promise<TokenSet> {
    const response = await fetch(`${config.issuer}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: config.clientId,
            code: params.code,
            code_verifier: params.codeVerifier,
            redirect_uri: params.redirectUri,
        }),
    })

    if (!response.ok) {
        throw new Error(`Token exchange failed: ${response.status} ${await response.text()}`)
    }

    const data = (await response.json()) as {
        access_token: string
        refresh_token?: string
        id_token?: string
        expires_in: number
    }

    // Extract email from ID token (JWT payload, base64 decode middle segment)
    let email: string | undefined
    if (data.id_token) {
        try {
            const payload = JSON.parse(
                Buffer.from(data.id_token.split(".")[1]!, "base64url").toString(),
            )
            email = payload.email
        } catch {
            /* ignore malformed ID tokens */
        }
    }

    return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        idToken: data.id_token,
        expiresAt: Date.now() + data.expires_in * 1000,
        email,
    }
}
