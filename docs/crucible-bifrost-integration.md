# Crucible + Bifrost Integration

> **Status:** Proposal
> **Date:** 2026-03-27
> **Authors:** Pratik Patel, Claude Code

---

## Executive Summary

Crucible and Bifrost solve different halves of the same problem: getting a TV game from idea to running on real hardware. Crucible handles **code** (scaffolding, AI agent, local dev, CI/CD). Bifrost handles **infrastructure** (databases, caching, storage, container hosting). Together, they could eliminate the entire gap between "it works on my machine" and "it's running on a TV."

This document proposes integrating them so that a game developer's workflow is:

```
crucible create "Space Blaster"     # scaffold the code
crucible agent space-blaster        # AI writes the game
crucible dev space-blaster          # test locally
crucible prototype space-blaster    # live on K8s in seconds (Bifrost)
crucible publish space-blaster      # graduate to production (full pipeline)
```

---

## The Gap Today

Crucible's current workflow has a cliff between local dev and production:

```
Local Dev                              Production
(crucible dev)                         (crucible publish)
    │                                      │
    │  ← HERE BE DRAGONS →                │
    │                                      │
    │  Need: ECR image                     │
    │  Need: CI pipeline                   │
    │  Need: K8s namespace + HelmRelease   │
    │  Need: Flux GitOps sync              │
    │  Need: DNS                           │
    │  Need: Registry API entry            │
    │                                      │
    ▼                                      ▼
Works on localhost:3000              Works on crucible-games-dev.volley-services.net
Only you can see it                  Accessible on real TVs
```

This gap is Phase 2 + Phase 3 of Crucible's development plan — weeks of infrastructure work involving multiple repos, Terraform, Kubernetes configs, and CI pipelines. For a prototype that might be thrown away in a week, that's the wrong tradeoff.

Bifrost fills this gap.

---

## How They Fit Together

| Concern | Crucible | Bifrost | Together |
|---------|----------|---------|----------|
| **Code scaffolding** | Template engine, token replacement | — | Crucible |
| **AI code generation** | Claude agent with tool use | — | Crucible |
| **Local development** | 3-process orchestrator | — | Crucible |
| **Container building** | Dockerfile (production) | Buildpacks (prototype) | Both — Buildpacks for fast prototypes, Dockerfile for production |
| **Container registry** | ECR (AWS managed) | In-cluster registry | Bifrost for prototypes, ECR for production |
| **Infrastructure (DB, Redis, S3)** | — | Shared in-cluster services | Bifrost |
| **K8s deployment** | HelmRelease + Flux GitOps | GamePrototype CRD | Bifrost for prototypes, Flux for production |
| **DNS / routing** | external-dns + ALB | In-cluster service | Bifrost for prototypes, ALB for production |
| **CI/CD pipeline** | GitHub Actions | — | Crucible (production only) |
| **Game registry** | DynamoDB Registry API | — | Crucible (production only) |
| **Cleanup** | Manual | Finalizer-guarded automatic | Bifrost |

**Key insight:** Application code doesn't change between Bifrost and production. Bifrost's MinIO speaks S3 API, its Postgres is wire-compatible with RDS, its Redis is protocol-identical to ElastiCache. The same game binary runs in both environments — only the connection strings differ.

---

## The VGF Challenge

VGF games aren't single-container services. They have three components:

| Component | What It Is | Port | Protocol |
|-----------|-----------|------|----------|
| Server | WGFServer (Node.js, WebSocket) | 8090 | HTTP + Socket.IO |
| Display | TV screen (Vite React, static files) | 3000 | HTTP |
| Controller | Phone UI (Vite React, static files) | 5174 | HTTP |

Bifrost's `GamePrototype` CRD currently models a single container with one port. VGF games need three services with specific routing (Socket.IO paths, CORS between display/controller/server).

### Proposed Solutions (pick one)

**Option A: Single-container prototype mode**

For prototypes, bundle everything into one container. The WGFServer serves the display and controller as static files on different paths:

```
/:gameId/                    → WGFServer (WebSocket + API)
/:gameId/display/            → Display static files
/:gameId/controller/         → Controller static files
/:gameId/socket.io           → Socket.IO transport
```

This is the simplest path. Crucible would add a `build:prototype` script that:
1. Builds display + controller with `vite build`
2. Copies the static output into the server's `public/` directory
3. Configures the server to serve them

The Bifrost `GamePrototype` then needs only one container:

```yaml
apiVersion: volley.weekend.com/v1alpha1
kind: GamePrototype
metadata:
  name: space-blaster
spec:
  image: registry.prototypes.svc.cluster.local/space-blaster:latest
  port: 8090
  dependencies:
    cache:
      type: redis
  env:
    - name: STAGE
      value: prototype
```

