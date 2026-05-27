import { useCallback, useEffect, useState } from "react";
import type { Tournament } from "../lib/types";

export function useTournaments(onError?: (msg: string) => void) {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/tournaments");
      if (!r.ok) return;
      const data = (await r.json()) as { tournaments: Tournament[] };
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
    const onVis = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [refresh]);

  const replace = useCallback((updated: Tournament) => {
    setTournaments((prev) =>
      prev
        .map((t) => (t.id === updated.id ? updated : t))
        .sort((a, b) => a.windowStart.localeCompare(b.windowStart))
    );
  }, []);

  const closeout = useCallback(
    async (id: string, closedBy: string) => {
      const r = await fetch(`/api/tournaments/${id}/closeout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ closedBy }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        onError?.(data.error || "Couldn't close tournament");
        throw new Error(data.error || "closeout failed");
      }
      replace(data.tournament);
    },
    [onError, replace]
  );

  const reopen = useCallback(
    async (id: string) => {
      const r = await fetch(`/api/tournaments/${id}/reopen`, {
        method: "POST",
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        onError?.(data.error || "Couldn't reopen tournament");
        throw new Error(data.error || "reopen failed");
      }
      replace(data.tournament);
    },
    [onError, replace]
  );

  const patchPayout = useCallback(
    async (
      id: string,
      patch: { payoutConfirmed?: boolean; payoutPaid?: boolean; notes?: string | null }
    ) => {
      const r = await fetch(`/api/tournaments/${id}/payout`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        onError?.(data.error || "Couldn't update payout");
        throw new Error(data.error || "payout failed");
      }
      replace(data.tournament);
    },
    [onError, replace]
  );

  const patchDetails = useCallback(
    async (
      id: string,
      patch: {
        course?: string;
        windowStart?: string;
        windowEnd?: string;
        pointsToFirst?: number | null;
        payoutFirst?: number | null;
        payoutSecond?: number | null;
        payoutThird?: number | null;
        notes?: string | null;
      }
    ) => {
      const r = await fetch(`/api/tournaments/${id}/details`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        onError?.(data.error || "Couldn't update schedule");
        throw new Error(data.error || "schedule update failed");
      }
      replace(data.tournament);
    },
    [onError, replace]
  );

  return {
    tournaments,
    loaded,
    refresh,
    closeout,
    reopen,
    patchPayout,
    patchDetails,
  };
}
