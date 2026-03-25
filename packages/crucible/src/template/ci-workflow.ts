import { readFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import type { GeneratedFile, TokenMap } from "../types.js"

function getTemplatesDir(): string {
    const currentDir = dirname(fileURLToPath(import.meta.url))
    return join(currentDir, "..", "..", "templates")
}

export async function generateCIWorkflow(_tokenMap: TokenMap): Promise<GeneratedFile> {
    const templatePath = join(getTemplatesDir(), "crucible-deploy.yml.hbs")
    const templateSource = await readFile(templatePath, "utf-8")
    // The CI workflow template uses {{{{ }}}} to escape GitHub Actions ${{ }} syntax.
    // It has no actual Handlebars variables, so we resolve the raw-block escapes directly.
    const content = templateSource.replace(/\{\{\{\{/g, "{{").replace(/\}\}\}\}/g, "}}")
    const checksum = createHash("sha256").update(content).digest("hex")
    return { path: ".github/workflows/crucible-deploy.yml", content, checksum }
}
