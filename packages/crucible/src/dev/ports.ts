import { createServer } from "node:net"
import type { DevPorts } from "../types.js"
import { DEFAULT_PORTS } from "../types.js"
import { networkError } from "../util/errors.js"

/**
 * Check if a port is available by attempting to listen on it.
 */
export async function isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const server = createServer()
        server.once("error", () => resolve(false))
        server.once("listening", () => {
            server.close(() => resolve(true))
        })
        server.listen(port, "127.0.0.1")
    })
}

/**
 * Find the next available port starting from `start`, up to `start + maxOffset`.
 * Throws CRUCIBLE-403 if all ports exhausted.
 */
export async function findAvailablePort(start: number, maxOffset: number = 100): Promise<number> {
    for (let offset = 0; offset <= maxOffset; offset++) {
        if (await isPortAvailable(start + offset)) {
            return start + offset
        }
    }
    throw networkError(
        "CRUCIBLE-403",
        `No available port in range ${start}\u2013${start + maxOffset}`,
        "Free up ports or specify different defaults.",
    )
}

/**
 * Allocate ports for all three dev processes.
 */
export async function allocateDevPorts(defaults?: Partial<DevPorts>): Promise<DevPorts> {
    const base = { ...DEFAULT_PORTS, ...defaults }
    return {
        server: await findAvailablePort(base.server),
        display: await findAvailablePort(base.display),
        controller: await findAvailablePort(base.controller),
    }
}
