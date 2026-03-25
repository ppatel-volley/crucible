# SVG Countdown Ring Animation

**Severity:** Medium
**Sources:** emoji-multiplatform/034, emoji-multiplatform/037
**Category:** UI, CSS, SVG, Animation

## Principle

SVG ring animations driven by server timestamps must account for elapsed time on mount, not assume rendering at t=0. CSS inline styles override SVG presentation attributes due to cascade precedence — setting the same property as both an attribute and inline style means the browser never sees the initial value. Use a two-phase render with `useState` + `requestAnimationFrame`.

## Details

### 1. Accounting for elapsed time on mount (EM-034)

A countdown ring component used a hardcoded initial `strokeDashoffset` (full circle) and a CSS transition over the full duration. When the component mounted mid-countdown (e.g. after a reconnect or navigation), the ring started from 100% and animated over the full duration, completely out of sync with the actual remaining time.

```ts
// WRONG — assumes mount at t=0
const circumference = 2 * Math.PI * radius;
return (
  <circle
    strokeDasharray={circumference}
    strokeDashoffset={0}
    style={{ transition: `stroke-dashoffset ${totalDuration}s linear` }}
  />
);

// CORRECT — compute elapsed from server timestamp
const elapsed = (Date.now() - timerStartedAt) / 1000;
const remaining = Math.max(0, totalDuration - elapsed);
const progress = remaining / totalDuration;
const initialOffset = circumference * (1 - progress);
```

### 2. SVG attribute vs inline style conflict (EM-037)

Setting `strokeDashoffset` as an SVG presentation attribute (for the initial value) AND as an inline style (for the target value) does not create a transition. The inline style always wins due to CSS cascade precedence — the browser never sees the attribute value, so there is no change to animate.

```tsx
// WRONG — attribute and style conflict, no animation
<circle
  strokeDashoffset={circumference}           // SVG attribute (initial)
  style={{
    strokeDashoffset: 0,                     // inline style (target) — ALWAYS wins
    transition: "stroke-dashoffset 30s linear"
  }}
/>
```

### Two-phase render pattern (fix for both issues)

Use `useState` to control the offset value. Mount with the initial offset in the style, then update to the target offset in a `requestAnimationFrame` callback. This gives the browser one frame to paint the initial value before transitioning.

```tsx
function CountdownRing({ timerStartedAt, totalDuration, radius }: Props) {
  const circumference = 2 * Math.PI * radius;

  // Compute elapsed time from server timestamp
  const elapsed = (Date.now() - timerStartedAt) / 1000;
  const remaining = Math.max(0, totalDuration - elapsed);
  const progress = remaining / totalDuration;
  const initialOffset = circumference * (1 - progress);

  // Phase 1: mount with initial offset
  const [offset, setOffset] = useState(initialOffset);

  useEffect(() => {
    // Phase 2: transition to final offset in next frame
    const frame = requestAnimationFrame(() => {
      setOffset(circumference); // fully depleted
    });
    return () => cancelAnimationFrame(frame);
  }, [circumference]);

  return (
    <circle
      r={radius}
      strokeDasharray={circumference}
      style={{
        strokeDashoffset: offset,
        transition: `stroke-dashoffset ${remaining}s linear`,
      }}
    />
  );
}
```

Key points:
- **Both values are set via inline style** — no attribute/style conflict.
- **Initial value accounts for elapsed time** — no desync on late mount.
- **`requestAnimationFrame`** ensures the browser paints the initial frame before the transition begins.
- **Transition duration uses `remaining`**, not `totalDuration`.

## Prevention

1. **Never mix SVG presentation attributes and inline styles** for the same property. Pick one mechanism and use it consistently.
2. **Always compute elapsed time from a server timestamp.** Never assume the component mounts at timer start.
3. **Use the two-phase render pattern** (useState + rAF) for any CSS transition that needs a defined starting point.
4. **Test with simulated late mount:** Write a test where the component mounts 50% through the timer and assert the visual offset matches.

<details>
<summary>EM-034 — Countdown Ring Desync on Reconnect</summary>

The countdown ring component was built assuming it always mounted at the start of a round. During reconnection testing, the component mounted with 12 seconds remaining on a 30-second timer. The ring showed a full circle and animated over 30 seconds instead of showing 40% remaining and animating over 12 seconds. The fix was computing the elapsed time from `timerStartedAt` in server state and adjusting both the initial offset and the transition duration.

</details>

<details>
<summary>EM-037 — Ring Animation Not Animating</summary>

After fixing EM-034, the ring stopped animating entirely. The initial offset was set as an SVG `strokeDashoffset` attribute, and the target offset was set as an inline style. Because inline styles have higher specificity than SVG presentation attributes in the CSS cascade, the browser only ever saw the inline style value — there was no change to transition. The fix was the two-phase render pattern: both values set via inline style, with a `requestAnimationFrame` delay between them to ensure the browser paints the initial frame.

</details>
