import type { Buyin, Player, Tournament } from "./types";
import {
  findPaymentEvidenceReviews,
  findPaymentNoteReviews,
} from "./paymentNoteReview";
import { findMissingPayoutEvidence } from "./payoutEvidence";
import { missingSourceBackedHandicapPlayers } from "./handicapEvidence";

export type LaunchRiskSeverity = "blocker" | "risk" | "external";

export type LaunchRisk = {
  id: string;
  severity: LaunchRiskSeverity;
  label: string;
  detail: string;
  nextAction: string;
};

export type LaunchRiskInput = {
  players: Player[];
  buyins: Buyin[];
  tournaments: Tournament[];
  ruleBlockerCount: number;
  accessCodeRequired: boolean;
  dockerBuildVerified?: boolean;
  tailnetServeVerified?: boolean;
  productionUrlRequired?: boolean;
  productionUrlVerified?: boolean;
  mobileSafariVerified?: boolean;
};

const money = (amount: number) => `$${amount.toLocaleString()}`;
const shortList = (items: string[], limit = 4) => {
  if (items.length <= limit) return items.join(", ");
  return `${items.slice(0, limit).join(", ")} + ${items.length - limit} more`;
};

export function buildLaunchRisks({
  players,
  buyins,
  tournaments,
  ruleBlockerCount,
  accessCodeRequired,
  dockerBuildVerified = false,
  tailnetServeVerified = false,
  productionUrlRequired = false,
  productionUrlVerified = false,
  mobileSafariVerified = false,
}: LaunchRiskInput): LaunchRisk[] {
  const risks: LaunchRisk[] = [];
  const members = players.filter((player) => player.member);
  const outstanding = buyins.reduce(
    (sum, buyin) => sum + (buyin.paid ? 0 : buyin.amount),
    0
  );
  const unpaidNames = buyins
    .filter((buyin) => !buyin.paid)
    .map((buyin) => buyin.playerName)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  const paymentNoteReviews = findPaymentNoteReviews(buyins);
  const paymentEvidenceReviews = findPaymentEvidenceReviews(buyins);
  const missingPayoutEvidence = findMissingPayoutEvidence(tournaments);
  const missingHandicaps = missingSourceBackedHandicapPlayers(members)
    .map((player) => player.name)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  const unconfirmedEvents = tournaments
    .filter(
      (tournament) =>
        tournament.course.toLowerCase() === "tbd" ||
        tournament.notes?.toLowerCase().includes("tbd")
    )
    .map((tournament) => tournament.name)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  if (ruleBlockerCount > 0) {
    risks.push({
      id: "rule-blockers",
      severity: "blocker",
      label: "Score review",
      detail: `${ruleBlockerCount} score${
        ruleBlockerCount === 1 ? "" : "s"
      } ${ruleBlockerCount === 1 ? "needs" : "need"} commissioner review before standings are final`,
      nextAction:
        "Open Score Review and confirm or override the pending scores.",
    });
  }

  if (outstanding > 0) {
    risks.push({
      id: "money-collection",
      severity: "risk",
      label: "Buy-in tracking",
      detail: `${money(outstanding)} outstanding`,
      nextAction: `Open Money and update status evidence or leave open: ${shortList(
        unpaidNames
      )}.`,
    });
  }

  if (paymentNoteReviews.length > 0) {
    risks.push({
      id: "payment-note-review",
      severity: "risk",
      label: "Payment note review",
      detail: `${paymentNoteReviews.length} unpaid row${
        paymentNoteReviews.length === 1 ? "" : "s"
      } with payment-like notes: ${shortList(
        paymentNoteReviews.map((review) => review.playerName)
      )}`,
      nextAction: `Open Money and confirm status evidence or clear notes for ${shortList(
        paymentNoteReviews.map((review) => review.playerName)
      )}.`,
    });
  }

  if (paymentEvidenceReviews.length > 0) {
    risks.push({
      id: "payment-evidence-review",
      severity: "risk",
      label: "Payment evidence review",
      detail: `${paymentEvidenceReviews.length} paid row${
        paymentEvidenceReviews.length === 1 ? "" : "s"
      } missing evidence notes: ${shortList(
        paymentEvidenceReviews.map((review) => review.playerName)
      )}`,
      nextAction: `Open Money and add receipt/source notes for ${shortList(
        paymentEvidenceReviews.map((review) => review.playerName)
      )}.`,
    });
  }

  if (missingPayoutEvidence.length > 0) {
    const names = missingPayoutEvidence.map((item) => item.tournament.name);
    risks.push({
      id: "payout-evidence-review",
      severity: "risk",
      label: "Payout evidence review",
      detail: `${missingPayoutEvidence.length} paid payout${
        missingPayoutEvidence.length === 1 ? "" : "s"
      } missing settlement notes: ${shortList(names)}`,
      nextAction: `Open Tournament Closeout and add settlement notes for ${shortList(
        names
      )}.`,
    });
  }

  if (missingHandicaps.length > 0) {
    risks.push({
      id: "member-handicaps",
      severity: "risk",
      label: "Handicap records",
      detail: `${missingHandicaps.length} missing/unverified: ${missingHandicaps.join(", ")}`,
      nextAction: `Open Roster and record source-backed handicap indexes for ${shortList(
        missingHandicaps
      )}.`,
    });
  }

  if (unconfirmedEvents.length > 0) {
    risks.push({
      id: "schedule-confirmation",
      severity: "risk",
      label: "Schedule confirmation",
      detail: `${unconfirmedEvents.length} TBD: ${unconfirmedEvents.join(", ")}`,
      nextAction: `Open Ops Schedule Confirmation and replace TBD details for ${shortList(
        unconfirmedEvents,
        2
      )}.`,
    });
  }

  if (!accessCodeRequired) {
    risks.push({
      id: "access-code",
      severity: "external",
      label: "Access code",
      detail: "ACCESS_CODE is not set in this runtime; set it before public deploy",
      nextAction: "Set ACCESS_CODE in the deployment environment before sharing the URL.",
    });
  }

  if (!dockerBuildVerified) {
    risks.push({
      id: "docker-build",
      severity: "external",
      label: "Docker image build",
      detail: "Run npm run verify:docker, then set DJDI_DOCKER_BUILD_VERIFIED=1",
      nextAction: "Run npm run verify:docker and set DJDI_DOCKER_BUILD_VERIFIED=1 after it passes.",
    });
  }

  if (!tailnetServeVerified) {
    risks.push({
      id: "tailnet-url",
      severity: "external",
      label: "Tailnet URL",
      detail: "Tailscale Funnel URL is not recorded as verified in this runtime",
      nextAction:
        "Run tailscale funnel status plus tailnet remote smoke/mobile checks, then mark Tailscale Funnel smoke verified in Ops.",
    });
  }

  if (productionUrlRequired && !productionUrlVerified) {
    risks.push({
      id: "production-url",
      severity: "external",
      label: "Public production URL",
      detail:
        "Optional public/always-on production URL is required but not verified in this local run",
      nextAction: "Deploy to the target host, run remote smoke with access and commissioner codes, then set DJDI_PRODUCTION_URL_VERIFIED=1.",
    });
  }

  if (!mobileSafariVerified) {
    risks.push({
      id: "iphone-safari",
      severity: "external",
      label: "iPhone Safari",
      detail: "Physical iPhone Safari golden path is not verified in this local run",
      nextAction: "Open the deployed URL on iPhone Safari and complete the board, claim, score, Ops, and export path.",
    });
  }

  return risks;
}
