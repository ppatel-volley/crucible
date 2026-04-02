import type { Command } from "commander"
import { join } from "node:path"
import { stat } from "node:fs/promises"
import { resolvePaths } from "../config/paths.js"
import { loadConfig } from "../config/config.js"
import { usageError, networkError } from "../util/errors.js"
import { createLogger } from "../util/logger.js"
import type { Logger } from "../types.js"
import chalk from "chalk"

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
    const logger = createLogger({ json: false, color: true, verbose: false, quiet: false })

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

    const namespace = `crucible-${options.env === "prod" ? "production" : options.env}`

    logger.info(`Rolling back ${chalk.bold(gameId)} in ${options.env}...`)

    // Use kubectl rollout undo to revert to the previous ReplicaSet
    const { execa } = await import("execa")

    const undoArgs = [
        "rollout", "undo",
        `deployment/${gameId}`,
        "--namespace", namespace,
    ]
    if (options.to) {
        undoArgs.push(`--to-revision=${options.to}`)
    }

    try {
        const result = await execa("kubectl", undoArgs)
        if (result.stdout.trim()) {
            logger.info(result.stdout.trim())
        }
    } catch (err) {
        throw networkError(
            "CRUCIBLE-701",
            `Rollback failed for ${gameId} in ${options.env}`,
            "Check that the deployment exists and kubectl is configured.",
            { cause: err instanceof Error ? err : new Error(String(err)) },
        )
    }

    // Wait for rollout to complete
    logger.info("Waiting for rollout to complete...")
    try {
        await execa("kubectl", [
            "rollout", "status",
            `deployment/${gameId}`,
            "--namespace", namespace,
            "--timeout=120s",
        ])
    } catch (err) {
        throw networkError(
            "CRUCIBLE-701",
            `Rollout timed out for ${gameId} in ${options.env}`,
            "The rollback was initiated but the new pods haven't stabilised. Check pod status with `crucible status`.",
            { cause: err instanceof Error ? err : new Error(String(err)) },
        )
    }

    logger.info(chalk.green(`\n${chalk.bold("✓")} ${gameId} rolled back in ${options.env}`))
}
