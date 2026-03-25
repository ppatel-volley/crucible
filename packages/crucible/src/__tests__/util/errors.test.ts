import { describe, it, expect } from "vitest"
import {
    CrucibleError,
    authError,
    gitError,
    networkError,
    templateError,
    usageError,
} from "../../util/errors.js"
import { ExitCode } from "../../types.js"

describe("CrucibleError", () => {
    const baseOpts = {
        code: "CRUCIBLE-201",
        category: "git",
        shortName: "repo-exists",
        message: "Repository already exists",
        recovery: "Choose a different name or delete the existing repo",
        retryable: false,
    }

    it("has correct properties", () => {
        const err = new CrucibleError(baseOpts)
        expect(err.code).toBe("CRUCIBLE-201")
        expect(err.category).toBe("git")
        expect(err.shortName).toBe("repo-exists")
        expect(err.message).toBe("Repository already exists")
        expect(err.recovery).toContain("Choose a different name")
        expect(err.retryable).toBe(false)
    })

    it("extends Error", () => {
        const err = new CrucibleError(baseOpts)
        expect(err).toBeInstanceOf(Error)
        expect(err.name).toBe("CrucibleError")
    })

    describe("toJSON", () => {
        it("returns machine-readable object", () => {
            const err = new CrucibleError(baseOpts)
            const json = err.toJSON()
            expect(json).toEqual({
                error: true,
                code: "CRUCIBLE-201",
                category: "git",
                shortName: "repo-exists",
                message: "Repository already exists",
                recovery: "Choose a different name or delete the existing repo",
                retryable: false,
            })
        })
    })

    describe("format", () => {
        it("includes cross, message, recovery, and error code", () => {
            const err = new CrucibleError(baseOpts)
            const output = err.format(false)
            expect(output).toContain("✗")
            expect(output).toContain("Repository already exists")
            expect(output).toContain("Recovery:")
            expect(output).toContain("Choose a different name")
            expect(output).toContain("CRUCIBLE-201 (git/repo-exists)")
        })

        it("includes cause message when present", () => {
            const cause = new Error("underlying issue")
            const err = new CrucibleError({ ...baseOpts, cause })
            const output = err.format(false)
            expect(output).toContain("underlying issue")
        })
    })

    describe("exit code mapping", () => {
        it("1xx maps to AUTH_ERROR (3)", () => {
            const err = new CrucibleError({ ...baseOpts, code: "CRUCIBLE-101" })
            expect(err.exitCode).toBe(ExitCode.AUTH_ERROR)
        })

        it("2xx maps to GENERAL_ERROR (1)", () => {
            const err = new CrucibleError({ ...baseOpts, code: "CRUCIBLE-201" })
            expect(err.exitCode).toBe(ExitCode.GENERAL_ERROR)
        })

        it("3xx maps to GENERAL_ERROR (1)", () => {
            const err = new CrucibleError({ ...baseOpts, code: "CRUCIBLE-301" })
            expect(err.exitCode).toBe(ExitCode.GENERAL_ERROR)
        })

        it("4xx maps to NETWORK_ERROR (4)", () => {
            const err = new CrucibleError({ ...baseOpts, code: "CRUCIBLE-401" })
            expect(err.exitCode).toBe(ExitCode.NETWORK_ERROR)
        })

        it("5xx maps to GENERAL_ERROR (1)", () => {
            const err = new CrucibleError({ ...baseOpts, code: "CRUCIBLE-501" })
            expect(err.exitCode).toBe(ExitCode.GENERAL_ERROR)
        })
    })
})

describe("factory functions", () => {
    it("authError sets category=auth and correct exit code", () => {
        const err = authError("CRUCIBLE-101", "SSO failed", "Try again")
        expect(err.category).toBe("auth")
        expect(err.exitCode).toBe(ExitCode.AUTH_ERROR)
        expect(err.code).toBe("CRUCIBLE-101")
    })

    it("gitError sets category=git", () => {
        const err = gitError("CRUCIBLE-201", "Repo exists", "Pick another name")
        expect(err.category).toBe("git")
        expect(err.exitCode).toBe(ExitCode.GENERAL_ERROR)
    })

    it("networkError sets category=network and retryable=true by default", () => {
        const err = networkError("CRUCIBLE-401", "Unreachable", "Check connection")
        expect(err.category).toBe("network")
        expect(err.retryable).toBe(true)
        expect(err.exitCode).toBe(ExitCode.NETWORK_ERROR)
    })

    it("templateError sets category=template", () => {
        const err = templateError("CRUCIBLE-801", "Not found", "Update templates")
        expect(err.category).toBe("template")
        expect(err.exitCode).toBe(ExitCode.GENERAL_ERROR)
    })

    it("usageError sets category=usage and exitCode=USAGE_ERROR", () => {
        const err = usageError("CRUCIBLE-201", "Bad input", "Check --help")
        expect(err.category).toBe("usage")
        expect(err.exitCode).toBe(ExitCode.USAGE_ERROR)
    })

    it("factory functions pass through cause", () => {
        const cause = new Error("root")
        const err = authError("CRUCIBLE-101", "Fail", "Retry", { cause })
        expect(err.cause).toBe(cause)
    })
})
