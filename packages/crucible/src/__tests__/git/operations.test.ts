import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createGitOperations } from "../../git/operations.js"

describe("createGitOperations", () => {
    let tempDir: string
    const git = createGitOperations()

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "crucible-git-test-"))
    })

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true })
    })

    it("init creates repo with main branch", async () => {
        await git.init(tempDir)

        const simpleGit = (await import("simple-git")).default
        const repo = simpleGit(tempDir)
        const currentBranch = await repo.raw(["branch", "--show-current"])
        expect(currentBranch.trim()).toBe("main")
    })

    it("add + commit creates a commit and returns valid SHA", async () => {
        await git.init(tempDir)

        const testFile = join(tempDir, "test.txt")
        await writeFile(testFile, "hello")

        await git.add(tempDir, ["test.txt"])
        const sha = await git.commit(tempDir, "initial commit")

        expect(sha).toBeTruthy()
        expect(typeof sha).toBe("string")
    })

    it("isClean returns true for clean repo, false after modifying a file", async () => {
        await git.init(tempDir)

        const testFile = join(tempDir, "test.txt")
        await writeFile(testFile, "hello")
        await git.add(tempDir, ["test.txt"])
        await git.commit(tempDir, "initial commit")

        expect(await git.isClean(tempDir)).toBe(true)

        await writeFile(testFile, "modified")
        expect(await git.isClean(tempDir)).toBe(false)
    })

    it("getHeadSha returns 7-char hex string", async () => {
        await git.init(tempDir)

        const testFile = join(tempDir, "test.txt")
        await writeFile(testFile, "hello")
        await git.add(tempDir, ["test.txt"])
        await git.commit(tempDir, "initial commit")

        const sha = await git.getHeadSha(tempDir)
        expect(sha).toMatch(/^[0-9a-f]{7}$/)
    })

    it("addRemote adds a remote", async () => {
        await git.init(tempDir)

        await git.addRemote(tempDir, "origin", "https://github.com/test/repo.git")

        const simpleGit = (await import("simple-git")).default
        const repo = simpleGit(tempDir)
        const remotes = await repo.getRemotes(true)
        const origin = remotes.find((r) => r.name === "origin")
        expect(origin).toBeDefined()
        expect(origin!.refs.fetch).toBe("https://github.com/test/repo.git")
    })
})
