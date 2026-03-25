# Star as Light Source and Corona Billboard Shader

**Severity:** High
**Sources:** finalfrontier/017, finalfrontier/018
**Category:** Three.js, Shaders, Lighting

## Principle

Use the star as a single primary light source for consistent scene illumination — avoid directional lights or multiple light sources that create conflicting shadows. For star corona effects, use a billboard plane (not a sphere) with UV-based 2D shader calculations. Spheres fail because all fragments on a sphere's visible surface are at roughly the same distance from the camera centre, making distance-based gradients impossible; they also produce dark rings instead of bright outer glow.

## Details

### Star as point light (FF-017)

A single `PointLight` at the star's position provides physically consistent illumination for all objects in the scene. Every planet, ring, and ship is lit from the same direction — the star.

```tsx
// CORRECT — star as sole primary light
<pointLight
  position={starPosition}
  intensity={50}
  distance={0}       // infinite range — no falloff cutoff
  decay={1}          // gradual inverse falloff
  color={starColor}
/>

// Minimal ambient only — space is dark
<ambientLight intensity={0.05} />
```

**What to avoid:**

```tsx
// WRONG — directional light conflicts with star position
<directionalLight position={[1, 1, 1]} intensity={1} />

// WRONG — high ambient washes out shadows and day/night contrast
<ambientLight intensity={0.5} />

// WRONG — multiple point lights create conflicting shadow directions
<pointLight position={starPosition} />
<pointLight position={[0, 100, 0]} />
```

| Parameter | Value | Reason |
|-----------|-------|--------|
| `intensity` | 50 | Compensates for inverse-square falloff at planetary distances |
| `distance` | 0 | Infinite range — light reaches all objects |
| `decay` | 1 | Gradual falloff — not physically accurate (would be 2) but visually better |
| Ambient | 0.05 | Just enough to prevent pure black on unlit sides |

### Corona billboard shader (FF-018)

A corona/glow effect around a star must use a flat plane that always faces the camera (a billboard), not a sphere.

**Why spheres fail:**

- All visible fragments on a sphere are at approximately the same distance from the view centre.
- A radial gradient from the centre produces a dark ring at the edge rather than a bright glow.
- Back-face culling hides the far hemisphere, and disabling it creates z-fighting artefacts.

**Correct approach — billboard plane:**

```tsx
const CoronaBillboard = ({ starRadius, starColor }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const billboardSize = starRadius * 5;  // 5x star radius for visible glow

  useFrame((state) => {
    // Always face the camera
    if (meshRef.current) {
      meshRef.current.quaternion.copy(state.camera.quaternion);
    }
  });

  return (
    <mesh ref={meshRef} position={starPosition}>
      <planeGeometry args={[billboardSize, billboardSize]} />
      <coronaShaderMaterial starColor={starColor} />
    </mesh>
  );
};
```

**Corona fragment shader:**

```glsl
uniform vec3 starColor;
uniform float time;
varying vec2 vUv;

// Multi-octave noise for flame tendrils
float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += amp * snoise(p);
    p *= 2.0;
    amp *= 0.5;
  }
  return sum;
}

void main() {
  // UV to polar coordinates
  vec2 centre = vUv - 0.5;
  float dist = length(centre);
  float angle = atan(centre.y, centre.x);

  // Star disc in UV space
  float starRadius = 0.4;

  if (dist < starRadius) {
    gl_FragColor = vec4(starColor, 1.0);
    return;
  }

  // Corona — distance-based brightness with noise
  float coronaDist = (dist - starRadius) / (0.5 - starRadius);
  float noise = fbm(vec2(angle * 3.0, time * 0.5)) * 0.3;

  // CORRECT — multiply for brightness (not add, which washes to white)
  float brightness = (1.0 - coronaDist) * (1.0 + noise);
  brightness = pow(max(brightness, 0.0), 2.0);  // sharpen falloff

  gl_FragColor = vec4(starColor * brightness, brightness);
}
```

**Key rules for corona shaders:**

- Use multiplication for brightness blending, not addition (addition washes to white).
- `starRadius = 0.4` in UV space leaves room for the corona between 0.4 and 0.5.
- Use polar coordinates (`atan`, `length`) for radial symmetry.
- Multi-octave noise (`fbm`) creates convincing flame tendrils.

## Prevention

1. Use exactly one `PointLight` at the star position. Remove all `DirectionalLight` sources.
2. Keep ambient intensity below 0.1 — space has no atmospheric scattering.
3. Never use a sphere mesh for glow/corona effects. Always use a billboard plane.
4. When combining brightness values in a shader, use multiplication — addition causes colour channels to exceed 1.0 and clip to white.
5. Verify the billboard faces the camera from multiple angles by orbiting around the star.

<details>
<summary>Final Frontier — Scene Illumination from Star (FF-017)</summary>

The scene originally used a combination of directional light and ambient light, which created inconsistent shadow directions — planets on opposite sides of the star had shadows pointing the same way. Replacing all lights with a single high-intensity `PointLight` at the star's position (intensity 50, distance 0, decay 1) made every object's lighting consistent with the star's position. The ambient was reduced to 0.05 to preserve dark night sides on planets.
</details>

<details>
<summary>Final Frontier — Corona Rendering with Billboard (FF-018)</summary>

The first corona implementation used a slightly-larger sphere around the star with a custom shader. This produced a dark ring at the equator because all visible fragments were at a similar distance from the camera's view centre — the distance gradient was nearly flat. Switching to a billboard plane (5x star radius) that tracks `state.camera.quaternion` allowed proper UV-based radial distance calculations. The shader uses polar coordinates and multi-octave simplex noise for flame tendrils. An earlier version used additive blending (`color + glow`), which washed the corona to pure white; switching to multiplicative blending (`color * brightness`) preserved the star's colour temperature in the glow.
</details>
