/* Adult normal values page (adult-ref.js): real headless browser against the real app.
 * Opens the page, searches "potassium", sees the range with its source; opens it from a MaiK question
 * with the analyte highlighted; checks the lab-variation note is on top and nothing scrolls sideways.
 * USAGE: BASE=http://localhost:8996/ CHROME=<chrome binary> [SHOT=/tmp/aref] node test/run-adult-ref-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8996/").replace(/\/?$/, "/");
const PORT = 9419, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/adult-ref-chrome-" + Date.now();
const CHROME = process.env.CHROME_BIN || process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8996"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
const text = () => ev(`var r=document.getElementById("adultRef"); return r ? r.innerText : "";`);

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 75; i++) { await sleep(400); if (await ev(`return !!(window.SMD_ADULT_REF && window.SMD_openRoute && window.SMD_SEARCH)`) === true) { ready = true; break; } }
  ok(ready, "the app and adult-ref.js load");
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);

  ok(await ev(`var p=SMD_SEARCH.providers().filter(function(x){return x.cat==="tools";})[0]; return p.items().some(function(t){return t.id==="adultref";});`) === true, "search lists Adult normal values as a tool");
  await ev(`SMD_openRoute("adultref"); return 1;`);
  for (let i = 0; i < 25 && !(await ev(`return !!document.querySelector("#adultRef #arQ")`)); i++) await sleep(200);
  ok(await ev(`var r=document.getElementById("adultRef"); return !!(r && !r.hidden);`) === true, "the route opens the page");
  ok(await ev(`var b=document.querySelector("#adultRef .nh-body"); return b && b.firstElementChild && b.firstElementChild.classList.contains("nh-note") && /use the reference range printed by the patient's own laboratory/i.test(b.firstElementChild.textContent);`) === true, "the lab-variation note is at the top");
  await ev(`var q=document.getElementById("arQ"); q.value="potassium"; q.dispatchEvent(new Event("input",{bubbles:true})); return 1;`); await sleep(200);
  const tx = String(await text());
  ok(/POTASSIUM|Potassium/.test(tx) && /3\.5-5\.2 mmol\/L/.test(tx) && /3\.5-5\.0 mEq\/L/.test(tx), "searching potassium shows 3.5-5.2 mmol/L and 3.5-5.0 mEq/L");
  ok(/RCPA SPIA harmonised reference intervals/.test(tx) && /ABIM Laboratory Test Reference Ranges, January 2026/.test(tx), "each value names its source");
  ok(await ev(`return document.querySelectorAll("#adultRef [data-ar=list] .nh-row").length;`) === 1, "only the potassium row is listed");
  ok(/Sources/i.test(tx) && /rcpa\.edu\.au/.test(tx), "the sources list is at the bottom");
  ok(!/[—]/.test(tx), "no em-dash on the page");
  await ev(`var q=document.getElementById("arQ"); q.value="zzqx"; q.dispatchEvent(new Event("input",{bubbles:true})); return 1;`); await sleep(150);
  ok(/No adult range on file/.test(String(await text())), "an unknown test says so");
  ok(await ev(`var b=document.querySelector("#adultRef .nh-body"); return b.scrollWidth <= b.clientWidth + 1;`) === true, "no sideways scroll at 360 px");
  await ev(`document.querySelector('#adultRef [data-ar=back]').click(); return 1;`); await sleep(150);
  ok(await ev(`return document.getElementById("adultRef").hidden;`) === true, "Close hides the page");

  // From a MaiK question: the analyte is searched and highlighted.
  await ev(`SMD_ADULT_REF.open({ q: "normal adult potassium range?" }); return 1;`); await sleep(500);
  ok(await ev(`return document.getElementById("arQ").value;`) === "Potassium", "opened from a question, the search holds the analyte");
  ok(await ev(`var h=document.querySelector("#adultRef .nh-row.hit"); return h ? h.getAttribute("data-analyte") : null;`) === "Potassium", "and its row is highlighted");
  if (process.env.SHOT) {
    for (const dark of [false, true]) {
      await ev(`document.body.classList.toggle("dark", ${dark}); return 1;`); await sleep(150);
      const s = await call("Page.captureScreenshot", { format: "png" });
      (await import("node:fs")).writeFileSync(process.env.SHOT + (dark ? "-dark.png" : "-light.png"), Buffer.from(s.result.data, "base64"));
    }
  }
  console.log(fails === 0 ? "\nALL GREEN: adult normal values page" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
