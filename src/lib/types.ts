// ============================================================
// TYPES
// ============================================================
export type Claim = { name: string; claimedAt: string };
export type Interest = { name: string; interestedAt: string };
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
