import type { ProviderActivityEvent } from "../types.js";

// Codex acts almost entirely through the shell, so its event feed is a
// stream of command executions. Classifying them by intent is what makes the
// activity banner readable instead of a wall of `/bin/zsh -lc "..."`.

const SHELL_WRAPPER = /\/bin\/(?:zsh|bash)\s+-l?c\s+"(.*)"$/;
const MAX_SUMMARY_LENGTH = 80;

const COMMAND_CLASSIFIERS: Array<{ pattern: RegExp; type: string }> = [
  { pattern: /^(?:git|gh)\s/, type: "agent.git" },
  { pattern: /^(?:cat|head|tail|less|more|bat)\s/, type: "agent.read" },
  { pattern: /^(?:rg|grep|ag|find|fd|ls|tree|wc)\s/, type: "agent.read" },
  { pattern: /^(?:apply_patch|sed\s|awk\s|patch\s|tee\s|>\s)/, type: "agent.edit" },
  { pattern: /^(?:rm|mv|cp|mkdir|touch|chmod|chown)\s/, type: "agent.fs" },
  { pattern: /test|spec|jest|vitest|mocha|pytest|cargo\s+test/, type: "agent.test" },
  { pattern: /^(?:npm|pnpm|yarn|bun|cargo|go|python3?|node|ruby|bundle|rake|bin\/)\s/, type: "agent.run" },
];

function unwrapShell(command: string): string {
  return SHELL_WRAPPER.exec(command)?.[1] ?? command;
}

function summarizeCommand(command: string): string {
  const trimmed = unwrapShell(command).replace(/\s+/g, " ").trim();
  return trimmed.length > MAX_SUMMARY_LENGTH ? `${trimmed.slice(0, MAX_SUMMARY_LENGTH - 1)}…` : trimmed;
}

function classifyCommand(command: string): string {
  const inner = unwrapShell(command).trim();
  // `>` redirection anywhere means the command writes, whatever it starts with.
  if (inner.includes(" > ")) return "agent.edit";
  return COMMAND_CLASSIFIERS.find(({ pattern }) => pattern.test(inner))?.type ?? "agent.bash";
}

function startedEvents(item: Record<string, unknown>): ProviderActivityEvent[] {
  if (item["type"] === "command_execution") {
    const command = String(item["command"] ?? "");
    return [{ type: classifyCommand(command), message: summarizeCommand(command) }];
  }
  if (item["type"] === "file_change") {
    const file = String(item["path"] ?? item["file"] ?? "");
    return file ? [{ type: "agent.edit", message: `Edit ${file}` }] : [];
  }
  return [];
}

function completedEvents(item: Record<string, unknown>): ProviderActivityEvent[] {
  if (item["type"] !== "command_execution" || item["status"] !== "failed") return [];
  const exit = item["exit_code"];
  return [
    {
      type: "agent.bash_failed",
      message: `exit ${exit !== undefined ? String(exit) : "?"} — ${summarizeCommand(String(item["command"] ?? ""))}`,
    },
  ];
}

/**
 * Parse one line of Codex's `--json` feed. Turn lifecycle and assistant
 * prose stay silent: too noisy, and the close-out is already covered by the
 * run's own executor events.
 */
export function parseCodexStreamLine(line: string): ProviderActivityEvent[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return [];

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return [];
  }

  if (payload["type"] === "thread.started") {
    return [{ type: "agent.session_init", message: `thread ${String(payload["thread_id"] ?? "").slice(0, 8)}` }];
  }

  const item = payload["item"] as Record<string, unknown> | undefined;
  if (!item) return [];
  if (payload["type"] === "item.started") return startedEvents(item);
  if (payload["type"] === "item.completed") return completedEvents(item);
  return [];
}
