import fs from "node:fs";
import path from "node:path";
import type { SourceConfig, Task } from "@backlog/schemas";
import { nextId } from "@backlog/config";

export interface SourceConnector {
  validate(): Promise<{ ok: boolean; details: string[] }>;
  pull(): Promise<Task[]>;
  push?(update: ExternalUpdate): Promise<void>;
}

export interface ExternalUpdate {
  externalId: string;
  status?: Task["status"];
  comment?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeImportedId(backlogDir: string): string {
  return nextId(backlogDir, "task");
}

function parsePriority(value: string | undefined): Task["priority"] {
  switch ((value ?? "").trim().toUpperCase()) {
    case "P0":
    case "CRITICAL":
    case "HIGHEST":
      return "P0";
    case "P1":
    case "HIGH":
      return "P1";
    case "P3":
    case "LOW":
      return "P3";
    default:
      return "P2";
  }
}

function parseStatus(value: string | undefined): Task["status"] {
  switch ((value ?? "").trim().toLowerCase()) {
    case "ready":
      return "ready";
    case "in progress":
    case "in_progress":
      return "in_progress";
    case "review":
      return "review";
    case "test":
      return "test";
    case "released":
      return "released";
    case "done":
      return "done";
    case "blocked":
      return "blocked";
    default:
      return "backlog";
  }
}

function baseImportedTask(
  source: SourceConfig,
  externalId: string,
  title: string,
  backlogDir: string,
): Task {
  const now = nowIso();
  return {
    id: makeImportedId(backlogDir),
    title,
    source_links: [
      {
        kind: source.kind,
        source_ref: source.id,
        external_id: externalId,
      },
    ],
    status: "backlog",
    priority: "P2",
    labels: [],
    repo_targets: [],
    acceptance_criteria: [],
    dependencies: [],
    planning: {
      split_status: "pending",
      risk: "medium",
    },
    execution_defaults: {
      manual_approval_required: false,
      auto_commit: true,
      push_when_done: true,
      create_pr: false,
      merge_pr: false,
      worktree_mode: "isolated_worktree",
      preferred_agents: [],
    },
    sync: {
      source_of_truth: source.sync.source_of_truth,
      push_status: source.sync.push_status,
      push_comments: source.sync.push_comments,
    },
    created_at: now,
    updated_at: now,
  };
}

class MarkdownConnector implements SourceConnector {
  constructor(
    private readonly source: SourceConfig,
    private readonly projectRoot: string,
    private readonly backlogDir: string,
  ) {}

  async validate() {
    const filePath = this.resolvePath();
    return {
      ok: fs.existsSync(filePath),
      details: [filePath],
    };
  }

  async pull(): Promise<Task[]> {
    const filePath = this.resolvePath();
    const lines = fs.readFileSync(filePath, "utf8").split("\n");
    const items: Task[] = [];

    for (const [index, line] of lines.entries()) {
      const match = line.match(/^\s*[-*]\s+(?:\[[ xX]\]\s+)?(.+?)\s*$/);
      if (!match) {
        continue;
      }
      const item = baseImportedTask(this.source, `line-${index + 1}`, match[1]!.trim(), this.backlogDir);
      items.push(item);
    }

    return items;
  }

  private resolvePath(): string {
    const rawPath = String(this.source.config.path ?? "");
    return path.isAbsolute(rawPath) ? rawPath : path.join(this.projectRoot, rawPath);
  }
}

class CsvConnector implements SourceConnector {
  constructor(
    private readonly source: SourceConfig,
    private readonly projectRoot: string,
    private readonly backlogDir: string,
  ) {}

  async validate() {
    const filePath = this.resolvePath();
    return {
      ok: fs.existsSync(filePath),
      details: [filePath],
    };
  }

  async pull(): Promise<Task[]> {
    const filePath = this.resolvePath();
    const [headerLine, ...rows] = fs.readFileSync(filePath, "utf8").split("\n").filter(Boolean);
    if (!headerLine) {
      return [];
    }
    const headers = headerLine.split(",").map((value) => value.trim());
    const items: Task[] = [];

    for (const [index, row] of rows.entries()) {
      const values = row.split(",").map((value) => value.trim());
      const record = Object.fromEntries(headers.map((header, i) => [header, values[i] ?? ""]));
      const title = record.title || record.Title || `CSV row ${index + 1}`;
      const externalId = record.id || record.ID || `row-${index + 1}`;
      const item = baseImportedTask(this.source, externalId, title, this.backlogDir);
      if (record.description || record.Description) {
        item.description = record.description || record.Description;
      }
      item.priority = parsePriority(record.priority || record.Priority);
      item.status = parseStatus(record.status || record.Status);
      if (record.labels || record.Labels) {
        item.labels = String(record.labels || record.Labels)
          .split(/[|;]/)
          .map((value) => value.trim())
          .filter(Boolean);
      }
      items.push(item);
    }

    return items;
  }

