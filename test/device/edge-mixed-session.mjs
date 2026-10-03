/* test/device/edge-mixed-session.mjs - Edge gate A0.6 mixed session on a real phone (vault/plans/Edge-Runbook.md).
 * Repeats for N minutes: noCloud dictation (macOS `say` plays the phrase; keep the phone near the
 * speaker), one MaiK local answer (needs the maik-lite pack installed), and 10 Needle routings under the
 * 1,200 ms deadline (needs needle3.cact in the app's files). Writes one JSON line per cycle; thermal,
 * battery (and on Android the memory of the app and its :edge process) every 5 cycles.
 * iPhone: USB, app open and unlocked, `ios_webkit_debug_proxy -c null:9221,:9222-9250` running.
 * Android (--android): USB debugging, app open; the WebView is reached with adb forward on port 9333.
 * Both: `node scripts/edge/export.mjs` done. Not part of npm test.
 * Usage: node test/device/edge-mixed-session.mjs [minutes=30] [outdir=.] [--android]
 */
import { connect } from "../ios-webkit-cdp.mjs";
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
const ARGS = process.argv.slice(2).filter((a) => a !== "--android"), ANDROID = process.argv.includes("--android");
const MIN = Number(ARGS[0] || 30), J = ARGS[1] || ".", OUT = J + `/edge-mixed-${ANDROID ? "android" : "ios"}.jsonl`;
const sh = (c) => { try { return execSync(c, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch (e) { return ""; } };
const QS = ["What is the target INR for a patient on warfarin with a mechanical mitral valve?",
  "What is the first-line treatment for uncomplicated falciparum malaria in adults?",
  "How do you correct hyperkalaemia with ECG changes?",
  "What is the dose of IV ceftriaxone for bacterial meningitis in adults?",
  "When should you start insulin in diabetic ketoacidosis after fluids?",
  "What are the Wells criteria for pulmonary embolism?"];
const PHRASES = ["blood pressure one forty over ninety", "pulse rate ninety two per minute", "temperature one hundred and one fahrenheit"];
const rows = fs.readFileSync(new URL("../../vault/plans/edge-data/dataset/export/bakeoff/test.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(JSON.parse);
function page() {
  if (!ANDROID) { const j = JSON.parse(sh("curl -s localhost:9222/json") || "[]"); const p = j.find((x) => x.webSocketDebuggerUrl); return p ? { ws: p.webSocketDebuggerUrl, pid: p.appId } : null; }
  const pid = sh("adb shell pidof in.stewardmd.app").split(/\s+/)[0]; if (!pid) return null;
  sh(`adb forward tcp:9333 localabstract:webview_devtools_remote_${pid}`);
  const j = JSON.parse(sh("curl -s 127.0.0.1:9333/json/list") || "[]"); const p = j.find((x) => x.type === "page" && x.webSocketDebuggerUrl);
  return p ? { ws: p.webSocketDebuggerUrl, pid: "PID:" + pid } : null;
}
// Android's WebView speaks plain CDP (no Target wrapping, unlike iOS: see ../ios-webkit-cdp.mjs).
function cdp(ws) {
  const sock = new WebSocket(ws); let id = 1; const pend = new Map();
  const open = new Promise((res, rej) => { sock.onopen = res; sock.onerror = () => rej(new Error("ws error")); });
  sock.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  // A socket that closes mid-call must not leave the await pending forever (node exits 13 with nothing written).
  sock.onclose = () => { for (const f of pend.values()) f({ closed: true }); pend.clear(); };
  return { evaluate: (expr) => open.then(() => new Promise((r, j) => { const i = id++;
    const t = setTimeout(() => { pend.delete(i); j(new Error("cdp timeout")); }, 30000);
    pend.set(i, (m) => { clearTimeout(t); if (m.closed) j(new Error("cdp closed")); else r(m.result && m.result.result ? m.result.result.value : null); });
    sock.send(JSON.stringify({ id: i, method: "Runtime.evaluate", params: { expression: expr, returnByValue: true } })); })), close: () => sock.close() };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function run(expr, sec) {   // expr must set window.__m when done
  for (let a = 0; a < 3; a++) {
    try {
      const p = page(); if (!p) { await sleep(3000); continue; }
      const c = ANDROID ? cdp(p.ws) : connect(p.ws, { timeoutMs: 30000 });
      await c.evaluate(`window.__m=null; (function(){ ${expr} })(); 1`);
      const t0 = Date.now();
      while (Date.now() - t0 < sec * 1000) { await sleep(500); const v = await c.evaluate("JSON.stringify(window.__m)"); if (v && v !== "null") return { pid: p.pid, ...JSON.parse(v) }; }
      return { pid: p.pid, timeout: true };
    } catch (e) { await sleep(2000); }
  }
  return { connectFailed: true };
}
function thermal() {
  if (ANDROID) {
    const b = sh("adb shell dumpsys battery"), g = (k) => ((b.match(new RegExp("\\n\\s*" + k + ": (\\S+)")) || [])[1]);
    const pss = (proc) => { const m = sh(`adb shell dumpsys meminfo ${proc}`).match(/TOTAL PSS:\s+(\d+)/) || sh(`adb shell dumpsys meminfo ${proc}`).match(/TOTAL\s+(\d+)/); return m ? Math.round(Number(m[1]) / 1024) : null; };
    return { tempC: Number(g("temperature")) / 10, level: Number(g("level")), status: g("status"),
      thermalStatus: (sh("adb shell dumpsys thermalservice").match(/Thermal Status: (\d)/) || [])[1],
      appPssMB: pss("in.stewardmd.app"), edgePid: sh("adb shell pidof in.stewardmd.app:edge"), edgePssMB: pss("in.stewardmd.app:edge") };
  }
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
  // Under the production back-off (A0.5): device state refreshed once per cycle, a "no" resolves "skipped".
  rec.edge = await run(`var b=function(){ return SMD_EDGE.backoff(); };
    SMD_EDGE.refreshDevice().then(function(){ return SMD_EDGE.bakeoff(window.__mrows.slice(${off}, ${off + 10}), SMD_EDGE.needleAdapter(Capacitor.Plugins.Needle, {calibrated:true}),
      {deadlineMs:1200, env:{memoryOk:function(){ return b().memoryOk; }, thermalOk:function(){ return b().thermalOk; }, othersBusy:function(){ return b().othersBusy; }}}); })
    .then(function(out){ var st={}, ms=[]; out.forEach(function(l){ st[l.status]=(st[l.status]||0)+1; ms.push(l.ms); }); window.__m={st:st, ms:ms, backoff:b()}; }, function(e){ window.__m={threw:String(e)}; });`, 60);
  if (i % 5 === 0) rec.thermal = thermal();
  fs.appendFileSync(OUT, JSON.stringify(rec) + "\n");
  console.log(`${rec.t} #${i} dict=${rec.dict.final ? "ok" : JSON.stringify(rec.dict)} maik=${rec.maik.ms || JSON.stringify(rec.maik)}ms edge=${JSON.stringify(rec.edge.st || rec.edge)} pid=${rec.maik.pid}`);
  i++;
}
fs.appendFileSync(OUT, JSON.stringify({ end: new Date().toISOString(), thermal: thermal() }) + "\n");
console.log("DONE cycles=" + i);
process.exit(0);   // the proxy WebSockets would keep node alive
