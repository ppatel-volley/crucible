# Crucible Platform — Development Plan

> **Date:** 2026-03-25
> **Status:** Active
> **Tracks:** CLI TDD (`docs/tdd-cli.md`) + Infrastructure TDD (`docs/tdd-infrastructure.md`)

---

## Critical Path

```
Phase 1 (Agent + Local Dev) ──→ Phase 3 (Publish Pipeline) ──→ Phase 4 (Proto-Hub)
                                       ↑                         ↑
Phase 2 (Shared Infra) ───────────────┘                         │
                              └─────────────────────────────────┘
Phase 5 (Template Mgmt) ← after Phase 3
Phase 6 (Desktop App) ← after Phase 1
```

Phase 1 and Phase 2 start in parallel. Phase 3 blocked on both. Phase 4 blocked on Phase 3 + Registry API.

---

## Phase 1: Agent + Local Dev (The Product Bet)

### Milestone 1A: CLI Scaffold + Create Command

| # | Work Item | Deps | Size | Parallel? | Repo | Acceptance Criteria |
|---|-----------|------|------|-----------|------|---------------------|
| 1A.1 | CLI scaffold: `index.ts`, commander setup, global flags, exit codes | None | S | Yes | `crucible` | `npx crucible --help` prints commands. Exit codes 0-5 match spec. |
| 1A.2 | Config module: `config/paths.ts`, `config.ts`, `schema.ts` — XDG paths, Windows `%APPDATA%`/`%LOCALAPPDATA%`, Zod validation | None | S | Yes | `crucible` | Config loads/saves to correct OS paths. Schema rejects invalid config. |
| 1A.3 | Logger/UX utilities: `util/logger.ts`, `errors.ts`, `process.ts` — spinners, chalk, CRUCIBLE-XYY errors, NO_COLOR, UTF-8 fallback | None | M | Yes | `crucible` | Errors display structured. `--json` outputs JSON. `CRUCIBLE_ASCII=1` replaces Unicode. |
| 1A.4 | Token map + template engine: `template/tokens.ts`, `engine.ts` — build token map, walk files replacing all `hello-weekend` references | hello-weekend exists | M | Yes | `crucible` | Zero `hello-weekend` references remain after replacement. Snapshot tests pass. |
| 1A.5 | File generation: `template/dockerfile.ts`, `ci-workflow.ts`, `crucible-json.ts` — Handlebars rendering, SHA-256 checksums | 1A.4 | M | After 1A.4 | `crucible` | Generated files match snapshots. Checksum in `crucible.json` matches file hash. |
| 1A.6 | `crucible create` command — orchestrate clone, replacement, generation, `pnpm install`, rollback on failure | 1A.1-1A.5 | L | No | `crucible` | Creates working game. `pnpm build && pnpm test` pass. Partial failure rolls back. |
| 1A.7 | GitHub integration: `api/github.ts` — repo creation, Repository Rulesets, git init + push | 1A.6 | M | No | `crucible` | Repo created as `Volley-Inc/crucible-game-{name}`. Rulesets protect immutable files. |
| 1A.8 | Git operations: `git/operations.ts`, `validation.ts` — simple-git wrapper, pre-push checks | None | S | Yes | `crucible` | Can init, add, commit, push. Pre-push validates Dockerfile checksum. |

### Milestone 1B: AI Agent

| # | Work Item | Deps | Size | Parallel? | Repo | Acceptance Criteria |
|---|-----------|------|------|-----------|------|---------------------|
| 1B.1 | Context assembler: `agent/context.ts` — priority-based file loading, 180K token budget, VGF docs on-demand only | None | M | Yes | `crucible` | Context fits budget. VGF docs NOT loaded by default. |
| 1B.2 | File restriction enforcer: `agent/restrictions.ts` — deny-first pattern matching, audit log | None | S | Yes | `crucible` | Dockerfile/CI/lockfile writes blocked. `apps/server/src/**` writes allowed. |
| 1B.3 | Claude API client: `api/claude.ts` — `@anthropic-ai/sdk` wrapper, tool definitions (read_file, write_file, run_command, list_files) | None | M | Yes | `crucible` | Multi-turn conversation with tools works. |
| 1B.4 | Agent runner: `agent/runner.ts` — conversation loop, tool dispatch, restriction enforcement, auto-commit (agent-modified files only) | 1B.1-1B.3, 1A.8 | L | No | `crucible` | Agent reads/writes files with restrictions. Auto-commits only touched files. |
| 1B.5 | Session persistence: `agent/session.ts` — JSON sessions, `--resume`, 24hr expiry | 1B.4 | S | No | `crucible` | Sessions saved/loaded. `--resume` works. Expired sessions ignored. |
| 1B.6 | `crucible agent` command — full UX: session start, edit summary, Ctrl+C handling | 1B.4, 1B.5 | M | No | `crucible` | Interactive agent session works end-to-end. |
| 1B.7 | Bundle VGF docs: `context/BUILDING_TV_GAMES.md` | Existing file | S | Yes | `crucible` | File bundled in CLI package. Agent loads on demand. |

