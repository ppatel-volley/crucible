# Learning 054: Prototype Deployment Pitfalls (Docker → Bifrost)

> **Date:** 2026-04-02
> **Context:** First deployment of Word Smiths game via `crucible prototype --docker`

## What Happened

Deployed a VGF game to Bifrost via `crucible prototype word-smiths --docker --port 8090`. Hit 11 issues before the game was fully playable from Proto-Hub.

## Issues & Fixes (in order encountered)

### 1. Docker build fails — npm auth for `@volley/*` packages
**Symptom:** `ERR_PNPM_FETCH_404` on `@volley/logger` during Docker build.
**Root cause:** `buildGameImage()` in `registry.ts` didn't pass `--secret id=npm_token,env=NPM_TOKEN` to `docker build`. The Dockerfile's `.npmrc` uses `${NPM_TOKEN}` but the secret was mounted as a file, not an env var.
**Fix (Crucible CLI):** Add `--secret` and `env: { ...process.env }` to the `execa` call.
**Fix (Dockerfile):** `RUN --mount=type=secret,id=npm_token NPM_TOKEN=$(cat /run/secrets/npm_token) pnpm install --frozen-lockfile`

### 2. `ImagePullBackOff` — wrong platform architecture
**Symptom:** Pod stuck in `ImagePullBackOff` with "no match for platform in manifest".
**Root cause:** Docker built an ARM image on Apple Silicon Mac, but EKS nodes are x86_64.
**Fix:** Add `--platform linux/amd64` to `docker build` in `buildGameImage()`. **Always build for linux/amd64 when targeting EKS.**

### 3. `pnpm build` builds all workspaces including display/controller
**Symptom:** TypeScript errors in apps/display and apps/controller (missing types, node_modules not hoisted).
**Root cause:** `RUN pnpm build` builds all workspace packages. Display/controller have browser dependencies not available in Docker.
**Fix:** Scope the build: `pnpm --filter=@<game>/shared build && pnpm --filter=@<game>/server build`

### 4. `pnpm deploy` incompatible with pnpm v10
**Symptom:** `ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE`
**Root cause:** pnpm v10 changed deploy defaults.
**Fix:** Add `--legacy` flag: `pnpm deploy --legacy --filter=...`

