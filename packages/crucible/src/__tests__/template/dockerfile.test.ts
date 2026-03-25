import { describe, it, expect } from "vitest"
import { generateDockerfile } from "../../template/dockerfile.js"
import { buildTokenMap } from "../../template/tokens.js"

const tokenMap = buildTokenMap("Scottish Trivia")

describe("generateDockerfile", () => {
    it("contains the correct --filter scope", async () => {
        const result = await generateDockerfile(tokenMap)
        expect(result.content).toContain("--filter=@scottish-trivia/server")
    })

    it("returns path as Dockerfile", async () => {
        const result = await generateDockerfile(tokenMap)
        expect(result.path).toBe("Dockerfile")
    })

    it("checksum is a valid 64-char hex string", async () => {
        const result = await generateDockerfile(tokenMap)
        expect(result.checksum).toMatch(/^[a-f0-9]{64}$/)
    })

    it("checksum is deterministic", async () => {
        const a = await generateDockerfile(tokenMap)
        const b = await generateDockerfile(tokenMap)
        expect(a.checksum).toBe(b.checksum)
    })

    it("matches snapshot", async () => {
        const result = await generateDockerfile(tokenMap)
        expect(result.content).toMatchSnapshot()
    })
})