  private resolvePath(): string {
    const rawPath = String(this.source.config.path ?? "");
    return path.isAbsolute(rawPath) ? rawPath : path.join(this.projectRoot, rawPath);
  }
}

class JiraConnector implements SourceConnector {
  constructor(
    private readonly source: SourceConfig,
    private readonly backlogDir: string,
  ) {}

  async validate() {
    const baseUrl = String(this.source.config.base_url ?? "");
    const emailEnv = String(this.source.auth.refs.email ?? "");
    const tokenEnv = String(this.source.auth.refs.api_token ?? "");
    const ok = Boolean(baseUrl && process.env[emailEnv] && process.env[tokenEnv]);
    return {
      ok,
      details: [baseUrl || "<missing base_url>", emailEnv || "<missing email env>", tokenEnv || "<missing token env>"],
    };
  }

  async pull(): Promise<Task[]> {
    const baseUrl = String(this.source.config.base_url ?? "");
    const jql = String(this.source.config.jql ?? "order by updated desc");
    const pageSize = Number(this.source.config.page_size ?? 50);
    const email = process.env[String(this.source.auth.refs.email ?? "")];
    const apiToken = process.env[String(this.source.auth.refs.api_token ?? "")];
    if (!baseUrl || !email || !apiToken) {
      throw new Error(`Source ${this.source.id} is missing Jira auth or base_url.`);
    }

    const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
    const url = new URL("/rest/api/3/search/jql", baseUrl);
    url.searchParams.set("jql", jql);
    url.searchParams.set("maxResults", String(pageSize));
    url.searchParams.set("fields", "summary,description,labels,priority,status");

    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      throw new Error(`Jira sync failed for ${this.source.id}: ${response.status} ${response.statusText}`);
    }

    const payload = await response.json() as {
      issues?: Array<{
        key: string;
        self?: string;
        fields?: {
          summary?: string;
          description?: unknown;
          labels?: string[];
          priority?: { name?: string };
          status?: { name?: string };
        };
      }>;
    };

    return (payload.issues ?? []).map((issue) => {
      const title = issue.fields?.summary ?? issue.key;
      const item = baseImportedTask(this.source, issue.key, title, this.backlogDir);
      item.priority = parsePriority(issue.fields?.priority?.name);
      item.status = parseStatus(issue.fields?.status?.name);
      item.labels = issue.fields?.labels ?? [];
      item.source_links[0]!.url = issue.self;
      return item;
    });
  }

  async push(update: ExternalUpdate): Promise<void> {
    const baseUrl = String(this.source.config.base_url ?? "");
    const email = process.env[String(this.source.auth.refs.email ?? "")];
    const apiToken = process.env[String(this.source.auth.refs.api_token ?? "")];
    if (!baseUrl || !email || !apiToken) {
      throw new Error(`Source ${this.source.id} is missing Jira auth or base_url.`);
    }

    const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
    const headers = {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    };

    if (update.status) {
      const targetStatusName = mapBacklogStatusToJiraStatus(update.status);
      if (targetStatusName) {
        const transitionsUrl = new URL(`/rest/api/3/issue/${update.externalId}/transitions`, baseUrl);
        const transitionsResponse = await fetch(transitionsUrl, { headers });
        if (!transitionsResponse.ok) {
          throw new Error(`Failed to load Jira transitions for ${update.externalId}: ${transitionsResponse.status} ${transitionsResponse.statusText}`);
        }
        const transitionsPayload = await transitionsResponse.json() as {
          transitions?: Array<{ id: string; name?: string; to?: { name?: string } }>;
        };
        const transition = (transitionsPayload.transitions ?? []).find((candidate) =>
          candidate.to?.name === targetStatusName || candidate.name === targetStatusName,
        );
        if (transition) {
          const response = await fetch(transitionsUrl, {
            method: "POST",
            headers,
            body: JSON.stringify({
              transition: { id: transition.id },
            }),
          });
          if (!response.ok && response.status !== 204) {
            throw new Error(`Failed to transition Jira issue ${update.externalId}: ${response.status} ${response.statusText}`);
          }
        }
      }
    }

    if (update.comment) {
      const commentUrl = new URL(`/rest/api/3/issue/${update.externalId}/comment`, baseUrl);
      const response = await fetch(commentUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          body: {
            type: "doc",
            version: 1,
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: update.comment,
                  },
                ],
              },
            ],
          },
        }),
      });
      if (!response.ok) {
        throw new Error(`Failed to comment on Jira issue ${update.externalId}: ${response.status} ${response.statusText}`);
      }
    }
  }
}

class GithubConnector implements SourceConnector {
  constructor(
    private readonly source: SourceConfig,
    private readonly backlogDir: string,
  ) {}

