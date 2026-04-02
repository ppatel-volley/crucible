# Learning 053: Create-to-Dev Flow & UX Gaps for Non-Technical Users

> **Date:** 2026-04-02
> **Context:** End-to-end test creating "Word Smiths" game via `crucible create` → `crucible dev`

## What Happened

Successfully created a VGF game and ran it locally. The full flow:
1. `crucible create "Word Smiths"` — scaffolded from hello-weekend template
2. Repo created at `Volley-Inc/crucible-game-word-smiths`
3. `crucible dev word-smiths` — all three processes running (server, display, controller)

## Issues Encountered

### 1. GitHub Token Management is a Pain
- User needs to manually generate a GitHub PAT (classic) with `repo` scope
- Token must be set as `GITHUB_TOKEN` env var before running `crucible create`
- Non-technical users won't know how to do this
- Token doesn't persist across shell sessions
- **Impact:** This is the #1 barrier to non-technical adoption

### 2. Rulesets Require Org Admin
- `applyProtectionRulesets` fails with 422 if the token doesn't have org admin perms
- After the 1A review fix, this was a hard error that blocked game creation
- Reverted to best-effort `.catch(() => {})` — rulesets are nice-to-have, not essential
- **Impact:** Medium — most users won't have org admin tokens

### 3. Repo-Exists Handling
- The 1A fix threw CRUCIBLE-201 on existing repos
- In practice, failed creates leave orphaned repos that can't be reused
- Reverted to repo reuse pattern — more practical for retry-after-failure
- **Impact:** High for retry flows — users shouldn't need to delete repos to retry

### 4. NPM_TOKEN Warnings
- `.npmrc` references `${NPM_TOKEN}` which isn't set locally
- Produces 6 warning lines on every command
- Harmless but noisy and confusing for new users
- **Impact:** Low — cosmetic but poor UX

### 5. No Docker on Windows Home
- Windows 11 Home doesn't support Hyper-V (needed for Docker Desktop)
- `crucible prototype --docker` won't work on many consumer machines
- Need Bifrost to support Dockerfile builds in-cluster (Kaniko)
- **Impact:** High — blocks prototype testing for non-technical users

## Changes Needed for Non-Technical Users

### Priority 1: Eliminate GitHub Token Friction
- **`crucible login`** should handle everything — OAuth device flow, no PAT generation
- Store token securely (keytar/keychain) so it persists
- Auto-detect missing token and prompt for login
- Consider GitHub App installation instead of PATs

### Priority 2: One-Command Prototype
- `crucible prototype my-game` should work without Docker
- Bifrost needs `buildStrategy: dockerfile` with Kaniko
- Git push → Bifrost clones → Kaniko builds → deploy
- Zero local dependencies beyond Node.js and git

### Priority 3: Friendly Error Messages
- CRUCIBLE-102 "GitHub token not found" should say "Run `crucible login` first"
- Failed creates should offer to retry, not require manual repo deletion
- NPM_TOKEN warnings should be suppressed or the `.npmrc` should be conditional

### Priority 4: Guided First-Run Experience
- `crucible create` should detect first run and offer a walkthrough
- Auto-check prerequisites (Node.js version, git, kubectl)
- Offer to run `crucible login` if no token is found
- Show a "What's next?" guide after creation

### Priority 5: Desktop App (Phase 6)
- Electron app wraps the CLI
- Visual game creation wizard
- Embedded preview (no separate terminal needed)
- One-click publish and prototype
- This is the ultimate answer for non-technical users

## Fal.ai Asset Generation
- Used Fal.ai (flux/schnell model) to generate tile, hero, display background, and controller background for Word Smiths
- Works well for placeholder art — 768x432 tiles, 1344x768 heroes
- Could be integrated into `crucible create` to auto-generate initial artwork
- API key: provided by user, stored as env var (not in code/memory)
