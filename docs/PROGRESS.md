# Crucible — Progress Tracker

> **Purpose:** Track completed work so fresh agent instances don't need to scan the codebase.
> Update this file when milestones or work items are completed.
> See `docs/development-plan.md` for full milestone definitions.

---

## Phase 1: Agent + Local Dev

### Milestone 1A: CLI Scaffold + Create Command — COMPLETE

All 8 work items done. 124 tests passing, typecheck clean.

| # | Work Item | Status | Commit(s) | Notes |
|---|-----------|--------|-----------|-------|
| 1A.1 | CLI scaffold (`index.ts`, commander, global flags, exit codes) | Done | `a92d1a9` | |
| 1A.2 | Config module (XDG paths, Windows `%APPDATA%`, Zod validation) | Done | `a92d1a9` | |
| 1A.3 | Logger/UX utilities (spinners, chalk, CRUCIBLE-XYY errors) | Done | `a92d1a9` | |
| 1A.4 | Token map + template engine | Done | `a92d1a9` | |
| 1A.5 | File generation (Dockerfile, CI workflow, crucible.json) | Done | `a92d1a9` | |
| 1A.6 | `crucible create` command (orchestration + rollback) | Done | `a92d1a9` | |
| 1A.7 | GitHub integration (repo creation, Rulesets, git push) | Done | `aa4baf4` | |
| 1A.8 | Git operations (simple-git wrapper, checksum validation) | Done | `a92d1a9` | |

**Review rounds completed:**
- Round 1: Duplicate CrucibleError, `--skip-github` default, exit code mapping, git error factory — all fixed (`0764304`)
- Round 2: Pre-parse global flags, template clone shorthand, GitHub org default — fixed/documented (`3b882fd`)
- Round 3: Error rethrow guard, extensionless text file handling — fixed (pending commit)

### Milestone 1B: AI Agent — NOT STARTED

Next up. 7 work items. See `docs/development-plan.md` for details.

| # | Work Item | Status |
|---|-----------|--------|
| 1B.1 | Context assembler (`agent/context.ts`) | Not started |
| 1B.2 | File restriction enforcer (`agent/restrictions.ts`) | Not started |
| 1B.3 | Claude API client (`api/claude.ts`) | Not started |
| 1B.4 | Agent runner (`agent/runner.ts`) | Not started |
| 1B.5 | Session persistence (`agent/session.ts`) | Not started |
| 1B.6 | `crucible agent` command | Not started |
| 1B.7 | Bundle VGF docs | Not started |

### Milestone 1C: Local Dev Server — NOT STARTED
### Milestone 1D: E2E Testing — NOT STARTED
### Milestone 1E: hello-weekend Template Prep — NOT STARTED

---

## Phase 2: Shared Infrastructure — BLOCKED

Blocked by human actions: AWS access, K8s admin, DNS, SSO provider setup.

### Milestone 2A: AWS Resources — BLOCKED (needs AWS access)
### Milestone 2B: Kubernetes Resources — BLOCKED (needs K8s admin)
### Milestone 2C: Registry API — NOT STARTED (depends on 2A)
### Milestone 2D: Supporting Infrastructure — NOT STARTED (depends on 2A, 2B)

---

## Phase 3–6: Not Started

Depends on Phases 1 and 2. See `docs/development-plan.md`.
