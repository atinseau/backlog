import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { git } from "./git-client.js";
import { discoverRepoForWorkspace } from "./discover-repo.js";

async function createRepo(branch = "main"): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-repo-discovery-"));
  await git(["init", "-b", branch], root);
  fs.writeFileSync(path.join(root, "README.md"), "# cockpit\n", "utf8");
  await git(["add", "README.md"], root);
  await git(["-c", "user.name=Cockpit", "-c", "user.email=cockpit@example.com", "commit", "-m", "init"], root);
  return root;
}

describe("discoverRepoForWorkspace", () => {
  it("returns one repo config with a stable id and the current branch", async () => {
    const root = await createRepo("develop");
    const resolvedRoot = fs.realpathSync(root);
    const repos = await discoverRepoForWorkspace(root, "My Workspace");

    expect(repos).toHaveLength(1);
    expect(repos[0]).toMatchObject({
      id: "my-workspace",
      path: resolvedRoot,
      default_branch: "develop",
      enabled: true,
    });
  });

  it("returns an empty array outside a git repository", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-no-repo-"));
    const repos = await discoverRepoForWorkspace(root, "No Repo");
    expect(repos).toEqual([]);
  });
});
