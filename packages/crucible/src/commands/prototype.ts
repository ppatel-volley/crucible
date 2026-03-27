import type { Command } from "commander"
import { join } from "node:path"
import { stat } from "node:fs/promises"
import { resolvePaths } from "../config/paths.js"
import { loadConfig } from "../config/config.js"
import { createLogger } from "../util/logger.js"
import { usageError, networkError } from "../util/errors.js"

export function registerPrototypeCommand(program: Command): void {
    program
        .command("prototype <game-id>")
        .description("Deploy game to Kubernetes via Bifrost for prototype testing")
        .option("--watch", "Rebuild and redeploy on file changes", false)
        .option("--dependencies <deps>", "Infrastructure dependencies (name:type,name:type)")
        .option("--delete", "Remove the prototype and clean up resources", false)
        .option("--registry <host>", "In-cluster registry host", "registry.prototypes.svc.cluster.local:5000")
        .option("--port <port>", "Container port", parseInt, 3000)
        .action(async (gameId: string, options) => {
            await runPrototypeCommand(gameId, options)
        })
}

export async function runPrototypeCommand(
    gameId: string,
    options: {
        watch: boolean
        dependencies?: string
        delete: boolean
        registry: string
        port: number
    },
): Promise<void> {
    const paths = resolvePaths()
    const config = await loadConfig(paths)
    const logger = createLogger({ color: true, json: false, verbose: false, quiet: false })
    const gamesDir = config.gamesDir ?? paths.gamesDir
    const gamePath = join(gamesDir, gameId)

    // Verify game exists
    try {
        await stat(gamePath)
    } catch {
        throw usageError("CRUCIBLE-301", `Game "${gameId}" not found at ${gamePath}`, "Run `crucible create` first.")
    }

    // Handle --delete
    if (options.delete) {
        const spinner = logger.spinner("Deleting prototype...")
        try {
            await deletePrototype(gameId)
            spinner.succeed("Prototype deleted. Bifrost will clean up resources.")
        } catch (err) {
            spinner.fail("Failed to delete prototype")
            throw networkError(
                "CRUCIBLE-901",
                `Failed to delete prototype for "${gameId}"`,
                "Check kubectl access and cluster connectivity.",
            )
        }
        return
    }

    // Deploy prototype — not yet wired up; depends on CRD generator and registry push modules
    throw networkError(
        "CRUCIBLE-901",
        "Prototype deployment is not yet fully implemented",
        "Bifrost must be deployed to the cluster first. See docs/human-actions.md.",
    )
}

/**
 * Delete a GamePrototype CRD via kubectl.
 */
async function deletePrototype(gameId: string): Promise<void> {
    const { execa } = await import("execa")
    await execa("kubectl", ["delete", "gameprototype", gameId, "--ignore-not-found"])
}
