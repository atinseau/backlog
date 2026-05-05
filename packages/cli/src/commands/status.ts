import fs from "node:fs";
import path from "node:path";
import { Command, Option } from "commander";
import { findProject, listRegisteredProjects, loadConfig } from "@backlog/config";
import { buildExecutionPlan, buildProjectStatus } from "@backlog/core";
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

// One-line summary of a project for the cross-project --all view.
// Read directly from disk (registry path → backlogDir → state files);
// avoids the cost of buildProjectStatus which is overkill here.
function summarizeProjectForAllView(entry: ReturnType<typeof listRegisteredProjects>[number]): {
  id: string;
  name: string;
  location: string;
  path: string;
  exists: boolean;
  workItems: number;
  activeClaims: number;
  activeRuns: number;
  reachable: boolean;
} {
  const backlogDir = entry.location === "in_repo" ? path.join(entry.path, ".backlog") : entry.path;
  const exists = fs.existsSync(path.join(backlogDir, "config.toml"));
  if (!exists) {
    return {
      id: entry.id,
      name: entry.name,
      location: entry.location,
      path: backlogDir,
      exists: false,
      workItems: 0,
      activeClaims: 0,
      activeRuns: 0,
      reachable: false,
    };
  }
  // Cheap counts: just length-of-array reads, not full plan builds.
  const config = loadConfig(backlogDir);
  void config;
  const tasksFile = path.join(backlogDir, "tasks.yaml");
  const claimsActive = path.join(backlogDir, "claims", "active");
  const runsActive = path.join(backlogDir, "runs", "active");
  // tasks.yaml entries are indented under `tasks:` so the array
  // markers line up at "  - id:" (two-space + dash). Counting those
  // gives an accurate top-level task count without a YAML parse.
  let workItems = 0;
  if (fs.existsSync(tasksFile)) {
    const text = fs.readFileSync(tasksFile, "utf8");
    workItems = (text.match(/^\s*- id:/gm) ?? []).length;
  }
  const activeClaims = fs.existsSync(claimsActive)
    ? fs.readdirSync(claimsActive).filter((f) => f.endsWith(".json")).length
    : 0;
  const activeRuns = fs.existsSync(runsActive)
    ? fs.readdirSync(runsActive).filter((f) => fs.existsSync(path.join(runsActive, f, "run.json"))).length
    : 0;
  return {
    id: entry.id,
    name: entry.name,
    location: entry.location,
    path: backlogDir,
    exists: true,
    workItems,
    activeClaims,
    activeRuns,
    reachable: true,
  };
}

function runAllStatus(options: { json?: boolean }): void {
  const entries = listRegisteredProjects();
  if (entries.length === 0) {
    console.log("No projects registered. Run `backlog init` or `backlog project add <path>`.");
    return;
  }
  const summaries = entries.map((entry) => summarizeProjectForAllView(entry));
  if (options.json) {
    console.log(JSON.stringify(summaries, null, 2));
    return;
  }
  console.log(`Registered projects: ${summaries.length}`);
  console.log("");
  for (const s of summaries) {
    if (!s.reachable) {
      console.log(`${s.id} | ${s.name} | [${s.location}] | (project not reachable at ${s.path})`);
      continue;
    }
    const activity = s.activeRuns > 0 || s.activeClaims > 0 ? ` ⚡ ${s.activeRuns} runs / ${s.activeClaims} claims` : "";
    console.log(`${s.id} | ${s.name} | [${s.location}] | ${s.workItems} tasks${activity}`);
  }
  const totalRuns = summaries.reduce((sum, s) => sum + s.activeRuns, 0);
  const totalClaims = summaries.reduce((sum, s) => sum + s.activeClaims, 0);
  if (totalRuns + totalClaims > 0) {
    console.log("");
    console.log(`Across all projects: ${totalRuns} active runs, ${totalClaims} active claims.`);
  }
}

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show a compact Backlog project summary")
    .option("--repository <id>", "Focus status on one configured repository")
    .addOption(new Option("--repo <id>", "Focus status on one configured repository").hideHelp())
    .option("--all", "Aggregate across every registered project (cross-project view)")
    .option("--json", "Emit machine-readable JSON")
    .option(
      "--remote [url]",
      `Stream live events from a running \`backlog serve\` at <url> (default: ${DEFAULT_REMOTE_URL})`,
    )
    .action(async (options: { repo?: string; all?: boolean; json?: boolean; remote?: string | boolean }) => {
      if (options.remote) {
        const url = typeof options.remote === "string" ? options.remote : DEFAULT_REMOTE_URL;
        await streamRemoteEvents(url);
        return;
      }
      if (options.all) {
        if (options.repo) {
          throw new Error("--all and --repository are mutually exclusive (different scopes).");
        }
        runAllStatus(options);
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
    throw new Error(`Unknown repository: ${options.repo}`);
  }
  const status = buildProjectStatus(workspace.root, workspace.backlogDir, config, {
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
    console.log(`Repository focus: ${status.selectedRepoId}`);
  }
  console.log(`Repositories: ${status.enabledRepoCount} enabled / ${status.repoCount} configured`);
  console.log(`Active claims: ${status.activeClaims}`);
  console.log(`Active runs: ${status.activeRuns}`);
  console.log(`Tasks: ${status.taskCount}`);
  console.log(`Pending sync conflicts: ${status.pendingSyncConflicts}`);
  if (status.repoSummaries.length > 0 && (status.repoCount > 1 || status.selectedRepoId)) {
    console.log("Repository detail:");
    for (const repo of status.repoSummaries) {
      console.log(`- ${repo.id}: enabled=${repo.enabled} tasks=${repo.taskCount} subtasks=${repo.subtaskCount} active_runs=${repo.activeRuns} active_claims=${repo.activeClaims}`);
    }
  }
  console.log("Task states:");
  for (const [workStatus, count] of Object.entries(status.taskStatusCounts)) {
    if (count > 0) {
      console.log(`- ${workStatus}: ${count}`);
    }
  }
  if (Object.keys(status.subtaskStatusCounts).length === 0) {
    console.log("Subtasks: none yet");
    return;
  }
  console.log("Subtasks:");
  for (const [taskStatus, count] of Object.entries(status.subtaskStatusCounts).sort()) {
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
      console.log(`- Start ${action.subtaskId}${agentText} (${action.reasons.join(", ")})`);
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
