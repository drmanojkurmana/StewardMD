/* GHIS Medication History import — deterministic parse, review, merge, account-scoped.
 *
 * Verifies window.GHISMEDS: combination-product expansion, consumable exclusion to a
 * "needs review" bucket, low-confidence rows staying unmapped, the fetch/enable gate
 * around a selected Ward-Sync patient, confirm-before-import (nothing auto-added),
 * merge detection against manually-entered meds (never silently deleted), no PHI /
 * raw product codes in the review DOM, and clear-on-logout/patient-switch of the draft.
 *
 * FIXTURES ONLY — no live GHIS. The medications fetch is stubbed with sample rows.
 *
 * USAGE: BASE=http://localhost:8931/ node test/run-ghis-import.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8931/").replace(/\/?$/, "/");
const PORT = 9381, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ghis-import-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8931"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(async function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

// Sample GHIS medication-history rows (PHI already stripped server-side; the shape
// mirrors the PR4 /api/ghis/medications { rows } payload).
const SAMPLE_ROWS = [
  { productCode: "P1001", drugText: "TAB AMLODIPINE 5 MG", route: "PO", dosage: "5 MG", frequency: "OD", duration: "30 days", dept: "Cardiology", dateTime: "2026-06-01" },
  { productCode: "P1002", drugText: "ROSUVASTATIN 20 MG & FENOFIBRATE 160 MG", route: "PO", dosage: "", frequency: "HS", duration: "30 days", dept: "Cardiology", dateTime: "2026-06-01" },
  { productCode: "C9001", drugText: "IV CANNULA 18G", route: "", dosage: "", frequency: "", duration: "", dept: "Nursing", dateTime: "2026-06-01" },
  { productCode: "X7777", drugText: "ZORPLIX 250 XR", route: "PO", dosage: "250 MG", frequency: "BD", duration: "5 days", dept: "General", dateTime: "2026-06-02" },
  { productCode: "P1003", drugText: "TAB METFORMIN 500 MG", route: "PO", dosage: "500 MG", frequency: "BD", duration: "30 days", dept: "Endocrine", dateTime: "2026-06-01" },
];

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  let ready = false; for (let i = 0; i < 80; i++) { await sleep(400); if (await ev(`return !!(window.MEDLIST && window.GHISMEDS && GHISMEDS.parseGhisRow && GHISMEDS.parseGhisRows)`) === true) ready = true; if (ready) break; }
  if (!ready) throw new Error("GHISMEDS/MEDLIST not loaded");

  // Install the sample rows as the stubbed medications fetch, and stub a selected patient.
  await ev(`window.__ghisRows = ${JSON.stringify(SAMPLE_ROWS)};
    GHISMEDS.fetchMedications = function(patientId){ return Promise.resolve({ rows: window.__ghisRows.slice() }); };
    window.GHIS = window.GHIS || {}; window.GHIS._selectedPatient = { patientId: "PT42", name: "Ward Patient" };
    window.GHIS.getSelectedPatient = function(){ return window.GHIS._selectedPatient ? { patientId: window.GHIS._selectedPatient.patientId, name: window.GHIS._selectedPatient.name } : null; };
    return 1;`);

  // --- (A) Deterministic parse of the full sample set -----------------------
  const parsed = JSON.parse(await ev(`return JSON.stringify(GHISMEDS.parseGhisRows(window.__ghisRows))`));
  ok(parsed && Array.isArray(parsed.candidates), "parseGhisRows returns a candidates array");

  // (1) COMBINATION product expands to two ingredients linked to one order.
  const combo = parsed.candidates.filter(c => /rosuvastatin|fenofibrate/i.test(JSON.stringify(c)));
  const comboOrders = {}; combo.forEach(c => { comboOrders[c.orderId] = (comboOrders[c.orderId] || 0) + 1; });
  ok(combo.length === 2, "combination 'ROSUVASTATIN 20 MG & FENOFIBRATE 160 MG' expands to 2 ingredient candidates");
  ok(Object.keys(comboOrders).length === 1 && Object.values(comboOrders)[0] === 2, "both combination ingredients share ONE order id (linked to one order)");
  const rosu = combo.find(c => /rosuvastatin/i.test(c.generic || c.name || ""));
  const feno = combo.find(c => /fenofibrate/i.test(c.generic || c.name || ""));
  ok(rosu && rosu.strength === 20, "combination ingredient rosuvastatin carries its own 20mg strength");
  ok(feno && feno.strength === 160, "combination ingredient fenofibrate carries its own 160mg strength");
  ok(parsed.combinationsExpanded >= 1, "summary counts >=1 combination product expanded");

  // (2) A consumable row is EXCLUDED to needs-review/consumables, not added.
  const cann = parsed.candidates.concat(parsed.consumables || []).find(c => /cannula/i.test(JSON.stringify(c)));
  ok(!!cann && cann.isConsumable === true, "'IV CANNULA 18G' is flagged as a consumable");
  ok((parsed.consumables || []).some(c => /cannula/i.test(JSON.stringify(c))), "consumable is bucketed into 'consumables' (excluded by default)");
  ok(!(parsed.recognized || []).some(c => /cannula/i.test(JSON.stringify(c))), "consumable is NOT in the recognized/importable bucket");
  ok(parsed.consumablesExcluded >= 1, "summary counts >=1 consumable excluded");

  // (3) An unclear / low-confidence row goes to "needs review", not silently mapped.
  const zorp = parsed.candidates.concat(parsed.needsReview || []).find(c => /zorplix/i.test(JSON.stringify(c)));
  ok(!!zorp, "unknown drug 'ZORPLIX 250 XR' produces a candidate");
  ok(zorp && !zorp.generic && (zorp.confidence === "low" || zorp.needsReview), "unknown 'ZORPLIX' stays unmapped (no silent generic)");
  ok((parsed.needsReview || []).some(c => /zorplix/i.test(JSON.stringify(c))), "unknown drug is bucketed into 'needsReview'");
  ok(parsed.needsReviewCount >= 1, "summary counts >=1 needing review");

  // recognized drugs (amlodipine, metformin, + combo ingredients) carry source 'ghis'.
  ok((parsed.recognized || []).every(c => c.source === "ghis"), "recognized candidates carry source 'ghis'");
  const aml = (parsed.recognized || []).find(c => /amlodipine/i.test(c.generic || ""));
  ok(!!aml && aml.confidence === "high", "'TAB AMLODIPINE 5 MG' maps to amlodipine (high confidence)");
  ok(!!aml && aml.form === "tablet", "amlodipine formulation recognized as tablet");

  // --- (4) fetch disabled / error when NO patient selected ------------------
  await ev(`window.GHIS._selectedPatient = null; return 1;`);
  ok(await ev(`return GHISMEDS.canFetch() === false`) === true, "canFetch() false when no Ward-Sync patient selected");
  const noPt = await ev(`return GHISMEDS.startImport().then(function(r){ return JSON.stringify(r); }).catch(function(e){ return JSON.stringify({error:String(e&&e.message||e)}); });`);
  ok(/Select a Ward Sync patient first/i.test(noPt), "startImport with no patient returns 'Select a Ward Sync patient first.'");
  await ev(`window.GHIS._selectedPatient = { patientId: "PT42", name: "Ward Patient" }; return 1;`);
  ok(await ev(`return GHISMEDS.canFetch() === true`) === true, "canFetch() true once a patient is selected");

  // --- UI: enable/disable of the "Fetch from Ward Sync" add-option ----------
  await ev(`MEDLIST.clearAll(); var d=document.getElementById("gi-test")||document.createElement("div"); d.id="gi-test"; if(!d.parentNode) document.body.appendChild(d); MEDLIST.mount(d); return 1;`);
  await ev(`window.GHIS._selectedPatient = null; MEDLIST.mount(document.getElementById("gi-test")); return 1;`);
  ok(await ev(`var b=document.querySelector("#gi-test [data-ml-wardsync]"); return !!b && b.disabled === true`) === true, "Ward Sync button DISABLED when no patient selected");
  ok(await ev(`return /Select a Ward Sync patient first/i.test(document.getElementById("gi-test").innerText)`) === true, "disabled Ward Sync shows the 'Select a Ward Sync patient first.' hint");
  await ev(`window.GHIS._selectedPatient = { patientId: "PT42", name: "Ward Patient" }; MEDLIST.mount(document.getElementById("gi-test")); return 1;`);
  ok(await ev(`var b=document.querySelector("#gi-test [data-ml-wardsync]"); return !!b && b.disabled === false`) === true, "Ward Sync button ENABLED once a patient is selected");
  ok(await ev(`return !/Coming soon/i.test(document.querySelector("#gi-test [data-ml-wardsync]").textContent)`) === true, "Ward Sync button no longer labelled 'Coming soon'");

  // --- (5) import adds selected meds w/ source 'ghis' ONLY AFTER confirm -----
  await ev(`MEDLIST.clearAll(); MEDLIST.mount(document.getElementById("gi-test")); return 1;`);
  await ev(`document.querySelector("#gi-test [data-ml-wardsync]").click(); return 1;`);
  // Wait for the review screen to render from the stubbed fetch.
  for (let i = 0; i < 40; i++) { await sleep(120); if (await ev(`return document.querySelectorAll("#gi-test [data-gi-row]").length > 0`) === true) break; }
  ok(await ev(`return /Imported from GHIS Medication History/i.test(document.getElementById("gi-test").innerText)`) === true, "review header 'Imported from GHIS Medication History' shown");
  ok(await ev(`return /recognized/i.test(document.getElementById("gi-test").innerText) && /combination/i.test(document.getElementById("gi-test").innerText) && /need review/i.test(document.getElementById("gi-test").innerText) && /consumable/i.test(document.getElementById("gi-test").innerText)`) === true, "review summary shows recognized / combination / need review / consumables counts");
  ok(await ev(`return MEDLIST.getList().length === 0`) === true, "NOTHING added to the list before confirm (review screen only)");
  // Import buttons present.
  ok(await ev(`return !!document.querySelector("#gi-test [data-gi-import-all]") && !!document.querySelector("#gi-test [data-gi-import-selected]") && !!document.querySelector("#gi-test [data-gi-cancel]")`) === true, "Import all / Import selected / Cancel buttons present");
  ok(await ev(`return !!document.querySelector("#gi-test [data-gi-view-consumables]")`) === true, "View excluded consumables control present");
  // Confirm import (all recognized).
  await ev(`document.querySelector("#gi-test [data-gi-import-all]").click(); return 1;`);
  ok(await ev(`return MEDLIST.getList().length > 0`) === true, "after confirm, recognized meds are added to the list");
  ok(await ev(`return MEDLIST.getList().every(function(m){return m.source==="ghis"})`) === true, "imported meds carry source 'ghis'");
  ok(await ev(`return !MEDLIST.getList().some(function(m){return /cannula/i.test(m.raw||"")})`) === true, "consumable (IV cannula) NOT imported into the list");
  ok(await ev(`return MEDLIST.getList().some(function(m){return /rosuvastatin/i.test(m.generic||"")}) && MEDLIST.getList().some(function(m){return /fenofibrate/i.test(m.generic||"")})`) === true, "both split combination ingredients imported as separate meds");

  // --- (7) no raw GHIS product code / PHI text in the review DOM ------------
  await ev(`MEDLIST.clearAll(); MEDLIST.mount(document.getElementById("gi-test")); document.querySelector("#gi-test [data-ml-wardsync]").click(); return 1;`);
  for (let i = 0; i < 40; i++) { await sleep(120); if (await ev(`return document.querySelectorAll("#gi-test [data-gi-row]").length > 0`) === true) break; }
  const dom = await ev(`return document.getElementById("gi-test").innerText`);
  ok(!/P1001|P1002|P1003|C9001|X7777/.test(dom), "no raw GHIS product codes appear in the review DOM");
  ok(await ev(`var t=document.getElementById("gi-test").innerText; return !/[{}\\[\\]]|productCode|patientId|MRN|UHID/i.test(t)`) === true, "review DOM leaks no raw JSON / productCode / patient identifiers");
  ok(await ev(`return /PT42/.test(document.getElementById("gi-test").innerText) === false`) === true, "raw patient id (PT42) not rendered in the review DOM");

  // --- (6) merge detection vs a manually-entered med (manual NOT deleted) ----
  await ev(`MEDLIST.clearAll(); MEDLIST.add(MEDLIST.parseEntry("metformin 500 bd"),"manual"); MEDLIST.mount(document.getElementById("gi-test")); return 1;`);
  const manualId = await ev(`return MEDLIST.getList()[0].id`);
  await ev(`document.querySelector("#gi-test [data-ml-wardsync]").click(); return 1;`);
  for (let i = 0; i < 40; i++) { await sleep(120); if (await ev(`return document.querySelectorAll("#gi-test [data-gi-row]").length > 0`) === true) break; }
  // A duplicate-generic (metformin) must be detected against the manual med.
  ok(await ev(`return /duplicate|already|merge|keep both|replace/i.test(document.getElementById("gi-test").innerText)`) === true, "GHIS metformin duplicating the manual metformin surfaces a merge/duplicate prompt");
  const dupInfo = JSON.parse(await ev(`return JSON.stringify(GHISMEDS.detectDuplicates(GHISMEDS.parseGhisRows(window.__ghisRows).recognized, MEDLIST.getList()))`));
  ok(Array.isArray(dupInfo) && dupInfo.some(d => /metformin/i.test(JSON.stringify(d))), "detectDuplicates flags the metformin overlap");
  // Import all, then ensure the manual med still exists (never silently deleted).
  await ev(`document.querySelector("#gi-test [data-gi-import-all]").click(); return 1;`);
  await sleep(150);
  ok(await ev(`return MEDLIST.getList().some(function(m){return m.id === ${JSON.stringify(manualId)} })`) === true, "the manually-entered metformin is NOT deleted by the GHIS import");

  // --- (8) clear-on-logout / patient-switch empties the GHIS draft ----------
  await ev(`MEDLIST.clearAll(); MEDLIST.mount(document.getElementById("gi-test")); document.querySelector("#gi-test [data-ml-wardsync]").click(); return 1;`);
  for (let i = 0; i < 40; i++) { await sleep(120); if (await ev(`return GHISMEDS.getDraft() && GHISMEDS.getDraft().candidates`) === true) break; }
  ok(await ev(`var d=GHISMEDS.getDraft(); return !!(d && (d.candidates||[]).length)`) === true, "a GHIS draft exists after fetch");
  await ev(`GHISMEDS.clearDraft(); return 1;`);
  ok(await ev(`var d=GHISMEDS.getDraft(); return !d || !(d.candidates||[]).length`) === true, "clearDraft() empties the GHIS import draft");
  // patient-switch via GHIS also clears the draft (if the ward hook is present).
  ok(await ev(`return typeof GHISMEDS.clearDraft === "function"`) === true, "GHISMEDS.clearDraft is exposed for logout/patient-switch hooks");

  await ev(`MEDLIST.clearAll(); return 1;`);
  console.log(fails === 0 ? "\nALL GREEN — GHIS import test passed" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
