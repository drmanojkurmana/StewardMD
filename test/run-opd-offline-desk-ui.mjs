/* OPD plan item 13 (degraded desk mode) - real headless browser.
 *
 * The real check-in sheet (patient-register.js), the real offline desk (opd-offline-desk.js) and the real slip
 * printer (ward-labels.js) in Chrome: the server is unreachable, the desk still completes the check-in with a
 * number from its series, the slip prints, the outbox survives a reload of the desk tab, and sync empties it.
 * The server is a stub (no network), so this checks the screen and the device, not the routes (those are in
 * test/opd-offline-desk.test.mjs).
 *
 * USAGE: node test/run-opd-offline-desk-ui.mjs [--shot <dir>]
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, mkdirSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8999/").replace(/\/?$/, "/");
const PORT = 9397, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/opd-offline-chrome-" + Date.now();
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOT = (process.argv.includes("--shot") ? process.argv[process.argv.indexOf("--shot") + 1] : "");
if (SHOT) mkdirSync(SHOT, { recursive: true });

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8999"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
async function shot(name) {
  if (!SHOT) return;
  const { result: { data } } = await call("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(SHOT, name + ".png"), Buffer.from(data, "base64")); console.log("   screenshot " + join(SHOT, name + ".png"));
}
// test/opd-offline-desk-harness.html: a same-origin page holding only what the desk uses, so the modules load for real.
async function page() {
  await call("Page.navigate", { url: BASE + "test/opd-offline-desk-harness.html" });
  for (let i = 0; i < 40; i++) { await sleep(200); if (await ev(`return !!(window.SMD_PATIENTREG && window.SMD_OPD_OFFLINE && window.WARD_LABELS)`) === true) return true; }
  return false;
}
const DESK = `window.__calls = []; window.__up = false;
  window.__desk = SMD_OPD_OFFLINE.desk({ storage: sessionStorage, orgId: "org-a", date: "2026-09-25", call: function (path, body) {
    __calls.push(path);
    if (path === "offline-series") return Promise.resolve({ ok: true, series: "OA" });
    if (!__up) return Promise.reject(new Error("down"));
    return Promise.resolve(path === "pool" ? { ok: true } : { ok: true, mrn: "MR1" });
  } });`;

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  ok(await page(), "the check-in sheet, the offline desk and the slip printer load");
  await ev(DESK + ` return 1;`);
  await ev(`__desk.prepare().then(function (r) { window.__prep = r; }); return 1;`); await sleep(200);
  ok(await ev(`return window.__prep === true && __desk.ready();`) === true, "while online the desk reserves its offline series");

  await ev(`window.__printed = null;
    SMD_PATIENTREG.open({ mode: "native", clinicName: "City OPD",
      submit: function () { return Promise.reject(new Error("unreachable")); },
      offline: function (sent) { return __desk.issue(sent); },
      printToken: function (o) { window.__printed = o; window.__printOk = WARD_LABELS.print("token", { hospital: "City OPD", token: o.token, name: o.name, issuedAt: "10:42" }); } });
    return 1;`);
  await sleep(300);
  await ev(`function set(id, v) { var e = document.getElementById("pr_" + id); e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); }
    set("name", "Asha Rao"); set("ageYears", "34"); set("mobile", "9876543210");
    document.querySelector('[data-seg="gender"] [data-v="female"]').click(); return 1;`);
  await ev(`document.getElementById("prSave").click(); return 1;`);
  await sleep(500);
  const card = await ev(`return (document.querySelector(".pr-done") || {}).textContent || "";`);
  ok(/Asha Rao checked in offline/.test(card), "the server is unreachable, and the check-in still completes: " + card.slice(0, 40));
  ok(/OA-1/.test(card), "with the next number of the desk's series");
  ok(await ev(`return __desk.pending();`) === 1, "and the answers wait in the outbox");
  const small = await ev(`return [].slice.call(document.querySelectorAll(".pr-done button")).filter(function (b) { return b.offsetHeight < 44; }).map(function (b) { return b.textContent; }).join(",");`);
  ok(small === "", `every button on the card is at least 44px tall (${small || "all"})`);
  await shot("offline-checkin");
  await ev(`document.querySelector('[data-a="print-token"]').click(); return 1;`); await sleep(200);
  ok(await ev(`return !!(window.__printed && __printed.token === "OA-1" && __printed.name === "Asha Rao" && window.__printOk === true);`) === true, "Print token slip prints that number, through the real slip printer");

  // The desk tab is reloaded while still offline: the outbox and the series are still there.
  ok(await page(), "the desk tab reloads");
  await ev(DESK + ` return 1;`);
  ok(await ev(`return __desk.pending() + "|" + __desk.issue({ name: "Ravi" }).token;`) === "1|OA-2", "after a reload the check-in is still waiting and numbering continues");
  await ev(`window.__up = true; __desk.sync().then(function (r) { window.__sync = r; }); return 1;`); await sleep(400);
  ok(await ev(`return JSON.stringify(window.__sync);`) === JSON.stringify({ synced: 2, left: 0, review: 0 }), "back online, sync sends both and the outbox empties");
  ok(await ev(`return __calls.filter(function (c) { return c === "patient/register"; }).length;`) === 2, "each registered once");

  console.log(fails === 0 ? "\nALL GREEN: the desk checks patients in offline, prints the slip, and sends them when back" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
