# Angular Units Consistency

**Severity:** High
**Sources:** finalfrontier/002
**Category:** Data Consistency, Mathematics

## Principle

ALL angular values must use radians. Never mix radians and degrees within the same system. `Math.cos()` and `Math.sin()` expect radians — passing degrees produces subtly wrong results that appear "random" rather than obviously broken, making the bug extremely difficult to diagnose.

## Details

When degrees are passed to trigonometric functions that expect radians, the output is not NaN or an error — it is a valid number that simply corresponds to the wrong angle. This means the code runs without errors, renders without crashes, and produces positions that look plausible but are completely incorrect.

### How the bug manifests

```ts
// Degrees and radians produce valid but different results
Math.cos(45);           // 0.5253... (treating 45 as radians ≈ 2578°)
Math.cos(Math.PI / 4);  // 0.7071... (correct: cos(45°))

// The difference is subtle enough to look like "noise"
```

### Wrong — mixed units

```ts
// Generated planets use radians
const generatedPlanet = {
  name: "Kepler-7b",
  orbitAngle: 1.2,          // radians ✓
};

// Hardcoded systems use degrees — BUG
const solSystem = {
  planets: [
    { name: "Earth", orbitAngle: 45 },    // degrees ✗
    { name: "Mars", orbitAngle: 120 },     // degrees ✗
  ],
};

// Navigation uses the raw value — no conversion
function getPosition(planet: Planet, orbitRadius: number) {
  return {
    x: orbitRadius * Math.cos(planet.orbitAngle),  // wrong if degrees
    z: orbitRadius * Math.sin(planet.orbitAngle),   // wrong if degrees
  };
}
```

### Correct — radians throughout

```ts
// ALL angular values in radians
const solSystem = {
  planets: [
    { name: "Earth", orbitAngle: Math.PI / 4 },      // 45° in radians
    { name: "Mars", orbitAngle: (2 * Math.PI) / 3 },  // 120° in radians
  ],
};

// If you must convert from degrees (e.g. external data source)
const DEG_TO_RAD = Math.PI / 180;
const angleRad = angleDeg * DEG_TO_RAD;
```

### Quick reference

| Degrees | Radians | Expression |
|---------|---------|------------|
| 0° | 0 | `0` |
| 45° | π/4 | `Math.PI / 4` |
| 90° | π/2 | `Math.PI / 2` |
| 120° | 2π/3 | `(2 * Math.PI) / 3` |
| 180° | π | `Math.PI` |
| 270° | 3π/2 | `(3 * Math.PI) / 2` |
| 360° | 2π | `2 * Math.PI` |

## Prevention

1. Use `Math.PI / N` notation instead of degree values. Write `Math.PI / 4` not `45`.
2. Add comments specifying units on every angular property: `orbitAngle: number; // radians`.
3. Define a TypeScript branded type if the codebase is large enough to warrant it:
   ```ts
   type Radians = number & { __brand: "radians" };
   const toRadians = (deg: number): Radians => (deg * Math.PI / 180) as Radians;
   ```
4. Check existing tests for expected angle ranges — if tests expect values between 0 and 2π, the data must be in radians.
5. When importing angular data from external sources, convert at the boundary and document the conversion.

<details>
<summary>Final Frontier — Navigation Appeared Random (FF-002)</summary>

The `orbitAngle` property was stored inconsistently across the codebase. Procedurally generated star systems used radians (output of `Math.random() * 2 * Math.PI`), but hand-crafted systems like Sol used degree values (e.g. `45`, `120`, `230`). The navigation system fed these raw values into `Math.cos()` and `Math.sin()` to compute planet positions. Procedural planets appeared in the correct positions; hand-crafted planets appeared in seemingly random locations. The bug was especially hard to diagnose because the positions were valid coordinates — they were just wrong. Converting all hardcoded angles to radians fixed navigation across all systems.
</details>
