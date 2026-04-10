import {
  attachPresence,
  bootstrapFirebase,
  detachPresence,
  ensureAuthReady,
  getAuthUser,
  subscribe,
  waitForAuthUser,
  write,
} from "./firebase.js";
import { commitMove, exchangeTiles, passTurn, skipOfflineTurn } from "./game.js";
import {
  joinLobby,
  createLobby,
  leaveLobby,
  startGame,
  setLobbyReady,
} from "./lobby.js";
import { evaluateLobbyStartReadiness } from "./lobby-readiness.js";
import {
  buildResultSummary,
  renderBoardGrid,
  renderLobbyPlayers,
  renderMoveHistory,
  renderRack,
  renderScoreboard,
  renderTileHtml,
} from "./renderer.js";
import {
  clearExchangeSelection,
  getState,
  patchState,
  resetTurnDraft,
  setExchangeMode,
  setSelectedRackTile,
  setTentativePlacements,
  toggleExchangeTile,
} from "./state.js";
import {
  clearSession,
  loadDisplayName,
  loadSession,
  saveDisplayName,
  saveSession,
} from "./storage.js";
import { createUi } from "./ui.js";
import {
  coordinateKey,
  sanitizeDisplayName,
  sanitizeJoinCode,
} from "./utils.js";
import {
  hasOpeningPlacementRequirement,
  OFFLINE_SKIP_GRACE_MS,
} from "./turn-guards.js";
import {
  createSandboxSnapshot,
  isSandboxSnapshot,
  sandboxAdvanceTurn,
  sandboxClearBoard,
  sandboxCommitMove,
  sandboxExchangeTiles,
  sandboxForceCurrentPlayer,
  sandboxInjectTile,
  sandboxPassTurn,
  sandboxRefillRack,
  sandboxRerollRack,
  sandboxResizePlayers,
  sandboxSimulateCurrentPlayer,
} from "./sandbox.js";
import { initTheme, applyTheme, THEMES } from "./themes.js";
import { initLayoutDetection, getLayoutMode } from "./layout-detect.js";

const ui = createUi();

let unsubscribeGame = null;
let activeCode = null;
let authUid = null;
let actionBusy = false;
let finishedRevisionShown = null;
let presenceCode = null;

// ─── Drag state ─────────────────────────────────────────────────────────────
let dragState = null;
let panState = null;
let suppressBoardClickUntil = 0;
let suppressRackClickUntil = 0;
let boardZoom = 1;
let pinchState = null;
const activeTouchPointers = new Map();

const MIN_BOARD_ZOOM = 0.10;
const MAX_BOARD_ZOOM = 1.8;
const ZOOM_STEP = 0.1;
const DEV_QUERY_ENABLED =
  new URLSearchParams(window.location.search).get("dev") === "1";
const DEV_HOST_ENABLED = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
const DEV_MODE = DEV_QUERY_ENABLED || DEV_HOST_ENABLED;
const DEV_TOOLS_STORAGE_KEY = "qwirkle.devToolsEnabled";

let boardKeyboardFocus = { x: 0, y: 0 };
let devToolsEnabled = DEV_MODE;
let sandboxStrictValidation = true;
let sidebarVisible = true;

// ─── Busy ────────────────────────────────────────────────────────────────────

function setBusy(value) {
  actionBusy = Boolean(value);
  updateActionButtonState();
}

// ─── Error messages ──────────────────────────────────────────────────────────

function toCode(error) {
  return String(error?.code || "").toLowerCase();
}

function toUiErrorMessage(error) {
  const code = toCode(error);
  if (code === "game-not-found")      return "Spiel nicht gefunden. Bitte prüfe den Beitrittscode.";
  if (code === "auth-not-ready")      return "Authentifizierung läuft noch. Kurz warten und erneut versuchen.";
  if (code === "permission-denied")   return "Zugriff verweigert. Prüfe Authentifizierung und Datenbankregeln.";
  if (code === "invalid-lobby-data")  return "Lobby-Daten ungültig. Bitte den Host, ein neues Spiel zu erstellen.";
  if (code === "network-error")       return "Netzwerkfehler. Bitte erneut versuchen.";
  if (code === "firebase-error")      return "Firebase-Fehler. Prüfe die Konsole.";
  if (code === "invalid-join-code")   return "Bitte einen gültigen Beitrittscode eingeben.";
  if (code === "game-already-started") return "Dieses Spiel wurde bereits gestartet.";
  if (code === "game-finished")       return "Dieses Spiel ist bereits beendet.";
  if (code === "lobby-full")          return "Die Lobby ist voll (max. 4 Spieler).";
  return error?.message || "Unerwarteter Fehler.";
}

async function ensureActionAuthUid() {
  if (authUid) return authUid;
  const user = await ensureAuthReady();
  authUid = user?.uid || null;
  if (!authUid) {
    const error = new Error("Authentifizierung wird noch initialisiert.");
    error.code = "auth-not-ready";
    throw error;
  }
  return authUid;
}

// ─── State helpers ───────────────────────────────────────────────────────────

function currentSnapshot() {
  return getState().gameSnapshot;
}

function inSandboxMode(snapshot = currentSnapshot()) {
  return isSandboxSnapshot(snapshot);
}

function myRack() {
  return currentSnapshot()?.game?.racks?.[authUid] || [];
}

function myTurn() {
  const snapshot = currentSnapshot();
  return snapshot?.meta?.status === "in_progress" && snapshot?.game?.currentPlayerUid === authUid;
}

// ─── Messages ────────────────────────────────────────────────────────────────

function setLandingMessage(text, tone = "") {
  ui.setMessage(ui.elements.landingMessage, text, tone);
}

function setLobbyMessage(text, tone = "") {
  ui.setMessage(ui.elements.lobbyMessage, text, tone);
}

function setGameMessage(text, tone = "") {
  ui.setMessage(ui.elements.gameMessage, text, tone);
}

function clearMessages() {
  setLandingMessage("");
  setLobbyMessage("");
  setGameMessage("");
}

async function handleDevEnterGame() {
  if (!devToolsEnabled) return;
  clearMessages();
  ui.hideResultDialog();
  dropGameSubscription();
  clearSession();
  resetTurnDraft();

  if (!authUid) {
    authUid = getAuthUser()?.uid || "dev-local-user";
  }

  const displayName = sanitizeDisplayName(ui.elements.displayNameInput.value) || "Du (Sandbox)";
  const selectedPlayers = Number(ui.elements.sandboxPlayerCount?.value || 3);
  const snapshot = createSandboxSnapshot({
    testerUid: authUid,
    testerName: `${displayName} (Sandbox)`,
    playerCount: selectedPlayers,
  });
  sandboxStrictValidation = true;
  if (ui.elements.sandboxStrictToggle) {
    ui.elements.sandboxStrictToggle.checked = true;
  }
  if (ui.elements.sandboxPlayersSelect) {
    ui.elements.sandboxPlayersSelect.value = String(selectedPlayers);
  }
  patchState({
    activeCode: null,
    gameSnapshot: snapshot,
    boardHasCentered: false,
  });
  ui.setConnectionState("Sandbox lokal", "neutral");
  renderBySnapshot(snapshot);
  setGameMessage("Sandbox aktiv: lokale Testpartie ohne Firebase. Nutze die Sandbox-Steuerung für schnelle Szenarien.");
}

// ─── Screen navigation ───────────────────────────────────────────────────────

function openLanding(message = "", tone = "") {
  patchState({ gameSnapshot: null, activeCode: null, boardHasCentered: false });
  resetTurnDraft();
  finishedRevisionShown = null;
  ui.hideResultDialog();
  ui.showScreen("landing-screen");
  applySandboxUiVisibility(null);
  if (message) setLandingMessage(message, tone);
}

function dropGameSubscription() {
  if (unsubscribeGame) {
    unsubscribeGame();
    unsubscribeGame = null;
  }
  detachPresence();
  presenceCode = null;
  activeCode = null;
}

function centerBoardIfNeeded() {
  const state = getState();
  if (state.boardHasCentered) return;
  centerBoardNow();
  patchState({ boardHasCentered: true });
}

