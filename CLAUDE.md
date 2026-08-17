# CLAUDE.md

Operating guide for Claude Code in this repository. Read it before changing
code. It is written in English to match the codebase; conversation with the
repository owner happens in French.

---

## 1. What this is, and where it's going

**Backlog is an orchestrator for AI coding agents.** You describe work as
tasks, it splits them into repository-scoped subtasks, locks the files each one
touches (*claims*), runs an agent in an isolated git worktree per subtask, and
surfaces the whole thing on a local kanban board. Everything is local: files on
disk, a local HTTP server, no hosted backend.

**This is a personal fork of [osmove/backlog](https://github.com/osmove/backlog)
(Apache-2.0), and it is deliberately diverging.** The upstream project was a
would-be commercial product: open-core CLI, an Electron desktop app, a
published npm package and SDK, and a paid SaaS (`backlog.so`) for accounts,
billing and OAuth proxying. None of that survives here — see §7.

The direction of this fork, in the owner's words: **a much more Claude
Code-oriented version, fixing the parts of the original that were rushed** —
the UX/UI, the raw power of the tool, and the documentation.

Concretely, that means three standing priorities. Treat them as the tie-breaker
when a change could go several ways:

1. **Claude Code is the reference runtime, not one provider among many.**
   Every LLM call now goes through the `AgentProvider` contract in
   `packages/core/src/providers/`, and `ClaudeCodeProvider` is the richest
   implementation of it: it is the only one that both runs coding tasks and
   answers one-shot prompts, and the only one that works on a subscription.
   Claude Code still has surface we do not use — skills, MCP servers, hooks,
   subagents, session resumption. Lean into it. Keep the other runtimes
   (`anthropic-api`, `custom`) working, but stop designing for parity with
   them.
2. **The tool should be powerful and legible, not merely feature-complete.**
   There are 152 API routes and 21 top-level CLI commands already. The gap is
   not features; it's that the sharp ones are buried and the flows are
   half-finished. Prefer deepening what exists over adding a 153rd route.
3. **Documentation and UX are part of the work, not a follow-up.** The
   upstream repo carried a strategy deck and a release runbook but no honest
   description of how the thing actually behaves. A change that is not
   discoverable in the UI and not written down is not finished.

Nothing here is published. Distribution is a single binary attached to a
GitHub Release, installed with `install.sh`.

---

## 2. The domain model

Read this before touching `packages/core` or `packages/server` — the
vocabulary is load-bearing and the state machines are the actual product.

```
Project ──┬── Repository (a git checkout the project tracks)
          │
          └── Task ──── SubTask ──── Run ──── Claim(s)
             (intent)  (per-repo)  (execution) (file locks)
```

- **Project** — a Backlog workspace. Either `in_repo` (`<repo>/.backlog/`) or
  `user_level` (`~/.backlog/<slug>/`, for multi-repo projects). Registered in
  `~/.backlog/projects.json`.
- **Repository** — a git checkout the project tracks, with an `access_mode`
  (`read-write` / `read-only` / `no-access`). This policy lives with the
  resource and **overrides** the agent's own `sandbox_mode`.
- **Task** — high-level intent. Statuses: `proposed → backlog → ready →
  in_progress → review → test → released → done`, plus `blocked`. Priorities
  `P0`–`P3`. `proposed` is agent-invented work: written only by the system when
  it reads a proposal in a trace, never runnable, and it leaves only by human
  review, only for `backlog` — enforced in `updateTaskStatus`.
- **SubTask** — an executable unit scoped to exactly one repository. Carries
  `scopes` (path globs), `claim_mode`, `depends_on`, `risk`, and an
  `execution` block (preferred agents, required capabilities, manual
  approval). Statuses: `queued → planned → running → waiting → review →
  completed`, plus `blocked` / `canceled`.
- **Run** — one agent execution against one subtask. Statuses: `queued →
  preparing → running → awaiting_review → succeeded`, plus `failed` /
  `blocked` / `interrupted` / `canceled`. Every run executes in its own
  isolated git worktree — there is no mode that edits the user's working
  checkout directly. A repository whose checkout has no git metadata cannot
  be run; the launcher skips it with `repository_not_a_git_repository`.
  Produces `artifacts` (branch, commit, patch, PR URL, logs…).
- **Claim** — a lock on a set of paths in a repository, `exclusive` or
  `shared`, with a heartbeat and an expiry. This is what stops two agents from
  editing the same file. Enforced at commit time by the git pre-commit hook.
- **Agent** — a configured executor: provider (`claude` / `anthropic-api` /
  `custom`), model, sandbox mode, concurrency, allowed repos, allowed risk
  levels, capabilities, and a `retry_policy` (`none` or `feedback`, which
  re-prompts with the previous attempt's failure).
- **Orchestrator** — the dispatcher loop. Modes `idle / running / paused /
  stopping`, with `max_agents`, a tick interval, and idle backoff. It builds
  an execution plan (`scheduler.ts`), starts runs (`run-launcher.ts`), reaps
  dead ones, and garbage-collects worktrees.

### On-disk layout of a project

```
.backlog/
  config.toml            project + repositories + git strategy
  tasks.yaml             tasks
  subtasks.yaml          subtasks
  agents.yaml            configured agents
  users.yaml             local assignable people
  sources.yaml           external source connectors
  sync-conflicts.json
  claims/{active,archive}/<claim-id>.json
  traces/<task-id>.ndjson   append-only agent trace journal, one file per task
  runs/{active,archive}/<run-id>/
      run.json           the Run record
      events.ndjson      live executor event stream (drives the UI)
      handoff.md         agent's handoff note, used for retry feedback
  worktrees/<repo>/<run-id>/    isolated git worktrees
  bin/backlog            shim the git hook calls
  cache/
```

`events.ndjson` is the spine of the live UI: the Claude executor runs
`claude -p --output-format stream-json --verbose` and pipes each NDJSON line
into it, so the board shows tool calls as they happen instead of a silent
five-minute gap. The orchestrator also uses its mtime as a liveness probe — a
run marked `running` whose event file has gone stale is treated as dead.

---

## 3. Architecture

Bun workspace monorepo, ~56k LOC, compiled into **one binary**.

| Package | LOC | Role |
| --- | --- | --- |
| `packages/board-ui` | 29k | Svelte 5 board (Vite → embedded in the binary) |
| `packages/server` | 9k | Hono API on `Bun.serve`, 152 routes, SSE |
| `packages/core` | 8k | Scheduler, orchestrator loop, runs, executors, worktrees |
| `packages/cli` | 6k | 21 top-level commands; `src/bin.ts` is the entrypoint |
| `packages/config` | 1.7k | Project config, registry, resolution, hook shim |
| `packages/connectors` | 0.8k | External source plumbing |
| `packages/schemas` | 0.7k | **Zod — source of truth for cross-boundary types** |
| `packages/git` | 0.4k | status, clone, branches, worktrees, diffs |
| `packages/claims` | 0.4k | claim store + claim context files |
| `packages/hooks` | 0.3k | git hook install/status |

**Dependency direction:** `schemas` ← everything. `cli` and `server` both sit
on `core`; the CLI's `serve` command boots the server in-process. Never add a
back-edge (core must not import server, server must not import cli). Shared
shapes go in `schemas`, not in a sideways import.

Internal packages expose TypeScript source directly
(`"main": "./src/index.ts"`) — no per-package build, no `dist/` inside a
package. Bun compiles the sources at build time. Imports keep the `.js`
extension (`./static.js` → `static.ts`); Bun and TypeScript both resolve it.

### Request flow

```
board (Svelte)
  └─ fetch /api/v1/*  ──►  Hono app  ──► ProjectResolver middleware
                                          (?project=<id> or x-backlog-project,
                                           falls back to the bound project)
                             └─► route ──► core service ──► YAML/JSON on disk
  └─ EventSource /api/v1/events  ◄── EventBus (per project) ◄── run events
```

Every API route resolves a project first, so one server serves several
projects and the board's project switcher works without a restart.

### How the AI is wired

Everything that talks to a model goes through **one contract**, `AgentProvider`
in `packages/core/src/providers/types.ts`. There is no other path.

```
providers/
  types.ts        the contract: describe / checkReadiness / executeRun
                  / complete / completeStructured
  registry.ts     provider id + alias → implementation
  process.ts      executable resolution, line-streaming spawn
  claude-code/    the reference runtime — command, auth, stream, catalogue
  custom/         any shell command the user brings
  anthropic-api/  the HTTP API: no checkout, prompts only
```

Two entry points sit on top:

- **`run-executor.ts`** — one coding task, whatever the runtime. It assembles
  the prompt, streams activity into `events.ndjson`, writes the log, collects
  artifacts, records usage and finalizes the run. The provider only owns the
  conversation with the model.
- **`ai-service.ts`** — the one-shot prompts (task naming, refinement, split
  planning). `resolveCompletionProvider` picks the runtime: a preferred agent
  wins when its runtime can answer and is ready, otherwise a prompt-only
  runtime is tried before a full coding agent.

Consequences worth knowing:

- **A model string is never validated.** Catalogues (`describe().models`,
  `describe().reasoning.levels`) are suggestions served to the UI over
  `GET /providers`; whatever the user types is forwarded to the runtime.
- **An API key is a choice, not a prerequisite.** `auth_mode` on an agent is
  `auto` (use a key if one exists, else the CLI's own session),
  `subscription` (never send a key — it is actively unset so an inherited
  `ANTHROPIC_API_KEY` cannot silently move billing to the API), or `api_key`
  (require one).
- **Adding a runtime is one folder and one line** in `providers/index.ts`.
  Nothing else in the codebase branches on a provider id.
- **Structured output is enforced by the runtime**, not coaxed out of it:
  `--json-schema` on the CLI, `output_config` on the API. The text-parsing
  fallback in `providers/json.ts` only covers an older CLI.

### The orchestrator chat

The chat has two backends and picks one at request time
(`server/src/lib/chat/backend.ts`): the HTTP API when a key is configured,
the local CLI otherwise. Both emit the same SSE events, so the drawer never
learns which answered.

Its nine tools live in `core/src/orchestrator-tools.ts` and are served twice:
as `Anthropic.Tool` literals to the API, and over MCP (`backlog mcp-server`,
`core/src/mcp/`) to the CLI. The confirmation gate — a write tool called
without `confirmed: true` returns a refusal instead of acting — lives with
the handlers, so it applies on both paths.

Two constraints learned from the CLI, both load-bearing:

- **Plan mode refuses MCP calls.** The chat therefore runs with
  `bypassPermissions`, and safety comes from denying every built-in tool
  explicitly.
- **`--allowedTools` only auto-approves; it does not exclude.** Without
  `--disallowedTools`, the model reaches for `Bash` the moment MCP is
  unhandy — it was observed reading `.backlog/tasks.yaml` directly rather
  than calling `list_tasks`.

**Two MCP audiences, one transport.** `backlog mcp-server` serves whichever
tool set `--audience` asks for, and defaults to `agent` — the less privileged
one — so a caller that forgets the flag loses tools rather than gaining the
ability to start runs. The chat asks for `orchestrator` explicitly
(`ORCHESTRATOR_TOOLS`, nine tools, confirmation-gated). A coding run gets
`AGENT_TOOLS`: exactly one tool, `trace_write`, attached by
`providers/claude-code/provider.ts` via `--mcp-config`. The two sets are
separate files and separate dispatchers, and
`packages/core/src/agent-tools.test.ts` asserts they never intersect — an
execution agent holding `start_subtask` could launch further runs and duplicate
itself, which is the runaway cycle `proposed` exists to close.

**That disjointness holds on the MCP channel only, and the gap is known.** An
execution agent also has `Bash`, a `backlog` binary on its PATH, and
`BACKLOG_PROJECT_DIR` pointing at the real project, so `backlog task move <id>
done` or `backlog orchestrator start` is reachable from a shell — contradicting
`trace_write`'s own "you cannot mark your own work done". Nothing gates the CLI
by audience today. Closing that is a feature with its own design, not a patch:
until it lands, read the least-privilege property as being about which tools the
model is *handed*, not about what it can *reach*.

---

## 4. The single binary — and the constraints it imposes

`bun run build` → `scripts/build.ts` → `dist/backlog` (~63 MB, everything
inside). Cross-compile with `--target bun-{linux,darwin}-{x64,arm64}`.

Four rules follow from this. Breaking any of them produces a binary that works
in dev and fails once shipped:

1. **Assets are imported, never read from disk.**
   `packages/server/src/ui-assets.ts` uses
   `import ... with { type: "file" }`; the default export is a path inside
   Bun's virtual filesystem that `Bun.file()` reads.
2. **Asset filenames must be stable**, because those imports are literal
   paths. `packages/board-ui/vite.config.ts` pins `rollupOptions.output`
   instead of using content hashes. Add an asset → add an import and a
   `UI_ASSETS` entry; `scripts/build.ts` fails the build if you forget.
3. **Never resolve runtime files relative to `import.meta.url`.** Inside the
   binary that is a `/$bunfs/` path with no sibling files. Embed instead.
4. **Never re-invoke the CLI via `process.argv[1]`.** In the binary that is
   also a `/$bunfs/` path — not executable. Use
   `packages/cli/src/self-exec.ts`. This already bit `backlog board` and the
   launchd/systemd unit.

Plus one runtime trap that is not about the binary but bites just as hard:

5. **Use `homeDir()` from `@backlog/config`, never `os.homedir()`.** Bun
   resolves `os.homedir()` from the password database and ignores a
   reassigned `HOME`. The test-suite sandboxes `HOME`; without this helper the
   tests write into the real `~/.backlog/` (they did, and left fixture
   directories behind).

The version is injected at build time from the root `package.json` via
`--define __BACKLOG_VERSION__`, falling back to `0.0.0-dev` in dev runs.

---

## 5. Local development

Bun 1.3+ is the only requirement — runtime, package manager, test runner,
bundler. No Node, npm, pnpm, tsx, tsup or vitest, and none should come back.

Developpment pattern: YAGNI, DRY, KISS, no tech for tech

```sh
bun install
```

That's the whole setup. Nothing needs the board pre-built: `typecheck` and
`test` pass without it (the `ui-assets.ts` imports are covered by ambient
declarations in `types/`, and `static.ts` guards its dynamic import),
`bun run build` builds the board itself, and `predev` →
`scripts/ensure-ui.ts` rebuilds it before a dev run only when it is missing
or stale. `bun run build:ui` exists if you want to force it.

**Two dev loops. Pick by what you're changing.**

*Backend / CLI* — run the CLI straight from source, no compile step:

```sh
bun run dev serve --port 7878 --project /path/to/a/project
# or, to open any folder without registering a project:
bun run dev serve --port 7878 --repository-only .
```

The board is served from `packages/board-ui/dist` on disk in a dev run, so a
rebuild shows up on refresh without recompiling the binary. `predev` keeps
that directory current: it stats the board sources and only runs Vite when
something changed, so `bun run dev status` stays instant (~50 ms) while
`bun run dev serve` always serves a fresh board. Any CLI command works the
same way: `bun run dev status`, `bun run dev task list`, …

*Board UI* — Vite dev server with HMR, in a second terminal:

```sh
bun run dev:ui          # http://localhost:5173
```

It proxies `/api` to `http://127.0.0.1:7878`. If your server is on another
port: `BACKLOG_API_URL=http://127.0.0.1:7993 bun run dev:ui`. Note Vite binds
`localhost` (IPv6) — use `localhost:5173`, not `127.0.0.1:5173`.

**Before committing:**

```sh
bun run typecheck       # tsc --noEmit + svelte-check
bun run test            # bun test ./packages
bun run build           # the real thing
```

`bun test` with **no path argument silently misses packages** — it only walks
part of the workspace. Always pass a path; `bun run test` scopes it to
`./packages`.

Tests run in a single process, so module-level state leaks between files. Keep
fixtures in temp dirs, and point `HOME` at a sandbox for anything touching
user-level storage.

---

## 6. Conventions

**Vocabulary** (user-facing copy, new APIs, new code names):
project · repository · task · subtask · run · claim · agent.

- Don't use "repo"/"repos" in new product copy or public names. Existing
  `repo` API fields, CLI flags, routes and storage keys are compatibility
  names — migrate them deliberately, not opportunistically.
- Don't introduce new user-facing "workspace" copy. It survives only where the
  storage concept is literally `.backlog/`.
- Task/subtask, never the legacy task terminology.

**CLI** — canonical top-level: `init`, `doctor`, `update`. Everything else is
namespaced (`task`, `subtask`, `claim`, `repositories`, `run`, `agents`,
`hooks`, `schedule`, `orchestrator`, `worktree`, `source`, `release`,
`secrets`, `daemon`, `project`, `trace`). Version flag is `-v, --version`.

**UI** — Svelte 5 (runes: `$state`, `$derived`, `$props`). Operational screens
stay dense and tool-like; no marketing layouts inside the app. Visible copy
goes in **both** `i18n/en.json` and `i18n/fr.json`. Repository removal means
detach from Backlog — never delete files or cascade. Destructive git
operations need explicit confirmation.

**Safety** — expired claims must never block a commit; the hook self-heals
orphaned pointers. `BACKLOG_SKIP_HOOK=1` is a maintenance escape hatch, not a
product path.

**Git hooks** — the pre-commit hook calls a shim
(`packages/config/src/shim.ts`) that execs the binary directly: no runtime, no
package manager at hook time. Resolution order is `$BACKLOG_DEV_BIN` →
`<project>/dist/backlog` → `backlog` on PATH → `~/.local/bin/backlog`.

**Release** — one version, in the root `package.json`. Bump it in the PR you
want released; merging to `main` builds four binaries, tags `v<version>`, and
attaches them to a GitHub Release. A merge that leaves the version untouched
releases nothing.

---

## 7. What was removed from upstream, and what's inert

Deleted outright: the Electron desktop app, the npm-published SDK
(`@osmove/backlog-sdk`), the Docker/GHCR pipeline, npm publishing, the
upstream governance files, and the `window.backlog` Electron bridge in the
board.

**Still present but inert: the hosted-service layer.** The `/cloud/*` routes
in `packages/server/src/routes/integrations.ts` proxy an account, billing and
OAuth service that upstream ran and this fork does not. `BACKLOG_CLOUD_URL`
now has no default, so those routes answer `503 cloud_disabled`, `/cloud/me`
reports `available: false`, and the board hides sign-in and billing. No
request ever reaches `backlog.so`.

This is a deliberate holding position, not a finished decision: the code is
woven through ~340 sites, so it was neutralised rather than excised. **If you
are working near it, prefer deleting the dead path over maintaining it.**
Integrations (GitHub, Jira) work in BYO mode — the user supplies their own
OAuth app credentials.

---

## 8. Known weak spots — the standing work list

These are measured, not guessed. They are the concrete form of "fix what was
rushed". When your change touches one of these areas, improving it is in
scope, not scope creep.

**UI/UX**

- **Monolithic components.** `CommitsView.svelte` is 2452 lines,
  `App.svelte` 2026, `api.ts` 2273, `IntegrationsView.svelte` 1400. These are
  not components, they're screens with everything inlined. Split as you touch
  them.
- **i18n is complete but bypassed.** 1119 keys, EN/FR perfectly aligned — and
  then ~13 components hardcode French strings anyway (`"Branche par défaut"`,
  `"Aucun checkout local"`, `throw new Error("Chemin local requis")`). Route
  every visible string through `t()`.
- **One 660 KB JS chunk**, no code splitting. Vite warns on every build.
- **Zero UI tests.** All 763 tests are backend; `svelte-check` is the only
  guard on 29k lines of UI.

**Tooling depth**

- Claude Code's real surface is still only partly used: skills, hooks and
  subagents have no representation in the provider contract. MCP does — a
  coding run is spawned with `--mcp-config` and Backlog's own `trace_write`
  tool — but the emitted flags (`command.ts`) are chiefly `--model`,
  `--effort`, `--permission-mode`, `--append-system-prompt` / `--system-prompt`,
  `--mcp-config` / `--strict-mcp-config`, `--allowedTools` /
  `--disallowedTools`, `--json-schema`, `--settings` and `--resume`. Session
  resumption is the chat's, not a run's: `--resume` is emitted only from
  `server/src/lib/chat/`, and nothing in the run pipeline supplies a session id.
- **Runs have no memory.** Each one is a fresh `claude -p`; nothing carries
  across attempts except a 4 KB tail of the previous failure's event summaries
  (and only when `retry_policy.mode = feedback`, which is off by default).
  A subtask learns nothing from the subtask it `depends_on`.
- Permission modes are coarse: `read-only` maps to `plan`, everything else to
  `bypassPermissions`. There is no per-tool or per-path story — and because
  plan mode refuses MCP calls, a `read-only` agent cannot reach `trace_write`
  at all; it has to fall back to `backlog trace write`.
- Going through the CLI costs context: a one-shot completion still pays
  ~25k cache-creation tokens for Claude Code's own system prompt, even with
  `--system-prompt` replacing ours. `--bare` would cut it but forces API-key
  auth, defeating the point. The API path stays cheaper when a key exists.
- The chat's CLI backend spawns a whole Claude Code session per turn. It is
  noticeably slower than the API path, which is why a configured key still
  wins.
- The scheduler is a single-tick loop with idle backoff. Dependencies
  (`depends_on`) and claims exist, but there is no real planning or
  parallelism strategy beyond `max_agents`.

**Engineering hygiene**

- **No linter or formatter.** Nothing enforces style; conventions live only in
  this file.
- Tests share one process and previously wrote into the real `~/.backlog/`.
  The `homeDir()` fix closed that, but isolation is still by convention.
- Legacy `repo`/`repos` naming persists across API fields, flags and storage
  keys, with no migration planned.

---

## 9. Where to change what

| Change | Touch |
| --- | --- |
| CLI command or flag | `packages/cli/src/commands/`, README command list, tests |
| Board flow | Svelte component, `i18n/{en,fr}.json`, `lib/api.ts`, route tests |
| API shape | route schema, core service, `lib/api.ts` wrapper, tests |
| Cross-boundary data shape | `packages/schemas` first, then all call sites |
| Run/scheduling behavior | `packages/core` (`scheduler`, `orchestrator-loop`, `run-launcher`) |
| How a run is driven, whatever the runtime | `packages/core/src/run-executor.ts` |
| One runtime's behavior | `packages/core/src/providers/<provider>/` |
| Adding a runtime | new folder under `providers/`, one entry in `providers/index.ts` |
| What the agent is told to do | `packages/core/src/run-prompt.ts` |
| Non-run AI calls (naming, refining, splitting) | `packages/core/src/ai-service.ts` |
| Git behavior | `packages/git` or `packages/core`, tests on real temp repos |
| Hook behavior | `packages/hooks`, `packages/config/src/shim.ts`, hook status UI |
| Build / embedding | `scripts/build.ts`, `ui-assets.ts`, §4 above |

Deeper references: [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) (engineering
guide), [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md) (known operator
failures), [README.md](./README.md) (install and usage).

## 10. Git rules

Every pr that is opened, should be merge directly and after work, the current branch of the repo 
should be main and up to date with the remote, so:

- open a pr after work
- merge pr directly
- git checkout main && git pull
- delete old worktree directly
