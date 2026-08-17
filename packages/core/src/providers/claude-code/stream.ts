import type { ProviderActivityEvent } from "../types.js";

// Translation of the Claude Code `--output-format stream-json` NDJSON feed
// into the activity events that drive the board's live banner. Pure: the
// caller owns both the line splitting and the persistence.

const READ_TOOLS = new Set(["Read", "Glob", "Grep"]);
const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "NotebookEdit"]);
const FILE_ARG_TOOLS = new Set(["Read", "Edit", "MultiEdit", "Write", "NotebookEdit"]);

const TOOL_ACTIVITY_TYPES: Record<string, string> = {
  Write: "agent.write",
  Bash: "agent.bash",
  BashOutput: "agent.bash",
  KillBash: "agent.bash",
  Task: "agent.subagent",
  WebFetch: "agent.web",
  WebSearch: "agent.web",
  TodoWrite: "agent.todo",
  ExitPlanMode: "agent.plan",
};

const MAX_SUMMARY_LENGTH = 85;

function classifyTool(toolName: string): string {
  if (READ_TOOLS.has(toolName)) return "agent.read";
  if (EDIT_TOOLS.has(toolName)) return "agent.edit";
  return TOOL_ACTIVITY_TYPES[toolName] ?? "agent.tool";
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function summarizeToolUse(toolName: string, input: unknown): string {
  const args = (input ?? {}) as Record<string, unknown>;
  const text = (key: string): string => String(args[key] ?? "");

  if (FILE_ARG_TOOLS.has(toolName)) {
    const file = text("file_path") || text("notebook_path");
    return file ? `${toolName} ${file}` : toolName;
  }
  if (toolName === "Glob") return `Glob ${text("pattern")}`;
  if (toolName === "Grep") {
    const where = args["path"] ? ` in ${text("path")}` : "";
    return `Grep ${text("pattern")}${where}`;
  }
  if (toolName === "Bash") return `Bash ${text("description") || text("command")}`;
  if (toolName === "Task") return `Task ${text("description") || text("subagent_type")}`;
  if (toolName === "WebFetch" || toolName === "WebSearch") {
    return `${toolName} ${text("url") || text("query")}`;
  }
  return toolName;
}

function sessionInitEvent(payload: Record<string, unknown>): ProviderActivityEvent {
  const model = String(payload["model"] ?? "");
  const tools = Array.isArray(payload["tools"]) ? payload["tools"].length : 0;
  return { type: "agent.session_init", message: `model=${model} tools=${tools}` };
}

function toolUseEvents(payload: Record<string, unknown>): ProviderActivityEvent[] {
  const message = payload["message"] as { content?: Array<Record<string, unknown>> } | undefined;
  const blocks = message?.content ?? [];
  return blocks
    .filter((block) => block["type"] === "tool_use")
    .map((block) => {
      const name = String(block["name"] ?? "unknown");
      return {
        type: classifyTool(name),
        message: truncate(summarizeToolUse(name, block["input"]), MAX_SUMMARY_LENGTH),
      };
    });
}

function parseLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const payload = JSON.parse(trimmed) as unknown;
    return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * True for the final `result` event, which carries the closing summary and
 * the cumulative token usage. Parsed rather than pattern-matched, so a tool
 * call that happens to mention "result" is not mistaken for it.
 */
export function isClaudeCodeResultLine(line: string): boolean {
  return parseLine(line)?.["type"] === "result";
}

/**
 * Parse one NDJSON line. Returns every activity event it carries — usually
 * zero or one, more when the assistant fired several tools in one turn.
 * Tool results and lifecycle events stay silent: results can be enormous and
 * the close-out is already covered by the executor's own events.
 */
export function parseClaudeCodeStreamLine(line: string): ProviderActivityEvent[] {
  const payload = parseLine(line);
  if (!payload) return [];

  if (payload["type"] === "system" && payload["subtype"] === "init") {
    return [sessionInitEvent(payload)];
  }
  if (payload["type"] === "assistant") {
    return toolUseEvents(payload);
  }
  return [];
}
