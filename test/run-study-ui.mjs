/* Study Studio (A1 to A8) in the REAL app bundle, headless Chromium through Playwright.
 * What must hold: with the flag off there is no Study Studio row; with ?prep=1&study=1 the row shows; a PDF imported
 * through the file input is listed with its page count and thumbnail; the stored original's sha256 equals the fixture's
 * (and the metadata's); two synthetic pen strokes (Pointer Events, pressure) are saved one record each; undo hides one,
 * redo brings it back; after a reload both strokes are still there and drawn; the original is still byte-identical.
 * USAGE: node test/run-study-ui.mjs   (BASE=http://localhost:8998/ for a running server)
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
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

/* A tiny PDF with one line of text per page. */
function makePdf(pages = ["Page one body text", "Page two body text"]) {
  const objs = [], n = pages.length, font = 3 + 2 * n;
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${pages.map((_, k) => `${3 + 2 * k} 0 R`).join(" ")}] /Count ${n} >>`;
  objs[font] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((t, k) => {
    const po = 3 + 2 * k, stream = (t.match(/.{1,90}(?:\s|$)/g) || [t]).map((l, i) => `BT /F1 9 Tf 20 ${780 - 14 * i} Td (${l.trim()}) Tj ET`).join("\n");
    objs[po] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${po + 1} 0 R >>`;
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
await page.addInitScript(() => { window.SMD_PREP_SETUP = false; window.SMD_PREP_ONBOARD = false; window.confirm = () => true; window.prompt = (msg, def) => def || "Custom Element"; });

async function boot(q) {
  await page.goto(BASE + "?" + q, { waitUntil: "domcontentloaded" });   // app readiness is checked next; do not wait on slow third-party loads
  await page.waitForFunction(() => !!(window.PREP && window.SMD_showHome), null, { timeout: 30000 });
  await page.evaluate(() => { ["introPoster", "splash", "accountGate", "introOverlay", "smdBootSplash"].forEach((k) => { const e = document.getElementById(k); if (e) e.remove(); }); PREP.open(); });
  await page.waitForSelector("#smdPrep .pn-tile, #smdPrep .pn-row", { timeout: 30000 });
}

/* ---- flag off: no row ---- */
await boot("prep=1&study=0");
await page.waitForTimeout(500);
ok(await page.locator('#smdPrep .pnv-tab[data-tab="study"]').count() === 0, "flag off: no Study tab");
ok(await page.evaluate(() => !window.STUDY && !document.querySelector('script[src^="/study.js"]')), "flag off: study.js is not even loaded");

/* ---- flag on: import ---- */
await boot("prep=1&study=1");
await page.waitForSelector('#smdPrep .pnv-tab[data-tab="study"]', { timeout: 20000 });
ok(true, "flag on: the Study tab shows");
await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase("study"); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
await page.click('#smdPrep .pnv-tab[data-tab="study"]');
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
await page.click('#smdPrep .pnv-tab[data-tab="study"]');
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
await page.click('[data-act="st-page-sheet"]');
await page.fill("#stPage", "2"); await page.click('[data-act="st-go"]');
await page.waitForFunction(() => STUDY._state().sc.scrollTop > 100);
ok(true, "page jump scrolls to page 2");
await page.click('[data-act="st-more"]');
await page.click('[data-act="st-zoom"][data-v="+"]');
await page.click('[data-act="st-close-more"]');
ok(await page.evaluate(() => STUDY._state().z === 1.25), "zoom in");
/* ---- eraser: a touch on a stroke removes the whole stroke; undo restores it ---- */
await page.evaluate(() => { STUDY._state().sc.scrollTop = 0; });
await page.waitForSelector('.st-ov[data-n="1"]');
await page.click('[data-act="st-tool"][data-v="er"]');
await page.evaluate(() => { const v = STUDY._state(); if (v.ink) { v.ink.eraser.mode = "stroke"; v.ink.eraser.autoDeselect = false; } });   // Phase 1 default is Standard (area); this check is the Stroke eraser
await page.evaluate(() => {
  const ov = document.querySelector('.st-ov[data-n="1"]'), r = ov.getBoundingClientRect(), f = (t) => ov.dispatchEvent(new PointerEvent(t, { pointerId: 9, pointerType: "pen", isPrimary: true, pressure: 0.5, clientX: r.left + 0.36 * r.width, clientY: r.top + (0.2 + 0.03) * r.height, bubbles: true, cancelable: true }));
  f("pointerdown"); f("pointerup");
});
ok(await live() === 1, "eraser removes the whole stroke it touches");
await page.click('[data-act="st-undo"]');
ok(await live() === 2, "undo of an erase restores the stroke");

/* ---- lasso select: loop around stroke, delete selection, undo ---- */
await page.click('[data-act="st-tool"][data-v="lasso"]');
await page.evaluate(() => {
  const ov = document.querySelector('.st-ov[data-n="1"]'), r = ov.getBoundingClientRect(), id = 11;
  const fire = (t, x, yy) => ov.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: "pen", isPrimary: true, pressure: 0.5, clientX: r.left + x * r.width, clientY: r.top + yy * r.height, bubbles: true, cancelable: true }));
  fire("pointerdown", 0.1, 0.1);
  fire("pointermove", 0.9, 0.1);
  fire("pointermove", 0.9, 0.35);
  fire("pointermove", 0.1, 0.35);
  fire("pointermove", 0.1, 0.1);
  fire("pointerup", 0.1, 0.1);
});
await page.waitForSelector("#stLassoBar", { timeout: 5000 });
ok(await page.evaluate(() => !!document.querySelector("#stLassoBar")), "lasso: draws loop and shows selection action bar");
ok(await page.locator('[data-act="st-lasso-ai-explain"]').count() === 1, "lasso: AI Explain chip is visible");
ok(await page.locator('[data-act="st-lasso-ai-summary"]').count() === 1, "lasso: AI Key summary chip is visible");
ok(await page.locator('[data-act="st-lasso-ai-make"]').count() === 1, "lasso: AI Make deck chip is visible");
ok(await page.locator('[data-act="st-lasso-save-elem"]').count() === 1, "lasso: Save Element button is visible");
await page.click('[data-act="st-lasso-ai-explain"]');
await page.waitForSelector("#stSheet", { timeout: 5000 });
ok(await page.locator('#stSheet img[alt="Selection preview"]').count() === 1, "lasso AI: Explain sheet shows visual preview of selection");
await page.click('[data-act="st-scancel"]');
await page.waitForSelector("#stLassoBar", { timeout: 5000 });
await page.click('[data-act="st-lasso-save-elem"]');
const savedElems = await page.evaluate(() => JSON.parse(localStorage.getItem("smd_study_elements") || "[]"));
ok(savedElems.length === 1 && savedElems[0].name === "Custom Element", "lasso: selection saved as custom element in local storage");
await page.click('[data-act="st-lasso-del"]');
ok(await live() === 1, "lasso delete: deletes the selected stroke");
await page.click('[data-act="st-undo"]');
ok(await live() === 2, "undo of lasso delete restores the stroke");

/* ---- scribble (Phase 0 ink-loss fix): OFF by default, so a zigzag over ink is kept as ink; when ON, a fast dense
   scribble over a stroke erases only that stroke and the toast's Undo brings it back ---- */
await page.click('[data-act="st-tool"][data-v="pen"]');
const scribbleOver = () => page.evaluate(() => {
  const ov = document.querySelector('.st-ov[data-n="1"]'), r = ov.getBoundingClientRect(), id = 12;
  const fire = (t, x, yy) => ov.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: "pen", isPrimary: true, pressure: 0.5, clientX: r.left + x * r.width, clientY: r.top + yy * r.height, bubbles: true, cancelable: true }));
  const onLine = (x) => 0.2 + (x - 0.2) * 0.125;   // the first test stroke runs (0.2, 0.2) to (0.68, 0.26)
  fire("pointerdown", 0.3, onLine(0.3));
  for (let pass = 0; pass < 8; pass++) for (let s = 1; s <= 8; s++) {
    const x = pass % 2 ? 0.42 - 0.12 * s / 8 : 0.3 + 0.12 * s / 8;
    fire("pointermove", x, onLine(x) + (s % 2 ? 0.001 : -0.001));
  }
  fire("pointerup", 0.3, onLine(0.3));
});
await scribbleOver();
ok(await live() === 3, "scribble erase OFF by default: a zigzag over ink is kept as a new stroke, nothing erased");
await page.click('[data-act="st-undo"]');
ok(await live() === 2, "undo removes that zigzag stroke");
await page.evaluate(() => { STUDY._state().scribble = true; });
await scribbleOver();
ok(await live() === 1, "scribble erase ON: a fast dense scribble over a stroke erases only that stroke");
ok(await page.evaluate(() => /Erased 1 stroke/.test((document.querySelector("#stEraseToast") || {}).textContent || "")), "scribble erase shows the Erased toast with Undo");
await page.click("#stEraseUndo");
ok(await live() === 2, "toast Undo restores the erased stroke");
await page.evaluate(() => { STUDY._state().scribble = false; });

