/* StewardMD Edge Wave 1 (flag smd_edge): MaiK's typed router with a MOCK on-device engine.
 * Asserts the five read-only workflows answer with a card and zero cloud calls, that every pass
 * (option 0, slow engine, flag off, "Ask MaiK anyway") continues on the normal path, and that the
 * model only ever picks among deterministic candidates. Real headless browser against the real app.
 * USAGE: BASE=http://localhost:8996/ CHROME=<chrome binary> node test/run-maik-edge-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8996/").replace(/\/?$/, "/");
const PORT = 9417, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/maik-edge-chrome-" + Date.now();
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
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 75; i++) { await sleep(400); if (await ev(`return !!(window.SMD_askMaik && window.SMD_EDGE && window.SMD_EDGE_RUNTIME && window.MEDCALC && window.SMD_SEARCH)`) === true) { ready = true; break; } }
  ok(ready, "the app, MaiK and the Edge router load");
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
  // Cloud calls are counted and refused (offline), so a pass-through visibly reaches the normal path.
  await ev(`window.__aiCalls = 0; var _f = window.fetch; window.fetch = function (u, o) { if (/\/api\/ai\/(explain|refine|route|extract|research|summary|maik)/.test(String(u))) { window.__aiCalls++; return Promise.reject(new Error("offline in test")); } return _f.apply(this, arguments); }; return 1;`);
  // Mock engine: picks the option whose line matches window.__pick (a regex source), 0 if none.
  await ev(`window.__pick = null; window.__engineCalls = 0; window.__delay = 5;
    SMD_EDGE.setEngine({ available: function(){return true;}, load: function(){return Promise.resolve();}, reset: function(){return Promise.resolve();}, release: function(){return Promise.resolve();},
      complete: function (task) { window.__engineCalls++; window.__lastPrompt = task.prompt;
        var opt = 0; if (window.__pick) { var ls = task.prompt.split("\\n"); for (var i=0;i<ls.length;i++) if (new RegExp(window.__pick).test(ls[i])) { opt = parseInt(ls[i],10)||0; break; } }
        return new Promise(function (r) { setTimeout(function () { r({ type: "call", function_calls: [{ name: "choose_option", arguments: { option: opt } }], confidence: 0.9 }); }, window.__delay); }); } });
    return 1;`);
  // Each send starts with no live topic: a repeated question would otherwise be a follow-up on the
  // previous answer (MaiK continuity), which by design runs before Edge.
  const send = async (q, wait) => { await ev(`try { __MAIK_TEST.setTopic(null); } catch (e) {} var q=document.getElementById("maikQ"); q.value=${JSON.stringify(q)}; q.dispatchEvent(new Event("input",{bubbles:true})); document.getElementById("maikSend").click(); return 1;`); await sleep(wait || 1200); };
  const lastAi = () => ev(`var b=[].slice.call(document.querySelectorAll("#maikBody .maik-b.ai")).pop(); return b ? b.innerHTML : "";`);
  const countEdge = () => ev(`return document.querySelectorAll("#maikBody .maik-edge").length;`);
  const countAi = () => ev(`return document.querySelectorAll("#maikBody .maik-b.ai").length;`);
  const passed = () => ev(`var s=SMD_EDGE.stats(); return s.none + s.passed;`);

  // ── flag OFF: nothing changes ──
  await ev(`localStorage.removeItem("smd_edge"); return 1;`);
  await openMaik();
  await ev(`window.__pick = "open: Antibiogram"; return 1;`);
  await send("show me the resistance patterns antibiogram", 1500);
  ok(await countEdge() === 0 && await ev(`return window.__engineCalls;`) === 0, "flag OFF: no Edge card and the engine is never called");

  // ── flag ON: tool workflow ──
  await ev(`localStorage.setItem("smd_edge","1"); window.__aiCalls = 0; return 1;`);
  await openMaik();
  await send("show me the resistance patterns antibiogram");
  const toolCard = String(await lastAi());
  ok(/data-maik-tool="antibiogram"/.test(toolCard), "Edge answers with an 'Open Antibiogram' card");
  ok(/data-maik-edgeask/.test(toolCard), "with an 'Ask MaiK anyway' escape");
  ok(await ev(`return window.__aiCalls;`) === 0, "ZERO cloud calls");
  ok(/Options:/.test(String(await ev(`return window.__lastPrompt;`))) && /0\. none of these/.test(String(await ev(`return window.__lastPrompt;`))), "the engine saw numbered deterministic options plus 'none'");

  // ── calculator with values: rules layer, no model call, prefilled ──
  const callsBefore = await ev(`return window.__engineCalls;`);
  await send("crcl 72F 58kg cr 1.4");
  const calcCard = String(await lastAi());
  ok(/maik-calc-pf/.test(calcCard) && /33 mL\/min/.test(calcCard), "a calculator request is answered by the rules layer with prefill (CrCl 33)");
  ok(await ev(`return window.__engineCalls;`) === callsBefore, "and the model was not called for it");
  ok(!/maik-edge-sib/.test(calcCard), "CrCl has no confusable sibling: no version row");

  // ── score versions (edge-schemas.js): MELD 3.0 offers MELD and MELD-Na, each prefilled from the same words ──
  await send("meld 3.0 bili 3.2 inr 1.8 creat 2.1 na 128 alb 2.8");
  const meldCard = String(await lastAi());
  ok(/maik-edge-sib/.test(meldCard) && /Other versions/.test(meldCard) && /data-maik-calc="meld_na"/.test(meldCard) && /data-maik-calc="meld"/.test(meldCard),
    "a MELD 3.0 card offers the other MELD versions");
  // The chip closes MaiK and opens the calculator 180 ms later: keep the stub in place until it fires.
  await ev(`window.__opened = null; window.__realOpen = MEDCALC.open; MEDCALC.open = function (id, pf) { window.__opened = { id: id, pf: pf || null }; };
    var b = document.querySelectorAll('.maik-edge-sib [data-maik-calc="meld_na"]'); b = b[b.length - 1]; b.click(); return 1;`);
  await sleep(600);
  const op = JSON.parse((await ev(`MEDCALC.open = window.__realOpen; return JSON.stringify(window.__opened);`)) || "null");
  await openMaik();
  ok(op && op.id === "meld_na" && op.pf && Object.keys(op.pf).length >= 3, "tapping MELD-Na opens MELD-Na with the values re-read for its inputs (" + (op && op.pf ? Object.keys(op.pf).join(",") : "none") + ")");

  // ── ICD workflow ──
  await send("icd code for type 2 diabetes mellitus", 2500);
  const icdCard = String(await lastAi());
  ok(/ICD-10 codes for/.test(icdCard) && /data-maik-icd=/.test(icdCard) && /E11/.test(icdCard), "an ICD request lists real codes from the offline index (E11...)");

  // ── pass-through: engine says none ──
  await ev(`window.__pick = null; window.__aiCalls = 0; return 1;`);
  const edgeBefore = await countEdge(), aiBefore = await countAi(), passBefore = await passed();
  await send("what is the treatment of community acquired pneumonia", 2500);
  ok(await countEdge() === edgeBefore, "option 0: no Edge card");
  ok(await passed() > passBefore && await countAi() > aiBefore, "and the question continues to the normal MaiK path (an answer bubble appears)");

  // ── pass-through: slow engine (deadline) ──
  await ev(`window.__pick = "open: Antibiogram"; window.__delay = 4000; window.__aiCalls = 0; return 1;`);
  const aiB2 = await countAi(), edgeB2 = await countEdge(), passB2 = await passed();
  await send("show me the resistance patterns antibiogram", 2200);
  ok(await passed() > passB2 && await countEdge() === edgeB2 && await countAi() > aiB2, "a stuck engine does not block: the normal path answers within the deadline (well before the 4 s engine)");
  await sleep(2500); await ev(`window.__delay = 5; return 1;`);

  // ── Ask MaiK anyway from an Edge card ──
  await openMaik();
  await ev(`window.__pick = "open: Antibiogram"; return 1;`);
  await send("show me the resistance patterns antibiogram");
  const before2 = await countEdge(), aiB3 = await countAi(), modelB3 = await ev(`return SMD_EDGE.stats().model;`);
  const youB3 = await ev(`return document.querySelectorAll("#maikBody .maik-b.you").length;`);
  await ev(`[].slice.call(document.querySelectorAll("#maikBody [data-maik-edgeask]")).pop().click(); return 1;`); await sleep(5000);
  const ce = await countEdge(), ca = await countAi(), cm = await ev(`return SMD_EDGE.stats().model;`);
  ok(ce === before2 && ca > aiB3 && cm === modelB3, "'Ask MaiK anyway' skips Edge once (no model call) and reaches the normal path (" + [before2, ce, aiB3, ca, modelB3, cm].join(",") + ")");

  // ── the tool chip opens the module ──
  await openMaik();
  await send("show me the resistance patterns antibiogram");
  await ev(`[].slice.call(document.querySelectorAll('#maikBody [data-maik-tool="antibiogram"]')).pop().click(); return 1;`); await sleep(900);
  ok(await ev(`var s=document.getElementById("maikSheet"); return !s || !s.classList.contains("on") || getComputedStyle(s).display==="none" || s.offsetParent===null;`) === true, "tapping the chip closes MaiK and hands off to the module");

  await ev(`localStorage.removeItem("smd_edge"); return 1;`);
  console.log(fails === 0 ? "\nALL GREEN — Edge routes typed requests on-device, and always lets the doctor continue" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
