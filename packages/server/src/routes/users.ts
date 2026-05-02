import {
  confirmInvitation,
  createLocalUser,
  deleteUser,
  inviteUser,
  listUsers,
  refreshInvitation,
  updateUser,
} from "@backlog/core";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../project-resolver.js";

const inviteBodySchema = z
  .object({
    email: z.string().trim().toLowerCase().email(),
    display_name: z.string().trim().min(1).optional(),
    role: z.enum(["owner", "admin", "member", "guest"]).optional(),
    invited_by: z.string().optional(),
  })
  .strict();

const updateBodySchema = z
  .object({
    display_name: z.string().min(1).optional(),
    role: z.enum(["owner", "admin", "member", "guest"]).optional(),
    status: z.enum(["pending", "active", "removed"]).optional(),
  })
  .strict();

export function usersRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/users", (c) => {
    const project = c.get("project");
    return c.json({ users: listUsers(project.backlogDir) });
  });

  app.post("/users", async (c) => {
    const project = c.get("project");
    const raw = await c.req.json().catch(() => null);
    const parsed = inviteBodySchema.omit({ invited_by: true }).safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    try {
      const input: Parameters<typeof createLocalUser>[1] = { email: parsed.data.email };
      if (parsed.data.display_name) input.display_name = parsed.data.display_name;
      if (parsed.data.role) input.role = parsed.data.role;
      const user = createLocalUser(project.backlogDir, input);
      return c.json({ user }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "create_failed", detail: message }, 400);
    }
  });

  app.post("/users/invite", async (c) => {
    const project = c.get("project");
    const raw = await c.req.json().catch(() => null);
    const parsed = inviteBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    try {
      const input: Parameters<typeof inviteUser>[1] = { email: parsed.data.email };
      if (parsed.data.display_name) input.display_name = parsed.data.display_name;
      if (parsed.data.role) input.role = parsed.data.role;
      if (parsed.data.invited_by) input.invited_by = parsed.data.invited_by;
      const user = inviteUser(project.backlogDir, input);
      return c.json({ user }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "invite_failed", detail: message }, 400);
    }
  });

  app.patch("/users/:id", async (c) => {
    const project = c.get("project");
    const raw = await c.req.json().catch(() => null);
    const parsed = updateBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    try {
      const input: Parameters<typeof updateUser>[2] = {};
      if (parsed.data.display_name !== undefined) input.display_name = parsed.data.display_name;
      if (parsed.data.role !== undefined) input.role = parsed.data.role;
      if (parsed.data.status !== undefined) input.status = parsed.data.status;
      const user = updateUser(project.backlogDir, c.req.param("id"), input);
      return c.json({ user });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.startsWith("Unknown") ? 404 : 400;
      return c.json({ error: "update_failed", detail: message }, status);
    }
  });

  app.delete("/users/:id", (c) => {
    const project = c.get("project");
    try {
      deleteUser(project.backlogDir, c.req.param("id"));
      return c.body(null, 204);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.startsWith("Unknown") ? 404 : 400;
      return c.json({ error: "delete_failed", detail: message }, status);
    }
  });

  // Re-issue the invitation token + expiry. Kept for Cloud-backed
  // invitation flows; the local Users screen creates active people
  // directly because a localhost project cannot receive remote invites.
  app.post("/users/:id/refresh-invitation", (c) => {
    const project = c.get("project");
    try {
      const user = refreshInvitation(project.backlogDir, c.req.param("id"));
      return c.json({ user });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.startsWith("Unknown") ? 404 : 400;
      return c.json({ error: "refresh_failed", detail: message }, status);
    }
  });

  // Confirmation endpoint. The recipient hits this URL (typically via
  // an email link) to flip their status from pending → active. No auth
  // — the token itself is the credential.
  app.post("/users/confirm", async (c) => {
    const project = c.get("project");
    const raw = await c.req.json().catch(() => null);
    const token = (raw as { token?: unknown } | null)?.token;
    if (typeof token !== "string" || token.length === 0) {
      return c.json({ error: "missing_token" }, 400);
    }
    try {
      const user = confirmInvitation(project.backlogDir, token);
      return c.json({ user });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "confirm_failed", detail: message }, 400);
    }
  });

  return app;
}
