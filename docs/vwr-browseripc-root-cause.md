# VWR BrowserIpc Root Cause Analysis

> **Date:** 2026-04-04
> **Status:** Root cause identified, needs Platform team fix

## Summary

Proto-Hub renders correctly inside VWR's Hub iframe but is invisible because BrowserIpc connection between VWR and Proto-Hub times out. This prevents VWR from showing the iframe and forwarding key events.

## Root Cause

VWR's BrowserIpc message handler likely has an **origin whitelist** that doesn't include `protohub-dev.volley.tv`. When Proto-Hub's Platform SDK sends a BrowserIpc handshake to `window.parent` (VWR), VWR ignores it because the origin doesn't match.

## Evidence

### 1. VWR ↔ Native Shell: Works
```
VWR (game-clients-dev.volley.tv) → BrowserIpc.connect → handshake to *
Native Shell (https://localhost) → handshakeResponse
VWR: "Connected to bootstrap IPC server"
```

### 2. VWR ↔ Proto-Hub: Fails
```
Proto-Hub (protohub-dev.volley.tv) → BrowserIpc.connect → handshake to window.parent
VWR (game-clients-dev.volley.tv) → [no response, handshake ignored]
Proto-Hub: "BrowserIpc.connect: Timed out" (after 30s)
```

### 3. The regular Hub works because:
```
Hub (game-clients-dev.volley.tv/hub) → BrowserIpc.connect → handshake to window.parent
VWR (game-clients-dev.volley.tv/vwr) → handshakeResponse (SAME ORIGIN!)
Hub: Connected
```

**The Hub and VWR share the same origin** (`game-clients-dev.volley.tv`). Proto-Hub has a different origin (`protohub-dev.volley.tv`). BrowserIpc likely checks `event.origin` in its message handler and only accepts messages from the same origin or a whitelist.

## Fix Options

### Option A: Serve Proto-Hub from same domain (immediate)
Deploy Proto-Hub to `game-clients-dev.volley.tv/protohub/` instead of `protohub-dev.volley.tv`. Same origin = BrowserIpc works.

This requires:
1. Upload to S3 at `volley-game-clients-dev/protohub/` (same bucket as Hub)
2. Update VWR config: `hubUrl: "https://game-clients-dev.volley.tv/protohub"`
3. No CloudFront changes needed (existing distribution serves this bucket)

### Option B: Update VWR origin whitelist (Platform team)
Add `protohub-dev.volley.tv` to VWR's BrowserIpc origin whitelist.

### Option C: Update BrowserIpc to use trustedDomains
BrowserIpc should read the VWR config's `trustedDomains` array and accept handshakes from those origins.

## Recommendation

**Option A is the fastest** — no VWR or Platform SDK changes needed. Just deploy Proto-Hub to the same S3 bucket as the Hub under a `/protohub/` prefix, and update the VWR hubUrl.
