/* BUG B2/B3/B7-escalation (2026-08-22 ward-round audit, owner-approved 2026-08-23): a richer,
 * flag-gated acuity engine.
 *  - B2: a patient with NOTHING charted reads "Not assessed", never "Stable".
 *  - B3: NEWS2 (already computed elsewhere in the app, reused via ICU_AUTOSCORES.computeOne, never
 *    reimplemented) drives escalation on top of the original MAP/lactate/SpO2/pressor thresholds;
 *    the SpO2 boundary (was `< 93`, cleared at exactly 93) is corrected to `<= 93`.
 *  - B7 (staleness half): a "Stable" read older than the window demotes to "Not assessed" - only
 *    ever FROM stable, never downgrading an already-flagged critical/review patient.
 * Flag: smd_icu_acuity_v2 (localStorage) / ?acuityv2= (query), default OFF. The whole first half of
 * this file proves flag-OFF behaviour is BYTE-IDENTICAL to before - this is the load-bearing half,
 * since it's what every current user sees until the owner turns it on.
 * USAGE: node test/run-icu-acuity-v2.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8923/").replace(/\/?$/, "/");
const PORT = 9458, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/icu-acuityv2-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8923"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.stack||x)})}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
const J = async (e) => { const v = await ev(e); try { return JSON.parse(v); } catch { return v; } };

const clearRoster = `try { for (var i=localStorage.length-1;i>=0;i--){ var k=localStorage.key(i); if(k&&k.indexOf("stewardmd_icu_patients")===0) localStorage.removeItem(k); } } catch(e){}`;
const cardInfo = `
  var card = document.querySelector(".icu-v2-card");
  if (!card) return JSON.stringify({ noCard: true });
  var pill = card.querySelector(".icu-v2-pill");
  return JSON.stringify({ cls: card.className, pillText: pill ? pill.textContent : null });
`;

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE + "?tour=0" });
  let ready = false;
  for (let i = 0; i < 90; i++) { await sleep(400); if (await ev(`return !!(window.ICU && ICU.savePatient)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("ICU not loaded");
  await ev(`try { localStorage.setItem("smd_icu_groups","0"); } catch(e){} return 1;`);

  // ===================== FLAG OFF (default) — nothing changes =====================
  await ev(`try { localStorage.removeItem("smd_icu_acuity_v2"); } catch(e){} return 1;`);

  const offBlank = await J(`
    ${clearRoster}
    ICU.reset(); ICU.ingestPatient({ name: "Just Admitted", bed: "9" }); ICU.savePatient();
    ICU.open();
    ${cardInfo}
  `);
  ok(/\bstable\b/.test(offBlank.cls) && !/\bunassessed\b/.test(offBlank.cls), `flag OFF: a blank patient still reads Stable, not Not-assessed (${offBlank.cls})`);
  ok(offBlank.pillText === "Stable", `...pill still says "Stable" (got "${offBlank.pillText}")`);

  const offSpo293 = await J(`
    ${clearRoster}
    ICU.reset(); ICU.ingestPatient({ name: "SpO2 93", bed: "2" });
    ICU.ingestMonitor({ hr: 90, sbp: 120, dbp: 78, spo2: 93, rr: 16, temp: 37, gcs: 15 });
    ICU.savePatient();
    ICU.open();
    ${cardInfo}
  `);
  ok(/\bstable\b/.test(offSpo293.cls), `flag OFF: SpO2 exactly 93 still clears review (the old, unfixed boundary) — ${offSpo293.cls}`);

  const offCensus = await J(`return JSON.stringify({ hasUnassessedChip: !!document.querySelector(".icu-v2-scount.unassessed") });`);
  ok(offCensus.hasUnassessedChip === false, "flag OFF: no 'Not assessed' census tile is rendered at all");

  const offNews2 = await J(`
    ${clearRoster}
    ICU.reset(); ICU.ingestPatient({ name: "Tachypnoeic", bed: "10" });
    ICU.ingestMonitor({ hr: 126, sbp: 100, dbp: 60, spo2: 95, rr: 34, temp: 37, gcs: 15 });
    ICU.savePatient();
    ICU.open();
    ${cardInfo}
  `);
  ok(/\bstable\b/.test(offNews2.cls), `flag OFF: the audit's own tachypnoea case (RR 34, otherwise normal) still reads Stable — reproduces B3 exactly (${offNews2.cls})`);

  // ===================== FLAG ON — the v2 engine =====================
  await ev(`try { localStorage.setItem("smd_icu_acuity_v2","1"); } catch(e){} return 1;`);

  // ---- B2: nothing charted -> Not assessed, not Stable ----
  const onBlank = await J(`
    ${clearRoster}
    ICU.reset(); ICU.ingestPatient({ name: "Just Admitted", bed: "9" }); ICU.savePatient();
    ICU.open();
    ${cardInfo}
  `);
  ok(/\bunassessed\b/.test(onBlank.cls), `B2, flag ON: a patient with nothing charted reads Not-assessed (${onBlank.cls})`);
  ok(onBlank.pillText === "Not assessed", `...pill says "Not assessed" (got "${onBlank.pillText}")`);

  const onCensus1 = await J(`
    var chip = document.querySelector(".icu-v2-scount.unassessed");
    return JSON.stringify({ present: !!chip, count: chip ? chip.querySelector("b").textContent : null });
  `);
  ok(onCensus1.present === true && onCensus1.count === "1", `B2: the census strip carries a 'Not assessed' tile, counting correctly (${JSON.stringify(onCensus1)})`);

  // ---- B3: NEWS2 >= 7 escalates to critical even though no single raw threshold (MAP/lactate/
  // SpO2/pressor) independently crosses critical - the audit's own tachypnoea reproduction ----
  const onNews2Crit = await J(`
    ${clearRoster}
    ICU.reset(); ICU.ingestPatient({ name: "Tachypnoeic", bed: "10" });
    ICU.ingestMonitor({ hr: 126, sbp: 100, dbp: 60, spo2: 95, rr: 34, temp: 37, gcs: 15 });
    ICU.savePatient();
    ICU.open();
    ${cardInfo}
  `);
  ok(/\bcritical\b/.test(onNews2Crit.cls) && !/\breview\b/.test(onNews2Crit.cls), `B3, flag ON: the tachypnoea case (RR 34) now escalates via NEWS2 (${onNews2Crit.cls})`);

  // ---- B3: NEWS2 5-6 escalates to review, isolated from every raw threshold (MAP ~88, SpO2 94,
  // no pressor/lactate/K) so only the NEWS2 mechanism itself is under test here. RR 24(2) + SpO2
  // 94(1) + HR 92(1) + Temp 35.5(1) = NEWS2 5. ----
  const onNews2Review = await J(`
    ${clearRoster}
    ICU.reset(); ICU.ingestPatient({ name: "Borderline", bed: "11" });
    ICU.ingestMonitor({ hr: 92, sbp: 115, dbp: 75, spo2: 94, rr: 24, temp: 35.5, gcs: 15 });
    ICU.savePatient();
    ICU.open();
    ${cardInfo}
  `);
  ok(/\breview\b/.test(onNews2Review.cls), `B3: a NEWS2 5-6 case reads Needs review (${onNews2Review.cls})`);

  // ---- B3: SpO2 exactly 93 now reads review, not stable (the audit's boundary finding) ----
  const onSpo293 = await J(`
    ${clearRoster}
    ICU.reset(); ICU.ingestPatient({ name: "SpO2 93", bed: "2" });
    ICU.ingestMonitor({ hr: 90, sbp: 120, dbp: 78, spo2: 93, rr: 16, temp: 37, gcs: 15 });
    ICU.savePatient();
    ICU.open();
    ${cardInfo}
  `);
  ok(/\breview\b/.test(onSpo293.cls), `B3: SpO2 exactly 93 no longer clears the review boundary (${onSpo293.cls})`);

  // ---- B7 escalation half: a STABLE read based on data >12h old demotes to Not assessed ----
  const onStale = await J(`
    ${clearRoster}
    var real = Date.now;
    Date.now = function(){ return real() - 13 * 3600000; };   // 13h ago - past the 12h window
    ICU.reset(); ICU.ingestPatient({ name: "Stale Stable", bed: "7" });
    ICU.ingestMonitor({ hr: 80, sbp: 120, dbp: 78, spo2: 98, rr: 16, temp: 37, gcs: 15 });
    Date.now = real;
    ICU.savePatient();
    ICU.open();
    ${cardInfo}
  `);
  ok(/\bunassessed\b/.test(onStale.cls), `B7: a Stable-looking read from 13h ago demotes to Not assessed (${onStale.cls})`);

  // ---- B7 escalation half, regression guard: staleness never DOWNGRADES an already-critical/
  // review verdict — a patient the board already flagged stays flagged, old data or not ----
  const onStaleCritical = await J(`
    ${clearRoster}
    var real = Date.now;
    Date.now = function(){ return real() - 13 * 3600000; };
    ICU.reset(); ICU.ingestPatient({ name: "Stale Critical", bed: "8" });
    ICU.ingestMonitor({ hr: 130, sbp: 80, dbp: 45, spo2: 85, rr: 30, temp: 37, gcs: 15 });
    Date.now = real;
    ICU.savePatient();
    ICU.open();
    ${cardInfo}
  `);
  ok(/\bcritical\b/.test(onStaleCritical.cls), `B7 regression guard: a genuinely critical patient stays critical even on 13h-old data, never demoted (${onStaleCritical.cls})`);

  // ---- fresh, complete, normal vitals: still reads Stable (v2 engine doesn't over-trigger) ----
  const onFreshNormal = await J(`
    ${clearRoster}
    ICU.reset(); ICU.ingestPatient({ name: "Well", bed: "1" });
    ICU.ingestMonitor({ hr: 78, sbp: 118, dbp: 74, spo2: 98, rr: 14, temp: 37, gcs: 15 });
    ICU.savePatient();
    ICU.open();
    ${cardInfo}
  `);
  ok(/\bstable\b/.test(onFreshNormal.cls), `flag ON: a genuinely well, fully-charted, fresh patient still reads Stable — no false escalation (${onFreshNormal.cls})`);

  console.log(fails === 0 ? "\nALL GREEN — B2/B3/B7-escalation acuity v2 engine (flag-gated, OFF by default) working correctly" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
