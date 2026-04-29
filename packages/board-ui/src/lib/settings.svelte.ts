// Local app preferences — frontend-only, persisted in localStorage.
// Distinct from workspace settings (autonomy / claims) which live in
// config.toml on disk and are managed by the Permissions section.
// These are per-device choices about how the Backlog UI looks and
// behaves for this user.

const STORAGE_PREFIX = "backlog.settings.";
const KEY_SHOW_REVIEW = `${STORAGE_PREFIX}show_review_column`;
const KEY_ONBOARDING_DISMISSED = "backlog.onboarding.dismissed";

function readBool(key: string, fallback: boolean): boolean {
  if (typeof localStorage === "undefined") return fallback;
  const raw = localStorage.getItem(key);
  if (raw === "1") return true;
  if (raw === "0") return false;
  return fallback;
}

function writeBool(key: string, value: boolean): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(key, value ? "1" : "0");
}

// "In Review" defaults to off — most teams collapse review into the
// "doing" column and only enable it when they have a dedicated review
// stage. When off, review-status cards still appear, merged into the
// doing column so no work goes invisible.
let showReviewColumn = $state(readBool(KEY_SHOW_REVIEW, false));

export function getShowReviewColumn(): boolean {
  return showReviewColumn;
}
export function setShowReviewColumn(value: boolean): void {
  showReviewColumn = value;
  writeBool(KEY_SHOW_REVIEW, value);
}

export function resetOnboarding(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(KEY_ONBOARDING_DISMISSED);
  // Force a refresh so App.svelte re-reads the dismissed flag.
  window.location.reload();
}
