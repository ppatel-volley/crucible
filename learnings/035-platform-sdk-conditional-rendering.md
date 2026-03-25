# Platform SDK Conditional Rendering

**Severity:** Critical
**Sources:** emoji-multiplatform/019
**Category:** Platform SDK, Dev Mode

## Principle

When a platform SDK throws during construction (not initialisation) if required URL parameters are missing, conditionally render the provider based on platform detection. Replace SDK-specific hooks with local wrappers using standard DOM events — they often work identically because the SDK maps platform inputs to standard events.

## Details

Some platform SDKs are designed to run only in their target environment (e.g. a TV shell) and throw immediately during construction if required environment parameters are missing. This is not a runtime error you can catch and recover from — it happens during module evaluation or component mounting.

### The problem

```tsx
// WRONG — PlatformProvider throws if volley_hub_session_id is missing from URL
// This param is only provided by the TV shell, never in dev/web
function App() {
  return (
    <PlatformProvider> {/* throws in dev mode */}
      <Game />
    </PlatformProvider>
  );
}
```

### Conditional rendering based on platform

```tsx
const isTV = new URLSearchParams(window.location.search).has("volley_hub_session_id");

function App() {
  if (isTV) {
    return (
      <PlatformProvider>
        <Game />
      </PlatformProvider>
    );
  }
  return <Game />; // dev/web mode — no SDK wrapper
}
```

### Replacing SDK hooks with local wrappers

Platform SDK hooks like `useKeyDown` or `useMicrophone` often simply map platform-specific inputs to standard DOM events. When running outside the platform, replace them with local wrappers that use the same standard events directly.

```ts
// SDK hook — only works inside PlatformProvider
import { useKeyDown } from "@platform/sdk";

// Local wrapper — works everywhere
function useKeyDown(key: string, handler: () => void) {
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (e.key === key) handler();
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [key, handler]);
}
```

The local wrapper often has identical behaviour because the SDK itself listens for the same DOM events internally — it just adds platform-specific telemetry or input normalisation.

## Prevention

1. **Platform detection at app root:** Detect the target platform once at the top level and conditionally render SDK providers.
2. **Local hook wrappers:** For every SDK hook used, write a local wrapper that uses standard DOM APIs. Import from a central `hooks/platform.ts` file that switches between SDK and local implementations based on platform.
3. **Dev mode smoke test:** The dev server must boot and render the full app without any platform SDK. If it throws, the conditional rendering is missing or broken.
4. **Never import SDK hooks directly in components.** Always import from the local wrapper module so the switch is centralised.

<details>
<summary>EM-019 — PlatformProvider Crash in Dev Mode</summary>

`PlatformProvider` from the TV platform SDK threw during construction if `volley_hub_session_id` was not present in the URL query parameters. This parameter is injected by the TV shell and is never present in development or web browser environments. The app could not render at all in dev mode. The fix was conditionally rendering `PlatformProvider` only when the URL parameter was present. Additionally, `useKeyDown` and `useMicrophone` from the SDK were replaced with local wrappers using `window.addEventListener("keydown", ...)` and `navigator.mediaDevices.getUserMedia()` respectively. The local wrappers worked identically because the SDK internally used the same DOM APIs.

</details>
