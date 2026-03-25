# Controller Must Handle All Game Phases

**Severity:** High
**Sources:** emoji-multiplatform/030
**Category:** Controller, React, UI

## Principle

When a display/main screen adds a new game phase, the controller/companion screen MUST also handle that phase with appropriate UI. A phase without controller UI means the user sees the wrong screen on their device. Use exhaustive phase checks or test coverage for all phases.

## Details

In a multi-screen architecture (TV display + phone controller), the display and controller render different UI for each game phase. When a new phase is added to the display, the controller must also be updated — otherwise it falls through to a default case and renders inappropriate UI.

```tsx
// Controller component — WRONG: missing phases fall through to default
function ControllerScreen({ phase }: { phase: GamePhase }) {
  switch (phase) {
    case "gameOver":
      return <GameOverController />;
    case "playing":
      return <PlayingController />;
    default:
      return <PlayingController />; // lobby, categorySelect, difficultySelect all show mic/hint/skip!
  }
}

// CORRECT — handle every phase explicitly
function ControllerScreen({ phase }: { phase: GamePhase }) {
  switch (phase) {
    case "lobby":
      return <LobbyController />;
    case "categorySelect":
      return <CategorySelectController />;
    case "difficultySelect":
      return <DifficultySelectController />;
    case "playing":
      return <PlayingController />;
    case "gameOver":
      return <GameOverController />;
    default:
      return assertNever(phase); // compile-time exhaustiveness check
  }
}
```

### Exhaustive phase check with TypeScript

```ts
function assertNever(x: never): never {
  throw new Error(`Unhandled phase: ${x}`);
}
```

Using `assertNever` as the default case ensures a compile-time error when a new phase is added to the `GamePhase` union type but not handled in the switch.

## Prevention

1. **Exhaustive switch with `assertNever`:** Use TypeScript's `never` type to enforce compile-time exhaustiveness for phase switches in both display and controller.
2. **Checklist for new phases:** Every PR that adds a game phase must include UI for ALL screens (display, controller, spectator if applicable).
3. **Test each phase on each screen:** Write a test for every `(phase, screen)` combination asserting the correct component renders.
4. **Shared phase type:** Use a single `GamePhase` union type imported by both display and controller — do not maintain separate phase lists.

<details>
<summary>EM-030 — Controller Missing Phase UI</summary>

The controller component only had explicit cases for `gameOver` and `playing`. All other phases — `lobby`, `categorySelect`, and `difficultySelect` — fell through to the default case, which rendered the playing UI (microphone button, hint button, skip button). When the game was in the lobby phase, the player's phone showed recording controls instead of a "waiting for host" screen. During category and difficulty selection, the phone showed game controls instead of the selection interface the player was meant to interact with. The fix was adding explicit cases for all phases and using `assertNever` in the default to prevent future regressions.

</details>
