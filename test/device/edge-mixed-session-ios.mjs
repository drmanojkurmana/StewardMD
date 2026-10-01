/* test/device/edge-mixed-session-ios.mjs - Edge gate A0.6 mixed session on a real iPhone (vault/plans/Edge-Runbook.md).
 * Repeats for N minutes: noCloud dictation (macOS `say` plays the phrase; keep the phone near the
 * speaker), one MaiK local answer (needs the maik-lite pack installed), and 10 Needle routings under the
 * 1,200 ms deadline (needs needle3.cact in the app container). Writes one JSON line per cycle; thermal
 * and battery come from idevicediagnostics every 5 cycles.
 * Needs: USB iPhone, app open and unlocked, `ios_webkit_debug_proxy -c null:9221,:9222-9250` running,
 * `node scripts/edge/export.mjs` done. Not part of npm test.
 * Usage: node test/device/edge-mixed-session-ios.mjs [minutes=30] [outdir=.]
 */
import { connect } from "../ios-webkit-cdp.mjs";
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
const MIN = Number(process.argv[2] || 30), J = process.argv[3] || ".", OUT = J + "/edge-mixed-ios.jsonl";
const QS = ["What is the target INR for a patient on warfarin with a mechanical mitral valve?",
  "What is the first-line treatment for uncomplicated falciparum malaria in adults?",
  "How do you correct hyperkalaemia with ECG changes?",
  "What is the dose of IV ceftriaxone for bacterial meningitis in adults?",
  "When should you start insulin in diabetic ketoacidosis after fluids?",
  "What are the Wells criteria for pulmonary embolism?"];
const PHRASES = ["blood pressure one forty over ninety", "pulse rate ninety two per minute", "temperature one hundred and one fahrenheit"];
const rows = fs.readFileSync(new URL("../../vault/plans/edge-data/dataset/export/bakeoff/test.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(JSON.parse);
const page = () => { const j = JSON.parse(execSync("curl -s localhost:9222/json").toString() || "[]"); const p = j.find((x) => x.webSocketDebuggerUrl); return p ? { ws: p.webSocketDebuggerUrl, pid: p.appId } : null; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function run(expr, sec) {   // expr must set window.__m when done
  for (let a = 0; a < 3; a++) {
    try {
      const p = page(); if (!p) { await sleep(3000); continue; }
      const c = connect(p.ws, { timeoutMs: 30000 });
      await c.evaluate(`window.__m=null; (function(){ ${expr} })(); 1`);
      const t0 = Date.now();
      while (Date.now() - t0 < sec * 1000) { await sleep(500); const v = await c.evaluate("JSON.stringify(window.__m)"); if (v && v !== "null") return { pid: p.pid, ...JSON.parse(v) }; }
      return { pid: p.pid, timeout: true };
    } catch (e) { await sleep(2000); }
  }
  return { connectFailed: true };
}
function thermal() {
  try { execSync(`idevicediagnostics ioregentry AppleSmartBattery > ${J}/batt-m.plist 2>/dev/null`);
    return JSON.parse(execSync(`python3 -c "import plistlib,json;r=plistlib.load(open('${J}/batt-m.plist','rb'))['IORegistry'];print(json.dumps({'thermLimited':r['ChargerData'].get('TimeChargingThermallyLimited'),'cap':r.get('CurrentCapacity'),'charging':r.get('IsCharging')}))"`).toString()); } catch (e) { return { err: String(e.message).slice(0, 80) }; }
}
const END = Date.now() + MIN * 60000; let i = 0;
fs.writeFileSync(OUT, JSON.stringify({ start: new Date().toISOString(), thermal: thermal() }) + "\n");
await run(`window.__mrows=${JSON.stringify(rows.slice(0, 200))}; window.__m={ok:1};`, 10);
while (Date.now() < END) {
  const rec = { i, t: new Date().toISOString().slice(11, 19) };
  // 1. noCloud dictation with speech from the Mac speaker
  setTimeout(() => spawn("say", ["-r", "150", PHRASES[i % PHRASES.length]]), 2000);
  rec.dict = await run(`var s=SMD_VOICE.listen({noCloud:true, onFinal:function(t){ window.__m={final:t, engine:s&&s.engine}; }, onError:function(e){ window.__m={err:e}; }});
    setTimeout(function(){ try{s&&s.stop()}catch(e){} }, 9000);`, 20);
  // 2. MaiK local answer
  rec.maik = await run(`var t0=Date.now(), first=null; SMD_MAIK_LOCAL.answer({question:${JSON.stringify(QS[i % QS.length])}}, {pack:"maik-lite"}, function(){ if(first==null) first=Date.now()-t0; })
    .then(function(r){ window.__m={ms:Date.now()-t0, first:first, engine:r&&r.engine, err:r&&r.error, len:r&&r.text?r.text.length:0}; }, function(e){ window.__m={threw:String(e)}; });`, 180);
  // 3. Needle Edge, 10 rows under the production deadline
  const off = (i * 10) % 190;
  rec.edge = await run(`SMD_EDGE.bakeoff(window.__mrows.slice(${off}, ${off + 10}), SMD_EDGE.needleAdapter(Capacitor.Plugins.Needle, {calibrated:true}), {deadlineMs:1200})
    .then(function(out){ var st={}, ms=[]; out.forEach(function(l){ st[l.status]=(st[l.status]||0)+1; ms.push(l.ms); }); window.__m={st:st, ms:ms}; }, function(e){ window.__m={threw:String(e)}; });`, 60);
  if (i % 5 === 0) rec.thermal = thermal();
  fs.appendFileSync(OUT, JSON.stringify(rec) + "\n");
  console.log(`${rec.t} #${i} dict=${rec.dict.final ? "ok" : JSON.stringify(rec.dict)} maik=${rec.maik.ms || JSON.stringify(rec.maik)}ms edge=${JSON.stringify(rec.edge.st || rec.edge)} pid=${rec.maik.pid}`);
  i++;
}
fs.appendFileSync(OUT, JSON.stringify({ end: new Date().toISOString(), thermal: thermal() }) + "\n");
console.log("DONE cycles=" + i);
process.exit(0);   // the proxy WebSockets would keep node alive
