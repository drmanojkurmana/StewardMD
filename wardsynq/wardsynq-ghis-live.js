/* wardsynq/wardsynq-ghis-live.js — the cut-over. GHIS becomes a real adapter on the live path.
 *
 * The owner's architecture, stated at the start of this project: the existing Ward Sync connector
 * becomes WardSynQ's first hospital-data adapter, feeding the canonical model, the Clinical Event
 * Bus, and everything downstream of them. This is that, on the live path, no longer a shadow.
 *
 * WHAT IT DOES NOT DO, AND WHY THAT IS THE DESIGN. It does not rewrite `ingestFromWard`. That
 * function guards cross-patient contamination, preserves manual overrides against ward values, and
 * writes a STATE object read at more than twenty sites in icu.js alone. Replacing it in one step
 * would put a live mobile app behind a code path that has never rendered a ward round, in exchange
 * for tidiness. So the legacy path keeps owning STATE and the mobile UI, byte for byte, and the
 * adapter takes ownership of the CANONICAL MODEL alongside it.
 *
 * That is a strangler fig rather than a rewrite, and it is the honest shape of this migration: two
 * consumers of one bundle, the new one authoritative for everything built after it, the old one
 * authoritative for the screens that already exist, and each screen migrated when somebody has
 * looked at it. The duplication is real and is the price of not breaking a working ward round.
 *
 *   1. LEGACY RUNS FIRST AND ITS RESULT IS RETURNED UNTOUCHED. Whatever happens here, the mobile
 *      app receives exactly what it received before this file existed.
 *   2. THIS CAN NEVER THROW INTO THE CALLER. Every failure is caught, counted, and surfaced on a
 *      diagnostics object. A defect in the adapter must show up as a number somebody reads, never
 *      as a ward round that stopped working.
 *   3. IT WRITES THROUGH THE GOVERNED STORE AS AN ADAPTER ACTOR. Which means, by the existing actor
 *      model and not by anything written here, that it is capped at DRAFT: a feed cannot commit an
 *      active clinical record however confidently the source system asserts one.
 *   4. IT IS IDEMPOTENT ON THE SOURCE'S OWN EVENT IDENTITY. A reconnect, a catch-up window or a
 *      double-tap re-syncs without producing a second copy of a patient's potassium.
 *   5. THERE IS A KILL SWITCH THAT WORKS WITHOUT A RELOAD. A cut-over you cannot stop from the
 *      device in your hand is not a cut-over anybody should agree to.
 *   6. DIVERGENCE IS STILL RECORDED. The shadow existed to compare the two paths; that comparison
 *      does not stop being useful the moment the adapter goes live, it becomes the ongoing evidence
 *      that it is still right.
 *
 * WHAT "APPROVED" MEANS HERE. The owner has approved the CUT-OVER: routing ward data through the
 * adapter. That is an architectural decision they own. It is NOT clinical approval of the rule
 * packs, which remain UNAPPROVED seed content awaiting pharmacy and the relevant committees, and
 * nothing in this file changes that or should be read as changing it.
 *
 * STATUS: IMPLEMENTED and TESTED. Enabled by smd_wardsynq_cutover.
 *
 * node --test test/wardsynq-ghis-live.test.mjs
 */

import { mapGhisBundle } from "./adapters/wardsynq-ghis-adapter.js";

/** What the cut-over is doing right now, so a diagnostics screen can say it in one word. */
const MODE = Object.freeze({
  OFF: "off",             // not installed
  LIVE: "live",           // adapter output is being written to the canonical model
  HALTED: "halted",       // the kill switch was pulled; legacy continues untouched
});

class CutoverError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "CutoverError";
    this.code = code || "CUTOVER_VIOLATION";
  }
}

/**
 * Installs the live adapter path onto the host's ingest function.
 *
 * @param {{host?: object, flags?: object, store?: object, bus?: object, actor?: object,
 *   now?: () => string, onError?: Function}} deps
 *   `store` should be a GovernedStore session or anything with put(). If absent, mapping still runs
 *   and is counted, which is useful for a dry run and is NOT silently treated as success.
 */
