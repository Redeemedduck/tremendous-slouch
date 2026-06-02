import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clipboard,
  ClipboardCheck,
  Save,
  Users,
} from "lucide-react";
import { formatHandicap } from "../lib/format";
import { parseHandicapIntake } from "../lib/bulkIntake";
import { buildHandicapAsk } from "../lib/requestCopy";
import { hasSourceBackedHandicap, missingSourceBackedHandicapPlayers } from "../lib/handicapEvidence";
import type { Player, TeeTime } from "../lib/types";

type CopyState = "idle" | "copied" | "blocked";

export function Roster({
  players,
  teeTimes,
  onUpdate,
  openSignal = 0,
}: {
  players: Player[];
  teeTimes: TeeTime[];
  onUpdate: (
    name: string,
    patch: {
      handicap?: number | null;
      handicapSource?: string | null;
      handicapNote?: string | null;
      ghinNumber?: string | null;
      handicapSourceType?: string | null;
      handicapVerifiedAt?: string | null;
      handicapVerifiedBy?: string | null;
      member?: boolean;
    }
  ) => void | Promise<void>;
  openSignal?: number;
}) {
  const [open, setOpen] = useState(false);
  const [handicapDrafts, setHandicapDrafts] = useState<Record<string, string>>(
    {}
  );
  const [ghinDrafts, setGhinDrafts] = useState<Record<string, string>>({});
  const [sourceDrafts, setSourceDrafts] = useState<Record<string, string>>({});
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [savingName, setSavingName] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [fallbackText, setFallbackText] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkStatus, setBulkStatus] = useState("");

  useEffect(() => {
    if (openSignal > 0) setOpen(true);
  }, [openSignal]);

  // Augment with anyone who's appeared in a claim/score/interest but isn't in
  // the players table yet (so the host can flag them as drop-in or member
  // without needing to wait for them to register a profile).
  const seenNames = useMemo(() => {
    const set = new Set<string>(players.map((p) => p.name));
    const lower = new Set(players.map((p) => p.name.toLowerCase()));
    for (const tt of teeTimes) {
      for (const c of tt.claims) {
        if (!lower.has(c.name.toLowerCase())) {
          set.add(c.name);
          lower.add(c.name.toLowerCase());
        }
      }
      for (const i of tt.interested) {
        if (!lower.has(i.name.toLowerCase())) {
          set.add(i.name);
          lower.add(i.name.toLowerCase());
        }
      }
    }
    return Array.from(set).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
  }, [players, teeTimes]);

  if (seenNames.length === 0) return null;

  const memberMap = new Map(
    players.map((p) => [p.name.toLowerCase(), p])
  );

  const memberCount = players.filter((p) => p.member).length;
  const dropInCount = players.filter((p) => !p.member && p.handicap != null)
    .length;
  const unknownCount = seenNames.length - players.length;
  const missingMemberHandicapPlayers = missingSourceBackedHandicapPlayers(players);
  const missingMemberHandicaps = missingMemberHandicapPlayers.length;
  const handicapAsk = buildHandicapAsk(players);
  const bulkMatches = useMemo(
    () => parseHandicapIntake(bulkText, players),
    [bulkText, players]
  );

  const hcpDraftFor = (name: string, player?: Player) =>
    handicapDrafts[name.toLowerCase()] ??
    (player?.handicap == null ? "" : String(player.handicap));
  const ghinDraftFor = (name: string, player?: Player) =>
    ghinDrafts[name.toLowerCase()] ?? player?.ghinNumber ?? "";
  const sourceDraftFor = (name: string, player?: Player) =>
    sourceDrafts[name.toLowerCase()] ?? player?.handicapSource ?? "";
  const noteDraftFor = (name: string, player?: Player) =>
    noteDrafts[name.toLowerCase()] ?? player?.handicapNote ?? "";

  const saveHandicap = async (name: string, player?: Player) => {
    const draft = hcpDraftFor(name, player).trim();
    if (draft !== "" && !Number.isFinite(Number(draft))) return;
    const handicap = draft === "" ? null : Number(draft);
    const ghinNumber = ghinDraftFor(name, player).trim();
    const sourceDraft = sourceDraftFor(name, player).trim();
    const noteDraft = noteDraftFor(name, player).trim();
    const inferredSource = sourceDraft || "Commissioner provisional estimate";
    setSavingName(name);
    try {
      await onUpdate(name, {
        handicap,
        ghinNumber: ghinNumber || null,
        handicapSource: handicap == null ? null : inferredSource,
        handicapNote:
          handicap == null
            ? null
            : noteDraft || (sourceDraft ? null : "Replace with GHIN/player reply."),
        handicapSourceType:
          handicap == null
            ? null
            : /\b(ghin|cga|usga)\b/i.test(sourceDraft)
              ? "ghin"
              : sourceDraft
                ? "player_reply"
                : "unknown",
        handicapVerifiedBy: handicap == null || !sourceDraft ? null : "Commissioner",
      });
      setHandicapDrafts((prev) => {
        const next = { ...prev };
        delete next[name.toLowerCase()];
        return next;
      });
      setGhinDrafts((prev) => {
        const next = { ...prev };
        delete next[name.toLowerCase()];
        return next;
      });
      setSourceDrafts((prev) => {
        const next = { ...prev };
        delete next[name.toLowerCase()];
        return next;
      });
      setNoteDrafts((prev) => {
        const next = { ...prev };
        delete next[name.toLowerCase()];
        return next;
      });
    } finally {
      setSavingName(null);
    }
  };

  const copyHandicapAsk = async () => {
    setFallbackText("");
    try {
      await navigator.clipboard.writeText(handicapAsk);
      setCopyState("copied");
    } catch {
      setFallbackText(handicapAsk);
      setCopyState("blocked");
    }
  };
  const applyBulkHandicaps = async () => {
    if (bulkMatches.length === 0) return;
    setBulkSaving(true);
    setBulkStatus("");
    try {
      for (const match of bulkMatches) {
        await onUpdate(match.name, {
          handicap: match.handicap,
          ghinNumber: match.ghinNumber,
          handicapSource: match.source,
          handicapNote: match.source,
          handicapSourceType: /\b(ghin|cga|usga)\b/i.test(match.source)
            ? "ghin"
            : "player_reply",
          handicapVerifiedBy: "Commissioner",
        });
      }
      setBulkStatus(
        `Applied ${bulkMatches.length} GHIN index${
          bulkMatches.length === 1 ? "" : "es"
        }.`
      );
      setBulkText("");
    } finally {
      setBulkSaving(false);
    }
  };

  return (
    <section className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-stone-200 hover:bg-stone-50"
      >
        <span className="flex items-center gap-2">
          <Users className="h-4 w-4 text-fairway-700" />
          <span className="text-base font-semibold text-stone-900">Roster</span>
          <span className="text-xs text-stone-500">
            <span className="font-medium text-stone-700">{memberCount}</span>{" "}
            member{memberCount === 1 ? "" : "s"}
            {dropInCount > 0 && (
              <span className="ml-2">
                · <span className="text-amber-700">{dropInCount}</span> guest
                {dropInCount === 1 ? "" : "s"}
              </span>
            )}
            {unknownCount > 0 && (
              <span className="ml-2 text-stone-400">
                · {unknownCount} unflagged
              </span>
            )}
            {missingMemberHandicaps > 0 && (
              <span className="ml-2 text-amber-700">
                · {missingMemberHandicaps} hcp missing
              </span>
            )}
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 text-stone-500 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div className="mt-2 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-stone-200">
          {missingMemberHandicaps > 0 && (
            <div className="mb-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0">
                  Handicap records missing/unverified:{" "}
                  {missingMemberHandicapPlayers
                    .map((p) => p.name)
                    .slice(0, 4)
                    .join(", ")}
                  {missingMemberHandicaps > 4
                    ? ` + ${missingMemberHandicaps - 4} more`
                    : ""}
                </p>
                <button
                  type="button"
                  onClick={copyHandicapAsk}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-amber-900 ring-1 ring-amber-200 hover:bg-white"
                >
                  {copyState === "copied" ? (
                    <ClipboardCheck className="h-3.5 w-3.5" />
                  ) : (
                    <Clipboard className="h-3.5 w-3.5" />
                  )}
                  {copyState === "copied" ? "Copied" : "Copy records"}
                </button>
              </div>
              {copyState === "blocked" && (
                <textarea
                  readOnly
                  value={fallbackText}
                  aria-label="Handicap ask text"
                  className="mt-2 h-24 w-full resize-none rounded-lg border border-amber-200 bg-white px-2 py-1.5 text-xs text-stone-900"
                  onFocus={(event) => event.currentTarget.select()}
                />
              )}
              <div className="mt-2 rounded-lg bg-white/70 p-2 ring-1 ring-amber-100">
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-amber-900">
                  Paste handicap evidence
                  <textarea
                    value={bulkText}
                    onChange={(event) => {
                      setBulkText(event.target.value);
                      setBulkStatus("");
                    }}
                    placeholder="Beck 8.2&#10;Chris GHIN 11.4"
                    rows={3}
                    className="mt-1 w-full resize-none rounded-lg border border-amber-200 bg-white px-2 py-1.5 text-xs normal-case tracking-normal text-stone-900 placeholder:text-stone-300 focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
                  />
                </label>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="min-w-0 text-[11px] text-amber-800">
                    {bulkMatches.length > 0
                      ? `${bulkMatches.length} matched: ${bulkMatches
                          .map((match) => match.name)
                          .join(", ")}`
                      : bulkText.trim()
                        ? "No known member indexes found yet."
                        : "Matches known member names only."}
                  </span>
                  <button
                    type="button"
                    disabled={bulkMatches.length === 0 || bulkSaving}
                    onClick={applyBulkHandicaps}
                    className="shrink-0 rounded-full bg-fairway-700 px-3 py-1 text-[11px] font-semibold text-white hover:bg-fairway-800 disabled:bg-stone-100 disabled:text-stone-400"
                  >
                    {bulkSaving
                      ? "Applying"
                      : `Apply ${bulkMatches.length || ""}`.trim()}
                  </button>
                </div>
                {bulkStatus && (
                  <p className="mt-1 text-[11px] font-medium text-fairway-800">
                    {bulkStatus}
                  </p>
                )}
              </div>
            </div>
          )}
          <ul className="divide-y divide-stone-100">
            {seenNames.map((name) => {
              const p = memberMap.get(name.toLowerCase());
              const draft = hcpDraftFor(name, p);
              const ghinDraft = ghinDraftFor(name, p);
              const sourceDraft = sourceDraftFor(name, p);
              const noteDraft = noteDraftFor(name, p);
              const savedDraft = p?.handicap == null ? "" : String(p.handicap);
              const savedGhin = p?.ghinNumber ?? "";
              const trimmedDraft = draft.trim();
              const trimmedGhinDraft = ghinDraft.trim();
              const trimmedSourceDraft = sourceDraft.trim();
              const trimmedNoteDraft = noteDraft.trim();
              const validHandicapDraft =
                trimmedDraft === "" || Number.isFinite(Number(trimmedDraft));
              const hasSource = true;
              const savedSource = p?.handicapSource ?? "";
              const savedNote = p?.handicapNote ?? "";
              const dirty =
                trimmedDraft !== savedDraft ||
                trimmedGhinDraft !== savedGhin ||
                trimmedSourceDraft !== savedSource ||
                trimmedNoteDraft !== savedNote;
              const member = p?.member ?? false;
              const hasVerifiedHandicap = p ? hasSourceBackedHandicap(p) : false;
              return (
                <li
                  key={name}
                  className="py-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="font-medium text-stone-900">{name}</span>
                      {p?.handicap != null && (
                        <span className="text-xs text-stone-400">
                          {formatHandicap(p.handicap)}
                        </span>
                      )}
                      {member && !hasVerifiedHandicap && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                          <AlertTriangle className="h-3 w-3" />
                          {p?.handicap == null ? "hcp" : "unverified"}
                        </span>
                      )}
                      {!p && (
                        <span className="text-[10px] uppercase tracking-wide text-stone-400">
                          no profile
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => onUpdate(name, { member: !member })}
                      className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        member
                          ? "bg-fairway-100 text-fairway-900 hover:bg-fairway-200"
                          : "bg-amber-50 text-amber-700 hover:bg-amber-100"
                      }`}
                    >
                      {member ? "Member" : "Guest"}
                    </button>
                  </div>
                  {p?.handicapSource && (
                    <p className="mt-1 text-[11px] text-stone-500">
                      {p.handicapSourceType ? `${p.handicapSourceType}: ` : ""}
                      {p.handicapSource}
                      {p.handicapVerifiedAt && (
                        <span>
                          {" "}
                          · verified {p.handicapVerifiedAt.slice(0, 10)}
                          {p.handicapVerifiedBy
                            ? ` by ${p.handicapVerifiedBy}`
                            : ""}
                        </span>
                      )}
                    </p>
                  )}
                  {p?.handicapNote && (
                    <p className="mt-1 text-[11px] text-stone-500">
                      Note: {p.handicapNote}
                    </p>
                  )}
                  {p?.handicap != null && !p.handicapVerifiedAt && (
                    <p className="mt-1 text-[11px] font-medium text-amber-700">
                      Unverified handicap entry
                    </p>
                  )}
                  <div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.5rem] gap-2">
                    <label className="min-w-0 flex-1 text-[11px] font-medium text-stone-500">
                      GHIN #
                      <input
                        inputMode="numeric"
                        value={ghinDraft}
                        placeholder="Optional"
                        onChange={(event) =>
                          setGhinDrafts((prev) => ({
                            ...prev,
                            [name.toLowerCase()]: event.target.value,
                          }))
                        }
                        onBlur={() => {
                          if (!dirty || !validHandicapDraft || !hasSource) return;
                          saveHandicap(name, p);
                        }}
                        className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-300 focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
                      />
                    </label>
                    <label className="min-w-0 flex-1 text-[11px] font-medium text-stone-500">
                      H.I.
                      <input
                        inputMode="decimal"
                        value={draft}
                        placeholder="None"
                        onChange={(event) =>
                          setHandicapDrafts((prev) => ({
                            ...prev,
                            [name.toLowerCase()]: event.target.value,
                          }))
                        }
                        onBlur={() => {
                          if (trimmedDraft === savedDraft) return;
                          if (!validHandicapDraft) {
                            return;
                          }
                          saveHandicap(name, p);
                        }}
                        aria-invalid={!validHandicapDraft}
                        className={`mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-300 focus:outline-none focus:ring-2 ${
                          validHandicapDraft
                            ? "border-stone-200 focus:border-fairway-600 focus:ring-fairway-100"
                            : "border-red-300 focus:border-red-500 focus:ring-red-100"
                        }`}
                      />
                      {!validHandicapDraft && (
                        <span className="mt-1 block text-[10px] font-semibold uppercase tracking-wide text-red-700">
                          number only
                        </span>
                      )}
                    </label>
                    <label className="col-span-2 min-w-0 text-[11px] font-medium text-stone-500">
                      Source
                      <input
                        value={sourceDraft}
                        placeholder="Optional"
                        onChange={(event) =>
                          setSourceDrafts((prev) => ({
                            ...prev,
                            [name.toLowerCase()]: event.target.value,
                          }))
                        }
                        onBlur={() => {
                          if (!dirty || !validHandicapDraft || !hasSource) return;
                          saveHandicap(name, p);
                        }}
                        className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-300 focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
                      />
                    </label>
                    <label className="col-span-2 min-w-0 text-[11px] font-medium text-stone-500">
                      Note
                      <input
                        value={noteDraft}
                        placeholder="Optional verification context"
                        onChange={(event) =>
                          setNoteDrafts((prev) => ({
                            ...prev,
                            [name.toLowerCase()]: event.target.value,
                          }))
                        }
                        onBlur={() => {
                          if (!dirty || !validHandicapDraft || !hasSource) return;
                          saveHandicap(name, p);
                        }}
                        className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-300 focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
                      />
                    </label>
                    <button
                      type="button"
                      disabled={
                        !dirty ||
                        !validHandicapDraft ||
                        savingName === name
                      }
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => saveHandicap(name, p)}
                      className="mt-5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-fairway-700 text-white hover:bg-fairway-800 disabled:bg-stone-100 disabled:text-stone-400"
                      aria-label={`Save ${name} handicap`}
                    >
                      {dirty ? (
                        <Save className="h-4 w-4" />
                      ) : (
                        <Check className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[11px] text-stone-400">
            Tap to toggle. Members count toward the season; guests are drop-in
            players (a member's friend who buys into a single tournament).
          </p>
        </div>
      )}
    </section>
  );
}
