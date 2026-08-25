/* test/ghis-save-docid.test.mjs — "Save to GHIS" must survive a visit that drifts out of activation.
 *
 * Reported: Save to GHIS, which used to work, now fails with
 *   "GHIS: no_active_assessment: form doc_id is 0 (visit not activated) — refusing to write a blank/d…"
 *
 * That refusal is CORRECT and must stay: a doc_id-0 form means GHIS handed back a blank record, and
 * posting it creates an orphan while the app cheerfully says "Saved". The bug is that the client had
 * the real record id all along — the prefill GET returns Initial_Assessment_doc_id — and threw it
 * away, so the save had no fallback when the server-side re-activation did not stick. The server has
 * always accepted body.docId for exactly this; nothing was sending it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const OPD = readFileSync(new URL("../opd-emr.js", import.meta.url), "utf8");
const GHIS = readFileSync(new URL("../functions/api/ghis/[[path]].js", import.meta.url), "utf8");

// Lift the two pure client helpers out of the IIFE and run them for real.
function helpers() {
  const grab = (name) => {
    const at = OPD.indexOf("function " + name + "(");
    assert.ok(at > 0, "found " + name);
    let i = OPD.indexOf("{", at), depth = 0, end = i;
    for (; end < OPD.length; end++) {
      if (OPD[end] === "{") depth++;
      else if (OPD[end] === "}") { depth--; if (!depth) break; }
    }
    return OPD.slice(at, end + 1);
  };
  return new Function("st", "emrLabel",
    grab("oeFieldValue") + grab("oeDocId") + grab("ghisSay") +
    "return { oeFieldValue: oeFieldValue, oeDocId: oeDocId, ghisSay: ghisSay };");
}

test("the prefill's record id is read out of the form payload", () => {
  const h = helpers()({}, () => "GHIS");
  const fields = [{ name: "patient_id", value: "MR26097363" }, { name: "Initial_Assessment_doc_id", value: "884211" }];
  assert.equal(h.oeFieldValue(fields, "Initial_Assessment_doc_id"), "884211");
  assert.equal(h.oeFieldValue(fields, "not_there"), "");
  assert.equal(h.oeFieldValue(null, "anything"), "", "a failed prefill must not throw");
});

test("a blank/0 record id is NEVER sent — the server's refusal must still fire", () => {
  const label = () => "GHIS";
  assert.equal(helpers()({ assessDocId: "0" }, label).oeDocId(), "", "0 means 'no real record', not an id");
  assert.equal(helpers()({ assessDocId: "" }, label).oeDocId(), "");
  assert.equal(helpers()({}, label).oeDocId(), "", "never loaded a form → no id to offer");
  assert.equal(helpers()({ assessDocId: "884211" }, label).oeDocId(), "884211", "a real id is offered as the fallback");
});

test("every assessment-save call sends the record id", () => {
  const calls = OPD.match(/postWrite\("\/assessment-save",[^)]*/g) || [];
  assert.ok(calls.length >= 3, "found the save call sites (" + calls.length + ")");
  // NB: the capture stops at the first ")" — which is oeDocId's own — so match the call, not "()".
  calls.forEach((c) => assert.match(c, /docId: oeDocId\(/, "a save without the id has no fallback: " + c.slice(0, 90)));
});

