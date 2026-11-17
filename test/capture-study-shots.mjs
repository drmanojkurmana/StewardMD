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
const targetArg = process.argv[2] || "study-p4";
const OUT_DIR = targetArg === "p1"
  ? join(HERE, "..", ".fleet-reports", "study-p1", "shots")
  : targetArg === "p2"
    ? join(HERE, "..", ".fleet-reports", "study-p2", "shots")
    : targetArg.startsWith("study-")
      ? join(HERE, "..", ".fleet-reports", targetArg)
      : join(HERE, "..", ".fleet-reports", "study-ui", targetArg);
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
          await page.click('#smdPrep [data-act="back"]:visible, #stP3Top [data-act="st-p3-back"]:visible');
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
    if (await page.locator('[data-act="st5a-tab"][data-v="documents"]').count()) {
      await page.click('[data-act="st5a-tab"][data-v="documents"]');
      await page.waitForSelector(".st-doc, .st5a-card", { timeout: 10000 });
    }

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
    // Wait for leaving screen (.pn-ghost) cross-fade transition to finish so editor covers full width
    await page.waitForFunction(() => !document.querySelector(".pn-ghost"), { timeout: 5000 }).catch(() => {});
    await sleep(400);
    await setupTheme();
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

    // Phase 4: Text box & format bar
    if (await page.locator('[data-act="st-tool"][data-v="text"]').count()) {
      await page.click('[data-act="st-tool"][data-v="text"]');
      await sleep(150);
      await page.evaluate(() => {
        const p = document.querySelector('.st-pg[data-n="1"]');
        if (!p) return;
        const r = p.getBoundingClientRect();
        p.querySelector(".st-items-layer").dispatchEvent(new PointerEvent("pointerdown", {
          pointerId: 30, pointerType: "touch", isPrimary: true, clientX: r.left + 0.15 * r.width, clientY: r.top + 0.35 * r.height, bubbles: true
        }));
      });
      await sleep(200);
      const textEd = page.locator(".st-text-editable").first();
      if (await textEd.count()) {
        await textEd.fill("Aortic Stenosis: Systolic ejection murmur radiating to carotids.");
      }
      await setupTheme();
      await sleep(150);
      await page.screenshot({ path: join(OUT_DIR, `${tag}-text-format-bar.png`) });
      console.log(`Saved ${tag}-text-format-bar.png`);

      // Text style sheet
      if (await page.locator('[data-act="st-fb-styles"]').count()) {
        await page.click('[data-act="st-fb-styles"]');
        await sleep(200);
        await setupTheme();
        await page.screenshot({ path: join(OUT_DIR, `${tag}-text-style-sheet.png`) });
        console.log(`Saved ${tag}-text-style-sheet.png`);
        if (await page.locator('[data-act="st-fb-close-styles"]').count()) {
          await page.click('[data-act="st-fb-close-styles"]');
          await sleep(150);
        }
      }
    }

    // Phase 4: Elements & Sticker tray
    if (await page.locator('[data-act="st-tool"][data-v="elements"]').count()) {
      await page.click('[data-act="st-tool"][data-v="elements"]');
      await sleep(250);
      await setupTheme();
      await page.screenshot({ path: join(OUT_DIR, `${tag}-sticker-tray.png`) });
      console.log(`Saved ${tag}-sticker-tray.png`);

      if (await page.locator('.st-sticker-btn[data-name="heart"]').count()) {
        await page.click('.st-sticker-btn[data-name="heart"]');
        await sleep(250);
        await setupTheme();
        await page.screenshot({ path: join(OUT_DIR, `${tag}-sticker-on-page.png`) });
        console.log(`Saved ${tag}-sticker-on-page.png`);
      }
    }

    // Phase 4: Image & Crop
    await page.evaluate(() => {
      const sampleImg = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMgAAADICAYAAACtWK6eAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAA0SURBVHhe7cExAQAAAMKg9U9tDQ8gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAvg1rYAAB21nCtwAAAABJRU5ErkJggg==";
      if (window.STUDY_INSERT && window.STUDY_INSERT.insertImageFromDataUrl) {
        window.STUDY_INSERT.insertImageFromDataUrl(sampleImg);
      }
    });
    await sleep(250);
    await setupTheme();
    await page.screenshot({ path: join(OUT_DIR, `${tag}-image-with-handles.png`) });
    console.log(`Saved ${tag}-image-with-handles.png`);

    const imgId = await page.evaluate(() => {
      const im = document.querySelector(".st-item-img");
      return im ? im.closest(".st-item").getAttribute("data-id") : null;
    });
    if (imgId && await page.locator(`[data-act="st-img-crop"][data-id="${imgId}"]`).count()) {
      await page.click(`[data-act="st-img-crop"][data-id="${imgId}"]`);
      await sleep(250);
      await setupTheme();
      await page.screenshot({ path: join(OUT_DIR, `${tag}-image-crop.png`) });
      console.log(`Saved ${tag}-image-crop.png`);
      if (await page.locator('[data-act="st-crop-cancel"]').count()) {
        await page.click('[data-act="st-crop-cancel"]');
        await sleep(150);
      }
    }
    if (imgId) {
      await page.evaluate((id) => {
        if (window.STUDY_INSERT && window.STUDY_INSERT.deleteItem) {
          window.STUDY_INSERT.deleteItem(id);
        }
      }, imgId);
      await sleep(150);
    }

    // Phase 4: Laser tool
    if (await page.locator('[data-act="st-tool"][data-v="laser"]').count()) {
      await page.click('[data-act="st-tool"][data-v="laser"]');
      await sleep(100);
      await page.evaluate(() => {
        const ov = document.querySelector('.st-ov[data-n="1"]');
        if (!ov) return;
        const r = ov.getBoundingClientRect();
        const fire = (t, x, y) => ov.dispatchEvent(new PointerEvent(t, { pointerId: 40, pointerType: "pen", isPrimary: true, pressure: 0.8, clientX: r.left + x * r.width, clientY: r.top + y * r.height, bubbles: true, cancelable: true }));
        fire("pointerdown", 0.25, 0.65);
        fire("pointermove", 0.45, 0.68);
        fire("pointermove", 0.65, 0.63);
      });
      await setupTheme();
      await sleep(100);
      await page.screenshot({ path: join(OUT_DIR, `${tag}-laser-trail.png`) });
      console.log(`Saved ${tag}-laser-trail.png`);
      await page.evaluate(() => {
        const ov = document.querySelector('.st-ov[data-n="1"]');
        if (!ov) return;
        const r = ov.getBoundingClientRect();
        ov.dispatchEvent(new PointerEvent("pointerup", { pointerId: 40, pointerType: "pen", isPrimary: true, clientX: r.left + 0.65 * r.width, clientY: r.top + 0.63 * r.height, bubbles: true }));
      });
    }

    // Phase 4: Lasso selection with AI chips
    if (await page.locator('[data-act="st-tool"][data-v="lasso"]').count()) {
      await page.click('[data-act="st-tool"][data-v="lasso"]');
      await sleep(100);
      await page.evaluate(() => {
        const ov = document.querySelector('.st-ov[data-n="1"]');
        if (!ov) return;
        const r = ov.getBoundingClientRect(), id = 45;
        const fire = (t, x, yy) => ov.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: "pen", isPrimary: true, pressure: 0.5, clientX: r.left + x * r.width, clientY: r.top + yy * r.height, bubbles: true, cancelable: true }));
        fire("pointerdown", 0.15, 0.15);
        fire("pointermove", 0.85, 0.15);
        fire("pointermove", 0.85, 0.35);
        fire("pointermove", 0.15, 0.35);
        fire("pointermove", 0.15, 0.15);
        fire("pointerup", 0.15, 0.15);
      });
      await sleep(250);
      await setupTheme();
      await page.screenshot({ path: join(OUT_DIR, `${tag}-lasso-ai-chips.png`) });
      console.log(`Saved ${tag}-lasso-ai-chips.png`);

      if (await page.locator('[data-act="st-lasso-ai-explain"]').count()) {
        await page.click('[data-act="st-lasso-ai-explain"]');
        await sleep(250);
        await setupTheme();
        await page.screenshot({ path: join(OUT_DIR, `${tag}-lasso-ai-explain-sheet.png`) });
        console.log(`Saved ${tag}-lasso-ai-explain-sheet.png`);
        if (await page.locator('[data-act="st-scancel"]').count()) {
          await page.click('[data-act="st-scancel"]');
          await sleep(150);
        }
      }
    }

    // 7b. Phase 1: pen settings popover (tap the active pen again), highlighter strip, eraser popover
    if (await page.locator('[data-act="st-tool"][data-v="pen"]').count()) {
      await page.click('[data-act="st-tool"][data-v="pen"]');
      await page.waitForSelector("#stInkPop", { timeout: 5000 }).catch(() => {});
      await setupTheme();
      await page.screenshot({ path: join(OUT_DIR, `${tag}-p1-pen-popover.png`) });
      console.log(`Saved ${tag}-p1-pen-popover.png`);
      await page.click('[data-act="st-tool"][data-v="pen"]');
    }
    if (await page.locator('[data-act="st-tool"][data-v="hl"]').count()) {
      await page.click('[data-act="st-tool"][data-v="hl"]');
      await sleep(150); await setupTheme();
      await page.screenshot({ path: join(OUT_DIR, `${tag}-p1-highlighter-strip.png`) });
      console.log(`Saved ${tag}-p1-highlighter-strip.png`);
    }
    if (await page.locator('[data-act="st-tool"][data-v="er"]').count()) {
      await page.click('[data-act="st-tool"][data-v="er"]');
      await page.click('[data-act="st-tool"][data-v="er"]');
      await page.waitForSelector("#stInkPop", { timeout: 5000 }).catch(() => {});
      await setupTheme();
      await page.screenshot({ path: join(OUT_DIR, `${tag}-p1-eraser-popover.png`) });
      console.log(`Saved ${tag}-p1-eraser-popover.png`);
    }

    // 7c. Phase 2: lasso settings strip + selection with handles, selection menu, shapes strip
    if (await page.locator('[data-act="st-tool"][data-v="lasso"]').count()) {
      await page.click('[data-act="st-tool"][data-v="lasso"]');
      await sleep(150); await setupTheme();
      await page.screenshot({ path: join(OUT_DIR, `${tag}-p2-lasso-settings.png`) });
      console.log(`Saved ${tag}-p2-lasso-settings.png`);
      await page.evaluate(() => {
        const ov = document.querySelector('.st-ov[data-n="1"]');
        if (!ov) return;
        const r = ov.getBoundingClientRect(), id = 3;
        const fire = (t, x, yy) => ov.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: "pen", isPrimary: true, pressure: 0.5, clientX: r.left + x * r.width, clientY: r.top + yy * r.height, bubbles: true, cancelable: true }));
        fire("pointerdown", 0.1, 0.1); fire("pointermove", 0.9, 0.1); fire("pointermove", 0.9, 0.35); fire("pointermove", 0.1, 0.35); fire("pointermove", 0.1, 0.1); fire("pointerup", 0.1, 0.1);
      });
      await page.waitForSelector("#stLassoBar", { timeout: 5000 }).catch(() => {});
      await sleep(200); await setupTheme();
      await page.screenshot({ path: join(OUT_DIR, `${tag}-p2-selection.png`) });
      console.log(`Saved ${tag}-p2-selection.png`);
      if (await page.locator('[data-act="st-lasso-color"]').count()) {
        await page.click('[data-act="st-lasso-color"]');
        await page.waitForSelector("#stSelColor", { timeout: 5000 }).catch(() => {});
        await setupTheme();
        await page.screenshot({ path: join(OUT_DIR, `${tag}-p2-color.png`) });
        console.log(`Saved ${tag}-p2-color.png`);
      }
      if (await page.locator('#stSelColor [data-sel-close]').count()) {
        await page.click('#stSelColor [data-sel-close]');
      }
      if (await page.locator('[data-act="st-lasso-done"]').count()) {
        await page.click('[data-act="st-lasso-done"]');
      }
      await page.click('[data-act="st-tool"][data-v="shapes"]');
      await sleep(150); await setupTheme();
      await page.screenshot({ path: join(OUT_DIR, `${tag}-p2-shapes.png`) });
      console.log(`Saved ${tag}-p2-shapes.png`);
    }

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
    await page.evaluate(() => {
      if (window.STUDY_INSERT) {
        while (window.STUDY_INSERT.back()) {}
      }
    });
    await sleep(150);
    await page.click('#smdPrep [data-act="back"]:visible, #stP3Top [data-act="st-p3-back"]:visible');
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

