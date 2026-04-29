import fs from "node:fs";
import path from "node:path";
import { execa } from "execa";
import type { Agent, Run, SubTask, Task } from "@backlog/schemas";
import { addRunArtifact, appendRunEvent, updateRunStatus, writeRunHandoff } from "./run-store.js";
import { failRun, finalizeSuccessfulRun } from "./run-service.js";
import { buildProviderEnv, buildProviderPrompt, buildRetryPrompt, collectWorktreeArtifacts, successModeForAgent } from "./provider-utils.js";
import { parseCodexJsonStream } from "./provider-usage.js";
import { recordUsage } from "./usage.js";

// Codex `--json` emits item.started / item.completed events for every
// tool call (mostly `command_execution` since codex acts through
// bash). Map each item.started into a friendly activity event so the
// banner reflects what the agent is doing in real time, the same
// way the claude executor surfaces tool_use blocks.
function summarizeBash(command: string): string {
  // Strip the `/bin/zsh -lc "..."` wrapper codex puts around every
  // shell line so the banner shows just the meaningful command.
  const m = /\/bin\/(?:zsh|bash)\s+-l?c\s+"(.*)"$/.exec(command);
  const inner = m ? m[1]! : command;
  const trimmed = inner.replace(/\s+/g, " ").trim();
  return trimmed.length > 80 ? trimmed.slice(0, 79) + "…" : trimmed;
}

