# Wallet Floor of Zero: Monetary Balance Safety

**Severity:** Critical
**Sources:** weekend-poker/004
**Category:** Game Logic, State Management

## Principle

Every reducer or thunk that modifies monetary balances must enforce `Math.max(0, ...)`. Every chip or currency division must use `Math.floor()`. Every deduction must validate sufficient balance before proceeding. The reducer is the last line of defence — if it allows a negative or fractional balance through, no higher layer will catch it.

## Details

Monetary values in game state are particularly dangerous because they compound: a negative balance feeds into subsequent calculations, bets, pot splits, and UI displays, producing increasingly nonsensical results. Three distinct patterns must all be guarded.

### Pattern 1: Wallet update with delta

```ts
// BAD — delta can push balance negative
const updateWallet = (state, { playerId, delta }) => ({
  ...state,
  wallets: {
    ...state.wallets,
    [playerId]: state.wallets[playerId] + delta,
  },
});

// GOOD — floor at zero
const updateWallet = (state, { playerId, delta }) => ({
  ...state,
  wallets: {
    ...state.wallets,
    [playerId]: Math.max(0, state.wallets[playerId] + delta),
  },
});
```

### Pattern 2: Direct set

```ts
// GOOD — even direct sets must be guarded
const setBalance = (state, { playerId, amount }) => ({
  ...state,
  wallets: {
    ...state.wallets,
    [playerId]: Math.max(0, amount),
  },
});
```

### Pattern 3: Deduction with validation

```ts
// GOOD — check before deducting, clamp after
const placeBet = (state, { playerId, betAmount }) => {
  const current = state.wallets[playerId];
  const actualBet = Math.min(betAmount, current);  // can't bet more than you have
  return {
    ...state,
    wallets: {
      ...state.wallets,
      [playerId]: Math.max(0, current - actualBet),
    },
    pot: state.pot + actualBet,
  };
};
```

### Pattern 4: Division (pot splits, surrenders)

```ts
// BAD — odd numbers produce fractional chips
const halfBet = bet / 2;

// GOOD — always floor division results
const halfBet = Math.floor(bet / 2);
```

## Prevention

1. **Utility function:** Create a single `safeBalance(value)` helper that applies `Math.max(0, Math.floor(value))` and use it everywhere.
2. **Lint rule or grep check:** Search for wallet/balance mutations that lack `Math.max` or `Math.floor`.
3. **Test pattern:** For every reducer that touches balances, include a test case with an input designed to produce a negative or fractional result, and assert it is clamped.
4. **Assertion in dev mode:** `if (balance < 0) throw new Error(...)` as a development-only guard.

<details>
<summary>WP-004 Context</summary>

In Weekend Poker, three separate bugs were found:

- **`casinoUpdateWallet`** applied a delta without flooring, allowing negative balances when a player lost more than they had.
- **`holdemReducers.updatePlayerBet`** could drive a player's chip count negative when the bet exceeded their stack.
- **`bjSettleBets`** (blackjack settle) produced fractional chips when surrendering an odd-valued bet — `Math.floor()` was missing from the half-bet calculation.

All three were fixed by applying the patterns above at the reducer level.

</details>
