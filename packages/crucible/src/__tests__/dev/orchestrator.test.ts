import { EventEmitter } from "node:events"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { DevPorts } from "../../types.js"

// --- Mocks ---

const mockAllocateDevPorts = vi.fn<(defaults?: Partial<DevPorts>) => Promise<DevPorts>>()
vi.mock("../../dev/ports.js", () => ({
    allocateDevPorts: (...args: unknown[]) => mockAllocateDevPorts(...(args as [Partial<DevPorts>?])),
}))

const mockCreateProcessWriter = vi.fn()
const mockFormatProcessStatus = vi.fn()
vi.mock("../../dev/output.js", () => ({
    createProcessWriter: (...args: unknown[]) => mockCreateProcessWriter(...args),
    formatProcessStatus: (...args: unknown[]) => mockFormatProcessStatus(...args),
}))

const mockGracefulKill = vi.fn<(pid: number, gracePeriod?: number) => Promise<void>>()
vi.mock("../../util/process.js", () => ({
    killProcessTree: vi.fn().mockResolvedValue(undefined),
    gracefulKill: (...args: unknown[]) => mockGracefulKill(...(args as [number, number?])),
}))

vi.mock("../../util/errors.js", () => ({
    networkError: (code: string, message: string, recovery: string) =>
        Object.assign(new Error(message), { code, recovery }),
}))

const mockExeca = vi.fn()
vi.mock("execa", () => ({
    execa: (...args: unknown[]) => mockExeca(...args),
}))

// --- Helpers ---

interface MockProcess extends EventEmitter {
    pid: number | undefined
    stdout: EventEmitter
    stderr: EventEmitter
    then: (cb: (result: { exitCode: number | null }) => void) => MockProcess
    catch: (cb: (err: unknown) => void) => MockProcess
    _thenCb: ((result: { exitCode: number | null }) => void) | null
    simulateExit: (code: number | null) => void
    emitReady: () => void
}

function createMockProcess(pid: number | undefined, name: "server" | "display" | "controller" = "server"): MockProcess {
    const stdout = new EventEmitter()
    const stderr = new EventEmitter()

    const readySignals: Record<string, string> = {
        server: "WGFServer started on :8090",
        display: "VITE ready in 500ms",
        controller: "VITE ready in 300ms",
    }

    const proc: MockProcess = Object.assign(new EventEmitter(), {
        pid,
        stdout,
        stderr,
        _thenCb: null as ((result: { exitCode: number | null }) => void) | null,
        then(cb: (result: { exitCode: number | null }) => void): MockProcess {
            proc._thenCb = cb
            return proc
        },
        catch(_cb: (err: unknown) => void): MockProcess {
            return proc
        },
        simulateExit(code: number | null): void {
            if (proc._thenCb) {
                proc._thenCb({ exitCode: code })
            }
        },
        emitReady(): void {
            stdout.emit("data", Buffer.from(readySignals[name] + "\n"))
        },
    })

    return proc
}

const DEFAULT_TEST_PORTS: DevPorts = { server: 8090, display: 3000, controller: 5174 }

