/* test/wardsynq-preadmission-intake.test.mjs - R3-3 pre-admission intake: a patient with a planned admission answers the
 * hospital's patient form on the portal; staff read it and accept it as reviewed, or return it with a reason.
 *
 * Routes driven: POST /api/portal/intake-forms, POST /api/portal/intake-submit, GET /api/queue/ward/intake-responses,
 * POST /api/queue/ward/intake-review. The waiting list screen (ward.js) and the portal section (portal.js) are checked
 * for calling them.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-preadmission-intake.test.mjs
 */
import { as, seed, docs, H, ENV, T, ORG_ID, ADMIN, NURSE, CASHIER, DOCTOR, OTHER_ADMIN, writesNow } from "./wardsynq-connectors-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const F = await import("../wardsynq/wardsynq-forms.js");
const R = await import("../functions/_wardsynq/form-response.js");
const PW = await import("../functions/_wardsynq/pathways.js");
const { AccessGrant, hashSecret } = await import("../functions/_wardsynq/patient-access.js");
const { onRequest: portalRouter } = await import("../functions/api/portal/[[path]].js");

const NOW = new Date().toISOString();
const PLANNED = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
let seq = 0;
async function put(rec) { await H.RECORD.append(T, [{ version: 1, ...rec }], { idempotencyKey: "seed-" + (++seq) + "-" + Math.random() }); }
async function grant(id, patientId, proxy) {
  const token = "tok-" + id;
  await put(AccessGrant({ id, patientId, issuedBy: "dr:1", issuedAt: NOW, codeHash: await hashSecret("00000000", id), redeemedAt: NOW, tokenHash: await hashSecret(token, id), proxy: proxy || null }));
  return { grantId: id, token };
}
async function portal(sub, body) {
  const res = await portalRouter({ request: new Request("https://x/api/portal/" + sub, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgId: ORG_ID, ...body }) }), env: ENV, params: { path: [sub] } });
  const j = await res.json().catch(() => ({}));
  j.__status = res.status;
  return j;
}
/* Hospital-authored test definitions, published the way _forms_store.js stores them. No shipped questions. */
function publishDef(def) {
  const pub = F.publish(def, 1, NOW);
  docs.set(`q_form_defs/${ORG_ID}__${def.key}__v1`, { fields: { orgId: ORG_ID, key: def.key, version: 1, status: "published", def: JSON.stringify(pub) }, updateTime: "t1" });
}
const PATIENT_FORM = { key: "pre_admit", title: "Before admission", audience: "patient", sections: [{ title: "About you", fields: [
  { key: "q_one", label: "Question one", type: "text", required: true },
  { key: "q_two", label: "Question two", type: "boolean", required: true },
] }] };
const STAFF_FORM = { key: "nurse_check", title: "Nursing check", sections: [{ title: "Check", fields: [{ key: "done", label: "Done", type: "boolean" }] }] };

async function setup() {
  seed({ patientAccess: { enabled: true } });
  publishDef(PATIENT_FORM); publishDef(STAFF_FORM);
  await put({ resourceType: "Patient", id: "pat-1", mrn: "MRN-1", name: "Test Patient", dob: "1980-01-01" });
  await put({ resourceType: "Patient", id: "pat-2", mrn: "MRN-2", name: "Other Patient", dob: "1980-01-01" });
  await put({ resourceType: "AdmissionRequest", id: "adr-1", patientId: "pat-1", state: "waiting", plannedFor: PLANNED, reason: "planned", urgency: "elective" });
  await put({ resourceType: "AdmissionRequest", id: "adr-2", patientId: "pat-2", state: "waiting", plannedFor: PLANNED, reason: "planned", urgency: "elective" });
  return { me: await grant("g-1", "pat-1"), other: await grant("g-2", "pat-2") };
}
const ANSWERS = { q_one: "reported text", q_two: true };

