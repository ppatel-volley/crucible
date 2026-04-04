# Crucible — Progress Tracker

> **Purpose:** Track completed work so fresh agent instances don't need to scan the codebase.
> Update this file when milestones or work items are completed.
> See `docs/development-plan.md` for full milestone definitions.

---

## Phase 1: Agent + Local Dev

### Milestone 1A: CLI Scaffold + Create Command — COMPLETE

All 8 work items done. 124 tests passing, typecheck clean.

| # | Work Item | Status | Commit(s) | Notes |
|---|-----------|--------|-----------|-------|
| 1A.1 | CLI scaffold (`index.ts`, commander, global flags, exit codes) | Done | `a92d1a9` | |
| 1A.2 | Config module (XDG paths, Windows `%APPDATA%`, Zod validation) | Done | `a92d1a9` | |
| 1A.3 | Logger/UX utilities (spinners, chalk, CRUCIBLE-XYY errors) | Done | `a92d1a9` | |
| 1A.4 | Token map + template engine | Done | `a92d1a9` | |
| 1A.5 | File generation (Dockerfile, CI workflow, crucible.json) | Done | `a92d1a9` | |
| 1A.6 | `crucible create` command (orchestration + rollback) | Done | `a92d1a9` | |
| 1A.7 | GitHub integration (repo creation, Rulesets, git push) | Done | `aa4baf4` | |
| 1A.8 | Git operations (simple-git wrapper, checksum validation) | Done | `a92d1a9` | |

**Review rounds completed:**
- Round 1: Duplicate CrucibleError, `--skip-github` default, exit code mapping, git error factory — all fixed (`0764304`)
- Round 2: Pre-parse global flags, template clone shorthand, GitHub org default — fixed/documented (`3b882fd`)
- Round 3: Error rethrow guard, extensionless text file handling — fixed (pending commit)

### Milestone 1B: AI Agent — COMPLETE

All 7 work items done. 205 tests passing (81 new), typecheck clean.

| # | Work Item | Status | Commit | Notes |
|---|-----------|--------|--------|-------|
| 1B.1 | Context assembler (`agent/context.ts`) | Done | `51e3efa` | Priority-based loading, 180K token budget, VGF docs on-demand |
| 1B.2 | File restriction enforcer (`agent/restrictions.ts`) | Done | `51e3efa` | Deny-first patterns, audit logging, custom glob matcher |
| 1B.3 | Claude API client (`api/claude.ts`) | Done | `51e3efa` | @anthropic-ai/sdk wrapper, 4 tool definitions, error mapping |
| 1B.4 | Agent runner (`agent/runner.ts`) | Done | `51e3efa` | Conversation loop, tool dispatch, selective auto-commit |
| 1B.5 | Session persistence (`agent/session.ts`) | Done | `51e3efa` | JSON sessions, 24hr expiry, --resume support |
| 1B.6 | `crucible agent` command | Done | `51e3efa` | Interactive readline UX, edit summaries, Ctrl+C handling |
| 1B.7 | Bundle VGF docs | Done | `51e3efa` | BUILDING_TV_GAMES.md bundled with loader utility |

### Milestone 1C: Local Dev Server — COMPLETE + REVIEWED

All 4 work items done. 32 new tests. Reviewed by `cursor-agent-2` and `cursor-agent-eqx`.

| # | Work Item | Status | Commit | Notes |
|---|-----------|--------|--------|-------|
| 1C.1 | Port allocation (`dev/ports.ts`) | Done | `bef6f32` | Conflict detection, auto-increment, CRUCIBLE-403, intra-session dedup |
| 1C.2 | Output multiplexer (`dev/output.ts`) | Done | `bef6f32` | Colour-coded prefixes, padded alignment |
| 1C.3 | Process orchestrator (`dev/orchestrator.ts`) | Done | `bef6f32` | Parallel start, readiness wait, crash monitoring, SIGTERM→SIGKILL shutdown |
| 1C.4 | `crucible dev` command | Done | `bef6f32` | Port overrides, q-to-quit, signal handling, health URL output |

