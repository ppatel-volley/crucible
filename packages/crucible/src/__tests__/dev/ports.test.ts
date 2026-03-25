import { createServer, type AddressInfo, type Server } from "node:net"
import { describe, it, expect, afterEach } from "vitest"
import { isPortAvailable, findAvailablePort, allocateDevPorts } from "../../dev/ports.js"
import { CrucibleError } from "../../util/errors.js"

/**
 * Helper: start a TCP server on a random port and return the server + port.
 */
function occupyRandomPort(): Promise<{ server: Server; port: number }> {
    return new Promise((resolve, reject) => {
        const server = createServer()
        server.once("error", reject)
        server.listen(0, "127.0.0.1", () => {
            const { port } = server.address() as AddressInfo
            resolve({ server, port })
        })
    })
}

describe("isPortAvailable", () => {
    const servers: Server[] = []

    afterEach(async () => {
        await Promise.all(
            servers.map(
                (s) =>
                    new Promise<void>((resolve) => {
                        s.close(() => resolve())
                    }),
            ),
        )
        servers.length = 0
    })

    it("returns true for a free port", async () => {
        // Get a random free port by binding then closing
        const { server, port } = await occupyRandomPort()
        await new Promise<void>((resolve) => server.close(() => resolve()))
        // Port should now be free
        const available = await isPortAvailable(port)
        expect(available).toBe(true)
    })

    it("returns false for an occupied port", async () => {
        const { server, port } = await occupyRandomPort()
        servers.push(server)
        const available = await isPortAvailable(port)
        expect(available).toBe(false)
    })
})

describe("findAvailablePort", () => {
    const servers: Server[] = []

    afterEach(async () => {
        await Promise.all(
            servers.map(
                (s) =>
                    new Promise<void>((resolve) => {
                        s.close(() => resolve())
                    }),
            ),
        )
        servers.length = 0
    })

    it("returns the default port when it is free", async () => {
        // Use a random port as the "default" — close it first so it's free
        const { server, port } = await occupyRandomPort()
        await new Promise<void>((resolve) => server.close(() => resolve()))

        const result = await findAvailablePort(port)
        expect(result).toBe(port)
    })

    it("skips occupied ports and returns the next free one", async () => {
        // Occupy a port, then ask findAvailablePort to start from that port
        const { server, port } = await occupyRandomPort()
        servers.push(server)

        const result = await findAvailablePort(port, 10)
        expect(result).toBeGreaterThan(port)
        expect(result).toBeLessThanOrEqual(port + 10)
    })

    it("throws CRUCIBLE-403 when all ports exhausted", async () => {
        const { server, port } = await occupyRandomPort()
        servers.push(server)

        await expect(findAvailablePort(port, 0)).rejects.toThrow(CrucibleError)
        await expect(findAvailablePort(port, 0)).rejects.toThrow(/No available port/)
    })
})

describe("allocateDevPorts", () => {
    it("returns all three ports", async () => {
        const ports = await allocateDevPorts()
        expect(ports).toHaveProperty("server")
        expect(ports).toHaveProperty("display")
        expect(ports).toHaveProperty("controller")
        expect(typeof ports.server).toBe("number")
        expect(typeof ports.display).toBe("number")
        expect(typeof ports.controller).toBe("number")
    })

    it("accepts custom defaults", async () => {
        // Use a high ephemeral port range to avoid conflicts
        const ports = await allocateDevPorts({
            server: 49100,
            display: 49200,
            controller: 49300,
        })
        expect(ports.server).toBeGreaterThanOrEqual(49100)
        expect(ports.display).toBeGreaterThanOrEqual(49200)
        expect(ports.controller).toBeGreaterThanOrEqual(49300)
    })
})
