# Vitest Is Not Enough

**Severity:** Critical
**Sources:** weekend-poker/007, emoji-multiplatform/001
**Category:** Testing, Build Pipeline, TypeScript

## Principle

Vitest strips TypeScript types at transform time — passing tests do NOT mean the build passes. A green test suite can coexist with dozens of TypeScript errors that break production builds. Always run `typecheck`, `build`, and `test` as a mandatory triad. When integrating third-party packages, read the `.d.ts` files first to understand the actual export surface; never guess import paths or enum values.

## Details

Vitest uses esbuild (or SWC) to strip types before running tests. This means:

- `as any` casts make tests pass but hide real incompatibilities.
- Missing imports compile away silently in test-mode.
- Required fields on shared types are never enforced.
- `vi.mock()` factories that omit symbols still let tests pass if the component under test uses optional chaining or defaults.

```ts
// Tests pass, build explodes:
vi.mock("@/services/gameApi", () => ({
  useGameState: vi.fn(), // missing 6 other exports the real module has
}));

// Vitest is happy with this, tsc is not:
const config = { players: 4 } as any; // missing 'deck', 'blinds', 'timeout'
```

The only reliable verification pipeline is:

```bash
pnpm typecheck && pnpm build && pnpm test
```

All three. Every time. No exceptions.

## Prevention

1. Run `pnpm typecheck` (or `tsc --noEmit`) in CI before tests — fail fast on type errors.
2. Run `pnpm build` after tests to catch bundler-specific issues.
3. Ban `as any` in production code via an ESLint rule (`@typescript-eslint/no-explicit-any`).
4. When integrating a new package, read its `.d.ts` files to understand the actual exports. Do not guess.
5. Ensure `vi.mock()` factories re-export every symbol the component under test imports.

<details>
<summary>Weekend Poker — Three Parallel Agents, 80+ Type Errors (WP-007)</summary>

Three agents worked in parallel on different features. Each produced passing Vitest suites — 1,305 tests total, all green. But `pnpm typecheck` revealed 80+ TypeScript errors:

- Missing imports across module boundaries.
- Required fields omitted on shared game-state types.
- Hook generics still referencing old type definitions after a refactor.
- `vi.mock()` factories that only exported a subset of the real module's symbols.

None of these were caught by Vitest because type-stripping made the runtime happy. The build was completely broken despite a fully green test suite.

**Lesson:** Parallel agent workflows amplify this problem. Each agent validates in isolation; integration failures only surface when you run `tsc` across the whole project.
</details>

<details>
<summary>Emoji Multiplatform — Guessed Import Paths and Enum Values (EM-001)</summary>

An agent integrated the `@volley/vgf` package by guessing import paths and using string literals instead of TypeScript enums:

```ts
// WRONG — guessed path, string literal instead of enum
import { GameConfig } from "@volley/vgf/config";
const mode = "standard"; // should be GameMode.Standard

// CORRECT — verified from .d.ts
import { GameConfig, GameMode } from "@volley/vgf";
const mode = GameMode.Standard;
```

The agent also removed `types` from `tsconfig.json` `compilerOptions`, which broke `import.meta.env` type definitions. Vitest tests still passed because `as any` casts papered over every incompatibility.

**Lesson:** Read the `.d.ts` files. They are the contract. Guessing and casting is not engineering.
</details>
