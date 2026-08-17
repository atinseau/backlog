import {
  appendChatMessage,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  renameConversation,
  searchConversations,
  setConversationModel,
  truncateConversation,
  setConversationBackend,
  setConversationSession,
} from "@backlog/core";
import type { ChatToolCall, ChatUsage } from "@backlog/schemas";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { runOrchestratorChat } from "../lib/chat/index.js";
import type { ChatStreamEvent } from "../lib/chat/types.js";
import type { AppEnv } from "../project-resolver.js";

// Conversations are server state now, not a blob in the browser. That is what
// lets the user close the board, come back, and pick up a thread — and what
// lets a turn resume the runtime's own session instead of replaying the
// transcript.

const createBodySchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    model: z.string().min(1).optional(),
  })
  .strict();

const patchBodySchema = z
  .object({
    title: z.string().optional(),
    // Explicit null resets the thread: same transcript, fresh runtime session.
    session_id: z.string().min(1).nullable().optional(),
    // Explicit null falls back to the project default.
    model: z.string().min(1).nullable().optional(),
  })
  .strict();

const truncateBodySchema = z.object({ keep: z.number().int() }).strict();

const messageBodySchema = z
  .object({
    content: z.string().min(1),
    model: z.string().min(1).optional(),
  })
  .strict();

/**
 * Folds the event stream of one turn into what gets persisted: the assistant's
 * text, the tools it called, what they cost, and the session to resume.
 */
class TurnRecorder {
  text = "";
  usage: ChatUsage | undefined;
  sessionId: string | null = null;
  error: string | undefined;
  private readonly calls = new Map<string, ChatToolCall>();

  observe(event: ChatStreamEvent): void {
    const data = event.data;
    if (event.type === "text") {
      this.text += String(data["delta"] ?? "");
      return;
    }
    if (event.type === "tool_use") {
      const id = String(data["id"] ?? "");
      this.calls.set(id, {
        id,
        name: String(data["name"] ?? ""),
        status: "running",
        write: data["write"] === true,
        ...(data["input"] ? { input: data["input"] as Record<string, unknown> } : {}),
      });
      return;
    }
    if (event.type === "tool_result") {
      const call = this.calls.get(String(data["id"] ?? ""));
      if (!call) return;
      call.status = data["error"]
        ? "error"
        : data["awaiting_confirmation"] === true
          ? "awaiting_confirmation"
          : "done";
      if (data["detail"]) call.detail = String(data["detail"]);
      if (data["error"]) call.detail = String(data["error"]);
      return;
    }
    if (event.type === "done") {
      const sessionId = data["session_id"];
      if (typeof sessionId === "string" && sessionId) this.sessionId = sessionId;
      if (data["usage"] && typeof data["usage"] === "object") {
        this.usage = data["usage"] as ChatUsage;
      }
      return;
    }
    if (event.type === "error") {
      this.error = String(data["message"] ?? "unknown error");
    }
  }

  toolCalls(): ChatToolCall[] {
    return [...this.calls.values()];
  }
}

