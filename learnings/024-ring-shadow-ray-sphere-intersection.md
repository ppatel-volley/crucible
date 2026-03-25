# Ring Shadow via Ray-Sphere Intersection

**Severity:** Medium
**Sources:** finalfrontier/016
**Category:** Shaders, GLSL

## Principle

To render planetary ring shadows, cast rays from the light source to each ring fragment and check whether the ray passes through the planet sphere. Real planetary shadows are SHARP — not soft gradient blurs. Use a tight smoothstep (0.95–1.0) for the shadow edge and near-black brightness (2%) in shadowed regions.

## Details

### Algorithm

1. For each ring fragment, compute the ray from the light source to the fragment position.
2. Solve the ray-sphere intersection equation for the planet's bounding sphere.
3. If the ray intersects the sphere, the fragment is in shadow.
4. Apply a sharp shadow edge using smoothstep near the intersection boundary.

### Ray-sphere intersection in GLSL

```glsl
uniform vec3 lightPosition;    // star position (world space)
uniform vec3 planetCenter;     // planet centre (world space)
uniform float planetRadius;    // planet visual radius

float computeRingShadow(vec3 fragPos) {
  // Ray from light to fragment
  vec3 rayDir = normalize(fragPos - lightPosition);
  vec3 rayOrigin = lightPosition;

  // Sphere intersection: |rayOrigin + t*rayDir - planetCenter|² = r²
  vec3 oc = rayOrigin - planetCenter;
  float a = dot(rayDir, rayDir);
  float b = 2.0 * dot(oc, rayDir);
  float c = dot(oc, oc) - planetRadius * planetRadius;
  float discriminant = b * b - 4.0 * a * c;

  if (discriminant < 0.0) {
    return 1.0;  // no intersection — fully lit
  }

  // Check if intersection is between light and fragment
  float t = (-b - sqrt(discriminant)) / (2.0 * a);
  float fragDist = length(fragPos - lightPosition);

  if (t > 0.0 && t < fragDist) {
    // Fragment is behind the planet relative to the light
    // Sharp shadow edge
    float edge = smoothstep(0.95, 1.0, discriminant / (planetRadius * planetRadius * 0.01));
    return mix(0.02, 1.0, 1.0 - edge);  // 2% brightness in shadow
  }

  return 1.0;  // fully lit
}
```

### Wrong vs correct shadow softness

```glsl
// WRONG — unrealistically soft shadow, looks like ambient occlusion
float shadow = smoothstep(0.0, 0.3, shadowFactor);
color *= mix(0.3, 1.0, shadow);  // 30% brightness in shadow — too bright

// CORRECT — sharp shadow edge like real planetary rings
float shadow = smoothstep(0.95, 1.0, shadowFactor);
color *= mix(0.02, 1.0, shadow);  // 2% brightness — nearly black
```

### Applying the shadow

```glsl
void main() {
  vec3 baseColor = computeRingColor(vUV);
  float shadow = computeRingShadow(vWorldPosition);
  gl_FragColor = vec4(baseColor * shadow, ringAlpha);
}
```

## Prevention

1. Reference real photographs of Saturn's rings — shadows are razor-sharp with no perceptible penumbra at typical viewing distances.
2. Always use smoothstep ranges above 0.9 for planetary shadow edges.
3. Shadow regions should be nearly black (0.02 brightness) — space has no atmospheric scattering to fill shadows.
4. Test with the light source at several angles to confirm the shadow tracks correctly as the star moves.

<details>
<summary>Final Frontier — Ring Shadow Rendering (FF-016)</summary>

The initial ring shadow implementation used `smoothstep(0.0, 0.3, ...)` which produced a broad, soft gradient across the ring surface. This looked more like a vignette effect than a planetary shadow. Real ring shadows (visible in Cassini photographs of Saturn) are extremely sharp because there is no atmosphere to scatter light into the shadow region. Tightening the smoothstep to `(0.95, 1.0)` and reducing shadow brightness to 2% produced a convincing, physically plausible shadow. The shadow also needed to verify that the intersection point `t` was between the light and the fragment (not behind the light), which was initially missing and caused shadows to appear on the wrong side of the planet.
</details>
