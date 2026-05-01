import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { hasSecret } from "@backlog/config";
import { agentsFileSchema, type Agent, type AgentsFile, type SubTask } from "@backlog/schemas";
import { isAgentBusyStatus, listActiveRuns } from "./run-store.js";
import { executableExists } from "./provider-utils.js";

// Map a provider id → the secret key its executor needs at run time.
// Returns null when no key is required (custom agents own their env;
// manual is non-executable so the question doesn't apply).
function requiredSecretKeyForProvider(provider: string): string | null {
  if (provider === "claude") return "ANTHROPIC_API_KEY";
  if (provider === "codex") return "OPENAI_API_KEY";
  return null;
}

// True when the agent's provider needs an API key that isn't currently
// in the project's secrets store. Used to filter the planner so a
// "Codex but no OPENAI_API_KEY" agent can't be picked silently.
function agentNeedsApiKey(backlogDir: string, agent: Agent): boolean {
  const key = requiredSecretKeyForProvider(agent.provider);
  return key !== null && !hasSecret(backlogDir, key);
}

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
  // Human-friendly label set via the UI's double-click rename or
  // `backlog agents update --display-name`. Setting it to empty
  // string is treated as a request to clear (use clearDisplayName
  // explicitly for clarity in callers).
  displayName?: string;
  clearDisplayName?: boolean;
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

  if (input.displayName !== undefined) {
    if (input.displayName === "") {
      delete agent.display_name;
    } else {
      agent.display_name = input.displayName;
    }
  }
  if (input.clearDisplayName) {
    delete agent.display_name;
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

export interface AddAgentInput {
  id: string;
  provider: string;
  model?: string;
  profile?: string;
  command?: string;
  sandboxMode?: "read-only" | "workspace-write" | "danger-full-access";
  successMode?: "review" | "complete";
  enabled?: boolean;
  maxConcurrentRuns?: number;
  allowedRepos?: string[];
  allowedRisk?: Array<"low" | "medium" | "high">;
  capabilities?: string[];
}

// Seed a fresh agent in agents.yaml. The id must be unique within the
// workspace; the provider is free-form (claude / codex / custom / manual)
// to leave room for new runtimes without a schema migration. Defaults
// mirror the init-layout seed so a brand-new agent is immediately
// usable for "small task" runs (low/medium risk, single concurrent run,
// the standard coding capabilities).
export function addAgent(backlogDir: string, input: AddAgentInput): Agent {
  const file = readAgentsFile(backlogDir);
  if (file.agents.some((a) => a.id === input.id)) {
    throw new Error(`Agent already exists: ${input.id}`);
  }
  const agent: Agent = {
    id: input.id,
    provider: input.provider,
    enabled: input.enabled ?? true,
    max_concurrent_runs: input.maxConcurrentRuns ?? 1,
    allowed_repos: input.allowedRepos ?? [],
    allowed_risk: input.allowedRisk ?? ["low", "medium"],
    capabilities:
      input.capabilities ??
      ["plan", "edit_code", "run_tests", "review", "shell", "git_read", "git_write"],
    environment: {},
    retry_policy: { mode: "none", max_attempts: 2, reuse_worktree: true },
  };
  if (input.model !== undefined) agent.model = input.model;
  if (input.profile !== undefined) agent.profile = input.profile;
  if (input.command !== undefined) agent.command = input.command;
  if (input.sandboxMode !== undefined) agent.sandbox_mode = input.sandboxMode;
  if (input.successMode !== undefined) agent.success_mode = input.successMode;
  file.agents.push(agent);
  writeAgentsFile(backlogDir, file);
  return agent;
}

// Remove an agent. Refuses if a run is currently active for it — those
// runs reference the agent id in their state and would be left dangling.
// Stop / cancel the run first, then delete.
export function deleteAgent(backlogDir: string, id: string): void {
  const file = readAgentsFile(backlogDir);
  const idx = file.agents.findIndex((a) => a.id === id);
  if (idx < 0) {
    throw new Error(`Unknown agent: ${id}`);
  }
  const activeForAgent = listActiveRuns(backlogDir).filter((run) => run.agent_id === id);
  if (activeForAgent.length > 0) {
    throw new Error(
      `Agent ${id} has ${activeForAgent.length} active run(s); stop them before deleting.`,
    );
  }
  file.agents.splice(idx, 1);
  writeAgentsFile(backlogDir, file);
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

// True for agents the orchestrator can actually launch. Manual /
// unknown providers stay valid in agents.yaml for tracking-only flows
// but never end up in the runnable plan — letting them through here
// would mean clicking ▶ Play silently no-ops because the run-launcher
// skips unsupported providers downstream.
export function supportsAgentExecution(agent: Agent): boolean {
  if (agent.provider === "claude" || agent.provider === "codex") return true;
  if (agent.provider === "custom") return Boolean(agent.command);
  return false;
}

// Compatibility check that ignores `agent.enabled`. The "enabled"
// concept was removed from the UX (it confused users — an agent was
// either configured and ready, or it wasn't). The field stays in the
// schema for backward compat but doesn't gate scheduling.
//
// API-key presence (project secret) is checked here so the planner
// won't pick a Claude agent when ANTHROPIC_API_KEY isn't set — that
// previously surfaced as a runtime "no api token" error after the
// run was already in flight.
export function canAgentRunTask(agent: Agent, task: Pick<SubTask, "repo" | "risk" | "execution">, backlogDir?: string): boolean {
  if (!supportsAgentExecution(agent)) {
    return false;
  }
  if (agent.provider === "codex" && !executableExists(agent.command ?? "codex")) {
    return false;
  }
  if (agent.provider === "claude" && !executableExists(agent.command ?? "claude")) {
    return false;
  }
  if (backlogDir && agentNeedsApiKey(backlogDir, agent)) {
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
  // Only count runs that are actually keeping the agent CPU busy
  // (queued / preparing / running / interrupted). A run in
  // awaiting_review is parked waiting for a human and shouldn't
  // count against the agent's concurrency budget — otherwise
  // max_concurrent_runs=1 wedges the agent until the user clicks
  // Approve.
  const busyRuns = listActiveRuns(backlogDir).filter((run) => isAgentBusyStatus(run.status));
  const activeRunCounts = new Map<string, number>();
  for (const run of busyRuns) {
    activeRunCounts.set(run.agent_id, (activeRunCounts.get(run.agent_id) ?? 0) + 1);
  }

  return listAgents(backlogDir)
    .map((agent) => {
      const reasons: string[] = [];
      if (!supportsAgentExecution(agent)) {
        reasons.push(`unsupported_provider:${agent.provider}`);
      }
      if (agent.provider === "codex" && !executableExists(agent.command ?? "codex")) {
        reasons.push("missing_codex_executable");
      }
      if (agent.provider === "claude" && !executableExists(agent.command ?? "claude")) {
        reasons.push("missing_claude_executable");
      }
      // API key presence is the new "is this agent ready?" gate.
      // Surfaces "missing_api_key:ANTHROPIC_API_KEY" / "OPENAI_API_KEY"
      // so the UI can route the user straight to the API keys dialog.
      if (agentNeedsApiKey(backlogDir, agent)) {
        const key = requiredSecretKeyForProvider(agent.provider);
        reasons.push(`missing_api_key:${key}`);
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
        available: canAgentRunTask(agent, task, backlogDir) && activeRunsForAgent < agent.max_concurrent_runs,
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
