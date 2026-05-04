// ============================================================
// TYPES
// ============================================================
export type Claim = { name: string; claimedAt: string };
export type TeeTime = {
  id: string;
  course: string;
  date: string;
  time: string;
  spots: number;
  host: string;
  notes: string | null;
  claims: Claim[];
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
