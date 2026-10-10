/* PrepNucleus assessment engine (Tests & Assessment Engine M1, 2026-10-10). window.PREP_ASSESS. ES5, pure.
   Plan: ~/prep-data/assessment/AUDIT.md (sections C, E, F). Everything here is pure (no DOM, no storage, no network) so
   node tests load it with require(); prep.js (runner) and prep-tests.js (the Tests tab under smd_prep_tests2) call it.

   Profiles. The versioned exam profiles in prep/assess/profiles/*.json, compiled to prep-profiles.js, are the one source
   of the exam numbers: legacyMocks() rebuilds prep.js MOCKS (the pre-flag patterns, unchanged), schemes() the Arena
   SCHEMES and coreProfiles() the generation EXAM_PROFILES. Every format, navigation and scoring field carries its own
   provenance (official or inferred) in the profile.

   Assembly. assemble(profile, type, opts, bank) picks only eligible items (eligible(): no flag, not hidden, not excluded,
   and not blocked by the optional item-quality sidecar), never the same item or the same normalised stem twice, applies
   the blueprint quotas, and records planned vs actual distribution and every deviation. When the bank cannot meet the
   blueprint it shrinks the test (official subject quotas are never filled from another subject) or refuses with the
   reason; it never pads with unrelated questions. A seed makes it deterministic (daily 10 uses exam + IST date).

   Section clock (locked timed sections). Rule, so a student can never gain time:
     1. Only the open section's clock runs; a section not yet started is never charged, and no question is visible
        between sections, so the pause on the section summary costs nothing and gains nothing.
     2. While the app runs, each step charges max(monotonic elapsed, wall-clock elapsed), so neither a suspended page
        (monotonic clock stopped) nor a device clock moved backwards gives time back. Backgrounding is charged too: the
        exam hall clock does not stop.
     3. The state is saved (IndexedDB) at every answer and at least every 5 s with the wall-clock time of the save. After
        the app is killed and opened again, the whole wall-clock gap since that save is charged to the open section; if
        it ran out meanwhile, the section is submitted with the answers saved before the app closed.
     4. A device clock found more than 2 minutes behind the last save cannot be trusted: the open section ends.
   Results carry raw marks by the profile's scheme, counts, accuracy, time, per section, subject, topic and difficulty, the
   assembly record and the profile id and version. No rank, percentile, readiness probability or prediction is made here;
   a cohort rank (Arena) is shown only with its N and only when N >= RANK_MIN_N. */
