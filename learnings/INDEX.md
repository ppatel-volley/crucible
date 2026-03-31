# Learnings Index

> **Before starting work, check this index for relevant learnings to avoid repeating past mistakes.**
>
> Amalgamated from four game projects: **finalfrontier** (FF), **weekend-poker** (WP), **emoji-multiplatform** (EM), and **TokenRaider** (TR).
> Duplicates have been merged. Each learning contains a generalised principle plus project-specific context.

---

## Quick Reference by Task Type

| Task Type | Relevant Learnings |
|---|---|
| Writing or fixing tests | [001](./001-tests-are-source-of-truth.md), [003](./003-scale-dependent-test-values.md), [005](./005-vitest-custom-error-messages.md) |
| Build failures / TypeScript errors | [002](./002-vitest-is-not-enough.md), [008](./008-r3f-react19-reconciler.md) |
| E2E / Playwright tests | [004](./004-playwright-cross-page-locators.md) |
| React components / hooks | [006](./006-useref-usememo-closure-capture.md), [007](./007-error-boundaries-above-providers.md) |
| React Three Fibre / R3F | [006](./006-useref-usememo-closure-capture.md), [008](./008-r3f-react19-reconciler.md), [021](./021-threejs-line-rendering.md) |
| State management / reducers | [009](./009-reducer-purity.md), [010](./010-dispatch-name-mismatch.md), [011](./011-backwards-compatible-module-replacement.md) |
| Wallet / currency / chips | [012](./012-wallet-floor-of-zero.md) |
| JavaScript operators | [013](./013-nullish-coalescing-precedence.md) |
| VGF client setup | [014](./014-vgf-transport-sessions-setup.md) |
| VGF phases / transitions | [015](./015-vgf-phase-callback-contexts.md), [016](./016-vgf-endif-cascade-limitations.md), [019](./019-vgf-480-phase-transitions.md), [047](./047-vgf-rfc-predictable-state-processing.md), [048](./048-bot-auto-actions-in-onbegin.md) |
| VGF timers / schedulers | [017](./017-vgf-devscheduler-patterns.md), [032](./032-timer-management-patterns.md) |
| VGF Socket.IO issues | [018](./018-vgf-socketio-message-workarounds.md) |
| VGF dev mode | [014](./014-vgf-transport-sessions-setup.md), [017](./017-vgf-devscheduler-patterns.md), [020](./020-vgf-dev-session-lifecycle.md), [042](./042-dev-server-port-conflicts.md) |
| VGF 4.8.0+ migration | [019](./019-vgf-480-phase-transitions.md), [049](./049-vgf-project-scaffolding.md) |
| Three.js rendering | [021](./021-threejs-line-rendering.md), [022](./022-webgl-shader-uniforms.md) |
| Shaders / GLSL | [022](./022-webgl-shader-uniforms.md), [023](./023-shader-coordinate-space-lighting.md), [024](./024-ring-shadow-ray-sphere-intersection.md), [025](./025-star-lighting-and-corona.md) |
| Lighting | [023](./023-shader-coordinate-space-lighting.md), [025](./025-star-lighting-and-corona.md) |
| Scale / size / distance systems | [026](./026-visual-scale-system-cascade.md), [003](./003-scale-dependent-test-values.md) |
| Navigation / movement | [027](./027-angular-units-consistency.md), [028](./028-high-speed-navigation-deceleration.md) |
| Camera | [026](./026-visual-scale-system-cascade.md) |
| Security fixes | [029](./029-close-all-security-paths.md) |
| Audio / microphone / speech-to-text | [030](./030-browser-to-deepgram-audio.md) |
| Voice commands | [031](./031-voice-parse-and-routing.md) |
| Timer / countdown logic | [032](./032-timer-management-patterns.md) |
| SVG / CSS animation | [033](./033-svg-countdown-ring-animation.md) |
| Controller / companion screen | [034](./034-controller-phase-handling.md) |
| Platform SDK / TV deployment | [035](./035-platform-sdk-conditional-rendering.md) |
| Emoji / QR code display | [036](./036-emoji-qr-rendering.md) |
| Code review / PR process | [037](./037-pr-review-codebase-scan.md) |
| Procedural generation | [038](./038-procedural-generation-clustering.md) |
| User communication | [039](./039-verify-before-communicating.md) |
| Retention / achievements / challenges | [040](./040-retention-system-integration.md) |
| Refactoring / DRY | [041](./041-shared-helper-extraction.md) |
| Dev server / port conflicts | [042](./042-dev-server-port-conflicts.md) |
| Analytics / tracking | [043](./043-segment-analytics-integration.md) |
| Session disconnect / cleanup | [044](./044-dual-disconnect-session-cleanup-race.md) |
| Redis / infrastructure | [045](./045-redis-client-consolidation.md) |
| Docker / deployment | [046](./046-docker-container-security-checklist.md) |
| VGF state processing RFC | [047](./047-vgf-rfc-predictable-state-processing.md) |
| Bot logic / auto-actions | [048](./048-bot-auto-actions-in-onbegin.md) |
| VGF project scaffolding | [049](./049-vgf-project-scaffolding.md) |
| Multi-agent / parallel work | [002](./002-vitest-is-not-enough.md), [029](./029-close-all-security-paths.md) |
| Module replacement / migration | [011](./011-backwards-compatible-module-replacement.md) |
| Game economy / rewards | [012](./012-wallet-floor-of-zero.md), [040](./040-retention-system-integration.md) |

