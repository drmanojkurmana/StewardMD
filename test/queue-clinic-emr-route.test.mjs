/* test/queue-clinic-emr-route.test.mjs — which EMR an OPD ticket opens in.
 *
 * REGRESSION (reported 2026-08-24): in a PERSONAL CLINIC, adding a patient and tapping Start bounced the
 * doctor to the GIMSR / Ward Sync sign-in instead of opening the assessment.
 *
 * Cause: openAssessment branched on `t.ghisPatientId` alone. openAdd() asks for an "MR number" in EVERY
 * workplace and the server stores whatever is typed as ghisPatientId (functions/_queue_engine.js), so a
 * clinic patient with the clinic's own file number took the hospital branch. That branch passed NO
 * `source`, so opd-emr defaulted to "ghis" and called GHIS.ensureSession(), which -- finding no token,
 * because a clinic session nulls it by invariant -- opened the Ward Sync hospital picker and RETURNED,
 * so the assessment never opened. A blank MRN happened to work, hence "sometimes".
 *
 * The rule under test: the WORKPLACE decides, never the presence of an MR number.
 * node --test test/queue-clinic-emr-route.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const SRC = readFileSync(new URL("../queue.js", import.meta.url), "utf8");

// Load queue.js with a fake window, capturing every OPDEMR.openProfile call.
function load(stPatch, noClinic) {
  const opened = [];
  const store = {
    addPatient: () => "p1",
    getPatient: () => ({ mrn: "SMD-ABC-001" }),
    listPatients: () => [],
    localStore: { getConsult: () => ({}), saveConsult: () => {} }
  };
  const win = {
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    addEventListener: () => {},

    OPDEMR: { openProfile: (o) => opened.push(o) },
    GHIS: { ensureSession: () => Promise.resolve(false), getToken: () => "" },
    toast: () => {}
  };
  const doc = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ classList: { add() {}, remove() {} }, style: {} }),
    body: { appendChild() {} },
    addEventListener: () => {}
  };
  if (!noClinic) win.SMD_CLINIC = store;
  try { new Function("window", "document", "location", SRC)(win, doc, { search: "" }); } catch (e) {}
  const Q = win.QUEUE;
  Object.assign(Q._st, {
    session: { id: "s1", doctorName: "Dr Asha" },
    me: { name: "Dr Asha" },
    tickets: [{ id: "t1", name: "Ramesh", ghisPatientId: "" }],
    ghisToken: null,
    orgId: null
  }, stPatch || {});
  return { Q, opened };
}

// The reported scenario: personal clinic (orgId set by loadRoom, no GHIS token), patient added WITH an
// MR number typed into the "GHIS MR number" prompt.
const CLINIC = { orgId: "org_clinic_1", ghisToken: null, tickets: [{ id: "t1", name: "Ramesh", ghisPatientId: "12345" }] };

test("REGRESSION: clinic patient WITH an MR number opens the LOCAL record, not GHIS", () => {
  const { Q, opened } = load(CLINIC);
  Q._st.tickets = CLINIC.tickets;
  Q._openTicketEmr("t1", "assess");
  assert.equal(opened.length, 1, "the assessment must actually open");
  assert.equal(opened[0].source, "local", "must be the on-device clinic record, never the hospital one");
  assert.equal(opened[0].tab, "assess");
  assert.ok(opened[0].localStore, "the local store must be handed over so the consult can be saved");
  assert.notEqual(opened[0].patientId, "12345", "the typed MR number is NOT a GHIS patient id");
});

test("clinic patient with a BLANK MR number still opens the local record (unchanged)", () => {
  const { Q, opened } = load({ orgId: "org_clinic_1", ghisToken: null });
  Q._openTicketEmr("t1", "assess");
  assert.equal(opened.length, 1);
  assert.equal(opened[0].source, "local");
});

test("hospital workplace with a real MRN still opens the GHIS record (no regression)", () => {
  const { Q, opened } = load({ orgId: null, ghisToken: "ghis-token",
    tickets: [{ id: "t1", name: "Ramesh", ghisPatientId: "MRN-99", ghisEpisodeId: "ep7", visitId: "v7" }] });
  Q._openTicketEmr("t1", "assess");
  assert.equal(opened.length, 1);
  assert.equal(opened[0].source, undefined, "hospital path leaves source unset -> opd-emr defaults to ghis");
  assert.equal(opened[0].patientId, "MRN-99");
  assert.equal(opened[0].episodeId, "ep7");
});

test("View-profile uses the same routing (it had the identical bug)", () => {
  const { Q, opened } = load(CLINIC);
  Q._st.tickets = CLINIC.tickets;
  Q._openTicketEmr("t1", "");
  assert.equal(opened[0].source, "local");
  assert.equal(opened[0].tab, undefined, "no tab -> profile view");
});

test("no local store on the device -> decision-support only, still never GHIS", () => {
  const { Q, opened } = load(CLINIC, true);
  Q._st.tickets = CLINIC.tickets;
  Q._openTicketEmr("t1", "assess");
  assert.equal(opened.length, 1);
  assert.equal(opened[0].noStore, true, "nothing is saved, but the form still opens");
  assert.notEqual(opened[0].source, "ghis");
});

// 2026-09-06: the NATIVE WardSynQ hospital workplace (org.mode "wardsynq" — WardSynQ itself is the
// EMR/HIS, no GHIS, no on-device clinic store). Reaches openTicketEmr the SAME way a GHIS/Connect
// hospital ticket does (t.ghisPatientId set, not inClinicWorkplace()) — the ONLY difference is
// st.openOpts.source, which must be threaded through as o.source so opd-emr.js does not default to "ghis".
test("WardSynQ-native hospital: o.source is explicitly 'wardsynq', never left to default to ghis", () => {
  const { Q, opened } = load({ orgId: null, ghisToken: null, openOpts: { hospitalId: "org_wsq_1", source: "wardsynq" },
    tickets: [{ id: "t1", name: "Ramesh", ghisPatientId: "SMD-WSQ1-001", ghisEpisodeId: "", visitId: "" }] });
  Q._openTicketEmr("t1", "assess");
  assert.equal(opened.length, 1);
  assert.equal(opened[0].source, "wardsynq", "must not fall through to the ghis default");
  assert.equal(opened[0].patientId, "SMD-WSQ1-001");
  assert.notEqual(opened[0].source, "ghis");
});

test("regression guard: GHIS and Connect hospital sessions still leave o.source unset (untouched)", () => {
  const ghis = load({ orgId: null, ghisToken: "ghis-token", openOpts: {},
    tickets: [{ id: "t1", name: "Ramesh", ghisPatientId: "MRN-99" }] });
  ghis.Q._openTicketEmr("t1", "assess");
  assert.equal(ghis.opened[0].source, undefined);
  const connect = load({ orgId: null, ghisToken: null, openOpts: { hospitalId: "org_c1", source: "connect" },
    tickets: [{ id: "t1", name: "Ramesh", ghisPatientId: "MRN-77" }] });
  connect.Q._openTicketEmr("t1", "assess");
  assert.equal(connect.opened[0].source, undefined, "connect hospitals are unaffected by the wardsynq addition");
});

/* The mechanism, asserted against opd-emr.js itself (unchanged by this fix): an openProfile call with no
 * `source` and no `noStore` goes to GHIS.ensureSession() and, when there is no session, returns WITHOUT
 * opening anything. That is precisely what the old queue routing handed it for a clinic patient. */
