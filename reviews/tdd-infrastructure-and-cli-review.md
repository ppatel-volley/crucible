# Documentation review: TDD Infrastructure & TDD CLI

**Review date:** 2026-03-25  
**Documents reviewed:**

- `docs/tdd-infrastructure.md` — *Crucible Infrastructure — Technical Design Document* (Draft v1.0)
- `docs/tdd-cli.md` — *Crucible CLI — Technical Design Document* (Draft v1.0)

**Reviewer note:** Review performed against the copies in this repository under `docs/`.

---

## Executive summary

Both documents are unusually complete for drafts: clear structure, actionable decisions, and strong cross-referencing between product (CLI), platform (registry, CI, K8s), and security. The main gaps are **a few contract mismatches** between the two TDDs, **some UX/spec contradictions** inside the CLI doc, and **places where operational detail is assumed** (Cilium, org casing, health URL paths). Resolving the high-severity inconsistencies before implementation will prevent split-brain between the Registry API, Proto-Hub, and `@volley/crucible`.

---

## Strengths (both documents)

1. **Decision traceability** — Infrastructure TDD’s decision log, risk register, and phased plan make tradeoffs auditable; CLI TDD mirrors repo-auto-create and OIDC constraints with rationale.
2. **Scale-to-zero narrative** — End-to-end flow (activate → metrics → KEDA → readiness) is coherent; TTL lag is called out repeatedly where it matters.
3. **Security layering** — IRSA per game, Redis ACLs, OPA/Gatekeeper, deny/allow lists for the agent, and NPM token handling are aligned conceptually across docs.
4. **Operational realism** — ALB rule limits, crash-loop breaker as an explicit phase item, and compensating rollback in CI match how these systems fail in production.
5. **Test strategy** — Separation of platform E2E, template Playwright flows, and infra conformance tests is sensible.

---

## Critical issues (resolve before build)

### 1. Registry API: `GET /games` auth model disagrees

| Source | Stated auth |
|--------|-------------|
| Infrastructure §2.3 | **Public** (CloudFront cached 15s) |
| CLI §12.3 | **SSO JWT** for `GET /games` |

**Impact:** Proto-Hub and any public tile grid expect anonymous or edge-cached listing; the CLI client and error handling assume a bearer token. Implementers will ship incompatible clients.

**Recommendation:** Pick one model. If listing is public, update CLI §12.3 and `RegistryClient.listGames()` to document optional auth or no auth. If listing requires JWT, update infra §2.3–2.4 and CloudFront behavior (no public cache without a separate edge-signed or split endpoint).

### 2. E2E in CI: server bootstrap vs quality-gate snippet

- **Infrastructure §11.1** shows starting the VGF server in the background, then running Playwright.
- **CLI §10.2** shows a `crucible-deploy.yml` fragment with only `pnpm --filter e2e test` (no server start).

**Impact:** Copy-paste from the CLI doc could produce a flaky or always-failing quality gate.

**Recommendation:** Make one snippet canonical (preferably in one doc, linked from the other) and state whether Playwright fixtures start the server internally.

### 3. Health check path in CLI platform E2E vs infrastructure

- **Infrastructure** standardizes readiness/liveness on `GET /{gameId}/health/ready` and `GET /{gameId}/health`.
- **CLI §10.1** uses `fetch(.../${session.ports.server}/health)` (no `gameId` prefix).

**Impact:** Template or dev server might expose `/health` while deployed pods use prefixed paths; E2E could pass locally and miss production routing bugs.

**Recommendation:** Align the example URL with the template’s actual dev and prod paths, or explicitly document both.

---

## High-priority issues

### 4. GitHub org casing: `Volley-Inc` vs `volley-inc`

Infrastructure OIDC trust policy uses `repo:Volley-Inc/crucible-game-*`. CLI examples and `CrucibleConfig.githubOrg` use `"volley-inc"`. GitHub is usually case-insensitive for org names, but **IAM trust policy strings are not**.

**Recommendation:** State the canonical exact string for OIDC `sub` / claim matching and mirror it everywhere (docs, Terraform, examples).

### 5. CLI UX contradicts agent context policy

- **§3.2** states `BUILDING_TV_GAMES.md` is **not loaded by default**.
- **§3.6** session-start mock shows `Loading VGF docs + patterns... done (0.8s)`, which implies VGF docs load every session.

**Recommendation:** Change the mock output to match the lazy-load policy (e.g. “Skipping bundled VGF reference (load on demand)”).

### 6. `crucible publish` preflight vs sample output

