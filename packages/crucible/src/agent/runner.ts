import Anthropic from "@anthropic-ai/sdk"
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises"
import { join, dirname } from "node:path"
import { execa } from "execa"
import { createClaudeClient, sendMessage, AGENT_TOOLS, DEFAULT_MODEL } from "../api/claude.js"
import { checkFileRestriction, logViolation } from "./restrictions.js"
import { createGitOperations } from "../git/operations.js"
import type { AgentRunnerOptions, AgentTurnResult, AssembledContext } from "../types.js"

const ALLOWED_COMMANDS = ["pnpm build", "pnpm test -- --run", "pnpm typecheck"]

/**
 * Build the system prompt from assembled context and game ID.
 */
export function buildSystemPrompt(context: AssembledContext, gameId: string): string {
    let prompt = `You are a game development AI agent working on "${gameId}", a Volley TV game.\n\n`
    prompt += `You have access to the following tools: read_file, write_file, run_command, list_files.\n`
    prompt += `You can only modify files in apps/*/src/ and packages/*/src/ directories.\n`
    prompt += `Infrastructure files (Dockerfile, CI workflows, lockfiles) are read-only.\n\n`
    prompt += `## Project Files\n\n`
    for (const file of context.files) {
        prompt += `### ${file.path}\n\`\`\`\n${file.content}\n\`\`\`\n\n`
    }
    return prompt
}

/**
 * Extract the text response from a Claude Message's content blocks.
 */
function extractTextResponse(content: Anthropic.ContentBlock[]): string {
    return content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n")
}

/**
 * Dispatch a single tool call and return the tool result.
 */
async function dispatchToolCall(
    toolName: string,
    toolInput: Record<string, string>,
    options: AgentRunnerOptions,
    modifiedFiles: Set<string>,
): Promise<{ content: string; is_error: boolean }> {
    switch (toolName) {
        case "read_file": {
            try {
                const fullPath = join(options.gamePath, toolInput.path!)
                const content = await readFile(fullPath, "utf-8")
                return { content, is_error: false }
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err)
                return { content: `Error reading file: ${message}`, is_error: true }
            }
        }

        case "write_file": {
            const restriction = checkFileRestriction(toolInput.path!, options.gamePath)
            if (!restriction.allowed) {
                await logViolation({
                    path: toolInput.path!,
                    reason: restriction.deniedPattern ? "denied-pattern" : "not-allowed",
                    deniedPattern: restriction.deniedPattern,
                    timestamp: new Date().toISOString(),
                    sessionId: options.sessionId,
                })
                return {
                    content: `This file is owned by Crucible and cannot be modified: ${restriction.reason}`,
                    is_error: true,
                }
            }
            try {
                const fullPath = join(options.gamePath, toolInput.path!)
                await mkdir(dirname(fullPath), { recursive: true })
                await writeFile(fullPath, toolInput.content!, "utf-8")
                modifiedFiles.add(toolInput.path!)
                return { content: `Successfully wrote ${toolInput.path}`, is_error: false }
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err)
                return { content: `Error writing file: ${message}`, is_error: true }
            }
        }

        case "run_command": {
            if (!ALLOWED_COMMANDS.includes(toolInput.command!)) {
                return {
                    content: `Command not allowed: ${toolInput.command}. Allowed commands: ${ALLOWED_COMMANDS.join(", ")}`,
                    is_error: true,
                }
            }
            try {
                const parts = toolInput.command!.split(" ")
                const result = await execa(parts[0]!, parts.slice(1), {
                    cwd: options.gamePath,
                })
                const output = [result.stdout, result.stderr].filter(Boolean).join("\n")
                return { content: output || "(no output)", is_error: false }
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err)
                return { content: `Command failed: ${message}`, is_error: true }
            }
        }

        case "list_files": {
            try {
                const fullPath = join(options.gamePath, toolInput.path!)
                const entries = await readdir(fullPath, { recursive: true })
                return { content: entries.join("\n"), is_error: false }
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err)
                return { content: `Error listing files: ${message}`, is_error: true }
            }
        }

        default:
            return { content: `Unknown tool: ${toolName}`, is_error: true }
    }
}

/**
 * Run a single agent turn: send a user message to Claude, dispatch any tool calls
 * in a loop, and auto-commit modified files when done.
 */
export async function runAgentTurn(
    options: AgentRunnerOptions,
    userMessage: string,
    conversationHistory: Anthropic.MessageParam[],
): Promise<{ result: AgentTurnResult; updatedHistory: Anthropic.MessageParam[] }> {
    const client = createClaudeClient({ apiKey: options.apiKey, model: options.model })
    const systemPrompt = buildSystemPrompt(options.context, options.gameId)
    const model = options.model ?? DEFAULT_MODEL

    // Copy history and append the user message
    const messages: Anthropic.MessageParam[] = [...conversationHistory, { role: "user", content: userMessage }]

    const modifiedFiles = new Set<string>()
    let totalInputTokens = 0
    let totalOutputTokens = 0
    let stopReason = ""

    // Conversation loop — keep going until Claude returns end_turn
    // eslint-disable-next-line no-constant-condition
    while (true) {
        const response = await sendMessage(client, {
            model,
            systemPrompt,
            messages,
            tools: AGENT_TOOLS,
        })

        totalInputTokens += response.usage.input_tokens
        totalOutputTokens += response.usage.output_tokens
        stopReason = response.stop_reason ?? "end_turn"

        if (stopReason === "end_turn") {
            // Final response — extract text and break
            const responseText = extractTextResponse(response.content)

            // Append assistant message to history
            messages.push({ role: "assistant", content: response.content })

            // Auto-commit if files were modified
            let commitSha: string | undefined
            if (modifiedFiles.size > 0) {
                try {
                    const git = createGitOperations()
                    await git.add(options.gamePath, [...modifiedFiles])
                    commitSha = await git.commit(
                        options.gamePath,
                        `[crucible-agent] Modified ${modifiedFiles.size} file(s)`,
                    )
                } catch {
                    // Commit failure is non-fatal — we still return the result
                }
            }

            return {
                result: {
                    response: responseText,
                    filesModified: [...modifiedFiles],
                    commitSha,
                    tokenUsage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
                    stopReason,
                },
                updatedHistory: messages,
            }
        }

        if (stopReason === "tool_use") {
            // Append the assistant message (contains tool_use blocks)
            messages.push({ role: "assistant", content: response.content })

            // Dispatch each tool call
            const toolResults: Anthropic.ToolResultBlockParam[] = []
            for (const block of response.content) {
                if (block.type === "tool_use") {
                    const { content, is_error } = await dispatchToolCall(
                        block.name,
                        block.input as Record<string, string>,
                        options,
                        modifiedFiles,
                    )
                    toolResults.push({
                        type: "tool_result",
                        tool_use_id: block.id,
                        content,
                        is_error,
                    })
                }
            }

            // Send tool results back
            messages.push({ role: "user", content: toolResults })

            // Loop continues — Claude will process tool results
        } else {
            // Unexpected stop reason — treat as end_turn
            const responseText = extractTextResponse(response.content)
            messages.push({ role: "assistant", content: response.content })

            return {
                result: {
                    response: responseText,
                    filesModified: [...modifiedFiles],
                    tokenUsage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
                    stopReason,
                },
                updatedHistory: messages,
            }
        }
    }
}
