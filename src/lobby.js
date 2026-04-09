import { ensureAuthReady, getAuthUser, read, transact } from "./firebase.js";
import {
  createTileSet,
  determineFirstPlayer,
  drawFromBag,
  findLargestOpeningGroups,
  shuffleTiles,
} from "./rules.js";
import {
  generateJoinCode,
  hashString,
  nowMs,
  sanitizeDisplayName,
  sanitizeJoinCode,
  seededRandom,
  sortPlayersByJoin,
} from "./utils.js";
import {
  evaluateLobbyStartReadiness,
  MAX_PLAYERS,
  MIN_PLAYERS,
} from "./lobby-readiness.js";

export class LobbyFlowError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "LobbyFlowError";
    this.code = code;
    this.details = details;
  }
}

function createPlayer(uid, name, isHost, joinedAt, ready = false) {
  return {
    uid,
    name,
    isHost,
    joinedAt,
    ready: Boolean(ready),
    connected: true,
    lastSeenAt: joinedAt,
  };
}

function createLobbyState(code, uid, displayName) {
  const createdAt = nowMs();
  return {
    meta: {
      joinCode: code,
      status: "lobby",
      hostUid: uid,
      createdAt,
      startedAt: null,
      endedAt: null,
      revision: 1,
      maxPlayers: MAX_PLAYERS,
    },
    players: {
      [uid]: createPlayer(uid, displayName, true, createdAt),
    },
    game: null,
  };
}

function nextRevision(meta) {
  return Number(meta?.revision || 0) + 1;
}

function updateHostIfNeeded(state) {
  const players = state.players || {};
  const ids = Object.keys(players);

  if (!ids.length) {
    return state;
  }

  const hostUid = state.meta?.hostUid;
  if (hostUid && players[hostUid]) {
    return state;
  }

  const nextHost = sortPlayersByJoin(players)[0];
  if (!nextHost) {
    return state;
  }

  state.meta.hostUid = nextHost.uid;
  for (const uid of Object.keys(players)) {
    players[uid].isHost = uid === nextHost.uid;
  }
  return state;
}

function ensureTransactionResult(result, fallback) {
  if (!result.committed) {
    throw new LobbyFlowError("transaction-not-committed", fallback || "Vorgang konnte nicht abgeschlossen werden.");
  }
  return result.snapshot?.val() || null;
}

async function resolveUid(uid) {
  let user;
  try {
    user = await ensureAuthReady();
  } catch (_error) {
    throw new LobbyFlowError("auth-not-ready", "Authentifizierung wird noch initialisiert. Bitte erneut versuchen.");
  }
  const authUid = user?.uid || getAuthUser()?.uid || null;
  const resolved = uid || authUid;
  if (!resolved) {
    throw new LobbyFlowError("auth-not-ready", "Authentifizierung wird noch initialisiert. Bitte erneut versuchen.");
  }
  return resolved;
}

function normalizeJoinCodeForRead(input) {
  return String(input || "").trim().toUpperCase();
}

function validateLobbyShape(data) {
  if (!data || typeof data !== "object") {
    return false;
  }
  if (!data.meta || typeof data.meta !== "object") {
    return false;
  }
  if (!data.players || typeof data.players !== "object") {
    return false;
  }
  return true;
}

function mapFirebaseError(error) {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "Unerwarteter Firebase-Fehler.");

  if (code.includes("permission-denied")) {
    return new LobbyFlowError("permission-denied", "Zugriff durch Firebase-Regeln verweigert.", {
      firebaseCode: error?.code,
      firebaseMessage: message,
    });
  }

  if (code.includes("network") || code.includes("unavailable") || code.includes("disconnected")) {
    return new LobbyFlowError("network-error", "Netzwerk-/Datenbankproblem beim Zugriff auf Firebase.", {
      firebaseCode: error?.code,
      firebaseMessage: message,
    });
  }

  return new LobbyFlowError("firebase-error", "Unerwarteter Firebase-Fehler beim Lobby-Vorgang.", {
    firebaseCode: error?.code,
    firebaseMessage: message,
  });
}

