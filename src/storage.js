const DISPLAY_NAME_KEY = "qwirkle.displayName";
const SESSION_KEY = "qwirkle.session";

function readJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (_error) {
    return null;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function loadDisplayName() {
  return localStorage.getItem(DISPLAY_NAME_KEY) || "";
}

export function saveDisplayName(name) {
  localStorage.setItem(DISPLAY_NAME_KEY, String(name || ""));
}

export function loadSession() {
  const session = readJson(SESSION_KEY);
  if (!session || typeof session !== "object") {
    return null;
  }
  if (!session.code) {
    return null;
  }
  return {
    code: String(session.code),
    updatedAt: Number(session.updatedAt || 0),
  };
}

export function saveSession(code) {
  writeJson(SESSION_KEY, {
    code: String(code || ""),
    updatedAt: Date.now(),
  });
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}
