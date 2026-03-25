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

const mockKillProcessTree = vi.fn<(pid: number) => Promise<void>>()
vi.mock("../../util/process.js", () => ({
    killProcessTree: (...args: unknown[]) => mockKillProcessTree(...(args as [number])),
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
    _exitCode: number | null
    _thenCb: ((result: { exitCode: number | null }) => void) | null
    simulateExit: (code: number | null) => void
}

function createMockProcess(pid: number | undefined): MockProcess {
    const stdout = new EventEmitter()
    const stderr = new EventEmitter()

    const proc: MockProcess = Object.assign(new EventEmitter(), {
        pid,
        stdout,
        stderr,
        _exitCode: null as number | null,
        _thenCb: null as ((result: { exitCode: number | null }) => void) | null,
        then(cb: (result: { exitCode: number | null }) => void): MockProcess {
            proc._thenCb = cb
            return proc
        },
        catch(_cb: (err: unknown) => void): MockProcess {
            return proc
        },
        simulateExit(code: number | null): void {
            proc._exitCode = code
            if (proc._thenCb) {
                proc._thenCb({ exitCode: code })
            }
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
            createMockProcess(1001),
            createMockProcess(1002),
            createMockProcess(1003),
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
            return proc
        })

        let writerCallCount = 0
        mockCreateProcessWriter.mockImplementation(() => {
            const writer = mockWriters[writerCallCount]!
            writerCallCount++
            return writer
        })

        mockAllocateDevPorts.mockResolvedValue(DEFAULT_TEST_PORTS)
        mockKillProcessTree.mockResolvedValue(undefined)
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

            // Simulate stdout data on the server process
            mockProcesses[0]!.stdout.emit("data", Buffer.from("server ready\n"))

            expect(mockWriters[0]!.stdout).toHaveBeenCalledWith("server ready")
        })

        it("pipes process stderr through the correct writer", async () => {
            const { startDevSession } = await import("../../dev/orchestrator.js")

            await startDevSession({ gamePath: "/tmp/game", gameId: "test-game" })

            // Simulate stderr data on the display process
            mockProcesses[1]!.stderr.emit("data", Buffer.from("warning: something\n"))

            expect(mockWriters[1]!.stderr).toHaveBeenCalledWith("warning: something")
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

        it("handles processes with undefined pid", async () => {
            mockProcesses[0] = createMockProcess(undefined)

            let execaCallCount = 0
            const procs = [mockProcesses[0], mockProcesses[1], mockProcesses[2]]
            mockExeca.mockImplementation(() => {
                const proc = procs[execaCallCount]!
                execaCallCount++
                return proc
            })

            const { startDevSession } = await import("../../dev/orchestrator.js")

            const session = await startDevSession({ gamePath: "/tmp/game", gameId: "test-game" })

            expect(session.pids.server).toBeNull()
            expect(session.pids.display).toBe(1002)
        })

        it("skips empty lines when piping output", async () => {
            const { startDevSession } = await import("../../dev/orchestrator.js")

            await startDevSession({ gamePath: "/tmp/game", gameId: "test-game" })

            // Emit data with blank lines
            mockProcesses[0]!.stdout.emit("data", Buffer.from("line1\n\n  \nline2\n"))

            expect(mockWriters[0]!.stdout).toHaveBeenCalledTimes(2)
            expect(mockWriters[0]!.stdout).toHaveBeenCalledWith("line1")
            expect(mockWriters[0]!.stdout).toHaveBeenCalledWith("line2")
        })
    })

    describe("stopDevSession", () => {
        it("calls killProcessTree for each PID", async () => {
            const { stopDevSession } = await import("../../dev/orchestrator.js")

            const session = {
                ports: DEFAULT_TEST_PORTS,
                pids: { server: 1001, display: 1002, controller: 1003 },
                gamePath: "/tmp/game",
                gameId: "test-game",
            }

            await stopDevSession(session)

            expect(mockKillProcessTree).toHaveBeenCalledTimes(3)
            expect(mockKillProcessTree).toHaveBeenCalledWith(1001)
            expect(mockKillProcessTree).toHaveBeenCalledWith(1002)
            expect(mockKillProcessTree).toHaveBeenCalledWith(1003)
        })

        it("handles already-dead processes gracefully", async () => {
            const { stopDevSession } = await import("../../dev/orchestrator.js")

            mockKillProcessTree.mockRejectedValue(new Error("No such process"))

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

            expect(mockKillProcessTree).toHaveBeenCalledTimes(1)
            expect(mockKillProcessTree).toHaveBeenCalledWith(1002)
        })
    })
})