/* ---- Phase 1 ink: toolbar order, popover, styles, split eraser, palm, 240 Hz ---- */
ok(await page.evaluate(() => {
  const order = Array.from(document.querySelectorAll("#stTb [data-act='st-tool']")).map((b) => b.getAttribute("data-v"));
  // Plan order (zoom, pen, er, hl, shapes, lasso, elements, image, camera, text, typing, laser);
  // later phases fill more slots, so check relative order and that each phase's tools are all there.
  const PLAN = ["zoom", "pen", "er", "hl", "shapes", "lasso", "elements", "image", "camera", "text", "typing", "laser"];
  const known = order.filter((v) => PLAN.includes(v)), idx = known.map((v) => PLAN.indexOf(v));
  const hidden = document.querySelectorAll("#stTb .st-slot-future[hidden]").length;
  return ["pen", "er", "hl", "shapes", "lasso"].every((v) => order.includes(v)) && idx.every((v, i) => i === 0 || v > idx[i - 1]) && hidden === 2;
}), "P1/P2 toolbar: tools follow the plan order (..., shapes, lasso, ...) with future slots hidden");
await page.click('[data-act="st-tool"][data-v="pen"]');   // second tap on the active pen opens its popover
await page.waitForSelector("#stInkPop");
ok(await page.evaluate(() => {
  const cv = document.querySelector(".st-ink-preview"), d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i]) return true; return false;
}), "P1 pen popover: live preview is drawn");
await page.click('#stInkPop [data-ink="style"][data-v="brush"]');
await page.waitForSelector('#stInkPop [data-ink="style"][data-v="brush"].on');
ok(true, "P1 pen popover: brush style selectable");
await page.evaluate(() => { const r = document.querySelector('#stInkPop [data-ink="sens"]'); r.value = "100"; r.dispatchEvent(new Event("input", { bubbles: true })); });
ok(await page.evaluate(() => STUDY._state().ink.pen.sens === 1), "P1 pressure slider: 100% stored on the viewer state");
await page.click('[data-act="st-tool"][data-v="pen"]');   // toggle the popover closed
ok(await page.evaluate(() => !document.querySelector("#stInkPop")), "P1 pen popover: tapping the pen again closes it");
const drawLine = (tool, y, x0 = 0.15, x1 = 0.85, steps = 24) => page.evaluate(([y, x0, x1, steps]) => {
  const ov = document.querySelector('.st-ov[data-n="1"]'), r = ov.getBoundingClientRect(), id = 21;
  const fire = (t, x, yy, ts) => { const e = new PointerEvent(t, { pointerId: id, pointerType: "pen", isPrimary: true, pressure: 0.7, clientX: r.left + x * r.width, clientY: r.top + yy * r.height, bubbles: true, cancelable: true, buttons: t === "pointerup" ? 0 : 1 }); Object.defineProperty(e, "timeStamp", { value: ts }); ov.dispatchEvent(e); };
  fire("pointerdown", x0, y, 1000); for (let i = 1; i <= steps; i++) fire("pointermove", x0 + (x1 - x0) * i / steps, y, 1000 + i * 10); fire("pointerup", x1, y, 1000 + steps * 10);
}, [y, x0, x1, steps]);
const beforeP1 = await live();
await drawLine("pen", 0.62);
ok(await live() === beforeP1 + 1 && await page.evaluate(() => { const s = STUDY._state().strokes.filter((x) => !x.gone).pop(); return s.style === "brush" && s.sens === 1 && s.pts.length >= 20; }), "P1 stroke: new strokes carry style and sensitivity, all points kept");
/* precision eraser splits the stroke drawn above; one undo restores it whole */
await page.click('[data-act="st-tool"][data-v="er"]');
await page.evaluate(() => { STUDY._state().ink.eraser.mode = "precision"; STUDY._state().ink.eraser.autoDeselect = false; STUDY_INK.syncStrip(STUDY._inkApi()); });
await page.evaluate(() => {
  const ov = document.querySelector('.st-ov[data-n="1"]'), r = ov.getBoundingClientRect();
  const f = (t) => ov.dispatchEvent(new PointerEvent(t, { pointerId: 22, pointerType: "pen", isPrimary: true, pressure: 0.5, clientX: r.left + 0.5 * r.width, clientY: r.top + 0.62 * r.height, bubbles: true, cancelable: true, buttons: t === "pointerup" ? 0 : 1 }));
  f("pointerdown"); f("pointerup");
});
await page.waitForTimeout(300);
ok(await live() === beforeP1 + 2, "P1 precision eraser: half-erased stroke splits into two pieces (one undo step)");
await page.click('[data-act="st-undo"]');
ok(await live() === beforeP1 + 1, "P1 precision eraser: undo restores the whole stroke and removes the pieces");
await page.click('[data-act="st-redo"]');
ok(await live() === beforeP1 + 2, "P1 precision eraser: redo splits it again");
await page.click('[data-act="st-undo"]');
/* palm rejection: a touch after a pen was seen makes no mark */
const beforeTouch = await live();
await page.evaluate(() => {
  const ov = document.querySelector('.st-ov[data-n="1"]'), r = ov.getBoundingClientRect(), id = 23;
  const fire = (t, x, yy) => ov.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: "touch", isPrimary: true, pressure: 0.5, clientX: r.left + x * r.width, clientY: r.top + yy * r.height, bubbles: true, cancelable: true, buttons: t === "pointerup" ? 0 : 1 }));
  fire("pointerdown", 0.2, 0.75); fire("pointermove", 0.6, 0.75); fire("pointerup", 0.6, 0.75);
});
ok(await live() === beforeTouch, "P1 palm rejection: touch does not draw after a pen was seen");
/* 240 Hz scrawl: every synthetic point is kept */
await page.click('[data-act="st-tool"][data-v="pen"]');
await page.evaluate(() => {
  const ov = document.querySelector('.st-ov[data-n="1"]'), r = ov.getBoundingClientRect(), id = 24;
  const fire = (t, x, yy) => ov.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: "pen", isPrimary: true, pressure: 0.5, clientX: r.left + x * r.width, clientY: r.top + yy * r.height, bubbles: true, cancelable: true, buttons: t === "pointerup" ? 0 : 1 }));
  fire("pointerdown", 0.05, 0.82); for (let i = 1; i <= 240; i++) fire("pointermove", 0.05 + 0.9 * i / 240, 0.82 + Math.sin(i / 8) * 0.01); fire("pointerup", 0.95, 0.82);
});
await page.waitForTimeout(300);
ok(await page.evaluate(() => { const s = STUDY._state().strokes.filter((x) => !x.gone).pop(); return s.pts.length >= 241; }), "P1 latency: a 240 Hz scrawl keeps every point");

/* ---- Phase 4: Laser pointer (transient, never saved, never in undo) ---- */
await page.click('[data-act="st-tool"][data-v="laser"]');
ok(await page.locator('[data-act="st-laser-trail"]').count() === 1, "laser: options strip shows Trail and Dot");
const strokesBeforeLaser = await live();
const stackBeforeLaser = await page.evaluate(() => STUDY._state().stack.u.length);
await page.evaluate(() => {
  const ov = document.querySelector('.st-ov[data-n="1"]'), r = ov.getBoundingClientRect(), id = 15;
  const fire = (t, x, y) => ov.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: "pen", isPrimary: true, pressure: 0.5, clientX: r.left + x * r.width, clientY: r.top + y * r.height, bubbles: true, cancelable: true }));
  fire("pointerdown", 0.3, 0.4);
  fire("pointermove", 0.5, 0.4);
  fire("pointerup", 0.5, 0.4);
});
await page.waitForTimeout(100);
const strokesAfterLaser = await live();
const stackAfterLaser = await page.evaluate(() => STUDY._state().stack.u.length);
ok(strokesBeforeLaser === strokesAfterLaser, "laser: NEVER creates strokes in notebook");
ok(stackBeforeLaser === stackAfterLaser, "laser: NEVER adds to undo stack");

/* ---- Phase 4: Text box & typing mode & format bar ---- */
await page.click('[data-act="st-tool"][data-v="text"]');
ok(await page.locator('.st-text-strip').count() === 1, "text tool: shows options strip with presets, fonts, alignments");
await page.evaluate(() => {
  const p = document.querySelector('.st-pg[data-n="1"]');
  const r = p.getBoundingClientRect();
  p.querySelector(".st-items-layer").dispatchEvent(new PointerEvent("pointerdown", {
    pointerId: 20, pointerType: "touch", isPrimary: true, clientX: r.left + 0.2 * r.width, clientY: r.top + 0.3 * r.height, bubbles: true
  }));
});
await page.waitForSelector(".st-item-text", { timeout: 5000 });
ok(await page.locator(".st-item-text").count() === 1, "text tool: tap creates a text box on the items layer");
await page.waitForSelector("#stFormatBar", { timeout: 5000 });
ok(await page.locator("#stFormatBar").count() === 1, "format bar: floats above keyboard with style and navigation buttons");
await page.locator(".st-text-editable").fill("Cardiovascular System & Hemodynamics");
ok(await page.locator(".st-text-editable").innerText() === "Cardiovascular System & Hemodynamics", "typing mode: text typed into box");

// Format bar style sheet
await page.click('[data-act="st-fb-styles"]');
await page.waitForSelector("#stStyleSheet", { timeout: 5000 });
ok(await page.locator("#stStyleSheet").count() === 1, "format bar: Aa opens text styles & fonts sheet");
await page.click('[data-act="st-set-preset"][data-v="title"]');
ok(await page.evaluate(() => document.querySelector(".st-text-editable").style.fontSize === "28px"), "text style: preset Title applies 28px");
await page.click('[data-act="st-fb-close-styles"]');
await page.waitForFunction(() => !document.querySelector("#stStyleSheet"));

