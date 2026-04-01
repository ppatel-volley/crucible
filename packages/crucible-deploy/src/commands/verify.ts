import { Command } from "commander"
import chalk from "chalk"
import { pollHealth } from "../lib/health-check.js"
import { validateGameId } from "../lib/constants.js"

export const verifyCommand = new Command("verify")
    .description("Verify a deployed game is healthy")
    .requiredOption("--game <gameId>", "Game identifier")
    .requiredOption("--env <env>", "Target environment (dev, staging, prod)")
    .option("--timeout <seconds>", "Health check timeout in seconds", "60")
    .option(
        "--namespace <ns>",
        "K8s namespace (default: crucible-<env>)"
    )
    .action(async (opts) => {
        const gameId: string = opts.game
        validateGameId(gameId)
        const env: string = opts.env
        const timeout = parseInt(opts.timeout, 10) * 1000
        const host = `crucible-games-${env}.volley-services.net`
        const healthUrl = `https://${host}/${gameId}/health/ready`

        console.log(
            chalk.blue(
                `Verifying ${chalk.bold(gameId)} in ${env}`
            )
        )
        console.log(chalk.dim(`  Health endpoint: ${healthUrl}`))
        console.log(
            chalk.dim(
                `  Timeout: ${opts.timeout}s`
            )
        )

        const result = await pollHealth(healthUrl, timeout)

        if (result.healthy) {
            console.log(
                chalk.green(
                    `\n${chalk.bold("✓")} ${gameId} is healthy (${result.latencyMs}ms, status ${result.statusCode})`
                )
            )
        } else {
            console.error(
                chalk.red(
                    `\n${chalk.bold("✗")} ${gameId} failed health check`
                )
            )
            if (result.statusCode) {
                console.error(chalk.red(`  Status: ${result.statusCode}`))
            }
            if (result.error) {
                console.error(chalk.red(`  Error: ${result.error}`))
            }
            console.error(
                chalk.red(`  Last check latency: ${result.latencyMs}ms`)
            )
            process.exit(1)
        }
    })
