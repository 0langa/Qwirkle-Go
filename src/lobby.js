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

const MAX_PLAYERS = 4;
const MIN_PLAYERS = 2;

export class LobbyFlowError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "LobbyFlowError";
    this.code = code;
    this.details = details;
  }
}

function createPlayer(uid, name, isHost, joinedAt) {
  return {
    uid,
    name,
    isHost,
    joinedAt,
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
    throw new LobbyFlowError("transaction-not-committed", fallback || "Operation could not be completed.");
  }
  return result.snapshot?.val() || null;
}

async function resolveUid(uid) {
  let user;
  try {
    user = await ensureAuthReady();
  } catch (_error) {
    throw new LobbyFlowError("auth-not-ready", "Authentication is still initializing. Please try again.");
  }
  const authUid = user?.uid || getAuthUser()?.uid || null;
  const resolved = uid || authUid;
  if (!resolved) {
    throw new LobbyFlowError("auth-not-ready", "Authentication is still initializing. Please try again.");
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
  const message = String(error?.message || "Unexpected Firebase error.");

  if (code.includes("permission-denied")) {
    return new LobbyFlowError("permission-denied", "Permission denied by Firebase rules.", {
      firebaseCode: error?.code,
      firebaseMessage: message,
    });
  }

  if (code.includes("network") || code.includes("unavailable") || code.includes("disconnected")) {
    return new LobbyFlowError("network-error", "Network/database connection issue while reaching Firebase.", {
      firebaseCode: error?.code,
      firebaseMessage: message,
    });
  }

  return new LobbyFlowError("firebase-error", "Unexpected Firebase error during lobby operation.", {
    firebaseCode: error?.code,
    firebaseMessage: message,
  });
}

function logJoinDebug(stage, payload) {
  console.debug(`[join-flow] ${stage}`, payload);
}

export async function createLobby(uid, displayName) {
  const resolvedUid = await resolveUid(uid);
  const name = sanitizeDisplayName(displayName);

  if (!name) {
    throw new LobbyFlowError("invalid-display-name", "Please enter a display name first.");
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

  throw new LobbyFlowError("code-generation-failed", "Could not reserve a join code. Please try again.");
}

export async function joinLobby(codeInput, uid, displayName) {
  const resolvedUid = await resolveUid(uid);
  const name = sanitizeDisplayName(displayName);

  if (!name) {
    throw new LobbyFlowError("invalid-display-name", "Please enter a display name first.");
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
    throw new LobbyFlowError("invalid-join-code", "Enter a valid join code.");
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
    throw new LobbyFlowError("game-not-found", "Game not found. Check the join code and try again.");
  }

  const lobbyData = snapshot.val();
  if (!validateLobbyShape(lobbyData)) {
    throw new LobbyFlowError("invalid-lobby-data", "Lobby data is malformed. Please create a new game.");
  }

  const preMeta = lobbyData.meta || {};
  const prePlayers = lobbyData.players || {};

  if (preMeta.status === "in_progress") {
    throw new LobbyFlowError("game-already-started", "That game already started.");
  }

  if (preMeta.status === "finished") {
    throw new LobbyFlowError("game-finished", "That game already finished.");
  }

  if (preMeta.status !== "lobby") {
    throw new LobbyFlowError("lobby-unavailable", "This lobby is unavailable right now.");
  }

  const preAlreadyIn = Boolean(prePlayers[resolvedUid]);
  const preCount = Object.keys(prePlayers).length;
  if (!preAlreadyIn && preCount >= MAX_PLAYERS) {
    throw new LobbyFlowError("lobby-full", "Lobby is full (4 players).");
  }

  let failure = {
    code: "join-failed",
    message: "Could not join lobby.",
  };

  let result;
  try {
    result = await transact(path, (current) => {
      if (!current) {
        failure = {
          code: "lobby-unavailable",
          message: "Lobby was closed before you could join.",
        };
        return;
      }

      if (!validateLobbyShape(current)) {
        failure = {
          code: "invalid-lobby-data",
          message: "Lobby data is malformed.",
        };
        return;
      }

      const meta = current.meta || {};
      const players = current.players || {};

      if (meta.status === "in_progress") {
        failure = {
          code: "game-already-started",
          message: "That game already started.",
        };
        return;
      }

      if (meta.status === "finished") {
        failure = {
          code: "game-finished",
          message: "That game already finished.",
        };
        return;
      }

      if (meta.status !== "lobby") {
        failure = {
          code: "lobby-unavailable",
          message: "This lobby is unavailable right now.",
        };
        return;
      }

      const alreadyIn = Boolean(players[resolvedUid]);
      const playerCount = Object.keys(players).length;
      if (!alreadyIn && playerCount >= MAX_PLAYERS) {
        failure = {
          code: "lobby-full",
          message: "Lobby is full (4 players).",
        };
        return;
      }

      const joinedAt = players[resolvedUid]?.joinedAt || nowMs();
      const isHost = meta.hostUid === resolvedUid;

      current.players = {
        ...players,
        [resolvedUid]: createPlayer(resolvedUid, name, isHost, joinedAt),
      };

      current.meta = {
        ...meta,
        revision: nextRevision(meta),
      };

      return current;
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
        failure = "Lobby not found.";
        return;
      }

      const meta = current.meta || {};
      if (meta.status !== "lobby") {
        failure = "Cannot leave from lobby after game starts.";
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
    throw new LobbyFlowError("invalid-join-code", "Missing join code.");
  }

  let failure = "";

  let result;
  try {
    result = await transact(`games/${code}`, (current) => {
      if (!current) {
        failure = "Lobby not found.";
        return;
      }

      const meta = current.meta || {};
      const players = current.players || {};

      if (meta.status !== "lobby") {
        failure = "Game already started or finished.";
        return;
      }

      if (meta.hostUid !== resolvedUid) {
        failure = "Only the host can start the game.";
        return;
      }

      const playerList = sortPlayersByJoin(players);
      const count = playerList.length;
      if (count < MIN_PLAYERS || count > MAX_PLAYERS) {
        failure = "Game requires 2 to 4 players to start.";
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

  ensureTransactionResult(result, failure || "Could not start game.");
  return result.snapshot?.val() || null;
}
