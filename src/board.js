import { coordinateKey, parseCoordinateKey } from "./utils.js";

export function boardHasTiles(boardMap) {
  return Object.keys(boardMap || {}).length > 0;
}

export function calculateBounds(boardMap, tentativePlacements = [], minSpan = 11, padding = 2) {
  const keys = Object.keys(boardMap || {});
  const coords = keys.map(parseCoordinateKey);

  for (const placement of tentativePlacements) {
    coords.push({ x: placement.x, y: placement.y });
  }

  const effectiveMinSpan = Math.max(51, Number(minSpan || 0));
  const half = Math.floor(effectiveMinSpan / 2);
  let minX = -half;
  let maxX = half;
  let minY = -half;
  let maxY = half;

  if (!coords.length) {
    return { minX, maxX, minY, maxY };
  }

  for (const point of coords) {
    if (point.x < minX) minX = point.x - padding;
    if (point.x > maxX) maxX = point.x + padding;
    if (point.y < minY) minY = point.y - padding;
    if (point.y > maxY) maxY = point.y + padding;
  }

  return { minX, maxX, minY, maxY };
}

export function buildBoardMatrix(bounds) {
  const cells = [];
  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      cells.push({ x, y, key: coordinateKey(x, y) });
    }
  }
  return cells;
}

export function getNeighbors(x, y) {
  return [
    { x: x + 1, y },
    { x: x - 1, y },
    { x, y: y + 1 },
    { x, y: y - 1 },
  ];
}
