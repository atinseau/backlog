# One Run Shape Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete `sandbox_mode` and `access_mode` so a run has exactly one shape — a worktree, a diff, a trace — and a repository answers exactly one question, through the `enabled` flag that already exists.

**Architecture:** Three deletions and one promotion. `--permission-mode bypassPermissions` becomes a constant, which removes the only branch `sandbox_mode` ever had and makes the façade/CLI trade unconditional. `access_mode` disappears from the repository, and the scheduler gate it carried moves to `enabled`, which gates nothing today. Nothing is added: no new field, no migration, no compatibility alias.

**Tech Stack:** Bun 1.3+ (runtime, package manager, test runner, bundler), TypeScript, Zod (`packages/schemas`), Hono (`packages/server`), Svelte 5 runes (`packages/board-ui`).

**Spec:** [docs/superpowers/specs/2026-08-18-one-run-shape-design.md](../specs/2026-08-18-one-run-shape-design.md)

## Global Constraints

- **Bun only.** No Node, npm, pnpm, tsx, tsup or vitest. Verification is `bun run typecheck`, `bun run test`, `bun run build`.
- **`bun test` with no path argument silently misses packages.** Always pass a path. `bun run test` scopes it to `./packages`.
- **A subset test run is a *stricter* check than the full suite, not merely a faster one.** After touching `packages/core/src/providers/`, run `bun test ./packages/core/src/providers` on its own — file order in the full suite has masked a module-init bug in this exact directory before.
- **No unused code, no dead code.** A field that survives with no reader is a plan failure, not a leftover. This is a standing rule in this repository.
- **Visible copy goes in both** `packages/board-ui/src/lib/i18n/en.json` **and** `fr.json`. The two files are key-for-key aligned; a key removed from one must be removed from the other.
- **Vocabulary:** repository, not repo, in new copy and new names. Existing `repo` API fields and storage keys are compatibility names — do not rename them here.
- **Zod objects in `packages/schemas` are non-strict.** Removing a field leaves existing on-disk files parsing fine; the key is stripped on read. No migration step and no version bump anywhere in this plan.
- **Never resolve runtime files relative to `import.meta.url`, and use `homeDir()` from `@backlog/config`, never `os.homedir()`.** Neither should come up here, but both break only after the binary ships.
- **Commit after every task.** The repository merges one PR per unit of work.

---

### Task 1: The permission mode becomes a constant, and the façade trade becomes unconditional

This is the behavioural heart of the plan. Everything after it is deletion of
things that no longer have a reader.

**Files:**
- Modify: `packages/core/src/providers/claude-code/command.ts:20-25,53-66,83`
- Modify: `packages/core/src/providers/claude-code/provider.ts:75-121,140`
- Modify: `packages/core/src/run-prompt.ts:54`
- Test: `packages/core/src/providers/claude-code/command.test.ts:24-34`
- Test: `packages/core/src/providers/claude-code/provider.test.ts:175-212`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `executionCliRole(): string | null` and `executionDeniedBuiltins(): readonly string[]` — both now **take no argument**. Task 2 relies on that signature change. `ClaudeCodeCommandInput` no longer has a `sandboxMode` property.

- [ ] **Step 1: Rewrite the two permission-mode tests in `command.test.ts`**

Replace the existing pair (the `bypassPermissions` default at line 24-28 and
`downgrades to plan mode when the agent is sandboxed read-only` at line 30-34)
with this single test:

```ts
  it("always runs under bypassPermissions — there is one run shape", () => {
    const command = buildClaudeCodeCommand({ executable: "claude", prompt: "x" });
    expect(command.args).toContain("--permission-mode");
    expect(command.args[command.args.indexOf("--permission-mode") + 1]).toBe("bypassPermissions");
    expect(command.args).not.toContain("plan");
  });
```

- [ ] **Step 2: Rewrite the two façade tests in `provider.test.ts`**

