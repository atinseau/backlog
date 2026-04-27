import { Command } from "commander";
import { findProject } from "@backlog/config";
import { getAgent, healthForAgents, listAgents, setAgentEnabled, updateAgent, validateAgents } from "@backlog/core";

function collectValues(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseKeyValuePairs(pairs: string[]): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const pair of pairs) {
    const separator = pair.indexOf("=");
    if (separator <= 0 || separator === pair.length - 1) {
      throw new Error(`Invalid environment entry: ${pair}. Expected KEY=value.`);
    }
    environment[pair.slice(0, separator)] = pair.slice(separator + 1);
  }
  return environment;
}

export function registerAgentCommand(program: Command): void {
  const agents = program.command("agents").description("Inspect configured agents");

  agents
    .command("list")
    .description("List known agents")
    .option("--json", "Emit machine-readable JSON")
    .action((options: { json?: boolean }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const agents = listAgents(workspace.backlogDir);
      if (options.json) {
        console.log(JSON.stringify(agents, null, 2));
        return;
      }
      for (const agent of agents) {
        console.log(`${agent.id} | ${agent.provider} | enabled=${agent.enabled} | max=${agent.max_concurrent_runs}`);
      }
    });

  agents
    .command("show")
    .description("Show one configured agent")
    .argument("<agent-id>", "Agent id")
    .option("--json", "Emit machine-readable JSON")
    .action((agentId: string, options: { json?: boolean }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const agent = getAgent(workspace.backlogDir, agentId);
      if (!agent) {
        throw new Error(`Unknown agent: ${agentId}`);
      }
      if (options.json) {
        console.log(JSON.stringify(agent, null, 2));
        return;
      }
      console.log(`Agent: ${agent.id}`);
      console.log(`Provider: ${agent.provider}`);
      console.log(`Enabled: ${agent.enabled}`);
      console.log(`Max concurrent runs: ${agent.max_concurrent_runs}`);
      console.log(`Allowed repos: ${agent.allowed_repos.length > 0 ? agent.allowed_repos.join(", ") : "all"}`);
      console.log(`Allowed risk: ${agent.allowed_risk.join(", ")}`);
      console.log(`Capabilities: ${agent.capabilities.join(", ")}`);
      if (agent.command) {
        console.log(`Command: ${agent.command}`);
      }
    });

  agents
    .command("enable")
    .description("Enable one configured agent")
    .argument("<agent-id>", "Agent id")
    .action((agentId: string) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const agent = setAgentEnabled(workspace.backlogDir, agentId, true);
      console.log(`Enabled ${agent.id}`);
    });

  agents
    .command("disable")
    .description("Disable one configured agent")
    .argument("<agent-id>", "Agent id")
    .action((agentId: string) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const agent = setAgentEnabled(workspace.backlogDir, agentId, false);
      console.log(`Disabled ${agent.id}`);
    });

  agents
    .command("update")
    .description("Update one configured agent without editing YAML by hand")
    .argument("<agent-id>", "Agent id")
    .option("--model <model>", "Agent model")
    .option("--clear-model", "Remove the model override")
    .option("--profile <profile>", "Agent profile")
    .option("--clear-profile", "Remove the profile override")
    .option("--command <command>", "Executable override")
    .option("--clear-command", "Remove the executable override")
    .option("--sandbox-mode <mode>", "read-only, workspace-write, or danger-full-access")
    .option("--clear-sandbox-mode", "Remove the sandbox mode override")
    .option("--success-mode <mode>", "review or complete")
    .option("--clear-success-mode", "Remove the success mode override")
    .option("--max-concurrent-runs <count>", "Concurrency limit")
    .option("--allow-repo <repo>", "Replace allowed repos", collectValues, [])
    .option("--allow-risk <risk>", "Replace allowed risk levels", collectValues, [])
    .option("--capability <capability>", "Replace capabilities", collectValues, [])
    .option("--env <key=value>", "Replace environment entries", collectValues, [])
    .action((agentId: string, options: {
      model?: string;
      clearModel?: boolean;
      profile?: string;
      clearProfile?: boolean;
      command?: string;
      clearCommand?: boolean;
      sandboxMode?: "read-only" | "workspace-write" | "danger-full-access";
      clearSandboxMode?: boolean;
      successMode?: "review" | "complete";
      clearSuccessMode?: boolean;
      maxConcurrentRuns?: string;
      allowRepo: string[];
      allowRisk: Array<"low" | "medium" | "high">;
      capability: string[];
      env: string[];
    }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const agent = updateAgent(workspace.backlogDir, agentId, {
        ...(options.model !== undefined ? { model: options.model } : {}),
        ...(options.clearModel ? { clearModel: true } : {}),
        ...(options.profile !== undefined ? { profile: options.profile } : {}),
        ...(options.clearProfile ? { clearProfile: true } : {}),
        ...(options.command !== undefined ? { command: options.command } : {}),
        ...(options.clearCommand ? { clearCommand: true } : {}),
        ...(options.sandboxMode !== undefined ? { sandboxMode: options.sandboxMode } : {}),
        ...(options.clearSandboxMode ? { clearSandboxMode: true } : {}),
        ...(options.successMode !== undefined ? { successMode: options.successMode } : {}),
        ...(options.clearSuccessMode ? { clearSuccessMode: true } : {}),
        ...(options.maxConcurrentRuns !== undefined ? { maxConcurrentRuns: Number(options.maxConcurrentRuns) } : {}),
        ...(options.allowRepo.length > 0 ? { allowedRepos: options.allowRepo } : {}),
        ...(options.allowRisk.length > 0 ? { allowedRisk: options.allowRisk } : {}),
        ...(options.capability.length > 0 ? { capabilities: options.capability } : {}),
        ...(options.env.length > 0 ? { environment: parseKeyValuePairs(options.env) } : {}),
      });
      console.log(`Updated ${agent.id}`);
    });

  agents
    .command("validate")
    .description("Validate configured agents")
    .action(() => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      for (const result of validateAgents(workspace.backlogDir)) {
        console.log(`${result.id}: ${result.ok ? "ok" : "invalid"}${result.reasons.length > 0 ? ` (${result.reasons.join(", ")})` : ""}`);
      }
    });

  agents
    .command("health")
    .description("Show runtime health for configured agents")
    .option("--json", "Emit machine-readable JSON")
    .action((options: { json?: boolean }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const health = healthForAgents(workspace.backlogDir);
      if (options.json) {
        console.log(JSON.stringify(health, null, 2));
        return;
      }
      for (const item of health) {
        console.log(`${item.id} | healthy=${item.healthy} | active=${item.activeRuns}/${item.maxConcurrentRuns}${item.reasons.length > 0 ? ` | ${item.reasons.join(", ")}` : ""}`);
      }
    });
}
