import { execa, type ResultPromise } from "execa"

import type { DevProcessName, DevSession, OrchestratorOptions } from "../types.js"
import { allocateDevPorts } from "./ports.js"
import { createProcessWriter, formatProcessStatus } from "./output.js"
import { killProcessTree } from "../util/process.js"

/**
 * Start a local dev session with three child processes: server, display, controller.
 * Processes are started in parallel and monitored for crashes.
 */
export async function startDevSession(options: OrchestratorOptions): Promise<DevSession> {
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

    for (const config of processConfigs) {
        const writer = createProcessWriter(config.name)
        const proc = execa("pnpm", config.args, {
            cwd: options.gamePath,
            env: { ...process.env, ...config.env },
            reject: false,
        })

        pids[config.name] = proc.pid ?? null

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
                // Kill remaining processes
                stopAllProcesses(processes, options.shutdownGracePeriod ?? 5000)
            }
        })

        processes.set(config.name, proc)
    }

    return { ports, pids, gamePath: options.gamePath, gameId: options.gameId }
}

/**
 * Stop all running processes in a dev session gracefully.
 */
export async function stopDevSession(session: DevSession, _gracePeriod: number = 5000): Promise<void> {
    const killPromises: Promise<void>[] = []
    for (const [, pid] of Object.entries(session.pids)) {
        if (pid) {
            killPromises.push(
                killProcessTree(pid).catch(() => {
                    // Process may already be dead
                }),
            )
        }
    }
    await Promise.allSettled(killPromises)
}

/**
 * Internal helper to stop all tracked processes.
 */
async function stopAllProcesses(processes: Map<DevProcessName, ResultPromise>, _gracePeriod: number): Promise<void> {
    for (const [, proc] of processes) {
        if (proc.pid) {
            await killProcessTree(proc.pid).catch(() => {})
        }
    }
}
