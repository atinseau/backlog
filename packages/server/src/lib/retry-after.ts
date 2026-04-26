import type { ClaimRecord } from "@backlog/schemas";

export type BlockingStatus = "active" | "overdue";

export interface RetryHint {
  retry_after_seconds: number;
  blocking_status: BlockingStatus;
  source: "expected_finish_at" | "expires_at" | "fallback";
}

const DEFAULT_FALLBACK_SECONDS = 60;

export function computeRetryAfter(
  blocking: ClaimRecord,
  options: { now?: number; fallbackSeconds?: number } = {},
): RetryHint {
  const now = options.now ?? Date.now();
  const fallbackSeconds = options.fallbackSeconds ?? DEFAULT_FALLBACK_SECONDS;

  if (blocking.expected_finish_at) {
    const ms = new Date(blocking.expected_finish_at).getTime() - now;
    if (ms > 0) {
      return {
        retry_after_seconds: Math.ceil(ms / 1000),
        blocking_status: "active",
        source: "expected_finish_at",
      };
    }
  }

  const expiresMs = new Date(blocking.expires_at).getTime() - now;
  if (expiresMs > 0) {
    const overdueByEstimate = Boolean(blocking.expected_finish_at);
    return {
      retry_after_seconds: Math.ceil(expiresMs / 1000),
      blocking_status: overdueByEstimate ? "overdue" : "active",
      source: "expires_at",
    };
  }

  return {
    retry_after_seconds: fallbackSeconds,
    blocking_status: "overdue",
    source: "fallback",
  };
}