function installLiveGhis(deps) {
  deps = deps || {};
  const host = deps.host || (typeof window !== "undefined" ? window.ICU : null);
  const flags = deps.flags || (typeof window !== "undefined" ? window.SMD_WARDSYNQ_FLAGS : null);
  const now = deps.now || (() => new Date().toISOString());

  const on = flags && typeof flags.get === "function" ? flags.get("smd_wardsynq_cutover") : false;
  if (!on) return { installed: false, mode: MODE.OFF, reason: "flag off", uninstall: () => {}, halt: () => {}, report: () => null };
  if (!host || typeof host.ingestFromWard !== "function") {
    return { installed: false, mode: MODE.OFF, reason: "no ingestFromWard to wrap", uninstall: () => {}, halt: () => {}, report: () => null };
  }

  const stats = {
    installedAt: now(),
    bundlesSeen: 0, mapped: 0, written: 0, skippedDuplicate: 0,
    adapterErrors: 0, writeErrors: 0,
    observationsMapped: 0, issues: [], divergences: [], lastAt: null,
  };

  // Source-event identity, so a reconnect replays without duplicating. Bounded, because an
  // unbounded set on a device that stays open for a twelve-hour shift is a leak.
  const seen = new Set();
  const SEEN_MAX = 5000;

  let halted = false;
  const original = host.ingestFromWard;

  host.ingestFromWard = function wardSynQLive(bundle) {
    /* 1. The legacy path runs FIRST, and this is what the caller gets. Not "usually", not "unless
          the adapter throws": always, and before anything below has run. */
    const legacyResult = original.apply(this, arguments);

    if (halted) return legacyResult;

    /* 2. Everything from here is wrapped. A defect must be a number on a report, never a broken
          ward round. */
    try {
      stats.bundlesSeen += 1;
      stats.lastAt = now();

      const mapped = mapGhisBundle(bundle);
      stats.mapped += 1;
      if (mapped.issues && mapped.issues.length) {
        // Kept rather than counted, because "14 issues" tells nobody which test stopped mapping.
        for (const issue of mapped.issues) stats.issues.push({ at: stats.lastAt, ...issue });
      }

      const entities = [
        ...(mapped.patient ? [mapped.patient] : []),
        ...(mapped.encounter ? [mapped.encounter] : []),
        ...(mapped.observations || []),
        ...(mapped.reports || []),
      ];
      stats.observationsMapped += (mapped.observations || []).length;

      /* 3. Divergence against the legacy result, which is the ongoing evidence that the adapter is
            still right. The shadow's comparison does not stop being useful when it goes live. */
      const legacyRows = countLegacyRows(legacyResult);
      const canonicalRows = (mapped.observations || []).length;
      if (legacyRows !== null && legacyRows !== canonicalRows) {
        stats.divergences.push({
          at: stats.lastAt, legacyRows, canonicalRows,
          note: "the two paths produced different row counts for one bundle. Not necessarily a defect: the legacy path drops values it has no key for and the adapter keeps them with an issue. Worth reading, not worth alarming.",
        });
      }

      if (!deps.store) {
        // Explicitly NOT counted as written. A dry run that reports success is a dry run that gets
        // mistaken for a live one.
        return legacyResult;
      }

      for (const entity of entities) {
        if (!entity || !entity.id) continue;
        if (seen.has(entity.id)) { stats.skippedDuplicate += 1; continue; }

        try {
          // Through the governed store as an adapter actor. The actor model caps an adapter at
          // DRAFT, so a feed cannot commit an active record however confidently GHIS asserts one.
          // That cap is enforced there and is not re-implemented here.
          const result = deps.store.put(entity);
          if (result && typeof result.then === "function") {
            result.then(
              () => { stats.written += 1; },
              (err) => { stats.writeErrors += 1; recordError(stats, deps, err, entity); },
            );
          } else {
            stats.written += 1;
          }
          if (seen.size >= SEEN_MAX) seen.clear();   // bounded: a long shift must not leak
          seen.add(entity.id);
        } catch (err) {
          stats.writeErrors += 1;
          recordError(stats, deps, err, entity);
        }
      }

      if (deps.bus && typeof deps.bus.emit === "function") {
        // Emitted with the bundle's own identity so a redelivery is a no-op on the bus too.
        const id = bundleIdentity(bundle);
        Promise.resolve(deps.bus.emit("interop.ingested", { system: "GHIS", count: entities.length }, id ? { id } : undefined))
          .catch(() => { /* the bus having a bad day must not reach the ward */ });
      }
    } catch (err) {
      stats.adapterErrors += 1;
      recordError(stats, deps, err, null);
    }

    return legacyResult;
  };

  return {
    installed: true,
    mode: MODE.LIVE,
    /** Stops the adapter path immediately, in-process, with no reload. Legacy continues untouched. */
    halt(reason) {
      halted = true;
      stats.haltedAt = now();
      stats.haltReason = reason || "halted by operator";
      return { mode: MODE.HALTED, at: stats.haltedAt, reason: stats.haltReason };
    },
    resume() { halted = false; stats.haltedAt = null; stats.haltReason = null; return { mode: MODE.LIVE }; },
    /** Removes the wrapper entirely, restoring the original function. */
    uninstall() { host.ingestFromWard = original; return { mode: MODE.OFF }; },
    report() {
      return {
        ...stats,
        mode: halted ? MODE.HALTED : MODE.LIVE,
        // The single sentence somebody should read first.
        reading: halted
          ? `HALTED at ${stats.haltedAt}: ${stats.haltReason}. The legacy path is unaffected and the ward is working normally.`
          : stats.adapterErrors || stats.writeErrors
            ? `${stats.adapterErrors} adapter errors and ${stats.writeErrors} write errors across ${stats.bundlesSeen} bundles. The mobile app is unaffected by all of them, because the legacy result is returned before any of this runs.`
            : `${stats.written} canonical records written from ${stats.bundlesSeen} bundles, ${stats.skippedDuplicate} duplicates skipped.`,
        clinicalNote: "The cut-over is an architectural change approved by the owner. It is NOT clinical approval: the interaction, allergy, dose and threshold packs remain UNAPPROVED seed content.",
      };
    },
  };
}

/** Errors are kept with their context, and never rethrown. */
function recordError(stats, deps, err, entity) {
  const record = {
    at: new Date().toISOString(),
    message: String((err && err.message) || err),
    entity: entity ? `${entity.resourceType}/${entity.id}` : null,
  };
  stats.lastError = record;
  if (deps.onError) { try { deps.onError(record); } catch { /* an error handler that throws is not one */ } }
}

/** How many rows the legacy path reported applying, where it says. */
function countLegacyRows(legacyResult) {
  if (!legacyResult || typeof legacyResult !== "object") return null;
  if (legacyResult.applied && typeof legacyResult.applied === "object") return Object.keys(legacyResult.applied).length;
  return null;
}

/** A stable identity for one bundle, so a redelivery is recognised rather than reprocessed. */
function bundleIdentity(bundle) {
  if (!bundle) return null;
  if (bundle.eventId) return String(bundle.eventId);
  const pid = bundle.patientId ?? bundle.patient?.patientId ?? "";
  const ts = bundle.ts ?? "";
  return pid && ts ? `ghis:${pid}:${ts}` : null;
}

export { MODE, CutoverError, installLiveGhis, bundleIdentity, countLegacyRows };
