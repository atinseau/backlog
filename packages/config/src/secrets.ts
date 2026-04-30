import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Local-only credential store. Lives at .backlog/secrets.json. Values are
// encrypted at rest with AES-256-GCM keyed off a per-machine secret at
// ~/.backlog/.secrets-key (32 random bytes, mode 0600). Plaintext v1
// files are auto-upgraded on the next write.
//
// Threat model: protects against accidental disclosure when the workspace
// dir is synced (Dropbox, iCloud, a shared backup) or shoulder-surfed in
// `cat .backlog/secrets.json`. Does NOT protect against a local attacker
// who can read both the encrypted file and the .secrets-key file —
// they're on the same machine by design (no UI to enter a passphrase).

export interface SecretsFileV1 {
  version: 1;
  secrets: Record<string, string>;
}

interface EncryptedValue {
  iv: string; // base64
  ct: string; // base64 ciphertext
  tag: string; // base64 GCM auth tag
}

export interface SecretsFileV2 {
  version: 2;
  secrets: Record<string, EncryptedValue>;
}

type SecretsFile = SecretsFileV1 | SecretsFileV2;

const KEY_FILE_NAME = ".secrets-key";
const KEY_LENGTH_BYTES = 32; // AES-256
const IV_LENGTH_BYTES = 12; // GCM standard
const ALGO = "aes-256-gcm";

function secretsPath(backlogDir: string): string {
  return path.join(backlogDir, "secrets.json");
}

// Account-level secrets file. Lives at ~/.backlog/secrets.json so a
// single OPENAI_API_KEY / ANTHROPIC_API_KEY etc. follows the user
// across every project. Encrypted with the same per-machine key as
// the project files (~/.backlog/.secrets-key) so re-keying stays a
// single operation.
//
// Lookup chain: project secret first → account fallback → null.
// That way a project can override the account default by setting its
// own value (useful when a contractor wants a separate API tier for
// one client) without forcing every other project to re-set the
// same key.
function accountSecretsDir(): string {
  return path.join(os.homedir(), ".backlog");
}

function accountSecretsPath(): string {
  return path.join(accountSecretsDir(), "secrets.json");
}

// Resolve the symmetric key location. We deliberately keep it under
// ~/.backlog/ rather than next to the workspace's secrets.json — this
// way moving / syncing the workspace doesn't carry the key with the
// ciphertext, which was the whole point.
function keyFilePath(): string {
  return path.join(os.homedir(), ".backlog", KEY_FILE_NAME);
}

function getOrCreateKey(): Buffer {
  const filePath = keyFilePath();
  if (fs.existsSync(filePath)) {
    const buf = fs.readFileSync(filePath);
    if (buf.length === KEY_LENGTH_BYTES) return buf;
    // Corrupt key file — refuse to overwrite (would silently invalidate
    // every existing encrypted secret on disk). Surface the problem.
    throw new Error(
      `Invalid Backlog secrets key at ${filePath} (expected ${KEY_LENGTH_BYTES} bytes, got ${buf.length}). ` +
        `Either restore the original or delete the file AND every workspace's .backlog/secrets.json before retrying.`,
    );
  }
  const key = crypto.randomBytes(KEY_LENGTH_BYTES);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, key, { mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best-effort on non-POSIX
  }
  return key;
}

function encrypt(value: string, key: Buffer): EncryptedValue {
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString("base64"),
    ct: ct.toString("base64"),
    tag: tag.toString("base64"),
  };
}

function decrypt(payload: EncryptedValue, key: Buffer): string {
  const iv = Buffer.from(payload.iv, "base64");
  const ct = Buffer.from(payload.ct, "base64");
  const tag = Buffer.from(payload.tag, "base64");
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(ct), decipher.final()]);
  return out.toString("utf8");
}

function isEncryptedValue(value: unknown): value is EncryptedValue {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as EncryptedValue).iv === "string" &&
    typeof (value as EncryptedValue).ct === "string" &&
    typeof (value as EncryptedValue).tag === "string"
  );
}

