/* wardsynq/ui/wardsynq-app.js — WardSynQ workstation.
 *
 * No clinical logic lives here. Every verdict comes from the real SafetyEngine against the real rule
 * pack; this file turns a verdict into clinical sentences and collects the override.
 *
 * How a finding is said, and why in this order. A labelled Risk/Mechanism grid is how a reference
 * work is written, not how a decision is made. Under time pressure a clinician needs, in order:
 *   1. what this means          the significance, in one plain sentence
 *   2. why, on THIS patient     the collision named against the patient's own medication list
 *   3. what to consider         the recommended alternative or mitigation
 *   4. what an override does    stated before it is offered, never after
 * Mechanism is real but it is study material, so it sits under a disclosure.
 *
 * Colour policy, enforced here as much as in the stylesheet: the allergy on the identity bar stays
 * unfilled until the drug being ordered actually implicates it. A chip that is red all day is
 * wallpaper by the second shift.
 */

import { SafetyEngine, DISPOSITION } from "../wardsynq-safety.js";
import { buildRulePack } from "../adapters/wardsynq-rules-stewardmd.js";
import { ClinicalEventBus } from "../wardsynq-events.js";
import { ClinicalStore, MemoryBackend } from "../wardsynq-store.js";
import { openRecordDeployment, recordParams, shellToken } from "./record-deployment.js";
import { GovernedStore, makeActor, KIND, TIER, GovernanceError } from "../wardsynq-actors.js";
import { OfflineJournal, MemoryJournalBackend, IndexedDBJournalBackend, Reconciler } from "../wardsynq-offline.js";
import { Patient, MedicationOrder, AllergyIntolerance } from "../wardsynq-model.js";

const $ = (id) => document.getElementById(id);
const ME = "Dr Kurmana";

/* ---------------------------------------------------------------- who is acting
 *
 * The workstation holds a credentialed human actor and writes ONLY through a governed session bound
 * to the chart currently on screen. Until this existed the safety case carried a deployment
 * requirement saying the controls were built and nothing used them, which is the same as not having
 * them: an enforcement point off the path enforces nothing.
 *
 * A real deployment authenticates this actor and takes the credential from the practitioner's
 * record. Here it is a constant, and it is a constant standing in for the one thing that must never
 * be a constant, so it is marked plainly rather than dressed up.
 */
let CLINICIAN = makeActor({
  id: ME, kind: KIND.HUMAN, tier: TIER.EXECUTE,
  display: ME,
  credential: "DEMO-NOT-A-REAL-REGISTRATION", // DEMO ONLY. A deployment reads this from the practitioner record.
});
// With ?record=<tenantId> the constant above is REPLACED by the actor the record service derives
// from the signed-in user, and the store below by the hospital's shared record. See connectRecord().

/** Seeding and other machine writes act as a service, which is capped below EXECUTE by its kind. */
const SEEDER = makeActor({ id: "wardsynq-seed", kind: KIND.SERVICE, tier: TIER.DRAFT });

const S = {
  engine: null, pack: null, patients: [], current: null,
  bus: new ClinicalEventBus({ nodeId: "workstation" }),
  store: new ClinicalStore({ backend: new MemoryBackend() }),
  governed: null,   // the only handle the rest of this file may write through
  session: null,    // bound to CLINICIAN and to the chart currently open
  journal: null,    // durable local journal, used when the network is gone
  offline: false,
  verdict: null, overrides: [], drafts: {}, ledger: [],
};

/* ---------------------------------------------------------------- demo cohort
 * Illustrative only. Fabricated records that look real are their own hazard, so this is stated in
 * the footer and the values are clinically coherent rather than round. */
