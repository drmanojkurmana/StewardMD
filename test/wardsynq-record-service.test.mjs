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
import { readFileSync } from "node:fs";
import { makeMockDb } from "../functions/_connect/testkit.js";
import { can } from "../functions/_connect/enterprise/rbac.js";

import { ClinicalStore } from "../wardsynq/wardsynq-store.js";
import { RemoteBackend, RemoteConflictError, RemoteRefusedError } from "../wardsynq/wardsynq-store-remote.js";
import { GovernedStore, makeActor, KIND, TIER, GovernanceError } from "../wardsynq/wardsynq-actors.js";
import { Patient, Observation, MedicationOrder, ClinicalNote } from "../wardsynq/wardsynq-model.js";
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

test("role mapping: every one of the eighteen operational roles resolves to exactly the grant its capabilities imply", () => {
  const m = roleMapping();
  assert.deepEqual(Object.keys(m).sort(), [...ROLES].sort());
  const tier = (r) => (m[r] ? m[r].tier : null);
  const write = (r) => (m[r] ? m[r].write : "none");
  const read = (r) => (m[r] ? m[r].read : "none");
  for (const r of ["doctor", "pg_faculty", "pg_hod", "admin"]) { assert.equal(tier(r), TIER.EXECUTE, r); assert.equal(write(r), null, r); assert.equal(read(r), null, r); }
  for (const r of ["nurse", "intern", "resident", "pg_resident"]) { assert.equal(tier(r), TIER.EXECUTE, r); assert.deepEqual(write(r), ["Observation"], r); assert.equal(read(r), null, r); }
  for (const r of ["supervisor", "reception"]) { assert.equal(tier(r), TIER.READ, r); assert.deepEqual(write(r), [], r); assert.equal(read(r), null, r); }
  for (const r of ["cashier", "pharmacy"]) { assert.equal(tier(r), TIER.READ, r); assert.deepEqual(write(r), [], r); assert.deepEqual(read(r), ["MedicationOrder", "ServiceRequest"], r); }
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

  // The nurse: EXECUTE on observations, a governance denial on an order, whatever the client says.
  const nurse = await client(h, "fb:sister-anu");
  assert.equal(nurse.descriptor.role, "nurse");
  assert.equal(nurse.descriptor.actor.tier, "execute");
  assert.deepEqual(nurse.descriptor.actor.writable, ["Observation"]);
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

  // Reception: reads the chart, writes nothing, is refused at the door for a write.
  const desk = await client(h, "fb:desk-1");
  assert.equal(desk.descriptor.actor.tier, "read");
  assert.equal((await desk.governed.get(desk.actor, "MedicationOrder", "rx-20")).drug, "Amoxicillin");
  assert.equal((await h.fetchAs("fb:desk-1")("https://x/api/wardsynq/gimsr/record", { method: "POST", body: JSON.stringify({ entity: Observation({ id: "o", patientId: "pat-20", code: "x", value: 1 }) }) })).status, 403);

  // Pharmacy: the orders, and only the orders. The chart it sees has no other keys.
  const pharm = await client(h, "fb:pharm-1");
  assert.deepEqual(pharm.descriptor.actor.readable, ["MedicationOrder", "ServiceRequest"]);
  const chart = await pharm.backend.chart("pat-20");
  assert.deepEqual(Object.keys(chart).sort(), ["MedicationOrder", "ServiceRequest"]);
  assert.equal(chart.MedicationOrder.length, 1);
  await assert.rejects(pharm.governed.get(pharm.actor, "Observation", "obs-20"), (e) => e.code === "READ_SCOPE_DENIED");
  assert.equal((await h.fetchAs("fb:pharm-1")("https://x/api/wardsynq/gimsr/record/Patient/pat-20")).status, 403);
  const feed = await pharm.backend.changes(0);
  assert.deepEqual(feed.records.map((x) => x.resourceType), ["MedicationOrder"], "the feed withholds what the role may not read");

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
  assert.deepEqual(nurse.descriptor.actor.writable, ["Observation"]);
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
  assert.equal(bot.tier, "draft"); assert.deepEqual([...bot.scope.write], ["Observation"]); assert.equal(bot.onBehalfOf, "fb:n");
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
  // Reception holds no write: refused at the door, nothing written, and the result says which.
  const asDesk = new Request("https://x/api/queue/s1/timeline", { method: "POST", headers: { "X-Test-User": "fb:desk-1" } });
  const r3 = await recordVitals(asDesk, env, ctx(asDesk, { pulse: "80" }));
  assert.equal(r3.ok, false); assert.equal(r3.status, 403); assert.equal(r3.error, "permission");
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
  // authoritative: record first, refusal returns before any timeline write, then the timeline as shadow.
  const auth = h.slice(i('mig.mode === "authoritative"'), i("// shadow:"));
  assert.ok(auth.indexOf("recordVitals(") < auth.indexOf("QT.appendTimeline("));
  assert.ok(auth.indexOf('error: "record_refused"') < auth.indexOf("QT.appendTimeline("));
  // shadow: timeline first, record after.
  const shadow = h.slice(i("// shadow:"), i("return json(Object.assign({ ok: true }, await QT.appendTimeline("));
  assert.ok(shadow.indexOf("QT.appendTimeline(") < shadow.indexOf("recordVitals("));
  // off: the original single line, unchanged.
  assert.ok(h.includes('return json(Object.assign({ ok: true }, await QT.appendTimeline(env, s, t, body.kind, body.text, actor.id)), 200, request);'));
  // the console sends the structured values with the text
  const html = readFileSync(new URL("../opd.html", import.meta.url), "utf8");
  assert.ok(html.includes('kind:"vitals",text:p.join(" · "),vitals:vitals'));
});

/* ------------------------------------------------------------------ the doctor reads the vitals back */

test("the timeline GET names the record only where the tenant is on; the console reads it through the record's own door with its own credentials", () => {
  const src = readFileSync(new URL("../functions/api/queue/[[path]].js", import.meta.url), "utf8");
  const h = src.slice(src.indexOf('if (method === "GET" && seg === "timeline") {'), src.indexOf("// Doctor's treated-patient history"));
  assert.ok(h.includes('if (mig.mode !== "off") out.record = { tenantId: mig.tenantId, patientId: patientIdForTicket(t), mode: mig.mode, ticketId: t.id };'), "record key only when on");
  assert.ok(h.includes("requireSessionCap(env, actor, s, CAPS.EMR_VIEW)"), "the timeline read is still EMR_VIEW-gated");
  const html = readFileSync(new URL("../opd.html", import.meta.url), "utf8");
  assert.ok(html.includes('"/api/wardsynq/"+encodeURIComponent(rec.tenantId)+"/patient/"+encodeURIComponent(rec.patientId)+"/Observation"'), "the existing Observation endpoint, nothing new");
  assert.ok(html.includes('if(r.record&&r.record.tenantId) el.insertBefore(recordVitalsBlock(r.record),el.firstChild);'), "shown only when the server names a record");
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
  assert.equal((await h.fetchAs("fb:pharm-1")("https://x/api/wardsynq/gimsr/patient/opd-pat-gh-40233/Observation")).status, 403);
  // 5. The read was audited as the doctor, PHI-free.
  const reads = h.repository.audit.filter((a) => a.action === "record.read" && a.actor === "fb:dr-menon");
  assert.ok(reads.length >= 1);
  assert.ok(!JSON.stringify(reads).includes("138"), "no values in the audit");
});
