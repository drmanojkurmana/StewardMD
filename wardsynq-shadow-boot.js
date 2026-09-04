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
 * WHAT IT SEES, STATED PRECISELY. It wraps `window.ICU.ingestFromWard`, so it observes every caller
 * that dispatches through the ICU object. That includes the real GHIS sync (ghis-ward.js) and the
 * import and voice paths inside icu.js. It does NOT observe the ICU Snapshot photo-import path,
 * which calls the closure-local function directly and never touches the object. That path is not
 * GHIS traffic, so it is not what this is for, but it is stated rather than left to be discovered.
 *
 * WHY IT POLLS FOR window.ICU. icu.js is a deferred classic script and this is a module; both run
 * after parsing and their relative order is not something to bet a ward round on. Polling briefly
 * and then giving up is more robust than an ordering assumption, and giving up quietly is correct:
 * a device where ICU never loads has a bigger problem than an uninstalled observer.
 */

const FLAG = "smd_wardsynq_shadow";
const POLL_MS = 250;
const GIVE_UP_AFTER_MS = 15000;

function flagIsOn() {
  try {
    const flags = window.SMD_WARDSYNQ_FLAGS;
    return !!(flags && typeof flags.get === "function" && flags.get(FLAG));
  } catch (err) {
    return false;
  }
}

async function boot() {
  if (!flagIsOn()) return;   // OFF by default, and the default is the shipped state

  const started = Date.now();
  while (!(window.ICU && typeof window.ICU.ingestFromWard === "function")) {
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
    const api = installShadow({ host: window.ICU, flags: window.SMD_WARDSYNQ_FLAGS, logger: console });

    if (api && api.installed) {
      console.info(
        "[wardsynq shadow] observing GHIS ingest. Nothing is written and no production behaviour is changed.\n" +
        "Run SMD_WARDSYNQ_SHADOW.report() to see what it observed.",
      );
    } else {
      console.warn("[wardsynq shadow] not installed:", (api && api.reason) || "unknown reason");
    }
  } catch (err) {
    // A failure to install an observer must never be a failure of the app.
    console.warn("[wardsynq shadow] could not install; the ward round is unaffected:", err && err.message);
  }
}

boot();
