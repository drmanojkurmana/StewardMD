/* test/wardsynq-record-service.test.mjs — the WardSynQ Clinical Record Service, end to end in process.
 *
 * One file, and it proves the success criterion rather than the modules: two clients, a hospital
 * PC and a phone, each running the UNCHANGED ClinicalStore + GovernedStore over a RemoteBackend,
 * reach the same record through the real route handler with tenancy, identity and RBAC resolved
 * from a mock membership table. No Cloudflare, no network: fetch is the route function.
 *
 * node --test test/wardsynq-record-service.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { handle } from "../functions/api/wardsynq/[[path]].js";
import { MemoryRepository, VersionConflictError, assertRepository } from "../functions/_wardsynq/repository.js";
import { D1Repository } from "../functions/_wardsynq/repository-d1.js";
import { RecordService, actorForMembership, recordPolicy, AuthorityError, MODE } from "../functions/_wardsynq/service.js";
import { grantForRole, roleMapping, aiActorFor, actorFromOpdRole } from "../functions/_wardsynq/actor.js";
import { ROLES, CAPS, can as roleCan } from "../functions/_queue_roles.js";
import { mintStaffSession, verifyStaffSession } from "../functions/_opd_auth.js";
import { vitalsMode, patientIdForTicket, vitalsToObservations, vitalsMigration, recordVitals, VITAL_CODES } from "../functions/_wardsynq/migrate-vitals.js";
import { registrationMigration, patientFromRegistration, sameDemographics, registerPatientRecord } from "../functions/_wardsynq/migrate-registration.js";
import { patientIdForMrn, encounterIdForTicket, noteIdForTicket, serviceRequestIdForTicket, medicationOrderIdForTicket, diagnosticReportIdForTicket } from "../functions/_wardsynq/opd-identity.js";
import { assessmentMigration, sectionsFromAssessment, noteFromAssessment, signedNoteFrom, sameNoteContent, recordAssessment, recordAssessmentSignOff } from "../functions/_wardsynq/migrate-assessment.js";
import { invOrderMigration, orderFromInvestigation, sameOrder, recordInvestigationOrder } from "../functions/_wardsynq/migrate-inv-order.js";
import { prescriptionMigration, orderFromPrescription, samePrescription, recordPrescription } from "../functions/_wardsynq/migrate-prescription.js";
import { resultsMigration, reportFromResult, labReportFromResult, radiologyReportFromResult, sameReport, matchServiceRequest, recordResult } from "../functions/_wardsynq/migrate-results.js";
import { encounterMigration, encounterStatusFor, encounterFromTicket, sameEncounter, recordEncounterSync } from "../functions/_wardsynq/migrate-encounter.js";
import { parseAllergyFreeText, resolveAllergySubstance, sameAllergy, allergyId, recordAllergiesFromAssessment } from "../functions/_wardsynq/migrate-allergy.js";
import { compileRulePack as compileTestRulePack } from "../wardsynq/wardsynq-safety.js";
import { readFileSync } from "node:fs";
import { makeMockDb } from "../functions/_connect/testkit.js";
import { can } from "../functions/_connect/enterprise/rbac.js";

import { ClinicalStore } from "../wardsynq/wardsynq-store.js";
import { RemoteBackend, RemoteConflictError, RemoteRefusedError } from "../wardsynq/wardsynq-store-remote.js";
import { GovernedStore, makeActor, KIND, TIER, GovernanceError } from "../wardsynq/wardsynq-actors.js";
import { Patient, Observation, MedicationOrder, ClinicalNote, ServiceRequest, DiagnosticReport, Encounter, numericValue } from "../wardsynq/wardsynq-model.js";
import { mapSccmBundle, sccmAdapter } from "../wardsynq/adapters/wardsynq-sccm-adapter.js";
import { IntegrationHub } from "../wardsynq/wardsynq-interop.js";
import { bundle as sccmBundle, patient as sccmPatient, observation as sccmObservation, medicationStatement, encounter as sccmEncounter } from "../functions/_connect/canonical/model.js";

/* ------------------------------------------------------------------ a hospital, in memory */

const ENV = { WARDSYNQ_RECORD: "1", OWNER_EMAILS: "operator@example.test" };

function hospital(opts = {}) {
  const repository = new MemoryRepository();
  const db = makeMockDb({
    connect_tenant: [
      { id: "gimsr", name: "GIMSR", status: "active", mode: "sandbox", settings: JSON.stringify(opts.settings || {}) },
      { id: "other-hospital", name: "Other", status: "active", mode: "sandbox", settings: "{}" },
    ],
    connect_membership: [
      { user_id: "fb:dr-menon", tenant_id: "gimsr", role: "clinician" },
      { user_id: "fb:dr-rao", tenant_id: "gimsr", role: "clinician" },
      { user_id: "fb:admin-one", tenant_id: "gimsr", role: "admin" },
      { user_id: "fb:dr-elsewhere", tenant_id: "other-hospital", role: "clinician" },
    ],
  });
  // Identity is decided by a header here, standing in for the verified Firebase token.
  const identifyFn = async (request) => {
    const who = request.headers.get("X-Test-User");
    if (!who) return { guest: true };
    return { id: who, guest: false, email: who === "fb:operator" ? "operator@example.test" : `${who.replace("fb:", "")}@example.test` };
  };
  const claimsFn = async (request) => {
    const reg = request.headers.get("X-Test-RegNo");
    return reg ? { regNo: reg, name: request.headers.get("X-Test-User") } : {};
  };
  // No OPD organisation is linked to these tenants unless a test says so: Connect membership decides.
  const deps = { db, identifyFn, claimsFn, repository, orgForTenant: opts.orgForTenant || null, authorizeOrg: opts.authorizeOrg || null, staffSession: opts.staffSession || null };
  // A fetch that IS the route. Each client passes its own identity header.
  const fetchAs = (user, regNo) => async (url, init) => {
    const headers = new Headers(init && init.headers || {});
    if (user) headers.set("X-Test-User", user);
    if (regNo) headers.set("X-Test-RegNo", regNo);
    return handle(new Request(String(url), { method: (init && init.method) || "GET", headers, body: init && init.body }), ENV, deps);
  };
  return { repository, db, deps, fetchAs };
}

/** A client exactly as a workstation or the phone builds one: store + governed, over the remote backend. */
async function client(h, user, opts = {}) {
  const backend = new RemoteBackend({ tenantId: opts.tenantId || "gimsr", baseUrl: "https://x", fetch: h.fetchAs(user, opts.regNo) });
  const store = new ClinicalStore({ backend });
  await store.open();
  const d = backend.descriptor;
  const actor = makeActor({ id: d.actor.id, kind: KIND.HUMAN, tier: d.actor.tier, display: d.actor.display, credential: d.actor.canSign ? "held-by-server" : null });
  const governed = new GovernedStore({ store });
  return { backend, store, governed, actor, descriptor: d, session: (pid) => governed.session(actor, pid) };
}

/* ------------------------------------------------------------------ the success criterion */

test("a hospital PC and a phone read and write ONE record; a refresh keeps it; a change on one is visible on the other", async () => {
  const h = hospital();
  const pc = await client(h, "fb:dr-menon", { regNo: "AP-12345" });
  const phone = await client(h, "fb:dr-rao");

  assert.equal(pc.descriptor.mode, "system-of-record");
  assert.equal(pc.descriptor.actor.id, "fb:dr-menon");
  assert.equal(pc.descriptor.actor.canSign, true, "a clinician with a registration number can sign");
  assert.equal(phone.descriptor.actor.canSign, false, "one without cannot");

  // The PC admits a patient and records an observation, through its governed session.
  const p = Patient({ id: "pat-1", mrn: "GH-1", name: "Anjali Menon", dob: "1959-02-14", sex: "female" });
  const pcSession = pc.session("pat-1");
  await pcSession.put(p);
  await pcSession.put(Observation({ id: "obs-1", patientId: "pat-1", code: "2823-3", value: 5.4, unit: "mmol/L", category: "laboratory" }));

  // The phone, a different client with a different identity, sees both.
  const seen = await phone.governed.get(phone.actor, "Patient", "pat-1");
  assert.equal(seen.name, "Anjali Menon");
  assert.equal(seen.version, 1);
  assert.equal(seen.writtenBy.id, "fb:dr-menon", "the server stamped the real author, not the client");
  const obs = await phone.governed.byPatient(phone.actor, "Observation", "pat-1");
  assert.equal(obs.length, 1);
  assert.equal(obs[0].value, 5.4);

  // The phone writes; the PC sees it after a "refresh" (a brand new client instance).
  await phone.session("pat-1").put(ClinicalNote({ id: "note-1", patientId: "pat-1", noteType: "progress", sections: { plan: "repeat potassium at 18:00" }, authorId: "fb:dr-rao" }));
  const pcAgain = await client(h, "fb:dr-menon");
  const note = await pcAgain.governed.get(pcAgain.actor, "ClinicalNote", "note-1");
  assert.equal(note.sections.plan, "repeat potassium at 18:00");
  assert.equal(note.writtenBy.id, "fb:dr-rao");

  // The change feed tells the PC what happened since it last looked.
  const feed = await pcAgain.backend.changes(0);
  assert.deepEqual(feed.records.map((r) => `${r.resourceType}/${r.id}@${r.version}`), ["Patient/pat-1@1", "Observation/obs-1@1", "ClinicalNote/note-1@1"]);
  const later = await pcAgain.backend.changes(feed.cursor);
  assert.equal(later.records.length, 0);

  // The whole chart in one call, for the phone opening a patient.
  const chart = await phone.backend.chart("pat-1");
  assert.equal(chart.Patient.length, 1);
  assert.equal(chart.Observation.length, 1);
  assert.equal(chart.ClinicalNote.length, 1);
  assert.equal(chart.MedicationOrder.length, 0);

  // A roster for the workstation.
  const roster = await pc.backend.list("Patient");
  assert.deepEqual(roster.map((r) => r.id), ["pat-1"]);
});

test("append-only: an edit is a new version, history keeps every version, nothing is overwritten", async () => {
  const h = hospital();
  const pc = await client(h, "fb:dr-menon");
  const s = pc.session("pat-2");
  await s.put(Patient({ id: "pat-2", mrn: "GH-2", name: "R Deshpande", dob: "1988-11-02" }));
  const v1 = await s.get("Patient", "pat-2");
  await s.put({ ...v1, name: "Ravi Deshpande" });
  const hist = await s.history("Patient", "pat-2");
  assert.deepEqual(hist.map((v) => [v.version, v.name]), [[1, "R Deshpande"], [2, "Ravi Deshpande"]]);
  assert.equal((await s.get("Patient", "pat-2")).version, 2);
  assert.equal(h.repository._rows.filter((r) => r.id === "pat-2").length, 2, "two rows, no update in place");
});

test("concurrency: two clients editing from the same version cannot both land; the loser gets the current record", async () => {
  const h = hospital();
  const pc = await client(h, "fb:dr-menon");
  const phone = await client(h, "fb:dr-rao");
  await pc.session("pat-3").put(Patient({ id: "pat-3", mrn: "GH-3", name: "Meera Iyer", dob: "2019-06-30" }));

  // Both read version 1.
  const pcCopy = await pc.session("pat-3").get("Patient", "pat-3");
  const phoneCopy = await phone.session("pat-3").get("Patient", "pat-3");
  assert.equal(pcCopy.version, 1); assert.equal(phoneCopy.version, 1);

  // Direct through the route with an explicit expectedVersion, which is what the backend sends.
  const r1 = await h.fetchAs("fb:dr-menon")("https://x/api/wardsynq/gimsr/record", { method: "POST", body: JSON.stringify({ entity: { ...pcCopy, name: "Meera I" }, expectedVersion: 1 }) });
  assert.equal(r1.status, 201);
  const r2 = await h.fetchAs("fb:dr-rao")("https://x/api/wardsynq/gimsr/record", { method: "POST", body: JSON.stringify({ entity: { ...phoneCopy, name: "Meera Iyer-K" }, expectedVersion: 1 }) });
  assert.equal(r2.status, 409);
  const body = await r2.json();
  assert.equal(body.error, "version_conflict");
  assert.equal(body.detail.currentVersion, 2);
  assert.equal(body.detail.current.name, "Meera I", "the loser is handed what actually won");

  // Through the store: the ClinicalStore derives version 2 from a stale read and the backend refuses.
  const stale = new ClinicalStore({ backend: new RemoteBackend({ tenantId: "gimsr", baseUrl: "https://x", fetch: h.fetchAs("fb:dr-rao") }) });
  await stale.open();
  // The race: the store derives version 3 from a read of version 2, and BEFORE it commits another
  // client lands version 3. The commit is refused and the current record comes back with it.
  await assert.rejects(
    stale.transaction(async (tx) => {
      const cur = await tx.get("Patient", "pat-3");
      await tx.put({ ...cur, name: "conflict" });                                                   // staged as version 3
      await pc.session("pat-3").put({ ...(await pc.session("pat-3").get("Patient", "pat-3")), name: "Meera I." });   // lands version 3 first
    }),
    (e) => e instanceof RemoteConflictError && e.current.version === 3 && e.current.name === "Meera I."
  );

  // The repository's own guard, for the race the check cannot see: the same version twice is refused.
  await assert.rejects(h.repository.append("gimsr", [{ resourceType: "Patient", id: "pat-3", version: 3, meta: {} }]), VersionConflictError);
  assert.equal((await h.repository.history("gimsr", "Patient", "pat-3")).length, 3);
});

test("idempotency: a retried write replays the original outcome, it does not make version N+2", async () => {
  const h = hospital();
  const f = h.fetchAs("fb:dr-menon");
  const entity = Patient({ id: "pat-4", mrn: "GH-4", name: "A", dob: "1970-01-01" });
  const send = () => f("https://x/api/wardsynq/gimsr/record", { method: "POST", headers: { "Idempotency-Key": "k-1" }, body: JSON.stringify({ entity }) });
  const a = await send(); assert.equal(a.status, 201);
  const b = await send(); assert.equal(b.status, 200);
  const bb = await b.json();
  assert.equal(bb.replayed, true);
  assert.equal(bb.record.version, 1);
  assert.equal((await h.repository.history("gimsr", "Patient", "pat-4")).length, 1);
});

/* ------------------------------------------------------------------ tenancy, identity, RBAC */

test("tenancy: a clinician of one hospital cannot open, read or write another hospital's record", async () => {
  const h = hospital();
  await (await client(h, "fb:dr-menon")).session("pat-5").put(Patient({ id: "pat-5", mrn: "GH-5", name: "X", dob: "1970-01-01" }));
  // Member of other-hospital asking for gimsr: 403 at open.
  await assert.rejects(client(h, "fb:dr-elsewhere"), (e) => e.code === "FORBIDDEN");
  const r = await h.fetchAs("fb:dr-elsewhere")("https://x/api/wardsynq/gimsr/record/Patient/pat-5");
  assert.equal(r.status, 403);
  // Same id in the other tenant is a different record: nothing leaks by id.
  const other = await client(h, "fb:dr-elsewhere", { tenantId: "other-hospital" });
  assert.equal(await other.governed.get(other.actor, "Patient", "pat-5"), null);
  assert.equal((await other.backend.changes(0)).records.length, 0);
  // Guests are 401, unknown tenants 403, the flag off is 404.
  assert.equal((await h.fetchAs(null)("https://x/api/wardsynq/gimsr")).status, 401);
  assert.equal((await h.fetchAs("fb:dr-menon")("https://x/api/wardsynq/no-such-tenant")).status, 403);
  assert.equal((await handle(new Request("https://x/api/wardsynq/gimsr"), { WARDSYNQ_RECORD: "0" }, h.deps)).status, 404);
});

// 2026-09-07, real-device verification: every write for an org.mode "wardsynq" hospital already
// bypasses the global flag (queue router wsqForcedMigration), so its chart existed in D1 but this
// door answered 404 for it. The read side now mirrors the write side, on the SAME explicit signal.
test("native WardSynQ hospital: org.mode 'wardsynq' opens the read door with the global flag OFF; any other mode stays 404", async () => {
  const OFF = { WARDSYNQ_RECORD: "0" };
  const asDoctor = (h, url) => handle(new Request(url, { headers: { "X-Test-User": "fb:dr-menon" } }), OFF, h.deps);
  const authorizeOrg = async () => ({ ok: true, role: "doctor" });
  const native = hospital({ orgForTenant: async (env, t) => (t.id === "gimsr" ? { id: "org-wsq", name: "WSQ", mode: "wardsynq" } : null), authorizeOrg });
  const r = await asDoctor(native, "https://x/api/wardsynq/gimsr");
  assert.equal(r.status, 200);
  assert.equal((await r.json()).role, "doctor");
  assert.equal((await asDoctor(native, "https://x/api/wardsynq/other-hospital")).status, 404, "a tenant with no wardsynq org is still hidden");
  assert.equal((await asDoctor(native, "https://x/api/wardsynq/health")).status, 404, "existence is still not leaked");
  const connect = hospital({ orgForTenant: async () => ({ id: "org-c", mode: "connect" }), authorizeOrg });
  assert.equal((await asDoctor(connect, "https://x/api/wardsynq/gimsr")).status, 404, "org.mode is the only signal, never inferred");
  const broken = hospital({ orgForTenant: async () => { throw new Error("firestore down"); }, authorizeOrg });
  assert.equal((await asDoctor(broken, "https://x/api/wardsynq/gimsr")).status, 404, "a broken lookup is not native, never a crash");
  // The console's record link on GET /timeline takes the same shortcut for the same org.
  const src = readFileSync(new URL("../functions/api/queue/[[path]].js", import.meta.url), "utf8");
  assert.ok(src.includes('const link = forced && !forced.error ? { tenantId: forced.tenantId } : await recordLinkForOrg('), "timeline GET links a wardsynq org's record without the global flag");
});

test("roles: admin gets no chart (PHI is clinician-only); superadmin can read and cannot write", async () => {
  const h = hospital();
  assert.equal(can("clinician", "record:write"), true);
  assert.equal(can("admin", "record:read"), false);
  assert.equal(can("auditor", "record:read"), false);
  assert.equal((await h.fetchAs("fb:admin-one")("https://x/api/wardsynq/gimsr")).status, 403);

  await (await client(h, "fb:dr-menon")).session("pat-6").put(Patient({ id: "pat-6", mrn: "GH-6", name: "Y", dob: "1970-01-01" }));
  const op = await client(h, "fb:operator");            // OWNER_EMAILS -> superadmin, no membership row
  assert.equal(op.descriptor.role, "superadmin");
  assert.equal(op.descriptor.actor.tier, "read");
  assert.equal((await op.governed.get(op.actor, "Patient", "pat-6")).name, "Y");
  await assert.rejects(op.session("pat-6").put(Patient({ id: "pat-7", mrn: "GH-7", name: "Z", dob: "1970-01-01" })), GovernanceError);
  // And even a client that lies about its tier is refused at the door.
  const r = await h.fetchAs("fb:operator")("https://x/api/wardsynq/gimsr/record", { method: "POST", body: JSON.stringify({ entity: Patient({ id: "pat-7", mrn: "GH-7", name: "Z", dob: "1970-01-01" }) }) });
  assert.equal(r.status, 403);
  assert.equal((await r.json()).error, "governance");
  assert.equal(await h.repository.latest("gimsr", "Patient", "pat-7"), null);
});

test("governance runs on the SERVER: a forged signature and a wrong-chart write are refused whatever the client claimed", async () => {
  const h = hospital();
  const f = h.fetchAs("fb:dr-rao");     // no registration number -> cannot sign
  const forged = MedicationOrder({ id: "rx-1", patientId: "pat-8", drug: "Warfarin", prescriberId: "fb:dr-rao", status: "active", signedBy: "fb:dr-menon" });
  const r = await f("https://x/api/wardsynq/gimsr/record", { method: "POST", body: JSON.stringify({ entity: forged }) });
  assert.equal(r.status, 403);
  assert.deepEqual((await r.json()).reasons.map((x) => x.code), ["SIGNATURE_NOT_OWN"]);
  const own = { ...forged, signedBy: "fb:dr-rao" };
  const r2 = await f("https://x/api/wardsynq/gimsr/record", { method: "POST", body: JSON.stringify({ entity: own }) });
  assert.deepEqual((await r2.json()).reasons.map((x) => x.code), ["NO_CREDENTIAL"]);
  const r3 = await f("https://x/api/wardsynq/gimsr/record", { method: "POST", body: JSON.stringify({ entity: Observation({ id: "o", patientId: "pat-8", code: "x", value: 1 }), activePatientId: "pat-9" }) });
  assert.deepEqual((await r3.json()).reasons.map((x) => x.code), ["WRONG_CHART"]);
  // Denials are audited, and the record is untouched.
  assert.ok(h.repository.audit.some((a) => a.action === "record.denied"));
  assert.equal(await h.repository.latest("gimsr", "MedicationOrder", "rx-1"), null);
  // The credentialed clinician signing as themselves succeeds, through the store and its session.
  const pc = await client(h, "fb:dr-menon", { regNo: "AP-12345" });
  const signed = await pc.session("pat-8").put(MedicationOrder({ id: "rx-2", patientId: "pat-8", drug: "Warfarin", prescriberId: "fb:dr-menon", status: "active", signedBy: "fb:dr-menon" }));
  assert.equal(signed.status, "active");
  assert.equal((await h.repository.latest("gimsr", "MedicationOrder", "rx-2")).writtenBy.id, "fb:dr-menon");
});

/* ------------------------------------------------------------------ audit */

test("every read and write leaves a PHI-free audit row; the write's row lands atomically with the version", async () => {
  const h = hospital();
  const pc = await client(h, "fb:dr-menon");
  await pc.session("pat-10").put(Patient({ id: "pat-10", mrn: "GH-10", name: "Secret Name", dob: "1970-01-01" }));
  await pc.governed.get(pc.actor, "Patient", "pat-10");
  await pc.backend.chart("pat-10");
  const actions = h.repository.audit.map((a) => a.action);
  assert.ok(actions.includes("record.write"));
  assert.ok(actions.filter((a) => a === "record.read").length >= 2);
  for (const a of h.repository.audit) {
    assert.ok(!JSON.stringify(a).includes("Secret Name"), "audit must never carry the record's content");
    assert.equal(a.actor, "fb:dr-menon");
  }
  const w = h.repository.audit.find((a) => a.action === "record.write");
  assert.deepEqual(w.scope, { resourceType: "Patient", id: "pat-10", version: 1, mode: "system-of-record", idempotent: true });
});

/* ------------------------------------------------------------------ the two modes and the connector boundary */

test("integration mode: an external EMR's records cannot be overwritten natively, and it creates the masters", async () => {
  const h = hospital({ settings: { wardsynq: { recordMode: "integration" } } });
  const pc = await client(h, "fb:dr-menon");
  assert.equal(pc.descriptor.mode, "integration");
  assert.deepEqual(pc.descriptor.externallyOwned, ["Patient", "Encounter"]);

  // WardSynQ does not mint a patient the hospital's EMR does not know about.
  await assert.rejects(pc.session("pat-11").put(Patient({ id: "pat-11", mrn: "GH-11", name: "N", dob: "1970-01-01" })), (e) => e instanceof RemoteRefusedError && e.code === "EXTERNAL_CREATE");

  // The external EMR's bundle arrives through the connector boundary and lands as adapter writes.
  const b = sccmBundle({
    tenantId: "gimsr", sourceConnector: "fhir-r4", generatedAt: "2026-09-06T10:00:00Z",
    patient: sccmPatient({ id: "EPIC-77", name: "Epic Patient", gender: "male", birthDate: "1960-05-05", identifiers: [{ system: "urn:mrn", type: "MRN", value: "E-77" }] }),
    encounters: [sccmEncounter({ id: "V-1", status: "in-progress", class: "IMP" })],
    observations: [sccmObservation({ id: "L-1", category: "laboratory", code: { coding: [{ system: "http://loinc.org", code: "2823-3", display: "Potassium" }], text: "Potassium" }, value: { value: 6.1, unit: "mmol/L" }, effectiveDateTime: "2026-09-06T09:00:00Z", status: "final" })],
    medications: [medicationStatement({ id: "M-1", medication: { coding: [{ system: "rxnorm", code: "11289", display: "Warfarin" }], text: "Warfarin" }, origin: "order", status: "active" })],
  });
  const r = await h.fetchAs("fb:dr-menon")("https://x/api/wardsynq/gimsr/ingest/sccm", { method: "POST", body: JSON.stringify(b) });
  assert.equal(r.status, 200);
  const out = await r.json();
  assert.equal(out.ok, true);
  assert.equal(out.system, "sccm");
  assert.equal(out.written, 4);
  assert.equal(out.refused, 0);

  const pat = await pc.governed.get(pc.actor, "Patient", "fhir-r4-pat-epic-77");
  assert.equal(pat.mrn, "E-77");
  assert.equal(pat.meta.source.system, "fhir-r4");
  assert.equal(pat.writtenBy.kind, "adapter");
  const rx = await pc.governed.get(pc.actor, "MedicationOrder", "fhir-r4-rx-m-1");
  assert.equal(rx.status, "draft", "an external active order lands as a draft; the ceiling is the actor model's");
  assert.equal(rx.externalStatus, "active");
  assert.equal(rx.prescriberId, "external:fhir-r4");

  // A replay of the same bundle is a no-op, not a second copy.
  const again = await (await h.fetchAs("fb:dr-menon")("https://x/api/wardsynq/gimsr/ingest/sccm", { method: "POST", body: JSON.stringify(b) })).json();
  assert.equal(again.duplicate, true);
  assert.equal((await h.repository.history("gimsr", "Patient", "fhir-r4-pat-epic-77")).length, 1);

  // The doctor can chart against the external patient (a note is WardSynQ's own)...
  await pc.session("fhir-r4-pat-epic-77").put(ClinicalNote({ id: "note-x", patientId: "fhir-r4-pat-epic-77", noteType: "progress", sections: { a: "seen" }, authorId: "fb:dr-menon" }));
  // ...but cannot overwrite what Epic owns; that change goes back through the connector.
  await assert.rejects(pc.session("fhir-r4-pat-epic-77").put({ ...pat, name: "Renamed locally" }), (e) => e instanceof RemoteRefusedError && e.code === "EXTERNAL_AUTHORITY");
  assert.equal((await pc.governed.get(pc.actor, "Patient", "fhir-r4-pat-epic-77")).name, "Epic Patient");
});

test("system-of-record mode still protects feed-owned records (a LIS result is corrected by the LIS)", async () => {
  const h = hospital();
  const pc = await client(h, "fb:dr-menon");
  assert.doesNotThrow(() => new IntegrationHub({}).register(sccmAdapter()), "the adapter registers on the hub like the GHIS one");
  await pc.session("pat-12").put(Patient({ id: "pat-12", mrn: "GH-12", name: "Native", dob: "1970-01-01" }));
  const b = sccmBundle({ sourceConnector: "hl7v2", generatedAt: "2026-09-06T11:00:00Z", patient: sccmPatient({ id: "H-1", name: "Lab Feed" }),
    observations: [sccmObservation({ id: "K-1", category: "laboratory", code: { coding: [{ code: "2823-3" }], text: "Potassium" }, value: { value: 4.0, unit: "mmol/L" } })] });
  assert.equal((await h.fetchAs("fb:dr-menon")("https://x/api/wardsynq/gimsr/ingest/sccm", { method: "POST", body: JSON.stringify(b) })).status, 200);
  const obs = await pc.governed.get(pc.actor, "Observation", "hl7v2-obs-k-1");
  await assert.rejects(pc.session("hl7v2-pat-h-1").put({ ...obs, value: 9.9 }), (e) => e.code === "EXTERNAL_AUTHORITY");
  // A native record in the same tenant is editable as ever.
  const p = await pc.session("pat-12").get("Patient", "pat-12");
  assert.equal((await pc.session("pat-12").put({ ...p, name: "Native 2" })).version, 2);
});

test("SCCM adapter: stable ids, provenance stamped, nothing invented, imaging reported not dropped silently", () => {
  const b = sccmBundle({ sourceConnector: "dicomweb", patient: sccmPatient({ id: "P/1" }), imagingStudies: [{ id: "S1", modality: "CT" }] });
  const m = mapSccmBundle(b);
  assert.equal(m.patient.id, "dicomweb-pat-p-1");
  assert.equal(m.patient.dob, "0000-00-00");
  assert.equal(m.patient.dobIsUnknown, true);
  assert.equal(m.patient.nameIsUnknown, true);
  assert.equal(m.patient.meta.source.system, "dicomweb");
  assert.deepEqual(m.issues.map((i) => i.code), ["SCCM_PATIENT_NO_MRN", "SCCM_PATIENT_NO_NAME", "SCCM_PATIENT_NO_DOB", "SCCM_IMAGING_NOT_MAPPED"]);
  assert.equal(mapSccmBundle(b).patient.id, m.patient.id, "same source, same id");
  assert.equal(sccmAdapter().claims({ sccmVersion: "1.0", patient: { id: "x" } }), true);
  assert.equal(sccmAdapter().claims({ patientId: 1, labs: [] }), false, "a GHIS bundle is not claimed");
});

