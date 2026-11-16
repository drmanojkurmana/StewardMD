/* Capture headless screenshots for Study Studio at 390x844 and 820x1180 (dark and light)
 * USAGE: node test/capture-study-shots.mjs before
 *        node test/capture-study-shots.mjs after
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { freePort } from "./free-port.mjs";

const req = createRequire(import.meta.url);
const { chromium } = req("playwright");
const HERE = dirname(fileURLToPath(import.meta.url));
const mode = process.argv[2] || "before";
const OUT_DIR = join(HERE, "..", ".fleet-reports", "study-ui", mode);
mkdirSync(OUT_DIR, { recursive: true });

const PORT = await freePort();
const BASE = "http://localhost:" + PORT + "/";

const serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), String(PORT)], { stdio: "ignore" });
for (let i = 0; i < 30; i++) {
  try { await fetch(BASE); break; } catch { await sleep(200); }
}

function makePdf(pages = ["Cardiology study notes: Phase 1 ventricular systole.", "Phase 2 ventricular diastole: semilunar valves close."]) {
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
      window.prompt = () => "Clinical Notes";
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

    // 1. Study home empty
    await gotoApp();
    await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase("study"); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
    await page.click('#smdPrep .pnv-tab[data-tab="study"]');
    await page.waitForSelector("#stLib");
    await setupTheme();
    await sleep(200);
    await page.screenshot({ path: join(OUT_DIR, `${tag}-study-home-empty.png`) });
    console.log(`Saved ${tag}-study-home-empty.png`);

    // 2. Study home with items (import PDF + create notebook)
    await page.setInputFiles("#stFile", { name: "Cardiology-Notes.pdf", mimeType: "application/pdf", buffer: PDF });
    await page.waitForSelector(".st-doc", { timeout: 20000 });
    // also create a notebook
    if (await page.locator('[data-act="st5a-new"]').count()) {
      await page.click('[data-act="st5a-new"]');
      await page.click('[data-act="st5a-new-notebook"]');
      if (await page.locator("#st5aNbT").count()) {
        await page.fill("#st5aNbT", "ICU Ward Rounds");
        if (await page.locator('[data-act="st5a-mknb"]').count()) {
          await page.click('[data-act="st5a-mknb"]');
          await page.waitForSelector("#stPages", { timeout: 10000 });
          // draw a couple strokes
          await page.click('[data-act="st-tool"][data-v="pen"]');
          await page.evaluate(() => {
            const ov = document.querySelector('.st-ov[data-n="1"]'), r = ov.getBoundingClientRect();
            const fire = (t, x, yy) => ov.dispatchEvent(new PointerEvent(t, { pointerId: 1, pointerType: "pen", isPrimary: true, pressure: 0.5, clientX: r.left + x * r.width, clientY: r.top + yy * r.height, bubbles: true, cancelable: true, buttons: t === "pointerup" ? 0 : 1 }));
            fire("pointerdown", 0.2, 0.2); fire("pointermove", 0.4, 0.25); fire("pointermove", 0.6, 0.2); fire("pointerup", 0.6, 0.2);
          });
          await sleep(200);
          // go back to lib
          await page.click('#smdPrep [data-act="back"]');
          await page.waitForSelector("#stLib", { timeout: 10000 });
        }
      }
    }
    await setupTheme();
    await sleep(200);
    await page.screenshot({ path: join(OUT_DIR, `${tag}-study-home-items.png`) });
    console.log(`Saved ${tag}-study-home-items.png`);

    // 3. Search results
    await page.click('[data-act="st5a-tab"][data-v="search"]');
    await page.waitForSelector("#st5aSearchQ");
    await page.fill("#st5aSearchQ", "Cardiology");
    await page.waitForTimeout(350);
    await setupTheme();
    await page.screenshot({ path: join(OUT_DIR, `${tag}-search-results.png`) });
    console.log(`Saved ${tag}-search-results.png`);
    await page.fill("#st5aSearchQ", "");
    await page.waitForTimeout(200);

    // 4. Backup status / screen
    if (await page.locator('[data-act="st5a-backup"]').count()) {
      await setupTheme();
      await page.screenshot({ path: join(OUT_DIR, `${tag}-backup.png`) });
      console.log(`Saved ${tag}-backup.png`);
    }

    // 5. Open notebook editor
    const nbDoc = page.locator(".st-doc", { hasText: "ICU Ward Rounds" });
    if (await nbDoc.count()) {
      await nbDoc.locator(".st-open").click();
    } else {
      await page.locator(".st-open").first().click();
    }
    await page.waitForSelector("#stPages", { timeout: 15000 });
    await setupTheme();
    await sleep(200);
    await page.screenshot({ path: join(OUT_DIR, `${tag}-notebook-editor.png`) });
    console.log(`Saved ${tag}-notebook-editor.png`);

    // 6. Overflow menu / More
    if (await page.locator('[data-act="st-more"]').count()) {
      await page.click('[data-act="st-more"]');
      await sleep(200);
      await setupTheme();
      await page.screenshot({ path: join(OUT_DIR, `${tag}-overflow-menu.png`) });
      console.log(`Saved ${tag}-overflow-menu.png`);
      if (await page.locator('[data-act="st-close-more"]').count()) {
        await page.click('[data-act="st-close-more"]');
        await sleep(150);
      }
    }

    // 7. Colour / width popover (or color toolbar in current UI)
    if (await page.locator('[data-act="st-tool"][data-v="pen"]').count()) {
      await page.click('[data-act="st-tool"][data-v="pen"]');
      await sleep(150);
    }
    await setupTheme();
    await page.screenshot({ path: join(OUT_DIR, `${tag}-colour-width-popover.png`) });
    console.log(`Saved ${tag}-colour-width-popover.png`);

    // 8. Page sheet
    if (await page.locator('[data-act="st-page-sheet"]').count()) {
      await page.click('[data-act="st-page-sheet"]');
      await sleep(250);
      await setupTheme();
      await page.screenshot({ path: join(OUT_DIR, `${tag}-page-sheet.png`) });
      console.log(`Saved ${tag}-page-sheet.png`);
      if (await page.locator('[data-act="st-close-pagesheet"]').count()) {
        await page.click('[data-act="st-close-pagesheet"]');
        await sleep(150);
      }
    }

    // 9. PDF viewer
    await page.click('#smdPrep [data-act="back"]');
    await page.waitForSelector("#stLib", { timeout: 10000 });
    await page.locator(".st-doc", { hasText: "Cardiology" }).locator(".st-open").click();
    await page.waitForSelector(".st-pg canvas.st-cv", { timeout: 15000 });
    await setupTheme();
    await sleep(200);
    await page.screenshot({ path: join(OUT_DIR, `${tag}-pdf-viewer.png`) });
    console.log(`Saved ${tag}-pdf-viewer.png`);

    // 10. Make cards sheet
    if (await page.locator('[data-act="st-more"]').count()) {
      await page.click('[data-act="st-more"]');
      await sleep(150);
    }
    if (await page.locator('[data-act="st-make"]').count()) {
      await page.locator('[data-act="st-make"]').first().click();
      await page.waitForSelector("#stSheet", { timeout: 8000 });
      await setupTheme();
      await sleep(200);
      await page.screenshot({ path: join(OUT_DIR, `${tag}-make-cards.png`) });
      console.log(`Saved ${tag}-make-cards.png`);
      if (await page.locator('[data-act="st-scancel"]').count()) {
        await page.click('[data-act="st-scancel"]');
        await sleep(100);
      }
      if (await page.locator('[data-act="st-close-more"]').count()) {
        await page.click('[data-act="st-close-more"]');
        await sleep(100);
      }
    }

    await ctx.close();
  }
}

await browser.close();
serveProc.kill();
console.log(`\nAll screenshots captured successfully into ${OUT_DIR}!`);