Replace the pair at lines ~175-212 (`executionCliRole` returning null under
`read-only`, and its `workspace-write` counterpart) with one test. Note
`agentFixture` no longer takes a `sandbox_mode` override:

```ts
  // The CLI closure and the façade that replaces it are one trade, and there is
  // no longer a condition that could hand out one half without the other.
  it("closes the CLI on every run, because every run gets the façade", () => {
    const agent = agentFixture();
    const command = buildRunCommand({
      agent,
      prompt: "do the work",
      cwd: "/tmp/worktree",
      backlogDir: "/tmp/project/.backlog",
      env: {},
      getSecret: noSecrets,
      onActivity: () => {},
    });

    expect(command.args[command.args.indexOf("--permission-mode") + 1]).toBe("bypassPermissions");
    expect(command.args[command.args.indexOf("--disallowedTools") + 1]).toBe("Bash(backlog:*)");
    expect(command.args).toContain("--mcp-config");
    expect(executionCliRole()).toBe("execution");
  });
```

- [ ] **Step 3: Run both test files to verify they fail**

Run: `bun test ./packages/core/src/providers/claude-code`
Expected: FAIL — `command.test.ts` still emits `plan` for no input reason yet
compiles, and `provider.test.ts` fails to compile because `executionCliRole`
still requires an argument.

- [ ] **Step 4: Make `--permission-mode` constant in `command.ts`**

Delete `permissionModeFor` and `permitsMcpTools` (lines 48-66) together with
their comment block, delete the `sandboxMode?: SandboxMode | undefined;` field
from `ClaudeCodeCommandInput` (line ~16) and its now-unused `SandboxMode`
import, then replace the emission at line 83:

```ts
  // One run shape: a run has a worktree, so it writes. There is no mode that
  // does not. `plan` used to be the read-only contract and was never a lock —
  // it is enforced by the model's system prompt, and its one hard effect was
  // to refuse MCP calls, which cost a run the Backlog façade.
  args.push("--permission-mode", "bypassPermissions");
```

- [ ] **Step 5: Drop `facadeReachable` in `provider.ts`**

Delete `facadeReachable` (lines 82-84) and the comment paragraph above it that
explains the condition. Replace the two consumers with:

```ts
/**
 * The CLI role every run's agent carries.
 *
 * The role is not a label on a run, it is one half of a trade: the CLI is
 * closed *because* the façade replaces it. Both halves are now unconditional,
 * so they cannot drift apart.
 */
export function executionCliRole(): string | null {
  return contextFor("execution").cliRole;
}

/**
 * The other half of the same trade. Today the single entry `Bash(backlog:*)`,
 * which denies any shell command whose first word is `backlog`.
 */
export function executionDeniedBuiltins(): readonly string[] {
  return contextFor("execution").deniedBuiltins;
}
```

Then update the two call sites: `disallowedTools: executionDeniedBuiltins(),`
in `buildRunCommand` (line ~163) and `const role = executionCliRole();` (line
~333). Delete `sandboxMode: agent.sandbox_mode,` from the
`buildClaudeCodeCommand` call (line ~140).

- [ ] **Step 6: Drop the fallback clause in `run-prompt.ts`**

Every run now reaches `trace_write`, so the clause at line 54 describes a case
that cannot occur. Delete that whole array entry. The preceding entry (`Before
you finish, record a trace by calling the \`trace_write\` tool.`) already
carries the contract.

- [ ] **Step 7: Run the provider tests on their own**

