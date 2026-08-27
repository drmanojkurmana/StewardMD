/* pglog-curriculum.js — NMC Logbook · curriculum pack registry, resolution and requirement mapping.
 * ===========================================================================
 * A "pack" is pglog/curricula/<specialty>.json: a specialty's NMC requirements, each carrying its
 * source PDF, its clause and a verbatim quote. Packs are DATA, not code - adding a 16th specialty is
 * a JSON file. Regenerate them with scripts/build-pglog-curricula.mjs; the generator is the place a
 * new quotation is added, so a requirement can never appear without one.
 *
 * THREE JOBS
 *   1. load()      - fetch + cache a pack and the common packs it extends, resolve into one list
 *   2. resolve()   - filter that list to the resident's degree, and merge institutional overrides
 *   3. suggestRequirements() - map a just-logged activity to the requirement(s) it satisfies
 *
 * (3) IS DELIBERATELY DETERMINISTIC. It is a scored keyword/field matcher, not a model call. The
 * AI second-opinion lives in pglog-ai.js and can only PROPOSE from this same resolved list - it
 * cannot mint a requirement id. See NMC_PG_LOGBOOK_REQUIREMENTS.md section 6.
 *
 * PROVENANCE IS NOT DECORATION. Every resolved requirement keeps { source, clause, quote }, and the
 * UI renders `source` as a visible grade: nmc_regulation / nmc_curriculum / nmc_faq_secondary /
 * institution / unspecified. An institutional target must never look like an NMC one.
 *
 * Dual export: module.exports (node tests) + window.SMD_PGLOG_CURRICULUM.
 */
