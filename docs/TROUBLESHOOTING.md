# Troubleshooting

Five problems that come up often, and the shortest path through each.

## 1. Pre-commit hook crashes with `ENOENT … claims/active/CLM-…`

**Symptom**

```
ENOENT: no such file or directory, open '<project>/claims/active/CLM-…json'

To proceed without a claim:
  - Just this commit:   BACKLOG_SKIP_HOOK=1 git commit ...
  - For 30 minutes:     backlog hooks pause
  - Permanently here:   backlog hooks uninstall
```

**Cause** The repo's `.git/backlog-context.json` references a claim that
isn't in `claims/active/` anymore — usually because:

- the claim expired and got archived by `claim gc`,
- you migrated the project (`project migrate`) and the active dir moved,
- another teammate finished the claim from a different machine.

**Fix** `backlog claim check` self-heals on the next run (clears the
pointer, prints a message). Or sweep all repos at once:

```sh
backlog claim gc                 # archives expired + clears orphan pointers
backlog claim finish --all       # nuke every active claim + every pointer
```

For a single commit you really need to push past, the escape hatches the
hook printed work too.

---

## 2. `backlog hooks status --all` shows `managed=false` for a repo

**Symptom** The pre-commit hook is missing or wasn't installed by Backlog.

**Fix**

```sh
backlog hooks install --all              # install everywhere
backlog hooks install --repo my-repo     # one repo
backlog hooks install --all --force      # rewrite an existing non-managed hook
```

If you migrate the project later (`project migrate`) the hooks need to
be reinstalled to point at the new path — `migrate` does that
automatically; if it failed for some repos, the post-migrate output
tells you and the same `hooks install --all --force` retries.

---

## 3. Project can't be found from cwd

**Symptom**

```
No .backlog project found. Run `backlog init` first.
```

**Cause** `findProject()` resolves the current project by, in order:

1. `BACKLOG_PROJECT_DIR` environment variable (used by the pre-commit hook)
2. `config.toml` in cwd (you're inside a user-level project dir)
3. A `.backlog/` subdirectory walking up from cwd (in_repo projects)
4. The user registry at `~/.backlog/projects.json` — for each
   `user_level` entry, check whether cwd is inside one of its configured
   repos.

If none of those match, you get the error.

**Fix**

```sh
backlog project list                    # see what's registered and where
backlog project add /path/to/project    # register an existing project
backlog init [--user-level]             # bootstrap a fresh one
```

For a one-shot override, set `BACKLOG_PROJECT_DIR=/path/to/project`
before the command.

---

## 4. GitHub Desktop's auto-fetch undoes a force-push or rebase

**Symptom** You force-push a rewritten history (e.g. via
`git filter-branch` or `git rebase`), look at the log a minute later,
and see your old commits back, joined by a merge commit you didn't
make.

**Cause** GitHub Desktop runs a periodic `git pull --ff
--recurse-submodules --progress` for repos it tracks. If the remote
has commits your local doesn't (because you rewrote local without
pushing yet), it'll merge them in.

**Fix** A `git config --global pull.ff only` makes any non-fast-forward
auto-pull fail-fast instead of silently merging:

```sh
git config --global pull.ff only
```

When you intentionally want a non-FF pull use `git merge origin/main`
or `git pull --no-ff`. For big rewrites also quit GitHub Desktop
beforehand (`Cmd+Q` on macOS) — belt-and-braces.

---

## 5. `backlog serve` says `EADDRINUSE: 127.0.0.1:7878`

**Symptom**

```
Error: listen EADDRINUSE: address already in use 127.0.0.1:7878
```

**Cause** Another `backlog serve` is still listening on the port — or
some other process grabbed 7878.

**Fix**

```sh
lsof -i :7878        # find the PID and command on the port
kill <pid>           # if it's a stale `backlog serve`
backlog serve --port 7879   # or just pick another port
```

The board UI's vite dev server proxies `/api` to `127.0.0.1:7878` by
default — set `BACKLOG_API_URL=http://127.0.0.1:7879` if you serve on a
non-default port.
