import type { RuleIssue } from "./audit";
import type { Buyin, Player, Tournament } from "./types";
import {
  buildAccessCodeSetup,
  buildCollectionAsk,
  buildHandicapAsk,
  buildIphoneSafariChecklist,
  buildProductionUrlChecklist,
  buildScheduleAsk,
} from "./requestCopy";
import {
  findPaymentEvidenceReviews,
  findPaymentNoteReviews,
  paymentEvidenceReviewCopy,
  paymentNoteReviewCopy,
} from "./paymentNoteReview";
import { findMissingPayoutEvidence } from "./payoutEvidence";
import { missingSourceBackedHandicapPlayers } from "./handicapEvidence";

export type CommissionerTaskSeverity = "blocker" | "risk" | "external";
export type CommissionerTaskArea =
  | "rules"
  | "money"
  | "roster"
  | "schedule"
  | "closeout"
  | "access"
  | "launch";

export type CommissionerTask = {
  id: string;
  area: CommissionerTaskArea;
  severity: CommissionerTaskSeverity;
  title: string;
  detail: string;
  nextAction: string;
  items: string[];
  copyText: string | null;
  done: boolean;
};

type LaunchChecks = {
  dockerBuildVerified?: boolean;
  tailnetServeVerified?: boolean;
  productionUrlRequired?: boolean;
  productionUrlVerified?: boolean;
  mobileSafariVerified?: boolean;
};

const dollars = (amount: number) => `$${amount.toLocaleString("en-US")}`;

function sortedNames(names: string[]) {
  return [...names].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );
}

function shortList(items: string[], limit = 4) {
  if (items.length <= limit) return items.join(", ");
  return `${items.slice(0, limit).join(", ")} + ${items.length - limit} more`;
}

function scoreBlockerActionCopy(ruleIssues: RuleIssue[]) {
  return [
    "DJDI score review:",
    "Open Admin > Score Review.",
    "Confirm or commissioner-override each listed score only after the league has source evidence.",
    "Then refresh standings.",
    "",
    ...ruleIssues.map(
      (issue) =>
        `- ${issue.date} ${issue.tournamentName}: ${issue.player} — ${issue.message}`
    ),
  ].join("\n");
}

