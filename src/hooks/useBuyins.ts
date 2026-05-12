import { useCallback, useEffect, useState } from "react";
import type { Buyin } from "../lib/types";

export function useBuyins(onError: (msg: string) => void) {
  const [buyins, setBuyins] = useState<Buyin[]>([]);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/buyins");
      if (!r.ok) return;
      const data = (await r.json()) as { buyins: Buyin[] };
      setBuyins(data.buyins);
    } catch {
      // silent on poll errors
    }
  }, []);

  useEffect(() => {
    refresh();
    // Buy-ins change rarely; refresh on visibility change but no recurring
    // poll.
    const onVis = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [refresh]);

  const patch = useCallback(
    async (
      name: string,
      change: { amount?: number; paid?: boolean; notes?: string | null }
    ) => {
      const r = await fetch(`/api/buyins/${encodeURIComponent(name)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(change),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        onError(data.error || "Couldn't update buy-in");
        return;
      }
      setBuyins((prev) => {
        const others = prev.filter(
          (b) => b.playerName.toLowerCase() !== name.toLowerCase()
        );
        return [...others, data.buyin].sort((a, b) =>
          a.playerName.localeCompare(b.playerName, undefined, {
            sensitivity: "base",
          })
        );
      });
    },
    [onError]
  );

  return { buyins, patch, refresh };
}