---

## By Category

### Testing & Build Verification

| # | Title | Severity | Sources |
|---|---|---|---|
| [001](./001-tests-are-source-of-truth.md) | Tests Are Source of Truth | Critical | FF-001, WP-002 |
| [002](./002-vitest-is-not-enough.md) | Vitest Is Not Enough — Typecheck and Build Are Mandatory | Critical | WP-007, EM-001 |
| [003](./003-scale-dependent-test-values.md) | Scale-Dependent Test Values | Medium | FF-009 |
| [004](./004-playwright-cross-page-locators.md) | Playwright Cross-Page Locators | Critical | WP-013 |
| [005](./005-vitest-custom-error-messages.md) | Vitest Custom Error Messages | Low | FF-019 |

### React Patterns

| # | Title | Severity | Sources |
|---|---|---|---|
| [006](./006-useref-usememo-closure-capture.md) | useRef + useMemo Closure Capture | Critical | WP-001 |
| [007](./007-error-boundaries-above-providers.md) | Error Boundaries Above Providers | High | EM-004 |
| [008](./008-r3f-react19-reconciler.md) | R3F + React 19 Reconciler Incompatibility | Critical | WP-005 |

### State Management

| # | Title | Severity | Sources |
|---|---|---|---|
| [009](./009-reducer-purity.md) | Reducer Purity — No Date.now() or Math.random() | High | EM-010, EM-026 |
| [010](./010-dispatch-name-mismatch.md) | Dispatch Names Must Match Registration | Critical | WP-006 |
| [011](./011-backwards-compatible-module-replacement.md) | Backwards-Compatible Module Replacement | High | WP-003 |
| [012](./012-wallet-floor-of-zero.md) | Wallet and Stack Floor-of-Zero Guards | Critical | WP-004 |
| [013](./013-nullish-coalescing-precedence.md) | Nullish Coalescing Precedence | Medium | WP-014 |

### VGF Framework

| # | Title | Severity | Sources |
|---|---|---|---|
| [014](./014-vgf-transport-sessions-setup.md) | Transport, Sessions, and Client Setup | Critical | EM-002, 003, 005, 014, 021 |
| [015](./015-vgf-phase-callback-contexts.md) | Phase Callback Contexts | Critical | WP-009, EM-016 |
| [016](./016-vgf-endif-cascade-limitations.md) | endIf Cascade Limitations | Critical | EM-015, 020, 024, WP-021 |
| [017](./017-vgf-devscheduler-patterns.md) | DevScheduler Evolution | Critical | EM-009, 013, 027, 029 |
| [018](./018-vgf-socketio-message-workarounds.md) | Socket.IO Message Workarounds | Critical | EM-008, 017, 023 |
| [019](./019-vgf-480-phase-transitions.md) | 4.8.0 Phase Transition Rules | Critical | EM-038, EM-042 |
| [020](./020-vgf-dev-session-lifecycle.md) | Dev Session Lifecycle | High | EM-022 |
| [047](./047-vgf-rfc-predictable-state-processing.md) | RFC — Predictable State Processing | Critical | WP-020 |
| [048](./048-bot-auto-actions-in-onbegin.md) | Bot Auto-Actions in onBegin | High | WP-022 |
| [049](./049-vgf-project-scaffolding.md) | Project Scaffolding (0-to-1) | Critical | TR-043 |

