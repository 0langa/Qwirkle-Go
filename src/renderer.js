import { buildBoardMatrix, calculateBounds } from "./board.js";
import { coordinateKey } from "./utils.js";

// SVG paths for the 6 Qwirkle shapes (viewBox 0 0 24 24)
const SHAPE_SVGS = {
  circle:  '<circle cx="12" cy="12" r="8.2"/>',
  square:  '<rect x="4" y="4" width="16" height="16"/>',
  diamond: '<polygon points="12,2.6 21.4,12 12,21.4 2.6,12"/>',
  // 8-point burst star to match the provided style sheet
  star:    '<polygon points="12,2 14,7.5 19.5,5.5 17.5,11 23,13 17.5,15 19.5,20.5 14,18.5 12,24 10,18.5 4.5,20.5 6.5,15 1,13 6.5,11 4.5,5.5 10,7.5"/>',
  clover:  '<circle cx="12" cy="7" r="4.2"/><circle cx="17" cy="12" r="4.2"/><circle cx="12" cy="17" r="4.2"/><circle cx="7" cy="12" r="4.2"/>',
  // Concave 4-point star / X-star to match row 4 in the provided image
  cross:   '<polygon points="12,2.2 14.9,8.4 21.8,5.1 18.5,12 21.8,18.9 14.9,15.6 12,21.8 9.1,15.6 2.2,18.9 5.5,12 2.2,5.1 9.1,8.4"/>',
};

const COLOR_NAMES_DE = {
  red: "Rot",
  orange: "Orange",
  yellow: "Gelb",
  green: "Grün",
  blue: "Blau",
  purple: "Lila",
};

const SHAPE_NAMES_DE = {
  circle: "Kreis",
  square: "Quadrat",
  diamond: "Raute",
  star: "Stern",
  clover: "Kleeblatt",
  cross: "Kreuzstern",
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

function tileTitleDe(tile) {
  const color = COLOR_NAMES_DE[tile?.color] || String(tile?.color || "");
  const shape = SHAPE_NAMES_DE[tile?.shape] || String(tile?.shape || "");
  return `${color} ${shape}`.trim();
}

// Exported so app.js can create a drag ghost
export function renderTileHtml(tile, options = {}) {
  const classes = ["tile", tile.color];
  if (options.tentative) classes.push("tentative");
  if (options.invalid)   classes.push("invalid");

  const svg = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${shapeMarkup(tile.shape)}</svg>`;
  return `<div class="${classes.join(" ")}" title="${escapeHtml(tileTitleDe(tile))}">${svg}</div>`;
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
          aria-label="${escapeHtml(tileTitleDe(tile))}"
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
      if (!tile && cell.x === 0 && cell.y === 0) classes.push("center-origin");

      const inner = tile
        ? renderTileHtml(tile, { tentative: Boolean(tentativeTile) })
        : (cell.x === 0 && cell.y === 0 ? '<span class="center-marker" aria-hidden="true"></span>' : "");

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
