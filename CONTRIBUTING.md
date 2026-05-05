# Contributing

Thanks for contributing to `backlog`.

This is a pnpm monorepo. The `backlog` CLI lives in `packages/cli/`.
Internal workspace packages (`@backlog/core`, `@backlog/claims`,
`@backlog/schemas`, etc.) live next to it but are not published independently:
they're bundled into the `backlog` tarball at publish time.

Before code changes, read:

- [`AGENTS.md`](./AGENTS.md) for repository operating rules
- [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md) for package boundaries,
  naming, tests, UI conventions, and local board workflow
- [`RELEASING.md`](./RELEASING.md) before any version bump or deploy

## Development Setup

```sh
git clone https://github.com/osmove/backlog.git
cd backlog
corepack enable
pnpm install
pnpm test
pnpm typecheck
```

## Repository layout

```
backlog/
├── package.json                    (private, "backlog-monorepo")
├── pnpm-workspace.yaml
├── packages/
│   ├── cli/                        (public, "backlog", Apache-2.0)
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

## Tests And Checks

```sh
pnpm typecheck
pnpm --filter @backlog/board-ui typecheck
pnpm test
```

## Build

```sh
pnpm --filter "backlog..." build       # CLI + transitive workspace deps
pnpm --filter @backlog/desktop build   # Electron main/preload bundle
pnpm --filter backlog pack:check       # npm tarball dry-run
```

## Before You Commit

- `pnpm typecheck`
- `pnpm --filter @backlog/board-ui typecheck`
- `pnpm test`
- `pnpm --filter "backlog..." build`
- `pnpm --filter backlog pack:check`

## Commits and Releases

- Update docs when behavior changes. Use `docs/DEVELOPMENT.md` for the
  "what to update" checklist.
- For CLI/Desktop releases, follow `RELEASING.md`; do not publish manually
  unless the runbook says to.

## Code Guidelines

- Type-safe boundaries: prefer Zod schemas in `packages/schemas/` for any shape that crosses module boundaries
- Local-first: every cloud feature must have a local-only fallback
- Vendor-neutral: connectors should not import vendor SDKs at the top level — use lazy imports
- User-facing language says project/repository/task/subtask/run/claim. Avoid
  new "workspace" copy or legacy task terminology.

## License

`packages/cli/` ships under [Apache-2.0](./packages/cli/LICENSE).

Backlog Cloud (the hosted backend) is operated by Osmove and is not part of this open-source repo.
