import { z } from "zod"
import type { CrucibleConfig } from "../types.js"

const TemplateSourceSchema = z.discriminatedUnion("type", [
    z.object({
        type: z.literal("github"),
        repo: z.string(),
        ref: z.string(),
    }),
    z.object({
        type: z.literal("local"),
        path: z.string(),
    }),
])

export const CrucibleConfigSchema = z.object({
    userEmail: z.string().nullable(),
    defaultEnvironment: z.enum(["dev", "staging", "prod"]),
    githubOrg: z.string(),
    registryApiUrls: z.record(z.string(), z.string()),
    agentModel: z.string(),
    gamesDir: z.string().nullable(),
    templateSource: TemplateSourceSchema,
})

export const DEFAULT_CONFIG: CrucibleConfig = {
    userEmail: null,
    defaultEnvironment: "dev",
    githubOrg: "ppatel-volley", // DEV: personal org for testing. Production: "Volley-Inc"
    registryApiUrls: {},
    agentModel: "claude-sonnet-4-20250514",
    gamesDir: null,
    templateSource: {
        type: "github",
        repo: "Volley-Inc/hello-weekend",
        ref: "main",
    },
}

export function validateConfig(data: unknown): CrucibleConfig {
    return CrucibleConfigSchema.parse(data)
}
