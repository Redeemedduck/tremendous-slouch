import type { Player } from "./types";

export function hasSourceBackedHandicap(player: Player) {
  if (player.handicap == null) return false;
  if (!player.handicapVerifiedAt || !player.handicapVerifiedBy) return false;
  return Boolean(player.ghinNumber || player.handicapSource || player.handicapNote);
}

export function missingSourceBackedHandicapPlayers(players: Player[]) {
  return players.filter(
    (player) => player.member && !hasSourceBackedHandicap(player)
  );
}
