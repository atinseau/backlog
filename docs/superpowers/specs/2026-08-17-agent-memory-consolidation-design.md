# Agent memory and consolidation — design

Status: **approved design, not yet planned**
Date: 2026-08-17
Depends on: [agent ticket tools](./2026-08-17-agent-ticket-tools-design.md) —
the trace-writing tool this spec assumes lives there

---

## 1. The problem

Backlog runs agents against tickets and throws away everything they learned.
Each `claude -p` process is stateless: no `--resume`, no session id, no memory
between runs. A subtask that `depends_on` another receives nothing from it but
committed code on a different branch. `task.dependencies` exists in the schema
(`packages/schemas/src/task.ts:42`), is written by the CLI, and is read by
nobody.

The one signal we already produce and waste is the run's final free-text
`artifact{kind:"summary"}` — the prompt already asks for it ("end with a
concise summary of what changed and any follow-up risk"), and it is buried in
`.backlog/runs/archive/<id>/run.json`, never read again.

So an agent picking up a ticket today cannot answer: why is the code shaped
this way, what was already tried and rejected, what constraint will bite me,
was this ticket already considered and dropped.

We want a memory that survives runs, resists rot, costs almost nothing to
read, and that agents actually use — without turning the docs folder into a
landfill of agent mistakes.

## 2. Mental model

Three writers, three disjoint zones, three regimes. **Nobody writes into
another writer's zone.**

| Writer | Zone | Regime | Location | Loss means |
| --- | --- | --- | --- | --- |
| Execution agent | ticket trace | append-only, immutable | `.backlog/` (outside git) | permanent |
| Consolidator | canon | rewritable, supersedable | declared canon zone, in git (§5) | permanent |
| Human | everything else in docs | theirs | project docs (in git) | permanent |
| graphify | index | reconstructible | `graphify-out/` (derived) | rerun `graphify update` |

```
        WRITE                                          READ

agent ──► ticket trace ─┐
 (in-turn, hot)         │
 append-only            ├─► consolidator ──► canon ─┐
                        │    (batched)      docs/   │
human ─► ticket ────────┘    may write      (git)   │
                              NOTHING                │
                                                     ▼
                                             graphify index ◄── the code
                                             graphify-out/
                                                     │
                                                     ▼
                                       PreToolUse ──► next agent
                                       query --budget 2000
```

The loop closes: the canon is indexed alongside the code, surfaces in the next
agent's session through the PreToolUse hook, that agent produces a trace, and
the trace feeds the next consolidation. Every arrow is one-way — no round
trips, no locks, no agent-to-agent coordination.

**The ticket is the mailbox. The canon is the state. The graph is the access.**

## 3. Decisions and rationale

| # | Decision | Why |
| --- | --- | --- |
| D1 | Journal outside git, canon inside git | A canon written by N parallel runs in N worktrees means permanent merge conflicts on memory files, and claims locking `docs/**` for the first agent. Only a single-writer pass, outside any worktree, can touch the canon. |
| D2 | Trace written in the agent's own final turn | `claude -p` is one-shot: the context dies with the process. A second call is already cold and must be paid in input. In-turn costs only the trace's output tokens. |
| D3 | Trace per session, consolidation per batch | An ADR is never born from one ticket; it is born from a pattern across tickets. Per-ticket consolidation fragments transversal decisions into partial documents — the same rot, obtained by fragmentation. |
| D4 | Machine contract imposed, human form adapted once | The contract lives in frontmatter, the form lives in everything else, so they never collide. The form is detected **once** at project adoption and frozen in config — an adapting consolidator repays discovery on every pass, forever. |
| D5 | Atomic unit: one file, one durable claim | A 30-claim `architecture.md` cannot be *partially* superseded. That is the most common rot vector: the document survives, three sentences inside go false, nobody knows which. |
| D6 | Hard graphify dependency, blocking globally | Owner decision. Everything is built on the graph, including ticket creation. |
| D7 | Never write what git already says | If a field can be reconstructed from the diff, log or run status, it must not exist. This is the primary defence against verbose traces, and it is mechanically testable. |
| D8 | Every canon-bound claim carries its evidence | A claim without proof is an agent opinion, and agent opinions are the raw material of a rotten vault. No proof, no promotion. |
| D9 | Quarantine, except on execution proof | A machine that fails is a fact; an agent reading code is an interpretation. Facts enter immediately, interpretations wait for a second witness. Replaces a subjective judgement of *value* with an objective count of *observations*. |
| D10 | The consolidator may write nothing | A consolidator obliged to produce will produce noise. "Wrote nothing" is a first-class outcome, journalled with its reason. |

## 4. The trace

Written by the execution agent, in its final turn, through a Backlog tool.
Stored per ticket under `.backlog/`, append-only: one trace per **run**, so a
ticket that ran three times carries three traces in chronological order. None
of them is ever edited or replaced — a retried run appends, it does not correct
its predecessor.

```
outcome            implemented | rejected | blocked
summary            one sentence — the only narrative field

constraints[]      { statement, evidence, confidence }
decisions[]        { chose, rejected, because }
rejection_reason   required when outcome = rejected
open_question      required when outcome = blocked
discovered_deps[]  either an existing ticket id (the system adds the edge) or
                   work with no ticket yet (the system creates a `proposed` one)
consolidation_hint none | high, with a reason
```

- `evidence` is a resolvable pointer: `path:line`, a test name, a command's
  error output.
- `confidence` is `verified` (produced by executing something) or `observed`
  (produced by reading and interpreting). It drives D9.
- `decisions[].rejected` is the field that justifies the whole exercise: the
  only information in the system that exists nowhere else and is lost forever
  if not captured hot.
- `rejection_reason` covers "not worth doing / too early / overkill". Without
  it, an agent recreates the same ticket in six months and repeats the
  reasoning to reach the same conclusion.
- `open_question` is non-promotable by construction. A block is a live state,
  not knowledge — it is written to be consumed by the next agent and then go
  stale.
- We deliberately do **not** ask what was done (D7). The diff says it better,
  for free, without risk of error.

**Split rule between trace and canon** (the non-duplication test, applicable
by an agent and by a linter):

> The trace never contains a present-tense claim.
> The canon never contains a past-tense account.

Citations run one way only: the canon cites tickets, never the reverse. If
tickets cited the canon, their links would rot on every rewrite.

A journal cannot rot — even when it holds an error, it stays true that the
agent believed it that day. Only the canon can rot, and only the canon is
rewritten.

## 5. The canon note

```markdown
---
id: mem-042
governs: ["packages/core/src/state-files.ts", "packages/core/src/**/*-store.ts"]
sources: [task_017, task_042]
status: active                    # or superseded_by: mem-071
confidence: verified              # verified | observed
updated_at: 2026-08-17
---

# State-file writers must be reentrant

<the claim, present tense, 1-3 paragraphs>

Established by [[task_042]].
```

Each frontmatter field removes a search cost:

| Field | Enables | Avoids |
| --- | --- | --- |
| `id` | citing safely | dead links on first rename |
| `governs` | intersection with `task.scopes`, and a real graph edge to code nodes | a semantic query to find what governs my code |
| `sources` | verifying, superseding, tracing back to the account | an orphan claim that can be neither traced nor refuted |
| `status` | retiring a false claim without erasing history | deletion as the only remedy against rot |
| `confidence` | letting a reader decide to trust or re-verify | treating interpretation as fact |
| `updated_at` | arbitrating between two diverging notes | silent ambiguity |

**The H1 is the claim itself, present tense, a complete sentence.** graphify
indexes it as the node label: a nominal subject ("Reentrancy") yields fuzzy
matches, a sentence yields sharp ones.

`governs` is the highest-yield field: it turns "find the constraints relevant
to my scope" from a semantic query into a set intersection — and, once
graphify has indexed both canon and code, into a real graph edge, so a canon
note becomes a direct neighbour of the code it constrains.

### Adoption: freezing the form once (D4)

The machine contract above is imposed. Everything else — which directory notes
live in, how files are named, whether they are grouped by subsystem or numbered
ADR-style, which language the prose uses — is the project's own and is
**detected once**, when the project is adopted, then written into `[memory]` in
`config.toml`.

The adoption pass reads the existing docs tree, infers the convention, and
records it: docs root, note subdirectory, naming pattern, prose language,
whether an index file is maintained. It is interactive — it proposes what it
found and the user confirms or corrects. From then on the consolidator reads
those ten lines of config instead of rediscovering the convention, which is the
whole point: an adapting consolidator repays discovery on every pass, forever.

Projects with no docs directory get the defaults created for them at adoption.

### What the canon note replaces, and what it does not

**It does not replace the ADR — it decomposes it.** The classic Nygard shape
(Context / Decision / Consequences) mixes two tenses in one file: a dated
account in the past ("we considered X, then Y") and a rule in force in the
present ("we use Z"). That mixture is precisely why old ADRs rot — the account
stays true forever, the rule may have changed, and nothing in the file
separates them.

The two halves split along the journal/canon line already established in §4:

- the account — context, alternatives weighed, what was tried — is *journal*,
  and lives in the ticket trace, which is already dated and immutable;
- the rule in force is *canon*, and lives in the atomic note.

Nothing is lost: `sources` leads back to the account, and graphify makes it an
edge. What is gained is that the rule becomes independently supersedable — the
day the project leaves Zod, `mem-003` gets `superseded_by: mem-088` without
touching March's account, which remains true.

For a human reader it can still *look* like an ADR: on a project with a
numbered `docs/adr/`, D4 makes notes adopt that placement and naming
(`docs/adr/0042-state-file-writers-must-be-reentrant.md`). Only the frontmatter
is imposed.

### Scope: what the consolidator owns

**Not all documentation is decision memory.** Install guides, tutorials, API
references do not come from a consolidation and the consolidator has no
business there. Two guardrails:

1. **A declared zone** in `[memory]` — the consolidator writes nowhere else.
2. **A mark of ownership** — it never modifies a file it did not create. It may
   read one, cite one, detect that it contradicts one; but when it contradicts
   a human-written ADR it creates a note that cites the conflict and flags it,
   it does not rewrite the file.

This is the §2 rule extended to a fourth writer: **the human has a zone too,
and nobody writes into another writer's zone.**


## 6. The consolidator

Batched. Triggered by threshold — default **10 resolved tickets** since the
cursor, or **7 days** with at least one, whichever comes first — or manually.
Both values live in `[memory]` and are meant to be tuned against the promotion
rate (§6, health metric). `consolidation_hint: high` on a trace weights the threshold;
it never triggers a pass on its own — an agent that can trigger spend will
trigger it too often, since by construction it just finished work it considers
important. The model proposes, the system decides (the same shape as the
`confirmed: true` gate in `packages/server/src/lib/orchestrator-chat.ts`).

Four possible outcomes per candidate claim: **ignore, promote, merge,
supersede**. The order of decision matters more than the judgement.

**Step 1 — mechanical filter, zero LLM.** Discard outright: every
`outcome: blocked`; every claim without `evidence`; every claim whose evidence
**no longer resolves** (file gone, test removed). Stale proof invalidates the
claim it carried. This step is free and removes most of the noise before the
first paid token.

**Step 2 — antecedent search via `graphify query --budget`.** For each
survivor, find neighbouring canon notes **and matching quarantine entries**.
This is what decides between promote, merge and supersede; without it the
consolidator emits duplicates because it cannot know what already exists.

Searching quarantine alongside the canon is not optional — it is what makes D9
work at all. A quarantined claim is by definition *not* in the canon, so a
canon-only search would re-quarantine it on every batch and it would never
graduate. A claim matching a quarantine entry **is** the second observation:
promote it and clear the entry.

`graphify query` is a BFS over the local `graph.json`, not a model call, so
this step costs zero LLM tokens. `--budget` bounds the *output*, i.e. what
step 3 will be charged for as input.

This step is also the decisive technical argument for D6: a consolidator
without a graph would have to re-read the entire canon on every pass — cost
linear in the size of memory, so the system collapses exactly when it becomes
useful. With the graph the cost is constant regardless of corpus size.

**Step 3 — arbitration, one LLM call for the whole batch.** Input: the
filtered claims, their antecedents, and the journal of past non-decisions (so
already-rejected claims are not re-judged). Output: a typed action plan per
item. One call, not one per claim.

**Step 4 — mechanical application.** Write files per the frozen convention,
run `graphify update` to reindex, append the journal entry.

### Promotion rules

- Contradiction of an existing note → supersede it (`superseded_by`), citing
  the ticket that established the change.
- A claim matching an existing note adds a `source` and reinforces it.
- `confidence: verified` and no antecedent → promote immediately.
- `confidence: observed` and no antecedent → **quarantine**: stays in the
  trace, promoted when a later batch confirms it.

### The consolidation journal

A new Backlog section. The consolidator always emits an entry, including on an
empty pass: advanced cursor, count of discarded claims, reasons, actions taken.

Three purposes, and the first is not auditability: **the consolidator needs its
own memory.** Without it, it restarts from zero on every pass, re-examines the
same tickets and endlessly re-judges what it had already discarded — so its
"write nothing" is not stable over time. Then: distinguishing "wrote nothing"
from "did not run", and human audit.

Health metric: the promotion rate. Persistently high means the batch threshold
is too low or the agents are too verbose; permanently zero means quarantine
never drains and the threshold is misconfigured.

## 7. Context injection

Minimal push, wide pull. The push criterion: *what the agent needs in order to
know there is something worth looking for.* Never content.

1. **Graph neighbourhood** — title plus one line per ticket this one depends
   on, one level only. This is what finally makes `task.dependencies` live.
2. **Constraints governing the scope** — intersection of `governs` with
   `task.scopes`, surfaced as titles.
3. **The index, never the content** — available slugs, as the pull primer.

Pull is served by graphify: `query --budget N` (default 2000 tokens) makes
context injection a **declared, bounded spend** rather than an estimate;
`affected "<path>"` returns impacted code *and* the decisions constraining it
in one request; `explain`, `path` and `god-nodes` cover navigation.

Behavioural leverage, weakest to strongest:

- The prompt ("consult memory before editing") is weakest — it would be the
  eighth line in a list that already has seven, and trailing instructions are
  the ones that get dropped.
- **`PreToolUse` intercepts at the moment of need** — an agent about to grep is
  redirected to the graph. This one is **graphify's own**, installed by
  `graphify claude install`; Backlog does not duplicate it and must not compete
  with it. It is structurally stronger than any instruction.
- `SessionStart` injects the minimal push automatically. **Backlog's**, since
  graphify knows nothing about tickets.
- A **`Stop` hook** refuses to end the session until the trace is deposited —
  Backlog's as well. It does not make the agent virtuous; it makes forgetting
  impossible. It needs no state: the server knows whether the ticket's trace
  exists, so the hook is an HTTP call to the local server.

The plumbing already exists: `providers/claude-code/command.ts:71` already
builds a `--settings` payload to inject `CLAUDE_CODE_PROFILE`. We extend it
rather than invent a channel (see §9 — it must become unconditional). Trade-off
accepted: hooks are Claude Code-specific, so Codex falls back to the prompt
alone — consistent with the project's stated direction ("stop designing for
parity").

### Verified empirically, 2026-08-17

The documentation does not state which hooks fire in print mode, so it was
measured against `claude -p` directly rather than assumed.

- `SessionStart`, `PreToolUse` and `Stop` **all fire under `claude -p`**. This
  is what makes graphify's `PreToolUse` interception work inside Backlog runs
  and not only in interactive sessions — the open question behind D6.
- **`Stop` can block in print mode.** `exit 2` prevents the stop, the hook's
  stderr reaches the agent as an instruction, and the agent resumes work to
  comply. In the test the prompt never mentioned the required file; the hook
  alone obtained it, and allowed the session to end on its second call.

Three consequences for this design:

1. **"Blocked without an explanation" becomes mechanically impossible.** An
   agent trying to end without a trace is sent back to write one. That is why
   the trace is the *only* status channel: the single channel is enforced by the
   runtime, not by convention.
2. **A blocked stop costs one full extra turn.** The trace contract must
   therefore live in the prompt from the start, with the hook as a net and never
   the normal path — otherwise every run pays that turn. A high `Stop`-block
   rate is a signal that the prompt is failing, not that the hook is working.
3. **A loop ceiling is mandatory.** An agent that refuses to write its trace
   would otherwise be blocked forever, paying a turn each time. Cap the blocks
   at 3, then let the session end, mark the run `trace_missing` and surface it
   on the board. A guardrail that hangs an agent is worse than no guardrail.

## 8. graphify as a hard dependency

Version pinned at a floor; `graphify` must be on PATH. `backlog doctor`
reports it as **required**, not optional. Startup verifies it and refuses to
run without it (owner decision D6, taken over the objection recorded in §10).

Consequences to handle explicitly:

- The graph is **derived**, never a source of truth. `graphify-out/` is
  gitignored; losing it costs one `graphify update`.
- LLM cost is confined to community labelling; extraction is deterministic
  tree-sitter. `--no-label` removes the LLM entirely, so reindexing on every
  consolidation is effectively free.
- `merge-driver` union-merges two `graph.json` files and `merge-graphs` builds
  a cross-repo graph — which fits Backlog's multi-repository model.
- `graphify claude install` writes into the target project's `CLAUDE.md` and
  installs a hook. Backlog must not do this silently on a user's repository;
  it is surfaced as an explicit action.
- Maturity risk is real and accepted: created April 2026, version 0.9.32, ~977
  open issues, Apache-2.0, Python. Mitigation is that the **write format is
  plain markdown** (frontmatter, wikilinks, atomic files) — any indexer can
  consume it, so a future replacement changes the reader, not the corpus.

## 9. Impact on existing code

**Targets the `AgentProvider` refactor**, which unifies every LLM call behind
one contract in `packages/core/src/providers/`. At the time of writing it lives
in the working checkout and is not yet on `main`; the mapping below assumes it
lands first. It makes this spec *easier* to implement, not harder — see the note
after the table.

| Area | Change |
| --- | --- |
| `packages/schemas` | new `trace.ts` and `memory.ts`; `config.ts` gains a `[memory]` block (canon zone, form convention, prose language, batch thresholds) |
| `packages/core` | new `trace-store.ts` and `consolidator.ts` |
| `packages/core/src/run-prompt.ts` | `buildProviderPrompt` gains the trace contract and the minimal push — one place, every runtime |
| `packages/core/src/providers/claude-code/command.ts` | extend the `--settings` payload with `SessionStart` and `Stop` hooks. It is already built there for `CLAUDE_CODE_PROFILE` (line 71) but only when a profile is set, so it must become unconditional |
| `packages/core/src/providers/types.ts` | `ProviderRunRequest` carries no hook channel today; either add one or let the claude-code provider derive hooks from agent + config |
| `packages/core/src/run-executor.ts` | recognise the trace as a run outcome alongside artifacts and usage |
| `packages/server` | routes for trace write, consolidation trigger and journal |
| `packages/cli` | `backlog consolidate`; `doctor` gains the graphify check. **No `backlog memory search`** — agents query graphify directly for the canon (see the tools spec, T6) |
| `packages/board-ui` | a consolidations section; trace rendering on the ticket; strings in **both** `i18n/en.json` and `i18n/fr.json` |
| `packages/core/src/ai-service.ts` + `split-service.ts` | scopes become graph-derived instead of invented (see §10) |

Two consequences of the refactor worth knowing before planning:

- **The common half and the Claude-specific half now have exactly one home
  each.** The trace contract goes in `run-prompt.ts` and reaches every runtime;
  the hooks go in `providers/claude-code/command.ts` and pollute none of the
  others. Before the refactor this meant touching three parallel executors.
- **`--append-system-prompt` is already wired** (`command.ts:65`, used by
  structured completions). It is a second channel for the trace contract, and
  possibly a better one than growing the main prompt, whose instruction list is
  already long enough that trailing lines get dropped.

## 10. Out of scope here

- **Agent-facing ticket tools.** Now specified separately in
  [agent ticket tools](./2026-08-17-agent-ticket-tools-design.md), which is a
  **prerequisite** of this spec: it owns `backlog trace write`, the read surface,
  and the `proposed` status that `discovered_deps` feeds. One finding from it
  matters here: reading a trace must display each claim's consolidation verdict,
  otherwise an agent can take a quarantined claim as true and quarantine
  protects the canon but not the agents.
- **Resuming a blocked ticket.** The mechanism falls out of this design — the
  block context written by agent 1 *is* agent 2's input, so no session resume
  is needed (and none would work when a different agent picks it up) — but the
  trigger and status transitions belong with the tools spec.
- **Embeddings.** `governs` intersection plus a navigable ticket graph covers
  the structural need. The vector layer is an accelerator for conceptual
  queries; it is built behind graphify's single interface, so it can be added
  when a gap is measured rather than assumed.
- **Fixing the splitter's invented scopes.** `validateProposal`
  (`ai-splitter.ts:517`) checks the repo but never that the paths exist, so it
  hallucinates scopes unchecked. The graph makes them derivable and
  `depends_on` computable from real code edges. Noted here because it is the
  strongest argument for D6, but it is its own change.

### Recorded objection

The owner chose to block on graphify at binary startup, without exception. The
objection, raised and overruled: the pre-commit hook invokes this binary via
the shim, so a developer without graphify could no longer commit at all; and
`backlog doctor` — the tool meant to report what is missing — could not run,
therefore could not report that graphify is missing. A diagnostic should not
depend on what it diagnoses. Recorded so the trade-off is visible if either
symptom shows up.

## 11. Testing

Backend tests only, `bun test ./packages`, fixtures in temp dirs, `HOME`
pointed at a sandbox (use `homeDir()` from `@backlog/config`, never
`os.homedir()`).

- Trace schema: each `outcome` enforces its required field; a claim without
  evidence is rejected at write time.
- Mechanical filter: a claim whose evidence no longer resolves is discarded;
  `blocked` never reaches arbitration.
- Quarantine: `observed` with no antecedent is not promoted; the same claim in
  a second batch is; `verified` is promoted on first sight.
- Journal: an empty pass still advances the cursor and records reasons; a
  previously discarded claim is not re-judged.
- Canon writes: `superseded_by` never deletes; `sources` accumulates.
- Ownership: a file inside the canon zone without the consolidator's mark is
  never modified, even when a claim contradicts it — the pass emits a
  conflict-flagging note instead. Writes outside the declared zone are refused.
- Non-duplication linter: a present-tense trace field and a past-tense canon
  body are both flagged.
- graphify is stubbed at the command boundary so tests do not need a real
  graph.
