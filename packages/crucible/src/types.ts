// === Exit Codes ===
export const ExitCode = {
    SUCCESS: 0,
    GENERAL_ERROR: 1,
    USAGE_ERROR: 2,
    AUTH_ERROR: 3,
    NETWORK_ERROR: 4,
    TIMEOUT: 5,
} as const
export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode]

// === Config ===
export interface CruciblePaths {
    configDir: string
    configFile: string
    dataDir: string
    gamesDir: string
    sessionsDir: string
}

export interface CrucibleConfig {
    userEmail: string | null
    defaultEnvironment: "dev" | "staging" | "prod"
    githubOrg: string
    registryApiUrls: Record<string, string>
    agentModel: string
    gamesDir: string | null
    templateSource:
        | { type: "github"; repo: string; ref: string }
        | { type: "local"; path: string }
}

// === Logger ===
export type LogLevel = "debug" | "info" | "warn" | "error"

export interface Logger {
    debug(message: string, data?: Record<string, unknown>): void
    info(message: string, data?: Record<string, unknown>): void
    warn(message: string, data?: Record<string, unknown>): void
    error(message: string, data?: Record<string, unknown>): void
    spinner(message: string): SpinnerHandle
    success(message: string): void
    fail(message: string): void
}

export interface SpinnerHandle {
    succeed(text?: string): void
    fail(text?: string): void
    update(text: string): void
    stop(): void
}

// === Errors ===
export interface CrucibleErrorOptions {
    code: string
    category: string
    shortName: string
    message: string
    recovery: string
    retryable: boolean
    cause?: Error
}

// === Token Map ===
export interface TokenMap {
    packageScope: { from: string; to: string }
    gameNameKebab: { from: string; to: string }
    gameNamePascal: { from: string; to: string }
    gameId: { from: string; to: string }
    displayName: { from: string; to: string }
    loggerName: { from: string; to: string }
    repoName: string
}

// === Template Engine ===
export interface TemplateEngineOptions {
    targetPath: string
    tokenMap: TokenMap
}

export interface TemplateEngineResult {
    filesProcessed: number
    tokensReplaced: number
    filesRemoved: string[]
}

// === File Generation ===
export interface GeneratedFile {
    path: string
    content: string
    checksum: string
}

export interface CrucibleJson {
    name: string
    displayName: string
    description: string
    author: string
    version: string
    gameId: string
    tile: { imageUrl: string; heroImageUrl: string }
    createdAt: string
    template: "hello-weekend"
    templateVersion: string
    checksums: { dockerfile: string; ciWorkflow: string }
}

// === Git Operations ===
export interface GitOperations {
    init(path: string): Promise<void>
    add(path: string, files: string[]): Promise<void>
    commit(path: string, message: string): Promise<string>
    push(path: string, remote: string, branch: string): Promise<void>
    addRemote(path: string, name: string, url: string): Promise<void>
    getHeadSha(path: string): Promise<string>
    isClean(path: string): Promise<boolean>
}

// === GitHub API ===
export interface CreateRepoOptions {
    org: string
    gameId: string
    displayName: string
    githubToken: string
}

export interface CreateRepoResult {
    cloneUrl: string
    htmlUrl: string
    fullName: string
}

// === Create Command ===
export interface CreateOptions {
    displayName: string
    description?: string
    author?: string
    templateSource?: CrucibleConfig["templateSource"]
    skipGithub?: boolean
    skipInstall?: boolean
}

export interface CreateResult {
    gamePath: string
    gameId: string
    repoUrl?: string
}

// === Global CLI Options ===
export interface GlobalOptions {
    color: boolean
    json: boolean
    verbose: boolean
    quiet: boolean
}
