# Proto-Hub Assessment — Architecture & Integration Plan

> **Date:** 2026-03-31
> **Sources:** Hub codebase (`C:\volley\dev\hub`), ProtoHub (`C:\volley\dev\ProtoHub`)
> **Note:** ProtoHub repo is currently empty. All work will be based on the Hub codebase.

---

## Executive Summary

Hub is a mature React 19 game launcher for Volley TV. It displays games as tiles on a carousel, launches them via iframe using the Platform SDK, and handles QR code pairing for phone controllers. Games are currently **hardcoded** with Amplitude experiment overrides.

For Crucible integration, we need to:
1. **Add a dynamic game source** — fetch from Crucible Registry API + Bifrost prototypes
2. **Strip the paywall system** — Stripe billing, subscription checks
3. **Extend the launch flow** — handle Crucible/Bifrost game URLs alongside builtin Platform SDK games

The good news: the architecture is modular. `useGames()` centralises discovery, `GameLauncher` abstracts the launch flow, and `PlatformIFrame` handles any URL. Integration is mostly additive.

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Frontend | React 19, Vite 6, TypeScript, SCSS modules |
| Backend | Express, VGF, Redis (ioredis) |
| Build | pnpm workspaces monorepo |
| TV Navigation | @noriginmedia/norigin-spatial-navigation (d-pad) |
| Platform | @volley/platform-sdk (auth, game orchestration, device info) |
| Experiments | Amplitude |
| Analytics | Datadog RUM, Segment |
| Deploy (client) | S3 + CloudFront |
| Deploy (server) | Docker + ECR + K8s/Flux |

---

## Current Game Discovery

Games are **hardcoded** in `useGames.ts`:

```typescript
const BASE_GAMES = {
  jeopardy: { title: "Jeopardy", tileImageUrl: "...", heroImageUrl: "...", paywallType: "soft" },
  "song-quiz": { ... },
  cocomelon: { ... },
  "wheel-of-fortune": { ... },
  "wits-end": { ... },
}
```

Amplitude experiments can reorder tiles, swap images, and change paywall types. Platform-specific filtering removes incompatible games on older TVs.

---

## Current Game Launch Flow

```
User selects tile → GameLauncher.launchGame()
  → Rate limit check (2s min interval)
  → Circuit breaker check (3 failures = 30s cooldown)
  → Paywall check (subscription required for "hard" paywall games)
  → Platform SDK: gameOrchestration.launchGame(gameId)
  → Returns game URL with session ID
  → PlatformIFrame renders game in iframe
  → Game sends "ready" event → hub hides carousel, shows game fullscreen
  → Game sends "close" event → hub returns to carousel
```

---

## What to Strip

| Component | What | Why |
|-----------|------|-----|
| `WebCheckoutModal` | Stripe payment modal | No subscriptions for Crucible games |
| `useWebCheckoutUpsell` | Subscription state provider | Paywall enforcement |
| `isGamePaywallSatisfied` | Paywall check in GameLauncher | All Crucible games are free |
| `DevUpsellModal` | Dev-mode subscription mock | Testing artefact |
| Paywall experiments | `[Game]PayloadSwap.paywallType` | Not needed |

---

## Integration Plan

### Phase 4.1: Fork Hub → Proto-Hub

1. Copy Hub codebase to ProtoHub repo
2. Strip paywall/billing code (see above)
3. Strip Amplitude experiments (or make optional)
4. Verify it builds and runs with just hardcoded games

### Phase 4.2: Add Registry API Game Source

Extend `useGames()` to fetch from Crucible Registry API:

```typescript
// New hook: useRegistryGames()
async function fetchCrucibleGames(): Promise<Game[]> {
    const res = await fetch(REGISTRY_API_URL + "/games")
    const { games } = await res.json()
    return games.map(entry => ({
        id: entry.gameId,
        title: entry.displayName,
        tileImageUrl: entry.tile?.imageUrl ?? DEFAULT_TILE,
        heroImageUrl: entry.tile?.heroImageUrl ?? DEFAULT_HERO,
        source: "crucible",
        deploymentUrl: `https://crucible-games-dev.volley-services.net/${entry.gameId}`,
        paywallType: "none",
    }))
}

