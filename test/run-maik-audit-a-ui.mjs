/* MaiK audit fixes, batch A (2026-09-25) — real headless browser.
 *
 * T05 length pill has its own composer cell; T03 a cloud answer after Stop is dropped; T18 a network
 * failure answers from the on-device Knowledge Base; T04 the ranked-evidence block carries real text;
 * T17 Detailed sends no tier 1 and shows no "Know more"; T21 "dose?" asks for the regimen's doses;
 * T22 a reopened conversation has its topic back. SMD_AI's cloud calls are stubbed: no network.
 *
 * USAGE: node test/run-maik-audit-a-ui.mjs [--shot <dir>]
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, mkdirSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8995/").replace(/\/?$/, "/");
const PORT = 9395, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/maik-audit-a-chrome-" + Date.now();
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOT = (process.argv.includes("--shot") ? process.argv[process.argv.indexOf("--shot") + 1] : "");
if (SHOT) mkdirSync(SHOT, { recursive: true });

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8995"])[1];
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
// Cloud stub: every call is recorded; the answer is released by the test (window.__settle) or at once.
const STUB = (mode) => `window.__calls = []; window.__settle = null;
  var st = function (pkg, opts) { window.__calls.push({ q: pkg && pkg.question, tier: opts && opts.tier, depth: opts && opts.depth, regen: opts && opts.regen, evid: pkg && pkg.evidenceBundle ? JSON.stringify(pkg.evidenceBundle) : "" });
    ${mode === "hold" ? `return new Promise(function (res) { window.__settle = res; });`
      : mode === "neterr" ? `return Promise.resolve({ error: "TypeError: Failed to fetch" });`
      : `return Promise.resolve({ text: "First-line therapy for hypertension is amlodipine 5 mg once daily or losartan 50 mg once daily.\\n- Amlodipine 5 mg daily\\n- Losartan 50 mg daily", mode: "grounded" });`} };
  window.SMD_AI.explainGrounded = st; window.SMD_AI.explainGroundedStream = function (pkg, opts, onDelta) { return st(pkg, opts); }; return 1;`;
const ask = (q) => ev(`var e = document.getElementById("maikQ"); e.value = ${JSON.stringify(q)}; e.dispatchEvent(new Event("input", { bubbles: true })); document.getElementById("maikSend").click(); return 1;`);
const waitCalls = async (n) => { for (let i = 0; i < 50; i++) { await sleep(250); if ((await ev(`return (window.__calls || []).length`)) >= n) return true; } return false; };

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
  for (let i = 0; i < 75; i++) { await sleep(400); if (await ev(`return !!(window.SMD_askMaik && window.SMD_AI)`) === true) { ready = true; break; } }
  ok(ready, "the app and MaiK load");
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); localStorage.setItem("smd_device_id","audita"); return 1;`);
  await ev(`SMD_askMaik(""); return 1;`); await sleep(1300);

  // T05: the pill is whole and clear of its neighbours at two phone widths.
  for (const w of [390, 320]) {
    await call("Emulation.setDeviceMetricsOverride", { width: w, height: 844, deviceScaleFactor: 2, mobile: true }); await sleep(250);
    const m = JSON.parse(await ev(`var p = document.getElementById("maikLen"), r = document.getElementById("maikResearch"), c = document.getElementById("maikModelChip");
      var pr = p.getBoundingClientRect(), rr = r ? r.getBoundingClientRect() : null, cr = c ? c.getBoundingClientRect() : null;
      return JSON.stringify({ w: Math.round(pr.width), h: p.offsetHeight, clip: p.scrollWidth - p.clientWidth, overR: rr ? (pr.left < rr.right - 1) : false, overC: cr ? (pr.right > cr.left + 1) : false, txt: p.textContent });`));
    ok(m.clip <= 1 && !m.overR && !m.overC && m.h >= 44, `${w}px: the length pill "${m.txt}" is whole (${m.w}px wide, ${m.h}px tall) and overlaps neither the research button nor the model chip`);
    await shot("composer-" + w);
  }
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  // T04 + T21 + T22 need a grounded answer first.
  await ev(STUB("answer")); await ask("treatment of hypertension");
  ok(await waitCalls(1), "a clinical question reaches the (stubbed) cloud call");
  const c1 = JSON.parse(await ev(`return JSON.stringify(window.__calls[0])`));
  ok(!/\[object Object\]/.test(c1.evid), `the ranked-evidence block carries real text (${c1.evid ? c1.evid.length + " chars" : "no bundle"})`);
  await sleep(800);
  await ev(STUB("answer")); await ask("dose?");
  ok(await waitCalls(1), "the follow-up reaches the cloud call");
  const c2 = JSON.parse(await ev(`return JSON.stringify(window.__calls[0])`));
  ok(/doses for the first-line regimen for/i.test(c2.q || ""), `"dose?" asks for the regimen's doses ("${(c2.q || "").slice(0, 80)}")`);
  await sleep(800);

  // T17: Detailed sends no tier 1 and renders no "Know more".
  await ev(`localStorage.setItem("smd_maik_len","long"); return 1;`);
  await ev(STUB("answer")); await ask("management of heart failure");
  await waitCalls(1); await sleep(900);
  const c3 = JSON.parse(await ev(`return JSON.stringify(window.__calls[0])`));
  ok(c3.depth === "detailed" && !c3.tier, `Detailed asks for the whole answer in one call (depth ${c3.depth}, tier ${c3.tier})`);
  const knowN = await ev(`var a = document.querySelectorAll("#maikBody .maik-b.ai"); return a[a.length - 1].querySelectorAll(".maik-know").length;`);
  ok(knowN === 0, "a Detailed answer shows no \"Know more\"");
  await ev(`localStorage.setItem("smd_maik_len","medium"); return 1;`);

  // T03: Stop, then the answer lands: it must not render or unlock anything.
  await ev(STUB("hold")); await ask("treatment of community acquired pneumonia");
  await waitCalls(1); await sleep(300);
  await ev(`document.getElementById("maikSend").click(); return 1;`); await sleep(300);
  const aiN = await ev(`return document.querySelectorAll("#maikBody .maik-b.ai").length`);
  await ev(`window.__settle && window.__settle({ text: "LATE CLOUD ANSWER after stop", mode: "grounded" }); return 1;`); await sleep(700);
  ok(!/LATE CLOUD ANSWER/.test(await ev(`return document.getElementById("maikBody").textContent`)), "a cloud answer that lands after Stop is dropped");
  ok(await ev(`return document.querySelectorAll("#maikBody .maik-b.ai").length`) === aiN, "no extra bubble appears after Stop");
  ok(await ev(`return document.getElementById("maikSend").classList.contains("stopping")`) === false, "the composer is free after Stop");

  // T18: a network failure answers from the on-device Knowledge Base.
  await ev(STUB("neterr")); await ask("management of acute pancreatitis");
  await waitCalls(1); await sleep(1200);
  const last = await ev(`var a = document.querySelectorAll("#maikBody .maik-b.ai"); return a[a.length - 1].textContent`);
  ok(!/unavailable|lost its network/i.test(last) && last.length > 80, `a network failure answers from the Knowledge Base ("${last.replace(/\s+/g, " ").slice(0, 70)}...")`);
  await shot("kb-fallback");

  // T22: reopen the conversation from the sidebar: the topic comes back.
  await ev(`__MAIK_TEST.setTopic(null); return 1;`);
  await ev(`document.getElementById("maikClose").click(); return 1;`); await sleep(600);
  await ev(`SMD_askMaik(""); return 1;`); await sleep(1200);
  const topic = await ev(`var t = __MAIK_TEST.getTopic(); return t ? t.topic : "";`);
  ok(!!topic, `a reopened conversation has its topic back ("${topic}")`);

  console.log(fails === 0 ? "\nALL GREEN: audit batch A behaves in a real browser" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
