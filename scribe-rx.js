/* StewardMD — MaiK Scribe: dictated treatment -> structured prescription rows.
 * ---------------------------------------------------------------------------
 * "tab pan 40 one before food for 5 days"  ->  one row per medicine.
 * Line parsing is delegated to the prescription pad's own SMD_RX._parseVoiceRx
 * (injected) so the pad and the scribe never drift apart on drug / freq / duration.
 *
 * NEVER INVENTS A DOSE. A field that was not spoken stays "". A drug the Drug Index
 * does not know comes back matched:false with generic:"" — the pad then flags it for
 * the prescriber instead of quietly filling a dose in. A bare number ("pan 40") is
 * recorded verbatim as the strength with NO unit added.
 *
 * parse(text, opts) -> { rows:[row], unparsed:[string] }
 *   row = { drug, generic, strength, dose, freq, duration, route, verbatim, matched }
 *   opts.parseLine = window.SMD_RX._parseVoiceRx   (injected; no parser -> all unparsed)
 *   opts.drugs     = window.MEDDRUGS._list         (injected; for the generic name)
 *
 * toRegimen(rows) -> [{ name, dose?, freq?, duration?, source? }]
 *   The exact shape SMD_RX.open({regimen}) / rx-build.buildRxLines() consumes.
 *   A spoken dose is passed with source:"ai", which is the ONLY value buildRxLines maps
 *   to unverified:true — a dictated dose must be read back and confirmed before signing
 *   (speech recognition turns 40 into 14). A row with no spoken dose carries no dose at
 *   all, so the Drug Index supplies its own verified adult dose instead.
 *
 * Clinical limit left in place: route is set only when a route was actually spoken.
 * A form word (tab / syp / inj) is NOT read as a route — an "inj" can be IV, IM or SC.
 *
 * window.SMD_SCRIBERX + module.exports (Node-testable).
 */
