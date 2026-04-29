import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readContextFile } from "@backlog/claims";
import { ensureProjectId, initLayout } from "@backlog/config";
import { detectGitDir, git } from "@backlog/git";
import type { ClaimRecord } from "@backlog/schemas";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { ServerProject } from "../project-context.js";
import type { AppEnv } from "../project-resolver.js";
import { claimsRoutes } from "./claims.js";

async function makeWorkspaceWithRepo(): Promise<{
  workspace: ServerProject;
  repoId: string;
  repoRoot: string;
}> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-claims-route-"));
  await git(["init"], root);
  fs.writeFileSync(path.join(root, "README.md"), "smoke\n", "utf8");
  await git(["add", "README.md"], root);
  // Inline identity per call so the test doesn't depend on global git
  // config — CI runners ship without user.name/user.email set.
  await git(
    ["-c", "user.name=Backlog", "-c", "user.email=backlog@example.com", "commit", "-m", "init"],
    root,
  );

  const repoId = path.basename(root);
  initLayout({
    root,
    projectName: "claims-route-test",
    repos: [{ id: repoId, path: root, default_branch: "main", enabled: true, access_mode: "read-write" }],
  });
  const backlogDir = path.join(root, ".backlog");
  return {
    workspace: {
      root,
      backlogDir,
      project_id: ensureProjectId(backlogDir),
      resolvedFrom: root,
    },
    repoId,
    repoRoot: root,
  };
}

function buildApp(workspace: ServerProject): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("workspace", workspace);
    await next();
  });
  app.route("/", claimsRoutes());
  return app;
}

describe("POST /claims", () => {
  it("writes the new claim id to .git/backlog-context.json", async () => {
    const { workspace, repoId, repoRoot } = await makeWorkspaceWithRepo();
    const app = buildApp(workspace);

    const res = await app.request("/claims", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repo: repoId,
        topic: "round-trip",
        paths: ["README.md"],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { claim: ClaimRecord };

    const gitDir = await detectGitDir(repoRoot);
    const context = readContextFile(gitDir);
    expect(context).not.toBeNull();
    expect(context?.claim_id).toBe(body.claim.id);
    expect(context?.version).toBe(1);
  });

  it("overwrites a stale context file with the new claim id", async () => {
    const { workspace, repoId, repoRoot } = await makeWorkspaceWithRepo();
    const app = buildApp(workspace);

    const first = (await (await app.request("/claims", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: repoId, topic: "first", paths: ["a/**"] }),
    })).json()) as { claim: ClaimRecord };

    const second = (await (await app.request("/claims", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: repoId, topic: "second", paths: ["b/**"] }),
    })).json()) as { claim: ClaimRecord };

    expect(second.claim.id).not.toBe(first.claim.id);
    const context = readContextFile(await detectGitDir(repoRoot));
    expect(context?.claim_id).toBe(second.claim.id);
  });
});

describe("DELETE /claims/:id", () => {
  it("clears the context file when archiving the active claim", async () => {
    const { workspace, repoId, repoRoot } = await makeWorkspaceWithRepo();
    const app = buildApp(workspace);

    const created = (await (await app.request("/claims", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: repoId, topic: "to-archive", paths: ["README.md"] }),
    })).json()) as { claim: ClaimRecord };

    const gitDir = await detectGitDir(repoRoot);
    expect(readContextFile(gitDir)?.claim_id).toBe(created.claim.id);

    const del = await app.request(`/claims/${created.claim.id}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    expect(readContextFile(gitDir)).toBeNull();
  });

  it("leaves the context file alone when the archived claim is not the active one", async () => {
    const { workspace, repoId, repoRoot } = await makeWorkspaceWithRepo();
    const app = buildApp(workspace);

    const stale = (await (await app.request("/claims", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: repoId, topic: "stale", paths: ["a/**"] }),
    })).json()) as { claim: ClaimRecord };

    const fresh = (await (await app.request("/claims", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: repoId, topic: "fresh", paths: ["b/**"] }),
    })).json()) as { claim: ClaimRecord };

    const del = await app.request(`/claims/${stale.claim.id}`, { method: "DELETE" });
    expect(del.status).toBe(200);

    const context = readContextFile(await detectGitDir(repoRoot));
    expect(context?.claim_id).toBe(fresh.claim.id);
  });
});
