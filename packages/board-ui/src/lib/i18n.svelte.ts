import en from "./i18n/en.json";
import fr from "./i18n/fr.json";

export type Locale = "fr" | "en";

const LOCALES: Record<Locale, Record<string, string>> = { fr, en };
const STORAGE_KEY = "backlog.locale";

function detectInitialLocale(): Locale {
  if (typeof window === "undefined") return "fr";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "fr" || stored === "en") return stored;
  const navLang = window.navigator.language?.slice(0, 2).toLowerCase();
  return navLang === "en" ? "en" : "fr";
}

let current = $state<Locale>(detectInitialLocale());

export function getLocale(): Locale {
  return current;
}

export function setLocale(next: Locale): void {
  current = next;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, next);
  }
}

// Reactive accessor — components read this and re-render when locale changes.
export function locale(): Locale {
  return current;
}

// t("some.key", { name: "x" }) — returns the localized string with
// {placeholders} substituted. Falls back to the key itself if missing,
// so a missing translation is visible but doesn't crash.
export function t(key: string, vars: Record<string, string | number> = {}): string {
  const dict = LOCALES[current] ?? LOCALES.fr;
  let value = dict[key] ?? LOCALES.fr[key] ?? key;
  for (const [name, replacement] of Object.entries(vars)) {
    value = value.replace(new RegExp(`\\{${name}\\}`, "g"), String(replacement));
  }
  return value;
}
