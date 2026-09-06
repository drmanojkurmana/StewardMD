/* wardsynq-ghis-live-boot.js — connects the already-built, already-tested GHIS cut-over
 * (wardsynq/wardsynq-ghis-live.js) to the real GHIS path.
 *
 * The cut-over module has existed, tested, and architecturally approved by the owner since
 * 2026-09-05 (see wardsynq-flags.js's own header on smd_wardsynq_cutover) — and nothing called it.
 * This is the thing that calls it, mirroring wardsynq-shadow-boot.js's own architecture, which
 * already solved the exact wiring problem this file has.
 *
 * THE FLAG DECIDES EVERYTHING, AND IS CHECKED FIRST. `flagIsOn()` reads the EXISTING
 * `smd_wardsynq_cutover` flag (wardsynq-flags.js) — not a new one, not the shadow flag. OFF (the
 * shipped default): this whole file does nothing beyond that one check. ON: `installLiveGhis()`
 * runs, exactly as wardsynq-ghis-live.js already implements and 23 tests already verify.
 *
 *   boot script loaded -> inspect smd_wardsynq_cutover -> OFF: return immediately, nothing else runs
 *                                                       -> ON: installLiveGhis()
 *
 * Loading this file changes nothing by itself. The flag does.
 *
 * BOTH DOORS, FOR THE SAME REASON THE SHADOW BOOT SCRIPT ALREADY WRAPS BOTH. `ghis-ward.js` calls
 * `ICU.ingestWardHistory` when it exists and falls back to `ingestFromWard` only on older builds.
 * `installLiveGhis` gained an optional `method` parameter (2026-09-06) for exactly this file to use;
 * wrapping `ingestFromWard` alone here would wire the cut-over to a door a current build's real ward
 * sync never walks through — installed, reporting `installed: true`, and seeing nothing, which is
 * the identical failure the shadow observer already found on a real device once.
 *
 * WRITES ONLY THROUGH THE EXISTING, GOVERNED, TENANT-BOUND RECORD CONNECTION — NEVER A NEW ONE.
 * `wardsynq-record-boot.js` already builds the governed, tenant-scoped record session
 * (`window.SMD_WARDSYNQ_RECORD`), gated by its OWN separate `?wardsynq_record=<tenantId>`
 * configuration. This file does not open a second connection, does not invent a store, and does not
 * pick a tenant. If that record connection is live when this boots, `installLiveGhis` is given a
 * store bound to it — a fresh KIND.ADAPTER actor (capped at DRAFT by the existing actor model, never
 * the signed-in doctor's own tier; wardsynq-ghis-live.js's own header: "a feed cannot commit an
 * active clinical record however confidently the source system asserts one") writing through that
 * SAME tenant's GovernedStore, and the SAME ClinicalEventBus instance for divergence/ingest events.
 * If it is NOT live — no tenant configured, or it failed to connect — `installLiveGhis` runs with no
 * store at all, which is its own already-documented DRY RUN: mapping happens and is counted, nothing
 * is written, and the report says so rather than claiming success. So turning `smd_wardsynq_cutover`
 * on, by itself, on a device with no `wardsynq_record` tenant configured, writes NOTHING — real
 * writes require BOTH flags, deliberately, which is exactly the two-key control an authoritative
 * pilot needs and precisely why this file does not try to configure a tenant on its own.
 *
 * WHY IT POLLS FOR window.ICU. Same reason as the shadow boot script: icu.js is a deferred classic
 * script and this is a module, and their relative load order is not something to bet a ward round
 * on. Polling briefly and giving up quietly is more robust than an ordering assumption.
 *
 * WHAT THIS DOES NOT DO. It does not enable the flag anywhere — the default ships OFF and stays OFF
 * until someone deliberately sets it. It does not touch icu.js, ghis-ward.js, or the legacy ingest
 * path. It does not run real-device verification; that is the owner's separate, deliberate next
 * step. It does not migrate any resource type beyond what wardsynq-ghis-live.js already maps.
 */

const FLAG = "smd_wardsynq_cutover";
const POLL_MS = 250;
const GIVE_UP_AFTER_MS = 15000;

/* Same two doors the shadow boot script wraps, most-used first. */
const METHODS = ["ingestWardHistory", "ingestFromWard"];

function hasAnyMethod(icu) {
  return !!icu && METHODS.some((m) => typeof icu[m] === "function");
}

function flagIsOn() {
  try {
    const flags = window.SMD_WARDSYNQ_FLAGS;
    return !!(flags && typeof flags.get === "function" && flags.get(FLAG));
  } catch (err) {
    return false;
  }
}

/**
 * PURE. Combines one report() per wrapped method into the single view SMD_WARDSYNQ_LIVE.report()
 * returns. The same shape mergeReports() in wardsynq-shadow-boot.js already produces, for the same
 * reason: neither door may silently hide what the other saw.
 */
