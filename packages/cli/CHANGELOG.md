# Changelog

All notable changes to the `backlog` CLI are documented here. The 1.0.0–1.2.0 history lives in [`CHANGELOG-LEGACY.md`](./CHANGELOG-LEGACY.md).

## [Unreleased]

## [1.4.15] - 2026-05-01

Follow-up from the user's first 1.4.14 direct-mode test.

- **Activity sometimes showed a naked `}` row** — a transient JSON delimiter / partial provider-stream fragment could be surfaced as `raw` activity by the SSE tailer. **Fix**: activity parsing now drops brace/comma-only fragments server-side, and the UI ignores them defensively too.
- **Clicking an empty generated file showed a header-only Git diff** — `git diff --no-index /dev/null empty.txt` renders `new file mode 100644` even though the file has no content, which made the right panel look broken. **Fix**: the file panel now reads and displays the current text content when the file exists; empty files show `Fichier vide.`.
- **Header polish** — the centered run-status display is now centered against the window, not just the remaining space between left/right controls, and the model dropdown chevron is larger.

## [1.4.14] - 2026-04-30

Follow-up from the user's real Desktop test after 1.4.13: a task created with "Directement dans ta copie" still ran in `.backlog/worktrees/...`, and failed runs appeared as unexplained `blocked` cards.

- **Direct mode now actually works in the main checkout** — `execution_defaults.worktree_mode = "direct"` was persisted on the task but ignored by `run-launcher`; all runs still used isolated worktrees. **Fix**: direct tasks now use the repo checkout as `run.worktree_path`, record `execution_mode: direct`, refuse to start if the checkout has local changes, and block parallel direct runs in the same repo.
- **Desktop can find CLI executables launched from a GUI app** — macOS GUI apps often miss the user's shell PATH, so `claude` could be installed in `~/.local/bin` but invisible to Electron, producing an instant failure with no stdout/stderr. **Fix**: executors resolve `claude`/`codex` through PATH plus `~/.local/bin`, `~/bin`, `~/.npm-global/bin`, Homebrew, `/usr/local/bin`, `/usr/bin`, and inject that expanded PATH into agent subprocesses.
- **Blocked cards now say why** — board and task-detail responses include the latest run for each subtask. Cards and the detail inspector show `run_029 · Claude agent claude-code failed (no exit status or output)` instead of a bare `bloqué`.
- **Header visibility pass** — removed the width-hungry `il reste X min` and `live` pills, and added a centered run-status display showing active run id/agent/mode, latest activity, review count, or blocked reason. Clicking it opens Activity.
- **Creation options are conditional** — direct mode now shows only `Commit` and `Push`; isolated worktree mode shows `Push`, `Create PR`, and `Merge PR`. Worktree commits remain implicit so PR/merge has a branch to work with.
- **Run scratch files stay out of the project** — direct-mode Claude/Codex prompts, logs, last messages, and generated patches are stored in the run directory, not at the repo root.
- **Worktree GC leaves direct checkouts alone** — direct runs store the repo path as their execution path, so cleanup must not treat archived direct runs as removable worktrees. **Fix**: `listKnownWorktrees()` and `garbageCollectWorktrees()` now skip `execution_mode: direct` runs entirely.

## [1.4.13] - 2026-04-30

Real audit after 1.4.12 showed the agent was executing, but the product contract was wrong: successful work landed in an isolated worktree/branch and the Desktop UI made "awaiting review" look like "still running" or "done-ish". The user expected files to appear in the project after approving; Backlog was often only marking the run complete.

- **Desktop window title said "Backlog Board"** — Electron already set the BrowserWindow title to `Backlog`, but the loaded document title was still `Backlog Board`, so macOS displayed the stale title. **Fix**: board HTML title and server fallback now say `Backlog`.
- **Approve did not actually apply work in Desktop** — workspaces defaulted to `git.merge_strategy = "none"`, and `approveRun()` completed the run before attempting any merge. That meant a ✓ could mark a task Done while the file still lived only under `.backlog/worktrees/...`. **Fix**: Desktop approve now sends `merge_strategy: "fast_forward"`, new workspaces default to fast-forward apply, and `approveRun()` merges before marking the run succeeded. If the main checkout is dirty or the merge fails, the run stays `awaiting_review` with an actionable error.
- **Backlog internal logs were committed into run branches** — `.backlog-claude.log`, `.backlog-claude-prompt.md`, Codex equivalents, and `.backlog-run.patch` were staged by `git add -A`. **Fix**: auto-commit now unstages internal run artifacts, and approve sanitizes older polluted branches before applying them.
- **In-repo workspaces could block apply because `.backlog/` was untracked** — the merge preflight treated every untracked file as dirty. **Fix**: preflight ignores untracked files but still blocks tracked modifications; Git itself still prevents overwriting conflicting untracked user files.
- **Run state was fuzzy on cards and in Activity** — review runs showed raw `awaiting_review`, the badge looked like a running ▶ count, and activity pills truncated `run_027` to `run_02`. **Fix**: cards now say `prêt à appliquer`, show a visible `✓ Appliquer` action, display blocked subtasks as `bloqué`, and Activity keeps full run ids plus repo-relative file paths.
- **Executor failures said "exit code undefined"** — a CLI that exits without code/output now surfaces `no exit status or output` instead of a bogus undefined exit code.

