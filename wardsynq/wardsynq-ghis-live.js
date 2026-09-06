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
 *   now?: () => string, onError?: Function, method?: string}} deps
 *   `store` should be a GovernedStore session or anything with put(). If absent, mapping still runs
 *   and is counted, which is useful for a dry run and is NOT silently treated as success.
 *   `method` — WHICH function on the host to wrap. Defaults to "ingestFromWard", unchanged from
 *   before this parameter existed. Added 2026-09-06 for the SAME reason `wardsynq-shadow.js`'s
 *   `installShadow` already takes one: `ghis-ward.js` calls `ICU.ingestWardHistory` when it exists
 *   and falls back to `ingestFromWard` only on older builds, so wrapping `ingestFromWard` alone
 *   would silently wire this to a door a current build's real ward sync never walks through — the
 *   exact defect the shadow observer found on a real device before this file existed. The boot
 *   layer wraps both; this parameter is what lets it.
 */
function installLiveGhis(deps) {
  deps = deps || {};
  const host = deps.host || (typeof window !== "undefined" ? window.ICU : null);
  const flags = deps.flags || (typeof window !== "undefined" ? window.SMD_WARDSYNQ_FLAGS : null);
  const now = deps.now || (() => new Date().toISOString());
  const method = deps.method || "ingestFromWard";

  const on = flags && typeof flags.get === "function" ? flags.get("smd_wardsynq_cutover") : false;
  if (!on) return { installed: false, mode: MODE.OFF, reason: "flag off", uninstall: () => {}, halt: () => {}, report: () => null };
  if (!host || typeof host[method] !== "function") {
    return { installed: false, mode: MODE.OFF, reason: `no ${method} to wrap`, uninstall: () => {}, halt: () => {}, report: () => null };
  }

  const stats = {
    installedAt: now(),
    bundlesSeen: 0, mapped: 0, written: 0, skippedDuplicate: 0,
    adapterErrors: 0, writeErrors: 0,
    observationsMapped: 0, issues: [], divergences: [], failures: [], lastAt: null,
  };

  // Source-event identity, so a reconnect replays without duplicating. Bounded, because an
  // unbounded set on a device that stays open for a twelve-hour shift is a leak.
  const seen = new Set();
  const SEEN_MAX = 5000;

  let halted = false;
  const original = host[method];

  host[method] = function wardSynQLive(bundle) {
    /* 1. The legacy path runs FIRST, and this is what the caller gets. Not "usually", not "unless
          the adapter throws": always, and before anything below has run.

       The adapter work is now awaited internally so writes can be ordered and aborted, but the
       CALLER still receives the legacy result synchronously and is never handed a promise. A ward
       round must not start awaiting something it never awaited before. */
    const legacyResult = original.apply(this, arguments);

    if (halted) return legacyResult;

    // Deliberately not awaited by the caller. Failures inside are caught and counted.
    void runAdapter.call(this, bundle, legacyResult);
    return legacyResult;
  };

  async function runAdapter(bundle, legacyResult) {

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

      /* 4. DEPENDENCY-ORDERED, ABORT ON FIRST FAILURE.
       *
       * `entities` is built patient, then encounter, then everything that references them. Writing
       * in that order and STOPPING at the first failure is what guarantees referential integrity,
       * and it is a stronger guarantee than it looks: a prefix of a dependency-ordered sequence is
       * always referentially complete. A patient with no encounter yet is a valid intermediate
       * state that the next bundle completes; an observation pointing at an encounter that was
       * never written is a corrupt chart.
       *
       * This was NOT the behaviour. The loop used to continue past a failure, so a failed encounter
       * write produced observations carrying an encounterId that resolved to nothing, silently, with
       * only a counter to show for it. The pipeline validation caught it.
       *
       * WHAT THIS DOES NOT CLAIM. It is not a transaction and does not roll back what already
       * landed, because the store is append-only and there is nothing to un-write. The guarantee is
       * REFERENTIAL INTEGRITY, not all-or-nothing, and saying so precisely matters more than
       * claiming the stronger property. Where the store offers a real transaction, it is used
       * instead and the guarantee becomes atomic; see below. */
      const pending = entities.filter((e) => e && e.id && !seen.has(e.id));
      stats.skippedDuplicate += entities.filter((e) => e && e.id && seen.has(e.id)).length;

      if (typeof deps.store.transaction === "function") {
        // A real transaction: all of it or none of it.
        await runAtomic(deps, stats, pending, seen, SEEN_MAX);
      } else {
        for (const entity of pending) {
          try {
            // Through the governed store as an adapter actor. The actor model caps an adapter at
            // DRAFT, so a feed cannot commit an active record however confidently GHIS asserts one.
            // That cap is enforced there and is not re-implemented here.
            await deps.store.put(entity);
            stats.written += 1;
            if (seen.size >= SEEN_MAX) seen.clear();   // bounded: a long shift must not leak
            seen.add(entity.id);
          } catch (err) {
            recordFailure(stats, deps, err, entity, pending.slice(pending.indexOf(entity) + 1));
            break;   // ABORT. Everything after this depends on something that is not there.
          }
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
      recordFailure(stats, deps, err, null, []);
    }
  }

  return {
    installed: true,
    mode: MODE.LIVE,
    method,
    /** Stops the adapter path immediately, in-process, with no reload. Legacy continues untouched. */
    halt(reason) {
      halted = true;
      stats.haltedAt = now();
      stats.haltReason = reason || "halted by operator";
      return { mode: MODE.HALTED, at: stats.haltedAt, reason: stats.haltReason };
    },
    resume() { halted = false; stats.haltedAt = null; stats.haltReason = null; return { mode: MODE.LIVE }; },
    /** Removes the wrapper entirely, restoring the original function. */
    uninstall() { host[method] = original; return { mode: MODE.OFF }; },
    report() {
      return {
        ...stats,
        method,
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

/**
 * Records a failed write in full, and keeps what is needed to try again.
 *
 * This used to keep only `lastError`, which meant that of four failures in one shift somebody could
 * see one. "Visible" and "recoverable" are different requirements and only the first was met: a
 * count tells you something went wrong and gives you nothing to do about it. Every failure is now
 * retained with the entity itself, and with the entities that were ABANDONED behind it, because
 * those were never attempted and are the rest of the work.
 *
 * Bounded, because an unbounded failure log on a device left open for a shift is a leak, and a
 * device that runs out of memory recording failures has found a novel way to fail.
 */
const FAILURES_MAX = 200;

function recordFailure(stats, deps, err, entity, abandoned = []) {
  const record = {
    at: new Date().toISOString(),
    message: String((err && err.message) || err),
    entity: entity ? `${entity.resourceType}/${entity.id}` : null,
    // The record itself, so a retry does not have to re-derive it from a bundle that may be gone.
    payload: entity || null,
    abandoned: abandoned.map((e) => `${e.resourceType}/${e.id}`),
    // A governance refusal will fail again identically; a full disk may not.
    retryable: !/cannot commit|cannot produce|cannot write|not authorised|WRONG_CHART/i.test(String((err && err.message) || err)),
  };
  stats.writeErrors += 1;
  stats.failures.push(record);
  if (stats.failures.length > FAILURES_MAX) stats.failures.shift();
  stats.lastError = record;   // kept for compatibility with anything already reading it
  if (deps.onError) { try { deps.onError(record); } catch { /* an error handler that throws is not one */ } }
}

/**
 * Writes a whole bundle inside the store's own transaction, where it offers one.
 *
 * Then the guarantee is genuinely all-or-nothing rather than merely referentially sound, which is
 * worth having and is why this branch exists at all.
 */
async function runAtomic(deps, stats, pending, seen, seenMax) {
  try {
    await deps.store.transaction(async (tx) => {
      for (const entity of pending) await tx.put(entity);
    });
    stats.written += pending.length;
    for (const e of pending) {
      if (seen.size >= seenMax) seen.clear();
      seen.add(e.id);
    }
  } catch (err) {
    // Nothing landed. That is the whole point of taking this branch.
    recordFailure(stats, deps, err, pending[0] || null, pending.slice(1));
  }
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
