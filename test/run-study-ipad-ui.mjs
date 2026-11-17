/* Study Studio on an iPad-sized screen with the app's Display zoom on <html> (home.js zoomNowD sets
 * documentElement.style.zoom; iPads get a tablet scale above 1). Owner's recording 2026-11-18 02:32: a finished pen
 * stroke jumped down-right and grew, because the sharp viewport tiles mixed screen px (getBoundingClientRect) with
 * CSS px. What must hold, at zoom 1.25 and at fit width and 2x page zoom:
 *   - the sharp ink tile, if shown, is drawn exactly where the page is (its screen rect sits inside the page's);
 *   - a stroke's saved ink lands under the pen: the tile (or the overlay when no tile) is dark at the points drawn
 *     and clear well away from them;
 *   - a light Apple Pencil (pressure 0.15) draws a stroke at least 2 CSS px wide at fit width (not a hairline).
 * USAGE: node test/run-study-ipad-ui.mjs   (BASE=http://localhost:8998/ for a running server)
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { freePort } from "./free-port.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || await freePort()) + "/").replace(/\/?$/, "/");
const SHOTS = process.env.SHOTS || "";

let serveProc = null;
try { await fetch(BASE); } catch {
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), (BASE.match(/:(\d+)/) || [, "8998"])[1]], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }
}

let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 1024 }, deviceScaleFactor: 2, hasTouch: true });
const page = await ctx.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(e.message));
await page.route("**/api/**", (r) => r.fulfill({ status: 404, body: "{}" }));
await page.addInitScript(() => { window.SMD_PREP_SETUP = false; window.SMD_PREP_ONBOARD = false; window.confirm = () => true; window.prompt = (msg, def) => def || "x"; });

async function boot() {
  await page.goto(BASE + "?prep=1&study=1", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!(window.PREP && window.SMD_showHome), null, { timeout: 30000 });
  await page.evaluate(() => { ["introPoster", "splash", "accountGate", "introOverlay", "smdBootSplash"].forEach((k) => { const e = document.getElementById(k); if (e) e.remove(); }); PREP.open(); });
  await page.waitForSelector("#smdPrep .pn-tile, #smdPrep .pn-row", { timeout: 30000 });
}
await boot();
await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase("study"); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
// The owner's iPad: a Display zoom above 1 on <html> (home.js zoomNowD), on before Study opens, as on the phone.
await page.evaluate(() => { document.documentElement.style.zoom = "1.25"; });
await page.click('#smdPrep .pnv-tab[data-tab="study"]');
await page.waitForSelector("#stLib");
await page.click('[data-act="st5a-new"]');
await page.click('[data-act="st5a-new-notebook"]');
await page.fill("#st5aNbT", "iPad"); await page.selectOption("#st5aNbS", "ruled"); await page.selectOption("#st5aNbZ", "a4");
await page.click('[data-act="st5a-mknb"]');
await page.waitForSelector(".st-pg canvas.st-ov", { timeout: 20000 });
await page.waitForTimeout(400);
ok(await page.evaluate(() => document.documentElement.style.zoom) === "1.25", "html Display zoom is still 1.25 in the notebook");
await page.click('[data-act="st-tool"][data-v="pen"]');

/* Draw a stroke at page-relative points with a pen of the given pressure; return the screen points. */
const draw = (pts, pressure) => page.evaluate(({ pts, pressure }) => {
  const ov = document.querySelector('.st-ov[data-n="1"]'), r = ov.getBoundingClientRect(), id = 31;
  const scr = pts.map(([x, y]) => [r.left + x * r.width, r.top + y * r.height]);
  const fire = (t, [x, y]) => ov.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: "pen", isPrimary: true, pressure: t === "pointerup" ? 0 : pressure, clientX: x, clientY: y, bubbles: true, cancelable: true, buttons: t === "pointerup" ? 0 : 1 }));
  fire("pointerdown", scr[0]); for (let i = 1; i < scr.length; i++) fire("pointermove", scr[i]); fire("pointerup", scr[scr.length - 1]);
  return scr;
}, { pts, pressure });

/* Alpha of the visible ink at a screen point: the sharp tile when it is shown there, else the overlay. */
const inkAt = (pts) => page.evaluate((pts) => {
  const p = document.querySelector('.st-ov[data-n="1"]').parentNode, ov = p.querySelector(".st-ov"), t = p.querySelector("canvas.st-tile-ink");
  const tileOn = !!(t && t.style.display !== "none" && t.width);
  const read = (c, x, y) => { const r = c.getBoundingClientRect(), px = Math.floor((x - r.left) * c.width / r.width), py = Math.floor((y - r.top) * c.height / r.height); if (px < 0 || py < 0 || px >= c.width || py >= c.height) return -1; let m = 0; const d = c.getContext("2d").getImageData(Math.max(0, px - 2), Math.max(0, py - 2), 5, 5).data; for (let i = 3; i < d.length; i += 4) m = Math.max(m, d[i]); return m; };
  return { tileOn, a: pts.map(([x, y]) => read(tileOn ? t : ov, x, y)) };
}, pts);

