/* PrepNucleus draws at full size (owner 2026-10-10: "1.0 in PrepNucleus only"). The app's auto fit zooms html to 0.95 on
 * a 340-400 px phone, so a 44 px target drew at ~42 px. While PrepNucleus is open (html.pn-open) home.js zoomNowD takes
 * the shrink off; the rest of the app keeps its own zoom. Runs the REAL app in Playwright Chromium (CHROME= to use Google
 * Chrome) and WebKit, touch + mobile, at 390x844 (3x), 820x1180 and 1180x820 (2x). What must hold:
 *  - outside PrepNucleus the html zoom is the app's auto fit (0.95 / 1.08 / 1.15);
 *  - open: the zoom is max(1, auto fit) (1 / 1.08 / 1.15), the setup sheet and the Ask MaiK sheet open under it;
 *  - every .pn-ib, .pn-btn, .pn-chip, .pn-tab, .pn-opt, .pn-row measures at least 44 screen px tall (icon buttons also
 *    44 wide) on home, a subject, a question and the setup sheet;
 *  - nothing is wider than the window;
 *  - close: the app's zoom comes back and the page behind keeps its scroll;
 *  - a size the user chose (fontScale 1.1, autoFit off) shows PrepNucleus at 1.1 / 0.95.
 * SHOTS=<dir> saves PNGs of home at each size and engine.
 * USAGE: node test/run-prep-scale.mjs   (PLAYWRIGHT_CORE=<path>; CHROME=<chrome binary>; ENGINES=chromium,webkit)
 */
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const FIX = "/test/fixtures/prep/";
const SHOTS = process.env.SHOTS || "";
const ENGINES = (process.env.ENGINES || "chromium,webkit").split(",");

async function loadPW() {
  const tries = [];
  if (process.env.PLAYWRIGHT_CORE) tries.push(process.env.PLAYWRIGHT_CORE);
  tries.push(join(ROOT, "node_modules", "playwright-core"));
  const npx = join(os.homedir(), ".npm", "_npx");
  try { for (const d of fs.readdirSync(npx)) tries.push(join(npx, d, "node_modules", "playwright-core")); } catch {}
  for (const p of tries) {
    if (!fs.existsSync(join(p, "index.mjs"))) continue;
    const pw = await import(pathToFileURL(join(p, "index.mjs")).href);
    try { const exe = pw.webkit.executablePath(); if (exe && fs.existsSync(exe)) return pw; } catch {}
  }
  return null;
}
const pw = await loadPW();
if (!pw) { console.log("SKIP no playwright-core with an installed WebKit (set PLAYWRIGHT_CORE)"); process.exit(0); }

// index.html's CSP upgrades http://localhost in WebKit: serve the repo through a route on an https test origin.
const ORIGIN = "https://prep.test", BASE = ORIGIN + "/";
const TYPES = { ".html": "text/html", ".js": "application/javascript", ".mjs": "application/javascript", ".css": "text/css", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
function serveFile(route) {
  let p = decodeURIComponent(new URL(route.request().url()).pathname);
  if (p.endsWith("/")) p += "index.html";
  const f = join(ROOT, p.replace(/^\/+/, ""));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: "" });
  const ext = (f.match(/\.[a-z0-9]+$/i) || [""])[0].toLowerCase();
  return route.fulfill({ status: 200, contentType: TYPES[ext] || "application/octet-stream", body: fs.readFileSync(f) });
}
function moduleFile() {
  const items = [];
  for (let i = 0; i < 30; i++) items.push({ id: "bp-" + i, q: "Which root forms nerve " + i + "?", o: ["C5", "C6", "C7", "C8"], a: i % 4, exp: "Fixture explanation " + i + ".", t: "ana-brachial-plexus", d: (i % 3) + 1, prov: "LIC" });
  return { topic: "ana-brachial-plexus", items };
}

let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const SIZES = [{ w: 390, h: 844, dpr: 3, auto: 0.95, prep: 1 }, { w: 820, h: 1180, dpr: 2, auto: 1.08, prep: 1.08 }, { w: 1180, h: 820, dpr: 2, auto: 1.15, prep: 1.15 }];

