# Visual Scale System and Cascade Effects

**Severity:** High
**Sources:** finalfrontier/004, finalfrontier/005, finalfrontier/006, finalfrontier/007, finalfrontier/008
**Category:** Game Design, Scale, Camera

## Principle

Use centralised, type-based scale multipliers for visual hierarchy. When visual scale changes, ALL dependent systems must update: spawn positions, orbit generation, collision detection, camera settings, secondary views, and test assertions. Visual and collision scales must match — players see the visual size, so ships "flying through" visible objects is confusing and breaks immersion.

## Details

### Centralised scale constants (FF-004)

Define scale multipliers in a single location, keyed by object type:

```ts
// scales.ts — single source of truth
export const BASE_DISPLAY_RADIUS = 0.5;

export const SCALE_MULTIPLIERS: Record<BodyType, number> = {
  rocky: 8,
  gas: 15,
  ice: 10,
  dwarf: 4,
  moon: 3,
};

export function getDisplayRadius(body: CelestialBody): number {
  const baseMultiplier = SCALE_MULTIPLIERS[body.type] ?? 1;
  return BASE_DISPLAY_RADIUS * baseMultiplier * (body.radiusFactor ?? 1);
}

// Stars use a different formula
export function getStarDisplayRadius(star: Star): number {
  return BASE_DISPLAY_RADIUS * 20 + star.luminosity * 5;
}
```

### Collision must use visual radii (FF-005)

```ts
// WRONG — collision uses logical/data radius, visual uses display radius
function checkCollision(ship: Ship, body: CelestialBody) {
  const distance = ship.position.distanceTo(body.position);
  return distance < body.radius;  // data radius — much smaller than visual
}

// CORRECT — import the same display function used for rendering
import { getDisplayRadius } from "./scales";

function checkCollision(ship: Ship, body: CelestialBody) {
  const distance = ship.position.distanceTo(body.position);
  return distance < getDisplayRadius(body);  // matches what the player sees
}
```

### Scale cascade checklist (FF-006)

When ANY scale constant changes, review every item in this list:

| System | What to update | Why |
|--------|---------------|-----|
| Ship spawn positions | Minimum distance from star | Ships spawn inside the star |
| Planet orbit radii | Minimum orbit radius | Planets overlap the star |
| Frost line distances | Ice/gas planet boundary | Wrong planet types in wrong zones |
| Collision radii | `getDisplayRadius` usage | Ships fly through visible objects |
| Camera far plane | `far` parameter | Distant objects disappear |
| Camera near plane | `near` parameter | Close objects clip |
| Test assertions | Expected positions/distances | Tests fail with stale values |
| Minimap scale | Position divisor | Objects off-screen or bunched together |

### Secondary views and frustum culling (FF-007)

Secondary views (tactical map, minimap, picture-in-picture) have their own camera instances with independent frustum settings. When the main scale changes, these cameras silently cull objects that have moved outside their frustum.

```ts
// WRONG — minimap camera has hardcoded bounds
const minimapCamera = new THREE.OrthographicCamera(
  -100, 100, 100, -100, 0.1, 500  // objects beyond 500 units disappear
);

// CORRECT — derive from scale constants
import { MAX_ORBIT_RADIUS, POSITION_SCALE } from "./scales";
const extent = MAX_ORBIT_RADIUS * POSITION_SCALE * 1.5;
const minimapCamera = new THREE.OrthographicCamera(
  -extent, extent, extent, -extent, 0.1, extent * 2
);
```

**Silent failure mode:** Frustum culling does not throw errors. Objects simply vanish from the secondary view with no warning.

### Smoothing and large jumps (FF-008)

Lerp smoothing factors and look-ahead distances must scale with world size. When the world gets larger, jumps between frames can exceed what the smoothing can handle, causing rubber-banding.

```ts
// WRONG — fixed smoothing assumes small world
camera.position.lerp(targetPosition, 0.1);

// CORRECT — detect large jumps and snap
const distance = camera.position.distanceTo(targetPosition);
const SNAP_THRESHOLD = 100;  // scale with world size

if (distance > SNAP_THRESHOLD) {
  camera.position.copy(targetPosition);  // snap — no lerp
} else {
  const smoothFactor = Math.min(0.1, 5.0 / distance);  // adaptive
  camera.position.lerp(targetPosition, smoothFactor);
}
```

### Scale hierarchy diagram

```
BASE_DISPLAY_RADIUS
├── Star display radius (base × 20 + luminosity bonus)
├── Planet display radius (base × type multiplier × radius factor)
│   ├── Collision radius (= display radius)
│   ├── Orbit minimum (> star display radius + margin)
│   └── Spawn minimum (> max orbit radius + margin)
├── Camera far plane (> max spawn distance × 2)
├── Minimap extent (> max orbit radius × POSITION_SCALE)
└── Smoothing snap threshold (proportional to max distances)
```

## Prevention

1. Define all scale values in a single file. Never hardcode radii, distances, or multipliers in component files.
2. When changing any scale constant, run the cascade checklist above — every item.
3. Collision detection must import the same display radius function used for rendering.
4. Secondary cameras must derive their frustum from scale constants, not hardcoded values.
5. Add a snap-vs-lerp threshold for camera and movement smoothing, proportional to world size.
6. Write integration tests that verify collision radii match visual radii.

<details>
<summary>Final Frontier — Centralised Scale Constants (FF-004)</summary>

Planet and star sizes were initially defined as ad-hoc multipliers scattered across multiple components. Changing the star size required updating values in six different files. A centralised `scales.ts` module with type-based multipliers reduced this to a single change point.
</details>

<details>
<summary>Final Frontier — Ships Flying Through Planets (FF-005)</summary>

Collision detection used the data-layer `radius` property (a realistic value in AU), but rendering used `getDisplayRadius()` which applied a visual multiplier. Ships collided only when they reached the tiny logical radius, long after they had visually passed through the planet. Importing `getDisplayRadius` into the collision system fixed the mismatch.
</details>

<details>
<summary>Final Frontier — Scale Inflation Cascade (FF-006)</summary>

Increasing the star display size by 2x caused a cascade of failures: planets spawned inside the star, ship starting positions overlapped planets, frost line distances were wrong (ice planets appeared in the inner system), and several tests failed because expected orbital distances had changed. A checklist was created to prevent this recurring.
</details>

<details>
<summary>Final Frontier — Tactical Map Objects Disappearing (FF-007)</summary>

After scaling up the system, objects disappeared from the tactical map. The tactical map camera had a hardcoded `far` plane of 500 units, but planets now orbited at distances exceeding 800 units. Frustum culling silently removed them. Deriving the camera bounds from `MAX_ORBIT_RADIUS * POSITION_SCALE` fixed the issue.
</details>

<details>
<summary>Final Frontier — Camera Rubber-Banding (FF-008)</summary>

With larger world scales, the camera's lerp-based following could not keep up with warp-speed jumps between distant points. The camera would overshoot the target, snap back, overshoot again — visible as a nauseating rubber-band effect. Adding a snap threshold (teleport instantly if distance exceeds 100 units) and adaptive smoothing factors eliminated the issue.
</details>
