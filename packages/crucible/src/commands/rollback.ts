import type { Command } from "commander"
import { join } from "node:path"
import { stat } from "node:fs/promises"
import { resolvePaths } from "../config/paths.js"
import { loadConfig } from "../config/config.js"
import { usageError, networkError } from "../util/errors.js"

export function registerRollbackCommand(program: Command): void {
    program
        .command("rollback <game-id>")
        .description("Rollback to a previous game version")
        .option("--to <version>", "Specific version to rollback to")
        .option("--env <environment>", "Target environment", "dev")
        .action(async (gameId: string, options: { to?: string; env: string }) => {
            await runRollbackCommand(gameId, options)
        })
}

export async function runRollbackCommand(
    gameId: string,
    options: { to?: string; env: string },
): Promise<void> {
    const paths = resolvePaths()
    const config = await loadConfig(paths)
    const gamesDir = config.gamesDir ?? paths.gamesDir
    const gamePath = join(gamesDir, gameId)

    try {
        await stat(gamePath)
    } catch {
        throw usageError(
            "CRUCIBLE-301",
            `Game "${gameId}" not found at ${gamePath}`,
            "Run `crucible create` first or check the game ID.",
        )
    }

    const validEnvs = ["dev", "staging", "prod"]
    if (!validEnvs.includes(options.env)) {
        throw usageError(
            "CRUCIBLE-200",
            `Invalid environment "${options.env}"`,
            `Use one of: ${validEnvs.join(", ")}`,
        )
    }

    throw networkError(
        "CRUCIBLE-701",
        "Rollback is not yet implemented",
        "This command will be available after Phase 2 infrastructure is provisioned.",
    )
}
