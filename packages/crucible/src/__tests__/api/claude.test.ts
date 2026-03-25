import { describe, it, expect, vi, beforeEach } from "vitest"
import { createClaudeClient, sendMessage, AGENT_TOOLS, DEFAULT_MODEL, DEFAULT_MAX_TOKENS } from "../../api/claude.js"
import { CrucibleError } from "../../util/errors.js"

// Mock the Anthropic SDK
vi.mock("@anthropic-ai/sdk", () => {
    const MockAnthropic = vi.fn().mockImplementation((opts: { apiKey: string }) => ({
        _apiKey: opts.apiKey,
        messages: {
            create: vi.fn(),
        },
    }))
    return { default: MockAnthropic }
})

function createMockClient() {
    const client = createClaudeClient({ apiKey: "sk-ant-test-key" })
    return client
}

describe("createClaudeClient", () => {
    it("creates a client with valid options", () => {
        const client = createClaudeClient({ apiKey: "sk-ant-test-key" })
        expect(client).toBeDefined()
        expect(client.messages).toBeDefined()
    })

    it("uses default model when not specified", () => {
        expect(DEFAULT_MODEL).toBe("claude-sonnet-4-20250514")
    })

    it("uses default maxTokens when not specified", () => {
        expect(DEFAULT_MAX_TOKENS).toBe(16384)
    })
})

describe("AGENT_TOOLS", () => {
    it("exports exactly 4 tools", () => {
        expect(AGENT_TOOLS).toHaveLength(4)
    })

    it("has correct tool names", () => {
        const names = AGENT_TOOLS.map((t) => t.name)
        expect(names).toEqual(["read_file", "write_file", "run_command", "list_files"])
    })

    it("all tools have required fields", () => {
        for (const tool of AGENT_TOOLS) {
            expect(tool.name).toBeTruthy()
            expect(tool.description).toBeTruthy()
            expect(tool.input_schema).toBeDefined()
            expect(tool.input_schema.type).toBe("object")
            expect(tool.input_schema.properties).toBeDefined()
            expect(tool.input_schema.required).toBeDefined()
            expect(Array.isArray(tool.input_schema.required)).toBe(true)
        }
    })

    it("run_command tool has enum for whitelisted commands", () => {
        const runCmd = AGENT_TOOLS.find((t) => t.name === "run_command")!
        const cmdProp = (runCmd.input_schema.properties as Record<string, { enum?: string[] }>).command
        expect(cmdProp.enum).toEqual(["pnpm build", "pnpm test -- --run", "pnpm typecheck"])
    })
})

describe("sendMessage", () => {
    let client: ReturnType<typeof createMockClient>

    beforeEach(() => {
        client = createMockClient()
        vi.mocked(client.messages.create).mockReset()
    })

    it("passes correct params to messages.create", async () => {
        const mockResponse = {
            id: "msg_test",
            type: "message",
            role: "assistant",
            content: [{ type: "text", text: "Hello" }],
            model: DEFAULT_MODEL,
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 5 },
        }
        vi.mocked(client.messages.create).mockResolvedValue(mockResponse as never)

        const result = await sendMessage(client, {
            model: DEFAULT_MODEL,
            systemPrompt: "You are a helpful assistant.",
            messages: [{ role: "user", content: "Hi" }],
            tools: AGENT_TOOLS,
            maxTokens: 8192,
        })

        expect(client.messages.create).toHaveBeenCalledWith({
            model: DEFAULT_MODEL,
            max_tokens: 8192,
            system: "You are a helpful assistant.",
            messages: [{ role: "user", content: "Hi" }],
            tools: AGENT_TOOLS,
        })
        expect(result).toEqual(mockResponse)
    })

    it("uses DEFAULT_MAX_TOKENS when maxTokens not provided", async () => {
        vi.mocked(client.messages.create).mockResolvedValue({} as never)

        await sendMessage(client, {
            model: DEFAULT_MODEL,
            systemPrompt: "test",
            messages: [{ role: "user", content: "Hi" }],
        })

        expect(client.messages.create).toHaveBeenCalledWith(
            expect.objectContaining({ max_tokens: DEFAULT_MAX_TOKENS }),
        )
    })

    it("throws authError on 401", async () => {
        const apiErr = Object.assign(new Error("Unauthorized"), { status: 401 })
        vi.mocked(client.messages.create).mockRejectedValue(apiErr)

        try {
            await sendMessage(client, {
                model: DEFAULT_MODEL,
                systemPrompt: "test",
                messages: [{ role: "user", content: "Hi" }],
            })
            expect.fail("Should have thrown")
        } catch (err) {
            expect(err).toBeInstanceOf(CrucibleError)
            const ce = err as CrucibleError
            expect(ce.code).toBe("CRUCIBLE-103")
            expect(ce.category).toBe("auth")
        }
    })

    it("throws authError on 403", async () => {
        const apiErr = Object.assign(new Error("Forbidden"), { status: 403 })
        vi.mocked(client.messages.create).mockRejectedValue(apiErr)

        try {
            await sendMessage(client, {
                model: DEFAULT_MODEL,
                systemPrompt: "test",
                messages: [{ role: "user", content: "Hi" }],
            })
            expect.fail("Should have thrown")
        } catch (err) {
            expect(err).toBeInstanceOf(CrucibleError)
            const ce = err as CrucibleError
            expect(ce.code).toBe("CRUCIBLE-103")
            expect(ce.category).toBe("auth")
        }
    })

    it("throws networkError with retryable on 429", async () => {
        const apiErr = Object.assign(new Error("Rate limited"), { status: 429 })
        vi.mocked(client.messages.create).mockRejectedValue(apiErr)

        try {
            await sendMessage(client, {
                model: DEFAULT_MODEL,
                systemPrompt: "test",
                messages: [{ role: "user", content: "Hi" }],
            })
            expect.fail("Should have thrown")
        } catch (err) {
            expect(err).toBeInstanceOf(CrucibleError)
            const ce = err as CrucibleError
            expect(ce.code).toBe("CRUCIBLE-402")
            expect(ce.category).toBe("network")
            expect(ce.retryable).toBe(true)
        }
    })

    it("throws networkError with retryable on 500", async () => {
        const apiErr = Object.assign(new Error("Internal Server Error"), { status: 500 })
        vi.mocked(client.messages.create).mockRejectedValue(apiErr)

        try {
            await sendMessage(client, {
                model: DEFAULT_MODEL,
                systemPrompt: "test",
                messages: [{ role: "user", content: "Hi" }],
            })
            expect.fail("Should have thrown")
        } catch (err) {
            expect(err).toBeInstanceOf(CrucibleError)
            const ce = err as CrucibleError
            expect(ce.code).toBe("CRUCIBLE-403")
            expect(ce.category).toBe("network")
            expect(ce.retryable).toBe(true)
        }
    })

    it("throws networkError on unknown errors", async () => {
        vi.mocked(client.messages.create).mockRejectedValue(new Error("Connection failed"))

        try {
            await sendMessage(client, {
                model: DEFAULT_MODEL,
                systemPrompt: "test",
                messages: [{ role: "user", content: "Hi" }],
            })
            expect.fail("Should have thrown")
        } catch (err) {
            expect(err).toBeInstanceOf(CrucibleError)
            const ce = err as CrucibleError
            expect(ce.code).toBe("CRUCIBLE-404")
            expect(ce.category).toBe("network")
        }
    })
})
