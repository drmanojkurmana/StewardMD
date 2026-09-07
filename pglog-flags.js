/* pglog-flags.js — NMC Logbook (PG digital logbook) · flag registry.
 * Sibling of surgx-flags.js / clinix-flags.js / sknx-flags.js — same DEFS/get/set/all shape,
 * same resolution order: ?query param -> localStorage -> default. Persistence is localStorage only.
 * Dual export: module.exports for node tests, window.SMD_PGLOG_FLAGS for the browser.
 *
 * WHAT THIS MODULE IS: the NMC PG e-logbook required by PGMER-2023 §5.2(vi)-(vii). It holds records
 * that a University examiner may rely on and whose falsification carries a statutory penalty on a
 * NAMED person (PGMER-2023 §9.2(c)). That is why the audit/immutability behaviour is NOT behind a
 * flag - there is no configuration in which a verified record may be silently overwritten.
 *
 * PUBLIC-RELEASE-GATE: smd_pglog defaults ON for the same reason clinix/surgx do - the app ships
 * today only to the owner and testers, and gating it off would only cost testers time. Every
 * regulatory surface carries its own provenance line (which NMC clause, which curriculum PDF), so
 * nothing claims an authority it does not have. Review before a non-tester release.
 *
 * THE FLAG THAT MUST NEVER SHIP ON: smd_pglog_demo. It seeds FABRICATED residents, entries and
 * verifications into the local store so the dashboards can be demonstrated. In a module whose whole
 * purpose is an auditable official record, fabricated verified entries are the single most dangerous
 * switch here. It is local-only (the server never accepts a demo write) and OFF by default.
 */
