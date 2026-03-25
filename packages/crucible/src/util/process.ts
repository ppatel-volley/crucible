import { execa, type ResultPromise } from "execa"
import treeKill from "tree-kill"

export interface ProcessOptions {
    cwd?: string
    env?: Record<string, string>
    timeout?: number
    onStdout?: (line: string) => void
    onStderr?: (line: string) => void
}

export interface ProcessResult {
    stdout: string
    stderr: string
    exitCode: number
}

export async function runProcess(
    command: string,
    args: string[],
    options: ProcessOptions = {},
): Promise<ProcessResult> {
    const subprocess: ResultPromise = execa(command, args, {
        cwd: options.cwd,
        env: options.env,
        timeout: options.timeout,
        reject: false,
        lines: true,
    })

    if (options.onStdout && subprocess.stdout) {
        subprocess.stdout.on("data", (data: Buffer | string) => {
            const lines = String(data).split("\n")
            for (const line of lines) {
                if (line) options.onStdout!(line)
            }
        })
    }

    if (options.onStderr && subprocess.stderr) {
        subprocess.stderr.on("data", (data: Buffer | string) => {
            const lines = String(data).split("\n")
            for (const line of lines) {
                if (line) options.onStderr!(line)
            }
        })
    }

    const result = await subprocess
    return {
        stdout: Array.isArray(result.stdout) ? result.stdout.join("\n") : String(result.stdout ?? ""),
        stderr: Array.isArray(result.stderr) ? result.stderr.join("\n") : String(result.stderr ?? ""),
        exitCode: result.exitCode ?? 1,
    }
}

export function setupSignalHandlers(cleanup: () => Promise<void>): void {
    let lastSignalTime = 0
    let cleaning = false

    const handler = (signal: string): void => {
        const now = Date.now()
        if (now - lastSignalTime < 1000) {
            process.exit(128 + (signal === "SIGINT" ? 2 : 15))
        }
        lastSignalTime = now

        if (cleaning) return
        cleaning = true

        cleanup()
            .catch(() => {})
            .finally(() => {
                process.exit(128 + (signal === "SIGINT" ? 2 : 15))
            })
    }

    process.on("SIGINT", () => handler("SIGINT"))
    process.on("SIGTERM", () => handler("SIGTERM"))
}

export async function killProcessTree(pid: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        treeKill(pid, "SIGTERM", (err?: Error) => {
            if (err) {
                reject(err)
            } else {
                resolve()
            }
        })
    })
}
