import type { Command } from "commander"
import { join } from "node:path"
import { stat } from "node:fs/promises"
import { resolvePaths } from "../config/paths.js"
import { loadConfig } from "../config/config.js"
import { usageError, networkError } from "../util/errors.js"

export function registerPromoteCommand(program: Command): void {
    program
        .command("promote <game-id>")
        .description("Promote game to next environment")
        .requiredOption("--from <environment>", "Source environment")
        .requiredOption("--to <environment>", "Target environment")
        .option("--confirm <game-name>", "Required for production promotions")
        .action(async (gameId: string, options: { from: string; to: string; confirm?: string }) => {
            await runPromoteCommand(gameId, options)
        })
}

export async function runPromoteCommand(
    gameId: string,
    options: { from: string; to: string; confirm?: string },
): Promise<void> {
    const paths = resolvePaths()
    const config = await loadConfig(paths)
    const gamesDir = config.gamesDir ?? paths.gamesDir
    const gamePath = join(gamesDir, gameId)

    try {
        await stat(gamePath)
    } catch {
        throw usageError("CRUCIBLE-301", `Game "${gameId}" not found at ${gamePath}`, "Run `crucible create` first or check the game ID.")
    }

    const validEnvs = ["dev", "staging", "prod"]
    if (!validEnvs.includes(options.from)) {
        throw usageError("CRUCIBLE-200", `Invalid source environment "${options.from}"`, `Use one of: ${validEnvs.join(", ")}`)
    }
    if (!validEnvs.includes(options.to)) {
        throw usageError("CRUCIBLE-200", `Invalid target environment "${options.to}"`, `Use one of: ${validEnvs.join(", ")}`)
    }

    // Production promotion requires --confirm with the game name
    if (options.to === "prod" && options.confirm !== gameId) {
        throw usageError("CRUCIBLE-200", "Production promotion requires confirmation", `Pass --confirm ${gameId} to confirm.`)
    }

    throw networkError("CRUCIBLE-601", "Promote is not yet implemented", "This command will be available after Phase 2 infrastructure is provisioned.")
}