Verified on the user's Demo workspace: applied `run_027` by fast-forward, `test-30-avril.html` appeared in `/Users/jimmy/Dev/test-backlog-demo`, run moved to `succeeded`, worktree was removed, and `.backlog-claude.*` files were not present in the final checkout.

## [1.4.12] - 2026-04-30

User reported six structural problems on launching 1.4.11. All trace back to "the app is too eager to resume yesterday's work" or "errors prioritise the wrong reason". Belt-and-suspenders fix: clean shutdown when the user quits, force-idle on every startup.

- **App auto-fires queued runs on launch** — `orchestrator.json` had `mode: running` from the previous session, hydrate happily resumed, the queue picked up stale `queued` subtasks, three unrelated runs auto-fired before the user clicked anywhere. Activity panel filled with `subtask_006-add-test-html` / `subtask_007-aaa` / `subtask_008-add-test-30-avril.html` — none of which the user just asked for. **Fix (suspenders)**: hydrate now ALWAYS resets the orchestrator to `idle`. The "resume what was running" semantics across server restarts seemed nice on paper but in practice surprised every user. New invariant: explicit ▶ click starts work. Empty mailbox on every launch.
- **Hydrate only ran for the bound workspace** — `state.json` said `lastWorkspace=twoody` so the desktop server booted bound to twoody, but the kanban auto-routed to `WS-2300244e` via localStorage's `backlog.selected_project_id`. Demo's `orchestrator.json` was still `running` from a prior session (twoody's hydrate didn't touch it). **Fix**: server startup now hydrates EVERY registered workspace from `~/.backlog/projects.json`, not just the one it was launched bound to. Multi-project users get their entire fleet reset to idle on any server boot.
- **Quit didn't clean up runs** — server SIGINT just dropped sockets and exited. Runs marked `running` got reaped on next launch as `interrupted` ("Reaped on hydrate — executor process gone") which is alarming UX. **Fix (belt)**: `RunningServer.close()` now walks every registered workspace, calls `shutdownOrchestrator(dir)` to halt timers, marks any `queued`/`preparing`/`running` runs as `canceled` with reason `"Canceled — server shutting down"`, and pins `orchestrator.json` to `idle`. Clean audit trail, no scary reaper messages on next boot.
- **Card Play surfaced "Configure ta clé" when claude-code was busy** — workspace had two agents (claude-code with a key set, codex without). When claude-code hit `at_capacity` from the auto-fired runs, the response also included codex's `missing_api_key:OPENAI_API_KEY` complaint. The error-message picker priority listed `apiKeyReason` first → user saw "Configure d'abord ta clé" even though their actual agent was just busy. **Fix**: `at_capacity` and `no_agent_capacity` checks now come before `missing_api_key` in the priority chain. The user's keyed-up agent being busy is a more actionable message than the unrelated unconfigured one.
- **`Démarrer ▶` didn't auto-open the Activity panel** — the card-level Play button calls `openActivityPanel()` so the user sees logs immediately. The post-create StartPromptDialog's `onStarted` callback only refreshed state, didn't pop the panel. The user clicked Démarrer, the dialog closed, the run started — but no visible feedback unless they manually expanded the bottom panel. **Fix**: `onStarted` now calls `openActivityPanel()` first. Same UX as the card Play.

E2E verified: workspace had Demo at `mode=running` from a previous session. Restart server → Demo's `orchestrator.json` flipped to `idle` automatically, twoody too. Started orchestrator manually, sent SIGINT → server shutdown ran, Demo's `mode` was `idle` again on disk. Round-trip clean.

## [1.4.11] - 2026-04-30

Caught by an end-to-end Chrome test driving the kanban as a real user would.

- **`Démarrer ▶` rejected runs in assist mode** — `StartPromptDialog` called `startRun({ task_id })` without `approve: true`, while `Card.svelte`'s ▶ button has always passed it. Server enforced `approve=true` for `assist` autonomy mode and refused the start with *"Set approve=true to launch runs in assist mode"*. The user clicked Démarrer, got the error, then tried the card-level Play and that worked — confusing inconsistency. **Fix**: the Démarrer button now passes `approve: true` to match the card Play. Both surfaces behave identically.
- **"Sans sous-tâche, l'orchestrateur n'a rien à exécuter" was misleading** — the help-text under the StartPrompt body warned that an empty task wouldn't run, but the server's auto-shim creates a covering subtask on the fly when `/runs` is hit with `task_id` only (the same path the card Play and Démarrer both use now). The agent DOES execute. **Fix**: rewrote the help text to *"L'agent va générer une sous-tâche couvrant la description et l'exécuter directement."* — what actually happens.
- **Branch names had double-dashes when the title slugified to 32 chars exactly** — `Add test2.html with Hello World content` → slug `add-test2-html-with-hello-world-` (32 chars, ending on a dash because the slice landed on a separator). The `${base}-${runId}` concat then produced `…with-hello-world--run_022`. Cosmetic but visible in commit messages and git log. **Fix**: re-trim trailing dashes after the 32-char slice.
- **"Créer + découper" submit label was wrong when autoSplit was off** — the label always read "Créer + découper" but the AI splitter only runs when the user opts in via the autoSplit checkbox (default off). For 99% of new tasks the action was just *create*, not *create + split*. **Fix**: button label now flips between "Créer" and "Créer + découper" based on the checkbox state.

