# Retention System Integration and Time-Bounded Challenges

**Severity:** Critical
**Sources:** weekend-poker/010, weekend-poker/011
**Category:** Persistence, Game Economy, API Design

## Principle

Side-channel persistence systems (profiles, achievements, challenges) need a complete pipeline: a write path (game events → stat updates), detection (stats → achievements), and reward application (claims → economy effects). Missing any one of these stages makes the entire system inert — data is stored but never written, or written but never detected, or detected but never rewarded. Never use lifetime or cumulative stats to initialise time-bounded challenges — weekly challenges must only count activity within the challenge period, starting from zero.

## Details

### The three-stage pipeline

```
Game Events → [Write Path] → Stats → [Detection] → Achievements → [Reward Application] → Economy
```

Every stage must be verified independently. Mock-heavy tests that stub intermediate stages create false confidence — the test passes but the real pipeline is broken because stage boundaries were never exercised.

### Key findings across 4 rounds (WP-010)

**1. API contract mismatch** — the server returned `ChallengeSummary` but the client expected `ActiveChallenge`. Mock-heavy tests papered over the gap. Fix: define API contracts first, use shared types or contract tests.

```ts
// Server returns:
interface ChallengeSummary { id: string; title: string; progress: number; }

// Client expects:
interface ActiveChallenge { challengeId: string; name: string; current: number; target: number; }

// These are NOT the same shape — contract tests catch this, mocks do not.
```

**2. Write pipeline missing** — storage and detection existed, but no game event actually wrote to the stats. The system was inert.

**3. Calendar maths** — never approximate week boundaries with `dayOfYear / 7`. Use explicit day-of-week calculations:

```ts
// WRONG — off by one depending on year start day
const week = Math.floor(dayOfYear / 7);

// CORRECT — explicit Monday-anchored week calculation
const weekStart = startOfWeek(date, { weekStartsOn: 1 });
```

**4. Auth in dev** — REST endpoints need authentication even in development, or integration tests silently skip auth bugs.

**5. Atomic reward claims** — claims must atomically apply ALL effects (wallet credit, XP gain, stat increments, progression unlocks). Partial application creates inconsistent state.

**6. Multi-game over-counting** — use absolute value comparison, not additive increments, when tracking challenge progress across multiple game sessions:

```ts
// WRONG — additive, double-counts if event fires twice
tracker.progress += event.handsPlayed;

// CORRECT — absolute snapshot comparison
tracker.progress = Math.max(tracker.progress, currentStats.totalHands - tracker.baseline);
```

**7. Per-game stats never populated** — grep for all WRITE paths before shipping. If nothing writes to a stat, it will always be zero.

**8. String cross-references** — challenge IDs, achievement keys, and reward codes are stringly-typed cross-references. They need referential integrity tests.

**9. No setTimeout for critical state** — never use `setTimeout` for critical state mutations. Dispatch synchronously.

**10. Module-level Maps need session scoping** — include `sessionId` in keys and wire cleanup to the disconnect handler.

```ts
// WRONG — leaks across sessions
const trackers = new Map<string, Tracker>();

// CORRECT — session-scoped keys with cleanup
const trackers = new Map<string, Tracker>(); // key = `${sessionId}:${odId}`
socket.on("disconnect", () => clearSessionTrackers(sessionId));
```

**11. Rollback state** — must be an exact snapshot, not a synthetic reset. Capture before mutation, restore the capture on failure.

**12. Single source of truth for browser APIs** — one hook with all error handling (permissions, fallbacks, feature detection). Do not scatter `navigator.xyz` calls across components.

**13. UI labels must match backend semantics** — a challenge labelled "Daily" that rotated weekly caused user confusion and bug reports.

**14. Transient disconnect vs true leave** — only clear a player's tracker on true session removal, not on transient network disconnects.

### Weekly challenge backfill bug (WP-011)

A returning player with 500 lifetime hands instantly completed the "Play 5 hands" weekly challenge because the system backfilled from cumulative `totalHandsPlayed`.

```ts
// WRONG — backfill from lifetime stats
challenge.progress = playerStats.totalHandsPlayed; // 500 → instantly complete

// CORRECT — weekly challenges start at zero, count only new activity
challenge.progress = 0;
challenge.baseline = playerStats.totalHandsPlayed; // track baseline for delta
```

### Summary rules

- **Pipeline Completeness:** write path + detection + reward application — verify each stage independently.
- **Contract-First Development:** shared types or contract tests between client and server.
- **Session-Scoped State:** module-level tracking must include `sessionId` in keys and clean up on disconnect.
- **Atomic State Transitions:** snapshot before mutation, apply synchronously, restore exact snapshot on failure.

## Prevention

1. For any new persistence feature, map the full pipeline (write → detect → reward) before writing code. Verify each stage has at least one integration test that does not mock the adjacent stage.
2. Use shared type definitions or contract tests between client and server — never rely on mocks alone to validate API shapes.
3. For time-bounded challenges, assert in tests that a player with high lifetime stats starts a new challenge period at zero progress.
4. Grep for all write paths to a stat before declaring the read path complete.
5. Include `sessionId` in any module-level Map key and register cleanup on the disconnect event.

<details>
<summary>Weekend Poker — WP-010 Retention System (4 Rounds, 13 Findings)</summary>

WP-010 spanned four development rounds. The first round built the challenge storage and detection layer but neglected the write pipeline — no game event actually updated the stats the detection layer was reading. The second round fixed the write path but introduced an API contract mismatch: the server returned `ChallengeSummary` objects whilst the client expected `ActiveChallenge`. Mock-heavy tests on both sides passed independently but the system failed end-to-end. The third round addressed calendar maths (week boundary calculations were off due to `dayOfYear / 7` approximation) and authentication gaps in dev endpoints. The fourth round tackled reward application atomicity, session-scoped state leaking across reconnections, and UI label mismatches.

The overarching lesson: retention systems touch every layer of the stack (game logic, API, persistence, UI). Each layer can appear correct in isolation whilst the full pipeline is broken. Integration tests that exercise the complete path — game event to UI update — are non-negotiable.

</details>

<details>
<summary>Weekend Poker — WP-011 Weekly Challenge Backfill</summary>

A player who had accumulated 500 total hands over several months returned after a break. Upon logging in, the new weekly challenge "Play 5 hands this week" was immediately shown as complete. The root cause was the backfill logic: when initialising a weekly challenge, the system set `progress = playerStats.totalHandsPlayed` instead of starting from zero and using a baseline delta. The fix removed all backfill logic for time-bounded challenges. Challenges now start at zero progress, with a baseline snapshot of the relevant stat captured at challenge creation time. Progress is computed as `currentStat - baseline`, ensuring only activity within the challenge period counts.

</details>
