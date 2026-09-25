/* Energy (2026-09-25) — real headless browser. The home tile icons pause while the home is covered
 * (MaiK open) and animate when it is on screen; the live doctor parks his frame loop while swiped
 * away, asleep or hidden, and comes straight back. Measures layout/style work with him parked.
 *
 * USAGE: BASE=http://localhost:8986/ node test/run-energy-home-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8986/").replace(/\/?$/, "/");
const PORT = 9401, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/energy-home-chrome-" + Date.now();
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let serveProc = null;
try { await fetch(BASE); } catch {
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), (BASE.match(/:(\d+)/) || [, "8986"])[1]], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }
}
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const metrics = async () => { const r = await call("Performance.getMetrics"); const o = {}; (r.result.metrics || []).forEach((m) => { o[m.name] = m.value; }); return o; };
const window5 = async (ms) => { const a = await metrics(); await sleep(ms); const b = await metrics(); return { layouts: b.LayoutCount - a.LayoutCount, styles: b.RecalcStyleCount - a.RecalcStyleCount, taskMs: Math.round((b.TaskDuration - a.TaskDuration) * 1000) }; };
const doc = async () => JSON.parse(await ev(`return JSON.stringify(__MAIK_TEST.docState())`) || "null");
const setHidden = (h) => ev(`Object.defineProperty(document, "hidden", { configurable: true, get: function () { return ${h}; } }); Object.defineProperty(document, "visibilityState", { configurable: true, get: function () { return "${h ? "hidden" : "visible"}"; } }); document.dispatchEvent(new Event("visibilitychange")); return 1;`);

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  sessionId = (await call("Target.attachToTarget", { targetId, flatten: true })).result.sessionId;
  await call("Runtime.enable"); await call("Performance.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 75; i++) { await sleep(400); if (await ev(`return !!(window.SMD_askMaik && document.getElementById("homeV2"))`) === true) { ready = true; break; } }
  ok(ready, "the app loads");
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash","disclaimerModal"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); localStorage.removeItem("smd_maik_doc_sleepms"); localStorage.setItem("smd_maik_doc_off","0"); return 1;`);
  await ev(`document.body.click(); return 1;`); await sleep(1600);

  // Tile icons: running on the bare home, paused under MaiK.
  const n = await ev(`return document.querySelectorAll("#homeV2 .ai-anim, #homeV2 .ai-clinix-img, #homeV2 .tx-tile-lungs").length`);
  const homeStill = await ev(`return document.getElementById("homeV2").classList.contains("hv-still")`);
  ok(n > 0 && homeStill === false, `on the bare home the ${n} tile icons animate (hv-still ${homeStill})`);
  await ev(`SMD_askMaik(""); return 1;`); await sleep(1800);
  const ps = await ev(`var e = document.querySelector("#homeV2 .ai-anim"); return document.getElementById("homeV2").classList.contains("hv-still") + "|" + (e ? getComputedStyle(e).animationPlayState : "none");`);
  ok(/^true\|/.test(ps), `under the MaiK sheet the tile icons pause (${ps})`);

  // Doctor: live while visible.
  await sleep(4500); const d0 = await doc(); await sleep(900); const d1 = await doc();
  ok(d0 && d1 && !d1.parked && d0.x !== d1.x, `the doctor moves while visible (${d0 && d0.x.toFixed(0)} -> ${d1 && d1.x.toFixed(0)}, ${d1 && d1.state})`);
  const live = await window5(4000);

  // Swiped away: parked, frozen; tab brings him back live.
  await ev(`document.querySelector(".mkdoc").classList.add("mkdoc-hidden"); return 1;`); await sleep(400);
  const h0 = await doc(); await sleep(800); const h1 = await doc();
  ok(h1.parked && h0.x === h1.x, `swiped away he stops his frame loop (parked ${h1.parked})`);
  const parked = await window5(4000);
  console.log(`  layout/style work over 4 s: doctor live ${JSON.stringify(live)}, doctor parked ${JSON.stringify(parked)}`);
  ok(parked.layouts <= live.layouts && parked.styles < live.styles, "parking him cuts style work");
  await ev(`document.querySelector(".mkdoc-tab").click(); return 1;`); await sleep(700);
  const b0 = await doc(); await sleep(900); const b1 = await doc();
  ok(!b1.parked && b0.x !== b1.x, `the tab brings him back moving (${b1.state})`);

  // Hidden app: parks; visible again: resumes.
  await setHidden(true); await sleep(400);
  ok((await doc()).parked === true, "with the app hidden his loop parks");
  await setHidden(false); await sleep(400);
  const v0 = await doc(); await sleep(900); const v1 = await doc();
  ok(!v1.parked && v0.x !== v1.x, `back in the foreground he carries on (${v1.state})`);

  // Asleep: parks on the still pose, keeps his Z z, a question wakes him.
  await ev(`localStorage.setItem("smd_maik_doc_sleepms","2500"); document.getElementById("maikClose").click(); return 1;`); await sleep(800);
  await ev(`SMD_askMaik(""); return 1;`); await sleep(600);
  let slept = null;
  for (let i = 0; i < 40; i++) { await sleep(250); const s = await doc(); if (s.state === "sleep" && s.parked) { slept = s; break; } }
  ok(!!slept, "left alone he lies down and his loop parks");
  const z0 = await ev(`return document.querySelectorAll(".mkdoc .mkdoc-bub").length`); let zSeen = false;
  for (let i = 0; i < 14; i++) { await sleep(250); if ((await ev(`return Array.prototype.some.call(document.querySelectorAll(".mkdoc .mkdoc-bub"), function (b) { return /Z z/.test(b.textContent); })`)) === true) { zSeen = true; break; } }
  ok(zSeen, `asleep and parked he still shows his Z z (${z0} bubbles before)`);
  await ev(`__MAIK_TEST.docCue("cardiac"); return 1;`); await sleep(300);
  const w = await doc();
  ok(!w.parked && w.state !== "sleep", `a question wakes him and his loop runs (${w.state})`);

  console.log(fails === 0 ? "\nALL GREEN: tile icons and the live doctor save energy without changing what is seen" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
