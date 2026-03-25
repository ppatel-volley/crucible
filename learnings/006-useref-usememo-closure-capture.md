# useRef + useMemo Closure Capture

**Severity:** Critical
**Sources:** weekend-poker/001
**Category:** React, Three.js

## Principle

When a `useMemo` closure captures `ref.current` at memo-time, it holds a stale reference if the ref is later reassigned. Closures must read `ref.current` at call-time, not capture it into a local variable. This is especially dangerous with empty dependency arrays (`[]`), where the memoised value is computed once and never recomputed.

## Details

A React ref is a mutable container: `{ current: T }`. The `.current` property can be reassigned at any time. If a `useMemo` (or `useCallback`) closure reads `ref.current` during its initial computation and stores that value, it will never see subsequent reassignments.

```tsx
// WRONG — captures ref.current at memo-time (stale reference)
const meshMapRef = useRef<Map<string, Mesh>>(new Map());

const getCard = useMemo(() => {
  const meshMap = meshMapRef.current; // captured once, stale forever
  return (id: string) => meshMap.get(id);
}, []);

useEffect(() => {
  // This reassignment is invisible to getCard
  meshMapRef.current = buildNewMeshMap(cards);
}, [cards]);
```

```tsx
// CORRECT — reads ref.current at call-time
const meshMapRef = useRef<Map<string, Mesh>>(new Map());

const getCard = useMemo(() => {
  return (id: string) => meshMapRef.current.get(id); // reads ref at call-time
}, []);

useEffect(() => {
  meshMapRef.current = buildNewMeshMap(cards);
}, [cards]);
```

**Red flags to watch for:**

- A local variable assigned from `ref.current` inside `useMemo` or `useCallback`.
- Empty dependency arrays (`[]`) combined with ref reads.
- `useEffect` that reassigns `ref.current` after a `useMemo` has already captured it.
- Components that "work on hot reload but not on first mount" — a classic symptom of stale closure capture.

## Prevention

1. Never destructure or alias `ref.current` into a local variable inside `useMemo` or `useCallback`. Always access `ref.current` at the point of use.
2. If a memoised function needs a ref value, read `ref.current` inside the returned function, not in the memo's setup code.
3. During code review, flag any pattern where `ref.current` appears on the right-hand side of an assignment inside a `useMemo` body.

<details>
<summary>Weekend Poker — CardDeck.tsx Invisible Cards (WP-001)</summary>

`CardDeck.tsx` used a `meshMapRef` to store a `Map` of card meshes. A `useMemo` with `[]` dependencies captured `meshMapRef.current` into a local variable during initial render. A `useEffect` later rebuilt the mesh map and reassigned `meshMapRef.current`, but the memoised closures still referenced the original empty `Map`. Cards were correctly loaded into the new map but never rendered, because every lookup went through the stale captured reference.

The fix was to change the closure to read `meshMapRef.current` at call-time rather than capturing it at memo-time. No dependency array change was needed.
</details>
