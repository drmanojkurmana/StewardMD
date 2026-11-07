/* test/run-image-report-ui.mjs - headless: tap an image in a disease article, it opens full screen, Report sends a
 * ticket of kind "image"; the Image Library viewer reports the same way; an icon does not open.
 * USAGE: node test/run-image-report-ui.mjs   (static server started here; SHOTS=<dir> for screenshots)
 * The sign-in and /api/support are stubbed in the page: the payload is checked, nothing is sent. */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const require = createRequire(import.meta.url);
let pw; try { pw = require("playwright"); } catch { pw = await import("/opt/node22/lib/node_modules/playwright/index.mjs"); }
const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, "..");
const PORT = 8000 + Math.floor(Math.random() * 900), SHOTS = process.env.SHOTS || "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const srv = spawn(process.execPath, [join(HERE, "serve.mjs"), ROOT, String(PORT)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 900));
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

const b = await pw.chromium.launch({ args: ["--no-sandbox"] });
try {
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(() => {
    window.__sent = [];
    const real = window.fetch;
    window.fetch = function (u, o) {
      if (String(u).indexOf("/api/support") >= 0 && o && o.method === "POST") { window.__sent.push(JSON.parse(o.body)); return Promise.resolve(new Response(JSON.stringify({ ok: true, ticket: { id: "SMD-TEST01" } }), { status: 200 })); }
      return real.apply(this, arguments);
    };
  });
  await p.goto(`http://127.0.0.1:${PORT}/?tour=0`);
  await p.waitForFunction(() => window.DX && DX.openRef && window.SMD_IMGZOOM, null, { timeout: 40000 });
  await p.evaluate(() => { ["introPoster", "splash", "accountGate", "introOverlay", "smdBootSplash", "smdApplock"].forEach((k) => document.getElementById(k)?.remove()); DX.openRef("MENINGITIS", { standalone: true }); });
  await p.waitForSelector("#kbr-patho .kbr-fig img", { timeout: 20000 });
  const img = await p.$("#kbr-patho .kbr-fig img");
  await img.scrollIntoViewIfNeeded(); await p.waitForTimeout(400);
  // StewardMD watermark (variant E, three marks): on the article figure, over the image's own box
  const fw = await p.evaluate(() => { const h = document.querySelector("#kbr-patho .kbr-fig .smd-wm-host"), i = h && h.querySelector("img"), w = h && h.querySelector(".smd-wm");
    if (!w) return null; const a = i.getBoundingClientRect(), b = w.getBoundingClientRect(); return { marks: w.querySelectorAll(".smd-wm-big").length, corner: !!w.querySelector(".smd-wm-by"), dx: Math.abs(a.left - b.left) + Math.abs(a.right - b.right), dy: Math.abs(a.top - b.top) + Math.abs(a.bottom - b.bottom), pe: getComputedStyle(w).pointerEvents }; });
  ok(fw && fw.marks === 1 && fw.corner && fw.dx < 3 && fw.dy < 3 && fw.pe === "none", "article figure carries the watermark (one big mark + Powered by line) on its own box " + JSON.stringify(fw));
  if (SHOTS) { await p.waitForTimeout(300); await p.screenshot({ path: SHOTS + "/figure-wm.png" }); }
  await img.click(); await p.waitForSelector(".pv", { timeout: 8000 }).catch(() => {});
  ok(!!(await p.$(".pv")), "tapping an article image opens the full-screen viewer");
  ok(!!(await p.$('.pv [data-pv="report"]')), "the viewer has a Report button");
  await p.waitForTimeout(500);
  const vw = await p.evaluate(() => { const i = document.querySelector(".pv .pv-img"), w = document.querySelector(".pv .smd-wm--follow"); if (!i || !w) return null;
    const a = i.getBoundingClientRect(), b = w.getBoundingClientRect(); return { d: Math.round(Math.abs(a.left - b.left) + Math.abs(a.top - b.top) + Math.abs(a.width - b.width)), marks: w.querySelectorAll(".smd-wm-big").length }; });
  ok(vw && vw.marks === 1 && vw.d < 4, "the viewer image carries the watermark on the picture " + JSON.stringify(vw));
  await p.click('.pv [data-pv="in"]'); await p.waitForTimeout(450);
  const zw = await p.evaluate(() => { const i = document.querySelector(".pv .pv-img"), w = document.querySelector(".pv .smd-wm--follow"); const a = i.getBoundingClientRect(), b = w.getBoundingClientRect(); return Math.round(Math.abs(a.width - b.width) + Math.abs(a.left - b.left)); });
  ok(zw < 4, "zooming in, the watermark zooms with the image (off by " + zw + " px)");
  await p.click('.pv [data-pv="fit"]'); await p.waitForTimeout(400);
  if (SHOTS) await p.screenshot({ path: SHOTS + "/viewer.png" });
  await p.click('.pv [data-pv="report"]'); await p.waitForSelector(".izr", { timeout: 4000 }).catch(() => {}); await p.waitForTimeout(500);
  ok(!(await p.$(".pv")) && !!(await p.$(".izr")), "Report closes the viewer and opens the report form");
  await p.check('.izr input[value="copyright"]');
  await p.fill("#izrT", "Looks copied from a textbook");
  if (SHOTS) await p.screenshot({ path: SHOTS + "/report.png" });
  // signed in only for the send (signing in at boot brings up the App Lock chooser over everything)
  await p.evaluate(() => Object.defineProperty(window, "SMD_AUTH", { configurable: true, value: { currentUser: { getIdToken: () => Promise.resolve("t") } } }));
  await p.click(".izr-send"); await p.waitForTimeout(500);
  const sent = await p.evaluate(() => window.__sent.slice(-1)[0]);
  ok(sent && sent.action === "image" && sent.image.reason === "copyright", "it sends action image with the reason");
  ok(sent && /\/api\/prep\/bank\/|^https:/.test(sent.image.src), "with the image's address: " + (sent && sent.image.src));
  ok(sent && /Pathophysiology|Pathogenesis/.test(sent.image.title) && /Meningitis/.test(sent.image.where), "with its title and where it was seen: " + (sent && sent.image.title + " / " + sent.image.where));
  ok(/Sent/.test(await p.evaluate(() => (document.querySelector("#izrM") || {}).textContent || "")), "the doctor sees it was sent");

  // An icon is not an image to open.
  await p.waitForTimeout(2000);
  const iconOpened = await p.evaluate(() => { const i = document.createElement("img"); i.className = "x-icon"; i.src = "/icons/icon-192.png"; i.style.cssText = "position:fixed;left:10px;top:200px;width:24px;height:24px;z-index:99999"; document.body.appendChild(i); i.click(); return new Promise((r) => setTimeout(() => r(!!document.querySelector(".pv")), 300)); });
  ok(!iconOpened, "a small icon does not open the viewer");

  // Image Library viewer: Report reaches the same form.
  await p.evaluate(() => { document.querySelector(".izr")?.remove(); window.SMD_IMGLIB.open({ system: "eye" }); });
  await p.waitForSelector(".igl-card", { timeout: 20000 });
  const tw = await p.evaluate(() => [...document.querySelectorAll(".igl-thumb")].slice(0, 40).map((t) => { const im = t.querySelector("img"), w = t.querySelector(".smd-wm"); return { ext: /wikimedia/.test(im.src), w: !!w, marks: w ? w.querySelectorAll(".smd-wm-big").length : 0 }; }));
  ok(tw.length && tw.every((t) => t.w), "every Image Library thumbnail carries the watermark");
  ok(tw.every((t) => (t.ext ? t.marks === 0 : t.marks === 1)), "Commons images get the Powered by line only, ours the big mark too");
  if (SHOTS) await p.screenshot({ path: SHOTS + "/library-wm.png" });
  await p.click(".igl-card"); await p.waitForSelector('[data-igl="vreport"]', { timeout: 5000 }).catch(() => {});
  ok(!!(await p.$('[data-igl="vreport"]')), "the Image Library viewer has Report");
  const barOk = await p.evaluate(() => { const bar = document.querySelector(".igl-vbar"); return bar && bar.scrollWidth <= bar.clientWidth + 1; });
  ok(barOk, "the Image Library viewer bar fits 390 px");
  await p.click('[data-igl="vreport"]');
  ok(!!(await p.$(".izr")), "Image Library Report opens the report form");
  ok(!errs.length, "no uncaught error" + (errs.length ? ": " + errs.slice(0, 2).join(" | ") : ""));
} finally { await b.close(); srv.kill(); }
console.log(fails ? fails + " FAILED" : "ALL PASS");
process.exit(fails ? 1 : 0);
