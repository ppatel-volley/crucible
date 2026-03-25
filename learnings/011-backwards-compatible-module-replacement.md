# Backwards-Compatible Module Replacement

**Severity:** High
**Sources:** weekend-poker/003
**Category:** Architecture, Refactoring, Testing

## Principle

When replacing a module with a new one aliased to the old name, the new module must be a strict superset of the old interface. Every field, reducer, thunk, and function signature must be preserved. Missing fields or changed signatures cause cascading test failures that are painful to diagnose because the error messages point at consumers, not at the replacement module itself.

## Details

A module replacement that drops fields or changes signatures is not a replacement — it is a breaking change wearing a disguise. The alias tricks the import system into treating them as identical, but every consumer that relied on the old shape will fail.

### Common failure modes

1. **Missing initial state fields** — consumers or tests that read those fields get `undefined`.
2. **Changed reducer signatures** — callers pass the old argument shape; reducer receives something it does not expect.
3. **Stub reducers** — reducers that return state unchanged, but tests assert they mutate state.
4. **Shape mismatches** — nested objects (e.g. statistics, configuration) with different property names or structures.

### The fix pattern

```ts
// 1. Superset state — spread old defaults, then add new ones
const initialState = {
  ...oldModuleDefaults,        // preserve every old field
  interHandDelaySec: 3,        // old field — keep it
  autoFillBots: false,         // old field — keep it
  newCasinoField: 'whatever',  // new field — add on top
};

// 2. Preserve signatures — match exactly what callers pass
// OLD: addBotPlayer(state, { seatIndex, difficulty })
// NEW: must accept { seatIndex, difficulty }, not { botId, botName }
const addBotPlayer = (state, { seatIndex, difficulty }) => {
  // map old params to new internals if needed
  const botId = generateBotId(seatIndex);
  const botName = difficultyToName(difficulty);
  // ... actual logic
};

// 3. Implement, don't stub — if a reducer exists, it must do the work
const dealCards = (state, payload) => {
  // BAD:  return state;
  // GOOD: actually deal the cards
  return { ...state, hands: dealToPlayers(state.deck, state.players) };
};
```

## Prevention

1. **Interface extraction:** Before replacing, extract a TypeScript interface from the old module. The new module must satisfy it.
2. **Adapter layer:** If signatures genuinely need to change, write a thin adapter that translates old calls to new ones.
3. **Run existing tests first:** Before touching any consumer code, the replacement module must pass all existing tests unmodified.
4. **Diff the exports:** Compare `Object.keys(oldModule)` with `Object.keys(newModule)` as a smoke test.

<details>
<summary>WP-003 Context</summary>

In Weekend Poker, `casinoRuleset` replaced `pokerRuleset` via an alias. The replacement was missing several initial state fields (`interHandDelaySec`, `autoFillBots`, and others), changed the `addBotPlayer` reducer signature from `(seatIndex, difficulty)` to `(botId, botName)`, contained stub reducers that returned unchanged state where tests verified mutations, and had a `SessionStats` shape mismatch. The result was a cascade of test failures across multiple test files, each pointing at a different consumer rather than at the faulty replacement module.

</details>
