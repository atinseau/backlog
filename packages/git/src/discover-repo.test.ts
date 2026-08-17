import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";
import { git } from "./git-client.js";
import { discoverRepoForProject } from "./discover-repo.js";

async function createRepo(branch = "main"): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-repo-discovery-"));
  await git(["init", "-b", branch], root);
  fs.writeFileSync(path.join(root, "README.md"), "# backlog\n", "utf8");
  await git(["add", "README.md"], root);
  await git(["-c", "user.name=Backlog", "-c", "user.email=backlog@example.com", "commit", "-m", "init"], root);
  return root;
}

describe("discoverRepoForProject", () => {
  it("returns one repo config with a stable id and the current branch", async () => {
    const root = await createRepo("develop");
    const resolvedRoot = fs.realpathSync(root);
    const repos = await discoverRepoForProject(root, "My Project");

    expect(repos).toHaveLength(1);
    expect(repos[0]).toMatchObject({
      id: "my-project",
      path: resolvedRoot,
      default_branch: "develop",
      enabled: true,
    });
  });

  it("returns a local workspace config outside a git repository", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-no-repo-"));
    const repos = await discoverRepoForProject(root, "No Repository");
    expect(repos).toEqual([
      {
        id: "no-repository",
        path: root,
        default_branch: "main",
        enabled: true,
        location: "local",
      },
    ]);
  });
});