export function buildCommissionerTasks({
  players,
  buyins,
  tournaments,
  ruleIssues,
  accessCodeRequired,
  launchChecks,
}: {
  players: Player[];
  buyins: Buyin[];
  tournaments: Tournament[];
  ruleIssues: RuleIssue[];
  accessCodeRequired: boolean;
  launchChecks: LaunchChecks;
}): CommissionerTask[] {
  const tasks: CommissionerTask[] = [];
  const unpaid = buyins.filter((buyin) => !buyin.paid);
  const paymentNoteReviews = findPaymentNoteReviews(buyins);
  const paymentEvidenceReviews = findPaymentEvidenceReviews(buyins);
  const missingPayoutEvidence = findMissingPayoutEvidence(tournaments);
  const outstanding = unpaid.reduce((sum, buyin) => sum + buyin.amount, 0);
  const missingHandicaps = sortedNames(
    missingSourceBackedHandicapPlayers(players).map((player) => player.name)
  );
  const unconfirmedTournaments = tournaments.filter(
    (tournament) =>
      tournament.course.toLowerCase() === "tbd" ||
      tournament.notes?.toLowerCase().includes("tbd")
  );
  const unconfirmedNames = sortedNames(
    unconfirmedTournaments.map((tournament) => tournament.name)
  );

  if (ruleIssues.length > 0) {
    tasks.push({
      id: "fix-rule-blockers",
      area: "rules",
      severity: "blocker",
      title: "Review scores",
      detail: `${ruleIssues.length} score${
        ruleIssues.length === 1 ? "" : "s"
      } ${ruleIssues.length === 1 ? "needs" : "need"} commissioner review before standings are final.`,
      nextAction:
        "Open Score Review and confirm or override each pending score.",
      items: ruleIssues.map(
        (issue) => `${issue.player}: ${issue.message} (${issue.tournamentName})`
      ),
      copyText: scoreBlockerActionCopy(ruleIssues),
      done: false,
    });
  }

  if (outstanding > 0) {
    const names = unpaid.map((buyin) => buyin.playerName);
    tasks.push({
      id: "collect-buyins",
      area: "money",
      severity: "risk",
      title: "Track buy-in status",
      detail: `${dollars(outstanding)} outstanding across ${unpaid.length} player${
        unpaid.length === 1 ? "" : "s"
      }.`,
      nextAction: `Update status evidence or leave open: ${shortList(
        sortedNames(names)
      )}.`,
      items: unpaid.map((buyin) => `${buyin.playerName}: ${dollars(buyin.amount)}`),
      copyText: buildCollectionAsk(buyins),
      done: false,
    });
  }

  if (paymentNoteReviews.length > 0) {
    const names = paymentNoteReviews.map((review) => review.playerName);
    tasks.push({
      id: "review-payment-notes",
      area: "money",
      severity: "risk",
      title: "Review payment notes",
      detail: `${paymentNoteReviews.length} unpaid buy-in row${
        paymentNoteReviews.length === 1 ? "" : "s"
      } ha${paymentNoteReviews.length === 1 ? "s" : "ve"} payment-like notes.`,
      nextAction: `Confirm status evidence or clear the note: ${shortList(names)}.`,
      items: paymentNoteReviews.map(
        (review) => `${review.playerName}: ${review.note}`
      ),
      copyText: paymentNoteReviewCopy(paymentNoteReviews),
      done: false,
    });
  }

  if (paymentEvidenceReviews.length > 0) {
    const names = paymentEvidenceReviews.map((review) => review.playerName);
    tasks.push({
      id: "review-payment-evidence",
      area: "money",
      severity: "risk",
      title: "Add paid evidence notes",
      detail: `${paymentEvidenceReviews.length} paid buy-in row${
        paymentEvidenceReviews.length === 1 ? "" : "s"
      } ${paymentEvidenceReviews.length === 1 ? "is" : "are"} missing evidence notes.`,
      nextAction: `Add receipt/source notes already confirmed outside the app for ${shortList(names)}.`,
      items: paymentEvidenceReviews.map(
        (review) =>
          `${review.playerName}: paid${review.paidAt ? ` at ${review.paidAt}` : ""}, evidence note missing`
      ),
      copyText: paymentEvidenceReviewCopy(paymentEvidenceReviews),
      done: false,
    });
  }

  if (missingPayoutEvidence.length > 0) {
    const names = sortedNames(
      missingPayoutEvidence.map((item) => item.tournament.name)
    );
    tasks.push({
      id: "review-payout-evidence",
      area: "closeout",
      severity: "risk",
      title: "Add payout settlement notes",
      detail: `${missingPayoutEvidence.length} paid payout${
        missingPayoutEvidence.length === 1 ? "" : "s"
      } ${missingPayoutEvidence.length === 1 ? "is" : "are"} missing settlement notes.`,
      nextAction: `Add settlement notes for ${shortList(names)}.`,
      items: missingPayoutEvidence.map(
        (item) =>
          `${item.tournament.name}: paid${item.tournament.payoutPaidAt ? ` at ${item.tournament.payoutPaidAt}` : ""}, settlement note missing`
      ),
      copyText: [
        "Paid tournament payouts need settlement notes:",
        ...missingPayoutEvidence.map(
          (item) => `- ${item.tournament.name}: add Venmo/cash/check evidence note`
        ),
      ].join("\n"),
      done: false,
    });
  }

  if (missingHandicaps.length > 0) {
    tasks.push({
      id: "collect-ghin-indexes",
      area: "roster",
      severity: "risk",
      title: "Record handicap indexes",
      detail: `${missingHandicaps.length} member index${
        missingHandicaps.length === 1 ? "" : "es"
      } missing or unverified.`,
      nextAction: `Record source-backed handicap indexes for ${shortList(
        missingHandicaps
      )}.`,
      items: missingHandicaps,
      copyText: buildHandicapAsk(players),
      done: false,
    });
  }

  if (unconfirmedTournaments.length > 0) {
    tasks.push({
      id: "confirm-schedule",
      area: "schedule",
      severity: "risk",
      title: "Confirm schedule details",
      detail: `${unconfirmedTournaments.length} event${
        unconfirmedTournaments.length === 1 ? "" : "s"
      } still carr${unconfirmedTournaments.length === 1 ? "ies" : "y"} TBD details.`,
      nextAction: `Replace TBD details for ${shortList(unconfirmedNames, 2)}.`,
      items: unconfirmedNames,
      copyText: buildScheduleAsk(tournaments),
      done: false,
    });
  }

  if (!accessCodeRequired) {
    tasks.push({
      id: "set-access-code",
      area: "access",
      severity: "external",
      title: "Set access code",
      detail: "This runtime is open because ACCESS_CODE is not configured.",
      nextAction: "Set ACCESS_CODE before sharing a public URL.",
      items: ["ACCESS_CODE"],
      copyText: buildAccessCodeSetup(),
      done: false,
    });
  }

  if (!launchChecks.dockerBuildVerified) {
    tasks.push({
      id: "verify-docker",
      area: "launch",
      severity: "external",
      title: "Verify Docker image",
      detail: "Production Docker image has not been recorded as verified.",
      nextAction: "Run npm run verify:docker, then mark Docker verified in Ops.",
      items: ["npm run verify:docker"],
      copyText: "npm run verify:docker",
      done: false,
    });
  }

  if (!launchChecks.tailnetServeVerified) {
    tasks.push({
      id: "verify-tailnet-url",
      area: "launch",
      severity: "external",
      title: "Verify tailnet URL",
      detail: "Tailscale Funnel URL is not recorded as verified.",
      nextAction:
        "Run Tailscale Funnel status, remote smoke, and mobile smoke, then mark Tailscale Funnel smoke verified in Ops.",
      items: ["https://duckbookpro.clouded-tailor.ts.net"],
      copyText:
        "tailscale funnel status\nREMOTE_SMOKE_URL=https://duckbookpro.clouded-tailor.ts.net REMOTE_SMOKE_ACCESS_CODE=<code> REMOTE_SMOKE_COMMISSIONER_CODE=<commissioner-code> npm run verify:remote-smoke\nREMOTE_MOBILE_URL=https://duckbookpro.clouded-tailor.ts.net REMOTE_MOBILE_ACCESS_CODE=<code> REMOTE_MOBILE_COMMISSIONER_CODE=<commissioner-code> npm run verify:remote-mobile-ux",
      done: false,
    });
  }

  if (launchChecks.productionUrlRequired && !launchChecks.productionUrlVerified) {
    tasks.push({
      id: "verify-production-url",
      area: "launch",
      severity: "external",
      title: "Verify public production URL",
      detail:
        "Optional public/always-on production URL is required but not recorded as verified.",
      nextAction:
        "Run remote smoke against the final URL, then mark Production URL smoke verified in Ops.",
      items: [
        "fly auth login",
        "tailscale funnel --bg --yes --https=443 3131",
        "REMOTE_SMOKE_URL=https://... REMOTE_SMOKE_ACCESS_CODE=<code> REMOTE_SMOKE_COMMISSIONER_CODE=<commissioner-code> npm run verify:remote-smoke",
      ],
      copyText: buildProductionUrlChecklist(),
      done: false,
    });
  }

  if (!launchChecks.mobileSafariVerified) {
    tasks.push({
      id: "verify-iphone-safari",
      area: "launch",
      severity: "external",
      title: "Verify iPhone Safari",
      detail: "Physical iPhone Safari golden path is not recorded as verified.",
      nextAction:
        "Open the direct Tailscale-IP phone URL on iPhone Safari and complete board, score, Ops, and export checks.",
      items: ["Physical iPhone Safari"],
      copyText: buildIphoneSafariChecklist(),
      done: false,
    });
  }

  return tasks;
}

