import Anthropic from "@anthropic-ai/sdk";
import type { UsageBlock } from "../../provider-usage.js";
import { parseJsonObject } from "../json.js";
import type {
  AgentProvider,
  ProviderCompletionRequest,
  ProviderCompletionResult,
  ProviderDescriptor,
  ProviderModelChoice,
  ProviderReadiness,
  ProviderReadinessInput,
  ProviderStructuredRequest,
  ProviderStructuredResult,
} from "../types.js";

export const ANTHROPIC_API_PROVIDER_ID = "anthropic-api";
export const ANTHROPIC_API_KEY = "ANTHROPIC_API_KEY";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const TEXT_MAX_TOKENS = 1024;
const STRUCTURED_MAX_TOKENS = 4096;

// Family aliases are what the Claude Code CLI understands; the HTTP API wants
// a concrete id. Agents are configured with either, so we translate.
const MODEL_ALIASES: Record<string, string> = {
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-7",
  haiku: "claude-haiku-4-5",
  "claude-sonnet-4-5": "claude-sonnet-4-6",
  "claude-opus-4-1": "claude-opus-4-1-20250805",
  "claude-3-5-haiku": "claude-3-5-haiku-20241022",
};

const ANTHROPIC_API_MODELS: ProviderModelChoice[] = [
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", family: "sonnet", description: "Balanced default for planning calls." },
  { value: "claude-opus-4-7", label: "Claude Opus 4.7", family: "opus", description: "Strongest reasoning, highest cost." },
  { value: "claude-haiku-4-5", label: "Claude Haiku 4.5", family: "haiku", description: "Fast and cheap for short answers." },
];

/** The slice of the Anthropic SDK this provider uses, narrowed so tests can stand in for it. */
export interface AnthropicMessagesClient {
  create(params: Record<string, unknown>): Promise<{
    content: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  }>;
}

export interface AnthropicApiProviderDeps {
  createClient: (apiKey: string) => AnthropicMessagesClient;
}

function defaultClientFactory(apiKey: string): AnthropicMessagesClient {
  const client = new Anthropic({ apiKey });
  return {
    create: (params) =>
      client.messages.create(params as never) as unknown as ReturnType<AnthropicMessagesClient["create"]>,
  };
}

export function resolveAnthropicModel(model: string | null | undefined): string | null {
  // Strip a trailing "[1m]"-style context suffix the UI may carry.
  const value = model?.replace(/\[[^\]]+\]$/, "").trim();
  if (!value) return null;
  return MODEL_ALIASES[value] ?? value;
}

/**
 * The Anthropic HTTP API as a Backlog runtime. It cannot execute a coding
 * task — no filesystem, no shell — but it answers one-shot prompts, which is
 * what task naming, refinement and split planning need. It exists alongside
 * Claude Code so those features keep working on a machine where the CLI is
 * not installed.
 */
export class AnthropicApiProvider implements AgentProvider {
  readonly id = ANTHROPIC_API_PROVIDER_ID;
  readonly aliases = [] as const;

  constructor(private readonly deps: AnthropicApiProviderDeps = { createClient: defaultClientFactory }) {}

  describe(): ProviderDescriptor {
    return {
      id: this.id,
      displayName: "Anthropic API",
      models: ANTHROPIC_API_MODELS,
      reasoning: { supported: false, levels: [], allowsCustom: false },
      authModes: ["api_key"],
      sandboxModes: [],
      capabilities: { executeRun: false, textCompletion: true, structuredOutput: true },
      requiresCommand: false,
    };
  }

  checkReadiness(input: ProviderReadinessInput): ProviderReadiness {
    const hasKey = Boolean(input.getSecret(ANTHROPIC_API_KEY) ?? process.env[ANTHROPIC_API_KEY]);
    return hasKey ? { ready: true, reasons: [] } : { ready: false, reasons: [`missing_api_key:${ANTHROPIC_API_KEY}`] };
  }

  async complete(request: ProviderCompletionRequest): Promise<ProviderCompletionResult> {
    const { text, model, usage } = await this.send(request, TEXT_MAX_TOKENS);
    if (!text.trim()) {
      throw new Error("Anthropic API returned an empty answer.");
    }
    return { text: text.trim(), model, usage };
  }

  async completeStructured<T>(request: ProviderStructuredRequest): Promise<ProviderStructuredResult<T>> {
    const { text, model, usage } = await this.send(request, STRUCTURED_MAX_TOKENS, {
      format: { type: "json_schema", schema: request.schema },
    });
    return { value: parseJsonObject(text, "Anthropic API") as T, model, usage };
  }

  private async send(
    request: ProviderCompletionRequest,
    maxTokens: number,
    outputConfig?: Record<string, unknown>,
  ): Promise<{ text: string; model: string; usage: UsageBlock | null }> {
    const apiKey = request.getSecret(ANTHROPIC_API_KEY) ?? process.env[ANTHROPIC_API_KEY];
    if (!apiKey) {
      throw new Error(`${ANTHROPIC_API_KEY} is not set. Store it with \`backlog secrets set ${ANTHROPIC_API_KEY}\`.`);
    }

    const model = resolveAnthropicModel(request.model ?? request.agent?.model) ?? DEFAULT_MODEL;
    const response = await this.deps.createClient(apiKey).create({
      model,
      max_tokens: maxTokens,
      ...(request.systemPrompt ? { system: request.systemPrompt } : {}),
      ...(outputConfig ? { output_config: outputConfig } : {}),
      messages: [{ role: "user", content: request.prompt }],
    });

    const text = response.content.find((block) => block.type === "text")?.text ?? "";
    const usage = response.usage
      ? {
          model,
          input_tokens: response.usage.input_tokens ?? 0,
          output_tokens: response.usage.output_tokens ?? 0,
        }
      : null;
    return { text, model, usage };
  }
}
