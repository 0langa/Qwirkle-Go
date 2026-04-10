// ─── Theme system ────────────────────────────────────────────────────────────
// Manages UI themes via data-theme attribute on <html>.
// Persists selection to localStorage.

const STORAGE_KEY = "qwirkle.theme";

export const THEMES = [
  { id: "light",    label: "Hell" },
  { id: "dark",     label: "Dunkel" },
  { id: "tabletop", label: "Spieltisch" },
];

export function getTheme() {
  try {
    return localStorage.getItem(STORAGE_KEY) || "light";
  } catch (_) {
    return "light";
  }
}

export function applyTheme(id) {
  const valid = THEMES.find((t) => t.id === id) ? id : "light";
  document.documentElement.setAttribute("data-theme", valid);
  try {
    localStorage.setItem(STORAGE_KEY, valid);
  } catch (_) {}
  return valid;
}

export function cycleTheme() {
  const current = getTheme();
  const idx     = THEMES.findIndex((t) => t.id === current);
  const next    = THEMES[(idx + 1) % THEMES.length];
  applyTheme(next.id);
  return next;
}

export function initTheme() {
  applyTheme(getTheme());
}
