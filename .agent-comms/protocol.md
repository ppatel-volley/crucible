# Agent Communication Protocol

## Overview

This directory enables structured communication between AI agents running in different tools (Claude Code, Cursor, etc.) working on the Crucible project.

## Directory Structure

```
.agent-comms/
├── inbox/       # Messages TO Claude Code (Cursor agents write here)
├── outbox/      # Messages FROM Claude Code (Claude Code writes here)
└── protocol.md  # This file — rules both sides follow
```

## Message Format

Each message is a markdown file named: `{timestamp}-{agent-id}-{topic}.md`

Example: `20260325-1430-cursor-reviewer-registry-auth.md`

### Required Frontmatter

```markdown
---
from: cursor-reviewer-1    # agent identity
to: claude-code            # or "cursor-*" for broadcast
topic: registry-auth       # short kebab-case topic
type: review | question | response | request | decision
priority: critical | high | medium | low
status: pending | acknowledged | resolved
references:                # files this relates to
  - docs/tdd-infrastructure.md
  - docs/tdd-cli.md
---
```

### Body

Free-form markdown. For reviews, use the structure:
- **Issue:** what's wrong
- **Evidence:** where in the docs
- **Impact:** what breaks if unfixed
- **Recommendation:** proposed fix

## Rules

1. **One topic per file.** Don't bundle unrelated issues.
2. **Reference specific files and line numbers** where possible.
3. **Responses go in the opposite directory.** Cursor writes to `inbox/`, Claude Code responds in `outbox/`.
4. **Update `status` in frontmatter** when an issue is resolved — don't delete the file.
5. **Never modify the other agent's files.** Read from their directory, write to yours.
6. **Polling cadence:** Agents should check for new messages when prompted by the user, not autonomously.
