import { describe, expect, it } from "bun:test";
import { runWithRetry } from "./retry.js";

describe("runWithRetry", () => {
  it("calls the attempt exactly once when policy.mode is 'none', regardless of outcome", async () => {
    let calls = 0;
    const result = await runWithRetry({
      policy: { mode: "none", max_attempts: 5, reuse_worktree: true },
      attempt: async () => {
        calls++;
        return { ok: false, feedback: "boom" };
      },
    });
    expect(calls).toBe(1);
    expect(result.attempts).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.lastFeedback).toBe("boom");
  });

  it("retries up to max_attempts when 'feedback' mode keeps failing", async () => {
    let calls = 0;
    const seen: string[] = [];
    const result = await runWithRetry({
      policy: { mode: "feedback", max_attempts: 3, reuse_worktree: true },
      attempt: async ({ attemptNumber, priorFeedback }) => {
        calls++;
        seen.push(`#${attemptNumber}: ${priorFeedback ?? "no prior"}`);
        return { ok: false, feedback: `err on ${attemptNumber}` };
      },
    });
    expect(calls).toBe(3);
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(3);
    expect(seen).toEqual([
      "#1: no prior",
      "#2: err on 1",
      "#3: err on 2",
    ]);
  });

  it("stops as soon as an attempt succeeds (no further retries)", async () => {
    let calls = 0;
    const result = await runWithRetry({
      policy: { mode: "feedback", max_attempts: 5, reuse_worktree: true },
      attempt: async ({ attemptNumber }) => {
        calls++;
        return attemptNumber >= 2 ? { ok: true } : { ok: false, feedback: "warming up" };
      },
    });
    expect(calls).toBe(2);
    expect(result).toEqual({ attempts: 2, ok: true });
  });

  it("preserves the LAST feedback (the most recent failure) when all attempts fail", async () => {
    const result = await runWithRetry({
      policy: { mode: "feedback", max_attempts: 3, reuse_worktree: true },
      attempt: async ({ attemptNumber }) => ({ ok: false, feedback: `attempt ${attemptNumber}` }),
    });
    expect(result.lastFeedback).toBe("attempt 3");
  });

  it("treats max_attempts=1 in feedback mode the same as mode=none (one shot)", async () => {
    let calls = 0;
    await runWithRetry({
      policy: { mode: "feedback", max_attempts: 1, reuse_worktree: true },
      attempt: async () => {
        calls++;
        return { ok: false };
      },
    });
    expect(calls).toBe(1);
  });

  it("propagates the priorFeedback into successive attempts so the agent sees its own mistake", async () => {
    const seenFeedback: (string | null)[] = [];
    await runWithRetry({
      policy: { mode: "feedback", max_attempts: 4, reuse_worktree: true },
      attempt: async ({ priorFeedback }) => {
        seenFeedback.push(priorFeedback);
        return { ok: false, feedback: "still broken" };
      },
    });
    // First call: no prior. Subsequent: each carries the previous feedback.
    expect(seenFeedback[0]).toBeNull();
    for (let i = 1; i < seenFeedback.length; i++) {
      expect(seenFeedback[i]).toBe("still broken");
    }
  });
});
