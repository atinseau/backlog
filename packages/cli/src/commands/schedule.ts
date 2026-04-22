import { Command } from "commander";
import { findWorkspace, loadConfig } from "@cockpit-ai/config";
import { createClaim, writeContextFile } from "@cockpit-ai/claims";
import {
  addRunArtifact,
  buildExecutionPlan,
  buildRunBranchName,
  executeCustomAgentRun,
  createRun,
  ensureWorktree,
  getAgent,
  getTask,
  getWorkItem,
  listActiveRuns,
  nextRunId,
  pickAgentForTask,
  rankAgentsForTask,
  updateRunStatus,
  updateTaskStatus,
  writeWorktreeContext,
} from "@cockpit-ai/core";
import { detectGitDir } from "@cockpit-ai/git";

export function registerScheduleCommand(program: Command): void {
  const schedule = program.command("schedule").description("Plan and execute task scheduling");

  schedule
    .command("simulate")
    .description("Explain what Cockpit would run right now")
    .option("--work-item <id>", "Restrict to one work item")
    .option("--task <id>", "Restrict to one task")
    .option("--json", "Emit machine-readable JSON")
    .action((options: { workItem?: string; task?: string; json?: boolean }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      const config = loadConfig(workspace.cockpitDir);
      const plan = buildExecutionPlan(workspace.cockpitDir, config, {
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
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      if (!options.workItem && !options.task) {
        throw new Error("schedule explain requires --task or --work-item.");
      }

      const config = loadConfig(workspace.cockpitDir);
      const plan = buildExecutionPlan(workspace.cockpitDir, config, {
        ...(options.workItem ? { workItemId: options.workItem } : {}),
        ...(options.task ? { taskId: options.task } : {}),
      });
      const decisions = [...plan.runnable, ...plan.waiting, ...plan.blocked, ...plan.skipped];
      const payload = decisions.map((decision) => {
        const task = getTask(workspace.cockpitDir, decision.taskId);
        const rankedAgents = task ? rankAgentsForTask(workspace.cockpitDir, task) : [];
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
    .action(async (options: { workItem?: string; task?: string; maxStart?: string; agent?: string; approve?: boolean }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      const config = loadConfig(workspace.cockpitDir);
      if (config.autonomy_mode === "observe") {
        throw new Error("schedule run is disabled in observe mode. Use schedule simulate instead.");
      }
      if (config.autonomy_mode === "assist" && !options.approve) {
        throw new Error("schedule run requires --approve in assist mode.");
      }

      const plan = buildExecutionPlan(workspace.cockpitDir, config, {
        ...(options.workItem ? { workItemId: options.workItem } : {}),
        ...(options.task ? { taskId: options.task } : {}),
      });
      const maxStart = Number.parseInt(options.maxStart ?? "1", 10);
      const started: string[] = [];

      for (const decision of plan.runnable.slice(0, maxStart)) {
        const task = getTask(workspace.cockpitDir, decision.taskId);
        if (!task) {
          continue;
        }
        const workItem = getWorkItem(workspace.cockpitDir, task.work_item_id);
        if (!workItem) {
          continue;
        }
        const repo = config.repos.find((candidate) => candidate.id === task.repo);
        if (!repo) {
          throw new Error(`Task ${task.id} targets unknown repo ${task.repo}`);
        }

        const activeAgentRuns = listActiveRuns(workspace.cockpitDir).filter((run) => run.status === "running" || run.status === "preparing");
        const agent = options.agent
          ? (() => {
              const forced = getAgent(workspace.cockpitDir, options.agent);
              if (!forced) {
                throw new Error(`Unknown agent: ${options.agent}`);
              }
              return forced;
            })()
            : decision.assignedAgentId
            ? (() => {
                const assigned = getAgent(workspace.cockpitDir, decision.assignedAgentId!);
                if (!assigned) {
                  throw new Error(`Unknown assigned agent: ${decision.assignedAgentId}`);
                }
                return assigned;
              })()
            : pickAgentForTask(workspace.cockpitDir, task);

        if (activeAgentRuns.filter((run) => run.agent_id === agent.id).length >= agent.max_concurrent_runs) {
          continue;
        }

        const claim = createClaim({
          cockpitDir: workspace.cockpitDir,
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
          cockpitDir: workspace.cockpitDir,
          repoId: repo.id,
          repoPath: repo.path,
          branch,
          runId,
        });
        const run = createRun({
          cockpitDir: workspace.cockpitDir,
          runId,
          task,
          workItem,
          agent,
          branch,
          worktreePath,
          claimIds: [claim.id],
        });
        await writeWorktreeContext(worktreePath, run.id, claim.id);
        addRunArtifact(workspace.cockpitDir, run.id, { kind: "branch", value: branch });
        updateRunStatus(workspace.cockpitDir, run.id, "running", "Execution workspace prepared");
        updateTaskStatus(workspace.cockpitDir, task.id, "running");
        started.push(`${run.id} -> ${task.id} (${agent.id})`);

        if (agent.provider === "custom" && agent.command) {
          await executeCustomAgentRun({
            cockpitDir: workspace.cockpitDir,
            run,
            task,
            workItem,
            agent,
          });
        }
      }

      if (started.length === 0) {
        console.log("No runs started.");
        return;
      }
      console.log("Started runs");
      for (const line of started) {
        console.log(`- ${line}`);
      }
    });
}
