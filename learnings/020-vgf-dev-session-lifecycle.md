# VGF Dev Session Lifecycle

**Severity:** High
**Sources:** emoji-multiplatform/022
**Category:** VGF, Dev Mode

## Principle

In dev mode, closing a browser tab triggers disconnect timeouts (15–30s) that can delete the session from memory. Opening a new tab after the timeout fails silently because the session no longer exists. Always restart the server between test rounds to ensure a clean session state.

## Details

### Root cause

VGF's dev mode uses `MemoryStorage` for session persistence. When a client disconnects, VGF starts a configurable timeout (typically 15–30 seconds). If no client reconnects within that window, `endSession` is called, which deletes the session from `MemoryStorage` entirely.

```
Tab closed → disconnect event → timeout starts (15-30s)
  → timeout expires → endSession() → session deleted from MemoryStorage
    → new tab opened → client connects with old sessionId
      → session not found → silent failure
```

### Symptoms

The failure mode is deceptively subtle:

1. A brief flash of the lobby screen (from the initial empty state broadcast)
2. Then unexpected state — either a blank screen, a frozen UI, or the previous game's state if the session ID was reused before deletion completed
3. No error messages in the browser console
4. No error messages in the server logs
5. The socket connection appears healthy

### Why it's confusing

- The session ID may still be in the URL or local storage from the previous session
- The server accepts the connection without error (it creates a new socket, just doesn't find the session)
- `useStateSync()` returns `{}` which looks like "loading" rather than "broken"

### The fix

```bash
# Between test rounds:
# 1. Close ALL browser tabs connected to the dev server
# 2. Stop the dev server (Ctrl+C)
# 3. Restart the dev server
npm run dev
# 4. Open fresh tabs
```

There is no way to "recover" a deleted session in dev mode. The session data is gone from memory. Restarting the server triggers the dev startup sequence which pre-creates fresh sessions.

## Prevention

1. **Restart between rounds:** Make it a habit to restart the dev server between test sessions. Close all tabs first to avoid stale connections racing with the new server.
2. **Shorter timeout for dev:** Configure a very short disconnect timeout (e.g. 2 seconds) in dev mode so sessions are cleaned up quickly and the failure is obvious rather than delayed.
3. **Session health indicator:** Add a dev-only UI component that shows whether the current session is valid on the server. A simple polling endpoint or socket acknowledgement suffices.
4. **Startup log:** Log the session IDs created during dev startup so you can verify the client is connecting to an active session.

<details>
<summary>EM-022 Context</summary>

During development of the emoji quiz game, the pattern of closing a tab, waiting a minute, then opening a new tab caused persistent confusion. The game would flash the lobby briefly then show a broken state. Multiple developers hit this independently, each spending significant time debugging what appeared to be a state synchronisation bug. The actual cause — session deletion after disconnect timeout — was only discovered by adding logging to `MemoryStorage.delete()`. The team adopted a "restart between rounds" convention and added a console warning when a client connects to a non-existent session.

</details>
