/* test/ward-clinical-forms.test.mjs - retest 2026-09-16 (docs/wardsynq/LIVE_RETEST_2026-09-16.md), the ward screen half.
 * Pure _render and source checks on the real ward.js; the real-browser half is test/run-ward-clinical-forms-ui.mjs.
 *   - clinical writes ask on the ward (askFor), not in a native prompt/confirm (lab Collect, critical acknowledge,
 *     bed admit and transfer, and every other clinical write in this file);
 *   - an order finding is labelled by what the server does with it; a hard stop offers no "Prescribe anyway";
 *   - NEWS2 names what is missing in words, the flowsheet shows mmHg and °C, the fluid balance of a new admission
 *     counts only the hours since admission, and Record vitals says it is saving;
 *   - a known ED arrival carries a chief complaint.
 *
 * node --test test/ward-clinical-forms.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SRC = readFileSync(new URL("../ward.js", import.meta.url), "utf8");
function load() {
  const win = {};
  const doc = { getElementById: () => null, createElement: () => ({ classList: { add() {}, remove() {} } }), body: { appendChild() {} } };
  new Function("window", "document", "location", "localStorage", SRC)(win, doc, { search: "" }, { getItem: () => null, setItem: () => {} });
  return win.WARD;
}
const base = { orgId: "org-wsq", ward: "", patients: [], view: "list", sel: null, problems: [], due: [], dueAt: "", busy: false, err: "", note: "", refusal: null, loaded: true };
const chart = (over) => Object.assign({}, base, {
  view: "chart",
  sel: { encounterId: "wsq-adm-x", patientId: "opd-pat-x", name: "Test Patient QA-04", ward: "Ward A", bed: "12", admittedAt: "2026-09-07T04:00:00.000Z" },
}, over || {});
const code = SRC.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const body = (name) => {
  const i = code.indexOf("function " + name + "(");
  assert.ok(i >= 0, name + " exists");
  const j = code.indexOf("\n  function ", i + 10);
  return code.slice(i, j < 0 ? undefined : j);
};

test("clinical writes ask on the ward: no native prompt or confirm is left in them", () => {
  const converted = ["collectSpecimen", "acknowledge", "acknowledgeBoard", "pickBed", "transferTo", "edDispositionHome", "offlineChoice",
    "resusWaive", "resusMark", "resusVoid", "txReaction", "approvalDecide", "surgeryAbandon", "dispenseReturn", "specimenOutcomeAct", "histoAddendum",
    "tagEnd", "mpiMerge", "infusionChart", "carePlanProgress", "admReqClose", "pathwayOverride", "breakGlassDeclare", "riskActionDone", "medRecDecide",
    "handoverTake", "survAck", "referralAct", "documentPurge", "documentWithdraw", "documentRelease", "immunizationError", "personRemove",
    "deathRecord", "deathWithdraw", "askSignal", "incidentClose", "emergencyDeactivateAction", "withdrawConsentAction", "roiAuthorizeAction",
    "roiDenyAction", "roiCancelAction", "roiFulfillAction", "transmit", "resolveTx", "marAction"];
  for (const f of converted) assert.doesNotMatch(body(f), /\b(prompt|confirm|alert)\(/, f + " uses no native dialog");
  // Lab return-for-re-entry and a nursing task cancel sit in the dispatcher.
  assert.doesNotMatch(body("dispatch"), /\b(prompt|confirm)\(/, "the dispatcher asks nothing natively");
  // What is left is outside clinical writes (MaiK and integration: fix-admin-maik; billing, claims, purchasing, scheduling).
  const left = [...code.matchAll(/\b(?:G\.|window\.)?(prompt|confirm|alert)\(/g)].length;
  assert.ok(left <= 29, "native dialogs left only in the other lanes' screens: " + left);
});

test("the in-app question keeps what was typed, says its error inside, and writes only from its own button", () => {
  const W = load();
  const ask = { spec: { title: "Collect", ok: "Collect", icon: "colorize", fields: [
    { key: "specimenType", label: "Specimen type", required: "Say which specimen was taken." },
    { key: "why", type: "textarea", label: "What did you do about this result?" },
    { key: "override", type: "select", label: "Use that here?", options: [["no", "No"], ["yes", "Yes"]] }] },
    values: { specimenType: "Serum <b>", why: "Called the registrar", override: "yes" }, err: "The scanned wristband does not match this patient's order. Nothing was collected.", busy: false };
  const html = W._render(chart({ ask }));
  assert.match(html, /class="w-ask"><div class="w-card" role="dialog" aria-modal="true"/);
  assert.match(html, /id="wAsk_specimenType" data-w-ask="specimenType" value="Serum &lt;b&gt;"/, "typed text comes back from state, escaped");
  assert.match(html, /<textarea rows="3" id="wAsk_why" data-w-ask="why">Called the registrar<\/textarea>/);
  assert.match(html, /<option value="yes" selected>Yes<\/option>/);
  assert.match(html, /role="alert">.*does not match this patient/, "the write's failure is shown in the dialog");
  assert.match(html, /data-w-act="askok"/); assert.match(html, /data-w-act="askcancel"/);
  const busy = W._render(chart({ ask: Object.assign({}, ask, { busy: true, err: "" }) }));
  assert.match(busy, /data-w-act="askok" disabled/, "a sending question cannot be sent twice");
  assert.ok(!/w-ask/.test(W._render(chart())), "no question, no dialog");
});

test("an order finding is labelled by what the server does; a hard stop has no Prescribe anyway", () => {
  const W = load();
  const order = { drug: "Paracetamol 1g", dose: { value: 1000, unit: "mg" }, frequency: "QDS" };
  const stop = W._render(chart({ moReview: { order, safety: { checked: true,
    blocks: [{ code: "DOSE_ABSOLUTE_CEILING_CUMULATIVE", disposition: "block", hardStop: true, message: "With the paracetamol already active, this order makes 8000 mg a day." }],
    overridables: [{ code: "SAME_DRUG_ACTIVE", disposition: "overridable", message: "Paracetamol is already active for this patient." }], warnings: [] } } }));
  assert.match(stop, /<b>Hard stop<\/b> <span lang="en">With the paracetamol already active/);
  assert.match(stop, /<b>Needs a reason to proceed<\/b> <span lang="en">Paracetamol is already active/);
  assert.ok(!/data-w-act="moconfirm"/.test(stop) && !/wMoOverride/.test(stop), "nothing to sign past a hard stop");
  assert.match(stop, /The server refuses this order whatever the reason/);
  assert.ok(!/DOSE_ABSOLUTE_CEILING_CUMULATIVE|SAME_DRUG_ACTIVE/.test(stop), "no rule code on screen");

  const reason = W._render(chart({ moReview: { order, safety: { checked: true,
    blocks: [{ code: "DOSE_WEIGHT_MISSING", disposition: "block", message: "Paracetamol is dosed by weight and this patient has no recorded weight." }],
    overridables: [], warnings: [{ code: "DOSE_WEIGHT_MISSING", disposition: "warn", message: "No weight is recorded for this adult." }] } } }));
  assert.ok(!/Hard stop/.test(reason), "a block the server does not refuse is not called a hard stop");
  assert.match(reason, /<b>Needs a reason to proceed<\/b>/);
  assert.match(reason, /<b>Warning<\/b> <span lang="en">No weight is recorded/);
  assert.match(reason, /data-w-act="moconfirm"/); assert.match(reason, /id="wMoOverride"/);
});

test("NEWS2 names what was not recorded in words; the flowsheet shows mmHg and °C", () => {
  const W = load();
  const n = { tool: "NEWS2", score: { scorable: false, code: "INCOMPLETE", total: 0, missing: ["respiratoryRate", "oxygenSaturation", "supplementalOxygen", "systolicBloodPressure", "pulse", "consciousness", "temperature"],
    reason: "incomplete: respiratoryRate, oxygenSaturation were not recorded, so the partial total of 0 is not a risk assessment and must not be read as one" } };
  const said = W._scoreWhyNot(n);
  assert.equal(said, "Incomplete. Not recorded: Respiratory rate, Oxygen saturation, Oxygen given or not, Systolic blood pressure, Pulse, Consciousness (ACVPU), Temperature. The partial total of 0 is not a risk assessment and must not be read as one.");
  const html = W._render(chart({ news2: n, flowsheet: { hours: ["2026-09-16T02:00:00.000Z"], rows: [
    { label: "Systolic blood pressure", cells: [{ value: 120, unit: "mm[Hg]" }] }, { label: "Body temperature", cells: [{ value: 37, unit: "Cel" }] }, { label: "Heart rate", cells: [{ value: 88, unit: "/min" }] }] } }));
  assert.ok(!/respiratoryRate|systolicBloodPressure/.test(html), "no parameter code on the chart");
  assert.match(html, /120 mmHg/); assert.match(html, /37 °C/); assert.match(html, /88 \/min/);
  assert.ok(!/mm\[Hg\]|\bCel\b/.test(html), "no UCUM spelling on the chart");
  // A reason the scorer did not list stays the server's own words.
  assert.equal(W._scoreWhyNot({ score: { scorable: false, reason: "no observations" } }), "no observations");
});

test("the fluid balance of a patient admitted minutes ago counts the hours since admission, not the last twelve", () => {
  const W = load();
  const now = Date.parse("2026-09-16T02:50:00.000Z");
  const fresh = W._balanceWindow({ admittedAt: "2026-09-16T02:48:00.000Z" }, now);
  assert.deepEqual(fresh, { from: "2026-09-16T02:48:00.000Z", to: "2026-09-16T02:50:00.000Z", sinceAdmission: true });
  const old = W._balanceWindow({ admittedAt: "2026-09-13T02:48:00.000Z" }, now);
  assert.deepEqual(old, { from: "2026-09-15T14:50:00.000Z", to: "2026-09-16T02:50:00.000Z", sinceAdmission: false });
  assert.equal(W._balanceWindow({ arrivedAt: "2026-09-16T01:00:00.000Z" }, now).from, "2026-09-16T01:00:00.000Z", "an ED arrival counts from arrival");
  assert.equal(W._balanceWindow({}, now).sinceAdmission, false, "no admission time: the shift");
  const html = W._render(chart({ balanceSinceAdmission: true, balance: { intake: 0, output: 0, balance: 0, entries: 0, complete: false, gaps: ["h"], hours: [], byKind: {} } }));
  assert.match(html, /1 of the 1 hours since admission have nothing charted/);
});

test("Record vitals says it is saving and cannot be pressed twice, then says what happened under it", () => {
  const W = load();
  W._st.vitalsSaving = true;
  assert.match(W._render(chart()), /<button class="w-btn" data-w-act="vitals" disabled aria-busy="true">.*Recording vitals\.\.\./);
  W._st.vitalsSaving = false; W._st.vitalsSaid = { ok: true, text: "Recorded 3 observations." };
  const done = W._render(chart());
  assert.match(done, /data-w-act="vitals">.*Record vitals<\/button><p class="w-hint" role="status">.*Recorded 3 observations\./);
  W._st.vitalsSaid = { ok: false, text: "Could not record vitals." };
  assert.match(W._render(chart()), /<p class="w-hint warn" role="status">.*Could not record vitals\./);
  W._st.vitalsSaid = null;
});

test("LT-29: a known ED arrival asks for the chief complaint and sends it", () => {
  const W = load();
  const html = W._render(Object.assign({}, base, { view: "ed", ed: { patients: [] }, edArrivalOpen: true, edMrnLookup: { mrn: "SMD-6TEQZM-00030", name: "Test Patient QA-04" } }));
  assert.match(html, /<input id="wEdKnownCc" type="text"/);
  assert.match(body("edArriveKnown"), /chiefComplaint: val\("wEdKnownCc"\)/);
});

/* ---- behaviour: the real ward.js in a sandbox with a stubbed network, driven through its own dispatcher ---------- */
const tick = () => new Promise((r) => setTimeout(r, 20));
function sandboxWard(answer) {
  const posts = [], natives = [];
  const sb = {
    navigator: { userAgent: "node" }, location: { hash: "", href: "" },
    document: { getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
      addEventListener() {}, removeEventListener() {}, body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} },
    fetch: (url, init) => {
      const b = init && init.body ? JSON.parse(init.body) : null;
      if (init && init.method === "POST") posts.push({ url: String(url), body: b });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(answer(String(url), b)) });
    },
    setTimeout, clearTimeout, console, Promise, Date,
    prompt: (m) => { natives.push(m); return "native"; }, confirm: (m) => { natives.push(m); return true; }, alert: (m) => { natives.push(m); },
  };
  sb.window = sb; sb.self = sb;
  vm.createContext(sb); vm.runInContext(SRC, sb);
  const W = sb.window.WARD;
  W._st.orgId = "org-test";
  W._st.sel = { class: "IPD", patientId: "p1", encounterId: "e1", ward: "General A", bed: "2", name: "Test Patient QA-03" };
  W._st.view = "chart";
  return { W, posts, natives, sent: (part) => posts.filter((p) => p.url.indexOf(part) >= 0) };
}

