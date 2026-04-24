import { Command } from "commander";
import { findWorkspace, loadConfig } from "@backlog/config";
import { createClaim, writeContextFile } from "@backlog/claims";
import {
  addRunArtifact,
  buildExecutionPlan,
  buildRunBranchName,
  executeAgentRun,
  createRun,
  ensureWorktree,
  getAgent,
  getTask,
  getWorkItem,
  listActiveRuns,
  nextRunId,
  pickAgentForTask,
  rankAgentsForTask,
  selectionForAgentTask,
  supportsAgentExecution,
  updateRunStatus,
  updateTaskStatus,
  writeWorktreeContext,
} from "@backlog/core";
import { detectGitDir } from "@backlog/git";

function parseMaxStart(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`Invalid --max-start value: ${value ?? "undefined"}. Expected a positive integer.`);
  }
  return parsed;
}

export function registerScheduleCommand(program: Command): void {
  const schedule = program.command("schedule").description("Plan and execute task scheduling");

  schedule
    .command("simulate")
    .description("Explain what Backlog would run right now")
    .option("--work-item <id>", "Restrict to one work item")
    .option("--task <id>", "Restrict to one task")
    .option("--json", "Emit machine-readable JSON")
    .action((options: { workItem?: string; task?: string; json?: boolean }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .backlog workspace found. Run `backlog init` first.");
      }
      const config = loadConfig(workspace.backlogDir);
      const plan = buildExecutionPlan(workspace.backlogDir, config, {
        ...(options.workItem ? { workItemId: options.workItem } : {}),
        ...(options.task ? { taskId: options.task } : {}),
      });

      if (options.json) {
        console.log(JSON.stringify(plan, null, 2));
        return;
      }

      console.log("Simulation");
      console.log("");
      console.log(`Runnable: ${plan.runnable.length}`);
      for (const decision of plan.runnable) {
        console.log(`- ${decision.taskId} score=${decision.score} ${decision.reasons.join(", ")}`);
      }
      console.log("");
      console.log(`Waiting: ${plan.waiting.length}`);
      for (const decision of plan.waiting) {
        console.log(`- ${decision.taskId} ${decision.reasons.join(", ")}`);
      }
      console.log("");
      console.log(`Blocked: ${plan.blocked.length}`);
      for (const decision of plan.blocked) {
        console.log(`- ${decision.taskId} ${decision.reasons.join(", ")}`);
      }
    });

  schedule
    .command("explain")
    .description("Explain scheduling decisions and ranked agent candidates")
    .option("--work-item <id>", "Restrict to one work item")
    .option("--task <id>", "Restrict to one task")
    .option("--json", "Emit machine-readable JSON")
    .action((options: { workItem?: string; task?: string; json?: boolean }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .backlog workspace found. Run `backlog init` first.");
      }
      if (!options.workItem && !options.task) {
        throw new Error("schedule explain requires --task or --work-item.");
      }

      const config = loadConfig(workspace.backlogDir);
      const plan = buildExecutionPlan(workspace.backlogDir, config, {
        ...(options.workItem ? { workItemId: options.workItem } : {}),
        ...(options.task ? { taskId: options.task } : {}),
      });
      const decisions = [...plan.runnable, ...plan.waiting, ...plan.blocked, ...plan.skipped];
      const payload = decisions.map((decision) => {
        const task = getTask(workspace.backlogDir, decision.taskId);
        const rankedAgents = task ? rankAgentsForTask(workspace.backlogDir, task) : [];
        return {
          ...decision,
          task,
          rankedAgents: rankedAgents.map((candidate) => ({
            id: candidate.agent.id,
            provider: candidate.agent.provider,
            available: candidate.available,
            score: candidate.score,
            reasons: candidate.reasons,
            activeRuns: candidate.activeRuns,
            maxConcurrentRuns: candidate.agent.max_concurrent_runs,
          })),
        };
      });

      if (options.json) {
        console.log(JSON.stringify(payload, null, 2));
        return;
      }

      for (const decision of payload) {
        console.log(`Task: ${decision.taskId}`);
        console.log(`Action: ${decision.action}`);
        console.log(`Score: ${decision.score}`);
        if (decision.assignedAgentId) {
          console.log(`Assigned agent: ${decision.assignedAgentId}`);
        }
        console.log(`Reasons: ${decision.reasons.join(", ")}`);
        if (decision.rankedAgents.length > 0) {
          console.log("Agent ranking:");
          for (const candidate of decision.rankedAgents) {
            console.log(`- ${candidate.id} | available=${candidate.available} | score=${candidate.score} | ${candidate.reasons.join(", ")}`);
          }
        }
        console.log("");
      }
    });

  schedule
    .command("run")
    .description("Create runnable execution runs in isolated worktrees")
    .option("--work-item <id>", "Restrict to one work item")
    .option("--task <id>", "Restrict to one task")
    .option("--max-start <count>", "Limit the number of runs to start", "1")
    .option("--agent <agent-id>", "Force one agent id")
    .option("--approve", "Required in assist mode")
    .option("--json", "Emit machine-readable JSON")
    .action(async (options: { workItem?: string; task?: string; maxStart?: string; agent?: string; approve?: boolean; json?: boolean }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .backlog workspace found. Run `backlog init` first.");
      }
      const config = loadConfig(workspace.backlogDir);
      if (config.autonomy_mode === "observe") {
        throw new Error("schedule run is disabled in observe mode. Use schedule simulate instead.");
      }
      if (config.autonomy_mode === "assist" && !options.approve) {
        throw new Error("schedule run requires --approve in assist mode.");
      }

      const plan = buildExecutionPlan(workspace.backlogDir, config, {
        ...(options.workItem ? { workItemId: options.workItem } : {}),
        ...(options.task ? { taskId: options.task } : {}),
      });
      const maxStart = parseMaxStart(options.maxStart);
      const started: Array<{ runId: string; taskId: string; agentId: string; branch: string }> = [];
      const skipped: Array<{ taskId: string; reasons: string[] }> = [];

      for (const decision of plan.runnable.slice(0, maxStart)) {
        const task = getTask(workspace.backlogDir, decision.taskId);
        if (!task) {
          skipped.push({ taskId: decision.taskId, reasons: ["missing_task"] });
          continue;
        }
        const workItem = getWorkItem(workspace.backlogDir, task.work_item_id);
        if (!workItem) {
          skipped.push({ taskId: decision.taskId, reasons: ["missing_work_item"] });
          continue;
        }
        const repo = config.repos.find((candidate) => candidate.id === task.repo);
        if (!repo) {
          skipped.push({ taskId: task.id, reasons: [`unknown_repo:${task.repo}`] });
          continue;
        }

        const activeAgentRuns = listActiveRuns(workspace.backlogDir).filter((run) => run.status === "running" || run.status === "preparing");
        const agent = options.agent
          ? (() => {
              const forcedSelection = selectionForAgentTask(workspace.backlogDir, task, options.agent);
              if (!forcedSelection) {
                throw new Error(`Unknown agent: ${options.agent}`);
              }
              if (!forcedSelection.available) {
                skipped.push({ taskId: task.id, reasons: forcedSelection.reasons });
                return null;
              }
              return forcedSelection.agent;
            })()
            : decision.assignedAgentId
            ? (() => {
                const assigned = getAgent(workspace.backlogDir, decision.assignedAgentId!);
                if (!assigned) {
                  skipped.push({ taskId: task.id, reasons: [`unknown_assigned_agent:${decision.assignedAgentId}`] });
                  return null;
                }
                return assigned;
              })()
            : pickAgentForTask(workspace.backlogDir, task);

        if (!agent) {
          continue;
        }

        if (activeAgentRuns.filter((run) => run.agent_id === agent.id).length >= agent.max_concurrent_runs) {
          skipped.push({ taskId: task.id, reasons: ["no_agent_capacity"] });
          continue;
        }
        if (!supportsAgentExecution(agent)) {
          skipped.push({ taskId: task.id, reasons: [`unsupported_provider:${agent.provider}`] });
          continue;
        }

        const claim = createClaim({
          backlogDir: workspace.backlogDir,
          repo: repo.id,
          repoPath: repo.path,
          topic: `run ${task.id}`,
          paths: task.scopes.length > 0 ? task.scopes : ["**"],
          mode: task.claim_mode,
          ttlMinutes: config.claims.ttl_minutes,
        });
        const gitDir = await detectGitDir(repo.path);
        writeContextFile(gitDir, {
          version: 1,
          claim_id: claim.id,
          updated_at: new Date().toISOString(),
        });

        const branch = buildRunBranchName(task.id, task.title);
        const runId = nextRunId();
        const worktreePath = await ensureWorktree({
          backlogDir: workspace.backlogDir,
          repoId: repo.id,
          repoPath: repo.path,
          branch,
          runId,
        });
        const run = createRun({
          backlogDir: workspace.backlogDir,
          runId,
          task,
          workItem,
          agent,
          branch,
          worktreePath,
          claimIds: [claim.id],
        });
        await writeWorktreeContext(worktreePath, run.id, claim.id);
        addRunArtifact(workspace.backlogDir, run.id, { kind: "branch", value: branch });
        updateRunStatus(workspace.backlogDir, run.id, "running", "Execution workspace prepared");
        updateTaskStatus(workspace.backlogDir, task.id, "running");
        started.push({
          runId: run.id,
          taskId: task.id,
          agentId: agent.id,
          branch,
        });

        if (await executeAgentRun({
          backlogDir: workspace.backlogDir,
          run,
          task,
          workItem,
          agent,
        })) {
          continue;
        }

        skipped.push({ taskId: task.id, reasons: [`unsupported_provider:${agent.provider}`] });
        updateRunStatus(workspace.backlogDir, run.id, "blocked", `Unsupported provider ${agent.provider}`);
        updateTaskStatus(workspace.backlogDir, task.id, "blocked");
      }

      const payload = {
        started,
        skipped,
        waiting: plan.waiting.map((decision) => ({ taskId: decision.taskId, reasons: decision.reasons })),
        blocked: plan.blocked.map((decision) => ({ taskId: decision.taskId, reasons: decision.reasons })),
      };

      if (options.json) {
        console.log(JSON.stringify(payload, null, 2));
        return;
      }

      if (started.length === 0) {
        console.log("No runs started.");
        if (skipped.length > 0) {
          console.log("Skipped:");
          for (const item of skipped) {
            console.log(`- ${item.taskId} ${item.reasons.join(", ")}`);
          }
        }
        if (plan.waiting.length > 0) {
          console.log("Waiting:");
          for (const item of plan.waiting) {
            console.log(`- ${item.taskId} ${item.reasons.join(", ")}`);
          }
        }
        if (plan.blocked.length > 0) {
          console.log("Blocked:");
          for (const item of plan.blocked) {
            console.log(`- ${item.taskId} ${item.reasons.join(", ")}`);
          }
        }
        return;
      }
      console.log("Started runs");
      for (const item of started) {
        console.log(`- ${item.runId} -> ${item.taskId} (${item.agentId})`);
      }
      if (skipped.length > 0) {
        console.log("Skipped:");
        for (const item of skipped) {
          console.log(`- ${item.taskId} ${item.reasons.join(", ")}`);
        }
      }
    });
}
