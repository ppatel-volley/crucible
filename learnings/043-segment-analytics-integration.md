# Segment Analytics Integration Patterns

**Severity:** High
**Sources:** emoji-multiplatform/039
**Category:** Analytics, Integration, Architecture

## Principle

Analytics integration has four common failure modes: destructive shutdown disguised as flush, duplicate initialisation in React StrictMode, tracking placed in dead code paths, and bypassed ordinal increments on alternative flows (FTUE, restart). Every tracking call must be verified for runtime reachability, and browser SDK init must be idempotent.

## Details

### 1. `closeAndFlush()` permanently destroys the Analytics client

`analytics.closeAndFlush()` shuts down the client permanently — all subsequent `track()` calls silently fail. The method name "flush" implies a non-destructive buffer flush, but it's actually destructive shutdown.

```ts
// WRONG — permanently kills the client
await analytics.closeAndFlush();
// All subsequent track() calls silently fail

// CORRECT — rename to make destruction obvious, nullify reference
async shutdown() {
  await this.client.closeAndFlush();
  this.client = null; // Explicit: no more tracking after this
}
```

### 2. Guard browser SDK initialisation for React StrictMode

React StrictMode and component remounts can call `initSegment()` multiple times. `analytics.load()` re-initialises the singleton, causing duplicate event delivery.

```ts
// WRONG — no guard
function initSegment() {
  analytics.load(writeKey); // Called twice in StrictMode
}

// CORRECT — idempotent init
let initialized = false;
function initSegment() {
  if (initialized) return;
  analytics.load(writeKey);
  initialized = true;
}
```

### 3. Trace the production code path before placing tracking

A `Game Instance End: completed` event was placed in `createCheckHighScoreThunk`, which was registered in the ruleset but **never dispatched** in production. The actual path went through `advanceToNextQuestion` detecting `QUIZ_OVER`.

**Before adding tracking to any thunk:** `grep -r 'dispatchThunk.*THUNK_NAME'` to verify it's actually invoked in production.

### 4. Audit all paths to a phase for bookkeeping

The FTUE path bypassed `SELECT_DIFFICULTY` where `gameInstanceOrdinal` was incremented. FTUE games had ordinal 0, breaking idempotency keys.

When a phase like `playing` has multiple entry points (normal flow, FTUE, restart), ensure each path performs necessary bookkeeping (ordinal increments, start events).

## Red Flags

- Method names that understate their side effects (`flush` vs `shutdown`, `close` vs `destroy`)
- Tracking code in thunks that have no `dispatchThunk()` callers
- Phase entry points that bypass intermediate phases (FTUE, restart, dev mode)
- Browser SDK `init`/`load` calls without idempotency guards
- `closeAndFlush` in any analytics library — always check if the client is reusable after

## Prevention

1. When adding analytics to a thunk, run `grep -r 'dispatchThunk.*THUNK_NAME'` to verify production reachability.
2. For deterministic `messageId` (idempotent events), ensure all discriminator fields (sessionId, ordinal, timestamp) are populated on every code path.
3. Test the full game lifecycle (FTUE, normal, restart, disconnect) to verify all event pairs (Start/End) fire correctly.
4. Wrap browser analytics init behind an `initialized` flag — React StrictMode will always double-mount.
