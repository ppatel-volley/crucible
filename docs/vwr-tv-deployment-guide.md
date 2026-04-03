# VWR TV Deployment Guide — Testing Games on Real TVs

> **Date:** 2026-04-02
> **Source:** [Platform Engineering Notion Doc](https://www.notion.so/volley/Dev-and-Test-Workflows-with-VWR-2e4442bc9713800e82eae17bf850ee25)
> **For:** Crucible agents and developers deploying games to TV hardware

---

## Overview

VWR (Virtual Window Runtime) is the shell that runs on TV devices (Fire TV, Samsung, LG). It loads the Hub and games as iframes within a native app:

```
TV Shell App → VWR Loader → VWR → Hub/Game (iframe)
```

To test a game on a real TV, you configure VWR to load your game URL instead of (or alongside) the Hub. This works for both locally-hosted games (via ngrok) and deployed games (via S3/CloudFront or Bifrost).

---

## Quick Start

```bash
# 1. Login to AWS SSO (TVDevelopers role)
aws sso login --profile TVDeveloper
export AWS_PROFILE=TVDeveloper

# 2. Find your device ID from the TV's debug overlay
#    (open Dev Volley app, read deviceId from top-left)

# 3. Configure VWR to load your game
npx @volley/vwr-s3-cli setup \
    --device-id <YOUR-DEVICE-ID> \
    --platform FIRE_TV \
    --env dev \
    --launch-url "https://word-smiths.volley-services.net"

# 4. Restart the shell app on your TV
```

---

## Prerequisites

| Requirement | Minimum Version |
|-------------|----------------|
| Platform SDK | >= 7.47.2 |
| Fire TV Shell | >= 6.1.0 |
| Samsung Shell | >= 1.9.2 |
| LG Shell | >= 1.6.0 |
| iOS Mobile | >= v4.9.4(3) |
| Android Mobile | >= 2026.02.07 (394) |

---

## Step-by-Step

### 1. Find Your Device ID

Open the **Dev Volley app** on your TV. The device ID is shown in the debug overlay on the Hub page. **Include dashes exactly as shown.**

For mobile: open the dev mobile hub, device ID is in the overlay.

### 2. AWS SSO Login

You need the **TVDeveloper** SSO role (not CrucibleAdmin):

```bash
aws sso login --profile TVDeveloper
export AWS_PROFILE=TVDeveloper
```

If not configured yet:
```bash
aws configure sso
# SSO start URL: https://portal.sso.us-east-1.amazonaws.com/start
# Region: us-east-1
# Role: TVDeveloper
# Profile name: TVDeveloper
```

### 3. Configure Your Device

The `@volley/vwr-s3-cli` tool handles everything:

```bash
npx @volley/vwr-s3-cli setup \
    --device-id <DEVICE-ID> \
    --platform <PLATFORM> \
    --env dev \
    --launch-url "<GAME-URL>"
```

**Platform values:** `FIRE_TV`, `SAMSUNG_TV`, `LG_TV`, `IOS_MOBILE`, `ANDROID_MOBILE`, `WEB`

**Example — Word Smiths on Fire TV:**
```bash
npx @volley/vwr-s3-cli setup \
    --device-id 8wesayw-823dhaw-213sadw \
    --platform FIRE_TV \
    --env dev \
    --launch-url "https://word-smiths.volley-services.net"
```

This does four things:
1. Creates a `vwrConfig.json` in S3 for your device
2. Sets the Hub URL for the environment
3. Adds trusted domains (auto-detected from your URLs)
4. Adds your device to the Amplitude `vwr-enabled` flag

### 4. Restart the Shell App

Restart the Volley app on your TV. When VWR loads, you'll see a green "VWR Mode: ON" tag in the top-right corner. Your game should launch in the iframe.

---

## Environment URLs

| Setting | Dev | Staging | Prod |
|---------|-----|---------|------|
| Hub URL | `https://game-clients-dev.volley.tv/hub` | `https://game-clients-staging.volley.tv/hub` | `https://game-clients.volley.tv/hub` |
| VWR URL | `https://vwr-dev.volley.tv/v1/vwr.js` | `https://vwr-staging.volley.tv/v1/vwr.js` | `https://vwr.volley.tv/v1/vwr.js` |
| Trusted Domains | `https://game-clients-dev.volley.tv` | `https://game-clients-staging.volley.tv` | `https://game-clients.volley.tv` |

---

## CLI Commands Reference

| Command | What it does |
|---------|-------------|
| `setup` | All-in-one: create config, upload S3, invalidate CloudFront, add to Amplitude flag |
| `generate` | Interactive step-by-step config creation |
| `get` | Fetch and display existing config |
| `edit` | Modify specific fields in existing config |
| `delete` | Remove config from S3 |
| `invalidate` | Manually invalidate CloudFront cache |
| `flag status` | Check if device is in Amplitude vwr-enabled flag |
| `flag add` | Add device to flag |
| `flag remove` | Remove device from flag |

---

## Signalling (Platform SDK handles this)

Games using `@volley/platform-sdk` >= 7.40.3 handle signalling automatically. For reference:

**Game signals "ready":**
```typescript
window.parent.postMessage({
    type: "ready",
    source: "platform-sdk-iframe",
    args: []
}, "*")
```

**Game signals "close" (return to Hub):**
```typescript
window.parent.postMessage({
    type: "close",
    source: "volley",
}, "*")
```

**Hub launches a game:**
```typescript
window.parent.postMessage({
    type: "vwr:launchGame",
    source: "volley",
    args: [gameUrl],
}, "*")
```

---

## For Proto-Hub (Foundry) Integration

When Proto-Hub is deployed to S3/CloudFront, it replaces the Hub URL in VWR config:

```bash
npx @volley/vwr-s3-cli setup \
    --device-id <ID> \
    --platform FIRE_TV \
    --env dev \
    --launch-url "https://crucible-clients-dev.s3.amazonaws.com/protohub/index.html"
```

Or once CloudFront is provisioned:
```bash
--launch-url "https://game-clients-dev.volley.tv/protohub"
```

Proto-Hub then shows the game carousel, user selects a game, and VWR loads the game iframe.

---

## For Crucible Games Specifically

Crucible games deployed via Bifrost (`crucible prototype`) have URLs like:
- `https://word-smiths.volley-services.net`
- `https://space-invaders.volley-services.net`

To test on a TV:
1. Deploy the game: `crucible prototype my-game --dockerfile --port 8090`
2. Configure VWR: `npx @volley/vwr-s3-cli setup --device-id <ID> --platform FIRE_TV --env dev --launch-url "https://my-game.volley-services.net"`
3. Restart the TV app

The game must send the "ready" postMessage for VWR to display it. VGF games handle this via Platform SDK automatically.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "RPC Connection Timeout" | Check trusted origins match — verify http vs https, ports |
| CLI authentication error | Re-run `aws sso login --profile TVDeveloper` |
| VWR not loading | Check device ID is on the Amplitude `vwr-enabled` flag |
| Game not appearing | Ensure "ready" postMessage is sent to parent window |
| Black screen | Check browser console for CORS or iframe errors |
| SSO session expired | Sessions expire every 12 hours — re-login |

---

## Key Takeaway for Agents

**You do NOT need to build a native app or APK** to test on TVs. VWR loads your web app in an iframe within the existing TV shell app. Just deploy your game to a URL and point VWR at it via the S3 CLI tool. This works for:
- Locally-hosted games (via ngrok)
- Bifrost prototypes (via `*.volley-services.net`)
- S3-deployed games (via CloudFront)