function cohort() {
  const a = Patient({ mrn: "GH-40118", name: "Anjali Menon", dob: "1959-02-14", sex: "female", wristbandBarcode: "GH-40118" });
  Object.assign(a, {
    ageYears: 67, weightKg: 62, egfr: 47, bed: "MICU 04", stay: "day 3 of admission",
    allergies: [AllergyIntolerance({ patientId: a.id, substance: "Penicillins", reaction: "anaphylaxis", severity: "severe", criticality: "high", verifiedBy: "allergy-service" })],
    activeMeds: [
      { drug: "Warfarin 3mg", sig: "3 mg orally at night", since: "long term" },
      { drug: "Clarithromycin 500mg", sig: "500 mg orally twice daily", since: "started day 1" },
    ],
    labs: [
      { name: "INR", value: 2.4, unit: "", low: 2.0, high: 3.0 },
      { name: "Haemoglobin", value: 10.8, unit: "g/dL", low: 12.0, high: 15.0 },
      { name: "Creatinine", value: 1.42, unit: "mg/dL", low: 0.6, high: 1.1 },
      { name: "Potassium", value: 5.4, unit: "mmol/L", low: 3.5, high: 5.1 },
    ],
    resultsWhen: "07:40 today",
  });

  const b = Patient({ mrn: "GH-40233", name: "Ravi Deshpande", dob: "1988-11-02", sex: "male", wristbandBarcode: "GH-40233" });
  Object.assign(b, {
    ageYears: 37, weightKg: 78, egfr: 96, bed: "Ward 3A, bed 12", stay: "day 1",
    allergies: [], activeMeds: [],
    labs: [{ name: "Potassium", value: 4.1, unit: "mmol/L", low: 3.5, high: 5.1 }, { name: "Haemoglobin", value: 14.6, unit: "g/dL", low: 13.0, high: 17.0 }],
    resultsWhen: "yesterday 18:10",
  });

  const c = Patient({ mrn: "GH-40297", name: "Meera Iyer", dob: "2019-06-30", sex: "female", wristbandBarcode: "GH-40297" });
  Object.assign(c, { ageYears: 7, weightKg: null, egfr: null, bed: "Paediatrics 02", stay: "admitted 02:10", allergies: [], activeMeds: [], labs: [], resultsWhen: null });

  return [a, b, c];
}

/* ---------------------------------------------------------------- the shared record
 *
 * With ?record=<tenantId> this workstation charts into the hospital's record service instead of
 * into this browser's memory. That is the difference between a demonstration and an EMR: a refresh
 * keeps the chart, a second PC sees it, and the doctor's phone (wardsynq-record-boot.js) opens the
 * same record. Without the parameter the file behaves exactly as before, cohort and all.
 */
async function connectRecord() {
  const params = recordParams();
  if (!params) return null;
  // Opened from wardsynq.com as the hospital's landing screen: the rest of WardSynQ is in the rail.
  if (new URLSearchParams(location.search).get("site") === "1") { const nav = $("sitemap"); if (nav) nav.hidden = false; }
  const record = await openRecordDeployment({ tenantId: params.tenantId, token: shellToken, nodeId: "workstation", onDenied: showDenial });
  CLINICIAN = record.actor;
  S.bus = record.bus;
  S.store = record.store;      // governed; the raw store is not reachable from here
  S.record = record;
  note(`Connected to record <b>${esc(record.tenantId)}</b> as <b>${esc(record.actor.display)}</b>, ${esc(record.mode)}${record.actor.tier !== TIER.EXECUTE ? ", read only" : ""}`);
  return record;
}

/** The roster from the record: every patient, with the context the safety engine reads. */
async function roster(record) {
  const patients = await record.backend.list("Patient", 200);
  for (const p of patients) await hydrate(record, p);
  return patients;
}

/**
 * The canonical record holds AllergyIntolerance, MedicationOrder and Observation entities. This
 * screen's context panel and the safety engine read a flatter shape (allergies, activeMeds, labs),
 * which the demonstration cohort carried inline. Deriving it here from the record is the honest
 * version of the same thing; nothing is invented, and a field the record does not hold stays empty.
 */
async function hydrate(record, p) {
  const [allergies, orders, obs] = await Promise.all([
    record.backend.byPatient("AllergyIntolerance", p.id),
    record.backend.byPatient("MedicationOrder", p.id),
    record.backend.byPatient("Observation", p.id),
  ]);
  p.allergies = allergies;
  p.activeMeds = orders.filter((o) => o.status === "active").map((o) => ({
    drug: o.drug, sig: o.dose ? `${o.dose.value} ${o.dose.unit}, ${o.route || ""}` : (o.route || ""), since: o.meta && o.meta.effectiveAt ? o.meta.effectiveAt.slice(0, 10) : "",
  }));
  p.labs = obs.filter((o) => o.category === "laboratory" && typeof o.value === "number").map((o) => ({ name: o.code, value: o.value, unit: o.unit || "", low: null, high: null }));
  p.resultsWhen = p.labs.length ? "from the record" : null;
  if (p.dob && /^\d{4}-\d{2}-\d{2}$/.test(p.dob) && p.dob !== "0000-00-00") {
    const d = new Date(p.dob), now = new Date();
    let a = now.getFullYear() - d.getFullYear();
    if (now < new Date(now.getFullYear(), d.getMonth(), d.getDate())) a -= 1;
    p.ageYears = a;
  }
  p.bed = p.bed || null; p.stay = p.stay || null;
  return p;
}

