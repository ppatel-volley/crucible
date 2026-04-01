import type { Command } from "commander"
import { join } from "node:path"
import { stat, readFile } from "node:fs/promises"
import { resolvePaths } from "../config/paths.js"
import { loadConfig } from "../config/config.js"
import { usageError, networkError } from "../util/errors.js"
import { createLogger } from "../util/logger.js"
import type { Logger } from "../types.js"
import chalk from "chalk"

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
    const logger = createLogger({ json: false, color: true, verbose: false, quiet: false })

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

    const registryUrl = config.registryApiUrls?.[options.from]
    if (!registryUrl) {
        throw networkError(
            "CRUCIBLE-601",
            `No Registry API URL configured for ${options.from}`,
            "Set registryApiUrls in your Crucible config.",
        )
    }

    logger.info(`Promoting ${chalk.bold(gameId)} from ${options.from} → ${options.to}...`)

    // 1. Fetch current game state from source environment
    logger.info(`Fetching ${gameId} from ${options.from} registry...`)
    let sourceGame: { imageTag?: string; version?: string }
    try {
        const response = await fetch(`${registryUrl}/games/${gameId}`)
        if (!response.ok) {
            throw new Error(`Registry API returned ${response.status}`)
        }
        const data = await response.json() as Record<string, unknown>
        const envData = (data.environments as Record<string, { imageTag?: string; version?: string }> | undefined)?.[options.from]
        if (!envData?.imageTag) {
            throw new Error(`Game ${gameId} has no deployment in ${options.from}`)
        }
        sourceGame = envData
    } catch (err) {
        throw networkError(
            "CRUCIBLE-601",
            `Failed to fetch ${gameId} from ${options.from} registry`,
            "Check that the game is published in the source environment.",
            { cause: err instanceof Error ? err : new Error(String(err)) },
        )
    }

    logger.info(`Source: ${sourceGame.imageTag} (v${sourceGame.version ?? "unknown"})`)

    // 2. Trigger deployment to target environment
    // This re-uses the same image tag — no rebuild needed
    const targetRegistryUrl = config.registryApiUrls?.[options.to]
    if (!targetRegistryUrl) {
        throw networkError(
            "CRUCIBLE-601",
            `No Registry API URL configured for ${options.to}`,
            "Set registryApiUrls in your Crucible config.",
        )
    }

    logger.info(`Registering ${gameId} in ${options.to} with image ${sourceGame.imageTag}...`)
    try {
        const response = await fetch(`${targetRegistryUrl}/games/${gameId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                imageTag: sourceGame.imageTag,
                version: sourceGame.version,
                status: "deploying",
                environment: options.to,
            }),
        })
        if (!response.ok) {
            const text = await response.text().catch(() => "")
            throw new Error(`Registry API returned ${response.status}: ${text}`)
        }
    } catch (err) {
        throw networkError(
            "CRUCIBLE-601",
            `Failed to register ${gameId} in ${options.to}`,
            "Check Registry API availability and permissions.",
            { cause: err instanceof Error ? err : new Error(String(err)) },
        )
    }

    logger.info(chalk.green(`\n${chalk.bold("✓")} ${gameId} promoted from ${options.from} → ${options.to}`))
    logger.info(chalk.dim(`Image: ${sourceGame.imageTag}`))
}
