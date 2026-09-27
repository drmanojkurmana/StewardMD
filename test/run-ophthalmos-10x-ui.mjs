/* Ophthalmós in the REAL app (headless Chrome): every feature synced from the module repo is wired,
 * opens, and loads its data; images come from the R2 domain; Ask MaiK reaches the host; no uncaught errors.
 * The module's own behaviour is tested in its repo (test/run-ui.mjs, 19 steps); this checks the integration.
 *
 * USAGE: node test/run-ophthalmos-10x-ui.mjs   (BASE=http://localhost:8996/ to use a running server)
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8996/").replace(/\/?$/, "/");
const PORT = 9397, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ophthalmos-10x-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8996"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(200); } return false; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; const u = (d.url || (d.stackTrace && d.stackTrace.callFrames[0] && d.stackTrace.callFrames[0].url) || ""); if (/ophthalmos/.test(u) || /ophthalmos|OPHTHALMOS/.test(JSON.stringify(d))) errors.push((d.exception && d.exception.description) || d.text); }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: BASE });
  ok(await until(`return !!(window.OPHTHALMOS && OPHTHALMOS._renderHub && window.SMD_showHome);`, 30000), "app loads with Ophthalmós");
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); try{localStorage.removeItem("smd_ophthalmos_v1");}catch(e){} return 1;`);

  // registries: every feature file registered itself
  ok(await ev(`return OPHTHALMOS._sims.map(function(s){return s.id;}).join(",");`) === "retino,neuro", "simulators registered: retinoscopy, neuro-ophthalmology");
  ok(await ev(`return OPHTHALMOS._banks.length === 1 && OPHTHALMOS._reads.length === 1 && OPHTHALMOS._tools.length === 6;`) === true, "question bank, notes and six calculators registered");

  // hub: Today's plan and every section
  await ev(`SMD_showHome(); OPHTHALMOS.open(); return 1;`);
  ok(await until(`return document.querySelectorAll("#smdOphthalmos .oph-clinic[data-t]").length === 5;`, 20000), "hub lists the five clinics");
  ok(await ev(`return document.querySelectorAll("#smdOphthalmos .oph-plan-row").length === 3;`) === true, "Today's plan: images, questions, one simulator patient");
  ok(await ev(`return ["Questions","Notes","Simulators","Tools"].every(function(h){return [].some.call(document.querySelectorAll("#smdOphthalmos .oph-h2"), function(e){return e.textContent===h;});});`) === true, "hub sections: Questions, Notes, Simulators, Tools");
  ok(await ev(`return !!document.querySelector("#smdOphthalmos .oph-draft");`) === true, "draft mark on the hub");

  // an encounter: the image comes from R2, Ask MaiK reaches the host after answering
  await ev(`document.querySelector('#smdOphthalmos [data-act=clinic][data-t=oct]').click(); return 1;`);
  ok(await until(`var i=document.getElementById("ophImg"); return !!(i && i.naturalWidth > 0 && /ophthalmos-img\\.stewardmd\\.in/.test(i.currentSrc||i.src));`, 20000), "encounter image loads from ophthalmos-img.stewardmd.in");
  await ev(`document.querySelectorAll('#smdOphthalmos .oph-ans')[1].click(); return 1;`);
  ok(await until(`return !!document.querySelector('#ophNote [data-act=maik]');`), "Ask MaiK offered after the encounter is signed (host has SMD_askMaik)");
  await ev(`OPHTHALMOS.back(); return 1;`);

  // question bank: the 2.5 MB deck loads
  await ev(`document.querySelector('#smdOphthalmos [data-act=bank][data-b=mcq]').click(); return 1;`);
  ok(await until(`return document.querySelectorAll('#smdOphthalmos .mcq-topic').length === 10;`, 20000), "question bank loads 3,035 questions in ten subspecialties");
  await ev(`OPHTHALMOS.back(); return 1;`);

  // notes: list, then a note with a real image
  await ev(`document.querySelector('#smdOphthalmos [data-act=read]').click(); return 1;`);
  ok(await until(`return OPHTHALMOS._st.view === "notes" && document.querySelectorAll('#smdOphthalmos [data-act=note]').length === 30;`, 15000), "notes list opens with 30 notes");
  await ev(`document.querySelector('#smdOphthalmos [data-act=note]').click(); return 1;`);
  ok(await until(`return OPHTHALMOS._st.view === "note" && [].some.call(document.querySelectorAll('#smdOphthalmos img'), function(i){ return i.naturalWidth > 0; });`, 20000), "a note opens with a real image from R2");
  await ev(`OPHTHALMOS.back(); OPHTHALMOS.back(); return 1;`);
  await until(`return OPHTHALMOS._st.view === "hub";`);

  // simulators and tools open
  await ev(`document.querySelector('#smdOphthalmos [data-act=sim][data-s=retino]').click(); return 1;`);
  ok(await until(`return !!document.getElementById("retCv") && OPHTHALMOS._st.view === "sim-retino";`), "retinoscopy opens with its canvas");
  await ev(`OPHTHALMOS.back(); return 1;`);
  await ev(`document.querySelector('#smdOphthalmos [data-act=sim][data-s=neuro]').click(); return 1;`);
  ok(await until(`return OPHTHALMOS._st.view === "neuro" && !!document.querySelector("#smdOphthalmos canvas");`), "neuro-ophthalmology opens with its canvas");
  await ev(`OPHTHALMOS.back(); return 1;`);
  await ev(`document.querySelector('#smdOphthalmos [data-act=tools]').click(); return 1;`);
  ok(await until(`return document.querySelectorAll('#smdOphthalmos [data-act=tool]').length === 6;`), "clinical calculators list opens with six tools");
  await ev(`OPHTHALMOS.close(); return 1;`);

  ok(errors.length === 0, "no uncaught Ophthalmós errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  console.log(fails === 0 ? "\nALL GREEN — Ophthalmós 10x wired into the app" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
