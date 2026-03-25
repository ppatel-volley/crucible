# Playwright Cross-Page Locators

**Severity:** Critical
**Sources:** weekend-poker/013
**Category:** E2E Testing, Playwright

## Principle

Playwright's `.or()` combinator only works with locators from the same `Page` object. Cross-page `.or()` silently produces incorrect results — it does not throw an error. For multi-player or multi-page test scenarios, assert on each page separately rather than combining locators across pages.

## Details

The `.or()` method on a Playwright `Locator` is designed to match one of several possible elements on a single page. When you accidentally combine locators from different `Page` objects, Playwright does not warn you. The combined locator silently evaluates against only one of the pages, leading to flaky or outright wrong test results.

```ts
// WRONG — cross-page .or() silently produces incorrect results
const player1Wins = page1.getByText("You win!");
const player2Wins = page2.getByText("You win!");
await expect(player1Wins.or(player2Wins)).toBeVisible(); // BROKEN

// CORRECT — assert on each page independently
const result = await Promise.race([
  page1.getByText("You win!").waitFor().then(() => "player1"),
  page2.getByText("You win!").waitFor().then(() => "player2"),
]);
expect(["player1", "player2"]).toContain(result);
```

Alternatively, if you need to check that exactly one player wins:

```ts
// CORRECT — separate assertions per page
const [p1Visible, p2Visible] = await Promise.all([
  page1.getByText("You win!").isVisible(),
  page2.getByText("You win!").isVisible(),
]);
expect(p1Visible || p2Visible).toBe(true);
expect(p1Visible && p2Visible).toBe(false); // exactly one winner
```

## Prevention

1. Never combine locators from different `Page` objects with `.or()`, `.and()`, or any other combinator.
2. In multi-page test utilities, accept a single `Page` parameter and create all locators from it.
3. Add a lint rule or code-review checklist item for multi-player test files: "Are all locators in a chain from the same page?"
4. When a multi-player test is flaky, check for cross-page locator mixing first.

<details>
<summary>Weekend Poker — Multi-Player Game End Detection (WP-013)</summary>

A Playwright test for the poker game needed to detect which player won a hand. The test combined locators from `player1Page` and `player2Page` using `.or()`, expecting Playwright to watch both pages simultaneously. Instead, the assertion silently evaluated against only one page, causing the test to pass or fail depending on timing. The fix was to use `Promise.race` with separate `waitFor()` calls on each page.
</details>