test("SERVER: the doc_id-0 refusal is still in force, and still honours a client id", () => {
  assert.match(GHIS, /no_active_assessment: form doc_id is 0/, "the orphan-write guard stays");
  assert.match(GHIS, /const clientDoc = \(body\.docId != null/, "…with the client fallback it was built to accept");
  assert.match(GHIS, /patient_mismatch: loaded form for/, "and the wrong-patient guard is untouched");
});

test("the doctor is told what to DO, not handed a machine code", () => {
  const h = helpers()({}, () => "GHIS");
  const msg = h.ghisSay("no_active_assessment: form doc_id is 0 (visit not activated) — refusing to write a blank/duplicate");
  assert.match(msg, /Reopen the patient/, "actionable");
  assert.match(msg, /nothing you typed is lost/, "and reassuring — the note is still on screen");
  assert.ok(!/doc_id/.test(msg), "no internal jargon");
  assert.match(h.ghisSay("patient_mismatch: loaded form for MR1, expected MR2"), /different patient/);
  assert.match(h.ghisSay("something novel"), /GHIS: something novel/, "unknown codes still surface for diagnosis");
  assert.match(h.ghisSay(""), /Could not complete/);
});

/* ---- Second cause: the visit was never activated because nobody knew the episode ----------------
 * After the docId fallback shipped, the save still refused. That fallback only helps when the form
 * loaded a real record; if the queue ticket carries no ghisEpisodeId/visitId, episodeId is "" and the
 * Searchnew activation is SKIPPED in BOTH the prefill and the save — so the form is blank at both
 * ends and there is no id to fall back to. GHIS's own OPD list knows the visit for that MR.
 */
import { resolveEpisode, parseOpdHtml } from "../functions/api/ghis/[[path]].js";

const OPD_ROWS = [
  { patientId: "MR26097363", visitId: "OP99881", visitType: "OPD" },
  { patientId: "MR26159243", visitId: "OP99882", visitType: "OPD" },
];
const listing = (rows) => async () => rows;

test("an episode the caller already has is used as-is (no lookup)", async () => {
  let called = false;
  const epi = await resolveEpisode({}, "t", "MR26097363", "OP12345", { listOpd: async () => { called = true; return OPD_ROWS; } });
  assert.equal(epi, "OP12345");
  assert.equal(called, false, "never spend a round-trip when the caller already knows the visit");
});

test("REGRESSION: a missing episode is resolved from today's OPD list", async () => {
  const epi = await resolveEpisode({}, "t", "MR26097363", "", { listOpd: listing(OPD_ROWS) });
  assert.equal(epi, "OP99881", "this is what makes the visit activate, so the form is not blank");
});

test("the MR is matched case/whitespace-insensitively", async () => {
  assert.equal(await resolveEpisode({}, "t", " mr26159243 ", "", { listOpd: listing(OPD_ROWS) }), "OP99882");
});

test("a patient not on today's list falls through to the guard, not to a wrong visit", async () => {
  assert.equal(await resolveEpisode({}, "t", "MR-NOT-TODAY", "", { listOpd: listing(OPD_ROWS) }), "",
    "attaching an assessment to someone else's visit would be far worse than refusing");
});

test("a broken or unauthenticated OPD list never throws into the save path", async () => {
  assert.equal(await resolveEpisode({}, "t", "MR26097363", "", { listOpd: async () => { throw new Error("login_required"); } }), "");
  assert.equal(await resolveEpisode({}, "t", "MR26097363", "", { listOpd: async () => ({ unauth: true }) }), "");
  assert.equal(await resolveEpisode({}, "t", "MR26097363", "", { listOpd: async () => null }), "");
});

test("no MR means no lookup", async () => {
  assert.equal(await resolveEpisode({}, "t", "", "", { listOpd: listing(OPD_ROWS) }), "");
});

test("SERVER: the prefill activates too — a blank prefill leaves no doc_id to fall back on", () => {
  assert.match(GHIS, /await resolveEpisode\(env, token, mrId, ''\)/, "the prefill retries with GHIS's own visit");
});

/* ---- Third attempt. The first two assumed things instead of checking them -----------------------
 * Fix 1 sent the client's doc_id — useless when the PREFILL was also blank.
 * Fix 2 looked the episode up — but only when episodeId was EMPTY. The queue sets
 *   episodeId = ghisEpisodeId || visitId
 * so a ticket without the real episode substitutes a VISIT NUMBER, which recordNo does not accept.
 * Activation silently no-ops, the form comes back blank, and because episodeId was non-empty the
 * lookup never ran. Both fixes reasoned about the code instead of checking what GHIS returned.
 *
 * The save now ACTIVATES, READS THE DOC_ID BACK, and retries with GHIS's own visit if it is blank.
 */
const SAVE = GHIS.slice(GHIS.indexOf("export async function saveAssessment"), GHIS.indexOf("export async function onRequest"));
const PREFILL = GHIS.slice(GHIS.indexOf("async function getAssessmentForm"), GHIS.indexOf("// READ a patient's OP visit"));

test("SAVE: the caller's episode is verified, not trusted", () => {
  assert.match(SAVE, /activateAndLoad/, "activation and the read-back are one step");
  assert.match(SAVE, /const live = !\(doc == null/, "the doc_id actually returned decides success");
  assert.match(SAVE, /if \(!got\.live\)/, "a blank form triggers the retry — this is what a WRONG episode looks like");
});

/* Fourth round. The trace from the device said "[tried caller=blank]" — ONE attempt, no opdlist line.
 * The retry had been skipped as pointless because the looked-up value EQUALLED the caller's. Cause:
 * parseOpdHtml maps visitid|opno|visitno|episode all onto `visitId`, first-column-wins, so on a table
 * listing "OP No" before "Episode" the OP number takes the slot and the episode is DISCARDED. Both
 * "candidates" were therefore the same wrong number. The save now tries BOTH ids off the row. */
test("SAVE: every identifier GHIS gives for the visit is tried, not one guess", () => {
  assert.match(SAVE, /cands\.push\(\['epi', row\.episodeId\], \['visit', row\.visitId\]\)/, "episode AND visit number");
  assert.match(SAVE, /for \(let i = 0; i < cands\.length && !got\.live; i\+\+\)/, "stops at the first that activates");
  assert.match(SAVE, /v === String\(body\.episodeId \|\| ''\)\) continue/, "never repeats the one already tried");
});

test("PARSE: the episode column is captured, not swallowed by the OP number", () => {
  const rows = parseOpdHtml(
    '<table><tr><th>MR No</th><th>OP No</th><th>Episode</th><th>Patient Name</th><th>Visit Type</th></tr>' +
    '<tr><td>MR26097363</td><td>OP99881</td><td>EPI55512</td><td>A Patient</td><td>OPD</td></tr></table>');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].visitId, "OP99881", "visitId keeps its old meaning for every existing caller");
  assert.equal(rows[0].episodeId, "EPI55512", "…and the episode is no longer thrown away");
});

