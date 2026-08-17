import { describe, expect, it } from "bun:test";
import { taskSchema, taskStatusSchema } from "./task.js";

const base = {
  id: "task_009",
  title: "Split the store writer",
  status: "proposed" as const,
  priority: "P2" as const,
  planning: { split_status: "pending" as const, risk: "medium" as const },
  created_at: "2026-08-17T10:00:00.000Z",
  updated_at: "2026-08-17T10:00:00.000Z",
};

describe("proposed status", () => {
  it("accepts 'proposed' as a task status", () => {
    expect(taskStatusSchema.parse("proposed")).toBe("proposed");
  });

  it("carries provenance and defaults the audit to pending", () => {
    const task = taskSchema.parse({
      ...base,
      proposal: {
        origin_run_id: "run_004",
        origin_task_id: "task_002",
        motive: "The writer is not reentrant; found while editing state-files.",
      },
    });
    expect(task.proposal?.audit).toBe("pending");
  });

  it("keeps loading a task with no proposal block", () => {
    const task = taskSchema.parse({ ...base, status: "backlog" });
    expect(task.proposal).toBeUndefined();
  });
});
