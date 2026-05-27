import { useEffect, useMemo, useState } from "react";
import {
  Banknote,
  Check,
  ChevronDown,
  Clipboard,
  ClipboardCheck,
  Save,
} from "lucide-react";
import { parsePaymentIntake } from "../lib/bulkIntake";
import { buildCollectionAsk } from "../lib/requestCopy";
import type { Buyin } from "../lib/types";

type CopyState = "idle" | "copied" | "blocked";

export function Finances({
  buyins,
  onPatch,
  openSignal = 0,
}: {
  buyins: Buyin[];
  onPatch: (
    name: string,
    patch: {
      amount?: number;
      paid?: boolean;
      paymentStatus?: Buyin["paymentStatus"];
      paymentMethod?: string | null;
      paymentActor?: string | null;
      paidAt?: string | null;
      notes?: string | null;
    }
  ) => void | Promise<void>;
  openSignal?: number;
}) {
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<
    Record<string, { amount: string; notes: string; paidAt: string }>
  >({});
  const [savingName, setSavingName] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [fallbackText, setFallbackText] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkStatus, setBulkStatus] = useState("");

  useEffect(() => {
    if (openSignal > 0) setOpen(true);
  }, [openSignal]);

  const totals = useMemo(() => {
    let expected = 0;
    let settled = 0;
    for (const b of buyins) {
      expected += b.amount;
      if (isSettled(b)) settled += b.amount;
    }
    return { expected, settled, outstanding: expected - settled };
  }, [buyins]);

  if (buyins.length === 0) return null;

  const settledCount = buyins.filter(isSettled).length;
  const outstandingRows = buyins.filter((b) => !isSettled(b));
  const nextOutstanding = outstandingRows
    .slice(0, 4)
    .map((b) => `${b.playerName}${statusSuffix(b)}`)
    .join(", ");
  const buyinStatusAsk = buildCollectionAsk(buyins);
  const bulkMatches = useMemo(
    () => parsePaymentIntake(bulkText, buyins),
    [bulkText, buyins]
  );

  const draftFor = (buyin: Buyin) =>
    drafts[buyin.playerName.toLowerCase()] ?? {
      amount: String(buyin.amount),
      notes: buyin.notes ?? "",
      paidAt: dateInputValue(buyin.paidAt),
    };

  const saveDraft = async (buyin: Buyin) => {
    const draft = draftFor(buyin);
    const amount = Number(draft.amount.trim());
    if (!Number.isInteger(amount) || amount < 0) return;
    setSavingName(buyin.playerName);
    try {
      await onPatch(buyin.playerName, {
        amount,
        paidAt: draft.paidAt || null,
        notes: draft.notes.trim() || null,
      });
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[buyin.playerName.toLowerCase()];
        return next;
      });
    } finally {
      setSavingName(null);
    }
  };

  const copyCollectionAsk = async () => {
    setFallbackText("");
    try {
      await navigator.clipboard.writeText(buyinStatusAsk);
      setCopyState("copied");
    } catch {
      setFallbackText(buyinStatusAsk);
      setCopyState("blocked");
    }
  };
  const applyBulkPayments = async () => {
    if (bulkMatches.length === 0) return;
    setBulkSaving(true);
    setBulkStatus("");
    try {
      for (const match of bulkMatches) {
        await onPatch(match.name, {
          paymentStatus: match.paymentStatus,
          paymentMethod: match.paymentMethod,
          paymentActor: "Commissioner",
          paidAt: match.paidAt,
          amount: match.amount ?? undefined,
          notes: match.note,
        });
      }
      setBulkStatus(
        `Applied ${bulkMatches.length} buy-in update${
          bulkMatches.length === 1 ? "" : "s"
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
          <Banknote className="h-4 w-4 text-fairway-700" />
          <span className="text-base font-semibold text-stone-900">Pool</span>
          <span className="text-xs text-stone-500">
            <span className="font-medium text-stone-900">
              ${totals.settled.toLocaleString()}
            </span>{" "}
            settled of{" "}
            <span className="text-stone-700">
              ${totals.expected.toLocaleString()}
            </span>
            <span className="ml-2 text-stone-400">
              · {settledCount}/{buyins.length} settled
            </span>
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
          <div className="mb-3 grid grid-cols-3 gap-2">
            <PoolStat
              label="Recorded"
              value={`$${totals.settled.toLocaleString()}`}
              tone="ok"
            />
            <PoolStat
              label="Outstanding"
              value={`$${totals.outstanding.toLocaleString()}`}
              tone={totals.outstanding > 0 ? "warn" : "ok"}
            />
            <PoolStat
              label="Settled"
              value={`${settledCount}/${buyins.length}`}
              tone={settledCount === buyins.length ? "ok" : "neutral"}
            />
          </div>

          {outstandingRows.length > 0 && (
            <div className="mb-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0">
                  Open buy-in status: {nextOutstanding}
                  {outstandingRows.length > 4
                    ? ` + ${outstandingRows.length - 4} more`
                    : ""}
                </p>
                <button
                  type="button"
                  onClick={copyCollectionAsk}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-amber-900 ring-1 ring-amber-200 hover:bg-white"
                >
                  {copyState === "copied" ? (
                    <ClipboardCheck className="h-3.5 w-3.5" />
                  ) : (
                    <Clipboard className="h-3.5 w-3.5" />
                  )}
                  {copyState === "copied" ? "Copied" : "Copy status request"}
                </button>
              </div>
              {copyState === "blocked" && (
                <textarea
                  readOnly
                  value={fallbackText}
                  aria-label="Buy-in status ask text"
                  className="mt-2 h-24 w-full resize-none rounded-lg border border-amber-200 bg-white px-2 py-1.5 text-xs text-stone-900"
                  onFocus={(event) => event.currentTarget.select()}
                />
              )}
              <div className="mt-2 rounded-lg bg-white/70 p-2 ring-1 ring-amber-100">
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-amber-900">
                  Paste buy-in status replies
                  <textarea
                    value={bulkText}
                    onChange={(event) => {
                      setBulkText(event.target.value);
                      setBulkStatus("");
                    }}
                    placeholder="Beck buy-in paid cash $325 2026-05-19&#10;Chris buy-in paid venmo $325 2026-05-19"
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
                      ? "No usable status line yet. Paid/comped lines need method, amount, and date."
                      : "Paid or comped status lines need method, amount, and date."}
                  </span>
                  <button
                    type="button"
                    disabled={bulkMatches.length === 0 || bulkSaving}
                    onClick={applyBulkPayments}
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
            {buyins.map((b) => {
              const draft = draftFor(b);
              const amount = Number(draft.amount.trim());
              const validAmount =
                Number.isInteger(amount) && amount >= 0 && amount <= 100000;
              const dirty =
                draft.amount.trim() !== String(b.amount) ||
                draft.notes.trim() !== (b.notes ?? "") ||
                draft.paidAt !== dateInputValue(b.paidAt);
              const evidenceNote = draft.notes.trim();
              const inferredMethod = inferPaymentMethod(evidenceNote);
              const selectedMethod = b.paymentMethod ?? inferredMethod;
              const hasPaymentDate = /^\d{4}-\d{2}-\d{2}$/.test(draft.paidAt);
              const status = paymentStatus(b);
              const settled = isSettled(b);
              const canMarkPaid =
                status === "paid" ||
                (evidenceNote.length > 0 && !!selectedMethod && hasPaymentDate);
              return (
                <li key={b.playerName} className="py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-stone-900">
                        {b.playerName}
                      </p>
                      <p className="mt-0.5 text-xs text-stone-400">
                        {statusLabel(b)}
                      </p>
                      {settled && !b.notes?.trim() && (
                        <p className="mt-1 text-xs font-medium text-amber-700">
                          Evidence note missing
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={!canMarkPaid && !settled}
                      onClick={() =>
                        onPatch(b.playerName, {
                          paymentStatus: settled ? "unpaid" : "paid",
                          paymentMethod: settled ? null : selectedMethod,
                          paymentActor: settled ? null : "Commissioner",
                          paidAt: settled ? null : draft.paidAt,
                          notes: settled ? b.notes : evidenceNote,
                        })
                      }
                      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        !canMarkPaid && !settled
                          ? "bg-stone-100 text-stone-400"
                          : settled
                          ? "bg-fairway-100 text-fairway-900 hover:bg-fairway-200"
                          : "bg-amber-50 text-amber-700 hover:bg-amber-100"
                      }`}
                    >
                      {settled && <Check className="h-3 w-3" />}
                      {settled ? "Settled" : "Record paid"}
                    </button>
                  </div>

                  <div className="mt-2 grid grid-cols-[7rem_minmax(0,1fr)_2.5rem] gap-2">
                    <label className="text-[11px] font-medium text-stone-500">
                      Amount
                      <input
                        inputMode="numeric"
                        value={draft.amount}
                        onChange={(event) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [b.playerName.toLowerCase()]: {
                              ...draft,
                              amount: event.target.value,
                            },
                          }))
                        }
                        onBlur={() => {
                          if (dirty && validAmount) saveDraft(b);
                        }}
                        aria-invalid={!validAmount}
                        className={`mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm text-stone-900 focus:outline-none focus:ring-2 ${
                          validAmount
                            ? "border-stone-200 focus:border-fairway-600 focus:ring-fairway-100"
                            : "border-red-300 focus:border-red-500 focus:ring-red-100"
                        }`}
                      />
                    </label>
                    <label className="min-w-0 text-[11px] font-medium text-stone-500">
                      Note
                      <input
                        value={draft.notes}
                        placeholder="Venmo, cash, comp, reminder..."
                        onChange={(event) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [b.playerName.toLowerCase()]: {
                              ...draft,
                              notes: event.target.value,
                            },
                          }))
                        }
                        onBlur={() => {
                          if (dirty && validAmount) saveDraft(b);
                        }}
                        className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-300 focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
                      />
                    </label>
                    <button
                      type="button"
                      disabled={!dirty || !validAmount || savingName === b.playerName}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => saveDraft(b)}
                      className="mt-5 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-fairway-700 text-white hover:bg-fairway-800 disabled:bg-stone-100 disabled:text-stone-400"
                      aria-label={`Save ${b.playerName} buy-in`}
                    >
                      {dirty ? (
                        <Save className="h-4 w-4" />
                      ) : (
                        <Check className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <label className="text-[11px] font-medium text-stone-500">
                      Status
                      <select
                        value={b.paymentStatus ?? (b.paid ? "paid" : "unpaid")}
                        onChange={(event) =>
                          onPatch(b.playerName, {
                            paymentStatus: event.target
                              .value as Buyin["paymentStatus"],
                            paymentMethod:
                              event.target.value === "paid" ||
                              event.target.value === "comped"
                                ? selectedMethod
                                : event.target.value === "unpaid"
                                  ? null
                                  : b.paymentMethod ?? null,
                            paymentActor:
                              event.target.value === "paid" ||
                              event.target.value === "comped"
                                ? "Commissioner"
                                : null,
                            paidAt:
                              event.target.value === "paid" ||
                              event.target.value === "comped"
                                ? draft.paidAt || null
                                : null,
                            notes: evidenceNote || b.notes,
                          })
                        }
                        className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
                      >
                        <option value="unpaid">Unpaid</option>
                        <option value="promised">Promised</option>
                        <option value="paid" disabled={!canMarkPaid}>
                          Paid
                        </option>
                        <option value="comped" disabled={!canMarkPaid}>
                          Comped
                        </option>
                        <option value="refunded">Refunded</option>
                        <option value="disputed">Disputed</option>
                      </select>
                    </label>
                    <label className="text-[11px] font-medium text-stone-500">
                      Method
                      <input
                        value={b.paymentMethod ?? ""}
                        placeholder="Venmo, cash..."
                        onChange={(event) =>
                          onPatch(b.playerName, {
                            paymentMethod: event.target.value.trim() || null,
                          })
                        }
                        className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-300 focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
                      />
                    </label>
                  </div>
                  <label className="mt-2 block text-[11px] font-medium text-stone-500">
                    Paid date
                    <input
                      type="date"
                      value={draft.paidAt}
                      onChange={(event) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [b.playerName.toLowerCase()]: {
                            ...draft,
                            paidAt: event.target.value,
                          },
                        }))
                      }
                      onBlur={() => {
                        if (dirty && validAmount) saveDraft(b);
                      }}
                      className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
                    />
                  </label>
                  {!validAmount && (
                    <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-red-700">
                      Whole dollars only
                    </p>
                  )}
                  {!settled && !canMarkPaid && (
                    <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                      Add source note, method, and paid date before marking paid
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          {totals.outstanding > 0 && (
            <p className="mt-2 text-[11px] text-stone-400">
              <span className="font-medium text-amber-700">
                ${totals.outstanding.toLocaleString()}
              </span>{" "}
              outstanding. The board records status and evidence only; use the
              status menu for promised, disputed, comped, refunded, or paid.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function inferPaymentMethod(note: string) {
  const lower = note.toLowerCase();
  if (/\bvenmo\b/.test(lower)) return "venmo";
  if (/\bzelle\b/.test(lower)) return "zelle";
  if (/\bcash\b/.test(lower)) return "cash";
  if (/\bpaypal\b/.test(lower)) return "paypal";
  if (/\bapple\s*pay\b/.test(lower)) return "apple_pay";
  if (/\bcheck|cheque\b/.test(lower)) return "check";
  if (/\bcomp|waiv/.test(lower)) return "comp";
  return null;
}

function dateInputValue(value: string | null) {
  if (!value) return "";
  const match = value.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
}

function PoolStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "neutral" | "ok" | "warn";
}) {
  const toneClass =
    tone === "ok"
      ? "bg-fairway-50 text-fairway-900"
      : tone === "warn"
        ? "bg-amber-50 text-amber-800"
        : "bg-stone-50 text-stone-800";
  return (
    <div className={`min-w-0 rounded-xl p-3 ${toneClass}`}>
      <div className="truncate text-sm font-semibold">{value}</div>
      <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide opacity-70">
        {label}
      </div>
    </div>
  );
}

function formatPaidAt(paidAt: string | null) {
  if (!paidAt) return "date not recorded";
  const date = new Date(paidAt);
  if (Number.isNaN(date.getTime())) return "date unknown";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function statusLabel(buyin: Buyin) {
  const status = paymentStatus(buyin);
  if (status === "paid") {
    return `Paid ${formatPaidAt(buyin.paidAt)}`;
  }
  if (status === "comped") {
    return `Comped ${formatPaidAt(buyin.paidAt)}`;
  }
  if (status === "promised") return "Promised";
  if (status === "refunded") return "Refunded";
  if (status === "disputed") return "Disputed";
  return "Open";
}

function paymentStatus(buyin: Buyin) {
  return buyin.paymentStatus ?? (buyin.paid ? "paid" : "unpaid");
}

function isSettled(buyin: Buyin) {
  const status = paymentStatus(buyin);
  return status === "paid" || status === "comped";
}

function statusSuffix(buyin: Buyin) {
  const status = paymentStatus(buyin);
  return status === "unpaid" ? "" : ` (${status})`;
}
