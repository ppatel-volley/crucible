import { describe, it, expect } from "vitest"
import { generateCIWorkflow } from "../../template/ci-workflow.js"
import { buildTokenMap } from "../../template/tokens.js"

const tokenMap = buildTokenMap("Scottish Trivia")

describe("generateCIWorkflow", () => {
    it("returns correct path", async () => {
        const result = await generateCIWorkflow(tokenMap)
        expect(result.path).toBe(".github/workflows/crucible-deploy.yml")
    })

    it("generated workflow is valid YAML structure", async () => {
        const result = await generateCIWorkflow(tokenMap)
        expect(result.content).toContain("name: Crucible Deploy")
        expect(result.content).toContain("on:")
        expect(result.content).toContain("jobs:")
    })

    it("contains expected job names", async () => {
        const result = await generateCIWorkflow(tokenMap)
        expect(result.content).toContain("quality-gate:")
        expect(result.content).toContain("build-and-deploy:")
    })

    it("checksum is a valid 64-char hex string", async () => {
        const result = await generateCIWorkflow(tokenMap)
        expect(result.checksum).toMatch(/^[a-f0-9]{64}$/)
    })

    it("checksum is deterministic", async () => {
        const a = await generateCIWorkflow(tokenMap)
        const b = await generateCIWorkflow(tokenMap)
        expect(a.checksum).toBe(b.checksum)
    })
})
