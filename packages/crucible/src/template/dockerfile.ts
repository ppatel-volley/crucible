import { readFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import Handlebars from "handlebars"
import type { GeneratedFile, TokenMap } from "../types.js"

function getTemplatesDir(): string {
    const currentDir = dirname(fileURLToPath(import.meta.url))
    // From src/template/ or dist/template/, go up to package root, then into templates/
    return join(currentDir, "..", "..", "templates")
}

export async function generateDockerfile(tokenMap: TokenMap): Promise<GeneratedFile> {
    const templatePath = join(getTemplatesDir(), "Dockerfile.hbs")
    const templateSource = await readFile(templatePath, "utf-8")
    const template = Handlebars.compile(templateSource)
    const content = template({ gameId: tokenMap.gameNameKebab.to })
    const checksum = createHash("sha256").update(content).digest("hex")
    return { path: "Dockerfile", content, checksum }
}
