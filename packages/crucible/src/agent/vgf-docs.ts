import { readFile } from "node:fs/promises"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Path to the bundled VGF docs.
 * Resolves relative to the package root, not the source file.
 */
export function getVGFDocsPath(): string {
    // From src/agent/vgf-docs.ts → ../../context/BUILDING_TV_GAMES.md
    // From dist/agent/vgf-docs.js → ../../context/BUILDING_TV_GAMES.md
    return join(__dirname, "..", "..", "context", "BUILDING_TV_GAMES.md")
}

/**
 * Load VGF docs content. Returns null if the file doesn't exist.
 */
export async function loadVGFDocs(): Promise<string | null> {
    try {
        return await readFile(getVGFDocsPath(), "utf-8")
    } catch {
        return null
    }
}
