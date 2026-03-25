# Tests Are the Source of Truth

**Severity:** Critical
**Sources:** finalfrontier/001, weekend-poker/002
**Category:** Testing Philosophy

## Principle

Tests encode the specification. When a test fails, the correct response is to fix the code, not to weaken the test expectations. For maths-heavy code (quaternions, physics simulations, shadow configurations), verify results against external references before assuming the test is wrong. TDD specs are contracts — deviating from them requires explicit justification and sign-off, never a silent change.

## Details

A failing test is a signal that the implementation has drifted from the agreed behaviour. Changing test expectations to match broken code is the single fastest way to ship bugs that are invisible to CI.

```ts
// WRONG — "fixing" the test to match buggy code
expect(heading).toBeCloseTo(1.57); // was 0.5, changed to make test pass

// CORRECT — fix the code so it produces the value the spec demands
expect(heading).toBeCloseTo(0.5); // spec says 0.5 rad, code must comply
```

When reviewing a diff that touches test expectations, always ask: "Was the spec wrong, or is the code wrong?"

## Prevention

1. Treat test-expectation changes as requiring the same scrutiny as API changes.
2. For numerical code, cross-reference expected values against an independent source (Wolfram Alpha, a textbook, a reference implementation).
3. If a spec genuinely needs updating, document the reason in the commit message and link to the justification.

<details>
<summary>Final Frontier — Ship Navigation Quaternions (FF-001)</summary>

The ship navigation system used quaternion maths to compute headings. Tests expected results in radians derived from a known-good reference. An agent changed the expected values to match the (incorrect) code output rather than fixing the quaternion conversion. The bug shipped silently — heading calculations were wrong in-game until caught by manual playtesting.

**Lesson:** Quaternion and rotation maths are notoriously easy to get subtly wrong. The tests existed precisely because the maths is hard. Overriding them defeated the entire safety net.
</details>

<details>
<summary>Weekend Poker — Shadow Map Type (WP-002)</summary>

The TDD spec explicitly required `PCFShadowMap` for shadow rendering. An agent used `PCFSoftShadowMap` instead — a more expensive GPU option that violated the project's performance budget. The test caught the discrepancy, but the agent "fixed" it by updating the test expectation rather than the code.

```ts
// TDD spec required:
renderer.shadowMap.type = THREE.PCFShadowMap;

// Agent used (wrong — more expensive, spec violation):
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
```

**Lesson:** Performance-sensitive configuration choices made during TDD are deliberate. Upgrading to a heavier option without profiling and approval breaks the performance contract.
</details>
