# Qwirkle Go

Qwirkle Go is a lightweight, browser-based multiplayer Qwirkle implementation built with plain HTML/CSS/JavaScript and Firebase Realtime Database.

It is designed for honest casual play with friends and family: no backend server, no build step, and deployable as a static site on Vercel.

## Features

- Create or join lobbies with short uppercase join codes.
- Realtime lobby updates (players, host badge, player count).
- Host-only start flow for 2-4 players.
- Full live multiplayer turn sync via Firebase Realtime Database.
- Centralized Qwirkle rules engine:
  - 108-tile set generation (6 colors x 6 shapes x 3 copies)
  - opening group detection and deterministic first-player selection
  - move legality validation (line rules, contiguity, connectivity)
  - scoring (main + perpendicular lines)
  - Qwirkle bonuses (+6 per completed line of 6)
  - exchange legality checks
  - pass and fallback pass-end flow
  - end-game bonus (+6 when bag empty and rack emptied)
- Sparse coordinate board model (no giant fixed matrix).
- Session recovery support using local storage + Firebase anonymous auth persistence.
- Missing Firebase config handling via in-app setup screen (no white screen crash).
- Browser-based no-dependency rules test harness.

## Stack

- Plain HTML
- Plain CSS
- Plain JavaScript ES modules
- Firebase Anonymous Auth
- Firebase Realtime Database
- Static hosting on Vercel

No framework and no custom server are required.

## Multiplayer Architecture (High Level)

Each game is stored at `games/{JOIN_CODE}` in Realtime Database.

- `meta`: lifecycle/status (`lobby`, `in_progress`, `finished`), host, timestamps, revision.
- `players`: participant profiles and connection presence.
- `game`: board, bag, racks, scores, current turn, move history, pass count, winners/final standings.

Gameplay actions (start game, commit move, exchange, pass) use RTDB transactions against the game root to reduce stale-write races and duplicate submissions.

## Project Structure

- `index.html` app shell and screens (setup, landing, lobby, game)
- `styles.css` product UI styles
- `database.rules.json` Firebase Realtime Database rules
- `src/main.js` entrypoint
- `src/app.js` flow orchestration and UI actions
- `src/firebase.js` Firebase bootstrap/auth/database wrappers + presence
- `src/lobby.js` create/join/leave/start lobby logic
- `src/game.js` turn actions and transaction updates
- `src/rules.js` centralized rule engine
- `src/renderer.js` board/rack/score/lobby rendering
- `src/board.js` sparse board bounds and matrix helpers
- `src/rack.js` rack helpers
- `src/storage.js` local session persistence
- `src/state.js` local UI draft state
- `src/utils.js` shared helpers
- `tests/tests.html` browser test harness
- `tests/rules.test.js` rules test cases

## Run Locally

Because ES modules and Firebase CDN imports are used, run from a local web server instead of opening `index.html` directly from disk.

Example (PowerShell + Python):

```powershell
python -m http.server 8080
```

Then open:

- App: `http://localhost:8080/`
- Tests: `http://localhost:8080/tests/tests.html`

## Firebase Configuration

1. Copy `src/firebase-config.example.js` to `src/firebase-config.js`.
2. Fill in your Firebase web app config values.
3. Enable Anonymous Authentication in Firebase Authentication.
4. Create a Realtime Database.
5. Apply `database.rules.json` in Firebase Realtime Database Rules.

If config is missing or empty, the app shows a setup screen with these instructions.

## Deploy To Vercel

This repo is static-host-ready with no build step.

### Option A: GitHub import

1. Push repo to GitHub.
2. Import project in Vercel.
3. Use default static deployment settings.
4. Deploy.

### Option B: Vercel CLI

```bash
vercel
vercel --prod
```

## Gameplay Summary

- 2-4 players.
- Each starts with 6 tiles.
- First player is determined by largest valid opening group in rack.
- Tie-break for first player is deterministic join order.
- First move by starting player must use one of their largest opening groups.
- On each turn: place tiles in one row/column, exchange selected tiles (if legal), or pass.
- Scoring:
  - line length points for each affected line
  - +6 bonus per completed Qwirkle line (length 6)
  - +6 end-game bonus when a player empties rack and bag is empty
- End game:
  - primary: rack emptied while bag is empty
  - fallback: bag empty and all players pass consecutively

## Testing

Open `tests/tests.html` in a browser to run rule tests.

Covered cases include:

- tile count
- opening group detection
- first-player determination
- valid/invalid line rules
- gap/connectivity rejection
- scoring and perpendicular scoring
- Qwirkle bonus scoring
- end-game bonus scoring
- exchange legality

## Known Limitations

- This is a static frontend architecture with Firebase; it is not a fully authoritative anti-cheat backend.
- Firebase rules and transactional writes reduce accidental corruption and obvious abuse, but cannot provide perfect cheat resistance in a client-only model.
- Presence and reconnect handling are practical best-effort for casual multiplayer, not enterprise-grade session orchestration.

## Notes

Qwirkle is a registered trademark of MindWare. This project is an unofficial fan-made implementation.
