import { git } from "./git-client.js";

export async function repoHeadSha(repoRoot: string): Promise<string> {
  return git(["rev-parse", "--short", "HEAD"], repoRoot);
}

export async function repoCurrentBranch(repoRoot: string): Promise<string> {
  return git(["rev-parse", "--abbrev-ref", "HEAD"], repoRoot);
}

export async function repoCurrentTag(repoRoot: string): Promise<string | null> {
  try {
    return await git(["describe", "--tags", "--abbrev=0"], repoRoot);
  } catch {
    return null;
  }
}
