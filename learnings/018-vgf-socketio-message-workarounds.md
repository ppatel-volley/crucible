# VGF Socket.IO Message Handling Workarounds

**Severity:** Critical
**Sources:** emoji-multiplatform/008, emoji-multiplatform/017, emoji-multiplatform/023
**Category:** VGF, Socket.IO, React

## Principle

VGF's `socket.on("message")` handler can be lost after disconnect/reconnect cycles, especially with React 18 StrictMode. The `onAny` workaround must be applied to ALL VGF clients, not just the display. The `onAny` callback signature is `(eventName, ...data)`, not `(...data)` — the first argument is the event name string, not the payload.

## Details

### The core problem (EM-008)

VGF's `disconnect()` method calls `removeAllListeners()`, which wipes the `"message"` event handler. React 18 StrictMode triggers a mount-cleanup-remount cycle in development:

1. Component mounts — `socket.on("message", handler)` registered
2. StrictMode cleanup — `disconnect()` called — `removeAllListeners()` wipes handler
3. Component remounts — `connect()` called but `"message"` handler is NOT re-registered

The `onAny` listener survives because Socket.IO stores `_anyListeners` separately from named event listeners. `removeAllListeners()` only clears named listeners.

```ts
// BAD — handler lost after StrictMode remount
socket.on("message", (data) => {
  handleStateUpdate(data);
});

// GOOD — onAny survives removeAllListeners()
socket.onAny((eventName, ...data) => {
  if (eventName === "message") {
    handleStateUpdate(data[0]);
  }
});
```

### The callback signature trap (EM-017)

`socket.onAny()` passes the event name as the first argument. A common mistake is treating all arguments as data:

```ts
// BAD — args[0] is the event name string, not the data
socket.onAny((...args) => {
  const message = args[0];
  console.log(message.type);  // undefined — "message".type is undefined
});

// GOOD — destructure properly
socket.onAny((eventName, ...data) => {
  if (eventName === "message") {
    const message = data[0];
    console.log(message.type);  // works correctly
  }
});
```

| Argument position | `socket.on("message", ...)` | `socket.onAny(...)` |
|-------------------|---------------------------|-------------------|
| First arg | Message data | Event name (`"message"`) |
| Second arg | N/A | Message data |
| Third arg | N/A | Additional data (rare) |

### All clients need the workaround (EM-023)

The display client had the `onAny` workaround applied, but the controller client did not. The controller appeared to work during gameplay because:

- Initial state arrived via the handshake (not the `"message"` event)
- Player-initiated dispatches received responses through the dispatch acknowledgement

But server-triggered state changes (phase transitions, timer updates, other players' actions) were never received by the controller. The controller was effectively blind to any state change it didn't initiate.

```ts
// Must be applied to EVERY VGF client
const applyMessageWorkaround = (socket: Socket) => {
  socket.onAny((eventName: string, ...data: unknown[]) => {
    if (eventName === "message") {
      socket.emit("message", data[0]);  // re-emit on the named channel
    }
  });
};

// Apply to display
applyMessageWorkaround(displaySocket);
// Apply to controller — easy to forget!
applyMessageWorkaround(controllerSocket);
```

## Prevention

1. **Shared utility:** Create a single `applyVGFWorkaround(socket)` function and call it for every socket instance in the project. Never inline the workaround.
2. **Checklist:** When adding a new client type, the workaround application must be part of the setup checklist.
3. **Test both clients:** Integration tests must verify that both display and controller receive server-initiated state updates (not just handshake state).
4. **StrictMode testing:** Always develop with React StrictMode enabled to catch listener lifecycle issues early.

<details>
<summary>EM-008 Context</summary>

The display client stopped receiving state updates after React StrictMode's cleanup-remount cycle. The socket appeared connected (no errors, handshake succeeded) but the `"message"` handler was gone. Hours of debugging network traffic and server logs yielded nothing because the issue was purely client-side listener management. The `onAny` workaround was discovered by reading Socket.IO source code and noticing that `_anyListeners` is stored in a separate array.

</details>

<details>
<summary>EM-017 Context</summary>

After applying the `onAny` workaround, state updates were still not processed. The bug was in the callback: `(...args) => { if (args[0]?.type === "stateUpdate") }` — but `args[0]` was the string `"message"`, not the data payload. The fix was destructuring `(eventName, ...data)` and checking `eventName === "message"` separately.

</details>

<details>
<summary>EM-023 Context</summary>

The display showed all state transitions correctly, but the controller was stuck showing stale state. It appeared to work because button presses still dispatched actions (and the display updated), but the controller never reflected other players' actions or server-triggered transitions. The root cause was that the `onAny` workaround had only been applied to the display socket, not the controller socket.

</details>
