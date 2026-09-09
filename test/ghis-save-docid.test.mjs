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
  /* The guarantee is "never activate the same identifier twice", not one particular expression.
   * It was `v === String(body.episodeId || '')`, which only covered the CALLER's episode; it is now
   * a `tried` Set seeded with that value, so it also spans the OPD and ward passes - each attempt
   * is a live POST that re-points the active visit in GHIS's session, so a repeat is not free. */
  assert.match(SAVE, /const tried = new Set\(\[String\(body\.episodeId \|\| ''\)\]\)/,
    "the caller's episode still counts as already tried");
  assert.match(SAVE, /if \(!v \|\| tried\.has\(v\)\) continue/, "never repeats one already tried");
  assert.match(SAVE, /tried\.add\(v\)/, "and each attempt is recorded");
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

/* ---- THE REGRESSION, finally identified from live evidence --------------------------------------
 * The live form comes back fully rendered (175KB, 113 fields) with patient_id "" and doc_id 0, while
 * Searchnew returns 200 and sets NO cookies. That is not a failed activation — it is GHIS handing us
 * a blank NEW assessment form. This file's own header says as much: "New = docId 0".
 *
 * The guard added 2026-08-13 refused EVERY doc_id 0, so the first-ever assessment for any visit could
 * never be saved. That is the "it used to work and now it doesn't". The two meanings of 0 are told
 * apart by whether we have a patient AND a visit to attach the new record to.
 */
test("CREATE: doc_id 0 needs a patient, a visit, AND a confirmed activation", () => {
  /* Tightened on 2026-08-26 together with the payload flip below. While the POST carried the
   * patient and episode ids, knowing the episode was enough - the ids themselves targeted the
   * record. Now that the ids go out empty (matching GHIS's own UI), the session's active visit is
   * the ONLY thing deciding which chart a create lands in, so naming an episode proves nothing.
   * Only a Searchnew that actually returned 2xx does. */
  const save = GHIS.slice(GHIS.indexOf("export async function saveAssessment"), GHIS.indexOf("export async function onRequest"));
  assert.match(save, /const canCreate = !!\(mr && attachTo && epiActivated\)/,
    "a create needs both ids and a confirmed activation");
  assert.match(save, /&& !clientDoc && !canCreate\)/, "…and only then is the refusal still correct");
  assert.match(save, /const attachTo = String\(body\.episodeId \|\| ''\) \|\| epiUsed/,
    "the visit may have come from the roster lookup rather than the caller");
  /* MEASURED against the live server, 2026-08-26: HTTP 200 proves nothing. An unauthenticated
   * session and a working one BOTH answered 200 to Searchnew - the first a redirect stub, the
   * second the patient's own page. A guard on the status alone could not fail. What separates them
   * is the body echoing the MR that was activated (13 occurrences vs 0). */
  assert.match(save, /const echoed = String\(\(a && a\.body\) \|\| ''\)\.indexOf\(mr\) !== -1/,
    "activation is confirmed by the response naming the patient, not by the status");
  assert.match(save, /epiActivated = !!\(a && a\.status >= 200 && a\.status < 300 && echoed\)/,
    "both the transport AND the identity must agree");
  assert.match(save, /:mr-ok' : ':mr-absent'/,
    "the attempt trail distinguishes a real activation from a 200 that did nothing");
  assert.match(save, /\{ epiActivated = false; attempts\.push\(how \+ ':no-epi'\); \}/,
    "no episode means no activation, never a stale true from a previous candidate");
});

test("CREATE: the ids go out EXACTLY as the form gave them — empty for a new record", () => {
  /* THE PAYLOAD FLIP (live capture, 2026-08-26, docs/ghis/captured-initial-assessment-write.md).
   *
   * This file used to fill both ids in whenever the form omitted them, justified in a comment
   * asserting that posting them set "is exactly how GHIS's own form creates the first assessment
   * for a visit". The capture shows the opposite: the real UI posts
   *     assessment.Initial_Assessment_doc_id=0
   *     assessment.episode_id=
   *     assessment.patient_id=
   * and GHIS answers 200, resolving the target from the active visit in its session. Every create
   * we sent therefore deviated from the only payload known to work. */
  const save = GHIS.slice(GHIS.indexOf("export async function saveAssessment"), GHIS.indexOf("export async function onRequest"));
  assert.ok(!/all\['assessment\.patient_id'\] = String\(body\.patientId\)/.test(save),
    "the patient id must no longer be invented when the form left it blank");
  assert.ok(!/all\['assessment\.episode_id'\] = String\(attachTo\)/.test(save),
    "nor the episode id");
  assert.match(save, /all\['assessment\.patient_id'\] = ''/, "an absent patient id is sent as empty");
  assert.match(save, /all\['assessment\.episode_id'\] = ''/, "an absent episode id is sent as empty");
});

