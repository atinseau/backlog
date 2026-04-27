import fs from "node:fs";
import path from "node:path";

// Local-only credential store. Lives at .backlog/secrets.json and is gitignored
// by the init-layout template. Never log values.

export interface SecretsFile {
  version: 1;
  secrets: Record<string, string>;
}

function secretsPath(backlogDir: string): string {
  return path.join(backlogDir, "secrets.json");
}

function readFile(backlogDir: string): SecretsFile {
  const file = secretsPath(backlogDir);
  if (!fs.existsSync(file)) return { version: 1, secrets: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<SecretsFile>;
    if (parsed && typeof parsed === "object" && parsed.secrets && typeof parsed.secrets === "object") {
      return { version: 1, secrets: { ...parsed.secrets } };
    }
  } catch {
    // fallthrough to empty
  }
  return { version: 1, secrets: {} };
}

function writeFile(backlogDir: string, data: SecretsFile): void {
  const file = secretsPath(backlogDir);
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // best-effort on non-POSIX
  }
}

export function getSecret(backlogDir: string, key: string): string | null {
  const file = readFile(backlogDir);
  return file.secrets[key] ?? null;
}

export function hasSecret(backlogDir: string, key: string): boolean {
  return getSecret(backlogDir, key) !== null;
}

export function setSecret(backlogDir: string, key: string, value: string): void {
  const file = readFile(backlogDir);
  file.secrets[key] = value;
  writeFile(backlogDir, file);
}

export function deleteSecret(backlogDir: string, key: string): void {
  const file = readFile(backlogDir);
  if (!(key in file.secrets)) return;
  delete file.secrets[key];
  writeFile(backlogDir, file);
}

export function listSecretKeys(backlogDir: string): string[] {
  return Object.keys(readFile(backlogDir).secrets).sort();
}