function centerBoardNow() {
  const scroller = ui.elements.boardScroll;
  if (!scroller) return;
  scroller.scrollLeft = (scroller.scrollWidth - scroller.clientWidth) / 2;
  scroller.scrollTop  = (scroller.scrollHeight - scroller.clientHeight) / 2;
}

function getBoardBaseSizes() {
  const compact = window.matchMedia("(max-width: 600px)").matches;
  return compact
    ? { cell: 46, tile: 38 }
    : { cell: 54, tile: 46 };
}

function updateZoomUi() {
  if (ui.elements.zoomLevelLabel) {
    ui.elements.zoomLevelLabel.textContent = `${Math.round(boardZoom * 100)}%`;
  }
  if (ui.elements.zoomOutBtn) {
    ui.elements.zoomOutBtn.disabled = boardZoom <= MIN_BOARD_ZOOM + 0.001;
  }
  if (ui.elements.zoomInBtn) {
    ui.elements.zoomInBtn.disabled = boardZoom >= MAX_BOARD_ZOOM - 0.001;
  }
}

function applyBoardZoom(nextZoom, pivotClientX = null, pivotClientY = null) {
  const grid = ui.elements.boardGrid;
  const scroller = ui.elements.boardScroll;
  if (!grid || !scroller) return;

  const clamped = Math.min(MAX_BOARD_ZOOM, Math.max(MIN_BOARD_ZOOM, nextZoom));
  const prev = boardZoom;
  if (Math.abs(clamped - prev) < 0.0001) return;

  const rect = scroller.getBoundingClientRect();
  const pivotX = pivotClientX == null ? rect.width / 2 : (pivotClientX - rect.left);
  const pivotY = pivotClientY == null ? rect.height / 2 : (pivotClientY - rect.top);
  const oldLeft = scroller.scrollLeft;
  const oldTop = scroller.scrollTop;
  const ratio = clamped / prev;

  boardZoom = clamped;
  const sizes = getBoardBaseSizes();
  grid.style.setProperty("--cell", `${sizes.cell * boardZoom}px`);
  grid.style.setProperty("--tile-size", `${sizes.tile * boardZoom}px`);

  scroller.scrollLeft = (oldLeft + pivotX) * ratio - pivotX;
  scroller.scrollTop = (oldTop + pivotY) * ratio - pivotY;
  updateZoomUi();
}

function refreshBoardZoomStyles() {
  const grid = ui.elements.boardGrid;
  if (!grid) return;
  const sizes = getBoardBaseSizes();
  grid.style.setProperty("--cell", `${sizes.cell * boardZoom}px`);
  grid.style.setProperty("--tile-size", `${sizes.tile * boardZoom}px`);
  updateZoomUi();
}

function applyDevUiVisibility() {
  const devEntry = ui.elements.devEnterGameBtn;
  const devDelete = ui.elements.devDeleteGameBtn;
  const devToggle = ui.elements.devToolsToggleBtn;
  const sandboxEntryTools = ui.elements.sandboxEntryTools;

  if (devEntry) {
    devEntry.classList.toggle("hidden", !devToolsEnabled);
  }
  if (devDelete) {
    devDelete.classList.toggle("hidden", !devToolsEnabled);
  }
  if (devToggle) {
    devToggle.textContent = devToolsEnabled ? "Dev-Tools deaktivieren" : "Dev-Tools aktivieren";
    devToggle.setAttribute("aria-pressed", String(devToolsEnabled));
    devToggle.classList.toggle("active", devToolsEnabled);
  }
  if (sandboxEntryTools) {
    sandboxEntryTools.classList.toggle("hidden", !devToolsEnabled);
  }
}

function applySandboxUiVisibility(snapshot = currentSnapshot()) {
  const active = inSandboxMode(snapshot);
  if (ui.elements.sandboxPanel) {
    ui.elements.sandboxPanel.classList.toggle("hidden", !active);
  }
  if (ui.elements.sandboxModeBadge) {
    ui.elements.sandboxModeBadge.classList.toggle("hidden", !active);
  }
  if (ui.elements.sandboxStrictToggle) {
    ui.elements.sandboxStrictToggle.checked = sandboxStrictValidation;
  }

  if (ui.elements.sandboxPlayersSelect && snapshot?.game?.turnOrder?.length) {
    ui.elements.sandboxPlayersSelect.value = String(snapshot.game.turnOrder.length);
  }
}

function loadDevToolsPreference() {
  try {
    const stored = localStorage.getItem(DEV_TOOLS_STORAGE_KEY);
    if (stored === "true") return true;
    if (stored === "false") return false;
  } catch (_err) {
    // ignore storage errors
  }
  return DEV_MODE;
}

function setDevToolsEnabled(enabled) {
  devToolsEnabled = Boolean(enabled);
  try {
    localStorage.setItem(DEV_TOOLS_STORAGE_KEY, String(devToolsEnabled));
  } catch (_err) {
    // ignore storage errors
  }
  applyDevUiVisibility();
  updateActionButtonState();
}

// ─── Sidebar toggle ──────────────────────────────────────────────────────────

function toggleSidebar() {
  sidebarVisible = !sidebarVisible;
  applySidebarState();
}

function applySidebarState() {
  const sidebar = ui.elements.scoresSidebar;
  const btn = ui.elements.sidebarToggleBtn;
  if (sidebar) {
    sidebar.classList.toggle("collapsed", !sidebarVisible);
  }
  if (btn) {
    btn.classList.toggle("active", sidebarVisible);
    btn.setAttribute("aria-expanded", String(sidebarVisible));
  }
}

// ─── Theme switcher ──────────────────────────────────────────────────────────

function renderThemeSwitcher() {
  const container = ui.elements.themeSwitcher;
  if (!container) return;
  const currentTheme = document.documentElement.getAttribute("data-theme") || "light";
  container.innerHTML = THEMES.map((t) => {
    const active = t.id === currentTheme ? " active" : "";
    return `<button class="theme-btn${active}" data-theme-id="${t.id}" type="button" title="${t.label}" aria-label="Thema: ${t.label}">${t.icon}</button>`;
  }).join("");
}

function handleThemeSwitcherClick(e) {
  const btn = e.target.closest("[data-theme-id]");
  if (!btn) return;
  const id = btn.dataset.themeId;
  applyTheme(id);
  renderThemeSwitcher();
}

function getBoardCellElement(x, y) {
  return ui.elements.boardGrid?.querySelector(
    `[data-board-x="${x}"][data-board-y="${y}"]`
  ) || null;
}

function setBoardKeyboardFocusCell(cell, focusDom = false) {
  if (!cell) return;

  const x = Number(cell.dataset.boardX);
  const y = Number(cell.dataset.boardY);
  boardKeyboardFocus = { x, y };

  const cells = ui.elements.boardGrid?.querySelectorAll("[data-board-x][data-board-y]") || [];
  cells.forEach((entry) => {
    entry.tabIndex = -1;
    entry.classList.remove("keyboard-focus");
  });

  cell.tabIndex = 0;
  cell.classList.add("keyboard-focus");
  if (focusDom) {
    cell.focus({ preventScroll: true });
  }
}

function syncBoardKeyboardFocus(focusDom = false) {
  const preferred = getBoardCellElement(boardKeyboardFocus.x, boardKeyboardFocus.y);
  if (preferred) {
    setBoardKeyboardFocusCell(preferred, focusDom);
    return;
  }
  const center = getBoardCellElement(0, 0);
  if (center) {
    setBoardKeyboardFocusCell(center, focusDom);
    return;
  }
  const first = ui.elements.boardGrid?.querySelector("[data-board-x][data-board-y]");
  if (first) {
    setBoardKeyboardFocusCell(first, focusDom);
  }
}

