import { Command } from "commander";
import { findProject, loadConfig } from "@backlog/config";
import { buildExecutionPlan, buildWorkspaceStatus } from "@backlog/core";
import { listSubTasks } from "@backlog/core";

const DEFAULT_REMOTE_URL = "http://127.0.0.1:7878";

// Subscribe to a backlog serve's /api/v1/events SSE stream and print
// each board event as it arrives. Used by `backlog status --remote`.
async function streamRemoteEvents(baseUrl: string): Promise<void> {
  const url = new URL("/api/v1/events", baseUrl).toString();
  const response = await fetch(url, { headers: { accept: "text/event-stream" } });
  if (!response.ok || !response.body) {
    throw new Error(`SSE connect failed: ${response.status} ${response.statusText} (${url})`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  console.log(`Streaming ${url} (Ctrl+C to stop)…`);
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // Parse SSE frames separated by blank lines.
    let blank: number;
    while ((blank = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, blank);
      buffer = buffer.slice(blank + 2);
      let event = "message";
      let data = "";
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      // Drop the heartbeat frames from the visible stream — they're
      // useful to keep the connection open but noisy in the terminal.
      if (event === "ping") continue;
      const ts = new Date().toISOString().slice(11, 19);
      console.log(`[${ts}] ${event} ${data}`);
    }
  }
}

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show a compact Backlog workspace summary")
    .option("--repo <id>", "Focus status on one configured repo")
    .option("--json", "Emit machine-readable JSON")
    .option(
      "--remote [url]",
      `Stream live events from a running \`backlog serve\` at <url> (default: ${DEFAULT_REMOTE_URL})`,
    )
    .action(async (options: { repo?: string; json?: boolean; remote?: string | boolean }) => {
      if (options.remote) {
        const url = typeof options.remote === "string" ? options.remote : DEFAULT_REMOTE_URL;
        await streamRemoteEvents(url);
        return;
      }
      runLocalStatus(options);
    });
}

function runLocalStatus(options: { repo?: string; json?: boolean }): void {
  const workspace = findProject();
  if (!workspace) {
    throw new Error("No .backlog project found. Run `backlog init` first.");
  }

  const config = loadConfig(workspace.backlogDir);
  if (options.repo && !config.repos.some((repo) => repo.id === options.repo)) {
    throw new Error(`Unknown repo: ${options.repo}`);
  }
  const status = buildWorkspaceStatus(workspace.root, workspace.backlogDir, config, {
    ...(options.repo ? { repoId: options.repo } : {}),
  });
  const tasksById = new Map(listSubTasks(workspace.backlogDir).map((task) => [task.id, task]));
  const fullPlan = buildExecutionPlan(workspace.backlogDir, config);
  const plan = options.repo
    ? {
        ...fullPlan,
        runnable: fullPlan.runnable.filter((decision) => tasksById.get(decision.taskId)?.repo === options.repo),
        waiting: fullPlan.waiting.filter((decision) => tasksById.get(decision.taskId)?.repo === options.repo),
        blocked: fullPlan.blocked.filter((decision) => tasksById.get(decision.taskId)?.repo === options.repo),
        skipped: fullPlan.skipped.filter((decision) => tasksById.get(decision.taskId)?.repo === options.repo),
      }
    : fullPlan;

  if (options.json) {
    console.log(JSON.stringify({ ...status, plan }, null, 2));
    return;
  }

  console.log(`Project: ${status.projectName}`);
  if (status.selectedRepoId) {
    console.log(`Repo focus: ${status.selectedRepoId}`);
  }
  console.log(`Repos: ${status.enabledRepoCount} enabled / ${status.repoCount} configured`);
  console.log(`Active claims: ${status.activeClaims}`);
  console.log(`Active runs: ${status.activeRuns}`);
  console.log(`Work items: ${status.workItemCount}`);
  console.log(`Pending sync conflicts: ${status.pendingSyncConflicts}`);
  if (status.repoSummaries.length > 0 && (status.repoCount > 1 || status.selectedRepoId)) {
    console.log("Repo detail:");
    for (const repo of status.repoSummaries) {
      console.log(`- ${repo.id}: enabled=${repo.enabled} work_items=${repo.workItemCount} tasks=${repo.taskCount} active_runs=${repo.activeRuns} active_claims=${repo.activeClaims}`);
    }
  }
  console.log("Work item states:");
  for (const [workStatus, count] of Object.entries(status.workItemCounts)) {
    if (count > 0) {
      console.log(`- ${workStatus}: ${count}`);
    }
  }
  if (Object.keys(status.taskCounts).length === 0) {
    console.log("Tasks: none yet");
    return;
  }
  console.log("Tasks:");
  for (const [taskStatus, count] of Object.entries(status.taskCounts).sort()) {
    console.log(`- ${taskStatus}: ${count}`);
  }
  console.log("");
  console.log(`Runnable now: ${plan.runnable.length}`);
  console.log(`Waiting now: ${plan.waiting.length}`);
  console.log(`Blocked now: ${plan.blocked.length}`);
  if (status.nextActions.length > 0) {
    console.log("");
    console.log("Top next actions:");
    for (const action of status.nextActions) {
      const agentText = action.assignedAgentId ? ` with ${action.assignedAgentId}` : "";
      console.log(`- Start ${action.taskId}${agentText} (${action.reasons.join(", ")})`);
    }
  }
  if (status.hotConflicts.length > 0) {
    console.log("");
    console.log("Hot conflicts:");
    for (const conflict of status.hotConflicts) {
      console.log(`- ${conflict}`);
    }
  }
}
