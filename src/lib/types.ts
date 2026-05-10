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
