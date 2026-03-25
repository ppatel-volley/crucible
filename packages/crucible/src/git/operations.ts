import simpleGit from "simple-git"
import type { GitOperations } from "../types.js"

export function createGitOperations(): GitOperations {
    return {
        async init(path: string): Promise<void> {
            const git = simpleGit(path)
            await git.init(["--initial-branch=main"])
        },

        async add(path: string, files: string[]): Promise<void> {
            const git = simpleGit(path)
            await git.add(files)
        },

        async commit(path: string, message: string): Promise<string> {
            const git = simpleGit(path)
            const result = await git.commit(message)
            return result.commit
        },

        async push(path: string, remote: string, branch: string): Promise<void> {
            const git = simpleGit(path)
            await git.push(remote, branch)
        },

        async addRemote(path: string, name: string, url: string): Promise<void> {
            const git = simpleGit(path)
            await git.addRemote(name, url)
        },

        async getHeadSha(path: string): Promise<string> {
            const git = simpleGit(path)
            const sha = await git.revparse(["--short=7", "HEAD"])
            return sha.trim()
        },

        async isClean(path: string): Promise<boolean> {
            const git = simpleGit(path)
            const status = await git.status()
            return status.isClean()
        },
    }
}
