/* surgx-evidence.js — SURGX · evidence + citation resolver.
 * ===========================================================================
 * Three layers, in order of trust and of availability. Nothing here writes content; it only
 * resolves what a protocol, procedure or case already carries into something a screen can show.
 *
 *   1. AUTHORED SOURCES (offline, always)   — every protocol/procedure/case carries sources[]
 *      with org, title, edition, year, version, url, accessed. This is the layer that makes a
 *      recommendation traceable, and it works on a phone with no signal at 3am.
 *
 *   2. THE EVIDENCE INDEX (offline, bundled) — surgx/evidence/index.json: a small curated set of
 *      surgical guideline records. Each carries our OWN one-paragraph explanation plus a pointer
 *      to the authoritative document. It NEVER reproduces a guideline's recommendation tables,
 *      algorithms or figures: summarising a recommendation in our own words with attribution is
 *      ordinary scholarly use; reproducing the artefact is not ours to do. `validateRecord()`
 *      enforces the shape (originalSummary required, no `verbatim` field permitted).
 *
 *   3. LIVE LITERATURE (network, on explicit tap only) — SMD_AI.research(q, "evidence-review"),
 *      the endpoint MaiK's Research Mode already uses: 2/day, 7-day KV cache, returns sources[].
 *      SURGX adds no new AI system and no new cap; it reuses that one, including its own
 *      "trusted literature, verify independently" framing.
 *
 * WHY NOT kb/reference/* AT RUNTIME: those 4,664 Harrison-cited records are 38 MB and are
 * deliberately NOT copied into www/ by scripts/build-www.sh, so they do not exist on a device.
 * They remain the AUTHORING source for layer 2 (a `kbRef` on a record names the reference entry a
 * summary was drafted against, so an author can find it again), and a build-time extraction into
 * surgx/evidence/ is the documented way to grow this without shipping 38 MB.
 *
 * window.SMD_SURGX_EVIDENCE + module.exports (the pure parts are node-testable).
 */
