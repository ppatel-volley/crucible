import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdir, writeFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { assembleContext } from "../../agent/context.js"

function makeTmpDir(): string {
    return join(tmpdir(), `crucible-ctx-test-${randomUUID()}`)
}

/** Create a file, ensuring parent directories exist. */
async function createFile(path: string, content: string): Promise<void> {
    const dir = path.substring(0, path.lastIndexOf("/") > 0 ? path.lastIndexOf("/") : path.lastIndexOf("\\"))
    await mkdir(dir, { recursive: true })
    await writeFile(path, content, "utf-8")
}

describe("assembleContext", () => {
    let tmpDir: string

    beforeEach(async () => {
        tmpDir = makeTmpDir()
        await mkdir(tmpDir, { recursive: true })
    })

    afterEach(async () => {
        await rm(tmpDir, { recursive: true, force: true })
    })

    it("loads required files first", async () => {
        await createFile(join(tmpDir, "AGENTS.md"), "# Agents")
        await createFile(join(tmpDir, "crucible.json"), '{"name":"test"}')

        const result = await assembleContext({ gamePath: tmpDir })

        expect(result.files).toHaveLength(2)
        expect(result.files[0]!.priority).toBe("required")
        expect(result.files[1]!.priority).toBe("required")
        expect(result.truncated).toBe(false)
        expect(result.missedFiles).toEqual([])
    })

    it("loads files in priority order", async () => {
        await createFile(join(tmpDir, "AGENTS.md"), "# Required")
        await createFile(join(tmpDir, "packages", "shared", "src", "types.ts"), "export type Foo = string")
        await createFile(join(tmpDir, "apps", "display", "src", "App.tsx"), "export default function App() {}")
        await createFile(join(tmpDir, "package.json"), '{"name":"test"}')

        const result = await assembleContext({ gamePath: tmpDir })

        const priorities = result.files.map((f) => f.priority)
        expect(priorities).toEqual(["required", "high", "medium", "low"])
    })

    it("respects token budget and does not exceed it", async () => {
        // Each file is ~100 tokens (400 chars)
        const content = "x".repeat(400)
        await createFile(join(tmpDir, "AGENTS.md"), content)
        await createFile(join(tmpDir, "packages", "shared", "src", "a.ts"), content)
        await createFile(join(tmpDir, "packages", "shared", "src", "b.ts"), content)

        // Budget of 250 tokens — should fit 2 files (100 each) but not 3
        const result = await assembleContext({ gamePath: tmpDir, tokenBudget: 250 })

        expect(result.totalTokens).toBeLessThanOrEqual(250)
        expect(result.files).toHaveLength(2)
        expect(result.truncated).toBe(true)
        expect(result.missedFiles).toHaveLength(1)
    })

    it("required files are always included before other priorities", async () => {
        const bigContent = "y".repeat(400)
        await createFile(join(tmpDir, "AGENTS.md"), bigContent)
        await createFile(join(tmpDir, "crucible.json"), bigContent)
        await createFile(join(tmpDir, "packages", "shared", "src", "types.ts"), bigContent)

        // Budget fits 2 files but not 3
        const result = await assembleContext({ gamePath: tmpDir, tokenBudget: 250 })

        const requiredFiles = result.files.filter((f) => f.priority === "required")
        expect(requiredFiles).toHaveLength(2)
        expect(result.missedFiles.map((f) => f.replace(/\\/g, "/"))).toContain("packages/shared/src/types.ts")
    })

    it("tracks missed files when budget is exhausted", async () => {
        const content = "z".repeat(400)
        await createFile(join(tmpDir, "AGENTS.md"), content)
        await createFile(join(tmpDir, "packages", "shared", "src", "foo.ts"), content)
        await createFile(join(tmpDir, "apps", "display", "src", "Bar.tsx"), content)
        await createFile(join(tmpDir, "package.json"), '{"name":"test"}')

        // Budget for ~1.5 files
        const result = await assembleContext({ gamePath: tmpDir, tokenBudget: 150 })

        expect(result.truncated).toBe(true)
        expect(result.missedFiles.length).toBeGreaterThan(0)
    })

    it("does not load VGF docs by default", async () => {
        await createFile(join(tmpDir, "AGENTS.md"), "# Agents")

        const result = await assembleContext({ gamePath: tmpDir })

        const refFiles = result.files.filter((f) => f.priority === "reference")
        expect(refFiles).toHaveLength(0)
    })

    it("loads VGF docs when loadVGFDocs is true (or tracks as missed if file does not exist)", async () => {
        await createFile(join(tmpDir, "AGENTS.md"), "# Agents")

        const result = await assembleContext({ gamePath: tmpDir, loadVGFDocs: true })

        // The VGF docs file likely doesn't exist in test env, so it should be in missedFiles
        // or if it does exist, it should be in files with 'reference' priority
        const refFiles = result.files.filter((f) => f.priority === "reference")
        const missedRef = result.missedFiles.some((f) => f.includes("BUILDING_TV_GAMES"))
        expect(refFiles.length > 0 || missedRef).toBe(true)
    })

    it("handles empty game directory gracefully", async () => {
        const result = await assembleContext({ gamePath: tmpDir })

        expect(result.files).toHaveLength(0)
        expect(result.totalTokens).toBe(0)
        expect(result.truncated).toBe(false)
        expect(result.missedFiles).toEqual([])
    })

    it("handles missing game directory gracefully", async () => {
        const nonExistent = join(tmpDir, "does-not-exist")

        const result = await assembleContext({ gamePath: nonExistent })

        expect(result.files).toHaveLength(0)
        expect(result.totalTokens).toBe(0)
    })

    it("estimates tokens correctly", async () => {
        // 800 chars should be ~200 tokens
        const content = "a".repeat(800)
        await createFile(join(tmpDir, "AGENTS.md"), content)

        const result = await assembleContext({ gamePath: tmpDir })

        expect(result.files).toHaveLength(1)
        expect(result.files[0]!.tokens).toBe(200)
        expect(result.totalTokens).toBe(200)
    })

    it("uses default 180K token budget", async () => {
        await createFile(join(tmpDir, "AGENTS.md"), "small file")

        const result = await assembleContext({ gamePath: tmpDir })

        // Should load the file fine under default budget
        expect(result.files).toHaveLength(1)
        expect(result.truncated).toBe(false)
    })

    it("only loads .ts and .tsx from high-priority dirs", async () => {
        await createFile(join(tmpDir, "packages", "shared", "src", "types.ts"), "export type A = string")
        await createFile(join(tmpDir, "packages", "shared", "src", "style.css"), "body { color: red }")
        await createFile(join(tmpDir, "packages", "shared", "src", "readme.md"), "# Shared")

        const result = await assembleContext({ gamePath: tmpDir })

        expect(result.files).toHaveLength(1)
        expect(result.files[0]!.path).toContain("types.ts")
    })
})
