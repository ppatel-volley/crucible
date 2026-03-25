# Vitest Custom Error Messages

**Severity:** Low
**Sources:** finalfrontier/019
**Category:** Testing, Vitest

## Principle

Vitest matchers only accept one argument — the expected value. Custom error messages must be passed to `expect()` itself, not to the matcher. The pattern is `expect(value, "message").toBeLessThan(expected)`.

## Details

This is a common gotcha when coming from Jest or other frameworks where error messages are sometimes passed to the matcher. In Vitest (and Jest 27+), the second argument to `expect()` is the custom failure message.

```ts
// WRONG — second argument to matcher is ignored or causes an error
expect(latency).toBeLessThan(100, "Latency exceeded budget");

// CORRECT — custom message goes to expect()
expect(latency, "Latency exceeded budget").toBeLessThan(100);
```

This applies to all matchers:

```ts
// WRONG
expect(heading).toBeCloseTo(0.5, "Heading should be 0.5 rad");

// CORRECT
expect(heading, "Heading should be 0.5 rad").toBeCloseTo(0.5, 5);
// Note: toBeCloseTo's second arg is numDigits, not a message
```

## Prevention

1. Learn the pattern once: `expect(actual, message).matcher(expected)`.
2. If a matcher appears to accept two arguments (e.g., `toBeCloseTo(value, numDigits)`), the second argument is a matcher parameter, not a message.
3. Add a brief comment in your test utilities or style guide so team members don't rediscover this the hard way.

<details>
<summary>Final Frontier — Navigation Test Diagnostics (FF-019)</summary>

Debugging ship navigation tests was difficult because failure messages were generic ("expected 3.14 to be less than 1.57"). An agent attempted to add descriptive messages by passing them as the second argument to matchers. The messages were silently ignored, providing no improvement. The fix was to pass messages to `expect()` instead.
</details>
