# /comms

Inter-agent messaging via shared filesystem. Enables structured communication between AI agents running in different tools (Claude Code, Cursor, Windsurf, etc.).

## Usage

```
/comms                        # Check inbox and respond to pending messages
/comms send <topic> <message> # Send a new message
/comms status                 # Show all open threads
```

## Instructions

When the user invokes this skill:

### 1. Determine your role

Read `.agent-comms/protocol.md` for the full spec. Then determine which side you're on:

- **If you're in Claude Code:** You READ from `.agent-comms/inbox/` and WRITE to `.agent-comms/outbox/`.
- **If you're in Cursor, Windsurf, or another tool:** You READ from `.agent-comms/outbox/` and WRITE to `.agent-comms/inbox/`.

### 2. Check for messages (`/comms` with no args)

1. Read ALL files in your **read directory** (inbox or outbox, depending on your role).
2. Filter for files with `status: pending` in the frontmatter.
3. For each pending message:
   a. Read and understand it fully.
   b. If it's a review/question/request — take action (fix code, answer the question, make the decision).
   c. Write a response file in your **write directory** using the naming and frontmatter format below.
   d. In your response, set `references-message:` to the original filename so threads are traceable.
4. Report to the user what you found and what you did.

### 3. Send a message (`/comms send <topic> <message>`)

1. Generate a filename: `{YYYYMMDD}-{HHMM}-{your-agent-id}-{topic}.md`
   - Your agent ID: `claude-code` if in Claude Code, `cursor-agent` if in Cursor, or whatever the user specifies.
2. Write the file to your **write directory** with this format:

```markdown
---
from: {your-agent-id}
to: {target-agent-id or "*" for broadcast}
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

### 4. Show status (`/comms status`)

1. Read ALL files in BOTH directories (inbox and outbox).
2. Display a summary table:

```
Thread                          | From            | Status    | Priority
--------------------------------|-----------------|-----------|----------
registry-auth                   | cursor-reviewer | resolved  | critical
keda-scaling-concern            | cursor-reviewer | pending   | high
template-drift-question         | claude-code     | pending   | medium
```

## Directory Structure

```
.agent-comms/
├── inbox/       # Messages TO Claude Code (external agents write here)
├── outbox/      # Messages FROM Claude Code (Claude Code writes here)
└── protocol.md  # Full protocol specification
```

## Rules

- **One topic per file.** Don't bundle unrelated issues.
- **Never modify files in the other agent's directory.** Read-only.
- **Reference specific files and line numbers** when discussing code or docs.
- **Thread replies:** Use `references-message:` in frontmatter to link to the message you're responding to.
- **Mark resolved:** When an issue is addressed, the responder sets `status: resolved` in their response. The original message stays as-is (don't edit the other agent's files).

## For Cursor / External Agents

If you're a Cursor agent being asked to use this protocol, here's your quick start:

1. **Read** `.agent-comms/protocol.md` for full rules.
2. **Read** `.agent-comms/outbox/` for messages from Claude Code.
3. **Write** your messages to `.agent-comms/inbox/` using the frontmatter format above.
4. **Your agent ID:** Use `cursor-agent` or ask the user what to use.
5. **Context:** The primary documents are `docs/tdd-cli.md` and `docs/tdd-infrastructure.md`. The architecture source is `docs/architecture.md`.
