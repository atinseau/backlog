import {
  addAgent,
  agentReadiness,
  deleteAgent,
  ensureDefaultModelAgents,
  listActiveRuns,
  providerFor,
  providerRegistry,
  updateAgent,
  type ProviderDescriptor,
} from "@backlog/core";
import type { Agent } from "@backlog/schemas";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../project-resolver.js";

// `project-write` is the label the UI shows for `workspace-write`; accept both
// so an older client keeps working.
const sandboxModeSchema = z
  .enum(["read-only", "project-write", "workspace-write", "danger-full-access"])
  .transform((value) => (value === "project-write" ? "workspace-write" : value));

const authModeSchema = z.enum(["auto", "subscription", "api_key"]);

const updateBodySchema = z
  .object({
    enabled: z.boolean().optional(),
    max_concurrent_runs: z.number().int().positive().optional(),
    sandbox_mode: sandboxModeSchema.nullable().optional(),
    auth_mode: authModeSchema.nullable().optional(),
    success_mode: z.enum(["review", "complete"]).nullable().optional(),
    allowed_repos: z.array(z.string()).optional(),
    allowed_risk: z.array(z.enum(["low", "medium", "high"])).optional(),
    capabilities: z.array(z.string()).optional(),
    model: z.string().nullable().optional(),
    profile: z.string().nullable().optional(),
    display_name: z.string().nullable().optional(),
  })
  .strict();

// The provider is validated against the registry in core rather than pinned to
// an enum here, so registering a runtime is the only step needed to make it
// creatable from the board.
const createBodySchema = z
  .object({
    id: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/, "id must match [A-Za-z0-9_-]"),
    provider: z.string().min(1),
    model: z.string().optional(),
    profile: z.string().optional(),
    command: z.string().optional(),
    enabled: z.boolean().optional(),
    sandbox_mode: sandboxModeSchema.optional(),
    auth_mode: authModeSchema.optional(),
    success_mode: z.enum(["review", "complete"]).optional(),
    max_concurrent_runs: z.number().int().positive().optional(),
    allowed_risk: z.array(z.enum(["low", "medium", "high"])).optional(),
    allowed_repos: z.array(z.string()).optional(),
    capabilities: z.array(z.string()).optional(),
  })
  .strict();

/** snake_case view of a provider descriptor, matching the rest of the API. */
function serializeProvider(descriptor: ProviderDescriptor) {
  return {
    id: descriptor.id,
    display_name: descriptor.displayName,
    models: descriptor.models,
    reasoning: {
      supported: descriptor.reasoning.supported,
      levels: descriptor.reasoning.levels,
      allows_custom: descriptor.reasoning.allowsCustom,
      default_level: descriptor.reasoning.defaultLevel ?? null,
    },
    auth_modes: descriptor.authModes,
    sandbox_modes: descriptor.sandboxModes,
    capabilities: {
      execute_run: descriptor.capabilities.executeRun,
      text_completion: descriptor.capabilities.textCompletion,
      structured_output: descriptor.capabilities.structuredOutput,
    },
    requires_command: descriptor.requiresCommand,
  };
}

function serializeAgent(backlogDir: string, agent: Agent, activeRuns: number) {
  const readiness = agentReadiness(backlogDir, agent);
  const missingKey = readiness.reasons.find((reason) => reason.startsWith("missing_api_key:"));
  return {
    id: agent.id,
    display_name: agent.display_name ?? null,
    provider: agent.provider,
    provider_id: providerFor(agent.provider)?.id ?? null,
    enabled: agent.enabled,
    max_concurrent_runs: agent.max_concurrent_runs,
    active_runs: activeRuns,
    capabilities: agent.capabilities,
    allowed_repos: agent.allowed_repos,
    allowed_risk: agent.allowed_risk,
    sandbox_mode: agent.sandbox_mode ?? null,
    auth_mode: agent.auth_mode ?? null,
    success_mode: agent.success_mode ?? null,
    model: agent.model ?? null,
    profile: agent.profile ?? null,
    ready: readiness.ready,
    reasons: readiness.reasons,
    // Kept for older clients: they gate the API-keys hint on this flag.
    needs_api_key: Boolean(missingKey),
    required_secret_key: missingKey ? missingKey.slice("missing_api_key:".length) : null,
  };
}

