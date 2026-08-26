/* MaiK "Refine for this patient" chips — real headless browser.
 *
 * Reported: (1) a chip demanded a typed value even when the factor is a lens, not a number, and
 * (2) a patient who is 71, hypo-prone and on 1.2 creatinine could only be described ONE factor at a
 * time — each arrow fired its own question, so no answer ever knew the whole patient.
 * Chips now STAGE: tap several, type a value where there is one, ask once.
 *
 * USAGE: node test/run-maik-refine-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8994/").replace(/\/?$/, "/");
const PORT = 9397, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/maik-refine-chrome-" + Date.now();
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8994"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

const BASEQ = "empiric therapy for hospital-acquired pneumonia";

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
  for (let i = 0; i < 75; i++) { await sleep(400); if (await ev(`return !!window.SMD_askMaik`) === true) { ready = true; break; } }
  ok(ready, "the app and MaiK load");
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
  await ev(`SMD_askMaik(""); return 1;`); await sleep(1200);
  ok(await ev(`return !!document.getElementById("maikBody");`) === true, "the MaiK sheet opens");
  ok(await ev(`return !!(window.__MAIK_TEST && __MAIK_TEST.refineHTML);`) === true, "the production chip renderer is reachable");

  // Render the REAL refine block the way an answer does.
  await ev(`
    var b = document.getElementById("maikBody");
    var d = document.createElement("div"); d.className = "maik-b ai";
    d.innerHTML = __MAIK_TEST.refineHTML(${JSON.stringify(BASEQ)}, ["age", "renal function", "risk of hypoglycemia"]);
    b.appendChild(d); return 1;`);
  const G = `document.querySelector("#maikBody .maik-refine")`;
  ok(await ev(`return ${G}.querySelectorAll("[data-maik-refine]").length;`) === 3, "three refine chips render");
  ok(await ev(`return ${G}.querySelector("[data-maik-askall]").hidden;`) === true, "nothing staged yet — no ask button");

  // ── tap a chip: it stages, it does not ask ──
  const bubblesBefore = await ev(`return document.querySelectorAll("#maikBody .maik-b").length;`);
  await ev(`${G}.querySelector('[data-maik-refine="age"]').click(); return 1;`); await sleep(300);
  ok(await ev(`return ${G}.querySelectorAll("[data-maik-inline]").length;`) === 1, "the chip becomes an inline field");
  ok(await ev(`return document.querySelectorAll("#maikBody .maik-b").length;`) === bubblesBefore, "tapping a chip does NOT fire a question on its own");
  ok(await ev(`return ${G}.querySelector("[data-maik-askall]").textContent.trim();`) === "Ask with 1 detail", "the commit button appears and counts");

  // ── several factors at once, one with a value, one without ──
  await ev(`var i = ${G}.querySelector('[data-maik-factor="age"] .maik-refine-inp'); i.value = "71"; i.dispatchEvent(new Event("input")); return 1;`);
  await ev(`${G}.querySelector('[data-maik-refine="renal function"]').click(); return 1;`); await sleep(200);
  await ev(`var i = ${G}.querySelector('[data-maik-factor="renal function"] .maik-refine-inp'); i.value = "creatinine 1.2"; i.dispatchEvent(new Event("input")); return 1;`);
  await ev(`${G}.querySelector('[data-maik-refine="risk of hypoglycemia"]').click(); return 1;`); await sleep(200);
  ok(await ev(`return ${G}.querySelector("[data-maik-askall]").textContent.trim();`) === "Ask with 3 details", "three factors staged together");
  ok(await ev(`return __MAIK_TEST.refineCompose(${G});`) ===
    BASEQ + " — age: 71 · renal function: creatinine 1.2 · risk of hypoglycemia",
    "all three travel in ONE question — and a factor with no value still counts");

  // ── a mis-tap is free ──
  await ev(`${G}.querySelector('[data-maik-factor="risk of hypoglycemia"] .maik-refine-x').click(); return 1;`); await sleep(200);
  ok(await ev(`return ${G}.querySelectorAll("[data-maik-inline]").length;`) === 2, "× removes a staged factor");
  ok(await ev(`return !!${G}.querySelector('[data-maik-refine="risk of hypoglycemia"]');`) === true, "and puts the chip back");
  ok(await ev(`return __MAIK_TEST.refineCompose(${G});`) === BASEQ + " — age: 71 · renal function: creatinine 1.2", "the removed factor is gone from the question");

  // ── the commit button actually asks ──
  await ev(`${G}.querySelector("[data-maik-askall]").click(); return 1;`); await sleep(900);
  ok(await ev(`return document.querySelectorAll("#maikBody .maik-b").length;`) > bubblesBefore, "the commit button starts one new answer");

  // ── the same factor is never asked for twice in one conversation ──
  // Reported: after answering "renal function: creatinine 1.2", the next answer's chips asked for
  // "renal impairment" again.
  await ev(`
    var b = document.getElementById("maikBody");
    var d = document.createElement("div"); d.className = "maik-b ai"; d.id = "refine2";
    d.innerHTML = __MAIK_TEST.refineHTML(${JSON.stringify(BASEQ)}, ["renal impairment", "age of the patient", "blood pressure"]);
    b.appendChild(d); return 1;`);
  const labels2 = await ev(`return [].slice.call(document.querySelectorAll("#refine2 [data-maik-refine]")).map(function(b){return b.getAttribute("data-maik-refine");}).join("|");`);
  ok(labels2 === "blood pressure", "an already-answered factor is not asked again (kept: " + labels2 + ")");
  ok(await ev(`return __MAIK_TEST.refineKnown("renal function status");`) === true, "the same ask in other words counts as answered");
  ok(await ev(`return __MAIK_TEST.refineKnown("blood glucose");`) === false, "a genuinely different factor still gets its chip");

  // ── a REOPENED thread is rebuilt from saved innerHTML: no per-node listeners survive that, so
  //    staging, × and the commit button must all be delegated ──
  await ev(`var b = document.getElementById("maikBody"); b.innerHTML = b.innerHTML; return 1;`); await sleep(200);
  const G2 = `document.querySelector("#maikBody .maik-refine")`;
  await ev(`var p = ${G2}.querySelector('[data-maik-factor="age"] .maik-refine-x'); if (p) p.click(); return 1;`); await sleep(200);
  ok(await ev(`return !!${G2}.querySelector('[data-maik-refine="age"]');`) === true, "× still works on a restored thread");
  await ev(`${G2}.querySelector('[data-maik-refine="age"]').click(); return 1;`); await sleep(200);
  await ev(`var i = ${G2}.querySelector('[data-maik-factor="age"] .maik-refine-inp'); i.value = "64"; i.dispatchEvent(new Event("input", {bubbles:true})); return 1;`); await sleep(200);
  ok(/Ask with \d detail/.test(await ev(`return ${G2}.querySelector("[data-maik-askall]").textContent.trim();`)), "and typing still updates the commit button");

  console.log(fails === 0 ? "\nALL GREEN — refine chips stage, compose one question, and undo cleanly" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
