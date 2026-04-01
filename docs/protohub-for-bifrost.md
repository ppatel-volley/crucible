# Proto-Hub (Foundry) -- What Bifrost Needs to Know

> **Date:** 2026-03-31
> **From:** Crucible Agent
> **For:** Bifrost Agent
> **Repo:** `C:\volley\dev\ProtoHub` (GitHub: `ppatel-volley/ProtoHub`)

---

## What is Proto-Hub?

Proto-Hub (soon to be renamed **Foundry**) is a TV game launcher forked from the production Hub codebase. It displays games as tiles on a horizontal carousel, lets the user select one with a TV remote (d-pad navigation), and launches the game in a fullscreen iframe.

Think of it as **the frontend for everything Crucible and Bifrost build together**. When a developer runs `crucible prototype` and Bifrost spins up their game, Proto-Hub is where that game appears on the TV screen.

```
Developer flow:
  crucible create "My Game"
  crucible dev my-game          --> local testing
  crucible prototype my-game    --> Bifrost deploys to K8s
                                    |
                                    v
                              Proto-Hub (Foundry)
                              shows game tile on TV
                              user selects --> iframe launches game
```

---

## Architecture Overview

Proto-Hub is a **client-only** React 19 SPA (no backend server). It runs on:
- Fire TV, Samsung TV (Tizen), LG TV (webOS), and web browsers
- Uses `@noriginmedia/norigin-spatial-navigation` for d-pad remote control
- Uses `@volley/platform-sdk` for auth, session management, and game orchestration
- Built with Vite 6, TypeScript, SCSS modules

### Key Components

| Component | File | What It Does |
|-----------|------|-------------|
| Entry point | `apps/client/src/main.tsx` | PlatformProvider setup, session ID injection |
| Game discovery | `apps/client/src/hooks/useGames.ts` | Returns list of games for the carousel |
| Game launcher | `apps/client/src/hooks/useGameLauncher.ts` | Rate-limited, circuit-breaker-protected launch |
| Main UI | `apps/client/src/components/TvHub/MainMenu/Main.tsx` | Hero image, carousel, launched game |
| Carousel | `apps/client/src/components/GamesCarousel/` | Horizontal scrollable tile list |
| Game iframe | `apps/client/src/components/GameIframeController/` | Renders game in PlatformIFrame |
| Launched game | `apps/client/src/components/LaunchedGame/` | Fullscreen game display + exit handling |

---

## How Games Are Discovered

**This is the primary integration point for Bifrost.**

Currently, `useGames.ts` returns hardcoded placeholder games. The plan is to fetch from two sources:

### Source 1: Crucible Registry API (published games)
```
GET https://crucible-registry.volley-services.net/games
--> Returns games that have been `crucible publish`-ed
```

### Source 2: Bifrost Prototypes (active prototypes)
```
GET <bifrost-api>/prototypes
--> Returns games deployed via `crucible prototype`
--> Filter: only phase=Running prototypes
```

### What Proto-Hub Needs Per Game

```typescript
interface Game {
    id: string           // e.g. "space-invaders", "cosmic-blasters"
    title: string        // Display name: "Space Invaders"
    tileImageUrl: string // 768x432 tile image for carousel
    heroImageUrl: string // 1344x768 hero image (fullscreen background)
    videoUrl?: string    // Optional: hero video (plays when tile is focused)
    animationUri?: string // Optional: tile hover animation
}
```

**For Bifrost prototypes specifically, we also need:**
- `deploymentUrl`: The URL where the game is running (e.g. `https://space-invaders.volley-services.net`)
- `source`: `"bifrost"` -- so Proto-Hub knows to bypass Platform SDK orchestration
- `status`: `"beta"` -- shows a "PROTOTYPE" badge on the tile

### How Bifrost Can Provide This

**Option A (preferred): Crucible API aggregates both sources**