/* ------------------------------------------------------------------ the port and the service alone */

test("service: policy defaults, actor mapping, port validation", () => {
  assert.deepEqual(recordPolicy({ settings: "{}" }), { mode: MODE.SYSTEM_OF_RECORD, externallyOwned: [] });
  assert.deepEqual(recordPolicy({ settings: JSON.stringify({ wardsynq: { recordMode: "integration", externallyOwned: ["Patient", "Bogus"] } }) }), { mode: MODE.INTEGRATION, externallyOwned: ["Patient"] });
  assert.equal(actorForMembership({ identity: { id: "fb:a" }, role: "clinician", claims: { regNo: "R1" } }).credential, "R1");
  assert.equal(actorForMembership({ identity: { id: "fb:a" }, role: "clinician" }).credential, null);
  assert.equal(actorForMembership({ identity: { id: "fb:a" }, role: "superadmin" }).tier, TIER.READ);
  assert.equal(actorForMembership({ identity: { id: "fb:a" }, role: "admin" }), null);
  assert.equal(actorForMembership({ identity: { id: "fb:a" }, role: "auditor" }), null);
  assert.throws(() => assertRepository({ latest() {} }), /missing/);
  assert.doesNotThrow(() => assertRepository(new MemoryRepository()));
  assert.throws(() => new RecordService({ repository: new MemoryRepository(), tenant: { id: "t" }, actor: null }), /actor/);
});

/* The invariant this layer exists for: the ungoverned store must not be reachable from the object
 * every route handler holds. It used to be `svc.store`, under a comment saying it was not exported. */
test("the ungoverned ClinicalStore is not reachable from a RecordService", () => {
  const svc = new RecordService({
    repository: new MemoryRepository(), tenant: { id: "t1", mode: "live" },
    actor: makeActor({ id: "fb:dr-a", kind: KIND.HUMAN, tier: TIER.EXECUTE, display: "Dr A", credential: "held-by-server" }),
    role: "doctor", roleSource: "opd",
  });
  assert.equal(svc.store, undefined, "no raw store property");
  assert.ok(!Object.values(svc).some((v) => v instanceof ClinicalStore), "and no ClinicalStore under any other property name");
  assert.equal(typeof svc.governed.put, "function", "writes still go through the governed store");
});

test("D1 repository speaks the schema: append is one atomic batch, a UNIQUE violation is a VersionConflictError, no UPDATE or DELETE exists", async () => {
  const sql = [];
  let failBatch = null;
  const db = {
    prepare(q) { sql.push(q); const stmt = { bind: () => stmt, first: async () => null, all: async () => ({ results: [] }), run: async () => ({ success: true }) }; return stmt; },
    batch: async (stmts) => { if (failBatch) throw failBatch; return stmts.map(() => ({ meta: { last_row_id: 7 } })); },
  };
  const repo = new D1Repository(db);
  assertRepository(repo);
  const rec = { resourceType: "Patient", id: "p", version: 1, meta: { recordedAt: "t" }, writtenBy: { id: "a", kind: "human" } };
  const out = await repo.append("t1", [rec], { idempotencyKey: "k", audit: { action: "record.write", actor: "a" } });
  assert.equal(out.seq, 7);
  assert.ok(sql.some((q) => /INSERT INTO wardsynq_record/.test(q)));
  assert.ok(sql.some((q) => /INSERT INTO wardsynq_idempotency/.test(q)));
  assert.ok(sql.some((q) => /INSERT INTO connect_audit_event/.test(q)));
  failBatch = new Error("D1_ERROR: UNIQUE constraint failed: wardsynq_record.tenant_id, wardsynq_record.resource_type, wardsynq_record.id, wardsynq_record.version");
  await assert.rejects(repo.append("t1", [rec]), VersionConflictError);
  await repo.latest("t1", "Patient", "p"); await repo.history("t1", "Patient", "p"); await repo.byPatient("t1", "Observation", "p");
  await repo.changes("t1", 0, 10); await repo.recall("t1", "k"); await repo.latestByType("t1", "Patient", 5); await repo.auditOnly("t1", { action: "record.read" });
  assert.ok(!sql.some((q) => /\b(UPDATE|DELETE)\b/i.test(q)), "append-only by construction");
  assert.ok(sql.every((q) => /^INSERT/.test(q) || !/wardsynq_record/.test(q) || /tenant_id\s*=\s*\?/.test(q)), "every record query is tenant-scoped");
});

/* ------------------------------------------------------------------ the hospital's own roles */

/**
 * A hospital whose tenant is linked to an OPD organisation. Membership is the existing q_members
 * shape decided by the existing pure gate (authorizeOrgAccess), faked at the I/O seam only.
 */
