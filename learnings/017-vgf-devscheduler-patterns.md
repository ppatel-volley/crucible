# VGF DevScheduler Evolution

**Severity:** Critical
**Sources:** emoji-multiplatform/009, emoji-multiplatform/013, emoji-multiplatform/027, emoji-multiplatform/029
**Category:** VGF, Server, Dev Mode, Scheduler

## Principle

VGF's `GameScheduler` is backed by Redis in production but becomes a NoOp in dev mode. Building a `DevScheduler` that properly replicates production behaviour requires careful integration with VGF's internal pipelines. The safest approach is to use the public API (`dispatchThunk`) with defensive phase transitions, rather than trying to route through framework internals.

## Details

This learning documents the full evolution of the DevScheduler, from initial discovery through three iterations of increasingly complex (and ultimately failed) internal integrations, culminating in a simple public-API solution.

### Stage 1: Discovery — scheduler is NoOp (EM-009)

In dev mode, all scheduler operations silently succeed but do nothing. Every timed transition — round timers, turn timeouts, countdown clocks — simply never fires.

```ts
// This registers fine but the callback never executes in dev mode
ctx.scheduler.schedule("roundTimer", 30000, () => {
  ctx.dispatchThunk(endRound);
});
```

**Initial fix:** `setTimeout` + `ctx.dispatchThunk()` as a fallback.

```ts
// Quick workaround
if (isDev) {
  setTimeout(() => {
    ctx.dispatchThunk(endRound);
  }, 30000);
} else {
  ctx.scheduler.schedule("roundTimer", 30000, () => {
    ctx.dispatchThunk(endRound);
  });
}
```

### Stage 2: Unified DevScheduler class (EM-013)

Extracted the fallback pattern into a proper class implementing the scheduler interface:

```ts
class DevScheduler implements IScheduler {
  private timers = new Map<string, NodeJS.Timeout>();

  schedule(key: string, delayMs: number, callback: () => void): void {
    this.cancel(key);
    this.timers.set(key, setTimeout(callback, delayMs));
  }

  cancel(key: string): void {
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }

  cancelAll(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}
```

Usage pattern:

```ts
const scheduler = services.scheduler ?? ctx.scheduler;
scheduler.schedule("roundTimer", 30000, () => {
  ctx.dispatchThunk(endRound);
});
```

### Stage 3: Attempted internal pipeline routing (EM-027)

Attempted to route DevScheduler callbacks through VGF's internal `onMessage` handler so that `endIf` would be evaluated after scheduler-triggered actions. This required accessing VGF internals:

```ts
// Accessing internal handlers — fragile and unsupported
const handlers = (server as any).partyTimeServer.sessionHandlers;
handlers.onMessage(syntheticConnection, JSON.stringify(message));
```

This appeared to work in simple cases but was fundamentally unreliable.

### Stage 4: Internal pipeline abandoned (EM-029)

The `onMessage` pipeline was fundamentally broken for synthetic messages. Multiple layers of failure:

| Issue | Description |
|-------|-------------|
| Synthetic connections | Could not replicate VGF's internal `Connection` object faithfully |
| Session resolution | VGF's internal session lookup failed for synthetic connections |
| Error swallowing | `Promise.resolve().catch()` pattern hid all errors |
| Async/sync mismatch | Internal handlers mixed async and sync error handling |
| Unhandled rejections | Promise rejections surfaced as Node warnings, not actionable errors |

**Final fix:** Removed all `onMessage` routing. DevScheduler callbacks use `dispatchThunk` exclusively, with defensive `SET_PHASE` dispatches to handle the `endIf` limitation (see learning 016):

```ts
class DevScheduler implements IScheduler {
  constructor(private dispatchThunk: (thunk: Thunk) => void) {}

  schedule(key: string, delayMs: number, thunk: Thunk): void {
    this.cancel(key);
    this.timers.set(key, setTimeout(() => {
      this.dispatchThunk(thunk);
    }, delayMs));
  }
  // ... cancel, cancelAll as before
}

// Thunks must handle their own phase transitions
const endRound = (ctx: IThunkContext) => {
  ctx.dispatch("setRoundComplete", {});
  ctx.dispatch("SET_PHASE", { phase: "scoring" });  // defensive — don't rely on endIf
};
```

## Prevention

1. **Use the public API:** Never route through VGF internals. `dispatchThunk` is the supported entry point for server-initiated actions.
2. **Defensive transitions:** Always pair scheduler-triggered state changes with explicit `SET_PHASE` dispatches, because `endIf` won't evaluate.
3. **Dev parity test:** Run the same game scenario in both dev and production modes. Any timed transition that works in production but not dev indicates a scheduler gap.
4. **Avoid `(server as any)`:** If you need to cast to `any` to access framework internals, the approach is wrong.

<details>
<summary>EM-009 Context</summary>

Round timers in the emoji quiz game never fired in dev mode. Players could sit on a question indefinitely. The only indication was the absence of the timeout — no error, no warning. Discovery came from reading VGF source and finding the NoOp scheduler implementation for non-Redis environments.

</details>

<details>
<summary>EM-013 Context</summary>

The ad-hoc `setTimeout` workarounds were scattered across multiple phase files with inconsistent cancellation logic. The DevScheduler class centralised all timer management and made the dev/production behaviour switchable via a single constructor parameter.

</details>

<details>
<summary>EM-027 Context</summary>

The motivation for routing through `onMessage` was that `endIf` was not evaluated after scheduler callbacks (see EM-024 / learning 016). The theory was that routing through the message pipeline would trigger the full dispatch-and-evaluate cycle. Accessing `(server as any).partyTimeServer.sessionHandlers` worked initially but proved fragile.

</details>

<details>
<summary>EM-029 Context</summary>

Testing revealed that synthetic connection objects caused VGF's session resolution to fail silently. The `Promise.resolve().catch()` pattern inside VGF swallowed the errors. Node process warnings about unhandled promise rejections were the only visible symptom. After two days of debugging, the entire approach was abandoned in favour of `dispatchThunk` with defensive `SET_PHASE` dispatches.

</details>
