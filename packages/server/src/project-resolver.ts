import path from "node:path";
import {
  type RegistryOptions,
  listRegisteredProjects,
} from "@backlog/config";
import type { Context, MiddlewareHandler } from "hono";
import type { ServerProject } from "./project-context.js";

export type AppEnv = { Variables: { workspace: ServerProject } };

const WORKSPACE_QUERY_PARAM = "workspace";
const WORKSPACE_HEADER = "x-backlog-project";

function readWorkspaceIdFromRequest(c: Context): string | undefined {
  const fromQuery = c.req.query(WORKSPACE_QUERY_PARAM);
  if (fromQuery && fromQuery.length > 0) return fromQuery;
  const fromHeader = c.req.header(WORKSPACE_HEADER);
  if (fromHeader && fromHeader.length > 0) return fromHeader;
  return undefined;
}

export class ProjectResolver {
  constructor(
    private readonly defaultWorkspace: ServerProject,
    private readonly registryOptions: RegistryOptions = {},
  ) {}

  // The default workspace the server was started with. Returned when no
  // ?workspace= query (or x-backlog-project header) is present.
  get default(): ServerProject {
    return this.defaultWorkspace;
  }

  // Look up a registered workspace by id. Returns null if not in the registry.
  resolveById(workspaceId: string): ServerProject | null {
    if (workspaceId === this.defaultWorkspace.project_id) return this.defaultWorkspace;
    const entries = listRegisteredProjects(this.registryOptions);
    const entry = entries.find((w) => w.id === workspaceId);
    if (!entry) return null;
    const root = path.resolve(entry.path);
    // For user_level entries the registry path IS the workspace dir; for
    // in_repo it's the project root containing a .backlog/ subdir.
    const backlogDir = entry.location === "user_level" ? root : path.join(root, ".backlog");
    return {
      project_id: entry.id,
      root,
      backlogDir,
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
        return c.json({ error: "workspace_not_found", project_id: requested }, 404);
      }
      c.set("workspace", resolved);
      return next();
    };
  }
}
