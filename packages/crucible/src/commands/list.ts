import type { Command } from "commander"
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { resolvePaths } from "../config/paths.js"
import { loadConfig } from "../config/config.js"

interface GameInfo {
    gameId: string
    displayName: string
    version: string
    template: string
    createdAt: string
    hasCrucibleJson: boolean
}

export async function readGameInfo(gamesDir: string, dirName: string): Promise<GameInfo> {
    try {
        const content = await readFile(join(gamesDir, dirName, "crucible.json"), "utf-8")
        const json = JSON.parse(content)
        return {
            gameId: dirName,
            displayName: json.displayName ?? dirName,
            version: json.version ?? "?",
            template: json.template ?? "?",
            createdAt: json.createdAt ?? "",
            hasCrucibleJson: true,
        }
    } catch {
        return {
            gameId: dirName,
            displayName: dirName,
            version: "—",
            template: "—",
            createdAt: "",
            hasCrucibleJson: false,
        }
    }
}

export function formatTimeAgo(isoDate: string): string {
    if (!isoDate) return "—"
    const diff = Date.now() - new Date(isoDate).getTime()
    const minutes = Math.floor(diff / 60000)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
}

function formatTable(games: GameInfo[]): string {
    const header = { name: "Name", displayName: "Display Name", version: "Version", template: "Template", created: "Created" }

    const rows = games.map((g) => ({
        name: g.gameId,
        displayName: g.hasCrucibleJson ? g.displayName : `${g.displayName} (no crucible.json)`,
        version: g.version,
        template: g.template,
        created: formatTimeAgo(g.createdAt),
    }))

    const colWidths = {
        name: Math.max(header.name.length, ...rows.map((r) => r.name.length)),
        displayName: Math.max(header.displayName.length, ...rows.map((r) => r.displayName.length)),
        version: Math.max(header.version.length, ...rows.map((r) => r.version.length)),
        template: Math.max(header.template.length, ...rows.map((r) => r.template.length)),
        created: Math.max(header.created.length, ...rows.map((r) => r.created.length)),
    }

    const formatRow = (r: typeof header) =>
        `  ${r.name.padEnd(colWidths.name)}  ${r.displayName.padEnd(colWidths.displayName)}  ${r.version.padEnd(colWidths.version)}  ${r.template.padEnd(colWidths.template)}  ${r.created}`

    const lines = [formatRow(header), ...rows.map(formatRow)]
    return lines.join("\n")
}

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
        const dirNames = entries.filter((e) => e.isDirectory()).map((e) => e.name)

        if (dirNames.length === 0) {
            console.log("No games found. Run `crucible create` to get started.")
            return
        }

        const games = await Promise.all(dirNames.map((name) => readGameInfo(gamesDir, name)))

        console.log("")
        console.log(formatTable(games))
        console.log(`\n  ${games.length} game(s) found.`)
        // TODO: Add publish status from Registry API when available
    } catch {
        console.log("No games found. Run `crucible create` to get started.")
    }
}