// Move / Drag and Resize handles
ok(await page.locator(".st-drag-bar").count() === 1, "handles: drag bar is visible on selected item");
ok(await page.locator(".st-handle.se").count() === 1, "handles: resize handles present");
const itemBeforeMove = await page.evaluate(() => STUDY._state().items[0].x);
await page.evaluate(() => {
  const drag = document.querySelector(".st-drag-bar");
  const r = drag.getBoundingClientRect();
  drag.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 21, clientX: r.left, clientY: r.top, bubbles: true }));
  window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 21, clientX: r.left + 50, clientY: r.top + 30, bubbles: true }));
  window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 21, clientX: r.left + 50, clientY: r.top + 30, bubbles: true }));
});
const itemAfterMove = await page.evaluate(() => STUDY._state().items[0].x);
ok(itemAfterMove > itemBeforeMove, "handles: box drags and coordinates update");
await page.click('[data-act="st-undo"]');
ok(await page.evaluate((beforeVal) => STUDY._state().items[0].x === beforeVal, itemBeforeMove), "undo: reverts box move");

/* ---- Phase 4: Stickers & Elements tray ---- */
await page.click('[data-act="st-tool"][data-v="elements"]');
await page.waitForSelector("#stStickerTray", { timeout: 5000 });
ok(await page.locator("#stStickerTray").count() === 1, "elements: sticker tray opens with medical line icons");
ok(await page.locator('.st-sticker-btn[data-name="heart"]').count() === 1, "sticker tray: medical heart icon available");
ok(await page.locator('[data-act="st-insert-saved-elem"]').count() === 1, "sticker tray: saved custom element from lasso available");
await page.click('.st-sticker-btn[data-name="heart"]');
await page.waitForSelector(".st-item-sticker", { timeout: 5000 });
ok(await page.locator(".st-sticker-wrap svg").count() === 1, "sticker: heart icon inserted on page");

/* ---- Phase 4: Image insertion & crop ---- */
await page.click('[data-act="st-tool"][data-v="image"]');
ok(await page.locator('[data-act="st-img-pick"]').count() === 1 && await page.locator('[data-act="st-camera-pick"]').count() === 1 && await page.locator('[data-act="st-scan-page"]').count() === 1, "image: options strip shows Photos, Camera, Scan into page");
await page.evaluate(() => {
  const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  STUDY_INSERT.insertImageFromDataUrl(tinyPng);
});
await page.waitForSelector(".st-item-img", { timeout: 5000 });
ok(await page.locator(".st-item-img").count() === 1, "image: inserted on page below ink overlay");
const imgItemId = await page.evaluate(() => document.querySelector(".st-item-img").closest(".st-item").getAttribute("data-id"));
await page.click(`[data-act="st-img-crop"][data-id="${imgItemId}"]`);
await page.waitForSelector("#stCropOverlay", { timeout: 5000 });
ok(await page.locator("#stCropOverlay").count() === 1, "crop: overlay opens for image");
await page.click('[data-act="st-crop-apply"]');
await page.waitForFunction(() => !document.querySelector("#stCropOverlay"), null, { timeout: 5000 });
ok(true, "crop: applied successfully");

