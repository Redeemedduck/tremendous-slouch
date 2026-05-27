import { useCallback, useEffect, useState } from "react";
import type { Buyin } from "../lib/types";

export function useBuyins(onError: (msg: string) => void, enabled = true) {
  const [buyins, setBuyins] = useState<Buyin[]>([]);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setBuyins([]);
      return;
    }
    try {
      const r = await fetch("/api/buyins");
      if (!r.ok) return;
      const data = (await r.json()) as { buyins: Buyin[] };
      setBuyins(data.buyins);
    } catch {
      // silent on poll errors
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setBuyins([]);
      return;
    }
    refresh();
    // Buy-ins change rarely; refresh on visibility change but no recurring
    // poll.
    const onVis = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [enabled, refresh]);

  const patch = useCallback(
    async (
      name: string,
      change: {
        amount?: number;
        paid?: boolean;
        paymentStatus?: Buyin["paymentStatus"];
        paymentMethod?: string | null;
        paymentActor?: string | null;
        paidAt?: string | null;
        notes?: string | null;
      }
    ) => {
      if (!enabled) return;
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
    [enabled, onError]
  );

  return { buyins, patch, refresh };
}
