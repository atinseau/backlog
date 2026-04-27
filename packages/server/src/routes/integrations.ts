import { randomUUID } from "node:crypto";
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
const GITHUB_CLIENT_ID_KEY = "github.oauth.client_id";
const JIRA_CLIENT_ID_KEY = "jira.oauth.client_id";
const JIRA_CLIENT_SECRET_KEY = "jira.oauth.client_secret";
const JIRA_ACCESS_TOKEN_KEY = "jira.oauth.access_token";
const JIRA_REFRESH_TOKEN_KEY = "jira.oauth.refresh_token";
const JIRA_CLOUD_ID_KEY = "jira.oauth.cloud_id";
const JIRA_SITE_URL_KEY = "jira.oauth.site_url";

// Public OAuth proxy hosted by backlog-cloud. Holds the GitHub and Jira
// OAuth secrets so the CLI doesn't have to ship them. Override with
// BACKLOG_CLOUD_URL when developing against a local Rails instance.
const BACKLOG_CLOUD_URL = process.env.BACKLOG_CLOUD_URL ?? "https://backlog.so";

// Cache the official GitHub client_id we fetch from backlog-cloud, so we
// don't hammer the proxy on every request.
let cloudGithubClientId: string | null | undefined = undefined;
async function fetchCloudGithubClientId(): Promise<string | null> {
  if (cloudGithubClientId !== undefined) return cloudGithubClientId;
  try {
    const response = await fetch(`${BACKLOG_CLOUD_URL}/api/v1/oauth/github/client_id`);
    if (!response.ok) {
      cloudGithubClientId = null;
      return null;
    }
    const json = (await response.json()) as { client_id?: string };
    cloudGithubClientId = json.client_id ?? null;
    return cloudGithubClientId;
  } catch {
    cloudGithubClientId = null;
    return null;
  }
}

// In-memory pending Jira OAuth flows keyed by state. Holds the verifier we'll
// need for the callback exchange. Cleared on completion or after 10 minutes.
interface PendingJiraFlow {
  state: string;
  redirect_uri: string;
  created_at: number;
  status: "pending" | "ok" | "failed";
  detail?: string;
  display_name?: string;
  cloud_id?: string;
  site_url?: string;
}
const pendingJiraFlows = new Map<string, PendingJiraFlow>();
function gcPendingJiraFlows() {
  const cutoff = Date.now() - 10 * 60_000;
  for (const [k, v] of pendingJiraFlows.entries()) {
    if (v.created_at < cutoff) pendingJiraFlows.delete(k);
  }
}

