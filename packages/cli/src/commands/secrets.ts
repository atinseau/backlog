import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
  accountSecretsFilePath,
  deleteAccountSecret,
  deleteProjectSecret,
  describeSecretScope,
  findProject,
  getAccountSecret,
  getProjectSecret,
  hasAccountSecret,
  hasProjectSecret,
  listAccountSecretKeys,
  listSecretKeys,
  projectSecretsPath,
  reEncryptAccountSecrets,
  reEncryptSecrets,
  setAccountSecret,
  setProjectSecret,
} from "@backlog/config";

// `backlog secrets` defaults to the account scope (~/.backlog/secrets.json)
// because for 99 % of users a single OPENAI_API_KEY / ANTHROPIC_API_KEY
// covers every project. Pass --project to scope to the current
// project's .backlog/secrets.json (which overrides the account
// value at lookup time, useful when a contractor wants a different
// API tier for one client).

interface ScopeFlag {
  project?: boolean;
}

function projectBacklogDir(): string {
  const ws = findProject();
  if (!ws) throw new Error("No .backlog project found. Run `backlog init` first, or drop --project to use the account scope.");
  return ws.backlogDir;
}

function readStdinLine(): Promise<string> {
  return new Promise<string>((resolve) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buf += chunk;
    });
    process.stdin.on("end", () => resolve(buf.trim()));
  });
}

