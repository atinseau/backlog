import type { WorkspaceConfig } from "@cockpit-ai/schemas";
import { repoCurrentBranch, repoCurrentTag, repoHeadSha } from "@cockpit-ai/git";

export interface RepoSnapshot {
  repo: string;
  path: string;
  branch: string;
  head: string;
  tag: string | null;
}

export async function buildReleaseSnapshot(config: WorkspaceConfig): Promise<RepoSnapshot[]> {
  const snapshots: RepoSnapshot[] = [];
  for (const repo of config.repos.filter((candidate) => candidate.enabled)) {
    snapshots.push({
      repo: repo.id,
      path: repo.path,
      branch: await repoCurrentBranch(repo.path),
      head: await repoHeadSha(repo.path),
      tag: await repoCurrentTag(repo.path),
    });
  }
  return snapshots;
}
