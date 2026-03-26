import type { Command } from "commander"
import type { OIDCConfig } from "../types.js"
import { authError } from "../util/errors.js"
import { generateCodeVerifier, generateCodeChallenge, generateState, buildAuthUrl, exchangeCodeForTokens } from "../auth/oidc.js"
import { startCallbackServer } from "../auth/server.js"
import { saveTokens } from "../auth/token-store.js"

function getOIDCConfig(): OIDCConfig | null {
    const issuer = process.env.CRUCIBLE_OIDC_ISSUER
    const clientId = process.env.CRUCIBLE_OIDC_CLIENT_ID
    if (!issuer || !clientId) return null
    return { issuer, clientId, deviceAuthEndpoint: process.env.CRUCIBLE_OIDC_DEVICE_ENDPOINT }
}

export function registerLoginCommand(program: Command): void {
    program
        .command("login")
        .description("Authenticate with Volley SSO")
        .option("--device-code", "Use device code flow (for headless environments)", false)
        .action(async (options: { deviceCode: boolean }) => {
            await runLoginCommand(options)
        })
}

export async function runLoginCommand(options: { deviceCode: boolean }): Promise<void> {
    // Check if OIDC is configured
    const oidcConfig = getOIDCConfig()
    if (!oidcConfig) {
        throw authError(
            "CRUCIBLE-101",
            "SSO is not configured",
            "See docs/human-actions.md section 4 for SSO setup instructions.",
        )
    }

    if (options.deviceCode) {
        throw authError(
            "CRUCIBLE-102",
            "Device code login is not yet implemented",
            "Use browser login instead: crucible login",
        )
    }

    // Browser flow: PKCE + ephemeral callback server
    const codeVerifier = generateCodeVerifier()
    const codeChallenge = generateCodeChallenge(codeVerifier)
    const state = generateState()

    const { port, waitForCallback, close } = await startCallbackServer({
        expectedState: state,
    })

    const redirectUri = `http://127.0.0.1:${port}/callback`
    const authUrl = buildAuthUrl(oidcConfig, {
        redirectUri,
        codeChallenge,
        state,
    })

    // Open browser — dynamic import to avoid hard dependency
    try {
        const { exec } = await import("node:child_process")
        const openCmd =
            process.platform === "win32"
                ? `start "" "${authUrl}"`
                : process.platform === "darwin"
                  ? `open "${authUrl}"`
                  : `xdg-open "${authUrl}"`
        exec(openCmd)
    } catch {
        // If we can't open the browser, print the URL for manual use
    }

    console.log(`\nOpen this URL to log in:\n  ${authUrl}\n`)
    console.log("Waiting for authentication...")

    try {
        const { code } = await waitForCallback()

        const tokens = await exchangeCodeForTokens(oidcConfig, {
            code,
            codeVerifier,
            redirectUri,
        })

        await saveTokens(tokens)

        const identity = tokens.email ? ` as ${tokens.email}` : ""
        console.log(`\nLogged in successfully${identity}.`)
    } finally {
        close()
    }
}
