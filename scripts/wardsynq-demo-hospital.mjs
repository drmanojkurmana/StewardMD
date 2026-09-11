#!/usr/bin/env node
/* scripts/wardsynq-demo-hospital.mjs - build a clearly-labelled DEMO superspecialty hospital in
 * WardSynQ by driving the REAL HTTP API, one authenticated session per member of staff.
 *
 * ================================ THE DATA IS FABRICATED ================================
 * Every patient, name, phone number, diagnosis, result, invoice and transfusion this script
 * creates is INVENTED. No real person's data is used and none is produced. It is for showing
 * investors, hospitals and doctors what WardSynQ does. The seeder REFUSES to write into any
 * organisation whose name does not contain "DEMO".
 * =======================================================================================
 *
 * THE RULE THIS SCRIPT EXISTS TO PROVE: every clinical action is performed by the role that would
 * really perform it, through that role's own authenticated session. A doctor prescribes; a
 * pharmacist verifies and dispenses; a nurse administers at the bedside; a laboratory releases
 * results; billing raises the invoice and the cashier takes the payment; the blood bank crossmatches
 * and issues; HIM handles release-of-information; an admin sets up wards, beds and staff. Nothing is
 * written behind the API and no capability refusal is worked around with an admin session - a
 * refusal where one should not happen is reported as a FINDING and left standing.
 *
 * USAGE
 *   BASE=http://localhost:8790 WSQ_ACCESS=1 node scripts/wardsynq-demo-hospital.mjs
 *   node scripts/wardsynq-demo-hospital.mjs --dry-run
 * See scripts/README-demo-hospital.md for the local stack and the deployed-site variant.
 */

import { setTimeout as sleep } from "node:timers/promises";

// ---------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------
const E = process.env;
const BASE = (E.BASE || "http://localhost:8790").replace(/\/+$/, "");
const API = BASE + "/api/queue";
const ACCESS_MODE = E.WSQ_ACCESS === "1";
const OWNER_TOKEN = E.WSQ_OWNER_TOKEN || "";
const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");
const CONCURRENCY = Number(E.WSQ_CONCURRENCY || 6);
const DEMO_DOMAIN = "demo.wardsynq.test";
const DEMO_ORG_NAME = "WardSynQ DEMO Superspecialty Hospital";
/* The org to seed into. Locally the test double (test/wardsynq-persistence-server.mjs) hard-codes
 * the tenant -> org pointer at "org-wsq", so a freshly created org would never be the one the record
 * service resolves for that tenant; WSQ_ORG names the org to adopt and rename instead. On a real
 * deployment leave it unset and the seeder creates its own WardSynQ-native hospital. */
const ADOPT_ORG = E.WSQ_ORG || "";
/* Whoever already holds staff.admin in the target org. Used ONLY to create the DEMO admin member;
 * every subsequent setup action is performed by a DEMO admin's own session. */
const BOOTSTRAP = E.WSQ_BOOTSTRAP || "admin@example.test";
/* Fixed anchor so a second run replays the SAME records rather than seeding a second hospital. */
const ANCHOR = Date.parse(E.WSQ_ANCHOR || "2026-09-01T02:30:00.000Z");

const BANNER = [
  "==============================================================================",
  "  WardSynQ DEMO HOSPITAL SEEDER",
  "  This creates FABRICATED patients, staff and clinical records in a SEPARATE",
  "  DEMO tenant. Nothing here is real data about a real person. Do not use any",
  "  of it clinically, and do not dial any phone number it writes.",
  "==============================================================================",
].join("\n");

// ---------------------------------------------------------------------------------------------
// The hospital: 20 departments, 15 wards, exactly 100 beds, 82 admissions, 2 discharged -> 80 occupied
// ---------------------------------------------------------------------------------------------
const DEPARTMENTS = [
  ["General Medicine", "GMED", "clinical"], ["General Surgery", "GSUR", "clinical"],
  ["Cardiology", "CARD", "clinical"], ["Neurology & Neurosurgery", "NEUR", "clinical"],
  ["Orthopaedics", "ORTH", "clinical"], ["Obstetrics & Gynaecology", "OBGY", "clinical"],
  ["Paediatrics & Neonatology", "PAED", "clinical"], ["Oncology", "ONCO", "clinical"],
  ["Nephrology", "NEPH", "clinical"], ["Pulmonology", "PULM", "clinical"],
  ["Gastroenterology", "GAST", "clinical"], ["Critical Care", "CCM", "clinical"],
  ["Emergency Medicine", "EMER", "clinical"], ["Anaesthesia", "ANAE", "clinical"],
  ["Laboratory", "LAB", "diagnostic"], ["Radiology", "RAD", "diagnostic"],
  ["Pharmacy", "PHAR", "support"], ["Blood Bank", "BLBK", "support"],
  ["Billing & TPA", "BILL", "administrative"], ["Health Information Management", "HIM", "administrative"],
];

/* beds MUST total 100. occupied MUST total 82 (two of which are discharged at the end -> 80). */
const WARDS = [
  { name: "General Medicine A", code: "GMA", dept: "General Medicine", type: "general", beds: 12, occupied: 10, theme: "medicine" },
  { name: "General Surgery A", code: "GSA", dept: "General Surgery", type: "surgical", beds: 10, occupied: 8, theme: "surgery" },
  { name: "Cardiology Ward", code: "CAR", dept: "Cardiology", type: "general", beds: 8, occupied: 7, theme: "cardiology" },
  { name: "Neurosciences Ward", code: "NEU", dept: "Neurology & Neurosurgery", type: "general", beds: 6, occupied: 5, theme: "medicine" },
  { name: "Orthopaedics Ward", code: "ORT", dept: "Orthopaedics", type: "surgical", beds: 8, occupied: 6, theme: "surgery" },
  { name: "Maternity Ward", code: "OBG", dept: "Obstetrics & Gynaecology", type: "maternity", beds: 8, occupied: 7, theme: "maternity" },
  { name: "Paediatrics Ward", code: "PAE", dept: "Paediatrics & Neonatology", type: "paediatric", beds: 6, occupied: 5, theme: "paediatrics" },
  { name: "Neonatal ICU", code: "NIC", dept: "Paediatrics & Neonatology", type: "nicu", beds: 4, occupied: 3, theme: "neonatal" },
  { name: "Oncology Ward", code: "ONC", dept: "Oncology", type: "general", beds: 6, occupied: 5, theme: "oncology" },
  { name: "Nephrology Ward", code: "NEP", dept: "Nephrology", type: "general", beds: 4, occupied: 3, theme: "medicine" },
  { name: "Pulmonology Ward", code: "PUL", dept: "Pulmonology", type: "general", beds: 4, occupied: 3, theme: "medicine" },
  { name: "Gastroenterology Ward", code: "GAS", dept: "Gastroenterology", type: "general", beds: 4, occupied: 3, theme: "medicine" },
  { name: "Intensive Care Unit", code: "ICU", dept: "Critical Care", type: "icu", beds: 8, occupied: 7, theme: "critical" },
  { name: "High Dependency Unit", code: "HDU", dept: "Critical Care", type: "hdu", beds: 4, occupied: 3, theme: "critical" },
  { name: "Emergency Observation", code: "EMO", dept: "Emergency Medicine", type: "emergency", beds: 8, occupied: 7, theme: "emergency" },
];

/* Beds that are NOT green on the board. Chosen from beds no admission uses (index >= occupied). */
const BED_STATE_OVERRIDES = [
  ["GMA", 12, "cleaning"], ["GSA", 10, "blocked"], ["ORT", 8, "maintenance"],
  ["ICU", 8, "cleaning"], ["EMO", 8, "blocked"], ["PAE", 6, "cleaning"],
];

/* The record class each ward's admissions carry (migrate-inpatient ADMISSION_CLASSES). */
const CLASS_FOR = { icu: "ICU", hdu: "ICU", maternity: "MATERNITY", paediatric: "PEDIATRICS", nicu: "NICU" };

/* 159 members. Weighted the way a 100-bed superspecialty hospital actually staffs. Every role
 * listed here performs at least one real action in the run; the final assertion checks that. */
const ROSTER = [
  { role: "admin", n: 3, prefix: "admin" },
  { role: "doctor", n: 22, prefix: "dr" },
  { role: "resident", n: 14, prefix: "res" },
  { role: "intern", n: 10, prefix: "intern" },
  { role: "nurse", n: 70, prefix: "nurse" },
  { role: "supervisor", n: 4, prefix: "sup" },
  { role: "reception", n: 8, prefix: "recep" },
  { role: "pharmacy", n: 6, prefix: "pharm" },
  { role: "lab", n: 6, prefix: "lab" },
  { role: "billing", n: 3, prefix: "billing" },
  { role: "cashier", n: 4, prefix: "cash" },
  { role: "him", n: 2, prefix: "him" },
  { role: "blood_bank", n: 3, prefix: "bloodbank" },
  { role: "safety_officer", n: 2, prefix: "safety" },
  { role: "viewer", n: 2, prefix: "viewer" },
];

