/* ICU unit board + workspace regressions (2026-10-28 UI audit):
 *  - severity sorts used `rank[sev] || 9`; critical's rank is 0 (falsy), so CRITICAL patients sank to
 *    the BOTTOM of the board and crit alerts sorted below warnings
 *  - CSS uppercase turned authored clinical notation into PH / PACO2 / SPO2 / FIO2
 *  - the red swipe "Remove" action showed through every card's rounded corner at rest
 *  - the Lab Watch pill covered the vitals grid; the scroll must clear both floating buttons
 * USAGE: node test/run-icu-board-order.mjs   (CHROME=/path/to/chrome to override)
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8922/").replace(/\/?$/, "/");
const PORT = 9457, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/icu-boardorder-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8922"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.stack||x)})}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
const J = async (e) => { const v = await ev(e); try { return JSON.parse(v); } catch { return v; } };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE + "?tour=0" });
  let ready = false;
  for (let i = 0; i < 90; i++) { await sleep(400); if (await ev(`return !!(window.ICU && ICU.savePatient)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("ICU not loaded");

  await J(`
    window.SMD_AUTH = { currentUser: { uid: "order-uid" } };
    localStorage.setItem("smd_icu_groups", "0");
    try { for (var i=localStorage.length-1;i>=0;i--){ var k=localStorage.key(i); if(k&&k.indexOf("stewardmd_icu_patients")===0) localStorage.removeItem(k); } } catch(e){}
    [["Stable One","1",{hr:80,sbp:124,dbp:76,spo2:98,rr:16}],["Crit Pt","9",{hr:128,sbp:80,dbp:46,spo2:89,rr:30}],["Stable Two","4",{hr:76,sbp:120,dbp:72,spo2:97,rr:14}]].forEach(function (p) {
      ICU.reset(); ICU.ingestPatient({ name: p[0], bed: p[1], diagnosis: "x", age: 60, sex: "F" }); ICU.ingestMonitor(p[2]); ICU.savePatient();
    });
    ICU.open(); return "1";
  `);
  await sleep(700);
  const board = await J(`var root = document.getElementById("icuRoot");
    var cards = [].slice.call(root.querySelectorAll(".icu-v2-card")).map(function (c) { return { cls: c.className, name: (c.querySelector(".icu-v2-card-name")||{}).textContent || "" }; });
    var vk = [].slice.call(root.querySelectorAll(".icu-v2-vk")).map(function (e) { return getComputedStyle(e).textTransform + "|" + e.textContent; });
    var act = root.querySelector(".icu-v2-swipe-act");
    return JSON.stringify({ cards: cards, vk: vk.slice(0, 4), actVis: act ? getComputedStyle(act).visibility : null });`);
  ok(board.cards.length === 3, `3 cards on the board (${board.cards.length})`);
  ok(/critical/.test(board.cards[0] && board.cards[0].cls) && /Crit Pt/.test(board.cards[0].name), `the CRITICAL patient is the FIRST card (got ${board.cards.map(c => c.name).join(", ")})`);
  ok(board.vk.every(v => v.indexOf("uppercase") !== 0) && board.vk.some(v => /SpO₂$/.test(v)), `card vital keys keep clinical case (${board.vk.join(" ; ")})`);
  ok(board.actVis === "hidden", `swipe Remove action hidden at rest (${board.actVis})`);

  await J(`document.querySelector("#icuRoot .icu-v2-card.critical").click(); return "1";`);
  await sleep(700);
  const wsp = await J(`var root = document.getElementById("icuRoot");
    var vl = [].slice.call(root.querySelectorAll(".icu-vc .vl")).map(function (e) { return getComputedStyle(e).textTransform + "|" + e.textContent; });
    var sc = root.querySelector(".icu-scroll"), w = root.querySelector("#icuWatch"), s = root.querySelector("#icuSnap");
    var pad = sc ? parseFloat(getComputedStyle(sc).paddingBottom) : 0, top = Math.min(w ? w.getBoundingClientRect().top : 1e9, s ? s.getBoundingClientRect().top : 1e9);
    return JSON.stringify({ vl: vl, pad: pad, clear: top === 1e9 || (innerHeight - top) <= pad, watchW: w ? w.getBoundingClientRect().width : null });`);
  const alerts = await J(`var a = (ICU_STATE.alerts || []).map(function (x) { return x.severity; }); return JSON.stringify(a);`);
  const firstNonCrit = alerts.findIndex(s => s !== "crit"), lastCrit = alerts.lastIndexOf("crit");
  ok(alerts.includes("crit") && (firstNonCrit === -1 || lastCrit < firstNonCrit), `crit alerts sort ahead of the rest (${alerts.join(",")})`);

  ok(wsp.vl.length > 0 && wsp.vl.every(v => v.indexOf("uppercase") !== 0), "workspace tile labels are not uppercased");
  ok(wsp.vl.some(v => /\|pH$/.test(v)) && wsp.vl.some(v => /\|PaCO₂$/.test(v)), `pH and PaCO₂ render as written`);
  ok(wsp.clear, `scroll bottom padding (${wsp.pad}px) clears the floating buttons`);
  ok(wsp.watchW === null || wsp.watchW <= 52, `Lab Watch is a compact button, not a pill over the grid (${wsp.watchW}px)`);
} catch (e) { console.log("❌ " + (e && e.stack || e)); fails++; }
finally { try { chrome.kill(); } catch {} try { serveProc && serveProc.kill(); } catch {} }
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
