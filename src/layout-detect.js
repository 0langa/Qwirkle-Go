/**
 * Mobile / display-mode detection for Qwirkle Go.
 *
 * Sets `data-layout` on <html> to one of:
 *   "desktop" | "tablet" | "mobile"
 *
 * Uses viewport dimensions, pointer capabilities and orientation
 * to decide the layout mode.  The mode is re-evaluated on resize
 * and orientation change.
 */

const BREAKPOINT_MOBILE  = 640;
const BREAKPOINT_TABLET  = 1024;

let currentMode = "desktop";
let listeners = [];

function detect() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const portrait = vh > vw;

  // Pure width-based first pass
  let mode = "desktop";
  if (vw <= BREAKPOINT_MOBILE) {
    mode = "mobile";
  } else if (vw <= BREAKPOINT_TABLET) {
    mode = "tablet";
  }

  // A coarse pointer in portrait on a medium screen → treat as mobile
  if (coarse && portrait && vw <= BREAKPOINT_TABLET) {
    mode = "mobile";
  }

  // Very short viewport (landscape phone) → mobile
  if (vh <= 500 && coarse) {
    mode = "mobile";
  }

  return mode;
}

function apply(mode) {
  if (mode === currentMode) return;
  currentMode = mode;
  document.documentElement.setAttribute("data-layout", mode);
  for (const fn of listeners) fn(mode);
}

/** Register a callback for layout mode changes. */
export function onLayoutChange(fn) {
  listeners.push(fn);
}

/** Current layout mode. */
export function getLayoutMode() {
  return currentMode;
}

/** Initialise detection; returns the first detected mode. */
export function initLayoutDetection() {
  const mode = detect();
  currentMode = mode;
  document.documentElement.setAttribute("data-layout", mode);

  const update = () => apply(detect());

  window.addEventListener("resize", update);
  window.addEventListener("orientationchange", () => {
    // Delay slightly after orientation change for dimensions to settle
    setTimeout(update, 120);
  });

  // Also listen for matchMedia changes on key queries
  try {
    const mql = window.matchMedia(`(max-width: ${BREAKPOINT_MOBILE}px)`);
    mql.addEventListener("change", update);
    const mql2 = window.matchMedia(`(max-width: ${BREAKPOINT_TABLET}px)`);
    mql2.addEventListener("change", update);
  } catch (_) { /* old browsers */ }

  return mode;
}