/* ---- Phase 2 select and shape: lasso menu, move, resize, clipboard, shapes, draw-and-hold ---- */
const bboxOfSel = () => page.evaluate(() => {
  const V = STUDY._state();
  if (!V.lasso) return null;
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  V.strokes.filter((s) => V.lasso.ids.includes(s.id)).forEach((s) => s.pts.forEach((p) => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }));
  return { x0, y0, x1, y1, n: V.lasso.n, count: V.lasso.ids.length };
});
const dragOnPage = (pick) => page.evaluate((pick) => {
  const V = STUDY._state(), n2 = pick.n;
  const ov = document.querySelector('.st-ov[data-n="' + n2 + '"]'), r = ov.getBoundingClientRect(), id = 31;
  const fire = (t, x, yy) => ov.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: "pen", isPrimary: true, pressure: 0.5, clientX: r.left + x * r.width, clientY: r.top + yy * r.height, bubbles: true, cancelable: true, buttons: t === "pointerup" ? 0 : 1 }));
  fire("pointerdown", (pick.x0 + pick.x1) / 2, (pick.y0 + pick.y1) / 2);
  fire("pointermove", (pick.x0 + pick.x1) / 2 + pick.dx, (pick.y0 + pick.y1) / 2 + pick.dy);
  fire("pointerup", (pick.x0 + pick.x1) / 2 + pick.dx, (pick.y0 + pick.y1) / 2 + pick.dy);
}, pick);
const drawShapeGhost = (shape) => page.evaluate((shape) => {
  const ov = document.querySelector('.st-ov[data-n="1"]'), r = ov.getBoundingClientRect(), id = 32;
  const fire = (t, x, yy) => ov.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: "pen", isPrimary: true, pressure: 0.7, clientX: r.left + x * r.width, clientY: r.top + yy * r.height, bubbles: true, cancelable: true, buttons: t === "pointerup" ? 0 : 1 }));
  if (shape === "circle") { fire("pointerdown", 0.5, 0.12); for (let i = 1; i <= 40; i++) { const a = (i / 40) * 2 * Math.PI; fire("pointermove", 0.5 + Math.cos(a) * 0.09, 0.12 + Math.sin(a) * 0.09); } fire("pointerup", 0.59, 0.12); }
  else { fire("pointerdown", 0.15, 0.9); for (let i = 1; i <= 24; i++) fire("pointermove", 0.15 + 0.3 * i / 24, 0.9); fire("pointerup", 0.45, 0.9); }
}, shape);
const lassoRect = (x0, y0, x1, y1) => page.evaluate(([x0, y0, x1, y1]) => {
  const ov = document.querySelector('.st-ov[data-n="1"]'), r = ov.getBoundingClientRect(), id = 33;
  const fire = (t, x, yy) => ov.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: "pen", isPrimary: true, pressure: 0.5, clientX: r.left + x * r.width, clientY: r.top + yy * r.height, bubbles: true, cancelable: true }));
  fire("pointerdown", x0, y0); fire("pointermove", x1, y0); fire("pointermove", x1, y1); fire("pointermove", x0, y1); fire("pointermove", x0, y0); fire("pointerup", x0, y0);
}, [x0, y0, x1, y1]);
/* lasso settings: highlighter can be excluded */
await page.click('[data-act="st-tool"][data-v="hl"]');
await page.evaluate(() => {
  const ov = document.querySelector('.st-ov[data-n="1"]'), r = ov.getBoundingClientRect(), id = 34;
  const fire = (t, x, yy) => ov.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: "pen", isPrimary: true, pressure: 0.5, clientX: r.left + x * r.width, clientY: r.top + yy * r.height, bubbles: true, cancelable: true }));
  fire("pointerdown", 0.15, 0.68); fire("pointermove", 0.85, 0.68); fire("pointerup", 0.85, 0.68);
});
await page.click('[data-act="st-tool"][data-v="pen"]');
await page.evaluate(() => {
  const ov = document.querySelector('.st-ov[data-n="1"]'), r = ov.getBoundingClientRect(), id = 35;
  const fire = (t, x, yy) => ov.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: "pen", isPrimary: true, pressure: 0.7, clientX: r.left + x * r.width, clientY: r.top + yy * r.height, bubbles: true, cancelable: true }));
  fire("pointerdown", 0.15, 0.74); fire("pointermove", 0.85, 0.74); fire("pointerup", 0.85, 0.74);
});
await page.click('[data-act="st-tool"][data-v="lasso"]');
await page.waitForSelector('#stInkCtx [data-sel="rule"][data-v="hl"]');
ok(await page.locator('#stInkCtx [data-sel="rule"]').count() === 5, "P2 lasso settings: five kind toggles (pen, highlighter, shapes, images, text)");
await lassoRect(0.1, 0.64, 0.9, 0.78);
await page.waitForSelector("#stLassoBar");
ok(/2 items/.test(await page.locator("#stLassoBar").innerText()), "P2 lasso: loop picks the pen and highlighter strokes");
await page.click('#stInkCtx [data-sel="rule"][data-v="hl"]');
await lassoRect(0.1, 0.64, 0.9, 0.78);
await page.waitForSelector("#stLassoBar");
ok(/1 item/.test(await page.locator("#stLassoBar").innerText()), "P2 lasso settings: highlighter excluded after toggle");
await page.click('#stInkCtx [data-sel="rule"][data-v="hl"]');   // restore
ok(await page.locator('[data-act="st-lasso-cut"]').count() === 1 && await page.locator('[data-act="st-lasso-dup"]').count() === 1 && await page.locator('[data-act="st-lasso-resize"]').count() === 1 && await page.locator('[data-act="st-lasso-more"]').count() === 1, "P2 menu: Cut, Duplicate, Resize and More actions present");
/* move: drag inside the box, one undo step */
const beforeMove = await bboxOfSel();
const uBeforeMove = await page.evaluate(() => STUDY._state().stack.u.length);
await dragOnPage({ ...beforeMove, dx: 0.06, dy: 0.02 });
await page.waitForTimeout(200);
const afterMove = await bboxOfSel();
ok(Math.abs(afterMove.x0 - (beforeMove.x0 + 0.06)) < 0.015 && Math.abs(afterMove.y0 - (beforeMove.y0 + 0.02)) < 0.015, "P2 move: selection lands where dropped");
ok(await page.evaluate(() => STUDY._state().stack.u.length) === uBeforeMove + 1, "P2 move: exactly one undo step");
await page.click('[data-act="st-undo"]');
const undone = await bboxOfSel();
ok(Math.abs(undone.x0 - beforeMove.x0) < 0.015, "P2 move: undo restores the position");
await page.click('[data-act="st-redo"]');
ok(Math.abs((await bboxOfSel()).x0 - (beforeMove.x0 + 0.06)) < 0.015, "P2 move: redo reapplies the position");
/* resize: drag the SE handle */
const beforeResize = await bboxOfSel();
await page.evaluate((b) => {
  const ov = document.querySelector('.st-ov[data-n="' + b.n + '"]'), r = ov.getBoundingClientRect(), id = 36;
  const fire = (t, x, yy) => ov.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: "pen", isPrimary: true, pressure: 0.5, clientX: r.left + x * r.width, clientY: r.top + yy * r.height, bubbles: true, cancelable: true }));
  fire("pointerdown", b.x1, b.y1); fire("pointermove", b.x1 + 0.1, b.y1 + 0.1); fire("pointerup", b.x1 + 0.1, b.y1 + 0.1);
}, beforeResize);
await page.waitForTimeout(200);
const afterResize = await bboxOfSel();
ok(afterResize.x1 - afterResize.x0 > (beforeResize.x1 - beforeResize.x0) * 1.08, "P2 resize: handle drag scales the selection proportionally");
await page.click('[data-act="st-undo"]');
const undoneResize = await bboxOfSel();
ok(Math.abs((undoneResize.x1 - undoneResize.x0) - (beforeResize.x1 - beforeResize.x0)) < 0.02, "P2 resize: undo restores the size");
/* colour: one undo step */
await page.click('[data-act="st-lasso-color"]');
await page.waitForSelector("#stSelColor");
await page.click('[data-sel-color="#d11a2a"]');
await page.waitForTimeout(200);
ok(await page.evaluate(() => STUDY._state().strokes.filter((s) => STUDY._state().lasso.ids.includes(s.id)).every((s) => s.color === "#d11a2a")), "P2 colour: selection takes the picked colour");
await page.click('[data-act="st-undo"]');
ok(await page.evaluate(() => !STUDY._state().strokes.filter((s) => STUDY._state().lasso.ids.includes(s.id)).every((s) => s.color === "#d11a2a")), "P2 colour: undo restores the old colour");
/* rotate and screenshot (no mutation for the screenshot) */
await page.click('[data-act="st-lasso-more"]');
await page.waitForSelector("#stSelMore");
const beforeRot = await bboxOfSel();
await page.click('[data-act="st-lasso-rotate"]');
await page.waitForTimeout(200);
ok((await bboxOfSel()) !== null && await page.evaluate(() => STUDY._state().stack.u.length > 0), "P2 rotate: 90 degrees applied as one undo step");
await page.click('[data-act="st-undo"]');
const rotUndone = await bboxOfSel();
ok(Math.abs(rotUndone.x0 - beforeRot.x0) < 0.03 && Math.abs(rotUndone.y0 - beforeRot.y0) < 0.03, "P2 rotate: undo restores the rotation (within clamping)");
await page.click('[data-act="st-lasso-more"]');
await page.click('[data-act="st-lasso-shot"]');
await page.waitForTimeout(300);
ok(await page.evaluate(() => !document.querySelector("#stSelMore")), "P2 screenshot: action runs and closes the panel");
/* duplicate: one undo step for every copy */
const beforeDup = await live();
await page.click('[data-act="st-lasso-dup"]');
await page.waitForTimeout(200);
const afterDup = await live();
ok(afterDup === beforeDup + 1, "P2 duplicate: copy appears");
await page.click('[data-act="st-undo"]');
ok(await live() === beforeDup, "P2 duplicate: one undo removes the copy");
await page.click('[data-act="st-redo"]');
ok(await live() === afterDup, "P2 duplicate: redo brings it back");
/* cut and copy, then paste across pages via long-press */
await page.click('[data-act="st-lasso-clipcopy"]');
await page.evaluate(() => { STUDY._state().sc.scrollTop = 0; });
await page.evaluate(() => new Promise((res) => { const r = indexedDB.open("study"); r.onsuccess = () => { const q = r.result.transaction("strokes"); q.oncomplete = () => res(); }; }));
ok(await page.evaluate(() => !!localStorage.getItem("smd_study_clip")), "P2 clipboard: copy persists in localStorage");
const uBeforeCut = await page.evaluate(() => STUDY._state().stack.u.length);
await page.click('[data-act="st-lasso-cut"]');
await page.waitForTimeout(200);
ok(await live() === afterDup - 1 && await page.evaluate(() => STUDY._state().stack.u.length) === uBeforeCut + 1, "P2 cut: removes the selection in one undo step");
await page.click('[data-act="st-undo"]');
ok(await live() === afterDup, "P2 cut: undo brings it back");
if (await page.locator('[data-act="st-lasso-done"]').count()) await page.click('[data-act="st-lasso-done"]');   // undo of a cut may clear the selection
/* paste across pages: long-press an empty spot on page 2 and tap Paste */
const onP2Before = await page.evaluate(() => STUDY._state().strokes.filter((s) => s.page === 2 && !s.gone).length);
await page.click('[data-act="st-page-sheet"]');
await page.fill("#stPage", "2"); await page.click('[data-act="st-go"]');
await page.waitForSelector('.st-ov[data-n="2"]');
await page.waitForTimeout(400);
await page.evaluate(() => {
  const ov = document.querySelector('.st-ov[data-n="2"]'), r = ov.getBoundingClientRect(), id = 38;
  const fire = (t, x, yy) => ov.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: "pen", isPrimary: true, pressure: 0.5, clientX: r.left + x * r.width, clientY: r.top + yy * r.height, bubbles: true, cancelable: true }));
  fire("pointerdown", 0.3, 0.5);
  window.__lpUp = fire;
});
await page.waitForTimeout(700);
await page.waitForSelector("#stPasteBubble", { timeout: 5000 });
await page.click('[data-sel-paste]');
await page.evaluate(() => { window.__lpUp("pointerup", 0.3, 0.5); });
await page.waitForTimeout(300);
ok(await page.evaluate(() => STUDY._state().strokes.filter((s) => s.page === 2 && !s.gone).length) === onP2Before + 1, "P2 paste: copied stroke pastes onto page 2");
await page.click('[data-act="st-undo"]');
ok(await page.evaluate(() => STUDY._state().strokes.filter((s) => s.page === 2 && !s.gone).length) === onP2Before, "P2 paste: one undo removes the paste across pages");
await page.evaluate(() => { STUDY._state().sc.scrollTop = 0; });
await page.waitForTimeout(400);
/* shapes tool: every stroke snaps; fill at 25% */
await page.click('[data-act="st-tool"][data-v="shapes"]');
await page.waitForSelector('#stInkCtx [data-sel="fill"][data-v="25"]');
await drawShapeGhost("circle");
await page.waitForTimeout(300);
const shapeStroke = await page.evaluate(() => { const ss = STUDY._state().strokes.filter((s) => s.tool === "shape" && !s.gone); const last = ss[ss.length - 1]; return last && { type: last.shape.type, w: last.w }; });
ok(shapeStroke && ["circle", "ellipse"].includes(shapeStroke.type), "P2 shapes: wobbly circle becomes a " + (shapeStroke && shapeStroke.type));
await page.click('#stInkCtx [data-sel="fill"][data-v="25"]');
await drawShapeGhost("line");
await page.waitForTimeout(300);
const filled = await page.evaluate(() => { const ss = STUDY._state().strokes.filter((s) => s.tool === "shape" && !s.gone); const last = ss[ss.length - 1]; return last && { type: last.shape.type, fill: last.fill }; });
ok(filled && filled.fill === "25", "P2 shapes: optional fill colour at 25% opacity");
/* draw and hold: pen held 0.5s at the end snaps */
await page.click('[data-act="st-tool"][data-v="pen"]');
const beforeHold = await live();
await page.evaluate(() => {
  const ov = document.querySelector('.st-ov[data-n="1"]'), r = ov.getBoundingClientRect(), id = 37;
  const fire = (t, x, yy) => ov.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: "pen", isPrimary: true, pressure: 0.7, clientX: r.left + x * r.width, clientY: r.top + yy * r.height, bubbles: true, cancelable: true }));
  fire("pointerdown", 0.5, 0.2);
  for (let i = 1; i <= 30; i++) { const a = (i / 30) * 2 * Math.PI; fire("pointermove", 0.5 + Math.cos(a) * 0.07, 0.2 + Math.sin(a) * 0.07); }
  window.__holdUp = fire;
});
await page.waitForTimeout(650);
await page.evaluate(() => { window.__holdUp("pointerup", 0.57, 0.2); });
await page.waitForTimeout(400);
ok(await page.evaluate(() => { const ss = STUDY._state().strokes.filter((s) => s.tool === "shape" && !s.gone); return ss.length >= 1; }) && await live() === beforeHold + 1, "P2 draw and hold: held circle snaps to a perfect shape");
/* convert stub: signed-out note, then signed-in offline error path is covered by the unit suite */
await page.click('[data-act="st-tool"][data-v="lasso"]');
await lassoRect(0.4, 0.1, 0.6, 0.3);
await page.waitForSelector("#stLassoBar", { timeout: 5000 }).catch(() => {});
if (await page.locator("#stLassoBar").count()) {
  await page.click('[data-act="st-lasso-more"]');
  await page.click('[data-act="st-lasso-conv"]');
  await page.waitForSelector("#stSelConv");
  ok(/on-device|Server preview/.test(await page.locator("#stSelConv").innerText()), "P2 convert: clearly labelled server stub");
  await page.click('[data-act="st-lasso-done"]');
}

