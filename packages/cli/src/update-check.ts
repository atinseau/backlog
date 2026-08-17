import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getBacklogUserDir } from "@backlog/config";
import { execa } from "execa";

interface UpdateCache {
  checked_at: number;
  latest_version?: string;
}

const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;
const CHECK_TIMEOUT_MS = 1_500;
const CACHE_FILE = join(getBacklogUserDir(), "cli-update-check.json");

// Releases are single self-contained binaries attached to GitHub Releases;
// install.sh picks the right asset for the host platform. Overridable so a
// clone under a different account can point the check at its own repo.
const REPO = process.env.BACKLOG_REPO ?? "atinseau/backlog";
const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const INSTALL_COMMAND = `curl -fsSL https://raw.githubusercontent.com/${REPO}/main/install.sh | bash`;

function parseVersion(value: string): [number, number, number] | null {
  const match = value.match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isNewerVersion(latest: string | undefined, current: string): boolean {
  if (!latest) return false;
  const next = parseVersion(latest);
  const now = parseVersion(current);
  if (!next || !now) return false;
  for (let i = 0; i < 3; i++) {
    if (next[i]! > now[i]!) return true;
    if (next[i]! < now[i]!) return false;
  }
  return false;
}

async function readCache(): Promise<UpdateCache | null> {
  try {
    return JSON.parse(await readFile(CACHE_FILE, "utf8")) as UpdateCache;
  } catch {
    return null;
  }
}

async function writeCache(cache: UpdateCache): Promise<void> {
  try {
    await mkdir(getBacklogUserDir(), { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2), "utf8");
  } catch {
    // Update checks should never make the CLI command fail.
  }
}

async function fetchLatestVersion(): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const response = await fetch(LATEST_RELEASE_API, {
      headers: { accept: "application/vnd.github+json" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const json = (await response.json()) as { tag_name?: unknown };
    return typeof json.tag_name === "string" ? json.tag_name.replace(/^v/, "") : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function shouldSkipUpdateCheck(currentVersion: string, commandName: string | undefined): boolean {
  if (!process.stderr.isTTY) return true;
  if (process.env.CI || process.env.BACKLOG_SKIP_UPDATE_CHECK === "1") return true;
  if (currentVersion === "0.0.0-dev" || currentVersion.includes("-")) return true;
  return commandName === "update";
}

export async function maybeNotifyCliUpdate(currentVersion: string, commandName?: string): Promise<void> {
  if (shouldSkipUpdateCheck(currentVersion, commandName)) return;

  const now = Date.now();
  const cache = await readCache();
  let latest = cache?.latest_version;

  if (!cache || now - cache.checked_at > CHECK_INTERVAL_MS) {
    latest = await fetchLatestVersion() ?? latest;
    await writeCache({ checked_at: now, ...(latest ? { latest_version: latest } : {}) });
  }

  if (!isNewerVersion(latest, currentVersion)) return;

  console.error(
    [
      "",
      `Backlog ${latest} is available (installed: ${currentVersion}).`,
      `Update: ${INSTALL_COMMAND}`,
      "",
    ].join("\n"),
  );
}

export async function runCliUpdate(): Promise<void> {
  console.log(`Running: ${INSTALL_COMMAND}`);
  const result = await execa("bash", ["-c", INSTALL_COMMAND], {
    stdio: "inherit",
    reject: false,
  });
  if (result.exitCode !== 0) {
    throw new Error(`Update failed. Run manually: ${INSTALL_COMMAND}`);
  }
}
