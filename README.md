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

## Develop

Requires [Bun](https://bun.sh) 1.3+. Nothing else — no Node, no pnpm.

```sh
bun install
bun run typecheck     # tsc + svelte-check
bun run test          # bun test, 54 files
bun run build         # → dist/backlog

bun run dev serve --port 7878 --repository-only .   # CLI from source
bun run dev:ui                                      # board with HMR → :5173
```

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
