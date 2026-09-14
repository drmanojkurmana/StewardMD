import { test, mock } from "node:test";
import assert from "node:assert/strict";

/* One mock for the whole file: node allows a module to be mocked once, so the actor it returns is
 * swapped through these two variables rather than by re-mocking per test. */
let writeScope = null;   // null = unrestricted grant
let resolveThrows = null;

mock.module(new URL("../functions/_wardsynq/actor.js", import.meta.url).href, {
  namedExports: {
    resolveClinicalActor: async () => {
      if (resolveThrows) throw resolveThrows;
      return { actor: { id: "staff:test", scope: { write: writeScope, read: null } }, tenant: {}, role: "doctor", source: "opd" };
    },
  },
});

const { saveConsultation } = await import("../functions/_wardsynq/consultation.js");
const { MemoryRepository } = await import("../functions/_wardsynq/repository.js");

function grant(scope) { writeScope = scope; resolveThrows = null; }

let repo;
function ctx(extra) { repo = new MemoryRepository(); return { migration: { mode: "native", tenantId: "t1" }, encounterId: "enc-1", recordDeps: { repository: repo }, ...extra }; }
const TYPE = { vitals: "Observation", problems: "Condition", medications: "MedicationOrder", investigations: "ServiceRequest", note: "ClinicalNote" };

/* A writer that really writes: one record through whatever repository it is handed, with its own
 * idempotency key and audit event, exactly as a RecordService would. */
function okWriter(piece) {
  const calls = [];
  const fn = async (_rq, _ev, c) => {
    calls.push({ item: c.item, index: c.index });
    const id = `${piece}-${c.index}`;
    await c.recordDeps.repository.append("t1", [{ resourceType: TYPE[piece], id, version: 1, patientId: "p1" }], { idempotencyKey: `consult-1:${piece}:${c.index}`, audit: { action: "record.write", scope: { id } } });
    return { ok: true, written: 1, noteId: id };
  };
  fn.calls = calls;
  return fn;
}
const rows = () => repo._rows.filter((r) => r.resourceType !== "_wardsynq_outbox").length;
const events = () => repo._rows.filter((r) => r.resourceType === "_wardsynq_outbox");

test("writes every piece in chart order, all in ONE atomic append, with every key and audit row", async () => {
  grant(null);
  const writers = { vitals: okWriter("vitals"), problems: okWriter("problems"), medications: okWriter("medications"), note: okWriter("note") };
  const body = { vitals: [{ hr: 80 }], problems: [{ code: "J18" }], medications: [{ drug: "amox" }], note: { templateId: "soap" } };

  let appends = 0;
  const c = ctx({ body, writers });
  const realAppend = repo.append.bind(repo);
  repo.append = async (...a) => { appends += 1; return realAppend(...a); };
  const r = await saveConsultation({}, {}, c);

  assert.equal(r.ok, true);
  assert.equal(r.written, 4);
  assert.deepEqual(r.results.map((x) => x.piece), ["vitals", "problems", "medications", "note"]);
  assert.equal(appends, 1, "one transaction, not four");
  assert.equal(rows(), 4);
  for (const k of ["vitals", "problems", "medications", "note"]) assert.ok(await repo.recall("t1", `consult-1:${k}:0`), k + " key kept, so a retry replays instead of duplicating");
  assert.equal(repo.audit.length, 4, "every piece's audit row lands with it");
});

test("refuses the whole consultation, writing nothing, when one piece is outside the grant", async () => {
  grant(["Observation"]);
  const writers = { vitals: okWriter("vitals"), medications: okWriter("medications") };
  const r = await saveConsultation({}, {}, ctx({ body: { vitals: [{ hr: 80 }], medications: [{ drug: "amox" }] }, writers }));
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
  assert.equal(r.written, 0);
  assert.deepEqual(r.refused.map((x) => x.piece), ["medications"]);
  assert.deepEqual(r.allowed, ["vitals"]);
  assert.equal(writers.vitals.calls.length, 0);
  assert.equal(rows(), 0);
});

test("INVARIANT: a failure in the middle leaves the chart exactly as it was - no half consultation", async () => {
  grant(null);
  const writers = {
    vitals: okWriter("vitals"),
    problems: okWriter("problems"),
    medications: async () => ({ ok: false, status: 422, error: "dose_out_of_range" }),
    note: okWriter("note"),
  };
  const body = { vitals: [{ hr: 80 }], problems: [{ code: "J18" }], medications: [{ drug: "amox" }], note: { templateId: "soap" } };
  const r = await saveConsultation({}, {}, ctx({ body, writers }));

  assert.equal(r.ok, false);
  assert.equal(r.error, "consultation_not_saved");
  assert.equal(r.status, 422);
  assert.equal(r.written, 0);
  assert.equal(r.failedAt, "medications");
  assert.deepEqual(r.notAttempted, ["note"]);
  assert.match(r.detail, /Nothing from this consultation was saved, because the prescription could not be/);
  assert.equal(rows(), 0, "the vitals and problem that succeeded were never written");
  assert.equal(await repo.recall("t1", "consult-1:vitals:0"), null, "and their keys were not spent, so saving again works");
  assert.equal(repo.audit.length, 0, "no audit row claims a write that did not happen");
  assert.equal(writers.note.calls.length, 0);
});