E2E verified locally: typed a task description, hit submit (now labeled "Créer"), the create dialog closed cleanly, StartPromptDialog opened with the renamed text, hitting Démarrer ▶ launched a real run on `claude-code` that committed `test_30_avril.html` to a fresh branch. Activity panel populated in real time.

## [1.4.10] - 2026-04-30

Three more bugs from a real user test ("j'ai créé une tâche, j'ai eu 2 confirmations, j'ai cliqué sur Play et j'ai eu une erreur worktree_failed"). All structural.

- **`worktree_failed` on retry of a failed run** — `buildRunBranchName(taskId, taskTitle)` returned `backlog/<task>-<slug>` regardless of which run was about to use it. When a run failed and its worktree wasn't cleaned (no auto-gc until a manual sweep), the next run on the same subtask hit `git worktree add -b <branch> <path>` with that same `<branch>` already in use → exit 255 → "worktree_failed: Command failed with exit code 255". Confirmed in user's `test-backlog-demo`: `git worktree list` showed `run_006` and `run_019` still attached to old failed-run branches that the new `run_021` was trying to claim. **Fix**: branch names now include the run id (`backlog/<task>-<slug>-<runId>`), so retries on the same subtask always get a fresh branch even if the prior worktree is still around. Used `-` as the separator (not `/`) on purpose: with `/` git refuses to create `foo/bar` when a leaf branch `foo` already exists in `refs/heads/`, breaking upgrades from older branches.
- **Orphaned worktrees never got cleaned up** — `garbageCollectWorktrees()` exists in `@backlog/core` but was only invoked manually via the CLI. Failed/interrupted runs left their worktree directories on disk indefinitely, accumulating like the user's 3 stale worktrees in test-backlog-demo. **Fix**: hydrate now calls `garbageCollectWorktrees()` on every server start, alongside the run-archive sweep added in 1.4.9. Verified locally: workspace went from `git worktree list` returning 3 paths (main + run_006 + run_019) to just `main` after one server start with the new code.
- **Two confirmations after creating a task** — the user reported seeing "Tâche créée" twice. Root cause: CreateTaskDialog briefly rendered its `phase = "applied"` view (header "Tâche créée" + body "✓ Tâche créée") before the parent's `onCreated` callback closed the dialog — racy enough that a fast user noticed. THEN the StartPromptDialog opened with body text *"Tâche {taskId} créée avec {count} sous-tâches prêtes"* — visually a second "créée" confirmation, even though the dialog is asking a *new* question. **Fix**: removed the `phase = "applied"` set in CreateTaskDialog so the dialog closes cleanly without flashing through the success state. AND rewrote the StartPromptDialog body / title to be action-focused — "Lancer cette tâche maintenant ?" / "{taskId} sera exécutée par l'agent" — instead of repeating "créée".

## [1.4.9] - 2026-04-30

Two structural fixes around stale runs that were silently pinning agent capacity. User reported clicking Play and getting *"Ton agent est déjà en train de tourner sur une autre tâche…"* even though nothing was visibly running.

- **`interrupted` runs no longer hold agent capacity** — when the orchestrator's hydrate step finds a run marked `running` whose executor process is dead (typical after a crash, kill -9, or fresh `backlog serve` after killing the previous one), it marks the run `interrupted` and kicks the subtask back to `queued` for a fresh ▶. Until now, `interrupted` was treated as still-busy by `isAgentBusyStatus`, so a 2-day-old reaped run kept `claude-default` / `codex-default` permanently at `max_concurrent_runs=1`. Next click on Play surfaced `at_capacity` even though the agent was idle. **Fix**: marked `interrupted` as terminal (drops it from `listActiveRuns`) AND removed it from `isAgentBusyStatus` (symmetric — terminal can't be busy). Existing interrupted runs in workspaces are immediately freed.
- **Stale terminal runs auto-archive on hydrate** — `runs/active/` was accumulating `succeeded`/`failed`/etc. runs because the post-executor `archiveRun()` call didn't always land (server crash mid-finalisation, sigkill during a tick…). The directory clutter wasn't just cosmetic: it meant every `listActiveRuns` call had to parse stale `run.json` files and filter them out at the application level. **Fix**: every server hydrate now sweeps `runs/active/` for any run whose status is terminal (including the newly-terminal `interrupted`) and physically moves it to `runs/archive/` via `archiveRun()`. Workspaces that had been collecting cruft for days clean themselves on next launch.

