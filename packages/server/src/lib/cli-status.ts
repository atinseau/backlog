import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { execa } from "execa";

export interface CliStatus {
  available: boolean;
  path: string | null;
  version: string | null;
  update_command: string;
  error?: string;
}

export interface CliUpdateResult {
  ok: boolean;
  command: string;
  manager_path: string | null;
  status: CliStatus;
  stdout?: string;
  stderr?: string;
  error?: string;
}

const CACHE_MS = 30_000;
const CLI_UPDATE_COMMAND = "npm install -g backlog";

let cached: { at: number; status: CliStatus } | null = null;

function withDefaults(status: Omit<CliStatus, "update_command"> & { update_command?: string }): CliStatus {
  return {
    ...status,
    update_command: status.update_command ?? CLI_UPDATE_COMMAND,
  };
}

function defaultShell(): string {
  if (process.env.SHELL) return process.env.SHELL;
  if (process.platform === "win32") return process.env.ComSpec ?? "cmd.exe";
  if (process.platform === "darwin") return "/bin/zsh";
  return "/bin/sh";
}

function parseVersion(value: string): string | null {
  return value.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/)?.[0] ?? null;
}

function looksLikeExecutablePath(value: string, command: string): boolean {
  const normalized = value.replaceAll("\\", "/").toLowerCase();
  const suffixes = process.platform === "win32"
    ? [`/${command}.cmd`, `/${command}.exe`, `/${command}`]
    : [`/${command}`];
  return suffixes.some((suffix) => normalized.endsWith(suffix));
}

function parseShellOutput(stdout: string): CliStatus {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const cliPath = lines.find((line) => looksLikeExecutablePath(line, "backlog")) ?? null;
  const version = parseVersion(lines.slice(1).join("\n")) ?? parseVersion(stdout);
  return withDefaults({
    available: Boolean(cliPath || version),
    path: cliPath,
    version,
  });
}

function candidateBinDirs(extra: string[] = []): string[] {
  const home = homedir();
  const envDirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const dirs = [
    ...extra,
    ...envDirs,
    join(home, ".npm-global", "bin"),
    join(home, ".npm-packages", "bin"),
    join(home, ".local", "bin"),
    join(home, "Library", "pnpm"),
    join(home, ".local", "share", "pnpm"),
    join(home, ".bun", "bin"),
    join(home, ".volta", "bin"),
    join(home, ".asdf", "shims"),
    join(home, ".mise", "shims"),
    join(home, ".local", "share", "mise", "shims"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ];
  const nvmVersions = join(home, ".nvm", "versions", "node");
  try {
    for (const version of readdirSync(nvmVersions)) {
      dirs.push(join(nvmVersions, version, "bin"));
    }
  } catch {
    // nvm is optional.
  }

  return [...new Set(dirs.filter(Boolean))];
}

function commandCandidates(command: string): string[] {
  const names = process.platform === "win32"
    ? [`${command}.cmd`, `${command}.exe`, command]
    : [command];
  const out: string[] = [];
  for (const dir of candidateBinDirs()) {
    for (const name of names) {
      const file = join(dir, name);
      if (existsSync(file)) out.push(file);
    }
  }
  return [...new Set(out)];
}

function envForCommand(extraDirs: string[] = []): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: candidateBinDirs(extraDirs).join(delimiter),
  };
}

async function runVersion(commandPath: string, pathForDisplay: string | null): Promise<CliStatus> {
  const result = await execa(commandPath, ["-v"], {
    reject: false,
    timeout: 2_000,
    env: envForCommand([dirname(commandPath)]),
  });
  if (result.exitCode !== 0) {
    return withDefaults({
      available: false,
      path: pathForDisplay,
      version: null,
      error: (result.stderr || result.stdout || `exit ${result.exitCode}`).trim(),
    });
  }
  return withDefaults({
    available: true,
    path: pathForDisplay,
    version: parseVersion(result.stdout),
  });
}

async function resolveViaCandidatePaths(): Promise<CliStatus> {
  for (const file of commandCandidates("backlog")) {
    const status = await runVersion(file, file).catch((error: unknown) => withDefaults({
      available: false,
      path: file,
      version: null,
      error: error instanceof Error ? error.message : String(error),
    }));
    if (status.available) return status;
  }
  return withDefaults({
    available: false,
    path: null,
    version: null,
    error: "backlog was not found in known terminal locations",
  });
}

