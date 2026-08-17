# Prompt registry — design

Status: **approved design, not yet planned**
Date: 2026-08-17
Cuts across: [agent memory](./2026-08-17-agent-memory-consolidation-design.md) ·
[agent ticket tools](./2026-08-17-agent-ticket-tools-design.md)

---

## 1. The problem

Every text that frames a model's behaviour is hardcoded, scattered across five
files and two packages, and invisible from the product. There is no way to see
what a model actually receives, and no way to change a tone, a policy or a tool's
returned text without editing TypeScript and rebuilding the binary.

The deeper problem is not editability. It is that **nobody can see the prompt**.
A run behaves oddly and the only way to know what it was told is to read the
source that produced it — and even then, the interpolated values are gone.

## 2. Inventory of hardcoded framing text

| Text | Location | Audience |
| --- | --- | --- |
| Run prompt + `INSTRUCTIONS` (7 rules) | `core/src/run-prompt.ts` | implementation agent |
| `buildRetryPrompt` | same | agent on retry |
| **9 tool descriptions** + the `awaiting_confirmation` stub | `core/src/orchestrator-tools.ts` (330 l.) | chat model |
| `SYSTEM_PROMPT` / `CHAT_SYSTEM_PROMPT` | `server/src/lib/chat/anthropic-chat.ts:13` | chat model |
| `TITLE_SYSTEM_PROMPT` | `server/src/lib/ai-splitter.ts:52` | task naming |
| `REFINE_SYSTEM_PROMPT` | `server/src/lib/ai-splitter.ts:71` | refinement |
| `SPLIT_SYSTEM_PROMPT` | `server/src/lib/ai-splitter.ts:83` | split planner |
| `DEFAULT_PLANNER_PROMPT` | **`board-ui/src/lib/CreateTaskDialog.svelte:31`** | split planner |

## 3. Three findings

**The only override that exists today is broken.** `plannerPrompt` has its
default in the **front end**, not the server: `buildSplitSystemPrompt(undefined)`
returns the base prompt alone. So a direct API call to
`POST /tasks/:id/suggest-split` does not behave like the board. That is not a
system default, it is a prefilled form field — and it is exactly the pattern not
to generalise.

**Tool descriptions are prompts and nothing treats them as such.** *"WRITE TOOL:
only call with confirmed:true AFTER the user has explicitly approved in plain
language"* is behavioural instruction disguised as metadata. The
`awaiting_confirmation` stub goes further: it returns **a message addressed to the
model**. Any naive inventory misses both.

