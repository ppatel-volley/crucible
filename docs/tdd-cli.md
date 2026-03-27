# Crucible CLI — Technical Design Document

> **Status:** Draft v1.0
> **Date:** 2026-03-25
> **Authors:** Staff Engineering, UX Specialist, Review Engineer
> **Confidence:** 0.97
> **Audience:** Engineers and AI agents implementing the Crucible CLI

---

## Table of Contents

1. [CLI Architecture Overview](#1-cli-architecture-overview)
2. [Template Engine (`crucible create`)](#2-template-engine-crucible-create)
3. [AI Agent Integration (`crucible agent`)](#3-ai-agent-integration-crucible-agent)
4. [Local Development Server (`crucible dev`)](#4-local-development-server-crucible-dev)
5. [Build & Deploy Trigger (`crucible publish`)](#5-build--deploy-trigger-crucible-publish)
6. [Rollback & Promote (`crucible rollback` / `crucible promote`)](#6-rollback--promote)
7. [Authentication (`crucible login`)](#7-authentication-crucible-login)
8. [Logs & Status (`crucible logs` / `crucible status`)](#8-logs--status)
9. [CLI User Experience Design](#9-cli-user-experience-design)
10. [E2E Testing Strategy](#10-e2e-testing-strategy)
11. [Data Flow Diagrams](#11-data-flow-diagrams)
12. [API Contract Specifications](#12-api-contract-specifications)
13. [Glossary](#13-glossary)

---

## 1. CLI Architecture Overview

### 1.1 Module Structure and Package Layout

Crucible is a single npm package published as `@volley/crucible` with the following internal module structure:

```
crucible/
├── src/
│   ├── index.ts                    # Entry point — commander setup, command registration
│   ├── commands/
│   │   ├── create.ts               # crucible create
│   │   ├── agent.ts                # crucible agent
│   │   ├── dev.ts                  # crucible dev
│   │   ├── publish.ts              # crucible publish
│   │   ├── rollback.ts             # crucible rollback
│   │   ├── promote.ts              # crucible promote
│   │   ├── login.ts                # crucible login
│   │   ├── logs.ts                 # crucible logs
│   │   ├── status.ts               # crucible status
│   │   ├── list.ts                 # crucible list
│   │   └── update.ts               # crucible update (template drift)
│   ├── template/
│   │   ├── engine.ts               # Template fork + parameterisation logic
│   │   ├── tokens.ts               # Token map: hello-weekend → target game
│   │   ├── dockerfile.ts           # Dockerfile generation + checksum
│   │   ├── ci-workflow.ts          # GitHub Actions workflow generation
│   │   └── crucible-json.ts        # crucible.json generation
│   ├── agent/
│   │   ├── context.ts              # Context assembly for Claude
│   │   ├── restrictions.ts         # File restriction enforcement
│   │   ├── session.ts              # Conversation persistence
│   │   └── runner.ts               # Claude API integration
│   ├── dev/
│   │   ├── orchestrator.ts         # Process orchestration (server + display + controller)
│   │   ├── ports.ts                # Port allocation and conflict detection
│   │   └── output.ts              # Log multiplexing and formatting
│   ├── api/
│   │   ├── github.ts               # GitHub API client (repo creation, CI triggers)
│   │   ├── registry.ts             # Crucible Registry API client
│   │   └── claude.ts               # Claude API client wrapper
│   ├── auth/
│   │   ├── oidc.ts                 # OIDC flow implementation
│   │   ├── keychain.ts             # OS keychain token storage
│   │   └── token.ts                # Token refresh, expiry, validation
│   ├── config/
│   │   ├── paths.ts                # XDG-compliant config path resolution
│   │   ├── config.ts               # Config read/write
│   │   └── schema.ts               # Config shape validation
│   ├── git/
│   │   ├── operations.ts           # Git commit, push, status
│   │   └── validation.ts           # Pre-push checks
│   └── util/
│       ├── logger.ts               # CLI output formatting (spinners, colours, tables)
│       ├── errors.ts               # Error types and user-facing messages
│       └── process.ts              # Child process management, signal handling
├── templates/
│   ├── Dockerfile.hbs              # Handlebars Dockerfile template
│   ├── crucible-deploy.yml.hbs     # CI workflow template
│   └── crucible.json.hbs           # Metadata template
├── context/
│   └── BUILDING_TV_GAMES.md        # Bundled VGF docs for agent context
├── package.json
└── tsconfig.json
```

### 1.2 Command Framework: Commander.js

**Choice: `commander`** over oclif and yargs.

| Criterion | commander | oclif | yargs |
|-----------|-----------|-------|-------|
| Bundle size | ~50KB | ~2MB+ (with plugins) | ~200KB |
| Setup complexity | Minimal | Requires project scaffold | Moderate |
| TypeScript support | First-class (v12+) | First-class | Adequate but verbose |
| Plugin system | None (not needed for v1) | Full plugin architecture | Middleware only |

Commander gives the fastest path to a working CLI with minimal weight. If a plugin architecture becomes necessary (Phase 6 — desktop app), it can be introduced without rewriting commands.

### 1.3 Config Management

Config path resolution follows XDG Base Directory on Linux/macOS. On Windows, config uses `%APPDATA%` (roaming-friendly); session and cache data use `%LOCALAPPDATA%` (see `CruciblePaths` below).

```typescript
interface CruciblePaths {
    configDir: string          // ~/.config/crucible or %APPDATA%/crucible (roaming — small config)
    configFile: string         // configDir/config.json
    dataDir: string            // ~/.local/share/crucible or %LOCALAPPDATA%/crucible (local — large session data)
    gamesDir: string           // ~/crucible-games
    sessionsDir: string        // dataDir/sessions/
}
```

**Config shape:**

```typescript
interface CrucibleConfig {
    userEmail: string | null
    defaultEnvironment: "dev" | "staging" | "prod"
    githubOrg: string                         // CANONICAL: "Volley-Inc" (case-sensitive for OIDC sub claims)
    registryApiUrls: Record<string, string>   // env → URL
    agentModel: string                        // "claude-sonnet-4-20250514"
    gamesDir: string | null                   // override default ~/crucible-games
    templateSource: {
        type: "github"
        repo: string                          // "Volley-Inc/hello-weekend"
        ref: string                           // "main" or "v1.2.0"
    } | {
        type: "local"
        path: string
    }
}
```

### 1.4 Dependency List

| Package | Purpose | Justification |
|---------|---------|---------------|
| `commander` | Command framework | Lightweight, TypeScript-native |
| `@anthropic-ai/sdk` | Claude API client | Agent conversations |
| `@octokit/rest` | GitHub API | Repo creation, CI status |
| `handlebars` | Template rendering | Token replacement in generated files |
| `keytar` | OS keychain access | Secure token storage |
| `ora` | Terminal spinners | Progress indication |
| `chalk` | Terminal colours | Formatted output |
| `inquirer` | Interactive prompts | Confirmations, input |
| `simple-git` | Git operations | Programmatic git |
| `execa` | Child process management | Dev server orchestration |
| `tree-kill` | Process tree cleanup | Kill dev server process trees |
| `zod` | Schema validation | Config + crucible.json validation |
| `open` | Open URLs in browser | OIDC callback, dev server URLs |

---

## 2. Template Engine (`crucible create`)

### 2.1 Token Map

The template engine uses a declarative token map. Every occurrence of the source token in filenames, directory names, file contents, and package.json fields is replaced with the target value.

```typescript
interface TokenMap {
    packageScope: { from: "@hello-weekend"; to: string }
    gameNameKebab: { from: "hello-weekend"; to: string }
    gameNamePascal: { from: "HelloWeekend"; to: string }
    gameId: { from: "hello-weekend"; to: string }
    displayName: { from: "Hello Weekend"; to: string }
    loggerName: { from: "hello-weekend-dev"; to: string }
    repoName: string  // "crucible-game-{kebab}"
}
```

### 2.2 File-by-File Transformation

| File / Pattern | Transformation |
|----------------|---------------|
| `package.json` (root) | Replace `"name": "hello-weekend"` with `"name": "<kebab>"` |
| `apps/*/package.json` | Replace scope `@hello-weekend` → `@<kebab>` |
| `packages/shared/package.json` | Replace scope |
| `apps/server/src/*.ts` | Replace imports, type names (`HelloWeekendState` → `<Pascal>State`), string literals |
| `apps/display/src/**/*.{ts,tsx}` | Replace imports and type names |
| `apps/controller/src/**/*.{ts,tsx}` | Same as display |
| `packages/shared/src/*.ts` | Replace type names and exports |

**Files to REMOVE** (template-only artefacts): `learnings/`, `skills/`, `README.md`, `.claude/`

**Files to ADD** (not in hello-weekend): `Dockerfile`, `.github/workflows/crucible-deploy.yml`, `crucible.json`, `.npmrc`

### 2.3 Dockerfile Generation

Rendered from a Handlebars template with the game's package scope injected:

```handlebars
FROM node:22-slim AS base
RUN corepack enable

FROM base AS dependencies
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=secret,id=npm_token pnpm install --frozen-lockfile

FROM dependencies AS build
COPY . .
RUN pnpm build
RUN pnpm deploy --filter=@{{gameId}}/server --prod /prod/server

FROM base AS production
COPY --from=build /prod/server /app
WORKDIR /app
EXPOSE 8080
CMD ["node", "dist/index.js"]
```

The Dockerfile content is SHA-256 checksummed and stored in `crucible.json`. CI validates this checksum before building.

### 2.4 crucible.json Generation

```typescript
interface CrucibleJson {
    name: string
    displayName: string
    description: string
    author: string
    version: string
    gameId: string
    tile: { imageUrl: string; heroImageUrl: string }
    createdAt: string
    template: "hello-weekend"
    templateVersion: string
    checksums: { dockerfile: string; ciWorkflow: string }
}
```

**Validation (Zod):**

```typescript
const CrucibleJsonSchema = z.object({
    name: z.string().regex(/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/),
    displayName: z.string().min(1).max(100),
    description: z.string().max(500).default(""),
    author: z.string().email(),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    gameId: z.string().regex(/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/),
    tile: z.object({ imageUrl: z.string(), heroImageUrl: z.string() }),
    createdAt: z.string().datetime(),
    template: z.literal("hello-weekend"),
    templateVersion: z.string(),
    checksums: z.object({
        dockerfile: z.string().regex(/^[a-f0-9]{64}$/),
        ciWorkflow: z.string().regex(/^[a-f0-9]{64}$/),
    }),
})
```

### 2.5 GitHub Repo Creation

**Decision: Crucible auto-creates the GitHub repo. The user is NOT prompted to provide one.**

Rationale:

1. **Security.** The `crucible-ci` IAM trust policy restricts OIDC federation to `repo:Volley-Inc/crucible-game-*:ref:refs/heads/main`. A user-provided repo with an arbitrary name would fail to assume the CI role — deploys wouldn't work. Broadening the trust policy is a security risk; maintaining a name allowlist is operational burden.

2. **Integrity.** `crucible create` applies Repository Rulesets immediately after repo creation to protect immutable files (Dockerfile, CI workflow, lockfile, .npmrc). A user-provided repo may have conflicting branch protections, or already-modified files that break template checksum validation.

3. **Target audience.** The architecture doc explicitly targets non-engineers (designers, producers, the CFO). Asking them for a GitHub repo is a barrier. The whole point of Crucible is "describe what you want, we handle the rest."

4. **Naming convention.** The `crucible-game-*` prefix is load-bearing — it's used by IAM policies, CI trust conditions, and operational tooling (listing all Crucible repos, cleanup scripts). Arbitrary repo names break this.

**v1: No `--repo` flag.** Auto-create only. If power users request the ability to bring an existing repo, add an optional `--repo` flag in a future version that validates: (a) repo is under `Volley-Inc/crucible-game-*`, (b) repo is empty or matches expected template structure, (c) no conflicting rulesets. Reject with a clear error if any check fails.

```typescript
async function createGameRepo(octokit: Octokit, options: CreateRepoOptions) {
    const { data } = await octokit.repos.create({
        org: options.org,
        name: `crucible-game-${options.gameId}`,
        description: options.displayName,
        private: true,
        auto_init: false,
    })

    // Apply Repository Rulesets to protect immutable files
    await octokit.request("POST /repos/{owner}/{repo}/rulesets", {
        owner: options.org,
        repo: data.name,
        name: "crucible-protected-files",
        enforcement: "active",
        target: "branch",
        conditions: { ref_name: { include: ["refs/heads/main"], exclude: [] } },
        rules: [{
            type: "file_path_restriction",
            parameters: {
                restricted_file_paths: ["Dockerfile", ".github/workflows/**", ".npmrc", "pnpm-lock.yaml", "pnpm-workspace.yaml"],
            },
        }],
    })

    return { cloneUrl: data.clone_url, htmlUrl: data.html_url }
}
```

### 2.6 Rollback on Partial Failure

Create uses a step-tracking approach with compensating actions:

| Step | Rollback |
|------|----------|
| Clone template to disk | `rm -rf <gamePath>` |
| Token replacement | N/A (directory already removed) |
| Generate files | N/A (directory already removed) |
| `pnpm install` | N/A (directory already removed) |
| Create GitHub repo | Delete repo via GitHub API |
| Git init + push | N/A (repo already deleted) |

Steps execute sequentially. On failure at any step, completed steps are rolled back in reverse order. GitHub repo deletion is best-effort (logged if it fails).

---

## 3. AI Agent Integration (`crucible agent`)

### 3.1 Architecture

```
┌─────────────────────────────────────────────────┐
│                crucible agent                     │
│                                                   │
│  ┌──────────────┐    ┌───────────────────────┐   │
│  │ Context      │    │ Conversation          │   │
│  │ Assembler    │───▶│ Manager               │   │
│  │              │    │                       │   │
│  │ • Game src   │    │ • Claude API calls    │   │
│  │ • Shared pkg │    │ • Tool use handling   │   │
│  │ • AGENTS.md  │    │ • Multi-turn memory   │   │
│  │ • VGF docs   │    │ • Session persistence │   │
│  │   (on-demand)│    │                       │   │
│  └──────────────┘    └───────┬───────────────┘   │
│                              │                    │
│                     ┌────────▼────────┐           │
│                     │ File Restriction │           │
│                     │ Enforcer         │           │
│                     └────────┬────────┘           │
│                              │                    │
│                     ┌────────▼────────┐           │
│                     │ File Writer +   │           │
│                     │ Auto-Committer  │           │
│                     └─────────────────┘           │
└─────────────────────────────────────────────────┘
```

### 3.2 Context Assembly

The agent loads files in priority order, fitting within a 180K token budget:

| Priority | Files | Purpose |
|----------|-------|---------|
| **Required** | `AGENTS.md`, `AGENTS-PROJECT.md`, `AGENTS-REACT-TS.md` | Development rules and coding patterns |
| **High** | `packages/shared/src/types.ts`, `ruleset.ts`, `reducers.ts`, `thunks.ts`, `phases.ts`, `services.ts`, `crucible.json` | Game source files the agent will modify |
| **Medium** | `apps/display/src/**/*.{ts,tsx}`, `apps/controller/src/**/*.{ts,tsx}` | UI components |
| **Low** | `package.json`, `tsconfig`, `vite.config` | Config files (only if budget permits) |
| **Reference** | `BUILDING_TV_GAMES.md` | VGF/WGF deep reference — NOT loaded by default. The hello-weekend template already has all VGF patterns correctly set up. Load on-demand when: (a) agent encounters a VGF-specific error, (b) user asks about WGF internals, (c) agent needs to understand a pattern not evident from the template source code. Loading this 50K+ token doc by default wastes context budget. |

### 3.3 File Restriction Enforcement

Restrictions are enforced at the tool-use layer, not just in the prompt:

```typescript
const DENIED_PATTERNS = [
    "Dockerfile", ".github/**", ".npmrc",
    "pnpm-lock.yaml", "pnpm-workspace.yaml", "node_modules/**",
]

const ALLOWED_PATTERNS = [
    "apps/server/src/**", "apps/display/src/**", "apps/controller/src/**",
    "packages/shared/src/**",
    "apps/*/package.json", "packages/*/package.json",
]
```

When Claude returns a `write_file` tool call, the enforcer checks against deny list first (deny takes priority), then allow list. Default deny for anything not explicitly allowed. Violations are:
- Returned to Claude as an error ("This file is owned by Crucible and cannot be modified")
- Logged to `~/.crucible/agent-audit.log`

### 3.4 Agent Tools

```typescript
const AGENT_TOOLS = [
    { name: "read_file", description: "Read a file in the game project" },
    { name: "write_file", description: "Write content to a file (creates if new)" },
    { name: "run_command", description: "Run pnpm command", enum: ["pnpm build", "pnpm test -- --run", "pnpm typecheck"] },
    { name: "list_files", description: "List files in a directory" },
]
```

**Edit application:** Files are written directly to disk. After each batch of writes (when Claude returns a turn without further tool calls, or after every 5 file operations), Crucible auto-commits **only the files changed by the agent** (not `git add .`, which could capture unrelated local edits):

```typescript
// Stage only files the agent touched in this batch
for (const filePath of agentModifiedFiles) {
    await git.add(filePath)
}
await git.commit(`[crucible-agent] ${description}`)
agentModifiedFiles.clear()
```

### 3.5 Conversation Persistence

Sessions stored as JSON in `~/.local/share/crucible/sessions/<sessionId>.json`:

```typescript
interface AgentSession {
    sessionId: string
    gameId: string
    gamePath: string
    createdAt: string
    lastActiveAt: string
    messages: Anthropic.MessageParam[]
    tokenUsage: { inputTokens: number; outputTokens: number }
}
```

- `--resume` reloads the previous session for the game
- Sessions expire after 24 hours
- Without `--resume`, starts fresh (mentions previous session if one exists)

### 3.6 Agent Conversation UX

**Session start:**
```
Loading game context... done (2.3s)

Agent: I've loaded scottish-trivia. It's currently using the base hello-weekend
       template with no custom game logic. What kind of game would you like to build?
```

Note: `BUILDING_TV_GAMES.md` is NOT loaded at session start (see §3.2 — reference-only, on-demand). The agent loads game source files + AGENTS docs, which is sufficient since the template already has correct VGF patterns.

**Edit presentation (summary by default):**
```
Agent: I'll update the scoring logic and add a bonus round.

  Working...

  [1/3] Edited apps/server/src/reducers.ts
        + Added SUBMIT_ANSWER reducer with score calculation
  [2/3] Edited packages/shared/src/types.ts
        + Added bonusRound field to GameState interface
  [3/3] Created apps/display/src/components/BonusRound.tsx (+38 lines)

  ✓ Committed: "Add scoring logic and bonus round phase" (e4f5g6h)
```

**Cancellation:** Ctrl+C cancels current operation but keeps session alive. Double Ctrl+C within 1s exits. Uncommitted changes remain on disk.

**Safety rails — the agent CANNOT:**
- Modify Dockerfile, CI workflows, lockfiles, .npmrc
- Run arbitrary shell commands (only whitelisted pnpm commands)
- Access files outside the game directory
- Delete git history

---

## 4. Local Development Server (`crucible dev`)

### 4.1 Process Orchestration

`crucible dev` starts three child processes in parallel:

| Process | Command | Default Port | Purpose |
|---------|---------|-------------|---------|
| VGF Server | `pnpm --filter */server dev` | 8090 | WGFServer with MemoryStorage |
| Display | `pnpm --filter */display dev` | 3000 | Vite + React (TV screen) |
| Controller | `pnpm --filter */controller dev` | 5174 | Vite + React (phone) |

### 4.2 Port Allocation

Ports are checked for availability before starting. If a port is occupied, the next available port is used (up to +100 from default). Conflict detection uses `net.createServer().listen()` probe.

### 4.3 Local vs Production Routing

The template must transparently handle two routing models:

| Aspect | Local (`crucible dev`) | Production (K8s) |
|--------|----------------------|------------------|
| Server URL | `http://127.0.0.1:8090` | `wss://crucible-games-{env}.volley-services.net` |
| Socket.IO path | `/{gameId}/socket.io` | `/{gameId}/socket.io` (same) |
| Display base | `/` (Vite default) | `/{gameId}/display/` |
| Controller base | `/` (Vite default) | `/{gameId}/controller/` |
| Health endpoint | `/{gameId}/health` | `/{gameId}/health` (same) |

**How the template handles this:**

- **`vite.config.ts`** reads `STAGE` env var. When `STAGE=local` (or unset), `base: '/'`. When `STAGE=dev|staging|prod`, `base: '/{gameId}/display/'` (or `/controller/`). The `gameId` is read from `crucible.json`.
- **Socket.IO path** is always `/{gameId}/socket.io` in both environments — the server `dev.ts` and production `index.ts` both configure this. This ensures route consistency.
- **Server URL** is passed to the client as a query param (`?serverUrl=...`) in production (from Proto-Hub iframe URL) or via env var in local dev.

This means a game built and tested locally will use the same Socket.IO path routing as production. Only the base URL and Vite asset prefix differ.

### 4.4 The dev.ts Pattern

Each game's `apps/server/src/dev.ts` (from hello-weekend template):
1. Loads `.env` from monorepo root
2. Creates in-memory WGFServer (no Redis, no external deps)
3. Uses noop scheduler store
4. Pre-creates `dev-test` session with `setInterval` re-creation every 2s (VGF deletes sessions on disconnect)
5. Runs via `tsx watch` for auto-restart on file changes

### 4.5 Output Multiplexing

Logs from all three processes are interleaved with colour-coded prefixes:

```
[server]      WGFServer started on :8090
[display]     Vite ready at http://127.0.0.1:3000
[controller]  Vite ready at http://127.0.0.1:5174
```

### 4.6 Lifecycle

- Startup timeout: 30s per sub-process. If any fails, kill all and report which one failed.
- `q` key or Ctrl+C performs graceful shutdown — `SIGTERM` to all, 5s grace, `SIGKILL` fallback via `tree-kill`.

### 4.7 Prototype Deployment (Bifrost)

`crucible prototype` deploys the game to the shared development cluster via Bifrost, giving designers and producers a shareable URL without going through the full CI/CD pipeline.

**Syntax:**

```
crucible prototype <game-id> [--watch] [--dependencies <deps>] [--source] [--delete]
```

| Flag | Description |
|------|-------------|
| `<game-id>` | Required. The game identifier from `crucible.json`. |
| `--watch` | Re-deploy automatically when source files change. |
| `--dependencies <deps>` | Comma-separated list of backing services (e.g., `redis,dynamodb`). |
| `--source` | Use Bifrost Buildpacks instead of local Docker build. |
| `--delete` | Tear down the prototype deployment and clean up resources. |

**Build modes:**

| Mode | Trigger | How It Works |
|------|---------|-------------|
| **Local build** (default) | No `--source` flag | Builds the container image locally using the game's `Dockerfile`, tags it, and pushes to the shared ECR registry. |
| **Source-based** | `--source` flag | Pushes source code to Bifrost, which uses Cloud Native Buildpacks to detect the runtime, build, and deploy. No local Docker required. |

Local build is the default because it reuses the same `Dockerfile` that production CI uses, catching build issues early. Source-based mode is useful when Docker is not installed locally (e.g., lightweight laptops, Codespaces).

**Dependencies flag:**

The `--dependencies` flag provisions backing services alongside the game container. Format is a comma-separated list of service identifiers:

```
crucible prototype scottish-trivia --dependencies redis,dynamodb
```

Each dependency is injected into the game container as environment variables following the naming convention `CRUCIBLE_DEP_<SERVICE>_<PROPERTY>`:

| Dependency | Injected Env Vars |
|------------|-------------------|
| `redis` | `CRUCIBLE_DEP_REDIS_HOST`, `CRUCIBLE_DEP_REDIS_PORT` |
| `dynamodb` | `CRUCIBLE_DEP_DYNAMODB_ENDPOINT`, `CRUCIBLE_DEP_DYNAMODB_TABLE` |

**Watch mode:**

When `--watch` is active, the CLI monitors `apps/` and `packages/` for file changes (debounced 2s). On change:
1. Rebuild the container image (local mode) or re-push source (source mode)
2. Push the updated image to registry
3. Patch the Bifrost CRD to trigger a rolling update
4. Report the new revision once healthy

Watch mode exits on `q` or Ctrl+C and leaves the prototype running. Use `--delete` to tear it down.

**Output:**

```
Deploying prototype for scottish-trivia...

  ✓ Built container image (12.4s)
  ✓ Pushed to registry (3.2s)
  ✓ Applied Bifrost CRD (0.3s)
  ⠸ Waiting for pods...       ✓ healthy (6.1s)

  ✓ Prototype live:
    https://scottish-trivia.prototype.crucible-dev.volley-services.net
```

**Cleanup:**

```
crucible prototype scottish-trivia --delete

  ✓ Removed Bifrost CRD
  ✓ Namespace crucible-proto-scottish-trivia cleaned up

  Prototype torn down.
```

**Error codes:**

| Code | Name | Description |
|------|------|-------------|
| CRUCIBLE-901 | deploy-failed | Bifrost CRD was applied but the deployment did not become healthy within the timeout (120s). |
| CRUCIBLE-902 | build-failed | Local Docker build or Bifrost Buildpack build failed. Includes build output. |
| CRUCIBLE-903 | registry-push-failed | Container image push to ECR failed (auth, network, or quota). |
| CRUCIBLE-904 | cluster-access-error | Cannot reach the Kubernetes API. SSO token may be expired or cluster is unreachable. |

---

## 5. Build & Deploy Trigger (`crucible publish`)

### 5.1 Overview

`crucible publish` does NOT build locally. It pushes code to GitHub and monitors the CI pipeline.

### 5.2 Pre-flight Checks

1. Git working tree has no uncommitted changes (unpushed commits are fine — those are what we're about to push)
2. Dockerfile checksum matches `crucible.json`
3. User is authenticated (`crucible login`)
4. Game has a GitHub repo

**Important: `git push origin main` == deployment.** This is intentional. The CI pipeline triggers on every push to main. If a developer manually pushes outside the CLI, it will trigger a deploy. `crucible publish` is a convenience wrapper that adds pre-flight checks and CI tailing — but the push itself is what triggers CI. If developers need to back up work without deploying, they should use a feature branch (the CI only triggers on `main`).

### 5.3 Flow

```
git push origin main
    → CI triggered (push event)
    → Poll GitHub Actions API every 5s
    → Display real-time stage progress
    → On success: show summary + URLs
    → On failure: show failing stage + CI logs URL
```

### 5.4 CI Status Polling

**Run identification:** After `git push`, the CLI records the pushed commit SHA. It then polls GitHub Actions API filtering by `head_sha` AND workflow ID to find the exact run triggered by this push — NOT just the latest run on `main` (which could belong to another user's concurrent push).

```typescript
const runs = await octokit.actions.listWorkflowRuns({
    owner, repo,
    workflow_id: "crucible-deploy.yml",
    head_sha: pushedCommitSha,  // Exact match — no ambiguity
    per_page: 1,
})
```

The CLI polls two sources:
1. **GitHub Actions API** (every 5s, filtered by `head_sha`) — build/deploy step progress
2. **Registry API** `GET /games/:gameId` (after deploy step) — confirm registration

Timeout: 10 minutes. Ctrl+C stops polling but does NOT cancel the CI run.

### 5.5 Failure Handling

| Stage Failure | CLI Behaviour |
|---------------|--------------|
| Quality gate | Display failing checks. Exit 1. |
| Docker build | Display build error. Exit 1. |
| Image scan (Trivy) | Display vulnerability summary. Exit 1. |
| K8s deploy | CI auto-rolls back. CLI reports. |
| Health check | CI auto-rolls back. CLI reports. |
| Registry write | CI compensating rollback. CLI reports ghost-deploy prevention. |

---

## 6. Rollback & Promote

### 6.1 `crucible rollback`

1. Fetch version history from Registry API
2. Find previous healthy version (or specific `--to` version)
3. Trigger rollback via CI workflow_dispatch
4. Monitor pipeline (same polling as publish — faster, no rebuild)
5. Post-rollback health verification

### 6.2 `crucible promote`

1. Validate game exists in source environment
2. For `--to prod`: require explicit name confirmation
3. Trigger promotion pipeline (image retag, deploy to target env)
4. Monitor and verify

### 6.3 Concurrent Operation Safety

Registry API uses DynamoDB conditional writes. If two people promote simultaneously, the loser gets `ConditionalCheckFailedException` and retries with the latest version (up to 3 retries).

---

## 7. Authentication (`crucible login`)

### 7.1 OIDC Flow

1. Generate PKCE code verifier + challenge
2. Bind local HTTP server on `127.0.0.1:0` (ephemeral port — OS assigns an available port, avoiding collisions with other processes). The dynamically assigned port is included in the OIDC redirect URI.
3. Open browser to Volley SSO auth URL (with callback port in redirect_uri)
4. Wait for callback (5-minute timeout)
5. Exchange auth code for tokens
6. Store tokens in OS keychain (keytar)
7. Extract email from ID token, update config

**Device code fallback** for headless environments (SSH, CI):
```
Cannot open browser. Use the device code flow instead:
Visit:  https://auth.volley.tv/device
Code:   ABCD-1234
```

### 7.2 Token Storage & Refresh

- Tokens stored in OS keychain (macOS Keychain, Windows Credential Vault, libsecret on Linux)
- Automatic silent refresh when access token is within 5 minutes of expiry
- If refresh token expired: prompt `crucible login` again

---

## 8. Logs & Status

### 8.1 `crucible logs`

```
crucible logs scottish-trivia --follow --lines 100 --env dev
```

**Access model:** The CLI authenticates to the K8s API using the same OIDC token from `crucible login` (Volley SSO). The `crucible-ci` IAM role includes EKS `DescribeCluster` permissions, and a K8s RBAC `ClusterRole` grants `pods/log` read access in `crucible-*` namespaces to users with valid Volley SSO tokens. This means non-engineers do NOT need separate `kubectl` setup or kubeconfig — the CLI handles K8s auth transparently via the SSO token.

**Fallback for scale-to-zero:** If the pod is scaled to zero, the CLI queries CloudWatch Logs / Datadog Logs API for historical logs instead of attempting `kubectl logs` on a non-existent pod.

Output is coloured by level (dim=DEBUG, default=INFO, yellow=WARN, red=ERROR).

### 8.2 `crucible status`

Single game:
```
scottish-trivia — Scottish Trivia
  Environment │ Version          │ Status    │ Replicas │ Deployed
  dev         │ 00042-a1b2c3d    │ healthy   │ 1/1      │ 2h ago
  staging     │ 00041-f3e2d1a    │ healthy   │ 0/0      │ 1d ago
  prod        │ —                │ —         │ —        │ —
  Prototype   │ local-build      │ Running   │ 1/1      │ 5m ago
              │ scottish-trivia.prototype.crucible-dev.volley-services.net
```

All games (no argument):
```
  Name              Dev         Staging     Prod
  scottish-trivia   ✓ healthy   ✓ healthy   —
  emoji-party       ✓ healthy   —           —
  word-scramble     ✗ failing   —           —
```

**Replica column:** Values come from the Kubernetes API (via the CLI’s SSO-backed access), not from the Registry API — see §12.1 note on DynamoDB.

---

## 9. CLI User Experience Design

### 9.1 General Conventions

- **Syntax:** `crucible <command> [target] [--flags]`
- **Global flags:** `--no-color`, `--json`, `--verbose` / `-v`, `--quiet` / `-q`, `--help` / `-h`
- **Exit codes:** `0` success, `1` general error, `2` usage error, `3` auth error, `4` network error, `5` timeout
- **Colour palette:** Green=success, Yellow=warnings, Red=errors, Cyan=info/hints. All gated on TTY + `NO_COLOR`.

### 9.2 Command UX Patterns

Each command follows a consistent pattern:

**`crucible create`:**
```
Creating "Scottish Trivia" (scottish-trivia)...

  ✓ Forked hello-weekend → ~/crucible-games/scottish-trivia/
  ✓ Generated Dockerfile + CI workflow from template
  ✓ Created GitHub repo Volley-Inc/crucible-game-scottish-trivia
  ✓ Pushed scaffold

Your game is ready. Next steps:
  crucible agent scottish-trivia     # Build your game with AI
  crucible dev scottish-trivia       # Preview locally
```

**`crucible publish`:**
```
Publishing scottish-trivia...

  ✓ No uncommitted changes (3 local commits will push)
  ✓ Pushed to Volley-Inc/crucible-game-scottish-trivia (main)
  ✓ CI pipeline triggered (run #42)

  ⠸ Running quality gate...
    ├── lint                            ✓ passed (4.2s)
    ├── typecheck                       ✓ passed (6.1s)
    └── test                            ✓ passed (8.3s)
  ⠸ Building Docker image...            ✓ OK (34.5s)
  ⠸ Scanning for vulnerabilities...     ✓ 0 critical (7.8s)
  ⠸ Deploying to crucible-dev...        ✓ OK (8.4s)
  ⠸ Health check...                     ✓ HEALTHY (2.1s)
  ⠸ Registering in game registry...     ✓ OK (0.4s)

  ✓ Published! scottish-trivia is live on Proto-Hub (dev)
    Version: 00000042-a1b2c3d | Duration: 1m 43s
```

### 9.3 Error Taxonomy

Format: `CRUCIBLE-XYY` where X = category, YY = specific error.

| Category | Code Range | Examples |
|----------|-----------|---------|
| Auth | 1xx | 101: SSO flow failed, 102: GitHub token expired, 103: not logged in |
| Git/Repo | 2xx | 201: repo exists, 202: local dir exists, 205: push failed |
| Agent | 3xx | 301: game not found, 302: API error, 305: restricted file |
| Network/Dev | 4xx | 401: unreachable, 403: port in use, 404: server crash |
| Build/CI | 5xx | 501: quality gate failed, 502: health check failed, 509: timeout |
| Promote | 6xx | 601: no source version |
| Rollback | 7xx | 701: no previous version, 703: version not found |
| Template | 8xx | 801: clone / template source failed, 802: remove template artefacts failed, 803: token replacement failed, 804: generated files failed, 805: `.npmrc` write failed, 806: `pnpm install` failed; 807: reserved for template version mismatch |
| Prototype | 9xx | 901: deploy failed, 902: build failed, 903: registry push failed, 904: cluster access error |

**Every error follows this structure:**
```
✗ <human-readable summary>

  <details>

  Recovery:
    <actionable steps>

  Error: CRUCIBLE-XYY (category/short-name)
```

**JSON mode (`--json`):**
```json
{
  "error": true,
  "code": "CRUCIBLE-501",
  "category": "build",
  "shortName": "quality-gate-failed",
  "message": "Lint, typecheck, or tests failed.",
  "recovery": "Fix the issues and re-publish.",
  "retryable": false
}
```

### 9.4 User Journey Maps

See the architecture document's User Flows (sections on Create, Local Preview, Publish, Rollback, Promote) for the happy paths. Each journey includes:
- Pre-condition checks (auth, game exists, clean working tree)
- Parallel operations where possible (e.g., local dir + GitHub repo collision checks)
- Error branches with specific CRUCIBLE-XYY codes
- Recovery suggestions at every failure point

### 9.5 First-Run Experience

First invocation with no config:
```
$ crucible

  Welcome to Crucible — build TV games with AI.

  Step 1: crucible login
  Step 2: crucible create "My Game"

  For documentation: crucible --help
```

Context-sensitive hints appear for first-time users (tracked via `hintsShown` counter, stop after 5 sessions).

### 9.6 Accessibility

- **Terminal width:** Respects `process.stdout.columns` (default 80). Tables switch to stacked format below 60 columns.
- **Colour:** Never the sole indicator. Errors always have `✗`, successes `✓`. Disabled by `--no-color`, `NO_COLOR=1`, `TERM=dumb`, or non-TTY.
- **UTF-8 fallback:** `✓` → `[OK]`, `✗` → `[FAIL]`, spinners → `\|/-`. Detected via `LANG`/`LC_ALL` or `CRUCIBLE_ASCII=1`.
- **Screen readers:** No cursor manipulation in non-TTY. No ANSI escapes when colour disabled.

---

## 10. E2E Testing Strategy

### 10.1 Platform E2E (Crucible Itself)

Full lifecycle tests for the Crucible CLI:

```typescript
describe("crucible full flow", () => {
    it("create → dev → publish → rollback", async () => {
        // 1. Create a game
        const result = await executeCreate({ displayName: "E2E Test Game" })
        expect(existsSync(result.gamePath)).toBe(true)

        // 2. Verify template parameterisation (no "hello-weekend" references remain)
        const allFiles = await glob("**/*.{ts,tsx,json}", { cwd: result.gamePath })
        for (const file of allFiles) {
            expect(readFileSync(join(result.gamePath, file), "utf-8")).not.toContain("hello-weekend")
        }

        // 3. Dev server starts and responds
        // Note: in local dev, health is at /{gameId}/health (same path as production)
        const session = await startDevSession(result.gamePath)
        const healthResp = await fetch(`http://127.0.0.1:${session.ports.server}/e2e-test-game/health`)
        expect(healthResp.ok).toBe(true)
        await stopDevSession(session)

        // 4. Publish (with mocked CI or real test environment)
        // 5. Verify registry entry
        // 6. Rollback and verify
    }, { timeout: 120_000 })
})
```

**Mock vs real strategy:**
- Unit tests: mock GitHub API, Registry API, Claude API via `msw`
- Integration tests: real filesystem, mocked external APIs
- E2E tests: real GitHub test repo, real Registry API (dev environment), mocked Claude API (recorded responses)

### 10.2 Game Template E2E (Baked Into hello-weekend)

Every game created from the template includes E2E tests out of the box:

```typescript
// apps/e2e/tests/game-flow.test.ts (Playwright)
import { test, expect } from "@playwright/test"

test("full game flow: lobby → playing → game over", async ({ browser }) => {
    // 1. Start VGF server in background
    const server = await startTestServer()

    // 2. Open display client
    const displayPage = await browser.newPage()
    await displayPage.goto(`http://127.0.0.1:${server.displayPort}?sessionId=test`)
    await expect(displayPage.locator("[data-phase='lobby']")).toBeVisible()

    // 3. Open controller client
    const controllerPage = await browser.newPage()
    await controllerPage.goto(`http://127.0.0.1:${server.controllerPort}?sessionId=test`)

    // 4. Controller starts game
    await controllerPage.click("[data-action='start-game']")

    // 5. Verify display transitions to playing phase
    await expect(displayPage.locator("[data-phase='playing']")).toBeVisible()

    // 6. Controller submits answer
    await controllerPage.click("[data-action='submit-answer']")

    // 7. Continue through phases...

    await server.stop()
})

test("multi-client: 1 display + 4 controllers", async ({ browser }) => {
    const server = await startTestServer()
    const display = await browser.newPage()
    await display.goto(`http://127.0.0.1:${server.displayPort}?sessionId=test`)

    const controllers = await Promise.all(
        Array.from({ length: 4 }, () => browser.newPage())
    )
    for (const ctrl of controllers) {
        await ctrl.goto(`http://127.0.0.1:${server.controllerPort}?sessionId=test`)
    }

    // Verify all 4 players appear on display
    await expect(display.locator("[data-player-count]")).toHaveText("4")

    await server.stop()
})
```

**Test framework:** Playwright (cross-browser, built-in WebSocket support, auto-wait).

**CI integration:** E2E tests run as part of the quality gate before any deploy. The Playwright `globalSetup` fixture starts the VGF server + Vite clients automatically — CI does NOT start them separately.

```yaml
# In crucible-deploy.yml quality-gate job:
- name: Run E2E tests
  run: |
    pnpm --filter e2e test
  env:
    PLAYWRIGHT_BROWSERS_PATH: 0  # Use system browsers
```

> **Cross-reference:** `docs/tdd-infrastructure.md` §11.1 shows an alternative inline server-start approach. The canonical pattern is Playwright `globalSetup` — the infra snippet is illustrative of the concept, not the exact CI implementation.

**Agent can extend these tests** as it builds the game — adding test cases for new phases, new controller inputs, etc.

### 10.3 Template Snapshot Testing

Generated files are compared against known-good snapshots:

```typescript
describe("template generation", () => {
    it("generates correct Dockerfile", () => {
        const dockerfile = renderDockerfile({ gameId: "test-game" })
        expect(dockerfile).toMatchSnapshot()
    })

    it("parameterises all hello-weekend references", async () => {
        const gamePath = await createTestGame("My Game")
        // Scan ALL text files, not just ts/json — catches yaml, md, sh, workflow files
        const allFiles = await glob("**/*.{ts,tsx,json,yaml,yml,md,sh}", { cwd: gamePath, ignore: ["node_modules/**"] })
        for (const file of allFiles) {
            const content = readFileSync(join(gamePath, file), "utf-8")
            expect(content).not.toContain("hello-weekend")
            expect(content).not.toContain("HelloWeekend")
        }
    })
})
```

---

## 11. Data Flow Diagrams

### 11.1 `crucible create`

```
User input: "Scottish Trivia"
  → Token Map Builder (kebab, pascal, scope, repo name)
  → Template Clone (GitHub API or local path)
  → Token Replacement (walk all files)
  → File Generation (Dockerfile.hbs, CI workflow.hbs, crucible.json)
  → pnpm install (generate lockfile)
  → GitHub Repo Create (POST /orgs/Volley-Inc/repos + apply rulesets)
  → Git Init + Push (commit, push to origin/main)
```

### 11.2 `crucible agent`

```
User message
  → Context Assembler (game source + AGENTS files; VGF docs loaded on-demand only)
  → Claude API (messages.create with tools)
  → Tool Use Handling:
      write_file → Restriction Enforcer → File Writer → disk
      read_file → File Reader → return content
      run_command → Command Runner (pnpm only) → return output
  → Auto-Commit (git add + commit after each batch)
  → Session Persistence (save to ~/.local/share/crucible/sessions/)
```

### 11.3 Prototype Data Flow

```
Developer
  → crucible prototype <game-id>
  → Build Phase:
      Local mode: docker build → docker tag → docker push (ECR)
      Source mode: tar + push source → Bifrost Buildpacks → image in ECR
  → Apply Bifrost CRD (kubectl apply -f prototype-crd.yaml)
  → Bifrost Controller (cluster-side):
      → Create namespace crucible-proto-<game-id>
      → Provision dependencies (Redis, DynamoDB, etc.)
      → Inject CRUCIBLE_DEP_* env vars into pod spec
      → Create Deployment + Service + Ingress
  → Pod scheduling → container pull → startup → health check
  → Game running at https://<game-id>.prototype.crucible-dev.volley-services.net
```

### 11.4 `crucible publish`

```
Pre-flight checks (clean tree, checksum, auth)
  → git push origin main
  → GitHub Actions CI triggered
  → Poll GitHub Actions API (every 5s):
      quality-gate → build-and-deploy (Docker, Trivy, S3, K8s, verify, register)
  → On completion: show summary or failure details
```

### 11.5 `crucible login`

```
PKCE generation (verifier + challenge + state)
  → Start callback server (127.0.0.1:0 — ephemeral OS-assigned port)
  → Open browser (https://auth.volley.tv/authorize?redirect_uri=...:{port}/callback)
  → Wait for callback with auth code
  → Exchange code for tokens (POST /oauth/token)
  → Store in OS keychain (keytar)
  → Extract email from ID token → update config
```

---

## 12. API Contract Specifications

### 12.1 Crucible Registry API Client Interface

```typescript
interface RegistryClient {
    listGames(): Promise<GameListEntry[]>
    getGame(gameId: string): Promise<GameRecord>
    getGameHistory(gameId: string): Promise<GameVersion[]>
    checkHealth(gameId: string, env: string): Promise<boolean>
}

interface GameListEntry {
    gameId: string
    displayName: string
    author: string
    catalogStatus: "active" | "disabled"      // visibility in Proto-Hub
    healthStatus: "healthy" | "unhealthy" | "deploying"  // deployment health
    updatedAt: string
}

interface GameRecord {
    gameId: string
    displayName: string
    author: string
    currentVersion: string
    catalogStatus: "active" | "disabled"
    healthStatus: "healthy" | "unhealthy" | "deploying"
    environments: Record<string, {
        version: string
        imageTag: string
        healthStatus: "healthy" | "unhealthy" | "deploying" | "not-deployed"
        endpoints: { display: string; controller: string; server: string }
        lastDeployedAt: string
        lastDeployedBy: string
    }>
}

// Note: replica counts are NOT stored in the Registry API (DynamoDB stores static/event-driven
// data only). `crucible status` fetches replica counts directly from the K8s API via kubectl
// when the user has cluster access, or omits them when they don't.

interface GameVersion {
    version: string
    imageTag: string
    status: "active" | "rolled-back" | "superseded"  // version lineage only, NOT deployment health
    publishedAt: string
    publishedBy: string
}
```

### 12.2 CLI ↔ GitHub API

| Operation | Method | Endpoint |
|-----------|--------|----------|
| Create repo | POST | `/orgs/Volley-Inc/repos` |
| Apply rulesets | POST | `/repos/{owner}/{repo}/rulesets` |
| Trigger workflow | POST | `/repos/{owner}/{repo}/actions/workflows/{id}/dispatches` |
| Poll run status | GET | `/repos/{owner}/{repo}/actions/workflows/{id}/runs?head_sha={sha}&per_page=1` |
| Get job details | GET | `/repos/{owner}/{repo}/actions/runs/{id}/jobs` |

### 12.3 CLI ↔ Registry API

**Auth model:** Public endpoints (`GET /games`, `GET /games/:gameId`) require no auth and are CloudFront-cached. Protected endpoints require Volley SSO JWT as `Authorization: Bearer <token>`.

| Operation | Method | Endpoint | Auth |
|-----------|--------|----------|------|
| List games | GET | `/games` | **None** (public, CloudFront cached 15s) |
| Get game | GET | `/games/:gameId` | **None** (public, CloudFront cached 15s) |
| Get history | GET | `/games/:gameId/history` | SSO JWT |
| Activate (for testing) | POST | `/games/:gameId/activate` | SSO JWT |

---

## 13. Glossary

| Term | Definition |
|------|-----------|
| **Crucible** | Platform for building and deploying Volley TV games using AI agents |
| **crucible.json** | Metadata file in each game project root. Contains game identity, display info, template version, and checksums of immutable files |
| **GameRuleset** | Top-level WGF configuration: `setup`, `actions`, `reducers`, `thunks`, `phases` |
| **Phase** | Named state in the game's FSM (e.g., `lobby`, `playing`, `gameOver`). Each has its own lifecycle hooks |
| **nextPhase Pattern** | Required VGF 4.8+ pattern: thunk sets `state.nextPhase`, `endIf` checks it, `next` returns it. Direct `state.phase` modification throws |
| **Display** | TV screen app (React + Vite). Shows game visuals in an iframe |
| **Controller** | Phone screen app (React + Vite). Players interact via touch/voice |
| **WGFServer** | Current VGF server class (replaces older `VGFServer`). Accepts explicit Socket.IO instance |
| **Template Drift** | Divergence between a game's boilerplate and the current hello-weekend template |



