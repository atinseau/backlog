# Cockpit

Local-first AI execution control plane for coding teams and coding subagents.

Cockpit ingests work from sources like Markdown, CSV, and Jira, turns backlog into executable tasks, protects file scopes with claims, and prepares isolated worktree runs for parallel execution.

## Current MVP

- `cockpit init`
- `cockpit doctor`
- `cockpit work add|list|show|move|plan|split|import`
- `cockpit work update`
- `cockpit task add|list|show|move|update|block|unblock|plan`
- `cockpit claim start|check|finish|list`
- `cockpit claim start|check|finish|list|gc`
- `cockpit hooks status|install|uninstall`
- `cockpit schedule simulate|explain|run`
- `cockpit runs list|show|gc`
- `cockpit runs interrupt|resume`
- `cockpit runs review|approve|request-changes|complete|fail|handoff`
- `cockpit agents list|show|enable|disable|update|validate|health`
- `cockpit sources add|list|enable|disable|update|validate|sync`
- `cockpit sources push`
- `cockpit sources conflicts|resolve`
- `cockpit release snapshot`
- `cockpit worktree gc`

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
node packages/cli/dist/bin.js work split WI-xxxx --repo cockpit --scope cockpit=packages/core/src/**
node packages/cli/dist/bin.js task add --work-item WI-xxxx --title "Implement scheduler" --repo cockpit --preferred-agent manual-default --require-capability edit_code
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

Cockpit stores local state in `.cockpit/`:

- `config.toml`
- `work-items.yaml`
- `tasks.yaml`
- `sources.yaml`
- `agents.yaml`
- `claims/`
- `runs/`
- `worktrees/`

## Agents

You can add a `custom` provider in `.cockpit/agents.yaml` with a shell `command`.

When `schedule run --agent <id>` targets a custom agent, Cockpit will execute that command inside the run worktree and mark the run succeeded or failed from the exit code.

Cockpit also supports `provider: codex`. A Codex agent runs `codex exec` inside the isolated worktree, captures the last agent message, and stores it on the run as a summary artifact.

`init` now seeds a disabled `codex-default` agent in `.cockpit/agents.yaml` that you can enable and tune with `model`, `profile`, `sandbox_mode`, and an optional `command` override for the Codex executable path.

Cockpit also supports `provider: claude` through `claude -p`, using the same isolated worktree flow. `init` seeds a disabled `claude-default` agent as well.

Use `cockpit agents enable|disable|update` when you want to flip a seeded agent on, change its model, override its executable, or narrow its allowed repos/risk/capabilities without editing YAML by hand.

Both `codex` and `claude` now attach richer run artifacts:
- summary
- executor log
- changed files detected in the worktree

By default, `codex` and `claude` successful runs now land in `awaiting_review` instead of auto-completing the task. Their claims are released, but the run and worktree stay available for review.

Use `cockpit runs list --review` to see the review queue, `cockpit runs approve <run-id>` to accept a reviewed run, and `cockpit runs request-changes <run-id> --reason "..."` to archive the run with a handoff while returning the task to `planned`.

Terminal run transitions now archive linked claims automatically, so finished runs stop blocking future scheduling.

## Split Planning

`cockpit work split` turns one backlog item into repo-scoped executable tasks.

- Use `--repo` to override target repos.
- Use `--mode serial` to chain generated tasks in order.
- Use `--scope repo=glob` to seed initial safe claim scopes for each generated task.

## Scheduling Explainability

`cockpit schedule explain` shows the chosen action for each selected task plus the ranked candidate agents and why they were accepted or rejected.

`cockpit schedule run` now supports `--json` and reports both started runs and skipped tasks, including cases where a forced or assigned agent is unavailable or not executable.

`cockpit init` now auto-registers the current git repo when it can, using the workspace name as a stable repo id and the current branch as the default branch. `cockpit doctor --json` also reports repo-level warnings and detected branches.

`cockpit hooks status` inspects the current repo’s pre-commit hook and tells you whether it is Cockpit-managed and whether it points at the local shim created in `.cockpit/bin/cockpit`.

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
