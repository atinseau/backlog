import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import crypto from "node:crypto";
import {
  _internalKeyFilePath,
  deleteSecret,
  getSecret,
  hasSecret,
  listSecretKeys,
  reEncryptSecrets,
  setSecret,
} from "./secrets.js";

let savedHome: string | undefined;
let backlogDir: string;

beforeEach(() => {
  savedHome = process.env.HOME;
  // Pin HOME to a sandbox so the symmetric key lives in a temp dir, not
  // ~/.backlog/.secrets-key.
  process.env.HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "backlog-secrets-home-")));
  backlogDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "backlog-secrets-ws-")));
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
});

describe("setSecret / getSecret round-trip", () => {
  it("encrypts on disk and decrypts on read", () => {
    setSecret(backlogDir, "github_token", "ghp_supersecret");
    expect(getSecret(backlogDir, "github_token")).toBe("ghp_supersecret");

    const raw = JSON.parse(fs.readFileSync(path.join(backlogDir, "secrets.json"), "utf8")) as {
      version: number;
      secrets: Record<string, unknown>;
    };
    expect(raw.version).toBe(2);
    // Plaintext value MUST NOT appear anywhere on disk.
    expect(JSON.stringify(raw)).not.toContain("ghp_supersecret");
    // Encrypted entry has the expected shape.
    expect(raw.secrets.github_token).toMatchObject({
      iv: expect.any(String),
      ct: expect.any(String),
      tag: expect.any(String),
    });
  });

  it("creates the per-machine key file at ~/.backlog/.secrets-key with mode 600", () => {
    setSecret(backlogDir, "any", "value");
    const keyPath = _internalKeyFilePath();
    expect(fs.existsSync(keyPath)).toBe(true);
    const stat = fs.statSync(keyPath);
    expect(stat.size).toBe(32);
    // POSIX-only permission check.
    if (process.platform !== "win32") {
      expect(stat.mode & 0o777).toBe(0o600);
    }
  });
});

describe("hasSecret / listSecretKeys / deleteSecret", () => {
  it("hasSecret reports presence; deleteSecret removes; list returns sorted keys", () => {
    setSecret(backlogDir, "alpha", "a");
    setSecret(backlogDir, "charlie", "c");
    setSecret(backlogDir, "bravo", "b");
    expect(listSecretKeys(backlogDir)).toEqual(["alpha", "bravo", "charlie"]);

    expect(hasSecret(backlogDir, "alpha")).toBe(true);
    expect(hasSecret(backlogDir, "missing")).toBe(false);

    deleteSecret(backlogDir, "alpha");
    expect(hasSecret(backlogDir, "alpha")).toBe(false);
    expect(listSecretKeys(backlogDir)).toEqual(["bravo", "charlie"]);
  });
});

describe("auto-upgrade from v1 plaintext", () => {
  it("reads a legacy v1 file unchanged and re-emits v2 on the next write", () => {
    fs.writeFileSync(
      path.join(backlogDir, "secrets.json"),
      JSON.stringify({ version: 1, secrets: { legacy: "still here" } }, null, 2),
      "utf8",
    );

    expect(getSecret(backlogDir, "legacy")).toBe("still here");

    // Trigger a write — adds a new secret. Existing legacy values are
    // pulled into the v2 envelope (they survive the upgrade).
    setSecret(backlogDir, "fresh", "new value");

    const raw = JSON.parse(fs.readFileSync(path.join(backlogDir, "secrets.json"), "utf8")) as {
      version: number;
    };
    expect(raw.version).toBe(2);

    // Both keys readable through the encrypted layer.
    expect(getSecret(backlogDir, "legacy")).toBe("still here");
    expect(getSecret(backlogDir, "fresh")).toBe("new value");
  });
});

describe("reEncryptSecrets", () => {
  it("decrypts with the source key and re-encrypts with the local key", () => {
    // Stash a secret using the local key.
    setSecret(backlogDir, "imported", "cherished value");
    // Capture the local key bytes (this is what would be on the SOURCE
    // machine in the real workflow).
    const sourceKey = fs.readFileSync(_internalKeyFilePath());

    // Simulate a fresh machine: rotate HOME so a brand-new key gets
    // generated when we call reEncryptSecrets.
    process.env.HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "backlog-rekey-newhome-")));

    // Re-encrypt with the original key as source. The function reads
    // the file (still encrypted with sourceKey), decrypts using
    // sourceKey, encrypts with the new local key.
    const result = reEncryptSecrets(backlogDir, sourceKey);
    expect(result.succeeded).toEqual(["imported"]);
    expect(result.failed).toEqual([]);
    expect(getSecret(backlogDir, "imported")).toBe("cherished value");
  });

  it("drops secrets that don't decrypt with the supplied source key", () => {
    setSecret(backlogDir, "good", "live value");

    process.env.HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "backlog-rekey-bad-")));

    // Wrong key — random 32 bytes, won't decrypt.
    const wrongKey = crypto.randomBytes(32);
    const result = reEncryptSecrets(backlogDir, wrongKey);
    expect(result.succeeded).toEqual([]);
    expect(result.failed).toEqual(["good"]);
    // The secret was dropped from the file.
    expect(hasSecret(backlogDir, "good")).toBe(false);
  });

  it("handles a v1 plaintext file by writing v2 with the local key (fromKey ignored)", () => {
    fs.writeFileSync(
      path.join(backlogDir, "secrets.json"),
      JSON.stringify({ version: 1, secrets: { legacy: "hi" } }, null, 2),
      "utf8",
    );

    const result = reEncryptSecrets(backlogDir, crypto.randomBytes(32));
    expect(result.succeeded).toEqual(["legacy"]);
    expect(result.failed).toEqual([]);
    expect(getSecret(backlogDir, "legacy")).toBe("hi");
    const raw = JSON.parse(fs.readFileSync(path.join(backlogDir, "secrets.json"), "utf8"));
    expect(raw.version).toBe(2);
  });
});

describe("tamper resistance", () => {
  it("returns null for a value whose ciphertext was tampered with", () => {
    setSecret(backlogDir, "good", "original");
    const raw = JSON.parse(fs.readFileSync(path.join(backlogDir, "secrets.json"), "utf8")) as {
      version: number;
      secrets: Record<string, { iv: string; ct: string; tag: string }>;
    };
    // Flip a bit in the ciphertext.
    const ct = Buffer.from(raw.secrets.good!.ct, "base64");
    ct[0] = ct[0]! ^ 0xff;
    raw.secrets.good!.ct = ct.toString("base64");
    fs.writeFileSync(path.join(backlogDir, "secrets.json"), JSON.stringify(raw, null, 2), "utf8");

    // Decrypt fails the auth tag — the secret is dropped, not surfaced.
    expect(getSecret(backlogDir, "good")).toBeNull();
  });
});
