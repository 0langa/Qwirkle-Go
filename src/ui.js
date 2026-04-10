const SCREEN_IDS = ["setup-screen", "landing-screen", "lobby-screen", "game-screen"];

export function createUi() {
  const elements = {
    connectionPill: document.getElementById("connection-pill"),
    topHeader: document.getElementById("top-header"),
    legalNote: document.getElementById("legal-note"),
    footerTools: document.getElementById("footer-tools"),
    devToolsToggleBtn: document.getElementById("dev-tools-toggle-btn"),

    setupScreen: document.getElementById("setup-screen"),
    landingScreen: document.getElementById("landing-screen"),
    lobbyScreen: document.getElementById("lobby-screen"),
    gameScreen: document.getElementById("game-screen"),

    displayNameInput: document.getElementById("display-name-input"),
    joinCodeInput: document.getElementById("join-code-input"),
    createGameBtn: document.getElementById("create-game-btn"),
    devEnterGameBtn: document.getElementById("dev-enter-game-btn"),
    sandboxEntryTools: document.getElementById("sandbox-entry-tools"),
    sandboxPlayerCount: document.getElementById("sandbox-player-count"),
    joinGameBtn: document.getElementById("join-game-btn"),
    landingMessage: document.getElementById("landing-message"),

    lobbyCode: document.getElementById("lobby-code"),
    lobbyCount: document.getElementById("lobby-count"),
    lobbyPlayers: document.getElementById("lobby-players"),
    copyCodeBtn: document.getElementById("copy-code-btn"),
    leaveLobbyBtn: document.getElementById("leave-lobby-btn"),
    readyToggleBtn: document.getElementById("ready-toggle-btn"),
    startGameBtn: document.getElementById("start-game-btn"),
    lobbyMessage: document.getElementById("lobby-message"),

    gameCode: document.getElementById("game-code"),
    bagCount: document.getElementById("bag-count"),
    turnIndicator: document.getElementById("turn-indicator"),
    gameStatus: document.getElementById("game-status"),
    sandboxModeBadge: document.getElementById("sandbox-mode-badge"),
    zoomOutBtn: document.getElementById("zoom-out-btn"),
    zoomInBtn: document.getElementById("zoom-in-btn"),
    zoomResetBtn: document.getElementById("zoom-reset-btn"),
    zoomLevelLabel: document.getElementById("zoom-level-label"),
    centerBoardBtn: document.getElementById("center-board-btn"),
    infoPanelBtn: document.getElementById("info-panel-btn"),
    themeCycleBtn: document.getElementById("theme-cycle-btn"),
    scoreboard: document.getElementById("scoreboard"),
    moveHistoryList: document.getElementById("move-history-list"),
    boardScroll: document.getElementById("board-scroll"),
    boardGrid: document.getElementById("board-grid"),
    rack: document.getElementById("rack"),
    rackHelpToggleBtn: document.getElementById("rack-help-toggle-btn"),
    rackHelpText: document.getElementById("rack-help-text"),
    commitMoveBtn: document.getElementById("commit-move-btn"),
    undoPlacementBtn: document.getElementById("undo-placement-btn"),
    cancelTurnBtn: document.getElementById("cancel-turn-btn"),
    exchangeModeBtn: document.getElementById("exchange-mode-btn"),
    exchangeSelectedBtn: document.getElementById("exchange-selected-btn"),
    passTurnBtn: document.getElementById("pass-turn-btn"),
    skipOfflineBtn: document.getElementById("skip-offline-btn"),
    devDeleteGameBtn: document.getElementById("dev-delete-game-btn"),
    gameMessage: document.getElementById("game-message"),
    turnNotice: document.getElementById("turn-notice"),
    qwirkleNotice: document.getElementById("qwirkle-notice"),
    sandboxPanel: document.getElementById("sandbox-panel"),
    sandboxStrictToggle: document.getElementById("sandbox-strict-toggle"),
    sandboxPlayersSelect: document.getElementById("sandbox-players-select"),
    sandboxApplyPlayersBtn: document.getElementById("sandbox-apply-players-btn"),
    sandboxNextTurnBtn: document.getElementById("sandbox-next-turn-btn"),
    sandboxForceMeBtn: document.getElementById("sandbox-force-me-btn"),
    sandboxSimulateTurnBtn: document.getElementById("sandbox-simulate-turn-btn"),
    sandboxRerollRackBtn: document.getElementById("sandbox-reroll-rack-btn"),
    sandboxRefillRackBtn: document.getElementById("sandbox-refill-rack-btn"),
    sandboxInjectColor: document.getElementById("sandbox-inject-color"),
    sandboxInjectShape: document.getElementById("sandbox-inject-shape"),
    sandboxInjectTileBtn: document.getElementById("sandbox-inject-tile-btn"),
    sandboxClearBoardBtn: document.getElementById("sandbox-clear-board-btn"),
    sandboxResetBtn: document.getElementById("sandbox-reset-btn"),

    resultTemplate: document.getElementById("result-dialog-template"),
  };

  let resultOverlay = null;

  function showScreen(screenId) {
    for (const id of SCREEN_IDS) {
      const node = document.getElementById(id);
      if (!node) {
        continue;
      }
      node.classList.toggle("hidden", id !== screenId);
    }
    if (elements.topHeader) {
      elements.topHeader.classList.toggle("hidden", screenId === "game-screen");
    }
    if (elements.legalNote) {
      elements.legalNote.classList.toggle("hidden", screenId === "game-screen");
    }
    if (elements.footerTools) {
      elements.footerTools.classList.toggle("hidden", screenId === "game-screen");
    }
  }

  function setConnectionState(label, tone = "neutral") {
    elements.connectionPill.textContent = label;
    elements.connectionPill.className = `connection-pill pill ${tone}`;
  }

  function setMessage(target, text, tone = "") {
    target.textContent = text || "";
    // Remove only tone classes, preserve base classes on the element
    target.classList.remove("error", "success");
    if (tone) {
      target.classList.add(tone);
    }
  }

  function showResultDialog(summary, onClose) {
    hideResultDialog();
    const fragment = elements.resultTemplate.content.cloneNode(true);
    const overlay = fragment.querySelector(".result-overlay");
    const winnerLine = fragment.querySelector("#result-winner-line");
    const standings = fragment.querySelector("#result-standings");
    const closeBtn = fragment.querySelector("#result-close-btn");

    winnerLine.textContent = summary.winnerLine;
    standings.innerHTML = "";
    for (const row of summary.rows) {
      const item = document.createElement("li");
      item.textContent = row;
      standings.appendChild(item);
    }
    closeBtn.addEventListener("click", () => {
      hideResultDialog();
      onClose?.();
    });

    resultOverlay = overlay;
    document.body.appendChild(fragment);
  }

  function hideResultDialog() {
    if (resultOverlay) {
      resultOverlay.remove();
    }
    resultOverlay = null;
  }

  return {
    elements,
    showScreen,
    setConnectionState,
    setMessage,
    showResultDialog,
    hideResultDialog,
  };
}
