import { rankNetScores, type RankedNetEntry } from "./leaguePoints";

export type OfficialTournamentResultRow = RankedNetEntry<{
  name: string;
  net: number;
}>;

export type OfficialTournamentResults = {
  status: "final";
  results: OfficialTournamentResultRow[];
};

const finalBoard = (
  entries: readonly { name: string; net: number }[]
): OfficialTournamentResults => ({
  status: "final",
  results: rankNetScores(entries),
});

/**
 * Published league boards supersede score-derived results for these events.
 * This keeps historical standings stable even when the underlying tee-time
 * records are incomplete or were entered before the app was in use.
 */
export const OFFICIAL_TOURNAMENT_RESULTS: Record<
  string,
  OfficialTournamentResults
> = {
  "2026-w1": finalBoard([
    { name: "Matt Henderson", net: 69 },
    { name: "Jayson Post", net: 70 },
    { name: "Noah Solomon", net: 70 },
    { name: "Will Senofsky", net: 70 },
    { name: "Jonny ten Bosch", net: 73 },
    { name: "Sam Lines", net: 73 },
    { name: "John Carroll", net: 73 },
    { name: "Kyle Dantzler", net: 75 },
    { name: "Max McCutcheon", net: 77 },
    { name: "Ryan Theret", net: 81 },
    { name: "Chris Moore", net: 83 },
    { name: "Beck Nygard", net: 84 },
  ]),
  "2026-w2": finalBoard([
    { name: "Jonny ten Bosch", net: 70 },
    { name: "Sam Lines", net: 71 },
    { name: "Noah Solomon", net: 71 },
    { name: "Jayson Post", net: 73 },
    { name: "Matt Henderson", net: 75 },
    { name: "Max McCutcheon", net: 76 },
    { name: "Beck Nygard", net: 76 },
    { name: "Kyle Dantzler", net: 77 },
    { name: "Will Senofsky", net: 79 },
    { name: "John Carroll", net: 81 },
    { name: "Chris Moore", net: 83 },
  ]),
  "2026-w3": finalBoard([
    { name: "Kyle Dantzler", net: 70 },
    { name: "Noah Solomon", net: 71 },
    { name: "Sam Lines", net: 71 },
    { name: "Jayson Post", net: 72 },
    { name: "Will Senofsky", net: 74 },
    { name: "John Carroll", net: 74 },
    { name: "Beck Nygard", net: 77 },
    { name: "Matt Henderson", net: 79 },
    { name: "Jonny ten Bosch", net: 80 },
    { name: "Max McCutcheon", net: 83 },
    { name: "Chris Moore", net: 83 },
  ]),
};

export function getOfficialTournamentResults(
  tournamentId: string
): OfficialTournamentResults | undefined {
  return OFFICIAL_TOURNAMENT_RESULTS[tournamentId];
}

export function hasOfficialTournamentResults(tournamentId: string): boolean {
  return tournamentId in OFFICIAL_TOURNAMENT_RESULTS;
}
