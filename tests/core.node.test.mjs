import test from "node:test";
import assert from "node:assert/strict";

import {
  createTileSet,
  determineFirstPlayer,
  findLargestOpeningGroups,
  isValidLineTiles,
  validateMove,
  calculateMoveScore,
} from "../src/rules.js";
import { evaluateLobbyStartReadiness } from "../src/lobby-readiness.js";
import {
  canHostSkipOfflineTurn,
  hasOpeningPlacementRequirement,
  OFFLINE_SKIP_GRACE_MS,
} from "../src/turn-guards.js";

function tile(id, color, shape) {
  return { id, color, shape };
}

test("rules: full tile count is 108", () => {
  const tiles = createTileSet();
  assert.equal(tiles.length, 108);
});

test("rules: largest opening group is detected", () => {
  const rack = [
    tile("a", "red", "circle"),
    tile("b", "red", "square"),
    tile("c", "red", "diamond"),
    tile("d", "blue", "circle"),
    tile("e", "green", "cross"),
    tile("f", "orange", "cross"),
  ];
  const result = findLargestOpeningGroups(rack);
  assert.equal(result.maxSize, 3);
});

test("rules: first player tie keeps deterministic join order", () => {
  const racks = {
    p1: [tile("a", "red", "circle"), tile("b", "red", "square"), tile("c", "red", "diamond")],
    p2: [tile("d", "blue", "circle"), tile("e", "blue", "square"), tile("f", "blue", "diamond")],
  };
  const first = determineFirstPlayer(["p1", "p2"], racks);
  assert.equal(first.firstUid, "p1");
  assert.equal(first.requiredOpeningSize, 3);
});

test("rules: invalid mixed line rejected", () => {
  const line = [
    tile("a", "red", "circle"),
    tile("b", "red", "square"),
    tile("c", "blue", "diamond"),
  ];
  assert.equal(isValidLineTiles(line), false);
});

test("rules: move must be contiguous", () => {
  const board = {};
  const placements = [
    { x: 0, y: 0, tile: tile("a", "red", "circle") },
    { x: 2, y: 0, tile: tile("b", "red", "square") },
  ];
  const result = validateMove(board, placements, { isOpeningMove: true });
  assert.equal(result.valid, false);
});

test("rules: perpendicular scoring sums affected lines", () => {
  const board = {
    "0,0": tile("a", "red", "circle"),
    "1,0": tile("b", "red", "square"),
    "2,-1": tile("c", "yellow", "diamond"),
    "2,1": tile("d", "green", "diamond"),
  };
  const placements = [{ x: 2, y: 0, tile: tile("e", "red", "diamond") }];
  const result = calculateMoveScore(board, placements);
  assert.equal(result.score, 6);
});

test("lobby readiness: all players must be connected and ready", () => {
  const players = {
    p1: { uid: "p1", connected: true, ready: true },
    p2: { uid: "p2", connected: true, ready: false },
  };
  const readiness = evaluateLobbyStartReadiness(players);
  assert.equal(readiness.count, 2);
  assert.equal(readiness.connectedCount, 2);
  assert.equal(readiness.readyCount, 1);
  assert.equal(readiness.canStart, false);
});

test("opening guard: exchange during mandatory opening is blocked by guard", () => {
  const game = {
    board: {},
    openingRequirement: {
      uid: "p1",
      size: 3,
      allowedGroups: [],
    },
  };
  assert.equal(hasOpeningPlacementRequirement(game, "p1"), true);
  assert.equal(hasOpeningPlacementRequirement(game, "p2"), false);
});

test("offline skip guard: host can skip only after grace time", () => {
  const base = {
    meta: { hostUid: "host1" },
    players: {
      host1: { uid: "host1", connected: true, lastSeenAt: 0 },
      p2: { uid: "p2", connected: false, lastSeenAt: 1000 },
    },
    game: { currentPlayerUid: "p2" },
  };

  const tooEarly = canHostSkipOfflineTurn(base, "host1", 1000 + OFFLINE_SKIP_GRACE_MS - 1);
  assert.equal(tooEarly.ok, false);

  const allowed = canHostSkipOfflineTurn(base, "host1", 1000 + OFFLINE_SKIP_GRACE_MS + 1);
  assert.equal(allowed.ok, true);
  assert.equal(allowed.skippedUid, "p2");
});
