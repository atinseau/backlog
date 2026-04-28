import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
  deleteSecret,
  findProject,
  getSecret,
  hasSecret,
  listSecretKeys,
  reEncryptSecrets,
  setSecret,
} from "@backlog/config";

function projectBacklogDir(): string {
  const ws = findProject();
  if (!ws) throw new Error("No .backlog project found. Run `backlog init` first.");
  return ws.backlogDir;
}

export function registerSecretsCommand(program: Command): void {
  const secrets = program
    .command("secrets")
    .description("Manage encrypted secrets stored at <workspace>/secrets.json");

  secrets
    .command("list")
    .description("List the keys of all stored secrets (values are never printed)")
    .action(() => {
      const keys = listSecretKeys(projectBacklogDir());
      if (keys.length === 0) {
        console.log("(no secrets stored)");
        return;
      }
      for (const k of keys) console.log(k);
    });

  secrets
    .command("set")
    .description(
      "Store or overwrite a secret value. Accepts: `set KEY=VALUE`, `set KEY VALUE`, `set KEY --value VALUE`, or `set KEY` reading one line from stdin.",
    )
    .argument("<key>", "Secret key (or KEY=VALUE shorthand)")
    .argument("[value]", "Secret value")
    .option("--value <value>", "Value to store. If omitted, reads from stdin (one line).")
    .action(async (rawKey: string, positionalValue: string | undefined, options: { value?: string }) => {
      // Three input shapes — picked in priority order, with conflicts as
      // hard errors so a user who pasted a literal "KEY=VALUE" *and*
      // also supplied --value doesn't get a silent surprise about which
      // wins.
      let key = rawKey;
      let value: string | undefined;

      const eqIndex = rawKey.indexOf("=");
      if (eqIndex > 0) {
        // KEY=VALUE shorthand. Anything after the first `=` is the
        // value verbatim — including additional `=` characters that
        // commonly appear in base64-encoded tokens.
        key = rawKey.slice(0, eqIndex);
        value = rawKey.slice(eqIndex + 1);
        if (positionalValue !== undefined || options.value !== undefined) {
          throw new Error(
            `Ambiguous: '${rawKey}' already contains '=value'. Drop the positional argument or --value flag.`,
          );
        }
      } else if (positionalValue !== undefined) {
        if (options.value !== undefined) {
          throw new Error("Ambiguous: pass the value either positionally or as --value, not both.");
        }
        value = positionalValue;
      } else if (options.value !== undefined) {
        value = options.value;
      } else {
        // Last resort: stdin. Trimmed so a trailing newline from `echo`
        // doesn't end up encrypted into the secret.
        value = await new Promise<string>((resolve) => {
          let buf = "";
          process.stdin.setEncoding("utf8");
          process.stdin.on("data", (chunk) => {
            buf += chunk;
          });
          process.stdin.on("end", () => resolve(buf.trim()));
        });
      }
      if (!key) throw new Error("Secret key cannot be empty.");
      if (!value) throw new Error("Refusing to store an empty secret.");
      setSecret(projectBacklogDir(), key, value);
      console.log(`Stored ${key}.`);
    });

  secrets
    .command("get")
    .description("Print a secret's value to stdout (use only when piping, not for logs)")
    .argument("<key>", "Secret key")
    .action((key: string) => {
      const dir = projectBacklogDir();
      if (!hasSecret(dir, key)) {
        throw new Error(`No secret named "${key}".`);
      }
      const value = getSecret(dir, key);
      if (value === null) {
        throw new Error(`Failed to decrypt "${key}". The local secrets key may have changed — try \`backlog secrets re-key\`.`);
      }
      process.stdout.write(value);
    });

  secrets
    .command("remove")
    .description("Delete a stored secret")
    .argument("<key>", "Secret key")
    .action((key: string) => {
      const dir = projectBacklogDir();
      if (!hasSecret(dir, key)) {
        console.log(`No secret named "${key}" — nothing to remove.`);
        return;
      }
      deleteSecret(dir, key);
      console.log(`Removed ${key}.`);
    });

  secrets
    .command("re-key")
    .description("Re-encrypt every stored secret with this machine's current key (use after `project import` from another machine)")
    .requiredOption("--from-key <path>", "Path to the source machine's ~/.backlog/.secrets-key file")
    .action((options: { fromKey: string }) => {
      const fromKeyPath = path.resolve(options.fromKey);
      if (!fs.existsSync(fromKeyPath)) {
        throw new Error(`Source key not found: ${fromKeyPath}`);
      }
      const fromKey = fs.readFileSync(fromKeyPath);
      if (fromKey.length !== 32) {
        throw new Error(
          `Source key at ${fromKeyPath} is ${fromKey.length} bytes; expected 32. Wrong file?`,
        );
      }
      const result = reEncryptSecrets(projectBacklogDir(), fromKey);
      console.log(`Re-keyed ${result.succeeded.length} secret(s).`);
      for (const k of result.succeeded) console.log(`  ✓ ${k}`);
      if (result.failed.length > 0) {
        console.log("");
        console.log(`Failed to decrypt ${result.failed.length} secret(s) — they were dropped:`);
        for (const k of result.failed) console.log(`  ✗ ${k}`);
        console.log("");
        console.log("Likely cause: the --from-key file doesn't match the key that originally encrypted these values.");
      }
    });
}
