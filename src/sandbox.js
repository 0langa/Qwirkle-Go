import {
  COLORS,
  SHAPES,
  calculateMoveScore,
  validateMove,
} from "./rules.js";
import { coordinateKey, nowMs } from "./utils.js";

const SANDBOX_JOIN_CODE = "SANDBOX";
const SANDBOX_DEFAULT_PLAYERS = 3;
const SANDBOX_MIN_PLAYERS = 2;
const SANDBOX_MAX_PLAYERS = 4;

function randomFrom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function buildTile(shape, color, id) {
  return { id, shape, color };
}

function cloneSnapshot(snapshot) {
  return structuredClone(snapshot);
}

function addHistoryEntry(game, entry) {
  const moveNumber = Number(game.moveNumber || 0) + 1;
  game.moveNumber = moveNumber;
  if (!game.moveHistory || typeof game.moveHistory !== "object") {
    game.moveHistory = {};
  }
  game.moveHistory[`m${moveNumber}`] = {
    ...entry,
    moveNumber,
    createdAt: nowMs(),
  };
}

function nextTurn(game) {
  const turnOrder = game.turnOrder || [];
  if (!turnOrder.length) {
    game.currentPlayerUid = null;
    game.currentTurnIndex = 0;
    return null;
  }
  const nextIndex = (Number(game.currentTurnIndex || 0) + 1) % turnOrder.length;
  game.currentTurnIndex = nextIndex;
  game.currentPlayerUid = turnOrder[nextIndex];
  return game.currentPlayerUid;
}

function fillRackWithRandomTiles(snapshot, uid, minCount = 6) {
  const rack = snapshot.game.racks[uid] || [];
  while (rack.length < minCount) {
    const id = `sb-${snapshot.game.dev.tileCounter++}`;
    rack.push(buildTile(randomFrom(SHAPES), randomFrom(COLORS), id));
  }
  snapshot.game.racks[uid] = rack;
}

function allOpenAdjacentCoords(boardMap) {
  const keys = Object.keys(boardMap || {});
  if (!keys.length) return [{ x: 0, y: 0 }];

  const set = new Set(keys);
  const open = new Set();
  for (const key of keys) {
    const [xRaw, yRaw] = key.split(",");
    const x = Number(xRaw);
    const y = Number(yRaw);
    const neighbors = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ];
    for (const [nx, ny] of neighbors) {
      const nk = coordinateKey(nx, ny);
      if (!set.has(nk)) open.add(nk);
    }
  }
  return [...open].map((key) => {
    const [x, y] = key.split(",").map(Number);
    return { x, y };
  });
}

function sanitizePlayerCount(input) {
  const value = Number(input || SANDBOX_DEFAULT_PLAYERS);
  if (!Number.isInteger(value)) return SANDBOX_DEFAULT_PLAYERS;
  return Math.min(SANDBOX_MAX_PLAYERS, Math.max(SANDBOX_MIN_PLAYERS, value));
}

function applyScore(game, uid, scoreGain) {
  game.scores[uid] = Number(game.scores[uid] || 0) + Number(scoreGain || 0);
}

export function createSandboxSnapshot({
  testerUid,
  testerName = "Du (Sandbox)",
  playerCount = SANDBOX_DEFAULT_PLAYERS,
} = {}) {
  const now = nowMs();
  const meUid = testerUid || "sandbox-user";
  const count = sanitizePlayerCount(playerCount);

  const players = {
    [meUid]: {
      uid: meUid,
      name: testerName,
      isHost: true,
      joinedAt: now - 1000,
      connected: true,
      ready: true,
      lastSeenAt: now,
    },
  };

  const turnOrder = [meUid];
  for (let i = 2; i <= count; i += 1) {
    const uid = `sandbox-bot-${i - 1}`;
    players[uid] = {
      uid,
      name: `Bot ${i - 1}`,
      isHost: false,
      joinedAt: now - (1000 - i * 100),
      connected: true,
      ready: true,
      lastSeenAt: now,
    };
    turnOrder.push(uid);
  }

  const racks = {};
  for (const uid of turnOrder) {
    racks[uid] = [];
  }

  const snapshot = {
    meta: {
      joinCode: SANDBOX_JOIN_CODE,
      status: "in_progress",
      mode: "sandbox",
      hostUid: meUid,
      createdAt: now,
      startedAt: now,
      endedAt: null,
      revision: 1,
      maxPlayers: SANDBOX_MAX_PLAYERS,
    },
    players,
    game: {
      board: {},
      bag: [],
      racks,
      scores: Object.fromEntries(turnOrder.map((uid) => [uid, 0])),
      turnOrder,
      currentTurnIndex: 0,
      currentPlayerUid: meUid,
      openingRequirement: null,
      consecutivePasses: 0,
      moveNumber: 0,
      moveHistory: {},
      winnerUids: [],
      finalStandings: [],
      dev: {
        tileCounter: 1,
      },
    },
  };

  for (const uid of turnOrder) {
    fillRackWithRandomTiles(snapshot, uid, 6);
  }

  return snapshot;
}

