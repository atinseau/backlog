import { listActiveClaims } from "@backlog/claims";
import { getSubTask } from "../subtask-service.js";
import { getTask } from "../task-service.js";
import { listTraces } from "../trace-store.js";
import type { McpToolDefinition, McpToolOutcome } from "./server.js";

// The reads an execution agent needs about its own ticket. Each tool maps 1:1
// onto an existing CLI command and calls the same core service that command
// calls (spec D1, D3) — no new read path, just this one exposed over MCP.

function requireString(input: unknown, key: string): string {
  const args = (input ?? {}) as Record<string, unknown>;
  const value = String(args[key] ?? "").trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

export const READ_TOOLS: McpToolDefinition[] = [
  {
    name: "task_show",
    description:
      "Read one ticket: its status, priority, description, acceptance criteria and dependencies. Call it on your own BACKLOG_TASK_ID before you start, and on any task id you discover you depend on.",
    inputSchema: {
      type: "object",
      properties: { task_id: { type: "string", description: "Task id, e.g. task_017." } },
      required: ["task_id"],
    },
  },
  {
    name: "subtask_show",
    description:
      "Read the unit of work this run is scoped to: its scopes, claim mode, dependencies and completion criteria. Only a subtask-scoped run has one — BACKLOG_SUBTASK_ID is absent on a task-level run.",
    inputSchema: {
      type: "object",
      properties: { subtask_id: { type: "string", description: "Subtask id, e.g. sub_004." } },
      required: ["subtask_id"],
    },
  },
  {
    name: "trace_show",
    description:
      "What earlier runs on this ticket decided, and why. Read it before you start: it is the only record of reasoning that survives a run, and re-deciding what a previous run already settled is the failure this exists to prevent.",
    inputSchema: {
      type: "object",
      properties: { task_id: { type: "string", description: "Task id, e.g. task_017." } },
      required: ["task_id"],
    },
  },
  {
    name: "claim_list",
    description:
      "Which paths other agents currently hold. Do not edit a path someone else holds. Claims expire and are taken during a run, so this can change under you — read it again before touching anything outside your own scopes.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
];

export interface ReadToolCall {
  backlogDir: string;
  name: string;
  input: unknown;
}

/** Run one read tool. Never throws: a failure comes back as `ok: false` with a
 *  message the model can read and act on, exactly like the agent and
 *  orchestrator dispatchers. */
export async function callReadTool(call: ReadToolCall): Promise<McpToolOutcome> {
  try {
    switch (call.name) {
      case "task_show": {
        const id = requireString(call.input, "task_id");
        const task = getTask(call.backlogDir, id);
        if (!task) throw new Error(`Unknown task: ${id}`);
        return { ok: true, result: { task } };
      }
      case "subtask_show": {
        const id = requireString(call.input, "subtask_id");
        const subtask = getSubTask(call.backlogDir, id);
        if (!subtask) throw new Error(`Unknown subtask: ${id}`);
        return { ok: true, result: { subtask } };
      }
      case "trace_show": {
        const id = requireString(call.input, "task_id");
        const traces = listTraces(call.backlogDir, id);
        return { ok: true, result: { task_id: id, count: traces.length, traces } };
      }
      case "claim_list": {
        const claims = listActiveClaims(call.backlogDir);
        return { ok: true, result: { count: claims.length, claims } };
      }
      default:
        throw new Error(
          `Unknown tool: ${call.name}. The read surface is: ${READ_TOOLS.map((t) => t.name).join(", ")}.`,
        );
    }
  } catch (error) {
    return { ok: false, result: { error: error instanceof Error ? error.message : String(error) } };
  }
}
