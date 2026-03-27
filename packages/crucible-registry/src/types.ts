export interface GameRecord {
    gameId: string
    displayName: string
    description: string
    author: string
    template: string
    environments: Record<string, EnvironmentRecord>
    createdAt: string // ISO 8601
    updatedAt: string // ISO 8601
}

export interface EnvironmentRecord {
    version: string
    imageTag: string
    commitSha: string
    status: "healthy" | "unhealthy" | "deploying" | "disabled"
    deployedAt: string // ISO 8601
    deployedBy: string
}

export interface GameVersion {
    gameId: string
    version: string
    imageTag: string
    commitSha: string
    deployedAt: string
    deployedBy: string
    environment: string
    status: "active" | "rolled-back" | "superseded"
}

export interface ApiResponse<T = unknown> {
    statusCode: number
    body: string
    headers: Record<string, string>
}
