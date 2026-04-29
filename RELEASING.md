# Releasing

How to cut a new release of the `backlog` ecosystem (CLI + SDK + Desktop). The three move on the same version line — bump them together, publish them in order.

## Pre-flight

Before bumping any version, confirm the codebase is publish-ready.

```sh
# From repo root
pnpm install                                   # workspace deps fresh
pnpm typecheck                                 # tsc -b across all packages
pnpm test                                      # vitest workspace-wide
pnpm --filter backlog build                    # CLI tarball + bundled UI
pnpm --filter @backlog/sdk build               # SDK ESM + .d.ts
```

Expected: typecheck silent, tests all green (currently 247/247), both builds report `Build success`.

If any of these fail — fix the underlying issue first. Don't release with a known broken `pnpm test`.

## Smoke-test the tarball

Always install the tarball into a scratch directory before publishing. `npm pack` produces what gets uploaded; if it's wrong here, it's wrong on npm.

```sh
# CLI
cd packages/cli
rm -f *.tgz && npm pack
mkdir -p /tmp/release-smoke && cd /tmp/release-smoke
rm -rf cli-test && mkdir cli-test && cd cli-test && npm init -y >/dev/null
npm install /Users/<you>/Dev/backlog/backlog-cli/packages/cli/backlog-*.tgz
./node_modules/.bin/backlog --version          # expect: 1.3.0
./node_modules/.bin/backlog --help             # expect: 'orchestrator for AI coding agents' tagline
./node_modules/.bin/backlog hooks --help       # expect: pause / resume / paused listed
```

Then for the SDK:

```sh
cd packages/sdk
rm -f *.tgz && npm pack
cd /tmp/release-smoke
rm -rf sdk-test && mkdir sdk-test && cd sdk-test && npm init -y >/dev/null
npm install /Users/<you>/Dev/backlog/backlog-cli/packages/sdk/backlog-sdk-*.tgz
node -e 'import("@backlog/sdk").then(m => console.log(Object.keys(m)))'
# expect a list including BacklogClient
```

When done, clean up:

```sh
rm -rf /tmp/release-smoke
rm -f packages/cli/backlog-*.tgz packages/sdk/backlog-sdk-*.tgz
```

## Version bump

The CLI, SDK, and Desktop apps share a version line. Internal workspace packages (`@backlog/core`, `@backlog/claims`, `@backlog/schemas`, etc.) stay at `0.x` — they're bundled into the CLI tarball at build time, never installed directly.

Files to edit for a release:

- `packages/cli/package.json` — `version`
- `packages/sdk/package.json` — `version`
- `packages/desktop/package.json` — `version`
- `packages/cli/CHANGELOG.md` — add a `## [N.N.N] - YYYY-MM-DD` section under `## [Unreleased]`
- `packages/sdk/CHANGELOG.md` — same, if the SDK changed
- `packages/cli/src/bin.ts` — only if you changed the CLI tagline / description
- `packages/cli/README.md` — only if user-visible commands or behavior changed

Optional but worth syncing:

- `backlog-cloud/config/initializers/00_version.rb` (`BACKLOG_CLOUD_VERSION`) — the marketing site has its own 0.x line, but you can bump it in the same window if `backlog.so` shipped meaningful changes alongside the CLI release.

## Publish to npm

Order matters: SDK first, then CLI. (The CLI bundles its own copy of the SDK types via tsup at build time, so the on-npm SDK doesn't gate the CLI install — but publishing SDK first is still cleaner because anyone who installs CLI then immediately wants `@backlog/sdk` won't hit a 404.)

```sh
# Auth (once per machine / per session if your token expired)
npm whoami
npm login --scope=@backlog          # scoped pkg requires scope at login

# 1. SDK
cd packages/sdk
npm publish --access public          # 'access public' is also in publishConfig

# 2. CLI
cd ../cli
npm publish

# 3. Verify
npm view backlog version             # 1.3.0
npm view @backlog/sdk version        # 1.3.0
```

If a publish step fails, **don't blindly retry** — read the error. Common ones:

