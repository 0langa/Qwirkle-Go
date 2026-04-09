import { coordinateKey, parseCoordinateKey } from "./utils.js";

export const COLORS = ["red", "orange", "yellow", "green", "blue", "purple"];
export const SHAPES = ["circle", "square", "diamond", "star", "clover", "cross"];

export function createTileSet() {
  const tiles = [];
  for (const color of COLORS) {
    for (const shape of SHAPES) {
      for (let copy = 1; copy <= 3; copy += 1) {
        tiles.push({
          id: `${color}-${shape}-${copy}`,
          color,
          shape,
        });
      }
    }
  }
  return tiles;
}

export function shuffleTiles(tiles, randomFn = Math.random) {
  const next = [...tiles];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(randomFn() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

export function drawFromBag(bag, count) {
  const drawCount = Math.min(count, bag.length);
  return {
    drawn: bag.slice(0, drawCount),
    bag: bag.slice(drawCount),
  };
}

export function isValidLineTiles(tiles) {
  if (!Array.isArray(tiles) || tiles.length <= 1) {
    return true;
  }

  if (tiles.length > 6) {
    return false;
  }

  const signatures = new Set();
  for (const tile of tiles) {
    const signature = `${tile.color}:${tile.shape}`;
    if (signatures.has(signature)) {
      return false;
    }
    signatures.add(signature);
  }

  const first = tiles[0];
  const sameColor = tiles.every((tile) => tile.color === first.color);
  const sameShape = tiles.every((tile) => tile.shape === first.shape);

  if (!sameColor && !sameShape) {
    return false;
  }

  if (sameColor) {
    const uniqueShapes = new Set(tiles.map((tile) => tile.shape));
    if (uniqueShapes.size !== tiles.length) {
      return false;
    }
  }

  if (sameShape) {
    const uniqueColors = new Set(tiles.map((tile) => tile.color));
    if (uniqueColors.size !== tiles.length) {
      return false;
    }
  }

  return true;
}

function getAllSubsetGroups(tiles) {
  const groups = [];
  const total = 1 << tiles.length;

  for (let mask = 1; mask < total; mask += 1) {
    const group = [];
    for (let index = 0; index < tiles.length; index += 1) {
      if ((mask & (1 << index)) !== 0) {
        group.push(tiles[index]);
      }
    }
    groups.push(group);
  }

  return groups;
}

export function findLargestOpeningGroups(rackTiles) {
  const groups = getAllSubsetGroups(rackTiles || []);
  let maxSize = 0;
  const candidates = [];

  for (const group of groups) {
    if (!isValidLineTiles(group)) {
      continue;
    }

    if (group.length > maxSize) {
      maxSize = group.length;
      candidates.length = 0;
      candidates.push(group);
    } else if (group.length === maxSize) {
      candidates.push(group);
    }
  }

  const dedup = new Map();
  for (const candidate of candidates) {
    const signature = candidate
      .map((tile) => tile.id)
      .sort()
      .join("|");
    dedup.set(signature, candidate);
  }

  return {
    maxSize,
    groups: Array.from(dedup.values()),
  };
}

export function determineFirstPlayer(joinOrderUids, racksByUid) {
  const order = [...joinOrderUids];
  let firstUid = order[0] || null;
  let bestSize = -1;
  const largestByUid = {};

  for (const uid of order) {
    const rack = racksByUid[uid] || [];
    const { maxSize } = findLargestOpeningGroups(rack);
    largestByUid[uid] = maxSize;
    if (maxSize > bestSize) {
      bestSize = maxSize;
      firstUid = uid;
    }
  }

  return {
    firstUid,
    requiredOpeningSize: Math.max(bestSize, 1),
    largestByUid,
  };
}

function tileAt(boardMap, x, y) {
  return boardMap[coordinateKey(x, y)] || null;
}

function collectLine(boardMap, x, y, dx, dy) {
  const coords = [];

  let cx = x;
  let cy = y;
  while (tileAt(boardMap, cx - dx, cy - dy)) {
    cx -= dx;
    cy -= dy;
  }

  while (tileAt(boardMap, cx, cy)) {
    coords.push({ x: cx, y: cy, tile: tileAt(boardMap, cx, cy) });
    cx += dx;
    cy += dy;
  }

  return {
    coords,
    tiles: coords.map((entry) => entry.tile),
  };
}

function collectAffectedLines(boardMapAfter, placements) {
  const unique = new Map();

  for (const placement of placements) {
    const horizontal = collectLine(boardMapAfter, placement.x, placement.y, 1, 0);
    const vertical = collectLine(boardMapAfter, placement.x, placement.y, 0, 1);

    const horizontalKey = `H:${horizontal.coords
      .map((cell) => coordinateKey(cell.x, cell.y))
      .join("|")}`;
    const verticalKey = `V:${vertical.coords
      .map((cell) => coordinateKey(cell.x, cell.y))
      .join("|")}`;

    unique.set(horizontalKey, horizontal);
    unique.set(verticalKey, vertical);
  }

  return Array.from(unique.values());
}

function hasExistingNeighbor(boardMap, x, y) {
  return (
    tileAt(boardMap, x + 1, y) ||
    tileAt(boardMap, x - 1, y) ||
    tileAt(boardMap, x, y + 1) ||
    tileAt(boardMap, x, y - 1)
  );
}

export function validateMove(boardMap, placements, options = {}) {
  const {
    isOpeningMove = false,
    requiredOpeningSize = 0,
  } = options;

  const baseBoard = boardMap || {};
  const boardIsEmpty = Object.keys(baseBoard).length === 0;

  if (!Array.isArray(placements) || placements.length === 0) {
    return { valid: false, reason: "Place at least one tile." };
  }

  if (!isOpeningMove && boardIsEmpty) {
    return { valid: false, reason: "Opening move is required before regular turns." };
  }

  if (isOpeningMove && !boardIsEmpty) {
    return { valid: false, reason: "Opening move can only be played on an empty board." };
  }

  if (isOpeningMove && requiredOpeningSize > 0 && placements.length !== requiredOpeningSize) {
    return {
      valid: false,
      reason: `Opening move must place exactly ${requiredOpeningSize} tile(s).`,
    };
  }

  const coordSet = new Set();
  const tileIdSet = new Set();
  for (const placement of placements) {
    if (!Number.isInteger(placement.x) || !Number.isInteger(placement.y)) {
      return { valid: false, reason: "Invalid board coordinate." };
    }
    const key = coordinateKey(placement.x, placement.y);
    if (coordSet.has(key)) {
      return { valid: false, reason: "Cannot place two tiles on the same cell." };
    }
    if (tileAt(baseBoard, placement.x, placement.y)) {
      return { valid: false, reason: "Cannot place on an occupied cell." };
    }
    coordSet.add(key);

    if (!placement.tile || !placement.tile.id) {
      return { valid: false, reason: "Missing tile details." };
    }
    if (tileIdSet.has(placement.tile.id)) {
      return { valid: false, reason: "Cannot place the same tile twice." };
    }
    tileIdSet.add(placement.tile.id);
  }

  const sameX = placements.every((entry) => entry.x === placements[0].x);
  const sameY = placements.every((entry) => entry.y === placements[0].y);

  if (!sameX && !sameY) {
    return { valid: false, reason: "All placed tiles must be in one row or one column." };
  }

  const orientation = sameX ? "vertical" : "horizontal";

  if (placements.length > 1) {
    const fixed = sameX ? placements[0].x : placements[0].y;
    const values = placements.map((entry) => (sameX ? entry.y : entry.x)).sort((a, b) => a - b);
    const min = values[0];
    const max = values[values.length - 1];

    for (let value = min; value <= max; value += 1) {
      const x = sameX ? fixed : value;
      const y = sameX ? value : fixed;
      const key = coordinateKey(x, y);
      if (!baseBoard[key] && !coordSet.has(key)) {
        return { valid: false, reason: "Placed tiles must form a contiguous line without gaps." };
      }
    }
  }

  if (!boardIsEmpty && !isOpeningMove) {
    const touchesExisting = placements.some((entry) =>
      hasExistingNeighbor(baseBoard, entry.x, entry.y)
    );
    if (!touchesExisting) {
      return { valid: false, reason: "Move must connect to the existing board." };
    }
  }

  const boardAfter = { ...baseBoard };
  for (const placement of placements) {
    boardAfter[coordinateKey(placement.x, placement.y)] = placement.tile;
  }

  const lines = collectAffectedLines(boardAfter, placements);
  for (const line of lines) {
    if (!isValidLineTiles(line.tiles)) {
      return { valid: false, reason: "Move creates an invalid line." };
    }
  }

  return {
    valid: true,
    orientation,
    boardAfter,
    lines,
  };
}

export function calculateMoveScore(boardMap, placements) {
  const boardAfter = { ...boardMap };
  for (const placement of placements) {
    boardAfter[coordinateKey(placement.x, placement.y)] = placement.tile;
  }

  const lines = collectAffectedLines(boardAfter, placements);
  let score = 0;

  for (const line of lines) {
    const length = line.tiles.length;
    if (length > 1) {
      score += length;
      if (length === 6) {
        score += 6;
      }
    }
  }

  if (score === 0) {
    score = placements.length;
  }

  return {
    score,
    lines,
  };
}

export function isExchangeLegal(bagCount, exchangeCount) {
  return exchangeCount > 0 && bagCount >= exchangeCount;
}

export function applyEndGameBonus(scoresByUid, uid, rackSize, bagCount) {
  const scores = { ...(scoresByUid || {}) };
  if (rackSize === 0 && bagCount === 0 && uid) {
    scores[uid] = Number(scores[uid] || 0) + 6;
    return {
      scores,
      bonusApplied: true,
    };
  }
  return {
    scores,
    bonusApplied: false,
  };
}

export function calculateStandings(playersByUid, scoresByUid) {
  return Object.values(playersByUid || {})
    .map((player) => ({
      uid: player.uid,
      name: player.name,
      score: Number(scoresByUid?.[player.uid] || 0),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.name.localeCompare(b.name);
    });
}

export function findWinnerUids(scoresByUid) {
  const entries = Object.entries(scoresByUid || {});
  if (!entries.length) {
    return [];
  }
  const maxScore = Math.max(...entries.map((entry) => Number(entry[1] || 0)));
  return entries.filter((entry) => Number(entry[1] || 0) === maxScore).map((entry) => entry[0]);
}

export function boardFromRows(rows) {
  const board = {};
  for (const row of rows) {
    const key = coordinateKey(row.x, row.y);
    board[key] = {
      id: row.id,
      color: row.color,
      shape: row.shape,
    };
  }
  return board;
}

export function lineTilesAt(boardMap, x, y, axis = "horizontal") {
  const direction = axis === "vertical" ? [0, 1] : [1, 0];
  return collectLine(boardMap, x, y, direction[0], direction[1]).tiles;
}

export function boardCoordinates(boardMap) {
  return Object.keys(boardMap || {}).map(parseCoordinateKey);
}
