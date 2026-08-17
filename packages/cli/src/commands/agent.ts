import { Command, Option } from "commander";
import { findProject } from "@backlog/config";
import {
  addAgent,
  deleteAgent,
  getAgent,
  healthForAgents,
  listAgents,
  providerRegistry,
  setAgentEnabled,
  updateAgent,
  validateAgents,
} from "@backlog/core";

function collectValues(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function requireProject(): { backlogDir: string } {
  const workspace = findProject();
  if (!workspace) {
    throw new Error("No .backlog project found. Run `backlog init` first.");
  }
  return workspace;
}

function normalizeAuthMode(value: string): "auto" | "subscription" | "api_key" {
  if (value === "auto" || value === "subscription" || value === "api_key") return value;
  throw new Error(`Invalid --auth-mode: ${value}. Expected auto, subscription or api_key.`);
}

function executableProviderIds(): string[] {
  return providerRegistry()
    .describeAll()
    .filter((descriptor) => descriptor.capabilities.executeRun)
    .map((descriptor) => descriptor.id);
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

function normalizeSandboxMode(value: string): "read-only" | "workspace-write" | "danger-full-access" {
  if (value === "project-write") return "workspace-write";
  if (value === "read-only" || value === "workspace-write" || value === "danger-full-access") return value;
  throw new Error(`Invalid --sandbox-mode: ${value}`);
}

export function registerAgentCommand(program: Command): void {
  const agents = program.command("agents").description("Manage configured agents");

  agents
    .command("providers")
    .description("List the runtimes an agent can be built on")
    .option("--json", "Emit machine-readable JSON")
    .action((options: { json?: boolean }) => {
      const descriptors = providerRegistry().describeAll();
      if (options.json) {
        console.log(JSON.stringify(descriptors, null, 2));
        return;
      }
      for (const descriptor of descriptors) {
        const abilities = Object.entries(descriptor.capabilities)
          .filter(([, enabled]) => enabled)
          .map(([name]) => name)
          .join(", ");
        console.log(`${descriptor.id} | ${descriptor.displayName} | ${abilities}`);
      }
    });

  agents
    .command("add")
    .description("Create an agent")
    .argument("<agent-id>", "Unique agent id")
    .requiredOption("--provider <provider>", `Runtime to build on (${executableProviderIds().join(", ")})`)
    .option("--model <model>", "Model to request; any value the runtime accepts")
    .option("--profile <profile>", "Runtime profile")
    .option("--command <command>", "Executable override (required for `custom`)")
    .option("--sandbox-mode <mode>", "read-only, project-write, or danger-full-access")
    .option("--auth-mode <mode>", "auto (default), subscription, or api_key")
    .option("--success-mode <mode>", "review or complete")
    .option("--max-concurrent-runs <count>", "Concurrency limit")
    .option("--allow-repository <repository>", "Restrict to these repositories", collectValues, [])
    .option("--allow-risk <risk>", "Risk levels this agent may take", collectValues, [])
    .option("--capability <capability>", "Capabilities this agent provides", collectValues, [])
    .action((agentId: string, options: {
      provider: string;
      model?: string;
      profile?: string;
      command?: string;
      sandboxMode?: string;
      authMode?: string;
      successMode?: "review" | "complete";
      maxConcurrentRuns?: string;
      allowRepository: string[];
      allowRisk: Array<"low" | "medium" | "high">;
      capability: string[];
    }) => {
      const workspace = requireProject();
      const agent = addAgent(workspace.backlogDir, {
        id: agentId,
        provider: options.provider,
        ...(options.model !== undefined ? { model: options.model } : {}),
        ...(options.profile !== undefined ? { profile: options.profile } : {}),
        ...(options.command !== undefined ? { command: options.command } : {}),
        ...(options.sandboxMode !== undefined ? { sandboxMode: normalizeSandboxMode(options.sandboxMode) } : {}),
        ...(options.authMode !== undefined ? { authMode: normalizeAuthMode(options.authMode) } : {}),
        ...(options.successMode !== undefined ? { successMode: options.successMode } : {}),
        ...(options.maxConcurrentRuns !== undefined ? { maxConcurrentRuns: Number(options.maxConcurrentRuns) } : {}),
        ...(options.allowRepository.length > 0 ? { allowedRepos: options.allowRepository } : {}),
        ...(options.allowRisk.length > 0 ? { allowedRisk: options.allowRisk } : {}),
        ...(options.capability.length > 0 ? { capabilities: options.capability } : {}),
      });
      console.log(`Created ${agent.id} on ${agent.provider}`);
    });

  agents
    .command("rm")
    .alias("remove")
    .description("Delete an agent")
    .argument("<agent-id>", "Agent id")
    .action((agentId: string) => {
      const workspace = requireProject();
      deleteAgent(workspace.backlogDir, agentId);
      console.log(`Deleted ${agentId}`);
    });

  agents
    .command("list")
    .description("List known agents")
    .option("--json", "Emit machine-readable JSON")
    .action((options: { json?: boolean }) => {
      const workspace = requireProject();
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
      const workspace = requireProject();
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
      console.log(`Model: ${agent.model ?? "(runtime default)"}`);
      console.log(`Auth mode: ${agent.auth_mode ?? "auto"}`);
      console.log(`Sandbox: ${agent.sandbox_mode ?? "(runtime default)"}`);
      console.log(`Enabled: ${agent.enabled}`);
      console.log(`Max concurrent runs: ${agent.max_concurrent_runs}`);
      console.log(`Allowed repositories: ${agent.allowed_repos.length > 0 ? agent.allowed_repos.join(", ") : "all"}`);
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
      const workspace = requireProject();
      const agent = setAgentEnabled(workspace.backlogDir, agentId, true);
      console.log(`Enabled ${agent.id}`);
    });

  agents
    .command("disable")
    .description("Disable one configured agent")
    .argument("<agent-id>", "Agent id")
    .action((agentId: string) => {
      const workspace = requireProject();
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
    .option("--sandbox-mode <mode>", "read-only, project-write, or danger-full-access")
    .option("--clear-sandbox-mode", "Remove the sandbox mode override")
    .option("--auth-mode <mode>", "auto, subscription, or api_key")
    .option("--clear-auth-mode", "Fall back to the default auth mode")
    .option("--success-mode <mode>", "review or complete")
    .option("--clear-success-mode", "Remove the success mode override")
    .option("--max-concurrent-runs <count>", "Concurrency limit")
    .option("--allow-repository <repository>", "Replace allowed repositories", collectValues, [])
    .addOption(new Option("--allow-repo <repo>", "Replace allowed repositories").argParser(collectValues).default([]).hideHelp())
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
      sandboxMode?: string;
      clearSandboxMode?: boolean;
      authMode?: string;
      clearAuthMode?: boolean;
      successMode?: "review" | "complete";
      clearSuccessMode?: boolean;
      maxConcurrentRuns?: string;
      allowRepo: string[];
      allowRisk: Array<"low" | "medium" | "high">;
      capability: string[];
      env: string[];
    }) => {
      const workspace = requireProject();
      const agent = updateAgent(workspace.backlogDir, agentId, {
        ...(options.model !== undefined ? { model: options.model } : {}),
        ...(options.clearModel ? { clearModel: true } : {}),
        ...(options.profile !== undefined ? { profile: options.profile } : {}),
        ...(options.clearProfile ? { clearProfile: true } : {}),
        ...(options.command !== undefined ? { command: options.command } : {}),
        ...(options.clearCommand ? { clearCommand: true } : {}),
        ...(options.sandboxMode !== undefined ? { sandboxMode: normalizeSandboxMode(options.sandboxMode) } : {}),
        ...(options.clearSandboxMode ? { clearSandboxMode: true } : {}),
        ...(options.authMode !== undefined ? { authMode: normalizeAuthMode(options.authMode) } : {}),
        ...(options.clearAuthMode ? { clearAuthMode: true } : {}),
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
      const workspace = requireProject();
      for (const result of validateAgents(workspace.backlogDir)) {
        console.log(`${result.id}: ${result.ok ? "ok" : "invalid"}${result.reasons.length > 0 ? ` (${result.reasons.join(", ")})` : ""}`);
      }
    });

  agents
    .command("health")
    .description("Show runtime health for configured agents")
    .option("--json", "Emit machine-readable JSON")
    .action((options: { json?: boolean }) => {
      const workspace = requireProject();
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
