import type { TokenMap } from "../types.js"

/**
 * Convert a display name to kebab-case.
 * "Scottish Trivia" → "scottish-trivia"
 */
export function toKebabCase(displayName: string): string {
    return displayName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
}

/**
 * Convert a display name to PascalCase.
 * "Scottish Trivia" → "ScottishTrivia"
 */
export function toPascalCase(displayName: string): string {
    return displayName
        .trim()
        .replace(/[^a-zA-Z0-9]+/g, " ")
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join("")
}

/**
 * Validate a kebab-case game name.
 */
export function validateGameName(kebab: string): { valid: boolean; error?: string } {
    if (kebab.length < 3) {
        return { valid: false, error: "Game name must be at least 3 characters" }
    }
    if (kebab.length > 50) {
        return { valid: false, error: "Game name must be 50 characters or fewer" }
    }
    if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(kebab)) {
        return {
            valid: false,
            error:
                "Game name must start and end with a lowercase letter or number, and contain only lowercase letters, numbers, and hyphens",
        }
    }
    return { valid: true }
}

/**
 * Build the full token map for replacing hello-weekend references.
 */
export function buildTokenMap(displayName: string): TokenMap {
    const kebab = toKebabCase(displayName)
    const pascal = toPascalCase(displayName)

    return {
        packageScope: { from: "@hello-weekend", to: `@${kebab}` },
        gameNameKebab: { from: "hello-weekend", to: kebab },
        gameNamePascal: { from: "HelloWeekend", to: pascal },
        gameId: { from: "hello-weekend", to: kebab },
        displayName: { from: "Hello Weekend", to: displayName.trim() },
        loggerName: { from: "hello-weekend-dev", to: `${kebab}-dev` },
        repoName: `crucible-game-${kebab}`,
    }
}
