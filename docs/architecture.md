# Crucible — Architecture Plan (v2)

> A Unity/Unreal-style project manager for building, testing, and publishing Volley TV games.
> Internal tool. CLI-first, desktop app later.
>
> **v2 changelog:** Addressed critical review feedback — moved builds to CI, locked routing model, replaced manifest race with registry API, scoped security boundaries, reordered phases, added rollback/SLOs/failure modes.

---

## Overview

Crucible is a game development platform that lets anyone at Volley — engineers, designers, producers, the CFO — create and publish TV games using AI agents. Users describe what they want in natural language, agents build it from a starter template, and the finished game appears as a tile on Proto-Hub (a forked version of Hub for internal use).

**Shared infrastructure, automated per-game deployment.** Each game runs in its own Docker container for full isolation. Crucible automates the build, image push, and deployment via CI — no Terraform PRs, no Helm releases, no Flux configs per game. But per-game work still exists: a GitHub repo is created, a CI pipeline runs, a K8s deployment is applied, and a registry entry is written. "Zero manual infra" is the goal, not "zero moving parts."

---

## Why Container-Per-Game

VGF games vary wildly in server requirements:

| | Simple (hello-weekend) | Complex (Token Raider) |
|---|---|---|
| Architecture | Reducers + thunks | Full ECS with 14 physics systems |
| Dependencies | VGF, logger | VGF, vgf-ecs, custom entity systems |
| Data loading | None | Procedural world generation |
| Analytics | None | Amplitude, Segment, Datadog |
| Scheduler | None | Redis-backed timers |

Container-per-game gives **process-level isolation**. One game crashing cannot take down another game's process. However, containers share cluster resources (CPU, memory, network, Redis, ingress). Noisy-neighbour effects are mitigated by resource limits/requests per pod and Redis key prefix isolation, but not eliminated — a game consuming its full CPU/memory limits can still cause node-level pressure. For v1 this is acceptable at ~100 sessions; at scale, dedicated node pools or resource quotas per game may be needed.

---

## System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                        CRUCIBLE CLI / APP                        │
│                                                                  │
│  ┌──────────┐  ┌──────────────┐  ┌───────────┐  ┌────────────┐ │
│  │  Project  │  │  AI Agent    │  │  Local Dev │  │  Publish   │ │
│  │  Manager  │  │  Workspace   │  │  Server    │  │  (via CI)  │ │
│  │           │  │              │  │            │  │            │ │
│  │ • create  │  │ • conversa-  │  │ • pnpm dev │  │ • git push │ │
│  │ • list    │  │   tional     │  │ • preview  │  │ • triggers │ │
│  │ • delete  │  │ • edits code │  │ • hot      │  │   GH Action│ │
│  │ • status  │  │ • iterates   │  │   reload   │  │ • polls    │ │
│  └──────────┘  └──────────────┘  └───────────┘  └────────────┘ │
│                                                                  │
│  Local filesystem: ~/crucible-games/<game-name>/                 │
│  Each game is a fork of hello-weekend, pushed to Git             │
└──────────────────────────────────────────────────────────────────┘
          │                                           │
          │ git push                                  │ triggers
          ▼                                           ▼
┌──────────────────┐                    ┌──────────────────────────┐
│   GitHub Repo    │───── webhook ─────▶│   GitHub Actions CI      │
│                  │                    │                          │
│ volley-inc/      │                    │  1. lint + test + type   │
│  crucible-game-  │                    │  2. build clients → S3   │
│  scottish-trivia │                    │  3. build Docker → ECR   │
│                  │                    │  4. scan image (Trivy)   │
│ (one repo per    │                    │  5. deploy to K8s (OIDC) │
│  game)           │                    │  6. register in API      │
└──────────────────┘                    │  7. health check / roll  │
                                        │     back on failure      │
                                        └──────────────────────────┘
                                             │            │
                              ┌──────────────┘            │
                              ▼                           ▼
┌──────────────────────────────────┐  ┌──────────────────────────────┐
│    S3 / CloudFront               │  │    ECR + K8s                  │
│                                  │  │                               │
│ crucible-clients-{env}/          │  │ ECR: crucible-games:          │
│  scottish-trivia/                │  │   scottish-trivia-{sha}       │
│   display/index.html + assets    │  │                               │
│   controller/index.html + assets │  │ K8s namespace: crucible-{env} │
│                                  │  │   deploy/scottish-trivia      │
└──────────────────────────────────┘  │   svc/scottish-trivia         │
                                      └──────────────────────────────┘
                    ┌──────────────────────────┐
                    │   Crucible Registry API   │
                    │                          │
                    │  DynamoDB-backed          │
                    │  game registry.           │
                    │  Atomic writes.           │
                    │  No race conditions.      │
                    │  Serves manifest to       │
                    │  Proto-Hub.               │
                    └──────────────────────────┘
                              │
          ┌───────────────────┴────────────────────┐
          ▼                                        ▼
