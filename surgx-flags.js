/* surgx-flags.js — SURGX (SURGˣ · Surgical Intelligence) · flag registry.
 * Sibling of clinix-flags.js / thorex-flags.js / sknx-flags.js.
 *
 * BRAND vs IDENTIFIER: the product is "SURGˣ". Every identifier in code, storage, routes and
 * content keys is the ASCII-safe "surgx" / "SURGX". The superscript character appears in
 * user-facing strings ONLY. Do not introduce it into a key, a flag name or a filename.
 *
 * Resolution order: ?query param -> localStorage -> default. Persistence is localStorage only.
 * Dual export: module.exports for node tests, window.SMD_SURGX_FLAGS for the browser.
 *
 * PUBLIC-RELEASE-GATE: smd_surgx is the master flag. It defaults ON because the app is currently
 * distributed only to the owner and testers (the same owner decision recorded in clinix-flags.js
 * on 2026-08-23) - gating it off would only cost testers time, and every screen carries its own
 * provenance and draft state, so nothing claims to be approved that is not.
 * FLIP smd_surgx AND smd_surgx_draft TO false BEFORE ANY NON-TESTER RELEASE.
 *
 * smd_surgx_draft is the flag that matters for safety: with it OFF, the runtime refuses to render
 * any content object whose review.status is not approved/published. The authored SURGX protocols,
 * procedures and cases are currently "ai_drafted" pending R1 clinical sign-off, so the draft flag
 * is how an author or tester sees them at all.
 */
(function () {
  "use strict";

  // type: bool | int | tri (true/false/null) | enum. def: default when unset. query: ?alias (or null).
  var DEFS = {
    smd_surgx: {
      type: "bool", def: true, query: "surgx",
      desc: "SURGX (Surgical Intelligence) master flag. ON for testers; the app ships only to the " +
        "owner and testers today. Flag off must be a COMPLETE no-op."
    },
    smd_surgx_draft: {
      type: "bool", def: true, query: "surgxdraft",
      desc: "Render content that is not clinician-approved. ON by default because the authored " +
        "SURGX content is ai_drafted; with it off every section reads 'Awaiting clinical review'. " +
        "Every screen still shows its own draft line and its sources. Set to 0 before release."
    },
    smd_surgx_notes: {
      type: "bool", def: true, query: "surgxnotes",
      desc: "Surgical Notes section. Additionally gated at runtime to clinician roles " +
        "(surgx-entitlement.js) - a student never reaches an operative-note authoring surface."
    },
    smd_surgx_mentor: {
      type: "bool", def: false, query: "surgxmentor",
      desc: "Senior Surgeon Mode: MaiK challenge turns inside a case (Phase 2). Off = the case " +
        "runs entirely on its authored reasoning, which is the default and fully playable."
    },
    smd_surgx_uncleared_media: {
      type: "bool", def: false, query: "surgxmedia",
      desc: "Authoring escape hatch: render media whose licence is not cleared. NEVER ship on."
    },
    smd_surgx_haptics: {
      type: "bool", def: true, query: "surgxhaptics",
      desc: "Haptic feedback on protocol band reveal and note field confirmation (native only)."
    },
    smd_surgx_notes_verify: {
      type: "bool", def: false, query: "surgxnotesverify",
      desc: "Require a VERIFIED medical registration to author Surgical Notes. OFF by owner " +
        "decision (2026-08-25): a note is the surgeon's own record of what they did, not an order " +
        "acting on a patient, so it does not need the prescribing gate. Set to 1 to restore the " +
        "gate without a rebuild. SURGX still exposes no prescription affordance at all, and the " +
        "EMR write-back stays gated separately (QUEUE_EMR_WRITE + a live GHIS session)."
    },
    smd_surgx_dest_drive: {
      type: "bool", def: true, query: "surgxdrive",
      desc: "Offer 'Google Drive' as a save destination for a finalised note. Native only (the " +
        "drive.file token does not exist on web). The note is ALWAYS saved to the device first; " +
        "Drive is an export on top of that, never instead of it. Carries patient identifiers, so " +
        "it needs an explicit per-save confirmation."
    },
    smd_surgx_dest_emr: {
      type: "bool", def: true, query: "surgxemr",
      desc: "Offer 'Hospital EMR (GHIS)' as a save destination. Writes over the SAME verified " +
        "transport as the OPD EMR connect: appends the note to the Initial Assessment's " +
        "Management plan on the patient's own visit (never overwrites it). This flag only " +
        "controls whether the option is OFFERED - the write itself is still gated server-side by " +
        "QUEUE_EMR_WRITE, needs a GHIS session and a selected ward patient, and takes an explicit " +
        "second tap. It can never by itself cause a write to a live record."
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
  if (typeof window !== "undefined") window.SMD_SURGX_FLAGS = API;
})();
