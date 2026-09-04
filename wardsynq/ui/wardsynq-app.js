/* wardsynq/ui/wardsynq-app.js — StewardMD / WardSynQ clinical workstation, application wiring.
 *
 * NO clinical logic lives here. Every verdict on screen comes from the real SafetyEngine running the
 * real rule pack; this file renders what the engine said and collects the override handshake. A
 * severity comparison or a drug rule written here is in the wrong file.
 *
 * Components (render functions, buildless):
 *   PatientHeader, PatientSidebar, MedicationOrder (static markup + keyboard), SafetyEngine,
 *   SafetySeverityBadge, InteractionCard, OverridePanel, ClinicalContext / LabValue, AuditTrail.
 *
 * The distinction the whole interface exists to make visible:
 *   CRITICAL  (engine BLOCK)        no control that proceeds is rendered, because none exists.
 *   MAJOR     (engine OVERRIDABLE)  the override step: reason, rationale, signature, audit.
 *   MODERATE / MONITOR / INFO       advisory. Gates nothing. Rendered quietly on purpose.
 */

import { SafetyEngine, DISPOSITION } from "../wardsynq-safety.js";
import { buildRulePack } from "../adapters/wardsynq-rules-stewardmd.js";
import { ClinicalEventBus } from "../wardsynq-events.js";
import { ClinicalStore, MemoryBackend } from "../wardsynq-store.js";
import { Patient, MedicationOrder, AllergyIntolerance } from "../wardsynq-model.js";

const $ = (id) => document.getElementById(id);
const ACTOR = "dr-on-duty";

const state = {
  engine: null,
  pack: null,
  patients: [],
  current: null,
  bus: new ClinicalEventBus({ nodeId: "workstation" }),
  store: new ClinicalStore({ backend: new MemoryBackend() }),
  lastVerdict: null,
  overrides: [],
  // In-progress override input, keyed by finding code, so a re-render never destroys a half-typed
  // rationale. A clinician who loses one careful justification starts writing "as discussed".
  overrideDrafts: {},
  audit: [],
};

/* ------------------------------------------------------------------ demo cohort
 * Illustrative patients. Marked as demonstration data: fabricated records that look real are their
 * own hazard. Values are clinically coherent rather than round. */
function demoCohort() {
  const anjali = Patient({ mrn: "GH-40118", name: "Anjali Menon", dob: "1959-02-14", sex: "female", wristbandBarcode: "GH-40118" });
  Object.assign(anjali, {
    ageYears: 67, weightKg: 62, egfr: 47, bed: "MICU 04", unit: "Medical ICU", status: "ICU, day 3",
    allergies: [AllergyIntolerance({ patientId: anjali.id, substance: "Penicillins", reaction: "anaphylaxis", severity: "severe", criticality: "high", verifiedBy: "dr-menon-allergy" })],
    activeMeds: [{ drug: "Clarithromycin 500mg", sig: "PO 12-hourly", since: "day 1" }, { drug: "Warfarin 3mg", sig: "PO nightly", since: "home" }],
    labs: [
      { test: "Haemoglobin", short: "Hb", value: 10.8, unit: "g/dL", low: 12.0, high: 15.0 },
      { test: "Creatinine", short: "Creatinine", value: 1.42, unit: "mg/dL", low: 0.6, high: 1.1 },
      { test: "Potassium", short: "K", value: 5.4, unit: "mmol/L", low: 3.5, high: 5.1 },
      { test: "INR", short: "INR", value: 2.4, unit: "", low: 2.0, high: 3.0 },
    ],
    resultedAt: "07:40 today",
  });

  const ravi = Patient({ mrn: "GH-40233", name: "Ravi Deshpande", dob: "1988-11-02", sex: "male", wristbandBarcode: "GH-40233" });
  Object.assign(ravi, {
    ageYears: 37, weightKg: 78, egfr: 96, bed: "3A 12", unit: "Ward 3A", status: "Stable",
    allergies: [], activeMeds: [],
    labs: [
      { test: "Potassium", short: "K", value: 4.1, unit: "mmol/L", low: 3.5, high: 5.1 },
      { test: "Haemoglobin", short: "Hb", value: 14.6, unit: "g/dL", low: 13.0, high: 17.0 },
    ],
    resultedAt: "yesterday 18:10",
  });

  const meera = Patient({ mrn: "GH-40297", name: "Meera Iyer", dob: "2019-06-30", sex: "female", wristbandBarcode: "GH-40297" });
  Object.assign(meera, {
    ageYears: 7, weightKg: null, egfr: null, bed: "Paeds 02", unit: "Paediatrics", status: "Admitted 02:10",
    allergies: [], activeMeds: [], labs: [], resultedAt: null,
  });

  return [anjali, ravi, meera];
}