test("lab Collect: Cancel writes nothing, a blank specimen is refused in the dialog, a refused scan keeps what was typed, OK collects once", async () => {
  let reply = { ok: false, error: "wrong_patient_scan" };
  const { W, natives, sent } = sandboxWard((url) => (url.indexOf("/ward/collect") >= 0 ? reply : { ok: true, requests: [], pending: [] }));
  W._dispatch("collectspecimen:sr-1");
  assert.equal(W._st.ask.spec.fields.map((f) => f.key).join(), "specimenType,scanned");
  W._dispatch("askcancel");
  assert.equal(W._st.ask, null); assert.equal(sent("/ward/collect").length, 0, "Cancel writes nothing");

  W._dispatch("collectspecimen:sr-1");
  W._dispatch("askok");
  assert.equal(W._st.ask.err, "Say which specimen was taken."); assert.equal(sent("/ward/collect").length, 0, "a blank specimen sends nothing");

  W._st.ask.values.specimenType = "Serum"; W._st.ask.values.scanned = "WRONG-MRN";
  W._dispatch("askok"); await tick();
  assert.equal(sent("/ward/collect").length, 1);
  assert.match(W._st.ask.err, /does not match this patient's order\. Nothing was collected\./, "the refusal is said in the dialog");
  assert.equal(W._st.ask.values.specimenType, "Serum", "and what was typed is still there");
  assert.equal(W._st.err, "", "not in a banner behind it");

  reply = { ok: true, written: 1, accessionNumber: "ACC-1" };
  W._st.ask.values.scanned = "SMD-1";
  W._dispatch("askok"); await tick();
  assert.equal(W._st.ask, null, "a collection the server accepted closes the question");
  assert.equal(W._st.note, "Collected. Accession ACC-1.");
  assert.deepEqual(sent("/ward/collect")[1].body, { orgId: "org-test", serviceRequestId: "sr-1", specimenType: "Serum", scannedPatientBarcode: "SMD-1" });
  assert.deepEqual(natives, [], "no browser dialog was opened");
});

test("critical result acknowledge, ED bed admit, MAR hold and death recording are asked on the ward and write only from OK", async () => {
  const { W, natives, sent } = sandboxWard((url) => (url.indexOf("/ward/acknowledge") >= 0 ? { ok: true, written: 1 } : url.indexOf("/ward/ed-disposition") >= 0 ? { ok: true, disposition: "admitted" } : { ok: true, loops: [], patients: [], due: [] }));
  W._dispatch("ack:loop-1");
  W._dispatch("askok");
  assert.match(W._st.ask.err, /An acknowledgement records what was done/); assert.equal(sent("/ward/acknowledge").length, 0);
  W._st.ask.values.why = "  Repeated Hb, transfused 1 unit  ";
  W._dispatch("askok"); await tick();
  assert.deepEqual(sent("/ward/acknowledge").map((p) => p.body.action), ["Repeated Hb, transfused 1 unit"]);
  assert.equal(W._st.ask, null);

  W._st.sel = { class: "ED", patientId: "p2", encounterId: "ed-1", name: "Test Patient QA-04" };
  W._st.edAdmitPending = true;
  W._dispatch("pickbed:General Medicine A|GMA-11");
  assert.match(W._st.ask.spec.title, /Admit Test Patient QA-04 to General Medicine A, bed GMA-11\?/);
  W._dispatch("askcancel");
  assert.equal(sent("/ward/ed-disposition").length, 0); assert.equal(W._st.edAdmitPending, true, "still choosing a bed");
  W._dispatch("pickbed:General Medicine A|GMA-11"); W._dispatch("askok"); await tick();
  assert.deepEqual(sent("/ward/ed-disposition")[0].body.admission, { ward: "General Medicine A", bed: "GMA-11" });
  assert.equal(W._st.edAdmitPending, false);

  W._st.sel = { class: "IPD", patientId: "p1", encounterId: "e1", name: "Test Patient QA-03" };
  W._st.due = [{ orderId: "rx-1", dueAt: "2026-09-16T08:00:00.000Z", drug: "Paracetamol", orderVersion: 2 }];
  W._dispatch("mar:hold|0");
  assert.ok(W._st.ask && sent("/ward/mar").length === 0, "hold asks for its reason first");
  W._dispatch("askcancel");

  W._dispatch("deathrecord");
  assert.match(W._st.ask.spec.title, /Record that Test Patient QA-03 has died\?/);
  W._dispatch("askcancel");
  assert.equal(sent("/ward/deceased").length, 0, "Cancel records no death");
  assert.deepEqual(natives, [], "no browser dialog was opened");
});

test("LT-29: a paint is held while a pointer is down, so a press and its release land on the same button", () => {
  assert.match(body("paint"), /if \(selectIsOpen\(\) \|\| pressHeld\(\)\) \{ _paintHeld = true; return; \}/);
  assert.match(body("flushHeldPaint"), /!pressHeld\(\)/);
  assert.match(code, /addEventListener\("pointerdown", onPressStart, true\)/);
});

test("LT-07: the discharge summary says mmHg and °C; the record keeps UCUM", async () => {
  const { displayUnit, VITAL_CODES } = await import("../functions/_wardsynq/migrate-vitals.js");
  const { assembleDischargeSummary } = await import("../functions/_wardsynq/migrate-discharge.js");
  assert.equal(displayUnit("mm[Hg]"), "mmHg"); assert.equal(displayUnit("Cel"), "°C"); assert.equal(displayUnit("[degF]"), "°F");
  assert.equal(displayUnit("/min"), "/min"); assert.equal(displayUnit("mmol/L"), "mmol/L"); assert.equal(displayUnit(null), "");
  assert.equal(VITAL_CODES.sbp.unit, "mm[Hg]", "what is stored is unchanged");
  const at = "2026-09-16T02:51:00.000Z";
  const obs = [{ code: "8480-6", value: 120, unit: "mm[Hg]" }, { code: "8310-5", value: 37, unit: "Cel" }].map((o) => ({ ...o, meta: { effectiveAt: at } }));
  const s = assembleDischargeSummary({ encounter: { periodStart: "2026-09-16T02:48:00.000Z", location: { ward: "GAS", bed: "04" } }, observations: obs });
  assert.match(s.vitals, /Systolic blood pressure 120 mmHg/); assert.match(s.vitals, /Body temperature 37 °C/);
  assert.ok(!/mm\[Hg\]|\bCel\b/.test(s.vitals), s.vitals);
});
