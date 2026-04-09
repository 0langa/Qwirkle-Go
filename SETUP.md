# SETUP.md

This guide walks you from zero to a live multiplayer Qwirkle deployment on Vercel.

## 1. Create a Firebase Project

1. Open [https://console.firebase.google.com](https://console.firebase.google.com).
2. Click **Create a project**.
3. Finish the wizard.
4. In Project settings, add a **Web App** and copy its config values.

## 2. Enable Anonymous Authentication

1. In Firebase Console, open **Authentication**.
2. Go to **Sign-in method**.
3. Enable **Anonymous**.
4. Save.

If Anonymous auth is disabled, users cannot create or join games.

## 3. Create Realtime Database

1. Open **Realtime Database**.
2. Click **Create Database**.
3. Pick a region close to your users.
4. Start with locked mode (recommended).

## 4. Copy Firebase Config File

From repository root:

```powershell
Copy-Item src/firebase-config.example.js src/firebase-config.js
```

## 5. Paste Firebase Web Config Values

Open `src/firebase-config.js` and replace placeholders with your Firebase app config:

- `apiKey`
- `authDomain`
- `databaseURL`
- `projectId`
- `storageBucket`
- `messagingSenderId`
- `appId`

Save the file.

## 6. Apply `database.rules.json`

1. In Firebase Console, open **Realtime Database** -> **Rules**.
2. Replace current rules with the contents of `database.rules.json`.
3. Click **Publish**.

## 7. Push Repo to GitHub

```bash
git add .
git commit -m "Complete multiplayer Qwirkle app"
git push
```

## 8. Import Repo into Vercel

1. Open [https://vercel.com/new](https://vercel.com/new).
2. Select your GitHub repo.
3. Keep default static settings (no build command required).
4. Click **Deploy**.

## 9. Deploy

Vercel should detect this as a static site and publish directly.

If you use CLI instead:

```bash
vercel
vercel --prod
```

## 10. Test Multiplayer with Two Browser Windows

1. Open deployed URL in browser window A.
2. Enter display name and create a game.
3. Copy join code.
4. Open window B (or private/incognito tab), enter a second display name, join code, and join.
5. Start game from host in window A.
6. Verify live synchronization:
   - turns update in both windows
   - moves appear on both boards
   - scores update live
   - exchange and pass actions propagate

## Common Mistakes

- **Opened `index.html` directly from filesystem**:
  Use a web server (`python -m http.server`) for local testing.

- **Forgot to enable Anonymous Auth**:
  Create/join fails because no authenticated session exists.

- **`databaseURL` missing or wrong**:
  Reads/writes fail, usually with permission or network errors.

- **Rules not published**:
  You updated rules text but did not click **Publish**.

- **Used a different Firebase project for config vs rules**:
  Ensure `firebase-config.js` and published rules refer to the same project.

## If Config Is Missing in the App

The app intentionally shows a setup screen instead of crashing.

Fix:

1. Confirm `src/firebase-config.js` exists.
2. Confirm all required fields are non-empty.
3. Redeploy to Vercel.
4. Hard refresh browser.

## If Joining Does Not Work

Checklist:

1. Join code is uppercase and correct.
2. Lobby has not started and is not finished.
3. Lobby is not full (max 4).
4. Firebase Realtime Database is reachable from browser.
5. Both clients are in the same Firebase project.

## If Database Rules Block Access

Symptoms:

- permission denied errors in browser console
- create/join/start actions failing

Fix:

1. Re-open Firebase Realtime Database rules.
2. Re-paste `database.rules.json` exactly.
3. Publish rules.
4. Verify Anonymous Auth is enabled.
5. Retry with fresh browser session.

## Practical Security Note

This architecture is static frontend + Firebase, so it is suitable for honest casual multiplayer.
It is not a fully authoritative anti-cheat backend design.
