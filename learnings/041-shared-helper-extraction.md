# Shared Helper Extraction

**Severity:** Medium
**Sources:** emoji-multiplatform/028
**Category:** Architecture, DRY

## Principle

When a sequence of operations is duplicated in three or more places, extract it into a shared helper. But when one code path intentionally bypasses the helper (e.g., for framework workarounds), document WHY it bypasses and audit every side effect the helper provides — timer scheduling, server state mutations, and async operations are easy to miss when a path opts out of the shared flow.

## Details

### When to extract

The threshold is three or more call sites performing the same sequence. Two is tolerable; three means the pattern is established and divergence between copies is inevitable.

### The bypass trap

Extraction creates a single source of truth, but not every caller can use it. Some paths have constraints (framework quirks, race conditions, dev-mode workarounds) that require a different flow. The danger is that the bypass path misses side effects that the helper provides:

```ts
// Shared helper — provides question loading, dispatch, AND timer scheduling
function setupPlayingPhase(dispatch: DispatchFn, difficulty: Difficulty): void {
  const question = loadQuestion(difficulty);
  dispatch("SET_QUESTION", question);
  dispatch("START_TIMER", { duration: question.timeLimit });
  scheduleTimeout(question.timeLimit); // ← easy to miss
}

// Normal paths use the helper
onBegin: (ctx) => setupPlayingPhase(ctx.dispatch, ctx.state.difficulty),
RESTART_SAME: (ctx) => setupPlayingPhase(ctx.dispatch, ctx.state.difficulty),
SELECT_DIFFICULTY: (ctx, d) => setupPlayingPhase(ctx.dispatch, d),

// Dev path bypasses the helper — documents WHY
// NOTE: Uses DEV_SETUP_PLAYING to bypass VGF's endIf cascade.
// This means timer scheduling from setupPlayingPhase() is NOT called here.
// The dev scheduler handles timing separately.
devSetup: (ctx) => {
  ctx.dispatch("DEV_SETUP_PLAYING", { question: loadQuestion("easy") });
  // BUG: forgot to schedule timeout — game hangs on first question
},
```

### Design decisions for the helper

The helper must accept a generic dispatch function compatible with all callers:

```ts
// Works with both reducerDispatcher (from onBegin) and ctx.dispatch (from moves)
type DispatchFn = (type: string, payload?: unknown) => void;

function setupPlayingPhase(dispatch: DispatchFn, difficulty: Difficulty): void {
  // ...
}
```

## Prevention

1. When extracting a helper, list every side effect it performs (state mutations, timer scheduling, async calls, logging).
2. For every code path that bypasses the helper, document why and explicitly account for each side effect — either replicate it or explain why it is not needed.
3. Add a comment block at the top of the helper listing its side effects, so bypass paths have a checklist to audit against.
4. Consider making the helper's side effects individually toggleable via an options parameter rather than forcing an all-or-nothing choice.

<details>
<summary>Emoji Multiplatform — EM-028 setupPlayingPhase Extraction</summary>

The question-loading and dispatch sequence was duplicated across three code paths: `playing.onBegin`, `RESTART_SAME`, and `SELECT_DIFFICULTY`. All three loaded a question, dispatched it, and scheduled a timer. The helper `setupPlayingPhase()` was extracted to accept a generic dispatch function compatible with both `reducerDispatcher` and `ctx.dispatch`.

The dev-mode path was intentionally left out of the helper because it uses `DEV_SETUP_PLAYING` to bypass VGF's `endIf` cascade — a framework-specific workaround. However, the timer scheduling that the helper provides was missed in the dev path, causing the game to hang on the first question in dev mode. This was later captured as learning 035. The lesson: when a path opts out of a shared helper, every side effect the helper provides must be explicitly accounted for.

</details>
