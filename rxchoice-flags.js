/* RxChoice™ — feature flags (mirrors queue-flags.js / followcare-flags.js exactly).
 * Resolution: ?query -> localStorage -> default. Exposes window.SMD_RXCHOICE_FLAGS. No PHI, no network.
 *
 * POSTURE: the master flag is def:TRUE for dev/testing so the button is reachable on device, and
 * EVERY flag here is additive - with smd_rxchoice=0 the prescription pad and the OPD consult behave
 * exactly as they did before this module existed (no button, no PDF section, no state). The feature
 * cannot change a prescription on its own: it only ever writes the BRAND field, only when the doctor
 * taps SELECT, and the doctor's own product is always one of the four cards.
 *
 * PUBLIC-RELEASE-GATE: re-close or owner-gate smd_rxchoice before a public release (the course-cost
 * figures are computed from the Drug Database's MRP, which is a list price, not a pharmacy quote).
 */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;
  var LS = (function () { try { return G.localStorage; } catch (e) { return null; } })();
  var Q = (function () { try { return new URLSearchParams(G.location && G.location.search || ""); } catch (e) { return { get: function () { return null; } }; } })();

  var DEFS = {
    smd_rxchoice: { type: "bool", def: true, query: "rxc", desc: "RxChoice master flag: the opt-in 'Same Prescription. Smarter Price.' panel on a finished prescription. OFF restores the pre-RxChoice pad exactly. PUBLIC-RELEASE-GATE: def:TRUE for dev/testing." },
    smd_rxchoice_price: { type: "bool", def: true, query: "rxcprice", desc: "Show course-level cost (pack size x packs needed x MRP) on the four cards. OFF = products only, no rupee figures. MRP is the Drug Database's list price, never a live pharmacy quote." },
    smd_rxchoice_ai_normalization: { type: "bool", def: false, query: "rxcai", desc: "Let AI normalize a free-text drug line into a composition BEFORE the deterministic database lookup. OFF by default: the deterministic composition/brand index already resolves every line the pad can produce, and AI output must never reach eligibility, matching, pricing or ranking - those stay deterministic whatever this flag says." },
    smd_rxchoice_patient_selection: { type: "bool", def: false, query: "rxcpatient", desc: "Phase 2: let the PATIENT pick among the products the doctor approved. OFF for MVP - doctor approval first, and a patient can never introduce a product the doctor did not approve." },
    smd_rxchoice_pdf: { type: "bool", def: true, query: "rxcpdf", desc: "Append the RxChoice section (four options + the final selected product) to the printed/PDF prescription. The conventional prescription above it is unchanged." },
    smd_rxchoice_inline: { type: "bool", def: true, query: "rxcinline", desc: "Show 4-way cost choice tray automatically under each medication line on the prescription pad. Master smd_rxchoice must also be ON." }
  };

  function raw(key) {
    var d = DEFS[key]; if (!d) return null;
    var q = null; try { q = Q.get(d.query); } catch (e) {}
    if (q === "1" || q === "true") return "1";
    if (q === "0" || q === "false") return "0";
    var v = null; try { v = LS && LS.getItem(key); } catch (e) {}
    if (v === "1" || v === "0") return v;
    return d.def ? "1" : "0";
  }
  function bool(key) { return raw(key) === "1"; }
  function set(key, on) { try { LS && LS.setItem(key, on ? "1" : "0"); } catch (e) {} }
  function on() { return bool("smd_rxchoice"); }
  function defs() { return DEFS; }

  var API = { bool: bool, set: set, on: on, defs: defs, _version: 1 };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  G.SMD_RXCHOICE_FLAGS = API;
})();
