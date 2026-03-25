# Verify UI Details From Code Before Communicating

**Severity:** Medium
**Sources:** finalfrontier/012
**Category:** Communication, Accuracy

## Principle

Never assume UI details like keybindings, labels, or configuration values — always verify from the source code before communicating them to users. A confidently stated wrong keybinding is worse than admitting uncertainty, because the user trusts the statement and wastes time pressing the wrong key. If you cannot quickly verify, say "I believe it's X, but please verify" rather than stating it as fact.

## Details

### The assumption trap

When asked about a keybinding, label, or UI element, it is tempting to answer from memory or pattern-match against common conventions. This fails because:

- Projects rebind keys from their defaults.
- Labels change during development and may not match what documentation says.
- Configuration values are often overridden in environment-specific files.

### How to verify

```bash
# Find keybindings — search for event listeners
grep -r "keydown\|keyup\|keypress\|key ===" src/ --include="*.ts" --include="*.tsx"

# Find specific key references
grep -r "'[A-Z]'\|\"[A-Z]\"" src/input/ --include="*.ts"

# Find UI labels
grep -r "label\|tooltip\|placeholder" src/components/ --include="*.tsx"
```

```ts
// The source of truth is always the code, not documentation or memory
// Example: finding the galaxy map keybinding
window.addEventListener("keydown", (e) => {
  if (e.key === "M") toggleGalaxyMap(); // NOT "G" — verify, don't guess
});
```

### Rules

1. **Code is the source of truth** — not documentation, not memory, not convention.
2. **Search before answering** — a 10-second grep is faster than a round trip of confusion.
3. **Qualify uncertainty** — "I believe it's X, but please verify" is always acceptable.

## Prevention

1. Before communicating any keybinding or UI detail, search the codebase for the relevant event handler or component.
2. If the codebase is not immediately searchable, explicitly caveat your answer with uncertainty.
3. When writing documentation, link to the source code location so the binding can be verified when the documentation is read.
4. Consider adding a runtime help overlay (e.g., press `?` to show all keybindings) so users can self-serve.

<details>
<summary>Final Frontier — FF-012 Galaxy Map Keybinding</summary>

A user asked how to open the galaxy map. The agent confidently stated "press G" — a reasonable guess, since "G" for "Galaxy" follows common convention. The actual keybinding was "M" (for "Map"). The user pressed G repeatedly, nothing happened, and a follow-up round of debugging ensued before the mistake was identified. A simple `grep` for `key ===` in the input handler would have revealed the correct binding in seconds.

</details>
