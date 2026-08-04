import { useState } from "react";
import {
  Clock,
  MoreHorizontal,
  Trash2,
  CalendarPlus,
  Pencil,
  ClipboardList,
} from "lucide-react";
import { downloadIcs } from "../lib/calendar";
import {
  dateTileParts,
  eqName,
  formatHandicap,
  formatTimeLabel,
} from "../lib/format";
import type { TeeTime } from "../lib/types";
import { Comments } from "./Comments";
import { PlayerChip } from "./PlayerChip";
import { SpotsIndicator } from "./SpotsIndicator";

export function TeeTimeCard({
  teeTime,
  myName,
  readOnly,
  onClaim,
  onDrop,
  onMaybe,
  onDropMaybe,
  onDelete,
  onEdit,
  onRecordScores,
  onPostComment,
  onDeleteComment,
  getHandicap,
  isMember,
}: {
  teeTime: TeeTime;
  myName: string;
  readOnly: boolean;
  onClaim: () => void | Promise<unknown>;
  onDrop: (name: string) => void;
  onMaybe: () => void | Promise<unknown>;
  onDropMaybe: (name: string) => void;
  onDelete: () => void;
  onEdit: () => void;
  onRecordScores: () => void;
  onPostComment: (body: string) => void | Promise<void>;
  onDeleteComment: (commentId: string) => void | Promise<void>;
  getHandicap: (name: string) => number | null;
  isMember: (name: string) => boolean;
}) {
  const isDropInChip = (n: string) => !isMember(n);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [pending, setPending] = useState<"claim" | "maybe" | null>(null);
  const meIn = !!myName && teeTime.claims.some((c) => eqName(c.name, myName));
  const meMaybe =
    !!myName && teeTime.interested.some((i) => eqName(i.name, myName));
  const isHost = !!myName && eqName(teeTime.host, myName);
  const full = teeTime.claims.length >= teeTime.spots;
  const tile = dateTileParts(teeTime.date);

  const closeMenu = () => {
    setMenuOpen(false);
    setDeleteArmed(false);
  };

  const run = async (kind: "claim" | "maybe", fn: () => void | Promise<unknown>) => {
    setPending(kind);
    try {
      await fn();
    } finally {
      setPending(null);
    }
  };

  return (
    <article
      className={`relative rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200 ${
        readOnly ? "opacity-75" : ""
      }`}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <div
            aria-hidden
            className={`flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl shadow-sm ${
              readOnly
                ? "bg-stone-100 ring-1 ring-stone-200"
                : "bg-fairway-800 ring-1 ring-fairway-900/20"
            }`}
          >
            <span
              className={`text-[9px] font-bold uppercase leading-none tracking-[0.14em] ${
                readOnly ? "text-stone-500" : "text-gold-300"
              }`}
            >
              {tile.month}
            </span>
            <span
              className={`mt-0.5 text-lg font-bold leading-none tabular-nums ${
                readOnly ? "text-stone-700" : "text-white"
              }`}
            >
              {tile.day}
            </span>
          </div>
          <div className="min-w-0">
            <h2 className="truncate font-display text-xl font-bold leading-tight text-stone-950">
              {teeTime.course}
            </h2>
            {/* The host is already tagged on their player chip below, so the
                meta line stays short enough to never truncate. */}
            <p className="mt-0.5 flex items-center gap-1.5 text-xs font-medium text-stone-500">
              <span className="whitespace-nowrap">{tile.weekday}</span>
              <span className="text-stone-300">·</span>
              <Clock className="h-3 w-3 shrink-0" />
              <span className="whitespace-nowrap">
                {formatTimeLabel(teeTime.time)}
              </span>
            </p>
          </div>
        </div>
        {isHost && (
          <div className="relative shrink-0">
            <button
              type="button"
              aria-label="Host options"
              onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
              className="flex h-10 w-10 items-center justify-center rounded-full text-stone-500 transition-colors hover:bg-stone-100"
            >
              <MoreHorizontal className="h-5 w-5" />
            </button>
            {menuOpen && (
              <>
                <button
                  type="button"
                  aria-label="Close menu"
                  onClick={closeMenu}
                  className="fixed inset-0 z-10 cursor-default"
                />
                <div className="absolute right-0 top-8 z-20 w-48 rounded-xl bg-white p-1 shadow-lg ring-1 ring-stone-200">
                  {readOnly ? (
                    <button
                      type="button"
                      onClick={() => {
                        closeMenu();
                        onRecordScores();
                      }}
                      className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-stone-700 hover:bg-stone-100"
                    >
                      <ClipboardList className="h-4 w-4" />
                      {teeTime.scores.length > 0 ? "Edit scores" : "Record scores"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        closeMenu();
                        onEdit();
                      }}
                      className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-stone-700 hover:bg-stone-100"
                    >
                      <Pencil className="h-4 w-4" /> Edit tee time
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (!deleteArmed) {
                        setDeleteArmed(true);
                        return;
                      }
                      closeMenu();
                      onDelete();
                    }}
                    className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                      deleteArmed
                        ? "bg-rose-600 font-semibold text-white"
                        : "text-rose-600 hover:bg-rose-50"
                    }`}
                  >
                    <Trash2 className="h-4 w-4" />
                    {deleteArmed ? "Tap again to delete" : "Delete tee time"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {teeTime.notes && (
        <p className="mb-3 rounded-xl bg-stone-50 px-3 py-2 text-sm text-stone-600">
          {teeTime.notes}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <SpotsIndicator
          filled={teeTime.claims.length}
          total={teeTime.spots}
          interested={teeTime.interested.length}
        />
        {!readOnly && (
          <button
            type="button"
            onClick={() => downloadIcs(teeTime)}
            className="-my-2 -mr-2 inline-flex shrink-0 items-center gap-1 whitespace-nowrap px-2 py-2.5 text-xs font-semibold text-fairway-700 transition-colors hover:text-fairway-900"
          >
            <CalendarPlus className="h-3.5 w-3.5" /> Add to calendar
          </button>
        )}
      </div>

      {teeTime.claims.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {teeTime.claims.map((c) => (
            <PlayerChip
              key={c.name}
              name={c.name}
              isHost={eqName(c.name, teeTime.host)}
              isMe={!!myName && eqName(c.name, myName)}
              handicap={getHandicap(c.name)}
              isDropIn={isDropInChip(c.name)}
              onDrop={
                // Dropping is reversible (tap Claim again) — no confirm.
                !readOnly && !!myName && eqName(c.name, myName)
                  ? () => onDrop(c.name)
                  : undefined
              }
            />
          ))}
        </div>
      )}

      {teeTime.interested.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-stone-500">
            Maybe
          </span>
          {teeTime.interested.map((i) => (
            <PlayerChip
              key={i.name}
              name={i.name}
              variant="interested"
              isHost={false}
              isMe={!!myName && eqName(i.name, myName)}
              handicap={getHandicap(i.name)}
              isDropIn={isDropInChip(i.name)}
              onDrop={
                !readOnly && !!myName && eqName(i.name, myName)
                  ? () => onDropMaybe(i.name)
                  : undefined
              }
            />
          ))}
        </div>
      )}

      {teeTime.scores.length > 0 && (
        <div className="mt-3 rounded-xl border border-cream-200 bg-cream-50 p-3">
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-cream-700">
            Scores
          </div>
          <ul className="space-y-1">
            {[...teeTime.scores]
              .sort((a, b) => {
                const ha = a.courseHcp ?? getHandicap(a.name);
                const hb = b.courseHcp ?? getHandicap(b.name);
                const na = ha != null ? a.gross - ha : a.gross;
                const nb = hb != null ? b.gross - hb : b.gross;
                return na - nb;
              })
              .map((s) => {
                // Course handicap from this round wins over the GHIN index
                // for net math (the league rule).
                const usedHcp = s.courseHcp ?? getHandicap(s.name);
                const fromCourse = s.courseHcp != null;
                const net = usedHcp != null ? s.gross - usedHcp : null;
                return (
                  <li
                    key={s.name}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-stone-700">
                      <span className="font-medium">{s.name}</span>
                      {usedHcp != null && (
                        <span className="ml-1.5 text-xs text-stone-500">
                          {fromCourse ? `CH ${usedHcp}` : formatHandicap(usedHcp)}
                        </span>
                      )}
                      {s.attestedBy && (
                        <span className="ml-1.5 text-[10px] text-stone-500">
                          · att. {s.attestedBy}
                        </span>
                      )}
                    </span>
                    <span className="tabular-nums text-stone-700">
                      {s.gross}
                      {net != null && (
                        <span className="ml-2 text-xs font-semibold text-fairway-700">
                          net {fromCourse ? net : (Math.round(net * 10) / 10).toFixed(1)}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
          </ul>
        </div>
      )}

      {!readOnly && !meIn && (
        <div className="mt-4 flex items-stretch gap-2">
          <button
            type="button"
            onClick={() => run("claim", onClaim)}
            disabled={full || pending !== null}
            className="flex-1 rounded-xl bg-fairway-800 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-fairway-700 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-500 disabled:shadow-none"
          >
            {full
              ? "Sheet's full"
              : pending === "claim"
                ? "Claiming…"
                : !myName
                  ? "Add your name first"
                  : "Claim a spot"}
          </button>
          {!meMaybe && myName && (
            <button
              type="button"
              onClick={() => run("maybe", onMaybe)}
              disabled={pending !== null}
              className="flex-1 rounded-xl border border-stone-300 bg-white py-2.5 text-sm font-semibold text-stone-700 transition-colors hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending === "maybe" ? "Saving…" : "Maybe"}
            </button>
          )}
        </div>
      )}

      {/* Anyone in the group can record or fix scores once the round is
          done — the server accepts any member, so don't hide this behind
          the host menu. */}
      {readOnly && !!myName && teeTime.claims.length > 0 && (
        <button
          type="button"
          onClick={onRecordScores}
          className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-fairway-200 bg-fairway-50 text-sm font-bold text-fairway-800 transition-colors hover:bg-fairway-100"
        >
          <ClipboardList className="h-4 w-4" />
          {teeTime.scores.length > 0 ? "Edit scores" : "Record scores"}
        </button>
      )}

      <Comments
        comments={teeTime.comments}
        myName={myName}
        readOnly={readOnly}
        onPost={onPostComment}
        onDelete={onDeleteComment}
      />
    </article>
  );
}