(function () {
  "use strict";

  // type: bool | int | tri (true/false/null) | enum. def: default when unset. query: ?alias (or null).
  var DEFS = {
    smd_pglog: {
      type: "bool", def: true, query: "pglog",
      desc: "NMC Logbook master flag (home tile + module). ON for testers; the app ships only to " +
        "the owner and testers today. Flag off must be a COMPLETE no-op - no root, no fetch, no CSS."
    },
    smd_pglog_server: {
      type: "bool", def: true, query: "pglogserver",
      desc: "Sync with /api/pglog. OFF = the logbook works entirely on-device (drafts + local " +
        "progress) and nothing is ever submitted for verification. Useful offline and for a " +
        "resident evaluating the module before their institution is onboarded."
    },
    smd_pglog_ai: {
      type: "bool", def: true, query: "pglogai",
      desc: "MaiK assist: suggest which training requirement an activity maps to, draft a progress " +
        "summary, draft a faculty review. ADVISORY ONLY - no AI path creates an entry, marks a " +
        "competency complete, or verifies anything (see NMC_PG_LOGBOOK_REQUIREMENTS.md section 6). " +
        "Off = the deterministic keyword matcher only, which is what actually maps requirements."
    },
    smd_pglog_faculty: {
      type: "bool", def: true, query: "pglogfaculty",
      desc: "Faculty / HOD / Academic-Cell dashboards. Additionally gated server-side by the " +
        "PGLOG_VERIFY / PGLOG_VIEW_DEPT / PGLOG_VIEW_INSTITUTION caps - this flag only controls " +
        "whether the surface is OFFERED, never whether the caller holds the capability."
    },
    smd_pglog_attendance: {
      type: "bool", def: true, query: "pglogattendance",
      desc: "Attendance / training-participation records (PGMER-2023 section 5.5). The 80% is the gazette's; " +
        "the PGMEB FAQ of 10.04.2024 (obtained 2026-08-27, PRIMARY) defines what it is a percentage OF - " +
        "WORKING days, i.e. calendar days minus 52 weekly offs a year. WHICH days count is institutional " +
        "and is labelled as such."
    },
    smd_pglog_certify: {
      type: "bool", def: true, query: "pglogcertify",
      desc: "Certification: collect the signatures a completed logbook needs, freeze what was signed, " +
        "and export a verifiable PDF a college / University / the NMC can check by QR. The signature " +
        "COUNT is institutional policy (default 2 faculty + 1 HoD, the HoD counting toward both); the " +
        "requirement that the HEAD OF DEPARTMENT signs the completed log book comes from the NMC " +
        "specialty curricula, and the document says which is which. Flag OFF = no certification " +
        "surface at all; the ordinary reports still export, still stamped as uncertified drafts."
    },
    smd_pglog_reports: {
      type: "bool", def: true, query: "pglogreports",
      desc: "Report + export surface (individual logbook, rotation, procedure, academic, assessment, " +
        "research, progress, department summary, final portfolio). Reports retain verification and " +
        "audit information; patient-identifiable case references are withheld from every " +
        "cross-resident report (see requirements doc section 5)."
    },
    smd_pglog_demo: {
      type: "bool", def: false, query: "pglogdemo",
      desc: "NEVER SHIP ON. Seeds FABRICATED residents, logbook entries and verifications into the " +
        "LOCAL store so the dashboards can be demonstrated with no institution. Fabricated verified " +
        "records in an official training logbook are exactly what PGMER-2023 section 9.2(c) " +
        "penalises. Local-only: the server rejects any write carrying the demo marker."
    },
    // Institutional policy values. These are NOT NMC requirements; they are the module's defaults for
    // things NMC leaves to the institution, and the Academic Cell overrides them per programme.
    smd_pglog_verify_sla_days: {
      type: "int", def: 7, query: "pglogsla",
      desc: "CONFIG (not NMC): days after submission before a pending verification is called overdue. " +
        "NMC gives exactly one cadence - monthly guide authentication, section 5.2(vii) - and no " +
        "per-entry SLA. This is institutional policy and is labelled as such in the UI."
    },
    smd_pglog_attest_grace_days: {
      type: "int", def: 7, query: "pglogattestgrace",
      desc: "CONFIG (not NMC): days after a calendar month closes before its missing guide " +
        "authentication (section 5.2(vii)) is called overdue."
    }
  };

  function store() { try { return localStorage; } catch (e) { return null; } }
  function search() { try { return (location && location.search) || ""; } catch (e) { return ""; } }

  function rawQuery(alias) {
    if (!alias) return null;
    var m = search().match(new RegExp("[?&]" + alias + "=([^&]+)"));
    return m ? decodeURIComponent(m[1]) : null;
  }

  function coerce(def, raw) {
    if (raw == null) return def.def;
    switch (def.type) {
      case "bool": return raw === "1" || raw === "on" || raw === "true";
      case "int": { var n = parseInt(raw, 10); return isNaN(n) ? def.def : n; }
      case "tri": return raw === "1" ? true : raw === "0" ? false : def.def;
      case "enum": return def.values && def.values.indexOf(raw) >= 0 ? raw : def.def;
      default: return raw;
    }
  }

  function get(key) {
    var def = DEFS[key]; if (!def) return null;
    var q = rawQuery(def.query); if (q != null) return coerce(def, q);   // ?query wins
    var s = store(); return coerce(def, s ? s.getItem(key) : null);
  }

  function set(key, val) {
    var def = DEFS[key], s = store(); if (!def || !s) return false;
    var out = def.type === "bool" ? (val ? "1" : "0")
      : def.type === "tri" ? (val === true ? "1" : val === false ? "0" : "")
      : String(val);
    try { s.setItem(key, out); return true; } catch (e) { return false; }
  }

  function all() {
    var o = {};
    for (var k in DEFS) { if (Object.prototype.hasOwnProperty.call(DEFS, k)) o[k] = get(k); }
    return o;
  }

  var API = {
    DEFS: DEFS, get: get, set: set, all: all,
    bool: function (k) { return !!get(k); },
    int: function (k) { var v = get(k); return typeof v === "number" ? v : (DEFS[k] ? DEFS[k].def : 0); }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_PGLOG_FLAGS = API;
})();
