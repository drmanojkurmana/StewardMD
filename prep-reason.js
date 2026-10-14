/* PrepNucleus reasoning explanations and knowledge links. window.PREP_REASON. ES5.
   Every question teaches one transferable clinical reasoning pattern. A new item carries, inside its explanation
   object x, any of: clues (key clues), ddx (differential), mechanism (how it happens), lo (learning objective),
   rev (revision summary), next (preferred next action), refs (references) and link ids (links { kb, drug, protocol,
   lesson, card } or the flat x.kb / x.drug / x.protocol / x.lesson / x.card). Old items (exp, or x with only
   key/notes/others/pearl) render exactly as before: prep.js calls body() only when has() is true, and without this
   file nothing changes at all.

   Feedback body order: learning objective, Key clues, Differential, Mechanism, why the answer is right (prep.js
   whyHtml, unchanged), why the others are wrong (one collapsed row per option, the student's pick open),
   Exam pearl, Revision summary, references, then a slot the module fills once the links index arrives:
   Know more (Knowledge Library article, Drug Index, protocol, lesson, flashcards), one next learning action
   (Review the concept, Revise this topic, Practise related questions, Schedule revision: the first whose target
   exists) and Related questions. A link below confidence 75 is never shown. Links come from the item's own x.links
   (written by the content pipeline, confidence 95) merged with the published index v2/links/ (tools/prep-links.mjs):
   pointer index.json (short cache, network first, IndexedDB copy offline), one immutable shard per module
   (IndexedDB first). Lessons and card decks are re-checked against the live lesson and card indexes before they
   are shown. Per-item lesson rows carry a tier: the module's own chapter ("Lesson: <title>") or the
   specific lesson (the step showing the item's image, the lesson teaching its concept), opening at its step.
   A row whose target is only a module/subject-level fallback (no item-evidenced topic/KB/lesson: lt rows
   and kt rows the index flags ev 0, or legacy kt/lt rows) renders under the plain "Learn this module"
   label with the module name, in the neutral secondary style; evidenced rows keep their wording.

   Opening: the Knowledge Library article through SMD_REASON.openRef (guarded by hasDiseaseRef), a drug through
   MEDDB.openComposition, a protocol through SMD_KBPROTO.open({ id }); each overlay is lifted above PrepNucleus
   while open (drug-link.js lift) and its own close returns here. Lessons and flashcards use the existing l-open
   and k-open actions, so back returns here. A related question opens alone in practice, like a shared ID. */
