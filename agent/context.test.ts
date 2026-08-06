import assert from "node:assert/strict";
import test from "node:test";
import { buildLeagueContext, type RawLeagueData } from "./context";

// 2026-08-05T18:00:00Z = 2026-08-05 12:00 in Denver (MDT, UTC-6).
const NOON_DENVER = new Date("2026-08-05T18:00:00.000Z");

const emptyRaw = (): RawLeagueData => ({
  teeTimes: [],
  players: [],
  tournaments: [],
  polls: [],
});

const teeTime = (
  course: string,
  date: string,
  spots = 4,
  claimCount = 0,
  time = "08:00"
) => ({
  course,
  date,
  time,
  spots,
  claims: Array.from({ length: claimCount }, (_, i) => ({ name: `P${i}` })),
});

const tournament = (
  name: string,
  course: string,
  windowStart: string,
  windowEnd: string,
  type = "regular"
) => ({ name, course, windowStart, windowEnd, type });

test("computes today and weekday in America/Denver", () => {
  const ctx = buildLeagueContext(emptyRaw(), "Matt", NOON_DENVER);
  assert.equal(ctx.today, "2026-08-05");
  assert.equal(ctx.weekday, "Wednesday");
  assert.equal(ctx.senderName, "Matt");
});

test("UTC-midnight boundary: Denver is still the previous day", () => {
  // 2026-08-06T03:00Z = 2026-08-05 21:00 in Denver (MDT).
  const ctx = buildLeagueContext(emptyRaw(), "Matt", new Date("2026-08-06T03:00:00.000Z"));
  assert.equal(ctx.today, "2026-08-05");
  assert.equal(ctx.weekday, "Wednesday");
});

test("handles MST (winter) offset, not just MDT", () => {
  // 2026-01-15T06:59Z = 2026-01-14 23:59 in Denver (MST, UTC-7).
  const before = buildLeagueContext(emptyRaw(), "Matt", new Date("2026-01-15T06:59:00.000Z"));
  assert.equal(before.today, "2026-01-14");
  assert.equal(before.weekday, "Wednesday");
  const after = buildLeagueContext(emptyRaw(), "Matt", new Date("2026-01-15T07:01:00.000Z"));
  assert.equal(after.today, "2026-01-15");
  assert.equal(after.weekday, "Thursday");
});

test("dedups courses case-insensitively across tournaments and tee times, most recent first", () => {
  const raw: RawLeagueData = {
    ...emptyRaw(),
    tournaments: [
      tournament("W1", "Common Ground", "2026-05-01", "2026-05-24"),
      tournament("W2", "Colorado National", "2026-05-25", "2026-06-14"),
    ],
    teeTimes: [
      teeTime("common ground", "2026-08-01"), // dupe of tournament course, newer
      teeTime("Riverdale Dunes", "2026-07-30"),
    ],
  };
  const ctx = buildLeagueContext(raw, "Matt", NOON_DENVER);
  assert.deepEqual(ctx.courses, ["common ground", "Riverdale Dunes", "Colorado National"]);
});

test("caps the course list at 15", () => {
  const raw: RawLeagueData = {
    ...emptyRaw(),
    teeTimes: Array.from({ length: 18 }, (_, i) =>
      teeTime(`Course ${i}`, `2026-07-${String(i + 10).padStart(2, "0")}`)
    ),
  };
  const ctx = buildLeagueContext(raw, "Matt", NOON_DENVER);
  assert.equal(ctx.courses.length, 15);
  assert.equal(ctx.courses[0], "Course 17"); // most recent date first
});

test("computes open spots as spots minus claims", () => {
  const raw: RawLeagueData = {
    ...emptyRaw(),
    teeTimes: [teeTime("Common Ground", "2026-08-08", 4, 3, "07:30")],
  };
  const ctx = buildLeagueContext(raw, "Matt", NOON_DENVER);
  assert.deepEqual(ctx.teeTimes, [
    { course: "Common Ground", date: "2026-08-08", time: "07:30", open: 1 },
  ]);
});

test("keeps tee times from the last 10 days and drops older ones", () => {
  // today = 2026-08-05 → cutoff = 2026-07-26.
  const raw: RawLeagueData = {
    ...emptyRaw(),
    teeTimes: [
      teeTime("Too Old", "2026-07-25"),
      teeTime("At Cutoff", "2026-07-26"),
      teeTime("Future", "2026-08-09"),
    ],
  };
  const ctx = buildLeagueContext(raw, "Matt", NOON_DENVER);
  assert.deepEqual(
    ctx.teeTimes.map((t) => t.course),
    ["At Cutoff", "Future"]
  );
});

test("lists member players before drop-ins", () => {
  const raw: RawLeagueData = {
    ...emptyRaw(),
    players: [
      { name: "Guest One", member: false },
      { name: "Matt Henderson", member: true },
      { name: "Jayson Post", member: true },
      { name: "Guest Two", member: false },
    ],
  };
  const ctx = buildLeagueContext(raw, "Matt", NOON_DENVER);
  assert.deepEqual(ctx.players, [
    "Matt Henderson",
    "Jayson Post",
    "Guest One",
    "Guest Two",
  ]);
});

test("passes polls through as prompt + options", () => {
  const raw: RawLeagueData = {
    ...emptyRaw(),
    polls: [{ prompt: "Sat or Sun?", options: ["Saturday", "Sunday"] }],
  };
  const ctx = buildLeagueContext(raw, "Matt", NOON_DENVER);
  assert.deepEqual(ctx.polls, [
    { prompt: "Sat or Sun?", options: ["Saturday", "Sunday"] },
  ]);
});

test("selects the live stop whose window contains today, skipping post-season", () => {
  const raw: RawLeagueData = {
    ...emptyRaw(),
    tournaments: [
      tournament("Ended", "Old Course", "2026-07-01", "2026-07-20"),
      tournament("Championship", "Post Course", "2026-08-01", "2026-08-31", "post"),
      tournament("Week 5", "Riverdale Dunes", "2026-08-01", "2026-08-23"),
    ],
  };
  const ctx = buildLeagueContext(raw, "Matt", NOON_DENVER);
  assert.deepEqual(ctx.liveStop, {
    name: "Week 5",
    course: "Riverdale Dunes",
    windowEnd: "2026-08-23",
  });
});

test("liveStop includes window boundary days and is null outside every window", () => {
  const boundary: RawLeagueData = {
    ...emptyRaw(),
    tournaments: [tournament("Ends Today", "Course A", "2026-07-20", "2026-08-05")],
  };
  assert.equal(
    buildLeagueContext(boundary, "Matt", NOON_DENVER).liveStop?.name,
    "Ends Today"
  );
  const none: RawLeagueData = {
    ...emptyRaw(),
    tournaments: [tournament("Past", "Course A", "2026-07-01", "2026-07-20")],
  };
  assert.equal(buildLeagueContext(none, "Matt", NOON_DENVER).liveStop, null);
});

test("does not mutate its inputs", () => {
  const raw: RawLeagueData = {
    ...emptyRaw(),
    teeTimes: [teeTime("Common Ground", "2026-08-08", 4, 1)],
    players: [
      { name: "Guest", member: false },
      { name: "Matt Henderson", member: true },
    ],
    polls: [{ prompt: "Q?", options: ["A", "B"] }],
  };
  const snapshot = JSON.stringify(raw);
  buildLeagueContext(raw, "Matt", NOON_DENVER);
  assert.equal(JSON.stringify(raw), snapshot);
});