/* ---------------------------------------------------------------- boot */

async function boot() {
  try {
    const [r1, r2] = await Promise.all([
      fetch(new URL("../../data/interaction-rules.json", import.meta.url)),
      fetch(new URL("../data/allergy-classes.seed.json", import.meta.url)),
    ]);
    if (!r1.ok || !r2.ok) throw new Error("clinical rules could not be loaded");
    const raw = await r1.json(), seed = await r2.json();
    S.pack = buildRulePack(raw, seed);
    S.engine = new SafetyEngine({ rulePack: S.pack });

    $("pack").innerHTML = seed.status
      ? `<b>Unapproved clinical content.</b> Allergy and dose rules in this build are seed data awaiting pharmacy sign-off. ${S.pack.interactions.length} interaction rules loaded.`
      : `${S.pack.interactions.length} interaction rules loaded.`;

    suggestions();
    const record = await connectRecord();
    if (!record) {
      S.patients = cohort();
      await S.store.open();
    }

    // From here the raw store handle is not used again. Every write goes through the governed
    // store, which is what turns the actor model from a module into a control.
    S.governed = new GovernedStore({ store: S.store, bus: S.bus, onDenied: showDenial });

    // The durable journal. IndexedDB where it exists, memory where it does not: a demo in a private
    // window losing its charting is annoying, a ward losing it is the hazard.
    const journalBackend = (typeof indexedDB !== "undefined")
      ? new IndexedDBJournalBackend({ dbName: "wardsynq-offline" })
      : new MemoryJournalBackend();
    S.journal = new OfflineJournal({ backend: journalBackend });
    try {
      const restored = await S.journal.open();
      if (restored) note(`Restored <strong>${restored}</strong> unsent ${restored === 1 ? "edit" : "edits"} from a previous session`);
    } catch (err) {
      // A journal that will not open is a real problem, and it still must not stop a clinician
      // working. Fall back to memory and say so, rather than failing silently either way.
      note(`Local journal unavailable, this session is not crash-safe: ${esc(String(err.message || err))}`);
      S.journal = new OfflineJournal({ backend: new MemoryJournalBackend() });
      await S.journal.open();
    }
    // Reconciliation writes clinical records, so it goes through governance too. It spans charts by
    // nature, so it gets an actor-bound handle rather than a chart-bound session.
    S.reconciler = new Reconciler({ store: S.governed.asStoreFor(CLINICIAN), bus: S.bus });
    watchConnectivity();

    // The demonstration cohort is seeded into the demonstration store only. A hospital's record is
    // never seeded with invented patients; in record mode the roster is read from the server.
    if (!record) for (const p of S.patients) await S.governed.put(SEEDER, p);
    else S.patients = await roster(record);

    /* Diagnostics handle. Read-mostly, and deliberately exposes the GOVERNED store rather than the
     * raw one: a support console that hands out an ungoverned write path would undo the control
     * this file exists to install. `setOffline` is here so an outage can be rehearsed on a ward
     * without unplugging anything. */
    if (typeof window !== "undefined") {
      window.WARDSYNQ = {
        actor: CLINICIAN,
        governed: S.governed,
        session: () => S.session,
        journal: () => S.journal,
        denials: () => S.governed.denials,
        setOffline: (v) => S.setOffline(!!v),
        reconcile: () => reconcileNow(),
      };
    }
    renderRoster();
    if (S.patients[0]) select(S.patients[0]);
    else $("roster").innerHTML = '<p class="quiet">No patients in this record yet.</p>';
  } catch (e) {
    const pack = $("pack");
    pack.className = "pack bad";
    pack.textContent = `${e.message}. Safety checking is unavailable, so ordering is disabled.`;
    $("drug").disabled = true;
    $("roster").innerHTML = '<p class="quiet">Unavailable.</p>';
  }
}

