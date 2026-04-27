import path from "node:path";
import {
  type RegistryOptions,
  listRegisteredWorkspaces,
} from "@backlog/config";
import type { Context, MiddlewareHandler } from "hono";
import type { ServerWorkspace } from "./workspace-context.js";

export type AppEnv = { Variables: { workspace: ServerWorkspace } };

const WORKSPACE_QUERY_PARAM = "workspace";
const WORKSPACE_HEADER = "x-backlog-workspace";

function readWorkspaceIdFromRequest(c: Context): string | undefined {
  const fromQuery = c.req.query(WORKSPACE_QUERY_PARAM);
  if (fromQuery && fromQuery.length > 0) return fromQuery;
  const fromHeader = c.req.header(WORKSPACE_HEADER);
  if (fromHeader && fromHeader.length > 0) return fromHeader;
  return undefined;
}

export class WorkspaceResolver {
  constructor(
    private readonly defaultWorkspace: ServerWorkspace,
    private readonly registryOptions: RegistryOptions = {},
  ) {}

  // The default workspace the server was started with. Returned when no
  // ?workspace= query (or X-Backlog-Workspace header) is present.
  get default(): ServerWorkspace {
    return this.defaultWorkspace;
  }

  // Look up a registered workspace by id. Returns null if not in the registry.
  resolveById(workspaceId: string): ServerWorkspace | null {
    if (workspaceId === this.defaultWorkspace.workspace_id) return this.defaultWorkspace;
    const entries = listRegisteredWorkspaces(this.registryOptions);
    const entry = entries.find((w) => w.id === workspaceId);
    if (!entry) return null;
    const root = path.resolve(entry.path);
    return {
      workspace_id: entry.id,
      root,
      backlogDir: path.join(root, ".backlog"),
      resolvedFrom: this.defaultWorkspace.resolvedFrom,
    };
  }

  // Hono middleware: fills c.var.workspace from the request, falling back
  // to the default workspace when no override is provided. Replies 404 when
  // an explicit override doesn't match a registered workspace.
  middleware(): MiddlewareHandler<AppEnv> {
    return async (c, next) => {
      const requested = readWorkspaceIdFromRequest(c);
      if (!requested) {
        c.set("workspace", this.defaultWorkspace);
        return next();
      }
      const resolved = this.resolveById(requested);
      if (!resolved) {
        return c.json({ error: "workspace_not_found", workspace_id: requested }, 404);
      }
      c.set("workspace", resolved);
      return next();
    };
  }
}
