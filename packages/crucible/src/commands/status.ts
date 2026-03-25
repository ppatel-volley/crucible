import type { Command } from "commander"
import { networkError } from "../util/errors.js"

export function registerStatusCommand(program: Command): void {
    program
        .command("status [game-id]")
        .description("Check game status across environments")
        .option("--env <environment>", "Filter to specific environment")
        .action(async (gameId: string | undefined, options: { env?: string }) => {
            throw networkError(
                "CRUCIBLE-401",
                "Status command is not yet implemented",
                "This command will be available after Phase 2 infrastructure is provisioned.",
            )
        })
}
