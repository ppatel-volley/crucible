# VWR Iframe Visibility Investigation — Fire TV

> **Date:** 2026-04-03
> **VWR version:** 1.6.1 (`game-clients-dev.volley.tv/vwr/v1/1.6.1/`)
> **Proto-Hub:** `protohub-dev.volley.tv` (deployed via S3/CloudFront)
> **Platform SDK:** 7.48.1
> **Shell:** 6.6.0-debug (Fire TV, `com.volleygames.phoenix`)

---

## Executive Summary

**The iframe IS visible.** The original symptom report ("screen shows blue or nothing, iframe invisible") was incorrect or outdated. The Fire TV screenshot confirms Proto-Hub renders inside VWR's iframe — the hero image, Weekend logo, and VWR mode indicator are all visible.

However, the **carousel is empty** (no game tiles) because Bifrost API fetches are failing with `TypeError: Failed to fetch`. This is the actual user-facing issue: the app loads but shows no games to select.

---

## Findings

### 1. VWR Iframe Lifecycle (How Show/Hide Works)

VWR uses a `Yb` class (minified name) to manage iframes. Key mechanics:

**Default styles applied to all iframes:**
```js
{ position: "absolute", top: "0", left: "0", width: "100%", height: "100%", border: "none" }
```

**Visibility state machine:**
- Constructor: appends iframe to container, sets up message listener, then sets `display: "none"` at the VERY END
- `show()`: sets `element.style.display = "block"`
- `hide()`: sets `element.style.display = "none"`
- `isVisible()`: checks `element.style.display !== "none"`

**There is NO opacity, visibility, or z-index manipulation** — only `display` toggling between `block` and `none`.

### 2. Hub Iframe Ready Handler

```
createHubIframe(url):
  1. Creates Yb iframe with src=url, id="vwr-hub"
  2. onMessage handler:
     - "ready"     → logs "Hub iframe ready" + telemetry (NO visibility change)
     - "vwr:launchGame" → creates game iframe
     - "close"     → exits app
  3. IMMEDIATELY calls hubIframe.show() + hubIframe.focus()
  4. Returns iframe
```

**Critical: `show()` is called IMMEDIATELY after construction**, not after receiving "ready". The "ready" handler only logs and emits telemetry. The hub iframe becomes visible as soon as it's created, regardless of whether Proto-Hub has finished loading.

### 3. Game Iframe Ready Handler

```
launchGameIframe(url):
  1. Creates Yb iframe for game, starts with display:none
  2. onMessage handler:
     - "ready" → gameIframe.show() + gameIframe.focus() + hubIframe.hide()
     - "close" → destroys game iframe
  3. Returns iframe (still hidden until game sends "ready")
```

Game iframes DO wait for "ready" before showing, and hub is hidden when game shows. But for the Hub itself, this isn't relevant.

### 4. VWR Ready Message Validation

VWR validates incoming postMessages with two checks:

**`Cz` (message format):** `typeof source === "string" && typeof type === "string" && Tz.includes(type) && Array.isArray(args)`

Allowed types: `["vwr:launchGame", "vwr:launchGameTimeout", "vwr:initResult", "ready", "error", "close"]`

**`kz` (source validation):** `source === "hub" || source === "platform-sdk-iframe" || source === "vwr" || source.startsWith("platform-sdk-iframe-")`

**Proto-Hub sends:** `{ source: "hub", type: "ready", args: [] }` (because `gameId: "hub"` → `isGame("hub")` returns false → `createEventSource` returns `"hub"`)

This passes both validation checks. Confirmed by logs: **"Hub iframe ready" IS logged.**

### 5. DOM State Confirmed via Chrome DevTools Protocol

Connected to Fire TV WebView via `adb forward tcp:9222` and inspected all 3 frame contexts:

