import {
  applyEndGameBonus,
  boardFromRows,
  calculateMoveScore,
  createTileSet,
  determineFirstPlayer,
  findLargestOpeningGroups,
  isExchangeLegal,
  isValidLineTiles,
  validateMove,
} from "../src/rules.js";

const output = document.getElementById("test-output");

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(condition, message = "Assertion failed") {
  if (!condition) {
    throw new Error(message);
  }
}

function tile(id, color, shape) {
  return { id, color, shape };
}

test("full tile count is 108", () => {
  const tiles = createTileSet();
  assert(tiles.length === 108, `Expected 108, received ${tiles.length}`);
});

test("opening group detection finds largest valid group", () => {
  const rack = [
    tile("a", "red", "circle"),
    tile("b", "red", "square"),
    tile("c", "red", "diamond"),
    tile("d", "blue", "circle"),
    tile("e", "green", "cross"),
    tile("f", "orange", "cross"),
  ];

  const result = findLargestOpeningGroups(rack);
  assert(result.maxSize === 3, `Expected max opening group 3, got ${result.maxSize}`);
});

test("first-player tie uses deterministic join order", () => {
  const racks = {
    p1: [tile("a", "red", "circle"), tile("b", "red", "square"), tile("c", "red", "diamond")],
    p2: [tile("d", "blue", "circle"), tile("e", "blue", "square"), tile("f", "blue", "diamond")],
  };

  const first = determineFirstPlayer(["p1", "p2"], racks);
  assert(first.firstUid === "p1", `Expected p1, got ${first.firstUid}`);
  assert(first.requiredOpeningSize === 3, "Expected opening size 3");
});

test("valid line accepts same color with unique shapes", () => {
  const line = [
    tile("a", "red", "circle"),
    tile("b", "red", "square"),
    tile("c", "red", "diamond"),
  ];
  assert(isValidLineTiles(line), "Line should be valid");
});

test("duplicate exact tile is rejected", () => {
  const line = [
    tile("a", "red", "circle"),
    tile("b", "red", "circle"),
  ];
  assert(!isValidLineTiles(line), "Duplicate tile combination should be invalid");
});

test("mixed rule line is rejected", () => {
  const line = [
    tile("a", "red", "circle"),
    tile("b", "red", "square"),
    tile("c", "blue", "diamond"),
  ];
  assert(!isValidLineTiles(line), "Mixed line should be invalid");
});

test("line longer than 6 is rejected", () => {
  const line = [
    tile("1", "red", "circle"),
    tile("2", "red", "square"),
    tile("3", "red", "diamond"),
    tile("4", "red", "star"),
    tile("5", "red", "clover"),
    tile("6", "red", "cross"),
    tile("7", "red", "triangle"),
  ];
  assert(!isValidLineTiles(line), "Line length > 6 should be invalid");
});

test("move must connect to existing board after opening", () => {
  const board = boardFromRows([{ x: 0, y: 0, id: "a", color: "red", shape: "circle" }]);
  const placements = [{ x: 2, y: 2, tile: tile("b", "red", "square") }];
  const result = validateMove(board, placements, { isOpeningMove: false });
  assert(!result.valid, "Disconnected move should be invalid");
});

test("gapped placement is rejected", () => {
  const board = {};
  const placements = [
    { x: 0, y: 0, tile: tile("a", "red", "circle") },
    { x: 2, y: 0, tile: tile("b", "red", "square") },
  ];
  const result = validateMove(board, placements, { isOpeningMove: true });
  assert(!result.valid, "Gap in move should be invalid");
});

test("basic scoring counts single opening tile as 1", () => {
  const board = {};
  const placements = [{ x: 0, y: 0, tile: tile("a", "red", "circle") }];
  const score = calculateMoveScore(board, placements);
  assert(score.score === 1, `Expected 1, got ${score.score}`);
});

test("perpendicular scoring counts main and cross lines", () => {
  const board = boardFromRows([
    { x: 0, y: 0, id: "a", color: "red", shape: "circle" },
    { x: 1, y: 0, id: "b", color: "red", shape: "square" },
    { x: 2, y: -1, id: "c", color: "yellow", shape: "diamond" },
    { x: 2, y: 1, id: "d", color: "green", shape: "diamond" },
  ]);

  const placements = [{ x: 2, y: 0, tile: tile("e", "red", "diamond") }];
  const score = calculateMoveScore(board, placements);
  assert(score.score === 6, `Expected 6, got ${score.score}`);
});

test("qwirkle bonus adds +6 on completed line of 6", () => {
  const board = boardFromRows([
    { x: 0, y: 0, id: "a", color: "red", shape: "circle" },
    { x: 1, y: 0, id: "b", color: "red", shape: "square" },
    { x: 2, y: 0, id: "c", color: "red", shape: "diamond" },
    { x: 3, y: 0, id: "d", color: "red", shape: "star" },
    { x: 4, y: 0, id: "e", color: "red", shape: "clover" },
  ]);

  const placements = [{ x: 5, y: 0, tile: tile("f", "red", "cross") }];
  const score = calculateMoveScore(board, placements);
  assert(score.score === 12, `Expected 12, got ${score.score}`);
});

test("end-game bonus scoring applies +6 when rack and bag are empty", () => {
  const bonus = applyEndGameBonus({ p1: 14 }, "p1", 0, 0);
  assert(bonus.bonusApplied, "Bonus should apply");
  assert(bonus.scores.p1 === 20, `Expected 20, got ${bonus.scores.p1}`);
});

test("exchange legality requires enough bag tiles", () => {
  assert(isExchangeLegal(3, 2), "Expected legal exchange");
  assert(!isExchangeLegal(1, 2), "Expected illegal exchange");
  assert(!isExchangeLegal(3, 0), "Expected illegal zero exchange");
});

async function run() {
  let passed = 0;
  let failed = 0;

  for (const entry of tests) {
    try {
      await entry.fn();
      passed += 1;
      output.insertAdjacentHTML("beforeend", `<li class="ok">PASS - ${entry.name}</li>`);
    } catch (error) {
      failed += 1;
      output.insertAdjacentHTML(
        "beforeend",
        `<li class="fail">FAIL - ${entry.name}<br><code>${error.message}</code></li>`
      );
    }
  }

  const summary = document.getElementById("summary");
  summary.textContent = `Passed: ${passed} | Failed: ${failed}`;
  summary.className = failed ? "fail" : "ok";
}

run();
