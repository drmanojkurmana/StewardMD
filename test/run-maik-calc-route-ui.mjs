/* MaiK answers a named score with the calculator, and the "Open in app" chips actually open it.
 * Real headless browser against the real app.
 *
 * Reported 2026-09-02 with a screenshot: "HACOR score" was sent to the cloud model (a paid turn),
 * which returned a fabricated formula, while the "Open calculators" chip under the answer did
 * nothing when tapped. Two defects:
 *   1. the delegated chip handler's closest() selector stopped at data-maik-q/data-maik-web, so the
 *      data-maik-tool branch below it was unreachable - every tool chip was dead;
 *   2. nothing resolved a score NAME against the calculator registry before spending tokens.
 *
 * USAGE: BASE=http://localhost:8996/ CHROME=<chrome binary> node test/run-maik-calc-route-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8996/").replace(/\/?$/, "/");
const PORT = 9398, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/maik-calc-chrome-" + Date.now();
const CHROME = process.env.CHROME_BIN || process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8996"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

const overlayOn = () => ev(`var o=document.getElementById("mcOverlay"); return !!(o && o.classList.contains("on"));`);
const overlayText = () => ev(`var o=document.getElementById("mcOverlay"); return o ? o.innerText : "";`);
const closeCalc = async () => { await ev(`var c=document.getElementById("mcClose"); if(c) c.click(); return 1;`); await sleep(300); };
const openMaik = async () => { await ev(`SMD_askMaik(""); return 1;`); await sleep(900); };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };

  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 75; i++) { await sleep(400); if (await ev(`return !!(window.SMD_askMaik && window.MEDCALC && MEDCALC.find)`) === true) { ready = true; break; } }
  ok(ready, "the app, MaiK and the calculator registry load");
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
  await openMaik();
  ok(await ev(`return !!document.getElementById("maikBody");`) === true, "the MaiK sheet opens");
  ok(await ev(`return !!(window.__MAIK_TEST && __MAIK_TEST.route && __MAIK_TEST.calcFor);`) === true, "the production router is reachable");

  // Count paid-model calls from here on. The route must answer a named score with ZERO of them.
  await ev(`window.__aiCalls = 0; var _f = window.fetch; window.fetch = function (u, o) { try { if (String(u).indexOf("/api/ai") > -1) window.__aiCalls++; } catch (e) {} return _f.apply(this, arguments); }; return 1;`);

  // ── the router ──
  ok(await ev(`var r = __MAIK_TEST.route("what is the hacor score", null); return r.kind + ":" + (r.calc && r.calc.id);`) === "calculator:hacor", "THE REPORTED QUESTION routes to the HACOR calculator");
  ok(await ev(`return __MAIK_TEST.route("curb 65 score", null).kind;`) === "calculator", "a named score routes to its calculator");
  ok(await ev(`return __MAIK_TEST.route("treatment of pneumonia", null).kind;`) === "clinical", "a clinical question that merely shares a word with a title still goes to the model");
  ok(await ev(`return __MAIK_TEST.route("wells score", null).kind;`) !== "calculator", "an ambiguous name (Wells PE vs DVT) is not guessed");

  // ── the real send path: type it, press send ──
  const bubblesBefore = await ev(`return document.querySelectorAll("#maikBody .maik-b").length;`);
  await ev(`var q=document.getElementById("maikQ"); q.value="hacor score"; q.dispatchEvent(new Event("input",{bubbles:true})); document.getElementById("maikSend").click(); return 1;`);
  await sleep(1000);
  ok(await ev(`return document.querySelectorAll("#maikBody .maik-b").length;`) > bubblesBefore, "sending produces an answer bubble");
  ok(await ev(`return !!document.querySelector("#maikBody .maik-calc");`) === true, "the answer is the calculator card, not a model answer");
  ok(/HACOR/.test(String(await ev(`var c=document.querySelector("#maikBody .maik-calc"); return c ? c.innerText : "";`))), "it names the calculator");
  ok(await ev(`return !!document.querySelector('#maikBody [data-maik-calc="hacor"]');`) === true, "with a one-tap Open chip for that calculator");
  ok(await ev(`return !!document.querySelector('#maikBody [data-maik-calcask]');`) === true, "and an Ask-MaiK-anyway escape hatch");
  ok(await ev(`return window.__aiCalls;`) === 0, "ZERO paid model calls were made");

  // ── the chip opens THAT calculator (the reported dead chip) ──
  await ev(`document.querySelector('#maikBody [data-maik-calc="hacor"]').click(); return 1;`); await sleep(600);
  ok(await overlayOn() === true, "tapping Open opens the Calculators overlay");
  ok(/HACOR/.test(String(await overlayText())), "on the HACOR calculator itself, not the list");
  await closeCalc();

  // ── the GENERIC 'Open calculators' chip (the exact one circled in the screenshot) ──
  await openMaik();
  await ev(`var b=document.getElementById("maikBody"); var d=document.createElement("div"); d.className="maik-b ai"; d.id="toolchips"; d.innerHTML=__MAIK_TEST.toolChipsHTML("wells score"); b.appendChild(d); return 1;`);
  ok(await ev(`return !!document.querySelector('#toolchips [data-maik-tool="calculators"]');`) === true, "an ambiguous score still gets the generic Open calculators chip");
  await ev(`document.querySelector('#toolchips [data-maik-tool="calculators"]').click(); return 1;`); await sleep(600);
  ok(await overlayOn() === true, "REGRESSION: the generic Open calculators chip opens the list (it was dead)");
  await closeCalc();

  // ── a named score under a model answer gets a SPECIFIC chip ──
  await openMaik();
  const specific = String(await ev(`return __MAIK_TEST.toolChipsHTML("what is the curb 65 score");`));
  ok(/data-maik-calc="curb65"/.test(specific) && /Open CURB-65/.test(specific), "the tool chip names the calculator when the question does");

  // ── delegation survives a thread restore (saved innerHTML has no listeners) ──
  await ev(`var b=document.getElementById("maikBody"); var d=document.createElement("div"); d.className="maik-b ai"; d.id="restored"; d.innerHTML=__MAIK_TEST.calcHTML(__MAIK_TEST.calcFor("qsofa"), "qsofa"); b.appendChild(d); b.innerHTML = b.innerHTML; return 1;`);
  await ev(`document.querySelector('#restored [data-maik-calc="qsofa"]').click(); return 1;`); await sleep(600);
  ok(await overlayOn() === true && /qSOFA/.test(String(await overlayText())), "Open still works on a restored thread");
  await closeCalc();

  // ── Ask MaiK anyway bypasses the calculator route exactly once ──
  await openMaik();
  await ev(`var _f = window.fetch; window.fetch = function (u, o) { if (String(u).indexOf("/api/ai") > -1) { window.__aiCalls++; return Promise.reject(new Error("offline in test")); } return _f.apply(this, arguments); }; return 1;`);
  await ev(`var b=document.getElementById("maikBody"); var d=document.createElement("div"); d.className="maik-b ai"; d.id="askany"; d.innerHTML=__MAIK_TEST.calcHTML(__MAIK_TEST.calcFor("hacor score"), "hacor score"); b.appendChild(d); return 1;`);
  const cardsBefore = await ev(`return document.querySelectorAll("#maikBody .maik-calc").length;`);   // includes the card just placed
  await ev(`document.querySelector('#askany [data-maik-calcask]').click(); return 1;`); await sleep(1500);
  ok(await ev(`return document.querySelectorAll("#maikBody .maik-calc").length;`) === cardsBefore, "Ask MaiK anyway does NOT bounce back to the calculator card");
  ok(await ev(`return window.__aiCalls;`) >= 1, "it reaches the model path instead");
  ok(await ev(`return __MAIK_TEST.route("hacor score", null).kind;`) === "calculator", "and the bypass was one-shot: the next ask routes to the calculator again");

  console.log(fails === 0 ? "\nALL GREEN — a named score is answered by its calculator for free, and the chips open it" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
