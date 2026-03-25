import type { Command } from "commander"
import { networkError } from "../util/errors.js"

export function registerLogsCommand(program: Command): void {
    program
        .command("logs <game-id>")
        .description("View game server logs")
        .option("-f, --follow", "Stream logs continuously", false)
        .option("--lines <number>", "Number of lines to display", parseInt, 100)
        .option("--env <environment>", "Target environment", "dev")
        .action(async (gameId: string, options: { follow: boolean; lines: number; env: string }) => {
            throw networkError(
                "CRUCIBLE-401",
                "Logs command is not yet implemented",
                "This command will be available after Phase 2 infrastructure is provisioned.",
            )
        })
}