Run: `bun test ./packages/core/src/providers`
Expected: PASS. Run this directory alone, not only via the full suite — see
Global Constraints.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/providers/claude-code/ packages/core/src/run-prompt.ts
git commit -m "refactor(core): one permission mode, one façade trade"
```

---

### Task 2: `sandbox_mode` leaves the schema and the core

**Files:**
- Modify: `packages/schemas/src/agent.ts:17-19,40,59`
- Modify: `packages/core/src/agents.ts:60,134,183-188,234,284`
- Modify: `packages/core/src/run-executor.ts:87`
- Modify: `packages/core/src/providers/types.ts:55`
- Modify: `packages/core/src/providers/claude-code/provider.ts:192`
- Modify: `packages/core/src/providers/custom/provider.ts:31`
- Modify: `packages/core/src/providers/anthropic-api/provider.ts:87`
- Modify: `packages/config/src/init-layout.ts:152,163,174`
- Test: `packages/core/src/run-executor.test.ts:233-245`
- Test: `packages/core/src/agents.test.ts`, `packages/core/src/providers/registry.test.ts`, `packages/core/src/ai-service.test.ts`, `packages/core/src/providers/completion-provider.test.ts`, `packages/core/src/providers/claude-code/execute-run.test.ts` (fixture cleanup only)

**Interfaces:**
- Consumes: Task 1's argument-free `executionCliRole()` / `executionDeniedBuiltins()`.
- Produces: `Agent` (from `@backlog/schemas`) with no `sandbox_mode` property; `ProviderDescriptor` with no `sandboxModes` property. Tasks 3 and 4 consume both.

- [ ] **Step 1: Delete the test that asserts the coercion**

In `packages/core/src/run-executor.test.ts`, delete the whole
`coerces the agent to read-only against a read-only repository` test (lines
~233-245). It asserts `BACKLOG_SANDBOX_MODE`, which this task removes, through
`access_mode: "read-only"`, which Task 6 removes. Leave the
`refuses to run against a repository set to no-access` test alone — Task 6 owns it.

- [ ] **Step 2: Run the file to verify it now fails to compile or passes short**

Run: `bun test ./packages/core/src/run-executor.test.ts`
Expected: PASS with one fewer test. If the fixture helper still declares a
`sandbox_mode` parameter it stays compiling; that is cleaned in Step 6.

- [ ] **Step 3: Remove the field from the schema**

In `packages/schemas/src/agent.ts`, delete `sandboxModeSchema` and its comment
(lines 16-19), the `sandbox_mode: sandboxModeSchema.optional(),` line in
`agentSchema` (line 40), and the `export type SandboxMode = ...` line (line 59).

- [ ] **Step 4: Remove it from the agent service**

In `packages/core/src/agents.ts`: delete `sandbox_mode: "workspace-write",`
from the default agent literal (line 60); delete `sandboxMode?: SandboxMode;`
from both the add input (line 134) and the update input (line 234); delete the
`clearSandboxMode` branch and the `input.sandboxMode` assignment in both the
add path (lines ~183-188) and the update path (line ~284); delete the now-unused
`SandboxMode` import.

- [ ] **Step 5: Remove the environment variable and the descriptor field**

In `packages/core/src/run-executor.ts`, delete line 87
(`...(agent.sandbox_mode ? { BACKLOG_SANDBOX_MODE: agent.sandbox_mode } : {}),`).
It was read by no code in this repository.

In `packages/core/src/providers/types.ts`, delete `sandboxModes: SandboxMode[];`
(line 55) and the `SandboxMode` import. Then delete the corresponding entry from
all three descriptors: `claude-code/provider.ts:192`, `custom/provider.ts:31`,
`anthropic-api/provider.ts:87`.

- [ ] **Step 6: Remove it from the generated project layout and the test fixtures**

In `packages/config/src/init-layout.ts`, delete the three
`"    sandbox_mode: workspace-write",` lines (152, 163, 174).

Then remove every remaining `sandbox_mode` occurrence from test fixtures:

```bash
grep -rn "sandbox_mode\|sandboxMode\|SandboxMode\|sandbox_modes" packages/ --include=*.ts --include=*.svelte | grep -v board-ui
```

Every hit outside `packages/board-ui` (Task 4 owns that) must be gone. Delete
the fixture properties; do not replace them with anything.

- [ ] **Step 7: Run core and config**

Run: `bun test ./packages/core ./packages/config ./packages/schemas`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/schemas packages/core packages/config
git commit -m "refactor(core): drop sandbox_mode from the agent"
```

---

### Task 3: `sandbox_mode` leaves the CLI and the API

