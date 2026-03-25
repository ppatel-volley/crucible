import { describe, it, expect, beforeEach, vi } from "vitest"
import { generateCrucibleJson, CrucibleJsonSchema } from "../../template/crucible-json.js"
import { buildTokenMap } from "../../template/tokens.js"

const tokenMap = buildTokenMap("Scottish Trivia")
const validOptions = {
    tokenMap,
    author: "test-author",
    description: "A fun trivia game",
    dockerfileChecksum: "a".repeat(64),
    ciWorkflowChecksum: "b".repeat(64),
    templateVersion: "1.0.0",
}

describe("generateCrucibleJson", () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date("2026-01-15T12:00:00.000Z"))
    })

    it("generated JSON validates against schema", () => {
        const result = generateCrucibleJson(validOptions)
        const parsed = JSON.parse(result.content)
        expect(() => CrucibleJsonSchema.parse(parsed)).not.toThrow()
    })

    it("checksums match provided values", () => {
        const result = generateCrucibleJson(validOptions)
        const parsed = JSON.parse(result.content)
        expect(parsed.checksums.dockerfile).toBe("a".repeat(64))
        expect(parsed.checksums.ciWorkflow).toBe("b".repeat(64))
    })

    it("all fields populated correctly", () => {
        const result = generateCrucibleJson(validOptions)
        const parsed = JSON.parse(result.content)
        expect(parsed.name).toBe("scottish-trivia")
        expect(parsed.displayName).toBe("Scottish Trivia")
        expect(parsed.description).toBe("A fun trivia game")
        expect(parsed.author).toBe("test-author")
        expect(parsed.version).toBe("0.1.0")
        expect(parsed.gameId).toBe("scottish-trivia")
        expect(parsed.template).toBe("hello-weekend")
        expect(parsed.templateVersion).toBe("1.0.0")
        expect(parsed.createdAt).toBe("2026-01-15T12:00:00.000Z")
    })

    it("returns correct path", () => {
        const result = generateCrucibleJson(validOptions)
        expect(result.path).toBe("crucible.json")
    })

    it("checksum is a valid 64-char hex string", () => {
        const result = generateCrucibleJson(validOptions)
        expect(result.checksum).toMatch(/^[a-f0-9]{64}$/)
    })

    it("checksum is deterministic with same input", () => {
        const a = generateCrucibleJson(validOptions)
        const b = generateCrucibleJson(validOptions)
        expect(a.checksum).toBe(b.checksum)
    })

    it("rejects invalid author (empty causes invalid name/gameId)", () => {
        const badMap = buildTokenMap("x")
        expect(() =>
            generateCrucibleJson({
                ...validOptions,
                tokenMap: badMap,
            }),
        ).toThrow()
    })

    it("rejects invalid checksums", () => {
        expect(() =>
            generateCrucibleJson({
                ...validOptions,
                dockerfileChecksum: "not-a-valid-checksum",
            }),
        ).toThrow()
    })

    vi.useRealTimers()
})
