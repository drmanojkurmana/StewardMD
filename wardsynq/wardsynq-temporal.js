/* wardsynq/wardsynq-temporal.js: WardSynQ P0 bi-temporal query engine.
 *
 * Clinical and legal point of this module:
 * In acute care, what the clinical team believed at 3pm yesterday and what was actually true
 * at 3pm yesterday are often different questions. A patient's serum potassium drawn at 14:00
 * might be reported as normal (4.0 mEq/L) at 15:00, acted upon at 16:00, and retroactively
 * corrected to critical hyperkalemia (6.5 mEq/L) at 17:00 after analyzer recalibration.
 * A medico-legal audit must answer both:
 *   1. Did the on-duty clinician adhere to the standard of care based on what was known at 16:00?
 *   2. What was the patient's actual physiology at 14:00 according to our best current knowledge?
 *
 * This file implements the bi-temporal query engine over append-only version arrays:
 *   - recordedAt (T_recorded / system time): when WardSynQ learned the fact.
 *   - effectiveAt (T_effective / valid time): when the fact became clinically true in the patient.
 *   - amendedAt: when a correction superseded a prior version.
 *
 * This module is deliberately a pure function library. It performs no I/O, does not import
 * the store or event bus, and never mutates its inputs. All timestamps are ISO 8601 strings
 * compared via Date.parse.
 *
 * node --test test/wardsynq-temporal.test.mjs
 */

/**
 * Safely parses an ISO date string, Date object, or numeric timestamp into milliseconds since epoch.
 * Returns 0 if invalid or omitted.
 * @param {string | number | Date | null | undefined} val
 * @returns {number}
 */
function parseTimestamp(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === "number") return val;
  if (val instanceof Date) return val.getTime();
  if (typeof val === "string") {
    const ms = Date.parse(val);
    return Number.isNaN(ms) ? 0 : ms;
  }
  return 0;
}

/**
 * Extracts recordedAt timestamp from a version envelope or top-level field.
 * @param {any} v
 * @returns {string | null}
 */
function getRecordedAt(v) {
  if (!v || typeof v !== "object") return null;
  return v.meta?.recordedAt ?? v.recordedAt ?? null;
}

/**
 * Extracts effectiveAt timestamp from a version envelope or top-level field.
 * Falls back to recordedAt when effectiveAt is not explicitly provided.
 * @param {any} v
 * @returns {string | null}
 */
function getEffectiveAt(v) {
  if (!v || typeof v !== "object") return null;
  return v.meta?.effectiveAt ?? v.effectiveAt ?? getRecordedAt(v);
}

/**
 * Extracts amendedAt timestamp from a version envelope or top-level field.
 * @param {any} v
 * @returns {string | null}
 */
function getAmendedAt(v) {
  if (!v || typeof v !== "object") return null;
  return v.meta?.amendedAt ?? v.amendedAt ?? null;
}

/**
 * Deep clones a value using structuredClone or JSON serialization to preserve pure immutability.
 * @param {any} value
 * @returns {any}
 */
function deepClone(value) {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

/**
 * Checks value equality for diff calculations and interval merging.
 * Objects and arrays are compared via serialized representation to detect field-level changes.
 * @param {any} a
 * @param {any} b
 * @returns {boolean}
 */
function isEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    return false;
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Determines whether two version references represent the exact same version record.
 * @param {any} a
 * @param {any} b
 * @returns {boolean}
 */
function isIdenticalVersion(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.id && b.id && a.id === b.id) {
    if (typeof a.version === "number" && typeof b.version === "number") {
      return a.version === b.version;
    }
  }
  const recA = getRecordedAt(a);
  const recB = getRecordedAt(b);
  const effA = getEffectiveAt(a);
  const effB = getEffectiveAt(b);
  return recA === recB && effA === effB && a.id === b.id;
}

/**
 * Determines whether two versions hold the same version or identical clinical content.
 * Used to merge contiguous timeline intervals that carry the same state.
 * @param {any} a
 * @param {any} b
 * @returns {boolean}
 */
function isSameVersionOrContent(a, b) {
  if (isIdenticalVersion(a, b)) return true;
  return diff(a, b).length === 0;
}

/**
 * Sorts versions into canonical chronological recording order without mutating the input array.
 * Tie-breaks identical recordedAt timestamps by effectiveAt, then store version number.
 * @param {Array<any>} versions
 * @returns {Array<any>}
 */
