# PR Review Feedback Must Trigger Codebase-Wide Scan

**Severity:** High
**Sources:** emoji-multiplatform/031, emoji-multiplatform/033, emoji-multiplatform/041
**Category:** Process, Code Review, Quality

## Principle

When a reviewer (human or bot) flags a pattern-based issue, fixing only the flagged instance is insufficient. Pattern-based issues are never isolated — they are symptoms of a systemic habit or a gap in the codebase's conventions. Every review fix must immediately launch a codebase-wide scan for the same pattern. Additionally, external review bots often catch mechanical issues that internal audits miss entirely, because they apply rules without fatigue or context bias.

## Details

### Patterns caught by bots that internal audits missed (EM-031)

1. **"Needs architectural decision" cop-out** — a comment flagged as requiring an architectural decision was actually a trivial nullable guard. The label gave it false gravitas and delayed a one-line fix.

2. **Incomplete cleanup after feature removal** — dead fields, methods, and callers were left behind after a feature was removed. The deletion was partial; the cleanup never happened.

3. **Non-null assertions on optional fields** — `!` used on optional fields instead of `??` fallback:

```ts
// WRONG — non-null assertion on optional field
const value = config.timeout!;

// CORRECT — nullish coalescing with a sensible default
const value = config.timeout ?? DEFAULT_TIMEOUT;
```

4. **Asymmetric cleanup between symmetric handlers** — CONTROLLER and DISPLAY timeout handlers were supposed to be mirrors, but only one was cleaned up after a refactor. The other retained stale logic.

### Process rule (EM-033)

For every pattern flagged in a review:

1. **Fix the instance** — address the specific line the reviewer flagged.
2. **Scan the entire codebase** for the same pattern — `grep -r`, IDE search, or a linting rule.
3. **Fix all instances** found by the scan.
4. **Add a test or lint rule** to catch reintroduction.

### Operational rules

- Run external review bots **before** internal review — they catch the mechanical debt humans gloss over.
- After any deletion, grep for orphaned references (field names, method names, import paths).
- Ban `!` on optional fields — enforce `??` or explicit `undefined` checks via linting.
- When two functions are symmetric (e.g., `onControllerTimeout` / `onDisplayTimeout`), diff them against each other after any change to either.

### Bot findings on dead code — verify runtime reachability first (EM-041)

Across 5 review cycles on a single PR, Cursor Bugbot repeatedly flagged issues in `CHECK_HIGH_SCORE` — a thunk registered in the ruleset but never dispatched in production code. Each finding was technically correct in static analysis but meaningless at runtime:

- "Game Instance End completed event never fires" (High) — correct finding, wrong location
- "Duplicate amplitude game_end tracking" (Medium) — both copies were in dead code
- "Amplitude game_end lost isNewHighScore field" (Medium) — field was never sent in production

**The fix for dead code is deletion, not patching.** Before acting on any bot finding:

1. Verify the flagged function is actually called in production: `grep -r 'dispatchThunk.*THUNK_NAME'`
2. If the code is dead, delete it or comment explaining why it exists (e.g., registered for future use)
3. Don't add tracking to dead code paths to satisfy bot findings — that's worse than doing nothing
4. If the same dead function is flagged across multiple review cycles, that's a strong signal to delete it

**Red flags for false positives:**
- Bot findings referencing thunks/functions with no callers
- Multiple bot findings on the same dead function across review cycles
- "Duplicate tracking" where one copy is in unreachable code

## Prevention

1. Treat every review comment as a codebase-wide query, not a point fix.
2. Add a PR checklist item: "Grepped for pattern X across the codebase — N additional instances found and fixed."
3. Configure external bots (e.g., CodeRabbit, Danger) to run before human reviewers see the PR.
4. Add ESLint rules for mechanical patterns: no non-null assertions on optional types, no orphaned exports after feature removal.
5. Before acting on any bot finding, trace the execution path from entry point to the flagged code — verify runtime reachability.

<details>
<summary>Emoji Multiplatform — EM-031 Bot Catches</summary>

During EM-031, an external review bot flagged four distinct pattern-based issues that had survived multiple rounds of internal review. The most instructive was the "needs architectural decision" flag — the reviewer had labelled a missing nullable guard as an architectural concern, which discouraged anyone from touching it. In reality, the fix was a single `?? fallback` line. The asymmetric handler bug was caught because the bot diffed the CONTROLLER and DISPLAY timeout functions and flagged a structural mismatch — something no human reviewer had thought to check.

</details>

<details>
<summary>Emoji Multiplatform — EM-033 Process Rule Origin</summary>

EM-033 was filed after the same `!` assertion pattern appeared in three separate PRs over two weeks. Each time, the reviewer caught one instance, the author fixed that instance, and the PR was merged — leaving identical issues elsewhere. The process rule (fix → scan → fix all → add guard) was introduced to break this cycle. After adoption, the next review that flagged a pattern resulted in 11 additional fixes across the codebase in the same PR.

</details>
