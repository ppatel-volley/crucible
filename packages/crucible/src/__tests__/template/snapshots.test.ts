import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { buildTokenMap } from "../../template/tokens.js"
import { generateDockerfile } from "../../template/dockerfile.js"
import { generateCIWorkflow } from "../../template/ci-workflow.js"
import { generateCrucibleJson } from "../../template/crucible-json.js"

const tokenMap = buildTokenMap("Snapshot Test Game")

describe("template snapshots", () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"))
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it("Dockerfile matches snapshot", async () => {
        const result = await generateDockerfile(tokenMap)
        expect(result.content).toMatchSnapshot()
    })

    it("CI workflow matches snapshot", async () => {
        const result = await generateCIWorkflow(tokenMap)
        expect(result.content).toMatchSnapshot()
    })

    it("crucible.json matches snapshot", () => {
        const result = generateCrucibleJson({
            tokenMap,
            author: "test@example.com",
            description: "A snapshot test game",
            dockerfileChecksum: "a".repeat(64),
            ciWorkflowChecksum: "b".repeat(64),
            templateVersion: "1.0.0",
        })
        const normalized = result.content.replace(
            /"createdAt":"[^"]+"/,
            '"createdAt":"2026-01-01T00:00:00.000Z"',
        )
        expect(normalized).toMatchSnapshot()
    })

    it("token map is deterministic", () => {
        const map1 = buildTokenMap("My Cool Game")
        const map2 = buildTokenMap("My Cool Game")
        expect(map1).toEqual(map2)
    })

    it("all generated files have valid checksums", async () => {
        const dockerfile = await generateDockerfile(tokenMap)
        const ciWorkflow = await generateCIWorkflow(tokenMap)
        const crucibleJson = generateCrucibleJson({
            tokenMap,
            author: "test@example.com",
            description: "A snapshot test game",
            dockerfileChecksum: "a".repeat(64),
            ciWorkflowChecksum: "b".repeat(64),
            templateVersion: "1.0.0",
        })

        for (const file of [dockerfile, ciWorkflow, crucibleJson]) {
            expect(file.checksum).toMatch(/^[a-f0-9]{64}$/)
        }
    })
})