### Three.js & Shaders

| # | Title | Severity | Sources |
|---|---|---|---|
| [021](./021-threejs-line-rendering.md) | Line Rendering and Memoisation | Medium | FF-003 |
| [022](./022-webgl-shader-uniforms.md) | WebGL Shader Uniforms — Always Use Float | High | FF-013 |
| [023](./023-shader-coordinate-space-lighting.md) | Shader Coordinate Space and Lighting | High | FF-014, FF-015 |
| [024](./024-ring-shadow-ray-sphere-intersection.md) | Ring Shadow via Ray-Sphere Intersection | Medium | FF-016 |
| [025](./025-star-lighting-and-corona.md) | Star Lighting and Corona Billboard | High | FF-017, FF-018 |

### Scale & Visual Systems

| # | Title | Severity | Sources |
|---|---|---|---|
| [026](./026-visual-scale-system-cascade.md) | Visual Scale System and Cascade Effects | High | FF-004, 005, 006, 007, 008 |

### Navigation & Physics

| # | Title | Severity | Sources |
|---|---|---|---|
| [027](./027-angular-units-consistency.md) | Angular Units Consistency | High | FF-002 |
| [028](./028-high-speed-navigation-deceleration.md) | High-Speed Navigation and Deceleration | High | FF-010 |

### Security

| # | Title | Severity | Sources |
|---|---|---|---|
| [029](./029-close-all-security-paths.md) | Security Fixes Must Close ALL Paths | Critical | WP-008 |

### Audio & Speech

| # | Title | Severity | Sources |
|---|---|---|---|
| [030](./030-browser-to-deepgram-audio.md) | Browser-to-Deepgram Audio Streaming | Critical | EM-006, EM-007 |
| [031](./031-voice-parse-and-routing.md) | Voice Intents Need Parsing AND Routing | Critical | WP-012 |

### Timer Management

| # | Title | Severity | Sources |
|---|---|---|---|
| [032](./032-timer-management-patterns.md) | Timer Management Patterns | High | EM-025, 032, 035, 036 |

### UI & Animation

| # | Title | Severity | Sources |
|---|---|---|---|
| [033](./033-svg-countdown-ring-animation.md) | SVG Countdown Ring Animation | Medium | EM-034, EM-037 |
| [034](./034-controller-phase-handling.md) | Controller Must Handle All Game Phases | High | EM-030 |
| [035](./035-platform-sdk-conditional-rendering.md) | Platform SDK Conditional Rendering | Critical | EM-019 |
| [036](./036-emoji-qr-rendering.md) | Emoji and QR Code Rendering Pitfalls | High | EM-012, EM-018 |

### Architecture & Process

| # | Title | Severity | Sources |
|---|---|---|---|
| [037](./037-pr-review-codebase-scan.md) | PR Review Must Trigger Codebase-Wide Scan | High | EM-031, EM-033, EM-041 |
| [038](./038-procedural-generation-clustering.md) | Procedural Generation Clustering Prevention | Medium | FF-011 |
| [039](./039-verify-before-communicating.md) | Verify UI Details Before Communicating | Medium | FF-012 |
| [040](./040-retention-system-integration.md) | Retention System Integration | Critical | WP-010, WP-011 |
| [041](./041-shared-helper-extraction.md) | Shared Helper Extraction | Medium | EM-028 |
| [042](./042-dev-server-port-conflicts.md) | Dev Server Port Conflicts | High | EM-011 |
| [043](./043-segment-analytics-integration.md) | Segment Analytics Integration Patterns | High | EM-039 |
| [044](./044-dual-disconnect-session-cleanup-race.md) | Dual Disconnect Session Cleanup Race | High | EM-040 |

### Infrastructure & DevOps

| # | Title | Severity | Sources |
|---|---|---|---|
| [045](./045-redis-client-consolidation.md) | Redis Client Consolidation | High | WP-018 |
| [046](./046-docker-container-security-checklist.md) | Docker Container Security Checklist | High | WP-019 |

---

## Cross-Reference by Topic