┌──────────────────────────┐  ┌──────────────────────────────────────┐
│       PROTO-HUB          │  │   CRUCIBLE K8s NAMESPACE             │
│                          │  │                                      │
│  Forked from Hub.        │  │  ┌──────────────────┐                │
│  Fetches game list from  │  │  │ scottish-trivia  │ ← auto-created│
│  Registry API.           │  │  │ (own container)  │   by CI        │
│                          │  │  └──────────────────┘                │
│  Launches display in     │  │  ┌──────────────────┐                │
│  iframe via CloudFront.  │  │  │ emoji-party      │                │
│                          │  │  │ (own container)  │                │
│  Platform SDK enabled.   │  │  └──────────────────┘                │
│  No paywall.             │  │                                      │
│  Simple SSO sign-in.     │  │  Scale-to-zero via KEDA.             │
│  QR code pairing.        │  │  Shared ingress, path-based routing. │
└──────────────────────────┘  └──────────────────────────────────────┘
```

---

## User Flows

### Flow 1: Create a New Game

```
User:   crucible create "Scottish Trivia"
System: ✓ Forked hello-weekend → ~/crucible-games/scottish-trivia/
        ✓ Generated Dockerfile + CI workflow from template
        ✓ Created GitHub repo volley-inc/crucible-game-scottish-trivia
        ✓ Pushed scaffold

User:   crucible agent scottish-trivia
Agent:  What kind of game would you like to build?
User:   A trivia game about Scottish history. 4 players, 10 rounds,
        multiple choice answers on the controller, question + scoreboard
        on the TV display.
Agent:  [Edits ruleset, phases, reducers, display components, controller UI]
        [Commits progress to git as it goes]
        I've built your game. Run `crucible dev scottish-trivia` to try it.
```

### Flow 2: Local Preview

```
User:   crucible dev scottish-trivia
System: ✓ Starting VGF server on :8080
        ✓ Starting display client on :5173
        ✓ Starting controller client on :5174
        Open http://localhost:5173 (display) and :5174 (controller)
