/* MaiK Drug-Index fast path — real headless browser.
 *
 * Reported: "when I asked dose of amlodipine it could have simply redirected me to the drug
 * database, or at least given me the option." A plain dose lookup now answers from the curated
 * on-device Drug Index instantly, with both doors offered: open the drug page, or let MaiK answer.
 * The detector must stay NARROW — a renal/paediatric/interaction dose question is not a lookup.
 *
 * USAGE: node test/run-maik-dose-lookup-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8992/").replace(/\/?$/, "/");
const PORT = 9396, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/maik-dose-chrome-" + Date.now();
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8992"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
const look = async (q) => ev(`var d = __MAIK_TEST.doseLookup(${JSON.stringify(q)}); return d ? d.generic : "";`);

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
  for (let i = 0; i < 75; i++) { await sleep(400); if (await ev(`return !!(window.SMD_askMaik && window.MEDDRUGS);`) === true) { ready = true; break; } }
  ok(ready, "the app, MaiK and the on-device Drug Index load");
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
  await ev(`SMD_askMaik(""); return 1;`); await sleep(1200);

  // ── what IS a lookup ──
  ok(await look("dose of amlodipine") === "Amlodipine", "\"dose of amlodipine\" resolves to the Drug Index entry");
  ok(await look("amlodipine dosage") === "Amlodipine", "so does \"amlodipine dosage\"");
  ok(await look("what is the dose of pantoprazole") === "Pantoprazole", "and a full-sentence lookup");
  ok(await look("amlong dose") === "Amlodipine", "a brand name resolves to its molecule");

  // ── what is NOT (MaiK must still answer these) ──
  const notLookups = [
    ["amlodipine dose in renal failure", "renal adjustment"],
    ["paracetamol dose in a child", "paediatric"],
    ["dose of enoxaparin in pregnancy", "pregnancy"],
    ["weight based dose of morphine", "weight-based"],
    ["amlodipine vs telmisartan dose", "a comparison"],
    ["can I give aspirin and clopidogrel together", "no dose intent at all"],
    ["how do I treat DKA", "a management question"]
  ];
  for (const [q, why] of notLookups) ok(await look(q) === "", "not a lookup: " + why + " — " + q);

  // ── the card the clinician actually sees ──
  await ev(`var i=document.getElementById("maikInput")||document.querySelector("#maikSheet textarea,#maikSheet input[type=text]"); i.value="dose of amlodipine"; return 1;`);
  await ev(`var b=document.querySelector("#maikSend")||document.querySelector("#maikSheet [data-maik-send]"); if(b) b.click(); return 1;`); await sleep(900);
  const card = `document.querySelector("#maikBody .maik-dosecard")`;
  ok(await ev(`return !!${card};`) === true, "asking it renders the Drug Index card, not a cloud answer");
  ok((await ev(`return ${card}.textContent;`) || "").indexOf("5–10 mg PO once daily") >= 0, "the curated dose is shown immediately");
  ok(await ev(`return !!${card}.querySelector("[data-maik-drugidx]") && !!${card}.querySelector("[data-maik-anyway]");`) === true,
    "both doors are offered — Drug Index and MaiK");
  ok(await ev(`return document.querySelectorAll("#maikBody .maik-thinking").length;`) === 0, "no provider call was started");

  // ── "Let MaiK answer" still works, and the choice is spent ──
  await ev(`${card}.querySelector("[data-maik-anyway]").click(); return 1;`); await sleep(800);
  ok(await ev(`return document.querySelectorAll("#maikBody .maik-b").length;`) >= 3, "\"Let MaiK answer\" starts the normal answer");
  ok(await ev(`return !!${card}.querySelector(".maik-dose-acts");`) === false, "and the buttons are gone once chosen");

  console.log(fails === 0 ? "\nALL GREEN — a plain dose lookup answers instantly and offers both doors" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