test("INVARIANT: a writer that throws half-way also leaves nothing, and is reported", async () => {
  grant(null);
  const writers = { vitals: okWriter("vitals"), problems: async () => { throw new Error("db gone"); } };
  const r = await saveConsultation({}, {}, ctx({ body: { vitals: [{ hr: 80 }], problems: [{ code: "x" }] }, writers }));
  assert.equal(r.ok, false);
  assert.equal(r.results[1].error, "write_threw");
  assert.match(r.results[1].detail, /db gone/);
  assert.equal(rows(), 0);
});

test("INVARIANT: a conflicting write that lands between staging and commit refuses the whole consultation", async () => {
  grant(null);
  const c = ctx({ body: { vitals: [{ hr: 80 }], problems: [{ code: "J18" }] } });
  c.writers = {
    vitals: okWriter("vitals"),
    problems: async (rq, ev, cc) => {
      const out = await okWriter("problems")(rq, ev, cc);
      // Someone else writes the same Observation version on the real store before we commit.
      await repo.append("t1", [{ resourceType: "Observation", id: "vitals-0", version: 1, patientId: "p1" }], {});
      return out;
    },
  };
  const r = await saveConsultation({}, {}, c);
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.equal(r.error, "consultation_conflict");
  assert.equal(r.written, 0);
  assert.equal(rows(), 1, "only the other writer's row exists; none of ours");
  assert.equal(await repo.recall("t1", "consult-1:problems:0"), null);
});

test("a later piece reads an earlier piece's staged record as if it had landed", async () => {
  grant(null);
  let seen = null;
  const writers = {
    problems: okWriter("problems"),
    note: async (_rq, _ev, c) => { seen = await c.recordDeps.repository.byPatient("t1", "Condition", "p1"); return okWriter("note")(_rq, _ev, c); },
  };
  const r = await saveConsultation({}, {}, ctx({ body: { problems: [{ code: "J18" }], note: { templateId: "soap" } }, writers }));
  assert.equal(r.ok, true);
  assert.deepEqual(seen.map((x) => x.id), ["problems-0"]);
});

test("a retried consultation replays: every piece's key is found, nothing is written twice", async () => {
  grant(null);
  const c = ctx({ body: { vitals: [{ hr: 80 }] } });
  c.writers = {
    vitals: async (_rq, _ev, cc) => {
      if (await cc.recordDeps.repository.recall("t1", "consult-1:vitals:0")) return { ok: true, written: 0, replayed: true };
      return okWriter("vitals")(_rq, _ev, cc);
    },
  };
  assert.equal((await saveConsultation({}, {}, c)).ok, true);
  const again = await saveConsultation({}, {}, c);
  assert.equal(again.ok, true);
  assert.equal(rows(), 1);
});

test("empty and absent pieces are not requested, and an empty consultation is refused", async () => {
  grant(null);
  const writers = { vitals: okWriter("vitals") };
  const r = await saveConsultation({}, {}, ctx({ body: { vitals: [], problems: null }, writers }));
  assert.equal(r.ok, false);
  assert.equal(r.error, "nothing_to_save");
  assert.equal(writers.vitals.calls.length, 0);
});

test("an encounter is required", async () => {
  grant(null);
  const r = await saveConsultation({}, {}, ctx({ encounterId: "  ", body: { vitals: [{ hr: 1 }] }, writers: {} }));
  assert.equal(r.error, "encounter_required");
});

test("a hospital that is not WardSynQ-native is skipped, not errored", async () => {
  grant(null);
  const r = await saveConsultation({}, {}, { migration: { mode: "off" }, encounterId: "e", body: { vitals: [{}] }, writers: {} });
  assert.equal(r.ok, true);
  assert.equal(r.skipped, "off");
});

test("each piece gets its own item, indexed, so several of one kind all get written together", async () => {
  grant(null);
  const writers = { medications: okWriter("medications") };
  const r = await saveConsultation({}, {}, ctx({ body: { medications: [{ drug: "a" }, { drug: "b" }, { drug: "c" }] }, writers }));
  assert.equal(r.ok, true);
  assert.equal(r.written, 3);
  assert.deepEqual(writers.medications.calls.map((c) => c.item.drug), ["a", "b", "c"]);
  assert.deepEqual(writers.medications.calls.map((c) => c.index), [0, 1, 2]);
});

test("a missing writer is reported rather than silently skipping a piece, and nothing is saved", async () => {
  grant(null);
  const r = await saveConsultation({}, {}, ctx({ body: { vitals: [{ hr: 1 }] }, writers: {} }));
  assert.equal(r.ok, false);
  assert.equal(r.results[0].error, "no_writer_configured");
  assert.equal(r.written, 0);
});

test("a sign-in failure is an auth answer, not a partial save", async () => {
  const { AuthError } = await import("../functions/_connect/permission.js");
  grant(null); resolveThrows = new AuthError("no session");
  const r = await saveConsultation({}, {}, ctx({ body: { vitals: [{ hr: 1 }] }, writers: { vitals: okWriter("vitals") } }));
  assert.equal(r.ok, false);
  assert.equal(r.status, 401);
  assert.equal(r.written, 0);
});
