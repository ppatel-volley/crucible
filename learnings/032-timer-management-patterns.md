# Timer Management Patterns

**Severity:** High
**Sources:** emoji-multiplatform/025, emoji-multiplatform/032, emoji-multiplatform/035, emoji-multiplatform/036
**Category:** Game Logic, Timers, State Management

## Principle

"Timer expired, do nothing" almost always means "timer expired, game stuck." Every timer start (`timerStartedAt` write) must have a corresponding timer schedule. Every `if (remaining > 0) { schedule timer }` must have an `else` that fires the timeout handler. Only pause the display timer when the round is truly suspended, not during transient states.

## Details

Four separate bugs, all caused by incomplete timer lifecycle handling.

### 1. Pausing timer on transient state (EM-025)

Dispatching `PAUSE_TIMER` when the microphone was released froze the timer bar. `HANDLE_FAIL_DISPLAY` never cleared `timerPausedAt`, so the timer remained paused permanently.

```ts
// WRONG — pausing on a transient event
case "STOP_RECORDING":
  return { ...state, timerPausedAt: Date.now() }; // freezes timer bar

// CORRECT — only pause when the round is truly suspended
// STOP_RECORDING should not touch the timer at all
case "STOP_RECORDING":
  return { ...state, isRecording: false };
```

**Rule:** Only pause the timer when the round is genuinely suspended (e.g. a modal dialogue, a network disconnection). Transient events like releasing the mic button must not affect the timer.

### 2. Reconnect with expired timer (EM-032)

A client reconnects after being disconnected. The timer has expired during the disconnect (`remaining <= 0`). The reconnection code checks remaining time and skips scheduling — but does not fire `HANDLE_TIMEOUT`. The game is stuck.

```ts
// WRONG — skips scheduling but doesn't handle expiry
if (remaining > 0) {
  scheduleTimer(remaining);
}
// else: nothing happens, game stuck

// CORRECT — fire timeout when timer already expired
if (remaining > 0) {
  scheduleTimer(remaining);
} else {
  ctx.dispatchThunk("HANDLE_TIMEOUT");
}
```

### 3. Dev mode missing timer schedule (EM-035)

A dev mode shortcut dispatched `DEV_SETUP_PLAYING` which set `timerStartedAt` in state but never scheduled `ROUND_TIMER`. The game hung on the first question because no timeout would ever fire.

**Rule:** Every write to `timerStartedAt` must have a corresponding timer schedule call. Search for all places that set `timerStartedAt` and verify each one schedules the timer.

### 4. Retry from FAIL state with expired timer (EM-036)

`START_RECORDING` from the FAIL state checked `remaining > 0` and scheduled a timer if true. But when `remaining <= 0`, it fell through without scheduling OR firing the timeout handler. Same pattern as EM-032.

```ts
// WRONG — falls through silently
case "START_RECORDING":
  if (state.displayPhase === "fail") {
    const remaining = computeRemaining(state);
    if (remaining > 0) {
      scheduleTimer(remaining);
    }
    // else: silent fall-through, game stuck
  }

// CORRECT — explicit else branch
case "START_RECORDING":
  if (state.displayPhase === "fail") {
    const remaining = computeRemaining(state);
    if (remaining > 0) {
      scheduleTimer(remaining);
    } else {
      ctx.dispatchThunk("HANDLE_TIMEOUT");
      return state; // don't start recording, time's up
    }
  }
```

## Prevention

1. **Audit rule:** Every `timerStartedAt` assignment must have a corresponding `scheduleTimer` call within the same code path.
2. **Mandatory else branch:** Every `if (remaining > 0) { scheduleTimer }` block must have an `else` that fires the timeout handler. Lint for this pattern.
3. **Timer pause whitelist:** Define an explicit list of states that are allowed to pause the timer. Any `PAUSE_TIMER` dispatch outside this whitelist should be flagged in code review.
4. **Reconnection test:** Write a test that simulates reconnection after timer expiry and asserts the timeout handler fires.

<details>
<summary>EM-025 — STOP_RECORDING Timer Freeze</summary>

When the player released the microphone button, `STOP_RECORDING` dispatched `PAUSE_TIMER`, which wrote `timerPausedAt` to state. The timer bar froze visually. When the answer was evaluated and `HANDLE_FAIL_DISPLAY` fired, it transitioned to the fail screen but never cleared `timerPausedAt`. The timer bar remained frozen at whatever value it had when the mic was released, and no timeout ever fired. The fix was removing the `PAUSE_TIMER` dispatch from `STOP_RECORDING` entirely — the timer should continue running while the answer is being evaluated.

</details>

<details>
<summary>EM-032 — Reconnect Expired Timer</summary>

During network instability testing, a client disconnected for 45 seconds (timer was 30 seconds). On reconnect, the client received state with `timerStartedAt` from 45 seconds ago. The reconnect handler computed `remaining = -15` seconds, skipped the `scheduleTimer` call, and did nothing else. The game was stuck on the question screen with no way to advance. The fix added an `else` branch that called `ctx.dispatchThunk("HANDLE_TIMEOUT")` when remaining was zero or negative.

</details>

<details>
<summary>EM-035 — Dev Mode Missing Timer</summary>

The `DEV_SETUP_PLAYING` reducer was a shortcut that jumped the game directly to the playing phase, bypassing the normal lobby → category → difficulty flow. It correctly set `timerStartedAt` in state but never called `scheduleTimer`. In normal flow, the timer was scheduled by the phase's `onEnter` callback, which `DEV_SETUP_PLAYING` skipped. The game displayed the question with a timer bar that counted down visually (driven by `timerStartedAt`) but no server-side timeout ever fired.

</details>

<details>
<summary>EM-036 — FAIL State Retry Timer</summary>

After showing a wrong answer, the player could press the mic button to retry. `START_RECORDING` from the FAIL display phase checked remaining time. If the timer had expired during the fail display animation (which lasted 3 seconds), `remaining` was negative. The code skipped scheduling but also skipped firing the timeout. The game showed the recording UI with an expired timer and no way to advance. The fix added an `else` branch identical to the EM-032 fix.

</details>
