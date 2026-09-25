/* MaiK: Knowledge Base preview while the model writes, and one figure search per topic
 * (audit sections 7 and 8, 2026-09-25) — real headless browser. SMD_AI's cloud calls are stubbed.
 *
 * An exact Knowledge Base match shows at once as a labelled preview; the first streamed words replace
 * it; a failed model call keeps it as the answer; Stop keeps it; flag "0" turns it off. Figures: a
 * follow-up on the same topic does not search again.
 *
 * USAGE: BASE=http://localhost:8986/ node test/run-maik-kbpreview-ui.mjs [--shot <dir>]
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, mkdirSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8986/").replace(/\/?$/, "/");
const PORT = 9396, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/maik-kbpreview-chrome-" + Date.now();
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOT = (process.argv.includes("--shot") ? process.argv[process.argv.indexOf("--shot") + 1] : "");
if (SHOT) mkdirSync(SHOT, { recursive: true });

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8986"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const shot = async (name) => { if (!SHOT) return; const { result: { data } } = await call("Page.captureScreenshot", { format: "png" }); writeFileSync(join(SHOT, name + ".png"), Buffer.from(data, "base64")); };
// Held cloud stub: the test streams words (window.__delta) and settles the answer (window.__settle).
const HOLD = `window.__calls = []; window.__settle = null; window.__delta = null;
  var st = function (pkg, opts, onDelta) { window.__calls.push({ q: pkg && pkg.question }); window.__delta = onDelta || null; return new Promise(function (res) { window.__settle = res; }); };
  window.SMD_AI.explainGrounded = function (pkg, opts) { return st(pkg, opts, null); }; window.SMD_AI.explainGroundedStream = st;
  window.__figN = 0; window.SMD_AI.figures = function (q) { window.__figN++; return Promise.resolve({ figures: [] }); }; return 1;`;
const ask = (q) => ev(`var e = document.getElementById("maikQ"); e.value = ${JSON.stringify(q)}; e.dispatchEvent(new Event("input", { bubbles: true })); document.getElementById("maikSend").click(); return 1;`);
const waitCalls = async (n) => { for (let i = 0; i < 50; i++) { await sleep(200); if ((await ev(`return (window.__calls || []).length`)) >= n) return true; } return false; };
const lastAI = `var a = document.querySelectorAll("#maikBody .maik-b.ai"), h = a[a.length - 1];`;
const newChat = async () => { await ev(`__MAIK_TEST.clearCache(); var n = document.getElementById("maikNew"); if (n) n.click(); return 1;`); await sleep(500); };

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
  for (let i = 0; i < 75; i++) { await sleep(400); if (await ev(`return !!(window.SMD_askMaik && window.SMD_AI && window.MaiKKB)`) === true) { ready = true; break; } }
  ok(ready, "the app, MaiK and the Knowledge Base load");
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); localStorage.setItem("smd_device_id","kbprev"); localStorage.removeItem("smd_maik_kb_preview"); return 1;`);
  await ev(`SMD_askMaik(""); return 1;`); await sleep(1300);

  // Find a question the strict gate accepts (exact, unambiguous disease name).
  const CANDIDATES = ["acute pancreatitis", "community acquired pneumonia", "diabetic ketoacidosis", "hypertension", "asthma"];
  let Q = "";
  for (const q of CANDIDATES) {
    await ev(HOLD); await ask(q);
    await waitCalls(1); await sleep(300);
    const has = await ev(`${lastAI} return !!(h && h.querySelector(".maik-kbpreview"));`);
    await ev(`window.__settle && window.__settle({ text: "Model answer for the test.", mode: "grounded" }); return 1;`); await sleep(700);
    if (has) { Q = q; break; }
  }
  ok(!!Q, `an exact disease question shows the Knowledge Base preview while the model writes ("${Q}")`);

  if (Q) {
    // Preview -> streamed words replace it -> final answer has no preview.
    await newChat(); await ev(HOLD); await ask(Q); await waitCalls(1); await sleep(300);
    const pv = JSON.parse(await ev(`${lastAI} var p = h.querySelector(".maik-kbpreview"); return JSON.stringify({ lbl: p ? p.querySelector(".maik-kbpreview-h").textContent : "", len: p ? p.textContent.length : 0 });`));
    ok(/MaiK is writing the full answer/.test(pv.lbl) && pv.len > 80, `the preview is labelled and has content (${pv.len} chars)`);
    await shot("preview");
    await ev(`window.__delta && window.__delta("Streaming words from the model"); return 1;`); await sleep(200);
    const st = await ev(`${lastAI} return (h.querySelector(".maik-kbpreview") ? "preview" : "") + "|" + (h.querySelector(".maik-streaming") ? h.querySelector(".maik-streaming").textContent : "");`);
    ok(/^\|Streaming words/.test(st), `the first streamed words replace the preview (${st.slice(0, 50)})`);
    await ev(`window.__settle({ text: "Final model answer about the topic.", mode: "grounded" }); return 1;`); await sleep(800);
    const fin = await ev(`${lastAI} return (h.querySelector(".maik-kbpreview") ? "preview " : "") + h.textContent;`);
    ok(!/^preview/.test(fin) && /Final model answer/.test(fin), "the final answer replaces everything");

    // A failed model call keeps the preview as the answer.
    await newChat(); await ev(HOLD); await ask(Q); await waitCalls(1); await sleep(300);
    await ev(`window.__settle({ error: "server 500" }); return 1;`); await sleep(900);
    const er = await ev(`${lastAI} return (h.querySelector(".maik-conf") ? "conf " : "") + h.textContent;`);
    ok(/^conf /.test(er) && !/unavailable|could not|error/i.test(er.slice(0, 200)), `a failed model call keeps the Knowledge Base answer ("${er.replace(/\s+/g, " ").slice(5, 75)}...")`);

    // Stop during the preview keeps it and frees the composer.
    await newChat(); await ev(HOLD); await ask(Q); await waitCalls(1); await sleep(300);
    await ev(`document.getElementById("maikSend").click(); return 1;`); await sleep(300);
    const sp = JSON.parse(await ev(`${lastAI} var p = h.querySelector(".maik-kbpreview"); return JSON.stringify({ p: !!p, lbl: p ? p.querySelector(".maik-kbpreview-h").textContent : "", stopped: !!h.querySelector(".maik-stopped"), busy: document.getElementById("maikSend").classList.contains("stopping") });`));
    ok(sp.p && sp.stopped && !/writing/.test(sp.lbl) && !sp.busy, `Stop keeps the preview, marks it stopped and frees the composer (${JSON.stringify(sp)})`);
    await ev(`window.__settle({ text: "LATE", mode: "grounded" }); return 1;`); await sleep(400);

    // Flag off: no preview.
    await ev(`localStorage.setItem("smd_maik_kb_preview","0"); return 1;`);
    await newChat(); await ev(HOLD); await ask(Q); await waitCalls(1); await sleep(300);
    ok(await ev(`${lastAI} return !h.querySelector(".maik-kbpreview");`) === true, "smd_maik_kb_preview = 0 turns the preview off");
    await ev(`window.__settle({ text: "Answer.", mode: "grounded" }); localStorage.removeItem("smd_maik_kb_preview"); return 1;`); await sleep(600);
  }

  // Figures: the same topic twice in a session searches once; a new topic searches again.
  await newChat();
  await ev(HOLD); await ask("treatment of heart failure"); await waitCalls(1); await ev(`window.__settle({ text: "Answer one.", mode: "grounded" }); return 1;`); await sleep(900);
  const f1 = await ev(`return window.__figN`);
  await ev(`var n = window.__figN; ${HOLD.replace("window.__figN = 0;", "")} window.__figN = n; return 1;`);
  await ask("treatment of heart failure"); await waitCalls(1); await ev(`window.__settle({ text: "Answer two.", mode: "grounded" }); return 1;`); await sleep(900);
  const f2 = await ev(`return window.__figN`);
  ok(f1 === 1 && f2 === 1, `a repeated topic does not search for figures again (${f1} then ${f2})`);

  console.log(fails === 0 ? "\nALL GREEN: Knowledge Base preview and figure memo behave in a real browser" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