- **`E403 / 402 You must sign up for private packages`** on the SDK: you forgot `--access public` and the scoped package defaulted to private. Fixed by `publishConfig.access: "public"` in `packages/sdk/package.json`, but `--access public` on the CLI works as a fallback.
- **`EOTP`**: 2FA required. Pass `--otp 123456` on the same command.
- **`EPUBLISHCONFLICT`**: that version already exists. Bump the patch number; npm forbids re-using a version slot even after unpublish.

## Post-publish

```sh
# 1. Tag the release in git
cd /Users/<you>/Dev/backlog/backlog-cli
git tag v1.3.0 -m "Release 1.3.0"
git push origin v1.3.0

# 2. GitHub Release
gh release create v1.3.0 \
  --title "1.3.0 — Open-core boundary + Desktop preview" \
  --notes-file packages/cli/CHANGELOG.md   # or a curated subset

# 3. Deprecate the old SDK name
#    @backlog/sdk replaces backlog-sdk; point any existing user at the new package.
npm deprecate backlog-sdk@'<2.0.0' \
  "Renamed to @backlog/sdk. Reinstall: 'npm i @backlog/sdk'."

# 4. (Optional) Update marketing site
#    Bump BACKLOG_CLOUD_VERSION if you cut a coordinated cloud release.
```

## Removing 0.1.0 from npm

The `backlog@0.1.0` snapshot from 2026-04-28 was a relabelling experiment that broke `^1.x` pins. We're going from 1.2.0 directly to 1.3.0 — 0.1.0 should look like it never happened.

npm has a 72-hour window during which a package version can be **fully unpublished**. After that, only `npm deprecate` (which keeps the version on the registry but flags it as deprecated) is available.

Check first whether you're still inside the window:

```sh
npm view backlog time --json | grep '0.1.0'
# "0.1.0": "2026-04-28T13:49:50.665Z"
date -u  # compare to current UTC time
```

### If within 72 h — unpublish

```sh
npm whoami                                     # confirm you're logged in
npm unpublish backlog@0.1.0
```

After unpublishing, `npm view backlog versions` should no longer list `0.1.0`. Note: npm **forbids re-publishing the same version number for 24 hours** after an unpublish — but that doesn't matter here because we're moving forward to `1.3.0`, not back.

If unpublish fails with `EPRIVATE` or similar, double-check you're authenticated and that the package owner is your account (`npm owner ls backlog`).

### If beyond 72 h — deprecate

```sh
npm deprecate backlog@0.1.0 \
  "Use 1.3.0 or later. The 0.1.0 tag was a brief relabelling experiment; the project never left the 1.x line."
```

`backlog@0.1.0` will stay installable but show a deprecation warning to anyone who installs it. `npm i backlog` (without a version) will pick `latest` (1.3.0) so most users won't see anything.

### What stays on npm regardless

The 0.0.1 / 0.0.2 / 0.0.3 versions from **2013-06-11** belong to a long-dead unrelated project that owned the `backlog` name first. They've been on npm for 13 years and re-uploading the package didn't displace them. They're not yours to unpublish; leave them alone. They don't match `^1.x` or `^0.1.0` so they won't be installed by anyone.

## Marketing site coordination

If the release includes user-visible changes that should land on `backlog.so` (new features, pricing changes, Desktop status, etc.):

1. Update `backlog-cloud/app/views/pages/changelog.html.erb` with a new `<h2>v0.x.0 — Month YYYY</h2>` entry.
2. Bump `BACKLOG_CLOUD_VERSION` in `backlog-cloud/config/initializers/00_version.rb`.
3. Update any product page (`/cli`, `/desktop`, `/sdk`, `/cloud`, `/docs`, `/pricing`) that still references the old behavior.
4. Deploy backlog-cloud (Heroku / wherever).

The marketing site has its own 0.x version line — don't try to sync it 1:1 with the CLI's 1.x.

## Roll-back

If a release breaks something serious in the field:

1. **Don't** `npm unpublish` after the 72-h window — it'll still work for the install path but creates ghost versions in many lockfiles.
2. Cut a `1.3.1` patch release with the fix.
3. If the breakage is severe and a fix isn't immediate, run `npm dist-tag add backlog@1.2.0 latest` to point `latest` at the previous stable while you work on the fix. `npm dist-tag add backlog@1.3.0 latest` restores it once 1.3.1 ships.
