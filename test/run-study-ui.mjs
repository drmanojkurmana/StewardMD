/* Study Studio (A1 to A3) in the REAL app bundle, headless Chromium through Playwright.
 * What must hold: with the flag off there is no Study Studio row; with ?prep=1&study=1 the row shows; a PDF imported
 * through the file input is listed with its page count and thumbnail; the stored original's sha256 equals the fixture's
 * (and the metadata's); two synthetic pen strokes (Pointer Events, pressure) are saved one record each; undo hides one,
 * redo brings it back; after a reload both strokes are still there and drawn; the original is still byte-identical.
 * USAGE: node test/run-study-ui.mjs   (BASE=http://localhost:8998/ for a running server)
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { freePort } from "./free-port.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || await freePort()) + "/").replace(/\/?$/, "/");

let serveProc = null;
try { await fetch(BASE); } catch {
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), (BASE.match(/:(\d+)/) || [, "8998"])[1]], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }
}

/* A tiny two-page PDF with text. */
function makePdf() {
  const pages = ["Page one body text", "Page two body text"], objs = [];
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>";
  objs[7] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((t, k) => {
    const po = 3 + 2 * k, stream = `BT /F1 18 Tf 50 780 Td (${t}) Tj ET`;
    objs[po] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 7 0 R >> >> /Contents ${po + 1} 0 R >>`;
    objs[po + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let out = "%PDF-1.4\n"; const offs = [];
  for (let i = 1; i < objs.length; i++) { offs[i] = out.length; out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
  const x = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n` + offs.slice(1).map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  return Buffer.from(out + `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`, "latin1");
}
const PDF = makePdf(), SHA = createHash("sha256").update(PDF).digest("hex");

let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(e.message));
await page.route("**/api/**", (r) => r.fulfill({ status: 404, body: "{}" }));
await page.addInitScript(() => { window.SMD_PREP_SETUP = false; window.SMD_PREP_ONBOARD = false; window.confirm = () => true; });

async function boot(q) {
  await page.goto(BASE + "?" + q);
  await page.waitForFunction(() => !!(window.PREP && window.SMD_showHome), null, { timeout: 30000 });
  await page.evaluate(() => { ["introPoster", "splash", "accountGate", "introOverlay", "smdBootSplash"].forEach((k) => { const e = document.getElementById(k); if (e) e.remove(); }); PREP.open(); });
  await page.waitForSelector("#smdPrep .pn-tile, #smdPrep .pn-row", { timeout: 30000 });
}

/* ---- flag off: no row ---- */
await boot("prep=1");
await page.waitForTimeout(500);
ok(await page.locator('#smdPrep [data-act="st-home"]').count() === 0, "flag off: no Study Studio row");
ok(await page.evaluate(() => !window.STUDY && !document.querySelector('script[src^="/study.js"]')), "flag off: study.js is not even loaded");

/* ---- flag on: import ---- */
await boot("prep=1&study=1");
await page.waitForSelector('#smdPrep [data-act="st-home"]', { timeout: 20000 });
ok(true, "flag on: the Study Studio row shows");
await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase("study"); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
await page.click('#smdPrep [data-act="st-home"]');
await page.waitForSelector("#stLib");
ok(/No PDFs yet/.test(await page.locator("#stList").innerText()), "library: empty state");
await page.setInputFiles("#stFile", { name: "fixture.pdf", mimeType: "application/pdf", buffer: PDF });
await page.waitForSelector(".st-doc", { timeout: 20000 });
ok(/2 pages/.test(await page.locator(".st-doc").innerText()), "library: imported PDF listed with 2 pages");
ok(await page.evaluate(() => /^data:image\/jpeg/.test(document.querySelector(".st-th").src)), "library: page-1 thumbnail");
const meta = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open("study"); r.onsuccess = () => { const q = r.result.transaction("docs").objectStore("docs").getAll(); q.onsuccess = () => res(q.result[0]); }; }));
ok(meta.sha256 === SHA && meta.pageCount === 2 && meta.folderId === null && meta.favourite === false && meta.store === "idb", "metadata: sha256 of the original, pageCount, folderId, favourite, idb fallback");

