const state = {
  phase: "boot",
  firebaseReady: false,
  firebaseConfigReady: false,
  authUser: null,
  activeCode: null,
  gameSnapshot: null,
  selectedRackTileId: null,
  tentativePlacements: [],
  exchangeMode: false,
  exchangeSelection: new Set(),
  boardHasCentered: false,
};

const listeners = new Set();

export function getState() {
  return state;
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit() {
  for (const listener of listeners) {
    listener(state);
  }
}

export function patchState(patch) {
  Object.assign(state, patch);
  emit();
}

export function resetTurnDraft() {
  state.selectedRackTileId = null;
  state.tentativePlacements = [];
  state.exchangeMode = false;
  state.exchangeSelection = new Set();
  emit();
}

export function setTentativePlacements(placements) {
  state.tentativePlacements = placements;
  emit();
}

export function setSelectedRackTile(tileId) {
  state.selectedRackTileId = tileId;
  emit();
}

export function setExchangeMode(enabled) {
  state.exchangeMode = Boolean(enabled);
  if (!state.exchangeMode) {
    state.exchangeSelection = new Set();
  }
  emit();
}

export function toggleExchangeTile(tileId) {
  const next = new Set(state.exchangeSelection);
  if (next.has(tileId)) {
    next.delete(tileId);
  } else {
    next.add(tileId);
  }
  state.exchangeSelection = next;
  emit();
}

export function clearExchangeSelection() {
  state.exchangeSelection = new Set();
  emit();
}

export function markBoardCentered(value = true) {
  state.boardHasCentered = Boolean(value);
  emit();
}

export function resetBoardCentered() {
  state.boardHasCentered = false;
  emit();
}
