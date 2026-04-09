import { transact } from "./firebase.js";
import {
  applyEndGameBonus,
  calculateMoveScore,
  calculateStandings,
  findWinnerUids,
  isExchangeLegal,
  validateMove,
} from "./rules.js";
import {
  hashString,
  nowMs,
  seededRandom,
  shuffleWithRandom,
  sanitizeJoinCode,
} from "./utils.js";

function nextRevision(meta) {
  return Number(meta?.revision || 0) + 1;
}

function advanceTurn(game) {
  const order = game.turnOrder || [];
  if (!order.length) {
    game.currentTurnIndex = 0;
    game.currentPlayerUid = null;
    return;
  }
  const current = Number(game.currentTurnIndex || 0);
  const next = (current + 1) % order.length;
  game.currentTurnIndex = next;
  game.currentPlayerUid = order[next];
}

function finalizeGame(state) {
  const standings = calculateStandings(state.players || {}, state.game?.scores || {});
  state.game.finalStandings = standings;
  state.game.winnerUids = findWinnerUids(state.game?.scores || {});
  state.meta.status = "finished";
  state.meta.endedAt = nowMs();
}

function ensureRackContains(rack, tileIds) {
  const idSet = new Set((rack || []).map((tile) => tile.id));
  return tileIds.every((tileId) => idSet.has(tileId));
}

function removeRackTiles(rack, tileIds) {
  const removeSet = new Set(tileIds);
  return (rack || []).filter((tile) => !removeSet.has(tile.id));
}

function drawUntilSix(rack, bag) {
  const nextRack = [...rack];
  const nextBag = [...bag];
  while (nextRack.length < 6 && nextBag.length > 0) {
    nextRack.push(nextBag.shift());
  }
  return {
    rack: nextRack,
    bag: nextBag,
  };
}

function addHistoryEntry(game, entry) {
  const nextMoveNumber = Number(game.moveNumber || 0) + 1;
  game.moveNumber = nextMoveNumber;
  if (!game.moveHistory || typeof game.moveHistory !== "object") {
    game.moveHistory = {};
  }
  game.moveHistory[`m${nextMoveNumber}`] = {
    ...entry,
    moveNumber: nextMoveNumber,
    createdAt: nowMs(),
  };
}

function getGameAndMeta(current, failureRef) {
  if (!current) {
    failureRef.value = "Game not found.";
    return null;
  }
  if (!current.meta || !current.game) {
    failureRef.value = "Game state is missing.";
    return null;
  }
  if (current.meta.status !== "in_progress") {
    failureRef.value = "This game is not active.";
    return null;
  }
  return current;
}

export async function commitMove(codeInput, uid, draftPlacements) {
  const code = sanitizeJoinCode(codeInput);
  if (!code) {
    throw new Error("Missing game code.");
  }

  if (!Array.isArray(draftPlacements) || draftPlacements.length === 0) {
    throw new Error("No tiles selected for this move.");
  }

  const failure = { value: "Could not commit move." };

  const result = await transact(`games/${code}`, (current) => {
    const state = getGameAndMeta(current, failure);
    if (!state) {
      return;
    }

    const game = state.game;
    if (game.currentPlayerUid !== uid) {
      failure.value = "It is not your turn.";
      return;
    }

    const rack = game.racks?.[uid] || [];
    const tileIds = draftPlacements.map((item) => item.tileId);
    if (!ensureRackContains(rack, tileIds)) {
      failure.value = "One or more selected tiles are no longer in your rack.";
      return;
    }

    const rackById = new Map(rack.map((tile) => [tile.id, tile]));
    const placements = draftPlacements.map((item) => ({
      x: Number(item.x),
      y: Number(item.y),
      tile: rackById.get(item.tileId),
    }));

    const board = game.board || {};
    const opening = game.openingRequirement || null;
    const isOpeningMove = Object.keys(board).length === 0;
    const requiredOpeningSize =
      isOpeningMove && opening && opening.uid === uid ? Number(opening.size || 0) : 0;
    if (isOpeningMove && opening && opening.uid === uid && Array.isArray(opening.allowedGroups)) {
      const signature = [...tileIds].sort().join("|");
      if (!opening.allowedGroups.includes(signature)) {
        failure.value = "Opening move must use one of your largest opening groups.";
        return;
      }
    }

    const validation = validateMove(board, placements, {
      isOpeningMove,
      requiredOpeningSize,
    });

    if (!validation.valid) {
      failure.value = validation.reason;
      return;
    }

    const scoreResult = calculateMoveScore(board, placements);
    const scoreGain = Number(scoreResult.score || 0);

    game.board = validation.boardAfter;

    const remainingRack = removeRackTiles(rack, tileIds);
    const refill = drawUntilSix(remainingRack, game.bag || []);
    game.racks[uid] = refill.rack;
    game.bag = refill.bag;

    game.scores[uid] = Number(game.scores?.[uid] || 0) + scoreGain;
    game.consecutivePasses = 0;

    addHistoryEntry(game, {
      type: "move",
      uid,
      tileIds,
      placements: placements.map((placement) => ({
        x: placement.x,
        y: placement.y,
        tileId: placement.tile.id,
      })),
      scoreGain,
    });

    if (opening && opening.uid === uid && isOpeningMove) {
      game.openingRequirement = null;
    }

    const rackIsEmpty = (game.racks[uid] || []).length === 0;
    if (rackIsEmpty && (game.bag || []).length === 0) {
      const bonus = applyEndGameBonus(game.scores, uid, (game.racks[uid] || []).length, (game.bag || []).length);
      game.scores = bonus.scores;
      addHistoryEntry(game, {
        type: "end_bonus",
        uid,
        scoreGain: bonus.bonusApplied ? 6 : 0,
      });
      finalizeGame(state);
    } else {
      advanceTurn(game);
    }

    state.meta.revision = nextRevision(state.meta);
    return state;
  });

  if (!result.committed) {
    throw new Error(failure.value);
  }
}

