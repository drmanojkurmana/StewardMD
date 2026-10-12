/* Nucleus360: learn a topic A to Z through MCQs (owner idea 2026-10-12). window.PREP_NUCLEUS360. ES5.
   The feature name, tagline and every user-visible label come from the ONE config constant NUCLEUS360 below:
   button "Nucleus360", screen titles, the summary card and share text. No logo: the app's existing mark style.

   What it does. On any topic screen the student taps Nucleus360 (or searches a topic by name in the Nucleus360
   hub) and gets the chapter as MCQs in chapter order: a concept outline (the chapter map, deterministic, from the
   KB disease page / lesson sections plus a standard high-yield template per topic type), at least one MCQ per
   concept (existing approved bank MCQs first, free; gaps filled by the MaiK pipeline into overlay set maiktopic1),
   Learn mode (in order, explanation at once), Test mode (shuffled, timed), Revise mode (weak concepts only), a
   progress rail ("Concept 4 of 12: Investigations"), a coverage meter (concepts covered x/N, honest counts) and a
   Topic summary card (per-concept right/wrong/self-reported confidence, what to revise with lesson/KB links, a
   one-page revision list).

   Boundaries (owner rules). Existing explanations are never rewritten: the concept title and the Chapter note wrap
   the unchanged explanation (wrap()). New MCQs come only from the existing qgen pipeline with its gates; this file
   creates none. References are cited only where verified: a concept's source names the KB page/field, the lesson or
   the template it came from, never a textbook or guideline that was not checked. No rank, percentile or prediction
   anywhere. Clinical guideline precedence: where NICE covers a point NICE wins; India/US guidance is labelled.
   Optional module: without this file (or outside a Nucleus360 session) every screen renders exactly as before.
   Flag smd_prep_nucleus360, default ON for all (TestFlight): localStorage "0" or ?nucleus360=0 turns it off. */