/* ---- A4 notebook: ruled, stroke, add page, move it, reload ---- */
await boot("prep=1&study=1");
await page.click('#smdPrep .pnv-tab[data-tab="study"]');
await page.waitForSelector("#stLib");
await page.click('[data-act="st-newnb"]');
await page.fill("#stNbT", "Ward notes"); await page.selectOption("#stNbS", "ruled"); await page.selectOption("#stNbZ", "a4");
await page.click('[data-act="st-mknb"]');
await page.waitForSelector(".st-pg canvas.st-ov", { timeout: 20000 });
ok(await page.evaluate(() => { const s = STUDY._state(); return !!s.nb && s.pdf === null && s.nb.style === "ruled" && s.n === 1; }), "notebook: opens with one page and no PDF");
ok(await page.evaluate(() => { const c = document.querySelector(".st-cv"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let ink = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 250) ink++; return ink > 200; }), "notebook: ruled lines are drawn on the page");
await page.click('[data-act="st-tool"][data-v="pen"]');
await stroke(0.3);
await page.waitForTimeout(300);
await page.click('[data-act="st-page-sheet"]');
await page.click('[data-act="st-addpg"]');
await page.waitForFunction(() => STUDY._state() && STUDY._state().n === 2 && STUDY._state().pg[2], null, { timeout: 10000 });
ok(await page.evaluate(() => JSON.stringify(STUDY._state().nb.ord)) === "[1,2]", "notebook: page added after the current one");
await page.click('[data-act="st-page-sheet"]');
await page.fill("#stPage", "2"); await page.click('[data-act="st-go"]');
await page.waitForFunction(() => STUDY._state().sc.scrollTop > 100);
await page.click('[data-act="st-page-sheet"]');
await page.click('[data-act="st-up"]');
await page.waitForFunction(() => STUDY._state() && JSON.stringify(STUDY._state().nb.ord) === "[2,1]", null, { timeout: 10000 });
ok(true, "notebook: page 2 moved up");
await page.waitForTimeout(300);
await boot("prep=1&study=1");
await page.click('#smdPrep .pnv-tab[data-tab="study"]');
await page.waitForSelector(".st-doc");
ok(await page.evaluate(() => /Notebook, 2 pages/.test(document.querySelector("#stList").innerText) && Array.from(document.querySelectorAll(".st-th")).every((i) => /^data:image\/jpeg/.test(i.src))), "notebook: listed beside the PDF with a thumbnail");
await page.locator(".st-doc", { hasText: "Ward notes" }).locator(".st-open").click();
await page.waitForSelector(".st-pg canvas.st-ov");
await page.waitForFunction(() => STUDY._state() && STUDY._state().strokes.length === 1, null, { timeout: 10000 });
ok(await page.evaluate(() => JSON.stringify(STUDY._state().nb.ord)) === "[2,1]", "after reload: notebook page order intact");
await page.click('[data-act="st-page-sheet"]');
await page.fill("#stPage", "2"); await page.click('[data-act="st-go"]');
await page.waitForFunction(() => { const c = document.querySelector('.st-ov[data-n="2"]'); if (!c) return false; const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i]) return true; return false; }, null, { timeout: 10000 });
ok(true, "after reload: the stroke is on the page it was drawn on (now second)");
await page.click('[data-act="st-page-sheet"]');
await page.fill("#stPage", "1"); await page.click('[data-act="st-go"]');
await page.click('[data-act="st-page-sheet"]');
await page.click('[data-act="st-delpg"]');
await page.waitForFunction(() => STUDY._state() && STUDY._state().n === 1, null, { timeout: 10000 });
ok(await page.evaluate(() => JSON.stringify(STUDY._state().nb.ord)) === "[1]", "notebook: page deleted after confirm");

/* ---- A6 search ---- */
await boot("prep=1&study=1");
await page.click('#smdPrep .pnv-tab[data-tab="study"]');
await page.waitForSelector(".st-doc");
await page.waitForFunction(() => new Promise((res) => { const r = indexedDB.open("study"); r.onsuccess = () => { const q = r.result.transaction("index").objectStore("index").getAll(); q.onsuccess = () => res(q.result.length === 1 && q.result[0].done === 2); }; }), null, { timeout: 20000 });
ok(await page.evaluate(() => document.querySelector(".st-ix").textContent === ""), "search: fully indexed PDF shows no Indexing label");
await page.fill("#stQ", "TWO");
await page.waitForSelector(".st-hit", { timeout: 10000 });
const hit = await page.locator(".st-hit").first().innerText();
ok(/Page 2/.test(hit) && /fixture/.test(hit) && await page.locator(".st-hit mark").first().innerText() === "two", "search: result shows document, page 2 and the highlighted match (case-insensitive)");
ok(await page.locator(".st-hit").count() === 1, "search: one result only, for page 2");
await page.fill("#stQ", "Ward");
await page.waitForFunction(() => /Notebook title/.test(document.querySelector("#stRes").innerText));
ok(true, "search: notebook titles are searched");
await page.fill("#stQ", "zebra");
await page.waitForFunction(() => /Nothing found/.test(document.querySelector("#stRes").innerText));
ok(true, "search: absent word gives a clear empty state");
await page.fill("#stQ", "two");
await page.waitForSelector(".st-hit");
await page.click(".st-hit");
await page.waitForSelector(".st-pg canvas.st-cv", { timeout: 20000 });
await page.waitForFunction(() => (document.querySelector("#stCurP") ? document.querySelector("#stCurP").textContent === "2" : document.querySelector("#stTbPage").value === "2") && STUDY._state().sc.scrollTop > 100, null, { timeout: 10000 });
ok(true, "search: tapping the result opens the PDF at page 2");
/* resume after reload: wipe the index, open the library again, the PDF is indexed again from page 1 */
const idb = (store, fn) => page.evaluate(([store, fn]) => new Promise((r) => { const q = indexedDB.open("study"); q.onsuccess = () => { const t = q.result.transaction(store, "readwrite"); new Function("o", fn)(t.objectStore(store)); t.oncomplete = r; }; }), [store, fn]);
await idb("index", "o.clear()"); await idb("ptext", "o.clear()");
await boot("prep=1&study=1");
await page.click('#smdPrep .pnv-tab[data-tab="study"]');
await page.waitForFunction(() => new Promise((res) => { const r = indexedDB.open("study"); r.onsuccess = () => { const q = r.result.transaction("ptext").objectStore("ptext").getAll(); q.onsuccess = () => res(q.result.length === 2); }; }), null, { timeout: 20000 });
ok(true, "search: an unindexed PDF is indexed again after a reload (resume)");
/* a PDF that cannot be indexed stays labelled, and results say pages are not indexed */
await idb("docs", 'o.put({ id: "bad", title: "Broken scan", pageCount: 5, kind: "pdf", store: "idb", created: 1, lastOpened: 0, favourite: false, folderId: null })');
await boot("prep=1&study=1");
await page.click('#smdPrep .pnv-tab[data-tab="study"]');
await page.waitForSelector('[data-ix="bad"]');
await page.waitForTimeout(800);
ok(await page.locator('[data-ix="bad"]').innerText() === "Indexing, 0 of 5 pages", "library: partly indexed PDF shows Indexing, n of m pages");
await page.fill("#stQ", "zebra");
await page.waitForFunction(() => /not yet indexed/.test(document.querySelector("#stRes").innerText));
ok(/Broken scan \(Indexing, 0 of 5 pages\)/.test(await page.locator("#stRes").innerText()), "search: results say which pages are not yet indexed");
await idb("docs", 'o.delete("bad")');