End-to-end verified locally: a workspace with 2 stale active runs (one `interrupted`, one `succeeded`) showed `claude-default: active_runs=0` after server restart with the new code, and `runs/active/` was empty (both moved to archive).

## [1.4.8] - 2026-04-30

User-friendly auto-update errors + structural fix so the race that triggered them can't happen again.

- **Update errors no longer dump stack traces in the banner** — clicking *Check for Updates* during the ~3-minute window between the first platform job uploading and the macOS notarisation finishing surfaced `Cannot find latest-mac.yml in the latest release artifacts (https://github.com/osmove/backlog/releases/download/v1.4.7/latest-mac.yml): HttpError: 404 …` to the user. Terrifying for someone who just clicked a menu item. **Fix**: a `humanizeUpdateError()` classifier in `main.ts` translates known electron-updater error patterns to one-line French guidance: missing platform manifest → *"La nouvelle version est en cours de finalisation. Réessaye dans 2-3 minutes."* / network down → *"Pas de connexion internet…"* / GitHub rate-limited / disk full / signing mismatch / generic fallback. The raw message is preserved in a tooltip (`<span title>`) for power users + bug reports, but the banner stays calm.
- **CI: draft releases until all platforms are uploaded** — the actual race fix. `electron-builder.yml`'s `publish.releaseType` is now `draft` instead of `release`. Each platform job uploads into a hidden draft release; a new `finalize-release` job runs after `linux`, `macos`, and `windows` all succeed, sanity-checks that every expected artifact (`Backlog-$V-arm64.dmg`, `latest-mac.yml`, `Backlog-Setup-$V-x64.exe`, `latest.yml`, `Backlog-$V-x86_64.AppImage`, `latest-linux.yml`) is on the release, then flips the draft to published with `gh release edit --draft=false`. From the auto-update channel's perspective, the new version simply appears atomically — no half-uploaded state ever reaches a client. If a platform fails and assets are missing, the finalize job leaves the draft up for manual inspection instead of shipping a broken release.

## [1.4.7] - 2026-04-30

Three more bugs caught from a real user test ("ça ne marche pas, le menu clignote, et ça dit que c'est créé alors que ça l'a pas fait"). Each one was a structural problem, not a tuning fix.

- **Card kebab menu was still chaotic** — 1.4.6's portal hack escaped one transform symptom but still rendered one menu instance per card, each with its own document-level mousedown listener and its own state. Fast cursor movements between cards (mouse out, mouse back) raced these instances against each other and against the card's own transform residue from svelte-dnd-action's FLIP. Result: menu sometimes flickered, sometimes disappeared, sometimes appeared at the previous card's position. **Fix**: hoisted the menu to a single global instance rendered at App-shell level, driven by a tiny `cardMenuStore`. Cards just emit `openAt(coords, items)`; one `<CardMenu>` mounted in the app reads from the store. No more multi-instance race, no transformed ancestor, no portal trickery.
- **Create-task flow showed two "Tâche créée" confirmations stacked** — the create dialog had an `applied` phase that printed "Tâche créée" in the header AND "✓ Tâche créée" in the body, with a Close button. Then `StartPromptDialog` opened on top (or behind, depending on z-index), asking "Démarrer maintenant?" Users dismissed the create-dialog confirmation thinking it meant the work was done, never noticed the start prompt, and got "the task says created but the agent didn't do anything". **Fix**: the create dialog now closes immediately on success — the start prompt is the single visible follow-up, with **Démarrer ▶** as the autofocused primary action so Enter starts the run.
- **"Démarrer" actually started the orchestrator daemon, not the task** — `startOrchestrator()` only picks up subtasks already marked READY in the queue. A freshly-created task with zero subtasks (the typical "create test.html with hello world" case) had nothing for the daemon to grab, so it idled. The card's Play button works because it goes through `/runs` which has an auto-shim that creates a covering subtask if none exists. **Fix**: the StartPromptDialog now calls `startRun({ task_id })` (same path as the Play button) — the auto-shim kicks in, the run actually fires, and Activity logs populate. The orchestrator is also nudged in parallel so any sibling subtasks from a prior split catch up in the same click.

## [1.4.6] - 2026-04-30

Three small but visible fixes, all caught by an end-to-end Chrome session against `backlog serve`.