function classifyCodexCommand(command: string): string {
  const c = command.replace(/.*?-l?c\s+"/, "").trim();
  if (/^(?:git|gh)\s/.test(c)) return "agent.git";
  if (/^(?:cat|head|tail|less|more|bat)\s/.test(c)) return "agent.read";
  if (/^(?:rg|grep|ag|find|fd|ls|tree|wc)\s/.test(c)) return "agent.read";
  if (/^(?:apply_patch|sed\s|awk\s|patch\s|tee\s|>\s)/.test(c) || c.includes(" > ")) return "agent.edit";
  if (/^(?:rm|mv|cp|mkdir|touch|chmod|chown)\s/.test(c)) return "agent.fs";
  if (/test|spec|jest|vitest|mocha|pytest|cargo\s+test/.test(c)) return "agent.test";
  if (/^(?:npm|pnpm|yarn|bun|cargo|go|python3?|node|ruby|bundle|rake|bin\/)\s/.test(c)) return "agent.run";
  return "agent.bash";
}

function handleCodexStreamEvent(
  backlogDir: string,
  runId: string,
  ev: Record<string, unknown>,
): void {
  const type = ev["type"];
  if (type === "thread.started") {
    appendRunEvent(backlogDir, runId, {
      ts: new Date().toISOString(),
      type: "agent.session_init",
      message: `thread ${String(ev["thread_id"] ?? "").slice(0, 8)}`,
    });
    return;
  }
  if (type === "item.started") {
    const item = ev["item"] as Record<string, unknown> | undefined;
    if (!item) return;
    if (item["type"] === "command_execution") {
      const command = String(item["command"] ?? "");
      appendRunEvent(backlogDir, runId, {
        ts: new Date().toISOString(),
        type: classifyCodexCommand(command),
        message: summarizeBash(command),
      });
    } else if (item["type"] === "file_change") {
      // Newer codex versions emit file_change items with a `path`.
      const p = String(item["path"] ?? item["file"] ?? "");
      if (p) {
        appendRunEvent(backlogDir, runId, {
          ts: new Date().toISOString(),
          type: "agent.edit",
          message: `Edit ${p}`,
        });
      }
    }
    return;
  }
  if (type === "item.completed") {
    const item = ev["item"] as Record<string, unknown> | undefined;
    if (!item) return;
    // Surface failed shells so the user notices the run is stuck on
    // an error (codex may retry or ask for help).
    if (item["type"] === "command_execution" && item["status"] === "failed") {
      const exit = item["exit_code"];
      appendRunEvent(backlogDir, runId, {
        ts: new Date().toISOString(),
        type: "agent.bash_failed",
        message: `exit ${exit !== undefined ? exit : "?"} — ${summarizeBash(String(item["command"] ?? ""))}`,
      });
    }
  }
  // turn.started / turn.completed / agent_message text are intentionally
  // silent — too noisy and the lifecycle close-out is already in
  // executor.success / executor.failed.
}

export async function executeCodexAgentRun(params: {
  backlogDir: string;
  run: Run;
  task: SubTask;
  workItem: Task;
  agent: Agent;
  priorFailureFeedback?: string;
  attemptNumber?: number;
}): Promise<void> {
  const executable = params.agent.command || "codex";
  const basePrompt = buildProviderPrompt(params.task, params.workItem);
  const prompt = params.priorFailureFeedback && (params.attemptNumber ?? 1) > 1
    ? buildRetryPrompt(basePrompt, params.attemptNumber ?? 2, params.priorFailureFeedback)
    : basePrompt;
  const promptPath = path.join(params.run.worktree_path, ".backlog-codex-prompt.md");
  const outputPath = path.join(params.run.worktree_path, ".backlog-codex-last-message.md");
  const logPath = path.join(params.run.worktree_path, ".backlog-codex.log");
  fs.writeFileSync(promptPath, prompt, "utf8");

  const args = ["exec", "--skip-git-repo-check", "--json", "--output-last-message", outputPath];
  if (params.agent.model) {
    args.push("--model", params.agent.model);
  }
  if (params.agent.profile) {
    args.push("--profile", params.agent.profile);
  }
  if (params.agent.sandbox_mode) {
    args.push("--sandbox", params.agent.sandbox_mode);
  } else {
    args.push("--sandbox", "workspace-write");
  }
  args.push("--cd", params.run.worktree_path, "-");

  appendRunEvent(params.backlogDir, params.run.id, {
    ts: new Date().toISOString(),
    type: "executor.start",
    message: `Executing Codex run for ${params.agent.id}`,
  });

  try {
    const subprocess = execa(executable, args, {
      cwd: params.run.worktree_path,
      env: buildProviderEnv(params.agent, params.run, params.task, params.workItem, params.backlogDir),
      input: prompt,
      reject: false,
    });

    // Pipe stdout through a line splitter and emit per-event activity
    // lines as they happen — same pattern as the claude executor. We
    // also keep the full stdout so the existing usage parser can scan
    // it at the end (codex's usage lives on `turn.completed`).
    let stdoutBuf = "";
    let lineBuf = "";
    subprocess.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdoutBuf += text;
      lineBuf += text;
      let nl: number;
      while ((nl = lineBuf.indexOf("\n")) >= 0) {
        const line = lineBuf.slice(0, nl).trim();
        lineBuf = lineBuf.slice(nl + 1);
        if (!line || !line.startsWith("{")) continue;
        try {
          handleCodexStreamEvent(params.backlogDir, params.run.id, JSON.parse(line) as Record<string, unknown>);
        } catch {
          // Non-JSON line — codex sometimes prints log lines to stdout. Skip.
        }
      }
    });

    const result = await subprocess;

    fs.writeFileSync(
      logPath,
      [`# stdout`, stdoutBuf, ``, `# stderr`, result.stderr].join("\n"),
      "utf8",
    );

    // Codex `--json` already streams JSON events; the last `usage` block
    // is the cumulative count for the session.
    const fallbackModel = params.agent.model ?? "gpt-5";
    const usage = parseCodexJsonStream(stdoutBuf, fallbackModel);
    if (usage) {
      try {
        recordUsage(params.backlogDir, params.run.id, {
          provider: "codex",
          model: usage.model,
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
          ...(usage.cache_read_input_tokens !== undefined
            ? { cache_read_input_tokens: usage.cache_read_input_tokens }
            : {}),
          ...(usage.cache_creation_input_tokens !== undefined
            ? { cache_creation_input_tokens: usage.cache_creation_input_tokens }
            : {}),
        });
      } catch {
        // Don't block the run on usage write failure.
      }
    }

    const lastMessage = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8").trim() : "";
    if (lastMessage) {
      addRunArtifact(params.backlogDir, params.run.id, { kind: "summary", value: lastMessage });
    }
    addRunArtifact(params.backlogDir, params.run.id, { kind: "log", value: ".backlog-codex.log" });
    for (const artifact of await collectWorktreeArtifacts(params.run.worktree_path)) {
      addRunArtifact(params.backlogDir, params.run.id, artifact);
    }

    if (result.exitCode === 0) {
      await finalizeSuccessfulRun(
        params.backlogDir,
        params.run.id,
        lastMessage || `Codex agent ${params.agent.id} completed successfully`,
        successModeForAgent(params.agent),
      );
      appendRunEvent(params.backlogDir, params.run.id, {
        ts: new Date().toISOString(),
        type: "executor.success",
        message: `Codex execution completed with success mode ${successModeForAgent(params.agent)}`,
      });
      return;
    }

    const handoffPath = writeRunHandoff(
      params.backlogDir,
      params.run.id,
      [
        "# Run Handoff",
        "",
        `Run: ${params.run.id}`,
        "Reason: codex exec failed",
        "",
        `Exit code: ${String(result.exitCode)}`,
        "",
        "Inspect `.backlog-codex.log` and `.backlog-codex-last-message.md` in the worktree.",
      ].join("\n"),
    );
    await failRun(
      params.backlogDir,
      params.run.id,
      lastMessage || `Codex agent ${params.agent.id} failed with exit code ${String(result.exitCode)}`,
    );
    appendRunEvent(params.backlogDir, params.run.id, {
      ts: new Date().toISOString(),
      type: "executor.failed",
      message: `Codex execution failed. Handoff: ${handoffPath}`,
    });
  } catch (error) {
    updateRunStatus(params.backlogDir, params.run.id, "blocked", error instanceof Error ? error.message : String(error));
    throw error;
  }
}
