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

export { LOOKBACK_MS, SPANNING_TYPES, periodScoped, latestStampMs, outsideWindow, readWindowed };