### 5. `Cannot find module 'dist/index.js'`
**Symptom:** Pod crashes with MODULE_NOT_FOUND.
**Root cause:** Games only have `dev.ts`, no production `index.ts` entry point.
**Fix:** Use `dev.ts` as entry point for prototypes (they're dev environments).

### 6. ESM extensionless imports fail in Node.js
**Symptom:** `ERR_MODULE_NOT_FOUND: Cannot find module '/app/dist/ruleset'`
**Root cause:** `tsconfig.base.json` uses `"module": "ESNext"` + `"moduleResolution": "bundler"` which allows extensionless imports in source. The compiled JS retains these, but Node.js ESM requires `.js` extensions.
**Fix:** Use `tsx` to run the compiled server — it handles ESM resolution. The CMD becomes:
```
CMD ["./apps/server/node_modules/.bin/tsx", "apps/server/src/dev.ts"]
```
Alternative: change to `"moduleResolution": "nodenext"` (requires adding `.js` extensions to all imports).

### 7. `shared/tsconfig.json` has `composite: false`
**Symptom:** `error TS6306: Referenced project must have setting "composite": true`
**Fix:** Set `"composite": true` in `packages/shared/tsconfig.json`.

### 8. `--port` silently ignored — Commander.js `parseInt` radix bug
**Symptom:** CRD had `spec.port: 3000` despite passing `--port 8090`. Service routed to wrong port → 502 Bad Gateway from ALB.
**Root cause:** Commander passes the previous/default value as the second argument to the parse function. `.option("--port <port>", "desc", parseInt, 3000)` calls `parseInt("8090", 3000)`. JavaScript's `parseInt` treats the second arg as a radix — 3000 is invalid, so it returns `NaN`. `NaN ?? 3000` is still `NaN` (not null/undefined), and `if (NaN)` is falsy, so port was silently omitted from the CRD YAML. Bifrost then defaulted to 3000.
**Fix:** Use explicit radix: `(v: string) => parseInt(v, 10)`.
**Lesson:** Never pass bare `parseInt` as a Commander parse function. Always wrap it.

### 9. Display/controller not served — server-only Docker image
**Symptom:** Proto-Hub iframe loads but shows black screen. `GET /` returns plain "OK" (health check), not HTML.
**Root cause:** The Dockerfile only built the server. Display and controller Vite apps weren't built or served. VGF dev mode runs 3 separate processes; the Docker container only ran the server.
**Fix (Dockerfile):** Build all workspace packages including display and controller:
```
RUN pnpm --filter=@<game>/shared build \
    && pnpm --filter=@<game>/server build \
    && pnpm --filter=@<game>/display build \
    && pnpm --filter=@<game>/controller build
```
**Fix (server):** Add Express static middleware in `dev.ts`:
```typescript
app.use("/controller", express.static(controllerDist))
app.use(express.static(displayDist))  // display at root
```

### 10. Session ID mismatch — "Connecting" stuck in Proto-Hub
**Symptom:** Display HTML loads, Socket.IO handshake succeeds, but game stuck on "Connecting" / lobby never enters.
**Root cause:** Proto-Hub sends `?sessionId=local-dev-hub-session` but `dev.ts` only pre-creates a `dev-test` session. VGF rejects the connection because the requested session doesn't exist.
**Fix:** Add Socket.IO middleware to auto-create sessions on demand:
```typescript
io.use((socket, next) => {
    const sessionId = socket.handshake.query.sessionId as string | undefined
    if (sessionId && !storage.doesSessionExist(sessionId)) {
        storage.createSession({ sessionId, members: {}, state: game.setup() })
    }
    next()
})
```
**Lesson:** In prototype mode, any sessionId should work. Never hardcode session names.

### 11. Duplicate Service port — `--port` and `--ws-port` same value
**Symptom:** `GamePrototype` status `Failed` with `Duplicate value: core.ServicePort{... Port:8090}`.
**Root cause:** VGF serves HTTP and WebSocket on the same port. Passing `--port 8090 --ws-port 8090` creates two identical Service port entries.
**Fix:** For VGF games, use `--port 8090` only (no `--ws-port`).

## Prerequisites Checklist

Before running `crucible prototype --docker`:
- [ ] Docker Desktop running
- [ ] VPN connected (EKS cluster endpoint is private)
- [ ] `kubectl` configured: `aws eks update-kubeconfig --name shared-k8s-dev --region us-east-1`
- [ ] `GITHUB_TOKEN` set (e.g. `export GITHUB_TOKEN=$(gh auth token)`)
- [ ] `NPM_TOKEN` set (e.g. `export NPM_TOKEN=$(grep authToken ~/.npmrc | sed 's/.*=//')`)
- [ ] AWS credentials valid (not expired)

## Correct Deploy Command

For VGF games, the correct invocation is:
```bash
crucible prototype <game-id> --docker --port 8090
```
Do NOT use `--ws-port` when it's the same as `--port` (VGF serves both on one port).

## Key Takeaways

1. **Dockerfile must build ALL workspace packages** (shared, server, display, controller) and serve static files from Express — not just the server.
2. **Use `tsx` to run the server** — `moduleResolution: "bundler"` produces extensionless imports incompatible with Node ESM.
3. **Never pass bare `parseInt` to Commander.js** — it receives the previous value as a second arg, which `parseInt` treats as radix.
4. **Sessions must be auto-created on demand** — Proto-Hub sends its own sessionId, not the hardcoded `dev-test`.
5. **Always build with `--platform linux/amd64`** — Apple Silicon builds produce ARM images that fail on EKS.
