# Learning 057: VWR + Proto-Hub Session ID Integration Blocker

> **Date:** 2026-04-03
> **Context:** Attempting to load Proto-Hub on Fire TV via VWR/CloudFront

## Current State

Proto-Hub loads in VWR's game iframe (JS/CSS assets load from CloudFront, ready signals fire correctly), but PlatformProvider crashes with `Error: Session ID not found in query parameters` because VWR doesn't pass `volley_hub_session_id` to the game iframe URL.

## What Works

1. CloudFront serving Proto-Hub at `https://protohub-dev.volley.tv` ✓
2. VWR enabled on device, launch URL configured ✓
3. JS assets load correctly (base path fixed) ✓
4. Ready signals fire and VWR receives them ✓
5. Amplitude vwr-enabled flag set ✓

## What Doesn't Work

PlatformProvider from `@volley/platform-sdk` throws `Session ID not found in query parameters` and crashes the entire app. This happens because:

1. VWR loads Proto-Hub in an iframe at `https://protohub-dev.volley.tv`
2. No `volley_hub_session_id` query param is passed by VWR
3. PlatformProvider reads session ID from URL params and throws if missing
4. `ensureLocalHubSessionId()` uses `window.history.replaceState()` which doesn't work in iframe WebView
5. Even `window.location.replace()` doesn't help — PlatformProvider throws before the redirect completes

## Attempted Fixes

1. ❌ `window.history.replaceState()` — doesn't work in iframe on Fire TV WebView
2. ❌ `window.location.replace()` — PlatformProvider throws before redirect
3. ❌ Adding `?volley_hub_session_id=foundry-session` to VWR launchUrl — VWR may strip query params or the URL isn't passed through to the iframe
4. ❌ Retry postMessage ready signals — signals work but app still crashes

## Root Cause Analysis

The Hub works in VWR because VWR manages the Hub iframe specially — it creates the Hub iframe with proper session context. Proto-Hub is loaded as a "game" iframe, which has different lifecycle:

```
VWR creates Hub iframe → Hub gets session context from VWR
VWR creates Game iframe → Game gets launched by Hub, which passes session params
```

Proto-Hub is loaded as the "game" but it's actually a Hub replacement. It needs Hub-level session management, not game-level.

## Resolution Options

### Option A: Platform Team — Make PlatformProvider resilient
PlatformProvider should not crash when session ID is missing. It should fall back to generating a local session ID, same as `ensureLocalHubSessionId` does.

### Option B: Replace PlatformProvider with a mock for Proto-Hub
Since Proto-Hub doesn't need full Platform SDK features (auth, game orchestration for standard games), wrap PlatformProvider in an error boundary that provides a stub context.

### Option C: Load Proto-Hub as Hub, not as Game
Configure VWR to load Proto-Hub as the `hubUrl` instead of the `launchUrl`. This would give it Hub-level session management:
```bash
npx @volley/vwr-s3-cli edit --device-id <id> --platform FIRE_TV
# Change hubUrl to https://protohub-dev.volley.tv
```

### Option D: Capacitor standalone APK
Bypass VWR entirely. Build Proto-Hub as a standalone APK via Capacitor and sideload it. This removes the VWR dependency completely.

## Recommendation

Try **Option C** first (change hubUrl, not launchUrl). If that doesn't work, **Option B** (error boundary mock) is the quickest code fix.
