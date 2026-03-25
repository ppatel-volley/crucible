import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { join } from "node:path"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { checkFileRestriction, logViolation, globMatch } from "../../agent/restrictions.js"
import type { FileRestrictionViolation } from "../../types.js"

const GAME_PATH = "/home/user/crucible-games/my-game"

describe("checkFileRestriction", () => {
    describe("allowed paths", () => {
        it("allows writes to apps/server/src/reducers.ts", () => {
            const result = checkFileRestriction("apps/server/src/reducers.ts", GAME_PATH)
            expect(result.allowed).toBe(true)
        })

        it("allows writes to apps/display/src/components/Foo.tsx", () => {
            const result = checkFileRestriction("apps/display/src/components/Foo.tsx", GAME_PATH)
            expect(result.allowed).toBe(true)
        })

        it("allows writes to packages/shared/src/types.ts", () => {
            const result = checkFileRestriction("packages/shared/src/types.ts", GAME_PATH)
            expect(result.allowed).toBe(true)
        })

        it("allows writes to apps/controller/src/index.ts", () => {
            const result = checkFileRestriction("apps/controller/src/index.ts", GAME_PATH)
            expect(result.allowed).toBe(true)
        })

        it("allows writes to apps/server/package.json", () => {
            const result = checkFileRestriction("apps/server/package.json", GAME_PATH)
            expect(result.allowed).toBe(true)
        })

        it("allows writes to packages/shared/package.json", () => {
            const result = checkFileRestriction("packages/shared/package.json", GAME_PATH)
            expect(result.allowed).toBe(true)
        })
    })

    describe("denied paths", () => {
        it("denies writes to Dockerfile", () => {
            const result = checkFileRestriction("Dockerfile", GAME_PATH)
            expect(result.allowed).toBe(false)
            expect(result.deniedPattern).toBe("Dockerfile")
        })

        it("denies writes to .github/workflows/deploy.yml", () => {
            const result = checkFileRestriction(".github/workflows/deploy.yml", GAME_PATH)
            expect(result.allowed).toBe(false)
            expect(result.deniedPattern).toBe(".github/**")
        })

        it("denies writes to pnpm-lock.yaml", () => {
            const result = checkFileRestriction("pnpm-lock.yaml", GAME_PATH)
            expect(result.allowed).toBe(false)
            expect(result.deniedPattern).toBe("pnpm-lock.yaml")
        })

        it("denies writes to node_modules/foo/bar.js", () => {
            const result = checkFileRestriction("node_modules/foo/bar.js", GAME_PATH)
            expect(result.allowed).toBe(false)
            expect(result.deniedPattern).toBe("node_modules/**")
        })

        it("denies writes to crucible.json", () => {
            const result = checkFileRestriction("crucible.json", GAME_PATH)
            expect(result.allowed).toBe(false)
            expect(result.deniedPattern).toBe("crucible.json")
        })

        it("denies writes to .npmrc", () => {
            const result = checkFileRestriction(".npmrc", GAME_PATH)
            expect(result.allowed).toBe(false)
            expect(result.deniedPattern).toBe(".npmrc")
        })

        it("denies writes to pnpm-workspace.yaml", () => {
            const result = checkFileRestriction("pnpm-workspace.yaml", GAME_PATH)
            expect(result.allowed).toBe(false)
            expect(result.deniedPattern).toBe("pnpm-workspace.yaml")
        })

        it("denies writes to .git/config", () => {
            const result = checkFileRestriction(".git/config", GAME_PATH)
            expect(result.allowed).toBe(false)
            expect(result.deniedPattern).toBe(".git/**")
        })
    })

    describe("default deny", () => {
        it("denies writes to unlisted paths", () => {
            const result = checkFileRestriction("random-file.txt", GAME_PATH)
            expect(result.allowed).toBe(false)
            expect(result.reason).toContain("not in any allowed pattern")
        })

        it("denies writes to root-level scripts", () => {
            const result = checkFileRestriction("setup.sh", GAME_PATH)
            expect(result.allowed).toBe(false)
        })
    })

    describe("denied patterns take precedence over allowed patterns", () => {
        it("denies node_modules even if it looks like an allowed path", () => {
            const result = checkFileRestriction("node_modules/apps/server/src/foo.ts", GAME_PATH)
            expect(result.allowed).toBe(false)
            expect(result.deniedPattern).toBe("node_modules/**")
        })
    })

    describe("absolute path handling", () => {
        it("handles absolute paths by making them relative", () => {
            const absPath = join(GAME_PATH, "apps/server/src/index.ts")
            const result = checkFileRestriction(absPath, GAME_PATH)
            expect(result.allowed).toBe(true)
        })

        it("denies absolute paths to denied files", () => {
            const absPath = join(GAME_PATH, "Dockerfile")
            const result = checkFileRestriction(absPath, GAME_PATH)
            expect(result.allowed).toBe(false)
            expect(result.deniedPattern).toBe("Dockerfile")
        })
    })
})

