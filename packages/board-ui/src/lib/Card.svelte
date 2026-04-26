<script lang="ts">
  import type { WorkItemCard } from "./types.js";

  interface Props {
    card: WorkItemCard;
  }

  let { card }: Props = $props();

  const priorityClass = $derived(`pri pri-${card.priority.toLowerCase()}`);
  const blockedCount = $derived(card.blocked_by_claims.length);
  const runningCount = $derived(card.tasks.filter((t) => t.active_run !== null).length);
</script>

<article class="card">
  <header>
    <span class={priorityClass}>{card.priority}</span>
    <h3>{card.title}</h3>
  </header>

  {#if card.repo_targets.length > 0}
    <div class="chips">
      {#each card.repo_targets as repo (repo)}
        <span class="chip repo">{repo}</span>
      {/each}
    </div>
  {/if}

  {#if card.tasks.length > 0}
    <ul class="tasks">
      {#each card.tasks as task (task.id)}
        <li class:running={task.active_run !== null} class:claimed={task.active_claim !== null}>
          <span class="task-title">{task.title}</span>
          <span class="task-meta">
            {task.repo}
            {#if task.active_run}
              · run {task.active_run.status} ({task.active_run.agent_id})
            {/if}
            {#if task.active_claim}
              · 🔒 {task.active_claim.topic}
            {/if}
          </span>
        </li>
      {/each}
    </ul>
  {/if}

  {#if blockedCount > 0 || runningCount > 0}
    <footer>
      {#if runningCount > 0}<span class="badge running">▶ {runningCount}</span>{/if}
      {#if blockedCount > 0}<span class="badge blocked">⚠ {blockedCount} blocked</span>{/if}
    </footer>
  {/if}
</article>

<style>
  .card {
    background: white;
    border-radius: 6px;
    padding: 10px 12px;
    margin-bottom: 8px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
    border-left: 3px solid #ccc;
    cursor: grab;
  }
  header {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-bottom: 6px;
  }
  h3 {
    margin: 0;
    font-size: 14px;
    line-height: 1.3;
    flex: 1;
  }
  .pri {
    font-size: 11px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 3px;
    color: white;
    flex-shrink: 0;
  }
  .pri-p0 { background: #d92d20; }
  .pri-p1 { background: #f79009; }
  .pri-p2 { background: #2e90fa; }
  .pri-p3 { background: #98a2b3; }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 6px;
  }
  .chip {
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 3px;
    background: #f2f4f7;
    color: #344054;
  }

  .tasks {
    list-style: none;
    padding: 0;
    margin: 6px 0 0;
    font-size: 12px;
  }
  .tasks li {
    padding: 4px 0;
    border-top: 1px solid #f0f0f0;
  }
  .tasks li.running { background: #ecfdf3; }
  .tasks li.claimed .task-title { color: #1d2939; font-weight: 500; }
  .task-meta {
    color: #667085;
    font-size: 11px;
    display: block;
  }

  footer {
    display: flex;
    gap: 6px;
    margin-top: 8px;
  }
  .badge {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 3px;
  }
  .badge.running { background: #d1fadf; color: #027a48; }
  .badge.blocked { background: #fef0c7; color: #b54708; }
</style>
