import type { Buyin } from "./types";

const PAYMENT_NOTE_PATTERN =
  /\b(venmo|paid|cash|zelle|sent|received|apple\s*pay|paypal|check|cheque|chase|wire|ach)\b|\$/i;

export type PaymentNoteReview = {
  playerName: string;
  note: string;
};

export type PaymentEvidenceReview = {
  playerName: string;
  paidAt: string | null;
};

const statusFor = (buyin: Buyin) =>
  buyin.paymentStatus ?? (buyin.paid ? "paid" : "unpaid");

export function findPaymentNoteReviews(buyins: Buyin[]): PaymentNoteReview[] {
  return buyins
    .filter((buyin) => {
      const note = buyin.notes?.trim();
      return (
        statusFor(buyin) === "unpaid" &&
        !!note &&
        PAYMENT_NOTE_PATTERN.test(note)
      );
    })
    .map((buyin) => ({
      playerName: buyin.playerName,
      note: buyin.notes?.trim() ?? "",
    }))
    .sort((a, b) =>
      a.playerName.localeCompare(b.playerName, undefined, { sensitivity: "base" })
    );
}

export function findPaymentEvidenceReviews(
  buyins: Buyin[]
): PaymentEvidenceReview[] {
  return buyins
    .filter(
      (buyin) =>
        (statusFor(buyin) === "paid" || statusFor(buyin) === "comped") &&
        !buyin.notes?.trim()
    )
    .map((buyin) => ({
      playerName: buyin.playerName,
      paidAt: buyin.paidAt,
    }))
    .sort((a, b) =>
      a.playerName.localeCompare(b.playerName, undefined, { sensitivity: "base" })
    );
}

export function paymentNoteReviewCopy(reviews: PaymentNoteReview[]) {
  if (reviews.length === 0) {
    return "DJDI payment-note review:\nNo unpaid rows have payment-like notes.";
  }

  return [
    "DJDI payment-note review:",
    ...reviews.map((review) => `${review.playerName}: ${review.note}`),
    "",
    "Confirm each note means paid, then mark paid; otherwise clear or rewrite the note.",
  ].join("\n");
}

export function paymentEvidenceReviewCopy(reviews: PaymentEvidenceReview[]) {
  if (reviews.length === 0) {
    return "DJDI paid buy-in evidence review:\nEvery paid row has an evidence note.";
  }

  return [
    "DJDI paid buy-in evidence review:",
    ...reviews.map(
      (review) =>
        `${review.playerName}: paid${review.paidAt ? ` at ${review.paidAt}` : ""}, evidence note missing`
    ),
    "",
    "Add the receipt, cash confirmation, comp note, or other source note before treating the money ledger as fully evidenced.",
  ].join("\n");
}
