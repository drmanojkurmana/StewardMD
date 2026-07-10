/* Medication list builder — deterministic free-text parser (PR 1, Task 1/N).
 *
 * Verifies MEDLIST.parseEntry mechanically extracts strength/unit/form/route/freq
 * and the residual drug name from free-text medication entries. Generic-name
 * resolution and confidence scoring are added in Task 2 and are NOT asserted here.
 *
 * USAGE: BASE=http://localhost:8902/ node test/run-medlist.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8902/").replace(/\/?$/, "/");
const PORT = 9376, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/medlist-chrome";
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
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Runtime.consoleAPICalled") {
      console.log("BROWSER CONSOLE:", m.params.args.map(a => a.value !== undefined ? a.value : JSON.stringify(a)).join(" "));
    } else if (m.method === "Runtime.exceptionThrown") {
      console.error("BROWSER EXCEPTION:", JSON.stringify(m.params.exceptionDetails));
    }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  let ready = false; for (let i = 0; i < 60; i++) { await sleep(400); if (await ev(`return !!(window.MEDLIST && MEDLIST.parseEntry)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("MEDLIST not loaded");

  const p1 = JSON.parse(await ev(`return JSON.stringify(MEDLIST.parseEntry("Tab amlodipine 5 mg OD"))`));
  ok(p1.strength === 5 && p1.unit === "mg" && p1.form === "tablet" && p1.freq === "OD", "parse 'Tab amlodipine 5 mg OD' — strength/unit/form/freq");
  ok(p1.name === "amlodipine", "parse 'Tab amlodipine 5 mg OD' — residual name");

  const p2 = JSON.parse(await ev(`return JSON.stringify(MEDLIST.parseEntry("metformin 500 bd"))`));
  ok(p2.strength === 500 && p2.freq === "BD", "parse 'metformin 500 bd' — strength/freq");
  ok(p2.name === "metformin", "parse 'metformin 500 bd' — residual name");

  const p3 = JSON.parse(await ev(`return JSON.stringify(MEDLIST.parseEntry("inj ceftriaxone 1 g iv bd"))`));
  ok(p3.strength === 1 && p3.unit === "g" && p3.route === "IV" && p3.form === "injection", "parse 'inj ceftriaxone 1 g iv bd' — strength/unit/route/form");
  ok(p3.name === "ceftriaxone", "parse 'inj ceftriaxone 1 g iv bd' — residual name");

  const p4 = JSON.parse(await ev(`return JSON.stringify(MEDLIST.parseEntry("dextrose 5% iv"))`));
  ok(p4.strength === 5 && p4.unit === "%" && p4.route === "IV", "parse 'dextrose 5% iv' — percent-concentration unit/route");

  const e = JSON.parse(await ev(`return JSON.stringify(MEDLIST.parseEntry("T. Ecosprin 75"))`));
  ok(e.generic === "aspirin" && e.confidence === "high", "'Ecosprin' -> aspirin");
  const pz = JSON.parse(await ev(`return JSON.stringify(MEDLIST.parseEntry("Piptaz 4.5 q6h"))`));
  ok(pz.generic === null && pz.candidates.some(c => c.generic.indexOf("piperacillin") === 0), "'Piptaz' stays unmapped w/ candidate (needs confirm)");

  const om = JSON.parse(await ev(`return JSON.stringify(MEDLIST.parseEntry("omez 20 od"))`));
  ok(om.generic === "omeprazole" && om.confidence === "high", "'omez' (formulary brand alias, not in BRAND_SEED) -> omeprazole");
  const am = JSON.parse(await ev(`return JSON.stringify(MEDLIST.parseEntry("amlodipine 5 od"))`));
  ok(am.generic === "amlodipine" && am.confidence === "high", "'amlodipine' (known generic via formulary, not in BRAND_SEED) -> amlodipine");

  const list = JSON.parse(await ev(`return JSON.stringify(MEDLIST.parsePasted("1. Tab Amlodipine 5 mg OD\\n2) Metformin 500 BD\\n- T. Ecosprin 75"))`));
  ok(list.length === 3 && list[0].generic === "amlodipine" && list[2].generic === "aspirin", "paste 3-line list parses each");

  // --- Task 4: list state (add/remove/undo/clear, session-scoped) ---
  await ev(`MEDLIST.clearAll(); MEDLIST.add(MEDLIST.parseEntry("metformin 500 bd"),"manual"); return 1;`);
  ok(await ev(`return MEDLIST.getList().length`) === 1, "add -> 1 med");
  const rid = await ev(`return MEDLIST.getList()[0].id`);
  await ev(`MEDLIST.remove(${JSON.stringify(rid)}); return 1;`);
  ok(await ev(`return MEDLIST.getList().length`) === 0, "remove -> 0");
  await ev(`MEDLIST.undoRemove(); return 1;`);
  ok(await ev(`return MEDLIST.getList().length`) === 1, "undoRemove -> 1");

  // Edge case: undoRemove with nothing to undo is a no-op (does not throw, does not duplicate)
  await ev(`MEDLIST.clearAll(); MEDLIST.add(MEDLIST.parseEntry("metformin 500 bd"),"manual"); MEDLIST.undoRemove(); return 1;`);
  ok(await ev(`return MEDLIST.getList().length`) === 1, "undoRemove with nothing to undo is a no-op");

  // Edge case: clearAll empties the list and clears any pending undo
  await ev(`MEDLIST.clearAll(); MEDLIST.add(MEDLIST.parseEntry("metformin 500 bd"),"manual"); MEDLIST.add(MEDLIST.parseEntry("aspirin 75 od"),"manual"); return 1;`);
  ok(await ev(`return MEDLIST.getList().length`) === 2, "clearAll setup -> 2 meds");
  await ev(`MEDLIST.clearAll(); return 1;`);
  ok(await ev(`return MEDLIST.getList().length`) === 0, "clearAll -> 0 meds");
  await ev(`MEDLIST.undoRemove(); return 1;`);
  ok(await ev(`return MEDLIST.getList().length`) === 0, "undoRemove after clearAll does not resurrect meds");

  // Each med extends parseEntry() result with id/brand/indication/startDate/source
  await ev(`MEDLIST.clearAll(); MEDLIST.add(MEDLIST.parseEntry("Tab amlodipine 5 mg OD"),"index"); return 1;`);
  const shaped = JSON.parse(await ev(`return JSON.stringify(MEDLIST.getList()[0])`));
  ok(typeof shaped.id === "string" && shaped.id.length > 0, "med has generated id");
  ok(shaped.brand === null && shaped.indication === null && shaped.startDate === null, "med has brand/indication/startDate defaulted to null");
  ok(shaped.source === "index", "med carries the given source");
  ok(shaped.generic === "amlodipine" && shaped.strength === 5 && shaped.unit === "mg" && shaped.form === "tablet" && shaped.freq === "OD", "med retains parseEntry() fields");

  // Persistence: list survives reload via sessionStorage['smd_medlist']
  await ev(`MEDLIST.clearAll(); MEDLIST.add(MEDLIST.parseEntry("aspirin 75 od"),"paste"); return 1;`);
  const stored = JSON.parse(await ev(`return sessionStorage.getItem("smd_medlist")`));
  ok(Array.isArray(stored) && stored.length === 1 && stored[0].source === "paste", "list persisted to sessionStorage['smd_medlist']");
  await call("Page.navigate", { url: BASE });
  for (let i = 0; i < 60; i++) { await sleep(200); if (await ev(`return !!(window.MEDLIST && MEDLIST.getList)`) === true) break; }
  ok(await ev(`return MEDLIST.getList().length`) === 1, "list reloaded from sessionStorage after navigation");
  await ev(`MEDLIST.clearAll(); return 1;`);

  // --- Task 5: UI — mount/render, med cards, no-leak ---
  await ev(`MEDLIST.clearAll(); var d=document.createElement("div"); d.id="ml-test"; document.body.appendChild(d); MEDLIST.mount(d); return 1;`);
  // Redesign: the "Drug Interactions" title + advisory now live in the sticky shell header
  // (drugs.js). The mounted body shows the medication-list empty state + a review summary.
  ok(await ev(`return /Medication list/.test(document.getElementById("ml-test").innerText)`) === true, "empty-state heading renders");
  ok(await ev(`return /Add medicines from Drug Index/.test(document.getElementById("ml-test").innerText)`) === true, "empty-state helper renders");
  ok(await ev(`return /type a prescription, scan a case sheet, or import from Ward Sync/i.test(document.getElementById("ml-test").innerText)`) === true, "empty-state sub renders");
  ok(await ev(`return /Interaction check reviews/i.test(document.getElementById("ml-test").innerText)`) === true, "pre-run review summary renders");
  await ev(`MEDLIST.add(MEDLIST.parseEntry("metformin 500 bd"),"manual"); MEDLIST.mount(document.getElementById("ml-test")); return 1;`);
  ok(await ev(`return /metformin/i.test(document.getElementById("ml-test").innerText)`) === true, "med card renders");
  ok(await ev(`return document.querySelectorAll("#ml-test [data-ml-remove]").length`) === 1, "remove control present");
  ok(await ev(`return document.querySelectorAll("#ml-test [data-ml-edit]").length`) === 1, "edit control present");
  ok(await ev(`return !/\\{|\\}|source_id|provider/i.test(document.getElementById("ml-test").innerText)`) === true, "no raw JSON / source-id / provider text leaks");

  // confidence shown only when source === 'scan'
  await ev(`MEDLIST.clearAll(); MEDLIST.add(Object.assign(MEDLIST.parseEntry("metformin 500 bd"),{confidence:"medium"}),"scan"); MEDLIST.mount(document.getElementById("ml-test")); return 1;`);
  ok(await ev(`return /medium/i.test(document.getElementById("ml-test").innerText)`) === true, "confidence shown for source==='scan'");
  await ev(`MEDLIST.clearAll(); MEDLIST.add(Object.assign(MEDLIST.parseEntry("metformin 500 bd"),{confidence:"medium"}),"manual"); MEDLIST.mount(document.getElementById("ml-test")); return 1;`);
  ok(await ev(`return !/medium/i.test(document.getElementById("ml-test").innerText)`) === true, "confidence hidden for source!=='scan'");

  // remove shows an inline Undo affordance
  await ev(`document.getElementById("ml-test").querySelector("[data-ml-remove]").click(); return 1;`);
  ok(await ev(`return /undo/i.test(document.getElementById("ml-test").innerText)`) === true, "remove shows inline Undo");
  ok(await ev(`return MEDLIST.getList().length`) === 0, "remove actually removes from list");

  // add-option buttons present; Scan is now ENABLED (PR3), Ward Sync still "Coming soon"
  const errVal = await ev(`
    try {
      window.SMD_IS_NATIVE = true;
      MEDLIST.clearAll();
      MEDLIST.mount(document.getElementById("ml-test"));
      return null;
    } catch(e) {
      return String(e.stack || e.message || e);
    }
  `);
  if (errVal) console.log("MOUNT ERROR AT LINE 138:", errVal);
  ok(await ev(`return /Search Drug Index/.test(document.getElementById("ml-test").innerText)`) === true, "'Search Drug Index' option present");
  // Redesign: entry points are action cards; a manual-entry opener carries data-ml-open='manual'.
  ok(await ev(`return !!document.querySelector("#ml-test [data-ml-open='manual']")`) === true, "manual-entry opener present");
  ok(await ev(`return /Paste list/.test(document.getElementById("ml-test").innerText)`) === true, "'Paste list' option present");
  ok(await ev(`return /Coming soon/.test(document.getElementById("ml-test").innerText)`) === false, "Ward Sync no longer labelled 'Coming soon'");
  ok(await ev(`return document.getElementById("ml-test").querySelectorAll("[data-ml-scan],[data-ml-wardsync]").length`) === 2, "Scan + Ward Sync buttons present");
  ok(await ev(`return document.querySelector("#ml-test [data-ml-scan]").disabled === false`) === true, "Scan button ENABLED (PR3 — scan prescription / case sheet)");
  // Redesign: with no Ward-Sync patient the card is an ACTIVE guide ("Select patient"), not a dead disabled button.
  ok(await ev(`var b=document.querySelector("#ml-test [data-ml-wardsync]"); return !!b && b.disabled===false && /Select patient/i.test(b.textContent)`) === true, "Ward Sync card guides patient selection (active 'Select patient') when none selected");
  ok(await ev(`return /Select a patient to import current medicines/i.test(document.getElementById("ml-test").innerText)`) === true, "Ward Sync card explains it imports the current medication chart");

  // sticky footer with disabled Check-interactions button
  ok(await ev(`return document.getElementById("ml-check") && document.getElementById("ml-check").disabled`) === true, "footer 'Check interactions' button present + disabled");

  // Type manually add-option: input -> add(parseEntry(v),'manual')
  await ev(`MEDLIST.clearAll(); MEDLIST.mount(document.getElementById("ml-test")); document.querySelector("#ml-test [data-ml-open='manual']").click(); return 1;`);
  await ev(`var inp=document.querySelector("#ml-test [data-ml-manual-input]"); inp.value="aspirin 75 od"; inp.dispatchEvent(new Event("input")); return 1;`);
  await ev(`document.querySelector("#ml-test [data-ml-manual-add]").click(); return 1;`);
  ok(await ev(`return MEDLIST.getList().length`) === 1 && await ev(`return MEDLIST.getList()[0].source`) === "manual", "'Type manually' adds a med with source='manual'");

  // Did-you-mean chips shown for medium-confidence combo brand with candidates
  await ev(`MEDLIST.clearAll(); document.querySelector("#ml-test [data-ml-open='manual']").click(); var inp=document.querySelector("#ml-test [data-ml-manual-input]"); inp.value="piptaz 4.5 q6h"; inp.dispatchEvent(new Event("input")); return 1;`);
  ok(await ev(`return /Did you mean/i.test(document.getElementById("ml-test").innerText)`) === true, "'Did you mean?' chips shown for medium-confidence candidates");

  // Paste-list add-option: textarea -> parsePasted -> review sublist w/ include checkboxes -> add selected
  await ev(`MEDLIST.clearAll(); MEDLIST.mount(document.getElementById("ml-test")); document.querySelector("#ml-test [data-ml-open='paste']").click(); return 1;`);
  await ev(`var ta=document.querySelector("#ml-test [data-ml-paste-input]"); ta.value="Tab Amlodipine 5 mg OD\\nMetformin 500 BD"; ta.dispatchEvent(new Event("input")); return 1;`);
  ok(await ev(`return document.querySelectorAll("#ml-test [data-ml-paste-item]").length`) === 2, "paste review shows a sublist row per parsed line");
  ok(await ev(`return document.querySelectorAll("#ml-test [data-ml-paste-item] input[type=checkbox]:checked").length`) === 2, "paste review rows default to included");
  await ev(`document.querySelector("#ml-test [data-ml-paste-add]").click(); return 1;`);
  ok(await ev(`return MEDLIST.getList().length === 2 && MEDLIST.getList().every(function(m){return m.source==="paste"})`) === true, "'Paste list' adds selected meds with source='paste'");

  // Search Drug Index add-option: input -> brandSearch(q) -> results -> add via add(parsed,'index')
  ok(await ev(`return typeof MEDLIST.brandSearch === "function"`) === true, "MEDLIST.brandSearch exposed");
  await ev(`MEDLIST.clearAll(); window.__brandSearchStub = function(){ return Promise.resolve([{brand:"Ecosprin",generic:"aspirin",form:"tablet"}]); }; window.__origBrandSearch = MEDLIST.brandSearch; MEDLIST.brandSearch = window.__brandSearchStub; MEDLIST.mount(document.getElementById("ml-test")); document.querySelector("#ml-test [data-ml-open='index']").click(); return 1;`);
  await ev(`var inp=document.querySelector("#ml-test [data-ml-index-input]"); inp.value="ecos"; inp.dispatchEvent(new Event("input")); return 1;`);
  await sleep(150);
  ok(await ev(`return document.querySelectorAll("#ml-test [data-ml-index-result]").length`) === 1, "Drug Index search shows a result");
  await ev(`document.querySelector("#ml-test [data-ml-index-result]").click(); return 1;`);
  ok(await ev(`return MEDLIST.getList().length`) === 1 && await ev(`return MEDLIST.getList()[0].source`) === "index", "Drug Index result adds a med with source='index'");
  await ev(`MEDLIST.brandSearch = window.__origBrandSearch; return 1;`);

  // Edit while an inline Undo is pending must finalize the pending undo — not orphan
  // a different med / leave a dangling Undo row (Task 5 review, Important finding).
  await ev(`MEDLIST.clearAll(); MEDLIST.add(MEDLIST.parseEntry("metformin 500 bd"),"manual"); MEDLIST.add(MEDLIST.parseEntry("amlodipine 5 od"),"manual"); MEDLIST.mount(document.getElementById("ml-test")); return 1;`);
  await ev(`var mid=MEDLIST.getList()[0].id; document.querySelector('#ml-test [data-ml-remove="'+mid+'"]').click(); return 1;`);
  ok(await ev(`return /undo/i.test(document.getElementById("ml-test").innerText)`) === true, "remove shows inline Undo (with a second med present)");
  await ev(`var bid=MEDLIST.getList()[0].id; document.querySelector('#ml-test [data-ml-edit="'+bid+'"]').click(); return 1;`);
  ok(await ev(`return !/undo/i.test(document.getElementById("ml-test").innerText)`) === true, "editing another med finalizes the pending Undo (no orphaned Undo row)");
  ok(await ev(`return MEDLIST.getList().length === 0`) === true, "edited med pulled into editor; no orphaned/dangling meds left");

  await ev(`MEDLIST.clearAll(); return 1;`);

  // --- Task 6: mobile safe-area on sticky footer + public mount() for entry points ---
  await ev(`MEDLIST.clearAll(); MEDLIST.mount(document.getElementById("ml-test")); return 1;`);
  ok(await ev(`return typeof window.MEDLIST.mount === "function"`) === true, "MEDLIST.mount is public for entry points");
  ok(await ev(`var f=document.querySelector("#ml-test .ml-footer"); return !!f`) === true, "sticky footer element exists");
  // env(safe-area-inset-bottom) resolves to 0 in a normal/headless viewport, so the *computed*
  // padding-bottom is indistinguishable from a bare 12px there — assert against the source rule
  // text instead (this is what actually protects the iPhone home-indicator overlap).
  ok(await ev(`var css=""; for (var s of document.styleSheets) { try { for (var r of s.cssRules) if (r.selectorText===".ml-footer") css+=r.style.cssText; } catch(e){} } return css.indexOf("env(safe-area-inset-bottom)")>=0`) === true,
    "sticky footer padding-bottom rule includes env(safe-area-inset-bottom)");
  ok(await ev(`var b=document.getElementById("ml-check"); return b.getBoundingClientRect().height >= 44`) === true, "Check-interactions touch target >= 44px");

  // --- Spec test 19: mobile safe-area regression (CDP Emulation.setSafeAreaInsetsOverride) ---
  // Emulate an iPhone with a 34px home-indicator inset and assert the sticky footer's
  // env(safe-area-inset-bottom) padding actually lifts the Check-interactions button OUT of
  // the home-indicator zone — i.e. the button's bottom edge clears the inset, no overlap.
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await call("Emulation.setSafeAreaInsetsOverride", { insets: { top: 47, left: 0, bottom: 34, right: 0 } });
  await sleep(200);
  await ev(`MEDLIST.clearAll(); MEDLIST.add(MEDLIST.parseEntry("aspirin 75 od"),"manual");
    var d=document.getElementById("ml-test"); if(!d){d=document.createElement("div");d.id="ml-test";document.body.appendChild(d);}
    d.style.cssText="position:fixed;inset:0"; MEDLIST.mount(d); return 1;`);
  await sleep(150);
  const sa = JSON.parse(await ev(`
    var f=document.querySelector("#ml-test .ml-footer");
    var probe=document.createElement("div"); probe.style.cssText="position:fixed;bottom:0;left:0;height:env(safe-area-inset-bottom);width:1px"; document.body.appendChild(probe);
    var envH=probe.getBoundingClientRect().height; probe.remove();
    var fr=f.getBoundingClientRect();
    var btn=document.getElementById("ml-check"); var br=btn.getBoundingClientRect();
    var pb=parseFloat(getComputedStyle(f).paddingBottom);
    return JSON.stringify({ envH:envH, footerPB:pb, footerBottom:fr.bottom, btnBottom:br.bottom, btnH:br.height, insetGap:(fr.bottom-br.bottom) });`));
  ok(sa.envH === 34, "CDP safe-area override applies: env(safe-area-inset-bottom) resolves to the 34px home-indicator inset");
  ok(sa.footerPB >= 34 + 12 - 0.5, "sticky footer padding-bottom expands by the safe-area inset (>= base 12px + 34px inset)");
  ok(sa.btnH >= 44, "Check-interactions touch target stays >= 44px under mobile emulation");
  ok(sa.insetGap >= 34 - 0.5, "Check-interactions button clears the home-indicator zone (its bottom sits >= the 34px inset above the footer edge — no safe-area overlap)");

  // Results screen (spec test 19): the interaction RESULTS view must also stay within the
  // safe area — its Back/filter controls are >= 40px touch targets and do not overflow the
  // emulated viewport width.
  await ev(`MEDLIST.clearAll();
    MEDLIST.add(MEDLIST.parseEntry("warfarin 5 od"),"manual");
    MEDLIST.add(MEDLIST.parseEntry("aspirin 75 od"),"manual");
    MEDLIST.add(MEDLIST.parseEntry("ibuprofen 400 tds"),"manual");
    MEDLIST.mount(document.getElementById("ml-test")); document.getElementById("ml-check").click(); return 1;`);
  await sleep(150);
  const resSa = JSON.parse(await ev(`
    var back=document.getElementById("mlr-back");
    var toggle=document.getElementById("mlr-toggle-minor");
    var br=back.getBoundingClientRect(), tr=toggle.getBoundingClientRect();
    return JSON.stringify({ backH:br.height, toggleH:tr.height, backRight:br.right, toggleRight:tr.right, vw:window.innerWidth });`));
  ok(resSa.backH >= 40 && resSa.toggleH >= 40, "results-screen Back/Show-all controls are >= 40px touch targets");
  ok(resSa.backRight <= resSa.vw + 0.5 && resSa.toggleRight <= resSa.vw + 0.5, "results-screen controls do not overflow the emulated viewport width (no horizontal safe-area overlap)");
  await call("Emulation.clearDeviceMetricsOverride", {});
  try { await call("Emulation.setSafeAreaInsetsOverride", { insets: { top: 0, left: 0, bottom: 0, right: 0 } }); } catch (e) {}
  await ev(`var d=document.getElementById("ml-test"); if(d) d.style.cssText=""; MEDLIST.clearAll(); return 1;`);

  // Entry points (Task 6): calculators.js (Tools) and icu.js both trigger the same
  // MEDLIST overlay (window.MEDDRUGS.openInteractions, the Task 5 drugs.js overlay).
  ok(await ev(`return typeof window.MEDCALC === "object" && !!window.MEDCALC`) === true, "MEDCALC present (calculators.js loaded)");
  await ev(`if(document.getElementById("miOverlay")) document.getElementById("miOverlay").remove(); return 1;`);
  await ev(`window.MEDCALC.openInteractions && window.MEDCALC.openInteractions(); return 1;`);
  ok(await ev(`var o=document.getElementById("miOverlay"); return !!(o && o.classList.contains("on"))`) === true, "calculators.js Drug Interactions entry point opens MEDLIST overlay");
  ok(await ev(`var o=document.getElementById("miOverlay"); return !!(o && o.querySelector("#ml-check"))`) === true, "calculators.js entry point mounts MEDLIST (Check-interactions button present)");
  await ev(`window.MEDDRUGS.close && window.MEDDRUGS.close(); if(document.getElementById("miOverlay")) document.getElementById("miOverlay").classList.remove("on"); return 1;`);

  ok(await ev(`return typeof window.ICU === "object" && !!window.ICU`) === true, "ICU present (icu.js loaded)");
  await ev(`window.ICU.openInteractions && window.ICU.openInteractions(); return 1;`);
  ok(await ev(`var o=document.getElementById("miOverlay"); return !!(o && o.classList.contains("on"))`) === true, "icu.js Drug Interactions entry point opens MEDLIST overlay");
  ok(await ev(`var o=document.getElementById("miOverlay"); return !!(o && o.querySelector("#ml-check"))`) === true, "icu.js entry point mounts MEDLIST (Check-interactions button present)");
  await ev(`if(document.getElementById("miOverlay")) document.getElementById("miOverlay").classList.remove("on"); document.body.classList.remove("mc-lock"); return 1;`);

  await ev(`MEDLIST.clearAll(); return 1;`);

  // --- Task 7: Check-interactions wiring + severity results screen ---
  // Wait for the interactions engine + rules to be loaded.
  for (let i = 0; i < 60; i++) { await sleep(200); if (await ev(`return !!(window.INTERACTIONS && INTERACTIONS.checkInteractions && window.INTERACTION_RULES)`) === true) break; }
  ok(await ev(`return !!(window.INTERACTIONS && INTERACTIONS.checkInteractions)`) === true, "INTERACTIONS engine loaded for results screen");

  // Button disabled when no resolved-generic med; enabled once one is present.
  await ev(`MEDLIST.clearAll(); MEDLIST.mount(document.getElementById("ml-test")); return 1;`);
  ok(await ev(`return document.getElementById("ml-check").disabled === true`) === true, "Check-interactions disabled with empty list");
  await ev(`MEDLIST.add(MEDLIST.parseEntry("piptaz 4.5 q6h"),"manual"); MEDLIST.mount(document.getElementById("ml-test")); return 1;`);
  ok(await ev(`return document.getElementById("ml-check").disabled === true`) === true, "Check-interactions stays disabled with only unresolved-generic meds");
  // Redesign: an interaction check needs >= 2 resolved medicines (a single med can't interact).
  await ev(`MEDLIST.clearAll(); MEDLIST.add(MEDLIST.parseEntry("aspirin 75 od"),"manual"); MEDLIST.mount(document.getElementById("ml-test")); return 1;`);
  ok(await ev(`return document.getElementById("ml-check").disabled === true`) === true, "Check-interactions stays disabled with a single resolved medicine");
  ok(await ev(`return /Add at least 2 medicines/i.test(document.getElementById("ml-test").innerText)`) === true, "explains the >=2 medicines requirement");
  await ev(`MEDLIST.add(MEDLIST.parseEntry("metformin 500 bd"),"manual"); MEDLIST.mount(document.getElementById("ml-test")); return 1;`);
  ok(await ev(`return document.getElementById("ml-check").disabled === false`) === true, "Check-interactions enabled with two resolved medicines");

  // warfarin + aspirin + ibuprofen -> results screen with a critical/major bleeding alert.
  await ev(`MEDLIST.clearAll(); MEDLIST.add(MEDLIST.parseEntry("warfarin 5 od"),"manual"); MEDLIST.add(MEDLIST.parseEntry("aspirin 75 od"),"manual"); MEDLIST.add(MEDLIST.parseEntry("ibuprofen 400 tds"),"manual"); MEDLIST.mount(document.getElementById("ml-test")); return 1;`);
  ok(await ev(`return document.getElementById("ml-check").disabled === false`) === true, "Check-interactions enabled for warfarin+aspirin+ibuprofen");
  await ev(`document.getElementById("ml-check").click(); return 1;`);
  const rtext = await ev(`return document.getElementById("ml-test").innerText`);
  ok(/Medication Safety Summary/i.test(rtext), "results screen shows 'Medication Safety Summary'");
  ok(/Critical/i.test(rtext) && /Major/i.test(rtext) && /Monitoring/i.test(rtext), "summary shows critical/major/monitoring count chips (color-independent text)");
  ok(/of \d+ medicines? checked/i.test(rtext), "summary shows how many of the submitted medicines were checked");
  ok(/Interaction dataset/i.test(rtext), "summary discloses the interaction dataset version");
  ok(/bleed|haemorrh|hemorrh/i.test(rtext), "results surface a bleeding-related finding");
  ok(await ev(`var t=document.getElementById("ml-test").innerText; return /Critical|Major/.test(t)`) === true, "a severity label (Critical/Major) is shown");
  ok(/Action/i.test(rtext) && await ev(`return !!document.querySelector("#ml-test .mlr-why button")`) === true, "finding card shows an Action line and a 'Why?' expand control");
  // Context/advisory note present when no context supplied.
  ok(/Interaction check is medication-based\. Add renal function, electrolytes, QTc, or patient context/i.test(rtext), "advisory/context note shown when no context");
  // SECURITY: no leaked JSON braces / rule ids / sourceId / provider strings.
  ok(await ev(`var t=document.getElementById("ml-test").innerText; return !/[{}\\[\\]]|sourceId|ruleType|onc-nlm-hpddi|openfda-labeling|crediblemeds/i.test(t)`) === true, "results screen leaks no raw JSON / rule ids / sourceId / provider strings");
  // Back to medicines returns to the list view.
  ok(await ev(`return !!document.getElementById("mlr-back")`) === true, "'Back to medicines' button present");
  await ev(`document.getElementById("mlr-back").click(); return 1;`);
  ok(await ev(`return !!document.getElementById("ml-check")`) === true && await ev(`return /Add medicine|warfarin/i.test(document.getElementById("ml-test").innerText)`) === true, "Back to medicines returns to the list view");
  // Hide minor / Show all toggle present on results screen.
  await ev(`document.getElementById("ml-check").click(); return 1;`);
  ok(await ev(`return !!document.getElementById("mlr-toggle-minor")`) === true, "results screen has a Hide-minor / Show-all toggle");

  // A 'contraindicated' finding (warfarin + aspirin + ibuprofen = bleeding triad) must carry
  // the highest-severity TEXT ("Critical" + "!!!") — severity conveyed by text, not color alone.
  await ev(`MEDLIST.clearAll(); MEDLIST.add(MEDLIST.parseEntry("warfarin 5 od"),"manual"); MEDLIST.add(MEDLIST.parseEntry("aspirin 75 od"),"manual"); MEDLIST.add(MEDLIST.parseEntry("ibuprofen 400 tds"),"manual"); MEDLIST.mount(document.getElementById("ml-test")); document.getElementById("ml-check").click(); return 1;`);
  ok(await ev(`var r=INTERACTIONS.checkInteractions(MEDLIST.getList()); return r.critical.some(function(f){return f.severity==="contraindicated";})`) === true, "bleeding-triad yields a 'contraindicated' finding in the critical bucket");
  ok(await ev(`var b=document.querySelector("#ml-test .mlr-card-critical .mlr-sev-text"); return !!b && /Critical/i.test(b.textContent)`) === true, "contraindicated finding badge text reads 'Critical' (not the 'Caution' fallback)");
  ok(await ev(`var b=document.querySelector("#ml-test .mlr-card-critical .mlr-sev-mark"); return !!b && b.textContent.indexOf("!!!")===0`) === true, "contraindicated finding shows the highest-severity mark '!!!'");
  ok(await ev(`var cards=document.querySelectorAll("#ml-test .mlr-card-critical"); for(var i=0;i<cards.length;i++){var t=cards[i].querySelector(".mlr-sev-text");if(t&&/Caution/i.test(t.textContent))return false;}return cards.length>0`) === true, "no critical card falls back to the 'Caution' label");

  // Two non-interacting meds (amlodipine + paracetamol) -> a NEUTRAL "no finding" state.
  // It must NOT be a falsely reassuring "all clear": no green "No major issue detected",
  // and it must carry the "does not confirm safe" disclaimer.
  await ev(`MEDLIST.clearAll(); MEDLIST.add(MEDLIST.parseEntry("amlodipine 5 od"),"manual"); MEDLIST.add(MEDLIST.parseEntry("paracetamol 650 tds"),"manual"); MEDLIST.mount(document.getElementById("ml-test")); document.getElementById("ml-check").click(); return 1;`);
  const amText = await ev(`return document.getElementById("ml-test").innerText`);
  ok(/Medication Safety Summary/i.test(amText), "non-interacting pair results screen renders summary");
  ok(/No interaction found/i.test(amText), "non-interacting pair shows a neutral 'No interaction found' state");
  ok(!/No major issue detected/i.test(amText), "does NOT show the old falsely-reassuring 'No major issue detected' text");
  ok(/does NOT confirm the combination is safe|not clearance|Absence of a finding/i.test(amText), "shows the 'absence of a finding is not safety' disclaimer");
  ok(await ev(`var r=INTERACTIONS.checkInteractions(MEDLIST.getList()); return r.critical.length===0 && r.major.length===0`) === true, "amlodipine + paracetamol yields 0 critical/major");

  await ev(`MEDLIST.clearAll(); return 1;`);

  // Part B: a typed brand NOT in local maps is auto-resolved to its composition
  // via the catalogue API at check time, then screened. Stub brandSearch so the
  // test is deterministic (no live network): 'zzbrandx' -> warfarin.
  await ev(`
    MEDLIST.clearAll();
    window.MEDLIST.brandSearch = function(q){ return Promise.resolve([{ brand:q, generic:'warfarin', form:'tab' }]); };
    MEDLIST.add(MEDLIST.parseEntry('zzbrandx 5 mg'),'manual');
    MEDLIST.add(MEDLIST.parseEntry('aspirin 75 od'),'manual');
    MEDLIST.mount(document.getElementById('ml-test'));
    return 1;
  `);
  ok(await ev(`return document.getElementById('ml-check') && document.getElementById('ml-check').disabled === false`) === true,
     "Check enabled with an unresolved brand + a generic present (present-count gate)");
  await ev(`document.getElementById('ml-check').click(); return 1;`);
  await sleep(700);
  const brandApiText = await ev(`return document.getElementById('ml-test').innerText`);
  ok(/bleed|haemorrh|hemorrh|Major|Critical/i.test(brandApiText),
     "typed brand 'zzbrandx' auto-resolves to warfarin via the catalogue API and is screened against aspirin (bleeding)");

  // --- F. Clinical Grouping & Overlap Tests ---
  await ev(`
    MEDLIST.clearAll();
    MEDLIST.add({ generic: 'sildenafil', strength: 20, unit: 'mg', form: 'tablet' }, 'manual');
    MEDLIST.add({ generic: 'sildenafil', strength: 25, unit: 'mg', form: 'tablet' }, 'manual');
    MEDLIST.add({ generic: 'sildenafil', strength: null, unit: null, form: 'tablet' }, 'manual');
    MEDLIST.mount(document.getElementById('ml-test'));
    return 1;
  `);
  ok(await ev(`return document.querySelector("#ml-test .ml-list-count").innerText`) === "1 medicine selected",
     "Sildenafil 20mg + 25mg + unspecified count heading says '1 medicine selected'");
  ok(await ev(`return document.getElementById("ml-check").innerText`) === "Check 1 medicine",
     "Sildenafil 20mg + 25mg + unspecified check button says 'Check 1 medicine'");
  
  const sildGroupRes = JSON.parse(await ev(`
    var r = INTERACTIONS.checkInteractions(MEDLIST.getList());
    return JSON.stringify({ reviewedCount: r.reviewedCount, duplicatesLength: r.duplicates.length });
  `));
  ok(sildGroupRes.reviewedCount === 1, "sildenafil group interaction reviewedCount is 1");
  ok(sildGroupRes.duplicatesLength === 0, "sildenafil group interaction has 0 duplicate therapy results");

  await ev(`
    MEDLIST.clearAll();
    MEDLIST.add({ generic: 'sildenafil', strength: 20 }, 'manual');
    MEDLIST.add({ generic: 'nitroglycerin', strength: 0.5 }, 'manual');
    MEDLIST.add({ generic: 'sildenafil', strength: 25 }, 'manual');
    return 1;
  `);
  const sildNitroRes = JSON.parse(await ev(`
    var r = INTERACTIONS.checkInteractions(MEDLIST.getList());
    return JSON.stringify({
      criticalLength: r.critical.length,
      drugs: r.critical[0] ? r.critical[0].drugs : []
    });
  `));
  ok(sildNitroRes.criticalLength === 1, "Sildenafil + Nitroglycerin yields exactly one critical interaction pair");
  ok(sildNitroRes.drugs.length === 2 && sildNitroRes.drugs.indexOf("sildenafil") !== -1 && sildNitroRes.drugs.indexOf("nitroglycerin") !== -1,
     "Sildenafil + Nitroglycerin has no repeated ingredient in title");

  await ev(`
    MEDLIST.clearAll();
    MEDLIST.add({ generic: 'sildenafil', strength: 50 }, 'manual');
    MEDLIST.add({ generic: 'dapoxetine + sildenafil', strength: null }, 'manual');
    return 1;
  `);
  const sildComboRes = JSON.parse(await ev(`
    var r = INTERACTIONS.checkInteractions(MEDLIST.getList());
    return JSON.stringify({
      criticalLength: r.critical.length,
      duplicatesLength: r.duplicates.length
    });
  `));
  ok(sildComboRes.criticalLength === 0, "Sildenafil + Sildenafil/Dapoxetine combination has no self-interaction");
  ok(sildComboRes.duplicatesLength === 0, "Sildenafil + Sildenafil/Dapoxetine combination has no false duplicate warnings");

  await ev(`
    MEDLIST.clearAll();
    MEDLIST.add({ generic: 'sildenafil', strength: 50 }, 'manual');
    MEDLIST.add({ generic: 'pantoprazole', strength: 40 }, 'manual');
    return 1;
  `);
  const sildPantoRes = JSON.parse(await ev(`
    var r = INTERACTIONS.checkInteractions(MEDLIST.getList());
    return JSON.stringify({
      duplicatesLength: r.duplicates.length
    });
  `));
  ok(sildPantoRes.duplicatesLength === 0, "Sildenafil + Pantoprazole yields 0 duplicate-therapy results");

  // --- G. REAL Drug-Index composition path (regression for the reported bug) ---
  // The live /brand-search returns composition strings that carry the strength in
  // the ingredient text, e.g. "Sildenafil", "Sildenafil (50mg)", "Sildenafil 20 mg
  // tablet". medlist stored those verbatim as `generic`, so the clinical key
  // ("sildenafil (50mg)" vs "sildenafil") never collapsed. These add the products
  // EXACTLY as the Drug-Index path stores them (raw composition in `generic`).
  await ev(`
    MEDLIST.clearAll();
    MEDLIST.add({ generic: 'sildenafil', form: 'tablet' }, 'index');                                  // "Sildenafil"
    MEDLIST.add({ generic: 'sildenafil (50mg)', strength: 50, unit: 'mg', form: 'tablet' }, 'index');  // "Sildenafil (50mg)"
    MEDLIST.add({ generic: 'sildenafil (20mg)', strength: 20, unit: 'mg', form: 'tablet' }, 'index');  // "Sildenafil (20mg)"
    MEDLIST.add({ generic: 'sildenafil 20 mg tablet' }, 'index');                                      // "Sildenafil 20 mg tablet"
    MEDLIST.mount(document.getElementById('ml-test'));
    return 1;
  `);
  ok(await ev(`return MEDLIST.getList().length`) === 4, "four Sildenafil PRODUCT rows are preserved (count is at the product layer)");
  ok(await ev(`return document.querySelector("#ml-test .ml-list-count").innerText`) === "1 medicine selected",
     "REAL composition variants (Sildenafil / (50mg) / (20mg) / '20 mg tablet') say '1 medicine selected'");
  ok(await ev(`return document.getElementById("ml-check").innerText`) === "Check 1 medicine",
     "REAL composition variants say 'Check 1 medicine'");
  const sildRealRes = JSON.parse(await ev(`
    var r = INTERACTIONS.checkInteractions(MEDLIST.getList());
    return JSON.stringify({ reviewedCount: r.reviewedCount, duplicatesLength: r.duplicates.length, criticalLength: r.critical.length });
  `));
  ok(sildRealRes.reviewedCount === 1, "engine collapses the composition variants to exactly one clinical medicine (reviewedCount 1)");
  ok(sildRealRes.duplicatesLength === 0, "no false duplicate-therapy alert from repeated Sildenafil product rows");
  ok(sildRealRes.criticalLength === 0, "no Sildenafil + Sildenafil self-interaction from composition variants");

  // SAFETY: a strength-polluted generic must STILL match a real interaction. Before
  // the fix, "sildenafil (50mg)" did not satisfy the `sildenafil` rule subject, so
  // the sildenafil + nitrate contraindication was silently MISSED.
  await ev(`
    MEDLIST.clearAll();
    MEDLIST.add({ generic: 'sildenafil (50mg)', strength: 50, unit: 'mg', form: 'tablet' }, 'index');
    MEDLIST.add({ generic: 'nitroglycerin', strength: 0.5 }, 'manual');
    return 1;
  `);
  const sildNitroReal = JSON.parse(await ev(`
    var r = INTERACTIONS.checkInteractions(MEDLIST.getList());
    return JSON.stringify({ criticalLength: r.critical.length, drugs: r.critical[0] ? r.critical[0].drugs : [] });
  `));
  ok(sildNitroReal.criticalLength === 1, "'Sildenafil (50mg)' + Nitroglycerin still fires exactly one critical interaction (not missed)");
  ok(sildNitroReal.drugs.indexOf("sildenafil") !== -1 && sildNitroReal.drugs.indexOf("nitroglycerin") !== -1,
     "the fired interaction names the normalised ingredient 'sildenafil' (not 'sildenafil (50mg)')");

  // A combination composition ("Sildenafil (50mg) + Dapoxetine (30mg)") normalises to
  // its two active ingredients so it groups/screens correctly.
  await ev(`
    MEDLIST.clearAll();
    MEDLIST.add({ generic: 'sildenafil (50mg) + dapoxetine (30mg)', strength: 50, unit: 'mg' }, 'index');
    return 1;
  `);
  const comboKey = await ev(`
    var r = INTERACTIONS.checkInteractions(MEDLIST.getList());
    var m = MEDLIST.getClinicalList(MEDLIST.getList());
    return JSON.stringify({ reviewedCount: r.reviewedCount, key: m[0] && m[0].clinicalKey });
  `);
  ok(JSON.parse(comboKey).key === "dapoxetine|sildenafil", "combination composition normalises to a two-ingredient clinical key 'dapoxetine|sildenafil'");

  // END-TO-END: drive the actual Drug-Index add path (stubbed brandSearch returns the
  // REAL API shape) — both product rows must store the normalised generic 'sildenafil'
  // and collapse to one clinical medicine.
  await ev(`
    MEDLIST.clearAll();
    window.__origConfirm = window.confirm; window.confirm = function(){ return false; };  // allow a separate dose entry
    window.__origBrandSearch2 = MEDLIST.brandSearch;
    MEDLIST.brandSearch = function(){ return Promise.resolve([
      { brand: 'Grace Drugs & Pharmaceuticals Sildenafil 50mg Tablet', generic: 'sildenafil', form: 'tablet' },
      { brand: 'Science Of Him Sildenafil 50mg Tablet', generic: 'sildenafil (50mg)', form: '4 tablets' }
    ]); };
    MEDLIST.mount(document.getElementById('ml-test'));
    document.querySelector("#ml-test [data-ml-open='index']").click();
    var inp = document.querySelector("#ml-test [data-ml-index-input]"); inp.value = 'sildenafil'; inp.dispatchEvent(new Event('input'));
    return 1;
  `);
  await sleep(200);
  await ev(`document.querySelectorAll("#ml-test [data-ml-index-result]").forEach(function(b){ b.click(); }); return 1;`);
  await ev(`window.confirm = window.__origConfirm; MEDLIST.brandSearch = window.__origBrandSearch2; MEDLIST.mount(document.getElementById('ml-test')); return 1;`);
  ok(await ev(`return MEDLIST.getList().length`) === 2, "Drug-Index add path adds two product rows");
  ok(await ev(`return MEDLIST.getList().every(function(m){ return m.generic === 'sildenafil'; })`) === true,
     "Drug-Index add path normalises the composition to a clean generic 'sildenafil' (not 'sildenafil (50mg)')");
  ok(await ev(`return document.querySelector("#ml-test .ml-list-count").innerText`) === "1 medicine selected",
     "Drug-Index-added Sildenafil products collapse to '1 medicine selected'");

  await ev(`MEDLIST.clearAll(); return 1;`);

  console.log(fails === 0 ? "\nALL GREEN — medlist parser test passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
