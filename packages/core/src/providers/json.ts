// Recovering a JSON object from free-form model output. CLI-backed runtimes
// have no native schema mode, so we ask for JSON in the system prompt and
// accept the three shapes models actually produce: bare JSON, a fenced code
// block, or JSON surrounded by a sentence.

const FENCED_BLOCK = /```(?:json)?\s*([\s\S]*?)```/i;

function firstBalancedObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index++) {
    const char = text[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = inString;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth++;
    if (char === "}" && --depth === 0) return text.slice(start, index + 1);
  }
  return null;
}

/**
 * Extract and parse the first JSON object in `text`.
 * @throws when nothing parseable is present, quoting the raw output so the
 * failure is diagnosable from the run log.
 */
export function parseJsonObject(text: string, source: string): unknown {
  const candidates = [text.trim(), FENCED_BLOCK.exec(text)?.[1]?.trim(), firstBalancedObject(text)];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // try the next shape
    }
  }

  throw new Error(`${source} did not return parseable JSON. Raw output: ${text.slice(0, 500)}`);
}
