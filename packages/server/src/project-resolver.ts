import path from "node:path";
import {
  type RegistryOptions,
  listRegisteredProjects,
} from "@backlog/config";
import type { Context, MiddlewareHandler } from "hono";
import type { ServerProject } from "./project-context.js";

export type AppEnv = { Variables: { project: ServerProject } };

const PROJECT_QUERY_PARAM = "project";
const LEGACY_WORKSPACE_QUERY_PARAM = "workspace";
const PROJECT_HEADER = "x-backlog-project";

function readProjectIdFromRequest(c: Context): string | undefined {
  const fromProjectQuery = c.req.query(PROJECT_QUERY_PARAM);
  if (fromProjectQuery && fromProjectQuery.length > 0) return fromProjectQuery;
  const fromQuery = c.req.query(LEGACY_WORKSPACE_QUERY_PARAM);
  if (fromQuery && fromQuery.length > 0) return fromQuery;
  const fromHeader = c.req.header(PROJECT_HEADER);
  if (fromHeader && fromHeader.length > 0) return fromHeader;
  return undefined;
}

export class ProjectResolver {
  constructor(
    private readonly defaultProject: ServerProject,
    private readonly registryOptions: RegistryOptions = {},
  ) {}

  // The default project the server was started with. Returned when no
  // ?project= query (or x-backlog-project header) is present.
  get default(): ServerProject {
    return this.defaultProject;
  }

  // Look up a registered project by id. Returns null if not in the registry.
  resolveById(projectId: string): ServerProject | null {
    if (projectId === this.defaultProject.project_id) return this.defaultProject;
    const entries = listRegisteredProjects(this.registryOptions);
    const entry = entries.find((w) => w.id === projectId);
    if (!entry) return null;
    const root = path.resolve(entry.path);
    // For user_level entries the registry path IS the project dir; for
    // in_repo it's the project root containing a .backlog/ subdir.
    const backlogDir = entry.location === "user_level" ? root : path.join(root, ".backlog");
    return {
      project_id: entry.id,
      root,
      backlogDir,
      resolvedFrom: this.defaultProject.resolvedFrom,
    };
  }

  // Hono middleware: fills c.var.project from the request, falling back
  // to the default project when no override is provided. Replies 404 when
  // an explicit override doesn't match a registered project.
  middleware(): MiddlewareHandler<AppEnv> {
    return async (c, next) => {
      const requested = readProjectIdFromRequest(c);
      if (!requested) {
        c.set("project", this.defaultProject);
        return next();
      }
      const resolved = this.resolveById(requested);
      if (!resolved) {
        return c.json({ error: "project_not_found", project_id: requested }, 404);
      }
      c.set("project", resolved);
      return next();
    };
  }
}
