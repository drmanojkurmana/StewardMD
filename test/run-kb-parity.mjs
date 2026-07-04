/* KB P1 parity proof — declarative evaluator vs the live engine closures.
 *
 * Loads the real app (so window.SYNDROMES with its match()/baseScore() closures
 * is present), injects the KB evaluator (kb/engine/evaluator.mjs) + the converted
 * disease objects, then FUZZES thousands of random finding-sets and asserts that
 * for every converted infective syndrome:
 *     SYNDROMES[id].match(e)      === KBEVAL.matches(KB[id], e)
 *     SYNDROMES[id].baseScore(e)  === KBEVAL.baseScore(KB[id], e)
 * i.e. the declarative data reproduces the executable closures exactly. This is
 * the core risk of the Phase-3 migration, de-risked on real syndromes.
 *
 * USAGE: node test/run-kb-parity.mjs   (self-contained: spawns server + Chrome)
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = process.env.BASE || "http://localhost:8799/";
const CHROME = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9352;
const N = 3000; // random finding-sets per syndrome
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/kbparity-chrome";

// auto-discover ALL converted infective diseases (the closure-parity proof targets)
const kb = {};
const INFECTIVE_IDS = [];
for (const f of readdirSync(join(ROOT, "kb", "diseases"))) {
  if (!f.endsWith(".json")) continue;
  const d = JSON.parse(readFileSync(join(ROOT, "kb", "diseases", f), "utf8"));
  if (d.class === "infective") { kb[d.id] = d; INFECTIVE_IDS.push(d.id); }
}
INFECTIVE_IDS.sort();

// --- M3.3 intentional-divergence allowlist ---
// These infective syndromes' KB rule/score were deliberately improved beyond the
// frozen app.js closures (which cannot be edited — minified). They are therefore
// EXEMPT from closure-parity and instead guarded by run-golden + the gold-case
// benchmark (test/run-case-validation.mjs). Every other syndrome must still match
// its closure exactly. Document each addition with the reason.
const DIVERGENCE_ALLOWLIST = {
  CHOLANGITIS: "Recall (pending decision, user-approved): rule/triad-bonus accept fever (not only feverGU) so Charcot-triad cases coded with generic fever match and cholangitis correctly leads + triggers urgent antibiotics + biliary drainage.",
  BRONCHIECTASIS_EXACERBATION: "M3.3: +knownBronchiectasis pathognomonic score modifier so a known-bronchiectasis exacerbation outranks generic CAP.",
  DISSEMINATED_TB: "Recall Tier-3(infective): rule accepts prolongedFever (not only prolongedFeverUnexplained) so miliary-TB cases whose fever is coded as prolongedFever match; +eveningFever score modifier. Guarded by run-golden + gold-case benchmark.",
  C_DIFF: "Recall Tier-3(infective): rule/score accept antibioticsLast90Days & hospitalizationLast90Days as synonyms for priorAntibiotics/hospitalDay48 so C.diff cases coded with the *Last90Days keys match.",
  LUNG_ABSCESS: "Recall Tier-3(infective): rule accepts fever (not only prolongedFever) and coughRadio/prolongedCough2Weeks (not only cough) so cavitating aspiration lung-abscess cases match.",
  LIVER_ABSCESS: "Recall Tier-3(infective): rule gated on singleLesion (the abscess-defining finding, absent in cholangitis/cholecystitis), accepts fever synonym, drops jaundice/Murphy negations, and excludes endemic exposure (that routes to AMOEBIC); +singleLesion/+diabetesHx modifiers.",
  AMOEBIC_LIVER_ABSCESS: "Recall Tier-3(infective): rule accepts fever synonym + contaminatedFoodWaterExposure (not only travelEndemicArea), gated on singleLesion; +contaminatedFoodWaterExposure modifier. Endemic exposure distinguishes amoebic from pyogenic liver abscess.",
};

// evaluator source -> injectable (strip ES export keywords; keep window attach)
let evalSrc = readFileSync(join(ROOT, "kb", "engine", "evaluator.mjs"), "utf8")
  .replace(/export\s+function/g, "function").replace(/export\s+/g, "");

// basic structural sanity of every disease file (cheap schema smoke-check)
let structOk = 0, structBad = [];
for (const f of readdirSync(join(ROOT, "kb", "diseases"))) {
  if (!f.endsWith(".json")) continue;
  const d = JSON.parse(readFileSync(join(ROOT, "kb", "diseases", f), "utf8"));
  const ok = d.id && (d.class === "infective" || d.class === "non_infective") && d.matching &&
    (d.matching.rule || d.matching.find) && d.provenance && d.review && d.version;
  if (ok) structOk++; else structBad.push(f);
}

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  if (!/^https?:\/\/localhost/.test(BASE)) return;
  const port = (BASE.match(/:(\d+)/) || [, "8799"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();

const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: e, returnByValue: true }); if (r.result && r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.text); return r.result && r.result.result ? r.result.result.value : null; };

try {
  let ver, t = 0;
  while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 40; i++) { await sleep(500); if (await ev(`!!(window.SYNDROMES && Object.keys(SYNDROMES).length)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("SYNDROMES not loaded");

  // inject evaluator + KB
  await call("Runtime.evaluate", { expression: evalSrc });
  await ev(`window.__KB = ${JSON.stringify(kb)}; true;`);
  const haveEval = await ev(`!!(window.KBEVAL && window.KBEVAL.matches && window.KBEVAL.baseScore)`);
  if (!haveEval) throw new Error("evaluator did not inject");

  console.log(`structural sanity: ${structOk} disease files OK${structBad.length ? ", BAD: " + structBad.join(",") : ""}`);
  console.log(`fuzzing ${N} random finding-sets per syndrome against the live closures…\n`);

  let totalMismatch = 0;
  for (const id of INFECTIVE_IDS) {
    if (DIVERGENCE_ALLOWLIST[id]) { console.log(`➖ ${id.padEnd(15)} intentional divergence (guarded by golden + benchmark): ${DIVERGENCE_ALLOWLIST[id]}`); continue; }
    const present = await ev(`!!(window.SYNDROMES['${id}'] && window.SYNDROMES['${id}'].match && window.SYNDROMES['${id}'].baseScore && window.__KB['${id}'])`);
    if (!present) { console.log(`⚠️  ${id}: not present in live SYNDROMES — skipped`); continue; }
    const out = await ev(`(function(){
      var s = window.SYNDROMES['${id}'], kb = window.__KB['${id}'];
      var src = s.match.toString() + ' ' + s.baseScore.toString();
      var keys = {}, re=/\\.([a-zA-Z_][\\w]*)/g, m;
      while((m=re.exec(src))){ var k=m[1]; if(k!=='toString'&&k!=='match'&&k!=='baseScore') keys[k]=true; }
      var keyList = Object.keys(keys);
      var mism = [], checked = 0;
      for(var n=0;n<${N};n++){
        var e = {};
        for(var j=0;j<keyList.length;j++){ var k=keyList[j];
          if(k==='curb65'){ if(Math.random()<0.6) e[k]=Math.floor(Math.random()*4); }
          else if(Math.random()<0.5) e[k]=true;
        }
        var cm=!!s.match(e), km=!!window.KBEVAL.matches(kb,e);
        var cb=s.baseScore(e), kbv=window.KBEVAL.baseScore(kb,e);
        checked++;
        if(cm!==km || cb!==kbv){ if(mism.length<4) mism.push({e:e,closure_match:cm,kb_match:km,closure_score:cb,kb_score:kbv}); }
      }
      return JSON.stringify({keys:keyList, checked:checked, mismatches:mism, mismatchCount:(function(){var c=0;return c;})()});
    })()`);
    const r = JSON.parse(out);
    // recount mismatches precisely (mism capped at 4 for display; recompute count)
    const mismCount = await ev(`(function(){
      var s=window.SYNDROMES['${id}'], kb=window.__KB['${id}'];
      var src=s.match.toString()+' '+s.baseScore.toString();
      var keys={},re=/\\.([a-zA-Z_][\\w]*)/g,m; while((m=re.exec(src))){var k=m[1];if(k!=='toString'&&k!=='match'&&k!=='baseScore')keys[k]=true;}
      var keyList=Object.keys(keys), bad=0;
      for(var n=0;n<${N};n++){ var e={};
        for(var j=0;j<keyList.length;j++){var k=keyList[j]; if(k==='curb65'){if(Math.random()<0.6)e[k]=Math.floor(Math.random()*4);} else if(Math.random()<0.5)e[k]=true; }
        if(!!s.match(e)!==!!window.KBEVAL.matches(kb,e) || s.baseScore(e)!==window.KBEVAL.baseScore(kb,e)) bad++;
      }
      return bad;
    })()`);
    totalMismatch += mismCount;
    if (mismCount === 0) console.log(`✅ ${id.padEnd(15)} ${N} cases, keys=[${r.keys.join(",")}] — match() & baseScore() IDENTICAL`);
    else { console.log(`❌ ${id.padEnd(15)} ${mismCount}/${N} MISMATCHES. examples:`); (r.mismatches || []).forEach(x => console.log("     " + JSON.stringify(x))); }
  }

  console.log(`\n${totalMismatch === 0 && structBad.length === 0 ? "ALL GREEN — declarative KB is behavior-equivalent to the live closures" : "FAILURES present"}`);
  if (totalMismatch > 0 || structBad.length) process.exitCode = 1;
  ws.close();
} catch (e) {
  console.error("PARITY HARNESS ERROR:", e.message);
  process.exitCode = 2;
} finally {
  chrome.kill("SIGKILL");
  if (serveProc) serveProc.kill("SIGKILL");
}
