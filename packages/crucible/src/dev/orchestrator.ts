import { execa, type ResultPromise } from "execa"

import type { DevProcessName, DevSession, OrchestratorOptions } from "../types.js"
import { allocateDevPorts } from "./ports.js"
import { createProcessWriter, formatProcessStatus } from "./output.js"
import { gracefulKill } from "../util/process.js"
import { networkError } from "../util/errors.js"

const READY_SIGNALS: Record<DevProcessName, RegExp> = {
    // Matches both plain text ("WGFServer started on :8090") and
    // JSON logs ({"msg":"...server started"}) from VGF/pino
    server: /started on|listening on|server started|"msg".*started|ready/i,
    display: /ready in|Local:|VITE/i,
    controller: /ready in|Local:|VITE/i,
}

/**
 * Wait for a process to emit a ready signal or timeout.
 */
function waitForReady(
    proc: ResultPromise,
    name: DevProcessName,
    timeout: number,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(
                networkError(
                    "CRUCIBLE-404",
                    `Process "${name}" did not become ready within ${timeout / 1000}s`,
                    "Check the process logs above for errors.",
                ),
            )
        }, timeout)

        const pattern = READY_SIGNALS[name]

        const checkLine = (data: Buffer | string): void => {
            if (pattern.test(String(data))) {
                clearTimeout(timer)
                resolve()
            }
        }

        proc.stdout?.on("data", checkLine)
        proc.stderr?.on("data", checkLine)

        // Also resolve if process exits (crash will be caught separately)
        proc.then(() => {
            clearTimeout(timer)
            resolve()
        })
    })
}

/**
 * Start a local dev session with three child processes: server, display, controller.
 * Processes are started in parallel and monitored for crashes.
 */
export async function startDevSession(options: OrchestratorOptions): Promise<DevSession> {
    const startupTimeout = options.startupTimeout ?? 30000
    const gracePeriod = options.shutdownGracePeriod ?? 5000

    // 1. Allocate ports
    const ports = await allocateDevPorts(options.ports)

    // 2. Start all three processes
    const processes: Map<DevProcessName, ResultPromise> = new Map()
    const pids: Record<DevProcessName, number | null> = { server: null, display: null, controller: null }

    const processConfigs: Array<{ name: DevProcessName; args: string[]; env: Record<string, string> }> = [
        {
            name: "server",
            args: ["--filter", "*/server", "dev"],
            env: { PORT: String(ports.server) },
        },
        {
            name: "display",
            args: ["--filter", "*/display", "dev"],
            env: { PORT: String(ports.display), VITE_SERVER_URL: `http://127.0.0.1:${ports.server}` },
        },
        {
            name: "controller",
            args: ["--filter", "*/controller", "dev"],
            env: { PORT: String(ports.controller), VITE_SERVER_URL: `http://127.0.0.1:${ports.server}` },
        },
    ]

    const readyPromises: Promise<void>[] = []

    for (const config of processConfigs) {
        const writer = createProcessWriter(config.name)
        const proc = execa("pnpm", config.args, {
            cwd: options.gamePath,
            env: { ...process.env, ...config.env },
            reject: false,
        })

        pids[config.name] = proc.pid ?? null

        // Attach readiness listener BEFORE piping output (avoids race condition
        // where ready signal fires before waitForReady attaches its listener)
        readyPromises.push(waitForReady(proc, config.name, startupTimeout))

        // Pipe output through the multiplexer
        proc.stdout?.on("data", (data: Buffer) => {
            for (const line of String(data).split("\n")) {
                if (line.trim()) writer.stdout(line)
            }
        })
        proc.stderr?.on("data", (data: Buffer) => {
            for (const line of String(data).split("\n")) {
                if (line.trim()) writer.stderr(line)
            }
        })

        // Monitor for crashes — if one dies, kill all
        proc.then((result) => {
            if (result.exitCode !== 0 && result.exitCode !== null) {
                console.error(formatProcessStatus(config.name, `crashed with exit code ${result.exitCode}`))
                stopAllProcesses(processes, gracePeriod)
            }
        })

        processes.set(config.name, proc)
    }

    // 3. Wait for all processes to be ready (with timeout)
    try {
        await Promise.all(readyPromises)
    } catch (err) {
        // Startup failed — kill everything
        await stopAllProcesses(processes, gracePeriod)
        throw err
    }

    return { ports, pids, gamePath: options.gamePath, gameId: options.gameId }
}

/**
 * Stop all running processes in a dev session gracefully.
 * Uses two-phase kill: SIGTERM → grace period → SIGKILL.
 */
export async function stopDevSession(session: DevSession, gracePeriod: number = 5000): Promise<void> {
    const killPromises: Promise<void>[] = []
    for (const [, pid] of Object.entries(session.pids)) {
        if (pid) {
            killPromises.push(gracefulKill(pid, gracePeriod).catch(() => {}))
        }
    }
    await Promise.allSettled(killPromises)
}

/**
 * Internal helper to stop all tracked processes.
 */
async function stopAllProcesses(processes: Map<DevProcessName, ResultPromise>, gracePeriod: number): Promise<void> {
    for (const [, proc] of processes) {
        if (proc.pid) {
            await gracefulKill(proc.pid, gracePeriod).catch(() => {})
        }
    }
}
