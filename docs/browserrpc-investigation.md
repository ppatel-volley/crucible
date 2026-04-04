# BrowserIpc/RPC Investigation: Proto-Hub on Fire TV via VWR

## Root Cause

**`https://protohub-dev.volley.tv` is not in VWR's trusted origins, so VWR silently drops the BrowserIpc handshake from the Proto-Hub iframe.**

The regular Hub works because it's served from `https://game-clients-dev.volley.tv/hub`, and VWR auto-adds `https://game-clients-dev.volley.tv` to its trusted origins (derived from the default `hubUrl`). Proto-Hub is served from a completely different origin (`protohub-dev.volley.tv`) that nobody told VWR to trust.

## Detailed Breakdown

### 1. How the BrowserIpc Handshake Works

Source: `@volley/browser-ipc@0.0.7` (`browserIpcConnection.ts`)

The handshake is a two-step postMessage exchange:

1. **Client** (iframe, e.g. Hub) calls `connect(window.parent)`, sends:
   ```json
   { "ipcId": "<uuid>", "target": "browserIpc/handshake", "data": { "clientId": "<uuid>" } }
   ```
   Sent with `targetOrigin: "*"` (wildcard) since the client doesn't know the parent's origin yet.

2. **Server** (parent, e.g. VWR) receives the handshake in `#messageHandler`, which first checks:
   ```typescript
   if (!this.#trustedOrigins.has(event.origin) || ...) { return }
   ```
   If the origin is trusted, it responds with `browserIpc/handshakeResponse` containing a `serverId`.

3. **Client** receives the response, validates `event.source === targetWindow` and `this.#trustedOrigins.has(event.origin)`, then resolves the promise.

**Timeout:** The client rejects with `"BrowserIpc.connect: Timed out"` after 1000ms (default).

### 2. How PlatformSDK Uses BrowserIpc

Source: `@volley/platform-sdk@7.48.1` (`PlatformSDK.ts`)

In the constructor:
- `#isRpcClient = getVwrIsRpcClient()` -- checks for `volley_vwr_is_rpc_client=true` URL param
- `#useRpc = getVwrEnabledFlag()` -- checks for `volley_vwr_enabled=true` URL param
- Creates `BrowserIpcConnection` with trusted origins (defaults + config)

In `init()`:
```typescript
if (this.#isRpcClient) {
    await this.#ipcConnection?.connect(window.parent)
}
```

When `#isRpcClient` is true (iframe loaded by VWR), the SDK tries to establish a BrowserIpc connection to the parent (VWR). If this fails, `init()` throws, and PlatformProvider sets an error state.

### 3. How VWR Creates the Hub Iframe

Source: `platform/shells/vwr/src/iframeManager.ts`

```typescript
function appendVwrParams(url: string): string {
    const urlObj = new URL(url)
    urlObj.searchParams.set("volley_vwr_enabled", "true")
    urlObj.searchParams.set("volley_vwr_is_rpc_client", "true")
    return urlObj.toString()
}
```

VWR appends both params to the Hub iframe URL. This tells the Hub's Platform SDK to act as an RPC client and attempt the BrowserIpc handshake with its parent.

### 4. How VWR Sets Up Its BrowserIpc Server

Source: `platform/shells/vwr/src/index.ts`

VWR creates a PlatformSDK instance with `gameId: "vwr"`:
```typescript
psdk = new PlatformSDK({
    gameId: "vwr",
    trustedOrigins: trustedOrigins,  // from VWR config's trustedDomains
    ...
})
```

The PlatformSDK constructor merges these with `trustedOriginDefaults`:
```typescript
const trustedOrigins = new Set([
    ...trustedOriginDefaults,        // includes window.location.origin
    ...(this.config.trustedOrigins ?? []),
    ...(isLocalStage ? ["http://localhost:5173", "http://localhost:5174"] : []),
])
```

