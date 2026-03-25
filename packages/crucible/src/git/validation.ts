import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

export async function computeFileChecksum(filePath: string): Promise<string> {
    const content = await readFile(filePath)
    return createHash("sha256").update(content).digest("hex")
}

export async function validateDockerfileChecksum(
    gamePath: string,
    expectedChecksum: string
): Promise<boolean> {
    const dockerfilePath = join(gamePath, "Dockerfile")
    const actualChecksum = await computeFileChecksum(dockerfilePath)
    return actualChecksum === expectedChecksum
}