/* Phase 3: pages and navigation — extra captures to .fleet-reports/study-p3 */
const P3_DIR = join(HERE, "..", ".fleet-reports", "study-p3");
mkdirSync(P3_DIR, { recursive: true });
for (const dev of DEVICES) {
  for (const theme of THEMES) {
    const ctx = await browser.newContext({ viewport: { width: dev.width, height: dev.height }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.route("**/api/**", r => r.fulfill({ status: 404, body: "{}" }));
    await page.addInitScript(() => { window.SMD_PREP_SETUP = false; window.SMD_PREP_ONBOARD = false; window.confirm = () => true; window.prompt = () => "Clinical Notes"; });
    await page.goto(BASE + "?prep=1&study=1", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!(window.PREP && window.SMD_showHome), null, { timeout: 30000 });
    await page.evaluate(() => { ["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(k=>{const e=document.getElementById(k); if(e) e.remove();}); PREP.open(); });
    await page.waitForSelector("#smdPrep .pn-tile, #smdPrep .pn-row, .pnv-tab", { timeout: 30000 });
    await page.evaluate((th)=>document.body.classList.toggle("dark", th==="dark"), theme);
    await page.evaluate(() => new Promise(r=>{ const q=indexedDB.deleteDatabase("study"); q.onsuccess=q.onerror=q.onblocked=()=>r(); }));
    await page.click('#smdPrep .pnv-tab[data-tab="study"]');
    await page.waitForSelector("#stLib");
    /* create notebook */
    if (await page.locator('[data-act="st-newnb"]').count()) {
      await page.click('[data-act="st-newnb"]');
      await page.fill("#stNbT", "P3 capture");
      await page.click('[data-act="st-mknb"]');
      await page.waitForSelector("#stPages", { timeout: 15000 });
    }
    await page.evaluate((th)=>document.body.classList.toggle("dark", th==="dark"), theme);
    await sleep(250);
    await page.screenshot({ path: join(P3_DIR, `${dev.name}-${theme}-editor-topbar.png`) });
    /* Add Page popover */
    if (await page.locator('[data-act="st-p3-add"]').count()) {
      await page.click('[data-act="st-p3-add"]');
      await page.waitForSelector("#stP3AddSheet", { timeout: 5000 }).catch(()=>{});
      await page.screenshot({ path: join(P3_DIR, `${dev.name}-${theme}-add-page.png`) });
      await page.evaluate(()=>{ document.querySelector("#stP3AddSheet")?.remove(); });
    }
    /* More menu */
    if (await page.locator('[data-act="st-p3-more"]').count()) {
      await page.click('[data-act="st-p3-more"]');
      await page.waitForSelector("#stP3MoreSheet", { timeout: 5000 }).catch(()=>{});
      await page.screenshot({ path: join(P3_DIR, `${dev.name}-${theme}-more.png`) });
      await page.evaluate(()=>{ document.querySelector("#stP3MoreSheet")?.remove(); });
    }
    /* Navigator thumbnails */
    if (await page.locator('[data-act="st-p3-grid"]').count()) {
      await page.click('[data-act="st-p3-grid"]');
      await page.waitForSelector("#stP3NavSheet", { timeout: 5000 }).catch(()=>{});
      await sleep(300);
      await page.screenshot({ path: join(P3_DIR, `${dev.name}-${theme}-navigator.png`) });
      await page.evaluate(()=>{ document.querySelector("#stP3NavSheet")?.remove(); });
      /* Favorites empty state */
      await page.click('[data-act="st-p3-grid"]');
      await page.waitForSelector("#stP3NavSheet", { timeout: 5000 }).catch(()=>{});
      await page.click("#stP3NavSheet [data-act='st-p3-tab'][data-v='favs']");
      await sleep(200);
      await page.screenshot({ path: join(P3_DIR, `${dev.name}-${theme}-favorites-empty.png`) });
      await page.evaluate(()=>{ document.querySelector("#stP3NavSheet")?.remove(); });
    }
    await ctx.close();
  }
}
await browser.close();
serveProc.kill();
console.log(`\nAll screenshots captured successfully into ${OUT_DIR} and ${P3_DIR}!`);