function suggestions() {
  const want = ["ibuprofen", "paracetamol", "warfarin", "apixaban", "simvastatin", "atorvastatin",
    "clarithromycin", "digoxin", "gentamicin", "methotrexate", "colchicine", "furosemide", "metformin", "omeprazole"];
  const list = $("drugList"), seen = new Set();
  for (const w of want) {
    const k = S.pack.genericIndex.has(w) ? w : S.pack.aliases.get(w);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    list.appendChild(Object.assign(document.createElement("option"), { value: cap(k) }));
  }
  list.appendChild(Object.assign(document.createElement("option"), { value: "Amoxicillin" }));
}

/* ---------------------------------------------------------------- identity */

function renderIdentity(allergyLive) {
  const p = S.current, host = $("identity");
  if (!p) { host.innerHTML = ""; return; }
  const sex = p.sex === "female" ? "F" : p.sex === "male" ? "M" : "sex unknown";
  const wt = p.weightKg != null ? `${p.weightKg} kg` : "weight not recorded";
  const sep = '<span class="sep">/</span>';
  const allergy = p.allergies && p.allergies.length
    ? `<div class="allergy" data-live="${allergyLive ? "true" : "false"}">
         <span class="t">Allergy</span><span class="v">${esc(p.allergies.map((a) => a.substance).join(", "))}</span>
         <span class="t">${esc(p.allergies[0].reaction || "")}</span></div>`
    : `<div class="allergy"><span class="t">No known allergies</span></div>`;

  host.innerHTML = `
    <div class="who">
      <div class="name">${esc(p.name)}</div>
      <div class="facts">${p.ageYears != null ? p.ageYears : "?"} ${esc(sex)} ${sep} ${esc(wt)} ${sep} <span class="ident">${esc(p.mrn)}</span> ${sep} ${esc(p.bed || "")} ${sep} ${esc(p.stay || "")}</div>
    </div>
    <span class="spring"></span>
    ${allergy}
    <div class="tools"><button class="btn" type="button" id="focusOrder">New order</button></div>`;
  $("focusOrder").addEventListener("click", () => $("drug").focus());
}

function renderRoster() {
  const host = $("roster");
  host.innerHTML = "";
  for (const p of S.patients) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "pt";
    b.setAttribute("aria-current", S.current && S.current.id === p.id ? "true" : "false");
    b.dataset.alert = (p.allergies || []).some((a) => a.criticality === "high") ? "true" : "false";
    b.innerHTML = `<span class="mark"></span><span class="n">${esc(p.name)}</span><span class="m">${esc(p.bed || "")}</span>`;
    b.addEventListener("click", () => select(p));
    host.appendChild(b);
  }
}

function select(p) {
  S.current = p; S.overrides = []; S.drafts = {};
  // Rebind the session to the chart now on screen. This is what makes a write to another patient
  // impossible rather than merely discouraged: a stale form or a second tab holds a session bound
  // to a chart that is no longer open, and its writes are refused.
  S.session = S.governed ? S.governed.session(CLINICIAN, p.id) : null;
  renderRoster(); renderIdentity(false); renderResults(); renderDosing(); renderMeds();
  check();
}

/* ---------------------------------------------------------------- context */

function renderResults() {
  const p = S.current;
  $("resultsWhen").textContent = p.resultsWhen || "";
  const host = $("results");
  if (!p.labs || !p.labs.length) { host.innerHTML = '<p class="quiet">No results.</p>'; return; }
  host.innerHTML = p.labs.map((l) => {
    const out = (l.high != null && l.value > l.high) || (l.low != null && l.value < l.low);
    const dir = l.high != null && l.value > l.high ? "high" : l.low != null && l.value < l.low ? "low" : "";
    const range = l.low != null || l.high != null ? `${l.low ?? ""} to ${l.high ?? ""}` : "";
    return `<div class="result" data-dev="${out ? "out" : "in"}" data-dir="${dir}">
      <span class="mark"></span>
      <span class="v">${esc(String(l.value))}${l.unit ? `<u>${esc(l.unit)}</u>` : ""}</span>
      <span></span>
      <span class="meta"><span class="n">${esc(l.name)}</span>${dir ? `<span class="d">${dir}</span>` : ""}<span class="r">${esc(range)}</span></span>
    </div>`;
  }).join("");
}