function moveBoardKeyboardFocus(dx, dy) {
  const current = getBoardCellElement(boardKeyboardFocus.x, boardKeyboardFocus.y);
  const origin = current || ui.elements.boardGrid?.querySelector("[data-board-x][data-board-y]");
  if (!origin) return;
  const currentX = Number(origin.dataset.boardX);
  const currentY = Number(origin.dataset.boardY);
  const next = getBoardCellElement(currentX + dx, currentY + dy);
  if (next) {
    setBoardKeyboardFocusCell(next, true);
  }
}

// ─── Action button state ─────────────────────────────────────────────────────

function updateActionButtonState() {
  const snapshot = currentSnapshot();
  const sandbox = inSandboxMode(snapshot);
  const state = getState();
  const inProgress       = snapshot?.meta?.status === "in_progress";
  const isMyTurn         = myTurn();
  const openingRequiredForMe = sandbox
    ? false
    : hasOpeningPlacementRequirement(snapshot?.game, authUid);
  const hasTentative     = state.tentativePlacements.length > 0;
  const hasExchangeSel   = state.exchangeSelection.size > 0;
  const gamePlayers = snapshot?.players || {};
  const currentPlayerUid = snapshot?.game?.currentPlayerUid || null;
  const currentPlayer = currentPlayerUid ? gamePlayers[currentPlayerUid] : null;
  const isHost = snapshot?.meta?.hostUid === authUid;
  const canSkipOffline =
    inProgress &&
    isHost &&
    !isMyTurn &&
    Boolean(currentPlayer) &&
    currentPlayer.connected === false &&
    (Date.now() - Number(currentPlayer.lastSeenAt || 0) >= OFFLINE_SKIP_GRACE_MS);

  ui.elements.commitMoveBtn.disabled =
    actionBusy || !inProgress || !isMyTurn || state.exchangeMode || !hasTentative;
  ui.elements.undoPlacementBtn.disabled =
    actionBusy || !inProgress || !isMyTurn || state.exchangeMode || !hasTentative;
  ui.elements.cancelTurnBtn.disabled =
    actionBusy || !inProgress || !isMyTurn ||
    (!hasTentative && !state.exchangeSelection.size && !state.selectedRackTileId);
  ui.elements.exchangeModeBtn.disabled =
    actionBusy || !inProgress || !isMyTurn || hasTentative || (!sandbox && openingRequiredForMe);
  ui.elements.exchangeSelectedBtn.disabled =
    actionBusy || !inProgress || !isMyTurn || !state.exchangeMode || !hasExchangeSel || (!sandbox && openingRequiredForMe);
  ui.elements.passTurnBtn.disabled =
    actionBusy || !inProgress || !isMyTurn || hasTentative;
  ui.elements.skipOfflineBtn.classList.toggle("hidden", sandbox || !inProgress || !isHost);
  ui.elements.skipOfflineBtn.disabled = sandbox || actionBusy || !canSkipOffline;
  ui.elements.skipOfflineBtn.title = sandbox
    ? "In Sandbox nicht erforderlich"
    : canSkipOffline
      ? "Offline-Spielerzug überspringen"
      : "Nur der Host kann einen offline Spieler nach 20 Sekunden überspringen";

  if (ui.elements.devDeleteGameBtn) {
    ui.elements.devDeleteGameBtn.classList.toggle("hidden", !devToolsEnabled || sandbox);
    ui.elements.devDeleteGameBtn.disabled = actionBusy || sandbox || !activeCode;
  }

  // Visual feedback: exchange mode toggle
  const exchangeBtn = ui.elements.exchangeModeBtn;
  if (state.exchangeMode) {
    exchangeBtn.classList.add("btn-confirm");
    exchangeBtn.title = "Tauschmodus deaktivieren";
  } else {
    exchangeBtn.classList.remove("btn-confirm");
    exchangeBtn.title = openingRequiredForMe
      ? "Während des verpflichtenden Eröffnungszugs ist Tauschen deaktiviert"
      : "Tauschmodus aktivieren";
  }

  // Status badge
  const badge = ui.elements.gameStatus;
  if (!inProgress) {
    badge.textContent = snapshot?.meta?.status === "finished" ? "Beendet" : "–";
    badge.classList.remove("hidden");
    badge.classList.remove("my-turn");
  } else {
    badge.textContent = "";
    badge.classList.add("hidden");
    badge.classList.remove("my-turn");
  }

  if (ui.elements.sandboxNextTurnBtn) {
    ui.elements.sandboxNextTurnBtn.disabled = !sandbox || actionBusy || !inProgress;
  }
  if (ui.elements.sandboxForceMeBtn) {
    ui.elements.sandboxForceMeBtn.disabled = !sandbox || actionBusy || !inProgress;
  }
  if (ui.elements.sandboxSimulateTurnBtn) {
    ui.elements.sandboxSimulateTurnBtn.disabled = !sandbox || actionBusy || !inProgress;
  }
  if (ui.elements.sandboxRerollRackBtn) {
    ui.elements.sandboxRerollRackBtn.disabled = !sandbox || actionBusy || !inProgress;
  }
  if (ui.elements.sandboxRefillRackBtn) {
    ui.elements.sandboxRefillRackBtn.disabled = !sandbox || actionBusy || !inProgress;
  }
  if (ui.elements.sandboxInjectTileBtn) {
    ui.elements.sandboxInjectTileBtn.disabled = !sandbox || actionBusy || !inProgress;
  }
  if (ui.elements.sandboxClearBoardBtn) {
    ui.elements.sandboxClearBoardBtn.disabled = !sandbox || actionBusy || !inProgress;
  }
  if (ui.elements.sandboxResetBtn) {
    ui.elements.sandboxResetBtn.disabled = !sandbox || actionBusy;
  }
  if (ui.elements.sandboxApplyPlayersBtn) {
    ui.elements.sandboxApplyPlayersBtn.disabled = !sandbox || actionBusy || !inProgress;
  }
}

// ─── Render helpers ──────────────────────────────────────────────────────────

function refreshCurrentGameView() {
  const snapshot = currentSnapshot();
  if (!snapshot) { updateActionButtonState(); return; }
  if (snapshot.meta?.status === "lobby") { renderLobby(snapshot); return; }
  renderGame(snapshot);
}

function renderLobby(snapshot) {
  applySandboxUiVisibility(snapshot);
  const meta    = snapshot.meta || {};
  const players = snapshot.players || {};
  const readiness = evaluateLobbyStartReadiness(players);
  const count   = readiness.count;
  const me      = players[authUid];

  ui.elements.lobbyCode.textContent  = meta.joinCode || "-----";
  ui.elements.lobbyCount.textContent = `${count} / 4`;
  renderLobbyPlayers(ui.elements.lobbyPlayers, players, authUid);

  const isHost = meta.hostUid === authUid;
  const meReady = Boolean(me?.ready);
  const canStart = isHost && readiness.canStart && !actionBusy;

  ui.elements.startGameBtn.disabled = !canStart;
  ui.elements.startGameBtn.title    = isHost
    ? "Starten, wenn alle verbunden und bereit sind"
    : "Nur der Host kann das Spiel starten";

  ui.elements.readyToggleBtn.disabled = actionBusy;
  ui.elements.readyToggleBtn.textContent = meReady ? "Nicht bereit" : "Ich bin bereit";
  ui.elements.readyToggleBtn.classList.toggle("btn-primary", meReady);
  ui.elements.readyToggleBtn.classList.toggle("btn-secondary", !meReady);
  ui.elements.readyToggleBtn.title = meReady
    ? "Als nicht bereit markieren"
    : "Als bereit markieren";

  if (!me) {
    openLanding("Du bist nicht mehr in dieser Lobby.", "error");
    return;
  }

  ui.showScreen("lobby-screen");
  if (!readiness.allConnected) {
    setLobbyMessage(`Verbunden: ${readiness.connectedCount}/${readiness.count}. Warte auf Rückkehr aller Spieler.`);
    return;
  }

  if (!readiness.allReady) {
    setLobbyMessage(`Bereit: ${readiness.readyCount}/${readiness.count}.`);
    return;
  }

  setLobbyMessage(isHost ? "Alle sind bereit. Du kannst starten." : "Alle sind bereit. Warte auf den Host.");
}

