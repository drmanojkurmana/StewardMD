/* MaiK: a REOPENED conversation keeps its memory and its controls — real headless browser.
 *
 * Owner, 2026-09-24: "opening and closing or opening an old chat makes the chips in the old chat not
 * work", and MaiK forgot the conversation. A saved thread comes back as HTML with no listeners and
 * no memory. This opens a saved conversation from the sidebar, then taps every control in it.
 *
 * USAGE: node test/run-maik-restore-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8997/").replace(/\/?$/, "/");
const PORT = 9398, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/maik-restore-chrome-" + Date.now();
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8997"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

const Q = "Treatment of hypertension?";
const HTML = '<div class="maik-b you">' + Q + '</div><div class="maik-b ai"><p>First-line therapy is amlodipine 5 mg once daily.</p>' +
  '<div class="maik-followups"><button class="maik-fu" data-maik-send="Hypertension: check potassium">Check potassium</button></div>' +
  '<button class="maik-chip maik-webchip" data-maik-web="treatment of hypertension">Research</button>' +
  '<button class="maik-chip maik-rx">Create prescription</button>' +
  '<div class="maik-fb"><span class="maik-fb-q">Was this helpful?</span><span class="maik-acts"><button type="button" class="maik-fb-b maik-act">Copy</button><button type="button" class="maik-fb-b maik-act">Edit</button></span>' +
  '<button type="button" class="maik-fb-b">Yes</button><button type="button" class="maik-fb-b">No</button></div></div>';
const click = (sel) => ev(`var e = document.querySelector(${JSON.stringify(sel)}); if (!e) return "missing"; e.click(); return 1;`);

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 75; i++) { await sleep(400); if (await ev(`return !!window.SMD_askMaik`) === true) { ready = true; break; } }
  ok(ready, "the app and MaiK load");
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
  // The saved conversation, keyed exactly as home.js keys a signed-out device's list.
  await ev(`localStorage.setItem("smd_device_id", "restoretest");
    localStorage.setItem("smd_maik_convos_d_restoretest", JSON.stringify([{ id: "c1", title: ${JSON.stringify(Q)}, html: ${JSON.stringify(HTML)}, ts: Date.now() }]));
    window.SMD_RX = { open: function (o) { window.__rx = o; } };
    try { Object.defineProperty(navigator, "clipboard", { value: { writeText: function (t) { window.__copied = t; return Promise.resolve(); } }, configurable: true }); } catch (e) {}
    return 1;`);
  await ev(`SMD_askMaik(""); return 1;`); await sleep(1200);
  console.log("   sheet:", await ev(`return JSON.stringify({ body: !!document.getElementById("maikBody"), menu: !!document.getElementById("maikMenu"), hook: typeof window.__MAIK_TEST });`));
  ok(await click("#maikMenu") === 1, "the conversations sidebar opens"); await sleep(400);
  ok(await click('[data-conv="c1"]') === 1, "the saved conversation is in the list and opens"); await sleep(500);

  const turns = JSON.parse(await ev(`return JSON.stringify(__MAIK_TEST.turns());`) || "[]");
  ok(turns.length === 1 && turns[0].q === Q, `memory rebuilt from the reopened thread (${turns.length} turn)`);
  ok(turns[0] && /amlodipine 5 mg/.test(turns[0].g || ""), "the remembered gist carries the answer's key line");

  await click("#maikBody .maik-act:nth-child(1)"); await sleep(300);
  ok(/amlodipine 5 mg/.test(await ev(`return window.__copied || "";`)), "Copy copies the answer");
  ok(!/Check potassium|Research|Was this helpful/.test(await ev(`return window.__copied || "";`)), "Copy leaves the chips out");
  await click("#maikBody .maik-act:nth-child(2)"); await sleep(200);
  ok(await ev(`return document.getElementById("maikQ").value;`) === Q, "Edit puts the question back in the composer");
  await click("#maikBody .maik-rx"); await sleep(200);
  ok(await ev(`return window.__rx && window.__rx.topic;`) === Q, "Create prescription opens the pad for this question");
  await click("#maikBody .maik-fb > .maik-fb-b"); await sleep(200);
  ok(await ev(`return document.querySelector("#maikBody .maik-fb-q").textContent;`) === "Thanks, noted.", "Yes records the rating");
  await click("#maikBody .maik-webchip"); await sleep(200);
  ok(await ev(`return document.querySelector("#maikBody .maik-webchip").disabled;`) === true, "Research starts web research");
  const youBefore = await ev(`return document.querySelectorAll("#maikBody .maik-b.you").length;`);
  await click('#maikBody [data-maik-send]'); await sleep(800);
  const youAfter = await ev(`return document.querySelectorAll("#maikBody .maik-b.you").length;`);
  const last = await ev(`var y = document.querySelectorAll("#maikBody .maik-b.you"); return y[y.length - 1].textContent;`);
  ok(youAfter === youBefore + 1 && /check potassium/i.test(last), `a follow-up chip sends its question ("${last}")`);

  console.log(fails === 0 ? "\nALL GREEN: a reopened conversation remembers and every control works" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