/* ---- viewer + pen ---- */
await page.click('.st-open');
await page.waitForSelector(".st-pg canvas.st-cv", { timeout: 20000 });
await page.click('[data-act="st-tool"][data-v="pen"]');
ok(await page.evaluate(() => document.querySelector("#stPages").classList.contains("st-ink") && getComputedStyle(document.querySelector(".st-ov")).touchAction === "none"), "pen tool on: overlay is touch-action none");
const stroke = (y) => page.evaluate((y) => {
  const ov = document.querySelector('.st-ov[data-n="1"]'), r = ov.getBoundingClientRect(), id = 7;
  const fire = (t, x, yy, p) => ov.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: "pen", isPrimary: true, pressure: p, clientX: r.left + x * r.width, clientY: r.top + yy * r.height, bubbles: true, cancelable: true, buttons: t === "pointerup" ? 0 : 1 }));
  fire("pointerdown", 0.2, y, 0.3); for (let i = 1; i <= 6; i++) fire("pointermove", 0.2 + i * 0.08, y + i * 0.01, 0.6); fire("pointerup", 0.7, y + 0.06, 0);
}, y);
await stroke(0.2); await stroke(0.5);
const live = () => page.evaluate(() => STUDY._state().strokes.filter((s) => !s.gone).length);
ok(await live() === 2, "two pen strokes drawn");
ok(await page.evaluate(() => STUDY._state().strokes.every((s) => s.pts.length >= 7 && s.pts.every((p) => p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1) && s.pts[1][2] === 0.6 && s.pts[0][2] === 0.3)), "points are page-relative (0..1) and keep pressure");
await page.click('[data-act="st-undo"]');
ok(await live() === 1, "undo hides one stroke");
await page.click('[data-act="st-redo"]');
ok(await live() === 2, "redo brings it back");
await page.waitForTimeout(500);   // autosave settles

/* ---- reload: strokes intact, original unchanged ---- */
await boot("prep=1&study=1");
await page.click('#smdPrep [data-act="st-home"]');
await page.waitForSelector(".st-doc");
await page.click(".st-open");
await page.waitForSelector(".st-pg canvas.st-ov", { timeout: 20000 });
await page.waitForFunction(() => STUDY._state() && STUDY._state().strokes.length === 2, null, { timeout: 10000 });
ok(await live() === 2, "after reload: both strokes are still there");
ok(await page.evaluate(() => { const c = document.querySelector('.st-ov[data-n="1"]'), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i]) return true; return false; }), "after reload: the strokes are drawn on page 1");
const stored = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open("study"); r.onsuccess = () => { const q = r.result.transaction("files").objectStore("files").getAll(); q.onsuccess = () => q.result[0].blob.arrayBuffer().then((b) => crypto.subtle.digest("SHA-256", b)).then((h) => res(Array.from(new Uint8Array(h)).map((x) => x.toString(16).padStart(2, "0")).join(""))); }; }));
ok(stored === SHA, "stored original sha256 equals the fixture's after open, draw and reload");
const undoRec = await page.evaluate(() => STUDY._state().stack.u.length);
ok(undoRec === 2, "the undo stack was restored from storage");

/* ---- zoom and page jump ---- */
await page.fill("#stPage", "2"); await page.click('[data-act="st-go"]');
await page.waitForFunction(() => STUDY._state().sc.scrollTop > 100);
ok(true, "page jump scrolls to page 2");
await page.click('[data-act="st-zoom"][data-v="+"]');
ok(await page.evaluate(() => STUDY._state().z === 1.25), "zoom in");
/* ---- eraser: a touch on a stroke removes the whole stroke; undo restores it ---- */
await page.evaluate(() => { STUDY._state().sc.scrollTop = 0; });
await page.waitForSelector('.st-ov[data-n="1"]');
await page.click('[data-act="st-tool"][data-v="er"]');
await page.evaluate(() => {
  const ov = document.querySelector('.st-ov[data-n="1"]'), r = ov.getBoundingClientRect(), f = (t) => ov.dispatchEvent(new PointerEvent(t, { pointerId: 9, pointerType: "pen", isPrimary: true, pressure: 0.5, clientX: r.left + 0.36 * r.width, clientY: r.top + (0.2 + 0.03) * r.height, bubbles: true, cancelable: true }));
  f("pointerdown"); f("pointerup");
});
ok(await live() === 1, "eraser removes the whole stroke it touches");
await page.click('[data-act="st-undo"]');
ok(await live() === 2, "undo of an erase restores the stroke");
ok(errors.length === 0, "no uncaught page error " + errors.join("|"));

await browser.close(); if (serveProc) serveProc.kill();
console.log(fails ? "\n" + fails + " FAILED" : "\nALL PASSED");
process.exit(fails ? 1 : 0);
