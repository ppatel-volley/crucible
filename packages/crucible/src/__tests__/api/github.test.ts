import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
    createGitHubClient,
    createGameRepo,
    deleteGameRepo,
    applyProtectionRulesets,
    repoExists,
    getGitHubToken,
} from "../../api/github.js"
import { CrucibleError } from "../../util/errors.js"

// Mock Octokit
vi.mock("@octokit/rest", () => {
    return {
        Octokit: vi.fn().mockImplementation(() => ({
            repos: {
                get: vi.fn(),
                createInOrg: vi.fn(),
                createForAuthenticatedUser: vi.fn(),
                delete: vi.fn(),
            },
            request: vi.fn(),
        })),
    }
})

function createMockOctokit() {
    return {
        repos: {
            get: vi.fn(),
            createInOrg: vi.fn(),
            createForAuthenticatedUser: vi.fn(),
            delete: vi.fn(),
        },
        request: vi.fn(),
    } as unknown as ReturnType<typeof createGitHubClient>
}

describe("getGitHubToken", () => {
    const originalEnv = process.env.GITHUB_TOKEN

    afterEach(() => {
        if (originalEnv !== undefined) {
            process.env.GITHUB_TOKEN = originalEnv
        } else {
            delete process.env.GITHUB_TOKEN
        }
    })

    it("returns token when GITHUB_TOKEN is set", () => {
        process.env.GITHUB_TOKEN = "ghp_test123"
        expect(getGitHubToken()).toBe("ghp_test123")
    })

    it("throws CRUCIBLE-102 when GITHUB_TOKEN is missing", () => {
        delete process.env.GITHUB_TOKEN
        try {
            getGitHubToken()
            expect.fail("Should have thrown")
        } catch (err) {
            expect(err).toBeInstanceOf(CrucibleError)
            expect((err as CrucibleError).code).toBe("CRUCIBLE-102")
            expect((err as CrucibleError).category).toBe("auth")
        }
    })
})

describe("createGitHubClient", () => {
    it("returns an Octokit instance", () => {
        const client = createGitHubClient("ghp_test")
        expect(client).toBeDefined()
    })
})

describe("repoExists", () => {
    it("returns true when repo exists", async () => {
        const octokit = createMockOctokit()
        const getMock = vi.mocked(octokit.repos.get)
        getMock.mockResolvedValue({ data: {} } as never)

        const result = await repoExists(octokit, "ppatel-volley", "crucible-game-test")
        expect(result).toBe(true)
        expect(getMock).toHaveBeenCalledWith({
            owner: "ppatel-volley",
            repo: "crucible-game-test",
        })
    })

    it("returns false when repo returns 404", async () => {
        const octokit = createMockOctokit()
        const getMock = vi.mocked(octokit.repos.get)
        const error = new Error("Not Found") as Error & { status: number }
        error.status = 404
        getMock.mockRejectedValue(error)

        const result = await repoExists(octokit, "ppatel-volley", "crucible-game-test")
        expect(result).toBe(false)
    })
})

