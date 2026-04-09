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
    return "Spiel nicht gefunden. Bitte prüfe den Beitrittscode und versuche es erneut.";
  }
  if (code === "auth-not-ready") {
    return "Authentifizierung wird noch initialisiert. Bitte kurz warten und erneut versuchen.";
  }
  if (code === "permission-denied") {
    return "Zugriff durch Firebase-Regeln verweigert. Prüfe Authentifizierung und Datenbankregeln.";
  }
  if (code === "invalid-lobby-data") {
    return "Lobby-Daten sind ungültig. Bitte den Host, ein neues Spiel zu erstellen.";
  }
  if (code === "network-error") {
    return "Netzwerk-/Datenbankfehler beim Zugriff auf Firebase. Bitte erneut versuchen.";
  }
  if (code === "firebase-error") {
    return "Unerwarteter Firebase-Fehler. Prüfe Konsole und Datenbank-Setup.";
  }
  if (code === "invalid-join-code") {
    return "Bitte einen gültigen Beitrittscode eingeben.";
  }
  if (code === "game-already-started") {
    return "Dieses Spiel wurde bereits gestartet.";
  }
  if (code === "game-finished") {
    return "Dieses Spiel ist bereits beendet.";
  }
  if (code === "lobby-full") {
    return "Die Lobby ist voll (4 Spieler).";
  }

  return error?.message || "Unerwarteter Fehler.";
}

async function ensureActionAuthUid() {
  if (authUid) {
    return authUid;
  }
  const user = await ensureAuthReady();
  authUid = user?.uid || null;
  if (!authUid) {
    const error = new Error("Authentifizierung wird noch initialisiert.");
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
  ui.elements.devDeleteGameBtn.disabled = actionBusy || !activeCode;

  ui.elements.exchangeModeBtn.textContent = `Tauschmodus: ${state.exchangeMode ? "An" : "Aus"}`;
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
  ui.elements.lobbyCount.textContent = `${playerCount} / 4 Spieler`;
  renderLobbyPlayers(ui.elements.lobbyPlayers, players, authUid);

  const host = meta.hostUid === authUid;
  ui.elements.startGameBtn.disabled = !host || playerCount < 2 || playerCount > 4 || actionBusy;
  ui.elements.startGameBtn.title = host
    ? "Starten, wenn 2-4 Spieler anwesend sind"
    : "Nur der Host kann starten";

  if (!me) {
    openLanding("Du bist nicht mehr in dieser Lobby.", "error");
    return;
  }

  ui.showScreen("lobby-screen");
  setLobbyMessage(host ? "Du bist Host. Starte, wenn alle bereit sind." : "Warte auf den Host zum Starten.");
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
    meta.status === "finished" ? "Beendet" : isMyTurn ? "Du bist dran" : "Warten";

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
    setGameMessage(isMyTurn ? "Du bist dran: Teile legen, tauschen oder passen." : "Warte auf den aktuellen Spieler.");
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
        openLanding("Spiel abgeschlossen. Du kannst jederzeit eine neue Runde starten.", "success");
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
    openLanding("Du bist kein Teilnehmer dieses Spiels mehr.", "error");
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
    throw new Error("Ungültiger Spielcode.");
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
        openLanding("Spiel nicht gefunden oder bereits gelöscht.", "error");
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
          setGameMessage("Präsenz-Synchronisierung fehlgeschlagen. Live-Updates können verzögert sein.", "error");
        }
      }

      if (activeCode !== normalized) {
        return;
      }

      ui.setConnectionState("Verbunden", "good");
      renderBySnapshot(value);
    },
    () => {
      ui.setConnectionState("Verbindungsproblem", "bad");
      setGameMessage("Live-Verbindung unterbrochen. Neuer Versuch...");
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
    const readyUid = await ensureActionAuthUid();
    const joined = await joinLobby(code, readyUid, name);
    bindGameSubscription(joined.code);
    setLobbyMessage("Lobby erfolgreich beigetreten.", "success");
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
      openLanding("Du hast die Lobby verlassen.");
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
    setLobbyMessage("Spiel wird gestartet...", "success");
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
    setGameMessage("Deaktiviere den Tauschmodus, um Teile zu platzieren.", "error");
    return;
  }

  const selectedTileId = state.selectedRackTileId;
  if (!selectedTileId) {
    setGameMessage("Bitte zuerst ein Teil aus dem Ablageständer auswählen.", "error");
    return;
  }

  if (rackTileAlreadyPlaced(selectedTileId)) {
    setGameMessage("Dieses Teil wurde in diesem Zug bereits platziert.", "error");
    return;
  }

  const tile = myRack().find((entry) => entry.id === selectedTileId);
  if (!tile) {
    setGameMessage("Das ausgewählte Teil ist nicht mehr verfügbar.", "error");
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
  setGameMessage("Zugentwurf verworfen.");
  refreshCurrentGameView();
}

