/* wardsynq/ui/wardsynq-app.js — WardSynQ clinical workstation, application wiring.
 *
 * This file contains NO clinical logic. Every verdict on screen comes from the real
 * SafetyEngine running the real rule pack; the UI's only job is to render what the engine said
 * and to collect the override handshake. If you find yourself about to write a severity
 * comparison or a drug rule here, it belongs in wardsynq-safety.js instead.
 *
 * The distinction the interface exists to make visible:
 *   BLOCK        Category 1. Renders with NO control that proceeds. There is deliberately no
 *                button to hunt for, because there is no override path in the engine either.
 *   OVERRIDABLE  Category 2. Renders the handshake form: structured reason, free-text rationale,
 *                and the clinician's identity. Submit stays disabled until all three exist.
 *   WARN         Informational. Gates nothing.
 *
 * Buildless native ES modules, loaded straight from the same source the tests import, so the
 * screen cannot drift from the tested behaviour.
 */

import { SafetyEngine, DISPOSITION } from "../wardsynq-safety.js";
import { buildRulePack } from "../adapters/wardsynq-rules-stewardmd.js";
import { ClinicalEventBus } from "../wardsynq-events.js";
import { ClinicalStore, MemoryBackend } from "../wardsynq-store.js";
import { Patient, MedicationOrder, AllergyIntolerance, Observation } from "../wardsynq-model.js";

const $ = (id) => document.getElementById(id);

const state = {
  engine: null,
  packVersion: null,
  patients: [],
  current: null,
  bus: new ClinicalEventBus({ nodeId: "workstation" }),
  store: new ClinicalStore({ backend: new MemoryBackend() }),
  lastVerdict: null,
  overrides: [],
  // In-progress override text, keyed by finding code. The verdict panel re-renders on every
  // keystroke in the order form, which would otherwise destroy a half-typed rationale. A clinician
  // who loses a careful justification once starts writing "as discussed" instead, and the audit
  // trail quietly stops being worth reading. Found by driving the workstation.
  overrideDrafts: {},
};

/* ------------------------------------------------------------------ demo cohort
 *
 * Illustrative patients so the workstation has something to show. Names are ordinary Indian names
 * rather than placeholder stand-ins, and the values are clinically coherent rather than round.
 * Marked plainly as demonstration data: fabricated records that look real are their own hazard.
 */
function demoCohort() {
  const anjali = Patient({
    mrn: "GH-40118", name: "Anjali Menon", dob: "1959-02-14", sex: "female",
    wristbandBarcode: "GH-40118",
  });
  anjali.ageYears = 67;
  anjali.weightKg = 62;
  anjali.egfr = 47;
  anjali.bed = "MICU 04";
  anjali.allergies = [
    AllergyIntolerance({
      patientId: anjali.id, substance: "Penicillins", reaction: "anaphylaxis",
      severity: "severe", criticality: "high", verifiedBy: "dr-menon-allergy",
    }),
  ];
  anjali.activeMeds = [{ drug: "Clarithromycin 500mg" }, { drug: "Warfarin 3mg" }];
  anjali.labs = [
    { test: "Potassium", value: 5.4, unit: "mmol/L", low: 3.5, high: 5.1 },
    { test: "Creatinine", value: 1.42, unit: "mg/dL", low: 0.6, high: 1.1 },
    { test: "Haemoglobin", value: 10.8, unit: "g/dL", low: 12.0, high: 15.0 },
  ];

  const ravi = Patient({
    mrn: "GH-40233", name: "Ravi Deshpande", dob: "1988-11-02", sex: "male",
    wristbandBarcode: "GH-40233",
  });
  ravi.ageYears = 37;
  ravi.weightKg = 78;
  ravi.egfr = 96;
  ravi.bed = "Ward 3A 12";
  ravi.allergies = [];
  ravi.activeMeds = [];
  ravi.labs = [
    { test: "Potassium", value: 4.1, unit: "mmol/L", low: 3.5, high: 5.1 },
    { test: "Haemoglobin", value: 14.6, unit: "g/dL", low: 13.0, high: 17.0 },
  ];

  const meera = Patient({
    mrn: "GH-40297", name: "Meera Iyer", dob: "2019-06-30", sex: "female",
    wristbandBarcode: "GH-40297",
  });
  meera.ageYears = 7;
  meera.weightKg = null; // deliberately unweighed: the mg/kg refusal is a real behaviour to show
  meera.egfr = null;
  meera.bed = "Paeds 02";
  meera.allergies = [];
  meera.activeMeds = [];
  meera.labs = [];

  return [anjali, ravi, meera];
}

