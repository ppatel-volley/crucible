# Three.js / React Three Fiber Agent Guidelines

> **Conditional file** — load only when the task involves 3D, shaders, or WebGL.

---

## Shader Development

### Required Practices

- All fragment shaders must declare `precision highp float;`
- Use `mix()`, `step()`, `smoothstep()` instead of `if/else` where possible
- Varyings must be declared identically in vertex and fragment shaders
- Use `texture2D()` for GLSL 1.0 (default), `texture()` for GLSL 3.0
- Use `float` instead of `int` for all uniforms (WebGL ES compatibility)

### Performance Guidelines

| Pattern | Preferred | Avoid |
|---------|-----------|-------|
| Branching | `mix(a, b, step(0.5, x))` | `if (x > 0.5) { ... }` |
| Clamping | `clamp(x, 0.0, 1.0)` | `max(0.0, min(1.0, x))` |
| Conditionals | `max(x - threshold, 0.0)` | `if (x > threshold) { x - threshold }` |
| Noise octaves | LOD-based count | Fixed high count (7+) |

### Common Mistakes

- Don't compute values you never use (e.g., luminance for tone mapping)
- Extract shared functions (noise, hash) to reusable strings
- Consider exposing tuning values as uniforms

### Shader Checklist

- [ ] Precision declared in fragment shaders
- [ ] No unused variables or calculations
- [ ] Varyings match between vertex/fragment
- [ ] Conditionals minimized or justified
- [ ] Tested visually in browser

---

## React Three Fiber Patterns

```typescript
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'

function MyMesh() {
    const meshRef = useRef<THREE.Mesh>(null)

    useFrame((state, delta) => {
        if (meshRef.current) {
            meshRef.current.rotation.y += delta
        }
    })

    return (
        <mesh ref={meshRef}>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial color="orange" />
        </mesh>
    )
}

function Scene() {
    return (
        <Canvas>
            <ambientLight intensity={0.5} />
            <pointLight position={[10, 10, 10]} />
            <MyMesh />
        </Canvas>
    )
}
```