**Files:**
- Modify: `packages/cli/src/commands/agent.ts:51-55,87,99,114,171,212-213,231,251`
- Modify: `packages/server/src/routes/agents.ts:19-22,30,53,76,100,126-127,150`
- Test: `packages/server/src/routes/` (any agents route test asserting the field)

**Interfaces:**
- Consumes: Task 2's `Agent` without `sandbox_mode`, `ProviderDescriptor` without `sandboxModes`.
- Produces: `GET /api/v1/agents` responses with no `sandbox_mode` key; `GET` provider descriptors with no `sandbox_modes` key. Task 4 consumes both.

- [ ] **Step 1: Check whether a route test asserts the field**

Run: `grep -rn "sandbox" packages/server/src`
Expected: hits only in `routes/agents.ts`. If a test asserts `sandbox_mode` in a
response body, delete that assertion in this task rather than later.

- [ ] **Step 2: Remove the CLI flags**

In `packages/cli/src/commands/agent.ts`: delete `normalizeSandboxMode` (lines
51-55); delete both `.option("--sandbox-mode <mode>", ...)` declarations (lines
87 and 212) and `.option("--clear-sandbox-mode", ...)` (line 213); delete the
`sandboxMode?: string;` properties from both option types (lines 99, 231); delete
both spread lines that forward it (114, 251); delete the
`console.log(\`Sandbox: ...\`)` line in `agents show` (line 171).

- [ ] **Step 3: Remove the API surface**

In `packages/server/src/routes/agents.ts`: delete `sandboxModeSchema` and its
`project-write` compatibility comment (lines 18-22); delete `sandbox_mode` from
`updateBodySchema` (line 30) and `createBodySchema` (line 53); delete
`sandbox_modes: descriptor.sandboxModes,` from the provider descriptor response
(line 76); delete `sandbox_mode: agent.sandbox_mode ?? null,` from the agent
response (line 100); delete the `clearSandboxMode` / `sandboxMode` branch in
`toUpdateInput` (lines 126-127); delete the spread in `toAddInput` (line 150).

- [ ] **Step 4: Verify nothing in cli or server still mentions it**

Run: `grep -rn "sandbox" packages/cli/src packages/server/src`
Expected: no output.

- [ ] **Step 5: Run the two packages**

