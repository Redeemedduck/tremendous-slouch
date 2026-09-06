import React, { useEffect, useState } from "react";
import type { TeeTime } from "../lib/types";
import { formatDateLabel, formatTimeLabel } from "../lib/format";
import { FormError, SubmitButton, inputClass } from "./ui/Field";
import { Sheet } from "./ui/Sheet";

type Draft = { gross: string; courseHcp: string; attestedBy: string };

export function ScoresSheet({
  open,
  onClose,
  teeTime,
  onRecord,
  onRemove,
  isLeagueRound,
  isMember,
}: {
  open: boolean;
  onClose: () => void;
  teeTime: TeeTime | null;
  onRecord: (
    name: string,
    gross: number,
    courseHcp: number | null,
    attestedBy: string | null
  ) => Promise<void>;
  /** Remove a player's recorded score outright (a wrong entry shouldn't
   *  have to be overwritten with another guess). */
  onRemove?: (name: string) => Promise<void>;
  /** True when this tee time falls inside a tournament window — course
   *  handicap and attestation are required so net math is correct and the
   *  league rule is honored. */
  isLeagueRound: boolean;
  /** Whether a given name is a registered league member. Used to scope the
   *  attester dropdown to other-members-only on the same tee time. */
  isMember: (name: string) => boolean;
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Two-tap arm for score removal, keyed by player name.
  const [removeArmed, setRemoveArmed] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !teeTime) return;
    // Prefill from existing scores so edits are easy. When a player has
    // exactly one eligible attester (the common foursome case), pre-select
    // them instead of making everyone open four dropdowns.
    const prefill: Record<string, Draft> = {};
    for (const c of teeTime.claims) {
      const s = teeTime.scores.find(
        (x) => x.name.toLowerCase() === c.name.toLowerCase()
      );
      const eligible = teeTime.claims.filter(
        (other) => other.name !== c.name && isMember(other.name)
      );
      prefill[c.name] = {
        gross: s ? String(s.gross) : "",
        courseHcp: s?.courseHcp != null ? String(s.courseHcp) : "",
        attestedBy:
          s?.attestedBy ??
          (isLeagueRound && eligible.length === 1 ? eligible[0].name : ""),
      };
    }
    setDrafts(prefill);
    setError(null);
    setRemoveArmed(null);
  }, [open, teeTime, isMember, isLeagueRound]);

  if (!open || !teeTime) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const tasks: {
      name: string;
      gross: number;
      courseHcp: number | null;
      attestedBy: string | null;
    }[] = [];
    for (const [name, raw] of Object.entries(drafts)) {
      const grossStr = raw.gross.trim();
      const hcpStr = raw.courseHcp.trim();
      const attestedBy = raw.attestedBy.trim();
      if (!grossStr && !hcpStr && !attestedBy) continue;
      if (!grossStr) {
        setError(`${name}: score is required`);
        return;
      }
      const v = Number(grossStr);
      if (!Number.isInteger(v) || v < 1 || v > 300) {
        setError(`${name}: score must be a whole number between 1 and 300`);
        return;
      }
      let courseHcp: number | null = null;
      if (hcpStr) {
        const h = Number(hcpStr);
        if (!Number.isInteger(h) || h < -10 || h > 54) {
          setError(
            `${name}: course handicap must be a whole number between -10 and 54`
          );
          return;
        }
        courseHcp = h;
      } else if (isLeagueRound) {
        setError(`${name}: league rounds need a course handicap (from GHIN)`);
        return;
      }
      if (isLeagueRound && !attestedBy) {
        setError(`${name}: league rounds need an attester (another member)`);
        return;
      }
      tasks.push({
        name,
        gross: v,
        courseHcp,
        attestedBy: attestedBy || null,
      });
    }
    if (tasks.length === 0) {
      setError("Enter at least one score");
      return;
    }
    setSubmitting(true);
    try {
      for (const task of tasks) {
        await onRecord(task.name, task.gross, task.courseHcp, task.attestedBy);
      }
      onClose();
    } catch (err: any) {
      setError(err?.message || "Couldn't save scores");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Record scores"
      subtitle={`${teeTime.course} · ${formatDateLabel(teeTime.date)} · ${formatTimeLabel(teeTime.time)}`}
    >
      <form onSubmit={submit} className="space-y-3">
        {teeTime.claims.length === 0 ? (
          <p className="rounded-xl bg-stone-50 px-3 py-2 text-sm text-stone-500">
            No one was claimed for this round.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-[1fr_5rem_5rem] items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400">
              <span>Player</span>
              <span className="text-right">Gross</span>
              <span className="text-right">Course HCP</span>
            </div>
            {teeTime.claims.map((c) => {
              const draft =
                drafts[c.name] ?? { gross: "", courseHcp: "", attestedBy: "" };
              // Attester options: other claimers who are registered members.
              const attesters = teeTime.claims
                .filter(
                  (other) => other.name !== c.name && isMember(other.name)
                )
                .map((other) => other.name);
              const recorded = teeTime.scores.some(
                (x) => x.name.toLowerCase() === c.name.toLowerCase()
              );
              return (
                <div key={c.name} className="space-y-2">
                  <div className="grid grid-cols-[1fr_5rem_5rem] items-center gap-2">
                    <div className="min-w-0">
                      <label className="block text-sm font-medium text-stone-900">
                        {c.name}
                      </label>
                      {recorded && onRemove && (
                        <button
                          type="button"
                          onClick={async () => {
                            if (removeArmed !== c.name) {
                              setRemoveArmed(c.name);
                              return;
                            }
                            setError(null);
                            try {
                              await onRemove(c.name);
                            } catch (err: any) {
                              setError(err?.message || "Couldn't remove score");
                            } finally {
                              setRemoveArmed(null);
                            }
                          }}
                          className={`-ml-1 mt-0.5 min-h-7 rounded-md px-1 text-[11px] font-semibold transition-colors ${
                            removeArmed === c.name
                              ? "bg-rose-600 text-white"
                              : "text-rose-600 hover:bg-rose-50"
                          }`}
                        >
                          {removeArmed === c.name
                            ? "Tap again to remove"
                            : "Remove score"}
                        </button>
                      )}
                    </div>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={draft.gross}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [c.name]: { ...draft, gross: e.target.value },
                        }))
                      }
                      step={1}
                      min={1}
                      max={300}
                      placeholder="-"
                      aria-label={`${c.name} gross score`}
                      className={inputClass}
                    />
                    <input
                      type="number"
                      inputMode="numeric"
                      value={draft.courseHcp}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [c.name]: { ...draft, courseHcp: e.target.value },
                        }))
                      }
                      step={1}
                      min={-10}
                      max={54}
                      placeholder={isLeagueRound ? "req" : "-"}
                      aria-label={`${c.name} course handicap`}
                      className={inputClass}
                    />
                  </div>
                  {isLeagueRound && (
                    <div>
                      {attesters.length > 0 ? (
                        <select
                          value={draft.attestedBy}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [c.name]: {
                                ...draft,
                                attestedBy: e.target.value,
                              },
                            }))
                          }
                          aria-label={`${c.name} attested by`}
                          className={inputClass}
                        >
                          <option value="">Attested by…</option>
                          {attesters.map((a) => (
                            <option key={a} value={a}>
                              {a}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          No other members on this tee time — score can't be
                          attested.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {isLeagueRound && (
              <p className="text-xs text-stone-500">
                League round — each player needs a course handicap (from GHIN)
                and an attester (another member who played in your group).
              </p>
            )}
          </>
        )}

        <FormError>{error}</FormError>

        <SubmitButton disabled={submitting || teeTime.claims.length === 0}>
          {submitting ? "Saving…" : "Save scores"}
        </SubmitButton>
      </form>
    </Sheet>
  );
}
