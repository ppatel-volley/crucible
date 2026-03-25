# Nullish Coalescing Precedence Trap

**Severity:** Medium
**Sources:** weekend-poker/014
**Category:** JavaScript, Operator Precedence

## Principle

JavaScript's nullish coalescing operator (`??`) has very low precedence — lower than `>=`, `===`, `+`, `-`, and most other operators. Without parentheses, the right-hand side of `??` swallows subsequent operators, producing silently wrong results. Always wrap `??` in parentheses when combining it with any other operator.

## Details

The `??` operator sits near the bottom of JavaScript's precedence table (priority 5), below comparison operators (priority 10–11) and arithmetic operators (priority 13–14). This means expressions that look intuitive are parsed in surprising ways.

### The bug

```ts
// What the developer intended:
(event.value ?? 0) >= def.targetValue

// What JavaScript actually parsed:
event.value ?? (0 >= def.targetValue)
```

When `event.value` is `null` or `undefined`, the developer expected the fallback `0` to be compared against `def.targetValue`. Instead, JavaScript evaluated `0 >= def.targetValue` first (producing a boolean), and that boolean became the fallback. When `event.value` was present, the comparison against `def.targetValue` never happened at all — the expression resolved to the raw `event.value` (a number), which is always truthy in a boolean context.

### Precedence reference

| Operator | Precedence | Example |
|----------|-----------|---------|
| `+`, `-` | 13, 13 | `a + b` |
| `>=`, `<=`, `>`, `<` | 11 | `a >= b` |
| `===`, `!==` | 10 | `a === b` |
| `&&` | 6 | `a && b` |
| `??` | **5** | `a ?? b` |
| `\|\|` | 4 | `a \|\| b` |

### Correct usage

```ts
// ALWAYS parenthesise ?? when used with other operators
const value = (event.value ?? 0) >= def.targetValue;
const total = (item.price ?? 0) + tax;
const label = (user.name ?? 'Anonymous') + ' joined';
```

## Prevention

1. **Lint rule:** Enable `no-mixed-operators` or equivalent to flag `??` used alongside comparison or arithmetic operators without parentheses.
2. **Code review habit:** Any `??` not wrapped in parentheses when adjacent to another operator is a suspect.
3. **Intermediate variables:** When in doubt, assign the nullish-coalesced value to a variable first, then use it in the expression.

```ts
// Clearest approach — no ambiguity
const effectiveValue = event.value ?? 0;
const meetsTarget = effectiveValue >= def.targetValue;
```

<details>
<summary>WP-014 Context</summary>

In Weekend Poker, an achievement/challenge system checked whether an event's value met a target threshold. The expression `event.value ?? 0 >= def.targetValue` was parsed as `event.value ?? (0 >= def.targetValue)`. When the event value was present, the comparison was skipped entirely. When it was absent, the fallback was a boolean (`true` or `false`) instead of `0`. The fix was simply adding parentheses: `(event.value ?? 0) >= def.targetValue`.

</details>
