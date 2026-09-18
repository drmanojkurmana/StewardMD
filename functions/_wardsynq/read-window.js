/* functions/_wardsynq/read-window.js - reading a period instead of a history (R5-3, 2026-09-17).
 *
 * Every NABH, HMIS, trend, quality and infection report already computes over a window of months or
 * days, and every one of them used to read the hospital's WHOLE history of each source type to do it
 * (service.listAll). On a 200-bed hospital that is tens of thousands of MedicationAdministration rows
 * within weeks, parsed into one Worker isolate, to answer a question about one month.
 *
 * This is the decision of WHICH types a period read is safe for, in one place, because it is a
 * clinical-correctness decision and not a per-module one.
 *
 * HOW A RECORD IS JUDGED. service.listSince walks back from the newest record and stops at the first
 * whole page of records that are entirely behind the window. "Behind the window" is decided from the
 * record itself: the LATEST timestamp anywhere in its body (its own clinical times, and meta.recordedAt,
 * which every canonical record carries) is before the window starts. A record with no timestamp at all
 * is never judged behind, so an unrecognised shape widens the read rather than losing a record.
 *
 * WHY SOME TYPES ARE STILL READ WHOLE. A record can matter to a month it has no timestamp in:
 *   - a stay admitted in March and still open in September (bed-days, census, every denominator);
 *   - a central line inserted before the month and still in place (device-days);
 *   - a booking or a request made long before the date it is for;
 *   - a master record other records point at - the Patient whose age band a count needs.
 * Those types are in SPANNING_TYPES and are read whole, exactly as before. The win is the volume
 * types, which is where the failure was.
 *
 * ponytail: the per-page whole-type GROUP BY in repository-d1.js is UNCHANGED by this - the seq window
 * sits outside the derived table. This removes pages, rows, parsed bodies and isolate memory, which is
 * what was actually killing the screens; it does not remove the scan. That needs a latest-version flag
 * or table in the schema (audit O20), which is the owner's decision.
 */

/** Days of slack before the caller's window. A record dated just before a window can still belong to
 *  something inside it (a pre-anaesthetic check before the operation, the request behind a report, the
 *  previous visit a readmission is measured from). Cheap: it is days against months. */
const LOOKBACK_MS = 90 * 86400000;

/* Read whole, never period-scoped. The reason each one is here is in the header; keep them together. */
const SPANNING_TYPES = new Set([
  // Master and reference data: pointed at by records of any period.
  "Patient", "Practitioner", "Location", "Bed", "Ward", "Department", "Organization", "Coverage", "Device",
  // Episodes and intents that stay live long after the write that created them.
  "Encounter", "Appointment", "ServiceRequest", "MedicationOrder", "CarePlan", "LineRecord", "SurgicalCase",
  "Condition", "AllergyIntolerance",
]);

/** PURE. Whether a type may be read as a period rather than whole. */
const periodScoped = (resourceType) => !SPANNING_TYPES.has(String(resourceType || ""));

const DATEISH = /^\d{4}-\d{2}-\d{2}/;

/**
 * PURE. The latest instant named anywhere in a record, in ms, or null when it names none.
 * Shallow on purpose (depth 3, 64 keys a level, as the repository's own bounded() is): a timestamp
 * that decides whether a record belongs to a month is never buried deeper than that, and the cost of
 * this runs once per record read.
 */
function latestStampMs(value, depth) {
  const d = Number(depth) || 0;
  if (value == null || d > 3) return null;
  if (typeof value === "string") {
    if (!DATEISH.test(value)) return null;
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }
  if (typeof value !== "object") return null;
  let best = null;
  for (const k of Object.keys(value).slice(0, 64)) {   // an array's keys are its indices
    const t = latestStampMs(value[k], d + 1);
    if (t != null && (best == null || t > best)) best = t;
  }
  return best;
}

/** PURE. The stop test service.listSince takes: true when nothing in this record reaches `sinceMs`. */
function outsideWindow(record, sinceMs) {
  if (!Number.isFinite(sinceMs)) return false;
  const t = latestStampMs(record, 0);
  return t != null && t < sinceMs;
}

/**
 * The read a period report should do: `{ rows, truncated }`, oldest first, exactly listAll's answer.
 * A spanning type (or a caller with no window) still reads whole, so this is a drop-in for listAll.
 *
 * `truncated` keeps its meaning - the figures are incomplete and must be shown as such - but note what
 * was dropped differs: listAll keeps the OLDEST max records, listSince keeps the NEWEST, so a truncated
 * period read has lost the start of its window, not its end.
 */