/* ------------------------------------------------------------------ boot */

async function boot() {
  const prov = $("provenance");
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
    state.pack = pack;
    state.engine = new SafetyEngine({ rulePack: pack });

    prov.innerHTML = `<span>Rule pack <span class="pack">${esc(pack.version)}</span></span>`
      + `<span>${pack.interactions.length} rules, ${pack.drugClasses.size} classified drugs</span>`
      + (seed.status ? `<span><strong>Allergy and dose content is unapproved seed data</strong> and must not gate a real order.</span>` : "");

    populateDrugSuggestions(pack);
    state.patients = demoCohort();
    await state.store.open();
    for (const p of state.patients) await state.store.put(p);
    renderPatientSidebar();
    selectPatient(state.patients[0]);
  } catch (err) {
    prov.classList.add("is-error");
    prov.textContent = `Clinical rule pack failed to load: ${err.message}. Safety checking is unavailable, so ordering is disabled.`;
    $("patientList").innerHTML = '<div class="error-inline">Could not start the workstation.</div>';
    $("drugInput").disabled = true;
  }
}

function populateDrugSuggestions(pack) {
  const wanted = ["simvastatin", "atorvastatin", "warfarin", "ibuprofen", "paracetamol", "clarithromycin",
    "digoxin", "gentamicin", "methotrexate", "colchicine", "furosemide", "metformin", "omeprazole", "amlodipine", "apixaban"];
  const list = $("drugSuggestions");
  const seen = new Set();
  for (const w of wanted) {
    const key = pack.genericIndex.has(w) ? w : pack.aliases.get(w);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    list.appendChild(Object.assign(document.createElement("option"), { value: titleCase(key) }));
  }
  // Included on purpose: on the penicillin-allergic patient it demonstrates the hard stop.
  if (pack.aliases.get("amoxicillin") || pack.genericIndex.has("amoxicillin")) {
    list.appendChild(Object.assign(document.createElement("option"), { value: "Amoxicillin" }));
  }
}

/* ------------------------------------------------------------------ PatientHeader */

function renderPatientHeader() {
  const p = state.current;
  const host = $("patientHeader");
  if (!p) { host.innerHTML = '<div class="seg who"><span class="name">No patient selected</span></div>'; return; }

  const age = p.ageYears != null ? `${p.ageYears} y` : "age unknown";
  const sex = p.sex === "male" ? "M" : p.sex === "female" ? "F" : "sex unknown";
  const weight = p.weightKg != null ? `${p.weightKg} kg` : "weight not recorded";
  const severe = (p.allergies || []).filter((a) => a.criticality === "high" || a.severity === "severe");

  const allergy = !p.allergies || !p.allergies.length
    ? `<div class="seg allergy none"><span class="k">Allergies</span><span class="v">None recorded</span></div>`
    : `<div class="seg allergy"><span class="k">Allergy</span><span class="v">${esc(p.allergies.map((a) => a.substance).join(", "))}</span>`
      + `<span class="m">${esc(p.allergies[0].reaction || "")}${severe.length ? ", verified" : ""}</span></div>`;

  host.innerHTML = `
    <div class="seg who">
      <span class="name">${esc(p.name)}</span>
      <span class="demo">${esc(age)} ${esc(sex)} <span style="opacity:.55">|</span> ${esc(weight)}</span>
    </div>
    <div class="seg kv"><span class="k">MRN</span><span class="v">${esc(p.mrn)}</span></div>
    <div class="seg kv"><span class="k">${esc(p.unit || "Location")}</span><span class="v">${esc(p.bed || "")}<span style="color:var(--ink-3)"> ${esc(p.status ? "  " + p.status : "")}</span></span></div>
    ${allergy}
    <div class="seg fill"></div>
    <div class="seg actions">
      <button class="btn" type="button" data-act="order">New order <span class="kbd">N</span></button>
      <button class="btn" type="button" data-act="copy">Copy MRN</button>
    </div>`;

  host.querySelector('[data-act="order"]').addEventListener("click", () => $("drugInput").focus());
  host.querySelector('[data-act="copy"]').addEventListener("click", async (e) => {
    try { await navigator.clipboard.writeText(p.mrn); e.currentTarget.textContent = "Copied"; setTimeout(() => (e.currentTarget.textContent = "Copy MRN"), 1200); } catch {}
  });
}