test("pure: audience is validated, a patient form names no roles, pathways never count a patient's form", () => {
  assert.deepEqual(F.validateDefinition({ ...PATIENT_FORM }), []);
  assert.ok(F.validateDefinition({ ...PATIENT_FORM, audience: "public" }).some((p) => /audience/.test(p)));
  assert.ok(F.validateDefinition({ ...PATIENT_FORM, roles: ["nurse"] }).some((p) => /staff roles/.test(p)));
  assert.equal(F.isPatientForm(STAFF_FORM), false, "absent audience is staff");
  assert.deepEqual(R.plannedAdmissions([{ id: "a", state: "waiting", plannedFor: "2026-10-01" }, { id: "b", state: "waiting" }, { id: "c", state: "admitted", plannedFor: "2026-10-01" }]).map((x) => x.requestId), ["a"]);
  const def = { steps: [{ key: "s", title: "Assessment", kind: "assessment", formKey: "pre_admit" }] };
  const enrolment = { id: "e1", enrolledAt: "2026-09-01T00:00:00Z" };
  const row = { resourceType: "FormResponse", id: "fr", formKey: "pre_admit", completedAt: "2026-09-02T00:00:00Z" };
  const status = (r) => PW.evaluateProgress(def, enrolment, { FormResponse: [r] }, [], Date.parse("2026-09-03T00:00:00Z"))[0].status;
  assert.equal(status(row), "met", "a staff-completed form completes the step");
  assert.equal(status({ ...row, origin: "patient", reviewState: "accepted" }), "pending", "a patient-reported form never does, even once reviewed");
});

test("portal: a planned admission lists only patient forms; a staff form cannot be submitted (403, nothing written)", async () => {
  const { me } = await setup();
  const list = await portal("intake-forms", me);
  assert.equal(list.__status, 200);
  assert.deepEqual(list.admissions.map((a) => a.requestId), ["adr-1"], "only this patient's planned admission");
  assert.deepEqual(list.forms.map((f) => f.key), ["pre_admit"], "a staff form is never listed");
  assert.deepEqual(list.responses, []);
  const before = writesNow();
  const staff = await portal("intake-submit", { ...me, requestId: "adr-1", formKey: "nurse_check", formVersion: 1, answers: { done: true } });
  assert.deepEqual([staff.__status, staff.error], [403, "not_for_patients"]);
  assert.equal(await H.RECORD.latest(T, "FormResponse", R.intakeId("nurse_check", "adr-1")), null);
  assert.ok(writesNow() - before <= 2, "reads are audited; no record is written");
});

test("portal: a failing required field returns every field error and writes nothing", async () => {
  const { me } = await setup();
  const r = await portal("intake-submit", { ...me, requestId: "adr-1", formKey: "pre_admit", formVersion: 1, answers: {} });
  assert.deepEqual([r.__status, r.error], [422, "invalid_response"]);
  assert.deepEqual(Object.keys(r.errors).sort(), ["q_one", "q_two"]);
  assert.equal(await H.RECORD.latest(T, "FormResponse", R.intakeId("pre_admit", "adr-1")), null);
});

test("portal: another patient's admission, no planned date, no session and a proxy without the forms section are refused", async () => {
  const { me, other } = await setup();
  const cross = await portal("intake-submit", { ...me, requestId: "adr-2", formKey: "pre_admit", formVersion: 1, answers: ANSWERS });
  assert.deepEqual([cross.__status, cross.error], [403, "no_planned_admission"]);
  assert.equal(await H.RECORD.latest(T, "FormResponse", R.intakeId("pre_admit", "adr-2")), null);
  await put({ resourceType: "AdmissionRequest", id: "adr-3", patientId: "pat-1", state: "waiting", reason: "no date", urgency: "elective" });
  assert.equal((await portal("intake-submit", { ...me, requestId: "adr-3", formKey: "pre_admit", formVersion: 1, answers: ANSWERS })).__status, 403);
  assert.equal((await portal("intake-forms", { grantId: "g-1", token: "wrong" })).__status, 401);
  assert.equal((await portal("intake-submit", { grantId: "g-1", token: "wrong", requestId: "adr-1", formKey: "pre_admit", formVersion: 1, answers: ANSWERS })).__status, 401);
  await put({ resourceType: "RelatedPerson", id: "rp-1", patientId: "pat-1", name: "Relative" });
  const proxy = await grant("g-p", "pat-1", { relatedPersonId: "rp-1", sections: ["bills"], consentFrom: "patient", consentMethod: "in-person-verbal" });
  assert.equal((await portal("intake-forms", proxy)).__status, 403);
  assert.equal((await portal("intake-submit", { ...proxy, requestId: "adr-1", formKey: "pre_admit", formVersion: 1, answers: ANSWERS })).__status, 403);
  void other;
});

