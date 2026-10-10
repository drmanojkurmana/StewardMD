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
   Learn more (Knowledge Library article, Drug Index, protocol, lesson, flashcards), one next learning action
   (Review the concept, Revise this topic, Practise related questions, Schedule revision: the first whose target
   exists) and Related questions. A link below confidence 75 is never shown. Links come from the item's own x.links
   (written by the content pipeline, confidence 95) merged with the published index v1/links/ (tools/prep-links.mjs):
   pointer index.json (short cache, network first, IndexedDB copy offline), one immutable shard per module
   (IndexedDB first). Lessons and card decks are re-checked against the live lesson and card indexes before they
   are shown.

   Opening: the Knowledge Library article through SMD_REASON.openRef (guarded by hasDiseaseRef), a drug through
   MEDDB.openComposition, a protocol through SMD_KBPROTO.open({ id }); each overlay is lifted above PrepNucleus
   while open (drug-link.js lift) and its own close returns here. Lessons and flashcards use the existing l-open
   and k-open actions, so back returns here. A related question opens alone in practice, like a shared ID. */
(function (G) {
  "use strict";

  /* ================= pure ================= */
  var SHOW = 75, VER = "v1";
  var LETTERS = ["A", "B", "C", "D"];

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
  /* shardLinks(sh, iid) -> [{ k, id, title, c, sec }] at confidence >= SHOW, strongest first. */
  function shardLinks(sh, iid) {
    var out = [];
    if (!sh || !sh.T || !sh.e) return out;
    var rows = sh.e[String(iid)] || [];
    rows.forEach(function (r) {
      var t = sh.T[r[0]];
      if (t && r[1] >= SHOW) out.push({ k: t[0], id: t[1], title: t[2], c: r[1], sec: r[3] || "" });
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

  /* body(it, o): the new explanation body. o { why (prep.js whyHtml), pearl (text), rs, chosen, md, inl }.
     Sections with no content are skipped; the links slot is filled later by fill(). */
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
    h += '<div class="pn-rx" data-i="' + escH(it.id) + '" data-s="' + escH(it._s || "") + '" data-m="' + escH(it._m || it.t || "") + '"></div>';
    return h;
  }
  /* slotHtml(d): Learn more + the one next action + related questions. d { links, lesson, cards, related, next,
     sid, mid }. links [{ k, id, title }], lesson { key, title } | null, cards bool, related [{ mid, id, stem }],
     next { kind, label, target } | null. "" when nothing exists. */
  function slotHtml(d) {
    var h = "", links = d.links || [];
    function row(act, attrs, kind, title) {
      return '<li><button type="button" class="pn-rlr" data-act="' + act + '"' + attrs + '><small>' + kind + "</small><b>" + escH(title) + "</b></button></li>";
    }
    var rows = "";
    links.forEach(function (l) {
      if (l.k === "kb") rows += row("r-kb", ' data-id="' + escH(l.id) + '"', "Knowledge Library", l.title || l.id);
      else if (l.k === "dr") rows += row("r-drug", ' data-t="' + escH(l.title || l.id) + '"', "Drug Index", l.title || l.id);
      else if (l.k === "pr") rows += row("r-proto", ' data-id="' + escH(l.id) + '"', "Protocol", l.title || l.id);
    });
    if (d.lesson) rows += row("l-open", ' data-s="' + escH(d.sid) + '" data-m="' + escH(d.mid) + '" data-l="' + escH(d.lesson.key) + '"', "Lesson", d.lesson.title || "Revise this topic");
    if (d.cards) rows += row("k-open", ' data-s="' + escH(d.sid) + '" data-m="' + escH(d.mid) + '"', "Flashcards", "Cards for this topic");
    if (rows) h += "<h3>Learn more</h3>" + '<ul class="pn-rl">' + rows + "</ul>";
    if (d.next) {
      var at = d.next.kind === "review" ? 'data-act="r-kb" data-id="' + escH(d.next.id) + '"' :
        d.next.kind === "revise" ? (d.next.lkey ? 'data-act="l-open" data-s="' + escH(d.sid) + '" data-m="' + escH(d.mid) + '" data-l="' + escH(d.next.lkey) + '"' : 'data-act="k-open" data-s="' + escH(d.sid) + '" data-m="' + escH(d.mid) + '"') :
        d.next.kind === "practise" ? 'data-act="r-practise"' : 'data-act="r-plan"';
      h += '<button type="button" class="pn-btn pri pn-rn" ' + at + "><b>" + escH(d.next.label) + "</b>" + (d.next.target ? "<small>" + escH(d.next.target) + "</small>" : "") + "</button>";
    }
    if (d.related && d.related.length) {
      h += "<h3>Related questions</h3>" + '<ul class="pn-rrq">' + d.related.map(function (r) {
        return '<li><button type="button" class="pn-rqr" data-act="r-rel" data-m="' + escH(r.mid) + '" data-id="' + escH(r.id) + '"><span>' + escH(r.stem) + "</span></button></li>";
      }).join("") + "</ul>";
    }
    return h;
  }

  var PURE = { SHOW: SHOW, VER: VER, has: hasItem, hasX: has, linksOf: linksOf, pref: pref, nextAction: nextAction,
    nextLabel: nextLabel, shardLinks: shardLinks, relOf: relOf, mergeLinks: mergeLinks, body: body, slotHtml: slotHtml, escH: escH };
  if (typeof module !== "undefined" && module.exports && !(G && G.document)) { module.exports = PURE; return; }

  /* ================= browser ================= */
  var R = { ptr: null, ptrP: null, last: null };
  function api(H) { return (H.bankApi || "/api/prep/bank/").replace(/\/?$/, "/"); }
  function cget(H, k) { try { return H.cacheGet ? Promise.resolve(H.cacheGet(k)).then(null, function () { return null; }) : Promise.resolve(null); } catch (e) { return Promise.resolve(null); } }
  function cput(H, k, v) { try { if (H.cachePut) H.cachePut(k, v); } catch (e) {} }
  function getJSON(url) { return G.fetch(url, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }); }
  /* The pointer: network first (it names the current shards), the IndexedDB copy offline. */
  function pointer(H) {
    if (R.ptr) return Promise.resolve(R.ptr);
    if (R.ptrP) return R.ptrP;
    R.ptrP = getJSON(api(H) + VER + "/links/index.json").then(function (p) {
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
        return getJSON(api(H) + VER + "/links/" + rel).then(function (sh) { cput(H, key, sh); return sh; }, function () { return null; });
      });
    }, function () { return null; });
  }
  function pretty(id) { return String(id || "").replace(/_/g, " ").replace(/(^|[\s-])([a-z])/g, function (m, a, b) { return a + b.toUpperCase(); }); }
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
  /* fill(H): patch the links slot of the feedback on screen, once. */
  function fill(H) {
    var root = null;
    try { root = H.root ? H.root() : null; } catch (e) { return; }
    if (!root || !R.last || R.last.filling) return;
    var slot = root.querySelector(".pn-rx[data-i]");
    if (!slot || slot.getAttribute("data-i") !== R.last.iid || slot.getAttribute("data-done")) return;
    R.last.filling = true;
    var L = R.last, sid = L.sid, mid = L.mid;
    if (!sid && mid && H.subjectOfModule) { try { sid = H.subjectOfModule(mid) || ""; } catch (e) {} }
    var pipe = linksOf(L.x);
    shard(H, mid).then(function (sh) {
      var ix = sh ? shardLinks(sh, L.iid) : [];
      var links = mergeLinks(pipe.filter(function (l) { return l.k === "kb" || l.k === "dr" || l.k === "pr"; }).map(function (l) { return { k: l.k, id: l.id, title: titleOf(l), c: 95 }; }), ix);
      links = links.filter(function (l) {
        if (l.k !== "kb" || !G.SMD_REASON || !G.SMD_REASON.hasDiseaseRef) return true;
        try { return G.SMD_REASON.hasDiseaseRef(l.id); } catch (e) { return true; }
      });
      var lsKeys = pipe.filter(function (l) { return l.k === "ls"; }).map(function (l) { return l.id; });
      if (sh && sh.mod && sh.mod.ls) lsKeys = lsKeys.concat(sh.mod.ls);
      var lkey = lsKeys[0] || null;
      var wantCd = pipe.some(function (l) { return l.k === "cd"; }) || !!(sh && sh.mod && sh.mod.cd);
      return Promise.all([lkey ? checkLesson(lkey, mid) : false, wantCd ? checkCards(mid) : false,
        resolveRelated(H, sh ? relOf(sh, L.iid) : [])]).then(function (r) {
        var lesson = lkey && r[0] ? { key: lkey } : null, cards = !!r[1], related = r[2] || [];
        var kb = links.filter(function (l) { return l.k === "kb"; });
        var kind = nextAction(pref(L.x.next), { kb: kb.length, lesson: (lesson ? 1 : 0) + (cards ? 1 : 0), related: related.length, plan: G.PREP_PLAN ? 1 : 0 });
        var next = null;
        if (kind === "review") next = { kind: kind, label: nextLabel(kind), id: kb[0].id, target: kb[0].title };
        else if (kind === "revise") next = { kind: kind, label: nextLabel(kind), lkey: lesson ? lesson.key : null, target: lesson ? "Lesson" : "Flashcards" };
        else if (kind === "practise") next = { kind: kind, label: nextLabel(kind), target: related.length + (related.length === 1 ? " question" : " questions") };
        else if (kind === "plan") next = { kind: kind, label: nextLabel(kind), target: "Today's plan" };
        L.related = related;
        var html = slotHtml({ links: links, lesson: lesson, cards: cards, related: related, next: next, sid: sid, mid: mid });
        slot.setAttribute("data-done", "1");
        var live = null;
        try { live = (H.root() || {}).querySelector && H.root().querySelector('.pn-rx[data-i="' + L.iid + '"]'); } catch (e) {}
        if (live) { live.innerHTML = html; live.setAttribute("data-done", "1"); }
        R.last.filling = false;
      });
    }, function () { R.last.filling = false; });
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
  function practise(H) {
    var pairs = [];
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
    if (a === "r-practise") { practise(H); return; }
    if (a === "r-plan") { try { H.push(H.home); } catch (e) { toast(H, "Today's plan is on the home screen."); } return; }
  }

  G.PREP_REASON = { has: hasItem, body: function (it, o) { remember(it); return body(it, o); }, slotHtml: slotHtml,
    fill: fill, act: act, linksOf: linksOf, nextAction: nextAction, pref: pref, _pure: PURE, _r: R };
})(typeof window !== "undefined" ? window : this);
