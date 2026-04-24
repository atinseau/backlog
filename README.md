# Backlog

Local-first AI execution control plane for coding teams and coding subagents.

Backlog ingests work from sources like Markdown, CSV, and Jira, turns backlog into executable tasks, protects file scopes with claims, and prepares isolated worktree runs for parallel execution.

## Current MVP

- `backlog init`
- `backlog doctor`
- `backlog repos list|show|add|update|remove`
- `backlog work add|list|show|move|update|remove|plan|split|import`
- `backlog work update`
- `backlog task add|list|show|move|update|remove|block|unblock|plan`
- `backlog claim start|check|finish|list`
- `backlog claim start|check|finish|list|gc`
- `backlog hooks status|install|uninstall`
- `backlog schedule simulate|explain|run`
- `backlog runs list|show|gc`
- `backlog runs interrupt|resume`
- `backlog runs review|approve|request-changes|complete|fail|handoff`
- `backlog agents list|show|enable|disable|update|validate|health`
- `backlog sources add|list|enable|disable|update|remove|validate|sync`
- `backlog sources push`
- `backlog sources conflicts|resolve`
- `backlog release snapshot`
- `backlog worktree list|gc`

Most `list` commands now support practical filters, for example:
- `backlog repos list --enabled true`
- `backlog work list --status ready --repo backlog`
- `backlog task list --repo backlog --status blocked`
- `backlog runs list --review --agent codex-default`
- `backlog sources list --enabled true`

`backlog release snapshot` now reports dirty repos and per-repo run counts. `backlog worktree list` shows the worktrees Backlog knows about through run records, and `backlog worktree gc --dry-run` previews cleanup before deleting anything.

`backlog release snapshot` also supports `--repo <id>`, `--include-disabled`, and `--output <path>` when you want a targeted or exportable snapshot for one repo or a full workspace report.

`backlog status --repo <id>` now focuses the workspace view on one repo and still keeps a compact per-repo breakdown handy. `backlog doctor --repo <id>` also drills into one repo and now reports `dirty` state plus branch/default-branch mismatches.

Use `backlog repos add` and `backlog repos update` when you want to manage a multi-repo workspace without editing `config.toml` by hand. Forced repo removal can also scrub linked tasks, work items, and agent scopes when you intentionally retire one repo from the workspace.

## Quickstart

```bash
corepack pnpm install
corepack pnpm build
node packages/cli/dist/bin.js init --name my-workspace
node packages/cli/dist/bin.js doctor
```

Create a local work item and a task:

```bash
node packages/cli/dist/bin.js work add --title "Build the scheduler"
node packages/cli/dist/bin.js work split WI-xxxx --repo backlog --scope backlog=packages/core/src/**
node packages/cli/dist/bin.js task add --work-item WI-xxxx --title "Implement scheduler" --repo backlog --preferred-agent manual-default --require-capability edit_code
node packages/cli/dist/bin.js schedule simulate
node packages/cli/dist/bin.js schedule explain --work-item WI-xxxx
node packages/cli/dist/bin.js schedule run --approve
```

Add a source and sync:

```bash
node packages/cli/dist/bin.js sources add markdown --id notes --path backlog.md
node packages/cli/dist/bin.js sources sync
node packages/cli/dist/bin.js work import
node packages/cli/dist/bin.js sources conflicts
node packages/cli/dist/bin.js sources resolve --work-item WI-xxxx --use local
```

## Workspace State

Backlog stores local state in `.backlog/`:

- `config.toml`
- `work-items.yaml`
- `tasks.yaml`
- `sources.yaml`
- `agents.yaml`
- `claims/`
- `runs/`
- `worktrees/`

## Agents

You can add a `custom` provider in `.backlog/agents.yaml` with a shell `command`.

When `schedule run --agent <id>` targets a custom agent, Backlog will execute that command inside the run worktree and mark the run succeeded or failed from the exit code.

Backlog also supports `provider: codex`. A Codex agent runs `codex exec` inside the isolated worktree, captures the last agent message, and stores it on the run as a summary artifact.

`init` now seeds a disabled `codex-default` agent in `.backlog/agents.yaml` that you can enable and tune with `model`, `profile`, `sandbox_mode`, and an optional `command` override for the Codex executable path.

Backlog also supports `provider: claude` through `claude -p`, using the same isolated worktree flow. `init` seeds a disabled `claude-default` agent as well.

Use `backlog agents enable|disable|update` when you want to flip a seeded agent on, change its model, override its executable, or narrow its allowed repos/risk/capabilities without editing YAML by hand.

Both `codex` and `claude` now attach richer run artifacts:
- summary
- executor log
- changed files detected in the worktree

By default, `codex` and `claude` successful runs now land in `awaiting_review` instead of auto-completing the task. Their claims are released, but the run and worktree stay available for review.

Use `backlog runs list --review` to see the review queue, `backlog runs approve <run-id>` to accept a reviewed run, and `backlog runs request-changes <run-id> --reason "..."` to archive the run with a handoff while returning the task to `planned`.

Terminal run transitions now archive linked claims automatically, so finished runs stop blocking future scheduling.

## Split Planning

`backlog work split` turns one backlog item into repo-scoped executable tasks.

- Use `--repo` to override target repos.
- Use `--mode serial` to chain generated tasks in order.
- Use `--scope repo=glob` to seed initial safe claim scopes for each generated task.

## Scheduling Explainability

`backlog schedule explain` shows the chosen action for each selected task plus the ranked candidate agents and why they were accepted or rejected.

`backlog schedule run` now supports `--json` and reports both started runs and skipped tasks, including cases where a forced or assigned agent is unavailable or not executable.

`backlog init` now auto-registers the current git repo when it can, using the workspace name as a stable repo id and the current branch as the default branch. `backlog doctor --json` also reports repo-level warnings and detected branches.

`backlog hooks status` inspects the current repo’s pre-commit hook and tells you whether it is Backlog-managed and whether it points at the local shim created in `.backlog/bin/backlog`.

In multi-repo workspaces, `backlog hooks status|install|uninstall --all` lets you audit or roll out the managed hook across every configured repo in one pass. You can also target one configured repo explicitly with `--repo <id>`.

## Source Sync

- `sources push --all` pushes every source-linked work item that supports outbound sync.
- `sources push` now refuses to push an item while it still has pending sync conflicts, unless you pass `--allow-conflicts`.
- `sources resolve --work-item <id> --use local|external` resolves every pending conflict for that work item in one step.

## Maintenance

- `claim gc` archives expired active claims that would otherwise stay on disk.
- `runs gc --all` purges archived run directories when you want to clean local runtime history.

## Development

```bash
corepack pnpm install
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```
