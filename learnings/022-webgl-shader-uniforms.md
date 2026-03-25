# WebGL Shader Uniforms — Always Use Float

**Severity:** High
**Sources:** finalfrontier/013
**Category:** Three.js, WebGL, GLSL

## Principle

Always use `float` for shader uniforms, never `int`. WebGL 1.0 has poor integer support across GPU vendors and browser implementations. Integer comparisons and arithmetic fail silently on many systems — the shader compiles and links without error on some GPUs but produces incorrect results or fails entirely on others. No TypeScript or build-time error will catch this; it manifests only as a runtime WebGL error or visual corruption.

## Details

WebGL 1.0 (which Three.js uses by default) has inconsistent `int` support. Some drivers treat `int` uniforms correctly; others silently cast them or produce garbage. The result is code that works on your development machine but breaks on a different GPU, browser, or operating system.

### Wrong — using `int` uniforms

```glsl
// WRONG — int uniform, fails on many GPUs
uniform int bandCount;
uniform int activeBand;

void main() {
  for (int i = 0; i < bandCount; i++) {  // comparison with int uniform
    if (i == activeBand) {                // int equality — unreliable
      // apply effect
    }
  }
}
```

### Correct — float uniforms with range comparisons

```glsl
// CORRECT — float uniforms, works everywhere
uniform float bandCount;
uniform float activeBand;

void main() {
  for (int i = 0; i < 16; i++) {           // fixed upper bound
    if (float(i) >= bandCount) break;       // cast loop counter to float
    if (abs(float(i) - activeBand) < 0.5) { // range comparison, not equality
      // apply effect
    }
  }
}
```

### Key rules

| Pattern | Status |
|---------|--------|
| `uniform int x;` | Avoid — unreliable across GPUs |
| `uniform float x;` | Safe — universal support |
| `i == intUniform` | Avoid — integer equality fails silently |
| `float(i) >= floatUniform` | Safe — cast and compare as float |
| `int` function parameters | Avoid — pass `float`, cast internally if needed |
| Fixed loop bounds with `break` | Required for WebGL 1.0 (no dynamic loop bounds) |

### JavaScript side

```ts
// WRONG
uniforms: {
  bandCount: { value: 5 },      // JS number, but GLSL declares int
}

// CORRECT
uniforms: {
  bandCount: { value: 5.0 },    // explicit float, GLSL declares float
}
```

## Prevention

1. Never declare `uniform int` in any shader. Use `float` for all uniforms, even those representing counts or indices.
2. Cast loop counters with `float(i)` before comparing against uniforms.
3. Use range comparisons (`abs(a - b) < 0.5`) instead of equality for index matching.
4. Test shaders on at least two different GPU vendors (e.g. Intel integrated + discrete NVIDIA/AMD) before shipping.
5. If you see visual artefacts on one machine but not another, check uniform types first.

<details>
<summary>Final Frontier — Gas Giant Band Shader (FF-013)</summary>

The gas giant atmospheric band shader used `uniform int bandCount` and `uniform int activeBand` to control how many colour bands were rendered and which band was highlighted. This worked perfectly on an NVIDIA discrete GPU in Chrome but produced solid black planets on Intel integrated graphics in Firefox. The shader compiled without error on both systems — the failure was entirely silent. Switching all `int` uniforms to `float` and replacing integer equality with range comparisons fixed the issue across all tested configurations.
</details>
