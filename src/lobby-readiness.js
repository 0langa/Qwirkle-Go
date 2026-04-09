export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

export function evaluateLobbyStartReadiness(playersByUid) {
  const players = Object.values(playersByUid || {});
  const connectedPlayers = players.filter((player) => player.connected);
  const readyPlayers = connectedPlayers.filter((player) => player.ready);
  const allConnected = connectedPlayers.length === players.length;
  const allReady = readyPlayers.length === players.length;
  return {
    count: players.length,
    connectedCount: connectedPlayers.length,
    readyCount: readyPlayers.length,
    allConnected,
    allReady,
    canStart: players.length >= MIN_PLAYERS && players.length <= MAX_PLAYERS && allConnected && allReady,
  };
}
