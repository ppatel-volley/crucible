# VGF RFC — Predictable Game State Processing

**Severity:** Critical
**Sources:** weekend-poker/020
**Category:** VGF, State Management, Phase Transitions, Thunks
**Related:** 015, 016, 019

## Principle

The VGF Platform Services RFC defines the behavioural contract for dispatches, phase transitions, and lifecycle hooks. This contract eliminates race conditions that silently corrupt game state. All thunk dispatches MUST be awaited. Direct storage manipulation bypasses lifecycle protection and can corrupt state during transitions.

## Key Guarantees (Framework-Enforced)

1. **Consistency** — Reducers run one at a time against latest state. No lost updates.
2. **Concurrency** — Thunks run concurrently. Only serialised at reducer dispatch.
3. **Lifecycle Protection** — onBegin/onEnd are protected regions. External dispatches buffer.
4. **Immediate Broadcast** — Each reducer dispatch broadcasts immediately. 3 dispatches = 3 broadcasts.
5. **onEnd is a Finaliser** — Cannot trigger phase transitions. endIf NOT checked after onEnd.
6. **External Sources Buffer** — Player, scheduler, onConnect dispatches buffer during transitions.
7. **Fresh State** — After `await ctx.dispatch(...)`, getState() is guaranteed fresh.
8. **Phase Boundary Enforcement** — Dispatches targeting old phases are discarded with warning.

## Consumer Rules (MUST Follow)

| Context | DO | DON'T | Why |
|---------|-----|-------|-----|
| Thunks | `await ctx.dispatch(...)` | Call dispatch without await | Ensures fresh state after resolve |
| Thunks | `ctx.getState()` after async yields | Assume state unchanged after await | Other dispatches may have run |
| onBegin | Dispatch reducers for state changes | Return a state object (deprecated) | Returning state overwrites inline dispatches |
| onEnd | Use for cleanup only | Call endPhase()/setPhase() | onEnd cannot trigger transitions |
| Reducers | Keep pure: (state, ...args) => state | Dispatch from within a reducer | Reducers have no dispatch access |
| Lifecycle | Minimise async work | Do heavy I/O in onBegin/onEnd | Holds protected region open, buffering ALL external dispatches |

## Critical Implications

### Await all dispatches in thunks

```ts
// WRONG — un-awaited dispatches lose fresh-state guarantee
ctx.dispatch('addPlayer', newPlayer)
ctx.dispatch('updateWallet', clientId, amount)

// CORRECT — await each dispatch
await ctx.dispatch('addPlayer', newPlayer)
await ctx.dispatch('updateWallet', clientId, amount)
```

Without await, each dispatch triggers independent endIf checks, and the thunk may continue dispatching into a phase it didn't start in.

### Immediate broadcast explains UI flicker

A thunk that dispatches three reducers produces three broadcasts, not one. Clients see intermediate states between dispatches. Phases with rapid sequential dispatches in onBegin can cause UI flicker.

### Direct storage manipulation bypasses protection

Calling `storage.updateSessionState()` directly bypasses VGF's protected regions. If it fires during onBegin/onEnd, it can corrupt state that the lifecycle hook is establishing.

### onBegin return value is deprecated

The RFC says onBegin should dispatch reducers, NOT return state. Learning 015 says onBegin MUST return GameState — this was correct for VGF 4.8.0 but is being deprecated. Future VGF versions will not use the return value.

## Red Flags

- `ctx.dispatch(...)` without `await` in any thunk
- Assuming state is unchanged after async yield in a thunk
- Direct storage mutation (bypasses buffering and state versioning)
- Heavy async work in onBegin/onEnd (blocks all external dispatches)
- Returning state from onBegin instead of dispatching reducers
- endPhase()/setPhase() called from onEnd

## Prevention

1. Grep for non-awaited `ctx.dispatch` calls: `grep -n 'ctx\.dispatch(' --include='*.ts' | grep -v 'await'`
2. Add ESLint rule to require await on ctx.dispatch in thunk functions.
3. Never call storage.updateSessionState() from application code — always go through VGF dispatch.
4. Keep onBegin/onEnd async work minimal — offload to thunks dispatched from onBegin.