/* ------------------------------------------------------------------ boot */

async function boot() {
  const provenance = $("provenance");
  try {
    const [rulesRes, seedRes] = await Promise.all([
      fetch(new URL("../../data/interaction-rules.json", import.meta.url)),
      fetch(new URL("../data/allergy-classes.seed.json", import.meta.url)),
    ]);
    if (!rulesRes.ok) throw new Error(`interaction rules failed to load (${rulesRes.status})`);
    if (!seedRes.ok) throw new Error(`allergy seed failed to load (${seedRes.status})`);

    const raw = await rulesRes.json();
    const seed = await seedRes.json();
    const pack = buildRulePack(raw, seed);

    state.engine = new SafetyEngine({ rulePack: pack });
    state.packVersion = pack.version;

    // The pack says of itself whether it is approved. The banner reports that rather than the UI
    // deciding it looks trustworthy.
    provenance.innerHTML = `Rule pack <span class="pack">${escapeHtml(pack.version)}</span>. `
      + `${pack.interactions.length} interaction rules, ${pack.drugClasses.size} classified drugs. `
      + `${seed.status ? "Allergy and dose content is UNAPPROVED SEED DATA and must not gate a real order." : ""}`;

    populateDrugSuggestions(pack);
    state.patients = demoCohort();
    await state.store.open();
    for (const p of state.patients) await state.store.put(p);
    renderPatientList();
    selectPatient(state.patients[0]);
  } catch (err) {
    provenance.classList.add("error-inline");
    provenance.textContent = `Clinical rule pack failed to load: ${err.message}. `
      + "Safety checking is unavailable, so ordering is disabled.";
    $("patientList").innerHTML = '<div class="error-inline">Could not start the workstation.</div>';
    $("drugInput").disabled = true;
  }
}

function populateDrugSuggestions(pack) {
  // A short list of orderable products drawn from the pack itself, so every suggestion is a drug
  // the engine can actually reason about rather than a name it will report as unresolved.
  const wanted = ["simvastatin", "atorvastatin", "warfarin", "ibuprofen", "paracetamol",
    "clarithromycin", "digoxin", "gentamicin", "methotrexate", "colchicine", "furosemide",
    "metformin", "omeprazole", "amlodipine"];
  const list = $("drugSuggestions");
  const seen = new Set();
  for (const w of wanted) {
    const key = pack.genericIndex.has(w) ? w : pack.aliases.get(w);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const opt = document.createElement("option");
    opt.value = titleCase(key);
    list.appendChild(opt);
  }
  // Amoxicillin is included on purpose: on the penicillin-allergic patient it demonstrates the
  // hard-stop, which is the behaviour most worth being able to see.
  const amox = pack.aliases.get("amoxicillin") || (pack.genericIndex.has("amoxicillin") ? "amoxicillin" : null);
  if (amox) {
    const opt = document.createElement("option");
    opt.value = "Amoxicillin";
    list.appendChild(opt);
  }
}

/* ------------------------------------------------------------------ patient */

function renderPatientList() {
  const host = $("patientList");
  host.innerHTML = "";
  if (!state.patients.length) {
    host.innerHTML = '<div class="empty">No patients on this worklist.</div>';
    return;
  }
  for (const p of state.patients) {
    const btn = document.createElement("button");
    btn.className = "patient-row";
    btn.type = "button";
    btn.setAttribute("aria-current", state.current && state.current.id === p.id ? "true" : "false");
    btn.innerHTML = `<span class="row-name">${escapeHtml(p.name)}</span>`
      + `<span class="row-meta">${escapeHtml(p.mrn)} &middot; ${escapeHtml(p.bed || "")}</span>`;
    btn.addEventListener("click", () => selectPatient(p));
    host.appendChild(btn);
  }
}

