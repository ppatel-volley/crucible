import type { Command } from "commander"
import { join } from "node:path"
import { stat } from "node:fs/promises"
import { resolvePaths } from "../config/paths.js"
import { loadConfig } from "../config/config.js"
import { usageError, networkError } from "../util/errors.js"

export function registerPublishCommand(program: Command): void {
    program
        .command("publish <game-id>")
        .description("Publish game to registry — pushes to GitHub and monitors CI pipeline")
        .option("--timeout <minutes>", "CI polling timeout in minutes", parseInt, 10)
        .option("--env <environment>", "Target environment", "dev")
        .action(async (gameId: string, options: { timeout: number; env: string }) => {
            await runPublishCommand(gameId, options)
        })
}

export async function runPublishCommand(
    gameId: string,
    options: { timeout: number; env: string },
): Promise<void> {
    const paths = resolvePaths()
    const config = await loadConfig(paths)
    const gamesDir = config.gamesDir ?? paths.gamesDir
    const gamePath = join(gamesDir, gameId)

    // Verify game exists
    try {
        await stat(gamePath)
    } catch {
        throw usageError("CRUCIBLE-301", `Game "${gameId}" not found at ${gamePath}`, "Run `crucible create` first or check the game ID.")
    }

    // Validate environment
    const validEnvs = ["dev", "staging", "prod"]
    if (!validEnvs.includes(options.env)) {
        throw usageError("CRUCIBLE-200", `Invalid environment "${options.env}"`, `Use one of: ${validEnvs.join(", ")}`)
    }

    throw networkError("CRUCIBLE-501", "Publish is not yet implemented", "This command will be available after Phase 2 infrastructure is provisioned.")
}
