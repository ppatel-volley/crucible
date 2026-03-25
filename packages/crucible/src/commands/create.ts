import type { Command } from "commander"
import { existsSync } from "node:fs"
import { mkdir, writeFile, rm } from "node:fs/promises"
import { join, dirname } from "node:path"
import type {
    CreateOptions,
    CreateResult,
    CrucibleConfig,
    CruciblePaths,
    GeneratedFile,
    GlobalOptions,
    Logger,
} from "../types.js"
import { buildTokenMap, validateGameName } from "../template/index.js"
import { cloneTemplate, replaceTokens, removeTemplateArtifacts } from "../template/index.js"
import { generateDockerfile, generateCIWorkflow, generateCrucibleJson } from "../template/index.js"
import { templateError, usageError, runProcess } from "../util/index.js"
import { loadConfig } from "../config/index.js"
import { resolvePaths } from "../config/index.js"
import { createLogger } from "../util/index.js"
import { getGitHubToken, createGitHubClient, createGameRepo, deleteGameRepo } from "../api/index.js"
import { createGitOperations } from "../git/index.js"

function resolveGlobalOpts(program: Command): GlobalOptions {
    const opts = program.opts()
    return {
        color: opts.color ?? true,
        json: opts.json ?? false,
        verbose: opts.verbose ?? false,
        quiet: opts.quiet ?? false,
    }
}

export function registerCreateCommand(program: Command): void {
    program
        .command("create <display-name>")
        .description("Create a new TV game")
        .option("-d, --description <desc>", "Game description", "")
        .option("--skip-github", "Skip GitHub repo creation", true)
        .option("--skip-install", "Skip pnpm install", false)
        .action(async (displayName: string, opts: { description: string; skipGithub: boolean; skipInstall: boolean }) => {
            const paths = resolvePaths()
            const config = await loadConfig(paths)
            const logger = createLogger(resolveGlobalOpts(program))

            const options: CreateOptions = {
                displayName,
                description: opts.description,
                skipGithub: opts.skipGithub,
                skipInstall: opts.skipInstall,
            }

            const result = await executeCreate(options, config, paths, logger)
            logger.success(`Created ${result.gameId} at ${result.gamePath}`)
        })
}

export async function writeGeneratedFiles(gamePath: string, files: GeneratedFile[]): Promise<void> {
    for (const file of files) {
        const fullPath = join(gamePath, file.path)
        await mkdir(dirname(fullPath), { recursive: true })
        await writeFile(fullPath, file.content, "utf-8")
    }
}

type StepName = "clone" | "artifacts" | "tokens" | "generate" | "npmrc" | "install" | "github-repo" | "git-push"