export async function exchangeTiles(codeInput, uid, selectedTileIds) {
  const code = sanitizeJoinCode(codeInput);
  const ids = [...new Set(selectedTileIds || [])];

  if (!code) {
    throw new Error("Missing game code.");
  }

  if (!ids.length) {
    throw new Error("Select at least one tile to exchange.");
  }

  const failure = { value: "Could not exchange tiles." };

  const result = await transact(`games/${code}`, (current) => {
    const state = getGameAndMeta(current, failure);
    if (!state) {
      return;
    }

    const game = state.game;
    if (game.currentPlayerUid !== uid) {
      failure.value = "It is not your turn.";
      return;
    }

    const rack = game.racks?.[uid] || [];
    if (!ensureRackContains(rack, ids)) {
      failure.value = "Selected tiles are no longer in your rack.";
      return;
    }

    if (!isExchangeLegal((game.bag || []).length, ids.length)) {
      failure.value = "Exchange is only legal when the bag has at least that many tiles.";
      return;
    }

    const returning = rack.filter((tile) => ids.includes(tile.id));
    const rackWithout = removeRackTiles(rack, ids);

    const seed = hashString(`${code}:${state.meta.revision || 0}:${uid}:${ids.join(",")}`);
    const shuffledBag = shuffleWithRandom([...(game.bag || []), ...returning], seededRandom(seed));

    const drawCount = ids.length;
    const draw = shuffledBag.slice(0, drawCount);
    const nextBag = shuffledBag.slice(drawCount);

    game.racks[uid] = [...rackWithout, ...draw];
    game.bag = nextBag;
    game.consecutivePasses = 0;

    addHistoryEntry(game, {
      type: "exchange",
      uid,
      tileIds: ids,
    });

    advanceTurn(game);
    state.meta.revision = nextRevision(state.meta);
    return state;
  });

  if (!result.committed) {
    throw new Error(failure.value);
  }
}

export async function passTurn(codeInput, uid) {
  const code = sanitizeJoinCode(codeInput);
  if (!code) {
    throw new Error("Missing game code.");
  }

  const failure = { value: "Could not pass turn." };

  const result = await transact(`games/${code}`, (current) => {
    const state = getGameAndMeta(current, failure);
    if (!state) {
      return;
    }

    const game = state.game;
    if (game.currentPlayerUid !== uid) {
      failure.value = "It is not your turn.";
      return;
    }

    const openingBlocked =
      Object.keys(game.board || {}).length === 0 && game.openingRequirement?.uid === uid;
    if (openingBlocked) {
      failure.value = "Opening player must place one of the required opening groups.";
      return;
    }

    game.consecutivePasses = Number(game.consecutivePasses || 0) + 1;

    addHistoryEntry(game, {
      type: "pass",
      uid,
    });

    const playerCount = (game.turnOrder || []).length;
    const bagEmpty = (game.bag || []).length === 0;

    if (bagEmpty && game.consecutivePasses >= playerCount) {
      finalizeGame(state);
    } else {
      advanceTurn(game);
    }

    state.meta.revision = nextRevision(state.meta);
    return state;
  });

  if (!result.committed) {
    throw new Error(failure.value);
  }
}
