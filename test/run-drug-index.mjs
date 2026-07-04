/* Drug Interactions redesign — Drug Index search + workflow + ruleset repair.
 *
 * Proves the rebuilt medication-safety screen: the on-device Drug Index search
 * actually returns results (generic + brand alias), selecting adds a med, duplicates
 * are warned, the sheets open only on demand, the Ward-Sync card guides patient
 * selection, the sticky CTA behaves, the Home FAB is hidden, and the repaired
 * interaction ruleset fires the previously-missed clinical interactions.
 *
 * USAGE: BASE=http://localhost:8902/ CHROME=/path/to/chrome node test/run-drug-index.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8902/").replace(/\/?$/, "/");
const PORT = 9381, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/drugindex-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8902"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(async function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  let ready = false; for (let i = 0; i < 60; i++) { await sleep(400); if (await ev(`return !!(window.MEDLIST && MEDLIST.mount && window.MEDDRUGS && MEDDRUGS.searchIndex && window.INTERACTIONS)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("Drug Interactions modules not loaded");

  // ---- 1. Data binding: MEDDRUGS.searchIndex returns real results -------------
  ok(await ev(`return MEDDRUGS.searchIndex("metformin").some(function(r){return r.generic==="Metformin";})`) === true, "searchIndex('metformin') returns Metformin (data binding works)");
  ok(await ev(`return MEDDRUGS.searchIndex("glycomet").some(function(r){return r.generic==="Metformin";})`) === true, "brand alias 'glycomet' maps to the generic Metformin");
  ok(await ev(`return MEDDRUGS.searchIndex("pan").some(function(r){return r.generic==="Pantoprazole";})`) === true, "brand 'pan' maps to Pantoprazole");
  ok(await ev(`return MEDDRUGS.searchIndex("statin").length >= 2`) === true, "class query 'statin' returns multiple statins");
  ok(await ev(`return MEDDRUGS.searchIndex("metfromin").some(function(r){return r.generic==="Metformin";})`) === true, "fuzzy: typo 'metfromin' still finds Metformin");

  // ---- 2. Search sheet opens only on demand, shows results, adds a med --------
  await ev(`MEDLIST.clearAll(); MEDLIST.mount(document.getElementById("ml-test")||(function(){var d=document.createElement("div");d.id="ml-test";document.body.appendChild(d);return d;})()); return 1;`);
  ok(await ev(`return !document.querySelector("#ml-test [data-ml-index-input]")`) === true, "search field is NOT shown until the Search Drug Index card is tapped");
  await ev(`document.querySelector("#ml-test [data-ml-open='index']").click(); return 1;`);
  ok(await ev(`return !!document.querySelector("#ml-test [data-ml-index-input]")`) === true, "tapping Search Drug Index opens the search sheet");
  await ev(`var i=document.querySelector("#ml-test [data-ml-index-input]"); i.value="metformin"; i.dispatchEvent(new Event("input")); return 1;`);
  await sleep(200);
  ok(await ev(`return document.querySelectorAll("#ml-test [data-ml-index-result]").length >= 1`) === true, "searching 'metformin' shows at least one result row");
  ok(await ev(`return /Metformin/i.test(document.querySelector("#ml-test .ml-index-generic").textContent)`) === true, "result row shows the generic name");
  await ev(`document.querySelector("#ml-test [data-ml-index-result]").click(); return 1;`);
  ok(await ev(`return MEDLIST.getList().length === 1 && MEDLIST.getList()[0].generic === "metformin" && MEDLIST.getList()[0].source === "index"`) === true, "selecting a result adds the medicine (source='index')");

  // ---- 3. Duplicate warning ---------------------------------------------------
  await ev(`var i=document.querySelector("#ml-test [data-ml-index-input]"); i.value="glycomet"; i.dispatchEvent(new Event("input")); return 1;`);
  await sleep(150);
  await ev(`var r=document.querySelector("#ml-test [data-ml-index-result]"); if(r) r.click(); return 1;`);
  ok(await ev(`return MEDLIST.getList().length === 1`) === true, "adding the same generic again is prevented (duplicate)");
  ok(await ev(`return /already in the list/i.test((document.getElementById("ml-test").innerText||""))`) === true, "a duplicate warning is surfaced");

  // ---- 4. Type/Paste sheet opens only on demand -------------------------------
  await ev(`MEDLIST.clearAll(); MEDLIST.mount(document.getElementById("ml-test")); return 1;`);
  ok(await ev(`return !document.querySelector("#ml-test [data-ml-paste-input]")`) === true, "paste textarea is NOT shown by default");
  await ev(`document.querySelector("#ml-test [data-ml-open='paste']").click(); return 1;`);
  ok(await ev(`return !!document.querySelector("#ml-test [data-ml-paste-input]")`) === true, "tapping Type / Paste opens the paste sheet");

  // ---- 5. Ward Sync card guides patient selection -----------------------------
  await ev(`MEDLIST.clearAll(); MEDLIST.mount(document.getElementById("ml-test")); return 1;`);
  ok(await ev(`var b=document.querySelector("#ml-test [data-ml-wardsync]"); return !!b && b.disabled===false && /Select patient/i.test(b.textContent)`) === true, "Ward Sync card offers an active 'Select patient' action when no patient is selected");
  ok(await ev(`return /Select a patient to import current medicines/i.test(document.getElementById("ml-test").innerText)`) === true, "Ward Sync card explains what it will import");

  // ---- 6. Sticky CTA behaviour (>= 2 meds) ------------------------------------
  await ev(`MEDLIST.clearAll(); MEDLIST.mount(document.getElementById("ml-test")); return 1;`);
  ok(await ev(`var c=document.getElementById("ml-check"); return !!c && c.disabled===true`) === true, "Check CTA present and disabled on an empty list");
  await ev(`MEDLIST.add(MEDLIST.parseEntry("aspirin 75 od"),"manual"); MEDLIST.mount(document.getElementById("ml-test")); return 1;`);
  ok(await ev(`return document.getElementById("ml-check").disabled === true && /Add at least 2 medicines/i.test(document.getElementById("ml-test").innerText)`) === true, "one medicine: CTA stays disabled with an explanatory hint");
  await ev(`MEDLIST.add(MEDLIST.parseEntry("warfarin 5 od"),"manual"); MEDLIST.mount(document.getElementById("ml-test")); return 1;`);
  ok(await ev(`var c=document.getElementById("ml-check"); return c.disabled===false && /Check 2 medicines/i.test(c.textContent)`) === true, "two medicines: CTA enabled and shows the count");

  // ---- 7. Home/ICU FAB hidden while the overlay is open -----------------------
  await ev(`try{MEDDRUGS.closeInteractions();}catch(e){} return 1;`);
  ok(await ev(`return document.body.classList.contains("smd-ddi-open")===false`) === true, "smd-ddi-open cleared when overlay closed");
  await ev(`MEDDRUGS.openInteractions(); return 1;`);
  ok(await ev(`return document.body.classList.contains("smd-ddi-open")===true`) === true, "opening the overlay sets body.smd-ddi-open (hides floating FABs)");

  // ---- 8. No raw IDs / technical errors surfaced in the search sheet ----------
  await ev(`MEDLIST.clearAll(); MEDLIST.mount(document.getElementById("ml-test")); document.querySelector("#ml-test [data-ml-open='index']").click(); var i=document.querySelector("#ml-test [data-ml-index-input]"); i.value="metformin"; i.dispatchEvent(new Event("input")); return 1;`);
  await sleep(200);
  ok(await ev(`return !/[{}\\[\\]]|undefined|NaN|__err|composition/i.test(document.querySelector("#ml-test .ml-sheet").innerText)`) === true, "search sheet leaks no raw ids / technical tokens");

  // ---- 9. Repaired ruleset: previously-missed clinical interactions fire -------
  function checkPair(a, b) { return ev(`var r=INTERACTIONS.checkInteractions([MEDLIST.parseEntry(${JSON.stringify(a)}),MEDLIST.parseEntry(${JSON.stringify(b)})]); return JSON.stringify({crit:r.critical.length,major:r.major.length,mod:r.moderate.length,mon:r.monitor.length,reviewed:r.reviewedCount});`); }
  ok(await ev(`return MEDLIST.parseEntry("levofloxacin 500 od").generic === "levofloxacin"`) === true, "levofloxacin now resolves as a known generic (was silently skipped before)");
  const ol = JSON.parse(await checkPair("ondansetron 4 tds", "levofloxacin 500 od"));
  ok(ol.reviewed === 2 && ol.major === 1, "ondansetron + levofloxacin -> exactly one QT major finding");
  const pc = JSON.parse(await checkPair("pantoprazole 40 od", "clopidogrel 75 od"));
  ok(pc.reviewed === 2 && (pc.mod + pc.mon) >= 1, "pantoprazole + clopidogrel -> a (monitoring) finding is raised");
  const oc = JSON.parse(await checkPair("omeprazole 20 od", "clopidogrel 75 od"));
  ok(oc.reviewed === 2 && oc.major === 1, "omeprazole + clopidogrel -> a major CYP2C19 finding");
  ok(await ev(`var r=INTERACTIONS.checkInteractions([MEDLIST.parseEntry("ondansetron 4 tds"),MEDLIST.parseEntry("levofloxacin 500 od")]); return r.major.some(function(f){return /qt|torsade|repolaris/i.test((f.effect||"")+(f.mechanism||""));});`) === true, "the ondansetron+levofloxacin finding is QT-related");

  console.log(fails === 0 ? "\nALL GREEN — drug-index / redesign test passed" : `\n${fails} FAILED`);
} catch (e) {
  console.error("FATAL", e && e.message || e); fails++;
} finally {
  try { chrome.kill(); } catch {} try { serveProc && serveProc.kill(); } catch {}
  process.exit(fails ? 1 : 0);
}
