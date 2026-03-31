import type { Command } from "commander"
import { join } from "node:path"
import { readdir, readFile } from "node:fs/promises"
import { resolvePaths } from "../config/paths.js"
import { loadConfig } from "../config/config.js"
import chalk from "chalk"

export interface BifrostStatus {
    exists: boolean
    phase?: string // "Pending" | "Building" | "Running" | "Failed"
    hostname?: string
    buildRef?: string
    dependencies?: Record<string, { type: string; databaseName?: string; bucket?: string; keyPrefix?: string }>
}

export async function getBifrostStatus(gameId: string): Promise<BifrostStatus> {
    const { execa } = await import("execa")
    try {
        const result = await execa("kubectl", [
            "get", "gameprototype", gameId, "-o", "json",
        ])
        const obj = JSON.parse(result.stdout)
        return {
            exists: true,
            phase: obj.status?.phase ?? "Pending",
            hostname: obj.status?.hostname,
            buildRef: obj.status?.buildRef,
            dependencies: obj.status?.dependencies,
        }
    } catch {
        return { exists: false }
    }
}

async function readGameMetadata(gamesDir: string, gameId: string): Promise<{ displayName: string } | null> {
    try {
        const raw = await readFile(join(gamesDir, gameId, "crucible.json"), "utf-8")
        const json = JSON.parse(raw)
        return { displayName: json.displayName ?? gameId }
    } catch {
        return null
    }
}

function phaseColour(phase: string | undefined): string {
    if (!phase) return chalk.dim("—")
    switch (phase) {
        case "Running":
            return chalk.green(phase)
        case "Building":
        case "Pending":
            return chalk.yellow(phase)
        case "Failed":
            return chalk.red(phase)
        default:
            return phase
    }
}

function prototypeDetails(status: BifrostStatus): string {
    if (!status.exists) return chalk.dim("No prototype deployed")
    switch (status.phase) {
        case "Running":
            return status.hostname ?? "Running"
        case "Building":
            return status.buildRef ? `Build pod: ${status.buildRef}` : "Building…"
        case "Failed":
            return "Prototype deployment failed"
        case "Pending":
            return "Waiting for build to start"
        default:
            return status.phase ?? "Unknown"
    }
}

function summaryIcon(status: BifrostStatus): string {
    if (!status.exists) return chalk.dim("—")
    switch (status.phase) {
        case "Running":
            return chalk.green(`✓ Running`)
        case "Building":
        case "Pending":
            return chalk.yellow(`… ${status.phase}`)
        case "Failed":
            return chalk.red(`✗ Failed`)
        default:
            return status.phase ?? "—"
    }
}

async function showSingleGameStatus(gameId: string, gamesDir: string): Promise<void> {
    const meta = await readGameMetadata(gamesDir, gameId)
    const displayName = meta?.displayName ?? gameId
    const bifrost = await getBifrostStatus(gameId)

    console.log(`\n${chalk.bold(gameId)} — ${displayName}\n`)

    const tierCol = "Tier".padEnd(14)
    const statusCol = "Status".padEnd(12)
    const detailsCol = "Details"
    console.log(`  ${tierCol}${statusCol}${detailsCol}`)

    // Prototype row
    const protoStatus = bifrost.exists ? phaseColour(bifrost.phase) : chalk.dim("—")
    const protoDetails = prototypeDetails(bifrost)
    console.log(`  ${"Prototype".padEnd(14)}${protoStatus.padEnd(12)}${protoDetails}`)

    // Future environment rows
    for (const env of ["dev", "staging", "prod"]) {
        console.log(`  ${env.padEnd(14)}${chalk.dim("—").padEnd(12)}${chalk.dim("Not published")}`)
    }

    console.log("")
}

async function showAllGamesStatus(gamesDir: string): Promise<void> {
    let dirNames: string[] = []
    try {
        const entries = await readdir(gamesDir, { withFileTypes: true })
        dirNames = entries.filter((e) => e.isDirectory()).map((e) => e.name)
    } catch {
        // directory doesn't exist or not readable
    }

    if (dirNames.length === 0) {
        console.log("No games found. Run `crucible create` to get started.")
        return
    }

    // Fetch all bifrost statuses in parallel
    const statuses = await Promise.all(
        dirNames.map(async (name) => ({
            name,
            bifrost: await getBifrostStatus(name),
        })),
    )

    const nameWidth = Math.max("Name".length, ...dirNames.map((n) => n.length))

    console.log("")
    console.log(
        `  ${"Name".padEnd(nameWidth + 2)}${"Prototype".padEnd(16)}${"Dev".padEnd(8)}${"Staging".padEnd(10)}Prod`,
    )

    for (const { name, bifrost } of statuses) {
        const proto = summaryIcon(bifrost)
        console.log(
            `  ${name.padEnd(nameWidth + 2)}${proto.padEnd(16)}${chalk.dim("—").padEnd(8)}${chalk.dim("—").padEnd(10)}${chalk.dim("—")}`,
        )
    }

    console.log(`\n  ${dirNames.length} game(s) found.`)
}

export function registerStatusCommand(program: Command): void {
    program
        .command("status [game-id]")
        .description("Check game status across environments")
        .option("--env <environment>", "Filter to specific environment")
        .action(async (gameId: string | undefined, options: { env?: string }) => {
            await runStatusCommand(gameId, options)
        })
}

export async function runStatusCommand(
    gameId: string | undefined,
    options: { env?: string },
): Promise<void> {
    const paths = resolvePaths()
    const config = await loadConfig(paths)
    const gamesDir = config.gamesDir ?? paths.gamesDir

    if (gameId) {
        await showSingleGameStatus(gameId, gamesDir)
    } else {
        await showAllGamesStatus(gamesDir)
    }
}
