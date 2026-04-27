import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import YAML from "yaml";
import { agentsFileSchema, type Agent, type AgentsFile, type SubTask } from "@backlog/schemas";
import { listActiveRuns } from "./run-store.js";

function agentsPath(backlogDir: string): string {
  return path.join(backlogDir, "agents.yaml");
}

export function readAgentsFile(backlogDir: string): AgentsFile {
  const parsed = YAML.parse(fs.readFileSync(agentsPath(backlogDir), "utf8")) as unknown;
  return agentsFileSchema.parse(parsed);
}

export function writeAgentsFile(backlogDir: string, file: AgentsFile): void {
  fs.writeFileSync(agentsPath(backlogDir), YAML.stringify(agentsFileSchema.parse(file)), "utf8");
}

export function listAgents(backlogDir: string): Agent[] {
  return readAgentsFile(backlogDir).agents;
}

export function getAgent(backlogDir: string, id: string): Agent | null {
  return listAgents(backlogDir).find((candidate) => candidate.id === id) ?? null;
}

export interface UpdateAgentInput {
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
  environment?: Record<string, string>;
  enabled?: boolean;
  maxConcurrentRuns?: number;
  allowedRepos?: string[];
  allowedRisk?: Array<"low" | "medium" | "high">;
  capabilities?: string[];
}

export function updateAgent(backlogDir: string, id: string, input: UpdateAgentInput): Agent {
  const file = readAgentsFile(backlogDir);
  const agent = file.agents.find((candidate) => candidate.id === id);
  if (!agent) {
    throw new Error(`Unknown agent: ${id}`);
  }

  if (input.model !== undefined) {
    agent.model = input.model;
  }
  if (input.clearModel) {
    delete agent.model;
  }
  if (input.profile !== undefined) {
    agent.profile = input.profile;
  }
  if (input.clearProfile) {
    delete agent.profile;
  }
  if (input.command !== undefined) {
    agent.command = input.command;
  }
  if (input.clearCommand) {
    delete agent.command;
  }
  if (input.sandboxMode !== undefined) {
    agent.sandbox_mode = input.sandboxMode;
  }
  if (input.clearSandboxMode) {
    delete agent.sandbox_mode;
  }
  if (input.successMode !== undefined) {
    agent.success_mode = input.successMode;
  }
  if (input.clearSuccessMode) {
    delete agent.success_mode;
  }
  if (input.environment !== undefined) {
    agent.environment = input.environment;
  }
  if (input.enabled !== undefined) {
    agent.enabled = input.enabled;
  }
  if (input.maxConcurrentRuns !== undefined) {
    agent.max_concurrent_runs = input.maxConcurrentRuns;
  }
  if (input.allowedRepos !== undefined) {
    agent.allowed_repos = input.allowedRepos;
  }
  if (input.allowedRisk !== undefined) {
    agent.allowed_risk = input.allowedRisk;
  }
  if (input.capabilities !== undefined) {
    agent.capabilities = input.capabilities;
  }

  writeAgentsFile(backlogDir, file);
  return agent;
}

export function setAgentEnabled(backlogDir: string, id: string, enabled: boolean): Agent {
  return updateAgent(backlogDir, id, { enabled });
}

export interface AgentHealth {
  id: string;
  provider: string;
  enabled: boolean;
  activeRuns: number;
  maxConcurrentRuns: number;
  healthy: boolean;
  reasons: string[];
}

export interface AgentSelection {
  agent: Agent;
  score: number;
  reasons: string[];
  activeRuns: number;
  available: boolean;
}

function executableExists(command: string): boolean {
  if (command.includes("/") || command.startsWith(".")) {
    return fs.existsSync(command);
  }
  return spawnSync("which", [command], { stdio: "ignore" }).status === 0;
}

export function validateAgents(backlogDir: string): Array<{ id: string; ok: boolean; reasons: string[] }> {
  return listAgents(backlogDir).map((agent) => {
    const reasons: string[] = [];
    if (agent.max_concurrent_runs < 1) {
      reasons.push("max_concurrent_runs_must_be_positive");
    }
    if (agent.allowed_risk.length === 0) {
      reasons.push("allowed_risk_empty");
    }
    if (agent.capabilities.length === 0) {
      reasons.push("capabilities_empty");
    }
    if (agent.provider === "custom" && !agent.command) {
      reasons.push("custom_provider_missing_command");
    }
    if (agent.provider === "codex" && !executableExists(agent.command ?? "codex")) {
      reasons.push("codex_executable_missing");
    }
    if (agent.provider === "claude" && !executableExists(agent.command ?? "claude")) {
      reasons.push("claude_executable_missing");
    }
    return {
      id: agent.id,
      ok: reasons.length === 0,
      reasons,
    };
  });
}

