# Deep Review: `tdd-infrastructure.md` and `tdd-cli.md`

Date: 2026-03-25  
Reviewer: AI code/doc reviewer

## Review Scope

- Reviewed in depth: `docs/tdd-infrastructure.md`
- Attempted but blocked: `docs/tdd-cli.md` (file not found in current worktree context)

---

## Blocker

### B1 — `tdd-cli.md` not accessible in current workspace
- **Severity:** Blocker
- **Impact:** Full dual-document review cannot be completed yet.
- **Evidence:** Multiple direct reads of `docs/tdd-cli.md` and common variants returned "File not found".
- **Recommendation:** Ensure `docs/tdd-cli.md` exists in this worktree (or provide the correct path/name), then re-run the same review process for CLI doc parity.

---

## Findings: `docs/tdd-infrastructure.md`

## Critical

### C1 — Lease expiration field is inconsistent (`ttl` vs `expiresAt`)
- **Severity:** Critical
- **Why it matters:** KEDA scaling correctness depends on expiration filtering. Inconsistent attribute names can cause stale activations, false scale-ups, and noisy metrics.
- **Evidence:**
  - DynamoDB lease schema uses `ttl` for expiration.
  - Metrics guidance and risk mitigation require filtering on `expiresAt > NOW()`.
- **Recommendation:** Standardize on one expiration attribute (prefer `expiresAtEpochSec` + DynamoDB TTL on the same field), and update every section (table schema, metrics logic, risk register, tests) to match.

### C2 — Freshness SLO is internally contradictory (cache + polling cadence)
- **Severity:** Critical
- **Why it matters:** The document claims sub-30s freshness while another section implies worst-case >30s visibility for newly published games.
- **Evidence:**
  - CloudFront cache TTL for `GET /games`: default 15s, max 30s.
  - Proto-Hub polling interval: every 30s.
  - Text claim: "new games appear within 15s of publish."
- **Recommendation:** Reconcile SLO math explicitly. If polling stays at 30s, state realistic worst-case and P95. If strict <30s is required, reduce poll interval and/or move to push invalidation.

### C3 — OIDC trust subject and org casing/pattern assumptions are brittle
- **Severity:** Critical
- **Why it matters:** A subtle mismatch in GitHub OIDC `sub` claim pattern can block all deploys or unintentionally broaden trust.
- **Evidence:**
  - Trust policy example references `repo:Volley-Inc/crucible-game-*:ref:refs/heads/main`.
  - Decision log uses `volley-inc/crucible-game-{name}` convention.
- **Recommendation:** Document exact `sub` and `aud` claim matching with tested examples from a live token; include case-normalization assumptions and explicit deny defaults.

## High

### H1 — `/metrics` endpoint exposure model is under-specified for security
- **Severity:** High
- **Why it matters:** The doc says `/metrics` is "Internal" but also says API Gateway serves it and Prometheus scrapes it directly. Without a clear control plane, metrics may become publicly reachable.
- **Recommendation:** Specify one hardened path:
  - private API Gateway + VPC link + Prometheus in VPC, or
  - authenticated scrape with signed requests, or
  - in-cluster metrics endpoint not exposed through public API Gateway.

### H2 — NetworkPolicy source assumptions for ALB ingress are incomplete
- **Severity:** High
- **Why it matters:** Kubernetes `NetworkPolicy` cannot reliably identify ALB as a source entity; traffic may appear from node/pod IPs depending on dataplane mode.
- **Recommendation:** Document tested implementation details (CNI mode, source IP behavior, required selectors/CIDRs) and include conformance tests that prove ingress is neither over-open nor broken.

### H3 — Redis ACL privileges are too broad (`+@all -@admin -@dangerous`)
- **Severity:** High
- **Why it matters:** Broad command classes increase blast radius and accidental misuse risk.
- **Recommendation:** Move to explicit allowlist (`+get +set +del +exists +publish +subscribe ...`) required by Socket.IO adapter and game runtime, then enforce via tests.