function opdHospital(members, extra = {}) {
  const org = { id: "org-gimsr", name: "GIMSR OPD", ownerUid: "fb:owner-uid", connectTenantId: "gimsr" };
  const h = hospital({
    settings: extra.settings,
    orgForTenant: async (env, tenant) => (tenant.id === "gimsr" ? org : null),
    authorizeOrg: async (env, actor, orgId, cap) => {
      if (String(orgId) !== org.id) return { ok: false, reason: "org_not_found" };
      if (actor.kind === "staff" && actor.orgId !== org.id) return { ok: false, reason: "org_mismatch" };
      if (actor.id === org.ownerUid) return { ok: true, role: "admin", owner: true };
      const m = members[actor.id] || (actor.email && members[actor.email]);
      if (!m || m.active === false) return { ok: false, reason: "not_a_member" };
      if (cap && !roleCan(m.role, cap)) return { ok: false, reason: "forbidden", role: m.role };
      return { ok: true, role: m.role };
    },
    staffSession: verifyStaffSession,
  });
  return h;
}
const STAFF_ENV = { ...ENV, QUEUE_STAFF_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-for-staff-sessions-at-least-32-chars" };

test("role mapping: every operational role resolves to exactly the grant its capabilities imply", () => {
  const m = roleMapping();
  assert.deepEqual(Object.keys(m).sort(), [...ROLES].sort());
  /* The title used to say "eighteen". It is derived from ROLES, so adding `lab` passed silently -
   * a count in a name goes stale the first time somebody adds a role, and a stale name is worse
   * than none because it reads as a checked fact. The grants below are what actually pin this. */
  const tier = (r) => (m[r] ? m[r].tier : null);
  const write = (r) => (m[r] ? m[r].write : "none");
  const read = (r) => (m[r] ? m[r].read : "none");
  for (const r of ["doctor", "pg_faculty", "pg_hod", "admin"]) { assert.equal(tier(r), TIER.EXECUTE, r); assert.equal(write(r), null, r); assert.equal(read(r), null, r); }
  // 2026-09-06: QUEUE_ADD ("register / walk-in a patient") now adds Patient to the write scope and,
  // for a role that held only READ before (supervisor, reception), raises the tier to EXECUTE — the
  // same reasoning EMR_VITALS already established for a nurse's vitals. See actor.js's header.
  // 2026-09-06: QUEUE_ADD's union also adds Encounter, on the SAME reasoning as Patient — see
  // functions/_wardsynq/actor.js.
  // A nurse additionally holds MED_ADMINISTER (2026-09-07, the inpatient eMAR), which adds
  // MedicationAdministration and nothing else. Interns and residents do not give medicines here.
  assert.equal(tier("nurse"), TIER.EXECUTE);
  /* 2026-09-07: ShiftHandover joined Observation in the EMR_VITALS scope with the nursing
   * flowsheet. A handover is the nurse's own account of her shift, not a clinical document - which
   * is exactly why it got its OWN type rather than being written as a ClinicalNote. Putting it
   * there would have forced this scope open to every clinical document, and the two assertions
   * below would have had to be deleted rather than kept. */
  assert.deepEqual(write("nurse"), ["Observation", "ShiftHandover", "BreakGlassGrant", "MedicationReconciliation", "PatientConsent", "CarePlan", "RiskAssessment", "Patient", "Encounter", "Appointment", "PatientLink", "PrescriptionTransmission", "MedicationAdministration"]);
  assert.equal(read("nurse"), null);
  assert.ok(!write("nurse").includes("MedicationOrder"), "a nurse who can give a dose still cannot write the order for it");
  assert.ok(!write("nurse").includes("ClinicalNote"), "nor an assessment, nor a discharge summary");
  for (const r of ["intern", "resident", "pg_resident"]) { assert.equal(tier(r), TIER.EXECUTE, r); assert.deepEqual(write(r), ["Observation", "ShiftHandover", "BreakGlassGrant", "MedicationReconciliation", "PatientConsent", "CarePlan", "RiskAssessment", "Patient", "Encounter", "Appointment", "PatientLink", "PrescriptionTransmission"], r); assert.equal(read(r), null, r); }
  for (const r of ["supervisor", "reception"]) { assert.equal(tier(r), TIER.EXECUTE, r); assert.deepEqual(write(r), ["Patient", "Encounter", "Appointment", "PatientLink", "PrescriptionTransmission"], r); assert.equal(read(r), null, r); }
  // A cashier reads the orders they bill for and writes nothing at all.
  assert.equal(tier("cashier"), TIER.READ);
  assert.deepEqual(write("cashier"), []);
  assert.deepEqual(read("cashier"), ["MedicationOrder", "ServiceRequest"]);
  /* 2026-09-07: pharmacy gained ORDER_VERIFY. Verification is only as good as what the verifier can
   * READ, and until this the pharmacy role held no EMR capability at all - so a pharmacist could not
   * see the allergy, the creatinine or the critical potassium they are supposed to check against,
   * which made pharmacy verification impossible to do honestly.
   *
   * The grant is narrow BY ENUMERATION and the assertions below are what keeps it narrow: exactly
   * what a verification needs, and one write - its own verification record. NOT
   * MedicationAdministration, because a role that can write that could post a fabricated
   * "administered" row through the raw record API without going near a bedside. */
  assert.equal(tier("pharmacy"), TIER.EXECUTE, "it writes its own verification, so it is not READ-only any more");
  /* Two writes since 2026-09-07: its own verification, and its own supply record. Issuing stock is
   * the pharmacy's act and gets its own resource; recording that a patient was GIVEN a dose is the
   * nurse's, at a bedside, and is still not on this list. */
  assert.deepEqual(write("pharmacy"), ["MedicationVerification", "MedicationDispense"]);
  assert.deepEqual(read("pharmacy"), ["MedicationOrder", "ServiceRequest", "AllergyIntolerance", "Observation", "Condition", "MedicationAdministration", "CriticalResultLoop", "MedicationVerification", "MedicationDispense"]);
  assert.ok(!write("pharmacy").includes("MedicationAdministration"), "a pharmacist can never claim a dose was given");
  assert.ok(!write("pharmacy").includes("MedicationOrder"), "nor change the order they are checking");
  assert.ok(!read("pharmacy").includes("ClinicalNote"), "and not the notes or the discharge summary");
  /* The laboratory, 2026-09-07. It reads the requests it works from and writes the results. It has
   * NO EMR capability, so it never sees a chart, an order it did not need, or a note.
   *
   * The one residual is stated rather than hidden: write scope here is by resource TYPE, and a lab
   * result and a nurse's blood pressure are both Observations - so this does technically permit an
   * Observation of any category through the raw record API. The resulting route always stamps
   * "laboratory" (pinned in the inpatient suite), and closing it properly needs a category-scoped
   * grant, which is a change to the store's authorisation model rather than to this table. */
  assert.equal(tier("lab"), TIER.EXECUTE);
  assert.deepEqual(write("lab"), ["Observation", "DiagnosticReport"]);
  assert.deepEqual(read("lab"), ["ServiceRequest", "Observation", "DiagnosticReport"]);
  assert.ok(!write("lab").includes("MedicationOrder") && !write("lab").includes("Condition"), "a laboratory does not prescribe or diagnose");
  assert.ok(!read("lab").includes("Patient") && !read("lab").includes("ClinicalNote"), "and never reads the chart");
  for (const r of ["hr", "viewer", "oncqis_protocol_author", "oncqis_clinical_reviewer", "oncqis_institutional_approver", "academic_cell"]) assert.equal(m[r], null, r + " has no clinical actor");
  // The mapping is derived, so it cannot drift from the queue's own non-negotiable.
  for (const r of ROLES) {
    if (roleCan(r, CAPS.EMR_TREAT)) assert.equal(write(r), null, r + " treats, so writes every type");
    else assert.ok(write(r) === "none" || !write(r).includes("MedicationOrder"), r + " cannot treat, so never writes an order");
  }
  assert.equal(grantForRole("no-such-role"), null);
  assert.equal(actorFromOpdRole({ identity: { id: "x" }, role: "hr" }), null);
});

test("OPD roles at the door: doctor writes and signs, nurse records vitals and nothing else, reception reads only, pharmacy sees orders only, hr is refused", async () => {
  const h = opdHospital({
    "fb:dr-menon": { role: "doctor" },
    "fb:sister-anu": { role: "nurse" },
    "fb:desk-1": { role: "reception" },
    "fb:pharm-1": { role: "pharmacy" },
    "fb:hr-1": { role: "hr" },
    "fb:dr-rao": { role: "doctor" },
  });
  const doctor = await client(h, "fb:dr-menon", { regNo: "AP-12345" });
  assert.equal(doctor.descriptor.roleSource, "opd");
  assert.equal(doctor.descriptor.role, "doctor");
  assert.equal(doctor.descriptor.actor.tier, "execute");
  assert.equal(doctor.descriptor.actor.writable, null);
  await doctor.session("pat-20").put(Patient({ id: "pat-20", mrn: "GH-20", name: "Ward Patient", dob: "1970-01-01" }));
  const rx = await doctor.session("pat-20").put(MedicationOrder({ id: "rx-20", patientId: "pat-20", drug: "Amoxicillin", prescriberId: "fb:dr-menon", status: "active", signedBy: "fb:dr-menon" }));
  assert.equal(rx.status, "active");

  // The nurse: EXECUTE on observations (and, since 2026-09-06, on Patient — she also registers), a
  // governance denial on an order, whatever the client says.
  const nurse = await client(h, "fb:sister-anu");
  assert.equal(nurse.descriptor.role, "nurse");
  assert.equal(nurse.descriptor.actor.tier, "execute");
  assert.deepEqual(nurse.descriptor.actor.writable, ["Observation", "ShiftHandover", "BreakGlassGrant", "MedicationReconciliation", "PatientConsent", "CarePlan", "RiskAssessment", "Patient", "Encounter", "Appointment", "PatientLink", "PrescriptionTransmission", "MedicationAdministration"]);
  assert.equal(nurse.descriptor.actor.canSign, false);
  const bp = await nurse.session("pat-20").put(Observation({ id: "obs-20", patientId: "pat-20", code: "85354-9", value: "142/91", category: "vital-signs" }));
  assert.equal(bp.writtenBy.id, "fb:sister-anu");
  assert.equal(bp.writtenBy.tier, "execute");
  const r = await h.fetchAs("fb:sister-anu")("https://x/api/wardsynq/gimsr/record", { method: "POST", body: JSON.stringify({ entity: MedicationOrder({ id: "rx-21", patientId: "pat-20", drug: "Warfarin", prescriberId: "fb:sister-anu", status: "draft" }) }) });
  assert.equal(r.status, 403);
  assert.deepEqual((await r.json()).reasons.map((x) => x.code), ["SCOPE_DENIED"]);
  assert.equal(await h.repository.latest("gimsr", "MedicationOrder", "rx-21"), null);
  // ...and she cannot be promoted by what her client claims to be.
  const forged = await h.fetchAs("fb:sister-anu")("https://x/api/wardsynq/gimsr/record", { method: "POST", body: JSON.stringify({ entity: { ...bp, writtenBy: { id: "fb:dr-menon", kind: "human", tier: "execute" }, value: "120/80" }, expectedVersion: 1 }) });
  assert.equal((await forged.json()).record.writtenBy.id, "fb:sister-anu", "the server stamps the real author over the claimed one");

  // Reception: reads the chart, writes ONLY Patient (registration — see actor.js QUEUE_ADD), and is
  // refused for anything clinical.
  const desk = await client(h, "fb:desk-1");
  assert.equal(desk.descriptor.actor.tier, "execute");
  /* Reception's write scope grew on 2026-09-07 with the diary and identity resolution. Booking a
   * patient in, and resolving two records that turned out to be one person, are the SAME
   * administrative act as registering them - the front desk's work, not a clinical decision. It is
   * still four enumerated types and nothing clinical: no Observation, no order, no note. */
  assert.deepEqual(desk.descriptor.actor.writable, ["Patient", "Encounter", "Appointment", "PatientLink", "PrescriptionTransmission"]);
  assert.ok(!desk.descriptor.actor.writable.includes("Observation"), "reception records no clinical finding");
  assert.ok(!desk.descriptor.actor.writable.includes("AppointmentRequest"), "nor decides a patient needs to be seen again");
  assert.equal((await desk.governed.get(desk.actor, "MedicationOrder", "rx-20")).drug, "Amoxicillin");
  assert.equal((await h.fetchAs("fb:desk-1")("https://x/api/wardsynq/gimsr/record", { method: "POST", body: JSON.stringify({ entity: Observation({ id: "o", patientId: "pat-20", code: "x", value: 1 }) }) })).status, 403);
  const deskPatient = await h.fetchAs("fb:desk-1")("https://x/api/wardsynq/gimsr/record", { method: "POST", body: JSON.stringify({ entity: Patient({ id: "pat-21", mrn: "GH-21", name: "Desk-registered", dob: "1970-01-01" }) }) });
  assert.equal(deskPatient.status, 201, "reception can register a patient identity");

  /* Pharmacy: what a VERIFICATION needs, and nothing beyond it. Since ORDER_VERIFY (2026-09-07)
   * that includes the observations and allergies a pharmacist checks a dose against - they could
   * not see any of it before, which made pharmacy verification impossible to do honestly. It still
   * stops well short of the chart: no Patient, no notes, no discharge summary. */
  const pharm = await client(h, "fb:pharm-1");
  assert.deepEqual(pharm.descriptor.actor.readable,
    ["MedicationOrder", "ServiceRequest", "AllergyIntolerance", "Observation", "Condition", "MedicationAdministration", "CriticalResultLoop", "MedicationVerification", "MedicationDispense"]);
  const chart = await pharm.backend.chart("pat-20");
  assert.ok(Object.keys(chart).includes("MedicationOrder"));
  assert.equal(chart.MedicationOrder.length, 1);
  assert.ok(!Object.keys(chart).includes("Patient"), "the identity master is still not theirs to read");
  assert.ok(!Object.keys(chart).includes("ClinicalNote"));
  assert.equal((await pharm.governed.get(pharm.actor, "Observation", "obs-20")).id, "obs-20", "a lab result IS readable now: it is what they verify against");
  await assert.rejects(pharm.governed.get(pharm.actor, "ClinicalNote", "note-20"), (e) => e.code === "READ_SCOPE_DENIED");
  assert.equal((await h.fetchAs("fb:pharm-1")("https://x/api/wardsynq/gimsr/record/Patient/pat-20")).status, 403);
  const feed = await pharm.backend.changes(0);
  // The feed still withholds what the role may not read; the readable set is simply wider now.
  const fed = [...new Set(feed.records.map((x) => x.resourceType))].sort();
  assert.ok(fed.every((t) => pharm.descriptor.actor.readable.includes(t)), `feed leaked ${fed}`);
  assert.ok(fed.includes("MedicationOrder"));
  assert.ok(!fed.includes("Patient") && !fed.includes("ClinicalNote"), "and never the identity master or the notes");

  // HR: a hospital member with no business on the chart.
  await assert.rejects(client(h, "fb:hr-1"), (e) => e.code === "FORBIDDEN");
  // A member of the OPD org who is ALSO a Connect clinician is decided by the OPD role, not the wider one.
  const rao = await client(h, "fb:dr-rao");
  assert.equal(rao.descriptor.roleSource, "opd");
});

test("staff sessions: a nurse signed in with email+PIN on a hospital PC reaches the record with her OPD role and no signature", async () => {
  const h = opdHospital({ "nurse.anu": { role: "nurse" }, "dr.pin": { role: "doctor" } });
  const nurseTok = await mintStaffSession(STAFF_ENV, "org-gimsr", "nurse.anu", Date.now());
  const otherOrgTok = await mintStaffSession(STAFF_ENV, "org-elsewhere", "nurse.anu", Date.now());
  const drTok = await mintStaffSession(STAFF_ENV, "org-gimsr", "dr.pin", Date.now());
  const asStaff = (tok) => async (url, init) => {
    const headers = new Headers(init && init.headers || {});
    headers.set("X-Staff-Token", tok);
    return handle(new Request(String(url), { method: (init && init.method) || "GET", headers, body: init && init.body }), STAFF_ENV, h.deps);
  };
  const nurse = await (async () => { const b = new RemoteBackend({ tenantId: "gimsr", baseUrl: "https://x", fetch: asStaff(nurseTok) }); await b.open(); return b; })();
  assert.equal(nurse.descriptor.actor.id, "nurse.anu");
  assert.equal(nurse.descriptor.role, "nurse");
  assert.deepEqual(nurse.descriptor.actor.writable, ["Observation", "ShiftHandover", "BreakGlassGrant", "MedicationReconciliation", "PatientConsent", "CarePlan", "RiskAssessment", "Patient", "Encounter", "Appointment", "PatientLink", "PrescriptionTransmission", "MedicationAdministration"]);
  // Staff sessions are off unless the deployment says so, and org-bound.
  assert.equal((await handle(new Request("https://x/api/wardsynq/gimsr", { headers: { "X-Staff-Token": nurseTok } }), ENV, h.deps)).status, 401);
  assert.equal((await asStaff(otherOrgTok)("https://x/api/wardsynq/gimsr")).status, 403);
  // A doctor on a PIN session can write, and cannot sign: there is no registration number on a PIN.
  const dr = new RemoteBackend({ tenantId: "gimsr", baseUrl: "https://x", fetch: asStaff(drTok) }); await dr.open();
  assert.equal(dr.descriptor.actor.tier, "execute");
  assert.equal(dr.descriptor.actor.canSign, false);
  const signed = await asStaff(drTok)("https://x/api/wardsynq/gimsr/record", { method: "POST", body: JSON.stringify({ entity: MedicationOrder({ id: "rx-30", patientId: "pat-30", drug: "X", prescriberId: "dr.pin", status: "active", signedBy: "dr.pin" }) }) });
  assert.deepEqual((await signed.json()).reasons.map((x) => x.code), ["NO_CREDENTIAL"]);
});

test("AI drafts: written by the AI actor on the clinician's behalf, never authored by the clinician; capped at DRAFT; no wider than the human", async () => {
  const h = opdHospital({ "fb:dr-menon": { role: "doctor" }, "fb:sister-anu": { role: "nurse" }, "fb:desk-1": { role: "reception" } });
  const f = h.fetchAs("fb:dr-menon", "AP-12345");
  // 1. Declared origin.
  const r1 = await f("https://x/api/wardsynq/gimsr/record", { method: "POST", body: JSON.stringify({
    entity: ClinicalNote({ id: "note-ai-1", patientId: "pat-40", noteType: "progress", sections: { plan: "suggested plan" } }),
    origin: { kind: "ai", id: "maik" },
  }) });
  assert.equal(r1.status, 201);
  const b1 = await r1.json();
  assert.equal(b1.record.writtenBy.id, "ai:maik");
  assert.equal(b1.record.writtenBy.kind, "ai");
  assert.equal(b1.record.writtenBy.tier, "draft");
  assert.equal(b1.record.writtenBy.onBehalfOf, "fb:dr-menon");
  assert.equal(b1.record.aiDrafted, true, "the store forces the flag, whatever the entity said");
  assert.deepEqual(b1.actor, { id: "ai:maik", kind: "ai", tier: "draft", onBehalfOf: "fb:dr-menon" });
  // 2. An entity that says it is AI-drafted is attributed to an AI even with no declared origin.
  const r2 = await f("https://x/api/wardsynq/gimsr/record", { method: "POST", body: JSON.stringify({ entity: { ...ClinicalNote({ id: "note-ai-2", patientId: "pat-40", noteType: "progress", sections: {} }), aiDrafted: true } }) });
  assert.equal((await r2.json()).record.writtenBy.kind, "ai");
  // 3. An AI cannot commit an active order or sign, however the doctor's session could.
  const r3 = await f("https://x/api/wardsynq/gimsr/record", { method: "POST", body: JSON.stringify({
    entity: MedicationOrder({ id: "rx-ai", patientId: "pat-40", drug: "Warfarin", prescriberId: "fb:dr-menon", status: "active", signedBy: "fb:dr-menon" }), origin: { kind: "ai" },
  }) });
  assert.equal(r3.status, 403);
  assert.deepEqual((await r3.json()).reasons.map((x) => x.code).sort(), ["EXECUTE_DENIED", "NON_HUMAN_SIGNATURE"]);
  const r3b = await f("https://x/api/wardsynq/gimsr/record", { method: "POST", body: JSON.stringify({
    entity: MedicationOrder({ id: "rx-ai", patientId: "pat-40", drug: "Warfarin", prescriberId: "fb:dr-menon" }), origin: { kind: "ai" },
  }) });
  assert.equal((await r3b.json()).record.status, "draft");
  // 4. The AI inherits the human's scope: drafting for a nurse, it may draft an observation and not a note.
  const rn = await h.fetchAs("fb:sister-anu")("https://x/api/wardsynq/gimsr/record", { method: "POST", body: JSON.stringify({ entity: ClinicalNote({ id: "note-ai-3", patientId: "pat-40", noteType: "progress", sections: {} }), origin: { kind: "ai" } }) });
  assert.deepEqual((await rn.json()).reasons.map((x) => x.code), ["SCOPE_DENIED"]);
  // 5. Drafting for a reader is drafting for nobody.
  const rd = await h.fetchAs("fb:desk-1")("https://x/api/wardsynq/gimsr/record", { method: "POST", body: JSON.stringify({ entity: Observation({ id: "o", patientId: "pat-40", code: "x", value: 1 }), origin: { kind: "ai" } }) });
  assert.equal(rd.status, 403);
  // 6. The audit names the AI as writer and the human as delegate; the human's own write does not.
  const ai = h.repository.audit.find((a) => a.action === "record.write" && a.scope.id === "note-ai-1");
  assert.equal(ai.scope.writer, "ai:maik"); assert.equal(ai.scope.onBehalfOf, "fb:dr-menon");
  // Pure: the AI actor is DRAFT whatever it asks, and its scope is the human's.
  const human = actorFromOpdRole({ identity: { id: "fb:n" }, role: "nurse" });
  const bot = aiActorFor(human, { id: "maik" });
  assert.equal(bot.tier, "draft"); assert.deepEqual([...bot.scope.write], ["Observation", "ShiftHandover", "BreakGlassGrant", "MedicationReconciliation", "PatientConsent", "CarePlan", "RiskAssessment", "Patient", "Encounter", "Appointment", "PatientLink", "PrescriptionTransmission", "MedicationAdministration"]); assert.equal(bot.onBehalfOf, "fb:n");

  /* 7. AND IT STILL MAY NOT SAY A PRESCRIPTION ARRIVED. The scope above includes
   * PrescriptionTransmission, because the nurse it drafts for legitimately writes one. But that
   * record is a claim about the physical world - this left, the pharmacy has it - and a model cannot
   * observe any of it. The instruction rule would not have caught this: it keys on `status`, and a
   * transmission's lifecycle is `state`, so a "draft" cap would happily have stored "acknowledged". */
  const rtx = await h.fetchAs("fb:sister-anu")("https://x/api/wardsynq/gimsr/record", { method: "POST", body: JSON.stringify({
    entity: { resourceType: "PrescriptionTransmission", id: "wsq-tx-ai", patientId: "pat-40", orderId: "rx-1", state: "acknowledged" },
    origin: { kind: "ai" },
  }) });
  assert.equal(rtx.status, 403);
  assert.deepEqual((await rtx.json()).reasons.map((x) => x.code), ["HUMAN_ONLY"]);
  // The nurse herself, on the same record, is not blocked: the refusal is about the actor's kind.
  const rtxh = await h.fetchAs("fb:sister-anu")("https://x/api/wardsynq/gimsr/record", { method: "POST", body: JSON.stringify({
    entity: { resourceType: "PrescriptionTransmission", id: "wsq-tx-human", patientId: "pat-40", orderId: "rx-1", state: "acknowledged" },
  }) });
  assert.equal(rtxh.status, 201, await rtxh.clone().text());
});

/* ------------------------------------------------------------------ the nurse-vitals migration */

test("vitals migration is OFF unless the flag, the org's tenant link and the tenant's opt-in all say otherwise", async () => {
  const org = { id: "org-gimsr", connectTenantId: "gimsr" };
  const tenants = { gimsr: { id: "gimsr", settings: JSON.stringify({ wardsynq: { migrations: { vitals: "shadow" } } }) } };
  const deps = { getOrg: async (env, id) => (id === "org-gimsr" ? org : null), tenantRow: async (env, id) => tenants[id] || null };
  const session = { orgId: "org-gimsr" };
  assert.deepEqual(await vitalsMigration({}, session, deps), { mode: "off", why: "flag" });
  assert.deepEqual(await vitalsMigration({ WARDSYNQ_RECORD: "1" }, { orgId: "org-other" }, deps), { mode: "off", why: "no_tenant" });
  assert.deepEqual(await vitalsMigration({ WARDSYNQ_RECORD: "1" }, {}, deps), { mode: "off", why: "no_org" });
  const on = await vitalsMigration({ WARDSYNQ_RECORD: "1" }, session, deps);
  assert.equal(on.mode, "shadow"); assert.equal(on.tenantId, "gimsr");
  assert.equal((await vitalsMigration({ WARDSYNQ_RECORD: "1" }, session, { ...deps, getOrg: async () => { throw new Error("firestore down"); } })).mode, "off", "a broken lookup is off, never a crash");
  assert.equal(vitalsMode({ settings: "{}" }), "off");
  assert.equal(vitalsMode({ settings: JSON.stringify({ wardsynq: { migrations: { vitals: "authoritative" } } }) }), "authoritative");
  assert.equal(vitalsMode({ settings: JSON.stringify({ wardsynq: { migrations: { vitals: "bogus" } } }) }), "off");
  assert.equal(patientIdForTicket({ ghisPatientId: "GH/40118" }), "opd-pat-gh-40118");
  assert.equal(patientIdForTicket({ ghisPatientId: "" }), null);
});

test("vitals to observations: coded, as reported, nothing invented, stable ids", () => {
  const obs = vitalsToObservations({ vitals: { sbp: "142", dbp: "91", pulse: "88", temp: "99.1", tempUnit: "F", spo2: "97", rr: "", weight: "abc", note: "post-op day 1" }, patientId: "opd-pat-gh-1", ticketId: "T1", recordedAt: "2026-09-06T10:00:00.000Z" });
  assert.deepEqual(obs.map((o) => [o.code, o.value, o.unit]), [["8480-6", 142, "mm[Hg]"], ["8462-4", 91, "mm[Hg]"], ["8867-4", 88, "/min"], ["8310-5", 99.1, "[degF]"], ["59408-5", 97, "%"]]);
  for (const o of obs) {
    assert.equal(o.resourceType, "Observation"); assert.equal(o.category, "vital-signs"); assert.equal(o.patientId, "opd-pat-gh-1");
    assert.equal(o.codeSystem, "http://loinc.org"); assert.equal(o.meta.effectiveAt, "2026-09-06T10:00:00.000Z"); assert.equal(o.sourceText, "post-op day 1");
    assert.equal(o.meta.source.system, "wardsynq-native");
  }
  assert.equal(obs[0].id, `opd-vitals-t1-${Date.parse("2026-09-06T10:00:00.000Z")}-sbp`);
  assert.deepEqual(vitalsToObservations({ vitals: { temp: "37.2", tempUnit: "C" }, patientId: "p", ticketId: "T" }).map((o) => o.unit), ["Cel"]);
  assert.deepEqual(vitalsToObservations({ vitals: { pulse: "" }, patientId: "p", ticketId: "T" }), []);
  assert.deepEqual(Object.keys(VITAL_CODES), ["sbp", "dbp", "pulse", "temp", "spo2", "rr", "weight"]);
});

/* 2026-09-07. num() was `parseFloat(String(v).replace(/[^0-9.\-]/g, ""))`, which deletes the
 * separators and GLUES the remaining digits together. A nurse typing a blood-pressure pair into one
 * box, or a comma decimal, produced a real-looking vital that was nothing the source said:
 *
 *     "120/80" -> 12080      charted as a systolic pressure
 *     "98,6"   -> 986
 *     "1:320"  -> 1320
 *
 * Hospital PCs (wardsynq.com) have full keyboards, so inputmode="numeric" prevents none of it. The
 * fix is numericValue() in wardsynq-model.js: a value that is not plainly one number is SKIPPED,
 * which is this file's documented posture for vitals anyway ("never defaulted"). */
test("vitals: a value that is not plainly one number is skipped, never glued into a fabricated reading", () => {
  const v = (vitals) => vitalsToObservations({ vitals, patientId: "p", ticketId: "T" });
  for (const bad of ["120/80", "98,6", "1:320", "12-15", "1+", "<5", "abc", "-", "/"]) {
    assert.deepEqual(v({ sbp: bad }), [], `sbp ${JSON.stringify(bad)} must record nothing, not a number`);
  }
  // A BP pair in the systolic box must not silently become a systolic of 12080.
  assert.deepEqual(v({ sbp: "120/80", dbp: "80" }).map((o) => [o.code, o.value]), [["8462-4", 80]],
    "the unparseable systolic is dropped; the valid diastolic beside it still records");
  // Genuine values, including a unit suffix, still record exactly as reported.
  assert.deepEqual(v({ temp: "98.6 F" }).map((o) => o.value), [98.6]);
  assert.deepEqual(v({ pulse: 72 }).map((o) => o.value), [72]);
  assert.deepEqual(v({ weight: "58.5" }).map((o) => o.value), [58.5]);
});

test("numericValue: the whole string must be one number, optionally with a digit-free unit", () => {
  for (const [input, expected] of [
    ["12.5", 12.5], ["0.9", 0.9], [-3, -3], ["-3", -3], ["6.2 mg/dL", 6.2], ["98.6 F", 98.6],
    ["12.5 %", 12.5], ["2.0E3", 2000], [72, 72],
  ]) assert.equal(numericValue(input), expected, `${JSON.stringify(input)} is a real measurement`);

  for (const input of [
    "1:320", "120/80", "5-10", "3.4/5.6", "1+", "<5", "NOT DETECTED", "98,6", "", null, undefined,
    "abc", "12 15", NaN, Infinity,
  ]) assert.equal(numericValue(input), null, `${JSON.stringify(input)} must not become a number`);
});

test("recordVitals: a nurse's vitals land in the record as her own EXECUTE-on-Observation actor; a retry replays; reception is refused; no MRN cannot be filed", async () => {
  const h = opdHospital({ "fb:sister-anu": { role: "nurse" }, "fb:desk-1": { role: "reception" } }, { settings: { wardsynq: { migrations: { vitals: "shadow" } } } });
  const env = { ...ENV };
  const mig = { mode: "shadow", tenantId: "gimsr" };
  const ticket = { id: "TKT-1", ghisPatientId: "GH-40118", ghisEpisodeId: "EP-9" };
  const asNurse = new Request("https://x/api/queue/s1/timeline", { method: "POST", headers: { "X-Test-User": "fb:sister-anu" } });
  const ctx = (req, vitals) => ({ migration: mig, session: { orgId: "org-gimsr" }, ticket, vitals, note: vitals.note, recordedAt: "2026-09-06T10:00:00.000Z",
    actorDeps: { db: h.db, identifyFn: h.deps.identifyFn, claimsFn: h.deps.claimsFn, staffSession: null, orgForTenant: h.deps.orgForTenant, authorizeOrg: h.deps.authorizeOrg },
    recordDeps: { repository: h.repository, pseudonym: async () => null } });

  const r1 = await recordVitals(asNurse, env, ctx(asNurse, { sbp: "142", dbp: "91", spo2: "97", note: "" }));
  assert.equal(r1.ok, true); assert.equal(r1.mode, "shadow"); assert.equal(r1.written, 3); assert.equal(r1.actor, "fb:sister-anu"); assert.equal(r1.role, "nurse");
  assert.equal(r1.patientId, "opd-pat-gh-40118");
  const stored = await h.repository.byPatient("gimsr", "Observation", "opd-pat-gh-40118");
  assert.equal(stored.length, 3);
  assert.equal(stored[0].writtenBy.id, "fb:sister-anu"); assert.equal(stored[0].writtenBy.tier, "execute"); assert.equal(stored[0].encounterId, "opd-enc-ep-9");
  // A retried save (same ticket, same timestamp) replays; nothing duplicates.
  const r2 = await recordVitals(asNurse, env, ctx(asNurse, { sbp: "142", dbp: "91", spo2: "97" }));
  assert.equal(r2.ok, true); assert.ok(r2.records.every((x) => x.replayed && x.version === 1));
  assert.equal((await h.repository.byPatient("gimsr", "Observation", "opd-pat-gh-40118")).length, 3);
  // Reception holds no write scope on Observation (only on Patient, since 2026-09-06 — she
  // registers, she does not chart vitals): refused, nothing written, and the result says which.
  const asDesk = new Request("https://x/api/queue/s1/timeline", { method: "POST", headers: { "X-Test-User": "fb:desk-1" } });
  const r3 = await recordVitals(asDesk, env, ctx(asDesk, { pulse: "80" }));
  assert.equal(r3.ok, false); assert.equal(r3.status, 403); assert.equal(r3.error, "governance");
  // No MRN on the ticket: cannot be filed, and says so rather than inventing a patient.
  const r4 = await recordVitals(asNurse, env, { ...ctx(asNurse, { pulse: "80" }), ticket: { id: "TKT-2", ghisPatientId: "" } });
  assert.equal(r4.ok, false); assert.equal(r4.error, "no_patient_identity");
  const r5 = await recordVitals(asNurse, env, ctx(asNurse, { pulse: "", note: "only a note" }));
  assert.equal(r5.ok, false); assert.equal(r5.error, "no_structured_vitals");
  // Off means untouched.
  assert.deepEqual(await recordVitals(asNurse, env, { ...ctx(asNurse, { pulse: "80" }), migration: { mode: "off", why: "flag" } }), { mode: "off", tenantId: null, ok: true, skipped: "flag", written: 0 });
  // Every record write was audited as the nurse.
  assert.ok(h.repository.audit.filter((a) => a.action === "record.write" && a.actor === "fb:sister-anu").length >= 3);
});

test("the queue timeline handler orders the writes by mode and leaves the off path byte-identical", () => {
  const src = readFileSync(new URL("../functions/api/queue/[[path]].js", import.meta.url), "utf8");
  const h = src.slice(src.indexOf('if (seg === "timeline") {'), src.indexOf('// Slide-to-checkout'));
  const i = (needle) => { const k = h.indexOf(needle); assert.ok(k >= 0, "missing: " + needle); return k; };
  // 2026-09-06: vitals and the doctor's assessment now share this branch through one `migrator`
  // (recordVitals or recordAssessment, chosen once, above the mode check) rather than each mode
  // naming recordVitals directly — so both migrations get the SAME ordering guarantees for free.
  // ...and, since the sign-off migration, the doctor's Authorise is a third migrator on the same
  // branch, selected by body.signOff — never by kind alone, so a save and a sign-off stay distinct.
  // ...and, since the investigation order migration, a fourth, selected by the structured `order`
  // payload — again never by kind alone, so a plain note and an order stay distinct.
  // ...and a fifth, the prescription, selected by its own `rx` payload on the same rule.
  assert.ok(h.includes("const migrator = isVitals ? recordVitals : isSignOff ? recordAssessmentSignOff : isInvOrder ? recordInvestigationOrder : isPrescription ? recordPrescription : recordAssessment;"));
  assert.ok(h.includes('const isSignOff = isAssessment && body.signOff === true;'));
  // authoritative: record first, refusal returns before any timeline write, then the timeline as shadow.
  const auth = h.slice(i('mig.mode === "authoritative"'), i("// shadow:"));
  assert.ok(auth.indexOf("migrator(") < auth.indexOf("QT.appendTimeline("));
  assert.ok(auth.indexOf('error: "record_refused"') < auth.indexOf("QT.appendTimeline("));
  // shadow: timeline first, record after.
  const shadow = h.slice(i("// shadow:"), i("return json(Object.assign({ ok: true }, await QT.appendTimeline("));
  assert.ok(shadow.indexOf("QT.appendTimeline(") < shadow.indexOf("migrator("));
  // off: the original single line, unchanged.
  assert.ok(h.includes('return json(Object.assign({ ok: true }, await QT.appendTimeline(env, s, t, body.kind, body.text, actor.id)), 200, request);'));
  // "medication" (prescriptions) is still untouched, and so is a "note" that carries no structured
  // order — in both cases every is* flag is false and mig.mode is forced to "off".
  assert.ok(h.includes('const isAssessment = QT.tlKind(body.kind) === "assessment";'));
  // the console sends the structured values with the text
  const html = readFileSync(new URL("../opd.html", import.meta.url), "utf8");
  assert.ok(html.includes('kind:"vitals",text:p.join(" · "),vitals:vitals'));
});

// 2026-09-06: the FIRST native, GHIS-independent clinical write. A hospital whose org.mode is
// "wardsynq" (WardSynQ itself is the EMR/HIS — never inferred, never GHIS, never the on-device
// personal-clinic path) has its assessment save/sign-off go straight to the WardSynQ record,
// bypassing the shadow/authoritative machinery above entirely — that machinery stays gated on the
// GLOBAL WARDSYNQ_RECORD flag, which must stay OFF and untouched by this feature.
// 2026-09-06 (part 2): generalized from an assessment-only early-return into the shared `mig`
// computation — vitals, assessment and investigation orders ALL force authoritative for a wardsynq
// org via the SAME wsqForcedMigration() helper, reusing the existing migrator/ctx dispatch verbatim.
// 2026-09-06 (part 4): prescriptions joined them once rx-safety.js's advisory-only CDSS pre-check
// existed (GET /rx-safety) — that check can never gate the write (unapproved clinical content, per
// its own header), so forcing it authoritative is safe: informed either way, blocked never.
test("native WardSynQ hospital: org.mode 'wardsynq' bypasses the global flag, forces authoritative for vitals/assessment/orders/prescriptions, and every other mode is untouched", () => {
  const src = readFileSync(new URL("../functions/api/queue/[[path]].js", import.meta.url), "utf8");
  assert.ok(src.includes("async function wsqForcedMigration(env, org) {"), "one shared helper, not one per migration");
  const helper = src.slice(src.indexOf("async function wsqForcedMigration"), src.indexOf("async function wsqForcedMigration") + 700);
  assert.ok(helper.includes('org.mode !== "wardsynq"'), "gated on the explicit org.mode value, never inferred");
  assert.ok(!helper.includes("WARDSYNQ_RECORD"), "must never read the global shadow-migration flag");
  // 2026-09-07, real-device verification: reads org.connectTenantId directly (the caller already
  // has a freshly-fetched org) instead of re-fetching the same org by id via resolveTenantForOrg -
  // one redundant Firestore round-trip removed, found live (it was one of several stacking up on a
  // single request and pushing register/save/order past 2s wall time and back as a 502).
  assert.ok(helper.includes("org.connectTenantId"), "reuses the existing org/tenant link — no new configuration system");
  assert.ok(!helper.includes("resolveTenantForOrg("), "no longer re-fetches the org Firestore already gave the caller");
  assert.ok(helper.includes("wsqTenantRow("), "still confirms the tenant row actually exists (one D1 read, not zero)");
  assert.ok(helper.includes('mode: "authoritative"'), "a WardSynQ write for this org is always authoritative — there is no GHIS to shadow");
  assert.ok(helper.includes("wardsynq_tenant_not_configured"), "an unlinked wardsynq org fails honestly instead of a silent no-op");

  const h = src.slice(src.indexOf('if (seg === "timeline") {'), src.indexOf('// Slide-to-checkout'));
  const i = (needle) => { const k = h.indexOf(needle); assert.ok(k >= 0, "missing: " + needle); return k; };
  const wardsynqBranch = i("let wsqMig = null;");
  const flagGatedCall = i('const mig = wsqMig || (isVitals ? await vitalsMigration(');
  assert.ok(wardsynqBranch < flagGatedCall, "the wardsynq check must run before the flag-gated shadow/authoritative path");
  const branch = h.slice(wardsynqBranch, flagGatedCall);
  assert.ok(branch.includes("isVitals || isAssessment || isInvOrder || isPrescription"), "vitals, assessment, orders AND prescriptions are all forced");
  assert.ok(branch.includes("wsqForcedMigration("), "uses the shared helper, not a duplicated inline check");
  // Success is the WardSynQ write's own success — a refusal short-circuits before the legacy
  // timeline line is ever appended, and is never silently swallowed (shadow's "report, never block").
  const authBlock = h.slice(h.indexOf('mig.mode === "authoritative"'), h.indexOf("// shadow:"));
  assert.ok(authBlock.indexOf("!rec.ok") < authBlock.indexOf("QT.appendTimeline("), "a record refusal must return before the timeline write");
  assert.ok(authBlock.includes('error: "record_refused"'));
  // Every other mode (native personal clinic, connect FHIR EMR, GHIS) never enters this branch —
  // it is gated purely on org.mode, and the existing shadow/off/authoritative dispatch immediately
  // below is completely unchanged for them.
  assert.ok(wardsynqBranch < i("const migrator = isVitals ? recordVitals"));
});

test("native WardSynQ hospital: registration and encounter sync are ALSO forced authoritative via the same shared helper", () => {
  const src = readFileSync(new URL("../functions/api/queue/[[path]].js", import.meta.url), "utf8");
  const reg = src.slice(src.indexOf('if (sub === "register" && method === "POST") {'), src.indexOf('if (sub === "get" && method === "GET") {'));
  assert.ok(reg.includes("wsqForcedMigration(env, org)"), "registration reuses the org already fetched — no second lookup");
  assert.ok(reg.indexOf("wsqForcedMigration") < reg.indexOf("registrationMigration("), "checked before the flag-gated path");
  const enc = src.slice(src.indexOf("async function syncEncounter"), src.indexOf("const wsqTenantRow ="));
  assert.ok(enc.includes("wsqForcedMigration("), "the ONE shared encounter call site is fixed once, not per hook site");
  assert.ok(enc.indexOf("wsqForcedMigration") < enc.indexOf("encounterMigration("), "checked before the flag-gated path");
});

/* ------------------------------------------------------------------ the doctor reads the vitals back */

test("the timeline GET names the record only where the tenant is on; the console reads it through the record's own door with its own credentials", () => {
  const src = readFileSync(new URL("../functions/api/queue/[[path]].js", import.meta.url), "utf8");
  const h = src.slice(src.indexOf('if (method === "GET" && seg === "timeline") {'), src.indexOf("// Doctor's treated-patient history"));
  // 2026-09-06: generalised from vitalsMigration to recordLinkForOrg, so a tenant migrated for
  // registration or the assessment ALSO exposes the record key — a read must not depend on which
  // specific WRITE happens to be turned on.
  assert.ok(h.includes('out.record = { tenantId: link.tenantId, patientId: patientIdForTicket(t), ticketId: t.id };'), "record key only when the tenant is reachable at all");
  assert.ok(!h.includes("vitalsMigration"), "the GET no longer asks a write-specific question");
  assert.ok(h.includes("requireSessionCap(env, actor, s, CAPS.EMR_VIEW)"), "the timeline read is still EMR_VIEW-gated");
  // 2026-09-06: results is the one card gated narrower than the rest — explicit opt-in
  // (mode === "authoritative"), not "any migration is reachable at all" like the other four.
  assert.ok(h.includes('if (rm.mode === "authoritative") out.record.results = true;'), "results needs its own explicit enable, not just a reachable tenant");
  const html = readFileSync(new URL("../opd.html", import.meta.url), "utf8");
  assert.ok(html.includes('"/api/wardsynq/"+encodeURIComponent(rec.tenantId)+"/patient/"+encodeURIComponent(rec.patientId)+"/Observation"'), "the existing Observation endpoint, nothing new");
  // 2026-09-06: the assessment card, then the investigations card, joined vital signs behind the
  // SAME gate — all three, or none. Each prepends, so they read vitals, assessment, investigations.
  // Results, gated on its OWN narrower key, sits between orders and prescriptions when it appears.
  assert.ok(html.includes('el.insertBefore(recordRxBlock(r.record),el.firstChild);'));
  assert.ok(html.includes('if(r.record.results) el.insertBefore(recordResultsBlock(r.record),el.firstChild);'), "the results card checks its own narrower key, not just r.record.tenantId");
  assert.ok(html.includes('el.insertBefore(recordOrdersBlock(r.record),el.firstChild);'));
  assert.ok(html.includes('el.insertBefore(recordAssessmentBlock(r.record),el.firstChild);'));
  assert.ok(html.includes('el.insertBefore(recordVitalsBlock(r.record),el.firstChild);'));
  // Every state has a sentence for the doctor: loading, empty, no MRN, 401, 403, 404, unreachable.
  for (const needle of ["Loading from the clinical record", "No vital signs in the clinical record for this patient yet", "has no medical record number", "Sign in again", "Your role cannot view the clinical record", "not available for this clinic right now", "Could not reach the clinical record"]) {
    assert.ok(html.includes(needle), "state text missing: " + needle);
  }
  // The same credentials the console already holds, never anything new.
  const block = html.slice(html.indexOf("function recordVitalsBlock("), html.indexOf("function openNotes("));
  assert.ok(block.includes('h["Authorization"]="Bearer "+t') && block.includes('h["X-Staff-Token"]=st.tok'));
  assert.ok(!/localStorage|document\.cookie/.test(block), "no new credential storage");
});

test("vitalSets: the console pairs systolic/diastolic, orders newest first, flags this visit, and ignores what is not a vital sign", () => {
  const html = readFileSync(new URL("../opd.html", import.meta.url), "utf8");
  const fnSrc = html.slice(html.indexOf("function vitalSets("), html.indexOf("function renderVitalSets("));
  const vitalSets = new Function(fnSrc + "; return vitalSets;")();
  const mk = (code, value, unit, at, ticket, extra) => ({ resourceType: "Observation", category: "vital-signs", code, value, unit, meta: { effectiveAt: at, source: { sourceId: "opd-ticket:" + ticket } }, writtenBy: { id: "fb:sister-anu" }, ...(extra || {}) });
  const obs = [
    mk("8480-6", 142, "mm[Hg]", "2026-09-06T10:00:00Z", "T1", { sourceText: "post-op day 1" }),
    mk("8462-4", 91, "mm[Hg]", "2026-09-06T10:00:00Z", "T1"),
    mk("59408-5", 97, "%", "2026-09-06T10:00:00Z", "T1"),
    mk("8867-4", 80, "/min", "2026-09-05T09:00:00Z", "T0"),
    { resourceType: "Observation", category: "laboratory", code: "2823-3", value: 4.1, meta: { effectiveAt: "2026-09-06T11:00:00Z" } },
    { resourceType: "Observation", category: "vital-signs", code: "8867-4", value: "not a number", meta: { effectiveAt: "2026-09-06T12:00:00Z" } },
  ];
  const sets = vitalSets(obs, "T1");
  assert.equal(sets.length, 2);
  assert.equal(sets[0].at, "2026-09-06T10:00:00Z"); assert.equal(sets[0].thisVisit, true);
  assert.deepEqual(sets[0].values.bp, { unit: "mm[Hg]", s: 142, d: 91 });
  assert.deepEqual(sets[0].values["59408-5"], { v: 97, unit: "%" });
  assert.equal(sets[0].note, "post-op day 1");
  assert.equal(sets[1].thisVisit, false); assert.deepEqual(sets[1].values["8867-4"], { v: 80, unit: "/min" });
  assert.deepEqual(vitalSets([], "T1"), []);
  assert.deepEqual(vitalSets(null), []);
});

test("THE PROOF: nurse enters vitals -> record stores Observations -> doctor opens the ticket -> console fetches -> same structured vitals", async () => {
  const h = opdHospital({ "fb:sister-anu": { role: "nurse" }, "fb:dr-menon": { role: "doctor" }, "fb:pharm-1": { role: "pharmacy" } }, { settings: { wardsynq: { migrations: { vitals: "shadow" } } } });
  const ticket = { id: "TKT-77", ghisPatientId: "GH-40233", ghisEpisodeId: "" };
  // 1. The nurse saves vitals on device A (the queue timeline handler calls exactly this).
  const asNurse = new Request("https://x/api/queue/s1/timeline", { method: "POST", headers: { "X-Test-User": "fb:sister-anu" } });
  const saved = await recordVitals(asNurse, ENV, { migration: { mode: "shadow", tenantId: "gimsr" }, session: { orgId: "org-gimsr" }, ticket,
    vitals: { sbp: "138", dbp: "86", pulse: "92", temp: "99.4", tempUnit: "F", spo2: "96", rr: "18", weight: "71.5", note: "on arrival" }, recordedAt: "2026-09-06T09:30:00.000Z",
    actorDeps: { db: h.db, identifyFn: h.deps.identifyFn, claimsFn: h.deps.claimsFn, staffSession: null, orgForTenant: h.deps.orgForTenant, authorizeOrg: h.deps.authorizeOrg },
    recordDeps: { repository: h.repository, pseudonym: async () => null } });
  assert.equal(saved.ok, true); assert.equal(saved.written, 7);
  // 2. The doctor opens the ticket on device B: the console calls the record's Observation endpoint.
  const r = await h.fetchAs("fb:dr-menon")("https://x/api/wardsynq/gimsr/patient/opd-pat-gh-40233/Observation");
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.records.length, 7);
  // 3. The console groups them exactly as the nurse entered them.
  const html = readFileSync(new URL("../opd.html", import.meta.url), "utf8");
  const vitalSets = new Function(html.slice(html.indexOf("function vitalSets("), html.indexOf("function renderVitalSets(")) + "; return vitalSets;")();
  const sets = vitalSets(body.records, "TKT-77");
  assert.equal(sets.length, 1);
  assert.equal(sets[0].thisVisit, true);
  assert.equal(sets[0].note, "on arrival");
  assert.equal(sets[0].by, "fb:sister-anu", "the doctor sees who recorded them, as the server stamped it");
  assert.deepEqual(sets[0].values.bp, { unit: "mm[Hg]", s: 138, d: 86 });
  assert.deepEqual(sets[0].values["8867-4"], { v: 92, unit: "/min" });
  assert.deepEqual(sets[0].values["8310-5"], { v: 99.4, unit: "[degF]" });
  assert.deepEqual(sets[0].values["59408-5"], { v: 96, unit: "%" });
  assert.deepEqual(sets[0].values["9279-1"], { v: 18, unit: "/min" });
  assert.deepEqual(sets[0].values["29463-7"], { v: 71.5, unit: "kg" });
  // 4. Tenant isolation and role scope hold on the read: another hospital's clinician gets nothing,
  //    a pharmacist may read orders but not vitals.
  assert.equal((await h.fetchAs("fb:dr-elsewhere")("https://x/api/wardsynq/gimsr/patient/opd-pat-gh-40233/Observation")).status, 403);
  /* A pharmacist MAY read observations since ORDER_VERIFY (2026-09-07), and that is the point of it:
   * the weight a weight-based dose is checked against, the creatinine, the drug level. They could
   * read none of it before, which is what made pharmacy verification impossible to do honestly. */
  assert.equal((await h.fetchAs("fb:pharm-1")("https://x/api/wardsynq/gimsr/patient/opd-pat-gh-40233/Observation")).status, 200);
  // 5. The read was audited as the doctor, PHI-free.
  const reads = h.repository.audit.filter((a) => a.action === "record.read" && a.actor === "fb:dr-menon");
  assert.ok(reads.length >= 1);
  /* No clinical VALUE in the audit. The timestamp is excluded from the search deliberately: `ts`
   * carries milliseconds, and an ISO instant ending ".138Z" contains "138" all by itself. This
   * assertion used to stringify the whole row and failed roughly once in a thousand runs for that
   * reason alone - a flake that had nothing to do with PHI and would have eroded trust in a real
   * safety assertion. What it means is "no recorded observation value leaked", so it now looks at
   * everything except the clock. */
  const auditBody = JSON.stringify(reads.map(({ ts, ...rest }) => rest));
  assert.ok(!auditBody.includes("138"), "no values in the audit: " + auditBody.slice(0, 400));
  assert.ok(!auditBody.includes("96"), "nor any other reading");
});

/* ------------------------------------------------------------------ the patient-registration migration */

test("registration mapping: exact demographics, no invention; provisional flagged; ABHA only with consent; skip-if-unchanged is order-insensitive", () => {
  const reg = (over) => ({ mrn: "SMD-GIMSR-00042", mrSource: "stewardmd", patient: { name: "Anjali Menon", birthDate: "1959-02-14", approxDob: false, gender: "female" }, ...over });
  const p1 = patientFromRegistration(reg());
  assert.equal(p1.id, "opd-pat-smd-gimsr-00042");
  assert.equal(p1.mrn, "SMD-GIMSR-00042"); assert.equal(p1.name, "Anjali Menon"); assert.equal(p1.dob, "1959-02-14"); assert.equal(p1.sex, "female");
  assert.equal(p1.provisional, false); assert.equal(p1.approxDob, false);
  assert.deepEqual(p1.identifiers, [{ system: "opd-mrn", value: "SMD-GIMSR-00042" }]);
  assert.equal(p1.meta.source.system, "wardsynq-native");

  // Provisional MRN -> provisional Patient. Approximate DOB carried, not silently treated as exact.
  const tmp = patientFromRegistration(reg({ mrn: "TMP-000007", mrSource: "provisional", patient: { name: "Unknown Male", birthDate: "1990-01-01", approxDob: true, gender: "male" } }));
  assert.equal(tmp.id, "opd-pat-tmp-000007"); assert.equal(tmp.provisional, true); assert.equal(tmp.approxDob, true);

  // ABHA WITHOUT recorded consent never travels; WITH consent, it does. Reuses the OPD's own rule.
  const noConsent = patientFromRegistration(reg({ patient: { name: "A", birthDate: "1970-01-01", gender: "female", abhaNumber: "12345678901234", abhaConsent: false } }));
  assert.deepEqual(noConsent.identifiers, [{ system: "opd-mrn", value: "SMD-GIMSR-00042" }]);
  const consented = patientFromRegistration(reg({ patient: { name: "A", birthDate: "1970-01-01", gender: "female", abhaNumber: "12345678901234", abhaAddress: "a@abdm", abhaConsent: true } }));
  assert.deepEqual(consented.identifiers, [{ system: "opd-mrn", value: "SMD-GIMSR-00042" }, { system: "abha-number", value: "12345678901234" }, { system: "abha-address", value: "a@abdm" }]);

  assert.equal(patientFromRegistration({ mrn: "", patient: { name: "X", birthDate: "1970-01-01", gender: "male" } }), null, "no mrn, no identity");

  assert.equal(sameDemographics(p1, patientFromRegistration(reg())), true);
  assert.equal(sameDemographics(p1, patientFromRegistration(reg({ patient: { ...reg().patient, name: "Renamed" } }))), false);
  assert.equal(sameDemographics(null, p1), false);
});

