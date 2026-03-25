import type { CrucibleErrorOptions, ExitCode } from "../types.js"
import { ExitCode as ExitCodes } from "../types.js"

function categoryToExitCode(code: string): ExitCode {
    const num = parseInt(code.replace("CRUCIBLE-", ""), 10)
    if (num >= 100 && num < 200) return ExitCodes.AUTH_ERROR
    if (num >= 400 && num < 500) return ExitCodes.NETWORK_ERROR
    return ExitCodes.GENERAL_ERROR
}

export class CrucibleError extends Error {
    readonly code: string
    readonly category: string
    readonly shortName: string
    readonly recovery: string
    readonly retryable: boolean
    readonly exitCode: ExitCode

    constructor(options: CrucibleErrorOptions) {
        super(options.message)
        this.name = "CrucibleError"
        this.code = options.code
        this.category = options.category
        this.shortName = options.shortName
        this.recovery = options.recovery
        this.retryable = options.retryable
        this.exitCode = categoryToExitCode(options.code)
        if (options.cause) {
            this.cause = options.cause
        }
    }

    toJSON(): Record<string, unknown> {
        return {
            error: true,
            code: this.code,
            category: this.category,
            shortName: this.shortName,
            message: this.message,
            recovery: this.recovery,
            retryable: this.retryable,
        }
    }

    format(useColor: boolean): string {
        const cross = useColor ? "\u001b[31m✗\u001b[39m" : "✗"
        const lines: string[] = []
        lines.push(`${cross} ${this.message}`)
        lines.push("")
        if (this.cause instanceof Error) {
            lines.push(`  ${this.cause.message}`)
            lines.push("")
        }
        lines.push("  Recovery:")
        lines.push(`    ${this.recovery}`)
        lines.push("")
        lines.push(`  Error: ${this.code} (${this.category}/${this.shortName})`)
        return lines.join("\n")
    }
}

export function authError(
    code: string,
    message: string,
    recovery: string,
    options?: { cause?: Error; retryable?: boolean },
): CrucibleError {
    return new CrucibleError({
        code,
        category: "auth",
        shortName: "auth-failed",
        message,
        recovery,
        retryable: options?.retryable ?? false,
        cause: options?.cause,
    })
}

export function gitError(
    code: string,
    message: string,
    recovery: string,
    options?: { cause?: Error; retryable?: boolean },
): CrucibleError {
    return new CrucibleError({
        code,
        category: "git",
        shortName: "git-error",
        message,
        recovery,
        retryable: options?.retryable ?? false,
        cause: options?.cause,
    })
}

export function networkError(
    code: string,
    message: string,
    recovery: string,
    options?: { cause?: Error; retryable?: boolean },
): CrucibleError {
    return new CrucibleError({
        code,
        category: "network",
        shortName: "network-error",
        message,
        recovery,
        retryable: options?.retryable ?? true,
        cause: options?.cause,
    })
}

export function templateError(
    code: string,
    message: string,
    recovery: string,
    options?: { cause?: Error; retryable?: boolean },
): CrucibleError {
    return new CrucibleError({
        code,
        category: "template",
        shortName: "template-error",
        message,
        recovery,
        retryable: options?.retryable ?? false,
        cause: options?.cause,
    })
}

export function usageError(
    code: string,
    message: string,
    recovery: string,
    options?: { cause?: Error; retryable?: boolean },
): CrucibleError {
    return new CrucibleError({
        code,
        category: "usage",
        shortName: "usage-error",
        message,
        recovery,
        retryable: options?.retryable ?? false,
        cause: options?.cause,
    })
}
