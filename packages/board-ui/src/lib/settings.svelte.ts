// Local app preferences — frontend-only, persisted in localStorage.
// Project settings such as board columns / review policy live in
// config.toml on disk and are loaded explicitly by App.svelte.
// The helpers below still expose reactive state for the UI, but the
// project-scoped toggles are not persisted to localStorage anymore.

const STORAGE_PREFIX = "backlog.settings.";
const LEGACY_KEY_SHOW_BACKLOG = `${STORAGE_PREFIX}show_backlog_column`;
const LEGACY_KEY_SHOW_REVIEW = `${STORAGE_PREFIX}show_review_column`;
const KEY_NOTIFY_ON_RUN_COMPLETE = `${STORAGE_PREFIX}notify_on_run_complete`;
const LEGACY_KEY_DISPLAY_NAME = `${STORAGE_PREFIX}display_name`;
const KEY_ONBOARDING_DISMISSED = "backlog.onboarding.dismissed";

// Keys that get cleared by "Reset local settings". We list them here
// rather than wildcarding so we don't accidentally drop values stored
// by other Backlog code we forgot about (e.g. project-keyed chat
// history). A targeted list is safer.
const APP_PREFERENCE_KEYS = [
  LEGACY_KEY_SHOW_BACKLOG,
  LEGACY_KEY_SHOW_REVIEW,
  KEY_NOTIFY_ON_RUN_COMPLETE,
  LEGACY_KEY_DISPLAY_NAME,
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

// Per-project chat history is stored under "backlog.chat.history.<ws-id>".
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

// Board-column visibility is project-scoped. App.svelte replaces these
// defaults with /project settings as soon as a project is selected.
let showBacklogColumn = $state(true);
let showReviewColumn = $state(false);
let notifyOnRunComplete = $state(readBool(KEY_NOTIFY_ON_RUN_COMPLETE, false));

export function getShowBacklogColumn(): boolean {
  return showBacklogColumn;
}
export function setShowBacklogColumn(value: boolean): void {
  showBacklogColumn = value;
}

export function getShowReviewColumn(): boolean {
  return showReviewColumn;
}
export function setShowReviewColumn(value: boolean): void {
  showReviewColumn = value;
}

export function getNotifyOnRunComplete(): boolean {
  return notifyOnRunComplete;
}
export function setNotifyOnRunComplete(value: boolean): void {
  notifyOnRunComplete = value;
  writeBool(KEY_NOTIFY_ON_RUN_COMPLETE, value);
}

// Compute 1-2 letter initials for the account avatar. Prefer the
// Cloud profile display name when it exists, then fall back to the
// email local-part.
export function deriveInitials(email: string | null | undefined, displayName?: string | null): string {
  if (displayName?.trim()) {
    const parts = displayName.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
    if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  }
  if (!email) return "?";
  const local = email.split("@")[0] ?? "";
  if (!local) return "?";
  const split = local.split(/[._\-+]+/).filter(Boolean);
  if (split.length >= 2) return (split[0]![0]! + split[1]![0]!).toUpperCase();
  // Fall back on a camelCase split for compact handles.
  const camel = local.replace(/([a-z])([A-Z])/g, "$1 $2").split(" ");
  if (camel.length >= 2) return (camel[0]![0]! + camel[1]![0]!).toUpperCase();
  return local.slice(0, 2).toUpperCase();
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
