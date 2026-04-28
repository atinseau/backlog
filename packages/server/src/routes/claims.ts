import {
  archiveClaim,
  createClaim,
  findOverlappingClaims,
  listActiveClaims,
  listArchivedClaims,
  removeContextFile,
  writeContextFile,
} from "@backlog/claims";
import { loadConfig } from "@backlog/config";
import { listAgents } from "@backlog/core";
import { detectGitDir } from "@backlog/git";
import type { Agent, ClaimRecord, RepoConfig } from "@backlog/schemas";
import { Hono } from "hono";
import { z } from "zod";
import { computeRetryAfter } from "../lib/retry-after.js";
import type { AppEnv } from "../project-resolver.js";

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
  metadata: z.record(z.string(), z.string()).optional(),
});

async function resolveGitDirForRepo(backlogDir: string, repoId: string): Promise<string | null> {
  let repo: RepoConfig | undefined;
  try {
    repo = loadConfig(backlogDir).repos.find((entry) => entry.id === repoId);
  } catch {
    return null;
  }
  if (!repo) return null;
  try {
    return await detectGitDir(repo.path);
  } catch {
    return null;
  }
}

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

export function claimsRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/claims", (c) => {
    const workspace = c.get("workspace");
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
    const workspace = c.get("workspace");
    const repo = c.req.query("repo");
    const path = c.req.query("path");
    if (!repo || !path) {
      return c.json({ error: "missing_query", required: ["repo", "path"] }, 400);
    }
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
    const workspace = c.get("workspace");
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
    if (body.metadata && Object.keys(body.metadata).length > 0) {
      createInput.metadata = body.metadata;
    }

    const claim = createClaim(createInput);
    const gitDir = await resolveGitDirForRepo(workspace.backlogDir, claim.repo);
    if (gitDir) {
      writeContextFile(gitDir, {
        version: 1,
        claim_id: claim.id,
        updated_at: new Date().toISOString(),
      });
    }
    return c.json({ claim }, 201);
  });

  app.delete("/claims/:id", async (c) => {
    const workspace = c.get("workspace");
    const id = c.req.param("id");
    try {
      const archived = archiveClaim(workspace.backlogDir, id);
      const gitDir = await resolveGitDirForRepo(workspace.backlogDir, archived.repo);
      if (gitDir) {
        removeContextFile(gitDir, archived.id);
      }
      return c.json({ archived });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "archive_failed", detail: message }, 404);
    }
  });

  return app;
}