### Milestone 1C: Local Dev Server

| # | Work Item | Deps | Size | Parallel? | Repo | Acceptance Criteria |
|---|-----------|------|------|-----------|------|---------------------|
| 1C.1 | Port allocation: `dev/ports.ts` — availability check, auto-increment | None | S | Yes | `crucible` | Detects occupied ports. Assigns next available. |
| 1C.2 | Output multiplexer: `dev/output.ts` — colour-coded log prefixes | None | S | Yes | `crucible` | Three streams merged with distinct colours. |
| 1C.3 | Process orchestrator: `dev/orchestrator.ts` — 3 child processes, startup timeout, graceful shutdown | 1C.1, 1C.2 | M | No | `crucible` | All three processes start. Failure of one kills all. Ctrl+C graceful shutdown. |
| 1C.4 | `crucible dev` command | 1C.3 | S | No | `crucible` | `crucible dev scottish-trivia` starts server + display + controller. Health responds. |

### Milestone 1D: E2E Testing

| # | Work Item | Deps | Size | Parallel? | Repo | Acceptance Criteria |
|---|-----------|------|------|-----------|------|---------------------|
| 1D.1 | Platform E2E test harness — create temp game, verify parameterisation, start/stop dev | 1A.6, 1C.4 | M | No | `crucible` | `pnpm test:e2e` passes full lifecycle. |
| 1D.2 | Template snapshot tests — Dockerfile, CI workflow, crucible.json | 1A.5 | S | Yes | `crucible` | Snapshots detect breaking changes. |
| 1D.3 | Agent integration tests — mock Claude API (msw), verify file writes + restrictions | 1B.6 | M | No | `crucible` | Agent processes recorded conversation. Restrictions enforced. |

### Milestone 1E: hello-weekend Template Prep

| # | Work Item | Deps | Size | Parallel? | Repo | Acceptance Criteria |
|---|-----------|------|------|-----------|------|---------------------|
| 1E.1 | Add E2E test package: `apps/e2e/` with Playwright — display/controller/server tested together | None | M | Yes | `hello-weekend` | `pnpm --filter e2e test` passes. Covers lobby → playing → gameOver. |
| 1E.2 | Add `data-*` test attributes to display/controller components | None | S | Yes | `hello-weekend` | Playwright selectors work. No visual changes. |
| 1E.3 | Template tokenisation audit — verify all references are replaceable | None | S | Yes | `hello-weekend` | Manual search-replace produces working game. |

---

## Phase 2: Shared Infrastructure (Parallel with Phase 1)

### Milestone 2A: AWS Resources (Terraform)

| # | Work Item | Deps | Size | Parallel? | Repo | Acceptance Criteria |
|---|-----------|------|------|-----------|------|---------------------|
| 2A.1 | ECR repo: `crucible-games` + lifecycle policy | **HUMAN: AWS access** | S | Yes | `volley-infra` | Repo exists. Lifecycle active. |
| 2A.2 | S3 buckets: `crucible-clients-{dev,staging,prod}` — versioned | **HUMAN: AWS access** | S | Yes | `volley-infra` | Buckets exist. Versioning enabled. |
| 2A.3 | CloudFront distributions — DNS: `crucible-clients-{env}.volley.tv` | 2A.2, **HUMAN: DNS access** | M | No | `volley-infra` | CloudFront serves bundles. HTTPS works. |
| 2A.4 | `crucible-ci` IAM role — OIDC trust for `Volley-Inc/crucible-game-*` | **HUMAN: IAM admin + GitHub OIDC setup** | M | No | `volley-infra` | Role assumable from GitHub Actions on main. |
| 2A.5 | DynamoDB tables — catalog + versions, GSI, TTL, PITR | **HUMAN: AWS access** | S | Yes | `volley-infra` | Tables exist. TTL on `expiresAt`. PITR enabled. |
| 2A.6 | API Gateway + Lambda skeleton — routes, Function URL for `/metrics` | 2A.5 | M | No | `volley-infra` | Routes configured. Lambda deployed. Function URL with IAM auth. |