function selectPatient(patient) {
  state.current = patient;
  state.overrides = [];
  state.overrideDrafts = {};
  renderPatientList();
  renderBanner();
  renderActiveMeds();
  renderLabs();
  runSafetyCheck();
}

function renderBanner() {
  const p = state.current;
  $("pName").textContent = p.name;
  // Age is shown, and where it came from an age rather than a birth date the banner does not
  // pretend to a precision it does not have.
  const age = p.ageYears != null ? `${p.ageYears}y` : "age unknown";
  const sex = p.sex === "unknown" ? "sex unknown" : p.sex;
  const weight = p.weightKg != null ? `${p.weightKg} kg` : "weight NOT RECORDED";
  $("pMeta").textContent = `${p.mrn} | ${age} ${sex} | ${weight}`;
  $("pEncounter").textContent = p.bed ? `Bed ${p.bed}` : "";

  const el = $("pAllergies");
  const severe = (p.allergies || []).filter((a) => a.criticality === "high" || a.severity === "severe");
  if (!p.allergies || !p.allergies.length) {
    el.className = "banner-allergy none";
    el.textContent = "No known allergies recorded";
  } else {
    el.className = "banner-allergy";
    const names = p.allergies.map((a) => a.substance).join(", ");
    // The word "ALLERGY" carries the meaning, not the red. A colour-blind clinician reads the
    // same warning.
    el.textContent = `ALLERGY: ${names}${severe.length ? " (severe, verified)" : ""}`;
  }
}

function renderActiveMeds() {
  const p = state.current;
  const host = $("activeMeds");
  if (!p.activeMeds || !p.activeMeds.length) {
    host.innerHTML = '<div class="empty">No active medications recorded for this patient.</div>';
    return;
  }
  host.innerHTML = `<table class="data"><thead><tr><th>Medication</th></tr></thead><tbody>`
    + p.activeMeds.map((m) => `<tr><td>${escapeHtml(m.drug)}</td></tr>`).join("")
    + `</tbody></table>`;
}

function renderLabs() {
  const p = state.current;
  const host = $("labs");
  if (!p.labs || !p.labs.length) {
    host.innerHTML = '<div class="empty">No results available for this patient.</div>';
    return;
  }
  host.innerHTML = `<table class="data"><thead><tr>`
    + `<th>Test</th><th>Value</th><th>Reference</th><th>Flag</th></tr></thead><tbody>`
    + p.labs.map((l) => {
      const high = l.high != null && l.value > l.high;
      const low = l.low != null && l.value < l.low;
      const cls = high ? "high" : low ? "low" : "normal";
      // The flag is a word as well as a colour, for the same reason as the allergy banner.
      const label = high ? "HIGH" : low ? "LOW" : "NORMAL";
      return `<tr><td>${escapeHtml(l.test)}</td>`
        + `<td class="num">${escapeHtml(String(l.value))} ${escapeHtml(l.unit || "")}</td>`
        + `<td class="num">${l.low != null ? escapeHtml(String(l.low)) : ""}-${l.high != null ? escapeHtml(String(l.high)) : ""}</td>`
        + `<td><span class="flag ${cls}">${label}</span></td></tr>`;
    }).join("")
    + `</tbody></table>`;
}

/* ------------------------------------------------------------------ safety */

function currentOrder() {
  const drug = $("drugInput").value.trim();
  if (!drug) return null;
  const doseValue = Number.parseFloat($("doseInput").value);
  return MedicationOrder({
    patientId: state.current.id,
    drug,
    dose: Number.isFinite(doseValue) ? { value: doseValue, unit: $("doseUnit").value } : null,
    route: $("routeInput").value,
    prescriberId: "dr-on-duty",
  });
}

