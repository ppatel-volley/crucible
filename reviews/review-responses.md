# TDD Review Responses

**Date:** 2026-03-25
**Responding to:** All 4 review documents

---

## Critical Issues — All Resolved

### 1. `GET /games` auth model disagreement
**Reviews:** #1 (Critical §1), #2 (Critical §1), #3 (§3.1 implied)
**Resolution:** `GET /games` and `GET /games/:gameId` are now **public** (no auth, CloudFront cached 15s) in BOTH documents. The CLI `RegistryClient` interface and infra endpoint table are aligned. Proto-Hub fetches anonymously; SSO JWT is only required for mutations (`PUT`, `DELETE`, `POST /activate`) and history (`GET /history`).

### 2. Status vocabulary mismatch
**Reviews:** #1 (High §7), #2 (Critical §2)
**Resolution:** Introduced a canonical two-dimensional status model in the infra TDD: `catalogStatus` (active/disabled — visibility) and `healthStatus` (healthy/unhealthy/deploying — runtime). Updated CLI `GameListEntry` and `GameRecord` interfaces to use both fields. Version status remains: active/rolled-back/superseded.

### 3. Lease expiration field (`ttl` vs `expiresAt`)
**Reviews:** #2 (Critical §3), #4 (Critical C1)
**Resolution:** Standardised on `expiresAt` (Unix epoch seconds) as the canonical attribute name. DynamoDB TTL is configured on this same field. Updated table schema, metrics query examples, and all references. Every mention now uses `expiresAt`, not `ttl`.

### 4. CI run tracking can attach to wrong run
**Reviews:** #2 (Critical §4)
**Resolution:** CLI now filters by `head_sha` AND `workflow_id` when polling GitHub Actions API, not just "latest run on main". Added code example showing exact `head_sha` correlation.

---

## High Issues — All Resolved

### 5. Org casing (`Volley-Inc` vs `volley-inc`)
**Reviews:** #1 (High §4), #2 (High §8), #4 (Critical C3)
**Resolution:** Added canonical org name note: **`Volley-Inc`** (capital V, capital I) is the exact string used in IAM trust policies. Added to both TDDs with a warning that IAM string comparisons are case-sensitive.

### 6. Health path inconsistency
**Reviews:** #1 (Critical §3)
**Resolution:** Fixed CLI E2E test to use `/{gameId}/health` (matching production path). Added note that local dev uses the same path-prefixed health endpoint as production.

### 7. Agent auto-commit too broad (`git add .`)
**Reviews:** #2 (High §9)
**Resolution:** Agent now stages only files it modified during the current batch, not `git add .`. Updated CLI TDD §3.4 with explicit file-tracking approach.

### 8. `crucible logs` kubectl auth for non-engineers
**Reviews:** #2 (High §7)
**Resolution:** CLI authenticates to K8s API using the same Volley SSO OIDC token from `crucible login`. K8s RBAC grants `pods/log` read access in `crucible-*` namespaces to SSO-authenticated users. Non-engineers do NOT need separate kubectl setup. Added fallback to CloudWatch/Datadog for scale-to-zero pods.

### 9. VGF docs loading UX contradicts policy
**Reviews:** #1 (High §5)
**Resolution:** Removed "Loading VGF docs + patterns..." from the session start mock output. Added explicit note that `BUILDING_TV_GAMES.md` is NOT loaded at session start.

### 10. Replica counts in CLI but not in DynamoDB
**Reviews:** #3 (§3.1)
**Resolution:** Removed `replicas` from the `GameRecord.environments` interface. Added note: replica counts are fetched from K8s API directly (via kubectl, using SSO auth) when available, omitted when the user lacks cluster access. Not stored in DynamoDB.

### 11. `pnpm-workspace.yaml` missing from GitHub Rulesets
**Reviews:** #3 (§3.3)
**Resolution:** Added `pnpm-workspace.yaml` to the `restricted_file_paths` array in both the Rulesets code example and the agent's DENIED_PATTERNS list.

### 12. `git push main` = deploy (intentional?)
**Reviews:** #3 (§3.4)
**Resolution:** Added explicit documentation: this is intentional. CI triggers on push to main. `crucible publish` is a convenience wrapper. Developers who want to back up work without deploying should use feature branches.

### 13. Redis ACL too broad
**Reviews:** #4 (High H3)
**Resolution:** Replaced `+@all -@admin -@dangerous` with an explicit command allowlist covering exactly what WGF + Socket.IO adapter need: key ops, pub/sub, hash/set/sorted-set, introspection. No blanket `+@all`.

### 14. `/metrics` security model
**Reviews:** #4 (High H1)
**Resolution:** `/metrics` is now served via a **separate Lambda Function URL** with `AuthType: AWS_IAM`, not through the public API Gateway. Only Prometheus (via IRSA) can invoke it. Added to infra TDD.

### 15. Login callback fixed port
**Reviews:** #2 (Medium §10)
**Resolution:** Changed from fixed port 9876 to ephemeral port (`127.0.0.1:0`). OS assigns available port, included dynamically in OIDC redirect URI.

### 16. Freshness SLO math
**Reviews:** #4 (Critical C2)
**Resolution:** Fixed Proto-Hub polling interval from 30s to 15s (matching CloudFront TTL). Documented worst-case: 30s (CloudFront 15s + poll 15s). P95 estimate: ~20s. Meets <30s SLO.

---

## Medium Issues — Addressed

### E2E timeout / test layering (#2 §13)
Acknowledged. The 120s timeout is for the local-only portion (create + dev). Publish E2E with real CI runs in a separate test suite with 10-minute timeout.

### Template scan file types (#2 §15)
Fixed. Snapshot test now scans `*.{ts,tsx,json,yaml,yml,md,sh}`, not just `ts/tsx/json`.

### Rollback runbook priority (#3 §3.5)
Fixed. Infra TDD now lists CI-driven rollback as primary, GitHub Action trigger as secondary, and kubectl direct as emergency break-glass only.

### Cold-start budget math (#4 M1)
Acknowledged. The 15s is a target, not a guarantee. The infra TDD's architecture doc already provides best/worst breakdown. Added P95/P99 guidance to the fast-path option.

### Cost model assumptions (#4 M5)
Acknowledged. Numbers are labelled as estimates. Adding explicit assumption tables is a good follow-up but lower priority than contract alignment.

### Build sandbox control classification (#4 H4)
Acknowledged. Reclassified: GitHub Rulesets and CI checksum validation are **hard controls**; CLAUDE.md agent rules are **soft controls** (advisory). Updated risk register R1 description.

---

## Low Issues — Noted for Future

- Table of contents anchors: will verify on final publish
- Glossary terminology (WGF/VGF): both TDDs have glossaries, will unify naming
- Manual rollback DynamoDB snippet: completed (was truncated)
- TV font minimum: 18px is design token minimum, 24px is Proto-Hub UI minimum (context-dependent)
- Decision/risk ownership: will add `owner` and `review date` columns in next revision

---

## Summary

All 4 critical issues and 12 high-priority issues resolved with concrete edits to both TDDs. Medium and low issues acknowledged with fixes applied where straightforward, noted for follow-up where they require broader discussion.
