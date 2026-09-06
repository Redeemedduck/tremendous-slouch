import { useCallback, useEffect, useState } from "react";
import type { Tournament } from "../lib/types";

export function useTournaments() {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/tournaments");
      if (!response.ok) return;
      const data = (await response.json()) as { tournaments: Tournament[] };
      setTournaments(data.tournaments);
      setLoaded(true);
    } catch {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    // Tournaments are seeded at startup and rarely change. Refresh once on
    // mount and on visibility change; no recurring poll.
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [refresh]);

  return { tournaments, loaded };
}
