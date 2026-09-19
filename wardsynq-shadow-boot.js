/* wardsynq-shadow-boot.js — connects WardSynQ shadow observation to the real GHIS path.
 *
 * The shadow module has existed and nothing called it. This is the thing that calls it, on a real
 * device, against real ward traffic.
 *
 * WHAT SHADOW MODE DOES. With ?wardsynq_shadow=1, a GHIS bundle that has ALREADY been ingested by
 * the legacy path is additionally passed through the WardSynQ adapter, mapped to the canonical
 * model, and the result compared against what the bundle contained. The mapping happens; the output
 * is counted and then discarded.
 *
 * WHAT IT DOES NOT DO, WHICH IS THE ENTIRE POINT.
 *   - It writes NOTHING. No store, no canonical record, no chart. The shadow module holds no store
 *     reference and is not given one here.
 *   - It emits NOTHING. No event bus, so no safety engine, no critical-result loop, no escalation.
 *   - It changes no production behaviour. The legacy ingest runs FIRST, its result is returned
 *     untouched, and the observation runs afterwards inside a try/catch that cannot reach the
 *     caller. Not loading this file removes the change completely; there is no edit to revert.
 *   - It does not enable the cut-over. That is a different flag and this file never reads it.
 *
 * WHAT IT SEES, STATED PRECISELY, AND CORRECTED. An earlier version of this file wrapped only
 * `window.ICU.ingestFromWard` and claimed on that basis to observe the real GHIS sync. THAT WAS
 * WRONG, and it was wrong in the quietest possible way: `ghis-ward.js` calls `ICU.ingestWardHistory`
 * whenever it exists and only falls back to `ingestFromWard` "on older builds", so on a current
 * build every ward sync went through a function nothing was watching. The observer reported
 * `bundlesSeen: 0` on a device that had just synced a ward, which reads as "nothing went wrong"
 * rather than "nothing was looked at". Found on a real device, 2026-09-05.
 *
 * It now wraps BOTH `ingestWardHistory` and `ingestFromWard`, so it observes the real GHIS ward
 * sync on current and older builds alike, plus the import and voice paths inside icu.js. It still
 * does NOT observe the ICU Snapshot photo-import path, which calls the closure-local function
 * directly and never touches the object. That path is not GHIS traffic, so it is not what this is
 * for, but it is stated rather than left to be discovered.
 *
 * WHY IT POLLS FOR window.ICU. icu.js is a deferred classic script and this is a module; both run
 * after parsing and their relative order is not something to bet a ward round on. Polling briefly
 * and then giving up is more robust than an ordering assumption, and giving up quietly is correct:
 * a device where ICU never loads has a bigger problem than an uninstalled observer.
 */

const FLAG = "smd_wardsynq_shadow";
const POLL_MS = 250;
const GIVE_UP_AFTER_MS = 15000;

/* Every door a GHIS ward sync can come through, most-used first. ghis-ward.js prefers
 * ingestWardHistory and falls back to ingestFromWard; both are wrapped so neither build shape can
 * ingest unobserved. */
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
 * PURE. Combines one report() per wrapped method into the single view SMD_WARDSYNQ_SHADOW.report()
 * returns. Extracted (2026-09-06) so this — the exact layer whose ordering mistake once made a real
 * ward sync report `bundlesSeen: 0` — has a test that does not require a browser to run.
 */
function mergeReports(parts) {
  const sum = (k) => parts.reduce((n, p) => n + p[k], 0);
  const byMethod = {};
  for (const p of parts) byMethod[p.method] = p;
  return {
    methods: parts.map((p) => p.method),
    observed: parts.some((p) => p.observed),
    bundlesSeen: sum("bundlesSeen"),
    mapped: sum("mapped"),
    shadowErrors: sum("shadowErrors"),
    observationsMapped: sum("observationsMapped"),
    legacyLabRows: sum("legacyLabRows"),
    issues: parts.flatMap((p) => p.issues).slice(-50),
    disagreements: parts.flatMap((p) => p.disagreements).slice(-50),
    lastAt: parts.map((p) => p.lastAt).filter(Boolean).sort().pop() || null,
    clean: parts.some((p) => p.observed)
      && parts.every((p) => p.shadowErrors === 0 && p.disagreements.length === 0),
    byMethod,
  };
}

async function boot() {
  if (!flagIsOn()) return;   // OFF by default, and the default is the shipped state

  const started = Date.now();
  while (!hasAnyMethod(window.ICU)) {
    if (Date.now() - started > GIVE_UP_AFTER_MS) {
      console.warn("[wardsynq shadow] ICU never appeared; observer not installed. Nothing else is affected.");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  try {
    const { installShadow } = await import("./wardsynq/wardsynq-shadow.js");

    // No store and no bus are passed, deliberately and visibly: there is nothing here for the
    // observer to write to or emit on even if it tried.
    const observers = [];
    for (const method of METHODS) {
      if (typeof window.ICU[method] !== "function") continue;   // absent on older builds
      const api = installShadow({ host: window.ICU, flags: window.SMD_WARDSYNQ_FLAGS, logger: console, method });
      if (api && api.installed) observers.push(api);
      else console.warn("[wardsynq shadow]", method, "not observed:", (api && api.reason) || "unknown reason");
    }

    if (!observers.length) {
      console.warn("[wardsynq shadow] no ingest function could be observed; nothing else is affected.");
      return;
    }

    // installShadow sets window.SMD_WARDSYNQ_SHADOW to whichever observer installed last. With more
    // than one that would silently hide the others, and hiding a door is the whole defect this
    // change exists to fix, so the global becomes a view over ALL of them.
    const combined = {
      installed: true,
      methods: observers.map((o) => o.method),
      uninstall() { observers.forEach((o) => o.uninstall()); return true; },
      report() { return mergeReports(observers.map((o) => o.report())); },
    };
    window.SMD_WARDSYNQ_SHADOW = combined;

    console.info(
      "[wardsynq shadow] observing GHIS ingest via " + combined.methods.join(" + ") + ".\n" +
      "Nothing is written and no production behaviour is changed.\n" +
      "Run SMD_WARDSYNQ_SHADOW.report() to see what it observed. `observed: false` means it has\n" +
      "been handed nothing yet, which is NOT the same as a clean run.",
    );
  } catch (err) {
    // A failure to install an observer must never be a failure of the app.
    console.warn("[wardsynq shadow] could not install; the ward round is unaffected:", err && err.message);
  }
}

boot();

export { hasAnyMethod, flagIsOn, mergeReports, METHODS };
