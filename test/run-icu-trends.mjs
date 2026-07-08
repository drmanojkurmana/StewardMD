/* ICU Trends — patient-linked trajectory dashboard test.
 *
 * Proves the ICU Trends tab safely turns patient-linked history into interpreted trends:
 *   • Ward Sync history → a correct multi-point, dated time series (labs.trends[]),
 *   • direction-aware clinical interpretation (rising creatinine = worsening, falling
 *     platelets = concerning, falling lipase = "trend only — correlate", K by safety),
 *   • patient isolation — patient A's values never appear for patient B,
 *   • missing-data — the chart line breaks across a large gap (no false continuity),
 *   • no patient selected → guided empty state.
 *
 * Exercises ICU.ingestWardHistory + the Trends render (client). No engine/provider change.
 * USAGE: BASE=http://localhost:8902/ node test/run-icu-trends.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8902/").replace(/\/?$/, "/");
const PORT = 9374, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/icu-tr-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8902"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

// helper JS (string) injected into the page to build a dated ward-history bundle
const SEED = `function(name, reports){
  ICU.reset && ICU.reset();
  var rows=[]; reports.forEach(function(rep){ rep.tests.forEach(function(t){ rows.push({ test:t[0], result:String(t[1]), units:t[2]||"", date:rep.date }); }); });
  return ICU.ingestWardHistory({ patient:{ name:name }, patientId:name, source:"Ward Sync", labs: rows });
}`;

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 60; i++) { await sleep(400); if (await ev(`return !!(window.ICU && ICU.ingestWardHistory && ICU.state)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("ICU.ingestWardHistory not loaded");
  await ev(`window.__seed = ${SEED};`);

  // 1) Ward history → correct multi-point dated time series
  const r1 = await ev(`
    var res = __seed("A", [
      { date:"01-JUL-2026", tests:[["Creatinine",1.1,"mg/dL"],["Platelet Count",140,"10^3/uL"],["Lipase",980,"U/L"]] },
      { date:"03-JUL-2026", tests:[["Creatinine",1.4,"mg/dL"],["Platelet Count",118,"10^3/uL"],["Lipase",760,"U/L"]] },
      { date:"05-JUL-2026", tests:[["Creatinine",1.8,"mg/dL"],["Platelet Count",101,"10^3/uL"],["Lipase",690,"U/L"]] }
    ]);
    var tr = ICU.state().labs.trends || [];
    var creat = tr.filter(function(r){return r.creat!=null;}).sort(function(a,b){return a.ts-b.ts;}).map(function(r){return r.creat;});
    return JSON.stringify({ reports: res.reports, points: res.points, rows: tr.length, creatN: creat.length, ascending: creat[0]<creat[1] && creat[1]<creat[2] });
  `);
  const D = JSON.parse(r1);
  ok(D.reports === 3 && D.rows === 3, "ward history → 3 dated snapshots in labs.trends[] (reports=" + D.reports + ", rows=" + D.rows + ")");
  ok(D.creatN === 3 && D.ascending, "creatinine time series has 3 ascending points");

  // 2) Direction-aware interpretation (render the Trends tab, read the cards)
  await ev(`
    __seed("A", [
      { date:"01-JUL-2026", tests:[["Creatinine",1.1,"mg/dL"],["Platelet Count",140,"10^3/uL"],["Lipase",980,"U/L"],["Bilirubin Total",1.0,"mg/dL"],["Haemoglobin",10.2,"g/dL"],["Potassium",4.2,"mmol/L"]] },
      { date:"05-JUL-2026", tests:[["Creatinine",2.1,"mg/dL"],["Platelet Count",92,"10^3/uL"],["Lipase",640,"U/L"],["Bilirubin Total",2.4,"mg/dL"],["Haemoglobin",8.7,"g/dL"],["Potassium",6.1,"mmol/L"]] }
    ]);
    ICU.open();
    var mw = document.querySelector('[data-icu-act="ws:monitoring"]'); if (mw) mw.click(); var tab = document.querySelector('[data-icu-act="tab:trends"]'); if (tab) tab.click();
    return 1;`);
  await sleep(500);
  await ev(`var all = document.querySelector('[data-icu-act="win:0"]'); if (all) all.click(); return 1;`);
  await sleep(500);
  const r2 = await ev(`
    var out = {};
    Array.prototype.forEach.call(document.querySelectorAll('.icu-tr-card'), function(c){
      var lbl=(c.querySelector('.icu-tr-lbl')||{}).textContent||"";
      out[lbl.trim()] = { interp:((c.querySelector('.icu-tr-interp')||{}).textContent||"").trim().toLowerCase(), status:((c.querySelector('.icu-tr-st')||{}).textContent||"").trim().toLowerCase() };
    });
    return JSON.stringify(out);
  `);
  const I = JSON.parse(r2);
  ok(I["Creatinine"] && I["Creatinine"].interp === "worsening", "rising creatinine → 'worsening'");
  ok(I["Platelets"] && I["Platelets"].interp === "concerning", "falling platelets → 'concerning'");
  ok(I["Bilirubin (total)"] && I["Bilirubin (total)"].interp === "worsening", "rising bilirubin → 'worsening'");
  ok(I["Haemoglobin"] && I["Haemoglobin"].interp === "concerning", "falling haemoglobin → 'concerning'");
  ok(I["Lipase"] && /trend only/.test(I["Lipase"].interp), "falling lipase → 'trend only — correlate clinically' (not 'improving')");
  ok(I["Potassium"] && I["Potassium"].status === "critical", "K 6.1 flagged 'critical' by safety threshold");

  // 3) Patient isolation — B's trends must not contain A's values
  const r3 = await ev(`
    __seed("A", [{ date:"01-JUL-2026", tests:[["Creatinine",1.1,"mg/dL"]] }]);
    __seed("B", [{ date:"02-JUL-2026", tests:[["Creatinine",3.3,"mg/dL"]] }]);
    var tr = ICU.state().labs.trends || [];
    var vals = tr.filter(function(r){return r.creat!=null;}).map(function(r){return Math.round(r.creat);});
    // 1.1 mg/dL → ~97 µmol/L (A), 3.3 → ~292 (B). After selecting B (reset in seed), only B should remain.
    return JSON.stringify({ rows: tr.length, vals: vals, name: ICU.state().patient.name });
  `);
  const P = JSON.parse(r3);
  ok(P.name === "B" && P.rows === 1 && P.vals.every(function (v) { return v > 250; }), "patient isolation — selecting B leaves only B's value, none of A's (rows=" + P.rows + ")");

  // 4) Missing-data — chart line breaks across a large gap (no false continuity)
  await ev(`
    // regular 2-day spacing (continuous) vs a 15-day gap then a point (should break)
    __seed("A", [
      { date:"01-JUL-2026", tests:[["Creatinine",1.1,"mg/dL"]] },
      { date:"03-JUL-2026", tests:[["Creatinine",1.2,"mg/dL"]] },
      { date:"05-JUL-2026", tests:[["Creatinine",1.3,"mg/dL"]] },
      { date:"20-JUL-2026", tests:[["Creatinine",1.4,"mg/dL"]] }
    ]);
    ICU.open();
    var mw=document.querySelector('[data-icu-act="ws:monitoring"]'); if(mw) mw.click(); var tab=document.querySelector('[data-icu-act="tab:trends"]'); if(tab) tab.click(); return 1;`);
  await sleep(500);
  await ev(`var all=document.querySelector('[data-icu-act="win:0"]'); if(all) all.click(); return 1;`);
  await sleep(500);
  const r4 = await ev(`
    var card=Array.prototype.filter.call(document.querySelectorAll('.icu-tr-card'), function(c){ return /Creatinine/.test((c.querySelector('.icu-tr-lbl')||{}).textContent||""); })[0];
    var path=card ? card.querySelector('svg path') : null;
    var d=path ? path.getAttribute('d') : "";
    var moves=(d.match(/M/g)||[]).length;
    return JSON.stringify({ moves: moves, d: d.slice(0,120) });
  `);
  const G = JSON.parse(r4);
  ok(G.moves >= 2, "chart breaks the line across the 9-day gap (path has " + G.moves + " move commands, not 1 continuous)");

  // 5) No patient selected → guided empty state
  await ev(`ICU.reset && ICU.reset(); ICU.open(); var mw=document.querySelector('[data-icu-act="ws:monitoring"]'); if(mw) mw.click(); var tab=document.querySelector('[data-icu-act="tab:trends"]'); if(tab) tab.click(); return 1;`);
  await sleep(500);
  const r5 = await ev(`var root=document.getElementById('icu') || document.body; return JSON.stringify({ empty: /select a patient to view trends/i.test(root.textContent||"") });`);
  ok(JSON.parse(r5).empty, "no patient selected → guided 'Select a patient to view trends' state");

  console.log(fails === 0 ? "\nALL GREEN — ICU Trends test passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
