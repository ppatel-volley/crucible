import { createHash } from "node:crypto"
import { z } from "zod"
import type { GeneratedFile, TokenMap } from "../types.js"

export const CrucibleJsonSchema = z.object({
    name: z.string().regex(/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/),
    displayName: z.string().min(1).max(100),
    description: z.string().max(500),
    author: z.string().email(),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    gameId: z.string().regex(/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/),
    tile: z.object({ imageUrl: z.string(), heroImageUrl: z.string() }),
    createdAt: z.string().datetime(),
    template: z.literal("hello-weekend"),
    templateVersion: z.string(),
    checksums: z.object({
        dockerfile: z.string().regex(/^[a-f0-9]{64}$/),
        ciWorkflow: z.string().regex(/^[a-f0-9]{64}$/),
    }),
})

export interface GenerateCrucibleJsonOptions {
    tokenMap: TokenMap
    author: string
    description: string
    dockerfileChecksum: string
    ciWorkflowChecksum: string
    templateVersion: string
}

export function generateCrucibleJson(options: GenerateCrucibleJsonOptions): GeneratedFile {
    const { tokenMap, author, description, dockerfileChecksum, ciWorkflowChecksum, templateVersion } =
        options

    const data = {
        name: tokenMap.gameNameKebab.to,
        displayName: tokenMap.displayName.to,
        description,
        author,
        version: "0.1.0",
        gameId: tokenMap.gameId.to,
        tile: { imageUrl: "", heroImageUrl: "" },
        createdAt: new Date().toISOString(),
        template: "hello-weekend" as const,
        templateVersion,
        checksums: {
            dockerfile: dockerfileChecksum,
            ciWorkflow: ciWorkflowChecksum,
        },
    }

    CrucibleJsonSchema.parse(data)

    const content = JSON.stringify(data, null, 2) + "\n"
    const checksum = createHash("sha256").update(content).digest("hex")
    return { path: "crucible.json", content, checksum }
}
