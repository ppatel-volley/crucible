# Crucible User Guide

> Build TV games with AI. Describe what you want, Crucible builds it.

**Version:** 0.1.0
**Last updated:** 2026-03-25

---

## What is Crucible?

Crucible is a command-line tool for creating, developing, and publishing Volley TV games. You describe what you want in plain English, an AI agent builds it from the `hello-weekend` template, and the finished game appears on Proto-Hub.

Think of it as Unity or Unreal, but for Volley's two-screen games (TV display + phone controller).

---

## Quick Start

```bash
# 1. Create a new game
crucible create "Scottish Trivia"

# 2. Start the AI agent to build your game
crucible agent scottish-trivia

# 3. Run it locally
crucible dev scottish-trivia
```

That's it. Three commands from idea to playable game.

> **Prototype deployments:** Once Bifrost is available on the dev cluster, you can also run `crucible prototype scottish-trivia` to deploy to a shared Kubernetes environment with real infrastructure dependencies. See the [crucible prototype](#crucible-prototype) section below.

---

## Installation

### Prerequisites

- **Node.js** 22 or later
- **pnpm** 9 or later
- **Git**
- A **GitHub token** with repo access (`GITHUB_TOKEN` environment variable)
- An **Anthropic API key** for the AI agent (`ANTHROPIC_API_KEY` environment variable)

### Install

```bash
# From the crucible monorepo
pnpm install

# Build and link as a global command
cd packages/crucible
pnpm build && npm link

# Verify it works (from any directory)
crucible --help
crucible list
```

After linking, `crucible` is available as a global command. You only need to re-run `pnpm build && npm link` when the CLI source code changes.

### Environment Variables

Set these in your shell profile (`.bashrc`, `.zshrc`, or PowerShell `$PROFILE`):

```bash
export GITHUB_TOKEN="ghp_your_token_here"
export ANTHROPIC_API_KEY="sk-ant-your_key_here"
```

---

## Commands

### crucible create

Create a new TV game from the hello-weekend template.

```bash
crucible create <display-name> [options]
```

**Arguments:**
- `<display-name>` — Your game's display name (e.g. `"Scottish Trivia"`)

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `-d, --description <text>` | Game description | `""` |
| `--skip-install` | Skip `pnpm install` after creation | `false` |

**What happens:**

1. Validates the game name (3-50 characters, converts to kebab-case)
2. Clones the `hello-weekend` template
3. Replaces all template references with your game name
4. Generates a `Dockerfile`, CI workflow, and `crucible.json`
5. Runs `pnpm install`
6. Creates a private GitHub repo at `Volley-Inc/crucible-game-{name}`
7. Applies repository protection rulesets (Dockerfile, CI, lockfiles are immutable)
8. Pushes the initial commit

**Example:**

```bash
crucible create "Emoji Party" -d "A fast-paced emoji matching game"
```

```
  Creating Emoji Party...

  ✓ Cloned template
  ✓ Replaced tokens (42 replacements in 18 files)
  ✓ Generated Dockerfile, CI workflow, crucible.json
  ✓ Installed dependencies
  ✓ Created GitHub repo: Volley-Inc/crucible-game-emoji-party
  ✓ Applied protection rulesets
  ✓ Pushed to GitHub

  Game created at ~/crucible-games/emoji-party

  Next steps:
    cd ~/crucible-games/emoji-party
    crucible agent emoji-party    # Start AI agent
    crucible dev emoji-party      # Run locally
```

**If something goes wrong**, Crucible rolls back automatically — deleting the GitHub repo and local directory.

---

### crucible agent

Start an interactive AI agent session to build your game. Describe what you want, and the agent writes the code.

```bash
crucible agent <game-id> [options]
```

**Arguments:**
- `<game-id>` — Your game's ID (kebab-case name, e.g. `scottish-trivia`)

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--resume` | Resume the most recent session | `false` |
| `--model <model>` | Claude model to use | Config default |

**What happens:**

1. Loads your game's source files into context (180K token budget)
2. Creates (or resumes) a conversation session
3. Opens an interactive prompt where you describe changes
4. The agent reads files, writes code, runs builds/tests, and auto-commits

**Example session:**

```
$ crucible agent scottish-trivia

Loading game context... done (2.3s, 45,200 tokens, 23 files)

Agent: I've loaded scottish-trivia. What would you like to build?

You: Add a bonus round that appears after every 5 questions. The display
     should show a countdown timer and the controller should have a
     buzzer button.

  Working...

  [1/3] Edited packages/shared/src/types.ts
        + Added bonusRound field to GameState interface
  [2/3] Edited apps/server/src/reducers.ts
        + Added BONUS_ROUND reducer with timer logic
  [3/3] Created apps/display/src/components/BonusRound.tsx (+38 lines)

  ✓ Committed: "Add bonus round phase with timer" (e4f5g6h)

Agent: I've added the bonus round. It triggers after every 5 questions
       with a 10-second countdown. The controller gets a buzzer button
       that dispatches a BUZZ_IN action. Want me to add scoring for it?

You: exit

Session saved. Goodbye!
```

**Safety rails:** The agent cannot modify infrastructure files (Dockerfile, CI workflows, lockfiles, `.npmrc`). It can only edit game source code in `apps/*/src/` and `packages/*/src/`.

**Resuming a session:**

```bash
crucible agent scottish-trivia --resume
```

Sessions expire after 24 hours of inactivity.

---

### crucible dev

Start a local development server with hot reload. Launches three processes: the game server, TV display, and phone controller.

```bash
crucible dev <game-id> [options]
```

**Arguments:**
- `<game-id>` — Your game's ID

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--port-server <port>` | Game server port | `8090` |
| `--port-display <port>` | Display (TV) port | `3000` |
| `--port-controller <port>` | Controller (phone) port | `5174` |

**Example:**

```bash
crucible dev scottish-trivia
```

```
  ✓ Dev server running
    Server:     http://127.0.0.1:8090
    Display:    http://127.0.0.1:3000
    Controller: http://127.0.0.1:5174
    Health:     http://127.0.0.1:8090/scottish-trivia/health

  Press q or Ctrl+C to stop.

  [server]      WGFServer started on :8090
  [display]     VITE ready in 450ms
  [controller]  VITE ready in 320ms
```

Open the **Display** URL in a browser to see the TV screen. Open the **Controller** URL on your phone (or another browser tab) to play.

**Port conflicts:** If a port is in use, Crucible automatically finds the next available one (up to +100 from the default).

**Stopping:** Press `q` or `Ctrl+C`. Double `Ctrl+C` within 1 second force-kills everything.

---

### crucible prototype

Deploy a game to a shared Kubernetes cluster for testing with real infrastructure dependencies.

```bash
crucible prototype <game-id> [--watch] [--dependencies <deps>] [--delete]
```

**Arguments:**
- `<game-id>` — Your game's ID (kebab-case name, e.g. `space-blaster`)

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--watch` | Rebuild and redeploy on file changes | `false` |
| `--dependencies <deps>` | Infrastructure dependencies (format: `name:type,name:type`) | none |
| `--delete` | Remove the prototype and clean up all resources | `false` |

**Dependency types:** `postgres`, `redis`, `s3`

**What happens:**

1. Builds the game into a single container (server + static display/controller)
2. Pushes to the in-cluster registry
3. Applies a GamePrototype CRD to the Kubernetes cluster
4. Bifrost operator provisions the namespace, dependencies, and deployment
5. Prints the prototype URL

**Example:**

```bash
crucible prototype space-blaster --dependencies scores:postgres,cache:redis
```

```
  Building prototype...
    ✓ Display built (2.1s)
    ✓ Controller built (1.8s)
    ✓ Server bundled with static clients (3.4s)
    ✓ Image pushed to in-cluster registry (1.2s)
    ✓ GamePrototype applied

  Waiting for Bifrost...
    ✓ Namespace created: space-blaster-prototype
    ✓ Dependencies provisioned (postgres, redis)
    ✓ Deployment running

  ✓ Prototype live!
    Server:     http://space-blaster.space-blaster-prototype.svc.cluster.local:3000
    Display:    http://space-blaster.space-blaster-prototype.svc.cluster.local:3000/display/
    Controller: http://space-blaster.space-blaster-prototype.svc.cluster.local:3000/controller/

    Dependencies:
      scores (postgres): space_blaster_scores_db
      cache (redis):     space-blaster:cache: prefix
```

**Cleanup:**

```bash
crucible prototype space-blaster --delete
```

```
  ✓ GamePrototype deleted
  ✓ Bifrost cleaning up (database, namespace)...
  ✓ Prototype removed
```

**Notes:**
- This requires Bifrost deployed on the cluster and kubectl access configured
- Prototypes use shared in-cluster infrastructure (not production AWS)
- Data is not durable — prototypes can be destroyed and recreated

> **Coming soon** — requires Bifrost deployment on dev cluster.

---

### crucible list

Show all local games with their details.

```bash
crucible list [options]
```

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--env <environment>` | Filter by environment | Show all |

**Example:**

```bash
crucible list
```

```
  Name              Display Name       Version   Template        Created
  scottish-trivia   Scottish Trivia    0.1.0     hello-weekend   2d ago
  emoji-party       Emoji Party        0.1.0     hello-weekend   5h ago
  old-prototype     old-prototype      —         —               (no crucible.json)

  3 game(s) found.
```

---

### crucible publish

Publish a game by pushing to GitHub and monitoring the CI pipeline.

```bash
crucible publish <game-id> [options]
```

**Arguments:**
- `<game-id>` — Your game's ID

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--timeout <minutes>` | CI polling timeout | `10` |
| `--env <environment>` | Target environment | `dev` |

**Pre-flight checks** (working now):
1. No uncommitted changes in your git working tree
2. `crucible.json` exists and is valid
3. `Dockerfile` checksum matches `crucible.json` (nobody tampered with it)
4. GitHub remote (`origin`) is configured

> **Note:** The CI pipeline integration (git push, build monitoring, deployment) is not yet available. It requires Phase 2 infrastructure. Pre-flight checks work now so you can validate your game is ready to publish.

---

### crucible login

Authenticate with Volley SSO.

```bash
crucible login [options]
```

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--device-code` | Use device code flow (headless/SSH) | `false` |

> **Note:** Login requires SSO configuration that hasn't been provisioned yet. Set `CRUCIBLE_OIDC_ISSUER` and `CRUCIBLE_OIDC_CLIENT_ID` environment variables once SSO is configured.

**How it will work:**
1. Opens your browser to the Volley SSO login page
2. You sign in with your Volley account
3. Crucible stores your token securely
4. You're authenticated for `publish`, `promote`, and other cloud commands

**Headless environments** (SSH, CI): Use `--device-code` to get a code you enter at a URL instead of opening a browser.

---

### crucible rollback

Roll back a game to a previous version.

```bash
crucible rollback <game-id> [options]
```

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--to <version>` | Specific version to roll back to | Previous version |
| `--env <environment>` | Target environment | `dev` |

> **Coming soon.** Requires Phase 2 infrastructure (Registry API).

---

### crucible promote

Promote a game from one environment to the next.

```bash
crucible promote <game-id> --from <env> --to <env> [options]
```

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--from <environment>` | Source environment (required) | — |
| `--to <environment>` | Target environment (required) | — |
| `--confirm <game-name>` | Required for production promotions | — |

**Example:**

```bash
# Promote from dev to staging
crucible promote scottish-trivia --from dev --to staging

# Promote to production (requires confirmation)
crucible promote scottish-trivia --from staging --to prod --confirm scottish-trivia
```

> **Coming soon.** Requires Phase 2 infrastructure.

---

### crucible logs

View game server logs.

```bash
crucible logs <game-id> [options]
```

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `-f, --follow` | Stream logs continuously | `false` |
| `--lines <number>` | Number of lines to show | `100` |
| `--env <environment>` | Target environment | `dev` |

> **Coming soon.** Requires Phase 2 infrastructure (K8s access).

---

### crucible status

Check game status across environments.

```bash
crucible status [game-id] [options]
```

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--env <environment>` | Filter to specific environment | Show all |

Without a game ID, shows all games. With a game ID, shows detailed status for that game.

> **Coming soon.** Requires Phase 2 infrastructure (Registry API + K8s).

---

## Global Options

These flags work with every command:

| Flag | Description |
|------|-------------|
| `--no-color` | Disable coloured output |
| `--json` | Output as JSON (for scripting) |
| `-v, --verbose` | Show debug-level output |
| `-q, --quiet` | Suppress non-essential output |
| `--help` | Show help for any command |
| `--version` | Show Crucible version |

**Example:**

```bash
# JSON output for scripting
crucible list --json

# Verbose mode for debugging
crucible create "My Game" --verbose

# Suppress spinners and info messages
crucible publish my-game --quiet
```

---

## Project Structure

When you create a game, Crucible generates this structure:

```
~/crucible-games/scottish-trivia/
├── apps/
│   ├── server/          # VGF game server (WGFServer)
│   │   └── src/
│   │       ├── dev.ts           # Local dev server entry
│   │       ├── reducers.ts      # Game state reducers
│   │       ├── thunks.ts        # Async game logic
│   │       └── phases.ts        # Phase definitions
│   ├── display/         # TV screen (Vite + React)
│   │   └── src/
│   │       └── components/      # Display components
│   └── controller/      # Phone controller (Vite + React)
│       └── src/
│           └── components/      # Controller components
├── packages/
│   └── shared/          # Shared types and utilities
│       └── src/
│           └── types.ts         # Game state interface
├── Dockerfile           # Immutable — managed by Crucible
├── .github/
│   └── workflows/       # Immutable — managed by Crucible
├── crucible.json        # Game metadata and checksums
└── pnpm-workspace.yaml  # Immutable — managed by Crucible
```

**What you edit:** Everything in `apps/*/src/` and `packages/*/src/`.

**What Crucible manages:** `Dockerfile`, `.github/workflows/`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc`. These are protected by GitHub Rulesets and cannot be modified directly.

---

## Typical Workflow

```
1. crucible create "My Game"     # Scaffold the project
2. crucible agent my-game        # Describe what you want, AI builds it
3. crucible dev my-game          # Test locally on TV + phone
4. crucible prototype my-game    # Deploy to shared cluster for testing (coming soon)
5. crucible publish my-game      # Push to dev environment (coming soon)
6. crucible promote my-game      # Promote to staging/prod (coming soon)
```

---

## Error Codes

When something goes wrong, Crucible shows a structured error with a code and recovery suggestion:

```
✗ Dockerfile checksum mismatch

  The Dockerfile has been modified outside of Crucible.

  Recovery:
    Run `crucible create` to regenerate it or update crucible.json.

  Error: CRUCIBLE-801 (template/checksum-mismatch)
```

| Code Range | Category | Examples |
|------------|----------|----------|
| 1xx | Auth | Token expired, not logged in, SSO failed |
| 2xx | Usage | Invalid game name, directory exists, bad arguments |
| 3xx | Agent | Game not found, context budget exceeded |
| 4xx | Network | API unreachable, timeout, port in use |
| 5xx | Build | Quality gate failed, Docker build error |
| 7xx | Deploy | Rollback failed, no previous version |
| 8xx | Template | Checksum mismatch, clone failure |

---

## Troubleshooting

### "Game not found"

Make sure you're using the kebab-case game ID, not the display name:

```bash
# Wrong
crucible dev "Scottish Trivia"

# Right
crucible dev scottish-trivia
```

### "GitHub token not found"

Set the `GITHUB_TOKEN` environment variable:

```bash
export GITHUB_TOKEN="ghp_your_token_here"
```

### "Anthropic API key not found"

Set the `ANTHROPIC_API_KEY` environment variable:

```bash
export ANTHROPIC_API_KEY="sk-ant-your_key_here"
```

### Port already in use

Crucible automatically tries the next port (up to +100). If all ports are exhausted, free up some ports or specify custom ones:

```bash
crucible dev my-game --port-server 9000 --port-display 4000 --port-controller 6000
```

### Agent session expired

Sessions expire after 24 hours. Start a new one:

```bash
crucible agent my-game
```

### Dockerfile checksum mismatch

Someone (or something) modified the Dockerfile directly. The Dockerfile is managed by Crucible and should not be edited manually. To fix:

1. Revert the Dockerfile: `git checkout Dockerfile`
2. Or re-run `crucible create` to regenerate it

---

## Feature Status

| Feature | Status |
|---------|--------|
| `crucible create` | Working |
| `crucible agent` | Working (needs `ANTHROPIC_API_KEY`) |
| `crucible dev` | Working |
| `crucible list` | Working |
| `crucible prototype` | Coming soon (requires Bifrost) |
| `crucible publish` | Pre-flight checks only. CI integration coming in Phase 2. |
| `crucible login` | OIDC flow built (PKCE, callback server, token store). Needs SSO config values. |
| `crucible rollback` | Coming in Phase 2 |
| `crucible promote` | Coming in Phase 2 |
| `crucible logs` | Coming in Phase 2 |
| `crucible status` | Coming in Phase 2 |
