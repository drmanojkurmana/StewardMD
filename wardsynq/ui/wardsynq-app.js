/* wardsynq/ui/wardsynq-app.js — WardSynQ order safety workstation.
 *
 * THE HOSPITAL'S OWN WARD, THROUGH THE WARD'S OWN ROUTES (LT-09, live test 2026-09-15). Until then this
 * page showed three fabricated patients and "signed" into a store in the browser's memory: a signed
 * order reached no chart and no eMAR, and a real admitted patient could not be chosen. Now:
 *   - the roster is GET /api/queue/ward/list, the same admitted patients the ward screen lists;
 *   - the patient's allergies, weight, age and results are the ward FHIR read (/ward/fhir), and the
 *     active medicines are the chart timeline (/ward/timeline);
 *   - Sign is POST /api/queue/ward/medication-order, the chart's own order route, in the chart's own two
 *     steps: checkOnly first, which runs the server's safety engine against the patient's record and
 *     writes nothing, then the order itself, with the prescriber's reason when there are findings. The
 *     order is the same record, through the same server check and the same audit, as any chart order.
 * No clinical logic lives here: every finding is the server's, and a refusal is shown as it came back.
 * A list that has not loaded is never drawn as an empty one. Allergies this screen could not read stop
 * the order, because the server reads them as the same signed-in person and would check against nothing.
 *
 * Colour policy: the allergy on the identity bar stays unfilled until a finding names an allergy. A chip
 * that is red all day is wallpaper by the second shift.
 */

const $ = (id) => document.getElementById(id);
const API = "/api/queue";
const BODY_WEIGHT_LOINC = "29463-7";

/* ---------------------------------------------------------------- staff language (ui-i18n-site)
 *
 * Owner decision 2026-09-15: the staff language picked in the site shell translates the WHOLE staff
 * interface, this workstation included. The language lives in the site shell's localStorage key
 * ("wsqStaffNavLang"), read once at boot. window.WSQI18n / window.WSQPrint come from classic scripts
 * loaded before this module (wardsynq.html); their absence must not break anything, so every lookup
 * falls back to the inline English.
 *
 * T(c, key, en, vars): plain text, translated or the English fallback with {name} vars filled.
 * TS(c, key, en, vars): escaped HTML, with the English original underneath (class="en-orig") when the
 * shown text differs from it and the language is not English. For refusals and failures.
 * EN(c, html): wraps already-escaped data HTML in <span lang="en"> when the language is not English.
 */
let LANG = "en";
function fill(s, vars) { return String(s).replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? String(vars[k]) : m)); }
function T(_c, key, en, vars) {
  const s = window.WSQI18n ? window.WSQI18n.t(key, vars, LANG) : key;
  return s === key && en != null ? fill(en, vars) : s;
}
function TS(_c, key, en, vars) {
  const shown = T(null, key, en, vars);
  if (LANG === "en") return esc(shown);
  let english = window.WSQI18n ? window.WSQI18n.t(key, vars, "en") : key;
  if (english === key && en != null) english = fill(en, vars);
  return esc(shown) + (english !== shown ? `<span class="en-orig" lang="en">${esc(english)}</span>` : "");
}
function EN(_c, html) { return LANG === "en" ? html : `<span lang="en">${html}</span>`; }
function enAttr() { return LANG === "en" ? "" : ' lang="en"'; }

