# Backlog

Orchestrator for AI coding agents — claims, isolated worktrees, parallel runs,
and a local kanban board. Everything ships as **one self-contained binary**
built with `bun build --compile`: the CLI, the HTTP server, and the Svelte
board are all embedded, with no runtime to install alongside it.

Personal fork of [osmove/backlog](https://github.com/osmove/backlog)
(Apache-2.0). The hosted-service, npm-publishing, Electron desktop, and SDK
parts of the upstream project are not carried over.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/atinseau/backlog/main/install.sh | bash
```

The script picks the right binary for your platform from the latest GitHub
Release, verifies its checksum, and installs it into `/usr/local/bin` (or
`~/.local/bin` when that isn't writable). `backlog update` re-runs it.

## Use

```sh
backlog init          # set up .backlog/ in the current project
backlog serve         # start the board at http://127.0.0.1:7878
backlog status        # compact project summary
backlog --help        # every command
```

### Agents

An agent is a configured runtime the orchestrator can dispatch work to.

```sh
backlog agents providers                 # what an agent can be built on
backlog agents add my-claude --provider claude-code --model opus
backlog agents list
backlog agents show my-claude
backlog agents rm my-claude
```

`claude-code` runs the locally installed Claude Code CLI, so it uses whatever
that CLI is logged in as — **an Anthropic subscription needs no API key**. Pin
that with `--auth-mode subscription` if you want to be sure a key is never
sent; use `--auth-mode api_key` to require one instead. `codex` and the
`anthropic-api` runtime do need a key, stored with `backlog secrets set`.

Models and effort levels are forwarded to the runtime as typed, so a model
released tomorrow works today: `--model claude-opus-4-9` is passed straight
through.

### The orchestrator chat

The board's chat drawer answers questions about what is running and can
dispatch actions on your behalf. It works two ways:

- **With `ANTHROPIC_API_KEY`** — talks to the API directly. Faster.
- **Without one** — drives your local `claude` CLI, which reaches Backlog
  through an MCP server the binary serves itself. Works on a subscription.

Either way, anything that changes state (starting the orchestrator, launching
a subtask) is refused until you approve it in plain language.

## Develop

Requires [Bun](https://bun.sh) 1.3+. Nothing else — no Node, no pnpm.

```sh
bun install
bun run dev:all       # server + board with HMR, one command → :5173

bun run typecheck     # tsc + svelte-check
bun run test          # bun test, 54 files
bun run build         # → dist/backlog
```

`dev:all` runs both halves under `bun run --parallel` with prefixed output, and
Ctrl-C stops the pair. With no setup it opens the checkout it lives in. Three
variables tune it:

| Variable | Default | Effect |
| --- | --- | --- |
| `BACKLOG_DEV_PORT` | `7878` | API port. The Vite proxy follows it. |
| `BACKLOG_DEV_UI_PORT` | `5173` | Board port. |
| `BACKLOG_DEV_PROJECT` | this checkout | Directory to work on. |

**Point it at any other repository** — that is the normal way to dogfood it:

```sh
BACKLOG_DEV_PROJECT=~/code/my-app bun run dev:all
```

No `backlog init` required there. A directory without `.backlog/` opens against
an ephemeral board under `~/.backlog/.repo-boards/`; run `bun run dev init` in
it once if you want tasks, claims and runs to survive. The launcher picks the
mode from what it finds and says which one it used.

Run a second stack beside the first with
`BACKLOG_DEV_PORT=7993 BACKLOG_DEV_UI_PORT=5199 bun run dev:all`.

Each half still runs alone — `bun run dev:server`, `bun run dev:ui` — and any
CLI command works from source: `bun run dev status`, `bun run dev task list`.
Use `localhost:5173`, not `127.0.0.1:5173`: Vite binds IPv6.

`bun run build --target bun-linux-x64` cross-compiles; supported targets are
`bun-{linux,darwin}-{x64,arm64}`.

[CLAUDE.md](./CLAUDE.md) is the deep reference: architecture, domain model,
where this fork is heading, and the known weak spots.
[docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) covers package boundaries and
conventions; [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md) covers known
failure modes.

## Release

Bump `version` in the root `package.json` in a PR. When it lands on `main`,
CI builds all four binaries, tags `v<version>`, and attaches them to a GitHub
Release. A merge that leaves the version untouched releases nothing.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
