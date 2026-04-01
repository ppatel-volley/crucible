export interface DeployContext {
    gameId: string
    env: string
    namespace: string
}

export interface ApplyOptions extends DeployContext {
    image: string
}

export interface VerifyOptions extends DeployContext {
    timeout: number
}

export interface RegisterOptions extends DeployContext {
    image: string
    displayName: string
    author: string
    version?: string
    commitSha?: string
    registryUrl: string
}

export interface RollbackOptions extends DeployContext {
    registryUrl: string
}

export interface ManifestContext {
    gameId: string
    env: string
    namespace: string
    image: string
    accountId: string
    oidcProvider?: string
}

export interface HealthCheckResult {
    healthy: boolean
    statusCode?: number
    error?: string
    latencyMs: number
}

export type ResourceKind =
    | "Deployment"
    | "Service"
    | "Ingress"
    | "ServiceAccount"
    | "ScaledObject"
    | "NetworkPolicy"
