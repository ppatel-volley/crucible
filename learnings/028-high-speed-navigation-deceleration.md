# High-Speed Navigation and Deceleration

**Severity:** High
**Sources:** finalfrontier/010
**Category:** Physics, Navigation, Game Development

## Principle

High-speed movement needs physics-based deceleration to prevent overshoot. Without it, objects "rubber-band" past their target — arriving, overshooting, correcting, overshooting again in an infinite loop. Use the formula `v = sqrt(2 * deceleration * distance)` to compute the maximum safe speed, begin decelerating at 1.5x stopping distance, and limit per-frame movement to `distanceToTarget - buffer`. Scale the arrival threshold with current speed.

## Details

### The physics

The stopping distance for an object decelerating uniformly from velocity `v` is:

```
d = v² / (2 * a)
```

Where `d` is stopping distance, `v` is current velocity, and `a` is deceleration rate. Rearranging gives the maximum speed for a given remaining distance:

```
v_max = sqrt(2 * a * d)
```

### Symptoms of missing deceleration

- **Overshoot:** Object passes through the target and appears on the far side.
- **Rubber-banding:** Object oscillates back and forth across the target, never settling.
- **Never arriving:** Object alternates between "approaching" and "receding" states indefinitely.
- **Snapping:** Object teleports to the target when within a fixed threshold, creating a visible jump.

### Implementation

```ts
const DECELERATION = 50;         // units/s² — tune to feel
const ARRIVAL_BUFFER = 0.5;      // minimum distance to maintain
const DECEL_START_FACTOR = 1.5;  // begin decelerating at 1.5x stopping distance

function updateNavigation(
  ship: Ship,
  target: Vector3,
  deltaTime: number
): void {
  const toTarget = target.clone().sub(ship.position);
  const distanceToTarget = toTarget.length();

  // Arrival check — threshold scales with speed
  const arrivalThreshold = Math.max(1.0, ship.speed * deltaTime * 2);
  if (distanceToTarget < arrivalThreshold) {
    ship.position.copy(target);
    ship.speed = 0;
    ship.state = "arrived";
    return;
  }

  // Compute stopping distance at current speed
  const stoppingDistance = (ship.speed * ship.speed) / (2 * DECELERATION);

  // Begin deceleration when within 1.5x stopping distance
  if (distanceToTarget < stoppingDistance * DECEL_START_FACTOR) {
    // Maximum safe speed for remaining distance
    const maxSpeed = Math.sqrt(2 * DECELERATION * distanceToTarget);
    ship.speed = Math.min(ship.speed, maxSpeed);
  } else {
    // Accelerate towards cruise speed
    ship.speed = Math.min(ship.speed + DECELERATION * deltaTime, ship.maxSpeed);
  }

  // CRITICAL: limit movement to never overshoot
  const moveDistance = Math.min(
    ship.speed * deltaTime,
    distanceToTarget - ARRIVAL_BUFFER
  );

  const direction = toTarget.normalize();
  ship.position.add(direction.multiplyScalar(moveDistance));
}
```

### Common mistakes

```ts
// WRONG — no deceleration, constant speed until arrival
ship.position.add(direction.multiplyScalar(ship.speed * deltaTime));
if (distanceToTarget < 1.0) ship.state = "arrived";

// WRONG — fixed arrival threshold, misses at high speed
// At 1000 units/s with 16ms frame, ship moves 16 units per frame
// A 1-unit arrival threshold is skipped entirely
if (distanceToTarget < 1.0) ship.state = "arrived";

// WRONG — lerp without speed limit causes asymptotic approach (never arrives)
ship.position.lerp(target, 0.1);
```

### Deceleration curve visualisation

```
Speed
  ^
  |  _______________
  | /               \
  |/                 \
  |                   \
  |                    \
  +----------------------> Distance to target
  far                  0

  ← cruise speed →← deceleration zone →
```

## Prevention

1. Implement deceleration using `v = sqrt(2 * a * d)` — do not rely on lerp or fixed-speed approaches for high-speed movement.
2. Always cap per-frame movement to `distanceToTarget - buffer` to make overshoot physically impossible.
3. Scale the arrival threshold with current speed: `threshold = max(base, speed * dt * 2)`.
4. Begin decelerating early (1.5x stopping distance) to avoid abrupt speed changes.
5. Test with the maximum possible speed at the minimum possible frame rate — this is the worst case for overshoot.

<details>
<summary>Final Frontier — Warp Navigation Rubber-Banding (FF-010)</summary>

Ships travelling at warp speed would overshoot their target planet, reverse direction, overshoot again, and oscillate indefinitely. The navigation system used constant velocity with a fixed 1-unit arrival threshold. At warp speed (thousands of units per second), the ship moved 50+ units per frame — it would never land within the 1-unit threshold, instead passing through it every frame. The fix involved three changes: physics-based deceleration starting at 1.5x stopping distance, clamping per-frame movement to `distanceToTarget - 0.5`, and scaling the arrival threshold with current speed. After the fix, ships smoothly decelerated and settled precisely at their target position.
</details>
