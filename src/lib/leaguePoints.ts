export const POSITION_POINTS = [
  20,
  15,
  14,
  11,
  9,
  8,
  7,
  6,
  5,
  4,
  3,
  2,
] as const;

const roundPoints = (value: number): number => Math.round(value * 100) / 100;

export const pointsForPosition = (position: number): number =>
  position >= 1 && position <= POSITION_POINTS.length
    ? POSITION_POINTS[position - 1]
    : 0;

/**
 * Split the points assigned to every occupied finishing position equally
 * among all players in the tie. For example, a three-way tie for second
 * shares the 2nd, 3rd, and 4th-place points: (15 + 14 + 11) / 3 = 13.33.
 */
export function pointsForTie(startPosition: number, playerCount: number): number {
  if (!Number.isInteger(startPosition) || startPosition < 1) return 0;
  if (!Number.isInteger(playerCount) || playerCount < 1) return 0;

  let total = 0;
  for (let offset = 0; offset < playerCount; offset += 1) {
    total += pointsForPosition(startPosition + offset);
  }
  return roundPoints(total / playerCount);
}

export type NetEntry = {
  name: string;
  net: number;
};

export type RankedNetEntry<T extends NetEntry = NetEntry> = T & {
  position: number;
  points: number;
};

/**
 * Rank lowest-net entries using competition ranks (1, 2, 2, 4) and attach
 * the correctly split DJDI points for every tie group.
 */
export function rankNetScores<T extends NetEntry>(
  entries: readonly T[]
): RankedNetEntry<T>[] {
  const sorted = entries
    .map((entry, originalIndex) => ({ entry, originalIndex }))
    .sort(
      (a, b) =>
        a.entry.net - b.entry.net || a.originalIndex - b.originalIndex
    );

  const ranked: RankedNetEntry<T>[] = [];
  let index = 0;
  while (index < sorted.length) {
    let end = index + 1;
    while (end < sorted.length && sorted[end].entry.net === sorted[index].entry.net) {
      end += 1;
    }

    const position = index + 1;
    const tieSize = end - index;
    const points = pointsForTie(position, tieSize);
    for (let cursor = index; cursor < end; cursor += 1) {
      ranked.push({
        ...sorted[cursor].entry,
        position,
        points,
      });
    }
    index = end;
  }

  return ranked;
}

export function formatPoints(points: number): string {
  return Number.isInteger(points)
    ? String(points)
    : points.toFixed(2).replace(/0$/, "");
}
