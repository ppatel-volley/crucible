import { describe, it, expect, vi, beforeEach } from "vitest"
import type Anthropic from "@anthropic-ai/sdk"
import type { AgentRunnerOptions, AssembledContext } from "../../types.js"

// --- Mocks ---

const mockSendMessage = vi.fn()
const mockCreateClaudeClient = vi.fn().mockReturnValue({})

vi.mock("../../api/claude.js", () => ({
    createClaudeClient: (...args: unknown[]) => mockCreateClaudeClient(...args),
    sendMessage: (...args: unknown[]) => mockSendMessage(...args),
    AGENT_TOOLS: [],
    DEFAULT_MODEL: "claude-sonnet-4-20250514",
}))

const mockCheckFileRestriction = vi.fn()
const mockLogViolation = vi.fn().mockResolvedValue(undefined)

vi.mock("../../agent/restrictions.js", () => ({
    checkFileRestriction: (...args: unknown[]) => mockCheckFileRestriction(...args),
    logViolation: (...args: unknown[]) => mockLogViolation(...args),
}))

const mockGitAdd = vi.fn().mockResolvedValue(undefined)
const mockGitCommit = vi.fn().mockResolvedValue("abc1234")

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

const mockReadFile = vi.fn()
const mockWriteFile = vi.fn().mockResolvedValue(undefined)
const mockReaddir = vi.fn()
const mockMkdir = vi.fn().mockResolvedValue(undefined)

