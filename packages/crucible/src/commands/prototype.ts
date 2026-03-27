import type { Command } from "commander"
import { join } from "node:path"
import { stat, readFile, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolvePaths } from "../config/paths.js"
import { loadConfig } from "../config/config.js"
import { createLogger } from "../util/logger.js"
import { usageError, networkError } from "../util/errors.js"
import { generateGamePrototypeCRD, serializeGamePrototypeCRD, parseDependencies } from "../prototype/crd.js"

export function registerPrototypeCommand(program: Command): void {
    program
        .command("prototype <game-id>")
        .description("Deploy game to Kubernetes via Bifrost for prototype testing")
        .option("--watch", "Rebuild and redeploy on file changes", false)
        .option("--dependencies <deps>", "Infrastructure dependencies (name:type,name:type)")
        .option("--delete", "Remove the prototype and clean up resources", false)
        .option("--source <repo>", "Git repo URL for source-based build (Bifrost Buildpacks)")
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
        source?: string
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
        } catch {
            spinner.fail("Failed to delete prototype")
            throw networkError(
                "CRUCIBLE-901",
                `Failed to delete prototype for "${gameId}"`,
                "Check kubectl access and cluster connectivity.",
            )
        }
        return
    }

    // Check kubectl access
    await checkKubectlAccess()

    // Deploy prototype
    const spinner = logger.spinner("Deploying prototype...")

    // Resolve GitHub repo URL for source-based builds
    const repoUrl = options.source ?? await resolveGitHubRepoUrl(gamePath)

    // Generate the GamePrototype CRD
    const crd = generateGamePrototypeCRD({
        gameId,
        imageTag: "source-build",
        registryHost: options.registry,
        port: options.port,
        websocket: true,
        dependencies: options.dependencies,
    })

    // If we have a repo URL, use spec.source instead of spec.image
    if (repoUrl) {
        const spec = crd.spec as unknown as Record<string, unknown>
        delete spec.image
        spec.source = {
            url: repoUrl,
            revision: "main",
        }
    }

    // Write CRD to temp file and apply via kubectl
    const crdYaml = serializeGamePrototypeCRD(crd)
    const tmpFile = join(tmpdir(), `crucible-prototype-${gameId}-${Date.now()}.yaml`)

    try {
        await writeFile(tmpFile, crdYaml, "utf-8")
        await kubectlApply(tmpFile)
        spinner.succeed("GamePrototype applied")

        // Poll for status
        const statusSpinner = logger.spinner("Waiting for Bifrost...")
        const status = await pollPrototypeStatus(gameId, 120)
        statusSpinner.succeed(`Prototype ${status.phase.toLowerCase()}`)

        // Print result
        if (status.phase === "Running") {
            console.log("")
            console.log(`  Prototype live!`)
            console.log(`    Hostname: ${status.hostname}`)
            if (status.dependencies) {
                console.log(`    Dependencies:`)
                for (const [name, dep] of Object.entries(status.dependencies)) {
                    console.log(`      ${name} (${dep.type}): ${dep.databaseName ?? dep.bucket ?? dep.keyPrefix ?? "ready"}`)
                }
            }
            console.log("")
        } else if (status.phase === "Building") {
            console.log("")
            console.log(`  Prototype is building. Check status with:`)
            console.log(`    kubectl get gameprototype ${gameId} -o yaml`)
            if (status.buildRef) {
                console.log(`    kubectl logs ${status.buildRef} -n ${gameId}-prototype`)
            }
            console.log("")
        } else {
            console.log("")
            console.log(`  Prototype status: ${status.phase}`)
            console.log(`  Check details: kubectl get gameprototype ${gameId} -o yaml`)
            console.log("")
        }
    } finally {
        await rm(tmpFile, { force: true })
    }
}

/**
 * Delete a GamePrototype CRD via kubectl.
 */
async function deletePrototype(gameId: string): Promise<void> {
    const { execa } = await import("execa")
    await execa("kubectl", ["delete", "gameprototype", gameId, "--ignore-not-found"])
}

/**
 * Check that kubectl is available and configured.
 */
async function checkKubectlAccess(): Promise<void> {
    const { execa } = await import("execa")
    try {
        await execa("kubectl", ["cluster-info", "--request-timeout=5s"])
    } catch {
        throw usageError(
            "CRUCIBLE-904",
            "Cannot connect to Kubernetes cluster",
            "Ensure kubectl is installed and configured. Run `kubectl cluster-info` to diagnose.",
        )
    }
}

/**
 * Apply a YAML file via kubectl.
 */
async function kubectlApply(filePath: string): Promise<void> {
    const { execa } = await import("execa")
    try {
        await execa("kubectl", ["apply", "-f", filePath])
    } catch (err) {
        throw networkError(
            "CRUCIBLE-901",
            "Failed to apply GamePrototype to cluster",
            "Check kubectl access and that the Bifrost CRD is installed.",
        )
    }
}

/**
 * Resolve the GitHub remote URL from the game's git config.
 */
async function resolveGitHubRepoUrl(gamePath: string): Promise<string | null> {
    const { execa } = await import("execa")
    try {
        const result = await execa("git", ["remote", "get-url", "origin"], { cwd: gamePath })
        const url = result.stdout.trim()
        if (url) return url
    } catch {
        // No remote — that's fine, will need --source or image-based deploy
    }
    return null
}

interface PrototypeStatus {
    phase: string
    hostname?: string
    buildRef?: string
    dependencies?: Record<string, { type: string; databaseName?: string; bucket?: string; keyPrefix?: string }>
}

/**
 * Poll GamePrototype status until Running, Failed, or timeout.
 */
async function pollPrototypeStatus(gameId: string, timeoutSeconds: number): Promise<PrototypeStatus> {
    const { execa } = await import("execa")
    const deadline = Date.now() + timeoutSeconds * 1000

    while (Date.now() < deadline) {
        try {
            const result = await execa("kubectl", [
                "get", "gameprototype", gameId,
                "-o", "jsonpath={.status.phase},{.status.hostname},{.status.buildRef}",
            ])
            const [phase, hostname, buildRef] = result.stdout.split(",")

            if (phase === "Running" || phase === "Failed") {
                // Get full status for dependencies
                const fullResult = await execa("kubectl", [
                    "get", "gameprototype", gameId, "-o", "json",
                ])
                const obj = JSON.parse(fullResult.stdout)
                return {
                    phase: phase ?? "Unknown",
                    hostname: hostname || obj.status?.hostname,
                    buildRef: buildRef || obj.status?.buildRef,
                    dependencies: obj.status?.dependencies,
                }
            }
        } catch {
            // kubectl failed — might not exist yet, retry
        }

        await new Promise((r) => setTimeout(r, 5000))
    }

    return { phase: "Timeout" }
}