function runSafetyCheck() {
  const host = $("verdict");
  const signBtn = $("signOrder");
  $("orderResult").innerHTML = "";

  if (!state.engine || !state.current) return;
  const order = currentOrder();
  if (!order) {
    host.innerHTML = '<div class="empty">Enter a medication to run the safety check.</div>';
    signBtn.disabled = true;
    state.lastVerdict = null;
    return;
  }

  const p = state.current;
  const verdict = state.engine.evaluate({
    order,
    patient: p,
    weightKg: p.weightKg,
    egfr: p.egfr,
    allergies: p.allergies || [],
    activeMeds: p.activeMeds || [],
    overrides: state.overrides,
  });
  state.lastVerdict = verdict;

  $("checkTiming").textContent = `checked in ${verdict.elapsedMs.toFixed(1)} ms`;
  renderVerdict(verdict);
  // Signing is permitted only when the engine says so. The button is not the control; the engine
  // is. This line just reflects it.
  signBtn.disabled = !verdict.allowed;
}

function renderVerdict(verdict) {
  const host = $("verdict");
  host.innerHTML = "";

  if (verdict.unresolvedDrug) {
    host.appendChild(findingEl({
      disposition: DISPOSITION.WARN,
      label: "Not checked",
      code: "UNRESOLVED_DRUG",
      message: "This product is not in the loaded rule pack, so no interaction, allergy or dose "
        + "check has run against it. Absence of a warning here does not mean it is safe.",
    }));
  }

  for (const f of verdict.blocks) host.appendChild(findingEl({ ...f, label: "Hard stop" }));
  for (const f of verdict.overridables) host.appendChild(findingEl({ ...f, label: "Override required" }));
  for (const f of verdict.warnings) host.appendChild(findingEl({ ...f, label: f.overridden ? "Overridden" : "Advisory" }));

  if (!host.children.length) {
    const ok = document.createElement("div");
    ok.className = "verdict-ok";
    ok.textContent = "No blocking findings against the loaded rule pack.";
    host.appendChild(ok);
  }
}

function findingEl(f) {
  const wrap = document.createElement("div");
  const kind = f.disposition === DISPOSITION.BLOCK ? "block"
    : f.disposition === DISPOSITION.OVERRIDABLE ? "overridable" : "warn";
  wrap.className = `finding ${kind}`;

  const head = document.createElement("div");
  head.className = "finding-head";
  head.innerHTML = `<span class="label">${escapeHtml(f.label)}</span>`
    + `<span class="code">${escapeHtml(f.code || "")}</span>`;
  wrap.appendChild(head);

  const msg = document.createElement("p");
  msg.textContent = f.message || "";
  wrap.appendChild(msg);

  if (f.mechanism) {
    const mech = document.createElement("p");
    mech.className = "mechanism";
    mech.textContent = f.mechanism;
    wrap.appendChild(mech);
  }

  if (f.disposition === DISPOSITION.BLOCK) {
    // No control is rendered. The note explains the absence, so the clinician is not left hunting
    // for a button that does not exist.
    const note = document.createElement("p");
    note.className = "no-override-note";
    note.textContent = "This cannot be overridden. Change the order, or contact the on-call "
      + "pharmacist to review the underlying record.";
    wrap.appendChild(note);
  }

  if (f.disposition === DISPOSITION.OVERRIDABLE) wrap.appendChild(handshakeEl(f));
  return wrap;
}

/**
 * The Category 2 handshake. Reason code, free-text rationale and clinician identity are each
 * required by the engine; the form mirrors that rather than enforcing its own rules, and submit
 * stays disabled until the engine would accept the payload.
 */