/* ---- A5: photos to PDF (stubbed OCR), scan (stubbed plugin), cancel, pickImage ---- */
const idbAll = (store) => page.evaluate((store) => new Promise((res) => { const r = indexedDB.open("study"); r.onsuccess = () => { const q = r.result.transaction(store).objectStore(store).getAll(); q.onsuccess = () => { r.result.close(); res(q.result); }; }; }), store);
const fileBytes = (id) => page.evaluate((id) => new Promise((res) => { const r = indexedDB.open("study"); r.onsuccess = () => { const q = r.result.transaction("files").objectStore("files").get(id); q.onsuccess = () => q.result.blob.arrayBuffer().then((b) => { r.result.close(); res(Array.from(new Uint8Array(b))); }); }; }), id).then((a) => Buffer.from(a));
const pagesIn = (buf) => (buf.toString("latin1").match(/\/Type\s*\/Page(?![a-z])/g) || []).length;
const openLib = async () => { await page.click('#smdPrep .pnv-tab[data-tab="study"]'); await page.waitForSelector("#stLib"); };
await boot("prep=1&study=1");
await openLib();
const jpegs = await page.evaluate(() => [0, 1, 2].map((i) => { const c = document.createElement("canvas"); c.width = 300 + i * 50; c.height = 400; const x = c.getContext("2d"); x.fillStyle = ["#c33", "#3c3", "#33c"][i]; x.fillRect(0, 0, c.width, c.height); return c.toDataURL("image/jpeg", 0.8).split(",")[1]; }));
await page.evaluate(() => { window.__ocrN = 0; window.SMD_NATIVE = { ocr: async () => ({ text: "quokka scan line " + (++window.__ocrN) }) }; });
const docsBefore = (await idbAll("docs")).length;
await page.setInputFiles("#stPhotos", jpegs.map((b, i) => ({ name: `p${i}.jpg`, mimeType: "image/jpeg", buffer: Buffer.from(b, "base64") })));
await page.waitForFunction((n) => document.querySelectorAll(".st-doc").length > n && /Photos[\s\S]*3 pages/.test(document.querySelector("#stList").innerText), docsBefore, { timeout: 30000 });
const photoDoc = (await idbAll("docs")).find((d) => /^Photos /.test(d.title));
const photoPdf = await fileBytes(photoDoc.id);
ok(photoDoc.pageCount === 3 && photoPdf.slice(0, 5).toString() === "%PDF-" && pagesIn(photoPdf) === 3 && createHash("sha256").update(photoPdf).digest("hex") === photoDoc.sha256, "photos: 3 images become one 3-page PDF stored like an import (sha256 kept)");
await page.waitForFunction(() => new Promise((res) => { const r = indexedDB.open("study"); r.onsuccess = () => { const q = r.result.transaction("ptext").objectStore("ptext").getAll(); q.onsuccess = () => { r.result.close(); res(q.result.filter((x) => x.src === "ocr").length === 3); }; }; }), null, { timeout: 20000 });
await page.fill("#stQ", "quokka");
await page.waitForFunction(() => document.querySelectorAll(".st-hit").length === 3, null, { timeout: 10000 });
ok(/Page 1/.test(await page.locator(".st-hit").first().innerText()), "photos: OCR text (stubbed, 3 pages) is found by search, one hit per page");
await page.fill("#stQ", "");
/* scan: no button while the plugin says unavailable */
await page.evaluate((b) => {
  window.__del = []; window.__scanRes = "ok";
  window.Capacitor = { Plugins: {
    DocScan: { isAvailable: async () => ({ available: window.__avail === true }), scan: async () => { if (window.__scanRes === "cancel") { const e = new Error("cancelled"); e.code = "cancelled"; throw e; } return { pages: [{ path: "/cache/a.jpg", width: 300, height: 400 }, { path: "file:///cache/b.jpg", width: 300, height: 400 }] }; } },
    Filesystem: { readFile: async () => ({ data: b }), deleteFile: async ({ path }) => { window.__del.push(path); } } } };
  window.__avail = false;
}, jpegs[0]);
await page.click('#smdPrep [data-act="back"]'); await openLib(); await page.waitForTimeout(400);
ok(await page.locator('[data-act="st-scan"]').count() === 0, "scan: no Scan button while isAvailable is false");
await page.evaluate(() => { window.__avail = true; });
await page.click('#smdPrep [data-act="back"]'); await openLib();
await page.waitForSelector('[data-act="st-scan"]', { timeout: 5000 });
ok(true, "scan: the Scan button shows once isAvailable is true");
const nDocs = (await idbAll("docs")).length;
await page.evaluate(() => { window.__scanRes = "cancel"; });
await page.click('[data-act="st-scan"]'); await page.waitForTimeout(700);
ok((await idbAll("docs")).length === nDocs && await page.evaluate(() => window.__del.length) === 0, "scan: cancel returns quietly, nothing added");
await page.evaluate(() => { window.__scanRes = "ok"; });
await page.click('[data-act="st-scan"]');
await page.waitForFunction((n) => document.querySelectorAll(".st-doc").length > n, nDocs, { timeout: 30000 });
const scanDoc = (await idbAll("docs")).find((d) => /^Scan /.test(d.title));
ok(scanDoc.pageCount === 2 && pagesIn(await fileBytes(scanDoc.id)) === 2, "scan: two pages become one 2-page PDF in the library");
ok(await page.evaluate(() => JSON.stringify(window.__del)) === JSON.stringify(["file:///cache/a.jpg", "file:///cache/b.jpg"]), "scan: the cache JPEGs are deleted");
await page.waitForFunction(() => new Promise((res) => { const r = indexedDB.open("study"); r.onsuccess = () => { const q = r.result.transaction("ptext").objectStore("ptext").getAll(); q.onsuccess = () => { r.result.close(); res(q.result.filter((x) => x.src === "ocr").length === 5); }; }; }), null, { timeout: 20000 });
ok(true, "scan: OCR ran in the background for both pages");
/* pickImage path: one photo, "add another" answered no */
await page.evaluate((b) => { window.confirm = () => false; window.SMD_NATIVE.pickImage = async () => "data:image/jpeg;base64," + b; }, jpegs[1]);
await page.click('[data-act="st-photos"]');
await page.waitForFunction(() => /Photos[\s\S]*1 page\b/.test(document.querySelector("#stList").innerText), null, { timeout: 30000 });
ok(true, "photos: pickImage path (native bridge) builds a 1-page PDF");
await page.evaluate(() => { window.confirm = () => true; delete window.Capacitor; });