test("UPDATE is untouched: a form that HAS the ids still passes them through", () => {
  /* The flip must only affect the create path. On an update the form supplies the real ids and
   * overwriting them with a stale client value is what made GHIS answer "Unable to process". */
  const save = GHIS.slice(GHIS.indexOf("export async function saveAssessment"), GHIS.indexOf("export async function onRequest"));
  // Both writes are guarded on the field being ABSENT, so a populated form value survives.
  assert.match(save, /if \(!all\['assessment\.patient_id'\]\) all\['assessment\.patient_id'\] = ''/);
  assert.match(save, /if \(!all\['assessment\.episode_id'\]\) all\['assessment\.episode_id'\] = ''/);
  assert.match(save, /if \(!all\['assessment\.Initial_Assessment_doc_id'\] && body\.docId/,
    "the doc id keeps its client fallback — that one IS still read back from the form");
});

test("the patient-mismatch abort still fires, and still runs BEFORE the payload is built", () => {
  // The one guard that stops a write landing on another patient's chart. Emptying the ids must not
  // have moved or weakened it.
  const save = GHIS.slice(GHIS.indexOf("export async function saveAssessment"), GHIS.indexOf("export async function onRequest"));
  assert.match(save, /patient_mismatch: loaded form for/);
  assert.ok(save.indexOf("patient_mismatch") < save.indexOf("all['assessment.patient_id'] = ''"),
    "the mismatch check reads the form's own patient_id before anything is normalised away");
});

test("CREATE: the response says whether it created or updated", () => {
  const save = GHIS.slice(GHIS.indexOf("export async function saveAssessment"), GHIS.indexOf("export async function onRequest"));
  assert.match(save, /const mode = \(formDoc && String\(formDoc\) !== '0'\) \|\| clientDoc \? 'update' : 'create'/);
});

test("REFUSAL still stands when there is nothing to attach to", () => {
  const save = GHIS.slice(GHIS.indexOf("export async function saveAssessment"), GHIS.indexOf("export async function onRequest"));
  assert.match(save, /no_active_assessment: form doc_id is 0/, "no patient/visit -> still refused, no orphan");
});

/* ---- Sign-off from the queue ------------------------------------------------------------------
 * Before this, the ONLY way to finish a consult after saving was a swipe control in the post-save
 * panel — easy to miss, and not named for what the doctor is doing. */
test("AUTHORISE: an explicit sign-off button appears once the note is saved", () => {
  const panel = OPD.slice(OPD.indexOf("function postConsultPanel"), OPD.indexOf("function oncoTab"));
  assert.match(panel, /data-oe-act="consult-authorise"/, "the button exists in the post-save panel");
  assert.match(panel, /Authorise &amp; sign off/);
  assert.match(panel, /oe-swipe/, "the original swipe still works — this is additive");
});

/* The real GHIS action, read off the live form rather than guessed:
 *   <button name="ButtonType" value="true" onclick="signOff1('20015')">Authorize</button>
 *   signOff1 -> POST ./Home/signoffinitialAssessmentnew {__RequestVerificationToken, id:<doc_id>}
 *   success when the response body is "Successfully signed off"
 * I had previously reported GHIS has no authorise action — wrong: /assessment truncates the page to
 * 8000 chars of tag-stripped text and the buttons sit at the end of a 355KB page. */
/* The intended model, in the owner's words: "Save to GHIS for only editable save, and once he saves
 * it the Authorise button appears for locked permanent save." GHIS enforces the lock — after sign-off
 * the form renders read-only — so the app must mirror it rather than let a doctor edit a record that
 * can no longer be written. */
test("LOCK: the server reports whether the record is already authorised", () => {
  assert.match(GHIS, /Authori\[sz\]ed\\s\+on\\s\+/, "parsed from GHIS's own 'Authorized on … by …' stamp");
  assert.match(GHIS, /authorized: authorized/, "and returned with the form");
});

test("LOCK: three states — draft saves, saved offers Authorise, authorised offers neither", () => {
  const bar = OPD.slice(OPD.indexOf("var lock = st.assessAuthorized"), OPD.indexOf("return consultBar(st)"));
  assert.match(bar, /if \(lock\)/, "authorised renders the locked bar");
  assert.match(bar, /oe-savebar locked/);
  assert.match(bar, /Authorised/, "…naming who signed it off and when");
  assert.match(bar, /oeDocId\(\)\)\s*\n?\s*\? '<button class="oe-btn authorise"/,
    "Authorise appears on a SAVED record — by doc id, so reopening an earlier note still offers it");
});

