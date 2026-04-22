import { Command } from "commander";
import { findWorkspace } from "@cockpit-ai/config";
import { healthForAgents, listAgents, validateAgents } from "@cockpit-ai/core";

export function registerAgentCommand(program: Command): void {
  const agents = program.command("agents").description("Inspect configured agents");

  agents
    .command("list")
    .description("List known agents")
    .option("--json", "Emit machine-readable JSON")
    .action((options: { json?: boolean }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      const agents = listAgents(workspace.cockpitDir);
      if (options.json) {
        console.log(JSON.stringify(agents, null, 2));
        return;
      }
      for (const agent of agents) {
        console.log(`${agent.id} | ${agent.provider} | enabled=${agent.enabled} | max=${agent.max_concurrent_runs}`);
      }
    });

  agents
    .command("validate")
    .description("Validate configured agents")
    .action(() => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      for (const result of validateAgents(workspace.cockpitDir)) {
        console.log(`${result.id}: ${result.ok ? "ok" : "invalid"}${result.reasons.length > 0 ? ` (${result.reasons.join(", ")})` : ""}`);
      }
    });

  agents
    .command("health")
    .description("Show runtime health for configured agents")
    .option("--json", "Emit machine-readable JSON")
    .action((options: { json?: boolean }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      const health = healthForAgents(workspace.cockpitDir);
      if (options.json) {
        console.log(JSON.stringify(health, null, 2));
        return;
      }
      for (const item of health) {
        console.log(`${item.id} | healthy=${item.healthy} | active=${item.activeRuns}/${item.maxConcurrentRuns}${item.reasons.length > 0 ? ` | ${item.reasons.join(", ")}` : ""}`);
      }
    });
}
