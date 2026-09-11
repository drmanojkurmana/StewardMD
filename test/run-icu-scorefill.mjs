/* A greyed-out ICU score is filled IN PLACE, not by a trip to the calculator (real headless browser).
 *
 * Reported with screenshots of the ICU dashboard: "when scores are clicked it takes me or redirects
 * me calculator section why not just ask user to fill what is missing to get the score and once he
 * fills it give the score then and there".
 *
 * A score that cannot compute now opens a sheet asking ONLY for what it is missing; the answers are
 * recorded on the patient (so every other score benefits too) and the score appears immediately.
 *
 * What this pins, in the order it matters:
 *   - tapping a missing score opens the inline sheet, and does NOT open the MEDCALC overlay
 *   - it asks for exactly the missing inputs, and routes GCS to the E/V/M sheet rather than a box
 *   - an impossible value is refused and NOTHING is written (manual vitals entry normally goes
 *     through the import review sheet; this is what replaces that guard here)
 *   - filling it records the values and the score computes on the spot
 *
 * USAGE: node test/run-icu-scorefill.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8938/").replace(/\/?$/, "/");
// A FRESH profile per run: a fixed dir keeps localStorage between runs and a stale patient makes
// these assertions pass or fail depending on what the PREVIOUS run left behind.
const PORT = 9338, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/icu-scorefill-chrome-" + Date.now();
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8938"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
const clickAct = async (act) => { await ev(`var b=document.querySelector('[data-icu-act="${act}"]'); if(b) b.click(); return 1;`); await sleep(350); };
const sheetText = async () => (await ev(`var m=document.getElementById("icuModal"); return (m && m.classList.contains("on")) ? (m.innerText||"") : "";`)) || "";
const setField = async (key, val) => ev(`var i=document.querySelector('[data-sf="${key}"]'); if(i){ i.value=${JSON.stringify(String(val))}; } return 1;`);
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

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
  for (let i = 0; i < 75; i++) { await sleep(400); if (await ev(`return !!(window.ICU && ICU.open && window.ICU_AUTOSCORES)`) === true) { ready = true; break; } }
  ok(ready, "app loads with the ICU dashboard and the score engine");
  await ev(`["introPoster","splash","accountGate","introOverlay"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
  await ev(`try{localStorage.setItem("smd_icu_groups","0");}catch(e){} return 1;`);

  // A patient with NO vitals recorded: qSOFA needs RR, SBP and GCS, so it renders greyed out.
  await ev(`ICU.reset(); ICU.ingestPatient({name:"SCOREPT",age:64,sex:"M",bed:"7",diagnosis:"Sepsis"}); ICU.open('overview'); return 1;`);
  await sleep(900);
  ok(await ev(`return !!document.querySelector('[data-icu-act="scorefill:qsofa"]');`) === true,
    "a score that cannot compute is tappable to fill it in (scorefill:), not a calculator link");
  ok(await ev(`return !document.querySelector('.icu-score.miss[data-icu-act^="calc:"]');`) === true,
    "no missing score still routes to the calculator redirect");

  // ---- opening it asks for exactly what is missing, in place ----
  await clickAct("scorefill:qsofa");
  const s1 = await sheetText();
  ok(/qSOFA/i.test(s1), "the inline sheet opens for that score");
  ok(await ev(`var o=document.getElementById("mcOverlay"); return !!(o && getComputedStyle(o).display!=="none" && o.offsetWidth>0);`) !== true,
    "the full calculator (MEDCALC) is NOT opened");
  ok(await ev(`return !!document.querySelector('[data-sf="monitor:rr"]') && !!document.querySelector('[data-sf="monitor:sbp"]');`) === true,
    "it asks for the missing vitals (RR, SBP)");
  ok(await ev(`return !document.querySelector('[data-sf="monitor:gcs"]');`) === true,
    "GCS is NOT a free number box");
  ok(await ev(`return !!document.querySelector('[data-icu-act="sfgcs"]');`) === true,
    "GCS routes to the E/V/M sheet instead");
  ok(await ev(`return !!document.querySelector('[data-sf="labs:creat"]');`) !== true,
    "it does not ask for inputs this score never needed");

  // ---- an impossible value is refused, and nothing is written ----
  await setField("monitor:rr", "500");       // no one breathes 500/min - this is a typo, not a patient
  await setField("monitor:sbp", "96");
  await clickAct("sfsave");
  const s2 = await sheetText();
  ok(/outside the possible range/i.test(s2), "an impossible value is refused with the reason");
  ok(await ev(`return (ICU.state().vitals||[]).length;`) === 0, "nothing is recorded while a value is impossible");
  ok(await ev(`return !!document.querySelector('[data-sf="monitor:rr"]');`) === true, "the sheet stays open to be corrected");
  ok(await ev(`var i=document.querySelector('[data-sf="monitor:sbp"]'); return i? i.value : "";`) === "96",
    "the other answers are not lost when one is rejected");

  // ---- correct it, score GCS through its own sheet, and the values survive the round trip ----
  await setField("monitor:rr", "24");
  await clickAct("sfgcs");
  ok(/Glasgow Coma Scale/i.test(await sheetText()), "the GCS sheet opens from the fill sheet");
  await clickAct("gcspick:e:3"); await clickAct("gcspick:v:4"); await clickAct("gcspick:m:5");
  await clickAct("gcssave");
  ok(await ev(`var v=ICU.state().vitals||[]; return v.length && v[v.length-1].gcs;`) === 12, "GCS 12 is charted from E3+V4+M5");
  const s3 = await sheetText();
  ok(/qSOFA/i.test(s3), "it returns to the score sheet after GCS, rather than dropping the clinician on the overview");
  ok(await ev(`var i=document.querySelector('[data-sf="monitor:rr"]'); return i? i.value : "";`) === "24",
    "the values typed before scoring GCS are still there");

  // ---- saving records the vitals and the score computes on the spot ----
  await clickAct("sfsave");
  const st = JSON.parse(await ev(`
    var v=ICU.state().vitals||[], last={}; for(var i=0;i<v.length;i++){ for(var k in v[i]) if(v[i][k]!=null) last[k]=v[i][k]; }
    var sc=(ICU.state().scores||[]).filter(function(x){return x.id==="qsofa";})[0]||{};
    return JSON.stringify({rr:last.rr, sbp:last.sbp, gcs:last.gcs, missing:sc.missing||null, value:sc.value});`));
  ok(st.rr === 24 && st.sbp === 96, "the answers are recorded on the patient (RR 24, SBP 96) " + JSON.stringify(st));
  ok(st.missing === null, "qSOFA is no longer missing inputs");
  ok(st.value != null, "qSOFA now has a value: " + st.value);
  ok(await ev(`return /qSOFA/.test((document.getElementById("icuRoot")||{}).innerText||"") && !/tap to add: RR/.test((document.getElementById("icuRoot")||{}).innerText||"");`) === true,
    "the dashboard shows the computed score instead of the 'tap to add' prompt");

  console.log(fails === 0 ? "\nALL GREEN — missing scores are filled in place and compute immediately" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