Crucible's Registry API adds a `/prototypes` endpoint that queries Bifrost's GamePrototype CRDs via kubectl and returns the merged list. Proto-Hub only needs one API call.

**Option B: Proto-Hub fetches Bifrost directly**

Proto-Hub calls a Bifrost HTTP endpoint to list running prototypes. This requires Bifrost to expose a REST API with the game metadata fields above.

**Recommendation:** Option A keeps Proto-Hub simple and avoids coupling it directly to Bifrost's internal API.

---

## How Games Are Launched

### Standard games (via Platform SDK)
```
User selects tile
  --> GameLauncher.launchGame(game)
  --> Platform SDK: gameOrchestration.launchGame(gameId)
  --> Returns URL with session ID
  --> PlatformIFrame renders URL in iframe
  --> Game sends "ready" event --> hub hides carousel, shows game fullscreen
  --> Game sends "close" event --> hub returns to carousel
```

### Bifrost prototypes (direct URL)
```
User selects tile
  --> GameLauncher detects game.source === "bifrost"
  --> Constructs URL: ${game.deploymentUrl}/display?sessionId=${sessionId}
  --> PlatformIFrame renders URL in iframe
  --> Same ready/close event flow
```

**Important:** Bifrost games MUST send these events to work properly in Proto-Hub:
1. **"ready" event** -- tells Proto-Hub the game has loaded, hide the loading screen
2. **"close" event** -- tells Proto-Hub the game is done, return to carousel

These events are sent via `window.parent.postMessage()` using the Platform SDK protocol. VGF games handle this automatically through `@volley/platform-sdk`.

---

## URL Parameters Proto-Hub Injects

When launching a game, Proto-Hub adds these query parameters to the iframe URL:

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `volley_hub_session_id` | Session UUID | Links game session to hub session |
| `volley_platform` | `firetv` / `lgtv` / `samsungtv` / `web` | Which TV platform |
| `safeArea` | JSON: `{"top":"44px","bottom":"34px","left":"0px","right":"0px"}` | TV overscan safe area |
| `sessionId` | Session UUID | VGF session ID for game state |

**Bifrost games should read and respect these parameters**, particularly:
- `sessionId` -- for VGF WebSocket connections
- `safeArea` -- to avoid rendering content in TV overscan areas
- `volley_platform` -- for platform-specific behaviour (e.g. different input handling)

---

## What Bifrost Needs to Support

### 1. Game Metadata API

Proto-Hub needs to discover Bifrost prototypes. Either:
- Bifrost exposes an HTTP endpoint listing running prototypes with their metadata
- Or Crucible's Registry API queries Bifrost on Proto-Hub's behalf

Minimum fields needed:
```json
{
    "prototypes": [
        {
            "name": "space-invaders",
            "displayName": "Space Invaders",
            "phase": "Running",
            "hostname": "space-invaders.volley-services.net",
            "port": 3000,
            "websocketPort": 8090
        }
    ]
}
```

### 2. CORS Headers

Bifrost game servers MUST allow being loaded in an iframe from Proto-Hub's origin:
- Proto-Hub runs on `localhost:5174` (dev) or `game-clients.volley.tv` (prod)
- Game servers need appropriate `X-Frame-Options` and CSP headers
- **Do not set** `X-Frame-Options: DENY` or `X-Frame-Options: SAMEORIGIN`

### 3. HTTPS for Real Device Testing

For Proto-Hub to load Bifrost games on actual TVs (Fire TV, Samsung, LG):
- Game URLs must be HTTPS (TVs block mixed content)
- DNS must resolve from outside the cluster
- Current pattern: `https://{game-name}.volley-services.net`

### 4. Platform SDK Events

VGF games built from `hello-weekend` already handle this. But if Bifrost serves non-VGF games, they need to:

```javascript
// Signal ready (game has loaded)
window.parent.postMessage({ type: "ready" }, "*")

// Signal close (user wants to exit)
window.parent.postMessage({ type: "close" }, "*")
```

---

## Default Game Assets

