// Defensive parsers that pull token usage out of a provider CLI's stdout.
// Each provider has its own output shape, but they all converge on the
// same { input_tokens, output_tokens, cache_read_input_tokens?,
// cache_creation_input_tokens?, model } envelope. We keep these as plain
// functions so a new provider just adds another extractor.

export interface UsageBlock {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

function pickNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Anthropic-shape usage object (also matches Claude Code CLI's
// `--output-format json` payload). Returns null when not enough info.
function readAnthropicUsage(value: unknown, fallbackModel: string): UsageBlock | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const inTok = pickNumber(obj.input_tokens);
  const outTok = pickNumber(obj.output_tokens);
  if (inTok === null || outTok === null) return null;
  const block: UsageBlock = {
    model: typeof obj.model === "string" ? obj.model : fallbackModel,
    input_tokens: inTok,
    output_tokens: outTok,
  };
  const cacheRead = pickNumber(obj.cache_read_input_tokens);
  const cacheCreate = pickNumber(obj.cache_creation_input_tokens);
  if (cacheRead !== null) block.cache_read_input_tokens = cacheRead;
  if (cacheCreate !== null) block.cache_creation_input_tokens = cacheCreate;
  return block;
}

// Claude Code CLI in `--output-format json` mode emits a single JSON
// object with `usage` + `summary` (or `result`) fields. We accept either
// `.usage` or `.token_usage` since the field name has wobbled across
// versions. If parsing fails, returns null and the caller falls back to
// the raw text path.
export function parseClaudeJsonStdout(
  stdout: string,
  fallbackModel: string,
): { usage: UsageBlock | null; summary: string | null } {
  try {
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    const usage = readAnthropicUsage(parsed.usage ?? parsed.token_usage, fallbackModel);
    const summaryCandidate = parsed.summary ?? parsed.result ?? parsed.text ?? null;
    const summary = typeof summaryCandidate === "string" ? summaryCandidate : null;
    return { usage, summary };
  } catch {
    return { usage: null, summary: null };
  }
}

// Codex `--json` emits one JSON object per line. We scan for any line
// carrying a usage block (typically inside an "agent_message" or
// "session.usage" event). The last one wins because Codex emits an
// incremental usage block per turn.
export function parseCodexJsonStream(
  stdout: string,
  fallbackModel: string,
): UsageBlock | null {
  let last: UsageBlock | null = null;
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const obj = parsed as Record<string, unknown>;
    // Common shapes: { type: "session.usage", usage: {…} },
    // { event: "usage", usage: {…} }, or the usage block at the root.
    const candidate =
      (obj.usage as unknown) ??
      ((obj.payload && typeof obj.payload === "object")
        ? (obj.payload as Record<string, unknown>).usage
        : undefined);
    const block = readAnthropicUsage(candidate, fallbackModel);
    if (block) last = block;
  }
  return last;
}
