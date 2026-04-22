import path from "node:path";
import { git } from "./git-client.js";

export async function detectGitDir(repoRoot: string): Promise<string> {
  const output = await git(["rev-parse", "--git-dir"], repoRoot);
  return path.isAbsolute(output) ? output : path.join(repoRoot, output);
}
