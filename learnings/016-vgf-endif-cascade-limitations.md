# VGF endIf Cascade Limitations

**Severity:** Critical
**Sources:** emoji-multiplatform/015, emoji-multiplatform/020, emoji-multiplatform/024, weekend-poker/021
**Category:** VGF, Phases, Server

## Principle

VGF's `endIf` is only reliably evaluated after client-originated dispatches. It is NOT evaluated after `onConnect`, scheduler-triggered thunks, or `onDisconnect`. When `endIf` does cascade, the `onBegin` context may have a different shape than expected. For critical transitions, always use explicit phase transitions instead of relying on `endIf`.

## Details

Three separate scenarios where `endIf` failed to trigger, each requiring a different workaround but all pointing to the same root cause: `endIf` evaluation is tightly coupled to the client dispatch pipeline.

### Scenario 1: endIf not evaluated after onConnect (EM-015)

When a player connects and a dispatch happens inside `onConnect`, `endIf` is not re-evaluated. The phase transition condition was met but never checked.

```ts
// BAD — endIf won't fire after onConnect dispatch
onConnect: (ctx) => {
  ctx.reducerDispatcher("addPlayer", { playerId: ctx.userId });
  // endIf checks playerCount >= 2... but never runs
},

// GOOD — force the transition explicitly
onConnect: (ctx) => {
  const state = ctx.reducerDispatcher("addPlayer", { playerId: ctx.userId });
  if (state.players.length >= 2) {
    ctx.reducerDispatcher("SET_PHASE", { phase: "playing" });
  }
},
```

### Scenario 2: endIf cascade passes wrong context to onBegin (EM-020)

When `endIf` does cascade (e.g. after a client dispatch that ends multiple phases in sequence), the `onBegin` of the next phase receives a context with an unexpected shape.

```ts
// In the cascaded onBegin, this crashed:
const onBegin = (ctx) => {
  const sessionId = ctx.getSessionId();  // TypeError: getSessionId is not a function
};
```

The cascaded context is an `IGameActionContext`, not the full `IOnBeginContext`. Methods like `getSessionId()` do not exist on it.

**Fix:** Use a thunk with explicit `SET_PHASE` instead of relying on the cascade:

```ts
// Instead of endIf cascade, use explicit transition
const checkAndTransition = (ctx: IThunkContext) => {
  const state = ctx.getState();
  if (state.roundComplete) {
    ctx.dispatch("SET_PHASE", { phase: "nextRound" });
  }
};
```

### Scenario 3: endIf not evaluated after scheduler-triggered thunks (EM-024)

A scheduler fires a thunk that sets `state.status = "QUIZ_OVER"`. The `endIf` for the current phase checks for `status === "QUIZ_OVER"` but never runs. The game gets stuck on "Time's Up!" indefinitely.

```ts
// The scheduler thunk correctly updates state...
const onTimeout = (ctx: IThunkContext) => {
  ctx.dispatch("setQuizOver", {});
  // endIf should fire here... but it doesn't
};

// Fix: dispatch the phase transition explicitly
const onTimeout = (ctx: IThunkContext) => {
  ctx.dispatch("setQuizOver", {});
  ctx.dispatch("SET_PHASE", { phase: "gameOver" });
};
```

### Scenario 4: PhaseRunner2 checks endIf BEFORE onBegin on re-entry (WP-021)

When a phase loop completes (e.g., `BJ_HAND_COMPLETE` → back to `BJ_PLACE_BETS`), `PhaseRunner2.performSingleTransitionCheck()` checks `endIf` **before** running `onBegin`. If per-round completion flags (`allBetsPlaced`, `dealComplete`, etc.) are still `true` from the previous round, `endIf` immediately triggers the next transition without `onBegin` ever resetting them. This creates an infinite cascade through all phases until OOM (3.9GB).