### Milestone 2B: Kubernetes Resources

| # | Work Item | Deps | Size | Parallel? | Repo | Acceptance Criteria |
|---|-----------|------|------|-----------|------|---------------------|
| 2B.1 | Namespaces: `crucible-{dev,staging,prod}` + PSS labels | **HUMAN: K8s admin** | S | Yes | `kubernetes` | Namespaces exist. Pod security enforced. |
| 2B.2 | RBAC — CI deployment perms + SSO user log access | 2B.1 | S | Yes | `kubernetes` | CI can deploy. Users can read logs. |
| 2B.3 | OPA/Gatekeeper — crucible-games ECR only in crucible-* namespaces | 2B.1 | S | Yes | `kubernetes` | Non-crucible images rejected. |
| 2B.4 | KEDA installation/verification | **HUMAN: verify KEDA** | S-M | Yes | `kubernetes` | ScaledObject CRD available. |
| 2B.5 | Cilium verification + CiliumNetworkPolicy | **HUMAN: verify Cilium**, 2B.1 | M | No | `kubernetes` | FQDN egress rules enforced. Pod isolation verified. |
| 2B.6 | Prometheus scrape config for crucible namespaces + Registry API | 2B.1, 2A.6 | S | Yes | `kubernetes` | Game pods + Registry API scraped. |
| 2B.7 | DNS: `crucible-games-{env}.volley-services.net` → ALB | **HUMAN: DNS access** | S | Yes | `volley-infra` | DNS resolves. ALB reachable. |

### Milestone 2C: Registry API Implementation

| # | Work Item | Deps | Size | Parallel? | Repo | Acceptance Criteria |
|---|-----------|------|------|-----------|------|---------------------|
| 2C.1 | `GET /games`, `GET /games/:gameId` — public, cached | 2A.5, 2A.6 | M | Yes | `crucible-registry` | Returns game list. CloudFront caches. |
| 2C.2 | `PUT /games/:gameId` — CI IAM auth, conditional write, 409 on conflict | 2C.1 | M | Yes | `crucible-registry` | Conditional write works. Concurrent → 409. |
| 2C.3 | `POST /games/:gameId/activate` — SSO auth, rate limit, DynamoDB lease | 2C.1 | M | Yes | `crucible-registry` | Lease created. Rate limited. Idempotent. |
| 2C.4 | `GET /games/:gameId/history` — SSO auth | 2C.1 | S | Yes | `crucible-registry` | Returns version history sorted descending. |
| 2C.5 | `DELETE /games/:gameId` — SSO admin, soft-delete | 2C.1 | S | Yes | `crucible-registry` | Game disabled. Hidden from GET /games. |
| 2C.6 | `/metrics` — Lambda Function URL, IAM auth, filter `expiresAt > NOW()` | 2C.3, 2A.6 | M | No | `crucible-registry` | Prometheus scrapes. Expired leases excluded. |
| 2C.7 | Registry API E2E tests | 2C.1-2C.6 | M | No | `crucible-registry` | Full CRUD tested. Race condition simulated. |

### Milestone 2D: Supporting Infrastructure

| # | Work Item | Deps | Size | Parallel? | Repo | Acceptance Criteria |
|---|-----------|------|------|-----------|------|---------------------|
| 2D.1 | Redis ACL Lambda — per-game users, key+channel prefix isolation | **HUMAN: Redis admin** | M | Yes | `volley-infra` | ACL created. Cross-game access denied. |
| 2D.2 | Alerting rules — PrometheusRule for all Crucible alerts | 2B.6 | S | Yes | `kubernetes` | Rules deployed. Fire on test thresholds. |
| 2D.3 | Datadog dashboard: Crucible Operations | 2B.6 | M | Yes | Datadog | Panels populate with test data. |

---

## Phase 3: Publish Pipeline

### Milestone 3A: CI Pipeline + Deploy Tool