function callbackHtml(kind: "ok" | "error", detail: string): string {
  const safe = detail.replace(/[<>&]/g, "");
  const title = kind === "ok" ? "✓ Connecté" : "Erreur";
  const body = kind === "ok"
    ? `Connecté à Jira (${safe}). Vous pouvez fermer cet onglet.`
    : `Erreur : ${safe}`;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8" /><title>${title}</title>
  <style>body{font-family:-apple-system,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f7f8fa;color:#1d2939;}
  .box{background:white;padding:32px 40px;border-radius:8px;box-shadow:0 4px 12px rgba(16,24,40,0.08);max-width:420px;text-align:center;}
  h1{margin:0 0 8px;font-size:18px;color:${kind === "ok" ? "#027a48" : "#b42318"};}p{margin:0;font-size:14px;color:#475467;}</style>
  </head><body><div class="box"><h1>${title}</h1><p>${body}</p></div>
  <script>setTimeout(()=>window.close(),3000)</script></body></html>`;
}

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

  function resolveGithubClientId(backlogDir: string): string | null {
    return process.env.BACKLOG_GITHUB_CLIENT_ID ?? getSecret(backlogDir, GITHUB_CLIENT_ID_KEY);
  }

  // Resolution chain: env var → user-saved client_id → backlog-cloud default.
  // Returns the source so the UI can tell the user where it came from.
  async function resolveGithubClientIdWithFallback(
    backlogDir: string,
  ): Promise<{ id: string | null; source: "env" | "user" | "cloud" | null }> {
    if (process.env.BACKLOG_GITHUB_CLIENT_ID) {
      return { id: process.env.BACKLOG_GITHUB_CLIENT_ID, source: "env" };
    }
    const stored = getSecret(backlogDir, GITHUB_CLIENT_ID_KEY);
    if (stored) return { id: stored, source: "user" };
    const cloud = await fetchCloudGithubClientId();
    if (cloud) return { id: cloud, source: "cloud" };
    return { id: null, source: null };
  }

  app.get("/integrations/github/oauth/config", async (c) => {
    const project = c.get("workspace");
    const { id: clientId, source } = await resolveGithubClientIdWithFallback(project.backlogDir);
    return c.json({
      device_flow_available: clientId !== null,
      client_id_hint: clientId ? `${clientId.slice(0, 6)}…` : null,
      client_id_source: source,
      pat_url: "https://github.com/settings/tokens/new?scopes=repo,read:user&description=Backlog%20Local",
      register_url: "https://github.com/settings/applications/new",
    });
  });

  app.post("/integrations/github/oauth/client", async (c) => {
    const project = c.get("workspace");
    const raw = await c.req.json().catch(() => null);
    const parsed = z.object({ client_id: z.string().min(8) }).safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body" }, 400);
    }
    setSecret(project.backlogDir, GITHUB_CLIENT_ID_KEY, parsed.data.client_id.trim());
    return c.json({ ok: true });
  });

  app.delete("/integrations/github/oauth/client", (c) => {
    const project = c.get("workspace");
    deleteSecret(project.backlogDir, GITHUB_CLIENT_ID_KEY);
    return c.json({ ok: true });
  });

  app.post("/integrations/github/oauth/start", async (c) => {
    const project = c.get("workspace");
    const { id: clientId } = await resolveGithubClientIdWithFallback(project.backlogDir);
    if (!clientId) {
      return c.json(
        {
          error: "device_flow_unavailable",
          detail: "Configure a GitHub OAuth App client_id (env BACKLOG_GITHUB_CLIENT_ID or via the UI).",
        },
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
    const project = c.get("workspace");
    const { id: clientId } = await resolveGithubClientIdWithFallback(project.backlogDir);
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

  function resolveJiraClient(backlogDir: string): { id: string | null; secret: string | null } {
    return {
      id: process.env.BACKLOG_JIRA_CLIENT_ID ?? getSecret(backlogDir, JIRA_CLIENT_ID_KEY),
      secret: process.env.BACKLOG_JIRA_CLIENT_SECRET ?? getSecret(backlogDir, JIRA_CLIENT_SECRET_KEY),
    };
  }

  app.get("/integrations/jira/oauth/config", (c) => {
    const project = c.get("workspace");
    const { id, secret } = resolveJiraClient(project.backlogDir);
    const hasLocalCreds = id !== null && secret !== null;
    const accessToken = getSecret(project.backlogDir, JIRA_ACCESS_TOKEN_KEY);
    const siteUrl = getSecret(project.backlogDir, JIRA_SITE_URL_KEY);
    return c.json({
      // We always offer the connect button: the cloud proxy at backlog.so
      // serves as the default. BYO credentials win if configured locally.
      oauth_available: true,
      client_id_hint: id ? `${id.slice(0, 6)}…` : null,
      mode: hasLocalCreds ? "byo" : "cloud",
      cloud_url: BACKLOG_CLOUD_URL,
      register_url: "https://developer.atlassian.com/console/myapps/",
      scopes: "read:jira-work read:jira-user offline_access",
      connected: accessToken !== null,
      site_url: siteUrl,
    });
  });

  app.post("/integrations/jira/oauth/client", async (c) => {
    const project = c.get("workspace");
    const raw = await c.req.json().catch(() => null);
    const parsed = z
      .object({ client_id: z.string().min(8), client_secret: z.string().min(8) })
      .safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body" }, 400);
    }
    setSecret(project.backlogDir, JIRA_CLIENT_ID_KEY, parsed.data.client_id.trim());
    setSecret(project.backlogDir, JIRA_CLIENT_SECRET_KEY, parsed.data.client_secret.trim());
    return c.json({ ok: true });
  });

  app.delete("/integrations/jira/oauth/client", (c) => {
    const project = c.get("workspace");
    deleteSecret(project.backlogDir, JIRA_CLIENT_ID_KEY);
    deleteSecret(project.backlogDir, JIRA_CLIENT_SECRET_KEY);
    return c.json({ ok: true });
  });

  app.post("/integrations/jira/oauth/start", async (c) => {
    const project = c.get("workspace");
    const { id: clientId, secret: clientSecret } = resolveJiraClient(project.backlogDir);
    const requestUrl = new URL(c.req.url);

    // BYO mode — user pasted their own client_id + secret locally. Talk to
    // Atlassian directly with the local secret.
    if (clientId && clientSecret) {
      const redirectUri = `${requestUrl.origin}/api/v1/integrations/jira/oauth/callback`;
      const state = randomUUID();
      gcPendingJiraFlows();
      pendingJiraFlows.set(state, {
        state,
        redirect_uri: redirectUri,
        created_at: Date.now(),
        status: "pending",
      });
      const authorizeUrl = new URL("https://auth.atlassian.com/authorize");
      authorizeUrl.searchParams.set("audience", "api.atlassian.com");
      authorizeUrl.searchParams.set("client_id", clientId);
      authorizeUrl.searchParams.set("scope", "read:jira-work read:jira-user offline_access");
      authorizeUrl.searchParams.set("redirect_uri", redirectUri);
      authorizeUrl.searchParams.set("state", state);
      authorizeUrl.searchParams.set("response_type", "code");
      authorizeUrl.searchParams.set("prompt", "consent");
      return c.json({ authorize_url: authorizeUrl.toString(), state, mode: "byo" });
    }

    // Cloud mode (default) — backlog-cloud holds the OAuth secrets, talks to
    // Atlassian, and bounces the token back to us via local-callback.
    const localCallback = `${requestUrl.origin}/api/v1/integrations/jira/oauth/local-callback`;
    try {
      const proxyResponse = await fetch(`${BACKLOG_CLOUD_URL}/api/v1/oauth/jira/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ local_callback: localCallback }),
      });
      if (!proxyResponse.ok) {
        const detail = await proxyResponse.text().catch(() => "");
        return c.json(
          { error: "cloud_proxy_failed", detail: detail.slice(0, 200) },
          502,
        );
      }
      const data = (await proxyResponse.json()) as { authorize_url: string; state: string };
      // Track the state so the local-callback knows it's expected.
      gcPendingJiraFlows();
      pendingJiraFlows.set(data.state, {
        state: data.state,
        redirect_uri: localCallback,
        created_at: Date.now(),
        status: "pending",
      });
      return c.json({ authorize_url: data.authorize_url, state: data.state, mode: "cloud" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "cloud_proxy_unreachable", detail: message }, 502);
    }
  });

  // Receives the token bounced back by backlog-cloud after Atlassian auth.
  // The proxy redirects the browser here with status + token in the query.
  app.get("/integrations/jira/oauth/local-callback", (c) => {
    const status = c.req.query("status") ?? "failed";
    const state = c.req.query("state") ?? "";
    const flow = pendingJiraFlows.get(state);
    if (!flow) {
      return c.html(callbackHtml("error", "expired_state"));
    }
    if (status !== "ok") {
      flow.status = "failed";
      flow.detail = c.req.query("detail") ?? status;
      return c.html(callbackHtml("error", flow.detail));
    }
    const accessToken = c.req.query("access_token");
    const refreshToken = c.req.query("refresh_token");
    const cloudId = c.req.query("cloud_id");
    const siteUrl = c.req.query("site_url");
    const siteName = c.req.query("site_name");
    if (!accessToken || !cloudId) {
      flow.status = "failed";
      flow.detail = "missing_token_payload";
      return c.html(callbackHtml("error", flow.detail));
    }
    const project = c.get("workspace");
    setSecret(project.backlogDir, JIRA_ACCESS_TOKEN_KEY, accessToken);
    if (refreshToken) setSecret(project.backlogDir, JIRA_REFRESH_TOKEN_KEY, refreshToken);
    setSecret(project.backlogDir, JIRA_CLOUD_ID_KEY, cloudId);
    if (siteUrl) setSecret(project.backlogDir, JIRA_SITE_URL_KEY, siteUrl);
    flow.status = "ok";
    flow.cloud_id = cloudId;
    if (siteUrl) flow.site_url = siteUrl;
    if (siteName) flow.display_name = siteName;
    return c.html(callbackHtml("ok", siteName ?? siteUrl ?? "Jira"));
  });

  app.get("/integrations/jira/oauth/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const errorParam = c.req.query("error");
    if (!state) return c.html(callbackHtml("error", "missing_state"));
    const flow = pendingJiraFlows.get(state);
    if (!flow) return c.html(callbackHtml("error", "expired_state"));
    if (errorParam || !code) {
      flow.status = "failed";
      flow.detail = errorParam ?? "missing_code";
      return c.html(callbackHtml("error", flow.detail));
    }
    const project = c.get("workspace");
    const { id: clientId, secret: clientSecret } = resolveJiraClient(project.backlogDir);
    if (!clientId || !clientSecret) {
      flow.status = "failed";
      flow.detail = "client_credentials_missing";
      return c.html(callbackHtml("error", flow.detail));
    }
    try {
      const tokenResponse = await fetch("https://auth.atlassian.com/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: flow.redirect_uri,
        }),
      });
      if (!tokenResponse.ok) {
        const text = await tokenResponse.text().catch(() => "");
        flow.status = "failed";
        flow.detail = `token_exchange_failed: ${text.slice(0, 200)}`;
        return c.html(callbackHtml("error", flow.detail));
      }
      const tokenJson = (await tokenResponse.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };
      // Fetch accessible resources to learn the cloud_id and site URL.
      const resResp = await fetch("https://api.atlassian.com/oauth/token/accessible-resources", {
        headers: { Authorization: `Bearer ${tokenJson.access_token}` },
      });
      const resources = (await resResp.json()) as Array<{
        id: string;
        url: string;
        name: string;
      }>;
      const site = resources[0];
      if (!site) {
        flow.status = "failed";
        flow.detail = "no_accessible_jira_site";
        return c.html(callbackHtml("error", flow.detail));
      }
      // Persist token + cloud_id so the existing JiraConnector can use them.
      setSecret(project.backlogDir, "jira.oauth.access_token", tokenJson.access_token);
      if (tokenJson.refresh_token) {
        setSecret(project.backlogDir, "jira.oauth.refresh_token", tokenJson.refresh_token);
      }
      setSecret(project.backlogDir, "jira.oauth.cloud_id", site.id);
      setSecret(project.backlogDir, "jira.oauth.site_url", site.url);
      flow.status = "ok";
      flow.cloud_id = site.id;
      flow.site_url = site.url;
      flow.display_name = site.name;
      return c.html(callbackHtml("ok", site.name));
    } catch (error) {
      flow.status = "failed";
      flow.detail = error instanceof Error ? error.message : String(error);
      return c.html(callbackHtml("error", flow.detail));
    }
  });

  app.get("/integrations/jira/oauth/status", (c) => {
    const state = c.req.query("state");
    if (!state) return c.json({ status: "missing_state" }, 400);
    const flow = pendingJiraFlows.get(state);
    if (!flow) return c.json({ status: "expired" }, 404);
    if (flow.status === "ok") {
      pendingJiraFlows.delete(state);
      return c.json({
        status: "ok",
        display_name: flow.display_name,
        site_url: flow.site_url,
        cloud_id: flow.cloud_id,
      });
    }
    if (flow.status === "failed") {
      pendingJiraFlows.delete(state);
      return c.json({ status: "failed", detail: flow.detail });
    }
    return c.json({ status: "pending" });
  });

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