/* ------------------------------------------------------------------ PatientSidebar */

function renderPatientSidebar() {
  const host = $("patientList");
  host.innerHTML = "";
  if (!state.patients.length) { host.innerHTML = '<div class="empty">No patients on this worklist.</div>'; return; }
  for (const p of state.patients) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "row";
    b.setAttribute("aria-current", state.current && state.current.id === p.id ? "true" : "false");
    const hasSevere = (p.allergies || []).some((a) => a.criticality === "high" || a.severity === "severe");
    b.innerHTML = `<span class="n">${esc(p.name)}</span>${hasSevere ? '<span class="flag">ALLERGY</span>' : "<span></span>"}`
      + `<span class="m">${esc(p.mrn)}  ${esc(p.bed || "")}</span>`;
    b.addEventListener("click", () => selectPatient(p));
    host.appendChild(b);
  }
}

function selectPatient(p) {
  state.current = p;
  state.overrides = [];
  state.overrideDrafts = {};
  renderPatientSidebar();
  renderPatientHeader();
  renderClinicalContext();
  renderActiveMeds();
  runSafetyCheck();
}

/* ------------------------------------------------------------------ ClinicalContext / LabValue
 * Data points beside the decision they inform, not a table three scrolls away. Each is a figure,
 * a name, and a WORD for the flag. */

function renderClinicalContext() {
  const p = state.current;
  const host = $("datums");
  $("labsStatus").textContent = p.resultedAt || "";
  if (!p.labs || !p.labs.length) { host.innerHTML = '<div class="empty">No results available.</div>'; renderDosingContext(); return; }
  host.innerHTML = `<div class="datums">${p.labs.map(labValue).join("")}</div>`;
  renderDosingContext();
}

function labValue(l) {
  const high = l.high != null && l.value > l.high;
  const low = l.low != null && l.value < l.low;
  const flag = high ? "high" : low ? "low" : "normal";
  const word = high ? "HIGH" : low ? "LOW" : "in range";
  const ref = l.low != null || l.high != null ? `${l.low ?? ""}-${l.high ?? ""}` : "";
  return `<div class="datum" data-flag="${flag}">
    <span class="val">${esc(String(l.value))}<small>${esc(l.unit || "")}</small></span>
    <span class="name">${esc(l.short || l.test)}</span>
    <span class="flag">${word}</span>
    ${ref ? `<span class="ref">${esc(ref)}</span>` : ""}
  </div>`;
}

function renderDosingContext() {
  const p = state.current;
  const band = p.egfr == null ? "not available" : p.egfr >= 90 ? "normal" : p.egfr >= 60 ? "mild impairment" : p.egfr >= 30 ? "moderate impairment" : p.egfr >= 15 ? "severe impairment" : "kidney failure";
  $("dosingContext").innerHTML = `
    <span class="k">Weight</span><span class="v">${p.weightKg != null ? esc(p.weightKg + " kg") : "<strong>not recorded</strong>"}</span>
    <span class="k">eGFR</span><span class="v">${p.egfr != null ? esc(p.egfr + " mL/min") : "not available"}</span>
    <span class="k">Renal band</span><span class="v">${esc(band)}</span>
    <span class="k">Age</span><span class="v">${p.ageYears != null ? esc(p.ageYears + " years") : "unknown"}</span>`;
}

function renderActiveMeds() {
  const p = state.current;
  const host = $("activeMeds");
  if (!p.activeMeds || !p.activeMeds.length) { host.innerHTML = '<div class="empty">No active medications recorded.</div>'; return; }
  host.innerHTML = p.activeMeds.map((m) => `<div class="row"><span class="d">${esc(m.drug)}${m.sig ? ` <span style="color:var(--ink-2);font-weight:400">${esc(m.sig)}</span>` : ""}</span><span class="src">${esc(m.since || "")}</span></div>`).join("");
}

/* ------------------------------------------------------------------ SafetyEngine */

function currentOrder() {
  const drug = $("drugInput").value.trim();
  if (!drug) return null;
  const doseValue = Number.parseFloat($("doseInput").value);
  return MedicationOrder({
    patientId: state.current.id,
    drug,
    dose: Number.isFinite(doseValue) ? { value: doseValue, unit: $("doseUnit").value } : null,
    route: $("routeInput").value,
    prescriberId: ACTOR,
  });
}

