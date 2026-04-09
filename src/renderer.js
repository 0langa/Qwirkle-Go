import { buildBoardMatrix, calculateBounds } from "./board.js";
import { coordinateKey } from "./utils.js";

// SVG paths for the 6 Qwirkle shapes (viewBox 0 0 24 24)
const SHAPE_SVGS = {
  circle:  '<circle cx="12" cy="12" r="8"/>',
  square:  '<rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/>',
  diamond: '<polygon points="12,2 22,12 12,22 2,12"/>',
  star:    '<path d="M12,1.8 L14.4,8.8 L21.8,8.8 L15.9,13.4 L18.2,20.4 L12,15.8 L5.8,20.4 L8.1,13.4 L2.2,8.8 L9.6,8.8 Z"/>',
  clover:  '<circle cx="12" cy="7" r="4.2"/><circle cx="17" cy="12" r="4.2"/><circle cx="12" cy="17" r="4.2"/><circle cx="7" cy="12" r="4.2"/>',
  cross:   '<path d="M9.5,2.5 H14.5 V9.5 H21.5 V14.5 H14.5 V21.5 H9.5 V14.5 H2.5 V9.5 H9.5 Z"/>',
};

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Returns the inner SVG markup for a shape
function shapeMarkup(shape) {
  return SHAPE_SVGS[shape] || SHAPE_SVGS.circle;
}

// Exported so app.js can create a drag ghost
export function renderTileHtml(tile, options = {}) {
  const classes = ["tile", tile.color];
  if (options.tentative) classes.push("tentative");
  if (options.invalid)   classes.push("invalid");

  const svg = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${shapeMarkup(tile.shape)}</svg>`;
  return `<div class="${classes.join(" ")}" title="${escapeHtml(tile.color)} ${escapeHtml(tile.shape)}">${svg}</div>`;
}

export function renderLobbyPlayers(container, playersByUid, currentUid) {
  const players = Object.values(playersByUid || {}).sort(
    (a, b) => Number(a.joinedAt || 0) - Number(b.joinedAt || 0)
  );

  if (!players.length) {
    container.innerHTML = '<li class="player-row"><span class="player-name muted">Noch keine Spieler.</span></li>';
    return;
  }

  container.innerHTML = players
    .map((player) => {
      const isCurrent = player.uid === currentUid;
      const rowClass = isCurrent ? "player-row current" : "player-row";

      const tags = [];
      if (player.isHost)  tags.push('<span class="tag tag-host">Host</span>');
      if (isCurrent)      tags.push('<span class="tag tag-you">Du</span>');
      if (!player.connected) tags.push('<span class="tag tag-offline">Offline</span>');

      return `
        <li class="${rowClass}">
          <span class="player-name">${escapeHtml(player.name)}</span>
          <span class="player-tags">${tags.join("")}</span>
        </li>`;
    })
    .join("");
}

export function renderScoreboard(container, playersByUid, scoresByUid, currentPlayerUid, currentUid, turnOrder) {
  const order = turnOrder || Object.keys(playersByUid || {});

  const rows = order
    .map((uid) => {
      const player = playersByUid?.[uid];
      if (!player) return null;

      const isActive = uid === currentPlayerUid;
      const isMe     = uid === currentUid;
      const rowClass = isActive ? "score-row current" : "score-row";

      const tags = [];
      if (isActive) tags.push('<span class="tag tag-you" style="font-size:0.65rem;padding:0.1rem 0.35rem">Zug</span>');
      if (isMe)     tags.push('<span class="tag tag-host" style="font-size:0.65rem;padding:0.1rem 0.35rem">Du</span>');

      return `
        <li class="${rowClass}">
          <span class="score-name">${escapeHtml(player.name)}</span>
          <span class="score-right">
            <span class="score-pts">${Number(scoresByUid?.[uid] || 0)}</span>
            ${tags.join("")}
          </span>
        </li>`;
    })
    .filter(Boolean);

  container.innerHTML = rows.join("");
}

export function renderRack(container, rackTiles, selectedTileId, exchangeSelection, exchangeMode) {
  const exchangeSet = exchangeSelection || new Set();

  if (!rackTiles?.length) {
    container.innerHTML = '<p class="rack-empty muted">Ablageständer leer.</p>';
    return;
  }

  container.innerHTML = rackTiles
    .map((tile) => {
      const classes = ["rack-tile"];
      if (selectedTileId === tile.id) classes.push("selected");
      if (exchangeSet.has(tile.id))   classes.push("exchange-selected");
      if (exchangeMode)               classes.push("exchange-mode-active");

      const marker = exchangeMode && exchangeSet.has(tile.id)
        ? '<span class="rack-marker">✕</span>'
        : "";

      return `
        <button
          class="${classes.join(" ")}"
          data-rack-tile-id="${escapeHtml(tile.id)}"
          type="button"
          aria-label="${escapeHtml(tile.color)} ${escapeHtml(tile.shape)}"
          draggable="false"
        >
          ${renderTileHtml(tile)}
          ${marker}
        </button>`;
    })
    .join("");
}

export function renderBoardGrid(container, { boardMap, tentativePlacements, interactive }) {
  const tentativeMap = new Map();
  for (const p of tentativePlacements || []) {
    tentativeMap.set(coordinateKey(p.x, p.y), p.tile);
  }

  const bounds = calculateBounds(boardMap, tentativePlacements || []);
  const cells  = buildBoardMatrix(bounds);
  const width  = bounds.maxX - bounds.minX + 1;

  container.style.gridTemplateColumns = `repeat(${width}, var(--cell))`;

  container.innerHTML = cells
    .map((cell) => {
      const permanentTile = boardMap?.[cell.key] || null;
      const tentativeTile = tentativeMap.get(cell.key) || null;
      const tile = tentativeTile || permanentTile;

      const classes = ["board-cell"];
      if (!tile && interactive) classes.push("clickable");

      const inner = tile
        ? renderTileHtml(tile, { tentative: Boolean(tentativeTile) })
        : "";

      // Tentative tiles are clickable (to remove), permanent tiles are not
      const disabled = !interactive && !tentativeTile ? "disabled" : "";

      return `
        <button
          type="button"
          class="${classes.join(" ")}"
          data-board-x="${cell.x}"
          data-board-y="${cell.y}"
          ${disabled}
          aria-label="Feld ${cell.x},${cell.y}"
        >${inner}</button>`;
    })
    .join("");
}

export function buildResultSummary(playersByUid, standings, winnerUids) {
  if (!standings?.length) {
    return { winnerLine: "Kein Endergebnis verfügbar.", rows: [] };
  }

  const winnerNames = (winnerUids || [])
    .map((uid) => playersByUid?.[uid]?.name || uid)
    .filter(Boolean);

  const winnerLine =
    winnerNames.length > 1
      ? `Geteilte Sieger: ${winnerNames.join(", ")}`
      : `Sieger: ${winnerNames[0] || standings[0].name}`;

  return {
    winnerLine,
    rows: standings.map((entry) => `${entry.name}: ${entry.score} Punkte`),
  };
}
