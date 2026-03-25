import type { Command } from "commander"
import { authError } from "../util/errors.js"

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
    // Check if SSO is configured
    // For now, throw not-implemented with helpful guidance

    if (options.deviceCode) {
        throw authError(
            "CRUCIBLE-101",
            "Device code login is not yet implemented",
            "SSO configuration is required. See docs/human-actions.md section 4 for setup instructions.",
        )
    }

    throw authError(
        "CRUCIBLE-101",
        "Browser login is not yet implemented",
        "SSO configuration is required. See docs/human-actions.md section 4 for setup instructions.",
    )
}