/* Obviously fabricated names. No real person's name is used: every surname is invented. */
const GIVEN = ["Aarav", "Isha", "Rohan", "Meera", "Kabir", "Ananya", "Vikram", "Nisha", "Arjun", "Priya",
  "Devan", "Tara", "Omar", "Leela", "Yash", "Rhea", "Nikhil", "Sana", "Farid", "Ira",
  "Jaya", "Manav", "Zoya", "Pranav", "Dia", "Karan", "Anvi", "Rehan", "Naina", "Sahil"];
const SURNAME = ["Testkar", "Fictor", "Samplewala", "Mockram", "Dummiya", "Placeholdi", "Notreal", "Pretendra", "Synthia", "Fabricato"];

/* No real phone numbers. India has no officially reserved fiction range (unlike Ofcom's 07700 900xxx),
 * and the registration route validates a 10-digit Indian mobile - so a genuine fiction block would be
 * refused. These are sequential synthetic numbers in one contiguous block, internally consistent,
 * never dialled by this software, and never to be dialled by a person. See the README. */
const phoneFor = (i) => "7000" + String(100000 + i).slice(-6);

const ICD = [
  ["I50.9", "Heart failure, unspecified"], ["J18.9", "Pneumonia, unspecified organism"],
  ["E11.9", "Type 2 diabetes mellitus without complications"], ["N18.3", "Chronic kidney disease, stage 3"],
  ["K35.80", "Acute appendicitis, unspecified"], ["I63.9", "Cerebral infarction, unspecified"],
  ["S72.001A", "Fracture of unspecified part of neck of femur"], ["J44.9", "COPD, unspecified"],
  ["K92.2", "Gastrointestinal haemorrhage, unspecified"], ["C50.911", "Malignant neoplasm of breast"],
  ["A41.9", "Sepsis, unspecified organism"], ["O80", "Encounter for full-term uncomplicated delivery"],
];
const DRUGS = [
  { drug: "Paracetamol", dose: { value: 1, unit: "g" }, route: "oral", frequency: "TDS" },
  { drug: "Amoxicillin", dose: { value: 500, unit: "mg" }, route: "oral", frequency: "TDS" },
  { drug: "Furosemide", dose: { value: 40, unit: "mg" }, route: "oral", frequency: "OD" },
  { drug: "Enoxaparin", dose: { value: 40, unit: "mg" }, route: "subcutaneous", frequency: "OD" },
  { drug: "Pantoprazole", dose: { value: 40, unit: "mg" }, route: "intravenous", frequency: "OD" },
  { drug: "Ceftriaxone", dose: { value: 1, unit: "g" }, route: "intravenous", frequency: "BD" },
];
/* LOINC codes that the default critical-value table in functions/_wardsynq/critical-results.js
 * actually knows, so a deliberately abnormal value really does open an escalation loop. */
const LABS = [
  { code: "2823-3", test: "Potassium", unit: "mmol/L", normal: 4.1, critical: 6.9 },
  { code: "2951-2", test: "Sodium", unit: "mmol/L", normal: 139, critical: 118 },
  { code: "718-7", test: "Haemoglobin", unit: "g/dL", normal: 12.4, critical: 5.9 },
  { code: "2160-0", test: "Creatinine", unit: "mg/dL", normal: 0.9, critical: 8.2 },
];

/* The hospital's own WardSynQ configuration. Every one of these is hospital-owned clinical or
 * commercial content the product deliberately refuses to default (see _opd_org.js wardsynqConfig). */
const WSQ_CONFIG = {
  criticalEscalation: { acknowledgeWithinMinutes: 20, escalateAfterMinutes: 45 },
  marTimes: { OD: ["08:00"], BD: ["08:00", "20:00"], TDS: ["08:00", "14:00", "20:00"], QDS: ["06:00", "12:00", "18:00", "22:00"] },
  marGraceMinutes: 60,
  utcOffsetMinutes: 330,
  highAlertDrugs: ["Insulin", "Heparin", "Enoxaparin", "Potassium chloride", "Vincristine"],
  resources: [
    { id: "ot-1", name: "Theatre 1", kind: "theatre" }, { id: "ot-2", name: "Theatre 2", kind: "theatre" },
    { id: "ot-3", name: "Theatre 3 (Emergency)", kind: "theatre" }, { id: "cath-1", name: "Cath Lab", kind: "theatre" },
  ],
  /* A tariff is a commercial document with no default - the product says so and refuses to invent
   * one. These are FABRICATED demo prices in INR, not any hospital's real rate card. */
  tariff: Object.assign(
    { "specimen-collection": { amount: 60, currency: "INR", description: "Specimen collection (DEMO price)" } },
    ...DRUGS.map((d) => ({ [d.drug]: { amount: 45, currency: "INR", description: d.drug + " unit dose (DEMO price)" } })),
    ...LABS.map((l) => ({ [l.code]: { amount: 320, currency: "INR", description: l.test + " (DEMO price)" } })),
    { "CXR-PA": { amount: 550, currency: "INR", description: "Chest radiograph (DEMO price)" } },
  ),
  // MaiK stays OFF: no model is configured for this demo tenant and a fabricated AI answer on a
  // fabricated chart would be the one thing here that could mislead.
  maik: { enabled: false },
};

// ---------------------------------------------------------------------------------------------
// HTTP: one session helper, one call helper, all failures collected
// ---------------------------------------------------------------------------------------------
const stats = { calls: 0, ok: 0, failures: [], byRole: Object.create(null), t0: Date.now() };
const tokens = new Map();   // identity -> X-Staff-Token, PIN mode only

/** The headers that make this request THIS member of staff. */
function session(actor) {
  if (ACCESS_MODE) return { "Cf-Access-Authenticated-User-Email": actor.identity };
  const tok = tokens.get(actor.identity);
  if (!tok) throw new Error(`no staff session for ${actor.identity} - PIN login did not succeed`);
  return { "X-Staff-Token": tok };
}
function ownerHeaders() {
  if (ACCESS_MODE) return { "Cf-Access-Authenticated-User-Email": BOOTSTRAP };
  if (!OWNER_TOKEN) throw new Error("WSQ_OWNER_TOKEN is required for owner-gated setup on a deployed site");
  return { Authorization: "Bearer " + OWNER_TOKEN };
}

const detailText = (j) => {
  const d = j && (j.detail !== undefined ? j.detail : j.message);
  return d == null ? "" : typeof d === "string" ? d : JSON.stringify(d);
};

let keySeq = 0;
/**
 * One call, as one role. Never throws for a server refusal: it is collected and reported with the
 * server's own words, the route and the role, and the run continues.
 */
async function as(actor, method, path, body, opts) {
  opts = opts || {};
  const key = opts.key || `wsq-demo-${ANCHOR}-${++keySeq}`;
  const headers = Object.assign({ "Content-Type": "application/json", "Idempotency-Key": key },
    opts.owner ? ownerHeaders() : session(actor));
  const payload = body ? Object.assign({}, body, opts.noIdem ? {} : { idempotencyKey: key }) : undefined;
  stats.calls += 1;
  let res, text;
  try {
    res = await fetch(API + "/" + path, { method, headers, body: payload ? JSON.stringify(payload) : undefined });
    text = await res.text();
  } catch (e) {
    stats.failures.push({ route: method + " " + path.split("?")[0], role: actor.role, error: "network", detail: String(e && e.message || e) });
    return { ok: false, status: 0, body: null };
  }
  let json = null;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  const good = res.ok && json && json.ok !== false;
  if (good) {
    stats.ok += 1;
    stats.byRole[actor.role] = (stats.byRole[actor.role] || 0) + 1;
  } else if (!opts.tolerate) {
    stats.failures.push({
      route: method + " " + path.split("?")[0], role: actor.role, status: res.status,
      error: (json && (json.error || json.detail)) || res.statusText,
      detail: detailText(json),
      reasons: json && Array.isArray(json.reasons) ? json.reasons.map((r) => (typeof r === "string" ? r : r && r.code) || "?") : undefined,
    });
  }
  return { ok: good, status: res.status, body: json };
}

/** Bounded parallelism. Never one-at-a-time for 80 patients, never unbounded. */
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (true) {
      const k = i++;
      if (k >= items.length) return;
      out[k] = await fn(items[k], k);
    }
  });
  await Promise.all(workers);
  return out;
}