function renderDosing() {
  const p = S.current;
  const band = p.egfr == null ? "not available" : p.egfr >= 90 ? "normal" : p.egfr >= 60 ? "mildly reduced" : p.egfr >= 30 ? "moderately reduced" : p.egfr >= 15 ? "severely reduced" : "kidney failure";
  $("dosing").innerHTML = `
    <dt>Weight</dt><dd class="${p.weightKg == null ? "missing" : ""}">${p.weightKg != null ? esc(p.weightKg + " kg") : "not recorded"}</dd>
    <dt>Kidney</dt><dd>${p.egfr != null ? esc(`eGFR ${p.egfr}, ${band}`) : esc(band)}</dd>
    <dt>Age</dt><dd>${p.ageYears != null ? esc(p.ageYears + " years") : "unknown"}</dd>`;
}

function renderMeds(implicated) {
  const p = S.current, host = $("meds");
  const hit = new Set((implicated || []).map((d) => String(d).toLowerCase()));
  if (!p.activeMeds || !p.activeMeds.length) { host.innerHTML = '<p class="quiet">None recorded.</p>'; return; }
  host.innerHTML = p.activeMeds.map((m) => {
    const on = [...hit].some((h) => h.includes(m.drug.toLowerCase().split(" ")[0]));
    return `<div class="med" data-implicated="${on}"><div class="d">${esc(m.drug)}</div><div class="s">${esc(m.sig || "")}${m.since ? `, ${esc(m.since)}` : ""}</div></div>`;
  }).join("");
}

/* ---------------------------------------------------------------- safety */

function order() {
  const drug = $("drug").value.trim();
  if (!drug) return null;
  const v = Number.parseFloat($("dose").value);
  return MedicationOrder({
    patientId: S.current.id, drug,
    dose: Number.isFinite(v) ? { value: v, unit: $("unit").value } : null,
    route: $("route").value, prescriberId: CLINICIAN.id,
  });
}

function check() {
  if (!S.engine || !S.current) return;
  const o = order();
  $("orderEcho").textContent = o && o.dose ? `${o.dose.value} ${o.dose.unit}, ${o.route}` : "";
  if (!o) {
    $("findings").innerHTML = '<section class="line" data-sig="none"><div class="signal"></div><div class="said"><p class="quiet">Enter a medication to check it against this patient.</p></div></section>';
    $("sign").disabled = true; $("signWhy").textContent = ""; S.verdict = null;
    renderIdentity(false); renderMeds([]);
    return;
  }
  const p = S.current;
  smdLazy('/interaction-rules.js?v=gold363').then(function() {
    const v = S.engine.evaluate({
      order: o, patient: p, weightKg: p.weightKg, egfr: p.egfr,
      allergies: p.allergies || [], activeMeds: p.activeMeds || [], overrides: S.overrides,
    });
    S.verdict = v;
    S.orderSubject = o.drug;

    const allergyLive = v.findings.some((f) => String(f.code || "").startsWith("ALLERGY"));
    renderIdentity(allergyLive);
    renderMeds(v.findings.flatMap((f) => f.drugs || []));
    renderFindings(v, o);

    $("sign").disabled = !v.allowed;
    $("signWhy").textContent = v.allowed ? "" : v.blocks.length ? "A hard stop is standing." : "An override is required first.";
  });
}

/** Engine disposition and severity, expressed as clinical significance. */
function classOf(f) {
  if (f.overridden) return { sig: "watch", word: "Overridden" };
  if (f.disposition === DISPOSITION.BLOCK) return { sig: "stop", word: "Hard stop" };
  if (f.disposition === DISPOSITION.OVERRIDABLE) return { sig: "major", word: "Major" };
  if (f.severity === "moderate") return { sig: "watch", word: "Moderate" };
  if (f.severity === "monitor") return { sig: "watch", word: "Monitor" };
  return { sig: "none", word: "Note" };
}

function renderFindings(v, o) {
  const host = $("findings");
  host.innerHTML = "";
  const all = [...v.blocks, ...v.overridables, ...v.warnings];

  if (v.unresolvedDrug) host.appendChild(line("none", unknownDrug(o)));
  if (!all.length) {
    host.appendChild(line(v.unresolvedDrug ? "none" : "clear",
      `<p class="sig-line">Nothing in the rule pack objects to this order.</p>
       <p class="because">Checked against ${S.pack.interactions.length} interaction rules, this patient's allergies, weight and kidney function.</p>`));
    return;
  }
  for (const f of all) host.appendChild(findingLine(f, o));
}

