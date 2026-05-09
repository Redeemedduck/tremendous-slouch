import { useCallback, useEffect, useMemo, useState } from "react";
import type { Player } from "../lib/types";

export function usePlayers(onError: (msg: string) => void) {
  const [players, setPlayers] = useState<Player[]>([]);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/players");
      if (!r.ok) return;
      const data = (await r.json()) as { players: Player[] };
      setPlayers(data.players);
    } catch {
      // silent on poll errors
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 60_000); // handicaps change rarely; poll once a minute
    return () => window.clearInterval(id);
  }, [refresh]);

  const upsert = useCallback(
    async (name: string, handicap: number | null) => {
      const r = await fetch(`/api/players/${encodeURIComponent(name)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handicap }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        onError(data.error || "Couldn't save handicap");
        throw new Error(data.error || "save failed");
      }
      setPlayers((prev) => {
        const others = prev.filter(
          (p) => p.name.toLowerCase() !== name.toLowerCase()
        );
        return [...others, data.player].sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
        );
      });
    },
    [onError]
  );

  // Map of lowercase name -> handicap for fast chip lookup.
  const handicapByName = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const p of players) m.set(p.name.toLowerCase(), p.handicap);
    return m;
  }, [players]);

  const getHandicap = useCallback(
    (name: string) => handicapByName.get(name.toLowerCase()) ?? null,
    [handicapByName]
  );

  return { players, upsert, getHandicap };
}
