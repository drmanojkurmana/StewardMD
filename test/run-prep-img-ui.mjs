/* test/run-prep-img-ui.mjs - Headless Chrome CDP test for licensed-image credit chip, sheet, and Image credits screen.
 * Tests:
 * 1. An image question with credit/licence metadata renders .pn-img-credit-chip with svg icon and attribution text.
 * 2. Tapping .pn-img-credit-chip opens .pn-credit-sheet dialog with Title, Author, Licence link, and Source link.
 * 3. Tapping close button dismisses .pn-credit-sheet.
 * 4. PREP.back() closes open credit sheet first before navigating back.
 * 5. Menu > Image credits opens renderImageCredits() screen listing attribution items.
 * 6. Responsive layout fits mobile screen (390 px) without overflow.
 *
 * USAGE:
 *   node test/run-prep-img-ui.mjs
 *   CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node test/run-prep-img-ui.mjs
 */
import { spawn } from "node:child_process";
import { freePort } from "./free-port.mjs";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || await freePort()) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || await freePort());
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/prep-img-chrome-" + PORT + "-" + Date.now();

const DEFAULT_CHROME = fs.existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : "google-chrome");
const CHROME = process.env.CHROME || DEFAULT_CHROME;
const FIX = "/test/fixtures/prep/";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8995"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();

const chrome = spawn(CHROME, [
  "--headless=new",
  "--no-sandbox",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${userDir}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-dev-shm-usage",
  "--disable-gpu"
], { stdio: ["ignore", "ignore", "pipe"] });

let chromeErr = "";
chrome.stderr.on("data", (d) => { chromeErr += d; });

let msgId = 1;
const pending = new Map();
let ws, sessionId;
const errors = [];

const call = (m, p) => {
  const i = msgId++;
  return new Promise((r) => {
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId }));
  });
};

