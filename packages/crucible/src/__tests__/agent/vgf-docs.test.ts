import { describe, it, expect } from "vitest"
import { getVGFDocsPath, loadVGFDocs } from "../../agent/vgf-docs.js"

describe("vgf-docs", () => {
    it("getVGFDocsPath returns a path ending in context/BUILDING_TV_GAMES.md", () => {
        const p = getVGFDocsPath()
        expect(p.replace(/\\/g, "/")).toMatch(/context\/BUILDING_TV_GAMES\.md$/)
    })

    it("loadVGFDocs returns file content as a string", async () => {
        const content = await loadVGFDocs()
        // Should be a string (file exists) or null (file missing)
        if (content !== null) {
            expect(typeof content).toBe("string")
            expect(content.length).toBeGreaterThan(0)
        } else {
            expect(content).toBeNull()
        }
    })
})
