import { Command } from "commander";
import { findWorkspace } from "@cockpit-ai/config";
import { listAgents } from "@cockpit-ai/core";

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
}