const geom = () => page.evaluate(() => {
  const p = document.querySelector('.st-ov[data-n="1"]').parentNode, t = p.querySelector("canvas.st-tile-ink"), pr = p.getBoundingClientRect();
  if (!t || t.style.display === "none") return { tile: false };
  const tr = t.getBoundingClientRect(), sc = STUDY._state().sc.getBoundingClientRect();
  return { tile: true, inside: tr.left >= pr.left - 1 && tr.top >= pr.top - 1 && tr.right <= pr.right + 1 && tr.bottom <= pr.bottom + 1,
    covers: tr.left <= Math.max(pr.left, sc.left) + 3 && tr.top <= Math.max(pr.top, sc.top) + 3 && tr.right >= Math.min(pr.right, sc.right) - 3 && tr.bottom >= Math.min(pr.bottom, sc.bottom) - 3 };
});

const ZIG = [[0.2, 0.12], [0.26, 0.16], [0.32, 0.12], [0.38, 0.16], [0.44, 0.12]];
let scr = await draw(ZIG, 0.5);
await page.waitForTimeout(500);   // sharp tiles settle (110 ms) and repaint
let g = await geom(), ink = await inkAt(scr);
ok(!g.tile || (g.inside && g.covers), "fit width, html zoom 1.25: the sharp tile sits on the visible part of the page (" + JSON.stringify(g) + ")");
ok(ink.a.every((a) => a > 120), "fit width: saved ink is under the pen at every point (" + (ink.tileOn ? "tile" : "overlay") + " alpha " + ink.a.join(",") + ")");
const off = await inkAt(scr.map(([x, y]) => [x + 60, y + 70]));
ok(off.a.every((a) => a < 40), "fit width: no ink 60/70 px away from the stroke (alpha " + off.a.join(",") + ")");
if (SHOTS) await page.screenshot({ path: SHOTS + "/ipad-fit.png" });

/* Light Pencil: typical writing pressure on an Apple Pencil is 0.1 to 0.3. */
const thin = await page.evaluate(() => { const s = STUDY._state().strokes.filter((x) => !x.gone); return s.length; });
const lightPts = [[0.2, 0.3], [0.3, 0.3], [0.4, 0.3], [0.5, 0.3], [0.6, 0.3]];
scr = await draw(lightPts, 0.15);
await page.waitForTimeout(500);
const widthCss = await page.evaluate((mid) => {
  const p = document.querySelector('.st-ov[data-n="1"]').parentNode, t = p.querySelector("canvas.st-tile-ink"), ov = p.querySelector(".st-ov");
  const c = t && t.style.display !== "none" ? t : ov, r = c.getBoundingClientRect(), k = c.width / r.width, z = r.width / c.offsetWidth;
  const px = Math.floor((mid[0] - r.left) * k), py0 = Math.floor((mid[1] - r.top) * k), d = c.getContext("2d").getImageData(px, py0 - 40, 1, 81).data;
  let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 100) n++;
  return n / k * (r.width / c.offsetWidth) / z;   // device rows -> CSS px of the page
}, scr[2]);
ok(thin + 1 === await page.evaluate(() => STUDY._state().strokes.filter((x) => !x.gone).length), "light pencil: stroke saved");
ok(widthCss >= 2, "light pencil (pressure 0.15): stroke is at least 2 CSS px wide at fit width (got " + widthCss.toFixed(2) + ")");

/* 2x page zoom: tile must still sit on the page and the new stroke under the pen. */
await page.evaluate(() => { const v = STUDY._state(); v.sc.scrollTop = 0; v.sc.scrollLeft = 0; });
await page.evaluate(() => STUDY._setZoom ? STUDY._setZoom(2) : null);
const hasSetZoom = await page.evaluate(() => !!STUDY._setZoom);
if (!hasSetZoom) {
  await page.click('#stP3Top [data-act="st-p3-more"]').catch(() => {}); await page.click('[data-act="st-more"]').catch(() => {});
  for (let i = 0; i < 4; i++) await page.click('[data-act="st-zoom"][data-v="+"]').catch(() => {});
  await page.click('[data-act="st-close-more"]').catch(() => {});
}
await page.waitForTimeout(700);
const z = await page.evaluate(() => STUDY._state().z);
ok(z >= 1.9, "page zoom is about 2x (" + z + ")");
await page.evaluate(() => { const v = STUDY._state(); v.sc.scrollTop = 0; v.sc.scrollLeft = 0; });
await page.waitForTimeout(500);
const Z2 = [[0.1, 0.05], [0.13, 0.07], [0.16, 0.05], [0.19, 0.07], [0.22, 0.05]];
scr = await draw(Z2, 0.5);
await page.waitForTimeout(600);
g = await geom(); ink = await inkAt(scr);
ok(g.tile && g.inside && g.covers, "2x zoom, html zoom 1.25: the sharp tile is shown and sits on the visible part of the page (" + JSON.stringify(g) + ")");
ok(ink.a.every((a) => a > 120), "2x zoom: saved ink is under the pen at every point (" + (ink.tileOn ? "tile" : "overlay") + " alpha " + ink.a.join(",") + ")");
if (SHOTS) await page.screenshot({ path: SHOTS + "/ipad-2x.png" });