| # | Work Item | Deps | Size | Parallel? | Repo | Acceptance Criteria |
|---|-----------|------|------|-----------|------|---------------------|
| 3A.1 | `@volley/crucible-deploy` scaffold — CLI tool for CI | Phase 2 complete | M | Yes | `crucible-deploy` | `npx crucible-deploy --help` works. |
| 3A.2 | `crucible-deploy apply` — render K8s templates, IRSA CloudFormation, kubectl apply --server-side, rollout wait | 3A.1 | XL | No | `crucible-deploy` | K8s resources created. IRSA stack on first deploy. |
| 3A.3 | K8s manifest templates — all 6 resource types, security context, probes | None | L | Yes | `crucible-deploy` | Templates render correctly. Security enforced. |
| 3A.4 | IRSA CloudFormation template — per-game IAM role | None | M | Yes | `crucible-deploy` | Stack creates role with scoped permissions. |
| 3A.5 | `crucible-deploy verify` — readiness poll, WebSocket handshake, registry consistency | 3A.2 | M | No | `crucible-deploy` | Detects healthy/unhealthy. Registry matches deployment. |
| 3A.6 | `crucible-deploy register` — PUT with IAM SigV4, retry on 409 | 3A.1, 2C.2 | M | No | `crucible-deploy` | Game registered. 409 retried. |
| 3A.7 | `crucible-deploy rollback` — query history, re-apply previous image | 3A.2, 3A.6 | M | No | `crucible-deploy` | Previous version deployed. Registry updated. |
| 3A.8 | GitHub Actions workflow template — full pipeline | 3A.1-3A.7 | L | No | `crucible` | Full pipeline <5min. Compensating rollback works. |

### Milestone 3B: CLI Publish + Ops Commands

| # | Work Item | Deps | Size | Parallel? | Repo | Acceptance Criteria |
|---|-----------|------|------|-----------|------|---------------------|
| 3B.1 | `crucible publish` — pre-flight, git push, poll CI by `head_sha`, real-time progress | 1A.1, 1A.8, Phase 2 | L | No | `crucible` | Push → poll → report. Correct run by SHA. |
| 3B.2 | `crucible login` — PKCE OIDC, ephemeral port, keytar, device code fallback | **HUMAN: SSO OIDC config** | L | Yes | `crucible` | Browser + device code flows work. Tokens in keychain. |
| 3B.3 | `crucible rollback` | 3B.1, 2C.4 | M | No | `crucible` | Triggers re-deploy of previous version. |
| 3B.4 | `crucible promote` | 3B.1 | M | No | `crucible` | Promotion works. Prod requires name confirmation. |
| 3B.5 | `crucible logs` — SSO-backed K8s API, colour by level | 3B.2 | M | No | `crucible` | Streams logs without separate kubectl setup. |
| 3B.6 | `crucible status` — Registry API + K8s API | 3B.2, 2C.1 | M | No | `crucible` | Status table with catalogStatus + healthStatus. |
| 3B.7 | `crucible list` — local games + publish status | 1A.2 | S | Yes | `crucible` | Lists games with status. |

### Milestone 3C: Safety + Resilience

| # | Work Item | Deps | Size | Parallel? | Repo | Acceptance Criteria |
|---|-----------|------|------|-----------|------|---------------------|
| 3C.1 | Crash-loop circuit breaker — CronJob detecting CrashLoopBackOff | 2B.1, 2C.2 | M | Yes | `kubernetes` | Crash-looping pods scaled to 0, marked unhealthy. |
| 3C.2 | CI checksum validation — Dockerfile SHA-256 vs crucible.json | 3A.8 | S | Yes | `crucible-deploy` | Modified Dockerfile fails CI. |
| 3C.3 | Publish pipeline E2E — full create → publish → verify → rollback | 3A.8, 3B.1 | L | No | `crucible` | Full flow passes in test env. <5min SLO. |

---

## Phase 4: Proto-Hub

| # | Work Item | Deps | Size | Parallel? | Repo | Acceptance Criteria |
|---|-----------|------|------|-----------|------|---------------------|
| 4.1 | Fork Hub → Proto-Hub — strip paywall/experiments/billing | **HUMAN: Hub repo access** | L | No | `proto-hub` | Clean fork. Builds and runs. |
| 4.2 | Replace `useGames.ts` — Registry API fetch, 15s poll | 4.1, 2C.1 | M | No | `proto-hub` | Games from Registry API. New games within 30s. |
| 4.3 | Game launch flow — activate → poll → iframe → WebSocket | 4.2, 2C.3 | L | No | `proto-hub` | Cold start → playable game. |
| 4.4 | QR code controller pairing — Platform SDK | 4.3 | M | No | `proto-hub` | Phone connects via QR scan. |
| 4.5 | SSO sign-in — `<SSOAuthProvider>`, author attribution | **HUMAN: SSO config** | M | No | `proto-hub` | Login works. Author on tiles. |
| 4.6 | TV UX compliance — 10-foot UI, D-pad, overscan | 4.2 | M | Yes | `proto-hub` | D-pad navigable. Focus visible. |
| 4.7 | Proto-Hub CI/CD + deployment — S3/CloudFront | 4.1 | M | Yes | `proto-hub` + `volley-infra` | Deploys on push to main. |
| 4.8 | Proto-Hub E2E — game list → launch → play | 4.3 | L | No | `proto-hub` | Full journey tested. Cold start <18s. |

