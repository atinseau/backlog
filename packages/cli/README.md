# Backlog

**Turn planning inputs into safe agent execution.**

Vendor-neutral orchestration with claims, worktrees, and parallel runs for
AI coding agents.

[![npm version](https://img.shields.io/npm/v/backlog.svg)](https://www.npmjs.com/package/backlog)
[![license](https://img.shields.io/npm/l/backlog.svg)](https://github.com/osmove/backlog/blob/main/LICENSE)
[![CI](https://github.com/osmove/backlog/actions/workflows/ci.yml/badge.svg)](https://github.com/osmove/backlog/actions/workflows/ci.yml)

---

## What is Backlog?

Backlog is the engine that sits between your backlog and your agents.

It ingests work from sources you already use (Markdown, CSV, Jira — more
coming), decomposes work items into scoped, executable tasks, and runs each
task in an isolated git worktree under a file-scope claim so multiple agents
can work in parallel without stepping on each other.

When a run finishes, you review it, approve it, request changes, or hand it
off — and the next eligible task can start immediately.

Backlog runs end-to-end on your machine by default. Remote sources, remote
repos, remote sandboxes, remote executors, and deploy targets are part of
the [multi-target roadmap](docs/ROADMAP.md).

## How it works

| Layer | What it does |
|-------|--------------|
| **Sources** | Ingest work items from Markdown, CSV, Jira (and more — see roadmap) |
| **Work items** | High-level units of intent imported from sources |
| **Tasks** | Repo-scoped executable units split out from work items |
| **Claims** | Lock file/path scopes so concurrent runs cannot conflict |
| **Worktrees** | Each run executes in its own isolated git worktree |
| **Scheduler** | Picks eligible tasks, assigns agents, respects claim conflicts |
| **Runs** | Track agent execution with summary, log, and changed-files artifacts |
| **Review** | Approve, request changes, complete, fail, or handoff each run |

## Quickstart

```bash
npm install -g backlog

backlog init --name my-workspace
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

```bash
backlog serve
```

Opens a local Trello-like board in your browser at `http://127.0.0.1:7878`.
Cards drag between **À faire / En cours / In Review / Done**, the
**Orchestrator** side panel shows wave-bucketed parallel work plans, the
**+ Claim** modal creates a file-scope claim with a per-tier retry-after
hint on collision, and the **✂ Split** action on un-broken-down work
items decomposes them into tasks — mechanically (one task per repo) or
via Claude (`ANTHROPIC_API_KEY` required).

The board is served from the same `backlog` binary — no extra install,
no docker. Kill with Ctrl+C.

```bash
backlog serve --port 8080 --workspace ~/Dev/myproject --no-open
backlog serve --host 0.0.0.0    # expose to LAN (no auth — be careful)
```

Live updates use SSE, so the UI reflects YAML edits, claim creation,
and run status changes within ~200ms.

## CLI

```
backlog init                                          Initialize a workspace
backlog doctor [--repo <id>] [--json]                 Inspect workspace health
backlog status [--repo <id>]                          Workspace overview

backlog serve    [--port 7878] [--host 127.0.0.1]
                 [--workspace <path>] [--no-open]     Launch the kanban board
backlog repos    list|show|add|update|remove          Manage tracked repos
backlog work     add|list|show|move|update|remove
                 |plan|split|import                   Manage work items
backlog task     add|list|show|move|update|remove
                 |block|unblock|plan                  Manage tasks
backlog claim    start|check|finish|list|gc           Manage file-scope claims
                 [--duration <s>] [--agent <id>]
backlog hooks    status|install|uninstall [--all|--repo <id>]
                                                      Manage git hooks
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

Most `list` commands support practical filters, for example:

```bash
backlog repos list --enabled true
backlog work list --status ready --repo backlog
backlog task list --repo backlog --status blocked
backlog runs list --review --agent codex-default
backlog sources list --enabled true
```

## Workspace state

Backlog stores workspace state in `.backlog/`:

```
.backlog/
├── config.toml
├── work-items.yaml
├── tasks.yaml
├── sources.yaml
├── agents.yaml
├── claims/        # active and archived
├── runs/          # active and archived
└── worktrees/     # tracked run worktrees
```

You can edit YAML by hand, but `backlog repos`, `backlog work`, `backlog task`,
`backlog agents`, and `backlog sources` are designed to keep state consistent
without manual edits.

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
for development clarity and per-package licensing (the server is BSL
1.1; everything else is Apache).

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

- [`lint`](https://www.npmjs.com/package/lint) — universal linter CLI with AI-powered code review
- Backlog Cloud — managed hosted backend (coming)

## License

[Apache-2.0](./LICENSE)