**The same text does not have the same standing across runtimes.**
`CHAT_SYSTEM_PROMPT` is shared by both chat backends, but `anthropic-chat.ts`
passes it as `system` (it *is* the system prompt) while `claude-code-chat.ts`
passes it as `appendSystemPrompt` (it is *appended* to Claude Code's own).
Identical text, different scope. The registry must model that difference rather
than hide it.

## 4. Decisions and rationale

| # | Decision | Why |
| --- | --- | --- |
| P1 | A prompt is a composition of typed blocks, not a blob | A single textarea forces the user to retype the contract to preserve it, so someone will break it. Worse, a full override **freezes the user on the prompt of the day they edited** — no later improvement ever reaches them. |
| P2 | Three block natures: **contract** (locked), **policy** (per prompt), **tone** (cross-cutting) | Same split as the docs design: imposed machine contract, adaptable human form. Making the contract editable lets someone disable a guardrail unknowingly and silently — rewrite the chat prompt, drop the confirmation protocol, and the model dispatches billable runs without asking. |
| P3 | Tone is defined once and injected into every prompt; policy stays attached to its prompt | "Answer in French, be terse" is meaningful for all prompts; repeating it six times guarantees the seventh is forgotten when we add one. Split rules are meaningful only to the planner. A new prompt inherits the tone for free. |
| P4 | Assembly is a pure function in `core`, unit-tested | A misassembled prompt does not crash — it degrades agents silently for weeks. That is the worst bug profile, and the UI has zero tests over 29k lines. Putting assembly where the 333 backend tests live removes the silent-risk class entirely; the front end only renders. |
| P5 | Each run records the prompt version it received | Without it an override makes the system undebuggable: "the agent did badly" is meaningless when you cannot know what it was told. Same provenance logic as the trace and the canon. |
| P6 | A tool's description and schema are contract; its **returned text** is policy | Rewriting `start_subtask`'s description changes *when* the model spends money. Rewriting the `awaiting_confirmation` stub changes how a refusal is phrased, and breaks nothing functional. Visible in both cases, editable only in the second. |
| P7 | Project-level storage only, to begin with | Everything else configurable lives in the project (`config.toml`, `agents.yaml`). A user-level tier is tempting for language, but each resolution tier is one more thing to debug against P5. Add it if repetition becomes painful. |
| P8 | An inspector first, an editor second | The real gap is that nobody can see what the model receives. Reframing the screen this way makes preview, inheritance and diff the default view instead of features to bolt on. |
| P9 | Prompts are data, not i18n | They never enter `en.json` / `fr.json`. Only the UI chrome around them does. Prompt language is a tone block. |

## 5. The block model

```
PromptBlock
  id          stable, referenced by overrides
  nature      contract | policy | tone
  origin      product-default | tone-global | project-override
  text        the content
  locked      derived: nature === contract
  rationale   why it is locked (shown in the UI, contract blocks only)
```

A prompt is an ordered list of blocks. Rendering resolves each block against its
override, if any, and concatenates. Overrides store **only the blocks that differ
from the default**, which is what lets product defaults evolve underneath them.

Tone is a single block, stored once, injected into every prompt's block list.
**Each prompt declares where** — position is per prompt, not global, because a
three-line naming prompt and a thirty-line run prompt do not have the same
profile. The default is last: trailing instructions carry more weight, which is
precisely the reason the run prompt's existing 7-rule list is a poor place to add
an eighth (a finding from the memory spec).

Two things the model must carry, from finding 3:

- **The channel** a prompt is delivered through (`system` vs
  `append-system-prompt` vs user turn), because the same text has different
  standing depending on it.
- **The runtime** it applies to, since `--append-system-prompt` is Claude
  Code-specific.

## 6. Assembly and versioning

Assembly is a pure function: `(promptId, overrides, context) → { text, version }`.

`version` is a hash over the resolved block set. It is written to the run record
next to the model and reasoning effort, so a past run can display the exact
prompt it received (§7).

This is the single most important architectural point of this spec. It is what
makes the front end low-risk, and it is what makes P5 cheap: the version falls out
of assembly rather than being tracked separately.

## 7. UX

Not a settings page. **A dense, tool-like inspector**, per the project's UI
conventions — no marketing layout inside the app.

The default view answers *what does the model receive*:

- **The assembled prompt, as sent.** Contract blocks visibly read-only, with
  their `rationale` explaining why — a greyed block with no explanation reads as
  arbitrary, and a frustrated user will work around it.
- **Preview against a real ticket.** The run prompt is interpolated (`Task: ${id}`,
  scopes, dependencies, criteria), so a skeleton with placeholders means editing
  blind. A ticket selector renders the exact text that would be sent.
- **Origin on every block.** Product default, global tone, or local override.
  Inherited tone appears in prompts the user never edited; without a marker they
  read it as a bug or duplicate it.
- **Diff against the default**, at a glance. Three months on, nothing else tells
  you what you changed or why agents behave the way they do.

Editing is an action on a segment of that document, not a separate form.

**The second reason this screen exists**, and it may outweigh editing: because
runs record their prompt version, a past run can display **the exact prompt it
received**. "This agent did badly" becomes "here is what we told it". That is a
debugging tool the product does not have today, and it falls out of §6 for free.

Deliberately left open: layout, information density, and interaction detail
deserve a dedicated design pass. This section fixes the principles, not the
pixels.

## 8. Impact on existing code

| Area | Change |
| --- | --- |
| `packages/schemas` | `PromptBlock`, prompt id enum, override storage shape |
| `packages/core/src/prompts/` | the registry: default block sets, the pure assembly function, versioning |
| `packages/core/src/run-prompt.ts` | becomes a consumer of the registry rather than the owner of the text |
| `packages/core/src/orchestrator-tools.ts` | descriptions and schemas declared as contract blocks; returned texts (incl. `awaiting_confirmation`) as policy blocks |
| `packages/server/src/lib/ai-splitter.ts` | the three system prompts move into the registry |
| `packages/server/src/lib/chat/*` | both backends read the chat prompt from the registry, each declaring its channel |
| `packages/board-ui/src/lib/CreateTaskDialog.svelte` | **delete `DEFAULT_PLANNER_PROMPT`** — the default belongs server-side (finding 1) |
| `packages/board-ui` | a new inspector component of its own; never added to `App.svelte`'s 2026 lines; chrome strings in **both** `i18n/en.json` and `i18n/fr.json` |
| `packages/core` run record | the prompt version alongside model and reasoning effort |
| `packages/cli` | `backlog prompts list` / `show <id>` — the inspector without a browser |

## 9. Out of scope

- **A user-level override tier** (P7). Project-level first.
- **Per-ticket prompt overrides.** A ticket already has `description` and
  `acceptance_criteria`; a per-ticket prompt override would be a second, competing
  channel for the same intent.
- **The visual design pass** (§7). Principles here, pixels later.
- **Hook prompt defaults.** The hooks do not exist yet — they are specified in the
  memory and tools specs. The requirement this spec imposes on them: their text is
  a prompt and must be **born in the registry**, not hardcoded and migrated later.
  The `Stop` hook's stderr message literally instructs the agent.

## 10. Testing

Backend, `bun test ./packages`, temp dirs, sandboxed `HOME` via `homeDir()`.

- Assembly is deterministic: same blocks and context produce the same text and
  the same version.
- An override storing only a policy block still picks up a changed product
  default in the contract block — the P1 guarantee, asserted directly.
- A contract block cannot be overridden: the API rejects it rather than ignoring
  it silently.
- The tone block appears in every registered prompt, including one added in the
  test, so a new prompt cannot ship without inheriting tone.
- Channel is preserved: the chat prompt resolves as `system` for the API backend
  and `append-system-prompt` for claude-code, from one stored text.
- A run record carries a prompt version that resolves back to the exact text.
- No prompt text is present in `i18n/en.json` or `i18n/fr.json` (P9), asserted by
  a scan so it cannot drift back.