| Topic | Learnings |
|---|---|
| `useMemo` / `useCallback` closures | 006 |
| `useRef` stale references | 006 |
| Error boundaries | 007 |
| React 19 compatibility | 008 |
| React Three Fibre / R3F | 006, 008, 021 |
| `react-reconciler` | 008 |
| Vitest limitations | 002, 005 |
| TypeScript strict checking | 002 |
| Build pipeline verification | 002 |
| Multi-agent merge failures | 002, 029 |
| `vi.mock` factory sync | 002 |
| Playwright multi-page | 004 |
| Reducer purity | 009 |
| `Date.now()` in reducers | 009 |
| Dispatch name mismatch | 010 |
| `DispatchTimeoutError` | 010 |
| Module replacement / aliasing | 011 |
| Backwards compatibility | 011 |
| Wallet integrity | 012 |
| Chip floor-of-zero | 012 |
| `??` operator precedence | 013 |
| VGF transport defaults | 014 |
| VGF session creation | 014, 020 |
| `useStateSync` empty state | 014 |
| `socketOptions.query` clobbering | 014 |
| VGF phase callbacks | 015 |
| `reducerDispatcher` vs `dispatch` | 015 |
| `onBegin` must return state | 015 |
| `endIf` cascade | 016 |
| `endIf` not evaluated after scheduler | 016, 017 |
| Phase transition context shape | 016 |
| `DevScheduler` | 017 |
| NoOp scheduler in dev mode | 017 |
| `onMessage` pipeline routing | 017 |
| Unhandled promise rejections | 017 |
| Socket.IO `removeAllListeners` | 018 |
| `onAny` callback signature | 018 |
| React StrictMode + VGF | 018 |
| `PhaseModificationError` | 019 |
| `nextPhase` + `TRANSITION_TO_PHASE` | 019 |
| `WGFServer` lifecycle gaps | 019 |
| Dev session timeout/deletion | 020 |
| `MemoryStorage` session loss | 020 |
| Three.js `<primitive>` memoisation | 021 |
| `<line>` vs `<Line>` | 021 |
| Shader `uniform int` failures | 022 |
| WebGL 1.0 integer support | 022 |
| Coordinate space mismatch | 023 |
| `normalMatrix` vs `modelMatrix` | 023 |
| Bump normal blending | 023 |
| Terminator lighting | 023 |
| Ray-sphere intersection | 024 |
| Shadow sharpness | 024 |
| Star point light | 025 |
| Billboard shader | 025 |
| Corona UV calculations | 025 |
| Scale constants cascade | 026 |
| Collision vs visual radii | 026 |
| Camera frustum culling | 026 |
| Lerp smoothing scale sensitivity | 026 |
| Radians vs degrees | 027 |
| `Math.cos` / `Math.sin` input | 027 |
| High-speed overshoot | 028 |
| Physics-based deceleration | 028 |
| Additive-only security fixes | 029 |
| Negative security tests | 029 |
| Phase config reducer exposure | 029 |
| Deepgram streaming | 030 |
| AudioContext user gesture | 030 |
| `EADDRINUSE` on watch restart | 030, 042 |
| Voice intent parsing | 031 |
| `processVoiceCommand` routing | 031 |
| Timer expired → do nothing = stuck | 032 |
| `timerStartedAt` must pair with schedule | 032 |
| Transient states vs true pause | 032 |
| SVG `strokeDashoffset` animation | 033 |
| CSS transition two-phase render | 033 |
| Inline style vs SVG attribute cascade | 033 |
| Controller phase-based UI | 034 |
| Exhaustive phase handling | 034 |
| Platform SDK URL params | 035 |
| Conditional provider rendering | 035 |
| `Intl.Segmenter` / grapheme clusters | 036 |
| Canvas rendering with `useCallback` ref | 036 |
| PR review bot findings | 037 |
| `!` on optional fields | 037 |
| Symmetric handler functions | 037 |
| Dead code after feature removal | 037 |
| Clustering prevention | 038 |
| Probability distributions | 038 |
| Keybinding verification | 039 |
| Persistence pipeline completeness | 040 |
| Contract-first development | 040 |
| Session-scoped module state | 040 |
| Calendar maths | 040 |
| Time-bounded vs lifetime stats | 040 |
| DRY extraction threshold | 041 |
| Bypass trap — missing side effects | 041 |
| `tsx watch` port release | 042 |
| Segment analytics | 043 |
| `closeAndFlush` destroys client | 043 |
| React StrictMode + analytics init | 043 |
| Dead code tracking | 037, 043 |
| FTUE path bypasses | 043 |
| Dual disconnect race | 044 |
| Module-level Set/Map in tests | 044 |
| Per-session cleanup flag | 044 |
| Redis client consolidation | 045 |
| Dependency injection (Redis) | 045 |
| Docker non-root USER | 046 |
| Readiness vs liveness health check | 046 |
| BuildKit secrets | 046 |
| `hadolint` / image scanning | 046 |
| VGF RFC state processing | 047 |
| `await ctx.dispatch` in thunks | 047 |
| Immediate broadcast (3 dispatches = 3 broadcasts) | 047 |
| Direct storage manipulation bypass | 047 |
| `onBegin` return value deprecated | 015, 047 |
| Bot auto-actions | 048 |
| `.every()` endIf with bots | 048 |
| VGF project scaffolding | 049 |
| `[key: string]: unknown` index signature | 049 |
| VGF subpath imports | 049 |
| `DispatchTimeoutError` expected (WGFServer) | 010, 049 |
| `MaybePlatformProvider` pattern | 035, 049 |
| Stale `nextPhase` infinite oscillation | 019 |
| `CLEAR_NEXT_PHASE` in onBegin | 019 |
| `endIf` before `onBegin` on re-entry | 016 |
| `resetPhaseFlags` reducer | 016 |
| Bot review false positives | 037 |