// Screen px: the fixed root spans the window whatever the zoom, so K turns any rect into window px in every engine.
const SMALL = () => {
  const RT = document.getElementById("smdPrep"); if (!RT) return "no root";
  const RR = RT.getBoundingClientRect(), K = innerWidth / RR.width, bad = [];
  RT.querySelectorAll(".pn-ib, .pn-btn, .pn-chip, .pn-tab, .pn-opt, .pn-row").forEach((el) => {
    const b = el.getBoundingClientRect(); if (!b.width && !b.height) return;
    const cs = getComputedStyle(el); if (cs.visibility === "hidden" || cs.display === "none") return;
    const w = b.width * K, h = b.height * K;
    if (h < 43.9 || (el.classList.contains("pn-ib") && w < 43.9)) bad.push((el.getAttribute("data-act") || el.className) + ":" + w.toFixed(1) + "x" + h.toFixed(1));
  });
  return bad.slice(0, 8).join(", ") + (bad.length > 8 ? " +" + (bad.length - 8) : "");
};
const COUNT = () => { const RT = document.getElementById("smdPrep"); return RT ? RT.querySelectorAll(".pn-ib, .pn-btn, .pn-chip, .pn-tab, .pn-opt, .pn-row").length : 0; };
const OVER = () => { const de = document.documentElement, RT = document.getElementById("smdPrep"), b = RT && RT.querySelector(".pn-body"), o = []; if (de.scrollWidth > de.clientWidth + 1) o.push("document"); if (b && b.scrollWidth > b.clientWidth + 1) o.push("body " + b.scrollWidth + ">" + b.clientWidth); return o.join(", "); };
const Z = () => parseFloat(document.documentElement.style.zoom) || 1;
const near = (a, b) => Math.abs(a - b) < 0.002;

