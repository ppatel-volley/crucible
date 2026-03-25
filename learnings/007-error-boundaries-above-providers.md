# Error Boundaries Above Providers

**Severity:** High
**Sources:** emoji-multiplatform/004
**Category:** React, Architecture

## Principle

React error boundaries only catch errors thrown by their children, not by themselves or their siblings. If a context provider throws during initialisation or rendering, an error boundary placed *below* it (as its child) will never catch the error. Place error boundaries *above* any provider that might throw.

## Details

A common architectural mistake is wrapping the app content in an error boundary while leaving providers outside (above) it:

```tsx
// WRONG — error boundary cannot catch errors from GameProvider
function App() {
  return (
    <GameProvider>       {/* if this throws, nothing catches it */}
      <ErrorBoundary>
        <GameUI />
      </ErrorBoundary>
    </GameProvider>
  );
}
```

```tsx
// CORRECT — error boundary wraps the provider
function App() {
  return (
    <ErrorBoundary>
      <GameProvider>     {/* errors here are caught by the boundary above */}
        <GameUI />
      </GameProvider>
    </ErrorBoundary>
  );
}
```

This applies to all providers: state management, theming, authentication, feature flags. Any provider that performs computation in its render path (API calls, complex initialisation, data parsing) can throw.

## Prevention

1. Place the outermost error boundary at the very top of the component tree, above all providers.
2. For granular error handling, nest multiple error boundaries — but ensure each provider has a boundary above it, not just below.
3. During architecture review, trace the component tree from the root: every provider should have an error boundary ancestor.
4. Test error scenarios by temporarily making providers throw — verify that the fallback UI actually appears.

<details>
<summary>Emoji Multiplatform — Provider Crash Went Uncaught (EM-004)</summary>

The app's `GameConfigProvider` performed validation during render. When it received invalid configuration data, it threw an error. The error boundary was placed inside the provider (wrapping the game UI), so the provider's own error was never caught. The app showed a white screen with no fallback UI. Moving the error boundary above the provider resolved the issue and displayed the expected error state.
</details>
