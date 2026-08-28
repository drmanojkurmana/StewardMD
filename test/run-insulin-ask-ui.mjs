/* StewardMD - "Ask MaiK" inside the insulin calculator, real headless browser.
 *
 * The claim under test is the 2026-08-28 decision: MaiK FILLS THE FORM and does not answer the dose.
 * The calculator recomputes live on every keystroke, so the thing that can regress silently is the
 * HOLD: if render() ever stops short-circuiting on st.askPending, a pre-filled form paints a dose in
 * the same instant MaiK filled it, and the feature becomes exactly the inline answer the owner rejected.
 *
 * Also pinned here, because a unit test cannot see them:
 *   - a required input MaiK could not read is BLANK in the form, not sitting on st's default
 *   - Calculate is disabled until the doctor fills it in by hand
 *   - after Calculate the ordinary engine + safety path runs, interrupts included
 *   - nothing is auto-confirmed or auto-logged
 *
 * The LLM is replaced by a mock provider through the production seam (INSULIN_EXTRACT.setProvider),
 * so this test needs no network, no key and no quota.
 *
 * USAGE: node test/run-insulin-ask-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || "http://localhost:8799/";
const CHROME = process.env.CHROME_BIN || process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9371;
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/insulin-ask-" + Date.now();

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const m = BASE.match(/:(\d+)/);
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), m ? m[1] : "8799"], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return '__ERR__'+(x&&x.message)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("PASS " + m); } else { fail++; console.log("FAIL " + m); } };
const has = (sel) => ev(`return !!document.querySelector(${JSON.stringify(sel)});`);
// NOTE: stepper() stamps data-f on the decrement button, the input AND the increment button, so a
// bare [data-f="x"] selector returns the BUTTON (whose .value is ""). Always target the input.
const val = (f) => ev(`var e=document.querySelector(${JSON.stringify(`input[data-f="${f}"]`)}); return e?e.value:"__MISSING__";`);

// Install a mock extraction provider through the PRODUCTION seam, so everything downstream of it
// (validate -> applyPlan -> render) is the real code path.
const mock = (raw) => ev(`window.INSULIN_EXTRACT.setProvider({ extract: function(){ return Promise.resolve(${JSON.stringify(raw)}); } }); return 1;`);
const askRun = async (text) => {
  await ev(`var t=document.querySelector('[data-ins="ask-text"]'); t.value=${JSON.stringify(text)};
            t.dispatchEvent(new Event("input",{bubbles:true})); return 1;`);
  await ev(`document.querySelector('[data-ins="ask-run"]').click(); return 1;`);
  await sleep(500);
};

try {
  let ver, t = 0;
  while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Network.enable", {}); await call("Network.setCacheDisabled", { cacheDisabled: true });
  await call("Page.navigate", { url: BASE });

  let ready = false;
  for (let i = 0; i < 60; i++) { await sleep(400); if (await ev(`return !!(window.INSULIN && window.INSULIN.open);`)) { ready = true; break; } }
  if (!ready) throw new Error("window.INSULIN not available");

  const openCalc = async () => {
    await ev(`window.INSULIN.close(); window.INSULIN.open(); return 1;`); await sleep(600);
    await ev(`var b=document.querySelector('[data-ins="qa"]'); if(b) b.click(); return 1;`); await sleep(500);
  };

  // ---- 0. the flag really gates it (DEFAULT OFF) ----
  await ev(`try{localStorage.removeItem("smd_insulin_ask");}catch(e){} return 1;`);
  await openCalc();
  ok(await has('[data-ins="mode"]'), "the calculator screen renders");
  ok(!(await has('[data-ins="ask-text"]')), "Ask MaiK is HIDDEN while smd_insulin_ask is off (default)");

  await ev(`localStorage.setItem("smd_insulin_ask","1"); return 1;`);
  await openCalc();
  ok(await has('[data-ins="ask-text"]'), "Ask MaiK appears once the flag is on");
  ok(await has('[data-ins="ask-run"]'), "the fill-the-form button is present");
  ok(await ev(`return !!(window.INSULIN_EXTRACT && window.INSULIN_EXTRACT.validate);`), "the extraction seam is reachable");

  /* ---- 1. THE CORE CLAIM: a pre-fill with a missing input holds the result ----
   * The owner's own example. Glucose is stated; the correction factor route is the usual total daily
   * dose, which the text did NOT state unambiguously, so it must be asked for. */
  await mock({
    mode: "correction", corrSource: "tdd",
    rationale: "Correction only, no carbohydrate mentioned.",
    fields: [{ key: "glucose", value: 320, from: "sugar 320 now" }],
    questions: ["Is the 16 units of regular a standing dose, or was it just given?"]
  });
  await askRun("patient on 16 units regular, sugar 320 now, how much?");

  ok(await has(".ins-ask-rev"), "the review card replaces the result area");
  ok(!(await has(".ins-dose")), "NO DOSE is shown: MaiK filled the form, it did not answer");
  ok(!(await has("#insDoseN")), "no dose number element exists while the extraction awaits review");
  // Scoped to everything EXCEPT MaiK's own clarifying questions: a question may legitimately quote
  // the doctor's words back ("was the 16 units just given?"), which is an input, not an answer.
  ok(await ev(`var c=document.querySelector(".ins-ask-rev").cloneNode(true);
               [].forEach.call(c.querySelectorAll(".ins-ask-q"), function(q){ q.remove(); });
               return c.textContent.match(/\\d+(\\.\\d+)?\\s*units\\b/)===null;`),
    "no 'N units' dose text in the review card outside MaiK's quoted questions");

  // the form really is pre-filled, and the mode followed
  ok(await ev(`var b=document.querySelector('[data-ins="mode"][aria-pressed="true"]'); return !!b && b.getAttribute("data-mode")==="correction";`),
    "the mode tab switched to Correction");
  ok(await ev(`var b=document.querySelector('[data-ins="corr-source"][aria-pressed="true"]'); return !!b && b.getAttribute("data-v")==="tdd";`),
    "the correction-factor route switched to the known-TDD pathway");
  ok(String(await val("glucose")) === "320", "glucose was pre-filled to 320 from the doctor's text");

  // provenance: the doctor can see WHICH words produced the value
  ok(await ev(`return document.querySelector(".ins-ask-rev").textContent.indexOf("sugar 320 now")>-1;`),
    "the review card quotes the phrase each value came from");
  ok(await ev(`return document.querySelector(".ins-ask-rev").textContent.indexOf("standing dose")>-1;`),
    "MaiK's clarifying question is shown to the doctor");

  /* ---- 2. the missing input is BLANK, not defaulted ---- */
  ok(String(await val("fdTdd")) === "", "the unstated usual total daily dose is BLANK, not sitting on st's default of 30");
  ok(await ev(`return document.querySelector('[data-ins="ask-calc"]').disabled===true;`),
    "Calculate is DISABLED while a required input is unanswered");
  ok(await has(".ins-ask-sec.need"), "the card lists what MaiK could not read");

  /* ---- 3. the doctor fills it in by hand, and only then can they calculate ---- */
  await ev(`var i=document.querySelector('input[data-f="fdTdd"]'); i.value="40";
            i.dispatchEvent(new Event("input",{bubbles:true})); return 1;`); await sleep(350);
  ok(await ev(`return document.querySelector('[data-ins="ask-calc"]').disabled===false;`),
    "Calculate unlocks once the doctor supplies the missing value");
  ok(!(await has(".ins-dose")), "still no dose before Calculate is pressed");

  const logLen = `return (JSON.parse(localStorage.getItem(Object.keys(localStorage).filter(function(k){return k.indexOf("smd_insulin_log_")===0;})[0]||"")||"[]")).length;`;
  const logBefore = await ev(logLen);

  await ev(`document.querySelector('[data-ins="ask-calc"]').click(); return 1;`); await sleep(600);
  ok(await has(".ins-dose"), "pressing Calculate produces the dose, from the engine");
  ok(await has(".ins-prov, .ins-steps, .ins-result"),
    "the ordinary transparent result (steps / provenance) is shown, not an AI sentence");

  /* ---- 4. nothing is auto-confirmed or auto-logged ---- */
  const logAfter = await ev(logLen);
  ok(Number(logAfter) === Number(logBefore), "calculating logs NOTHING: the confirm gate is untouched (" + logBefore + " -> " + logAfter + ")");
  // Confirming stays a SEPARATE, explicit press. (The manual flow only DISABLES this button on a
  // critical warning or an unacknowledged clinician mode - see ctaDisabled in insulin.js - so the
  // invariant to pin here is that it is still an unpressed button and nothing has been recorded.
  // The interrupt case is covered in scenario 5 below.)
  ok(await ev(`var c=document.querySelector('[data-ins="confirm"]');
               return !!c && c.style.display!=="none" && document.getElementById("insDone").style.display==="none";`),
    "the dose is offered for confirmation, not auto-confirmed");

  /* ---- 5. safety still fires on a MaiK-filled form (the whole reason for pre-filling) ---- */
  await openCalc();
  await mock({
    mode: "correction", corrSource: "isf",
    rationale: "Glucose is low.",
    fields: [{ key: "glucose", value: 55, from: "sugar 55" }, { key: "isf", value: 50, from: "ISF 50" }, { key: "iob", value: 0, from: "no insulin since morning" }]
  });
  await askRun("sugar 55, ISF 50, no insulin since morning");
  ok(await ev(`return document.querySelector('[data-ins="ask-calc"]').disabled===false;`), "a fully-stated scenario needs no extra questions");
  await ev(`document.querySelector('[data-ins="ask-calc"]').click(); return 1;`); await sleep(500);
  ok(await has(".ins-warn.critical"), "a hypoglycaemia CRITICAL warning fires on a MaiK-filled form");
  ok(await ev(`var c=document.querySelector('[data-ins="confirm"]'); return c===null || c.disabled===true;`),
    "the critical interrupt blocks the result exactly as in the manual flow");

  /* ---- 6. an implausible extracted value is refused, not fed to the engine ---- */
  await openCalc();
  await mock({ mode: "basal", rationale: "Weight-based initiation.", fields: [{ key: "weightKg", value: 700, from: "70 kg" }] });
  await askRun("start basal, 70 kg");
  ok(String(await val("ctx.weightKg")) === "", "an implausible 700 kg is dropped and left BLANK");
  ok(await ev(`return document.querySelector('[data-ins="ask-calc"]').disabled===true;`), "and Calculate stays blocked until a real weight is typed");

  /* ---- 7. a transport failure degrades to the manual calculator ---- */
  await openCalc();
  await ev(`window.INSULIN_EXTRACT.setProvider({ extract: function(){ return Promise.reject(new Error("down")); } }); return 1;`);
  await askRun("anything at all");
  ok(await has(".ins-ask-err"), "a failed extraction shows an error");
  ok(!(await has(".ins-ask-rev")), "and does NOT open a review card");
  ok(await has('[data-f="glucose"]'), "the manual calculator is still fully usable");

  /* ---- 8. discard puts the doctor back in manual control ---- */
  await openCalc();
  await mock({ mode: "meal", rationale: "Carbohydrate cover only.", fields: [{ key: "carbs", value: 60, from: "60 g rice" }, { key: "icr", value: 10, from: "ratio 1:10" }] });
  await askRun("60 g rice, ratio 1 to 10");
  ok(await has(".ins-ask-rev"), "a complete extraction still holds the result for review");
  await ev(`document.querySelector('[data-ins="ask-cancel"]').click(); return 1;`); await sleep(400);
  ok(!(await has(".ins-ask-rev")), "Discard closes the review card");
  ok(await has('[data-f="carbs"]'), "and the calculator is back to normal");

} catch (e) {
  fail++; console.log("FAIL harness: " + (e && e.message || e));
} finally {
  console.log(`\n${pass} passed, ${fail} failed`);
  try { ws && ws.close(); } catch {}
  chrome.kill(); if (serveProc) serveProc.kill();
  process.exit(fail ? 1 : 0);
}
