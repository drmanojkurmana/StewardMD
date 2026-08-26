/* Admitted patients have Initial assessments too, and the write path could not find them.
 *
 * Reported with a screen recording (owner, 2026-08-26): the GHIS IP worklist for GENERAL SURGERY
 * lists admitted patients with a Visit ID of the form IPMR2600254xx, and opening one shows a full
 * Initial assessment - Chief complaints, Present history, Past history - exactly the same form an
 * out-patient gets.
 *
 * saveAssessment activates a visit, re-reads the form, and refuses to write if the form comes back
 * with doc_id 0 (a blank, unactivated record - posting it creates an orphan while the app says
 * "Saved"). That refusal is correct and stays. The bug was in the RECOVERY beneath it: when the
 * caller's episode did not activate, it looked the patient up in getOpdPatients - the OUT-patient
 * list - and nowhere else. An admitted patient is not on that list, so the lookup reported
 * "opdlist:no-row", every candidate was exhausted, and the write failed as
 * "no_active_assessment: form doc_id is 0". Which reads as "this patient has no assessment" when
 * the truth is that we never looked where an in-patient's assessment lives.
 *
 * The ward roster (GetIPWL, Type:'IPWorkList') is already fetched for Ward Sync, so the fix adds no
 * endpoint and no auth. What it does need is tolerance: the IP and OPD tables come straight from
 * GHIS's own JSON and do not agree on field casing, so nothing may assume one spelling.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findWardRow, ipEpisodeCandidates } from "../functions/api/ghis/[[path]].js";

const SRC = readFileSync(new URL("../functions/api/ghis/[[path]].js", import.meta.url), "utf8");

/* A row shaped like the one in the recording. */
const NUKARAJU = { patientId: "MR2472736", patientFirstName: "NUKARAJU", episodeId: "IPMR260025481", bed: "Ward2-3" };

test("the admitted patient from the ward list is found by MR number", () => {
  const rows = [
    { patientId: "MR26160051", episodeId: "IPMR260025493" },
    NUKARAJU,
    { patientId: "MR26160758", episodeId: "IPMR260025474" }
  ];
  assert.equal(findWardRow(rows, "MR2472736"), NUKARAJU);
});

test("the MR match ignores case and stray whitespace", () => {
  // The id arrives from a note, a queue ticket or a hand-typed field; none of them are trimmed.
  assert.equal(findWardRow([NUKARAJU], "  mr2472736 "), NUKARAJU);
});

test("a patient who is not on the ward is not guessed at", () => {
  assert.equal(findWardRow([NUKARAJU], "MR99999999"), null);
  assert.equal(findWardRow([], "MR2472736"), null);
  assert.equal(findWardRow(null, "MR2472736"), null, "an unavailable roster must not throw");
  assert.equal(findWardRow([NUKARAJU], ""), null, "no MR means no match, never the first row");
});

test("the MR is read whatever GHIS calls the column", () => {
  /* GetIPWL and the OPD DashboardUnit disagree on casing, and this has already cost one wrong
   * theory ("MR-OPMR… is the wrong recordNo") that turned out to be about cookies instead. */
  for (const key of ["patientId", "PatientId", "PatientID", "MRNo", "UHID", "mrn"]) {
    const row = { [key]: "MR2472736", episodeId: "IPMR260025481" };
    assert.ok(findWardRow([row], "MR2472736"), `an IP row keyed by ${key} must still match`);
  }
});

test("the admission visit id is offered as an episode candidate", () => {
  const c = ipEpisodeCandidates(NUKARAJU);
  assert.ok(c.length >= 1, "the row must yield something to activate against");
  assert.equal(c[0][1], "IPMR260025481", "the ward row's episode is the first thing to try");
  assert.match(c[0][0], /^ip:/, "candidates are labelled so a failure says what was tried");
});

test("every distinct identifier on the row is tried, most likely first", () => {
  const row = { patientId: "MR1", episodeId: "IPMR900", VisitId: "V900", AdmissionNo: "A900" };
  const vals = ipEpisodeCandidates(row).map((c) => c[1]);
  assert.deepEqual(vals, ["IPMR900", "V900", "A900"]);
});

test("the same value appearing under two column names is only tried once", () => {
  // Activation is a live POST against a patient's chart; retrying an identical value is pure noise.
  const row = { episodeId: "IPMR900", VisitId: "IPMR900", visitId: "IPMR900" };
  assert.deepEqual(ipEpisodeCandidates(row).map((c) => c[1]), ["IPMR900"]);
});

