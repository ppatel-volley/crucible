# Crucible Infrastructure — Technical Design Document

> **Status:** Draft v1.0
> **Date:** 2026-03-25
> **Authors:** Staff Engineering (Infra), Networking Specialist, UI Specialist, Review Engineer
> **Confidence:** 0.97
> **Audience:** Infrastructure engineers and AI agents implementing the Crucible platform

---

## Table of Contents

1. [Infrastructure Overview & Divergences](#1-infrastructure-overview--divergences)
2. [Crucible Registry API](#2-crucible-registry-api)
3. [CI/CD Pipeline](#3-cicd-pipeline)
4. [Kubernetes Resource Templates](#4-kubernetes-resource-templates)
5. [Networking & Transport Architecture](#5-networking--transport-architecture)
6. [Security Architecture](#6-security-architecture)
7. [Observability & Monitoring](#7-observability--monitoring)
8. [UI Architecture & Design](#8-ui-architecture--design)
9. [Cost Model](#9-cost-model)
10. [Disaster Recovery & Runbooks](#10-disaster-recovery--runbooks)
11. [E2E Testing Strategy (Infrastructure)](#11-e2e-testing-strategy-infrastructure)
12. [Open Questions Resolution](#12-open-questions-resolution)
13. [Risk Register](#13-risk-register)
14. [Decision Log](#14-decision-log)
15. [Phased Delivery Plan](#15-phased-delivery-plan)
16. [Dependency Matrix](#16-dependency-matrix)

---

## 1. Infrastructure Overview & Divergences

### 1.1 Existing Volley Deployment Model

Volley uses a Flux GitOps model across four repos: `volley-infra` (Terraform), `volley-infra-tenants` (Helm releases), `kubernetes` (Flux configs, namespaces, RBAC), `helm-charts` (shared charts). Each new app requires PRs to all four repos.

**Key characteristics:**
- Long-lived IAM credentials in GitHub Secrets for ECR push
- Flux as sole deployment authority
- Two EKS clusters: `shared-k8s` (production) and `shared-k8s-staging` (dev/staging)
- Secrets via SSM Parameter Store → SecretProviderClass
- Production namespace naming: `{app}-production` (but SSM uses `/app/prod/*`)

### 1.2 How Crucible Diverges

Crucible cannot use per-app onboarding (4 PRs per game is untenable at 50-200 games):

| Aspect | Existing Volley | Crucible Games |
|--------|----------------|----------------|
| Deployment authority | Flux GitOps | CI-driven (`kubectl apply` via OIDC) |
| ECR | One repo per app | Shared `crucible-games` repo, per-game tags |
| Namespaces | `{app}-{env}` per app | `crucible-{env}` shared (3 total) |
| IAM roles | Manual Terraform PR | Automated CloudFormation stack per game |
| Helm | Helm releases in tenants repo | Raw K8s manifests applied by CI |
| Scaling | HPA with minReplicas ≥ 1 | KEDA with minReplicaCount: 0 |
| Credentials | Long-lived AWS keys | OIDC federation (no long-lived creds) |

### 1.3 Coexistence Strategy

- Crucible namespaces (`crucible-dev/staging/prod`) created in the same EKS clusters
- **Flux does NOT manage crucible namespaces** — no Flux kustomisation or image automation
- Shared infrastructure reused: EKS, VPC, ALB Ingress Controller, Prometheus, Datadog, Redis
- `crucible-ci` IAM role scoped to `crucible-*` resources only
- OPA/Gatekeeper enforces only `crucible-games` ECR images in `crucible-*` namespaces

---

## 2. Crucible Registry API

### 2.1 Architecture: Lambda + API Gateway

**Recommendation: AWS Lambda + API Gateway (HTTP API).**

Justification: bursty low-volume request pattern (a few publishes/day, cacheable game listing, a few activations/minute). Lambda costs nothing idle. No container image to maintain. `/metrics` endpoint served via API Gateway — Prometheus scrapes it directly (Lambda cold start ~300ms on arm64, acceptable for 5s scrape interval).

### 2.2 DynamoDB Table Design

#### Table: `crucible-game-catalog`

Single-table design storing both game catalog entries and activation leases.

| PK | SK | Entity | Key Attributes |
|----|-----|--------|----------------|
| `"CATALOG"` | `gameId` | Game entry | displayName, author, currentVersion, status, endpoints, tile, updatedAt |
| `"LEASE#{gameId}"` | `activationId` | Activation lease | createdAt, expiresAt (epoch seconds, also used as DynamoDB TTL) |

**Lease expiration field:** The attribute is named `expiresAt` and stores Unix epoch seconds. DynamoDB TTL is configured on this same attribute. All queries filter `expiresAt > :now` — never rely on physical TTL deletion (can lag up to 48 hours). The attribute name `expiresAt` is canonical across all code, metrics queries, and documentation.

**GSI: `StatusIndex`** — PK: `status`, SK: `updatedAt`. For querying only active games.

**TTL:** Enabled on `expiresAt` attribute for eventual cleanup of expired leases.

**PITR:** Enabled for disaster recovery.

#### Table: `crucible-game-versions`

| PK | SK | Attributes |
|----|----|------------|
| `gameId` | `"{runNumber:08d}-{commitSha7}"` | displayName, author, imageTag, endpoints, publishedAt, status |

**Query patterns:**
- Latest version: `Query PK=gameId, ScanIndexForward=false, Limit=1`
- Version history: `Query PK=gameId, ScanIndexForward=false`
- Previous healthy: `Query PK=gameId, ScanIndexForward=false, FilterExpression: status="active", Limit=2`

### 2.3 API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `GET /games` | GET | **Public** (no auth, CloudFront cached 15s) | List all active games for Proto-Hub |
| `GET /games/:gameId` | GET | **Public** (no auth, CloudFront cached 15s) | Get single game metadata + endpoints |
| `PUT /games/:gameId` | PUT | CI IAM (SigV4) | Register/update game (conditional write) |
| `DELETE /games/:gameId` | DELETE | SSO JWT (admin) | Soft-delete (status → disabled) |
| `GET /games/:gameId/history` | GET | SSO JWT | Version history for rollback |
| `POST /games/:gameId/activate` | POST | SSO JWT, rate-limited 5/user/min | Create activation lease for KEDA |
| `GET /metrics` | GET | Internal | Prometheus exposition format |

**Canonical Status Model:**

Two separate status dimensions — do NOT conflate them:

| Dimension | Field | Values | Set By |
|-----------|-------|--------|--------|
| **Catalog visibility** | `catalogStatus` | `active`, `disabled` | CLI (`crucible delete` sets `disabled`) |
| **Deployment health** | `healthStatus` | `healthy`, `unhealthy`, `deploying` | CI (after deploy/verify), circuit breaker (sets `unhealthy`) |

Proto-Hub filters on `catalogStatus = active` to get the game list. It shows `healthStatus` on each tile. The CLI's `crucible status` displays both. The Registry API `GET /games` returns both fields. The `GameVersion.status` in the versions table uses: `active` (current), `rolled-back`, `superseded`.

**PUT conditional write:** `ConditionExpression: "attribute_not_exists(currentVersion) OR currentVersion = :previousVersion"`. On conflict → 409, CI retries.

**`/metrics` implementation CRITICAL:** Must filter `expiresAt > NOW()`, NOT rely on DynamoDB TTL physical deletion (can lag up to 48 hours).

**`/metrics` security:** The `/metrics` endpoint is served via a **separate Lambda Function URL** (not the public API Gateway). This Function URL is configured with `AuthType: AWS_IAM` — only the Prometheus service account (via IRSA) can invoke it. This prevents public exposure of operational metrics. Prometheus scrapes the Function URL directly within the VPC.

```
# HELP crucible_pending_activations Non-expired activation leases per game
# TYPE crucible_pending_activations gauge
crucible_pending_activations{game_id="scottish-trivia"} 2
crucible_pending_activations{game_id="emoji-party"} 0
```

### 2.4 CloudFront Caching

- `GET /games`: 15s default TTL, 30s max TTL (meets <30s freshness SLO)
- Mutation endpoints (`/activate`, PUT, DELETE): bypass cache (TTL 0, forward Authorization header)

---

## 3. CI/CD Pipeline

### 3.1 GitHub Actions Workflow

Generated by `crucible create`, owned by template (not user-editable). Triggered on push to main or workflow_dispatch.

```
quality-gate (parallel lint + typecheck + test + Dockerfile checksum validation)
    │
    ▼
build-and-deploy:
    ├── OIDC auth → assume crucible-ci role
    ├── Docker build + push to ECR (tag: {gameId}-{sha}-{runNumber})
    ├── Trivy image scan (CRITICAL,HIGH → fail)
    ├── Client build (Vite) + S3 upload
    ├── kubectl apply (Deployment, Service, Ingress, SA, ScaledObject, NetworkPolicy)
    ├── Health check (poll readiness, 60s timeout)
    ├── Register in Registry API
    └── Compensating rollback (if register or verify fails after deploy succeeds)
```

### 3.2 OIDC Authentication

GitHub Actions → OIDC token → `sts:AssumeRoleWithWebIdentity` → `crucible-ci` IAM role.

**Trust policy restricts to:** `repo:Volley-Inc/crucible-game-*:ref:refs/heads/main` — only Crucible game repos on main branch.

**CANONICAL ORG NAME: `Volley-Inc`** (capital V, capital I, hyphenated). This exact casing is used in: IAM trust policy `sub` conditions, GitHub API calls, git remote URLs, and all documentation. IAM policy string comparisons are case-sensitive — using `volley-inc` will silently fail to match. Verify by decoding a live GitHub OIDC token's `sub` claim.

**IAM permissions:** ECR push, S3 upload (`crucible-clients-*`), EKS describe, CloudFormation create/update (`crucible-irsa-*`), IAM role create (`crucible-game-*`), API Gateway invoke (registry PUT).

### 3.3 Image Tagging

Format: `{gameId}-{commitSha}-{runNumber}`. Deterministic (no clock dependency), content-addressable, monotonically ordered via run number.

### 3.4 `crucible-deploy` CLI Tool

Published as `@volley/crucible-deploy`, invoked in CI via `npx`:

| Command | Behaviour |
|---------|-----------|
| `apply` | Render K8s templates, ensure IRSA CloudFormation stack, `kubectl apply --server-side`, wait for rollout |
| `verify` | Poll readiness endpoint every 2s up to timeout |
| `register` | PUT to Registry API with IAM SigV4 signing, retry on 409 |
| `rollback` | Query history, re-apply previous image tag, update registry |

### 3.5 Pipeline Duration Budget (5-Minute SLO)

| Step | Estimated Duration |
|------|-------------------|
| Checkout + setup + install | 25s |
| Lint + typecheck + test (parallel) | 30s |
| Docker build (with cache) | 60s |
| Docker push + Trivy scan | 35s |
| Client build + S3 upload | 40s |
| kubectl apply + rollout | 30s |
| Health check + register | 12s |
| **Total** | **~3.5 minutes** |

---

## 4. Kubernetes Resource Templates

All templates use `{{ gameId }}`, `{{ env }}`, `{{ imageTag }}` substitution variables, rendered by `crucible-deploy apply`.

### 4.1 Deployment

Key configuration:
- `terminationGracePeriodSeconds: 35` (preStop sleep 30s for WebSocket drain)
- Security context: `runAsNonRoot: true`, `readOnlyRootFilesystem: true`, `capabilities.drop: ["ALL"]`
- Resources: requests `100m CPU / 128Mi`, limits `500m CPU / 512Mi`
- Readiness probe: `GET /{gameId}/health/ready` (initialDelay 5s, period 5s)
- Liveness probe: `GET /{gameId}/health` (initialDelay 10s, period 10s)
- Env vars: `GAME_ID`, `STAGE`, `REDIS_URL` (from Secret), `DD_ENV`, `DD_SERVICE`, `DD_AGENT_HOST`

### 4.2 Service

ClusterIP, port 80 → targetPort 8080.

### 4.3 Ingress

Per-game Ingress with ALB group annotation (`crucible-{env}`):
- Sticky sessions enabled (cookie-based, 86400s)
- Health check: `/{gameId}/health/ready`
- TLS termination at ALB
- Idle timeout: 3600s (long-lived WebSocket connections)

### 4.4 ServiceAccount (IRSA)

Annotated with `eks.amazonaws.com/role-arn: arn:aws:iam::375633680607:role/crucible-game-{gameId}-{env}`.

### 4.5 KEDA ScaledObject

- `minReplicaCount: 0`, `maxReplicaCount: 5`, `cooldownPeriod: 300`
- Trigger 1 (0→1): `crucible_pending_activations{game_id="{gameId}"}` threshold 1
- Trigger 2 (1→N): `sum(crucible_active_sessions{game_id="{gameId}"})` threshold 20

Multi-trigger semantics: KEDA takes **maximum** desired replica count across triggers.

### 4.6 NetworkPolicy

Base K8s NetworkPolicy: allow ingress on 8080 (ALB + Prometheus), allow egress to DNS (53), Redis (6379), HTTPS (443).

For FQDN-based egress control, CiliumNetworkPolicy required (see Section 6).

---

## 5. Networking & Transport Architecture

### 5.1 WebSocket Routing

Full request path:

```
Client → ALB (TLS termination, sticky sessions) → Ingress → Service → Pod
```

- Socket.IO path per game: `/{gameId}/socket.io`
- ALB sticky sessions (AWSALB cookie) required for Socket.IO polling → WebSocket upgrade
- ALB idle timeout: 3600s (supports long game sessions)
- Socket.IO `pingInterval: 25000` keeps connections alive

### 5.2 Socket.IO Redis Adapter

For multi-replica games (2+ pods), the `@socket.io/redis-adapter` provides cross-replica room/event fanout via Redis pub/sub.

**Channel prefix isolation:** Each game uses `{gameId}:*` channel prefix, enforced by Redis ACLs.

**Adapter initialisation (server bootstrap template):**
```typescript
const pubClient = createRedisClient(REDIS_URL)
const subClient = pubClient.duplicate()
const io = new SocketIOServer(httpServer, {
    adapter: createAdapter(pubClient, subClient, { key: GAME_ID }),
})
```

**Two clients required:** Subscriber client enters subscriber mode and cannot issue normal commands.

**Failure modes:**
- Redis connection lost (transient): adapter buffers locally, cross-replica messages lost during outage. ioredis reconnects with backoff.
- Redis connection lost (extended >30s): readiness probe fails, pod removed from Service endpoints.
- Message loss window: events emitted during disconnection are permanently lost. WGF state sync re-sends full state on reconnect.

### 5.3 KEDA Scale-to-Zero

**Complete scale-from-zero flow:**

```
Proto-Hub → POST /activate → DynamoDB lease (60s TTL)
  → Prometheus scrapes /metrics (5s interval) → pending_activations > 0
  → KEDA evaluates (3s) → patches Deployment 0 → 1
  → Pod scheduled, image pulled, Node.js boots, Redis connects, WGFServer starts
  → Readiness probe passes → ALB registers pod
  → Proto-Hub polls readiness → WebSocket connects
```

**Cold start budget:**

| Phase | Duration |
|-------|----------|
| Prometheus scrape | 0-5s |
| KEDA reaction | ~3s |
| Pod scheduling | ~1s |
| Image pull (cached) | ~0s |
| Container + Node.js + Redis + WGF | ~3s |
| Readiness probe + ALB registration | ~5-10s |
| **Total** | **~15s** (target SLO) |

**DynamoDB TTL gotcha:** `/metrics` MUST filter `expiresAt > :now`, not rely on physical deletion (can lag 48 hours).

**Fast-path option:** Registry API directly patches K8s Deployment replicas (bypasses Prometheus + KEDA, saves ~8s). KEDA remains steady-state scaler.

**Crash-loop circuit breaker:** CronJob (every 60s) detects CrashLoopBackOff pods > 5 minutes, scales to 0, marks unhealthy in Registry.

### 5.4 Ingress Management

- Per-game Ingress objects, grouped on shared ALB via `group.name`
- CI uses server-side apply with per-game field manager (no concurrent clobber)
- ALB limit: ~100 rules per group. At 100+ games, shard across groups or migrate to Nginx/Envoy

### 5.5 Network Policy & Egress

**Pod isolation:** Game pods cannot reach each other (NetworkPolicy denies inter-pod traffic).

**Egress allowlist (CiliumNetworkPolicy with FQDN rules):**
- `*.volley.tv`, `*.volley-services.net`
- Specific AWS VPC endpoints (S3, SSM, STS) — NOT `*.amazonaws.com`
- Redis (VPC CIDR, port 6379)
- DNS (kube-dns)

**Prerequisite:** Cilium CNI must be installed on the EKS cluster.

### 5.6 Client Connection Lifecycle

**Display (TV):** Proto-Hub fetches game list → user selects tile → activate → poll readiness → iframe loads display client → VGFProvider autoConnect → Socket.IO handshake → state sync → render.

**Controller (phone):** QR code scan → controller URL in mobile browser → PlatformProvider → VGFProvider → Socket.IO connect → state sync → input UI.

**Reconnection:** Socket.IO automatic (10 attempts, 1-5s backoff). Server matches `userId` → existing SessionMember. Full state re-sent on reconnect.

### 5.7 DNS & Service Discovery

| Record | Value | Purpose |
|--------|-------|---------|
| `crucible-games-{env}.volley-services.net` | ALB CNAME | Game server WebSocket |
| `crucible-clients-{env}.volley.tv` | CloudFront CNAME | Static client bundles |

Game server discovery for clients: via Registry API `endpoints` field (pre-computed, deterministic).

---

## 6. Security Architecture

### 6.1 Per-Game IRSA (CloudFormation)

Each game gets a CloudFormation stack (`crucible-irsa-{gameId}-{env}`) creating an IAM role with:
- OIDC trust policy for the game's K8s ServiceAccount
- S3 GetObject scoped to `crucible-clients-{env}/{gameId}/*`
- SSM GetParameter scoped to `/crucible/{env}/{gameId}/*`
- ECR pull-only

First-deploy latency: ~60-90s (within 5-minute SLO). Subsequent deploys skip creation.

### 6.2 Redis ACL Management

CI-scripted approach via shared Lambda `crucible-redis-acl-manager`:
```
ACL SETUSER crucible-{gameId} on >{password} ~{gameId}:* &{gameId}:* +get +set +del +exists +mget +mset +expire +ttl +publish +subscribe +unsubscribe +psubscribe +punsubscribe +ping +info +scan +hscan +hget +hset +hdel +hgetall +hexists +sadd +srem +smembers +sismember +zadd +zrem +zrange +zrangebyscore +type -@admin -@dangerous
```

The command allowlist covers exactly what WGF game servers and the Socket.IO Redis adapter need: key operations, pub/sub, hash/set/sorted-set operations, and introspection. **No `+@all`** — explicit allowlist reduces blast radius from a compromised game.

Password stored in SSM at `/crucible/{env}/{gameId}/redis_password`. Game's `REDIS_URL` constructed with per-game credentials.

### 6.3 Build Sandboxing

**Three independent controls:**
1. GitHub Repository Rulesets (prevent modification of Dockerfile, CI, lockfile, .npmrc)
2. CI checksum validation (SHA-256 of Dockerfile against template)
3. Agent CLAUDE.md rules (file restriction enforcer)

### 6.4 Admission Control

OPA/Gatekeeper constraint: only `crucible-games` ECR images allowed in `crucible-*` namespaces.

### 6.5 Pod Security

- `runAsNonRoot: true`, `runAsUser: 1000`
- `readOnlyRootFilesystem: true` (/tmp via emptyDir)
- `capabilities.drop: ["ALL"]`
- `seccompProfile.type: RuntimeDefault`
- Namespace label: `pod-security.kubernetes.io/enforce: restricted`

---

## 7. Observability & Monitoring

### 7.1 Prometheus Metrics

**Game servers (`/metrics`, port 8080):**
- `crucible_active_sessions{game_id}` — KEDA scaling input
- `crucible_connected_clients{game_id, client_type}`
- `crucible_thunk_duration_seconds{game_id, thunk_name}`
- `crucible_redis_operations_total{game_id, operation, status}`
- Standard HTTP request metrics

**Registry API (`/metrics`):**
- `crucible_pending_activations{game_id}` — KEDA scaling input
- `crucible_registered_games{status}`

### 7.2 Alerting Rules

| Alert | Condition | Severity |
|-------|-----------|----------|
| CrucibleGameCrashLoop | CrashLoopBackOff > 5m | warning |
| CrucibleGameHighErrorRate | 5xx rate > 5% for 5m | warning |
| CrucibleRedisConnectionFailure | Redis errors > 10 in 5m | critical |
| CrucibleRegistryErrors | Registry write failures | critical |
| CrucibleStaleActivations | Pending activations > 10m | warning |
| CrucibleDeployFailed | Deployment unavailable > 5m | critical |

### 7.3 Logging

Structured JSON via `@volley/logger` (pino). Collected by Datadog Agent DaemonSet. Tags: `service:crucible-{gameId}`, `env:{env}`.

### 7.4 Dashboards

Crucible Operations dashboard: game overview table, deploy pipeline success rate, active sessions time series, scale events, error rates, cold start latency (P50/P95/P99), Redis operations.

---

## 8. UI Architecture & Design

### 8.1 Proto-Hub

Fork of Hub with concentrated changes: `useGames.ts` (Registry API), game launch (iframe + activation), strip paywall/experiments, add SSO.

**Component tree:**
```
<SSOAuthProvider>
  <RegistryProvider>
    <ConnectionStatusProvider>
      <ProtoHubShell>
        <GameGrid>
          <GameTile /> × N
        </GameGrid>
        <GameLaunchOverlay />
        <QRCodePairingOverlay />
      </ProtoHubShell>
    </ConnectionStatusProvider>
  </RegistryProvider>
</SSOAuthProvider>
```

**Game launch state machine:** `idle → activating → waiting_for_ready → loading_iframe → playing | error`

**TV constraints:** 24px min font, 5% overscan safe area, D-pad navigation (no hover), 4px focus ring, transform/opacity animations only.

**Game list refresh:** Background fetch every 15s (matching CloudFront TTL). Worst-case visibility for a newly published game: CloudFront cache TTL (15s) + Proto-Hub poll interval (15s) = **30 seconds** (meets the <30s freshness SLO). Best case: ~0s if the poll aligns with cache expiry. P95 estimate: ~20s.

### 8.2 Game Template UI Patterns

**Display (TV):** `App → MaybePlatformProvider → VGFDisplayProvider → SceneRouter → [LobbyScene | PlayingScene | GameOverScene]`

**Controller (phone):** `App → MaybePlatformProvider → VGFControllerProvider → PhaseRouter → [LobbyController | PlayingController | GameOverController]`

**VGF state hooks:** `useStateSync()`, `useDispatchThunk()`, `useConnectionStatus()`, `useSessionMembers()`

**Critical rules:** No React StrictMode. `autoConnect` in `clientOptions`, not top-level. Never put `query` inside `socketOptions`. Guard `"phase" in state` before rendering.

### 8.3 Desktop App (Phase 6)

**Recommendation: Electron** (CLI + VGF server are Node.js — runs in-process, no subprocess management).

- Project manager dashboard with game cards (status, publish, logs)
- Embedded agent chat (right panel)
- Local preview via embedded BrowserView
- IPC: `ipcMain.handle` / `ipcRenderer.invoke` for all operations

### 8.4 Design System

Dark theme only (v1). Three surface variants (TV, phone, desktop) with shared token foundation:

- **TV:** 18px min font, 5% overscan, D-pad focus ring, no hover states
- **Phone:** 44px min touch target, portrait orientation, bottom-60% thumb zone
- **Desktop:** Standard sizing

---

## 9. Cost Model

### At 50 Games (~$75-90/month)

| Resource | Monthly Cost |
|----------|-------------|
| ECR storage (30GB) | $3.00 |
| S3 + CloudFront | $9.00 |
| DynamoDB | $1.75 |
| K8s compute (10 concurrent, scale-to-zero) | $35.00 |
| ALB (1 shared) | $27.00 |
| Lambda + API Gateway | $0.30 |
| Redis (shared, no incremental) | $0.00 |

### At 200 Games (~$210-300/month)

| Resource | Monthly Cost |
|----------|-------------|
| ECR storage (120GB) | $12.00 |
| S3 + CloudFront | $35.00 |
| DynamoDB | $6.00 |
| K8s compute (30 concurrent) | $100.00 |
| ALB (2 shared, ALB group sharding) | $54.00 |
| Lambda + API Gateway | $1.20 |
| Redis (possible upgrade) | $50.00 |

**Cost optimisation:** ECR lifecycle policies (keep last 5 tags per game), Spot instances for dev/staging, DynamoDB provisioned mode at scale.

---

## 10. Disaster Recovery & Runbooks

| Failure | Impact | Recovery |
|---------|--------|----------|
| **DynamoDB down** | Registry API errors. Proto-Hub shows stale cache. No new deploys. Running games unaffected. | AWS-managed recovery. Restore from PITR if needed. |
| **Redis down** | Active sessions lost. Socket.IO adapter fails. | ElastiCache auto-failover (30s). ioredis reconnects. Players restart sessions. |
| **ECR unreachable** | New deploys fail. Existing pods run (cached images). | Wait for recovery. `imagePullPolicy: IfNotPresent` for cached images. |
| **Registry rebuild** | If both tables lost. | Scan K8s namespaces for running deployments + ECR for image tags. Re-register each game. |

**Rollback procedures (in order of preference):**

1. **Primary:** `crucible rollback <name>` — triggers CI workflow_dispatch, uses the standard pipeline with health verification and registry update. This is the preferred method.
2. **Secondary:** Trigger the GitHub Action manually via `gh workflow run crucible-deploy.yml` with the previous image tag.
3. **Emergency break-glass (kubectl direct):** Only when CI and the CLI are both unavailable.

```bash
# EMERGENCY ONLY — break-glass manual rollback via kubectl
# 1. List available image tags
aws ecr describe-images --repository-name crucible-games \
  --query "imageDetails[?starts_with(imageTags[0],'${GAME_ID}-')]"

# 2. Update deployment
kubectl set image deployment/${GAME_ID} \
  server=${ECR_REPO}:${PREVIOUS_TAG} -n crucible-${ENV}

# 3. Wait + verify
kubectl rollout status deployment/${GAME_ID} -n crucible-${ENV}

# 4. Update registry (direct DynamoDB if API is down)
aws dynamodb update-item --table-name crucible-game-catalog ...
```

---

## 11. E2E Testing Strategy (Infrastructure)

### 11.1 CI Pipeline E2E Stage

The GitHub Actions workflow includes E2E tests **before** deploy:

```yaml
- name: Run E2E tests
  run: |
    # Start VGF server in background
    pnpm --filter server dev &
    sleep 5
    # Run Playwright E2E against display + controller
    pnpm --filter e2e test
    kill %1
```

E2E tests validate: display connects, controller connects, state syncs, phase transitions work, multi-client scenarios.

### 11.2 Post-Deploy Smoke Tests

Part of `crucible-deploy verify`:
1. Health check: `GET /{gameId}/health/ready` → 200
2. WebSocket connectivity: Socket.IO handshake succeeds
3. Session creation: create test session, verify state response
4. Registry consistency: registry entry matches deployment

### 11.3 Infrastructure Conformance Tests (Nightly)

**Route consistency:**
- Registry endpoints match Ingress path rules
- Socket.IO path matches gameId
- Client bundle URLs resolve (HEAD request)

**Isolation verification:**
- Game A cannot read Game B Redis keys (`NOPERM`)
- Game A cannot write to Game B S3 prefix (`AccessDenied`)
- Game pod cannot reach other game pods (NetworkPolicy)
- Game pod cannot reach K8s API

### 11.4 Load/Chaos Testing

| Test | Setup | Success Criteria |
|------|-------|-----------------|
| WebSocket reconnect storm | 50 connections, 2 replicas, rolling deploy | Zero message loss, all reconnected within 30s |
| Cold-start burst | 10 games scaled to zero, activate all simultaneously | All ready within 15s SLO |
| Redis adapter fanout | 3 replicas, 100 sessions, 10 actions/sec each | P99 fanout < 100ms, no message drops |
| Pod kill during game | 20 sessions, `kubectl delete pod` | Game resumes within 10s |

---

## 12. Open Questions Resolution

### OQ1: Per-game IRSA → CloudFormation stack per game
First-deploy adds ~60-90s (within SLO). Self-contained, deletable, no shared state.

### OQ2: Redis ACL → CI-scripted via Lambda
`ACL SETUSER` is idempotent and takes <10ms. Scales to hundreds of games. No operator needed.

### OQ3: Proto-Hub → Hub convergence → Trigger at 10 active games or Hub v2
Clear diff markers. Track upstream. Budget 4h per Hub release for rebase.

### OQ4: Cost model → See Section 9
~$75-90/month at 50 games, ~$210-300/month at 200 games.

### OQ5: Load/chaos testing → See Section 11.4

### OQ6: Conformance tests → See Section 11.3

---

## 13. Risk Register

| # | Risk | L | I | Mitigation |
|---|------|---|---|------------|
| R1 | Agent escapes build sandbox (modifies Dockerfile) | Low | Critical | Three independent controls: Rulesets, CI checksum, CLAUDE.md |
| R2 | DynamoDB TTL lag causes phantom KEDA scale-ups | High | Medium | `/metrics` MUST filter `expiresAt > NOW()`. Unit test. |
| R3 | ALB rule limit exceeded (100+ games) | Low→High | High | Monitor count. Shard at 80 games or migrate to Nginx/Envoy. |
| R4 | Redis ACL misconfiguration → cross-game access | Medium | High | Parameterised Lambda, conformance tests, ACL LOG monitoring. |
| R5 | Cold start exceeds 15s SLO | Medium | Medium | Pre-cache images (DaemonSet), reduce scrape interval, fast-path. |
| R6 | Proto-Hub fork diverges from Hub | Medium | Medium | Clear markers, trigger convergence at 10 games. |
| R7 | Agent code passes lint/test but crashes at runtime | High | Medium | Comprehensive CLAUDE.md, smoke test in CI, integration harness. |
| R8 | Concurrent publish race | Low | Low | DynamoDB conditional writes. Already handled. |
| R9 | CI IAM role scope too broad | Low | Critical | Policy conditions restrict to crucible-* namespaces. Defence in depth. |
| R10 | KEDA scale-to-zero kills active sessions | Low | High | 300s cooldown. Accurate `active_sessions` metric. Alert on unexpected drops. |
| R11 | NPM_TOKEN leaked via Docker layers | Low | Critical | Immutable Dockerfile uses `--mount=type=secret`. Three-layer protection. |
| R12 | Stale CloudFront cache after publish | Medium | Low | 15s TTL acceptable. Invalidation if needed (+30s). |
| R13 | Crash-loop circuit breaker not implemented | Medium | Medium | Phase 3 deliverable. Manual monitoring until then. |
| R14 | Cilium CNI not installed → NetworkPolicy unenforced | Medium | High | Verify before Phase 2. FQDN rules specifically require Cilium. |
| R15 | Orphaned resources from deleted games | Medium | Medium | `crucible delete` cleans up. Nightly reconciliation job. |

---

## 14. Decision Log

### DL-001: Container-Per-Game
Games vary too widely (simple reducers vs full ECS). Container isolation gives independent failure domains. Scale-to-zero mitigates cost. **Review:** when game count exceeds 100.

### DL-002: DynamoDB Registry over S3 Manifest
Conditional writes eliminate race conditions. Same table stores catalog + leases. Serverless pricing at near-zero cost.

### DL-003: Path-Based Routing (Locked)
Single host, single cert, single ALB. Per-game Ingress objects with ALB group annotation. Vite `base` and Socket.IO `path` must include `/{gameId}/`. **Review:** when game count exceeds 80.

### DL-004: Phase 1 is Agent, Not Infrastructure
If agents can't build playable games, the deployment infrastructure doesn't matter. De-risk the core value proposition first.

### DL-005: Auto-Created GitHub Repos (No User-Provided Repos)
Users are NOT prompted to provide a repo. `crucible create` auto-creates `Volley-Inc/crucible-game-{name}`. The `crucible-game-*` naming convention is load-bearing — used by IAM trust policies (`crucible-ci` OIDC sub condition), CI automation, and operational tooling. User-provided repos with arbitrary names would break OIDC federation, may have conflicting branch protections, and add a decision point for non-engineer users. No `--repo` flag in v1; add later only if power users specifically request it, with strict validation.

### DL-006: Immutable Dockerfile
NPM_TOKEN accessible during CI builds. Three-layer defence: Rulesets, checksum validation, CLAUDE.md rules.

---

## 15. Phased Delivery Plan

### Phase 1: Agent + Local Dev
No infrastructure. Validate agent can build playable games. **Prep:** draft Terraform for Phase 2.

### Phase 2: Shared Infrastructure
Create: S3 buckets, CloudFront, ECR repo, DynamoDB tables, `crucible-ci` IAM role, K8s namespaces + RBAC + OPA, KEDA, CiliumNetworkPolicy, Registry API Lambda, Redis ACL admin, Prometheus scrape configs.

**Validation:** CI role assumable, Registry API responds, namespace exists, OPA blocks non-crucible images, Cilium denies unapproved egress.

### Phase 3: Publish Pipeline
Create per-game resources (automated by CI): IRSA stacks, K8s resources, Redis ACL users, registry entries. Plus crash-loop circuit breaker.

**Validation:** `crucible publish` completes <5min, game in registry, KEDA scale-from-zero works, rollback works.

### Phase 4: Proto-Hub
Create: S3 + CloudFront for Proto-Hub, CI/CD pipeline, DNS.

**Validation:** Proto-Hub displays tiles, activation triggers scale-from-zero, cold start <18s.

### Phase 5: Template Management
Automated template update PRs, `crucible update` command.

### Phase 6: Desktop App
Electron wrapper, auto-update infrastructure, code signing.

---

## 16. Dependency Matrix

### Critical Path

```
Phase 1 ──→ Phase 2 ──→ Phase 3 ──→ Phase 4
                                  ──→ Phase 5
                                  ──→ Phase 6
```

Phase 2 can start in parallel with Phase 1. Phase 5 and 6 can start after Phase 1.

### Blocking Dependencies

1. **Cilium CNI verification** — blocks all security isolation (Phase 2)
2. **GitHub OIDC provider** — blocks CI pipeline (Phase 3)
3. **DynamoDB tables** — blocks Registry API (Phase 2/4)
4. **hello-weekend template stabilisation** — blocks Phase 3 go-live
5. **Volley SSO OIDC configuration** — blocks `crucible login` and authenticated API calls

### Parallel Work Streams

| Stream | Phases | Can Start |
|--------|--------|-----------|
| Agent + CLI core | 1, 5, 6 | Immediately |
| Terraform/AWS resources | 2 | Immediately |
| K8s setup | 2 | Immediately |
| Registry API | 2 | After DynamoDB tables |
| CI pipeline + crucible-deploy | 3 | After Phase 2 |
| Proto-Hub | 4 | After Registry API |

