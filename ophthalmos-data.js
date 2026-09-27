/* Ophthalmós data layer: tracks, levels, access, persistence. No DOM. ES5.
   Browser: window.OPHTHALMOS_DATA. Node (tests): module.exports.
   Depends on ophthalmos-core.js (OPHTHALMOS_CORE / require). */
(function (G) {
  "use strict";
  var C = (typeof module !== "undefined" && module.exports) ? require("./ophthalmos-core.js") : G.OPHTHALMOS_CORE;

  var STORE_KEY = "smd_ophthalmos_v1";
  var PREF_KEY = "smd_ophthalmos_prefs";

  /* ---------- levels ---------- */
  // Foundation (shown as MBBS) groups fine classes into what a student should tell apart first; Resident is the
  // dataset's own classification. Each level keeps its own memory state and confusion table.
  function levelKey(trackId, level) { return trackId + (level === "resident" ? ".r" : ".f"); }

  function optionsFor(track, deck, level) {
    if (level !== "resident" && track.foundation) {
      return track.foundation.map(function (g) { return { id: g.id, label: g.label, of: g.of }; });
    }
    return (deck ? deck.options : Object.keys(track.labels || {})).map(function (a) {
      return { id: a, label: (track.labels && track.labels[a]) || a, of: [a] };
    });
  }

  function truthFor(track, level, fineAnswer) {
    if (level !== "resident" && track.foundation) {
      for (var i = 0; i < track.foundation.length; i++)
        if (track.foundation[i].of.indexOf(fineAnswer) >= 0) return track.foundation[i].id;
    }
    return fineAnswer;
  }

  // The deck as the scheduler sees it at a level: same ids, answers mapped to the level's classes.
  function levelDeck(track, deck, level) {
    return {
      id: levelKey(track.id, level),
      items: deck.items.map(function (it) { return { id: it.id, a: truthFor(track, level, it.a), it: it }; })
    };
  }

  /* ---------- access (owner decision: free core, Pro extras) ---------- */
  function levelLocked(cfg, level, pro) {
    if (pro) return false;
    var free = (cfg.access && cfg.access.freeLevels) || ["foundation"];
    return free.indexOf(level) < 0;
  }
  function caseLocked(cfg, caseIndex, pro) {
    if (pro) return false;
    var n = cfg.access && cfg.access.freeCases != null ? cfg.access.freeCases : 10;
    return caseIndex >= n;
  }

  /* ---------- free trials (owner decision 2026-09-28: Resident = Pro, one free trial per feature) ----------
     Feature ids: clinic.<trackId>, sim.retino, sim.neuro, exam, learn.resident, mcq.resident.
     "open" = Pro (or Resident unlocked by config), "trial" = the one trial is unused, "used" = spent. */
  function trialState(store, featureId, pro) {
    if (pro) return "open";
    return store && store.trials && store.trials[featureId] != null ? "used" : "trial";
  }
  // Records the trial on its first use only; true when this call granted it.
  function useTrial(store, featureId, day) {
    if (!store.trials) store.trials = {};
    if (store.trials[featureId] != null) return false;
    store.trials[featureId] = day;
    return true;
  }

  /* ---------- question-bank difficulty (d: 1 easy, 2 medium, 3 hard; pipeline/tag_difficulty.mjs) ---------- */
  // MBBS (foundation) sets draw easy and medium questions; Resident sets draw all.
  function mcqPool(items, level) {
    return level === "resident" ? items : items.filter(function (it) { return !(it.d > 2); });
  }

  /* ---------- persistence ---------- */
  function loadJSON(ls, k, dflt) {
    try { var v = ls && ls.getItem(k); return v ? JSON.parse(v) : dflt; } catch (e) { return dflt; }
  }
  function saveJSON(ls, k, v) { try { if (ls) ls.setItem(k, JSON.stringify(v)); } catch (e) {} }

  function loadStore(ls) {
    var s = loadJSON(ls, STORE_KEY, null);
    if (!s || s.v !== 1 || !s.cards) s = C.emptyStore();
    if (!s.conf) s.conf = {};
    if (!s.days) s.days = {};
    if (!s.trials) s.trials = {};
    if (!s.learn) s.learn = {};
    return s;
  }
  function saveStore(ls, s) { saveJSON(ls, STORE_KEY, s); }
  // tab: "learn" | "test", unset until the first-run choice; lang: "en" | "hi".
  function loadPrefs(ls) {
    var p = loadJSON(ls, PREF_KEY, null) || {};
    if (p.level !== "resident") p.level = "foundation";
    if (p.lang !== "hi") p.lang = "en";
    if (p.tab !== "learn" && p.tab !== "test") delete p.tab;
    return p;
  }
  function firstRun(prefs) { return !prefs.tab; }
  function savePrefs(ls, p) { saveJSON(ls, PREF_KEY, p); }

  /* ---------- helpers for the UI ---------- */
  function today(now) { var d = new Date(now); return C.dayNum(d.getTime(), d.getTimezoneOffset()); }

  // One representative image per class for a track's thumbnail strip: stable across renders.
  function sampleByClass(deck, max) {
    var seen = {}, out = [];
    for (var i = 0; i < deck.items.length && out.length < max; i++) {
      var it = deck.items[(i * 7919) % deck.items.length];
      if (!seen[it.a]) { seen[it.a] = 1; out.push(it); }
    }
    return out;
  }

  // Due-tomorrow forecast for the summary screen.
  function dueOn(store, prefix, day) {
    var n = 0;
    Object.keys(store.cards).forEach(function (k) {
      if (k.indexOf(prefix) === 0 && store.cards[k][3] <= day) n++;
    });
    return n;
  }

  /* ---------- Learn (owner decisions 2026-09-28): bilingual text, lessons, progress ---------- */
  // Bilingual text: {en, hi} -> the language asked for, else English. Plain strings pass through.
  function t(obj, lang) {
    if (obj == null) return "";
    if (typeof obj !== "object") return String(obj);
    return obj[lang] || obj.en || "";
  }
  // "[[termId]]" or "[[termId|shown text]]" glossary links -> [{text}] and [{term, shown?}] parts, in order.
  function glossParts(s) {
    var out = [], re = /\[\[([a-z0-9-]+)(?:\|([^\]]+))?\]\]/g, last = 0, m;
    s = String(s == null ? "" : s);
    while ((m = re.exec(s))) {
      if (m.index > last) out.push({ text: s.slice(last, m.index) });
      out.push(m[2] ? { term: m[1], shown: m[2] } : { term: m[1] });
      last = re.lastIndex;
    }
    if (last < s.length) out.push({ text: s.slice(last) });
    return out;
  }

  // Schema check for ophthalmos/learn/lessons/<id>.json (the content engineer's files). [] = valid.
  // media: the image library by id (learn/media/credits.json); when given, see.more ids must be in it.
  function validateLesson(l, glossary, media) {
    var e = [];
    function bi(v, where) {
      if (!v || typeof v !== "object" || typeof v.en !== "string" || !v.en.trim()) { e.push(where + ": needs {en, hi} text with en"); return; }
      if (v.hi != null && typeof v.hi !== "string") e.push(where + ": hi must be text");
      if (glossary) [v.en, v.hi].forEach(function (s) {
        glossParts(s).forEach(function (p) { if (p.term && !glossary[p.term]) e.push(where + ": unknown glossary term " + p.term); });
      });
    }
    function list(v, where, min) {
      if (!Array.isArray(v) || v.length < (min || 0)) { e.push(where + ": needs a list" + (min ? " of at least " + min : "")); return []; }
      return v;
    }
    if (!l || typeof l !== "object") return ["lesson: not an object"];
    if (typeof l.id !== "string" || !/^[a-z0-9-]+$/.test(l.id)) e.push("id: lowercase letters, digits and hyphens");
    if (typeof l.unit !== "string" || !l.unit) e.push("unit: missing");
    if (l.level !== "mbbs" && l.level !== "resident") e.push("level: mbbs or resident");
    if (!(l.minutes > 0)) e.push("minutes: a positive number");
    bi(l.title, "title"); bi(l.idea, "idea"); bi(l.remember, "remember");
    var s = l.see;
    if (!s || typeof s !== "object") e.push("see: missing");
    else {
      if (!s.img && !s.diagram) e.push("see: needs img or diagram");
      if (s.diagram && !/^diagrams\/[a-z0-9-]+\.svg$/.test(s.diagram)) e.push("see.diagram: diagrams/<name>.svg");
      if (s.diagram && !(s.w > 0 && s.h > 0)) e.push("see.w, see.h: the diagram's viewBox width and height");
      if (s.deckItem && (typeof s.deckItem.deck !== "string" || s.deckItem.id == null)) e.push("see.deckItem: {deck, id}");
      // see.more: extra pictures from the image library, shown under the main one (alt, caption, credit from credits.json)
      if (s.more != null) list(s.more, "see.more").forEach(function (id, i) {
        if (typeof id !== "string" || !/^[a-z0-9-]+$/.test(id)) e.push("see.more[" + i + "]: a media id");
        else if (media && !media[id]) e.push("see.more[" + i + "]: unknown media " + id);
      });
      bi(s.alt, "see.alt"); bi(s.caption, "see.caption");
      list(s.hotspots, "see.hotspots").forEach(function (h, i) {
        if (!(h && h.x >= 0 && h.x <= 1 && h.y >= 0 && h.y <= 1)) e.push("see.hotspots[" + i + "]: x and y between 0 and 1");
        bi(h && h.label, "see.hotspots[" + i + "].label"); bi(h && h.note, "see.hotspots[" + i + "].note");
      });
    }
    if (!l.why || typeof l.why !== "object") e.push("why: missing");
    else {
      list(l.why.steps, "why.steps", 1).forEach(function (x, i) { bi(x, "why.steps[" + i + "]"); });
      bi(l.why.analogy, "why.analogy");
    }
    list(l.spot, "spot", 1).forEach(function (x, i) { bi(x, "spot[" + i + "]"); });
    list(l.todo, "todo", 1).forEach(function (x, i) { bi(x, "todo[" + i + "]"); });
    list(l.check, "check", 1).forEach(function (q, i) {
      var w = "check[" + i + "]";
      if (!q || typeof q !== "object") { e.push(w + ": not an object"); return; }
      bi(q.q, w + ".q"); bi(q.why, w + ".why");
      var o = list(q.o, w + ".o", 2);
      o.forEach(function (x, j) { bi(x, w + ".o[" + j + "]"); });
      if (!(q.a === (q.a | 0) && q.a >= 0 && q.a < o.length)) e.push(w + ".a: index of the right option");
    });
    if (!l.test || typeof l.test !== "object") e.push("test: missing");
    else {
      if (l.test.clinic != null && typeof l.test.clinic !== "string") e.push("test.clinic: a track id");
      if (l.test.classes != null && !Array.isArray(l.test.classes)) e.push("test.classes: a list");
      if (!l.test.clinic && !l.test.mcqTopic) e.push("test: needs clinic or mcqTopic");
    }
    if (l.deeper != null && (typeof l.deeper !== "object" || typeof l.deeper.note !== "string")) e.push("deeper: {note}");
    list(l.glossary, "glossary").forEach(function (id) { if (glossary && !glossary[id]) e.push("glossary: unknown term " + id); });
    list(l.sources, "sources", 1);
    return e;
  }
  /* ---------- Learn image library (ophthalmos/learn/media/credits.json) ---------- */
  // Credit parts for a media item, as its licence requires: author, licence (linked for CC), source link, and
  // whether it was adapted. Originals are credited to MAIKNOWLEDGE LLP.
  function mediaCredit(m) {
    if (!m) return null;
    if (m.route === "original") return { by: "", licence: m.licence || "Original, MAIKNOWLEDGE LLP", licenceUrl: "", source: "", adapted: false };
    var cc = /^CC (BY(?:-SA)?) (\d\.\d)$/.exec(m.licence || ""), url = "";
    if (cc) url = "https://creativecommons.org/licenses/" + cc[1].toLowerCase() + "/" + cc[2] + "/";
    else if (m.licence === "CC0") url = "https://creativecommons.org/publicdomain/zero/1.0/";
    return { by: m.author || "", licence: m.licence || "", licenceUrl: url, source: m.source || "", adapted: !!m.changes };
  }
  // An inline SVG made safe to put next to another: every id (and url(#id) / href="#id"), every class and every
  // @keyframes name gets the prefix p + "-", each style rule is scoped under the root's class p (so "*" and element
  // selectors reach only this picture, the reduced-motion rule included), <title>s go (the figure carries the
  // bilingual label) and the root is hidden from assistive tech. p: letters and digits.
  function scopeSvg(src, p) {
    var ids = {}, pre = p + "-";
    var s = String(src || "").replace(/<\?xml[\s\S]*?\?>|<!DOCTYPE[^>]*>|<!--[\s\S]*?-->|<title>[\s\S]*?<\/title>/gi, "")
      .replace(/<(script|foreignObject)\b[\s\S]*?<\/\1>/gi, "").replace(/\son[a-z]+="[^"]*"/gi, "");
    s = s.replace(/(\s)id="([^"]+)"/g, function (m, w, id) { ids[id] = 1; return w + 'id="' + pre + id + '"'; });
    s = s.replace(/url\(#([^)\s]+)\)/g, function (m, id) { return ids[id] ? "url(#" + pre + id + ")" : m; });
    s = s.replace(/(href=")#([^"]+)"/g, function (m, a, id) { return ids[id] ? a + "#" + pre + id + '"' : m; });
    s = s.replace(/(\s)cl[a]ss="([^"]*)"/g, function (m, w, c) {
      return w + 'class="' + c.split(/\s+/).filter(Boolean).map(function (x) { return pre + x; }).join(" ") + '"';
    });
    s = s.replace(/<style([^>]*)>([\s\S]*?)<\/style>/g, function (m, a, css) { return "<style" + a + ">" + scopeCss(css, p) + "</style>"; });
    return s.replace(/<svg\b([^>]*)>/, function (m, a) {
      a = a.replace(/\s(?:role|aria-[a-z]+|focusable)="[^"]*"/g, "");
      a = /\scl[a]ss="/.test(a) ? a.replace(/\scl[a]ss="/, ' class="' + p + " ") : a + ' class="' + p + '"';
      return "<svg" + a + ' aria-hidden="true" focusable="false">';
    });
  }
  function scopeCss(css, p) {
    var names = {}, pre = p + "-";
    css.replace(/@keyframes\s+([\w-]+)/g, function (m, n) { names[n] = 1; });
    function decl(b) {
      return b.replace(/(animation(?:-name)?\s*:)([^;}]*)/g, function (m, k, v) {
        return k + v.replace(/[\w-]+/g, function (w) { return names[w] ? pre + w : w; });
      });
    }
    function sel(x) {
      x = x.trim().replace(/\.([A-Za-z_][\w-]*)/g, "." + pre + "$1");
      return /^svg\b/.test(x) ? "svg." + p + x.slice(3) : "." + p + " " + x;
    }
    function block(c) {
      var out = "", i = 0;
      while (i < c.length) {
        var ob = c.indexOf("{", i);
        if (ob < 0) { out += c.slice(i); break; }
        var head = c.slice(i, ob).trim(), d = 1, j = ob + 1;
        while (j < c.length && d) { if (c.charAt(j) === "{") d++; else if (c.charAt(j) === "}") d--; j++; }
        var body = c.slice(ob + 1, j - 1);
        if (/^@keyframes\s/.test(head)) out += "@keyframes " + pre + head.replace(/^@keyframes\s+/, "") + "{" + body + "}";
        else if (/^@(media|supports)\b/.test(head)) out += head + "{" + block(body) + "}";
        else if (head.charAt(0) === "@") out += head + "{" + body + "}";
        else out += head.split(",").map(sel).join(",") + "{" + decl(body) + "}";
        i = j;
      }
      return out;
    }
    return block(css);
  }
  function validateIndex(ix) {
    var e = [];
    if (!ix || ix.v !== 1 || !Array.isArray(ix.units)) return ["index: needs {v: 1, units: [...]}"];
    ix.units.forEach(function (u, i) {
      if (!u || typeof u.id !== "string") e.push("units[" + i + "].id: missing");
      if (!u || !u.title || typeof u.title.en !== "string") e.push("units[" + i + "].title: needs {en, hi}");
      if (!u || (u.level !== "mbbs" && u.level !== "resident")) e.push("units[" + i + "].level: mbbs or resident");
      if (!u || !Array.isArray(u.lessons)) e.push("units[" + i + "].lessons: a list of ids");
    });
    return e;
  }

  // Units in study order: every MBBS unit, then every Resident unit, each in index order.
  function learnUnits(ix) {
    var u = (ix && ix.units) || [];
    return u.filter(function (x) { return x.level === "mbbs"; }).concat(u.filter(function (x) { return x.level === "resident"; }));
  }
  function lessonDone(store, id) { return !!(store.learn && store.learn[id] && store.learn[id].done); }
  // The next lesson to study: the first unfinished one in study order, {id, level}; null when all are done.
  function nextLesson(ix, store) {
    var units = learnUnits(ix);
    for (var i = 0; i < units.length; i++)
      for (var j = 0; j < units[i].lessons.length; j++)
        if (!lessonDone(store, units[i].lessons[j])) return { id: units[i].lessons[j], level: units[i].level };
    return null;
  }
  // Finishing the check marks the lesson done and turns its "remember" line into an FSRS card (deck key "learn",
  // rated Good) the first time. True when this call finished it.
  function finishLesson(store, id, day) {
    if (!store.learn) store.learn = {};
    if (lessonDone(store, id)) return false;
    store.learn[id] = { done: true, day: day };
    if (!store.cards[C.key("learn", id)]) C.review(store, "learn", id, C.GOOD, day);
    return true;
  }
  // Lesson ids whose remember card is due on day, most overdue first.
  function learnDue(store, day) {
    var out = [], k;
    for (k in store.cards) if (k.indexOf("learn:") === 0 && store.cards[k][3] <= day) out.push(k);
    out.sort(function (a, b) { return store.cards[a][3] - store.cards[b][3]; });
    return out.map(function (k2) { return k2.slice(6); });
  }

  var API = {
    STORE_KEY: STORE_KEY, PREF_KEY: PREF_KEY, firstRun: firstRun,
    t: t, glossParts: glossParts, validateLesson: validateLesson, validateIndex: validateIndex, mediaCredit: mediaCredit, scopeSvg: scopeSvg,
    learnUnits: learnUnits, lessonDone: lessonDone, nextLesson: nextLesson, finishLesson: finishLesson, learnDue: learnDue,
    levelKey: levelKey, optionsFor: optionsFor, truthFor: truthFor, levelDeck: levelDeck,
    levelLocked: levelLocked, caseLocked: caseLocked, trialState: trialState, useTrial: useTrial, mcqPool: mcqPool,
    loadStore: loadStore, saveStore: saveStore, loadPrefs: loadPrefs, savePrefs: savePrefs,
    today: today, sampleByClass: sampleByClass, dueOn: dueOn
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else G.OPHTHALMOS_DATA = API;
})(typeof window !== "undefined" ? window : this);