```

### Flow 3: Publish

```
User:   crucible publish scottish-trivia
System: ✓ Pushing code to GitHub...
        ✓ CI pipeline triggered (run #42)
        ⏳ Running lint + typecheck + tests...        [PASSED]
        ⏳ Building display client...                 [OK]
        ⏳ Building controller client...              [OK]
        ⏳ Building Docker image...                   [OK]
        ⏳ Scanning image for vulnerabilities...      [0 critical, 1 medium]
        ⏳ Pushing to ECR...                          [OK]
        ⏳ Uploading clients to S3...                 [OK]
        ⏳ Deploying to crucible-dev...               [OK]
        ⏳ Health check...                            [HEALTHY]
        ⏳ Registering in game registry...            [OK]
        ✓ Published by prati@volley.com
        Game is now live on Proto-Hub (dev)
```

### Flow 4: Rollback

```
User:   crucible rollback scottish-trivia
System: ✓ Previous image: crucible-games:scottish-trivia-a1b2c3d-20260324
        ✓ Rolling back deployment...
        ✓ Health check...                            [HEALTHY]
        ✓ Registry updated to previous version
        ✓ Rolled back successfully
```

### Flow 5: Promote

```
User:   crucible promote scottish-trivia --to staging
System: ✓ CI pipeline triggered for staging promotion
        ⏳ Retagging image for staging...             [OK]
        ⏳ Deploying to crucible-staging...           [OK]
        ⏳ Health check...                            [HEALTHY]
        ⏳ Updating staging registry...               [OK]
        ✓ Game is now live on Proto-Hub (staging)
```

---

## Component Details

### 1. Crucible CLI

The core tool. Everything the desktop app does, the CLI does first. The CLI **never directly touches Docker, ECR, or K8s.** It pushes code and triggers CI.

**Commands:**

| Command | Description |
|---------|-------------|
| `crucible create <name>` | Fork hello-weekend, generate Dockerfile + CI from template, create GitHub repo |
| `crucible list` | List all local games and their publish status |
| `crucible agent <name>` | Open conversational AI agent for a game |
| `crucible dev <name>` | Start local dev server (VGF + display + controller) |
| `crucible publish <name>` | Push to git, trigger CI pipeline, poll for status |
| `crucible promote <name> --to <env>` | Trigger promotion pipeline via CI |
| `crucible rollback <name>` | Roll back to previous healthy deployment |
| `crucible logs <name>` | Tail logs from deployed game server |
| `crucible status <name>` | Show build/deploy status across environments |
| `crucible login` | Authenticate via Volley SSO (OIDC) |

**Tech stack:** Node.js CLI (TypeScript). Uses Claude Code / Claude API for the agent. Interacts with GitHub API for CI triggers, Crucible Registry API for status.

### 2. Game Project Structure

Every Crucible game is created from the hello-weekend template by `crucible create`. The template is **parameterised** — `crucible create` generates files with the correct game name, package names, and identifiers baked in. No manual editing of boilerplate.

```
scottish-trivia/
├── apps/
│   ├── server/
│   │   └── src/
│   │       ├── index.ts        # Server bootstrap (generated, standard)
│   │       ├── ruleset.ts      # GameRuleset — THE game logic
│   │       ├── reducers.ts     # State mutations
│   │       ├── thunks.ts       # Async operations
│   │       └── phases.ts       # Phase FSM
│   ├── display/                # TV screen (React + Vite)
│   │   └── src/
│   │       ├── App.tsx         # PlatformProvider wrapper
│   │       └── components/     # Phase-specific scenes
│   └── controller/             # Phone screen (React + Vite)
│       └── src/
│           ├── App.tsx         # PlatformProvider wrapper
│           └── components/     # Input UI per phase
├── packages/
│   └── shared/                 # Types, constants, initial state
├── Dockerfile                  # LOCKED — generated by crucible create, not user-editable
├── .github/
│   └── workflows/
│       └── crucible-deploy.yml # CI pipeline (generated, standard)
├── crucible.json               # Crucible metadata
├── package.json
└── pnpm-workspace.yaml
```

**crucible.json:**

```json
{
  "name": "scottish-trivia",
  "displayName": "Scottish Trivia",
  "description": "Test your knowledge of Scottish history!",
  "author": "prati@volley.com",
  "version": "0.1.0",
  "gameId": "scottish-trivia",
  "tile": {
    "imageUrl": "assets/tile.avif",
    "heroImageUrl": "assets/hero.avif"
  },
  "createdAt": "2026-03-24T12:00:00Z",
  "template": "hello-weekend",
  "templateVersion": "1.0.0"
}
```

**Vite config** — the template's `vite.config.ts` reads `gameId` from `crucible.json` and sets `base: '/${gameId}/display/'` (or `/controller/`). Without this, Vite builds assets with absolute root paths (`/assets/index.js`) which break when served from CloudFront at `/${gameId}/display/`.

**Socket.IO path** — the template's server `index.ts` configures Socket.IO with a game-specific path: `new Server(httpServer, { path: "/${gameId}/socket.io" })`. The display/controller clients must connect with the matching path: `io(serverUrl, { path: "/${gameId}/socket.io" })`. Without this, the ALB cannot route Socket.IO traffic to the correct game service (all games would try to use `/socket.io/`).

**Dockerfile** — generated by `crucible create`, parameterised with the game's package name. **Owned by Crucible, not by the game developer or agent.** This is critical: the Dockerfile has access to `NPM_TOKEN` during CI builds, so it must not be modifiable by untrusted code.

```dockerfile
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

### 3. Build & Publish Pipeline (CI-Driven)

**Builds happen in GitHub Actions, never on developer laptops.** The CLI's only job is to push code and trigger the pipeline.

**CI workflow** (`.github/workflows/crucible-deploy.yml`):

```yaml
name: Crucible Deploy
on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      environment:
        type: choice
        options: [dev, staging, prod]

env:
  ECR_REPO: 375633680607.dkr.ecr.us-east-1.amazonaws.com/crucible-games
  # GAME_ID extracted from crucible.json at runtime

jobs:
  quality-gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test

  build-and-deploy:
    needs: quality-gate
    runs-on: ubuntu-latest
    permissions:
      id-token: write  # OIDC for AWS
      contents: read
    steps:
      - uses: actions/checkout@v4

      # Extract game metadata from crucible.json
      - name: Read crucible.json
        id: meta
        run: |
          echo "GAME_ID=$(jq -r .gameId crucible.json)" >> "$GITHUB_ENV"
          echo "ENV=${{ inputs.environment || 'dev' }}" >> "$GITHUB_ENV"

      # Authenticate via OIDC — no long-lived credentials
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::375633680607:role/crucible-ci
          aws-region: us-east-1

      - uses: aws-actions/amazon-ecr-login@v2

      # Build + push Docker image (deterministic tag: gameId-sha-runNumber)
      - name: Build and push image
        run: |
          IMAGE_TAG="${GAME_ID}-${{ github.sha }}-${{ github.run_number }}"
          echo "IMAGE_TAG=${IMAGE_TAG}" >> "$GITHUB_ENV"
          docker build --secret id=npm_token,env=NPM_TOKEN \
            -t "${ECR_REPO}:${IMAGE_TAG}" .
          docker push "${ECR_REPO}:${IMAGE_TAG}"

      # Scan image (pinned action, not @master)
      - uses: aquasecurity/trivy-action@0.28.0
        with:
          image-ref: "${{ env.ECR_REPO }}:${{ env.IMAGE_TAG }}"
          severity: CRITICAL,HIGH
          exit-code: 1

      # Build + upload clients
      - name: Build and upload clients
        run: |
          pnpm --filter display build
          pnpm --filter controller build
          aws s3 sync apps/display/dist/ "s3://crucible-clients-${ENV}/${GAME_ID}/display/"
          aws s3 sync apps/controller/dist/ "s3://crucible-clients-${ENV}/${GAME_ID}/controller/"

      # Deploy to K8s via OIDC-authenticated kubectl
      - name: Deploy
        id: deploy
        run: crucible-deploy apply --game "$GAME_ID" --image "$IMAGE_TAG" --env "$ENV"

      # Post-deploy health check with automatic rollback
      - name: Verify
        id: verify
        run: crucible-deploy verify --game "$GAME_ID" --env "$ENV" --timeout 60s

      # Register in Crucible Registry — FAIL THE JOB if this fails
      # (prevents ghost deploys: live server but invisible on Proto-Hub)
      - name: Register
        id: register
        run: crucible-deploy register --game "$GAME_ID" --env "$ENV" --image "$IMAGE_TAG"

      # If register or verify failed after deploy succeeded, roll back
      - name: Compensating rollback
        if: failure() && steps.deploy.outcome == 'success'
        run: crucible-deploy rollback --game "$GAME_ID" --env "$ENV"
```

**What this gives us:**
- Immutable, content-addressed artifacts (deterministic tag: `gameId-sha-runNumber`, no clock dependency)
- Mandatory quality gate (lint + typecheck + test) before any deploy
- Image vulnerability scanning (pinned Trivy action, blocks critical/high CVEs)
- OIDC authentication to AWS (no long-lived credentials anywhere)
- Automated rollback on failed health checks OR failed registry writes (no ghost deploys)
- Full audit trail via GitHub Actions logs
- All env vars declared and exported via `GITHUB_ENV` (no cross-step leakage)

### 4. Crucible Registry API

Replaces the race-prone `manifest.json` read-modify-write on S3. A small service backed by DynamoDB.

**Why:** Two developers publishing at the same time would race on S3 manifest writes. DynamoDB gives us atomic conditional writes for free.

**API:**

| Endpoint | Method | Description |
|----------|--------|-------------|
| `GET /games` | GET | List all games (Proto-Hub reads this) |
| `GET /games/:gameId` | GET | Get one game's metadata + endpoints |
| `PUT /games/:gameId` | PUT | Register or update a game (CI writes this) |
| `DELETE /games/:gameId` | DELETE | Remove a game |
| `GET /games/:gameId/history` | GET | Version history (for rollback) |
| `POST /games/:gameId/activate` | POST | Signal pending join (triggers KEDA scale-up) |

**DynamoDB tables:**

```
# Game catalog (for GET /games listing — avoids Scan)
# Also stores activation leases as PK: "LEASE#{gameId}", SK: activationId
Table: crucible-game-catalog
PK: "CATALOG"
SK: gameId
Attributes: displayName, author, currentVersion (FK to versions table SK), status, updatedAt
# currentVersion is updated via conditional write: ConditionExpression: "currentVersion = :previousVersion"
# On conflict, CI retries with latest version. No ambiguity about what Proto-Hub sees.

# Game versions (for history + rollback)
Table: crucible-game-versions
PK: gameId
SK: version (zero-padded run number: "00000042-a1b2c3d")
Attributes: displayName, author, imageTag, endpoints, publishedAt, status
```

Current version is the latest item. History is queryable for rollback. Writes use conditional expressions to prevent conflicts.

Proto-Hub fetches `GET /games` on load (cached via CloudFront with short TTL) instead of reading a JSON file from S3.

### 5. Routing Model (LOCKED: Path-Based)

**Decision: single host, path-based routing for game servers.** Not per-game subdomains.

**Why:** One host = one TLS cert, one ALB, one DNS entry. Per-game subdomains would require wildcard certs and dynamic DNS management.

```
wss://crucible-games-{env}.volley-services.net
  │
  ├── /scottish-trivia/*  ──→  svc/scottish-trivia:80
  ├── /emoji-party/*      ──→  svc/emoji-party:80
  └── /word-scramble/*    ──→  svc/word-scramble:80
```

Client bundles are on a separate host (CloudFront):
```
https://crucible-clients-{env}.volley.tv
  │
  ├── /scottish-trivia/display/index.html
  ├── /scottish-trivia/controller/index.html
  └── /emoji-party/display/index.html
```

**Game registry endpoints (consistent everywhere):**

```json
{
  "endpoints": {
    "display": "https://crucible-clients-dev.volley.tv/scottish-trivia/display/index.html",
    "controller": "https://crucible-clients-dev.volley.tv/scottish-trivia/controller/index.html",
    "server": "wss://crucible-games-dev.volley-services.net/scottish-trivia"
  }
}
```

**WebSocket upgrade:** ALB configured with sticky sessions (cookie-based) and WebSocket support. For multi-replica games (2+ pods), **Socket.IO Redis adapter** is required — each game server connects to shared Redis and uses it as a pub/sub backplane for cross-replica room/event fanout. The Redis adapter is initialised in the standard `index.ts` server bootstrap template. During rolling deploys, old pods drain connections gracefully via `preStop` hook (30s drain period); clients reconnect to new pods via Socket.IO's built-in reconnection with sticky session affinity.

**Ingress management:** CI is the sole owner of ingress rules. Game servers do NOT self-register paths. Each game gets its **own Ingress object** (not a shared one), grouped onto the same ALB via `alb.ingress.kubernetes.io/group.name: crucible-{env}`. This eliminates concurrent write conflicts entirely — each game's Ingress is an independent K8s resource that CI creates/updates with no risk of clobbering another game's rules.

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ gameId }}
  namespace: crucible-{{ env }}
  annotations:
    alb.ingress.kubernetes.io/group.name: crucible-{{ env }}
    alb.ingress.kubernetes.io/scheme: internal
