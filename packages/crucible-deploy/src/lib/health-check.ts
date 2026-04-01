import type { HealthCheckResult } from "../types.js"

/**
 * Poll a health endpoint until it returns 200 or we time out.
 */
export async function pollHealth(
    url: string,
    timeoutMs: number,
    intervalMs: number = 5_000
): Promise<HealthCheckResult> {
    const deadline = Date.now() + timeoutMs
    let lastResult: HealthCheckResult = {
        healthy: false,
        error: "Timed out before first check",
        latencyMs: 0,
    }

    while (Date.now() < deadline) {
        lastResult = await checkHealth(url)
        if (lastResult.healthy) return lastResult

        const remaining = deadline - Date.now()
        if (remaining <= 0) break
        await sleep(Math.min(intervalMs, remaining))
    }

    return lastResult
}

/**
 * Single health check against a URL.
 */
export async function checkHealth(url: string): Promise<HealthCheckResult> {
    const start = Date.now()
    try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 10_000)

        const response = await fetch(url, {
            signal: controller.signal,
            headers: { Accept: "application/json" },
        })
        clearTimeout(timer)

        return {
            healthy: response.status === 200,
            statusCode: response.status,
            latencyMs: Date.now() - start,
        }
    } catch (err) {
        return {
            healthy: false,
            error:
                err instanceof Error ? err.message : "Unknown health check error",
            latencyMs: Date.now() - start,
        }
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}
