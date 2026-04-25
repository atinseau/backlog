import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth.js";
import { getDatabase, schema } from "../db/index.js";

const workspaceInputSchema = z.object({
  name: z.string().min(1).max(120),
});

const workItemInputSchema = z.object({
  external_id: z.string().min(1),
  title: z.string().min(1),
  status: z.enum(["ready", "in_progress", "review", "done", "blocked"]).optional(),
  priority: z.enum(["P0", "P1", "P2", "P3", "P4"]).optional(),
  payload: z.string().optional(),
});

export async function registerWorkspaceRoutes(server: FastifyInstance): Promise<void> {
  // ── workspaces ──

  server.get("/api/v1/workspaces", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    const db = getDatabase();
    const rows = await db.query.workspaces.findMany({
      where: eq(schema.workspaces.ownerUserId, user.id),
    });
    return { workspaces: rows };
  });

  server.post("/api/v1/workspaces", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    const parsed = workspaceInputSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({ error: "invalid_input", details: parsed.error.issues });
      return;
    }
    const db = getDatabase();
    const inserted = await db
      .insert(schema.workspaces)
      .values({ ownerUserId: user.id, name: parsed.data.name })
      .returning();
    return { workspace: inserted[0] };
  });

  server.get<{ Params: { id: string } }>("/api/v1/workspaces/:id", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    const id = Number(request.params.id);
    if (!Number.isFinite(id)) {
      reply.code(400).send({ error: "invalid_id" });
      return;
    }
    const db = getDatabase();
    const row = await db.query.workspaces.findFirst({
      where: and(eq(schema.workspaces.id, id), eq(schema.workspaces.ownerUserId, user.id)),
    });
    if (!row) {
      reply.code(404).send({ error: "not_found" });
      return;
    }
    return { workspace: row };
  });

  // ── work items inside a workspace ──

  server.get<{ Params: { id: string } }>(
    "/api/v1/workspaces/:id/work-items",
    async (request, reply) => {
      const user = await requireAuth(request, reply);
      if (!user) return;
      const workspaceId = Number(request.params.id);
      if (!Number.isFinite(workspaceId)) {
        reply.code(400).send({ error: "invalid_id" });
        return;
      }
      const db = getDatabase();
      const ws = await db.query.workspaces.findFirst({
        where: and(
          eq(schema.workspaces.id, workspaceId),
          eq(schema.workspaces.ownerUserId, user.id),
        ),
      });
      if (!ws) {
        reply.code(404).send({ error: "workspace_not_found" });
        return;
      }
      const rows = await db.query.workItems.findMany({
        where: eq(schema.workItems.workspaceId, workspaceId),
      });
      return { work_items: rows };
    },
  );

  server.post<{ Params: { id: string } }>(
    "/api/v1/workspaces/:id/work-items",
    async (request, reply) => {
      const user = await requireAuth(request, reply);
      if (!user) return;
      const workspaceId = Number(request.params.id);
      if (!Number.isFinite(workspaceId)) {
        reply.code(400).send({ error: "invalid_id" });
        return;
      }
      const parsed = workItemInputSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400).send({ error: "invalid_input", details: parsed.error.issues });
        return;
      }
      const db = getDatabase();
      const ws = await db.query.workspaces.findFirst({
        where: and(
          eq(schema.workspaces.id, workspaceId),
          eq(schema.workspaces.ownerUserId, user.id),
        ),
      });
      if (!ws) {
        reply.code(404).send({ error: "workspace_not_found" });
        return;
      }
      const inserted = await db
        .insert(schema.workItems)
        .values({
          workspaceId,
          externalId: parsed.data.external_id,
          title: parsed.data.title,
          status: parsed.data.status ?? "ready",
          priority: parsed.data.priority ?? "P2",
          ...(parsed.data.payload !== undefined ? { payload: parsed.data.payload } : {}),
        })
        .returning();
      return { work_item: inserted[0] };
    },
  );
}
