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

  // Seed players with handicaps so chips and standings have content.
  await api("PUT", "/api/players/Greg", { handicap: 8.0 });
  await api("PUT", "/api/players/Mike", { handicap: 12.4 });
  await api("PUT", "/api/players/Sam", { handicap: 18.6 });
  await api("PUT", "/api/players/Alex", { handicap: 4.2 });
  await api("PUT", "/api/players/Lee", { handicap: 22.0 });
  await api("PUT", "/api/players/Chris", { handicap: 9.5 });

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
