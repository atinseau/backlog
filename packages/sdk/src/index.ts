import createClient, { type Client } from "openapi-fetch";
import type { components, paths } from "./generated/openapi-types.js";

export type Workspace = components["schemas"]["Workspace"];
export type WorkItem = components["schemas"]["WorkItem"];
export type Task = components["schemas"]["Task"];
export type Run = components["schemas"]["Run"];
export type User = components["schemas"]["User"];
export type AuthResponse = components["schemas"]["AuthResponse"];

export interface BacklogClientOptions {
  baseUrl?: string;
  token?: string;
  fetch?: typeof fetch;
}

const DEFAULT_BASE_URL = "https://backlog.so/api/v1";

export class BacklogClient {
  private client: Client<paths>;
  private token?: string;

  constructor(options: BacklogClientOptions = {}) {
    const baseUrl = options.baseUrl ?? process.env.BACKLOG_API_URL ?? DEFAULT_BASE_URL;
    this.token = options.token;
    this.client = createClient<paths>({
      baseUrl,
      fetch: options.fetch,
    });
    this.client.use({
      onRequest: ({ request }) => {
        if (this.token) {
          request.headers.set("Authorization", `Bearer ${this.token}`);
        }
        return request;
      },
    });
  }

  /** Set or replace the bearer token used for subsequent requests. */
  setToken(token: string | undefined): void {
    this.token = token;
  }

  // ── Auth ─────────────────────────────────────────────────────────────

  async health() {
    const { data, error } = await this.client.GET("/health");
    if (error) throw new BacklogApiError("health failed", error);
    return data;
  }

  async signup(email: string, password: string): Promise<AuthResponse> {
    const { data, error } = await this.client.POST("/auth/signup", {
      body: { email, password },
    });
    if (error || !data) throw new BacklogApiError("signup failed", error);
    this.token = data.token;
    return data;
  }

  async login(email: string, password: string): Promise<AuthResponse> {
    const { data, error } = await this.client.POST("/auth/login", {
      body: { email, password },
    });
    if (error || !data) throw new BacklogApiError("login failed", error);
    this.token = data.token;
    return data;
  }

  async logout(): Promise<void> {
    await this.client.POST("/auth/logout", {});
    this.token = undefined;
  }

  async me(): Promise<User> {
    const { data, error } = await this.client.GET("/auth/me");
    if (error || !data?.user) throw new BacklogApiError("me failed", error);
    return data.user;
  }

  // ── Workspaces ───────────────────────────────────────────────────────

  async listWorkspaces(): Promise<Workspace[]> {
    const { data, error } = await this.client.GET("/workspaces");
    if (error || !data) throw new BacklogApiError("list workspaces failed", error);
    return data.workspaces ?? [];
  }

  async createWorkspace(name: string): Promise<Workspace> {
    const { data, error } = await this.client.POST("/workspaces", {
      body: { name },
    });
    if (error || !data?.workspace) throw new BacklogApiError("create workspace failed", error);
    return data.workspace;
  }

  async getWorkspace(id: number): Promise<Workspace> {
    const { data, error } = await this.client.GET("/workspaces/{id}", {
      params: { path: { id } },
    });
    if (error || !data?.workspace) throw new BacklogApiError("get workspace failed", error);
    return data.workspace;
  }

  // ── Work items ───────────────────────────────────────────────────────

  async listWorkItems(workspaceId: number): Promise<WorkItem[]> {
    const { data, error } = await this.client.GET("/workspaces/{id}/work-items", {
      params: { path: { id: workspaceId } },
    });
    if (error || !data) throw new BacklogApiError("list work items failed", error);
    return data.work_items ?? [];
  }

  async createWorkItem(
    workspaceId: number,
    input: {
      external_id: string;
      title: string;
      status?: string;
      priority?: string;
      payload?: Record<string, unknown>;
    },
  ): Promise<WorkItem> {
    const { data, error } = await this.client.POST("/workspaces/{id}/work-items", {
      params: { path: { id: workspaceId } },
      body: input,
    });
    if (error || !data?.work_item) throw new BacklogApiError("create work item failed", error);
    return data.work_item;
  }

  // ── Tasks ────────────────────────────────────────────────────────────

  async listTasks(workspaceId: number): Promise<Task[]> {
    const { data, error } = await this.client.GET("/workspaces/{workspace_id}/tasks", {
      params: { path: { workspace_id: workspaceId } },
    });
    if (error || !data) throw new BacklogApiError("list tasks failed", error);
    return data.tasks ?? [];
  }

  async createTask(
    workspaceId: number,
    input: {
      work_item_id: number;
      repo?: string;
      scope?: string;
      status?: string;
      assigned_agent?: string;
    },
  ): Promise<Task> {
    const { data, error } = await this.client.POST("/workspaces/{workspace_id}/tasks", {
      params: { path: { workspace_id: workspaceId } },
      body: input,
    });
    if (error || !data?.task) throw new BacklogApiError("create task failed", error);
    return data.task;
  }

  // ── Runs ─────────────────────────────────────────────────────────────

  async listRuns(workspaceId: number, status?: string): Promise<Run[]> {
    const { data, error } = await this.client.GET("/workspaces/{workspace_id}/runs", {
      params: {
        path: { workspace_id: workspaceId },
        query: status ? { status } : undefined,
      },
    });
    if (error || !data) throw new BacklogApiError("list runs failed", error);
    return data.runs ?? [];
  }

  async createRun(
    workspaceId: number,
    input: {
      task_id: number;
      status?: string;
      summary?: string;
      artifacts?: Record<string, unknown>;
    },
  ): Promise<Run> {
    const { data, error } = await this.client.POST("/workspaces/{workspace_id}/runs", {
      params: { path: { workspace_id: workspaceId } },
      body: input,
    });
    if (error || !data?.run) throw new BacklogApiError("create run failed", error);
    return data.run;
  }
}

export class BacklogApiError extends Error {
  readonly response: unknown;
  constructor(message: string, response: unknown) {
    super(message);
    this.name = "BacklogApiError";
    this.response = response;
  }
}

export type { paths, components } from "./generated/openapi-types.js";
