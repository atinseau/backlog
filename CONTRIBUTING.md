# Contributing

Thanks for contributing to `backlog`.

This is a pnpm monorepo. The `backlog` CLI lives in `packages/cli/`. Internal workspace packages (`@backlog/core`, `@backlog/claims`, `@backlog/schemas`, etc.) live next to it but are not published independently — they're bundled into the `backlog` tarball at publish time.

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
pnpm test                   # workspace-wide vitest run
pnpm --filter backlog test  # CLI only
```

## Build

```sh
pnpm --filter backlog build  # bundles all internal packages into a single CLI tarball
```

## Before You Commit

- `pnpm typecheck`
- `pnpm test`
- `pnpm --filter backlog build`

## Commits and Releases

- Update `README.md` or `docs/ROADMAP.md` when behavior changes
- For CLI releases: bump `packages/cli/package.json#version`, then `cd packages/cli && npm publish`

## Code Guidelines

- Type-safe boundaries: prefer Zod schemas in `packages/schemas/` for any shape that crosses module boundaries
- Local-first: every cloud feature must have a local-only fallback
- Vendor-neutral: connectors should not import vendor SDKs at the top level — use lazy imports

## License

`packages/cli/` ships under [Apache-2.0](./packages/cli/LICENSE).

Backlog Cloud (the hosted backend) is operated by Osmove and is not part of this open-source repo.