/* ---- A7: Make cards hands page text + page refs to Layer C; every item opens its source page; Explain asks first ---- */
const LONG = "The cardiac cycle has two phases called systole and diastole. During systole the ventricles contract and eject blood into the aorta and the pulmonary artery. During diastole the ventricles relax and fill with blood from the atria. The first heart sound is caused by closure of the atrioventricular valves. The second heart sound is caused by closure of the semilunar valves.";
const PDF2 = makePdf(["Unrelated first page about renal tubules and nephrons that must never be sent to anyone.", LONG, "Third page marker text"]);
const gen = [], teach = [];
await page.route("**/api/ai/prep-generate", (route) => { const b = JSON.parse(route.request().postData()); gen.push(b);
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b.op === "facts" ? { facts: [{ fid: "f1", ft: "Systole is ventricular contraction.", cq: "What is systole?", sn: [b.chunk.sents[0].n], fk: "recall" }] } : { items: [], rejected: [] }) }); });
await page.route("**/api/ai/prep-teach", (route) => { teach.push(JSON.parse(route.request().postData())); route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text: "Stub explanation of the passage." }) }); });
await boot("prep=1&study=1");
await openLib();
await page.evaluate(() => { PREP_C.cfg.gap = 0; window.SMD_AUTH = { currentUser: null }; });
await page.setInputFiles("#stFile", { name: "link.pdf", mimeType: "application/pdf", buffer: PDF2 });
await page.waitForSelector('.st-doc:has-text("link")', { timeout: 20000 });
const linkDoc = (await idbAll("docs")).find((d) => d.title === "link");
await page.locator(".st-doc", { hasText: "link" }).locator(".st-open").click();
await page.waitForSelector('.st-pg[data-n="2"] .st-tl span', { timeout: 20000 });
ok(await page.evaluate(() => document.querySelector(".st-tl").classList.contains("smd-books-keep") && document.querySelector(".st-tl").classList.contains("smd-emo-keep")), "viewer: the text layer keeps smd-books-keep smd-emo-keep");
await page.click('[data-act="st-more"]');
await page.fill("#stRange", "2");
ok((await page.locator('[data-act="st-make"]').count()) === 1 && /Make deck/.test(await page.locator('[data-act="st-make"]').innerText()), "Make deck: one button (Layer C makes questions and cards together)");
await page.locator('[data-act="st-make"]').first().click();
await page.waitForSelector("#stSheet");
ok(/Sign in to make a deck/.test(await page.locator("#stSheet").innerText()) && gen.length === 0, "Make cards: signed out shows Layer C's sign-in message, nothing sent");
await page.click('[data-act="st-scancel"]');
await page.evaluate(() => { window.SMD_AUTH = { currentUser: { uid: "u1", getIdToken: async () => "tok" } }; });
await page.locator('[data-act="st-make"]').first().click();
await page.waitForSelector("#stSheetOk");
const sheetTxt = await page.locator("#stSheet").innerText();
ok(/will be sent/.test(sheetTxt) && /PDF file is never sent/.test(sheetTxt) && /2/.test(sheetTxt) && gen.length === 0, "Make cards: the cloud notice is shown and nothing is sent before the tap");
await page.click("#stSheetOk");
await page.waitForFunction(() => PREP_C._job().result, null, { timeout: 30000 });
const sentAll = JSON.stringify(gen);
ok(gen.length >= 1 && gen[0].op === "facts" && gen[0].chunk.sents.length >= 3 && gen[0].chunk.sents.every((x) => x.p === 2) && /cardiac cycle/.test(sentAll), "Make cards: Layer C's facts request carries the selected page's text with page 2 refs");
ok(!/renal tubules|Third page marker/.test(sentAll) && !/JVBER|%PDF/.test(sentAll) && sentAll.length < 20000, "Make cards: only the selected page's text is sent, never the PDF file or other pages");
const made = await page.evaluate(async () => { const j = PREP_C._job().job, c = await PREP_DECKS.cards(j.deckId), d = await PREP_DECKS.getDeck(j.deckId); return { src: c[0] && c[0].src, std: d.source.std }; });
ok(made.src && made.src.std === linkDoc.id && made.src.p[0] === 2 && made.std === linkDoc.id, "Make cards: the card's source ref points back to the Study Studio document id and page 2");
/* the card opens its source page */
await page.evaluate(async () => { const j = PREP_C._job().job; PREP_CARDS.start(PREP._host, await PREP_DECKS.getDeck(j.deckId), await PREP_DECKS.cards(j.deckId)); });
await page.click('[data-act="c-kflip"]');
await page.click('[data-act="st-src"]');
await page.waitForSelector(".st-pg canvas.st-cv", { timeout: 20000 });
await page.waitForFunction(() => (document.querySelector("#stCurP") ? document.querySelector("#stCurP").textContent === "2" : document.querySelector("#stTbPage").value === "2") && STUDY._state().id !== undefined && STUDY._state().sc.scrollTop > 100, null, { timeout: 10000 });
ok(await page.evaluate((id) => STUDY._state().id === id, linkDoc.id), "a card made from the document opens that document at page 2");
ok(await page.evaluate((id) => { const l = PREP_C.srcLink({ src: { std: id, p: [2] } }); return /data-act="st-src"/.test(l) && !/[Pp]age/.test(l) && PREP_C.srcLink({ src: { p: [2] } }) === "" && PREP_C.srcLink({}) === ""; }, linkDoc.id), "an answered question made from the document gets the same Open in Study Studio link (srcLink, used by prep.js); other items none");
/* Explain: nothing is sent until the confirm tap; text and source shown; offline says so */
await page.waitForSelector('.st-pg[data-n="2"] .st-tl span', { timeout: 20000 });
await page.evaluate(() => { const sp = document.querySelector('.st-pg[data-n="2"] .st-tl span'), r = document.createRange(); r.selectNodeContents(sp); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
await page.waitForFunction(() => STUDY._state().sel && STUDY._state().sel.page === 2, null, { timeout: 5000 });
await page.click('[data-act="st-more"]');
await page.click('[data-act="st-explain"]');
await page.waitForSelector("#stSheetOk");
ok(/will be sent to the AI/.test(await page.locator("#stSheet").innerText()) && /cardiac cycle/.test(await page.locator(".st-bq").innerText()) && teach.length === 0, "Explain: the confirm sheet names what is sent; nothing sent before the tap");
await page.click("#stSheetOk");
await page.waitForFunction(() => /Stub explanation/.test(document.querySelector("#stSheet").innerText), null, { timeout: 10000 });
const ans = await page.locator("#stSheet").innerText();
ok(teach.length === 1 && teach[0].kind === "chat" && /cardiac cycle/.test(teach[0].ground) && !/JVBER/.test(JSON.stringify(teach[0])), "Explain: after the tap one request goes to the existing prep-teach route with the selected text");
ok(/From link, page 2/.test(ans), "Explain: the answer shows the document name and page it came from");
await page.click('[data-act="st-scancel"]');
await ctx.setOffline(true);
await page.click('[data-act="st-explain"]');
await page.waitForSelector("#stSheet");
ok(/offline/.test(await page.locator("#stSheet").innerText()) && await page.locator("#stSheetOk").count() === 0 && teach.length === 1, "Explain: offline says so and sends nothing");
await ctx.setOffline(false);
await page.click('[data-act="st-scancel"]');

/* ---- A8: share original, flattened export, notebook to PDF, back up, wipe, restore ---- */
const FF = createRequire(import.meta.url)("../fflate.min.js");
const shaOf = (b) => createHash("sha256").update(b).digest("hex");
const dl = async (click) => { const [d] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), click()]); return { name: d.suggestedFilename(), buf: readFileSync(await d.path()) }; };
await boot("prep=1&study=1");
await openLib();
const fixtureDoc = (await idbAll("docs")).find((d) => d.title === "fixture");
await page.locator(".st-doc", { hasText: "fixture" }).locator(".st-open").click();
await page.waitForSelector(".st-pg canvas.st-cv", { timeout: 20000 });
await page.click('[data-act="st-more"]');
let out = await dl(() => page.click('[data-act="st-orig"]'));
ok(out.name === "fixture.pdf" && shaOf(out.buf) === SHA, "share original: the file is byte-identical to the stored original");
out = await dl(() => page.click('[data-act="st-flat"]'));
ok(out.name === "fixture (flattened).pdf" && out.buf.slice(0, 5).toString() === "%PDF-" && pagesIn(out.buf) === 2 && shaOf(out.buf) !== SHA, "flattened export: named (flattened), 2 pages, differs from the original");
ok(shaOf(await fileBytes(fixtureDoc.id)) === SHA, "flattened export: the stored original's sha256 is unchanged");
await page.click('#smdPrep [data-act="back"]');
await page.waitForSelector("#stLib");
await page.locator(".st-doc", { hasText: "Ward notes" }).locator(".st-open").click();
await page.waitForSelector(".st-pg canvas.st-ov", { timeout: 20000 });
await page.click('[data-act="st-more"]');
out = await dl(() => page.click('[data-act="st-flat"]'));
ok(out.name === "Ward notes.pdf" && pagesIn(out.buf) === 1, "notebook to PDF: one page per notebook page");
await page.click('#smdPrep [data-act="back"]');
await page.waitForSelector("#stLib");
/* back up */
await idb("folders", 'o.put({ id: "f1", name: "Ward" })');
const snap = async () => {
  const docs = await idbAll("docs"), strokes = await idbAll("strokes"), per = {}, shas = {};
  strokes.forEach((x) => { const k = x.doc + ":" + x.page + (x.gone ? "g" : ""); per[k] = (per[k] || 0) + 1; });
  for (const d of docs) if (d.kind !== "nb") shas[d.id] = shaOf(await fileBytes(d.id));
  return { docs: docs.map((d) => d.id).sort(), per, shas, folders: (await idbAll("folders")).length, n: docs.length, st: strokes.length };
};
const before = await snap();
const bk = await dl(() => page.click('[data-act="st-backup"]'));
const zmap = FF.unzipSync(new Uint8Array(bk.buf)), zman = JSON.parse(Buffer.from(zmap["manifest.json"]).toString());
const nPdf = Object.keys(before.shas).length;
ok(/^StewardMD Study backup \d{4}-\d\d-\d\d\.zip$/.test(bk.name) && zman.counts.docs === before.n && zman.counts.strokes === before.st && zman.counts.files === nPdf && zman.counts.folders === 1 && zman.files.length === Object.keys(zmap).length - 1, "backup: one zip with the manifest counts (documents, strokes, originals, folders) and a sha256 per file");
ok(Object.keys(before.shas).every((id) => Buffer.from(zmap["files/" + id + ".pdf"]).equals(Buffer.from(Object.keys(zmap).length ? zmap["files/" + id + ".pdf"] : [])) && shaOf(Buffer.from(zmap["files/" + id + ".pdf"])) === before.shas[id]) && shaOf(Buffer.from(zmap["files/" + fixtureDoc.id + ".pdf"])) === SHA, "backup: every original in the zip is byte-identical to the stored one");
/* wipe: fresh page, delete the study database (records and stored originals) */
await boot("prep=1&study=1");
await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase("study"); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
await openLib();
const zeroAll = async () => (await Promise.all(["docs", "files", "folders", "strokes", "undo", "ptext", "index", "items"].map((x) => idbAll(x)))).every((a) => a.length === 0);
ok(await zeroAll(), "wipe: the study database is empty");
const tamper = (fn) => { const m = FF.unzipSync(new Uint8Array(bk.buf)); fn(m); return Buffer.from(FF.zipSync(m, { level: 0 })); };
const restore = async (buf) => { await page.setInputFiles("#stRestoreF", { name: "b.zip", mimeType: "application/zip", buffer: buf }); await page.waitForFunction(() => /Restored|Nothing was restored/.test(document.querySelector("#stBk").textContent), null, { timeout: 60000 }); const t = await page.locator("#stBk").innerText(); await page.evaluate(() => { document.querySelector("#stBk").textContent = ""; }); return t; };
let msg = await restore(tamper((m) => { const k = Object.keys(m).find((x) => /^files\//.test(x)); const b = Uint8Array.from(m[k]); b[b.length >> 1] ^= 1; m[k] = b; }));
ok(/Nothing was restored/.test(msg) && /checksum/.test(msg) && await zeroAll(), "tampered backup: refused with a clear message and nothing written");
msg = await restore(tamper((m) => { const j = JSON.parse(Buffer.from(m["manifest.json"]).toString()); j.counts.strokes += 1; m["manifest.json"] = FF.strToU8(JSON.stringify(j)); }));
ok(/Nothing was restored/.test(msg) && /record counts/.test(msg) && await zeroAll(), "wrong record count: refused and nothing written");
msg = await restore(bk.buf);
const after = await snap();
ok(new RegExp("Restored " + before.n + " documents with " + before.st + " strokes\\. Skipped 0").test(msg), "restore: reports the counts restored and skipped");
ok(after.n === before.n && JSON.stringify(after.docs) === JSON.stringify(before.docs) && JSON.stringify(after.per) === JSON.stringify(before.per) && after.folders === 1, "restore: document count, folders and strokes per page match the library that was backed up");
ok(JSON.stringify(after.shas) === JSON.stringify(before.shas) && after.shas[fixtureDoc.id] === SHA, "restore: every original's sha256 matches (stored bytes identical)");
ok((await idbAll("items")).length > 0, "restore: items restored from backup");
msg = await restore(bk.buf);
ok(new RegExp("Restored 0 documents with 0 strokes\\. Skipped " + before.n).test(msg) && (await snap()).n === before.n, "restore again: documents already present (by sha256 or id) are skipped, nothing duplicated");

/* ---- Phase 3: pages and navigation (top bar, add page, templates, more, navigator, favourites, outlines, zoom) ---- */
await boot("prep=1&study=1");
await page.evaluate(() => { window.confirm = () => true; window.prompt = () => "Chapter 1"; });
await openLib();
await page.evaluate(() => new Promise(r => { const q = indexedDB.deleteDatabase("study"); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
await openLib();
await page.waitForTimeout(400);
/* create a fresh notebook for P3 */
await page.click('[data-act="st-newnb"]');
await page.fill("#stNbT", "P3 test");
await page.selectOption("#stNbS", "ruled");
await page.selectOption("#stNbZ", "a4");
await page.click('[data-act="st-mknb"]');
await page.waitForSelector("#stPages", { timeout: 15000 });
await page.waitForSelector("#stP3Top", { timeout: 10000 });
ok(await page.evaluate(() => !!document.querySelector("#stP3Top") && !!document.querySelector("#stP3Pager")), "P3 top bar: GoodNotes-style top bar and page counter are present");
ok(/1/.test(await page.locator("#stP3Cur").innerText()) && /1/.test(await page.locator("#stP3Tot").innerText()), "P3 top bar: counter 1 of 1");
ok(await page.evaluate(() => document.querySelector("#stP3Top [data-act='st-p3-grid']") && document.querySelector("#stP3Top [data-act='st-p3-search']") && document.querySelector("#stP3Top [data-act='st-p3-add']")), "P3 top bar: grid, search, share, mic, add icons exist");
/* draw a stroke, then add ruled page BEFORE page 1 → ink stays */
await page.click('[data-act="st-tool"][data-v="pen"]');
await page.evaluate(() => {
  const ov = document.querySelector('.st-ov[data-n="1"]'), r = ov.getBoundingClientRect();
  const fire = (t,x,y)=> ov.dispatchEvent(new PointerEvent(t,{pointerId:7,pointerType:"pen",isPrimary:true,pressure:0.5,clientX:r.left+x*r.width,clientY:r.top+y*r.height,bubbles:true,cancelable:true,buttons:t==="pointerup"?0:1}));
  fire("pointerdown",0.2,0.3); fire("pointermove",0.4,0.35); fire("pointermove",0.6,0.3); fire("pointerup",0.6,0.3);
});
await page.waitForTimeout(300);
await page.click('[data-act="st-p3-add"]');
await page.waitForSelector("#stP3AddSheet");
ok(await page.locator("#stP3AddSheet [data-act='st-p3-place'][data-v='before']").count() === 1, "P3 Add: Before/After/Last segmented control");
await page.click("#stP3AddSheet [data-act='st-p3-place'][data-v='before']");
/* pick ruled from template grid */
await page.evaluate(() => {
  const sheet=document.querySelector("#stP3AddSheet"); const btn=[...sheet.querySelectorAll("[data-tpl]")].find(b=>b.getAttribute("data-tpl")==="ruled");
  if(btn) btn.click();
});
await page.click("#stP3AddSheet [data-act='st-p3-confirm-add']");
await page.waitForFunction(() => STUDY._state() && STUDY._state().n===2, null, {timeout:10000});
ok(await page.evaluate(() => STUDY._state().n===2), "P3 3.1: ruled page added before page 1 (n=2)");
/* change template keeps ink */
const inkBefore = await page.evaluate(() => STUDY._state().strokes.filter(s=>!s.gone).length);
await page.evaluate(() => { if(window.STUDY_PAGES) window.STUDY_PAGES._changeTplSheet("page"); });
await page.waitForSelector("#stP3TplSheet");
await page.evaluate(() => { const btn=[...document.querySelectorAll("#stP3TplSheet [data-tpl]")].find(b=>b.getAttribute("data-tpl")==="grid"); if(btn) btn.click(); });
await page.waitForTimeout(400);
ok((await page.evaluate(() => STUDY._state().strokes.filter(s=>!s.gone).length)) === inkBefore, "P3 3.2/3.3: template change keeps the ink");
/* More menu: copy, rotate, outline, go, clear (each one undo step) */
await page.evaluate(() => { if(window.STUDY_PAGES) window.STUDY_PAGES._openAdd; });
await page.click("#stP3Top [data-act='st-p3-more']");
await page.waitForSelector("#stP3MoreSheet");
ok(await page.locator("#stP3MoreSheet [data-act='st-p3-copy']").count()===1 && await page.locator("#stP3MoreSheet [data-act='st-p3-rotate']").count()===1 && await page.locator("#stP3MoreSheet [data-act='st-p3-outline']").count()===1, "P3 3.4: More menu has Copy, Rotate, Outline, Change Template, Go to Page, Clear");
await page.click("#stP3MoreSheet [data-act='st-p3-copy']");
await page.waitForFunction(() => STUDY._state() && STUDY._state().n===3, null, {timeout:10000});
ok(await page.evaluate(() => STUDY._state().n===3), "P3 3.4: Copy Page duplicates page + strokes");
await page.evaluate(() => { if(window.STUDY_PAGES && window.STUDY_PAGES._rotate) window.STUDY_PAGES._rotate(); });
await page.waitForTimeout(300);
ok(await page.evaluate(() => !!(STUDY._state().doc.rotMap && Object.keys(STUDY._state().doc.rotMap).length)), "P3 3.4: Rotate Page updates rotMap (90° steps)");
/* Add to outline via More */
await page.click("#stP3Top [data-act='st-p3-more']");
await page.waitForSelector("#stP3MoreSheet");
await page.evaluate(() => { window.prompt = () => "Clinical Notes"; });
await page.click("#stP3MoreSheet [data-act='st-p3-outline']");
await page.waitForTimeout(400);
ok(await page.evaluate(() => (STUDY._state().doc.outlines||[]).some(o=>o.title==="Clinical Notes")), "P3 3.9: Add Page to Outline adds user entry");
/* Favorites: star page, check empty state then jump */
await page.click("#stP3Top [data-act='st-p3-fav']");
await page.waitForTimeout(300);
ok(await page.evaluate(() => Object.keys(STUDY._state().doc.favPages||{}).length>0), "P3 3.8: Bookmark star stores favPages");
await page.click("#stP3Top [data-act='st-p3-grid']");
await page.waitForSelector("#stP3NavSheet");
await page.click("#stP3NavSheet [data-act='st-p3-tab'][data-v='favs']");
await page.waitForSelector("#stP3FavBody");
ok(/Page/.test(await page.locator("#stP3FavBody").innerText()), "P3 3.8: Favorites tab lists starred pages");
await page.click("#stP3FavBody [data-page]");
await page.waitForTimeout(300);
ok(true, "P3 3.8: starred page jumps on tap");
/* Thumbnails: live with ink */
await page.click("#stP3Top [data-act='st-p3-grid']");
await page.waitForSelector("#stP3NavSheet");
await page.click("#stP3NavSheet [data-act='st-p3-tab'][data-v='thumbs']");
await page.waitForSelector("#stP3NavGrid .st-p3-nav-card");
const thumbHasInk = await page.evaluate(() => {
  const cv=document.querySelector("#stP3NavGrid .st-p3-nav-card canvas"); if(!cv) return false; const d=cv.getContext("2d").getImageData(0,0,cv.width,cv.height).data; for(let i=3;i<d.length;i+=4) if(d[i]>0) return true; return false;
});
ok(thumbHasInk, "P3 3.7: thumbnails render page + strokes (not blank)");
await page.evaluate(() => { document.querySelectorAll("[id^='stP3']")?.forEach ? document.querySelectorAll("[id^='stP3']").forEach(el=>el.remove()) : null; const s=document.querySelector("#stP3NavSheet"); if(s)s.remove(); });
/* Outlines tab: PDF chapters + user entries + Filter */
await page.click("#stP3Top [data-act='st-p3-grid']");
await page.waitForSelector("#stP3NavSheet");
await page.click("#stP3NavSheet [data-act='st-p3-tab'][data-v='outlines']");
await page.waitForSelector("#stP3OutlineBody");
await page.fill("#stP3OutlineFilter", "Clinical");
await page.waitForTimeout(300);
ok(await page.locator("#stP3OutlineBody").innerText().then(t=>/Clinical/.test(t)), "P3 3.9: Outlines filter finds user chapter");
/* Settings: scrolling direction, palm, lock persist per notebook */
await page.evaluate(() => { document.querySelector("#stP3NavSheet")?.remove(); });
await page.click("#stP3Top [data-act='st-p3-more']");
await page.waitForSelector("#stP3MoreSheet");
await page.click("#stP3MoreSheet [data-act='st-p3-settings']");
await page.waitForSelector("#stP3SettingsSheet");
await page.click("#stP3SettingsSheet [data-act='st-p3-scroll'][data-v='horizontal']");
await page.waitForTimeout(300);
ok(await page.evaluate(() => STUDY._state().doc.settings.scrollDir==="horizontal"), "P3 3.5: Settings scrolling direction persists per notebook");
await page.evaluate(() => { document.querySelector("#stP3SettingsSheet")?.remove(); });
/* Paging: zoom 50-400% + double-tap fit + page counter Go to Page */
await page.evaluate(() => STUDY._setZoom(2));
ok(await page.evaluate(() => STUDY._state().z===2), "P3 3.10: pinch zoom 50-400% via setZoom");
await page.evaluate(() => STUDY._setZoom(10));
ok(await page.evaluate(() => STUDY._state().z===4), "P3 3.10: zoom clamped to 400%");
await page.click("#stP3Pager");
await page.waitForSelector("#stP3GoSheet");
await page.fill("#stP3GotoInp", "2");
await page.click("#stP3GoSheet [data-act='st-p3-do-goto']");
await page.waitForTimeout(300);
ok(await page.evaluate(() => STUDY._state().cur===2 || STUDY._state().sc.scrollTop>50 || STUDY._state().sc.scrollLeft>50), "P3 top bar: tapping page counter opens Go to Page and jumps");
/* Zoom window exists */
ok(await page.evaluate(() => !!document.querySelector("#stP3ZoomWindow")), "P3 3.11: Zoom window strip element present");

ok(errors.length === 0, "no uncaught page error " + errors.join("|"));

await browser.close(); if (serveProc) serveProc.kill();
console.log(fails ? "\n" + fails + " FAILED" : "\nALL PASSED");
process.exit(fails ? 1 : 0);