spec:
  ingressClassName: alb
  rules:
    - host: crucible-games-{{ env }}.volley-services.net
      http:
        paths:
          - path: /{{ gameId }}
            pathType: Prefix
            backend:
              service:
                name: {{ gameId }}
                port:
                  number: 80
```

**Scaling limits:** ALB ingress groups share a single ALB but each Ingress is independent. AWS ALB supports ~100 rules per group. At 200+ games, shard across multiple groups or migrate to an ingress controller (Nginx, Envoy). Not needed for v1.

### 6. Security & Isolation

#### Pod Identity (NOT Shared Service Account)

Each game deployment gets its own **IAM role scoped to its resources** using IAM Roles for Service Accounts (IRSA). The role is created by the CI deploy step from a template:

- **Redis:** Each game uses a key prefix (`{gameId}:*`) and a **channel prefix** (`{gameId}:*`) for Socket.IO adapter pub/sub. Redis ACLs enforce both key and channel prefix isolation — game A cannot read/write game B's keys or subscribe to game B's channels.
- **S3:** IAM condition restricts each game to `s3://crucible-clients-{env}/{gameId}/*` — cannot touch other games' client bundles.
- **ECR:** Pull-only. Games cannot push images.

**How this works without per-game Terraform:** The CI deploy step creates a K8s ServiceAccount annotated with a game-specific IAM role. The IAM role is created via a CloudFormation stack (or Terraform module) that the CI step invokes with the gameId as a parameter. This is automated, not manual.

