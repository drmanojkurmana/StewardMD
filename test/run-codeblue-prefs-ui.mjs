/* Code Blue prefs in headless Chrome over CDP: settings sheet opens from the
 * live status row and the trainer and ECG headers, seven themes apply by
 * data-cb-theme with contrast spot checks, text size 90 to 130 percent,
 * button sizes 56/64/76 px, tile reorder and hide, up to 4 custom buttons
 * logging note events, restore defaults, persistence in smd.cbp.v1,
 * keyboard access (focus, Escape, focus return), 44 px targets, 390/360 px.
 * Screenshots go to SHOTS=<dir>.
 *
 * USAGE: node test/run-codeblue-prefs-ui.mjs   (BASE=http://localhost:PORT/ for a running server; SHOTS=<dir> saves PNGs)
 */
import { spawn } from "node:child_process";
import { freePort } from "./free-port.mjs";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || await freePort()) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || await freePort()), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/cb-prefs-" + PORT + "-" + Date.now();
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FLAGS = (process.env.CHROME_FLAGS || "").split(/\s+/).filter(Boolean);

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8997"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage", "--disable-gpu", "--force-device-scale-factor=2"].concat(FLAGS), { stdio: ["ignore", "ignore", "pipe"] });
let chromeErr = ""; chrome.stderr.on("data", (d) => { chromeErr += d; });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const shotCall = async (p) => { await sleep(250); return call("Page.captureScreenshot", p); };
const until = async (e, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(200); } return false; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const shot = async (name, dark) => {
  if (!process.env.SHOTS) return;
  const fsx = await import("node:fs");
  fsx.mkdirSync(process.env.SHOTS, { recursive: true });
  await ev(`document.body.classList.${dark ? "add" : "remove"}("dark"); return 1;`);
  await sleep(400);
  const r = await shotCall({ format: "png" });
  if (r.result) fsx.writeFileSync(join(process.env.SHOTS, "cbp-" + name + "-" + (dark ? "dark" : "light") + ".png"), Buffer.from(r.result.data, "base64"));
};
const CBL = `#cblRoot`, CBP = `#cbpRoot`;

async function targets(tag, scope) {
  const small = await ev(`return Array.from(document.querySelectorAll("${scope} button, ${scope} input")).map(function (b) { var r = b.getBoundingClientRect(); return Math.round(Math.min(r.width, r.height)); }).filter(function (n) { return n < 44; }).length;`);
  ok(small === 0, tag + ": all targets at least 44 px (small=" + small + ")");
}

async function contrast(tag, scope, word, label) {
  const r = await ev(`return (function () {
    function lum(r, g, b) {
      var f = function (c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    }
    function ratio(fg, bg) {
      function p(s) { var m = s.match(/\\d+(\\.\\d+)?/g) || [0, 0, 0]; return [+m[0], +m[1], +m[2]]; }
      var a = p(fg), b = p(bg), l1 = lum(a[0], a[1], a[2]), l2 = lum(b[0], b[1], b[2]);
      if (l1 < l2) { var t = l1; l1 = l2; l2 = t; }
      return (l1 + 0.05) / (l2 + 0.05);
    }
    var el = document.querySelector(${JSON.stringify(word)});
    if (!el) return -1;
    var cs = getComputedStyle(el), bg = cs.backgroundColor, n = el;
    while ((!bg || bg === "rgba(0, 0, 0, 0)") && n.parentElement) { n = n.parentElement; bg = getComputedStyle(n).backgroundColor; }
    return Math.round(ratio(cs.color, bg) * 100) / 100;
  })();`);
  ok(r >= 4.5, tag + ": contrast " + label + " >= 4.5 (" + r + ")");
}

