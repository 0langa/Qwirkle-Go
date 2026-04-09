const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function sanitizeDisplayName(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 24);
}

export function sanitizeJoinCode(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
}

export function generateJoinCode(length = 5) {
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

export function coordinateKey(x, y) {
  return `${x},${y}`;
}

export function parseCoordinateKey(key) {
  const [x, y] = String(key).split(",").map((value) => Number(value));
  return { x, y };
}

export function hashString(input) {
  const value = String(input ?? "");
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function seededRandom(seed) {
  let state = seed >>> 0;
  return function random() {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleWithRandom(array, randomFn = Math.random) {
  const next = [...array];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(randomFn() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

export function sortPlayersByJoin(playersByUid) {
  return Object.values(playersByUid || {}).sort((a, b) => {
    const timeDiff = Number(a.joinedAt || 0) - Number(b.joinedAt || 0);
    if (timeDiff !== 0) {
      return timeDiff;
    }
    return String(a.uid || "").localeCompare(String(b.uid || ""));
  });
}

export function nowMs() {
  return Date.now();
}

export function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function toUpperSafe(value) {
  return String(value || "").toUpperCase();
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function compact(array) {
  return array.filter(Boolean);
}