**Review fixes applied:**
- Startup readiness: waits for ready signals per process with 30s timeout (`ae3b5af`)
- Two-phase graceful kill: SIGTERM → grace period → SIGKILL (`ae3b5af`)
- `q`/`Q` keypress to quit in TTY mode (`ae3b5af`)
- Port dedup: reserved set prevents intra-session collisions (`ae3b5af`)
- CRUCIBLE-301 for game-not-found per §9.3 taxonomy (`bace1e7`)
- Orphan repo cleanup on ruleset failure (`bace1e7`)
- CRUCIBLE-202 uses gitError instead of templateError (`bace1e7`)

### Milestone 1D: E2E Testing — PARTIAL + REVIEWED

1D.2 and 1D.3 done. 1D.1 deferred (needs real game template for full lifecycle test).

| # | Work Item | Status | Commit | Notes |
|---|-----------|--------|--------|-------|
| 1D.1 | Platform E2E test harness | Deferred | — | Needs 1C.4 + real hello-weekend template |
| 1D.2 | Template snapshot tests | Done | `bef6f32` | Dockerfile, CI workflow, crucible.json snapshots |
| 1D.3 | Agent integration tests | Done | `bef6f32` | Real filesystem + mocked Claude API, 9 tests |

### Milestone 1E: hello-weekend Template Prep — COMPLETE

Done in `hello-weekend` repo. VGF upgraded to 4.13.0, Platform SDK to 7.47.3.

| # | Work Item | Status | Repo | Notes |
|---|-----------|--------|------|-------|
| 1E.1 | E2E test package (`apps/e2e/`) | Done | `hello-weekend` | Playwright, global-setup/teardown, serial execution |
| 1E.2 | `data-*` test attributes | Done | `hello-weekend` | Phase/action/score attributes on display + controller |
| 1E.3 | Template tokenisation audit | Done | `hello-weekend` | All references replaceable |

**Pre-requisite upgrade:** VGF 4.13.0 + Platform SDK 7.47.3 (WGFServer, subpath imports, schedulerStore, index signature)

### CLI Command Scaffolds + Implementations — COMPLETE

All 7 remaining commands scaffolded. Some have real logic implemented beyond the scaffold.

| Command | Options | Status | Blocked On |
|---------|---------|--------|------------|
| `crucible publish <game-id>` | `--timeout`, `--env` | **Pre-flight checks working** (git clean, checksum, crucible.json, remote). CI polling not yet. | Phase 2 (CI pipeline) |
| `crucible rollback <game-id>` | `--to <version>`, `--env` | Scaffold only (CRUCIBLE-701) | Phase 2 (Registry API) |
| `crucible promote <game-id>` | `--from`, `--to`, `--confirm` | Scaffold only (CRUCIBLE-601) | Phase 2 (Registry API) |
| `crucible logs <game-id>` | `-f/--follow`, `--lines`, `--env` | Scaffold only (CRUCIBLE-401) | Phase 2 (K8s access) |
| `crucible status [game-id]` | `--env` | Scaffold only (CRUCIBLE-401) | Phase 2 (Registry API) |
| `crucible list` | `--env` | **Working** — formatted table with crucible.json parsing, relative timestamps | Registry lookup needs Phase 2 |
| `crucible login` | `--device-code` | **OIDC infrastructure built** — PKCE, callback server, token store. Needs SSO config. | SSO config (see docs/human-actions.md) |

### Auth Infrastructure — COMPLETE

OIDC login flow built and ready for SSO config values.

| Module | File | Tests | Notes |
|--------|------|-------|-------|
| PKCE utilities | `auth/oidc.ts` | 9 | Code verifier, challenge, state, auth URL builder, token exchange |
| Callback server | `auth/server.ts` | — | Ephemeral HTTP server on 127.0.0.1:0 for OAuth redirect |
| Token store | `auth/token-store.ts` | 8 | File-based, 5-min-before-expiry refresh, save/load/clear |

---

## Bifrost Integration — FIRST PROTOTYPE DEPLOYMENT LIVE

