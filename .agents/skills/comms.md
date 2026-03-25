# /comms

Inter-agent messaging via shared filesystem. Enables structured communication between AI agents running in different tools (Claude Code, Cursor, Windsurf, Gemini, Codex, etc.).

## Your Role (External Agent)

You are an external agent. You:
- **READ** from `.agent-comms/outbox/` (messages FROM Claude Code)
- **WRITE** to `.agent-comms/inbox/` (messages TO Claude Code)
- **Your agent ID:** You MUST use a **unique** ID. Do NOT use bare `cursor-agent` — multiple Cursor instances will collide. Instead:
  1. Check existing files in `.agent-comms/inbox/` to see which IDs are already in use.
  2. Pick a unique ID like `cursor-agent-1`, `cursor-agent-2`, or use a descriptive suffix like `cursor-reviewer`, `cursor-builder`.
  3. If the user specifies an ID, use that instead.
  4. **Include seconds in timestamps** (`YYYYMMDD-HHMMss`) to avoid filename collisions.

Read `.agent-comms/protocol.md` for the full protocol spec.

## Auto-Check Behaviour

**You MUST automatically check `.agent-comms/outbox/` for pending messages in these situations — no user prompt needed:**

1. **After completing any task** (code fix, review, commit, test run, etc.) — before reporting "done", scan outbox for pending messages and act on them.
2. **At conversation start** — if `.agent-comms/outbox/` exists, scan for `status: pending` messages and handle them.
3. **After writing an inbox message that expects a reply** — tell the user: "Sent message to Claude Code. They need to run `/comms` or check `.agent-comms/inbox/` to see it."

This prevents the deadlock where both agents sit idle waiting for manual `/comms` invocation.

## Usage

```
/comms                        # Check outbox for pending messages and respond
/comms send <topic> <message> # Send a new message to Claude Code (or another agent)
/comms status                 # Show all open threads
```

## Instructions

### Check for messages (`/comms` with no args)

1. Read ALL files in `.agent-comms/outbox/`.
2. Filter for files with `status: pending` in the frontmatter.
3. For each pending message:
   a. Read and understand it fully.
   b. If it's a review/question/request — take action (fix code, answer the question, make the decision).
   c. Write a response file in `.agent-comms/inbox/` using the naming and frontmatter format below.
   d. In your response, set `references-message:` to the original filename so threads are traceable.
4. Report to the user what you found and what you did.

### Send a message (`/comms send <topic> <message>`)

1. Generate a filename: `{YYYYMMDD}-{HHMMss}-{your-agent-id}-{topic}.md` (include seconds to avoid collisions)
2. Write the file to `.agent-comms/inbox/` with this format:

```markdown
---
from: {your-agent-id}
to: claude-code
topic: {topic in kebab-case}
type: {review | question | response | request | decision}
priority: {critical | high | medium | low}
status: pending
references:
  - {path/to/relevant/files}
references-message: {filename of message being responded to, if applicable}
---

{Your message body in markdown}
```

### Show status (`/comms status`)

1. Read ALL files in BOTH directories (`.agent-comms/inbox/` and `.agent-comms/outbox/`).
2. Display a summary table:

```
Thread                          | From            | Status    | Priority
--------------------------------|-----------------|-----------|----------
registry-auth                   | cursor-reviewer | resolved  | critical
keda-scaling-concern            | codex-agent     | pending   | high
template-drift-question         | claude-code     | pending   | medium
```

## Message Format

### Required Frontmatter

```yaml
---
from: {your-agent-id}        # e.g. gemini-agent, codex-agent
to: claude-code               # or another agent ID, or "*" for broadcast
topic: {short-kebab-case}     # one topic per file
type: review | question | response | request | decision
priority: critical | high | medium | low
status: pending | acknowledged | resolved
references:
  - {path/to/relevant/files}
references-message: {filename of message being responded to, if any}
---
```

### Body

Free-form markdown. For reviews, use:
- **Issue:** what's wrong
- **Evidence:** where in the docs/code
- **Impact:** what breaks if unfixed
- **Recommendation:** proposed fix

## Directory Structure

```
.agent-comms/
├── inbox/       # Messages TO Claude Code (you write here)
├── outbox/      # Messages FROM Claude Code (you read here)
└── protocol.md  # Full protocol specification
```

## Rules

- **One topic per file.** Don't bundle unrelated issues.
- **Never modify files in `.agent-comms/outbox/`.** That's Claude Code's directory — read-only for you.
- **Reference specific files and line numbers** when discussing code or docs.
- **Thread replies:** Use `references-message:` in frontmatter to link to the message you're responding to.
- **Mark resolved:** When an issue is addressed, set `status: resolved` in your response. The original message stays as-is.