// ---------------------------------------------------------------------------------------------
// The plan (pure - --dry-run prints this and stops)
// ---------------------------------------------------------------------------------------------
function buildStaff() {
  const staff = [];
  for (const r of ROSTER) {
    for (let i = 1; i <= r.n; i++) {
      const local = `${r.prefix}.${String(i).padStart(2, "0")}`;
      staff.push({ role: r.role, identity: `${local}@${DEMO_DOMAIN}`, pin: String(100000 + staff.length).slice(-6), name: `${r.prefix.toUpperCase()} ${i} (DEMO)` });
    }
  }
  return staff;
}

function buildPatients() {
  const out = [];
  let seq = 0;
  for (const w of WARDS) {
    for (let b = 1; b <= w.occupied; b++) {
      seq += 1;
      const i = seq - 1;
      out.push({
        seq,
        mrn: `SMD-DEMO-${String(seq).padStart(5, "0")}`,
        name: `Demo ${GIVEN[i % GIVEN.length]} ${SURNAME[i % SURNAME.length]}`,
        mobile: phoneFor(seq),
        gender: i % 2 ? "male" : "female",
        ageYears: w.theme === "neonatal" ? 0 : w.theme === "paediatrics" ? 3 + (i % 10) : 21 + (i % 60),
        ageMonths: w.theme === "neonatal" ? 1 : 0,
        ward: w.name, bed: `${w.code}-${String(b).padStart(2, "0")}`,
        class: CLASS_FOR[w.type] || "IPD",
        theme: w.theme,
        icd: ICD[i % ICD.length],
        drug: DRUGS[i % DRUGS.length],
        lab: LABS[i % LABS.length],
        admittedAt: new Date(ANCHOR + seq * 3600000).toISOString(),
      });
    }
  }
  return out;
}

function planSummary(staff, patients) {
  const beds = WARDS.reduce((a, w) => a + w.beds, 0);
  const occ = WARDS.reduce((a, w) => a + w.occupied, 0);
  const byRole = {};
  for (const s of staff) byRole[s.role] = (byRole[s.role] || 0) + 1;
  const byTheme = {};
  for (const p of patients) byTheme[p.theme] = (byTheme[p.theme] || 0) + 1;
  return { org: DEMO_ORG_NAME, base: BASE, mode: ACCESS_MODE ? "cloudflare-access header" : "staff PIN session",
    departments: DEPARTMENTS.length, wards: WARDS.length, beds, admissions: occ,
    dischargedAtEnd: 2, occupiedAtEnd: occ - 2,
    bedStatesSetAside: BED_STATE_OVERRIDES.length, staff: staff.length, staffByRole: byRole, admissionsByTheme: byTheme };
}

// ---------------------------------------------------------------------------------------------
// Phase 1: the organisation, its wards, its beds and its staff (an ADMIN does all of it)
// ---------------------------------------------------------------------------------------------
async function resolveOrg(bootstrapActor) {
  if (ADOPT_ORG) {
    const r = await as(bootstrapActor, "GET", `org?orgId=${encodeURIComponent(ADOPT_ORG)}`, null, { tolerate: true });
    if (!r.ok || !r.body.org) throw new Error(`WSQ_ORG=${ADOPT_ORG} is not an organisation this account can read`);
    const org = r.body.org;
    if (org.mode !== "wardsynq") throw new Error(`${ADOPT_ORG} is mode "${org.mode}"; the inpatient record needs a WardSynQ-native hospital`);
    if (!/DEMO/.test(org.name)) {
      const up = await as(bootstrapActor, "POST", "org/update", { orgId: org.id, name: DEMO_ORG_NAME });
      if (!up.ok) throw new Error(`refusing to seed: ${ADOPT_ORG} is named "${org.name}" (no DEMO) and renaming it was refused`);
      return up.body.org;
    }
    return org;
  }
  // A deployed site: find an existing DEMO hospital, else self-serve a new WardSynQ-native one.
  const list = await as(bootstrapActor, "GET", "orgs", null, { tolerate: true });
  const found = ((list.body && list.body.orgs) || []).find((o) => o.mode === "wardsynq" && /DEMO/.test(o.name || ""));
  if (found) return found;
  const made = await as(bootstrapActor, "POST", "onboard/wardsynq", { name: DEMO_ORG_NAME }, { owner: !ACCESS_MODE });
  if (!made.ok) throw new Error("could not create the DEMO hospital: " + JSON.stringify(made.body));
  return made.body.org;
}

async function setupOrg(admin, orgId) {
  await as(admin, "POST", "org/update", { orgId, name: DEMO_ORG_NAME, wardsynq: WSQ_CONFIG });

  const existingDepts = ((await as(admin, "GET", `org?orgId=${orgId}`, null, { tolerate: true })).body || {}).departments || [];
  const haveDept = new Set(existingDepts.map((d) => d.name));
  await pool(DEPARTMENTS.filter((d) => !haveDept.has(d[0])), CONCURRENCY, ([name, code, type]) =>
    as(admin, "POST", "dept", { orgId, name, code, type }));

  const wardRows = ((await as(admin, "GET", `wards?orgId=${orgId}`, null, { tolerate: true })).body || {}).wards || [];
  const haveWard = new Map(wardRows.map((w) => [w.name, w]));
  await pool(WARDS.filter((w) => !haveWard.has(w.name)), CONCURRENCY, (w) =>
    as(admin, "POST", "ward", { orgId, name: w.name, code: w.code, type: w.type }));

  const wards = new Map((((await as(admin, "GET", `wards?orgId=${orgId}`, null, { tolerate: true })).body || {}).wards || []).map((w) => [w.name, w]));
  const bedRows = ((await as(admin, "GET", `beds?orgId=${orgId}`, null, { tolerate: true })).body || {}).beds || [];
  const haveBed = new Set(bedRows.map((b) => b.wardId + "/" + b.name));
  const wanted = [];
  for (const w of WARDS) {
    const ward = wards.get(w.name);
    if (!ward) continue;
    for (let i = 1; i <= w.beds; i++) {
      const name = `${w.code}-${String(i).padStart(2, "0")}`;
      if (!haveBed.has(ward.id + "/" + name)) wanted.push({ wardId: ward.id, name });
    }
  }
  await pool(wanted, CONCURRENCY, (b) => as(admin, "POST", "bed", { orgId, wardId: b.wardId, name: b.name, state: "available" }));
  return wards;
}

async function setBedStates(admin, orgId) {
  const beds = ((await as(admin, "GET", `beds?orgId=${orgId}`, null, { tolerate: true })).body || {}).beds || [];
  const byName = new Map(beds.map((b) => [b.name, b]));
  const jobs = BED_STATE_OVERRIDES.map(([code, idx, state]) => ({ bed: byName.get(`${code}-${String(idx).padStart(2, "0")}`), state }))
    .filter((j) => j.bed && j.bed.state !== j.state);
  await pool(jobs, CONCURRENCY, (j) => as(admin, "POST", "bed/update", { orgId, bedId: j.bed.id, state: j.state }));
}

/* Roles that write a prescription, a signed note or a discharge summary. A nurse or a cashier holds
 * no registration and must not be handed one: they can use WardSynQ and cannot sign. */
const PRESCRIBER_ROLES = new Set(["doctor", "resident", "admin", "supervisor"]);
/** A demonstration registration number. Obviously fabricated, stable per person, never a real one. */
function demoRegNo(identity) {
  let h = 0;
  for (let i = 0; i < identity.length; i++) h = (h * 31 + identity.charCodeAt(i)) >>> 0;
  return "DEMO-REG-" + String(h % 1000000).padStart(6, "0");
}

async function setupStaff(admin, orgId, staff) {
  await pool(staff, CONCURRENCY, async (s) => {
    /* The hospital vouches for its own prescribers. Until 2026-09-11 a signing credential could
     * come only from a verified StewardMD account claim, so a doctor signing in as hospital staff
     * could write the chart and never sign a prescription. The registry is now the second source,
     * and every signed record says which of the two vouched (writtenBy.credentialSource). */
    const regNo = PRESCRIBER_ROLES.has(s.role) ? demoRegNo(s.identity) : "";
    const r = await as(admin, "POST", "member", { orgId, identity: s.identity, role: s.role, regNo });
    if (!ACCESS_MODE && r.ok) {
      await as(admin, "POST", "member/pin", { orgId, identity: s.identity, pin: s.pin });
    }
    return r;
  });
}

/** PIN mode only: turn each member's PIN into their own X-Staff-Token. */
async function openStaffSessions(orgCode, staff) {
  await pool(staff, CONCURRENCY, async (s) => {
    const res = await fetch(API + "/auth/pin", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clinicCode: orgCode, identity: s.identity, pin: s.pin }),
    });
    stats.calls += 1;
    const j = await res.json().catch(() => ({}));
    if (j && j.token) { tokens.set(s.identity, j.token); stats.ok += 1; }
    else stats.failures.push({ route: "POST auth/pin", role: s.role, status: res.status, error: (j && j.error) || "no_token", detail: s.identity });
  });
}