/* ---- Zoom window: write in the strip, the ink lands inside the box on the page ---- */
await page.evaluate(() => STUDY._setZoom(1));
await page.waitForTimeout(500);
await page.evaluate(() => { const v = STUDY._state(); v.sc.scrollTop = 0; });
await page.click('[data-act="st-zoom-window"]');
await page.waitForTimeout(400);
const zw0 = await page.evaluate(() => { const v = STUDY._state(), box = document.querySelector(".st-pg .st-zw-box"); return { zw: v.zw, box: !!box, open: !document.getElementById("stP3ZoomWindow").hidden }; });
ok(zw0.open && zw0.box && zw0.zw && zw0.zw.w > 0.1, "zoom window: opens with a box on the page (" + JSON.stringify(zw0.zw) + ")");
const before = await page.evaluate(() => STUDY._state().strokes.filter((s) => !s.gone).length);
const stripStroke = (fx0, fx1) => page.evaluate(([fx0, fx1]) => {
  const cv = document.getElementById("stP3ZoomCv"), r = cv.getBoundingClientRect(), id = 55;
  const f = (t, fx, fy) => cv.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: "pen", isPrimary: true, pressure: t === "pointerup" ? 0 : 0.25, clientX: r.left + fx * r.width, clientY: r.top + fy * r.height, bubbles: true, cancelable: true, buttons: t === "pointerup" ? 0 : 1 }));
  f("pointerdown", fx0, 0.5); for (let i = 1; i <= 8; i++) f("pointermove", fx0 + (fx1 - fx0) * i / 8, 0.5 + (i % 2 ? 0.15 : -0.15)); f("pointerup", fx1, 0.5);
}, [fx0, fx1]);
await stripStroke(0.1, 0.4);
await page.waitForTimeout(300);
const zs = await page.evaluate(() => { const v = STUDY._state(), s = v.strokes.filter((x) => !x.gone), last = s[s.length - 1], b = v.zw; return { n: s.length, inBox: last.pts.every((p) => p[0] >= b.x - 0.002 && p[0] <= b.x + b.w + 0.002 && p[1] >= b.y - 0.002 && p[1] <= b.y + b.h + 0.002), zw: b }; });
ok(zs.n === before + 1 && zs.inBox, "zoom window: a stroke written in the strip is saved inside the box on the page");
const stripInk = await page.evaluate(() => { const c = document.getElementById("stP3ZoomCv"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 80 && d[i + 1] < 80 && d[i + 2] < 80) n++; return n; });
ok(stripInk > 200, "zoom window: the strip shows the ink magnified (" + stripInk + " dark px)");
const x0 = zs.zw.x;
await stripStroke(0.6, 0.93);   // pen lifts in the right margin: the box moves on
await page.waitForTimeout(300);
const x1 = await page.evaluate(() => STUDY._state().zw.x);
ok(x1 > x0 + 0.1, "zoom window: lifting the pen in the margin moves the box right (" + x0.toFixed(3) + " -> " + x1.toFixed(3) + ")");
const y0 = await page.evaluate(() => STUDY._state().zw.y);
await page.click('[data-act="st-zw-nl"]');
const nl = await page.evaluate(() => STUDY._state().zw);
ok(nl.x < 0.1 && nl.y > y0, "zoom window: New line goes back to the left margin, one box lower");
if (SHOTS) await page.screenshot({ path: SHOTS + "/ipad-zoomwin.png" });
await page.click('[data-act="st-zoom-close"]');
await page.waitForTimeout(200);
ok(await page.evaluate(() => !document.querySelector(".st-pg .st-zw-box") && document.getElementById("stP3ZoomWindow").hidden), "zoom window: Done closes it and removes the box");

ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
await browser.close();
if (serveProc) serveProc.kill();
console.log(fails ? fails + " FAILED" : "ALL PASSED");
process.exit(fails ? 1 : 0);
