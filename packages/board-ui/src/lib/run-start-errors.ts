import type { StartRunResult } from "./api.js";
import { t } from "./i18n.svelte.js";

export type StartRunAction = "api_keys" | "agents" | "repositories" | "git" | "direct_dirty" | null;

export interface StartRunExplanation {
  message: string;
  action: StartRunAction;
}

export function explainStartRunResult(result: StartRunResult): StartRunExplanation | null {
  if (result.started.length > 0) return null;

  const allReasons = [
    ...(result.skipped[0]?.reasons ?? []),
    ...(result.blocked[0]?.reasons ?? []),
    ...(result.waiting[0]?.reasons ?? []),
  ];
  const directReasons = allReasons.flatMap((reason) => {
    const match = reason.match(/^agent_blocked:[^:]+:(.+)$/);
    return match ? [match[1]!] : [reason];
  });

  const hasCapacityReason = directReasons.includes("at_capacity") || directReasons.includes("no_agent_capacity");
  const apiKeyReason = directReasons.find((reason) => reason.startsWith("missing_api_key:"));
  if (hasCapacityReason) return { message: t("card.play_at_capacity"), action: null };
  if (apiKeyReason) return { message: t("card.play_no_api_key"), action: "api_keys" };
  if (directReasons.includes("risk_not_allowed")) return { message: t("card.play_risk_not_allowed"), action: null };
  if (directReasons.some((reason) => reason.startsWith("missing_capabilities:"))) return { message: t("card.play_missing_capabilities"), action: null };
  if (directReasons.includes("no_repository_configured")) return { message: t("card.play_no_repository"), action: "repositories" };
  if (directReasons.includes("repository_has_no_local_checkout")) return { message: t("card.play_repository_missing_checkout"), action: "repositories" };
  if (directReasons.includes("repo_not_allowed") || directReasons.includes("repo_no_access")) return { message: t("card.play_repo_blocked"), action: "repositories" };
  // `missing_executable:<command>` is what providers emit today; the two
  // provider-specific codes predate it and still appear on archived runs.
  if (
    directReasons.some((reason) => reason.startsWith("missing_executable:")) ||
    directReasons.includes("missing_claude_executable") ||
    directReasons.includes("missing_codex_executable")
  ) {
    return { message: t("card.play_missing_executable"), action: "agents" };
  }
  if (directReasons.includes("direct_checkout_dirty")) return { message: t("card.play_direct_dirty"), action: "direct_dirty" };
  if (directReasons.includes("direct_checkout_detached_head")) return { message: t("card.play_detached_head"), action: "git" };
  if (directReasons.includes("direct_checkout_busy")) return { message: t("card.play_direct_busy"), action: null };
  if (directReasons.includes("unknown_repo")) return { message: t("card.play_unknown_repo"), action: "repositories" };
  if (directReasons.includes("autonomy_mode_observe")) return { message: t("card.play_autonomy_observe"), action: null };
  if (directReasons.includes("high_risk_requires_higher_autonomy")) return { message: t("card.play_high_risk"), action: null };
  if (directReasons.includes("no_scheduler_capacity")) return { message: t("card.play_scheduler_capacity"), action: null };
  if (directReasons.some((reason) => reason.startsWith("scope_conflict_with"))) return { message: t("card.play_scope_conflict"), action: null };
  if (directReasons.some((reason) => reason.startsWith("waiting_on:"))) return { message: t("card.play_waiting_on"), action: null };
  if (directReasons.some((reason) => reason.startsWith("dependency_failed:"))) return { message: t("card.play_dependency_failed"), action: null };
  if (directReasons.includes("no_compatible_agent")) return { message: t("card.play_no_agent"), action: "agents" };
  if (allReasons.length > 0) return { message: t("card.play_skipped", { reason: allReasons[0] }), action: null };
  return { message: t("card.play_skipped_empty"), action: null };
}