function setEngine(stateName, text) {
  const el = $("engineStatus");
  el.dataset.state = stateName;
  el.querySelector(".txt").textContent = text;
}

/** Engine disposition + severity to the interface's five-step scale. */
function severityOf(f) {
  if (f.disposition === DISPOSITION.BLOCK) return "critical";
  if (f.disposition === DISPOSITION.OVERRIDABLE) return "major";
  if (f.severity === "moderate") return "moderate";
  if (f.severity === "monitor") return "monitor";
  return "info";
}

function runSafetyCheck() {
  const host = $("findings");
  const signBtn = $("signOrder");
  $("orderResult").innerHTML = "";
  if (!state.engine || !state.current) return;

  const order = currentOrder();
  $("orderStatus").textContent = order && order.dose ? `${order.dose.value} ${order.dose.unit} ${order.route}` : "";
  if (!order) {
    host.innerHTML = '<div class="empty">Enter a medication to run the safety check.</div>';
    signBtn.disabled = true;
    $("signStatus").textContent = "";
    state.lastVerdict = null;
    setEngine("idle", "Ready");
    return;
  }

  setEngine("checking", "Checking");
  const p = state.current;
  const verdict = state.engine.evaluate({
    order, patient: p, weightKg: p.weightKg, egfr: p.egfr,
    allergies: p.allergies || [], activeMeds: p.activeMeds || [], overrides: state.overrides,
  });
  state.lastVerdict = verdict;

  const n = state.pack.interactions.length;
  const stateName = verdict.blocks.length ? "blocked" : verdict.overridables.length ? "attention" : "ok";
  setEngine(stateName, `${n} rules in ${verdict.elapsedMs.toFixed(1)} ms`);

  renderSafetyEngine(verdict);
  signBtn.disabled = !verdict.allowed;
  $("signStatus").textContent = verdict.allowed ? "" : verdict.blocks.length ? "blocked by a hard stop" : "override required before signing";
}

function renderSafetyEngine(verdict) {
  const host = $("findings");
  host.innerHTML = "";

  if (verdict.unresolvedDrug) {
    host.appendChild(interactionCard({
      sev: "info", word: "Not checked", code: "UNRESOLVED_DRUG",
      risk: "This product is not in the loaded rule pack, so no interaction, allergy or dose check has run. Absence of a warning here does not mean it is safe.",
    }));
  }
  for (const f of verdict.blocks) host.appendChild(interactionCard(fromFinding(f, "Critical")));
  for (const f of verdict.overridables) host.appendChild(interactionCard(fromFinding(f, "Major")));
  for (const f of verdict.warnings) host.appendChild(interactionCard(fromFinding(f, f.overridden ? "Overridden" : severityWord(f))));

  if (!host.children.length) {
    host.innerHTML = '<div class="clear"><div class="rail"></div><div class="fb">No findings against the loaded rule pack.</div></div>';
  }
}

function severityWord(f) {
  const s = severityOf(f);
  return s === "moderate" ? "Moderate" : s === "monitor" ? "Monitor" : "Informational";
}

/** Normalises an engine finding into what the card renders. */
function fromFinding(f, word) {
  const isInteraction = f.code && f.code.startsWith("INTERACTION_");
  return {
    sev: f.overridden ? "info" : severityOf(f),
    word,
    code: f.code,
    pair: f.drugs && f.drugs.length > 1 ? f.drugs.join(" + ") : null,
    risk: isInteraction ? (f.effect || f.message) : f.message,
    mechanism: f.mechanism || null,
    guidance: isInteraction ? f.action : null,
    monitoring: f.monitoring || null,
    ruleId: f.ruleId || null,
    merged: f.mergedCount > 1 ? f.mergedCount : null,
    finding: f,
  };
}

/* ------------------------------------------------------------------ InteractionCard + SafetySeverityBadge */