- **Card kebab menu opened hundreds of pixels offset from the click** — the root cause was a CSS transform on the parent `<article class="card">` (left over from svelte-dnd-action's FLIP animation residue, even at idle: `transform: matrix(1, 0, 0, 1, 0, -1)` — a 1px y-translation that's invisible but creates a containing block). Any non-identity ancestor transform turns `position: fixed` into "fixed within the transformed ancestor" rather than "fixed within the viewport", so the menu rendered ~270px right and ~100px down from the kebab. **Fix**: portal the menu element straight onto `<body>` via a `use:portal` action — escapes the entire card subtree and any future ancestor transforms. The menu now anchors precisely to the kebab's right edge minus 6px, every time.
- **Menu position re-flickered on each parent re-render** — the previous `$derived.by` recomputed clamping based on `items.length`, which changes when `assigneesForMenu` finishes its async fetch (going from `0` agents to `N+1`). The change in length altered the y-clamp by a few pixels, visible to the user as a tiny jump after open. **Fix**: snapshot the position once when the anchor first changes (`lastAnchorKey` guard), don't recompute on subsequent items mutations. Combined with the portal above, the menu is now genuinely stable.
- **Card-menu "Edit" was confusing** — the action just opened the task detail dialog (which is read-only today), and the user's intuition was that "Edit" should put them into edit mode directly. Renamed the label to **"Ouvrir / éditer"** (FR) / **"Open / edit"** (EN) to match the actual behaviour. A future release will add inline title editing inside the dialog.
- **Cloud session flashed "signed out" on every launch** — `loadCloudStatus()` started with `cloudStatus = null` and waited for the `/cloud/status` round-trip (~500ms when backlog.so is reachable, longer if not), during which the sidebar profile pill briefly showed the signed-out state. **Fix**: cache the last known status in `localStorage` (key: `backlog.cloud_status_cache`) and use it as the optimistic initial value. A network blip during refresh now keeps the cached status instead of flipping to "signed out".

## [1.4.5] - 2026-04-30

Two regression fixes that bit live users on 1.4.3 and 1.4.4. Both are short, visible, and worth pushing immediately.

- **Auto-update silently broken since 1.4.0** — `before-quit` was calling `app.exit(0)`, which skips the `will-quit` and `quit` events. `electron-updater`'s `autoInstallOnAppQuit = true` flag hooks into the `quit` event to run the staged installer. Net effect: the `.dmg` for the new version was downloaded into `~/Library/Caches/backlog-updater/pending/`, but the installer never fired on quit, so users stayed pinned to whatever they installed first regardless of how many times they quit and relaunched. Replaced `app.exit(0)` with `app.quit()`; the `isQuitting` guard prevents the resulting re-fire of `before-quit` from looping. Users on 1.4.3 / 1.4.4 will get 1.4.5 (and every subsequent update) by quitting and relaunching once.
- **Kanban card kebab menu flickered + didn't open** — `svelte-dnd-action` listens for `pointerdown` events on each draggable card. Clicking the 3-dot button (or the play / approve / split / + buttons) inside a card sent the `pointerdown` up to dnd-action, which staged a "potential drag" → applied a clone-style → cancelled when the click resolved with no movement → snapped back. Visible as a whole-screen flicker, plus the menu often failed to open because the click was racing dnd-action's drag-start. Fixed by stopping `pointerdown` and `mousedown` propagation on every inline action button so dnd-action never sees them. Drag itself (grabbing the card body) is unchanged.

## [1.4.4] - 2026-04-30

Auto-update is now visible inside the app. Until 1.4.3 the only signal of a downloaded update was a native macOS notification (often dismissed or invisible on Windows/Linux); 1.4.4 adds an in-app banner and a manual menu trigger so the user is never stuck on a stale build without realising.

- **In-app update banner** — surfaces every state of the auto-update lifecycle: `Checking…`, `Update available, downloading…`, a live progress bar with MB / percentage during download, `Backlog X.Y.Z is ready to install` with a **Restart now** button when the new version is staged. The banner sits at the top of the kanban shell, above the topbar; mounts on every platform; auto-dismisses the "you're up to date" state after 4s; never re-pops the same error after the user X's it.
- **Check for Updates… menu item** — under `Backlog` (mac app menu) and `Help` (Windows + Linux). Same backend as the in-app trigger, so they stay in sync — no risk of two parallel UI states. Manual checks override the silent startup poll.
- **Status broadcast over IPC** — every `electron-updater` event (`checking-for-update`, `update-available`, `download-progress`, `update-downloaded`, `update-not-available`, `error`) now broadcasts to all renderer windows via `webContents.send("backlog:update-status", …)`. The Svelte side subscribes through a new `window.backlog.onUpdateStatus(callback)` bridge method, and replays the last known status on subscribe so a banner that mounts mid-download immediately reflects reality.
- **`window.backlog.installUpdate()`** — wraps `autoUpdater.quitAndInstall()` so the renderer can drive the restart from the banner button. Guarded on the renderer side: only visible once `status.kind === "downloaded"`.
- Browser-served `backlog serve` (no Electron bridge) silently no-ops the banner — `window.backlog` is undefined, so the component renders nothing. Zero impact on CLI users.

Versions 1.4.0 through 1.4.3 will pick this up via the existing `electron-updater` background poll: open Backlog 1.4.3, leave it running ~1 minute, and 1.4.4 downloads silently. The new banner shipped in 1.4.4 will then surface for every future release.

## [1.4.3] - 2026-04-30

**Critical hotfix** — board UI was missing from both the desktop app and the npm tarball.