export async function executeCreate(
    options: CreateOptions,
    config: CrucibleConfig,
    paths: CruciblePaths,
    logger: Logger,
): Promise<CreateResult> {
    const completedSteps: StepName[] = []
    const tokenMap = buildTokenMap(options.displayName)
    const kebab = tokenMap.gameNameKebab.to

    // Validate game name
    const validation = validateGameName(kebab)
    if (!validation.valid) {
        throw usageError(
            "CRUCIBLE-200",
            `Invalid game name "${kebab}": ${validation.error}`,
            "Choose a display name that produces a valid kebab-case identifier (3-50 chars, lowercase alphanumeric and hyphens).",
        )
    }

    // Resolve game path
    const gamesDir = config.gamesDir ?? paths.gamesDir
    const gamePath = join(gamesDir, kebab)

    // Check target directory doesn't exist
    if (existsSync(gamePath)) {
        throw templateError(
            "CRUCIBLE-202",
            `Directory already exists: ${gamePath}`,
            `Remove the existing directory or choose a different game name.`,
        )
    }

    // Resolve template source — use config, but allow override from options
    const templateSource = options.templateSource ?? config.templateSource

    try {
        // Step 1: Clone template
        logger.info(`Creating "${options.displayName}" (${kebab})...`)
        const spinner = logger.spinner("Cloning template...")
        try {
            await cloneTemplate(templateSource, gamePath)
            completedSteps.push("clone")
            spinner.succeed("Cloned template")
        } catch (err) {
            spinner.fail("Failed to clone template")
            throw templateError(
                "CRUCIBLE-801",
                "Failed to clone template",
                "Check that the template source is accessible.",
                { cause: err instanceof Error ? err : new Error(String(err)) },
            )
        }

        // Step 2: Remove template artifacts
        const artifactSpinner = logger.spinner("Removing template artefacts...")
        try {
            await removeTemplateArtifacts(gamePath)
            completedSteps.push("artifacts")
            artifactSpinner.succeed("Removed template artefacts")
        } catch (err) {
            artifactSpinner.fail("Failed to remove template artefacts")
            throw templateError(
                "CRUCIBLE-802",
                "Failed to remove template artefacts",
                "Check file permissions in the target directory.",
                { cause: err instanceof Error ? err : new Error(String(err)) },
            )
        }

        // Step 3: Replace tokens
        const tokenSpinner = logger.spinner("Replacing tokens...")
        try {
            await replaceTokens({ targetPath: gamePath, tokenMap })
            completedSteps.push("tokens")
            tokenSpinner.succeed("Replaced tokens")
        } catch (err) {
            tokenSpinner.fail("Failed to replace tokens")
            throw templateError(
                "CRUCIBLE-803",
                "Failed to replace tokens",
                "Check that template files are valid text files.",
                { cause: err instanceof Error ? err : new Error(String(err)) },
            )
        }

        // Step 4: Generate Dockerfile, CI workflow, crucible.json
        const genSpinner = logger.spinner("Generating project files...")
        try {
            const dockerfile = await generateDockerfile(tokenMap)
            const ciWorkflow = await generateCIWorkflow(tokenMap)
            const crucibleJson = generateCrucibleJson({
                tokenMap,
                author: config.userEmail ?? "unknown@volley.com",
                description: options.description ?? "",
                dockerfileChecksum: dockerfile.checksum,
                ciWorkflowChecksum: ciWorkflow.checksum,
                templateVersion: "0.1.0",
            })

            await writeGeneratedFiles(gamePath, [dockerfile, ciWorkflow, crucibleJson])
            completedSteps.push("generate")
            genSpinner.succeed("Generated Dockerfile + CI workflow + crucible.json")
        } catch (err) {
            genSpinner.fail("Failed to generate project files")
            throw templateError(
                "CRUCIBLE-804",
                "Failed to generate project files",
                "This is likely a bug — please report it.",
                { cause: err instanceof Error ? err : new Error(String(err)) },
            )
        }

        // Step 5: Generate .npmrc
        const npmrcSpinner = logger.spinner("Generating .npmrc...")
        try {
            const npmrcContent = "//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n"
            await writeFile(join(gamePath, ".npmrc"), npmrcContent, "utf-8")
            completedSteps.push("npmrc")
            npmrcSpinner.succeed("Generated .npmrc")
        } catch (err) {
            npmrcSpinner.fail("Failed to generate .npmrc")
            throw templateError(
                "CRUCIBLE-805",
                "Failed to generate .npmrc",
                "Check file permissions in the target directory.",
                { cause: err instanceof Error ? err : new Error(String(err)) },
            )
        }

        // Step 6: pnpm install (unless --skip-install)
        if (!options.skipInstall) {
            const installSpinner = logger.spinner("Installing dependencies...")
            try {
                const result = await runProcess("pnpm", ["install"], { cwd: gamePath })
                if (result.exitCode !== 0) {
                    throw new Error(`pnpm install exited with code ${result.exitCode}: ${result.stderr}`)
                }
                completedSteps.push("install")
                installSpinner.succeed("Installed dependencies")
            } catch (err) {
                installSpinner.fail("Failed to install dependencies")
                throw templateError(
                    "CRUCIBLE-806",
                    "Failed to install dependencies",
                    "Try running `pnpm install` manually in the game directory.",
                    { cause: err instanceof Error ? err : new Error(String(err)) },
                )
            }
        }

        // Step 7: GitHub repo creation (unless --skip-github)
        let repoUrl: string | undefined
        if (!options.skipGithub) {
            const ghSpinner = logger.spinner("Creating GitHub repository...")
            try {
                const token = getGitHubToken()
                const octokit = createGitHubClient(token)
                const repoResult = await createGameRepo(octokit, {
                    org: config.githubOrg,
                    gameId: kebab,
                    displayName: options.displayName,
                    githubToken: token,
                })
                completedSteps.push("github-repo")
                repoUrl = repoResult.htmlUrl
                ghSpinner.succeed(`Created repo ${repoResult.fullName}`)

                // Step 8: Git init, commit, push
                const gitSpinner = logger.spinner("Initialising git and pushing...")
                try {
                    const git = createGitOperations()
                    await git.init(gamePath)
                    await git.add(gamePath, ["."])
                    await git.commit(gamePath, "Initial scaffold from Crucible")
                    await git.addRemote(gamePath, "origin", repoResult.cloneUrl)
                    await git.push(gamePath, "origin", "main")
                    completedSteps.push("git-push")
                    gitSpinner.succeed("Pushed to GitHub")
                } catch (err) {
                    gitSpinner.fail("Failed to push to GitHub")
                    throw templateError(
                        "CRUCIBLE-205",
                        "Failed to initialise git and push",
                        "Check your git configuration and network connection.",
                        { cause: err instanceof Error ? err : new Error(String(err)) },
                    )
                }
            } catch (err) {
                if (!completedSteps.includes("github-repo")) {
                    ghSpinner.fail("Failed to create GitHub repository")
                }
                throw err
            }
        }

        // Success output
        logger.info("")
        logger.success(`Game created at ${gamePath}`)
        if (repoUrl) {
            logger.success(`GitHub repo: ${repoUrl}`)
        }
        logger.info("")
        logger.info("Next steps:")
        logger.info(`  crucible agent ${kebab}     # Build your game with AI`)
        logger.info(`  crucible dev ${kebab}       # Preview locally`)
        logger.info("")

        return {
            gamePath,
            gameId: kebab,
            repoUrl,
        }
    } catch (err) {
        // Rollback on failure
        await rollback(completedSteps, gamePath, logger, config, kebab)
        throw err
    }
}