---

## Source Mapping

Every original learning mapped to its amalgamated file:

### finalfrontier (19 → 10 files)

| Original | Amalgamated |
|---|---|
| FF-001 | [001](./001-tests-are-source-of-truth.md) |
| FF-002 | [027](./027-angular-units-consistency.md) |
| FF-003 | [021](./021-threejs-line-rendering.md) |
| FF-004 | [026](./026-visual-scale-system-cascade.md) |
| FF-005 | [026](./026-visual-scale-system-cascade.md) |
| FF-006 | [026](./026-visual-scale-system-cascade.md) |
| FF-007 | [026](./026-visual-scale-system-cascade.md) |
| FF-008 | [026](./026-visual-scale-system-cascade.md) |
| FF-009 | [003](./003-scale-dependent-test-values.md) |
| FF-010 | [028](./028-high-speed-navigation-deceleration.md) |
| FF-011 | [038](./038-procedural-generation-clustering.md) |
| FF-012 | [039](./039-verify-before-communicating.md) |
| FF-013 | [022](./022-webgl-shader-uniforms.md) |
| FF-014 | [023](./023-shader-coordinate-space-lighting.md) |
| FF-015 | [023](./023-shader-coordinate-space-lighting.md) |
| FF-016 | [024](./024-ring-shadow-ray-sphere-intersection.md) |
| FF-017 | [025](./025-star-lighting-and-corona.md) |
| FF-018 | [025](./025-star-lighting-and-corona.md) |
| FF-019 | [005](./005-vitest-custom-error-messages.md) |

### weekend-poker (22 → 17 files)

| Original | Amalgamated |
|---|---|
| WP-001 | [006](./006-useref-usememo-closure-capture.md) |
| WP-002 | [001](./001-tests-are-source-of-truth.md) |
| WP-003 | [011](./011-backwards-compatible-module-replacement.md) |
| WP-004 | [012](./012-wallet-floor-of-zero.md) |
| WP-005 | [008](./008-r3f-react19-reconciler.md) |
| WP-006 | [010](./010-dispatch-name-mismatch.md) |
| WP-007 | [002](./002-vitest-is-not-enough.md) |
| WP-008 | [029](./029-close-all-security-paths.md) |
| WP-009 | [015](./015-vgf-phase-callback-contexts.md) |
| WP-010 | [040](./040-retention-system-integration.md) |
| WP-011 | [040](./040-retention-system-integration.md) |
| WP-012 | [031](./031-voice-parse-and-routing.md) |
| WP-013 | [004](./004-playwright-cross-page-locators.md) |
| WP-014 | [013](./013-nullish-coalescing-precedence.md) |
| WP-015 | [019](./019-vgf-480-phase-transitions.md) |
| WP-016 | [029](./029-close-all-security-paths.md) |
| WP-017 | [018](./018-vgf-socketio-message-workarounds.md) |
| WP-018 | [045](./045-redis-client-consolidation.md) |
| WP-019 | [046](./046-docker-container-security-checklist.md) |
| WP-020 | [047](./047-vgf-rfc-predictable-state-processing.md) |
| WP-021 | [016](./016-vgf-endif-cascade-limitations.md) |
| WP-022 | [048](./048-bot-auto-actions-in-onbegin.md) |

