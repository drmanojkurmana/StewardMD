/* Smart OPD Queue + Oncology — feature flags (mirrors followcare-flags.js). Resolution: ?query -> localStorage -> default.
 * PUBLIC-RELEASE POSTURE (App Store v2.1): the OPD Queue/EMR + onco write/admin/experimental flags ship
 * def:false (see the DEFS block); the OncoTree navigator + read-only onco reference ship def:true. The queue
 * module also fails SAFE server-side: even with a flag on but server secrets unprovisioned it shows a clean
 * "being set up" state and does nothing (isQueueConfigured() guard), no PHI processed, no message sent.
 * Set ?q=1 (or localStorage) to preview. Exposes window.SMD_QUEUE_FLAGS. No PHI, no network. */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;
  var LS = (function () { try { return G.localStorage; } catch (e) { return null; } })();
  var Q = (function () { try { return new URLSearchParams(G.location && G.location.search || ""); } catch (e) { return { get: function () { return null; } }; } })();

  // PUBLIC-RELEASE POSTURE (App Store v2.1, owner-decided 2026-08-16):
  //  OFF for public (dev/testing, server-provisioning-pending, write-back, admin, experimental):
  //    smd_opd_queue(+_patient/_import), smd_opd_emr(+_write), smd_onco_protocols, smd_onco_recommend,
  //    smd_onco_evidence_overlay, smd_onco_kb_admin, smd_onco_protolib.
  //  ON for public (R1-GO navigator + read-only reference): smd_onco_navigator, smd_onco_home, _staging,
  //    _ctcae, _iotox, _recist, _drugview, _protoref, _tallman, _favorites.
  // TestFlight/owner testing re-enables the OFF set via ?query params or the enable snippet in
  // docs/APP-STORE-SUBMISSION.md (localStorage). Writes stay doubly gated regardless: server needs
  // QUEUE_EMR_WRITE=1 / QUEUE_ONCO_WRITE=1, PRESCRIBE stays server-hard-blocked, every submit needs confirm().
  var DEFS = {
    // ── OPD: def:TRUE for dev/testing, owner-approved 2026-08-21. ───────────────────────────────
    // The tile was invisible on device purely because the master flag was def:false; all the OPD code
    // was present and live. Each line KEEPS its PUBLIC-RELEASE-GATE token on purpose, so `grep
    // PUBLIC-RELEASE-GATE` still lists everything that must be re-closed or owner-gated before a
    // public release. Opt out per device with localStorage <flag>=0.
    smd_opd_queue: { type: "bool", def: true, query: "q", desc: "Smart OPD Queue master flag. PUBLIC-RELEASE-GATE: def:TRUE for dev/testing (owner-approved 2026-08-21); re-close or owner-gate before public release." },
    smd_opd_queue_patient: { type: "bool", def: true, query: "qpatient", desc: "Patient live tracking page. PUBLIC-RELEASE-GATE: def:TRUE for dev/testing (owner-approved 2026-08-21)." },
    smd_opd_queue_import: { type: "bool", def: true, query: "qimport", desc: "GHIS/EMR roster auto-import. PUBLIC-RELEASE-GATE: def:TRUE for dev/testing (owner-approved 2026-08-21). Only imports when the session carries a GHIS token, so a clinic/Connect session must keep ghisToken null or hospital OPD cross-imports into the clinic queue." },
    smd_opd_emr: { type: "bool", def: true, query: "qemr", desc: "Read-only OPD patient profile + reports (P1). PUBLIC-RELEASE-GATE: def:TRUE for dev/testing (owner-approved 2026-08-21). Read-only, so no write risk." },
    smd_opd_emr_write: { type: "bool", def: true, query: "qemrwrite", desc: "OPD write-back submit buttons (assessment + investigation orders live w/ QUEUE_EMR_WRITE; prescribe server-blocked). PUBLIC-RELEASE-GATE: def:TRUE for dev/testing (owner-approved 2026-08-21). The ONLY OPD flag that writes to an EMR; still double-gated by server QUEUE_EMR_WRITE, so this client default alone cannot write." },
    smd_onco_protocols: { type: "bool", def: true, query: "qonco", desc: "Oncology treatment-plan engine (Protocol/Plan/Cycle/Administration). PUBLIC-RELEASE-GATE: def:TRUE for dev/testing (owner-approved 2026-08-21). Writes stay double-gated by server QUEUE_ONCO_WRITE, so this client default alone cannot write a plan; re-close or owner-gate before public release." },
    smd_onco_home: { type: "bool", def: true, query: "qoncohome", desc: "Onco Home reference workbench (P0): global search + tool grid over MEDCALC/KB/drugs. Read-only, no writes." },
    smd_onco_staging: { type: "bool", def: true, query: "qoncostaging", desc: "AJCC/TNM staging engine (P1): versioned schema + version toggle. Seeded sites carry only a flagged generic TNM scaffold (R1-pending); other sites show an honest content gap. No proprietary AJCC tables. Read-only." },
    smd_onco_tallman: { type: "bool", def: true, query: "qoncotallman", desc: "Tall-man lettering (P1) for oncology drug names in the Onco drug view (ISMP List of Confused Drug Names). Display-only." },
    smd_onco_drugview: { type: "bool", def: true, query: "qoncodrugs", desc: "Onco drug + interaction view (P1): oncology-filtered list over MEDDRUGS + interaction checker, tall-man applied. Read-only, reuses the existing drug DB." },
    smd_onco_protoref: { type: "bool", def: true, query: "qoncoproto", desc: "Protocol reference library (P1): read-only browse of kb/protocols/index.json with lifecycle badges. Not for ordering/administration." },
    smd_onco_ctcae: { type: "bool", def: true, query: "qoncoctcae", desc: "CTCAE grading engine (P2): versioned reader over kb/onco/ctcae/catalog.json. Curated NCI CTCAE v5.0 adverse-event grades, each R1-flagged; v4.03 + un-seeded AEs are honest gaps. Fail-closed fabrication auditor. Read-only." },
    smd_onco_iotox: { type: "bool", def: true, query: "qoncoiotox", desc: "IO toxicity (irAE) reference (P2): grade-based management PRINCIPLES by organ, grounded in ASCO/NCCN/SITC (cited by name). No doses/thresholds (fail-closed on numerals). Read-only." },
    smd_onco_recist: { type: "bool", def: true, query: "qoncorecist", desc: "RECIST 1.1 response calculator (P2): real target-lesion sum -> percent change -> CR/PR/SD/PD with nadir + new-lesion handling. Reference calculation only. Read-only." },
    smd_onco_favorites: { type: "bool", def: true, query: "qoncofav", desc: "Onco Home Favorites + Recent (P2): localStorage-backed star/recent list across Onco Home. Pure UX, no clinical content, private-mode safe." },
    smd_onco_recommend: { type: "bool", def: true, query: "qoncorecommend", desc: "ONCQIS Phase B protocol recommendation engine (onco-recommend.js): suggests APPLICABLE ACTIVE Standard Protocols for a clinical phenotype and why. Decision-support only, never auto-selects/prescribes; always the full list w/ reviewRequired. Read-only (GET onco/recommend, QUEUE_VIEW). PUBLIC-RELEASE-GATE: def:TRUE for dev/testing (owner-approved 2026-08-21)." },
    smd_onco_evidence_overlay: { type: "bool", def: true, query: "qoncoevidence", desc: "ONCQIS Phase C evidence overlay (onco-evidence.js): 3-layer evidence panel (core/guideline/institutional), UPDATE AVAILABLE guideline overlay, and per-field EVIDENCE DIVERGENCE view. Decision-support only; never silently reconciles evidence or auto-replaces a protocol - every action only records the physician's choice. Read-only. PUBLIC-RELEASE-GATE: def:TRUE for dev/testing (owner-approved 2026-08-21)." },
    smd_onco_kb_admin: { type: "bool", def: true, query: "qoncokbadmin", desc: "ONCQIS Phase J-a Knowledge Center INGESTION (admin/oncology): guideline upload + AI evidence extraction + batch Update Impact Report over ACTIVE Standard Protocols. Admin-only, gated by the ONCQIS_PROTOCOL_AUTHOR cap + server env SMD_ONCO_KB_ADMIN, so this client default alone opens nothing. AI output lands ONLY in Evidence-Source/extraction/Impact-Report objects; NEVER writes an ACTIVE protocol/plan/dose. No PHI ever sent to the AI. PUBLIC-RELEASE-GATE: def:TRUE for dev/testing (owner-approved 2026-08-21)." },
    smd_onco_protolib: { type: "bool", def: true, query: "qoncoprotolib", desc: "EXPERIMENTAL grounded Standard Protocol library (v2 zero-VERIFY regimens promoted into kb/protocols/ as lifecycleState:draft + experimental:true). When ON, the workbench also loads these experimental protocols for OWNER/DEVICE TEST ONLY; they are NEVER lifecycleState:active, so real clinical activation still requires a separate human decision. Requires smd_onco_protocols + write mode to reach the apply flow. PUBLIC-RELEASE-GATE: def:TRUE for dev/testing (owner-approved 2026-08-21) - THIS IS THE ONE THAT SURFACES UNVERIFIED REGIMENS, so it must be re-closed before public release." },
    smd_onco_navigator: { type: "bool", def: true, query: "qoncotree", desc: "ONCOTREE clinical navigator (oncotree.js): a deterministic disease pathway (phenotype -> applicable EXISTING Standard Protocols by reference). Decision support only; references protocol IDs/versions, never a second protocol DB, never selects/prescribes/doses (the existing dose engine + physician own that). Reads the same lifecycle badges as the library. Default ON (owner-approved go-live 2026-08-15; R1 GO on all verticals). Opt out with localStorage smd_onco_navigator=0." },
    smd_opd_billing: { type: "bool", def: true, query: "qbill", desc: "Clinic operations BILLING station (lean MVP): patient registry + first-class orders + tariff + invoice + mark-paid (cashier role). UI at /clinic-billing. PUBLIC-RELEASE-GATE: def:TRUE for dev/testing (owner-approved 2026-08-21); stays INERT until CLINIC_BILLING_ENABLED=1 server-side, so flipping this alone changes nothing a patient can reach." },
    smd_opd_branding: { type: "bool", def: true, query: "qbrand", desc: "Pro white-label clinic branding: upload a clinic logo (owner/admin + Pro) shown on the patient page, wall board + FollowCare with 'powered by StewardMD'. Server serves it same-origin. PUBLIC-RELEASE-GATE: def:TRUE for dev/testing (owner-approved 2026-08-21); still needs a Pro org owner to upload anything." }
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
