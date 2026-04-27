import { Command } from "commander";
import { findWorkspace } from "@backlog/config";
import {
  getOrchestratorState,
  pauseOrchestrator,
  setOrchestratorConfig,
  startOrchestrator,
  stopOrchestrator,
} from "@backlog/core";

function workspaceDir(): string {
  const workspace = findWorkspace();
  if (!workspace) {
    throw new Error("No .backlog workspace found. Run `backlog init` first.");
  }
  return workspace.backlogDir;
}

export function registerOrchestratorCommand(program: Command): void {
  const orchestrator = program
    .command("orchestrator")
    .description("Control the persistent run dispatcher");

  orchestrator
    .command("start")
    .description("Start dispatching runs based on the current execution plan")
    .option("--max-agents <n>", "Cap on parallel runs")
    .option("--auto", "Let the orchestrator pick the agent count automatically")
    .option("--no-auto", "Disable auto-pick of agent count")
    .option("--tick-interval <ms>", "Tick interval in ms")
    .action(async (options: { maxAgents?: string; auto?: boolean; tickInterval?: string }) => {
      const input: Parameters<typeof startOrchestrator>[1] = {};
      if (options.maxAgents !== undefined) input.max_agents = parseInt(options.maxAgents, 10);
      if (options.auto !== undefined) input.auto_pick_agents = options.auto;
      if (options.tickInterval !== undefined) input.tick_interval_ms = parseInt(options.tickInterval, 10);
      const state = await startOrchestrator(workspaceDir(), input);
      console.log(`Orchestrator running (max=${state.max_agents}, auto=${state.auto_pick_agents}).`);
    });

  orchestrator
    .command("pause")
    .description("Stop dispatching new runs (active runs continue)")
    .action(() => {
      const state = pauseOrchestrator(workspaceDir());
      console.log(`Orchestrator paused at ${state.paused_at}.`);
    });

  orchestrator
    .command("stop")
    .description("Stop and wait for active runs to finish, then return to idle")
    .action(async () => {
      const state = await stopOrchestrator(workspaceDir());
      console.log(`Orchestrator ${state.mode}.`);
    });

  orchestrator
    .command("status")
    .description("Show the orchestrator state")
    .action(() => {
      const state = getOrchestratorState(workspaceDir());
      console.log(JSON.stringify(state, null, 2));
    });

  orchestrator
    .command("config")
    .description("Update max_agents / auto / tick_interval without changing mode")
    .option("--max-agents <n>", "Cap on parallel runs")
    .option("--auto", "Enable auto-pick")
    .option("--no-auto", "Disable auto-pick")
    .option("--tick-interval <ms>", "Tick interval in ms")
    .action((options: { maxAgents?: string; auto?: boolean; tickInterval?: string }) => {
      const input: Parameters<typeof setOrchestratorConfig>[1] = {};
      if (options.maxAgents !== undefined) input.max_agents = parseInt(options.maxAgents, 10);
      if (options.auto !== undefined) input.auto_pick_agents = options.auto;
      if (options.tickInterval !== undefined) input.tick_interval_ms = parseInt(options.tickInterval, 10);
      const state = setOrchestratorConfig(workspaceDir(), input);
      console.log(`Updated. max=${state.max_agents}, auto=${state.auto_pick_agents}, tick=${state.tick_interval_ms}ms.`);
    });
}
