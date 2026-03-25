import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createHash } from "node:crypto"
import {
    computeFileChecksum,
    validateDockerfileChecksum,
} from "../../git/validation.js"

describe("computeFileChecksum", () => {
    let tempDir: string

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "crucible-checksum-test-"))
    })

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true })
    })

    it("produces correct SHA-256 for known content", async () => {
        const content = "hello world"
        const filePath = join(tempDir, "test.txt")
        await writeFile(filePath, content)

        const checksum = await computeFileChecksum(filePath)
        const expected = createHash("sha256")
            .update(Buffer.from(content))
            .digest("hex")

        expect(checksum).toBe(expected)
    })
})

describe("validateDockerfileChecksum", () => {
    let tempDir: string

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "crucible-dockerfile-test-"))
    })

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true })
    })

    it("passes for unmodified file", async () => {
        const content = "FROM node:22-alpine\nWORKDIR /app\n"
        const dockerfilePath = join(tempDir, "Dockerfile")
        await writeFile(dockerfilePath, content)

        const checksum = createHash("sha256")
            .update(Buffer.from(content))
            .digest("hex")

        expect(await validateDockerfileChecksum(tempDir, checksum)).toBe(true)
    })

    it("fails for modified file", async () => {
        const originalContent = "FROM node:22-alpine\nWORKDIR /app\n"
        const dockerfilePath = join(tempDir, "Dockerfile")
        await writeFile(dockerfilePath, originalContent)

        const originalChecksum = createHash("sha256")
            .update(Buffer.from(originalContent))
            .digest("hex")

        await writeFile(dockerfilePath, "FROM node:20-alpine\nWORKDIR /app\n")

        expect(await validateDockerfileChecksum(tempDir, originalChecksum)).toBe(
            false
        )
    })
})