function clearDraftIfOutdated(snapshot) {
  const rack    = snapshot?.game?.racks?.[authUid] || [];
  const rackIds = new Set(rack.map((t) => t.id));
  const state   = getState();
  const valid   = state.tentativePlacements.every((p) => rackIds.has(p.tile.id));
  if (!valid || !myTurn()) resetTurnDraft();
}

function renderGame(snapshot) {
  const meta    = snapshot.meta || {};
  const game    = snapshot.game || {};
  const players = snapshot.players || {};
  const rack    = game.racks?.[authUid] || [];
  const isMyTurn = myTurn();
  const sandbox = inSandboxMode(snapshot);

  clearDraftIfOutdated(snapshot);
  const state = getState();

  ui.elements.gameCode.textContent = meta.joinCode || "-----";
  ui.elements.bagCount.textContent = sandbox ? "∞" : String((game.bag || []).length);
  ui.elements.turnIndicator.textContent =
    players?.[game.currentPlayerUid]?.name || "–";

  renderScoreboard(
    ui.elements.scoreboard,
    players,
    game.scores || {},
    game.currentPlayerUid,
    authUid,
    game.turnOrder || []
  );
  renderMoveHistory(ui.elements.moveHistoryList, players, game.moveHistory || {});

  refreshBoardZoomStyles();
  renderBoardGrid(ui.elements.boardGrid, {
    boardMap:            game.board || {},
    tentativePlacements: state.tentativePlacements,
    interactive:         isMyTurn,
  });
  syncBoardKeyboardFocus();

  renderRack(
    ui.elements.rack,
    rack,
    state.selectedRackTileId,
    state.exchangeSelection,
    state.exchangeMode
  );
  applySandboxUiVisibility(snapshot);

  if (meta.status === "in_progress") {
    if (sandbox) {
      setGameMessage(
        isMyTurn
          ? "Sandbox: Dein Zug. Bestätigen, passen oder Sandbox-Aktionen nutzen."
          : `Sandbox: ${players?.[game.currentPlayerUid]?.name || "Bot"} ist dran. Nutze „Gegner simulieren“ oder „Nächster Zug“.`
      );
    } else {
      const currentPlayer = players?.[game.currentPlayerUid];
      const currentOffline = currentPlayer && currentPlayer.connected === false;
      if (currentOffline) {
        const canSkip = meta.hostUid === authUid && !isMyTurn;
        setGameMessage(
          canSkip
            ? `${currentPlayer.name} ist offline. Du kannst den Zug nach 20 Sekunden überspringen.`
            : `${currentPlayer.name} ist offline. Warte auf Rückkehr oder auf den Host.`,
          "error"
        );
      } else {
        setGameMessage(
          isMyTurn
            ? "Du bist dran: Steine legen, tauschen oder passen."
            : "Warte auf den anderen Spieler…"
        );
      }
    }
  }

  ui.showScreen("game-screen");
  updateActionButtonState();

  if (meta.status === "finished") {
    if (finishedRevisionShown !== meta.revision) {
      finishedRevisionShown = meta.revision;
      const summary = buildResultSummary(
        players,
        game.finalStandings || [],
        game.winnerUids || []
      );
      ui.showResultDialog(summary, () => {
        clearSession();
        dropGameSubscription();
        openLanding("Spiel beendet. Du kannst jederzeit eine neue Runde starten.", "success");
      });
    }
  } else {
    finishedRevisionShown = null;
    ui.hideResultDialog();
  }

  requestAnimationFrame(centerBoardIfNeeded);
}

function renderBySnapshot(snapshot) {
  if (!snapshot) { openLanding(); return; }
  applySandboxUiVisibility(snapshot);
  const me = snapshot.players?.[authUid];
  if (!me) {
    clearSession();
    dropGameSubscription();
    openLanding("Du bist kein Teilnehmer dieses Spiels mehr.", "error");
    return;
  }
  if (snapshot.meta?.status === "lobby") { renderLobby(snapshot); return; }
  renderGame(snapshot);
}

// ─── Firebase subscription ───────────────────────────────────────────────────

function bindGameSubscription(code) {
  const normalized = sanitizeJoinCode(code);
  if (!normalized) throw new Error("Ungültiger Spielcode.");

  dropGameSubscription();
  activeCode = normalized;
  saveSession(normalized);
  patchState({ boardHasCentered: false });

  unsubscribeGame = subscribe(
    `games/${normalized}`,
    async (snapshot) => {
      if (activeCode !== normalized) return;

      const value = snapshot.val();
      if (!value) {
        clearSession();
        dropGameSubscription();
        openLanding("Spiel nicht gefunden oder bereits gelöscht.", "error");
        return;
      }

      patchState({ activeCode: normalized, gameSnapshot: value });

      if (presenceCode !== normalized) {
        try {
          await attachPresence(normalized, authUid);
          presenceCode = normalized;
        } catch (_err) {
          setGameMessage("Präsenz-Sync fehlgeschlagen. Live-Updates können verzögert sein.", "error");
        }
      }

      if (activeCode !== normalized) return;

      ui.setConnectionState("Verbunden", "good");
      renderBySnapshot(value);
    },
    () => {
      ui.setConnectionState("Verbindungsproblem", "bad");
      setGameMessage("Live-Verbindung unterbrochen. Versuche erneut…");
    }
  );
}

// ─── Lobby actions ───────────────────────────────────────────────────────────

async function handleCreateLobby() {
  const name = sanitizeDisplayName(ui.elements.displayNameInput.value);
  saveDisplayName(name);
  try {
    setBusy(true);
    clearMessages();
    const uid     = await ensureActionAuthUid();
    const created = await createLobby(uid, name);
    bindGameSubscription(created.code);
    setLobbyMessage("Lobby erstellt. Teile den Beitrittscode.", "success");
  } catch (error) {
    setLandingMessage(toUiErrorMessage(error), "error");
  } finally {
    setBusy(false);
  }
}

async function handleJoinLobby() {
  const name = sanitizeDisplayName(ui.elements.displayNameInput.value);
  const code = String(ui.elements.joinCodeInput.value || "");
  saveDisplayName(name);
  try {
    setBusy(true);
    clearMessages();
    const uid    = await ensureActionAuthUid();
    const joined = await joinLobby(code, uid, name);
    bindGameSubscription(joined.code);
    setLobbyMessage("Lobby beigetreten.", "success");
  } catch (error) {
    setLandingMessage(toUiErrorMessage(error), "error");
  } finally {
    setBusy(false);
  }
}

async function handleLeaveLobby() {
  if (!activeCode) return;
  let left = false;
  try {
    setBusy(true);
    await leaveLobby(activeCode, authUid);
    left = true;
  } catch (error) {
    setLobbyMessage(error.message, "error");
  } finally {
    setBusy(false);
    if (left) {
      clearSession();
      dropGameSubscription();
      openLanding("Du hast die Lobby verlassen.");
    }
  }
}

async function handleStartGame() {
  if (!activeCode) return;
  try {
    setBusy(true);
    await startGame(activeCode, authUid);
    setLobbyMessage("Spiel wird gestartet…", "success");
  } catch (error) {
    setLobbyMessage(error.message, "error");
  } finally {
    setBusy(false);
  }
}

async function handleToggleReady() {
  if (!activeCode) return;
  const snapshot = currentSnapshot();
  const me = snapshot?.players?.[authUid];
  if (!me) return;

  try {
    setBusy(true);
    await setLobbyReady(activeCode, authUid, !me.ready);
  } catch (error) {
    setLobbyMessage(error.message || "Bereitschaft konnte nicht aktualisiert werden.", "error");
  } finally {
    setBusy(false);
  }
}

// ─── Tile placement helpers ───────────────────────────────────────────────────

function findTentativeByCell(x, y) {
  return getState().tentativePlacements.findIndex((p) => p.x === x && p.y === y);
}

function rackTileAlreadyPlaced(tileId) {
  return getState().tentativePlacements.some((p) => p.tile.id === tileId);
}

