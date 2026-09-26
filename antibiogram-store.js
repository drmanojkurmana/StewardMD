/* StewardMD - Antibiogram store (data layer for the Antibiogram screen, the Stewardship
 * console, syndrome reasoning and the hospital's own imported antibiogram).
 * ===========================================================================================
 * Loads kb/antibiogram/antibiogram.json (built by scripts/build-antibiogram.mjs from one file
 * per source; every cell carries the action antibiogram-rules.js gave it) and answers:
 *   scopes()                      what can be viewed: India pooled, regions, networks, each
 *                                 institution (latest edition), the hospital's own import
 *   table(scope, spec, set)       organism x drug matrix for a scope and stratum
 *   cell(scope, spec, set, org, pheno, drug)   one value with every contributing source
 *   phenotypes(scope, spec, set)  MRSA, 3rd-gen cephalosporin and carbapenem resistance, VRE
 *   wisca(scope, spec, set, regimen, opts)     estimated syndromic coverage of a regimen
 *   rank(scope, spec, set, opts)  single agents ranked by estimated coverage
 *   trend(inst, spec, set, org, pheno, drug)   the same cell across an institution's editions
 *   susceptibility(org, drug, ctx) the figure reasoning and the console show for a profile
 *   legacyAbg(scope, spec, set)   the {source, note, org:{name:{n, specimen, d}}} shape the
 *                                 older consumers read
 *   local*                        the hospital's own antibiogram, device-local only
 * Pooled figures are isolate-weighted means of the latest edition per institution, using only
 * cells that passed every check and rows with at least 30 isolates (CLSI M39). Network
 * reports are kept out of institution pools so the same isolates are not counted twice.
 * ======================================================================================== */
