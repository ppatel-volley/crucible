import { describe, it, expect } from "vitest"
import { buildTokenMap, toKebabCase, toPascalCase, validateGameName } from "../../template/tokens.js"

describe("toKebabCase", () => {
    it("converts multi-word display name", () => {
        expect(toKebabCase("Scottish Trivia")).toBe("scottish-trivia")
    })

    it("handles single word", () => {
        expect(toKebabCase("Puzzle")).toBe("puzzle")
    })

    it("passes through already-kebab input", () => {
        expect(toKebabCase("my-game")).toBe("my-game")
    })

    it("trims leading and trailing spaces", () => {
        expect(toKebabCase("  Hello World  ")).toBe("hello-world")
    })

    it("handles numbers", () => {
        expect(toKebabCase("Game 42")).toBe("game-42")
    })
})

describe("toPascalCase", () => {
    it("converts multi-word display name", () => {
        expect(toPascalCase("Scottish Trivia")).toBe("ScottishTrivia")
    })

    it("handles single word", () => {
        expect(toPascalCase("Puzzle")).toBe("Puzzle")
    })

    it("handles kebab input", () => {
        expect(toPascalCase("my-game")).toBe("MyGame")
    })
})

describe("validateGameName", () => {
    it("accepts valid kebab names", () => {
        expect(validateGameName("scottish-trivia")).toEqual({ valid: true })
        expect(validateGameName("my-game-42")).toEqual({ valid: true })
        expect(validateGameName("abc")).toEqual({ valid: true })
    })

    it("rejects names that are too short", () => {
        const result = validateGameName("ab")
        expect(result.valid).toBe(false)
        expect(result.error).toBeDefined()
    })

    it("rejects names that are too long", () => {
        const result = validateGameName("a" + "b".repeat(50))
        expect(result.valid).toBe(false)
        expect(result.error).toBeDefined()
    })

    it("rejects uppercase", () => {
        expect(validateGameName("My-Game").valid).toBe(false)
    })

    it("rejects special characters", () => {
        expect(validateGameName("my_game").valid).toBe(false)
        expect(validateGameName("my game").valid).toBe(false)
    })

    it("rejects leading hyphens", () => {
        expect(validateGameName("-my-game").valid).toBe(false)
    })

    it("rejects trailing hyphens", () => {
        expect(validateGameName("my-game-").valid).toBe(false)
    })
})

describe("buildTokenMap", () => {
    it("builds correct token map for Scottish Trivia", () => {
        const map = buildTokenMap("Scottish Trivia")
        expect(map.packageScope).toEqual({ from: "@hello-weekend", to: "@scottish-trivia" })
        expect(map.gameNameKebab).toEqual({ from: "hello-weekend", to: "scottish-trivia" })
        expect(map.gameNamePascal).toEqual({ from: "HelloWeekend", to: "ScottishTrivia" })
        expect(map.gameId).toEqual({ from: "hello-weekend", to: "scottish-trivia" })
        expect(map.displayName).toEqual({ from: "Hello Weekend", to: "Scottish Trivia" })
        expect(map.loggerName).toEqual({ from: "hello-weekend-dev", to: "scottish-trivia-dev" })
        expect(map.repoName).toBe("crucible-game-scottish-trivia")
    })

    it("handles single word Puzzle", () => {
        const map = buildTokenMap("Puzzle")
        expect(map.gameNameKebab.to).toBe("puzzle")
        expect(map.gameNamePascal.to).toBe("Puzzle")
        expect(map.repoName).toBe("crucible-game-puzzle")
    })

    it("handles already-kebab my-game", () => {
        const map = buildTokenMap("my-game")
        expect(map.gameNameKebab.to).toBe("my-game")
        expect(map.gameNamePascal.to).toBe("MyGame")
    })
})