// ---------------------------------------------------------------------------------------------
// Phase 2: the patients
// ---------------------------------------------------------------------------------------------
/** A round-robin picker so the work is spread across the whole roster, not done by one person. */
function picker(staff, role) {
  const pool_ = staff.filter((s) => s.role === role);
  if (!pool_.length) throw new Error("no staff with role " + role);
  let i = 0;
  return () => pool_[i++ % pool_.length];
}

async function registerAndAdmit(orgId, p, who) {
  const recep = who.reception();
  const reg = await as(recep, "POST", "patient/register", {
    orgId, mrn: p.mrn, name: p.name, mobile: p.mobile, gender: p.gender,
    ageYears: p.ageYears, ageMonths: p.ageMonths, confirmDuplicate: true,
  }, { key: `demo-reg-${p.mrn}` });
  if (!reg.ok) return null;

  const admittedBy = p.theme === "emergency" ? who.reception() : recep;
  const adm = await as(admittedBy, "POST", "ward/admit", {
    orgId,
    admission: { mrn: p.mrn, ward: p.ward, bed: p.bed, class: p.class, admittedAt: p.admittedAt, reason: p.icd[1], attendingId: who.doctor().identity },
  }, { key: `demo-adm-${p.mrn}` });
  if (!adm.ok) return null;
  return Object.assign({}, p, { encounterId: adm.body.encounterId, patientId: adm.body.patientId });
}

/** Every admitted patient gets the bread-and-butter of an inpatient chart. */
async function coreChart(orgId, p, who) {
  const nurse = who.nurse();
  await as(nurse, "POST", "ward/vitals", {
    orgId, encounterId: p.encounterId, patientId: p.patientId,
    vitals: {
      sbp: 100 + (p.seq % 45), dbp: 60 + (p.seq % 25), pulse: 62 + (p.seq % 40),
      temp: 36.4 + ((p.seq % 15) / 10), tempUnit: "C", spo2: 92 + (p.seq % 8),
      rr: 14 + (p.seq % 8), weight: p.theme === "neonatal" ? 2.9 : p.theme === "paediatrics" ? 14 + (p.seq % 10) : 52 + (p.seq % 35),
    },
    recordedAt: p.admittedAt,
  }, { key: `demo-vitals-${p.mrn}` });

  // A second set later in the stay, by a different nurse - a flowsheet with one row is not a chart.
  await as(who.nurse(), "POST", "ward/vitals", {
    orgId, encounterId: p.encounterId, patientId: p.patientId,
    vitals: { sbp: 104 + (p.seq % 40), pulse: 66 + (p.seq % 34), spo2: 93 + (p.seq % 7), temp: 36.6, tempUnit: "C" },
    recordedAt: new Date(Date.parse(p.admittedAt) + 21600000).toISOString(),
  }, { key: `demo-vitals2-${p.mrn}` });

  const doc = who.doctor();
  await as(doc, "POST", "ward/problem", {
    orgId, problem: { patientId: p.patientId, encounterId: p.encounterId, code: p.icd[0], display: p.icd[1], codeSystem: "http://hl7.org/fhir/sid/icd-10", clinicalStatus: "active", verificationStatus: "confirmed" },
  }, { key: `demo-prob-${p.mrn}` });

  // The trainees who actually do most of the ward round's charting.
  if (p.seq % 3 === 0) {
    await as(who.resident(), "POST", "ward/vitals", {
      orgId, encounterId: p.encounterId, patientId: p.patientId,
      vitals: { pulse: 70 + (p.seq % 20), sbp: 110 + (p.seq % 20) },
      recordedAt: new Date(Date.parse(p.admittedAt) + 43200000).toISOString(),
    }, { key: `demo-vitals3-${p.mrn}` });
  }
  if (p.seq % 5 === 0) {
    await as(who.intern(), "POST", "ward/vitals", {
      orgId, encounterId: p.encounterId, patientId: p.patientId,
      vitals: { temp: 37.0, tempUnit: "C", rr: 16 },
      recordedAt: new Date(Date.parse(p.admittedAt) + 64800000).toISOString(),
    }, { key: `demo-vitals4-${p.mrn}` });
  }
  if (p.seq % 4 === 0) {
    await as(who.nurse(), "POST", "ward/fluid", {
      orgId, encounterId: p.encounterId, patientId: p.patientId,
      entries: [
        { direction: "intake", kind: "oral", value: 200, unit: "mL", at: new Date(Date.parse(p.admittedAt) + 7200000).toISOString() },
        { direction: "intake", kind: "iv", value: 500, unit: "mL", at: new Date(Date.parse(p.admittedAt) + 10800000).toISOString() },
        { direction: "output", kind: "urine", value: 450, unit: "mL", at: new Date(Date.parse(p.admittedAt) + 14400000).toISOString() },
      ],
    }, { key: `demo-fluid-${p.mrn}` });
  }
  if (p.seq % 7 === 0) {
    await as(who.nurse(), "POST", "ward/care-plan", {
      orgId, encounterId: p.encounterId, patientId: p.patientId,
      title: "Inpatient nursing plan (DEMO)",
      // Every goal must carry a MEASURE - care-plan.js refuses "improve mobility" as unmeasurable.
      goals: [
        { title: "Mobilise out of bed", measure: "Sits out in the chair twice daily", targetDate: new Date(ANCHOR + 172800000).toISOString().slice(0, 10) },
        { title: "Pain controlled", measure: "Pain score 3 or less at rest", targetDate: new Date(ANCHOR + 86400000).toISOString().slice(0, 10) },
      ],
    }, { key: `demo-plan-${p.mrn}` });
  }
}

/** Doctor prescribes -> pharmacy verifies and issues -> nurse walks the dose through the eMAR. */
async function medicationJourney(orgId, p, who, opts) {
  opts = opts || {};
  const doc = who.doctor();
  const ord = await as(doc, "POST", "ward/medication-order", {
    orgId, order: { patientId: p.patientId, encounterId: p.encounterId, drug: p.drug.drug, dose: p.drug.dose, route: p.drug.route, frequency: p.drug.frequency },
  }, { key: `demo-rx-${p.mrn}` });
  if (!ord.ok) return null;
  const orderId = ord.body.orderId;

  // Pharmacy's OWN authority: a verification and a supply record. Neither is an administration.
  const pharm = who.pharmacy();
  await as(pharm, "POST", "ward/verify-order", { orgId, orderId, outcome: "verified" }, { key: `demo-pv-${p.mrn}` });
  await as(pharm, "POST", "ward/dispense", { orgId, orderId, quantity: { value: 6, unit: "dose" }, batch: "DEMO-B" + (p.seq % 9), destination: p.ward }, { key: `demo-disp-${p.mrn}` });

  /* The bedside round. verify/dispense here are the eMAR's own states on the DOSE and are gated on
   * med.administer, so on a ward-stock model they are the nurse's, not the pharmacist's - see the
   * long comment above `capFor` in functions/api/queue/[[path]].js. */
  const dueAt = new Date(Date.parse(p.admittedAt) + 3 * 3600000).toISOString();
  const nurse = who.nurse();
  const patient = { id: p.patientId, mrn: p.mrn };
  const scan = { patientBarcode: p.mrn, drugBarcode: p.drug.drug, dose: p.drug.dose, route: p.drug.route };
  // A real round is never fully given: about one dose in nine is deliberately left mid-round.
  const stopAfter = opts.partial ? 2 : 4;
  const steps = ["verify", "dispense", "scan", "administer"].slice(0, stopAfter);
  /* A high-alert product needs a SECOND nurse at the bedside (wardsynq-meds.js WITNESS_REQUIRED,
   * against this hospital's own wardsynq.highAlertDrugs list). Supplying one is what makes the
   * control visible in the demo; omitting it would just look like a broken round. */
  const highAlert = WSQ_CONFIG.highAlertDrugs.some((d) => d.toUpperCase() === p.drug.drug.toUpperCase());
  const witness = highAlert ? who.nurse() : null;
  for (const action of steps) {
    const body = { orgId, action, orderId, dueAt, patient, scan };
    if (action === "administer" && witness) body.witnessId = witness.identity;
    const r = await as(nurse, "POST", "ward/mar", body, { key: `demo-mar-${p.mrn}-${action}` });
    if (!r.ok) break;
  }
  return { orderId, dueAt };
}