/** The static English already in wardsynq.html, translated in place at boot. */
const STATIC_TEXT = [
  [() => document.querySelectorAll(".rail .link")[0], () => T(null, "order.nav.order", "Order"), "lead"],
  [() => document.querySelectorAll(".rail .link")[1], () => T(null, "order.nav.meds", "Medications"), "lead"],
  [() => document.querySelectorAll(".rail .link")[2], () => T(null, "order.nav.results", "Results"), "lead"],
  [() => document.querySelectorAll(".rail .link")[3], () => T(null, "order.nav.record", "Record"), "lead"],
  [() => document.querySelector('#sitemap a[href="/#/home"]'), () => T(null, "order.nav.map", "Map")],
  [() => document.querySelector('#sitemap a[href="/#/ward"]'), () => T(null, "order.nav.ward", "Ward")],
  [() => document.querySelector('#sitemap a[href="/#/ward/board"]'), () => T(null, "order.nav.bedboard", "Bed board")],
  [() => document.querySelector('#sitemap a[href="/#/ward/edboard"]'), () => T(null, "order.nav.emergency", "Emergency")],
  [() => document.querySelector('#sitemap a[href="/#/ward/critsboard"]'), () => T(null, "order.nav.criticalresults", "Critical results")],
  [() => document.querySelector('#sitemap a[href="/#/ward/labboard"]'), () => T(null, "order.nav.laboratory", "Laboratory")],
  [() => document.querySelector('#sitemap a[href="/#/ward/radboard"]'), () => T(null, "order.nav.radiology", "Radiology")],
  [() => document.querySelector('#sitemap a[href="/#/ward/flowcommand"]'), () => T(null, "order.nav.commandcenter", "Command center")],
  [() => document.querySelector('#sitemap a[href="/#/ward/twin"]'), () => T(null, "order.nav.digitaltwin", "Digital twin")],
  [() => document.querySelector('#sitemap a[href="/#/patients"]'), () => T(null, "order.nav.patients", "Patients")],
  [() => document.querySelector('#sitemap a[href="/#/ward/cashier"]'), () => T(null, "order.nav.billing", "Billing")],
  [() => document.querySelector('#sitemap a[href="/#/ward/reports"]'), () => T(null, "order.nav.reports", "Reports")],
  // /#/maik stays: "MaiK" is a product name, never translated.
  [() => document.querySelector('#sitemap a[href="/#/admin"]'), () => T(null, "order.nav.admincenter", "Admin Center")],
  [() => document.querySelector('#sitemap a[href="/#/audit"]'), () => T(null, "order.nav.audit", "Audit")],
  [() => document.querySelector('#sitemap a[href="/#/logout"]'), () => T(null, "order.nav.signout", "Sign out")],
  [() => document.querySelector(".roster .heading"), () => T(null, "order.nav.ward", "Ward")],
  [() => document.querySelector("#orderSection h2"), () => T(null, "order.nav.order", "Order")],
  [() => document.querySelectorAll("label.f span")[0], () => T(null, "order.field.medication", "Medication")],
  [() => document.querySelectorAll("label.f span")[1], () => T(null, "order.field.dose", "Dose")],
  [() => document.querySelectorAll("label.f span")[2], () => T(null, "order.field.unit", "Unit")],
  [() => document.querySelectorAll("label.f span")[3], () => T(null, "order.field.route", "Route")],
  [() => document.querySelectorAll("label.f span")[4], () => T(null, "order.field.frequency", "Frequency")],
  [() => document.querySelector('#route option[value="oral"]'), () => T(null, "order.route.oral", "Oral")],
  [() => document.querySelector('#route option[value="IV"]'), () => T(null, "order.route.iv", "IV")],
  [() => document.querySelector('#route option[value="IM"]'), () => T(null, "order.route.im", "IM")],
  [() => document.querySelector('#route option[value="SC"]'), () => T(null, "order.route.subcutaneous", "Subcutaneous")],
  [() => document.querySelector("#findings .quiet"), () => T(null, "order.findings.choosePatient", "Choose a patient from the ward list.")],
  [() => document.getElementById("sign"), () => T(null, "order.sign.button", "Sign order")],
  [() => document.getElementById("clear"), () => T(null, "order.clear.button", "Clear")],
  [() => document.querySelector("#ledgerSection h2"), () => T(null, "order.nav.record", "Record")],
  [() => document.querySelector("#ledgerSection .note"), () => T(null, "order.record.thissession", "this session")],
  [() => document.querySelector("#ledger .quiet"), () => T(null, "order.ledger.empty", "Nothing recorded yet.")],
  [() => document.querySelector("#resultsSection h2"), () => T(null, "order.nav.results", "Results")],
  [() => document.querySelectorAll(".context .grp .head h2")[1], () => T(null, "order.dosing.heading", "Dosing")],
  [() => document.querySelector("#medsSection h2"), () => T(null, "order.meds.heading", "Active medications")],
  [() => document.querySelector(".foot"), () => T(null, "order.footer.server", "The safety check runs on the server against this patient's record, with clinical content awaiting pharmacy sign-off.")],
  [() => document.getElementById("pack"), () => T(null, "order.pack.loadingWard", "Loading the ward.")],
];

function translateStatic() {
  if (LANG === "en") return;
  for (const [find, getText, mode] of STATIC_TEXT) {
    const el = find();
    if (!el) continue;
    const tr = getText();
    if (mode === "lead" && el.firstChild && el.firstChild.nodeType === 3) el.firstChild.nodeValue = `${tr} `;
    else el.textContent = tr;
  }
  const keys = document.querySelector("p.keys");
  if (keys) {
    const map = { "next field": T(null, "order.keys.nextField", "next field"), "sign": T(null, "order.keys.sign", "sign"), "clear": T(null, "order.keys.clear", "clear") };
    for (const node of Array.from(keys.childNodes)) {
      if (node.nodeType !== 3) continue;
      const trimmed = node.nodeValue.trim();
      if (map[trimmed] == null) continue;
      const lead = /^\s*/.exec(node.nodeValue)[0], trail = /\s*$/.exec(node.nodeValue)[0];
      node.nodeValue = lead + map[trimmed] + trail;
    }
  }
}