function sortVersionsChronologically(versions) {
  return [...versions].sort((a, b) => {
    const recA = parseTimestamp(getRecordedAt(a));
    const recB = parseTimestamp(getRecordedAt(b));
    if (recA !== recB) return recA - recB;

    const effA = parseTimestamp(getEffectiveAt(a));
    const effB = parseTimestamp(getEffectiveAt(b));
    if (effA !== effB) return effA - effB;

    const verA = typeof a.version === "number" ? a.version : 0;
    const verB = typeof b.version === "number" ? b.version : 0;
    return verA - verB;
  });
}

/**
 * Checks whether an object property should be excluded from clinical diffs.
 * Skips the provenance metadata envelope, store version counter, and internal underscored fields.
 * @param {string} field
 * @returns {boolean}
 */
function isSkippedField(field) {
  return (
    field === "meta" ||
    field === "version" ||
    field.startsWith("_") ||
    field.startsWith("$")
  );
}

/**
 * (1) asOf(versions, opts):
 * Returns the version that was the current belief at knownAt about the state effective at effectiveAt.
 *
 * Algorithm:
 * Filter to recordedAt <= knownAt (what the system had learned by that transaction instant),
 * then select the candidate with the greatest effectiveAt <= query effectiveAt (most recent
 * clinical truth known at that time), tie-broken by greatest recordedAt (latest correction),
 * tie-broken by greatest version number.
 *
 * Either axis omitted defaults to now. Returns null if no version qualifies.
 *
 * @param {Array<any>} versions - Collection of version records
 * @param {{knownAt?: string | number | Date, effectiveAt?: string | number | Date}} [opts]
 * @returns {any | null}
 */
export function asOf(versions, opts) {
  if (!Array.isArray(versions) || versions.length === 0) {
    return null;
  }

  // Support passing a single string or Date instant directly for flexibility
  const options =
    typeof opts === "string" || opts instanceof Date
      ? { knownAt: opts, effectiveAt: opts }
      : opts || {};

  const now = Date.now();
  const knownAtMs =
    options.knownAt !== undefined && options.knownAt !== null
      ? parseTimestamp(options.knownAt)
      : now;
  const effectiveAtMs =
    options.effectiveAt !== undefined && options.effectiveAt !== null
      ? parseTimestamp(options.effectiveAt)
      : now;

  let best = null;
  let bestEffectiveMs = -Infinity;
  let bestRecordedMs = -Infinity;
  let bestVersionNum = -Infinity;

  for (const v of versions) {
    if (!v || typeof v !== "object") continue;

    const recordedAtMs = parseTimestamp(getRecordedAt(v));

    // Must be known to the system by knownAt
    if (recordedAtMs > knownAtMs) {
      continue;
    }

    const effectiveAtMsCandidate = parseTimestamp(getEffectiveAt(v));

    // Must have taken effect clinically on or before query effectiveAt
    if (effectiveAtMsCandidate > effectiveAtMs) {
      continue;
    }

    const versionNum = typeof v.version === "number" ? v.version : 0;

    // Greatest effectiveAt <= effectiveAt, tie-broken by greatest recordedAt,
    // then tie-broken by version number
    if (
      effectiveAtMsCandidate > bestEffectiveMs ||
      (effectiveAtMsCandidate === bestEffectiveMs && recordedAtMs > bestRecordedMs) ||
      (effectiveAtMsCandidate === bestEffectiveMs &&
        recordedAtMs === bestRecordedMs &&
        versionNum > bestVersionNum)
    ) {
      best = v;
      bestEffectiveMs = effectiveAtMsCandidate;
      bestRecordedMs = recordedAtMs;
      bestVersionNum = versionNum;
    }
  }

  return best;
}

/**
 * (2) historyOf(versions, opts):
 * Returns all versions in chronological recorded order. Each version is flagged with whether
 * it was ever the current clinical belief or was superseded before it took effect.
 *
 * A version is superseded before it took effect if its effectiveAt was in the future relative
 * to its recordedAt and another version superseded it before or at that effectiveAt time.
 *
 * @param {Array<any>} versions - Collection of version records
 * @param {{order?: "asc" | "desc", knownAt?: string | number | Date}} [opts]
 * @returns {Array<any>}
 */
