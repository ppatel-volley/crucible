import type { Command } from "commander"
import { createInterface } from "node:readline"
import { join } from "node:path"
import { stat } from "node:fs/promises"
import { assembleContext } from "../agent/context.js"
import { runAgentTurn } from "../agent/runner.js"
import {
    createSession,
    saveSession,
    findLatestSession,
    updateSession,
} from "../agent/session.js"
import { resolvePaths } from "../config/paths.js"
import { loadConfig } from "../config/config.js"
import { createLogger } from "../util/logger.js"
import { usageError, authError } from "../util/errors.js"
import type { AgentSession } from "../types.js"

export function registerAgentCommand(program: Command): void {
    program
        .command("agent <game-id>")
        .description("Start an AI agent session for a game")
        .option("--resume", "Resume the most recent session", false)
        .option("--model <model>", "Claude model to use")
        .action(async (gameId: string, options: { resume: boolean; model?: string }) => {
            await runAgentCommand(gameId, options)
        })
}

export async function runAgentCommand(
    gameId: string,
    options: { resume: boolean; model?: string },
): Promise<void> {
    const paths = resolvePaths()
    const config = await loadConfig(paths)
    const logger = createLogger({ color: true, json: false, verbose: false, quiet: false })

    // 1. Resolve game path and verify it exists
    const gamesDir = config.gamesDir ?? paths.gamesDir
    const gamePath = join(gamesDir, gameId)

    try {
        const info = await stat(gamePath)
        if (!info.isDirectory()) {
            throw usageError(
                "CRUCIBLE-200",
                `Game path is not a directory: ${gamePath}`,
                `Run "crucible create ${gameId}" to create a new game`,
            )
        }
    } catch (err: unknown) {
        if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
            throw usageError(
                "CRUCIBLE-200",
                `Game directory not found: ${gamePath}`,
                `Run "crucible create ${gameId}" to create a new game`,
            )
        }
        throw err
    }

    // 2. Check API key
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
        throw authError(
            "CRUCIBLE-104",
            "Anthropic API key not found",
            "Set ANTHROPIC_API_KEY environment variable",
        )
    }

    // 3. Handle --resume
    let session: AgentSession
    if (options.resume) {
        const existing = await findLatestSession(gameId)
        if (existing) {
            session = existing
            logger.info(`Resuming session ${session.sessionId.slice(0, 8)}...`)
        } else {
            session = createSession(gameId, gamePath)
            logger.info("No previous session found, starting fresh.")
        }
    } else {
        session = createSession(gameId, gamePath)
    }

    // 4. Assemble context
    const spinner = logger.spinner("Loading game context...")
    const context = await assembleContext({ gamePath })
    spinner.succeed(
        `Game context loaded (${context.totalTokens.toLocaleString()} tokens, ${context.files.length} files)`,
    )

    // 5. Input loop
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const model = options.model ?? config.agentModel

    // Ctrl+C handling
    let ctrlCCount = 0
    let ctrlCTimer: ReturnType<typeof setTimeout> | null = null

    rl.on("close", async () => {
        await saveSession(session)
        process.exit(0)
    })

    process.on("SIGINT", () => {
        ctrlCCount++
        if (ctrlCCount >= 2) {
            console.log("\nForce exit. Uncommitted changes remain on disk.")
            process.exit(1)
        }
        console.log("\nPress Ctrl+C again to exit.")
        if (ctrlCTimer) clearTimeout(ctrlCTimer)
        ctrlCTimer = setTimeout(() => {
            ctrlCCount = 0
        }, 1000)
    })

    console.log(`\nAgent: I've loaded ${gameId}. What would you like to build?\n`)

    const prompt = (): void => {
        rl.question("You: ", async (input) => {
            const trimmed = input.trim()
            if (!trimmed || trimmed === "exit" || trimmed === "quit") {
                await saveSession(session)
                console.log("\nSession saved. Goodbye!")
                rl.close()
                return
            }

            const turnSpinner = logger.spinner("Working...")
            try {
                const { result } = await runAgentTurn(
                    { gamePath, gameId, sessionId: session.sessionId, apiKey, model, context },
                    trimmed,
                    session.messages as any, // session messages → Anthropic format
                )

                turnSpinner.stop()

                // Show edit summary if files were modified
                if (result.filesModified.length > 0) {
                    for (const [i, file] of result.filesModified.entries()) {
                        console.log(`  [${i + 1}/${result.filesModified.length}] Edited ${file}`)
                    }
                    if (result.commitSha) {
                        console.log(`  ✓ Committed (${result.commitSha})`)
                    }
                    console.log()
                }

                // Show response
                console.log(`Agent: ${result.response}\n`)

                // Update session
                session = updateSession(
                    session,
                    [
                        { role: "user", content: trimmed },
                        { role: "assistant", content: result.response },
                    ],
                    result.tokenUsage,
                )
                await saveSession(session)
            } catch (err) {
                turnSpinner.fail("Error")
                console.error(err instanceof Error ? err.message : String(err))
                console.log()
            }

            prompt()
        })
    }

    prompt()
}
