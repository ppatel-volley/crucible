import { Command } from "commander"
import chalk from "chalk"
import { renderManifests, renderIrsaTemplate } from "../lib/manifests.js"
import { kubectlApply, kubectlRolloutWait } from "../lib/kubectl.js"
import { ensureIrsaStack } from "../lib/cloudformation.js"
import { AWS_ACCOUNT_ID, validateGameId } from "../lib/constants.js"
import type { ManifestContext } from "../types.js"

export const applyCommand = new Command("apply")
    .description("Render K8s manifests and apply to the cluster")
    .requiredOption("--game <gameId>", "Game identifier")
    .requiredOption("--image <image>", "Full image reference (registry/repo:tag)")
    .requiredOption("--env <env>", "Target environment (dev, staging, prod)")
    .option(
        "--namespace <ns>",
        "K8s namespace (default: crucible-<env>)"
    )
    .option("--rollout-timeout <seconds>", "Rollout wait timeout", "120")
    .option(
        "--oidc-provider <provider>",
        "EKS OIDC provider (or set EKS_OIDC_PROVIDER env var)"
    )
    .action(async (opts) => {
        const gameId: string = opts.game
        const env: string = opts.env
        const namespace = opts.namespace ?? `crucible-${env}`
        const image: string = opts.image
        const rolloutTimeout = parseInt(opts.rolloutTimeout, 10)

        validateGameId(gameId)

        const ctx: ManifestContext = {
            gameId,
            env,
            namespace,
            image,
            accountId: AWS_ACCOUNT_ID,
            oidcProvider: opts.oidcProvider,
        }

        console.log(
            chalk.blue(`Deploying ${chalk.bold(gameId)} to ${env} (${namespace})`)
        )

        // 1. Ensure IRSA CloudFormation stack
        const stackName = `crucible-irsa-${gameId}-${env}`
        console.log(chalk.dim(`  Ensuring IRSA stack: ${stackName}`))
        try {
            const irsaTemplate = renderIrsaTemplate(ctx)
            const irsaResult = await ensureIrsaStack(stackName, irsaTemplate)
            console.log(chalk.green(`  IRSA stack: ${irsaResult}`))
        } catch (err) {
            console.error(
                chalk.red(
                    `  IRSA stack failed: ${err instanceof Error ? err.message : err}`
                )
            )
            process.exit(1)
        }

        // 2. Render and apply K8s manifests
        console.log(chalk.dim("  Rendering K8s manifests..."))
        const manifests = renderManifests(ctx)

        console.log(chalk.dim("  Applying manifests (server-side)..."))
        try {
            const { stdout } = await kubectlApply(manifests, namespace)
            for (const line of stdout.trim().split("\n").filter(Boolean)) {
                console.log(chalk.green(`  ${line}`))
            }
        } catch (err) {
            console.error(
                chalk.red(
                    `  kubectl apply failed: ${err instanceof Error ? err.message : err}`
                )
            )
            process.exit(1)
        }

        // 3. Wait for rollout
        console.log(
            chalk.dim(
                `  Waiting for rollout (timeout: ${rolloutTimeout}s)...`
            )
        )
        try {
            await kubectlRolloutWait(gameId, namespace, rolloutTimeout)
            console.log(chalk.green(`  Rollout complete`))
        } catch (err) {
            console.error(
                chalk.red(
                    `  Rollout timed out: ${err instanceof Error ? err.message : err}`
                )
            )
            process.exit(1)
        }

        console.log(
            chalk.green(
                `\n${chalk.bold("✓")} ${gameId} deployed to ${env}`
            )
        )
    })
