# Bots Must Auto-Resolve ALL Phase Prompts in onBegin

**Severity:** High
**Sources:** weekend-poker/022
**Category:** VGF, Bot Logic, Phase Lifecycle

## Principle

Every phase that requires player input must also handle bots in `onBegin`. Bots cannot dispatch thunks (they have no controller). Any `endIf` that checks `.every()` across all players will hang indefinitely if a bot has no auto-action.

## Details

The Blackjack game froze at `BJ_INSURANCE` when the dealer showed an Ace. The human player took/declined insurance, but the bot never resolved its insurance decision. The `endIf` check (`insuranceComplete === true`) requires ALL players to have `insuranceResolved === true`, so the phase hung indefinitely.

### The fix pattern

In `onBegin`, after setting up the phase for human players, auto-resolve all bots:

```ts
onBegin: (ctx) => {
  // Set up phase for humans
  ctx.reducerDispatcher('setDealerMessage', 'Insurance?')

  // Auto-resolve bots — they can't respond to prompts
  const state = ctx.getState()
  for (const ps of state.playerStates) {
    const player = state.players.find(p => p.id === ps.playerId)
    if (player?.isBot && !ps.insuranceResolved) {
      ctx.reducerDispatcher('declineInsurance', ps.playerId)
    }
  }

  // Check if all resolved after bot auto-actions
  const postBot = ctx.getState()
  if (postBot.playerStates.every(ps => ps.insuranceResolved)) {
    ctx.reducerDispatcher('setInsuranceComplete', true)
  }
}
```

### General checklist for input phases

When creating any phase that requires player input:
1. Identify what action bots should take (auto-bet, auto-decline, auto-fold, etc.)
2. Add bot auto-action in `onBegin` AFTER setting up the phase
3. Check if all players have resolved after bot auto-actions
4. If all resolved, set the phase completion flag immediately

## Red Flags

- Any phase `endIf` that checks `.every()` across all players — bots can't act on their own
- Any "waiting for input" phase that doesn't auto-resolve bots in `onBegin`
- Adding a new input phase without checking the bot path
- Game freezing at a prompt phase when bots are in the session

## Prevention

1. Audit every phase with an `endIf` that iterates over players — verify bots have an auto-action path.
2. When adding a new input phase, add bot auto-resolution as part of the phase definition, not as a follow-up task.
3. Include bot-only test cases in E2E tests to catch missing auto-actions.
