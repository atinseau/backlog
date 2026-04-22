# Cockpit

Local-first AI execution control plane for coding teams and coding subagents.

Cockpit ingests work from sources like Markdown, CSV, and Jira, turns backlog into executable tasks, protects file scopes with claims, and prepares isolated worktree runs for parallel execution.

## Current MVP

- `cockpit init`
- `cockpit doctor`
- `cockpit work add|list|show|move|plan|split|import`
- `cockpit task add|list|show|move|plan`
- `cockpit claim start|check|finish|list`
- `cockpit schedule simulate|explain|run`
- `cockpit runs list|show`
- `cockpit runs interrupt|resume`
- `cockpit runs review|complete|fail|handoff`
- `cockpit agents list|validate|health`
- `cockpit sources add|list|validate|sync`
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

## Custom Agents

You can add a `custom` provider in `.cockpit/agents.yaml` with a shell `command`.

When `schedule run --agent <id>` targets a custom agent, Cockpit will execute that command inside the run worktree and mark the run succeeded or failed from the exit code.

Terminal run transitions now archive linked claims automatically, so finished runs stop blocking future scheduling.

## Split Planning

`cockpit work split` turns one backlog item into repo-scoped executable tasks.

- Use `--repo` to override target repos.
- Use `--mode serial` to chain generated tasks in order.
- Use `--scope repo=glob` to seed initial safe claim scopes for each generated task.

## Scheduling Explainability

`cockpit schedule explain` shows the chosen action for each selected task plus the ranked candidate agents and why they were accepted or rejected.

## Development

```bash
corepack pnpm install
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```