(function () {
  "use strict";

  var BASE = "/pglog/curricula/";
  var TEMPLATES_URL = "/pglog/assessment-templates.json";
  var cache = {};          // packId -> pack
  var templateCache = null;

  function G() { return typeof window !== "undefined" ? window : null; }
  function arr(x) { return Array.isArray(x) ? x : []; }
  function s(v) { return v == null ? "" : String(v); }
  function low(v) { return s(v).toLowerCase(); }

  /* ── loading ─────────────────────────────────────────────────────────────────
   * Native builds ship these under the bundle root; on web they are served from the repo root. The
   * same relative URL works for both, matching how kb/protocols and pglog siblings are copied by
   * scripts/build-www.sh. */
  function fetchJson(url) {
    var g = G();
    if (!g || !g.fetch) return Promise.reject(new Error("no_fetch"));
    return g.fetch(url, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error("pack_http_" + r.status);
      return r.json();
    });
  }

  function loadPack(id) {
    id = s(id) || "generic-pg";
    if (cache[id]) return Promise.resolve(cache[id]);
    return fetchJson(BASE + encodeURIComponent(id) + ".json").then(function (p) {
      cache[id] = p; return p;
    });
  }

  // Load a pack plus everything it extends, and flatten. Extended packs come FIRST so a specialty
  // requirement of the same id overrides the common one rather than being shadowed by it.
  function load(id) {
    return loadPack(id).then(function (pack) {
      var ext = arr(pack.extends);
      if (!ext.length) return flatten([], pack);
      return Promise.all(ext.map(loadPack)).then(function (commons) { return flatten(commons, pack); });
    });
  }

  function flatten(commons, pack) {
    var byId = {}, order = [];
    function add(r, fromPack) {
      if (!r || !r.id) return;
      var copy = JSON.parse(JSON.stringify(r));
      copy.packId = fromPack.id;
      copy.packLabel = fromPack.label || fromPack.specialty || fromPack.id;
      copy.packSource = fromPack.source || null;
      if (!byId[copy.id]) order.push(copy.id);
      byId[copy.id] = copy;
    }
    arr(commons).forEach(function (c) { arr(c.requirements).forEach(function (r) { add(r, c); }); });
    arr(pack.requirements).forEach(function (r) { add(r, pack); });
    // Procedures become requirements of kind "procedure" matched on procedureId. This is what makes
    // "Tracheal intubation (100)" a progress row without a second engine.
    arr(pack.procedures).forEach(function (p) {
      add({
        id: p.id, kind: "procedure", label: p.label, target: p.target, per: p.per || "course",
        match: { procedureId: p.id }, source: p.source, clause: p.clause, quote: p.quote,
        isProcedure: true
      }, pack);
    });
    return {
      id: pack.id,
      programmeType: pack.programmeType || "PG",
      degree: pack.degree || "",
      specialty: pack.specialty || "",
      durationMonths: pack.durationMonths || 36,
      version: pack.version || "",
      source: pack.source || null,
      banner: pack.banner || "",
      disclaimer: pack.disclaimer || "",
      proceduresNote: pack.proceduresNote || "",
      rotations: pack.rotations || null,
      logbookClause: (arr(commons).filter(function (c) { return c.logbookClause; })[0] || {}).logbookClause || null,
      requirements: order.map(function (k) { return byId[k]; }),
      procedureCatalog: arr(pack.procedures)
    };
  }

  /* ── resolution ──────────────────────────────────────────────────────────────
   * Filter to what actually applies to THIS resident, and layer institutional configuration on top.
   * An institutional override may only change `target`; it can never rewrite the label, source,
   * clause or quote - otherwise a department could relabel its own target as an NMC requirement. */
  function resolve(pack, opts) {
    opts = opts || {};
    var degree = s(opts.degree);
    var overrides = opts.overrides || {};
    var out = [];
    arr(pack && pack.requirements).forEach(function (r) {
      if (arr(r.appliesToDegrees).length && degree && arr(r.appliesToDegrees).indexOf(degree) < 0) return;
      var o = overrides[r.id];
      var req = JSON.parse(JSON.stringify(r));
      if (o && o.target !== undefined) {
        // Institutional target. If NMC gave one and the institution differs, BOTH are kept and shown.
        req.nmcTarget = r.target;
        req.target = o.target === null ? null : Number(o.target);
        req.per = o.per || req.per;
        req.targetSource = "institution";
        req.institutionNote = s(o.note).slice(0, 300);
      } else if (r.target == null) {
        req.targetSource = "unspecified";
      } else {
        req.targetSource = r.source || "unspecified";
      }
      if (o && o.hidden) return;                      // an Academic Cell may hide a requirement it does not run
      req.dueAt = dueDate(req, opts.startDate);
      out.push(req);
    });
    return out;
  }

  function dueDate(req, startDate) {
    if (!req || !req.dueByMonths || !startDate) return "";
    var M = model();
    return M ? M.addMonths(startDate, req.dueByMonths) : "";
  }
  function model() {
    try { return (G() && G().SMD_PGLOG_MODEL) || (typeof require === "function" ? require("./pglog-model.js") : null); }
    catch (e) { return null; }
  }

  // The provenance grade a UI badge renders. Kept in ONE place so a new grade cannot be introduced
  // in a screen without being described here.
  var SOURCE_LABEL = {
    nmc_regulation: "PGMER-2023",
    nmc_curriculum: "NMC curriculum",
    nmc_faq_secondary: "PGMEB FAQ (secondary)",
    institution: "Institutional policy",
    unspecified: "No NMC number"
  };
  function sourceLabel(src) { return SOURCE_LABEL[s(src)] || "Unspecified"; }
  function isNmc(src) { return s(src).indexOf("nmc_") === 0; }

  /* ── requirement suggestion (deterministic) ──────────────────────────────────
   * Score each candidate requirement against the entry. Field agreement is worth far more than a
   * word overlap, because a field is a fact and a word is a coincidence. Returns the top matches
   * with a `why`, so the resident is told WHY something was suggested and can refuse it - a silent
   * auto-tag on a regulatory record is not acceptable. */
  var STOP = { the: 1, a: 1, an: 1, of: 1, and: 1, for: 1, with: 1, in: 1, on: 1, to: 1, by: 1, "": 1 };
  function tokens(str) {
    return low(str).replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(function (w) { return w.length > 2 && !STOP[w]; });
  }
  function overlap(a, b) {
    var set = {}, n = 0;
    a.forEach(function (w) { set[w] = 1; });
    b.forEach(function (w) { if (set[w]) n++; });
    return n;
  }

  function suggestRequirements(e, requirements, opts) {
    opts = opts || {};
    var limit = opts.limit || 4;
    var eTok = tokens([e && e.title, e && e.topic, e && e.procedureText, e && e.diagnosis, e && e.category].join(" "));
    var out = [];
    arr(requirements).forEach(function (r) {
      if (!e || !r) return;
      if (r.kind && r.kind !== "meta" && r.kind !== e.kind) return;
      var score = 0, why = [];
      var m = r.match || {};
      if (m.procedureId && e.procedureId && m.procedureId === e.procedureId) { score += 100; why.push("same procedure"); }
      if (m.academicType && e.academicType && m.academicType === e.academicType) { score += 60; why.push("activity type"); }
      if (m.subtype && e.subtype && m.subtype === e.subtype) { score += 60; why.push("record type"); }
      if (m.setting && e.setting && m.setting === e.setting) { score += 30; why.push("setting"); }
      if (m.scope && e.scope && m.scope === e.scope) { score += 15; why.push("scope"); }
      if (arr(m.roles).length && e.role && arr(m.roles).indexOf(e.role) > -1) { score += 10; why.push("your role"); }
      var ov = overlap(eTok, tokens(r.label));
      if (ov) { score += ov * 8; why.push(ov === 1 ? "wording" : "wording (" + ov + " terms)"); }
      // An unmet requirement is more useful to suggest than one already satisfied - but only as a
      // tiebreak, never enough on its own to surface an unrelated requirement.
      if (opts.unmet && opts.unmet[r.id]) score += 5;
      if (score < 20) return;
      out.push({ id: r.id, label: r.label, score: score, why: why.join(", "), source: r.source, clause: r.clause });
    });
    return out.sort(function (a, b) { return b.score - a.score; }).slice(0, limit);
  }

  /* ── procedure catalog search (the quick-add's first field) ─────────────────── */
  function searchProcedures(pack, q, limit) {
    var t = tokens(q), all = arr(pack && pack.procedureCatalog);
    if (!t.length) return all.slice(0, limit || 20);
    return all.map(function (p) { return { p: p, n: overlap(t, tokens(p.label)) }; })
      .filter(function (x) { return x.n > 0 || low(x.p.label).indexOf(low(q)) > -1; })
      .sort(function (a, b) { return b.n - a.n; })
      .slice(0, limit || 20)
      .map(function (x) { return x.p; });
  }

  /* ── assessment templates ────────────────────────────────────────────────── */
  function loadTemplates() {
    if (templateCache) return Promise.resolve(templateCache);
    return fetchJson(TEMPLATES_URL).then(function (t) { templateCache = t; return t; });
  }
  function template(bundle, id) {
    return arr(bundle && bundle.templates).filter(function (t) { return t.id === id; })[0] || null;
  }
  function templatesFor(bundle, appliesTo) {
    return arr(bundle && bundle.templates).filter(function (t) { return t.appliesTo === appliesTo; });
  }

  /* ── index (the specialty picker) ────────────────────────────────────────── */
  var indexCache = null;
  function loadIndex() {
    if (indexCache) return Promise.resolve(indexCache);
    return fetchJson(BASE + "index.json").then(function (i) { indexCache = i; return i; });
  }

  // Test seam: node tests inject already-parsed packs instead of fetching.
  function seed(id, pack) { cache[s(id)] = pack; }
  function seedTemplates(t) { templateCache = t; }
  function seedIndex(i) { indexCache = i; }
  function clearCache() { cache = {}; templateCache = null; indexCache = null; }

  var API = {
    BASE: BASE,
    load: load, loadPack: loadPack, loadIndex: loadIndex, flatten: flatten,
    resolve: resolve, dueDate: dueDate,
    sourceLabel: sourceLabel, isNmc: isNmc, SOURCE_LABEL: SOURCE_LABEL,
    suggestRequirements: suggestRequirements, searchProcedures: searchProcedures,
    loadTemplates: loadTemplates, template: template, templatesFor: templatesFor,
    tokens: tokens,
    seed: seed, seedTemplates: seedTemplates, seedIndex: seedIndex, clearCache: clearCache
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_PGLOG_CURRICULUM = API;
})();