function interactionCard(c) {
  const el = document.createElement("div");
  el.className = "finding";
  el.dataset.sev = c.sev;

  const facts = [
    c.risk ? `<span class="k">Risk</span><p class="v strong">${esc(c.risk)}</p>` : "",
    c.mechanism ? `<span class="k">Mechanism</span><p class="v">${esc(c.mechanism)}</p>` : "",
  ].join("");
  const more = (c.guidance || c.monitoring) ? `
    <details>
      <summary>Guidance and monitoring</summary>
      <div class="facts">
        ${c.guidance ? `<span class="k">Guidance</span><p class="v">${esc(c.guidance)}</p>` : ""}
        ${c.monitoring ? `<span class="k">Monitor</span><p class="v">${esc(c.monitoring)}</p>` : ""}
        ${c.ruleId ? `<span class="k">Rule</span><p class="v mono" style="font-size:var(--fs-0)">${esc(c.ruleId)}${c.merged ? ` and ${c.merged - 1} related` : ""}</p>` : ""}
      </div>
    </details>` : "";

  el.innerHTML = `<div class="rail"></div><div class="fb">
    <div class="fh">
      <span class="sev" data-sev="${c.sev}">${esc(c.word)}</span>
      ${c.pair ? `<span class="pair">${esc(c.pair)}</span>` : ""}
      <span class="rule">${esc(c.code || "")}</span>
    </div>
    <div class="facts">${facts}</div>
    ${more}
  </div>`;

  const body = el.querySelector(".fb");
  if (c.finding && c.finding.disposition === DISPOSITION.BLOCK) {
    // No proceeding control is rendered, because the engine has no override path for a block.
    const note = document.createElement("p");
    note.className = "stop-note";
    note.textContent = "Cannot be overridden. Change the order, or ask pharmacy to review the underlying record.";
    body.appendChild(note);
  }
  if (c.finding && c.finding.disposition === DISPOSITION.OVERRIDABLE) body.appendChild(overridePanel(c.finding));
  return el;
}

/* ------------------------------------------------------------------ OverridePanel
 * A decision, not a form: choose why, say why, sign. Every element is required by the engine and
 * the button mirrors that; an override cannot be produced by clicking through. */

const REASONS = [
  ["CLINICAL_NECESSITY", "Clinical necessity"],
  ["NO_ALTERNATIVE", "No suitable alternative"],
  ["BENEFIT_OUTWEIGHS_RISK", "Benefit outweighs risk"],
  ["OTHER", "Other"],
];

function overridePanel(f) {
  const id = cssId(f.code);
  const box = document.createElement("div");
  box.className = "override";
  box.innerHTML = `
    <div class="q">Override required. Why are you proceeding?</div>
    <div class="reasons" role="group" aria-label="Reason for override">
      ${REASONS.map(([code, label]) => `<button type="button" class="reason" data-reason="${code}" aria-pressed="false">${esc(label)}</button>`).join("")}
    </div>
    <label class="rl" for="rationale-${id}">Clinical rationale</label>
    <textarea id="rationale-${id}" rows="3"></textarea>
    <div class="foot">
      <span class="rec"><span class="dot"></span>Recorded to the clinical audit trail as ${esc(ACTOR)}</span>
      <span class="spacer"></span>
      <button type="button" class="btn" data-cancel>Cancel</button>
      <button type="button" class="btn btn-danger" data-apply disabled>Apply override and sign</button>
    </div>`;

  const draft = state.overrideDrafts[f.code] || {};
  const rationale = box.querySelector("textarea");
  const apply = box.querySelector("[data-apply]");
  const reasons = [...box.querySelectorAll(".reason")];
  let reasonCode = draft.reasonCode || "";
  if (draft.rationale) rationale.value = draft.rationale;

  const sync = () => {
    for (const b of reasons) b.setAttribute("aria-pressed", b.dataset.reason === reasonCode ? "true" : "false");
    state.overrideDrafts[f.code] = { reasonCode, rationale: rationale.value };
    apply.disabled = !(reasonCode && rationale.value.trim().length >= 10);
  };
  for (const b of reasons) b.addEventListener("click", () => { reasonCode = b.dataset.reason; sync(); });
  rationale.addEventListener("input", sync);
  box.querySelector("[data-cancel]").addEventListener("click", () => { delete state.overrideDrafts[f.code]; clearOrder(); });
  apply.addEventListener("click", async () => {
    state.overrides.push({ code: f.code, targetId: f.ruleId || f.allergyId || null, reasonCode, rationale: rationale.value.trim(), actorId: ACTOR, at: new Date().toISOString() });
    delete state.overrideDrafts[f.code];
    await state.bus.emit("safety.override.recorded", { code: f.code, reasonCode, actorId: ACTOR });
    recordAudit(`Override recorded <strong>${esc(f.code)}</strong> ${esc(REASONS.find(([c]) => c === reasonCode)?.[1] || reasonCode)}`);
    runSafetyCheck();
    if (state.lastVerdict && state.lastVerdict.allowed) await signOrder();
  });
  sync();
  return box;
}

