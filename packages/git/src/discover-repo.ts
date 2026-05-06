import path from "node:path";
import type { RepoConfig } from "@backlog/schemas";
import { detectRepoRoot } from "./detect-repo-root.js";
import { repoCurrentBranch } from "./repo-metadata.js";

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export async function discoverRepoForProject(root: string, projectName: string): Promise<RepoConfig[]> {
  const fallbackId = slugify(projectName) || slugify(path.basename(root)) || "workspace";
  try {
    const repoRoot = await detectRepoRoot(root);
    let defaultBranch = "main";
    try {
      const currentBranch = await repoCurrentBranch(repoRoot);
      if (currentBranch && currentBranch !== "HEAD") {
        defaultBranch = currentBranch;
      }
    } catch {
      // Fall back to main when branch discovery fails.
    }

    return [
      {
        id: fallbackId,
        path: repoRoot,
        default_branch: defaultBranch,
        enabled: true,
        location: "local",
      },
    ];
  } catch {
    return [
      {
        id: fallbackId,
        path: root,
        default_branch: "main",
        enabled: true,
        location: "local",
      },
    ];
  }
}

/** @deprecated Use discoverRepoForProject. */
export const discoverRepoForWorkspace = discoverRepoForProject;
