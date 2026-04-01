import type { Command } from "commander"
import { join } from "node:path"
import { stat } from "node:fs/promises"
import { resolvePaths } from "../config/paths.js"
import { loadConfig } from "../config/config.js"
import { usageError, networkError } from "../util/errors.js"
import { createLogger } from "../util/logger.js"
import chalk from "chalk"

export function registerLogsCommand(program: Command): void {
    program
        .command("logs <game-id>")
        .description("View game server logs")
        .option("-f, --follow", "Stream logs continuously", false)
        .option("--lines <number>", "Number of lines to display", parseInt, 100)
        .option("--env <environment>", "Target environment", "dev")
        .action(async (gameId: string, options: { follow: boolean; lines: number; env: string }) => {
            await runLogsCommand(gameId, options)
        })
}

export async function runLogsCommand(
    gameId: string,
    options: { follow: boolean; lines: number; env: string },
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

    logger.info(`Fetching logs for ${chalk.bold(gameId)} in ${options.env}...`)

    const { execa } = await import("execa")

    const args = [
        "logs",
        `deployment/${gameId}`,
        "--namespace", namespace,
        `--tail=${options.lines}`,
        "--container=game",
    ]

    if (options.follow) {
        args.push("--follow")
    }

    try {
        if (options.follow) {
            // Stream mode — pipe output directly to stdout
            const proc = execa("kubectl", args, {
                stdout: "inherit",
                stderr: "inherit",
            })

            // Handle Ctrl+C gracefully
            process.on("SIGINT", () => {
                proc.kill("SIGTERM")
            })

            await proc
        } else {
            // Batch mode — fetch and display
            const result = await execa("kubectl", args)
            if (result.stdout.trim()) {
                console.log(result.stdout)
            } else {
                logger.info(chalk.dim("No logs available."))
            }
        }
    } catch (err) {
        // kubectl returns non-zero if the pod doesn't exist
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes("not found") || msg.includes("No resources found")) {
            throw networkError(
                "CRUCIBLE-401",
                `No deployment found for ${gameId} in ${options.env}`,
                "The game may not be deployed yet. Check with `crucible status`.",
            )
        }
        throw networkError(
            "CRUCIBLE-401",
            `Failed to fetch logs for ${gameId}`,
            "Check that kubectl is configured and the game is deployed.",
            { cause: err instanceof Error ? err : new Error(String(err)) },
        )
    }
}
