import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { getSecret } from "@backlog/config";
import {
  agentsFileSchema,
  type Agent,
  type AgentAuthMode,
  type AgentsFile,
  type SandboxMode,
  type SubTask,
} from "@backlog/schemas";
import { isAgentBusyStatus, listActiveRuns } from "./run-store.js";
import { providerFor, providerRegistry } from "./providers/index.js";
import type { ProviderReadiness } from "./providers/types.js";

// Whether an agent could run right now, as judged by its own runtime. The
// answer differs per provider — Claude Code carries a logged-in session and
// needs no key, a custom command needs neither — so the question belongs
// to the provider, not to a chain of ifs here.
export function agentReadiness(backlogDir: string, agent: Agent): ProviderReadiness {
  const provider = providerFor(agent.provider);
  if (!provider) {
    return { ready: false, reasons: [`unsupported_provider:${agent.provider}`] };
  }
  return provider.checkReadiness({
    agent,
    getSecret: (key) => getSecret(backlogDir, key),
  });
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

function defaultClaudeVariant(id: string, model: string, allowedRisk: Array<"low" | "medium" | "high">): Agent {
  return {
    id,
    provider: "claude",
    model,
    success_mode: "complete",
    enabled: true,
    max_concurrent_runs: 1,
    allowed_repos: [],
    allowed_risk: allowedRisk,
    capabilities: ["plan", "edit_code", "run_tests", "review", "shell", "git_read", "git_write"],
    sandbox_mode: "workspace-write",
    environment: {},
    retry_policy: { mode: "none", max_attempts: 2, reuse_worktree: true },
  };
}

function migrateKnownAgentModels(file: AgentsFile): boolean {
  let changed = false;
  for (const agent of file.agents) {
    if (agent.provider === "codex" && agent.model === "gpt-5-codex") {
      agent.model = "gpt-5.5";
      changed = true;
    }
  }
  return changed;
}

// Backfill the Haiku/Opus defaults for projects created before the
// model picker exposed Claude variants as first-class choices. This
// intentionally only touches the exact old seed set (`claude-code` alone,
// paired with whatever else shipped as the second default at the time) so
// deleting a default agent remains respected afterwards.
export function ensureDefaultModelAgents(backlogDir: string): AgentsFile {
  const file = readAgentsFile(backlogDir);
  const ids = new Set(file.agents.map((agent) => agent.id));
  let changed = migrateKnownAgentModels(file);
  const oldDefaultOnly =
    file.agents.length === 2 &&
    ids.has("claude-code");
  if (!oldDefaultOnly) {
    if (changed) writeAgentsFile(backlogDir, file);
    return file;
  }

  const insertAt = file.agents.length;
  file.agents.splice(
    insertAt,
    0,
    defaultClaudeVariant("claude-opus", "opus", ["low", "medium", "high"]),
    defaultClaudeVariant("claude-haiku", "haiku", ["low", "medium"]),
  );
  changed = true;
  if (changed) writeAgentsFile(backlogDir, file);
  return file;
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
  sandboxMode?: SandboxMode;
  clearSandboxMode?: boolean;
  authMode?: AgentAuthMode;
  clearAuthMode?: boolean;
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
  if (input.authMode !== undefined) {
    agent.auth_mode = input.authMode;
  }
  if (input.clearAuthMode) {
    delete agent.auth_mode;
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
  sandboxMode?: SandboxMode;
  authMode?: AgentAuthMode;
  successMode?: "review" | "complete";
  enabled?: boolean;
  maxConcurrentRuns?: number;
  allowedRepos?: string[];
  allowedRisk?: Array<"low" | "medium" | "high">;
  capabilities?: string[];
}

// Seed a fresh agent in agents.yaml. The id must be unique within the
// workspace and the provider must be one the registry backs. Defaults
// mirror the init-layout seed so a brand-new agent is immediately
// usable for "small task" runs (low/medium risk, single concurrent run,
// the standard coding capabilities).
export function addAgent(backlogDir: string, input: AddAgentInput): Agent {
  const file = readAgentsFile(backlogDir);
  if (file.agents.some((a) => a.id === input.id)) {
    throw new Error(`Agent already exists: ${input.id}`);
  }

  // Validate against the registry rather than a hardcoded list, so a new
  // runtime becomes creatable the moment it is registered.
  const provider = providerFor(input.provider);
  if (!provider) {
    const known = providerRegistry()
      .list()
      .map((candidate) => candidate.id)
      .join(", ");
    throw new Error(`Unknown provider: ${input.provider}. Known providers: ${known}.`);
  }
  if (provider.describe().requiresCommand && !input.command?.trim()) {
    throw new Error(`Provider ${provider.id} requires a command; pass one when creating the agent.`);
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
  if (input.authMode !== undefined) agent.auth_mode = input.authMode;
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

/** Static configuration problems, independent of whether a run is in flight. */
function configurationProblems(agent: Agent): string[] {
  const reasons: string[] = [];
  if (agent.max_concurrent_runs < 1) reasons.push("max_concurrent_runs_must_be_positive");
  if (agent.allowed_risk.length === 0) reasons.push("allowed_risk_empty");
  if (agent.capabilities.length === 0) reasons.push("capabilities_empty");
  return reasons;
}

export function validateAgents(backlogDir: string): Array<{ id: string; ok: boolean; reasons: string[] }> {
  return listAgents(backlogDir).map((agent) => {
    const reasons = [...configurationProblems(agent), ...agentReadiness(backlogDir, agent).reasons];
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
    reasons.push(...agentReadiness(backlogDir, agent).reasons);
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

// True for agents the orchestrator can actually launch. Providers with no
// executeRun (and unknown ones) stay valid in agents.yaml for tracking-only
// flows but never enter the runnable plan — letting them through would mean
// clicking ▶ Play silently no-ops when the run-launcher skips them.
export function supportsAgentExecution(agent: Pick<Agent, "provider" | "command">): boolean {
  const provider = providerFor(agent.provider);
  if (!provider?.executeRun) return false;
  return provider.describe().requiresCommand ? Boolean(agent.command?.trim()) : true;
}

/** Why this agent cannot take this task. Empty means it can. */
function taskFitProblems(agent: Agent, task: Pick<SubTask, "repo" | "risk" | "execution">): string[] {
  const reasons: string[] = [];
  if (agent.allowed_repos.length > 0 && !agent.allowed_repos.includes(task.repo)) {
    reasons.push("repo_not_allowed");
  }
  if (!agent.allowed_risk.includes(task.risk)) {
    reasons.push("risk_not_allowed");
  }
  const missing = task.execution.required_capabilities.filter(
    (capability) => !agent.capabilities.includes(capability),
  );
  if (missing.length > 0) {
    reasons.push(`missing_capabilities:${missing.join(",")}`);
  }
  return reasons;
}

// Deliberately ignores `agent.enabled`: the toggle was retired from the UX
// (an agent is either configured and ready, or it isn't) but the field stays
// in the schema for backward compatibility.
export function canAgentRunTask(agent: Agent, task: Pick<SubTask, "repo" | "risk" | "execution">, backlogDir?: string): boolean {
  if (!supportsAgentExecution(agent)) return false;
  if (backlogDir && !agentReadiness(backlogDir, agent).ready) return false;
  return taskFitProblems(agent, task).length === 0;
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
      // Readiness codes (`missing_executable:…`, `missing_api_key:…`) come
      // straight from the provider, so the UI can route the user to the right
      // fix without this file knowing what a given runtime needs.
      reasons.push(...agentReadiness(backlogDir, agent).reasons);
      reasons.push(...taskFitProblems(agent, task));

      const activeRunsForAgent = activeRunCounts.get(agent.id) ?? 0;
      if (activeRunsForAgent >= agent.max_concurrent_runs) {
        reasons.push("at_capacity");
      }

      // Ranking is about fit and headroom only. There is deliberately no
      // per-provider bonus: which runtime is "better" is the user's call,
      // expressed through preferred_agents.
      let score = 0;
      if (task.execution.preferred_agents.includes(agent.id)) {
        score += 50;
        reasons.push("preferred_agent");
      }
      score += agent.capabilities.filter((capability) => task.execution.required_capabilities.includes(capability)).length * 10;
      score += Math.max(0, agent.max_concurrent_runs - activeRunsForAgent) * 5;
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