test("a ward row with no usable identifier yields nothing rather than an empty string", () => {
  assert.deepEqual(ipEpisodeCandidates({ patientId: "MR1" }), []);
  assert.deepEqual(ipEpisodeCandidates({ patientId: "MR1", episodeId: "   " }), [],
    "a blank column is not an episode");
  assert.deepEqual(ipEpisodeCandidates(null), []);
});

/* ── the wiring, in the shipped function ──────────────────────────────────── */

test("saveAssessment consults the WARD roster, not only the OPD list", () => {
  const fn = SRC.slice(SRC.indexOf("export async function saveAssessment"));
  assert.match(fn, /getPatients\(env, token\)/,
    "the in-patient worklist must actually be called on the recovery path");
  assert.match(fn, /findWardRow/);
  assert.match(fn, /ipEpisodeCandidates/);
  // It must remain a FALLBACK: the caller's own episode is still tried first.
  assert.ok(fn.indexOf("activateAndLoad(String(body.episodeId") < fn.indexOf("getPatients(env, token)"),
    "the caller's episode is tried before any roster lookup");
  assert.ok(fn.indexOf("getOpdPatients") < fn.indexOf("getPatients(env, token)"),
    "the OPD list is still tried first for out-patients");
});

test("a failure still reports WHICH lists were searched", () => {
  const fn = SRC.slice(SRC.indexOf("export async function saveAssessment"));
  for (const marker of ["iplist:no-row", "iplist:unavailable", "iplist:error", "opdlist:no-row"]) {
    assert.ok(fn.includes(marker), `the attempt trail must record ${marker}`);
  }
});

test("no identifier is activated twice across the OPD and ward passes", () => {
  /* Both rosters can carry the same visit id, and each attempt is a live POST that marks the
   * active visit in GHIS's server-side session. */
  const fn = SRC.slice(SRC.indexOf("export async function saveAssessment"));
  assert.match(fn, /const tried = new Set/);
  assert.match(fn, /tried\.has\(v\)/);
});

test("the doc_id 0 refusal is still in place", () => {
  // The whole point of this path is to find the REAL record, never to loosen the guard that stops
  // a blank one being written into a live chart.
  assert.match(SRC, /no_active_assessment/);
  assert.match(SRC, /patient_mismatch/);
});

/* ── activation format, verified against the live server ──────────────────── */

test("an admitted patient activates with the same <MR>-<visit> recordNo as an out-patient", () => {
  /* Captured 2026-08-26 by clicking a patient in the IP worklist:
   *   POST /Doctor/Home/Searchnew   recordNo=MR26160934-IPMR260025490
   * followed immediately by GET /Doctor/Home/GetInitialAssessmentnew/?id=MR26160934.
   *
   * So the activation request never needed changing - only the VALUE was missing, because the
   * episode was looked up in the OPD list alone. Pinned because a future refactor that "tidies"
   * this into a different shape (an ip= param, a separate endpoint, a JSON body) would break the
   * ward path silently: a wrong recordNo does not error, it just activates nothing and the form
   * comes back blank with doc_id 0. */
  const mr = "MR26160934", visit = "IPMR260025490";
  assert.equal(mr + "-" + visit, "MR26160934-IPMR260025490");
  // Both live call sites must build exactly that, and both must send the CSRF token with it.
  const calls = SRC.match(/'\/Doctor\/Home\/Searchnew'[\s\S]{0,200}?recordNo=' \+ encodeURIComponent\((mrId|mr) \+ '-' \+ epi\)/g) || [];
  assert.ok(calls.length >= 2,
    `both the prefill and the save must activate with <MR>-<visit>; found ${calls.length}`);
  assert.ok(SRC.includes("__RequestVerificationToken=' + encodeURIComponent(s.csrf || '') + '&recordNo="),
    "activation carries the antiforgery token, as the capture does");
  // The form is then read by MR, not by the visit - also straight from the capture.
  assert.match(SRC, /GetInitialAssessmentnew\/\?id=' \+ encodeURIComponent\(mrId\)/,
    "the prefill reads the form by MR number");
});

test("the ward episode reaches the activation unchanged", () => {
  // An IPMR id must survive the candidate pass verbatim - no trimming of the IP prefix, no
  // coercion to a number, both of which would produce a recordNo GHIS silently ignores.
  const c = ipEpisodeCandidates({ patientId: "MR26160934", episodeId: "IPMR260025490" });
  assert.equal(c[0][1], "IPMR260025490");
  assert.equal("MR26160934" + "-" + c[0][1], "MR26160934-IPMR260025490",
    "the captured recordNo is reproduced exactly");
});
