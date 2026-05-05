import createClient, { type Client } from "openapi-fetch";
import type { components, paths } from "./generated/openapi-types.js";

export type Project = components["schemas"]["Project"];
/** @deprecated Use Project. */
export type Workspace = Project;
export type Task = components["schemas"]["Task"];
export type Subtask = components["schemas"]["Subtask"];
/** @deprecated Use Subtask. */
export type SubTask = Subtask;
export type Run = components["schemas"]["Run"];
export type User = components["schemas"]["User"];
export type AuthResponse = components["schemas"]["AuthResponse"];
export type Subscription = components["schemas"]["Subscription"];
export type BillingConfig = components["schemas"]["BillingConfig"];
export type CheckoutSession = components["schemas"]["CheckoutSession"];
export type PortalSession = components["schemas"]["PortalSession"];
export type UsageReport = components["schemas"]["UsageReport"];
export type AiMessage = components["schemas"]["AiMessage"];
export type AiMessageRequest = components["schemas"]["AiMessageRequest"];
export type AiMessageResponse = components["schemas"]["AiMessageResponse"];

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

  // ── Projects ─────────────────────────────────────────────────────────

  async listProjects(): Promise<Project[]> {
    const { data, error } = await this.client.GET("/projects");
    if (error || !data) throw new BacklogApiError("list projects failed", error);
    return data.projects ?? [];
  }

  async createProject(name: string): Promise<Project> {
    const { data, error } = await this.client.POST("/projects", {
      body: { name },
    });
    if (error || !data?.project) throw new BacklogApiError("create project failed", error);
    return data.project;
  }

  async getProject(id: number): Promise<Project> {
    const { data, error } = await this.client.GET("/projects/{id}", {
      params: { path: { id } },
    });
    if (error || !data?.project) throw new BacklogApiError("get project failed", error);
    return data.project;
  }

  /** @deprecated Use listProjects. */
  async listWorkspaces(): Promise<Project[]> {
    return this.listProjects();
  }

  /** @deprecated Use createProject. */
  async createWorkspace(name: string): Promise<Project> {
    return this.createProject(name);
  }

  /** @deprecated Use getProject. */
  async getWorkspace(id: number): Promise<Project> {
    return this.getProject(id);
  }

  // ── Tasks ────────────────────────────────────────────────────────────

  async listTasks(projectId: number): Promise<Task[]> {
    const { data, error } = await this.client.GET("/projects/{id}/tasks", {
      params: { path: { id: projectId } },
    });
    if (error || !data) throw new BacklogApiError("list tasks failed", error);
    return data.tasks ?? [];
  }

  async createTask(
    projectId: number,
    input: {
      external_id: string;
      title: string;
      status?: string;
      priority?: string;
      payload?: Record<string, unknown>;
    },
  ): Promise<Task> {
    const { data, error } = await this.client.POST("/projects/{id}/tasks", {
      params: { path: { id: projectId } },
      body: input,
    });
    if (error || !data?.task) throw new BacklogApiError("create task failed", error);
    return data.task;
  }

  async updateTask(
    projectId: number,
    taskId: number,
    input: {
      title?: string;
      status?: string;
      priority?: string;
      payload?: Record<string, unknown>;
    },
  ): Promise<Task> {
    const { data, error } = await this.client.PATCH("/projects/{id}/tasks/{task_id}", {
      params: { path: { id: projectId, task_id: taskId } },
      body: input,
    });
    if (error || !data?.task) throw new BacklogApiError("update task failed", error);
    return data.task;
  }

  // ── Subtasks ─────────────────────────────────────────────────────────

  async listSubtasks(projectId: number): Promise<Subtask[]> {
    const { data, error } = await this.client.GET("/projects/{project_id}/subtasks", {
      params: { path: { project_id: projectId } },
    });
    if (error || !data) throw new BacklogApiError("list subtasks failed", error);
    return data.subtasks ?? [];
  }

  async createSubtask(
    projectId: number,
    input: {
      task_id: number;
      repository?: string;
      /** @deprecated Use repository. */
      repo?: string;
      scope?: string;
      status?: string;
      assigned_agent?: string;
    },
  ): Promise<Subtask> {
    const { data, error } = await this.client.POST("/projects/{project_id}/subtasks", {
      params: { path: { project_id: projectId } },
      body: input,
    });
    if (error || !data?.subtask) throw new BacklogApiError("create subtask failed", error);
    return data.subtask;
  }

  /** @deprecated Use listSubtasks. */
  async listSubTasks(projectId: number): Promise<Subtask[]> {
    return this.listSubtasks(projectId);
  }

  /** @deprecated Use createSubtask. */
  async createSubTask(
    projectId: number,
    input: {
      task_id: number;
      repository?: string;
      /** @deprecated Use repository. */
      repo?: string;
      scope?: string;
      status?: string;
      assigned_agent?: string;
    },
  ): Promise<Subtask> {
    return this.createSubtask(projectId, input);
  }

  // ── Runs ─────────────────────────────────────────────────────────────

  async listRuns(projectId: number, status?: string): Promise<Run[]> {
    const { data, error } = await this.client.GET("/projects/{project_id}/runs", {
      params: {
        path: { project_id: projectId },
        query: status ? { status } : undefined,
      },
    });
    if (error || !data) throw new BacklogApiError("list runs failed", error);
    return data.runs ?? [];
  }

  async createRun(
    projectId: number,
    input: {
      task_id: number;
      status?: string;
      summary?: string;
      artifacts?: Record<string, unknown>;
    },
  ): Promise<Run> {
    const { data, error } = await this.client.POST("/projects/{project_id}/runs", {
      params: { path: { project_id: projectId } },
      body: input,
    });
    if (error || !data?.run) throw new BacklogApiError("create run failed", error);
    return data.run;
  }

  // ── Billing ──────────────────────────────────────────────────────────

  /** Public Stripe.js bootstrap data: publishable key + price IDs. Auth required. */
  async getBillingConfig(): Promise<BillingConfig> {
    const { data, error } = await this.client.GET("/billing/config");
    if (error || !data) throw new BacklogApiError("get billing config failed", error);
    return data;
  }

  /** Current subscription for a project (auto-resyncs from Stripe if local state is stale). */
  async getBilling(projectId: number): Promise<Subscription> {
    const { data, error } = await this.client.GET("/projects/{project_id}/billing", {
      params: { path: { project_id: projectId } },
    });
    if (error || !data?.subscription) throw new BacklogApiError("get billing failed", error);
    return data.subscription;
  }

  /** Create a Stripe Checkout session to upgrade the project. Returns the URL to redirect to. */
  async createCheckoutSession(
    projectId: number,
    input: {
      plan?: "pro";
      interval?: "monthly" | "yearly";
      success_url?: string;
      cancel_url?: string;
    } = {},
  ): Promise<CheckoutSession> {
    const { data, error } = await this.client.POST(
      "/projects/{project_id}/billing/checkout",
      {
        params: { path: { project_id: projectId } },
        body: input,
      },
    );
    if (error || !data) throw new BacklogApiError("create checkout failed", error);
    return data;
  }

  /** Create a Stripe Billing Portal session for the project owner. */
  async createPortalSession(
    projectId: number,
    input: { return_url?: string } = {},
  ): Promise<PortalSession> {
    const { data, error } = await this.client.POST(
      "/projects/{project_id}/billing/portal",
      {
        params: { path: { project_id: projectId } },
        body: input,
      },
    );
    if (error || !data) throw new BacklogApiError("create portal failed", error);
    return data;
  }

  // ── Usage ────────────────────────────────────────────────────────────

  /** Month-to-date token spend, AI calls, and remaining quota for a project. */
  async getUsage(projectId: number): Promise<UsageReport> {
    const { data, error } = await this.client.GET(
      "/projects/{project_id}/usage",
      { params: { path: { project_id: projectId } } },
    );
    if (error || !data) throw new BacklogApiError("get usage failed", error);
    return data;
  }

  // ── AI proxy ─────────────────────────────────────────────────────────

  /**
   * Send a message to Anthropic Claude through the project proxy.
   * Tokens are billed against the project's monthly quota — see {@link getUsage}.
   * Returns Anthropic's raw Messages API response (passthrough).
   */
  async aiMessages(
    projectId: number,
    input: AiMessageRequest,
  ): Promise<AiMessageResponse> {
    const { data, error } = await this.client.POST(
      "/projects/{project_id}/ai/messages",
      {
        params: { path: { project_id: projectId } },
        body: input,
      },
    );
    if (error || !data) throw new BacklogApiError("ai messages failed", error);
    return data;
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
