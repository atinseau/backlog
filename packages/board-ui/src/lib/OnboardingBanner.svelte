<script lang="ts">
  import { t } from "./i18n.svelte.js";
  import type { BoardResponse, ProjectEntry, Repository } from "./types.js";

  interface Props {
    projects: ProjectEntry[];
    projectRepos: Repository[];
    board: BoardResponse | null;
    dismissed: boolean;
    onCreateProject: () => void;
    onManageRepos: () => void;
    onCreateTask: () => void;
    onDismiss: () => void;
  }

  let {
    projects,
    projectRepos,
    board,
    dismissed,
    onCreateProject,
    onManageRepos,
    onCreateTask,
    onDismiss,
  }: Props = $props();

  type Step = "project" | "repos" | "task" | "split" | null;

  const totalTasks = $derived.by(() => {
    if (!board) return 0;
    return Object.values(board.columns).reduce((sum, col) => sum + col.length, 0);
  });

  // We can only know "first task has no sub-tasks yet" by sampling the
  // first card. The board response embeds tasks (sub-tasks) per card.
  const firstCardHasNoSubTasks = $derived.by(() => {
    if (!board) return false;
    for (const col of Object.values(board.columns)) {
      if (col.length > 0) return col[0]!.tasks.length === 0;
    }
    return false;
  });

  const step = $derived<Step>(
    dismissed
      ? null
      : projects.length === 0
        ? "project"
        : projectRepos.length === 0
          ? "repos"
          : totalTasks === 0
            ? "task"
            : firstCardHasNoSubTasks
              ? "split"
              : null,
  );

  function stepNumber(s: Step): number {
    return s === "project" ? 1 : s === "repos" ? 2 : s === "task" ? 3 : s === "split" ? 4 : 0;
  }
</script>

{#if step !== null}
  <div class="onboarding" class:step-1={step === "project"} class:step-final={step === "split"}>
    <div class="step-pill">{stepNumber(step)}/4</div>
    <div class="content">
      <h3>{t(`onboarding.${step}.title`)}</h3>
      <p>{t(`onboarding.${step}.body`)}</p>
    </div>
    <div class="actions">
      {#if step === "project"}
        <button class="primary" onclick={onCreateProject}>{t("onboarding.project.cta")}</button>
      {:else if step === "repos"}
        <button class="primary" onclick={onManageRepos}>{t("onboarding.repos.cta")}</button>
      {:else if step === "task"}
        <button class="primary" onclick={onCreateTask}>{t("onboarding.task.cta")}</button>
      {:else if step === "split"}
        <span class="muted">{t("onboarding.split.cta_hint")}</span>
      {/if}
      <button class="link" onclick={onDismiss} aria-label={t("onboarding.skip")} title={t("onboarding.skip")}>✕</button>
    </div>
  </div>
{/if}

<style>
  .onboarding {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 12px 20px;
    margin: 8px 16px 0;
    background: linear-gradient(90deg, var(--accent-bg), #f4ebff);
    border: 1px solid var(--accent);
    border-radius: 8px;
    box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04);
  }
  .onboarding.step-1 {
    background: linear-gradient(90deg, var(--warning-bg), #fef9f3);
    border-color: var(--warning);
  }
  .onboarding.step-final {
    background: linear-gradient(90deg, var(--success-bg), #ecfdf3);
    border-color: var(--success);
  }
  .step-pill {
    background: var(--bg-surface);
    border: 1px solid var(--border-strong);
    border-radius: 16px;
    padding: 2px 10px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-secondary);
    flex-shrink: 0;
  }
  .content { flex: 1; min-width: 0; }
  h3 { margin: 0 0 2px; font-size: 14px; color: var(--text-primary); }
  p { margin: 0; font-size: 12px; color: var(--text-secondary); line-height: 1.4; }
  .actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  button {
    background: var(--bg-hover);
    border: 1px solid var(--border-strong);
    color: var(--text-body);
    border-radius: 4px;
    padding: 4px 12px;
    cursor: pointer;
    font-size: 13px;
  }
  button.primary {
    background: var(--accent);
    color: var(--accent-on);
    border-color: var(--accent);
    font-weight: 500;
  }
  button.primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
  button.link {
    background: transparent;
    border: none;
    color: var(--text-subtle);
    font-size: 14px;
    cursor: pointer;
    padding: 4px 8px;
  }
  button.link:hover { color: var(--text-secondary); }
  .muted { color: var(--text-secondary); font-size: 12px; font-style: italic; }

  /* In dark mode swap the pastel gradients for flat near-black
     surfaces with a subtle tinted left border so the banner reads
     as an inline chip rather than a sticky note. */
  :global([data-theme="dark"]) .onboarding {
    background: var(--bg-elevated);
    border-color: var(--border-strong);
  }
  :global([data-theme="dark"]) .onboarding.step-1 {
    background: var(--bg-elevated);
    border-color: var(--warning);
  }
  :global([data-theme="dark"]) .onboarding.step-final {
    background: var(--bg-elevated);
    border-color: var(--success);
  }
</style>