export function healthForAgents(backlogDir: string): AgentHealth[] {
  const activeRuns = listActiveRuns(backlogDir);
  return listAgents(backlogDir).map((agent) => {
    const count = activeRuns.filter((run) => run.agent_id === agent.id).length;
    const reasons: string[] = [];
    if (!agent.enabled) {
      reasons.push("disabled");
    }
    if (count > agent.max_concurrent_runs) {
      reasons.push("over_capacity");
    }
    if (agent.provider === "custom" && !agent.command) {
      reasons.push("missing_command");
    }
    if (agent.provider === "codex" && !executableExists(agent.command ?? "codex")) {
      reasons.push("missing_codex_executable");
    }
    if (agent.provider === "claude" && !executableExists(agent.command ?? "claude")) {
      reasons.push("missing_claude_executable");
    }
    return {
      id: agent.id,
      provider: agent.provider,
      enabled: agent.enabled,
      activeRuns: count,
      maxConcurrentRuns: agent.max_concurrent_runs,
      healthy: reasons.length === 0,
      reasons,
    };
  });
}

export function canAgentRunTask(agent: Agent, task: Pick<SubTask, "repo" | "risk" | "execution">): boolean {
  if (!agent.enabled) {
    return false;
  }
  if (agent.allowed_repos.length > 0 && !agent.allowed_repos.includes(task.repo)) {
    return false;
  }
  if (!agent.allowed_risk.includes(task.risk)) {
    return false;
  }
  return task.execution.required_capabilities.every((capability) => agent.capabilities.includes(capability));
}

export function rankAgentsForTask(backlogDir: string, task: Pick<SubTask, "repo" | "risk" | "execution">): AgentSelection[] {
  const activeRuns = listActiveRuns(backlogDir);
  const activeRunCounts = new Map<string, number>();
  for (const run of activeRuns) {
    activeRunCounts.set(run.agent_id, (activeRunCounts.get(run.agent_id) ?? 0) + 1);
  }

  return listAgents(backlogDir)
    .map((agent) => {
      const reasons: string[] = [];
      if (!agent.enabled) {
        reasons.push("disabled");
      }
      if (agent.allowed_repos.length > 0 && !agent.allowed_repos.includes(task.repo)) {
        reasons.push("repo_not_allowed");
      }
      if (!agent.allowed_risk.includes(task.risk)) {
        reasons.push("risk_not_allowed");
      }

      const missingCapabilities = task.execution.required_capabilities.filter((capability) => !agent.capabilities.includes(capability));
      if (missingCapabilities.length > 0) {
        reasons.push(`missing_capabilities:${missingCapabilities.join(",")}`);
      }

      const activeRunsForAgent = activeRunCounts.get(agent.id) ?? 0;
      if (activeRunsForAgent >= agent.max_concurrent_runs) {
        reasons.push("at_capacity");
      }

      let score = 0;
      if (task.execution.preferred_agents.includes(agent.id)) {
        score += 50;
        reasons.push("preferred_agent");
      }
      score += agent.capabilities.filter((capability) => task.execution.required_capabilities.includes(capability)).length * 10;
      score += Math.max(0, agent.max_concurrent_runs - activeRunsForAgent) * 5;
      if (agent.provider === "custom") {
        score += 5;
      }
      if (agent.provider === "codex") {
        score += 10;
      }
      if (agent.provider === "claude") {
        score += 8;
      }
      if (reasons.length === 0) {
        reasons.push("compatible");
      }

      return {
        agent,
        score,
        reasons,
        activeRuns: activeRunsForAgent,
        available: canAgentRunTask(agent, task) && activeRunsForAgent < agent.max_concurrent_runs,
      };
    })
    .sort((left, right) => {
      if (left.available !== right.available) {
        return left.available ? -1 : 1;
      }
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      return left.agent.id.localeCompare(right.agent.id);
    });
}

export function selectionForAgentTask(
  backlogDir: string,
  task: Pick<SubTask, "repo" | "risk" | "execution">,
  agentId: string,
): AgentSelection | null {
  return rankAgentsForTask(backlogDir, task).find((candidate) => candidate.agent.id === agentId) ?? null;
}

export function pickAgentForTask(backlogDir: string, task: Pick<SubTask, "repo" | "risk" | "execution">): Agent {
  const agent = rankAgentsForTask(backlogDir, task).find((candidate) => candidate.available)?.agent;
  if (!agent) {
    throw new Error(`No enabled agent can run repo ${task.repo} at risk ${task.risk}.`);
  }
  return agent;
}

export function compatibleAgentsForTask(backlogDir: string, task: Pick<SubTask, "repo" | "risk" | "execution">): Agent[] {
  return rankAgentsForTask(backlogDir, task)
    .filter((candidate) => candidate.available)
    .map((candidate) => candidate.agent);
}