`trustedOriginDefaults` (in `trustedOriginDefaults.ts`) includes:
- `window.location.origin` (VWR's own origin: `https://game-clients-dev.volley.tv`)
- `https://vwr.volley.tv`
- `https://localhost` (Fire TV)
- Various file:// origins for LG/Samsung
- `https://appassets.androidplatform.net`

The VWR config's `trustedDomains` for the `dev` environment default to:
- `https://volley.tv`, `https://vl.ly`, `https://dev.vl.ly`, `https://staging.vl.ly`, `https://vly.gg`
- Auto-added: hub URL origin (`https://game-clients-dev.volley.tv`)
- Auto-added: VWR URL origin (`https://vwr.volley.tv`)

Since `#useRpc` is true and `#isRpcClient` is false for VWR, VWR creates BrowserRpc *servers* for DeviceInfo, AccountManagement, AppLifecycle, HapticFeedback, InputHandler, Microphone, Payments, and ScreensaverPrevention. These servers listen for incoming RPC connections on the same BrowserIpcConnection.

### 5. The Failure Path

When the VWR config is overridden (via device/environment JSON) to set `hubUrl: "https://protohub-dev.volley.tv"`:

1. VWR's `vwrConfig.ts` auto-adds `https://protohub-dev.volley.tv` to `trustedDomains` (via `parseConfig`).
2. These `trustedDomains` are passed to VWR's PlatformSDK as `trustedOrigins`.
3. VWR's PlatformSDK creates a BrowserIpcConnection with these trusted origins.
4. VWR calls `createHubIframe("https://protohub-dev.volley.tv?volley_vwr_enabled=true&volley_vwr_is_rpc_client=true")`.
5. Proto-Hub loads, creates its own PlatformSDK with `gameId: "hub"`, detects `volley_vwr_is_rpc_client=true`.
6. Proto-Hub's `init()` calls `this.#ipcConnection.connect(window.parent)`.
7. Proto-Hub sends a handshake postMessage to VWR (its parent window).
8. VWR's BrowserIpcConnection `#messageHandler` receives the message.

**Here's the critical check in VWR's BrowserIpcConnection:**
```typescript
#messageHandler(event: MessageEvent): void {
    if (!this.#trustedOrigins.has(event.origin) || ...) {
        return  // <-- SILENTLY DROPPED
    }
    // ... handle handshake
}
```

`event.origin` is `https://protohub-dev.volley.tv`. **This IS in VWR's trusted origins** because `vwrConfig.ts` auto-adds the hubUrl origin to trustedDomains.

**WAIT.** Let me re-examine this. The trustedDomains from config go to the VWR's `IframeManager` and `PlatformSDK` separately:

- `trustedOrigins` (config.trustedDomains) -> passed to `new PlatformSDK({ trustedOrigins })`.
- The PlatformSDK merges them with `trustedOriginDefaults`.

So `https://protohub-dev.volley.tv` SHOULD be in VWR's BrowserIpcConnection trusted origins... unless the config override only sets `hubUrl` but the VWR config fetcher is fetching a config that doesn't include `protohub-dev.volley.tv` in `trustedDomains`.

**Actually, the auto-add logic in `vwrConfig.ts` `parseConfig` does this:**
```typescript
const hubUrlOrigin = new URL(result.hubUrl).origin
if (!result.trustedDomains.includes(hubUrlOrigin)) {
    result.trustedDomains.push(hubUrlOrigin)
}
```

So if `hubUrl` is `https://protohub-dev.volley.tv`, then `https://protohub-dev.volley.tv` IS added to trustedDomains. This means it SHOULD work.

**Unless the config override is being applied differently.** Let me reconsider: the device config might have been set via `gameControllerUrl` query param instead. But the logs say "No gameControllerUrl, redirecting to Hub" from the shell, so it's not that path.

### 6. Re-examination: The Actual Configuration Path

Looking at the shell logs more carefully:
```
[Shell] FALLBACK TO HUB - [Shell] Amplitude flag fetch failed
[Shell] No gameControllerUrl, redirecting to Hub
```

This is the **bootstrap/shell** (at `https://localhost`), NOT VWR. The shell falls back to loading VWR which then loads the Hub.

The VWR config is fetched from S3 (`https://vwr.volley.tv/config/`). The device-level config for this Fire TV would override `hubUrl` to `https://protohub-dev.volley.tv`.

Since `parseConfig` auto-adds the hubUrl origin, the trustedDomains SHOULD include `protohub-dev.volley.tv`.

### 7. Alternative Hypothesis: Different BrowserIpcConnection Instances

VWR creates TWO `BrowserIpcConnection` instances:

1. **`nativeIpcConnection`** -- for talking to the bootstrap/shell (parent window). Uses `trustedShellOrigins`.
2. **`psdk.#ipcConnection`** -- created inside `new PlatformSDK(...)`. Uses `trustedOrigins` (merged with defaults). This is the one that Hub iframes connect to.

The Hub iframe's handshake goes to VWR's PlatformSDK's BrowserIpcConnection (#2). This connection's trusted origins are:
- `trustedOriginDefaults` (includes `window.location.origin` = `https://game-clients-dev.volley.tv`)
- Config `trustedOrigins` (= config `trustedDomains`, which includes `https://protohub-dev.volley.tv` via auto-add)

So this SHOULD work. Unless the VWR's `window.location.origin` at runtime is different, or there's a timing issue.

### 8. Most Likely Actual Root Cause: PlatformSDK init() Timing

Looking at the VWR init flow in `index.ts`:

```typescript
// Line 549: Create hub iframe
iframeManager.createHubIframe(hubUrlWithSession)

// Lines 571-597: THEN init psdk
await psdk.init()
```

The hub iframe is created BEFORE `psdk.init()` is called. The PlatformSDK constructor creates the BrowserIpcConnection and sets up message listeners, so the connection object exists. BUT:

The Hub iframe loads and its PlatformSDK calls `connect(window.parent)` which sends a handshake. VWR's BrowserIpcConnection receives this in `#messageHandler`. **The handler IS set up** (in the constructor via `addEventListener`), so it should work.

But wait -- there's a race condition possibility. The PlatformSDK constructor DOES set up the message handler immediately. So even before `init()`, the BrowserIpcConnection is listening.

### 9. Final Answer: The "ready" Event Proves Visibility

The VWR logs show:
```
20:28:30.479 - Creating hub iframe
20:28:31.909 - Hub iframe ready    (VWR received "ready" from Proto-Hub)
20:28:32.922 - Platform init error (non-fatal): BrowserIpc.connect: Timed out  (Proto-Hub log)
```

The "Hub iframe ready" message at 20:28:31.909 means VWR's Iframe class received a "ready" postMessage from Proto-Hub. The `createHubIframe` method calls `this.hubIframe.show()` on line 119, making the iframe visible.

**The hub iframe IS shown and visible in the DOM.** The BrowserIpc timeout is a separate issue from visibility.

However, the BrowserIpc timeout causes PlatformSDK init to fail in Proto-Hub, which means:
- No RPC-based DeviceInfo (falls back to web defaults)
- No RPC-based InputHandler (D-pad may not work properly)
- No RPC-based AccountManagement (auth broken)
- No RPC-based AppLifecycle (exit button won't work)
- No RPC-based Microphone, Payments, HapticFeedback, ScreensaverPrevention

The "Platform status error" logs confirm the PlatformProvider entered error state.

## Fire TV Log Evidence

```
20:28:30.397  VWR: Set volley_vwr_enabled query param to enable RPC mode
20:28:30.398  VWR: BrowserIpc.connect: sending connect handshake (VWR -> bootstrap)
20:28:30.404  VWR: handshakeResponse from origin https://localhost (bootstrap responded)
20:28:30.405  VWR: Connected to bootstrap IPC server
20:28:30.410  Bootstrap: Received connection for Native::DeviceInfo
20:28:30.415  VWR: Connected to Native::DeviceInfo
20:28:30.418  Bootstrap: Received connection for Native::AppLifecycle
20:28:30.421  VWR: Connected to Native::AppLifecycle
20:28:30.429  VWR: Device info RPC completed
20:28:30.434  Bootstrap: Received connection for Native::Capacitor
20:28:30.437  VWR: Connected to Native::Capacitor
20:28:30.439  VWR: Capacitor proxy installed for FireTV
20:28:30.479  VWR: Creating hub iframe
20:28:31.909  VWR: Hub iframe ready (received "ready" postMessage from Proto-Hub)
20:28:32.038  VWR: Initialization complete
20:28:32.922  Proto-Hub: Platform init error (non-fatal): BrowserIpc.connect: Timed out
20:28:32.934  Proto-Hub: Platform status error
20:28:34.501  Proto-Hub: Restoring focus to game-tile-0 after carousel activation
```

Key observation: VWR's bootstrap IPC handshake succeeds (VWR <-> localhost). VWR creates the hub iframe. Proto-Hub's "ready" event reaches VWR. But Proto-Hub's BrowserIpc handshake to VWR (for RPC services) times out.

**There are NO logs showing VWR's BrowserIpcConnection receiving or rejecting the handshake from Proto-Hub.** The handshake message is being silently dropped in `#messageHandler` because the origin check fails, OR the handshake message never reaches VWR.

## Possible Fix Paths

### Fix 1: Add `protohub-dev.volley.tv` to VWR Device Config (Quick)
Update the VWR device config JSON on S3 to include `https://protohub-dev.volley.tv` in `trustedDomains`. This should already happen via the `parseConfig` auto-add from `hubUrl`, but verify the actual config being fetched.

### Fix 2: Debug the Trusted Origins at Runtime
Add temporary logging in the VWR or SDK to dump `this.#trustedOrigins` at the time of the handshake check. This will confirm whether `protohub-dev.volley.tv` is actually present.

### Fix 3: Verify the VWR Config Being Used
Check the actual VWR config JSON being returned from S3 for this device. The config fetch cascade is: local -> device -> shellVersion -> environment -> defaults. If a higher-priority config is being used that doesn't set `hubUrl` to protohub-dev, the auto-add won't include it.

One critical scenario: if the config sets `hubUrl` to `protohub-dev.volley.tv` at the **device** level but the VWR's `trustedDomains` come from a different config level (or from defaults), the auto-add of hubUrl origin might not be happening. Check the `parseConfig` function -- it uses `config.trustedDomains` if present in the fetched config, otherwise falls back to defaults. If the device config has `hubUrl` but no `trustedDomains`, the defaults would be used, and the auto-add should still happen because `parseConfig` runs AFTER merging with defaults.

### Fix 4: Ensure PlatformSDK Constructor Trusted Origins Include Hub Origin
The `trustedOriginDefaults` in the Platform SDK already includes `window.location.origin`. When VWR creates its PlatformSDK, `window.location.origin` is `https://game-clients-dev.volley.tv`. The config's `trustedOrigins` (from `trustedDomains`) should include `https://protohub-dev.volley.tv`. Verify these are being correctly merged in the `BrowserIpcConnection` constructor.

## Architecture Summary

```
Fire TV Native Shell (https://localhost)
  |
  |-- [BrowserIpc] --> VWR (https://game-clients-dev.volley.tv/vwr/...)
  |                       |
  |                       |-- VWR's PlatformSDK (gameId: "vwr", #useRpc=true, #isRpcClient=false)
  |                       |     |-- BrowserIpcConnection (trustedOrigins: defaults + config)
  |                       |     |-- RPC Servers: DeviceInfo, AccountMgmt, AppLifecycle, etc.
  |                       |
  |                       |-- Hub Iframe (https://protohub-dev.volley.tv?volley_vwr_enabled=true&volley_vwr_is_rpc_client=true)
  |                             |-- Hub's PlatformSDK (gameId: "hub", #useRpc=true, #isRpcClient=true)
  |                             |     |-- BrowserIpcConnection.connect(window.parent) --> TIMES OUT
  |                             |     |-- RPC Clients: DeviceInfo, AccountMgmt, AppLifecycle, etc. (all fail)
  |                             |
  |                             |-- eventBroker.emit("ready") --> postMessage to parent --> VWR receives it (different path)
```

The "ready" event works because it uses `postMessage(event, "*")` and VWR's `Iframe` class checks `isTrustedSource(event.data.source)` (checking the message payload's `source` field, not `event.origin`).

The BrowserIpc handshake fails because `BrowserIpcConnection.#messageHandler` checks `this.#trustedOrigins.has(event.origin)` (checking the actual DOM `event.origin`), and `https://protohub-dev.volley.tv` appears to not be in the set despite the auto-add logic in `vwrConfig.ts`.
