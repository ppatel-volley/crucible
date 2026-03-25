# Voice Intents Need Both Parsing AND Routing

**Severity:** Critical
**Sources:** weekend-poker/012
**Category:** Voice Pipeline, Client-Server

## Principle

Voice commands require TWO things: a parser that recognises intent patterns, and a router that dispatches them to game actions. Adding intent patterns without routing creates a silent failure — intents parse correctly but are never acted upon. Always verify both sides when adding new intents.

## Details

The voice pipeline has two stages that live in different files:

1. **Parser** (`parseVoiceIntent.ts`) — takes a transcript string and returns a structured intent object (e.g. `{ type: "PLACE_BET", amount: 50 }`).
2. **Router** (`processVoiceCommand` thunk) — takes the parsed intent and dispatches the corresponding game action, applying phase guards and validation.

Adding a new intent to the parser without adding a routing block means the intent is recognised and logged, but nothing happens. There is no error, no warning — the command is silently swallowed.

```ts
// parseVoiceIntent.ts — parser correctly recognises "pass line"
if (transcript.match(/pass\s*line/i)) {
  return { type: "CRAPS_PASS_LINE", confidence: 0.9 };
}

// processVoiceCommand.ts — router has NO block for CRAPS_PASS_LINE
// Intent is parsed, logged... and dropped on the floor
switch (intent.type) {
  case "FOLD": return ctx.dispatch("FOLD_HAND");
  case "RAISE": return ctx.dispatch("RAISE_BET", intent);
  // CRAPS_PASS_LINE is missing — silent failure
}
```

The fix requires adding the routing block with appropriate phase guards:

```ts
case "CRAPS_PASS_LINE":
  if (ctx.state.phase !== "betting") return; // phase guard
  return ctx.dispatch("PLACE_PASS_LINE_BET", { playerId: ctx.callerId });
```

### End-to-end verification

Every new voice intent must have an end-to-end test that starts from a transcript string and asserts that the correct game action is dispatched:

```ts
it("routes 'pass line' voice command to PLACE_PASS_LINE_BET", () => {
  const intent = parseVoiceIntent("put it on the pass line");
  expect(intent.type).toBe("CRAPS_PASS_LINE");

  // Verify routing exists and dispatches correctly
  processVoiceCommand(mockCtx, intent);
  expect(mockCtx.dispatch).toHaveBeenCalledWith(
    "PLACE_PASS_LINE_BET",
    expect.objectContaining({ playerId: "host" })
  );
});
```

## Prevention

1. **Pair every parser addition with a router addition.** Treat them as a single atomic change — never merge one without the other.
2. **End-to-end test required:** Every new intent must have a test that goes from transcript string to dispatched action.
3. **Router exhaustiveness check:** Add a `default` case to the router that logs unhandled intents at warning level. In test mode, throw an error for unhandled intents so missing routes are caught immediately.
4. **Grep both files:** When adding an intent, search for ALL locations that switch on intent type. There may be multiple routers (e.g. different game modes).

<details>
<summary>Weekend Poker — WP-012 Context</summary>

Eight craps voice intents were added to `parseVoiceIntent.ts` (pass line, don't pass, come, don't come, place bet, field bet, hard way, hop bet). All eight were correctly recognised by the parser with appropriate confidence scores. However, `processVoiceCommand` had no routing block for any craps intent — it only handled poker commands. Players could say "pass line" and see the intent logged in debug output, but no bet was placed. The bug was not caught because tests only covered the parser in isolation, never the full pipeline. The fix added routing blocks for all eight intents with phase guards ensuring bets could only be placed during the betting phase.

</details>
