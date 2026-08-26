/* test/run-surgx-ui.mjs — SURGX real-browser test (CDP), modelled on test/run-clinix-ui.mjs.
 *
 * Drives the ACTUAL app: real index.html, real script load order, real content fetched over HTTP,
 * real ws-surgery.js engine. The load-bearing assertions are the flag-off no-op, the three gates,
 * the ws-surgery projection, and the note finalise gate - the things that would do harm if they
 * silently regressed.
 *
 * Linux: CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node test/run-surgx-ui.mjs
 */
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// Node 22's built-in WebSocket, same as run-abx-ui.mjs / run-clinix-ui.mjs. Do NOT import "ws":
// it is not a dependency of this repo and the harness must run with no install step.

const HERE = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = (process.env.BASE || "http://localhost:8996/").replace(/\/?$/, "/");
const PORT = 9389;
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/surgx-ui-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8996"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();

const chrome = spawn(CHROME, [
  ...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean),
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--no-sandbox"
], { stdio: "ignore" });

let msgId = 1;
const pending = new Map();
let ws, sessionId;
const call = (m, p) => {
  const i = msgId++;
  return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); });
};
// The helper wraps its argument in `return (...)`, so a multi-statement snippet must be written
// as an IIFE expression. (Recorded gotcha from the CliniX harness.)
const ev = async (expr) => {
  const r = await call("Runtime.evaluate", {
    expression: `(() => { try { return (${expr}); } catch (e) { return { __err: String(e) }; } })()`,
    returnByValue: true, awaitPromise: true
  });
  return r?.result?.result?.value;
};

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "✅" : "❌") + " " + msg); if (!cond) fails++; };

