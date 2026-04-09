import {
  attachPresence,
  bootstrapFirebase,
  detachPresence,
  ensureAuthReady,
  getAuthUser,
  subscribe,
  waitForAuthUser,
} from "./firebase.js";
import { commitMove, exchangeTiles, passTurn } from "./game.js";
import { joinLobby, createLobby, leaveLobby, startGame } from "./lobby.js";
import {
  buildResultSummary,
  renderBoardGrid,
  renderLobbyPlayers,
  renderRack,
  renderScoreboard,
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

const ui = createUi();

let unsubscribeGame = null;
let activeCode = null;
let authUid = null;
let actionBusy = false;
let finishedRevisionShown = null;
let presenceCode = null;

function setBusy(value) {
  actionBusy = Boolean(value);
  updateActionButtonState();
}

function toCode(error) {
  return String(error?.code || "").toLowerCase();
}

function toUiErrorMessage(error) {
  const code = toCode(error);

  if (code === "game-not-found") {
    return "Game not found. Check the join code and try again.";
  }
  if (code === "auth-not-ready") {
    return "Authentication is still initializing. Please wait and try again.";
  }
  if (code === "permission-denied") {
    return "Permission denied by Firebase rules. Verify auth and database rules.";
  }
  if (code === "invalid-lobby-data") {
    return "Lobby data is invalid. Ask the host to create a new game.";
  }
  if (code === "network-error") {
    return "Network/database error while contacting Firebase. Try again.";
  }
  if (code === "firebase-error") {
    return "Unexpected Firebase error. Check console diagnostics and database setup.";
  }
  if (code === "invalid-join-code") {
    return "Enter a valid join code.";
  }
  if (code === "game-already-started") {
    return "That game already started.";
  }
  if (code === "game-finished") {
    return "That game already finished.";
  }
  if (code === "lobby-full") {
    return "Lobby is full (4 players).";
  }

  return error?.message || "Unexpected error.";
}

async function ensureActionAuthUid() {
  if (authUid) {
    return authUid;
  }
  const user = await ensureAuthReady();
  authUid = user?.uid || null;
  if (!authUid) {
    const error = new Error("Authentication is still initializing.");
    error.code = "auth-not-ready";
    throw error;
  }
  return authUid;
}

function currentSnapshot() {
  return getState().gameSnapshot;
}

function myRack() {
  const snapshot = currentSnapshot();
  return snapshot?.game?.racks?.[authUid] || [];
}

function myTurn() {
  const snapshot = currentSnapshot();
  return snapshot?.meta?.status === "in_progress" && snapshot?.game?.currentPlayerUid === authUid;
}

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

function openLanding(message = "", tone = "") {
  patchState({ gameSnapshot: null, activeCode: null, boardHasCentered: false });
  resetTurnDraft();
  finishedRevisionShown = null;
  ui.hideResultDialog();
  ui.showScreen("landing-screen");
  if (message) {
    setLandingMessage(message, tone);
  }
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
  if (state.boardHasCentered) {
    return;
  }

  const scroller = ui.elements.boardScroll;
  scroller.scrollLeft = (scroller.scrollWidth - scroller.clientWidth) / 2;
  scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) / 2;
  patchState({ boardHasCentered: true });
}

function updateActionButtonState() {
  const snapshot = currentSnapshot();
  const state = getState();
  const inProgress = snapshot?.meta?.status === "in_progress";
  const isMyTurn = myTurn();
  const hasTentative = state.tentativePlacements.length > 0;
  const hasExchangeSelection = state.exchangeSelection.size > 0;

  ui.elements.commitMoveBtn.disabled = actionBusy || !inProgress || !isMyTurn || state.exchangeMode || !hasTentative;
  ui.elements.undoPlacementBtn.disabled = actionBusy || !inProgress || !isMyTurn || state.exchangeMode || !hasTentative;
  ui.elements.cancelTurnBtn.disabled = actionBusy || !inProgress || !isMyTurn || (!hasTentative && !state.exchangeSelection.size && !state.selectedRackTileId);
  ui.elements.exchangeModeBtn.disabled = actionBusy || !inProgress || !isMyTurn || hasTentative;
  ui.elements.exchangeSelectedBtn.disabled =
    actionBusy || !inProgress || !isMyTurn || !state.exchangeMode || !hasExchangeSelection;
  ui.elements.passTurnBtn.disabled = actionBusy || !inProgress || !isMyTurn || hasTentative;

  ui.elements.exchangeModeBtn.textContent = `Exchange Mode: ${state.exchangeMode ? "On" : "Off"}`;
}

