# Learning 054: Prototype Deployment Pitfalls (Docker → Bifrost)

> **Date:** 2026-04-02
> **Context:** First deployment of Word Smiths game via `crucible prototype --docker`

## What Happened

Deployed a VGF game to Bifrost via `crucible prototype word-smiths --docker --port 8090 --ws-port 8090`. Hit multiple issues before the pod ran successfully.

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

## Prerequisites Checklist

Before running `crucible prototype --docker`:
- [ ] Docker Desktop running
- [ ] VPN connected (EKS cluster endpoint is private)
- [ ] `kubectl` configured: `aws eks update-kubeconfig --name shared-k8s-dev --region us-east-1`
- [ ] `GITHUB_TOKEN` set (e.g. `export GITHUB_TOKEN=$(gh auth token)`)
- [ ] `NPM_TOKEN` set (e.g. `export NPM_TOKEN=$(grep authToken ~/.npmrc | sed 's/.*=//')`)
- [ ] AWS credentials valid (not expired)

## Key Takeaway

The Dockerfile pattern in AGENTS-INFRA.md needs updating. The current template assumes `pnpm deploy --prod` and `node dist/index.js`, but:
1. Games use `moduleResolution: "bundler"` making compiled JS incompatible with Node ESM
2. Games have no production entry point (only `dev.ts`)
3. For prototypes, using `tsx` to run the TypeScript source directly is more reliable than running compiled JS
