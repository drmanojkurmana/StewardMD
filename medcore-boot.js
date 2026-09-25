/* medcore-boot.js — the only thing that turns Medical Core on, and it does nothing by default.
 *
 * WHAT IT DOES. With `smd_medcore` on, it loads the three clinical packs (units, freshness, change
 * bands), builds `window.SMD_MEDCORE`, and lets icu.js ask one question: given this ICU state and
 * this instant, what changed and what is missing. That is the whole surface in Phase 1. There is no
 * model, no probability, no prompt, no alert and no notification.
 *
 * WHY IT IS SAFE TO LOAD.
 *  1. FLAG OFF IS A COMPLETE NO-OP. With the flag off this file fetches nothing, defines nothing on
 *     window, and returns. Not loading it at all removes the feature entirely; there is no edit to
 *     revert, which is the property wardsynq-shadow-boot.js was built around.
 *  2. IT CANNOT THROW INTO THE APP. Every path is wrapped. A failure leaves `window.SMD_MEDCORE`
 *     absent or its `summary()` returning null, and icu.js renders nothing. A defect here shows up
 *     as a missing panel, never as a broken ward round.
 *  3. IT WRITES NOTHING. No store, no chart, no event bus, no network beyond fetching its own
 *     static packs, and no patient value leaves the device. Inference, when it exists, will run
 *     here too, on artifacts fetched like these packs, for exactly that reason.
 *  4. IT OWNS NO CLOCK POLICY. `summary()` takes `asOf` from the caller and passes it straight
 *     through, so the leakage control in medcore-state.js is never bypassed by a convenience
 *     default.
 *
 * Its inertness is asserted in test/medcore-flags.test.mjs (the flag guard precedes the first
 * import and the first fetch); the real browser path is test/run-medcore-ui.mjs.
 */

const FLAG = "smd_medcore";
const SHADOW_FLAG = "smd_medcore_shadow";
const PACK_V = "medcore1";

let PACKS = null;
let loading = null;

function flagOn() {
  try {
    const F = window.SMD_MEDCORE_FLAGS;
    return !!(F && F.bool && F.bool(FLAG));
  } catch (e) { return false; }
}

/* The shadow flag is meaningless without the master flag, so nothing reads it alone. */
function shadowOn() {
  try {
    const F = window.SMD_MEDCORE_FLAGS;
    return !!(F && F.shadowActive && F.shadowActive());
  } catch (e) { return false; }
}

async function loadPacks() {
  if (PACKS) return PACKS;
  if (loading) return loading;
  loading = (async () => {
    const [units, freshness, bands] = await Promise.all([
      fetch("/medcore/data/units.json?v=" + PACK_V).then((r) => r.json()),
      fetch("/medcore/data/freshness.json?v=" + PACK_V).then((r) => r.json()),
      fetch("/medcore/data/change-bands.json?v=" + PACK_V).then((r) => r.json())
    ]);
    PACKS = { unitTable: units, freshness: freshness, bands: bands };
    return PACKS;
  })();
  return loading;
}

async function install() {
  if (!flagOn()) return;                      // rule 1: nothing at all
  const [state, changesMod, missingMod] = await Promise.all([
    import("/medcore/medcore-state.js"),
    import("/medcore/medcore-changes.js"),
    import("/medcore/medcore-missing.js")
  ]);
  const packs = await loadPacks();
  const deps = { unitTable: packs.unitTable, freshness: packs.freshness };

  const API = {
    version: "medcore-boot@1.0.0",
    packs: function () {
      return {
        units: packs.unitTable.version, freshness: packs.freshness.version, bands: packs.bands.version,
        approval: [packs.unitTable, packs.freshness, packs.bands].map((p) => p.approvalStatus)
      };
    },

    /** Canonical state from today's ICU dashboard state. `asOf` is the caller's, never defaulted. */
    state: function (icuState, opts) {
      try { return state.fromIcuState(deps, icuState, opts || {}); } catch (e) { return null; }
    },

    /**
     * The one call icu.js makes. Returns null on any failure, which renders as no panel.
     * @param {object} icuState
     * @param {{asOf:*, needs?:string[], scores?:Array, max?:number}} opts
     */
    summary: function (icuState, opts) {
      try {
        const o = opts || {};
        const s = state.fromIcuState(deps, icuState, { asOf: o.asOf, subjectKey: o.subjectKey || null });
        if (!s) return null;
        return {
          schema: "medcore-summary/1",
          asOf: s.asOf,
          changed: changesMod.changes(s, packs.bands, { max: o.max }),
          missingInformation: missingMod.missing(s, { needs: o.needs, scores: o.scores }),
          provenance: s.provenance
        };
      } catch (e) { return null; }
    },

    labelFor: missingMod.labelFor
  };

  /* Shadow (smd_medcore_shadow, and only with smd_medcore). It reaches nobody: no panel, no prompt,
   * no notification, no store, nothing emitted back onto the bus. Installed from outside, onto a
   * bus the caller hands it, so not loading this file removes it completely.
   *
   * It has no artifacts to load. Every artifact that exists was trained on synthetic data and
   * medcore-models.js refuses all of them, so a shadow run today records ABSTAIN with
   * MODEL_UNAVAILABLE on every decision - which is the refusal working, not the wiring failing.
   * When a real artifact exists, it is handed to attachShadow() and nothing else changes. */
  if (shadowOn()) {
    try {
      const [shadowMod, outcomesPack] = await Promise.all([
        import("/medcore/medcore-shadow.js"),
        fetch("/medcore/data/outcomes.json?v=" + PACK_V).then((r) => r.json())
      ]);
      const shadow = shadowMod.createShadow({
        outcomes: outcomesPack,
        artifacts: {},                    // nothing admissible exists yet, by design
        stateFor: function (payload) {
          /* A caller-supplied adapter wins. Without one, the default is the patient currently open
           * in the ICU workspace, because StewardMD is a single-patient mobile app and that is the
           * only patient this device has a state for.
           *
           * ITS LIMITATION, STATED RATHER THAN DISCOVERED LATER: it cannot follow an event about a
           * patient who is not the one on screen. On a device that is the honest answer - there is
           * no state to build for anybody else - but it means a shadow run here observes one
           * patient at a time, not a ward. A server-side shadow over the WardSynQ store is a
           * different consumer and would supply its own adapter through setStateAdapter(). */
          try {
            if (API._stateFor) return API._stateFor(payload);
            if (!window.ICU || typeof window.ICU.state !== "function") return null;
            const asOf = (payload && (payload.at || payload.effectiveAt || payload.recordedAt)) || Date.now();
            return API.state(window.ICU.state(), { asOf: asOf, subjectKey: "device-current" });
          } catch (e) { return null; }
        }
      });
      API.shadow = shadow;
      API.attachShadow = function (bus, opts) { return shadow.attach(bus, opts); };
      API.setStateAdapter = function (fn) { API._stateFor = fn; };
    } catch (e) { /* a shadow that failed to install is a missing diagnostic, never a broken app */ }
  }

  window.SMD_MEDCORE = API;
  try { window.dispatchEvent(new Event("smd:medcore-ready")); } catch (e) {}
}

install().catch(function () { /* rule 2: a failure is a missing panel, never a thrown error */ });