---

## Phase 5: Template Management

| # | Work Item | Deps | Size | Repo | Acceptance Criteria |
|---|-----------|------|------|------|---------------------|
| 5.1 | `crucible update` — 3-way merge for template updates | Phase 3 | L | `crucible` | Updates template files. Game code untouched. |
| 5.2 | Automated template update PRs — scheduled GitHub Action | 5.1 | L | `hello-weekend` | PRs created on template change. Auto-merge if tests pass. |
| 5.3 | Template versioning — semver tags, `templateVersion` tracking | 5.1 | M | `hello-weekend` + `crucible` | Major bump blocks auto-update. |

---

## Phase 6: Desktop App

| # | Work Item | Deps | Size | Repo | Acceptance Criteria |
|---|-----------|------|------|------|---------------------|
| 6.1 | Electron scaffold — main process, renderer, IPC bridge | Phase 1 | L | `crucible-desktop` | App launches. IPC works. |
| 6.2 | Project manager dashboard — game cards, create, status | 6.1 | L | `crucible-desktop` | All games displayed. Status from Registry API. |
| 6.3 | Embedded agent chat — streaming conversation, file edits | 6.2 | XL | `crucible-desktop` | Chat with Claude. Edits shown inline. |
| 6.4 | Local preview — BrowserView for display + controller | 6.2 | M | `crucible-desktop` | Preview renders. Hot reload works. |
| 6.5 | Auto-update + code signing | 6.1, **HUMAN: certificates** | L | `crucible-desktop` | Updates automatically. No unsigned warnings. |

---

## Sprint Groupings

| Sprint | Weeks | Theme | Key Deliverables |
|--------|-------|-------|-----------------|
| **1** | 1-2 | Foundation | CLI scaffold, config, logger, template engine, port utils, hello-weekend E2E prep, start AWS provisioning |
| **2** | 3-4 | Create + Agent foundations | `crucible create`, agent context/restrictions/API client, `crucible dev`, K8s setup continues |
| **3** | 5-6 | Agent completion + Registry API | Full agent loop, E2E tests, Registry API all endpoints, Prometheus, Redis ACLs |
| **4** | 7-8 | Publish pipeline | `crucible-deploy` tool, CI workflow, `crucible login` |
| **5** | 9-10 | CLI ops + safety | publish/rollback/promote/logs/status, circuit breaker, publish E2E |
| **6** | 11-13 | Proto-Hub | Fork Hub, game list, launch flow, QR pairing, SSO, TV UX, deployment |
| **7+** | 14+ | Template mgmt + Desktop | `crucible update`, automated PRs, Electron app |

---

## Human Action Items (Block Progress)

| Action | Blocks | Sprint | Owner |
|--------|--------|--------|-------|
| AWS account access for Terraform | 2A.1-2A.6 | 1 | Infra team |
| GitHub OIDC provider setup for AWS | 2A.4, all Phase 3 | 2 | Infra team |
| K8s cluster admin access | 2B.1-2B.7 | 1 | Infra team |
| Verify Cilium CNI on EKS clusters | 2B.5 | 1 | Infra team |
| Verify KEDA on EKS clusters | 2B.4 | 1 | Infra team |
| DNS zone access (volley.tv, volley-services.net) | 2A.3, 2B.7 | 2 | Infra team |
| Volley SSO OIDC config for CLI | 3B.2, all auth'd commands | 4 | Auth team |
| Volley SSO OIDC config for Proto-Hub | 4.5 | 6 | Auth team |
| Hub repo access for Proto-Hub fork | 4.1 | 6 | Hub team |
| Redis admin access (ElastiCache) | 2D.1 | 3 | Infra team |
| Claude API key | 1B.3 | 2 | Engineering lead |
| Code signing certificates | 6.5 | 14+ | Engineering lead |
