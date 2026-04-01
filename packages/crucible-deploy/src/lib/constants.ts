export const AWS_ACCOUNT_ID = "375633680607"

export const REGISTRY_URLS: Record<string, string> = {
    dev: "https://api-dev.crucible.volley-services.net",
    staging: "https://api-staging.crucible.volley-services.net",
    prod: "https://api.crucible.volley-services.net",
}

/**
 * Validate a game ID is safe for use in K8s resource names, IAM roles, etc.
 * Must match: lowercase alphanumeric + hyphens, 3-50 chars, no leading/trailing hyphens.
 */
export function validateGameId(gameId: string): void {
    if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(gameId)) {
        throw new Error(
            `Invalid game ID "${gameId}": must be 3-50 lowercase alphanumeric characters or hyphens, no leading/trailing hyphens`
        )
    }
}