test("the whole loop: submit, resubmit is a new version, staff read it, return needs a reason, accept writes no allergy or medicine", async () => {
  const { me } = await setup();
  const first = await portal("intake-submit", { ...me, requestId: "adr-1", formKey: "pre_admit", formVersion: 1, answers: ANSWERS });
  assert.equal(first.__status, 200);
  assert.deepEqual([first.response.origin, first.response.reviewState, first.response.submittedBy], ["patient", "submitted", "patient:pat-1"]);
  const again = await portal("intake-submit", { ...me, requestId: "adr-1", formKey: "pre_admit", formVersion: 1, answers: { ...ANSWERS, q_one: "corrected" } });
  assert.equal(again.response.version, 2, "a correction is a new version of the same response");
  const id = again.response.responseId;
  const stored = await H.RECORD.latest(T, "FormResponse", id);
  assert.deepEqual(stored.codes, [], "no terminology codes on patient-reported answers");

  const Q = `?orgId=${ORG_ID}&patientId=pat-1&requestId=adr-1`;
  // Negative authorization on the staff routes.
  assert.equal((await as(null, `/ward/intake-responses${Q}`)).__status, 401);
  assert.equal((await as(CASHIER, `/ward/intake-responses${Q}`)).__status, 403);
  assert.equal((await as(OTHER_ADMIN, `/ward/intake-responses${Q}`)).__status, 403);
  const review = { orgId: ORG_ID, responseId: id, version: 2, decision: "accept" };
  const before = writesNow();
  assert.equal((await as(null, "/ward/intake-review", "POST", review)).__status, 401);
  assert.equal((await as(NURSE, "/ward/intake-review", "POST", review)).__status, 403, "reading is not reviewing");
  assert.equal((await as(CASHIER, "/ward/intake-review", "POST", review)).__status, 403);
  assert.equal((await as(OTHER_ADMIN, "/ward/intake-review", "POST", review)).__status, 403);
  assert.equal(writesNow(), before, "a refused review writes nothing");
  assert.equal((await H.RECORD.latest(T, "FormResponse", id)).reviewState, "submitted");

  const seen = await as(NURSE, `/ward/intake-responses${Q}`);
  assert.equal(seen.__status, 200);
  assert.deepEqual(seen.responses.map((x) => [x.responseId, x.answers.q_one, x.reviewState]), [[id, "corrected", "submitted"]]);

  assert.equal((await as(DOCTOR, "/ward/intake-review", "POST", { ...review, decision: "return" })).__status, 422, "returning needs a reason");
  assert.equal((await as(DOCTOR, "/ward/intake-review", "POST", { ...review, version: 1 })).error, "changed_since_read", "the version read must be the current one");
  const back = await as(DOCTOR, "/ward/intake-review", "POST", { ...review, decision: "return", reason: "Please answer question one fully" });
  assert.deepEqual([back.__status, back.response.reviewState], [200, "returned"]);
  const view = await portal("intake-forms", me);
  assert.equal(view.responses[0].reviewReason, "Please answer question one fully", "the patient sees the reason");
  const third = await portal("intake-submit", { ...me, requestId: "adr-1", formKey: "pre_admit", formVersion: 1, answers: ANSWERS });
  assert.deepEqual([third.response.reviewState, third.response.version], ["submitted", 4]);

  const puts = [];
  const orig = H.RECORD.append.bind(H.RECORD);
  H.RECORD.append = async (tenant, rows, opts) => { puts.push(...rows.map((r) => r.resourceType)); return orig(tenant, rows, opts); };
  let ok;
  try { ok = await as(DOCTOR, "/ward/intake-review", "POST", { ...review, version: 4 }); } finally { H.RECORD.append = orig; }
  assert.deepEqual([ok.__status, ok.response.reviewState], [200, "accepted"]);
  assert.match(ok.response.reviewedBy, /^cfa:/, "the named reviewer");
  assert.deepEqual([...new Set(puts)], ["FormResponse"], "accepting writes the response and nothing else");
  for (const t of ["AllergyIntolerance", "MedicationStatement", "MedicationRequest", "Condition"]) assert.equal((await H.RECORD.byPatient(T, t, "pat-1")).length, 0, t);

  const closed = await portal("intake-submit", { ...me, requestId: "adr-1", formKey: "pre_admit", formVersion: 1, answers: ANSWERS });
  assert.deepEqual([closed.__status, closed.error], [409, "already_reviewed"]);
  assert.equal((await as(DOCTOR, "/ward/intake-review", "POST", { ...review, version: 5 })).error, "not_awaiting_review");
});