- **Root cause** — `@backlog/board-ui` (Svelte 5) writes its `vite build` output to `../server/dist/public/`, which the CLI tsup `onSuccess` and the desktop tsup `onSuccess` both copy into their own `dist/public/`. But board-ui was *not* declared as a workspace dep of `@backlog/server`, `backlog`, or `@backlog/desktop`, so `pnpm --filter` never traversed it. Every published artifact since the board-ui split shipped with an empty `dist/public/`. End users saw the "Backlog Board — API ready, UI bundle missing" placeholder instead of the kanban.
- **Fix** — every consumer (`backlog`, `@backlog/desktop`, the root `build` script, `prepublishOnly`, dev scripts) now explicitly invokes `pnpm --filter @backlog/board-ui build` before its own bundler runs. Vite is fast (~850ms) so this adds negligible overhead. Belt-and-suspenders: applied at the package level (so npm + dev contributors are safe) AND at the CI workflow level (next change).
- **Affects** — 1.4.0, 1.4.1, 1.4.2 on npm + 1.4.0, 1.4.1, 1.4.2 desktop GitHub releases all ship without the UI. **Upgrade to 1.4.3 immediately.**
- **Verified** — built `dist/public/` now contains `index.html` + `assets/index-*.{js,css}` (~430KB JS, ~127KB CSS) post-build. Fresh smoke test on the local Mac.

## [1.4.2] - 2026-04-30

Patch release — Desktop artifact naming + a clean stapled DMG re-roll.

- **macOS artifact symmetry** — `electron-builder.yml` now sets `mac.artifactName: "${productName}-${version}-${arch}.${ext}"`, so every macOS artifact carries an explicit `-arm64` or `-x64` suffix. 1.4.1 shipped `Backlog-1.4.1-arm64.dmg` next to a bare `Backlog-1.4.1.dmg` (Intel, no suffix) — the legacy electron-builder default from the era when x64 was the assumed Mac arch. Apple Silicon has been the default since 2021; the bare filename was misleading. Linux + Windows already templated `${arch}` into their artifactName, so this brings macOS in line with the rest of the matrix.
- **Stapled DMGs** — 1.4.1's CI run uploaded the DMGs before the Apple notarization ticket had propagated through CloudKit, so `xcrun stapler` failed. 1.4.2 rebuilds + restaples cleanly. End users see no Gatekeeper friction on first launch.
- **No CLI / desktop runtime changes** — pure release plumbing. If you're on 1.4.1 via npm, this is a no-op upgrade for the CLI itself.

## [1.4.1] - 2026-04-30

Same release window as 1.4.0 with the kanban card menu + agent UX work added. The 1.4.0 tarball on npm shipped the core sequential-IDs / migrate / archive / account-secrets surface; 1.4.1 layers on the board UI:

- **Card menu** — 3-dot button (top-right of each card) + right-click both open the same menu: Edit · Copy ID · Set priority ▸ · Move to top (bypass queue) · Assign ▸ · Archive · Delete. Disabled actions on cards with a run in flight so you can't shoot yourself in the foot mid-execution.
- **Assign ▸ submenu** — pick an agent or a user as the default assignee for the task's new sub-tasks. Backed by `execution_defaults.preferred_agents`. Existing sub-tasks aren't retroactively reassigned (open the detail dialog for that).
- **Agent display names** — `formatAgentLabel()` computes pretty defaults (`claude-opus-4-7` → "Claude Opus 4.7"). The picker shows a context-window pill ("1M", "200k", "128k") for known models. Double-click on the agent name in the Agents view → inline rename → Enter / blur saves, Escape cancels. Empty value clears the override and the auto-name takes back over.
- **DELETE / archive on the API** — `DELETE /tasks/:id`, `POST /tasks/:id/archive` + unarchive, same for sub-tasks, `PATCH /tasks/:id` for partial updates (priority, preferred_agents, etc.). The CLI already had archive/remove; the board UI now has them too.

If you're already on 1.4.0, this is a no-data-migration upgrade — `npm i -g backlog@latest`. The migrate / archive / secrets behaviour from 1.4.0 is unchanged.

## [1.4.0] - 2026-04-29

Sequential per-project IDs replace the legacy hex/timestamp format. **Breaking** — existing workspaces must run `backlog migrate ids` once after upgrading.

### Highlights

- **New ID format** — `task_001`, `subtask_001`, `run_001`, `claim_001`, `sync_001`, padded to three digits and growing past `task_999` naturally. Per-project counter: each workspace numbers its own entities starting from `001`.
- **Counter file** — `<backlogDir>/id-counters.json` tracks the next number per type, written synchronously on every create.
- **Migration tool** — `backlog migrate ids` walks the workspace, sorts entities by `created_at`, re-attributes IDs, and rewrites every cross-reference (subtask.task_id, run.task_id / subtask_id / claim_ids, run directories on disk, sync conflict references). Backs up `.backlog/` to `.backlog.pre-id-migration-<timestamp>/` before mutating. `--dry-run` and `--no-backup` available.
- **`backlog run`** — top-level shorthand for `backlog orchestrator start --auto`. Same flags. The `runs` namespace stays for inspection and management (`runs list`, `runs show`, `runs interrupt`, etc.).
- **Legacy ID prefixes dropped from the parser** — `TASK-`, `WI-`, `TK-`, `RUN-`, `RN-`, `ST-`, `SUB-`, `CLM-` no longer match in the `/commits` route or in the orchestrator chat tool descriptions. Run `backlog migrate ids` to regain auto-link in commit messages emitted post-migration. Pre-migration commit history keeps its original IDs as plain text — git history is not rewritten.
- **Archive cards** — new `backlog task archive <id>` and `backlog subtask archive <id>` (plus `unarchive`). Archived items keep their status, hide from the default board / list views, and the scheduler skips them. `task list --archived` to see them; `--all` for both. Hard-delete (`task remove`, `subtask remove`) keeps its current behaviour — archive is the soft-hide complement.
- **Account-level secrets** — `~/.backlog/secrets.json` now holds the default scope so a single `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` covers every project on the machine. Project-level overrides still work (`backlog secrets set --project KEY VALUE`). Lookup chain: project → account → null. New CLI flow: `backlog secrets set` defaults to account, `backlog secrets promote <key>` lifts a project secret to the account scope, `backlog secrets where` shows which scope provides each key.

