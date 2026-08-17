import { z } from "zod";

// A saved orchestrator-chat conversation. Stored per project under
// `.backlog/chat/`, one file each — the same shape whichever runtime answered,
// so a conversation survives switching between the API and the CLI.

export const chatToolCallSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(["running", "done", "error", "awaiting_confirmation"]),
  /** True for tools that change state; they carry the confirmation gate. */
  write: z.boolean().default(false),
  /** Arguments the model passed, kept so a confirmation card can describe the action. */
  input: z.record(z.string(), z.unknown()).optional(),
  /** Refusal or failure text, shown verbatim. */
  detail: z.string().optional(),
  duration_ms: z.number().int().nonnegative().optional(),
});

export const chatUsageSchema = z.object({
  input_tokens: z.number().int().nonnegative().default(0),
  output_tokens: z.number().int().nonnegative().default(0),
  cache_read_input_tokens: z.number().int().nonnegative().default(0),
  cache_creation_input_tokens: z.number().int().nonnegative().default(0),
  cost_usd: z.number().nonnegative().optional(),
  duration_ms: z.number().int().nonnegative().optional(),
});

export const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  at: z.string().min(1),
  tool_calls: z.array(chatToolCallSchema).default([]),
  usage: chatUsageSchema.optional(),
  /** Set when the turn ended badly, so the transcript keeps the reason. */
  error: z.string().optional(),
});

export const conversationSchema = z.object({
  version: z.literal(1).default(1),
  id: z.string().min(1),
  /** Null until the first user message earns one. */
  title: z.string().nullable().default(null),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
  /** The runtime's own session, for `--resume`. Null starts a fresh one. */
  session_id: z.string().nullable().default(null),
  /** Which engine answered last, so the UI can show it. */
  backend: z.string().nullable().default(null),
  model: z.string().nullable().default(null),
  messages: z.array(chatMessageSchema).default([]),
});

/** List view: everything but the transcript. */
export const conversationSummarySchema = conversationSchema
  .omit({ messages: true })
  .extend({ message_count: z.number().int().nonnegative() });

/** What a caller supplies for a new message: the input side of the schema,
 * where `at` and the tool-call defaults have not been filled in yet. */
export type NewChatMessageInput = z.input<typeof chatMessageSchema>;

export type ChatToolCall = z.infer<typeof chatToolCallSchema>;
export type ChatUsage = z.infer<typeof chatUsageSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type Conversation = z.infer<typeof conversationSchema>;
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;
