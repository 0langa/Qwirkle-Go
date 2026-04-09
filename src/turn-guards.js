export const OFFLINE_SKIP_GRACE_MS = 20_000;

export function hasOpeningPlacementRequirement(game, uid) {
  const boardIsEmpty = Object.keys(game?.board || {}).length === 0;
  const openingUid = game?.openingRequirement?.uid || null;
  return boardIsEmpty && openingUid === uid;
}

export function canHostSkipOfflineTurn(state, requesterUid, now = Date.now(), graceMs = OFFLINE_SKIP_GRACE_MS) {
  const meta = state?.meta || {};
  const players = state?.players || {};
  const game = state?.game || {};

  if (meta.hostUid !== requesterUid) {
    return { ok: false, reason: "Nur der Host kann Offline-Spieler überspringen." };
  }

  const currentUid = game.currentPlayerUid;
  if (!currentUid) {
    return { ok: false, reason: "Kein aktiver Spielerzug vorhanden." };
  }

  if (currentUid === requesterUid) {
    return { ok: false, reason: "Du bist am Zug und kannst dich nicht selbst überspringen." };
  }

  const currentPlayer = players[currentUid];
  if (!currentPlayer) {
    return { ok: false, reason: "Aktiver Spieler fehlt." };
  }

  if (currentPlayer.connected) {
    return { ok: false, reason: "Der aktive Spieler ist verbunden und kann nicht übersprungen werden." };
  }

  const offlineSince = Number(currentPlayer.lastSeenAt || 0);
  const offlineMs = now - offlineSince;
  if (offlineMs < graceMs) {
    return { ok: false, reason: "Offline-Spieler kann erst nach 20 Sekunden Inaktivität übersprungen werden." };
  }

  return { ok: true, skippedUid: currentUid };
}
