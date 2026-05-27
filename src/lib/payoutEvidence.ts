import type { Tournament } from "./types";

export type PayoutEvidenceStatus = "not_paid" | "evidenced" | "missing_evidence";

export type PayoutEvidence = {
  status: PayoutEvidenceStatus;
  note: string | null;
  missing: boolean;
  detail: string;
};

export function buildPayoutEvidence(tournament: Tournament): PayoutEvidence {
  const note = tournament.payoutEvidenceNote?.trim() || null;
  if (!tournament.payoutPaidAt) {
    return {
      status: "not_paid",
      note,
      missing: false,
      detail: "Payout has not been marked paid.",
    };
  }
  if (note) {
    return {
      status: "evidenced",
      note,
      missing: false,
      detail: "Paid payout has a settlement note.",
    };
  }
  return {
    status: "missing_evidence",
    note: null,
    missing: true,
    detail: "Paid payout is missing a settlement note.",
  };
}

export function findMissingPayoutEvidence(tournaments: Tournament[]) {
  return tournaments
    .filter((tournament) => tournament.type !== "post")
    .map((tournament) => ({
      tournament,
      evidence: buildPayoutEvidence(tournament),
    }))
    .filter((item) => item.evidence.missing);
}
