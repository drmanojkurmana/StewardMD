/* Phase 5a screenshots: library grid, folder, list view, search, trash, menu, doc tabs.
 * USAGE: node test/capture-study-p5a-shots.mjs
 * Saves to .fleet-reports/study-p5a/ at phone (390) and iPad (820) sizes, dark and light.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { freePort } from "./free-port.mjs";
const req = createRequire(import.meta.url);
const { chromium } = req("playwright");
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", ".fleet-reports", "study-p5a");
mkdirSync(OUT_DIR, { recursive: true });
const PORT = await freePort();
const BASE = "http://localhost:" + PORT + "/";
const serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), String(PORT)], { stdio: "ignore" });
for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }
function makePdf(pages = ["Cardiology study notes: ventricular systole.", "Phase 2 diastole."]) {
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
const DEVICES = [{ name: "phone", width: 390, height: 844 }, { name: "ipad", width: 820, height: 1180 }];
for (const dev of DEVICES) {
  for (const theme of ["dark", "light"]) {
    const ctx = await browser.newContext({ viewport: { width: dev.width, height: dev.height }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.route("**/api/**", (r) => r.fulfill({ status: 404, body: "{}" }));
    await page.addInitScript(() => { window.SMD_PREP_SETUP = false; window.SMD_PREP_ONBOARD = false; window.confirm = () => true; window.prompt = (m, d) => d; });
    async function gotoApp() {
      await page.goto(BASE + "?prep=1&study=1", { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => !!(window.PREP && window.SMD_showHome), null, { timeout: 30000 });
      await page.evaluate((th) => {
        ["introPoster", "splash", "accountGate", "introOverlay", "smdBootSplash"].forEach((k) => { const e = document.getElementById(k); if (e) e.remove(); });
        PREP.open(); document.body.classList.toggle("dark", th === "dark");
      }, theme);
      await page.waitForSelector("#smdPrep .pn-tile, #smdPrep .pn-row, .pnv-tab", { timeout: 30000 });
      await sleep(150);
    }
    const tag = `${dev.name}-${theme}`;
    console.log(`\n--- ${tag} ---`);
    await gotoApp();
    await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase("study"); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
    await page.click('#smdPrep .pnv-tab[data-tab="study"]');
    await page.waitForSelector("#stLib"); await sleep(200);
    await page.screenshot({ path: join(OUT_DIR, `${tag}-01-library-empty.png`) }); console.log(`${tag}-01-library-empty.png`);
    await page.setInputFiles("#stFile", { name: "Cardiology-Notes.pdf", mimeType: "application/pdf", buffer: PDF });
    await page.waitForSelector(".st5a-card.st-doc", { timeout: 20000 });
    await page.click('[data-act="st5a-new"]'); await page.click('[data-act="st5a-new-folder"]');
    await page.waitForSelector(".st5a-folder", { timeout: 10000 }); await sleep(200);
    await page.screenshot({ path: join(OUT_DIR, `${tag}-02-library-grid-folder.png`) }); console.log(`${tag}-02-library-grid-folder.png`);
    await page.locator(".st5a-card.st-doc").first().locator('[data-act="st5a-doc-menu"]').click();
    await page.waitForSelector('[data-act="st5a-export-sheet"]'); await sleep(200);
    await page.screenshot({ path: join(OUT_DIR, `${tag}-03-item-menu.png`) }); console.log(`${tag}-03-item-menu.png`);
    await page.click('[data-act="st5a-close"]');
    await page.click('[data-act="st5a-view"][data-v="list"]');
    await page.waitForSelector(".st5a-list-row"); await sleep(200);
    await page.screenshot({ path: join(OUT_DIR, `${tag}-04-library-list.png`) }); console.log(`${tag}-04-library-list.png`);
    await page.click('[data-act="st5a-view"][data-v="grid"]');
    await page.click('[data-act="st5a-tab"][data-v="search"]');
    await page.waitForSelector("#st5aSearchQ");
    await page.fill("#st5aSearchQ", "Cardiology"); await sleep(600);
    await page.screenshot({ path: join(OUT_DIR, `${tag}-05-search.png`) }); console.log(`${tag}-05-search.png`);
    await page.click('[data-act="st5a-tab"][data-v="documents"]');
    await page.locator(".st5a-card.st-doc").first().locator('[data-act="st5a-doc-menu"]').click();
    await page.waitForSelector('[data-act="st5a-trash"]'); await page.click('[data-act="st5a-trash"]');
    await sleep(400);
    await page.click('[data-act="st5a-tab"][data-v="trash"]'); await sleep(400);
    await page.screenshot({ path: join(OUT_DIR, `${tag}-06-trash.png`) }); console.log(`${tag}-06-trash.png`);
    await page.click('[data-act="st5a-tab"][data-v="documents"]');
    await page.locator(".st5a-card.st-doc").first().click();
    await page.waitForSelector(".st-pg", { timeout: 20000 }); await sleep(300);
    await page.screenshot({ path: join(OUT_DIR, `${tag}-07-doc-tabs.png`) }); console.log(`${tag}-07-doc-tabs.png`);
    await ctx.close();
  }
}
await browser.close();
serveProc.kill();
console.log(`\nAll phase 5a screenshots captured into ${OUT_DIR}!`);
