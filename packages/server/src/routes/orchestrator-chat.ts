import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import {
  ChatUnavailableError,
  resolveChatCredentials,
  runOrchestratorChat,
  type ChatMessage,
} from "../lib/orchestrator-chat.js";
import type { AppEnv } from "../project-resolver.js";

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1),
});

const bodySchema = z.object({
  messages: z.array(messageSchema).min(1).max(50),
  model: z.string().optional(),
});

export function orchestratorChatRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/orchestrator/chat", async (c) => {
    const workspace = c.get("workspace");
    const credentials = resolveChatCredentials(workspace.backlogDir);
    if (!credentials) {
      return c.json(
        {
          error: "anthropic_credentials_missing",
          detail:
            "Set ANTHROPIC_API_KEY in the shell that runs `backlog serve` (and restart) or store it with `backlog secrets set ANTHROPIC_API_KEY`.",
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
          await stream.writeSSE({
            event,
            id: String(id++),
            data: JSON.stringify(payload),
          });
        } catch {
          // client disconnected mid-write — onAbort will clean up
        }
      };

      const controller = new AbortController();
      stream.onAbort(() => controller.abort());

      try {
        await runOrchestratorChat({
          backlogDir: workspace.backlogDir,
          messages,
          credentials,
          ...(parsed.data.model ? { model: parsed.data.model } : {}),
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