#### Build Sandboxing

- **Dockerfile is immutable.** Generated by `crucible create`, committed to the repo. Protected by **GitHub Repository Rulesets** (not CODEOWNERS — CODEOWNERS only applies to PRs, not direct pushes). The ruleset restricts direct pushes to `Dockerfile`, `.github/**`, `.npmrc`, and `pnpm-lock.yaml` while allowing direct pushes to game source files. CI also validates the Dockerfile checksum against the template before building.
- **NPM_TOKEN** exists only in CI secrets, never on developer machines.
- **Image scanning** blocks deployment of images with critical/high vulnerabilities.

#### Network Policy

- Game pods can reach: shared Redis, and an **explicit allowlist** of external domains: `*.volley.tv`, `*.volley-services.net`, and specific AWS service VPC endpoints (S3, SSM, STS) — NOT `*.amazonaws.com` (too broad). All other egress is denied.
- Game pods cannot reach: other game pods, K8s API, internal services outside their namespace, or arbitrary internet hosts.
- Enforced via Kubernetes NetworkPolicy + DNS-based egress controls (e.g., Cilium network policies with FQDN rules).
- All egress is logged for audit.

#### Admission Control

- Only images from the `crucible-games` ECR repo are allowed in the `crucible-*` namespaces.
- Enforced via OPA/Gatekeeper admission policy.
- Pods run as non-root with read-only root filesystem and `drop: ALL` capabilities.

### 7. Scale-to-Zero (KEDA)

**The problem:** You can't poll `/health` on a pod that doesn't exist. Scaling from zero requires an *external* signal — something outside the game pod that knows "someone wants to play this game."

**Solution: Activation via Crucible Registry API + external metric.**

The scale-from-zero signal comes from Proto-Hub, not from the game pod:

1. User selects a game tile on Proto-Hub
2. Proto-Hub calls `POST /games/{gameId}/activate` on the Crucible Registry API with an **activation ID** (UUID, generated client-side). This is idempotent — re-POSTing the same ID is a no-op.
3. The Registry API creates a **lease** in DynamoDB: `{ activationId, gameId, createdAt, ttl: 60s }`. A DynamoDB TTL auto-deletes stale leases (handles abandoned activations, retries, multi-clicks).
4. The Registry API exposes a **`/metrics` endpoint** that Prometheus scrapes (5s scrape interval). On each scrape, the API counts non-expired leases per gameId in DynamoDB and returns `crucible_pending_activations{game_id="X"}` as a gauge. No separate Lambda, no Pushgateway, no remote write — just a standard Prometheus scrape target. This is the simplest path with the fewest moving parts.
5. KEDA watches that external metric — when `pendingActivations > 0`, it scales the game from 0 → 1
6. Once the pod is ready, Proto-Hub connects the WebSocket. The lease auto-expires via TTL (not actively deleted — deleting would require giving game pods DynamoDB write access, violating security boundaries). KEDA keeps desired replicas at 1 for the 60s lease window, preventing pod flap while clients connect.
7. For scale 1 → N (horizontal), KEDA uses the pod's own `crucible_active_sessions` Prometheus metric (pod exists, so scraping works)
8. For scale N → 0 (cooldown), KEDA watches `activeSessions` drop to 0 for the cooldown period

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: scottish-trivia
  namespace: crucible-dev
spec:
  scaleTargetRef:
    name: scottish-trivia
  minReplicaCount: 0
  maxReplicaCount: 5
  cooldownPeriod: 300  # 5 min after last session ends
  triggers:
    # Scale 0 → 1: external signal (pending join requests)
    - type: prometheus
      metadata:
        serverAddress: http://prometheus.monitoring.svc:9090
        query: crucible_pending_activations{game_id="scottish-trivia"}
        threshold: "1"
        activationThreshold: "1"  # Triggers scale-from-zero
    # Scale 1 → N: in-pod metric (active sessions)
    - type: prometheus
      metadata:
        serverAddress: http://prometheus.monitoring.svc:9090
        query: crucible_active_sessions{game_id="scottish-trivia"}
        threshold: "20"  # 20 sessions per replica
