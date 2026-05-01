import fs from "node:fs";
import path from "node:path";
import { execa } from "execa";
import type { Agent, Run, SubTask, Task } from "@backlog/schemas";
import { addRunArtifact, appendRunEvent, getRunDirectory, updateRunStatus, writeRunHandoff } from "./run-store.js";
import { failRun, finalizeSuccessfulRun } from "./run-service.js";
import { buildProviderEnv, buildProviderPrompt, buildRetryPrompt, collectWorktreeArtifacts, resolveExecutable, successModeForAgent } from "./provider-utils.js";
import { parseClaudeJsonStdout } from "./provider-usage.js";
import { recordUsage } from "./usage.js";

// Maps a Claude tool name to the granular activity event we surface
// in the bottom banner. Keep these short and unambiguous so the
// terminal-style log stays scannable. Anything we don't recognize
// falls back to "agent.tool" with the raw name.
function classifyTool(toolName: string): string {
  if (toolName === "Read" || toolName === "Glob" || toolName === "Grep") return "agent.read";
  if (toolName === "Edit" || toolName === "MultiEdit" || toolName === "NotebookEdit") return "agent.edit";
  if (toolName === "Write") return "agent.write";
  if (toolName === "Bash" || toolName === "BashOutput" || toolName === "KillBash") return "agent.bash";
  if (toolName === "Task") return "agent.subagent";
  if (toolName === "WebFetch" || toolName === "WebSearch") return "agent.web";
  if (toolName === "TodoWrite") return "agent.todo";
  if (toolName === "ExitPlanMode") return "agent.plan";
  return "agent.tool";
}

// Extract the most-useful one-line summary of what a tool call did,
// derived from the standard Claude tool input shapes. Truncated so
// the banner row stays on one line.
function summarizeToolUse(toolName: string, input: unknown): string {
  const args = (input ?? {}) as Record<string, unknown>;
  const truncate = (s: string, n: number): string =>
    s.length > n ? s.slice(0, n - 1) + "…" : s;
  if (toolName === "Read" || toolName === "Edit" || toolName === "MultiEdit" || toolName === "Write" || toolName === "NotebookEdit") {
    const file = String(args["file_path"] ?? args["notebook_path"] ?? "");
    return file ? `${toolName} ${file}` : toolName;
  }
  if (toolName === "Glob") return `Glob ${truncate(String(args["pattern"] ?? ""), 80)}`;
  if (toolName === "Grep") return `Grep ${truncate(String(args["pattern"] ?? ""), 60)}${args["path"] ? ` in ${args["path"]}` : ""}`;
  if (toolName === "Bash") {
    const cmd = String(args["command"] ?? "");
    const desc = String(args["description"] ?? "");
    return `Bash ${truncate(desc || cmd, 80)}`;
  }
  if (toolName === "Task") {
    const desc = String(args["description"] ?? args["subagent_type"] ?? "");
    return `Task ${truncate(desc, 60)}`;
  }
  if (toolName === "WebFetch" || toolName === "WebSearch") {
    return `${toolName} ${truncate(String(args["url"] ?? args["query"] ?? ""), 80)}`;
  }
  return toolName;
}

function describeProcessFailure(result: { exitCode?: number | null; signal?: string | null; stdout?: string; stderr?: string }): string {
  if (typeof result.exitCode === "number") return `exit code ${result.exitCode}`;
  if (result.signal) return `signal ${result.signal}`;
  const output = `${result.stderr ?? ""}${result.stdout ?? ""}`.trim();
  if (output) return "non-zero exit";
  return "no exit status or output";
}

function handleStreamEvent(
  backlogDir: string,
  runId: string,
  ev: Record<string, unknown>,
): void {
  const type = ev["type"];
  if (type === "assistant") {
    const message = ev["message"] as { content?: Array<Record<string, unknown>> } | undefined;
    const content = message?.content ?? [];
    for (const block of content) {
      if (block["type"] === "tool_use") {
        const toolName = String(block["name"] ?? "unknown");
        appendRunEvent(backlogDir, runId, {
          ts: new Date().toISOString(),
          type: classifyTool(toolName),
          message: summarizeToolUse(toolName, block["input"]),
        });
      }
    }
  } else if (type === "system" && ev["subtype"] === "init") {
    // Helpful breadcrumb so the banner shows "started" before the
    // first tool call lands.
    appendRunEvent(backlogDir, runId, {
      ts: new Date().toISOString(),
      type: "agent.session_init",
      message: `model=${String(ev["model"] ?? "")} tools=${Array.isArray(ev["tools"]) ? (ev["tools"] as unknown[]).length : 0}`,
    });
  }
  // user (tool_result) and result events are silent in the activity
  // banner — tool results can be enormous and the lifecycle close-out
  // is already covered by executor.success / executor.failed.
}

