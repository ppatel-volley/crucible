# Project Configuration — Crucible

> Project-specific configuration for the AI Agent Guidelines.
> Referenced by [`AGENTS.md`](./AGENTS.md).

---

## What is Crucible

Crucible is a Unity/Unreal-style project manager for building, testing, and publishing Volley TV games using AI agents. Users describe what they want in natural language, agents build it from the hello-weekend template, and the finished game appears on Proto-Hub.

**Key documents:**
- [`docs/architecture.md`](./docs/architecture.md) — Full architecture plan
- [`docs/tdd-cli.md`](./docs/tdd-cli.md) — CLI Technical Design Document
- [`docs/tdd-infrastructure.md`](./docs/tdd-infrastructure.md) — Infrastructure Technical Design Document
- [`BUILDING_TV_GAMES.md`](./BUILDING_TV_GAMES.md) — VGF/WGF patterns and gotchas (reference, not always-loaded)

**Tech stack:** Node.js (TypeScript), Commander.js CLI, Claude API for agent, Vite + React for game clients, WGFServer for game servers, AWS (EKS, DynamoDB, S3, CloudFront, Lambda), KEDA for scale-to-zero.

---

## Project Commands

```bash
# Run all tests
pnpm test -- --run

# Run specific package tests (monorepo — per-game projects)
pnpm --filter @{gameId}/shared test
pnpm --filter @{gameId}/server test

# Type checking
pnpm typecheck

# Production build
pnpm build

# Development mode (game projects)
pnpm dev

# Crucible CLI commands
crucible create "Game Name"       # Fork hello-weekend, create GitHub repo
crucible agent <game-name>        # AI agent session
crucible dev <game-name>          # Local dev server (VGF + display + controller)
crucible publish <game-name>      # Push to Git, trigger CI, poll status
crucible promote <name> --to <env> # Promote to staging/prod
crucible rollback <game-name>     # Roll back to previous healthy version
crucible logs <game-name>         # Tail deployed game logs
crucible status [game-name]       # Show deploy status across environments
crucible login                    # Authenticate via Volley SSO
```

---

## Test Locations

| Path | Purpose |
|------|---------|
| `packages/shared/src/__tests__/` | Shared types and utilities |
| `apps/server/src/__tests__/` | Server logic, reducers, thunks |
| `apps/display/src/__tests__/` | Display (TV) components |
| `apps/controller/src/__tests__/` | Controller (phone) components |
| `apps/e2e/tests/` | Playwright E2E tests (display + controller + server) |

---

## Keyword Triggers & Task Categories

| Category | Keywords | Learnings |
|----------|----------|-----------|
| VGF/WGF | vgf, wgf, ruleset, reducer, thunk, phase, nextPhase | 014-020 |
| Three.js / WebGL | threejs, shader, webgl, r3f, fiber | 021-028 |
| Infrastructure | docker, k8s, deploy, ecr, helm, flux, keda, registry | See AGENTS-INFRA.md |
| Security | auth, oidc, iam, irsa, acl, sandbox, token | 029 |
| Testing | test, spec, expect, playwright, e2e | 001-006 |
| React | useRef, useMemo, provider, boundary, closure | 006-008 |

---

## Commit Guidelines

Use conventional commits. Keep the subject line under 72 chars, imperative mood. Body is optional — use it only when the "why" isn't obvious from the subject.

**STRICT: No AI attribution footers.** NEVER add `Co-Authored-By: Claude`, `Generated with Claude Code`, or any similar AI-generated attribution to commits, PR descriptions, or any other output.

---

## Git Workflow

**Feature branch:** Create `feature/name` branches. Merge via PR. Create a branch for Standard/Critical tasks; commit directly for Quick tasks.

---

## GitHub Gists

Always create **private/secret** gists by default. Never use `--public` unless the user explicitly asks for a public gist.

---

## Dependencies

- **Prefer existing dependencies** over adding new ones
- **Evaluate before adding**: Is it actively maintained? Any known vulnerabilities? What's the bundle size impact?
- **Always commit lockfile changes** — `pnpm-lock.yaml` must stay in sync
- **Never update dependencies unless asked**
- **Pin versions** for critical dependencies; use ranges only for non-critical dev tools

---

## Inter-Agent Communication

Crucible uses a file-based messaging protocol for cross-tool agent communication. See [`skills/comms/SKILL.md`](./skills/comms/SKILL.md) and [`.agent-comms/protocol.md`](./.agent-comms/protocol.md).

- Claude Code reads from `.agent-comms/inbox/`, writes to `.agent-comms/outbox/`
- External agents (Cursor, etc.) read from `.agent-comms/outbox/`, write to `.agent-comms/inbox/`

---

## Learnings System

Current count: **42 documented learnings**

See [`learnings/INDEX.md`](./learnings/INDEX.md) for the complete categorised list.