Bifrost operator deployed to shared-k8s-dev with all shared infrastructure running. Phase 2 (Buildpacks) feature-complete. **First Crucible game deployed to Bifrost: Space Invaders running at `space-invaders.volley-services.net`.**

| Component | Status | Notes |
|-----------|--------|-------|
| Bifrost controller | **Deployed** | Running on EKS dev cluster |
| Shared Postgres | **Running** | In `prototypes` namespace |
| Shared MinIO (S3) | **Running** | In `prototypes` namespace |
| Shared Redis | **Running** | In `prototypes` namespace |
| In-cluster registry | **Running** | `registry.prototypes.svc.cluster.local:5000` |
| `spec.source` (Buildpacks) | **Working** | Git clone → pack build → push to registry, auto-rebuild on branch advance |
| `spec.image` (pre-built) | **Working** | Push image to in-cluster registry, reference in CRD |
| Tictactoe sample | **Working** | End-to-end smoke test with Postgres + S3 dependencies |
| SSH deploy key support | **Working** | For private repos |
| **Space Invaders prototype** | **LIVE** | First Crucible deployment — pod running, ingress live, all conditions green at `space-invaders.volley-services.net` |

### Crucible ↔ Bifrost Integration Modules — COMPLETE

| Module | Status | Tests | Notes |
|--------|--------|-------|-------|
| CRD generator (`prototype/crd.ts`) | Done | 10 | Image-based and source-based modes |
| Registry push (`prototype/registry.ts`) | Done | 9 | Docker tag + push |
| `crucible prototype` command | Done | 7 | Source-based builds, status polling, delete |
| `crucible status` with Bifrost | Done | 8 | Prototype tier: phase, hostname, deps |
| `crucible publish --from-prototype` | Done | 5 | Graduation: reads prototype config, shows summary |

**Milestone achieved (2026-03-31):** First Crucible-managed game deployed to Bifrost. Space Invaders prototype running at `space-invaders.volley-services.net` — pod healthy, ingress live, all CRD conditions green. Lessons learned: DNS resolution needed VPN reconnect, ALB took ~1 minute to stabilise after ingress creation.

