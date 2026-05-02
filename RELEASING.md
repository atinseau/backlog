# Releasing

Runbook for cutting Backlog CLI + Desktop releases.

The canonical full release today is:

- npm package: `backlog@X.Y.Z`
- GitHub Release: `vX.Y.Z`
- Desktop installers and update metadata attached to `vX.Y.Z`
- Git tags: `vX.Y.Z` and `desktop-vX.Y.Z`

The `desktop-v*` workflow also publishes the CLI idempotently. This keeps CLI
and Desktop in lockstep and avoids racing two non-idempotent npm publishes.

## Version Lines

- `packages/cli/package.json`: public npm package `backlog`
- `packages/desktop/package.json`: Desktop app version
- `packages/cli/CHANGELOG.md`: canonical changelog
- `CHANGELOG.md`: symlink to `packages/cli/CHANGELOG.md`
- Internal packages (`@backlog/core`, `@backlog/server`, `@backlog/git`, etc.)
  stay at `0.1.0` unless they become independently published.
- `packages/sdk` (`@osmove/backlog-sdk`) is currently on its own line. Bump it
  only when SDK code or generated API types changed.

## Pre-flight

Start clean and make sure you are on `main`.

```sh
git status --short
git pull --ff-only origin main
pnpm install
```

Run the release checks from repo root:

```sh
pnpm typecheck
pnpm --filter @backlog/board-ui typecheck
pnpm test
pnpm --filter "backlog..." build
pnpm --filter @backlog/desktop build
pnpm --filter backlog pack:check
git diff --check
```

Expected:

- `pnpm test` currently reports 48 files / 284 tests.
- `svelte-check` reports 0 errors and 0 warnings.
- `pack:check` prints the tarball contents for `backlog@X.Y.Z`.
- Vite may warn about a chunk larger than 500 KB. That warning is known and
  not release-blocking by itself.

## Bump

Patch release example from `1.4.23` to `1.4.24`:

1. Update `packages/cli/package.json` version.
2. Update `packages/desktop/package.json` version.
3. Add a new `## [1.4.24] - YYYY-MM-DD` section directly under
   `## [Unreleased]` in `packages/cli/CHANGELOG.md`.
4. Mention the actual user-visible changes. Keep it practical.

Do not bump internal package versions for normal CLI/Desktop releases.

## Commit

Use a release commit:

```sh
git add packages/cli/package.json packages/desktop/package.json packages/cli/CHANGELOG.md
git add <changed files>
BACKLOG_SKIP_HOOK=1 git commit -m "release: X.Y.Z short description"
```

`BACKLOG_SKIP_HOOK=1` is acceptable for release/maintenance commits when the
hook would create product noise. Do not use it to bypass real product failures.

## Tags And Push

Create both tags on the same commit:

```sh
git tag vX.Y.Z
git tag desktop-vX.Y.Z
git push origin main
git push origin vX.Y.Z desktop-vX.Y.Z
```

What happens:

- `main` push runs CI on Node 20 and Node 24.
- `desktop-vX.Y.Z` runs the Desktop release workflow.
- Desktop workflow builds Linux, Windows, macOS, publishes npm if needed, then
  flips the GitHub Release `vX.Y.Z` from draft to published.
- `vX.Y.Z` is the release tag that users and electron-builder assets attach to.

Important: do not assume the `vX.Y.Z` tag alone publishes npm. The current
full-release path is the `desktop-vX.Y.Z` workflow.

## Watch The Release

```sh
gh run list --repo osmove/backlog --limit 8
gh run watch <ci-run-id> --repo osmove/backlog --exit-status
gh run watch <desktop-run-id> --repo osmove/backlog --exit-status
```

Verify npm:

```sh
npm view backlog version
```

Verify GitHub Release:

```sh
gh release view vX.Y.Z --repo osmove/backlog --json tagName,name,isDraft,url
```

Expected release state:

- `isDraft: false`
- Linux, Windows, macOS assets present
- update manifests present: `latest.yml`, `latest-linux.yml`,
  `latest-mac.yml`

## Desktop Release Requirements

The Desktop workflow is `.github/workflows/desktop-release.yml`.

Jobs:

- `linux`: builds AppImage, deb, rpm, Linux update manifest
- `windows`: builds Windows installers/update manifest
- `macos`: signs/notarizes macOS DMGs/update manifest
- `npm`: idempotently publishes `backlog` if local version is newer than npm
- `finalize-release`: checks required assets, then publishes the draft release

macOS only runs when repository variable `MACOS_BUILD_ENABLED == "true"`.
Required secrets are documented in the workflow.

If `finalize-release` fails, inspect the draft release. It intentionally stays
draft when required assets are missing.

## Common Failures

### CI fails at `pnpm --filter backlog pack:check`

Make sure `packages/cli/package.json` has:

```json
"pack:check": "npm pack --dry-run"
```

The root `pack:check` is not enough because CI runs the package-filtered
script.

### Git merge tests fail with missing committer identity

Tests that create merge commits must configure local Git identity in the temp
repo. CI runners do not guarantee global identity.

### npm version already exists

npm versions are immutable. Bump patch and release again. Do not try to reuse
the same version.

### Desktop npm job says "Already published; skipping."

That is fine. The job is idempotent and skips when `npm view backlog version`
already equals the local version.

### Release is still draft

Check `finalize-release`. It verifies required assets before publishing. If one
platform failed or uploaded a differently named asset, the release remains
draft for manual inspection.

## Hotfix Flow

For a patch hotfix:

```sh
# fix code
pnpm typecheck
pnpm --filter @backlog/board-ui typecheck
pnpm test
pnpm --filter "backlog..." build
pnpm --filter @backlog/desktop build
pnpm --filter backlog pack:check

# bump patch, changelog, commit, tag both, push
```

If a release is severely broken and a fix is not immediate:

```sh
npm dist-tag add backlog@<previous-good-version> latest
```

Cut a patch fix as soon as possible, then restore:

```sh
npm dist-tag add backlog@<fixed-version> latest
```

## Manual Local Board After Release

If you need the local board for smoke testing:

```sh
pnpm --filter @backlog/board-ui build
pnpm --filter backlog dev serve --project /Users/jimmy/Dev/backlog/backlog-cli --port 7878
```

Open `http://127.0.0.1:7878`.

## Coordinating With Backlog Backend

The private Rails backend is `../backlog-backend` locally and powers
`backlog.so` / Backlog Cloud. If a CLI/Desktop release changes marketing copy,
Cloud auth, OAuth callback behavior, pricing, or public API expectations, update
that repo separately and follow its `AGENTS.md` + `docs/RUNBOOK.md`.

The backend has its own deploy and versioning concerns. Do not bump it just
because the CLI/Desktop version changed.