test("registration mode gating mirrors vitals exactly: off unless the flag, the org link and the tenant's opt-in all agree", async () => {
  const org = { id: "org-gimsr", connectTenantId: "gimsr" };
  const tenants = { gimsr: { id: "gimsr", settings: JSON.stringify({ wardsynq: { migrations: { registration: "shadow" } } }) } };
  const deps = { getOrg: async (env, id) => (id === "org-gimsr" ? org : null), tenantRow: async (env, id) => tenants[id] || null };
  assert.deepEqual(await registrationMigration({}, { orgId: "org-gimsr" }, deps), { mode: "off", why: "flag" });
  assert.deepEqual(await registrationMigration({ WARDSYNQ_RECORD: "1" }, { orgId: "org-other" }, deps), { mode: "off", why: "no_tenant" });
  assert.deepEqual(await registrationMigration({ WARDSYNQ_RECORD: "1" }, {}, deps), { mode: "off", why: "no_org" });
  const on = await registrationMigration({ WARDSYNQ_RECORD: "1" }, { orgId: "org-gimsr" }, deps);
  assert.equal(on.mode, "shadow"); assert.equal(on.tenantId, "gimsr");
  // A DIFFERENT settings key from vitals: a tenant on for vitals is not thereby on for registration.
  const bothOff = { gimsr: { id: "gimsr", settings: JSON.stringify({ wardsynq: { migrations: { vitals: "shadow" } } }) } };
  assert.equal((await registrationMigration({ WARDSYNQ_RECORD: "1" }, { orgId: "org-gimsr" }, { ...deps, tenantRow: async (e, id) => bothOff[id] })).mode, "off");
});

test("THE PROOF: registration on device A creates the WardSynQ Patient master; device B opens the same MRN, sees the same demographics, and the vitals already in the record now hang off a real identity", async () => {
  const h = opdHospital({ "fb:desk-1": { role: "reception" }, "fb:sister-anu": { role: "nurse" }, "fb:pharm-1": { role: "pharmacy" } }, { settings: { wardsynq: { migrations: { registration: "shadow", vitals: "shadow" } } } });
  const reg = { mrn: "SMD-GIMSR-00099", mrSource: "stewardmd", pending: false, patient: { name: "Ravi Deshpande", birthDate: "1988-11-02", approxDob: false, gender: "male" } };
  const actorDeps = { db: h.db, identifyFn: h.deps.identifyFn, claimsFn: h.deps.claimsFn, staffSession: null, orgForTenant: h.deps.orgForTenant, authorizeOrg: h.deps.authorizeOrg };
  const recordDeps = { repository: h.repository, pseudonym: async () => null };

  // Vitals for this patient were ALREADY charted before registration ever ran (the realistic order:
  // a walk-in gets vitals at triage before the desk finishes paperwork) — proving req #14: they
  // attach to the SAME id the registration will create, because both derive it from the one MRN.
  const asNurse = new Request("https://x/api/queue/s1/timeline", { method: "POST", headers: { "X-Test-User": "fb:sister-anu" } });
  const vitals = await recordVitals(asNurse, ENV, { migration: { mode: "shadow", tenantId: "gimsr" }, session: { orgId: "org-gimsr" }, ticket: { id: "TKT-99", ghisPatientId: reg.mrn }, vitals: { sbp: "118", dbp: "76", pulse: "72" }, recordedAt: "2026-09-06T08:00:00.000Z", actorDeps, recordDeps });
  assert.equal(vitals.ok, true); assert.equal(vitals.written, 3);
  assert.equal(await h.repository.latest("gimsr", "Patient", "opd-pat-smd-gimsr-00099"), null, "no Patient master exists yet — this is exactly the gap registration closes");

  // Device A: the desk registers. This is exactly what the route calls.
  const asDesk = new Request("https://x/api/queue/patient", { method: "POST", headers: { "X-Test-User": "fb:desk-1" } });
  const out = await registerPatientRecord(asDesk, ENV, { migration: { mode: "shadow", tenantId: "gimsr" }, registration: reg, actorDeps, recordDeps });
  assert.equal(out.ok, true); assert.equal(out.written, 1); assert.equal(out.updated, false);
  assert.equal(out.patientId, "opd-pat-smd-gimsr-00099");
  assert.equal(out.actor, "fb:desk-1"); assert.equal(out.role, "reception");

  // Device B: a different clinician opens the SAME mrn-derived id and gets the same demographics —
  // AND the vitals that were already there, because nothing about registration moved or copied them.
  const doctorB = await client(h, "fb:dr-menon");
  const patient = await doctorB.governed.get(doctorB.actor, "Patient", "opd-pat-smd-gimsr-00099");
  assert.equal(patient.name, "Ravi Deshpande"); assert.equal(patient.mrn, "SMD-GIMSR-00099"); assert.equal(patient.dob, "1988-11-02");
  assert.equal(patient.writtenBy.id, "fb:desk-1", "the audit trail names the actual human who registered, not the doctor now reading it");
  const chart = await doctorB.backend.chart("opd-pat-smd-gimsr-00099");
  assert.equal(chart.Patient.length, 1); assert.equal(chart.Observation.length, 3);

  // Duplicate registration (a re-submitted form, or the desk registering the same returning patient
  // again) cannot create a second Patient: same mrn -> same id, structurally. Unchanged demographics
  // -> nothing is even written, so the append-only history is not padded with identical copies.
  const again = await registerPatientRecord(asDesk, ENV, { migration: { mode: "shadow", tenantId: "gimsr" }, registration: reg, actorDeps, recordDeps });
  assert.equal(again.ok, true); assert.equal(again.written, 0); assert.equal(again.skipped, "unchanged"); assert.equal(again.version, 1);
  assert.equal((await h.repository.history("gimsr", "Patient", "opd-pat-smd-gimsr-00099")).length, 1, "still exactly one version");

  // A genuine correction under the SAME mrn (a typo fixed) is a new version of the SAME identity —
  // never a second patient, never a merge of two different mrns.
  const corrected = await registerPatientRecord(asDesk, ENV, { migration: { mode: "shadow", tenantId: "gimsr" }, registration: { ...reg, patient: { ...reg.patient, name: "Ravi Deshpande Jr" } }, actorDeps, recordDeps });
  assert.equal(corrected.ok, true); assert.equal(corrected.written, 1); assert.equal(corrected.updated, true); assert.equal(corrected.version, 2);
  const hist = await h.repository.history("gimsr", "Patient", "opd-pat-smd-gimsr-00099");
  assert.equal(hist.length, 2); assert.equal(hist[0].name, "Ravi Deshpande"); assert.equal(hist[1].name, "Ravi Deshpande Jr");

  // Wrong tenant cannot reach it.
  const other = await client(h, "fb:dr-elsewhere", { tenantId: "other-hospital" });
  assert.equal(await other.governed.get(other.actor, "Patient", "opd-pat-smd-gimsr-00099"), null);
  assert.equal((await h.fetchAs("fb:dr-elsewhere")("https://x/api/wardsynq/gimsr/record/Patient/opd-pat-smd-gimsr-00099")).status, 403);

  // Unauthorized role: a pharmacist (no QUEUE_ADD) cannot perform the registration mutation, at
  // BOTH the existing OPD door and, independently, the WardSynQ governance behind it.
  const pharmAz = await h.deps.authorizeOrg({}, { kind: "firebase", id: "fb:pharm-1" }, "org-gimsr", CAPS.QUEUE_ADD);
  assert.equal(pharmAz.ok, false); assert.equal(pharmAz.reason, "forbidden", "she IS a member, her ROLE lacks queue.add — the pre-existing OPD-level guard already refuses this");
  const asPharm = new Request("https://x/api/queue/patient", { method: "POST", headers: { "X-Test-User": "fb:pharm-1" } });
  const refused = await registerPatientRecord(asPharm, ENV, { migration: { mode: "shadow", tenantId: "gimsr" }, registration: { mrn: "SMD-GIMSR-00100", mrSource: "stewardmd", patient: { name: "X", birthDate: "1970-01-01", gender: "male" } }, actorDeps, recordDeps });
  /* Refused on SCOPE ("governance") rather than on TIER ("permission"), since ORDER_VERIFY made
   * pharmacy an EXECUTE actor that writes exactly one type. The layer moved; the refusal did not,
   * and no Patient was created. Both doors still say no independently, which is what this asserts. */
  assert.equal(refused.ok, false); assert.equal(refused.status, 403); assert.equal(refused.error, "governance");
  assert.equal(await h.repository.latest("gimsr", "Patient", "opd-pat-smd-gimsr-00100"), null);

  // Every registration write is audited as the real human actor, PHI-free.
  const writes = h.repository.audit.filter((a) => a.action === "record.write" && a.scope.resourceType === "Patient");
  assert.ok(writes.length >= 2);
  assert.ok(writes.every((a) => a.actor === "fb:desk-1"));
  assert.ok(!JSON.stringify(writes).includes("Deshpande"), "no demographics in the audit");
});

test("registration authoritative mode: a governance refusal is surfaced, not swallowed, and the honest limitation is documented — the MRN is not un-allocated", () => {
  const src = readFileSync(new URL("../functions/_wardsynq/migrate-registration.js", import.meta.url), "utf8");
  assert.ok(/MR number.*cannot be undone|cannot be "un-handed-out"/.test(src), "the limitation must be stated in the file, not only in a PR description");
  const routeSrc = readFileSync(new URL("../functions/api/queue/[[path]].js", import.meta.url), "utf8");
  const h = routeSrc.slice(routeSrc.indexOf('if (sub === "register" && method === "POST") {'), routeSrc.indexOf('if (sub === "get" && method === "GET") {'));
  assert.ok(h.indexOf("PAT.registerPatient(") < h.indexOf("registrationMigration("), "Firestore/MRN allocation ALWAYS runs first, in every mode — the allocator is never reordered");
  assert.ok(h.includes('mig.mode === "authoritative" && !rec.ok'));
  assert.ok(h.includes('"record_refused"'));
  // off: the pre-existing single line is still reachable unchanged.
  assert.ok(h.includes("return json(r, 200, request);"));
});

test("off mode is byte-identical: no WardSynQ call is even attempted", async () => {
  const h = opdHospital({ "fb:desk-1": { role: "reception" } });   // no settings => registration migration is off
  const mig = await registrationMigration(ENV, { orgId: "org-gimsr" }, { getOrg: h.deps.orgForTenant ? async () => null : async () => null, tenantRow: async () => null });
  assert.equal(mig.mode, "off");
  const out = await registerPatientRecord(new Request("https://x"), ENV, { migration: mig, registration: { mrn: "X", patient: { name: "Y", birthDate: "1970-01-01", gender: "male" } } });
  assert.deepEqual(out, { mode: "off", tenantId: null, ok: true, skipped: mig.why, written: 0 });
});

/* ------------------------------------------------------------------ the doctor's assessment migration */

test("identity: the assessment shares its encounter id with vitals, so both attach to the same encounter", () => {
  const ticket = { id: "TKT-40", ghisEpisodeId: "EP-40", ghisPatientId: "GH-40" };
  assert.equal(encounterIdForTicket(ticket), "opd-enc-ep-40");
  assert.equal(noteIdForTicket(ticket, "assessment"), "opd-note-ep-40-assessment");
  // No episode id: falls back to the ticket itself, still stable, still distinct from a vitals-only ticket.
  assert.equal(noteIdForTicket({ id: "TKT-41" }, "assessment"), "opd-note-tkt-41-assessment");
  assert.equal(noteIdForTicket({}, "assessment"), null);
  assert.equal(encounterIdForTicket({}), null);
});

test("sectionsFromAssessment: SOAP grouping from GHIS's own field names, nothing invented, everything kept in raw", () => {
  const vals = {
    Chief_complaints_duration: "Epigastric pain, 3 days", History_present_illness: "Worse after meals",
    History_past_illness: "Nil significant", Temp: "98.4", BP_SYS: "128", BP_dia: "82", Pulse: "78", respiratory: "16",
    sys_examination: "Abdomen soft, mild epigastric tenderness", provisional_diagnosis: "GERD",
    management_plan: "Pantoprazole 40mg OD x 2 weeks", refered_management_plan: "",
    Diabetes_yesNo: "N", immunization_status: "UTD",
  };
  const sec = sectionsFromAssessment(vals);
  assert.equal(sec.subjective, "Chief complaints: Epigastric pain, 3 days\nPresent history: Worse after meals\nPast history: Nil significant");
  assert.equal(sec.objective, "Temperature (F): 98.4\nBP: 128/82\nPulse (/min): 78\nRespiratory rate (/min): 16\nSystemic examination: Abdomen soft, mild epigastric tenderness");
  assert.equal(sec.assessment, "Provisional diagnosis: GERD");
  assert.equal(sec.plan, "Management plan: Pantoprazole 40mg OD x 2 weeks");
  assert.deepEqual(sec.raw, vals, "nothing is dropped — every GHIS field the doctor entered is still here");
  assert.equal(sectionsFromAssessment({}).subjective, "");
  assert.deepEqual(sectionsFromAssessment(null).raw, {});
});

test("noteFromAssessment: a canonical ClinicalNote, soap-typed, authored by the actor, no signature claimed", () => {
  const note = noteFromAssessment({ ticket: { id: "TKT-42", ghisEpisodeId: "EP-42", ghisPatientId: "GH-42" }, vals: { provisional_diagnosis: "GERD" }, authorId: "fb:dr-menon" });
  assert.equal(note.resourceType, "ClinicalNote");
  assert.equal(note.id, "opd-note-ep-42-assessment");
  assert.equal(note.patientId, "opd-pat-gh-42"); assert.equal(note.encounterId, "opd-enc-ep-42");
  assert.equal(note.noteType, "soap"); assert.equal(note.authorId, "fb:dr-menon"); assert.equal(note.signedBy, null);
  assert.equal(note.aiDrafted, false);
  assert.equal(note.meta.source.system, "wardsynq-native");
  assert.equal(noteFromAssessment({ ticket: {}, vals: {}, authorId: "x" }), null, "no MRN, no identity, nothing to file under");
  assert.equal(sameNoteContent(note, noteFromAssessment({ ticket: { id: "TKT-42", ghisEpisodeId: "EP-42", ghisPatientId: "GH-42" }, vals: { provisional_diagnosis: "GERD" }, authorId: "fb:dr-menon" })), true);
  assert.equal(sameNoteContent(note, noteFromAssessment({ ticket: { id: "TKT-42", ghisEpisodeId: "EP-42", ghisPatientId: "GH-42" }, vals: { provisional_diagnosis: "Peptic ulcer" }, authorId: "fb:dr-menon" })), false);
});

test("assessment mode gating: its own settings key, independent of vitals or registration", async () => {
  const org = { id: "org-gimsr", connectTenantId: "gimsr" };
  const tenants = { gimsr: { id: "gimsr", settings: JSON.stringify({ wardsynq: { migrations: { assessment: "shadow", vitals: "off" } } }) } };
  const deps = { getOrg: async (env, id) => (id === "org-gimsr" ? org : null), tenantRow: async (env, id) => tenants[id] || null };
  assert.deepEqual(await assessmentMigration({}, { orgId: "org-gimsr" }, deps), { mode: "off", why: "flag" });
  const on = await assessmentMigration({ WARDSYNQ_RECORD: "1" }, { orgId: "org-gimsr" }, deps);
  assert.equal(on.mode, "shadow"); assert.equal(on.tenantId, "gimsr");
  const vitalsOnlyTenant = { gimsr: { id: "gimsr", settings: JSON.stringify({ wardsynq: { migrations: { vitals: "shadow" } } }) } };
  assert.equal((await assessmentMigration({ WARDSYNQ_RECORD: "1" }, { orgId: "org-gimsr" }, { ...deps, tenantRow: async (e, id) => vitalsOnlyTenant[id] })).mode, "off", "a tenant on for vitals is not thereby on for the assessment");
});

test("THE PROOF: doctor device A writes the assessment; device B opens the same patient and reads the SAME sections, encounter and author; a nurse and reception cannot write it; another tenant cannot read it; a repeat save does not duplicate; a correction preserves the original in history", async () => {
  const h = opdHospital({ "fb:dr-menon": { role: "doctor" }, "fb:sister-anu": { role: "nurse" }, "fb:desk-1": { role: "reception" } }, { settings: { wardsynq: { migrations: { assessment: "shadow" } } } });
  const ticket = { id: "TKT-50", ghisEpisodeId: "EP-50", ghisPatientId: "GH-40233" };
  const actorDeps = { db: h.db, identifyFn: h.deps.identifyFn, claimsFn: h.deps.claimsFn, staffSession: null, orgForTenant: h.deps.orgForTenant, authorizeOrg: h.deps.authorizeOrg };
  const recordDeps = { repository: h.repository, pseudonym: async () => null };
  const asDoctor = new Request("https://x/api/queue/timeline", { method: "POST", headers: { "X-Test-User": "fb:dr-menon" } });
  const firstVals = { Chief_complaints_duration: "Epigastric pain 3 days", History_present_illness: "Worse after meals", provisional_diagnosis: "GERD", management_plan: "Pantoprazole 40mg OD" };

  // Device A: the doctor saves.
  const out = await recordAssessment(asDoctor, ENV, { migration: { mode: "shadow", tenantId: "gimsr" }, ticket, vals: firstVals, actorDeps, recordDeps });
  assert.equal(out.ok, true); assert.equal(out.written, 1); assert.equal(out.updated, false);
  assert.equal(out.noteId, "opd-note-ep-50-assessment"); assert.equal(out.actor, "fb:dr-menon"); assert.equal(out.role, "doctor");

  // Device B: a different signed-in doctor opens the same patient and reads the SAME identity.
  const doctorB = await client(h, "fb:dr-menon");
  const note = await doctorB.governed.get(doctorB.actor, "ClinicalNote", "opd-note-ep-50-assessment");
  assert.equal(note.patientId, "opd-pat-gh-40233"); assert.equal(note.encounterId, "opd-enc-ep-50");
  assert.equal(note.sections.assessment, "Provisional diagnosis: GERD");
  assert.equal(note.sections.plan, "Management plan: Pantoprazole 40mg OD");
  assert.equal(note.writtenBy.id, "fb:dr-menon", "the record names the actual authoring doctor");
  // The generic byPatient endpoint the console actually calls — GET .../patient/:id/ClinicalNote.
  const r = await h.fetchAs("fb:dr-menon")("https://x/api/wardsynq/gimsr/patient/opd-pat-gh-40233/ClinicalNote");
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.records.length, 1); assert.equal(body.records[0].sections.subjective.indexOf("Epigastric pain") > -1, true);

  // A nurse cannot write it: refused independently at BOTH layers.
  const nurseAz = await h.deps.authorizeOrg({}, { kind: "firebase", id: "fb:sister-anu" }, "org-gimsr", CAPS.EMR_TREAT);
  assert.equal(nurseAz.ok, false, "the pre-existing OPD-level EMR_TREAT gate already refuses a nurse for kind:assessment");
  const asNurse = new Request("https://x/api/queue/timeline", { method: "POST", headers: { "X-Test-User": "fb:sister-anu" } });
  const nurseTry = await recordAssessment(asNurse, ENV, { migration: { mode: "shadow", tenantId: "gimsr" }, ticket: { id: "TKT-51", ghisEpisodeId: "EP-51", ghisPatientId: "GH-40233" }, vals: { provisional_diagnosis: "should not land" }, actorDeps, recordDeps });
  assert.equal(nurseTry.ok, false); assert.equal(nurseTry.status, 403); assert.equal(nurseTry.error, "governance");
  assert.deepEqual(nurseTry.reasons, ["SCOPE_DENIED"]);
  assert.equal(await h.repository.latest("gimsr", "ClinicalNote", "opd-note-ep-51-assessment"), null);
  // Reception, same story (READ tier plus Patient-only write scope — no ClinicalNote at all).
  const asDesk = new Request("https://x/api/queue/timeline", { method: "POST", headers: { "X-Test-User": "fb:desk-1" } });
  const deskTry = await recordAssessment(asDesk, ENV, { migration: { mode: "shadow", tenantId: "gimsr" }, ticket: { id: "TKT-52", ghisEpisodeId: "EP-52", ghisPatientId: "GH-40233" }, vals: { provisional_diagnosis: "should not land" }, actorDeps, recordDeps });
  assert.equal(deskTry.ok, false); assert.equal(deskTry.status, 403);

  // Another tenant cannot read it.
  const other = await client(h, "fb:dr-elsewhere", { tenantId: "other-hospital" });
  assert.equal(await other.governed.get(other.actor, "ClinicalNote", "opd-note-ep-50-assessment"), null);
  assert.equal((await h.fetchAs("fb:dr-elsewhere")("https://x/api/wardsynq/gimsr/record/ClinicalNote/opd-note-ep-50-assessment")).status, 403);

  // A repeat save (the doctor re-submits, or a retried request) with IDENTICAL content does not
  // duplicate the note: same id, unchanged content, nothing written.
  const again = await recordAssessment(asDoctor, ENV, { migration: { mode: "shadow", tenantId: "gimsr" }, ticket, vals: firstVals, actorDeps, recordDeps });
  assert.equal(again.ok, true); assert.equal(again.written, 0); assert.equal(again.skipped, "unchanged"); assert.equal(again.version, 1);
  assert.equal((await h.repository.history("gimsr", "ClinicalNote", "opd-note-ep-50-assessment")).length, 1);

  // A genuine amendment (the doctor refines the diagnosis) is a NEW version — the original is kept,
  // never destroyed, in the append-only history.
  const amendedVals = { ...firstVals, provisional_diagnosis: "GERD; rule out peptic ulcer" };
  const amended = await recordAssessment(asDoctor, ENV, { migration: { mode: "shadow", tenantId: "gimsr" }, ticket, vals: amendedVals, actorDeps, recordDeps });
  assert.equal(amended.ok, true); assert.equal(amended.written, 1); assert.equal(amended.updated, true); assert.equal(amended.version, 2);
  const hist = await h.repository.history("gimsr", "ClinicalNote", "opd-note-ep-50-assessment");
  assert.equal(hist.length, 2);
  assert.equal(hist[0].sections.assessment, "Provisional diagnosis: GERD", "the original is exactly as it was, not rewritten");
  assert.equal(hist[1].sections.assessment, "Provisional diagnosis: GERD; rule out peptic ulcer");

  // A CONCURRENT stale write is refused, not silently applied over the newer one: two doctors (or
  // two tabs) editing from version 2 cannot both win.
  const staleWrite = await h.fetchAs("fb:dr-menon")("https://x/api/wardsynq/gimsr/record", { method: "POST", body: JSON.stringify({ entity: { ...hist[0], sections: { ...hist[0].sections, plan: "conflicting plan" } }, expectedVersion: 1 }) });
  assert.equal(staleWrite.status, 409);

  // Every write is audited as the real human actor, PHI-free.
  const writes = h.repository.audit.filter((a) => a.action === "record.write" && a.scope.resourceType === "ClinicalNote");
  assert.ok(writes.length >= 2);
  assert.ok(writes.every((a) => a.actor === "fb:dr-menon"));
  assert.ok(!JSON.stringify(writes).includes("Epigastric") && !JSON.stringify(writes).includes("GERD"), "no clinical content in the audit");
});

test("off mode is byte-identical for the assessment write too: no WardSynQ call is even attempted", async () => {
  const out = await recordAssessment(new Request("https://x"), ENV, { migration: { mode: "off", why: "flag" }, ticket: { id: "T", ghisEpisodeId: "E", ghisPatientId: "M" }, vals: { provisional_diagnosis: "x" } });
  assert.deepEqual(out, { mode: "off", tenantId: null, ok: true, skipped: "flag", written: 0 });
});