describe("orchestrator", () => {
    let mockProcesses: MockProcess[]
    let mockWriters: Array<{ stdout: ReturnType<typeof vi.fn>; stderr: ReturnType<typeof vi.fn> }>

    beforeEach(() => {
        mockProcesses = [
            createMockProcess(1001, "server"),
            createMockProcess(1002, "display"),
            createMockProcess(1003, "controller"),
        ]

        mockWriters = [
            { stdout: vi.fn(), stderr: vi.fn() },
            { stdout: vi.fn(), stderr: vi.fn() },
            { stdout: vi.fn(), stderr: vi.fn() },
        ]

        let execaCallCount = 0
        mockExeca.mockImplementation(() => {
            const proc = mockProcesses[execaCallCount]!
            execaCallCount++
            // Auto-emit ready signal after a tick
            setTimeout(() => proc.emitReady(), 10)
            return proc
        })

        let writerCallCount = 0
        mockCreateProcessWriter.mockImplementation(() => {
            const writer = mockWriters[writerCallCount]!
            writerCallCount++
            return writer
        })

        mockAllocateDevPorts.mockResolvedValue(DEFAULT_TEST_PORTS)
        mockGracefulKill.mockResolvedValue(undefined)
        mockFormatProcessStatus.mockImplementation(
            (name: string, msg: string) => `[${name}] ${msg}`,
        )
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    describe("startDevSession", () => {
        it("allocates ports and starts 3 processes", async () => {
            const { startDevSession } = await import("../../dev/orchestrator.js")

            await startDevSession({ gamePath: "/tmp/game", gameId: "test-game" })

            expect(mockAllocateDevPorts).toHaveBeenCalledOnce()
            expect(mockExeca).toHaveBeenCalledTimes(3)
        })

        it("each process is started with correct pnpm filter and env vars", async () => {
            const { startDevSession } = await import("../../dev/orchestrator.js")

            await startDevSession({ gamePath: "/tmp/game", gameId: "test-game" })

            // Server
            expect(mockExeca).toHaveBeenNthCalledWith(
                1,
                "pnpm",
                ["--filter", "*/server", "dev"],
                expect.objectContaining({
                    cwd: "/tmp/game",
                    env: expect.objectContaining({ PORT: "8090" }),
                    reject: false,
                }),
            )

            // Display
            expect(mockExeca).toHaveBeenNthCalledWith(
                2,
                "pnpm",
                ["--filter", "*/display", "dev"],
                expect.objectContaining({
                    cwd: "/tmp/game",
                    env: expect.objectContaining({
                        PORT: "3000",
                        VITE_SERVER_URL: "http://127.0.0.1:8090",
                    }),
                    reject: false,
                }),
            )

            // Controller
            expect(mockExeca).toHaveBeenNthCalledWith(
                3,
                "pnpm",
                ["--filter", "*/controller", "dev"],
                expect.objectContaining({
                    cwd: "/tmp/game",
                    env: expect.objectContaining({
                        PORT: "5174",
                        VITE_SERVER_URL: "http://127.0.0.1:8090",
                    }),
                    reject: false,
                }),
            )
        })

        it("pipes process stdout through the correct writer", async () => {
            const { startDevSession } = await import("../../dev/orchestrator.js")

            await startDevSession({ gamePath: "/tmp/game", gameId: "test-game" })

            // Simulate additional stdout data on the server process
            mockProcesses[0]!.stdout.emit("data", Buffer.from("extra log line\n"))

            expect(mockWriters[0]!.stdout).toHaveBeenCalledWith("extra log line")
        })

        it("returns a DevSession with correct ports and PIDs", async () => {
            const { startDevSession } = await import("../../dev/orchestrator.js")

            const session = await startDevSession({ gamePath: "/tmp/game", gameId: "test-game" })

            expect(session.ports).toEqual(DEFAULT_TEST_PORTS)
            expect(session.pids).toEqual({ server: 1001, display: 1002, controller: 1003 })
            expect(session.gamePath).toBe("/tmp/game")
            expect(session.gameId).toBe("test-game")
        })

        it("passes gamePath as cwd to all processes", async () => {
            const { startDevSession } = await import("../../dev/orchestrator.js")

            await startDevSession({ gamePath: "/my/game/path", gameId: "my-game" })

            for (const call of mockExeca.mock.calls) {
                expect(call[2]).toHaveProperty("cwd", "/my/game/path")
            }
        })

        it("passes custom port overrides to allocateDevPorts", async () => {
            const { startDevSession } = await import("../../dev/orchestrator.js")

            const customPorts: Partial<DevPorts> = { server: 9999 }
            await startDevSession({ gamePath: "/tmp/game", gameId: "test-game", ports: customPorts })

            expect(mockAllocateDevPorts).toHaveBeenCalledWith(customPorts)
        })

        it("detects server readiness from VGF/pino JSON logs", async () => {
            // Override server process to emit JSON log instead of plain text
            const jsonServerProc = createMockProcess(1001, "server")
            const originalEmitReady = jsonServerProc.emitReady
            jsonServerProc.emitReady = () => {
                jsonServerProc.stdout.emit("data", Buffer.from(
                    '{"level":30,"time":1774944366507,"msg":"Trivia Royale dev server started"}\n',
                ))
            }
            mockProcesses[0] = jsonServerProc

            let execaCallCount = 0
            mockExeca.mockImplementation(() => {
                const proc = mockProcesses[execaCallCount]!
                execaCallCount++
                setTimeout(() => proc.emitReady(), 10)
                return proc
            })

            const { startDevSession } = await import("../../dev/orchestrator.js")

            const session = await startDevSession({ gamePath: "/tmp/game", gameId: "test-game" })

            expect(session.ports).toEqual(DEFAULT_TEST_PORTS)
            expect(session.pids.server).toBe(1001)
        })

        it("detects server readiness from 'listening on' variant", async () => {
            const listenProc = createMockProcess(1001, "server")
            listenProc.emitReady = () => {
                listenProc.stdout.emit("data", Buffer.from("HTTP server listening on port 8090\n"))
            }
            mockProcesses[0] = listenProc

            let execaCallCount = 0
            mockExeca.mockImplementation(() => {
                const proc = mockProcesses[execaCallCount]!
                execaCallCount++
                setTimeout(() => proc.emitReady(), 10)
                return proc
            })

            const { startDevSession } = await import("../../dev/orchestrator.js")

            const session = await startDevSession({ gamePath: "/tmp/game", gameId: "test-game" })

            expect(session.pids.server).toBe(1001)
        })

        it("detects server readiness from standalone 'server started' text", async () => {
            const startedProc = createMockProcess(1001, "server")
            startedProc.emitReady = () => {
                startedProc.stdout.emit("data", Buffer.from("Game server started successfully\n"))
            }
            mockProcesses[0] = startedProc

            let execaCallCount = 0
            mockExeca.mockImplementation(() => {
                const proc = mockProcesses[execaCallCount]!
                execaCallCount++
                setTimeout(() => proc.emitReady(), 10)
                return proc
            })

            const { startDevSession } = await import("../../dev/orchestrator.js")

            const session = await startDevSession({ gamePath: "/tmp/game", gameId: "test-game" })

            expect(session.pids.server).toBe(1001)
        })

        it("skips empty lines when piping output", async () => {
            const { startDevSession } = await import("../../dev/orchestrator.js")

            await startDevSession({ gamePath: "/tmp/game", gameId: "test-game" })

            // Emit data with blank lines
            mockProcesses[0]!.stdout.emit("data", Buffer.from("line1\n\n  \nline2\n"))

            // Ready signal already emitted once, plus our 2 lines
            const calls = mockWriters[0]!.stdout.mock.calls.map((c: string[]) => c[0])
            expect(calls).toContain("line1")
            expect(calls).toContain("line2")
        })
    })

    describe("stopDevSession", () => {
        it("calls gracefulKill for each PID", async () => {
            const { stopDevSession } = await import("../../dev/orchestrator.js")

            const session = {
                ports: DEFAULT_TEST_PORTS,
                pids: { server: 1001, display: 1002, controller: 1003 },
                gamePath: "/tmp/game",
                gameId: "test-game",
            }

            await stopDevSession(session)

            expect(mockGracefulKill).toHaveBeenCalledTimes(3)
            expect(mockGracefulKill).toHaveBeenCalledWith(1001, 5000)
            expect(mockGracefulKill).toHaveBeenCalledWith(1002, 5000)
            expect(mockGracefulKill).toHaveBeenCalledWith(1003, 5000)
        })

        it("handles already-dead processes gracefully", async () => {
            const { stopDevSession } = await import("../../dev/orchestrator.js")

            mockGracefulKill.mockRejectedValue(new Error("No such process"))

            const session = {
                ports: DEFAULT_TEST_PORTS,
                pids: { server: 1001, display: 1002, controller: 1003 },
                gamePath: "/tmp/game",
                gameId: "test-game",
            }

            // Should not throw
            await expect(stopDevSession(session)).resolves.toBeUndefined()
        })

        it("skips null PIDs", async () => {
            const { stopDevSession } = await import("../../dev/orchestrator.js")

            const session = {
                ports: DEFAULT_TEST_PORTS,
                pids: { server: null, display: 1002, controller: null },
                gamePath: "/tmp/game",
                gameId: "test-game",
            }

            await stopDevSession(session)

            expect(mockGracefulKill).toHaveBeenCalledTimes(1)
            expect(mockGracefulKill).toHaveBeenCalledWith(1002, 5000)
        })

        it("passes custom grace period", async () => {
            const { stopDevSession } = await import("../../dev/orchestrator.js")

            const session = {
                ports: DEFAULT_TEST_PORTS,
                pids: { server: 1001, display: null, controller: null },
                gamePath: "/tmp/game",
                gameId: "test-game",
            }

            await stopDevSession(session, 10000)

            expect(mockGracefulKill).toHaveBeenCalledWith(1001, 10000)
        })
    })
})
