/* clinix-flags.js — CliniX · flag registry. Sibling of thorex-flags.js / sknx-flags.js.
 *
 * NOTE (2026-08-23, owner decision): smd_clinix and smd_clinix_draft both default ON. The app is
 * distributed only to the owner and testers, so gating CliniX behind a flag only cost them time.
 * The per-lesson "Draft, pending clinician review" line and the source citations stay on every
 * screen, so nothing claims to be approved that is not. Flip both to false before wider release.
 *
 * Resolution order: ?query param -> localStorage -> default. Persistence is localStorage only.
 * Dual export: module.exports for node tests, window.SMD_CLINIX_FLAGS for the browser.
 *
 * PUBLIC-RELEASE-GATE: smd_clinix is the master flag. It is currently def:TRUE (owner decision,
 * 2026-08-23, recorded at the top of this file) because the app ships only to testers. Flag off
 * must be a COMPLETE no-op (clinix.js returns before touching DOM).
 *
 * smd_clinix_draft is the one that matters for safety: with it OFF the runtime refuses to render
 * any content object whose review.status is not approved/published. It is currently def:TRUE, so
 * unreviewed content DOES render today, badged "Draft, pending clinician review". That is
 * deliberate for testers and is the single flag that must be flipped to false before any public
 * release - do not read the default as a safety guarantee.
 */
(function () {
  "use strict";

  // type: bool | int | tri (true/false/null) | enum. def: default when unset. query: ?alias (or null).
  var DEFS = {
    smd_clinix: {
      type: "bool", def: true, query: "clinix",
      desc: "CliniX clinical-learning module master flag. ON by default: the app ships only to the " +
        "owner and testers, so CliniX is open to everyone who has it. Owner decision, 2026-08-23."
    },
    smd_clinix_draft: {
      type: "bool", def: true, query: "clinixdraft",
      desc: "Render content that is not clinician-approved. ON by default because ALL CliniX content " +
        "is currently ai_drafted, so with this off every pathway reads 'Awaiting clinical review' and " +
        "the module is unusable for testers. Every lesson still shows its own 'Draft, pending " +
        "clinician review' line and its sources. Set to 0 before any non-tester release."
    },
    smd_clinix_tutor: {
      type: "bool", def: true, query: "clinixtutor",
      desc: "MaiK tutor turns inside a lesson (Phase 2). Off = deterministic content only. " +
        "Turned ON by owner decision 2026-08-26: the feature is complete and read through the " +
        "registry, so the default is the only thing that was holding it back."
    },
    smd_clinix_haptics: {
      type: "bool", def: true, query: "clinixhaptics",
      desc: "Haptic feedback on lesson turns and answer checks (iOS native only)."
    },
    smd_clinix_uncleared_media: {
      type: "bool", def: false, query: "clinixmedia",
      desc: "Authoring escape hatch: render media whose licence is not cleared. NEVER ship on."
    },
    smd_clinix_viva_tier: {
      type: "enum", values: ["mbbs", "pg"], def: "mbbs", query: "clinixtier",
      desc: "Viva difficulty ceiling. mbbs = levels 1-3 (basics through bedside application). " +
        "pg = starts at level 2 and reaches level 4 (postgraduate). A student preference, not a flag " +
        "an author flips - persisted so it survives between viva sessions."
    },
    smd_clinix_viva_voice: {
      type: "bool", def: true, query: "clinixvoice",
      desc: "Spoken viva: MaiK speaks the question aloud (native TTS) and the student answers by " +
        "voice (on-device Whisper via SMD_VOICE, same STT already used by MaiK Ask - falls back to " +
        "the device's default on-device recognizer if Whisper is not built for this platform). " +
        "Off by default; a student opts in per device."
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
  if (typeof window !== "undefined") window.SMD_CLINIX_FLAGS = API;
})();
