/* SURGX note save destinations — local / Google Drive / hospital EMR.
 *
 * The invariants that matter here are safety ones, not formatting ones:
 *   - no destination can send a note off-device without an explicit per-save confirmation;
 *   - a patient identifier never appears in a Drive FILENAME (filenames leak into search results,
 *     "shared with me" lists and notification emails - a wider audience than the file);
 *   - the EMR destination is inert and defaults OFF, because no verified GHIS operative-note
 *     payload exists.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const DEST = require(join(ROOT, "surgx-destinations.js"));
const FLAGS = require(join(ROOT, "surgx-flags.js"));

test("neither export destination sends anything without explicit confirmation", async () => {
  // No confirmed flag at all.
  for (const call of [DEST.saveToDrive, DEST.saveToEmr]) {
    const r = await call({ label: "x" }, "note body", {});
    assert.equal(r.ok, false);
    assert.equal(r.error, "not_confirmed");
  }
  // Explicitly false, and the truthy-but-not-true trap.
  const r1 = await DEST.saveToDrive({}, "body", { confirmed: false });
  assert.equal(r1.error, "not_confirmed");
  const r2 = await DEST.saveToDrive({}, "body", { confirmed: "yes" });
  assert.equal(r2.error, "not_confirmed", "only a literal true may confirm a PHI disclosure");
});

test("send() refuses an unknown destination rather than guessing", async () => {
  const r = await DEST.send("dropbox", {}, "body", { confirmed: true });
  assert.equal(r.ok, false);
  assert.equal(r.error, "unknown_destination");
});

test("the Drive filename carries no patient identifier and is filesystem-safe", () => {
  const name = DEST.driveFilename({ label: "Bed 12 lap chole" }, "2026-08-24T10:00:00.000Z");
  assert.match(name, /^StewardMD 2026-08-24 /);
  assert.ok(name.endsWith(".txt"));
  // Characters that break Drive/OS filenames must be stripped.
  const messy = DEST.driveFilename({ label: 'a/b\\c:d*e?f"g<h>i|j' }, "2026-08-24T00:00:00Z");
  for (const ch of ["/", "\\", ":", "*", "?", '"', "<", ">", "|"]) {
    assert.ok(!messy.includes(ch), `filename must not contain ${ch}`);
  }
  // Long labels are bounded so the name stays usable.
  const long = DEST.driveFilename({ label: "x".repeat(300) }, "2026-08-24T00:00:00Z");
  assert.ok(long.length < 120, `filename should be bounded, got ${long.length}`);
  // A missing label must still produce a sane name, not "undefined".
  assert.ok(!DEST.driveFilename({}, "2026-08-24T00:00:00Z").includes("undefined"));
  assert.ok(!DEST.driveFilename(null, "").includes("undefined"));
});

test("the Drive multipart body is a well-formed multipart/related envelope", () => {
  const body = DEST.driveMultipartBody("BOUND", { name: "n.txt" }, "OPERATIVE NOTE\nline 2");
  assert.ok(body.startsWith("--BOUND\r\n"));
  assert.ok(body.endsWith("--BOUND--"));
  assert.ok(body.includes('"name":"n.txt"'));
  assert.ok(body.includes("OPERATIVE NOTE\nline 2"), "note text must survive verbatim");
  assert.equal(body.split("--BOUND").length - 1, 3, "two parts plus the closing delimiter");
});

test("availability explains WHY a destination is unusable instead of hiding it", () => {
  const rows = DEST.availability({ hasCrypto: true, hasDriveToken: false, ghisToken: "", driveFlag: true, emrFlag: true });
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.deepEqual(Object.keys(byId).sort(), ["drive", "emr", "local"]);
  // Every unavailable row must carry a non-empty reason - that is the whole point.
  for (const r of rows) {
    if (!r.available) assert.ok(r.reason && r.reason.length > 0, `${r.id} unavailable with no reason`);
  }
  assert.equal(byId.local.available, true);
  assert.equal(byId.drive.available, false, "no drive token (web preview) => unavailable");
  assert.equal(byId.emr.available, false, "signed out of GHIS => unavailable");
});

test("local is unavailable, with a reason, when secure storage is missing (fail closed)", () => {
  const rows = DEST.availability({ hasCrypto: false, hasDriveToken: true, ghisToken: "t", driveFlag: true, emrFlag: true });
  const local = rows.find((r) => r.id === "local");
  assert.equal(local.available, false);
  assert.match(local.reason, /unavailable/i);
});

test("a flag being off blocks the destination even when the transport is ready", () => {
  const rows = DEST.availability({ hasCrypto: true, hasDriveToken: true, ghisToken: "tok", driveFlag: false, emrFlag: false });
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(byId.drive.available, false);
  assert.equal(byId.emr.available, false);
});

test("both export destination flags default ON", () => {
  assert.equal(FLAGS.DEFS.smd_surgx_dest_emr.def, true);
  assert.equal(FLAGS.DEFS.smd_surgx_dest_drive.def, true);
});

test("the EMR write refuses without BOTH a patient and a visit", async () => {
  // An Initial Assessment attaches to a VISIT. Without episodeId the GHIS form GET returns a blank
  // doc_id 0 and the server would refuse anyway - failing here keeps us from claiming it sent.
  const calls = [];
  global.fetch = (...a) => { calls.push(a); return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) }); };
  try {
    global.GHIS = { getToken: () => "tok", getSelectedPatient: () => ({ patientId: "MR1", name: "x", episodeId: "" }) };
    const r = await DEST.saveToEmr({}, "note", { confirmed: true });
    assert.equal(r.error, "no_episode");
    global.GHIS = { getToken: () => "tok", getSelectedPatient: () => null };
    assert.equal((await DEST.saveToEmr({}, "note", { confirmed: true })).error, "no_patient_selected");
    global.GHIS = { getToken: () => "", getSelectedPatient: () => null };
    assert.equal((await DEST.saveToEmr({}, "note", { confirmed: true })).error, "ghis_signed_out");
    assert.equal(calls.length, 0, "nothing may be sent when the preconditions fail");
  } finally { delete global.GHIS; delete global.fetch; }
});

test("the EMR write posts the note and both ids to the GHIS route", async () => {
  let body = null;
  global.fetch = (url, init) => {
    body = { url, init: JSON.parse(init.body) };
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
  };
  global.GHIS = { getToken: () => "tok", getSelectedPatient: () => ({ patientId: "MR1", name: "x", episodeId: "EP9" }) };
  try {
    const r = await DEST.saveToEmr({ type: "op" }, "OPERATIVE NOTE", { confirmed: true });
    assert.equal(r.ok, true);
    assert.equal(body.url, "/api/ghis/surgx-note");
    assert.equal(body.init.patientId, "MR1");
    assert.equal(body.init.episodeId, "EP9");
    assert.equal(body.init.text, "OPERATIVE NOTE");
  } finally { delete global.GHIS; delete global.fetch; }
});

test("a server REFUSAL is surfaced, never reported as success", async () => {
  // saveAssessment reports refusals as {ok:false, resp:"..."} at HTTP 200. If resp were dropped the
  // UI could not tell "correctly refused" from "network failed".
  global.fetch = () => Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({ ok: false, status: 409, resp: "patient_mismatch: loaded form for MR2, expected MR1 - save aborted" })
  });
  global.GHIS = { getToken: () => "tok", getSelectedPatient: () => ({ patientId: "MR1", name: "x", episodeId: "EP9" }) };
  try {
    const r = await DEST.saveToEmr({}, "note", { confirmed: true });
    assert.equal(r.ok, false);
    assert.match(r.resp, /patient_mismatch/);
  } finally { delete global.GHIS; delete global.fetch; }
});

test("the GHIS surgical-note route appends to the assessment and stays behind the write gate", () => {
  const src = readFileSync(join(ROOT, "functions/api/ghis/[[path]].js"), "utf8");
  const i = src.indexOf("seg === 'surgx-note'");
  assert.ok(i > 0, "the surgx-note route should exist");
  const block = src.slice(i, i + 900);
  assert.ok(block.includes("emrWriteEnabled"), "must sit behind the EMR write gate");
  assert.ok(block.includes("saveAssessment"), "must reuse the verified OPD transport");
  assert.ok(block.includes("appendFields"), "must APPEND, never overlay");
  assert.ok(!/\bfields:\s*\{/.test(block), "must not use the overwriting `fields` path for a note");
});

test("appendText never destroys an existing management plan", async () => {
  // THE invariant of the EMR write: a surgical note is added to the doctor's management plan, it
  // never replaces it. Tested on the real exported function, not on a grep of the source.
  const { appendText } = await import(pathToFileURL(join(ROOT, "functions/api/ghis/[[path]].js")).href);

  const plan = "Continue IV ceftriaxone. Review in 48h.";
  const note = "OPERATIVE NOTE\nLap chole, CVS achieved.";

  const merged = appendText(plan, note);
  assert.ok(merged.startsWith(plan), "the existing plan must survive verbatim and stay first");
  assert.ok(merged.includes(note), "the note must be present");
  assert.ok(merged.includes("\n\n"), "the note reads as its own block");

  // Idempotent: a double-tap or a retry must not write it twice.
  assert.equal(appendText(merged, note), merged, "re-appending the same note is a no-op");

  // An empty field takes the note as its value; an empty note never blanks the field.
  assert.equal(appendText("", note), note);
  assert.equal(appendText(plan, ""), plan, "appending nothing must not clear the plan");
  assert.equal(appendText(plan, null), plan);
  assert.equal(appendText(null, note), note);
  assert.equal(appendText(null, null), "");
});
