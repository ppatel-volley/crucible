# Building Smart TV Games with WGF + Platform SDK

> **Naming note:** The framework was formerly known as VGF (Volley Game Framework) and is now **WGF** (also called **WeGF**). The npm package is still `@volley/vgf`, the CLI is still `vgf`, and most React exports still use the `VGF` prefix (e.g. `VGFProvider`). The primary server class is now `WGFServer` — do **not** use the older `VGFServer`.

A comprehensive guide for developers and AI agents building TV games on the Volley platform. Covers Fire TV, Samsung Tizen, and LG webOS with D-pad remote navigation.

**Target audience**: Anyone starting a new TV game project from scratch.
**Reference implementation**: `emoji-multiplatform` and `jeopardy-fire-web` (display/TV). `wheel-of-fortune` (controller/phone).

---

## For AI Agents

**Read this section first.** These are the most common failure modes when an AI agent builds a TV game:

1. **NPM authentication required.** The `@volley/vgf` and `@volley/platform-sdk` packages are published to npmjs.com under the `@volley` scope. If `pnpm add @volley/vgf` fails with 404 or 403, **stop and ask the user to run `npm login`** to authenticate with their Volley org npm account.
2. **Use unconditional `PlatformProvider` with `ensureLocalHubSessionId()`.** In local/dev/staging, inject a fallback `volley_hub_session_id` URL param before React renders so PlatformProvider always has what it needs. `MaybePlatformProvider` is only needed if PlatformProvider crashes your app (e.g. auth server unreachable without VPN).
3. **Always use `await ctx.dispatchThunk('TRANSITION_TO_PHASE', targetPhase)` for phase transitions.** Never dispatch `SET_PHASE` or modify `state.phase` directly -- VGF 4.8.0 throws `PhaseModificationError`. The thunk sets `state.nextPhase` and lets `endIf`/`next` handle the transition.
4. **Never put `query` inside `socketOptions`.** It clobbers VGF's internal `sessionId`, `userId`, and `clientType` (Section 4, Transport Configuration).
5. **VGF state starts as `{}`.** Always guard with `"phase" in state` before rendering (Section 4).
6. **Always override Socket.IO transports.** Default is websocket-only; set `transports: ["polling", "websocket"]` (Section 4).
7. **Reference implementation is at `emoji-multiplatform`** (same parent directory). When unsure about a pattern, check the reference code.
8. **VWR device testing requires human-owned credentials.** The `@volley/vwr-s3-cli` needs an active AWS SSO session (TVDevelopers role) that only the human can create. **Never attempt `aws sso login` or `aws configure sso` yourself.** Instead, check whether the human already has an active session by running `aws sts get-caller-identity --profile <profile>`. If that fails, tell the human to follow the credential setup steps in Section 11. Once the session is active, you *can* run CLI commands like `npx @volley/vwr-s3-cli setup ...` and `npx @volley/vwr-s3-cli get ...` on their behalf.
9. **Amplitude flag management also requires the AWS session.** The `flag add`, `flag remove`, and `flag status` sub-commands use the same SSO credentials. Same rule: verify the session first, hand off login to the human if it's expired.
10. **Always pass `--platform` exactly.** Valid values are `SAMSUNG_TV`, `LG_TV`, `FIRE_TV`, `IOS_MOBILE`, `ANDROID_MOBILE`, or `WEB`. Case and underscores matter — `firetv` or `fire-tv` will fail silently.
11. **Controller apps MUST use `@volley/platform-sdk`.** Do not generate random UUIDs for device identity — use `useDeviceInfo()` from the Platform SDK. All Volley production apps wrap in `PlatformProvider`. See Section 16 for the full controller setup guide.
12. **Use `WGFServer`, not `VGFServer`.** The older `VGFServer` class creates Socket.IO internally and lacks production features. `WGFServer` accepts an explicit Socket.IO instance and supports `RedisRuntimeSchedulerStore`. See Section 17. **Note:** WGFServer does NOT call `onConnect`/`onDisconnect` lifecycle hooks. Those are `StateSyncSessionHandlers`-only (old `VGFServer` pattern). Handle all session setup via client-initiated thunks instead.
13. **Use `@volley/logger`, not raw pino.** All Volley services use `@volley/logger` with `createLoggerHttpMiddleware` for request tracing via UUID. Raw pino lacks request IDs and structured HTTP logging. See Section 17.3.
14. **Redis must be resilient.** Never use `ioredis-mock` in production. Use exponential backoff with jitter (`retryStrategy`), `maxRetriesPerRequest: null`, and `enableOfflineQueue: true`. See Section 17.4.
15. **Health endpoints: two, not one.** Every server needs `/health` (liveness) AND `/health/ready` (readiness with dependency checks). Kubernetes/ECS/GameLift route traffic based on readiness. See Section 17.5.
16. **Platform URLs must be stage-aware.** Never hardcode `platform-dev.volley-services.net`. Use a lookup table: local/dev -> dev, staging -> staging, production -> production. See Section 18.2.
17. **Display Electron IPC must be dynamic.** Do not use a static preload object. Use `ipcMain.handle()` + `ipcRenderer.invoke()` for session ID, backend URL, and stage. See Section 18.3.
18. **Local dev with PlatformProvider requires Volley VPN.** The `auth-dev.volley.tv` server CORS-blocks localhost without VPN access. If you see CORS errors from auth endpoints, connect to the VPN before retrying.
19. **Use `vgf multi-client` for multi-client testing.** Never test display and controller in separate browser tabs manually — use the built-in multi-client tester which manages sessions, user IDs, and client types automatically. See Section 20.
20. **Thunks must be idempotent.** WGF uses at-least-once delivery — thunks may execute multiple times on server failover. Never assume a thunk runs exactly once. See Section 22.
21. **Use `SessionMember` for lobby patterns.** Do not roll your own player-tracking state. WGF provides `useSessionMembers`, `useClientActions` (with `toggleReady()`), and built-in reducers `__CLIENT_TOGGLE_READY` / `__CLIENT_UPDATE_STATE`. See Section 21.
22. **Handle reconnection in the UI.** Use `useConnectionStatus()` to show connection state. Clients that disconnect and reconnect are matched by `userId` — WGF restores their `SessionMember` rather than creating a new one. See Section 24.
23. **Phase names have reserved words.** Never name a phase `root`, `internal`, or include colons (`:`) — these are reserved by WGF and will throw `InvalidPhaseNameError`. See Section 4.
24. **Check actual npm versions before writing package.json.** Run `npm view @volley/vgf version` (and same for `platform-sdk`, `logger`, `waterfall`). The versions in this guide may be stale. As of March 2026: `@volley/vgf@4.9.0`, `@volley/platform-sdk@7.43.0`, `@volley/logger@1.4.1`, `@volley/waterfall@2.5.3`.
25. **Game state interfaces MUST include an index signature.** VGF's `BaseGameState` extends `Record<string, unknown>`. Your state interface must include `[key: string]: unknown` or TypeScript will reject it.
26. **VGF has no bare specifier export.** You CANNOT `import { ... } from "@volley/vgf"`. You MUST use subpath exports: `@volley/vgf/client`, `@volley/vgf/server`, `@volley/vgf/types`.
27. **`IOnBeginContext` is NOT exported from `@volley/vgf/server`.** Import it from `@volley/vgf/types`. `IGameActionContext` is not publicly exported at all — use an inline type `{ session: ISession<YourState> }`.
28. **`WGFServer` requires `schedulerStore`.** It is NOT optional. `MemoryStorage` does NOT implement `IRuntimeSchedulerStore`. For dev, use a noop: `{ load: async () => null, save: async () => {}, remove: async () => {} }`.
29. **`socket.io` and `dotenv` must be direct server dependencies.** The server `package.json` template in Section 1 now includes them (`"socket.io": "^4.8.1"` and `"dotenv": "^16.4.0"`). Verify they're present — `dev.ts` imports both.
30. **`console` is NOT a valid `ILogger`.** `WGFServer`'s `logger` option requires `ILogger` from `@volley/logger` (has `.fatal()` and `.child()`). Use `createLogger({ type: "node" })`.
31. **VGF 4.8+ throws `PhaseModificationError` if a reducer modifies `state.phase`.** You CANNOT use `dispatch("SET_PHASE", { phase: "..." })`. You MUST use the `nextPhase` pattern: add `nextPhase: string | null` to state, use a `SET_NEXT_PHASE` reducer that sets `nextPhase` (not `phase`), and configure `endIf` on all phases to check `state.nextPhase !== null && state.nextPhase !== state.phase`. See Section 4.9.
32. **`WGFServer` does NOT call `onConnect`/`onDisconnect` lifecycle hooks.** Any setup that was in `onConnect` must be moved to a client-initiated thunk dispatched after connection.
33. **`socketOptions` is NOT in the `.d.ts` types but IS used at runtime.** The `SocketIOClientTransport` constructor spreads `...options.socketOptions` into the Socket.IO client. Use a type cast: `as ConstructorParameters<typeof SocketIOClientTransport>[0]`.
34. **Use `127.0.0.1` not `localhost` for dev server URLs.** VPN software can intercept `localhost` DNS resolution. `127.0.0.1` bypasses this.
35. **Do NOT use React StrictMode with VGF.** StrictMode's double mount/unmount cycle disconnects the Socket.IO transport permanently. Render `<App />` directly, no `<StrictMode>` wrapper.
36. **Dev sessions get deleted on client disconnect.** VGF's disconnect timeout deletes the session from `MemoryStorage`. Use `setInterval(ensureDevSession, 2000)` in `dev.ts` to auto-recreate it.
37. **Let `VGFProvider` manage the connect/close lifecycle.** Do NOT call `transport.connect()` manually or use module-level singletons. Use `useMemo` to create the transport and pass it to `VGFProvider` with default `autoConnect: true`. VGFProvider's `PartyTimeClientProvider` handles connect/close correctly.
38. **`useDeviceInfo()` returns an object with methods.** Use `useDeviceInfo().getDeviceId()`, NOT `const { deviceId } = useDeviceInfo()`.
39. **`VGFProvider` `autoConnect` goes in `clientOptions`.** It is NOT a top-level prop. Use `<VGFProvider transport={t} clientOptions={{ autoConnect: true }}>`.
40. **WGFServer does not send Socket.IO acknowledgements.** Client-side `dispatchThunk()` wraps the emit in a Promise that rejects with `DispatchTimeoutError` after 10s if no ack arrives. For thunk dispatches that trigger phase transitions, use direct `socket.emit("message", ...)` instead of the VGF hook wrapper, or handle the timeout gracefully.

---

## 4.9. Migrating from VGF 4.3–4.7 to VGF 4.9.0

If you have an existing project written against VGF 4.3–4.7, these are the breaking changes you must address:

1. **Remove all `SET_PHASE` reducers.** VGF 4.8+ throws `PhaseModificationError` if any reducer modifies `state.phase`. Replace with the `nextPhase` pattern (see Section 4, Phase Definitions).
2. **Add `[key: string]: unknown` to your game state interface.** `BaseGameState` extends `Record<string, unknown>`.
3. **Add `nextPhase: string | null` to your game state** and include `nextPhase: null` in your initial state factory.
4. **Add `SET_NEXT_PHASE` and `CLEAR_NEXT_PHASE` reducers** (see Section 4, Game Ruleset).
5. **Update all phase `endIf` functions** to check `hasNextPhase(state)` instead of game-specific conditions.
6. **Update all phase `onBegin` functions** to call `reducerDispatcher("CLEAR_NEXT_PHASE", {})` and return `c.getState()`.
7. **Replace `logger: console`** with `createLogger({ type: "node" })` from `@volley/logger`.
8. **Add `schedulerStore` to `WGFServer`** — it is now required. Use the noop object for dev.
9. **Add `socket.io` and `dotenv`** as direct server dependencies.
10. **Replace `localhost` with `127.0.0.1`** in all dev URLs.
11. **Remove React `StrictMode`** — it kills VGF's Socket.IO transport.
12. **Use subpath imports** — `@volley/vgf/client`, `@volley/vgf/server`, `@volley/vgf/types`. The bare `@volley/vgf` specifier does not export anything.
13. **Make all thunks `async`** and type them as `(ctx: IThunkContext<YourGameState>) => Promise<void>`.
14. **Add the `DispatchTimeoutError` suppression** in `main.tsx` (see Section 4, DispatchTimeoutError).

### Import map (verified against VGF 4.9.0)

| Type | Import from |
|------|-------------|
| `WGFServer`, `MemoryStorage`, `IThunkContext` | `@volley/vgf/server` |
| `IOnBeginContext`, `ISession`, `GameThunk` | `@volley/vgf/types` |
| `VGFProvider`, `SocketIOClientTransport`, `createSocketIOClientTransport`, `ClientType`, `getVGFHooks` | `@volley/vgf/client` |
| `IGameActionContext` | **Not exported** — use `{ session: ISession<YourState> }` |

---

## Table of Contents