Run: `bun test ./packages/cli ./packages/server`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cli packages/server
git commit -m "refactor(cli,server): drop the sandbox mode flag and field"
```

---

### Task 4: `sandbox_mode` leaves the board

**Files:**
- Modify: `packages/board-ui/src/lib/AgentsView.svelte:110-116,271-275,438-446`
- Modify: `packages/board-ui/src/lib/types.ts:124,158,223`
- Modify: `packages/board-ui/src/lib/api.ts:278,311`
- Modify: `packages/board-ui/src/lib/i18n/en.json:235,301-305,623`
- Modify: `packages/board-ui/src/lib/i18n/fr.json:235,301-305,623`

**Interfaces:**
- Consumes: Task 3's API responses without `sandbox_mode` / `sandbox_modes`.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Remove the selector from `AgentsView.svelte`**

Delete the `sandboxOptions` array (lines ~110-116, four entries: `default`,
`read-only`, `project-write`, `⚠ danger-full-access`), the handler that patches
the field (lines ~271-275), and the whole field block in the template that
renders `agents_view.field_sandbox` with its `<select>` (lines ~438-446). Delete
the `SandboxMode` import.

- [ ] **Step 2: Remove the types and the API wrappers**

In `packages/board-ui/src/lib/types.ts`: delete `export type SandboxMode = ...`
(line 124), `sandbox_modes: SandboxMode[];` (line 158) and
`sandbox_mode: SandboxMode | null;` (line 223).

In `packages/board-ui/src/lib/api.ts`: delete the two inline `sandbox_mode`
properties (lines 278 and 311).

- [ ] **Step 3: Remove the strings from both locales**

Delete these keys from `en.json` **and** `fr.json`:

```
agents_view.field_sandbox
agents_view.sandbox.default
agents_view.sandbox.default_help
agents_view.sandbox.read_only_help
agents_view.sandbox.workspace_write_help
agents_view.sandbox.full_access_help
permissions.field.sandbox
```

`permissions.field.sandbox` is defined in both files and referenced by no
component — it goes with the rest under the no-dead-code rule.

- [ ] **Step 4: Verify the locales stayed aligned and nothing still references the keys**

```bash
bun -e 'const en=require("./packages/board-ui/src/lib/i18n/en.json"),fr=require("./packages/board-ui/src/lib/i18n/fr.json");const a=Object.keys(en),b=Object.keys(fr);console.log(a.length,b.length,a.filter(k=>!b.includes(k)),b.filter(k=>!a.includes(k)))'
grep -rn "sandbox" packages/board-ui/src
```

Expected: two equal counts, two empty arrays, and no output from the grep.

- [ ] **Step 5: Typecheck the board**

Run: `bun run typecheck`
Expected: PASS (this runs `tsc --noEmit` and `svelte-check`).

- [ ] **Step 6: Commit**

```bash
git add packages/board-ui
git commit -m "refactor(board): drop the agent sandbox selector"
```

---

### Task 5: `enabled` gates the scheduler, replacing `no-access`

The only task that *adds* behaviour. `enabled` gates nothing today: its single
use is picking a default repository (`scheduler.ts:226`, `run-launcher.ts:99`).

**Files:**
- Modify: `packages/core/src/scheduler.ts:309-315`
- Modify: `packages/board-ui/src/lib/run-start-errors.ts:32`
- Test: `packages/core/src/scheduler.test.ts` (new test at the end of the describe block)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the skip reason string `"repository_disabled"`, replacing `"repo_no_access"`. Task 7 does not touch it; this task owns both sides.

- [ ] **Step 1: Write the failing test**

Append to the describe block in `packages/core/src/scheduler.test.ts`:

```ts
  it("does not schedule against a disabled repository", () => {
    const root = createWorkspace();
    const backlogDir = path.join(root, ".backlog");
    writeExecutableAgent(backlogDir);

    const work = createTask(backlogDir, { title: "Off-limits", repoTargets: [path.basename(root)] });
    const task = createSubTask(backlogDir, {
      workItemId: work.id,
      title: "Should not run",
      repo: path.basename(root),
      scopes: ["README.md"],
      risk: "low",
    });

    const config = loadConfig(backlogDir);
    config.repos[0]!.enabled = false;

    const plan = buildExecutionPlan(backlogDir, config);
    expect(plan.blocked.find((decision) => decision.taskId === task.id)?.reasons).toContain("repository_disabled");
    expect(plan.runnable.find((decision) => decision.taskId === task.id)).toBeUndefined();
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test ./packages/core/src/scheduler.test.ts -t "disabled repository"`
Expected: FAIL — the reason array does not contain `repository_disabled`, and
the task is in `runnable`.

- [ ] **Step 3: Replace the gate in `scheduler.ts`**

At lines ~309-315, replace the `no-access` block and its comment with:

```ts
      // A repository answers one question: may agents be sent there. A
      // disabled repository is off-limits for runs — even if an agent could
      // otherwise take the task, the planner refuses to schedule it.
      if (repo.enabled === false) {
        reasons.push("repository_disabled");
      }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test ./packages/core/src/scheduler.test.ts`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Update the board's error mapping**

In `packages/board-ui/src/lib/run-start-errors.ts:32`, replace
`directReasons.includes("repo_no_access")` with
`directReasons.includes("repository_disabled")`. The `repo_not_allowed` half of
the condition and the `card.play_repo_blocked` string both stay.

- [ ] **Step 6: Verify the old reason is gone everywhere**

Run: `grep -rn "repo_no_access" packages/`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/scheduler.ts packages/core/src/scheduler.test.ts packages/board-ui/src/lib/run-start-errors.ts
git commit -m "feat(core): a disabled repository is off-limits for runs"
```

---

### Task 6: `access_mode` leaves the schema and the core

**Files:**
- Modify: `packages/schemas/src/config.ts:8-17,29`
- Modify: `packages/core/src/repo-service.ts:138,287-289`
- Modify: `packages/core/src/run-executor.ts:36-50`
- Test: `packages/core/src/run-executor.test.ts:222-231`
- Test: fixture cleanup across `packages/core` and `packages/server` (about fifteen files)

**Interfaces:**
- Consumes: Task 5's `repository_disabled` gate — the replacement must land first, or a `no-access` repository becomes runnable with nothing in its place.
- Produces: `RepoConfig` (from `@backlog/schemas`) with no `access_mode` property. Task 7 consumes it.

- [ ] **Step 1: Delete the test that asserts the refusal**

In `packages/core/src/run-executor.test.ts`, delete the whole
`refuses to run against a repository set to no-access` test (lines ~222-231).
The behaviour it covers moved to the scheduler in Task 5, where
`does not schedule against a disabled repository` now covers it.

- [ ] **Step 2: Run the file to confirm the remaining tests still pass**

Run: `bun test ./packages/core/src/run-executor.test.ts`
Expected: PASS with one fewer test.

- [ ] **Step 3: Remove the field from the schema**

In `packages/schemas/src/config.ts`, delete `repoAccessModeSchema` with its
whole comment block (lines 8-17) and the `access_mode: repoAccessModeSchema.optional(),`
line with its three-line comment (line ~29).

- [ ] **Step 4: Remove the policy from the executor and the service**

In `packages/core/src/run-executor.ts`, delete `applyRepoAccessPolicy` entirely
(the function at lines ~36-50 and its doc comment) and its call site. Delete the
now-unused `getRepo` import if nothing else in the file uses it — check with
`grep -n "getRepo" packages/core/src/run-executor.ts` before deleting.

In `packages/core/src/repo-service.ts`, delete
`access_mode: input.accessMode ?? "read-write",` (line 138), the
`if (input.accessMode !== undefined) { repo.access_mode = input.accessMode; }`
block (lines ~287-289), and `accessMode` from both input types.

- [ ] **Step 5: Strip the fixtures**

Run: `grep -rln "access_mode\|accessMode" packages/core packages/server packages/cli`

Delete every `access_mode: "read-write",` property from repository fixtures in
those files — about fifteen. They set the default explicitly and assert nothing.
`packages/board-ui` is Task 7's.

- [ ] **Step 6: Run the backend packages**

Run: `bun test ./packages/core ./packages/server ./packages/cli ./packages/schemas`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/schemas packages/core packages/server packages/cli
git commit -m "refactor(core): drop access_mode from the repository"
```

---

### Task 7: `access_mode` leaves the API and the board

**Files:**
- Modify: `packages/server/src/routes/repos.ts:13,26,44,182,206,236`
- Modify: `packages/board-ui/src/lib/RepositoriesView.svelte` (create form, pill, selector, handler, CSS)
- Modify: `packages/board-ui/src/App.svelte:585-589`
- Modify: `packages/board-ui/src/lib/types.ts:321,336`
- Modify: `packages/board-ui/src/lib/api.ts:502,547`
- Modify: `packages/board-ui/src/lib/i18n/en.json:661-668`
- Modify: `packages/board-ui/src/lib/i18n/fr.json:661-668`

**Interfaces:**
- Consumes: Task 6's `RepoConfig` without `access_mode`.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Remove the API surface**

In `packages/server/src/routes/repos.ts`: delete `accessModeSchema` (line 13);
delete `access_mode` from `createBodySchema` (line 26) and `updateBodySchema`
(line 44); delete the three forwarding lines (182, 206, 236).

- [ ] **Step 2: Remove the board's access controls**

In `packages/board-ui/src/lib/RepositoriesView.svelte`, delete:
- the `newAccessMode` state variable and `input.access_mode = newAccessMode;` in the create path (line ~171)
- `handleAccessModeChange` (lines ~221-230)
- `{@const accessMode = repo.access_mode ?? "read-write"}` (line ~431)
- the `<span class="access-pill …">` block (lines ~450-452)
- the `<select value={accessMode} …>` and its three options in the actions row (lines ~505-511)
- the `repos_view.access_mode` label block with its select and hint in the create form (lines ~609-617)
- the `.access-pill` and `.access-read-write` / `.access-read-only` / `.access-no-access` CSS rules

The `enabled` toggle, the `disabled` class on the `<li>` and the `off` badge all
stay — that is now the only access control, and it must remain visible.

- [ ] **Step 3: Simplify the runnable-repository predicate**

In `packages/board-ui/src/App.svelte`, delete the middle line of the predicate:

```svelte
  const hasRunnableWorkspace = $derived(
    repoOptions.some((repo) =>
      repo.enabled !== false &&
      (Boolean(repo.checkout_path ?? repo.path) || Boolean(repo.remote_url)),
    ),
  );
```

- [ ] **Step 4: Remove the types and the strings**

In `packages/board-ui/src/lib/types.ts`: delete
`export type RepositoryAccessMode = ...` (line 321) and `access_mode?: RepositoryAccessMode;`
(line 336). In `packages/board-ui/src/lib/api.ts`: delete both `access_mode`
properties (lines 502, 547).

Delete these eight keys from `en.json` **and** `fr.json`:

```
repos_view.access_mode
repos_view.access_change_title
repos_view.access_read_write
repos_view.access_read_only
repos_view.access_no_access
repos_view.access_hint_read_write
repos_view.access_hint_read_only
repos_view.access_hint_no_access
```

- [ ] **Step 5: Verify nothing is left and the locales stayed aligned**

```bash
grep -rn "access_mode\|accessMode\|RepositoryAccessMode" packages/
bun -e 'const en=require("./packages/board-ui/src/lib/i18n/en.json"),fr=require("./packages/board-ui/src/lib/i18n/fr.json");const a=Object.keys(en),b=Object.keys(fr);console.log(a.length,b.length,a.filter(k=>!b.includes(k)),b.filter(k=>!a.includes(k)))'
```

Expected: no grep output (build artefacts under `packages/board-ui/dist/` may
still match — they are regenerated, ignore them), two equal key counts, two
empty arrays.

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server packages/board-ui
git commit -m "refactor(server,board): drop the repository access mode"
```

---

### Task 8: Documentation, and the full verification

**Files:**
- Modify: `CLAUDE.md` §3 and §8
- Modify: `docs/superpowers/specs/2026-08-18-one-run-shape-design.md:3` (status header)

**Interfaces:**
- Consumes: every earlier task.
- Produces: nothing.

- [ ] **Step 1: Correct CLAUDE.md §3**

Three passages describe behaviour this plan removed. Rewrite each:

1. In the paragraph beginning *"The CLI is closed exactly where the façade
   replaces it"*, delete the sentences from *"The closure is not a property of
   being a run"* through *"left it with no channel at all."* — the condition they
   describe no longer exists. Replace with one sentence: *"Both halves are
   unconditional: every run gets the façade, `BACKLOG_AGENT_ROLE=execution` and
   `--disallowedTools Bash(backlog:*)`."* Delete the mention of `facadeReachable`
   as a predicate with two consumers; `executionCliRole` and
   `executionDeniedBuiltins` now simply read the table.
2. In the table row list under *"Which answer applies where comes from one
   table"*, the `providers/claude-code/provider.ts` entry says *"four times"*.
   It is still four call sites; verify with
   `grep -c "contextFor" packages/core/src/providers/claude-code/provider.ts`
   and correct the count if it changed.
3. Delete the `--permission-mode` entry from the emitted-flags list in §8, and
   rewrite the bullet beginning *"Permission modes are coarse"* — there is now
   one mode. Delete the whole bullet beginning *"A `read-only` run's trace is
   best-effort"*: it was the weakest link in the trace contract and this plan
   removed its cause. Replace it with a short bullet noting that every run now
   reaches `trace_write`, and that failing a traceless run remains unwritten.

- [ ] **Step 2: Mark the spec implemented**

In `docs/superpowers/specs/2026-08-18-one-run-shape-design.md`, change line 3
from `Status: **approved** · not started` to
`Status: **approved** · implemented`. The previous branch shipped with a stale
header; do not repeat it.

- [ ] **Step 3: Run the full verification, in order**

```bash
bun run typecheck
bun run test
bun run build
```

Expected: `typecheck` clean; `test` green with a total **below** the 785 baseline
(this plan deletes four tests and adds one, so expect 782); `build` produces
`dist/backlog` at roughly 63 MB.

Do not report a number you did not read from the output. If the count differs
from 782, find out which test moved before continuing.

- [ ] **Step 4: Probe the compiled binary**

Unit tests assert the flag matrix; this asserts the binary behaves.

```bash
grep -rn "permission-mode" packages/core/src/providers/claude-code/command.ts
./dist/backlog agents show claude-code 2>&1 | grep -i sandbox
./dist/backlog agents update --help 2>&1 | grep -i sandbox
```

Expected: the first prints one line with `bypassPermissions` and no `plan`; the
second and third print nothing.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-08-18-one-run-shape-design.md
git commit -m "docs: one run shape, and no mode that says otherwise"
```

- [ ] **Step 6: Open the PR and merge it**

The PR body carries the one behaviour that does not survive the deletion. Spec
§6: a repository the user had set to `no-access` becomes runnable again unless
they also untick `enabled`. It is the only setting whose meaning is not
preserved, and it fails **open** — so it belongs where a user will read it,
not in a code comment.

```bash
git push -u origin refactor/one-run-shape
gh pr create --title "One run shape" --body "$(cat <<'BODY'
`sandbox_mode` had exactly one branch in the whole codebase (`read-only` ->
`plan`, everything else -> `bypassPermissions`), so `workspace-write` and
`danger-full-access` were indistinguishable. `access_mode`'s `no-access`
duplicated `enabled`, whose own schema comment said so, while `enabled` gated
nothing. And `read-only` was neither a sandbox nor a permission: the isolation
is the worktree, and plan mode is enforced by the model's system prompt — a
mutating `Bash` call under it runs.

Its one hard effect was a regression Backlog inflicted on itself. Plan mode
refuses MCP calls, so a `read-only` run got no façade, kept the CLI, and
recorded its trace 2 times in 10.

**One rule now: a run has a worktree, so it produces a diff and a trace.** A
repository answers one question, and `enabled` answers it. An analysis run needs
no mode — it gets a worktree and writes nothing in it. A worktree with no commit
is the read-only outcome.

`--permission-mode bypassPermissions` is a constant, `facadeReachable` is gone,
and the façade/CLI trade is unconditional — the two halves can no longer drift
apart, which is the bug caught in review during #17. Every run reaches
`trace_write`.

### Upgrade note

A repository previously set to `no-access` becomes runnable again unless you
also untick **enabled** on it in the board's Repositories view. It is the only
setting whose meaning is not preserved, and it fails open. Everything else is
stripped silently on read — Zod is non-strict here, so no migration runs and no
config file needs editing.

Spec: `docs/superpowers/specs/2026-08-18-one-run-shape-design.md`
Plan: `docs/superpowers/plans/2026-08-18-one-run-shape.md`
BODY
)"
gh pr merge --squash --delete-branch
git checkout main && git pull
```

`gh pr merge --delete-branch` fails its local cleanup when `main` is checked out
in another worktree; the remote merge still succeeds. Check `origin/main` before
assuming failure.

- [ ] **Step 7: Tick this plan's checkboxes**

Fifty-odd `- [ ]` in this file. The previous branch left all fifty-five of its
own unticked and had to say so in a handoff. Tick them as you go, not at the
end.
