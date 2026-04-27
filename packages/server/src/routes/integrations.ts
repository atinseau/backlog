import { deleteSecret, getSecret, setSecret } from "@backlog/config";
import {
  addSource,
  cloneAndAddRepo,
  createTask,
  listSources,
  listTasks,
  removeSource,
} from "@backlog/core";
import {
  createConnector,
  listGithubRepos,
  testGithubToken,
  testJiraConnection,
  type GithubRepoSummary,
} from "@backlog/connectors";
import { git } from "@backlog/git";
import type { SourceConfig, Task } from "@backlog/schemas";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../project-resolver.js";

const GITHUB_TOKEN_KEY = "github.pat";

const githubPatSchema = z.object({ token: z.string().min(20) });
const githubCloneSchema = z.object({
  full_name: z.string().min(3),
  default_branch: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  use_ssh: z.boolean().optional(),
});

const jiraTestSchema = z.object({
  base_url: z.string().url(),
  email: z.string().email(),
  api_token: z.string().min(8),
});

const jiraSourceSchema = z.object({
  id: z.string().min(1),
  base_url: z.string().url(),
  email: z.string().email(),
  api_token: z.string().min(8),
  jql: z.string().optional(),
});

const githubSourceSchema = z.object({
  id: z.string().min(1),
  repo: z.string().min(3),
  labels: z.string().optional(),
  state: z.enum(["open", "closed", "all"]).optional(),
});

function jiraSecretKey(sourceId: string): string {
  return `jira.${sourceId}.api_token`;
}

function jiraEmailKey(sourceId: string): string {
  return `jira.${sourceId}.email`;
}

function tokenIsObvious(token: string): string {
  return token.length > 8 ? `${token.slice(0, 4)}…${token.slice(-4)}` : "***";
}

async function importPulledTasks(
  backlogDir: string,
  source: SourceConfig,
  pulled: Task[],
): Promise<{ created: number; skipped: number }> {
  const existing = listTasks(backlogDir);
  const seen = new Set<string>();
  for (const item of existing) {
    for (const link of item.source_links ?? []) {
      seen.add(`${link.kind}:${link.source_ref}:${link.external_id}`);
    }
  }
  let created = 0;
  let skipped = 0;
  for (const candidate of pulled) {
    const link = candidate.source_links?.[0];
    const key = link ? `${link.kind}:${link.source_ref}:${link.external_id}` : null;
    if (key && seen.has(key)) {
      skipped += 1;
      continue;
    }
    createTask(backlogDir, {
      title: candidate.title,
      ...(candidate.description ? { description: candidate.description } : {}),
      priority: candidate.priority,
      labels: candidate.labels,
      sourceLinks: candidate.source_links,
    });
    if (key) seen.add(key);
    created += 1;
  }
  return { created, skipped };
}