// Shared placement logic used by both click and drag-drop
function placeTileOnBoard(x, y, tileId, tile) {
  const snapshot = currentSnapshot();
  const key = coordinateKey(x, y);
  if (snapshot?.game?.board?.[key]) return; // permanent tile

  const existingIndex = findTentativeByCell(x, y);
  if (existingIndex >= 0) {
    // Cell already has a tentative tile — ignore (don't replace)
    return;
  }

  if (rackTileAlreadyPlaced(tileId)) {
    setGameMessage("Dieses Teil wurde in diesem Zug bereits platziert.", "error");
    return;
  }

  const state = getState();
  setTentativePlacements([...state.tentativePlacements, { x, y, tile }]);
  setSelectedRackTile(null);
  refreshCurrentGameView();
}

// ─── Click handlers ──────────────────────────────────────────────────────────

function handleRackClick(event) {
  if (performance.now() < suppressRackClickUntil) return;
  const target = event.target.closest("[data-rack-tile-id]");
  if (!target || !myTurn()) return;

  const tileId = target.dataset.rackTileId;
  const state  = getState();

  if (state.exchangeMode) {
    toggleExchangeTile(tileId);
    setSelectedRackTile(null);
    refreshCurrentGameView();
    return;
  }

  // If this tile is already tentatively placed, remove it
  const placementIndex = state.tentativePlacements.findIndex((p) => p.tile.id === tileId);
  if (placementIndex >= 0) {
    const next = [...state.tentativePlacements];
    next.splice(placementIndex, 1);
    setTentativePlacements(next);
    setSelectedRackTile(null);
    refreshCurrentGameView();
    return;
  }

  // Toggle selection
  if (state.selectedRackTileId === tileId) {
    setSelectedRackTile(null);
  } else {
    setSelectedRackTile(tileId);
  }
  refreshCurrentGameView();
}

function handleBoardClick(event) {
  if (performance.now() < suppressBoardClickUntil) return;
  const button = event.target.closest("[data-board-x][data-board-y]");
  if (!button || !myTurn()) return;

  const x   = Number(button.dataset.boardX);
  const y   = Number(button.dataset.boardY);
  const key = coordinateKey(x, y);

  const snapshot = currentSnapshot();
  if (snapshot?.game?.board?.[key]) return; // permanent tile — ignore

  const state = getState();

  // Click on a tentative cell → remove it
  const existingIndex = findTentativeByCell(x, y);
  if (existingIndex >= 0) {
    const next = [...state.tentativePlacements];
    next.splice(existingIndex, 1);
    setTentativePlacements(next);
    refreshCurrentGameView();
    return;
  }

  if (state.exchangeMode) {
    setGameMessage("Deaktiviere zuerst den Tauschmodus, um Steine zu platzieren.", "error");
    return;
  }

  const selectedTileId = state.selectedRackTileId;
  if (!selectedTileId) {
    setGameMessage("Wähle zuerst einen Stein aus deinem Ständer.", "error");
    return;
  }

  const tile = myRack().find((t) => t.id === selectedTileId);
  if (!tile) {
    setGameMessage("Das ausgewählte Teil ist nicht mehr verfügbar.", "error");
    setSelectedRackTile(null);
    return;
  }

  placeTileOnBoard(x, y, selectedTileId, tile);
}

function handleBoardFocusFromPointer(event) {
  const button = event.target.closest("[data-board-x][data-board-y]");
  if (!button) return;
  setBoardKeyboardFocusCell(button, false);
}

function handleBoardKeydown(event) {
  const target = event.target.closest("[data-board-x][data-board-y]");
  if (!target) return;

  if (event.key === "ArrowUp") {
    event.preventDefault();
    moveBoardKeyboardFocus(0, -1);
    return;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveBoardKeyboardFocus(0, 1);
    return;
  }
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    moveBoardKeyboardFocus(-1, 0);
    return;
  }
  if (event.key === "ArrowRight") {
    event.preventDefault();
    moveBoardKeyboardFocus(1, 0);
    return;
  }
  if (event.key === "Home") {
    event.preventDefault();
    const center = getBoardCellElement(0, 0);
    if (center) {
      setBoardKeyboardFocusCell(center, true);
    }
    return;
  }
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    target.click();
  }
}

// ─── Drag & Drop ─────────────────────────────────────────────────────────────

function getGhostEl() {
  return document.getElementById("drag-ghost");
}

function setBoardDragActive(active) {
  const scroller = ui.elements.boardScroll;
  if (!scroller) return;
  scroller.classList.toggle("drag-active", Boolean(active));
}

function clearDropHighlight() {
  if (dragState?.currentDropTarget) {
    dragState.currentDropTarget.classList.remove("drag-over");
  }
}

// Minimum pixels of movement before we commit to a drag (preserves click)
const DRAG_THRESHOLD = 6;

// Pending drag: set on pointerdown, promoted to real drag on threshold
let pendingDrag = null;

function initDragAndDrop() {
  const rack = ui.elements.rack;

  rack.addEventListener("pointerdown", (event) => {
    // Only primary button (left click / first touch)
    if (event.button !== 0 && event.pointerType === "mouse") return;
    if (!myTurn()) return;

    const target = event.target.closest("[data-rack-tile-id]");
    if (!target) return;

    const tileId = target.dataset.rackTileId;
    const state  = getState();

    if (state.exchangeMode) return;
    if (rackTileAlreadyPlaced(tileId)) return;

    const tile = myRack().find((t) => t.id === tileId);
    if (!tile) return;

    if (event.pointerType === "touch") {
      event.preventDefault();
    }

    // Record pending drag — don't preventDefault yet (preserves click)
    pendingDrag = {
      tileId,
      tile,
      sourceEl: target,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };

    document.addEventListener("pointermove", onPendingMove, { passive: true });
    document.addEventListener("pointerup",   onPendingCancel);
    document.addEventListener("pointercancel", onPendingCancel);
  });
}

function onPendingMove(event) {
  if (!pendingDrag) return;
  const dx = event.clientX - pendingDrag.startX;
  const dy = event.clientY - pendingDrag.startY;
  if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;

  // Threshold exceeded — commit to drag
  const { tileId, tile, sourceEl, pointerId } = pendingDrag;
  pendingDrag = null;

  document.removeEventListener("pointermove", onPendingMove);
  document.removeEventListener("pointerup",   onPendingCancel);
  document.removeEventListener("pointercancel", onPendingCancel);

  // Show ghost
  const ghost = getGhostEl();
  ghost.innerHTML = renderTileHtml(tile);
  ghost.style.display = "block";
  ghost.style.left = event.clientX + "px";
  ghost.style.top  = event.clientY + "px";

  dragState = {
    tileId,
    tile,
    sourceEl,
    currentDropTarget: null,
  };

  sourceEl.classList.add("dragging");
  setBoardDragActive(true);
  sourceEl.setPointerCapture(pointerId);

  document.addEventListener("pointermove", onDragMove, { passive: false });
  document.addEventListener("pointerup",   onDragEnd);
  document.addEventListener("pointercancel", onDragCancel);
}

function onPendingCancel() {
  pendingDrag = null;
  document.removeEventListener("pointermove", onPendingMove);
  document.removeEventListener("pointerup",   onPendingCancel);
  document.removeEventListener("pointercancel", onPendingCancel);
}

function onDragMove(event) {
  if (!dragState) return;
  event.preventDefault();

  const ghost = getGhostEl();
  ghost.style.left = event.clientX + "px";
  ghost.style.top  = event.clientY + "px";

  // Temporarily hide ghost to hit-test through it
  ghost.style.display = "none";
  const el = document.elementFromPoint(event.clientX, event.clientY);
  ghost.style.display = "block";

  const cell = el?.closest("[data-board-x][data-board-y]:not([disabled])");

  if (dragState.currentDropTarget && dragState.currentDropTarget !== cell) {
    dragState.currentDropTarget.classList.remove("drag-over");
  }
  if (cell) {
    cell.classList.add("drag-over");
    dragState.currentDropTarget = cell;
  } else {
    dragState.currentDropTarget = null;
  }
}