test("each clinical write is recognised ONLY by its own structured payload, never by the timeline kind alone", () => {
  const src = readFileSync(new URL("../functions/api/queue/[[path]].js", import.meta.url), "utf8");
  const h = src.slice(src.indexOf('if (seg === "timeline") {'), src.indexOf('// Slide-to-checkout'));
  assert.ok(h.includes('const isAssessment = QT.tlKind(body.kind) === "assessment";'));
  // 2026-09-06: the investigation order migration widened this boundary by exactly one case. The
  // dispatcher now names "note", but ONLY together with an `order` payload — so the many other
  // things kind:"note" carries (a free-text clinical note, a referral line) still migrate nothing.
  assert.ok(h.includes('const isInvOrder = QT.tlKind(body.kind) === "note" && !!body.order && typeof body.order === "object";'),
    "a note is an investigation order only when it carries a structured order");
  assert.ok(!/isInvOrder = [^;]*"note";/.test(h), "the kind alone never makes it an order");
  // ...and the prescription migration widened it by exactly one more, on the same rule.
  assert.ok(h.includes('const isPrescription = QT.tlKind(body.kind) === "medication" && !!body.rx && typeof body.rx === "object";'),
    "a medication line is a prescription only when it carries a structured rx");
  assert.ok(!/isPrescription = [^;]*"medication";/.test(h), "the kind alone never makes it a prescription");
  // The client sends the assessment payload only from the assessment save/clear/refer-to-ER actions.
  const emr = readFileSync(new URL("../opd-emr.js", import.meta.url), "utf8");
  assert.equal((emr.match(/vals: buildAssessPayload\(/g) || []).length, 3, "submitAssessment, clearAssessment and consultToER all forward the structured payload");
  // Sliced to each function's OWN body — "submitInvOrder" also appears earlier as a command
  // dispatch, and a fixed character window would run past the end of the function into the next one.
  const fn = (name, end) => emr.slice(emr.indexOf("function " + name + "("), emr.indexOf("function " + end + "("));
  const invOrder = fn("submitInvOrder", "submitPrescribe");
  const prescribe = fn("submitPrescribe", "submitAssessment");
  assert.ok(invOrder.length > 0 && prescribe.length > 0, "both write actions still exist");
  assert.ok(!invOrder.includes("vals:"), "an investigation order does not send structured assessment vals");
  // 2026-09-06: refactored to a `var order = { serviceId: ... }` shared by both the GHIS and the
  // wardsynq-native branch (submitted as `{ order: order }`), rather than an inline literal repeated
  // twice — same structured shape, built once.
  assert.ok(invOrder.includes("var order = { serviceId:"), "an investigation order does send its own structured order");
  assert.ok(invOrder.includes("{ order: order }"), "…and forwards it under the `order` key");
  assert.ok(!invOrder.includes("rx: {"), "an investigation order does not send a prescription payload");
  assert.ok(!prescribe.includes("vals:"), "a prescription does not send structured vals");
  assert.ok(!prescribe.includes("order: {"), "a prescription does not send an investigation order payload");
  assert.ok(prescribe.includes("rx: { drugId:"), "a prescription does send its own structured rx");
  // WardSynQ-native investigation ordering and prescribing both post straight to
  // postWardsynqTimeline; prescribing (2026-09-06, second pass) additionally runs the advisory-only
  // CDSS pre-check first (checkWardsynqRxSafety) and folds its findings into the confirm() text —
  // it still never blocks, per rx-safety.js's own header.
  assert.ok(invOrder.includes('st.source === "wardsynq"'), "investigation orders get a native WardSynQ branch");
  assert.ok(invOrder.includes("postWardsynqTimeline("), "…using the shared native-write helper");
  assert.ok(prescribe.includes('st.source === "wardsynq"'), "prescribing gets a native WardSynQ branch too, now that CDSS is wired in");
  assert.ok(prescribe.includes("checkWardsynqRxSafety("), "…and runs the advisory safety check before the confirm dialog");
  assert.ok(prescribe.includes("postWardsynqTimeline("), "…using the same shared native-write helper");
});

/* ------------------------------------------------------------------ the sign-off (GHIS Authorise) migration */

test("signedNoteFrom: identical content, signedBy set, a fresh recordedAt; nothing else invented", () => {
  const current = noteFromAssessment({ ticket: { id: "T", ghisEpisodeId: "EP-60", ghisPatientId: "GH-60" }, vals: { provisional_diagnosis: "GERD", Chief_complaints_duration: "pain" }, authorId: "fb:dr-menon" });
  current.version = 3; current.writtenBy = { id: "fb:dr-menon", kind: "human", tier: "execute", at: "2026-09-06T09:00:00.000Z" };
  const signed = signedNoteFrom(current, "fb:dr-menon");
  assert.equal(signed.id, current.id); assert.equal(signed.patientId, current.patientId); assert.equal(signed.encounterId, current.encounterId);
  assert.deepEqual(signed.sections, current.sections, "signing changes nothing that was said");
  assert.equal(signed.authorId, "fb:dr-menon"); assert.equal(signed.signedBy, "fb:dr-menon"); assert.equal(signed.noteType, "soap");
  assert.equal(signed.aiDrafted, false);
  assert.ok(signed.meta && signed.meta.recordedAt, "the moment of signing is its own fact");
  assert.equal(signedNoteFrom(null, "x"), null); assert.equal(signedNoteFrom(current, ""), null);
});

test("THE PROOF, sign-off: the doctor authorises on device A; device B reads the same note now signed by the actual doctor; the content is closed to further saves; a second authorise is a no-op; the pre-sign versions survive", async () => {
  const h = opdHospital({ "fb:dr-menon": { role: "doctor" }, "fb:dr-rao": { role: "doctor" }, "fb:sister-anu": { role: "nurse" } }, { settings: { wardsynq: { migrations: { assessment: "shadow" } } } });
  const ticket = { id: "TKT-70", ghisEpisodeId: "EP-70", ghisPatientId: "GH-40233" };
  const actorDeps = { db: h.db, identifyFn: h.deps.identifyFn, claimsFn: h.deps.claimsFn, staffSession: null, orgForTenant: h.deps.orgForTenant, authorizeOrg: h.deps.authorizeOrg };
  const recordDeps = { repository: h.repository, pseudonym: async () => null };
  const mig = { mode: "shadow", tenantId: "gimsr" };
  const asMenon = new Request("https://x/api/queue/timeline", { method: "POST", headers: { "X-Test-User": "fb:dr-menon", "X-Test-RegNo": "AP-12345" } });

  // Nothing to sign yet: an authorise before any save is refused, and no empty note is minted.
  const early = await recordAssessmentSignOff(asMenon, ENV, { migration: mig, ticket, actorDeps, recordDeps });
  assert.equal(early.ok, false); assert.equal(early.status, 422); assert.equal(early.error, "no_note_to_sign");
  assert.equal(await h.repository.latest("gimsr", "ClinicalNote", "opd-note-ep-70-assessment"), null);

  // Two content saves (a draft, then a refinement), then the authorise.
  await recordAssessment(asMenon, ENV, { migration: mig, ticket, vals: { provisional_diagnosis: "GERD" }, actorDeps, recordDeps });
  await recordAssessment(asMenon, ENV, { migration: mig, ticket, vals: { provisional_diagnosis: "GERD; r/o PUD", management_plan: "PPI" }, actorDeps, recordDeps });
  const signed = await recordAssessmentSignOff(asMenon, ENV, { migration: mig, ticket, actorDeps, recordDeps });
  assert.equal(signed.ok, true); assert.equal(signed.written, 1); assert.equal(signed.version, 3); assert.equal(signed.signedBy, "fb:dr-menon"); assert.equal(signed.signOff, true);

  // Device B: another doctor reads it back — signed, by the doctor who actually signed, content intact.
  const rao = await client(h, "fb:dr-rao");
  const note = await rao.governed.get(rao.actor, "ClinicalNote", "opd-note-ep-70-assessment");
  assert.equal(note.version, 3); assert.equal(note.signedBy, "fb:dr-menon"); assert.equal(note.writtenBy.id, "fb:dr-menon");
  assert.equal(note.sections.assessment, "Provisional diagnosis: GERD; r/o PUD"); assert.equal(note.sections.plan, "Management plan: PPI");
  const r = await h.fetchAs("fb:dr-rao")("https://x/api/wardsynq/gimsr/patient/opd-pat-gh-40233/ClinicalNote");
  assert.equal((await r.json()).records[0].signedBy, "fb:dr-menon");

  // Closed: a further content save from ANY doctor is refused, not silently applied over a signature.
  const late = await recordAssessment(asMenon, ENV, { migration: mig, ticket, vals: { provisional_diagnosis: "changed after signing" }, actorDeps, recordDeps });
  assert.equal(late.ok, false); assert.equal(late.status, 409); assert.equal(late.error, "note_signed"); assert.equal(late.signedBy, "fb:dr-menon");
  const asRao = new Request("https://x/api/queue/timeline", { method: "POST", headers: { "X-Test-User": "fb:dr-rao", "X-Test-RegNo": "AP-67890" } });
  const lateRao = await recordAssessment(asRao, ENV, { migration: mig, ticket, vals: { provisional_diagnosis: "another doctor's edit" }, actorDeps, recordDeps });
  assert.equal(lateRao.error, "note_signed");
  // A second authorise is a no-op, not a fourth version.
  const again = await recordAssessmentSignOff(asMenon, ENV, { migration: mig, ticket, actorDeps, recordDeps });
  assert.equal(again.ok, true); assert.equal(again.written, 0); assert.equal(again.skipped, "already_signed"); assert.equal(again.version, 3);
  // The append-only history: draft, refinement, signed — nothing rewritten, nothing lost.
  const hist = await h.repository.history("gimsr", "ClinicalNote", "opd-note-ep-70-assessment");
  assert.deepEqual(hist.map((v) => [v.version, v.signedBy || null, v.sections.assessment]), [
    [1, null, "Provisional diagnosis: GERD"], [2, null, "Provisional diagnosis: GERD; r/o PUD"], [3, "fb:dr-menon", "Provisional diagnosis: GERD; r/o PUD"],
  ]);
  assert.equal(hist.length, 3);

  // The signature is audited as the real human, PHI-free.
  const signWrite = h.repository.audit.find((a) => a.action === "record.write" && a.scope.resourceType === "ClinicalNote" && a.scope.version === 3);
  assert.ok(signWrite); assert.equal(signWrite.actor, "fb:dr-menon");
  assert.ok(!JSON.stringify(signWrite).includes("GERD"));
});

test("who may sign: a doctor with no registration number cannot (NO_CREDENTIAL), a nurse cannot (scope), another tenant cannot read it, and the signature can only ever be the signer's own id", async () => {
  const h = opdHospital({ "fb:dr-menon": { role: "doctor" }, "fb:dr-pin": { role: "doctor" }, "fb:sister-anu": { role: "nurse" } }, { settings: { wardsynq: { migrations: { assessment: "shadow" } } } });
  const ticket = { id: "TKT-71", ghisEpisodeId: "EP-71", ghisPatientId: "GH-40233" };
  const actorDeps = { db: h.db, identifyFn: h.deps.identifyFn, claimsFn: h.deps.claimsFn, staffSession: null, orgForTenant: h.deps.orgForTenant, authorizeOrg: h.deps.authorizeOrg };
  const recordDeps = { repository: h.repository, pseudonym: async () => null };
  const mig = { mode: "shadow", tenantId: "gimsr" };
  // A doctor WITHOUT a registration number (a PIN session, say) saves the content...
  const asPin = new Request("https://x/api/queue/timeline", { method: "POST", headers: { "X-Test-User": "fb:dr-pin" } });
  const saved = await recordAssessment(asPin, ENV, { migration: mig, ticket, vals: { provisional_diagnosis: "GERD" }, actorDeps, recordDeps });
  assert.equal(saved.ok, true);
  // ...and cannot sign it: the store's own NO_CREDENTIAL, surfaced as the reason. The note stays unsigned.
  const noCred = await recordAssessmentSignOff(asPin, ENV, { migration: mig, ticket, actorDeps, recordDeps });
  assert.equal(noCred.ok, false); assert.equal(noCred.status, 403); assert.equal(noCred.error, "governance"); assert.deepEqual(noCred.reasons, ["NO_CREDENTIAL"]);
  assert.equal((await h.repository.latest("gimsr", "ClinicalNote", "opd-note-ep-71-assessment")).signedBy, null);
  assert.equal((await h.repository.history("gimsr", "ClinicalNote", "opd-note-ep-71-assessment")).length, 1);
  // A nurse: no ClinicalNote in her write scope at all.
  const asNurse = new Request("https://x/api/queue/timeline", { method: "POST", headers: { "X-Test-User": "fb:sister-anu" } });
  const nurse = await recordAssessmentSignOff(asNurse, ENV, { migration: mig, ticket, actorDeps, recordDeps });
  assert.equal(nurse.ok, false); assert.equal(nurse.status, 403); assert.ok(nurse.reasons.includes("SCOPE_DENIED"), "no ClinicalNote in her scope; governance also reports NO_CREDENTIAL, every reason at once");
  // The OPD-level gate refuses her before WardSynQ is even consulted: Authorise posts kind:assessment,
  // which the route gates on EMR_TREAT exactly as it always did.
  assert.equal((await h.deps.authorizeOrg({}, { kind: "firebase", id: "fb:sister-anu" }, "org-gimsr", CAPS.EMR_TREAT)).ok, false);
  // A credentialed doctor signs; the signature is HER id, derived from the session, not from the body.
  const asMenon = new Request("https://x/api/queue/timeline", { method: "POST", headers: { "X-Test-User": "fb:dr-menon", "X-Test-RegNo": "AP-12345" } });
  const ok = await recordAssessmentSignOff(asMenon, ENV, { migration: mig, ticket, actorDeps, recordDeps });
  assert.equal(ok.ok, true); assert.equal(ok.signedBy, "fb:dr-menon");
  // Forging through the generic door: a record claiming signedBy someone else is refused by the store.
  const forged = await h.fetchAs("fb:dr-menon", "AP-12345")("https://x/api/wardsynq/gimsr/record", { method: "POST", body: JSON.stringify({ entity: { ...(await h.repository.latest("gimsr", "ClinicalNote", "opd-note-ep-71-assessment")), signedBy: "fb:dr-pin" }, expectedVersion: 2 }) });
  assert.equal(forged.status, 403); assert.deepEqual((await forged.json()).reasons.map((x) => x.code), ["SIGNATURE_NOT_OWN"]);
  // Another tenant cannot read the signed note.
  const other = await client(h, "fb:dr-elsewhere", { tenantId: "other-hospital" });
  assert.equal(await other.governed.get(other.actor, "ClinicalNote", "opd-note-ep-71-assessment"), null);
  assert.equal((await h.fetchAs("fb:dr-elsewhere")("https://x/api/wardsynq/gimsr/record/ClinicalNote/opd-note-ep-71-assessment")).status, 403);
});

test("the defect the sign-off trace found is closed: a kind:assessment write with no fields never wipes a note, and off mode is untouched", async () => {
  const h = opdHospital({ "fb:dr-menon": { role: "doctor" } }, { settings: { wardsynq: { migrations: { assessment: "shadow" } } } });
  const ticket = { id: "TKT-72", ghisEpisodeId: "EP-72", ghisPatientId: "GH-40233" };
  const actorDeps = { db: h.db, identifyFn: h.deps.identifyFn, claimsFn: h.deps.claimsFn, staffSession: null, orgForTenant: h.deps.orgForTenant, authorizeOrg: h.deps.authorizeOrg };
  const recordDeps = { repository: h.repository, pseudonym: async () => null };
  const mig = { mode: "shadow", tenantId: "gimsr" };
  const asMenon = new Request("https://x/api/queue/timeline", { method: "POST", headers: { "X-Test-User": "fb:dr-menon" } });
  await recordAssessment(asMenon, ENV, { migration: mig, ticket, vals: { provisional_diagnosis: "GERD" }, actorDeps, recordDeps });
  // What the old "Authorised (signed off)" and the "Authorised by ..." timeline lines look like to the
  // content path: kind:assessment, text only, no vals. They must be a no-op here, not an empty version.
  const noVals = await recordAssessment(asMenon, ENV, { migration: mig, ticket, vals: undefined, actorDeps, recordDeps });
  assert.equal(noVals.ok, true); assert.equal(noVals.written, 0); assert.equal(noVals.skipped, "no_content");
  const cur = await h.repository.latest("gimsr", "ClinicalNote", "opd-note-ep-72-assessment");
  assert.equal(cur.version, 1); assert.equal(cur.sections.assessment, "Provisional diagnosis: GERD");
  // Off: neither path is entered.
  assert.deepEqual(await recordAssessmentSignOff(new Request("https://x"), ENV, { migration: { mode: "off", why: "flag" }, ticket }), { mode: "off", tenantId: null, signOff: true, ok: true, skipped: "flag", written: 0 });
  // The client marks ONLY the Authorise call as a sign-off; the "Authorised by" follow-up line and every
  // content save do not carry the flag.
  const emr = readFileSync(new URL("../opd-emr.js", import.meta.url), "utf8");
  assert.equal((emr.match(/signOff: true/g) || []).length, 1, "exactly one call site is a sign-off");
  assert.ok(emr.includes('{ kind: "assessment", text: "Authorised (signed off)", signOff: true }'));
  assert.ok(emr.includes("if (signOff) body.signOff = true;"));
  // The console shows the signature as a fact from the record, and says Unsigned otherwise.
  const html = readFileSync(new URL("../opd.html", import.meta.url), "utf8");
  assert.ok(html.includes("Signed by ") && html.includes(">Unsigned<"));
});

/* ------------------------------------------------- the investigation order (GHIS CreateServices) migration */

test("identity: one order id per test per encounter — deterministic, distinct per service, never invented", () => {
  const ticket = { id: "TKT-80", ghisEpisodeId: "EP-80", ghisPatientId: "GH-40233" };
  const a = serviceRequestIdForTicket(ticket, "LAB1118");
  assert.equal(a, "opd-order-ep-80-lab1118");
  assert.equal(serviceRequestIdForTicket(ticket, "LAB1118"), a, "the same test on the same visit is the same order");
  assert.notEqual(serviceRequestIdForTicket(ticket, "P0110"), a, "a different test is a different order");
  // A native (non-GHIS) visit still gets a stable id, anchored on the ticket — the same rule as a note.
  assert.equal(serviceRequestIdForTicket({ id: "TKT-81" }, "LAB1118"), "opd-order-tkt-81-lab1118");
  // Nothing is minted out of nothing.
  assert.equal(serviceRequestIdForTicket(ticket, ""), null);
  assert.equal(serviceRequestIdForTicket(ticket, null), null);
  assert.equal(serviceRequestIdForTicket({}, "LAB1118"), null);
  assert.equal(serviceRequestIdForTicket(null, "LAB1118"), null);
  // It shares its encounter with vitals and the assessment, so all three hang off ONE visit.
  assert.equal(encounterIdForTicket(ticket), "opd-enc-ep-80");
});

test("orderFromInvestigation: a canonical ServiceRequest — GHIS's own service id as the code, the Emergency toggle as priority, the authenticated doctor as requester, nothing guessed", () => {
  const ticket = { id: "TKT-80", ghisEpisodeId: "EP-80", ghisPatientId: "GH-40233" };
  const sr = orderFromInvestigation({ ticket, order: { serviceId: "LAB1118", name: "Complete Blood Count", diagnosis: "Fever, 5 days", emergency: true }, requesterId: "fb:dr-menon" });
  assert.equal(sr.resourceType, "ServiceRequest");
  assert.equal(sr.id, "opd-order-ep-80-lab1118");
  assert.equal(sr.patientId, "opd-pat-gh-40233");
  assert.equal(sr.encounterId, "opd-enc-ep-80");
  assert.equal(sr.code, "LAB1118", "the id the order is actually placed against, not a re-typed name");
  assert.equal(sr.codeSystem, "ghis-service-id", "whose code that is, so nobody reads it as a LOINC");
  assert.equal(sr.display, "Complete Blood Count");
  assert.equal(sr.priority, "stat", "the Emergency toggle");
  assert.equal(sr.reason, "Fever, 5 days");
  assert.equal(sr.requesterId, "fb:dr-menon", "the authenticated clinician, never a typed name");
  assert.equal(sr.status, "active", "GHIS accepted it before this ran, so it is placed, not a draft");
  assert.equal(sr.category, "other", "GHIS does not say lab vs procedure, so this does not pretend to know");
  // Not emergency is the model's own routine; an absent indication or name is simply absent.
  const plain = orderFromInvestigation({ ticket, order: { serviceId: "P0110" }, requesterId: "fb:dr-menon" });
  assert.equal(plain.priority, "routine");
  assert.equal(plain.reason, undefined);
  assert.equal(plain.display, undefined);
  // An order that cannot name what was ordered, who ordered it, or for whom is not an order.
  assert.equal(orderFromInvestigation({ ticket, order: {}, requesterId: "fb:dr-menon" }), null);
  assert.equal(orderFromInvestigation({ ticket, order: { serviceId: "LAB1118" }, requesterId: "" }), null);
  assert.equal(orderFromInvestigation({ ticket: {}, order: { serviceId: "LAB1118" }, requesterId: "fb:dr-menon" }), null);
  assert.equal(orderFromInvestigation({ ticket: { id: "T", ghisEpisodeId: "E" }, order: { serviceId: "LAB1118" }, requesterId: "fb:dr-menon" }), null, "no MRN, so no patient to file under");
});

test("sameOrder: the same test on the same encounter in the same terms; a changed priority or indication is not the same order", () => {
  const base = { code: "LAB1118", patientId: "p", encounterId: "e", priority: "routine", reason: "Fever", status: "active" };
  assert.equal(sameOrder(base, { ...base }), true);
  assert.equal(sameOrder(base, { ...base, priority: "stat" }), false);
  assert.equal(sameOrder(base, { ...base, reason: "Cough" }), false);
  assert.equal(sameOrder(base, { ...base, code: "P0110" }), false);
  assert.equal(sameOrder(base, { ...base, status: "revoked" }), false);
  assert.equal(sameOrder({ ...base, reason: undefined }, { ...base, reason: "" }), true, "absent and empty are the same absence");
  assert.equal(sameOrder(null, base), false);
  assert.equal(sameOrder(base, null), false);
});

test("investigation mode gating: its own settings key, independent of vitals, registration and the assessment", async () => {
  const org = { id: "org-gimsr", connectTenantId: "gimsr" };
  const tenants = { gimsr: { id: "gimsr", settings: JSON.stringify({ wardsynq: { migrations: { investigations: "shadow", assessment: "off" } } }) } };
  const deps = { getOrg: async (env, id) => (id === "org-gimsr" ? org : null), tenantRow: async (env, id) => tenants[id] || null };
  assert.deepEqual(await invOrderMigration({}, { orgId: "org-gimsr" }, deps), { mode: "off", why: "flag" });
  const on = await invOrderMigration({ WARDSYNQ_RECORD: "1" }, { orgId: "org-gimsr" }, deps);
  assert.equal(on.mode, "shadow"); assert.equal(on.tenantId, "gimsr");
  const assessOnly = { gimsr: { id: "gimsr", settings: JSON.stringify({ wardsynq: { migrations: { assessment: "shadow" } } }) } };
  assert.equal((await invOrderMigration({ WARDSYNQ_RECORD: "1" }, { orgId: "org-gimsr" }, { ...deps, tenantRow: async (e, id) => assessOnly[id] })).mode, "off",
    "a tenant on for the assessment is not thereby on for investigations");
});

test("off mode is byte-identical for the investigation order too: no WardSynQ call is even attempted", async () => {
  const out = await recordInvestigationOrder(new Request("https://x"), ENV, { migration: { mode: "off", why: "flag" }, ticket: { id: "T", ghisEpisodeId: "E", ghisPatientId: "M" }, order: { serviceId: "LAB1118" } });
  assert.deepEqual(out, { mode: "off", tenantId: null, ok: true, skipped: "flag", written: 0 });
});

test("a plain note migrates nothing: with the tenant fully on, a kind:note line carrying no order writes no ServiceRequest", async () => {
  const h = opdHospital({ "fb:dr-menon": { role: "doctor" } }, { settings: { wardsynq: { migrations: { investigations: "shadow" } } } });
  const ticket = { id: "TKT-82", ghisEpisodeId: "EP-82", ghisPatientId: "GH-40233" };
  const actorDeps = { db: h.db, identifyFn: h.deps.identifyFn, claimsFn: h.deps.claimsFn, staffSession: null, orgForTenant: h.deps.orgForTenant, authorizeOrg: h.deps.authorizeOrg };
  const recordDeps = { repository: h.repository, pseudonym: async () => null };
  const req = new Request("https://x/api/queue/timeline", { method: "POST", headers: { "X-Test-User": "fb:dr-menon", "X-Test-RegNo": "AP-12345" } });
  const out = await recordInvestigationOrder(req, ENV, { migration: { mode: "shadow", tenantId: "gimsr" }, ticket, order: null, actorDeps, recordDeps });
  assert.equal(out.ok, true); assert.equal(out.written, 0); assert.equal(out.skipped, "no_order");
  assert.equal(await h.repository.latest("gimsr", "ServiceRequest", "opd-order-ep-82-lab1118"), null);
});

test("THE PROOF, investigation order: the doctor orders on device A; device B reads the SAME ServiceRequest; pharmacy may read it and a nurse may not write one; another tenant cannot read it; a double-tap does not order twice; the Emergency toggle and the indication GHIS drops both survive in the record", async () => {
  const h = opdHospital({
    "fb:dr-menon": { role: "doctor" }, "fb:dr-rao": { role: "doctor" },
    "fb:sister-anu": { role: "nurse" }, "fb:pharm-1": { role: "pharmacy" }, "fb:desk-1": { role: "reception" },
  }, { settings: { wardsynq: { migrations: { investigations: "shadow" } } } });
  const ticket = { id: "TKT-80", ghisEpisodeId: "EP-80", ghisPatientId: "GH-40233" };
  const actorDeps = { db: h.db, identifyFn: h.deps.identifyFn, claimsFn: h.deps.claimsFn, staffSession: null, orgForTenant: h.deps.orgForTenant, authorizeOrg: h.deps.authorizeOrg };
  const recordDeps = { repository: h.repository, pseudonym: async () => null };
  const mig = { mode: "shadow", tenantId: "gimsr" };
  const asMenon = new Request("https://x/api/queue/timeline", { method: "POST", headers: { "X-Test-User": "fb:dr-menon", "X-Test-RegNo": "AP-12345" } });

  // Device A: the doctor orders an urgent CBC for a stated indication.
  const first = await recordInvestigationOrder(asMenon, ENV, { migration: mig, ticket, order: { serviceId: "LAB1118", name: "Complete Blood Count", diagnosis: "Fever, 5 days", emergency: true }, actorDeps, recordDeps });
  assert.equal(first.ok, true); assert.equal(first.written, 1); assert.equal(first.updated, false);
  assert.equal(first.orderId, "opd-order-ep-80-lab1118"); assert.equal(first.priority, "stat"); assert.equal(first.actor, "fb:dr-menon");

  // Device B: another doctor reads the same order back, in full, off the same patient.
  const rao = await client(h, "fb:dr-rao");
  const sr = await rao.governed.get(rao.actor, "ServiceRequest", "opd-order-ep-80-lab1118");
  assert.equal(sr.code, "LAB1118"); assert.equal(sr.display, "Complete Blood Count");
  assert.equal(sr.priority, "stat", "the Emergency toggle GHIS itself has no parameter for");
  assert.equal(sr.reason, "Fever, 5 days", "the indication GHIS's orderInvestigation drops");
  assert.equal(sr.status, "active"); assert.equal(sr.requesterId, "fb:dr-menon"); assert.equal(sr.writtenBy.id, "fb:dr-menon");
  const viaApi = await h.fetchAs("fb:dr-rao")("https://x/api/wardsynq/gimsr/patient/opd-pat-gh-40233/ServiceRequest");
  assert.equal(viaApi.status, 200);
  assert.deepEqual((await viaApi.json()).records.map((r) => r.id), ["opd-order-ep-80-lab1118"]);

  // A double-tap, or a retried request, is the SAME order — not a second one.
  const again = await recordInvestigationOrder(asMenon, ENV, { migration: mig, ticket, order: { serviceId: "LAB1118", name: "Complete Blood Count", diagnosis: "Fever, 5 days", emergency: true }, actorDeps, recordDeps });
  assert.equal(again.ok, true); assert.equal(again.written, 0); assert.equal(again.skipped, "already_ordered");
  assert.equal((await h.repository.history("gimsr", "ServiceRequest", "opd-order-ep-80-lab1118")).length, 1);

  // A DIFFERENT test on the same visit is its own order; the first is untouched.
  const second = await recordInvestigationOrder(asMenon, ENV, { migration: mig, ticket, order: { serviceId: "P0110", name: "Chest X-ray" }, actorDeps, recordDeps });
  assert.equal(second.written, 1); assert.equal(second.orderId, "opd-order-ep-80-p0110"); assert.equal(second.priority, "routine");
  const both = await h.fetchAs("fb:dr-rao")("https://x/api/wardsynq/gimsr/patient/opd-pat-gh-40233/ServiceRequest").then((r) => r.json());
  assert.equal(both.records.length, 2);

  // Pharmacy reads orders (that is its whole clinical read scope) and cannot write one.
  const pharm = await client(h, "fb:pharm-1");
  assert.equal((await pharm.governed.get(pharm.actor, "ServiceRequest", "opd-order-ep-80-lab1118")).code, "LAB1118");
  /* Refused, and the class is deliberately not asserted. Since ORDER_VERIFY made pharmacy an EXECUTE
   * actor (it writes its own verification), the refusal now comes from the server's WRITE SCOPE
   * check rather than the client's tier check, so it arrives as RemoteRefusedError instead of
   * GovernanceError. The refusal is the property; which layer said no is not. */
  await assert.rejects(() => pharm.session("opd-pat-gh-40233").put(ServiceRequest({ id: "opd-order-ep-80-x", patientId: "opd-pat-gh-40233", code: "X", requesterId: "fb:pharm-1", status: "active" })));
  assert.equal(await h.repository.latest("gimsr", "ServiceRequest", "opd-order-ep-80-x"), null, "and nothing was written");

  // A nurse orders nothing: ServiceRequest is an instruction type and is not in her write scope.
  const asNurse = new Request("https://x/api/queue/timeline", { method: "POST", headers: { "X-Test-User": "fb:sister-anu" } });
  const nurseTry = await recordInvestigationOrder(asNurse, ENV, { migration: mig, ticket, order: { serviceId: "LAB2000", name: "LFT" }, actorDeps, recordDeps });
  assert.equal(nurseTry.ok, false); assert.equal(nurseTry.status, 403); assert.equal(nurseTry.error, "governance");
  assert.equal(await h.repository.latest("gimsr", "ServiceRequest", "opd-order-ep-80-lab2000"), null, "the refused order was never written");

  // Another tenant cannot read this clinic's orders at all.
  const other = await h.fetchAs("fb:dr-rao")("https://x/api/wardsynq/other-hospital/patient/opd-pat-gh-40233/ServiceRequest");
  assert.ok(other.status === 403 || other.status === 404, "cross-tenant read is refused, got " + other.status);

  // The order is audited as the real human, and the audit row carries no indication text.
  const row = h.repository.audit.find((a) => a.action === "record.write" && a.scope.resourceType === "ServiceRequest");
  assert.ok(row); assert.equal(row.actor, "fb:dr-menon");
  assert.ok(!JSON.stringify(row).includes("Fever"), "the audit trail stays PHI-free");
});

test("the console reads orders back from the record: the generic endpoint, the name over the raw id, and no claim that a result exists", () => {
  const page = readFileSync(new URL("../opd.html", import.meta.url), "utf8");
  assert.ok(page.includes("/ServiceRequest\""), "reads the EXISTING generic record endpoint, no new route");
  assert.ok(page.includes("function recordOrdersBlock("));
  assert.ok(page.includes("o.display||o.code"), "the service name leads, the GHIS id is the fallback");
  assert.ok(page.includes("Results are not recorded here."), "the card must not imply a result exists");
  assert.ok(page.includes("asn-pill stat\">Emergency"), "an emergency order reads at a glance");
});

/* ------------------------------------------------------- the prescription (GHIS CreateDrugs) migration */

test("identity: one prescription id per drug per encounter, and it can never collide with an investigation order", () => {
  const ticket = { id: "TKT-90", ghisEpisodeId: "EP-90", ghisPatientId: "GH-40233" };
  const a = medicationOrderIdForTicket(ticket, "DRG5521");
  assert.equal(a, "opd-rx-ep-90-drg5521");
  assert.equal(medicationOrderIdForTicket(ticket, "DRG5521"), a, "the same drug on the same visit is the same order");
  assert.notEqual(medicationOrderIdForTicket(ticket, "DRG9000"), a, "a different drug is a different order");
  // Separate prefixes, so a drug id and a service id that happen to be spelled alike stay apart.
  assert.notEqual(medicationOrderIdForTicket(ticket, "X1"), serviceRequestIdForTicket(ticket, "X1"));
  assert.equal(medicationOrderIdForTicket({ id: "TKT-91" }, "DRG5521"), "opd-rx-tkt-91-drg5521", "a native visit still gets a stable id");
  assert.equal(medicationOrderIdForTicket(ticket, ""), null);
  assert.equal(medicationOrderIdForTicket(ticket, null), null);
  assert.equal(medicationOrderIdForTicket({}, "DRG5521"), null);
  // It shares its encounter with vitals, the assessment and the investigation order.
  assert.equal(encounterIdForTicket(ticket), "opd-enc-ep-90");
});

test("orderFromPrescription: a canonical MedicationOrder — every field the OPD form captures, the generic kept for the safety engine, and Quantity NEVER mapped into dose", () => {
  const ticket = { id: "TKT-90", ghisEpisodeId: "EP-90", ghisPatientId: "GH-40233" };
  const rx = { drugId: "DRG5521", name: "Tab Paracetamol 650", generic: "paracetamol", route: "Oral", form: "Tablet", qty: "10", frequency: "TDS", duration: "5 days", remarks: "After food" };
  const m = orderFromPrescription({ ticket, rx, prescriberId: "fb:dr-menon", canSign: true });
  assert.equal(m.resourceType, "MedicationOrder");
  assert.equal(m.id, "opd-rx-ep-90-drg5521");
  assert.equal(m.patientId, "opd-pat-gh-40233");
  assert.equal(m.encounterId, "opd-enc-ep-90");
  assert.equal(m.drug, "Tab Paracetamol 650");
  assert.equal(m.drugCode, "DRG5521");
  assert.equal(m.drugCodeSystem, "ghis-drug-id", "whose code that is, so nobody reads it as an RxNorm cui");
  assert.equal(m.genericName, "paracetamol", "wardsynq-safety.js indexes allergy classes and dose limits BY GENERIC");
  assert.equal(m.route, "Oral");
  assert.equal(m.frequency, "TDS");
  assert.equal(m.form, "Tablet");
  assert.equal(m.quantity, "10");
  assert.equal(m.duration, "5 days");
  assert.equal(m.instructions, "After food");
  assert.equal(m.prescriberId, "fb:dr-menon");
  // THE SAFETY POINT: the form has Quantity, not a dose. checkDose() does ceiling arithmetic on
  // dose.value, so mapping "10" there would check the wrong number against a real ceiling.
  assert.equal(m.dose, null, "Quantity is how many to dispense, not how much to give");
  // Nothing the form does not capture is invented.
  for (const absent of ["prn", "prnReason", "timing", "startDate", "endDate", "priority", "indication", "strength"]) {
    assert.equal(m[absent], undefined, "invented field: " + absent);
  }
  // A prescription that cannot name the drug, the patient or the prescriber is not a prescription.
  assert.equal(orderFromPrescription({ ticket, rx: { name: "Tab X" }, prescriberId: "fb:dr-menon", canSign: true }), null, "no drug id");
  assert.equal(orderFromPrescription({ ticket, rx: { drugId: "DRG5521" }, prescriberId: "fb:dr-menon", canSign: true }), null, "no product description");
  assert.equal(orderFromPrescription({ ticket, rx, prescriberId: "", canSign: true }), null, "no prescriber");
  assert.equal(orderFromPrescription({ ticket: { id: "T", ghisEpisodeId: "E" }, rx, prescriberId: "fb:dr-menon", canSign: true }), null, "no MRN");
});

test("the signature decides the lifecycle: a credentialed prescriber signs an active order, an uncredentialed one gets an unsigned DRAFT, and neither ever signs as anyone else", () => {
  const ticket = { id: "TKT-90", ghisEpisodeId: "EP-90", ghisPatientId: "GH-40233" };
  const rx = { drugId: "DRG5521", name: "Tab Paracetamol 650" };
  const signed = orderFromPrescription({ ticket, rx, prescriberId: "fb:dr-menon", canSign: true });
  assert.equal(signed.status, "active", "GHIS accepted it before this ran, so it is placed");
  assert.equal(signed.signedBy, "fb:dr-menon", "the signature is the prescriber's OWN id");
  const unsigned = orderFromPrescription({ ticket, rx, prescriberId: "fb:dr-pin", canSign: false });
  assert.equal(unsigned.status, "draft", "no credential means no signature, so it cannot be active");
  assert.equal(unsigned.signedBy, null, "nothing is fabricated to make it look signed");
  assert.equal(unsigned.prescriberId, "fb:dr-pin", "who entered it is still recorded");
  // The model's own default for AI provenance is false; the STORE overwrites it for an AI actor,
  // which is what makes the guarantee unevadable. Nothing here claims otherwise.
  assert.equal(signed.aiDrafted, false);
});

test("samePrescription: the same drug on the same encounter in the same terms; any changed instruction is a new version", () => {
  const base = { drugCode: "DRG5521", patientId: "p", encounterId: "e", status: "active", route: "Oral", frequency: "TDS", form: "Tablet", quantity: "10", duration: "5 days", instructions: "After food", signedBy: "fb:dr-menon" };
  assert.equal(samePrescription(base, { ...base }), true);
  for (const k of ["route", "frequency", "form", "quantity", "duration", "instructions"]) {
    assert.equal(samePrescription(base, { ...base, [k]: "CHANGED" }), false, k + " changed");
  }
  assert.equal(samePrescription(base, { ...base, drugCode: "DRG9000" }), false);
  assert.equal(samePrescription(base, { ...base, status: "draft" }), false, "a draft is not the same as an active order");
  assert.equal(samePrescription(base, { ...base, signedBy: null }), false, "an unsigned order is not the same as a signed one");
  assert.equal(samePrescription({ ...base, instructions: undefined }, { ...base, instructions: "" }), true, "absent and empty are the same absence");
  assert.equal(samePrescription(null, base), false);
});

test("prescription mode gating: its own settings key, independent of every other migration", async () => {
  const org = { id: "org-gimsr", connectTenantId: "gimsr" };
  const tenants = { gimsr: { id: "gimsr", settings: JSON.stringify({ wardsynq: { migrations: { prescriptions: "shadow", investigations: "off" } } }) } };
  const deps = { getOrg: async (env, id) => (id === "org-gimsr" ? org : null), tenantRow: async (env, id) => tenants[id] || null };
  assert.deepEqual(await prescriptionMigration({}, { orgId: "org-gimsr" }, deps), { mode: "off", why: "flag" });
  const on = await prescriptionMigration({ WARDSYNQ_RECORD: "1" }, { orgId: "org-gimsr" }, deps);
  assert.equal(on.mode, "shadow"); assert.equal(on.tenantId, "gimsr");
  const invOnly = { gimsr: { id: "gimsr", settings: JSON.stringify({ wardsynq: { migrations: { investigations: "shadow" } } }) } };
  assert.equal((await prescriptionMigration({ WARDSYNQ_RECORD: "1" }, { orgId: "org-gimsr" }, { ...deps, tenantRow: async (e, id) => invOnly[id] })).mode, "off",
    "a tenant on for investigations is not thereby on for prescriptions");
});

test("OFF mode is byte-identical for the prescription too, and a medication line with no rx payload writes nothing", async () => {
  const off = await recordPrescription(new Request("https://x"), ENV, { migration: { mode: "off", why: "flag" }, ticket: { id: "T", ghisEpisodeId: "E", ghisPatientId: "M" }, rx: { drugId: "DRG5521", name: "Tab X" } });
  assert.deepEqual(off, { mode: "off", tenantId: null, ok: true, skipped: "flag", written: 0 });

  const h = opdHospital({ "fb:dr-menon": { role: "doctor" } }, { settings: { wardsynq: { migrations: { prescriptions: "shadow" } } } });
  const ticket = { id: "TKT-92", ghisEpisodeId: "EP-92", ghisPatientId: "GH-40233" };
  const actorDeps = { db: h.db, identifyFn: h.deps.identifyFn, claimsFn: h.deps.claimsFn, staffSession: null, orgForTenant: h.deps.orgForTenant, authorizeOrg: h.deps.authorizeOrg };
  const recordDeps = { repository: h.repository, pseudonym: async () => null };
  const req = new Request("https://x/api/queue/timeline", { method: "POST", headers: { "X-Test-User": "fb:dr-menon", "X-Test-RegNo": "AP-12345" } });
  const bare = await recordPrescription(req, ENV, { migration: { mode: "shadow", tenantId: "gimsr" }, ticket, rx: null, actorDeps, recordDeps });
  assert.equal(bare.ok, true); assert.equal(bare.written, 0); assert.equal(bare.skipped, "no_prescription");
  assert.equal(await h.repository.latest("gimsr", "MedicationOrder", "opd-rx-ep-92-drg5521"), null);
});

test("SHADOW does not alter GHIS: prescribing is hard-blocked upstream, and a refused prescription can never reach the record", () => {
  // The GHIS route refuses to prescribe at all until the real CreateDrugs payload is captured.
  const ghis = readFileSync(new URL("../functions/api/ghis/[[path]].js", import.meta.url), "utf8");
  assert.ok(ghis.includes("env.QUEUE_EMR_PRESCRIBE_OK !== '1'"), "the safety hard-block still guards prescribing");
  assert.ok(ghis.includes("prescribe_not_verified"));
  // ...and the client returns on that 501 BEFORE mirroring anything to the timeline, so the
  // migration cannot file a medication order for a prescription that was never actually placed.
  const emr = readFileSync(new URL("../opd-emr.js", import.meta.url), "utf8");
  const body = emr.slice(emr.indexOf("function postWrite("), emr.indexOf("function confirmed("));
  const gate = body.indexOf("res.status === 501");
  const mirror = body.indexOf("addToTimeline(");
  assert.ok(gate >= 0 && mirror >= 0 && gate < mirror, "the 501 early return precedes the timeline mirror");
  assert.ok(/if \(res\.status === 501[^)]*\)[^\n]*return;/.test(body), "a 501 returns, it does not fall through to the mirror");
  // This migration adds no GHIS call and changes no GHIS behaviour. (Its header DISCUSSES GHIS at
  // length, which is the point of the header; what matters is that it never calls anything.)
  const mig = readFileSync(new URL("../functions/_wardsynq/migrate-prescription.js", import.meta.url), "utf8");
  const code = mig.slice(mig.indexOf("import {"));
  assert.ok(!/\bfetch\s*\(/.test(code), "the migration issues no HTTP request of its own");
  assert.ok(!/from\s+["'][^"']*ghis/i.test(code), "the migration imports nothing from the GHIS connector");
  // The one place GHIS is named in the code is the code SYSTEM label default, which is a string,
  // not a call. 2026-09-06: overridable by rx.drugCodeSystem, so a wardsynq-native prescription
  // (no GHIS id at all) is never mislabeled — but "ghis-drug-id" stays the default for every
  // existing caller that never sets it.
  assert.ok(code.includes('str(rx.drugCodeSystem) || "ghis-drug-id"'));
});

test("THE PROOF, prescription: the doctor prescribes on device A; device B reads the SAME structured MedicationOrder; pharmacy may read it and a nurse may not write one; another tenant is denied; a double-tap does not prescribe twice; a changed prescription is version 2 with the original intact", async () => {
  const h = opdHospital({
    "fb:dr-menon": { role: "doctor" }, "fb:dr-rao": { role: "doctor" }, "fb:dr-pin": { role: "doctor" },
    "fb:sister-anu": { role: "nurse" }, "fb:pharm-1": { role: "pharmacy" }, "fb:desk-1": { role: "reception" },
  }, { settings: { wardsynq: { migrations: { prescriptions: "shadow" } } } });
  const ticket = { id: "TKT-90", ghisEpisodeId: "EP-90", ghisPatientId: "GH-40233" };
  const actorDeps = { db: h.db, identifyFn: h.deps.identifyFn, claimsFn: h.deps.claimsFn, staffSession: null, orgForTenant: h.deps.orgForTenant, authorizeOrg: h.deps.authorizeOrg };
  const recordDeps = { repository: h.repository, pseudonym: async () => null };
  const mig = { mode: "shadow", tenantId: "gimsr" };
  const asMenon = new Request("https://x/api/queue/timeline", { method: "POST", headers: { "X-Test-User": "fb:dr-menon", "X-Test-RegNo": "AP-12345" } });
  const rx = { drugId: "DRG5521", name: "Tab Paracetamol 650", generic: "paracetamol", route: "Oral", form: "Tablet", qty: "10", frequency: "TDS", duration: "5 days", remarks: "After food" };

  // Device A: the credentialed doctor prescribes. Patient -> encounter -> prescriber -> order.
  const first = await recordPrescription(asMenon, ENV, { migration: mig, ticket, rx, actorDeps, recordDeps });
  assert.equal(first.ok, true); assert.equal(first.written, 1); assert.equal(first.updated, false);
  assert.equal(first.orderId, "opd-rx-ep-90-drg5521"); assert.equal(first.status, "active"); assert.equal(first.signed, true);
  assert.equal(first.actor, "fb:dr-menon");

  // Device B: another doctor reads the SAME structured order back, in full.
  const rao = await client(h, "fb:dr-rao");
  const m = await rao.governed.get(rao.actor, "MedicationOrder", "opd-rx-ep-90-drg5521");
  assert.equal(m.patientId, "opd-pat-gh-40233"); assert.equal(m.encounterId, "opd-enc-ep-90");
  assert.equal(m.drug, "Tab Paracetamol 650"); assert.equal(m.drugCode, "DRG5521"); assert.equal(m.genericName, "paracetamol");
  assert.equal(m.route, "Oral"); assert.equal(m.frequency, "TDS"); assert.equal(m.form, "Tablet");
  assert.equal(m.quantity, "10"); assert.equal(m.duration, "5 days"); assert.equal(m.instructions, "After food");
  assert.equal(m.dose, null, "no dose was captured, and none was invented");
  assert.equal(m.status, "active"); assert.equal(m.signedBy, "fb:dr-menon");
  assert.equal(m.prescriberId, "fb:dr-menon", "the AUTHENTICATED prescriber, preserved");
  assert.equal(m.writtenBy.id, "fb:dr-menon");
  assert.equal(m.aiDrafted, false, "a human's prescription is never flagged as AI-drafted");
  const viaApi = await h.fetchAs("fb:dr-rao")("https://x/api/wardsynq/gimsr/patient/opd-pat-gh-40233/MedicationOrder");
  assert.equal(viaApi.status, 200);
  assert.deepEqual((await viaApi.json()).records.map((r) => r.id), ["opd-rx-ep-90-drg5521"]);

  // A double-tap, or a retried request, is the SAME prescription — not a second medication order.
  const again = await recordPrescription(asMenon, ENV, { migration: mig, ticket, rx, actorDeps, recordDeps });
  assert.equal(again.ok, true); assert.equal(again.written, 0); assert.equal(again.skipped, "already_prescribed");
  assert.equal((await h.repository.history("gimsr", "MedicationOrder", "opd-rx-ep-90-drg5521")).length, 1);

  // A CHANGED prescription is a new version; the original survives in the append-only history.
  const changed = await recordPrescription(asMenon, ENV, { migration: mig, ticket, rx: { ...rx, frequency: "BD", duration: "3 days" }, actorDeps, recordDeps });
  assert.equal(changed.written, 1); assert.equal(changed.updated, true); assert.equal(changed.version, 2);
  const hist = await h.repository.history("gimsr", "MedicationOrder", "opd-rx-ep-90-drg5521");
  assert.deepEqual(hist.map((v) => [v.version, v.frequency, v.duration]), [[1, "TDS", "5 days"], [2, "BD", "3 days"]]);

  // A DIFFERENT drug on the same visit is its own order.
  const second = await recordPrescription(asMenon, ENV, { migration: mig, ticket, rx: { drugId: "DRG9000", name: "Cap Amoxicillin 500" }, actorDeps, recordDeps });
  assert.equal(second.written, 1); assert.equal(second.orderId, "opd-rx-ep-90-drg9000");

  // Pharmacy reads medication orders (its whole clinical read scope) and can write none.
  const pharm = await client(h, "fb:pharm-1");
  assert.equal((await pharm.governed.get(pharm.actor, "MedicationOrder", "opd-rx-ep-90-drg5521")).drug, "Tab Paracetamol 650");
  // Refused; see the note on the ServiceRequest case above for why the class is not asserted.
  await assert.rejects(() => pharm.session("opd-pat-gh-40233").put(MedicationOrder({ id: "opd-rx-ep-90-x", patientId: "opd-pat-gh-40233", drug: "X", prescriberId: "fb:pharm-1", status: "active" })));
  assert.equal(await h.repository.latest("gimsr", "MedicationOrder", "opd-rx-ep-90-x"), null, "a pharmacist still cannot prescribe");

  // A nurse prescribes nothing: MedicationOrder is an instruction type outside her write scope.
  const asNurse = new Request("https://x/api/queue/timeline", { method: "POST", headers: { "X-Test-User": "fb:sister-anu" } });
  const nurseTry = await recordPrescription(asNurse, ENV, { migration: mig, ticket, rx: { drugId: "DRG7777", name: "Inj Morphine 10mg" }, actorDeps, recordDeps });
  assert.equal(nurseTry.ok, false); assert.equal(nurseTry.status, 403); assert.equal(nurseTry.error, "governance");
  assert.equal(await h.repository.latest("gimsr", "MedicationOrder", "opd-rx-ep-90-drg7777"), null, "the refused prescription was never written");

  // A doctor with no registration number records an unsigned DRAFT, never an unsigned ACTIVE order.
  const asPin = new Request("https://x/api/queue/timeline", { method: "POST", headers: { "X-Test-User": "fb:dr-pin" } });
  const pin = await recordPrescription(asPin, ENV, { migration: mig, ticket, rx: { drugId: "DRG8888", name: "Tab Ibuprofen 400" }, actorDeps, recordDeps });
  assert.equal(pin.ok, true); assert.equal(pin.status, "draft"); assert.equal(pin.signed, false); assert.equal(pin.unsigned, "no_credential");
  const draft = await h.repository.latest("gimsr", "MedicationOrder", "opd-rx-ep-90-drg8888");
  assert.equal(draft.status, "draft"); assert.equal(draft.signedBy, null); assert.equal(draft.prescriberId, "fb:dr-pin");

  // Another tenant cannot read this clinic's medications at all.
  const other = await h.fetchAs("fb:dr-rao")("https://x/api/wardsynq/other-hospital/patient/opd-pat-gh-40233/MedicationOrder");
  assert.ok(other.status === 403 || other.status === 404, "cross-tenant read is refused, got " + other.status);

  // The mutation is audited as the real human, PHI-free.
  const row = h.repository.audit.find((a) => a.action === "record.write" && a.scope.resourceType === "MedicationOrder");
  assert.ok(row); assert.equal(row.actor, "fb:dr-menon");
  assert.ok(!JSON.stringify(row).includes("Paracetamol"), "the audit trail stays PHI-free");
});

test("an AI cannot pass a suggestion off as a clinician's prescription: capped below EXECUTE, and the store stamps the provenance itself", async () => {
  const h = opdHospital({ "fb:dr-menon": { role: "doctor" } }, { settings: { wardsynq: { migrations: { prescriptions: "shadow" } } } });
  const doctor = await client(h, "fb:dr-menon", { regNo: "AP-12345" });
  await doctor.session("opd-pat-ai").put(Patient({ id: "opd-pat-ai", mrn: "GH-AI", name: "AI Test", dob: "1980-01-01" }));
  // The AI acts on behalf of the doctor, and is capped at DRAFT whatever it asks for.
  const ai = aiActorFor(doctor.actor, { id: "maik" });
  assert.equal(ai.kind, "ai");
  assert.equal(ai.tier, "draft", "an AI is capped at DRAFT and can never commit an instruction");
  const rx = (id, over) => MedicationOrder({ id, patientId: "opd-pat-ai", drug: "Tab X", prescriberId: ai.id, ...over });

  // An AI claiming an ACTIVE medication order is refused outright.
  await assert.rejects(
    () => doctor.governed.put(ai, rx("opd-rx-ai-1", { status: "active" })),
    (e) => e instanceof GovernanceError && e.reasons.some((r) => r.code === "EXECUTE_DENIED"),
  );
  // An AI claiming a clinician's SIGNATURE is refused, whatever name it puts in the field.
  await assert.rejects(
    () => doctor.governed.put(ai, rx("opd-rx-ai-2", { signedBy: "fb:dr-menon" })),
    (e) => e instanceof GovernanceError && e.reasons.some((r) => r.code === "NON_HUMAN_SIGNATURE"),
  );
  // An ordinary AI draft is allowed, and comes back stamped aiDrafted whatever it claimed.
  const drafted = await doctor.governed.put(ai, rx("opd-rx-ai-3", { aiDrafted: false }));
  assert.equal(drafted.aiDrafted, true, "provenance is overwritten at the point of writing, not merely policed");
  assert.equal(drafted.status, "draft");
  assert.equal(drafted.signedBy, null);
  // ...and the console renders that distinction rather than hiding it.
  const page = readFileSync(new URL("../opd.html", import.meta.url), "utf8");
  assert.ok(page.includes("m.aiDrafted") && page.includes("AI draft"), "an AI draft is labelled in the UI");
});

test("a malformed medication payload cannot bypass governance or invent a prescription", async () => {
  const h = opdHospital({ "fb:dr-menon": { role: "doctor" } }, { settings: { wardsynq: { migrations: { prescriptions: "shadow" } } } });
  const ticket = { id: "TKT-93", ghisEpisodeId: "EP-93", ghisPatientId: "GH-40233" };
  const actorDeps = { db: h.db, identifyFn: h.deps.identifyFn, claimsFn: h.deps.claimsFn, staffSession: null, orgForTenant: h.deps.orgForTenant, authorizeOrg: h.deps.authorizeOrg };
  const recordDeps = { repository: h.repository, pseudonym: async () => null };
  const mig = { mode: "shadow", tenantId: "gimsr" };
  const asMenon = new Request("https://x/api/queue/timeline", { method: "POST", headers: { "X-Test-User": "fb:dr-menon", "X-Test-RegNo": "AP-12345" } });

  // Junk, and half-formed orders, are refused as unusable — never written as a partial prescription.
  for (const bad of [{}, { drugId: "" }, { name: "Tab X" }, { drugId: "  ", name: "Tab X" }, { drugId: "DRG1", name: "   " }]) {
    const out = await recordPrescription(asMenon, ENV, { migration: mig, ticket, rx: bad, actorDeps, recordDeps });
    assert.equal(out.ok, false, JSON.stringify(bad));
    assert.equal(out.status, 422); assert.equal(out.error, "unusable_prescription"); assert.equal(out.written, 0);
  }
  // A client claiming someone else's signature, an active status or AI provenance changes nothing:
  // the mapper reads none of those from the payload, it derives them from the resolved actor.
  const forged = await recordPrescription(asMenon, ENV, {
    migration: mig, ticket,
    rx: { drugId: "DRG5521", name: "Tab Paracetamol 650", signedBy: "fb:dr-rao", status: "cancelled", prescriberId: "fb:dr-rao", aiDrafted: true, dose: { value: 9999, unit: "mg" } },
    actorDeps, recordDeps,
  });
  assert.equal(forged.ok, true);
  const written = await h.repository.latest("gimsr", "MedicationOrder", "opd-rx-ep-93-drg5521");
  assert.equal(written.signedBy, "fb:dr-menon", "signed by the authenticated actor, never the claimed one");
  assert.equal(written.prescriberId, "fb:dr-menon", "the prescriber is the authenticated actor");
  assert.equal(written.status, "active", "the claimed status is ignored");
  assert.equal(written.aiDrafted, false, "a human write is not marked AI because the payload said so");
  assert.equal(written.dose, null, "a claimed dose is not smuggled past the no-dose-captured rule");
});

test("the console reads prescriptions back from the record: the generic endpoint, clinically ordered, and no claim that a dose was given", () => {
  const page = readFileSync(new URL("../opd.html", import.meta.url), "utf8");
  assert.ok(page.includes("/MedicationOrder\""), "reads the EXISTING generic record endpoint, no new route");
  assert.ok(page.includes("function recordRxBlock("));
  // Drug -> dose/strength -> route -> frequency -> duration -> instructions.
  assert.ok(page.includes("[m.route,m.form,m.quantity,m.frequency,m.duration]"), "the clinically important line, in reading order");
  assert.ok(page.includes("m.instructions"), "instructions are shown");
  assert.ok(page.includes("Dispensing and administration are not recorded here."), "the card must not imply a dose was given");
  // The three lifecycle states that exist today are visually distinct.
  assert.ok(page.includes("RX_STATUS={active:\"Active\",draft:\"Draft, unsigned\",cancelled:\"Discontinued\""));
  assert.ok(page.includes(".asn-pill.rx-on") && page.includes(".asn-pill.rx-off") && page.includes(".asn-pill.rx-ai"));
  assert.ok(page.includes("Signed by ") && page.includes("unsigned"), "signed and unsigned read differently");
});

/* ------------------------------------------------------------- results (GHIS lab + radiology reads) */

function labTicket() { return { id: "TKT-100", ghisEpisodeId: "EP-100", ghisPatientId: "GH-40233" }; }
const LAB_ORDER = { serviceName: "CBC", orderDate: "05-Sep-2026", department: "Haematology", status: "Reported", renderId: "RID-1", episodeId: "EP-100", orderId: "ORD-1" };
const LAB_DETAIL = { group: "CBC", department: "Haematology", sampleType: "Whole blood", collected: "05-Sep-2026 08:10", reported: "05-Sep-2026 11:40", tests: [{ test: "Haemoglobin", result: "10.2", units: "g/dL", low: "13", high: "17", range: "13 - 17", critical: false }, { test: "ESR", result: "40", units: "mm/hr", low: null, high: null, range: "" }] };
const RAD_ORDER = { resultid: "RES-9", visitId: "V1", date: "05-Sep-2026", description: "Chest X-ray", printType: "manual" };
const RAD_DETAIL = { testName: "Chest X-ray PA view", report: "No active parenchymal lesion. Cardiac silhouette normal.", orderDate: "05-Sep-2026", reported: "05-Sep-2026 12:00", doctor: "Dr. Rao", enteredBy: "tech1" };

test("identity: one result id per lab render / radiology resultid per encounter, its own prefix per source, never invented", () => {
  const t = labTicket();
  assert.equal(diagnosticReportIdForTicket(t, "lab", "RID-1"), "opd-dr-lab-ep-100-rid-1");
  assert.equal(diagnosticReportIdForTicket(t, "rad", "RES-9"), "opd-dr-rad-ep-100-res-9");
  assert.equal(diagnosticReportIdForTicket(t, "lab", "RID-1"), diagnosticReportIdForTicket(t, "lab", "RID-1"), "the same render is the same report");
  assert.notEqual(diagnosticReportIdForTicket(t, "lab", "RID-1"), diagnosticReportIdForTicket(t, "rad", "RID-1"), "a lab id and a radiology id never collide even on the same source key");
  assert.equal(diagnosticReportIdForTicket(t, "lab", ""), null);
  assert.equal(diagnosticReportIdForTicket({}, "lab", "RID-1"), null);
});

test("labReportFromResult: a canonical DiagnosticReport plus one Observation per test — LOINC where mapped, GHIS's own name and flag otherwise, nothing invented", () => {
  const issues = [];
  const mapped = labReportFromResult({ ticket: labTicket(), order: LAB_ORDER, detail: LAB_DETAIL }, issues);
  assert.equal(mapped.report.resourceType, "DiagnosticReport");
  assert.equal(mapped.report.id, "opd-dr-lab-ep-100-rid-1");
  assert.equal(mapped.report.patientId, "opd-pat-gh-40233");
  assert.equal(mapped.report.encounterId, "opd-enc-ep-100");
  assert.equal(mapped.report.code, "CBC");
  assert.equal(mapped.report.status, "final", "detail.reported is non-empty");
  assert.equal(mapped.report.conclusion, null, "a panel of discrete values has no narrative");
  assert.equal(mapped.report.critical, false, "GHIS's own flag never sets the canonical field — see the file header");
  assert.equal(mapped.report.sourceKind, "lab");
  assert.equal(mapped.report.sourceSpecimenType, "Whole blood");
  assert.deepEqual(mapped.report.resultObservationIds, mapped.observations.map((o) => o.id));
  assert.equal(mapped.observations.length, 2);
  const hb = mapped.observations.find((o) => o.sourceTestName === "Haemoglobin");
  assert.equal(hb.category, "laboratory");
  assert.equal(hb.code, "718-7", "LAB_CODE_SEED, reused from the ICU adapter, not re-seeded here");
  assert.equal(hb.codeSystem, "LOINC");
  assert.equal(hb.value, 10.2);
  assert.equal(hb.unit, "g/dL");
  assert.deepEqual(hb.referenceRange, { low: 13, high: 17, text: "13 - 17" });
  assert.equal(hb.sourceCritical, false);
  const esr = mapped.observations.find((o) => o.sourceTestName === "ESR");
  assert.equal(esr.codeSystem, "ghis-local", "no seed entry for ESR — kept as its own name, never guessed");
  assert.equal(esr.code, "ESR");
  assert.ok(issues.some((i) => i.code === "RESULT_TEST_UNMAPPED" && i.testName === "ESR"), "the mapping limitation is recorded, not hidden");
  // A result with no anchor, no name, or no test rows is never invented into existence.
  assert.equal(labReportFromResult({ ticket: labTicket(), order: {}, detail: LAB_DETAIL }, []), null, "no service name and no group name");
  assert.equal(labReportFromResult({ ticket: {}, order: LAB_ORDER, detail: LAB_DETAIL }, []), null, "no encounter anchor");
  const noTests = labReportFromResult({ ticket: labTicket(), order: LAB_ORDER, detail: { reported: "x", tests: [{ result: "5" }] } }, []);
  assert.equal(noTests.observations.length, 0, "a test row with no name is skipped, not guessed");
});

test("radiologyReportFromResult: the impression carried verbatim, no discrete observations, and preliminary when there is no report text yet", () => {
  const mapped = radiologyReportFromResult({ ticket: labTicket(), order: RAD_ORDER, detail: RAD_DETAIL }, []);
  assert.equal(mapped.report.id, "opd-dr-rad-ep-100-res-9");
  assert.equal(mapped.report.code, "Chest X-ray PA view", "the detail's own testName is preferred over the order's description");
  assert.equal(mapped.report.status, "final");
  assert.equal(mapped.report.conclusion, "No active parenchymal lesion. Cardiac silhouette normal.");
  assert.deepEqual(mapped.report.resultObservationIds, []);
  assert.equal(mapped.report.sourceKind, "radiology");
  assert.equal(mapped.report.sourceReportedBy, "Dr. Rao");
  assert.equal(mapped.report.sourceEnteredBy, "tech1");
  assert.equal(mapped.observations.length, 0);
  const radIssues = [];
  const unread = radiologyReportFromResult({ ticket: labTicket(), order: RAD_ORDER, detail: { testName: "Chest X-ray", report: "" } }, radIssues);
  assert.equal(unread.report.status, "preliminary", "no report text yet — an unread study is not claimed final");
  assert.equal(unread.report.conclusion, null);
  assert.ok(radIssues.some((i) => i.code === "RESULT_RAD_NO_REPORT"));
});

test("sameReport: idempotent on unchanged content; any changed field is a new version", () => {
  const a = { code: "CBC", patientId: "p", encounterId: "e", status: "final", conclusion: null, resultObservationIds: ["o1"], serviceRequestId: null };
  assert.equal(sameReport(a, { ...a }), true);
  assert.equal(sameReport(a, { ...a, status: "preliminary" }), false);
  assert.equal(sameReport(a, { ...a, resultObservationIds: ["o1", "o2"] }), false, "a changed test list is a new version");
  assert.equal(sameReport(a, { ...a, conclusion: "text" }), false);
  assert.equal(sameReport(a, { ...a, serviceRequestId: "sr1" }), false, "a resolved linkage is itself a change worth a version");
  assert.equal(sameReport(null, a), false);
});

test("results mode gating: its own settings key, independent of every other migration", async () => {
  const org = { id: "org-gimsr", connectTenantId: "gimsr" };
  const tenants = { gimsr: { id: "gimsr", settings: JSON.stringify({ wardsynq: { migrations: { results: "shadow", prescriptions: "off" } } }) } };
  const deps = { getOrg: async (env, id) => (id === "org-gimsr" ? org : null), tenantRow: async (env, id) => tenants[id] || null };
  assert.deepEqual(await resultsMigration({}, { orgId: "org-gimsr" }, deps), { mode: "off", why: "flag" });
  const on = await resultsMigration({ WARDSYNQ_RECORD: "1" }, { orgId: "org-gimsr" }, deps);
  assert.equal(on.mode, "shadow"); assert.equal(on.tenantId, "gimsr");
});

test("OFF mode is byte-identical, and a mirror missing its order or detail writes nothing: GHIS's read is never itself touched by this file", async () => {
  const off = await recordResult(new Request("https://x"), ENV, { migration: { mode: "off", why: "flag" }, ticket: labTicket(), source: "lab", order: LAB_ORDER, detail: LAB_DETAIL });
  assert.deepEqual(off, { mode: "off", tenantId: null, ok: true, skipped: "flag", written: 0 });

  const h = opdHospital({ "fb:dr-menon": { role: "doctor" } }, { settings: { wardsynq: { migrations: { results: "shadow" } } } });
  const actorDeps = { db: h.db, identifyFn: h.deps.identifyFn, claimsFn: h.deps.claimsFn, staffSession: null, orgForTenant: h.deps.orgForTenant, authorizeOrg: h.deps.authorizeOrg };
  const recordDeps = { repository: h.repository, pseudonym: async () => null };
  const req = new Request("https://x/api/queue/result", { method: "POST", headers: { "X-Test-User": "fb:dr-menon", "X-Test-RegNo": "AP-12345" } });
  const bare = await recordResult(req, ENV, { migration: { mode: "shadow", tenantId: "gimsr" }, ticket: labTicket(), source: "lab", order: null, detail: null, actorDeps, recordDeps });
  assert.equal(bare.ok, true); assert.equal(bare.written, 0); assert.equal(bare.skipped, "no_result");

  // This migration issues no HTTP request of its own — the mirror only maps what the client already
  // fetched. GHIS's /lab-detail and /radiology-report routes are untouched by this diff entirely.
  const mig = readFileSync(new URL("../functions/_wardsynq/migrate-results.js", import.meta.url), "utf8");
  const code = mig.slice(mig.indexOf("import {"));
  assert.ok(!/\bfetch\s*\(/.test(code), "the migration issues no HTTP request of its own");
  assert.ok(!/from\s+["'][^"']*_ghis/i.test(code) && !/from\s+["'][^"']*ghis-ward/i.test(code), "no GHIS transport is imported");

  // The client mirrors AFTER GHIS's response is already rendered — the mirror is a pure addition,
  // never a precondition or a replacement for the existing read/render path.
  const emr = readFileSync(new URL("../opd-emr.js", import.meta.url), "utf8");
  const openReportBody = emr.slice(emr.indexOf("function openReport("), emr.indexOf("function mirrorResult("));
  assert.ok(openReportBody.indexOf("st.report.data = res.d; paint();") < openReportBody.indexOf("mirrorResult("), "GHIS's own render happens before the mirror is even called");
});

test("SHADOW does not alter GHIS, and no ingest is patient-facing: the result segment appends nothing to the visit timeline, in either mode", () => {
  const src = readFileSync(new URL("../functions/api/queue/[[path]].js", import.meta.url), "utf8");
  const block = src.slice(src.indexOf('if (seg === "result") {'), src.indexOf('// Slide-to-checkout'));
  assert.ok(block.includes("requireSessionCap(env, actor, s, CAPS.EMR_TREAT)"), "doctor-scoped: see migrate-results.js for why (nurse write scope excludes DiagnosticReport)");
  assert.ok(!block.includes("QT.appendTimeline"), "a result ingest is never mirrored into the visit timeline — no new patient-facing entry, shadow or authoritative");
  assert.ok(block.includes("return json({ ok: true, wardsynq: rec }, 200, request);"), "best-effort either way — GHIS's read already happened and stands regardless of this outcome");
});

test("THE PROOF, lab result: device A's tap mirrors the SAME structured DiagnosticReport device B reads back; reception cannot write one; another tenant is denied; a repeat mirror is idempotent; a changed re-fetch is a new version with the original intact; an existing ServiceRequest is linked by name, never fabricated", async () => {
  const h = opdHospital({
    "fb:dr-menon": { role: "doctor" }, "fb:dr-rao": { role: "doctor" }, "fb:desk-1": { role: "reception" },
  }, { settings: { wardsynq: { migrations: { results: "shadow", investigations: "shadow" } } } });
  const ticket = labTicket();
  const actorDeps = { db: h.db, identifyFn: h.deps.identifyFn, claimsFn: h.deps.claimsFn, staffSession: null, orgForTenant: h.deps.orgForTenant, authorizeOrg: h.deps.authorizeOrg };
  const recordDeps = { repository: h.repository, pseudonym: async () => null };
  const mig = { mode: "shadow", tenantId: "gimsr" };
  const asMenon = new Request("https://x/api/queue/result", { method: "POST", headers: { "X-Test-User": "fb:dr-menon", "X-Test-RegNo": "AP-12345" } });

  // A real investigation order for the SAME service already exists on this encounter (migrated
  // separately, per the investigation-order PR) — the result should link to it by name.
  await recordInvestigationOrder(asMenon, ENV, { migration: { mode: "shadow", tenantId: "gimsr" }, ticket, order: { serviceId: "LAB1118", name: "CBC" }, actorDeps, recordDeps });

  // Device A: the doctor taps the lab row; GHIS answers; the mirror fires.
  const first = await recordResult(asMenon, ENV, { migration: mig, ticket, source: "lab", order: LAB_ORDER, detail: LAB_DETAIL, actorDeps, recordDeps });
  assert.equal(first.ok, true); assert.equal(first.written, 1); assert.equal(first.updated, false);
  assert.equal(first.reportId, "opd-dr-lab-ep-100-rid-1"); assert.equal(first.status, "final");
  assert.equal(first.serviceRequestLinkage, "matched", "exactly one ServiceRequest named \"CBC\" on this encounter");
  assert.equal(first.observationsWritten, 2);

  // Device B: another doctor reads the SAME structured report back, patient -> encounter -> report.
  const rao = await client(h, "fb:dr-rao");
  const dr = await rao.governed.get(rao.actor, "DiagnosticReport", "opd-dr-lab-ep-100-rid-1");
  assert.equal(dr.patientId, "opd-pat-gh-40233"); assert.equal(dr.encounterId, "opd-enc-ep-100");
  assert.equal(dr.code, "CBC"); assert.equal(dr.status, "final");
  assert.ok(dr.serviceRequestId, "linked to the real order, never a manufactured one");
  assert.equal(dr.writtenBy.id, "fb:dr-menon");
  const viaApi = await h.fetchAs("fb:dr-rao")("https://x/api/wardsynq/gimsr/patient/opd-pat-gh-40233/DiagnosticReport");
  assert.equal(viaApi.status, 200);
  assert.deepEqual((await viaApi.json()).records.map((r) => r.id), ["opd-dr-lab-ep-100-rid-1"]);
  const obsResp = await h.fetchAs("fb:dr-rao")("https://x/api/wardsynq/gimsr/patient/opd-pat-gh-40233/Observation");
  const labObs = (await obsResp.json()).records.filter((o) => o.category === "laboratory");
  assert.equal(labObs.length, 2, "the structured values are readable through the SAME existing Observation endpoint vitals already uses");

  // A double-tap / retried mirror of the SAME result is idempotent — not a second report.
  const again = await recordResult(asMenon, ENV, { migration: mig, ticket, source: "lab", order: LAB_ORDER, detail: LAB_DETAIL, actorDeps, recordDeps });
  assert.equal(again.ok, true); assert.equal(again.written, 0); assert.equal(again.skipped, "already_recorded");
  assert.equal((await h.repository.history("gimsr", "DiagnosticReport", "opd-dr-lab-ep-100-rid-1")).length, 1);

  // GHIS later shows a changed value for the SAME render — represented as a new VERSION, original intact.
  const corrected = { ...LAB_DETAIL, tests: [{ ...LAB_DETAIL.tests[0], result: "9.8" }, LAB_DETAIL.tests[1]] };
  const amended = await recordResult(asMenon, ENV, { migration: mig, ticket, source: "lab", order: LAB_ORDER, detail: corrected, actorDeps, recordDeps });
  assert.equal(amended.written, 1); assert.equal(amended.updated, true); assert.equal(amended.version, 2);
  const hist = await h.repository.history("gimsr", "DiagnosticReport", "opd-dr-lab-ep-100-rid-1");
  assert.equal(hist.length, 2);
  assert.equal(hist[0].status, "final", "the original version is untouched, still readable");

  // Reception (no clinical write scope) cannot create a result — nothing lands.
  const asDesk = new Request("https://x/api/queue/result", { method: "POST", headers: { "X-Test-User": "fb:desk-1" } });
  const deskTry = await recordResult(asDesk, ENV, { migration: mig, ticket: { id: "TKT-101", ghisEpisodeId: "EP-101", ghisPatientId: "GH-40233" }, source: "lab", order: { ...LAB_ORDER, renderId: "RID-2", episodeId: "EP-101" }, detail: LAB_DETAIL, actorDeps, recordDeps });
  assert.equal(deskTry.ok, false); assert.equal(deskTry.status, 403); assert.equal(deskTry.error, "governance");
  assert.equal(await h.repository.latest("gimsr", "DiagnosticReport", "opd-dr-lab-ep-101-rid-2"), null);

  // Another tenant cannot read this clinic's results at all.
  const other = await h.fetchAs("fb:dr-rao")("https://x/api/wardsynq/other-hospital/patient/opd-pat-gh-40233/DiagnosticReport");
  assert.ok(other.status === 403 || other.status === 404, "cross-tenant read is refused, got " + other.status);

  // Audited as the real human, PHI-free.
  const row = h.repository.audit.find((a) => a.action === "record.write" && a.scope.resourceType === "DiagnosticReport");
  assert.ok(row); assert.equal(row.actor, "fb:dr-menon");
});

test("THE PROOF, radiology result: the impression is filed verbatim and read back on another device; a result with no matching order is preserved with the limitation recorded, never a fabricated ServiceRequest", async () => {
  const h = opdHospital({ "fb:dr-menon": { role: "doctor" }, "fb:dr-rao": { role: "doctor" } }, { settings: { wardsynq: { migrations: { results: "shadow" } } } });
  const ticket = labTicket();
  const actorDeps = { db: h.db, identifyFn: h.deps.identifyFn, claimsFn: h.deps.claimsFn, staffSession: null, orgForTenant: h.deps.orgForTenant, authorizeOrg: h.deps.authorizeOrg };
  const recordDeps = { repository: h.repository, pseudonym: async () => null };
  const mig = { mode: "shadow", tenantId: "gimsr" };
  const asMenon = new Request("https://x/api/queue/result", { method: "POST", headers: { "X-Test-User": "fb:dr-menon", "X-Test-RegNo": "AP-12345" } });

  // No ServiceRequest named "Chest X-ray PA view" exists on this encounter — nothing here invents one.
  const out = await recordResult(asMenon, ENV, { migration: mig, ticket, source: "radiology", order: RAD_ORDER, detail: RAD_DETAIL, actorDeps, recordDeps });
  assert.equal(out.ok, true); assert.equal(out.written, 1);
  assert.equal(out.serviceRequestLinkage, "unmatched", "the limitation is recorded, not hidden");

  const rao = await client(h, "fb:dr-rao");
  const dr = await rao.governed.get(rao.actor, "DiagnosticReport", "opd-dr-rad-ep-100-res-9");
  assert.equal(dr.conclusion, "No active parenchymal lesion. Cardiac silhouette normal.");
  assert.equal(dr.serviceRequestId, null, "unmatched is left null, never a manufactured order");
  assert.deepEqual(dr.resultObservationIds, [], "radiology has no discrete observations");
  assert.equal(dr.sourceReportedBy, "Dr. Rao");
});

test("matchServiceRequest: exactly one same-named order on the SAME encounter links; zero or several never guess", async () => {
  const h = opdHospital({ "fb:dr-menon": { role: "doctor" } }, { settings: { wardsynq: { migrations: { investigations: "shadow", results: "shadow" } } } });
  const ticket = { id: "TKT-102", ghisEpisodeId: "EP-102", ghisPatientId: "GH-9001" };
  const actorDeps = { db: h.db, identifyFn: h.deps.identifyFn, claimsFn: h.deps.claimsFn, staffSession: null, orgForTenant: h.deps.orgForTenant, authorizeOrg: h.deps.authorizeOrg };
  const recordDeps = { repository: h.repository, pseudonym: async () => null };
  const asMenon = new Request("https://x/api/queue/result", { method: "POST", headers: { "X-Test-User": "fb:dr-menon", "X-Test-RegNo": "AP-12345" } });
  const doctor = await client(h, "fb:dr-menon", { regNo: "AP-12345" });
  const svc = { byPatient: async () => doctor.governed.byPatient(doctor.actor, "ServiceRequest", "opd-pat-gh-9001") };
  // Zero candidates.
  assert.deepEqual(await matchServiceRequest(svc, "opd-pat-gh-9001", "opd-enc-ep-102", "CBC"), { id: null, linkage: "unmatched" });
  await recordInvestigationOrder(asMenon, ENV, { migration: { mode: "shadow", tenantId: "gimsr" }, ticket, order: { serviceId: "LAB1", name: "CBC" }, actorDeps, recordDeps });
  assert.deepEqual((await matchServiceRequest(svc, "opd-pat-gh-9001", "opd-enc-ep-102", "cbc")).linkage, "matched", "case-insensitive");
  // A second, differently-coded order with the SAME name makes the match ambiguous, not a guess.
  await recordInvestigationOrder(asMenon, ENV, { migration: { mode: "shadow", tenantId: "gimsr" }, ticket, order: { serviceId: "LAB2", name: "CBC" }, actorDeps, recordDeps });
  assert.deepEqual(await matchServiceRequest(svc, "opd-pat-gh-9001", "opd-enc-ep-102", "CBC"), { id: null, linkage: "ambiguous" });
  // No encounter to scope the search to: never attempted.
  assert.deepEqual(await matchServiceRequest(svc, "opd-pat-gh-9001", null, "CBC"), { id: null, linkage: "unmatched" });
});

test("the model itself: DiagnosticReport now carries encounterId like every other clinical resource, and the ICU/ward adapter sets it too", () => {
  const dr = DiagnosticReport({ patientId: "p1", encounterId: "e1", code: "CBC" });
  assert.equal(dr.encounterId, "e1");
  assert.equal(DiagnosticReport({ patientId: "p1", code: "CBC" }).encounterId, null, "absent, never invented");
  const adapter = readFileSync(new URL("../wardsynq/adapters/wardsynq-ghis-adapter.js", import.meta.url), "utf8");
  assert.ok(adapter.includes("encounterId: encounter ? encounter.id : null,"), "the existing ICU/ward adapter also links its reports to the encounter now");
});

test("the console reads results back from the record: the existing generic endpoints, no second timeline, no claim beyond what GHIS said", () => {
  const page = readFileSync(new URL("../opd.html", import.meta.url), "utf8");
  assert.ok(page.includes("/DiagnosticReport\""), "reads the EXISTING generic record endpoint, no new route");
  assert.ok(page.includes("function recordResultsBlock("));
  assert.ok(page.includes("if(r.record.results)"), "rendered only on the narrower, explicit key");
  assert.ok(page.includes("Laboratory") && page.includes("Radiology"), "lab and radiology read distinctly");
  assert.ok(page.includes("o.sourceCritical") && page.includes("Critical"), "GHIS's own critical flag is shown, never computed from the range");
  assert.ok(!page.includes("Abnormal"), "no abnormal-vs-range judgement is computed or displayed");
});

/* -------------------------------------------------------------------- the Encounter foundation */

function encTicket(over) {
  return { id: "TKT-200", ghisEpisodeId: "EP-200", ghisPatientId: "GH-90210", status: "registered", registeredAt: 1_800_000_000_000, department: "Medicine OPD", roomId: "R3", ...over };
}

test("identity: a native ticket (no GHIS episode) now anchors on its own id, so it gets an encounter too — every prior migration inherits this for free", () => {
  assert.equal(encounterIdForTicket(encTicket()), "opd-enc-ep-200");
  assert.equal(encounterIdForTicket({ id: "TKT-201" }), "opd-enc-tkt-201", "no episode: falls back to the ticket, same rule anchoredOrderId already uses");
  assert.equal(encounterIdForTicket({}), null, "no episode and no ticket id: still nothing to anchor on");
  assert.equal(encounterIdForTicket(null), null);
});

test("encounterStatusFor: mirrors _queue_eta.js's own terminal/non-terminal split, nothing re-decided", () => {
  assert.equal(encounterStatusFor("registered"), "planned");
  assert.equal(encounterStatusFor("waiting"), "planned");
  assert.equal(encounterStatusFor("called"), "planned");
  assert.equal(encounterStatusFor("in_consultation"), "in-progress");
  assert.equal(encounterStatusFor("investigation"), "in-progress", "sent for a test mid-visit — NEXT allows returning to the queue, so this is not an end state");
  assert.equal(encounterStatusFor("followup"), "in-progress");
  assert.equal(encounterStatusFor("completed"), "finished");
  assert.equal(encounterStatusFor("cancelled"), "cancelled");
  assert.equal(encounterStatusFor("no_show"), "cancelled");
  assert.equal(encounterStatusFor("something_unrecognised"), "planned", "an unrecognised status is never assumed active or closed");
});

test("encounterFromTicket: a canonical Encounter — GHIS's own episode preserved as an identifier, real timestamps, nothing invented beyond what the ticket actually carries", () => {
  const enc = encounterFromTicket({ ticket: encTicket(), attendingId: "fb:dr-menon", tenantId: "gimsr" });
  assert.equal(enc.resourceType, "Encounter");
  assert.equal(enc.id, "opd-enc-ep-200");
  assert.equal(enc.patientId, "opd-pat-gh-90210");
  assert.equal(enc.class, "OPD");
  assert.equal(enc.status, "planned");
  assert.deepEqual(enc.identifiers, [{ system: "opd-ticket-id", value: "TKT-200" }, { system: "ghis-episode-id", value: "EP-200" }]);
  assert.equal(enc.periodStart, new Date(1_800_000_000_000).toISOString(), "the model's own field, from the ticket's real registeredAt — never a generated 'now'");
  assert.equal(enc.periodEnd, null, "not yet closed");
  assert.deepEqual(enc.location, { facilityId: "gimsr", ward: "Medicine OPD", bed: "R3" });
  assert.equal(enc.attendingId, "fb:dr-menon");
  // Closed: periodEnd is set, from consultEndAt when the ticket actually has one.
  const closed = encounterFromTicket({ ticket: encTicket({ status: "completed", consultEndAt: 1_800_003_600_000 }), attendingId: "fb:dr-menon", tenantId: "gimsr" });
  assert.equal(closed.status, "finished");
  assert.equal(closed.periodEnd, new Date(1_800_003_600_000).toISOString());
  // A no-show never entered consultation — no consultEndAt exists, so "now" is the honest answer.
  const noShow = encounterFromTicket({ ticket: encTicket({ status: "no_show" }), tenantId: "gimsr" });
  assert.equal(noShow.status, "cancelled");
  assert.ok(noShow.periodEnd, "still closed, from the moment of closing rather than a timestamp that was never captured");
  // A native ticket with no attending session still gets an encounter, just no bolted-on doctor.
  const native = encounterFromTicket({ ticket: { id: "TKT-9", ghisPatientId: "GH-1", status: "registered", registeredAt: 1_800_000_000_000 } });
  assert.equal(native.id, "opd-enc-tkt-9");
  assert.equal(native.attendingId, null);
  assert.deepEqual(native.identifiers, [{ system: "opd-ticket-id", value: "TKT-9" }], "no GHIS episode identifier invented");
  // No patient, or no anchor at all: not an encounter.
  assert.equal(encounterFromTicket({ ticket: { status: "registered" } }), null);
  assert.equal(encounterFromTicket({ ticket: {} }), null);
});

test("sameEncounter: idempotent on unchanged content; status, location, attending or a closing timestamp changing is a new version", () => {
  const a = encounterFromTicket({ ticket: encTicket(), attendingId: "fb:dr-menon", tenantId: "gimsr" });
  assert.equal(sameEncounter(a, encounterFromTicket({ ticket: encTicket(), attendingId: "fb:dr-menon", tenantId: "gimsr" })), true);
  assert.equal(sameEncounter(a, encounterFromTicket({ ticket: encTicket({ status: "in_consultation" }), attendingId: "fb:dr-menon", tenantId: "gimsr" })), false);
  assert.equal(sameEncounter(a, encounterFromTicket({ ticket: encTicket(), attendingId: "fb:dr-rao", tenantId: "gimsr" })), false, "reassignment is a real change");
  assert.equal(sameEncounter(a, encounterFromTicket({ ticket: encTicket({ roomId: "R7" }), attendingId: "fb:dr-menon", tenantId: "gimsr" })), false);
  assert.equal(sameEncounter(null, a), false);
});

test("encounter mode gating: its own settings key, independent of every other migration", async () => {
  const org = { id: "org-gimsr", connectTenantId: "gimsr" };
  const tenants = { gimsr: { id: "gimsr", settings: JSON.stringify({ wardsynq: { migrations: { encounter: "shadow", vitals: "off" } } }) } };
  const deps = { getOrg: async (env, id) => (id === "org-gimsr" ? org : null), tenantRow: async (env, id) => tenants[id] || null };
  assert.deepEqual(await encounterMigration({}, { orgId: "org-gimsr" }, deps), { mode: "off", why: "flag" });
  const on = await encounterMigration({ WARDSYNQ_RECORD: "1" }, { orgId: "org-gimsr" }, deps);
  assert.equal(on.mode, "shadow"); assert.equal(on.tenantId, "gimsr");
});

test("OFF mode is byte-identical, and a sync with no ticket writes nothing", async () => {
  const off = await recordEncounterSync(new Request("https://x"), ENV, { migration: { mode: "off", why: "flag" }, ticket: encTicket() });
  assert.deepEqual(off, { mode: "off", tenantId: null, ok: true, skipped: "flag", written: 0 });

  const h = opdHospital({ "fb:dr-menon": { role: "doctor" } }, { settings: { wardsynq: { migrations: { encounter: "shadow" } } } });
  const actorDeps = { db: h.db, identifyFn: h.deps.identifyFn, claimsFn: h.deps.claimsFn, staffSession: null, orgForTenant: h.deps.orgForTenant, authorizeOrg: h.deps.authorizeOrg };
  const recordDeps = { repository: h.repository, pseudonym: async () => null };
  const req = new Request("https://x/api/queue/ticket", { method: "POST", headers: { "X-Test-User": "fb:dr-menon", "X-Test-RegNo": "AP-12345" } });
  const bare = await recordEncounterSync(req, ENV, { migration: { mode: "shadow", tenantId: "gimsr" }, ticket: null, actorDeps, recordDeps });
  assert.equal(bare.ok, true); assert.equal(bare.written, 0); assert.equal(bare.skipped, "no_ticket");
});

test("a closed encounter is never reopened or overwritten — not even to the OTHER terminal status — while an identical repeat of the same close is a harmless no-op", async () => {
  const h = opdHospital({ "fb:dr-menon": { role: "doctor" } }, { settings: { wardsynq: { migrations: { encounter: "shadow" } } } });
  const actorDeps = { db: h.db, identifyFn: h.deps.identifyFn, claimsFn: h.deps.claimsFn, staffSession: null, orgForTenant: h.deps.orgForTenant, authorizeOrg: h.deps.authorizeOrg };
  const recordDeps = { repository: h.repository, pseudonym: async () => null };
  const mig = { mode: "shadow", tenantId: "gimsr" };
  const req = new Request("https://x/api/queue/ticket", { method: "POST", headers: { "X-Test-User": "fb:dr-menon", "X-Test-RegNo": "AP-12345" } });
  const session = { doctorUid: "fb:dr-menon" };

  const opened = await recordEncounterSync(req, ENV, { migration: mig, ticket: encTicket(), session, actorDeps, recordDeps });
  assert.equal(opened.written, 1); assert.equal(opened.status, "planned");
  const closed = await recordEncounterSync(req, ENV, { migration: mig, ticket: encTicket({ status: "completed", consultEndAt: 1_800_003_600_000 }), session, actorDeps, recordDeps });
  assert.equal(closed.written, 1); assert.equal(closed.status, "finished");

  // An attempted reopen (a stale "registered" sync arriving after the close) is refused outright.
  const reopen = await recordEncounterSync(req, ENV, { migration: mig, ticket: encTicket({ status: "waiting" }), session, actorDeps, recordDeps });
  assert.equal(reopen.ok, false); assert.equal(reopen.status, 409); assert.equal(reopen.error, "encounter_closed"); assert.equal(reopen.currentStatus, "finished");

  // An attempted CHANGE between the two terminal states is refused too — not just a reopen.
  const flip = await recordEncounterSync(req, ENV, { migration: mig, ticket: encTicket({ status: "cancelled" }), session, actorDeps, recordDeps });
  assert.equal(flip.ok, false); assert.equal(flip.error, "encounter_closed");

  // The SAME close, repeated (a retried checkout), is idempotent — not an error, not a new version.
  const again = await recordEncounterSync(req, ENV, { migration: mig, ticket: encTicket({ status: "completed", consultEndAt: 1_800_003_600_000 }), session, actorDeps, recordDeps });
  assert.equal(again.ok, true); assert.equal(again.written, 0); assert.equal(again.skipped, "unchanged");
  assert.equal((await h.repository.history("gimsr", "Encounter", "opd-enc-ep-200")).length, 2, "open, then close — the refused attempts wrote nothing");
});

test("an unauthorized role cannot open or close an encounter: pharmacy has no Encounter write scope, refused at the record, nothing written", async () => {
  const h = opdHospital({ "fb:pharm-1": { role: "pharmacy" } }, { settings: { wardsynq: { migrations: { encounter: "shadow" } } } });
  const actorDeps = { db: h.db, identifyFn: h.deps.identifyFn, claimsFn: h.deps.claimsFn, staffSession: null, orgForTenant: h.deps.orgForTenant, authorizeOrg: h.deps.authorizeOrg };
  const recordDeps = { repository: h.repository, pseudonym: async () => null };
  const req = new Request("https://x/api/queue/ticket", { method: "POST", headers: { "X-Test-User": "fb:pharm-1" } });
  const out = await recordEncounterSync(req, ENV, { migration: { mode: "shadow", tenantId: "gimsr" }, ticket: encTicket(), session: { doctorUid: "" }, actorDeps, recordDeps });
  /* Refused on SCOPE, one layer deeper than it used to be. Until ORDER_VERIFY (2026-09-07) pharmacy
   * was a READ-tier actor and resolveClinicalActor refused the "record:write" purpose itself ("a
   * READ actor writes nothing at all"), so this came back as "permission". Pharmacy now writes
   * exactly one type - its own verification - which makes it EXECUTE, so it reaches the record and
   * is refused there for having no Encounter write scope, as "governance".
   *
   * The layer moved; the answer did not. That is the point of enumerating the write scope rather
   * than relying on the tier: an EXECUTE actor with a one-item scope can write that one item and
   * nothing else, and this test is what holds that true. */
  assert.equal(out.ok, false); assert.equal(out.status, 403); assert.equal(out.error, "governance");
  assert.equal(await h.repository.latest("gimsr", "Encounter", "opd-enc-ep-200"), null);
});

test("THE PROOF: OPD registration -> WardSynQ Patient -> WardSynQ Encounter -> vitals -> assessment -> investigation order -> prescription -> investigation result, ALL resolving to the SAME encounter; a second device reads every one of them back; a retry does not duplicate the encounter; a status change is a continuation, not a new entity; checkout closes it", async () => {
  const h = opdHospital({
    "fb:dr-menon": { role: "doctor" }, "fb:dr-rao": { role: "doctor" }, "fb:desk-1": { role: "reception" },
  }, { settings: { wardsynq: { migrations: {
    registration: "shadow", vitals: "shadow", assessment: "shadow", investigations: "shadow",
    prescriptions: "shadow", results: "shadow", encounter: "shadow",
  } } } });
  const ticket = encTicket();
  const actorDeps = { db: h.db, identifyFn: h.deps.identifyFn, claimsFn: h.deps.claimsFn, staffSession: null, orgForTenant: h.deps.orgForTenant, authorizeOrg: h.deps.authorizeOrg };
  const recordDeps = { repository: h.repository, pseudonym: async () => null };
  const encounterId = "opd-enc-ep-200";
  const asDesk = new Request("https://x/api/queue/ticket", { method: "POST", headers: { "X-Test-User": "fb:desk-1" } });
  const asMenon = new Request("https://x/api/queue/timeline", { method: "POST", headers: { "X-Test-User": "fb:dr-menon", "X-Test-RegNo": "AP-12345" } });

  // 1. OPD registration -> WardSynQ Patient (the sixth migration, unaffected by this one).
  const reg = await registerPatientRecord(asDesk, ENV, {
    migration: { mode: "shadow", tenantId: "gimsr" },
    registration: { mrn: "GH-90210", mrSource: "hospital", patient: { name: "Ward Test Patient", birthDate: "1985-01-01", gender: "female" } },
    actorDeps, recordDeps,
  });
  assert.equal(reg.ok, true); assert.equal(reg.patientId, "opd-pat-gh-90210");

  // 2. Reception checks the patient in for today's visit -> WardSynQ Encounter (THIS migration).
  //    Reception holds QUEUE_ADD, and QUEUE_ADD now grants Encounter write scope alongside Patient.
  const opened = await recordEncounterSync(asDesk, ENV, { migration: { mode: "shadow", tenantId: "gimsr" }, ticket, session: { doctorUid: "" }, actorDeps, recordDeps });
  assert.equal(opened.ok, true); assert.equal(opened.written, 1); assert.equal(opened.encounterId, encounterId); assert.equal(opened.status, "planned");

  // A retried "add ticket" (a network blip on the desk's tablet) resolves to the SAME encounter.
  const retried = await recordEncounterSync(asDesk, ENV, { migration: { mode: "shadow", tenantId: "gimsr" }, ticket, session: { doctorUid: "" }, actorDeps, recordDeps });
  assert.equal(retried.written, 0); assert.equal(retried.skipped, "unchanged");
  assert.equal((await h.repository.history("gimsr", "Encounter", encounterId)).length, 1, "no duplicate Encounter from the retry");

  // 3. The doctor is seen — a status change to in_consultation is a CONTINUATION, not a new entity.
  const inConsult = await recordEncounterSync(asMenon, ENV, { migration: { mode: "shadow", tenantId: "gimsr" }, ticket: encTicket({ status: "in_consultation", consultStartAt: 1_800_001_000_000 }), session: { doctorUid: "fb:dr-menon" }, actorDeps, recordDeps });
  assert.equal(inConsult.written, 1); assert.equal(inConsult.status, "in-progress");
  assert.equal((await h.repository.history("gimsr", "Encounter", encounterId)).length, 2, "one more VERSION of the same entity, not a second one");

  // 4. Nurse vitals, 5. doctor assessment, 6. investigation order, 7. prescription, 8. investigation
  //    result — every one of the five prior migrations, unmodified, all sharing this encounter.
  const vitalsOut = await recordVitals(asMenon, ENV, { migration: { mode: "shadow", tenantId: "gimsr" }, ticket, vitals: { hr: 88, spo2: 98 }, recordedAt: new Date().toISOString(), actorDeps, recordDeps });
  assert.equal(vitalsOut.ok, true);
  const assessOut = await recordAssessment(asMenon, ENV, { migration: { mode: "shadow", tenantId: "gimsr" }, ticket, vals: { provisional_diagnosis: "Viral fever" }, actorDeps, recordDeps });
  assert.equal(assessOut.ok, true);
  const orderOut = await recordInvestigationOrder(asMenon, ENV, { migration: { mode: "shadow", tenantId: "gimsr" }, ticket, order: { serviceId: "LAB1118", name: "CBC" }, actorDeps, recordDeps });
  assert.equal(orderOut.ok, true);
  const rxOut = await recordPrescription(asMenon, ENV, { migration: { mode: "shadow", tenantId: "gimsr" }, ticket, rx: { drugId: "DRG1", name: "Tab Paracetamol 650" }, actorDeps, recordDeps });
  assert.equal(rxOut.ok, true);
  const resultOut = await recordResult(asMenon, ENV, {
    migration: { mode: "shadow", tenantId: "gimsr" }, ticket, source: "lab",
    order: { serviceName: "CBC", renderId: "RID-200", episodeId: "EP-200" },
    detail: { group: "CBC", reported: "05-Sep-2026 12:00", tests: [{ test: "Haemoglobin", result: "12.5", units: "g/dL" }] },
    actorDeps, recordDeps,
  });
  assert.equal(resultOut.ok, true);

  // 9. checkout: the visit ends -> the Encounter closes.
  const closedSync = await recordEncounterSync(asMenon, ENV, { migration: { mode: "shadow", tenantId: "gimsr" }, ticket: encTicket({ status: "completed", consultStartAt: 1_800_001_000_000, consultEndAt: 1_800_004_000_000 }), session: { doctorUid: "fb:dr-menon" }, actorDeps, recordDeps });
  assert.equal(closedSync.written, 1); assert.equal(closedSync.status, "finished");

  // Device B: a DIFFERENT doctor opens the same patient and reads EVERY resource off the SAME
  // Encounter — Patient -> Encounter -> {Observation, ClinicalNote, ServiceRequest, MedicationOrder,
  // DiagnosticReport}, none of them a dangling reference, all six resolving to one real entity.
  const rao = await client(h, "fb:dr-rao");
  const patient = await rao.governed.get(rao.actor, "Patient", "opd-pat-gh-90210");
  assert.equal(patient.name, "Ward Test Patient");
  const encounter = await rao.governed.get(rao.actor, "Encounter", encounterId);
  assert.equal(encounter.patientId, "opd-pat-gh-90210");
  assert.equal(encounter.status, "finished");
  assert.equal(encounter.class, "OPD");
  assert.equal(encounter.version, 3, "open, in-progress, finished — three real versions of ONE entity");

  const vitalsRow = (await rao.governed.byPatient(rao.actor, "Observation", "opd-pat-gh-90210")).find((o) => o.category === "vital-signs");
  assert.equal(vitalsRow.encounterId, encounterId);
  const note = await rao.governed.get(rao.actor, "ClinicalNote", "opd-note-ep-200-assessment");
  assert.equal(note.encounterId, encounterId);
  const order = await rao.governed.get(rao.actor, "ServiceRequest", "opd-order-ep-200-lab1118");
  assert.equal(order.encounterId, encounterId);
  const rx = await rao.governed.get(rao.actor, "MedicationOrder", "opd-rx-ep-200-drg1");
  assert.equal(rx.encounterId, encounterId);
  const report = await rao.governed.get(rao.actor, "DiagnosticReport", "opd-dr-lab-ep-200-rid-200");
  assert.equal(report.encounterId, encounterId);

  // Wrong tenant is denied for the Encounter exactly as for every other resource type.
  const cross = await h.fetchAs("fb:dr-rao")("https://x/api/wardsynq/other-hospital/patient/opd-pat-gh-90210/Encounter");
  assert.ok(cross.status === 403 || cross.status === 404, "cross-tenant read is refused, got " + cross.status);

  // Nothing here was ever an instruction to a patient — recording that a visit happened is a
  // statement of fact, so a doctor/receptionist opening/closing it is audited, not "signed".
  const row = h.repository.audit.find((a) => a.action === "record.write" && a.scope.resourceType === "Encounter" && a.scope.version === 1);
  assert.ok(row); assert.equal(row.actor, "fb:desk-1");
});

test("SHADOW does not alter GHIS or the queue engine: the migration issues no HTTP request of its own and never imports the queue engine", () => {
  const mig = readFileSync(new URL("../functions/_wardsynq/migrate-encounter.js", import.meta.url), "utf8");
  const code = mig.slice(mig.indexOf("import {"));
  assert.ok(!/\bfetch\s*\(/.test(code), "no HTTP request of its own");
  assert.ok(!/from\s+["'][^"']*_queue_/i.test(code), "never imports the queue engine — a pure mapper over the ticket it is handed, like every sibling migrate-*.js");
  assert.ok(!/from\s+["'][^"']*ghis/i.test(code), "never touches GHIS");
});

// 2026-09-06 (part 3): investigation ORDER search for a wardsynq-native hospital. There is no GHIS
// catalog to search, so the write path from part 2 was wired to nothing a doctor could actually pick.
// Reuses the org's EXISTING billing-tariff store (kind:"investigation"|"medication" rows) as the
// catalog - deliberately NOT gated behind CLINIC_BILLING_ENABLED, since whether invoicing is on is
// unrelated to whether a doctor may order a test or a drug. Medication reuses the SAME route
// (?kind=medication), added in part 4 alongside native prescribing.
test("native investigation-order search: reuses the existing tariff catalog, session-scoped, not billing-gated", () => {
  const src = readFileSync(new URL("../functions/api/queue/[[path]].js", import.meta.url), "utf8");
  const route = src.slice(src.indexOf('seg === "inv-catalog"'), src.indexOf('seg === "opd-board"'));
  assert.ok(route.includes("BILL.listTariff("), "reuses the existing tariff store — no new catalog system");
  assert.ok(route.includes('t.kind === wantKind'), "filters to the requested kind only (investigation default, medication opt-in)");
  assert.ok(route.includes('"medication" ? "medication" : "investigation"'), "medication catalog reuses the SAME route via ?kind=");
  assert.ok(!route.includes("billingEnabled"), "must not be gated behind the global billing flag");
  assert.ok(route.includes("loadSessionFor("), "session-scoped like every other client-facing route, not a raw orgId param");
  assert.ok(route.includes("CAPS.EMR_TREAT"), "same capability the doctor's other clinical writes require");

  const emr = readFileSync(new URL("../opd-emr.js", import.meta.url), "utf8");
  const runSearch = emr.slice(emr.indexOf("function runSearch("), emr.indexOf("function runSearch(") + 800);
  // 2026-09-06 (part 4): generalized to both kinds (investigation AND medication) once native
  // prescribing needed its own drug catalog too — same mechanism, one shared function.
  assert.ok(runSearch.includes('if (st.source === "wardsynq")'), "wardsynq routes to the native catalog for BOTH kinds");
  const wsqSearch = emr.slice(emr.indexOf("function runWardsynqCatalogSearch("), emr.indexOf("function runSearch("));
  assert.ok(wsqSearch.includes("/api/queue/inv-catalog"), "hits the new native catalog endpoint");
  assert.ok(wsqSearch.includes("fbTok()"), "Firebase-authed like every other native write/read, never ghisAuth()");
  assert.ok(!wsqSearch.includes("ghisAuth"), "never touches the GHIS proxy");
});

// 2026-09-06 (part 4): native prescribing, gated on the advisory-only CDSS pre-check existing.
test("native prescribing: the GET /rx-safety pre-check NEVER gates, reuses wsqForcedMigration, and degrades safely for a non-wardsynq/unlinked org", () => {
  const src = readFileSync(new URL("../functions/api/queue/[[path]].js", import.meta.url), "utf8");
  const route = src.slice(src.indexOf('seg === "rx-safety"'), src.indexOf('method === "GET" && seg === "opd-board"'));
  assert.ok(route.includes("wsqForcedMigration(env, wOrg)"), "reuses the SAME shared helper — no separate org.mode check invented");
  assert.ok(route.includes("checkPrescriptionSafety("), "delegates the actual evaluation to rx-safety.js");
  assert.ok(route.includes("degraded: true"), "a non-wardsynq or unlinked org gets a safe degraded advisory, not an error that could be mistaken for a block");
  assert.ok(route.includes("loadSessionFor("), "session-scoped like every other clinical route");
  assert.ok(route.includes("CAPS.EMR_TREAT"));
  // rx-safety.js itself: the file this route delegates to.
  const rx = readFileSync(new URL("../functions/_wardsynq/rx-safety.js", import.meta.url), "utf8");
  assert.ok(!/\ballowed\b/.test(rx.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), "no 'allowed' concept anywhere in the actual code — this file cannot gate by construction");
  assert.ok(rx.includes("unapproved: true"), "every shaped response is labeled unapproved");
  assert.ok(rx.includes("catch (e)"), "a read/actor-resolution failure degrades rather than throwing into the prescription write");
});

/* ------------------------------------------------------------------ allergy capture, best-effort, from the existing assessment form */

// 2026-09-06 (part 5): "Complete it" - the allergy capture the CDSS wiring was missing. Reuses the
// assessment form's EXISTING Known_allergies_details field (no new UI). Every test here is written
// against the file's own stated bias: a MISSED allergy degrades to today's baseline (nothing), a
// FABRICATED one would be worse than nothing - so nothing here may ever invent a substance,
// severity or reaction the text did not support.
const ALLERGY_TEST_PACK = compileTestRulePack({
  version: "test-allergy-1",
  generics: ["amoxicillin", "ibuprofen", "aspirin", "paracetamol"],
  allergyClasses: { penicillins: ["amoxicillin"] },
});

test("parseAllergyFreeText: denies explicitly writes nothing; empty writes nothing; a real substance resolves; nonsense stays honestly unresolved", () => {
  assert.deepEqual(parseAllergyFreeText("", ALLERGY_TEST_PACK), { raw: "", denies: false, entries: [] });
  assert.deepEqual(parseAllergyFreeText("NKDA", ALLERGY_TEST_PACK), { raw: "NKDA", denies: true, entries: [] });
  assert.deepEqual(parseAllergyFreeText("No known drug allergies", ALLERGY_TEST_PACK).denies, true);
  assert.deepEqual(parseAllergyFreeText("Denies any allergies", ALLERGY_TEST_PACK).denies, true);
  const resolved = parseAllergyFreeText("Amoxicillin - rash", ALLERGY_TEST_PACK);
  assert.equal(resolved.denies, false);
  assert.equal(resolved.entries.length, 1);
  assert.equal(resolved.entries[0].substance, "amoxicillin");
  assert.equal(resolved.entries[0].resolved, true);
  assert.equal(resolved.entries[0].reportedText, "Amoxicillin - rash");
  const unresolved = parseAllergyFreeText("some vague thing nobody knows", ALLERGY_TEST_PACK);
  assert.equal(unresolved.entries[0].substance, "unspecified", "unresolved text is recorded as unspecified, never guessed");
  assert.equal(unresolved.entries[0].resolved, false);
});

/* 2026-09-07. The denial detector only matched ADJACENT words ("no known allergies", "denies any
 * allergies"). Put a drug name between them - which is how doctors actually write it - and none of
 * those alternatives matched: the fragment fell through to resolveAllergySubstance(), the drug name
 * resolved, and the chart gained a RESOLVED allergy for a patient the note documents as NOT
 * allergic. That is the fabrication migrate-allergy.js's header calls worse than nothing, and it is
 * not cosmetic: the Allergy Shield then reports the class contraindicated and a first-line
 * antibiotic is withheld from someone who can safely take it. Five plausible phrasings did it. */
test("parseAllergyFreeText: a DENIED substance is never recorded as an allergy (no fabrication from negated text)", () => {
  for (const denial of [
    "no known amoxicillin allergy",
    "denies amoxicillin allergy",
    "not allergic to amoxicillin",
    "amoxicillin allergy ruled out",
    "no amoxicillin allergy",
    "patient denies penicillin allergy",
  ]) {
    const p = parseAllergyFreeText(denial, ALLERGY_TEST_PACK);
    assert.deepEqual(p.entries, [], `"${denial}" must record nothing at all`);
    assert.equal(p.denies, true, `"${denial}" is a denial`);
  }
});

test("parseAllergyFreeText: a real allergy beside a denial keeps the allergy and drops only the denied half", () => {
  // Before the fix this returned NOTHING: the whole-text denial check saw "no known ... allerg" and
  // discarded the genuine penicillin allergy sitting in front of it.
  const p = parseAllergyFreeText("Amoxicillin - rash, no known food allergies", ALLERGY_TEST_PACK);
  assert.deepEqual(p.entries.map((e) => e.substance), ["amoxicillin"], "the real allergy survives");
  assert.equal(p.denies, false);
  // And the denied half must not be filed as an "unspecified" line that reads like a reported allergy.
  assert.ok(!p.entries.some((e) => e.substance === "unspecified"));
});

test("parseAllergyFreeText: the negation filter does not eat drug-class names containing 'non'", () => {
  // "non" is deliberately NOT a negation token - it is ordinary vocabulary in class names, and
  // treating it as one would silently discard real NSAID allergies.
  const pack = compileTestRulePack({ version: "t2", generics: ["ibuprofen"], allergyClasses: { nsaids: ["ibuprofen"] } });
  const p = parseAllergyFreeText("NSAIDs - non-steroidal, causes wheeze", pack);
  assert.equal(p.denies, false);
  assert.ok(p.entries.some((e) => e.substance === "nsaids" && e.resolved), "a real NSAID class allergy still resolves");
});

test("parseAllergyFreeText: splits multiple substances, dedupes, and a class-name match works (penicillins)", () => {
  const p = parseAllergyFreeText("Penicillin, Ibuprofen and Aspirin", ALLERGY_TEST_PACK);
  const substances = p.entries.map((e) => e.substance);
  assert.deepEqual(substances, ["penicillins", "ibuprofen", "aspirin"]);
  const dup = parseAllergyFreeText("Aspirin, aspirin", ALLERGY_TEST_PACK);
  assert.equal(dup.entries.length, 1, "the same resolved substance twice is one entry, not two");
});

test("resolveAllergySubstance never fuzzy-matches: an unrelated word never resolves to a real drug", () => {
  assert.equal(resolveAllergySubstance("xyzzyabc", ALLERGY_TEST_PACK), null);
  assert.equal(resolveAllergySubstance("paracetamoll", ALLERGY_TEST_PACK), null, "a misspelling must not silently resolve to the wrong drug");
});

test("THE PROOF, allergy capture: a native assessment save records the allergy; a second save with the same text is idempotent; a denial writes nothing; another tenant cannot write; a nurse cannot either (not an EMR_TREAT capability)", async () => {
  const h = opdHospital({ "fb:dr-menon": { role: "doctor" }, "fb:sister-anu": { role: "nurse" } }, { settings: {} });
  const ticket = { id: "TKT-60", ghisEpisodeId: "EP-60", ghisPatientId: "GH-60001" };
  const actorDeps = { db: h.db, identifyFn: h.deps.identifyFn, claimsFn: h.deps.claimsFn, staffSession: null, orgForTenant: h.deps.orgForTenant, authorizeOrg: h.deps.authorizeOrg };
  const recordDeps = { repository: h.repository, pseudonym: async () => null };
  const asDoctor = new Request("https://x/api/queue/timeline", { method: "POST", headers: { "X-Test-User": "fb:dr-menon" } });
  const asNurse = new Request("https://x/api/queue/timeline", { method: "POST", headers: { "X-Test-User": "fb:sister-anu" } });
  const migration = { mode: "authoritative", tenantId: "gimsr" };

  const out = await recordAllergiesFromAssessment(asDoctor, ENV, { migration, ticket, vals: { Known_allergies_details: "Amoxicillin - rash, Ibuprofen" }, actorDeps, recordDeps, rulePack: ALLERGY_TEST_PACK });
  assert.equal(out.ok, true); assert.equal(out.written, 2);
  assert.equal(out.entries[0].id, "opd-alg-opd-pat-gh-60001-amoxicillin");
  assert.equal(out.entries[1].id, "opd-alg-opd-pat-gh-60001-ibuprofen");

  // A second device reads the SAME entry back, unsigned/unverified as it must be from free text.
  const doctorB = await client(h, "fb:dr-menon");
  const entry = await doctorB.governed.get(doctorB.actor, "AllergyIntolerance", "opd-alg-opd-pat-gh-60001-amoxicillin");
  assert.equal(entry.substance, "amoxicillin"); assert.equal(entry.reportedText, "Amoxicillin - rash");
  assert.equal(entry.verifiedBy, null, "never auto-verified from free text");
  assert.equal(entry.severity, "unknown", "never inferred from free text");

  // Re-saving the SAME assessment text is idempotent - no duplicate versions.
  const again = await recordAllergiesFromAssessment(asDoctor, ENV, { migration, ticket, vals: { Known_allergies_details: "Amoxicillin - rash, Ibuprofen" }, actorDeps, recordDeps, rulePack: ALLERGY_TEST_PACK });
  assert.equal(again.written, 0);
  assert.ok(again.entries.every((e) => e.skipped === "unchanged"));

  // A denial writes NOTHING - not an entry saying "denies", not anything.
  const denial = await recordAllergiesFromAssessment(asDoctor, ENV, { migration, ticket: { id: "TKT-61", ghisEpisodeId: "EP-61", ghisPatientId: "GH-60002" }, vals: { Known_allergies_details: "NKDA" }, actorDeps, recordDeps, rulePack: ALLERGY_TEST_PACK });
  assert.equal(denial.ok, true); assert.equal(denial.written, 0); assert.equal(denial.skipped, "denies");

  // Off mode: nothing runs, byte-identical to every other migration's off contract.
  assert.deepEqual(await recordAllergiesFromAssessment(asDoctor, ENV, { migration: { mode: "off" }, ticket, vals: { Known_allergies_details: "Amoxicillin" }, actorDeps, recordDeps, rulePack: ALLERGY_TEST_PACK }), { mode: "off", tenantId: null, ok: true, skipped: "off", written: 0 });

  // A nurse holds EMR_VITALS, not EMR_TREAT: her actor resolves fine (the outer call still
  // succeeds, ok:true), but the PER-ENTRY write is refused with governance - caught by the same
  // "one bad entry never sinks the rest" loop that protects a good entry from a bad one, so the
  // failure surfaces per-entry, not as a top-level refusal.
  const nurseTry = await recordAllergiesFromAssessment(asNurse, ENV, { migration, ticket: { id: "TKT-62", ghisEpisodeId: "EP-62", ghisPatientId: "GH-60003" }, vals: { Known_allergies_details: "Amoxicillin" }, actorDeps, recordDeps, rulePack: ALLERGY_TEST_PACK });
  assert.equal(nurseTry.ok, true); assert.equal(nurseTry.written, 0);
  assert.equal(nurseTry.entries[0].error, "governance");
});

test("recordAllergiesFromAssessment never throws on a malformed vals/ticket, and unresolved text is still recorded for a human to read", async () => {
  const h = opdHospital({ "fb:dr-menon": { role: "doctor" } }, { settings: {} });
  const actorDeps = { db: h.db, identifyFn: h.deps.identifyFn, claimsFn: h.deps.claimsFn, staffSession: null, orgForTenant: h.deps.orgForTenant, authorizeOrg: h.deps.authorizeOrg };
  const recordDeps = { repository: h.repository, pseudonym: async () => null };
  const asDoctor = new Request("https://x/api/queue/timeline", { method: "POST", headers: { "X-Test-User": "fb:dr-menon" } });
  const migration = { mode: "authoritative", tenantId: "gimsr" };
  // No vals at all.
  assert.equal((await recordAllergiesFromAssessment(asDoctor, ENV, { migration, ticket: { id: "T", ghisEpisodeId: "E", ghisPatientId: "M" }, vals: null, actorDeps, recordDeps, rulePack: ALLERGY_TEST_PACK })).skipped, "no_text");
  // No patient identity on the ticket at all -> refused, not a fabricated patient.
  const noPatient = await recordAllergiesFromAssessment(asDoctor, ENV, { migration, ticket: { id: "T2" }, vals: { Known_allergies_details: "Amoxicillin" }, actorDeps, recordDeps, rulePack: ALLERGY_TEST_PACK });
  assert.equal(noPatient.ok, false); assert.equal(noPatient.error, "no_patient_identity");
  // Unresolved text is still written, visibly, as "unspecified" - readable, never silently dropped.
  const out = await recordAllergiesFromAssessment(asDoctor, ENV, { migration, ticket: { id: "T3", ghisEpisodeId: "E3", ghisPatientId: "M3" }, vals: { Known_allergies_details: "some strange reaction to something unclear" }, actorDeps, recordDeps, rulePack: ALLERGY_TEST_PACK });
  assert.equal(out.written, 1);
  const doctorB = await client(h, "fb:dr-menon");
  const rec = await doctorB.governed.get(doctorB.actor, "AllergyIntolerance", allergyId("opd-pat-m3", { resolved: false, reportedText: "some strange reaction to something unclear" }));
  assert.equal(rec.substance, "unspecified");
  assert.equal(rec.reportedText, "some strange reaction to something unclear");
  assert.equal(rec.substanceCodeSystem, "unresolved-free-text");
});

test("sameAllergy: idempotent on unchanged content; any changed field is treated as a new version", () => {
  const a = { patientId: "p1", substance: "amoxicillin", reportedText: "Amoxicillin - rash" };
  assert.equal(sameAllergy(a, { ...a }), true);
  assert.equal(sameAllergy(a, { ...a, substance: "aspirin" }), false);
  assert.equal(sameAllergy(a, { ...a, reportedText: "different text" }), false);
});

test("wiring: the native assessment-save route calls this ONLY for wardsynq-native content saves, never sign-off, never a GHIS-shadow tenant that happens to be authoritative for its own reasons", () => {
  const src = readFileSync(new URL("../functions/api/queue/[[path]].js", import.meta.url), "utf8");
  const h = src.slice(src.indexOf('if (seg === "timeline") {'), src.indexOf('// Slide-to-checkout'));
  assert.ok(h.includes("recordAllergiesFromAssessment("));
  assert.ok(h.includes("isAssessment && !isSignOff && wsqMig"), "gated on isAssessment, not sign-off, and wsqMig specifically - not mig.mode alone");
});

// 2026-09-07, real-device end-to-end verification (part 2): the remaining redundant hop.
// orgForTenant() (functions/_wardsynq/org.js) finds an org from a tenant by a Firestore FIELD QUERY
// unless the tenant's own settings.wardsynq.orgId already names it explicitly - its fastest path,
// a single doc get. Nothing wrote that explicit pointer before, so every wardsynq/Connect-tenant
// actor resolution paid for the slow query PLUS authorizeOrg's own getOrg, every single time.
test("wsqLinkTenantOrg: writes the reciprocal tenant->org pointer once, at link time, so orgForTenant's fast path is used from then on", () => {
  const src = readFileSync(new URL("../functions/api/queue/[[path]].js", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("async function wsqLinkTenantOrg"), src.indexOf("import \"../../_opd_ghis_connector.js\""));
  assert.ok(fn.includes("settings.wardsynq"), "writes to the SAME settings.wardsynq.orgId shape orgForTenant's fast path already reads");
  assert.ok(fn.includes("already linked, no write needed"), "idempotent - a repeat link does not re-write on every call");
  assert.ok(fn.includes("catch (e)"), "best-effort - a failed write never blocks the org update itself");
  // Wired into org/update, ONLY when connectTenantId is actually part of this update - not on every
  // unrelated org edit (name change, threshold tweak, ...).
  const route = src.slice(src.indexOf('seg === "org" && sub === "update"'), src.indexOf('seg === "org" && sub === "delete"'));
  assert.ok(route.includes("if (body.connectTenantId) await wsqLinkTenantOrg("), "only runs when this update actually sets/changes the tenant link");
});
