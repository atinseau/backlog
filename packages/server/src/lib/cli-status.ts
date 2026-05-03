import { execa } from "execa";

export interface CliStatus {
  available: boolean;
  path: string | null;
  version: string | null;
  error?: string;
}

const CACHE_MS = 30_000;

let cached: { at: number; status: CliStatus } | null = null;

function defaultShell(): string {
  if (process.env.SHELL) return process.env.SHELL;
  if (process.platform === "win32") return process.env.ComSpec ?? "cmd.exe";
  if (process.platform === "darwin") return "/bin/zsh";
  return "/bin/sh";
}

function parseVersion(value: string): string | null {
  return value.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/)?.[0] ?? null;
}

function parseShellOutput(stdout: string): CliStatus {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const cliPath = lines[0] ?? null;
  const version = parseVersion(lines.slice(1).join("\n")) ?? parseVersion(stdout);
  return {
    available: Boolean(cliPath || version),
    path: cliPath,
    version,
  };
}

async function resolveViaUserShell(): Promise<CliStatus> {
  const shell = defaultShell();
  const command = process.platform === "win32"
    ? "where backlog && backlog -v"
    : "command -v backlog && backlog -v";
  const args = process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-lc", command];
  const result = await execa(shell, args, {
    reject: false,
    timeout: 3_000,
    env: process.env,
  });
  if (result.exitCode !== 0) {
    return {
      available: false,
      path: null,
      version: null,
      error: (result.stderr || result.stdout || `exit ${result.exitCode}`).trim(),
    };
  }
  return parseShellOutput(result.stdout);
}

async function resolveDirectly(): Promise<CliStatus> {
  const result = await execa("backlog", ["-v"], {
    reject: false,
    timeout: 2_000,
    env: process.env,
  });
  if (result.exitCode !== 0) {
    return {
      available: false,
      path: null,
      version: null,
      error: (result.stderr || result.stdout || `exit ${result.exitCode}`).trim(),
    };
  }
  return {
    available: true,
    path: null,
    version: parseVersion(result.stdout),
  };
}

export async function resolveCliStatus(): Promise<CliStatus> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) return cached.status;

  let status = await resolveViaUserShell().catch((error: unknown) => ({
    available: false,
    path: null,
    version: null,
    error: error instanceof Error ? error.message : String(error),
  }));

  if (!status.available) {
    status = await resolveDirectly().catch((error: unknown) => ({
      available: false,
      path: null,
      version: null,
      error: error instanceof Error ? error.message : String(error),
    }));
  }

  cached = { at: now, status };
  return status;
}
