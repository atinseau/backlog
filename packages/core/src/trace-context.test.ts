import { describe, expect, it } from "bun:test";
import { withTraceContextDefaults } from "./trace-context.js";

describe("withTraceContextDefaults", () => {
  it("fills version, ids and created_at from the environment", () => {
    const filled = withTraceContextDefaults(
      { outcome: "implemented", summary: "done" },
      { BACKLOG_RUN_ID: "run_1", BACKLOG_TASK_ID: "task_1", BACKLOG_SUBTASK_ID: "subtask_1" },
    );

    expect(filled.version).toBe(1);
    expect(filled.run_id).toBe("run_1");
    expect(filled.task_id).toBe("task_1");
    expect(filled.subtask_id).toBe("subtask_1");
    expect(typeof filled.created_at).toBe("string");
  });

  it("lets the payload win over the environment", () => {
    const filled = withTraceContextDefaults(
      { task_id: "task_9", created_at: "2020-01-01T00:00:00.000Z" },
      { BACKLOG_TASK_ID: "task_1" },
    );

    expect(filled.task_id).toBe("task_9");
    expect(filled.created_at).toBe("2020-01-01T00:00:00.000Z");
  });

  it("leaves a field absent when neither the payload nor the environment has it", () => {
    const filled = withTraceContextDefaults({ outcome: "implemented" }, {});

    expect("run_id" in filled).toBe(false);
    expect("subtask_id" in filled).toBe(false);
  });
});