function toUpdateInput(data: z.infer<typeof updateBodySchema>): Parameters<typeof updateAgent>[2] {
  const input: Parameters<typeof updateAgent>[2] = {};
  if (data.enabled !== undefined) input.enabled = data.enabled;
  if (data.max_concurrent_runs !== undefined) input.maxConcurrentRuns = data.max_concurrent_runs;
  if (data.allowed_repos !== undefined) input.allowedRepos = data.allowed_repos;
  if (data.allowed_risk !== undefined) input.allowedRisk = data.allowed_risk;
  if (data.capabilities !== undefined) input.capabilities = data.capabilities;

  // A null clears the override; undefined leaves it alone.
  if (data.sandbox_mode === null) input.clearSandboxMode = true;
  else if (data.sandbox_mode !== undefined) input.sandboxMode = data.sandbox_mode;
  if (data.auth_mode === null) input.clearAuthMode = true;
  else if (data.auth_mode !== undefined) input.authMode = data.auth_mode;
  if (data.success_mode === null) input.clearSuccessMode = true;
  else if (data.success_mode !== undefined) input.successMode = data.success_mode;
  if (data.model === null) input.clearModel = true;
  else if (data.model !== undefined) input.model = data.model;
  if (data.profile === null) input.clearProfile = true;
  else if (data.profile !== undefined) input.profile = data.profile;
  if (data.display_name === null) input.clearDisplayName = true;
  else if (data.display_name !== undefined) input.displayName = data.display_name;

  return input;
}

function toAddInput(data: z.infer<typeof createBodySchema>): Parameters<typeof addAgent>[1] {
  return {
    id: data.id,
    provider: data.provider,
    ...(data.model !== undefined ? { model: data.model } : {}),
    ...(data.profile !== undefined ? { profile: data.profile } : {}),
    ...(data.command !== undefined ? { command: data.command } : {}),
    ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
    ...(data.sandbox_mode !== undefined ? { sandboxMode: data.sandbox_mode } : {}),
    ...(data.auth_mode !== undefined ? { authMode: data.auth_mode } : {}),
    ...(data.success_mode !== undefined ? { successMode: data.success_mode } : {}),
    ...(data.max_concurrent_runs !== undefined ? { maxConcurrentRuns: data.max_concurrent_runs } : {}),
    ...(data.allowed_risk !== undefined ? { allowedRisk: data.allowed_risk } : {}),
    ...(data.allowed_repos !== undefined ? { allowedRepos: data.allowed_repos } : {}),
    ...(data.capabilities !== undefined ? { capabilities: data.capabilities } : {}),
  };
}

export function agentsRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/providers", (c) => {
    return c.json({ providers: providerRegistry().describeAll().map(serializeProvider) });
  });

  app.get("/agents", (c) => {
    const project = c.get("project");
    const agents = ensureDefaultModelAgents(project.backlogDir).agents;
    const runs = listActiveRuns(project.backlogDir);
    return c.json({
      agents: agents.map((agent) =>
        serializeAgent(
          project.backlogDir,
          agent,
          runs.filter((run) => run.agent_id === agent.id).length,
        ),
      ),
    });
  });

  app.post("/agents", async (c) => {
    const project = c.get("project");
    const raw = await c.req.json().catch(() => null);
    const parsed = createBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    try {
      const created = addAgent(project.backlogDir, toAddInput(parsed.data));
      return c.json({ agent: created }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.includes("already exists") ? 409 : 400;
      return c.json({ error: "create_failed", detail: message }, status);
    }
  });

  app.delete("/agents/:id", (c) => {
    const project = c.get("project");
    try {
      deleteAgent(project.backlogDir, c.req.param("id"));
      return c.body(null, 204);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.startsWith("Unknown") ? 404 : 409;
      return c.json({ error: "delete_failed", detail: message }, status);
    }
  });

  app.patch("/agents/:id", async (c) => {
    const project = c.get("project");
    const raw = await c.req.json().catch(() => null);
    const parsed = updateBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    try {
      const agent = updateAgent(project.backlogDir, c.req.param("id"), toUpdateInput(parsed.data));
      return c.json({ agent });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.startsWith("Unknown") ? 404 : 400;
      return c.json({ error: "update_failed", detail: message }, status);
    }
  });

  return app;
}

