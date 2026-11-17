/* Capture Phase 5b screenshots at 390x844 and 820x1180 (dark and light) into .fleet-reports/study-p5b/.
 * USAGE: node test/capture-study-p5b-shots.mjs
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { freePort } from "./free-port.mjs";

const req = createRequire(import.meta.url);
const { chromium } = req("playwright");
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", ".fleet-reports", "study-p5b");
mkdirSync(OUT_DIR, { recursive: true });

const PORT = await freePort();
const BASE = "http://localhost:" + PORT + "/";

const serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), String(PORT)], { stdio: "ignore" });
for (let i = 0; i < 30; i++) {
  try { await fetch(BASE); break; } catch { await sleep(200); }
}

function makePdf(pages = ["Alpha systole one", "Beta diastole two"]) {
  const objs = [], n = pages.length, font = 3 + 2 * n;
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${pages.map((_, k) => `${3 + 2 * k} 0 R`).join(" ")}] /Count ${n} >>`;
  objs[font] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((t, k) => {
    const po = 3 + 2 * k, stream = `BT /F1 12 Tf 30 750 Td (${t}) Tj ET`;
    objs[po] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${po + 1} 0 R >>`;
    objs[po + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let out = "%PDF-1.4\n"; const offs = [];
  for (let i = 1; i < objs.length; i++) { offs[i] = out.length; out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
  const x = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n` + offs.slice(1).map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  return Buffer.from(out + `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`, "latin1");
}
const PDF = makePdf();

const browser = await chromium.launch();
const DEVICES = [
  { name: "iphone", width: 390, height: 844 },
  { name: "ipad", width: 820, height: 1180 }
];
const THEMES = ["dark", "light"];

for (const dev of DEVICES) {
  for (const theme of THEMES) {
    const ctx = await browser.newContext({
      viewport: { width: dev.width, height: dev.height },
      deviceScaleFactor: 2
    });
    const page = await ctx.newPage();
    await page.route("**/api/**", (r) => r.fulfill({ status: 404, body: "{}" }));
    await page.addInitScript(() => {
      window.SMD_PREP_SETUP = false;
      window.SMD_PREP_ONBOARD = false;
      window.confirm = () => true;
    });

    async function setupTheme() {
      await page.evaluate((th) => {
        document.body.classList.toggle("dark", th === "dark");
      }, theme);
      await sleep(150);
    }

    async function gotoApp(extraQ = "") {
      await page.goto(BASE + "?prep=1&study=1" + extraQ, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => !!(window.PREP && window.SMD_showHome), null, { timeout: 30000 });
      await page.evaluate(() => {
        ["introPoster", "splash", "accountGate", "introOverlay", "smdBootSplash"].forEach((k) => {
          const e = document.getElementById(k); if (e) e.remove();
        });
        PREP.open();
      });
      await page.waitForSelector("#smdPrep .pn-tile, #smdPrep .pn-row, .pnv-tab", { timeout: 30000 });
      await setupTheme();
    }

    const tag = `${dev.name}-${theme}`;
    console.log(`\n--- Capturing for ${tag} ---`);

    await gotoApp();
    await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase("study"); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
    await page.click('#smdPrep .pnv-tab[data-tab="study"]');
    await page.waitForSelector("#stLib");
    await page.setInputFiles("#stFile", { name: "Cardiology-Notes.pdf", mimeType: "application/pdf", buffer: PDF });
    await page.waitForSelector(".st-doc", { timeout: 20000 });
    await setupTheme();
    await sleep(300);

    // 5.6 search results with thumbnails
    await page.click('[data-act="st5a-tab"][data-v="search"]');
    await page.waitForSelector("#st5aSearchQ");
    await page.fill("#st5aSearchQ", "systole");
    await page.waitForTimeout(1800);
    await setupTheme();
    await sleep(200);
    await page.screenshot({ path: join(OUT_DIR, `${tag}-search-thumbs.png`) });
    console.log(`Saved ${tag}-search-thumbs.png`);
    await page.fill("#st5aSearchQ", "");
    await page.waitForTimeout(300);

    // open viewer
    await page.click('[data-act="st5a-tab"][data-v="documents"]');
    await page.locator(".st-doc", { hasText: "Cardiology" }).locator(".st-open").click();
    await page.waitForSelector(".st-pg canvas.st-cv", { timeout: 15000 });
    await setupTheme();
    await sleep(300);

    // 5.7 in-document search open
    const topSearch = page.locator('#stP3Top [data-act="st-p3-search"]');
    if (await topSearch.isVisible()) {
      await topSearch.click();
    } else {
      await page.click('#stP3Top [data-act="st-p3-more"]');
      await page.waitForSelector('#stP3MoreSheet [data-act="st-p3-search"]', { timeout: 5000 });
      await page.click('#stP3MoreSheet [data-act="st-p3-search"]');
    }
    await page.waitForSelector("#st5bInQ", { timeout: 5000 });
    await page.fill("#st5bInQ", "systole");
    await page.waitForTimeout(800);
    await setupTheme();
    await page.screenshot({ path: join(OUT_DIR, `${tag}-indoc-search.png`) });
    console.log(`Saved ${tag}-indoc-search.png`);
    if (await page.locator('[data-act="st-indoc-close"]').count()) {
      await page.click('[data-act="st-indoc-close"]');
      await sleep(200);
    }

    // 5.11 print sheet
    await page.click('#stP3Top [data-act="st-p3-more"]');
    await page.waitForSelector('#stP3MoreSheet [data-act="st-print-open"]', { timeout: 5000 });
    await page.click('#stP3MoreSheet [data-act="st-print-open"]');
    await page.waitForSelector("#stSheet", { timeout: 5000 });
    await setupTheme();
    await sleep(200);
    await page.screenshot({ path: join(OUT_DIR, `${tag}-print-sheet.png`) });
    console.log(`Saved ${tag}-print-sheet.png`);
    if (await page.locator('[data-act="st-scancel"]').count()) {
      await page.click('[data-act="st-scancel"]');
      await sleep(200);
    }

    // 5.9 audio sheet (recordings list; empty state)
    await page.click('#stP3Top [data-act="st-p3-more"]');
    await page.waitForSelector('#stP3MoreSheet [data-act="st-audio-list"]', { timeout: 5000 });
    await page.click('#stP3MoreSheet [data-act="st-audio-list"]');
    await page.waitForSelector("#st5bRecList", { timeout: 5000 });
    await setupTheme();
    await sleep(200);
    await page.screenshot({ path: join(OUT_DIR, `${tag}-audio-list.png`) });
    console.log(`Saved ${tag}-audio-list.png`);
    if (await page.locator('[data-act="st-scancel"]').count()) {
      await page.click('[data-act="st-scancel"]');
      await sleep(150);
    }

    // 5.12 presentation
    await page.click('#stP3Top [data-act="st-p3-more"]');
    await page.waitForSelector('#stP3MoreSheet [data-act="st-present"]', { timeout: 5000 });
    await page.click('#stP3MoreSheet [data-act="st-present"]');
    await page.waitForSelector("#st5bPresent", { timeout: 8000 });
    await page.waitForTimeout(600);
    await setupTheme();
    await page.screenshot({ path: join(OUT_DIR, `${tag}-present.png`) });
    console.log(`Saved ${tag}-present.png`);
    if (await page.locator('[data-act="st-present-exit"]').count()) {
      await page.click('[data-act="st-present-exit"]');
      await sleep(300);
    }

    await ctx.close();
  }
}

await browser.close();
serveProc.kill();
console.log(`\nAll P5b screenshots captured into ${OUT_DIR}!`);
