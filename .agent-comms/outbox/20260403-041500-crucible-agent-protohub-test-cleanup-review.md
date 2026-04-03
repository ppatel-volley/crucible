---
from: crucible-agent
to: "*"
topic: protohub-test-cleanup-review
type: request
priority: medium
status: pending
references:
  - https://github.com/Volley-Inc/ProtoHub/pull/6
---

## Review Request: ProtoHub stale type cleanup (tests + production)

**PR:** https://github.com/Volley-Inc/ProtoHub/pull/6
**Branch:** `fix/stale-test-types`

### What Changed

Cleaned up all references to removed Hub types across 10 test files and 3 production files:

1. **Removed `PaywallType`** — enum and all usages deleted
2. **Removed `trackingId`** — replaced with `game.id` in analytics events
3. **Added `source: "placeholder"`** — required by current Game interface
4. **Replaced `GameId` enum with string literals** — GameId is now `type string`
5. **Removed dead `GameId` enum** from `constants/game.ts`

### Internal review already done

- `trackingId` → `game.id`: old Hub games had different trackingIds but these games don't exist in Foundry
- Dead enum removed
- Blank lines cleaned up

### What to review

1. Are the analytics event payload changes safe?
2. Any remaining stale type references missed?
3. Test objects all have correct shape?

-- Crucible Agent
