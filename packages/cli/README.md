# Backlog

**The task orchestrator for AI coding agents.**

Run Claude Code, Codex, and your own CLIs across isolated git worktrees,
with claims, retries, and review. Local by default — no account required.

[![npm version](https://img.shields.io/npm/v/backlog.svg)](https://www.npmjs.com/package/backlog)
[![license](https://img.shields.io/npm/l/backlog.svg)](https://github.com/osmove/backlog/blob/main/LICENSE)
[![CI](https://github.com/osmove/backlog/actions/workflows/ci.yml/badge.svg)](https://github.com/osmove/backlog/actions/workflows/ci.yml)

---

## The product family

| Surface | Install | Use case |
|---------|---------|----------|
| **CLI** (`backlog`) | `npm i -g backlog` | Headless, scriptable, the binary you put in CI |
| **Desktop** | [backlog.so/desktop](https://backlog.so/desktop) | Native kanban + run inspector + agent fleet (macOS · Linux · Windows) |
| **SDK** (`@osmove/backlog-sdk`) | `npm i @osmove/backlog-sdk` | Embed the orchestrator in your own tool, TypeScript-first |

CLI, Desktop, and SDK are all **Apache-2.0, free forever**. Backlog Cloud
(managed hosted backend) is in private development and only adds features
that genuinely need infrastructure we run — SMTP, hosted auth & SSO,
multi-tenant collaboration, hosted run executors, retention beyond local
disk, audit log export. See [backlog.so/cloud](https://backlog.so/cloud).

## What is Backlog?

Backlog is the engine that sits between your backlog and your agents.

It ingests work from sources you already use (Markdown, CSV, Jira, GitHub
Issues — more on the [roadmap](docs/ROADMAP.md)), decomposes tasks
into scoped, executable subtasks, and runs each subtask in an isolated git
worktree under a file-scope claim so multiple agents can work in parallel
without stepping on each other.

When a run finishes, you review it, approve it, request changes, or hand
it off — and the next eligible task can start immediately.

Backlog runs end-to-end on your machine by default. Remote sources,
remote repositories, remote sandboxes, remote executors, and deploy targets are
part of the [multi-target roadmap](docs/ROADMAP.md).

## How it works

| Layer | What it does |
|-------|--------------|
| **Sources** | Ingest tasks from Markdown, CSV, Jira (and more — see roadmap) |
| **Projects** | Group one or many repositories under a single banner; tasks can be filtered per-project |
| **Repositories** | Local paths or cloned from GitHub / GitLab / Bitbucket / arbitrary Git URLs |
| **Tasks** | High-level units of intent imported from sources |
| **Subtasks** | Executable units scoped to one repository and split out from tasks |
| **Claims** | Lock file/path scopes so concurrent runs cannot conflict |
| **Worktrees** | Each run executes in its own isolated git worktree |
| **Scheduler** | Picks eligible tasks, assigns agents, respects claim conflicts |
| **Orchestrator** | Persistent ▶/⏸/⏹ loop that re-runs the scheduler on a tick and dispatches runs |
| **Runs** | Track agent execution with summary, log, changed files, ETA, and live progress |
| **Review** | Approve, request changes, complete, fail, or handoff each run |
| **Agents** | Per-agent permissions, sandbox mode, risk level, repository restrictions |

## Quickstart

```bash
npm install -g backlog

# Single-repository project: drop a .backlog/ inside the repository.
cd ~/Dev/my-repository
backlog init --name my-project

# Multi-repository project: keep project state at ~/.backlog/<slug>/ instead so it
# isn't tied to any one repository.
cd ~/Dev/my-multi-repository-parent
backlog init --user-level --name my-project

backlog doctor
```

Create a task, split it into subtasks, and run the scheduler:

```bash
backlog task add --title "Build the scheduler"
backlog task split task_001 --repository backlog \
  --scope backlog=packages/core/src/**
backlog subtask add \
  --task task_001 \
  --title "Implement scheduler" \
  --repository backlog \
  --preferred-agent manual-default \
  --require-capability edit_code
backlog schedule simulate
backlog schedule explain --task task_001
backlog schedule run --approve
```

Add a source and sync tasks in:

```bash
backlog sources add markdown --id notes --path backlog.md
backlog sources sync
backlog task import
backlog sources conflicts
backlog sources resolve --task task_001 --use local
```

## Run the kanban board

You have two options for the same kanban experience — same engine, same
Svelte UI, same `@backlog/server`:

```bash
# Option A — CLI: smart shortcut that opens the kanban in your browser.
#   - If a server is already running, just opens the URL.
#   - Otherwise spawns `backlog serve` and blocks until Ctrl+C.
#   - `backlog` with no subcommand is the same shortcut.
#   - From inside a tracked repository, it opens that project + repository directly.
backlog board
```

```bash
# Same engine, longer form — keeps the foreground process attached so
# you can read agent stdout. Use this when scripting / running under a
# process supervisor.
backlog serve
```

```bash
# Option B — Desktop: native window, no browser tab. macOS, Linux,
# and Windows all ship today via electron-builder. macOS is signed +
# notarised; Linux AppImage / .deb / .rpm runs unsigned (normal);
# Windows installer is unsigned for now (SmartScreen warns once,
# install completes — EV cert in flight).
# Download: https://backlog.so/desktop
```

Both open at `http://127.0.0.1:7878` (Desktop picks a random port).
The topbar and sidebars carry:

- **Project selector** + project settings
- **Play / Pause / Stop** controls for the persistent orchestrator
- **Git** view with Changes, History, branch/worktree controls, hooks status, and sync
- **Repositories** management for local paths and cloned Git URLs
- **Agents** view with per-agent permissions and runtime restrictions
- **Runs** view for execution history and review
- **+ Task** / **+ Claim** quick-create dialogs
- **Total ETA pill** showing remaining work across the visible columns

Cards drag between **À faire / En cours / In Review / Done**, *and* within a
column to reorder by priority (sparse `priority_score` rewrite). Each task
shows a 4 px progress bar (agent-reported > elapsed/estimate > status
fallback) with an ETA that ticks every second client-side. The **+ Claim**
modal creates a file-scope claim with a per-tier retry-after hint on
collision, and the **Split** action decomposes a task into subtasks
mechanically or via Claude (`ANTHROPIC_API_KEY` required).

The board is served from the same `backlog` binary — no extra install,
no docker. Kill with Ctrl+C.

```bash
backlog serve --port 8080 --project ~/Dev/myproject --no-open
backlog serve --host 0.0.0.0    # expose to LAN (no auth — be careful)
```

Live updates use SSE, so the UI reflects YAML edits, claim creation,
orchestrator state, project changes, and run status changes within ~200ms.

## CLI

```
backlog init                                          Initialize a project
backlog doctor [--repository <id>] [--json]           Inspect project health
backlog status [--repository <id>]                    Project overview
backlog update                                        Update the global CLI install

backlog                                                   Alias of `backlog board`
backlog board    [--url <url>]                        Open the kanban (smart wrapper around serve)
backlog serve    [--port 7878] [--host 127.0.0.1]
                 [--project <path>] [--no-open]
                 [--open-url <url>]                   Launch the kanban board
backlog project  add|list|remove|path|migrate
                 |migrate-rollback|export|import     Manage projects (groups of repositories)
backlog repositories
                 list|show|add|update|remove          Manage tracked repositories
                 [--url <git-url>] [--clone-into]     ...or clone from GitHub / GitLab / etc.
backlog task     add|list|show|move|update|remove
                 |plan|split|import|estimate          Manage tasks
backlog subtask  add|list|show|move|update|remove
                 |block|unblock|plan|estimate
                 |progress                            Manage subtasks
backlog claim    start|check|finish|list|gc           Manage file-scope claims
                 [--duration <s>] [--agent <id>]
backlog hooks    status|install|pause|resume|disable
                 |stop|enable|uninstall [--all|--repository <id>]
                                                      Manage git hooks
backlog orchestrator start|pause|stop|status|config   Persistent run dispatcher
                 [--max-agents N] [--auto] [--project <slug>]
backlog schedule simulate|explain|run                 Schedule and run agents
backlog runs     list|show|gc|interrupt|resume
                 |review|approve|request-changes
                 |complete|fail|handoff               Manage runs
backlog agents   list|show|enable|disable|update
                 |validate|health                     Manage agent providers
backlog sources  add|list|enable|disable|update|remove
                 |validate|sync|push|conflicts|resolve
                                                      Manage source connectors
backlog release  snapshot [--repository <id>] [--include-disabled] [--output <path>]
                                                      Export a release report
backlog worktree list|gc                              Inspect tracked worktrees
```

### Common multi-project flow

```bash
# Start a multi-repository project, then add repositories by local path or Git URL.
backlog init --name "Shipping" --user-level
backlog repositories add --path /Users/me/Dev/web                 # local
backlog repositories add --url https://github.com/me/api.git      # remote git, cloned to <project>/repositories/api

# Create a task scoped to the project, split it, and let the orchestrator run.
backlog task add --title "Stripe integration" --priority P1
backlog task split task_001 --repository web --repository api
backlog orchestrator start --auto
```

Most `list` commands support practical filters, for example:

```bash
backlog repositories list --enabled true
backlog worktree list --repository backlog
backlog task list --repository backlog --status blocked
backlog runs list --review --agent codex-default
backlog sources list --enabled true
```

## Project state

Backlog stores project state in one of two layouts. `backlog init` defaults
to **in_repo** (the same directory you ran it in); pass `--user-level` to put
project state under your home folder instead. Both layouts hold the same set
of files; only the path on disk differs.

**in_repo** (default — best for a single-repo project)

```
<project root>/.backlog/
```

**user_level** (best for multi-repo projects so project state lives outside
any one repository)

```
~/.backlog/<slug>/
```

`<slug>` is the lowercased, hyphenated form of the project name; pick a name
that doesn't collide with any other registered user-level project. The user
registry itself lives at `~/.backlog/projects.json` on every platform.

Run into the hook crashing or the project not being found?
[docs/TROUBLESHOOTING.md](../../docs/TROUBLESHOOTING.md) covers the five
that come up most often.

Either way, the layout inside the project state dir is the same:

```
config.toml          # project + repositories + autonomy_mode + claims TTL
                     # (project_location = "in_repo" | "user_level")
tasks.yaml           # tasks (incl. project_id, rank, estimate)
subtasks.yaml        # executable units split out from tasks
orchestrator.json    # persistent ▶/⏸/⏹ state
sources.yaml
agents.yaml          # provider, sandbox, allowed_repos, allowed_risk, ...
claims/              # active and archived
runs/                # active and archived (incl. events.ndjson per run)
bin/backlog          # local shim invoked by the pre-commit hook
worktrees/           # tracked run worktrees
```

You can edit YAML by hand, but `backlog repositories`, `backlog project`,
`backlog task`, `backlog orchestrator`, `backlog agents`,
and `backlog sources` are designed to keep state consistent without manual
edits. Use `backlog project migrate <id> --to user-level` (or `--to in-repo
--into <repository-id>`) to switch an existing project between layouts.

## Agents

Backlog ships with three executor providers:

- **`claude`** — runs `claude -p` inside the run worktree
- **`codex`** — runs `codex exec` inside the run worktree
- **`custom`** — runs an arbitrary shell command inside the run worktree

`backlog init` seeds disabled `claude-default` and `codex-default` agents.
Enable, retarget, or override their executable with:

```bash
backlog agents enable codex-default
backlog agents update codex-default --model gpt-5
backlog agents update codex-default --command /usr/local/bin/codex
```

By default, `claude` and `codex` runs land in `awaiting_review` instead of
auto-completing. Their claims are released, but the run and worktree stay
available for review.

```bash
backlog runs list --review                # see the review queue
backlog runs approve <run-id>             # accept a reviewed run
backlog runs request-changes <run-id> --reason "..."
                                          # archive run, return task to planned
```

Both `claude` and `codex` runs attach summary, executor log, and the list of
changed files detected in the worktree.

## Source sync

- `backlog sources push --all` pushes every source-linked task that
  supports outbound sync.
- `backlog sources push` refuses to push an item while it has pending
  conflicts, unless you pass `--allow-conflicts`.
- `backlog sources resolve --task <id> --use local|external` resolves
  every pending conflict for that task in one step.

## Maintenance

- `backlog claim gc` archives expired active claims.
- `backlog runs gc --all` purges archived run directories.
- `backlog worktree list` shows worktrees Backlog knows about.
- `backlog worktree gc --dry-run` previews cleanup before deleting anything.

## Hooks

In multi-repository projects, `backlog hooks status|install|uninstall --all` lets
you audit or roll out the managed pre-commit hook across every configured
repository in one pass. You can also target one configured repository explicitly with
`--repository <id>`.

`backlog hooks status` reports whether the hook and the local shim are up
to date. If not, it prints the exact `backlog hooks install ...` command to
run. `backlog hooks disable` (alias: `stop`) turns the hook gate off for the
project until `backlog hooks resume` (alias: `enable`).

## Release snapshots

`backlog release snapshot` reports dirty repositories and per-repository run counts. It
supports:

- `--repository <id>` to focus on one repository
- `--include-disabled` to include disabled repositories in the snapshot
- `--output <path>` to write the snapshot to a file for export

## Packages in this monorepo

| Package | Purpose | License |
|---|---|---|
| `backlog` (`packages/cli`) | The CLI binary published on npm | Apache-2.0 |
| `@backlog/core` | Scheduler, run launcher, task services | Apache-2.0 |
| `@backlog/claims` | Claim store + overlap detection | Apache-2.0 |
| `@backlog/schemas` | Zod schemas for the project state | Apache-2.0 |
| `@backlog/server` | Local Hono server + REST/SSE API behind `backlog serve` | BUSL-1.1 |
| `@backlog/board-ui` | Svelte 5 kanban frontend | Apache-2.0 |
| `@backlog/git`, `@backlog/hooks`, `@backlog/config`, `@backlog/connectors` | Plumbing | Apache-2.0 |

End users only ever install `backlog` — every project package is
inlined into the published CLI tarball at build time. The split exists
for development clarity and per-package licensing.

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md) for the multi-target plan covering
remote sources, remote repositories, remote sandboxes, remote executors, and
deploy targets.

## Development

Contributor and agent docs are split by purpose:

- [CONTRIBUTING.md](CONTRIBUTING.md) for the human contribution path.
- [AGENTS.md](AGENTS.md) for repository-specific instructions Codex and other agents
  must follow.
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for architecture, naming,
  local setup, UI conventions, Git behavior, and Cloud boundaries.
- [RELEASING.md](RELEASING.md) for version bumps, checks, tags, publishing,
  Desktop updates, and deployment verification.

```bash
pnpm install
pnpm typecheck
pnpm --filter @backlog/board-ui typecheck
pnpm test
pnpm --filter "backlog..." build
pnpm --filter @backlog/desktop build
pnpm --filter backlog pack:check
```

Issues, PRs, and design discussions welcome.

## Sister projects

- [Backlog Desktop](https://backlog.so/desktop) — native kanban for the same orchestrator engine
- [`@osmove/backlog-sdk`](https://www.npmjs.com/package/@osmove/backlog-sdk) — TypeScript client generated from the OpenAPI 3.0.3 spec
- [Backlog Cloud](https://backlog.so/cloud) — managed hosted backend (private development, waitlist)
- [`lint`](https://www.npmjs.com/package/lint) — universal linter CLI with AI-powered code review

## License

[Apache-2.0](./LICENSE)
