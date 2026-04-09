export function findTileInRack(rackTiles, tileId) {
  return (rackTiles || []).find((tile) => tile.id === tileId) || null;
}

export function rackContainsTiles(rackTiles, tileIds) {
  const ids = new Set((rackTiles || []).map((tile) => tile.id));
  return tileIds.every((tileId) => ids.has(tileId));
}

export function removeTilesById(rackTiles, tileIds) {
  const removeSet = new Set(tileIds);
  return (rackTiles || []).filter((tile) => !removeSet.has(tile.id));
}
