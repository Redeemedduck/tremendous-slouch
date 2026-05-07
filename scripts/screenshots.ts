import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const BASE = "http://localhost:3000";
const VIEWPORT = { width: 393, height: 852 }; // iPhone 14 Pro
const OUT = path.resolve("screenshots");

async function setNameInLocalStorage(page: import("playwright").Page, name: string) {
  await page.evaluate((n) => {
    localStorage.setItem("golf.coordinator.myName", n);
  }, name);
}

async function clearNameInLocalStorage(page: import("playwright").Page) {
  await page.evaluate(() => {
    localStorage.removeItem("golf.coordinator.myName");
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

  // 1. Empty state, no name
  await page.goto(BASE);
  await clearNameInLocalStorage(page);
  await page.reload();
  await page.waitForSelector("text=Nothing on the board yet");
  await page.screenshot({ path: path.join(OUT, "01-empty-no-name.png") });

  // 2. Empty state, with name set
  await setNameInLocalStorage(page, "Mike");
  await page.reload();
  await page.waitForSelector("text=Nothing on the board yet");
  await page.screenshot({ path: path.join(OUT, "02-empty-with-name.png") });

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

  // 7. Past tee times: insert a past row directly
  const sqlite3 = await import("better-sqlite3");
  const db = new (sqlite3 as any).default("golf_coordinator.db");
  db.prepare(
    `INSERT INTO tee_times (id, course, date, time, spots, host, notes, claims, interested, created_at)
     VALUES (?, 'Old Course', '2024-01-01', '09:00', 4, 'Greg', NULL,
             '[{"name":"Greg","claimedAt":"2024-01-01T00:00:00Z"},{"name":"Mike","claimedAt":"2024-01-01T00:00:00Z"}]',
             '[]', '2024-01-01T00:00:00Z')`
  ).run("past-1");
  db.close();

  await page.reload();
  await page.locator("text=Past tee times").click();
  await page.waitForSelector("text=Old Course");
  await page.screenshot({ path: path.join(OUT, "07-past-section-expanded.png"), fullPage: true });

  // 8. Access gate (set ACCESS_CODE → reload)
  // Skipping this in the unified script — the server already booted without it.
  // We capture this in a separate run instead.

  await browser.close();
  console.log("Saved screenshots to", OUT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
