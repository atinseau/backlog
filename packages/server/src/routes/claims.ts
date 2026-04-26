import {
  archiveClaim,
  createClaim,
  findOverlappingClaims,
  listActiveClaims,
  listArchivedClaims,
} from "@backlog/claims";
import { listAgents } from "@backlog/core";
import type { Agent, ClaimRecord } from "@backlog/schemas";
import { Hono } from "hono";
import { z } from "zod";
import { computeRetryAfter } from "../lib/retry-after.js";
import type { ServerWorkspace } from "../workspace-context.js";

interface EnrichedClaim extends ClaimRecord {
  agent?: {
    id: string;
    provider: string;
    model?: string;
    profile?: string;
  };
}

function enrichClaim(claim: ClaimRecord, agentsById: Map<string, Agent>): EnrichedClaim {
  if (!claim.agent_id) return claim;
  const agent = agentsById.get(claim.agent_id);
  if (!agent) return claim;
  const summary: EnrichedClaim["agent"] = {
    id: agent.id,
    provider: agent.provider,
  };
  if (agent.model) summary.model = agent.model;
  if (agent.profile) summary.profile = agent.profile;
  return { ...claim, agent: summary };
}

const createClaimBodySchema = z.object({
  repo: z.string().min(1),
  repo_path: z.string().min(1).optional(),
  topic: z.string().min(1),
  paths: z.array(z.string().min(1)).min(1),
  mode: z.enum(["exclusive", "shared"]).optional(),
  ttl_minutes: z.number().int().positive().optional(),
  expected_duration_seconds: z.number().int().positive().optional(),
  agent_id: z.string().min(1).optional(),
});

function buildConflictResponse(blocking: ClaimRecord) {
  const hint = computeRetryAfter(blocking);
  return {
    error: "claim_overlap",
    conflict_with: blocking.id,
    blocking_topic: blocking.topic,
    blocking_agent_id: blocking.agent_id ?? null,
    blocking_paths: blocking.paths,
    blocking_expected_finish_at: blocking.expected_finish_at ?? null,
    blocking_expires_at: blocking.expires_at,
    blocking_status: hint.blocking_status,
    retry_after_seconds: hint.retry_after_seconds,
    retry_after_source: hint.source,
  };
}

export function claimsRoutes(workspace: ServerWorkspace): Hono {
  const app = new Hono();

  app.get("/claims", (c) => {
    const archivedFlag = c.req.query("archived");
    const archivedOnly = archivedFlag === "1" || archivedFlag === "true";
    const claims = archivedOnly
      ? listArchivedClaims(workspace.backlogDir)
      : listActiveClaims(workspace.backlogDir);
    const repo = c.req.query("repo");
    const filtered = repo ? claims.filter((claim) => claim.repo === repo) : claims;
    const agentsById = new Map(listAgents(workspace.backlogDir).map((agent) => [agent.id, agent]));
    return c.json({
      generated_at: new Date().toISOString(),
      count: filtered.length,
      archived: archivedOnly,
      claims: filtered.map((claim) => enrichClaim(claim, agentsById)),
    });
  });

  app.get("/claims/check", (c) => {
    const repo = c.req.query("repo");
    const path = c.req.query("path");
    if (!repo || !path) {
      return c.json({ error: "missing_query", required: ["repo", "path"] }, 400);
    }
    const claims = listActiveClaims(workspace.backlogDir);
    const candidate = {
      id: "__check__",
      repo,
      repo_path: path,
      paths: [path],
      mode: "exclusive" as const,
    };
    const overlaps = findOverlappingClaims(workspace.backlogDir, candidate);

    if (overlaps.length === 0) {
      return c.json({ free: true, claims: [] });
    }

    const blocking = overlaps[0];
    if (!blocking) {
      return c.json({ free: true, claims: [] });
    }
    const hint = computeRetryAfter(blocking);
    return c.json({
      free: false,
      claims: overlaps,
      retry_after_seconds: hint.retry_after_seconds,
      blocking_status: hint.blocking_status,
      retry_after_source: hint.source,
    });
  });

  app.post("/claims", async (c) => {
    const raw = await c.req.json().catch(() => null);
    const parsed = createClaimBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    const body = parsed.data;
    const repoPath = body.repo_path ?? body.repo;

    const candidate = {
      id: "__candidate__",
      repo: body.repo,
      repo_path: repoPath,
      paths: body.paths,
      mode: body.mode ?? "exclusive",
    };
    const overlaps = findOverlappingClaims(workspace.backlogDir, candidate);
    if (overlaps.length > 0 && (body.mode ?? "exclusive") === "exclusive") {
      const blocking = overlaps[0];
      if (blocking) {
        return c.json(buildConflictResponse(blocking), 409);
      }
    }

    const createInput: Parameters<typeof createClaim>[0] = {
      backlogDir: workspace.backlogDir,
      repo: body.repo,
      repoPath,
      topic: body.topic,
      paths: body.paths,
      mode: body.mode ?? "exclusive",
    };
    if (body.ttl_minutes !== undefined) createInput.ttlMinutes = body.ttl_minutes;
    if (body.expected_duration_seconds !== undefined) {
      createInput.expectedDurationSeconds = body.expected_duration_seconds;
    }
    if (body.agent_id !== undefined) createInput.agentId = body.agent_id;

    const claim = createClaim(createInput);
    return c.json({ claim }, 201);
  });

  app.delete("/claims/:id", (c) => {
    const id = c.req.param("id");
    try {
      const archived = archiveClaim(workspace.backlogDir, id);
      return c.json({ archived });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "archive_failed", detail: message }, 404);
    }
  });

  return app;
}