**Shell (https://localhost):**
- `body` background: `rgb(1, 0, 32)` (dark navy, #010020)
- `#platform-sdk-iframe`: `display: block`, `position: absolute`, bounds 0,0,960,540
- `#loading`: `display: block` but behind iframe, "Loading..." text

**VWR (game-clients-dev.volley.tv):**
- `#vwr-container`: `display: block`, `position: fixed`, bounds 0,0,960,540
- `#vwr-hub`: `display: block`, `visibility: visible`, `opacity: 1`, bounds 0,0,960,540
- `#vwr-mode-indicator`: `z-index: 2147483647`, but only 97x37px in top-right, `pointer-events: none` — not blocking
- `#loading`: 19px tall, transparent — not blocking

**Proto-Hub (protohub-dev.volley.tv):**
- `#root`: `display: block`, `visibility: visible`, bounds 0,0,960,540
- `._background_1w23p_1`: full-screen background div
- `._heroSection_ygeld_52`: contains hero image (Word Smiths library artwork)
- **`._gamesCarousel_1m7pb_7`: EMPTY — zero children**

### 6. The REAL Problem: Empty Carousel

The carousel is empty because **Bifrost API fetches fail** from within the Fire TV iframe:

```
[warn] Failed to fetch Bifrost prototypes TypeError: Failed to fetch
```

This repeats every 15 seconds (the poll interval). Configuration shows:
- `BIFROST_API_URL`: `https://bifrost-api.volley-services.net` (correct)
- `CRUCIBLE_REGISTRY_API_URL`: empty string (no registry games)

The `Failed to fetch` error (not a 4xx/5xx) indicates a **network-level failure** — likely:
1. **CORS**: Bifrost API may not include `https://protohub-dev.volley.tv` in `Access-Control-Allow-Origin`
2. **DNS/connectivity**: Fire TV may not resolve `bifrost-api.volley-services.net` from within the nested iframe
3. **Mixed content**: unlikely since both are HTTPS

### 7. BrowserIpc Timeout (Proto-Hub → VWR)

Proto-Hub's Platform SDK tries to establish a BrowserIpc connection to VWR (its parent frame) but **times out**:

```
Platform init error (non-fatal): BrowserIpc.connect: Timed out
```

This happens because:
- VWR loads as an iframe inside the Shell, creating a 3-level nesting: Shell → VWR → Proto-Hub
- Proto-Hub sends its IPC handshake to `window.parent` (VWR), but VWR's IPC server (`BrowserIpcConnection`) is already connected to the Shell — it may not be set up to accept connections from child iframes
- The Platform SDK treats this as non-fatal and continues, but some RPC features (device info passthrough, Capacitor plugins) won't work

This does NOT affect visibility — the ready event is emitted in the constructor before `init()` is even called.

### 8. URL Parameter Chain

VWR appends two critical query params when creating the hub iframe URL:
```
volley_vwr_enabled=true     → enables RPC mode in Platform SDK
volley_vwr_is_rpc_client=true → marks this iframe as an RPC client
```

These are correctly present on the Proto-Hub URL. They cause:
- `#useRpc = true` and `#isRpcClient = true` in Platform SDK constructor
- Event broker created as `WebEventBroker` with `source: "hub"`
- `init()` attempts `this.#ipcConnection.connect(window.parent)` which times out

---

## Timeline (from logs)

| Time | Event | Source |
|------|-------|--------|
| 20:38:07.927 | VWR BrowserIpc handshake to Shell | VWR |
| 20:38:07.933 | VWR connected to Shell IPC | VWR |
| 20:38:07.960 | Capacitor proxy installed for FireTV | VWR |
| 20:38:07.990 | "Creating hub iframe" | VWR |
| 20:38:08.xxx | Hub iframe created, `show()` called, `display: block` | VWR |
| 20:38:09.509 | "Hub iframe ready" (postMessage received) | VWR |
| 20:38:09.635 | "Initialization complete" | VWR |
| 20:38:09.906 | Asset loading: tile images loaded | Proto-Hub |
| 20:38:10.036 | Images loaded | Proto-Hub |
| 20:38:10.532 | **BrowserIpc.connect: Timed out** | Proto-Hub |
| 20:38:11.978 | App initialization: fully complete | Proto-Hub |
| 20:38:11.987 | Restoring focus to game-tile-0 | Proto-Hub |
| 20:42:09.865 | **Failed to fetch Bifrost prototypes** | Proto-Hub |
| (repeating) | Failed to fetch Bifrost prototypes | Proto-Hub |

---

## Conclusions

### Not a Visibility Problem

The VWR iframe mechanism works correctly:
1. Hub iframe is created with `display: none`
2. `show()` is called immediately (sets `display: block`)
3. No conditions gate `show()` on RPC connection, ready event, or any other signal
4. The iframe is full-screen, visible, and rendering Proto-Hub content

### The Actual Problems

1. **Empty carousel** — Bifrost API fetches fail with `TypeError: Failed to fetch`. Most likely a CORS issue: the Bifrost API at `bifrost-api.volley-services.net` may not include `protohub-dev.volley.tv` in its CORS headers. With no games to display, the screen shows only the hero image and empty space.

2. **BrowserIpc timeout** — Proto-Hub's Platform SDK cannot establish an IPC connection to VWR. This is a known limitation of the 3-level iframe nesting (Shell → VWR → Proto-Hub). Non-fatal but means no device info passthrough or Capacitor plugin access from Proto-Hub.

3. **Empty Registry API URL** — `CRUCIBLE_REGISTRY_API_URL` is empty in the deployed config, so no Crucible registry games are fetched either. Only Bifrost prototypes would populate the carousel, and those fetches are failing.

### Recommended Fixes

1. **Fix Bifrost API CORS**: Add `https://protohub-dev.volley.tv` to the CORS allowed origins on `bifrost-api.volley-services.net`. Alternatively, investigate whether Fire TV's WebView has additional network restrictions for nested iframes.

2. **Populate Registry API URL**: Set `CRUCIBLE_REGISTRY_API_URL` in the deployment config to `https://<api-gateway-url>/games` so Proto-Hub can also fetch Crucible registry games as a fallback.

3. **Hardcode fallback games**: The initial load briefly showed tiles (from hardcoded games in the source), but subsequent poll refreshes cleared them when the API returned nothing. Consider keeping hardcoded/fallback games visible when API fetches fail.
