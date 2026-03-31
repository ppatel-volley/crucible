import type { Command } from "commander"
import { join } from "node:path"
import { stat } from "node:fs/promises"
import { startDevSession, stopDevSession } from "../dev/orchestrator.js"
import { resolvePaths } from "../config/paths.js"
import { loadConfig } from "../config/config.js"
import { createLogger } from "../util/logger.js"
import { setupSignalHandlers } from "../util/process.js"
import { usageError } from "../util/errors.js"
import type { DevPorts } from "../types.js"

export function registerDevCommand(program: Command): void {
    program
        .command("dev <game-id>")
        .description("Start local development server for a game")
        .option("--port-server <port>", "Server port", parseInt)
        .option("--port-display <port>", "Display port", parseInt)
        .option("--port-controller <port>", "Controller port", parseInt)
        .action(async (gameId: string, options: { portServer?: number; portDisplay?: number; portController?: number }) => {
            await runDevCommand(gameId, options)
        })
}

export async function runDevCommand(
    gameId: string,
    options: { portServer?: number; portDisplay?: number; portController?: number },
): Promise<void> {
    const paths = resolvePaths()
    const config = await loadConfig(paths)
    const logger = createLogger({ color: true, json: false, verbose: false, quiet: false })

    // Resolve game path
    const gamesDir = config.gamesDir ?? paths.gamesDir
    const gamePath = join(gamesDir, gameId)

    // Verify game exists
    try {
        await stat(gamePath)
    } catch {
        throw usageError(
            "CRUCIBLE-301",
            `Game "${gameId}" not found at ${gamePath}`,
            "Run `crucible create` first or check the game ID.",
        )
    }

    // Build port overrides
    const portOverrides: Partial<DevPorts> = {}
    if (options.portServer) portOverrides.server = options.portServer
    if (options.portDisplay) portOverrides.display = options.portDisplay
    if (options.portController) portOverrides.controller = options.portController

    // Build shared package before starting dev (needed for TypeScript compilation)
    const buildSpinner = logger.spinner("Building shared package...")
    try {
        const { execa } = await import("execa")
        await execa("pnpm", ["--filter", "*/shared", "build"], { cwd: gamePath })
        buildSpinner.succeed("Shared package built")
    } catch {
        buildSpinner.fail("Failed to build shared package")
        logger.warn("Shared package build failed. Dev server may not work correctly.")
    }

    const spinner = logger.spinner("Starting dev server...")

    const session = await startDevSession({
        gamePath,
        gameId,
        ports: portOverrides,
    })

    spinner.succeed("Dev server running")
    logger.info(`  Server:     http://127.0.0.1:${session.ports.server}`)
    logger.info(`  Display:    http://127.0.0.1:${session.ports.display}?sessionId=dev-test`)
    logger.info(`  Controller: http://127.0.0.1:${session.ports.controller}?sessionId=dev-test`)
    logger.info(`  Health:     http://127.0.0.1:${session.ports.server}/${gameId}/health`)
    logger.info("")
    logger.info("Press q or Ctrl+C to stop.")

    const shutdown = async (): Promise<void> => {
        logger.info("Shutting down...")
        await stopDevSession(session)
    }

    // Setup signal handlers for graceful shutdown
    setupSignalHandlers(shutdown)

    // Setup q key listener (TTY only)
    if (process.stdin.isTTY) {
        process.stdin.setRawMode(true)
        process.stdin.resume()
        process.stdin.on("data", (data: Buffer) => {
            const key = String(data)
            if (key === "q" || key === "Q") {
                shutdown().then(() => process.exit(0)).catch(() => process.exit(1))
            }
        })
    }

    // Keep process alive — wait forever (until signal or q)
    await new Promise(() => {})
}
