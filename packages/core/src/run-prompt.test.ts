import { describe, expect, it } from "bun:test";
import type { Task } from "@backlog/schemas";
import { buildProviderPrompt } from "./run-prompt.js";
import type { ExecutionTarget } from "./execution-target.js";

const workItem = {
  id: "task_001",
  title: "Rename the widget",
  description: "",
  status: "in_progress",
  acceptance_criteria: [],
} as unknown as Task;

const target = {
  id: "subtask_001",
  title: "Rename it in the board",
  target_type: "subtask",
  repo: "backlog",
  risk: "low",
  scopes: ["packages/board-ui/**"],
  depends_on: [],
  completion: { done_when: [] },
  planner: { origin: "explicit" },
} as unknown as ExecutionTarget;

describe("buildProviderPrompt", () => {
  it("discloses the ids the agent's environment carries", () => {
    const prompt = buildProviderPrompt(target, workItem);

    expect(prompt).toContain("BACKLOG_TASK_ID");
    expect(prompt).toContain("BACKLOG_SUBTASK_ID");
    expect(prompt).toContain("BACKLOG_RUN_ID");
  });

  it("states the trace contract", () => {
    const prompt = buildProviderPrompt(target, workItem);

    expect(prompt).toContain("trace_write");
    expect(prompt).toContain("rejection_reason");
    expect(prompt).toContain("open_question");
  });

  it("does not advertise the CLI as a channel", () => {
    const prompt = buildProviderPrompt(target, workItem);
    expect(prompt).not.toContain("on your PATH");
    expect(prompt).not.toContain("backlog task show");
  });

  it("names the tools the run actually has", () => {
    const prompt = buildProviderPrompt(target, workItem);
    for (const name of ["task_show", "subtask_show", "trace_show", "claim_list", "trace_write"]) {
      expect(prompt).toContain(name);
    }
  });

  it("tells the agent that blocking is how it asks for help", () => {
    const prompt = buildProviderPrompt(target, workItem);

    expect(prompt.toLowerCase()).toContain("blocked");
  });

  it("keeps the trace contract reachable from the instruction list too", () => {
    const prompt = buildProviderPrompt(target, workItem);
    // Bounded on both sides: sliced only from "Instructions:" onwards, this
    // would swallow the trace section itself and pass no matter what.
    const instructions = prompt.slice(
      prompt.indexOf("Instructions:"),
      prompt.indexOf("Recording your work"),
    );

    expect(instructions).toContain("trace");
  });

  it("names the required fields of constraints, decisions and discovered_deps", () => {
    const prompt = buildProviderPrompt(target, workItem);

    // constraints: {statement, evidence, confidence}, confidence has no default
    expect(prompt).toContain("confidence");
    expect(prompt).toContain("verified");
    expect(prompt).toContain("observed");
    // decisions: {chose, rejected, because} — `because`, not `why`
    expect(prompt).toContain("because");
    // discovered_deps: discriminated union on `kind`
    expect(prompt).toContain("kind");
    expect(prompt).toContain("proposal");
  });
});