(function (root) {
  "use strict";

  var FORM = "tab|tabs|tablet|tablets|cap|caps|capsule|capsules|syp|syr|syrup|inj|injection|" +
             "susp|suspension|drops|ointment|cream|lotion|neb|nebulisation|nebulization|sachet|puff";
  var FORM_LEAD = new RegExp("^\\s*(?:" + FORM + ")\\b\\s*", "i");
  var FORM_SPLIT = new RegExp("(?=\\b(?:" + FORM + ")\\b)", "i");

  var DURATION = /\b(?:x\s*)?\d+(?:\.\d+)?\s*(?:days?|weeks?|wks?|months?|mos?|hours?|hrs?)\b/gi;
  var MASS = /(\d+(?:\.\d+)?)\s*(mg|mcg|g|gm|iu)\b/i;
  var AMOUNT = /(\d+(?:\.\d+)?)\s*(ml|mls|drops?|puffs?|tabs?|tablets?|caps?|capsules?|units?|sachets?)\b/i;
  var WORD_AMOUNT = /\b(one\s+and\s+a\s+half|half|one|two|three|four)\b(?!\s*(?:days?|weeks?|months?|hours?|times?))/i;
  var BARE = /(?:^|[^\w.])(\d+(?:\.\d+)?)(?![\w.])/;
  var ROUTES = [
    [/\b(?:iv|intravenous(?:ly)?)\b/i, "IV"],
    [/\b(?:im|intramuscular(?:ly)?)\b/i, "IM"],
    [/\b(?:s\/c|sc|subcutaneous(?:ly)?)\b/i, "SC"],
    [/\b(?:sl|sub\s*lingual(?:ly)?|sublingual(?:ly)?)\b/i, "SL"],
    [/\b(?:po|per\s*oral(?:ly)?|oral(?:ly)?|by\s+mouth)\b/i, "PO"],
    [/\b(?:pr|per\s*rectal(?:ly)?|rectal(?:ly)?)\b/i, "PR"],
    [/\b(?:topical(?:ly)?|local(?:ly)?)\b/i, "TOP"],
    [/\b(?:inhaled|inhalation|nebulised|nebulized|nebulisation|nebulization)\b/i, "INH"]
  ];

  function norm(s) { return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]/g, ""); }

  function splitLines(text) {
    var out = [];
    String(text == null ? "" : text).split(/[\n;]+|\bthen\b/i).forEach(function (chunk) {
      chunk.split(FORM_SPLIT).forEach(function (piece) {
        var s = String(piece).trim().replace(/^[,.\-•\s]+|[,.\s]+$/g, "");
        if (s) out.push(s);
      });
    });
    return out;
  }

  /* normalized name -> Drug Index entry; null when a class alias is claimed by 2 generics. */
  function buildIndex(drugs) {
    var map = {};
    (drugs || []).forEach(function (d) {
      if (!d || !d.generic) return;
      var g = norm(d.generic);
      if (!map[g]) map[g] = d;
      (d.brands || []).forEach(function (b) {
        var k = norm(b);
        if (!k) return;
        if (!Object.prototype.hasOwnProperty.call(map, k)) map[k] = d;
        else if (map[k] && map[k] !== d) map[k] = null;
      });
    });
    return map;
  }

  function route(line) {
    for (var i = 0; i < ROUTES.length; i++) if (ROUTES[i][0].test(line)) return ROUTES[i][1];
    return "";
  }

  /* Strength = product strength (40 mg). Dose = what the patient takes (5 ml, one).
   * Duration numbers are removed first so "for 5 days" never becomes a dose. */
  function amounts(line) {
    var core = String(line).replace(DURATION, " ");
    var strength = "", dose = "", m;
    if ((m = core.match(MASS))) { strength = m[1] + " " + m[2].toLowerCase(); core = core.replace(m[0], " "); }
    if ((m = core.match(AMOUNT))) { dose = m[1] + " " + m[2].toLowerCase(); core = core.replace(m[0], " "); }
    else if ((m = core.match(WORD_AMOUNT))) { dose = m[1].toLowerCase(); core = core.replace(m[0], " "); }
    if (!strength && (m = core.match(BARE))) strength = m[1];   // "pan 40" — verbatim, no unit invented
    return { strength: strength, dose: dose };
  }

  function parse(text, opts) {
    opts = opts || {};
    var parseLine = opts.parseLine;
    var index = buildIndex(opts.drugs);
    var rows = [], unparsed = [];

    splitLines(text).forEach(function (line) {
      var bare = line.replace(FORM_LEAD, "").trim();
      if (!bare) return;
      var p = null;
      if (typeof parseLine === "function") { try { p = parseLine(bare); } catch (e) { p = null; } }
      var name = String((p && p.drug) || "").trim();
      if (!name || /^\d/.test(name)) { unparsed.push(line); return; }

      var entry = index[norm(name)] || null;
      var a = amounts(line);
      rows.push({
        drug: name,
        generic: entry ? entry.generic : "",
        strength: a.strength,
        dose: a.dose,
        freq: String((p && p.freq) || "").trim(),
        duration: String((p && p.duration) || "").trim(),
        route: route(line),
        verbatim: line,
        matched: !!entry
      });
    });

    return { rows: rows, unparsed: unparsed };
  }

  function toRegimen(rows) {
    return (rows || []).filter(Boolean).map(function (r) {
      var dose = [r.strength, r.dose].filter(Boolean).join(", ");
      var o = { name: r.generic || r.drug };
      if (dose) { o.dose = dose; o.source = "ai"; }   // dictated -> pad flags "confirm before signing"
      if (r.freq) o.freq = r.freq;
      if (r.duration) o.duration = r.duration;
      return o;
    });
  }

  var API = { parse: parse, toRegimen: toRegimen, _version: "1.0" };
  if (root) root.SMD_SCRIBERX = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : null);
