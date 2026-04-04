# Hub vs Proto-Hub VWR Initialisation Comparison

> **Date:** 2026-03-31
> **Purpose:** Find the specific difference that makes VWR show the Hub but not Proto-Hub

---

## Executive Summary

**The root cause is NOT in the code.** Both apps emit the same ready event with the same `source: "hub"` and `type: "ready"`. The problem is how VWR is configured to load Proto-Hub.

When Proto-Hub is set as `launchUrl` (via `--launch-url`), VWR treats it as a **game iframe**, not a Hub iframe. VWR creates the Hub iframe with special session context and RPC setup, but game iframes get a different lifecycle. Proto-Hub needs Hub-level treatment from VWR to work correctly.

**Fix:** Set Proto-Hub as the `hubUrl` in VWR config, not as `launchUrl`. Use `npx @volley/vwr-s3-cli edit` to change the `hubUrl` field to Proto-Hub's CloudFront URL.

This was already discovered and documented in learnings 057 and 058.

---

## Detailed Code Comparison

### 1. PlatformProvider Options

| Option | Hub (main.tsx) | Proto-Hub (main.tsx) | Impact |
|--------|----------------|---------------------|--------|
| `gameId` | `"hub"` (via PlatformRoute.Hub enum) | `"hub"` (hardcoded) | **Identical** |
| `appVersion` | `packageJson.version` | `packageJson.version` | Identical |
| `stage` | `PLATFORM_STAGE` | `PLATFORM_STAGE` | Identical source |
| `platformApiUrl` | `PLATFORM_API_URL` | `PLATFORM_API_URL` | Identical source |
| `platformAuthApiUrl` | `PLATFORM_AUTH_API_URL` | `PLATFORM_AUTH_API_URL` | Identical source |
| `readyEventTimeoutMs` | `30000` | `30000` | **Identical** |
| `tracking.segmentWriteKey` | `SEGMENT_WRITE_KEY` (has real key) | **MISSING** (not passed) | See section 5 |

### 2. Import Order and Side Effects

Both files import in the same order:
1. `./polyfills` (side effects: focus-visible, Element.animate patch, FinalizationRegistry, ResizeObserver, IntersectionObserver)
2. `./Global.scss`
3. `./utils/datadog`

The polyfill files are **byte-for-byte identical**.

### 3. Ready Event Mechanism

Both apps use `@volley/platform-sdk` with `gameId: "hub"`. Inside the SDK:

```
PlatformSDK constructor:
  → EventBrokerFactory.create() → new WebEventBroker({ gameId: "hub" })
  → createEventSource("hub") → isGame("hub") returns false → source = "hub"
  → eventBroker.emit("ready") → window.parent.postMessage({ source: "hub", type: "ready", args: [] }, "*")
```

Both apps emit **identical** ready events: `{ source: "hub", type: "ready", args: [] }`.

The ready event fires in the PlatformSDK **constructor** (synchronous), not in `init()` (async). It fires before any module initialisation that could fail.

### 4. SDK Version Mismatch

| | package.json declares | Actually installed |
|---|---|---|
| Hub | `7.48.1` | **7.40.3** (pnpm lockfile outdated) |
| Proto-Hub | `7.48.1` | **7.48.1** |

The Hub is running on SDK 7.40.3 while Proto-Hub has 7.48.1. Both versions have the same ready event logic (checked both `PlatformSDK.js` files). The v7.48.1 has additional modules (AppLifecycle RPC client/server, CodeMap) but the ready event path is identical.

### 5. Missing `tracking` Config

Hub passes:
```ts
tracking: {
    segmentWriteKey: SEGMENT_WRITE_KEY,  // "GplqCvL1EzLnZNpAHYGqObnDzrAtgoAS"
}
```

Proto-Hub does NOT pass `tracking` at all in `basePlatformOptions`.

**Impact:** The `tracking` option is declared `optional` in the SDK's Zod schema. Omitting it does not cause validation errors or constructor failures. The `TrackingFactory.create()` call still succeeds -- it just creates a tracking module without Segment integration. **This is NOT the cause of the VWR issue.**

### 6. App-Level Initialisation Differences

| Feature | Hub | Proto-Hub |
|---------|-----|-----------|
| `useExperimentInit` (Amplitude) | Yes -- gates initialisation | **Removed** -- hardcoded `experimentsReady: true` |
| `isPlatformReady` gates carousel | Yes | **No** -- carousel renders without platform readiness |
| Deeplink support | Yes (`getDeeplink()`) | Removed |
| Jeopardy reload | Yes (`useIsJeopardyReload`) | Removed |
| Web checkout / QR code | Yes | Removed |
| Device authorization | Yes | Removed |

