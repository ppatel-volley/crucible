import type { Command } from "commander"
import { join } from "node:path"
import { stat, readFile } from "node:fs/promises"
import { resolvePaths } from "../config/paths.js"
import { loadConfig } from "../config/config.js"
import { usageError, networkError, gitError, templateError } from "../util/errors.js"
import { createGitOperations } from "../git/operations.js"
import { computeFileChecksum } from "../git/validation.js"
import { createLogger } from "../util/logger.js"
import type { CrucibleJson } from "../types.js"

export interface PrototypeConfig {
    phase: string
    port: number
    hostname: string
    dependencies: Record<string, { type: string }>
    env: Record<string, string>
}

export async function getPrototypeConfig(gameId: string): Promise<PrototypeConfig | null> {
    const { execa } = await import("execa")
    try {
        const result = await execa("kubectl", [
            "get", "gameprototype", gameId, "-o", "json",
        ])
        const obj = JSON.parse(result.stdout)
        return {
            phase: obj.status?.phase ?? "Unknown",
            port: obj.spec?.port ?? 3000,
            hostname: obj.status?.hostname ?? "",
            dependencies: obj.spec?.dependencies ?? {},
            env: obj.spec?.env ?? {},
        }
    } catch {
        return null
    }
}

export function registerPublishCommand(program: Command): void {
    program
        .command("publish <game-id>")
        .description("Publish game to registry — pushes to GitHub and monitors CI pipeline")
        .option("--timeout <minutes>", "CI polling timeout in minutes", parseInt, 10)
        .option("--env <environment>", "Target environment", "dev")
        .option("--from-prototype", "Graduate from Bifrost prototype to production", false)
        .action(async (gameId: string, options: { timeout: number; env: string; fromPrototype: boolean }) => {
            await runPublishCommand(gameId, options)
        })
}

export async function runPreFlightChecks(gamePath: string): Promise<void> {
    const git = createGitOperations()

    // 1. Git working tree is clean
    const clean = await git.isClean(gamePath)
    if (!clean) {
        throw gitError(
            "CRUCIBLE-202",
            "Uncommitted changes detected",
            "Commit or stash your changes before publishing.",
        )
    }

    // 2. crucible.json exists and is valid
    let crucibleJson: CrucibleJson
    try {
        const raw = await readFile(join(gamePath, "crucible.json"), "utf-8")
        crucibleJson = JSON.parse(raw) as CrucibleJson
    } catch {
        throw usageError(
            "CRUCIBLE-200",
            "Invalid or missing crucible.json",
            "This directory was not created by crucible. Run `crucible create` first.",
        )
    }

    // 3. Dockerfile checksum matches crucible.json
    const dockerfileChecksum = await computeFileChecksum(join(gamePath, "Dockerfile"))
    if (dockerfileChecksum !== crucibleJson.checksums.dockerfile) {
        throw templateError(
            "CRUCIBLE-801",
            "Dockerfile checksum mismatch",
            "The Dockerfile has been modified. Run `crucible create` to regenerate it or update crucible.json.",
        )
    }

    // 4. GitHub remote exists
    const hasOrigin = await git.hasRemote(gamePath, "origin")
    if (!hasOrigin) {
        throw gitError(
            "CRUCIBLE-203",
            "No GitHub remote configured",
            "This game was created with --skip-github. Push manually or re-create with GitHub integration.",
        )
    }
}

export async function runPublishCommand(
    gameId: string,
    options: { timeout: number; env: string; fromPrototype?: boolean },
): Promise<void> {
    const paths = resolvePaths()
    const config = await loadConfig(paths)
    const gamesDir = config.gamesDir ?? paths.gamesDir
    const gamePath = join(gamesDir, gameId)

    // Verify game exists
    try {
        await stat(gamePath)
    } catch {
        throw usageError("CRUCIBLE-301", `Game "${gameId}" not found at ${gamePath}`, "Run `crucible create` first or check the game ID.")
    }

    // Validate environment
    const validEnvs = ["dev", "staging", "prod"]
    if (!validEnvs.includes(options.env)) {
        throw usageError("CRUCIBLE-200", `Invalid environment "${options.env}"`, `Use one of: ${validEnvs.join(", ")}`)
    }

    const logger = createLogger({ color: true, json: false, verbose: false, quiet: false })

    // Run pre-flight checks
    const spinner = logger.spinner("Running pre-flight checks...")
    await runPreFlightChecks(gamePath)
    spinner.succeed("Pre-flight checks passed")

    // Graduation path
    if (options.fromPrototype) {
        const proto = await getPrototypeConfig(gameId)
        if (!proto) {
            throw usageError("CRUCIBLE-901", `No Bifrost prototype found for "${gameId}"`, "Deploy a prototype first with `crucible prototype`.")
        }
        if (proto.phase !== "Running") {
            throw usageError("CRUCIBLE-901", `Prototype is ${proto.phase}, not Running`, "Wait for the prototype to be healthy before graduating.")
        }

        // Show graduation summary
        console.log("")
        console.log("  Graduating prototype to production:")
        console.log(`    Port: ${proto.port}`)
        if (Object.keys(proto.dependencies).length > 0) {
            const depSummary = Object.entries(proto.dependencies).map(([k, v]) => `${k} (${v.type})`).join(", ")
            console.log(`    Dependencies: ${depSummary}`)
        }
        const envCount = Object.keys(proto.env).length
        if (envCount > 0) {
            console.log(`    Env vars: ${envCount}`)
        }
        console.log("")
    }

    // TODO: git push + CI polling (Phase 2)
    throw networkError("CRUCIBLE-501", "CI pipeline integration is not yet implemented", "This command will be available after Phase 2 infrastructure is provisioned.")
}
