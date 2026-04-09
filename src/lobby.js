import { transact } from "./firebase.js";
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
    throw new Error(fallback || "Operation could not be completed.");
  }
  return result.snapshot?.val() || null;
}

export async function createLobby(uid, displayName) {
  const name = sanitizeDisplayName(displayName);
  if (!name) {
    throw new Error("Please enter a display name first.");
  }

  let attempts = 0;
  while (attempts < 30) {
    attempts += 1;
    const code = generateJoinCode(5);

    const result = await transact(`games/${code}`, (current) => {
      if (current) {
        return;
      }
      return createLobbyState(code, uid, name);
    });

    if (result.committed) {
      return { code, game: result.snapshot?.val() || null };
    }
  }

  throw new Error("Could not reserve a join code. Please try again.");
}

export async function joinLobby(codeInput, uid, displayName) {
  const code = sanitizeJoinCode(codeInput);
  const name = sanitizeDisplayName(displayName);

  if (!name) {
    throw new Error("Please enter a display name first.");
  }

  if (!code || code.length < 4) {
    throw new Error("Enter a valid join code.");
  }

  let failure = "";

  const result = await transact(`games/${code}`, (current) => {
    if (!current) {
      failure = "Game not found. Check the join code and try again.";
      return;
    }

    const meta = current.meta || {};
    const players = current.players || {};

    if (meta.status === "in_progress") {
      failure = "That game already started.";
      return;
    }

    if (meta.status === "finished") {
      failure = "That game already finished.";
      return;
    }

    if (meta.status !== "lobby") {
      failure = "This lobby is unavailable right now.";
      return;
    }

    const alreadyIn = Boolean(players[uid]);
    const playerCount = Object.keys(players).length;
    if (!alreadyIn && playerCount >= MAX_PLAYERS) {
      failure = "Lobby is full (4 players).";
      return;
    }

    const joinedAt = players[uid]?.joinedAt || nowMs();
    const isHost = meta.hostUid === uid;

    current.players = {
      ...players,
      [uid]: createPlayer(uid, name, isHost, joinedAt),
    };
    current.meta = {
      ...meta,
      revision: nextRevision(meta),
    };

    return current;
  });

  if (!result.committed) {
    throw new Error(failure || "Could not join lobby.");
  }

  return { code, game: result.snapshot?.val() || null };
}

export async function leaveLobby(codeInput, uid) {
  const code = sanitizeJoinCode(codeInput);
  if (!code) {
    return;
  }

  let failure = "";

  const result = await transact(`games/${code}`, (current) => {
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
    if (!players[uid]) {
      return current;
    }

    delete players[uid];
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

  if (!result.committed && failure) {
    throw new Error(failure);
  }
}

function dealInitialRacks(turnOrder, bag) {
  const racks = {};
  let workingBag = [...bag];

  for (const uid of turnOrder) {
    const draw = drawFromBag(workingBag, 6);
    racks[uid] = draw.drawn;
    workingBag = draw.bag;
  }

  return {
    racks,
    bag: workingBag,
  };
}

export async function startGame(codeInput, uid) {
  const code = sanitizeJoinCode(codeInput);
  if (!code) {
    throw new Error("Missing join code.");
  }

  let failure = "";

  const result = await transact(`games/${code}`, (current) => {
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

    if (meta.hostUid !== uid) {
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

  ensureTransactionResult(result, failure || "Could not start game.");
  return result.snapshot?.val() || null;
}
