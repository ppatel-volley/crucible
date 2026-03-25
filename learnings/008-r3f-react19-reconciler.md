# R3F + React 19 Reconciler Incompatibility

**Severity:** Critical
**Sources:** weekend-poker/005
**Category:** React, Three.js, Dependencies

## Principle

React Three Fibre v8 uses `react-reconciler@0.27.0`, which was built for React 18's internal API surface. React 19.2+ removed several internal APIs that this reconciler depends on, causing fatal runtime errors at module import time — not at render time. Always use R3F v9+ with React 19. After any lockfile change (`pnpm install`, dependency update, branch switch), verify the app actually starts in the browser.

## Details

The error manifests immediately on import, before any component renders:

```
TypeError: Cannot read properties of undefined (reading 'ReactCurrentOwner')
```

This happens because `react-reconciler@0.27.0` accesses `React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner`, which was removed in React 19.2+. The error is fatal and unrecoverable — no error boundary can catch it because it occurs during module evaluation.

**Root cause:** `react-reconciler` versions are tightly coupled to specific React internal APIs. R3F v8 pins an old reconciler version. React 19 removed the internals it depends on.

**The fix:**

```bash
# Upgrade to R3F v9+ and compatible ecosystem packages
pnpm add @react-three/fiber@^9.0.0 @react-three/drei@^10.0.0
```

Verify the resolved `react-reconciler` version is compatible:

```bash
pnpm list react-reconciler
# Should show 0.29.x or later for React 19
```

**After any lockfile change:**

```bash
pnpm install && pnpm build && pnpm dev
# Then open the browser and verify the app renders
```

## Prevention

1. Pin R3F and React versions together. When upgrading React, upgrade R3F in the same PR.
2. After any `pnpm install` that changes the lockfile, start the dev server and verify the app loads in a browser.
3. Add a smoke test to CI that actually renders an R3F `<Canvas>` component — build-time checks alone will not catch this.
4. Be aware that `pnpm install` can silently change module resolution (e.g., hoisting a different version) even when you haven't explicitly changed dependencies.
5. If you see any error referencing `__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED`, it is almost certainly a React version mismatch with a reconciler or renderer package.

<details>
<summary>Weekend Poker — Silent Lockfile Change (WP-005)</summary>

A routine `pnpm install` after a branch merge silently changed the resolved version of an indirect dependency. The app had been working with React 19.1 and R3F v8 (which was already fragile), but the lockfile change shifted module resolution enough to trigger the fatal `ReactCurrentOwner` error. The build succeeded — the error only appeared at runtime in the browser. The fix was upgrading to `@react-three/fiber@^9.0.0` and `@react-three/drei@^10.0.0`, which ship with a React 19-compatible reconciler.

**Key takeaway:** `pnpm build` passing is not sufficient. Runtime verification in a browser is required after lockfile changes, especially when using packages that depend on React internals.
</details>