describe("createGameRepo", () => {
    it("creates repo with correct payload and returns URLs", async () => {
        const octokit = createMockOctokit()
        vi.mocked(octokit.repos.get).mockRejectedValue(
            Object.assign(new Error("Not Found"), { status: 404 }),
        )
        vi.mocked(octokit.repos.createInOrg).mockResolvedValue({
            data: {
                clone_url: "https://github.com/ppatel-volley/crucible-game-scottish-trivia.git",
                html_url: "https://github.com/ppatel-volley/crucible-game-scottish-trivia",
                full_name: "ppatel-volley/crucible-game-scottish-trivia",
            },
        } as never)
        vi.mocked(octokit.request).mockResolvedValue({ data: {} } as never)

        const result = await createGameRepo(octokit, {
            org: "ppatel-volley",
            gameId: "scottish-trivia",
            displayName: "Scottish Trivia",
            githubToken: "ghp_test",
        })

        expect(result.cloneUrl).toBe("https://github.com/ppatel-volley/crucible-game-scottish-trivia.git")
        expect(result.htmlUrl).toBe("https://github.com/ppatel-volley/crucible-game-scottish-trivia")
        expect(result.fullName).toBe("ppatel-volley/crucible-game-scottish-trivia")

        expect(vi.mocked(octokit.repos.createInOrg)).toHaveBeenCalledWith(
            expect.objectContaining({
                org: "ppatel-volley",
                name: "crucible-game-scottish-trivia",
                private: true,
                auto_init: false,
            }),
        )
    })

    it("repo name follows crucible-game-{kebab} pattern", async () => {
        const octokit = createMockOctokit()
        vi.mocked(octokit.repos.get).mockRejectedValue(
            Object.assign(new Error("Not Found"), { status: 404 }),
        )
        vi.mocked(octokit.repos.createInOrg).mockResolvedValue({
            data: {
                clone_url: "https://github.com/ppatel-volley/crucible-game-my-cool-game.git",
                html_url: "https://github.com/ppatel-volley/crucible-game-my-cool-game",
                full_name: "ppatel-volley/crucible-game-my-cool-game",
            },
        } as never)
        vi.mocked(octokit.request).mockResolvedValue({ data: {} } as never)

        await createGameRepo(octokit, {
            org: "ppatel-volley",
            gameId: "my-cool-game",
            displayName: "My Cool Game",
            githubToken: "ghp_test",
        })

        expect(vi.mocked(octokit.repos.createInOrg)).toHaveBeenCalledWith(
            expect.objectContaining({
                name: "crucible-game-my-cool-game",
            }),
        )
    })

    it("throws CRUCIBLE-206 when org does not exist", async () => {
        const octokit = createMockOctokit()
        // repoExists returns false (404)
        vi.mocked(octokit.repos.get).mockRejectedValue(
            Object.assign(new Error("Not Found"), { status: 404 }),
        )
        // createInOrg fails with 404 (org not found)
        vi.mocked(octokit.repos.createInOrg).mockRejectedValue(
            Object.assign(new Error("Not Found"), { status: 404 }),
        )
        try {
            await createGameRepo(octokit, {
                org: "ppatel",
                gameId: "test",
                displayName: "Test Game",
                githubToken: "ghp_test",
            })
            expect.fail("Should have thrown")
        } catch (err) {
            expect(err).toBeInstanceOf(CrucibleError)
            expect((err as CrucibleError).code).toBe("CRUCIBLE-206")
            expect(vi.mocked(octokit.repos.createInOrg)).toHaveBeenCalled()
        }
    })

    it("throws CRUCIBLE-201 when repo already exists", async () => {
        const octokit = createMockOctokit()
        vi.mocked(octokit.repos.get).mockResolvedValue({
            data: {
                clone_url: "https://github.com/ppatel-volley/crucible-game-scottish-trivia.git",
                html_url: "https://github.com/ppatel-volley/crucible-game-scottish-trivia",
                full_name: "ppatel-volley/crucible-game-scottish-trivia",
            },
        } as never)
        try {
            await createGameRepo(octokit, {
                org: "ppatel-volley",
                gameId: "scottish-trivia",
                displayName: "Scottish Trivia",
                githubToken: "ghp_test",
            })
            expect.fail("Should have thrown")
        } catch (err) {
            expect(err).toBeInstanceOf(CrucibleError)
            expect((err as CrucibleError).code).toBe("CRUCIBLE-201")
            expect(vi.mocked(octokit.repos.createInOrg)).not.toHaveBeenCalled()
        }
    })
})

describe("applyProtectionRulesets", () => {
    it("applies rulesets with all 5 protected paths", async () => {
        const octokit = createMockOctokit()
        vi.mocked(octokit.request).mockResolvedValue({ data: {} } as never)

        await applyProtectionRulesets(octokit, "ppatel-volley", "crucible-game-test")

        expect(vi.mocked(octokit.request)).toHaveBeenCalledWith(
            "POST /repos/{owner}/{repo}/rulesets",
            expect.objectContaining({
                owner: "ppatel-volley",
                repo: "crucible-game-test",
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
                            restricted_file_paths: [
                                "Dockerfile",
                                ".github/workflows/**",
                                ".npmrc",
                                "pnpm-lock.yaml",
                                "pnpm-workspace.yaml",
                            ],
                        },
                    },
                ],
            }),
        )
    })
})

describe("deleteGameRepo", () => {
    it("calls delete endpoint with correct owner and repo", async () => {
        const octokit = createMockOctokit()
        vi.mocked(octokit.repos.delete).mockResolvedValue({} as never)

        await deleteGameRepo(octokit, "ppatel-volley", "crucible-game-test")

        expect(vi.mocked(octokit.repos.delete)).toHaveBeenCalledWith({
            owner: "ppatel-volley",
            repo: "crucible-game-test",
        })
    })
})