/* ---- R4-5: forms before a booked appointment, behind wardsynq.intake.forAppointments (off by default) ---------------- */
const APPT_FORM = { key: "before_visit", title: "Before your visit", audience: "patient", forAppointments: true, sections: [{ title: "Visit", fields: [
  { key: "concern", label: "What would you like to discuss", type: "text", required: true }] }] };
const SOON = new Date(Date.now() + 3 * 86400000).toISOString();
async function setupAppointments(intake) {
  seed({ patientAccess: { enabled: true }, ...(intake === undefined ? {} : { intake }) });
  publishDef(PATIENT_FORM); publishDef(STAFF_FORM); publishDef(APPT_FORM);
  await put({ resourceType: "Patient", id: "pat-1", mrn: "MRN-1", name: "Test Patient", dob: "1980-01-01" });
  await put({ resourceType: "Patient", id: "pat-2", mrn: "MRN-2", name: "Other Patient", dob: "1980-01-01" });
  await put({ resourceType: "Appointment", id: "apt-1", patientId: "pat-1", clinicianId: "dr:1", startAt: SOON, minutes: 15, state: "booked" });
  await put({ resourceType: "Appointment", id: "apt-past", patientId: "pat-1", clinicianId: "dr:1", startAt: new Date(Date.now() - 86400000).toISOString(), minutes: 15, state: "booked" });
  await put({ resourceType: "Appointment", id: "apt-2", patientId: "pat-2", clinicianId: "dr:1", startAt: SOON, minutes: 15, state: "booked" });
  return { me: await grant("g-1", "pat-1"), other: await grant("g-2", "pat-2") };
}
const VISIT = { concern: "reported concern" };

test("pure: forAppointments is a patient form's true or false; only an explicit true turns the hospital setting on; only booked future appointments count", () => {
  assert.deepEqual(F.validateDefinition(APPT_FORM), []);
  assert.ok(F.validateDefinition({ ...APPT_FORM, forAppointments: "yes" }).some((p) => /forAppointments/.test(p)));
  assert.ok(F.validateDefinition({ ...STAFF_FORM, forAppointments: true }).some((p) => /only a form for patients/.test(p)));
  assert.deepEqual([R.intakeSettings(undefined), R.intakeSettings({ forAppointments: "true" }), R.intakeSettings({ forAppointments: true })].map((s) => s.forAppointments), [false, false, true]);
  const now = Date.parse("2026-09-17T10:00:00Z");
  assert.deepEqual(R.bookedAppointments([{ id: "a", state: "booked", startAt: "2026-09-18T10:00:00Z" }, { id: "b", state: "cancelled", startAt: "2026-09-18T10:00:00Z" },
    { id: "c", state: "booked", startAt: "2026-09-16T10:00:00Z" }, { id: "d", state: "arrived", startAt: "2026-09-18T10:00:00Z" }], now).map((a) => a.appointmentId), ["a"]);
});

test("POST /api/portal/intake-forms and /intake-submit, setting absent: a patient with a booked appointment and no admission gets no forms, and an appointment submit is 403 with nothing written", async () => {
  const { me } = await setupAppointments();
  const list = await portal("intake-forms", me);
  assert.equal(list.__status, 200);
  assert.deepEqual([list.admissions, list.forms, list.appointments, list.appointmentForms], [[], [], [], []]);
  const before = writesNow();
  const r = await portal("intake-submit", { ...me, appointmentId: "apt-1", formKey: "before_visit", formVersion: 1, answers: VISIT });
  assert.deepEqual([r.__status, r.error], [403, "no_booked_appointment"]);
  assert.ok(writesNow() - before <= 2, "the session check is audited; no record is written");
  assert.equal(await H.RECORD.latest(T, "FormResponse", R.intakeId("before_visit", "apt-1")), null);
  const off = await setupAppointments({ forAppointments: false });
  assert.deepEqual((await portal("intake-forms", off.me)).appointments, []);
  // Turned on through POST /api/queue/org/update (the hospital settings route): now offered.
  const on = await as(ADMIN, "/org/update", "POST", { orgId: ORG_ID, wardsynq: { intake: { forAppointments: true } } });
  assert.equal(on.__status, 200, on.__text);
  assert.deepEqual((await portal("intake-forms", off.me)).appointments.map((a) => a.appointmentId), ["apt-1"]);
});

