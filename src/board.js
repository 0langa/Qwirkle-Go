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

  if (!coords.length) {
    const half = Math.floor(minSpan / 2);
    return {
      minX: -half,
      maxX: half,
      minY: -half,
      maxY: half,
    };
  }

  let minX = coords[0].x;
  let maxX = coords[0].x;
  let minY = coords[0].y;
  let maxY = coords[0].y;

  for (const point of coords) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }

  minX -= padding;
  maxX += padding;
  minY -= padding;
  maxY += padding;

  const width = maxX - minX + 1;
  const height = maxY - minY + 1;

  if (width < minSpan) {
    const add = minSpan - width;
    minX -= Math.floor(add / 2);
    maxX += Math.ceil(add / 2);
  }

  if (height < minSpan) {
    const add = minSpan - height;
    minY -= Math.floor(add / 2);
    maxY += Math.ceil(add / 2);
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
