# Learning 058: Proto-Hub Renders on Fire TV — D-pad Not Working

> **Date:** 2026-04-03
> **Context:** Proto-Hub running on Fire TV via VWR/CloudFront

## What Works

Proto-Hub is rendering on a real Fire TV through VWR:
- VWR loads Proto-Hub as Hub iframe from `protohub-dev.volley.tv` (CloudFront)
- `gameId: "hub"` fixed the session ID crash (SDK auto-generates UUID)
- Platform errors suppressed as non-fatal (auth 401 doesn't block carousel)
- Platform readiness no longer gates carousel rendering
- Carousel renders with placeholder game tiles (Bifrost API not reachable from TV)
- Hero images display fullscreen when tiles have focus
- AI-generated Fal.ai artwork visible on real TV hardware

## What Doesn't Work

D-pad navigation doesn't work. Key events reach the native app (`keyEventBroker`) but don't reach the Proto-Hub iframe. The carousel has focus in React's spatial navigation system but the actual WebView keyboard events aren't forwarded.

## Root Cause

`BrowserIpc.connect: Timed out` — VWR's RPC channel to Proto-Hub fails to establish. Without RPC:
- VWR can't forward key events to the Hub iframe
- Key press handling stays in the VWR/native layer
- Proto-Hub's spatial navigation has no input

## What We Did

| Fix | Issue Solved |
|-----|-------------|
| `gameId: "hub"` | Session ID crash |
| Platform error → non-fatal warning | "Something went wrong" modal |
| Remove `isPlatformReady` gate | Loading screen stuck forever |
| `hubUrl` instead of `launchUrl` | Hub-level session management |
| CloudFront distribution | S3 AccessDenied |
| Vite base path `/` not `/hub/` | 403 on JS/CSS assets |
| Amplitude flag add | `vwrEnabled=false` |

## What's Needed From Platform Team

1. **Why does BrowserIpc.connect time out for Proto-Hub?** — it's loaded as the Hub iframe with `gameId: "hub"`, same as the regular Hub. Trusted domains include `protohub-dev.volley.tv`.

2. **How does the regular Hub establish RPC with VWR?** — is there a specific handshake or origin check we're missing?

3. **Can key events be forwarded without RPC?** — is there a fallback path where VWR posts key events via postMessage?

## The Bigger Picture

Proto-Hub on Fire TV is ~95% working. The carousel renders, images load, games are displayed. The only missing piece is keyboard input forwarding from VWR to the iframe, which requires BrowserIpc RPC to be established. This is a Platform SDK / VWR integration question, not a Proto-Hub code issue.
