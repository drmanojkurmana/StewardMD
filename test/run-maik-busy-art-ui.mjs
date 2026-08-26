/* MaiK busy art — real headless browser.
 *
 * While an answer generates: Medibot (vector, 30 px) sits in the pending bubble, and one of two
 * DARK-TEAL pixel stethoscope characters walks the composer's top edge, alternating per turn.
 * Pinned here because all three are hand-authored art — a dropped frame, a stray colour or a
 * walker that never leaves are all invisible to a unit test.
 *
 * USAGE: node test/run-maik-busy-art-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
const BASE = (process.env.BASE || "http://localhost:8989/").replace(/\/?$/, "/");
const PORT = 9387, userDir = process.env.CLAUDE_JOB_DIR + "/busy-chrome-" + Date.now();
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const serve = spawn("node", ["test/serve.mjs", ".", "8989"], { stdio: "ignore" });
for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await call("Page.navigate", { url: BASE });
  for (let i = 0; i < 75; i++) { await sleep(400); if (await ev(`return !!window.SMD_askMaik`) === true) break; }
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); document.body.classList.add("dark"); return 1;`);
  await ev(`SMD_askMaik(""); return 1;`); await sleep(1400);

  // the pending bubble, rendered by the real code path
  await ev(`
    var b=document.getElementById("maikBody");
    var d=document.createElement("div"); d.className="maik-b ai";
    d.innerHTML='<div class="maik-buffer"><div class="maik-buffer-head">'+__MAIK_TEST.botSVG(30)+'<span class="maik-buffer-txt">Reviewing the evidence</span></div><div class="maik-sk"><span></span><span></span><span></span></div></div>';
    b.appendChild(d); return 1;`);
  ok(await ev(`return !!document.querySelector("#maikBody .maik-bot");`) === true, "Medibot renders in the pending bubble");
  ok(await ev(`return document.querySelectorAll("#maikBody .maik-bot .mkb-ping").length;`) === 2, "its pulse rings are there");

  // the walker
  await ev(`__MAIK_TEST.walker(true); return 1;`); await sleep(300);
  ok(await ev(`return !!document.querySelector(".maik-cmp .mkw");`) === true, "walker mounts on the composer edge");
  const fills = await ev(`return [].slice.call(document.querySelectorAll(".mkw rect")).map(function(r){return r.getAttribute("fill");}).filter(function(v,i,a){return a.indexOf(v)===i;}).sort().join(",");`);
  ok(fills === "#04211E,#0E6E63,#14807A,#2DD4BF", "dark-teal palette only — got " + fills);
  ok(await ev(`return document.querySelectorAll(".mkw .mkw-f1, .mkw .mkw-f2").length;`) === 2, "two walk frames");
  const first = await ev(`return document.querySelector(".mkw svg").getAttribute("width");`);
  await ev(`__MAIK_TEST.walker(false); __MAIK_TEST.walker(true); return 1;`); await sleep(200);
  const second = await ev(`return document.querySelector(".mkw svg").getAttribute("width");`);
  ok(first !== second, "the two characters alternate per turn (" + first + "px then " + second + "px)");
  await ev(`__MAIK_TEST.walker(false); return 1;`); await sleep(150);
  ok(await ev(`return !document.querySelector(".maik-cmp .mkw");`) === true, "walker leaves when the turn ends");

} catch (e) { console.log("ERR", e); fails++; }
finally { chrome.kill(); serve.kill(); }
console.log(fails ? "FAILED" : "ALL PASS");
process.exit(fails ? 1 : 0);
