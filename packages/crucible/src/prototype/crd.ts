import type {
    BifrostDependency,
    BifrostDependencyType,
    GamePrototypeCRD,
    PrototypeOptions,
} from "../types.js"

const VALID_DEPENDENCY_TYPES: ReadonlySet<string> = new Set<string>([
    "postgres",
    "redis",
    "s3",
])

const DEFAULT_REGISTRY_HOST = "registry.prototypes.svc.cluster.local:5000"
const DEFAULT_PORT = 3000
const DEFAULT_WEBSOCKET = true

/**
 * Parse a dependencies string like "scores:postgres,cache:redis,assets:s3"
 * into a Record<string, BifrostDependency>.
 */
export function parseDependencies(
    depsString: string,
): Record<string, BifrostDependency> {
    const trimmed = depsString.trim()
    if (trimmed === "") return {}

    const result: Record<string, BifrostDependency> = {}

    for (const pair of trimmed.split(",")) {
        const parts = pair.trim().split(":")
        if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) {
            throw new Error(
                `Invalid dependency format: "${pair.trim()}". Expected "name:type".`,
            )
        }

        const name = parts[0].trim()
        const type = parts[1].trim()

        if (!VALID_DEPENDENCY_TYPES.has(type)) {
            throw new Error(
                `Invalid dependency type: "${type}". Must be one of: postgres, redis, s3.`,
            )
        }

        result[name] = { type: type as BifrostDependencyType }
    }

    return result
}

/**
 * Generate a GamePrototype CRD object from options.
 */
export function generateGamePrototypeCRD(
    options: PrototypeOptions,
): GamePrototypeCRD {
    const registryHost = options.registryHost ?? DEFAULT_REGISTRY_HOST
    const port = options.port ?? DEFAULT_PORT
    const websocket = options.websocket ?? DEFAULT_WEBSOCKET

    const spec: GamePrototypeCRD["spec"] = {
        image: `${registryHost}/${options.gameId}:${options.imageTag}`,
        port,
        websocket,
    }

    if (options.env && Object.keys(options.env).length > 0) {
        spec.env = options.env
    }

    if (options.dependencies) {
        const deps = parseDependencies(options.dependencies)
        if (Object.keys(deps).length > 0) {
            spec.dependencies = deps
        }
    }

    return {
        apiVersion: "volley.weekend.com/v1alpha1",
        kind: "GamePrototype",
        metadata: { name: options.gameId },
        spec,
    }
}

/**
 * Serialize a GamePrototype CRD to YAML string.
 */
export function serializeGamePrototypeCRD(crd: GamePrototypeCRD): string {
    let yaml = `apiVersion: ${crd.apiVersion}\n`
    yaml += `kind: ${crd.kind}\n`
    yaml += `metadata:\n  name: ${crd.metadata.name}\n`
    yaml += `spec:\n`
    yaml += `  image: ${crd.spec.image}\n`
    if (crd.spec.port) yaml += `  port: ${crd.spec.port}\n`
    if (crd.spec.websocket) yaml += `  websocket: true\n`
    if (crd.spec.env && Object.keys(crd.spec.env).length > 0) {
        yaml += `  env:\n`
        for (const [key, value] of Object.entries(crd.spec.env)) {
            yaml += `    ${key}: "${value}"\n`
        }
    }
    if (
        crd.spec.dependencies &&
        Object.keys(crd.spec.dependencies).length > 0
    ) {
        yaml += `  dependencies:\n`
        for (const [name, dep] of Object.entries(crd.spec.dependencies)) {
            yaml += `    ${name}:\n      type: ${dep.type}\n`
        }
    }
    return yaml
}
