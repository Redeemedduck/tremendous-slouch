import { useCallback, useEffect, useState } from "react";
import type { NewPollInput, Poll } from "../lib/types";

export function usePolls(onError: (msg: string) => void) {
  const [polls, setPolls] = useState<Poll[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/polls");
      if (!r.ok) throw new Error("Failed to load polls");
      const data = (await r.json()) as { polls: Poll[] };
      setPolls(data.polls);
      setLoaded(true);
    } catch {
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

  // Update in place — a vote must not teleport the poll to the top of the
  // list under the voter's finger. Only genuinely new polls go first.
  const replace = useCallback((updated: Poll) => {
    setPolls((prev) => {
      const idx = prev.findIndex((p) => p.id === updated.id);
      if (idx === -1) return [updated, ...prev];
      const next = [...prev];
      next[idx] = updated;
      return next;
    });
  }, []);

  const create = useCallback(
    async (input: NewPollInput) => {
      const r = await fetch("/api/polls", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        onError(data.error || "Couldn't create poll");
        throw new Error(data.error || "create failed");
      }
      replace(data.poll);
    },
    [onError, replace]
  );

  const toggleResponse = useCallback(
    async (pollId: string, name: string, optionIdx: number) => {
      const r = await fetch(`/api/polls/${pollId}/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, optionIdx }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        onError(data.error || "Couldn't record response");
        return;
      }
      replace(data.poll);
    },
    [onError, replace]
  );

  const remove = useCallback(
    async (id: string) => {
      const r = await fetch(`/api/polls/${id}`, { method: "DELETE" });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        onError(data.error || "Couldn't delete poll");
        return;
      }
      setPolls((prev) => prev.filter((p) => p.id !== id));
    },
    [onError]
  );

  return { polls, loaded, create, toggleResponse, remove };
}