test("MECHANISM: openProfile with no source defers to GHIS and opens nothing when there is no session", async () => {
  const EMR = readFileSync(new URL("../opd-emr.js", import.meta.url), "utf8");
  let ensureCalls = 0, painted = 0;
  const el = { classList: { add() { painted++; }, remove() {}, toggle() {} }, addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [], set innerHTML(v) { painted++; }, get innerHTML() { return ""; } };
  const win = {
    localStorage: { getItem: (k) => (k === "smd_opd_emr" ? "1" : null), setItem() {}, removeItem() {} },
    addEventListener() {}, setTimeout, clearTimeout, setInterval, clearInterval,
    SMD_QUEUE_FLAGS: { bool: (k) => k === "smd_opd_emr", on: () => true },
    GHIS: { ensureSession: () => { ensureCalls++; return Promise.resolve(false); }, getToken: () => "", getProxyBase: () => "/api/ghis" },
    fetch: () => Promise.reject(new Error("no network in test")),
    location: { hostname: "localhost" }
  };
  const doc = { getElementById: () => el, querySelector: () => null, querySelectorAll: () => [],
    createElement: () => el, body: { appendChild() {} }, addEventListener() {}, activeElement: null };
  try { new Function("window", "document", "location", "navigator", EMR)(win, doc, win.location, { language: "en" }); } catch (e) {}
  const EMRAPI = win.OPDEMR;
  assert.ok(EMRAPI && EMRAPI.openProfile, "opd-emr loaded");
  EMRAPI.openProfile({ name: "Ramesh", patientId: "12345", tab: "assess", ticketId: "t1", sessionId: "s1" });
  assert.equal(ensureCalls, 1, "no source -> defaults to ghis -> asks Ward Sync for a session");
});
