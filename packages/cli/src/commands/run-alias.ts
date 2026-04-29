// `backlog run` — top-level shorthand for `backlog orchestrator start --auto`.
//
// The orchestrator namespace stays in place for the inspection /
// pause / stop / status / config sub-commands, but starting it is by
// far the most common action — and "run" reads better than
// "orchestrator start --auto" in shell history, demos, and CI scripts.
//
// Mirrors the same options as `orchestrator start` so muscle memory
// transfers either way.

import { Command } from "commander";
import { findProject } from "@backlog/config";
import { startOrchestrator } from "@backlog/core";

export function registerRunAlias(program: Command): void {
  program
    .command("run")
    .description("Start the orchestrator and dispatch ready sub-tasks (alias for `orchestrator start`).")
    .option("--max-agents <n>", "Cap on parallel runs")
    .option("--auto", "Let the orchestrator pick the agent count automatically", true)
    .option("--no-auto", "Disable auto-pick of agent count")
    .option("--tick-interval <ms>", "Tick interval in ms")
    .action(async (options: { maxAgents?: string; auto?: boolean; tickInterval?: string }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const input: Parameters<typeof startOrchestrator>[1] = {};
      if (options.maxAgents !== undefined) input.max_agents = parseInt(options.maxAgents, 10);
      if (options.auto !== undefined) input.auto_pick_agents = options.auto;
      if (options.tickInterval !== undefined) input.tick_interval_ms = parseInt(options.tickInterval, 10);
      const state = await startOrchestrator(workspace.backlogDir, input);
      console.log(`Orchestrator running (max=${state.max_agents}, auto=${state.auto_pick_agents}).`);
    });
}