- **§5.2** requires a **clean** working tree.
- **§9.2** sample shows `✓ Working tree is clean (3 commits ahead of origin)` — “clean” in Git usually means no unstaged/uncommitted changes, but “ahead of origin” often confuses users; if unpushed commits are allowed, say **“no uncommitted changes”** instead of “clean,” and clarify that unpushed commits are OK before push.

### 7. `GameListEntry.status` vs registry “active” games

CLI §12.1 lists `status: "healthy" | "unhealthy" | "deploying"` for list entries. Infrastructure catalog entities use **game** `status` (e.g. active/disabled) separate from **deploy** health.

**Recommendation:** Separate **catalog visibility/status** from **runtime health** in the TypeScript interfaces or document the mapping explicitly.

### 8. Confidence score `0.97` on both drafts

Reads as over-precision for documents that still say “Draft v1.0” and list open operational dependencies (Cilium, SSO config, template stabilization).

**Recommendation:** Either remove numeric confidence or tie it to explicit verification criteria (e.g. “post–Phase 2 review”).

---

## Medium-priority issues

### 9. Image tag format: single string, two presentations

Infrastructure gives `tag: {gameId}-{sha}-{runNumber}` in CI narrative and a version SK pattern `"{runNumber:08d}-{commitSha7}"` in DynamoDB. Consistent but easy to misread.

**Recommendation:** One boxed “canonical tag format” in the infrastructure doc with an example string tying ECR tag ↔ registry version field.

### 10. KEDA multi-trigger semantics

Stating KEDA uses the **maximum** desired replica count across triggers is valuable; link to KEDA version docs or note version pin, since behavior should be confirmed for your KEDA minor version.

### 11. `crucible rollback` / `workflow_dispatch`

CLI describes triggering rollback via `workflow_dispatch`. Infrastructure emphasizes generated workflow owned by template. Ensure the workflow file defines the dispatch inputs and idempotency expectations; the CLI TDD could reference the exact workflow name/inputs to avoid drift.

### 12. Registry client `checkHealth`

`RegistryClient.checkHealth(gameId, env)` is not mapped to a single infra endpoint (which uses per-game HTTP health and separate registry metadata). Document whether this is `GET /games/:id` only, or an HTTP probe to `endpoints.server`.

### 13. Desktop app / Phase 6

Infrastructure §8.3 and CLI §1.2 mention Phase 6 desktop; dependency matrix in infrastructure shows Phase 6 after Phase 1 only. Fine for a roadmap, but **Electron + in-process server** should be flagged for security review (same process as agent/network stack).

### 14. Cost model

Ranges are useful; label clearly as **estimates** and list assumptions (concurrent pods, ALB count, Redis sizing). Helps when finance or FinOps challenges the numbers.

---

## Low-priority / polish

1. **Table of contents anchors** — Verify all heading anchors render correctly in your doc viewer (spaces, parentheses).
2. **Terminology** — “WGFServer” vs “VGF” vs “Volley Games Framework” appears in both docs; a one-line disambiguation in each glossary reduces onboarding friction.
3. **Manual rollback runbook** — DynamoDB `update-item` example is truncated with `...`; either complete it or point to a script in-repo.
4. **File path restriction ruleset** — Confirm GitHub’s ruleset API supports exactly the paths you need for `pnpm-lock.yaml` at repo root vs nested paths.

---

## Consistency checklist (post-fix)

| Topic | Infrastructure | CLI | Aligned? |
|-------|----------------|-----|----------|
| Auto-created repos `crucible-game-*` | ✓ | ✓ | Yes |
| No `--repo` v1 | ✓ DL-005 | ✓ §2.5 | Yes |
| OIDC / IAM trust | ✓ §3.2 | Implied §2.5 | Verify org casing |
| Dockerfile checksum / CI ownership | ✓ | ✓ | Yes |
| Registry PUT (CI SigV4) | ✓ | (not CLI’s path) | OK |
| `GET /games` auth | Public | JWT | **No — fix** |
| E2E CI steps | Server + e2e | e2e only snippet | **No — fix** |
| Health URL path | `/{gameId}/health...` | `/health` in example | **No — fix** |

---

## Suggested next steps

1. Hold a **short API contract review** (Registry: public list vs auth, list response shape, health fields).
2. Normalize **CI snippets** between §11.1 (infra) and §10.2 (CLI).
3. Add a **single “Source of truth”** note at the top of each doc: e.g. OpenAPI or `packages/registry-client` when it exists.
4. Re-run this review after edits; update the checklist table to green.

---

*End of review.*