### H4 — Build sandbox "three independent controls" overstates enforcement quality
- **Severity:** High
- **Why it matters:** `CLAUDE.md` guidance is advisory and not equivalent to hard enforcement. This creates false confidence in supply-chain safeguards.
- **Recommendation:** Reclassify controls by strength:
  - hard controls: GitHub rulesets, CI checksum/signature verification
  - soft controls: agent guidance
  Add attestation/SLSA-style provenance if feasible.

### H5 — Rollback runbook query can miss valid tags
- **Severity:** High
- **Why it matters:** `imageTags[0]` assumption is fragile when ECR image details include multiple tags or null ordering assumptions.
- **Recommendation:** Query all tags robustly and filter by prefix across full tag arrays; include a tested command snippet.

## Medium

### M1 — Cold-start budget math is optimistic/internally inconsistent
- **Severity:** Medium
- **Why it matters:** Planning and SLOs depend on credible envelope estimates.
- **Evidence:** Listed phase ranges sum to ~14-19s, while stated total is "~15s".
- **Recommendation:** Provide best/median/worst envelope and identify which components are controllable (scrape interval, image pre-pull, fast-path patching).

### M2 — "Fast-path" scaler bypass introduces control-plane duality without safeguards
- **Severity:** Medium
- **Why it matters:** Having both KEDA and direct deployment patching can cause race/oscillation unless ownership rules are explicit.
- **Recommendation:** Define source-of-truth priority, conflict handling, and cooldown rules; add a sequence diagram and failure-mode tests.

### M3 — CI E2E snippet is shell-sensitive and may be brittle
- **Severity:** Medium
- **Why it matters:** Background process handling with `%1` depends on shell semantics and can leak processes on failure.
- **Recommendation:** Use explicit process capture/trap cleanup pattern, and document required runner shell.

### M4 — Admission policy references are conceptual, not operationally specific
- **Severity:** Medium
- **Why it matters:** "Only crucible-games ECR images allowed" is good, but no concrete constraint template, namespace selector, or exception model is provided.
- **Recommendation:** Include exact Gatekeeper constraint strategy and exemption process for ops tooling.

### M5 — Cost model lacks unit assumptions and sensitivity bounds
- **Severity:** Medium
- **Why it matters:** Numbers are difficult to trust/reproduce without traffic, storage churn, and concurrency assumptions.
- **Recommendation:** Add explicit assumption table (requests/day, GB egress, image churn, concurrent active games), then provide low/base/high scenarios.

### M6 — Drift risk between decision log and phased plan not explicitly governed
- **Severity:** Medium
- **Why it matters:** Several "review when count > X" thresholds exist, but no owner or periodic review cadence is defined.
- **Recommendation:** Add governance fields per decision (owner, next review date, objective trigger metric, rollback option).

## Low

### L1 — Terminology inconsistency: "Proto-Hub" / "Hub" / "Hub v2"
- **Severity:** Low
- **Why it matters:** Ambiguous naming increases onboarding friction.
- **Recommendation:** Add a short glossary and canonical naming conventions at the top.

### L2 — Some "MUST" statements lack linked acceptance tests
- **Severity:** Low
- **Why it matters:** Strong normative language without test linkage can decay into non-enforced guidance.
- **Recommendation:** Add "Verification" bullets next to each MUST with test location or CI check ID.

---

## Overall Assessment

`tdd-infrastructure.md` is strong in breadth and architecture coverage, but several cross-section inconsistencies and security/operational ambiguities materially affect deploy safety and SLO confidence. The highest-priority fixes are schema field unification for activation expiration, freshness SLO reconciliation, and precise OIDC trust-policy specification. Once `tdd-cli.md` is made available, perform a consistency cross-check against this doc to eliminate behavioral drift between CLI behavior and infrastructure assumptions.

## Suggested Next Pass (after unblocking CLI doc)

1. Cross-map every CLI command behavior against this TDD's CI/deploy assumptions.
2. Validate rollback semantics (`register`, `verify`, compensating rollback) are identical between docs.
3. Build a "contract matrix" (CLI flag/command ↔ infra capability ↔ test coverage) and track unresolved mismatches.