### Upgrade flow

```sh
npm i -g backlog@latest          # 1.3.0 → 1.4.0
cd <your project>
backlog migrate ids --dry-run    # preview the rename map
backlog migrate ids              # apply (auto-backup at .backlog.pre-id-migration-…/)
```

If you skip the migration, new entities will use the new format while existing ones keep their legacy IDs — both load fine, but the parser regex won't link old-format IDs in commit messages.

### Touched

- `@backlog/config` — new `id-counter.ts` module (formerly in core, moved to break a circular import for the claims package).
- `@backlog/core` — `task-service`, `subtask-service`, `run-store`, `run-launcher`, `sync-conflicts` switch to `nextId(backlogDir, type)`. New `migrate-ids.ts` does the workspace walk + rewrite. `id.ts` (`makeId`) deleted.
- `@backlog/claims` — `claim-store.ts` drops the bespoke `CLM-{ISO}-{hex}` format. New dep on `@backlog/config`.
- `@backlog/connectors` — every connector class threads `backlogDir` so imported tasks are numbered into the importing workspace's counter. New dep on `@backlog/config`.
- `@backlog/server` — `/commits` regex matches new format only. Orchestrator chat tool descriptions now hint `e.g. run_001` to the LLM.
- `packages/cli` — new `migrate.ts` (registers `backlog migrate ids`) and `run-alias.ts` (registers top-level `backlog run`).

## [1.3.0] - 2026-04-29

The natural follow-up to 1.2.0. Brings the open-core boundary, the Desktop preview, and everything that was sitting in Unreleased onto a stable 1.x release.

### Highlights

