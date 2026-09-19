# Qwirkle Go — Status & Roadmap
_Portfolio audit: 2026-07-11. State refreshed: 2026-09-19._

## What this is
A browser-based multiplayer Qwirkle implementation (2–4 players) built with plain HTML/CSS/JS ES modules and Firebase Realtime Database — no framework, no build step, no custom server. Lobbies with join codes, ready checks, full live turn sync via RTDB transactions, a centralized rules engine (line legality, scoring, Qwirkle bonuses, end-game), plus a local Dev Sandbox Mode for QA without Firebase writes. Static-hosted on Vercel.

## Current state
This is one of the most mature projects in the portfolio: 45 commits, with the latest cleanup on 2026-07-11. The tracked working tree is clean apart from this roadmap file. Evidence of real engineering discipline:

- CI (`.github/workflows/ci.yml`) runs `node --test tests/*.node.test.mjs` on every push/PR.
- Three test files (~409 lines) cover rules, turn guards, and sandbox behavior, plus a browser harness at `tests/tests.html`.
- Thorough `README.md` (170 lines) and step-by-step `SETUP.md`, including an honest "Known Limitations" section (client-only architecture, best-effort presence, no anti-cheat backend).
- `.vercel/project.json` is present — the repo is linked to a Vercel project, so it is deployed or one `vercel --prod` away.
- Phase-1 hardening landed (ready checks, opening guard, dev gating, accessibility), and the quizzical-galileo UI redesign (3 themes, collapsible info panel, mobile layout) was integrated into `main`.

The July cleanup removed tracked `.vs/` data, added it to `.gitignore`, and committed the
`.github/agents/csharp-dotnet-janitor.agent.md` file.

Remaining warts, all cosmetic:

- `src/firebase-config.js` is tracked even though the README says to copy it from the `.example` file.
- No LICENSE file and no release tags.

## Definition of "finished"
This is a hobby game that is functionally complete — solidly in "done, enjoy it" territory. "Finished" means: a few real multiplayer sessions played end-to-end on the deployed URL without a rules or sync bug, a `v1.0` tag, and a README screenshot so the project presents well. No new features are required.

## Roadmap

### Phase 1 — Now (next 1-2 weeks)
- Play 2–3 full games with real people on the deployed Vercel URL; log any rules/sync issues found. This is the actual acceptance test.
- Decide on `src/firebase-config.js`: Firebase web config is not a secret, but tracking it while the README says "copy the example" is inconsistent — either untrack it or update the docs to say it ships committed.

### Phase 2 — Next (2-6 weeks)
- Add a LICENSE (MIT plus the existing MindWare trademark note) and a gameplay screenshot or GIF to the README.
- Tag `v1.0.0` and cut a GitHub release summarizing the feature set.
- Fix anything the play-test sessions surfaced — most likely candidates are reconnect edge cases and offline-skip grace-period tuning.

### Phase 3 — Later (optional/stretch)
- Spectator mode or rejoin-after-refresh polish.
- A simple bot opponent reusing the sandbox turn-simulation code.
- Sound/animation feedback on Qwirkle bonuses and end-game.

## Effort to "finished"
**S** — the game, tests, CI, docs, and deploy path all exist; what remains is play-testing, one config/documentation decision, and a version tag.
