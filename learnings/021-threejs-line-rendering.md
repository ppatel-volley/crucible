# Three.js Line Rendering and Memoisation

**Severity:** Medium
**Sources:** finalfrontier/003
**Category:** React Three Fiber, Three.js

## Principle

When using `<primitive>` in React Three Fiber, memoise the ENTIRE Three.js object — not just its parts. Creating new objects in the render path causes rendering glitches and dropped frames. Additionally, lowercase `<line>` resolves to an SVG element, not a Three.js `Line` — React Three Fiber requires `<primitive>` for custom Three.js objects.

## Details

React Three Fiber's reconciler treats `<primitive object={...}>` as a pass-through — it attaches the given object directly to the scene graph. If that object is recreated on every render, the old one is removed and the new one is added each frame, causing flickering and wasted GPU resources.

### Common mistakes

**Mistake 1 — Lowercase `<line>` becomes SVG:**

```tsx
// WRONG — resolves to an SVG <line>, not THREE.Line
return <line points={points} />;

// CORRECT — use <primitive> with a Three.js Line object
return <primitive object={lineObj} />;
```

**Mistake 2 — Creating a new THREE.Line in the return statement:**

```tsx
// WRONG — new object every render, causes flicker
const OrbitPath = ({ points }: { points: Vector3[] }) => {
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setFromPoints(points);
    return geo;
  }, [points]);

  const material = useMemo(
    () => new THREE.LineBasicMaterial({ color: 0x444444 }),
    []
  );

  // BUG: new THREE.Line created every render
  return <primitive object={new THREE.Line(geometry, material)} />;
};
```

**Correct pattern — memoise the full object:**

```tsx
const OrbitPath = ({ points }: { points: Vector3[] }) => {
  const lineObj = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: 0x444444,
      transparent: true,
      opacity: 0.3,
    });
    return new THREE.Line(geometry, material);
  }, [points]);

  return <primitive object={lineObj} />;
};
```

**Mistake 3 — Using drei `<Line>` when transparency breaks:**

The `@react-three/drei` `<Line>` component uses `LineMaterial` from Three.js examples, which has known transparency and depth-sorting issues. If transparency or blending does not behave as expected, drop down to a raw `THREE.Line` with `THREE.LineBasicMaterial` via `<primitive>`.

## Prevention

1. Never use lowercase JSX tags (`<line>`, `<mesh>`, etc.) for custom Three.js objects — they resolve to HTML/SVG elements.
2. Always wrap the entire Three.js object construction inside a single `useMemo`, including geometry and material.
3. If drei's `<Line>` shows transparency artefacts, use `<primitive>` with a manually constructed `THREE.Line`.
4. Search for `new THREE.` inside JSX return statements — any match is a potential per-frame allocation bug.

<details>
<summary>Final Frontier — Orbit Path Rendering (FF-003)</summary>

Orbital paths were rendered using `<primitive>` but only the geometry and material were memoised separately. A new `THREE.Line` was constructed in the return statement on every frame. This caused orbit lines to flicker and occasionally disappear entirely. The fix was to move the entire `THREE.Line` construction into a single `useMemo` so the same object persisted across renders.

An earlier attempt used lowercase `<line>`, which silently rendered nothing visible (SVG elements are ignored in the WebGL canvas). Another attempt used drei's `<Line>`, but its `LineMaterial` did not support the required transparency blending for faded orbit tails.
</details>