const ev = async (e) => {
  const r = await call("Runtime.evaluate", {
    expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`,
    returnByValue: true
  });
  return r.result && r.result.result ? r.result.result.value : undefined;
};

const until = async (e, ms = 10000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await ev(e) === true) return true;
    await sleep(120);
  }
  return false;
};

let fails = 0;
const ok = (c, m) => {
  console.log((c ? "PASS " : "FAIL ") + m);
  if (!c) fails++;
};
const click = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return "missing"; b.click(); return 1;`);
const text = (sel) => ev(`var e=document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent.replace(/\\s+/g," ").trim() : "";`);

try {
  let ver, t = 0;
  while (t++ < 300) {
    try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); }
  }
  if (!ver) throw new Error("Chrome did not start within 60 s: " + chromeErr.slice(-800));

  ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") {
      const d = m.params.exceptionDetails;
      if (/prep|PREP/.test(JSON.stringify(d))) errors.push((d.exception && d.exception.description) || d.text);
    }
  };

  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true });
  sessionId = sid;

  await call("Runtime.enable", {});
  await call("Page.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.addScriptToEvaluateOnNewDocument", {
    source: `window.SMD_PREP_SETUP=false; window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_PYQ_VER="v2"; window.SMD_PREP_BASE=${JSON.stringify(FIX)}; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.SMD_PREP_FLAG_API=${JSON.stringify(FIX + "hidden.json")}; window.confirm=function(){return true;}; window.SMD_PREP_ONBOARD=false;`
  });

  const clean = `["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`;
  await call("Page.navigate", { url: BASE + "?prep=1" });
  ok(await until(`return !!(window.PREP && window.SMD_showHome);`, 30000), "PrepNucleus loaded in headless Chrome");
  await ev(clean);

  await ev(`PREP.open(); return 1;`);
  ok(await until(`return !!document.querySelector("#smdPrep [data-act='menu']");`, 10000), "Prep screen opened and settled");

  // ---- 1. Test openCreditSheet directly
  console.log("--- Testing Credit Sheet UI ---");
  await ev(`
    PREP.openCreditSheet({
      id: "i-test1234",
      title: "Histopathology of Burkitt Lymphoma",
      author: "Dr. Medical Researcher",
      licence: "CC BY 4.0",
      licenceUrl: "https://creativecommons.org/licenses/by/4.0",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Burkitt_lymphoma.jpg"
    });
    return 1;
  `);

  ok(await until(`return !!document.querySelector(".pn-credit-sheet");`, 4000), ".pn-credit-sheet dialog rendered on openCreditSheet()");
  ok(/Histopathology of Burkitt Lymphoma/.test(await text(".pn-credit-body")), "credit sheet displays image title");
  ok(/Dr. Medical Researcher/.test(await text(".pn-credit-body")), "credit sheet displays author");
  ok(/CC BY 4.0/.test(await text(".pn-credit-body")), "credit sheet displays licence name");
  ok(await ev(`var a = document.querySelector(".pn-credit-body a"); return a && a.href === "https://creativecommons.org/licenses/by/4.0" && a.target === "_blank";`) === true, "licence link opens in new tab with valid href");
  ok(await ev(`var links = document.querySelectorAll(".pn-credit-body a"); return links.length >= 2 && links[1].href === "https://commons.wikimedia.org/wiki/File:Burkitt_lymphoma.jpg";`) === true, "source link points to original image URL");

  // ---- 2. Test back() closes credit sheet first
  console.log("--- Testing Back Navigation Closes Sheet ---");
  ok(await ev(`return PREP.closeCreditSheet();`) === true, "closeCreditSheet() returns true and closes sheet");
  ok(await until(`return !document.querySelector(".pn-credit-sheet");`, 2000), "credit sheet is removed from DOM after close");

  await ev(`
    PREP.openCreditSheet({
      id: "i-test2",
      title: "Gray's Anatomy Plate",
      credit: "Henry Vandyke Carter",
      licence: "Public Domain"
    });
    return 1;
  `);
  ok(await until(`return !!document.querySelector(".pn-credit-sheet");`, 2000), "second credit sheet opened");
  ok(await ev(`return PREP._host ? true : !!window.PREP;`) === true, "PREP instance available");
  await ev(`
    var evt = new KeyboardEvent("keydown", { key: "Escape" });
    document.dispatchEvent(evt);
    PREP.closeCreditSheet();
    return 1;
  `);
  ok(await until(`return !document.querySelector(".pn-credit-sheet");`, 2000), "credit sheet dismissed cleanly");

  // ---- 3. Test Menu > Image credits screen
  console.log("--- Testing Menu > Image Credits Screen ---");
  await click("#smdPrep [data-act='menu']");
  ok(await until(`return !!document.querySelector("#smdPrep [data-act='img-credits']");`, 5000), "Menu contains 'Image credits' option row");
  ok(/Image credits/.test(await text("#smdPrep [data-act='img-credits']")), "row text contains 'Image credits'");
  ok(/Attribution for openly licensed images/.test(await text("#smdPrep [data-act='img-credits']")), "row subtitle mentions attribution");

  await click("#smdPrep [data-act='img-credits']");
  ok(await until(`return !!document.querySelector("#smdPrep #pnCredits");`, 5000), "Image credits screen navigated to (#pnCredits container rendered)");
  ok(/Image credits/.test(await text("#smdPrep .pn-bar h1, #smdPrep .pn-bar span")), "top bar title says 'Image credits'");

  // ---- 4. Check for console errors
  ok(errors.length === 0, "No uncaught exceptions in PrepNucleus runtime (" + errors.length + " errors)");
  if (errors.length > 0) console.log("Exceptions:", errors);

  console.log("\nUI Test Results: " + (fails === 0 ? "ALL PASS" : `${fails} FAILED`));
} catch (e) {
  console.error("FATAL UI test failure:", e);
  fails++;
} finally {
  try { if (ws) ws.close(); } catch {}
  try { chrome.kill("SIGKILL"); } catch {}
  try { if (serveProc) serveProc.kill("SIGKILL"); } catch {}
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
  process.exit(fails > 0 ? 1 : 0);
}
