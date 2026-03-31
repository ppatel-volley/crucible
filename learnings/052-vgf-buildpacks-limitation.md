# VGF Games Cannot Be Built by Buildpacks

**Date:** 2026-03-31
**Context:** Attempted to deploy Cosmic Blasters (VGF game) to Bifrost via Buildpacks

## Problem

VGF games from the hello-weekend template are pnpm monorepos with workspace dependencies:
- `apps/server/` — WGFServer (imports from `@game/shared`)
- `apps/display/` — Vite React app (imports from `@game/shared`)
- `apps/controller/` — Vite React app (imports from `@game/shared`)
- `packages/shared/` — shared types and state

Buildpacks (Paketo Node.js) detect the root `package.json` but:
1. Don't understand pnpm workspaces
2. Can't find a start script at the root (`server.js`, `app.js`, `index.js`)
3. Can't install workspace dependencies
4. Error: "could not find app in /workspace: expected one of server.js | app.js | main.js | index.js"

## What works

Simple single-package Node.js apps (like Space Invaders) work perfectly with Buildpacks.

## Workarounds for VGF games

1. **Docker-based deploy** — use the game's existing Dockerfile (`spec.image` instead of `spec.source`). Requires Docker Desktop running locally. Push to `bifrost-registry.volley-services.net`.
2. **Procfile** — add `web: npx tsx apps/server/src/dev.ts` at root. Buildpacks detects this but `npm install` still won't resolve pnpm workspace deps.
3. **Single-container build script** — bundle server + static clients into one container before pushing.

## Recommendation

For VGF games on Bifrost, use the Docker-based path until Bifrost adds pnpm workspace support to their build pods.

For simple prototypes/demos, Buildpacks works great.
