// ============================================================
// TYPES
// ============================================================
export type Claim = { name: string; claimedAt: string; profileSubjectId?: string | null };
export type Interest = { name: string; interestedAt: string; profileSubjectId?: string | null };
export type Comment = {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  editedAt?: string | null;
  profileSubjectId?: string | null;
};
export type Score = {
  name: string;
  gross: number;
  net?: number | null;
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
  enteredBy?: string | null;
  attestationStatus?: "draft" | "pending" | "attested" | "overridden";
  attestedAt?: string | null;
  attestationActor?: string | null;
  courseHcpSource?: string | null;
  courseHcpVerifiedAt?: string | null;
  courseHcpOverride?: boolean;
  roundCourse?: string | null;
  roundDate?: string | null;
  teeName?: string | null;
  teeRating?: number | null;
  teeSlope?: number | null;
  teePar?: number | null;
  handicapIndexUsed?: number | null;
  calculatedCourseHcp?: number | null;
  courseHcpRounded?: number | null;
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
  comments: Comment[];
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
  profileSubjectId?: string | null;
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
  handicapSource?: string | null;
  handicapNote?: string | null;
  ghinNumber?: string | null;
  handicapSourceType?: string | null;
  handicapVerifiedAt?: string | null;
  handicapVerifiedBy?: string | null;
  handicapVerified?: boolean;
  /** True for full league members (paid the season buy-in, eligible for
   *  season points + post-season, can attest other members' scores).
   *  False = drop-in (one-tournament guest of a member). */
  member: boolean;
  updatedAt: string;
};

export type Buyin = {
  playerName: string;
  amount: number;
  paid: boolean;
  paymentStatus?: "unpaid" | "promised" | "paid" | "comped" | "refunded" | "disputed";
  paymentMethod?: string | null;
  paymentActor?: string | null;
  paidAt: string | null;
  notes: string | null;
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
  closedAt?: string | null;
  closedBy?: string | null;
  winnerSnapshot?: unknown[];
  payoutConfirmed?: boolean;
  payoutPaidAt?: string | null;
  closeoutNotes?: string | null;
  payoutEvidenceNote?: string | null;
};