export function isSandboxSnapshot(snapshot) {
  return snapshot?.meta?.mode === "sandbox";
}

export function sandboxAdvanceTurn(snapshot, { byUid = null, reason = "dev_next_turn" } = {}) {
  const next = cloneSnapshot(snapshot);
  const game = next.game;
  const previousUid = game.currentPlayerUid;
  const toUid = nextTurn(game);
  addHistoryEntry(game, {
    type: reason,
    byUid,
    fromUid: previousUid,
    toUid,
  });
  next.meta.revision = Number(next.meta.revision || 0) + 1;
  return next;
}

export function sandboxForceCurrentPlayer(snapshot, uid, { byUid = null } = {}) {
  const next = cloneSnapshot(snapshot);
  const game = next.game;
  const order = game.turnOrder || [];
  const index = order.indexOf(uid);
  if (index < 0) return next;

  const previousUid = game.currentPlayerUid;
  game.currentTurnIndex = index;
  game.currentPlayerUid = uid;
  addHistoryEntry(game, {
    type: "dev_force_player",
    byUid,
    fromUid: previousUid,
    toUid: uid,
  });
  next.meta.revision = Number(next.meta.revision || 0) + 1;
  return next;
}

export function sandboxRerollRack(snapshot, uid) {
  const next = cloneSnapshot(snapshot);
  next.game.racks[uid] = [];
  fillRackWithRandomTiles(next, uid, 6);
  addHistoryEntry(next.game, {
    type: "dev_reroll_rack",
    uid,
  });
  next.meta.revision = Number(next.meta.revision || 0) + 1;
  return next;
}

export function sandboxRefillRack(snapshot, uid) {
  const next = cloneSnapshot(snapshot);
  fillRackWithRandomTiles(next, uid, 6);
  addHistoryEntry(next.game, {
    type: "dev_refill_rack",
    uid,
  });
  next.meta.revision = Number(next.meta.revision || 0) + 1;
  return next;
}

export function sandboxInjectTile(snapshot, uid, color, shape) {
  const next = cloneSnapshot(snapshot);
  const normalizedColor = COLORS.includes(color) ? color : COLORS[0];
  const normalizedShape = SHAPES.includes(shape) ? shape : SHAPES[0];
  const id = `sb-${next.game.dev.tileCounter++}`;
  const rack = next.game.racks[uid] || [];
  rack.push(buildTile(normalizedShape, normalizedColor, id));
  next.game.racks[uid] = rack;
  addHistoryEntry(next.game, {
    type: "dev_inject_tile",
    uid,
    tile: { color: normalizedColor, shape: normalizedShape },
  });
  next.meta.revision = Number(next.meta.revision || 0) + 1;
  return next;
}

export function sandboxExchangeTiles(snapshot, uid, selectedTileIds) {
  const next = cloneSnapshot(snapshot);
  const selected = new Set(selectedTileIds || []);
  const rack = next.game.racks[uid] || [];
  const kept = rack.filter((tile) => !selected.has(tile.id));
  next.game.racks[uid] = kept;
  fillRackWithRandomTiles(next, uid, 6);
  addHistoryEntry(next.game, {
    type: "exchange",
    uid,
    tileIds: [...selected],
    sandbox: true,
  });
  next.meta.revision = Number(next.meta.revision || 0) + 1;
  nextTurn(next.game);
  return next;
}

export function sandboxCommitMove(snapshot, uid, draftPlacements, { strictValidation = true } = {}) {
  const next = cloneSnapshot(snapshot);
  const game = next.game;
  if (game.currentPlayerUid !== uid) {
    return { ok: false, error: "Du bist nicht am Zug.", snapshot };
  }

  if (!Array.isArray(draftPlacements) || !draftPlacements.length) {
    return { ok: false, error: "Keine Platzierungen vorhanden.", snapshot };
  }

  const placements = draftPlacements.map((placement) => ({
    x: Number(placement.x),
    y: Number(placement.y),
    tile: placement.tile,
  }));

  let boardAfter = { ...(game.board || {}) };
  let scoreGain = 0;
  let qwirkleCount = 0;
  if (strictValidation) {
    const validation = validateMove(boardAfter, placements, {
      isOpeningMove: Object.keys(boardAfter).length === 0,
    });
    if (!validation.valid) {
      return { ok: false, error: validation.reason, snapshot };
    }
    boardAfter = validation.boardAfter;
    const scoreResult = calculateMoveScore(game.board || {}, placements);
    scoreGain = Number(scoreResult.score || 0);
    qwirkleCount = (scoreResult.lines || []).reduce(
      (count, line) => count + (line.tiles?.length === 6 ? 1 : 0),
      0
    );
  } else {
    for (const placement of placements) {
      boardAfter[coordinateKey(placement.x, placement.y)] = placement.tile;
    }
    scoreGain = placements.length;
  }

  game.board = boardAfter;
  applyScore(game, uid, scoreGain);
  fillRackWithRandomTiles(next, uid, 6);
  addHistoryEntry(game, {
    type: "move",
    uid,
    sandbox: true,
    strictValidation: Boolean(strictValidation),
    tileIds: placements.map((placement) => placement.tile.id),
    placements: placements.map((placement) => ({
      x: placement.x,
      y: placement.y,
      tileId: placement.tile.id,
    })),
    scoreGain,
    qwirkleCount,
  });
  nextTurn(game);
  next.meta.revision = Number(next.meta.revision || 0) + 1;
  return { ok: true, snapshot: next, scoreGain };
}

