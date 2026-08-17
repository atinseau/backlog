import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import {
  ChatUnavailableError,
  resolveChatBackend,
  runOrchestratorChat,
  type ChatMessage,
} from "../lib/chat/index.js";
import type { AppEnv } from "../project-resolver.js";

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1),
});

const bodySchema = z.object({
  messages: z.array(messageSchema).min(1).max(50),
  model: z.string().optional(),
  // Returned by a previous turn's `done` event. Lets the CLI backend continue
  // its own conversation instead of replaying the transcript.
  session_id: z.string().min(1).optional(),
});

export function orchestratorChatRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/orchestrator/chat/status", (c) => {
    const project = c.get("project");
    try {
      return c.json({ available: true, backend: resolveChatBackend(project.backlogDir).kind });
    } catch (error) {
      return c.json({
        available: false,
        backend: null,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post("/orchestrator/chat", async (c) => {
    const project = c.get("project");
    try {
      resolveChatBackend(project.backlogDir);
    } catch (error) {
      return c.json(
        {
          error: "chat_unavailable",
          detail: error instanceof Error ? error.message : String(error),
        },
        503,
      );
    }

    const raw = await c.req.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    const messages: ChatMessage[] = parsed.data.messages;

    return streamSSE(c, async (stream) => {
      let id = 0;
      const send = async (event: string, payload: Record<string, unknown>) => {
        try {
          await stream.writeSSE({ event, id: String(id++), data: JSON.stringify(payload) });
        } catch {
          // client disconnected mid-write — onAbort will clean up
        }
      };

      const controller = new AbortController();
      stream.onAbort(() => controller.abort());

      try {
        await runOrchestratorChat({
          backlogDir: project.backlogDir,
          projectRoot: project.root,
          messages,
          ...(parsed.data.model ? { model: parsed.data.model } : {}),
          ...(parsed.data.session_id ? { sessionId: parsed.data.session_id } : {}),
          abortSignal: controller.signal,
          onEvent: (event) => send(event.type, event.data),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status = error instanceof ChatUnavailableError ? "unavailable" : "error";
        await send("error", { status, message });
      }
    });
  });

  return app;
}
