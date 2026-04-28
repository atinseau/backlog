import type { Agent, RetryPolicy } from "@backlog/schemas";

// Pure retry-loop helper. Given a callback that performs one attempt
// and returns its outcome, plus the agent's retry_policy, decides
// whether to call the callback again with feedback. Stays a pure
// function so we can unit-test the policy logic without driving real
// executor processes.
//
// Wiring into run-launcher.ts is a separate change — the loop here
// is the contract; the launcher will compose it with executeAgentRun
// and the failure-detection path once we agree on the shape.

export interface AttemptOutcome {
  // Whether this attempt finished cleanly (run.succeeded or
  // awaiting_review). If false, the loop considers a retry.
  ok: boolean;
  // For failed attempts, the text we feed back into the next prompt
  // (executor stderr + handoff). Concatenated, deduplicated, trimmed
  // to a max size by the caller before passing to retry.
  feedback?: string;
}

export interface RunWithRetryParams {
  policy: RetryPolicy;
  // 1-indexed: first call is attempt 1.
  attempt: (input: { attemptNumber: number; priorFeedback: string | null }) => Promise<AttemptOutcome>;
}

export interface RunWithRetryResult {
  // Total number of attempts made (1 if the first attempt succeeded;
  // up to policy.max_attempts if the agent kept failing).
  attempts: number;
  // Whether the final attempt was ok.
  ok: boolean;
  // The feedback from the last failed attempt, if any. The caller
  // surfaces this to the human reviewer when ok=false.
  lastFeedback?: string;
}

export async function runWithRetry(params: RunWithRetryParams): Promise<RunWithRetryResult> {
  const { policy } = params;
  const max = policy.mode === "feedback" ? Math.max(1, policy.max_attempts) : 1;

  let priorFeedback: string | null = null;
  let lastFeedback: string | undefined;

  for (let attemptNumber = 1; attemptNumber <= max; attemptNumber++) {
    const outcome = await params.attempt({ attemptNumber, priorFeedback });
    if (outcome.ok) {
      return { attempts: attemptNumber, ok: true };
    }
    lastFeedback = outcome.feedback;
    if (attemptNumber === max) break;
    // Prepare the next attempt's feedback. mode=none was already
    // collapsed via max=1 above; this path only runs for mode=feedback.
    priorFeedback = outcome.feedback ?? "(no feedback captured)";
  }

  const result: RunWithRetryResult = { attempts: max, ok: false };
  if (lastFeedback !== undefined) result.lastFeedback = lastFeedback;
  return result;
}

// Convenience: derive the policy from the agent, with the historical
// default (no retry) for agents that don't set it.
export function retryPolicyForAgent(agent: Agent): RetryPolicy {
  return agent.retry_policy ?? { mode: "none", max_attempts: 1, reuse_worktree: true };
}
