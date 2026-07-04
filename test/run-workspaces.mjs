/* StewardMD — Specialty Workspaces test harness.
 *
 * WHY: the Specialty Workspaces feature (workspaces.js + ws-*.js engines) is a
 * flag-gated (smd_workspaces, default OFF) additive layer. It must (a) be a total
 * no-op when the flag is off, (b) never touch the Internal Medicine engine, and
 * (c) keep every specialty engine advisory-only — deterministic routing, valid
 * management ladder, IM stays primary on shared conditions, and NEVER a drug dose.
 * This drives the REAL modules headlessly and asserts those invariants.
 *
 * USAGE:  CHROME_BIN=... CHROME_FLAGS="--headless=new --no-sandbox ..." node test/run-workspaces.mjs
 * Requires a local static server on $BASE (auto-spawned) and Chrome.
 * NOT shipped to users — development/test tooling only.
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8799/").replace(/\/?$/, "/");
const CHROME = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9361;
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ws-chrome-prof";

const EXPECT_ENGINES = ["surgery", "ent", "ophthalmology", "obstetrics_gynaecology", "urology", "dentistry_omfs", "paediatrics"];

// auto-spawn static server if BASE unreachable
let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  if (!/^https?:\/\/localhost/.test(BASE)) return;
  const m = BASE.match(/:(\d+)/); const port = m ? m[1] : "8799";
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();

const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return '__ERR__'+x.message}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };

let PASS = 0, FAIL = 0;
function ok(name, cond, extra) { if (cond) { PASS++; console.log("✅ " + name); } else { FAIL++; console.log("❌ " + name + (extra ? "  — " + extra : "")); } }

async function navigate(url) {
  await call("Page.navigate", { url });
  // wait for reasoning engine to be present (proves the app booted)
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    const r = await ev(`return !!(window.DX && window.DX.openWorkspace);`);
    if (r === true) return true;
  }
  return false;
}

try {
  let ver, t = 0;
  while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome devtools endpoint never came up");
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Network.enable", {}); await call("Network.setCacheDisabled", { cacheDisabled: true });

  /* ───────────── FLAG OFF ───────────── */
  console.log("\n── flag OFF (?workspaces=0) — must be a total no-op ──");
  if (!await navigate(BASE + "?workspaces=0")) throw new Error("app did not boot (flag off)");
  await sleep(300);
  ok("flag off: window.SMD_WS is undefined (IIFE bailed, zero footprint)", (await ev(`return typeof window.SMD_WS==='undefined';`)) === true);
  ok("flag off: no .sw-* DOM injected", (await ev(`return document.querySelectorAll('.sw-sbsw,.sw-sheet,.sw-shell,.sw-scrim,#sw-css').length;`)) === 0);
  ok("flag off: Internal Medicine engine intact (DX.openWorkspace + _differential)", (await ev(`return !!(window.DX && typeof DX.openWorkspace==='function' && DX._differential);`)) === true);

  /* ───────────── FLAG ON ───────────── */
  console.log("\n── flag ON (?workspaces=1) ──");
  if (!await navigate(BASE + "?workspaces=1")) throw new Error("app did not boot (flag on)");
  await sleep(500);

  ok("flag on: SMD_WS public API present (open/suggest/registry)", (await ev(`return !!(window.SMD_WS && SMD_WS.open && SMD_WS.suggest && SMD_WS.registry);`)) === true);

  const reg = await ev(`return JSON.stringify((window.SMD_WS.registry||[]).map(function(r){return {id:r.id,status:r.status};}));`);
  const regArr = JSON.parse(reg || "[]");
  ok("registry has 8 specialties", regArr.length === 8, "got " + regArr.length);
  ok("Internal Medicine is the canonical (protected) default", regArr.some(r => r.id === "internal_medicine" && r.status === "canonical"));
  ok("other 7 specialties are early_access", regArr.filter(r => r.id !== "internal_medicine").every(r => r.status === "early_access"));

  const engKeys = JSON.parse(await ev(`return JSON.stringify(Object.keys(window.SMD_WS_ENGINES||{}));`) || "[]");
  for (const e of EXPECT_ENGINES) ok("engine registered: " + e, engKeys.indexOf(e) !== -1);
  ok("internal_medicine is NOT a pluggable engine (stays the real DX engine)", engKeys.indexOf("internal_medicine") === -1);

  /* auto-select: determinism + correctness */
  console.log("\n── auto-select (deterministic routing) ──");
  const ROUTES = [
    { t: "acute abdomen with guarding and rebound", id: "surgery" },
    { t: "post-op wound with purulent discharge", id: "surgery" },
    { t: "sore throat with tonsillar exudate and fever", id: "ent" },
    { t: "ear discharge and post-auricular swelling", id: "ent" },
    { t: "red painful eye with photophobia and blurred vision", id: "ophthalmology" },
    { t: "pelvic pain with vaginal discharge in pregnancy", id: "obstetrics_gynaecology" },
    { t: "dysuria and frequency with burning micturition", id: "urology" },
    { t: "severe tooth pain with facial swelling and gum abscess", id: "dentistry_omfs" },
    { t: "fever cough and breathlessness in an adult", id: "internal_medicine" },
    { t: "", id: "internal_medicine" }
  ];
  for (const r of ROUTES) {
    const a = JSON.parse(await ev(`return JSON.stringify(window.SMD_WS.suggest(${JSON.stringify(r.t)}));`));
    const b = JSON.parse(await ev(`return JSON.stringify(window.SMD_WS.suggest(${JSON.stringify(r.t)}));`));
    ok(`route "${r.t.slice(0, 40) || "(empty)"}" → ${r.id}`, a.id === r.id, "got " + a.id);
    ok(`route deterministic: "${(r.t || "(empty)").slice(0, 28)}"`, JSON.stringify(a) === JSON.stringify(b));
  }

  /* shared bridges: Internal Medicine stays PRIMARY (no duplication) */
  console.log("\n── shared conditions (Internal Medicine primary) ──");
  const SHAREDROUTE = [
    "fever jaundice and right upper quadrant pain",
    "liver abscess not responding to treatment",
    "colitis with toxic megacolon and perforation"
  ];
  for (const s of SHAREDROUTE) {
    const a = JSON.parse(await ev(`return JSON.stringify(window.SMD_WS.suggest(${JSON.stringify(s)}));`));
    ok(`shared "${s.slice(0, 34)}" → IM primary + consult`, a.id === "internal_medicine" && !!a.shared, "id=" + a.id + " shared=" + !!a.shared);
  }
  for (const sid2 of ["cholangitis", "liver_abscess", "colitis"]) {
    const r = JSON.parse(await ev(`
      var syn=(SMD_WS_ENGINES.surgery.syndromes||[]).filter(function(s){return s.id===${JSON.stringify(sid2)};})[0];
      if(!syn) return JSON.stringify({miss:1});
      var set=new Set((syn.q||[]).map(function(q){return q.id;}));
      set.has=Set.prototype.has.bind(set);
      return JSON.stringify(syn.assess(set)||{});`));
    ok(`surgery '${sid2}' assess → shared:true (IM primary)`, r.shared === true);
  }

  /* every engine × every syndrome: valid, non-throwing management output */
  console.log("\n── engine output integrity (all syndromes) ──");
  const integrity = JSON.parse(await ev(`
    var bad=[], doseHits=[], synCount=0;
    var DOSE=/\\b\\d+(?:\\.\\d+)?\\s?(?:mg|mcg|microgram|g|iu|units?)\\b/i, MGKG=/mg\\s?\\/\\s?kg/i;
    Object.keys(SMD_WS_ENGINES).forEach(function(eid){
      var eng=SMD_WS_ENGINES[eid];
      (eng.syndromes||[]).forEach(function(syn){
        synCount++;
        var ids=[].concat((syn.q||[]).map(function(x){return x.id;})).concat((syn.danger||[]).map(function(x){return x.id;}));
        // three selection profiles: none, all questions, all danger
        var profiles=[[], (syn.q||[]).map(function(x){return x.id;}), (syn.danger||[]).map(function(x){return x.id;}), ids];
        profiles.forEach(function(prof){
          var set=new Set(prof); set.has=Set.prototype.has.bind(set);
          var r;
          try{ r=syn.assess(set)||{}; }catch(e){ bad.push(eid+'/'+syn.id+' THREW '+e.message); return; }
          var okShape = (typeof r.emergency==='boolean') && (typeof r.ladder==='number') && r.ladder>=0 && r.ladder<=5 && Math.floor(r.ladder)===r.ladder && typeof r.catg==='string' && r.catg.length>0;
          if(!okShape) bad.push(eid+'/'+syn.id+' bad-shape ladder='+r.ladder+' catg='+(r.catg||'').slice(0,20));
          var txt=[r.catg,r.sc,r.ref].concat(r.mgmt||[]).join(' || ');
          if(DOSE.test(txt)||MGKG.test(txt)) doseHits.push(eid+'/'+syn.id+': '+(txt.match(DOSE)||txt.match(MGKG))[0]);
        });
      });
    });
    return JSON.stringify({synCount:synCount, bad:bad, doseHits:doseHits});
  `));
  ok(`all syndromes return a valid ladder(0-5)/catg/emergency shape (${integrity.synCount} syndromes)`, integrity.bad.length === 0, integrity.bad.slice(0, 4).join(" ; "));
  ok("GUARDRAIL: no engine ever emits a numeric drug dose (mg/mcg/g/IU/mg·kg)", integrity.doseHits.length === 0, integrity.doseHits.slice(0, 4).join(" ; "));

  /* emergency red-flags fire */
  console.log("\n── emergency escalation spot-checks ──");
  const EMERG = [
    ["surgery", "nec_sti", []], ["ent", "epiglottitis", []],
    ["ophthalmology", "aacg", null], ["obstetrics_gynaecology", "septic_abortion", null],
    ["urology", "fournier_gangrene", null], ["paediatrics", "suspected_meningitis_sepsis", null]
  ];
  for (const [eid, sid3] of EMERG) {
    const r = JSON.parse(await ev(`
      var eng=SMD_WS_ENGINES[${JSON.stringify(eid)}]; if(!eng) return JSON.stringify({miss:1});
      var syn=(eng.syndromes||[]).filter(function(s){return s.id===${JSON.stringify(sid3)};})[0]; if(!syn) return JSON.stringify({miss:1});
      var all=[].concat((syn.q||[]).map(function(x){return x.id;})).concat((syn.danger||[]).map(function(x){return x.id;}));
      var set=new Set(all); set.has=Set.prototype.has.bind(set);
      return JSON.stringify(syn.assess(set)||{});`));
    ok(`${eid}/${sid3} → emergency + ladder 5`, r.emergency === true && r.ladder === 5, "emergency=" + r.emergency + " ladder=" + r.ladder);
  }

  /* watermark accessibility + specialty shell */
  console.log("\n── branch watermark (decorative, non-interactive) ──");
  await ev(`window.SMD_WS.open(); return 1;`); await sleep(400);
  await ev(`var b=document.querySelector('.sw-opt[data-ws="surgery"]'); if(b) b.click(); return 1;`); await sleep(500);
  ok("specialty shell opened (#swShell.on)", (await ev(`return !!document.querySelector('#swShell.on');`)) === true);
  ok("watermark present (.sw-wm)", (await ev(`return !!document.querySelector('#swShell .sw-wm');`)) === true);
  ok("watermark is aria-hidden (screen-reader safe)", (await ev(`var w=document.querySelector('#swShell .sw-wm'); if(!w) return false; return w.getAttribute('aria-hidden')==='true' || !!w.querySelector('[aria-hidden="true"]');`)) === true);
  ok("watermark is non-interactive (pointer-events:none)", (await ev(`var w=document.querySelector('#swShell .sw-wm'); return w? getComputedStyle(w).pointerEvents==='none' : false;`)) === true);
  ok("shell shows the Internal-Medicine escape hatch", (await ev(`return !!document.querySelector('#swShell #swToIM');`)) === true);

  /* Internal Medicine path still opens the real reasoning engine */
  console.log("\n── Internal Medicine reachability (protected default) ──");
  await ev(`try{document.querySelector('#swShell #swToIM').click();}catch(e){} return 1;`); await sleep(600);
  ok("switching to Internal Medicine opens the real reasoning overlay (#dxOverlay.on)", (await ev(`return !!document.querySelector('#dxOverlay.on');`)) === true);

  console.log(`\n${FAIL === 0 ? "ALL GREEN — Specialty Workspaces invariants hold (" + PASS + " checks)" : FAIL + " FAILED, " + PASS + " passed"}`);
  if (FAIL > 0) process.exitCode = 1;
  ws.close();
} catch (e) {
  console.error("HARNESS ERROR:", e.message);
  process.exitCode = 2;
} finally {
  chrome.kill("SIGKILL");
  if (serveProc) serveProc.kill("SIGKILL");
}