/* ------------------------------------------------------------------ AuditTrail */

function recordAudit(html) {
  const t = new Date();
  state.audit.unshift({ t: `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`, html });
  const host = $("audit");
  host.innerHTML = state.audit.map((a) => `<div class="row"><span class="t">${a.t}</span><span class="e">${a.html}</span></div>`).join("");
}

/* ------------------------------------------------------------------ signing */

async function signOrder() {
  const verdict = state.lastVerdict;
  const result = $("orderResult");
  if (!verdict || !verdict.allowed) {
    // The button is disabled already, but signing is where being wrong matters most, so the check
    // is repeated rather than trusted.
    result.innerHTML = '<div class="error-inline">This order cannot be signed while a blocking finding stands.</div>';
    return;
  }
  const order = currentOrder();
  order.status = "active";
  order.signedBy = ACTOR;
  await state.store.put(order);
  await state.bus.emit("order.signed", { order, overrides: state.overrides });
  state.current.activeMeds = (state.current.activeMeds || []).concat([{ drug: order.drug, sig: order.dose ? `${order.dose.value} ${order.dose.unit} ${order.route}` : order.route, since: "now" }]);
  renderActiveMeds();
  recordAudit(`Order signed <strong>${esc(order.drug)}</strong> ${order.dose ? esc(order.dose.value + " " + order.dose.unit) : ""} ${esc(order.route)}${state.overrides.length ? ` with ${state.overrides.length} override(s)` : ""}`);
  result.innerHTML = '<div class="clear"><div class="rail"></div><div class="fb">Order signed and recorded.</div></div>';
  clearOrder(true);
}

function clearOrder(keepResult) {
  $("drugInput").value = "";
  $("doseInput").value = "";
  state.overrides = [];
  state.overrideDrafts = {};
  state.lastVerdict = null;
  const keep = keepResult ? $("orderResult").innerHTML : "";
  runSafetyCheck();
  if (keepResult) $("orderResult").innerHTML = keep;
}

/* ------------------------------------------------------------------ keyboard, navigation */

let debounce;
for (const id of ["drugInput", "doseInput", "doseUnit", "routeInput"]) {
  const h = () => { clearTimeout(debounce); setEngine("checking", "Checking"); debounce = setTimeout(runSafetyCheck, 120); };
  $(id).addEventListener("input", h);
  $(id).addEventListener("change", h);
}
const orderFields = ["drugInput", "doseInput", "doseUnit", "routeInput"];
for (const id of orderFields) {
  $(id).addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !(e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const i = orderFields.indexOf(id);
      if (i < orderFields.length - 1) $(orderFields[i + 1]).focus();
    }
  });
}
document.addEventListener("keydown", (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); if (!$("signOrder").disabled) signOrder(); return; }
  if (e.key === "Escape") { clearOrder(); $("drugInput").blur(); return; }
  if (typing) return;
  const k = e.key.toLowerCase();
  if (k === "n" || k === "o") { e.preventDefault(); $("drugInput").focus(); }
  if (k === "l") { e.preventDefault(); $("labsBlock").scrollIntoView({ block: "start" }); }
  if (k === "m") { e.preventDefault(); $("medsBlock").scrollIntoView({ block: "start" }); }
  if (k === "p") { e.preventDefault(); $("patientList").querySelector(".row")?.focus(); }
});
for (const item of document.querySelectorAll(".nav .item")) {
  item.addEventListener("click", () => {
    if (item.getAttribute("aria-disabled") === "true") return;
    for (const other of document.querySelectorAll(".nav .item")) other.removeAttribute("aria-current");
    item.setAttribute("aria-current", "page");
    const target = { patients: "patientList", order: "orderBlock", meds: "medsBlock", labs: "labsBlock" }[item.dataset.nav];
    if (target === "patientList") $("patientList").querySelector(".row")?.focus();
    else if (target === "orderBlock") $("drugInput").focus();
    else if (target) $(target).scrollIntoView({ block: "start" });
  });
}
$("signOrder").addEventListener("click", signOrder);
$("clearOrder").addEventListener("click", () => clearOrder());

/* ------------------------------------------------------------------ helpers */

function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
function cssId(s) { return String(s || "x").replace(/[^A-Za-z0-9_-]/g, "-"); }
function titleCase(s) { return String(s).replace(/\b[a-z]/g, (c) => c.toUpperCase()); }

boot();