vi.mock("node:fs/promises", () => ({
    readFile: (...args: unknown[]) => mockReadFile(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
    readdir: (...args: unknown[]) => mockReaddir(...args),
    mkdir: (...args: unknown[]) => mockMkdir(...args),
}))

const mockExeca = vi.fn()

vi.mock("execa", () => ({
    execa: (...args: unknown[]) => mockExeca(...args),
}))

// --- Helpers ---

function makeContext(files: AssembledContext["files"] = []): AssembledContext {
    return { files, totalTokens: 0, truncated: false, missedFiles: [] }
}

function makeOptions(overrides?: Partial<AgentRunnerOptions>): AgentRunnerOptions {
    return {
        gamePath: "/fake/game",
        gameId: "test-game",
        sessionId: "sess-001",
        apiKey: "sk-test",
        context: makeContext(),
        ...overrides,
    }
}

function makeEndTurnResponse(text: string): Anthropic.Message {
    return {
        id: "msg-1",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-20250514",
        content: [{ type: "text", text }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    } as Anthropic.Message
}

function makeToolUseResponse(toolCalls: Array<{ id: string; name: string; input: Record<string, string> }>): Anthropic.Message {
    return {
        id: "msg-2",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-20250514",
        content: toolCalls.map((tc) => ({
            type: "tool_use" as const,
            id: tc.id,
            name: tc.name,
            input: tc.input,
        })),
        stop_reason: "tool_use",
        stop_sequence: null,
        usage: { input_tokens: 80, output_tokens: 40, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    } as Anthropic.Message
}

// --- Tests ---

describe("runAgentTurn", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    // Lazy-import so mocks are wired up first
    async function getRunner() {
        return await import("../../agent/runner.js")
    }

    it("returns simple text response with no tool calls", async () => {
        const { runAgentTurn } = await getRunner()
        mockSendMessage.mockResolvedValueOnce(makeEndTurnResponse("Hello, I can help with that!"))

        const { result, updatedHistory } = await runAgentTurn(makeOptions(), "Hi there", [])

        expect(result.response).toBe("Hello, I can help with that!")
        expect(result.filesModified).toEqual([])
        expect(result.commitSha).toBeUndefined()
        expect(result.tokenUsage).toEqual({ inputTokens: 100, outputTokens: 50 })
        expect(result.stopReason).toBe("end_turn")
        // History: user message + assistant response
        expect(updatedHistory).toHaveLength(2)
        expect(updatedHistory[0]).toEqual({ role: "user", content: "Hi there" })
    })

    it("dispatches read_file tool and returns content", async () => {
        const { runAgentTurn } = await getRunner()

        mockSendMessage
            .mockResolvedValueOnce(
                makeToolUseResponse([{ id: "tool-1", name: "read_file", input: { path: "apps/server/src/index.ts" } }]),
            )
            .mockResolvedValueOnce(makeEndTurnResponse("I read the file."))

        mockReadFile.mockResolvedValueOnce("const x = 1;")

        const { result } = await runAgentTurn(makeOptions(), "Read the index file", [])

        expect(mockReadFile).toHaveBeenCalledWith(
            expect.stringMatching(/apps[/\\]server[/\\]src[/\\]index\.ts$/),
            "utf-8",
        )
        expect(result.response).toBe("I read the file.")
        expect(result.tokenUsage.inputTokens).toBe(180) // 80 + 100
    })

    it("allows write_file to permitted path", async () => {
        const { runAgentTurn } = await getRunner()

        mockCheckFileRestriction.mockReturnValue({ allowed: true })
        mockSendMessage
            .mockResolvedValueOnce(
                makeToolUseResponse([
                    { id: "tool-1", name: "write_file", input: { path: "apps/server/src/foo.ts", content: "export const foo = 1;" } },
                ]),
            )
            .mockResolvedValueOnce(makeEndTurnResponse("Done!"))

        const { result } = await runAgentTurn(makeOptions(), "Create foo.ts", [])

        expect(mockWriteFile).toHaveBeenCalledWith(
            expect.stringMatching(/apps[/\\]server[/\\]src[/\\]foo\.ts$/),
            "export const foo = 1;",
            "utf-8",
        )
        expect(result.filesModified).toEqual(["apps/server/src/foo.ts"])
    })

    it("denies write_file to restricted path", async () => {
        const { runAgentTurn } = await getRunner()

        mockCheckFileRestriction.mockReturnValue({
            allowed: false,
            reason: "Path matches denied pattern: Dockerfile",
            deniedPattern: "Dockerfile",
        })

        mockSendMessage
            .mockResolvedValueOnce(
                makeToolUseResponse([
                    { id: "tool-1", name: "write_file", input: { path: "Dockerfile", content: "FROM node" } },
                ]),
            )
            .mockResolvedValueOnce(makeEndTurnResponse("Sorry, I cannot modify that file."))

        const { result } = await runAgentTurn(makeOptions(), "Modify the Dockerfile", [])

        expect(mockWriteFile).not.toHaveBeenCalled()
        expect(mockLogViolation).toHaveBeenCalledWith(
            expect.objectContaining({
                path: "Dockerfile",
                reason: "denied-pattern",
                deniedPattern: "Dockerfile",
            }),
        )
        expect(result.filesModified).toEqual([])
    })

    it("allows whitelisted run_command", async () => {
        const { runAgentTurn } = await getRunner()

        mockExeca.mockResolvedValueOnce({ stdout: "No errors", stderr: "" })
        mockSendMessage
            .mockResolvedValueOnce(
                makeToolUseResponse([{ id: "tool-1", name: "run_command", input: { command: "pnpm typecheck" } }]),
            )
            .mockResolvedValueOnce(makeEndTurnResponse("Typecheck passed!"))

        const { result } = await runAgentTurn(makeOptions(), "Run typecheck", [])

        expect(mockExeca).toHaveBeenCalledWith("pnpm", ["typecheck"], { cwd: "/fake/game" })
        expect(result.response).toBe("Typecheck passed!")
    })

    it("denies non-whitelisted run_command", async () => {
        const { runAgentTurn } = await getRunner()

        mockSendMessage
            .mockResolvedValueOnce(
                makeToolUseResponse([{ id: "tool-1", name: "run_command", input: { command: "rm -rf /" } }]),
            )
            .mockResolvedValueOnce(makeEndTurnResponse("I cannot run that command."))

        const { result } = await runAgentTurn(makeOptions(), "Delete everything", [])

        expect(mockExeca).not.toHaveBeenCalled()
        expect(result.response).toBe("I cannot run that command.")
    })

    it("auto-commits modified files after successful writes", async () => {
        const { runAgentTurn } = await getRunner()

        mockCheckFileRestriction.mockReturnValue({ allowed: true })
        mockSendMessage
            .mockResolvedValueOnce(
                makeToolUseResponse([
                    { id: "tool-1", name: "write_file", input: { path: "apps/server/src/a.ts", content: "a" } },
                ]),
            )
            .mockResolvedValueOnce(makeEndTurnResponse("Written!"))

        const { result } = await runAgentTurn(makeOptions(), "Write a file", [])

        expect(mockGitAdd).toHaveBeenCalledWith("/fake/game", ["apps/server/src/a.ts"])
        expect(mockGitCommit).toHaveBeenCalledWith(
            "/fake/game",
            expect.stringContaining("[crucible-agent]"),
        )
        expect(result.commitSha).toBe("abc1234")
    })

    it("handles multi-turn tool loop before end_turn", async () => {
        const { runAgentTurn } = await getRunner()

        mockCheckFileRestriction.mockReturnValue({ allowed: true })
        mockReadFile.mockResolvedValueOnce("existing content")

        // Turn 1: Claude reads a file
        mockSendMessage.mockResolvedValueOnce(
            makeToolUseResponse([{ id: "tool-1", name: "read_file", input: { path: "apps/server/src/index.ts" } }]),
        )
        // Turn 2: Claude writes a file
        mockSendMessage.mockResolvedValueOnce(
            makeToolUseResponse([
                { id: "tool-2", name: "write_file", input: { path: "apps/server/src/index.ts", content: "updated" } },
            ]),
        )
        // Turn 3: end_turn
        mockSendMessage.mockResolvedValueOnce(makeEndTurnResponse("All done!"))

        const { result } = await runAgentTurn(makeOptions(), "Update the index", [])

        expect(mockSendMessage).toHaveBeenCalledTimes(3)
        expect(result.response).toBe("All done!")
        expect(result.filesModified).toEqual(["apps/server/src/index.ts"])
        expect(result.tokenUsage.inputTokens).toBe(260) // 80 + 80 + 100
    })

    it("preserves conversation history across turns", async () => {
        const { runAgentTurn } = await getRunner()

        const existingHistory: Anthropic.MessageParam[] = [
            { role: "user", content: "First message" },
            { role: "assistant", content: "First response" },
        ]

        mockSendMessage.mockResolvedValueOnce(makeEndTurnResponse("Second response"))

        const { updatedHistory } = await runAgentTurn(makeOptions(), "Second message", existingHistory)

        // Should have: existing 2 + new user + new assistant = 4
        expect(updatedHistory).toHaveLength(4)
        expect(updatedHistory[0]).toEqual({ role: "user", content: "First message" })
        expect(updatedHistory[1]).toEqual({ role: "assistant", content: "First response" })
        expect(updatedHistory[2]).toEqual({ role: "user", content: "Second message" })
        expect(updatedHistory[3]!.role).toBe("assistant")

        // Verify sendMessage was called — the messages array is mutated after the call
        // so we just verify the updated history contains all expected messages
        expect(mockSendMessage).toHaveBeenCalledTimes(1)
    })
})

describe("buildSystemPrompt", () => {
    it("includes game ID and file contents", async () => {
        const { buildSystemPrompt } = await import("../../agent/runner.js")

        const context = makeContext([
            { path: "src/index.ts", content: "const x = 1;", tokens: 10, priority: "required" },
        ])

        const prompt = buildSystemPrompt(context, "my-game")

        expect(prompt).toContain('"my-game"')
        expect(prompt).toContain("### src/index.ts")
        expect(prompt).toContain("const x = 1;")
        expect(prompt).toContain("read_file, write_file, run_command, list_files")
    })
})