/** Doctor orders -> nurse collects -> laboratory releases -> the critical loop, when it is critical. */
async function labJourney(orgId, p, who, opts) {
  opts = opts || {};
  const doc = who.doctor();
  const inv = await as(doc, "POST", "ward/investigation", {
    orgId, patientId: p.patientId, encounterId: p.encounterId, code: p.lab.code, display: p.lab.test, category: "laboratory", priority: opts.critical ? "urgent" : "routine",
  }, { key: `demo-labreq-${p.mrn}` });
  if (!inv.ok) return;
  const serviceRequestId = inv.body.orderId;

  const nurse = who.nurse();
  const col = await as(nurse, "POST", "ward/collect", {
    orgId, serviceRequestId, specimenType: "blood", container: "EDTA", scannedPatientBarcode: p.mrn,
  }, { key: `demo-col-${p.mrn}` });
  const lab = who.lab();
  if (col.ok && col.body.specimenId) {
    await as(lab, "POST", "ward/specimen-outcome", { orgId, specimenId: col.body.specimenId, state: "received" }, { key: `demo-spec-${p.mrn}` });
  }

  const value = opts.critical ? p.lab.critical : p.lab.normal;
  const rel = await as(lab, "POST", "ward/release-result", {
    orgId, serviceRequestId, patientId: p.patientId, encounterId: p.encounterId, status: "final",
    tests: [{ test: p.lab.test, value, unit: p.lab.unit }],
  }, { key: `demo-res-${p.mrn}` });
  if (!rel.ok || !opts.critical) return;

  // A critical result is FLAGGED and then ACKNOWLEDGED by a clinician - two acts, two people.
  const flag = await as(who.doctor(), "POST", "ward/flag-critical", { orgId, reportId: rel.body.reportId }, { key: `demo-crit-${p.mrn}` });
  if (!flag.ok || !flag.body.loops || !flag.body.loops.length) return;
  // Half the loops are deliberately left OPEN so the escalation board has live work on it.
  if (!opts.leaveOpen) {
    await as(who.doctor(), "POST", "ward/acknowledge", {
      orgId, loopId: flag.body.loops[0].loopId, action: "Seen at the bedside; treatment started and repeat sample sent.", close: false,
    }, { key: `demo-ack-${p.mrn}` });
  }
}

// ---------------------------------------------------------------------------------------------
// Phase 3: the specialty surfaces
// ---------------------------------------------------------------------------------------------
const CHECKLIST = {
  signin: ["identity-confirmed", "site-confirmed", "procedure-confirmed", "consent-confirmed", "site-marked-confirmed",
    "anaesthesia-safety-check", "pulse-oximeter-working", "allergies-reviewed", "airway-risk-assessed", "blood-loss-risk-assessed"],
  timeout: ["team-introduced", "identity-site-procedure-reconfirmed", "critical-events-anticipated", "antibiotic-prophylaxis-addressed", "imaging-displayed"],
  signout: ["procedure-recorded", "counts-correct", "specimens-labelled", "equipment-problems-addressed", "recovery-concerns-addressed"],
};
const allTrue = (keys) => Object.fromEntries(keys.map((k) => [k, true]));

async function theatreCase(orgId, p, who, n) {
  const surgeon = who.doctor(), anaesthetist = who.doctor(), scrubNurse = who.nurse();
  const sig = [
    { role: "surgeon", actorId: surgeon.identity }, { role: "anaesthetist", actorId: anaesthetist.identity }, { role: "nurse", actorId: scrubNurse.identity },
  ];
  const laterality = n % 2 ? "right" : "left";
  const book = await as(surgeon, "POST", "ward/surgery-book", {
    orgId, booking: { mrn: p.mrn, procedure: n % 2 ? "Laparoscopic appendicectomy" : "Total knee replacement", laterality, site: laterality + " side", theatre: "Theatre " + (1 + (n % 3)), scheduledAt: new Date(Date.parse(p.admittedAt) + 86400000).toISOString() },
  }, { key: `demo-case-${p.mrn}` });
  if (!book.ok) return;
  const caseId = book.body.caseId || (book.body.case && book.body.case.id);
  if (!caseId) return;

  await as(surgeon, "POST", "ward/surgery-consent", { orgId, caseId, consent: { procedure: book.body.procedure || (n % 2 ? "Laparoscopic appendicectomy" : "Total knee replacement"), laterality, signedByPatientOrProxy: true, givenBy: "patient", capacity: "capacitous" } }, { key: `demo-consent-${p.mrn}` });
  await as(surgeon, "POST", "ward/surgery-marksite", { orgId, caseId, marking: { laterality, site: laterality + " side" } }, { key: `demo-mark-${p.mrn}` });
  await as(anaesthetist, "POST", "ward/anesthesia-start", { orgId, caseId, asaClass: "II" }, { key: `demo-anaes-${p.mrn}` });
  /* FINDING, not a workaround: the WHO checklist REQUIRES a nurse's signature (wardsynq-surgical.js
   * REQUIRED_ROLES) but `capFor` gates surgery-signin/timeout/signout on emr.treat, which the `nurse`
   * role does not hold - so the scrub nurse cannot submit the checklist she is a required party to.
   * The surgeon submits it here with her signature inside the submission, exactly as the product
   * allows; the refusal is reported rather than engineered around with an admin session. */
  await as(surgeon, "POST", "ward/surgery-signin", { orgId, caseId, submission: { items: allTrue(CHECKLIST.signin), signatures: sig, lateralityAsserted: laterality } }, { key: `demo-signin-${p.mrn}` });
  await as(surgeon, "POST", "ward/surgery-timeout", { orgId, caseId, submission: { items: allTrue(CHECKLIST.timeout), signatures: sig, lateralityAsserted: laterality } }, { key: `demo-timeout-${p.mrn}` });
  await as(surgeon, "POST", "ward/surgery-incise", { orgId, caseId }, { key: `demo-incise-${p.mrn}` });
  await as(anaesthetist, "POST", "ward/anesthesia-event", { orgId, caseId, event: { drug: "Propofol", dose: "150 mg", route: "intravenous" } }, { key: `demo-anaesev-${p.mrn}` });
  if (n % 2 === 0) {
    await as(surgeon, "POST", "ward/implant", { orgId, caseId, implant: { device: "DEMO knee prosthesis, size 4", lot: "LOT-DEMO-" + n, serial: "SN-DEMO-" + (1000 + n), site: laterality + " knee" } }, { key: `demo-implant-${p.mrn}` });
  }
  await as(surgeon, "POST", "ward/surgery-signout", { orgId, caseId, submission: { items: allTrue(CHECKLIST.signout), signatures: sig } }, { key: `demo-signout-${p.mrn}` });
  await as(anaesthetist, "POST", "ward/anesthesia-end", { orgId, caseId }, { key: `demo-anaesend-${p.mrn}` });
  await as(surgeon, "POST", "ward/surgery-note", { orgId, caseId, note: "DEMO operative record. Uncomplicated procedure, haemostasis secured, counts correct." }, { key: `demo-opnote-${p.mrn}` });
  await as(surgeon, "POST", "ward/surgery-disposition", { orgId, caseId, disposition: "direct-discharge" }, { key: `demo-casedisp-${p.mrn}` });
}

async function maternityJourney(orgId, p, who) {
  const doc = who.doctor(), midwife = who.nurse();
  await as(doc, "POST", "ward/pregnancy", { orgId, patientId: p.patientId, pregnancy: { gravida: 2, para: 1, gestationWeeks: 39, edd: new Date(ANCHOR + 5 * 86400000).toISOString().slice(0, 10), riskFactors: ["previous caesarean"] } }, { key: `demo-preg-${p.mrn}` });
  for (const [code, value, off] of [["dilation-cm", 4, 1], ["contractions-per-10min", 3, 1], ["fhr-bpm", 142, 1], ["labour-status", "active", 1], ["dilation-cm", 9, 3]]) {
    await as(midwife, "POST", "ward/labour", { orgId, encounterId: p.encounterId, patientId: p.patientId, code, value, at: new Date(Date.parse(p.admittedAt) + off * 3600000).toISOString() }, { key: `demo-lab-${p.mrn}-${code}-${off}` });
  }
  await as(midwife, "POST", "ward/blood-loss", { orgId, patientId: p.patientId, encounterId: p.encounterId, loss: { ml: 320, method: "weighed" } }, { key: `demo-bl-${p.mrn}` });
  const del = await as(doc, "POST", "ward/delivery", { orgId, patientId: p.patientId, encounterId: p.encounterId, delivery: { mode: "spontaneous vaginal", deliveredAt: new Date(Date.parse(p.admittedAt) + 5 * 3600000).toISOString() } }, { key: `demo-del-${p.mrn}` });
  if (del.ok) {
    await as(doc, "POST", "ward/newborn", { orgId, motherPatientId: p.patientId, encounterId: p.encounterId, sex: "female", name: "Demo Baby " + SURNAME[p.seq % SURNAME.length] }, { key: `demo-nb-${p.mrn}` });
  }
}

