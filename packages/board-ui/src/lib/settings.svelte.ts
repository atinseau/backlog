// Local app preferences — frontend-only, persisted in localStorage.
// Distinct from workspace settings (autonomy / claims) which live in
// config.toml on disk and are managed by the Permissions section.
// These are per-device choices about how the Backlog UI looks and
// behaves for this user.

const STORAGE_PREFIX = "backlog.settings.";
const KEY_SHOW_REVIEW = `${STORAGE_PREFIX}show_review_column`;
const KEY_NOTIFY_ON_RUN_COMPLETE = `${STORAGE_PREFIX}notify_on_run_complete`;
const KEY_DISPLAY_NAME = `${STORAGE_PREFIX}display_name`;
const KEY_ONBOARDING_DISMISSED = "backlog.onboarding.dismissed";

// Keys that get cleared by "Reset local settings". We list them here
// rather than wildcarding so we don't accidentally drop values stored
// by other Backlog code we forgot about (e.g. workspace-keyed chat
// history). A targeted list is safer.
const APP_PREFERENCE_KEYS = [
  KEY_SHOW_REVIEW,
  KEY_NOTIFY_ON_RUN_COMPLETE,
  KEY_DISPLAY_NAME,
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
function readString(key: string): string {
  if (typeof localStorage === "undefined") return "";
  return localStorage.getItem(key) ?? "";
}
function writeString(key: string, value: string): void {
  if (typeof localStorage === "undefined") return;
  if (value) localStorage.setItem(key, value);
  else localStorage.removeItem(key);
}

let showReviewColumn = $state(readBool(KEY_SHOW_REVIEW, false));
let notifyOnRunComplete = $state(readBool(KEY_NOTIFY_ON_RUN_COMPLETE, false));
let displayName = $state(readString(KEY_DISPLAY_NAME));

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

export function getDisplayName(): string {
  return displayName;
}
export function setDisplayName(value: string): void {
  displayName = value.trim();
  writeString(KEY_DISPLAY_NAME, displayName);
}

// Compute 1-2 letter initials for the avatar. Priority order:
//   1. The user's explicit display name from Settings ("Jimmy Douieb" → JD)
//   2. Camel-case / separator split on the email local-part
//      ("jimmy.douieb@x" → JD, "jimmyDouieb@x" → JD)
//   3. First two letters of the local-part ("jimmydouieb@x" → JI)
export function deriveInitials(email: string | undefined): string {
  if (displayName) {
    const parts = displayName.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
    if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  }
  if (!email) return "?";
  const local = email.split("@")[0] ?? "";
  if (!local) return "?";
  const split = local.split(/[._\-+]+/).filter(Boolean);
  if (split.length >= 2) return (split[0]![0]! + split[1]![0]!).toUpperCase();
  // Fall back on a camelCase split (jimmyDouieb → ["jimmy","Douieb"]).
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
