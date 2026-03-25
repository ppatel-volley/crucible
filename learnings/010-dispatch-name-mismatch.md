# Dispatch Name Mismatch: Silent Failures in Action Registries

**Severity:** Critical
**Sources:** weekend-poker/006
**Category:** State Management, Client-Server

## Principle

When a client dispatches actions by string name and the server looks them up in a registry, mismatched names cause silent failures. The dispatch times out with no helpful error — no "reducer not found" message appears. Always verify that dispatch names match server registration exactly, and consider adding server-side warnings for unrecognised action names.

## Details

String-based dispatch systems are inherently fragile. A typo or naming convention mismatch between client and server means the action vanishes into the void. The only symptom is a timeout, which is easily misdiagnosed as a network or performance issue.

### The bug

```ts
// Client — LobbyController
dispatch('selectGame', { gameId: 'holdem' });

// Server — ruleset reducers registry
const reducers = {
  setSelectedGame: (state, payload) => { ... },  // note: different name
};
```

The client dispatches `'selectGame'`, but the server only knows about `'setSelectedGame'`. Button clicks appeared to do nothing. The sole clue was a `DispatchTimeoutError` in the browser console — no server-side log indicated the mismatch.

### The fix

```ts
// Add aliases in the ruleset reducers object
const reducers = {
  setSelectedGame: (state, payload) => { ... },
  selectGame: 'setSelectedGame',  // alias pointing to canonical name
};
```

## Prevention

1. **Server-side warning:** Log or throw when an incoming action name has no matching reducer. A single `console.warn('Unknown action:', name)` would have saved hours.
2. **Shared constants:** Define action names in a shared module imported by both client and server.
3. **Type safety:** Use TypeScript's `keyof typeof reducers` to constrain dispatch calls at compile time.
4. **Integration test:** Dispatch every client action and assert the server handles it without timeout.

<details>
<summary>WP-006 Context</summary>

In Weekend Poker, `LobbyController` dispatched `'selectGame'` but the server registered the reducer as `'setSelectedGame'`. Button clicks in the lobby appeared completely inert. The only diagnostic was a `DispatchTimeoutError` surfacing in the browser console after the default timeout elapsed. There was no server-side log, no "reducer not found" message, nothing. The fix added aliases in the ruleset reducers object so that both names resolve to the same handler.

</details>
