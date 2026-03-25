# Deep Review: `tdd-infrastructure.md` and `tdd-cli.md`

Date: 2026-03-25  
Reviewer: AI coding agent (deep design + contract consistency pass)

## Scope and method

- Reviewed both documents end-to-end for architecture quality, operational realism, security posture, API-contract consistency, and testability.
- Focused on defects that could cause implementation drift, deployment failures, security gaps, or hard-to-debug runtime behavior.
- Prioritized findings by severity and included concrete remediation guidance.

## Findings (ordered by severity)

### Critical

1. **Registry auth contract conflict for `GET /games`**
   - `docs/tdd-infrastructure.md` defines `GET /games` as **Public (CloudFront cached 15s)**.
   - `docs/tdd-cli.md` defines list games as requiring **SSO JWT** in API contracts.
   - Impact: client implementations, cache behavior, and security controls will diverge immediately.
   - Fix: choose one canonical auth model and update both docs + examples + SDK interfaces together.

2. **Status vocabulary mismatch across documents**
   - Infrastructure uses catalog/status terms such as `active` and `disabled`; versions also use `active`.
   - CLI API contracts and UX use `healthy | unhealthy | deploying | not-deployed | rolled-back`.
   - Impact: broken filtering, invalid enum handling, inconsistent rollback semantics, and brittle dashboards.
   - Fix: define one canonical status model (catalog status vs deployment health status as separate fields), then map explicitly in both docs.

3. **Lease expiration attribute is internally inconsistent (`ttl` vs `expiresAt`)**
   - Infrastructure table schema describes lease attribute as `ttl`.
   - Metrics logic and risk mitigations repeatedly require filtering by `expiresAt > now`.
   - Impact: KEDA may scale on stale leases or fail to scale when expected, depending on implementation choice.
   - Fix: standardize one attribute name and type (recommend `expiresAtEpochSeconds` for query logic + optional TTL mirror field if needed by DynamoDB TTL).

4. **`crucible publish` run-tracking can attach to the wrong workflow run**
   - CLI contract polls `/actions/runs?branch=main&per_page=1`.
   - Under concurrent pushes, this can return another user’s run.
   - Impact: false success/failure reporting, wrong URLs, and unsafe automation.
   - Fix: track by `head_sha` and workflow ID, then follow that exact run ID.

### High

5. **Cold-start SLO claim is under-specified against real-world variability**
   - Infrastructure asserts ~15s scale-from-zero and a 15s target SLO while relying on scrape + KEDA + scheduling + ALB registration.
   - No explicit P95/P99 SLO, no fallback when image is uncached, and no cluster-pressure assumptions.
   - Impact: repeated user-visible launch delays without clear acceptance criteria.
   - Fix: define SLO as percentile-based (`P95 <= X`, `P99 <= Y`) per environment, include uncached-image scenario and rollout guardrails.

6. **Lambda `/metrics` at 5s scrape interval is operationally fragile**
   - Infrastructure suggests Prometheus scrapes API Gateway/Lambda directly at 5s and treats cold starts as acceptable.
   - This creates unnecessary invocation churn and potential scrape jitter/failures.
   - Impact: noisy autoscaling signal, increased operational complexity, and hidden costs.
   - Fix: move activation metrics to a pull-friendly in-cluster exporter or increase scrape interval with explicit latency trade-off validation.

7. **`crucible logs` assumes `kubectl` access but auth model is not defined**
   - CLI says logs command uses `kubectl logs`.
   - No contract for how non-engineer users obtain cluster credentials/contexts securely.
   - Impact: command fails for target users; support burden rises.
   - Fix: define one of: (a) server-side logs API, (b) SSO-mediated proxy, or (c) explicit kubeconfig bootstrap flow with RBAC boundaries.

8. **OIDC/GitHub org naming is inconsistent (`Volley-Inc` vs `volley-inc`)**
   - Appears in trust policy conditions and API endpoint examples with mixed casing.
   - GitHub may tolerate case, but policy-string conditions and tooling comparisons can be case-sensitive depending on implementation.
   - Impact: trust-policy mismatches and hard-to-diagnose auth failures.
   - Fix: normalize to one canonical org string everywhere and add tests for subject-claim matching.