test("setting on: forms before a booked appointment through the same review; staff forms, forms not marked for appointments, another patient's, past appointments and no session are refused", async () => {
  const { me } = await setupAppointments({ forAppointments: true });
  const list = await portal("intake-forms", me);
  assert.equal(list.__status, 200);
  assert.deepEqual(list.appointments.map((a) => a.appointmentId), ["apt-1"], "only this patient's booked appointment still to come");
  assert.deepEqual(list.appointmentForms.map((f) => f.key), ["before_visit"], "only patient forms marked for appointments");
  assert.deepEqual(list.forms, [], "no planned admission: the admission forms are not offered");

  const refused = async (body, status, error) => {
    const before = writesNow();
    const r = await portal("intake-submit", { ...me, formVersion: 1, answers: VISIT, ...body });
    assert.deepEqual([r.__status, r.error], [status, error], JSON.stringify(body));
    assert.ok(writesNow() - before <= 2, "reads are audited; no record is written");
  };
  await refused({ appointmentId: "apt-1", formKey: "nurse_check", answers: { done: true } }, 403, "not_for_patients");
  await refused({ appointmentId: "apt-1", formKey: "pre_admit", answers: ANSWERS }, 403, "not_for_appointments");
  await refused({ appointmentId: "apt-2", formKey: "before_visit" }, 403, "no_booked_appointment");
  await refused({ appointmentId: "apt-past", formKey: "before_visit" }, 403, "no_booked_appointment");
  assert.equal((await portal("intake-submit", { grantId: "g-1", token: "wrong", appointmentId: "apt-1", formKey: "before_visit", formVersion: 1, answers: VISIT })).__status, 401);
  for (const id of ["apt-1", "apt-2", "apt-past"]) assert.equal(await H.RECORD.latest(T, "FormResponse", R.intakeId("before_visit", id)), null);

  const sent = await portal("intake-submit", { ...me, appointmentId: "apt-1", formKey: "before_visit", formVersion: 1, answers: VISIT });
  assert.equal(sent.__status, 200, JSON.stringify(sent));
  assert.deepEqual([sent.response.origin, sent.response.reviewState, sent.response.appointmentId, sent.response.admissionRequestId], ["patient", "submitted", "apt-1", null]);
  assert.deepEqual((await portal("intake-forms", me)).responses.map((x) => x.appointmentId), ["apt-1"]);

  const Q = `?orgId=${ORG_ID}&patientId=pat-1&appointmentId=apt-1`;
  assert.equal((await as(null, `/ward/intake-responses${Q}`)).__status, 401);
  assert.equal((await as(CASHIER, `/ward/intake-responses${Q}`)).__status, 403);
  assert.equal((await as(OTHER_ADMIN, `/ward/intake-responses${Q}`)).__status, 403);
  const seen = await as(NURSE, `/ward/intake-responses${Q}`);
  assert.deepEqual(seen.responses.map((x) => [x.appointmentId, x.answers.concern]), [["apt-1", "reported concern"]]);
  assert.deepEqual((await as(NURSE, `/ward/intake-responses?orgId=${ORG_ID}&patientId=pat-1&appointmentId=apt-other`)).responses, []);

  const review = { orgId: ORG_ID, responseId: sent.response.responseId, version: 1, decision: "accept" };
  assert.equal((await as(NURSE, "/ward/intake-review", "POST", review)).__status, 403);
  const puts = [];
  const orig = H.RECORD.append.bind(H.RECORD);
  H.RECORD.append = async (tenant, rows, opts) => { puts.push(...rows.map((r) => r.resourceType)); return orig(tenant, rows, opts); };
  let ok;
  try { ok = await as(DOCTOR, "/ward/intake-review", "POST", review); } finally { H.RECORD.append = orig; }
  assert.deepEqual([ok.__status, ok.response.reviewState], [200, "accepted"]);
  assert.deepEqual([...new Set(puts)], ["FormResponse"], "accepting never writes the patient's answers into the chart");
  for (const t of ["AllergyIntolerance", "MedicationStatement", "Condition"]) assert.equal((await H.RECORD.byPatient(T, t, "pat-1")).length, 0, t);
});