export function conversationsRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/conversations", (c) => {
    const project = c.get("project");
    const query = c.req.query("q");
    return c.json({
      conversations: query
        ? searchConversations(project.backlogDir, query)
        : listConversations(project.backlogDir),
    });
  });

  app.post("/conversations", async (c) => {
    const project = c.get("project");
    const parsed = createBodySchema.safeParse((await c.req.json().catch(() => ({}))) ?? {});
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    return c.json({ conversation: createConversation(project.backlogDir, parsed.data) }, 201);
  });

  app.get("/conversations/:id", (c) => {
    const project = c.get("project");
    const conversation = getConversation(project.backlogDir, c.req.param("id"));
    if (!conversation) {
      return c.json({ error: "unknown_conversation", id: c.req.param("id") }, 404);
    }
    return c.json({ conversation });
  });

  app.patch("/conversations/:id", async (c) => {
    const project = c.get("project");
    const id = c.req.param("id");
    if (!getConversation(project.backlogDir, id)) {
      return c.json({ error: "unknown_conversation", id }, 404);
    }
    const parsed = patchBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }

    try {
      let conversation = getConversation(project.backlogDir, id)!;
      if (parsed.data.title !== undefined) {
        conversation = renameConversation(project.backlogDir, id, parsed.data.title);
      }
      if (parsed.data.session_id !== undefined) {
        conversation = setConversationSession(project.backlogDir, id, parsed.data.session_id);
      }
      if (parsed.data.model !== undefined) {
        conversation = setConversationModel(project.backlogDir, id, parsed.data.model);
      }
      return c.json({ conversation });
    } catch (error) {
      return c.json(
        { error: "update_failed", detail: error instanceof Error ? error.message : String(error) },
        400,
      );
    }
  });

  // Rewinding, for an edit or a regeneration. The runtime session goes with the
  // discarded turns — see truncateConversation for why it cannot be kept.
  app.post("/conversations/:id/truncate", async (c) => {
    const project = c.get("project");
    const id = c.req.param("id");
    if (!getConversation(project.backlogDir, id)) {
      return c.json({ error: "unknown_conversation", id }, 404);
    }
    const parsed = truncateBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    try {
      return c.json({ conversation: truncateConversation(project.backlogDir, id, parsed.data.keep) });
    } catch (error) {
      return c.json(
        { error: "truncate_failed", detail: error instanceof Error ? error.message : String(error) },
        400,
      );
    }
  });

  app.delete("/conversations/:id", (c) => {
    const project = c.get("project");
    try {
      deleteConversation(project.backlogDir, c.req.param("id"));
      return c.body(null, 204);
    } catch {
      return c.json({ error: "unknown_conversation", id: c.req.param("id") }, 404);
    }
  });

  app.post("/conversations/:id/messages", async (c) => {
    const project = c.get("project");
    const id = c.req.param("id");
    const existing = getConversation(project.backlogDir, id);
    if (!existing) {
      return c.json({ error: "unknown_conversation", id }, 404);
    }
    const parsed = messageBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success || !parsed.data.content.trim()) {
      return c.json({ error: "invalid_body", detail: "A message cannot be empty." }, 400);
    }

    // Persist the user's turn before spending anything: if the runtime is
    // unavailable, what they typed still survives.
    const content = parsed.data.content.trim();
    appendChatMessage(project.backlogDir, id, { role: "user", content });

    return streamSSE(c, async (stream) => {
      let eventId = 0;
      const send = async (event: string, payload: Record<string, unknown>) => {
        try {
          await stream.writeSSE({ event, id: String(eventId++), data: JSON.stringify(payload) });
        } catch {
          // client disconnected mid-write — onAbort cleans up
        }
      };

      const controller = new AbortController();
      stream.onAbort(() => controller.abort());
      const recorder = new TurnRecorder();

      try {
        await runOrchestratorChat({
          backlogDir: project.backlogDir,
          projectRoot: project.root,
          messages: [...existing.messages, { role: "user", content }],
          ...(existing.session_id ? { sessionId: existing.session_id } : {}),
          ...(parsed.data.model ?? existing.model ? { model: parsed.data.model ?? existing.model! } : {}),
          abortSignal: controller.signal,
          onEvent: async (event) => {
            recorder.observe(event);
            await send(event.type, event.data);
          },
        });
      } catch (error) {
        recorder.error = error instanceof Error ? error.message : String(error);
        await send("error", { status: "error", message: recorder.error });
      }

      // Whatever happened, the transcript records it.
      appendChatMessage(project.backlogDir, id, {
        role: "assistant",
        content: recorder.text,
        tool_calls: recorder.toolCalls(),
        ...(recorder.usage ? { usage: recorder.usage } : {}),
        ...(recorder.error ? { error: recorder.error } : {}),
      });
      if (recorder.sessionId) {
        setConversationSession(project.backlogDir, id, recorder.sessionId);
      }
      try {
        const { resolveChatBackend } = await import("../lib/chat/index.js");
        setConversationBackend(project.backlogDir, id, resolveChatBackend(project.backlogDir).kind, null);
      } catch {
        // No backend available: the error above already says so.
      }
    });
  });

  return app;
}
