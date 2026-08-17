import type { McpToolDefinition, McpToolOutcome } from "./mcp/server.js";
import { withTraceContextDefaults } from "./trace-context.js";
import { recordTrace } from "./trace-service.js";

// The tools an agent executing one ticket may call. A separate file from
// orchestrator-tools.ts, and a separate exported constant, because the whole
// safety property of this layer is that the two sets never merge: an execution
// agent holding `start_subtask` or `start_orchestrator` could launch further
// runs or duplicate itself — the runaway cycle the `proposed` status was built
// to close, re-entering through the MCP window (spec §2).
//
// One tool, deliberately. Reading stays on the CLI (`task show`, `trace show`,
// `claim list`), which works on every runtime; re-exposing it here would be
// work that only serves Claude Code (spec T1, §11).

const CONSTRAINT_SCHEMA = {
  type: "object",
  properties: {
    statement: { type: "string", description: "What is true, stated so a later run can act on it." },
    evidence: {
      type: "string",
      description: "Where you saw it: `path:line`, a test name, or a command's error output. No evidence, no entry.",
    },
    confidence: {
      type: "string",
      enum: ["verified", "observed"],
      description: "`verified` if you executed something that proved it; `observed` if you read code and interpreted it.",
    },
  },
  required: ["statement", "evidence", "confidence"],
} as const;

const DECISION_SCHEMA = {
  type: "object",
  properties: {
    chose: { type: "string", description: "The option you took." },
    rejected: { type: "string", description: "The option you did not take." },
    because: { type: "string", description: "Why. This is the part a later run cannot rediscover." },
  },
  required: ["chose", "rejected", "because"],
} as const;

const DISCOVERED_DEP_SCHEMA = {
  oneOf: [
    {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["existing"] },
        task_id: { type: "string", description: "Id of a task that already exists, e.g. task_017." },
      },
      required: ["kind", "task_id"],
    },
    {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["proposal"] },
        proposal: {
          type: "object",
          properties: {
            title: { type: "string" },
            motive: { type: "string", description: "Why this work is needed, in terms a human reviewer can judge." },
            scopes: { type: "array", items: { type: "string" }, description: "Path globs it expects to touch." },
          },
          required: ["title", "motive"],
        },
      },
      required: ["kind", "proposal"],
    },
  ],
} as const;

export const AGENT_TOOLS: McpToolDefinition[] = [
  {
    name: "trace_write",
    description:
      "Record what you decided on this ticket. This is the only channel that moves the ticket's status, and the only thing about this run that survives it. Call it once, before you finish. `outcome: blocked` is how you ask for help — there is no agent-to-agent channel. You cannot mark your own work done: `implemented` records the trace and lets the run's own success handling decide review-vs-complete.",
    inputSchema: {
      type: "object",
      properties: {
        outcome: {
          type: "string",
          enum: ["implemented", "rejected", "blocked"],
          description:
            "`implemented`: you did the work. `rejected`: the ticket should not be done, and you say why. `blocked`: you cannot proceed, and you state the open question.",
        },
        summary: { type: "string", description: "What happened, in a few sentences." },
        rejection_reason: { type: "string", description: "Required when outcome is `rejected`." },
        open_question: {
          type: "string",
          description: "Required when outcome is `blocked`. The question a human has to answer to unblock this.",
        },
        constraints: { type: "array", items: CONSTRAINT_SCHEMA },
        decisions: { type: "array", items: DECISION_SCHEMA },
        discovered_deps: {
          type: "array",
          items: DISCOVERED_DEP_SCHEMA,
          description:
            "Work this ticket turned out to depend on. An existing id becomes an edge; anything else becomes a proposed ticket a human reviews.",
        },
        consolidation_hint: {
          type: "string",
          enum: ["none", "high"],
          description: "`high` marks a trace worth reading when the project's documentation is next rewritten.",
        },
        consolidation_hint_reason: { type: "string", description: "Required when consolidation_hint is `high`." },
      },
      required: ["outcome", "summary"],
    },
  },
];

export function agentToolNames(): string[] {
  return AGENT_TOOLS.map((tool) => tool.name);
}

export interface AgentToolCall {
  backlogDir: string;
  name: string;
  input: unknown;
}

/**
 * Run one agent tool. Never throws: a failure comes back as `ok: false` with a
 * message the model can read and act on, exactly like the orchestrator side.
 *
 * The unknown-tool branch is the boundary's last line of defence. The host
 * built in `packages/cli/src/commands/mcp.ts` already advertises only
 * AGENT_TOOLS, and `handleMcpRequest` rejects a call to anything it did not
 * advertise — but a name that leaked into the advertised list through some
 * later refactor would still die here rather than dispatch. Guard the writer,
 * not only the readers.
 */
export async function callAgentTool(call: AgentToolCall): Promise<McpToolOutcome> {
  try {
    if (call.name !== "trace_write") {
      throw new Error(`Unknown tool: ${call.name}. An execution agent may only call: ${agentToolNames().join(", ")}.`);
    }
    const payload = (call.input ?? {}) as Record<string, unknown>;
    const trace = withTraceContextDefaults(payload, process.env);
    // `run_id` and `task_id` are filled from the run's environment and are
    // deliberately absent from inputSchema, so an agent has no sanctioned way to
    // supply them. When the environment did not reach this process, the raw Zod
    // error names two fields the model cannot see — an unrecoverable refusal.
    // Say what happened and grant the exception instead.
    if (trace.run_id === undefined || trace.task_id === undefined) {
      return {
        ok: false,
        result: {
          error:
            "The run context was not available to this tool, so `run_id` and `task_id` could not be filled in for you. Call trace_write again with both included explicitly: `run_id` is $BACKLOG_RUN_ID and `task_id` is $BACKLOG_TASK_ID in your environment.",
        },
      };
    }
    const result = recordTrace({
      backlogDir: call.backlogDir,
      trace,
    });
    return {
      ok: true,
      result: {
        recorded: true,
        task_id: result.trace.task_id,
        outcome: result.trace.outcome,
        transitions: result.transitions,
        linked_dependencies: result.linkedDeps,
        created_proposals: result.createdProposals,
      },
    };
  } catch (error) {
    return { ok: false, result: { error: error instanceof Error ? error.message : String(error) } };
  }
}
