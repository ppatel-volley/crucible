# Learning 056: VWR Amplitude Flag Blocks Proto-Hub on Fire TV

> **Date:** 2026-04-03
> **Context:** Attempting to load Proto-Hub on Fire TV via VWR

## What Happened

VWR device config was successfully uploaded to S3 with `launchUrl: https://protohub-dev.volley.tv`. CloudFront is serving the app correctly (200 OK). But the Fire TV shell app shows `VWR: Disabled` and loads the regular Hub instead.

## Root Cause

The Fire TV shell app (v6.6.0-debug) checks an **Amplitude `vwr-enabled` flag** before loading VWR. If the device ID is not on the flag's whitelist, VWR is disabled entirely — the S3 config is never even fetched.

The `@volley/vwr-s3-cli flag add` command reported success, but the shell app still shows `vwrEnabled=false`. Possible causes:
1. Amplitude flag propagation delay
2. Shell app caches the flag value between restarts
3. Device ID format mismatch in Amplitude

## What We Tried

1. `npx @volley/vwr-s3-cli setup` — config uploaded, flag add returned 500 initially
2. `npx @volley/vwr-s3-cli flag add` — returned success
3. `adb shell pm clear` — cleared all app data, still `vwrEnabled=false`
4. Multiple restarts via ADB — no change

## Resolution Needed

This is a Platform/Foundation team issue:
1. Manually verify device `6c106332812de081` is on the Amplitude flag whitelist
2. Or provide a way to bypass the Amplitude check for dev builds (e.g. `forceVwr=true` param)

## Key Takeaway

The VWR deployment stack has a hidden dependency on Amplitude that's outside our control. The `vwr-s3-cli` manages the S3 config and can add to the flag, but the shell app's flag check is opaque. For Crucible/Foundry, we may want to explore:
1. A separate shell app that doesn't use Amplitude flags
2. A dev build with VWR always enabled
3. Direct APK deployment via Capacitor (bypasses VWR entirely)
