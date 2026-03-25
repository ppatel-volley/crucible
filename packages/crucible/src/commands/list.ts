import type { Command } from "commander"
import { readdir } from "node:fs/promises"
import { resolvePaths } from "../config/paths.js"
import { loadConfig } from "../config/config.js"

export function registerListCommand(program: Command): void {
    program
        .command("list")
        .description("List local games and their publish status")
        .option("--env <environment>", "Filter to specific environment")
        .action(async (options: { env?: string }) => {
            await runListCommand(options)
        })
}

export async function runListCommand(options: { env?: string }): Promise<void> {
    const paths = resolvePaths()
    const config = await loadConfig(paths)
    const gamesDir = config.gamesDir ?? paths.gamesDir

    // List local game directories
    try {
        const entries = await readdir(gamesDir, { withFileTypes: true })
        const games = entries.filter((e) => e.isDirectory()).map((e) => e.name)

        if (games.length === 0) {
            console.log("No games found. Run `crucible create` to get started.")
            return
        }

        console.log(`Games in ${gamesDir}:\n`)
        for (const game of games) {
            console.log(`  ${game}`)
        }
        console.log(`\n${games.length} game(s) found.`)
        // TODO: Add publish status from Registry API when available
    } catch {
        console.log("No games found. Run `crucible create` to get started.")
    }
}
