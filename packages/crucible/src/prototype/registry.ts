import { execa } from "execa"
import { networkError, usageError } from "../util/errors.js"

const DEFAULT_REGISTRY = "registry.prototypes.svc.cluster.local:5000"

/**
 * Build the full image reference for the in-cluster registry.
 */
export function buildImageRef(gameId: string, tag: string, registryHost?: string): string {
    const host = registryHost ?? DEFAULT_REGISTRY
    return `${host}/${gameId}:${tag}`
}

/**
 * Tag a local image for the in-cluster registry.
 */
export async function tagImage(localImage: string, remoteRef: string): Promise<void> {
    await execa("docker", ["tag", localImage, remoteRef])
}

/**
 * Push an image to the in-cluster registry.
 */
export async function pushImage(imageRef: string): Promise<void> {
    try {
        await execa("docker", ["push", imageRef])
    } catch (error) {
        throw networkError(
            "CRUCIBLE-903",
            "Failed to push image to prototype registry",
            "Check your cluster connectivity and registry access.",
            { cause: error instanceof Error ? error : undefined },
        )
    }
}

/**
 * Build, tag, and push a game image to the in-cluster registry.
 * Returns the full image reference that was pushed.
 */
export async function pushToPrototypeRegistry(options: {
    gameId: string
    localImage: string
    tag?: string
    registryHost?: string
}): Promise<string> {
    const tag = options.tag ?? "latest"
    const imageRef = buildImageRef(options.gameId, tag, options.registryHost)
    await tagImage(options.localImage, imageRef)
    await pushImage(imageRef)
    return imageRef
}

/**
 * Check if Docker is available.
 */
export async function isDockerAvailable(): Promise<boolean> {
    try {
        await execa("docker", ["version", "--format", "{{.Server.Version}}"])
        return true
    } catch {
        return false
    }
}