function refreshCurrentGameView() {
  const snapshot = currentSnapshot();
  if (!snapshot) {
    updateActionButtonState();
    return;
  }
  if (snapshot.meta?.status === "lobby") {
    renderLobby(snapshot);
    return;
  }
  renderGame(snapshot);
}

function renderLobby(snapshot) {
  const meta = snapshot.meta || {};
  const players = snapshot.players || {};
  const playerCount = Object.keys(players).length;
  const me = players[authUid];

  ui.elements.lobbyCode.textContent = meta.joinCode || "-----";
  ui.elements.lobbyCount.textContent = `${playerCount} / 4 players`;
  renderLobbyPlayers(ui.elements.lobbyPlayers, players, authUid);

  const host = meta.hostUid === authUid;
  ui.elements.startGameBtn.disabled = !host || playerCount < 2 || playerCount > 4 || actionBusy;
  ui.elements.startGameBtn.title = host
    ? "Start when 2-4 players are present"
    : "Only host can start";

  if (!me) {
    openLanding("You are no longer in this lobby.", "error");
    return;
  }

  ui.showScreen("lobby-screen");
  setLobbyMessage(host ? "You are the host. Start when everyone is ready." : "Waiting for host to start.");
}

function clearDraftIfOutdated(snapshot) {
  const rack = snapshot?.game?.racks?.[authUid] || [];
  const rackIds = new Set(rack.map((tile) => tile.id));
  const state = getState();

  const placementsValid = state.tentativePlacements.every((placement) => rackIds.has(placement.tile.id));
  if (!placementsValid || !myTurn()) {
    resetTurnDraft();
  }
}

function renderGame(snapshot) {
  const meta = snapshot.meta || {};
  const game = snapshot.game || {};
  const players = snapshot.players || {};
  const rack = game.racks?.[authUid] || [];
  const isMyTurn = myTurn();

  clearDraftIfOutdated(snapshot);
  const state = getState();

  ui.elements.gameCode.textContent = meta.joinCode || "-----";
  ui.elements.bagCount.textContent = String((game.bag || []).length);
  ui.elements.turnIndicator.textContent = players?.[game.currentPlayerUid]?.name || "-";
  ui.elements.gameStatus.textContent =
    meta.status === "finished" ? "Finished" : isMyTurn ? "Your turn" : "Waiting";

  renderScoreboard(
    ui.elements.scoreboard,
    players,
    game.scores || {},
    game.currentPlayerUid,
    authUid,
    game.turnOrder || []
  );

  renderBoardGrid(ui.elements.boardGrid, {
    boardMap: game.board || {},
    tentativePlacements: state.tentativePlacements,
    interactive: isMyTurn,
  });

  renderRack(
    ui.elements.rack,
    rack,
    state.selectedRackTileId,
    state.exchangeSelection,
    state.exchangeMode
  );

  if (meta.status === "in_progress") {
    setGameMessage(isMyTurn ? "Your turn: place tiles, exchange, or pass." : "Waiting for the current player.");
  }

  ui.showScreen("game-screen");
  updateActionButtonState();

  if (meta.status === "finished") {
    if (finishedRevisionShown !== meta.revision) {
      finishedRevisionShown = meta.revision;
      const summary = buildResultSummary(players, game.finalStandings || [], game.winnerUids || []);
      ui.showResultDialog(summary, () => {
        clearSession();
        dropGameSubscription();
        openLanding("Game complete. Start a new match whenever you like.", "success");
      });
    }
  } else {
    finishedRevisionShown = null;
    ui.hideResultDialog();
  }

  requestAnimationFrame(centerBoardIfNeeded);
}

