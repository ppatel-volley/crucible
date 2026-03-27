# Development Plan — Bifrost Integration Changes

> **Date:** 2026-03-27
> **Context:** Crucible and Bifrost teams joining forces. This document describes what changes to Crucible's development plan and TDD to accommodate the integration.
> **Bifrost repo:** `C:\volley\dev\bifrost`

---

## Summary of Changes

Bifrost integration adds a new **Phase 1F** (prototype deployment) to Crucible and modifies Phase 3 (publish pipeline) to include a graduation path. It also adds a new Phase 7 for Proto-Hub integration with Bifrost-hosted games.

The changes are **additive** — nothing in the existing plan gets removed or delayed.

---

## New Phase: 1F — Prototype Deployment (Bifrost)

This slots in after Phase 1 (which is complete) and can run in parallel with Phase 2/3.

**Dependencies:** Bifrost Phase 1 complete (it is), Bifrost deployed to shared-k8s-dev cluster (human action).

### Milestone 1F: `crucible prototype` Command

| # | Work Item | Deps | Size | Repo | Acceptance Criteria |
|---|-----------|------|------|------|---------------------|
| 1F.1 | Single-container prototype build mode | None | M | `crucible` | `pnpm build:prototype` bundles server + display + controller static files into one image |
| 1F.2 | In-cluster registry push utility | Bifrost registry running | S | `crucible` | Pushes image to `registry.prototypes.svc.cluster.local:5000` |
| 1F.3 | GamePrototype CRD generator | None | S | `crucible` | Generates valid `GamePrototype` YAML from crucible.json + options |
| 1F.4 | `crucible prototype` command | 1F.1, 1F.2, 1F.3 | M | `crucible` | Full flow: build → push → apply CRD → wait for Ready → print URL |
| 1F.5 | `crucible prototype --watch` mode | 1F.4 | M | `crucible` | File watcher triggers rebuild + redeploy on changes |
| 1F.6 | `crucible prototype --dependencies` flag | 1F.4 | S | `crucible` | Declares postgres/redis/s3 dependencies → injected into CRD |
| 1F.7 | Prototype status in `crucible status` | 1F.4 | S | `crucible` | Shows Bifrost phase + hostname alongside production status |

### Milestone 1F Alternative: Source-Based (after Bifrost Phase 2)

Once Bifrost has Buildpacks (Phase 2), Crucible can skip the local build entirely:

| # | Work Item | Deps | Size | Repo | Acceptance Criteria |
|---|-----------|------|------|------|---------------------|
| 1F.8 | Source-based prototype mode | Bifrost Phase 2 | S | `crucible` | `crucible prototype --source` submits `spec.source` instead of `spec.image` |
| 1F.9 | Build status streaming | 1F.8 | M | `crucible` | CLI shows build progress by tailing build Pod logs |

---

## Changes to Existing Phases

### Phase 3: Publish Pipeline — Add Graduation Path

Add to Milestone 3B (CLI Publish + Ops Commands):

| # | Work Item | Deps | Size | Repo | Acceptance Criteria |
|---|-----------|------|------|------|---------------------|
| 3B.8 | `crucible publish --from-prototype` | 1F.4, 3B.1 | M | `crucible` | Pre-populates first production deployment from working prototype config. Copies env vars, dependencies, port. |
| 3B.9 | Prototype cleanup on graduation | 3B.8 | S | `crucible` | After first successful production publish, prompts to delete the GamePrototype CRD |

### Phase 4: Proto-Hub — Add Bifrost Discovery

Add to Proto-Hub work:

| # | Work Item | Deps | Size | Repo | Acceptance Criteria |
|---|-----------|------|------|------|---------------------|
| 4.9 | Bifrost game discovery | 4.2, Bifrost deployed | M | `proto-hub` | Proto-Hub lists Bifrost prototypes alongside production games (marked as "prototype") |
| 4.10 | Prototype launch flow | 4.9 | M | `proto-hub` | Proto-Hub can iframe a Bifrost-hosted game using its in-cluster hostname |

---

## TDD Changes

### New Section: §4.7 Prototype Deployment

Add to `docs/tdd-cli.md` after §4.6 (Dev Server Lifecycle):

