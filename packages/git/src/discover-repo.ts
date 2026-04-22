import path from "node:path";
import type { RepoConfig } from "@cockpit-ai/schemas";
import { detectRepoRoot } from "./detect-repo-root.js";
import { repoCurrentBranch } from "./repo-metadata.js";

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export async function discoverRepoForWorkspace(root: string, workspaceName: string): Promise<RepoConfig[]> {
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
        id: slugify(workspaceName) || path.basename(repoRoot),
        path: repoRoot,
        default_branch: defaultBranch,
        enabled: true,
      },
    ];
  } catch {
    return [];
  }
}