```

**Metric flow:**
- **Game servers** expose `/metrics` endpoint. Prometheus scrapes `crucible_active_sessions{game_id}` gauge. New game pods are discovered via **Kubernetes service discovery** (Prometheus `kubernetes_sd_configs` with namespace/label selectors on `crucible-*` namespaces). NetworkPolicy allows Prometheus scrape on the metrics port.
- **Registry API** exposes `/metrics` endpoint. Prometheus scrapes `crucible_pending_activations{game_id}` gauge (computed from non-expired DynamoDB leases).
- **Leases** auto-expire via DynamoDB TTL (60s). **IMPORTANT:** DynamoDB TTL background deletion can lag up to 48 hours. The `/metrics` query MUST filter `expiresAt > :now`, not rely on physical item deletion. Without this, expired leases will keep KEDA scaling pods indefinitely.

**Cold-start budget:** 5s Prometheus scrape interval + ~3s KEDA reaction + ~7s pod startup = ~15s. This is tight. If cold starts consistently exceed SLO, options: reduce scrape interval to 3s, or have the Registry API directly trigger a K8s scale-up via the K8s API as a fast path (with KEDA as the steady-state scaler).

**Lease storage:** Leases are stored in the **`crucible-game-catalog`** table using a separate entity type: `PK: "LEASE#{gameId}", SK: activationId`. DynamoDB TTL on a `ttl` attribute handles expiry. The `/metrics` endpoint queries leases with a `begins_with(PK, "LEASE#")` scan per game — acceptable at <200 games.

**KEDA multi-trigger semantics:** With two Prometheus triggers, KEDA takes the **maximum** desired replica count across all triggers. This means:
- At 0 replicas: `pending_activations > 0` → scales to 1. `active_sessions` query returns empty (no pod) → 0 desired. Max(1, 0) = 1. Correct.
- At 1+ replicas: `active_sessions` drives further scaling. `pending_activations` decays via TTL. Max(sessions-based, activations-based) = sessions-based. Correct.
- At cooldown: both metrics at 0 for `cooldownPeriod` → scale to 0. Correct.

**`/activate` abuse protection:** The endpoint requires a valid Proto-Hub SSO session token. Rate limited to 5 activations per user per minute. Without this, a script could wake every game and burn cluster resources.

**Cold start target:** < 15 seconds from activation request to first connection accepted. Measured and tracked.

**Warmup:** Proto-Hub shows a "Starting game..." spinner after calling `/activate`. It polls the game server's readiness endpoint. Once ready, it connects the WebSocket.

**Crash-loop behaviour:** If a game pod crash-loops (CrashLoopBackOff), KEDA does NOT scale to zero — K8s keeps retrying. A separate **circuit breaker** is needed: a CronJob or controller that detects crash-looping deployments and scales them to zero + marks them as `unhealthy` in the Registry API. Proto-Hub shows "Game unavailable" for unhealthy games.

### 8. Proto-Hub

A fork of Hub with surgical changes. **Long-term, this should be replaced by build flavours or feature flags in Hub itself** to avoid ongoing merge/rebase costs. For v1, the fork is acceptable because the changes are concentrated in a few files.

| Hub (shipping) | Proto-Hub (Crucible) |
|----------------|---------------------|
| Games hardcoded in `useGames.ts` | Games fetched from Crucible Registry API |
| Amplitude experiments for ordering | Simple alphabetical ordering |
| Paywall + subscription logic | Removed entirely |
| Platform SDK auth + billing | Platform SDK for device features only |
| GameOrchestration via Platform API | Direct URL construction from registry endpoints |
| No identity | Simple SSO sign-in |

**Key changes:**

1. **Replace `useGames.ts`** — fetch from Crucible Registry API, map to game tiles
2. **Replace game launch** — construct display URL from `endpoints.display`, pass server WebSocket URL as query parameter
3. **Strip paywall** — remove subscription/upsell logic
4. **Strip experiments** — remove Amplitude dependency
5. **Add SSO sign-in** — for attribution
6. **Add "Published by"** — show author on game tiles

**Fork maintenance strategy:** Keep Proto-Hub changes in clearly marked files/hooks. Track Hub releases and periodically rebase. Document the exact diff surface so rebases are predictable.

### 9. Template Drift Management

One-repo-per-game means template updates must be propagated. Strategy:

- **`crucible.json` records `templateVersion`** — the version of hello-weekend it was forked from.
- **`crucible update`** CLI command — applies template updates (Dockerfile, CI workflow, base dependencies) to an existing game. Uses a 3-way merge: original template → new template → game's current state.
- **Automated PRs** — a scheduled GitHub Action in the hello-weekend template repo creates PRs against all downstream game repos when the template changes (Dependabot-style).
- **Breaking changes** — template version bumps follow semver. Major bumps require manual intervention; minor/patch bumps auto-merge if tests pass.
- **Scope of template ownership:** Dockerfile, CI workflow, `index.ts` server bootstrap, base `tsconfig`, `eslint` config. Game-specific code (ruleset, reducers, phases, components) is never touched by template updates.

### 10. Identity & Auth Chain

One OIDC-based identity chain throughout:

```
Developer (Volley SSO)
  │
  ├── crucible login → OIDC token stored in OS keychain (not plaintext file)
  │     │
  │     ├── GitHub API → triggers CI (uses GitHub SSO identity)
  │     └── Crucible Registry API → authenticated via Volley SSO JWT
  │
  └── GitHub Actions CI
        │
        └── AWS OIDC → assumes crucible-ci IAM role
              │
              ├── ECR push
              ├── S3 upload
              ├── K8s deploy (via IRSA)
              └── Registry API write (via service JWT)