(function (G) {
  "use strict";

  /* ================= pure ================= */
  var SHOW = 75, VER = "v2";
  var LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];

  function isStr(s) { return typeof s === "string" && !!s.trim(); }
  function asList(v) {
    if (isStr(v)) return [v.trim()];
    if (v && v.length != null) { var o = []; for (var i = 0; i < v.length; i++) if (isStr(v[i])) o.push(v[i].trim()); return o; }
    return [];
  }
  function escH(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  /* linksOf(x) -> [{ k, id }] k one of kb/dr/pr/ls/cd, in pipeline confidence order. Accepts x.links
     { kb|kb_ids, drug|drug_ids, protocol|protocol_ids|proto, lesson|lesson_ids, card|card_ids } and the flat
     x.kb / x.drug / x.protocol / x.lesson / x.card (a link id string or a list of them). */
  function linksOf(x) {
    var out = [], seen = {};
    function add(k, v) {
      asList(v).forEach(function (id) {
        var key = k + ":" + id.toLowerCase();
        if (!seen[key]) { seen[key] = 1; out.push({ k: k, id: id }); }
      });
    }
    if (!x || typeof x !== "object") return out;
    var L = x.links && typeof x.links === "object" ? x.links : {};
    add("kb", L.kb_ids); add("kb", L.kb); add("kb", x.kb);
    add("dr", L.drug_ids); add("dr", L.drug); add("dr", x.drug);
    add("pr", L.protocol_ids); add("pr", L.protocol); add("pr", L.proto); add("pr", x.protocol);
    add("ls", L.lesson_ids); add("ls", L.lesson); add("ls", x.lesson);
    add("cd", L.card_ids); add("cd", L.card); add("cd", x.card);
    return out;
  }
  /* has(x): the item opts into the reasoning layout. */
  function has(x) {
    if (!x || typeof x !== "object") return false;
    if (isStr(x.clues) || isStr(x.ddx) || isStr(x.mechanism) || isStr(x.mech) || isStr(x.lo) || isStr(x.rev) || isStr(x.next)) return true;
    if ((x.refs && x.refs.length) || (x.references && x.references.length)) return true;
    return linksOf(x).length > 0;
  }
  function hasItem(it) { return !!(it && has(it.x)); }
  /* pref(x.next) -> review|revise|practise|plan|"". */
  function pref(v) {
    var s = String(v == null ? "" : v).toLowerCase().trim();
    if (s === "review" || s === "kb" || s === "concept" || s === "article") return "review";
    if (s === "revise" || s === "lesson" || s === "topic" || s === "cards" || s === "card" || s === "flashcards") return "revise";
    if (s === "practise" || s === "practice" || s === "related" || s === "questions") return "practise";
    if (s === "plan" || s === "schedule" || s === "revision") return "plan";
    return "";
  }
  /* nextAction(p, avail) -> the one next action: the preferred kind when its target exists, else the first
     of review (a KB article), revise (a lesson or cards), practise (related questions), plan (Today's plan).
     avail { kb, lesson, related, plan } are target counts (plan: 1 when Today's plan opens). */
  function nextAction(p, avail) {
    avail = avail || {};
    var kinds = ["review", "revise", "practise", "plan"];
    var hasT = { review: (avail.kb || 0) > 0, revise: (avail.lesson || 0) > 0, practise: (avail.related || 0) > 0, plan: (avail.plan || 0) > 0 };
    if (p && hasT[p]) return p;
    for (var i = 0; i < kinds.length; i++) if (hasT[kinds[i]]) return kinds[i];
    return null;
  }
  function nextLabel(kind) {
    return kind === "review" ? "Review the concept" : kind === "revise" ? "Revise this topic" :
      kind === "practise" ? "Practise related questions" : kind === "plan" ? "Schedule revision" : "";
  }
  /* shardLinks(sh, iid) -> [{ k, id, title, c, v, sec, ev }] at confidence >= SHOW, strongest first.
     ev is the item-evidence flag new indexes carry on kt/lt rows (1 item-evidenced, 0 module/subject
     fallback); rows from older indexes carry none (see isFallback). */
  function shardLinks(sh, iid) {
    var out = [];
    if (!sh || !sh.T || !sh.e) return out;
    var rows = sh.e[String(iid)] || [];
    rows.forEach(function (r) {
      var t = sh.T[r[0]];
      if (t && r[1] >= SHOW) {
        var o = { k: t[0], id: t[1], title: t[2], c: r[1], v: r[2] || "", sec: r[3] || "" };
        if (r.length > 4) o.ev = r[4];
        out.push(o);
      }
    });
    out.sort(function (a, b) { return b.c - a.c || (a.id < b.id ? -1 : 1); });
    return out;
  }
  /* relOf(sh, iid) -> [[module, itemId]] related questions across modules, at most 8. */
  function relOf(sh, iid) {
    var out = [], seen = {};
    if (!sh || !sh.T || !sh.e || !sh.x) return out;
    var rows = sh.e[String(iid)] || [];
    rows.forEach(function (r) {
      ((sh.x[r[0]] != null && sh.x[r[0]]) || []).forEach(function (e) {
        var k = e[0] + ":" + e[1];
        if (!seen[k] && out.length < 8) { seen[k] = 1; out.push(e); }
      });
    });
    return out;
  }
  /* mergeLinks(pipe, idx) -> pipeline links (with titles resolved) first, then index links, one row per target. */
  function mergeLinks(pipe, idx) {
    var out = [], seen = {};
    (pipe || []).concat(idx || []).forEach(function (l) {
      var k = l.k + ":" + String(l.id).toLowerCase();
      if (!seen[k]) { seen[k] = 1; out.push(l); }
    });
    return out;
  }
  /* titleRelevant(title, text): the client mirror of the index relevance guard. A specific target whose
     name shares no significant word with the item's stem, keyed answer or module is a keyword namesake
     (SGLT2 -> Familial Renal Glucosuria), never the concept. Module-topic rows (via kt) are exempt. */
  function titleRelevant(title, text) {
    var tw = String(title || "").replace(/\s*\([^)]*\)\s*/g, " ").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter(function (w) { return w.length >= 4; });
    if (!tw.length) return false;
    var hay = " " + String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ") + " ";
    var hits = tw.filter(function (w) { return hay.indexOf(" " + w + " ") >= 0 || hay.indexOf(" " + w) >= 0; });
    var generic = { renal: 1, cardiac: 1, hepatic: 1, pulmonary: 1, cerebral: 1, gastric: 1, intestinal: 1, familial: 1, congenital: 1, inherited: 1, hereditary: 1, chronic: 1, acute: 1, primary: 1, secondary: 1 };
    return hits.length >= 2 || hits.some(function (w) { return !generic[w]; });
  }
  /* isFallback(l): the tier-to-label rule. A module/subject-level fallback row renders under the plain
     "Learn this module" label, never with the topic-specific wording of evidenced links. New index rows
     carry ev on kt/lt rows (1 when the item itself evidences the target through its stem, keyed answer
     or own tags, 0 for the plain module/subject fallback). Rows from older indexes without ev are
     evidenced only when their score/type says so (a specific via at the bar), else fallback (kt/lt or
     a topic-tier lesson). Pipeline x.links rows (no via) are written for the item itself: evidenced. */
  function isFallback(l) {
    if (!l) return true;
    if (l.ev === 1 || l.ev === 0) return l.ev === 0;
    if (l.v === "kt" || l.v === "lt" || l.tier === "topic") return true;
    return false;
  }
  /* findRunItem(items, iid) -> the run's item with this id, or null. The gaps slots carry only data-i/s/m
     (they never call remember()), so fill() finds each slot's own item here for its pipeline links. */
  function findRunItem(items, iid) {
    var out = null;
    (items || []).forEach(function (it) { if (!out && it && String(it.id) === String(iid)) out = it; });
    return out;
  }
  /* srcOf(it) -> "Source: <prov> [· ver] [· via]" or "". Shown only when a version-ish field exists
     (links ver/via or references); a bare prov alone stays unshown, as before. */
  function srcOf(it) {
    var prov = it && it.prov, x = (it && it.x) || {};
    var label = prov === "SMD" ? "StewardMD" : prov === "LIC" ? "Licensed bank" : isStr(prov) ? String(prov).trim() : "";
    if (!label) return "";
    var L = x.links && typeof x.links === "object" ? x.links : {};
    var ver = isStr(L.ver) ? String(L.ver).trim().split("@")[0] : "";
    var via = isStr(L.via) ? String(L.via).trim() : "";
    var refs = asList(x.refs).length + asList(x.references).length;
    if (!ver && !via && !refs) return "";
    return "Source: " + label + (ver ? " · " + ver : "") + (via ? " · " + via : "");
  }

  /* body(it, o): the new explanation body. o { why (prep.js whyHtml), pearl (text), rs, chosen, md, inl }.
     Sections with no content are skipped; provenance (srcOf) sits under the references; the links slot is
     filled later by fill(). */
  function body(it, o) {
    var x = (it && it.x) || {}, h = "", md = o.md, inl = o.inl;
    function sec(title, v) { if (isStr(v)) h += "<h3>" + title + "</h3>" + '<div class="pn-xnotes">' + md(v) + "</div>"; }
    if (isStr(x.lo)) h += '<p class="pn-rlo"><span>Learning objective</span>' + inl(x.lo) + "</p>";
    sec("Key clues", x.clues);
    sec("Differential", x.ddx);
    sec("Mechanism", isStr(x.mechanism) ? x.mechanism : x.mech);
    if (o.why) h += o.why;
    if (o.rs) {
      var ord = it.o.map(function (nn, k) { return k; }).filter(function (k) { return k !== it.a && o.rs[k] && String(o.rs[k]).trim(); });
      ord.sort(function (a, b) { return (b === o.chosen) - (a === o.chosen) || a - b; });
      if (ord.length) {
        h += "<h3>Why the others are wrong</h3>" + ord.map(function (k) {
          var mine = k === o.chosen;
          return '<details class="pn-ro"' + (mine ? " open" : "") + ">" + '<summary><span class="pn-l">' + LETTERS[k] + "</span>" +
            '<span class="pn-rot">' + escH(it.o[k]) + (mine ? ' <small>Your pick</small>' : "") + "</span></summary>" +
            '<div class="pn-rob">' + inl(o.rs[k]) + "</div></details>";
        }).join("");
      }
    }
    if (isStr(o.pearl)) h += '<aside class="pn-kp" aria-label="Exam pearl"><b>Exam pearl</b><span>' + inl(o.pearl) + "</span></aside>";
    sec("Revision summary", x.rev);
    var refs = asList(x.refs).concat(asList(x.references));
    if (refs.length) h += '<div class="pn-rref"><b>References</b><ul>' + refs.map(function (r) { return "<li>" + inl(r) + "</li>"; }).join("") + "</ul></div>";
    var src = srcOf(it);
    if (src) h += '<p class="pn-src">' + escH(src) + "</p>";
    h += '<div class="pn-rx" data-i="' + escH(it.id) + '" data-s="' + escH(it._s || "") + '" data-m="' + escH(it._m || it.t || "") + '"></div>';
    return h;
  }
  /* lessonLinks(sh, iid) -> [{ key, title, c, tier, step }] at confidence >= SHOW, strongest first.
     tier "topic" (via lt: the module's own chapter) renders as "Lesson: <title>"; tier "specific"
     (via li/lk/lh: the step showing the item's image, the lesson teaching its concept, the chapter under its
     heading) renders as the bare title. step opens the lesson at that step, "" for none. */
  function lessonLinks(sh, iid) {
    var out = [];
    if (!sh || !sh.T || !sh.e) return out;
    var rows = sh.e[String(iid)] || [];
    rows.forEach(function (r) {
      var t = sh.T[r[0]];
      if (t && t[0] === "ls" && r[1] >= SHOW) {
        var lo = { key: t[1], title: t[2], c: r[1], tier: r[2] === "lt" ? "topic" : "specific", step: r[3] == null ? "" : String(r[3]) };
        if (r.length > 4) lo.ev = r[4];
        out.push(lo);
      }
    });
    out.sort(function (a, b) { return b.c - a.c || (a.key < b.key ? -1 : 1); });
    return out;
  }
  /* slotHtml(d): Know more + the one next action + related questions. d { links, lessons, lesson, cards, related,
     next, sid, mid, iid }. links [{ k, id, title }], lessons [{ key, title, tier, step }] (per-item, titled),
     lesson { key, title } | null (the module fallback when no per-item lesson), cards bool,
     related [{ mid, id, stem }], next { kind, label, target, lkey, step } | null. "" when nothing exists.
     The practise action carries the slot's own item (data-i/data-m) so gaps practise the gaps question,
     not the last remembered one. */
  function slotHtml(d) {
    var h = "", links = d.links || [], mt = d.mt || "";
    function row(act, attrs, kind, title) {
      return '<li><button type="button" class="pn-rlr" data-act="' + act + '"' + attrs + '><small>' + kind + "</small><b>" + escH(title) + "</b></button></li>";
    }
    // Fallback rows (a module/subject-level target with no item evidence) render under the plain
    // "Learn this module" label with the module name, after every evidenced row; they open the same
    // target as before, only the label changes.
    function fbRow(act, attrs) { return row(act, attrs, "Learn this module", mt || "Revise this topic"); }
    var rowsEv = "", rowsFb = "";
    links.forEach(function (l) {
      if (l.k !== "kb" && l.k !== "dr" && l.k !== "pr") return;
      var act = l.k === "kb" ? "r-kb" : l.k === "dr" ? "r-drug" : "r-proto";
      if (isFallback(l)) {
        rowsFb += fbRow(act, l.k === "dr" ? ' data-t="' + escH(l.title || l.id) + '"' : ' data-id="' + escH(l.id) + '"');
        return;
      }
      if (l.k === "kb") rowsEv += row("r-kb", ' data-id="' + escH(l.id) + '"', "Knowledge Library", l.title || l.id);
      else if (l.k === "dr") rowsEv += row("r-drug", ' data-t="' + escH(l.title || l.id) + '"', "Drug Index", l.title || l.id);
      else if (l.k === "pr") rowsEv += row("r-proto", ' data-id="' + escH(l.id) + '"', "Protocol", l.title || l.id);
    });
    var lessons = d.lessons || [];
    lessons.forEach(function (l) {
      var at = ' data-s="' + escH(d.sid) + '" data-m="' + escH(d.mid) + '" data-l="' + escH(l.key) + '"' + (l.step ? ' data-step="' + escH(l.step) + '"' : "");
      if (isFallback(l)) rowsFb += fbRow("l-open", at);
      else rowsEv += row("l-open", at, "Lesson", "Lesson: " + (l.title || "Revise this topic"));
    });
    if (!lessons.length && d.lesson) rowsFb += fbRow("l-open", ' data-s="' + escH(d.sid) + '" data-m="' + escH(d.mid) + '" data-l="' + escH(d.lesson.key) + '"');
    if (d.cards) rowsEv += row("k-open", ' data-s="' + escH(d.sid) + '" data-m="' + escH(d.mid) + '"', "Flashcards", "Cards for this topic");
    var rows = rowsEv + rowsFb;
    if (rows) h += '<h3 class="pn-km-h">Know more</h3>' + '<ul class="pn-rl">' + rows + "</ul>";
    if (d.next) {
      var pract = 'data-act="r-practise"' + (d.iid ? ' data-i="' + escH(d.iid) + '"' : "") + (d.mid ? ' data-m="' + escH(d.mid) + '"' : "");
      var at = d.next.kind === "review" ? 'data-act="r-kb" data-id="' + escH(d.next.id) + '"' :
        d.next.kind === "revise" ? (d.next.lkey ? 'data-act="l-open" data-s="' + escH(d.sid) + '" data-m="' + escH(d.mid) + '" data-l="' + escH(d.next.lkey) + '"' + (d.next.step ? ' data-step="' + escH(d.next.step) + '"' : "") : 'data-act="k-open" data-s="' + escH(d.sid) + '" data-m="' + escH(d.mid) + '"') :
        d.next.kind === "practise" ? pract : 'data-act="r-plan"';
      h += '<button type="button" class="pn-btn pri pn-rn" ' + at + "><b>" + escH(d.next.label) + "</b>" + (d.next.target ? "<small>" + escH(d.next.target) + "</small>" : "") + "</button>";
    }
    if (d.related && d.related.length) {
      h += "<h3>Related questions</h3>" + '<ul class="pn-rrq">' + d.related.map(function (r) {
        return '<li><button type="button" class="pn-rqr" data-act="r-rel" data-m="' + escH(r.mid) + '" data-id="' + escH(r.id) + '"><span>' + escH(r.stem) + "</span></button></li>";
      }).join("") + "</ul>";
    }
    return h;
  }

  /* kmSlot(it): returns the compact Know more slot element for items that do not have the reasoning body. */
  function kmSlot(it) {
    if (!it || hasItem(it)) return "";
    var id = it.id, s = it._s || "", m = it._m || it.t || "";
    return '<div class="pn-km" data-i="' + escH(id) + '" data-s="' + escH(s) + '" data-m="' + escH(m) + '"></div>';
  }

  function kmKindLabel(t) {
    if (t.fb) return "Learn this module";
    if (t.k === "kb") return "Knowledge Library";
    if (t.k === "ls") return "Lesson";
    if (t.k === "dr") return "Drug Index";
    if (t.k === "pr") return "Protocol";
    if (t.k === "cd") return "Flashcards";
    if (t.k === "n360") return "Nucleus360";
    return "";
  }

  function kmTargetLabel(t) {
    if (t.k === "kb") return "Knowledge Library: " + (t.title || t.id);
    if (t.k === "ls") return "Lesson: " + (t.title || "Revise this topic");
    if (t.k === "dr") return "Drug: " + (t.title || t.id);
    if (t.k === "pr") return "Protocol: " + (t.title || t.id);
    if (t.k === "cd") return "Flashcards: Cards for this topic";
    if (t.k === "n360") return "Cover this topic with Nucleus360";
    return t.title || "";
  }

  /* kmTargets(d) -> { rowTargets, allTargets }
     Separates item-specific topic targets (for the direct row) and full targets (for the bottom sheet). */
  function kmTargets(d) {
    var rowTargets = [], allTargets = [];
    var sid = d.sid || "", mid = d.mid || "", mt = d.mt || "";
    var links = d.links || [];
    var kb = links.filter(function (l) { return l.k === "kb"; });
    var dr = links.filter(function (l) { return l.k === "dr"; });
    var pr = links.filter(function (l) { return l.k === "pr"; });
    var okLessons = d.okLessons || [];
    var lesson = d.lesson;

    function tag(t, l) {
      if (l.ev !== undefined) t.ev = l.ev;
      t.fb = isFallback(l); t.mt = mt;
      return t;
    }
    kb.forEach(function (l) {
      var t = tag({ k: "kb", id: l.id, title: l.title || l.id, v: l.v || "", act: "r-kb", attrs: ' data-id="' + escH(l.id) + '"' }, l);
      rowTargets.push(t); allTargets.push(t);
    });

    var lsList = okLessons.slice();
    if (!lsList.length && lesson) {
      lsList.push({ key: lesson.key, title: lesson.title || pretty(lesson.key), tier: "topic", step: "" });
    }
    lsList.forEach(function (l) {
      var t = tag({
        k: "ls", key: l.key, title: l.title || l.key, tier: l.tier || "specific", step: l.step || "",
        act: "l-open", attrs: ' data-s="' + escH(sid) + '" data-m="' + escH(mid) + '" data-l="' + escH(l.key) + '"' + (l.step ? ' data-step="' + escH(l.step) + '"' : "")
      }, l);
      rowTargets.push(t); allTargets.push(t);
    });

    dr.forEach(function (l) {
      var t = tag({ k: "dr", id: l.id, title: l.title || l.id, v: l.v || "", act: "r-drug", attrs: ' data-t="' + escH(l.title || l.id) + '"' }, l);
      rowTargets.push(t); allTargets.push(t);
    });

    pr.forEach(function (l) {
      var t = tag({ k: "pr", id: l.id, title: l.title || l.id, v: l.v || "", act: "r-proto", attrs: ' data-id="' + escH(l.id) + '"' }, l);
      rowTargets.push(t); allTargets.push(t);
    });

    if (d.itemCards) {
      var tCd = { k: "cd", mid: mid, title: "Cards for this topic", act: "k-open", attrs: ' data-s="' + escH(sid) + '" data-m="' + escH(mid) + '"' };
      rowTargets.push(tCd); allTargets.push(tCd);
    } else if (d.cards) {
      allTargets.push({ k: "cd", mid: mid, title: "Cards for this topic", act: "k-open", attrs: ' data-s="' + escH(sid) + '" data-m="' + escH(mid) + '"' });
    }

    /* Guarantee floor: when nothing else exists, the module's Nucleus360 walkthrough (shard mod.n360,
       direct membership only) so no answered MCQ shows nothing. Labelled honestly, never as a lesson. */
    var n360 = d.n360 || null;
    var n360id = n360 && (n360.id || n360[0]);
    if (!rowTargets.length && n360id) {
      var tN = { k: "n360", id: n360id, title: n360.title || n360[1] || n360id, act: "n360-topic", attrs: ' data-t="' + escH(n360id) + '"' };
      rowTargets.push(tN); allTargets.push(tN);
    }

    // Items with both keep both, evidenced first: a stable partition, so the direct row and every
    // sheet group lead with item-evidenced targets and plain module fallbacks follow.
    function evd(ts) { return ts.filter(function (t) { return !t.fb; }); }
    function fbd(ts) { return ts.filter(function (t) { return t.fb; }); }
    rowTargets = evd(rowTargets).concat(fbd(rowTargets));
    allTargets = evd(allTargets).concat(fbd(allTargets));
    return { rowTargets: rowTargets, allTargets: allTargets };
  }

  /* knowMoreHtml(d): the "Know more" block below the explanation. The header always shows, even for one
     target, so the row is recognisable. One or two targets render as direct buttons (two side by side);
     three or more show the top two plus a "More (N)" button (N = every target) opening the sheet. */
  function kmBtn(t) {
    // A fallback target renders under the plain "Learn this module" label with the module name as its
    // subtitle, in the neutral secondary style (pn-km-fb); evidenced targets keep their exact look.
    if (t.fb) {
      return '<button type="button" class="pn-km-btn pn-km-fb" data-act="' + t.act + '"' + t.attrs + '>' +
        '<b>Learn this module</b>' + (t.mt ? '<small>' + escH(t.mt) + '</small>' : '') + '</button>';
    }
    return '<button type="button" class="pn-km-btn" data-act="' + t.act + '"' + t.attrs + '>' +
      '<b>' + escH(kmTargetLabel(t)) + '</b></button>';
  }
  function knowMoreHtml(d) {
    var tg = d.targets || [];
    if (!tg.length) return "";
    var all = d.allTargets && d.allTargets.length ? d.allTargets : tg;
    var head = '<h3 class="pn-km-h">Know more</h3>';
    if (all.length <= 2) {
      if (tg.length === 1) return head + '<div class="pn-km-row">' + kmBtn(tg[0]) + '</div>';
      return head + '<div class="pn-km-row pn-km-duo">' + kmBtn(tg[0]) + kmBtn(tg[1]) + '</div>';
    }
    var top = tg.slice(0, 2);
    var duo = top.length === 2 ? '<div class="pn-km-row pn-km-duo">' + kmBtn(top[0]) + kmBtn(top[1]) + '</div>'
      : '<div class="pn-km-row">' + kmBtn(top[0]) + '</div>';
    return head + duo + '<div class="pn-km-row">' +
      '<button type="button" class="pn-km-btn pn-km-more" data-act="r-km-sheet" data-i="' + escH(d.iid) + '" data-s="' + escH(d.sid || "") + '" data-m="' + escH(d.mid || "") + '">' +
      '<b>More (' + all.length + ')</b><span class="pn-km-count" aria-hidden="true">&rsaquo;</span>' +
      '</button></div>';
  }

  /* knowMoreSheetBodyHtml(d): targets grouped by kind for the bottom sheet.
     Group order: Knowledge Library, Lessons (module chapter first, then specific), Drugs, Protocols, Flashcards. */
  function knowMoreSheetBodyHtml(d) {
    var targets = d.allTargets || d.targets || [];
    if (!targets.length) return "";
    var groups = [
      { k: "kb", title: "Knowledge Library" },
      { k: "ls", title: "Lessons" },
      { k: "dr", title: "Drugs" },
      { k: "pr", title: "Protocols" },
      { k: "cd", title: "Flashcards" }
    ];
    var h = "";
    groups.forEach(function (g) {
      var items = targets.filter(function (t) { return t.k === g.k; });
      if (!items.length) return;
      if (g.k === "ls") {
        items.sort(function (a, b) {
          var at = a.tier === "topic" ? 0 : 1;
          var bt = b.tier === "topic" ? 0 : 1;
          return at - bt;
        });
      }
      h += '<div class="pn-km-group"><h3 class="pn-km-gh">' + escH(g.title) + '</h3><ul class="pn-rl">' +
        items.map(function (t) {
          return '<li><button type="button" class="pn-rlr" data-act="' + t.act + '"' + t.attrs + '>' +
            '<small>' + escH(kmKindLabel(t)) + '</small>' +
            '<b>' + escH(t.fb ? (t.mt || "") : kmTargetLabel(t)) + '</b></button></li>';
        }).join("") + '</ul></div>';
    });
    return h;
  }

  var PURE = { SHOW: SHOW, VER: VER, has: hasItem, hasX: has, linksOf: linksOf, pref: pref, nextAction: nextAction,
    nextLabel: nextLabel, shardLinks: shardLinks, lessonLinks: lessonLinks, relOf: relOf, mergeLinks: mergeLinks,
    body: body, slotHtml: slotHtml, escH: escH, findRunItem: findRunItem, srcOf: srcOf, isFallback: isFallback,
    kmSlot: kmSlot, kmKindLabel: kmKindLabel, kmTargetLabel: kmTargetLabel, kmTargets: kmTargets, titleRelevant: titleRelevant,
    knowMoreHtml: knowMoreHtml, knowMoreSheetBodyHtml: knowMoreSheetBodyHtml };
  if (typeof module !== "undefined" && module.exports && !(G && G.document)) { module.exports = PURE; return; }

  /* ================= browser ================= */
  var R = { ptr: null, ptrP: null, last: null, slots: {}, kmTargets: {}, kmSheet: null };
  function api(H) { return (H.bankApi || "/api/prep/bank/").replace(/\/?$/, "/"); }
  function cget(H, k) { try { return H.cacheGet ? Promise.resolve(H.cacheGet(k)).then(null, function () { return null; }) : Promise.resolve(null); } catch (e) { return Promise.resolve(null); } }
  function cput(H, k, v) { try { if (H.cachePut) H.cachePut(k, v); } catch (e) {} }
  function getJSON(url, H) {
    if (H && H.getJSON) return H.getJSON(url);
    if (G.PREP_BANK_CLIENT && G.PREP_BANK_CLIENT.fetchBankJSON && url && url.indexOf("/api/prep/bank/") >= 0) {
      return G.PREP_BANK_CLIENT.fetchBankJSON(url);
    }
    return G.fetch(url, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
  }
  /* The pointer: network first (it names the current shards), the IndexedDB copy offline. */
  function pointer(H) {
    if (R.ptr) return Promise.resolve(R.ptr);
    if (R.ptrP) return R.ptrP;
    R.ptrP = getJSON(api(H) + VER + "/links/index.json", H).then(function (p) {
      R.ptr = p; R.ptrP = null; cput(H, VER + "/links/index.json", p); return p;
    }, function (e) {
      return cget(H, VER + "/links/index.json").then(function (hit) { R.ptrP = null; if (hit && hit.m) { R.ptr = hit; return hit; } throw e; });
    });
    return R.ptrP;
  }
  /* One module shard: immutable, so IndexedDB first. */
  function shard(H, mid) {
    return pointer(H).then(function (p) {
      var v = (p.m || {})[mid];
      if (!v) return null;
      var rel = "m/" + mid + "-" + String(v).split("/")[1] + ".json", key = VER + "/links/" + rel;
      return cget(H, key).then(function (hit) {
        if (hit && hit.e) return hit;
        return getJSON(api(H) + VER + "/links/" + rel, H).then(function (sh) { cput(H, key, sh); return sh; }, function () { return null; });
      });
    }, function () { return null; });
  }
  function pretty(id) { return String(id || "").replace(/[_-]+/g, " ").replace(/(^|\s)([a-z])/g, function (m, a, b) { return a + b.toUpperCase(); }); }
  function titleOf(l) {
    if (l.title) return l.title;
    try {
      if (l.k === "kb" && G.KB_ENRICHMENT && G.KB_ENRICHMENT.byId && G.KB_ENRICHMENT.byId[l.id]) return G.KB_ENRICHMENT.byId[l.id].name || l.id;
      if (l.k === "pr" && G.SMD_KBPROTO && G.SMD_KBPROTO.index()) {
        var ps = SMD_KBPROTO.index().protocols || [];
        for (var i = 0; i < ps.length; i++) if (ps[i].id === l.id) return ps[i].title || l.id;
      }
    } catch (e) {}
    return pretty(l.id);
  }
  /* Lesson and card targets are re-checked against the live indexes; a check that cannot run (offline before the
     first open) keeps the target: opening it then says plainly when it is missing. */
  function checkLesson(key, mid) {
    if (!G.PREP_LESSONS || !G.PREP_LESSONS.index) return Promise.resolve(true);
    try {
      return G.PREP_LESSONS.index().then(function (ix) {
        var ms = (ix && ix.modules) || {};
        return !!(ms[key] || ms[mid]);
      }, function () { return true; });
    } catch (e) { return Promise.resolve(true); }
  }
  function checkCards(mid) {
    if (!G.PREP_FLASH || !G.PREP_FLASH.index) return Promise.resolve(true);
    try {
      return G.PREP_FLASH.index().then(function (ix) { return !!((ix && ix.modules) || {})[mid]; }, function () { return true; });
    } catch (e) { return Promise.resolve(true); }
  }
  /* Related stems: at most 3 modules, at most 5 questions found. */
  function resolveRelated(H, pairs) {
    var byM = {}, out = [];
    (pairs || []).forEach(function (e) { (byM[e[0]] = byM[e[0]] || []).push(String(e[1])); });
    var mids = Object.keys(byM).slice(0, 3);
    return Promise.all(mids.map(function (mid) {
      var sid = null;
      try { sid = H.subjectOfModule ? H.subjectOfModule(mid) : null; } catch (e) {}
      if (!sid) return null;
      return H.loadModule(sid, mid).then(function (items) { return { mid: mid, items: items || [] }; }, function () { return null; });
    })).then(function (lists) {
      lists.forEach(function (l) {
        if (!l) return;
        var want = {};
        byM[l.mid].forEach(function (id) { want[id] = 1; });
        l.items.forEach(function (it) {
          if (out.length < 5 && it && want[String(it.id)] && !(it.flags && it.flags.length)) {
            var s = String(it.q || "").replace(/\s+/g, " ").trim();
            out.push({ mid: l.mid, id: String(it.id), stem: s.length > 140 ? s.slice(0, 139) + "…" : s });
          }
        });
      });
      return out;
    });
  }
  function closeKmSheet() {
    var el = G.document && G.document.getElementById("pnKmSheet");
    if (el && el.parentNode) el.parentNode.removeChild(el);
    var had = !!R.kmSheet;
    R.kmSheet = null;
    return had;
  }
  function openKmSheet(d, H) {
    closeKmSheet();
    var root = (H && H.root) ? H.root() : (G.document && G.document.getElementById("smdPrep"));
    if (!root) return;
    var wrap = G.document.createElement("div");
    wrap.className = "pn-sheet-wrap pn-km-wrap";
    wrap.id = "pnKmSheet";
    var closeIco = (H && H.ico) ? H.ico("close") : '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 13.41 12z"/></svg>';
    wrap.innerHTML = '<div class="pn-scrim" data-act="r-km-close"></div>' +
      '<section class="pn-sheet pn-km-sheet" role="dialog" aria-modal="true" aria-labelledby="pnKmSheetT" tabindex="-1">' +
      '<span class="pn-grab" aria-hidden="true"></span>' +
      '<div class="pn-sheet-h"><h2 id="pnKmSheetT">Know more</h2><button type="button" class="pn-ib" data-act="r-km-close" aria-label="Close">' + closeIco + '</button></div>' +
      '<div class="pn-km-sheet-b">' + knowMoreSheetBodyHtml(d) + '</div>' +
      '<div class="pn-sheet-act"><button type="button" class="pn-btn" data-act="r-km-close">Close</button></div>' +
      '</section>';
    wrap.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-act], [data-act='r-km-close']");
      if (!b) return;
      var act = b.getAttribute("data-act");
      if (act === "r-km-close") {
        closeKmSheet();
      } else if (act !== "r-km-sheet") {
        setTimeout(closeKmSheet, 0);
      }
    });
    root.appendChild(wrap);
    R.kmSheet = wrap;
  }
  /* fill(H): patch every links slot on screen, each by its own data-i/s/m. The feedback slot, Know more row,
     and each Knowledge-gaps slot resolve independently; a gaps slot finds its item in the current run (gaps never call
     remember()). A slot that fails stays unmarked, so a later paint retries it. */
  function fill(H) {
    var root = null;
    try { root = H.root ? H.root() : null; } catch (e) { return; }
    if (!root || !root.querySelectorAll) return;
    var slots = [];
    try {
      var list = root.querySelectorAll(".pn-rx[data-i], .pn-km[data-i]");
      for (var i = 0; i < list.length; i++) if (!list[i].getAttribute("data-done")) slots.push(list[i]);
    } catch (e) { return; }
    if (!slots.length) return;
    var runItems = [];
    try { var r = H.run_ ? H.run_() : null; if (r && r.items) runItems = r.items; } catch (e) {}
    slots.forEach(function (slot) { fillOne(H, slot, runItems); });
  }
  function fillOne(H, slot, runItems) {
    var iid = slot.getAttribute("data-i"), sid = slot.getAttribute("data-s") || "", mid = slot.getAttribute("data-m") || "";
    if (!iid || slot.getAttribute("data-done")) return;
    slot.setAttribute("data-done", "wait");
    var isKm = slot.classList ? slot.classList.contains("pn-km") : (slot.className && slot.className.indexOf("pn-km") !== -1);
    var found = findRunItem(runItems, iid);
    var x = (found && found.x) || (R.last && R.last.iid === iid ? R.last.x : {}) || {};
    if (found) {
      if (!sid && found._s) sid = found._s;
      if (!mid) mid = found._m || found.t || "";
    }
    if (!sid && mid && H.subjectOfModule) { try { sid = H.subjectOfModule(mid) || ""; } catch (e) {} }
    var mt = "";
    try { mt = (mid && H.moduleTitleOf) ? (H.moduleTitleOf(mid) || "") : ""; } catch (e) { mt = ""; }
    if (!mt && mid) mt = pretty(mid);
    var pipe = linksOf(x);
    var prefKind = pref(x.next);
    shard(H, mid).then(function (sh) {
      var ix = sh ? shardLinks(sh, iid) : [];
      var links = mergeLinks(pipe.filter(function (l) { return l.k === "kb" || l.k === "dr" || l.k === "pr"; }).map(function (l) { return { k: l.k, id: l.id, title: titleOf(l), c: 95 }; }), ix);
      links = links.filter(function (l) {
        if (l.k !== "kb" || !G.SMD_REASON || !G.SMD_REASON.hasDiseaseRef) return true;
        try { return G.SMD_REASON.hasDiseaseRef(l.id); } catch (e) { return true; }
      });
      /* Relevance guard: pipeline (x.links) and specific index rows must relate to this item's own text;
         a keyword namesake is dropped here even before a republished index lands. Module-topic rows
         (via kt) always survive, and order first so Know more and the next action lead with the topic. */
      if (found) {
        var hay = [found.q || "", (found.o && typeof found.a === "number" ? found.o[found.a] : "") || "", found.exp || "",
          ((found.x || {}).key || ""), ((found.x || {}).notes || ""), mid.replace(/[-_]/g, " ")].join(" ");
        links = links.filter(function (l) { return l.v === "kt" || l.v || titleRelevant(l.title || l.id, hay); });
      }
      links.sort(function (a, b) { return ((a.v === "kt" ? 0 : 1) - (b.v === "kt" ? 0 : 1)) || (b.c - a.c); });
      var lessons = sh ? lessonLinks(sh, iid) : [];
      var lsKeys = pipe.filter(function (l) { return l.k === "ls"; }).map(function (l) { return l.id; });
      if (sh && sh.mod && sh.mod.ls) lsKeys = lsKeys.concat(sh.mod.ls);
      var checks = lessons.length ? lessons.map(function (l) { return checkLesson(l.key, mid); }) : (lsKeys[0] ? [checkLesson(lsKeys[0], mid)] : []);
      var itemCards = pipe.some(function (l) { return l.k === "cd"; });
      var wantCd = itemCards || !!(sh && sh.mod && sh.mod.cd);
      return Promise.all([Promise.all(checks), wantCd ? checkCards(mid) : false,
        resolveRelated(H, sh ? relOf(sh, iid) : [])]).then(function (rr) {
        var okLessons = lessons.filter(function (l, i) { return rr[0][i]; });
        var lesson = (!okLessons.length && lsKeys[0] && rr[0][0]) ? { key: lsKeys[0] } : null;
        var cards = !!rr[1], related = rr[2] || [];
        var sel = isKm ? '.pn-km[data-i="' + iid + '"]' : '.pn-rx[data-i="' + iid + '"]';
        var updateEl = function (html, hide) {
          var live = null;
          try { live = (H.root() || {}).querySelector ? H.root().querySelector(sel) : null; } catch (e) {}
          var el = live || slot;
          el.innerHTML = html;
          el.setAttribute("data-done", "1");
          if (el.style) { el.style.display = hide ? "none" : ""; }
        };

        if (isKm) {
          var hasAny = pipe.length > 0 || (sh && sh.e && sh.e[String(iid)] && sh.e[String(iid)].some(function (r) { return r[1] >= SHOW; }));
          var n360 = (sh && sh.mod && sh.mod.n360) || null;
          var km = (hasAny || n360) ? kmTargets({ links: links, okLessons: okLessons, lesson: lesson, cards: cards, itemCards: itemCards, sid: sid, mid: mid, mt: mt, n360: n360 }) : { rowTargets: [], allTargets: [] };
          if (!km.rowTargets.length) {
            updateEl("", true);
            return;
          }
          R.kmTargets[iid] = { targets: km.rowTargets, allTargets: km.allTargets, sid: sid, mid: mid, iid: iid };
          var kmHtml = knowMoreHtml({ targets: km.rowTargets, allTargets: km.allTargets, sid: sid, mid: mid, iid: iid });
          updateEl(kmHtml, false);
          return;
        }

        var kb = links.filter(function (l) { return l.k === "kb"; });
        // The review action leads with the first item-evidenced article; a fallback-only article is an
        // honest module target, so it keeps the action but names the module, never the article.
        var kbEv = kb.filter(function (l) { return !isFallback(l); });
        var nLesson = okLessons.length + (lesson ? 1 : 0) + (cards ? 1 : 0);
        var kind = nextAction(prefKind, { kb: kb.length, lesson: nLesson, related: related.length, plan: G.PREP_PLAN ? 1 : 0 });
        var firstL = okLessons[0] || lesson;
        var next = null;
        if (kind === "review") next = { kind: kind, label: nextLabel(kind), id: (kbEv[0] || kb[0]).id, target: kbEv[0] ? kbEv[0].title : mt };
        else if (kind === "revise") next = { kind: kind, label: nextLabel(kind), lkey: firstL ? firstL.key : null, step: firstL ? firstL.step : null, target: firstL ? "Lesson" : "Flashcards" };
        else if (kind === "practise") next = { kind: kind, label: nextLabel(kind), target: related.length + (related.length === 1 ? " question" : " questions") };
        else if (kind === "plan") next = { kind: kind, label: nextLabel(kind), target: "Today's plan" };
        R.slots[iid] = { related: related, mid: mid, sid: sid };
        if (R.last && R.last.iid === iid) R.last.related = related;
        var html = slotHtml({ links: links, lessons: okLessons, lesson: lesson, cards: cards, related: related, next: next, sid: sid, mid: mid, mt: mt, iid: iid });
        updateEl(html, false);
      });
    }, function () { try { slot.removeAttribute("data-done"); } catch (e) {} });
  }
  function remember(it) {
    R.last = { iid: String(it.id), x: it.x || {}, sid: it._s || "", mid: it._m || it.t || "", filling: false, related: [] };
  }
  /* An overlay from outside PrepNucleus (the disease reader, the protocol reader, the Drugs Database) sits below
     #smdPrep (z 885): lift it to the top while open and put it back when it closes (drug-link.js lift). */
  function lift(id) {
    var db = G.document && G.document.getElementById(id);
    if (!db || db.getAttribute("data-rx-lift")) return;
    db.setAttribute("data-rx-lift", db.style.zIndex || "-");
    db.style.zIndex = "2147480000";
    if (!G.MutationObserver) return;
    var mo = new G.MutationObserver(function () {
      if (db.classList.contains("on") || db.classList.contains("open")) return;
      var prev = db.getAttribute("data-rx-lift");
      db.style.zIndex = prev === "-" ? "" : prev; db.removeAttribute("data-rx-lift"); mo.disconnect();
    });
    mo.observe(db, { attributes: true, attributeFilter: ["class"] });
  }
  function toast(H, m) { try { if (H.toast) H.toast(m); else if (G.toast) G.toast(m); } catch (e) {} }
  function openOne(H, mid, id, title) {
    var sid = null;
    try { sid = H.subjectOfModule ? H.subjectOfModule(mid) : null; } catch (e) {}
    if (!sid) { toast(H, "This question is no longer available."); return; }
    H.loadModule(sid, mid).then(function (items) {
      var it = null;
      (items || []).forEach(function (x) { if (x && String(x.id) === String(id)) it = x; });
      if (!it || (it.flags && it.flags.length)) { toast(H, "This question is no longer available."); return; }
      try { H.stack().pop(); } catch (e) {}
      H.run([it], "study", title || "Related question");
    }, function () { toast(H, "Connect to open this question."); });
  }
  function practise(H, b) {
    var pairs = [];
    var iid = b && b.getAttribute ? b.getAttribute("data-i") : null;
    var smid = b && b.getAttribute ? b.getAttribute("data-m") : null;
    var slot = iid && R.slots ? R.slots[iid] : null;
    if (slot && slot.related && slot.related.length) {
      runPairs(slot.related.map(function (r) { return [r.mid, r.id]; }));
      return;
    }
    if (iid && smid) {
      shard(H, smid).then(function (sh) { runPairs(sh ? relOf(sh, iid) : []); });
      return;
    }
    if (R.last && R.last.related && R.last.related.length) pairs = R.last.related.map(function (r) { return [r.mid, r.id]; });
    else if (R.last) {
      var mid = R.last.mid;
      pairs = [];
      shard(H, mid).then(function (sh) { runPairs(sh ? relOf(sh, R.last.iid) : []); });
      return;
    }
    runPairs(pairs);
    function runPairs(ps) {
      var byM = {};
      ps.forEach(function (e) { (byM[e[0]] = byM[e[0]] || []).push(String(e[1])); });
      var mids = Object.keys(byM).slice(0, 3);
      if (!mids.length) { toast(H, "No related questions are on this phone yet."); return; }
      Promise.all(mids.map(function (mid) {
        var sid = null;
        try { sid = H.subjectOfModule(mid); } catch (e) {}
        if (!sid) return [];
        return H.loadModule(sid, mid).then(function (items) {
          var want = {};
          byM[mid].forEach(function (id) { want[id] = 1; });
          return (items || []).filter(function (it) { return it && want[String(it.id)] && !(it.flags && it.flags.length); });
        }, function () { return []; });
      })).then(function (lists) {
        var items = [];
        lists.forEach(function (l) { l.forEach(function (it) { if (items.length < 8) items.push(it); }); });
        if (!items.length) { toast(H, "No related questions are on this phone yet."); return; }
        try { H.stack().pop(); } catch (e) {}
        H.run(items, "study", "Related questions");
      });
    }
  }
  function act(a, b, H) {
    if (a === "r-km-sheet") {
      var iid = b.getAttribute("data-i");
      var d = iid && R.kmTargets && R.kmTargets[iid];
      if (d) openKmSheet(d, H);
      return;
    }
    if (a === "r-km-close") {
      closeKmSheet();
      return;
    }
    if (R.kmSheet) closeKmSheet();
    if (a === "r-kb") {
      var id = b.getAttribute("data-id");
      try {
        if (id && G.SMD_REASON && G.SMD_REASON.openRef && (!G.SMD_REASON.hasDiseaseRef || G.SMD_REASON.hasDiseaseRef(id))) {
          G.SMD_REASON.openRef(id, { from: "prep" }); lift("dxOverlay"); return;
        }
      } catch (e) {}
      toast(H, "This article is not on this phone.");
    }
    if (a === "r-drug") {
      var t = b.getAttribute("data-t");
      try {
        if (t && G.MEDDB && G.MEDDB.openComposition) { G.MEDDB.openComposition(t); lift("dbOverlay"); return; }
        if (G.MEDDB && G.MEDDB.openList) { G.MEDDB.openList(); lift("dbOverlay"); return; }
      } catch (e) {}
      toast(H, "The Drug Index is not ready yet.");
    }
    if (a === "r-proto") {
      var p = b.getAttribute("data-id");
      try {
        if (G.SMD_KBPROTO && G.SMD_KBPROTO.open) { G.SMD_KBPROTO.open(p ? { id: p } : null); lift("sbrefOverlay"); return; }
      } catch (e) {}
      toast(H, "The protocols are not ready yet.");
    }
    if (a === "r-rel") { openOne(H, b.getAttribute("data-m"), b.getAttribute("data-id"), "Related question"); return; }
    if (a === "r-practise") { practise(H, b); return; }
    if (a === "r-plan") { try { H.push(H.home); } catch (e) { toast(H, "Today's plan is on the home screen."); } return; }
  }

  G.PREP_REASON = { has: hasItem, body: function (it, o) { remember(it); return body(it, o); }, slotHtml: slotHtml,
    fill: fill, act: act, back: function () { return closeKmSheet(); }, linksOf: linksOf, nextAction: nextAction,
    pref: pref, kmSlot: kmSlot, knowMoreHtml: knowMoreHtml, kmTargets: kmTargets, closeKmSheet: closeKmSheet,
    _pure: PURE, _r: R };
})(typeof window !== "undefined" ? window : this);
