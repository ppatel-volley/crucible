# Questions for Platform Engineering — Proto-Hub + VWR Integration

> **Date:** 2026-04-04 (updated)
> **From:** Crucible team (Pratik + agents)
> **Priority:** Medium — informational, most blockers resolved

---

## Status Update (2026-04-04)

**Proto-Hub (Foundry) is live on Fire TV!** Carousel renders, D-pad navigation works, hero images display. Key fixes that got us here:

1. **`trustedOrigins` in PlatformProvider** (PR #19) — added `game-clients-dev/staging/prod` origins, fixing BrowserIpc handshake
2. **Deferred image preloading** (PR #21) — Fire TV SDK 28 fails some AVIF image decode operations, blocking carousel render
3. **`gameId: "hub"`** — fixes session ID auto-generation
4. **Non-fatal platform errors** — auth-dev.volley.tv returns 401 on Fire TV, but the app continues

**Remaining issue:** Game launching doesn't work yet — Bifrost prototypes resolve to private 10.x IPs unreachable from Fire TV. This is a Bifrost networking issue, not a Platform/VWR issue.

---

## Context

We've built Proto-Hub (Foundry), a game launcher that replaces the Hub for Crucible/Bifrost games. It's deployed to CloudFront at `protohub-dev.volley.tv` and works inside VWR on Fire TV — the carousel loads, game tiles display, hero images show, and **D-pad navigation works**.

## Root Cause (identified via source code analysis)

**BrowserIpc requires same-origin.** The `BrowserIpcConnection` class in `@volley/browser-ipc` checks `this.#trustedOrigins.has(event.origin)` in its message handler. When Proto-Hub at `protohub-dev.volley.tv` sends a handshake to VWR at `game-clients-dev.volley.tv`, VWR silently drops it because the origins don't match.

The regular Hub works because it's at `game-clients-dev.volley.tv/hub` — **same origin** as VWR at `game-clients-dev.volley.tv/vwr`. The handshake succeeds because `window.location.origin` is in `trustedOriginDefaults`.

### Evidence from Fire TV logs

```
VWR → Native Shell: BrowserIpc.connect ✓ (same origin: https://localhost)
Proto-Hub → VWR: BrowserIpc.connect ✗ (Timed out — different origin)
```

The "ready" event works fine because it uses `postMessage(event, "*")` with wildcard origin and VWR checks the message payload's `source` field, not `event.origin`.

## Our Proposed Fix

Deploy Proto-Hub to `game-clients-dev.volley.tv/protohub/` (same S3 bucket as Hub). We have a volley-infra PR (#2139) to grant S3 write permissions on `volley-game-clients-dev/protohub/*`.

## Questions

### 1. Is same-origin the only way?

Is there a way to add `protohub-dev.volley.tv` to BrowserIpc's trusted origins without deploying to the same domain? The VWR config has `trustedDomains` — does that feed into BrowserIpc's `trustedOrigins` set?

### 2. Can we share the game-clients S3 bucket?

Our PR #2139 on volley-infra adds S3 PutObject on `volley-game-clients-*/protohub/*` to the `crucible-ci` IAM role. Is there any concern with Proto-Hub deploying to the same bucket as the Hub? We're scoped to the `protohub/` prefix only.

### 3. Is there a VWR config option for trusted BrowserIpc origins?

We noticed VWR auto-adds `hubUrl` origin to trusted domains. Does this also add it to BrowserIpc's trusted origins? If so, it should be working — what are we missing?

### 4. Should Proto-Hub use a different VWR integration path?

We're currently loading Proto-Hub as `hubUrl` (not `launchUrl`). Is this the right approach for a Hub replacement? Or should we use a different VWR config field?

### 5. `BrowserIpc.connect` timeout is 1 second — is that configurable?

The Platform SDK's BrowserIpc connect times out after ~1 second. On Fire TV's WebView, cross-origin postMessage might be slower. Is there a way to increase the timeout?

## What We've Already Fixed

| Issue | Fix |
|-------|-----|
| Session ID crash | Changed `gameId: "proto-hub"` → `"hub"` |
| Platform error modal | Treat platform errors as non-fatal |
| Loading screen stuck | Removed `isPlatformReady` gate on carousel |
| VWR ready timeout | SDK emits ready automatically with `gameId: "hub"` |
| Amplitude flag | Added device to vwr-enabled flag |
| S3 AccessDenied | CloudFront distribution at protohub-dev.volley.tv |
| Base path 403 | Changed from `/hub/` to `/` |
| Invisible tiles | Generated colourful AI artwork for game tiles |

## What Works

- Proto-Hub loads inside VWR Hub iframe ✓
- Carousel renders with game tiles ✓
- Hero images display fullscreen ✓
- Ready event received by VWR ✓
- D-pad events reach native shell ✓
- **D-pad events forwarded to Proto-Hub iframe ✓** (fixed via trustedOrigins in PR #19)
- **BrowserIpc handshake succeeds ✓** (trustedOrigins includes VWR's origin)
- **Carousel tiles navigable with D-pad ✓** (fixed via deferred preloading in PR #21)

## What Doesn't Work

- **Game launching** — Bifrost prototype URLs resolve to private 10.x IPs (Bifrost networking issue, not Platform/VWR)

## Updated Understanding (from VWR Release Process doc)

We've read the VWR Release Process Notion doc. We understand that:
- VWR's RPC is **designed** to work cross-origin (that's its purpose — "circumvents any cross-origin issues between iframe and parent")
- VWR runs the RPC **server**, Hub iframe runs the RPC **client**
- The Platform SDK should detect VWR mode and use RPC implementations
- `BrowserIpc.connect` IS being attempted (the SDK is in RPC client mode) but the server isn't responding

So the question becomes: **why isn't VWR's BrowserIpc server responding to Proto-Hub's handshake?** Is it an origin whitelist issue in the BrowserIpc server, or something else?

Since VWR's RPC is explicitly designed for cross-origin, the same-origin deploy might not be the right fix. There may be a simpler configuration issue we're missing.

## Relevant Code

- `docs/vwr-browseripc-root-cause.md` — full investigation
- `docs/browserrpc-investigation.md` — BrowserIpc source code analysis
- `docs/hub-vs-protohub-comparison.md` — side-by-side init comparison
- `learnings/057-vwr-protohub-session-id-blocker.md` — session ID fix journey
- `learnings/058-firetv-protohub-working-minus-dpad.md` — Fire TV status

All at https://github.com/Volley-Inc/crucible