**Pros:** Works with Bifrost as-is. No CRD changes needed.
**Cons:** Slightly different from production architecture (separate containers per service).

**Option B: Multi-service GamePrototype**

Extend the `GamePrototype` CRD to support multiple containers:

```yaml
apiVersion: volley.weekend.com/v1alpha1
kind: GamePrototype
metadata:
  name: space-blaster
spec:
  services:
    server:
      image: registry.prototypes.svc.cluster.local/space-blaster-server:latest
      port: 8090
    display:
      image: registry.prototypes.svc.cluster.local/space-blaster-display:latest
      port: 3000
    controller:
      image: registry.prototypes.svc.cluster.local/space-blaster-controller:latest
      port: 5174
  routing:
    - path: /:gameId/socket.io
      service: server
    - path: /:gameId/display
      service: display
    - path: /:gameId/controller
      service: controller
  dependencies:
    cache:
      type: redis
```

**Pros:** Matches production architecture exactly. Better parity.
**Cons:** Requires Bifrost CRD changes. More complex operator logic. Three Buildpack builds per game.

**Option C: Bifrost VGF preset**

Add a `type: vgf-game` to Bifrost that understands the three-service pattern:

```yaml
apiVersion: volley.weekend.com/v1alpha1
kind: GamePrototype
metadata:
  name: space-blaster
spec:
  type: vgf-game
  source:
    repo: https://github.com/Volley-Inc/crucible-game-space-blaster
    ref: main
  dependencies:
    cache:
      type: redis
```

Bifrost would know that `vgf-game` means: build three images (server, display, controller) from the monorepo, set up Socket.IO routing, configure CORS, and wire up the Platform SDK URLs.

**Pros:** Best developer experience. Bifrost understands the game model.
**Cons:** Tight coupling between Bifrost and VGF. Requires Bifrost to understand Volley's game architecture.

### Recommendation

**Start with Option A** (single-container prototype). It works today with no Bifrost changes, proves the integration value, and the prototype fidelity loss is acceptable. Move to Option C if Bifrost becomes the standard path and the operator team is willing to add VGF awareness.

---

## Crucible CLI Changes

### New command: `crucible prototype`

```bash
crucible prototype <game-id> [--watch] [--dependencies <deps>]
```

**What it does:**
1. Builds the game into a single container (server + static clients)
2. Pushes to the in-cluster registry (`registry.prototypes.svc.cluster.local`)
3. Generates and applies a `GamePrototype` CRD
4. Waits for Bifrost to reconcile
5. Prints the prototype URL

**Example:**

```
$ crucible prototype space-blaster

  Building prototype...
    ✓ Display built (2.1s)
    ✓ Controller built (1.8s)
    ✓ Server bundled with static clients (3.4s)
    ✓ Image pushed to in-cluster registry (1.2s)
    ✓ GamePrototype applied

  ✓ Prototype running!
    Server:     http://space-blaster.space-blaster-prototype.svc.cluster.local:8090
    Display:    http://space-blaster.space-blaster-prototype.svc.cluster.local:8090/display/
    Controller: http://space-blaster.space-blaster-prototype.svc.cluster.local:8090/controller/

  Prototype will be cleaned up automatically when the GamePrototype is deleted.
```

**`--watch` flag:** Rebuilds and redeploys on file changes (like `crucible dev` but on the cluster instead of localhost).

**`--dependencies` flag:** Declares infrastructure dependencies:
```bash
crucible prototype space-blaster --dependencies scores:postgres,cache:redis,assets:s3
```

### Changes to existing commands

**`crucible create`:**
- No changes needed. The template already produces code that works in both environments.

**`crucible publish`:**
- Becomes the "graduation" command. Moves from Bifrost prototype to full production pipeline.
- Could add a `--from-prototype` flag that pre-populates the first deployment based on the working prototype config.

**`crucible dev`:**
- No changes. Local dev stays as-is.

---

## The Game Lifecycle

