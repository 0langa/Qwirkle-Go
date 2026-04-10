/**
 * Theme system for Qwirkle Go.
 *
 * Provides multiple visual themes and persists the user's choice
 * in localStorage.  The active theme is applied by setting a
 * `data-theme` attribute on `<html>`.
 */

const STORAGE_KEY = "qwirkle.theme";

export const THEMES = [
  { id: "light",          label: "Hell",          icon: "☀️" },
  { id: "dark",           label: "Dunkel",        icon: "🌙" },
  { id: "tabletop",       label: "Spieltisch",    icon: "🎲" },
  { id: "high-contrast",  label: "Kontrast",      icon: "👁️" },
];

const DEFAULT_THEME = "light";

/** Return the persisted theme id (or default). */
export function loadTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && THEMES.some((t) => t.id === stored)) return stored;
  } catch (_) { /* ignore */ }
  return DEFAULT_THEME;
}

/** Persist + apply a theme. */
export function applyTheme(themeId) {
  const valid = THEMES.some((t) => t.id === themeId);
  const id = valid ? themeId : DEFAULT_THEME;
  document.documentElement.setAttribute("data-theme", id);
  try { localStorage.setItem(STORAGE_KEY, id); } catch (_) { /* ignore */ }
  return id;
}

/** Initialise theme on page load. */
export function initTheme() {
  return applyTheme(loadTheme());
}