Proto-Hub intentionally removed these because it doesn't need them. None of these affect the ready event.

### 7. VWR Configuration (The Actual Problem)

VWR's S3 config has two separate URL fields:

| Field | Purpose | Ready event source expected |
|-------|---------|---------------------------|
| `hubUrl` | The Hub iframe -- gets session context, RPC channel, key forwarding | `"hub"` |
| `launchUrl` | A game iframe -- launched by the Hub after it loads | `"platform-sdk-iframe-{gameId}"` |

When Proto-Hub is set as `launchUrl`:
- VWR loads the **regular Hub** at `hubUrl` (works fine)
- VWR loads Proto-Hub as a **game** at `launchUrl`
- VWR gives Proto-Hub game-level treatment (no session params, different RPC lifecycle)
- Proto-Hub sends ready with `source: "hub"` -- VWR may or may not recognise this as a game ready signal
- Even if VWR shows the iframe, Proto-Hub crashes because `volley_hub_session_id` is missing from the URL (game iframes receive session params from the Hub, not from VWR)

When Proto-Hub is set as `hubUrl`:
- VWR loads Proto-Hub as the Hub iframe with full session context
- Proto-Hub sends ready with `source: "hub"` -- VWR recognises this correctly
- Session ID is either injected by VWR or auto-generated (SDK's `isHub()` check)

### 8. Build Path Difference

| | Vite base path | Deploy location |
|---|---|---|
| Hub | `/hub/` | `s3://game-clients-*/hub/` |
| Proto-Hub | `/` | `s3://crucible-clients-*/protohub/` |

Different S3 buckets and CloudFront distributions. Proto-Hub's origin (`protohub-dev.volley.tv` or `crucible-clients-dev.*`) must be in VWR's `trustedDomains` list.

### 9. Environment Config Differences

Hub's `build-env-config.js` includes:
- `SEGMENT_WRITE_KEY` with real default key
- `DATADOG_APPLICATION_ID` with real default
- `DATADOG_CLIENT_TOKEN` with real default

Proto-Hub's `build-env-config.js` has:
- `SEGMENT_WRITE_KEY` defaults to `""`
- `DATADOG_APPLICATION_ID` defaults to `""`
- `DATADOG_CLIENT_TOKEN` defaults to `""`
- **Additional:** `BIFROST_API_URL` and `CRUCIBLE_REGISTRY_API_URL`

None of these affect VWR integration.

---

## Checklist of Fixes (from learnings 057/058)

Already resolved:
- [x] `gameId: "hub"` -- fixes session ID crash
- [x] Platform errors treated as non-fatal warnings
- [x] `isPlatformReady` no longer gates carousel rendering
- [x] CloudFront distribution for Proto-Hub
- [x] Vite base path `/` not `/hub/`
- [x] Amplitude vwr-enabled flag set
- [x] Set Proto-Hub as `hubUrl` not `launchUrl`

Still open:
- [ ] `BrowserIpc.connect` times out -- VWR RPC channel to Proto-Hub fails, blocking D-pad input forwarding
- [ ] Proto-Hub's origin must be in VWR's `trustedDomains` for RPC

---

## Files Compared

| File | Hub | Proto-Hub |
|------|-----|-----------|
| main.tsx | `C:\volley\dev\hub\apps\client\src\main.tsx` | `C:\volley\dev\ProtoHub\apps\client\src\main.tsx` |
| App.tsx | `C:\volley\dev\hub\apps\client\src\components\App.tsx` | `C:\volley\dev\ProtoHub\apps\client\src\components\App.tsx` |
| package.json | `C:\volley\dev\hub\apps\client\package.json` | `C:\volley\dev\ProtoHub\apps\client\package.json` |
| vite.config.ts | `C:\volley\dev\hub\apps\client\vite.config.ts` | `C:\volley\dev\ProtoHub\apps\client\vite.config.ts` |
| build-env-config.js | `C:\volley\dev\hub\apps\client\scripts\build-env-config.js` | `C:\volley\dev\ProtoHub\apps\client\scripts\build-env-config.js` |
| envconfig.ts | `C:\volley\dev\hub\apps\client\src\config\envconfig.ts` | `C:\volley\dev\ProtoHub\apps\client\src\config\envconfig.ts` |
| polyfills.ts | `C:\volley\dev\hub\apps\client\src\polyfills.ts` | `C:\volley\dev\ProtoHub\apps\client\src\polyfills.ts` |
| usePlatformReadiness.ts | `C:\volley\dev\hub\apps\client\src\hooks\usePlatformReadiness.ts` | `C:\volley\dev\ProtoHub\apps\client\src\hooks\usePlatformReadiness.ts` |