function logJoinDebug(stage, payload) {
  console.debug(`[join-flow] ${stage}`, payload);
}

function deepClone(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

export async function createLobby(uid, displayName) {
  const resolvedUid = await resolveUid(uid);
  const name = sanitizeDisplayName(displayName);

  if (!name) {
    throw new LobbyFlowError("invalid-display-name", "Bitte zuerst einen Anzeigenamen eingeben.");
  }

  let attempts = 0;
  while (attempts < 30) {
    attempts += 1;
    const code = generateJoinCode(5);

    let result;
    try {
      result = await transact(`games/${code}`, (current) => {
        if (current) {
          return;
        }
        return createLobbyState(code, resolvedUid, name);
      });
    } catch (error) {
      throw mapFirebaseError(error);
    }

    if (result.committed) {
      return { code, game: result.snapshot?.val() || null };
    }
  }

  throw new LobbyFlowError("code-generation-failed", "Beitrittscode konnte nicht reserviert werden. Bitte erneut versuchen.");
}

export async function joinLobby(codeInput, uid, displayName) {
  const resolvedUid = await resolveUid(uid);
  const name = sanitizeDisplayName(displayName);

  if (!name) {
    throw new LobbyFlowError("invalid-display-name", "Bitte zuerst einen Anzeigenamen eingeben.");
  }

  const rawInputCode = String(codeInput || "");
  const normalizedCode = normalizeJoinCodeForRead(rawInputCode);
  const path = `games/${normalizedCode}`;

  logJoinDebug("attempt", {
    rawInputCode,
    normalizedCode,
    path,
    authUid: getAuthUser()?.uid || resolvedUid || null,
  });

  if (!normalizedCode || normalizedCode.length < 4 || normalizedCode.length > 8 || /[^A-Z0-9]/.test(normalizedCode)) {
    throw new LobbyFlowError("invalid-join-code", "Bitte einen gueltigen Beitrittscode eingeben.");
  }

  let snapshot;
  try {
    snapshot = await read(path);
  } catch (error) {
    logJoinDebug("read-error", {
      firebaseCode: error?.code || null,
      firebaseMessage: error?.message || String(error),
    });
    throw mapFirebaseError(error);
  }

  const exists = snapshot.exists();
  logJoinDebug("read-result", {
    exists,
    value: exists ? snapshot.val() : null,
  });

  if (!exists) {
    throw new LobbyFlowError("game-not-found", "Spiel nicht gefunden. Bitte pruefe den Beitrittscode und versuche es erneut.");
  }

  const lobbyData = snapshot.val();
  if (!validateLobbyShape(lobbyData)) {
    throw new LobbyFlowError("invalid-lobby-data", "Lobby-Daten sind fehlerhaft. Bitte ein neues Spiel erstellen.");
  }

  const preMeta = lobbyData.meta || {};
  const prePlayers = lobbyData.players || {};

  if (preMeta.status === "in_progress") {
    throw new LobbyFlowError("game-already-started", "Dieses Spiel wurde bereits gestartet.");
  }

  if (preMeta.status === "finished") {
    throw new LobbyFlowError("game-finished", "Dieses Spiel ist bereits beendet.");
  }

  if (preMeta.status !== "lobby") {
    throw new LobbyFlowError("lobby-unavailable", "Diese Lobby ist momentan nicht verfuegbar.");
  }

  const preAlreadyIn = Boolean(prePlayers[resolvedUid]);
  const preCount = Object.keys(prePlayers).length;
  if (!preAlreadyIn && preCount >= MAX_PLAYERS) {
    throw new LobbyFlowError("lobby-full", "Die Lobby ist voll (4 Spieler).");
  }

  let failure = {
    code: "join-failed",
    message: "Lobby-Beitritt fehlgeschlagen.",
  };

  let usedSnapshotFallback = false;
  let result;
  try {
    result = await transact(path, (current) => {
      const base =
        current ||
        (!usedSnapshotFallback && lobbyData ? deepClone(lobbyData) : null);

      if (!current && !usedSnapshotFallback && base) {
        usedSnapshotFallback = true;
        logJoinDebug("transaction-null-current-fallback", {
          normalizedCode,
          usedSnapshotFallback,
        });
      }

      if (!base) {
        failure = {
          code: "lobby-unavailable",
          message: "Die Lobby wurde geschlossen, bevor du beitreten konntest.",
        };
        return;
      }

      if (!validateLobbyShape(base)) {
        failure = {
          code: "invalid-lobby-data",
          message: "Lobby-Daten sind fehlerhaft.",
        };
        return;
      }

      const meta = base.meta || {};
      const players = base.players || {};

      if (meta.status === "in_progress") {
        failure = {
          code: "game-already-started",
          message: "Dieses Spiel wurde bereits gestartet.",
        };
        return;
      }

      if (meta.status === "finished") {
        failure = {
          code: "game-finished",
          message: "Dieses Spiel ist bereits beendet.",
        };
        return;
      }

      if (meta.status !== "lobby") {
        failure = {
          code: "lobby-unavailable",
          message: "Diese Lobby ist momentan nicht verfuegbar.",
        };
        return;
      }

      const alreadyIn = Boolean(players[resolvedUid]);
      const playerCount = Object.keys(players).length;
      if (!alreadyIn && playerCount >= MAX_PLAYERS) {
        failure = {
          code: "lobby-full",
          message: "Die Lobby ist voll (4 Spieler).",
        };
        return;
      }

      const joinedAt = players[resolvedUid]?.joinedAt || nowMs();
      const isHost = meta.hostUid === resolvedUid;
      const wasReady = Boolean(players[resolvedUid]?.ready);

      base.players = {
        ...players,
        [resolvedUid]: createPlayer(resolvedUid, name, isHost, joinedAt, wasReady),
      };

      base.meta = {
        ...meta,
        revision: nextRevision(meta),
      };

      return base;
    });
  } catch (error) {
    logJoinDebug("transaction-error", {
      firebaseCode: error?.code || null,
      firebaseMessage: error?.message || String(error),
    });
    throw mapFirebaseError(error);
  }

  if (!result.committed) {
    throw new LobbyFlowError(failure.code, failure.message);
  }

  return {
    code: sanitizeJoinCode(normalizedCode),
    game: result.snapshot?.val() || null,
  };
}

export async function leaveLobby(codeInput, uid) {
  const resolvedUid = await resolveUid(uid);
  const code = sanitizeJoinCode(codeInput);
  if (!code) {
    return;
  }

  let failure = "";

  let result;
  try {
    result = await transact(`games/${code}`, (current) => {
      if (!current) {
        failure = "Lobby nicht gefunden.";
        return;
      }

      const meta = current.meta || {};
      if (meta.status !== "lobby") {
        failure = "Nach Spielstart kann die Lobby nicht mehr verlassen werden.";
        return;
      }

      const players = { ...(current.players || {}) };
      if (!players[resolvedUid]) {
        return current;
      }

      delete players[resolvedUid];
      if (!Object.keys(players).length) {
        return null;
      }

      current.players = players;
      current.meta = {
        ...meta,
        revision: nextRevision(meta),
      };

      return updateHostIfNeeded(current);
    });
  } catch (error) {
    throw mapFirebaseError(error);
  }

  if (!result.committed && failure) {
    throw new LobbyFlowError("leave-failed", failure);
  }
}

function dealInitialRacks(turnOrder, bag) {
  const racks = {};
  let workingBag = [...bag];

  for (const playerUid of turnOrder) {
    const draw = drawFromBag(workingBag, 6);
    racks[playerUid] = draw.drawn;
    workingBag = draw.bag;
  }

  return {
    racks,
    bag: workingBag,
  };
}

export async function startGame(codeInput, uid) {
  const resolvedUid = await resolveUid(uid);
  const code = sanitizeJoinCode(codeInput);
  if (!code) {
    throw new LobbyFlowError("invalid-join-code", "Beitrittscode fehlt.");
  }

  let failure = "";

  let result;
  try {
    result = await transact(`games/${code}`, (current) => {
      if (!current) {
        failure = "Lobby nicht gefunden.";
        return;
      }

      const meta = current.meta || {};
      const players = current.players || {};

      if (meta.status !== "lobby") {
        failure = "Spiel wurde bereits gestartet oder ist beendet.";
        return;
      }

      if (meta.hostUid !== resolvedUid) {
        failure = "Nur der Host kann das Spiel starten.";
        return;
      }

      const playerList = sortPlayersByJoin(players);
      const readiness = evaluateLobbyStartReadiness(players);
      if (readiness.count < MIN_PLAYERS || readiness.count > MAX_PLAYERS) {
        failure = "Zum Starten werden 2 bis 4 Spieler benoetigt.";
        return;
      }

      if (!readiness.allConnected) {
        failure = "Alle Spieler muessen verbunden sein, um zu starten.";
        return;
      }

      if (!readiness.allReady) {
        failure = "Alle Spieler muessen als bereit markiert sein.";
        return;
      }

      const turnOrder = playerList.map((player) => player.uid);
      const seed = hashString(`${code}:${meta.createdAt || 0}:${meta.revision || 0}`);
      const randomFn = seededRandom(seed);
      const allTiles = shuffleTiles(createTileSet(), randomFn);
      const initialDeal = dealInitialRacks(turnOrder, allTiles);

      const firstPlayer = determineFirstPlayer(turnOrder, initialDeal.racks);
      const openingGroups = findLargestOpeningGroups(initialDeal.racks[firstPlayer.firstUid] || []);
      const allowedGroups = openingGroups.groups.map((group) =>
        group
          .map((tile) => tile.id)
          .sort()
          .join("|")
      );

      const scores = {};
      for (const player of playerList) {
        scores[player.uid] = 0;
      }

      current.meta = {
        ...meta,
        status: "in_progress",
        startedAt: nowMs(),
        revision: nextRevision(meta),
      };

      current.game = {
        board: {},
        bag: initialDeal.bag,
        racks: initialDeal.racks,
        scores,
        turnOrder,
        currentTurnIndex: turnOrder.indexOf(firstPlayer.firstUid),
        currentPlayerUid: firstPlayer.firstUid,
        openingRequirement: {
          uid: firstPlayer.firstUid,
          size: firstPlayer.requiredOpeningSize,
          allowedGroups,
        },
        consecutivePasses: 0,
        moveNumber: 0,
        moveHistory: {},
        winnerUids: [],
        finalStandings: [],
      };

      return current;
    });
  } catch (error) {
    throw mapFirebaseError(error);
  }

  ensureTransactionResult(result, failure || "Spiel konnte nicht gestartet werden.");
  return result.snapshot?.val() || null;
}

export async function setLobbyReady(codeInput, uid, ready) {
  const resolvedUid = await resolveUid(uid);
  const code = sanitizeJoinCode(codeInput);
  if (!code) {
    throw new LobbyFlowError("invalid-join-code", "Beitrittscode fehlt.");
  }

  const nextReady = Boolean(ready);
  let failure = "";

  let result;
  try {
    result = await transact(`games/${code}`, (current) => {
      if (!current) {
        failure = "Lobby nicht gefunden.";
        return;
      }

      const meta = current.meta || {};
      if (meta.status !== "lobby") {
        failure = "Bereitschaft kann nur in der Lobby gesetzt werden.";
        return;
      }

      const players = { ...(current.players || {}) };
      const me = players[resolvedUid];
      if (!me) {
        failure = "Du bist nicht mehr in dieser Lobby.";
        return;
      }

      players[resolvedUid] = {
        ...me,
        ready: nextReady,
      };

      current.players = players;
      current.meta = {
        ...meta,
        revision: nextRevision(meta),
      };
      return current;
    });
  } catch (error) {
    throw mapFirebaseError(error);
  }

  ensureTransactionResult(result, failure || "Bereitschaft konnte nicht gesetzt werden.");
  return result.snapshot?.val() || null;
}

