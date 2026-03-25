import chalk from "chalk"

import type { DevProcessName } from "../types.js"

const PROCESS_COLORS: Record<DevProcessName, (text: string) => string> = {
    server: chalk.magenta,
    display: chalk.blue,
    controller: chalk.yellow,
}

const MAX_LABEL_LENGTH = "[controller]".length // 12

function formatPrefix(name: DevProcessName): string {
    const label = `[${name}]`
    const padded = label.padEnd(MAX_LABEL_LENGTH + 1)
    return PROCESS_COLORS[name](padded)
}

/**
 * Create a line writer for a named process.
 * Returns callbacks for stdout and stderr that prefix each line.
 */
export function createProcessWriter(name: DevProcessName): {
    stdout: (line: string) => void
    stderr: (line: string) => void
} {
    const prefix = formatPrefix(name)
    return {
        stdout: (line: string) => {
            process.stdout.write(`${prefix} ${line}\n`)
        },
        stderr: (line: string) => {
            process.stderr.write(`${prefix} ${line}\n`)
        },
    }
}

/**
 * Format a status message for a process (e.g. "started", "crashed").
 */
export function formatProcessStatus(
    name: DevProcessName,
    message: string,
): string {
    return `${formatPrefix(name)} ${message}`
}