```ts
// PhaseRunner2 loop:
// 1. Check endIf — if true, set phase to next, loop again
// 2. Check if phase changed — if so, run onEnd/onBegin, loop again
// On loop-back, step 1 fires BEFORE step 2 ever runs onBegin
```

**The fix:** Add a `resetPhaseFlags` reducer that clears ALL per-phase completion flags. Call it in the loop-back phase's `onBegin` before setting any new flags:

```ts
// In the round-complete phase's onBegin:
ctx.reducerDispatcher('resetPhaseFlags')      // Clear stale flags first
ctx.reducerDispatcher('setRoundReady', true)   // Then mark round complete
```

The reset reducer must clear EVERY flag that any `endIf` checks:

```ts
resetPhaseFlags: (state) => ({
  ...state,
  allBetsPlaced: false,
  dealComplete: false,
  insuranceComplete: false,
  playerTurnsComplete: false,
  dealerTurnComplete: false,
  settlementComplete: false,
  roundCompleteReady: false,
})
```

**Affected all 5 Weekend Casino games** — Blackjack Classic, Blackjack Competitive, Three Card Poker, Roulette, and Craps all needed reset reducers. 5-Card Draw was safe (used `playablePlayers.length < 2` guard instead of flag checks).

**Red flags:**
- Any phase whose `next` loops back to an earlier phase in the flow
- Any `endIf` that checks a flag set in `onBegin` — those flags persist across loops
- Missing flags in the reset reducer (add every new `endIf` flag to the reset)

### Summary table

| Trigger | endIf evaluated? | Workaround |
|---------|-----------------|------------|
| Client dispatch | Yes | None needed |
| `onConnect` dispatch | No | Explicit `SET_PHASE` |
| Scheduler thunk | No | Explicit `SET_PHASE` |
| `onDisconnect` dispatch | No | Explicit `SET_PHASE` |
| `onBegin` cascade | Partial (wrong context) | Thunk with `SET_PHASE` |
| Phase re-entry (loop-back) | Yes, BEFORE onBegin | `resetPhaseFlags` reducer in onBegin |

## Prevention

1. **Rule of thumb:** Never rely on `endIf` for critical transitions. Always pair it with an explicit `SET_PHASE` dispatch as a fallback.
2. **Defensive thunks:** Wrap phase-ending logic in thunks that check the condition and dispatch `SET_PHASE` directly.
3. **Integration test:** For each phase, test that the transition fires from both client dispatches and server-side triggers (scheduler, onConnect).
4. **Timeout safety net:** Add a scheduler-based timeout that checks if the phase should have ended and forces the transition.
5. **Reset flags on loop-back:** When any phase loops back to an earlier phase, add a `resetPhaseFlags` reducer that clears all per-round completion flags. Call it as the first action in `onBegin`.
6. **Flag audit:** When adding a new `endIf` flag to any game, add it to the reset reducer too.

<details>
<summary>EM-015 Context</summary>

Players joining the lobby triggered `onConnect` which dispatched `addPlayer`. The `endIf` condition (`playerCount >= minPlayers`) was met but never evaluated. The game remained stuck in the lobby phase. The fix was adding an explicit phase check and `SET_PHASE` dispatch inside `onConnect`.

</details>

<details>
<summary>EM-020 Context</summary>

A client dispatch caused a phase to end, which cascaded into the next phase's `onBegin`. Inside that `onBegin`, `ctx.getSessionId()` threw "getSessionId is not a function" because the cascaded context was an `IGameActionContext`, not the expected `IOnBeginContext`. The fix replaced the `endIf` cascade with an explicit thunk that dispatched `SET_PHASE`.

</details>

<details>
<summary>EM-024 Context</summary>

The quiz timer expired, triggering a scheduler thunk that set `state.status = "QUIZ_OVER"`. The `endIf` for the playing phase was supposed to detect this and transition to `gameOver`, but it never ran. The game displayed "Time's Up!" indefinitely. The fix added an explicit `SET_PHASE` dispatch to the timeout thunk.

</details>