function onDragEnd() {
  if (!dragState) return;

  const { tileId, tile, sourceEl, currentDropTarget } = dragState;

  const ghost = getGhostEl();
  ghost.style.display = "none";
  ghost.innerHTML = "";

  if (currentDropTarget) currentDropTarget.classList.remove("drag-over");
  sourceEl.classList.remove("dragging");
  setBoardDragActive(false);

  document.removeEventListener("pointermove", onDragMove);
  document.removeEventListener("pointerup",   onDragEnd);
  document.removeEventListener("pointercancel", onDragCancel);

  const wasDropTarget = currentDropTarget;
  dragState = null;

  if (wasDropTarget) {
    const x = Number(wasDropTarget.dataset.boardX);
    const y = Number(wasDropTarget.dataset.boardY);
    placeTileOnBoard(x, y, tileId, tile);
  }

  suppressRackClickUntil = performance.now() + 220;
  suppressBoardClickUntil = performance.now() + 220;
}

function onDragCancel() {
  if (!dragState) return;
  const ghost = getGhostEl();
  ghost.style.display = "none";
  ghost.innerHTML = "";
  if (dragState.currentDropTarget) dragState.currentDropTarget.classList.remove("drag-over");
  dragState.sourceEl.classList.remove("dragging");
  setBoardDragActive(false);
  document.removeEventListener("pointermove", onDragMove);
  document.removeEventListener("pointerup",   onDragEnd);
  document.removeEventListener("pointercancel", onDragCancel);
  dragState = null;
  suppressRackClickUntil = performance.now() + 220;
  suppressBoardClickUntil = performance.now() + 220;
}

const PAN_THRESHOLD = 6;

function initBoardPanning() {
  const scroller = ui.elements.boardScroll;
  if (!scroller) return;

  scroller.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (dragState || pendingDrag) return;

    if (event.pointerType === "touch") {
      activeTouchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (activeTouchPointers.size === 2) {
        const points = [...activeTouchPointers.values()];
        const dist = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
        const midX = (points[0].x + points[1].x) / 2;
        const midY = (points[0].y + points[1].y) / 2;
        const grid = ui.elements.boardGrid;
        if (grid) {
          const gridRect = grid.getBoundingClientRect();
          grid.style.transformOrigin = `${midX - gridRect.left}px ${midY - gridRect.top}px`;
          grid.style.willChange = "transform";
        }
        scroller.classList.add("pinching");
        pinchState = {
          distance: dist,
          visualScale: 1,
          rafId: null,
          lastMid: { x: midX, y: midY },
        };
        panState = null;
        scroller.classList.remove("panning");
        return;
      }
      if (activeTouchPointers.size > 1) {
        return;
      }
    }

    panState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: scroller.scrollLeft,
      startTop: scroller.scrollTop,
      active: false,
      moved: false,
    };

    scroller.setPointerCapture(event.pointerId);
  });

  scroller.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch" && activeTouchPointers.has(event.pointerId)) {
      activeTouchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }

    if (pinchState && activeTouchPointers.size >= 2) {
      const points = [...activeTouchPointers.values()];
      const midX = (points[0].x + points[1].x) / 2;
      const midY = (points[0].y + points[1].y) / 2;
      const dist = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);

      if (pinchState.distance > 0 && dist > 0) {
        const scale = dist / pinchState.distance;
        pinchState.visualScale *= scale;
        pinchState.lastMid = { x: midX, y: midY };
      }
      pinchState.distance = dist;

      if (!pinchState.rafId) {
        pinchState.rafId = requestAnimationFrame(() => {
          const grid = ui.elements.boardGrid;
          if (grid && pinchState) {
            grid.style.transform = `scale(${pinchState.visualScale})`;
          }
          if (pinchState) pinchState.rafId = null;
        });
      }

      suppressBoardClickUntil = performance.now() + 260;
      event.preventDefault();
      return;
    }

    if (!panState || event.pointerId !== panState.pointerId) return;

    const dx = event.clientX - panState.startX;
    const dy = event.clientY - panState.startY;
    if (!panState.active && Math.hypot(dx, dy) < PAN_THRESHOLD) return;

    panState.active = true;
    panState.moved = true;
    scroller.classList.add("panning");
    scroller.scrollLeft = panState.startLeft - dx;
    scroller.scrollTop = panState.startTop - dy;
    event.preventDefault();
  }, { passive: false });

  function endPan(event) {
    if (event.pointerType === "touch") {
      activeTouchPointers.delete(event.pointerId);
      if (activeTouchPointers.size < 2 && pinchState) {
        const grid = ui.elements.boardGrid;
        if (pinchState.rafId) cancelAnimationFrame(pinchState.rafId);
        if (grid) {
          grid.style.transform = "";
          grid.style.transformOrigin = "";
          grid.style.willChange = "";
        }
        scroller.classList.remove("pinching");
        const finalZoom = boardZoom * pinchState.visualScale;
        const mid = pinchState.lastMid;
        pinchState = null;
        applyBoardZoom(finalZoom, mid.x, mid.y);
        suppressBoardClickUntil = performance.now() + 260;
        return;
      }
    }

    if (pinchState) {
      suppressBoardClickUntil = performance.now() + 260;
      return;
    }

    if (!panState || event.pointerId !== panState.pointerId) return;
    if (panState.moved) {
      suppressBoardClickUntil = performance.now() + 220;
    }
    scroller.classList.remove("panning");
    panState = null;
  }

  scroller.addEventListener("pointerup", endPan);
  scroller.addEventListener("pointercancel", endPan);

  scroller.addEventListener("wheel", (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    const factor = event.deltaY < 0 ? 1.08 : 1 / 1.08;
    applyBoardZoom(boardZoom * factor, event.clientX, event.clientY);
    event.preventDefault();
  }, { passive: false });
}

// ─── Game actions ─────────────────────────────────────────────────────────────

function undoLastPlacement() {
  const state = getState();
  if (!state.tentativePlacements.length) return;
  const next = [...state.tentativePlacements];
  next.pop();
  setTentativePlacements(next);
  refreshCurrentGameView();
}

function cancelTurnDraft() {
  resetTurnDraft();
  setGameMessage("Zugentwurf verworfen.");
  refreshCurrentGameView();
}

async function handleCommitMove() {
  if (!myTurn()) return;
  const draft = getState().tentativePlacements;
  if (!draft.length) {
    setGameMessage("Platziere mindestens einen Stein, bevor du bestätigst.", "error");
    return;
  }

  if (inSandboxMode()) {
    const result = sandboxCommitMove(currentSnapshot(), authUid, draft, {
      strictValidation: sandboxStrictValidation,
    });
    if (!result.ok) {
      setGameMessage(result.error || "Sandbox-Zug ungültig.", "error");
      return;
    }
    resetTurnDraft();
    patchState({ gameSnapshot: result.snapshot, boardHasCentered: false });
    renderBySnapshot(result.snapshot);
    setGameMessage(`Sandbox-Zug bestätigt (+${result.scoreGain}).`, "success");
    return;
  }

  try {
    setBusy(true);
    await commitMove(
      activeCode,
      authUid,
      draft.map((p) => ({ x: p.x, y: p.y, tileId: p.tile.id }))
    );
    resetTurnDraft();
    setGameMessage("Zug bestätigt!", "success");
  } catch (error) {
    setGameMessage(error.message, "error");
  } finally {
    setBusy(false);
  }
}

function toggleExchangeMode() {
  const state = getState();
  if (!inSandboxMode() && hasOpeningPlacementRequirement(currentSnapshot()?.game, authUid)) {
    setGameMessage("Lege zuerst den verpflichtenden Eröffnungszug. Tauschen ist bis dahin gesperrt.", "error");
    return;
  }
  if (state.tentativePlacements.length > 0) {
    setGameMessage("Bestätige oder verwerfe zuerst deinen Zug.", "error");
    return;
  }
  setExchangeMode(!state.exchangeMode);
  setSelectedRackTile(null);
  if (!getState().exchangeMode) clearExchangeSelection();
  refreshCurrentGameView();
}

