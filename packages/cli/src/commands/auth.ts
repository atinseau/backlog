import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Command } from "commander";

const REFS_DIR = join(homedir(), ".backlog", "refs");
const TOKEN_PATH = join(REFS_DIR, "token");
const USER_PATH = join(REFS_DIR, "user");

function defaultApiUrl(): string {
  return process.env.BACKLOG_API_URL ?? "http://127.0.0.1:3002";
}

function readFileSafe(path: string): string | null {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return null;
  }
}

function writeFileEnsuring(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, "utf8");
}

function clearFile(path: string): void {
  try {
    writeFileSync(path, "", "utf8");
  } catch {
    /* ignore */
  }
}

interface AuthResponse {
  user: { id: number; email: string; username?: string };
  token: string;
  expires_at: string;
}

async function postJson<T>(url: string, body: unknown): Promise<{ data?: T; error?: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      return { error: text || res.statusText };
    }
    return { data: (await res.json()) as T };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function getJson<T>(url: string, token: string): Promise<{ data?: T; error?: string }> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const text = await res.text();
      return { error: text || res.statusText };
    }
    return { data: (await res.json()) as T };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function promptInput(question: string, hide = false): Promise<string> {
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  if (hide) {
    process.stdout.write(question);
    rl.close();
    return new Promise((resolve) => {
      let answer = "";
      const onData = (data: Buffer) => {
        const chunk = data.toString("utf8");
        for (const ch of chunk) {
          if (ch === "\r" || ch === "\n") {
            process.stdin.removeListener("data", onData);
            process.stdin.pause();
            process.stdout.write("\n");
            resolve(answer);
            return;
          }
          if (ch === "") {
            process.exit(130);
          }
          if (ch === "") {
            answer = answer.slice(0, -1);
          } else {
            answer += ch;
          }
        }
      };
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on("data", onData);
    });
  }
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

export function registerAuthCommand(program: Command): void {
  const auth = program.command("auth").description("Manage Backlog authentication");

  auth
    .command("status")
    .description("Show current login status")
    .action(() => {
      const token = readFileSafe(TOKEN_PATH);
      const user = readFileSafe(USER_PATH);
      const url = defaultApiUrl();
      if (token && user) {
        console.log(`Logged in as ${user} on ${url}`);
      } else {
        console.log(`Not logged in. Run 'backlog auth login' against ${url} to sign in.`);
      }
    });

  auth
    .command("signup")
    .description("Create a Backlog account on the configured server")
    .action(async () => {
      const url = defaultApiUrl();
      const email = await promptInput("Email: ");
      const password = await promptInput("Password: ", true);
      const result = await postJson<AuthResponse>(`${url}/api/v1/auth/signup`, {
        email,
        password,
      });
      if (!result.data || result.error) {
        console.error(`Signup failed: ${result.error ?? "unknown error"}`);
        process.exit(1);
      }
      writeFileEnsuring(TOKEN_PATH, result.data.token);
      writeFileEnsuring(USER_PATH, result.data.user.email);
      console.log(`Signed up as ${result.data.user.email}.`);
    });

  auth
    .command("login")
    .description("Sign in to the configured Backlog server")
    .action(async () => {
      const url = defaultApiUrl();
      const email = await promptInput("Email: ");
      const password = await promptInput("Password: ", true);
      const result = await postJson<AuthResponse>(`${url}/api/v1/auth/login`, {
        email,
        password,
      });
      if (!result.data || result.error) {
        console.error(`Login failed: ${result.error ?? "unknown error"}`);
        process.exit(1);
      }
      writeFileEnsuring(TOKEN_PATH, result.data.token);
      writeFileEnsuring(USER_PATH, result.data.user.email);
      console.log(`Logged in as ${result.data.user.email}.`);
    });

  auth
    .command("logout")
    .description("Sign out from the configured Backlog server")
    .action(async () => {
      const url = defaultApiUrl();
      const token = readFileSafe(TOKEN_PATH);
      if (!token) {
        console.log("Not logged in.");
        return;
      }
      try {
        await fetch(`${url}/api/v1/auth/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        /* network failures still clear local creds */
      }
      clearFile(TOKEN_PATH);
      clearFile(USER_PATH);
      console.log("Logged out.");
    });

  auth
    .command("whoami")
    .description("Print the current user as the server sees it")
    .action(async () => {
      const url = defaultApiUrl();
      const token = readFileSafe(TOKEN_PATH);
      if (!token) {
        console.error("Not logged in.");
        process.exit(1);
      }
      const result = await getJson<{ user: { id: number; email: string } }>(
        `${url}/api/v1/auth/me`,
        token,
      );
      if (!result.data || result.error) {
        console.error(`whoami failed: ${result.error ?? "unknown error"}`);
        process.exit(1);
      }
      console.log(JSON.stringify(result.data.user, null, 2));
    });
}
