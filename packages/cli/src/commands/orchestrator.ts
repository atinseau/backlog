import { Command } from "commander";
import { findProject } from "@backlog/config";
import {
  getOrchestratorState,
  pauseOrchestrator,
  setOrchestratorConfig,
  startOrchestrator,
  stopOrchestrator,
  updateOrchestratorState,
} from "@backlog/core";

function projectDir(): string {
  const workspace = findProject();
  if (!workspace) {
    throw new Error("No .backlog project found. Run `backlog init` first.");
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
      const state = await startOrchestrator(projectDir(), input);
      console.log(`Orchestrator running (max=${state.max_agents}, auto=${state.auto_pick_agents}).`);
    });

  orchestrator
    .command("pause")
    .description("Stop dispatching new runs (active runs continue)")
    .action(() => {
      const state = pauseOrchestrator(projectDir());
      console.log(`Orchestrator paused at ${state.paused_at}.`);
    });

  orchestrator
    .command("stop")
    .description("Stop and wait for active runs to finish, then return to idle")
    .action(async () => {
      const state = await stopOrchestrator(projectDir());
      console.log(`Orchestrator ${state.mode}.`);
    });

  orchestrator
    .command("status")
    .description("Show the orchestrator state")
    .action(() => {
      const state = getOrchestratorState(projectDir());
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
      const state = setOrchestratorConfig(projectDir(), input);
      console.log(`Updated. max=${state.max_agents}, auto=${state.auto_pick_agents}, tick=${state.tick_interval_ms}ms.`);
    });

  orchestrator
    .command("clear-error")
    .description("Clear last_error from the orchestrator state (a sticky error after a transient failure)")
    .action(() => {
      const dir = projectDir();
      const before = getOrchestratorState(dir);
      if (before.last_error === undefined || before.last_error === null) {
        console.log("Nothing to clear — last_error is already empty.");
        return;
      }
      const after = updateOrchestratorState(dir, { last_error: null });
      console.log(`Cleared last_error: "${before.last_error}"`);
      console.log(`State: mode=${after.mode}, last_tick_at=${after.last_tick_at ?? "(none)"}`);
    });
}
