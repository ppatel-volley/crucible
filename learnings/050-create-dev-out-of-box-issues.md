# Issues Found: crucible create + dev flow

> **Date:** 2026-03-31
> **Context:** First real end-to-end test of `crucible create` + `crucible dev` with hello-weekend template

## Issues to fix (for out-of-box experience)

### 1. Template clone filter doesn't exclude nested node_modules
**File:** `packages/crucible/src/template/engine.ts`
**Issue:** The `cp` filter only checked top-level path segments. `apps/controller/node_modules` was not excluded because the top-level segment is `apps`.
**Fix applied:** Changed filter to check all path segments with `segments.includes("node_modules")`.
**Status:** Fixed in current code but not yet committed to a PR.

### 2. Windows path backslashes in config.json
**File:** `~/.config/crucible/config.json` (or %APPDATA%)
**Issue:** `"path": "C:\\volley\\dev\\hello-weekend"` — the backslashes get mangled through JSON parse + Node.js path handling. Forward slashes work: `"path": "C:/volley/dev/hello-weekend"`.
**Fix:** Use forward slashes in config, or normalise paths in the config loader.
**Status:** Worked around in config file, code fix needed.

### 3. Shared package needs building before dev
**Issue:** `pnpm install` + `crucible dev` isn't enough. The shared TypeScript package needs `tsc -b` first to produce `dist/` output that the server/display/controller import.
**Fix options:**
- Add a `predev` script to the template that builds shared first
- Or use `tsx` path mapping so dev mode doesn't need compiled output
- Or add a build step to `crucible dev` before starting processes
**Status:** Not fixed. Manual `pnpm --filter @cosmic-blasters/shared build` required.

### 4. tsconfig.base.json `skipLibCheck` not set
**Issue:** `tsc -b` in the shared package fails with type errors from vite/vitest dependencies.
**Fix:** Add `"skipLibCheck": true` to the template's `tsconfig.base.json`.
**Status:** Worked around with explicit `--skipLibCheck` flag.

### 5. Orchestrator readiness regex doesn't match JSON logs
**File:** `packages/crucible/src/dev/orchestrator.ts`
**Issue:** VGF server outputs JSON logs (`{"msg":"server started"}`). The readiness regex `/started on|listening on|ready/i` matches within the JSON string, but the process was crashing before the orchestrator's 30s timeout due to port conflicts.
**Fix:** This mostly works — the real issue was stale processes on ports. But the regex should also check for JSON log patterns like `"msg":".*started"`.
**Status:** Works when ports are clean. Could be more robust.

### 6. GitHub repo creation fails for personal accounts
**File:** `packages/crucible/src/api/github.ts`
**Issue:** Uses `repos.createInOrg` which returns 404 for personal GitHub accounts (not orgs).
**Fix options:**
- Detect if githubOrg is a user vs org and use the appropriate API
- Or use `repos.createForAuthenticatedUser` when org matches the token owner
**Status:** Config workaround (use `Volley-Inc` org). Code fix needed for personal accounts.

### 7. Ruleset application requires admin permissions
**File:** `packages/crucible/src/api/github.ts`
**Issue:** `applyProtectionRulesets` returns 422 when the token doesn't have admin perms on the org.
**Fix applied:** Made rulesets best-effort (catch and ignore errors). Repo still created successfully.
**Status:** Fixed — rulesets are now best-effort.

### 8. NPM_TOKEN warning
**Issue:** `.npmrc` in the template references `${NPM_TOKEN}` which isn't set for local dev.
**Fix:** The warning is harmless (pnpm still works). Could set a dummy token or conditionalise the .npmrc.
**Status:** Not fixed. Warning only, doesn't break anything.

### 9. Display/Controller need sessionId query param
**Issue:** Opening `http://localhost:3000` shows "connecting" forever. The VGF display and controller providers read `sessionId` from the URL query string. Without it, the server rejects the WebSocket connection.
**Fix:** Must open with `?sessionId=dev-test`:
- Display: `http://localhost:3000?sessionId=dev-test`
- Controller: `http://localhost:5174?sessionId=dev-test`
The dev server pre-creates a `dev-test` session via `setInterval`. This should be documented in the `crucible dev` output and the user guide.
**Status:** Not fixed. `crucible dev` prints URLs without the query param.

## Recommended priority

1. **Shared package auto-build** (blocks dev experience)
2. **sessionId in dev URLs** (blocks first-time users — `crucible dev` should print URLs with `?sessionId=dev-test`)
3. **Path normalisation in config** (blocks Windows users)
4. **Personal account support in create** (blocks solo developers)
5. **skipLibCheck in template** (blocks shared package build)
6. Rest are nice-to-haves
