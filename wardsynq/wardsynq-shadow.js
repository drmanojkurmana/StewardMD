/* wardsynq/wardsynq-shadow.js — observe GHIS ingest through WardSynQ, changing nothing.
 *
 * The first step of the Ward Sync cut-over, and deliberately the smallest one that produces
 * evidence. `ingestFromWard` in icu.js is read through by the ICU flowsheet, medlist and autofetch,
 * and `STATE.wardSync` is read directly at 22 sites in icu.js alone. Rewiring that in a single step
 * would put a live mobile app behind an adapter that has never seen a real GHIS bundle.
 *
 * So this observes instead. With the flag on, a bundle that has ALREADY been ingested by the legacy
 * path is additionally passed through the WardSynQ adapter, and the two results are compared and
 * logged. Nothing is written to any chart.
 *
 * THREE PROPERTIES THAT MAKE THIS SAFE, in order of how much they matter:
 *
 *  1. icu.js IS NOT MODIFIED. The wrapper is installed from outside onto the exported function.
 *     Not loading this file removes the change completely; there is no edit to revert.
 *  2. THE LEGACY RESULT IS RETURNED UNTOUCHED, and is computed FIRST. The shadow runs afterwards
 *     and its return value is discarded.
 *  3. THE SHADOW CANNOT THROW INTO THE CALLER. Every failure is caught and counted. A defect in the
 *     adapter shows up as a number on a diagnostics object, never as a broken ward round.
 *
 * What it is for: comparing what the adapter produces against what the legacy path produced, on real
 * ward data, before anyone considers routing through it. `SMD_WARDSYNQ_SHADOW.report()` is the
 * output, and disagreements are the interesting part.
 *
 * STATUS: IMPLEMENTED and TESTED. Observation only. The cut-over itself is NOT built.
 *
 * node --test test/wardsynq-shadow.test.mjs
 */

import { mapGhisBundle } from "./adapters/wardsynq-ghis-adapter.js";

/**
 * Installs the observer.
 *
 * @param {{host?: object, flags?: object, method?: string, onObservation?: Function, logger?: object}} deps
 *   host    the object carrying the ingest function, normally window.ICU
 *   method  WHICH function on that host to observe. Defaults to "ingestFromWard".
 *
 * WHY `method` EXISTS, recorded because the omission cost a device round. This module was written
 * against `ingestFromWard` and its documentation claimed it therefore observed the real GHIS ward
 * sync. It did not. `ghis-ward.js` calls `ICU.ingestWardHistory` when that exists and only falls
 * back to `ingestFromWard` on older builds, so on a current build the observer sat on a door no
 * ward sync walks through, reported `bundlesSeen: 0`, and looked like a quiet success. One entry
 * point is not the ingest surface; the caller decides which door it uses, so the observer has to
 * cover every door the caller might pick.
 *
 * @returns {{installed: boolean, uninstall: Function, report: Function, reason?: string}}
 */
function installShadow(deps) {
  deps = deps || {};
  const host = deps.host || (typeof window !== "undefined" ? window.ICU : null);
  const flags = deps.flags || (typeof window !== "undefined" ? window.SMD_WARDSYNQ_FLAGS : null);
  const logger = deps.logger || null;
  const method = deps.method || "ingestFromWard";

  const on = flags && typeof flags.get === "function" ? flags.get("smd_wardsynq_shadow") : false;
  if (!on) return { installed: false, reason: "flag off", uninstall: () => {}, report: () => null };
  if (!host || typeof host[method] !== "function") {
    return { installed: false, reason: `no ${method} to observe`, uninstall: () => {}, report: () => null };
  }

  const stats = {
    bundlesSeen: 0, mapped: 0, shadowErrors: 0,
    observationsMapped: 0, legacyLabRows: 0,
    issues: [], disagreements: [], lastAt: null,
  };
  const original = host[method];

  host[method] = function wardSynQShadowed(bundle) {
    // 1. The legacy path runs first and its result is what the caller gets, whatever happens next.
    const legacyResult = original.apply(this, arguments);

    // 2. Everything below is observation and is wrapped so it cannot reach the caller.
    try {
      stats.bundlesSeen += 1;
      stats.lastAt = new Date().toISOString();
      const mapped = mapGhisBundle(bundle);
      if (mapped.patient) {
        stats.mapped += 1;
        stats.observationsMapped += mapped.observations.length;
      }
      const legacyRows = ((bundle && bundle.labs) || []).length;
      stats.legacyLabRows += legacyRows;

      // The comparison worth making: did the adapter carry across as many lab rows as the bundle
      // contained? A shortfall means the adapter is dropping something the legacy path kept.
      if (mapped.patient && mapped.observations.length !== legacyRows) {
        stats.disagreements.push({
          at: stats.lastAt,
          patientMrn: mapped.patient.mrn,
          legacyLabRows: legacyRows,
          wardsynqObservations: mapped.observations.length,
          note: "the adapter produced a different number of observations than the bundle had lab rows",
        });
      }
      for (const issue of mapped.issues) {
        stats.issues.push({ at: stats.lastAt, ...issue });
      }
      if (deps.onObservation) deps.onObservation({ bundle, mapped, legacyResult });
      if (logger && mapped.issues.length) logger.log("[wardsynq shadow]", mapped.issues.length, "mapping issues");
    } catch (err) {
      stats.shadowErrors += 1;
      stats.lastError = String((err && err.message) || err);
      if (logger) logger.warn("[wardsynq shadow] observation failed, legacy path unaffected:", stats.lastError);
    }

    return legacyResult;
  };

  const api = {
    installed: true,
    method,
    uninstall() { host[method] = original; return true; },
    report() {
      // `observed` before `clean`, deliberately. An observer that has never been handed a bundle
      // has no errors and no disagreements, so a bare `clean: true` reads as a passing verdict when
      // it is actually an empty one. That is exactly how a shadow wired to the wrong function
      // looked like a success. `clean` now requires having seen something.
      const observed = stats.bundlesSeen > 0;
      return {
        method,
        observed,
        ...stats,
        issues: stats.issues.slice(-50),
        disagreements: stats.disagreements.slice(-50),
        // A shadow that has seen real traffic and never errored or disagreed is a shadow that is
        // ready to become the real path. One that has seen nothing is not evidence of anything.
        clean: observed && stats.shadowErrors === 0 && stats.disagreements.length === 0,
      };
    },
  };
  if (typeof window !== "undefined") window.SMD_WARDSYNQ_SHADOW = api;
  return api;
}

export { installShadow };
