import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Command } from "commander"
import { registerLoginCommand, runLoginCommand } from "../../commands/login.js"
import { CrucibleError } from "../../util/errors.js"

describe("registerLoginCommand", () => {
    it("registers command with correct name and --device-code option", () => {
        const program = new Command()
        registerLoginCommand(program)

        const loginCmd = program.commands.find((cmd) => cmd.name() === "login")
        expect(loginCmd).toBeDefined()
        expect(loginCmd!.description()).toBe("Authenticate with Volley SSO")

        const deviceCodeOpt = loginCmd!.options.find((o) => o.long === "--device-code")
        expect(deviceCodeOpt).toBeDefined()
    })
})

describe("runLoginCommand", () => {
    const originalEnv = { ...process.env }

    beforeEach(() => {
        delete process.env.CRUCIBLE_OIDC_ISSUER
        delete process.env.CRUCIBLE_OIDC_CLIENT_ID
    })

    afterEach(() => {
        process.env = { ...originalEnv }
    })

    it("throws CRUCIBLE-101 when SSO is not configured (browser mode)", async () => {
        await expect(runLoginCommand({ deviceCode: false })).rejects.toThrow(CrucibleError)
        await expect(runLoginCommand({ deviceCode: false })).rejects.toThrow(
            /SSO is not configured/,
        )
    })

    it("throws CRUCIBLE-101 when SSO is not configured (device-code mode)", async () => {
        await expect(runLoginCommand({ deviceCode: true })).rejects.toThrow(CrucibleError)
        await expect(runLoginCommand({ deviceCode: true })).rejects.toThrow(
            /SSO is not configured/,
        )
    })

    it("errors reference docs/human-actions.md in recovery text", async () => {
        try {
            await runLoginCommand({ deviceCode: false })
        } catch (error) {
            expect(error).toBeInstanceOf(CrucibleError)
            expect((error as CrucibleError).code).toBe("CRUCIBLE-101")
            expect((error as CrucibleError).recovery).toContain("docs/human-actions.md")
        }
    })

    it("throws CRUCIBLE-102 for device-code when SSO is configured", async () => {
        process.env.CRUCIBLE_OIDC_ISSUER = "https://auth.example.com"
        process.env.CRUCIBLE_OIDC_CLIENT_ID = "test-client-id"

        await expect(runLoginCommand({ deviceCode: true })).rejects.toThrow(CrucibleError)
        await expect(runLoginCommand({ deviceCode: true })).rejects.toThrow(
            /Device code login is not yet implemented/,
        )
    })
})
