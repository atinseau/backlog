# Cockpit

Local-first AI execution control plane for coding teams and coding subagents.

Cockpit ingests work from sources like Markdown, CSV, and Jira, turns backlog into executable tasks, protects file scopes with claims, and prepares isolated worktree runs for parallel execution.

## Current MVP

- `cockpit init`
- `cockpit doctor`
- `cockpit work add|list|show|move|plan`
- `cockpit task add|list|show|move|plan`
- `cockpit claim start|check|finish|list`
- `cockpit schedule simulate|run`
- `cockpit runs list|show`
- `cockpit sources add|list|validate|sync`
- `cockpit release snapshot`

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
node packages/cli/dist/bin.js task add --work-item WI-xxxx --title "Implement core logic" --repo <repo-id>
node packages/cli/dist/bin.js schedule simulate
```

Add a source and sync:

```bash
node packages/cli/dist/bin.js sources add markdown --id notes --path backlog.md
node packages/cli/dist/bin.js sources sync
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

## Development

```bash
corepack pnpm install
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```
