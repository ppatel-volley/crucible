# skipLibCheck needed in template tsconfig

**Date:** 2026-03-31
**Context:** Building shared package in a crucible-created game fails with type errors from vite/vitest

## Problem
Running `tsc -b` in `packages/shared/` fails with errors from `node_modules/.pnpm/vite@*/...` and `node_modules/.pnpm/vitest@*/...` type declarations.

## Root cause
`tsconfig.base.json` in the hello-weekend template doesn't set `skipLibCheck: true`. TypeScript checks ALL .d.ts files including those in node_modules, which often have cross-package type issues.

## Fix
Add to hello-weekend's `tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "skipLibCheck": true
  }
}
```

## Impact
Without this, every game created from the template requires manual intervention to build the shared package.
