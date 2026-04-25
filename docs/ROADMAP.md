# Backlog — Multi-target Roadmap

Backlog is built around four swappable interfaces. Each one starts with the
simplest local implementation, then grows toward remote and managed targets.
Users compose freely: a project can use Markdown for sources, GitHub for the
repo, a local worktree for the sandbox, Claude Code for the agent, and Heroku
for deploy — or any other combination.

## Architectural invariants

- **No vendor lock-in.** GitHub, Linear, Heroku, Anthropic, OpenAI are all
  swappable. Backlog defines stable interfaces; vendors plug in.
- **Default mode stays fully local.** No account, no signup, no network — you
  can run Backlog end-to-end without ever calling out.
- **Remote modes are opt-in per source/repo/sandbox/executor/target.** You
  choose which layer goes remote and which stays on your machine.
- **One mental model across targets.** Whether the agent runs locally or on a
  Coder workspace, Backlog reports the same shape of run, claim, and review.

## Phase 1 — Local foundation (current)

| Layer       | Implementation                                |
|-------------|-----------------------------------------------|
| Sources     | markdown, csv, jira                           |
| Repos       | local git path                                |
| Sandboxes   | local `git worktree`                          |
| Executors   | claude code, codex, custom command            |
| Deploy      | `git push` to whatever remote the repo has    |

This phase is shipped. Everything else below is roadmap.

## Phase 2 — Remote sources

Pull work items from where teams already track them.

- GitHub Issues
- GitHub Projects v2
- Linear
- Asana
- Notion databases
- Trello
- Generic webhook ingest

Outbound `sources push` already exists for the current connectors. New
connectors should support both pull and push where the upstream allows it.

## Phase 3 — Remote repos

Today a repo is a local path. Phase 3 lets a repo be addressed by URL and
cloned on demand into the workspace.

- GitHub remotes (HTTPS / SSH)
- GitLab remotes
- Bitbucket
- Custom git over SSH
- Read-only sources for non-git tasks (FTP, S3 buckets, mounted volumes) for
  tasks that consume artifacts rather than mutate code

## Phase 4 — Remote sandboxes

Worktrees today are local. Phase 4 lets a run execute in an ephemeral remote
environment, while Backlog still owns the orchestration, claim resolution, and
run lifecycle.

- GitHub Codespaces
- Gitpod
- Coder workspaces
- Self-hosted Docker / Kubernetes pods
- fly.io machines (ephemeral)
- Anthropic-managed sandboxes when available

The sandbox interface stays minimal: provision, execute, capture artifacts,
tear down.

## Phase 5 — Remote executors

Today the agent CLI runs on the host. Phase 5 lets the agent itself be remote.

- Claude Code over SSH (run on a remote box)
- Codex over SSH
- Anthropic Managed Agents (HTTP API)
- Codex API
- Custom HTTP executor protocol (so anyone can plug in their own)
- Hosted Backlog Cloud — strictly opt-in, never required

## Phase 6 — Deploy targets

Run review currently produces a branch and (optionally) a `git push`. Phase 6
adds first-class deploy targets so an approved run can ship.

- Heroku (`git push heroku`)
- Vercel build hooks
- Netlify build hooks
- fly.io
- Render
- Railway
- Cloudflare Pages
- Generic SSH deploy
- Generic FTP / SFTP upload
- Custom: any shell command keyed off the approved run

Deploys run after review/approve and are idempotent: a re-approve replays the
same deploy.

## UI (parallel track, not phase-gated)

A Backlog UI is planned alongside this roadmap. The CLI is the first client of
the engine, not the engine itself. The UI will consume the same state (`.backlog/`)
and the same APIs as the CLI, so any combination of CLI and UI works.

## Non-goals (for now)

- Replacing Linear/Jira as a primary tracker UI. Backlog connects to them, it
  doesn't try to outshine them on issue management ergonomics.
- A managed cloud as the default mode. Backlog Cloud, when it ships, will be a
  convenience, not a prerequisite.
- Per-language/per-framework opinions baked in. Backlog stays agent-agnostic
  and language-agnostic.
