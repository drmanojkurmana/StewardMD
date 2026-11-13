/* Image Library viewer links (owner 2026-11-13): an image from a PrepNucleus lesson opens that lesson at the step that
 * shows it for Pro; without Pro the lesson button asks to subscribe and "Read the article" opens the Knowledge Library
 * article that holds the image, never a bare page titled with a raw id.
 * USAGE: node test/run-imglib-links-ui.mjs  (Playwright; serves the repo on :8995 itself). */
import { spawn, execSync } from "node:child_process";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8995/").replace(/\/?$/, "/");
const require = createRequire(import.meta.url);
let pw; try { pw = require("playwright"); } catch { pw = require(join(execSync("npm root -g").toString().trim(), "playwright")); }
let serve = null;
try { await fetch(BASE); } catch {
  serve = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), (BASE.match(/:(\d+)/) || [, "8995"])[1]], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }
}
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const FILE = "acute-coronary-syndrome-long-case-fig1.webp";

const browser = await pw.chromium.launch();
async function viewerOn(pro) {
  const p = await browser.newPage({ viewport: { width: 393, height: 852 } });
  const errs = []; p.on("pageerror", e => errs.push(e.message));
  await p.goto(BASE, { waitUntil: "load" });
  await p.waitForFunction(() => window.SMD_IMGLIB && window.SMD_KB && window.PREP, null, { timeout: 40000 });
  await sleep(800);
  await p.evaluate(pro => {
    ["introPoster", "splash", "accountGate", "introOverlay", "smdBootSplash", "ghisPanel"].forEach(k => { const n = document.getElementById(k); if (n) n.remove(); });
    window.SMD_PREP_ONBOARD = false;
    window.SMD_PRO = window.SMD_PRO || {};
    SMD_PRO.isProSync = function () { return pro; };
    window.__pay = 0; SMD_PRO.openPaywall = function () { window.__pay++; };
    SMD_IMGLIB.open();
  }, pro);
  await sleep(800);
  await p.evaluate(() => { document.querySelector('.igl-sys[data-v="medicine"]').click(); });
  await p.waitForFunction(() => document.querySelector(".igl-q") && document.querySelector(".igl-card"), null, { timeout: 15000 });
  await p.fill(".igl-q", "Acute Coronary Syndrome Pathophysiology"); await sleep(900);
  const opened = await p.evaluate(file => { const c = [...document.querySelectorAll(".igl-card")].find(x => (x.querySelector("img") || {}).src && x.querySelector("img").src.indexOf(file) >= 0); if (!c) return false; c.click(); return true; }, FILE);
  await sleep(500);
  return { p, errs, opened };
}
try {
  // Without Pro
  let { p, errs, opened } = await viewerOn(false);
  ok(opened, "the ACS image is in the library and opens in the viewer");
  const btn = await p.evaluate(() => [...document.querySelectorAll(".igl-vlinks button")].map(b => b.getAttribute("data-igl") + ":" + b.textContent.trim()));
  if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + "/imglib-viewer-free.png" });
  ok(btn.length === 2 && /vlesson:Open the lesson\s*Pro/.test(btn[0]) && /varticle:Read the article/.test(btn[1]), "without Pro: 'Open the lesson' (Pro) and 'Read the article' " + JSON.stringify(btn));
  await p.click('[data-igl="vlesson"]'); await sleep(300);
  ok(await p.evaluate(() => window.__pay === 1 && !document.getElementById("smdPrep")), "without Pro the lesson button asks to subscribe and opens no lesson");
  await p.click('[data-igl="varticle"]'); await sleep(2500);
  const art = await p.evaluate(() => { const o = document.getElementById("dxOverlay"); return { name: (o && o.querySelector(".dx-mgmt-name") || {}).textContent, secs: o ? o.querySelectorAll(".kbr-chip").length : 0 }; });
  ok(art.name === "Acute Coronary Syndrome Long Case" && art.secs > 2, "'Read the article' opens the real article, not a raw-id page " + JSON.stringify(art));
  ok(errs.length === 0, "no page errors " + JSON.stringify(errs.slice(0, 2)));
  await p.close();

  // With Pro
  ({ p, errs, opened } = await viewerOn(true));
  ok(await p.evaluate(() => !/Pro/.test(document.querySelector('[data-igl="vlesson"]').textContent)), "with Pro the lesson button has no Pro tag");
  await p.click('[data-igl="vlesson"]');
  await p.waitForFunction(() => document.querySelector("#smdPrep .pn-lsn, #smdPrep [class*=lsn]"), null, { timeout: 20000 }).catch(() => {});
  await sleep(1500);
  const les = await p.evaluate(file => { const r = document.getElementById("smdPrep"); return { open: !!r, imgShown: !!(r && [...r.querySelectorAll("img")].some(i => (i.getAttribute("src") || "").indexOf(file) >= 0)), libHidden: !document.querySelector(".igl-overlay") || document.querySelector(".igl-overlay").hidden }; }, FILE);
  ok(les.open && les.imgShown && les.libHidden, "with Pro it opens the lesson at the step that shows the image " + JSON.stringify(les));
  ok(errs.length === 0, "no page errors " + JSON.stringify(errs.slice(0, 2)));
  await p.close();
} finally {
  await browser.close();
  if (serve) serve.kill();
}
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
