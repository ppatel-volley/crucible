import { Command } from "commander"
import chalk from "chalk"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { kubectlRolloutWait } from "../lib/kubectl.js"
import { registerGame } from "../lib/registry-client.js"
import { REGISTRY_URLS, validateGameId } from "../lib/constants.js"

const execFileAsync = promisify(execFile)

export const rollbackCommand = new Command("rollback")
    .description("Roll back a game to its previous deployment")
    .requiredOption("--game <gameId>", "Game identifier")
    .requiredOption("--env <env>", "Target environment (dev, staging, prod)")
    .option(
        "--namespace <ns>",
        "K8s namespace (default: crucible-<env>)"
    )
    .option("--registry-url <url>", "Override Registry API base URL")
    .option("--rollout-timeout <seconds>", "Rollout wait timeout", "120")
    .action(async (opts) => {
        const gameId: string = opts.game
        validateGameId(gameId)
        const env: string = opts.env
        const namespace = opts.namespace ?? `crucible-${env}`
        const registryUrl: string =
            opts.registryUrl ?? REGISTRY_URLS[env]
        const rolloutTimeout = parseInt(opts.rolloutTimeout, 10)

        console.log(
            chalk.yellow(
                `Rolling back ${chalk.bold(gameId)} in ${env}`
            )
        )

        // Use kubectl rollout undo — K8s tracks the previous ReplicaSet
        console.log(chalk.dim("  Running kubectl rollout undo..."))
        try {
            const { stdout } = await execFileAsync(
                "kubectl",
                [
                    "rollout",
                    "undo",
                    `deployment/${gameId}`,
                    "--namespace",
                    namespace,
                ],
                { timeout: 30_000 }
            )
            if (stdout.trim()) {
                console.log(chalk.dim(`  ${stdout.trim()}`))
            }
        } catch (err) {
            console.error(
                chalk.red(
                    `  Rollback failed: ${err instanceof Error ? err.message : err}`
                )
            )
            process.exit(1)
        }

        // Wait for rollout to complete
        console.log(chalk.dim("  Waiting for rollout..."))
        try {
            await kubectlRolloutWait(gameId, namespace, rolloutTimeout)
        } catch (err) {
            console.error(
                chalk.red(
                    `  Rollout wait failed: ${err instanceof Error ? err.message : err}`
                )
            )
            process.exit(1)
        }

        // Update registry status (best-effort)
        if (registryUrl) {
            console.log(chalk.dim("  Updating registry status..."))
            try {
                await registerGame(registryUrl, gameId, {
                    displayName: gameId,
                    author: "crucible-deploy",
                    imageTag: "rollback",
                    commitSha: "rollback",
                    version: "rollback",
                    status: "unhealthy",
                    environment: env,
                })
            } catch (err) {
                // Non-fatal: the K8s rollback already succeeded
                console.warn(
                    chalk.yellow(
                        `  Registry update failed (non-fatal): ${err instanceof Error ? err.message : err}`
                    )
                )
            }
        }

        console.log(
            chalk.green(
                `\n${chalk.bold("✓")} ${gameId} rolled back in ${env}`
            )
        )
    })
