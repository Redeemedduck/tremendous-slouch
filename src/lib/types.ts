// ============================================================
// TYPES
// ============================================================
export type Claim = { name: string; claimedAt: string };
export type Interest = { name: string; interestedAt: string };
export type Score = {
  name: string;
  gross: number;
  /** Course handicap as displayed in GHIN for this round's tee/course. Per-
   *  round because slope and rating differ by course. Optional; when null we
   *  fall back to the player's GHIN index for net display in non-league
   *  rounds. League scoring (tee times inside a tournament window) requires
   *  this to be present — server enforces in COL-107. */
  courseHcp?: number | null;
  /** Name of the league member who corroborates this score. Required for
   *  rounds inside a regular-tournament window per the league rule that
   *  another member must have played in your group. Server validates that
   *  the attester is (a) on the same tee time's claims, (b) a registered
   *  member, and (c) not the scorer themselves. */
  attestedBy?: string | null;
  recordedAt: string;
};
export type TeeTime = {
  id: string;
  course: string;
  date: string;
  time: string;
  spots: number;
  host: string;
  notes: string | null;
  claims: Claim[];
  interested: Interest[];
  scores: Score[];
  createdAt: string;
};
export type NewTeeTimeInput = {
  course: string;
  date: string;
  time: string;
  spots: number;
  host: string;
  notes?: string;
};

export type PollResponse = {
  name: string;
  optionIdx: number;
  respondedAt: string;
};
export type Poll = {
  id: string;
  prompt: string;
  options: string[];
  responses: PollResponse[];
  host: string;
  createdAt: string;
};
export type NewPollInput = {
  prompt: string;
  options: string[];
  host: string;
};

export type Player = {
  name: string;
  handicap: number | null;
  /** True for full league members (paid the season buy-in, eligible for
   *  season points + post-season, can attest other members' scores).
   *  False = drop-in (one-tournament guest of a member). */
  member: boolean;
  updatedAt: string;
};

export type TournamentType = "regular" | "major" | "post";
export type Tournament = {
  id: string;
  name: string;
  course: string;
  windowStart: string;
  windowEnd: string;
  type: TournamentType;
  pointsToFirst: number | null;
  payoutFirst: number | null;
  payoutSecond: number | null;
  payoutThird: number | null;
  notes: string | null;
  createdAt: string;
};
