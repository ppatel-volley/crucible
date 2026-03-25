# Scale-Dependent Test Values

**Severity:** Medium
**Sources:** finalfrontier/009
**Category:** Testing

## Principle

Tests with hardcoded values derived from constants break when those constants change. Always express expected values as computations against the actual source constant, not as magic numbers. If a test asserts `toBe(5)` when the real contract is "half of max speed", the test is encoding the wrong thing.

## Details

Hardcoded expected values create a hidden coupling to a specific constant value. When the constant changes (as it inevitably will during balancing or tuning), every downstream test breaks — and the failure message gives no indication of *why* the value was 5 in the first place.

```ts
// WRONG — magic number derived from maxImpulseSpeed = 10
expect(ship.getCurrentSpeed()).toBe(5);

// CORRECT — expresses the actual contract
expect(ship.getCurrentSpeed()).toBe(ship.maxImpulseSpeed * 0.5);
```

The correct version survives any change to `maxImpulseSpeed` (e.g., 10 to 10,000) without modification, because it tests the *relationship*, not a snapshot of the arithmetic.

## Prevention

1. When writing a test assertion, ask: "Is this number a literal requirement, or is it derived from something?" If derived, express the derivation.
2. Import or reference the same constants the production code uses.
3. If a PR has a hardcoded number in a test expectation, request the derivation in code review.
4. For physics/game-balance values that change frequently, consider storing tuning constants in a single config object and referencing it from tests.

<details>
<summary>Final Frontier — maxImpulseSpeed Rebalance (FF-009)</summary>

During a ship-balancing pass, `maxImpulseSpeed` was changed from 10 to 10,000. Multiple tests broke because they had hardcoded values like `toBe(5)` (half speed), `toBe(10)` (full speed), and `toBe(2.5)` (quarter speed). Each failure required tracing back to understand what relationship the number represented. Had the tests been written as `toBe(ship.maxImpulseSpeed * 0.5)`, the rebalance would have required zero test changes.
</details>