export function registerSecretsCommand(program: Command): void {
  const secrets = program
    .command("secrets")
    .description(
      "Manage encrypted secrets. Defaults to the account scope " +
        "(~/.backlog/secrets.json) — pass --project for the current project's " +
        "scope (which overrides the account value).",
    );

  secrets
    .command("list")
    .description("List stored secret keys (values are never printed)")
    .option("--project", "List the current project's secrets instead of the account default")
    .option("--all", "Show both scopes side-by-side, with the resolved provenance")
    .action((options: ScopeFlag & { all?: boolean }) => {
      if (options.all) {
        const account = listAccountSecretKeys();
        const ws = findProject();
        const project = ws ? listSecretKeys(ws.backlogDir) : [];
        const seen = new Set<string>([...account, ...project]);
        if (seen.size === 0) {
          console.log("(no secrets stored)");
          return;
        }
        const sorted = [...seen].sort();
        const longest = sorted.reduce((m, k) => Math.max(m, k.length), 0);
        for (const k of sorted) {
          const inProject = project.includes(k);
          const inAccount = account.includes(k);
          const tag = inProject && inAccount
            ? "project (overrides account)"
            : inProject
              ? "project"
              : "account";
          console.log(`${k.padEnd(longest + 2)}${tag}`);
        }
        return;
      }

      const keys = options.project
        ? listSecretKeys(projectBacklogDir())
        : listAccountSecretKeys();
      if (keys.length === 0) {
        const where = options.project ? "this project" : "the account";
        console.log(`(no secrets stored at ${where})`);
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
    .option("--project", "Set in the current project scope instead of the account default")
    .action(async (rawKey: string, positionalValue: string | undefined, options: ScopeFlag & { value?: string }) => {
      let key = rawKey;
      let value: string | undefined;

      const eqIndex = rawKey.indexOf("=");
      if (eqIndex > 0) {
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
        value = await readStdinLine();
      }
      if (!key) throw new Error("Secret key cannot be empty.");
      if (!value) throw new Error("Refusing to store an empty secret.");

      if (options.project) {
        setProjectSecret(projectBacklogDir(), key, value);
        console.log(`Stored ${key} in this project (overrides any account value).`);
      } else {
        setAccountSecret(key, value);
        console.log(`Stored ${key} at the account scope (~/.backlog/secrets.json).`);
      }
    });

  secrets
    .command("get")
    .description("Print a secret's resolved value to stdout (project override → account → null)")
    .argument("<key>", "Secret key")
    .option("--project", "Read strictly from the project scope (don't fall back to account)")
    .option("--account", "Read strictly from the account scope")
    .action((key: string, options: ScopeFlag & { account?: boolean }) => {
      let value: string | null;
      if (options.project) {
        value = getProjectSecret(projectBacklogDir(), key);
      } else if (options.account) {
        value = getAccountSecret(key);
      } else {
        // Default: chain. If we're inside a project, project takes
        // precedence over account; otherwise just account.
        const ws = findProject();
        if (ws) {
          value = getProjectSecret(ws.backlogDir, key) ?? getAccountSecret(key);
        } else {
          value = getAccountSecret(key);
        }
      }
      if (value === null) {
        throw new Error(`No secret named "${key}".`);
      }
      process.stdout.write(value);
    });

  secrets
    .command("remove")
    .description("Delete a stored secret")
    .argument("<key>", "Secret key")
    .option("--project", "Remove from the project scope (default: account)")
    .action((key: string, options: ScopeFlag) => {
      if (options.project) {
        const dir = projectBacklogDir();
        if (!hasProjectSecret(dir, key)) {
          console.log(`No project secret named "${key}" — nothing to remove.`);
          return;
        }
        deleteProjectSecret(dir, key);
        console.log(`Removed ${key} from this project.`);
        return;
      }
      if (!hasAccountSecret(key)) {
        console.log(`No account secret named "${key}" — nothing to remove.`);
        return;
      }
      deleteAccountSecret(key);
      console.log(`Removed ${key} from the account scope.`);
    });

  // Lift a project secret to the account scope. Useful for users
  // upgrading from <1.4 who already have OPENAI_API_KEY etc. set
  // per-project and want to share it across every project.
  secrets
    .command("promote")
    .description("Copy a secret from the current project's scope to the account scope (and optionally drop it from the project)")
    .argument("<key>", "Secret key to promote")
    .option("--keep", "Leave the project copy in place (becomes an explicit override)")
    .action((key: string, options: { keep?: boolean }) => {
      const dir = projectBacklogDir();
      const value = getProjectSecret(dir, key);
      if (value === null) {
        throw new Error(`No project secret named "${key}".`);
      }
      setAccountSecret(key, value);
      if (!options.keep) {
        deleteProjectSecret(dir, key);
        console.log(`Promoted ${key} to the account scope; project copy removed.`);
      } else {
        console.log(`Promoted ${key} to the account scope; project copy kept (acts as an override now).`);
      }
    });

  // Inverse: pull an account secret down into the current project
  // and (optionally) remove it from the account.
  secrets
    .command("demote")
    .description("Copy an account secret into the current project's scope (and optionally drop it from the account)")
    .argument("<key>", "Secret key to demote")
    .option("--keep", "Leave the account copy in place")
    .action((key: string, options: { keep?: boolean }) => {
      const value = getAccountSecret(key);
      if (value === null) {
        throw new Error(`No account secret named "${key}".`);
      }
      setProjectSecret(projectBacklogDir(), key, value);
      if (!options.keep) {
        deleteAccountSecret(key);
        console.log(`Demoted ${key} into this project; account copy removed.`);
      } else {
        console.log(`Demoted ${key} into this project; account copy kept.`);
      }
    });

  secrets
    .command("where")
    .description("Show which scope (and file path) currently provides each known secret key")
    .action(() => {
      const accountPath = accountSecretsFilePath();
      const ws = findProject();
      const projectPath = ws ? projectSecretsPath(ws.backlogDir) : null;
      const accountKeys = listAccountSecretKeys();
      const projectKeys = ws ? listSecretKeys(ws.backlogDir) : [];
      const all = [...new Set([...accountKeys, ...projectKeys])].sort();
      if (all.length === 0) {
        console.log("(no secrets stored)");
        return;
      }
      const longest = all.reduce((m, k) => Math.max(m, k.length), 0);
      for (const k of all) {
        const scope = ws ? describeSecretScope(ws.backlogDir, k) : (accountKeys.includes(k) ? "account" : null);
        const where = scope === "project" ? projectPath : scope === "account" ? accountPath : "?";
        console.log(`${k.padEnd(longest + 2)}${scope}  ${where ?? ""}`);
      }
    });

  secrets
    .command("re-key")
    .description("Re-encrypt every stored secret with this machine's current key (use after `project import` from another machine)")
    .requiredOption("--from-key <path>", "Path to the source machine's ~/.backlog/.secrets-key file")
    .option("--scope <scope>", "Which scope to re-key: 'project' (default), 'account', or 'both'", "project")
    .action((options: { fromKey: string; scope: string }) => {
      const fromKeyPath = path.resolve(options.fromKey);
      if (!fs.existsSync(fromKeyPath)) {
        throw new Error(`Source key not found: ${fromKeyPath}`);
      }
      const fromKey = fs.readFileSync(fromKeyPath);
      if (fromKey.length !== 32) {
        throw new Error(`Source key at ${fromKeyPath} is ${fromKey.length} bytes; expected 32. Wrong file?`);
      }

      const targets: Array<"project" | "account"> = options.scope === "both"
        ? ["project", "account"]
        : options.scope === "account"
          ? ["account"]
          : ["project"];

      for (const scope of targets) {
        const result = scope === "account"
          ? reEncryptAccountSecrets(fromKey)
          : reEncryptSecrets(projectBacklogDir(), fromKey);
        console.log(`[${scope}] re-keyed ${result.succeeded.length} secret(s).`);
        for (const k of result.succeeded) console.log(`  ✓ ${k}`);
        if (result.failed.length > 0) {
          console.log(`  Failed (${result.failed.length}, ciphertext dropped):`);
          for (const k of result.failed) console.log(`  ✗ ${k}`);
        }
      }
    });
}