export function historyOf(versions, opts) {
  if (!Array.isArray(versions) || versions.length === 0) {
    return [];
  }

  const options = opts || {};
  let sorted = sortVersionsChronologically(versions);

  // Optional filtering by knownAt if caller queries historical state of the log
  if (options.knownAt !== undefined && options.knownAt !== null) {
    const cutoff = parseTimestamp(options.knownAt);
    sorted = sorted.filter((v) => parseTimestamp(getRecordedAt(v)) <= cutoff);
  }

  const results = [];

  for (const v of sorted) {
    const recTime = parseTimestamp(getRecordedAt(v));
    const effTime = parseTimestamp(getEffectiveAt(v));

    let supersededBeforeEffective = false;
    let wasCurrentBelief = false;

    if (effTime > recTime) {
      // Future-scheduled version: check if by the time it took effect, another version took precedence
      const beliefAtEffectiveTime = asOf(sorted, {
        knownAt: getEffectiveAt(v),
        effectiveAt: getEffectiveAt(v),
      });
      if (beliefAtEffectiveTime && isIdenticalVersion(beliefAtEffectiveTime, v)) {
        wasCurrentBelief = true;
        supersededBeforeEffective = false;
      } else {
        wasCurrentBelief = false;
        supersededBeforeEffective = true;
      }
    } else {
      // Retroactive or immediate version: took effect at the moment it was recorded
      const beliefAtRecordTime = asOf(sorted, {
        knownAt: getRecordedAt(v),
        effectiveAt: getEffectiveAt(v),
      });
      if (beliefAtRecordTime && isIdenticalVersion(beliefAtRecordTime, v)) {
        wasCurrentBelief = true;
        supersededBeforeEffective = false;
      } else {
        wasCurrentBelief = false;
        supersededBeforeEffective = true;
      }
    }

    // Is this version still the active belief right now?
    const latestBelief = asOf(sorted, {
      knownAt: null,
      effectiveAt: getEffectiveAt(v),
    });
    const isCurrentBelief =
      latestBelief !== null && isIdenticalVersion(latestBelief, v);

    // One name per concept. Earlier drafts of this file also emitted `everCurrentBelief` and
    // `supersededBeforeTakingEffect` as literal aliases of the two below; they were removed because
    // two names for one flag doubles the surface a consumer has to reason about and creates a pair
    // that must be kept in sync forever.
    results.push({
      ...deepClone(v),
      wasCurrentBelief, // was this version the live belief at any point
      isCurrentBelief, // is it the live belief now
      supersededBeforeEffective, // corrected away before it ever took effect
    });
  }

  if (options.order === "desc") {
    results.reverse();
  }

  return results;
}

/**
 * (3) timeline(versions):
 * Returns a list of intervals with {from, to, version} over effective time according to the latest
 * belief, with adjacent intervals holding the same version merged into a single continuous span.
 *
 * The earliest interval begins at the first effective timestamp, and the final ongoing interval
 * has to = null.
 *
 * @param {Array<any>} versions - Collection of version records
 * @returns {Array<{from: string, to: string | null, version: any}>}
 */
export function timeline(versions) {
  if (!Array.isArray(versions) || versions.length === 0) {
    return [];
  }

  // Collect all distinct effective timestamps
  const timestampSet = new Set();
  for (const v of versions) {
    const eff = getEffectiveAt(v);
    if (eff) timestampSet.add(eff);
  }

  if (timestampSet.size === 0) {
    return [];
  }

  // Sort timestamps chronologically
  const sortedTimestamps = Array.from(timestampSet).sort(
    (a, b) => parseTimestamp(a) - parseTimestamp(b)
  );

  const rawIntervals = [];

  for (let i = 0; i < sortedTimestamps.length; i++) {
    const fromTime = sortedTimestamps[i];
    const toTime =
      i + 1 < sortedTimestamps.length ? sortedTimestamps[i + 1] : null;

    // Latest belief for state effective at fromTime
    const activeVersion = asOf(versions, {
      knownAt: null,
      effectiveAt: fromTime,
    });

    if (activeVersion !== null) {
      rawIntervals.push({
        from: fromTime,
        to: toTime,
        version: deepClone(activeVersion),
      });
    }
  }

  // Merge adjacent intervals holding the same version
  const merged = [];
  for (const interval of rawIntervals) {
    if (merged.length === 0) {
      merged.push({ ...interval });
      continue;
    }

    const previous = merged[merged.length - 1];
    if (isSameVersionOrContent(previous.version, interval.version)) {
      // Extend the previous interval to cover this contiguous segment
      previous.to = interval.to;
    } else {
      merged.push({ ...interval });
    }
  }

  return merged;
}