export async function executeClaudeAgentRun(params: {
  backlogDir: string;
  run: Run;
  task: SubTask;
  workItem: Task;
  agent: Agent;
  priorFailureFeedback?: string;
  attemptNumber?: number;
}): Promise<void> {
  const executable = resolveExecutable(params.agent.command || "claude");
  const basePrompt = buildProviderPrompt(params.task, params.workItem, { executionMode: params.run.execution_mode });
  const prompt = params.priorFailureFeedback && (params.attemptNumber ?? 1) > 1
    ? buildRetryPrompt(basePrompt, params.attemptNumber ?? 2, params.priorFailureFeedback)
    : basePrompt;
  const scratchDir = params.run.execution_mode === "direct"
    ? getRunDirectory(params.backlogDir, params.run.id)
    : params.run.worktree_path;
  const promptPath = path.join(scratchDir, params.run.execution_mode === "direct" ? "claude-prompt.md" : ".backlog-claude-prompt.md");
  const logPath = path.join(scratchDir, params.run.execution_mode === "direct" ? "claude.log" : ".backlog-claude.log");
  fs.writeFileSync(promptPath, prompt, "utf8");

  // `--output-format stream-json --verbose` emits NDJSON of the agent
  // loop in real time: one line per system / assistant / user / result
  // event. We pipe it line-by-line into events.ndjson so the activity
  // banner shows what claude is doing as it does it (Read foo.rb,
  // Edit bar.rb, Bash 'npm test', …) instead of an empty 5-minute
  // silence followed by a single executor.success at the end.
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions"];
  if (params.agent.model) {
    args.push("--model", params.agent.model);
  }
  if (params.agent.profile) {
    args.push("--settings", JSON.stringify({ env: { CLAUDE_CODE_PROFILE: params.agent.profile } }));
  }
  args.push(prompt);

  appendRunEvent(params.backlogDir, params.run.id, {
    ts: new Date().toISOString(),
    type: "executor.start",
    message: `Executing Claude run for ${params.agent.id}`,
  });

  try {
    const subprocess = execa(executable, args, {
      cwd: params.run.worktree_path,
      env: buildProviderEnv(params.agent, params.run, params.task, params.workItem, params.backlogDir),
      reject: false,
    });

    let stdoutBuf = "";
    let lineBuf = "";
    let resultEventLine: string | null = null; // last `type: "result"` JSON

    subprocess.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdoutBuf += text;
      lineBuf += text;
      let nl: number;
      while ((nl = lineBuf.indexOf("\n")) >= 0) {
        const line = lineBuf.slice(0, nl).trim();
        lineBuf = lineBuf.slice(nl + 1);
        if (!line) continue;
        try {
          const ev = JSON.parse(line) as Record<string, unknown>;
          if (ev["type"] === "result") resultEventLine = line;
          handleStreamEvent(params.backlogDir, params.run.id, ev);
        } catch {
          // Non-JSON line in stream-json output — skip silently.
        }
      }
    });

    const result = await subprocess;

    fs.writeFileSync(
      logPath,
      [`# stdout`, stdoutBuf, ``, `# stderr`, result.stderr].join("\n"),
      "utf8",
    );

    // Parse usage from the final stream-json `result` event when we
    // captured one. Falls back to the legacy single-object path so
    // older Claude CLIs (or runs that crashed before emitting a
    // result) still record what they can.
    const fallbackModel = params.agent.model ?? "claude";
    const parsed = parseClaudeJsonStdout(resultEventLine ?? stdoutBuf, fallbackModel);
    if (parsed.usage) {
      try {
        recordUsage(params.backlogDir, params.run.id, {
          provider: "anthropic",
          model: parsed.usage.model,
          input_tokens: parsed.usage.input_tokens,
          output_tokens: parsed.usage.output_tokens,
          ...(parsed.usage.cache_read_input_tokens !== undefined
            ? { cache_read_input_tokens: parsed.usage.cache_read_input_tokens }
            : {}),
          ...(parsed.usage.cache_creation_input_tokens !== undefined
            ? { cache_creation_input_tokens: parsed.usage.cache_creation_input_tokens }
            : {}),
        });
      } catch {
        // Don't block the run if the events.ndjson write fails.
      }
    }
    const summary = (parsed.summary ?? result.stdout).trim();
    if (summary) {
      addRunArtifact(params.backlogDir, params.run.id, { kind: "summary", value: summary });
    }
    addRunArtifact(params.backlogDir, params.run.id, {
      kind: "log",
      value: params.run.execution_mode === "direct" ? logPath : ".backlog-claude.log",
    });
    for (const artifact of await collectWorktreeArtifacts(
      params.run.worktree_path,
      params.run.execution_mode === "direct" ? { scratchDir } : undefined,
    )) {
      addRunArtifact(params.backlogDir, params.run.id, artifact);
    }

    if (result.exitCode === 0) {
      const successMode = successModeForAgent(params.agent, params.task);
      await finalizeSuccessfulRun(
        params.backlogDir,
        params.run.id,
        summary || `Claude agent ${params.agent.id} completed successfully`,
        successMode,
      );
      appendRunEvent(params.backlogDir, params.run.id, {
        ts: new Date().toISOString(),
        type: "executor.success",
        message: `Claude execution completed with success mode ${successMode}`,
      });
      return;
    }

    const failure = describeProcessFailure(result);
    const handoffPath = writeRunHandoff(
      params.backlogDir,
      params.run.id,
      [
        "# Run Handoff",
        "",
        `Run: ${params.run.id}`,
        "Reason: claude print execution failed",
        "",
        `Exit: ${failure}`,
        "",
        params.run.execution_mode === "direct"
          ? "Inspect `claude.log` in the run directory."
          : "Inspect `.backlog-claude.log` in the worktree.",
      ].join("\n"),
    );
    await failRun(
      params.backlogDir,
      params.run.id,
      summary || `Claude agent ${params.agent.id} failed (${failure})`,
    );
    appendRunEvent(params.backlogDir, params.run.id, {
      ts: new Date().toISOString(),
      type: "executor.failed",
      message: `Claude execution failed (${failure}). Handoff: ${handoffPath}`,
    });
  } catch (error) {
    updateRunStatus(params.backlogDir, params.run.id, "blocked", error instanceof Error ? error.message : String(error));
    throw error;
  }
}
