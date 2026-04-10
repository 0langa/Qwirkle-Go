import test from "node:test";
import assert from "node:assert/strict";

import {
  createSandboxSnapshot,
  sandboxCommitMove,
  sandboxPassTurn,
  sandboxRerollRack,
  sandboxResizePlayers,
  sandboxSimulateCurrentPlayer,
} from "../src/sandbox.js";

test("sandbox: creates isolated in-progress snapshot", () => {
  const snapshot = createSandboxSnapshot({
    testerUid: "me",
    testerName: "Tester",
    playerCount: 3,
  });
  assert.equal(snapshot.meta.mode, "sandbox");
  assert.equal(snapshot.meta.status, "in_progress");
  assert.equal(snapshot.game.turnOrder.length, 3);
  assert.equal(snapshot.game.currentPlayerUid, "me");
});

test("sandbox: strict validation rejects disconnected placement", () => {
  const snapshot = createSandboxSnapshot({
    testerUid: "me",
    testerName: "Tester",
    playerCount: 2,
  });

  const firstTile = snapshot.game.racks.me[0];
  const firstMove = sandboxCommitMove(snapshot, "me", [{ x: 0, y: 0, tile: firstTile }], {
    strictValidation: true,
  });
  assert.equal(firstMove.ok, true);

  const next = firstMove.snapshot;
  const meAgain = next.game.racks.me[0];
  const forcedTurn = {
    ...next,
    game: {
      ...next.game,
      currentPlayerUid: "me",
      currentTurnIndex: 0,
    },
  };
  const invalid = sandboxCommitMove(forcedTurn, "me", [{ x: 4, y: 4, tile: meAgain }], {
    strictValidation: true,
  });
  assert.equal(invalid.ok, false);
});

test("sandbox: pass advances to next simulated player", () => {
  const snapshot = createSandboxSnapshot({
    testerUid: "me",
    testerName: "Tester",
    playerCount: 3,
  });
  const current = snapshot.game.currentPlayerUid;
  const result = sandboxPassTurn(snapshot, current);
  assert.equal(result.ok, true);
  assert.notEqual(result.snapshot.game.currentPlayerUid, current);
});

test("sandbox: reroll keeps rack size and changes ids", () => {
  const snapshot = createSandboxSnapshot({
    testerUid: "me",
    testerName: "Tester",
    playerCount: 2,
  });
  const before = snapshot.game.racks.me.map((tile) => tile.id);
  const next = sandboxRerollRack(snapshot, "me");
  const after = next.game.racks.me.map((tile) => tile.id);
  assert.equal(after.length, 6);
  assert.notDeepEqual(after, before);
});

test("sandbox: resize players updates turn order", () => {
  const snapshot = createSandboxSnapshot({
    testerUid: "me",
    testerName: "Tester",
    playerCount: 2,
  });
  const resized = sandboxResizePlayers(snapshot, 4);
  assert.equal(resized.game.turnOrder.length, 4);
  assert.ok(resized.players["sandbox-bot-3"]);
});

test("sandbox: simulate current player returns actionable result", () => {
  const snapshot = createSandboxSnapshot({
    testerUid: "me",
    testerName: "Tester",
    playerCount: 2,
  });
  const result = sandboxSimulateCurrentPlayer(snapshot, { strictValidation: true });
  assert.equal(result.ok, true);
  assert.ok(result.summary.length > 0);
});

