---
name: UI/UX Redesign — themes, info panel, mobile layout
description: Major in-game UI overhaul done in worktree quizzical-galileo. Board-centric layout, 3 themes, collapsible info panel, mobile-first.
type: project
---

Board-centric UI redesign implemented in branch `claude/quizzical-galileo`.

**Why:** Game UI felt overloaded; board/rack didn't dominate; no theme support; mobile experience was cramped.

**How to apply:** When continuing this work, check the branch for the current state before suggesting further changes.

**What was implemented:**
- `src/theme.js` — new module: 3 themes (light/dark/tabletop), localStorage persistence, `initTheme()` / `cycleTheme()` API
- `index.html` — restructured game screen: `topbar-start`/`topbar-end` split, `data-theme="light"` on `<html>`, `id="info-panel"` on sidebar, `id="info-panel-backdrop"`, `#info-panel-btn` (☰), `#theme-cycle-btn` (☀)
- `styles.css` — complete rewrite: CSS custom properties for all 3 themes on `:root[data-theme="..."]`, new `game-body` grid (`1fr 172px`), `.info-panel` replaces `.scores-sidebar`, info panel is `position:fixed` overlay on ≤900px, zoom controls hidden on ≤600px, `btn-icon-only` class, backdrop animation
- `src/ui.js` — added `infoPanelBtn` and `themeCycleBtn` element refs
- `src/app.js` — imports `initTheme/cycleTheme/getTheme/THEMES`, adds `toggleInfoPanel()`, `closeInfoPanel()`, `handleCycleTheme()`, `updateThemeBtnTitle()`, MOBILE_BREAKPOINT matchMedia listener, called `initTheme()` in `startApp()`

**Game logic fully preserved** — drag/drop, rack placement, sandbox, Firebase, turn flow all untouched.