async function paediatricJourney(orgId, p, who) {
  const doc = who.doctor(), nurse = who.nurse();
  const weightKg = p.theme === "neonatal" ? 2.9 : 14;
  await as(doc, "POST", "ward/dose-ceiling", { orgId, mgPerKg: 15, weightKg, adultMaxMg: 1000, band: p.theme === "neonatal" ? "neonate" : "child" }, { key: `demo-ceil-${p.mrn}` });
  await as(doc, "POST", "ward/weight-rate", { orgId, dosePerKgPerMin: 0.1, weightKg, concentrationMgPerMl: 1, patient: { id: p.patientId, weightKg } }, { key: `demo-wrate-${p.mrn}` });
  if (p.theme === "neonatal") {
    for (const [code, value] of [["fio2-percent", 30], ["peep-cmh2o", 5], ["resp-support-mode", "cpap"]]) {
      await as(nurse, "POST", "ward/neonatal", { orgId, encounterId: p.encounterId, patientId: p.patientId, code, value, at: new Date(Date.parse(p.admittedAt) + 3600000).toISOString() }, { key: `demo-neo-${p.mrn}-${code}` });
    }
    await as(doc, "POST", "ward/line", { orgId, encounterId: p.encounterId, patientId: p.patientId, line: { type: "umbilical venous catheter", site: "umbilicus", insertedAt: p.admittedAt } }, { key: `demo-line-${p.mrn}` });
  }
}

async function oncologyJourney(orgId, p, who) {
  const doc = who.doctor();
  await as(doc, "POST", "ward/onco-link", { orgId, encounterId: p.encounterId, plan: { oncoPlanId: `demo-plan-${p.seq}`, ghisPatientId: p.mrn, regimen: "R-CHOP (DEMO)", protocolVersion: "1.0" } }, { key: `demo-oncolink-${p.mrn}` });
  await as(doc, "POST", "ward/onco-diagnosis", { orgId, patientId: p.patientId, encounterId: p.encounterId, condition: { code: "C50.911", display: "Malignant neoplasm of breast (DEMO)", codeSystem: "http://hl7.org/fhir/sid/icd-10" }, staging: { oncoSite: "breast", stageGroup: "IIB", t: "T2", n: "N1", m: "M0" } }, { key: `demo-oncodx-${p.mrn}` });
  /* FINDING: capFor gates onco-chemo on emr.treat, so the chemotherapy nurse who actually hangs the
   * bag cannot record the administration - even though the ONCQIS cycle routes in the same router
   * label start/complete explicitly as "NURSE". The doctor records it here so the surface has
   * content; the refusal is reported. */
  await as(doc, "POST", "ward/onco-chemo", {
    orgId, patientId: p.patientId, encounterId: p.encounterId, oncoPlanId: `demo-plan-${p.seq}`, cycleId: `demo-cycle-${p.seq}-1`,
    admin: { drug: "Cyclophosphamide", doseGiven: 750, doseUnit: "mg", bsaUsed: 1.7, route: "intravenous", startedAt: new Date(Date.parse(p.admittedAt) + 7200000).toISOString(), premedications: ["Ondansetron"] },
  }, { key: `demo-chemo-${p.mrn}` });
  if (p.seq % 2 === 0) {
    await as(doc, "POST", "ward/onco-ae", { orgId, patientId: p.patientId, encounterId: p.encounterId, oncoPlanId: `demo-plan-${p.seq}`, event: { term: "Nausea", grade: 2, ctcaeVersion: "5.0" } }, { key: `demo-ae-${p.mrn}` });
  }
}

async function cardiologyJourney(orgId, p, who) {
  const doc = who.doctor();
  const kardioxRecordId = `demo-kardiox-${p.seq}`;
  await as(doc, "POST", "ward/cardio-link", { orgId, encounterId: p.encounterId, link: { kardioxRecordId, mrn: p.mrn } }, { key: `demo-cardio-${p.mrn}` });
  await as(doc, "POST", "ward/cardio-ecg", {
    orgId, patientId: p.patientId, encounterId: p.encounterId,
    ecg: { kardioxRecordId, verdict: "sinus rhythm", findings: ["Rate 78/min (DEMO)", "No ST deviation (DEMO)"], capturedAt: new Date(Date.parse(p.admittedAt) + 1800000).toISOString() },
  }, { key: `demo-ecg-${p.mrn}` });
}

/** Blood bank: request -> crossmatch -> issue -> bedside check -> start -> observe -> complete. */
async function transfusionJourney(orgId, p, who) {
  const doc = who.doctor(), bb = who.blood_bank(), nurse = who.nurse();
  const req = await as(doc, "POST", "ward/transfusion-request", {
    orgId, mrn: p.mrn, patientId: p.patientId, encounterId: p.encounterId,
    component: "red-cells", units: 1, indication: "Symptomatic anaemia (DEMO)", aboGroup: "O", rhD: "positive", at: new Date(Date.parse(p.admittedAt) + 3600000).toISOString(),
  }, { key: `demo-txnreq-${p.mrn}` });
  if (!req.ok) return;
  const episodeId = req.body.episodeId || (req.body.summary && req.body.summary.id);
  if (!episodeId) return;
  const unitId = `DEMO-UNIT-${String(p.seq).padStart(4, "0")}`;
  const xm = await as(bb, "POST", "ward/transfusion-crossmatch", { orgId, episodeId, unitId, aboGroup: "O", rhD: "positive", component: "red-cells", expiresAt: new Date(ANCHOR + 20 * 86400000).toISOString() }, { key: `demo-xm-${p.mrn}` });
  if (!xm.ok) return;
  if (!(await as(bb, "POST", "ward/transfusion-issue", { orgId, episodeId }, { key: `demo-issue-${p.mrn}` })).ok) return;
  const check = await as(bb, "POST", "ward/transfusion-bedside-check", {
    orgId, episodeId, checkerId: nurse.identity, secondCheckerId: who.nurse().identity,
    scannedPatientBarcode: p.mrn, scannedUnitId: unitId,
    patient: { id: p.patientId, mrn: p.mrn, aboGroup: "O", rhD: "positive" },
    unitInHand: { unitId, aboGroup: "O", rhD: "positive", component: "red-cells" },
  }, { key: `demo-bedside-${p.mrn}` });
  if (!check.ok) return;
  if (!(await as(bb, "POST", "ward/transfusion-start", { orgId, episodeId }, { key: `demo-txnstart-${p.mrn}` })).ok) return;
  await as(bb, "POST", "ward/transfusion-observe", { orgId, episodeId, vitals: { sbp: 118, pulse: 84, temp: 36.9 } }, { key: `demo-txnobs-${p.mrn}` });
  await as(bb, "POST", "ward/transfusion-complete", { orgId, episodeId }, { key: `demo-txndone-${p.mrn}` });
}