export function buildCommissionerTaskSummary(tasks: CommissionerTask[]) {
  if (tasks.length === 0) {
    return "DJDI commissioner tasks:\nNo open tasks.";
  }
  return [
    "DJDI commissioner tasks:",
    ...tasks.map(
      (task, index) =>
        `${index + 1}. ${task.title} (${task.severity}): ${task.detail} Next: ${task.nextAction}`
    ),
  ].join("\n");
}

export function buildCommissionerRequestPacket(tasks: CommissionerTask[]) {
  const copyReadyTasks = tasks.filter((task) => task.copyText);
  if (copyReadyTasks.length === 0) {
    return "DJDI request packet:\nNo outbound asks are open.";
  }
  const tailnetVerified = !tasks.some((task) => task.id === "verify-tailnet-url");
  const accessLines = tailnetVerified
      ? [
        "Primary phone URL for people with Tailscale access: http://100.102.92.28:3131",
        "Clean MagicDNS URL, if iPhone DNS is working: https://duckbookpro.clouded-tailor.ts.net",
        "Private Tailscale hosting is the working access path; no public production URL is required unless DJDI_REQUIRE_PRODUCTION_URL=1.",
      ]
    : [];

  return [
    "DJDI request packet",
    "Paste replies back into Ops > One-Paste Intake when they come in.",
    ...accessLines,
    "",
    ...copyReadyTasks.flatMap((task, index) => [
      `[${index + 1}. ${task.title}]`,
      task.copyText ?? "",
      "",
    ]),
  ]
    .join("\n")
    .trimEnd();
}
