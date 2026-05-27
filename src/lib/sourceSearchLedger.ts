export type SourceSearchClaimType = "fact" | "inference";
export type SourceSearchStatus = "recorded" | "not_found" | "blocked" | "inferred";

export type SourceSearchEntry = {
  id: string;
  area: "Money" | "Roster" | "Schedule" | "Messaging" | "Risk";
  claimType: SourceSearchClaimType;
  status: SourceSearchStatus;
  claim: string;
  sourceChecked: string;
  result: string;
  decision: string;
  evidenceIds: string[];
  relatedOpenItems: string[];
};

export const SOURCE_SEARCH_AS_OF = "2026-05-19T21:18:34.000Z";

export const SOURCE_SEARCH_LEDGER: SourceSearchEntry[] = [
  {
    id: "matt-buyin-venmo",
    area: "Money",
    claimType: "fact",
    status: "recorded",
    claim: "Matt paid Jayson Post for the 2026 golf league.",
    sourceChecked:
      "Gmail message 19e3d2eb91da7bf9, subject You paid Jayson Post $320.00.",
    result:
      "Venmo email shows $320.00, memo Golf league 2026 minus $5 CTP, completed May 18, 2026, transaction 4600102340972484060.",
    decision:
      "Recorded Matt as paid with a $325 league buy-in row and note that the Venmo transfer netted out $5 CTP.",
    evidenceIds: ["gmail:19e3d2eb91da7bf9", "venmo:4600102340972484060"],
    relatedOpenItems: [],
  },
  {
    id: "matt-ghin-cga",
    area: "Roster",
    claimType: "fact",
    status: "recorded",
    claim: "Matt's current GHIN index is 5.5.",
    sourceChecked:
      "Gmail message 19e2628024f73392, CGA/GHIN newsletter dated 2026-05-14.",
    result:
      "Email shows Matt Henderson, GHIN 7796292, and 2026-05-14 index information of 5.5.",
    decision: "Recorded Matt handicap and roster source note.",
    evidenceIds: ["gmail:19e2628024f73392", "ghin:7796292"],
    relatedOpenItems: [],
  },
  {
    id: "missing-ghin-searches",
    area: "Roster",
    claimType: "fact",
    status: "not_found",
    claim:
      "No source-backed GHIN values were found for Beck, Chris, John, Noah, Ryan, or Will.",
    sourceChecked:
      "Exact Gmail searches for each missing player plus GHIN/handicap terms; refreshed 2026-05-19T21:18Z with newer_than:7d Gmail search for Beck, Chris, John, Noah, Ryan, Will, GHIN, handicap, and index terms.",
    result:
      "Searches returned no matching player GHIN evidence. Latest refresh found TheGrint/USGA/CGA promotional or Matt-only messages, not DJDI handicap indexes for the six missing players.",
    decision: "Left those six GHIN indexes open.",
    evidenceIds: [],
    relatedOpenItems: ["roster-ghin"],
  },
  {
    id: "additional-buyin-searches",
    area: "Money",
    claimType: "fact",
    status: "not_found",
    claim: "No additional source-backed 2026 DJDI buy-ins were found in Gmail.",
    sourceChecked:
      "Gmail searches for Venmo, PayPal, Zelle, cash, paid, buy-in/buyin, DJDI, golf league, 2026, Jayson, and roster names; refreshed 2026-05-19T21:18Z with newer_than:1d Gmail search for DJDI, golf league, GHIN, handicap, Venmo, Zelle, buyin, buy-in, Mid-season major, and championship.",
    result:
      "Matt's Venmo email was usable. Latest refresh still surfaced the unrelated $110.00 Venmo with no DJDI buy-in context plus unrelated/non-DJDI golf-league and match-play emails; no additional DJDI buy-in proof was found.",
    decision: "Left 11 buy-ins outstanding.",
    evidenceIds: [],
    relatedOpenItems: ["money-collected"],
  },
  {
    id: "major-championship-calendar-drive-searches",
    area: "Schedule",
    claimType: "fact",
    status: "not_found",
    claim:
      "Calendar and Drive did not provide confirmed DJDI major/championship details.",
    sourceChecked:
      "Google Calendar searches for DJDI, golf league, Mid-season major, and Championship across the remaining 2026 window; Google Drive searches for DJDI and DJDI Golf Board; refreshed 2026-05-19T21:18Z.",
    result:
      "Calendar DJDI/golf league/Mid-season major/Championship search returned no events. Drive DJDI search returned the Golf 2026 Knowledge Base/source map, not confirmed DJDI major or championship details.",
    decision: "Left the mid-season major and championship details as TBD.",
    evidenceIds: [],
    relatedOpenItems: ["schedule-confirmed"],
  },
  {
    id: "messages-access-denied",
    area: "Messaging",
    claimType: "fact",
    status: "blocked",
    claim: "Local Messages could not be used as a source in this run.",
    sourceChecked: "Direct local read attempt against ~/Library/Messages/chat.db.",
    result: "macOS denied access with authorization denied.",
    decision:
      "Do not claim group-chat confirmation from Messages until access is granted or replies are pasted into Ops.",
    evidenceIds: [],
    relatedOpenItems: ["roster-ghin", "money-collected", "schedule-confirmed"],
  },
  {
    id: "remaining-data-gaps-require-replies",
    area: "Risk",
    claimType: "inference",
    status: "inferred",
    claim:
      "Remaining GHIN, payment, and schedule gaps likely require player replies, group-chat evidence, or commissioner confirmation.",
    sourceChecked:
      "Combined result of the Gmail, Calendar, Drive, local-file, and Messages checks.",
    result: "No additional direct evidence was available in the searched sources.",
    decision: "Keep the request packet and Ops tasks as the active path for those facts.",
    evidenceIds: [],
    relatedOpenItems: ["roster-ghin", "money-collected", "schedule-confirmed"],
  },
];

export function sourceSearchSummary(entries: SourceSearchEntry[]) {
  return {
    asOf: SOURCE_SEARCH_AS_OF,
    count: entries.length,
    recordedFacts: entries.filter(
      (entry) => entry.claimType === "fact" && entry.status === "recorded"
    ).length,
    noSourceFound: entries.filter((entry) => entry.status === "not_found").length,
    blockedSources: entries.filter((entry) => entry.status === "blocked").length,
    inferences: entries.filter((entry) => entry.claimType === "inference").length,
    relatedOpenItems: Array.from(
      new Set(entries.flatMap((entry) => entry.relatedOpenItems))
    ).sort(),
  };
}
