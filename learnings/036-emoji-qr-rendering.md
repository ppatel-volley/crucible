# Emoji and QR Code Rendering Pitfalls

**Severity:** High
**Sources:** emoji-multiplatform/012, emoji-multiplatform/018
**Category:** UI, Data, Rendering

## Principle

When rendering content from data files, understand the encoding format (raw Unicode vs codepoints) and the conversion pipeline. When rendering canvas-based content (QR codes) alongside other elements, beware of flex layout occlusion from transparent bounding boxes. Use `useCallback` refs for canvas rendering with transforms.

## Details

### 1. Emoji rendering from data files (EM-012)

`puzzle-data.csv` stores emojis as raw Unicode characters. To render them correctly and map to SVG asset filenames, a conversion pipeline is needed.

#### Splitting emoji strings into grapheme clusters

```ts
// Use Intl.Segmenter to split compound emojis correctly
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
const clusters = [...segmenter.segment(emojiString)].map((s) => s.segment);
// "👨‍👩‍👧" → ["👨‍👩‍👧"] (one cluster, not three codepoints)
```

#### Converting to hex codepoint filenames

SVG emoji assets are typically named by hex codepoints (e.g. `1f600.svg`). Convert each grapheme cluster:

```ts
function emojiToFilename(emoji: string): string {
  return [...emoji]
    .map((char) => char.codePointAt(0)!.toString(16))
    .filter((hex) => hex !== "fe0f") // strip variation selector
    .join("-");
}
// "😀" → "1f600"
// "👨‍👩‍👧" → "1f468-200d-1f469-200d-1f467"
```

**Strip variation selectors** (`U+FE0F`) — these are invisible modifiers that affect rendering style but are not part of SVG asset filenames.

**Fallback:** If the SVG asset is missing, fall back to rendering the raw Unicode emoji as text. Not all emoji sets have complete SVG coverage.

### 2. QR code rendering and flex layout occlusion (EM-018)

When rendering a QR code (canvas element) alongside decorative images in a flex layout, large transparent bounding boxes on the images can occlude the QR code. The images appear visually small but their transparent areas still participate in layout and capture pointer events.

```tsx
// WRONG — decorative image's transparent area occludes QR code
<div style={{ display: "flex", alignItems: "center" }}>
  <img src="decoration.png" /> {/* 800×800 with large transparent area */}
  <canvas ref={qrRef} />       {/* hidden behind transparent pixels */}
</div>
```

`z-index` does not fix this in a non-positioned flex context. Solutions:
- Crop the decorative images to their visible content.
- Use `pointer-events: none` on the decorative images.
- Use explicit `width`/`height` on the images to constrain their layout box.

#### useCallback ref for canvas rendering

Use a `useCallback` ref (not `useRef` + `useEffect`) for canvas operations. The callback fires exactly when the canvas element mounts, guaranteeing the 2D context is available:

```tsx
// CORRECT — useCallback ref for canvas
const qrCanvasRef = useCallback((canvas: HTMLCanvasElement | null) => {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  QRCode.toCanvas(canvas, url, { width: 200 });
}, [url]);

return <canvas ref={qrCanvasRef} />;
```

With `useRef` + `useEffect`, timing issues arise when the canvas mounts, unmounts, and remounts (e.g. during conditional rendering or React strict mode).

#### Client-side QR URL fallback

Build QR code URLs client-side as a fallback. In multi-screen architectures, the server state containing the QR URL may not reach the client in time for initial render:

```ts
// Don't wait for server state — compute URL client-side
const qrUrl = `${window.location.origin}/join?session=${sessionId}`;
```

## Prevention

1. **Document the emoji encoding format** in data files. State whether values are raw Unicode, hex codepoints, or shortcodes.
2. **Use `Intl.Segmenter`** for splitting emoji strings — never split on individual characters.
3. **Strip variation selectors** when converting to filenames. Always have a text fallback for missing SVG assets.
4. **Audit decorative image dimensions** — transparent bounding boxes participate in layout. Constrain sizes explicitly.
5. **Use `useCallback` refs** for canvas rendering, not `useRef` + `useEffect`.
6. **Build critical URLs client-side** rather than waiting for server state propagation.

<details>
<summary>EM-012 — Emoji Data Pipeline</summary>

`puzzle-data.csv` contained raw Unicode emojis as puzzle answers. The rendering pipeline needed to: (1) split compound emojis into grapheme clusters using `Intl.Segmenter`, (2) convert each cluster to a hex codepoint filename for SVG asset lookup, (3) strip variation selectors (`FE0F`) that were present in the Unicode but absent from filenames, and (4) fall back to native text rendering when SVG assets were missing. Initial implementation used `String.split("")` which broke compound emojis (family, flag, skin tone sequences) into individual codepoints, rendering them as separate characters.

</details>

<details>
<summary>EM-018 — QR Code Occluded by Decorative Images</summary>

The lobby screen displayed a QR code for players to join, flanked by decorative character images. The character PNGs had large transparent bounding boxes (800x800 pixels with visible content in a 200x200 area). In the flex layout, the transparent areas overlapped the QR code canvas. The QR code was invisible despite being rendered correctly — it was painted behind the transparent image pixels. `z-index` had no effect because the flex items were not positioned. The fix was constraining the image dimensions to their visible content area. Additionally, the QR code initially showed nothing because it waited for the join URL from VGF server state, which arrived after the component mounted. Computing the URL client-side from `window.location` and `sessionId` provided an immediate render.

</details>
