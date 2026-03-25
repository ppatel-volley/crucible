# VGF Phase Callback Contexts

**Severity:** Critical
**Sources:** weekend-poker/009, emoji-multiplatform/016
**Category:** VGF, Server, Phases

## Principle

VGF provides different context objects to phase lifecycle callbacks versus thunks. Using the wrong API on the wrong context causes runtime crashes. `onBegin` and `onEnd` callbacks MUST return `GameState` (or `Promise<GameState>`) — returning `undefined` crashes VGF internally inside `didPhaseEnd`.

## Details

### Context type reference

| Callback | Context type | State access | Dispatch method | Has `thunkDispatcher` | Has `scheduler` |
|----------|-------------|-------------|----------------|----------------------|-----------------|
| `onBegin` | `IOnBeginContext` | `getState()` | `reducerDispatcher` | Yes | Yes |
| `onEnd` | `IOnEndContext` | `getState()` | `reducerDispatcher` | Yes | Yes |
| `endIf` | `IGameActionContext` | `ctx.session.state` | N/A (read-only) | No | No |
| `next` | `IGameActionContext` | `ctx.session.state` | N/A (read-only) | No | No |
| Thunks | `IThunkContext` | `getState()` | `ctx.dispatch` | `dispatchThunk` | Yes |

### Key differences

```ts
// onBegin — uses reducerDispatcher, MUST return GameState
const onBegin = async (ctx: IOnBeginContext): Promise<GameState> => {
  const state = ctx.getState();
  // Use reducerDispatcher to modify state
  const newState = ctx.reducerDispatcher("initRound", { round: 1 });
  return newState;  // MUST return GameState
};

// endIf — uses ctx.session.state, read-only check
const endIf = (ctx: IGameActionContext): boolean => {
  const state = ctx.session.state;  // NOT getState()
  return state.roundComplete === true;
};

// Thunk — uses ctx.dispatch, does NOT return state
const myThunk = (ctx: IThunkContext) => {
  const state = ctx.getState();
  ctx.dispatch("updateScore", { score: 10 });
  ctx.dispatchThunk(anotherThunk);
};
```

### reducerDispatcher behaviour (WP-009)

- `reducerDispatcher` is an arrow function — safe to extract via object destructuring or getters.
- Root reducers (defined at the game level, not phase level) are available in ALL phases.
- Phase cascade is recursive and atomic — if `endIf` triggers during `onBegin`, the cascade completes before control returns.
- Server-side `reducerDispatcher` throws immediately when given an unrecognised reducer name. Client-side dispatch silently times out instead.

```ts
// Server — throws immediately
ctx.reducerDispatcher("typoName", {});
// Error: Reducer "typoName" not found

// Client — silent timeout
dispatch("typoName", {});
// ... 30 seconds later: DispatchTimeoutError
```

### onBegin return value (EM-016)

Returning `undefined` from `onBegin` crashes VGF deep inside its phase evaluation logic (`didPhaseEnd`). The original project's Phase interface incorrectly typed `onBegin` as returning `void`. VGF's actual type correctly declares `GameState | Promise<GameState>`.

```ts
// BAD — returns undefined, crashes VGF
const onBegin = (ctx) => {
  ctx.reducerDispatcher("setup", {});
  // no return statement — undefined
};

// GOOD — returns the updated state
const onBegin = (ctx) => {
  return ctx.reducerDispatcher("setup", {});
};
```

## Prevention

1. **Type enforcement:** Use VGF's own type definitions for phase callbacks, not custom interfaces. If the project has a local `Phase` type, verify it matches VGF's declarations.
2. **Lint rule:** Flag any `onBegin` or `onEnd` function that lacks a `return` statement.
3. **Context cheat sheet:** Keep the callback-context table above visible during development. Print it out if necessary.
4. **Integration test:** For each phase, assert that `onBegin` returns a valid state object and that `endIf` accesses state via `ctx.session.state`.

<details>
<summary>WP-009 Context</summary>

In Weekend Poker, confusion between `reducerDispatcher` and `ctx.dispatch` caused crashes in phase lifecycle hooks. Investigation revealed that `reducerDispatcher` is an arrow function (safe to destructure), root reducers are globally available across phases, and the server throws immediately on unrecognised names — unlike the client which silently times out. The phase cascade being recursive and atomic was discovered when an `endIf` triggered mid-`onBegin`, causing unexpected but correct behaviour.

</details>

<details>
<summary>EM-016 Context</summary>

In the emoji-multiplatform project, `onBegin` returned `undefined` because the local `Phase` interface typed it as `void`. VGF crashed inside `didPhaseEnd` with an opaque error. The fix was returning the result of `reducerDispatcher` from `onBegin`. The local Phase interface was corrected to match VGF's actual type: `GameState | Promise<GameState>`.

</details>