export function sandboxPassTurn(snapshot, uid) {
  const next = cloneSnapshot(snapshot);
  const game = next.game;
  if (game.currentPlayerUid !== uid) {
    return { ok: false, error: "Du bist nicht am Zug.", snapshot };
  }
  addHistoryEntry(game, {
    type: "pass",
    uid,
    sandbox: true,
  });
  nextTurn(game);
  next.meta.revision = Number(next.meta.revision || 0) + 1;
  return { ok: true, snapshot: next };
}

export function sandboxClearBoard(snapshot, { byUid = null } = {}) {
  const next = cloneSnapshot(snapshot);
  next.game.board = {};
  addHistoryEntry(next.game, {
    type: "dev_clear_board",
    byUid,
  });
  next.meta.revision = Number(next.meta.revision || 0) + 1;
  return next;
}

export function sandboxResizePlayers(snapshot, playerCount) {
  const next = cloneSnapshot(snapshot);
  const meUid = next.meta.hostUid;
  const targetCount = sanitizePlayerCount(playerCount);
  const currentOrder = [...(next.game.turnOrder || [])];

  const newOrder = [meUid];
  for (let i = 2; i <= targetCount; i += 1) {
    newOrder.push(`sandbox-bot-${i - 1}`);
  }

  // Add missing players
  for (const uid of newOrder) {
    if (!next.players[uid]) {
      next.players[uid] = {
        uid,
        name: uid === meUid ? next.players[meUid].name : `Bot ${uid.split("-").at(-1)}`,
        isHost: uid === meUid,
        joinedAt: nowMs(),
        connected: true,
        ready: true,
        lastSeenAt: nowMs(),
      };
    }
    if (!next.game.racks[uid]) {
      next.game.racks[uid] = [];
    }
    if (typeof next.game.scores[uid] !== "number") {
      next.game.scores[uid] = 0;
    }
  }

  // Remove dropped players
  for (const uid of currentOrder) {
    if (newOrder.includes(uid)) continue;
    delete next.players[uid];
    delete next.game.racks[uid];
    delete next.game.scores[uid];
  }

  next.game.turnOrder = newOrder;
  const existingCurrent = next.game.currentPlayerUid;
  const nextIndex = newOrder.indexOf(existingCurrent);
  next.game.currentTurnIndex = nextIndex >= 0 ? nextIndex : 0;
  next.game.currentPlayerUid = newOrder[next.game.currentTurnIndex] || meUid;

  for (const uid of newOrder) {
    fillRackWithRandomTiles(next, uid, 6);
  }

  addHistoryEntry(next.game, {
    type: "dev_resize_players",
    toCount: targetCount,
  });
  next.meta.revision = Number(next.meta.revision || 0) + 1;
  return next;
}

export function sandboxSimulateCurrentPlayer(snapshot, { strictValidation = true } = {}) {
  const next = cloneSnapshot(snapshot);
  const uid = next.game.currentPlayerUid;
  const rack = next.game.racks[uid] || [];
  const board = next.game.board || {};

  if (!rack.length) {
    const passed = sandboxPassTurn(next, uid);
    return {
      ok: true,
      snapshot: passed.snapshot,
      summary: "Kein passender Stein: simulierte Aktion = Passen.",
    };
  }

  const candidates = allOpenAdjacentCoords(board);
  let best = null;
  for (const tile of rack) {
    for (const coord of candidates) {
      const placements = [{ x: coord.x, y: coord.y, tile }];
      if (strictValidation) {
        const validation = validateMove(board, placements, {
          isOpeningMove: Object.keys(board).length === 0,
        });
        if (!validation.valid) continue;
      }
      const score = Number(calculateMoveScore(board, placements).score || 0);
      if (!best || score > best.score) {
        best = { placements, score };
      }
    }
  }

  if (!best) {
    const passed = sandboxPassTurn(next, uid);
    return {
      ok: true,
      snapshot: passed.snapshot,
      summary: "Kein legaler Zug gefunden: simulierte Aktion = Passen.",
    };
  }

  const committed = sandboxCommitMove(next, uid, best.placements, { strictValidation });
  if (!committed.ok) {
    return {
      ok: false,
      error: committed.error,
      snapshot,
    };
  }
  return {
    ok: true,
    snapshot: committed.snapshot,
    summary: `Simulierter Zug: ${best.placements.length} Stein(e), +${best.score} Punkte.`,
  };
}