/** Reads the staff language, loads its file if offered, then runs `cb`. */
function initLang(cb) {
  let code = "";
  try { code = localStorage.getItem("wsqStaffNavLang") || ""; } catch (e) {}
  const proceed = () => { try { document.documentElement.lang = LANG; } catch (e) {} translateStatic(); cb(); };
  if (code && code !== "en" && window.WSQI18n && window.WSQI18n.offered(code)) {
    LANG = code;
    if (window.WSQPrint && window.WSQPrint.ensureLoaded) window.WSQPrint.ensureLoaded(code, proceed);
    else proceed();
  } else proceed();
}

/* ---------------------------------------------------------------- state
 *
 * patients: null while loading, false when the ward list could not be read, else the admitted patients.
 * ctx: the open patient's context, { state: "loading" | "failed" | "ok", ... }. Ordering needs "ok".
 * review: the server's checkOnly answer for the order as it was when checked, or null.
 */
const S = { orgId: "", me: null, patients: null, listError: "", current: null, ctx: null, review: null, busy: false, ledger: [] };

/* ---------------------------------------------------------------- transport
 *
 * The same credential rule as the ward screen: hospital-auth.js (loaded before this module) sends a
 * staff session only for the hospital it was minted for, else the account's bearer. */
async function api(path, body) {
  const auth = window.SMD_HOSPITAL_AUTH;
  const headers = auth ? await auth.headersFor(S.orgId) : { "Content-Type": "application/json" };
  const init = body ? { method: "POST", headers, credentials: "include", body: JSON.stringify(body) } : { headers, credentials: "include" };
  const r = await fetch(API + path, init);
  let data = null;
  try { data = await r.json(); } catch (e) {}
  return { status: r.status, data: data || {} };
}
const qs = (o) => Object.keys(o).map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(o[k])}`).join("&");

/** The hospital this page is for: the site shell passes it; else the workplace this browser is signed in to. */
function hospitalId() {
  const fromUrl = new URLSearchParams(location.search).get("orgId");
  if (fromUrl) return fromUrl;
  try { return (window.SMD_HOSPITAL_AUTH && window.SMD_HOSPITAL_AUTH.currentOrg()) || ""; } catch (e) { return ""; }
}

/* ---------------------------------------------------------------- boot */

async function boot() {
  if (new URLSearchParams(location.search).get("site") === "1") {
    const nav = $("sitemap");
    if (nav) nav.hidden = false;
  }
  $("drug").disabled = true;
  const pack = $("pack");
  try {
    S.orgId = hospitalId();
    if (!S.orgId) throw new Error(T(null, "order.boot.noHospital", "No hospital is open. Open the Order workstation from the WardSynQ map"));
    const [who, list] = await Promise.all([
      api("/whoami?" + qs({ orgId: S.orgId })),
      api("/ward/list?" + qs({ orgId: S.orgId })),
    ]);
    if (who.status === 401 || list.status === 401) throw Object.assign(new Error(T(null, "order.boot.signedOut", "You are not signed in (401)")), { signedOut: true });
    S.me = who.data && who.data.ok ? who.data : null;
    if (list.data && list.data.ok) S.patients = list.data.patients || [];
    else { S.patients = false; S.listError = list.data.detail || list.data.message || list.data.error || `HTTP ${list.status}`; }
    pack.textContent = T(null, "order.pack.serverCheck", "Every order is checked by the server against this patient's record before it is saved.");
  } catch (e) {
    S.patients = false;
    pack.className = "pack bad";
    if (e && e.signedOut) {
      const sentence = String(T(null, "order.boot.signInPrompt", "Please {link} to access this record.")).split("{link}");
      const link = `<a href="/#/login" style="color:inherit;text-decoration:underline;font-weight:600">${esc(T(null, "order.boot.signInLink", "sign in to WardSynQ"))}</a>`;
      let html = `${EN(null, esc(e.message))}. ${esc(sentence[0])}${link}${esc(sentence.slice(1).join("{link}"))}`;
      if (LANG !== "en") html += `<span class="en-orig" lang="en">${esc(fill("Please {link} to access this record.", { link: "sign in to WardSynQ" }))}</span>`;
      pack.innerHTML = html;
    } else {
      pack.innerHTML = `${EN(null, esc((e && e.message) || ""))}. ${TS(null, "order.boot.orderingDisabled", "Ordering is disabled.")}`;
    }
  }
  renderRoster();
  if (typeof window !== "undefined") window.WARDSYNQ = { state: () => S };
}

/* ---------------------------------------------------------------- roster */

function renderRoster() {
  const host = $("roster");
  if (S.patients === null) return; // the loading placeholders in the page stay
  if (S.patients === false) {
    host.innerHTML = `<p class="fail">${TS(null, "order.roster.failed", "The ward list could not be loaded. Do not read this as no patients.")}${S.listError ? ` ${EN(null, esc(S.listError))}` : ""}</p>`;
    return;
  }
  if (!S.patients.length) { host.innerHTML = `<p class="quiet">${esc(T(null, "order.roster.noneAdmitted", "No patients are admitted in this hospital."))}</p>`; return; }
  host.innerHTML = "";
  for (const p of S.patients) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "pt";
    b.setAttribute("aria-current", S.current && S.current.encounterId === p.encounterId ? "true" : "false");
    b.dataset.alert = "false";
    const where = [p.ward, p.bed].filter(Boolean).join(" ");
    b.innerHTML = `<span class="mark"></span><span class="n">${EN(null, esc(p.name || p.mrn || p.patientId))}</span><span class="m">${EN(null, esc(where))}</span>`;
    b.addEventListener("click", () => select(p));
    host.appendChild(b);
  }
}

/* ---------------------------------------------------------------- the open patient */

async function select(p) {
  S.current = p; S.review = null;
  S.ctx = { state: "loading" };
  $("signed").innerHTML = "";
  renderAll();
  const ctx = await loadContext(p);
  if (S.current !== p) return; // another patient was opened meanwhile
  S.ctx = ctx;
  renderAll();
}
function renderAll() { renderRoster(); renderIdentity(); renderResults(); renderDosing(); renderMeds(); refresh(); }

const fhirEntries = (r) => (r && r.status === 200 && r.data && Array.isArray(r.data.entry) ? r.data.entry.map((e) => e && e.resource).filter(Boolean) : null);

async function loadContext(p) {
  const org = { orgId: S.orgId };
  const safe = (pr) => pr.catch(() => ({ status: 0, data: {} }));
  const [allergyR, timelineR, patientR, weightR, labR] = await Promise.all([
    safe(api(`/ward/fhir/AllergyIntolerance?${qs({ ...org, patient: p.patientId, _count: 200 })}`)),
    safe(api(`/ward/timeline?${qs({ ...org, patientId: p.patientId })}`)),
    safe(api(`/ward/fhir/Patient/${encodeURIComponent(p.patientId)}?${qs(org)}`)),
    safe(api(`/ward/fhir/Observation?${qs({ ...org, patient: p.patientId, code: BODY_WEIGHT_LOINC, _sort: "-date", _count: 1 })}`)),
    safe(api(`/ward/fhir/Observation?${qs({ ...org, patient: p.patientId, category: "laboratory", _sort: "-date", _count: 20 })}`)),
  ]);
  const allergyRows = fhirEntries(allergyR);
  const meds = timelineR.data && timelineR.data.ok ? timelineR.data.activeMedications || [] : null;
  if (!allergyRows || !meds) {
    return { state: "failed", why: !allergyRows ? T(null, "order.ctx.allergiesFailed", "The allergy list could not be read.") : T(null, "order.ctx.medsFailed", "The active medicines could not be read.") };
  }
  const allergies = allergyRows
    .filter((a) => a.resourceType === "AllergyIntolerance" && !(a.clinicalStatus && a.clinicalStatus.coding && a.clinicalStatus.coding.some((c) => c.code === "inactive")))
    .map((a) => {
      const reaction = a.reaction && a.reaction[0];
      const said = reaction && reaction.manifestation && reaction.manifestation[0] && reaction.manifestation[0].text;
      return { substance: (a.code && (a.code.text || (a.code.coding && a.code.coding[0] && (a.code.coding[0].display || a.code.coding[0].code)))) || "", reaction: said && said !== "not recorded" ? said : null };
    })
    .filter((a) => a.substance);
  const activeMeds = meds.map((m) => ({
    drug: m.drug,
    sig: [m.dose && m.dose.value != null ? `${m.dose.value} ${m.dose.unit || ""}`.trim() : "", m.route, m.frequency].filter(Boolean).join(", "),
    since: m.since ? String(m.since).slice(0, 10) : "",
  }));
  const patient = patientR.status === 200 && patientR.data && patientR.data.resourceType === "Patient" ? patientR.data : null;
  const weightRows = fhirEntries(weightR);
  const w = weightRows && weightRows.find((o) => o.valueQuantity && typeof o.valueQuantity.value === "number");
  const labRows = fhirEntries(labR);
  return {
    state: "ok", allergies, activeMeds,
    ageYears: patient ? ageFrom(patient.birthDate) : null,
    sex: patient ? patient.gender || null : null,
    weightKg: w ? weightInKg(w.valueQuantity.value, w.valueQuantity.unit || w.valueQuantity.code) : null,
    weightWhen: w && w.effectiveDateTime ? String(w.effectiveDateTime).slice(0, 10) : "",
    labs: labRows ? latestPerTest(labRows) : false,
  };
}

function ageFrom(birthDate) {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || birthDate === "0000-00-00") return null;
  const d = new Date(birthDate), now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  if (now < new Date(now.getFullYear(), d.getMonth(), d.getDate())) a -= 1;
  return a >= 0 ? a : null;
}
/** kg, or pounds converted; any other unit is not shown as a weight. */
function weightInKg(value, unit) {
  const u = String(unit || "").toLowerCase();
  if (u === "kg") return value;
  if (u === "[lb_av]" || u === "lb" || u === "lbs") return Math.round(value * 0.45359237 * 10) / 10;
  return null;
}
function latestPerTest(rows) {
  const seen = new Set(), out = [];
  for (const o of rows) {
    const name = o.code && (o.code.text || (o.code.coding && o.code.coding[0] && o.code.coding[0].code));
    if (!name || seen.has(name) || !o.valueQuantity || typeof o.valueQuantity.value !== "number") continue;
    seen.add(name);
    out.push({ name, value: o.valueQuantity.value, unit: o.valueQuantity.unit || "" });
  }
  return out;
}

/* ---------------------------------------------------------------- identity and context */

function renderIdentity() {
  const p = S.current, c = S.ctx || {}, host = $("identity");
  if (!p) { host.innerHTML = ""; return; }
  const sf = S.review && S.review.safety;
  const allergyLive = !!(sf && (sf.findings || []).some((f) => String(f.code || "").startsWith("ALLERGY")));
  const sex = c.sex === "female" ? "F" : c.sex === "male" ? "M" : T(null, "order.identity.sexUnknown", "sex unknown");
  const wt = c.weightKg != null ? `${c.weightKg} kg` : T(null, "order.identity.weightMissing", "weight not recorded");
  const sep = '<span class="sep">/</span>';
  const allergies = c.allergies || [];
  const allergy = c.state === "loading"
    ? `<div class="allergy"><span class="t">${esc(T(null, "order.identity.allergiesLoading", "Allergies loading"))}</span></div>`
    : c.state === "failed"
      ? `<div class="allergy" data-live="true"><span class="t">${esc(T(null, "order.identity.allergiesUnknown", "Allergies could not be read"))}</span></div>`
      : allergies.length
        ? `<div class="allergy" data-live="${allergyLive ? "true" : "false"}">
             <span class="t">${esc(T(null, "order.identity.allergyLabel", "Allergy"))}</span><span class="v">${EN(null, esc(allergies.map((a) => a.substance).join(", ")))}</span>
             <span class="t">${EN(null, esc(allergies[0].reaction || ""))}</span></div>`
        : `<div class="allergy"><span class="t">${esc(T(null, "order.identity.noAllergies", "No known allergies"))}</span></div>`;
  const where = [p.ward, p.bed].filter(Boolean).join(" ");
  host.innerHTML = `
    <div class="who">
      <div class="name">${EN(null, esc(p.name || p.mrn || p.patientId))}</div>
      <div class="facts">${c.ageYears != null ? c.ageYears : "?"} ${esc(sex)} ${sep} ${esc(wt)} ${sep} <span class="ident">${EN(null, esc(p.mrn || ""))}</span> ${sep} ${EN(null, esc(where))}</div>
    </div>
    <span class="spring"></span>
    ${allergy}
    <div class="tools"><button class="btn" type="button" id="focusOrder">${esc(T(null, "order.identity.newOrder", "New order"))}</button></div>`;
  $("focusOrder").addEventListener("click", () => $("drug").focus());
}

function renderResults() {
  const c = S.ctx || {}, host = $("results");
  $("resultsWhen").textContent = "";
  if (!S.current || c.state === "loading") { host.innerHTML = '<div class="wait"></div>'; return; }
  if (c.state === "failed" || c.labs === false) { host.innerHTML = `<p class="fail">${TS(null, "order.results.failed", "Results could not be loaded.")}</p>`; return; }
  if (!c.labs.length) { host.innerHTML = `<p class="quiet">${esc(T(null, "order.results.empty", "No results."))}</p>`; return; }
  host.innerHTML = c.labs.map((l) => `<div class="result" data-dev="in" data-dir="">
      <span class="mark"></span>
      <span class="v">${EN(null, `${esc(String(l.value))}${l.unit ? `<u>${esc(l.unit)}</u>` : ""}`)}</span>
      <span></span>
      <span class="meta"><span class="n">${EN(null, esc(l.name))}</span></span>
    </div>`).join("");
}

function renderDosing() {
  const c = S.ctx || {};
  if (!S.current || c.state !== "ok") { $("dosing").innerHTML = ""; return; }
  const weight = c.weightKg != null ? EN(null, esc(c.weightKg + " kg" + (c.weightWhen ? `, ${c.weightWhen}` : ""))) : esc(T(null, "order.dosing.weightMissing", "not recorded"));
  const age = c.ageYears != null ? esc(T(null, "order.dosing.ageYears", "{n} years", { n: c.ageYears })) : esc(T(null, "order.dosing.ageUnknown", "unknown"));
  $("dosing").innerHTML = `
    <dt>${esc(T(null, "order.dosing.weight", "Weight"))}</dt><dd class="${c.weightKg == null ? "missing" : ""}">${weight}</dd>
    <dt>${esc(T(null, "order.dosing.age", "Age"))}</dt><dd>${age}</dd>`;
}

function renderMeds() {
  const c = S.ctx || {}, host = $("meds");
  if (!S.current || c.state === "loading") { host.innerHTML = '<div class="wait"></div>'; return; }
  if (c.state === "failed") { host.innerHTML = `<p class="fail">${TS(null, "order.ctx.medsFailed", "The active medicines could not be read.")}</p>`; return; }
  if (!c.activeMeds.length) { host.innerHTML = `<p class="quiet">${esc(T(null, "order.meds.empty", "None recorded."))}</p>`; return; }
  host.innerHTML = c.activeMeds.map((m) => `<div class="med" data-implicated="false"><div class="d">${EN(null, esc(m.drug))}</div><div class="s">${EN(null, `${esc(m.sig || "")}${m.since ? `, ${esc(m.since)}` : ""}`)}</div></div>`).join("");
}

/* ---------------------------------------------------------------- the order */

/** The order as the form holds it now, in the chart's shape, or null with nothing typed. */
function order() {
  const drug = $("drug").value.trim();
  if (!drug || !S.current) return null;
  const v = Number.parseFloat($("dose").value);
  return {
    patientId: S.current.patientId, encounterId: S.current.encounterId, drug,
    dose: Number.isFinite(v) && v > 0 ? { value: v, unit: $("unit").value } : null,
    route: $("route").value, frequency: $("freq").value.trim(),
  };
}
const sameOrder = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function canPrescribe() { return !!(S.me && Array.isArray(S.me.caps) && S.me.caps.indexOf("emr.treat") > -1); }

function findingsNote(html, sig) {
  $("findings").innerHTML = `<section class="line" data-sig="${sig || "none"}"><div class="signal"></div><div class="said">${html}</div></section>`;
}

/** Sets the form, the Sign button and the findings area from the state. Writes nothing. */
function refresh() {
  const sign = $("sign"), why = $("signWhy"), c = S.ctx || {};
  sign.disabled = true;
  if (!S.current) { $("drug").disabled = true; return; }
  if (c.state !== "ok") {
    $("drug").disabled = true; why.textContent = "";
    if (c.state === "failed") findingsNote(`<p class="fail">${EN(null, esc(c.why || ""))} ${TS(null, "order.ctx.cannotCheck", "This order cannot be checked, so it cannot be signed.")}</p>`, "stop");
    else findingsNote(`<p class="quiet">${esc(T(null, "order.ctx.loading", "Loading this patient's allergies and medicines."))}</p>`);
    return;
  }
  $("drug").disabled = false;
  const o = order();
  $("orderEcho").textContent = o && o.dose ? `${o.dose.value} ${o.dose.unit}, ${o.route}${o.frequency ? `, ${o.frequency}` : ""}` : "";
  // A check answers the order it was asked about. Change the order and the check no longer stands.
  if (S.review && !sameOrder(S.review.order, o)) S.review = null;
  renderIdentity();
  if (S.review) renderReview(S.review);
  else findingsNote(`<p class="quiet">${esc(o ? T(null, "order.findings.signToCheck", "Sign order checks it on the server against this patient's record first.") : T(null, "order.findings.empty", "Enter a medication to check it against this patient."))}</p>`);

  const missing = !o ? "" : !o.dose ? T(null, "order.sign.needDose", "Enter the dose.") : !o.frequency ? T(null, "order.sign.needFrequency", "Say how often it is given, for example BD, q6h or STAT.") : "";
  sign.disabled = !o || !!missing || !canPrescribe() || S.busy;
  why.textContent = !canPrescribe() ? T(null, "order.sign.notPrescriber", "Your role cannot sign medication orders.") : missing;
  if (S.review && needsReason(S.review.safety)) sign.textContent = T(null, "order.sign.anyway", "Sign anyway");
  else sign.textContent = T(null, "order.sign.button", "Sign order");
}

const needsReason = (sf) => !!(sf && ((sf.blocks || []).length || (sf.overridables || []).length));
/** Anything the prescriber must see before the order is placed: the chart's own "clean" rule. */
const clean = (r) => { const sf = r.safety || {}; return sf.checked === true && !needsReason(sf) && !(sf.warnings || []).length && !sf.unresolvedDrug && !(sf.unresolvedActiveMeds || []).length && !r.replaces; };

/** Engine disposition, as clinical significance. */
function classOf(f) {
  if (f.overridden) return { sig: "watch", word: T(null, "order.sig.overridden", "Overridden") };
  if (f.disposition === "block") return { sig: "stop", word: T(null, "order.sig.hardStop", "Hard stop") };
  if (f.disposition === "overridable") return { sig: "major", word: T(null, "order.sig.major", "Major") };
  if (f.severity === "moderate") return { sig: "watch", word: T(null, "order.sig.moderate", "Moderate") };
  if (f.severity === "monitor") return { sig: "watch", word: T(null, "order.sig.monitor", "Monitor") };
  return { sig: "none", word: T(null, "order.sig.note", "Note") };
}

/** The server's check, before anything is written: its findings in its own words, and what proceeding takes. */
function renderReview(rv) {
  const host = $("findings"), sf = rv.safety || {};
  host.innerHTML = "";
  if (sf.checked === false) host.appendChild(line("stop", `<p class="fail">${TS(null, "order.review.notChecked", "The safety check could not run, so nothing about this order was checked.")}</p>`));
  if (sf.unresolvedDrug) host.appendChild(line("none", `<p class="sig-line">${T(null, "order.findings.unknownDrug", "{drug} is not in the rule pack, so nothing has been checked.", { drug: EN(null, esc(rv.order.drug)) })}</p>
    <p class="because">${esc(T(null, "order.findings.unknownDrugNote", "No interaction, allergy or dose check has run against this product. Silence here is not reassurance."))}</p>`));
  if ((sf.unresolvedActiveMeds || []).length) host.appendChild(line("watch", `<p class="because">${esc(T(null, "order.review.notCheckedAgainst", "Not checked against: {drugs}", { drugs: sf.unresolvedActiveMeds.join(", ") }))}</p>`));
  if (rv.replaces) {
    const was = [rv.replaces.dose && rv.replaces.dose.value != null ? `${rv.replaces.dose.value} ${rv.replaces.dose.unit || ""}`.trim() : "", rv.replaces.frequency].filter(Boolean).join(" ");
    host.appendChild(line("watch", `<p class="because">${T(null, "order.review.replaces", "This replaces the active order for this drug ({was}).", { was: EN(null, esc(was)) })}</p>`));
  }
  for (const f of [...(sf.blocks || []), ...(sf.overridables || []), ...(sf.warnings || [])]) {
    const c = classOf(f);
    host.appendChild(line(c.sig, `<div class="finding"><div class="cls">${esc(c.word)}</div><p class="sig-line"${enAttr()}>${esc(f.message || f.code)}</p></div>`));
  }
  if (sf.checked === true && clean(rv)) host.appendChild(line("clear", `<p class="sig-line">${esc(T(null, "order.findings.nothing", "Nothing in the rule pack objects to this order."))}</p>`));
  if (needsReason(sf)) {
    const box = document.createElement("div");
    box.className = "override";
    box.innerHTML = `<label class="rl" for="reason">${esc(T(null, "order.review.reasonLabel", "Reason for prescribing anyway (required)"))}</label>
      <textarea id="reason" rows="2"></textarea>
      <p class="consequence">${T(null, "order.override.signedAs", "Signed as {who} and kept with the order.", { who: EN(null, esc((S.me && S.me.name) || "")) })}</p>`;
    const ta = box.querySelector("textarea");
    ta.value = rv.reason || "";
    ta.addEventListener("input", () => { rv.reason = ta.value; });
    host.appendChild(box);
  }
}

function line(sig, html) {
  const el = document.createElement("section");
  el.className = "line"; el.dataset.sig = sig;
  el.innerHTML = `<div class="signal"></div><div class="said">${html}</div>`;
  return el;
}

/* ---------------------------------------------------------------- sign */

function note(html) {
  const t = new Date();
  S.ledger.unshift({ t: `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`, html });
  $("ledger").innerHTML = S.ledger.map((e) => `<div class="e"><span class="t">${e.t}</span><span class="x">${e.html}</span></div>`).join("");
}

/** The server's refusal, in its own words. */
function reasonOf(r) {
  const d = r && r.data;
  if (!r) return T(null, "order.sign.unreachable", "The server could not be reached.");
  return [d && (d.detail || d.message || d.error), d && Array.isArray(d.reasons) ? d.reasons.map((x) => (x && (x.message || x.code)) || x).join(", ") : ""].filter(Boolean).join(". ") || `HTTP ${r.status}`;
}
async function post(body) { try { return await api("/ward/medication-order", body); } catch (e) { return null; } }

/**
 * Sign, in the chart's two steps. The first press asks the server to check the order (checkOnly, nothing
 * written): nothing found, and the order is placed at once; anything found is shown, and the second press
 * places it with the prescriber's reason. Success is said only when the server says it wrote the order.
 */
async function sign() {
  const out = $("signed"), p = S.current, o = order();
  if ($("sign").disabled || S.busy || !o) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    out.innerHTML = `<p class="fail">${TS(null, "order.sign.offline", "Not saved. There is no connection, and an order is only saved on the server.")}</p>`;
    return;
  }
  const body = { orgId: S.orgId, order: { patientId: o.patientId, encounterId: o.encounterId, drug: o.drug, dose: o.dose, route: o.route, frequency: o.frequency } };
  S.busy = true; refresh();
  out.innerHTML = `<p class="quiet">${esc(T(null, "order.sign.checkingSaving", "Checking and saving the order."))}</p>`;

  let reason = "";
  if (!S.review) {
    const chk = await post({ ...body, checkOnly: true });
    if (S.current !== p) { S.busy = false; return; }
    if (!chk || !chk.data.ok) { S.busy = false; out.innerHTML = `<p class="fail">${TS(null, "order.sign.notSaved", "Not saved.")} ${EN(null, esc(reasonOf(chk)))}</p>`; refresh(); return; }
    if (!chk.data.checkOnly && chk.data.written) { S.busy = false; saved(p, o, chk.data); return; } // a server without checkOnly wrote it already
    const rv = { order: o, safety: chk.data.safety || {}, replaces: chk.data.replaces || null, reason: "" };
    if (!clean(chk.data)) { S.review = rv; S.busy = false; out.innerHTML = ""; refresh(); return; }
  } else {
    reason = String(S.review.reason || "").trim();
    if (needsReason(S.review.safety) && !reason) {
      S.busy = false;
      out.innerHTML = `<p class="fail">${TS(null, "order.sign.reasonRequired", "Give a reason to prescribe past these findings. Nothing was prescribed.")}</p>`;
      refresh(); return;
    }
  }

  const r = await post({ ...body, overrideReason: reason || undefined, idempotencyKey: `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}` });
  S.busy = false;
  if (r && r.data.ok && r.data.written) { saved(p, o, r.data, !!reason); return; }
  const why = r && r.data.ok && !r.data.written ? T(null, "order.sign.notWritten", "The server did not write it.") : reasonOf(r);
  out.innerHTML = `<p class="fail">${TS(null, "order.sign.notSaved", "Not saved.")} ${EN(null, esc(why))}</p>`;
  refresh();
}

async function saved(p, o, d, withReason) {
  const dose = o.dose ? ` ${EN(null, esc(o.dose.value + " " + o.dose.unit))}` : "";
  const override = withReason ? `, ${T(null, "order.note.withOverride", "with override")}` : "";
  note(T(null, "order.note.signed", "Signed {drug}{dose}{override}", { drug: `<b>${EN(null, esc(o.drug))}</b>`, dose, override }));
  clear();
  $("signed").innerHTML = `<p class="quiet">${TS(null, "order.sign.savedToChart", "Saved to {name}'s chart.", { name: p.name || p.mrn || "" })}</p>`;
  // The chart's medicines, as the server now holds them.
  if (S.current === p) { const ctx = await loadContext(p); if (S.current === p) { S.ctx = ctx; renderMeds(); refresh(); } }
}

/** Resets the order form. */
function clear() {
  $("drug").value = ""; $("dose").value = ""; $("freq").value = "";
  S.review = null;
  $("signed").innerHTML = "";
  refresh();
}

/* ---------------------------------------------------------------- input */

const FIELDS = ["drug", "dose", "unit", "route", "freq"];
for (const id of FIELDS) {
  $(id).addEventListener("input", refresh); $(id).addEventListener("change", refresh);
  $(id).addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !(e.ctrlKey || e.metaKey)) { e.preventDefault(); const i = FIELDS.indexOf(id); if (i < FIELDS.length - 1) $(FIELDS[i + 1]).focus(); }
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

initLang(boot);