for (const engine of ENGINES) {
  let browser;
  try {
    const opts = engine === "chromium" && process.env.CHROME ? { executablePath: process.env.CHROME } : {};
    browser = await pw[engine].launch(opts);
  } catch (e) { ok(false, engine + " launch: " + String(e.message || e).split("\n")[0]); continue; }
  try {
    for (const S of SIZES) {
      const at = " [" + engine + " " + S.w + "x" + S.h + "]";
      const ctx = await browser.newContext({ viewport: { width: S.w, height: S.h }, screen: { width: Math.min(S.w, S.h), height: Math.max(S.w, S.h) }, hasTouch: true, isMobile: true, deviceScaleFactor: S.dpr, serviceWorkers: "block" });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => { if (/prep|PREP|zoom/i.test(String(e && (e.stack || e.message)))) errors.push(String(e.message || e)); });
      await page.route(/^https:\/\/prep\.test\//, serveFile);
      await page.route(/ana-brachial-plexus\.json/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(moduleFile()) }));
      await page.route(/^https:\/\/prep\.test\/api\//, (r) => r.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
      await page.addInitScript(`window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_BASE=${JSON.stringify(FIX)}; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.SMD_PREP_FLAG_API=${JSON.stringify(FIX + "hidden.json")}; window.SMD_PREP_ONBOARD=false; window.confirm=function(){return true};
        try{ localStorage.setItem("smd_prep","1"); }catch(e){}`);
      await page.goto(BASE);
      await page.waitForFunction(() => !!(window.PREP && window.SMD_showHome && document.documentElement.style.zoom), null, { timeout: 30000 });
      await page.evaluate(() => { ["introPoster", "splash", "accountGate", "introOverlay", "smdBootSplash"].forEach((k) => { const e = document.getElementById(k); if (e) e.remove(); }); });
      const ev = (fn, arg) => page.evaluate(fn, arg);
      const until = async (fn, ms = 10000, arg) => { try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } };

      await until((z) => Math.abs((parseFloat(document.documentElement.style.zoom) || 1) - z) < 0.002, 3000, S.auto);
      ok(near(await ev(Z), S.auto), "outside PrepNucleus the zoom is auto fit " + S.auto + " (got " + await ev(Z) + ")" + at);
      // The page behind: scroll it a little and remember where it is.
      const y0 = await ev(() => { const se = document.scrollingElement; se.scrollTop = 120; return se.scrollTop; });

      await ev(() => { window.PREP.open(); });
      ok(await until(() => !!document.querySelector("#smdPrep #pnHome"), 15000), "home paints" + at);
      await sleep(400);
      ok(near(await ev(Z), S.prep), "open: zoom " + S.prep + " (got " + await ev(Z) + ")" + at);
      ok(await ev(COUNT) > 5, "home has targets to measure" + at);
      let s = await ev(SMALL); ok(s === "", "home: every target >= 44 screen px" + (s ? " (" + s + ")" : "") + at);
      let o = await ev(OVER); ok(o === "", "home: nothing wider than the window" + (o ? " (" + o + ")" : "") + at);
      if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await ev(() => { const b = document.querySelector("#smdPrep .pn-body"); if (b) b.scrollTop = 0; }); await sleep(300); await page.screenshot({ path: join(SHOTS, "scale-" + engine + "-" + S.w + ".png") }); }

      // A subject, a question, the setup sheet.
      const sub = await ev(() => { const b = document.querySelector('#smdPrep [data-act="subject"]'); if (!b) return false; b.click(); return true; });
      if (sub) {
        ok(await until(() => !!document.querySelector("#smdPrep .pn-mod, #smdPrep [data-act=module]"), 10000), "subject paints" + at);
        await sleep(300);
        s = await ev(SMALL); ok(s === "", "subject: every target >= 44 screen px" + (s ? " (" + s + ")" : "") + at);
        const mod = await ev(() => { const b = document.querySelector('#smdPrep [data-act="module"]'); if (!b) return false; b.click(); return true; });
        if (mod) {
          await sleep(500);
          const go = await ev(() => { const b = document.querySelector('#smdPrep [data-act="start"][data-k="study"]'); if (!b) return ""; b.click(); return b.getAttribute("data-act"); });
          await sleep(600);
          if (await ev(() => !!document.querySelector("#smdPrep .su-body, #smdPrep .pn-sheet"))) {
            ok(near(await ev(Z), S.prep), "sheet open: zoom still " + S.prep + at);
            s = await ev(SMALL); ok(s === "", "setup sheet: every target >= 44 screen px" + (s ? " (" + s + ")" : "") + at);
            await ev(() => { const b = document.querySelector('#smdPrep [data-act="su-go"]'); if (b) b.click(); });
            await sleep(700);
          }
          if (await ev(() => !!document.querySelector("#smdPrep .pn-opt"))) {
            s = await ev(SMALL); ok(s === "", "question: every target >= 44 screen px" + (s ? " (" + s + ")" : "") + at);
            o = await ev(OVER); ok(o === "", "question: nothing wider than the window" + (o ? " (" + o + ")" : "") + at);
          } else console.log("NOTE no question screen reached (" + go + ")" + at);
        }
      } else console.log("NOTE no subject row" + at);

      await ev(() => { window.PREP.close(); });
      await sleep(200);
      ok(near(await ev(Z), S.auto), "close: zoom back to " + S.auto + " (got " + await ev(Z) + ")" + at);
      ok(!(await ev(() => document.documentElement.classList.contains("pn-open"))), "close: html.pn-open cleared" + at);
      const y1 = await ev(() => document.scrollingElement.scrollTop);
      ok(Math.abs(y1 - y0) <= 1, "close: the page behind keeps its scroll (" + y0 + " -> " + y1 + ")" + at);

      // A size the user chose: PrepNucleus = that size / 0.95.
      if (S.w === 390) {
        await ev(() => { const s = JSON.parse(localStorage.getItem("smd_display_v1") || "{}"); s.autoFit = false; s.userSet = true; s.fontScale = 1.1; s.density = s.density || "default"; localStorage.setItem("smd_display_v1", JSON.stringify(s)); });
        await page.reload();
        await page.waitForFunction(() => !!(window.PREP && document.documentElement.style.zoom), null, { timeout: 30000 });
        await page.evaluate(() => { ["introPoster", "splash", "accountGate", "introOverlay", "smdBootSplash"].forEach((k) => { const e = document.getElementById(k); if (e) e.remove(); }); });
        ok(near(await ev(Z), 1.1), "user size 1.1 outside PrepNucleus (got " + await ev(Z) + ")" + at);
        await ev(() => { window.PREP.open(); });
        await until(() => !!document.querySelector("#smdPrep #pnHome"), 15000);
        ok(near(await ev(Z), 1.1 / 0.95), "user size 1.1: PrepNucleus at 1.1 / 0.95 = " + (1.1 / 0.95).toFixed(4) + " (got " + await ev(Z) + ")" + at);
        await ev(() => { window.PREP.close(); });
        await sleep(200);
        ok(near(await ev(Z), 1.1), "user size 1.1 back after close" + at);
        const pure = await ev(() => !window.SMD_ZOOM ? [] : [window.SMD_ZOOM.prep(0.95, true), window.SMD_ZOOM.prep(0.9, true), window.SMD_ZOOM.prep(1.15, true), window.SMD_ZOOM.prep(0.95, false), window.SMD_ZOOM.prep(2, false)]);
        ok(JSON.stringify(pure) === JSON.stringify([1, 1, 1.15, 1, 2]), "SMD_ZOOM.prep: " + JSON.stringify(pure) + at);
      }
      ok(!errors.length, "no uncaught PrepNucleus error" + (errors.length ? " (" + errors.slice(0, 2).join(" | ") + ")" : "") + at);
      await ctx.close();
    }
  } finally { await browser.close(); }
}
console.log(fails ? "\n" + fails + " FAILED" : "\nALL PASS");
process.exit(fails ? 1 : 0);
