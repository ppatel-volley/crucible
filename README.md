# Crucible

A Unity/Unreal-style project manager for building, testing, and publishing Volley TV games using AI agents. Internal tool. CLI-first, desktop app later.

## What It Does

Users describe what they want in natural language. AI agents build it from a starter template. The finished game appears as a tile on Proto-Hub, playable on any Volley-supported TV platform.

```
crucible create "Scottish Trivia"
crucible agent scottish-trivia        # AI builds the game
crucible dev scottish-trivia          # Preview locally
crucible publish scottish-trivia      # Deploy to Proto-Hub
```

## Architecture

- **Container-per-game** — each game runs in its own Docker container on K8s for full process isolation
- **CI-driven deploys** — GitHub Actions builds, scans, and deploys; no manual infra work per game
- **Scale-to-zero** — KEDA scales idle games to 0 replicas; activation leases trigger scale-up in ~15s
- **Path-based routing** — single ALB, per-game Ingress objects, `/{gameId}/socket.io` for WebSocket
- **DynamoDB Registry API** — atomic game registration, no race conditions, Prometheus metrics for KEDA
- **OIDC everywhere** — no long-lived credentials; CLI uses Volley SSO, CI uses GitHub OIDC federation

## Documentation

| Document | Purpose |
|----------|---------|
| [`docs/architecture.md`](docs/architecture.md) | Full architecture plan (v2) |
| [`docs/tdd-cli.md`](docs/tdd-cli.md) | CLI Technical Design Document |
| [`docs/tdd-infrastructure.md`](docs/tdd-infrastructure.md) | Infrastructure Technical Design Document |
| [`BUILDING_TV_GAMES.md`](BUILDING_TV_GAMES.md) | VGF/WGF patterns and gotchas |
| [`AGENTS-INFRA.md`](AGENTS-INFRA.md) | Volley K8s infrastructure deployment guide |

## Delivery Phases

| Phase | Focus | Status |
|-------|-------|--------|
| 1 | Agent + Local Dev | **TDD complete** |
| 2 | Shared Infrastructure (S3, ECR, DynamoDB, K8s, KEDA, Registry API) | TDD complete |
| 3 | Publish Pipeline (CI, IRSA, deploy, rollback) | TDD complete |
| 4 | Proto-Hub (game launcher frontend) | TDD complete |
| 5 | Template Management (drift, updates) | TDD complete |
| 6 | Desktop App (Electron) | TDD complete |

## Tech Stack

- **CLI:** Node.js, TypeScript, Commander.js, Claude API
- **Game Server:** WGFServer (`@volley/vgf`), Socket.IO, Redis adapter
- **Game Clients:** React, Vite, Platform SDK
- **Infrastructure:** AWS EKS, KEDA, DynamoDB, Lambda, S3, CloudFront, ALB
- **CI/CD:** GitHub Actions, OIDC federation, Trivy scanning
- **Template:** hello-weekend (monorepo: server + display + controller + shared)

## Agent Communication

Cross-tool agent messaging via `.agent-comms/` directory. See [`skills/comms/SKILL.md`](skills/comms/SKILL.md) for the protocol.

## AI Agent Configuration

| File | Purpose |
|------|---------|
| [`CLAUDE.md`](CLAUDE.md) | Claude Code entry point |
| [`AGENTS.md`](AGENTS.md) | Core behavioural guidelines |
| [`AGENTS-PROJECT.md`](AGENTS-PROJECT.md) | Project-specific commands and triggers |
| [`AGENTS-REACT-TS.md`](AGENTS-REACT-TS.md) | React/TypeScript patterns |
| [`AGENTS-INFRA.md`](AGENTS-INFRA.md) | Infrastructure deployment guide |
| [`AGENTS-THREEJS.md`](AGENTS-THREEJS.md) | Three.js/WebGL (load only for 3D tasks) |
| [`.cursorrules`](.cursorrules) | Cursor AI configuration (mirrors CLAUDE.md) |