export function integrationsRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // GitHub --------------------------------------------------------------

  app.get("/integrations/github/status", (c) => {
    const project = c.get("workspace");
    const token = getSecret(project.backlogDir, GITHUB_TOKEN_KEY);
    return c.json({
      connected: token !== null,
      token_hint: token ? tokenIsObvious(token) : null,
    });
  });

  app.post("/integrations/github/pat", async (c) => {
    const project = c.get("workspace");
    const raw = await c.req.json().catch(() => null);
    const parsed = githubPatSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    try {
      const user = await testGithubToken(parsed.data.token);
      setSecret(project.backlogDir, GITHUB_TOKEN_KEY, parsed.data.token);
      return c.json({ ok: true, login: user.login });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "github_token_invalid", detail: message }, 400);
    }
  });

  app.delete("/integrations/github/pat", (c) => {
    const project = c.get("workspace");
    deleteSecret(project.backlogDir, GITHUB_TOKEN_KEY);
    return c.json({ ok: true });
  });

  // GitHub Device Flow ---------------------------------------------------
  // Lets the user click "Connect" instead of pasting a PAT. Requires a
  // public GitHub OAuth App / GitHub App client_id; we never need a secret
  // because Device Flow is designed for native apps.

  app.get("/integrations/github/oauth/config", (c) => {
    const clientId = process.env.BACKLOG_GITHUB_CLIENT_ID ?? null;
    return c.json({
      device_flow_available: clientId !== null,
      pat_url: "https://github.com/settings/tokens/new?scopes=repo,read:user&description=Backlog%20Local",
    });
  });

  app.post("/integrations/github/oauth/start", async (c) => {
    const clientId = process.env.BACKLOG_GITHUB_CLIENT_ID;
    if (!clientId) {
      return c.json(
        { error: "device_flow_unavailable", detail: "Set BACKLOG_GITHUB_CLIENT_ID env to enable one-click GitHub auth." },
        400,
      );
    }
    const response = await fetch("https://github.com/login/device/code", {
      method: "POST",
      headers: { Accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ client_id: clientId, scope: "repo read:user" }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return c.json({ error: "device_start_failed", detail: detail.slice(0, 200) }, 502);
    }
    const data = (await response.json()) as {
      device_code: string;
      user_code: string;
      verification_uri: string;
      expires_in: number;
      interval: number;
    };
    return c.json({
      device_code: data.device_code,
      user_code: data.user_code,
      verification_uri: data.verification_uri,
      expires_in: data.expires_in,
      interval: data.interval,
    });
  });

  app.post("/integrations/github/oauth/poll", async (c) => {
    const clientId = process.env.BACKLOG_GITHUB_CLIENT_ID;
    if (!clientId) {
      return c.json({ error: "device_flow_unavailable" }, 400);
    }
    const raw = await c.req.json().catch(() => null);
    const parsed = z.object({ device_code: z.string().min(8) }).safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body" }, 400);
    }
    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        device_code: parsed.data.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });
    const json = (await response.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };
    if (json.access_token) {
      const project = c.get("workspace");
      try {
        const user = await testGithubToken(json.access_token);
        setSecret(project.backlogDir, GITHUB_TOKEN_KEY, json.access_token);
        return c.json({ status: "ok", login: user.login });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return c.json({ status: "verify_failed", detail: message }, 400);
      }
    }
    if (json.error === "authorization_pending" || json.error === "slow_down") {
      return c.json({ status: "pending", error: json.error });
    }
    return c.json(
      { status: "failed", error: json.error ?? "unknown", detail: json.error_description ?? null },
      400,
    );
  });

  app.get("/integrations/github/repos", async (c) => {
    const project = c.get("workspace");
    const token = getSecret(project.backlogDir, GITHUB_TOKEN_KEY);
    if (!token) {
      return c.json({ error: "github_not_connected", detail: "Set a PAT first." }, 400);
    }
    try {
      const repos = await listGithubRepos(token);
      const summary = repos.map((repo: GithubRepoSummary) => ({
        full_name: repo.full_name,
        description: repo.description,
        private: repo.private,
        default_branch: repo.default_branch,
        clone_url: repo.clone_url,
        ssh_url: repo.ssh_url,
        html_url: repo.html_url,
        pushed_at: repo.pushed_at,
      }));
      return c.json({ repos: summary });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "github_list_failed", detail: message }, 502);
    }
  });

  app.post("/integrations/github/clone", async (c) => {
    const project = c.get("workspace");
    const raw = await c.req.json().catch(() => null);
    const parsed = githubCloneSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    const token = getSecret(project.backlogDir, GITHUB_TOKEN_KEY);
    if (!token && !parsed.data.use_ssh) {
      return c.json({ error: "github_not_connected", detail: "Set a PAT first or use SSH." }, 400);
    }
    const fullName = parsed.data.full_name;
    const cleanUrl = parsed.data.use_ssh
      ? `git@github.com:${fullName}.git`
      : `https://github.com/${fullName}.git`;
    const cloneUrl = parsed.data.use_ssh
      ? cleanUrl
      : `https://x-access-token:${token}@github.com/${fullName}.git`;
    try {
      const cloneInput: Parameters<typeof cloneAndAddRepo>[1] = { url: cloneUrl };
      if (parsed.data.id) cloneInput.id = parsed.data.id;
      if (parsed.data.default_branch) cloneInput.defaultBranch = parsed.data.default_branch;
      const repo = await cloneAndAddRepo(project.backlogDir, cloneInput);
      // Strip the embedded token from the remote so it doesn't get persisted on disk.
      if (!parsed.data.use_ssh) {
        try {
          await git(["remote", "set-url", "origin", cleanUrl], repo.path);
        } catch {
          // best-effort
        }
      }
      return c.json({ repo, cloned: true }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "clone_failed", detail: message }, 400);
    }
  });

  // GitHub source (issues sync) -----------------------------------------

  app.post("/integrations/github/source", async (c) => {
    const project = c.get("workspace");
    const raw = await c.req.json().catch(() => null);
    const parsed = githubSourceSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    const token = getSecret(project.backlogDir, GITHUB_TOKEN_KEY);
    if (!token) {
      return c.json({ error: "github_not_connected", detail: "Set a PAT first." }, 400);
    }
    const tokenEnv = `BACKLOG_GITHUB_PAT_${parsed.data.id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
    process.env[tokenEnv] = token;
    try {
      const source: SourceConfig = {
        id: parsed.data.id,
        kind: "github",
        enabled: true,
        config: {
          repo: parsed.data.repo,
          ...(parsed.data.labels ? { labels: parsed.data.labels } : {}),
          state: parsed.data.state ?? "open",
        },
        auth: { strategy: "github_pat", refs: { token: tokenEnv } },
        mapping: {},
        sync: { pull: true, push_status: false, push_comments: false, source_of_truth: "external" },
      };
      addSource(project.backlogDir, source);
      return c.json({ source }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "source_create_failed", detail: message }, 400);
    }
  });

  // Jira ----------------------------------------------------------------

  app.post("/integrations/jira/test", async (c) => {
    const raw = await c.req.json().catch(() => null);
    const parsed = jiraTestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    try {
      const user = await testJiraConnection({
        baseUrl: parsed.data.base_url,
        email: parsed.data.email,
        apiToken: parsed.data.api_token,
      });
      return c.json({ ok: true, account_id: user.accountId, display_name: user.displayName });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "jira_test_failed", detail: message }, 400);
    }
  });

  app.post("/integrations/jira/source", async (c) => {
    const project = c.get("workspace");
    const raw = await c.req.json().catch(() => null);
    const parsed = jiraSourceSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    try {
      const sourceId = parsed.data.id;
      const tokenKey = jiraSecretKey(sourceId);
      const emailKey = jiraEmailKey(sourceId);
      setSecret(project.backlogDir, tokenKey, parsed.data.api_token);
      setSecret(project.backlogDir, emailKey, parsed.data.email);
      const tokenEnv = `BACKLOG_JIRA_TOKEN_${sourceId.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
      const emailEnv = `BACKLOG_JIRA_EMAIL_${sourceId.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
      process.env[tokenEnv] = parsed.data.api_token;
      process.env[emailEnv] = parsed.data.email;
      const source: SourceConfig = {
        id: sourceId,
        kind: "jira",
        enabled: true,
        config: {
          base_url: parsed.data.base_url,
          jql: parsed.data.jql ?? "order by updated desc",
          page_size: 50,
        },
        auth: { strategy: "jira_basic", refs: { email: emailEnv, api_token: tokenEnv } },
        mapping: {},
        sync: { pull: true, push_status: false, push_comments: false, source_of_truth: "external" },
      };
      addSource(project.backlogDir, source);
      return c.json({ source }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "source_create_failed", detail: message }, 400);
    }
  });

  // Sources & sync ------------------------------------------------------

  app.get("/integrations/sources", (c) => {
    const project = c.get("workspace");
    const sources = listSources(project.backlogDir).map((source) => ({
      id: source.id,
      kind: source.kind,
      enabled: source.enabled,
      config: source.config,
    }));
    return c.json({ sources });
  });

  app.delete("/integrations/sources/:id", (c) => {
    const project = c.get("workspace");
    const id = c.req.param("id");
    try {
      removeSource(project.backlogDir, id);
      // best-effort secret cleanup
      deleteSecret(project.backlogDir, jiraSecretKey(id));
      deleteSecret(project.backlogDir, jiraEmailKey(id));
      return c.json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "source_remove_failed", detail: message }, 404);
    }
  });

  app.post("/integrations/sources/:id/sync", async (c) => {
    const project = c.get("workspace");
    const id = c.req.param("id");
    const sources = listSources(project.backlogDir);
    const source = sources.find((candidate) => candidate.id === id);
    if (!source) return c.json({ error: "unknown_source", id }, 404);

    // Re-hydrate env from secrets so the connector can find creds.
    if (source.kind === "jira") {
      const token = getSecret(project.backlogDir, jiraSecretKey(id));
      const email = getSecret(project.backlogDir, jiraEmailKey(id));
      const tokenEnv = source.auth.refs.api_token;
      const emailEnv = source.auth.refs.email;
      if (token && tokenEnv) process.env[tokenEnv] = token;
      if (email && emailEnv) process.env[emailEnv] = email;
    } else if (source.kind === "github") {
      const token = getSecret(project.backlogDir, GITHUB_TOKEN_KEY);
      const tokenEnv = source.auth.refs.token;
      if (token && tokenEnv) process.env[tokenEnv] = token;
    }

    try {
      const connector = createConnector(source, project.root);
      const pulled = await connector.pull();
      const result = await importPulledTasks(project.backlogDir, source, pulled);
      return c.json({
        source_id: id,
        pulled_total: pulled.length,
        created: result.created,
        skipped: result.skipped,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "sync_failed", detail: message }, 502);
    }
  });

  return app;
}
