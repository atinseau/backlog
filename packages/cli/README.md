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
corepack pnpm install
corepack pnpm build

node packages/cli/dist/bin.js init --name my-workspace
node packages/cli/dist/bin.js doctor
```

Create a local work item, split it into tasks, and run the scheduler:

```bash
node packages/cli/dist/bin.js work add --title "Build the scheduler"
node packages/cli/dist/bin.js work split WI-xxxx --repo backlog \
  --scope backlog=packages/core/src/**
node packages/cli/dist/bin.js task add \
  --work-item WI-xxxx \
  --title "Implement scheduler" \
  --repo backlog \
  --preferred-agent manual-default \
  --require-capability edit_code
node packages/cli/dist/bin.js schedule simulate
node packages/cli/dist/bin.js schedule explain --work-item WI-xxxx
node packages/cli/dist/bin.js schedule run --approve
```

Add a source and sync work items in:

```bash
node packages/cli/dist/bin.js sources add markdown --id notes --path backlog.md
node packages/cli/dist/bin.js sources sync
node packages/cli/dist/bin.js work import
node packages/cli/dist/bin.js sources conflicts
node packages/cli/dist/bin.js sources resolve --work-item WI-xxxx --use local
```

## CLI

```
backlog init                                          Initialize a workspace
backlog doctor [--repo <id>] [--json]                 Inspect workspace health
backlog status [--repo <id>]                          Workspace overview

backlog repos    list|show|add|update|remove          Manage tracked repos
backlog work     add|list|show|move|update|remove
                 |plan|split|import                   Manage work items
backlog task     add|list|show|move|update|remove
                 |block|unblock|plan                  Manage tasks
backlog claim    start|check|finish|list|gc           Manage file-scope claims
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

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md) for the multi-target plan covering
remote sources, remote repos, remote sandboxes, remote executors, deploy
targets, and the upcoming UI.

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
- [`backlog-server`](https://github.com/osmove/backlog) (in this repo, `packages/server/`) — self-hostable BUSL-1.1 backend
- Backlog Cloud — managed hosted version (planned)

## License

[Apache-2.0](./LICENSE) for the CLI. The optional self-hostable server (`backlog-server`) ships under [BUSL-1.1](../server/LICENSE) (converts to Apache-2.0 in 2030).
