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

test("GHIS is always offered, signed in or not, and flags when sign-in is needed", async () => {
  // Hiding GHIS when there is no session makes the option invisible precisely to the surgeon who
  // has not set it up yet. It is listed always; picking it prompts sign-in.
  delete global.SMD_CONNECT;
  global.GHIS = { getToken: () => "" };                       // signed OUT
  try {
    let list = await P.sources();
    let ghis = list.find((s) => s.kind === "ghis");
    assert.ok(ghis, "GHIS must be listed even when signed out");
    assert.equal(ghis.needsSignIn, true);

    global.GHIS = { getToken: () => "tok" };                   // signed IN
    list = await P.sources();
    ghis = list.find((s) => s.kind === "ghis");
    assert.equal(ghis.needsSignIn, false);
  } finally { delete global.GHIS; }
});

test("the hospital list survives a Connect failure instead of erroring", async () => {
  global.GHIS = { getToken: () => "tok" };
  global.SMD_CONNECT = { tenants: () => Promise.reject(new Error("offline")), searchPatients: () => {} };
  try {
    const list = await P.sources();
    assert.ok(list.some((s) => s.kind === "ghis"), "GHIS must still be offered when Connect is down");
  } finally { delete global.GHIS; delete global.SMD_CONNECT; }
});

test("Connect tenants are listed alongside GHIS", async () => {
  global.GHIS = { getToken: () => "tok" };
  global.SMD_CONNECT = { tenants: () => Promise.resolve([{ tenantId: "t1", name: "Demo Hospital" }]), searchPatients: () => {} };
  try {
    const list = await P.sources();
    assert.deepEqual(list.map((s) => s.kind), ["ghis", "connect"]);
    assert.equal(list[1].name, "Demo Hospital");
    assert.equal(list[1].id, "t1");
  } finally { delete global.GHIS; delete global.SMD_CONNECT; }
});

test("the GHIS ward roster normalises GHIS's own field names", () => {
  const row = P.normaliseGhisRow({ patientId: "MR1", episodeId: "EP9", patientFirstName: " Asha Rao ", bedName: "12", gender: "F", age: 54 });
  assert.equal(row.patientId, "MR1");
  assert.equal(row.episodeId, "EP9");
  assert.equal(row.name, "Asha Rao");
  assert.match(row.detail, /54/);
  assert.match(row.detail, /Bed 12/);
  // A nameless row must still be selectable, never render "undefined".
  const bare = P.normaliseGhisRow({ patientId: "MR2" });
  assert.equal(bare.name, "(no name)");
  assert.equal(bare.episodeId, "");
  assert.ok(!JSON.stringify(P.normaliseGhisRow({})).includes("undefined"));
  assert.ok(!JSON.stringify(P.normaliseGhisRow(null)).includes("undefined"));
});

test("a roster row feeds linkFromGhis directly", () => {
  // The picker hands a normalised row straight to linkFromGhis - the shapes must line up.
  const link = P.linkFromGhis(P.normaliseGhisRow({ patientId: "MR1", episodeId: "EP9", patientFirstName: "Asha" }));
  assert.equal(link.source, "ghis");
  assert.equal(link.patientId, "MR1");
  assert.equal(link.episodeId, "EP9");
  assert.equal(P.writability(link).canWrite, true);
});

test("a rostered patient with no open visit links but is NOT writable", () => {
  const link = P.linkFromGhis(P.normaliseGhisRow({ patientId: "MR3", patientFirstName: "No Visit" }));
  assert.ok(link, "the patient must still be selectable");
  const w = P.writability(link);
  assert.equal(w.canWrite, false);
  assert.match(w.reason, /visit/i);
});

test("the roster refuses to call the API when signed out, and never guesses", async () => {
  const calls = [];
  global.fetch = (...a) => { calls.push(a); return Promise.resolve({ ok: true, json: () => Promise.resolve([]) }); };
  global.GHIS = { getToken: () => "" };
  try {
    const r = await P.ghisRoster();
    assert.equal(r.ok, false);
    assert.equal(r.error, "ghis_signed_out");
    assert.equal(calls.length, 0, "no request may be made without a session");
  } finally { delete global.GHIS; delete global.fetch; }
});

test("the roster calls the SAME endpoint Ward Sync uses, with the GHIS bearer", async () => {
  let seen = null;
  global.fetch = (url, init) => { seen = { url, init }; return Promise.resolve({ ok: true, json: () => Promise.resolve([{ patientId: "MR1", episodeId: "EP1", patientFirstName: "A" }]) }); };
  global.GHIS = { getToken: () => "tok" };
  try {
    const r = await P.ghisRoster();
    assert.equal(seen.url, "/api/ghis/patients");
    assert.equal(seen.init.headers.Authorization, "Bearer tok");
    assert.equal(r.ok, true);
    assert.equal(r.patients.length, 1);
    assert.equal(r.patients[0].patientId, "MR1");
  } finally { delete global.GHIS; delete global.fetch; }
});

test("the roster drops rows with no patient id and survives a bad payload", async () => {
  global.GHIS = { getToken: () => "tok" };
  try {
    global.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve([{ patientId: "MR1" }, { patientFirstName: "ghost" }]) });
    assert.equal((await P.ghisRoster()).patients.length, 1, "a row with no id is unusable");

    global.fetch = () => Promise.resolve({ ok: true, json: () => Promise.reject(new Error("bad json")) });
    const bad = await P.ghisRoster();
    assert.equal(bad.ok, true);
    assert.deepEqual(bad.patients, [], "unparseable body => empty list, not a crash");

    global.fetch = () => Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({ error: "login_required" }) });
    assert.equal((await P.ghisRoster()).error, "login_required");

    global.fetch = () => Promise.reject(new Error("offline"));
    assert.equal((await P.ghisRoster()).ok, false, "a network failure must resolve, not throw");
  } finally { delete global.GHIS; delete global.fetch; }
});

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
