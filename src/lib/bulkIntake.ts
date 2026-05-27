import type { Buyin, Player, Tournament } from "./types";

export type HandicapIntakeMatch = {
  name: string;
  handicap: number;
  ghinNumber: string | null;
  source: string;
};

export type PaymentIntakeMatch = {
  name: string;
  amount: number | null;
  paymentStatus: Buyin["paymentStatus"];
  paymentMethod: string | null;
  paidAt: string | null;
  note: string | null;
  source: string;
};

export type ScheduleIntakeMatch = {
  id: string;
  name: string;
  course: string;
  windowStart: string;
  windowEnd: string;
  notes: string | null;
  source: string;
};

export type UnifiedBlockerIntake = {
  payments: PaymentIntakeMatch[];
  handicaps: HandicapIntakeMatch[];
  schedules: ScheduleIntakeMatch[];
};

const normalize = (value: string) => value.trim().toLowerCase();
const PAYMENT_HINT_RE =
  /\b(paid|pay|venmo|cash|zelle|sent|received|apple\s*pay|paypal|check|chase|comped|comp|waived|waiver|refunded|refund|disputed|dispute)\b|\$/i;
const PAYMENT_NEGATION_RE =
  /\b(not\s+paid|unpaid|still\s+owes?|still\s+owed|owes?|owed)\b/i;
const PAYMENT_PROMISE_RE =
  /\b(can|will|planning to|plan to|going to|gonna|later|friday|tomorrow|next week)\b.*\b(pay|venmo|zelle|cash|send)\b|\b(pay|venmo|zelle|cash|send)\b.*\b(friday|tomorrow|next week|later)\b/i;
const PAYMENT_DISPUTE_RE = /\b(disputed|dispute|chargeback|problem|wrong amount)\b/i;
const PAYMENT_REFUND_RE = /\b(refunded|refund)\b/i;
const PAYMENT_COMP_RE = /\b(comped|comp|waived|waiver)\b/i;
const PAYMENT_WORD_AMOUNT_RE =
  /\b(?:paid|pay|venmo|cash|zelle|sent|received|apple\s*pay|paypal|check|chase)\b[\s:,-]*\$?(\d{1,5}(?:\.\d+)?)/i;

