import { execa } from "execa";

export async function git(args: string[], cwd: string): Promise<string> {
  const result = await execa("git", args, { cwd });
  return result.stdout.trimEnd();
}