async function readWindowed(svc, resourceType, opts) {
  const o = opts || {};
  const since = Number(o.sinceMs);
  const pass = { ...(o.max ? { max: o.max } : {}), ...(o.throwOnTruncate ? { throwOnTruncate: true } : {}) };
  if (!Number.isFinite(since) || !periodScoped(resourceType) || typeof svc.listSince !== "function") {
    return svc.listAll(resourceType, pass);
  }
  const from = since - LOOKBACK_MS;
  return svc.listSince(resourceType, { ...pass, stopWhen: (r) => outsideWindow(r, from) });
}

/* ---------------------------------------------------------------------------------------------
 * THE CLASH WINDOW (R6-4). A booking clash check is the other read that took the hospital's whole
 * diary: scheduling.js bookAppointment and online-booking.js diary() both read every Appointment ever
 * made (listAll, 50,000 ceiling) because an Appointment keeps where it stands in `state` and the store
 * filters on `status`, so the open-state read (R5-2) could not be used.
 *
 * A `states` filter in the port is NOT what was built. A clash is by definition time-bounded - two
 * appointments can only collide if they are near each other in time - so the period read R5-3 already
 * built answers it with no port change, no schema change and no new filter on three adapters. That is
 * why the two files now call readClashDiary instead of listAll.
 *
 * WHY THE STOP TEST LOOKS AT TWO THINGS. The read pages by write order (seq); the window is on startAt.
 * A booking made long ago FOR a date inside the window has an old seq, so stopping on startAt alone
 * could walk past it and book over it. A record is behind the window only when BOTH hold: its slot is
 * older than the window floor AND it was last written longer ago than the longest lead a booking is
 * made with (WRITE_LOOKBACK_MS). An appointment booked further ahead than that and never touched since
 * is the stated residual; at 400 days it is outside any real outpatient diary. A record with no
 * readable slot time is never judged behind, as everywhere else in this file.
 */

/** The longest appointment bookAppointment permits (480 minutes) plus a week of margin. */
const CLASH_LOOKBACK_MS = 480 * 60000 + 7 * 86400000;
/** The longest lead a booking is assumed to be made with: the bound that makes a seq-paged read safe
 *  for a startAt window. See the note above. */
const WRITE_LOOKBACK_MS = 400 * 86400000;

/** PURE. Is this appointment behind the clash window, by its slot AND by when it was last written? */
function outsideClashWindow(record, floorMs, writtenBeforeMs) {
  const start = Date.parse((record && record.startAt) || "");
  if (!Number.isFinite(start)) return false;
  if (start >= floorMs) return false;
  const wrote = latestStampMs(record, 0);
  return wrote != null && wrote < writtenBeforeMs;
}

/**
 * The diary a clash check needs: every appointment that could overlap a slot at or after `fromMs`,
 * oldest first, exactly listAll's `{ rows, truncated }`. Falls back to listAll on a store that cannot
 * page backwards, so no adapter has to change.
 */
async function readClashDiary(svc, resourceType, opts) {
  const o = opts || {};
  const from = Number(o.fromMs);
  const pass = { ...(o.max ? { max: o.max } : {}), ...(o.throwOnTruncate ? { throwOnTruncate: true } : {}) };
  if (!Number.isFinite(from) || typeof svc.listSince !== "function") return svc.listAll(resourceType, pass);
  const floor = from - CLASH_LOOKBACK_MS;
  const writtenBefore = Date.now() - WRITE_LOOKBACK_MS;
  return svc.listSince(resourceType, { ...pass, stopWhen: (r) => outsideClashWindow(r, floor, writtenBefore) });
}

/**
 * THE AMENDMENT RE-READ. pageByType's newest-first cursor can miss a record amended DURING the read:
 * the amendment moves it past a cursor already handed out (repository.js:302-306). For a month report
 * that is the documented price; for a clash check it would be a double booking, so it is not accepted
 * here. An amendment lands at the very top of the write order, so ONE page of the newest records taken
 * after the decision and before the append holds every record that could have moved. The caller runs
 * the same overlap test over it and refuses if a slot appeared.
 *
 * Bounded by construction: stopWhen answers true for every record, so listSince returns after one page.
 * ponytail: that page is 1,000 records - more than 1,000 writes landing inside one clash read would
 * push an amendment off it. A per-clinician index (ids are wsq-appt-<clinician>-<time>-<patient>, so
 * pageByIdPrefix is a range seek) is the upgrade if a hospital ever writes at that rate.
 */
async function readRecentWrites(svc, resourceType) {
  if (typeof svc.listSince !== "function") return [];
  const got = await svc.listSince(resourceType, { stopWhen: () => true });
  return got.rows || [];
}

export {
  LOOKBACK_MS, SPANNING_TYPES, periodScoped, latestStampMs, outsideWindow, readWindowed,
  CLASH_LOOKBACK_MS, WRITE_LOOKBACK_MS, outsideClashWindow, readClashDiary, readRecentWrites,
};
