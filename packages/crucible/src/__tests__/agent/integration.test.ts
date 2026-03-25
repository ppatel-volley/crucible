import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { mkdtemp, writeFile, readFile, mkdir, rm, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type Anthropic from "@anthropic-ai/sdk"
import type { AgentRunnerOptions, AssembledContext } from "../../types.js"

// --- Mocks (must be declared before vi.mock calls) ---

const mockCreate = vi.fn()

vi.mock("@anthropic-ai/sdk", () => {
    return {
        default: vi.fn().mockImplementation(() => ({
            messages: { create: (...args: unknown[]) => mockCreate(...args) },
        })),
    }
})

const mockExeca = vi.fn()

vi.mock("execa", () => ({
    execa: (...args: unknown[]) => mockExeca(...args),
}))

const mockGitAdd = vi.fn().mockResolvedValue(undefined)
const mockGitCommit = vi.fn().mockResolvedValue("sha-integration-test")

vi.mock("../../git/operations.js", () => ({
    createGitOperations: () => ({
        add: mockGitAdd,
        commit: mockGitCommit,
        init: vi.fn(),
        push: vi.fn(),
        addRemote: vi.fn(),
        getHeadSha: vi.fn(),
        isClean: vi.fn(),
    }),
}))

// Mock resolvePaths so logViolation writes to our temp dir
let auditLogDir = ""

vi.mock("../../config/paths.js", () => ({
    resolvePaths: () => ({
        dataDir: auditLogDir,
        configDir: auditLogDir,
        configFile: join(auditLogDir, "config.json"),
        gamesDir: auditLogDir,
        sessionsDir: join(auditLogDir, "sessions"),
    }),
    ensureDir: vi.fn(),
    _resetEnsuredDirs: vi.fn(),
}))

// --- Helpers ---

let tempDir: string

function makeToolUseResponse(
    toolName: string,
    toolInput: Record<string, unknown>,
    toolUseId = "tool-1",
): Anthropic.Message {
    return {
        id: "msg-tool",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-20250514",
        content: [{ type: "tool_use", id: toolUseId, name: toolName, input: toolInput }],
        stop_reason: "tool_use",
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    } as Anthropic.Message
}

function makeTextResponse(text: string): Anthropic.Message {
    return {
        id: "msg-text",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-20250514",
        content: [{ type: "text", text }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    } as Anthropic.Message
}

function makeContext(files: AssembledContext["files"] = []): AssembledContext {
    return { files, totalTokens: 0, truncated: false, missedFiles: [] }
}

function makeOptions(overrides?: Partial<AgentRunnerOptions>): AgentRunnerOptions {
    return {
        gamePath: tempDir,
        gameId: "integration-test-game",
        sessionId: "sess-integration-001",
        apiKey: "sk-test-dummy",
        context: makeContext(),
        ...overrides,
    }
}

// --- Setup / Teardown ---

beforeEach(async () => {
    vi.clearAllMocks()
    tempDir = await mkdtemp(join(tmpdir(), "crucible-integration-"))
    auditLogDir = join(tempDir, "data")
    await mkdir(auditLogDir, { recursive: true })
})

afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
})

// Lazy-import so mocks are wired first
async function getRunner() {
    return await import("../../agent/runner.js")
}

async function getContext() {
    return await import("../../agent/context.js")
}

// --- Integration Tests ---

