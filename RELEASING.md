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

## Removing a stale version from npm

`npm unpublish` has **two stacking constraints** — both must be satisfied to actually pull a version off the registry:

1. **Within 72 h of publish.** After 72 h, only `npm deprecate` is allowed.
2. **No package on the registry depends on it.** Even at 5 minutes after publish, if any other npm package has the version in its `dependencies` / `peerDependencies` / `optionalDependencies`, npm refuses the unpublish with `E405 — has dependent packages in the registry`. This is non-negotiable and not advertised by the 72-h policy page.

In practice: assume `unpublish` won't work and plan for `deprecate`. Try unpublish anyway — if it works, great; if it fails with `E405`, fall through to deprecate.

### Deprecate flow (the realistic default)

```sh
npm whoami                                     # confirm you're logged in
npm owner ls <package>                         # confirm you're a maintainer

# Use a message that tells the installer what to do — generic
# "this package has been deprecated" wastes the warning slot.
npm deprecate '<package>@<version>' \
  "Use <package>@^<replacement>. <one-sentence reason>. <link>"

# Verify
npm view <package>@<version> deprecated
# Should print your message back exactly.
```

`npm deprecate` is **idempotent** — re-running with a different message just overwrites. Pass an empty string to clear: `npm deprecate '<package>@<version>' ""`.

### Concrete example: the 0.1.0 relabelling experiment

```sh
# Tried this — failed because of a dependent package (E405):
npm unpublish backlog@0.1.0

# This is the working path:
npm deprecate 'backlog@0.1.0' \
  "Use backlog@^1.3.0 instead. The 0.1.0 tag was a brief relabelling experiment; backlog stayed on the 1.x line. See https://www.npmjs.com/package/backlog"

npm view backlog@0.1.0 deprecated
```

After deprecation, `backlog@0.1.0` stays installable but `npm i backlog@0.1.0` prints the warning. Most users running `npm i backlog` (no version) get `latest` = `1.3.0` and see nothing — the deprecation only fires if someone explicitly pins to `0.1.0`.

### Finding what depends on the stale version

If `unpublish` fails with `E405` and you'd like to know who's blocking it:

```sh
# Browse the dependents on npmjs.com:
open "https://www.npmjs.com/browse/depended/<package>"

# Programmatic query via npms.io (third-party index):
curl -s "https://api.npms.io/v2/search?q=dependencies:<package>&size=10" \
  | jq '.results[].package | {name, version, links}'
```

If the dependent is one of your own packages (e.g., a workspace tarball you accidentally published, or a sister package), bump its dependency to a current version and re-publish it; the dependency lock disappears once no published manifest references the stale version. Then `npm unpublish` becomes available again (still inside its own 72-h window of the dependent's last publish).

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