function unknownDrug(o) {
  return `<p class="sig-line">${esc(o.drug)} is not in the rule pack, so nothing has been checked.</p>
    <p class="because">No interaction, allergy or dose check has run against this product. Silence here is not reassurance.</p>`;
}

/** One finding, said as a clinical sentence. */
function findingLine(f, o) {
  const c = classOf(f);
  const el = document.createElement("section");
  el.className = "line";
  el.dataset.sig = c.sig;

  const others = (f.drugs || []).filter((d) => d !== o.drug);
  const pairing = others.length
    ? `<div class="pairing"><span class="d">${esc(o.drug)}</span><span class="op">with</span><span class="d">${esc(others.join(", "))}</span></div>`
    : "";

  // The significance sentence. For an interaction the engine's `effect` is already a clinical
  // statement; for everything else the message is.
  const significance = f.effect || f.message || "";
  const consider = f.action || "";
  const because = becauseLine(f, others);

  const consequence = f.disposition === DISPOSITION.BLOCK
    ? `There is no override for this. Change the order, or ask pharmacy to review the record behind it.`
    : f.disposition === DISPOSITION.OVERRIDABLE
      ? `Proceeding records your name against this decision, notifies the clinical safety officer, and appears on the safety committee list within 24 hours.`
      : "";

  el.innerHTML = `<div class="signal"></div><div class="said"><div class="finding">
      <div class="cls">${esc(c.word)}</div>
      ${pairing}
      <p class="sig-line">${esc(significance)}</p>
      ${because ? `<p class="because">${because}</p>` : ""}
      ${consider ? `<p class="consider"><b>Consider.</b> ${esc(consider)}</p>` : ""}
      ${consequence ? `<p class="consequence">${esc(consequence)}</p>` : ""}
      ${f.mechanism ? `<details><summary>Mechanism</summary><p class="mech">${esc(f.mechanism)}${f.monitoring ? ` ${esc(f.monitoring)}` : ""}</p></details>` : ""}
    </div></div>`;

  if (f.disposition === DISPOSITION.OVERRIDABLE) el.querySelector(".finding").appendChild(overrideBlock(f));
  return el;
}

/**
 * Grounds the finding in this patient. Names the drug from their own list with its actual
 * instruction, and juxtaposes any out-of-range result. Deliberately juxtaposition and not
 * inference: the interface never claims a result caused a finding, it puts them side by side and
 * lets the clinician read them together.
 */
function becauseLine(f, others) {
  const p = S.current;
  const bits = [];
  for (const name of others) {
    const m = (p.activeMeds || []).find((x) => x.drug === name);
    if (m) bits.push(`already on <b>${esc(m.drug)}</b>, ${esc(m.sig || "")}${m.since ? `, ${esc(m.since)}` : ""}`);
  }
  const abnormal = (p.labs || []).filter((l) => (l.high != null && l.value > l.high) || (l.low != null && l.value < l.low));
  if (abnormal.length && f.disposition !== DISPOSITION.WARN) {
    bits.push(`on this chart today: ${abnormal.map((l) => `<b>${esc(l.name)} ${esc(String(l.value))}${esc(l.unit || "")}</b>`).join(", ")}`);
  }
  if (!bits.length) return "";
  return `This patient is ${bits.join("; ")}.`;
}

function line(sig, html) {
  const el = document.createElement("section");
  el.className = "line"; el.dataset.sig = sig;
  el.innerHTML = `<div class="signal"></div><div class="said">${html}</div>`;
  return el;
}

/* ---------------------------------------------------------------- override */

const REASONS = [["CLINICAL_NECESSITY", "Clinical necessity"], ["NO_ALTERNATIVE", "No suitable alternative"],
  ["BENEFIT_OUTWEIGHS_RISK", "Benefit outweighs risk"], ["OTHER", "Other"]];

