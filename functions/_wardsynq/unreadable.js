/* functions/_wardsynq/unreadable.js - a clinical read that FAILED is said, never rendered as nothing.
 *
 * The bug this exists to kill (R6-1, 2026-09-18): `svc.byPatient("AllergyIntolerance", id).catch(() => [])`
 * inside a safety check. The store hiccups, the check gets an empty list, and a patient with a
 * documented penicillin allergy is presented to the prescriber as a patient with no allergies. The
 * per-read catch also swallows the failure before the function's own outer catch can see it, so the
 * degraded / fail-closed branch written underneath it never runs at all.
 *
 * The rule is the one R5-1 established in break-glass.js (`unreadableTypes`) and
 * migrate-inpatient.js (`advisoriesUnavailable`): null is a read that did not happen, [] is a read
 * that happened and found nothing, and the caller is handed the names of the types it did not get.
 *
 * node --test test/wardsynq-rx-safety.test.mjs test/wardsynq-pharmacy-verify.test.mjs test/wardsynq-radiology-protocol.test.mjs
 */

const str = (v) => (v == null ? "" : String(v).trim());

/**
 * Awaits a record read. On failure it returns null - NOT [] - and pushes the type onto `failures`.
 * `failures` is the caller's own array, so one Promise.all can report several types at once.
 */
async function readOrNull(promise, type, failures) {
  try { return await promise; }
  catch (e) { failures.push({ type, reason: str(e && e.message) || "record_read_failed" }); return null; }
}

/** The verdict-side shape: `{ notChecked: ["AllergyIntolerance"], reason }`, or null if every read landed. */
function unavailable(failures) {
  if (!failures || !failures.length) return null;
  return { notChecked: failures.map((f) => f.type), reason: failures[0].reason || "record_read_failed" };
}

export { readOrNull, unavailable };
