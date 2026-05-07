import { useState } from "react";
import {
  Clock,
  MapPin,
  X,
  MoreHorizontal,
  Trash2,
  Calendar as CalendarIcon,
  CalendarPlus,
  Pencil,
} from "lucide-react";
import { downloadIcs } from "../lib/calendar";
import { eqName, formatDateLabel, formatTimeLabel } from "../lib/format";
import type { TeeTime } from "../lib/types";
import { PlayerChip } from "./PlayerChip";
import { SpotsIndicator } from "./SpotsIndicator";

// ============================================================
// TEE TIME CARD
// ============================================================
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
}: {
  teeTime: TeeTime;
  myName: string;
  readOnly: boolean;
  onClaim: () => void;
  onDrop: (name: string) => void;
  onMaybe: () => void;
  onDropMaybe: (name: string) => void;
  onDelete: () => void;
  onEdit: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const meIn = !!myName && teeTime.claims.some((c) => eqName(c.name, myName));
  const meMaybe =
    !!myName && teeTime.interested.some((i) => eqName(i.name, myName));
  const isHost = !!myName && eqName(teeTime.host, myName);
  const full = teeTime.claims.length >= teeTime.spots;

  return (
    <article
      className={`relative rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200 ${
        readOnly ? "opacity-60" : ""
      }`}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
            <CalendarIcon className="h-3.5 w-3.5" />
            {formatDateLabel(teeTime.date)}
            <span className="text-stone-300">·</span>
            <Clock className="h-3.5 w-3.5" />
            {formatTimeLabel(teeTime.time)}
          </div>
          <h2 className="mt-1 flex items-center gap-1.5 text-lg font-semibold text-stone-900">
            <MapPin className="h-4 w-4 text-fairway-700" />
            {teeTime.course}
          </h2>
        </div>
        {!readOnly && isHost && (
          <div className="relative">
            <button
              type="button"
              aria-label="Host options"
              onClick={() => setMenuOpen((v) => !v)}
              className="flex h-10 w-10 items-center justify-center rounded-full text-stone-500 hover:bg-stone-100"
            >
              <MoreHorizontal className="h-5 w-5" />
            </button>
            {menuOpen && (
              <>
                <button
                  type="button"
                  aria-label="Close menu"
                  onClick={() => setMenuOpen(false)}
                  className="fixed inset-0 z-10 cursor-default"
                />
                <div className="absolute right-0 top-8 z-20 w-44 rounded-lg bg-white p-1 shadow-lg ring-1 ring-stone-200">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onEdit();
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-stone-700 hover:bg-stone-100"
                  >
                    <Pencil className="h-4 w-4" /> Edit tee time
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      if (
                        window.confirm(
                          `Delete ${teeTime.course} on ${formatDateLabel(teeTime.date)} at ${formatTimeLabel(teeTime.time)}? This can't be undone.`
                        )
                      ) {
                        onDelete();
                      }
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-rose-600 hover:bg-rose-50"
                  >
                    <Trash2 className="h-4 w-4" /> Delete tee time
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <p className="text-sm text-stone-500">
        Hosted by{" "}
        <span className="font-medium text-stone-700">{teeTime.host}</span>
      </p>

      {teeTime.notes && (
        <p className="mt-2 text-sm text-stone-600">{teeTime.notes}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <SpotsIndicator
          filled={teeTime.claims.length}
          total={teeTime.spots}
          interested={teeTime.interested.length}
        />
        {!readOnly && (
          <button
            type="button"
            onClick={() => downloadIcs(teeTime)}
            className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs font-medium text-fairway-700 hover:text-fairway-900"
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
              onDrop={
                !readOnly && !!myName && eqName(c.name, myName)
                  ? () => {
                      if (
                        window.confirm(`Drop your spot at ${teeTime.course}?`)
                      ) {
                        onDrop(c.name);
                      }
                    }
                  : undefined
              }
            />
          ))}
        </div>
      )}

      {teeTime.interested.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-stone-400">
            Maybe
          </span>
          {teeTime.interested.map((i) => (
            <PlayerChip
              key={i.name}
              name={i.name}
              variant="interested"
              isHost={false}
              isMe={!!myName && eqName(i.name, myName)}
              onDrop={
                !readOnly && !!myName && eqName(i.name, myName)
                  ? () => {
                      if (
                        window.confirm(
                          `Remove your maybe at ${teeTime.course}?`
                        )
                      ) {
                        onDropMaybe(i.name);
                      }
                    }
                  : undefined
              }
            />
          ))}
        </div>
      )}

      {!readOnly && !meIn && (
        <div className="mt-4 flex items-stretch gap-2">
          <button
            type="button"
            onClick={onClaim}
            disabled={full || !myName}
            className="flex-1 rounded-xl bg-fairway-600 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-fairway-700 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-500 disabled:shadow-none"
          >
            {full ? "Full" : !myName ? "Add your name first" : "Claim a spot"}
          </button>
          {!meMaybe && myName && (
            <button
              type="button"
              onClick={onMaybe}
              className="flex-1 rounded-xl border border-stone-300 bg-white py-2.5 text-sm font-semibold text-stone-700 transition-colors hover:bg-stone-50"
            >
              Maybe
            </button>
          )}
        </div>
      )}
    </article>
  );
}
