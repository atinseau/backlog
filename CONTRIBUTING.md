# Contributing

Thanks for contributing to `backlog`.

This is a pnpm monorepo with two publishable packages today:

- `packages/cli/` — the `backlog` CLI (Apache-2.0, npm: `backlog`)
- `packages/server/` — the `backlog-server` self-hostable backend (BUSL-1.1)

## Development Setup

```sh
git clone https://github.com/osmove/backlog.git
cd backlog
corepack enable
pnpm install
pnpm test
pnpm typecheck
```

## Repo layout

```
backlog/
├── package.json                    (private, "backlog-monorepo")
├── pnpm-workspace.yaml
├── packages/
│   ├── cli/                        (public, "backlog", Apache-2.0)
│   ├── server/                     (public, "backlog-server", BUSL-1.1)
│   ├── core/, claims/, ...         (workspace-internal)
│   └── schemas/                    (workspace-internal, shared types)
├── docs/
│   └── ROADMAP.md
├── README.md
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── SECURITY.md
└── .github/
```

## Tests

```sh
pnpm test                                   # workspace-wide vitest run
pnpm --filter backlog test                  # CLI only
pnpm --filter backlog-server test   # server only
```

## Build

```sh
pnpm --filter backlog build                  # CLI
pnpm --filter backlog-server build   # server
```

## Before You Commit

- `pnpm typecheck`
- `pnpm test`
- relevant `pnpm --filter <pkg> build`

Backlog uses its own claim system internally for change scoping. Most repos with backlog hooks installed will require a claim before commit; for this repo specifically, contributing without a claim is fine — the hook isn't enforced upstream.

## Commits and Releases

- Update `README.md` or `docs/ROADMAP.md` when behavior changes
- For CLI releases (`backlog`): bump `packages/cli/package.json#version`, then publish from that directory
- For server releases (`backlog-server`): bump `packages/server/package.json#version`, then publish from that directory

## Code Guidelines

- Type-safe boundaries: prefer Zod schemas in `packages/schemas/` for any shape that crosses the CLI/server line
- Local-first: every server feature must have a local-only fallback in the CLI
- Vendor-neutral: connectors should not import vendor SDKs at the top level — use lazy imports

## Two-license model

- `packages/cli/`: Apache-2.0 — anyone can use, fork, modify freely
- `packages/server/`: BUSL-1.1 → Apache-2.0 (change date 2030-04-25) — self-hosting permitted, hosted commercial use against Backlog Cloud requires a commercial license
