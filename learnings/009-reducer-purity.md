# Reducer Purity: No Non-Deterministic Calls

**Severity:** High
**Sources:** emoji-multiplatform/010, emoji-multiplatform/026
**Category:** State Management, VGF

## Principle

Reducers must be pure functions — no `Date.now()`, `Math.random()`, or any other non-deterministic calls. Compute timestamps and random values in thunks or callers and pass them into reducers via action payloads. This ensures testability, deterministic replay, and consistent timing across the application.

## Details

When reducers call `Date.now()` internally, the timestamp is computed at reduction time rather than dispatch time. This creates subtle timing bugs, especially when thunks also compute and dispatch timestamps for the same state fields — two different values end up racing for the same slot.

### Before / After

| Reducer | Before (impure) | After (pure) |
|---------|-----------------|--------------|
| `SUBMIT_ANSWER` | `timestamp: Date.now()` inside reducer | `timestamp` passed via action payload |
| `PAUSE_TIMER` | `pausedAt: Date.now()` inside reducer | `pausedAt` passed via action payload |
| `RESUME_TIMER` | `resumedAt: Date.now()` inside reducer | `resumedAt` passed via action payload |
| `DEV_SETUP_PLAYING` | `startTime: Date.now()` inside reducer | `startTime` passed via action payload |

### Impure reducer (wrong)

```ts
// BAD — non-deterministic call inside reducer
case 'PAUSE_TIMER':
  return {
    ...state,
    pausedAt: Date.now(),  // computed at reduction time
  };
```

### Pure reducer (correct)

```ts
// Thunk computes the timestamp
const pauseTimer = () => (dispatch) => {
  dispatch({ type: 'PAUSE_TIMER', payload: { pausedAt: Date.now() } });
};

// Reducer receives it deterministically
case 'PAUSE_TIMER':
  return {
    ...state,
    pausedAt: action.payload.pausedAt,
  };
```

## Prevention

1. **Lint rule:** Flag `Date.now()`, `Math.random()`, and `new Date()` inside reducer files.
2. **Code review checkpoint:** Every reducer must receive all variable data through its action payload.
3. **Test pattern:** Reducers should produce identical output given identical input — assert this explicitly.

<details>
<summary>EM-010 Context</summary>

Calling `Date.now()` inside VGF reducers caused timing conflicts when thunks also dispatched timestamps for the same fields. The reducer's `Date.now()` ran milliseconds after the thunk's `Date.now()`, producing mismatched values for what should have been a single logical moment. Timer display glitches resulted — counters would jump or show negative durations briefly before correcting.

</details>

<details>
<summary>EM-026 Context</summary>

Audit discovered four specific reducers (`SUBMIT_ANSWER`, `PAUSE_TIMER`, `RESUME_TIMER`, `DEV_SETUP_PLAYING`) all calling `Date.now()` internally. Each was refactored to accept the timestamp via payload instead. The thunk or caller became the single source of truth for "when did this happen," eliminating all timing discrepancies.

</details>