async function resolveViaUserShell(mode: "interactive" | "login"): Promise<CliStatus> {
  const shell = defaultShell();
  const command = process.platform === "win32"
    ? "where backlog && backlog -v"
    : "command -v backlog && backlog -v";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", command]
    : [mode === "interactive" ? "-ic" : "-lc", command];
  const result = await execa(shell, args, {
    reject: false,
    timeout: 3_000,
    env: envForCommand(),
  });
  if (result.exitCode !== 0) {
    return withDefaults({
      available: false,
      path: null,
      version: null,
      error: (result.stderr || result.stdout || `exit ${result.exitCode}`).trim(),
    });
  }
  return parseShellOutput(result.stdout);
}

async function resolveDirectly(): Promise<CliStatus> {
  const result = await execa("backlog", ["-v"], {
    reject: false,
    timeout: 2_000,
    env: envForCommand(),
  });
  if (result.exitCode !== 0) {
    return withDefaults({
      available: false,
      path: null,
      version: null,
      error: (result.stderr || result.stdout || `exit ${result.exitCode}`).trim(),
    });
  }
  const cliPath = commandCandidates("backlog")[0] ?? null;
  return withDefaults({
    available: true,
    path: cliPath,
    version: parseVersion(result.stdout),
  });
}

async function resolveNpmPath(): Promise<string | null> {
  for (const file of commandCandidates("npm")) {
    const result = await execa(file, ["--version"], {
      reject: false,
      timeout: 2_000,
      env: envForCommand([dirname(file)]),
    });
    if (result.exitCode === 0) return file;
  }

  const shell = defaultShell();
  const result = await execa(shell, process.platform === "win32"
    ? ["/d", "/s", "/c", "where npm"]
    : ["-ic", "command -v npm"], {
    reject: false,
    timeout: 3_000,
    env: envForCommand(),
  });
  if (result.exitCode !== 0) return null;
  const npmPath = result.stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => looksLikeExecutablePath(line, "npm"));
  return npmPath ?? null;
}

export async function resolveCliStatus(opts: { force?: boolean } = {}): Promise<CliStatus> {
  const now = Date.now();
  if (!opts.force && cached && now - cached.at < CACHE_MS) return cached.status;

  let status = await resolveViaCandidatePaths().catch((error: unknown) => withDefaults({
    available: false,
    path: null,
    version: null,
    error: error instanceof Error ? error.message : String(error),
  }));

  if (!status.available) {
    status = await resolveViaUserShell("interactive").catch((error: unknown) => withDefaults({
      available: false,
      path: null,
      version: null,
      error: error instanceof Error ? error.message : String(error),
    }));
  }

  if (!status.available) {
    status = await resolveViaUserShell("login").catch((error: unknown) => withDefaults({
      available: false,
      path: null,
      version: null,
      error: error instanceof Error ? error.message : String(error),
    }));
  }

  if (!status.available) {
    status = await resolveDirectly().catch((error: unknown) => withDefaults({
      available: false,
      path: null,
      version: null,
      error: error instanceof Error ? error.message : String(error),
    }));
  }

  cached = { at: now, status };
  return status;
}

export async function updateCli(): Promise<CliUpdateResult> {
  const npmPath = await resolveNpmPath();
  if (!npmPath) {
    const status = await resolveCliStatus({ force: true });
    return {
      ok: false,
      command: CLI_UPDATE_COMMAND,
      manager_path: null,
      status,
      error: "npm was not found in known terminal locations",
    };
  }

  const result = await execa(npmPath, ["install", "-g", "backlog"], {
    reject: false,
    timeout: 180_000,
    env: envForCommand([dirname(npmPath)]),
  });
  cached = null;
  const status = await resolveCliStatus({ force: true });
  const updateResult: CliUpdateResult = {
    ok: result.exitCode === 0,
    command: CLI_UPDATE_COMMAND,
    manager_path: npmPath,
    status,
  };
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  if (stdout) updateResult.stdout = stdout;
  if (stderr) updateResult.stderr = stderr;
  if (result.exitCode !== 0) {
    updateResult.error = (result.stderr || result.stdout || `exit ${result.exitCode}`).trim();
  }
  return updateResult;
}
