import { findOverlappingClaims, listActiveClaims } from "@backlog/claims";
import { Hono } from "hono";
import type { ServerWorkspace } from "../workspace-context.js";

export function claimsRoutes(workspace: ServerWorkspace): Hono {
  const app = new Hono();

  app.get("/claims", (c) => {
    const claims = listActiveClaims(workspace.backlogDir);
    const repo = c.req.query("repo");
    const filtered = repo ? claims.filter((claim) => claim.repo === repo) : claims;
    return c.json({
      generated_at: new Date().toISOString(),
      count: filtered.length,
      claims: filtered,
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

    const soonest = overlaps
      .map((claim) => new Date(claim.expires_at).getTime())
      .reduce((min, current) => Math.min(min, current), Number.POSITIVE_INFINITY);
    const retryAfter = Math.max(0, Math.ceil((soonest - Date.now()) / 1000));

    return c.json({
      free: false,
      claims: overlaps,
      soonest_free_at: new Date(soonest).toISOString(),
      retry_after_seconds: retryAfter,
    });
  });

  return app;
}
