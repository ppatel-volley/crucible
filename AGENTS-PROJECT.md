# Project Configuration — Crucible

> Project-specific configuration for the AI Agent Guidelines.
> Referenced by [`AGENTS.md`](./AGENTS.md).

---

## What is Crucible

Crucible is a Unity/Unreal-style project manager for building, testing, and publishing Volley TV games using AI agents. Users describe what they want in natural language, agents build it from the hello-weekend template, and the finished game appears on Proto-Hub.

**Key documents:**
- [`docs/PROGRESS.md`](./docs/PROGRESS.md) — **Read first.** Tracks completed milestones and work items so you don't re-scan the codebase.
- [`docs/development-plan.md`](./docs/development-plan.md) — Full milestone definitions, work items, and dependencies
- [`docs/architecture.md`](./docs/architecture.md) — Full architecture plan
- [`docs/tdd-cli.md`](./docs/tdd-cli.md) — CLI Technical Design Document
- [`docs/tdd-infrastructure.md`](./docs/tdd-infrastructure.md) — Infrastructure Technical Design Document
- [`BUILDING_TV_GAMES.md`](./BUILDING_TV_GAMES.md) — VGF/WGF patterns and gotchas (reference, not always-loaded)

**Tech stack:** Node.js (TypeScript), Commander.js CLI, Claude API for agent, Vite + React for game clients, WGFServer for game servers, AWS (EKS, DynamoDB, S3, CloudFront, Lambda), KEDA for scale-to-zero.

---

## Working in volley-infra (Terraform)

When creating or modifying Terraform files in the `volley-infra` repo (`C:\volley\dev\volley-infra`):

### Formatting (MANDATORY)
- **LF line endings only** — run `sed -i 's/\r$//'` on every `.tf` file before committing. CRLF causes `terraform fmt` CI failures.
- **No Unicode characters** — no em dashes (`—`), use `--` instead. No smart quotes. ASCII only in `.tf` files.
- The CI runs `terraform fmt -check -recursive` — your file must pass.

### IAM Security (MANDATORY)
- **NEVER create IAM roles/policies via the AWS console** — always use Terraform (IaC). Console-based IAM write access enables privilege escalation.
- **NEVER grant IAM write permissions** (CreateRole, CreatePolicy, AttachRolePolicy, PutRolePolicy) in SSO permission sets — if you can create a policy with arbitrary content and attach it to a role, you have admin access.
- **iam:PassRole is safe** when scoped to specific roles + service conditions (e.g. `iam:PassedToService = lambda.amazonaws.com`).
- **Use explicit account IDs** (`375633680607`) not wildcards in IAM ARNs.

### Tag-Based Scoping (MANDATORY for CloudFront, API Gateway)
These services don't support resource-level ARN restrictions. Use tag conditions instead:
- **Create statements:** Use `aws:RequestTag/Project = "crucible"` (the tag being applied to the new resource)
- **Mutate/delete statements:** Use `aws:ResourceTag/Project = "crucible"` (checking existing tags on the resource)
- **TagResource action:** Put in BOTH create (with RequestTag) AND mutate (with ResourceTag). If only in create with RequestTag, it can be used standalone to tag non-crucible resources and bypass the ResourceTag gate on mutate.
- **OAC operations (CloudFront):** Don't support tags at all. Use a separate create-only statement. No update/delete unless strictly needed.

### Review Bots
The volley-infra repo has aggressive review bots (Greptile, Cursor Bugbot, Macroscope). They will:
- Flag any `resources = ["*"]` with destructive actions
- Detect IAM privilege escalation chains
- Check tag condition scoping on every statement
- Verify formatting

Expect 3-5 rounds of bot feedback. Address all High/P0/P1 findings before requesting human review.

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

**Crucible repo:** Direct pushes to `main` are fine for Quick tasks. Use feature branches + PRs for Standard/Critical tasks.

**External repos (always branch + PR):**
- `bifrost` — Has its own author who reviews all changes. Always branch + PR.
- `volley-infra` — Shared infra repo with Atlantis and bot reviewers. Always branch + PR.
- `volley-infra-tenants` — Shared tenant configs. Always branch + PR.
- `kubernetes` — Shared K8s configs. Always branch + PR.

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