```
┌─────────────────────────────────────────────────────────────────────┐
│                        PROTOTYPE PHASE                              │
│                     (Bifrost, low SLO)                               │
│                                                                     │
│  create ──→ agent ──→ dev ──→ prototype ──→ iterate ──→ decide      │
│                                                          │    │     │
│                                                     keep it  kill   │
│                                                          │    │     │
│                                                          ▼    ▼     │
│                                                     graduate  done  │
│                                                          │          │
└──────────────────────────────────────────────────────────│──────────┘
                                                           │
┌──────────────────────────────────────────────────────────│──────────┐
│                       PRODUCTION PHASE                    │          │
│                    (AWS, high SLO)                        │          │
│                                                          ▼          │
│  publish ──→ CI pipeline ──→ ECR ──→ K8s ──→ Registry ──→ Proto-Hub│
│                                                                     │
│  promote ──→ staging ──→ prod                                       │
│                                                                     │
│  rollback ──→ previous version                                      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Prototype phase:** Fast iteration. Seconds to deploy. Shared infra. Best-effort reliability. AI agent writes code, you see it on a real TV immediately.

**Production phase:** Full pipeline. Minutes to deploy. Dedicated AWS resources. High reliability. Real users playing on Proto-Hub.

**Graduation:** When a prototype has legs, `crucible publish` transitions it to the production path. The code doesn't change — only the infrastructure and deployment mechanism.

---

## Infrastructure Comparison

| Resource | Prototype (Bifrost) | Production (Crucible) |
|----------|-------------------|---------------------|
| Container registry | In-cluster (`registry.prototypes.svc`) | ECR (`crucible-games`) |
| Container build | Buildpacks (automatic) | Dockerfile (controlled) |
| Database | Shared Postgres in-cluster | Dedicated RDS |
| Cache | Shared Redis in-cluster | Dedicated ElastiCache |
| Object storage | MinIO in-cluster | S3 |
| DNS | `*.prototype.svc.cluster.local` | `crucible-games-{env}.volley-services.net` |
| Client hosting | Served by game server | S3 + CloudFront |
| CI/CD | None — direct push | GitHub Actions pipeline |
| Deployment | `kubectl apply` GamePrototype CRD | Flux GitOps |
| Cleanup | Automatic (finalizer) | Manual (`crucible rollback` / delete) |
| SLO | Best effort | Production-grade |

---

## What Needs to Happen

### Bifrost Side (prerequisites)

1. **Bifrost operator deployed** to `shared-k8s-dev` cluster
2. **Shared infrastructure** running (Postgres, Redis, MinIO, in-cluster registry)
3. **GamePrototype CRD** registered
4. **Network routing** for prototype services (ingress or in-cluster)

### Crucible Side (implementation)

| Work Item | Size | Dependencies |
|-----------|------|-------------|
| `crucible prototype` command scaffold | S | Bifrost CRD spec |
| Single-container build mode (`build:prototype`) | M | None |
| In-cluster registry push (`crane` or `docker push`) | S | Bifrost registry running |
| GamePrototype CRD generation from crucible.json | S | Bifrost CRD spec |
| `--watch` mode (file watcher + rebuild + redeploy) | M | Prototype command |
| `--dependencies` flag → CRD dependencies | S | Prototype command |
| Integration tests with Bifrost | M | Bifrost running on dev cluster |

**Estimated total:** ~1 sprint of work on the Crucible side, assuming Bifrost is deployed.

### Timeline

This integration is **not blocking** Crucible's current roadmap. The full publish pipeline (Phase 2/3) works independently. Bifrost integration would be a **parallel enhancement** that makes the prototype-to-production gap smoother.

**Suggested phasing:**
1. **Now:** Continue Crucible Phase 2/3 (full production pipeline)
2. **When Bifrost deploys:** Add `crucible prototype` as a fast path for early-stage games
3. **Later:** If Bifrost becomes the standard prototype path, consider Option C (VGF-aware operator)

---

## Open Questions

1. **Cluster access for `crucible prototype`:** Does the developer need kubectl access, or should Crucible talk to a Bifrost API gateway?
2. **Device testing:** Can prototypes be accessed from Fire TVs and phones on the Volley VPN, or only in-cluster? This affects whether prototypes are useful for QA.
3. **Build location:** Should Buildpack builds happen locally (developer's machine) or in-cluster (Bifrost triggers the build)? In-cluster is faster for iteration but requires source access.
4. **Proto-Hub integration:** Bifrost explicitly excludes game registration with the hub. Should `crucible prototype` register with Proto-Hub (even as a "prototype" status), or is it purely developer-facing?
5. **VGF Platform SDK:** Prototype URLs will differ from production. How does the Platform SDK discover the prototype server? Does `ensureLocalHubSessionId()` work against Bifrost-hosted games?

---

## Summary

Crucible and Bifrost are naturally complementary. Crucible owns the **code lifecycle** (create → build → publish → promote). Bifrost owns the **infrastructure lifecycle** (provision → wire → cleanup). Integrating them gives Volley's game developers the fastest possible path from idea to playable prototype — measured in seconds, not days.

The integration is non-blocking for either project. Crucible's production pipeline works without Bifrost, and Bifrost works without Crucible. But together, they close the gap that currently exists between local dev and production deployment.