async function handleCommitMove() {
  if (!myTurn()) {
    return;
  }
  const draft = getState().tentativePlacements;
  if (!draft.length) {
    setGameMessage("Platziere mindestens ein Teil, bevor du bestätigst.", "error");
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
    setGameMessage("Zug bestätigt.", "success");
  } catch (error) {
    setGameMessage(error.message, "error");
  } finally {
    setBusy(false);
  }
}

function toggleExchangeMode() {
  const state = getState();
  if (state.tentativePlacements.length > 0) {
    setGameMessage("Bestätige oder verwerfe zuerst deinen platzierten Zug.", "error");
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
    setGameMessage("Aktiviere zuerst den Tauschmodus.", "error");
    return;
  }

  const selected = [...state.exchangeSelection];
  if (!selected.length) {
    setGameMessage("Wähle mindestens ein Teil zum Tauschen aus.", "error");
    return;
  }

  try {
    setBusy(true);
    await exchangeTiles(activeCode, authUid, selected);
    resetTurnDraft();
    setGameMessage("Teile wurden getauscht.", "success");
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
    setGameMessage("Bestätige oder verwerfe zuerst deine vorläufigen Platzierungen.", "error");
    return;
  }

  const confirmed = window.confirm("Möchtest du deinen Zug passen?");
  if (!confirmed) {
    return;
  }

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

async function handleDevDeleteGame() {
  if (!activeCode) {
    setGameMessage("Kein aktives Spiel zum Löschen vorhanden.", "error");
    return;
  }

  const code = activeCode;
  const confirmed = window.confirm(`Spiel ${code} jetzt aus Firebase löschen?`);
  if (!confirmed) {
    return;
  }

  try {
    setBusy(true);
    await ensureActionAuthUid();
    await write(`games/${code}`, null);
    clearSession();
    dropGameSubscription();
    openLanding(`Spiel ${code} gelöscht (Dev-Reset).`, "success");
  } catch (error) {
    setGameMessage(toUiErrorMessage(error), "error");
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
    setLobbyMessage("Beitrittscode kopiert.", "success");
  } catch (_error) {
    setLobbyMessage(`Kopieren fehlgeschlagen. Teile den Code manuell: ${code}`, "error");
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
  ui.elements.devDeleteGameBtn.addEventListener("click", handleDevDeleteGame);

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
  ui.setConnectionState("Verbinde...", "neutral");

  const bootstrap = await bootstrapFirebase();
  if (!bootstrap.ok) {
    ui.setConnectionState("Firebase-Konfiguration fehlt", "bad");
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
  ui.elements.joinCodeInput.disabled = false;
  ui.elements.createGameBtn.disabled = false;
  ui.elements.joinGameBtn.disabled = false;

  const resumed = await tryResumeSession();
  if (!resumed) {
    openLanding("Erstelle eine Lobby oder tritt mit einem Code bei.");
  }

  updateActionButtonState();
}
