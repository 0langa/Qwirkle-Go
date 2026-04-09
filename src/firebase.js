import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  get,
  getDatabase,
  onDisconnect,
  onValue,
  ref,
  runTransaction,
  serverTimestamp,
  set,
  update,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

const REQUIRED_KEYS = [
  "apiKey",
  "authDomain",
  "databaseURL",
  "projectId",
  "storageBucket",
  "messagingSenderId",
  "appId",
];

const runtime = {
  app: null,
  auth: null,
  db: null,
  config: null,
  presenceCleanup: null,
};

function validateConfig(config) {
  if (!config || typeof config !== "object") {
    return false;
  }
  return REQUIRED_KEYS.every((key) => typeof config[key] === "string" && config[key].trim().length > 0);
}

export async function bootstrapFirebase() {
  let config = null;

  try {
    const module = await import("./firebase-config.js");
    config = module.firebaseConfig || module.default || null;
  } catch (_error) {
    return {
      ok: false,
      reason: "missing-config-file",
      message: "src/firebase-config.js could not be loaded.",
    };
  }

  if (!validateConfig(config)) {
    return {
      ok: false,
      reason: "invalid-config",
      message: "src/firebase-config.js is missing required Firebase fields.",
    };
  }

  if (!runtime.app) {
    runtime.app = initializeApp(config);
    runtime.auth = getAuth(runtime.app);
    runtime.db = getDatabase(runtime.app);
    runtime.config = config;
  }

  if (!runtime.auth.currentUser) {
    await signInAnonymously(runtime.auth);
  }

  return {
    ok: true,
    user: runtime.auth.currentUser,
  };
}

export function waitForAuthUser() {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(runtime.auth, (user) => {
      if (user) {
        unsubscribe();
        resolve(user);
      }
    });
  });
}

export function getAuthUser() {
  return runtime.auth?.currentUser || null;
}

export function subscribe(path, onNext, onError) {
  return onValue(ref(runtime.db, path), onNext, onError);
}

export function read(path) {
  return get(ref(runtime.db, path));
}

export function write(path, value) {
  return set(ref(runtime.db, path), value);
}

export function patch(path, value) {
  return update(ref(runtime.db, path), value);
}

export function transact(path, updater) {
  return runTransaction(ref(runtime.db, path), updater, {
    applyLocally: false,
  });
}

export async function attachPresence(code, uid) {
  if (!runtime.db || !code || !uid) {
    return;
  }

  if (runtime.presenceCleanup) {
    runtime.presenceCleanup();
    runtime.presenceCleanup = null;
  }

  const path = `games/${code}/players/${uid}`;
  const playerRef = ref(runtime.db, path);
  const disconnectRef = onDisconnect(playerRef);

  await update(playerRef, {
    connected: true,
    lastSeenAt: serverTimestamp(),
  });

  await disconnectRef.update({
    connected: false,
    lastSeenAt: serverTimestamp(),
  });

  runtime.presenceCleanup = () => {
    disconnectRef.cancel().catch(() => {});
  };
}

export function detachPresence() {
  if (runtime.presenceCleanup) {
    runtime.presenceCleanup();
    runtime.presenceCleanup = null;
  }
}
