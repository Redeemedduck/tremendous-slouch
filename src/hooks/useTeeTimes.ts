import { useCallback, useEffect, useState } from "react";
import type { NewTeeTimeInput, TeeTime } from "../lib/types";

export function useTeeTimes(onError: (msg: string) => void) {
  const [teeTimes, setTeeTimes] = useState<TeeTime[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/teetimes");
      if (!r.ok) throw new Error("Failed to load tee times");
      const data = (await r.json()) as { teeTimes: TeeTime[] };
      setTeeTimes(data.teeTimes);
      setLoaded(true);
    } catch {
      // silent on poll errors; surface only on manual actions
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 20_000);
    const onVis = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refresh]);

  const replace = useCallback((updated: TeeTime) => {
    setTeeTimes((prev) => {
      const next = prev.filter((t) => t.id !== updated.id);
      next.push(updated);
      next.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return a.time.localeCompare(b.time);
      });
      return next;
    });
  }, []);

  const create = useCallback(
    async (input: NewTeeTimeInput) => {
      const r = await fetch("/api/teetimes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        onError(data.error || "Couldn't create tee time");
        throw new Error(data.error || "create failed");
      }
      replace(data.teeTime);
    },
    [onError, replace]
  );

  const update = useCallback(
    async (id: string, input: NewTeeTimeInput) => {
      const r = await fetch(`/api/teetimes/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        onError(data.error || "Couldn't update tee time");
        throw new Error(data.error || "update failed");
      }
      replace(data.teeTime);
    },
    [onError, replace]
  );

  const claim = useCallback(
    async (id: string, name: string) => {
      const r = await fetch(`/api/teetimes/${id}/claims`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        onError(data.error || "Couldn't claim spot");
        return;
      }
      replace(data.teeTime);
    },
    [onError, replace]
  );

  const drop = useCallback(
    async (id: string, name: string) => {
      const r = await fetch(
        `/api/teetimes/${id}/claims/${encodeURIComponent(name)}`,
        { method: "DELETE" }
      );
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        onError(data.error || "Couldn't drop spot");
        return;
      }
      replace(data.teeTime);
    },
    [onError, replace]
  );

  const markInterested = useCallback(
    async (id: string, name: string) => {
      const r = await fetch(`/api/teetimes/${id}/interested`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        onError(data.error || "Couldn't mark maybe");
        return;
      }
      replace(data.teeTime);
    },
    [onError, replace]
  );

  const dropInterest = useCallback(
    async (id: string, name: string) => {
      const r = await fetch(
        `/api/teetimes/${id}/interested/${encodeURIComponent(name)}`,
        { method: "DELETE" }
      );
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        onError(data.error || "Couldn't drop maybe");
        return;
      }
      replace(data.teeTime);
    },
    [onError, replace]
  );

  const remove = useCallback(
    async (id: string) => {
      const r = await fetch(`/api/teetimes/${id}`, { method: "DELETE" });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        onError(data.error || "Couldn't delete tee time");
        return;
      }
      setTeeTimes((prev) => prev.filter((t) => t.id !== id));
    },
    [onError]
  );

  const recordScore = useCallback(
    async (
      id: string,
      name: string,
      gross: number,
      courseHcp: number | null
    ) => {
      const r = await fetch(`/api/teetimes/${id}/scores`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, gross, courseHcp }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        onError(data.error || "Couldn't record score");
        throw new Error(data.error || "score failed");
      }
      replace(data.teeTime);
    },
    [onError, replace]
  );

  const removeScore = useCallback(
    async (id: string, name: string) => {
      const r = await fetch(
        `/api/teetimes/${id}/scores/${encodeURIComponent(name)}`,
        { method: "DELETE" }
      );
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        onError(data.error || "Couldn't remove score");
        return;
      }
      replace(data.teeTime);
    },
    [onError, replace]
  );

  return {
    teeTimes,
    loaded,
    create,
    update,
    claim,
    drop,
    markInterested,
    dropInterest,
    recordScore,
    removeScore,
    remove,
  };
}
