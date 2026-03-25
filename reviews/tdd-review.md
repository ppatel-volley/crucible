# Crucible TDD Deep Review: Infrastructure & CLI

**Date:** 2026-03-25
**Review Target:** `docs/tdd-infrastructure.md` & `docs/tdd-cli.md`

## 1. Executive Summary

This review analyses the alignment, completeness, and potential friction points between the Crucible Infrastructure TDD and the Crucible CLI TDD. Overall, both documents present a highly cohesive architecture with a strong separation of concerns. The decision to use a CI-driven GitOps model (diverging from the legacy Flux GitOps) combined with OIDC federation is robust and scales well for the multi-game model. The AI agent's file restrictions align well with the infrastructure's security posture. 

However, there are a few discrepancies in API contracts (such as K8s replica reporting), routing abstractions, and deployment triggers that require alignment before implementation.

---

## 2. Strong Architectural Alignments

- **OIDC & IAM Federation:** The security model is exceptionally well-aligned. The CLI auto-creates GitHub repositories with a strict naming convention (`crucible-game-{gameId}`), which perfectly maps to the Infrastructure's `crucible-ci` OIDC trust policy (`repo:Volley-Inc/crucible-game-*:ref:refs/heads/main`).
- **File Immutability & Sandboxing:** The CLI protects core deployment files (`Dockerfile`, `.github/workflows/**`, `pnpm-lock.yaml`, `.npmrc`) via GitHub Repository Rulesets immediately upon creation. This acts as the first line of defence, complementing the Agent's file restriction enforcer and the Infrastructure's checksum validation.
- **Rollback Consistency:** Both systems agree on the use of DynamoDB conditional writes to prevent race conditions during updates and promotions. 

---

## 3. Identified Gaps & Inconsistencies

### 3.1. Registry API Contract vs. Infrastructure Capabilities
- **Issue:** In the CLI TDD (Section 12.1), the expected `RegistryClient` API contract for a game includes real-time Kubernetes metrics: `replicas: { ready: number; desired: number }`. 
- **Gap:** The Infrastructure TDD (Section 2.2) defines the DynamoDB schema for the Registry API, which only stores static/event-driven data (`status`, `endpoints`, `imageTag`). It does not detail any mechanism for the Lambda-based Registry API to fetch real-time `replica` counts from the Kubernetes API. Giving the Registry Lambda direct network and RBAC access to the EKS control plane would add latency and complexity.
- **Recommendation:** Either remove real-time replica counts from the `crucible status` CLI command, or introduce a mechanism (e.g., a lightweight K8s controller or CronJob) that periodically syncs K8s deployment statuses back to DynamoDB.

### 3.2. Local Dev vs. Production Routing 
- **Issue:** The CLI orchestrates local development (Section 4) by spinning up the VGF Server, Display, and Controller on distinct local ports (`8090`, `3000`, `5174`). Conversely, the Infrastructure locks in path-based routing (Section 14: DL-003) via `/{gameId}/socket.io` and single-host setups.
- **Gap:** This means the game template (`hello-weekend`) must have an abstracted networking layer that seamlessly switches between port-based routing (locally) and path-based routing (in production).
- **Recommendation:** Explicitly document in both TDDs (or the template TDD) how `vite.config.ts` and the Socket.IO client configure their `base` and `path` properties based on an environment variable (e.g., `STAGE=local` vs `STAGE=prod`). 

### 3.3. GitHub Repository Ruleset Scope
- **Issue:** The CLI applies GitHub Rulesets to `pnpm-lock.yaml` (Section 2.5), but the CLI's internal Agent restriction enforcer (Section 3.3) also restricts `pnpm-workspace.yaml`. 
- **Gap:** `pnpm-workspace.yaml` is not currently protected by the GitHub Ruleset. 
- **Recommendation:** Update CLI TDD Section 2.5 to include `pnpm-workspace.yaml` in the `restricted_file_paths` array to match the Agent's constraints exactly. Consider also protecting `crucible.json` (at least partially) if users shouldn't be able to bypass checksums manually.

### 3.4. Implicit CI Triggers via "git push"
- **Issue:** The CLI TDD (Section 5.3) states that `crucible publish` performs a `git push origin main`, which then triggers the GitHub Actions CI pipeline. The Infrastructure TDD (Section 3.1) confirms the CI triggers on `push to main`.
- **Gap:** Since the Agent auto-commits locally, if a user manually runs `git push origin main` outside the CLI, it will trigger a production deployment. `crucible publish` is effectively just a wrapper that tails the CI status. 
- **Recommendation:** Ensure this behavior is intentional and documented. If developers want to back up their work without deploying, they might need a development branch. If `main` is always the production trigger, consider enforcing `workflow_dispatch` only, or clarify that `git push origin main` == deployment.

### 3.5. Rollback Runbooks
- **Issue:** The Infrastructure TDD (Section 10) provides a "Manual rollback runbook" using `kubectl set image deployment`. The CLI TDD (Section 6.1) specifies `crucible rollback` triggers a CI `workflow_dispatch`.
- **Recommendation:** The Infrastructure TDD should list the CI-driven rollback (`crucible rollback` or triggering the GH Action directly) as the primary/preferred runbook, and relegate the `kubectl` approach to an "Emergency Break-Glass" scenario.

---

## 4. Technical Risks & Optimizations

- **DynamoDB TTL Lag (Risk R2 in Infra):** The Infrastructure TDD correctly identifies that DynamoDB TTL deletions can lag up to 48 hours, which would break KEDA scale-to-zero. The mitigation (`/metrics` MUST filter `expiresAt > NOW()`) is excellent and vital.
- **KEDA Triggers:** The KEDA scaling triggers use a maximum replica count across both `pending_activations` and `active_sessions`. This is a solid approach to ensure the pod stays alive both when first activated and while players are connected.
- **VGF Docs in Agent Context:** The CLI TDD's decision (Section 3.2) to conditionally load the `BUILDING_TV_GAMES.md` documentation only when required is a smart optimization to preserve Claude's token context and reasoning focus. 

## 5. Conclusion

Both designs are highly mature, production-ready, and carefully consider the edge cases of standardizing game deployment. Resolving the API discrepancy around real-time K8s Replica status and standardizing the GitHub Ruleset coverage will close the few remaining gaps.