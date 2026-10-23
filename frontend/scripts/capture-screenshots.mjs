/**
 * Capture the README screenshots and the bug #4 clip with Playwright (Chromium).
 *
 *   cd frontend
 *   npx playwright install chromium        # once
 *   npm run capture                        # app must be running (default http://localhost:5173)
 *   npm run capture -- https://your-fixsi.vercel.app
 *
 * Writes to <repo>/docs/: screenshot-desktop.png, screenshot-phone.png,
 * screenshot-how-it-works.png and fixsi-bug4.webm (bug #4 from start to the green Verify stage).
 * Replay mode is fine; the run is started through the UI exactly like a visitor would.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const BASE = (process.argv[2] || process.env.CAPTURE_BASE_URL || "http://localhost:5173").replace(/\/$/, "");
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs");
const BUG = "#4";
const COLOR_SCHEME = process.env.CAPTURE_COLOR_SCHEME || "dark";
const RUN_TIMEOUT = 180_000;
const MAX_VIDEO_BYTES = 8 * 1024 * 1024;

const stage = (page, n) => page.locator(`ol[aria-label="Investigation stages"] > li:nth-child(${n})`);
const isDone = (page, n) => stage(page, n).getByText("(done)").waitFor({ state: "attached", timeout: RUN_TIMEOUT });

async function startBug4(page) {
  await page.goto(`${BASE}/`);
  const card = page.locator("li").filter({ has: page.getByText(BUG, { exact: true }) });
  const button = card.getByRole("button", { name: "Investigate" });
  await button.waitFor({ timeout: 30_000 });
  await button.click();
  await page.waitForURL(/\/runs\/[^/]+$/, { timeout: 30_000 });
  return new URL(page.url()).pathname.split("/").pop();
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const videoDir = fs.mkdtempSync(path.join(OUT, ".video-"));
  try {
    // 1. The clip: home -> Investigate bug #4 -> Verify turns green.
    const video = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      colorScheme: COLOR_SCHEME,
      recordVideo: { dir: videoDir, size: { width: 1280, height: 800 } },
    });
    const vpage = await video.newPage();
    const runId = await startBug4(vpage);
    console.log(`run ${runId}: recording until Verify is green`);
    await isDone(vpage, 5);
    await vpage.waitForTimeout(1500);
    const recorded = await vpage.video().path();
    await video.close();
    const clip = path.join(OUT, "fixsi-bug4.webm");
    fs.copyFileSync(recorded, clip);
    const size = fs.statSync(clip).size;
    console.log(`wrote ${clip} (${(size / 1024 / 1024).toFixed(1)} MB)`);
    if (size > MAX_VIDEO_BYTES) console.warn("warning: the clip is over 8 MB; lower the viewport size above");

    // 2. Desktop run page once the whole run has finished.
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: COLOR_SCHEME });
    const dpage = await desktop.newPage();
    await dpage.goto(`${BASE}/runs/${runId}`);
    await isDone(dpage, 6);
    await dpage.waitForTimeout(800);
    await dpage.screenshot({ path: path.join(OUT, "screenshot-desktop.png") });

    // 3. How it works, full page at desktop width.
    await dpage.goto(`${BASE}/how-it-works`);
    await dpage.getByRole("heading", { level: 1 }).waitFor();
    await dpage.waitForTimeout(500);
    await dpage.screenshot({ path: path.join(OUT, "screenshot-how-it-works.png"), fullPage: true });
    await desktop.close();

    // 4. Phone run page on the Board tab.
    const phone = await browser.newContext({
      viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: COLOR_SCHEME,
    });
    const ppage = await phone.newPage();
    await ppage.goto(`${BASE}/runs/${runId}`);
    await isDone(ppage, 6);
    await ppage.getByRole("tab", { name: /board/i }).click();
    await ppage.waitForTimeout(800);
    await ppage.screenshot({ path: path.join(OUT, "screenshot-phone.png") });
    await phone.close();

    console.log(`screenshots written to ${OUT}`);
  } finally {
    await browser.close();
    fs.rmSync(videoDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