(function () {
  "use strict";

  var G = typeof window !== "undefined" ? window : null;
  var BASE = "/surgx/";

  // The model in the browser is a global; under node (tests) it is a sibling CommonJS module.
  // Resolved lazily and cached so the browser path never touches require().
  var _M = null;
  function M() {
    if (_M) return _M;
    try { if (G && G.SMD_SURGX_MODEL) { _M = G.SMD_SURGX_MODEL; return _M; } } catch (e) {}
    try { if (typeof require === "function") { _M = require("./surgx-model.js"); return _M; } } catch (e) {}
    return null;
  }
  function C() { try { return G && G.SMD_SURGX_CONTENT; } catch (e) { return null; } }

  function isObj(v) { return !!v && typeof v === "object" && !(v instanceof Array); }
  function isStr(v) { return typeof v === "string" && v.trim().length > 0; }
  function arr(v) { return (v instanceof Array) ? v : []; }
  function str(v) { return typeof v === "string" ? v : ""; }

  /* ── layer 1 + 2: record validation ──────────────────────────────────────── */

  /* An evidence record is our explanation OF a source, never a copy of it. */
  function validateRecord(r) {
    var e = [];
    if (!isObj(r)) return { ok: false, errors: ["evidence: not an object"] };
    if (!isStr(r.id)) e.push("evidence.id required");
    if (!isStr(r.title)) e.push("evidence.title required (" + str(r.id) + ")");
    if (!isStr(r.originalSummary)) {
      e.push("evidence.originalSummary required - an ORIGINAL explanation in our own words (" + str(r.id) + ")");
    }
    if (r.verbatim != null) {
      e.push("evidence.verbatim is not permitted - do not reproduce guideline text (" + str(r.id) + ")");
    }
    var mdl = M();
    if (!mdl || !mdl.isSource(r.source)) {
      e.push("evidence.source needs org + title + year, no placeholders (" + str(r.id) + ")");
    }
    if (r.source && r.source.url && !/^https?:\/\//i.test(String(r.source.url))) {
      e.push("evidence.source.url must be absolute http(s) (" + str(r.id) + ")");
    }
    return { ok: !e.length, errors: e };
  }

  /* ── the offline evidence index ──────────────────────────────────────────── */

  var _index = null;

  function loadIndex() {
    if (_index) return Promise.resolve(_index);
    if (!G || !G.fetch) return Promise.resolve([]);
    var cc = C();
    var pre = cc ? cc.loadCatalog() : Promise.resolve(null);
    return pre.then(function (cat) {
      var v = (cat && cat.contentVersion) || "";
      return G.fetch(BASE + "evidence/index.json" + (v ? "?v=" + encodeURIComponent(v) : ""))
        .then(function (r) { return (r && r.ok) ? r.json() : null; })
        .then(function (j) {
          var list = arr(j && j.records).filter(function (r) { return validateRecord(r).ok; });
          _index = list;
          return list;
        })
        .catch(function () { _index = []; return _index; });
    });
  }

  function byId(id) {
    return loadIndex().then(function (list) {
      for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
      return null;
    });
  }

  /* Records whose `topics` intersect the given topic list, most specific first. Used to hang an
   * Evidence panel off a protocol or procedure without either side hard-coding the other. */
  function forTopics(topics) {
    var want = arr(topics).map(function (t) { return String(t).toLowerCase(); });
    if (!want.length) return Promise.resolve([]);
    return loadIndex().then(function (list) {
      return list.map(function (r) {
        var have = arr(r.topics).map(function (t) { return String(t).toLowerCase(); });
        var hits = 0;
        want.forEach(function (w) { if (have.indexOf(w) >= 0) hits++; });
        return { r: r, hits: hits };
      }).filter(function (x) { return x.hits > 0; })
        .sort(function (a, b) { return b.hits - a.hits; })
        .map(function (x) { return x.r; });
    });
  }

  function categories() {
    return loadIndex().then(function (list) {
      var seen = {}, out = [];
      list.forEach(function (r) {
        var c = str(r.category) || "general";
        if (!seen[c]) { seen[c] = 1; out.push(c); }
      });
      out.sort();
      return out;
    });
  }

  function search(q) {
    var needle = String(q || "").trim().toLowerCase();
    if (needle.length < 2) return Promise.resolve([]);
    return loadIndex().then(function (list) {
      return list.filter(function (r) {
        var hay = [r.title, r.originalSummary, str(r.source && r.source.org), arr(r.topics).join(" ")].join(" ").toLowerCase();
        return hay.indexOf(needle) >= 0;
      });
    });
  }

  /* ── citation formatting (pure) ──────────────────────────────────────────── */

  /* One line a clinician can act on: who said it, in what document, when, and which version.
   * `accessed` is included when present because a guideline URL that has since moved is still
   * traceable if we say when we read it. */
  function citation(source) {
    var mdl = M();
    if (!isObj(source)) return "";
    if (source.inline) return str(source.org);            // engine-carried reference string
    var base = mdl ? mdl.sourceLabel(source) : (str(source.org) + " · " + str(source.title));
    var acc = str(source.accessed) ? " · accessed " + str(source.accessed) : "";
    return base + acc;
  }

  /* Currency of a whole compiled protocol/procedure: the OLDEST source year plus whether its own
   * review is overdue. Surfaced as an amber chip, because guideline staleness is a clinical hazard
   * and it should be visible rather than silent. `todayISO` is injected so this stays pure. */
  function currency(compiled, todayISO) {
    var mdl = M();
    var years = arr(compiled && compiled.sources).map(function (s) {
      var y = s && s.year;
      if (typeof y === "string") y = parseInt(y, 10);
      return (typeof y === "number" && isFinite(y)) ? y : null;
    }).filter(function (y) { return y != null; });
    var oldest = years.length ? Math.min.apply(null, years) : null;
    var newest = years.length ? Math.max.apply(null, years) : null;
    var age = mdl ? mdl.reviewAge(compiled || {}, todayISO) : { known: false, overdue: false, due: "" };
    return { oldest: oldest, newest: newest, count: years.length, overdue: age.overdue, due: age.due, known: age.known };
  }

  /* ── layer 3: live literature (explicit tap only) ────────────────────────── */

  /* Reuses MaiK Research Mode verbatim. Never called automatically: an evidence review costs the
   * clinician one of two daily slots, so it is always a deliberate act.
   * Resolves { ok, text, sources, usage, cached } or { ok:false, reason }. */
  function reviewLiterature(question) {
    try {
      if (!G || !G.SMD_AI || typeof G.SMD_AI.research !== "function") {
        return Promise.resolve({ ok: false, reason: "unavailable" });
      }
      return G.SMD_AI.research(String(question || "").slice(0, 300), "evidence-review", [])
        .then(function (r) {
          if (!r) return { ok: false, reason: "unavailable" };
          if (r.over) return { ok: false, reason: "quota", message: r.message };
          if (!r.text) return { ok: false, reason: r.reason || "empty" };
          return { ok: true, text: String(r.text), sources: arr(r.sources), usage: r.usage || null, cached: !!r.cached };
        })
        .catch(function () { return { ok: false, reason: "network" }; });
    } catch (e) { return Promise.resolve({ ok: false, reason: "unavailable" }); }
  }

  function reset() { _index = null; }

  var API = {
    validateRecord: validateRecord,
    loadIndex: loadIndex, byId: byId, forTopics: forTopics, categories: categories, search: search,
    citation: citation, currency: currency,
    reviewLiterature: reviewLiterature,
    reset: reset
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (G) G.SMD_SURGX_EVIDENCE = API;
})();
