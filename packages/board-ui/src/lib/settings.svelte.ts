// Local app preferences — frontend-only, persisted in localStorage.
// Distinct from workspace settings (autonomy / claims) which live in
// config.toml on disk and are managed by the Permissions section.
// These are per-device choices about how the Backlog UI looks and
// behaves for this user.

const STORAGE_PREFIX = "backlog.settings.";
const KEY_SHOW_REVIEW = `${STORAGE_PREFIX}show_review_column`;
const KEY_NOTIFY_ON_RUN_COMPLETE = `${STORAGE_PREFIX}notify_on_run_complete`;
const KEY_ONBOARDING_DISMISSED = "backlog.onboarding.dismissed";

// Keys that get cleared by "Reset local settings". We list them here
// rather than wildcarding so we don't accidentally drop values stored
// by other Backlog code we forgot about (e.g. workspace-keyed chat
// history). A targeted list is safer.
const APP_PREFERENCE_KEYS = [
  KEY_SHOW_REVIEW,
  KEY_NOTIFY_ON_RUN_COMPLETE,
  KEY_ONBOARDING_DISMISSED,
  "backlog.locale",
  "backlog.theme.mode",
  "backlog.shell.left.open",
  "backlog.shell.right.open",
  "backlog.shell.bottom.open",
  "backlog.shell.left.width",
  "backlog.shell.right.width",
  "backlog.shell.bottom.height",
  "backlog.activity.open",
  "backlog.chat.open",
  "backlog.selected_repo_id",
  "backlog.selected_project_id",
];

// Per-workspace chat history is stored under "backlog.chat.history.<ws-id>".
// Cleared with a wildcard sweep below.
const CHAT_HISTORY_PREFIX = "backlog.chat.history.";

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
let notifyOnRunComplete = $state(readBool(KEY_NOTIFY_ON_RUN_COMPLETE, false));

export function getShowReviewColumn(): boolean {
  return showReviewColumn;
}
export function setShowReviewColumn(value: boolean): void {
  showReviewColumn = value;
  writeBool(KEY_SHOW_REVIEW, value);
}

export function getNotifyOnRunComplete(): boolean {
  return notifyOnRunComplete;
}
export function setNotifyOnRunComplete(value: boolean): void {
  notifyOnRunComplete = value;
  writeBool(KEY_NOTIFY_ON_RUN_COMPLETE, value);
}

export function resetOnboarding(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(KEY_ONBOARDING_DISMISSED);
  // Force a refresh so App.svelte re-reads the dismissed flag.
  window.location.reload();
}

export function clearChatHistory(): void {
  if (typeof localStorage === "undefined") return;
  const toDelete: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(CHAT_HISTORY_PREFIX)) toDelete.push(key);
  }
  for (const key of toDelete) localStorage.removeItem(key);
}

export function resetAllLocalSettings(): void {
  if (typeof localStorage === "undefined") return;
  for (const key of APP_PREFERENCE_KEYS) localStorage.removeItem(key);
  clearChatHistory();
  window.location.reload();
}
