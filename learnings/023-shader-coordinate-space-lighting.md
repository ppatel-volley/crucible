# Shader Coordinate Space and Lighting

**Severity:** High
**Sources:** finalfrontier/014, finalfrontier/015
**Category:** Three.js, Shaders, GLSL

## Principle

Normal vectors and light direction vectors MUST be in the same coordinate space for dot product lighting to work. A dot product between a view-space normal and a world-space light direction is mathematically meaningless and produces incorrect, camera-dependent lighting. Additionally, when using bump-mapped normals for lighting, blend geometric normals (for structure and day/night terminator) with bump normals (for surface detail) to maintain clear boundaries between the lit and unlit sides.

## Details

### Coordinate space mismatch (FF-014)

Three.js provides several built-in matrices. Each transforms into a different coordinate space:

| Matrix | Transforms to | Use when |
|--------|--------------|----------|
| `modelMatrix` | World space | Light positions are in world space |
| `viewMatrix` | View (camera) space | Using Three.js built-in lights |
| `normalMatrix` | View space | Using Three.js built-in lights |
| `modelViewMatrix` | View space | Standard Three.js rendering |

**Wrong — mixed coordinate spaces:**

```glsl
// WRONG — normalMatrix puts normal in VIEW space,
// but starPosition is in WORLD space
varying vec3 vNormal;

void main() {
  vNormal = normalize(normalMatrix * normal);  // VIEW space
}

// Fragment shader
uniform vec3 starPosition;  // WORLD space

void main() {
  vec3 lightDir = normalize(starPosition - vWorldPosition);
  float diff = dot(vNormal, lightDir);  // MEANINGLESS — different spaces!
}
```

**Correct — consistent world space:**

```glsl
// CORRECT — use modelMatrix to keep normals in WORLD space
varying vec3 vNormal;

void main() {
  vNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);  // WORLD space
}

// Fragment shader
uniform vec3 starPosition;  // WORLD space

void main() {
  vec3 lightDir = normalize(starPosition - vWorldPosition);
  float diff = dot(vNormal, lightDir);  // Both WORLD space — correct
}
```

### Bump normal blending (FF-015)

When bump/normal maps are applied, the perturbed normals capture surface detail but lose the large-scale geometric shape. If bump normals dominate the lighting calculation, the day/night terminator becomes washed out and indistinct.

**Wrong — bump normals only:**

```glsl
// WRONG — bump normal dominates, terminator is soft and unclear
vec3 bumpNormal = computeBumpNormal(uv, heightMap);
float diff = max(dot(bumpNormal, lightDir), 0.0);
```

**Correct — blended normals with sharpened terminator:**

```glsl
// CORRECT — geometric normal for structure, bump for detail
vec3 geometricNormal = normalize(vNormal);
vec3 bumpNormal = computeBumpNormal(uv, heightMap);

// 70% geometric (shape/terminator) + 30% bump (surface detail)
vec3 blendedNormal = normalize(mix(bumpNormal, geometricNormal, 0.7));

float diff = max(dot(blendedNormal, lightDir), 0.0);

// Sharpen the terminator
diff = pow(diff, 0.7);

// Very low ambient for dark night side
vec3 color = texture2D(surfaceMap, uv).rgb * (diff + 0.02);
```

**Special case — gas giants:**

Gas giants have no surface detail that benefits from bump mapping. Use 100% geometric normals for clean band lighting.

```glsl
// Gas giants — geometric normals only
float diff = max(dot(geometricNormal, lightDir), 0.0);
```

## Prevention

1. Before writing any lighting shader, decide on a single coordinate space (typically world space for custom lights) and ensure ALL vectors use it.
2. Comment every `varying vec3` with its coordinate space: `// WORLD space`, `// VIEW space`.
3. When adding bump/normal mapping, always blend with geometric normals — never let bump normals fully replace the base normal for lighting.
4. Keep ambient values very low (0.02–0.05) so the night side is genuinely dark.
5. Test lighting by rotating the camera — if the lit side moves with the camera, normals are in view space but the light is in world space.

<details>
<summary>Final Frontier — Planet Lighting Coordinate Mismatch (FF-014)</summary>

Planet lighting appeared to rotate with the camera instead of staying fixed relative to the star. The vertex shader used `normalMatrix` (which transforms to view space), but the fragment shader compared these normals against the star's world-space position. The dot product was between vectors in different coordinate spaces, producing camera-dependent lighting. Replacing `normalMatrix` with `modelMatrix` for normal transformation fixed the issue — both vectors were then in world space.
</details>

<details>
<summary>Final Frontier — Washed-Out Day/Night Terminator (FF-015)</summary>

After adding bump-mapped terrain to rocky planets, the day/night boundary became blurry and indistinct. The bump normals introduced high-frequency surface detail that dominated the lighting calculation, softening the large-scale terminator line. Blending 70% geometric normals with 30% bump normals restored the sharp terminator whilst retaining visible surface texture. The terminator was further sharpened with `pow(diff, 0.7)` and the ambient was reduced to 0.02 for a convincingly dark night side. Gas giants were switched to 100% geometric normals since their banded appearance does not benefit from bump mapping.
</details>
