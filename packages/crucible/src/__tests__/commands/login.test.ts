import { describe, it, expect } from "vitest"
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
    it("default mode throws CRUCIBLE-101 with browser login message", async () => {
        await expect(runLoginCommand({ deviceCode: false })).rejects.toThrow(CrucibleError)
        await expect(runLoginCommand({ deviceCode: false })).rejects.toThrow(
            /Browser login is not yet implemented/,
        )
    })

    it("--device-code mode throws CRUCIBLE-101 with device code message", async () => {
        await expect(runLoginCommand({ deviceCode: true })).rejects.toThrow(CrucibleError)
        await expect(runLoginCommand({ deviceCode: true })).rejects.toThrow(
            /Device code login is not yet implemented/,
        )
    })

    it("both errors reference docs/human-actions.md in recovery text", async () => {
        try {
            await runLoginCommand({ deviceCode: false })
        } catch (error) {
            expect(error).toBeInstanceOf(CrucibleError)
            expect((error as CrucibleError).code).toBe("CRUCIBLE-101")
            expect((error as CrucibleError).recovery).toContain("docs/human-actions.md")
        }

        try {
            await runLoginCommand({ deviceCode: true })
        } catch (error) {
            expect(error).toBeInstanceOf(CrucibleError)
            expect((error as CrucibleError).code).toBe("CRUCIBLE-101")
            expect((error as CrucibleError).recovery).toContain("docs/human-actions.md")
        }
    })
})