async function handleExchangeSelected() {
  if (!myTurn()) return;
  if (inSandboxMode()) {
    const state = getState();
    if (!state.exchangeMode) {
      setGameMessage("Aktiviere zuerst den Tauschmodus.", "error");
      return;
    }
    const selected = [...state.exchangeSelection];
    if (!selected.length) {
      setGameMessage("Markiere mindestens einen Stein zum Tauschen.", "error");
      return;
    }
    const next = sandboxExchangeTiles(currentSnapshot(), authUid, selected);
    resetTurnDraft();
    patchState({ gameSnapshot: next, boardHasCentered: false });
    renderBySnapshot(next);
    setGameMessage("Sandbox: Steine wurden lokal getauscht.", "success");
    return;
  }

  if (hasOpeningPlacementRequirement(currentSnapshot()?.game, authUid)) {
    setGameMessage("Tauschen ist im verpflichtenden Eröffnungszug nicht erlaubt.", "error");
    return;
  }
  const state = getState();
  if (!state.exchangeMode) {
    setGameMessage("Aktiviere zuerst den Tauschmodus.", "error");
    return;
  }
  const selected = [...state.exchangeSelection];
  if (!selected.length) {
    setGameMessage("Markiere mindestens einen Stein zum Tauschen.", "error");
    return;
  }
  try {
    setBusy(true);
    await exchangeTiles(activeCode, authUid, selected);
    resetTurnDraft();
    setGameMessage("Steine wurden getauscht.", "success");
  } catch (error) {
    setGameMessage(error.message, "error");
  } finally {
    setBusy(false);
  }
}

async function handlePassTurn() {
  if (!myTurn()) return;
  if (getState().tentativePlacements.length > 0) {
    setGameMessage("Bestätige oder verwerfe zuerst deine Platzierungen.", "error");
    return;
  }

  if (inSandboxMode()) {
    const result = sandboxPassTurn(currentSnapshot(), authUid);
    if (!result.ok) {
      setGameMessage(result.error || "Sandbox-Zug konnte nicht gepasst werden.", "error");
      return;
    }
    resetTurnDraft();
    patchState({ gameSnapshot: result.snapshot, boardHasCentered: false });
    renderBySnapshot(result.snapshot);
    setGameMessage("Sandbox: Zug gepasst.", "success");
    return;
  }

  const confirmed = window.confirm("Zug wirklich passen?");
  if (!confirmed) return;
  try {
    setBusy(true);
    await passTurn(activeCode, authUid);
    resetTurnDraft();
    setGameMessage("Zug gepasst.", "success");
  } catch (error) {
    setGameMessage(error.message, "error");
  } finally {
    setBusy(false);
  }
}

async function handleSkipOffline() {
  if (!activeCode) return;
  try {
    setBusy(true);
    await skipOfflineTurn(activeCode, authUid);
    setGameMessage("Offline-Spieler wurde übersprungen.", "success");
  } catch (error) {
    setGameMessage(error.message || "Offline-Spieler konnte nicht übersprungen werden.", "error");
  } finally {
    setBusy(false);
  }
}

async function handleDevDeleteGame() {
  if (!devToolsEnabled) return;
  if (!activeCode) {
    setGameMessage("Kein aktives Spiel zum Löschen.", "error");
    return;
  }
  const code = activeCode;
  const confirmed = window.confirm(`Spiel ${code} wirklich aus Firebase löschen?`);
  if (!confirmed) return;
  try {
    setBusy(true);
    await ensureActionAuthUid();
    await write(`games/${code}`, null);
    clearSession();
    dropGameSubscription();
    openLanding(`Spiel ${code} gelöscht.`, "success");
  } catch (error) {
    setGameMessage(toUiErrorMessage(error), "error");
  } finally {
    setBusy(false);
  }
}

