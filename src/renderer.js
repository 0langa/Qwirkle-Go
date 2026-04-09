import { buildBoardMatrix, calculateBounds } from "./board.js";
import { coordinateKey } from "./utils.js";

const SHAPE_SYMBOLS = {
  circle: "●",
  square: "■",
  diamond: "◆",
  star: "★",
  clover: "✿",
  cross: "✚",
};

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderLobbyPlayers(container, playersByUid, currentUid) {
  const players = Object.values(playersByUid || {}).sort((a, b) => Number(a.joinedAt || 0) - Number(b.joinedAt || 0));

  if (!players.length) {
    container.innerHTML = '<li class="player-row"><span>No players yet.</span></li>';
    return;
  }

  container.innerHTML = players
    .map((player) => {
      const classes = ["player-row"];
      if (player.uid === currentUid) {
        classes.push("current");
      }

      const tags = [];
      if (player.isHost) {
        tags.push('<span class="host-tag">Host</span>');
      }
      if (player.uid === currentUid) {
        tags.push('<span class="turn-tag">You</span>');
      }
      if (!player.connected) {
        tags.push('<span class="offline-tag">Offline</span>');
      }

      return `
        <li class="${classes.join(" ")}">
          <span>${escapeHtml(player.name)}</span>
          <span>${tags.join(" ")}</span>
        </li>
      `;
    })
    .join("");
}

export function renderScoreboard(container, playersByUid, scoresByUid, currentPlayerUid, currentUid, turnOrder) {
  const order = turnOrder || Object.keys(playersByUid || {});

  const scoreRows = order.map((uid) => {
    const player = playersByUid?.[uid];
    if (!player) {
      return null;
    }

    const classes = ["score-row"];
    if (uid === currentPlayerUid) {
      classes.push("current");
    }

    const tags = [];
    if (uid === currentPlayerUid) {
      tags.push('<span class="turn-tag">Current</span>');
    }
    if (uid === currentUid) {
      tags.push('<span class="host-tag">You</span>');
    }

    return `
      <li class="${classes.join(" ")}">
        <span>${escapeHtml(player.name)}</span>
        <span>
          ${Number(scoresByUid?.[uid] || 0)}
          ${tags.join(" ")}
        </span>
      </li>
    `;
  });

  container.innerHTML = scoreRows.filter(Boolean).join("");
}

function renderTile(tile, options = {}) {
  const classes = ["tile", tile.color];
  if (options.tentative) {
    classes.push("tentative");
  }

  const symbol = SHAPE_SYMBOLS[tile.shape] || "?";
  return `<div class="${classes.join(" ")}" title="${tile.color} ${tile.shape}">${symbol}</div>`;
}

export function renderRack(container, rackTiles, selectedTileId, exchangeSelection, exchangeMode) {
  const exchangeSet = exchangeSelection || new Set();

  if (!rackTiles?.length) {
    container.innerHTML = '<p class="muted">Rack empty.</p>';
    return;
  }

  container.innerHTML = rackTiles
    .map((tile) => {
      const classes = ["rack-tile"];
      if (selectedTileId === tile.id) {
        classes.push("selected");
      }
      if (exchangeSet.has(tile.id)) {
        classes.push("exchange-selected");
      }

      return `
        <button class="${classes.join(" ")}" data-rack-tile-id="${tile.id}" type="button" aria-label="${escapeHtml(tile.color)} ${escapeHtml(tile.shape)}">
          ${renderTile(tile)}
          ${exchangeMode && exchangeSet.has(tile.id) ? '<span class="rack-marker">EX</span>' : ""}
        </button>
      `;
    })
    .join("");
}

export function renderBoardGrid(
  container,
  {
    boardMap,
    tentativePlacements,
    interactive,
  }
) {
  const tentativeMap = new Map();
  for (const placement of tentativePlacements || []) {
    tentativeMap.set(coordinateKey(placement.x, placement.y), placement.tile);
  }

  const bounds = calculateBounds(boardMap, tentativePlacements || []);
  const cells = buildBoardMatrix(bounds);
  const width = bounds.maxX - bounds.minX + 1;

  container.style.gridTemplateColumns = `repeat(${width}, var(--cell))`;
  container.innerHTML = cells
    .map((cell) => {
      const permanentTile = boardMap?.[cell.key] || null;
      const tentativeTile = tentativeMap.get(cell.key) || null;
      const tile = tentativeTile || permanentTile;
      const classes = ["board-cell"];
      if (!tile && interactive) {
        classes.push("clickable");
      }

      const tileMarkup = tile
        ? renderTile(tile, { tentative: Boolean(tentativeTile) })
        : `<span class="coord-label">${cell.x},${cell.y}</span>`;

      return `
        <button
          type="button"
          class="${classes.join(" ")}"
          data-board-x="${cell.x}"
          data-board-y="${cell.y}"
          ${!interactive && !tentativeTile ? "disabled" : ""}
        >
          ${tileMarkup}
        </button>
      `;
    })
    .join("");
}

export function buildResultSummary(playersByUid, standings, winnerUids) {
  if (!standings?.length) {
    return {
      winnerLine: "No standings available.",
      rows: [],
    };
  }

  const winnerNames = (winnerUids || [])
    .map((uid) => playersByUid?.[uid]?.name || uid)
    .filter(Boolean);

  const winnerLine =
    winnerNames.length > 1
      ? `Tie winner: ${winnerNames.join(", ")}`
      : `Winner: ${winnerNames[0] || standings[0].name}`;

  return {
    winnerLine,
    rows: standings.map((entry) => `${entry.name}: ${entry.score}`),
  };
}
