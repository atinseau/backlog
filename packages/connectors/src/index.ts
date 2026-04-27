import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { SourceConfig, Task } from "@backlog/schemas";

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

function makeImportedId(): string {
  return `WI-${crypto.randomBytes(4).toString("hex")}`;
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

function baseImportedWorkItem(source: SourceConfig, externalId: string, title: string): Task {
  const now = nowIso();
  return {
    id: makeImportedId(),
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
  constructor(private readonly source: SourceConfig, private readonly projectRoot: string) {}

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
      const item = baseImportedWorkItem(this.source, `line-${index + 1}`, match[1]!.trim());
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
  constructor(private readonly source: SourceConfig, private readonly projectRoot: string) {}

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
      const item = baseImportedWorkItem(this.source, externalId, title);
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
  constructor(private readonly source: SourceConfig) {}

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
      const item = baseImportedWorkItem(this.source, issue.key, title);
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
}

export function createConnector(source: SourceConfig, projectRoot: string): SourceConnector {
  switch (source.kind) {
    case "markdown":
      return new MarkdownConnector(source, projectRoot);
    case "csv":
      return new CsvConnector(source, projectRoot);
    case "jira":
      return new JiraConnector(source);
  }
  throw new Error(`Unsupported source kind: ${String(source.kind)}`);
}
