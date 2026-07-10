/* Drug-interaction engine — deterministic checkInteractions (PR 2).
 *
 * Verifies window.INTERACTIONS.checkInteractions(meds, context) is a PURE
 * deterministic function that evaluates window.INTERACTION_RULES against a
 * medication list and returns severity-bucketed findings. Mirrors the CDP
 * harness of test/run-medlist.mjs.
 *
 * USAGE: BASE=http://localhost:8971/ node test/run-interactions.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8971/").replace(/\/?$/, "/");
const PORT = 9377, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/interactions-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8971"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(async function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

// Helper: run checkInteractions in-page and return the parsed result.
const check = async (meds, ctx) => JSON.parse(await ev(`return JSON.stringify(INTERACTIONS.checkInteractions(${JSON.stringify(meds)}${ctx ? "," + JSON.stringify(ctx) : ""}))`));

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  let ready = false; for (let i = 0; i < 60; i++) { await sleep(400); if (await ev(`return !!(window.INTERACTIONS && INTERACTIONS.checkInteractions)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("INTERACTIONS not loaded");

  // 1. warfarin + aspirin + ibuprofen -> critical OR major bleeding finding
  const r1 = await check([{ generic: "warfarin" }, { generic: "aspirin" }, { generic: "ibuprofen" }]);
  ok((r1.critical.length + r1.major.length) > 0, "warfarin+aspirin+ibuprofen yields a critical or major finding");
  ok([].concat(r1.critical, r1.major).some(f => /bleed|haemorrh|hemorrh/i.test((f.effect || "") + (f.mechanism || ""))), "warfarin+aspirin+ibuprofen finding is bleeding-related");
  ok(r1.reviewedCount === 3, "warfarin+aspirin+ibuprofen reviewedCount === 3");

  // 2. ramipril + furosemide + ibuprofen -> major AKI 'triple whammy' combination
  const r2 = await check([{ generic: "ramipril" }, { generic: "furosemide" }, { generic: "ibuprofen" }]);
  ok(r2.major.some(f => /kidney|renal|aki/i.test((f.effect || "") + (f.mechanism || ""))), "ramipril+furosemide+ibuprofen yields a major AKI finding");
  ok(r2.combinations.length > 0 && r2.combinations.some(f => f.ruleType === "combination"), "ramipril+furosemide+ibuprofen surfaces a combination finding");

  // 3. ondansetron + haloperidol -> QT caution (major or monitor)
  const r3 = await check([{ generic: "ondansetron" }, { generic: "haloperidol" }]);
  ok((r3.major.length + r3.monitor.length) > 0, "ondansetron+haloperidol yields a QT major/monitor finding");
  ok([].concat(r3.major, r3.monitor).some(f => /qt|torsade|repolaris/i.test((f.effect || "") + (f.mechanism || ""))), "ondansetron+haloperidol finding is QT-related");

  // 4. ibuprofen + diclofenac -> duplicate_class NSAID in duplicates[]
  const r4 = await check([{ generic: "ibuprofen" }, { generic: "diclofenac" }]);
  ok(r4.duplicates.some(f => f.ruleType === "duplicate_class"), "ibuprofen+diclofenac yields a duplicate_class finding in duplicates[]");
  ok(r4.duplicates.some(f => /nsaid/i.test((f.mechanism || "") + (f.effect || ""))), "ibuprofen+diclofenac duplicate is NSAID-related");

  // 5. Sildenafil 50mg added twice -> one clinical medicine, no duplicate alert.
  const r5 = await check([{ generic: "sildenafil", strength: 50 }, { generic: "sildenafil", strength: 50 }]);
  ok(r5.reviewedCount === 1, "Sildenafil 50mg added twice -> reviewedCount is 1");
  ok(r5.duplicates.length === 0, "Sildenafil 50mg added twice -> no duplicate alert");

  // 5b. Sildenafil generic entry + Sildenafil 50mg product entry -> one clinical medicine for interaction checking.
  const r5b = await check([{ generic: "sildenafil" }, { generic: "sildenafil", strength: 50 }]);
  ok(r5b.duplicates.length === 0, "Sildenafil generic + Sildenafil 50mg -> no duplicate alert");

  // 5c. Sildenafil + nitroglycerin -> one valid interaction, with no repeated drug name.
  const r5c = await check([{ generic: "sildenafil" }, { generic: "nitroglycerin" }, { generic: "sildenafil", strength: 50 }]);
  const criticalC = r5c.critical || [];
  ok(criticalC.length > 0, "Sildenafil + nitroglycerin -> triggers critical interaction");
  ok(criticalC.every(f => {
    const seen = {};
    return f.drugs.every(d => {
      if (seen[d]) return false;
      seen[d] = true;
      return true;
    });
  }), "nitroglycerin + sildenafil has no repeated drug name in one interaction title");

  // 5d. Sildenafil + pantoprazole -> no duplicate-therapy alert.
  const r5d = await check([{ generic: "sildenafil" }, { generic: "pantoprazole" }]);
  ok(r5d.duplicates.length === 0, "Sildenafil + pantoprazole -> no duplicate-therapy alert");

  // 5e. Pantoprazole 40mg + Pantoprazole 80mg -> no automatic duplicate-therapy alert solely due to same ingredient.
  const r5e = await check([{ generic: "pantoprazole", strength: 40 }, { generic: "pantoprazole", strength: 80 }]);
  ok(r5e.duplicates.length === 0, "Pantoprazole 40mg + Pantoprazole 80mg -> no duplicate-therapy alert");

  // 6. amlodipine alone -> no critical/major, reviewedCount 1
  const r6 = await check([{ generic: "amlodipine" }]);
  ok(r6.critical.length === 0 && r6.major.length === 0, "amlodipine alone yields NO critical/major");
  ok(r6.reviewedCount === 1, "amlodipine alone reviewedCount === 1");

  // 7. findings never contain raw JSON / sourceId / provider strings; source is a human title
  const blob = JSON.stringify([r1, r2, r3, r4, r5]);
  ok(!/onc-nlm-hpddi|openfda-labeling|crediblemeds-qtdrugs/.test(blob), "findings never leak internal sourceId strings");
  ok(!/sourceId/.test(blob), "findings never carry a raw sourceId field");
  const knownTitles = JSON.parse(await ev(`return JSON.stringify(INTERACTION_RULES.sources.map(function(s){return s.title}))`));
  const allFindings = [].concat(r1.critical, r1.major, r2.major, r2.combinations, r3.major, r3.monitor);
  ok(allFindings.every(f => typeof f.source === "string" && knownTitles.indexOf(f.source) !== -1), "each finding source is a human-readable source title (matches a declared source title, never an id slug)");

  // Unconfirmed meds (no generic) are skipped and do not count toward reviewedCount
  const r7 = await check([{ generic: "aspirin" }, { generic: null }, { raw: "piptaz" }]);
  ok(r7.reviewedCount === 1, "meds with no generic are skipped (reviewedCount excludes them)");

  // Context rule: NSAID + renalImpairment fires a major context finding
  const r8 = await check([{ generic: "ibuprofen" }], { renalImpairment: true });
  ok(r8.major.some(f => f.ruleType === "context"), "NSAID + renalImpairment context flag fires a major context finding");

  // Home landing tile: home.js source declares the additive Drug Interactions tile,
  // MEDDRUGS.openInteractions is a function, and the delegate opens the overlay.
  const { readFileSync } = await import("node:fs");
  const homeSrc = readFileSync(join(HERE, "..", "home.js"), "utf8");
  ok(/data-act="interactions"/.test(homeSrc), "home.js source contains the data-act=\"interactions\" tile");
  ok(/Drug Interactions/.test(homeSrc), "home.js Drug Interactions tile has its label");
  ok(await ev(`return typeof (window.MEDDRUGS && MEDDRUGS.openInteractions)`) === "function", "MEDDRUGS.openInteractions is a function");
  // Simulate the home action delegate: invoke openInteractions and confirm the overlay is present.
  const opened = await ev(`if(!(window.MEDDRUGS&&MEDDRUGS.openInteractions))return false;MEDDRUGS.openInteractions();var o=document.getElementById("miOverlay");return !!(o&&o.classList.contains("on"));`);
  ok(opened === true, "invoking MEDDRUGS.openInteractions opens the interactions overlay (#miOverlay.on)");

  // 9. REGRESSION (the reported miss): sildenafil + nitroglycerin(IV) + nifedipine.
  //    Previously returned 0 findings (all three were absent/unclassified) and the UI
  //    showed a green "no issue". After the pipeline expansion these must fire.
  const r9 = await check([{ generic: "sildenafil" }, { generic: "nitroglycerin" }, { generic: "nifedipine" }]);
  ok(r9.reviewedCount === 3, "sildenafil+nitroglycerin+nifedipine reviewedCount === 3 (all resolved)");
  ok(r9.critical.some(f => /nitrate|nitro/i.test((f.drugs || []).join(" ") + f.mechanism) && /pde5|sildenafil/i.test((f.drugs || []).join(" ") + f.mechanism)),
     "nitroglycerin + sildenafil surfaces a CONTRAINDICATED (critical) nitrate×PDE5i finding");
  ok(r9.critical.some(f => /fatal|hypotension/i.test((f.effect || "") + (f.mechanism || ""))),
     "the nitrate×PDE5i finding warns of severe/fatal hypotension");
  const nifSil = [].concat(r9.moderate, r9.monitor, r9.major).some(f => {
    const d = (f.drugs || []).join(" ").toLowerCase();
    return d.includes("nifedipine") && d.includes("sildenafil");
  });
  ok(nifSil, "nifedipine + sildenafil surfaces a monitor/moderate finding");
  ok(r9.coverage && r9.coverage.unchecked.length === 0 && r9.coverage.reviewedCount === 3,
     "coverage reports all 3 medicines checked, none unchecked");

  // 9b. Coverage: an unrecognised medicine is recorded (never silently dropped).
  const r9b = await check([{ generic: "sildenafil" }, { raw: "zzznotadrug", generic: null }]);
  ok(r9b.coverage && r9b.coverage.unchecked.length === 1 && /zzznotadrug/i.test(r9b.coverage.unchecked[0]),
     "an unrecognised entry is surfaced in coverage.unchecked, not silently skipped");

  // 9c. Brand path: 'Viagra' + a nitrate brand must still catch the contraindication.
  const r9c = JSON.parse(await ev(`
    if(!(window.MEDLIST && MEDLIST.parseEntry)) return JSON.stringify({__noMedlist:true});
    var a=MEDLIST.parseEntry("Viagra 50 mg"); var b=MEDLIST.parseEntry("nitroglycerin infusion");
    var res=INTERACTIONS.checkInteractions([a,b]);
    return JSON.stringify({ aGen:a.generic, bGen:b.generic, crit:res.critical.length });`));
  ok(r9c.aGen === "sildenafil", "brand 'Viagra' resolves to sildenafil via INTERACTION_RULES.brands");
  ok(r9c.crit >= 1, "Viagra (brand) + nitroglycerin fires the contraindicated nitrate×PDE5i rule");

  // 10. CYP3A4 stratification (clinician-directed): strength-aware, substrate-specific.
  const c1 = await check([{ generic: "clarithromycin" }, { generic: "simvastatin" }]);
  ok(c1.critical.some(f => f.ruleType === "pair" && /simvastatin/i.test((f.drugs || []).join(" ")) && /myopathy|rhabdo/i.test((f.effect || "") + (f.action || ""))),
     "strong CYP3A4 inhibitor + simvastatin is CONTRAINDICATED (critical)");
  const c2 = await check([{ generic: "clarithromycin" }, { generic: "atorvastatin" }]);
  ok(c2.major.length > 0 && c2.critical.length === 0,
     "strong CYP3A4 inhibitor + atorvastatin is Major (not contraindicated)");
  const c3 = await check([{ generic: "ketoconazole" }, { generic: "tacrolimus" }]);
  ok(c3.major.some(f => /tacrolimus|calcineurin/i.test((f.drugs || []).join(" ") + f.mechanism)),
     "strong CYP3A4 inhibitor + calcineurin inhibitor is Major");
  const c4 = await check([{ generic: "erythromycin" }, { generic: "simvastatin" }]);
  ok(c4.critical.length === 0,
     "MODERATE CYP3A4 inhibitor (erythromycin) + simvastatin does NOT fire the strong-inhibitor contraindication (no alert-fatigue)");

  console.log(fails === 0 ? "\nALL GREEN — interactions engine test passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