test("PARSE: a table with only an Episode column still fills both", () => {
  const rows = parseOpdHtml(
    '<table><tr><th>MRN</th><th>Episode</th><th>Name</th><th>Visit Type</th></tr>' +
    '<tr><td>MR1</td><td>EPI7</td><td>B Patient</td><td>OPD</td></tr></table>');
  assert.equal(rows[0].visitId, "EPI7", "unchanged: episode still satisfies visitId when it is the only id");
  assert.equal(rows[0].episodeId, "EPI7");
});

test("the lookup prefers the real episode over the OP number", () => {
  const rows = [{ patientId: "MR1", visitId: "OP9", episodeId: "EPI7", visitType: "OPD" }];
  return resolveEpisode({}, "t", "MR1", "", { listOpd: async () => rows })
    .then((e) => assert.equal(e, "EPI7", "recordNo wants the episode; the OP number is what was failing"));
});

test("SAVE: a failure reports which attempts GHIS rejected", () => {
  assert.match(SAVE, /\[tried '/, "the refusal carries the attempt trace");
  assert.match(SAVE, /attempts\.push\(how \+/, "each attempt records caller/opdlist and ok/blank");
  assert.match(SAVE, /opdlist:no-row/, "…including 'this MR is not on today's list at all'");
});

test("PREFILL: it verifies too — a blank prefill leaves no doc_id to fall back on", () => {
  assert.match(PREFILL, /if \(!got\.live\)/, "the prefill retries on a blank form as well");
  assert.match(PREFILL, /await resolveEpisode\(env, token, mrId, ''\)/);
});

/* ---- The actual bug, found by asking the live server instead of reading code -------------------
 * Verified against GHIS with real credentials:
 *   - today's OPD list has NO Episode column (keys: age, department, doctor, gender, patientId,
 *     patientName, queueStatus, visitId, visitType) — so the "discarded episode column" theory was
 *     wrong too;
 *   - recordNo "MR…-OPMR…" IS correct: Searchnew returns the patient page for it, and for nothing else;
 *   - activating via /demographics and then reading the assessment STILL gives doc_id 0.
 * Therefore the active visit is carried in a COOKIE Searchnew hands back, and ghisReq — which always
 * sends the stored login cookie and only RETURNS setCookie — was dropping it between the activation
 * and the read.
 */
test("COOKIE: the activation's Set-Cookie is carried into the form read and the save", () => {
  const save = GHIS.slice(GHIS.indexOf("export async function saveAssessment"), GHIS.indexOf("export async function onRequest"));
  assert.match(save, /let cookie = s\.cookie/, "one cookie is threaded through the whole sequence");
  assert.match(save, /Searchnew[\s\S]{0,400}?'Cookie': cookie/, "the activation sends it");
  assert.match(save, /if \(sc\.length\) cookie = mergeCookies\(cookie, sc\)/,
    "…and merges what Searchnew hands back — dropping this is the whole bug");
  assert.match(save, /GetInitialAssessmentnew[\s\S]{0,200}?'Cookie': cookie/, "the form read carries it");
  assert.match(save, /const postCookie = cookie/, "and so does the save POST");
});

test("COOKIE: the prefill threads it too, or it loads a blank form", () => {
  const pre = GHIS.slice(GHIS.indexOf("async function getAssessmentForm"), GHIS.indexOf("// READ a patient's OP visit"));
  assert.match(pre, /let cookie = s\.cookie/);
  assert.match(pre, /cookie = mergeCookies\(cookie, a\.setCookie\)/);
  assert.match(pre, /GetInitialAssessmentnew[\s\S]{0,200}?'Cookie': cookie/);
});

test("REGRESSION: no dangling `gr` after the activate-then-check refactor", () => {
  const save = GHIS.slice(GHIS.indexOf("export async function saveAssessment"), GHIS.indexOf("export async function onRequest"));
  assert.ok(!/mergeCookies\(s\.cookie, gr\.setCookie\)/.test(save),
    "`gr` was removed by that refactor — this line would throw on the first save that got past the guard");
});

test("the doctor still gets a plain sentence, with the trace appended for diagnosis", () => {
  const h = helpers()({}, () => "GHIS");
  const msg = h.ghisSay("no_active_assessment: form doc_id is 0 (visit not activated) — refusing to write a blank/duplicate [tried caller=blank opdlist=blank]");
  assert.match(msg, /Reopen the patient/, "still actionable");
  assert.match(msg, /\[tried caller=blank opdlist=blank\]/, "and the trace survives to the screenshot");
  assert.ok(!/doc_id/.test(msg), "without leaking the internals around it");
});
