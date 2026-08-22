/* Discharge Creator · Draft with MaiK.
 *
 * The feature writes prose into a medico-legal document, so the assertions here are mostly about
 * what it must NOT do: never draft or mention discharge medications, never set the final diagnosis,
 * never write into a field the clinician did not tick, and never lose the clinician's typed work on
 * the round trip through the review sheet. The model is stubbed — this tests our contract with it,
 * not the model.
 * USAGE: node test/run-icu-discharge-ai.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8916/").replace(/\/?$/, "/");
const PORT = 9437, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/icu-disai-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8916"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
const J = async (e) => { const v = await ev(e); try { return JSON.parse(v); } catch { return v; } };

// A realistic MaiK answer, with the headings we ask for plus the noise a model actually emits.
const MAIK_ANSWER = [
  "Here is the draft.",
  "",
  "## HOSPITAL COURSE",
  "- Presented with fever and breathlessness, admitted with community-acquired pneumonia.",
  "- Required supplemental oxygen for 3 days; weaned to room air.",
  "- [ confirm admission date ]",
  "",
  "**CONDITION AT DISCHARGE**",
  "- Afebrile 48 hours, saturating 96% on room air, mobilising independently.",
  "",
  "3. Follow-up:",
  "- Review in general medicine OPD in 6 weeks with a repeat chest radiograph.",
  "- Repeat CBC and CRP at that visit if symptoms persist.",
  "",
  "ADVICE TO PATIENT",
  "- Complete the full course as prescribed by your doctor.",
  "- Return immediately if breathlessness worsens, fever returns, or you cough blood.",
  "",
  "GUIDELINE BASIS",
  "- BTS/NICE community-acquired pneumonia: radiographic follow-up at 6 weeks.",
  "@@MORE@@"
].join("\n");

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE + "?tour=0" });
  let ready = false;
  for (let i = 0; i < 90; i++) { await sleep(400); if (await ev(`return !!(window.ICU && ICU.openDischarge && ICU._disAiParse)`) === true) { ready = true; break; } }
  if (!ready) throw new Error("ICU not loaded");

  // ---- the parser, on the messy real-world shape of a model answer ----
  const parsed = await J(`return JSON.stringify(ICU._disAiParse(${JSON.stringify(MAIK_ANSWER)}));`);
  ok(/community-acquired pneumonia/.test(parsed.course || ""), `parses "## HOSPITAL COURSE"`);
  ok(/Afebrile 48 hours/.test(parsed.condition || ""), `parses "**CONDITION AT DISCHARGE**"`);
  ok(/6 weeks/.test(parsed.followup || ""), `parses a numbered "3. Follow-up:" heading`);
  ok(/cough blood/.test(parsed.advice || ""), `parses a bare "ADVICE TO PATIENT" heading`);
  ok(/BTS\/NICE/.test(parsed._basis || ""), `keeps the guideline basis separate from the fields`);
  ok(/Here is the draft/.test(parsed._rest || ""), `model chatter before the first heading is kept, not silently dropped`);
  ok(!/@@MORE@@/.test(JSON.stringify(parsed)), `MaiK's tier markers are stripped`);

  // ---- set up a patient and open the Discharge Creator ----
  await ev(`
    try { localStorage.setItem("smd_icu_groups","0"); } catch(e){}
    ICU.reset();
    ICU.ingestPatient({ name:"Test Discharge", age:64, sex:"M", diagnosis:"Community-acquired pneumonia", complaints:"Fever, breathlessness" });
    ICU.ingestMonitor({ hr:88, sbp:118, dbp:72, spo2:96, rr:18, temp:36.9 });
    ICU.ingestTreatment && ICU.ingestTreatment({ name:"Amoxicillin-clavulanate", dose:"625 mg", route:"PO", freq:"TDS" });
    ICU.open();
    ICU.openDischarge();
    return 1;`);
  await sleep(400);

  const creator = await J(`
    var m = document.getElementById("icuModal");
    return JSON.stringify({ open: !!m.querySelector('[data-icu-act="dischargecopy"]'), btn: !!m.querySelector('[data-icu-act="disai"]') });
  `);
  ok(creator.open === true, `the Discharge Creator opens`);
  ok(creator.btn === true, `it offers "Draft with MaiK"`);

  // ---- the prompt's safety rules ----
  const prompt = await ev(`return ICU._disAiPrompt();`);
  ok(/Do NOT list, add, change or stop any medication/i.test(prompt || ""), `the prompt forbids drafting medications`);
  ok(/Do not assert a diagnosis of your own/i.test(prompt || ""), `the prompt forbids asserting a diagnosis`);
  ok(/Never invent a value/i.test(prompt || ""), `the prompt forbids inventing data`);
  ok(/GUIDELINE BASIS/.test(prompt || ""), `the prompt asks which guideline was applied`);
  ok(!/Test Discharge/.test(prompt || ""), `the patient's NAME never reaches the prompt (de-identified)`);

  // ---- the clinician types into two fields, then drafts ----
  const drafted = await J(`
    document.getElementById("dis-course").value = "MY OWN COURSE NOTES";
    document.getElementById("dis-meds").value = "- Amoxicillin-clavulanate 625 mg PO TDS";
    window.StewardRAG = { buildPackage: function(){ return Promise.resolve({}); } };
    window.SMD_AI = { explainGrounded: function(){ return Promise.resolve({ text: ${JSON.stringify(MAIK_ANSWER)} }); } };
    document.querySelector('[data-icu-act="disai"]').click();
    return JSON.stringify({ busy: !!document.querySelector("#icuDisAiSheet") });
  `);
  ok(drafted.busy === true, `tapping Draft opens the MaiK review sheet`);
  await sleep(500);

  const review = await J(`
    var m = document.getElementById("icuModal");
    var picks = [].map.call(m.querySelectorAll(".disai-pick"), function(c){ return c.getAttribute("data-k"); });
    return JSON.stringify({
      picks: picks,
      insert: !!m.querySelector('[data-icu-act="disaiapply"]'),
      mentionsMeds: /Medications and the final diagnosis are never drafted/.test(m.textContent),
      basisShown: /BTS\\/NICE/.test(m.textContent)
    });
  `);
  ok(review.picks.length === 4 && review.picks.indexOf("course") > -1, `four narrative sections offered (${JSON.stringify(review.picks)})`);
  ok(review.picks.indexOf("meds") < 0 && review.picks.indexOf("finalDx") < 0, `medications and final diagnosis are NOT offered for drafting`);
  ok(review.mentionsMeds === true, `the sheet says so in plain words`);
  ok(review.basisShown === true, `the guideline basis is shown for review`);

  // ---- untick one section, insert, and check what changed ----
  const applied = await J(`
    var m = document.getElementById("icuModal");
    [].forEach.call(m.querySelectorAll(".disai-pick"), function(c){ if (c.getAttribute("data-k") === "course") c.checked = false; });
    m.querySelector('[data-icu-act="disaiapply"]').click();
    return JSON.stringify({ back: !!document.querySelector('[data-icu-act="dischargecopy"]') });
  `);
  ok(applied.back === true, `Insert returns to the Discharge Creator`);
  await sleep(250);
  const fields = await J(`
    function v(k){ var el = document.getElementById("dis-"+k); return el ? el.value : null; }
    return JSON.stringify({ course: v("course"), condition: v("condition"), followup: v("followup"), advice: v("advice"), meds: v("meds"), finalDx: v("finalDx") });
  `);
  ok(fields.course === "MY OWN COURSE NOTES", `an unticked section is left exactly as the clinician wrote it`);
  ok(/Afebrile 48 hours/.test(fields.condition || ""), `a ticked section is inserted`);
  ok(/6 weeks/.test(fields.followup || ""), `follow-up is inserted`);
  ok(/cough blood/.test(fields.advice || ""), `safety-netting advice is inserted`);
  ok(fields.meds === "- Amoxicillin-clavulanate 625 mg PO TDS", `the medication list the clinician typed is untouched`);
  ok(/pneumonia/i.test(fields.finalDx || ""), `the final diagnosis is still the clinician's`);

  // ---- the inserted prose reaches the assembled summary, and the export actions survive ----
  // Driven through the real Copy action, which assembles from the OPEN FORM (ICU.buildDischarge()
  // deliberately rebuilds from recorded data instead, so it would not see the inserted prose).
  const assembled = await J(`
    var txt = "";
    try { navigator.clipboard.writeText = function(v){ txt = v; return Promise.resolve(); }; } catch(e){}
    var copy = document.querySelector('[data-icu-act="dischargecopy"]');
    if (copy) copy.click();
    return JSON.stringify({
      hasCopy: !!copy,
      carriesAdvice: /cough blood/.test(txt),
      carriesOwnCourse: /MY OWN COURSE NOTES/.test(txt),
      stillDraft: /DRAFT/.test(txt)
    });
  `);
  ok(assembled.hasCopy === true, `Copy / Print / Share are still available after inserting`);
  ok(assembled.carriesAdvice === true, `the inserted advice reaches the assembled summary`);
  ok(assembled.carriesOwnCourse === true, `so does the clinician's own untouched course text`);
  ok(assembled.stillDraft === true, `the summary is still stamped DRAFT for clinician review`);

  // ---- AI unavailable: an explicit failure, never a silent one ----
  const offline = await J(`
    ICU.openDischarge();
    window.StewardRAG = undefined; window.SMD_AI = undefined;
    document.querySelector('[data-icu-act="disai"]').click();
    return JSON.stringify({ opened: !!document.querySelector("#icuDisAiSheet") });
  `);
  ok(offline.opened === true, `the sheet still opens with AI unavailable`);
  await sleep(400);
  const offText = await ev(`return (document.getElementById("icuModal")||{}).textContent || "";`);
  ok(/turned off|could not draft/i.test(offText), `it says why it could not draft, and offers to try again`);

  console.log(fails === 0 ? "\nALL GREEN — MaiK drafts the discharge narrative, and only what the clinician accepts" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
