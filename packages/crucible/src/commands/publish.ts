import type { Command } from "commander"
import { join } from "node:path"
import { stat, readFile } from "node:fs/promises"
import { resolvePaths } from "../config/paths.js"
import { loadConfig } from "../config/config.js"
import { usageError, networkError, gitError, templateError } from "../util/errors.js"
import { createGitOperations } from "../git/operations.js"
import { computeFileChecksum } from "../git/validation.js"
import { getGitHubToken, createGitHubClient } from "../api/github.js"
import { createLogger } from "../util/logger.js"
import type { CrucibleJson, Logger } from "../types.js"
import type { Octokit } from "@octokit/rest"

export interface PrototypeConfig {
    phase: string
    port: number
    hostname: string
    dependencies: Record<string, { type: string }>
    env: Record<string, string>
}

export interface WorkflowRunStatus {
    id: number
    status: "queued" | "in_progress" | "completed"
    conclusion: "success" | "failure" | "cancelled" | null
    html_url: string
}

export interface WorkflowJobResult {
    name: string
    conclusion: "success" | "failure" | "cancelled" | "skipped" | null
    durationSeconds: number
}

export function parseGitRemoteUrl(url: string): { owner: string; repo: string } {
    // Handle HTTPS: https://github.com/Volley-Inc/crucible-game-foo.git
    // Handle SSH: git@github.com:Volley-Inc/crucible-game-foo.git
    const httpsMatch = url.match(/github\.com\/([^/]+)\/([^/.]+)/)
    const sshMatch = url.match(/github\.com:([^/]+)\/([^/.]+)/)
    const match = httpsMatch ?? sshMatch
    if (!match) throw new Error(`Cannot parse GitHub remote URL: ${url}`)
    return { owner: match[1]!, repo: match[2]! }
}

function formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds.toFixed(1)}s`
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}m ${secs.toFixed(0)}s`
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function findWorkflowRun(
    octokit: Octokit,
    owner: string,
    repo: string,
    headSha: string,
    timeoutMs: number,
): Promise<WorkflowRunStatus> {
    const deadline = Date.now() + timeoutMs
    const pollInterval = 5000
    const maxFindTimeout = Math.min(60000, timeoutMs) // 60s max to find the run

    const findDeadline = Date.now() + maxFindTimeout

    while (Date.now() < findDeadline) {
        let runs: Array<{ id: number; name?: string | null; status: string | null; conclusion: string | null; html_url: string; created_at?: string }>
        try {
            const { data } = await octokit.actions.listWorkflowRunsForRepo({
                owner,
                repo,
                head_sha: headSha,
                per_page: 10,
            })
            runs = data.workflow_runs
        } catch (err) {
            throw networkError(
                "CRUCIBLE-501",
                "Failed to query GitHub Actions API",
                "Check your GitHub token permissions and network connection.",
                { cause: err instanceof Error ? err : new Error(String(err)), retryable: true },
            )
        }

        if (runs.length > 0) {
            // Prefer a run whose workflow name contains "crucible" or "deploy",
            // sorted by most recently created to avoid picking stale re-runs
            const sorted = [...runs].sort(
                (a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime(),
            )
            const preferred = sorted.find(
                (r) =>
                    r.name?.toLowerCase().includes("crucible") ||
                    r.name?.toLowerCase().includes("deploy"),
            )
            const run = preferred ?? sorted[0]!
            return {
                id: run.id,
                status: run.status as WorkflowRunStatus["status"],
                conclusion: run.conclusion as WorkflowRunStatus["conclusion"],
                html_url: run.html_url,
            }
        }

        const remaining = findDeadline - Date.now()
        if (remaining <= 0) break
        await sleep(Math.min(pollInterval, remaining))
    }

    throw networkError(
        "CRUCIBLE-501",
        "No CI workflow run found for this commit",
        "Check that the repository has a GitHub Actions workflow configured.",
    )
}

export async function pollWorkflowRun(
    octokit: Octokit,
    owner: string,
    repo: string,
    runId: number,
    logger: Logger,
    timeoutMs: number,
): Promise<{ run: WorkflowRunStatus; jobs: WorkflowJobResult[] }> {
    const deadline = Date.now() + timeoutMs
    const pollInterval = 5000
    const spinner = logger.spinner("CI pipeline running...")

    try {
        while (Date.now() < deadline) {
            const { data: run } = await octokit.actions.getWorkflowRun({
                owner,
                repo,
                run_id: runId,
            })

            const { data: jobsData } = await octokit.actions.listJobsForWorkflowRun({
                owner,
                repo,
                run_id: runId,
            })

            // Find the currently active job and show step progress
            const activeJob = jobsData.jobs.find((j) => j.status === "in_progress")
            if (activeJob) {
                const completedSteps = activeJob.steps?.filter((s) => s.status === "completed").length ?? 0
                const totalSteps = activeJob.steps?.length ?? 0
                spinner.update(`CI pipeline running... ${activeJob.name} (${completedSteps}/${totalSteps} steps done)`)
            }

            if (run.status === "completed") {
                spinner.stop()

                const jobs: WorkflowJobResult[] = jobsData.jobs.map((j) => {
                    const started = j.started_at ? new Date(j.started_at).getTime() : 0
                    const completed = j.completed_at ? new Date(j.completed_at).getTime() : 0
                    const durationSeconds = started && completed ? (completed - started) / 1000 : 0
                    return {
                        name: j.name,
                        conclusion: j.conclusion as WorkflowJobResult["conclusion"],
                        durationSeconds,
                    }
                })

                return {
                    run: {
                        id: run.id,
                        status: run.status as WorkflowRunStatus["status"],
                        conclusion: run.conclusion as WorkflowRunStatus["conclusion"],
                        html_url: run.html_url,
                    },
                    jobs,
                }
            }

            const remaining = deadline - Date.now()
            if (remaining <= 0) break
            await sleep(Math.min(pollInterval, remaining))
        }
    } catch (err) {
        spinner.stop()
        // Wrap raw API errors with a proper CRUCIBLE code
        if (err instanceof Error && "code" in err && (err as { code: string }).code?.startsWith("CRUCIBLE")) {
            throw err
        }
        throw networkError(
            "CRUCIBLE-505",
            "CI polling failed — GitHub API error",
            "Check your GitHub token permissions and network connection.",
            { cause: err instanceof Error ? err : new Error(String(err)), retryable: true },
        )
    }

    spinner.stop()
    throw networkError(
        "CRUCIBLE-505",
        "CI pipeline timed out",
        "The pipeline is still running on GitHub. Check the Actions tab for status.",
    )
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

    // Push to GitHub
    const pushSpinner = logger.spinner("Pushing to GitHub...")
    const git = createGitOperations()
    let sha: string
    try {
        await git.push(gamePath, "origin", "main")
        sha = await git.getHeadSha(gamePath)
        pushSpinner.succeed(`Pushed to GitHub (${sha})`)
    } catch (err) {
        pushSpinner.fail("Push failed")
        throw gitError("CRUCIBLE-205", "Failed to push to GitHub", "Check your git remote and credentials.")
    }

    // Get repo info from remote URL
    const remoteUrl = await git.getRemoteUrl(gamePath, "origin")
    const { owner, repo } = parseGitRemoteUrl(remoteUrl)

    // Authenticate with GitHub API
    const token = getGitHubToken()
    const octokit = createGitHubClient(token)

    // Find the workflow run triggered by our push
    const timeoutMs = options.timeout * 60 * 1000
    const run = await findWorkflowRun(octokit, owner, repo, sha, timeoutMs)
    logger.success(`CI pipeline triggered (run #${run.id})`)

    // Poll workflow run to completion
    const { run: finalRun, jobs } = await pollWorkflowRun(octokit, owner, repo, run.id, logger, timeoutMs)

    // Display job results
    for (const job of jobs) {
        const duration = formatDuration(job.durationSeconds)
        if (job.conclusion === "success") {
            console.log(`  ✓ ${job.name} passed (${duration})`)
        } else if (job.conclusion === "skipped") {
            console.log(`  - ${job.name} skipped`)
        } else {
            console.log(`  ✗ ${job.name} failed`)
        }
    }

    console.log("")

    if (finalRun.conclusion === "success") {
        logger.success(`Published! ${gameId} is live on ${options.env}.`)
        console.log(`  Run: ${finalRun.html_url}`)
    } else {
        const failedJob = jobs.find((j) => j.conclusion === "failure")
        const failedName = failedJob?.name ?? "unknown step"
        logger.fail(`Publish failed at ${failedName}`)
        console.log(`  See: ${finalRun.html_url}`)
        console.log("")
        throw networkError(
            "CRUCIBLE-501",
            `CI pipeline failed at ${failedName}`,
            `Check the workflow run for details: ${finalRun.html_url}`,
        )
    }
}
