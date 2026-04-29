# Backlog

**The task orchestrator for humans and AI coding agents.**

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
| **Desktop** | [backlog.so/desktop](https://backlog.so/desktop) | Native kanban + run inspector + agent fleet (macOS first) |
| **SDK** (`@osmove/backlog-sdk`) | `npm i @osmove/backlog-sdk` | Embed the orchestrator in your own tool, TypeScript-first |

CLI, Desktop, and SDK are all **Apache-2.0, free forever**. Backlog Cloud
(managed hosted backend) is in private development and only adds features
that genuinely need infrastructure we run — SMTP, hosted auth & SSO,
multi-tenant collaboration, hosted run executors, retention beyond local
disk, audit log export. See [backlog.so/cloud](https://backlog.so/cloud).

## What is Backlog?

Backlog is the engine that sits between your backlog and your agents.

It ingests work from sources you already use (Markdown, CSV, Jira, GitHub
Issues — more on the [roadmap](docs/ROADMAP.md)), decomposes work items
into scoped, executable tasks, and runs each task in an isolated git
worktree under a file-scope claim so multiple agents can work in parallel
without stepping on each other.

When a run finishes, you review it, approve it, request changes, or hand
it off — and the next eligible task can start immediately.

Backlog runs end-to-end on your machine by default. Remote sources,
remote repos, remote sandboxes, remote executors, and deploy targets are
part of the [multi-target roadmap](docs/ROADMAP.md).

## How it works

| Layer | What it does |
|-------|--------------|
| **Sources** | Ingest work items from Markdown, CSV, Jira (and more — see roadmap) |
| **Projects** | Group one or many repos under a single banner; tickets can be filtered per-project |
| **Repos** | Local paths or cloned from GitHub / GitLab / Bitbucket / arbitrary Git URLs |
| **Work items** | High-level units of intent imported from sources |
| **Tasks** | Repo-scoped executable units split out from work items |
| **Claims** | Lock file/path scopes so concurrent runs cannot conflict |
| **Worktrees** | Each run executes in its own isolated git worktree |
| **Scheduler** | Picks eligible tasks, assigns agents, respects claim conflicts |
| **Orchestrator** | Persistent ▶/⏸/⏹ loop that re-runs the scheduler on a tick and dispatches runs |
| **Runs** | Track agent execution with summary, log, changed files, ETA, and live progress |
| **Review** | Approve, request changes, complete, fail, or handoff each run |
| **Permissions** | Workspace autonomy mode + per-agent sandbox / risk / repo restrictions |

## Quickstart

```bash
npm install -g backlog

# Single-repo project: drop a .backlog/ inside the repo.
cd ~/Dev/my-repo
backlog init --name my-project

# Multi-repo project: keep the workspace at ~/.backlog/<slug>/ instead so it
# isn't tied to any one repo.
cd ~/Dev/my-multi-repo-parent
backlog init --user-level --name my-project

backlog doctor
```

Create a work item, split it into tasks, and run the scheduler:

```bash
backlog work add --title "Build the scheduler"
backlog work split WI-xxxx --repo backlog \
  --scope backlog=packages/core/src/**
backlog task add \
  --work-item WI-xxxx \
  --title "Implement scheduler" \
  --repo backlog \
  --preferred-agent manual-default \
  --require-capability edit_code
backlog schedule simulate
backlog schedule explain --work-item WI-xxxx
backlog schedule run --approve
```

Add a source and sync work items in:

```bash
backlog sources add markdown --id notes --path backlog.md
backlog sources sync
backlog work import
backlog sources conflicts
backlog sources resolve --work-item WI-xxxx --use local
```

## Run the kanban board

You have two options for the same kanban experience — same engine, same
Svelte UI, same `@backlog/server`:

```bash
# Option A — CLI: smart shortcut that opens the kanban in your browser.
#   - If a server is already running, just opens the URL.
#   - Otherwise spawns `backlog serve` and blocks until Ctrl+C.
backlog board
```

```bash
# Same engine, longer form — keeps the foreground process attached so
# you can read agent stdout. Use this when scripting / running under a
# process supervisor.
backlog serve
```

```bash
# Option B — Desktop: native window, no browser tab. macOS shipping today
# (signed + notarised); Windows + Linux follow via electron-builder.
# Download: https://backlog.so/desktop
```

Both open at `http://127.0.0.1:7878` (Desktop picks a random port).
The topbar carries:

- **Project selector** + ⚙ Projets modal (CRUD)
- **▶ Play / ⏸ Pause / ⏹ Stop** trio for the persistent orchestrator (Xcode-style)
- 📁 **Repos** modal (add a local path *or* clone from a Git URL)
- 🔒 **Permissions** modal (workspace autonomy + per-agent restrictions)
- ⚙ **Plan** side panel (wave breakdown, agents-max slider, auto toggle, last tick + last error)
- **+ Ticket** / **+ Claim** quick-create dialogs
- **Total ETA pill** showing remaining work across the visible columns

Cards drag between **À faire / En cours / In Review / Done**, *and* within a
column to reorder by priority (sparse `priority_score` rewrite). Each task
shows a 4 px progress bar (agent-reported > elapsed/estimate > status
fallback) with an ETA that ticks every second client-side. The **+ Claim**
modal creates a file-scope claim with a per-tier retry-after hint on
collision, and the **✂ Split** action decomposes a work item into tasks
mechanically or via Claude (`ANTHROPIC_API_KEY` required).

The board is served from the same `backlog` binary — no extra install,
no docker. Kill with Ctrl+C.

```bash
backlog serve --port 8080 --workspace ~/Dev/myproject --no-open
backlog serve --host 0.0.0.0    # expose to LAN (no auth — be careful)
```

Live updates use SSE, so the UI reflects YAML edits, claim creation,
orchestrator state, project changes, and run status changes within ~200ms.

## CLI

```
backlog init                                          Initialize a workspace
backlog doctor [--repo <id>] [--json]                 Inspect workspace health
backlog status [--repo <id>]                          Workspace overview

backlog board    [--url <url>]                        Open the kanban (smart wrapper around serve)
backlog serve    [--port 7878] [--host 127.0.0.1]
                 [--workspace <path>] [--no-open]     Launch the kanban board
backlog project  add|list|show|update|archive|remove  Manage projects (groups of repos)
backlog repos    list|show|add|update|remove          Manage tracked repos
                 [--url <git-url>] [--clone-into]     ...or clone from GitHub / GitLab / etc.
backlog work     add|list|show|move|update|remove
                 |plan|split|import|assign-project
                 |estimate                            Manage work items
backlog task     add|list|show|move|update|remove
                 |block|unblock|plan|estimate
                 |progress                            Manage tasks
backlog claim    start|check|finish|list|gc           Manage file-scope claims
                 [--duration <s>] [--agent <id>]
backlog hooks    status|install|uninstall [--all|--repo <id>]
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
backlog release  snapshot [--repo <id>] [--include-disabled] [--output <path>]
                                                      Export a release report
backlog worktree list|gc                              Inspect tracked worktrees
```

### Common multi-project flow

```bash
# Add repos either by local path or by Git URL.
backlog repos add --path /Users/me/Dev/web                       # local
backlog repos add --url https://github.com/me/api.git            # cloned to <ws>/repos/api

# Group them under a project — works with one or many repos.
backlog project add --slug shipping --name "Shipping" --repo web --repo api

# Create a ticket scoped to the project, split it, and let the orchestrator run.
backlog work add --title "Stripe integration" --priority P1
backlog work assign-project WI-xxxx shipping
backlog work split WI-xxxx --repo web --repo api
backlog orchestrator start --auto --project shipping
```

Most `list` commands support practical filters, for example:

```bash
backlog repos list --enabled true
backlog work list --status ready --repo backlog
backlog task list --repo backlog --status blocked
backlog runs list --review --agent codex-default
backlog sources list --enabled true
```

## Workspace state

Backlog stores workspace state in one of two layouts. `backlog init` defaults
to **in_repo** (the same directory you ran it in); pass `--user-level` to put
the workspace under your home folder instead. Both layouts hold the same set
of files; only the path on disk differs.

**in_repo** (default — best for a single-repo project)

```
<project root>/.backlog/
```

**user_level** (best for multi-repo projects so the workspace lives outside
any one repo)

```
~/.backlog/<slug>/
```

`<slug>` is the lowercased, hyphenated form of the project name; pick a name
that doesn't collide with any other registered user-level project. The user
registry itself lives at `~/.backlog/projects.json` on every platform.

Run into the hook crashing or the workspace not being found?
[docs/TROUBLESHOOTING.md](../../docs/TROUBLESHOOTING.md) covers the five
that come up most often.

Either way, the layout inside the workspace dir is the same:

```
config.toml          # project + repos + autonomy_mode + claims TTL
                     # (project_location = "in_repo" | "user_level")
tasks.yaml           # tickets (incl. project_id, rank, estimate)
subtasks.yaml        # executable units split out from tasks
orchestrator.json    # persistent ▶/⏸/⏹ state
sources.yaml
agents.yaml          # provider, sandbox, allowed_repos, allowed_risk, ...
claims/              # active and archived
runs/                # active and archived (incl. events.ndjson per run)
bin/backlog          # local shim invoked by the pre-commit hook
worktrees/           # tracked run worktrees
```

You can edit YAML by hand, but `backlog repos`, `backlog project`,
`backlog task`, `backlog orchestrator`, `backlog agents`,
and `backlog sources` are designed to keep state consistent without manual
edits. Use `backlog project migrate <id> --to user-level` (or `--to in-repo
--into <repo-id>`) to switch an existing workspace between layouts.

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

- `backlog sources push --all` pushes every source-linked work item that
  supports outbound sync.
- `backlog sources push` refuses to push an item while it has pending
  conflicts, unless you pass `--allow-conflicts`.
- `backlog sources resolve --work-item <id> --use local|external` resolves
  every pending conflict for that work item in one step.

## Maintenance

- `backlog claim gc` archives expired active claims.
- `backlog runs gc --all` purges archived run directories.
- `backlog worktree list` shows worktrees Backlog knows about.
- `backlog worktree gc --dry-run` previews cleanup before deleting anything.

## Hooks

In multi-repo workspaces, `backlog hooks status|install|uninstall --all` lets
you audit or roll out the managed pre-commit hook across every configured
repo in one pass. You can also target one configured repo explicitly with
`--repo <id>`.

## Release snapshots

`backlog release snapshot` reports dirty repos and per-repo run counts. It
supports:

- `--repo <id>` to focus on one repo
- `--include-disabled` to include disabled repos in the snapshot
- `--output <path>` to write the snapshot to a file for export

## Packages in this monorepo

| Package | Purpose | License |
|---|---|---|
| `backlog` (`packages/cli`) | The CLI binary published on npm | Apache-2.0 |
| `@backlog/core` | Scheduler, run launcher, task/work-item services | Apache-2.0 |
| `@backlog/claims` | Claim store + overlap detection | Apache-2.0 |
| `@backlog/schemas` | Zod schemas for the workspace state | Apache-2.0 |
| `@backlog/server` | Local Hono server + REST/SSE API behind `backlog serve` | BUSL-1.1 |
| `@backlog/board-ui` | Svelte 5 kanban frontend | Apache-2.0 |
| `@backlog/git`, `@backlog/hooks`, `@backlog/config`, `@backlog/connectors` | Plumbing | Apache-2.0 |

End users only ever install `backlog` — every workspace package is
inlined into the published CLI tarball at build time. The split exists
for development clarity and per-package licensing.

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md) for the multi-target plan covering
remote sources, remote repos, remote sandboxes, remote executors, and
deploy targets.

## Development

```bash
corepack pnpm install
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

Issues, PRs, and design discussions welcome.

## Sister projects

- [Backlog Desktop](https://backlog.so/desktop) — native kanban for the same orchestrator engine, currently in Apple notarisation (waitlist)
- [`@osmove/backlog-sdk`](https://www.npmjs.com/package/@osmove/backlog-sdk) — TypeScript client generated from the OpenAPI 3.0.3 spec
- [Backlog Cloud](https://backlog.so/cloud) — managed hosted backend (private development, waitlist)
- [`lint`](https://www.npmjs.com/package/lint) — universal linter CLI with AI-powered code review

## License

[Apache-2.0](./LICENSE)