function overrideBlock(f) {
  const id = safe(f.code);
  const box = document.createElement("div");
  box.className = "override";
  box.innerHTML = `
    <div class="ask">Why are you proceeding?</div>
    <div class="picks" role="group" aria-label="Reason">
      ${REASONS.map(([c, l]) => `<button type="button" class="pick" data-r="${c}" aria-pressed="false">${esc(l)}</button>`).join("")}
    </div>
    <label class="rl" for="rat-${id}">Clinical reasoning, in your own words</label>
    <textarea id="rat-${id}" rows="3"></textarea>
    <div class="row">
      <span class="sworn">Signed as ${esc(ME)} and kept with the order.</span>
      <span class="spring"></span>
      <button type="button" class="btn" data-cancel>Cancel</button>
      <button type="button" class="btn btn-commit" data-apply disabled>Override and sign</button>
    </div>`;

  const d = S.drafts[f.code] || {};
  const ta = box.querySelector("textarea"), apply = box.querySelector("[data-apply]");
  const picks = [...box.querySelectorAll(".pick")];
  let reason = d.reason || "";
  if (d.text) ta.value = d.text;

  const sync = () => {
    for (const b of picks) b.setAttribute("aria-pressed", b.dataset.r === reason ? "true" : "false");
    S.drafts[f.code] = { reason, text: ta.value };
    apply.disabled = !(reason && ta.value.trim().length >= 10);
  };
  for (const b of picks) b.addEventListener("click", () => { reason = b.dataset.r; sync(); });
  ta.addEventListener("input", sync);
  box.querySelector("[data-cancel]").addEventListener("click", () => { delete S.drafts[f.code]; clear(); });
  box.querySelector("[data-apply]").addEventListener("click", async () => {
    S.overrides.push({ code: f.code, targetId: f.ruleId || f.allergyId || null, reasonCode: reason, rationale: ta.value.trim(), actorId: ME, at: new Date().toISOString() });
    delete S.drafts[f.code];
    await S.bus.emit("safety.override.recorded", { code: f.code, reasonCode: reason, actorId: ME });
    note(`Override, ${esc(REASONS.find(([c]) => c === reason)[1].toLowerCase())}`);
    check();
    if (S.verdict && S.verdict.allowed) await sign();
  });
  sync();
  return box;
}

/* ---------------------------------------------------------------- record */

function note(html) {
  const t = new Date();
  S.ledger.unshift({ t: `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`, html });
  $("ledger").innerHTML = S.ledger.map((e) => `<div class="e"><span class="t">${e.t}</span><span class="x">${e.html}</span></div>`).join("");
}

async function sign() {
  const v = S.verdict, out = $("signed");
  if (!v || !v.allowed) { out.innerHTML = '<p class="fail">This order cannot be signed while a finding stands.</p>'; return; }
  const o = order();
  o.status = "active"; o.signedBy = CLINICIAN.id;

  // Offline: the order goes to the durable journal instead, and does not pretend to be filed.
  if (S.offline) {
    try {
      const base = await S.session.get("MedicationOrder", o.id);
      await S.journal.record(o, base, CLINICIAN.id);
    } catch (err) {
      // record() only resolves once the edit is durable, so a rejection means it is NOT saved.
      out.innerHTML = `<p class="fail">Not saved. ${esc(String(err.message || err))}</p>`;
      return;
    }
    await S.bus.emit("order.journalled", { order: o });
    note(`Held offline <b>${esc(o.drug)}</b>, ${S.journal.size} unsent`);
    out.innerHTML = '<p class="quiet">Held on this device. It will be reconciled when the network returns.</p>';
    clear(true);
    return;
  }

  // Online: through the bound session, so the actor, the credential and the open chart are all
  // checked before anything is written.
  try {
    await S.session.put(o);
  } catch (err) {
    if (err instanceof GovernanceError) {
      out.innerHTML = `<p class="fail">Refused: ${esc(err.message)}</p>`;
      return;
    }
    throw err;
  }
  await S.bus.emit("order.signed", { order: o, overrides: S.overrides });
  S.current.activeMeds = (S.current.activeMeds || []).concat([{ drug: o.drug, sig: o.dose ? `${o.dose.value} ${o.dose.unit}, ${o.route}` : o.route, since: "just now" }]);
  renderMeds([]);
  note(`Signed <b>${esc(o.drug)}</b>${o.dose ? ` ${esc(o.dose.value + " " + o.dose.unit)}` : ""}${S.overrides.length ? `, with override` : ""}`);
  const kept = `<p class="quiet">Signed and kept with the record.</p>`;
  clear(); out.innerHTML = kept;
}

