# Dual Disconnect Session Cleanup Race Condition

**Severity:** High
**Sources:** emoji-multiplatform/040
**Category:** VGF, Server, Concurrency, Session Management

## Principle

When multiple clients (controller + display) disconnect within seconds, their independent timeout handlers create a race condition. Cleanup must be guarded by a per-session flag on the session state — not a module-level collection. Module-level mutable state (`Set`, `Map`) persists across vitest test cases and will break tests.

## Details

When both controller and display disconnect, two timeout handlers fire independently. The first calls `endSession()` which deletes `serverState`. The second handler's `if (!sessionState)` fallback also called `endSession()`, causing double-cleanup (duplicate database writes, duplicate analytics events).

An initial fix used a module-level `Set<string>` to track ended sessions. This broke 14 tests because the Set persisted across test cases in the same vitest process.

### The correct pattern

```ts
// 1. Add a per-session flag (NOT module-level)
interface ServerOnlyState {
  sessionEnded: boolean;
  // ...
}

// 2. First handler sets the flag, then cleans up
if (sessionState && !sessionState.sessionEnded) {
  sessionState.sessionEnded = true;
  await finalizeDisconnectedSession(sessionId);
}

// 3. Second handler checks the flag — early exit
if (!sessionState || sessionState.sessionEnded) {
  return; // Already cleaned up or session deleted
}
```

## Red Flags

- Two timeout handlers that can fire for the same session (controller + display disconnect)
- Module-level `Set`/`Map` used for cross-invocation state — will leak across tests
- `if (!x) { doCleanup() }` patterns where missing state should mean "already cleaned up", not "needs cleanup"
- Symmetric timeout handlers with duplicated cleanup logic — extract a shared helper

## Prevention

1. Guard shared cleanup with a per-session flag, not a module-level collection.
2. When extracting shared state, always ask: "Does this persist across test cases?"
3. Test the dual-disconnect scenario explicitly: fire both timeout handlers and verify cleanup happens exactly once.
