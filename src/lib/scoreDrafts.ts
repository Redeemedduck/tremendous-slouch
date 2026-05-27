export type ScoreDraft = {
  gross: string;
  courseHcp: string;
  attestedBy: string;
};

export type ScoreRecordTask = {
  name: string;
  gross: number;
  courseHcp: number | null;
  attestedBy: string | null;
};

export type ScoreSummaryMatch = {
  name: string;
  gross: number;
  net: number | null;
  courseHcp: number | null;
  source: string;
};

export type FillAttestersResult = {
  drafts: Record<string, ScoreDraft>;
  filled: number;
  skippedSelf: number;
  error?: string;
};

export type TeeHandicapInputs = {
  teeRating: number | null;
  teeSlope: number | null;
  teePar: number | null;
};

export type FillCourseHandicapsResult = {
  drafts: Record<string, ScoreDraft>;
  filled: number;
  missingIndexes: string[];
  preservedManual: number;
  overwrittenManual: number;
  error?: string;
};

export type ScoreDraftValidation =
  | { ok: true; tasks: ScoreRecordTask[] }
  | { ok: false; error: string };

export function validateScoreDrafts(
  drafts: Record<string, ScoreDraft>,
  {
    isLeagueRound,
    isMember,
  }: {
    isLeagueRound: boolean;
    isMember: (name: string) => boolean;
  }
): ScoreDraftValidation {
  const tasks: ScoreRecordTask[] = [];

  for (const [name, raw] of Object.entries(drafts)) {
    const grossStr = raw.gross.trim();
    const hcpStr = raw.courseHcp.trim();
    const attestedBy = raw.attestedBy.trim();
    if (!grossStr && !hcpStr && !attestedBy) continue;

    if (isLeagueRound && !isMember(name)) {
      return {
        ok: false,
        error: `${name}: mark as a member in Roster before league scoring`,
      };
    }

    if (!grossStr) {
      return { ok: false, error: `${name}: score is required` };
    }

    const gross = Number(grossStr);
    if (!Number.isInteger(gross) || gross < 1 || gross > 300) {
      return {
        ok: false,
        error: `${name}: score must be a whole number between 1 and 300`,
      };
    }

    let courseHcp: number | null = null;
    if (hcpStr) {
      const hcp = Number(hcpStr);
      if (!Number.isInteger(hcp) || hcp < -10 || hcp > 54) {
        return {
          ok: false,
          error: `${name}: course handicap must be a whole number between -10 and 54`,
        };
      }
      courseHcp = hcp;
    } else if (isLeagueRound) {
      return {
        ok: false,
        error: `${name}: league rounds need a course handicap (from GHIN)`,
      };
    }

    if (isLeagueRound && !attestedBy) {
      return {
        ok: false,
        error: `${name}: league rounds need an attester (another member)`,
      };
    }

    tasks.push({
      name,
      gross,
      courseHcp,
      attestedBy: attestedBy || null,
    });
  }

  if (tasks.length === 0) {
    return { ok: false, error: "Enter at least one score" };
  }

  return { ok: true, tasks };
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

export function calculateRoundedCourseHandicap({
  handicapIndex,
  teeRating,
  teeSlope,
  teePar,
}: {
  handicapIndex: number;
  teeRating: number;
  teeSlope: number;
  teePar: number;
}) {
  return Math.round(handicapIndex * (teeSlope / 113) + teeRating - teePar);
}

export function fillScoreDraftCourseHandicaps(
  drafts: Record<string, ScoreDraft>,
  {
    claimNames,
    teeInputs,
    isMember,
    getHandicap,
    overwriteExisting = false,
  }: {
    claimNames: string[];
    teeInputs: TeeHandicapInputs;
    isMember: (name: string) => boolean;
    getHandicap: (name: string) => number | null;
    overwriteExisting?: boolean;
  }
): FillCourseHandicapsResult {
  const { teeRating, teeSlope, teePar } = teeInputs;
  if (teeRating == null || teeSlope == null || teePar == null) {
    return {
      drafts,
      filled: 0,
      missingIndexes: [],
      preservedManual: 0,
      overwrittenManual: 0,
      error: "Enter rating, slope, and par first",
    };
  }

  let filled = 0;
  let preservedManual = 0;
  let overwrittenManual = 0;
  const missingIndexes: string[] = [];
  const next = { ...drafts };

  for (const name of claimNames) {
    if (!isMember(name)) continue;
    const draft = next[name] ?? { gross: "", courseHcp: "", attestedBy: "" };
    const handicapIndex = getHandicap(name);
    if (handicapIndex == null) {
      if (draft.courseHcp.trim()) preservedManual += 1;
      missingIndexes.push(name);
      continue;
    }

    if (draft.courseHcp.trim()) {
      if (!overwriteExisting) {
        preservedManual += 1;
        continue;
      }
      overwrittenManual += 1;
    }
    next[name] = {
      ...draft,
      courseHcp: String(
        calculateRoundedCourseHandicap({
          handicapIndex,
          teeRating,
          teeSlope,
          teePar,
        })
      ),
    };
    filled += 1;
  }

  return {
    drafts: next,
    filled,
    missingIndexes,
    preservedManual,
    overwrittenManual,
  };
}

export function fillScoreDraftAttesters(
  drafts: Record<string, ScoreDraft>,
  {
    claimNames,
    attester,
    isMember,
  }: {
    claimNames: string[];
    attester: string;
    isMember: (name: string) => boolean;
  }
): FillAttestersResult {
  const selected = claimNames.find(
    (name) => normalize(name) === normalize(attester)
  );
  if (!selected) {
    return { drafts, filled: 0, skippedSelf: 0, error: "Choose an attester" };
  }
  if (!isMember(selected)) {
    return {
      drafts,
      filled: 0,
      skippedSelf: 0,
      error: `${selected} is not a league member`,
    };
  }

  let filled = 0;
  let skippedSelf = 0;
  const next = { ...drafts };

  for (const name of claimNames) {
    const draft = next[name] ?? { gross: "", courseHcp: "", attestedBy: "" };
    if (!draft.gross.trim()) continue;
    if (draft.attestedBy.trim()) continue;
    if (!isMember(name)) continue;
    if (normalize(name) === normalize(selected)) {
      skippedSelf += 1;
      continue;
    }

    next[name] = { ...draft, attestedBy: selected };
    filled += 1;
  }

  return { drafts: next, filled, skippedSelf };
}

function matchScoreName(line: string, names: string[]) {
  const lower = normalize(line);
  const exact = [...names]
    .sort((a, b) => b.length - a.length)
    .find((name) => lower.includes(normalize(name)));
  if (exact) return exact;

  return names.find((name) => {
    const first = normalize(name).split(/\s+/)[0];
    return first.length >= 3 && new RegExp(`\\b${first}\\b`, "i").test(line);
  });
}

export function parseScoreSummaryIntake(
  text: string,
  names: string[]
): ScoreSummaryMatch[] {
  const matches = new Map<string, ScoreSummaryMatch>();
  for (const source of text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)) {
    const name = matchScoreName(source, names);
    if (!name) continue;
    const afterName = source.slice(
      normalize(source).indexOf(normalize(name)) >= 0
        ? normalize(source).indexOf(normalize(name)) + name.length
        : 0
    );
    const scoreMatch = afterName.match(/\b(\d{1,3})\b(?:\s*\((\d{1,3})\))?/);
    if (!scoreMatch) continue;
    const gross = Number(scoreMatch[1]);
    const net = scoreMatch[2] == null ? null : Number(scoreMatch[2]);
    if (!Number.isInteger(gross) || gross < 1 || gross > 300) continue;
    let courseHcp: number | null = null;
    if (net != null) {
      courseHcp = gross - net;
      if (courseHcp < -10 || courseHcp > 54) continue;
    }
    matches.set(normalize(name), { name, gross, net, courseHcp, source });
  }
  return Array.from(matches.values());
}
