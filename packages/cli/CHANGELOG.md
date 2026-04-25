# Changelog

All notable changes to the `backlog` CLI are documented here.

## [Unreleased]

### Notes

- The repo is a pnpm monorepo. The `backlog` CLI lives in `packages/cli/`. The OSS server (`backlog-server`) lives in `packages/server/`.

## [1.0.3] - 2026-04-25

### Changed

- Aligned `-v, --version` flag with the rest of the osmove CLIs (lowercase). The previous default `-V, --version` (Commander default) still works as legacy.

## [1.0.2] - 2026-04-25

### Changed

- Internal: standardized version flag handling.

## [1.0.1] - 2026-04-25

### Fixed

- `--version` now correctly reflects the published package version. Previously it returned `1.0.0` regardless of the npm version due to a hardcoded constant. Version is now injected at build time by tsup from `package.json#version`.

## [1.0.0] - 2026-04-25

### Added

- First public release of the `backlog` CLI.
- `backlog init` — initialize a workspace in the current directory.
- `backlog doctor` — validate workspace health, detect repo configuration drift.
- `backlog status` — compact workspace summary across configured repos.
- `backlog repos add|list|show|update|remove` — manage tracked repos.
- `backlog work add|list|show|move|update|remove|plan|split|import` — manage normalized work items.
- `backlog task add|list|show|move|update|remove|block|unblock|plan` — manage executable tasks.
- `backlog claim start|check|finish|list|gc` — manage file-scope claims.
- `backlog hooks install|uninstall|status` — install managed git hooks.
- `backlog schedule simulate|explain|run` — plan and execute task scheduling against agents.
- `backlog runs list|show|gc|interrupt|resume|review|approve|request-changes|complete|fail|handoff` — manage agent execution runs.
- `backlog agents list|show|enable|disable|update|validate|health` — manage agent providers (claude, codex, custom).
- `backlog sources add|list|enable|disable|update|remove|validate|sync|push|conflicts|resolve` — manage planning source connectors (markdown, csv, jira).
- `backlog release snapshot` — export per-repo run/dirty state.
- `backlog worktree list|gc` — inspect and clean up tracked worktrees.

### Architecture

- TypeScript + ESM, Node >= 20.
- Bundled via tsup; dependencies inlined for a single-file binary.
- Apache-2.0 license.
