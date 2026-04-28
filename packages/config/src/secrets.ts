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

function readFile(backlogDir: string): SecretsFile {
  const file = secretsPath(backlogDir);
  if (!fs.existsSync(file)) return { version: 2, secrets: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
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

function writeFile(backlogDir: string, data: SecretsFileV2): void {
  const file = secretsPath(backlogDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // best-effort on non-POSIX
  }
}

// Read the file and return a flat plaintext view. Decrypts v2; passes
// through v1 (legacy plaintext store).
function readPlaintext(backlogDir: string): Record<string, string> {
  const file = readFile(backlogDir);
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

function writePlaintext(backlogDir: string, plaintext: Record<string, string>): void {
  const key = getOrCreateKey();
  const encrypted: Record<string, EncryptedValue> = {};
  for (const [k, v] of Object.entries(plaintext)) {
    encrypted[k] = encrypt(v, key);
  }
  writeFile(backlogDir, { version: 2, secrets: encrypted });
}

export function getSecret(backlogDir: string, key: string): string | null {
  return readPlaintext(backlogDir)[key] ?? null;
}

export function hasSecret(backlogDir: string, key: string): boolean {
  return getSecret(backlogDir, key) !== null;
}

export function setSecret(backlogDir: string, key: string, value: string): void {
  const plaintext = readPlaintext(backlogDir);
  plaintext[key] = value;
  writePlaintext(backlogDir, plaintext);
}

export function deleteSecret(backlogDir: string, key: string): void {
  const plaintext = readPlaintext(backlogDir);
  if (!(key in plaintext)) return;
  delete plaintext[key];
  writePlaintext(backlogDir, plaintext);
}

export function listSecretKeys(backlogDir: string): string[] {
  return Object.keys(readPlaintext(backlogDir)).sort();
}

// Test hook: the symmetric key file lives at ~/.backlog/.secrets-key by
// default. Tests override with HOME pointing at a sandbox.
export function _internalKeyFilePath(): string {
  return keyFilePath();
}