function linesFrom(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function findNamedLine(line: string, names: string[]) {
  const lower = normalize(line);
  return [...names]
    .sort((a, b) => b.length - a.length)
    .find((name) => lower.includes(normalize(name)));
}

function numberAfterName(line: string, name: string) {
  const lower = normalize(line);
  const nameIndex = lower.indexOf(normalize(name));
  const search = nameIndex >= 0 ? line.slice(nameIndex + name.length) : line;
  const match = search.match(/[+-]?\$?\d{1,5}(?:\.\d+)?/);
  if (!match) return null;
  const raw = match[0].replace("$", "");
  if (raw.startsWith("+")) return -Number(raw.slice(1));
  return Number(raw);
}

function ghinNumberAfterName(line: string, name: string) {
  const lower = normalize(line);
  const nameIndex = lower.indexOf(normalize(name));
  const search = nameIndex >= 0 ? line.slice(nameIndex + name.length) : line;
  const match = search.match(/\bghin(?:\s*(?:#|number|no\.?))?\s*[:#-]?\s*([0-9][0-9 -]{4,31})\b/i);
  return match?.[1]?.replace(/\s+/g, "").trim() || null;
}

function handicapIndexAfterName(line: string, name: string) {
  const lower = normalize(line);
  const nameIndex = lower.indexOf(normalize(name));
  let search = nameIndex >= 0 ? line.slice(nameIndex + name.length) : line;

  const labelled = search.match(
    /\b(?:index|handicap\s*index|h\.?i\.?|hcp|handicap)\b\s*[:#-]?\s*([+-]?\d{1,2}(?:\.\d)?)/i
  );
  if (labelled) return Number(labelled[1]);

  search = search.replace(
    /\bghin(?:\s*(?:#|number|no\.?))?\s*[:#-]?\s*[0-9][0-9 -]{4,31}\b/gi,
    " "
  );
  return numberAfterName(`${name} ${search}`, name);
}

function explicitPaymentAmount(line: string, name: string) {
  const lower = normalize(line);
  const nameIndex = lower.indexOf(normalize(name));
  const search = nameIndex >= 0 ? line.slice(nameIndex + name.length) : line;
  const dollar = search.match(/\$(\d{1,5}(?:\.\d+)?)/);
  if (dollar) return Number(dollar[1]);
  const wordAmount = search.match(PAYMENT_WORD_AMOUNT_RE);
  return wordAmount ? Number(wordAmount[1]) : null;
}

function explicitPaymentDate(line: string, name: string) {
  const lower = normalize(line);
  const nameIndex = lower.indexOf(normalize(name));
  const search = nameIndex >= 0 ? line.slice(nameIndex + name.length) : line;
  const iso = search.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  return iso ? iso[1] : null;
}

function paymentMethod(line: string) {
  const lower = normalize(line);
  if (/\bvenmo\b/.test(lower)) return "venmo";
  if (/\bzelle\b/.test(lower)) return "zelle";
  if (/\bcash\b/.test(lower)) return "cash";
  if (/\bpaypal\b/.test(lower)) return "paypal";
  if (/\bapple\s*pay\b/.test(lower)) return "apple_pay";
  if (/\bcheck|cheque\b/.test(lower)) return "check";
  if (/\bcomp|waiv/.test(lower)) return "comp";
  return null;
}

function paymentStatus(line: string): Buyin["paymentStatus"] | null {
  if (PAYMENT_NEGATION_RE.test(line)) return "unpaid";
  if (PAYMENT_DISPUTE_RE.test(line)) return "disputed";
  if (PAYMENT_REFUND_RE.test(line)) return "refunded";
  if (PAYMENT_COMP_RE.test(line)) return "comped";
  if (PAYMENT_PROMISE_RE.test(line)) return "promised";
  if (/\b(paid|sent|received)\b/i.test(line)) return "paid";
  return null;
}

function hasExplicitPaidEvidence(
  status: Buyin["paymentStatus"],
  method: string | null,
  explicitAmount: number | null,
  paidAt: string | null
) {
  if (status === "paid") {
    return !!method && explicitAmount != null && explicitAmount > 0 && !!paidAt;
  }
  if (status === "comped") return !!method && !!paidAt;
  if (status === "refunded" || status === "disputed") {
    return explicitAmount != null && explicitAmount >= 0 && !!paidAt;
  }
  return true;
}

export function parseHandicapIntake(
  text: string,
  players: Player[]
): HandicapIntakeMatch[] {
  const names = players
    .filter((player) => player.member)
    .map((player) => player.name);
  const matches = new Map<string, HandicapIntakeMatch>();
  for (const line of linesFrom(text)) {
    const name = findNamedLine(line, names);
    if (!name) continue;
    const handicap = handicapIndexAfterName(line, name);
    if (handicap == null || !Number.isFinite(handicap)) continue;
    if (handicap < -10 || handicap > 54) continue;
    matches.set(normalize(name), {
      name,
      handicap,
      ghinNumber: ghinNumberAfterName(line, name),
      source: line,
    });
  }
  return Array.from(matches.values());
}

export function parsePaymentIntake(
  text: string,
  buyins: Buyin[]
): PaymentIntakeMatch[] {
  const names = buyins.map((buyin) => buyin.playerName);
  const byName = new Map(
    buyins.map((buyin) => [normalize(buyin.playerName), buyin])
  );
  const matches = new Map<string, PaymentIntakeMatch>();
  for (const line of linesFrom(text)) {
    const name = findNamedLine(line, names);
    if (!name) continue;
    const buyin = byName.get(normalize(name));
    if (!buyin) continue;
    const status = paymentStatus(line);
    if (!status || status === "unpaid") continue;
    const method = paymentMethod(line);
    const explicitAmount = explicitPaymentAmount(line, name);
    const paidAt = explicitPaymentDate(line, name);
    if (!hasExplicitPaidEvidence(status, method, explicitAmount, paidAt)) continue;
    const recordedPaidAt = status === "promised" ? null : paidAt;
    const genericAmount = numberAfterName(line, name);
    const amount =
      explicitAmount != null && Number.isFinite(explicitAmount) && explicitAmount >= 0
        ? Math.round(explicitAmount)
        : PAYMENT_HINT_RE.test(line) && status !== "promised"
          ? buyin.amount
          : genericAmount != null &&
              Number.isInteger(genericAmount) &&
              genericAmount >= 25
            ? genericAmount
            : buyin.amount;
    if (!Number.isInteger(amount) || amount > 100000) continue;
    const note = line.length > name.length ? line : null;
    matches.set(normalize(name), {
      name,
      amount,
      paymentStatus: status,
      paymentMethod: method,
      paidAt: recordedPaidAt,
      note,
      source: line,
    });
  }
  return Array.from(matches.values());
}

export function parseScheduleIntake(
  text: string,
  tournaments: Tournament[]
): ScheduleIntakeMatch[] {
  const names = tournaments.map((tournament) => tournament.name);
  const byName = new Map(
    tournaments.map((tournament) => [normalize(tournament.name), tournament])
  );
  const matches = new Map<string, ScheduleIntakeMatch>();
  for (const line of linesFrom(text)) {
    const name = findNamedLine(line, names);
    if (!name) continue;
    const tournament = byName.get(normalize(name));
    if (!tournament) continue;
    const dates = Array.from(line.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)).map(
      (match) => match[0]
    );
    if (dates.length === 0) continue;
    const windowStart = dates[0];
    const windowEnd = dates[1] ?? dates[0];
    if (windowStart > windowEnd) continue;
    const afterName = line.slice(
      normalize(line).indexOf(normalize(name)) + name.length
    );
    const firstDateIndex = afterName.indexOf(windowStart);
    const course = afterName
      .slice(0, firstDateIndex >= 0 ? firstDateIndex : undefined)
      .replace(/^[:\s,-]+/, "")
      .replace(/[,\s-]+$/, "")
      .trim();
    if (!course || normalize(course) === "tbd") continue;
    const lastDate = windowEnd;
    const notesStart = afterName.indexOf(lastDate) + lastDate.length;
    const notes =
      notesStart >= lastDate.length
        ? afterName.slice(notesStart).replace(/^[:\s,-]+/, "").trim()
        : "";
    matches.set(tournament.id, {
      id: tournament.id,
      name: tournament.name,
      course,
      windowStart,
      windowEnd,
      notes: notes || null,
      source: line,
    });
  }
  return Array.from(matches.values());
}

export function parseUnifiedBlockerIntake(
  text: string,
  {
    players,
    buyins,
    tournaments,
  }: {
    players: Player[];
    buyins: Buyin[];
    tournaments: Tournament[];
  }
): UnifiedBlockerIntake {
  const lines = linesFrom(text);
  const paymentText = lines.filter((line) => PAYMENT_HINT_RE.test(line)).join("\n");
  return {
    payments: parsePaymentIntake(paymentText, buyins),
    handicaps: parseHandicapIntake(text, players),
    schedules: parseScheduleIntake(text, tournaments),
  };
}
