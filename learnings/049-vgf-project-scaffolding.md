# VGF Project Scaffolding — Complete 0-to-1 Guide Corrections

**Severity:** Critical
**Sources:** TokenRaider/043
**Category:** Project Setup, VGF Framework
**Related:** 014, 015, 016, 019

## Principle

When scaffolding a VGF monorepo from documentation, expect significant gaps between the guide and the actual installed version. Always run `npm view @volley/vgf version` before writing `package.json`, read the actual `.d.ts` files after install, and reference an existing working project (e.g., emoji-multiplatform) rather than trusting the guide alone. 34 issues were discovered scaffolding against VGF 4.9.0 using a guide written for ~4.3.

## Issues by Category

### Package & Dependency Issues

1. **Version constraints are stale** — always `npm view` before pinning.
2. **`socket.io` must be a direct server dependency** — not transitive.
3. **`dotenv` must be a direct server dependency** — guide omits it.
4. **No bare specifier export** — use subpath: `/client`, `/server`, `/types`.

### TypeScript Type Issues

5. **Game state interfaces MUST include `[key: string]: unknown`** — VGF's `BaseGameState` extends `Record<string, unknown>`.
6. **`IOnBeginContext` NOT exported from `/server`** — import from `/types`.
7. **`IGameActionContext` NOT exported at all** — use inline type `{ session: ISession<State> }`.
8. **`WGFServer` requires `schedulerStore: IRuntimeSchedulerStore`** — not optional. Use noop for dev.
9. **Thunks must return `Promise<void>`** — use `async`.
10. **Thunk args default to `never[]`** — `dispatchThunk("NAME", {})` fails without type cast.
11. **`console` is NOT `ILogger`** — use `createLogger({ type: "node" })` from `@volley/logger`.
12. **React 19 + TS 5.7** — omit `JSX.Element` return types, let inference handle it.
13. **`socketOptions` NOT in `.d.ts`** but IS spread at runtime — needs type cast.

### VGF 4.9.0 Phase Transition Breaking Changes

14. **`PhaseModificationError`** — NO reducer can modify `state.phase`. Use `nextPhase` pattern.
15. **Must use `nextPhase` pattern** — `SET_NEXT_PHASE` reducer + `endIf` checking `hasNextPhase(state)`.
16. **Every phase's `onBegin` must clear `nextPhase`** — see Learning 019 for the stale nextPhase OOM bug.
17. **`onBegin` must use `reducerDispatcher`** — cast ctx to `PhaseLifecycleContext`.
18. **PhaseRunner2 evaluates `endIf` BEFORE `onBegin` runs** — guard endIf against uninitialised state. See Learning 016.
19. **Initial state `phase` must match a registered phase name** — `"idle"` won't work if only `"lobby"` is registered.
20. **Lobby `endIf` should check `hasNextPhase()` ONLY** — don't check persistent state like `remoteMode`.

### WGFServer Lifecycle Limitations

21. **`WGFServer` does NOT call `onConnect`/`onDisconnect`** — all setup must be client-initiated via thunks.
22. **WGFServer does NOT send Socket.IO acknowledgements** — `dispatchThunk()` always throws `DispatchTimeoutError` after 10s. The thunk DOES execute — catch the error.

### Client Connection Issues

23. **Use `127.0.0.1` not `localhost`** — VPN can intercept localhost.
24. **Do NOT use React StrictMode with VGF** — double mount/unmount kills Socket.IO transport.
25. **Let `VGFProvider` manage connect/close lifecycle** — don't call `transport.connect()` manually.
26. **`autoConnect` goes in `clientOptions`** — not top-level prop.
27. **`useDeviceInfo()` returns methods** — use `.getDeviceId()`, not destructuring.
28. **Socket options go in `socketOptions` object** — not top-level on transport config.

### Dev Server Issues

29. **Dev sessions deleted on client disconnect** — use `setInterval(ensureDevSession, 2000)`.
30. **Port conflicts on restart** — `strictPort: true` means hard failure. Kill processes first.
31. **`tsx watch` kills server on file edits** — sessions and connections drop.
32. **Vite HMR runs `useMemo` twice** — don't fight it, VGFProvider handles it.

### Scaffolding Gaps

33. **WGF CLI doesn't create controller app** — must create `apps/controller` manually.
34. **Playwright E2E needs `--use-gl=egl`** — headless Chrome WebGL support.

## Import Map (VGF 4.9.0)

| Type | Import from |
|------|-------------|
| `WGFServer`, `MemoryStorage`, `IThunkContext` | `@volley/vgf/server` |
| `IOnBeginContext`, `ISession`, `GameThunk` | `@volley/vgf/types` |
| `VGFProvider`, `SocketIOClientTransport`, `ClientType`, `getVGFHooks` | `@volley/vgf/client` |
| `IGameActionContext` | **Not exported** — use `{ session: ISession<State> }` |

## Red Flags

- `PhaseModificationError` → NEVER modify `state.phase` in a reducer
- `DispatchTimeoutError` → Expected with WGFServer. Thunk still executes. Catch the error.
- `Index signature for type 'string' is missing` → add `[key: string]: unknown`
- `ERR_PACKAGE_PATH_NOT_EXPORTED` → use subpath exports
- `Type 'Console' is missing properties from ILogger` → use `@volley/logger`
- Server OOM after phase transition → check `endIf` runs before `onBegin`, add guards
- Lobby skips instantly → check `endIf` isn't checking persistent state
- `PlatformInitializationError` → PlatformProvider needs `volley_hub_session_id` URL param (TV shell only). Use `MaybePlatformProvider` with fallback device ID in dev.

## Prevention

1. **Always `npm view` before pinning versions.**
2. **Always read the actual `.d.ts` files after install** — don't trust the guide.
3. **Build shared first** before typechecking apps.
4. **Reference an existing working project** for every pattern — it's the source of truth, not the guide.
5. **Kill all processes on 3000/5173/8080/8081 before `pnpm dev`.**
