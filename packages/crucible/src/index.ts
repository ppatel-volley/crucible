#!/usr/bin/env node

import { Command } from "commander"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { GlobalOptions } from "./types.js"
import { registerCreateCommand } from "./commands/create.js"
import { registerAgentCommand } from "./commands/agent.js"
import { registerDevCommand } from "./commands/dev.js"
import { registerPublishCommand } from "./commands/publish.js"
import { registerRollbackCommand } from "./commands/rollback.js"
import { registerLogsCommand } from "./commands/logs.js"
import { registerStatusCommand } from "./commands/status.js"
import { registerListCommand } from "./commands/list.js"
import { registerLoginCommand } from "./commands/login.js"
import { registerPromoteCommand } from "./commands/promote.js"
import { CrucibleError } from "./util/errors.js"

export function resolveGlobalOptions(program: Command): GlobalOptions {
    const opts = program.opts()
    return {
        color: opts.color ?? true,
        json: opts.json ?? false,
        verbose: opts.verbose ?? false,
        quiet: opts.quiet ?? false,
    }
}

function detectColorDefault(): boolean {
    if (process.env.NO_COLOR !== undefined) return false
    if (process.env.TERM === "dumb") return false
    if (!process.stdout.isTTY) return false
    return true
}

function getConfigFilePath(): string {
    if (process.platform === "win32") {
        return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "crucible", "config.json")
    }
    return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "crucible", "config.json")
}

function createProgram(): Command {
    const program = new Command()

    program
        .name("crucible")
        .description("Build TV games with AI")
        .version("0.1.0")
        .option("--no-color", "Disable colour output", detectColorDefault())
        .option("--json", "Output as JSON", false)
        .option("-v, --verbose", "Verbose output", false)
        .option("-q, --quiet", "Suppress non-essential output", false)

    registerCreateCommand(program)
    registerAgentCommand(program)
    registerDevCommand(program)
    registerPublishCommand(program)
    registerRollbackCommand(program)
    registerLogsCommand(program)
    registerStatusCommand(program)
    registerListCommand(program)
    registerLoginCommand(program)
    registerPromoteCommand(program)

    return program
}

/** Parse global flags from raw argv without requiring commander parse */
function resolveGlobalOptionsFromArgv(): GlobalOptions {
    const args = process.argv.slice(2)
    return {
        color: !args.includes("--no-color") && detectColorDefault(),
        json: args.includes("--json"),
        verbose: args.includes("--verbose") || args.includes("-v"),
        quiet: args.includes("--quiet") || args.includes("-q"),
    }
}

async function main(): Promise<void> {
    const program = createProgram()

    // First-run detection — use argv-based flag parsing (before commander parse)
    const configFile = getConfigFilePath()
    if (!existsSync(configFile) && process.argv.length <= 2) {
        const opts = resolveGlobalOptionsFromArgv()
        if (opts.json) {
            console.log(JSON.stringify({ welcome: true, message: "Welcome to Crucible — build TV games with AI." }))
        } else {
            console.log()
            console.log("  Welcome to Crucible — build TV games with AI.")
            console.log()
            console.log("  Step 1: crucible login")
            console.log("  Step 2: crucible create \"My Game\"")
            console.log()
            console.log("  For documentation: crucible --help")
            console.log()
        }
    }

    await program.parseAsync(process.argv)
}

main().catch((error: unknown) => {
    if (error instanceof CrucibleError) {
        const opts = resolveGlobalOptionsFromArgv()
        if (opts.json) {
            console.error(JSON.stringify({
                error: true,
                code: error.code,
                category: error.category,
                shortName: error.shortName,
                message: error.message,
                recovery: error.recovery,
                retryable: error.retryable,
            }))
        } else {
            console.error(`✗ ${error.message}`)
            if (error.recovery) {
                console.error()
                console.error(`  Recovery:`)
                console.error(`    ${error.recovery}`)
            }
            console.error()
            console.error(`  Error: ${error.code} (${error.category}/${error.shortName})`)
        }
        process.exit(error.exitCode)
    }

    if (error instanceof Error) {
        console.error(`✗ ${error.message}`)
        process.exit(1)
    }

    console.error("✗ An unexpected error occurred")
    process.exit(1)
})

export { createProgram }
