import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { cp, readFile, readdir, stat, writeFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { cloneTemplate, replaceTokens, removeTemplateArtifacts } from "../../template/engine.js"
import { buildTokenMap } from "../../template/tokens.js"

const FIXTURE_DIR = join(__dirname, "..", "fixtures", "template-sample")

function makeTmpDir(): string {
    return join(tmpdir(), `crucible-test-${randomUUID()}`)
}

describe("cloneTemplate", () => {
    let tmpDir: string

    beforeEach(() => {
        tmpDir = makeTmpDir()
    })

    afterEach(async () => {
        const { rm } = await import("node:fs/promises")
        await rm(tmpDir, { recursive: true, force: true })
    })

    it("copies local template, excluding .git and node_modules", async () => {
        // Create a fake .git dir in fixture to verify exclusion
        const fakeGit = join(FIXTURE_DIR, ".git")
        await mkdir(fakeGit, { recursive: true })
        await writeFile(join(fakeGit, "HEAD"), "ref: refs/heads/main\n")

        try {
            await cloneTemplate({ type: "local", path: FIXTURE_DIR }, tmpDir)

            // package.json should exist
            const rootPkg = await readFile(join(tmpDir, "package.json"), "utf-8")
            expect(rootPkg).toContain("hello-weekend")

            // .git should NOT exist
            await expect(stat(join(tmpDir, ".git"))).rejects.toThrow()

            // Nested files should exist
            const sharedTypes = await readFile(
                join(tmpDir, "packages", "shared", "src", "types.ts"),
                "utf-8",
            )
            expect(sharedTypes).toContain("HelloWeekendState")
        } finally {
            const { rm } = await import("node:fs/promises")
            await rm(fakeGit, { recursive: true, force: true })
        }
    })
})

describe("replaceTokens", () => {
    let tmpDir: string

    beforeEach(async () => {
        tmpDir = makeTmpDir()
        await cp(FIXTURE_DIR, tmpDir, { recursive: true })
    })

    afterEach(async () => {
        const { rm } = await import("node:fs/promises")
        await rm(tmpDir, { recursive: true, force: true })
    })

    it("replaces all token types in fixture files", async () => {
        const tokenMap = buildTokenMap("Scottish Trivia")
        const result = await replaceTokens({ targetPath: tmpDir, tokenMap })

        expect(result.filesProcessed).toBeGreaterThan(0)
        expect(result.tokensReplaced).toBeGreaterThan(0)

        // Root package.json
        const rootPkg = await readFile(join(tmpDir, "package.json"), "utf-8")
        expect(rootPkg).not.toContain("hello-weekend")
        expect(rootPkg).toContain("scottish-trivia")

        // Server package.json — scope replacement
        const serverPkg = await readFile(join(tmpDir, "apps", "server", "package.json"), "utf-8")
        expect(serverPkg).not.toContain("@hello-weekend")
        expect(serverPkg).toContain("@scottish-trivia")

        // Shared types — PascalCase replacement
        const sharedTypes = await readFile(
            join(tmpDir, "packages", "shared", "src", "types.ts"),
            "utf-8",
        )
        expect(sharedTypes).not.toContain("HelloWeekend")
        expect(sharedTypes).toContain("ScottishTrivia")

        // Server ruleset — import path + type name
        const ruleset = await readFile(join(tmpDir, "apps", "server", "src", "ruleset.ts"), "utf-8")
        expect(ruleset).not.toContain("@hello-weekend")
        expect(ruleset).not.toContain("HelloWeekend")
        expect(ruleset).toContain("@scottish-trivia")
        expect(ruleset).toContain("ScottishTrivia")
    })

    it("leaves zero hello-weekend or HelloWeekend references", async () => {
        const tokenMap = buildTokenMap("Scottish Trivia")
        await replaceTokens({ targetPath: tmpDir, tokenMap })

        // Walk all text files and check
        const { walkAllTextFiles } = await getTextFiles(tmpDir)
        for (const { path, content } of walkAllTextFiles) {
            expect(content, `${path} still contains hello-weekend`).not.toContain("hello-weekend")
            expect(content, `${path} still contains HelloWeekend`).not.toContain("HelloWeekend")
            expect(content, `${path} still contains @hello-weekend`).not.toContain(
                "@hello-weekend",
            )
        }
    })

    it("does not corrupt binary-like files by skipping them", async () => {
        // Create a fake .png file with binary-ish content
        const pngPath = join(tmpDir, "icon.png")
        const binaryContent = Buffer.from([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x68, 0x65, 0x6c, 0x6c, 0x6f,
        ])
        await writeFile(pngPath, binaryContent)

        const tokenMap = buildTokenMap("Scottish Trivia")
        await replaceTokens({ targetPath: tmpDir, tokenMap })

        // Binary file should be unchanged
        const afterContent = await readFile(pngPath)
        expect(Buffer.compare(afterContent, binaryContent)).toBe(0)
    })
})

describe("removeTemplateArtifacts", () => {
    let tmpDir: string

    beforeEach(async () => {
        tmpDir = makeTmpDir()
        await cp(FIXTURE_DIR, tmpDir, { recursive: true })
    })

    afterEach(async () => {
        const { rm } = await import("node:fs/promises")
        await rm(tmpDir, { recursive: true, force: true })
    })

    it("removes AGENTS.md and learnings/", async () => {
        const removed = await removeTemplateArtifacts(tmpDir)

        expect(removed).toContain("AGENTS.md")
        expect(removed).toContain("learnings")

        // Verify actually deleted
        await expect(stat(join(tmpDir, "AGENTS.md"))).rejects.toThrow()
        await expect(stat(join(tmpDir, "learnings"))).rejects.toThrow()
    })

    it("does not fail when artefacts are missing", async () => {
        // Remove AGENTS.md first, then call removeTemplateArtifacts
        const { rm } = await import("node:fs/promises")
        await rm(join(tmpDir, "AGENTS.md"))

        const removed = await removeTemplateArtifacts(tmpDir)
        // Should still remove learnings
        expect(removed).toContain("learnings")
        // Should NOT include AGENTS.md since it was already gone
        expect(removed).not.toContain("AGENTS.md")
    })
})

// Helper to walk all text files
async function getTextFiles(
    dir: string,
): Promise<{ walkAllTextFiles: Array<{ path: string; content: string }> }> {
    const textExts = new Set([".ts", ".tsx", ".json", ".yaml", ".yml", ".md", ".html", ".sh", ".css", ".svg"])
    const results: Array<{ path: string; content: string }> = []

    async function walk(d: string): Promise<void> {
        const entries = await readdir(d, { withFileTypes: true })
        for (const entry of entries) {
            const fullPath = join(d, entry.name)
            if (entry.isDirectory()) {
                await walk(fullPath)
            } else {
                const ext = fullPath.substring(fullPath.lastIndexOf(".")).toLowerCase()
                if (textExts.has(ext)) {
                    const content = await readFile(fullPath, "utf-8")
                    results.push({ path: fullPath, content })
                }
            }
        }
    }

    await walk(dir)
    return { walkAllTextFiles: results }
}