function readFileAt(filePath: string): SecretsFile {
  if (!fs.existsSync(filePath)) return { version: 2, secrets: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
    const version = typeof parsed.version === "number" ? parsed.version : 1;
    const secrets = (parsed.secrets ?? {}) as Record<string, unknown>;
    if (version === 2) {
      const out: Record<string, EncryptedValue> = {};
      for (const [k, v] of Object.entries(secrets)) {
        if (isEncryptedValue(v)) out[k] = v;
      }
      return { version: 2, secrets: out };
    }
    // v1 (legacy plaintext): coerce.
    const plain: Record<string, string> = {};
    for (const [k, v] of Object.entries(secrets)) {
      if (typeof v === "string") plain[k] = v;
    }
    return { version: 1, secrets: plain };
  } catch {
    return { version: 2, secrets: {} };
  }
}

function writeFileAt(filePath: string, data: SecretsFileV2): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best-effort on non-POSIX
  }
}

// Read the file and return a flat plaintext view. Decrypts v2; passes
// through v1 (legacy plaintext store).
function readPlaintextAt(filePath: string): Record<string, string> {
  const file = readFileAt(filePath);
  if (file.version === 1) return { ...file.secrets };
  const key = getOrCreateKey();
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(file.secrets)) {
    try {
      out[k] = decrypt(v, key);
    } catch {
      // Skip values we can't decrypt (key mismatch, tampering). Don't
      // throw because that would brick `backlog doctor` etc.
    }
  }
  return out;
}

function writePlaintextAt(filePath: string, plaintext: Record<string, string>): void {
  const key = getOrCreateKey();
  const encrypted: Record<string, EncryptedValue> = {};
  for (const [k, v] of Object.entries(plaintext)) {
    encrypted[k] = encrypt(v, key);
  }
  writeFileAt(filePath, { version: 2, secrets: encrypted });
}

// ---------- Project-level (legacy single-scope API) ----------
// Lookup chain: getSecret returns the project value if set, otherwise
// the account fallback, otherwise null. This lets the existing
// callsites (executors, AI splitter, doctor) keep using getSecret
// unchanged and pick up the new account scope for free.

function readProjectPlaintext(backlogDir: string): Record<string, string> {
  return readPlaintextAt(secretsPath(backlogDir));
}

function writeProjectPlaintext(backlogDir: string, plaintext: Record<string, string>): void {
  writePlaintextAt(secretsPath(backlogDir), plaintext);
}

export function getSecret(backlogDir: string, key: string): string | null {
  const project = readProjectPlaintext(backlogDir)[key];
  if (project !== undefined) return project;
  const account = readPlaintextAt(accountSecretsPath())[key];
  return account ?? null;
}

export function hasSecret(backlogDir: string, key: string): boolean {
  return getSecret(backlogDir, key) !== null;
}

// Strictly project-scoped lookup, ignoring the account fallback.
// Useful when a tool wants to know whether the *project* has its own
// override (e.g. for a UI badge "this project uses a different key").
export function getProjectSecret(backlogDir: string, key: string): string | null {
  return readProjectPlaintext(backlogDir)[key] ?? null;
}

export function hasProjectSecret(backlogDir: string, key: string): boolean {
  return getProjectSecret(backlogDir, key) !== null;
}

// setSecret keeps writing to the project file — preserves backward
// compat for anything in the codebase that calls it. The CLI surface
// has been updated to default to the account scope; programmatic
// callers can pick scope explicitly via setProjectSecret /
// setAccountSecret.
export function setSecret(backlogDir: string, key: string, value: string): void {
  setProjectSecret(backlogDir, key, value);
}

export function setProjectSecret(backlogDir: string, key: string, value: string): void {
  const plaintext = readProjectPlaintext(backlogDir);
  plaintext[key] = value;
  writeProjectPlaintext(backlogDir, plaintext);
}

export function deleteSecret(backlogDir: string, key: string): void {
  deleteProjectSecret(backlogDir, key);
}

export function deleteProjectSecret(backlogDir: string, key: string): void {
  const plaintext = readProjectPlaintext(backlogDir);
  if (!(key in plaintext)) return;
  delete plaintext[key];
  writeProjectPlaintext(backlogDir, plaintext);
}

