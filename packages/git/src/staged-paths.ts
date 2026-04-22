import { git } from "./git-client.js";

export async function stagedPaths(repoRoot: string): Promise<string[]> {
  const output = await git(
    ["diff", "--cached", "--name-only", "--diff-filter=ACMRD"],
    repoRoot,
  );
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
