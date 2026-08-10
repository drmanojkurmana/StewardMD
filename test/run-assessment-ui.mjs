/* Assessment-form autofill UI test (real headless Chrome, CDP).
 * Proves the actual "EMR boxes" fill from voice: doctor-dictated vitals/exam populate the
 * GHIS-mirrored fields, a manual edit is NOT overwritten by a later voice value (conflict
 * surfaced), and a patient-reported objective value is dropped. No mic — scripted transcripts
 * driven through the SAME production modules the app loads.
 *   node test/run-assessment-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9384, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/assess-ui-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "assessment-harness.html");

const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--allow-file-access-from-files"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };

  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: URL });
  let ready = false;
  for (let i = 0; i < 40; i++) { await sleep(200); if (await ev(`return !!(window.__runScenario && window.SMD_ASSESSFORM);`) === true) { ready = true; break; } }
  ok(ready, "harness + production modules loaded (SMD_ASSESSFORM ready)");

  const rJson = await ev(`return JSON.stringify(window.__runScenario());`);
  const R = JSON.parse(rJson || "{}");
  if (R.__err) { console.error("scenario error:", R.__err); process.exitCode = 1; }

  ok(R.formFields >= 50, `form renders the GHIS field set (${R.formFields} fields)`);
  // 1) voice filled the actual boxes
  const a = R.afterVitals || {};
  ok(a.bpSys === "100" && a.bpDia === "60", `BP boxes filled from voice (${a.bpSys}/${a.bpDia})`);
  ok(a.pulse === "88", `pulse box filled (${a.pulse})`);
  ok(a.temp === "101", `temperature box filled (${a.temp})`);
  ok(a.tenderness === "No", "abdomen tenderness set to No (soft, non-tender)");
  ok(a.murmurs === "No", "CVS murmurs set to No");
  ok(a.breathSounds === "Vesicular", "breath sounds set to Vesicular");
  ok(a.loc === "Conscious" && a.orientation === "Yes", "CNS consciousness/orientation set");
  ok(a.pallor === false, "pallor checkbox left unchecked (no pallor)");
  ok(/Voice/.test(a.bpChip || ""), `filled field shows a Voice source chip ("${a.bpChip}")`);

  // 2) manual edit protected
  const e = R.afterEdit || {};
  ok(e.bpSys === "130", `manual edit (130) NOT overwritten by later voice 100 (is ${e.bpSys})`);
  ok(/kept 130/.test(e.bpChip || ""), `conflict surfaced on the edited field ("${e.bpChip}")`);

  // 3) patient-reported objective dropped
  ok((R.ptDropped || []).indexOf("bpSys") >= 0, "patient-reported BP dropped (not written to vitals)");

  console.log(fails ? `\n${fails} check(s) failed` : "\nAll assessment-UI checks passed");
} catch (x) { console.error(x); process.exitCode = 1; fails++; }
finally { try { ws && ws.close(); } catch {} try { chrome.kill("SIGKILL"); } catch {} if (fails) process.exitCode = 1; }
