import createClient, { type Client } from "openapi-fetch";
import type { components, paths } from "./generated/openapi-types.js";

export type Workspace = components["schemas"]["Workspace"];
export type Task = components["schemas"]["Task"];
export type SubTask = components["schemas"]["Task"];
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

  // ── Workspaces ───────────────────────────────────────────────────────

  async listWorkspaces(): Promise<Workspace[]> {
    const { data, error } = await this.client.GET("/projects");
    if (error || !data) throw new BacklogApiError("list workspaces failed", error);
    return data.projects ?? [];
  }

  async createWorkspace(name: string): Promise<Workspace> {
    const { data, error } = await this.client.POST("/projects", {
      body: { name },
    });
    if (error || !data?.workspace) throw new BacklogApiError("create workspace failed", error);
    return data.workspace;
  }

  async getWorkspace(id: number): Promise<Workspace> {
    const { data, error } = await this.client.GET("/projects/{id}", {
      params: { path: { id } },
    });
    if (error || !data?.workspace) throw new BacklogApiError("get workspace failed", error);
    return data.workspace;
  }

  // ── Work items ───────────────────────────────────────────────────────

  async listTasks(workspaceId: number): Promise<Task[]> {
    const { data, error } = await this.client.GET("/projects/{id}/work-items", {
      params: { path: { id: workspaceId } },
    });
    if (error || !data) throw new BacklogApiError("list work items failed", error);
    return data.work_items ?? [];
  }

  async createTask(
    workspaceId: number,
    input: {
      external_id: string;
      title: string;
      status?: string;
      priority?: string;
      payload?: Record<string, unknown>;
    },
  ): Promise<Task> {
    const { data, error } = await this.client.POST("/projects/{id}/work-items", {
      params: { path: { id: workspaceId } },
      body: input,
    });
    if (error || !data?.work_item) throw new BacklogApiError("create work item failed", error);
    return data.work_item;
  }

  // ── Tasks ────────────────────────────────────────────────────────────

  async listSubTasks(workspaceId: number): Promise<SubTask[]> {
    const { data, error } = await this.client.GET("/projects/{project_id}/tasks", {
      params: { path: { project_id: workspaceId } },
    });
    if (error || !data) throw new BacklogApiError("list tasks failed", error);
    return data.tasks ?? [];
  }

  async createSubTask(
    workspaceId: number,
    input: {
      work_item_id: number;
      repo?: string;
      scope?: string;
      status?: string;
      assigned_agent?: string;
    },
  ): Promise<SubTask> {
    const { data, error } = await this.client.POST("/projects/{project_id}/tasks", {
      params: { path: { project_id: workspaceId } },
      body: input,
    });
    if (error || !data?.task) throw new BacklogApiError("create task failed", error);
    return data.task;
  }

  // ── Runs ─────────────────────────────────────────────────────────────

  async listRuns(workspaceId: number, status?: string): Promise<Run[]> {
    const { data, error } = await this.client.GET("/projects/{project_id}/runs", {
      params: {
        path: { project_id: workspaceId },
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
    const { data, error } = await this.client.POST("/projects/{project_id}/runs", {
      params: { path: { project_id: workspaceId } },
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

  /** Current subscription for a workspace (auto-resyncs from Stripe if local state is stale). */
  async getBilling(workspaceId: number): Promise<Subscription> {
    const { data, error } = await this.client.GET("/projects/{project_id}/billing", {
      params: { path: { project_id: workspaceId } },
    });
    if (error || !data?.subscription) throw new BacklogApiError("get billing failed", error);
    return data.subscription;
  }

  /** Create a Stripe Checkout session to upgrade the workspace. Returns the URL to redirect to. */
  async createCheckoutSession(
    workspaceId: number,
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
        params: { path: { project_id: workspaceId } },
        body: input,
      },
    );
    if (error || !data) throw new BacklogApiError("create checkout failed", error);
    return data;
  }

  /** Create a Stripe Billing Portal session for the workspace owner. */
  async createPortalSession(
    workspaceId: number,
    input: { return_url?: string } = {},
  ): Promise<PortalSession> {
    const { data, error } = await this.client.POST(
      "/projects/{project_id}/billing/portal",
      {
        params: { path: { project_id: workspaceId } },
        body: input,
      },
    );
    if (error || !data) throw new BacklogApiError("create portal failed", error);
    return data;
  }

  // ── Usage ────────────────────────────────────────────────────────────

  /** Month-to-date token spend, AI calls, and remaining quota for a workspace. */
  async getUsage(workspaceId: number): Promise<UsageReport> {
    const { data, error } = await this.client.GET(
      "/projects/{project_id}/usage",
      { params: { path: { project_id: workspaceId } } },
    );
    if (error || !data) throw new BacklogApiError("get usage failed", error);
    return data;
  }

  // ── AI proxy ─────────────────────────────────────────────────────────

  /**
   * Send a message to Anthropic Claude through the workspace proxy.
   * Tokens are billed against the workspace's monthly quota — see {@link getUsage}.
   * Returns Anthropic's raw Messages API response (passthrough).
   */
  async aiMessages(
    workspaceId: number,
    input: AiMessageRequest,
  ): Promise<AiMessageResponse> {
    const { data, error } = await this.client.POST(
      "/projects/{project_id}/ai/messages",
      {
        params: { path: { project_id: workspaceId } },
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
