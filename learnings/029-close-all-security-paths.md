# Security Fixes Must Close ALL Paths

**Severity:** Critical
**Sources:** weekend-poker/008
**Category:** Security, Code Review

## Principle

A security fix that leaves the insecure path open is not a fix. It is adding a locked front door whilst leaving the back door open. For every security fix, map ALL paths to the vulnerability, close every one, and write negative tests proving the old paths are blocked.

The "additive-only" antipattern: building a correct new secure path but not demolishing or gating the old insecure one. This is the most common way security fixes fail — the new code is perfectly sound, but the old code still works and attackers (or bugs) will find it.

## Details

Three examples from WP-008 illustrate the pattern:

### 1. Host-only game selection

A secure thunk was created that validated the caller was the host before allowing game selection. However, the old unprotected reducer remained in the phase config, and the controller still dispatched it directly.

```ts
// NEW — secure thunk (correct)
const selectGameThunk = createThunk("selectGame", (ctx, payload) => {
  if (ctx.callerId !== ctx.state.hostId) return; // guard
  ctx.dispatch("SET_GAME", payload);
});

// OLD — unprotected reducer still in phase config (WRONG — must be removed)
phases: {
  lobby: {
    reducers: {
      SET_GAME: setGameReducer, // ← any client can dispatch this directly
    },
  },
}
```

### 2. Hole card privacy

A per-player thunk was added that filtered cards to only send each player their own hole cards. But the dealing phase still broadcast all cards via public state — every client received every player's hand.

### 3. Voice pipeline bypass

Voice commands dispatched raw reducer actions without validation, completely bypassing the validated thunk pipeline. The secure path existed but voice input never used it.

### Process for closing all paths

1. **Before fixing** — grep for EVERY dispatch, call site, reducer reference, and phase config entry related to the vulnerability.
2. **Add** the secure replacement (thunk, guard, filter).
3. **REMOVE or GATE** every old path. If backwards compatibility is genuinely needed, gate it behind the same validation the new path uses.
4. **Write NEGATIVE tests** — prove the old paths are blocked.
5. **Search for escape hatches** — voice commands, dev tools, admin endpoints, WebSocket raw messages.

### Red flags in code review

- New thunks exist but old dispatches are still present in controllers or UI components.
- Tests only exercise the new path — no negative tests for the old path.
- Phase configs still list internal-only reducers as client-accessible.
- "Backwards compatibility" used to justify keeping the insecure path open without equivalent guards.

## Prevention

1. **Grep audit before every security PR:** Search for every reference to the vulnerable action/reducer/endpoint across the entire codebase. Document each path found.
2. **Mandatory negative tests:** Every security fix PR must include tests that attempt the old insecure path and assert it fails.
3. **Phase config review:** Treat the phase config's reducer list as a public API surface. Anything listed there is callable by any client.
4. **Voice/alternative input audit:** When securing a dispatch, check whether voice commands, keyboard shortcuts, or dev tools can bypass the new guard.

<details>
<summary>Weekend Poker — WP-008 Full Context</summary>

WP-008 was a security audit that revealed three separate vulnerabilities, all sharing the same root cause: new secure code was added but old insecure code was left in place. The host-only game selection thunk was the most egregious — the thunk was perfectly written, but any client could still dispatch `SET_GAME` directly because the reducer remained in the phase config's public reducer list. The fix required removing `SET_GAME` from the phase config reducers, updating all controller dispatch calls to use the thunk, and adding tests that attempted direct reducer dispatch and asserted rejection.

The hole card privacy fix had the same shape: the per-player thunk correctly filtered cards, but the dealing phase's `onEnter` callback still wrote all cards to public state before the thunk ran. The voice pipeline bypass was discovered last — voice transcription results were dispatched as raw reducer actions, skipping the thunk layer entirely.

**Key takeaway:** The three fixes were written by three different agents across three sessions. None of them audited the full attack surface. A single "close all paths" checklist would have caught all three on the first pass.

</details>