async function attach(url) {
  const { result } = await call("Target.createTarget", { url: "about:blank" });
  const t = await call("Target.attachToTarget", { targetId: result.targetId, flatten: true });
  sessionId = t.result.sessionId;
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Page.navigate", { url });
  for (let i = 0; i < 80; i++) {
    const ready = await ev("!!(window.SMD_SURGX_FLAGS && window.SURGX)");
    if (ready) break;
    await sleep(400);
  }
  await ev(`["introPoster","splash","accountGate","introOverlay"].forEach(id => { const el = document.getElementById(id); if (el) el.remove(); }); true`);
  await sleep(300);
}
async function waitFor(sel, tries = 40) {
  for (let i = 0; i < tries; i++) {
    if (await ev(`!!document.querySelector(${JSON.stringify(sel)})`)) return true;
    await sleep(250);
  }
  return false;
}
const clickText = async (sel, text) =>
  ev(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find(x => x.textContent.includes(${JSON.stringify(text)})); if (b) { b.click(); return true; } return false; })()`);

try {
  let wsUrl = null;
  for (let i = 0; i < 60; i++) {
    try { wsUrl = (await (await fetch(`http://localhost:${PORT}/json/version`)).json()).webSocketDebuggerUrl; break; }
    catch { await sleep(300); }
  }
  if (!wsUrl) throw new Error("Chrome did not expose a debugger. Set CHROME to a chromium binary.");
  ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (e) => {
    const m = JSON.parse(typeof e.data === "string" ? e.data : String(e.data));
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };

  /* ── 1. FLAG OFF: a complete no-op ─────────────────────────────────────── */
  console.log("\n--- flag OFF ---");
  await attach(BASE + "?surgx=0");

  ok((await ev("window.SURGX && SURGX.isOn()")) === false, "SURGX.isOn() is false with the flag off");
  await ev("window.SURGX.open()");
  await sleep(200);
  ok((await ev("!!document.getElementById('surgxRoot')")) === false,
    "open() with the flag off creates NO #surgxRoot (it returns before touching the DOM)");
  ok((await ev("document.documentElement.classList.contains('sgx-lock')")) === false,
    "no sgx-lock class is applied");
  ok((await ev("getComputedStyle(document.body).getPropertyValue('--sgx-steel').trim() === ''")) === true,
    "no --sgx-* custom property leaks into the page");
  ok((await ev("!(window.SMD_SURGX_CONTENT && SMD_SURGX_CONTENT._cache().catalog)")) === true,
    "no content is fetched with the flag off");
  ok((await ev("!document.querySelector('[data-act=\"surgx\"]')")) === true,
    "no SURGX home tile is rendered with the flag off");

  // The existing Surgery workspace must be completely untouched when SURGX is off.
  ok((await ev("!!(window.SMD_WS_ENGINES && SMD_WS_ENGINES.surgery && SMD_WS_ENGINES.surgery.syndromes.length)")) === true,
    "ws-surgery.js still registers its engine, unchanged, with the flag off");

  /* ── 2. FLAG ON: mount + home ──────────────────────────────────────────── */
  console.log("\n--- flag ON ---");
  await attach(BASE + "?surgx=1");

  ok((await ev("window.SURGX.isOn()")) === true, "SURGX.isOn() is true with ?surgx=1");
  await ev("window.SURGX.open()");
  ok(await waitFor("#surgxRoot .sgx-sec"), "#surgxRoot mounts and the home screen renders");
  ok((await ev("document.getElementById('surgxRoot').classList.contains('sgx-open')")) === true, "the overlay is open");
  ok((await ev("document.querySelectorAll('#surgxRoot .sgx-sec').length === 5")) === true,
    "exactly FIVE sections - no calculators section, by product decision");
  ok((await ev("!!document.querySelector('#surgxRoot .sgx-hero-mark')")) === true, "the SURGX hero renders");
  ok((await ev("document.querySelector('#surgxRoot .sgx-wrap').textContent.includes('Notes')")) === true, "01 Notes is listed");
  ok((await ev("document.querySelector('#surgxRoot .sgx-wrap').textContent.includes('Protocols')")) === true, "02 Protocols is listed");
  ok((await ev("document.querySelector('#surgxRoot .sgx-wrap').textContent.includes('Procedures')")) === true, "03 Procedures is listed");
  ok((await ev("document.querySelector('#surgxRoot .sgx-wrap').textContent.includes('Evidence')")) === true, "04 Evidence is listed");
  ok((await ev("document.querySelector('#surgxRoot .sgx-wrap').textContent.includes('Cases')")) === true, "05 Cases is listed");

  // swipe-back.js matches back/close purely by class pattern. If these drift, the Android hardware
  // back button and the drag-back gesture both silently stop working.
  ok((await ev("!!document.querySelector('#surgxRoot [class*=\"sgx-close\"]')")) === true,
    "a close control matching swipe-back.js BACK_SEL exists");

  /* ── 3. PROTOCOLS: the engine projection, live ─────────────────────────── */
  console.log("\n--- 02 protocols ---");
  await clickText("#surgxRoot .sgx-sec", "Protocols");
  ok(await waitFor("#surgxRoot .sgx-row"), "the protocol index loads");
  const nProtos = await ev("document.querySelectorAll('#surgxRoot .sgx-row').length");
  ok(nProtos >= 18, `both authored and engine protocols are listed (${nProtos})`);
  ok((await ev("document.querySelector('#surgxRoot .sgx-wrap').textContent.includes('Acute abdomen')")) === true,
    "a ws-surgery engine syndrome appears in the index");
  ok((await ev("document.querySelector('#surgxRoot .sgx-wrap').textContent.includes('Trauma primary survey')")) === true,
    "an authored protocol appears in the same index");

  await clickText("#surgxRoot .sgx-row", "Acute abdomen");
  ok(await waitFor("#surgxRoot .sgx-band"), "the protocol opens");
  ok((await ev("document.querySelectorAll('#surgxRoot .sgx-band').length === 7")) === true,
    "all SEVEN bands render, always, in fixed order");
  const bandOrder = await ev("[...document.querySelectorAll('#surgxRoot .sgx-band .bt')].map(e => e.textContent.trim()).join('|')");
  ok(bandOrder === "Red flags|Do now|Assess|Investigate|Resuscitate / stabilise|Definitive management|Escalation / transfer",
    "the spine order is exactly as the model defines it: " + bandOrder);
  ok((await ev("!!document.querySelector('#surgxRoot .sgx-empty')")) === true,
    "an unfilled band shows an honest empty state rather than being dropped");

  // The interactive projection: tick a danger sign, and the engine's own output must change.
  const before = await ev("document.querySelector('#surgxRoot .sgx-wrap').textContent.includes('time-critical')");
  ok(before === false, "no emergency assertion before any finding is ticked");
  const ticked = await clickText("#surgxRoot .sgx-chip.danger", "rigid abdomen");
  ok(ticked === true, "a danger sign chip is tappable");
  await sleep(350);
  ok((await ev("document.querySelector('#surgxRoot .sgx-headline.emerg') !== null")) === true,
    "PROJECTION: ticking a danger sign makes the ws-surgery engine declare an emergency, live");
  ok((await ev("document.querySelector('#surgxRoot .sgx-wrap').textContent.includes('Piperacillin')")) === true,
    "and the engine's own empiric regimen appears, unaltered");
  ok((await ev("!!document.querySelector('#surgxRoot .sgx-ladder .r.on')")) === true,
    "the engine's management ladder position is shown");
  ok((await ev("document.querySelector('#surgxRoot .sgx-wrap').textContent.includes('ICMR')")) === true,
    "the engine's own antimicrobial reference string survives");

  // Provenance is not optional.
  ok((await ev("document.querySelector('#surgxRoot .sgx-wrap').textContent.includes('Source:')")) === true,
    "action items carry a visible source line");
  ok((await ev("document.querySelector('#surgxRoot .sgx-wrap').textContent.includes('Draft, pending clinician review')")) === true,
    "draft content says so on the screen, every time");

  // Calculators are reached, never duplicated.
  ok((await ev("!!document.querySelector('#surgxRoot [data-sgx=\"calc\"]')")) === true,
    "surgical calculators are offered as deep links");
  const calcId = await ev("document.querySelector('#surgxRoot [data-sgx=\"calc\"]').getAttribute('data-id')");
  ok((await ev(`!!(window.MEDCALC && MEDCALC.get(${JSON.stringify(calcId)}))`)) === true,
    `the deep-linked calculator "${calcId}" exists in the app's own Calculators module`);

  /* ── 4. PROCEDURES ─────────────────────────────────────────────────────── */
  console.log("\n--- 03 procedures ---");
  await ev("window.SMD_SURGX_SCREENS.go('procedures')");
  ok(await waitFor("#surgxRoot .sgx-row"), "the procedure index loads");
  await clickText("#surgxRoot .sgx-row", "Appendicectomy");
  ok(await waitFor("#surgxRoot .sgx-tab"), "the procedure opens with its chapter tabs");
  ok((await ev("document.querySelectorAll('#surgxRoot .sgx-tab').length >= 10")) === true,
    "the fixed chapter set renders");
  ok((await ev("document.querySelector('#surgxRoot .sgx-wrap').textContent.includes('Educational reference')")) === true,
    "the educational framing is present and not dismissible");
  await clickText("#surgxRoot .sgx-tab", "Steps");
  await sleep(300);
  ok((await ev("document.querySelectorAll('#surgxRoot .sgx-step').length >= 10")) === true,
    "the step runner renders the shared + local steps in order");
  ok((await ev("document.querySelector('#surgxRoot .sgx-wrap').textContent.includes('At risk:')")) === true,
    "structures at risk are surfaced on the steps that carry them");

  await clickText("#surgxRoot .sgx-tab", "Anatomy");
  await sleep(300);
  ok((await ev("!!document.querySelector('#surgxRoot .sgx-media svg')")) === true,
    "LICENCE GATE: a self-authored inline diagram renders");
  ok((await ev("document.querySelector('#surgxRoot .sgx-media .attr').textContent.includes('StewardMD')")) === true,
    "and it is attributed");

  /* ── 5. THE LICENCE GATE, the other way ────────────────────────────────── */
  await clickText("#surgxRoot .sgx-tab", "Steps");
  await sleep(300);
  ok((await ev("!!document.querySelector('#surgxRoot .sgx-media.pending')")) === true,
    "LICENCE GATE: an uncleared asset renders as caption + 'visual pending', never a blank or a broken image");
  ok((await ev("!document.querySelector('#surgxRoot .sgx-media.pending img')")) === true,
    "and no image element is emitted for it");

  /* ── 6. EVIDENCE ───────────────────────────────────────────────────────── */
  console.log("\n--- 04 evidence ---");
  await ev("window.SMD_SURGX_SCREENS.go('evidence')");
  ok(await waitFor("#surgxRoot .sgx-row"), "the evidence index loads");
  ok((await ev("document.querySelectorAll('#surgxRoot .sgx-row').length >= 10")) === true, "evidence records are listed");
  await clickText("#surgxRoot .sgx-row", "Critical View of Safety");
  ok(await waitFor("#surgxRoot .sgx-ev"), "an evidence record opens");
  ok((await ev("document.querySelector('#surgxRoot .sgx-ev .own').textContent.includes('StewardMD summary')")) === true,
    "the record is labelled as our own summary, not reproduced guideline text");
  ok((await ev("!!document.querySelector('#surgxRoot .sgx-ev .src a')")) === true,
    "and it links to the authoritative source");
  ok((await ev("!!document.querySelector('#surgxRoot [data-sgx=\"lit\"]')")) === true,
    "a live literature review is offered but never run automatically");

  /* ── 7. CASES ──────────────────────────────────────────────────────────── */
  console.log("\n--- 05 cases ---");
  await ev("window.SMD_SURGX_SCREENS.go('cases')");
  ok(await waitFor("#surgxRoot .sgx-row"), "the case index loads");
  ok((await ev("!!document.querySelector('#surgxRoot .sgx-banner.sim')")) === true,
    "the simulation banner is present on the index");
  await clickText("#surgxRoot .sgx-row", "Right iliac fossa pain");
  ok(await waitFor("#surgxRoot .sgx-opt"), "the case runner opens");
  ok((await ev("!!document.querySelector('#surgxRoot .sgx-stem')")) === true, "the stem renders");
  ok((await ev("!!document.querySelector('#surgxRoot .sgx-vital')")) === true, "the vitals render");
  ok((await ev("document.querySelectorAll('#surgxRoot .sgx-card').length <= 3")) === true,
    "only the FIRST question is shown - the reader cannot read ahead");

  const nOpts = await ev("document.querySelectorAll('#surgxRoot .sgx-opt').length");
  ok(nOpts >= 2, "the first decision point offers options");
  await ev("[...document.querySelectorAll('#surgxRoot .sgx-opt')].pop().click()");   // deliberately a wrong one
  await sleep(350);
  ok((await ev("!!document.querySelector('#surgxRoot .sgx-why')")) === true,
    "answering reveals the teaching, with AI entirely uninvolved");
  ok((await ev("!!document.querySelector('#surgxRoot .sgx-opt.right')")) === true, "the correct option is marked");
  ok((await ev("!!document.querySelector('#surgxRoot .sgx-opt[disabled]')")) === true, "the question locks after answering");

  /* ── 8. NOTES: the finalise gate ───────────────────────────────────────── */
  console.log("\n--- 01 notes ---");
  // The harness reuses --user-data-dir, so localStorage survives between runs, and the "verified
  // session" section below deliberately SETS smd_verify_bypass. Clearing it mid-run is not enough:
  // prescription.js primes its verification cache AT BOOT, so a page that booted with last run's
  // bypass still answers canPrescribe() === true no matter what we delete afterwards. Clear the
  // keys, then RE-BOOT so the gate is evaluated against the state we actually want to test.
  await ev("(() => { localStorage.removeItem('smd_verify_bypass'); window.SMD_SURGX_STORE.wipe(); return true; })()");
  await attach(BASE + "?surgx=1");
  await ev("(() => { localStorage.removeItem('smd_verify_bypass'); return true; })()");
  await ev("window.SURGX.open('notes')");
  await sleep(500);
  /* The registration gate is OFF by default (owner decision, 2026-08-25): a surgical note is the
     surgeon's own record of what they did, not an order acting on a patient. So an unverified
     session must reach the authoring surface, NOT a "verify first" wall. */
  const notesState = await ev("document.querySelector('#surgxRoot .sgx-wrap').textContent");
  ok(/Verify to use Notes/.test(notesState) === false,
    "the registration gate is off by default: an unverified session reaches Notes");
  ok((await ev("window.SMD_SURGX_ENTITLEMENT.notesAccess()")) === "allowed",
    "and notesAccess() says so");
  // But the gate must still WORK when switched back on, or "reversible" is a lie.
  ok((await ev(`window.SMD_SURGX_ENTITLEMENT.notesAccess({
      flag: (k) => k === "smd_surgx_notes" || k === "smd_surgx_notes_verify",
      canPrescribe: () => false, bypass: () => false
    })`)) === "verify_required",
    "REVERSIBLE: with smd_surgx_notes_verify on, an unverified session is gated again");
  // Notes being open must never mean prescribing is open - that gate is separate and untouched.
  ok((await ev("!document.querySelector('#surgxRoot [data-sgx=\"prescribe\"], #surgxRoot .rx-btn')")) === true,
    "SAFETY: opening Notes does not expose any prescription affordance");

  // Now exercise the editor itself, using the app's OWN existing beta bypass so we are testing the
  // real gate rather than working around it.
  console.log("\n--- 01 notes (verified session) ---");
  await attach(BASE + "?surgx=1");
  // ev() wraps its argument in `return (...)`, so a multi-statement snippet MUST be an IIFE
  // expression. Getting this wrong fails silently: the statement never runs and the assertion
  // that depends on it reports a product bug that does not exist.
  await ev("(() => { localStorage.setItem('smd_verify_bypass','1'); return true; })()");
  await ev("window.SURGX.open('notes')");
  await sleep(600);

  {
    ok((await ev("!document.querySelector('#surgxRoot .sgx-wrap').textContent.includes('Verify to use Notes')")) === true,
      "the bypass opens Notes, so the gate is a gate and not a wall");
    ok(await waitFor("#surgxRoot [data-sgx=\"newnote\"]"), "the note-type list renders");
    await clickText("#surgxRoot .sgx-row", "Operative note");
    await sleep(400);
    // Either the template picker or the editor, depending on templates available.
    if (await ev("!!document.querySelector('#surgxRoot [data-sgx=\"mknote\"]')")) {
      await clickText("#surgxRoot .sgx-row", "General operative note");
      await sleep(400);
    }
    ok(await waitFor("#surgxRoot .sgx-fld"), "the note editor renders its fields");
    ok((await ev("!!document.querySelector('#surgxRoot .sgx-sticky')")) === true, "the status bar is present");
    ok((await ev("document.querySelector('#surgxRoot .sgx-sticky .stat').textContent.includes('missing')")) === true,
      "a fresh note reports its missing required fields");
    ok((await ev("document.querySelector('#surgxRoot [data-sgx=\"notefinal\"]').disabled")) === true,
      "FINALISE GATE: finalise is disabled while required fields are missing");
    ok((await ev("document.querySelectorAll('#surgxRoot .sgx-fld.is-missing').length > 0")) === true,
      "missing required fields are SHOWN in red, never quietly omitted");
    ok((await ev("!!document.querySelector('#surgxRoot .sgx-prov.missing')")) === true,
      "and each carries a text provenance label, not colour alone");
    ok((await ev("document.querySelector('#surgxRoot #sgxNotePreview').textContent.includes('DRAFT - NOT VERIFIED')")) === true,
      "the preview is stamped DRAFT");
    ok((await ev("document.querySelector('#surgxRoot #sgxNotePreview').textContent.includes('[NOT RECORDED]')")) === true,
      "and prints every missing required field explicitly");

    // Type into one field and confirm the provenance flips to clinician.
    await ev(`(() => { const el = document.querySelector('#surgxRoot [data-sgx-field="findings"]'); el.value = "Inflamed appendix"; el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
    await sleep(200);
    ok((await ev("!!document.querySelector('#surgxRoot .sgx-fld.is-clinician')")) === true,
      "a typed field is immediately marked as the clinician's own");
    ok((await ev("document.querySelector('#surgxRoot #sgxNotePreview').textContent.includes('Inflamed appendix')")) === true,
      "and the preview updates live without losing the caret");
    ok((await ev("document.querySelector('#surgxRoot [data-sgx=\"notefinal\"]').disabled")) === true,
      "finalise is still blocked - one field is not a note");

    // Fill EVERY required field, then check the gate actually opens, and that finalising takes two
    // deliberate presses rather than one.
    const filled = await ev(`(() => {
      const S = window.SMD_SURGX_SCREENS._state();
      const fields = S.noteSchema.sections.reduce((a, s) => a.concat(s.fields), []);
      let n = 0;
      fields.forEach(f => {
        if (!f.required) return;
        const el = document.querySelector('#surgxRoot [data-sgx-field="' + f.k + '"]');
        if (!el) return;
        el.value = "Recorded by the surgeon";
        el.dispatchEvent(new Event("input", { bubbles: true }));
        n++;
      });
      return n;
    })()`);
    ok(filled > 8, `every required field can be typed (${filled} filled)`);
    await sleep(300);
    ok((await ev("document.querySelector('#surgxRoot .sgx-sticky .stat').textContent.includes('Ready to finalise')")) === true,
      "with every required field confirmed, the status bar says so");
    ok((await ev("document.querySelector('#surgxRoot [data-sgx=\"notefinal\"]').disabled")) === false,
      "and finalise unlocks");

    await ev("document.querySelector('#surgxRoot [data-sgx=\"notefinal\"]').click()");
    await sleep(200);
    ok((await ev("document.querySelector('#surgxRoot [data-sgx=\"notefinal\"]').getAttribute('data-armed') === '1'")) === true,
      "FINALISE GATE: the first press ARMS rather than finalising - a clinical record is never one tap");
    ok((await ev("!!document.querySelector('#surgxRoot #sgxNotePreview').textContent.includes('DRAFT')")) === true,
      "and the note is still a draft after that first press");

    await ev("document.querySelector('#surgxRoot [data-sgx=\"notefinal\"]').click()");
    await sleep(700);
    ok((await ev("!document.querySelector('#surgxRoot #sgxNotePreview').textContent.includes('DRAFT - NOT VERIFIED')")) === true,
      "the second press finalises it");
    ok((await ev("document.querySelector('#surgxRoot #sgxNotePreview').textContent.includes('Finalised by')")) === true,
      "and the note records who finalised it");

    /* ── patient linking ───────────────────────────────────────────────── */
    console.log("\n--- 01 notes: patient ---");
    ok((await ev(`(() => Array.from(document.querySelectorAll('#surgxRoot .sgx-card h4')).some(h => h.textContent.trim() === 'Patient'))()`)) === true,
      "the note carries a Patient card");
    ok((await ev(`!!document.querySelector('#surgxRoot [data-sgx="ptfromemr"]') && !!document.querySelector('#surgxRoot [data-sgx="ptmanual"]')`)) === true,
      "BOTH routes are offered: from a hospital EMR, or entered manually");
    // A surgeon with no hospital connection must still be able to name a patient.
    await ev(`(() => { document.querySelector('#surgxRoot [data-sgx="ptmanual"]').click(); return true; })()`);
    await sleep(400);
    ok((await ev(`!!document.querySelector('#surgxRoot [data-sgx-ptmanual]')`)) === true,
      "manual entry opens a reference field for a solo surgeon");
    await ev(`(() => { const i = document.querySelector('#surgxRoot [data-sgx-ptmanual]'); i.value = 'R.K. 4471'; document.querySelector('#surgxRoot [data-sgx="ptmanualsave"]').click(); return true; })()`);
    await sleep(700);
    ok((await ev(`document.querySelector('#surgxRoot .sgx-wrap').textContent.includes('R.K. 4471')`)) === true,
      "the manually entered patient is linked to the note");
    ok((await ev(`document.querySelector('#surgxRoot .sgx-wrap').textContent.includes('Entered manually')`)) === true,
      "and the note says where that patient came from");
    // The whole point of recording the source: a manual patient has no writable hospital record.
    ok((await ev(`(() => {
      const n = Array.from(document.querySelectorAll('#surgxRoot [data-sgx="notedest"]')).find(b => b.getAttribute('data-id') === 'emr');
      return !!n && n.disabled && /manually entered|no hospital record/i.test(n.querySelector('.sb').textContent);
    })()`)) === true, "a manual patient disables the EMR row and says why");
    ok((await ev(`window.SMD_SURGX_PATIENT.writability({source:'manual',name:'x'}).canWrite === false
      && window.SMD_SURGX_PATIENT.writability({source:'connect',patientId:'p'}).canWrite === false
      && window.SMD_SURGX_PATIENT.writability({source:'ghis',patientId:'p',episodeId:'e'}).canWrite === true`)) === true,
      "only a GHIS patient with a visit is writable");
    // The linked patient must survive a reload, encrypted.
    ok((await ev(`(() => { const n = window.SMD_SURGX_STORE.listNotes()[0]; return !!n; })()`)) === true,
      "the note with its patient is stored");

    /* ── save destinations ─────────────────────────────────────────────────
       The note is finalised at this point, so the export rows are live. */
    console.log("\n--- 01 notes: save destinations ---");
    const destRows = await ev(`(() => {
      const n = document.querySelectorAll('#surgxRoot [data-sgx="notedest"]');
      return Array.from(n).map(b => b.getAttribute('data-id') + (b.disabled ? ':off' : ':on')).join(',');
    })()`);
    ok(/local/.test(destRows) && /drive/.test(destRows) && /emr/.test(destRows),
      "all three destinations are OFFERED (local, Drive, hospital EMR): " + destRows);
    ok(/local:on/.test(destRows), "saving to this device is available");
    // Headless Chrome has no native drive.file token and no GHIS session, so both exports must be
    // shown-but-disabled rather than hidden - and must say why.
    ok(/drive:off/.test(destRows) && /emr:off/.test(destRows),
      "with no Drive account and no GHIS session, both exports are disabled rather than hidden");
    const destReasons = await ev(`(() => {
      const n = document.querySelectorAll('#surgxRoot [data-sgx="notedest"]');
      return Array.from(n).filter(b => b.disabled).every(b => (b.querySelector('.sb')||{}).textContent);
    })()`);
    ok(destReasons === true, "every unavailable destination states a reason");
    // The EMR row is now OFFERED by default (it writes over the verified OPD transport), so in a
    // browser with no GHIS session it must be blocked on the SESSION, not on the feature.
    ok((await ev(`(() => {
      const r = window.SMD_SURGX_DEST.availability().find(x => x.id === 'emr');
      return r && !r.available && /GHIS/i.test(r.reason);
    })()`)) === true, "with no GHIS session the EMR row is blocked on sign-in, not on the feature");
    ok((await ev(`document.querySelector('#surgxRoot .sgx-card h4') && Array.from(document.querySelectorAll('#surgxRoot .sgx-card h4')).some(h => h.textContent.trim() === 'Save to')`)) === true,
      "the destinations appear under a 'Save to' heading");
    ok((await ev("document.querySelector('#surgxRoot .sgx-wrap').textContent.includes('patient identifiers')")) === true,
      "the card warns that sending the note off-device is a PHI disclosure");
    // The export transports must refuse an unconfirmed send even if called directly.
    ok((await ev("window.SMD_SURGX_DEST.send('drive', {}, 'x', {}).then(r => r.error)")) === "not_confirmed",
      "a direct send() with no confirmation is refused");

    // Encrypted persistence, end to end: it must come back off disk decrypted.
    const stored = await ev("window.SMD_SURGX_STORE.listNotes().length");
    ok(stored >= 1, "the note is saved to the device store");
    const raw = await ev(`(() => {
      const k = Object.keys(localStorage).find(x => x.indexOf('smd_surgx_note_') === 0);
      return k ? localStorage.getItem(k).slice(0, 200) : "";
    })()`);
    ok(typeof raw === "string" && raw.length > 20 && !/Recorded by the surgeon/.test(raw),
      "AT REST: the stored blob is ciphertext - the note text is not readable in localStorage");
    ok(/"alg"\s*:\s*"AES-GCM"/.test(raw), "and it is an AES-GCM envelope: " + raw.slice(0, 60));
    const roundTrip = await ev(`window.SMD_SURGX_STORE.loadNote(window.SMD_SURGX_STORE.listNotes()[0].id).then(n => !!(n && n.finalized && n.values && n.values.findings))`);
    ok(roundTrip === true, "and it decrypts back to a finalised note with its fields intact");

    /* ── encrypted Drive backup, in the real screen ────────────────────── */
    console.log("\n--- 01 notes: encrypted Drive backup ---");
    ok((await ev("!!window.SMD_SURGX_SYNC")) === true, "surgx-sync.js is loaded by index.html");
    // Back to the notes LIST - the banner and controls live there, not on an open note.
    await ev("window.SURGX.open('notes')");
    await sleep(300);
    // Default OFF: an upgrade must never silently begin uploading operative notes.
    ok((await ev("window.SMD_SURGX_SYNC.flagOn() === false")) === true,
      "the backup feature is OFF until it is switched on");
    ok((await ev(`document.querySelector('#surgxRoot .sgx-wrap').textContent.includes('signing out or reinstalling')`)) === true,
      "with no backup, the notes banner warns plainly that sign-out deletes them");
    ok((await ev(`!document.querySelector('#surgxRoot [data-sgx="bkToggle"]')`)) === true,
      "and no backup controls are shown while the feature flag is off");

    // Turn the flag on and repaint: the controls and the honest banner must both appear.
    await ev(`(() => { localStorage.setItem('smd_surgx_drive_backup','1'); return true; })()`);
    await ev("window.SURGX.open('notes')");
    await sleep(300);
    ok((await ev("window.SMD_SURGX_SYNC.flagOn() === true")) === true, "the flag reads back on");
    ok((await ev(`!!document.querySelector('#surgxRoot [data-sgx="bkToggle"]')`)) === true,
      "the backup control appears once the feature is enabled");
    ok((await ev(`document.querySelector('#surgxRoot .sgx-wrap').textContent.includes('Google')`)) === true,
      "and the section names where the backup goes");
    // Nothing may upload without BOTH a password and a Drive token; headless Chrome has neither.
    ok(["no_password", "no_token"].includes(
      await ev("window.SMD_SURGX_SYNC.syncNow().then(r => r.error)")),
      "with no clinic password and no Drive token, a sync refuses instead of uploading");
    ok((await ev("window.SMD_SURGX_SYNC.restore().then(r => r.ok === false)")) === true,
      "and a restore cannot run either");
    // The payload guard, in the real browser: a My Clinic backup must never load as notes.
    ok((await ev(`(() => { try { window.SMD_SURGX_SYNC.parsePayload(JSON.stringify({v:1,patients:[]})); return "no-throw"; } catch (e) { return e.message; } })()`)) === "not_surgx_backup",
      "a My Clinic backup is refused as a note backup");
    await ev(`(() => { localStorage.removeItem('smd_surgx_drive_backup'); return true; })()`);

    // Sign-out must not leave PHI behind for the next account on this device.
    await ev("(() => { window.SMD_SURGX_STORE.wipe(); return true; })()");
    ok((await ev("window.SMD_SURGX_STORE.listNotes().length === 0")) === true, "sign-out wipes every note");
    ok((await ev("!Object.keys(localStorage).some(k => k.indexOf('smd_surgx_note_') === 0)")) === true,
      "including the ciphertext itself");
  }

  /* ── 9. Safety invariants across the whole module ──────────────────────── */
  console.log("\n--- safety ---");
  await ev("window.SMD_SURGX_SCREENS.go('protocols')");
  await sleep(400);
  ok((await ev("!document.querySelector('#surgxRoot [data-act*=\"rx\"], #surgxRoot [class*=\"sgx-rx\"]')")) === true,
    "SURGX exposes no prescription affordance anywhere");
  ok((await ev("!document.querySelector('#surgxRoot input[type=\"text\"][placeholder*=\"Ask\"], #surgxRoot textarea[placeholder*=\"Ask\"]')")) === true,
    "there is no free-text AI chat surface inside SURGX");
  ok((await ev("!document.querySelector('#surgxRoot [class*=\"streak\"], #surgxRoot [class*=\"badge-earned\"], #surgxRoot [class*=\"trophy\"]')")) === true,
    "no gamification: no streaks, no badges, no trophies");

  /* ── 10. Responsive: a narrow viewport must not scroll horizontally ────── */
  console.log("\n--- responsive ---");
  await call("Emulation.setDeviceMetricsOverride", { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
  await sleep(400);
  await ev("window.SMD_SURGX_SCREENS.go('protocol/acute_abdomen')");
  await sleep(600);
  const overflow = await ev("(() => { const r = document.getElementById('surgxRoot'); return r.scrollWidth - r.clientWidth; })()");
  ok(overflow <= 2, `no horizontal overflow at 360px (${overflow}px)`);
  const tapTargets = await ev(`(() => {
    const bad = [];
    document.querySelectorAll('#surgxRoot button').forEach(b => {
      const r = b.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.height < 32) bad.push(b.className + ':' + Math.round(r.height));
    });
    return bad.slice(0, 5);
  })()`);
  ok(Array.isArray(tapTargets) && tapTargets.length === 0, "every visible control clears a usable tap height: " + JSON.stringify(tapTargets));
  await call("Emulation.clearDeviceMetricsOverride");

  /* ── 11. The Surgery workspace bridge ──────────────────────────────────── */
  console.log("\n--- ws-surgery bridge ---");
  await ev("window.SURGX.close()");
  await sleep(200);
  ok((await ev("!!(window.SMD_WS_ENGINES && SMD_WS_ENGINES.surgery)")) === true,
    "the ws-surgery engine is still registered and untouched after SURGX has run");
  ok((await ev("SMD_WS_ENGINES.surgery.syndromes.length >= 13")) === true,
    "with all of its syndromes intact");

} catch (e) {
  console.error("harness error:", e);
  fails++;
} finally {
  try { ws && ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { serveProc && serveProc.kill(); } catch {}
  console.log("\n" + (fails === 0 ? "all SURGX UI checks passed" : fails + " SURGX UI check(s) failed"));
  process.exit(fails === 0 ? 0 : 1);
}