/**
 * A refused write is shown, never swallowed. A governance denial means the system stopped something
 * a clinician asked for, and an interface that hides that teaches people the software is flaky
 * rather than that it is protecting them.
 */
function showDenial(denial) {
  note(`<b>Write refused</b> ${esc(denial.reasons.map((r) => r.code).join(", "))}`);
}

/**
 * Connectivity. Offline is a first-class state here rather than an error: the journal takes writes,
 * and reconnection reconciles them three-way rather than replaying them blindly.
 */
function watchConnectivity() {
  const set = async (offline) => {
    if (S.offline === offline) return;
    S.offline = offline;
    document.body.dataset.offline = offline ? "true" : "false";
    note(offline ? "Network lost, charting locally" : "Network back, reconciling");
    if (!offline && S.journal && S.journal.size) await reconcileNow();
  };
  if (typeof window !== "undefined" && "onLine" in navigator) {
    S.offline = !navigator.onLine;
    window.addEventListener("online", () => set(false));
    window.addEventListener("offline", () => set(true));
  }
  S.setOffline = set; // exposed so the state can be driven in a test or a demo
}

async function reconcileNow() {
  const out = await S.reconciler.reconcile(S.journal);
  const settled = out.applied.length + out.merged.length;
  if (settled) note(`Reconciled <b>${settled}</b> offline ${settled === 1 ? "edit" : "edits"}`);
  if (out.conflicts.length) {
    note(`<b>${out.conflicts.length} conflict${out.conflicts.length === 1 ? "" : "s"}</b> need a clinical decision`);
    $("signed").innerHTML = `<p class="fail">${out.conflicts.length} offline ${out.conflicts.length === 1 ? "edit" : "edits"} conflict with the server and are waiting for you to decide. Nothing has been overwritten.</p>`;
  }
  return out;
}

/**
 * Resets the order form. `keepResult` preserves the confirmation panel, because clearing the form
 * after filing an order must not also erase the sentence telling the clinician what happened to it.
 * The offline path hit exactly that: it wrote "Held on this device" and then wiped it.
 */
function clear(keepResult) {
  $("drug").value = ""; $("dose").value = "";
  S.overrides = []; S.drafts = {}; S.verdict = null;
  const kept = keepResult ? $("signed").innerHTML : "";
  $("signed").innerHTML = "";
  check();
  if (keepResult) $("signed").innerHTML = kept;
}

/* ---------------------------------------------------------------- input */

let t;
for (const id of ["drug", "dose", "unit", "route"]) {
  const h = () => { clearTimeout(t); t = setTimeout(check, 110); };
  $(id).addEventListener("input", h); $(id).addEventListener("change", h);
}
const seq = ["drug", "dose", "unit", "route"];
for (const id of seq) {
  $(id).addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !(e.ctrlKey || e.metaKey)) { e.preventDefault(); const i = seq.indexOf(id); if (i < seq.length - 1) $(seq[i + 1]).focus(); }
  });
}
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); if (!$("sign").disabled) sign(); return; }
  if (e.key === "Escape") { clear(); return; }
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
  const k = e.key.toLowerCase();
  const to = { o: "orderSection", m: "medsSection", l: "resultsSection", r: "ledgerSection" }[k];
  if (to) { e.preventDefault(); if (k === "o") $("drug").focus(); else $(to).scrollIntoView({ block: "center" }); }
});
for (const b of document.querySelectorAll(".rail .link")) {
  b.addEventListener("click", () => {
    if (b.disabled) return;
    for (const o of document.querySelectorAll(".rail .link")) o.removeAttribute("aria-current");
    b.setAttribute("aria-current", "page");
    const to = { order: "orderSection", meds: "medsSection", results: "resultsSection", ledger: "ledgerSection" }[b.dataset.go];
    if (b.dataset.go === "order") $("drug").focus(); else if (to) $(to).scrollIntoView({ block: "center" });
  });
}
$("sign").addEventListener("click", sign);
$("clear").addEventListener("click", clear);

/* ---------------------------------------------------------------- helpers */
function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function safe(s) { return String(s || "x").replace(/[^A-Za-z0-9_-]/g, "-"); }
function cap(s) { return String(s).replace(/\b[a-z]/g, (c) => c.toUpperCase()); }

boot();
