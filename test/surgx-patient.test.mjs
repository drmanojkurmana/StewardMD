/* SURGX note patient linking — hospital EMR (GHIS / Connect) or manual.
 *
 * The invariant that matters: WRITABILITY IS DECIDED IN ONE PLACE. Only a GHIS-sourced patient with
 * a visit can be written back to a hospital record — Connect is a pull-only integration and a
 * manually-typed reference has no record at all. If the picker, the save button and the error text
 * ever disagree about that, a surgeon is told a note reached a chart when it did not.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const P = require(join(ROOT, "surgx-patient.js"));
const DEST = require(join(ROOT, "surgx-destinations.js"));

test("a GHIS patient with a visit is the ONLY writable source", () => {
  assert.equal(P.writability({ source: "ghis", patientId: "MR1", episodeId: "EP1" }).canWrite, true);
});

test("every non-writable source explains itself, and none of them can write", () => {
  const cases = [
    null,
    { source: "manual", name: "R.K." },
    { source: "connect", tenantId: "t1", patientId: "p1" },
    { source: "ghis", patientId: "MR1", episodeId: "" },   // no visit
    { source: "ghis", patientId: "", episodeId: "EP1" },    // no id
    { source: "wat", patientId: "x" }
  ];
  for (const c of cases) {
    const w = P.writability(c);
    assert.equal(w.canWrite, false, `${JSON.stringify(c)} must not be writable`);
    assert.ok(w.reason && w.reason.length > 5, `${JSON.stringify(c)} must give a reason`);
  }
});

test("a GHIS link carries the visit, because an assessment attaches to one", () => {
  const l = P.linkFromGhis({ patientId: "MR1", episodeId: "EP9", name: "A B" });
  assert.deepEqual(l, { source: "ghis", tenantId: "", patientId: "MR1", episodeId: "EP9", name: "A B" });
  assert.equal(P.linkFromGhis({ patientId: "" }), null, "no id, no link");
  assert.equal(P.linkFromGhis(null), null);
});

test("a Connect link records its tenant and is never marked writable", () => {
  const l = P.linkFromConnect("t1", { id: "p1", name: { given: ["Asha"], family: "Rao" } });
  assert.equal(l.source, "connect");
  assert.equal(l.tenantId, "t1");
  assert.equal(l.name, "Asha Rao");
  assert.equal(P.writability(l).canWrite, false);
  assert.equal(P.linkFromConnect("", { id: "p" }), null, "a tenant is required");
});

test("a manual reference is accepted, trimmed, and rejected when blank", () => {
  assert.equal(P.linkManual("  R.K. 4471 ").name, "R.K. 4471");
  assert.equal(P.linkManual("   "), null);
  assert.equal(P.linkManual(""), null);
  assert.equal(P.linkManual(null), null);
});

test("patient labels handle every FHIR name shape without printing 'undefined'", () => {
  assert.equal(P.patientLabel({ name: { text: "Asha Rao" } }), "Asha Rao");
  assert.equal(P.patientLabel({ name: { given: ["Asha"], family: "Rao" } }), "Asha Rao");
  assert.equal(P.patientLabel({ name: { family: "Rao" } }), "Rao");
  assert.equal(P.patientLabel({ name: "Asha Rao" }), "Asha Rao");
  assert.equal(P.patientLabel({ id: "p1" }), "p1", "falls back to the id");
  assert.equal(P.patientLabel({}), "Unknown");
  assert.equal(P.patientLabel(null), "Unknown");
  for (const shape of [{}, null, { name: {} }, { name: { given: [] } }]) {
    assert.ok(!String(P.patientLabel(shape)).includes("undefined"));
  }
});

test("the MRN comes from identifiers and is never undefined", () => {
  assert.equal(P.patientMrn({ identifiers: [{ value: "4471" }] }), "4471");
  assert.equal(P.patientMrn({ mrn: "99" }), "99");
  assert.equal(P.patientMrn({}), "");
  assert.equal(P.patientMrn(null), "");
});

test("the EMR write refuses a non-GHIS patient before touching the network", async () => {
  const calls = [];
  global.fetch = (...a) => { calls.push(a); return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) }); };
  global.GHIS = { getToken: () => "tok", getSelectedPatient: () => ({ patientId: "OTHER", episodeId: "EPX" }) };
  try {
    for (const patient of [
      { source: "manual", name: "R.K." },
      { source: "connect", tenantId: "t1", patientId: "p1" }
    ]) {
      const r = await DEST.saveToEmr({ patient }, "note", { confirmed: true });
      assert.equal(r.error, "source_not_writable");
    }
    assert.equal(calls.length, 0, "nothing may be sent for a non-writable source");
  } finally { delete global.GHIS; delete global.fetch; }
});

test("the note's OWN patient wins over whoever is open in Ward Sync", async () => {
  // A note written this morning must not be filed against the patient opened this afternoon.
  let sent = null;
  global.fetch = (url, init) => { sent = JSON.parse(init.body); return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) }); };
  global.GHIS = { getToken: () => "tok", getSelectedPatient: () => ({ patientId: "AFTERNOON", episodeId: "EP-PM" }) };
  try {
    const note = { patient: { source: "ghis", patientId: "MORNING", episodeId: "EP-AM" } };
    const r = await DEST.saveToEmr(note, "note text", { confirmed: true });
    assert.equal(r.ok, true);
    assert.equal(sent.patientId, "MORNING");
    assert.equal(sent.episodeId, "EP-AM");
  } finally { delete global.GHIS; delete global.fetch; }
});

test("a note with no linked patient still falls back to the ward selection", async () => {
  // Notes created before patient linking existed must keep working.
  let sent = null;
  global.fetch = (url, init) => { sent = JSON.parse(init.body); return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) }); };
  global.GHIS = { getToken: () => "tok", getSelectedPatient: () => ({ patientId: "WARD", episodeId: "EPW" }) };
  try {
    const r = await DEST.saveToEmr({}, "note text", { confirmed: true });
    assert.equal(r.ok, true);
    assert.equal(sent.patientId, "WARD");
  } finally { delete global.GHIS; delete global.fetch; }
});

test("the store persists the linked patient inside the ENCRYPTED body, not the index", () => {
  // patient identity must never land in the plaintext note index.
  const src = require("node:fs").readFileSync(join(ROOT, "surgx-store.js"), "utf8");
  const save = src.slice(src.indexOf("function saveNote"), src.indexOf("function saveNote") + 1800);
  assert.ok(/patient:\s*note\.patient/.test(save), "the encrypted body must carry the patient");
  const idx = save.slice(save.indexOf("idx.unshift"));
  assert.ok(!/patient/.test(idx), "the plaintext index must NOT carry patient identity");
});