/**
 * (4) corrections(versions):
 * Identifies amendments (records with amendedAt set, or a later version whose effectiveAt is
 * earlier than or equal to an already recorded version), each paired with what it superseded.
 *
 * Essential for medical chart audits to trace who changed what, when, and what prior state was replaced.
 *
 * @param {Array<any>} versions - Collection of version records
 * @returns {Array<{correction: any, amendment: any, superseded: any | null, diff: Array<any>}>}
 */
export function corrections(versions) {
  if (!Array.isArray(versions) || versions.length === 0) {
    return [];
  }

  // Process in chronological recorded order
  const sorted = sortVersionsChronologically(versions);
  const auditEntries = [];

  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i];
    const currentRecordedMs = parseTimestamp(getRecordedAt(current));
    const currentEffectiveMs = parseTimestamp(getEffectiveAt(current));
    const amendedAtVal = getAmendedAt(current);

    const hasExplicitAmendedAt =
      amendedAtVal !== null && amendedAtVal !== undefined && amendedAtVal !== "";

    // Check if effectiveAt is earlier than or equal to an already recorded version
    let isRetroactiveOrRevision = false;
    for (let j = 0; j < i; j++) {
      const priorEffectiveMs = parseTimestamp(getEffectiveAt(sorted[j]));
      if (currentEffectiveMs <= priorEffectiveMs) {
        isRetroactiveOrRevision = true;
        break;
      }
    }

    if (hasExplicitAmendedAt || isRetroactiveOrRevision) {
      // Find what this correction superseded prior to current recordedAt
      const priorVersions = sorted.slice(0, i);
      let superseded = null;

      if (priorVersions.length > 0) {
        // Query the state that was believed for this effective time just before this write
        const priorLastRecordTime = getRecordedAt(
          priorVersions[priorVersions.length - 1]
        );
        superseded = asOf(priorVersions, {
          knownAt: priorLastRecordTime,
          effectiveAt: getEffectiveAt(current),
        });

        // If no version was effective at or before that instant, fall back to the previous recorded version
        if (!superseded) {
          superseded = priorVersions[priorVersions.length - 1];
        }
      }

      auditEntries.push({
        correction: deepClone(current),
        amendment: deepClone(current),
        superseded: superseded ? deepClone(superseded) : null,
        diff: superseded ? diff(superseded, current) : [],
      });
    }
  }

  return auditEntries;
}

/**
 * (5) diff(a, b):
 * Shallow field-level diff between two versions, returning entries with {field, from, to}.
 * Skips provenance envelope (meta) and storage/internal fields.
 *
 * @param {any} a - Baseline version
 * @param {any} b - Target version
 * @param {{isSkipped?: (field: string) => boolean}} [opts]
 * @returns {Array<{field: string, from: any, to: any}>}
 */
export function diff(a, b, opts) {
  if (!a && !b) return [];

  const objA = a && typeof a === "object" ? a : {};
  const objB = b && typeof b === "object" ? b : {};

  const skipFn =
    typeof opts?.isSkipped === "function" ? opts.isSkipped : isSkippedField;

  const allKeys = new Set([...Object.keys(objA), ...Object.keys(objB)]);
  const entries = [];

  for (const key of allKeys) {
    if (skipFn(key)) continue;

    const fromVal = objA[key];
    const toVal = objB[key];

    if (!isEqual(fromVal, toVal)) {
      entries.push({
        field: key,
        from: fromVal,
        to: toVal,
      });
    }
  }

  // Sort by field name for deterministic order
  entries.sort((x, y) => x.field.localeCompare(y.field));
  return entries;
}

/**
 * (6) reconstructAt(versions, instant):
 * Point-in-time state reconstruction where both belief time (knownAt) and clinical time
 * (effectiveAt) are evaluated at the exact same instant.
 *
 * @param {Array<any>} versions - Collection of version records
 * @param {string | number | Date} [instant] - Instant to reconstruct at; defaults to now
 * @returns {any | null}
 */
export function reconstructAt(versions, instant) {
  const target = instant || new Date().toISOString();
  return asOf(versions, { knownAt: target, effectiveAt: target });
}