(function () {
  "use strict";
  var ABG_V = "cc41f16e01d7";
  var R = window.ABG_RULES;
  var ACT = { k: "keep", i: "intrinsic", h: "hide", x: "suppress", c: "caution" };
  var LOCAL_KEY = "smd_abg_local";
  var B = null, loading = null, subs = [];
  // Tables are recomputed from rows; reasoning asks for many cells at once, so results are
  // memoised per scope and stratum and dropped whenever the data changes.
  var memo = {};
  function clearMemo() { memo = {}; }

  /* ---------------------------------------------------------------- load --- */
  function expand(b) {
    var why = b.why || [];
    // ord: the data period's end as a number (2024.92 = December 2024), so half-yearly editions
    // order correctly; edLabel names an edition ("2024", or "2024 H1" when the year has several).
    var srcs = b.sources.map(function (s, i) { s.i = i; var e = String(s.end || (s.year + "-12")); s.ord = +e.slice(0, 4) + (+e.slice(5, 7) - 1) / 12; return s; });
    var perYear = {};
    srcs.forEach(function (s) { var k = s.inst + "|" + s.year; perYear[k] = (perYear[k] || 0) + 1; });
    srcs.forEach(function (s) { s.edLabel = String(s.year) + (perYear[s.inst + "|" + s.year] > 1 ? (+String(s.end).slice(5, 7) <= 6 ? " H1" : " H2") : ""); });
    // Latest edition per institution and per network (older editions stay reachable by "src:<id>").
    var latest = {};
    srcs.forEach(function (s) { if (!latest[s.inst] || s.ord > latest[s.inst].ord) latest[s.inst] = s; });
    srcs.forEach(function (s) { s.latest = latest[s.inst] === s; });
    var rows = b.rows.map(function (r) {
      var cells = {}, x = r[9] || {}, fromR = x.m === "R";
      Object.keys(r[6]).forEach(function (d) {
        var c = r[6][d];
        cells[d] = typeof c === "number" ? { s: c, act: "keep", nt: null, why: null, fromR: fromR } : { s: c[0], act: ACT[c[1]], nt: c[2] == null ? null : c[2], why: c[3] == null ? null : why[c[3]], fromR: fromR };
      });
      return { src: srcs[r[0]], spec: r[1], set: r[2], org: r[3], pheno: r[4], n: r[5], cells: cells, flags: r[7] || [], derived: !!r[8],
        as: x.as || null, q: x.q || null, trend: x.t || null, notes: x.no || null, page: x.p || null, how: x.d || null,
        measure: fromR ? "R" : "S", table: x.tb || null, cohort: x.co || null, note: x.nn || null, spAs: x.sp || null };
    });
    var counts = (b.counts || []).map(function (c) { return { src: srcs[c[0]], spec: c[1], set: c[2], org: c[3], n: c[4] }; });
    return { version: b.version, sources: srcs, rows: rows, counts: counts, register: b.register || [], census: b.census || null, stats: b.stats || {} };
  }
  function load() {
    if (B) return Promise.resolve(B);
    if (loading) return loading;
    if (typeof fetch !== "function") return Promise.reject(new Error("fetch unavailable"));
    loading = fetch("/kb/antibiogram/antibiogram.json?v=" + encodeURIComponent(ABG_V))
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (b) { B = expand(b); clearMemo(); addLocal(); fire(); return B; })
      .catch(function (e) { loading = null; throw e; });
    return loading;
  }
  function fire() {
    subs.slice().forEach(function (f) { try { f(B); } catch (e) {} });
    try { document.dispatchEvent(new CustomEvent("smd:abg-ready", { detail: { version: B && B.version } })); } catch (e) {}
  }
  function onReady(f) { if (B) { try { f(B); } catch (e) {} } else subs.push(f); }

  /* --------------------------------------------------------------- local --- */
  function localGet() { try { var t = localStorage.getItem(LOCAL_KEY); return t ? JSON.parse(t) : null; } catch (e) { return null; } }
  function localSave(obj) { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(obj)); } catch (e) { return false; } if (B) addLocal(); fire(); return true; }
  function localClear() { try { localStorage.removeItem(LOCAL_KEY); } catch (e) {} if (B) addLocal(); fire(); }
  function localRows(obj) {
    var src = { id: "LOCAL", kind: "local", inst: "LOCAL", name: obj.name || "My hospital", short: obj.name || "My hospital", region: obj.region || null, year: obj.year || null,
      period: obj.period || null, citation: "Imported on this device on " + (obj.imported || "").slice(0, 10), verification: { status: "local", note: "imported by you; checked with the same rules" },
      latest: true, local: true, method: obj.method || null, stats: obj.stats || null };
    var rows = (obj.rows || []).map(function (r) {
      var v = R.validateRow({ org: r.org, pheno: r.pheno || null, spec: r.spec, set: r.set, n: r.n, s: r.s || {}, nt: r.nt || {} });
      return { src: src, spec: r.spec, set: r.set, org: r.org, pheno: r.pheno || null, n: r.n, cells: v.cells, flags: v.flags, derived: false, as: null, q: null, trend: null, notes: null, page: null, how: null };
    });
    return { src: src, rows: rows };
  }
  function addLocal() {
    clearMemo();
    if (!B) return;
    B.sources = B.sources.filter(function (s) { return !s.local; });
    B.rows = B.rows.filter(function (r) { return !r.src.local; });
    var obj = localGet(); if (!obj || !obj.rows || !obj.rows.length) return;
    var l = localRows(obj); l.src.i = B.sources.length; B.sources.push(l.src); B.rows = B.rows.concat(l.rows);
  }

  /* -------------------------------------------------------------- scopes --- */
  var REGION_LABEL = { north: "North India", south: "South India", east: "East and North-East India", west: "West and Central India", national: "National" };
  /* Scope ids: "india", "region:north", "src:<ID>", "inst:<INST>" (latest edition), "local". */
  function scopes() {
    if (!B) return [];
    var out = [{ id: "india", label: "India: all institutions (pooled)", group: "Pooled" }];
    ["north", "south", "east", "west"].forEach(function (r) {
      if (B.sources.some(function (s) { return s.region === r && s.kind !== "network" && !s.local && s.latest && recent(s); })) out.push({ id: "region:" + r, label: REGION_LABEL[r] + " (pooled)", group: "Pooled", region: r });
    });
    B.sources.filter(function (s) { return s.kind === "network" && s.latest; }).sort(function (a, b) { return (a.region === "national" ? 0 : 1) - (b.region === "national" ? 0 : 1) || (a.short < b.short ? -1 : 1); })
      .forEach(function (s) { out.push({ id: "src:" + s.id, label: s.short + " " + (s.edLabel || s.year) + (s.verification.status === "transcribed" ? " (summary, no isolate counts)" : ""), group: "Surveillance networks", src: s }); });
    ["north", "south", "east", "west"].forEach(function (r) {
      B.sources.filter(function (s) { return s.region === r && s.kind !== "network" && s.latest && !s.local; }).sort(function (a, b) { return a.short < b.short ? -1 : 1; })
        .forEach(function (s) { out.push({ id: "inst:" + s.inst, label: s.short + " (" + (s.edLabel || s.year) + (s.kind === "study" ? ", study" : "") + ")", group: REGION_LABEL[r], src: s }); });
    });
    var loc = B.sources.filter(function (s) { return s.local; })[0];
    if (loc) out.push({ id: "local", label: loc.name + " (this device)", group: "My hospital", src: loc });
    return out;
  }
  function scopeLabel(id) { var s = scopes().filter(function (x) { return x.id === id; })[0]; return s ? s.label : id; }
  /* Rows in a scope (all strata). For pooled scopes: latest edition of each institution or study. */
  // Pools take each institution's latest antibiogram only if it is recent (stats.poolFrom: the five
  // most recent data years); older ones stay viewable on their own and in trends.
  function recent(s) { var f = B && B.stats && B.stats.poolFrom; return !f || s.year >= f; }
  function scopeRows(scope) {
    if (!B) return [];
    // Pools: each institution's latest antibiogram, recent enough; never networks (the same isolates
    // twice), the device-local import, or an outbreak / single-pathogen report (focus).
    if (scope === "india") return B.rows.filter(function (r) { return r.src.kind !== "network" && !r.src.local && !r.src.focus && r.src.latest && recent(r.src); });
    if (/^region:/.test(scope)) { var rg = scope.slice(7); return B.rows.filter(function (r) { return r.src.region === rg && r.src.kind !== "network" && !r.src.local && !r.src.focus && r.src.latest && recent(r.src); }); }
    if (/^src:/.test(scope)) { var id = scope.slice(4); return B.rows.filter(function (r) { return r.src.id === id; }); }
    if (/^inst:/.test(scope)) { var inst = scope.slice(5); return B.rows.filter(function (r) { return r.src.inst === inst && r.src.latest; }); }
    if (scope === "local") return B.rows.filter(function (r) { return r.src.local; });
    return [];
  }
  function isPooled(scope) { return scope === "india" || /^region:/.test(scope); }
  function strata(scope) {
    var key = "s|" + scope; if (memo[key]) return memo[key];
    var sp = {}, st = {};
    scopeRows(scope).forEach(function (r) { sp[r.spec] = (sp[r.spec] || 0) + 1; st[r.set] = (st[r.set] || 0) + 1; });
    return (memo[key] = { specs: sp, sets: st });
  }

  /* --------------------------------------------------------------- table --- */
  var ORG_ORDER = ["ecoli", "klebsiella", "koxytoca", "kaerogenes", "ecloacae", "enterobacter", "citrobacter", "cfreundii", "ckoseri", "entero_other", "pmirabilis", "proteus", "proteus_other", "ppm", "morganella", "providencia", "pstuartii", "prettgeri", "serratia",
    "salmonella_typhi", "salmonella_paratyphi", "salmonella_enteric", "salmonella_nts", "shigella", "shigella_sonnei", "shigella_flexneri", "vcholerae", "ecoli_dec", "aeromonas", "paeruginosa", "acinetobacter", "steno", "burkholderia", "bcepacia", "bpseudomallei",
    "hinfluenzae", "mcatarrhalis", "ngonorrhoeae", "nmeningitidis", "saureus", "cons", "sepidermidis", "shaemolyticus", "shominis", "cons_other", "ssaprophyticus", "efaecalis", "efaecium", "enterococcus", "spneumoniae", "strep_bhs", "strep_viridans", "streptococcus", "listeria",
    "candida", "calbicans", "ctropicalis", "cparapsilosis", "cglabrata", "ckrusei", "cauris", "aspergillus", "aflavus", "afumigatus", "aniger"];
  var DRUG_ORDER = ["penicillin", "ampicillin", "amoxicillin", "oxacillin", "cloxacillin", "cefoxitin", "amoxiclav", "ampsulbactam", "piperacillin", "piptazo", "cefazolin", "cephalexin", "cefuroxime", "cefotaxime", "ceftriaxone", "ceftazidime", "cefepime",
    "cefixime", "cefpodoxime", "cefoperazone", "cefoperazone_sulbactam", "ceftazidime_avibactam", "ceftolozane_tazobactam", "ceftaroline", "cefiderocol", "aztreonam", "aztreonam_avibactam", "ertapenem", "imipenem", "meropenem", "doripenem",
    "imipenem_relebactam", "meropenem_vaborbactam", "amikacin", "gentamicin", "tobramycin", "netilmicin", "plazomicin", "gentamicin_hl", "streptomycin_hl", "ciprofloxacin", "levofloxacin", "ofloxacin", "norfloxacin", "moxifloxacin", "nalidixic_acid",
    "cotrimoxazole", "trimethoprim", "nitrofurantoin", "fosfomycin", "tetracycline", "doxycycline", "minocycline", "tigecycline", "eravacycline", "chloramphenicol", "colistin", "polymyxin_b", "sulbactam_durlobactam", "erythromycin", "azithromycin",
    "clarithromycin", "clindamycin", "vancomycin", "teicoplanin", "linezolid", "tedizolid", "daptomycin", "rifampicin", "fusidic_acid", "mupirocin", "metronidazole",
    "fluconazole", "voriconazole", "itraconazole", "posaconazole", "isavuconazole", "amphotericin_b", "caspofungin", "micafungin", "anidulafungin", "flucytosine"];
  function orderIdx(list, k) { var i = list.indexOf(k); return i < 0 ? 999 : i; }
  function sortDrugs(keys) { return keys.slice().sort(function (a, b) { return orderIdx(DRUG_ORDER, a) - orderIdx(DRUG_ORDER, b) || (a < b ? -1 : 1); }); }
  function sortOrgs(list) { return list.slice().sort(function (a, b) { return orderIdx(ORG_ORDER, a.org) - orderIdx(ORG_ORDER, b.org) || ((a.pheno || "") < (b.pheno || "") ? -1 : 1); }); }

  /* Rows of one stratum. A printed row wins over a derived one for the same source, org and
   * phenotype (derived rows only exist where nothing was printed, so this is a safety net).
   * Pooled "all settings" takes each institution's hospital-wide figure: its all-settings row,
   * else its all-inpatient row (many Indian hospital antibiograms are inpatient-only).
   * ICU-only, ward-only and OPD-only reports are pooled under their own setting instead. */
  function stratumRows(scope, spec, set) {
    var widen = isPooled(scope) && set === "all";
    var rank = function (r) { return (r.set === "all" ? 0 : 2) + (r.derived ? 1 : 0); };
    var rows = scopeRows(scope).filter(function (r) { return r.spec === spec && (r.set === set || (widen && r.set === "inpatient")); });
    var seen = {};
    rows.sort(function (a, b) { return rank(a) - rank(b); });
    return rows.filter(function (r) { var k = r.src.id + "|" + r.org + "|" + (r.pheno || "") + "|" + (r.cohort || ""); if (seen[k]) return false; seen[k] = 1; return true; });
  }
  /* The result is shared (memoised): callers must not modify it. */
  function table(scope, spec, set) {
    var key = "t|" + scope + "|" + spec + "|" + set;
    if (memo[key]) return memo[key];
    var rows = stratumRows(scope, spec, set), out = [], drugs = {};
    if (isPooled(scope)) {
      var byOrg = {};
      rows.forEach(function (r) { var k = r.org + "|" + (r.pheno || "") + "|" + (r.cohort || ""); (byOrg[k] = byOrg[k] || []).push(r); });
      Object.keys(byOrg).forEach(function (k) {
        var g = byOrg[k], pooled = R.pool(g.map(function (r) { return { src: r.src.id, inst: r.src.inst, year: r.src.ord, n: r.n, cells: r.cells }; }));
        var usable = g.filter(function (r) { return r.n >= R.M39_MIN; });
        var cells = {};
        Object.keys(pooled).forEach(function (d) {
          var p = pooled[d], rs = g.filter(function (r) { return p.parts.some(function (x) { return x.src === r.src.id; }); });
          var nR = rs.filter(function (r) { return r.measure === "R"; }).length;
          cells[d] = { s: p.s, act: "keep", nt: p.n, k: p.k, min: p.min, max: p.max, parts: p.parts, fromR: nR > 0 && nR === rs.length, mixR: nR > 0 && nR < rs.length };
          drugs[d] = 1;
        });
        // Intrinsic resistance is a property of the organism: show it even when pooled.
        g.forEach(function (r) { Object.keys(r.cells).forEach(function (d) { if (r.cells[d].act === "intrinsic" && !cells[d]) { cells[d] = { s: null, act: "intrinsic", why: r.cells[d].why }; drugs[d] = 1; } }); });
        out.push({ org: g[0].org, pheno: g[0].pheno, cohort: g[0].cohort || null, n: usable.reduce(function (a, r) { return a + r.n; }, 0), k: usable.length, kAll: g.length,
          lowOnly: !usable.length, cells: cells, rows: g, pooled: true });
      });
    } else {
      rows.forEach(function (r) {
        Object.keys(r.cells).forEach(function (d) { drugs[d] = 1; });
        out.push({ org: r.org, pheno: r.pheno, n: r.n, k: 1, cells: r.cells, rows: [r], row: r, lowN: r.flags.indexOf("lowN") >= 0, noN: r.flags.indexOf("noN") >= 0, derived: r.derived, how: r.how, as: r.as, q: r.q, notes: r.notes,
          measure: r.measure, cohort: r.cohort, note: r.note, table: r.table, page: r.page, spAs: r.spAs });
      });
    }
    out = sortOrgs(out).filter(function (o) { return Object.keys(o.cells).some(function (d) { return o.cells[d].act !== "hide"; }) || o.q; });
    return (memo[key] = { scope: scope, spec: spec, set: set, pooled: isPooled(scope), orgs: out, drugs: sortDrugs(Object.keys(drugs)) });
  }

  /* One cell with everything behind it. */
  function cell(scope, spec, set, org, pheno, drug) {
    var t = table(scope, spec, set), o = t.orgs.filter(function (x) { return x.org === org && (x.pheno || null) === (pheno || null); })[0];
    if (!o) return null;
    var c = o.cells[drug] || null, parts = [];
    o.rows.forEach(function (r) { var rc = r.cells[drug]; if (rc) parts.push({ src: r.src, s: rc.s, act: rc.act, why: rc.why, nt: rc.nt, n: r.n, lowN: r.n != null && r.n < R.M39_MIN, derived: r.derived, page: r.page, note: r.notes && r.notes[drug], spAs: r.spAs }); });
    parts.sort(function (a, b) { return (b.s == null ? -1 : b.s) - (a.s == null ? -1 : a.s); });
    return { org: org, pheno: pheno, drug: drug, cell: c, parts: parts, pooled: t.pooled, n: o.n, k: o.k };
  }

  /* ----------------------------------------------------------- phenotypes --- */
  function phenotypes(scope, spec, set) {
    var t = table(scope, spec, set), by = {};
    t.orgs.forEach(function (o) {
      if (o.pheno) return;
      if (!t.pooled && (o.lowN || o.noN)) return;
      var d = {}; Object.keys(o.cells).forEach(function (k) { var c = o.cells[k]; if (c.act === "keep" && typeof c.s === "number") d[k] = { s: c.s, n: c.nt || o.n }; });
      by[o.org] = d;
    });
    return R.phenoRates(by);
  }

  /* ----------------------------------------------------------------- WISCA --- */
  /* Organism mix: for single sources, the counts table when it exists (includes organisms
   * without susceptibility data, which lowers the share of isolates the estimate covers);
   * otherwise the antibiogram rows' isolate numbers. */
  var PARENT = { efaecalis: "enterococcus", efaecium: "enterococcus", salmonella_typhi: "salmonella_enteric", salmonella_paratyphi: "salmonella_enteric",
    cfreundii: "citrobacter", ckoseri: "citrobacter", pmirabilis: "proteus", proteus_other: "proteus", shigella_sonnei: "shigella", shigella_flexneri: "shigella",
    bcepacia: "burkholderia", bpseudomallei: "burkholderia", calbicans: "candida", ctropicalis: "candida", cparapsilosis: "candida", cglabrata: "candida", ckrusei: "candida", cauris: "candida",
    aflavus: "aspergillus", afumigatus: "aspergillus", aniger: "aspergillus", ecloacae: "enterobacter", pstuartii: "providencia", prettgeri: "providencia",
    sepidermidis: "cons", shaemolyticus: "cons", shominis: "cons", cons_other: "cons" };
  function isCoNS(k) { return k === "cons" || PARENT[k] === "cons"; }
  function mix(scope, spec, set, opts) {
    opts = opts || {};
    var t = table(scope, spec, set), parts = [];
    t.orgs.forEach(function (o) {
      if (o.pheno) return;                                        // phenotype rows are subsets
      if (opts.excludeCoNS !== false && isCoNS(o.org) && spec === "blood") return;
      if (!(o.n > 0)) return;
      var s = {}, act = {};
      Object.keys(o.cells).forEach(function (d) { s[d] = o.cells[d].s; act[d] = o.cells[d].act; });
      parts.push({ org: o.org, n: o.n, s: s, act: act });
    });
    var extra = 0;
    if (!t.pooled && B) {
      // Per source and organism, the count for exactly this setting; for "all" (or "inpatient")
      // without one, the sum of the settings it is made of. Summing every line would count a
      // source that prints an all-settings and a per-setting table twice.
      var inScope = {}, bySrc = {}, byOrg = {};
      scopeRows(scope).forEach(function (r) { inScope[r.src] = 1; });
      B.counts.forEach(function (c) {
        if (!inScope[c.src] || c.spec !== spec) return;
        var m = bySrc[c.src] || (bySrc[c.src] = {}), o = m[c.org] || (m[c.org] = {});
        o[c.set] = (o[c.set] || 0) + c.n;
      });
      Object.keys(bySrc).forEach(function (s) {
        Object.keys(bySrc[s]).forEach(function (org) {
          var o = bySrc[s][org], n = o[set];
          if (n == null) {
            var ps = set === "all" ? (o.inpatient != null ? ["inpatient", "opd"] : ["ward", "icu", "opd"]) : set === "inpatient" ? ["ward", "icu"] : [];
            ps.forEach(function (p) { if (o[p] != null) n = (n || 0) + o[p]; });
          }
          if (n) byOrg[org] = (byOrg[org] || 0) + n;
        });
      });
      var covered = {};
      parts.forEach(function (p) { covered[p.org] = 1; if (PARENT[p.org]) covered[PARENT[p.org]] = 1; });
      Object.keys(byOrg).forEach(function (k) {
        if (opts.excludeCoNS !== false && isCoNS(k) && spec === "blood") return;
        if (!covered[k] && !(PARENT[k] && covered[PARENT[k]])) extra += byOrg[k];
      });
    }
    return { parts: parts, extra: extra };
  }
  function wisca(scope, spec, set, regimen, opts) {
    var m = mix(scope, spec, set, opts);
    var w = R.wisca(m.parts, regimen);
    if (m.extra) { var tot = w.total + m.extra; w.knownPct = tot ? Math.round(1000 * (w.known || 0) / tot) / 10 : 0; w.total = tot; w.noData = m.extra; }
    return w;
  }
  function rank(scope, spec, set, opts) {
    opts = opts || {};
    var t = table(scope, spec, set), out = [];
    t.drugs.forEach(function (d) {
      if (R.DRUGS[d] && R.DRUGS[d].kind === "antifungal") return;
      if (opts.noReserve && R.aware(d) === "R") return;
      var w = wisca(scope, spec, set, [d], opts);
      if (w.coverage == null || w.knownPct < (opts.minKnown || 50)) return;
      out.push({ drug: d, coverage: w.coverage, knownPct: w.knownPct, aware: R.aware(d) });
    });
    out.sort(function (a, b) { return b.coverage - a.coverage; });
    return out;
  }

  /* ----------------------------------------------------------------- trend --- */
  /* A cell across an institution's editions, plus the yearly series its reports print. An
   * edition's own figure wins over a trend-table value for the same year. */
  // Labs rename rows between editions (Proteus spp. one year, P. mirabilis the next): an edition
  // without the organism's own row lends its genus row, or its one species row, and the point
  // says which organism it is ("as").
  function trend(inst, spec, set, org, pheno, drug) {
    if (!B) return [];
    var all = B.rows.filter(function (r) { return r.src.inst === inst && r.spec === spec && r.set === set && (r.pheno || null) === (pheno || null) && !r.cohort; });
    var bySrc = {}, rows = [];
    all.forEach(function (r) { (bySrc[r.src.id] = bySrc[r.src.id] || []).push(r); });
    Object.keys(bySrc).forEach(function (id) {
      var rs = bySrc[id], hit = rs.filter(function (r) { return r.org === org; });
      if (!hit.length && PARENT[org]) hit = rs.filter(function (r) { return r.org === PARENT[org]; });
      if (!hit.length && CHILDREN[org]) { hit = rs.filter(function (r) { return CHILDREN[org].indexOf(r.org) >= 0; }); if (hit.length !== 1) hit = []; }
      rows = rows.concat(hit);
    });
    var pts = [];
    rows.forEach(function (r) {
      var c = r.cells[drug];
      if (c && c.act === "keep" && !pts.some(function (x) { return x.src === r.src.id; })) pts.push({ year: r.src.ord, label: r.src.edLabel, s: c.s, n: c.nt || r.n, src: r.src.id, as: r.org !== org ? R.orgShort(r.org) : null });
    });
    rows.forEach(function (r) {
      if (!r.trend || !r.trend[drug]) return;
      r.trend[drug].forEach(function (p) {
        if (!pts.some(function (x) { return Math.floor(x.year) === p[0]; })) pts.push({ year: p[0] + 11 / 12, label: String(p[0]), s: p[1], n: null, src: r.src.id, reported: true });
      });
    });
    return pts.sort(function (a, b) { return a.year - b.year; });
  }

  /* ------------------------------------------------- consumers (profiles) --- */
  /* Specimen(s) and setting that fit a syndrome, most relevant first. Reasoning and the
   * console use them to pick the stratum; when a scope has none of them, pickStratum falls
   * back (all specimens, all settings) and says so, and the display names what was used. */
  // "nonurine" (all specimens except urine) is the last resort for non-urinary syndromes: it is
  // closer to them than an all-specimens figure, which urinary E. coli dominates.
  var SYN = {
    CYSTITIS: ["urine", "opd"], PYELONEPHRITIS: ["urine", "opd"], PROSTATITIS: ["urine", "opd"],
    COMPLICATED_UTI: ["urine", "inpatient"], CA_UTI: ["urine", "inpatient", { cohort: "hai" }],
    CAP: [["respiratory", "other", "nonurine"], "opd"], SINUSITIS: [["respiratory", "other", "nonurine"], "opd"], COPD_EXACERBATION: [["respiratory", "other", "nonurine"], "opd"], BRONCHIECTASIS_EXACERBATION: [["respiratory", "other", "nonurine"], "opd"],
    SEVERE_CAP: [["respiratory", "other", "nonurine"], "icu"], HAP: [["respiratory", "other", "nonurine"], "inpatient"], VAP: [["respiratory", "other", "nonurine"], "icu", { cohort: "hai" }], ASPIRATION_PNEUMONIA: [["respiratory", "other", "nonurine"], "inpatient"], LUNG_ABSCESS: [["respiratory", "other", "nonurine"], "inpatient"],
    CELLULITIS: [["pus", "deep", "other", "nonurine"], "opd"], ERYSIPELAS: [["pus", "deep", "other", "nonurine"], "opd"], DIABETIC_FOOT: [["deep", "pus", "other", "nonurine"], "inpatient"], NECROTIZING_FASCIITIS: [["deep", "pus", "other", "nonurine"], "inpatient"],
    LIVER_ABSCESS: [["deep", "pus", "other", "blood", "nonurine"], "inpatient"], BRAIN_ABSCESS: [["deep", "pus", "other", "blood", "nonurine"], "inpatient"],
    // Pneumococcal susceptibility for meningitis needs meningeal breakpoints: CSF figures or none.
    MENINGITIS: [["csf", "sterile", "blood", "nonurine"], "inpatient", { only: { spneumoniae: ["csf"] } }], ENCEPHALITIS: [["csf", "sterile", "blood", "nonurine"], "inpatient", { only: { spneumoniae: ["csf"] } }], SBP: [["sterile", "blood", "nonurine"], "inpatient"],
    CHOLANGITIS: [["sterile", "blood", "nonurine"], "inpatient"], CHOLECYSTITIS: [["sterile", "blood", "nonurine"], "inpatient"],
    SEPSIS: [["blood", "nonurine"], "inpatient"], SEPTIC_SHOCK: [["blood", "nonurine"], "icu"], FEBRILE_NEUTROPENIA: [["blood", "nonurine"], "inpatient"], IE: [["blood", "nonurine"], "inpatient"], DEVICE_INFECTION: [["blood", "nonurine"], "icu", { cohort: "hai" }],
    ENTERIC_FEVER: ["blood", "all"], PUO: [["blood", "nonurine"], "all"], GASTROENTERITIS: ["stool", "all"], DYSENTERY: ["stool", "all"]
  };
  function synEntry(synId) {
    var s = String(synId || "").toUpperCase();
    if (SYN[s]) return SYN[s];
    // Unknown ids: guess from the name (gall bladder before bladder).
    if (/MENING|CNS/.test(s)) return [["csf", "sterile", "blood", "nonurine"], "inpatient", { only: { spneumoniae: ["csf"] } }];
    if (/CHOLE|BILIAR|PERITON|SBP/.test(s)) return [["sterile", "blood", "nonurine"], "inpatient"];
    if (/UTI|CYSTITIS|PYELO|PROSTAT|URINARY/.test(s)) return ["urine", "all"];
    if (/PNEUMONIA|CAP|HAP|VAP|ASPIRATION|RESP|EMPYEMA|LUNG|BRONCH|COPD/.test(s)) return [["respiratory", "other", "nonurine"], "all"];
    if (/CELLULITIS|ERYSIPELAS|ABSCESS|NECROTI|WOUND|SSTI|FOOT|OSTEO|ARTHRITIS|BITE/.test(s)) return [["pus", "deep", "other", "nonurine"], "all"];
    if (/DIARRH|DYSENTERY|GASTROENTER|CHOLERA/.test(s)) return ["stool", "all"];
    if (/SEPSIS|SEPTIC|BACTER|NEUTROPENI|ENTERIC|TYPHOID|ENDOCARD|CRBSI|LINE|DEVICE/.test(s)) return [["blood", "nonurine"], "all"];
    return null;
  }
  function specimenChain(synId) { var e = synEntry(synId); return e ? [].concat(e[0]) : []; }
  function specimenFor(synId) { return specimenChain(synId)[0] || null; }
  function settingFor(synId) { var e = synEntry(synId); return e ? e[1] : null; }
  /* Everything a consumer passes for a syndrome: {spec, set, cohort?, only?}. cohort "hai": ICU
   * device-associated infection surveillance rows are preferred (catheter UTI, VAP, line
   * infections) and used by no other syndrome. only: organisms restricted to some specimens. */
  function synCtx(synId) {
    var e = synEntry(synId), o = (e && e[2]) || {};
    return { spec: specimenChain(synId), set: settingFor(synId), cohort: o.cohort || null, only: o.only || null };
  }
  function usableInfo(scope, spec, set) {
    var t = table(scope, spec, set), orgs = 0, maxK = 0;
    t.orgs.forEach(function (o) {
      if (o.pheno) return;
      if (t.pooled ? o.lowOnly : (o.lowN || o.noN)) return;
      orgs++; if ((o.k || 0) > maxK) maxK = o.k || 0;
    });
    return { orgs: orgs, maxK: maxK };
  }
  function usable(scope, spec, set) { return usableInfo(scope, spec, set).orgs; }
  /* Candidate strata for a wanted specimen (string or preference list) and setting, best first.
   * Specimen matters more than setting, so settings are tried within each specimen. A syndrome
   * that names specimens gets those or all specimens, never a different one (no urine figures for
   * meningitis); with no specimen wanted any stratum will do. */
  function candidates(scope, spec, set) {
    var wantSp = [].concat(spec || []).filter(Boolean), wantSet = [].concat(set || []).filter(Boolean);
    var st = strata(scope), specs = [], sets = [];
    function addSp(x) { if (x && st.specs[x] && specs.indexOf(x) < 0) specs.push(x); }
    function addSet(x) { if (x && sets.indexOf(x) < 0) sets.push(x); }
    wantSp.forEach(addSp); addSp("all"); if (!wantSp.length) Object.keys(st.specs).forEach(addSp);
    wantSet.forEach(function (x) { addSet(x); if (x === "icu" || x === "ward") addSet("inpatient"); if (x === "inpatient") addSet("ward"); });
    addSet("all"); ["inpatient", "ward", "icu", "opd"].forEach(addSet);
    var out = [];
    specs.forEach(function (sp) { sets.forEach(function (x) { out.push({ spec: sp, set: x }); }); });
    return { list: out, wantSp: wantSp, wantSet: wantSet, specs: specs };
  }
  function finish(res, c) {
    res.wantSpec = c.wantSp[0] || null; res.wantSet = c.wantSet[0] || null;
    res.specMatch = !c.wantSp.length || c.wantSp.indexOf(res.spec) >= 0;
    res.setMatch = !c.wantSet.length || res.set === c.wantSet[0] || (c.wantSet[0] === "all");
    return res;
  }
  /* One stratum for a whole scope (the Antibiogram screen, older consumers). A pooled figure for
   * one setting needs at least 3 institutions behind it; otherwise the pooled all-settings figure
   * is used, which is more representative. */
  function pickStratum(scope, spec, set) {
    var key = "p|" + scope + "|" + [].concat(spec || []).join(",") + "|" + [].concat(set || []).join(",");
    if (memo[key]) return memo[key];
    var c = candidates(scope, spec, set), pooled = isPooled(scope), res = null;
    for (var i = 0; i < c.list.length && !res; i++) {
      var u = usableInfo(scope, c.list[i].spec, c.list[i].set);
      if (u.orgs && (!pooled || c.list[i].set === "all" || u.maxK >= 3)) res = { spec: c.list[i].spec, set: c.list[i].set };
    }
    if (!res) res = { spec: c.specs[0] || c.wantSp[0] || "all", set: "all", empty: true };
    return (memo[key] = finish(res, c));
  }
  /* The stratum for one organism. Reports print organism groups at different granularity (ICMR:
   * Enterobacterales for "all specimens except urine", staphylococci by specimen), so the console
   * and reasoning choose per organism: the first candidate where it has a usable row, else the
   * first where it has any row (shown flagged), else empty. */
  function pickStratumFor(scope, orgName, spec, set, opts) {
    opts = opts || {};
    var oc = R.canonOrg(orgName), only = opts.only && oc && opts.only[oc.key];
    var key = "po|" + scope + "|" + orgName + "|" + [].concat(spec || []).join(",") + "|" + [].concat(set || []).join(",") + "|" + (opts.cohort || "") + "|" + (only ? only.join(",") : "");
    if (memo[key]) return memo[key];
    var c = candidates(scope, only || spec, set), pooled = isPooled(scope), res = null, any = null;
    if (only) c.list = c.list.filter(function (x) { return only.indexOf(x.spec) >= 0; });
    // A syndrome that asks for a surveillance cohort tries it first, then the ordinary rows.
    var passes = opts.cohort ? [opts.cohort, null] : [null];
    for (var p = 0; p < passes.length && !res; p++) {
      for (var i = 0; i < c.list.length && !res; i++) {
        var t = table(scope, c.list[i].spec, c.list[i].set), rows = orgRows(t, orgName, passes[p]);
        if (!rows.length) continue;
        if (!any) any = { spec: c.list[i].spec, set: c.list[i].set, cohort: passes[p], lowOnly: true };
        var ok = rows.filter(function (o) { return rowUsable(t, o); });
        if (ok.length && (!pooled || c.list[i].set === "all" || ok.some(function (o) { return (o.k || 0) >= 3; }))) res = { spec: c.list[i].spec, set: c.list[i].set, cohort: passes[p] };
      }
    }
    if (!res) res = any || { spec: (only && only[0]) || c.specs[0] || c.wantSp[0] || "all", set: "all", empty: true, cohort: null };
    if (only) res.only = only;
    return (memo[key] = finish(res, c));
  }
  /* Table rows for an organism as a syndrome names it: the organism itself, else its group
   * (Shigella sonnei -> Shigella spp.), else its species (Enterococcus spp. -> E. faecalis and
   * E. faecium). */
  var CHILDREN = {};
  Object.keys(PARENT).forEach(function (c) { (CHILDREN[PARENT[c]] = CHILDREN[PARENT[c]] || []).push(c); });
  function orgRows(t, name, cohort) {
    var o = R.canonOrg(name); if (!o || !t) return [];
    // Surveillance cohorts answer only the syndromes that ask for them.
    function find(k) { return t.orgs.filter(function (x) { return x.org === k && (x.pheno || null) === (o.pheno || null) && (x.cohort || null) === (cohort || null); }); }
    var hit = find(o.key); if (hit.length) return hit;
    if (PARENT[o.key]) { hit = find(PARENT[o.key]); if (hit.length) return hit; }
    var out = []; (CHILDREN[o.key] || []).forEach(function (c) { out = out.concat(find(c)); });
    return out;
  }
  function rowUsable(t, o) { return t.pooled ? !o.lowOnly : !(o.lowN || o.noN); }
  /* {s, n, k, spec, set, specMatch, setMatch, src, pooled, scope} for a profile scope, or
   * {intrinsic:true, why} or null. Low-isolate rows are returned with lowN:true; callers that
   * show a figure as fact must skip them. Species rows standing in for a genus are combined
   * isolate-weighted (combined: [labels]). */
  function susceptibility(orgName, drug, ctx) {
    if (!B) return null;
    ctx = ctx || {};
    var d = R.canonDrug(drug); if (!d) return null;
    var scope = ctx.scope || "india", st = pickStratumFor(scope, orgName, ctx.spec, ctx.set, ctx);
    var t = table(scope, st.spec, st.set), rows = orgRows(t, orgName, st.cohort);
    if (!rows.length) return null;
    var base = { spec: st.spec, set: st.set, cohort: st.cohort || null, specMatch: st.specMatch, setMatch: st.setMatch, pooled: t.pooled, scope: scope };
    var intr = rows.filter(function (o) { return o.cells[d] && o.cells[d].act === "intrinsic"; })[0];
    if (intr && rows.length === 1) return extend(base, { s: 0, intrinsic: true, why: intr.cells[d].why });
    var parts = rows.filter(function (o) { var c = o.cells[d]; return c && c.act === "keep" && typeof c.s === "number"; });
    // Cefoxitin and oxacillin are both methicillin markers for staphylococci: a report that
    // prints one answers a question about the other.
    if (!parts.length && R.ORGS[rows[0].org] && R.ORGS[rows[0].org].staph && (d === "cefoxitin" || d === "oxacillin")) {
      d = d === "cefoxitin" ? "oxacillin" : "cefoxitin";
      parts = rows.filter(function (o) { var c = o.cells[d]; return c && c.act === "keep" && typeof c.s === "number"; });
    }
    if (!parts.length) return null;
    // A figure is low-number when its row is, or when the drug itself was tested on fewer than
    // 30 isolates (e.g. linezolid tested on 5 of 61).
    var cellLow = function (o) { var c = o.cells[d]; return !rowUsable(t, o) || (c.nt != null && c.nt < R.M39_MIN); };
    if (parts.length === 1) {
      var o = parts[0], c = o.cells[d];
      return extend(base, { s: c.s, n: c.nt || o.n, k: o.k, lowN: cellLow(o), src: t.pooled ? null : o.rows[0].src.id, org: o.org });
    }
    var num = 0, den = 0, k = 0, low = false;
    parts.forEach(function (o) { var c = o.cells[d], w = c.nt || o.n || 0; num += c.s * w; den += w; k = Math.max(k, o.k || 1); if (cellLow(o)) low = true; });
    if (!den) return null;
    return extend(base, { s: Math.round(10 * num / den) / 10, n: den, k: k, lowN: low || den < R.M39_MIN, src: t.pooled ? null : parts[0].rows[0].src.id,
      combined: parts.map(function (o) { return R.orgShort(o.org); }) });
  }
  function extend(a, b) { var o = {}, k; for (k in a) o[k] = a[k]; for (k in b) o[k] = b[k]; return o; }
  /* The shape older consumers read: {source, note, org:{Label:{n, specimen, d:{drug:{s, src, approx}}}}}. */
  function legacyAbg(scope, spec, set) {
    if (!B) return null;
    var st = pickStratum(scope, spec, set || "all"), t = table(scope, st.spec, st.set), org = {};
    t.orgs.forEach(function (o) {
      if (o.pheno) return;                               // subsets (MRSA, CR) are not the organism
      if (!t.pooled && (o.lowN || o.noN)) return;
      if (t.pooled && o.lowOnly) return;
      var name = R.orgLabel(o.org).replace(/ \/ spp\.$/, "") + (o.pheno ? " (" + o.pheno + ")" : "");
      var d = {};
      Object.keys(o.cells).forEach(function (k) { var c = o.cells[k]; if (c.act === "keep" && typeof c.s === "number") d[k] = { s: c.s, n: c.nt || null, src: t.pooled ? null : o.rows[0].src.id }; });
      if (Object.keys(d).length) org[name] = { n: o.n, specimen: R.SPECIMENS[st.spec].label + (st.set !== "all" ? ", " + R.SETTINGS[st.set].label : ""), d: d };
    });
    return { source: scopeLabel(scope), note: (t.pooled ? "Isolate-weighted pool of the latest antibiogram of each institution; rows with fewer than 30 isolates left out." : "") + " Specimen: " + R.SPECIMENS[st.spec].label + ".", org: org, scope: scope, spec: st.spec, set: st.set };
  }
  function sourceById(id) { return B ? B.sources.filter(function (s) { return s.id === id; })[0] || null : null; }
  function editions(inst) { return B ? B.sources.filter(function (s) { return s.inst === inst; }).sort(function (a, b) { return b.ord - a.ord; }) : []; }
  function flagged(srcId) {
    if (!B) return [];
    var out = [];
    B.rows.forEach(function (r) { if (r.src.id !== srcId || r.derived) return; Object.keys(r.cells).forEach(function (d) { var c = r.cells[d]; if (c.act !== "keep") out.push({ spec: r.spec, set: r.set, org: r.org, pheno: r.pheno, as: r.as, drug: d, s: c.s, act: c.act, why: c.why }); }); });
    return out;
  }

  /* ------------------------------------------------------------- export --- */
  function csv(t, labels) {
    var q = function (x) { x = x == null ? "" : String(x); return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
    var head = ["Organism", "Phenotype", "Isolates", "Institutions"].concat(t.drugs.map(function (d) { return R.drugLabel(d) + " %S"; }));
    var lines = [head.map(q).join(",")];
    t.orgs.forEach(function (o) {
      lines.push([R.orgLabel(o.org), o.pheno || "", o.n == null ? "" : o.n, t.pooled ? o.k : 1].concat(t.drugs.map(function (d) {
        var c = o.cells[d]; if (!c) return ""; if (c.act === "intrinsic") return "IR"; if (c.act !== "keep") return ""; return c.s;
      })).map(q).join(","));
    });
    lines.push("");
    lines.push(q("Source: " + (labels && labels.scope || t.scope) + "; specimen " + R.SPECIMENS[t.spec].label + "; setting " + R.SETTINGS[t.set].label + ". %S = percent susceptible. IR = intrinsic resistance. Blank = not reported or failed a data check. Exported from StewardMD (decision support; verify against the source)."));
    return lines.join("\n") + "\n";
  }

  // Warm the cache once the app is idle, so reasoning and the console have data early.
  try { setTimeout(function () { load().catch(function () {}); }, 2500); } catch (e) {}

  window.ABG_STORE = {
    load: load, ready: load, onReady: onReady, loaded: function () { return !!B; }, data: function () { return B; },
    scopes: scopes, scopeLabel: scopeLabel, scopeRows: scopeRows, isPooled: isPooled, strata: strata,
    table: table, cell: cell, phenotypes: phenotypes, wisca: wisca, rank: rank, mix: mix, trend: trend,
    susceptibility: susceptibility, legacyAbg: legacyAbg, specimenFor: specimenFor, specimenChain: specimenChain, settingFor: settingFor, synCtx: synCtx,
    pickStratum: pickStratum, pickStratumFor: pickStratumFor, orgRows: orgRows, usable: usable,
    sourceById: sourceById, editions: editions, flagged: flagged, csv: csv, sortDrugs: sortDrugs,
    localGet: localGet, localSave: localSave, localClear: localClear,
    REGION_LABEL: REGION_LABEL, _expand: expand, poolFrom: function () { return (B && B.stats && B.stats.poolFrom) || null; },
    _set: function (b) { B = expand(JSON.parse(JSON.stringify(b))); clearMemo(); addLocal(); return B; }
  };
})();