Bifrost integration handoff PR: [bifrost#8](https://github.com/Volley-Inc/bifrost/pull/8)

---

## Phase 2: Shared Infrastructure — MOSTLY COMPLETE

CrucibleAdmin SSO permission set merged. `crucible-ci` IAM role applied. AWS resources provisioned. K8s tenant onboarding complete.

### Milestone 2A: AWS Resources — COMPLETE

| Resource | Status | Notes |
|----------|--------|-------|
| ECR `crucible-games` | Done | Private, immutable tags, lifecycle policy |
| S3 `crucible-clients-{dev,staging,prod}` | Done | us-east-1, versioning enabled |
| DynamoDB `crucible-catalog` | Done | PITR on, TTL on expiresAt, GSI author-index |
| DynamoDB `crucible-versions` | Done | PITR on, TTL on expiresAt |
| `crucible-ci` IAM role | Done | volley-infra PR #2096 — applied via Atlantis |
| CloudFront distributions | Deferred | Not needed until production |
| GitHub OIDC provider | Already exists | Shared org-wide resource |

### Milestone 2B: Kubernetes Resources — COMPLETE (dev)

| Resource | Status | Notes |
|----------|--------|-------|
| `crucible-dev` namespace | **Merged** | kubernetes PR #866 |
| Dev HelmRelease config | **Merged** | volley-infra-tenants PR #4273 (nginx placeholder) |
| `crucible-staging` namespace | Not started | |
| `crucible-production` namespace | Not started | |
| DNS (`volley-services.net`) | Automatic via external-dns | Created from ingress annotations |

### Milestone 2C: Registry API — DEPLOYED

Lambda handlers implemented in `packages/crucible-registry/` (17 tests). **Deployed to AWS via Terraform (volley-infra #2112, applied 2026-04-01).** Datadog Lambda layer enabled for observability.

| Handler | Route | Status |
|---------|-------|--------|
| get-games | `GET /games` | Implemented (public) |
| get-game | `GET /games/:gameId` | Implemented (public) |
| put-game | `PUT /games/:gameId` | Implemented (auth + optimistic concurrency) |
| get-game-history | `GET /games/:gameId/history` | Implemented (auth) |
| delete-game | `DELETE /games/:gameId` | Implemented (admin, soft-delete) |

### Milestone 2D: Supporting Infrastructure — NOT STARTED

---

## Phase 3: Publish Pipeline — IN PROGRESS

### Milestone 3A: CI Pipeline + Deploy Tool — COMPLETE

| Module | Status | Tests | Notes |
|--------|--------|-------|-------|
| `@volley/crucible-deploy` scaffold | Done | — | CLI with 4 subcommands via Commander |
| `apply` command | Done | 37 | K8s manifests (6 types), IRSA CloudFormation, kubectl apply |
| `verify` command | Done | 6 | Health endpoint polling with timeout |
| `register` command | Done | 7 | Registry API PUT with optimistic concurrency + 409 retry |
| `rollback` command | Done | — | kubectl rollout undo + best-effort registry update |
| K8s manifest templates | Done | (in apply) | Deployment, Service, Ingress, ServiceAccount, ScaledObject, NetworkPolicy |
| IRSA CloudFormation template | Done | (in apply) | Per-game IAM role with scoped S3/ECR |
| CI workflow template update | Done | — | EKS_OIDC_PROVIDER wired, env expressions fixed |

**Review:** Internal review + Cursor reviewer. All findings addressed (CloudFormation waiter, OIDC param, NetworkPolicy scoping, ECR permissions, gameId validation).

### Milestone 3B: CLI Publish + Ops Commands — MOSTLY COMPLETE

| Command | Status | Notes |
|---------|--------|-------|
| `crucible publish` | **Working** | Pre-flights, git push, CI polling with per-job progress |
| `crucible rollback` | **Working** | kubectl rollout undo + `--to` revision support |
| `crucible promote` | **Working** | Registry API fetch + cross-env registration, prod --confirm safety |
| `crucible logs` | **Working** | kubectl logs with --follow streaming + --lines batch mode |
| `crucible login` | OIDC built | Needs SSO config values |
| `crucible list` | **Working** | Local game discovery + table formatting |
| `crucible status` | **Working** | Bifrost prototype + env tiers |

### Milestone 3C: Safety + Resilience — NOT STARTED

---

## Phase 4: Proto-Hub (Foundry) — LIVE ON FIRE TV

Proto-Hub forked from Hub, stripped, deployed to CloudFront, and **running on real Fire TV hardware via VWR**. Carousel renders, D-pad navigation works, hero images display.

| Item | Status | Notes |
|------|--------|-------|
| Fork + strip paywall/billing/experiments/mobile | Done | 346 files removed |
| PlatformProvider working locally | Done | `gameId: "hub"` for session ID auto-generation |
| Placeholder games rendering | Done | 5 Foundry-branded games with Fal.ai artwork |
| Default prototype tile asset | Done | Wireframe cube for Bifrost prototypes |
| Game titles on tiles | Done | Gradient overlay with title text |
| Hub observability removed | Done | Cleared Datadog, Segment, Amplitude defaults |
| Debug overlay removed | Done | Hub debug panel stripped |
| Registry API integration (4.2) | **Done** | `useGames()` fetches from Registry API with 15s poll |
| Bifrost prototype integration (4.3) | **Done** | Fetches from `bifrost-api.volley-services.net/prototypes` via Vite proxy |
| Direct URL launch for prototypes (4.4) | **Done** | `FoundryGameOrchestration` routes by source, 5s ready fallback |
| QR code on lobby screen | **Done** | `qrcode.react` — scan to open controller on phone |
| VWR ready signal for TV | **Done** | SDK emits ready automatically with `gameId: "hub"` |
| Stale Hub type cleanup | **Done** | Removed trackingId, PaywallType, dead GameId enum (PR #6) |
| Proto-Hub CI/CD (4.7) | **Working** | S3 deploy via GitHub Actions, OIDC trust on main |
| CloudFront distribution | **Live** | `protohub-dev.volley.tv` via crucible-clients-dev S3 |
| BrowserIpc cross-origin fix | **Done** | Added VWR origins to `trustedOrigins` in PlatformProvider (PR #19) |
| Image preloading Fire TV fix | **Done** | `deferMainHubAssets=true` — SDK 28 AVIF decode fails (PR #21) |
| Exit modal disabled on carousel | **Done** | VWR handles exit, modal was stealing D-pad focus (PR #22) |
| TypeScript errors resolved | **Done** | 6 errors fixed — tsc passes cleanly (PR #22) |
| Platform errors non-fatal | **Done** | auth-dev.volley.tv 401 on Fire TV no longer blocks app |
| QR code pairing via Weekend app (4.5) | Not started | Needs Platform SDK integration |
| Game launching on Fire TV | **Blocked** | Bifrost prototypes resolve to private 10.x IPs — needs public ingress |

**Milestones achieved:**
- **(2026-04-01):** Space Invaders and Tic-Tac-Toe prototypes visible on Foundry carousel via Bifrost API. Both games launch in iframe.
- **(2026-04-02):** Word Smiths VGF game created, deployed to Bifrost via `--docker`, playable from Proto-Hub with QR code lobby. Bifrost CORS fixed, Kaniko Dockerfile builds working. Registry API CI/CD deployed. Dockerfile template updated for Kaniko compatibility. VWR TV deployment guide written. Fire TV device configured via VWR S3 CLI.
- **(2026-04-04):** **Proto-Hub live on Fire TV!** Carousel renders with 8 game tiles (3 Bifrost + 5 placeholder), D-pad navigation works, hero images display. Key fixes: trustedOrigins for BrowserIpc (PR #19), deferred image preloading for SDK 28 (PR #21), exit modal disabled (PR #22). Game launching blocked on Bifrost public ingress.

---

## Phases 5–6: Not Started

Depends on Phase 3. See `docs/development-plan.md`.

---

## Overall Stats

- **Total tests:** 444 (377 crucible + 17 registry + 50 deploy, across 46 test files)
- **Typecheck:** Clean (all 3 packages)
- **All commands registered:** No stubs remaining in index.ts
- **Packages:** `@volley/crucible` (CLI) + `@volley/crucible-registry` (Lambda API) + `@volley/crucible-deploy` (CI deploy tool)

## Documentation

| Document | Purpose |
|----------|---------|
| `docs/user-guide.md` | End-user guide for all CLI commands |
| `docs/human-actions.md` | Infrastructure setup steps for humans (ELI5) |
| `docs/PROGRESS.md` | This file — tracks completed work |
| `docs/development-plan.md` | Full milestone definitions and dependencies |
| `docs/tdd-cli.md` | CLI Technical Design Document |
| `docs/tdd-infrastructure.md` | Infrastructure Technical Design Document |
| `docs/architecture.md` | Full architecture plan |
| `docs/protohub-for-bifrost.md` | Proto-Hub integration briefing for Bifrost team |
| `docs/protohub-assessment.md` | Hub codebase assessment for Crucible integration |
| `docs/observability-plan.md` | Datadog observability plan for all Crucible surfaces |

## Open PRs (Cross-Repo)

| PR | Repo | What | Status |
|----|------|------|--------|
| ~~#2094~~ | volley-infra | CrucibleAdmin SSO permission set | **Merged** |
| ~~#2096~~ | volley-infra | crucible-ci IAM role | **Merged + Applied** |
| ~~#866~~ | kubernetes | crucible-dev namespace + Flux sync | **Merged** |
| ~~#4273~~ | volley-infra-tenants | crucible dev HelmRelease config | **Merged** |
| ~~#3~~ | crucible | Prototype command + Registry API | **Merged** |
| ~~#12~~ | crucible | crucible-deploy CI tool (Phase 3A) | **Merged** |
| #12 | bifrost | Proto-Hub briefing for Bifrost agent | Open (awaiting Bifrost team) |
| ~~#2112~~ | volley-infra | Registry API Terraform (Lambda + API Gateway) | **Merged + Applied** |