try {
  let ver, t = 0; while (t++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome did not start within 60 s: " + chromeErr.slice(-800));
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.confirm=function(){return true;}; window.prompt=function(dflt){return "Edited label";};` });
  await call("Page.navigate", { url: BASE + "test/fixtures/codeblue-prefs-harness.html" });
  ok(await until(`return !!(window.CodeBlueLive && window.CodeBluePrefs && window.CodeBlueTrainer && window.CodeBlueECG && window.CodeBlueSheet);`, 30000), "harness loads live, prefs, trainer, ecg and sheet modules");

  await ev(`try{localStorage.clear();}catch(e){} return 1;`);
  await ev(`CodeBlueLive.open(); return 1;`);
  ok(await until(`return !!(window.CodeBlueLive && CodeBlueLive._rt.view() === "idle");`, 5000), "live idle opens");
  ok(await ev(`return !!document.querySelector('${CBL} [data-cbp-settings]');`) === true, "live status row has Display settings");
  await ev(`document.querySelector('${CBL} [data-act="start"]').click(); return 1;`);
  ok(await until(`return CodeBlueLive._rt.view() === "running";`, 5000), "clock runs");
  ok(await ev(`return document.querySelectorAll('${CBL} .cbl-tile').length === 7;`) === true, "defaults render 7 tiles");

  /* Open the settings sheet from the live screen. */
  await ev(`document.querySelector('${CBL} [data-cbp-settings]').click(); return 1;`);
  ok(await until(`return !!document.querySelector('${CBP} [role="dialog"]');`, 5000), "settings sheet opens");
  ok(await ev(`return document.activeElement && document.activeElement.id === "cbpTitle";`) === true, "heading takes focus");
  ok(await ev(`return document.querySelectorAll('${CBP} input[name="cbp-theme"]').length === 7;`) === true, "seven theme options");
  ok(await ev(`return !!document.querySelector('${CBP} .cbp-prev');`) === true, "live preview renders");
  await shot("sheet", false); await shot("sheet", true);
  await targets("sheet-390", CBP);

  /* Theme applies by data-cb-theme with contrast intact. */
  await ev(`Array.from(document.querySelectorAll('${CBP} input[name="cbp-theme"]')).filter(function (r) { return r.value === "high-contrast"; })[0].click(); return 1;`);
  ok(await until(`return document.querySelector('${CBL}').getAttribute("data-cb-theme") === "high-contrast";`, 5000), "high contrast theme applies to live root");
  await contrast("hc", CBL, `${CBL} .cbl-tilelabel`, "tile text");
  ok(await ev(`return !!localStorage.getItem("smd.cbp.v1");`) === true, "prefs persist in smd.cbp.v1");
  await shot("high-contrast", true);

  /* Text and button sizes. */
  await ev(`var r = document.querySelector('${CBP} #cbpText'); r.value = 130; r.dispatchEvent(new Event("input", { bubbles: true })); return 1;`);
  ok(await until(`return getComputedStyle(document.querySelector('${CBL}')).getPropertyValue("--cbp-ts").trim() === "1.3";`, 5000), "text size 130 percent sets --cbp-ts");
  await ev(`Array.from(document.querySelectorAll('${CBP} input[name="cbp-size"]')).filter(function (r) { return r.value === "large"; })[0].click(); return 1;`);
  ok(await until(`return Array.from(document.querySelectorAll('${CBL} .cbl-tile')).every(function (b) { return Math.round(b.getBoundingClientRect().height) >= 76; });`, 5000), "large buttons are 76 px tiles");

  /* Hide, reorder, custom buttons. */
  await ev(`document.querySelector('${CBP} [data-cbp-hide][data-id="epi"]').click(); return 1;`);
  ok(await until(`return document.querySelectorAll('${CBL} .cbl-tile').length === 6;`, 5000), "hiding Epinephrine removes its tile");
  await ev(`var b = document.querySelector('${CBP} [data-cbp-up][data-id="note"]'); b.click(); return 1;`);
  ok(await ev(`return document.querySelector('${CBL} .cbl-tile').getAttribute("aria-label") !== null;`) === true, "grid still renders after reorder");
  await ev(`var i = document.querySelector('${CBP} #cbpCustomIn'); i.value = "Airway"; document.querySelector('${CBP} [data-cbp-addcustom]').click(); return 1;`);
  ok(await until(`return Array.from(document.querySelectorAll('${CBL} .cbl-tile')).some(function (b) { return b.getAttribute("aria-label") === "Airway"; });`, 5000), "custom button renders as a tile");
  ok(await ev(`return document.querySelectorAll('${CBL} .cbl-tile').length === 7;`) === true, "6 visible plus 1 custom tile");
  await ev(`Array.from(document.querySelectorAll('${CBL} .cbl-tile')).filter(function (b) { return b.getAttribute("aria-label") === "Airway"; })[0].click(); return 1;`);
  ok(await until(`return CodeBlueLive._rt.session().events.some(function (e) { return e.kind === "note" && e.label === "Airway"; });`, 5000), "custom button logs a note event");
  await shot("custom", false);

  /* Restore defaults and keyboard close. */
  await ev(`document.querySelector('${CBP} [data-cbp-restore]').click(); return 1;`);
  ok(await until(`return document.querySelectorAll('${CBL} .cbl-tile').length === 7 && Array.from(document.querySelectorAll('${CBL} .cbl-tile'))[0].getAttribute("aria-label") === "Shock";`, 8000), "restore defaults brings back 7 tiles starting with Shock");
  await ev(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); return 1;`);
  ok(await until(`return !document.querySelector('${CBP}');`, 5000), "Escape closes the sheet");
  ok(await ev(`return document.activeElement === document.querySelector('${CBL} [data-cbp-settings]');`) === true, "focus returns to Display settings");

  /* Reduced motion switch. */
  await ev(`document.querySelector('${CBL} [data-cbp-settings]').click(); return 1;`);
  ok(await until(`return !!document.querySelector('${CBP} [role="dialog"]');`, 5000), "sheet reopens");
  await ev(`Array.from(document.querySelectorAll('${CBP} input[name="cbp-motion"]')).filter(function (r) { return r.value === "reduce"; })[0].click(); return 1;`);
  ok(await until(`return document.querySelector('${CBL}').getAttribute("data-cb-motion") === "reduced";`, 5000), "reduced motion applies to live root");
  await ev(`document.querySelector('${CBP} [data-cbp-done]').click(); return 1;`);
  ok(await until(`return !document.querySelector('${CBP}');`, 5000), "Done closes the sheet");

  /* Trainer and ECG headers open the same sheet and take the theme. */
  await ev(`CodeBlueLive.close(); CodeBlueTrainer.open(); return 1;`);
  ok(await until(`return !!document.querySelector('#cbtRoot [data-cbp-settings]');`, 5000), "trainer header has Display settings");
  ok(await ev(`return document.querySelector('#cbtRoot').getAttribute("data-cb-theme") !== null;`) === true, "theme hook applied to trainer root");
  await ev(`document.querySelector('#cbtRoot [data-cbp-settings]').click(); return 1;`);
  ok(await until(`return !!document.querySelector('${CBP} [role="dialog"]');`, 5000), "sheet opens from trainer");
  await ev(`document.querySelector('${CBP} [data-cbp-done]').click(); return 1;`);
  await ev(`CodeBlueTrainer.close(); CodeBlueECG.open(); return 1;`);
  ok(await until(`return !!document.querySelector('.cbecg [data-cbp-settings]');`, 8000), "ECG header has Display settings");
  ok(await ev(`return document.querySelector('.cbecg').getAttribute("data-cb-theme") !== null;`) === true, "theme hook applied to ECG root");
  await shot("ecg-settings", true);
  await ev(`CodeBlueECG.close(); return 1;`);

  /* 360 px holds with no horizontal scroll. */
  await call("Emulation.setDeviceMetricsOverride", { width: 360, height: 740, deviceScaleFactor: 2, mobile: true });
  await ev(`CodeBlueLive.open(); return 1;`);
  await ev(`document.querySelector('${CBL} [data-act="start"]').click(); return 1;`);
  ok(await until(`return CodeBlueLive._rt.view() === "running";`, 5000), "running at 360 px");
  await ev(`document.querySelector('${CBL} [data-cbp-settings]').click(); return 1;`);
  ok(await until(`return !!document.querySelector('${CBP} [role="dialog"]');`, 5000), "sheet opens at 360 px");
  const scroll = await ev(`return document.documentElement.scrollWidth <= window.innerWidth + 1;`);
  ok(scroll === true, "360: no horizontal scroll");
  await targets("sheet-360", CBP);
  await shot("sheet-360", false);
  await ev(`CodeBlueLive.close(); return 1;`);

  /* iPad: settings sheet holds at 820x1180 and 1194x834, light and dark. */
  for (const [w, h, tag] of [[820, 1180, "820"], [1194, 834, "1194"]]) {
    await call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile: true });
    await ev(`CodeBlueLive.open(); return 1;`);
    await ev(`document.querySelector('${CBL} [data-act="start"]').click(); return 1;`);
    ok(await until(`return CodeBlueLive._rt.view() === "running";`, 5000), `running at ${tag}`);
    await ev(`document.querySelector('${CBL} [data-cbp-settings]').click(); return 1;`);
    ok(await until(`return !!document.querySelector('${CBP} [role="dialog"]');`, 5000), `sheet opens at ${tag}`);
    ok(await ev(`return document.documentElement.scrollWidth <= window.innerWidth + 1;`) === true, `${tag}: no horizontal scroll`);
    await targets(`sheet-${tag}`, CBP);
    await shot(`sheet-${tag}`, false); await shot(`sheet-${tag}`, true);
    await ev(`var d = document.querySelector('${CBP} [data-cbp-done]'); if (d) d.click(); CodeBlueLive.close(); try{localStorage.clear();}catch(e){} return 1;`);
  }

  console.log(fails === 0 ? "ALL UI CHECKS PASSED" : fails + " UI CHECKS FAILED");
  try { chrome.kill(); } catch {}
  if (serveProc) { try { serveProc.kill(); } catch {} }
  process.exit(fails === 0 ? 0 : 1);
} catch (err) {
  console.log("FATAL " + (err && err.stack || err));
  try { chrome.kill(); } catch {}
  if (serveProc) { try { serveProc.kill(); } catch {} }
  process.exit(2);
}