describe("globMatch", () => {
    it("matches exact strings", () => {
        expect(globMatch("Dockerfile", "Dockerfile")).toBe(true)
        expect(globMatch("Dockerfile", "Other")).toBe(false)
    })

    it("matches ** for multi-segment wildcards", () => {
        expect(globMatch(".github/**", ".github/workflows/deploy.yml")).toBe(true)
        expect(globMatch("node_modules/**", "node_modules/foo/bar.js")).toBe(true)
    })

    it("matches * for single-segment wildcards", () => {
        expect(globMatch("apps/*/package.json", "apps/server/package.json")).toBe(true)
        expect(globMatch("apps/*/package.json", "apps/server/src/package.json")).toBe(false)
    })
})

describe("logViolation", () => {
    let tmpDir: string

    beforeEach(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), "crucible-audit-"))
    })

    afterEach(async () => {
        await rm(tmpDir, { recursive: true, force: true })
    })

    it("writes a JSON line to the audit log", async () => {
        const logPath = join(tmpDir, "audit.log")
        const violation: FileRestrictionViolation = {
            path: "Dockerfile",
            reason: "denied-pattern",
            deniedPattern: "Dockerfile",
            timestamp: "2026-03-25T00:00:00.000Z",
            sessionId: "test-session-1",
            userEmail: "test@example.com",
        }

        await logViolation(violation, logPath)

        const content = await readFile(logPath, "utf-8")
        const parsed = JSON.parse(content.trim())
        expect(parsed.path).toBe("Dockerfile")
        expect(parsed.reason).toBe("denied-pattern")
        expect(parsed.sessionId).toBe("test-session-1")
    })

    it("appends multiple violations to the same file", async () => {
        const logPath = join(tmpDir, "audit.log")
        const base: FileRestrictionViolation = {
            path: "Dockerfile",
            reason: "denied-pattern",
            deniedPattern: "Dockerfile",
            timestamp: "2026-03-25T00:00:00.000Z",
            sessionId: "test-session-1",
        }

        await logViolation(base, logPath)
        await logViolation({ ...base, path: ".npmrc", deniedPattern: ".npmrc" }, logPath)

        const content = await readFile(logPath, "utf-8")
        const lines = content.trim().split("\n")
        expect(lines).toHaveLength(2)
        expect(JSON.parse(lines[0]).path).toBe("Dockerfile")
        expect(JSON.parse(lines[1]).path).toBe(".npmrc")
    })

    it("creates parent directories if they don't exist", async () => {
        const logPath = join(tmpDir, "nested", "deep", "audit.log")
        const violation: FileRestrictionViolation = {
            path: "crucible.json",
            reason: "denied-pattern",
            deniedPattern: "crucible.json",
            timestamp: "2026-03-25T00:00:00.000Z",
            sessionId: "test-session-2",
        }

        await logViolation(violation, logPath)

        const content = await readFile(logPath, "utf-8")
        const parsed = JSON.parse(content.trim())
        expect(parsed.path).toBe("crucible.json")
    })
})