// In useGames(), merge:
const builtinGames = getBuiltinGames()
const crucibleGames = await fetchCrucibleGames()
return [...builtinGames, ...crucibleGames]
```

### Phase 4.3: Add Bifrost Prototype Source

Same pattern — fetch prototype status and merge:

```typescript
async function fetchBifrostPrototypes(): Promise<Game[]> {
    // Call a Crucible API endpoint that reads GamePrototype CRDs via kubectl
    const res = await fetch(CRUCIBLE_API_URL + "/prototypes")
    const { prototypes } = await res.json()
    return prototypes
        .filter(p => p.phase === "Running")
        .map(p => ({
            id: p.name,
            title: p.name,
            tileImageUrl: DEFAULT_PROTOTYPE_TILE,
            heroImageUrl: DEFAULT_PROTOTYPE_HERO,
            source: "bifrost",
            status: "beta",  // Show "PROTOTYPE" badge
            deploymentUrl: `https://${p.hostname}`,
            paywallType: "none",
        }))
}
```

### Phase 4.4: Extend Launch Flow

For Crucible/Bifrost games, bypass Platform SDK and use the deployment URL directly:

```typescript
// In GameLauncher.launchGame():
if (game.source === "crucible" || game.source === "bifrost") {
    // Direct URL — no Platform SDK orchestration needed
    const url = `${game.deploymentUrl}/display?sessionId=${sessionId}`
    return new LaunchedGameState(url, game)
} else {
    // Existing Platform SDK flow
    const result = await gameOrchestration.launchGame(game.id)
    return new LaunchedGameState(result.url, game)
}
```

### Phase 4.5: QR Code for Crucible Games

For phone controller pairing with Crucible games:
1. TV displays QR code with controller URL: `https://{hostname}/controller?sessionId={id}`
2. Phone scans QR → opens controller in browser
3. VGF handles the WebSocket connection automatically

This reuses the existing QR flow but with Crucible game URLs instead of Platform SDK URLs.

---

## Key Files to Modify

| File | Change |
|------|--------|
| `apps/client/src/hooks/useGames.ts` | Add Registry API + Bifrost fetch, merge game lists |
| `apps/client/src/hooks/useGameLauncher.ts` | Handle direct URLs for external games, strip paywall |
| `apps/client/src/config/envconfig.ts` | Add `REGISTRY_API_URL`, `CRUCIBLE_API_URL` |
| `apps/client/src/constants/game.ts` | Extend Game interface with `source`, `deploymentUrl` |
| `apps/client/src/components/GameTile/GameTile.tsx` | Add "Prototype" badge for Bifrost games |
| `apps/client/src/main.tsx` | Remove paywall providers |

**No changes needed:**
- `GamesCarousel` — renders any `Game[]` array
- `LaunchedGame` / `GameIframeController` — URL-agnostic iframe
- `PlatformIFrame` — handles any URL
- Spatial navigation — works with dynamic game count

---

## Risks & Open Questions

1. **CORS:** Bifrost games on `*.volley-services.net` may have CORS issues with Hub on `game-clients.volley.tv`. Need to test iframe cross-origin policies.
2. **WebSocket routing:** VGF Socket.IO needs to connect to the game server. For Bifrost prototypes, the game server URL is different from the display/controller URL.
3. **Session management:** Platform SDK manages sessions for builtin games. Crucible games use VGF's dev session (`dev-test`). Need to bridge or bypass.
4. **No Redis for prototypes:** Hub server uses Redis for sessions. Bifrost prototypes don't have Hub server — they run VGF directly.
5. **TV platform compatibility:** Crucible games must work on Fire TV, Samsung TV, LG TV (same browsers Hub supports).

---

## Estimated Effort

| Phase | Work | Estimate |
|-------|------|----------|
| 4.1 Fork + strip | Copy Hub, remove paywall, verify build | 1-2 days |
| 4.2 Registry API | useRegistryGames hook, merge, launch | 2-3 days |
| 4.3 Bifrost prototypes | Fetch status, merge, prototype badge | 1-2 days |
| 4.4 Launch flow | Direct URL support, session handling | 1-2 days |
| 4.5 QR pairing | Controller URL generation, QR display | 1-2 days |
| **Total** | | **6-11 days** |