function renderBySnapshot(snapshot) {
  if (!snapshot) {
    openLanding();
    return;
  }

  const me = snapshot.players?.[authUid];
  if (!me) {
    clearSession();
    dropGameSubscription();
    openLanding("You are not a participant in that game anymore.", "error");
    return;
  }

  if (snapshot.meta?.status === "lobby") {
    renderLobby(snapshot);
    return;
  }

  renderGame(snapshot);
}

function bindGameSubscription(code) {
  const normalized = sanitizeJoinCode(code);
  if (!normalized) {
    throw new Error("Invalid game code.");
  }

  dropGameSubscription();
  activeCode = normalized;
  saveSession(normalized);
  patchState({ boardHasCentered: false });

  unsubscribeGame = subscribe(
    `games/${normalized}`,
    async (snapshot) => {
      if (activeCode !== normalized) {
        return;
      }

      const value = snapshot.val();
      if (!value) {
        clearSession();
        dropGameSubscription();
        openLanding("Game not found or removed.", "error");
        return;
      }

      patchState({
        activeCode: normalized,
        gameSnapshot: value,
      });

      if (presenceCode !== normalized) {
        try {
          await attachPresence(normalized, authUid);
          presenceCode = normalized;
        } catch (_error) {
          setGameMessage("Presence sync failed. Realtime updates may be delayed.", "error");
        }
      }

      if (activeCode !== normalized) {
        return;
      }

      ui.setConnectionState("Connected", "good");
      renderBySnapshot(value);
    },
    () => {
      ui.setConnectionState("Connection issue", "bad");
      setGameMessage("Realtime connection problem. Retrying...");
    }
  );
}

async function handleCreateLobby() {
  const name = sanitizeDisplayName(ui.elements.displayNameInput.value);
  saveDisplayName(name);

  try {
    setBusy(true);
    clearMessages();
    const readyUid = await ensureActionAuthUid();
    const created = await createLobby(readyUid, name);
    bindGameSubscription(created.code);
    setLobbyMessage("Lobby created. Share the join code.", "success");
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
    const readyUid = await ensureActionAuthUid();
    const joined = await joinLobby(code, readyUid, name);
    bindGameSubscription(joined.code);
    setLobbyMessage("Joined lobby successfully.", "success");
  } catch (error) {
    setLandingMessage(toUiErrorMessage(error), "error");
  } finally {
    setBusy(false);
  }
}

async function handleLeaveLobby() {
  if (!activeCode) {
    return;
  }

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
      openLanding("You left the lobby.");
    }
  }
}

async function handleStartGame() {
  if (!activeCode) {
    return;
  }

  try {
    setBusy(true);
    await startGame(activeCode, authUid);
    setLobbyMessage("Starting game...", "success");
  } catch (error) {
    setLobbyMessage(error.message, "error");
  } finally {
    setBusy(false);
  }
}

function findTentativeByCell(x, y) {
  return getState().tentativePlacements.findIndex((placement) => placement.x === x && placement.y === y);
}

function rackTileAlreadyPlaced(tileId) {
  return getState().tentativePlacements.some((placement) => placement.tile.id === tileId);
}

function handleRackClick(event) {
  const target = event.target.closest("[data-rack-tile-id]");
  if (!target || !myTurn()) {
    return;
  }

  const tileId = target.dataset.rackTileId;
  const state = getState();

  if (state.exchangeMode) {
    toggleExchangeTile(tileId);
    setSelectedRackTile(null);
    refreshCurrentGameView();
    return;
  }

  const placementIndex = state.tentativePlacements.findIndex((placement) => placement.tile.id === tileId);
  if (placementIndex >= 0) {
    const next = [...state.tentativePlacements];
    next.splice(placementIndex, 1);
    setTentativePlacements(next);
    setSelectedRackTile(null);
    refreshCurrentGameView();
    return;
  }

  if (state.selectedRackTileId === tileId) {
    setSelectedRackTile(null);
  } else {
    setSelectedRackTile(tileId);
  }
  refreshCurrentGameView();
}