describe("Agent Integration Tests", () => {
    describe("file write operations", () => {
        it("writes an allowed file to disk", async () => {
            const { runAgentTurn } = await getRunner()

            // Set up directory structure so the path is writable
            await mkdir(join(tempDir, "apps", "server", "src"), { recursive: true })

            const fileContent = 'export const hello = "world";\n'

            mockCreate
                .mockResolvedValueOnce(
                    makeToolUseResponse("write_file", {
                        path: "apps/server/src/test.ts",
                        content: fileContent,
                    }),
                )
                .mockResolvedValueOnce(makeTextResponse("File written successfully."))

            const { result } = await runAgentTurn(makeOptions(), "Create a test file", [])

            // Verify the file actually exists on disk with correct content
            const written = await readFile(join(tempDir, "apps", "server", "src", "test.ts"), "utf-8")
            expect(written).toBe(fileContent)
            expect(result.filesModified).toContain("apps/server/src/test.ts")
            expect(result.response).toBe("File written successfully.")
        })

        it("blocks writing a restricted file and returns error to Claude", async () => {
            const { runAgentTurn } = await getRunner()

            mockCreate
                .mockResolvedValueOnce(
                    makeToolUseResponse("write_file", {
                        path: "Dockerfile",
                        content: "FROM node:20",
                    }),
                )
                .mockResolvedValueOnce(makeTextResponse("Sorry, that file is restricted."))

            const { result } = await runAgentTurn(makeOptions(), "Modify the Dockerfile", [])

            // Verify the file does NOT exist on disk
            let fileExists = true
            try {
                await readFile(join(tempDir, "Dockerfile"), "utf-8")
            } catch {
                fileExists = false
            }
            expect(fileExists).toBe(false)
            expect(result.filesModified).toEqual([])

            // Verify the tool result sent back to Claude contains an error
            // The second call to mockCreate should have received tool results with is_error: true
            const secondCall = mockCreate.mock.calls[1]
            const messages = secondCall[0].messages as Anthropic.MessageParam[]
            const toolResultMsg = messages.find(
                (m) => m.role === "user" && Array.isArray(m.content),
            )
            expect(toolResultMsg).toBeDefined()
            const toolResults = toolResultMsg!.content as Anthropic.ToolResultBlockParam[]
            expect(toolResults[0]!.is_error).toBe(true)
            expect(toolResults[0]!.content).toContain("cannot be modified")
        })
    })

    describe("file read operations", () => {
        it("reads a file from the game directory and returns content as tool result", async () => {
            const { runAgentTurn } = await getRunner()

            // Create a file to read
            const srcDir = join(tempDir, "apps", "server", "src")
            await mkdir(srcDir, { recursive: true })
            await writeFile(join(srcDir, "index.ts"), 'export const main = () => "hello";', "utf-8")

            mockCreate
                .mockResolvedValueOnce(
                    makeToolUseResponse("read_file", { path: "apps/server/src/index.ts" }),
                )
                .mockResolvedValueOnce(makeTextResponse("I read the file contents."))

            const { result } = await runAgentTurn(makeOptions(), "Read the index file", [])

            expect(result.response).toBe("I read the file contents.")

            // Verify the tool result sent to Claude contained the file contents
            const secondCall = mockCreate.mock.calls[1]
            const messages = secondCall[0].messages as Anthropic.MessageParam[]
            const toolResultMsg = messages.find(
                (m) => m.role === "user" && Array.isArray(m.content),
            )
            const toolResults = toolResultMsg!.content as Anthropic.ToolResultBlockParam[]
            expect(toolResults[0]!.is_error).toBeFalsy()
            expect(toolResults[0]!.content).toContain('export const main = () => "hello"')
        })
    })

    describe("command execution", () => {
        it("runs a whitelisted command and returns stdout as tool result", async () => {
            const { runAgentTurn } = await getRunner()

            mockExeca.mockResolvedValueOnce({ stdout: "No errors found", stderr: "" })

            mockCreate
                .mockResolvedValueOnce(
                    makeToolUseResponse("run_command", { command: "pnpm typecheck" }),
                )
                .mockResolvedValueOnce(makeTextResponse("Typecheck passed!"))

            const { result } = await runAgentTurn(makeOptions(), "Run typecheck", [])

            expect(mockExeca).toHaveBeenCalledWith("pnpm", ["typecheck"], { cwd: tempDir })
            expect(result.response).toBe("Typecheck passed!")

            // Verify stdout was passed back as tool result
            const secondCall = mockCreate.mock.calls[1]
            const messages = secondCall[0].messages as Anthropic.MessageParam[]
            const toolResultMsg = messages.find(
                (m) => m.role === "user" && Array.isArray(m.content),
            )
            const toolResults = toolResultMsg!.content as Anthropic.ToolResultBlockParam[]
            expect(toolResults[0]!.content).toBe("No errors found")
            expect(toolResults[0]!.is_error).toBeFalsy()
        })

        it("blocks a non-whitelisted command and returns error to Claude", async () => {
            const { runAgentTurn } = await getRunner()

            mockCreate
                .mockResolvedValueOnce(
                    makeToolUseResponse("run_command", { command: "rm -rf /" }),
                )
                .mockResolvedValueOnce(makeTextResponse("Cannot run that command."))

            const { result } = await runAgentTurn(makeOptions(), "Delete everything", [])

            expect(mockExeca).not.toHaveBeenCalled()

            // Verify error tool result
            const secondCall = mockCreate.mock.calls[1]
            const messages = secondCall[0].messages as Anthropic.MessageParam[]
            const toolResultMsg = messages.find(
                (m) => m.role === "user" && Array.isArray(m.content),
            )
            const toolResults = toolResultMsg!.content as Anthropic.ToolResultBlockParam[]
            expect(toolResults[0]!.is_error).toBe(true)
            expect(toolResults[0]!.content).toContain("Command not allowed")
            expect(toolResults[0]!.content).toContain("rm -rf /")
        })
    })

    describe("full conversation with multiple tool calls", () => {
        it("handles read -> write -> end_turn multi-step conversation", async () => {
            const { runAgentTurn } = await getRunner()

            // Set up a source file to read
            const srcDir = join(tempDir, "apps", "server", "src")
            await mkdir(srcDir, { recursive: true })
            await writeFile(join(srcDir, "game.ts"), "// original content", "utf-8")

            const updatedContent = '// updated content\nexport const version = 2;\n'

            // Step 1: Claude reads the file
            mockCreate.mockResolvedValueOnce(
                makeToolUseResponse("read_file", { path: "apps/server/src/game.ts" }, "tool-read"),
            )
            // Step 2: Claude writes modified content
            mockCreate.mockResolvedValueOnce(
                makeToolUseResponse(
                    "write_file",
                    { path: "apps/server/src/game.ts", content: updatedContent },
                    "tool-write",
                ),
            )
            // Step 3: Claude ends the turn
            mockCreate.mockResolvedValueOnce(
                makeTextResponse("I updated the game file with the new version export."),
            )

            const { result, updatedHistory } = await runAgentTurn(makeOptions(), "Update the game file", [])

            // Verify Claude API was called 3 times (read, write, final)
            expect(mockCreate).toHaveBeenCalledTimes(3)

            // Verify the file was actually updated on disk
            const diskContent = await readFile(join(srcDir, "game.ts"), "utf-8")
            expect(diskContent).toBe(updatedContent)

            // Verify response and modified files
            expect(result.response).toBe("I updated the game file with the new version export.")
            expect(result.filesModified).toEqual(["apps/server/src/game.ts"])

            // Verify conversation history was built correctly:
            // user msg, assistant (read_file tool_use), user (tool_result),
            // assistant (write_file tool_use), user (tool_result), assistant (end_turn text)
            expect(updatedHistory).toHaveLength(6)
            expect(updatedHistory[0]!.role).toBe("user")
            expect(updatedHistory[1]!.role).toBe("assistant")
            expect(updatedHistory[2]!.role).toBe("user")
            expect(updatedHistory[3]!.role).toBe("assistant")
            expect(updatedHistory[4]!.role).toBe("user")
            expect(updatedHistory[5]!.role).toBe("assistant")

            // Verify token accumulation across all 3 calls
            expect(result.tokenUsage.inputTokens).toBe(300) // 100 * 3
            expect(result.tokenUsage.outputTokens).toBe(150) // 50 * 3
        })
    })

    describe("context assembly into system prompt", () => {
        it("assembles context from game directory and feeds into system prompt", async () => {
            const { assembleContext } = await getContext()
            const { buildSystemPrompt } = await getRunner()

            // Create files that assembleContext will pick up
            const sharedSrc = join(tempDir, "packages", "shared", "src")
            await mkdir(sharedSrc, { recursive: true })
            await writeFile(
                join(sharedSrc, "types.ts"),
                "export interface GameState { score: number }",
                "utf-8",
            )

            const context = await assembleContext({ gamePath: tempDir })

            // The shared/src .ts file should be picked up at "high" priority
            const typesFile = context.files.find((f) => f.path.includes("types.ts"))
            expect(typesFile).toBeDefined()
            expect(typesFile!.content).toContain("GameState")

            // Feed into buildSystemPrompt and verify
            const prompt = buildSystemPrompt(context, "integration-test-game")
            expect(prompt).toContain('"integration-test-game"')
            expect(prompt).toContain("GameState")
            expect(prompt).toContain("read_file, write_file, run_command, list_files")
        })
    })

    describe("violation logging", () => {
        it("writes audit log when agent attempts to write a restricted file", async () => {
            const { runAgentTurn } = await getRunner()

            mockCreate
                .mockResolvedValueOnce(
                    makeToolUseResponse("write_file", {
                        path: "Dockerfile",
                        content: "FROM node:20",
                    }),
                )
                .mockResolvedValueOnce(makeTextResponse("Cannot modify that file."))

            await runAgentTurn(makeOptions(), "Change the Dockerfile", [])

            // Read the audit log file to verify violation was recorded
            const auditLogPath = join(auditLogDir, "agent-audit.log")
            let auditContent: string
            try {
                auditContent = await readFile(auditLogPath, "utf-8")
            } catch {
                // If the file doesn't exist, the violation wasn't logged
                throw new Error("Audit log file was not created")
            }

            const lines = auditContent.trim().split("\n")
            expect(lines.length).toBeGreaterThanOrEqual(1)

            const violation = JSON.parse(lines[0]!)
            expect(violation.path).toBe("Dockerfile")
            expect(violation.reason).toBe("denied-pattern")
            expect(violation.deniedPattern).toBe("Dockerfile")
            expect(violation.sessionId).toBe("sess-integration-001")
            expect(violation.timestamp).toBeDefined()
        })

        it("writes audit log for files outside allowed patterns", async () => {
            const { runAgentTurn } = await getRunner()

            mockCreate
                .mockResolvedValueOnce(
                    makeToolUseResponse("write_file", {
                        path: "some/random/path.txt",
                        content: "sneaky",
                    }),
                )
                .mockResolvedValueOnce(makeTextResponse("Cannot write there."))

            await runAgentTurn(makeOptions(), "Write to random path", [])

            const auditLogPath = join(auditLogDir, "agent-audit.log")
            const auditContent = await readFile(auditLogPath, "utf-8")
            const violation = JSON.parse(auditContent.trim().split("\n").pop()!)
            expect(violation.path).toBe("some/random/path.txt")
            expect(violation.reason).toBe("not-allowed")
        })
    })
})
