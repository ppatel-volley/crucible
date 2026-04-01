export interface RegistrationPayload {
    displayName: string
    author: string
    imageTag: string
    commitSha: string
    version: string
    status: "deploying" | "healthy" | "unhealthy" | "disabled"
    environment: string
}

export interface RegistryGameResponse {
    gameId: string
    updatedAt: string
    environments: Record<
        string,
        {
            imageTag: string
            version: string
            status: string
            deployedAt: string
        }
    >
}

const MAX_RETRIES = 5
const BASE_DELAY_MS = 500

/**
 * Register or update a game in the Crucible Registry API.
 *
 * Uses optimistic concurrency: fetches current state first, then PUTs
 * with expectedUpdatedAt. Retries on 409 conflict.
 *
 * Auth: In CI, the Registry API Gateway uses AWS_IAM authorization.
 * The crucible-ci role's credentials (set by configure-aws-credentials)
 * are available in the environment. API Gateway validates the caller's
 * IAM identity via the request context — no explicit SigV4 signing is
 * needed when using API Gateway's built-in IAM auth with Lambda proxy.
 * For direct Lambda invocation, SigV4 would be required.
 */
export async function registerGame(
    registryUrl: string,
    gameId: string,
    payload: RegistrationPayload
): Promise<void> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        // Fetch current state for optimistic concurrency
        const current = await fetchGame(registryUrl, gameId)
        const expectedUpdatedAt = current?.updatedAt ?? undefined

        const body = {
            ...payload,
            ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
        }

        const response = await fetch(`${registryUrl}/games/${gameId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        })

        if (response.ok) return

        if (response.status === 409 && attempt < MAX_RETRIES - 1) {
            const delay = BASE_DELAY_MS * Math.pow(2, attempt)
            await sleep(delay)
            lastError = new Error(
                `Registry conflict (409) on attempt ${attempt + 1}`
            )
            continue
        }

        const text = await response.text().catch(() => "")
        throw new Error(
            `Registry API returned ${response.status}: ${text}`
        )
    }

    throw lastError ?? new Error("Registration failed after max retries")
}

/**
 * Fetch a game record from the Registry API.
 */
export async function fetchGame(
    registryUrl: string,
    gameId: string
): Promise<RegistryGameResponse | null> {
    const response = await fetch(`${registryUrl}/games/${gameId}`)
    if (response.status === 404) return null
    if (!response.ok) {
        throw new Error(
            `Failed to fetch game: ${response.status} ${response.statusText}`
        )
    }
    return (await response.json()) as RegistryGameResponse
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}