```
§4.7 Prototype Deployment (Bifrost)

crucible prototype <game-id> [--watch] [--dependencies <deps>] [--source]

Deploys the game to the Kubernetes dev cluster via Bifrost's GamePrototype CRD.
This provides a real-infrastructure prototype environment without the full CI/CD pipeline.

Build modes:
- Default: Local build. Bundles server + static clients into a single container,
  pushes to in-cluster registry.
- --source: Submits a spec.source reference. Bifrost builds via Buildpacks in-cluster.
  Requires Bifrost Phase 2.

Dependencies (--dependencies flag):
  Format: name:type,name:type
  Example: --dependencies scores:postgres,cache:redis,assets:s3

  Each dependency is provisioned by Bifrost against shared in-cluster services.
  Connection details are injected as environment variables:
  - postgres: {NAME}_DATABASE_URL
  - redis: {NAME}_REDIS_HOST, {NAME}_REDIS_PORT, {NAME}_REDIS_KEY_PREFIX
  - s3: {NAME}_S3_ENDPOINT, {NAME}_S3_BUCKET, {NAME}_S3_ACCESS_KEY_ID,
         {NAME}_S3_SECRET_ACCESS_KEY, {NAME}_S3_REGION

Watch mode (--watch):
  Monitors source files for changes. On change:
  1. Rebuilds the prototype container
  2. Pushes to in-cluster registry
  3. Updates the GamePrototype CRD image tag
  4. Bifrost rolls out the new version (zero-downtime)

Output:
  ✓ Prototype running!
    Server:     http://{game}.{game}-prototype.svc.cluster.local:{port}
    Display:    http://{game}.{game}-prototype.svc.cluster.local:{port}/display/
    Controller: http://{game}.{game}-prototype.svc.cluster.local:{port}/controller/

    Dependencies:
      scores (postgres): {game}_{scores}_db
      cache (redis):     {game}:cache: prefix
      assets (s3):       {game}-assets bucket

Cleanup:
  crucible prototype <game-id> --delete
  Removes the GamePrototype CRD. Bifrost cleans up all provisioned resources
  (databases, buckets, namespace) automatically via finalizer.

Error codes:
  CRUCIBLE-901: Prototype deployment failed (Bifrost reconciliation error)
  CRUCIBLE-902: Build failed (Buildpack or container build error)
  CRUCIBLE-903: Registry push failed
  CRUCIBLE-904: Cluster access error (kubectl/kubeconfig not configured)
```

### New Section: §11.3 Prototype Data Flow

Add to §11 (Data Flows):

```
§11.3 Prototype Deployment Flow

Developer → crucible prototype → build container → push to registry → apply GamePrototype CRD
                                                                            │
                                                              Bifrost Controller
                                                                            │
                                                    ┌───────────────────────┼───────────────────────┐
                                                    │                       │                       │
                                              Create namespace     Provision dependencies    Create Deployment
                                              {game}-prototype     (Postgres DB, Redis,      + Service
                                                                    MinIO bucket)
                                                                            │
                                                                    Inject env vars
                                                                    into container
                                                                            │
                                                                    Game running at
                                                                    {game}.{game}-prototype.svc.cluster.local
```

### Changes to §9.3 Error Taxonomy

Add new error category:

```
| Code Range | Category   | Examples |
|------------|-----------|----------|
| 9xx        | Prototype | Deploy failed, build failed, registry push failed, cluster access error |
```

### Changes to §8 Operations Commands

Update `crucible status` to include prototype information:

```
§8.2 (updated) crucible status output:

scottish-trivia — Scottish Trivia
  Prototype │ Running    │ scottish-trivia.scottish-trivia-prototype.svc.cluster.local
  dev       │ 00042-abc  │ healthy   │ 1/1      │ 2h ago
  staging   │ —          │ —         │ —        │ —
  prod      │ —          │ —         │ —        │ —
```

---

## Updated Sprint Groupings

| Sprint | Weeks | Theme | Key Deliverables |
|--------|-------|-------|-----------------|
| **1** | 1-2 | Foundation | CLI scaffold, config, logger, template engine *(DONE)* |
| **2** | 3-4 | Create + Agent + Dev | `crucible create`, agent, `crucible dev` *(DONE)* |
| **2.5** | 4-5 | **Prototype deployment** | **`crucible prototype` command, single-container build, CRD generator** |
| **3** | 5-6 | Registry API + Publish foundations | Registry API endpoints, publish pre-flights |
| **4** | 7-8 | Publish pipeline | `crucible-deploy` tool, CI workflow, `crucible login` |
| **5** | 9-10 | CLI ops + safety | publish/rollback/promote/logs/status, graduation path |
| **6** | 11-13 | Proto-Hub | Fork Hub, game list (including Bifrost prototypes), launch flow |
| **7+** | 14+ | Template mgmt + Desktop | `crucible update`, automated PRs, Electron app |

---

## Cross-Repo Coordination

| Bifrost Phase | What Crucible Needs | When |
|---------------|-------------------|------|
| Phase 1 (Core Controller) — DONE | CRD spec, provisioner behaviour, env var naming | Now |
| Phase 1 deployment to cluster | Running operator + shared infra on shared-k8s-dev | Before 1F.4 |
| Phase 2 (Buildpacks) | `spec.source` field, build Pod lifecycle | For 1F.8-1F.9 |
| Phase 3 (Integration) | Agreed handoff contract, status surfacing | For 1F.7, 3B.8 |

---

## Human Action Items (New)

| Action | Blocks | Owner |
|--------|--------|-------|
| Deploy Bifrost operator to shared-k8s-dev | Phase 1F | Bifrost author + Infra |
| Deploy shared infra (Postgres, MinIO, Redis, Registry) to prototypes namespace | Phase 1F | Bifrost author + Infra |
| Decide: single-container vs multi-service prototype for VGF games | 1F.1 design | Both teams |
| Agree on CRD version pinning strategy (Crucible generates CRDs, Bifrost consumes) | 1F.3 | Both teams |
