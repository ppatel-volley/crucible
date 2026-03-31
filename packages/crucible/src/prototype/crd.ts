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
    "dynamodb",
])

const DEFAULT_REGISTRY_HOST = "bifrost-registry.volley-services.net"
const DEFAULT_PORT = 3000

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
                `Invalid dependency type: "${type}". Must be one of: postgres, redis, s3, dynamodb.`,
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

    const spec: GamePrototypeCRD["spec"] = {
        port,
    }

    if (options.websocketPort) {
        spec.websocketPort = options.websocketPort
    }

    if (options.ingressHostname) {
        spec.ingress = { hostname: options.ingressHostname }
    }

    // Mutually exclusive: source-based OR image-based
    if (options.sourceUrl) {
        spec.source = {
            url: options.sourceUrl,
            revision: options.sourceRevision ?? "main",
        }
    } else {
        spec.image = `${registryHost}/${options.gameId}:${options.imageTag ?? "latest"}`
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
        apiVersion: "weekend.com/v1alpha1",
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
    if (crd.spec.image) {
        yaml += `  image: ${crd.spec.image}\n`
    }
    if (crd.spec.source) {
        yaml += `  source:\n`
        yaml += `    url: ${crd.spec.source.url}\n`
        if (crd.spec.source.revision) yaml += `    revision: ${crd.spec.source.revision}\n`
        if (crd.spec.source.subPath) yaml += `    subPath: ${crd.spec.source.subPath}\n`
        if (crd.spec.source.secretRef) yaml += `    secretRef:\n      name: ${crd.spec.source.secretRef.name}\n`
        if (crd.spec.source.builderImage) yaml += `    builderImage: ${crd.spec.source.builderImage}\n`
    }
    if (crd.spec.port) yaml += `  port: ${crd.spec.port}\n`
    if (crd.spec.websocketPort) yaml += `  websocketPort: ${crd.spec.websocketPort}\n`
    if (crd.spec.ingress) {
        yaml += `  ingress:\n`
        yaml += `    hostname: ${crd.spec.ingress.hostname}\n`
        if (crd.spec.ingress.visibility) yaml += `    visibility: ${crd.spec.ingress.visibility}\n`
    }
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