async function rollback(completedSteps: StepName[], gamePath: string, logger: Logger, config?: CrucibleConfig, gameId?: string): Promise<void> {
    const reversed = [...completedSteps].reverse()

    for (const step of reversed) {
        switch (step) {
            case "github-repo":
                // Best-effort delete of the GitHub repo
                try {
                    const token = process.env.GITHUB_TOKEN
                    if (token && config && gameId) {
                        const octokit = createGitHubClient(token)
                        const repoName = `crucible-game-${gameId}`
                        await deleteGameRepo(octokit, config.githubOrg, repoName)
                        logger.warn(`Rolled back: deleted GitHub repo ${config.githubOrg}/${repoName}`)
                    }
                } catch (rollbackErr) {
                    logger.warn(`Rollback warning: failed to delete GitHub repo: ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`)
                }
                break
            case "git-push":
                // Nothing to roll back — repo deletion handles this
                break
            case "clone":
            case "artifacts":
            case "tokens":
            case "generate":
            case "npmrc":
            case "install":
                // All of these are rolled back by removing the directory
                try {
                    if (existsSync(gamePath)) {
                        await rm(gamePath, { recursive: true, force: true })
                        logger.warn(`Rolled back: removed ${gamePath}`)
                    }
                } catch (rollbackErr) {
                    logger.warn(`Rollback warning: failed to remove ${gamePath}: ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`)
                }
                return // Once we remove the directory, no more rollback needed
        }
    }
}
