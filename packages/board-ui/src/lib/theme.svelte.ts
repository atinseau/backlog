// Theme controller — three modes (auto / dark / light) persisted in
// localStorage. "auto" follows the OS `prefers-color-scheme` media
// query and stays in sync if the user flips system appearance while
// the app is open. The resolved theme ("dark" or "light") is mirrored
// onto <html data-theme="…"> so plain CSS can target it without
// listening to media queries itself.

export type ThemeMode = "auto" | "dark" | "light";
export type ResolvedTheme = "dark" | "light";

const STORAGE_KEY = "backlog.theme.mode";

function readStoredMode(): ThemeMode {
  if (typeof window === "undefined") return "auto";
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === "auto" || raw === "dark" || raw === "light") return raw;
  return "auto";
}

function detectSystem(): ResolvedTheme {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const initialMode = readStoredMode();
const initialResolved: ResolvedTheme = initialMode === "auto" ? detectSystem() : initialMode;

let mode = $state<ThemeMode>(initialMode);
let resolved = $state<ResolvedTheme>(initialResolved);

function applyDocumentAttribute(value: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", value);
  // Also tell the UA so native widgets (scrollbars, form controls) use
  // the right palette without us styling them manually.
  document.documentElement.style.colorScheme = value;
}

let mediaQuery: MediaQueryList | null = null;
function ensureSystemListener(): void {
  if (mediaQuery || typeof window === "undefined" || !window.matchMedia) return;
  mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => {
    if (mode === "auto") {
      resolved = detectSystem();
      applyDocumentAttribute(resolved);
    }
  };
  // Modern API; fall back to addListener for very old browsers.
  if (typeof mediaQuery.addEventListener === "function") {
    mediaQuery.addEventListener("change", handler);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mediaQuery as any).addListener(handler);
  }
}

// Initialise on first import (renderer-side only).
if (typeof window !== "undefined") {
  applyDocumentAttribute(initialResolved);
  ensureSystemListener();
}

export function getThemeMode(): ThemeMode {
  return mode;
}
export function getResolvedTheme(): ResolvedTheme {
  return resolved;
}
// Reactive accessor for components that want to re-render on change.
export function themeMode(): ThemeMode {
  return mode;
}
export function setThemeMode(next: ThemeMode): void {
  mode = next;
  if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, next);
  resolved = next === "auto" ? detectSystem() : next;
  applyDocumentAttribute(resolved);
}
