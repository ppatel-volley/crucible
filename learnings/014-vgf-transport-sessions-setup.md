# VGF Transport, Sessions, and Client Setup

**Severity:** Critical
**Sources:** emoji-multiplatform/002, emoji-multiplatform/003, emoji-multiplatform/005, emoji-multiplatform/014, emoji-multiplatform/021
**Category:** VGF, Socket.IO, Client Setup

## Principle

VGF requires explicit session creation before client connection, defaults to WebSocket-only transport, initialises state as an empty object, and has fragile query parameter handling. Violating any of these causes silent failures — no errors are thrown, connections simply don't work or state arrives as `{}`.

## Details

Five separate issues that all stem from VGF's client setup assumptions. Each one causes a silent failure that is difficult to diagnose because VGF does not surface helpful error messages.

### 1. Transport override required

`createSocketIOClientTransport` hardcodes `transports: ["websocket"]`. This skips the HTTP long-polling upgrade path entirely. If your infrastructure requires polling fallback (e.g. behind certain proxies), you must override:

```ts
// BAD — uses hardcoded websocket-only transport
const transport = createSocketIOClientTransport({ url });

// GOOD — explicitly set transports
const transport = createSocketIOClientTransport({
  url,
  socketOptions: {
    transports: ["polling", "websocket"],
  },
});
```

### 2. State initialises as empty object

`SessionProvider` initialises state as `{}`. `useStateSync()` returns `{}` without throwing, so components that blindly destructure game state will get `undefined` for every field.

```ts
// BAD — destructures immediately, no guard
const { phase, players, round } = useStateSync();

// GOOD — check for meaningful state before using
const state = useStateSync();
if (!("phase" in state)) {
  return <Loading />;
}
const { phase, players, round } = state;
```

### 3. Sessions must be created explicitly

VGF does not auto-create sessions. The client must `POST /api/session` first:

```ts
// Create session before connecting
const res = await fetch("/api/session", { method: "POST" });
const { sessionId } = await res.json();

// Now connect with the session ID
const transport = createSocketIOClientTransport({
  url,
  sessionId,
});
```

### 4. Dev sessions must be pre-created on startup

In development, sessions must be created during server startup. Both Vite configs use `strictPort: true` to ensure deterministic port allocation — if the port is taken, the server fails rather than silently picking another port.

### 5. socketOptions.query replaces VGF internals

| Parameter method | Behaviour |
|-----------------|-----------|
| `socketOptions.query` | **REPLACES** VGF's internal query object |
| VGF internal query | Contains `sessionId`, `userId`, `clientType` |
| Combined effect | Your custom query wipes session identification |

```ts
// BAD — destroys VGF's internal query parameters
const transport = createSocketIOClientTransport({
  url,
  socketOptions: {
    query: { myCustomParam: "value" },  // replaces sessionId, userId, clientType
  },
});

// GOOD — pass extra data via thunks after connection
const transport = createSocketIOClientTransport({ url, sessionId });
// After connection:
dispatch("sendCustomData", { myCustomParam: "value" });
```

Never use `socketOptions.query` — pass extra data via thunks after the connection is established.

## Prevention

1. **Wrapper function:** Create a project-level `createTransport()` that enforces correct defaults and prevents `socketOptions.query` usage.
2. **State guard component:** Build a `<WaitForState>` wrapper that checks for `"phase" in state` before rendering children.
3. **Dev startup script:** Automate session pre-creation in the dev server bootstrap so it cannot be forgotten.
4. **Integration smoke test:** Assert that a freshly connected client receives state with a `phase` field within 2 seconds.

<details>
<summary>EM-002 Context</summary>

The WebSocket-only transport default was discovered when connections failed behind a corporate proxy that required HTTP long-polling for the initial handshake. No error was surfaced — the connection simply never established.

</details>

<details>
<summary>EM-003 Context</summary>

Components crashed with "Cannot read property 'phase' of undefined" because `useStateSync()` returned `{}` and code destructured `phase` directly. The fix was adding a guard check for `"phase" in state`.

</details>

<details>
<summary>EM-005 Context</summary>

Client connected but received no state updates. Root cause: no session existed on the server. VGF accepted the socket connection without error but had no session to associate it with. Adding `POST /api/session` before connection resolved it.

</details>

<details>
<summary>EM-014 Context</summary>

Dev mode required pre-created sessions at startup. Without them, the dev workflow required manually hitting the session creation endpoint before each test — easily forgotten and a source of repeated confusion.

</details>

<details>
<summary>EM-021 Context</summary>

Custom query parameters were added to `socketOptions.query` for analytics tracking. This silently replaced VGF's internal query containing `sessionId`, `userId`, and `clientType`. The server could not identify the session, so the client received no state. The fix was removing `socketOptions.query` entirely and passing analytics data via a thunk after connection.

</details>