function handshakeEl(f) {
  const box = document.createElement("div");
  box.className = "handshake";
  box.innerHTML = `
    <h3>Document an override</h3>
    <div class="field">
      <label for="reason-${cssId(f.code)}">Reason</label>
      <select id="reason-${cssId(f.code)}">
        <option value="">Select a reason</option>
        <option value="BENEFIT_OUTWEIGHS_RISK">Benefit outweighs risk</option>
        <option value="MONITORING_IN_PLACE">Monitoring protocol in place</option>
        <option value="SPECIALIST_ADVICE">Specialist advice obtained</option>
        <option value="NO_ALTERNATIVE">No suitable alternative available</option>
      </select>
    </div>
    <div class="field">
      <label for="rationale-${cssId(f.code)}">Clinical rationale</label>
      <textarea id="rationale-${cssId(f.code)}" placeholder=""></textarea>
      <span class="hint">Recorded in the audit trail and reviewed by the safety committee.</span>
    </div>
    <button type="button" class="btn-primary" id="apply-${cssId(f.code)}" disabled>Apply override</button>
    <div class="who">Signing as Dr on duty. Your identity is recorded with this override.</div>
  `;

  const reason = box.querySelector(`#reason-${cssId(f.code)}`);
  const rationale = box.querySelector(`#rationale-${cssId(f.code)}`);
  const apply = box.querySelector(`#apply-${cssId(f.code)}`);

  // Restore anything already typed for this finding, so a re-render does not discard it.
  const draft = state.overrideDrafts[f.code] || {};
  if (draft.reasonCode) reason.value = draft.reasonCode;
  if (draft.rationale) rationale.value = draft.rationale;

  const sync = () => {
    state.overrideDrafts[f.code] = { reasonCode: reason.value, rationale: rationale.value };
    apply.disabled = !(reason.value && rationale.value.trim().length >= 10);
  };
  reason.addEventListener("change", sync);
  rationale.addEventListener("input", sync);
  sync(); // reflect a restored draft in the button state immediately

  apply.addEventListener("click", () => {
    state.overrides.push({
      code: f.code,
      targetId: f.ruleId || f.allergyId || null,
      reasonCode: reason.value,
      rationale: rationale.value.trim(),
      actorId: "dr-on-duty",
      at: new Date().toISOString(),
    });
    state.bus.emit("safety.override.recorded", {
      code: f.code, reasonCode: reason.value, actorId: "dr-on-duty",
    });
    delete state.overrideDrafts[f.code]; // committed, so it is no longer a draft
    runSafetyCheck();
  });

  return box;
}

/* ------------------------------------------------------------------ signing */

async function signOrder() {
  const verdict = state.lastVerdict;
  const result = $("orderResult");
  if (!verdict || !verdict.allowed) {
    // Belt and braces: the button is already disabled, but a signed order is the point at which
    // being wrong matters most, so the check is repeated rather than trusted.
    result.innerHTML = '<div class="error-inline">This order cannot be signed while a blocking '
      + "finding stands.</div>";
    return;
  }
  const order = currentOrder();
  order.status = "active";
  order.signedBy = "dr-on-duty";
  await state.store.put(order);
  await state.bus.emit("order.signed", { order, overrides: state.overrides });

  state.current.activeMeds = (state.current.activeMeds || []).concat([{ drug: order.drug }]);
  renderActiveMeds();

  const overrideNote = state.overrides.length
    ? ` ${state.overrides.length} override(s) recorded in the audit trail.`
    : "";
  result.innerHTML = `<div class="verdict-ok">Order signed and recorded.${escapeHtml(overrideNote)}</div>`;
  clearOrder();
}

function clearOrder() {
  $("drugInput").value = "";
  $("doseInput").value = "";
  state.overrides = [];
  state.overrideDrafts = {};
  state.lastVerdict = null;
  $("checkTiming").textContent = "";
  runSafetyCheck();
}

/* ------------------------------------------------------------------ helpers */

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function cssId(s) { return String(s || "x").replace(/[^A-Za-z0-9_-]/g, "-"); }
function titleCase(s) { return String(s).replace(/\b[a-z]/g, (c) => c.toUpperCase()); }

/* ------------------------------------------------------------------ events */

let debounce;
for (const id of ["drugInput", "doseInput", "doseUnit", "routeInput"]) {
  const el = $(id);
  const handler = () => {
    clearTimeout(debounce);
    // Short debounce so typing stays responsive; the check itself is well inside its budget.
    debounce = setTimeout(runSafetyCheck, 120);
  };
  el.addEventListener("input", handler);
  el.addEventListener("change", handler);
}
$("signOrder").addEventListener("click", signOrder);
$("clearOrder").addEventListener("click", clearOrder);

boot();
