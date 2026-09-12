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

function grant(scope) { writeScope = scope; resolveThrows = null; }

const CTX = { migration: { mode: "native", tenantId: "t1" }, encounterId: "enc-1" };

function okWriter(tag) {
  const calls = [];
  const fn = async (_rq, _ev, c) => { calls.push({ item: c.item, index: c.index }); return { ok: true, written: 1, noteId: tag + "-" + c.index }; };
  fn.calls = calls;
  return fn;
}

test("writes every piece in chart order and reports each one", async () => {
  grant(null); // null scope = unrestricted
  const writers = { vitals: okWriter("v"), problems: okWriter("p"), medications: okWriter("m"), note: okWriter("n") };
  const body = { vitals: [{ hr: 80 }], problems: [{ code: "J18" }], medications: [{ drug: "amox" }], note: { templateId: "soap" } };

  const r = await saveConsultation({}, {}, { ...CTX, body, writers });

  assert.equal(r.ok, true);
  assert.equal(r.written, 4);
  assert.deepEqual(r.results.map((x) => x.piece), ["vitals", "problems", "medications", "note"]);
  assert.ok(r.results.every((x) => x.ok));
});

test("refuses the whole consultation, writing nothing, when one piece is outside the grant", async () => {
  // A nurse: vitals yes, prescription no.
  grant(["Observation"]);
  const writers = { vitals: okWriter("v"), medications: okWriter("m") };
  const body = { vitals: [{ hr: 80 }], medications: [{ drug: "amox" }] };

  const r = await saveConsultation({}, {}, { ...CTX, body, writers });

  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
  assert.equal(r.written, 0);
  assert.deepEqual(r.refused.map((x) => x.piece), ["medications"]);
  assert.deepEqual(r.allowed, ["vitals"]);
  // The whole point: nothing was written, not even the piece she was allowed to write.
  assert.equal(writers.vitals.calls.length, 0);
  assert.equal(writers.medications.calls.length, 0);
});

test("a mid-way failure stops, and says what was saved and what was never attempted", async () => {
  grant(null);
  const writers = {
    vitals: okWriter("v"),
    problems: async () => ({ ok: false, status: 409, error: "version_conflict" }),
    medications: okWriter("m"),
    note: okWriter("n"),
  };
  const body = { vitals: [{ hr: 80 }], problems: [{ code: "J18" }], medications: [{ drug: "amox" }], note: { templateId: "soap" } };

  const r = await saveConsultation({}, {}, { ...CTX, body, writers });

  assert.equal(r.ok, false);
  assert.equal(r.status, 207);
  assert.equal(r.partial, true);
  assert.equal(r.failedAt, "problems");
  assert.equal(r.written, 1);
  assert.deepEqual(r.savedPieces, ["vitals"]);
  assert.deepEqual(r.notAttempted, ["medications", "note"]);
  // Nothing after the failure ran.
  assert.equal(writers.medications.calls.length, 0);
  assert.equal(writers.note.calls.length, 0);
});

test("a writer that throws is reported, never swallowed", async () => {
  grant(null);
  const writers = { vitals: async () => { throw new Error("db gone"); } };
  const r = await saveConsultation({}, {}, { ...CTX, body: { vitals: [{ hr: 80 }] }, writers });

  assert.equal(r.ok, false);
  assert.equal(r.results[0].error, "write_threw");
  assert.match(r.results[0].detail, /db gone/);
});

test("empty and absent pieces are not requested, and an empty consultation is refused", async () => {
  grant(null);
  const writers = { vitals: okWriter("v") };

  const r = await saveConsultation({}, {}, { ...CTX, body: { vitals: [], problems: null }, writers });
  assert.equal(r.ok, false);
  assert.equal(r.error, "nothing_to_save");
  assert.equal(writers.vitals.calls.length, 0);
});

test("an encounter is required", async () => {
  grant(null);
  const r = await saveConsultation({}, {}, { ...CTX, encounterId: "  ", body: { vitals: [{ hr: 1 }] }, writers: {} });
  assert.equal(r.error, "encounter_required");
});

test("a hospital that is not WardSynQ-native is skipped, not errored", async () => {
  grant(null);
  const r = await saveConsultation({}, {}, { migration: { mode: "off" }, encounterId: "e", body: { vitals: [{}] }, writers: {} });
  assert.equal(r.ok, true);
  assert.equal(r.skipped, "off");
});

test("each piece gets its own item, indexed, so several of one kind all get written", async () => {
  grant(null);
  const writers = { medications: okWriter("m") };
  const body = { medications: [{ drug: "a" }, { drug: "b" }, { drug: "c" }] };

  const r = await saveConsultation({}, {}, { ...CTX, body, writers });

  assert.equal(r.ok, true);
  assert.equal(r.written, 3);
  assert.deepEqual(writers.medications.calls.map((c) => c.item.drug), ["a", "b", "c"]);
  assert.deepEqual(writers.medications.calls.map((c) => c.index), [0, 1, 2]);
});

test("a missing writer is reported rather than silently skipping a piece", async () => {
  grant(null);
  const r = await saveConsultation({}, {}, { ...CTX, body: { vitals: [{ hr: 1 }] }, writers: {} });
  assert.equal(r.ok, false);
  assert.equal(r.results[0].error, "no_writer_configured");
});

test("a sign-in failure is an auth answer, not a partial save", async () => {
  const { AuthError } = await import("../functions/_connect/permission.js");
  grant(null); resolveThrows = new AuthError("no session");
  const r = await saveConsultation({}, {}, { ...CTX, body: { vitals: [{ hr: 1 }] }, writers: { vitals: okWriter("v") } });
  assert.equal(r.ok, false);
  assert.equal(r.status, 401);
  assert.equal(r.written, 0);
});