export function listSecretKeys(backlogDir: string): string[] {
  return Object.keys(readProjectPlaintext(backlogDir)).sort();
}

// ---------- Account-level (new in 1.4) ----------
// Single set of secrets shared across every project on this machine.
// Lives at ~/.backlog/secrets.json. The CLI defaults to this scope
// because for 99 % of users a single OPENAI_API_KEY / ANTHROPIC_API_KEY
// covers every project they own; per-project overrides are the
// exception.

export function getAccountSecret(key: string): string | null {
  return readPlaintextAt(accountSecretsPath())[key] ?? null;
}

export function hasAccountSecret(key: string): boolean {
  return getAccountSecret(key) !== null;
}

export function setAccountSecret(key: string, value: string): void {
  const plaintext = readPlaintextAt(accountSecretsPath());
  plaintext[key] = value;
  writePlaintextAt(accountSecretsPath(), plaintext);
}

export function deleteAccountSecret(key: string): void {
  const plaintext = readPlaintextAt(accountSecretsPath());
  if (!(key in plaintext)) return;
  delete plaintext[key];
  writePlaintextAt(accountSecretsPath(), plaintext);
}

export function listAccountSecretKeys(): string[] {
  return Object.keys(readPlaintextAt(accountSecretsPath())).sort();
}

// ---------- Helpers ----------

// Where each scope's secrets live on disk. Surfaced for `backlog
// doctor` and `backlog secrets list` UIs that want to print the
// resolved path so the user can debug.
export function projectSecretsPath(backlogDir: string): string {
  return secretsPath(backlogDir);
}

export function accountSecretsFilePath(): string {
  return accountSecretsPath();
}

// Resolve which scope provided a given key. Useful for the CLI's
// `secrets list --resolved` mode that wants to show "OPENAI_API_KEY
// (account)" vs "ANTHROPIC_API_KEY (project override)".
export function describeSecretScope(
  backlogDir: string,
  key: string,
): "project" | "account" | null {
  if (key in readProjectPlaintext(backlogDir)) return "project";
  if (key in readPlaintextAt(accountSecretsPath())) return "account";
  return null;
}

// Test hook: the symmetric key file lives at ~/.backlog/.secrets-key by
// default. Tests override with HOME pointing at a sandbox.
export function _internalKeyFilePath(): string {
  return keyFilePath();
}

// Re-encrypt every secret with the local machine's current key,
// using `fromKey` to decrypt the source ciphertext. The use case is
// `backlog project import` from another machine — the imported
// secrets.json was encrypted with that machine's key, which doesn't
// match this machine's local one.
//
// Returns the list of keys that round-tripped successfully and the
// list that failed (typically: wrong fromKey or tampered ciphertext).
// Failed keys are removed from the file rather than kept as
// undecryptable garbage.
export interface ReKeyResult {
  succeeded: string[];
  failed: string[];
}

export function reEncryptSecrets(backlogDir: string, fromKey: Buffer): ReKeyResult {
  return reEncryptAt(secretsPath(backlogDir), fromKey);
}

// Same flow but for the account-level secrets file. Used by `backlog
// secrets re-key --scope account` after copying ~/.backlog/secrets.json
// from another machine alongside its .secrets-key.
export function reEncryptAccountSecrets(fromKey: Buffer): ReKeyResult {
  return reEncryptAt(accountSecretsPath(), fromKey);
}

function reEncryptAt(filePath: string, fromKey: Buffer): ReKeyResult {
  const file = readFileAt(filePath);
  if (file.version === 1) {
    writePlaintextAt(filePath, file.secrets);
    return { succeeded: Object.keys(file.secrets), failed: [] };
  }

  const localKey = getOrCreateKey();
  const reEncrypted: Record<string, EncryptedValue> = {};
  const succeeded: string[] = [];
  const failed: string[] = [];
  for (const [k, v] of Object.entries(file.secrets)) {
    try {
      const plaintext = decrypt(v, fromKey);
      reEncrypted[k] = encrypt(plaintext, localKey);
      succeeded.push(k);
    } catch {
      failed.push(k);
    }
  }
  writeFileAt(filePath, { version: 2, secrets: reEncrypted });
  return { succeeded, failed };
}
