import { Command } from "commander"
import chalk from "chalk"
import { registerGame } from "../lib/registry-client.js"
import { REGISTRY_URLS, validateGameId } from "../lib/constants.js"

export const registerCommand = new Command("register")
    .description("Register a deployed game in the Crucible Registry")
    .requiredOption("--game <gameId>", "Game identifier")
    .requiredOption("--env <env>", "Target environment (dev, staging, prod)")
    .requiredOption("--image <imageTag>", "Docker image tag")
    .requiredOption("--display-name <name>", "Game display name")
    .requiredOption("--author <author>", "Author email or identifier")
    .option("--version <version>", "Game version", "0.1.0")
    .option("--commit-sha <sha>", "Git commit SHA")
    .option("--registry-url <url>", "Override Registry API base URL")
    .action(async (opts) => {
        const gameId: string = opts.game
        validateGameId(gameId)
        const env: string = opts.env
        const registryUrl: string =
            opts.registryUrl ?? REGISTRY_URLS[env]

        if (!registryUrl) {
            console.error(
                chalk.red(
                    `No registry URL for environment: ${env}. Use --registry-url to override.`
                )
            )
            process.exit(1)
        }

        const commitSha =
            opts.commitSha ?? process.env.GITHUB_SHA ?? "unknown"

        console.log(
            chalk.blue(
                `Registering ${chalk.bold(gameId)} in ${env}`
            )
        )
        console.log(chalk.dim(`  Registry: ${registryUrl}`))
        console.log(chalk.dim(`  Image: ${opts.image}`))

        try {
            await registerGame(registryUrl, gameId, {
                displayName: opts.displayName,
                author: opts.author,
                imageTag: opts.image,
                commitSha,
                version: opts.version,
                status: "healthy",
                environment: env,
            })

            console.log(
                chalk.green(
                    `\n${chalk.bold("✓")} ${gameId} registered in ${env}`
                )
            )
        } catch (err) {
            console.error(
                chalk.red(
                    `\n${chalk.bold("✗")} Registration failed: ${err instanceof Error ? err.message : err}`
                )
            )
            process.exit(1)
        }
    })
