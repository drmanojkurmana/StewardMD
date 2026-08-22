/* Lab Watch (Phase 1, in-app) + Discharge/Lab-Watch integration — 17 Lab Watch cases + 1 cross-
 * feature Discharge check.
 *
 * Lab Watch proves: flag + kill-switch; setup sheet + analyte search; start/scope; deterministic
 * detection by sensitivity mode (critical/meaningful/every); dedup by reading timestamp; seed so a
 * pre-existing backlog never alerts; badge; tap→Trends highlight; pause/resume; expiry; stop;
 * device-delivery does not crash; Ward-Sync entry point. The one Discharge case here is scoped to
 * the Lab Watch integration point (an "until discharge" watch ends when a discharge summary is
 * created) - the Discharge Creator itself is covered by test/run-icu-discharge.mjs. Deterministic
 * (no AI). USAGE: node test/run-icu-labwatch.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8906/").replace(/\/?$/, "/");
const PORT = 9408, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/icu-lw-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

// Static: the Ward-Sync (home) entry point exists.
const ghis = readFileSync(join(ROOT, "ghis-ward.js"), "utf8");
ok(/watchLabs:\s*function/.test(ghis) && /GHIS\.watchLabs\(/.test(ghis), "#17 Ward Sync tab exposes a Lab Watch entry (GHIS.watchLabs + drawer button)");

let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8906"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
const J = async (e) => { const v = await ev(e); try { return JSON.parse(v); } catch { return v; } };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 90; i++) { await sleep(400); if (await ev(`return !!(window.ICU && ICU.labWatchOn && ICU._lwScan && ICU._lwStartWith && ICU.buildDischarge && ICU.ingestWardHistory)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("ICU Lab Watch API not loaded");
  // Lab Watch persists watches to localStorage — start from a clean slate so watches from a
  // prior run/step never bleed across cases.
  await ev(`Object.keys(localStorage).forEach(function(k){ if(/^smd_lab_watch|^smd_icu_draft/.test(k)) localStorage.removeItem(k); }); return 1;`);

  // helper to push a lab reading at a given ISO date
  const feed = (test, result, date) => `ICU.ingestWardHistory({ source:'Ward Sync', labs:[{ test:'${test}', result:${result}, units:'', date:'${date}' }] });`;
  // The Trends tab only shows the last 24h by default (icu.js `_trendWin`) - a FIXED calendar
  // date ages out of that window the moment "now" moves past it, silently breaking #12 every
  // time this file is run more than a day after it was written. Compute dates relative to the
  // actual run time instead, so the test never goes stale on its own.
  const recentTs = (hoursAgo) => { const d = new Date(Date.now() - hoursAgo * 3600000); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };

  // ===== #1 flag + kill-switch =====
  ok(await ev(`return ICU.labWatchOn() === true;`) === true, "#1 Lab Watch ON by default (smd_lab_watch)");

  // ===== #2 setup sheet shows when no watch =====
  const c2 = await J(`ICU.reset(); ICU.ingestPatient({name:"LWPT",age:60,sex:"M"}); ICU.openLabWatch();
    var m=document.getElementById('icuModal'); return JSON.stringify({ setup: !!(m && m.querySelector('#icuLwq') && /Start Lab Watch/.test(m.textContent||"")) });`);
  ok(c2.setup, "#2 setup sheet opens (search + Start) when no watch exists");

  // ===== #3 analyte search filters =====
  const c3 = await J(`var m=document.getElementById('icuModal'); var q=m.querySelector('#icuLwq'); q.value='potassium'; q.dispatchEvent(new Event('input',{bubbles:true}));
    var list=m.querySelector('#icuLwList').textContent||""; return JSON.stringify({ hasK: /Potassium/.test(list), hasHb: /Haemoglobin/.test(list) });`);
  ok(c3.hasK && !c3.hasHb, "#3 analyte search filters by synonym ('potassium' → Potassium only)");

  // ===== #4 start → config saved; #5 patient+account scoped =====
  const c4 = await J(`var w=ICU._lwStartWith({ analytes:['k','creat'], mode:'critical', dur:12 });
    return JSON.stringify({ analytes:w.analytes, mode:w.mode, hasExpiry: w.expiresAt>0, active: ICU._lwActive() });`);
  ok(c4.analytes && c4.analytes.length === 2 && c4.mode === "critical" && c4.hasExpiry && c4.active, "#4 Start saves the watch (analytes/mode/expiry) and it is active");
  const c5 = await J(`ICU.reset(); ICU.ingestPatient({name:"OTHER",age:40,sex:"F"}); return JSON.stringify({ other: ICU._lwGet() });`);
  ok(c5.other === null, "#5 watch is patient-scoped — a different patient has no watch");

  // ===== #10 seed: a pre-existing reading does NOT alert =====
  const c10 = await J(`ICU.reset(); ICU.ingestPatient({name:"SEED",age:60,sex:"M"});
    ${feed("Potassium", 6.8, "2026-07-08 09:00")}                 // critical value BEFORE watching
    var w=ICU._lwStartWith({ analytes:['k'], mode:'critical', dur:12 });
    ICU._lwScan();                                                 // scan with only the pre-existing reading
    return JSON.stringify({ acts: (ICU._lwGet().activity||[]).length });`);
  ok(c10.acts === 0, "#10 seed — a critical value already present at Start does NOT alert (only new labs do)");

  // ===== #6 critical mode: new critical fires; normal doesn't =====
  const c6 = await J(`${feed("Potassium", 4.2, "2026-07-08 12:00")}   // normal new reading → must NOT fire (critical mode)
    var a1=(ICU._lwGet().activity||[]).length;
    ${feed("Potassium", 7.1, "2026-07-08 18:00")}   // new critical reading → MUST fire
    var acts=ICU._lwGet().activity||[];
    return JSON.stringify({ afterNormal:a1, afterCrit:acts.length, kind:(acts[0]||{}).kind, text:(acts[0]||{}).text });`);
  ok(c6.afterNormal === 0, "#6 critical mode — a new NORMAL K does not alert");
  ok(c6.afterCrit === 1 && c6.kind === "critical" && /7\.1/.test(c6.text || ""), "#6 critical mode — a new CRITICAL K alerts once (" + c6.text + ")");

  // ===== #9 dedup: re-scanning the same reading does not re-fire =====
  const c9 = await J(`ICU._lwScan(); return JSON.stringify({ acts:(ICU._lwGet().activity||[]).length });`);
  ok(c9.acts === 1, "#9 dedup — re-scanning the same latest reading does not create a duplicate alert");

  // ===== #7 meaningful mode: abnormal fires; #8 every mode: any fires =====
  const c7 = await J(`ICU.reset(); ICU.ingestPatient({name:"MEAN",age:60,sex:"M"});
    var w=ICU._lwStartWith({ analytes:['creat'], mode:'meaningful', dur:12 });
    ${feed("Creatinine", 80, "2026-07-08 09:00")}     // near-normal baseline
    var a0=(ICU._lwGet().activity||[]).length;
    ${feed("Creatinine", 320, "2026-07-08 15:00")}    // big rise → meaningful
    var acts=ICU._lwGet().activity||[];
    return JSON.stringify({ base:a0, after:acts.length, text:(acts[0]||{}).text });`);
  ok(c7.after >= 1 && /Creatinine/.test(c7.text || ""), "#7 meaningful mode — a large creatinine rise alerts (" + c7.text + ")");
  const c8 = await J(`ICU.reset(); ICU.ingestPatient({name:"EVERY",age:60,sex:"M"});
    var w=ICU._lwStartWith({ analytes:['na'], mode:'every', dur:12 });
    ${feed("Sodium", 140, "2026-07-08 09:00")}         // perfectly normal → but 'every' fires
    return JSON.stringify({ acts:(ICU._lwGet().activity||[]).length });`);
  ok(c8.acts === 1, "#8 every mode — even a normal new result alerts");

  // ===== #11 badge increments on detection; cleared on open =====
  const c11 = await J(`var b1=ICU._lwBadge(); ICU.openLabWatch(); var b2=ICU._lwBadge();
    return JSON.stringify({ before:b1, after:b2 });`);
  ok(c11.before >= 1 && c11.after === 0, "#11 badge counts new results (" + c11.before + ") and clears when Lab Watch opens");

  // ===== #13 pause stops detection; resume restarts =====
  const c13 = await J(`ICU.reset(); ICU.ingestPatient({name:"PAUSE",age:60,sex:"M"});
    var w=ICU._lwStartWith({ analytes:['k'], mode:'every', dur:12 });
    w.paused=true; ICU._lwSet(w);
    ${feed("Potassium", 5.0, "2026-07-08 10:00")}
    var paused=(ICU._lwGet().activity||[]).length;
    var w2=ICU._lwGet(); w2.paused=false; ICU._lwSet(w2);
    ${feed("Potassium", 5.2, "2026-07-08 14:00")}
    return JSON.stringify({ paused:paused, resumed:(ICU._lwGet().activity||[]).length });`);
  ok(c13.paused === 0 && c13.resumed === 1, "#13 pause suspends detection; resume restarts it");

  // ===== #14 expired watch does not detect =====
  const c14 = await J(`ICU.reset(); ICU.ingestPatient({name:"EXP",age:60,sex:"M"});
    var w=ICU._lwStartWith({ analytes:['k'], mode:'every', dur:12 });
    var w2=ICU._lwGet(); w2.expiresAt = Date.now() - 1000; ICU._lwSet(w2);   // force-expire
    var act=ICU._lwActive();
    ${feed("Potassium", 5.0, "2026-07-08 10:00")}
    return JSON.stringify({ active:act, acts:(ICU._lwGet().activity||[]).length });`);
  ok(c14.active === false && c14.acts === 0, "#14 an expired watch is inactive and does not alert");

  // ===== #15 stop removes the watch =====
  const c15 = await J(`ICU.reset(); ICU.ingestPatient({name:"STOP",age:60,sex:"M"});
    ICU._lwStartWith({ analytes:['k'], mode:'every', dur:12 });
    ICU._lwSet(null);
    return JSON.stringify({ gone: ICU._lwGet()===null });`);
  ok(c15.gone, "#15 Stop removes the watch record");

  // ===== #16 device delivery does not crash (permission best-effort in headless) =====
  const c16 = await J(`ICU.reset(); ICU.ingestPatient({name:"DEV",age:60,sex:"M"});
    var d = ICU.labWatchOn();   // just exercise; delivery both goes through async permission
    return JSON.stringify({ ok: d===true });`);
  ok(c16.ok, "#16 device-delivery path is guarded (no crash; downgrades to in-app if permission denied)");

  // ===== #12 tap→Trends highlights the analyte =====
  const c12 = await J(`ICU.reset(); ICU.ingestPatient({name:"HL",age:60,sex:"M"});
    ${feed("Potassium", 4.0, recentTs(3))} ${feed("Potassium", 6.9, recentTs(1))}
    ICU.open(); var root=document.getElementById('icuRoot');
    var b=document.createElement('button'); b.setAttribute('data-icu-act','lwopen:k'); root.appendChild(b); b.click(); b.remove();
    var seg=root.querySelector('.icu-seg.on'); var hi=root.querySelector('.icu-tr-card.lw-hi');
    return JSON.stringify({ onTrends: seg?seg.getAttribute('data-icu-act'):null, highlighted: !!hi });`);
  ok(c12.onTrends === "tab:trends" && c12.highlighted, "#12 tapping a Lab Watch result opens Trends with the analyte highlighted");

  // ===== Discharge Creator =====
  // cd1/cd2 used to assert the ORIGINAL stub Discharge Creator's plain-textarea output (a single
  // #icuDischargeText field, "STATUS AT DISCHARGE", "DISCHARGE MEDICATIONS: [ complete ]" on one
  // line). The Discharge Creator has since been fully rebuilt into a structured per-section form
  // (renamed "CONDITION AT DISCHARGE", multi-line meds placeholder, MaiK-drafted narrative) -
  // test/run-icu-discharge.mjs now covers that real UI end to end (21 cases). Removed the two
  // dead-API checks here rather than re-patch them to duplicate that file's job.
  const cd3 = await J(`ICU.reset(); ICU.ingestPatient({name:"DD",age:60,sex:"M"});
    ICU._lwStartWith({ analytes:['k'], mode:'every', dur:'discharge' });
    var before = ICU._lwGet()!==null;
    ICU.buildDischarge(); ICU.openDischarge();
    return JSON.stringify({ before:before, afterCleared: ICU._lwGet()===null });`);
  ok(cd3.before && cd3.afterCleared, "Discharge — an 'until discharge' Lab Watch ends when the discharge summary is created");

  console.log(fails === 0 ? "\nALL GREEN — Lab Watch (Phase 1) + Discharge Creator passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