- **Backlog Desktop** ([backlog.so/desktop](https://backlog.so/desktop), `packages/desktop/`) is now the recommended way to run the kanban for non-terminal users. Electron shell around the same `@backlog/server` + `@backlog/board-ui` the CLI already runs — one engine, one feature surface. The macOS DMG (Apple Silicon + Intel) is in Apple notarisation; Windows + Linux follow via the same `electron-builder` config. Free, Apache-2.0, full feature parity with `backlog serve`.
- **Open-core boundary made explicit.** CLI + Desktop + SDK are free forever under Apache-2.0. Backlog Cloud (private development, [waitlist](https://backlog.so/cloud)) only adds features that genuinely need infrastructure we run: SMTP for invites and digests, hosted auth & SSO (SAML/OIDC, SCIM), multi-tenant collaboration with real-time sync, hosted run executors (managed agents, ephemeral sandboxes), retention beyond local disk, audit log export. The boundary maps to *infrastructure we run*, not features we artificially gate.
- **Marketing surface refreshed** at [backlog.so](https://backlog.so): dedicated `/cli`, `/desktop`, `/sdk`, `/cloud` pages, an anonymous waitlist for Desktop and Cloud, and a flesh-out `/docs` covering quickstart, concepts, full CLI reference, workspace layout, configuration, the orchestrator, claims & the pre-commit hook, agents, connectors, the API, self-hosting, and troubleshooting.
- **Embedded server port fix** (`packages/server/src/index.ts`). `startServer({ port: 0 })` now returns the actually-bound port (read from `server.address()`) instead of echoing the requested `0`. Required for Electron's random-port boot; the CLI gets the fix for free, so `backlog serve --port 0` no longer reports the wrong URL.
- **`backlog hooks pause` / `backlog hooks resume`** are now first-class subcommands (previously only documented as escape-hatches). Pausing covers a 30-minute window so you can do a sequence of commits without the per-commit `BACKLOG_SKIP_HOOK=1` dance; resume re-enables on the spot.

### Workspace & projects

- **`backlog init`** initializes a workspace in the current directory; **`backlog init --user-level`** places it at `~/.backlog/<slug>/` for multi-repo projects without a single natural project root. Project name uniqueness is enforced across user-level entries.
- **`config.toml` carries `project_location`** (`in_repo` | `user_level`), mirrored in the user registry's per-entry `location`. The cross-platform registry path is `~/.backlog/projects.json`; legacy registries under `~/Library/Application Support/Backlog/` (macOS) or `~/.config/Backlog/` (Linux) are auto-migrated on first read.
- **`backlog project migrate <id> --to user-level`** (or `--to in-repo --into <repo-id>`) moves an existing workspace between layouts, copying state, rewriting `config.toml`, updating the registry, force-reinstalling hooks, and renaming the old dir to `.backlog.migrated-YYYY-MM-DD/` for rollback.
- **Projects** — first-class entity grouping one or many repos. Each work item can carry a `project_id`. CLI: `backlog project add|list|show|update|archive|remove`. Storage: `.backlog/projects.yaml`.

### Kanban board (`backlog serve`)

- **`backlog serve`** — local Hono server + Svelte 5 kanban board on `127.0.0.1:7878`, single binary. Cards drag between À faire / En cours / In Review / Done; live updates via SSE on every state mutation. Project dropdown + ⚙ Projects modal, 📁 Repos modal, 🔒 Permissions modal, ✂ splitter, `+ Ticket` and `+ Claim` modals.
- **Persistent orchestrator** — start/pause/stop a background loop that re-builds the execution plan and dispatches runs every `tick_interval_ms` (default 5s). Pause is soft (active runs keep going), stop drains. Hydrates only when `last_tick_at < 60s` to avoid surprise auto-launches. CLI: `backlog orchestrator start|pause|stop|status|config`. UI: ▶ ⏸ ⏹ trio in the topbar.
- **Live time estimates and progress** — every task gets `estimated_duration_seconds` (manual override or median of archived runs filtered by repo+lane, fallback 30 min) plus a derived `progress_percent`. Work-item progress is duration-weighted. The `/board` payload exposes `progress_percent`, `eta`, `elapsed_seconds`, `total_estimated_seconds`, `total_remaining_seconds`. UI shows a 4 px progress bar per task, ETA badge ticking every second, plus a global ETA pill.
- **Drag-to-reorder inside columns** — rewrites a sparse `priority_score` (work items use `rank`). Cross-column drag still triggers status change.
- **Repo management UI + API** — `/api/v1/repos` (GET/POST/PATCH/DELETE) wraps `@backlog/core`'s repo-service. List, add, rename, enable/disable, force-delete repos from the kanban.
- **GitHub / GitLab / Bitbucket / arbitrary Git URL clone** — repos can be added by URL. `RepoConfig` gains `git_url` and `provider`. `cloneAndAddRepo()` clones into `<workspace>/repos/<id>` by default. CLI: `backlog repos add --url ...`.
- **Permissions screen** — toggle workspace autonomy mode (observe / assist / delegate / autopilot), edit per-claim TTL and `enforce_on_commit`, configure each agent (enable, sandbox mode, success mode, concurrence, allowed risks, allowed repos).
- **Mechanical splitter + AI splitter** — ✂ button on work items without tasks. AI tab calls Claude (`claude-opus-4-7` by default, overridable via `BACKLOG_AI_MODEL`) with adaptive thinking and JSON-schema constrained output. Requires `ANTHROPIC_API_KEY`; degrades gracefully without.

### CLI commands

- `backlog init`, `backlog doctor`, `backlog status`, `backlog serve`
- `backlog project {add|list|show|update|archive|remove|migrate|migrate-rollback|export|import}`
- `backlog repos {list|show|add|update|remove}` (supports `--url` for cloning)
- `backlog work {add|list|show|move|update|remove|plan|split|import|assign-project|estimate}`
- `backlog task {add|list|show|move|update|remove|block|unblock|plan|estimate|progress}`
- `backlog claim {start|check|finish|list|gc}` (claims gain `expected_finish_at`, `expected_duration_seconds`, `agent_id`; `--duration` and `--agent` flags on `claim start`)
- `backlog schedule {simulate|explain|run}`
- `backlog runs {list|show|gc|interrupt|resume|approve|request-changes|complete|fail|handoff}`
- `backlog agents {list|show|enable|disable|update|validate|health}`
- `backlog sources {add|list|enable|disable|update|remove|validate|sync|push|conflicts|resolve}`
- `backlog orchestrator {start|pause|stop|status|config}`
- `backlog hooks {status|install|uninstall|pause|resume}` (pre-commit hook exports `BACKLOG_PROJECT_DIR` so `claim check` finds the workspace whether `in_repo` or `user_level`)
- `backlog release snapshot`
- `backlog worktree {list|gc}`

### Architecture

- TypeScript + ESM, Node ≥ 20.
- pnpm monorepo: `cli`, `core`, `claims`, `connectors`, `config`, `git`, `hooks`, `schemas`, `server`, `board-ui`. `schemas` is the source of truth (Zod) for cross-boundary types. tsup bundles everything into the published tarball.
- Apache-2.0 (CLI). `@backlog/board-ui` is Apache-2.0; `@backlog/server` is BUSL-1.1 (commercial license for hosted use).

### Notes for users coming from 1.2.0

- npm `latest` now points to `1.3.0`. Reinstall with `npm i -g backlog@latest`.
- No data migration is required; the workspace format hasn't changed since 1.2.0.