test("LOCK: saving an authorised record is refused with an explanation", () => {
  const fn = OPD.slice(OPD.indexOf("function submitAssessment"), OPD.indexOf("function clearAssessment"));
  assert.match(fn, /if \(st\.assessAuthorized\)/, "blocked before the request");
  assert.match(fn, /authorised and locked/, "and the doctor is told why, not shown a failure");
});

test("LOCK: authorising is spelled out as irreversible, and re-authorising is blocked", () => {
  const fn = OPD.slice(OPD.indexOf("function authoriseConsult"), OPD.indexOf("function endConsult"));
  assert.match(fn, /already authorised/, "no double sign-off");
  assert.match(fn, /Save the assessment first/, "and nothing to sign off before a save");
  assert.match(fn, /LOCKED/, "the confirm says plainly that it cannot be edited afterwards");
  assert.match(fn, /st\.assessAuthorized = \{/, "the lock is reflected immediately on success");
});

test("AUTHORISE: the server calls GHIS's real sign-off endpoint", () => {
  assert.match(GHIS, /signoffinitialAssessmentnew/, "the exact URL signOff1 posts to");
  const fn = GHIS.slice(GHIS.indexOf("export async function authorizeAssessment"), GHIS.indexOf("const json = (obj, status = 200)"));
  assert.match(fn, /new URLSearchParams\(\{ __RequestVerificationToken: csrf, id: docId \}\)/, "same payload shape using URLSearchParams");
  assert.match(fn, /successfully\\s\+signed\\s\*off/, "keyed on GHIS's own success string");
  assert.match(fn, /activateVisit/, "activates the visit and threads the cookie, like the save");
});

test("AUTHORISE: never signs off a record that was never saved", () => {
  const fn = GHIS.slice(GHIS.indexOf("export async function authorizeAssessment"), GHIS.indexOf("const json = (obj, status = 200)"));
  assert.match(fn, /if \(!docId\) return \{ ok: false, status: 409, resp: 'no_saved_assessment/,
    "doc_id 0 would sign off nothing");
  assert.match(fn, /patient_mismatch/, "and the wrong-patient guard applies here too");
});

test("AUTHORISE: the route is write-gated like the save", () => {
  assert.match(GHIS, /seg === 'assessment-authorize' && request\.method === 'POST'[\s\S]{0,120}emrWriteEnabled\(env\)/,
    "authorising is a clinical record write");
});

test("AUTHORISE: the consult finishes only after GHIS confirms", () => {
  // Sliced from the GHIS-specific body (after the 2026-09-06 WardSynQ-native early-return branch,
  // which has its own postWrite-free endConsult() call and would otherwise confuse this ordering check).
  const fn = OPD.slice(OPD.indexOf("if (!oeDocId())"), OPD.indexOf("function endConsult"));
  assert.match(fn, /postWrite\("\/assessment-authorize"/, "calls the endpoint");
  assert.match(fn, /endConsult\(\)/, "…and ends the consult in the success callback");
  assert.ok(fn.indexOf("endConsult()") > fn.indexOf("postWrite"),
    "a failed authorise must never silently advance the queue");
});

test("AUTHORISE: it confirms, then ends the consult so the queue advances", () => {
  const fn = OPD.slice(OPD.indexOf("function authoriseConsult"), OPD.indexOf("function endConsult"));
  assert.match(fn, /confirmed\(/, "signing off is deliberate, never a stray tap");
  assert.match(fn, /endConsult\(\)/, "…and ends the consult, which queue.js turns into /advance");
  assert.match(OPD, /if \(cmd === "consult-authorise"\) return authoriseConsult\(\)/, "the action is routed");
});

test("AUTHORISE: queue.js still advances on the consult-end event", () => {
  const Q = readFileSync(new URL("../queue.js", import.meta.url), "utf8");
  assert.match(Q, /smd:consult-end[\s\S]{0,120}\/advance/, "the sign-off actually moves the queue on");
});

test("the doctor still gets a plain sentence, with the trace appended for diagnosis", () => {
  const h = helpers()({}, () => "GHIS");
  const msg = h.ghisSay("no_active_assessment: form doc_id is 0 (visit not activated) — refusing to write a blank/duplicate [tried caller=blank opdlist=blank]");
  assert.match(msg, /Reopen the patient/, "still actionable");
  assert.match(msg, /\[tried caller=blank opdlist=blank\]/, "and the trace survives to the screenshot");
  assert.ok(!/doc_id/.test(msg), "without leaking the internals around it");
});