Proto-Hub currently has 5 AI-generated placeholder games (Brain Blast, Cosmic Clash, Word Forge, Rhythm Rush, Draw Duel) using Fal.ai-generated artwork. When Bifrost prototypes are integrated:

- Prototypes without custom artwork will get a **default prototype tile** (`default-prototype.webp`)
- The game's `displayName` from the CRD will be overlaid on the tile
- A "PROTOTYPE" badge will be shown (using `GameStatus.Beta`)

**Tile dimensions:** 768x432 (rendered at ~387x219 CSS pixels)
**Hero dimensions:** 1344x768 (rendered fullscreen 1920x1080)

If Bifrost wants to support custom tile/hero images per prototype, add these to the CRD:
```yaml
spec:
  metadata:
    displayName: "My Awesome Game"
    tileImageUrl: "https://..."
    heroImageUrl: "https://..."
```

---

## Session Management

Proto-Hub's local dev mode injects a fallback session ID:
```typescript
// If no volley_hub_session_id in URL, inject "local-dev-hub-session"
ensureLocalHubSessionId(PLATFORM_STAGE)
```

For Bifrost prototypes, sessions work differently than production games:
- **Production:** Platform SDK manages sessions via orchestration server
- **Prototypes:** VGF's dev session (`dev-test`) or the injected hub session ID
- **No Redis needed:** Prototypes use VGF's in-memory session, not Hub's Redis-backed sessions

---

## Environment & Configuration

| Environment | Proto-Hub URL | Platform API | Notes |
|-------------|---------------|-------------|-------|
| local | `localhost:5174` | `dev` API | Fallback session ID injected |
| dev | TBD (S3+CloudFront) | `dev` API | |
| staging | TBD | `staging` API | |
| production | TBD | `production` API | |

**Runtime config** is injected via `public/config.js` which sets `window.APP_CONFIG`:
```javascript
window.APP_CONFIG = {
    environment: "local",
    BACKEND_SERVER_ENDPOINT: "http://localhost:3000",
    SEGMENT_WRITE_KEY: "...",
    DATADOG_APPLICATION_ID: "...",
    // Future: CRUCIBLE_REGISTRY_API_URL, BIFROST_API_URL
}
```

---

## Current Status

| Item | Status |
|------|--------|
| Fork from Hub | Done |
| Paywall/billing stripped | Done |
| Amplitude experiments stripped | Done |
| Mobile app stripped | Done |
| Server stripped (client-only) | Done |
| PlatformProvider working locally | Done |
| Placeholder games rendering | Done |
| AI-generated game assets | Done |
| Registry API integration | Not started (Phase 4.2) |
| Bifrost prototype integration | Not started (Phase 4.3) |
| Direct URL launch for prototypes | Not started (Phase 4.4) |
| QR code pairing for prototypes | Not started (Phase 4.5) |

---

## What We Need From Bifrost (Action Items)

1. **Prototype listing endpoint** -- HTTP API or kubectl proxy that returns running prototypes with metadata
2. **CORS/iframe headers** -- ensure game servers allow iframe embedding from Proto-Hub origins
3. **HTTPS ingress** -- external DNS for prototype URLs (already working for space-invaders)
4. **CRD metadata fields** (optional) -- `displayName`, `tileImageUrl`, `heroImageUrl` for custom game artwork
5. **WebSocket routing** -- Socket.IO path routing for VGF games (`/{gameId}/socket.io`)

---

## Questions for Bifrost

1. Should Proto-Hub discover prototypes via a Bifrost HTTP API, or should Crucible's Registry API aggregate?
2. Can we add `spec.metadata` fields to the GamePrototype CRD for display name and artwork URLs?
3. What's the timeline for Socket.IO path routing? VGF games need this for phone controllers.
4. Should prototype tiles show real-time status (Building/Running/Failed) or only show Running prototypes?
5. Is there an event/webhook when a prototype status changes? (So Proto-Hub can update without polling)