### emoji-multiplatform (42 → 24 files)

| Original | Amalgamated |
|---|---|
| EM-001 | [002](./002-vitest-is-not-enough.md) |
| EM-002 | [014](./014-vgf-transport-sessions-setup.md) |
| EM-003 | [014](./014-vgf-transport-sessions-setup.md) |
| EM-004 | [007](./007-error-boundaries-above-providers.md) |
| EM-005 | [014](./014-vgf-transport-sessions-setup.md) |
| EM-006 | [030](./030-browser-to-deepgram-audio.md) |
| EM-007 | [030](./030-browser-to-deepgram-audio.md) |
| EM-008 | [018](./018-vgf-socketio-message-workarounds.md) |
| EM-009 | [017](./017-vgf-devscheduler-patterns.md) |
| EM-010 | [009](./009-reducer-purity.md) |
| EM-011 | [042](./042-dev-server-port-conflicts.md) |
| EM-012 | [036](./036-emoji-qr-rendering.md) |
| EM-013 | [017](./017-vgf-devscheduler-patterns.md) |
| EM-014 | [014](./014-vgf-transport-sessions-setup.md) |
| EM-015 | [016](./016-vgf-endif-cascade-limitations.md) |
| EM-016 | [015](./015-vgf-phase-callback-contexts.md) |
| EM-017 | [018](./018-vgf-socketio-message-workarounds.md) |
| EM-018 | [036](./036-emoji-qr-rendering.md) |
| EM-019 | [035](./035-platform-sdk-conditional-rendering.md) |
| EM-020 | [016](./016-vgf-endif-cascade-limitations.md) |
| EM-021 | [014](./014-vgf-transport-sessions-setup.md) |
| EM-022 | [020](./020-vgf-dev-session-lifecycle.md) |
| EM-023 | [018](./018-vgf-socketio-message-workarounds.md) |
| EM-024 | [016](./016-vgf-endif-cascade-limitations.md) |
| EM-025 | [032](./032-timer-management-patterns.md) |
| EM-026 | [009](./009-reducer-purity.md) |
| EM-027 | [017](./017-vgf-devscheduler-patterns.md) |
| EM-028 | [041](./041-shared-helper-extraction.md) |
| EM-029 | [017](./017-vgf-devscheduler-patterns.md) |
| EM-030 | [034](./034-controller-phase-handling.md) |
| EM-031 | [037](./037-pr-review-codebase-scan.md) |
| EM-032 | [032](./032-timer-management-patterns.md) |
| EM-033 | [037](./037-pr-review-codebase-scan.md) |
| EM-034 | [033](./033-svg-countdown-ring-animation.md) |
| EM-035 | [032](./032-timer-management-patterns.md) |
| EM-036 | [032](./032-timer-management-patterns.md) |
| EM-037 | [033](./033-svg-countdown-ring-animation.md) |
| EM-038 | [019](./019-vgf-480-phase-transitions.md) |
| EM-039 | [043](./043-segment-analytics-integration.md) |
| EM-040 | [044](./044-dual-disconnect-session-cleanup-race.md) |
| EM-041 | [037](./037-pr-review-codebase-scan.md) |
| EM-042 | [019](./019-vgf-480-phase-transitions.md) |

### TokenRaider (1 → 1 file)

| Original | Amalgamated |
|---|---|
| TR-043 | [049](./049-vgf-project-scaffolding.md) |

### Crucible (new)

| # | Learning |
|---|---------|
| [050](./050-create-dev-out-of-box-issues.md) | 8 issues found in first real create→dev flow: nested node_modules filter, Windows paths, shared package build, tsconfig skipLibCheck, JSON log readiness, personal GitHub accounts, ruleset perms, NPM_TOKEN warning |
