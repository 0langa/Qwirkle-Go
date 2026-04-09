const SCREEN_IDS = ["setup-screen", "landing-screen", "lobby-screen", "game-screen"];

export function createUi() {
  const elements = {
    connectionPill: document.getElementById("connection-pill"),

    setupScreen: document.getElementById("setup-screen"),
    landingScreen: document.getElementById("landing-screen"),
    lobbyScreen: document.getElementById("lobby-screen"),
    gameScreen: document.getElementById("game-screen"),

    displayNameInput: document.getElementById("display-name-input"),
    joinCodeInput: document.getElementById("join-code-input"),
    createGameBtn: document.getElementById("create-game-btn"),
    joinGameBtn: document.getElementById("join-game-btn"),
    landingMessage: document.getElementById("landing-message"),

    lobbyCode: document.getElementById("lobby-code"),
    lobbyCount: document.getElementById("lobby-count"),
    lobbyPlayers: document.getElementById("lobby-players"),
    copyCodeBtn: document.getElementById("copy-code-btn"),
    leaveLobbyBtn: document.getElementById("leave-lobby-btn"),
    startGameBtn: document.getElementById("start-game-btn"),
    lobbyMessage: document.getElementById("lobby-message"),

    gameCode: document.getElementById("game-code"),
    bagCount: document.getElementById("bag-count"),
    turnIndicator: document.getElementById("turn-indicator"),
    gameStatus: document.getElementById("game-status"),
    scoreboard: document.getElementById("scoreboard"),
    boardScroll: document.getElementById("board-scroll"),
    boardGrid: document.getElementById("board-grid"),
    rack: document.getElementById("rack"),
    commitMoveBtn: document.getElementById("commit-move-btn"),
    undoPlacementBtn: document.getElementById("undo-placement-btn"),
    cancelTurnBtn: document.getElementById("cancel-turn-btn"),
    exchangeModeBtn: document.getElementById("exchange-mode-btn"),
    exchangeSelectedBtn: document.getElementById("exchange-selected-btn"),
    passTurnBtn: document.getElementById("pass-turn-btn"),
    gameMessage: document.getElementById("game-message"),

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
  }

  function setConnectionState(label, tone = "neutral") {
    elements.connectionPill.textContent = label;
    elements.connectionPill.className = `pill ${tone}`;
  }

  function setMessage(target, text, tone = "") {
    target.textContent = text || "";
    target.className = "message";
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