function handleBoardClick(event) {
  const button = event.target.closest("[data-board-x][data-board-y]");
  if (!button || !myTurn()) {
    return;
  }

  const x = Number(button.dataset.boardX);
  const y = Number(button.dataset.boardY);
  const key = coordinateKey(x, y);

  const snapshot = currentSnapshot();
  if (snapshot?.game?.board?.[key]) {
    return;
  }

  const state = getState();
  const existingIndex = findTentativeByCell(x, y);
  if (existingIndex >= 0) {
    const next = [...state.tentativePlacements];
    next.splice(existingIndex, 1);
    setTentativePlacements(next);
    refreshCurrentGameView();
    return;
  }

  if (state.exchangeMode) {
    setGameMessage("Turn off exchange mode to place tiles.", "error");
    return;
  }

  const selectedTileId = state.selectedRackTileId;
  if (!selectedTileId) {
    setGameMessage("Select a tile from your rack first.", "error");
    return;
  }

  if (rackTileAlreadyPlaced(selectedTileId)) {
    setGameMessage("That tile is already placed this turn.", "error");
    return;
  }

  const tile = myRack().find((entry) => entry.id === selectedTileId);
  if (!tile) {
    setGameMessage("Selected tile is no longer available.", "error");
    setSelectedRackTile(null);
    return;
  }

  setTentativePlacements([
    ...state.tentativePlacements,
    {
      x,
      y,
      tile,
    },
  ]);
  setSelectedRackTile(null);
  refreshCurrentGameView();
}

function undoLastPlacement() {
  const state = getState();
  if (!state.tentativePlacements.length) {
    return;
  }
  const next = [...state.tentativePlacements];
  next.pop();
  setTentativePlacements(next);
  refreshCurrentGameView();
}

function cancelTurnDraft() {
  resetTurnDraft();
  setGameMessage("Turn draft cleared.");
  refreshCurrentGameView();
}

async function handleCommitMove() {
  if (!myTurn()) {
    return;
  }
  const draft = getState().tentativePlacements;
  if (!draft.length) {
    setGameMessage("Place at least one tile before committing.", "error");
    return;
  }

  try {
    setBusy(true);
    await commitMove(
      activeCode,
      authUid,
      draft.map((placement) => ({
        x: placement.x,
        y: placement.y,
        tileId: placement.tile.id,
      }))
    );
    resetTurnDraft();
    setGameMessage("Move committed.", "success");
  } catch (error) {
    setGameMessage(error.message, "error");
  } finally {
    setBusy(false);
  }
}

function toggleExchangeMode() {
  const state = getState();
  if (state.tentativePlacements.length > 0) {
    setGameMessage("Commit or cancel your tentative move before exchanging.", "error");
    return;
  }
  setExchangeMode(!state.exchangeMode);
  setSelectedRackTile(null);
  if (!getState().exchangeMode) {
    clearExchangeSelection();
  }
  refreshCurrentGameView();
}

async function handleExchangeSelected() {
  if (!myTurn()) {
    return;
  }

  const state = getState();
  if (!state.exchangeMode) {
    setGameMessage("Enable exchange mode first.", "error");
    return;
  }

  const selected = [...state.exchangeSelection];
  if (!selected.length) {
    setGameMessage("Select at least one tile for exchange.", "error");
    return;
  }

  try {
    setBusy(true);
    await exchangeTiles(activeCode, authUid, selected);
    resetTurnDraft();
    setGameMessage("Tiles exchanged.", "success");
  } catch (error) {
    setGameMessage(error.message, "error");
  } finally {
    setBusy(false);
  }
}