(function (G) {
  "use strict";
  var PP = (G && G.PREP_PROFILES) || (typeof require === "function" ? require("./prep-profiles.js") : null);
  var RANK_MIN_N = 100;            // Arena "rank of N": shown only from 100 players up (owner 2026-10-10; conservative)
  var CLOCK_BACK_MS = 120000;      // rule 4
  var SAVE_EVERY_MS = 5000;        // rule 3
  var BLOCKED = { requires_review: 1, rejected: 1, retired: 1 };
  var TYPES = ["grand", "part", "mini", "daily10", "subject_mini", "topic", "diagnostic", "custom"];

  /* ---------- profiles ---------- */
  function profiles() { return (PP && PP.profiles) || {}; }
  function profileIds() { return (PP && PP.ids) || []; }
  function profile(id) { var p = profiles(); return Object.prototype.hasOwnProperty.call(p, id) ? p[id] : null; }
  function forTab(tab) { return profileIds().map(profile).filter(function (p) { return p && p.tab === tab; }); }
  function paceSec(p) { return p && p.pace_sec ? p.pace_sec : Math.round(p.format.duration_min * 60 / p.format.questions); }
  function scheme(p) { return { plus: p.scoring.correct, minus: -p.scoring.incorrect, label: p.name, pass: p.scoring.pass ? p.scoring.pass.marks / (p.scoring.pass.of) : 0 }; }
  // prep.js MOCKS as it was before smd_prep_tests2 (same keys, order and numbers): { tab: [pattern] }.
  function legacyMocks() {
    var out = {}, rows = [];
    profileIds().forEach(function (id) { var p = profile(id); if (p && p.legacy && p.legacy_mock) rows.push(p); });
    ["neet-pg", "neet-ss", "usmle", "fmge"].forEach(function (tab) {
      out[tab] = rows.filter(function (p) { return p.legacy.tab === tab; }).sort(function (a, b) { return a.legacy.order - b.legacy.order; }).map(function (p) {
        var m = {}, k; for (k in p.legacy_mock) m[k] = p.legacy_mock[k]; return m;
      });
    });
    return out;
  }
  // Arena marking schemes { scheme id: { plus, minus } } (functions/_prep-arena.js).
  function schemes() {
    var out = {};
    profileIds().forEach(function (id) { var p = profile(id); if (p && p.legacy && p.legacy.scheme) out[p.legacy.scheme] = { plus: p.scoring.correct, minus: -p.scoring.incorrect || 0 }; });
    return out;
  }
  // Generation style mixes { core id: { id, name, style, stem, cog, d } } (functions/_prep-core.js EXAM_PROFILES).
  function coreProfiles() {
    var out = {};
    profileIds().forEach(function (id) {
      var p = profile(id), s = p && p.style; if (!s || !s.core_id) return;
      var d = {}; Object.keys(s.d).forEach(function (k) { d[k] = s.d[k]; });
      out[s.core_id] = { id: s.core_id, name: s.core_id === "usmle" ? "USMLE" : p.name, style: s.text, stem: s.stem, cog: { recall: s.cog.recall, application: s.cog.application, reasoning: s.cog.reasoning }, d: d };
    });
    return out;
  }
  var NEED_PROV = ["/format/questions", "/format/duration_min", "/format/sections", "/navigation/locked_sections", "/navigation/return_to_closed_section", "/navigation/early_section_submit", "/scoring/correct", "/scoring/incorrect", "/scoring/unanswered", "/blueprint/kind"];
  // validateProfile(p) -> list of problems ([] = valid).
  function validateProfile(p) {
    var e = [];
    function need(c, m) { if (!c) e.push(m); }
    need(p && typeof p === "object", "not an object"); if (!p || typeof p !== "object") return e;
    need(/^[a-z0-9-]+$/.test(p.id || ""), "id");
    need(/^\d+\.\d+\.\d+$/.test(p.version || ""), "version must be x.y.z");
    need(p.status === "official" || p.status === "provisional", "status official|provisional");
    need(/^\d{4}-\d{2}-\d{2}$/.test(p.verified_on || ""), "verified_on date");
    var f = p.format || {};
    need(f.questions > 0 && Math.floor(f.questions) === f.questions, "format.questions");
    need(f.duration_min > 0, "format.duration_min");
    need(Array.isArray(f.sections) && f.sections.length > 0, "format.sections");
    if (Array.isArray(f.sections)) {
      var q = 0, mn = 0, seen = {};
      f.sections.forEach(function (s, i) { need(s.id && !seen[s.id], "section " + i + " id"); seen[s.id] = 1; need(s.questions > 0 && s.minutes > 0, "section " + s.id + " size"); q += s.questions; mn += s.minutes; });
      need(q === f.questions, "sections add up to " + q + ", not " + f.questions);
      need(mn === f.duration_min, "section minutes add up to " + mn + ", not " + f.duration_min);
    }
    var n = p.navigation || {};
    ["locked_sections", "revisit_within_section", "return_to_closed_section", "early_section_submit", "auto_advance_on_timeout", "mark_for_review"].forEach(function (k) { need(typeof n[k] === "boolean", "navigation." + k); });
    var sc = p.scoring || {};
    need(typeof sc.correct === "number" && sc.correct > 0, "scoring.correct");
    need(typeof sc.incorrect === "number" && sc.incorrect <= 0, "scoring.incorrect <= 0");
    need(sc.unanswered === 0, "scoring.unanswered");
    var bp = p.blueprint || {};
    need(["none", "official_counts", "inferred_historical"].indexOf(bp.kind) >= 0, "blueprint.kind");
    if (bp.kind === "official_counts") {
      var t = 0; Object.keys(bp.subjects || {}).forEach(function (k) { t += bp.subjects[k]; }); Object.keys(bp.unmapped || {}).forEach(function (k) { t += bp.unmapped[k]; });
      need(t === f.questions, "blueprint adds up to " + t);
    }
    var prov = {}; (p.provenance || []).forEach(function (r) {
      need(typeof r.official === "boolean" && /^\d{4}-\d{2}-\d{2}$/.test(r.verified_on || ""), "provenance " + r.field);
      if (r.official) need(r.src && p.sources && p.sources[r.src] && p.sources[r.src].url, "official rule " + r.field + " without a source");
      prov[r.field] = r;
    });
    NEED_PROV.forEach(function (k) { need(!!prov[k], "no provenance for " + k); });
    // A profile is official only when every scoring and format rule above is official.
    // (A single-paper exam has no section rules to verify: its /navigation section rules may be inferred.)
    var single = Array.isArray(f.sections) && f.sections.length === 1;
    if (p.status === "official") NEED_PROV.forEach(function (k) { if (prov[k] && !prov[k].official && k !== "/scoring/correct" && !(single && k.indexOf("/navigation/") === 0)) e.push("official profile with inferred " + k); });
    need(!/[–—]/.test(JSON.stringify(p)), "no en or em dash");
    return e;
  }
  function provOf(p, field) { var r = null; (p.provenance || []).forEach(function (x) { if (x.field === field) r = x; }); return r; }

  /* ---------- seeded random ---------- */
  function hashStr(s) { var h = 2166136261; s = String(s); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
  function rng(seed) { var a = hashStr(seed); return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function shuffle(a, r) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)), x = a[i]; a[i] = a[j]; a[j] = x; } return a; }
  // IST calendar date (UTC+5:30, no DST) of a timestamp: "YYYY-MM-DD".
  function istDate(ms) { return new Date(ms + 5.5 * 3600e3).toISOString().slice(0, 10); }

  /* ---------- items ---------- */
  function normStem(q) { return String(q || "").toLowerCase().replace(/<[^>]*>/g, " ").replace(/[^a-z0-9]+/g, " ").trim(); }
  var COMBO = /^\s*(?:only\s+)?(?:\(?[1-6ivx]{1,4}\)?|[a-e])(?:\s*(?:,|and|&|\+)\s*(?:\(?[1-6ivx]{1,4}\)?|[a-e]))*(?:\s+only)?\s*\.?\s*$|\b(?:all|none) of the (?:above|statements)\b|^\s*(?:all|both|none)\s*\.?\s*$/i;
  // The INI-CET "multiple correct" style as the app shows it: numbered statements in the stem and options that are
  // combinations of them ("1 and 2 only", "1, 2 and 3", "All of the above"). Owner 2026-10-10.
  function isCombination(it) {
    if (!it || !it.o || it.o.length < 3) return false;
    var st = String(it.q || ""), n = (st.match(/(?:^|[\s\n(])(?:[1-6]|i{1,3}|iv|v)[.)]\s+\S/gi) || []).length;
    if (n < 2) return false;
    return it.o.filter(function (o) { return COMBO.test(String(o)); }).length >= 3;
  }
  function hasImage(it) { return !!(it && ((it.img && it.img.length) || it.stack)); }
  function itemStyle(it) { return isCombination(it) ? "statement_combination" : hasImage(it) ? "image" : "sba"; }
  function levelOf(it) { return it.vh === true || it.d === 4 ? 4 : it.d === 1 || it.d === 3 ? it.d : 2; }
  /* eligible(it, ctx) -> "" when the item may enter a test, else the reason. ctx: { hidden: {id:1}, exclude: {id:1},
     quality: { id: record } (item-quality sidecar; optional), hashOf(it) (optional, to check a record's content_hash) }.
     Default (no sidecar record): eligible = the item the app already shows (no flag, not withdrawn). A record blocks only
     when its status is requires_review, rejected or retired, its key is disputed, a rubric rule failed, or it is not
     eligible_for the type. "approved" is never required (draft and automated_checks_passed stay eligible). */
  function eligible(it, ctx, type) {
    ctx = ctx || {};
    if (!it || it.id == null || !it.o || !(it.o.length >= 2) || typeof it.a !== "number") return "malformed";
    if (it.flags && it.flags.length) return "flagged";
    if (ctx.hidden && ctx.hidden[it.id]) return "withdrawn";
    if (ctx.exclude && ctx.exclude[it.id]) return "excluded";
    var q = ctx.quality && ctx.quality[it.id];
    if (q && !(q.content_hash && ctx.hashOf && ctx.hashOf(it) !== q.content_hash)) {
      if (BLOCKED[q.status]) return "status:" + q.status;
      if (q.key && q.key.confidence === "disputed") return "key-disputed";
      // Owner 2026-10-10 (decision 5): an item with the independent key check passed and no rubric blocker may enter tests
      // before it is "approved" (that status stays the owner's own decision); a rubric "fail" is a blocker.
      if (q.rubric) for (var rk in q.rubric) if (q.rubric[rk] === "fail") return "rubric-blocker";
      if (type && q.eligible_for && q.eligible_for.length && q.eligible_for.indexOf(type) < 0) return "not-for-" + type;
    }
    return "";
  }
  /* readQuality(json) -> { id: record }: an item-quality sidecar file ({ v, records: [...] } or a bare array), records
     without an item_id or with an unknown status skipped. Reader only (M1): nothing here writes a sidecar. */
  var STATUSES = { draft: 1, automated_checks_passed: 1, requires_review: 1, approved: 1, rejected: 1, retired: 1 };
  function readQuality(json) {
    var out = {}, list = Array.isArray(json) ? json : json && Array.isArray(json.records) ? json.records : [];
    list.forEach(function (r) { if (r && r.item_id != null && STATUSES[r.status]) out[String(r.item_id)] = r; });
    return out;
  }

  /* ---------- blueprints ---------- */
  function round(x) { return Math.round(x); }
  // Sections for a test of the profile: all of them (grand), part 1 (part), the first one (mini).
  function sectionsFor(p, type) {
    var all = p.format.sections;
    if (type === "grand") return all.slice();
    if (type === "part") return all.filter(function (s) { return s.part === 1; });
    if (type === "mini") return all.length > 1 ? [all[0]] : [];
    return [];
  }
  /* blueprint(p, type, opts) -> the recipe, or null when the type does not apply to the profile.
     { id, version, exam, profile_version, test_type, count, duration_sec, sections: [{ id, label, n, sec, part }],
       spread: "official_counts" | "bank_proportional" | "scope", locked, seed_rule, shortfall, min_viable } */
  function blueprint(p, type, opts) {
    opts = opts || {};
    if (!p || TYPES.indexOf(type) < 0) return null;
    var pace = paceSec(p), base = { id: p.id + ":" + type, version: "1", exam: p.id, profile_id: p.id, profile_version: p.version, profile_status: p.status, test_type: type, pace: pace, seed_rule: "random", shortfall: "shrink" };
    var secs = sectionsFor(p, type);
    if (type === "grand" || type === "part" || type === "mini") {
      if (!secs.length || (type === "part" && !p.format.parts)) return null;
      var n = 0, sec = 0;
      secs = secs.map(function (s) { n += s.questions; sec += s.minutes * 60; return { id: s.id, label: s.label, n: s.questions, sec: s.minutes * 60, part: s.part || 0 }; });
      return ext(base, { count: n, duration_sec: sec, sections: secs, locked: !!p.navigation.locked_sections, spread: p.blueprint.kind === "official_counts" ? "official_counts" : "bank_proportional", min_viable: Math.ceil(n * 0.5) });
    }
    if (type === "daily10") return ext(base, { count: 10, duration_sec: Math.round(10 * pace / 60) * 60, sections: null, locked: false, spread: "bank_proportional", seed_rule: "daily_ist_date", shortfall: "refuse", min_viable: 10 });
    var c = Math.max(5, Math.min(100, opts.count || 20));
    if (type === "diagnostic") c = opts.count || 20;
    return ext(base, { count: c, duration_sec: c * pace, sections: null, locked: false, spread: type === "diagnostic" ? "diagnostic" : "scope", min_viable: Math.min(c, 5) });
  }
  function ext(a, b) { var o = {}, k; for (k in a) o[k] = a[k]; for (k in b) o[k] = b[k]; return o; }
  // Largest-remainder split of n over weights { key: w }; keys with weight 0 get 0. Ties go to the bigger weight, then key.
  function apportion(n, w) {
    var keys = Object.keys(w).filter(function (k) { return w[k] > 0; }), tot = 0, out = {}, used = 0;
    keys.forEach(function (k) { tot += w[k]; });
    if (!tot || n <= 0) { keys.forEach(function (k) { out[k] = 0; }); return out; }
    var rem = keys.map(function (k) { var x = n * w[k] / tot, f = Math.floor(x); out[k] = f; used += f; return { k: k, r: x - f, w: w[k] }; });
    rem.sort(function (a, b) { return b.r - a.r || b.w - a.w || (a.k < b.k ? -1 : 1); });
    for (var i = 0; used < n && i < rem.length; i++, used++) out[rem[i].k]++;
    return out;
  }

  /* ---------- assembly ---------- */
  /* assemble(p, type, opts, bank) -> { ok, items, count, requested, blueprint, planned, actual, deviations, reduced,
     refused, sections, seed, styles }
     bank: [{ s: subject id, m: module id, items: [...] }] (modules loaded for the scope; items carry _s/_m).
     opts: { count, seed, subjects: [ids] (scope), modules: [ids], difficulty: 1-4, image: true, exclude: {id:1},
             recent: {id:1} (soft: used only when unseen run out), hidden, quality, history: { subject: { t, ok } } } */
  function assemble(p, type, opts, bank) {
    opts = opts || {};
    var bp = blueprint(p, type, opts), dev = [];
    if (!bp) return { ok: false, refused: "This test type does not apply to " + (p ? p.name : "this exam") + ".", items: [], deviations: [] };
    var seed = opts.seed != null ? String(opts.seed) : String(Math.random()), R = rng(seed);
    var want = bp.count;
    // 1. eligible pool per subject, deduplicated (id and normalised stem) across the whole bank given
    var ctx = { hidden: opts.hidden, exclude: opts.exclude, quality: opts.quality, hashOf: opts.hashOf }, seenId = {}, seenStem = {}, pool = {}, drop = {}, dupN = 0, inScope = {};
    (opts.subjects || []).forEach(function (s) { inScope[s] = 1; });
    var modOk = null; if (opts.modules && opts.modules.length) { modOk = {}; opts.modules.forEach(function (m) { modOk[m] = 1; }); }
    (bank || []).forEach(function (l) {
      if (opts.subjects && opts.subjects.length && !inScope[l.s]) return;
      if (modOk && !modOk[l.m]) return;
      (l.items || []).forEach(function (it) {
        var why = eligible(it, ctx, type);
        if (!why && opts.difficulty && levelOf(it) !== opts.difficulty) why = "difficulty";
        if (!why && opts.image && !hasImage(it)) why = "no-image";
        if (why) { drop[why] = (drop[why] || 0) + 1; return; }
        var ns = normStem(it.q);
        if (seenId[it.id] || (ns.length >= 12 && seenStem[ns])) { dupN++; return; }
        seenId[it.id] = 1; if (ns.length >= 12) seenStem[ns] = 1;
        (pool[l.s] || (pool[l.s] = [])).push({ it: it, m: l.m });
      });
    });
    Object.keys(pool).forEach(function (s) {
      // unseen first, then recently attempted (soft); random within each, round-robin across modules
      var rec = opts.recent || {}, fresh = [], old = [];
      shuffle(pool[s], R).forEach(function (x) { (rec[x.it.id] ? old : fresh).push(x); });
      pool[s] = rr(fresh).concat(rr(old));
    });
    var avail = {}; Object.keys(pool).forEach(function (s) { avail[s] = pool[s].length; });
    // 2. planned quotas
    var planned = {}, spread = bp.spread;
    if (spread === "official_counts") {
      var bs = p.blueprint.subjects, un = p.blueprint.unmapped || {}, all = {}, k;
      for (k in bs) all[k] = bs[k]; for (k in un) all["~" + k] = un[k];
      planned = apportion(want, all);
      for (k in planned) if (k.charAt(0) === "~" && planned[k]) dev.push(cap1(k.slice(1)) + ": " + planned[k] + " planned by the official blueprint; the bank has no " + k.slice(1) + " questions, so the test is " + planned[k] + " shorter.");
    } else if (spread === "diagnostic") {
      planned = diagnosticPlan(want, avail, opts.history || {}, R);
    } else {
      planned = apportion(want, avail);
    }
    // 3. take per quota; official quotas shrink, proportional spreads may move a shortfall to other in-scope subjects
    var take = {}, short = 0, out = [];
    Object.keys(planned).forEach(function (s) {
      if (s.charAt(0) === "~") return;
      var n = planned[s], have = avail[s] || 0, t = Math.min(n, have);
      take[s] = t;
      if (t < n) { short += n - t; if (spread === "official_counts") dev.push(s + ": " + n + " planned by the official blueprint, " + have + " eligible in the bank."); }
    });
    if (short && spread !== "official_counts") {
      var room = {}; Object.keys(avail).forEach(function (s) { var r0 = avail[s] - (take[s] || 0); if (r0 > 0) room[s] = r0; });
      var add = apportion(Math.min(short, sum(room)), room);
      Object.keys(add).forEach(function (s) { if (add[s]) { take[s] = (take[s] || 0) + add[s]; short -= add[s]; } });
      if (spread !== "scope" && Object.keys(add).some(function (s) { return add[s]; })) dev.push("The spread across subjects moved " + Object.keys(add).filter(function (s) { return add[s]; }).length + " subjects' shares to keep the count: some subjects had too few eligible questions.");
    }
    // diagnostic: per subject, half at medium, half at the student's own target level
    Object.keys(take).forEach(function (s) {
      var lst = pool[s] || [], n = take[s];
      if (spread === "diagnostic" && opts.history) lst = diagOrder(lst, (opts.history[s] || {}), n);
      lst.slice(0, n).forEach(function (x) { out.push(x.it); });
    });
    // style quotas (profile item_styles with a share): recorded always, enforced only when the share is known
    var styles = {}; out.forEach(function (it) { var y = itemStyle(it); styles[y] = (styles[y] || 0) + 1; });
    (p.item_styles || []).forEach(function (y) {
      var have = styles[y.style] || 0;
      if (y.share == null) dev.push(styleName(y.style) + ": " + have + " of " + out.length + " (no quota: the official document does not give a share).");
      else { var need = Math.round(y.share * out.length); if (have < need) dev.push(styleName(y.style) + ": " + have + " in this test, " + need + " planned (" + Math.round(y.share * 100) + "%); the bank had too few."); }
    });
    out = shuffle(out, R);
    var count = out.length, reduced = count < want;
    if (dupN) dev.push(dupN + " duplicate " + (dupN === 1 ? "question was" : "questions were") + " left out (same item or same question text).");
    if (reduced) dev.unshift("Reduced to " + count + " of " + want + " questions: the bank does not hold enough eligible questions for this blueprint.");
    var refused = null;
    if (count < bp.min_viable || !count) refused = count ? "Only " + count + " eligible questions: this test needs at least " + bp.min_viable + "." : "No eligible questions for this test yet.";
    // sections: the official sizes, scaled down together when the test shrank (pace kept)
    var sections = null;
    if (bp.sections) {
      var w = {}; bp.sections.forEach(function (s, i) { w[i] = s.n; });
      var sizes = apportion(count, w), from = 0;
      sections = bp.sections.map(function (s, i) { var n = sizes[i] || 0, x = { id: s.id, label: s.label, part: s.part, n: n, sec: n === s.n ? s.sec : Math.round(s.sec * n / s.n), from: from, to: from + n }; from += n; return x; }).filter(function (s) { return s.n > 0; });
      if (reduced) dev.push("Sections keep the exam's pace: " + sections.map(function (s) { return s.label + " " + s.n + " questions in " + Math.round(s.sec / 60) + " min"; }).join(", ") + ".");
    }
    var actual = {}; out.forEach(function (it) { actual[it._s] = (actual[it._s] || 0) + 1; });
    var pl = {}; Object.keys(planned).forEach(function (s) { if (planned[s]) pl[s.charAt(0) === "~" ? s.slice(1) : s] = planned[s]; });
    return { ok: !refused, refused: refused, items: out, count: count, requested: want, reduced: reduced, blueprint: bp, seed: seed, planned: pl, actual: actual, styles: styles, deviations: dev, dropped: drop, sections: sections,
      duration_sec: bp.sections ? sum(sections.map(function (s) { return s.sec; })) : (type === "daily10" ? bp.duration_sec : count * bp.pace) };
  }
  function cap1(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function styleName(s) { return s === "statement_combination" ? "Statement-combination (multiple correct) questions" : s; }
  function sum(o) { var t = 0; (Array.isArray(o) ? o : Object.keys(o).map(function (k) { return o[k]; })).forEach(function (x) { t += x || 0; }); return t; }
  // round-robin across modules so one module does not dominate a subject's share
  function rr(list) {
    var by = {}, order = [];
    list.forEach(function (x) { if (!by[x.m]) { by[x.m] = []; order.push(x.m); } by[x.m].push(x); });
    var out = [], more = true;
    for (var i = 0; more; i++) { more = false; order.forEach(function (m) { if (by[m][i]) { out.push(by[m][i]); more = true; } }); }
    return out;
  }
  /* Diagnostic (simple, from the student's own history): subjects never or least answered first, then the weakest by
     accuracy, 2 questions each until the count is reached; within a subject one at medium and one at the level the
     student's own accuracy there suggests. No prediction is made from it. */
  function diagnosticPlan(n, avail, hist, R) {
    var subs = Object.keys(avail).filter(function (s) { return avail[s] > 0; });
    subs = shuffle(subs, R).sort(function (a, b) {
      var x = hist[a] || { t: 0, ok: 0 }, y = hist[b] || { t: 0, ok: 0 };
      var xa = x.t >= 5 ? 1 : 0, ya = y.t >= 5 ? 1 : 0;
      if (xa !== ya) return xa - ya;
      return xa ? x.ok / x.t - y.ok / y.t : x.t - y.t;
    });
    var out = {}, left = n;
    for (var round0 = 0; left > 0 && round0 < 50; round0++) {
      var moved = false;
      subs.forEach(function (s) { if (left <= 0) return; var have = (out[s] || 0); if (have < avail[s]) { var add = Math.min(2, avail[s] - have, left); out[s] = have + add; left -= add; moved = true; } });
      if (!moved) break;
    }
    return out;
  }
  function targetLevel(h) { if (!h || (h.t || 0) < 5) return 2; var a = h.ok / h.t; return a >= 0.9 && h.t >= 10 ? 4 : a >= 0.8 ? 3 : a >= 0.6 ? 2 : 1; }
  function diagOrder(lst, h, n) {
    var tgt = targetLevel(h), med = lst.filter(function (x) { return levelOf(x.it) === 2; }), at = lst.filter(function (x) { return levelOf(x.it) === tgt; }), out = [], used = {};
    for (var i = 0; out.length < n && i < n; i++) { var src = i % 2 ? at : med; var x = src.filter(function (y) { return !used[y.it.id]; })[0]; if (x) { used[x.it.id] = 1; out.push(x); } }
    lst.forEach(function (x) { if (out.length < n && !used[x.it.id]) { used[x.it.id] = 1; out.push(x); } });
    return out;
  }

  /* ---------- section clock (rules in the header) ---------- */
  function scNew(sections) { return { k: -1, lim: sections.map(function (s) { return s.sec * 1000; }), used: sections.map(function () { return 0; }), closed: sections.map(function () { return false; }), why: sections.map(function () { return ""; }), run: false, mono: null, wall: null }; }
  function scLeft(c, k) { k = k == null ? c.k : k; return k < 0 ? 0 : Math.max(0, c.lim[k] - c.used[k]); }
  function scStart(c, k, mono, wall) { if (c.closed[k]) return false; c.k = k; c.run = true; c.mono = mono; c.wall = wall; return true; }
  // Charge the open section up to (mono, wall); returns the ms left. mono may be null (just resumed: wall only).
  function scCharge(c, mono, wall) {
    if (!c.run || c.k < 0) return scLeft(c);
    var dm = mono != null && c.mono != null && mono >= c.mono ? mono - c.mono : 0, dw = wall - c.wall;
    if (dw < -CLOCK_BACK_MS) { c.used[c.k] = c.lim[c.k]; c.why[c.k] = "clock"; }
    else c.used[c.k] = Math.min(c.lim[c.k], c.used[c.k] + Math.max(dm, dw > 0 ? dw : 0));
    c.mono = mono; if (dw > 0 || dw < -CLOCK_BACK_MS) c.wall = wall;
    return scLeft(c);
  }
  // After the app was killed: charge the wall-clock gap since the last save (rule 3); returns ms left.
  function scResume(c, wall) { if (!c.run) return scLeft(c); c.mono = null; return scCharge(c, null, wall); }
  function scClose(c, k, why) { c.closed[k] = true; if (!c.why[k]) c.why[k] = why || ""; if (c.k === k) c.run = false; }

  /* ---------- scoring ---------- */
  function r2(x) { return Math.round(x * 100) / 100; }
  /* score(items, ans, scoring, opts) -> result parts. scoring: profile.scoring. opts: { sections: [{ id, label, from, to }],
     ms: [per-item ms], subjectName(id), topicName(sid, mid) }. Marks rounded to 2 decimals like scoreMock. */
  function score(items, ans, sc, opts) {
    opts = opts || {};
    var plus = sc.correct, minus = -sc.incorrect, by = { subject: {}, topic: {}, difficulty: {}, section: {} };
    var tot = { correct: 0, incorrect: 0, unanswered: 0 }, ms = 0, msn = 0;
    function add(map, key, label, ok, bl) { var b = map[key] || (map[key] = { key: key, label: label, n: 0, correct: 0, incorrect: 0, unanswered: 0, raw: 0 }); b.n++; if (bl) b.unanswered++; else if (ok) { b.correct++; b.raw += plus; } else { b.incorrect++; b.raw -= minus; } }
    var secOf = {}; (opts.sections || []).forEach(function (s) { for (var i = s.from; i < s.to; i++) secOf[i] = s; });
    items.forEach(function (it, i) {
      var a = ans[i], bl = !(a >= 0), ok = !bl && a === it.a;
      if (bl) tot.unanswered++; else if (ok) tot.correct++; else tot.incorrect++;
      add(by.subject, it._s || "?", opts.subjectName ? opts.subjectName(it._s) : it._s, ok, bl);
      add(by.topic, (it._s || "?") + "|" + (it._m || it.t || "?"), opts.topicName ? opts.topicName(it._s, it._m || it.t) : (it._m || it.t), ok, bl);
      add(by.difficulty, String(levelOf(it)), ["", "Easy", "Medium", "Hard", "Very hard"][levelOf(it)], ok, bl);
      if (secOf[i]) add(by.section, secOf[i].id, secOf[i].label, ok, bl);
      if (opts.ms && opts.ms[i] > 0) { ms += opts.ms[i]; msn++; }
    });
    function list(m) { return Object.keys(m).map(function (k) { var b = m[k]; b.raw = r2(b.raw); b.accuracy = b.correct + b.incorrect ? r2(b.correct / (b.correct + b.incorrect)) : null; return b; }); }
    var answered = tot.correct + tot.incorrect;
    return { raw: r2(tot.correct * plus - tot.incorrect * minus), max: items.length * plus, correct: tot.correct, incorrect: tot.incorrect, unanswered: tot.unanswered,
      accuracy: answered ? r2(tot.correct / answered) : null, share_right: items.length ? r2(tot.correct / items.length) : 0, avg_ms: msn ? Math.round(ms / msn) : null,
      scheme: { correct: sc.correct, incorrect: sc.incorrect, unanswered: sc.unanswered },
      pass: sc.pass ? { marks: sc.pass.marks, of: sc.pass.of, share: r2(sc.pass.marks / sc.pass.of) } : null,
      by_section: list(by.section), by_subject: list(by.subject), by_topic: list(by.topic), by_difficulty: list(by.difficulty) };
  }
  /* result(run) -> the attempt record (prep/assess/schemas/result.schema.json). run: { attempt_id, idempotency_key, exam,
     profile_version, test_type, blueprint, started, finished, state, items, ans, mark, changed, ms, sections, asm } */
  function result(x, p, opts) {
    var sc = score(x.items, x.ans, p.scoring, ext(opts || {}, { sections: x.sections, ms: x.ms }));
    var secOf = {}; (x.sections || []).forEach(function (s) { for (var i = s.from; i < s.to; i++) secOf[i] = s.id; });
    var rec = {
      attempt_id: x.attempt_id, idempotency_key: x.idempotency_key || undefined, exam: p.id, profile_version: p.version, blueprint_id: x.blueprint ? x.blueprint.id : undefined, blueprint_version: x.blueprint ? x.blueprint.version : undefined,
      test_type: x.test_type, started_at: new Date(x.started).toISOString(), finished_at: x.finished ? new Date(x.finished).toISOString() : null, state: x.state || "submitted",
      items: x.items.map(function (it, i) { var a = x.ans[i]; return { item_id: String(it.id), chosen: a >= 0 ? a : null, correct: a >= 0 ? a === it.a : null, ms: Math.round((x.ms && x.ms[i]) || 0), marked: !!(x.mark && x.mark[i]), changed: (x.changed && x.changed[i]) || 0, section: secOf[i] || null }; }),
      score: { raw: sc.raw, max: sc.max, correct: sc.correct, incorrect: sc.incorrect, unanswered: sc.unanswered, accuracy: sc.accuracy, avg_ms: sc.avg_ms, scheme: sc.scheme },
      by_section: sc.by_section, by_subject: sc.by_subject, by_topic: sc.by_topic, by_difficulty: sc.by_difficulty,
      distribution: x.asm ? { planned: x.asm.planned, actual: x.asm.actual, deviations: x.asm.deviations.slice() } : { planned: {}, actual: {}, deviations: [] },
      next_actions: nextActions(sc), cohort: null
    };
    if (rec.idempotency_key === undefined) delete rec.idempotency_key;
    if (rec.blueprint_id === undefined) { delete rec.blueprint_id; delete rec.blueprint_version; }
    return rec;
  }
  // The weakest topics with at least 2 questions answered wrong or skipped, at most 3: practise that topic next.
  function nextActions(sc) {
    return sc.by_topic.filter(function (b) { return b.n - b.correct >= 2; }).sort(function (a, b) { return (a.correct / a.n) - (b.correct / b.n) || b.n - a.n; }).slice(0, 3)
      .map(function (b) { return { kind: "practise_topic", target_id: b.key, why: (b.n - b.correct) + " of " + b.n + " missed" }; });
  }
  // Earlier attempts of the same profile and test type by this student, oldest first, for the grand test trend.
  function ownTrend(history, rec) { return (history || []).filter(function (h) { return h.exam === rec.exam && h.test_type === rec.test_type && h.attempt_id !== rec.attempt_id; }).slice(-5); }
  function rankShown(n) { return typeof n === "number" && n >= RANK_MIN_N; }

  /* ---------- daily 10 ---------- */
  function dailyKey(exam, ms) { return "daily10:" + exam + ":" + istDate(ms); }
  // Completion is written once per key; a retry (or a second finish after a crash) keeps the first record.
  function dailyComplete(map, key, rec) { if (map[key]) return { map: map, rec: map[key], fresh: false }; map[key] = rec; return { map: map, rec: rec, fresh: true }; }
  function dailyPrune(map, ms, keepDays) { var cut = istDate(ms - (keepDays || 60) * 864e5); Object.keys(map).forEach(function (k) { if (k.slice(-10) < cut) delete map[k]; }); return map; }

  /* ---------- in-progress session (saved to IndexedDB by prep-tests.js) ---------- */
  function sessPack(run, now) {
    return { v: 1, saved: now, t2: run.t2, title: run.title, mode: run.mode, i: run.i, ans: run.ans.slice(), mark: ext({}, run.mark || {}), ms: (run.ms || []).slice(), changed: (run.changed || []).slice(),
      q: run.items.map(function (it) { return [it._s, it._m || it.t, String(it.id)]; }), sc: run.sc ? JSON.parse(JSON.stringify(run.sc)) : null, t0: run.t0, limit: run.limit || 0, phase: run.phase || "" };
  }
  // sessUnpack(pack, lists) -> { items, missing } with lists { "subject|module": items }; a question no longer in its
  // module (withdrawn) is reported missing rather than dropped silently (its answer slot is kept).
  function sessUnpack(pk, lists) {
    var items = [], missing = 0;
    (pk.q || []).forEach(function (x) {
      var l = lists[x[0] + "|" + x[1]] || [], hit = null;
      for (var i = 0; i < l.length; i++) if (String(l[i].id) === x[2]) { hit = l[i]; break; }
      if (!hit) { missing++; hit = { id: x[2], q: "This question is no longer available.", o: ["-", "-", "-", "-"], a: -9, _s: x[0], _m: x[1], _gone: true }; }
      items.push(hit);
    });
    return { items: items, missing: missing };
  }

  var API = { RANK_MIN_N: RANK_MIN_N, CLOCK_BACK_MS: CLOCK_BACK_MS, SAVE_EVERY_MS: SAVE_EVERY_MS, TYPES: TYPES,
    profiles: profiles, profileIds: profileIds, profile: profile, forTab: forTab, paceSec: paceSec, scheme: scheme, legacyMocks: legacyMocks, schemes: schemes, coreProfiles: coreProfiles, validateProfile: validateProfile, provOf: provOf,
    rng: rng, hashStr: hashStr, istDate: istDate, normStem: normStem, isCombination: isCombination, hasImage: hasImage, itemStyle: itemStyle, levelOf: levelOf, eligible: eligible, readQuality: readQuality,
    blueprint: blueprint, apportion: apportion, assemble: assemble, targetLevel: targetLevel,
    scNew: scNew, scLeft: scLeft, scStart: scStart, scCharge: scCharge, scResume: scResume, scClose: scClose,
    score: score, result: result, nextActions: nextActions, ownTrend: ownTrend, rankShown: rankShown,
    dailyKey: dailyKey, dailyComplete: dailyComplete, dailyPrune: dailyPrune, sessPack: sessPack, sessUnpack: sessUnpack };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (G) G.PREP_ASSESS = API;
})(typeof window !== "undefined" ? window : null);
