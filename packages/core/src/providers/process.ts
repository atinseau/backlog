import fs from "node:fs";
import path from "node:path";
import { execa } from "execa";

// Process plumbing shared by every CLI-backed provider: where to find the
// binary, how to spawn it while streaming stdout line by line, and how to
// describe a non-zero exit in one human-readable phrase.

function commonExecutableDirs(): string[] {
  const home = process.env.HOME;
  return [
    ...(process.env.PATH ?? "").split(path.delimiter).filter(Boolean),
    ...(home
      ? [path.join(home, ".local", "bin"), path.join(home, "bin"), path.join(home, ".npm-global", "bin")]
      : []),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ];
}

/** PATH widened with the usual install locations, since a server started from
 * launchd/systemd inherits a much thinner PATH than an interactive shell. */
export function expandedPath(): string {
  return Array.from(new Set(commonExecutableDirs())).join(path.delimiter);
}

function executableCandidates(command: string): string[] {
  if (command.includes("/") || command.includes(path.sep)) return [command];
  return commonExecutableDirs().map((dir) => path.join(dir, command));
}

function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveExecutable(command: string): string {
  if (command.trim().includes(" ")) return command;
  return executableCandidates(command).find(isExecutable) ?? command;
}

export function executableExists(command: string): boolean {
  return executableCandidates(command).some(isExecutable);
}

export interface StreamingSpawnInput {
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Written to the child's stdin, then closed. */
  input?: string | undefined;
  /** Called for each complete stdout line as it arrives. */
  onLine?: ((line: string) => void) | undefined;
}

export interface StreamingSpawnResult {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
}

/**
 * Spawn a provider CLI and surface its stdout in real time. The full stdout
 * is still buffered and returned, because usage totals only appear at the end.
 */
export async function spawnStreaming(input: StreamingSpawnInput): Promise<StreamingSpawnResult> {
  const subprocess = execa(input.executable, input.args, {
    cwd: input.cwd,
    env: input.env,
    ...(input.input !== undefined ? { input: input.input } : {}),
    reject: false,
  });

  let stdout = "";
  let pending = "";

  subprocess.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    stdout += text;
    if (!input.onLine) return;
    pending += text;
    let newline: number;
    while ((newline = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      input.onLine(line);
    }
  });

  const result = await subprocess;
  if (input.onLine && pending.trim()) {
    input.onLine(pending);
  }

  return {
    exitCode: result.exitCode ?? null,
    signal: result.signal ?? null,
    stdout,
    stderr: result.stderr,
  };
}

export function describeProcessFailure(result: Pick<StreamingSpawnResult, "exitCode" | "signal" | "stdout" | "stderr">): string {
  if (typeof result.exitCode === "number") return `exit code ${result.exitCode}`;
  if (result.signal) return `signal ${result.signal}`;
  if (`${result.stderr}${result.stdout}`.trim()) return "non-zero exit";
  return "no exit status or output";
}