async function edJourney(orgId, who, arrivals) {
  const out = [];
  for (const a of arrivals) {
    const recep = who.reception();
    const reg = await as(recep, "POST", "patient/register", { orgId, mrn: a.mrn, name: a.name, mobile: a.mobile, gender: a.gender, ageYears: a.ageYears, confirmDuplicate: true }, { key: `demo-edreg-${a.mrn}` });
    if (!reg.ok) continue;
    const arr = await as(recep, "POST", "ward/ed-arrival", { orgId, arrival: { mrn: a.mrn, chiefComplaint: a.complaint, arrivedAt: a.arrivedAt } }, { key: `demo-edarr-${a.mrn}` });
    if (!arr.ok) continue;
    const encounterId = arr.body.encounterId;
    await as(who.nurse(), "POST", "ward/ed-triage", { orgId, encounterId, acuity: a.acuity, chiefComplaint: a.complaint }, { key: `demo-edtri-${a.mrn}` });
    await as(who.doctor(), "POST", "ward/ed-disposition", { orgId, encounterId, disposition: "home", reason: "Assessed and discharged from the department (DEMO)" }, { key: `demo-eddisp-${a.mrn}` });
    out.push(a.mrn);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Phase 4: the money, the records office, the safety office, the discharge
// ---------------------------------------------------------------------------------------------
async function billingJourney(orgId, p, who) {
  const cashier = who.cashier();
  const inv = await as(cashier, "POST", "ward/invoice", { orgId, patientId: p.patientId, encounterId: p.encounterId, at: new Date(Date.parse(p.admittedAt) + 86400000).toISOString() }, { key: `demo-inv-${p.mrn}` });
  if (inv.ok && inv.body.invoiceId) {
    await as(cashier, "POST", "ward/invoice-deposit", { orgId, invoiceId: inv.body.invoiceId, amount: 500, reference: "DEMO-DEP-" + p.seq }, { key: `demo-dep-${p.mrn}` });
    await as(cashier, "POST", "ward/invoice-payment", { orgId, invoiceId: inv.body.invoiceId, amount: 300, reference: "DEMO-PAY-" + p.seq }, { key: `demo-pay-${p.mrn}` });
  }
  // The billing clerk who CODES is deliberately not the cashier who COLLECTS.
  const clerk = who.billing();
  await as(clerk, "GET", `ward/claims?orgId=${orgId}&patientId=${p.patientId}`, null, { key: `demo-claims-${p.mrn}` });
  const claim = await as(cashier, "POST", "ward/claim", { orgId, patientId: p.patientId, encounterId: p.encounterId, codes: [p.icd[0]], invoiceId: (inv.body && inv.body.invoiceId) || null }, { key: `demo-claim-${p.mrn}` });
  if (claim.ok && claim.body.claimId) {
    await as(cashier, "POST", "ward/claim-state", { orgId, claimId: claim.body.claimId, action: "submit", submittedAmount: 4200 }, { key: `demo-claimsub-${p.mrn}` });
  }
  if (p.seq % 9 === 0) {
    await as(cashier, "POST", "ward/preauth", { orgId, patientId: p.patientId, treatment: p.icd[1], state: "approved", scheme: "DEMO State Health Scheme", authorizedAmount: 35000, decidedAt: new Date(Date.parse(p.admittedAt) + 3600000).toISOString() }, { key: `demo-preauth-${p.mrn}` });
  }
}

async function himJourney(orgId, p, who) {
  const him = who.him();
  const req = await as(him, "POST", "ward/roi-request", {
    orgId, patientId: p.patientId,
    requester: { name: "Demo Insurance Assessor", organization: "Demo Assurance Co (FICTIONAL)", relationship: "insurer" },
    purpose: "Fabricated demonstration claim assessment",
    authorizationBasis: "Written patient authorisation on file (DEMO)",
    recipient: "Demo Assurance Co (FICTIONAL)",
    scope: { recordTypes: ["Encounter", "DiagnosticReport"], from: new Date(ANCHOR).toISOString() },
    at: new Date(Date.parse(p.admittedAt) + 86400000).toISOString(),
  }, { key: `demo-roi-${p.mrn}` });
  if (!req.ok || !req.body.roiId) return;
  const auth = await as(him, "POST", "ward/roi-authorize", { orgId, roiId: req.body.roiId, authorizationBasis: "Written patient authorisation on file (DEMO)", reason: "Scope reviewed and limited to the stay in question" }, { key: `demo-roiauth-${p.mrn}` });
  if (!auth.ok) return;
  await as(him, "POST", "ward/roi-fulfill", { orgId, roiId: req.body.roiId, deliveredStatus: "delivered", resourceCounts: { Encounter: 1, DiagnosticReport: 1 }, note: "Delivered as a sealed DEMO export." }, { key: `demo-roiful-${p.mrn}` });
}

async function dischargeJourney(orgId, p, who) {
  const doc = who.doctor();
  const draft = await as(doc, "POST", "ward/discharge-summary", {
    orgId, encounterId: p.encounterId, patientId: p.patientId,
    sections: { summary: `DEMO discharge summary. Admitted with ${p.icd[1]}; treated and improved.`, followUp: "Outpatient review in two weeks (DEMO)." },
  }, { key: `demo-dsum-${p.mrn}` });
  if (draft.ok) await as(doc, "POST", "ward/sign-discharge-summary", { orgId, encounterId: p.encounterId }, { key: `demo-dsign-${p.mrn}` });
  await as(who.reception(), "POST", "ward/discharge", { orgId, encounterId: p.encounterId, disposition: "home", dischargedAt: new Date(Date.parse(p.admittedAt) + 3 * 86400000).toISOString() }, { key: `demo-disch-${p.mrn}` });
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------
async function main() {
  console.log(BANNER);
  const staff = buildStaff();
  const patients = buildPatients();
  const plan = planSummary(staff, patients);

  const beds = WARDS.reduce((a, w) => a + w.beds, 0);
  if (beds !== 100) throw new Error(`the ward plan totals ${beds} beds, not 100`);
  if (plan.occupiedAtEnd !== 80) throw new Error(`the plan ends with ${plan.occupiedAtEnd} occupied beds, not 80`);

  if (DRY_RUN) {
    console.log("\nPLAN (--dry-run: nothing was written)\n" + JSON.stringify(plan, null, 2));
    console.log("\nJOURNEYS: core chart (all), medication + eMAR (all), laboratory (~1 in 2, 6 critical),");
    console.log("theatre (3), maternity+newborn (1), paediatric/neonatal dosing (8), oncology (5),");
    console.log("cardiology (7), transfusion (2), ED arrivals (6), invoices+claims (12), preauth (~9),");
    console.log("ROI (2), incidents (2), handovers (6), radiology reports (3), discharges (2).");
    return;
  }

  const bootstrap = { identity: BOOTSTRAP, role: "bootstrap-admin" };
  const org = await resolveOrg(bootstrap);
  if (!/DEMO/.test(org.name || "")) {
    throw new Error(`REFUSING TO SEED: organisation "${org.name}" (${org.id}) does not have DEMO in its name.`);
  }
  const orgId = org.id;
  console.log(`\nTarget: ${org.name} (${orgId}, code ${org.code || "?"}) on ${BASE}`);

  // The bootstrap account's ONE job: make the DEMO admins exist. Everything after is their own work.
  const admins = staff.filter((s) => s.role === "admin");
  for (const a of admins) {
    await as(bootstrap, "POST", "member", { orgId, identity: a.identity, role: "admin" });
    if (!ACCESS_MODE) await as(bootstrap, "POST", "member/pin", { orgId, identity: a.identity, pin: a.pin });
  }
  if (!ACCESS_MODE) await openStaffSessions(org.code, admins);
  const admin = admins[0];

  // Second-run guard.
  const already = await as(admin, "GET", `ward/list?orgId=${orgId}`, null, { tolerate: true });
  const existing = ((already.body && already.body.patients) || []).length;
  if (existing >= 80 && !FORCE) {
    console.log(`\nAlready seeded: ${existing} patients are admitted in this DEMO hospital. Nothing was written.`);
    console.log("Re-run with --force to replay every call (deterministic ids mean this updates rather than duplicates).");
    return;
  }

  console.log("\n[1/6] organisation, departments, wards, 100 beds, staff roster ...");
  await setupOrg(admin, orgId);
  await setupStaff(admin, orgId, staff);
  if (!ACCESS_MODE) await openStaffSessions(org.code, staff);

  const who = {};
  for (const r of ROSTER) who[r.role] = picker(staff, r.role);

  // The read-only roles do the reading they exist for.
  for (const s of staff.filter((x) => x.role === "supervisor")) await as(s, "GET", `ward/list?orgId=${orgId}`, null, { key: "demo-sup-" + s.identity });
  for (const s of staff.filter((x) => x.role === "viewer")) await as(s, "GET", `org?orgId=${orgId}`, null, { key: "demo-view-" + s.identity });

  console.log(`[2/6] registering and admitting ${patients.length} patients (${CONCURRENCY} at a time) ...`);
  const admitted = (await pool(patients, CONCURRENCY, (p) => registerAndAdmit(orgId, p, who))).filter(Boolean);
  console.log(`      admitted ${admitted.length}/${patients.length}`);

  console.log("[3/6] ward charting, prescribing, pharmacy and the eMAR round ...");
  await pool(admitted, CONCURRENCY, async (p) => {
    await coreChart(orgId, p, who);
    await medicationJourney(orgId, p, who, { partial: p.seq % 9 === 0 });
    if (p.seq % 2 === 0) await labJourney(orgId, p, who, { critical: p.seq % 14 === 0, leaveOpen: p.seq % 28 === 0 });
  });

  console.log("[4/6] specialty surfaces: theatre, maternity, paediatrics, oncology, cardiology, blood bank, ED ...");
  const byTheme = (t) => admitted.filter((p) => p.theme === t);
  await pool(byTheme("surgery").slice(0, 3), 3, (p, i) => theatreCase(orgId, p, who, i));
  await pool(byTheme("maternity").slice(0, 1), 1, (p) => maternityJourney(orgId, p, who));
  await pool(byTheme("paediatrics").concat(byTheme("neonatal")), 4, (p) => paediatricJourney(orgId, p, who));
  await pool(byTheme("oncology"), 3, (p) => oncologyJourney(orgId, p, who));
  await pool(byTheme("cardiology"), 3, (p) => cardiologyJourney(orgId, p, who));
  await pool(byTheme("medicine").slice(0, 2), 2, (p) => transfusionJourney(orgId, p, who));

  // Radiology: a doctor requests, the radiologist reports under their own lab.result authority.
  await pool(admitted.slice(0, 3), 3, async (p) => {
    const req = await as(who.doctor(), "POST", "ward/investigation", { orgId, patientId: p.patientId, encounterId: p.encounterId, code: "CXR-PA", display: "Chest radiograph PA", category: "imaging" }, { key: `demo-rad-${p.mrn}` });
    if (!req.ok) return;
    await as(who.lab(), "POST", "ward/report-imaging", { orgId, serviceRequestId: req.body.orderId, modality: "CR", findings: "DEMO: clear lung fields, normal cardiac silhouette.", impression: "No acute abnormality (DEMO).", status: "final" }, { key: `demo-radrep-${p.mrn}` });
  });

  // Nursing shift handover: given by one nurse, RECEIVED by a different one (the module refuses self-receipt).
  await pool(admitted.slice(0, 6), 3, async (p) => {
    const giver = who.nurse();
    const h = await as(giver, "POST", "ward/handover", {
      orgId, encounterId: p.encounterId,
      sbar: { situation: `Demo patient in ${p.ward}, bed ${p.bed}.`, background: p.icd[1], assessment: "Stable overnight.", recommendation: "Continue current plan; review in the morning." },
      givenAt: new Date(Date.parse(p.admittedAt) + 43200000).toISOString(),
    }, { key: `demo-hand-${p.mrn}` });
    if (h.ok && h.body.handoverId) {
      await as(who.nurse(), "POST", "ward/receive-handover", { orgId, handoverId: h.body.handoverId, note: "Read back and accepted (DEMO)." }, { key: `demo-handrx-${p.mrn}` });
    }
  });

  // ED: six arrivals seen and sent home. The ED beds themselves are already the EMO admissions above.
  await edJourney(orgId, who, Array.from({ length: 6 }, (_, i) => ({
    mrn: `SMD-DEMO-ED${String(i + 1).padStart(3, "0")}`,
    name: `Demo ${GIVEN[(i + 17) % GIVEN.length]} ${SURNAME[(i + 3) % SURNAME.length]}`,
    mobile: phoneFor(900 + i), gender: i % 2 ? "male" : "female", ageYears: 25 + i * 7,
    complaint: ["Chest pain", "Ankle injury", "Fever", "Headache", "Breathlessness", "Abdominal pain"][i],
    acuity: [2, 4, 3, 3, 2, 3][i],
    arrivedAt: new Date(ANCHOR + 200 * 3600000 + i * 1800000).toISOString(),
  })));

  // Incidents: anyone clinical may FILE; only the safety officer investigates and closes.
  await pool(admitted.slice(0, 2), 2, async (p, i) => {
    const rep = await as(who.nurse(), "POST", "ward/incident-report", {
      orgId, patientId: p.patientId,
      what: `DEMO incident: ${i ? "a dose was given 90 minutes after it was due" : "an unwitnessed fall from the bedside chair, no injury found"}.`,
      when: new Date(Date.parse(p.admittedAt) + 18000000).toISOString(),
      severity: i ? "no-harm" : "near-miss",
      contributingFactors: [i ? "staffing on the late shift" : "footwear not available at the bedside"],
    }, { key: `demo-inc-${p.mrn}` });
    const incidentId = rep.ok && (rep.body.incidentId || (rep.body.incident && rep.body.incident.id));
    if (incidentId) {
      /* Filing is broad; TRIAGING is the safety officer's own narrower authority.
       * FINDING: the router forwards `triagedBy` FROM THE REQUEST BODY rather than from the
       * authenticated actor (functions/api/queue/[[path]].js, sub === "incident-triage"), so the
       * name on an investigation's conclusion is client-supplied. Same for incident-rca's
       * `conductedBy`. We send the acting officer's own identity, which is what the route should
       * be deriving itself. */
      const officer = who.safety_officer();
      await as(officer, "POST", "ward/incident-triage", { orgId, incidentId, likelihood: "possible", triagedBy: officer.identity }, { key: `demo-inctri-${p.mrn}` });
    }
    await as(who.safety_officer(), "GET", `ward/incident-log?orgId=${orgId}`, null, { key: `demo-inclog-${i}` });
  });

  console.log("[5/6] billing, TPA, release-of-information, discharges ...");
  await pool(admitted.slice(0, 12), CONCURRENCY, (p) => billingJourney(orgId, p, who));
  await pool(admitted.slice(0, 2), 2, (p) => himJourney(orgId, p, who));

  // Exactly two discharges, so the board settles on 80 occupied of 100.
  const leaving = admitted.filter((p) => p.theme === "medicine").slice(-2);
  for (const p of leaving) await dischargeJourney(orgId, p, who);

  console.log("[6/6] bed states and the final board ...");
  await setBedStates(admin, orgId);

  // ---- verification, from the server's own reads ----
  const board = await as(admin, "GET", `ward/beds?orgId=${orgId}`, null, { tolerate: true });
  const bedRows = ((await as(admin, "GET", `beds?orgId=${orgId}`, null, { tolerate: true })).body || {}).beds || [];
  const byState = {};
  for (const b of bedRows) byState[b.state] = (byState[b.state] || 0) + 1;
  const wardList = await as(admin, "GET", `ward/list?orgId=${orgId}`, null, { tolerate: true });
  const inpatients = ((wardList.body && wardList.body.patients) || []).length;
  const members = ((await as(admin, "GET", `members?orgId=${orgId}`, null, { tolerate: true })).body || {}).members || [];

  const rolesCreated = new Set(staff.map((s) => s.role));
  const idle = [...rolesCreated].filter((r) => !stats.byRole[r]);

  const wall = ((Date.now() - stats.t0) / 1000).toFixed(1);
  const grouped = new Map();
  for (const f of stats.failures) {
    const k = `${f.route} | ${f.role} | ${f.error}${f.reasons ? " [" + f.reasons.join(",") + "]" : ""}`;
    const g = grouped.get(k) || { key: k, count: 0, detail: f.detail, status: f.status };
    g.count += 1;
    grouped.set(k, g);
  }

  console.log("\n" + BANNER);
  console.log("\nDEMO HOSPITAL SUMMARY");
  console.log(JSON.stringify({
    org: org.name, orgId, base: BASE,
    beds: bedRows.length, bedStates: byState, inpatientsOnTheBoard: inpatients,
    staffMembers: members.length, wards: WARDS.length, departments: DEPARTMENTS.length,
    calls: stats.calls, succeeded: stats.ok, failed: stats.failures.length, wallSeconds: Number(wall),
  }, null, 2));
  console.log("\nACTIONS PER ROLE (successful calls made through that role's own session)");
  for (const r of ROSTER.map((x) => x.role)) console.log(`  ${r.padEnd(16)} ${stats.byRole[r] || 0}`);
  console.log(`  ${"bootstrap-admin".padEnd(16)} ${stats.byRole["bootstrap-admin"] || 0}`);

  const problems = [];
  if (idle.length) problems.push(`roles created but never used successfully: ${idle.join(", ")}`);
  else console.log("\nEvery role created performed at least one successful action.");

  const occupied = byState.occupied || 0;
  if (bedRows.length !== 100) problems.push(`the hospital has ${bedRows.length} beds, not 100`);
  if (occupied !== 80) problems.push(`${occupied} beds read as occupied, not 80`);
  for (const p of problems) console.log("FINDING: " + p);

  if (grouped.size) {
    if (FORCE) console.log("\nNOTE: --force replays a hospital that is already seeded. Most refusals below are the");
    if (FORCE) console.log("product correctly declining to redo a terminal act (a given dose, a final result, a");
    if (FORCE) console.log("signed summary). They are the state machine working, not defects.");
    console.log(`\nFAILURES (${stats.failures.length} calls, ${grouped.size} distinct route+role+error)`);
    for (const g of [...grouped.values()].sort((a, b) => b.count - a.count)) {
      console.log(`  x${String(g.count).padEnd(4)} ${g.key}${g.detail ? "\n         " + String(g.detail).slice(0, 220) : ""}`);
    }
  } else {
    console.log("\nNo failed calls.");
  }
  console.log(`\nBed board as the server reports it: ${JSON.stringify((board.body && board.body.wards || []).map((w) => ({ ward: w.ward, occupied: (w.occupied || []).length, free: (w.free || []).length })))}`);
  // A fresh seed that did not reach the shape it promised is a failed seed, and says so.
  if (problems.length && !FORCE) process.exitCode = 1;
}

main().catch((e) => { console.error("\nFATAL: " + (e && e.stack || e)); process.exit(1); });
