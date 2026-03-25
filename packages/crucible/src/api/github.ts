import { Octokit } from "@octokit/rest"
import type { CreateRepoOptions, CreateRepoResult } from "../types.js"
import { CrucibleError, authError, gitError, networkError } from "../util/errors.js"

const PROTECTED_PATHS = [
    "Dockerfile",
    ".github/workflows/**",
    ".npmrc",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
]

export function getGitHubToken(): string {
    const token = process.env.GITHUB_TOKEN
    if (!token) {
        throw authError(
            "CRUCIBLE-102",
            "GitHub token not found",
            "Set the GITHUB_TOKEN environment variable or run `crucible login`.",
        )
    }
    return token
}

export function createGitHubClient(token: string): Octokit {
    return new Octokit({ auth: token })
}

export async function repoExists(octokit: Octokit, org: string, repoName: string): Promise<boolean> {
    try {
        await octokit.repos.get({ owner: org, repo: repoName })
        return true
    } catch (err: unknown) {
        if (err instanceof Error && "status" in err && (err as { status: number }).status === 404) {
            return false
        }
        throw networkError(
            "CRUCIBLE-401",
            `Failed to check if repo ${org}/${repoName} exists`,
            "Check your network connection and GitHub token permissions.",
            { cause: err instanceof Error ? err : new Error(String(err)), retryable: true },
        )
    }
}

export async function createGameRepo(octokit: Octokit, options: CreateRepoOptions): Promise<CreateRepoResult> {
    const repoName = `crucible-game-${options.gameId}`

    const exists = await repoExists(octokit, options.org, repoName)
    if (exists) {
        throw gitError(
            "CRUCIBLE-201",
            `Repository ${options.org}/${repoName} already exists`,
            "Choose a different game name or delete the existing repository.",
        )
    }

    try {
        const { data } = await octokit.repos.createInOrg({
            org: options.org,
            name: repoName,
            description: `${options.displayName} — a Crucible TV game`,
            private: true,
            auto_init: false,
        })

        try {
            await applyProtectionRulesets(octokit, options.org, repoName)
        } catch (rulesetErr) {
            // Ruleset failed after repo creation — clean up the orphan repo
            await octokit.repos.delete({ owner: options.org, repo: repoName }).catch(() => {})
            throw rulesetErr
        }

        return {
            cloneUrl: data.clone_url,
            htmlUrl: data.html_url,
            fullName: data.full_name,
        }
    } catch (err: unknown) {
        if (err instanceof CrucibleError) {
            throw err
        }
        throw networkError(
            "CRUCIBLE-401",
            `Failed to create repository ${options.org}/${repoName}`,
            "Check your network connection and GitHub token permissions.",
            { cause: err instanceof Error ? err : new Error(String(err)), retryable: true },
        )
    }
}

export async function applyProtectionRulesets(octokit: Octokit, owner: string, repo: string): Promise<void> {
    try {
        await octokit.request("POST /repos/{owner}/{repo}/rulesets", {
            owner,
            repo,
            name: "crucible-protected-files",
            target: "branch",
            enforcement: "active",
            conditions: {
                ref_name: {
                    include: ["refs/heads/main"],
                    exclude: [],
                },
            },
            rules: [
                {
                    type: "file_path_restriction",
                    parameters: {
                        restricted_file_paths: PROTECTED_PATHS,
                    },
                },
            ],
        })
    } catch (err: unknown) {
        throw networkError(
            "CRUCIBLE-401",
            `Failed to apply protection rulesets to ${owner}/${repo}`,
            "Check your GitHub token has admin permissions on the repository.",
            { cause: err instanceof Error ? err : new Error(String(err)), retryable: true },
        )
    }
}

export async function deleteGameRepo(octokit: Octokit, org: string, repoName: string): Promise<void> {
    try {
        await octokit.repos.delete({ owner: org, repo: repoName })
    } catch (err: unknown) {
        throw networkError(
            "CRUCIBLE-401",
            `Failed to delete repository ${org}/${repoName}`,
            "You may need to delete the repository manually via GitHub.",
            { cause: err instanceof Error ? err : new Error(String(err)), retryable: false },
        )
    }
}