(function (G) {
  "use strict";

  /* ================= the ONE config constant ================= */
  var NUCLEUS360 = {
    id: "nucleus360",
    name: "Nucleus360",
    tagline: "Learn a topic A to Z through MCQs",
    button: "Nucleus360",
    flag: "smd_prep_nucleus360",
    overlaySet: "maiktopic1",
    topicsPath: "nucleus360/topics.json",
    storeKey: "smd_prep_n360",
    linksVer: "v1",
    showConf: 75
  };

  /* ================= pure ================= */
  // Concept slots per topic type: the standard high-yield template. tier: core (extra questions),
  // high (two), extra (one). kw: matching hints on top of the title words (matching is token overlap only).
  var TEMPLATES = {
    disease: [
      { id: "def-epi", title: "Definition and epidemiology", tier: "core", kw: "define definition epidemiology incidence prevalence age sex" },
      { id: "aet", title: "Aetiology and risk factors", tier: "core", kw: "cause aetiology etiology risk factor predispose" },
      { id: "path", title: "Pathogenesis and pathology (incl. genetics)", tier: "core", kw: "pathogenesis pathology mechanism genetic mutation molecular histology" },
      { id: "clin", title: "Clinical features and variants", tier: "core", kw: "symptom sign clinical feature present presentation variant" },
      { id: "comp", title: "Complications", tier: "high", kw: "complication sequelae" },
      { id: "inv", title: "Investigations (labs, imaging, histology, markers)", tier: "core", kw: "investigation test lab imaging x-ray ct mri ultrasound biopsy histology marker ecg blood" },
      { id: "dx", title: "Diagnosis and staging", tier: "core", kw: "diagnose diagnosis diagnostic criteria stage staging grade gold standard" },
      { id: "ddx", title: "Differential diagnosis", tier: "high", kw: "differential distinguish versus mimic" },
      { id: "rx", title: "Management (medical, surgical, guideline-based)", tier: "core", kw: "treat treatment manage management drug dose surgery indication guideline therapy" },
      { id: "prog", title: "Prognosis and follow-up", tier: "high", kw: "prognosis survival mortality follow up outcome" },
      { id: "prev", title: "Prevention and screening", tier: "extra", kw: "prevent prevention screen screening vaccine prophylaxis" },
      { id: "guide", title: "Recent guideline changes", tier: "extra", kw: "guideline nice recommend update change" },
      { id: "pearl", title: "Exam pearls and classic one-liners", tier: "high", kw: "classic pearl mnemonic remembered one-liner" },
      { id: "img", title: "Images", tier: "extra", kw: "image figure picture radiograph photograph" }
    ],
    drug: [
      { id: "mech", title: "Mechanism of action", tier: "core", kw: "mechanism action receptor inhibit block agonist antagonist" },
      { id: "kin", title: "Pharmacokinetics", tier: "high", kw: "kinetic absorption distribution metabolism excretion half life" },
      { id: "uses", title: "Therapeutic uses", tier: "core", kw: "use indication treat" },
      { id: "ae", title: "Adverse effects", tier: "core", kw: "adverse side effect toxicity adverse" },
      { id: "inter", title: "Drug interactions", tier: "high", kw: "interaction combine" },
      { id: "contra", title: "Contraindications", tier: "high", kw: "contraindicat avoid caution" },
      { id: "monitor", title: "Monitoring", tier: "extra", kw: "monitor level follow" },
      { id: "pearl", title: "Exam pearls and classic one-liners", tier: "high", kw: "classic pearl mnemonic" }
    ],
    procedure: [
      { id: "def-ind", title: "Definition and indications", tier: "core", kw: "define definition indication" },
      { id: "anat", title: "Anatomy and landmarks", tier: "core", kw: "anatomy landmark nerve vessel muscle" },
      { id: "steps", title: "Steps and technique", tier: "core", kw: "step technique procedure perform approach" },
      { id: "comp", title: "Complications", tier: "core", kw: "complication" },
      { id: "post", title: "Post-procedure care and follow-up", tier: "high", kw: "post care follow" },
      { id: "pearl", title: "Exam pearls and classic one-liners", tier: "high", kw: "classic pearl mnemonic" }
    ],
    basic: [
      { id: "def", title: "Definition and key facts", tier: "core", kw: "define definition" },
      { id: "mech", title: "Mechanism and pathway", tier: "core", kw: "mechanism pathway cycle step" },
      { id: "clin", title: "Clinical application", tier: "core", kw: "clinical apply disease deficiency" },
      { id: "inv", title: "Tests and values", tier: "high", kw: "test value normal range lab" },
      { id: "pearl", title: "Exam pearls and classic one-liners", tier: "high", kw: "classic pearl mnemonic" }
    ]
  };
  // KB disease-page fields that back each disease concept (kb/diseases/*.json). A concept whose evidence field is
  // present on the page cites kb:<id>#<field>; otherwise it cites the template. Nothing is invented.
  var KB_BACKING = { "def-epi": ["name", "class", "system", "coding"], clin: ["redFlags"], comp: ["redFlags"], inv: ["investigations", "valueTables"], dx: ["algorithms", "tables"], ddx: ["matching"], rx: ["treatmentRef", "drugRefs"], prog: ["flowcharts"], pearl: ["tables"], img: ["diagrams"] };
  var PER_TIER = { core: 3, high: 2, extra: 1 };

  function isStr(s) { return typeof s === "string" && !!s.trim(); }
  function toks(s) { return String(s == null ? "" : s).toLowerCase().match(/[a-z0-9]+/g) || []; }
  // Function words carry no concept meaning ("and" sits in half the chapter titles); never match on them.
  var STOPW = {};
  "and,the,with,for,from,that,this,these,those,are,was,were,been,has,have,had,does,did,who,whom,which,what,when,where,how,why,not,nor,but,per,all,any,one,two,can,may,might,must,shall,will,would,could,should,more,most,very,own,such,than,then,also,into,over,under,between,through,during,without,within,about,against,among,across,behind,along,upon,else,just,are,was".split(",").forEach(function (w) { STOPW[w] = 1; });
  function escH(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  // typeOf(topic) -> disease|drug|procedure|basic. Explicit type wins; names ending in a drug suffix read as drugs.
  function typeOf(t) {
    var ty = t && t.type;
    if (ty === "disease" || ty === "drug" || ty === "procedure" || ty === "anatomy" || ty === "physiology") return ty === "anatomy" || ty === "physiology" ? "basic" : ty;
    var n = String((t && (t.title || t.id)) || "").toLowerCase();
    if (/(mab|nib|pril|olol|sartan|statin|mycin|cillin|prazole|dipine|gliptin|gliflozin|parib|zumab)$/.test(n.replace(/[^a-z]/g, ""))) return "drug";
    return "disease";
  }
  function kbHas(kb, field) {
    if (!kb || !field) return false;
    var v = kb[field];
    if (v == null) return false;
    if (typeof v === "string") return !!v.trim();
    if (v.length != null) return v.length > 0;
    return true;
  }
  /* outlineOf(topic) -> [{ id, title, tier, source }], ordered chapter map, deterministic. topic { id, title, type,
     kb (page object or null), lesson (index entry { id, title } or null) }. source is kb:<page>#<field>,
     lesson:<id> or template:<type>: where the concept came from. */
  function outlineOf(topic) {
    var ty = typeOf(topic || {}), slots = TEMPLATES[ty] || TEMPLATES.disease;
    var kb = (topic && topic.kb) || null, kbId = kb && (kb.id || topic.kbId);
    var back = ty === "disease" ? KB_BACKING : {};
    return slots.map(function (s) {
      var src = "template:" + ty, fields = back[s.id] || [];
      for (var i = 0; i < fields.length; i++) if (kbHas(kb, fields[i])) { src = "kb:" + kbId + "#" + fields[i]; break; }
      if (src.charAt(0) === "t" && topic && topic.lesson && (s.id === "pearl" || s.id === "rx" || s.id === "clin" || s.id === "uses" || s.id === "steps")) src = "lesson:" + (topic.lesson.id || topic.lesson);
      return { id: s.id, title: s.title, tier: s.tier, source: src };
    });
  }
  function wordsOf(c, ty) {
    var set = {}, i, w;
    var slots = TEMPLATES[ty] || TEMPLATES.disease;
    for (i = 0; i < slots.length; i++) if (slots[i].id === c.id) {
      var all = toks(c.title + " " + slots[i].kw);
      for (var k = 0; k < all.length; k++) if (all[k].length > 2 && !STOPW[all[k]]) set[all[k]] = 1;
      break;
    }
    return set;
  }
  function itemText(it) {
    var x = (it && it.x) || {};
    return [it.q, (it.o || []).join(" "), it.exp, x.lo, x.clues, x.ddx, x.mechanism, x.mech, x.rev, x.pearl].map(function (v) { return String(v == null ? "" : v); }).join(" ");
  }
  /* matchConcepts(outline, items, type) -> { assign: { conceptId: [itemId] }, unassigned: [itemId] }. Weighted token
     overlap with the concept (title + slot hints): the stem states what the question tests (x3), the options (x2);
     the explanation and reasoning fields teach broadly, so their vote is capped at 2 points and never drowns the
     tested point. The Images concept only accepts items that actually bear an image: a stem that merely mentions
     a picture teaches no image reading. Ties go to the earlier concept, then item order. Deterministic. Items
     matching nothing are listed, never forced. */
  function matchConcepts(outline, items, type) {
    var ws = (outline || []).map(function (c) { return wordsOf(c, type); });
    var assign = {}, un = [];
    (outline || []).forEach(function (c) { assign[c.id] = []; });
    (items || []).forEach(function (it) {
      if (!it || !it.id) return;
      var x = (it && it.x) || {};
      var fields = [
        { t: toks(it.q), w: 3 },
        { t: toks((it.o || []).join(" ")), w: 2 },
        { t: toks([it.exp, x.lo, x.clues, x.ddx, x.mechanism, x.mech, x.rev, x.pearl].map(function (v) { return String(v == null ? "" : v); }).join(" ")), w: 1 }
      ];
      var best = -1, bestS = 0;
      for (var i = 0; i < outline.length; i++) {
        if (outline[i].id === "img" && !(it.img || (it.x && it.x.img))) continue;
        var sc = 0, seen = {};
        for (var f = 0; f < fields.length; f++) {
          var tk = fields[f].t, cap = fields[f].w > 1 ? 99 : 2, used = 0;
          for (var j = 0; j < tk.length; j++) {
            var w = tk[j];
            if (w.length > 2 && !STOPW[w] && ws[i][w] && !seen[w] && used < cap) { sc += fields[f].w; seen[w] = 1; used++; }
          }
        }
        if (sc > bestS) { bestS = sc; best = i; }
      }
      if (best >= 0) assign[outline[best].id].push(it.id);
      else un.push(it.id);
    });
    return { assign: assign, unassigned: un };
  }
  /* orderForStudy(outline, assign, mode, seed) -> [{ concept, items }] in chapter order (learn), shuffled with the
     seed (test), or weak concepts only (revise; weakIds names them). Per concept at most PER_TIER[tier] items unless
     opts.all. No invented items: ids come only from assign. */
  function orderForStudy(outline, assign, mode, seed, weakIds, all) {
    var rows = (outline || []).map(function (c, i) {
      var ids = ((assign || {})[c.id] || []).slice(), cap = all ? ids.length : (PER_TIER[c.tier] || 1);
      return { concept: c, pos: i, items: ids.slice(0, cap) };
    }).filter(function (r) { return r.items.length > 0; });
    if (mode === "revise" && weakIds) rows = rows.filter(function (r) { return weakIds.indexOf(r.concept.id) >= 0; });
    if (mode === "test") {
      var h = 2166136261, s = String(seed == null ? "n360" : seed);
      for (var k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 16777619) >>> 0; }
      var rnd = function () { h ^= h << 13; h >>>= 0; h ^= h >> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
      var flat = [];
      rows.forEach(function (r) { r.items.forEach(function (id) { flat.push({ c: r.concept, id: id }); }); });
      for (var i = flat.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)), x = flat[i]; flat[i] = flat[j]; flat[j] = x; }
      var by = {};
      flat.forEach(function (f) { (by[f.c.id] || (by[f.c.id] = { concept: f.c, pos: 0, items: [] })).items.push(f.id); });
      rows = (outline || []).map(function (c) { return by[c.id]; }).filter(Boolean);
      rows._shuffled = flat.map(function (f) { return f.id; });
    }
    return rows;
  }
  /* coverage(outline, assign) -> { total, covered, gaps, per }. Honest counts: covered = concepts with >= 1 item. */
  function coverage(outline, assign) {
    var per = (outline || []).map(function (c) {
      var n = ((assign || {})[c.id] || []).length;
      return { id: c.id, title: c.title, n: n, ok: n > 0 };
    });
    var cov = per.filter(function (p) { return p.ok; }).length;
    return { total: (outline || []).length, covered: cov, gaps: per.filter(function (p) { return !p.ok; }).map(function (p) { return p.id; }), per: per };
  }
  /* chapterNote(concept, pos, total, links) -> 2-3 lines closing the explanation: position, tier and where to revise
     (lesson/KB titles only). No medical claims, so nothing to verify. */
  function chapterNote(concept, pos, total, links) {
    var tier = concept.tier === "core" ? "Core concept" : concept.tier === "high" ? "High-yield" : "Extra";
    var rev = [];
    (links || []).forEach(function (l) { if (l && l.title) rev.push(l.title); });
    var s = tier + ", concept " + (pos + 1) + " of " + total + ".";
    if (rev.length) s += " Revise: " + rev.slice(0, 2).join("; ") + ".";
    return s;
  }
  /* railText(pos, total, concept) -> "Concept 4 of 12: Investigations". */
  function railText(pos, total, concept) { return "Concept " + (pos + 1) + " of " + total + ": " + concept.title; }
  /* summaryFor(order, results) -> per-concept { right, wrong, guess, n } + revise list. results { itemId:
     { ok: bool, conf: "sure"|"unsure"|"guess" } }. Accuracy under 60% or any guess marks revise. */
  function summaryFor(order, results) {
    var per = (order || []).map(function (r) {
      var right = 0, wrong = 0, guess = 0;
      r.items.forEach(function (id) {
        var x = (results || {})[id];
        if (!x) return;
        if (x.ok) right++; else wrong++;
        if (x.conf === "guess" || x.conf === "unsure") guess++;
      });
      var n = right + wrong;
      return { id: r.concept.id, title: r.concept.title, tier: r.concept.tier, source: r.concept.source, right: right, wrong: wrong, guess: guess, n: n, acc: n ? right / n : null, revise: n ? (right / n < 0.6 || guess > 0) : true };
    });
    return { per: per, revise: per.filter(function (p) { return p.revise; }).map(function (p) { return p.id; }) };
  }
  /* revisionList(summary, linksByConcept) -> one-page lines "Concept: status -> revise with X". */
  function revisionList(summary, linksByConcept) {
    return (summary.per || []).map(function (p) {
      var st = p.n === 0 ? "not attempted" : Math.round((p.right / p.n) * 100) + "% (" + p.right + "/" + p.n + ")" + (p.guess ? ", " + p.guess + " guessed" : "");
      var lk = ((linksByConcept || {})[p.id] || []).map(function (l) { return l.title; }).filter(Boolean).slice(0, 2).join("; ");
      return p.title + ": " + st + (p.revise ? " -> revise" + (lk ? " with " + lk : "") : " -> done");
    });
  }
  /* offlineGaps(cov) -> gap rows labelled for offline ("will be added when you are online"). */
  function offlineGaps(cov) { return (cov.gaps || []).map(function (id) { return { concept: id, offline: true, label: "will be added when you are online" }; }); }
  // findTopic(query, topics) -> the topic whose title/aliases share most words with the query (ties: earlier).
  function findTopic(query, topics) {
    var q = toks(query).filter(function (w) { return w.length > 2; });
    if (!q.length) return null;
    var best = null, bestS = 0;
    (topics || []).forEach(function (t) {
      var hay = toks(t.title + " " + (t.aliases || []).join(" ") + " " + (t.id || ""));
      var sc = 0;
      q.forEach(function (w) { for (var i = 0; i < hay.length; i++) if (hay[i] === w || (w.length > 4 && hay[i].indexOf(w) === 0)) { sc += 3; break; } });
      if (sc > bestS) { bestS = sc; best = t; }
    });
    return best;
  }

  var PURE = { NUCLEUS360: NUCLEUS360, TEMPLATES: TEMPLATES, KB_BACKING: KB_BACKING, PER_TIER: PER_TIER, typeOf: typeOf, outlineOf: outlineOf, matchConcepts: matchConcepts, orderForStudy: orderForStudy, coverage: coverage, chapterNote: chapterNote, railText: railText, summaryFor: summaryFor, revisionList: revisionList, offlineGaps: offlineGaps, findTopic: findTopic };
  if (typeof module !== "undefined" && module.exports && !(G && G.document)) { module.exports = PURE; return; }

  /* ================= browser ================= */
  var D = G.document, H = null, SES = null;
  function ses() { if (!SES) SES = { topicsP: null, map: null, topic: null, outline: null, order: null, mode: null }; return SES; }
  function on() {
    try { var q = (G.location.search.match(/[?&]nucleus360=([^&]+)/) || [])[1]; if (q != null) return q === "1" || q === "on" || q === "true"; return G.localStorage.getItem(NUCLEUS360.flag) !== "0"; } catch (e) { return true; }
  }
  function esc(s) { return H ? H.esc(s) : escH(s); }
  function loadTopics() {
    var S = ses();
    if (S.topicsP) return S.topicsP;
    var url = (H.staticBase || "/prep/") + NUCLEUS360.topicsPath;
    S.topicsP = H.getJSON(url).then(function (j) { return (j && j.topics) || []; }, function () { return []; });
    return S.topicsP;
  }
  function readProg() {
    try { return JSON.parse(G.localStorage.getItem(NUCLEUS360.storeKey) || "{}"); } catch (e) { return {}; }
  }
  function writeProg(p) { try { G.localStorage.setItem(NUCLEUS360.storeKey, JSON.stringify(p)); } catch (e) {} }
  // Confidence tap per concept (KnowYourIQ-style): Sure / Unsure / Guess, stored per topic+concept.
  function tapConf(topicId, conceptId, v) {
    var p = readProg(), k = topicId + "|" + conceptId;
    p[k] = { conf: v, ts: Date.now() };
    writeProg(p);
  }
  function confOf(topicId, conceptId) { var p = readProg(); return (p[topicId + "|" + conceptId] || {}).conf || null; }
  /* wrap(fb, item) -> the unchanged explanation wrapped with the concept rail + title above and the Chapter note
     below, only while a Nucleus360 session maps this item. Called by prep.js; without a session it returns fb. */
  function wrap(fb, item) {
    if (!SES || !SES.map || !item || !SES.map[item.id]) return fb;
    var m = SES.map[item.id];
    var rail = '<p class="pn-t2eb">' + escH(NUCLEUS360.name + " · " + railText(m.pos, m.total, m.concept)) + "</p>";
    var note = '<p class="pn-mut pn-small">' + escH("Chapter note: " + chapterNote(m.concept, m.pos, m.total, m.links || [])) + "</p>";
    var open = fb.indexOf(">") + 1;
    return fb.slice(0, open) + rail + fb.slice(open).replace(/<\/section>\s*$/, note + "</section>");
  }
  function conceptLinks(concept, topic) {
    var out = [];
    if (topic && topic.lesson) out.push({ k: "ls", title: "Lesson: " + (topic.lesson.title || topic.lesson.id || topic.lesson) });
    if (topic && topic.kbTitle) out.push({ k: "kb", title: topic.kbTitle });
    return out;
  }
  function startTopic(topic, mode) {
    H.stack().push(function () {});
    H.paint(H.bar(escH(NUCLEUS360.name), escH(topic.title), "back") + '<div class="pn-body"><p class="pn-load" role="status">Loading ' + escH(topic.title) + "…</p></div>");
    var outline = outlineOf(topic);
    var pairs = (topic.modules || []).map(function (x) { return { s: x[0], m: x[1] }; });
    if (!pairs.length && topic.subject && topic.module) pairs = [{ s: topic.subject, m: topic.module }];
    H.loadMany(pairs, H.stepMsg).then(function (lists) {
      var items = [];
      lists.forEach(function (l) { (l.items || []).forEach(function (it) { items.push(it); }); });
      var ty = typeOf(topic);
      var matched = matchConcepts(outline, items, ty);
      var weak = null;
      if (mode === "revise") {
        var prog = readProg();
        weak = outline.filter(function (c) {
          var cf = prog[topic.id + "|" + c.id];
          return cf && (cf.conf === "guess" || cf.conf === "unsure");
        }).map(function (c) { return c.id; });
        if (!weak.length) { H.stack().pop(); H.toast("No weak concepts marked yet. Tap Unsure or Guess on a concept first."); return openOutline(topic); }
      }
      var order = orderForStudy(outline, matched.assign, mode === "test" ? "test" : mode === "revise" ? "revise" : "learn", topic.id + ":" + mode, weak);
      if (!order.length) { H.stack().pop(); H.toast("No questions for this topic yet."); return openOutline(topic); }
      var ids = [];
      order.forEach(function (r) { r.items.forEach(function (id) { ids.push(id); }); });
      var byId = {};
      items.forEach(function (it) { byId[it.id] = it; });
      var list = ids.map(function (id) { return byId[id]; }).filter(Boolean);
      var flat = order._shuffled ? order._shuffled.map(function (id) { return byId[id]; }).filter(Boolean) : null;
      if (flat && flat.length) list = flat;
      // The session map drives wrap(): item id -> { concept, pos, total, links }.
      var S2 = ses();
      S2.map = {};
      order.forEach(function (r) { r.items.forEach(function (id) { S2.map[id] = { concept: r.concept, pos: r.pos, total: outline.length, links: conceptLinks(r.concept, topic) }; }); });
      S2.topic = topic; S2.outline = outline; S2.order = order; S2.mode = mode;
      H.stack().pop();
      var cov = coverage(outline, matched.assign);
      var title = mode === "test" ? NUCLEUS360.name + " test: " + topic.title : NUCLEUS360.name + " · " + topic.title + " (" + cov.covered + "/" + cov.total + " concepts)";
      if (mode === "test") H.run(list, "exam", title);
      else H.run(list, "study", title);
    }, function () {
      H.stack().pop();
      H.paint(H.bar(escH(NUCLEUS360.name), escH(topic.title), "back") + '<div class="pn-body"><p class="pn-err" role="alert">The questions did not load. ' + escH("What is on this phone is shown; the rest will be added when you are online.") + '</p><button type="button" class="pn-btn" data-act="back">Back</button></div>');
    });
  }
  function openOutline(topic) {
    var outline = outlineOf(topic);
    loadTopics().then(function () {
      var cov = { total: outline.length, covered: 0 };
      try {
        var pairs = (topic.modules || []).map(function (x) { return { s: x[0], m: x[1] }; });
        if (!pairs.length && topic.subject && topic.module) pairs = [{ s: topic.subject, m: topic.module }];
        var ix = H.ix(), n = 0;
        pairs.forEach(function (p) { var x = ix[p.s]; if (x) x.topics.forEach(function (t) { if (t.id === p.m) n += H.pure.countFor(t, H.exam().id); }); });
        cov = { total: outline.length, covered: n > 0 ? outline.length : 0 };
      } catch (e) {}
      var rows = outline.map(function (c, i) {
        var cf = confOf(topic.id, c.id);
        var chip = cf ? ' <span class="pn-t2b' + (cf === "sure" ? " ok" : "") + '">' + escH(cf === "sure" ? "Sure" : cf === "unsure" ? "Unsure" : "Guess") + "</span>" : "";
        return '<li><div class="pn-mod static"><span class="pn-mb"><b>' + (i + 1) + ". " + escH(c.title) + "</b><small>" + escH(c.tier === "core" ? "Core" : c.tier === "high" ? "High-yield" : "Extra") + chip + "</small></span>" +
          '<span class="pn-cf" role="group" aria-label="Confidence for ' + escH(c.title) + '">' +
          ["sure", "unsure", "guess"].map(function (v) { return '<button type="button" class="pn-chip' + (cf === v ? " on" : "") + '" data-act="n360-conf" data-t="' + escH(topic.id) + '" data-c="' + escH(c.id) + '" data-v="' + v + '">' + v + "</button>"; }).join("") + "</span></div></li>";
      }).join("");
      H.push(function () {
        H.paint(H.bar(escH(NUCLEUS360.name), escH(topic.title), "back") + '<div class="pn-body">' +
          '<section class="pn-panel"><p class="pn-t2eb">' + escH(NUCLEUS360.tagline) + '</p><h2 class="pn-h">' + escH(topic.title) + "</h2>" +
          '<p class="pn-mut">Chapter map: ' + outline.length + ' concepts in chapter order. Coverage ' + cov.covered + "/" + cov.total + ' concepts.</p>' +
          '<div class="pn-navrow"><button type="button" class="pn-btn pri" data-act="n360-go" data-m="learn" data-t="' + escH(topic.id) + '">Learn in order</button>' +
          '<button type="button" class="pn-btn" data-act="n360-go" data-m="test" data-t="' + escH(topic.id) + '">Timed test</button>' +
          '<button type="button" class="pn-btn" data-act="n360-go" data-m="revise" data-t="' + escH(topic.id) + '">Revise weak</button></div></section>' +
          '<h2 class="pn-sec">Concepts</h2><ul class="pn-mods">' + rows + "</ul>" +
          '<button type="button" class="pn-btn" data-act="n360-summary" data-t="' + escH(topic.id) + '">Topic summary</button></div>');
      });
    });
  }
  function openHub(pre) {
    loadTopics().then(function (topics) {
      var q = (pre || "").toLowerCase();
      var rows = topics.filter(function (t) { return !q || t.title.toLowerCase().indexOf(q) >= 0; }).slice(0, 60).map(function (t) {
        return H.row("n360-topic", H.ico("search"), escH(t.title), escH((t.subject || "") + (t.n ? " · " + t.n + " MCQs" : "")), ' data-t="' + escH(t.id) + '"');
      }).join("");
      H.push(function () {
        H.paint(H.bar(escH(NUCLEUS360.name), escH(NUCLEUS360.tagline), "back") + '<div class="pn-body"><p class="pn-mut">Pick a topic to cover it A to Z through MCQs, in chapter order.</p>' +
          '<p><input id="pnN360Q" class="pn-in" type="search" placeholder="Search a topic, e.g. Pancreatic adenocarcinoma" value="' + escH(pre || "") + '" aria-label="Search topics"></p>' +
          '<div class="pn-group" id="pnN360Rows">' + (rows || '<p class="pn-empty">No topic matches. The chapter list is growing; try the QBank modules.</p>') + "</div></div>");
        var inp = H.root() && H.root().querySelector("#pnN360Q");
        if (inp) inp.addEventListener("input", function () { openHubLive(inp.value, topics); });
      });
    });
  }
  function openHubLive(q, topics) {
    var box = H.root() && H.root().querySelector("#pnN360Rows");
    if (!box) return;
    q = (q || "").toLowerCase();
    box.innerHTML = topics.filter(function (t) { return !q || t.title.toLowerCase().indexOf(q) >= 0; }).slice(0, 60).map(function (t) {
      return H.row("n360-topic", H.ico("search"), escH(t.title), escH((t.subject || "") + (t.n ? " · " + t.n + " MCQs" : "")), ' data-t="' + escH(t.id) + '"');
    }).join("") || '<p class="pn-empty">No topic matches.</p>';
  }
  function topicById(id) {
    return loadTopics().then(function (topics) {
      for (var i = 0; i < topics.length; i++) if (topics[i].id === id) return topics[i];
      return null;
    });
  }
  function openSummary(topic) {
    var outline = outlineOf(topic);
    var prog = readProg();
    var per = outline.map(function (c) {
      var cf = prog[topic.id + "|" + c.id];
      return { id: c.id, title: c.title, tier: c.tier, source: c.source, right: 0, wrong: 0, guess: cf && cf.conf === "guess" ? 1 : 0, n: 0, acc: null, revise: !cf || cf.conf !== "sure", conf: (cf && cf.conf) || null };
    });
    var lines = per.map(function (p) {
      var st = p.conf ? (p.conf === "sure" ? "confident" : p.conf === "unsure" ? "unsure" : "guessed") : "not attempted";
      var lk = conceptLinks({ id: p.id }, topic).map(function (l) { return l.title; }).join("; ");
      return p.title + ": " + st + (p.revise ? " -> revise" + (lk ? " with " + lk : "") : " -> done");
    });
    H.push(function () {
      H.paint(H.bar(escH(NUCLEUS360.name + " summary"), escH(topic.title), "back") + '<div class="pn-body"><section class="pn-panel"><p class="pn-t2eb">' + escH(NUCLEUS360.tagline) + "</p>" +
        '<ul class="pn-t2dl">' + per.map(function (p) { return "<li><b>" + escH(p.title) + "</b> — " + escH(p.conf ? p.conf : "not attempted") + (p.revise ? " · revise" : " · done") + "</li>"; }).join("") + "</ul></section>" +
        '<h2 class="pn-sec">One-page revision list</h2><section class="pn-panel"><ul class="pn-t2dl">' + lines.map(function (l) { return "<li>" + escH(l) + "</li>"; }).join("") + "</ul></section>" +
        '<p class="pn-mut pn-small">Shared from ' + escH(NUCLEUS360.name + ": " + NUCLEUS360.tagline) + ".</p></div>");
    });
  }
  /* mountModule(el, sid, mid, host): the "Cover whole topic" entry on a module screen: the Nucleus360 button. */
  function mountModule(el, sid, mid, host) {
    if (host) H = host;
    ses();
    if (!el || !on()) return;
    try {
      el.innerHTML = '<button type="button" class="pn-btn" data-act="n360-hub">' + host.ico("grid") + " " + escH(NUCLEUS360.button) + '</button><p class="pn-mut pn-small">' + escH(NUCLEUS360.tagline) + ": every important concept as MCQs, in chapter order.</p>";
    } catch (e) {}
  }
  function act(a, b, h) {
    H = h || H;
    if (a === "n360-hub") return openHub("");
    if (a === "n360-topic") { var id = b.getAttribute("data-t"); return topicById(id).then(function (t) { if (t) openOutline(t); }); }
    if (a === "n360-go") { var m = b.getAttribute("data-m"), tid = b.getAttribute("data-t"); return topicById(tid).then(function (t) { if (t) startTopic(t, m); }); }
    if (a === "n360-conf") { tapConf(b.getAttribute("data-t"), b.getAttribute("data-c"), b.getAttribute("data-v")); return H.rerender(); }
    if (a === "n360-summary") { var sid2 = b.getAttribute("data-t"); return topicById(sid2).then(function (t) { if (t) openSummary(t); }); }
  }
  function init(host) { H = host; ses(); }
  G.PREP_NUCLEUS360 = { on: on, init: init, mountModule: mountModule, openHub: openHub, openOutline: openOutline, startTopic: startTopic, openSummary: openSummary, wrap: wrap, tapConf: tapConf, confOf: confOf, NUCLEUS360: NUCLEUS360, _pure: PURE };
})(typeof window !== "undefined" ? window : this);