async function copyJoinCode() {
  const code = activeCode || currentSnapshot()?.meta?.joinCode;
  if (!code) return;
  try {
    const inviteUrl = `${window.location.origin}${window.location.pathname}?join=${encodeURIComponent(code)}`;
    await navigator.clipboard.writeText(inviteUrl);
    const btn = ui.elements.copyCodeBtn;
    btn.classList.add("copied");
    btn.textContent = "Kopiert!";
    setLobbyMessage("Einladungslink in die Zwischenablage kopiert.", "success");
    setTimeout(() => {
      btn.classList.remove("copied");
      btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Kopieren`;
    }, 2000);
  } catch (_err) {
    setLobbyMessage(`Kopieren fehlgeschlagen. Code: ${code}`, "error");
  }
}

function toggleRackHelp() {
  const btn  = ui.elements.rackHelpToggleBtn;
  const text = ui.elements.rackHelpText;
  if (!btn || !text) return;
  const expanded = btn.getAttribute("aria-expanded") === "true";
  btn.setAttribute("aria-expanded", String(!expanded));
  btn.textContent = !expanded ? "×" : "?";
  text.classList.toggle("hidden", expanded);
}

function handleCenterBoard() {
  centerBoardNow();
}

function handleZoomIn() {
  applyBoardZoom(boardZoom + ZOOM_STEP);
}

function handleZoomOut() {
  applyBoardZoom(boardZoom - ZOOM_STEP);
}

function handleZoomReset() {
  applyBoardZoom(1);
}

function handleDevToolsToggle() {
  setDevToolsEnabled(!devToolsEnabled);
}

function commitSandboxSnapshot(nextSnapshot, message = "", tone = "") {
  resetTurnDraft();
  patchState({ gameSnapshot: nextSnapshot, boardHasCentered: false });
  renderBySnapshot(nextSnapshot);
  if (message) {
    setGameMessage(message, tone);
  }
}

function handleSandboxStrictToggle() {
  sandboxStrictValidation = Boolean(ui.elements.sandboxStrictToggle?.checked);
  setGameMessage(
    sandboxStrictValidation
      ? "Sandbox-Regeln: strikt (Qwirkle-Validierung aktiv)."
      : "Sandbox-Regeln: relaxed (frei platzieren für UI-/Board-Tests)."
  );
}

function handleSandboxApplyPlayers() {
  if (!inSandboxMode()) return;
  const count = Number(ui.elements.sandboxPlayersSelect?.value || 3);
  const next = sandboxResizePlayers(currentSnapshot(), count);
  commitSandboxSnapshot(next, `Sandbox-Spielerzahl auf ${count} gesetzt.`, "success");
}

function handleSandboxNextTurn() {
  if (!inSandboxMode()) return;
  const next = sandboxAdvanceTurn(currentSnapshot(), {
    byUid: authUid,
    reason: "dev_next_turn",
  });
  commitSandboxSnapshot(next, "Sandbox: zum nächsten Spieler gewechselt.", "success");
}

function handleSandboxForceMe() {
  if (!inSandboxMode()) return;
  const next = sandboxForceCurrentPlayer(currentSnapshot(), authUid, {
    byUid: authUid,
  });
  commitSandboxSnapshot(next, "Sandbox: aktiven Spieler auf dich gesetzt.", "success");
}

function handleSandboxSimulateTurn() {
  if (!inSandboxMode()) return;
  const result = sandboxSimulateCurrentPlayer(currentSnapshot(), {
    strictValidation: sandboxStrictValidation,
  });
  if (!result.ok) {
    setGameMessage(result.error || "Sandbox: Gegnerzug konnte nicht simuliert werden.", "error");
    return;
  }
  commitSandboxSnapshot(result.snapshot, result.summary || "Sandbox: Gegnerzug simuliert.", "success");
}

function handleSandboxRerollRack() {
  if (!inSandboxMode()) return;
  const next = sandboxRerollRack(currentSnapshot(), authUid);
  commitSandboxSnapshot(next, "Sandbox: Rack neu gemischt.", "success");
}

function handleSandboxRefillRack() {
  if (!inSandboxMode()) return;
  const next = sandboxRefillRack(currentSnapshot(), authUid);
  commitSandboxSnapshot(next, "Sandbox: Rack auf 6 ergänzt.", "success");
}

function handleSandboxInjectTile() {
  if (!inSandboxMode()) return;
  const color = ui.elements.sandboxInjectColor?.value || "red";
  const shape = ui.elements.sandboxInjectShape?.value || "circle";
  const next = sandboxInjectTile(currentSnapshot(), authUid, color, shape);
  commitSandboxSnapshot(next, "Sandbox: Tile hinzugefügt.", "success");
}

function handleSandboxClearBoard() {
  if (!inSandboxMode()) return;
  const next = sandboxClearBoard(currentSnapshot(), { byUid: authUid });
  commitSandboxSnapshot(next, "Sandbox: Spielfeld geleert.", "success");
}

function handleSandboxReset() {
  if (!inSandboxMode()) return;
  const count = Number(ui.elements.sandboxPlayersSelect?.value || 3);
  const displayName = sanitizeDisplayName(ui.elements.displayNameInput.value) || "Du (Sandbox)";
  const next = createSandboxSnapshot({
    testerUid: authUid,
    testerName: `${displayName} (Sandbox)`,
    playerCount: count,
  });
  sandboxStrictValidation = Boolean(ui.elements.sandboxStrictToggle?.checked);
  commitSandboxSnapshot(next, "Sandbox neu gestartet.", "success");
}

// ─── Event binding ───────────────────────────────────────────────────────────

function bindUiEvents() {
  ui.elements.displayNameInput.addEventListener("change", () => {
    const clean = sanitizeDisplayName(ui.elements.displayNameInput.value);
    ui.elements.displayNameInput.value = clean;
    saveDisplayName(clean);
  });

  ui.elements.joinCodeInput.addEventListener("input", () => {
    ui.elements.joinCodeInput.value = sanitizeJoinCode(ui.elements.joinCodeInput.value);
  });

  ui.elements.joinCodeInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleJoinLobby();
  });

  ui.elements.displayNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleCreateLobby();
  });

  ui.elements.createGameBtn.addEventListener("click", handleCreateLobby);
  ui.elements.devEnterGameBtn.addEventListener("click", handleDevEnterGame);
  ui.elements.joinGameBtn.addEventListener("click",   handleJoinLobby);

  ui.elements.copyCodeBtn.addEventListener("click",   copyJoinCode);
  ui.elements.leaveLobbyBtn.addEventListener("click", handleLeaveLobby);
  ui.elements.readyToggleBtn.addEventListener("click", handleToggleReady);
  ui.elements.startGameBtn.addEventListener("click",  handleStartGame);

  ui.elements.rack.addEventListener("click", handleRackClick);
  ui.elements.boardGrid.addEventListener("click", handleBoardClick);
  ui.elements.boardGrid.addEventListener("click", handleBoardFocusFromPointer);
  ui.elements.boardGrid.addEventListener("keydown", handleBoardKeydown);

  ui.elements.commitMoveBtn.addEventListener("click",      handleCommitMove);
  ui.elements.undoPlacementBtn.addEventListener("click",   undoLastPlacement);
  ui.elements.cancelTurnBtn.addEventListener("click",      cancelTurnDraft);
  ui.elements.exchangeModeBtn.addEventListener("click",    toggleExchangeMode);
  ui.elements.exchangeSelectedBtn.addEventListener("click", handleExchangeSelected);
  ui.elements.passTurnBtn.addEventListener("click",        handlePassTurn);
  ui.elements.skipOfflineBtn.addEventListener("click",     handleSkipOffline);
  ui.elements.devDeleteGameBtn.addEventListener("click",   handleDevDeleteGame);
  ui.elements.zoomOutBtn.addEventListener("click",         handleZoomOut);
  ui.elements.zoomInBtn.addEventListener("click",          handleZoomIn);
  ui.elements.zoomResetBtn.addEventListener("click",       handleZoomReset);
  ui.elements.centerBoardBtn.addEventListener("click",     handleCenterBoard);
  ui.elements.rackHelpToggleBtn.addEventListener("click",  toggleRackHelp);
  ui.elements.devToolsToggleBtn.addEventListener("click",  handleDevToolsToggle);
  ui.elements.sandboxStrictToggle.addEventListener("change", handleSandboxStrictToggle);
  ui.elements.sandboxApplyPlayersBtn.addEventListener("click", handleSandboxApplyPlayers);
  ui.elements.sandboxNextTurnBtn.addEventListener("click", handleSandboxNextTurn);
  ui.elements.sandboxForceMeBtn.addEventListener("click", handleSandboxForceMe);
  ui.elements.sandboxSimulateTurnBtn.addEventListener("click", handleSandboxSimulateTurn);
  ui.elements.sandboxRerollRackBtn.addEventListener("click", handleSandboxRerollRack);
  ui.elements.sandboxRefillRackBtn.addEventListener("click", handleSandboxRefillRack);
  ui.elements.sandboxInjectTileBtn.addEventListener("click", handleSandboxInjectTile);
  ui.elements.sandboxClearBoardBtn.addEventListener("click", handleSandboxClearBoard);
  ui.elements.sandboxResetBtn.addEventListener("click", handleSandboxReset);

  // Sidebar toggle
  if (ui.elements.sidebarToggleBtn) {
    ui.elements.sidebarToggleBtn.addEventListener("click", toggleSidebar);
  }

  // Theme switcher
  if (ui.elements.themeSwitcher) {
    ui.elements.themeSwitcher.addEventListener("click", handleThemeSwitcherClick);
  }

  window.addEventListener("beforeunload", () => detachPresence());
  window.addEventListener("resize", refreshBoardZoomStyles);

  // Drag and drop
  initDragAndDrop();
  initBoardPanning();
}

// ─── Session resume ───────────────────────────────────────────────────────────

async function tryResumeSession() {
  const session = loadSession();
  if (!session?.code) return false;
  try {
    bindGameSubscription(session.code);
    return true;
  } catch (_err) {
    clearSession();
    return false;
  }
}

function applyLoadedDisplayName() {
  const stored = sanitizeDisplayName(loadDisplayName());
  if (stored) ui.elements.displayNameInput.value = stored;
}

function applyJoinCodeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const joinCode = sanitizeJoinCode(params.get("join"));
  if (!joinCode) return false;
  ui.elements.joinCodeInput.value = joinCode;
  return true;
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

export async function startApp() {
  // Initialise theme and layout detection early
  initTheme();
  initLayoutDetection();

  bindUiEvents();
  devToolsEnabled = loadDevToolsPreference();
  applyDevUiVisibility();
  applyLoadedDisplayName();
  renderThemeSwitcher();
  applySidebarState();

  // Auto-collapse sidebar on mobile
  if (getLayoutMode() === "mobile") {
    sidebarVisible = false;
    applySidebarState();
  }

  // Disable inputs while Firebase initialises
  ui.elements.displayNameInput.disabled = true;
  ui.elements.joinCodeInput.disabled    = true;
  ui.elements.createGameBtn.disabled    = true;
  ui.elements.joinGameBtn.disabled      = true;

  ui.showScreen("landing-screen");
  ui.setConnectionState("Verbinde…", "neutral");

  const bootstrap = await bootstrapFirebase();
  if (!bootstrap.ok) {
    ui.setConnectionState("Firebase fehlt", "bad");
    ui.showScreen("setup-screen");
    return;
  }

  authUid = bootstrap.user?.uid || getAuthUser()?.uid;
  if (!authUid) {
    const user = await waitForAuthUser();
    authUid = user.uid;
  }

  ui.setConnectionState("Verbunden", "good");
  ui.elements.displayNameInput.disabled = false;
  ui.elements.joinCodeInput.disabled    = false;
  ui.elements.createGameBtn.disabled    = false;
  ui.elements.joinGameBtn.disabled      = false;

  const resumed = await tryResumeSession();
  if (!resumed) {
    const hasJoinCode = applyJoinCodeFromUrl();
    openLanding(
      hasJoinCode
        ? "Einladungslink erkannt. Gib deinen Namen ein und tritt bei."
        : "Erstelle ein neues Spiel oder tritt mit einem Code bei."
    );
  }

  refreshBoardZoomStyles();
  updateActionButtonState();
}
