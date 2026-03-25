import Anthropic from "@anthropic-ai/sdk"
import type { ClaudeClientOptions } from "../types.js"
import { authError, networkError } from "../util/errors.js"

export const DEFAULT_MODEL = "claude-sonnet-4-20250514"
export const DEFAULT_MAX_TOKENS = 16384

export const AGENT_TOOLS: Anthropic.Tool[] = [
    {
        name: "read_file",
        description: "Read a file in the game project. Returns the file contents.",
        input_schema: {
            type: "object" as const,
            properties: {
                path: { type: "string", description: "File path relative to game root" },
            },
            required: ["path"],
        },
    },
    {
        name: "write_file",
        description:
            "Write content to a file in the game project. Creates the file if it doesn't exist, overwrites if it does.",
        input_schema: {
            type: "object" as const,
            properties: {
                path: { type: "string", description: "File path relative to game root" },
                content: { type: "string", description: "Complete file contents to write" },
            },
            required: ["path", "content"],
        },
    },
    {
        name: "run_command",
        description: "Run a whitelisted pnpm command in the game project directory.",
        input_schema: {
            type: "object" as const,
            properties: {
                command: {
                    type: "string",
                    enum: ["pnpm build", "pnpm test -- --run", "pnpm typecheck"],
                    description: "Whitelisted pnpm command to run",
                },
            },
            required: ["command"],
        },
    },
    {
        name: "list_files",
        description: "List files in a directory within the game project.",
        input_schema: {
            type: "object" as const,
            properties: {
                path: {
                    type: "string",
                    description: "Directory path relative to game root (use '.' for root)",
                },
            },
            required: ["path"],
        },
    },
]

export function createClaudeClient(options: ClaudeClientOptions): Anthropic {
    return new Anthropic({
        apiKey: options.apiKey,
    })
}

export async function sendMessage(
    client: Anthropic,
    options: {
        model: string
        systemPrompt: string
        messages: Anthropic.MessageParam[]
        tools?: Anthropic.Tool[]
        maxTokens?: number
    },
): Promise<Anthropic.Message> {
    try {
        const response = await client.messages.create({
            model: options.model,
            max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
            system: options.systemPrompt,
            messages: options.messages,
            tools: options.tools,
        })
        return response
    } catch (err: unknown) {
        const status = err instanceof Error && "status" in err ? (err as { status: number }).status : undefined
        const cause = err instanceof Error ? err : new Error(String(err))

        if (status === 401 || status === 403) {
            throw authError("CRUCIBLE-103", "Claude API authentication failed", "Check your ANTHROPIC_API_KEY is valid and has not expired.", {
                cause,
            })
        }

        if (status === 429) {
            throw networkError("CRUCIBLE-402", "Claude API rate limit exceeded", "Wait a moment and try again, or check your API plan limits.", {
                cause,
                retryable: true,
            })
        }

        if (status !== undefined && status >= 500) {
            throw networkError(
                "CRUCIBLE-403",
                "Claude API server error",
                "The Anthropic API is experiencing issues. Try again shortly.",
                { cause, retryable: true },
            )
        }

        throw networkError("CRUCIBLE-404", "Claude API request failed", "Check your network connection and API key.", {
            cause,
            retryable: false,
        })
    }
}