async function handlePassTurn() {
  if (!myTurn()) {
    return;
  }

  if (getState().tentativePlacements.length > 0) {
    setGameMessage("Commit or cancel your tentative placements before passing.", "error");
    return;
  }

  const confirmed = window.confirm("Pass your turn?");
  if (!confirmed) {
    return;
  }

  try {
    setBusy(true);
    await passTurn(activeCode, authUid);
    resetTurnDraft();
    setGameMessage("Turn passed.", "success");
  } catch (error) {
    setGameMessage(error.message, "error");
  } finally {
    setBusy(false);
  }
}

async function copyJoinCode() {
  const code = activeCode || currentSnapshot()?.meta?.joinCode;
  if (!code) {
    return;
  }

  try {
    await navigator.clipboard.writeText(code);
    setLobbyMessage("Join code copied.", "success");
  } catch (_error) {
    setLobbyMessage(`Copy failed. Share this code manually: ${code}`, "error");
  }
}

function bindUiEvents() {
  ui.elements.displayNameInput.addEventListener("change", () => {
    const clean = sanitizeDisplayName(ui.elements.displayNameInput.value);
    ui.elements.displayNameInput.value = clean;
    saveDisplayName(clean);
  });

  ui.elements.joinCodeInput.addEventListener("input", () => {
    ui.elements.joinCodeInput.value = sanitizeJoinCode(ui.elements.joinCodeInput.value);
  });

  ui.elements.joinCodeInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      handleJoinLobby();
    }
  });

  ui.elements.createGameBtn.addEventListener("click", handleCreateLobby);
  ui.elements.joinGameBtn.addEventListener("click", handleJoinLobby);

  ui.elements.copyCodeBtn.addEventListener("click", copyJoinCode);
  ui.elements.leaveLobbyBtn.addEventListener("click", handleLeaveLobby);
  ui.elements.startGameBtn.addEventListener("click", handleStartGame);

  ui.elements.rack.addEventListener("click", handleRackClick);
  ui.elements.boardGrid.addEventListener("click", handleBoardClick);

  ui.elements.commitMoveBtn.addEventListener("click", handleCommitMove);
  ui.elements.undoPlacementBtn.addEventListener("click", undoLastPlacement);
  ui.elements.cancelTurnBtn.addEventListener("click", cancelTurnDraft);
  ui.elements.exchangeModeBtn.addEventListener("click", toggleExchangeMode);
  ui.elements.exchangeSelectedBtn.addEventListener("click", handleExchangeSelected);
  ui.elements.passTurnBtn.addEventListener("click", handlePassTurn);

  window.addEventListener("beforeunload", () => {
    detachPresence();
  });
}

async function tryResumeSession() {
  const session = loadSession();
  if (!session?.code) {
    return false;
  }

  try {
    bindGameSubscription(session.code);
    return true;
  } catch (_error) {
    clearSession();
    return false;
  }
}

function applyLoadedDisplayName() {
  const stored = sanitizeDisplayName(loadDisplayName());
  if (stored) {
    ui.elements.displayNameInput.value = stored;
  }
}

export async function startApp() {
  bindUiEvents();
  applyLoadedDisplayName();

  ui.elements.displayNameInput.disabled = true;
  ui.elements.joinCodeInput.disabled = true;
  ui.elements.createGameBtn.disabled = true;
  ui.elements.joinGameBtn.disabled = true;

  ui.showScreen("landing-screen");
  ui.setConnectionState("Connecting...", "neutral");

  const bootstrap = await bootstrapFirebase();
  if (!bootstrap.ok) {
    ui.setConnectionState("Firebase config missing", "bad");
    ui.showScreen("setup-screen");
    return;
  }

  authUid = bootstrap.user?.uid || getAuthUser()?.uid;
  if (!authUid) {
    const user = await waitForAuthUser();
    authUid = user.uid;
  }

  ui.setConnectionState("Connected", "good");
  ui.elements.displayNameInput.disabled = false;
  ui.elements.joinCodeInput.disabled = false;
  ui.elements.createGameBtn.disabled = false;
  ui.elements.joinGameBtn.disabled = false;

  const resumed = await tryResumeSession();
  if (!resumed) {
    openLanding("Create a lobby or join with a code.");
  }

  updateActionButtonState();
}