0. [Prerequisites & Setup](#0-prerequisites--setup)
1. [Project Scaffolding](#1-project-scaffolding)
2. [Architecture Overview](#2-architecture-overview)
3. [Platform SDK Setup](#3-platform-sdk-setup)
4. [WGF Setup](#4-wgf-setup)
5. [TV Remote Input Handling](#5-tv-remote-input-handling)
6. [D-pad Navigation Patterns](#6-d-pad-navigation-patterns)
7. [Voice Input on TV](#7-voice-input-on-tv)
8. [On-Screen Keyboard](#8-on-screen-keyboard)
9. [Remote Mode vs Controller Mode](#9-remote-mode-vs-controller-mode)
10. [Dev Mode Testing](#10-dev-mode-testing)
11. [Dev and Test Workflows with VWR](#11-dev-and-test-workflows-with-vwr)
12. [Vite Build Configuration for TV](#12-vite-build-configuration-for-tv)
13. [TV Deployment](#13-tv-deployment)
14. [Common Pitfalls](#14-common-pitfalls)
15. [Complete Code Examples](#15-complete-code-examples)
16. [Controller App Development (Phone)](#16-controller-app-development-phone)
17. [Server Production Readiness](#17-server-production-readiness)
18. [Display Production Readiness](#18-display-production-readiness)
19. [Monorepo Infrastructure](#19-monorepo-infrastructure)
20. [Multi-Client Testing](#20-multi-client-testing)
21. [Lobby & SessionMember Patterns](#21-lobby--sessionmember-patterns)
22. [Failover & Idempotency](#22-failover--idempotency)
23. [Testing Patterns](#23-testing-patterns)
24. [Reconnection Handling](#24-reconnection-handling)
25. [Observability](#25-observability)
26. [Playwright E2E Testing](#26-playwright-e2e-testing)

---

## 0. Prerequisites & Setup

### Required Tools

| Tool | Version | Install |
|------|---------|---------|
| **Node.js** | >= 22.0.0 (LTS) | [nodejs.org](https://nodejs.org) or `nvm install 22` |
| **pnpm** | >= 10.0.0 | `npm install -g pnpm@latest` |
| **Git** | Any recent | [git-scm.com](https://git-scm.com) |

### NPM Authentication

The `@volley` packages (`@volley/vgf`, `@volley/platform-sdk`, `@volley/waterfall`, `@volley/logger`) are published to the public npm registry under the Volley organisation. You must be logged in with an account that has access to the `@volley` scope.

```bash
# 1. Log in to npm (opens browser for authentication)
npm login

# 2. Verify you're logged in
npm whoami
# Should print your npm username

# 3. Verify you can access Volley packages
npm view @volley/vgf version
# Should print a version number (e.g., 4.3.1)
```

> **For AI agents:** If `pnpm add @volley/vgf` fails with a 404 or 403 error, ask the user to run `npm login` and authenticate with their Volley org npm account. Do not attempt to configure a custom registry — the packages are on the public npm registry.

### Verify Setup

```bash
node --version   # >= 22.0.0
pnpm --version   # >= 10.0.0
npm whoami       # your npm username
```

---

## 1. Project Scaffolding

### Quick Start with CLI

The fastest way to scaffold a new project is the WGF CLI:

```bash
vgf create your-game
```

This creates the full monorepo (client, server, k8s directories), sets up NPM authentication for `@volley` packages, and configures the dev environment. Options: `--skip-install`, `--skip-git`.

> **For AI agents:** If the CLI is available, prefer `vgf create` over manual scaffolding. The manual steps below are for reference and customisation.

> **Note:** `vgf create` does NOT scaffold a controller app. You must create `apps/controller/` manually — see Section 16.

### Monorepo Structure

```
your-game/
  apps/
    display/       # TV screen app (React + Vite)
    server/        # VGF game server (Node.js)
    controller/    # Phone controller app (React + Vite, optional)
  packages/
    shared/        # Shared types, constants, state factory
  pnpm-workspace.yaml
  tsconfig.base.json
  package.json
  .env             # Deepgram API key, etc.
```

### Step-by-Step Setup

**1. Create the monorepo root:**

```bash
mkdir your-game && cd your-game
git init
```

**2. Create `pnpm-workspace.yaml`:**

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

**3. Create root `package.json`:**

```json
{
  "name": "your-game",
  "private": true,
  "packageManager": "pnpm@10.27.0",
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "test:run": "pnpm -r test -- --run",
    "typecheck": "pnpm -r typecheck",
    "dev": "pnpm -r --parallel dev",
    "clean": "pnpm -r clean"
  },
  "devDependencies": {
    "typescript": "^5.7.0"
  },
  "engines": {
    "node": ">=22.0.0",
    "pnpm": ">=10.0.0"
  }
}
```

**4. Create `tsconfig.base.json`:**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": true
  }
}
```

**5. Create `packages/shared/`:**

```bash
mkdir -p packages/shared/src
```

`packages/shared/package.json`:
```json
{
  "name": "@your-game/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc -b",
    "test": "vitest",
    "test:run": "vitest --run",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist"
  },
  "peerDependencies": {
    "react": ">=18"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "react": "^19.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

`packages/shared/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*.ts"]
}
```

**6. Create `apps/display/`:**

```bash
mkdir -p apps/display/src
```

`apps/display/package.json`:
```json
{
  "name": "@your-game/display",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@your-game/shared": "workspace:*",
    "@volley/platform-sdk": "^7.43.0",
    "@volley/vgf": "^4.9.0",
    "focus-trap-react": "^12.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0",
    "vitest": "^3.0.0"
  }
}
```

`apps/display/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["vite/client"]
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"],
  "references": [
    { "path": "../../packages/shared" }
  ]
}
```

**7. Create `apps/server/`:**

```bash
mkdir -p apps/server/src
```

`apps/server/package.json`:
```json
{
  "name": "@your-game/server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "scripts": {
    "build": "tsc -b",
    "dev": "tsx watch src/dev.ts",
    "start": "node dist/index.js",
    "test": "vitest",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@your-game/shared": "workspace:*",
    "@volley/logger": "^1.4.1",
    "@volley/vgf": "^4.9.0",
    "@volley/waterfall": "2.5.3",
    "dotenv": "^16.4.0",
    "express": "^5.2.1",
    "socket.io": "^4.8.1"
  },
  "devDependencies": {
    "@types/express": "^5.0.6",
    "@types/node": "^22.0.0",
    "@types/ws": "^8.18.1",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "ws": "^8.19.0"
  }
}
```

`apps/server/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "lib": ["ES2022"],
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "references": [
    { "path": "../../packages/shared" }
  ]
}
```

**8. Install dependencies:**

```bash
pnpm install
```

> **For AI agents:** If `pnpm install` fails with 404/403 on `@volley/*` packages, ask the user to run `npm login` first (see Section 0).

> **pnpm 10.x note:** After install, pnpm may warn about packages with build scripts (esbuild, @swc/core). Run `pnpm approve-builds` and select the packages to allow, or add `onlyBuiltDependencies` to `pnpm-workspace.yaml`:
> ```yaml
> onlyBuiltDependencies:
>   - "@swc/core"
>   - esbuild
> ```

---

## 2. Architecture Overview

### System Diagram

```
+-------------------+     Socket.IO      +------------------+
|   Display App     | <=================> |   VGF Server     |
|   (TV Screen)     |    state sync       |   (Node.js)      |
+-------------------+                     +------------------+
        |                                         ^
        | Platform SDK                            |
        | (TV shell integration)                  | Socket.IO
        v                                         |
+-------------------+                     +------------------+
|   TV Shell        |                     |  Controller App  |
|   (Fire TV /      |                     |  (Phone browser) |
|    Tizen / webOS) |                     +------------------+
+-------------------+
```

### Three Layers

| Layer | Package | Purpose |
|-------|---------|---------|
| **Platform SDK** | `@volley/platform-sdk` | TV shell integration: input handling, microphone, screensaver prevention, session tracking, payments |
| **VGF (Volley Game Framework)** | `@volley/vgf` | Game state management: sessions, phases, reducers, thunks, real-time sync via Socket.IO |
| **React App** | Your code | UI rendering, scene routing, D-pad navigation, voice input |

### Client Types

VGF defines two primary client types:

| Client Type | Role | Example |
|-------------|------|---------|
| `ClientType.Display` | The TV screen. Renders game UI. Read-heavy, dispatch-light. | Fire TV app, Samsung Tizen webapp |
| `ClientType.Controller` | The phone. Sends voice input, button presses. | Mobile browser via QR code pairing |

In **remote mode** (TV remote only, no phone), the Display acts as both display AND input device.

### Session / Phase / Reducer / Thunk Model

```
Session (one per game instance)
  |
  +-- State (shared, synced to all clients)
  |     |-- phase: "lobby" | "categorySelect" | "playing" | "gameOver"
  |     |-- score, timer, currentEmojis, etc.
  |
  +-- Phases (state machine)
  |     |-- endIf: (ctx) => boolean    // when to leave this phase
  |     |-- next: string | (ctx) => string  // where to go
  |     |-- onBegin: (ctx) => GameState | Promise<GameState>  // setup when entering (returns state)
  |     |-- onEnd: async (ctx) => {}    // cleanup when leaving
  |
  +-- Reducers (pure, synchronous state transforms)
  |     |-- SET_CATEGORY, SET_SCORE, RESET_GAME, etc.
  |
  +-- Thunks (async operations that dispatch reducers)
        |-- PROCESS_TRANSCRIPTION, HANDLE_TIMEOUT, etc.
```

**Key rule**: Reducers are pure. Thunks are async. Phases define the game flow. The server owns the state; clients get synced copies.

---

## 3. Platform SDK Setup

### Package Exports

```typescript
// React hooks and providers (for UI code)
import { PlatformProvider, useKeyDown, useKeyUp, useMicrophone } from "@volley/platform-sdk/react"

// Utility functions (for non-React code)
import { getPlatform, Platform } from "@volley/platform-sdk/lib"
```

The SDK package.json exports:
```json
{
  "exports": {
    "./react": "./src/react/index.ts",
    "./lib": "./src/lib/index.ts"
  }
}
```

### Available React Hooks

| Hook | Purpose |
|------|---------|
| `useKeyDown(key, callback)` | Register key press handler (requires PlatformContext) |
| `useKeyUp(key, callback)` | Register key release handler (requires PlatformContext) |
| `useMicrophone()` | Access TV microphone hardware |
| `useInputHandler()` | Low-level input handler access |
| `useAccount()` | Get user account info |
| `useSessionId()` | Get Platform session ID |
| `useHubSessionId()` | Get TV shell hub session ID |
| `useDeviceInfo()` | Get device hardware info |
| `useTracking()` | Analytics tracking |
| `useAppLifecycle()` | App foreground/background events |
| `useCloseEvent()` | App close handling |
| `useGameOrchestration()` | Game orchestration control |
| `usePayments()` | In-app purchases |
| `useSpeechRecognition()` | Platform speech-to-text |
| `useAudioRecorder()` | Raw audio recording |
| `useAppVersion()` | App version info |
| `useHapticFeedback()` | Controller haptics |
| `usePlatformStatus()` | SDK ready state |
| `useAccountManagement()` | Account management operations |
| `useEventBroker()` | Platform event broker |
| `useGameId()` | Get the current game ID |

### PlatformProvider Configuration

```typescript
<PlatformProvider
    options={{
        gameId: "your-game-id",          // Registered game identifier
        appVersion: "1.0.0",             // Semantic version
        stage: "staging",                // "local" | "test" | "dev" | "staging" | "production"
        screensaverPrevention: {
            autoStart: true,             // Prevent TV screensaver during gameplay
        },
        // Only needed for stage: "local" or "test"
        // platformApiUrl: "http://localhost:...",
    }}
>
    {children}
</PlatformProvider>
```

> **Note:** `screensaverPrevention` is not part of the Zod schema validation but is consumed by the SDK internally after init. It's safe to pass -- unknown fields are stripped by Zod but the SDK reads the raw options.

### Stage Configuration

The Stage type is: `"local" | "test" | "dev" | "staging" | "production"`.

| Stage | Behaviour |
|-------|----------|
| `"staging"` | Auto-resolves API URLs to staging environment. No local config needed. **Use this for development on real devices.** |
| `"production"` | Auto-resolves to production URLs. |
| `"dev"` | Development stage. Auto-resolves API URLs to dev environment. |
| `"test"` | Test stage. Requires `platformApiUrl`. |
| `"local"` | Requires `platformApiUrl`. Missing it causes silent failures. |

### **CRITICAL: volley_hub_session_id Requirement**

The `useHubSessionId()` hook throws at render time if `volley_hub_session_id` is missing from URL params. Additionally, `PlatformProvider` may fail during init for other reasons (iframe session ID, network errors). The `MaybePlatformProvider` pattern prevents both failure modes by only loading the SDK on real TV platforms.

This param is injected by the TV shell when launching your app. It is **never** present in dev/web mode. If you render `PlatformProvider` unconditionally and use `useHubSessionId()`, your app will crash with:

```
Uncaught Error: Hub session ID not found in query parameters
```

### The MaybePlatformProvider Pattern

**Always** wrap `PlatformProvider` conditionally:

```typescript
import type { ReactNode } from "react"
import { detectPlatform, isTV } from "./utils/detectPlatform"

function MaybePlatformProvider({ children }: { children: ReactNode }) {
    // Skip the SDK entirely on web/dev -- useHubSessionId() will throw at render time
    // without volley_hub_session_id, and PlatformProvider may fail during init
    // for other reasons (iframe session ID, network errors)
    if (!isTV(detectPlatform())) return <>{children}</>

    // NOTE: require() is used intentionally here, not import().
    // This is a synchronous conditional load that avoids bundling the SDK
    // in web builds. Vite handles this correctly in production builds.
    // Do NOT refactor to dynamic import() — it changes the rendering semantics.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PlatformProvider } = require("@volley/platform-sdk/react")

    return (
        <PlatformProvider
            options={{
                gameId: "your-game-id",
                appVersion: "1.0.0",
                stage: "staging",
                screensaverPrevention: { autoStart: true },
            }}
        >
            {children}
        </PlatformProvider>
    )
}
```

### Platform Detection

The SDK uses mobile detection first, then the `volley_platform` query param (set by the TV shell) with user-agent fallback:

```typescript
// SDK's getPlatform() logic:
// 1. Check getMobileType() for mobile/Capacitor bridge
// 2. Check volley_platform query param
// 3. Check user agent for "Tizen" + "SMART-TV" (Samsung)
// 4. Check user agent for "Web0S" + "SmartTV" (LG)
// 5. Default to Platform.Web
```

**Lightweight local detection** (no SDK dependency):

```typescript
export type TVPlatform = "WEB" | "FIRE_TV" | "SAMSUNG_TV" | "LG_TV" | "MOBILE"

export function detectPlatform(): TVPlatform {
    const params = new URLSearchParams(window.location.search)
    const override = params.get("volley_platform")
    if (override === "FIRE_TV") return "FIRE_TV"
    if (override === "SAMSUNG_TV") return "SAMSUNG_TV"
    if (override === "LG_TV") return "LG_TV"

    const ua = navigator.userAgent
    if (ua.includes("Tizen") && ua.includes("SMART-TV")) return "SAMSUNG_TV"
    if (ua.includes("Web0S") && ua.includes("SmartTV")) return "LG_TV"

    return "WEB"
}

export function isTV(platform: TVPlatform): boolean {
    return platform === "FIRE_TV" || platform === "SAMSUNG_TV" || platform === "LG_TV"
}
```

### URL Query Parameters

| Param | Source | Purpose |
|-------|--------|---------|
| `volley_hub_session_id` | TV shell | Required by `useHubSessionId()` hook at render time (not constructor) |
| `volley_platform` | TV shell | Platform detection override (FIRE_TV, SAMSUNG_TV, LG_TV) |
| `volley_account` | TV shell | User account ID for tracking |
| `sessionId` | VGF | Game session identifier |

---

## 4. WGF Setup

### Package Exports

```json
{
  "exports": {
    "./client": { "types": "./dist/client.d.ts", "import": "./dist/client.js" },
    "./server": { "types": "./dist/server.d.ts", "import": "./dist/server.js" },
    "./types":  { "types": "./dist/types.d.ts",  "import": "./dist/types.js"  },
    "./util":   { "types": "./dist/util.d.ts",   "import": "./dist/util.js"   }
  }
}
```

### Game State Type

Define your game state in `packages/shared`. This is the single source of truth for the state shape.

```typescript
// packages/shared/src/types.ts
export interface YourGameState {
    [key: string]: unknown           // REQUIRED — BaseGameState extends Record<string, unknown>
    phase: string
    nextPhase: string | null         // Signals desired phase transition (see Section 4.9)
    category: string | null
    difficulty: number | null
    totalQuestions: number
    questionIndex: number
    currentEmojis: string[]
    currentHint: string
    showHints: boolean
    quizSubState: string            // "QUESTION" | "SOLUTION" | "TIMEOUT" | "QUIZ_OVER"
    timerStartedAt: number
    timerDuration: number
    timerPausedAt: number | null
    score: number
    lastAnswerScore: number | null
    lastAnswerText: string | null
    isNewHighScore: boolean
    controllerConnected: boolean
    pairingCode: string | null
    controllerUrl: string | null
    remoteMode: boolean
    isFtue: boolean
    // Add your game-specific fields here
}
```

### Initial State Factory

VGF calls `setup()` to create the initial state for each session. This function must return a complete state object:

```typescript
// packages/shared/src/state.ts
import type { YourGameState } from "./types"
import { GAME_CONSTANTS } from "./constants"

export function createInitialGameState(): YourGameState {
    return {
        phase: "lobby",
        nextPhase: null,
        category: null,
        difficulty: null,
        totalQuestions: GAME_CONSTANTS.QUESTIONS_PER_ROUND,
        questionIndex: 1,
        currentEmojis: [],
        currentHint: "",
        showHints: false,
        quizSubState: "QUESTION",
        timerStartedAt: 0,
        timerDuration: GAME_CONSTANTS.TIMER_DURATION_MS,
        timerPausedAt: null,
        score: 0,
        lastAnswerScore: null,
        lastAnswerText: null,
        isNewHighScore: false,
        controllerConnected: false,
        pairingCode: null,
        controllerUrl: null,
        remoteMode: false,
        isFtue: false,
    }
}
```

### Barrel Export

Create `packages/shared/src/index.ts` to re-export everything:

```typescript
// packages/shared/src/index.ts
export * from "./types"
export * from "./constants"
export { createInitialGameState } from "./state"
```

Without this file, `"main": "./dist/index.js"` in `package.json` will resolve to nothing and imports from `@your-game/shared` will fail.

### GameServices Type (Server-Side Dependency Injection)

Server thunks and lifecycle hooks receive services via closure capture. Define a services interface for your game:

```typescript
// apps/server/src/services.ts
export interface WaterfallMatchResult {
    foundMatch: boolean
    confidence?: number
    matchedAnswer?: string
}

export interface GameServices {
    deepgram: {
        createTemporaryToken: (opts: { expiresIn: number }) => Promise<{ key: string }>
    }
    database: {
        query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>
    }
    amplitude: {
        track: (userId: string, event: string, properties: Record<string, unknown>) => void
        identify: (userId: string, properties: Record<string, unknown>) => void
    }
    datadog: {
        captureError: (err: unknown, context?: Record<string, unknown>) => void
    }
    waterfall: {
        match: (text: string, targets: string[], cutoff: number) => WaterfallMatchResult
    }
    endSession: (sessionId: string) => void
    serverState: Map<string, ServerOnlyState>
    scheduler?: Scheduler | null
    devMode?: boolean
}
```

In dev mode, most services are stubbed (see Section 10, Dev Server Example).

### Client-Side Setup

```typescript
import {
    VGFProvider,
    createSocketIOClientTransport,
    ClientType,
    getVGFHooks,
} from "@volley/vgf/client"
```

#### Transport Configuration

```typescript
import { SocketIOClientTransport } from "@volley/vgf/client"

const transport = createSocketIOClientTransport({
    url: "http://127.0.0.1:8080",  // Use 127.0.0.1, NOT localhost (VPN can intercept localhost)
    query: {
        sessionId: "dev-test",
        userId: "display-dev",
        clientType: ClientType.Display,
    },
    socketOptions: {
        transports: ["polling", "websocket"],  // MUST override -- default is websocket-only
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
    },
} as ConstructorParameters<typeof SocketIOClientTransport>[0])
```

**CRITICAL: Never use `socketOptions.query`**

```typescript
// WRONG - socketOptions.query REPLACES the main query object
createSocketIOClientTransport({
    url,
    query: { sessionId, userId, clientType: ClientType.Display },
    socketOptions: {
        query: { inputMode: "remote" },  // THIS CLOBBERS sessionId, userId, clientType!
    },
})

// RIGHT - pass extra data via thunks after connection
createSocketIOClientTransport({
    url,
    query: { sessionId, userId, clientType: ClientType.Display },
    socketOptions: {
        transports: ["polling", "websocket"],
    },
})
// Then after connected: dispatchThunk("ACTIVATE_REMOTE_MODE", {})
```

Socket.IO's client merges `socketOptions.query` at the transport level, completely replacing VGF's internal query that contains `sessionId`, `userId`, and `clientType`. The connection will appear to work but VGF's server middleware won't find the session.

#### Provider Setup

```typescript
import { useMemo } from "react"
import {
    VGFProvider,
    createSocketIOClientTransport,
    SocketIOClientTransport,
    ClientType,
} from "@volley/vgf/client"

export function VGFDisplayProvider({ children }: { children: ReactNode }) {
    // Use useMemo — do NOT call transport.connect() manually.
    // VGFProvider manages the connect/close lifecycle via autoConnect (default: true).
    const transport = useMemo(() => {
        const url = import.meta.env.DEV
            ? "http://127.0.0.1:8080"    // Use 127.0.0.1, NOT localhost (VPN issues)
            : window.location.origin

        return createSocketIOClientTransport({
            url,
            query: {
                sessionId: getQueryParam("sessionId", ""),
                userId: getQueryParam("userId", ""),
                clientType: ClientType.Display,
            },
            socketOptions: {
                transports: ["polling", "websocket"],
                reconnectionAttempts: 10,
                reconnectionDelay: 1000,
                reconnectionDelayMax: 5000,
            },
        } as ConstructorParameters<typeof SocketIOClientTransport>[0])
    }, [])

    return <VGFProvider transport={transport}>{children}</VGFProvider>
}
```

> **Do NOT use React StrictMode with VGF.** StrictMode's double mount/unmount cycle disconnects the Socket.IO transport permanently. In `main.tsx`, render `<App />` directly:

```typescript
// apps/display/src/main.tsx
import { createRoot } from "react-dom/client"
import { App } from "./App"

// Suppress DispatchTimeoutError — WGFServer does not send Socket.IO acks,
// so dispatchThunk/dispatchReducer always reject after 10s. The thunk DOES execute.
window.addEventListener("unhandledrejection", (e) => {
    if (e.reason?.name === "DispatchTimeoutError") e.preventDefault()
})

// NO StrictMode — it kills VGF's Socket.IO transport
createRoot(document.getElementById("root")!).render(<App />)
```

### State Management Hooks

Create typed hooks for your game state:

```typescript
import { getVGFHooks } from "@volley/vgf/client"
import type { YourGameState } from "@your-game/shared"

const {
    useStateSync,         // Returns full game state
    useStateSyncSelector, // Returns selected slice of state
    useDispatch,          // Dispatch reducers: dispatch("SET_SCORE", { score: 100 })
    useDispatchThunk,     // Dispatch thunks: dispatchThunk("PROCESS_TRANSCRIPTION", { text })
    useDispatchAction,    // Dispatch actions
    usePhase,             // Returns current phase name
    useSessionMembers,    // Returns connected clients
    useEvents,            // Subscribe to VGF events
    useConnectionStatus,  // Connection state (connected, disconnected, reconnecting)
} = getVGFHooks<any, YourGameState, string>()
```

**CRITICAL: VGF state initialises as `{}`**

`useStateSync()` returns `{}` (empty object) before the first state sync. Always guard:

```typescript
const state = useStateSync()
if (!("phase" in state)) {
    return <LoadingScreen />
}
```

### Server-Side Setup

#### Game Ruleset

The ruleset is the top-level interface VGF expects:

```typescript
import type { GameRuleset } from "@volley/vgf/server"

export function createGameRuleset(services: GameServices): GameRuleset<YourGameState> {
    return {
        setup: createInitialGameState,    // Factory for initial state
        actions: {},                       // Required field -- pass empty object for games that don't use actions
        reducers: {
            // Phase transition reducers (NEVER modify state.phase directly — throws PhaseModificationError)
            SET_NEXT_PHASE: (state: YourGameState, payload: { phase: string }): YourGameState => ({
                ...state,
                nextPhase: payload.phase,
            }),
            CLEAR_NEXT_PHASE: (state: YourGameState): YourGameState => ({
                ...state,
                nextPhase: null,
            }),
            // Your game-specific reducers
            ...globalReducers,
        },
        thunks: {                          // Async operations — must be async, return Promise<void>
            PROCESS_TRANSCRIPTION: createProcessTranscriptionThunk(services),
            HANDLE_TIMEOUT: createHandleTimeoutThunk(services),
        },
        phases: createPhases(services),    // State machine
        onConnect: createOnConnect(services),
        onDisconnect: createOnDisconnect(services),
    }
}
```

> **Note on `actions`:** The `actions` field is required by VGF's `GameRuleset` type. Pass `actions: {}` (empty object) — this is valid and type-safe. You do not need any type cast.

#### Phase Definitions

**Phase naming constraints:** Phase names cannot be `root` (reserved for root-level actions), `internal` (reserved for the framework), or contain colons (used as namespace delimiters). Violating these throws `InvalidPhaseNameError`.

```typescript
// Phase lifecycle context — cast `ctx: unknown` to this in onBegin/onEnd.
// IOnBeginContext is exported from @volley/vgf/types, NOT @volley/vgf/server.
interface PhaseLifecycleContext {
    session: { sessionId: string; state: YourGameState }
    getState: () => YourGameState
    reducerDispatcher: (name: string, ...args: unknown[]) => void
    thunkDispatcher: (name: string, ...args: unknown[]) => Promise<void>
    logger: { info: (...args: unknown[]) => void }
}

// Helper: check if a phase transition has been requested
function hasNextPhase(state: YourGameState): boolean {
    return state.nextPhase !== null && state.nextPhase !== state.phase
}
```

> **WARNING (VGF 4.9.0 / WGFServer):** `WGFServer` does NOT call `onConnect` or `onDisconnect` lifecycle hooks. Any setup that was in `onConnect` must be moved to a client-initiated thunk dispatched after connection. The `onConnect`/`onDisconnect` examples below are for `VGFServer` only.

```typescript
export function createPhases(): Record<string, Phase> {
    return {
        lobby: {
            actions: {}, reducers: {}, thunks: {},
            onBegin: async (ctx: unknown) => {
                const c = ctx as PhaseLifecycleContext
                c.reducerDispatcher("CLEAR_NEXT_PHASE", {})
                return c.getState()
            },
            endIf: (ctx) => hasNextPhase(ctx.session.state),
            next: (ctx) => ctx.session.state.nextPhase ?? "playing",
        },
        categorySelect: {
            actions: {}, reducers: {}, thunks: {},
            onBegin: async (ctx: unknown) => {
                const c = ctx as PhaseLifecycleContext
                c.reducerDispatcher("CLEAR_NEXT_PHASE", {})
                return c.getState()
            },
            endIf: (ctx) => hasNextPhase(ctx.session.state),
            next: (ctx) => ctx.session.state.nextPhase ?? "playing",
        },
        playing: {
            actions: {}, reducers: {}, thunks: {},
            onBegin: async (ctx: unknown) => {
                const c = ctx as PhaseLifecycleContext
                c.reducerDispatcher("CLEAR_NEXT_PHASE", {})
                // Load questions, set timer, etc.
                return c.getState()
            },
            // Guard: if tokens/questions are generated in onBegin, check for uninitialised state
            // to prevent infinite loops (endIf runs BEFORE onBegin — see PhaseRunner2 Ordering below)
            endIf: (ctx) => {
                const state = ctx.session.state
                if (state.currentEmojis.length === 0) return false  // Not initialised yet
                return hasNextPhase(state)
            },
            next: (ctx) => ctx.session.state.nextPhase ?? "gameOver",
        },
        gameOver: {
            actions: {}, reducers: {}, thunks: {},
            onBegin: async (ctx: unknown) => {
                const c = ctx as PhaseLifecycleContext
                c.reducerDispatcher("CLEAR_NEXT_PHASE", {})
                return c.getState()
            },
            endIf: (ctx) => hasNextPhase(ctx.session.state),
            next: (ctx) => ctx.session.state.nextPhase ?? "lobby",
        },
    }
}
```

### **CRITICAL: endIf Behaviour (Four Rules)**

These four rules will save you hours of debugging:

**Rule 1**: endIf is NOT re-evaluated after dispatches in `onConnect`/`onDisconnect`. You must trigger phase transitions via the `nextPhase` pattern from a client-initiated thunk instead.

```typescript
// In a thunk dispatched by the client after connection:
export function createActivateRemoteModeThunk() {
    return async (ctx: IThunkContext<YourGameState>): Promise<void> => {
        ctx.dispatch("SET_REMOTE_MODE", {})
        ctx.dispatch("SET_NEXT_PHASE", { phase: "playing" })
    }
}
```

**Rule 2**: When endIf DOES cascade (from client dispatches), the `onBegin` context has a different shape. `ctx.getSessionId()` may not exist, causing `TypeError: c.getSessionId is not a function`. Cast to `PhaseLifecycleContext` and use `reducerDispatcher`.

**Rule 3**: The safe path is always a thunk that dispatches `SET_NEXT_PHASE`:

```typescript
// WRONG: Client dispatches reducer -> endIf cascades -> onBegin may crash
dispatch("SET_REMOTE_MODE", {})

// RIGHT: Client dispatches thunk -> thunk sets nextPhase -> endIf transitions cleanly
dispatchThunk("ACTIVATE_REMOTE_MODE", {})

// The thunk implementation:
import type { IThunkContext } from "@volley/vgf/server"

export function createActivateRemoteModeThunk() {
    return async (ctx: IThunkContext<YourGameState>): Promise<void> => {
        ctx.dispatch("SET_REMOTE_MODE", {})
        ctx.dispatch("SET_NEXT_PHASE", { phase: "playing" })
    }
}
```

**Rule 4**: endIf is evaluated BEFORE onBegin. If endIf checks state that onBegin initialises, you get an infinite transition loop that crashes the server with OOM. Guard with a check for uninitialised state:

```typescript
// WRONG — tokens are created in onBegin, but endIf fires first
playing: {
    endIf: (ctx) => ctx.session.state.tokensRemaining === 0,  // Always true before onBegin!
}

// RIGHT — guard against uninitialised state
playing: {
    endIf: (ctx) => {
        const state = ctx.session.state
        if (state.currentTokens.length === 0) return false  // Not initialised yet
        return hasNextPhase(state)
    },
}
```

### Thunk Context

Import from the correct subpath. Thunks **must** be `async` and return `Promise<void>`:

```typescript
import type { IThunkContext } from "@volley/vgf/server"

export function createMyThunk() {
    return async (ctx: IThunkContext<YourGameState>): Promise<void> => {
        ctx.dispatch("SET_NEXT_PHASE", { phase: "playing" })
    }
}
```

The `IThunkContext<T>` interface provides:

```typescript
interface IThunkContext<T> {
    getState: () => T
    getSessionId: () => string
    getClientId: () => string
    dispatch: (reducerName: string, ...args: unknown[]) => void
    dispatchThunk: (thunkName: string, ...args: unknown[]) => Promise<void>
    getMembers: () => Record<string, { clientType: string; connectionState: string }>
    scheduler: {
        upsertTimeout: (config: TimeoutConfig) => Promise<void>
        cancel: (name: string) => Promise<void>
        pause: (name: string) => Promise<void>
        resume: (name: string) => Promise<void>
    }
    sessionManager: { kickClient: (clientId: string) => void }
    logger: { info: (...args: unknown[]) => void; error: (...args: unknown[]) => void }
}
```

### Lifecycle Hooks

```typescript
interface LifecycleContext {
    connection: {
        metadata: {
            connectionId: string
            sessionId: string
            userId: string
            clientType: "CONTROLLER" | "DISPLAY" | "ORCHESTRATOR"
        }
        emit: (event: string, ...args: unknown[]) => void
        dispose: (reason: string) => void
    }
    getSessionId: () => string
    getState: () => YourGameState
    dispatch: (reducerName: string, ...args: unknown[]) => void
    dispatchThunk: (thunkName: string, ...args: unknown[]) => Promise<void>
    scheduler: Scheduler
    sessionManager: { kickClient: (clientId: string) => void }
}
```

> **Note:** `inputMode` and `deviceId` are NOT part of VGF's official `ConnectionMetadata` type. They may be present at runtime through Socket.IO handshake query params but are not typed by VGF.

### DispatchTimeoutError (WGFServer Ack Issue)

> **This affects ALL WGFServer projects.** It is not a bug you need to fix — it is a known limitation.

WGFServer's `registerMessageEventListener` captures `(message)` but NOT `(message, ack)`. The Socket.IO acknowledgement callback is never called. On the client side, `dispatchThunk()` and `dispatchReducer()` wrap the `socket.emit` in a Promise with a **10-second timeout**. When no ack arrives, the Promise rejects with `DispatchTimeoutError`.

**The thunk/reducer DOES execute on the server** — only the client-side acknowledgement is missing.

**Solution:** Add a global `unhandledrejection` handler in `main.tsx` to suppress these errors:

```typescript
// apps/display/src/main.tsx (at the top, before createRoot)
window.addEventListener("unhandledrejection", (e) => {
    if (e.reason?.name === "DispatchTimeoutError") e.preventDefault()
})
```

If you need to know when a thunk completes, subscribe to state changes via `useStateSync()` or `useStateSyncSelector()` rather than awaiting the dispatch.

### PhaseRunner2 Ordering (VGF 4.9.0)

VGF 4.9.0's `PhaseRunner2` evaluates phase hooks in this order:

1. **`endIf`** is checked FIRST
2. If `endIf` returns `false`, **`onBegin`** runs
3. After `onBegin`, `endIf` is checked again

This means if `endIf` returns `true` before `onBegin` has a chance to initialise state, the phase immediately transitions out — and if the `next` phase also fails `endIf`, you get an **infinite transition loop that crashes the server with OOM**.

**Example of the problem:**

```typescript
// WRONG — playing.endIf checks tokensRemaining, but tokens are created in onBegin
playing: {
    onBegin: async (ctx: unknown) => {
        const c = ctx as PhaseLifecycleContext
        c.reducerDispatcher("GENERATE_TOKENS", {})  // Sets tokensRemaining = 5
        return c.getState()
    },
    endIf: (ctx) => ctx.session.state.tokensRemaining === 0,  // TRUE before onBegin!
    next: "gameOver",
}
```

**Solution:** Guard `endIf` against uninitialised state:

```typescript
// RIGHT — guard prevents endIf from firing before onBegin
playing: {
    onBegin: async (ctx: unknown) => {
        const c = ctx as PhaseLifecycleContext
        c.reducerDispatcher("CLEAR_NEXT_PHASE", {})
        c.reducerDispatcher("GENERATE_TOKENS", {})
        return c.getState()
    },
    endIf: (ctx) => {
        const state = ctx.session.state
        if (state.currentTokens.length === 0) return false  // Not initialised yet
        return hasNextPhase(state)
    },
    next: (ctx) => ctx.session.state.nextPhase ?? "gameOver",
}
```

---

## 5. TV Remote Input Handling

### Key Mapping Table

| TV Remote Button | SDK Key Name | DOM `event.key` (keyboard fallback) | Fire TV keyCode |
|------------------|-------------|--------------------------------------|-----------------|
| D-pad Up | `ArrowUp` | `ArrowUp` | 38 |
| D-pad Down | `ArrowDown` | `ArrowDown` | 40 |
| D-pad Left | `ArrowLeft` | `ArrowLeft` | 37 |
| D-pad Right | `ArrowRight` | `ArrowRight` | 39 |
| OK / Select | `Enter` | `Enter` | 13 |
| Back | `Back` | `Backspace` or `Escape` | 4 |
| Mic / Voice | `Mic` | `m` (web fallback) | 322 (FOS6: 84, FOS7: 319) |
| Channel Down | `ChannelDown` | N/A | 174 |
| Channel Up | `ChannelUp` | N/A | 175 |
| Media Fast Forward | `MediaFastForward` | N/A | 228 |
| Media Play/Pause | `MediaPlayPause` | N/A | 179 |
| Media Rewind | `MediaRewind` | N/A | 227 |
| Menu | `Menu` | N/A | 82 |

> **Note:** `ChannelDown`, `ChannelUp`, `MediaFastForward`, `MediaPlayPause`, `MediaRewind`, and `Menu` are rarely needed for games.

### SDK Hooks vs Local DOM Hooks

| Approach | When to Use | Dependency |
|----------|-------------|------------|
| `useKeyDown` from `@volley/platform-sdk/react` | Production TV apps with `PlatformProvider` | Requires PlatformContext |
| Local `useKeyDown` via DOM events | Dev mode, web, or when Platform SDK is conditionally loaded | No dependency |

**On real TV hardware**, the SDK's input handler maps remote buttons to standard DOM key names. DOM events work identically. This is why local hooks are a valid replacement.

### Local Key Handler Hook (Recommended)

This hook works everywhere: dev browser, Fire TV, Samsung, LG.

```typescript
// hooks/useKeyHandler.ts
import { useEffect, useCallback, useRef } from "react"

const KEY_MAP: Record<string, string[]> = {
    ArrowUp: ["ArrowUp"],
    ArrowDown: ["ArrowDown"],
    ArrowLeft: ["ArrowLeft"],
    ArrowRight: ["ArrowRight"],
    Enter: ["Enter"],
    Back: ["Backspace", "Escape"],
    Mic: ["m"],
}

export function useKeyDown(key: string, callback: () => void): void {
    const callbackRef = useRef(callback)
    callbackRef.current = callback

    const handler = useCallback(
        (event: KeyboardEvent) => {
            const mappedKeys = KEY_MAP[key] ?? [key]
            if (mappedKeys.includes(event.key)) {
                callbackRef.current()
            }
        },
        [key],
    )

    useEffect(() => {
        window.addEventListener("keydown", handler)
        return () => window.removeEventListener("keydown", handler)
    }, [handler])
}

export function useKeyUp(key: string, callback: () => void): void {
    const callbackRef = useRef(callback)
    callbackRef.current = callback

    const handler = useCallback(
        (event: KeyboardEvent) => {
            const mappedKeys = KEY_MAP[key] ?? [key]
            if (mappedKeys.includes(event.key)) {
                callbackRef.current()
            }
        },
        [key],
    )

    useEffect(() => {
        window.addEventListener("keyup", handler)
        return () => window.removeEventListener("keyup", handler)
    }, [handler])
}
```

### Back Button Handling

Jeopardy's pattern: a global hook that handles Back contextually.

```typescript
// Using Platform SDK's useKeyDown (production Fire TV)
import { useKeyDown } from "@volley/platform-sdk/react"

export const useBackButtonListener = () => {
    const currentScene = useCurrentScene()
    const { showExitModal, hideModal } = useModalController("EXIT")

    useKeyDown("Back", () => {
        if (hasActiveModal()) {
            hideModal()
        } else if (currentScene === "MAIN_MENU") {
            exitApp()  // On main menu, back = exit
        } else {
            showExitModal()  // Everywhere else, confirm exit
        }
    })
}
```

Using the local hook instead (for MaybePlatformProvider pattern):

```typescript
import { useKeyDown } from "./hooks/useKeyHandler"

// Same logic, different import -- works without PlatformProvider
useKeyDown("Back", handleBack)
```

---

## 6. D-pad Navigation Patterns

### Focus Management Strategy

**Use DOM `.focus()` + state tracking. Do NOT use spatial navigation libraries.**

The pattern:
1. Track `focusIndex` in React state
2. Keep an array of `ref`s to focusable elements
3. On D-pad press, update `focusIndex`
4. On `focusIndex` change, call `element.focus()`
5. Style focused elements with a visible border

### The useDPadNavigation Hook

```typescript
// hooks/useDPadNavigation.ts
import { useState, useRef, useCallback, useEffect } from "react"
import { useKeyDown } from "./useKeyHandler"

interface UseDPadNavigationOptions {
    itemCount: number
    gridColumns: number     // 1 for vertical list, N for grid
    enabled: boolean        // false when this component shouldn't capture keys
    onSelect: (index: number) => void
}

interface UseDPadNavigationResult {
    focusIndex: number
    setFocusIndex: (index: number) => void
    itemRefs: React.MutableRefObject<(HTMLElement | null)[]>
}

export function useDPadNavigation({
    itemCount, gridColumns, enabled, onSelect,
}: UseDPadNavigationOptions): UseDPadNavigationResult {
    const [focusIndex, setFocusIndex] = useState(0)
    const itemRefs = useRef<(HTMLElement | null)[]>([])

    // Keep refs array in sync
    useEffect(() => {
        itemRefs.current = itemRefs.current.slice(0, itemCount)
    }, [itemCount])

    // Focus the DOM element when focusIndex changes
    useEffect(() => {
        if (enabled) {
            itemRefs.current[focusIndex]?.focus()
        }
    }, [focusIndex, enabled])

    const handleUp = useCallback(() => {
        if (!enabled) return
        setFocusIndex((prev) => {
            const next = prev - gridColumns
            return next >= 0 ? next : prev  // Don't wrap
        })
    }, [enabled, gridColumns])

    const handleDown = useCallback(() => {
        if (!enabled) return
        setFocusIndex((prev) => {
            const next = prev + gridColumns
            return next < itemCount ? next : prev
        })
    }, [enabled, gridColumns, itemCount])

    const handleLeft = useCallback(() => {
        if (!enabled) return
        setFocusIndex((prev) => (prev > 0 ? prev - 1 : prev))
    }, [enabled])

    const handleRight = useCallback(() => {
        if (!enabled) return
        setFocusIndex((prev) => (prev < itemCount - 1 ? prev + 1 : prev))
    }, [enabled, itemCount])

    const handleEnter = useCallback(() => {
        if (!enabled) return
        onSelect(focusIndex)
    }, [enabled, onSelect, focusIndex])

    useKeyDown("ArrowUp", handleUp)
    useKeyDown("ArrowDown", handleDown)
    useKeyDown("ArrowLeft", handleLeft)
    useKeyDown("ArrowRight", handleRight)
    useKeyDown("Enter", handleEnter)

    return { focusIndex, setFocusIndex, itemRefs }
}
```

### Grid Layout (5x2 Category Grid)

```typescript
export function CategorySelect({ onSelect }: { onSelect: (category: string) => void }) {
    const { isRemoteMode } = useInputMode()
    const categories = ["Animals", "Food", "Sports", "Movies", "Music",
                        "Nature", "Science", "History", "Travel", "Games"]

    const { focusIndex, itemRefs } = useDPadNavigation({
        itemCount: categories.length,
        gridColumns: 5,          // 5 columns, 2 rows
        enabled: isRemoteMode,   // Only capture keys in remote mode
        onSelect: (index) => onSelect(categories[index]),
    })

    return (
        <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: 16,
        }}>
            {categories.map((category, index) => {
                const isFocused = isRemoteMode && focusIndex === index
                return (
                    <button
                        key={category}
                        ref={(el) => { itemRefs.current[index] = el }}
                        tabIndex={isFocused ? 0 : -1}
                        onClick={() => onSelect(category)}
                        style={{
                            border: isFocused ? "3px solid #fbbf24" : "none",
                            borderRadius: 12,
                            background: isFocused
                                ? "rgba(251,191,36,0.2)"
                                : "rgba(255,255,255,0.05)",
                            color: "white",
                            outline: "none",
                        }}
                    >
                        {category}
                    </button>
                )
            })}
        </div>
    )
}
```

### Horizontal Button Row (2-button layout)

```typescript
// DifficultySelect or GameOver with 2 buttons
const { focusIndex, itemRefs } = useDPadNavigation({
    itemCount: 2,
    gridColumns: 2,      // Horizontal: left/right navigation
    enabled: isRemoteMode,
    onSelect: (index) => {
        if (index === 0) handlePlayAgain()
        if (index === 1) handleChangeCategory()
    },
})
```

### Focus Indicator Styling

```typescript
const focusStyle = (isFocused: boolean) => ({
    border: isFocused ? "3px solid #fbbf24" : "2px solid rgba(255,255,255,0.3)",
    borderRadius: 8,
    background: isFocused ? "rgba(251,191,36,0.2)" : "rgba(255,255,255,0.1)",
    outline: "none",
    transition: "all 0.2s",
})
```

---

## 7. Voice Input on TV

### Push-to-Talk with Mic Key

TV remotes have a dedicated mic button. Hold it to record, release to stop.

### Two Approaches

| Approach | When to Use | How |
|----------|-------------|-----|
| Platform SDK `useMicrophone()` | Production on real TV | Uses TV hardware mic, platform-managed |
| Browser AudioContext + Deepgram | Dev mode, web testing | getUserMedia + WebSocket to Deepgram |

### Deepgram API Key

Voice input requires a [Deepgram](https://deepgram.com/) API key for speech-to-text. Set it in your `.env` file at the monorepo root:

```bash
# .env (monorepo root -- do NOT commit this file)
DEEPGRAM_API_KEY=your-deepgram-api-key-here
```

The dev server reads this key and:
1. Runs a WebSocket proxy on port 8081 that forwards audio to Deepgram with auth headers
2. Exposes a `/api/deepgram-token` endpoint for temporary token generation

> **For AI agents:** If voice input isn't working in dev mode, check that `DEEPGRAM_API_KEY` is set in `.env` and the server logs show "Deepgram API key found". The proxy on port 8081 must also be running (check for EADDRINUSE errors).

### useRemoteVoiceInput Hook (Dev/Web)

> **Note:** This hook uses `createScriptProcessor()` which is deprecated by the Web Audio API in favour of `AudioWorklet`. It still works in all current browsers and TV WebViews, but may need migration in the future. For now, it's the simplest approach and is what the reference implementation uses.

```typescript
// hooks/useRemoteVoiceInput.ts
import { useCallback, useRef } from "react"
import { useKeyDown, useKeyUp } from "./useKeyHandler"
import { useDispatchThunk } from "./useVGFState"
import { useInputMode } from "../providers/InputModeProvider"

export function useRemoteVoiceInput() {
    const { isRemoteMode } = useInputMode()
    const dispatchThunk = useDispatchThunk()
    const isRecordingRef = useRef(false)

    const cleanup = useCallback(() => {
        // Disconnect audio nodes, close streams, close WebSocket
        // Dispatch STOP_RECORDING thunk
        isRecordingRef.current = false
    }, [dispatchThunk])

    const handleMicDown = useCallback(async () => {
        if (!isRemoteMode || isRecordingRef.current) return
        isRecordingRef.current = true

        // 1. Create AudioContext
        const audioCtx = new AudioContext()
        await audioCtx.resume()

        // 2. Get microphone stream
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
        })

        // 3. Connect to Deepgram via dev proxy (port 8081)
        //    The proxy handles auth headers -- you cannot set headers on WebSocket connections
        const wsUrl = import.meta.env.DEV
            ? "ws://localhost:8081"  // Dev proxy (handles Deepgram auth)
            : `wss://api.deepgram.com/v1/listen?model=nova-2&encoding=linear16&sample_rate=${audioCtx.sampleRate}&channels=1&interim_results=true&endpointing=300&smart_format=false`

        const ws = new WebSocket(wsUrl)

        // 4. On messages, dispatch transcriptions
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data)
            const transcript = data.channel?.alternatives?.[0]?.transcript
            if (transcript) {
                dispatchThunk("PROCESS_TRANSCRIPTION", {
                    text: transcript,
                    confidence: data.channel.alternatives[0].confidence,
                    isFinal: data.is_final,
                })
            }
        }

        // 5. Stream PCM audio via ScriptProcessor (deprecated but functional)
        const source = audioCtx.createMediaStreamSource(stream)
        const processor = audioCtx.createScriptProcessor(4096, 1, 1)
        processor.onaudioprocess = (e) => {
            if (ws.readyState !== WebSocket.OPEN) return
            const float32 = e.inputBuffer.getChannelData(0)
            const int16 = new Int16Array(float32.length)
            for (let i = 0; i < float32.length; i++) {
                const s = Math.max(-1, Math.min(1, float32[i]))
                int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
            }
            ws.send(int16.buffer)
        }

        source.connect(processor)
        processor.connect(audioCtx.destination)

        dispatchThunk("START_RECORDING", {})
    }, [isRemoteMode, dispatchThunk, cleanup])

    const handleMicUp = useCallback(() => {
        if (!isRemoteMode || !isRecordingRef.current) return
        cleanup()
    }, [isRemoteMode, cleanup])

    // Mic key = "m" on keyboard, dedicated button on TV remote
    useKeyDown("Mic", handleMicDown)
    useKeyUp("Mic", handleMicUp)
}
```

### Audio Format Requirements

- **Encoding**: linear16 (PCM 16-bit signed integers)
- **Sample rate**: Match AudioContext.sampleRate (usually 44100 or 48000)
- **Channels**: 1 (mono)
- Always specify `encoding` and `sample_rate` in the Deepgram URL -- auto-detect does not work for WebSocket streams

---

## 8. On-Screen Keyboard

For text input on TV (no phone controller), display a QWERTY keyboard navigable with D-pad.

### Key Features

- QWERTY layout in rows (10-9-9 grid)
- `useDPadNavigation` for key selection
- `focus-trap-react` to contain focus within the keyboard modal
- Timer pause on open, resume on close
- Back key closes without submitting

### Implementation

```typescript
import FocusTrap from "focus-trap-react"
import { useDPadNavigation } from "../../hooks/useDPadNavigation"
import { useKeyDown } from "../../hooks/useKeyHandler"
import { useDispatch, useDispatchThunk } from "../../hooks/useVGFState"

const QWERTY_ROWS = [
    ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
    ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
    ["Z", "X", "C", "V", "B", "N", "M", "\u232B", "\u2713"],  // Backspace, Check
]
const ALL_KEYS = QWERTY_ROWS.flat()
const GRID_COLUMNS = QWERTY_ROWS[0].length  // 10

export function OnScreenKeyboard({ onClose }: { onClose: () => void }) {
    const [input, setInput] = useState("")
    const dispatch = useDispatch()
    const dispatchThunk = useDispatchThunk()

    // Pause game timer while keyboard is open
    useEffect(() => {
        dispatch("PAUSE_TIMER", {})
        return () => { dispatch("RESUME_TIMER", {}) }
    }, [dispatch])

    const handleSelect = useCallback((index: number) => {
        const key = ALL_KEYS[index]
        if (key === "\u232B") {
            setInput((prev) => prev.slice(0, -1))
        } else if (key === "\u2713") {
            if (input.trim()) {
                dispatchThunk("PROCESS_TRANSCRIPTION", {
                    text: input.trim(), confidence: 1, isFinal: true,
                })
            }
            onClose()
        } else {
            setInput((prev) => prev + key)
        }
    }, [input, dispatchThunk, onClose])

    const { focusIndex, itemRefs } = useDPadNavigation({
        itemCount: ALL_KEYS.length,
        gridColumns: GRID_COLUMNS,
        enabled: true,
        onSelect: handleSelect,
    })

    // Back key closes keyboard
    useKeyDown("Back", onClose)

    return (
        <FocusTrap>
            <div style={{
                position: "fixed", inset: 0,
                background: "rgba(0,0,0,0.85)",
                display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "flex-end",
                padding: 40, zIndex: 1000,
            }}>
                {/* Input display */}
                <div style={{ fontSize: 48, color: "white", marginBottom: 32 }}>
                    {input || "\u00A0"}
                </div>

                {/* Keyboard rows */}
                {QWERTY_ROWS.map((row, rowIndex) => (
                    <div key={rowIndex} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                        {row.map((key, colIndex) => {
                            const flatIndex = QWERTY_ROWS.slice(0, rowIndex)
                                .reduce((sum, r) => sum + r.length, 0) + colIndex
                            const isFocused = focusIndex === flatIndex
                            return (
                                <button
                                    key={key}
                                    ref={(el) => { itemRefs.current[flatIndex] = el }}
                                    tabIndex={isFocused ? 0 : -1}
                                    style={{
                                        width: 64, height: 64, fontSize: 24,
                                        border: isFocused
                                            ? "3px solid #fbbf24"
                                            : "2px solid rgba(255,255,255,0.3)",
                                        borderRadius: 8,
                                        background: isFocused
                                            ? "rgba(251,191,36,0.2)"
                                            : "rgba(255,255,255,0.1)",
                                        color: "white", outline: "none",
                                    }}
                                >
                                    {key}
                                </button>
                            )
                        })}
                    </div>
                ))}
            </div>
        </FocusTrap>
    )
}
```

### Dependencies

```bash
pnpm add focus-trap-react
```

---

## 9. Remote Mode vs Controller Mode

### Two Input Modes

| Mode | Input Source | How Player Joins |
|------|-------------|------------------|
| **Controller Mode** | Phone (separate device) | Scan QR code, open URL in mobile browser |
| **Remote Mode** | TV remote (D-pad + mic button) | Press remote button on TV, no phone needed |

### InputModeProvider Pattern

Detect the input mode early (before VGF connects) and provide it to all children:

```typescript
// providers/InputModeProvider.tsx
import { createContext, useContext, useMemo, type ReactNode } from "react"
import { detectPlatform, isTV as isTVPlatform, type TVPlatform } from "../utils/detectPlatform"

interface InputModeContextValue {
    isRemoteMode: boolean
    isTV: boolean
    platform: TVPlatform
}

const InputModeContext = createContext<InputModeContextValue>({
    isRemoteMode: false, isTV: false, platform: "WEB",
})

export function useInputMode() {
    return useContext(InputModeContext)
}

function getInputModeOverride(): boolean | null {
    const params = new URLSearchParams(window.location.search)
    const override = params.get("inputMode")
    if (override === "remote") return true
    if (override === "controller") return false
    return null
}

export function InputModeProvider({ children }: { children: ReactNode }) {
    const value = useMemo(() => {
        const platform = detectPlatform()
        const tvDetected = isTVPlatform(platform)
        const override = getInputModeOverride()
        const isRemoteMode = override ?? tvDetected
        return { isRemoteMode, isTV: tvDetected, platform }
    }, [])

    return (
        <InputModeContext.Provider value={value}>
            {children}
        </InputModeContext.Provider>
    )
}
```

### Provider Order (Critical)

```typescript
export function App() {
    return (
        <MaybePlatformProvider>
            <GameErrorBoundary>
                <InputModeProvider>          {/* Must be ABOVE VGFProvider */}
                    <VGFDisplayProvider>      {/* Reads isRemoteMode */}
                        <SceneRouter />
                    </VGFDisplayProvider>
                </InputModeProvider>
            </GameErrorBoundary>
        </MaybePlatformProvider>
    )
}
```

`InputModeProvider` must be above `VGFDisplayProvider` so the input mode is known before the Socket.IO connection is established. `GameErrorBoundary` must be above both to catch crashes from either provider.

### ACTIVATE_REMOTE_MODE Thunk Pattern

**Remote mode activation MUST be a thunk, not a reducer.**

Why: If you dispatch a reducer that sets `remoteMode = true`, VGF's `endIf` cascade may trigger with an incomplete context, crashing `onBegin` (see Section 4, endIf rules).

```typescript
// Server-side thunk
import type { IThunkContext } from "@volley/vgf/server"

export function createActivateRemoteModeThunk(services: GameServices) {
    return async (ctx: IThunkContext<YourGameState>): Promise<void> => {
        const state = ctx.getState()
        if (state.remoteMode) return  // Already active

        // Initialise server-side state if needed
        const sessionId = ctx.getSessionId()
        if (!services.serverState.get(sessionId)) {
            await initializeGameSession(ctx, services, `display-${sessionId}`)
        }

        ctx.dispatch("SET_REMOTE_MODE", {})

        // Use nextPhase pattern — NEVER dispatch SET_PHASE (throws PhaseModificationError)
        const updatedState = ctx.getState()
        const targetPhase = updatedState.isFtue ? "playing" : "categorySelect"
        ctx.dispatch("SET_NEXT_PHASE", { phase: targetPhase })
    }
}
```

### Server-Side Session Initialisation

When a display connects in remote mode, server-side state must be initialised (normally the controller connection triggers this):

```typescript
export async function initializeGameSession(
    ctx: SessionInitContext,
    services: GameServices,
    userId: string,
): Promise<void> {
    let userRound = 0
    try {
        const result = await services.database.query(
            "SELECT round_count FROM user_progress WHERE user_id = $1",
            [userId],
        )
        userRound = result.rows[0]?.round_count ?? 0
    } catch (err) {
        services.datadog.captureError(err)
    }

    services.serverState.set(ctx.getSessionId(), {
        questions: [],
        currentAnswer: "",
        currentHomophones: [],
        questionHistory: [],
        scoredCurrentQuestion: false,
        userRound,
        allTranscriptions: [],
        userId,
        deepgramTokenExpiry: 0,
    })

    const isFtue = userRound < GAME_CONSTANTS.FTUE_DEFAULT_ROUNDS
    ctx.dispatch("SET_FTUE", { isFtue })
}
```

### PairingOverlay Condition

When showing the QR code pairing overlay (controller mode), make sure to check `!state.remoteMode`:

```typescript
// Show pairing only when NOT in remote mode and no controller connected
if (!state.remoteMode && !state.controllerConnected) {
    return <PairingOverlay />
}
```

---

## 10. Dev Mode Testing

> **Multi-client testing:** For testing display + controller(s) simultaneously, use `vgf multi-client` (Section 20). The URL parameters below are for single-client browser testing.

### URL Parameters for Testing

| Parameter | Values | Effect |
|-----------|--------|--------|
| `?inputMode=remote` | `remote`, `controller` | Override input mode detection |
| `?volley_platform=FIRE_TV` | `FIRE_TV`, `SAMSUNG_TV`, `LG_TV` | Simulate TV platform detection |
| `?sessionId=dev-test` | Any string | VGF session to connect to |
| `?userId=display-dev` | Any string | Client user ID |

### Dev URLs

```
Display:    http://127.0.0.1:3000/?sessionId=dev-test&userId=display-dev
Controller: http://127.0.0.1:5173/?sessionId=dev-test&volley_account=controller-dev

# Remote mode testing (no phone needed):
Display:    http://127.0.0.1:3000/?sessionId=dev-test&userId=display-dev&inputMode=remote

# Simulating Fire TV in browser:
Display:    http://127.0.0.1:3000/?sessionId=dev-test&userId=display-dev&inputMode=remote&volley_platform=FIRE_TV
```

### Dev Server Example

The dev server (`apps/server/src/dev.ts`) is critical — it boots a VGF server with in-memory storage and stub services. Here's the essential structure:

```typescript
// apps/server/src/dev.ts
import "dotenv/config"                                    // Load .env FIRST
import express from "express"
import { createServer } from "node:http"
import { WebSocketServer, WebSocket as ServerWebSocket } from "ws"
import { WGFServer, MemoryStorage } from "@volley/vgf/server"
import { Server as SocketIOServer } from "socket.io"
import { createLogger } from "@volley/logger"             // NOT console
import { createGameRuleset } from "./ruleset"
import type { GameServices } from "./services"

const logger = createLogger({ type: "node" })             // ILogger — WGFServer requires this

const app = express()
app.use((_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*")
    next()
})
const httpServer = createServer(app)

// --- Deepgram WebSocket Proxy (port 8081) ---
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY
const DG_PROXY_PORT = 8081

if (DEEPGRAM_API_KEY) {
    const dgProxy = new WebSocketServer({ port: DG_PROXY_PORT })
    dgProxy.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
            logger.warn(`Deepgram proxy port ${DG_PROXY_PORT} in use (tsx watch restart)`)
        }
    })
    dgProxy.on("connection", (clientWs) => {
        clientWs.once("message", (data) => {
            let encoding = "opus"
            let sampleRate = 48000
            try {
                const config = JSON.parse(data.toString())
                if (config.type === "config") {
                    encoding = config.encoding ?? encoding
                    sampleRate = config.sampleRate ?? sampleRate
                }
            } catch { /* not JSON */ }

            const dgUrl = `wss://api.deepgram.com/v1/listen?model=nova-2&encoding=${encoding}&sample_rate=${sampleRate}&channels=1&interim_results=true&endpointing=300&smart_format=false`
            const dgWs = new ServerWebSocket(dgUrl, {
                headers: { Authorization: `Token ${DEEPGRAM_API_KEY}` },
            })

            dgWs.on("open", () => {
                clientWs.send(JSON.stringify({ type: "proxy_ready" }))
            })
            dgWs.on("message", (msg) => {
                if (clientWs.readyState === ServerWebSocket.OPEN) {
                    clientWs.send(msg.toString())
                }
            })
            clientWs.on("message", (audioData) => {
                if (dgWs.readyState === ServerWebSocket.OPEN) {
                    dgWs.send(audioData)
                }
            })
            clientWs.on("close", () => {
                if (dgWs.readyState === ServerWebSocket.OPEN) {
                    dgWs.send(JSON.stringify({ type: "CloseStream" }))
                    dgWs.close()
                }
            })
        })
    })
}

// --- VGF Server ---
const storage = new MemoryStorage()
const io = new SocketIOServer(httpServer, {
    cors: { origin: true, methods: ["GET", "POST"], credentials: true },
})

const services: GameServices = {
    deepgram: { createTemporaryToken: async () => ({ key: "dev-stub-token" }) },
    database: { query: async () => ({ rows: [] }) },
    amplitude: { track: () => {}, identify: () => {} },
    datadog: { captureError: (err) => logger.error({ err }, "[datadog-dev]") },
    waterfall: { match: () => ({ foundMatch: false }) },
    endSession: () => {},
    serverState: new Map(),
    devMode: true,
}

const game = createGameRuleset(services)
const PORT = 8080

const server = new WGFServer({
    port: PORT,
    expressApp: app,
    httpServer,
    socketIOServer: io,
    storage,
    logger,                            // ILogger from @volley/logger — NOT console
    gameRuleset: game,
    schedulerStore: {                  // REQUIRED — MemoryStorage does NOT implement IRuntimeSchedulerStore
        load: async () => null,
        save: async () => {},
        remove: async () => {},
    },
})

server.start()

// Immortal dev session — auto-recreated if VGF deletes it on client disconnect
const DEV_SESSION_ID = "dev-test"
function ensureDevSession(): void {
    if (!storage.doesSessionExist(DEV_SESSION_ID)) {
        storage.createSession({
            sessionId: DEV_SESSION_ID,
            members: {},
            state: game.setup(),
        })
        logger.info(`Dev session "${DEV_SESSION_ID}" (re)created`)
    }
}
ensureDevSession()
setInterval(ensureDevSession, 2000)    // Re-create if VGF deletes on disconnect

logger.info(`VGF server: http://127.0.0.1:${PORT}`)
if (DEEPGRAM_API_KEY) logger.info(`Deepgram proxy: ws://127.0.0.1:${DG_PROXY_PORT}`)
```

### Dev Session Lifecycle

1. `dev.ts` creates a `dev-test` session on startup using `storage.createSession()`
2. VGF requires sessions to exist before clients can connect
3. When `tsx watch` restarts, MemoryStorage is wiped but the session is re-created automatically
4. **Gotcha**: Closing a browser tab triggers a disconnect timeout (15-30s) that deletes the session from `MemoryStorage`. The `setInterval(ensureDevSession, 2000)` pattern in the dev server example above auto-recreates it, so you never need to restart the server between test rounds.

### Port Configuration

| Port | App | Config |
|------|-----|--------|
| 3000 | Display | `apps/display/vite.config.ts` |
| 5173 | Controller | `apps/controller/vite.config.ts` |
| 8080 | VGF Server | `apps/server/src/dev.ts` |
| 8081 | Deepgram Proxy | `apps/server/src/dev.ts` |

**Both Vite configs use `strictPort: true`** -- if a port is in use, the app errors instead of silently picking another port. This prevents URL mismatches.

### tsx watch Restart Behaviour

- `tsx watch` restarts the server on file changes
- Port 8081 (Deepgram proxy) may not release fast enough, causing `EADDRINUSE`
- The Deepgram proxy dies silently while VGF keeps running on 8080
- **This is the #1 cause of "transcription not working" in dev** -- always check server logs

---

## 11. Dev and Test Workflows with VWR

VWR (Volley Web Runtime) lets you develop and test your game on real TV and mobile devices by loading it in an iframe inside the shell app. The shell launches VWR, which in turn loads the Hub and your game as iframes. You don't need to worry about shells, VWR Loader, or VWR itself — just ensure you're on the correct SDK and shell versions.

```
Shell (TV/Mobile) → VWR Loader → VWR → Hub/Games (iframes)
```

### Prerequisites

| Component | Minimum Version |
|-----------|----------------|
| `@volley/platform-sdk` | >= v7.40.3 |
| Fire TV shell | >= 6.1.0 |
| Samsung TV shell | >= 1.9.2 |
| LG TV shell | >= 1.6.0 |
| Android mobile | >= 2026.02.07 (394) |
| iOS mobile (dev) | >= v.4.9.4(3) |
| iOS mobile (prod) | >= v.4.9.4(4) |

> **Versions may shift.** If things aren't working with the latest shell builds, reach out to the @Foundation Team.

Verify your Platform SDK version in `package.json`:

```json
{
  "dependencies": {
    "@volley/platform-sdk": "^v7.40.3"
  }
}
```

### Find Your Device ID

This is a manual step — the human must do this on the physical device.

1. Install or open the **Dev Volley app** (not the production app) on your TV or mobile device.
2. Navigate to the Hub page.
3. Look for the **debug overlay** — the device ID is displayed there (e.g. `8wesayw-823dhaw-213sadw`).
4. Copy it exactly, **including any dashes**. The CLI uses this as a lookup key in S3, so a wrong ID means a config that never gets loaded.

> **For AI agents:** You cannot retrieve the device ID programmatically. Ask the human to read it from the screen and paste it into the chat.

### VWR S3 CLI Setup

The `@volley/vwr-s3-cli` CLI handles device config creation, S3 upload, CloudFront cache invalidation, and Amplitude `vwr-enabled` flag management. No need to clone the platform repo or write JSON by hand.

**1. Set up AWS SSO credentials (human must do this — agents cannot):**

If you've never configured the Volley AWS SSO profile on this machine, run the interactive setup first. You'll need access to the **TVDevelopers** IAM role — if you don't have it, ask your manager or the @Foundation team to grant it.

```bash
aws configure sso
```

When prompted, enter:

| Prompt | Value |
|--------|-------|
| SSO session name | Any name you like, e.g. `volley` |
| SSO start URL | `https://volley.awsapps.com/start` |
| SSO region | `us-east-1` |
| SSO registration scopes | Press Enter to accept the default |

Your browser will open for authentication. Sign in with your Volley SSO credentials (the same ones you use for Okta/Google SSO). Once you approve, the CLI will list available accounts — select the one with the **TVDevelopers** role. When prompted for a profile name, use something memorable (e.g. `volley-tv`).

Then log in and export the profile:

```bash
aws sso login --profile volley-tv
export AWS_PROFILE=volley-tv
```

To verify it worked:

```bash
aws sts get-caller-identity --profile volley-tv
```

You should see your account ID and the TVDevelopers role ARN.

> **SSO sessions expire every 12 hours.** If you get `ExpiredTokenException` or any auth error, re-run `aws sso login --profile volley-tv`. Agents: if a CLI command fails with an auth error, tell the human to re-run this command rather than attempting it yourself.

> **For AI agents:** You can run all `vwr-s3-cli` commands once the human confirms their SSO session is active. Check first with `aws sts get-caller-identity --profile <profile>`. If that returns an error, stop and ask the human to log in.

**2. Create your device config with `setup` (fastest path):**

```bash
npx @volley/vwr-s3-cli setup \
    --device-id <your-device-id> \
    --platform <platform> \
    --env <env> \
    --launch-url <your-game-url>
```

Example — registering a dev device on LG:

```bash
npx @volley/vwr-s3-cli setup \
    --device-id 8wesayw-823dhaw-213sadw \
    --platform LG_TV \
    --env dev \
    --launch-url https://my-game.ngrok.io
```

**CLI flags:**

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--device-id <id>` | Yes | — | Your TV's device ID |
| `--platform <platform>` | Yes | — | `SAMSUNG_TV`, `LG_TV`, `FIRE_TV`, `IOS_MOBILE`, `ANDROID_MOBILE`, or `WEB` |
| `--env <env>` | No | `dev` | Environment for defaults (`dev`, `staging`, `prod`) |
| `--launch-url <url>` | No | — | URL for VWR to load in an iframe (e.g. your ngrok game URL) |

**Environment defaults controlled by `--env`:**

| Field | dev | staging | prod |
|-------|-----|---------|------|
| `hubUrl` | `https://game-clients-dev.volley.tv/hub` | `https://game-clients-staging.volley.tv/hub` | `https://game-clients.volley.tv/hub` |
| `trustedDomains` | `https://game-clients-dev.volley.tv` | `https://game-clients-staging.volley.tv` | `https://game-clients.volley.tv` |
| `vwrUrl` | Latest VWR version deployed to that env (fetched from S3) | Same | Same |

When `--launch-url` is provided, trusted domains are auto-detected and the command runs non-interactively.

**Alternative: `generate` for full control:**

```bash
npx @volley/vwr-s3-cli generate
```

This walks you through each config field step by step with interactive prompts.

### Other CLI Commands

```bash
# Get your existing config
npx @volley/vwr-s3-cli get --device-id <id> --platform <platform>

# Edit your config interactively
npx @volley/vwr-s3-cli edit --device-id <id> --platform <platform>

# Delete your config
npx @volley/vwr-s3-cli delete --device-id <id> --platform <platform>

# Check built-in help
npx @volley/vwr-s3-cli --help
npx @volley/vwr-s3-cli setup --help
```

### Amplitude `vwr-enabled` Flag

The `vwr-enabled` Amplitude flag is the on/off switch for VWR on a device. Even with an S3 config file, VWR won't load unless the device is on the flag's whitelist. The `setup` command adds your device automatically, but you can manage it manually:

```bash
# Check flag status
npx @volley/vwr-s3-cli flag status --device-id <id>

# Add device to flag
npx @volley/vwr-s3-cli flag add --device-id <id>

# Remove device from flag
npx @volley/vwr-s3-cli flag remove --device-id <id>
```

### Launch Your Game

Once the S3 config is uploaded and the Amplitude flag is enabled:

1. **Human step:** Force-quit and relaunch the Dev Volley shell app on your device. VWR config is fetched at app start-up, so a cold restart is required after any config change.
2. The shell will detect the VWR config for your device ID, load VWR, which will then load the Hub.
3. If you set a `launchUrl`, VWR will navigate to that URL inside an iframe after the Hub loads.

> **For AI agents:** You can verify the config is correct before the human relaunches by running `npx @volley/vwr-s3-cli get --device-id <id> --platform <platform>` and checking the `launchUrl` and `trustedDomains` values. If the game URL uses ngrok, remind the human that the ngrok tunnel must be running (`ngrok http 3000` or similar) before launching.

### VWR Troubleshooting

**RPC Connection Timeout** (`BrowserIpc.connect: Timed out`):
Typically caused by trusted origins mismatch. Check the browser console for rejected messages and verify trusted origins match the actual origins (watch for `http` vs `https`, port differences, etc.).

**Unable to use `vwr-s3-cli`:**
1. Ensure you're logged in via the **TVDeveloper** SSO profile — re-run `aws sso login` if needed.
2. Check command syntax with `npx @volley/vwr-s3-cli [command] --help`.
3. Escalate to the @Foundation team if the tool is crashing.

**App fails to launch in VWR:**
1. Verify the device ID is correctly whitelisted on the Amplitude flag.
2. Ensure `launchUrl` includes any required query parameters.
3. Run `npx @volley/vwr-s3-cli get` to inspect your S3 config and `npx @volley/vwr-s3-cli edit` to fix it.
4. Escalate to @Foundation with your device ID, platform, and shell app version.

> **Source:** [Notion — Dev and Test Workflows with VWR](https://www.notion.so/2e4442bc9713800e82eae17bf850ee25)

---

## 12. Vite Build Configuration for TV

### Build Target

Fire TV's Silk browser is based on Chromium 68+. Samsung Tizen and LG webOS use similarly old Chromium versions.

> **Note:** The polyfill configuration below comes from the Jeopardy reference implementation. The emoji-multiplatform display app does NOT currently use the legacy plugin -- apply this config when deploying to Fire TV.

```typescript
// vite.config.ts
import legacy from "@vitejs/plugin-legacy"

export default defineConfig({
    build: {
        target: "chrome68",
        sourcemap: true,
        commonjsOptions: {
            transformMixedEsModules: true,
        },
    },
    optimizeDeps: {
        esbuildOptions: {
            target: "chrome68",
        },
    },
    plugins: [
        legacy({
            targets: ["chrome >= 68"],
            renderLegacyChunks: false,  // Don't generate SystemJS chunks
            modernPolyfills: [
                "es.global-this",
                "es.array.flat",
                "es.array.flat-map",
                "es.object.from-entries",
                "es.promise.all-settled",
                "es.string.match-all",
                "es.string.replace-all",
                "es.array.at",
                "web.queue-microtask",
            ],
        }),
    ],
})
```

### Multiple Entry Points

If your app has both a display and controller in the same build:

```typescript
build: {
    rollupOptions: {
        input: {
            main: path.resolve(__dirname, "index.html"),
            controller: path.resolve(__dirname, "controller.html"),
        },
    },
},
```

### Key Vite Config Options

```typescript
export default defineConfig({
    base: "./",  // Relative paths for TV deployment
    server: {
        port: 3000,
        strictPort: true,  // Fail if port in use
    },
})
```

---

## 13. TV Deployment

### Overview

| Platform | Package Format | CLI Tool | Connection |
|----------|---------------|----------|------------|
| **Fire TV** | `.apk` (Android) | `adb` | Network (ADB over TCP) |
| **Samsung Tizen** | `.wgt` (Web App) | `tizen` / `sdb` | Network (SDB protocol) |
| **LG webOS** | `.ipk` (Web App) | `ares-*` | Network (ares-based) |

All three platforms support network-based deployment (no USB tethering required) and Chrome DevTools debugging.

### Fire TV Deployment

Fire TV apps are deployed via ADB (Android Debug Bridge).

**Prerequisites:**
- ADB installed (`brew install android-platform-tools` or from [Android SDK](https://developer.android.com/tools/releases/platform-tools))
- Fire TV Developer Mode enabled (Settings > My Fire TV > Developer Options > ADB Debugging)
- Fire TV IP address (Settings > My Fire TV > About > Network)

**Steps:**
```bash
# 1. Connect to Fire TV
adb connect <fire-tv-ip>:5555

# 2. Build your app
pnpm build

# 3. Install the APK (if using Capacitor/native wrapper)
adb install dist/app-debug.apk

# 4. Grant microphone permission
adb shell pm grant com.yourpackage android.permission.RECORD_AUDIO

# 5. Launch
adb shell am start -n com.yourpackage/.MainActivity
```

**For web-based Fire TV apps** (loaded via the TV shell):
```bash
# Build the display app
cd apps/display && pnpm build

# The built files in dist/ are served by the VGF server in production
# or deployed to a CDN that the TV shell loads
```

**Debugging:**
- Chrome DevTools: `chrome://inspect/#devices` in your desktop Chrome
- ADB port forwarding: `adb forward tcp:9222 localabstract:webview_devtools_remote`

### Samsung Tizen Deployment

Samsung Tizen apps are packaged as `.wgt` files using the Tizen CLI.

**Prerequisites:**
- [Tizen Studio 6.x](https://developer.tizen.org/development/tizen-studio/download) with Tizen CLI
- Samsung TV in Developer Mode (Apps > press 1-2-3-4-5 on remote > toggle Developer Mode > set IP to your PC)
- Signing certificate created in Tizen Certificate Manager

**Steps:**
```bash
# 1. Connect to TV via SDB
sdb connect <tv-ip>:26101

# 2. Build your web app
cd apps/display && pnpm build

# 3. Package as .wgt
tizen package -t wgt -s <certificate-profile> -- ./dist

# 4. Install on TV
tizen install -t <device-name> --name YourGame.wgt -- ./dist/.buildResult

# 5. Launch
tizen run -t <device-name> -p <package-id>
```

**Debugging:**
- SDB port forwarding: `sdb forward tcp:9229 tcp:<debug-port>`
- Open `chrome://inspect` in desktop Chrome

### LG webOS Deployment

LG webOS apps are packaged as `.ipk` files using LG's ares CLI tools.

**Prerequisites:**
- [webOS SDK](https://webostv.developer.lge.com/develop/tools/cli-installation) with `ares-*` CLI tools
- LG TV with Developer Mode app installed (from LG Content Store)
- Device registered via `ares-setup-device`

**Steps:**
```bash
# 1. Set up device connection
ares-setup-device

# 2. Build your web app
cd apps/display && pnpm build

# 3. Package as .ipk
ares-package ./dist -o ./output

# 4. Install on TV
ares-install --device <device-name> ./output/com.yourpackage_1.0.0_all.ipk

# 5. Launch
ares-launch --device <device-name> com.yourpackage
```

**Debugging:**
- `ares-inspect --device <device-name> --app com.yourpackage` (opens Chrome inspector automatically)

> **For AI agents:** The TV shell (Fire TV, Tizen, webOS) is a separate application maintained by the platform team. Your game's display app is loaded inside the shell as a web view. The shell provides `volley_hub_session_id`, `volley_platform`, and other query params. You don't build the shell -- you build the web app that runs inside it.

---

## 14. Common Pitfalls

A consolidated list of every gotcha documented in the learnings system.

| # | Pitfall | One-Line Summary |
|---|---------|------------------|
| 1 | **socketOptions.query clobbers VGF query** | Never pass `query` inside `socketOptions` -- it replaces `sessionId`, `userId`, `clientType`. |
| 2 | **PlatformProvider crashes without hub session ID** | `useHubSessionId()` throws at render time if `volley_hub_session_id` is missing. `PlatformProvider` may also fail during init (iframe, network). Use `MaybePlatformProvider`. |
| 3 | **endIf doesn't cascade from onConnect** | Phase transitions in lifecycle hooks must use the `nextPhase` pattern via a client-initiated thunk. WGFServer does not call `onConnect`/`onDisconnect` at all. |
| 4 | **endIf cascade crashes onBegin** | Cascaded `onBegin` gets a different context shape -- `getSessionId()` may not exist. Use thunks. |
| 5 | **VGF transport defaults to websocket-only** | Always override with `socketOptions.transports: ["polling", "websocket"]`. |
| 6 | **VGF state initialises as `{}`** | `useStateSync()` returns empty object before first sync. Guard with `"phase" in state`. |
| 7 | **VGF sessions must exist before connection** | Create via `POST /api/session` or `storage.createSession()` before clients connect. |
| 8 | **VGF scheduler is no-op in dev mode** | `MemoryStorage` produces `NoOpScheduler`. Use `DevScheduler` with `setTimeout` fallback. |
| 9 | **Reducers must be pure** | No `Date.now()` in reducers. Pass timestamps from thunks via action payloads. |
| 10 | **Port 8081 EADDRINUSE on tsx restart** | Deepgram proxy port doesn't release fast enough. Kill the process manually. |
| 11 | **Dev session deleted by disconnect timeout** | Closing tabs triggers session cleanup. Use `setInterval(ensureDevSession, 2000)` to auto-recreate. |
| 12 | **Error boundaries must be above providers** | Place `GameErrorBoundary` above `VGFProvider` and `PlatformProvider`. |
| 13 | **Stage "local" needs `platformApiUrl`** | Requires `platformApiUrl` for local development. `platformAuthApiUrl` does not exist in the Zod schema -- only `platformApiUrl` is validated. |
| 14 | **Deepgram auto-detect doesn't work** | Always specify `encoding=linear16&sample_rate=...` in the WebSocket URL. |
| 15 | **onBegin must return game state** | VGF's `PhaseRunner` does `newState = await phase.onBegin(ctx)`. Return type is `GameState | Promise<GameState>`. The emoji codebase returns void via type casting (`ctx: unknown`), which works but doesn't match the official type. |
| 16 | **`require()` in MaybePlatformProvider** | Do NOT refactor the `require("@volley/platform-sdk/react")` to `import()`. The synchronous conditional load is intentional and Vite handles it correctly. |
| 17 | **NPM auth required for @volley packages** | If `pnpm add @volley/vgf` fails with 404/403, run `npm login` first. Packages are on the public npm registry under the Volley org scope. |
| 18 | **Deepgram API key not set** | If voice input doesn't work in dev, check `.env` for `DEEPGRAM_API_KEY` and check server logs for the Deepgram proxy startup message. |

---

## 15. Complete Code Examples

### Full App.tsx (Display)

```typescript
// apps/display/src/App.tsx
import type { ReactNode } from "react"
import { GameErrorBoundary } from "./components/ErrorBoundary"
import { SceneRouter } from "./components/SceneRouter"
import { InputModeProvider } from "./providers/InputModeProvider"
import { VGFDisplayProvider } from "./providers/VGFDisplayProvider"
import { detectPlatform, isTV } from "./utils/detectPlatform"

/**
 * Wraps children with PlatformProvider only on real TV platforms.
 * The Platform SDK requires volley_hub_session_id in URL params (provided
 * by the TV shell). In dev/web mode this param is absent and the SDK
 * throws during construction. Skip it on web.
 */
function MaybePlatformProvider({ children }: { children: ReactNode }) {
    if (!isTV(detectPlatform())) return <>{children}</>

    // NOTE: require() is intentional -- see Pitfall #16
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PlatformProvider } = require("@volley/platform-sdk/react")
    return (
        <PlatformProvider
            options={{
                gameId: "your-game-id",
                appVersion: "1.0.0",
                stage: "staging",
                screensaverPrevention: { autoStart: true },
            }}
        >
            {children}
        </PlatformProvider>
    )
}

/**
 * DISPLAY app root.
 * Provider order matters:
 *   MaybePlatformProvider -> GameErrorBoundary -> InputModeProvider -> VGFDisplayProvider
 * GameErrorBoundary must wrap providers to catch init crashes.
 * InputModeProvider must be above VGFDisplayProvider so input mode
 * is known before the Socket.IO connection is established.
 */
export function App() {
    return (
        <MaybePlatformProvider>
            <GameErrorBoundary>
                <InputModeProvider>
                    <VGFDisplayProvider>
                        <SceneRouter />
                    </VGFDisplayProvider>
                </InputModeProvider>
            </GameErrorBoundary>
        </MaybePlatformProvider>
    )
}
```

### GameErrorBoundary

```typescript
// components/ErrorBoundary.tsx
import { Component, type ReactNode } from "react"

interface Props { children: ReactNode }
interface State { hasError: boolean }

/**
 * Catches render errors and shows a recovery screen.
 * Prevents white-screen crashes on the TV.
 */
export class GameErrorBoundary extends Component<Props, State> {
    state: State = { hasError: false }

    static getDerivedStateFromError(): State {
        return { hasError: true }
    }

    componentDidCatch(error: Error) {
        console.error("GameErrorBoundary caught:", error)
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{
                    width: "100%", height: "100%",
                    display: "flex", flexDirection: "column",
                    alignItems: "center", justifyContent: "center",
                    background: "#0f172a", color: "white",
                    fontFamily: "sans-serif",
                }}>
                    <h1>Something went wrong</h1>
                    <p>Restarting...</p>
                </div>
            )
        }
        return this.props.children
    }
}
```

### SceneRouter

Routes to the correct scene based on VGF phase:

```typescript
// components/SceneRouter.tsx
import type { ReactElement } from "react"
import { useGameState, useDispatch, useDispatchThunk } from "../hooks/useVGFState"
import { useInputMode } from "../providers/InputModeProvider"

export function SceneRouter() {
    const state = useGameState()
    const dispatch = useDispatch()
    const dispatchThunk = useDispatchThunk()
    const { isRemoteMode } = useInputMode()

    // Guard: VGF state initialises as {}
    if (!("phase" in state)) {
        return <LoadingScreen />
    }

    const { phase, quizSubState } = state

    // Show pairing overlay when waiting for controller (not in remote mode)
    const showPairing = !state.remoteMode
        && !state.controllerConnected
        && phase !== "lobby"
        && phase !== "gameOver"

    // Route to the correct scene based on phase
    let scene: ReactElement | null = null

    switch (phase) {
        case "lobby":
            scene = <Welcome pairingCode={state.pairingCode} />
            break
        case "categorySelect":
            scene = (
                <CategorySelect
                    onSelect={(category) => dispatch("SET_CATEGORY", { category })}
                    remoteMode={state.remoteMode}
                />
            )
            break
        case "difficultySelect":
            scene = (
                <DifficultySelect
                    onSelect={(difficulty) => dispatch("SET_DIFFICULTY", { difficulty })}
                    remoteMode={state.remoteMode}
                />
            )
            break
        case "playing":
            switch (quizSubState) {
                case "SOLUTION":
                    scene = <Solution answerText={state.lastAnswerText} />
                    break
                case "TIMEOUT":
                    scene = <Timeout answerText={state.lastAnswerText} />
                    break
                case "QUIZ_OVER":
                    scene = (
                        <GameOver
                            score={state.score}
                            onPlayAgain={() => dispatchThunk("RESTART_SAME", {})}
                            onChangeCategory={() => dispatchThunk("CHANGE_CATEGORY", {})}
                            remoteMode={state.remoteMode}
                        />
                    )
                    break
                default:
                    scene = (
                        <Quiz
                            emojis={state.currentEmojis}
                            score={state.score}
                            questionIndex={state.questionIndex}
                            totalQuestions={state.totalQuestions}
                            remoteMode={state.remoteMode}
                        />
                    )
            }
            break
        case "gameOver":
            scene = (
                <GameOver
                    score={state.score}
                    onPlayAgain={() => dispatchThunk("RESTART_SAME", {})}
                    onChangeCategory={() => dispatchThunk("CHANGE_CATEGORY", {})}
                    remoteMode={state.remoteMode}
                />
            )
            break
    }

    return (
        <>
            {scene}
            {showPairing && <PairingOverlay pairingCode={state.pairingCode} />}
        </>
    )
}
```

### Full VGFDisplayProvider

```typescript
// providers/VGFDisplayProvider.tsx
import { useMemo, type ReactNode } from "react"
import {
    VGFProvider,
    createSocketIOClientTransport,
    SocketIOClientTransport,
    ClientType,
} from "@volley/vgf/client"

function getQueryParam(name: string, fallback: string): string {
    return new URLSearchParams(window.location.search).get(name) ?? fallback
}

export function VGFDisplayProvider({ children }: { children: ReactNode }) {
    const transport = useMemo(() => {
        const url = import.meta.env.DEV
            ? "http://127.0.0.1:8080"   // Use 127.0.0.1, NOT localhost
            : window.location.origin

        return createSocketIOClientTransport({
            url,
            query: {
                sessionId: getQueryParam("sessionId", ""),
                userId: getQueryParam("userId", import.meta.env.DEV ? "display-dev" : ""),
                clientType: ClientType.Display,
            },
            socketOptions: {
                transports: ["polling", "websocket"],
                reconnectionAttempts: 10,
                reconnectionDelay: 1000,
                reconnectionDelayMax: 5000,
                // NEVER add query here -- it clobbers the VGF transport query
            },
        } as ConstructorParameters<typeof SocketIOClientTransport>[0])
    }, [])

    return <VGFProvider transport={transport}>{children}</VGFProvider>
}
```

### Full Game Ruleset (Server)

```typescript
// apps/server/src/ruleset.ts
import type { GameRuleset } from "@volley/vgf/server"
import type { YourGameState } from "@your-game/shared"
import { createInitialGameState } from "@your-game/shared"

export function createGameRuleset(services: GameServices): GameRuleset<YourGameState> {
    return {
        setup: createInitialGameState,
        actions: {},                       // Required field, pass empty object
        reducers: {
            SET_CATEGORY: (state, { category }) => ({ ...state, category }),
            SET_DIFFICULTY: (state, { difficulty }) => ({ ...state, difficulty }),
            SET_NEXT_PHASE: (state, { phase }) => ({ ...state, nextPhase: phase }),
            CLEAR_NEXT_PHASE: (state) => ({ ...state, nextPhase: null }),
            SET_REMOTE_MODE: (state) => ({ ...state, remoteMode: true }),
            SET_CONTROLLER_CONNECTED: (state, { connected }) => ({
                ...state, controllerConnected: connected,
            }),
            RESET_GAME: (state) => ({
                ...createInitialGameState(),
                remoteMode: state.remoteMode,
            }),
            // ... more reducers
        },
        thunks: {
            ACTIVATE_REMOTE_MODE: async (ctx) => {
                ctx.dispatch("SET_REMOTE_MODE", {})
                const state = ctx.getState()
                ctx.dispatch("SET_NEXT_PHASE", {
                    phase: state.isFtue ? "playing" : "categorySelect",
                })
            },
            PROCESS_TRANSCRIPTION: async (ctx, payload) => {
                // Match answer, update score, advance question
            },
            // ... more thunks
        },
        phases: {
            lobby: {
                actions: {}, reducers: {}, thunks: {},
                onBegin: async (ctx: unknown) => {
                    const c = ctx as PhaseLifecycleContext
                    c.reducerDispatcher("CLEAR_NEXT_PHASE", {})
                    return c.getState()
                },
                endIf: (ctx) => hasNextPhase(ctx.session.state),
                next: (ctx) => ctx.session.state.nextPhase ?? "playing",
            },
            // ... more phases (all using the nextPhase pattern)
        },
        // NOTE: WGFServer does NOT call onConnect/onDisconnect.
        // These are for VGFServer only. Move setup to client-initiated thunks.
        onConnect: async (ctx) => {
            const { clientType } = ctx.connection.metadata
            if (clientType === "CONTROLLER") {
                ctx.dispatch("SET_CONTROLLER_CONNECTED", { connected: true })
            }
        },
        onDisconnect: async (ctx) => {
            // Handle reconnection grace period, timer pause, etc.
        },
    }
}
```

### Full detectPlatform Utility

```typescript
// utils/detectPlatform.ts
export type TVPlatform = "WEB" | "FIRE_TV" | "SAMSUNG_TV" | "LG_TV" | "MOBILE"

export function detectPlatform(): TVPlatform {
    const params = new URLSearchParams(window.location.search)
    const override = params.get("volley_platform")
    if (override === "FIRE_TV") return "FIRE_TV"
    if (override === "SAMSUNG_TV") return "SAMSUNG_TV"
    if (override === "LG_TV") return "LG_TV"

    const ua = navigator.userAgent
    if (ua.includes("Tizen") && ua.includes("SMART-TV")) return "SAMSUNG_TV"
    if (ua.includes("Web0S") && ua.includes("SmartTV")) return "LG_TV"

    return "WEB"
}

export function isTV(platform: TVPlatform): boolean {
    return platform === "FIRE_TV" || platform === "SAMSUNG_TV" || platform === "LG_TV"
}
```

### Full useVGFState Hooks

```typescript
// hooks/useVGFState.ts
import { getVGFHooks, useConnectionStatus } from "@volley/vgf/client"
import type { YourGameState } from "@your-game/shared"
import { createInitialGameState } from "@your-game/shared"

const {
    useStateSync,
    useStateSyncSelector,
    useDispatch,
    useDispatchThunk,
    usePhase,
    useSessionMembers,
} = getVGFHooks<any, YourGameState, string>()

export {
    useStateSync,
    useStateSyncSelector,
    useDispatch,
    useDispatchThunk,
    usePhase,
    useSessionMembers,
    useConnectionStatus,
}

/**
 * Returns game state with a safe fallback for the initial empty state.
 * useStateSync() returns {} before the first state sync.
 */
export function useGameState(): YourGameState {
    let syncState: any
    try { syncState = useStateSync() } catch { syncState = null }

    if (syncState && "phase" in syncState) return syncState
    return createInitialGameState()
}
```

---

## Quick Start Checklist

For a new TV game project:

- [ ] Install Node.js >= 22, pnpm >= 10
- [ ] Run `npm login` and verify access to `@volley` packages
- [ ] Set up monorepo (Section 1): `pnpm-workspace.yaml`, root `package.json`, `tsconfig.base.json`
- [ ] Create `packages/shared` with game state type and `createInitialGameState()`
- [ ] Create `apps/display` with `@volley/vgf@^4.9.0`, `@volley/platform-sdk@^7.43.0`, `focus-trap-react`
- [ ] Create `apps/server` with `@volley/vgf@^4.9.0`, `@volley/waterfall`, `@volley/logger`, `socket.io`, `dotenv`
- [ ] Run `pnpm install`
- [ ] Create `detectPlatform.ts` utility
- [ ] Create `MaybePlatformProvider` (conditional Platform SDK)
- [ ] Create `GameErrorBoundary` (error boundary)
- [ ] Create `InputModeProvider` (remote vs controller detection)
- [ ] Create `VGFDisplayProvider` (transport + VGFProvider)
- [ ] Create typed VGF hooks via `getVGFHooks()`
- [ ] Create `useKeyHandler.ts` (local DOM-based key hooks)
- [ ] Create `useDPadNavigation.ts` hook
- [ ] Define server: `GameServices`, phases, reducers, thunks, lifecycle hooks
- [ ] Set up `dev.ts` with pre-created `dev-test` session and Deepgram proxy
- [ ] Add `DEEPGRAM_API_KEY` to `.env`
- [ ] Configure Vite with `strictPort: true`
- [ ] Add `@vitejs/plugin-legacy` with `target: "chrome68"` for Fire TV builds
- [ ] Test with `?inputMode=remote` and `?volley_platform=FIRE_TV`
- [ ] Deploy to target TV platform (Section 12)
- [ ] Create `apps/controller` (Section 16) with `@volley/platform-sdk`, `@volley/vgf`, `react-router-dom`
- [ ] Wrap controller App in `PlatformProvider` (with `gameId`, `stage`, `tracking`)
- [ ] Use Platform SDK `useDeviceInfo()` for device identity (not custom UUIDs)
- [ ] Configure Vite code splitting for controller build

---

## 16. Controller App Development (Phone)

This section covers building the **phone controller app** — the mobile web app that players open (via QR code or URL) to interact with a TV game. The controller runs in a mobile browser and communicates with the VGF server over Socket.IO.

> **Note:** The `vgf create` CLI does NOT scaffold a controller app. You must create `apps/controller/` manually following this section.

> **Context:** This section was written by comparing three production Volley projects:
> - **Wheel of Fortune** (`wheel-of-fortune`) — VGF game, closest reference for controller patterns
> - **CoComelon Mobile** (`cocomelon-mobile`) — Platform SDK app (non-VGF, raw WebSocket)
> - **Weekend Casino** (`weekend-poker`) — VGF game

### 16.1 Required Packages

Every controller app on the Volley platform **must** include these packages:

| Package | Version | Purpose |
|---------|---------|---------|
| `@volley/platform-sdk` | `^7.43.0` | Auth, analytics, lifecycle, device identity, native bridge |
| `@volley/vgf` | `^4.9.0` | Game state sync, Socket.IO transport, VGF hooks |
| `react` | `^19.0.0` | UI framework |
| `react-dom` | `^19.0.0` | DOM renderer |
| `react-router-dom` | `^7.8.0` | Client-side routing (standard across Volley apps) |
| `uuid` | `^11.1.0` | UUID generation (fallback identity) |

**Optional but recommended:**

| Package | Version | Purpose |
|---------|---------|---------|
| `@volley/tracking` | `^7.40.0` | Analytics event tracking (if not using platform-sdk's built-in Segment) |
| `@datadog/browser-rum` | `^6.10.0` | Real User Monitoring — crash reporting, session replay |
| `@datadog/browser-logs` | `^6.10.0` | Structured browser logging to Datadog |

**Dev dependencies:**

| Package | Purpose |
|---------|---------|
| `@vitejs/plugin-react-swc` | Faster JSX transpilation than `@vitejs/plugin-react` (used by WoF) |
| `vitest` + `@testing-library/react` + `jsdom` | Testing stack |
| `sass-embedded` | SCSS modules (if using SCSS instead of CSS-in-JS) |
| `@storybook/react-vite` | Component development (optional) |

### 16.2 PlatformProvider for Controllers

Both Cocomelon and Wheel of Fortune wrap their entire app in `PlatformProvider`. The controller version is simpler than the display version — no `MaybePlatformProvider` conditional needed because the controller always runs in a mobile browser (not on a TV shell), so `volley_hub_session_id` is not required.

```typescript
// apps/controller/src/App.tsx
import { PlatformProvider } from "@volley/platform-sdk/react"

const GAME_ID = import.meta.env.VITE_GAME_ID ?? "your-game-id"
const STAGE = import.meta.env.VITE_PLATFORM_SDK_STAGE ?? "staging"
const SEGMENT_WRITE_KEY = import.meta.env.VITE_SEGMENT_WRITE_KEY ?? ""

export function App() {
    return (
        <PlatformProvider
            options={{
                gameId: GAME_ID,
                appVersion: __APP_VERSION__,  // Defined in vite.config.ts
                stage: STAGE,
                tracking: {
                    segmentWriteKey: SEGMENT_WRITE_KEY,
                },
            }}
        >
            <ControllerRoot />
        </PlatformProvider>
    )
}
```

> **Note:** Unlike the display app, the controller does NOT need the `MaybePlatformProvider` pattern because it never runs inside the TV shell. The `PlatformProvider` can be rendered unconditionally.

### 16.3 Device Identity

**Do NOT generate random UUIDs in localStorage.** Use Platform SDK's `useDeviceInfo()` hook for device identification. This ties into Volley's user identity system and ensures consistent tracking across sessions.

```typescript
// WRONG — custom localStorage UUID approach
function useDeviceToken() {
    const [token] = useState(() => {
        return localStorage.getItem("device-token") ?? crypto.randomUUID()
    })
    return { deviceToken: token }
}

// CORRECT — use Platform SDK for device identity
import { useDeviceInfo } from "@volley/platform-sdk/react"

function useControllerSession() {
    const { deviceId } = useDeviceInfo()
    const sessionId = new URLSearchParams(window.location.search).get("sessionId")

    const transport = useMemo(() =>
        createSocketIOClientTransport({
            url: BACKEND_URL,
            query: {
                sessionId,
                userId: deviceId,   // Platform SDK device ID, not random UUID
                clientType: ClientType.Controller,
            },
        }),
        [sessionId, deviceId],
    )

    return { transport, sessionId, clientId: deviceId }
}
```

### 16.4 VGF Transport Configuration (Controller)

The controller transport setup is similar to the display but uses `ClientType.Controller`:

```typescript
// apps/controller/src/lib/createControllerTransport.ts
import { SocketIOClientTransport, ClientType } from "@volley/vgf"

const BACKEND_URL = import.meta.env.VITE_BACKEND_SERVER_ENDPOINT ?? "http://localhost:8001"

export function createControllerTransport(sessionId: string, userId: string) {
    return new SocketIOClientTransport({
        url: BACKEND_URL,
        query: {
            sessionId,
            userId,
            clientType: ClientType.Controller,
        },
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 3000,
        reconnectionDelayMax: 6000,
        transports: ["polling", "websocket"],  // MUST include polling fallback
    })
}
```

**Critical:** Do NOT put `query` inside a nested `socketOptions` object. This clobbers VGF's internal session/user/clientType params (see Section 4).

### 16.5 Provider Stacking Order

Wheel of Fortune's provider order (recommended pattern):

```typescript
// apps/controller/src/App.tsx
export function App() {
    return (
        <PlatformProvider options={platformOptions}>
            <BrowserRouter>
                <Routes>
                    <Route path="/" element={<RoomLayout />}>
                        <Route index element={<PhaseRouter />} />
                    </Route>
                </Routes>
            </BrowserRouter>
        </PlatformProvider>
    )
}

// apps/controller/src/layouts/RoomLayout.tsx
export function RoomLayout() {
    const { transport, sessionId, clientId } = useControllerSession()

    if (!sessionId) return <ErrorScreen message="No session ID found" />

    return (
        <VGFProvider transport={transport} autoConnect>
            <SessionProvider sessionId={sessionId}>
                <LoggerProvider>
                    <Outlet />
                </LoggerProvider>
            </SessionProvider>
        </VGFProvider>
    )
}
```

**Provider order (outermost to innermost):**
1. `PlatformProvider` — Auth, analytics, device info (no game dependency)
2. `BrowserRouter` — URL routing (no game dependency)
3. `VGFProvider` — Game state transport (needs session ID from URL)
4. `SessionProvider` — Session context (needs VGF connection)
5. `LoggerProvider` — Logging context (optional, can go anywhere)

### 16.6 Phase-Based Routing

Both VGF game controllers route UI based on the current game phase. Wheel of Fortune uses a `PhaseRouter` component:

```typescript
// apps/controller/src/components/PhaseRouter.tsx
import { vgfHooks } from "../hooks/vgfHooks"

export function PhaseRouter() {
    const phase = vgfHooks.usePhase()

    switch (phase) {
        case "LOBBY":
            return <LobbyController />
        case "PLAYING":
            return <PlayingController />
        case "ROUND_END":
            return <RoundEndController />
        case "GAME_OVER":
            return <GameOverController />
        default:
            return <Loading />
    }
}
```

This pattern is standard across VGF games — the server's VGF phase drives the controller's UI.

### 16.7 Typed VGF Hooks

Create a shared hooks file that types the VGF hooks to your game state:

```typescript
// apps/controller/src/hooks/vgfHooks.ts  (or packages/web-common/)
import { getVGFHooks, type GameRuleset } from "@volley/vgf"
import type { YourGameState, PhaseName } from "@your-game/shared"

export const vgfHooks = getVGFHooks<
    GameRuleset<YourGameState>,
    YourGameState,
    PhaseName
>()

// Re-export for convenience
export const useStateSync = vgfHooks.useStateSync
export const useStateSyncSelector = vgfHooks.useStateSyncSelector
export const useDispatch = vgfHooks.useDispatch
export const useDispatchThunk = vgfHooks.useDispatchThunk
export const usePhase = vgfHooks.usePhase
```

> **Tip:** Wheel of Fortune puts these hooks in a shared `web-common` package so both display and controller use the same typed hooks. This prevents type drift between the two apps.

### 16.8 Vite Configuration for Controllers

```typescript
// apps/controller/vite.config.ts
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react-swc"  // Faster than plugin-react
import { readFileSync } from "fs"

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"))

export default defineConfig(({ mode }) => ({
    plugins: [react()],
    define: {
        __APP_VERSION__: JSON.stringify(pkg.version),
    },
    server: {
        port: 5174,
        host: true,  // Allow access from other devices on the network (for phone testing)
    },
    build: {
        target: "es2019",
        sourcemap: mode === "production",
        rollupOptions: {
            output: {
                manualChunks: {
                    react: ["react", "react-dom"],
                    "shared-core": [
                        "@volley/vgf",
                        "@volley/platform-sdk",
                    ],
                },
            },
        },
    },
    // Base path for deployment (adjust for your CDN/hosting)
    base: mode === "production"
        ? "/your-game-controller/latest/"
        : "/",
}))
```

**Key differences from the display Vite config:**
- No `@vitejs/plugin-legacy` (phones have modern browsers, unlike Fire TV)
- No `target: "chrome68"` (that's a Fire TV constraint)
- `host: true` so you can test from a real phone on the same network
- Deployment base path is for the controller, not the display

### 16.9 Environment Variables

Controller apps should support these environment variables (via Vite's `VITE_` prefix):

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `VITE_BACKEND_SERVER_ENDPOINT` | Yes | `http://localhost:8001` | VGF server URL |
| `VITE_GAME_ID` | Yes | — | Game identifier for Platform SDK |
| `VITE_PLATFORM_SDK_STAGE` | Yes | `"staging"` | Platform SDK stage |
| `VITE_SEGMENT_WRITE_KEY` | No | — | Segment analytics key |
| `VITE_DD_APPLICATION_ID` | No | — | Datadog RUM application ID |
| `VITE_DD_CLIENT_TOKEN` | No | — | Datadog RUM client token |
| `VITE_DEEPGRAM_API_KEY` | No | — | Deepgram STT (if using voice) |

Use `.env` files per environment:
```
.env              # Local development defaults
.env.development  # Dev server config
.env.staging      # Staging config
.env.production   # Production config
```

### 16.10 React StrictMode and VGF

**All VGF apps must disable React StrictMode.** VGF's `SocketIOClientTransport` tears down message handlers on unmount. StrictMode's double-mount cycle causes the transport to disconnect and fail to reconnect, breaking state sync permanently.

```typescript
// main.tsx — do NOT use StrictMode with VGF
import { createRoot } from "react-dom/client"
import { App } from "./App"

const root = document.getElementById("root")
if (!root) throw new Error("Root element not found")

createRoot(root).render(<App />)  // No <StrictMode> wrapper
```

### 16.11 Mobile-First HTML Template

```html
<!-- apps/controller/index.html -->
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport"
          content="width=device-width, initial-scale=1, user-scalable=no, viewport-fit=cover" />
    <title>Your Game - Controller</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body, #root {
        width: 100%; height: 100%;
        background: #000;
        touch-action: manipulation;  /* Prevent double-tap zoom */
        -webkit-user-select: none; user-select: none;  /* Prevent text selection */
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**Key mobile settings:**
- `viewport-fit=cover` — extends content under the notch/safe area
- `user-scalable=no` — prevents pinch-to-zoom (game controller, not a web page)
- `touch-action: manipulation` — prevents double-tap zoom delay
- `-webkit-user-select: none` — prevents accidental text selection during gameplay

### 16.12 Shared web-common Package Pattern

Wheel of Fortune uses a `web-common` package shared between display and controller. This prevents type drift and duplicated VGF hook setup:

```
packages/
  web-common/
    src/
      contexts/
        SessionProvider.tsx    # Session ID context
        LoggerProvider.tsx     # Logger context
      hooks/
        vgfHooks.ts           # Typed VGF hooks (getVGFHooks<...>())
        useSessionId.ts       # Session ID hook
        useLogger.ts          # Logger hook
      lib/
        logger.ts             # Console logger with metadata
        createMockTransport.ts # Debug transport (no server needed)
      constants/
        environment.ts        # PLATFORM_API_URL, GAME_ID, etc.
      utils/
        classNames.ts         # CSS class utility
        getPlatformApiUrl.ts  # Platform API URL resolver
    package.json
```

This is optional but recommended for projects with both a display and controller app. It ensures both apps use identical VGF hook types and session management.

### 16.13 Cocomelon vs VGF Controller Architecture

Cocomelon Mobile is **not a VGF game** — it uses raw WebSocket with a custom state machine. However, its Platform SDK integration is a good reference:

| Aspect | VGF Controller (e.g., WoF) | Non-VGF Controller (Cocomelon) |
|--------|------------------------------|-------------------------------|
| **Transport** | VGF `SocketIOClientTransport` | Custom `WebSocketManager` + `WebSocketDriver` |
| **State sync** | VGF hooks (`useStateSync`, `usePhase`) | React Context + `useState` |
| **Routing** | Phase-based (`PhaseRouter`) | Event-based (server sends nav events, `react-router-dom` navigates) |
| **Game logic** | Server-side VGF reducers/thunks | Server-side (completely separate) |
| **Platform SDK** | `PlatformProvider` with `gameId`, `stage`, `tracking` | Same pattern, identical config |
| **Device identity** | `useDeviceInfo()` | `useAccount()` |
| **Reconnection** | VGF built-in (5 attempts, 3-6s delays) | Custom state machine (15 attempts, exponential backoff, 30s max) |
| **Microphone** | Deepgram SDK or VGF voice | Platform SDK `useMicrophone()` + custom DSP |

**Key takeaway:** Regardless of whether a game uses VGF, all Volley controller apps use `@volley/platform-sdk` with `PlatformProvider` for auth, analytics, and device identity. This is non-negotiable for production deployment.

---

## 17. Server Production Readiness

This section covers what a VGF game server needs to run on Volley's production infrastructure.

> **Reference:** Wheel of Fortune's `vgf-service` is the production reference implementation.

### 17.1 WGFServer vs VGFServer

VGF v4.9.0 provides two server classes. **Use `WGFServer`, not `VGFServer`.**

`WGFServer` is the newer API that accepts an explicit Socket.IO server instance, giving you control over CORS, middleware, and connection validation.

```typescript
// CORRECT — WGFServer pattern
import { WGFServer, MemoryStorage, RedisRuntimeSchedulerStore } from "@volley/vgf/server"
import { Server as SocketIOServer } from "socket.io"

const io = new SocketIOServer(httpServer, {
    cors: { origin: parseCorsOrigin(), methods: ["GET", "POST"] },
})

const storage = new MemoryStorage({ persistence: redisPersistence })
const schedulerStore = new RedisRuntimeSchedulerStore({ redisClient: redis })

const server = new WGFServer<YourGameState>({
    logger,
    port,
    httpServer,
    expressApp: app,
    socketIOServer: io,       // Explicit Socket.IO injection
    storage,
    gameRuleset: game,
    schedulerStore,           // Persistent scheduler (not noop)
})

server.start()
```

```typescript
// WRONG — old VGFServer pattern (deprecated)
import { VGFServer, MemoryStorage, SocketIOTransport } from "@volley/vgf/server"

const transport = new SocketIOTransport({ httpServer, storage })
const server = new VGFServer<YourGameState>({
    game: ruleset,
    httpServer, port, logger, storage, transport, app,
    schedulerProvider,  // Noop scheduler — actions are lost on restart
})
```

**Key differences:**
- `WGFServer` takes a `socketIOServer` instance (you control CORS, middleware)
- `WGFServer` takes a `schedulerStore` (persistent via Redis, survives restarts)
- `VGFServer` creates its own Socket.IO internally (less control)
- `VGFServer` uses a `SocketIOTransport` abstraction that WGF drops

### 17.2 Required Server Packages

| Package | Version | Purpose | WoF | Casino |
|---------|---------|---------|-----|--------|
| `@volley/vgf` | `^4.9.0` | Game framework | Yes | Yes |
| `@volley/logger` | `^1.4.1` | Structured logging with request IDs | Yes | **MISSING** (uses pino) |
| `socket.io` | `^4.8.1` | Explicit Socket.IO server (for WGFServer) | Yes | **MISSING** (VGF creates internally) |
| `uuid` | `^11.1.0` | Request ID generation for logging | Yes | **MISSING** |
| `ioredis` | `^5.4.0` | Redis client | Yes | Yes |
| `express` | `^4.18.0` | HTTP server | Yes | Yes |
| `cors` | `^2.8.5` | CORS middleware | Yes | Yes |

### 17.3 @volley/logger

All Volley production services use `@volley/logger` instead of raw pino. It provides structured logging with request tracing.

```typescript
// services/logger.ts
import { createLogger } from "@volley/logger"

export const logger = createLogger({
    type: "node",
    formatters: {
        level(label: string) { return { level: label } },
    },
})
```

**HTTP request logging middleware** (generates UUID per request for tracing):

```typescript
// express.ts
import { createLoggerHttpMiddleware } from "@volley/logger"
import { v4 } from "uuid"

app.use(createLoggerHttpMiddleware({
    logger,
    genReqId: () => v4(),
}))
```

This adds `req.logger` and `res.logger` to every request, pre-populated with the request ID. All downstream log calls include the trace ID automatically.

### 17.4 Redis Client (Production Pattern)

The dev-friendly "optional Redis" pattern is fine for local development, but production requires a resilient client that never gives up on reconnection.

```typescript
// services/redis.ts
import Redis from "ioredis"

export function createRedisClient(url: string): Redis {
    const client = new Redis(url, {
        maxRetriesPerRequest: null,    // Unlimited retries per command
        enableOfflineQueue: true,       // Queue commands while disconnected
        retryStrategy(times: number) {
            // Exponential backoff: 50ms, 100ms, 200ms, ..., capped at 5s
            // Jitter: 0-500ms random to prevent thundering herd
            return Math.min(Math.pow(2, times) * 25, 5000) + Math.random() * 500
        },
    })

    client.on("connect", () => logger.info("Redis connected"))
    client.on("ready", () => logger.info("Redis ready"))
    client.on("error", (err) => logger.error({ err }, "Redis error"))
    client.on("close", () => logger.warn("Redis connection closed"))

    return client
}
```

**Why this matters:**
- `maxRetriesPerRequest: null` prevents ioredis from throwing after 20 retries (default)
- `enableOfflineQueue: true` queues commands and replays when connection is restored
- Exponential backoff with jitter prevents all pods reconnecting simultaneously after a Redis restart

### 17.5 Health Check Endpoints

Production deployments (Kubernetes, ECS, GameLift) require two health endpoints:

```typescript
// health/index.ts
router.get("/health", (_req, res) => {
    res.json({
        version: process.env.npm_package_version ?? "unknown",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
    })
})

router.get("/health/ready", async (req, res) => {
    const redisCheck = await checkRedis(redis)

    const checks = { basic: { status: "healthy" }, redis: redisCheck }
    const allHealthy = Object.values(checks).every(c => c.status === "healthy")

    res.status(allHealthy ? 200 : 503).json({
        status: allHealthy ? "healthy" : "unhealthy",
        version: process.env.npm_package_version ?? "unknown",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        checks,
    })
})

async function checkRedis(redis: Redis): Promise<{ name: string; status: string; message: string }> {
    try {
        const pong = await Promise.race([
            redis.ping(),
            new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
        ])
        return { name: "redis", status: pong === "PONG" ? "healthy" : "unhealthy", message: "" }
    } catch (err) {
        return { name: "redis", status: "unhealthy", message: String(err) }
    }
}
```

**Endpoint usage:**
- `/health` — Basic liveness probe (always returns 200 if the process is running)
- `/health/ready` — Readiness probe (returns 503 if Redis is down, preventing traffic routing)

### 17.6 Graceful Shutdown

```typescript
// index.ts (after server.start())
const SHUTDOWN_TIMEOUT = parseInt(process.env.SHUTDOWN_TIMEOUT ?? "25000", 10)

async function shutdown(signal: string) {
    logger.info({ signal }, "Shutdown signal received")
    const timer = setTimeout(() => {
        logger.error("Graceful shutdown timed out, forcing exit")
        process.exit(1)
    }, SHUTDOWN_TIMEOUT)

    try {
        server.stop()
        await redis.quit()
        httpServer.close()
        clearTimeout(timer)
        logger.info("Graceful shutdown complete")
        process.exit(0)
    } catch (err) {
        logger.error({ err }, "Error during shutdown")
        process.exit(1)
    }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"))
process.on("SIGINT", () => void shutdown("SIGINT"))
```

### 17.7 Error Handling Middleware

Register these **after** `server.start()` (which registers VGF's own routes):

```typescript
// middleware/errorHandlers.ts

// 404 handler (must be after all routes)
app.use((_req, res) => {
    res.status(404).json({ error: "Not Found" })
})

// Error handler (4-arg signature tells Express this handles errors)
app.use((err: Error & { statusCode?: number }, req, res, _next) => {
    req.logger?.error({
        error: { name: err.name, message: err.message, stack: err.stack },
        request: { method: req.method, url: req.url },
        source: "express-error-handler",
    })

    const statusCode = err.statusCode ?? 500
    const message = statusCode >= 500 ? "Internal Server Error" : err.message
    res.status(statusCode).json({ error: message })
})
```

### 17.8 Session Validation Middleware

WoF validates session creation requests before VGF processes them:

```typescript
// session/session.middleware.ts
app.post("/api/session", (req, res, next) => {
    logger.info({
        ip: req.ip,
        userAgent: req.headers["user-agent"],
    }, "Session creation request")

    // Add custom validation here (auth tokens, rate limiting, etc.)
    next()  // Pass to VGF's session handler
})
```

Register this **before** `server.start()`.

### 17.9 Docker Configuration

**Dockerfile (multi-stage build):**

```dockerfile
# Base stage
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# Dependencies stage
FROM base AS dependencies
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/package.json ./apps/server/
RUN --mount=type=secret,id=npm_token \
    NPM_TOKEN=$(cat /run/secrets/npm_token) pnpm install --frozen-lockfile

# Build stage
FROM dependencies AS build
COPY . .
RUN pnpm -r build

# Production stage
FROM base AS production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/package.json ./apps/server/

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

ENTRYPOINT ["node", "apps/server/dist/index.js"]
```

**docker-compose.yml:**

```yaml
services:
  vgf-server:
    build:
      context: .
      target: ${NODE_ENV:-development}
      secrets:
        - npm_token
    ports:
      - "${VGF_PORT:-8001}:3000"
    environment:
      - NODE_ENV=${NODE_ENV:-development}
      - REDIS_URL=redis://redis:6379
      - PORT=3000
    depends_on:
      redis:
        condition: service_healthy
    networks:
      - game-network

  redis:
    image: redis:7-alpine
    ports:
      - "${REDIS_PORT:-6379}:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5
    networks:
      - game-network

networks:
  game-network:
    driver: bridge

secrets:
  npm_token:
    environment: NPM_TOKEN
```

### 17.10 Server Environment Variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `NODE_ENV` | No | `development` | Node environment |
| `PORT` | No | `3000` | HTTP server port |
| `REDIS_URL` | Yes (prod) | — | Redis connection string (`redis://host:6379`) |
| `LOG_LEVEL` | No | `info` | Logging level (`debug`, `info`, `warn`, `error`) |
| `CORS_ORIGIN` | No | `*` | Allowed origins (comma-separated, or `*`) |
| `SHUTDOWN_TIMEOUT` | No | `25000` | Graceful shutdown timeout in ms |
| `STAGE` | No | `local` | Deployment stage (`local`, `dev`, `staging`, `production`) |

---

## 18. Display Production Readiness

This section covers what the display app (TV screen) needs for production deployment.

### 18.1 Platform SDK as Hard Dependency

The display app **must** have `@volley/platform-sdk` as a required dependency (not an optional peer). On real TV hardware, the SDK provides authentication, session management, and analytics that the game cannot function without.

```json
// apps/display/package.json
{
    "dependencies": {
        "@volley/platform-sdk": "^7.43.0",
        "@volley/vgf": "^4.9.0"
    }
}
```

The `MaybePlatformProvider` pattern (skip SDK on web/dev) is still correct for the display, since it may run in a browser during development without the TV shell. But the package itself must be installed.

### 18.2 Stage-Aware Platform URL Resolution

Platform API URLs must resolve per stage. Do not hardcode dev URLs.

```typescript
// utils/getPlatformApiUrl.ts
const PLATFORM_API_URLS: Record<string, string> = {
    local: "platform-dev.volley-services.net",
    test: "platform-dev.volley-services.net",
    dev: "platform-dev.volley-services.net",
    staging: "platform-staging.volley-services.net",
    production: "platform.volley-services.net",
}

export function getPlatformApiUrl(stage?: string): string {
    if (!stage) return PLATFORM_API_URLS["production"]!
    return PLATFORM_API_URLS[stage] ?? PLATFORM_API_URLS["production"]!
}
```

### 18.3 Electron IPC Configuration

On GameLift Streams or a real TV, the Electron main process receives configuration from the platform and must pass it to the renderer via IPC.

**Main process (electron/main.cjs):**

```javascript
const { app, BrowserWindow, ipcMain } = require("electron")

// Config from CLI args, env vars, or platform launcher
const config = {
    sessionId: process.env.SESSION_ID ?? "",
    backendUrl: process.env.BACKEND_URL ?? "http://localhost:3000",
    stage: process.env.STAGE ?? "local",
}

// Register IPC handlers BEFORE creating the window
ipcMain.handle("get-session-id", () => config.sessionId)
ipcMain.handle("get-backend-url", () => config.backendUrl)
ipcMain.handle("get-stage", () => config.stage)

function createWindow() {
    const win = new BrowserWindow({
        width: 1920,
        height: 1080,
        fullscreen: true,
        frame: false,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: path.join(__dirname, "preload.cjs"),
        },
    })

    // Open DevTools unless production
    if (config.stage !== "production") {
        win.webContents.openDevTools()
    }
}
```

**Preload (electron/preload.cjs):**

```javascript
const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("electronAPI", {
    getSessionId: () => ipcRenderer.invoke("get-session-id"),
    getBackendUrl: () => ipcRenderer.invoke("get-backend-url"),
    getStage: () => ipcRenderer.invoke("get-stage"),
    platform: "ELECTRON",
    isElectron: true,
})
```

**Renderer (config loader):**

```typescript
// utils/configLoader.ts
export async function loadConfig() {
    if (window.electronAPI?.isElectron) {
        return {
            sessionId: await window.electronAPI.getSessionId(),
            backendUrl: await window.electronAPI.getBackendUrl(),
            stage: await window.electronAPI.getStage(),
        }
    }
    // Fallback: Vite env vars for browser dev
    return {
        sessionId: new URLSearchParams(window.location.search).get("sessionId"),
        backendUrl: import.meta.env.VITE_SERVER_URL ?? "http://localhost:3000",
        stage: import.meta.env.VITE_PLATFORM_SDK_STAGE ?? "local",
    }
}
```

### 18.4 Mock Transport for Headless Debug

WoF provides a `createMockTransport()` that allows the display to run without a VGF server. This is useful for UI development, Storybook, and automated testing.

```typescript
// lib/createMockTransport.ts
import { SocketIOClientTransport } from "@volley/vgf/client"

export function createMockTransport(): SocketIOClientTransport {
    // Return a transport that never connects but doesn't throw.
    // Components fall back to loading/error states gracefully.
    return new SocketIOClientTransport({
        url: "http://localhost:0",
        query: { sessionId: "mock", userId: "mock", clientType: "Display" },
    })
}
```

Use in the app:

```typescript
const useMock = !sessionId && stage === "local"
const transport = useMock ? createMockTransport() : createDisplayTransport(config)

<VGFProvider transport={transport} clientOptions={{ autoConnect: !useMock }}>
```

### 18.5 Display Vite Configuration (Production Pattern)

```typescript
// apps/display/vite.config.ts
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react-swc"
import path from "path"
import pkg from "./package.json" with { type: "json" }

export default defineConfig(({ mode }) => ({
    plugins: [react()],
    base: "./",
    define: {
        __APP_VERSION__: JSON.stringify(pkg.version),
    },
    resolve: {
        alias: { "@": path.resolve(__dirname, "./src") },
        dedupe: ["react", "react-dom"],   // Prevent multiple React instances
    },
    optimizeDeps: {
        force: true,
        include: ["react", "react/jsx-runtime", "react-dom"],
    },
    build: {
        target: "es2019",
        sourcemap: mode === "development" ? "inline" : true,
        chunkSizeWarningLimit: 300,
        minify: "esbuild",
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (id.includes("@volley/") || id.includes("@your-game/"))
                        return "shared-core-deps"
                    if (id.includes("three") || id.includes("@react-three"))
                        return "three-vendor"
                    if (id.includes("react-dom")) return "react-dom"
                    if (id.includes("/react/")) return "react"
                    if (id.includes("node_modules")) return "vendor"
                },
            },
        },
    },
}))
```

---

## 19. Monorepo Infrastructure

This section covers root-level monorepo configuration required for Volley production projects.

### 19.1 .npmrc

Create `.npmrc` at the monorepo root:

```
inject-workspace-packages=true
```

This ensures workspace package symlinks are injected into `node_modules` correctly. WoF has this; Casino does not.

### 19.2 Turborepo

WoF uses Turborepo for task orchestration, caching, and delta-based CI. Add `turbo.json` at the root:

```json
{
    "$schema": "https://turbo.build/schema.json",
    "globalEnv": ["NODE_ENV"],
    "tasks": {
        "build": {
            "dependsOn": ["^build"],
            "inputs": ["$TURBO_DEFAULT$", "!**/*.md", "!**/*.test.*", "!**/*.spec.*"],
            "outputs": ["dist/**", ".electron-builder/**"],
            "env": ["VITE_*"]
        },
        "dev": {
            "persistent": true
        },
        "lint": {
            "inputs": ["$TURBO_DEFAULT$", "!**/*.md"]
        },
        "typecheck": {
            "inputs": ["$TURBO_DEFAULT$", "!**/*.md"]
        },
        "test": {
            "dependsOn": ["^build"],
            "inputs": ["$TURBO_DEFAULT$", "!**/*.md"],
            "outputs": ["coverage/**"]
        }
    }
}
```

Install as a root dev dependency:

```bash
pnpm add -Dw turbo
```

Then update root `package.json` scripts:

```json
{
    "scripts": {
        "build": "turbo build",
        "test": "turbo test",
        "typecheck": "turbo typecheck",
        "lint": "turbo lint",
        "dev": "turbo dev"
    }
}
```

### 19.3 Prettier + lint-staged

WoF enforces consistent formatting on every commit.

**`.prettierrc`:**
```json
{
    "trailingComma": "es5",
    "tabWidth": 2,
    "semi": false,
    "singleQuote": true
}
```

**Root `package.json` additions:**
```json
{
    "devDependencies": {
        "prettier": "^3.2.0",
        "lint-staged": "^16.0.0"
    },
    "lint-staged": {
        "*.{ts,tsx,js,jsx,json}": "prettier --write"
    },
    "scripts": {
        "format": "prettier --write .",
        "format:check": "prettier --check .",
        "prepare": "git config core.hooksPath .hooks"
    }
}
```

**`.hooks/pre-commit`:**
```bash
#!/bin/sh
npx lint-staged
```

### 19.4 Shared Configuration Packages

WoF extracts ESLint and TypeScript configuration into shared workspace packages:

```
packages/
  eslint-config/
    package.json    # @your-game/eslint-config
    base.js         # Shared ESLint rules
  tsconfig/
    package.json    # @your-game/tsconfig
    base.json       # Shared compiler options
    react.json      # React-specific (extends base)
    node.json       # Node-specific (extends base)
```

Apps reference these:
```json
// apps/server/tsconfig.json
{ "extends": "../../packages/tsconfig/node.json" }

// apps/display/tsconfig.json
{ "extends": "../../packages/tsconfig/react.json" }
```

### 19.5 CI/CD Pipeline (GitHub Actions)

WoF's CI runs jobs in parallel with Turbo caching and delta-based filtering:

```yaml
# .github/workflows/ci.yml
name: CI
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo typecheck --filter='...[origin/main]'

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo test --filter='...[origin/main]'

  build:
    runs-on: ubuntu-latest
    needs: [typecheck, test]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo build --filter='...[origin/main]'
```

**Key features:**
- `--filter='...[origin/main]'` only runs tasks for packages changed since main (delta CI)
- `concurrency.cancel-in-progress` cancels outdated CI runs on force-push
- `needs: [typecheck, test]` means build only runs after checks pass
- Parallel jobs (typecheck + test run simultaneously)

### 19.6 Setup and Dev Scripts

WoF provides shell scripts for first-time setup and multi-service development:

**`scripts/setup.sh`** — First-time project setup:
```bash
#!/bin/bash
# Check prerequisites (node, pnpm, docker)
# Copy .env.example to .env if not exists
# Validate NPM_TOKEN for @volley packages
# Run pnpm install
# Build shared packages
```

**`scripts/dev-all.sh`** — Start all services:
```bash
#!/bin/bash
# Start Docker services (Redis, WGF server)
# Wait for health checks to pass
# Start display and controller dev servers via Turbo
```

---

## 20. Multi-Client Testing

The single biggest source of integration bugs is testing the display in isolation without a controller (or vice versa). WGF provides a built-in multi-client tester that runs display and controller(s) side-by-side in a single browser window.

### Launching the Tester

```bash
vgf multi-client
```

This starts a local server on port 9001. Open `http://localhost:9001` in your browser.

### Interface Layout

| Area | Position | Format | Purpose |
|------|----------|--------|---------|
| Display | Left side | 16:9, letterboxed | TV screen view |
| Controllers | Right side | Up to 4 iframes, 9:16 each | Phone controller views |

The controllers panel arranges iframes in up to 2 rows and auto-sizes based on controller count. It hides entirely when no controllers are active.

Three floating toolbars provide controls:

- **Top-left:** New session — creates a fresh session and reloads all iframes
- **Bottom-left:** Settings — opens the query params editor
- **Bottom-right:** Add/remove controllers (up to 4)

### Query Params Editor

The settings modal lets you edit query params passed to each client iframe. Each client (display + each controller slot 1–4) has its own key/value table. Params persist to `localStorage`. A reset button restores defaults.

`clientType` and `sessionId` are **injected automatically** and not shown in the editor — you never need to set these manually. When a controller is removed, its params view becomes inactive rather than deleted.

### User IDs

Each client type gets a unique, persistent user ID stored in `localStorage`. The display and each controller slot (1–4) each have their own. This means:

- Refreshing the page keeps the same user IDs (simulates reconnection)
- Opening a new browser/incognito window generates fresh IDs (simulates new players)

### Configuration

| Option | Description |
|--------|-------------|
| `--client-host` | Host for both client types (fallback) |
| `--display-host` | Host for the display client (overrides `--client-host`) |
| `--controller-host` | Host for controller clients (overrides `--client-host`) |
| `--backend-url` | Backend API endpoint |
| `--dev-port` | Port for the multi-client interface (default: 9001) |

```bash
# Separate hosts for display and controllers
vgf multi-client \
  --display-host http://localhost:3000 \
  --controller-host http://localhost:5173

# Override just the backend
vgf multi-client \
  --backend-url http://localhost:8080

# Different port for the tester itself
vgf multi-client --dev-port 9002
```

### Typical Multi-Client Testing Workflow

1. Start your WGF server: `pnpm --filter @your-game/server dev`
2. Start display dev server: `pnpm --filter @your-game/display dev`
3. Start controller dev server: `pnpm --filter @your-game/controller dev`
4. Launch the tester:
   ```bash
   vgf multi-client \
     --display-host http://localhost:3000 \
     --controller-host http://localhost:5173 \
     --backend-url http://localhost:8080
   ```
5. Click "New Session" in the top-left toolbar
6. Click "+" in the bottom-right toolbar to add a controller
7. Test the full flow: lobby → game → results with both clients visible

### What to Test with Multiple Clients

| Scenario | What to Verify |
|----------|---------------|
| Controller connects | Display updates lobby/player list, `onConnect` fires correctly |
| Controller disconnects (close iframe) | Display handles absence, `onDisconnect` fires, timeout behaviour |
| Multiple controllers | All players appear in `useSessionMembers`, turns work correctly |
| State sync | Reducer dispatch from controller updates display in real-time |
| Phase transitions | Both display and controller react to phase changes |
| Reconnection | Remove controller, re-add it — same `userId` reconnects to existing `SessionMember` |

> **For AI agents:** Always verify multi-client scenarios before considering a feature complete. Single-client testing misses state sync bugs, race conditions in `onConnect`/`onDisconnect`, and display/controller UI divergence.

---

## 21. Lobby & SessionMember Patterns

WGF provides a built-in lobby system through `SessionMember` — do not roll your own player-tracking state.

### SessionMember Structure

When a client connects, WGF creates a `SessionMember` automatically:

```typescript
interface SessionMember {
    sessionMemberId: string      // Unique ID for this membership
    connectionId: string         // Current WebSocket connection ID
    connectionState: ConnectionState  // "Connected" | "Disconnected"
    isReady: boolean             // Ready-check state (defaults to false)
    clientType: ClientType       // "DISPLAY" | "CONTROLLER"
    state: SessionMemberState    // Custom per-client data (character, team, etc.)
}
```

### Client Hooks

```typescript
import { getVGFHooks } from "@volley/vgf/client"

const {
    useSessionMembers,  // Returns all SessionMembers in the session
    useSessionMember,   // Returns a specific SessionMember by ID
    useClientId,        // Returns current client's member ID
    useClientActions,   // Returns { toggleReady(), updateState() }
} = getVGFHooks<any, YourGameState, string>()
```

### Ready-Check Pattern

The standard lobby flow: players join, toggle ready, game starts when all are ready.

**Client (controller):**

```typescript
function LobbyScreen() {
    const { toggleReady, updateState } = useClientActions()
    const members = useSessionMembers()
    const myId = useClientId()

    const me = members[myId]
    const allReady = Object.values(members)
        .filter((m) => m.clientType === "CONTROLLER")
        .every((m) => m.isReady)

    return (
        <div>
            <h2>Lobby</h2>
            {Object.entries(members)
                .filter(([_, m]) => m.clientType === "CONTROLLER")
                .map(([id, member]) => (
                    <div key={id}>
                        Player {id} — {member.isReady ? "Ready" : "Waiting"}
                    </div>
                ))}
            <button onClick={() => toggleReady()}>
                {me?.isReady ? "Not Ready" : "Ready"}
            </button>
        </div>
    )
}
```

**Server (thunk to start the game):**

```typescript
export function createStartGameThunk() {
    return async (ctx: IThunkContext<YourGameState>) => {
        const members = ctx.getMembers()
        const controllers = Object.values(members)
            .filter((m) => m.clientType === "CONTROLLER")

        if (controllers.length === 0) return
        if (!controllers.every((m) => m.isReady)) return

        ctx.dispatch("SET_NEXT_PHASE", { phase: "playing" })
    }
}
```

### Built-In Client Reducers

WGF provides these automatically — you do not need to define them:

| Reducer | Triggered By | Effect |
|---------|-------------|--------|
| `__CLIENT_TOGGLE_READY` | `toggleReady()` | Flips `isReady` on the calling client's `SessionMember` |
| `__CLIENT_UPDATE_STATE` | `updateState(data)` | Merges `data` into the client's `SessionMemberState` |

### Custom SessionMemberState

Store per-player data (character selection, team, display name) in `SessionMemberState`:

```typescript
// Client: update custom per-player state
const { updateState } = useClientActions()
updateState({ characterId: "wizard", displayName: "Player 1" })

// Server: read in thunks or lifecycle hooks
const members = ctx.getMembers()
const playerData = members[clientId].state
// playerData.characterId === "wizard"
```

### Advanced Lobby Patterns

**Auto-start countdown:**

```typescript
// Server thunk: called after every toggleReady
export function createCheckReadyThunk(services: GameServices) {
    return async (ctx: IThunkContext<YourGameState>) => {
        const members = ctx.getMembers()
        const controllers = Object.values(members)
            .filter((m) => m.clientType === "CONTROLLER")

        if (controllers.length >= 2 && controllers.every((m) => m.isReady)) {
            // Start a 3-second countdown, then transition
            await ctx.scheduler.upsertTimeout({
                name: "lobby-countdown",
                duration: 3000,
                thunkName: "START_GAME",
            })
            ctx.dispatch("SET_COUNTDOWN_ACTIVE", { active: true })
        } else {
            await ctx.scheduler.cancel("lobby-countdown")
            ctx.dispatch("SET_COUNTDOWN_ACTIVE", { active: false })
        }
    }
}
```

---

## 22. Failover & Idempotency

WGF is designed for production environments where servers restart, Redis connections drop, and pods get rescheduled. Understanding failover semantics is critical for writing correct server-side code.

### At-Least-Once Thunk Delivery

**Thunks may execute more than once.** When a server fails mid-thunk and recovers, the Scheduler replays in-progress work. This means:

| Property | Requirement |
|----------|-------------|
| **Idempotent** | Running the same thunk twice with the same input must produce the same result |
| **Re-entrant** | A thunk must be safe to call while a previous invocation is still running |

```typescript
// WRONG: Not idempotent — score increments on every replay
export function createScoreThunk() {
    return async (ctx: IThunkContext<YourGameState>) => {
        const state = ctx.getState()
        ctx.dispatch("SET_SCORE", { score: state.score + 10 })
    }
}

// RIGHT: Idempotent — uses guard to prevent double-scoring
export function createScoreThunk() {
    return async (ctx: IThunkContext<YourGameState>) => {
        const state = ctx.getState()
        if (state.scoredCurrentQuestion) return  // Guard against replay
        ctx.dispatch("MARK_SCORED", {})
        ctx.dispatch("SET_SCORE", { score: state.score + 10 })
    }
}
```

### Scheduler Timer Modes

The Scheduler API provides failover-safe timers. Two modes control how timers behave when the server goes down and recovers:

| Mode | Behaviour During Downtime | On Recovery |
|------|--------------------------|-------------|
| **Hold** | Timer pauses while server is down | Resumes from where it left off (remaining time preserved) |
| **Catch-up** | Timer is considered still running | If the elapsed time exceeds the duration, fires immediately |

```typescript
// Round timer: hold mode (fair — players don't lose time during outage)
await ctx.scheduler.upsertTimeout({
    name: "round-timer",
    duration: 30000,
    thunkName: "HANDLE_TIMEOUT",
    // Hold is the default mode
})

// Show-results delay: catch-up mode (no point pausing a transition delay)
await ctx.scheduler.upsertTimeout({
    name: "show-results",
    duration: 5000,
    thunkName: "ADVANCE_PHASE",
    mode: "catch-up",
})
```

### Scheduler Operations

```typescript
// In any thunk via ctx.scheduler:
await ctx.scheduler.upsertTimeout(config)  // Create or update a timer
await ctx.scheduler.cancel("timer-name")   // Cancel a running timer
await ctx.scheduler.pause("timer-name")    // Pause (preserves remaining time)
await ctx.scheduler.resume("timer-name")   // Resume a paused timer
```

### RuntimeSchedulerStore

For production, use `RedisRuntimeSchedulerStore` so timers survive server restarts:

```typescript
import { RedisRuntimeSchedulerStore } from "@volley/vgf/server"

const runtimeSchedulerStore = new RedisRuntimeSchedulerStore(redisClient)

const server = new WGFServer({
    // ... other options
    runtimeSchedulerStore,
})
```

In dev mode, `MemoryStorage` works fine — timers are lost on restart but that's acceptable for development.

### Long-Running Work Pattern

For operations that take longer than a single tick (e.g. fetching questions from an API), track progress in state so replays can skip completed work:

```typescript
export function createLoadQuestionsThunk(services: GameServices) {
    return async (ctx: IThunkContext<YourGameState>) => {
        const state = ctx.getState()

        // Skip if already loaded (idempotent guard)
        if (state.questionsLoaded) return

        const questions = await services.database.query(
            "SELECT * FROM questions WHERE category = $1 LIMIT $2",
            [state.category, state.totalQuestions],
        )

        ctx.dispatch("SET_QUESTIONS", { questions: questions.rows })
        ctx.dispatch("SET_QUESTIONS_LOADED", { loaded: true })
    }
}
```

---

## 23. Testing Patterns

WGF code is highly testable because of its separation of concerns: reducers are pure functions, thunks receive an injectable context, and phases are declarative.

### Reducer Unit Tests

Reducers are pure — test them as plain functions:

```typescript
// __tests__/reducers.test.ts
import { describe, it, expect } from "vitest"
import { reducers } from "../src/reducers"
import { createInitialGameState } from "@your-game/shared"

describe("SET_SCORE", () => {
    it("updates the score", () => {
        const state = createInitialGameState()
        const result = reducers.SET_SCORE(state, { score: 42 })
        expect(result.score).toBe(42)
    })

    it("preserves other state fields", () => {
        const state = { ...createInitialGameState(), phase: "playing" }
        const result = reducers.SET_SCORE(state, { score: 100 })
        expect(result.phase).toBe("playing")
    })
})

describe("SET_NEXT_PHASE", () => {
    it("sets the nextPhase field without modifying phase", () => {
        const state = createInitialGameState()
        const result = reducers.SET_NEXT_PHASE(state, { phase: "playing" })
        expect(result.nextPhase).toBe("playing")
        expect(result.phase).toBe("lobby")  // phase is UNCHANGED
    })
})

describe("CLEAR_NEXT_PHASE", () => {
    it("resets nextPhase to null", () => {
        const state = { ...createInitialGameState(), nextPhase: "playing" }
        const result = reducers.CLEAR_NEXT_PHASE(state)
        expect(result.nextPhase).toBeNull()
    })
})
```

### Thunk Tests with Mocked Context

Create a mock `IThunkContext` to test thunks in isolation:

```typescript
// __tests__/helpers/mockThunkContext.ts
import type { YourGameState } from "@your-game/shared"

export function createMockThunkContext(initialState: YourGameState) {
    let state = { ...initialState }
    const dispatches: Array<{ reducer: string; args: unknown }> = []
    const thunkDispatches: Array<{ thunk: string; args: unknown }> = []

    return {
        ctx: {
            getState: () => state,
            getSessionId: () => "test-session",
            getClientId: () => "test-client",
            dispatch: (reducerName: string, args: unknown) => {
                dispatches.push({ reducer: reducerName, args })
                // Optionally apply the reducer to update state
            },
            dispatchThunk: async (thunkName: string, args: unknown) => {
                thunkDispatches.push({ thunk: thunkName, args })
            },
            getMembers: () => ({}),
            scheduler: {
                upsertTimeout: async () => {},
                cancel: async () => {},
                pause: async () => {},
                resume: async () => {},
            },
            sessionManager: { kickClient: () => {} },
            logger: { info: () => {}, error: () => {} },
        },
        dispatches,
        thunkDispatches,
    }
}
```

```typescript
// __tests__/thunks.test.ts
import { describe, it, expect } from "vitest"
import { createProcessTranscriptionThunk } from "../src/thunks/processTranscription"
import { createMockThunkContext } from "./helpers/mockThunkContext"
import { createInitialGameState } from "@your-game/shared"

describe("PROCESS_TRANSCRIPTION", () => {
    const mockServices = {
        waterfall: {
            match: (text: string, targets: string[]) => ({
                foundMatch: targets.includes(text.toLowerCase()),
                confidence: 1,
                matchedAnswer: text,
            }),
        },
        // ... other stubbed services
    }

    it("dispatches SET_SCORE on correct answer", async () => {
        const state = {
            ...createInitialGameState(),
            phase: "playing",
            quizSubState: "QUESTION",
        }
        const { ctx, dispatches } = createMockThunkContext(state)
        const thunk = createProcessTranscriptionThunk(mockServices as any)

        await thunk(ctx as any)

        expect(dispatches).toContainEqual(
            expect.objectContaining({ reducer: "SET_SCORE" }),
        )
    })
})
```

### Phase Transition Tests

Test `endIf` conditions and `next` routing as pure logic:

```typescript
describe("phase transitions", () => {
    it("lobby ends when controller connects", () => {
        const phases = createPhases(mockServices)
        const state = { ...createInitialGameState(), controllerConnected: true }
        const ctx = { session: { state } }

        expect(phases.lobby.endIf(ctx as any)).toBe(true)
    })

    it("lobby routes FTUE users to playing", () => {
        const phases = createPhases(mockServices)
        const state = { ...createInitialGameState(), isFtue: true }
        const ctx = { session: { state } }
        const nextFn = phases.lobby.next as (ctx: any) => string

        expect(nextFn(ctx as any)).toBe("playing")
    })
})
```

### Client Component Tests

For React components that use WGF hooks, mock the VGFProvider:

```typescript
// __tests__/helpers/MockVGFProvider.tsx
import { VGFProvider } from "@volley/vgf/client"

// Use createMockTransport (Section 18.4) for component tests
export function MockVGFProvider({
    children,
    initialState,
}: {
    children: React.ReactNode
    initialState: YourGameState
}) {
    const transport = createMockTransport()
    return (
        <VGFProvider transport={transport} clientOptions={{ autoConnect: false }}>
            {children}
        </VGFProvider>
    )
}
```

### What to Test (Checklist)

| Layer | What to Test | How |
|-------|-------------|-----|
| Reducers | State transitions are correct | Pure function unit tests |
| Thunks | Side effects, dispatches, error handling | Mock context |
| Phase `endIf` | Transition conditions | Pure function unit tests |
| Phase `next` | Routing logic | Pure function unit tests |
| `onBegin` / `onEnd` | Lifecycle setup/teardown | Mock context |
| Client components | Rendering per state | Mock VGFProvider |
| Multi-client | Full flow (display + controller) | `vgf multi-client` (Section 20) |

---

## 24. Reconnection Handling

Real TV devices lose WiFi, phone screens lock, and WebSocket connections drop. WGF handles reconnection automatically but you need to understand the flow to build resilient UIs.

### WebSocket Handshake Lifecycle

When a client connects, WGF validates the handshake query parameters:

1. **Validation:** Checks `sessionId`, `userId`, `clientType` are present. Optional: `sessionMemberStateJson`.
2. **Session lookup:** Loads the session from storage. Throws `SessionNotFoundError` if missing.
3. **New vs reconnection:** Checks if a `SessionMember` with the same `userId` already exists in the session.
   - **New connection:** Creates a new `SessionMember` with `connectionState: Connected`, `isReady: false`.
   - **Reconnection:** Updates the existing member's `connectionId` and sets `connectionState: Connected`. Player state (ready status, custom data) is preserved.
4. **Room join:** Registers the socket and joins the session's Socket.IO room.

### Connection States

```typescript
enum ConnectionState {
    Connected = "Connected",
    Disconnected = "Disconnected",
}
```

A `SessionMember` with `connectionState: Disconnected` is a player who was in the session but whose WebSocket dropped. They are **not** removed from the session — their membership persists until explicitly kicked or the session ends.

### Client-Side: useConnectionStatus

```typescript
const connectionStatus = useConnectionStatus()
// Returns: "connected" | "disconnected" | "reconnecting"

function ConnectionBanner() {
    const status = useConnectionStatus()

    if (status === "reconnecting") {
        return <div className="banner warning">Reconnecting...</div>
    }
    if (status === "disconnected") {
        return <div className="banner error">Connection lost</div>
    }
    return null
}
```

### Server-Side: onDisconnect Timing

When a client disconnects, `onDisconnect` fires but **the session continues**. Common patterns:

```typescript
export function createOnDisconnect(services: GameServices) {
    return async (ctx: LifecycleContext) => {
        const { clientType, userId } = ctx.connection.metadata

        if (clientType === "CONTROLLER") {
            // Option A: Pause the game, wait for reconnection
            ctx.dispatch("SET_PAUSED", { paused: true, reason: "Player disconnected" })

            // Option B: Start a timeout — if they don't reconnect, end the game
            await ctx.scheduler.upsertTimeout({
                name: `disconnect-timeout-${userId}`,
                duration: 30000,
                thunkName: "HANDLE_PLAYER_ABANDON",
                args: { userId },
            })
        }
    }
}

export function createOnConnect(services: GameServices) {
    return async (ctx: LifecycleContext) => {
        const { clientType, userId } = ctx.connection.metadata

        if (clientType === "CONTROLLER") {
            // Cancel the abandon timeout on reconnection
            await ctx.scheduler.cancel(`disconnect-timeout-${userId}`)

            // Resume if we paused
            const state = ctx.getState()
            if (state.paused) {
                ctx.dispatch("SET_PAUSED", { paused: false, reason: null })
            }
        }
    }
}
```

### Error Types

| Error | Cause |
|-------|-------|
| `WebSocketHandshakeError` | Missing or invalid `sessionId`, `userId`, or `clientType` in query params |
| `SessionNotFoundError` | Session doesn't exist in storage (expired, deleted, or wrong ID) |
| `SocketNotFoundInRegistryError` | Internal: socket not tracked after connection (bug or race condition) |

### Resilience Checklist

- [ ] Display shows connection status banner using `useConnectionStatus()`
- [ ] Controller handles reconnection gracefully (doesn't reset local UI on reconnect)
- [ ] Server `onDisconnect` starts a timeout rather than immediately ending the game
- [ ] Server `onConnect` cancels disconnect timeouts for reconnecting players
- [ ] Session members are checked by `connectionState` before dispatching player-specific actions

---

## 25. Observability

Production games need structured logging, metrics, and tracing. WGF integrates with `@volley/logger` and provides hooks for both server and client instrumentation.

### Server-Side Logging

Use `@volley/logger` — never raw `pino` or `console.log` in production:

```typescript
import { createLogger, createLoggerHttpMiddleware } from "@volley/logger"

const logger = createLogger({
    name: "your-game-server",
    level: process.env.LOG_LEVEL ?? "info",
})

// HTTP request logging with UUID correlation
const app = express()
app.use(createLoggerHttpMiddleware(logger))
```

Every log line includes a request UUID for tracing across service boundaries.

### Thunk Context Logging

Thunks receive a scoped logger via `ctx.logger`:

```typescript
export function createProcessTranscriptionThunk(services: GameServices) {
    return async (ctx: IThunkContext<YourGameState>) => {
        ctx.logger.info({ text: args.text }, "Processing transcription")

        try {
            const result = services.waterfall.match(args.text, targets, 0.7)
            ctx.logger.info({ result }, "Waterfall match result")
        } catch (err) {
            ctx.logger.error({ err }, "Transcription processing failed")
            services.datadog.captureError(err, {
                sessionId: ctx.getSessionId(),
                clientId: ctx.getClientId(),
            })
        }
    }
}
```

### Client-Side Event Logging

Use the `useEvents` hook to emit structured log events from the client:

```typescript
const events = useEvents()

// Log a game event
events.emit("game:answer_submitted", {
    phase: "playing",
    questionIndex: 3,
    answerText: "elephant",
    responseTimeMs: 2340,
})
```

### Datadog Transport Middleware

For Socket.IO instrumentation (connection counts, message latency):

```typescript
import { createDatadogTransportMiddleware } from "@volley/vgf/server"

const io = new SocketIOServer(httpServer, { /* ... */ })

// Track connection/disconnection events and message throughput
io.use(createDatadogTransportMiddleware({
    serviceName: "your-game-server",
    statsdClient: ddStatsd,
}))
```

### Event History (Debugging)

WGF supports optional event history recording for debugging state issues:

```typescript
import { FileEventHistory, MetricEventHistory } from "@volley/vgf/server"

// Write all state events to a file (dev only — generates large files)
const eventHistory = new FileEventHistory("./events.log")

// Or track event metrics without storing payloads (production-safe)
const eventHistory = new MetricEventHistory(ddStatsd)

const server = new WGFServer({
    // ... other options
    eventHistory,
})
```

### Key Metrics to Track

| Metric | What It Tells You |
|--------|------------------|
| Active WebSocket connections | Current load, detect connection leaks |
| Active sessions | Game utilisation |
| Thunk execution latency | Performance bottlenecks (especially API-calling thunks) |
| Reducer dispatch rate | State update frequency (too high = potential spam) |
| Redis operation latency | Storage backend health |
| Reconnection rate | Network stability for TV devices |
| Player join → first action time | Onboarding friction |

### Structured Log Fields

Follow these conventions for searchable logs:

```typescript
// Always include sessionId and clientId in game-context logs
ctx.logger.info({
    sessionId: ctx.getSessionId(),
    clientId: ctx.getClientId(),
    phase: ctx.getState().phase,
    action: "PROCESS_TRANSCRIPTION",
    text: args.text,
    matchResult: result.foundMatch,
}, "Transcription processed")
```

---

## 26. Playwright E2E Testing

End-to-end tests verify that the display, server, and controller apps work together. Playwright drives a real browser and connects to the running dev servers.

### Package Setup

Add to `apps/e2e/package.json` (or the monorepo root):

```json
{
  "name": "@your-game/e2e",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "test": "playwright test",
    "test:ui": "playwright test --ui"
  },
  "devDependencies": {
    "@playwright/test": "^1.50.0"
  }
}
```

Install browsers after adding the dependency:

```bash
pnpm exec playwright install --with-deps chromium
```

### Playwright Configuration

```typescript
// apps/e2e/playwright.config.ts
import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
    testDir: "./tests",
    timeout: 30_000,
    expect: { timeout: 10_000 },
    fullyParallel: false,           // VGF sessions are shared state — run serially
    retries: 1,
    use: {
        baseURL: "http://127.0.0.1:3000",
        trace: "on-first-retry",
    },
    projects: [
        {
            name: "chromium",
            use: {
                ...devices["Desktop Chrome"],
                // For Three.js / WebGL games, add EGL support for headless:
                launchOptions: {
                    args: ["--use-gl=egl"],
                },
            },
        },
    ],
    webServer: [
        {
            command: "pnpm --filter @your-game/server dev",
            url: "http://127.0.0.1:8080/health",
            reuseExistingServer: !process.env.CI,
            timeout: 15_000,
        },
        {
            command: "pnpm --filter @your-game/display dev",
            url: "http://127.0.0.1:3000",
            reuseExistingServer: !process.env.CI,
            timeout: 15_000,
        },
        {
            command: "pnpm --filter @your-game/controller dev",
            url: "http://127.0.0.1:5173",
            reuseExistingServer: !process.env.CI,
            timeout: 15_000,
        },
    ],
})
```

### Example Test

```typescript
// apps/e2e/tests/game-flow.spec.ts
import { test, expect } from "@playwright/test"

test("display connects and shows lobby", async ({ page }) => {
    await page.goto("/?sessionId=dev-test&userId=display-dev&inputMode=remote")

    // Wait for VGF state sync (initial state is {} until sync completes)
    await expect(page.locator("[data-testid='lobby-scene']")).toBeVisible({
        timeout: 10_000,
    })
})

test("remote mode: play button starts game", async ({ page }) => {
    await page.goto("/?sessionId=dev-test&userId=display-dev&inputMode=remote")

    // Wait for lobby
    await expect(page.locator("[data-testid='lobby-scene']")).toBeVisible({
        timeout: 10_000,
    })

    // Click play (triggers ACTIVATE_REMOTE_MODE thunk)
    await page.locator("[data-testid='play-button']").click()

    // Verify game scene appears (phase transitioned via nextPhase pattern)
    await expect(page.locator("[data-testid='game-scene']")).toBeVisible({
        timeout: 10_000,
    })
})
```

> **Note:** For Three.js/WebGL games, add `--use-gl=egl` to Chromium launch args (shown in the config above). Without this, headless Chrome cannot create a WebGL context and your canvas will render nothing.

