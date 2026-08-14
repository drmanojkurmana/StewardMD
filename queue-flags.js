/* Smart OPD Queue — feature flags (mirrors followcare-flags.js). Resolution: ?query → localStorage → default.
 * Master flag smd_opd_queue DEFAULT ON (go-live 2026-08-10: server QUEUE_ENABLED=1, secrets configured,
 * Firestore TTL set; ready:{enabled,configured}=true). Still fails SAFE: with the
 * flag on but server secrets unprovisioned, the module shows a clean "being set up" state and does nothing
 * (isQueueConfigured() guard) — no PHI processed, no message sent. Set ?q=1 (or localStorage) to preview.
 * Exposes window.SMD_QUEUE_FLAGS. No PHI, no network. */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;
  var LS = (function () { try { return G.localStorage; } catch (e) { return null; } })();
  var Q = (function () { try { return new URLSearchParams(G.location && G.location.search || ""); } catch (e) { return { get: function () { return null; } }; } })();

  // PUBLIC-RELEASE-GATE: OPD Queue + EMR are DEV/TESTING features (server provisioning + clinical validation
  // pending). Flipped ON here for owner/device testing per the "enable everything implemented" dev posture.
  // Set these back to def:false before ANY App-Store/Play/public release. Writes are STILL doubly gated:
  // server needs QUEUE_EMR_WRITE=1 (assessment + investigation orders), and PRESCRIBE stays server-hard-blocked
  // (QUEUE_EMR_PRESCRIBE_OK) until the CreateDrugs payload is captured/verified. Every submit needs a confirm().
  var DEFS = {
    smd_opd_queue: { type: "bool", def: true, query: "q", desc: "Smart OPD Queue master flag" },
    smd_opd_queue_patient: { type: "bool", def: true, query: "qpatient", desc: "Patient live tracking page" },
    smd_opd_queue_import: { type: "bool", def: true, query: "qimport", desc: "GHIS/EMR roster auto-import" },
    smd_opd_emr: { type: "bool", def: true, query: "qemr", desc: "Read-only OPD patient profile + reports (P1)" },
    smd_opd_emr_write: { type: "bool", def: true, query: "qemrwrite", desc: "OPD write-back submit buttons (assessment + investigation orders live w/ QUEUE_EMR_WRITE; prescribe server-blocked). PUBLIC-RELEASE-GATE" },
    smd_onco_protocols: { type: "bool", def: false, query: "qonco", desc: "Oncology treatment-plan engine (Protocol/Plan/Cycle/Administration). Writes double-gated by server QUEUE_ONCO_WRITE. PUBLIC-RELEASE-GATE" },
    smd_onco_home: { type: "bool", def: false, query: "qoncohome", desc: "Onco Home reference workbench (P0): global search + tool grid over MEDCALC/KB/drugs. Read-only, no writes." },
    smd_onco_staging: { type: "bool", def: false, query: "qoncostaging", desc: "AJCC/TNM staging engine (P1): versioned schema + version toggle. Seeded sites carry only a flagged generic TNM scaffold (R1-pending); other sites show an honest content gap. No proprietary AJCC tables. Read-only." },
    smd_onco_tallman: { type: "bool", def: false, query: "qoncotallman", desc: "Tall-man lettering (P1) for oncology drug names in the Onco drug view (ISMP List of Confused Drug Names). Display-only." },
    smd_onco_drugview: { type: "bool", def: false, query: "qoncodrugs", desc: "Onco drug + interaction view (P1): oncology-filtered list over MEDDRUGS + interaction checker, tall-man applied. Read-only, reuses the existing drug DB." },
    smd_onco_protoref: { type: "bool", def: false, query: "qoncoproto", desc: "Protocol reference library (P1): read-only browse of kb/protocols/index.json with lifecycle badges. Not for ordering/administration." },
    smd_onco_ctcae: { type: "bool", def: false, query: "qoncoctcae", desc: "CTCAE grading engine (P2): versioned reader over kb/onco/ctcae/catalog.json. Curated NCI CTCAE v5.0 adverse-event grades, each R1-flagged; v4.03 + un-seeded AEs are honest gaps. Fail-closed fabrication auditor. Read-only." },
    smd_onco_iotox: { type: "bool", def: false, query: "qoncoiotox", desc: "IO toxicity (irAE) reference (P2): grade-based management PRINCIPLES by organ, grounded in ASCO/NCCN/SITC (cited by name). No doses/thresholds (fail-closed on numerals). Read-only." },
    smd_onco_recist: { type: "bool", def: false, query: "qoncorecist", desc: "RECIST 1.1 response calculator (P2): real target-lesion sum -> percent change -> CR/PR/SD/PD with nadir + new-lesion handling. Reference calculation only. Read-only." },
    smd_onco_favorites: { type: "bool", def: false, query: "qoncofav", desc: "Onco Home Favorites + Recent (P2): localStorage-backed star/recent list across Onco Home. Pure UX, no clinical content, private-mode safe." },
    smd_onco_recommend: { type: "bool", def: false, query: "qoncorecommend", desc: "ONCQIS Phase B protocol recommendation engine (onco-recommend.js): suggests APPLICABLE ACTIVE Standard Protocols for a clinical phenotype and why. Decision-support only, never auto-selects/prescribes; always the full list w/ reviewRequired. Read-only (GET onco/recommend, QUEUE_VIEW). Default OFF." }
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
  function on() { return bool("smd_opd_queue"); }
  function defs() { return DEFS; }

  var API = { bool: bool, set: set, on: on, defs: defs, _version: 1 };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  G.SMD_QUEUE_FLAGS = API;
})();