9. **Agent auto-commit strategy is too broad (`git add .`)**
   - CLI agent section auto-commits with `git add .`.
   - This may capture unrelated local edits or generated artifacts.
   - Impact: accidental commits, polluted history, and rollback pain.
   - Fix: stage only files changed by the agent tool session and skip empty commits safely.

### Medium

10. **`crucible login` callback uses fixed port `9876` with no fallback strategy**
    - Fixed localhost callback is prone to collision.
    - Impact: flaky login on developer machines and CI-like shared environments.
    - Fix: bind an ephemeral available port, include it in PKCE redirect, and show deterministic recovery text.

11. **Cross-platform pathing guidance conflicts with stated XDG intent**
    - CLI config path uses `%APPDATA%` for both config and data.
    - This mixes roaming config and potentially large local session data.
    - Impact: profile bloat, sync issues, and policy non-compliance on managed Windows environments.
    - Fix: use `%APPDATA%` for config and `%LOCALAPPDATA%` for data/session storage.

12. **Rollback and promote concurrency behavior is under-defined**
    - Retries on conditional write conflicts are noted, but no idempotency key or user-visible conflict surface is specified.
    - Impact: unclear operator outcomes during simultaneous release operations.
    - Fix: add idempotency tokens + conflict reason messaging + audit trail fields (`requestedBy`, `requestId`).

13. **E2E timeout example for full lifecycle appears unrealistic**
    - CLI E2E sample uses `timeout: 120_000` for create -> dev -> publish -> rollback.
    - Publish alone in docs can take minutes with external dependencies.
    - Impact: flaky tests and false negatives.
    - Fix: split by layer (unit/integration/e2e-live) and set environment-appropriate time budgets.

14. **`crucible create` rollback language includes shell-centric `rm -rf` semantics**
    - Documented rollback table uses Unix shell behavior.
    - Impact: ambiguity for Windows-first implementation.
    - Fix: specify implementation-agnostic filesystem operations (`fs.rm(path, { recursive: true, force: true })`).

15. **Template replacement verification excludes some file classes**
    - Tests only scan `ts/tsx/json` in examples for leftover template tokens.
    - Impact: drift can persist in YAML, Markdown, shell scripts, workflow files.
    - Fix: include a broader scan allowlist or explicit denylist exceptions.

### Low

16. **Inconsistent TV minimum font references**
    - Infrastructure lists both 24px (Proto-Hub constraints) and 18px (design-system TV token) as minimums.
    - Impact: design implementation confusion.
    - Fix: clarify context (navigation UI vs in-game UI) or unify a single minimum with exceptions.

17. **Decision and risk sections are strong but miss explicit ownership metadata**
    - Risks/decisions lack named owners and target dates.
    - Impact: mitigations may stall.
    - Fix: add `owner`, `due`, and `review cadence` columns.

18. **Some “critical” wording is used without linked verification tests**
    - Example: TTL filtering warning is strong, but test case references are not tied to concrete test IDs.
    - Impact: high-risk requirements may be forgotten in implementation.
    - Fix: add “verification hook” links for each critical requirement.

## Cross-doc contract alignment checklist (recommended immediate action)

1. Finalize Registry auth matrix and publish one source of truth.
2. Finalize status model schema (catalog, deploy health, version lifecycle) and update both docs.
3. Finalize lease schema (`expiresAt` and TTL strategy) and update metrics examples.
4. Lock CI run correlation method (`head_sha` + workflow ID).
5. Define logs access architecture for non-engineer users.

## What is already strong

- Strong decomposition of infra phases and explicit decision logging.
- Good emphasis on defense-in-depth for immutable build surfaces.
- Practical risk register with concrete failure modes.
- Clear CLI UX patterns and error taxonomy direction.

## Final assessment

The architecture direction is promising and implementation-ready in many areas, but **cross-document contract mismatches (auth, status, lease schema, CI run tracking) must be resolved before build-out**. If uncorrected, these will produce immediate integration failures and operational ambiguity despite otherwise solid design intent.
