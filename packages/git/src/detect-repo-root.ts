import { git } from "./git-client.js";

export async function detectRepoRoot(cwd = process.cwd()): Promise<string> {
  const output = await git(["rev-parse", "--show-toplevel"], cwd);
  if (!output) {
    throw new Error("Not inside a git repository");
  }
  return output;
}