  async validate() {
    const repo = String(this.source.config.repo ?? "");
    const tokenEnv = String(this.source.auth.refs.token ?? "");
    const token = tokenEnv ? process.env[tokenEnv] : undefined;
    return {
      ok: Boolean(repo && token),
      details: [repo || "<missing repo>", tokenEnv || "<missing token env>"],
    };
  }

  async pull(): Promise<Task[]> {
    const repo = String(this.source.config.repo ?? "");
    const labels = String(this.source.config.labels ?? "");
    const state = String(this.source.config.state ?? "open");
    const tokenEnv = String(this.source.auth.refs.token ?? "");
    const token = tokenEnv ? process.env[tokenEnv] : undefined;
    if (!repo || !token) {
      throw new Error(`Source ${this.source.id} is missing GitHub repo or token.`);
    }
    const url = new URL(`https://api.github.com/repos/${repo}/issues`);
    url.searchParams.set("state", state);
    url.searchParams.set("per_page", "100");
    if (labels) url.searchParams.set("labels", labels);
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok) {
      throw new Error(`GitHub sync failed for ${this.source.id}: ${response.status} ${response.statusText}`);
    }
    const issues = (await response.json()) as Array<{
      number: number;
      title: string;
      body?: string | null;
      state: string;
      labels?: Array<{ name: string } | string>;
      pull_request?: unknown;
      html_url?: string;
    }>;
    return issues
      .filter((issue) => !issue.pull_request)
      .map((issue) => {
        const externalId = `${repo}#${issue.number}`;
        const item = baseImportedTask(this.source, externalId, issue.title, this.backlogDir);
        if (issue.body) item.description = issue.body;
        item.status = issue.state === "closed" ? "done" : "backlog";
        item.labels = (issue.labels ?? []).map((entry) =>
          typeof entry === "string" ? entry : entry.name,
        );
        if (issue.html_url) item.source_links[0]!.url = issue.html_url;
        return item;
      });
  }
}

function mapBacklogStatusToJiraStatus(status: Task["status"]): string | null {
  switch (status) {
    case "backlog":
      return "To Do";
    case "ready":
      return "Selected for Development";
    case "in_progress":
      return "In Progress";
    case "review":
      return "In Review";
    case "test":
      return "In Test";
    case "released":
    case "done":
      return "Done";
    case "blocked":
      return null;
  }
  // Defensive fallback: if Task["status"] ever loosens to `string` (which
  // can happen in CI when the schemas/dist .d.ts isn't built yet and the
  // path alias resolves the type from source), the switch above would
  // not be seen as exhaustive. Returning null here keeps the contract
  // (string | null) intact.
  return null;
}

export function createConnector(
  source: SourceConfig,
  projectRoot: string,
  backlogDir: string,
): SourceConnector {
  switch (source.kind) {
    case "markdown":
      return new MarkdownConnector(source, projectRoot, backlogDir);
    case "csv":
      return new CsvConnector(source, projectRoot, backlogDir);
    case "jira":
      return new JiraConnector(source, backlogDir);
    case "github":
      return new GithubConnector(source, backlogDir);
  }
  throw new Error(`Unsupported source kind: ${String(source.kind)}`);
}

// GitHub helpers used by the cloning workflow (independent of source connectors).

export interface GithubRepoSummary {
  full_name: string;
  description: string | null;
  private: boolean;
  default_branch: string;
  clone_url: string;
  ssh_url: string;
  html_url: string;
  pushed_at: string;
}

export async function listGithubRepos(token: string): Promise<GithubRepoSummary[]> {
  const repos: GithubRepoSummary[] = [];
  let page = 1;
  while (page <= 5) {
    const url = new URL("https://api.github.com/user/repos");
    url.searchParams.set("per_page", "100");
    url.searchParams.set("sort", "pushed");
    url.searchParams.set("affiliation", "owner,collaborator,organization_member");
    url.searchParams.set("page", String(page));
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`GitHub /user/repos failed: ${response.status} ${response.statusText} ${detail.slice(0, 200)}`);
    }
    const batch = (await response.json()) as GithubRepoSummary[];
    repos.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }
  return repos;
}

export async function testGithubToken(token: string): Promise<{ login: string }> {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub token check failed: ${response.status} ${response.statusText}`);
  }
  const user = (await response.json()) as { login: string };
  return { login: user.login };
}

export interface JiraTestInput {
  baseUrl: string;
  email: string;
  apiToken: string;
}

export async function testJiraConnection(input: JiraTestInput): Promise<{ accountId: string; displayName: string }> {
  const auth = Buffer.from(`${input.email}:${input.apiToken}`).toString("base64");
  const response = await fetch(new URL("/rest/api/3/myself", input.baseUrl), {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`Jira /myself failed: ${response.status} ${response.statusText}`);
  }
  const user = (await response.json()) as { accountId: string; displayName: string };
  return { accountId: user.accountId, displayName: user.displayName };
}