function mergeReports(parts) {
  const sum = (k) => parts.reduce((n, p) => n + p[k], 0);
  const byMethod = {};
  for (const p of parts) byMethod[p.method] = p;
  return {
    methods: parts.map((p) => p.method),
    mode: parts.some((p) => p.mode === "halted") ? "halted" : (parts.some((p) => p.mode === "live") ? "live" : "off"),
    bundlesSeen: sum("bundlesSeen"),
    mapped: sum("mapped"),
    written: sum("written"),
    skippedDuplicate: sum("skippedDuplicate"),
    adapterErrors: sum("adapterErrors"),
    writeErrors: sum("writeErrors"),
    observationsMapped: sum("observationsMapped"),
    issues: parts.flatMap((p) => p.issues).slice(-50),
    divergences: parts.flatMap((p) => p.divergences).slice(-50),
    failures: parts.flatMap((p) => p.failures).slice(-200),
    lastAt: parts.map((p) => p.lastAt).filter(Boolean).sort().pop() || null,
    clinicalNote: (parts[0] && parts[0].clinicalNote) || null,
    byMethod,
  };
}

/**
 * The store/bus/actor to hand installLiveGhis, derived ONLY from the existing, already-connected
 * record session — never a new connection. `null` store means a dry run: installLiveGhis's own
 * documented, honest "mapped and counted, nothing written" mode, not a failure.
 */
function recordDeps({ makeActor, KIND, TIER }) {
  const rec = (typeof window !== "undefined" && window.SMD_WARDSYNQ_RECORD) || null;
  if (!rec || rec.error || !rec.governed) return { store: null, bus: null };
  // A fresh ADAPTER-kind actor, exactly as wardsynq-ghis-live.js's own test harness constructs one —
  // never the signed-in doctor's own actor, so this can never inherit a human's write tier.
  const adapter = makeActor({ id: "ghis-adapter", kind: KIND.ADAPTER, tier: TIER.DRAFT });
  return { store: rec.governed.asStoreFor(adapter), bus: rec.bus || null };
}

async function boot() {
  if (!flagIsOn()) return;   // OFF by default, and the default is the shipped state

  const started = Date.now();
  while (!hasAnyMethod(window.ICU)) {
    if (Date.now() - started > GIVE_UP_AFTER_MS) {
      console.warn("[wardsynq live] ICU never appeared; cut-over not installed. Nothing else is affected.");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  try {
    const [{ installLiveGhis }, { makeActor, KIND, TIER }] = await Promise.all([
      import("./wardsynq/wardsynq-ghis-live.js"),
      import("./wardsynq/wardsynq-actors.js"),
    ]);
    const { store, bus } = recordDeps({ makeActor, KIND, TIER });

    const installers = [];
    for (const method of METHODS) {
      if (typeof window.ICU[method] !== "function") continue;   // absent on older builds
      const api = installLiveGhis({ host: window.ICU, flags: window.SMD_WARDSYNQ_FLAGS, store, bus, method });
      if (api && api.installed) installers.push(api);
      else console.warn("[wardsynq live]", method, "not installed:", (api && api.reason) || "unknown reason");
    }

    if (!installers.length) {
      console.warn("[wardsynq live] no ingest function could be wrapped; nothing else is affected.");
      return;
    }

    const combined = {
      installed: true,
      methods: installers.map((o) => o.method),
      dryRun: !store,
      // The kill switch this whole file exists to preserve: stops EVERY wrapped door in-process,
      // no reload, legacy continues untouched — exactly installLiveGhis's own halt(), fanned out.
      halt(reason) { return installers.map((o) => o.halt(reason)); },
      resume() { return installers.map((o) => o.resume()); },
      uninstall() { installers.forEach((o) => o.uninstall()); return true; },
      report() { return mergeReports(installers.map((o) => o.report())); },
    };
    window.SMD_WARDSYNQ_LIVE = combined;

    console.info(
      "[wardsynq live] cut-over installed via " + combined.methods.join(" + ") + (combined.dryRun ? " (DRY RUN: no record connection, nothing is written)" : "") + ".\n" +
      "The legacy ward-sync path is unaffected and runs first, unconditionally.\n" +
      "Run SMD_WARDSYNQ_LIVE.report() to see what it did. SMD_WARDSYNQ_LIVE.halt('<reason>') stops it immediately, without a reload.",
    );
  } catch (err) {
    // A failure to install the cut-over must never be a failure of the ward round.
    console.warn("[wardsynq live] could not install; the ward round is unaffected:", err && err.message);
  }
}

boot();

export { hasAnyMethod, flagIsOn, mergeReports, recordDeps, METHODS };