test("screens: the waiting list calls both staff routes, the portal calls both portal routes, a failed load is not none", () => {
  const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
  const WARD = read("ward.js"), PORTAL = read("wardsynq/site/portal.js");
  assert.match(WARD, /"\/ward\/intake-responses\?orgId="/);
  assert.match(WARD, /"\/ward\/intake-review"/);
  assert.match(WARD, /plannedFor: val\("wArPlanned"\)/, "the bed request screen can give a planned date");
  assert.match(PORTAL, /post\("intake-forms"/);
  assert.match(PORTAL, /post\("intake-submit"/);
  const window = {};
  vm.runInNewContext(read("wardsynq/site/i18n.js"), { window });
  vm.runInNewContext(PORTAL, { window });
  const P = window.WSQPortal;
  const loading = P.intakeSection(null), failed = P.intakeSection(false);
  assert.match(loading, /role="status"/);
  assert.match(failed, /role="alert"/);
  assert.notEqual(loading, failed);
  assert.match(P.intakeSection({ admissions: [], forms: [], responses: [] }), /hidden/, "no planned admission: nothing offered");
  const d = { admissions: [{ requestId: "adr-1", plannedFor: "2026-10-01" }], forms: [F.publish(PATIENT_FORM, 1, NOW)], responses: [] };
  const open = P.intakeSection(d, { open: "adr-1|pre_admit", answers: {}, errors: { q_one: "Question one is required" } });
  assert.match(open, /not added to your medical record as checked information/);
  assert.match(open, /id="pIf_q_one"/);
  assert.match(open, /Question one is required/);
  const accepted = P.intakeSection({ ...d, responses: [{ admissionRequestId: "adr-1", formKey: "pre_admit", reviewState: "accepted", reviewedAt: NOW, answers: {} }] });
  assert.match(accepted, /data-intake-state="accepted"/);
  assert.doesNotMatch(accepted, /data-act="intake-open"/, "a reviewed form cannot be changed from the portal");
  assert.ok(P.renderRecord({ access: { kind: "patient", sections: ["forms"] }, document: {}, failedSections: [] }).includes('data-section="intake"'));
});

test("ward.js waiting list, rendered: a planned request offers its forms; the panel labels them patient-reported, loading and failed are not none", () => {
  const src = readFileSync(new URL("../ward.js", import.meta.url), "utf8");
  const sandbox = { navigator: { userAgent: "node" }, location: { hash: "", href: "" },
    document: { getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }), addEventListener() {}, body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} }, fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }), setTimeout, clearTimeout, console, Promise, Date };
  sandbox.window = sandbox; sandbox.self = sandbox;
  vm.createContext(sandbox); vm.runInContext(src, sandbox);
  const W = sandbox.window.WARD;
  const req = { requestId: "adr-1", patientId: "pat-1", mrn: "MRN-1", reason: "planned", urgency: "elective", state: "waiting", requestedBy: "dr", requestedAt: NOW, waitingHours: 1, plannedFor: "2026-10-01" };
  const view = (intake) => W._render({ ...W._st, view: "admreqs", admReqs: { ok: true, requests: [req, { ...req, requestId: "adr-2", plannedFor: null }] }, intake });
  const plain = view(null);
  assert.ok(plain.includes('data-w-act="intakeopen:adr-1~pat-1"'));
  assert.ok(!plain.includes("intakeopen:adr-2"), "no planned date, no forms to review");
  assert.ok(plain.includes('id="wArPlanned"'));
  assert.match(view({ requestId: "adr-1", patientId: "pat-1", rows: null }), /Loading/);
  const failed = view({ requestId: "adr-1", patientId: "pat-1", rows: false });
  assert.match(failed, /Do not read this as none sent/);
  assert.doesNotMatch(failed, /has not sent a pre-admission form/);
  const row = { responseId: "wsq-intake-x", formTitle: "Before admission", formVersion: 1, answers: { q_one: "text" }, reviewState: "submitted", submittedBy: "patient:pat-1", submittedAt: NOW, version: 2 };
  const open = view({ requestId: "adr-1", patientId: "pat-1", rows: [row] });
  assert.match(open, /Reported by the patient or their family on the portal, not checked/);
  assert.ok(open.includes('data-w-act="intakereview:wsq-intake-x~2~accept"'), "the review names the version shown");
  assert.ok(open.includes('data-w-act="intakereview:wsq-intake-x~2~return"'));
  const done = view({ requestId: "adr-1", patientId: "pat-1", rows: [{ ...row, reviewState: "accepted", reviewedBy: "dr.x", reviewedAt: NOW }] });
  assert.ok(!done.includes("intakereview:"), "a reviewed form offers no second review");
  assert.match(done, /Reviewed by dr\.x/);
});