```

**No long-lived credentials anywhere.** CLI uses OIDC tokens in the OS keychain (refreshed automatically). CI uses GitHub's OIDC provider to assume AWS roles. No shared deploy keys, no `.env` files with secrets.

---

## Infrastructure Requirements

### One-time setup (serves all games):

| Resource | Repo | Description |
|----------|------|-------------|
| S3 buckets | volley-infra | `crucible-clients-{dev,staging,prod}` for game client bundles |
| CloudFront | volley-infra | CDN for game clients |
| ECR repo | volley-infra | `crucible-games` (shared, game-specific tags) |
| CI IAM role | volley-infra | `crucible-ci` — OIDC-based, used by GitHub Actions |
| K8s namespaces | kubernetes | `crucible-dev`, `crucible-staging`, `crucible-prod` |
| RBAC | kubernetes | CI service account with deployment permissions |
| NetworkPolicy | kubernetes | Restrict pod-to-pod and egress traffic |
| Admission policy | kubernetes | OPA/Gatekeeper — only crucible-games ECR images allowed |
| Redis | volley-infra | Shared ElastiCache with ACL-enforced key prefix isolation |
| ALB/Ingress | volley-infra-tenants | Shared ALB with path-based routing |
| Crucible Registry API | volley-infra-tenants | Two DynamoDB tables (catalog w/ leases + versions) + Lambda/container API with `/metrics` endpoint |
| Proto-Hub | volley-infra-tenants | Static hosting deployment |
| KEDA | kubernetes | Cluster-wide, ScaledObject templates for game deployments |

### Per-game (automated by CI, no human action):

| Resource | Created by | How |
|----------|-----------|-----|
| GitHub repo | `crucible create` | GitHub API |
| K8s Deployment + Service | CI pipeline | `kubectl apply` template |
| K8s ServiceAccount + IRSA | CI pipeline | CloudFormation/Terraform module |
| Ingress path rule | CI pipeline | Patch shared ingress |
| KEDA ScaledObject | CI pipeline | `kubectl apply` template |
| Registry entry | CI pipeline | Crucible Registry API |

---

## Failure Modes & Rollback

| Failure | Detection | Response |
|---------|-----------|----------|
| CI build fails (lint/test/type) | GitHub Actions check | Deploy blocked. Developer notified. |
| Image scan finds critical CVE | Trivy exit code | Deploy blocked. Developer notified. |
| K8s deployment fails to start | Readiness probe timeout | Automatic rollback to previous image digest. |
| Game server crashes after deploy | Liveness probe failure | K8s auto-restarts pod. If crash-loops (CrashLoopBackOff), circuit breaker controller scales to zero + marks game unhealthy in registry. |
| Registry API write fails | CI step failure | CI automatically rolls back the K8s deployment (compensating action). No ghost deploys. |
| Two publishes race | DynamoDB conditional write | Loser gets ConditionalCheckFailed, retries with latest version. |

**Rollback mechanism:** `crucible rollback <name>` queries the registry history, finds the previous healthy version, and triggers a CI run that re-deploys that image digest. Client bundles are also rolled back from S3 versioned buckets.

---

## SLOs & Targets

| Metric | Target | Measured by |
|--------|--------|-------------|
| Publish time (push → live) | < 5 minutes | CI pipeline duration |
| Cold start (zero → accepting connections) | < 15 seconds | KEDA → readiness probe |
| Proto-Hub manifest freshness | < 30 seconds after publish | Registry API → CloudFront TTL |
| Game launch (tile click → game visible) | < 3 seconds (warm), < 18 seconds (cold) | Telemetry TBD (Datadog RUM if instrumented) |
| Rollback time | < 2 minutes | CI pipeline duration |

---

## Phased Delivery

### Phase 1: Agent + Local Dev (de-risk the product bet first)
- [ ] `crucible create` — fork hello-weekend with parameterised template
- [ ] `crucible agent` — conversational game building via Claude
- [ ] `crucible dev` — local dev server (existing `pnpm dev`)
- [ ] Agent context: VGF docs, AGENTS files, hello-weekend source, Platform SDK docs
- [ ] **Agent file restrictions:** agent must NOT modify `Dockerfile`, `.github/workflows/*`, `pnpm-lock.yaml`, or `.npmrc`. Enforced via a CLAUDE.md rule in the game template + CI validation that checksums these files against the template.
- [ ] Validate: can a non-engineer describe a game and play it locally?

**Rationale:** The agent is the product bet. If it can't build playable games from natural language, the rest of the platform doesn't matter. De-risk this first.

### Phase 2: Shared Infrastructure
- [ ] S3 buckets, CloudFront, ECR repo (Terraform)
- [ ] K8s namespaces, RBAC, admission policies (OPA/Gatekeeper)
- [ ] NetworkPolicy with FQDN egress rules (requires Cilium CNI — verify cluster capability)
- [ ] Shared Redis with ACL-enforced key prefix isolation
- [ ] Shared ALB with path-based routing
- [ ] KEDA installation
- [ ] Crucible Registry API (DynamoDB + Lambda)
- [ ] CI IAM role (OIDC-based)

### Phase 3: Publish Pipeline
- [ ] `crucible publish` — push to git, trigger CI
- [ ] GitHub Actions workflow (lint → build → scan → push → deploy → verify → register)
- [ ] Per-game IRSA (automated via CI)
- [ ] Automated rollback on failed health checks
- [ ] `crucible rollback` command (with post-rollback health verification)
- [ ] `crucible promote` command
- [ ] `crucible logs` command
- [ ] Crash-loop circuit breaker controller (detects CrashLoopBackOff → scales to zero + marks unhealthy in registry)

### Phase 4: Proto-Hub
- [ ] Fork Hub → Proto-Hub
- [ ] Replace hardcoded games with Registry API
- [ ] Strip paywall, experiments, billing
- [ ] Add SSO sign-in
- [ ] QR code controller pairing via Platform SDK
- [ ] Deploy Proto-Hub

### Phase 5: Template Management
- [ ] `crucible update` — propagate template changes to existing games
- [ ] Automated template update PRs (scheduled GitHub Action)
- [ ] Template versioning + semver
- [ ] CODEOWNERS for Dockerfile + CI workflow

### Phase 6: Desktop App
- [ ] Electron/Tauri wrapper around CLI
- [ ] Project manager UI (list games, create, publish, status)
- [ ] Embedded agent chat interface
- [ ] Local preview in app window

---

## Resolved Decisions

| Question | Answer | Rationale |
|----------|--------|-----------|
| Server model | Container-per-game | Games are too architecturally different (ECS vs reducers) |
| Build/deploy authority | CI pipeline (GitHub Actions) | Immutable artifacts, audit trail, secret isolation |
| Routing model | Path-based on single host | One cert, one ALB, simpler than per-game subdomains |
| Game registry | DynamoDB-backed API, not S3 JSON file | Atomic writes, no race conditions |
| Pod identity | Per-game IRSA, not shared service account | Blast radius isolation |
| Redis isolation | Key prefix ACLs per game | Prevents cross-game data access |
| Dockerfile ownership | Crucible-owned, immutable, CODEOWNERS-protected | Prevents untrusted code influencing builds with NPM_TOKEN |
| CLI auth | OIDC tokens in OS keychain | No long-lived credentials |
| Git strategy | One repo per game | Clean isolation, independent CI pipelines |
| Template drift | `crucible update` + automated PRs | Prevents snowflake repos |
| Proto-Hub | Fork for v1, build flavours long-term | Pragmatic start, planned migration |
| Phase ordering | Agent first (de-risk product bet) | If agents can't build games, nothing else matters |
| Assets | Added during dev by user/agent | Part of game source, built into client bundles |
| Controller pairing | Platform SDK QR code service | Already built, works across all platforms |
| Auth/paywall | None. SSO for identity only | Internal tool |
| Scale | ~100 concurrent sessions | KEDA scale-to-zero for idle games |
| Activation model | Idempotent leases with DynamoDB TTL, SSO-authed, rate-limited | Prevents stuck scale-ups and abuse |
| KEDA trigger semantics | Max aggregation across two Prometheus triggers | External for 0→1, in-pod for 1→N |
| Metric ingestion | Prometheus scrape (game `/metrics` + Registry API `/metrics`) | Standard, no Pushgateway/remote write |
| Ingress isolation | Per-game Ingress objects, ALB group name for shared ALB | No concurrent write conflicts |
| Registry current version | Catalog table has single `currentVersion` attribute, updated via conditional write | No lexicographic ordering ambiguity |
| Scale-from-zero signal | External metric (Registry API → Prometheus), not in-pod polling | Can't poll a pod that doesn't exist |
| Scale 1→N + WebSocket | Socket.IO Redis adapter for cross-replica fanout | Required for multi-replica consistency |
| Registry versioning | Monotonic `{runNumber}-{commitSha}`, not timestamps | No clock skew, no replay ambiguity |
| Ingress ownership | CI-only via server-side apply with per-game field manager | No self-registration, no concurrent clobber |
| Ghost deploys | CI rolls back deployment if registry write fails | No live-but-invisible servers |
| Agent file restrictions | Cannot modify Dockerfile, CI workflows, lockfiles | Prevents build sandbox escape |
| Egress policy | Explicit domain allowlist, not open internet | Limits exfiltration surface |

---

## Open Questions

1. **Per-game IRSA automation:** Creating an IAM role per game in CI needs either a CloudFormation stack, a Terraform module invoked by CI, or a pre-provisioned role pool. Need to pick the mechanism and measure first-deploy latency impact on publish SLO.

2. **Redis ACL management:** Creating per-game Redis users with key prefix restrictions. Do we script this in CI, or use a Redis operator? Need to evaluate operational overhead at 50+ games.

3. **Proto-Hub → Hub convergence:** When should we stop maintaining the fork and move to build flavours/feature flags in mainline Hub? Proposed trigger: when Crucible reaches 10+ active games or when Hub's next major version ships.

4. **Cost model:** ECR storage × N games, CloudFront invalidations, Redis memory per game, Prometheus scrape overhead. Need estimates for 50 and 200 games.

5. **Load/chaos testing:** Need a validation plan for WebSocket reconnect storms during rolling deploys, cold-start bursts when multiple games scale from zero simultaneously, and Redis adapter behaviour under cross-replica fanout load.

6. **Conformance tests:** Need automated tests that verify route generation consistency (registry → Proto-Hub → ingress path) and per-game IAM/Redis isolation under adversarial behaviour.
