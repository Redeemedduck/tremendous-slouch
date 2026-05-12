import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const BASE = "http://localhost:3000";
const VIEWPORT = { width: 393, height: 852 }; // iPhone 14 Pro
const OUT = path.resolve("screenshots");

async function setProfileInLocalStorage(
  page: import("playwright").Page,
  name: string,
  handicap: number | null
) {
  await page.evaluate(
    ([n, h]) => {
      localStorage.setItem("golf.coordinator.myName", n as string);
      if (h != null) localStorage.setItem("golf.coordinator.myHandicap", String(h));
      else localStorage.removeItem("golf.coordinator.myHandicap");
    },
    [name, handicap] as const
  );
}

async function clearProfileInLocalStorage(page: import("playwright").Page) {
  await page.evaluate(() => {
    localStorage.removeItem("golf.coordinator.myName");
    localStorage.removeItem("golf.coordinator.myHandicap");
  });
}

async function api(method: string, p: string, body?: any) {
  const r = await fetch(`${BASE}${p}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
}

function tomorrowISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function nextWeekISO() {
  const d = new Date();
  d.setDate(d.getDate() + 8);
  return d.toISOString().slice(0, 10);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();

  // The server pre-seeds two Common Ground tee times for the first weekend
  // of the season. For the empty-state screenshots we want a truly empty
  // board, so delete them up-front. (The other shots re-seed the data they
  // need.)
  await api("DELETE", "/api/teetimes/seed-2026-w1-1240");
  await api("DELETE", "/api/teetimes/seed-2026-w1-1250");

  // 1. Empty state, no profile
  await page.goto(BASE);
  await clearProfileInLocalStorage(page);
  await page.reload();
  await page.waitForSelector("text=Nothing on the board yet");
  await page.screenshot({ path: path.join(OUT, "01-empty-no-name.png") });

  // 2. Empty state, with profile set (Mike, 12.4)
  await setProfileInLocalStorage(page, "Mike", 12.4);
  await page.reload();
  await page.waitForSelector("text=Nothing on the board yet");
  await page.screenshot({ path: path.join(OUT, "02-empty-with-name.png") });

  // Seed players with handicaps + member flags so chips, standings, and
  // the roster view all have content.
  await api("PUT", "/api/players/Greg", { handicap: 8.0, member: true });
  await api("PUT", "/api/players/Mike", { handicap: 12.4, member: true });
  await api("PUT", "/api/players/Sam", { handicap: 18.6, member: true });
  await api("PUT", "/api/players/Alex", { handicap: 4.2, member: true });
  await api("PUT", "/api/players/Lee", { handicap: 22.0, member: true });
  await api("PUT", "/api/players/Chris", { handicap: 9.5, member: true });
  await api("PUT", "/api/players/Jason", { handicap: 6.8, member: true });
  // Bob is a drop-in guest (Greg's college buddy)
  await api("PUT", "/api/players/Bob", { handicap: 14.7, member: false });

  // Seed: a tee time and a poll
  const tt1 = await api("POST", "/api/teetimes", {
    course: "Walnut Creek",
    date: tomorrowISO(),
    time: "08:00",
    spots: 4,
    host: "Greg",
    notes: "Meet at the range at 7:30",
  });
  const id1 = tt1.teeTime.id;
  await api("POST", `/api/teetimes/${id1}/claims`, { name: "Sam" });
  await api("POST", `/api/teetimes/${id1}/interested`, { name: "Lee" });

  const tt2 = await api("POST", "/api/teetimes", {
    course: "Murphy Creek",
    date: nextWeekISO(),
    time: "13:30",
    spots: 4,
    host: "Alex",
  });
  const id2 = tt2.teeTime.id;
  await api("POST", `/api/teetimes/${id2}/claims`, { name: "Mike" });

  await api("POST", "/api/polls", {
    prompt: "Anyone want to play MC on the 15th or 22nd?",
    options: ["Sat May 15th", "Sat May 22nd", "Either works"],
    host: "Chris",
  });
  // Vote on the poll so we have content in the chips
  const pollList = await api("GET", "/api/polls");
  const pollId = pollList.polls[0].id;
  await api("POST", `/api/polls/${pollId}/responses`, {
    name: "Greg",
    optionIdx: 1,
  });
  await api("POST", `/api/polls/${pollId}/responses`, {
    name: "Sam",
    optionIdx: 2,
  });
  await api("POST", `/api/polls/${pollId}/responses`, {
    name: "Mike",
    optionIdx: 0,
  });
  await api("POST", `/api/polls/${pollId}/responses`, {
    name: "Mike",
    optionIdx: 2,
  });

  // 3. Populated board
  await page.reload();
  await page.waitForSelector("text=Walnut Creek");
  await page.screenshot({ path: path.join(OUT, "03-populated-board.png"), fullPage: true });

  // 4. FAB chooser open
  await page.locator("button[aria-label='New post']").click();
  await page.waitForSelector("text=Ask the group");
  await page.screenshot({ path: path.join(OUT, "04-fab-chooser-open.png") });

  // 5. New tee time sheet
  await page.locator("text=New tee time").last().click();
  await page.waitForSelector("text=Post tee time");
  await page.screenshot({ path: path.join(OUT, "05-new-teetime-sheet.png"), fullPage: true });
  await page.keyboard.press("Escape");

  // 6. New poll sheet
  await page.locator("button[aria-label='New post']").click();
  await page.waitForSelector("text=Ask the group");
  await page.locator("text=Ask the group").last().click();
  await page.waitForSelector("text=Post poll");
  await page.screenshot({ path: path.join(OUT, "06-new-poll-sheet.png"), fullPage: true });
  await page.keyboard.press("Escape");

  // 7. Past tee times with scores recorded — insert two past rows directly
  // and seed scores so the past card has a Scores block AND the standings
  // card has content.
  const sqlite3 = await import("better-sqlite3");
  const db = new (sqlite3 as any).default("golf_coordinator.db");
  db.prepare(
    `INSERT INTO tee_times (id, course, date, time, spots, host, notes, claims, interested, scores, created_at)
     VALUES (?, 'Walnut Creek', '2024-09-15', '08:00', 4, 'Greg', NULL,
             '[{"name":"Greg","claimedAt":"2024-09-15T00:00:00Z"},{"name":"Mike","claimedAt":"2024-09-15T00:00:00Z"},{"name":"Sam","claimedAt":"2024-09-15T00:00:00Z"},{"name":"Alex","claimedAt":"2024-09-15T00:00:00Z"}]',
             '[]',
             '[{"name":"Greg","gross":80,"recordedAt":"2024-09-15T13:00:00Z"},{"name":"Mike","gross":91,"recordedAt":"2024-09-15T13:00:00Z"},{"name":"Sam","gross":102,"recordedAt":"2024-09-15T13:00:00Z"},{"name":"Alex","gross":76,"recordedAt":"2024-09-15T13:00:00Z"}]',
             '2024-09-15T00:00:00Z')`
  ).run("past-1");
  db.prepare(
    `INSERT INTO tee_times (id, course, date, time, spots, host, notes, claims, interested, scores, created_at)
     VALUES (?, 'Murphy Creek', '2024-10-05', '13:30', 4, 'Alex', NULL,
             '[{"name":"Alex","claimedAt":"2024-10-05T00:00:00Z"},{"name":"Greg","claimedAt":"2024-10-05T00:00:00Z"},{"name":"Chris","claimedAt":"2024-10-05T00:00:00Z"}]',
             '[]',
             '[{"name":"Alex","gross":74,"recordedAt":"2024-10-05T18:00:00Z"},{"name":"Greg","gross":78,"recordedAt":"2024-10-05T18:00:00Z"},{"name":"Chris","gross":86,"recordedAt":"2024-10-05T18:00:00Z"}]',
             '2024-10-05T00:00:00Z')`
  ).run("past-2");
  db.close();

  await page.reload();
  await page.locator("text=Past tee times").click();
  await page.waitForSelector("text=Walnut Creek").catch(() => {});
  await page.screenshot({ path: path.join(OUT, "07-past-section-expanded.png"), fullPage: true });

  // 8. Standings expanded
  await page.locator("button:has-text('Standings')").click();
  await page.waitForSelector("text=Avg net");
  await page.screenshot({ path: path.join(OUT, "08-standings-expanded.png"), fullPage: true });

  // 9. Profile sheet open (handicap field visible)
  await page.locator("button[aria-label*='Playing as']").click();
  await page.waitForSelector("text=Your profile");
  await page.screenshot({ path: path.join(OUT, "09-profile-sheet.png"), fullPage: true });
  await page.keyboard.press("Escape");

  // 11. Season schedule expanded — shows the full season list with status
  // badges (active / upcoming / past).
  try {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator("button", { hasText: "Season" }).first().click({ timeout: 5000 });
    await page.waitForSelector("text=Stop 1", { timeout: 5000 });
    await page.screenshot({
      path: path.join(OUT, "11-season-schedule.png"),
      fullPage: true,
    });
  } catch (err) {
    console.warn("Skipped 11 (season schedule):", (err as Error).message);
  }

  // 12. Tournament card expanded — leaderboard + rounds-in-window. Need
  // some scores in a tournament window. Insert a real tournament round
  // directly via SQLite.
  try {
    const sqlite3b = await import("better-sqlite3");
    const db2 = new (sqlite3b as any).default("golf_coordinator.db");
    db2.prepare(
      `INSERT OR REPLACE INTO tee_times (id, course, date, time, spots, host, notes, claims, interested, scores, created_at)
       VALUES (?, 'Common Ground', '2026-05-16', '12:40', 4, 'Jason', NULL,
               '[{"name":"Jason","claimedAt":"2026-05-01T00:00:00Z"},{"name":"Greg","claimedAt":"2026-05-01T00:00:00Z"},{"name":"Mike","claimedAt":"2026-05-01T00:00:00Z"},{"name":"Bob","claimedAt":"2026-05-01T00:00:00Z"}]',
               '[]',
               '[{"name":"Jason","gross":78,"courseHcp":7,"recordedAt":"2026-05-16T19:00:00Z"},{"name":"Greg","gross":80,"courseHcp":9,"recordedAt":"2026-05-16T19:00:00Z"},{"name":"Mike","gross":86,"courseHcp":13,"recordedAt":"2026-05-16T19:00:00Z"},{"name":"Bob","gross":92,"courseHcp":15,"recordedAt":"2026-05-16T19:00:00Z"}]',
               '2026-05-01T00:00:00Z')`
    ).run("seed-2026-w1-1240");
    db2.close();

    await page.reload();
    await page.locator("button", { hasText: "Season" }).first().click({ timeout: 5000 });
    await page.locator("button", { hasText: "Stop 1" }).first().click({ timeout: 5000 });
    await page.waitForSelector("text=Leaderboard", { timeout: 5000 });
    await page.screenshot({
      path: path.join(OUT, "12-tournament-leaderboard.png"),
      fullPage: true,
    });
  } catch (err) {
    console.warn("Skipped 12 (tournament leaderboard):", (err as Error).message);
  }

  // 13. Roster expanded
  try {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator("button", { hasText: "Roster" }).first().click({ timeout: 5000 });
    await page.waitForSelector("text=Member", { timeout: 5000 });
    await page.screenshot({
      path: path.join(OUT, "13-roster.png"),
      fullPage: true,
    });
  } catch (err) {
    console.warn("Skipped 13 (roster):", (err as Error).message);
  }

  // 14. Finances / Pool card expanded — toggle Greg paid to show mixed
  // states.
  try {
    await api("PATCH", "/api/buyins/Greg", { paid: true });
    await api("PATCH", "/api/buyins/Mike", { paid: true });
    await api("PATCH", "/api/buyins/Jason", { paid: true });
    await page.reload();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator("button", { hasText: "Pool" }).first().click({ timeout: 5000 });
    await page.waitForSelector("text=Paid", { timeout: 5000 });
    await page.screenshot({
      path: path.join(OUT, "14-finances-pool.png"),
      fullPage: true,
    });
  } catch (err) {
    console.warn("Skipped 14 (finances):", (err as Error).message);
  }

  // 15. Standings sorted by Points — should show seed badges next to top 4.
  // Need scores across multiple regular tournaments. We already inserted a
  // Stop 1 round in shot 12; add a Stop 2 round so the points table has
  // content.
  try {
    const sqlite3c = await import("better-sqlite3");
    const db3 = new (sqlite3c as any).default("golf_coordinator.db");
    db3.prepare(
      `INSERT OR REPLACE INTO tee_times (id, course, date, time, spots, host, notes, claims, interested, scores, created_at)
       VALUES (?, 'Colorado National', '2026-06-01', '08:00', 4, 'Greg', NULL,
               '[{"name":"Greg","claimedAt":"2026-06-01T00:00:00Z"},{"name":"Mike","claimedAt":"2026-06-01T00:00:00Z"},{"name":"Alex","claimedAt":"2026-06-01T00:00:00Z"},{"name":"Sam","claimedAt":"2026-06-01T00:00:00Z"}]',
               '[]',
               '[{"name":"Greg","gross":76,"courseHcp":8,"attestedBy":"Alex","recordedAt":"2026-06-01T19:00:00Z"},{"name":"Mike","gross":85,"courseHcp":13,"attestedBy":"Alex","recordedAt":"2026-06-01T19:00:00Z"},{"name":"Alex","gross":74,"courseHcp":4,"attestedBy":"Greg","recordedAt":"2026-06-01T19:00:00Z"},{"name":"Sam","gross":96,"courseHcp":19,"attestedBy":"Greg","recordedAt":"2026-06-01T19:00:00Z"}]',
               '2026-06-01T00:00:00Z')`
    ).run("stop2-r1");
    db3.close();

    await page.reload();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator("button", { hasText: "Standings" }).first().click({ timeout: 5000 });
    // Points sort is the default; ensure it's active.
    await page.locator("button", { hasText: "Points" }).first().click({ timeout: 5000 });
    await page.waitForSelector("text=Pts", { timeout: 5000 });
    await page.screenshot({
      path: path.join(OUT, "15-standings-points.png"),
      fullPage: true,
    });
  } catch (err) {
    console.warn("Skipped 15 (standings-points):", (err as Error).message);
  }

  // 16. Post-season bracket — insert a Championship 2-day round and look
  // at the post-season tournament card.
  try {
    const sqlite3d = await import("better-sqlite3");
    const db4 = new (sqlite3d as any).default("golf_coordinator.db");
    db4.prepare(
      `INSERT OR REPLACE INTO tee_times (id, course, date, time, spots, host, notes, claims, interested, scores, created_at)
       VALUES (?, 'Championship', '2026-10-10', '08:00', 4, 'Jason', 'Day 1',
               '[{"name":"Jason","claimedAt":"2026-10-10T00:00:00Z"},{"name":"Greg","claimedAt":"2026-10-10T00:00:00Z"},{"name":"Alex","claimedAt":"2026-10-10T00:00:00Z"},{"name":"Mike","claimedAt":"2026-10-10T00:00:00Z"}]',
               '[]',
               '[{"name":"Jason","gross":78,"courseHcp":7,"attestedBy":"Greg","recordedAt":"2026-10-10T19:00:00Z"},{"name":"Greg","gross":80,"courseHcp":8,"attestedBy":"Jason","recordedAt":"2026-10-10T19:00:00Z"},{"name":"Alex","gross":74,"courseHcp":4,"attestedBy":"Mike","recordedAt":"2026-10-10T19:00:00Z"},{"name":"Mike","gross":85,"courseHcp":12,"attestedBy":"Alex","recordedAt":"2026-10-10T19:00:00Z"}]',
               '2026-10-10T00:00:00Z')`
    ).run("post-d1");
    db4.prepare(
      `INSERT OR REPLACE INTO tee_times (id, course, date, time, spots, host, notes, claims, interested, scores, created_at)
       VALUES (?, 'Championship', '2026-10-11', '08:00', 4, 'Jason', 'Day 2',
               '[{"name":"Jason","claimedAt":"2026-10-11T00:00:00Z"},{"name":"Greg","claimedAt":"2026-10-11T00:00:00Z"},{"name":"Alex","claimedAt":"2026-10-11T00:00:00Z"},{"name":"Mike","claimedAt":"2026-10-11T00:00:00Z"}]',
               '[]',
               '[{"name":"Jason","gross":76,"courseHcp":7,"attestedBy":"Greg","recordedAt":"2026-10-11T19:00:00Z"},{"name":"Greg","gross":79,"courseHcp":8,"attestedBy":"Jason","recordedAt":"2026-10-11T19:00:00Z"},{"name":"Alex","gross":75,"courseHcp":4,"attestedBy":"Mike","recordedAt":"2026-10-11T19:00:00Z"},{"name":"Mike","gross":82,"courseHcp":12,"attestedBy":"Alex","recordedAt":"2026-10-11T19:00:00Z"}]',
               '2026-10-11T00:00:00Z')`
    ).run("post-d2");
    db4.close();

    await page.reload();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator("button", { hasText: "Season" }).first().click({ timeout: 5000 });
    await page.locator("button", { hasText: "Championship" }).first().click({ timeout: 5000 });
    await page.waitForSelector("text=Post-season leaderboard", { timeout: 5000 });
    await page.screenshot({
      path: path.join(OUT, "16-post-season.png"),
      fullPage: true,
    });
  } catch (err) {
    console.warn("Skipped 16 (post-season):", (err as Error).message);
  }

  // 10. Record scores sheet — set name to the host of the past round, open
  // the host menu on the past card, click Edit scores. Best-effort: if the
  // menu can't be opened in headless mode we just skip this shot rather
  // than fail the whole run.
  try {
    await setProfileInLocalStorage(page, "Greg", 8);
    await page.reload();
    await page.locator("text=Past tee times").first().click();
    await page.waitForSelector("text=Walnut Creek", { timeout: 5000 });
    const pastWalnutCard = page
      .locator("article", { hasText: "Walnut Creek" })
      .filter({ hasText: "Hosted by Greg" })
      .first();
    await pastWalnutCard.scrollIntoViewIfNeeded();
    await pastWalnutCard
      .locator("button[aria-label='Host options']")
      .click({ timeout: 5000 });
    await page
      .locator("button", { hasText: /(Edit|Record) scores/ })
      .first()
      .click({ timeout: 5000 });
    await page.waitForSelector("text=Save scores", { timeout: 5000 });
    await page.screenshot({
      path: path.join(OUT, "10-record-scores-sheet.png"),
      fullPage: true,
    });
  } catch (err) {
    console.warn("Skipped screenshot 10 (record scores sheet):", (err as Error).message);
  }

  await browser.close();
  console.log("Saved screenshots to", OUT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
