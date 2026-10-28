/* clinix-practicals.js - CliniX · Practicals runner (spotters, instruments, drugs, procedures, charts).
 *
 * ES5 IIFE. Buildless mobile app runner for the 27 finished practicals decks under clinix/practicals/.
 * Supports:
 *   1. Subject picker (Obstetrics and gynaecology, Paediatrics, Surgery when present)
 *   2. Deck list with metadata, kind chips, and progress indicator
 *   3. Browse deck: searchable list grouped by group, item detail with image/quiet placeholder,
 *      summary, structured blocks (bullets, text, groups, horizontal-scrolling table),
 *      dosage warning for drugs ("Exam reference. Check your local protocol."),
 *      tap-to-reveal viva pairs, and swipe-friendly prev/next buttons
 *   4. Spotter quiz (the exam): 10 questions with image or masked summary, 5 options (1 correct +
 *      4 same-kind distractors), immediate feedback with key identifying points, 2 follow-up
 *      viva questions with model answers and self-grade ("Got it / Missed it"), score and review
 *   5. Viva rehearsal: random viva pairs from a deck, tap to reveal answer, got it / missed it,
 *      and completion summary
 *   6. Persistence: seen items and best quiz scores stored in localStorage (smd_clinix_practicals_v1)
 *
 * Pure functions exported under module.exports for Node unit tests.
 */
(function (G) {
  "use strict";

  var STORE_KEY = "smd_clinix_practicals_v1";
  var BASE = "/clinix/";

  /* ── 1. Pure logic & algorithms ─────────────────────────────────────────── */

  // 32-bit FNV-1a hash
  function hashSeed(str) {
    var h = 2166136261 >>> 0;
    var s = String(str || "");
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  // Deterministic 32-bit PRNG (mulberry32)
  function seededRandom(seed) {
    var a = (typeof seed === "number" ? seed : hashSeed(String(seed || 1))) >>> 0;
    return function () {
      var t = (a += 0x6D2B79F5) >>> 0;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Fisher-Yates array shuffle (pure, non-mutating)
  function shuffle(arr, rand) {
    if (!arr || !arr.length) return [];
    var rng = rand || Math.random;
    var copy = arr.slice();
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }

  function getTitle(item) {
    if (!item) return "";
    if (item.title && typeof item.title === "object" && item.title.en) return String(item.title.en);
    if (typeof item.title === "string") return item.title;
    return String(item.id || "");
  }

  function escapeRegex(s) {
    return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // Mask title and aka phrases out of clinical summary for image-less spotter questions
  function maskTitle(text, title, akas) {
    if (!text) return "";
    var phrases = [];
    if (title) phrases.push(String(title).trim());
    if (Array.isArray(akas)) {
      for (var i = 0; i < akas.length; i++) {
        if (akas[i]) phrases.push(String(akas[i]).trim());
      }
    }
    // Filter phrases that are too short (avoid masking single letters)
    phrases = phrases.filter(function (p) { return p.length >= 3; });
    // Sort longest first to avoid partial replacements
    phrases.sort(function (a, b) { return b.length - a.length; });

    var out = String(text);
    for (var j = 0; j < phrases.length; j++) {
      try {
        var rx = new RegExp("\\b" + escapeRegex(phrases[j]) + "\\b", "gi");
        out = out.replace(rx, "[This item]");
      } catch (e) {}
    }
    return out;
  }

  // Key identifying points extracted from item blocks
  function getKeyIdentifyingPoints(item) {
    if (!item) return [];
    var blocks = item.blocks || [];
    // Prefer block with title matching recognition / identification
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      var title = String(b.title || "").toLowerCase();
      if (/recogni[sz]e|identif|features|appearance|characteristics|diagnostic|principles|components/i.test(title)) {
        if (Array.isArray(b.bullets) && b.bullets.length) return b.bullets.slice(0, 3);
        if (b.text) return [b.text];
        if (Array.isArray(b.groups) && b.groups.length && b.groups[0].bullets) return b.groups[0].bullets.slice(0, 3);
      }
    }
    // Fallback: first block's bullets or text
    if (blocks.length && Array.isArray(blocks[0].bullets) && blocks[0].bullets.length) {
      return blocks[0].bullets.slice(0, 3);
    }
    if (blocks.length && blocks[0].text) return [blocks[0].text];
    if (item.summary) return [item.summary];
    return [];
  }

  // Distractor generator: prefers same kind (and same group), strictly deduplicated titles
  function getDistractors(item, candidates, count, rand) {
    count = count || 4;
    var rng = rand || Math.random;
    var targetTitle = getTitle(item).trim().toLowerCase();
    var seenTitles = {};
    seenTitles[targetTitle] = true;

    var sameKindSameGroup = [];
    var sameKindOtherGroup = [];
    var otherKind = [];

    var list = Array.isArray(candidates) ? candidates : [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (!c || c.id === item.id) continue;
      var t = getTitle(c).trim();
      var low = t.toLowerCase();
      if (!t || seenTitles[low]) continue;
      seenTitles[low] = true;

      if (c.kind === item.kind) {
        if (item.group && c.group === item.group) sameKindSameGroup.push(c);
        else sameKindOtherGroup.push(c);
      } else {
        otherKind.push(c);
      }
    }

    var pool1 = shuffle(sameKindSameGroup, rng);
    var pool2 = shuffle(sameKindOtherGroup, rng);
    var pool3 = shuffle(otherKind, rng);

    var picked = [];
    for (var p1 = 0; p1 < pool1.length && picked.length < count; p1++) picked.push(pool1[p1]);
    for (var p2 = 0; p2 < pool2.length && picked.length < count; p2++) picked.push(pool2[p2]);
    for (var p3 = 0; p3 < pool3.length && picked.length < count; p3++) picked.push(pool3[p3]);

    return picked;
  }

  // Generate 5 options with exactly one correct option and 4 distractors
  function generateOptions(item, candidates, opts) {
    opts = opts || {};
    var seed = opts.seed != null
      ? (typeof opts.seed === "number" ? opts.seed : hashSeed(String(opts.seed)))
      : hashSeed((item ? item.id : "item") + ":options");
    var rand = seededRandom(seed);
    var count = opts.count || 5;
    var distractorCount = count - 1;

    var distractors = getDistractors(item, candidates, distractorCount, rand);
    var options = [];

    for (var i = 0; i < distractors.length; i++) {
      var d = distractors[i];
      options.push({
        id: d.id,
        title: getTitle(d),
        kind: d.kind,
        group: d.group || "",
        correct: false
      });
    }

    options.push({
      id: item.id,
      title: getTitle(item),
      kind: item.kind,
      group: item.group || "",
      correct: true
    });

    return shuffle(options, rand);
  }

  // Image credit line. Never repeats a Commons file title: in the spotter quiz that would name the answer.
  function creditText(c) {
    if (!c) return "";
    if (typeof c === "string") return "Image: " + c;
    if (c.generated) return "Illustration created with MaiK (StewardMD AI)";
    var parts = [];
    if (c.author && !/^See the Commons/i.test(c.author)) parts.push(c.author);
    if (c.licence) parts.push(c.licence);
    var from = c.source || "Wikimedia Commons";
    return parts.length ? "Image: " + parts.join(", ") + " (" + from + ")" : "Image: " + from;
  }

  // Build a single spotter quiz question
  function buildQuestion(item, candidates, opts) {
    opts = opts || {};
    var title = getTitle(item);
    var hasImg = !!(item.image && item.image.file);
    var imgFile = hasImg ? item.image.file : null;
    var imgBrief = (item.image && item.image.brief) ? item.image.brief : "";

    var options = generateOptions(item, candidates, opts);
    var keyPoints = getKeyIdentifyingPoints(item);
    var prompt = hasImg ? "" : maskTitle(item.summary || "", title, item.aka);

    var rawViva = Array.isArray(item.viva) ? item.viva : [];
    var vivaPairs = [];
    for (var v = 0; v < Math.min(2, rawViva.length); v++) {
      if (rawViva[v] && rawViva[v].q && rawViva[v].a) {
        vivaPairs.push({
          q: rawViva[v].q,
          a: rawViva[v].a
        });
      }
    }

    return {
      id: item.id,
      title: title,
      kind: item.kind,
      group: item.group || "",
      hasImage: hasImg,
      imageFile: imgFile,
      imageCredit: hasImg ? (item.image.credit || null) : null,
      imageBrief: imgBrief,
      promptText: prompt,
      summary: item.summary || "",
      keyPoints: keyPoints,
      options: options,
      viva: vivaPairs
    };
  }

  // Build a complete 10-question spotter quiz
  function buildSpotterQuiz(deckItems, candidatePool, opts) {
    opts = opts || {};
    var pool = (candidatePool && candidatePool.length) ? candidatePool : deckItems;
    var items = Array.isArray(deckItems) ? deckItems : [];
    if (!items.length) return [];

    /* A spotter is a "what is this?" test, so it needs the picture. Quiz only the items that have a
     * photograph whenever there are enough of them (owner: "what is the use of a spotter without
     * images"); the image-less ones stay in Browse. A deck with almost no photos keeps the old
     * masked-summary questions rather than becoming a 1-question quiz. */
    var withImg = items.filter(function (it) { return !!(it && it.image && it.image.file); });
    if (withImg.length >= Math.min(opts.count || 10, items.length, 5)) items = withImg;

    var count = Math.min(opts.count || 10, items.length);
    var seed = opts.seed != null ? (typeof opts.seed === "number" ? opts.seed : hashSeed(String(opts.seed))) : hashSeed("quiz:" + Date.now());
    var rand = seededRandom(seed);

    var shuffledItems = shuffle(items, rand).slice(0, count);
    var questions = [];

    for (var i = 0; i < shuffledItems.length; i++) {
      var it = shuffledItems[i];
      var qOpts = {
        count: 5,
        seed: hashSeed(seed + ":q:" + i + ":" + it.id)
      };
      questions.push(buildQuestion(it, pool, qOpts));
    }

    return questions;
  }

  // Build a viva rehearsal session from a deck
  function buildVivaSession(deckItems, opts) {
    opts = opts || {};
    var items = Array.isArray(deckItems) ? deckItems : [];
    var count = opts.count || 10;
    var seed = opts.seed != null ? (typeof opts.seed === "number" ? opts.seed : hashSeed(String(opts.seed))) : hashSeed("viva:" + Date.now());
    var rand = seededRandom(seed);

    var pairs = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var title = getTitle(it);
      var vivas = Array.isArray(it.viva) ? it.viva : [];
      for (var v = 0; v < vivas.length; v++) {
        if (vivas[v] && vivas[v].q && vivas[v].a) {
          pairs.push({
            itemId: it.id,
            itemTitle: title,
            itemKind: it.kind,
            q: vivas[v].q,
            a: vivas[v].a
          });
        }
      }
    }

    if (!pairs.length) return [];
    var shuffled = shuffle(pairs, rand);
    return shuffled.slice(0, Math.min(count, shuffled.length));
  }

  // Filter items by group and search query
  function filterItems(items, group, query) {
    if (!Array.isArray(items)) return [];
    var grp = (group || "all").trim();
    var q = (query || "").trim().toLowerCase();

    return items.filter(function (it) {
      if (grp !== "all" && it.group !== grp) return false;
      if (!q) return true;

      var title = getTitle(it).toLowerCase();
      if (title.indexOf(q) >= 0) return true;

      if (it.group && it.group.toLowerCase().indexOf(q) >= 0) return true;
      if (it.kind && it.kind.toLowerCase().indexOf(q) >= 0) return true;
      if (it.summary && it.summary.toLowerCase().indexOf(q) >= 0) return true;

      if (Array.isArray(it.aka)) {
        for (var i = 0; i < it.aka.length; i++) {
          if (it.aka[i] && it.aka[i].toLowerCase().indexOf(q) >= 0) return true;
        }
      }
      return false;
    });
  }

  // Calculate quiz score and breakdown
  function calculateQuizScore(questions, answers) {
    questions = Array.isArray(questions) ? questions : [];
    answers = answers || {};

    var spotterScore = 0;
    var spotterTotal = questions.length;
    var vivaGot = 0;
    var vivaTotal = 0;
    var review = [];

    for (var i = 0; i < questions.length; i++) {
      var q = questions[i];
      var ans = answers[i] || {};
      var isCorrect = !!ans.correct;
      if (isCorrect) spotterScore++;

      var vAns = ans.viva || {};
      var vCount = (q.viva || []).length;
      for (var v = 0; v < vCount; v++) {
        vivaTotal++;
        if (vAns[v] === "got") vivaGot++;
      }

      review.push({
        index: i,
        id: q.id,
        title: q.title,
        kind: q.kind,
        correct: isCorrect,
        chosenTitle: ans.chosenTitle || "Not answered",
        correctTitle: q.title,
        keyPoints: q.keyPoints || [],
        vivaAnswers: vAns
      });
    }

    var spotterPct = spotterTotal ? Math.round((spotterScore / spotterTotal) * 100) : 0;
    var vivaPct = vivaTotal ? Math.round((vivaGot / vivaTotal) * 100) : 0;

    return {
      spotterScore: spotterScore,
      spotterTotal: spotterTotal,
      spotterPct: spotterPct,
      vivaScore: vivaGot,
      vivaTotal: vivaTotal,
      vivaPct: vivaPct,
      review: review
    };
  }

  /* ── 2. Progress & Storage API ───────────────────────────────────────────── */

  function readStore() {
    try {
      if (typeof localStorage === "undefined") return { seen: {}, bestScores: {} };
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return { seen: {}, bestScores: {} };
      var data = JSON.parse(raw);
      if (!data || typeof data !== "object") return { seen: {}, bestScores: {} };
      return {
        seen: data.seen && typeof data.seen === "object" ? data.seen : {},
        bestScores: data.bestScores && typeof data.bestScores === "object" ? data.bestScores : {}
      };
    } catch (e) {
      return { seen: {}, bestScores: {} };
    }
  }

  function writeStore(data) {
    try {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch (e) {}
  }

  function markSeen(itemId) {
    if (!itemId) return;
    var store = readStore();
    store.seen[itemId] = Date.now();
    writeStore(store);
  }

  function isItemSeen(itemId) {
    if (!itemId) return false;
    var store = readStore();
    return !!store.seen[itemId];
  }

  function recordQuizScore(deckKey, score, total) {
    if (!deckKey) return;
    var store = readStore();
    var prev = store.bestScores[deckKey];
    var pct = total ? Math.round((score / total) * 100) : 0;

    if (!prev || pct > prev.pct) {
      store.bestScores[deckKey] = {
        score: score,
        total: total,
        pct: pct,
        updated: Date.now()
      };
      writeStore(store);
    }
  }

  function getDeckProgress(deckKey, deckItems) {
    var store = readStore();
    var items = Array.isArray(deckItems) ? deckItems : [];
    var seenCount = 0;
    for (var i = 0; i < items.length; i++) {
      if (store.seen[items[i].id]) seenCount++;
    }
    var best = store.bestScores[deckKey] || null;
    return {
      seenCount: seenCount,
      totalItems: items.length,
      bestScore: best ? best.score : null,
      bestTotal: best ? best.total : null,
      bestPct: best ? best.pct : null
    };
  }

  function clearProgress() {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem(STORE_KEY);
      }
    } catch (e) {}
  }

  // Wipe progress on app-wide sign-out event
  if (typeof window !== "undefined" && window.addEventListener) {
    ["smd:signout", "smd-signout", "signout", "smd:logout"].forEach(function (ev) {
      try { window.addEventListener(ev, clearProgress); } catch (e) {}
    });
  }

  /* ── 3. Content Loading API ──────────────────────────────────────────────── */

  var _cache = {
    index: null,
    decks: {}
  };

  function ver() {
    try {
      var cat = window.SMD_CLINIX_CONTENT && SMD_CLINIX_CONTENT._cache && SMD_CLINIX_CONTENT._cache().catalog;
      return (cat && cat.contentVersion) || "";
    } catch (e) {
      return "";
    }
  }

  function getJSON(path, opts) {
    if (typeof fetch === "undefined") return Promise.resolve(null);
    var v = (opts && opts.noVersion) ? "" : ver();
    var url = BASE + path + (v ? ((path.indexOf("?") >= 0 ? "&" : "?") + "v=" + encodeURIComponent(v)) : "");
    var init = (opts && opts.fresh) ? { cache: "no-store" } : undefined;
    return fetch(url, init)
      .then(function (r) { return (r && r.ok) ? r.json() : null; })
      .catch(function () { return null; });
  }

  function loadIndex() {
    if (_cache.index) return Promise.resolve(_cache.index);
    return getJSON("practicals/index.json").then(function (res) {
      if (!res || !Array.isArray(res.decks)) return null;
      _cache.index = res;
      return res;
    });
  }

  function loadDeck(filePath) {
    if (!filePath) return Promise.resolve(null);
    if (_cache.decks[filePath]) return Promise.resolve(_cache.decks[filePath]);
    return getJSON(filePath).then(function (res) {
      if (!res || !Array.isArray(res.items)) return null;
      _cache.decks[filePath] = res;
      return res;
    });
  }

  function loadSubjectDecks(subject) {
    return loadIndex().then(function (idx) {
      if (!idx || !idx.decks) return [];
      var filtered = idx.decks.filter(function (d) { return d.subject === subject; });
      var jobs = filtered.map(function (d) { return loadDeck(d.file); });
      return Promise.all(jobs).then(function (decks) {
        var allItems = [];
        for (var i = 0; i < decks.length; i++) {
          if (decks[i] && Array.isArray(decks[i].items)) {
            allItems = allItems.concat(decks[i].items);
          }
        }
        return {
          meta: filtered,
          items: allItems
        };
      });
    });
  }

  /* ── 4. UI Rendering Helpers & Views ─────────────────────────────────────── */

  var KIND_ICONS = {
    instrument: "medical_services",
    device: "biotech",
    drug: "medication",
    procedure: "healing",
    method: "psychology",
    staging: "format_list_numbered",
    chart: "show_chart",
    specimen: "science",
    xray: "radiology",
    model: "view_in_ar",
    "case-sheet": "clinical_notes",
    "exam-step": "stethoscope",
    topic: "menu_book"
  };

  function kindIcon(kind) {
    return KIND_ICONS[kind] || "biotech";
  }

  var SUBJECT_CONFIG = {
    obgyn: {
      id: "obgyn",
      title: "Obstetrics and gynaecology",
      icon: "pregnant_woman",
      sub: "Instruments, spotters, drugs, CTG, staging and procedures"
    },
    paediatrics: {
      id: "paediatrics",
      title: "Paediatrics",
      icon: "child_care",
      sub: "Instruments, growth charts, developmental milestones, drugs and procedures"
    },
    surgery: {
      id: "surgery",
      title: "Surgery",
      icon: "surgical",
      sub: "Instruments, specimens, X-rays, procedures and surgical spotters"
    }
  };

  /* Active practicals UI session state */
  var session = {
    subject: null,
    deckFile: null,
    deckData: null,
    deckItems: [],
    candidatePool: [],
    viewMode: "browse", // "browse" | "quiz" | "viva"
    browseGroup: "all",
    browseQuery: "",
    selectedItemId: null,
    quizQuestions: [],
    quizIndex: 0,
    quizAnswers: {},
    quizFinished: false,
    vivaSession: [],
    vivaIndex: 0,
    vivaAnswered: {},
    vivaFinished: false
  };

  function render(host, state, H) {
    if (!host) return;
    var esc = H.esc, ic = H.ic, header = H.header;

    loadIndex().then(function (idx) {
      if (!idx || !idx.decks || !idx.decks.length) {
        host.innerHTML = header("Practicals", "Practical exam preparation") +
          H.emptyState("biotech", "No practicals decks found", "Check your connection and try again.");
        return;
      }

      // If no subject is selected, show Subject Picker
      if (!session.subject) {
        renderSubjectPicker(host, idx, H);
        return;
      }

      // If subject is selected but no deck is selected, show Subject Deck List
      if (!session.deckFile) {
        renderSubjectDeckList(host, session.subject, idx, H);
        return;
      }

      // If deck is selected, load deck and render Deck Runner
      loadDeck(session.deckFile).then(function (deck) {
        if (!deck) {
          host.innerHTML = header("Practicals", "Failed to load deck") +
            H.emptyState("error", "Deck could not be loaded", "Check your connection and try again.");
          return;
        }

        session.deckData = deck;
        session.deckItems = deck.items || [];

        // Preload candidate pool for distractors across this subject
        loadSubjectDecks(session.subject).then(function (subDecks) {
          session.candidatePool = (subDecks && subDecks.items && subDecks.items.length)
            ? subDecks.items
            : session.deckItems;

          renderDeckRunner(host, H);
        });
      });
    });
  }

  function renderSubjectPicker(host, idx, H) {
    var esc = H.esc, ic = H.ic, header = H.header;
    var html = header("Practicals", "Spotters, instruments, drugs, procedures");

    html += '<section class="cx-sec">' +
      '<div class="cx-blurb cx-prac-blurb">Clinical practical exam preparation: inspect instruments and devices, spot clinical findings, review drug protocols, practice exam procedures, and rehearse examiner viva voce.</div>' +
      '</section>';

    html += '<section class="cx-sec"><div class="cx-sec-h">Select a practical subject</div><div class="cx-rows">';

    // Find all distinct subjects in the index
    var subjectsInIndex = {};
    for (var i = 0; i < idx.decks.length; i++) {
      var s = idx.decks[i].subject;
      if (!subjectsInIndex[s]) subjectsInIndex[s] = { count: 0, items: 0 };
      subjectsInIndex[s].count++;
      subjectsInIndex[s].items += (idx.decks[i].itemCount || 0);
    }

    // Always render in fixed syllabus order (obgyn, paediatrics, surgery, etc.)
    var order = ["obgyn", "paediatrics", "surgery"];
    for (var j = 0; j < order.length; j++) {
      var subId = order[j];
      var stats = subjectsInIndex[subId];
      if (!stats) continue; // Only show subjects that have indexed decks

      var cfg = SUBJECT_CONFIG[subId] || {
        id: subId,
        title: subId.charAt(0).toUpperCase() + subId.slice(1),
        icon: "stethoscope",
        sub: "Practical exam preparation and spotters"
      };

      html += '<button type="button" class="cx-row cx-row--prac-sub" data-act="cx-prac-pick-subject" data-id="' + esc(subId) + '">' +
        '<span class="cx-row-ic cx-prac-sub-ic">' + ic(cfg.icon) + '</span>' +
        '<span class="cx-row-txt">' +
          '<span class="cx-row-t">' + esc(cfg.title) + '</span>' +
          '<span class="cx-row-s">' + esc(cfg.sub) + '</span>' +
          '<span class="cx-row-meta">' + esc(stats.count) + ' decks &middot; ' + esc(stats.items) + ' spotters</span>' +
        '</span>' +
        ic("chevron_right") + '</button>';
    }

    html += '</div></section>';
    host.innerHTML = html;
  }

  function renderSubjectDeckList(host, subjectId, idx, H) {
    var esc = H.esc, ic = H.ic, header = H.header;
    var cfg = SUBJECT_CONFIG[subjectId] || {
      id: subjectId,
      title: subjectId.charAt(0).toUpperCase() + subjectId.slice(1),
      icon: "stethoscope"
    };

    var decks = (idx.decks || []).filter(function (d) { return d.subject === subjectId; });
    var html = header(cfg.title + " practicals", "Pick a deck to browse or quiz", "cx-prac-back-to-subjects");

    html += '<section class="cx-sec">' +
      '<div class="cx-prac-actions-bar">' +
        '<button type="button" class="cx-btn cx-btn--primary cx-prac-hero-quiz-btn" data-act="cx-prac-subject-quiz">' +
          ic("timer") + '<span>Subject spotter exam (10 random)</span>' +
        '</button>' +
      '</div>' +
      '</section>';

    html += '<section class="cx-sec"><div class="cx-sec-h">Examination decks (' + decks.length + ')</div>' +
      '<div class="cx-rows">';

    for (var i = 0; i < decks.length; i++) {
      var d = decks[i];
      var title = (d.title && d.title.en) ? d.title.en : (d.title || d.section);
      var intro = (d.intro && d.intro.en) ? d.intro.en : (d.intro || "");
      var kinds = Array.isArray(d.kinds) ? d.kinds : [];
      var deckKey = d.subject + ":" + d.section;
      var prog = getDeckProgress(deckKey, []);

      html += '<button type="button" class="cx-row cx-row--prac-deck" data-act="cx-prac-open-deck" data-file="' + esc(d.file) + '">' +
        '<span class="cx-row-txt">' +
          '<span class="cx-row-t">' + esc(title) + '</span>' +
          (intro ? '<span class="cx-row-s cx-row-s--clamp">' + esc(intro) + '</span>' : '') +
          '<span class="cx-prac-chips-row">' +
            '<span class="cx-prac-chip cx-prac-chip--count">' + esc(d.itemCount) + ' items</span>' +
            kinds.map(function (k) { return '<span class="cx-prac-chip">' + esc(k) + '</span>'; }).join("") +
            (prog.bestScore != null ? '<span class="cx-prac-chip cx-prac-chip--best">' + ic("military_tech") + 'Best ' + esc(prog.bestScore) + '/' + esc(prog.bestTotal) + '</span>' : '') +
          '</span>' +
        '</span>' +
        ic("chevron_right") + '</button>';
    }

    html += '</div></section>';
    host.innerHTML = html;
  }

  function renderDeckRunner(host, H) {
    var esc = H.esc, ic = H.ic, header = H.header;
    var d = session.deckData;
    var deckTitle = getTitle(d) || "Practicals deck";
    var subjectCfg = SUBJECT_CONFIG[session.subject] || { title: "Practicals" };
    var subTitle = subjectCfg.title + " \u00b7 " + (session.deckItems.length) + " items";

    var html = header(deckTitle, subTitle, "cx-prac-back-to-decks");

    // Segmented mode switcher
    var mode = session.viewMode || "browse";
    html += '<div class="cx-mode-bar cx-prac-mode-bar">' +
      '<button type="button" class="cx-mode-btn' + (mode === "browse" ? " cx-mode-btn--active" : "") + '" aria-pressed="' + (mode === "browse") + '" data-act="cx-prac-set-mode" data-id="browse">' +
      ic("collections_bookmark") + 'Browse items</button>' +
      '<button type="button" class="cx-mode-btn' + (mode === "quiz" ? " cx-mode-btn--active" : "") + '" aria-pressed="' + (mode === "quiz") + '" data-act="cx-prac-set-mode" data-id="quiz">' +
      ic("timer") + 'Spotter quiz</button>' +
      '<button type="button" class="cx-mode-btn' + (mode === "viva" ? " cx-mode-btn--active" : "") + '" aria-pressed="' + (mode === "viva") + '" data-act="cx-prac-set-mode" data-id="viva">' +
      ic("record_voice_over") + 'Viva rehearsal</button>' +
      '</div>';

    if (mode === "browse") {
      if (session.selectedItemId) {
        html += renderItemDetailHtml(session.selectedItemId, H);
      } else {
        html += renderBrowseListHtml(H);
      }
    } else if (mode === "quiz") {
      html += renderQuizHtml(H);
    } else if (mode === "viva") {
      html += renderVivaRehearsalHtml(H);
    }

    host.innerHTML = html;
  }

  /* ── 5. Browse Mode (List & Detail) ──────────────────────────────────────── */

  function renderItemsListHtml(items, H) {
    var esc = H.esc, ic = H.ic;
    if (!items || !items.length) {
      return H.emptyState("search_off", "No items match your filter", "Try clearing the search query or selecting All groups.");
    }
    var html = "";
    for (var j = 0; j < items.length; j++) {
      var it = items[j];
      var title = getTitle(it);
      var seen = isItemSeen(it.id);
      var akaStr = Array.isArray(it.aka) && it.aka.length ? it.aka.join(", ") : "";

      html += '<button type="button" class="cx-row cx-row--prac-item' + (seen ? " cx-row--seen" : "") + '" data-act="cx-prac-select-item" data-id="' + esc(it.id) + '">' +
        '<span class="cx-row-ic cx-prac-item-ic">' + ic(kindIcon(it.kind)) + '</span>' +
        '<span class="cx-row-txt">' +
          '<span class="cx-row-t">' + esc(title) + '</span>' +
          (akaStr ? '<span class="cx-row-s">' + esc(akaStr) + '</span>' : '') +
          '<span class="cx-prac-chips-row">' +
            '<span class="cx-prac-chip">' + esc(it.kind) + '</span>' +
            (it.group ? '<span class="cx-prac-chip cx-prac-chip--grp">' + esc(it.group) + '</span>' : '') +
            (seen ? '<span class="cx-prac-chip cx-prac-chip--seen">' + ic("check") + 'Reviewed</span>' : '') +
          '</span>' +
        '</span>' +
        ic("chevron_right") + '</button>';
    }
    return html;
  }

  function renderBrowseListHtml(H) {
    var esc = H.esc, ic = H.ic;
    var d = session.deckData;
    var items = session.deckItems;
    var filtered = filterItems(items, session.browseGroup, session.browseQuery);

    // Collect all distinct groups
    var groupSet = {};
    for (var i = 0; i < items.length; i++) {
      if (items[i].group) groupSet[items[i].group] = true;
    }
    var groups = Object.keys(groupSet).sort();

    var html = '<section class="cx-sec cx-prac-browse-head">';

    // Search input
    html += '<div class="cx-prac-search-wrap">' +
      ic("search") +
      '<input type="search" id="cxPracSearchInput" class="cx-prac-search" placeholder="Search items or alternative names..." value="' + esc(session.browseQuery) + '" aria-label="Search practical items">' +
      (session.browseQuery ? '<button type="button" class="cx-prac-search-clear" data-act="cx-prac-clear-search">' + ic("close") + '</button>' : '') +
      '</div>';

    // Group filter chips
    if (groups.length > 1) {
      html += '<div class="cx-prac-filters" role="tablist" aria-label="Filter by group">' +
        '<button type="button" class="cx-prac-filter-chip' + (session.browseGroup === "all" ? " cx-prac-filter-chip--active" : "") + '" data-act="cx-prac-filter-group" data-id="all" aria-pressed="' + (session.browseGroup === "all") + '">All (' + items.length + ')</button>';
      for (var g = 0; g < groups.length; g++) {
        var grp = groups[g];
        var isAct = session.browseGroup === grp;
        html += '<button type="button" class="cx-prac-filter-chip' + (isAct ? " cx-prac-filter-chip--active" : "") + '" data-act="cx-prac-filter-group" data-id="' + esc(grp) + '" aria-pressed="' + isAct + '">' + esc(grp) + '</button>';
      }
      html += '</div>';
    }

    html += '</section>';

    html += '<section class="cx-sec"><div class="cx-sec-h">Items (<span id="cxPracItemCount">' + filtered.length + '</span>)</div>' +
      '<div class="cx-rows" id="cxPracItemsContainer">' +
      renderItemsListHtml(filtered, H) +
      '</div></section>';
    return html;
  }

  function onSearchInput(val, H) {
    session.browseQuery = String(val || "");
    var container = document.getElementById("cxPracItemsContainer");
    var countEl = document.getElementById("cxPracItemCount");
    if (container && session.deckItems) {
      var filtered = filterItems(session.deckItems, session.browseGroup, session.browseQuery);
      if (countEl) countEl.textContent = String(filtered.length);
      container.innerHTML = renderItemsListHtml(filtered, H);
    }
  }

  function renderItemDetailHtml(itemId, H) {
    var esc = H.esc, ic = H.ic;
    var items = session.deckItems;
    var item = null;
    var idx = -1;
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === itemId) {
        item = items[i];
        idx = i;
        break;
      }
    }

    if (!item) {
      return '<section class="cx-sec">' + H.emptyState("error", "Item not found", "Return to the deck list.") + '</section>';
    }

    // Mark item as seen in progress store
    markSeen(item.id);

    var prevItem = idx > 0 ? items[idx - 1] : null;
    var nextItem = idx < items.length - 1 ? items[idx + 1] : null;
    var title = getTitle(item);

    var html = '<section class="cx-sec cx-prac-detail-sec">';

    // Top navigation bar
    html += '<div class="cx-prac-detail-topbar">' +
      '<button type="button" class="cx-btn cx-btn--ghost cx-prac-back-list-btn" data-act="cx-prac-close-item">' +
        ic("arrow_back") + '<span>All items</span>' +
      '</button>' +
      '<div class="cx-prac-item-counter">Item ' + (idx + 1) + ' of ' + items.length + '</div>' +
      '<div class="cx-prac-top-nav-arrows">' +
        '<button type="button" class="cx-prac-arrow-btn" data-act="cx-prac-nav-item" data-id="' + (prevItem ? esc(prevItem.id) : '') + '"' + (!prevItem ? ' disabled' : '') + ' aria-label="Previous item">' + ic("chevron_left") + '</button>' +
        '<button type="button" class="cx-prac-arrow-btn" data-act="cx-prac-nav-item" data-id="' + (nextItem ? esc(nextItem.id) : '') + '"' + (!nextItem ? ' disabled' : '') + ' aria-label="Next item">' + ic("chevron_right") + '</button>' +
      '</div>' +
      '</div>';

    // Detail card container
    html += '<article class="cx-prac-card">';

    // 1. Image stage or quiet placeholder
    if (item.image && item.image.file) {
      html += '<div class="cx-prac-img-stage">' +
        '<img src="' + esc(item.image.file) + '" class="cx-prac-img" alt="' + esc(title + ', photograph') + '" loading="lazy">' +
        (creditText(item.image.credit) ? '<div class="cx-prac-img-credit">' + esc(creditText(item.image.credit)) + '</div>' : '') +
        '</div>';
    } else {
      html += '<div class="cx-prac-placeholder" aria-label="Exam spotter item">' +
        '<span class="cx-prac-ph-ic material-symbols-rounded">' + esc(kindIcon(item.kind)) + '</span>' +
        '<span class="cx-prac-ph-lbl">Exam spotter &middot; ' + esc(item.kind) + '</span>' +
        '</div>';
    }

    // 2. Titles and tags
    html += '<div class="cx-prac-header-box">' +
      '<h2 class="cx-prac-item-title">' + esc(title) + '</h2>' +
      (Array.isArray(item.aka) && item.aka.length ? '<div class="cx-prac-aka"><span class="cx-prac-aka-lbl">Also known as:</span> ' + esc(item.aka.join(", ")) + '</div>' : '') +
      '<div class="cx-prac-chips-row">' +
        '<span class="cx-prac-chip">' + esc(item.kind) + '</span>' +
        (item.group ? '<span class="cx-prac-chip cx-prac-chip--grp">' + esc(item.group) + '</span>' : '') +
        '<span class="cx-prac-chip cx-prac-chip--seen">' + ic("check") + 'Reviewed</span>' +
      '</div>' +
      '</div>';

    // 3. Clinical Summary
    if (item.summary) {
      html += '<div class="cx-prac-summary-box">' +
        '<div class="cx-prac-summary-lbl">Summary</div>' +
        '<p class="cx-prac-summary">' + esc(item.summary) + '</p>' +
        '</div>';
    }

    // 4. Content Blocks
    var blocks = Array.isArray(item.blocks) ? item.blocks : [];
    var isDrugItem = item.kind === "drug";

    for (var b = 0; b < blocks.length; b++) {
      var blk = blocks[b];
      var bTitle = blk.title || "";
      var isDosage = /dosage/i.test(bTitle);

      html += '<div class="cx-prac-block">' +
        '<h3 class="cx-prac-block-title">' + esc(bTitle) + '</h3>';

      if (isDrugItem && isDosage) {
        html += '<div class="cx-prac-dosage-disclaimer">' + ic("info") + 'Exam reference. Check your local protocol.</div>';
      }

      if (Array.isArray(blk.bullets)) {
        html += '<ul class="cx-prac-bullets">';
        for (var bu = 0; bu < blk.bullets.length; bu++) {
          html += '<li>' + esc(blk.bullets[bu]) + '</li>';
        }
        html += '</ul>';
      } else if (typeof blk.text === "string") {
        html += '<p class="cx-prac-text">' + esc(blk.text) + '</p>';
      } else if (Array.isArray(blk.groups)) {
        for (var gr = 0; gr < blk.groups.length; gr++) {
          var sg = blk.groups[gr];
          html += '<div class="cx-prac-subgroup">' +
            '<div class="cx-prac-subgroup-lbl">' + esc(sg.label) + '</div>' +
            '<ul class="cx-prac-bullets">';
          var sBul = Array.isArray(sg.bullets) ? sg.bullets : [];
          for (var sbi = 0; sbi < sBul.length; sbi++) {
            html += '<li>' + esc(sBul[sbi]) + '</li>';
          }
          html += '</ul></div>';
        }
      } else if (blk.table && Array.isArray(blk.table.head) && Array.isArray(blk.table.rows)) {
        html += '<div class="cx-prac-table-card"><div class="cx-prac-table-scroll"><table class="cx-prac-table"><thead><tr>';
        for (var th = 0; th < blk.table.head.length; th++) {
          html += '<th>' + esc(blk.table.head[th]) + '</th>';
        }
        html += '</tr></thead><tbody>';
        for (var tr = 0; tr < blk.table.rows.length; tr++) {
          html += '<tr>';
          var rowCells = Array.isArray(blk.table.rows[tr]) ? blk.table.rows[tr] : [];
          for (var td = 0; td < rowCells.length; td++) {
            html += '<td>' + esc(rowCells[td]) + '</td>';
          }
          html += '</tr>';
        }
        html += '</tbody></table></div></div>';
      }

      html += '</div>';
    }

    // 5. Viva pairs (tap-to-reveal)
    var vivas = Array.isArray(item.viva) ? item.viva : [];
    if (vivas.length) {
      html += '<div class="cx-prac-viva-section">' +
        '<h3 class="cx-prac-viva-heading">' + ic("record_voice_over") + 'Examiner viva questions (' + vivas.length + ')</h3>' +
        '<div class="cx-prac-viva-list">';

      for (var v = 0; v < vivas.length; v++) {
        var vp = vivas[v];
        html += '<div class="cx-prac-viva-pair" data-idx="' + v + '">' +
          '<div class="cx-prac-viva-q"><span class="cx-prac-viva-tag">Q</span><span>' + esc(vp.q) + '</span></div>' +
          '<div class="cx-prac-viva-a" id="cxPracVivaA_' + v + '" style="display:none;"><span class="cx-prac-viva-tag cx-prac-viva-tag--a">A</span><span>' + esc(vp.a) + '</span></div>' +
          '<button type="button" class="cx-prac-viva-toggle" data-act="cx-prac-toggle-viva" data-idx="' + v + '">' +
            ic("visibility") + '<span>Reveal model answer</span>' +
          '</button>' +
          '</div>';
      }

      html += '</div></div>';
    }

    // 6. Bottom Prev/Next Navigation
    html += '<div class="cx-prac-nav-bar">' +
      '<button type="button" class="cx-btn cx-btn--ghost cx-prac-nav-btn" data-act="cx-prac-nav-item" data-id="' + (prevItem ? esc(prevItem.id) : '') + '"' + (!prevItem ? ' disabled' : '') + '>' +
        ic("arrow_back") + '<span>Previous</span>' +
      '</button>' +
      '<span class="cx-prac-nav-pos">' + (idx + 1) + ' of ' + items.length + '</span>' +
      '<button type="button" class="cx-btn cx-btn--ghost cx-prac-nav-btn" data-act="cx-prac-nav-item" data-id="' + (nextItem ? esc(nextItem.id) : '') + '"' + (!nextItem ? ' disabled' : '') + '>' +
        '<span>Next</span>' + ic("arrow_forward") +
      '</button>' +
      '</div>';

    html += '</article></section>';
    return html;
  }

  /* ── 6. Spotter Quiz Mode (The Exam) ─────────────────────────────────────── */

  function renderQuizHtml(H) {
    var esc = H.esc, ic = H.ic;

    // Not started yet
    if (!session.quizQuestions.length) {
      var deckKey = session.subject + ":" + (session.deckData ? session.deckData.section : "deck");
      var prog = getDeckProgress(deckKey, session.deckItems);

      return '<section class="cx-sec">' +
        '<div class="cx-prac-quiz-start-card">' +
          '<div class="cx-prac-quiz-badge">' + ic("timer") + '</div>' +
          '<h2 class="cx-prac-quiz-start-title">Spotter Examination</h2>' +
          '<p class="cx-prac-quiz-start-desc">Test your clinical recognition. 10 questions with immediate feedback on the key distinguishing features, followed by 2 follow-up viva questions per item.</p>' +
          (prog.bestScore != null ? '<div class="cx-prac-quiz-best-stat">' + ic("military_tech") + 'Your best score: ' + esc(prog.bestScore) + '/' + esc(prog.bestTotal) + ' (' + esc(prog.bestPct) + '%)</div>' : '') +
          '<button type="button" class="cx-btn cx-btn--primary cx-prac-start-btn" data-act="cx-prac-start-quiz">' +
            ic("play_arrow") + '<span>Start spotter exam (10 questions)</span>' +
          '</button>' +
        '</div>' +
        '</section>';
    }

    // Quiz Finished - Summary & Review
    if (session.quizFinished) {
      return renderQuizResultsHtml(H);
    }

    // In-progress Question
    var qIndex = session.quizIndex;
    var q = session.quizQuestions[qIndex];
    if (!q) return '<section class="cx-sec"><p>Question unavailable.</p></section>';

    var ans = session.quizAnswers[qIndex];
    var answered = !!ans;

    var pct = Math.round(((qIndex + 1) / session.quizQuestions.length) * 100);
    var html = '<section class="cx-sec cx-prac-quiz-sec">';

    // Question Header & Progress Bar
    html += '<div class="cx-prac-q-header">' +
      '<div class="cx-prac-q-meta">' +
        '<span class="cx-prac-q-num">Question ' + (qIndex + 1) + ' of ' + session.quizQuestions.length + '</span>' +
        '<span class="cx-prac-q-kind-tag">' + esc(q.kind) + '</span>' +
      '</div>' +
      '<div class="cx-prog" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100">' +
        '<div class="cx-prog-track"><div class="cx-prog-fill" style="width:' + pct + '%"></div></div>' +
      '</div>' +
      '</div>';

    // Question Prompt Card
    html += '<div class="cx-prac-q-prompt-card">';

    if (q.hasImage && q.imageFile) {
      html += '<div class="cx-prac-q-img-stage">' +
        '<img src="' + esc(q.imageFile) + '" class="cx-prac-q-img" alt="Spotter item photograph">' +
        (creditText(q.imageCredit) ? '<div class="cx-prac-img-credit">' + esc(creditText(q.imageCredit)) + '</div>' : '') +
        '</div>';
    } else {
      html += '<div class="cx-prac-masked-prompt">' +
        '<div class="cx-prac-masked-badge">' + ic("menu_book") + '<span>Identify from clinical recognition features</span></div>' +
        '<p class="cx-prac-masked-text">' + esc(q.promptText || q.summary) + '</p>' +
        '</div>';
    }

    html += '<h3 class="cx-prac-q-instruction">Identify this ' + esc(q.kind) + ':</h3>';

    // 5 Option Buttons
    var letters = ["A", "B", "C", "D", "E"];
    html += '<div class="cx-prac-options-grid">';

    for (var o = 0; o < q.options.length; o++) {
      var opt = q.options[o];
      var isChosen = answered && ans.chosenId === opt.id;
      var optClass = "cx-prac-opt-btn";
      if (answered) {
        if (opt.correct) optClass += " cx-prac-opt-btn--correct";
        else if (isChosen && !opt.correct) optClass += " cx-prac-opt-btn--wrong";
        else optClass += " cx-prac-opt-btn--dim";
      }

      html += '<button type="button" class="' + optClass + '" data-act="cx-prac-answer-opt" data-idx="' + o + '"' + (answered ? ' disabled' : '') + '>' +
        '<span class="cx-prac-opt-letter">' + letters[o] + '</span>' +
        '<span class="cx-prac-opt-txt">' + esc(opt.title) + '</span>' +
        (answered && opt.correct ? '<span class="cx-prac-opt-status">' + ic("check_circle") + '</span>' : '') +
        (answered && isChosen && !opt.correct ? '<span class="cx-prac-opt-status">' + ic("cancel") + '</span>' : '') +
        '</button>';
    }

    html += '</div>'; // options-grid
    html += '</div>'; // prompt-card

    // Feedback & Viva section after answer
    if (answered) {
      var isOk = ans.correct;
      html += '<div class="cx-prac-feedback-card' + (isOk ? " cx-prac-feedback--ok" : " cx-prac-feedback--bad") + '">' +
        '<div class="cx-prac-feedback-banner">' +
          ic(isOk ? "check_circle" : "cancel") +
          '<span>' + (isOk ? "Correct! " : "Incorrect. ") + "This is " + esc(q.title) + '.</span>' +
        '</div>';

      // Key identifying points
      if (q.keyPoints && q.keyPoints.length) {
        html += '<div class="cx-prac-keypoints-box">' +
          '<div class="cx-prac-kp-title">' + ic("lightbulb") + 'Key recognition points:</div>' +
          '<ul class="cx-prac-kp-list">';
        for (var k = 0; k < q.keyPoints.length; k++) {
          html += '<li>' + esc(q.keyPoints[k]) + '</li>';
        }
        html += '</ul></div>';
      }

      // 2 Follow-up viva questions
      if (q.viva && q.viva.length) {
        html += '<div class="cx-prac-qviva-box">' +
          '<div class="cx-prac-qviva-h">' + ic("record_voice_over") + 'Follow-up examiner viva:</div>';

        for (var v = 0; v < q.viva.length; v++) {
          var vq = q.viva[v];
          var vGrade = (ans.viva && ans.viva[v]) || null;
          var vRevealed = ans.revealedViva && ans.revealedViva[v];

          html += '<div class="cx-prac-qviva-item">' +
            '<div class="cx-prac-qviva-q"><strong>Q' + (v + 1) + ':</strong> ' + esc(vq.q) + '</div>' +
            (!vRevealed
              ? '<button type="button" class="cx-btn cx-btn--ghost cx-prac-qviva-reveal" data-act="cx-prac-quiz-viva-reveal" data-vi="' + v + '">' +
                  ic("visibility") + '<span>Show model answer</span>' +
                '</button>'
              : '<div class="cx-prac-qviva-a">' +
                  '<div class="cx-prac-qviva-a-txt"><strong>Answer:</strong> ' + esc(vq.a) + '</div>' +
                  '<div class="cx-prac-qviva-grade">' +
                    '<span class="cx-prac-grade-lbl">How did you answer?</span>' +
                    '<button type="button" class="cx-prac-grade-btn' + (vGrade === "got" ? " cx-prac-grade-btn--got-act" : "") + '" data-act="cx-prac-quiz-viva-grade" data-vi="' + v + '" data-g="got">' +
                      ic("check") + '<span>Got it</span>' +
                    '</button>' +
                    '<button type="button" class="cx-prac-grade-btn' + (vGrade === "missed" ? " cx-prac-grade-btn--missed-act" : "") + '" data-act="cx-prac-quiz-viva-grade" data-vi="' + v + '" data-g="missed">' +
                      ic("close") + '<span>Missed it</span>' +
                    '</button>' +
                  '</div>' +
                '</div>'
            ) +
            '</div>';
        }

        html += '</div>';
      }

      // Next Question Button
      var isLast = qIndex === session.quizQuestions.length - 1;
      html += '<div class="cx-prac-next-bar">' +
        '<button type="button" class="cx-btn cx-btn--primary cx-prac-next-btn" data-act="cx-prac-quiz-next">' +
          '<span>' + (isLast ? "View exam results" : "Next question") + '</span>' +
          ic("arrow_forward") +
        '</button>' +
        '</div>';

      html += '</div>'; // feedback-card
    }

    html += '</section>';
    return html;
  }

  function renderQuizResultsHtml(H) {
    var esc = H.esc, ic = H.ic;
    var res = calculateQuizScore(session.quizQuestions, session.quizAnswers);

    // Save best score
    var deckKey = session.subject + ":" + (session.deckData ? session.deckData.section : "deck");
    recordQuizScore(deckKey, res.spotterScore, res.spotterTotal);

    var verdict = "Good effort. Rehearse the key identifying points and re-take the spotters.";
    if (res.spotterPct >= 90) verdict = "Distinction! Outstanding visual recognition and viva mastery.";
    else if (res.spotterPct >= 70) verdict = "Solid practical pass. Continue testing to master the edge cases.";
    else if (res.spotterPct >= 50) verdict = "Passing grade. Review the missed items below.";

    var html = '<section class="cx-sec">' +
      '<div class="cx-prac-results-card">' +
        '<div class="cx-prac-results-badge">' + ic("military_tech") + '</div>' +
        '<h2 class="cx-prac-results-title">Spotter Exam Results</h2>' +
        '<div class="cx-prac-results-score">' + esc(res.spotterScore) + ' / ' + esc(res.spotterTotal) + '</div>' +
        '<div class="cx-prac-results-sub">' + esc(res.spotterPct) + '% spotters identified correctly</div>' +
        (res.vivaTotal ? '<div class="cx-prac-results-viva">' + ic("record_voice_over") + 'Viva performance: ' + esc(res.vivaScore) + ' of ' + esc(res.vivaTotal) + ' questions answered correctly (' + esc(res.vivaPct) + '%)</div>' : '') +
        '<p class="cx-prac-results-verdict">' + esc(verdict) + '</p>' +
        '<div class="cx-prac-results-actions">' +
          '<button type="button" class="cx-btn cx-btn--primary cx-prac-res-btn" data-act="cx-prac-restart-quiz">' +
            ic("refresh") + '<span>Retake quiz (new shuffle)</span>' +
          '</button>' +
          '<button type="button" class="cx-btn cx-btn--ghost cx-prac-res-btn" data-act="cx-prac-back-to-browse">' +
            ic("collections_bookmark") + '<span>Browse deck items</span>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '</section>';

    // Detailed Review List
    html += '<section class="cx-sec"><div class="cx-sec-h">Question review (' + res.review.length + ')</div><div class="cx-rows">';

    for (var r = 0; r < res.review.length; r++) {
      var it = res.review[r];
      html += '<div class="cx-row cx-row--prac-review' + (it.correct ? " cx-row--correct" : " cx-row--incorrect") + '">' +
        '<span class="cx-row-ic">' + ic(it.correct ? "check_circle" : "cancel") + '</span>' +
        '<span class="cx-row-txt">' +
          '<span class="cx-row-t">Q' + (r + 1) + ': ' + esc(it.title) + '</span>' +
          (!it.correct ? '<span class="cx-row-s cx-row-s--bad">Your answer: ' + esc(it.chosenTitle) + '</span>' : '<span class="cx-row-s cx-row-s--good">Correct</span>') +
          (it.keyPoints.length ? '<span class="cx-prac-review-kp">&bull; ' + esc(it.keyPoints[0]) + '</span>' : '') +
        '</span>' +
        '</div>';
    }

    html += '</div></section>';
    return html;
  }

  /* ── 7. Viva Rehearsal Mode ──────────────────────────────────────────────── */

  function renderVivaRehearsalHtml(H) {
    var esc = H.esc, ic = H.ic;

    // Not started
    if (!session.vivaSession.length) {
      return '<section class="cx-sec">' +
        '<div class="cx-prac-quiz-start-card">' +
          '<div class="cx-prac-quiz-badge">' + ic("record_voice_over") + '</div>' +
          '<h2 class="cx-prac-quiz-start-title">Examiner Viva Rehearsal</h2>' +
          '<p class="cx-prac-quiz-start-desc">Rehearse high-yield practical exam viva questions. Test your model answers, check your recall against standard clinical textbooks, and self-grade your responses.</p>' +
          '<button type="button" class="cx-btn cx-btn--primary cx-prac-start-btn" data-act="cx-prac-start-viva">' +
            ic("play_arrow") + '<span>Start viva rehearsal (10 pairs)</span>' +
          '</button>' +
        '</div>' +
        '</section>';
    }

    // Finished
    if (session.vivaFinished) {
      var gotCount = 0;
      var total = session.vivaSession.length;
      for (var k in session.vivaAnswered) {
        if (session.vivaAnswered[k] === "got") gotCount++;
      }
      var pct = total ? Math.round((gotCount / total) * 100) : 0;

      return '<section class="cx-sec">' +
        '<div class="cx-prac-results-card">' +
          '<div class="cx-prac-results-badge">' + ic("school") + '</div>' +
          '<h2 class="cx-prac-results-title">Viva Rehearsal Complete</h2>' +
          '<div class="cx-prac-results-score">' + esc(gotCount) + ' / ' + esc(total) + '</div>' +
          '<div class="cx-prac-results-sub">' + esc(pct) + '% viva pairs answered correctly</div>' +
          '<div class="cx-prac-results-actions">' +
            '<button type="button" class="cx-btn cx-btn--primary cx-prac-res-btn" data-act="cx-prac-restart-viva">' +
              ic("refresh") + '<span>Rehearse again</span>' +
            '</button>' +
            '<button type="button" class="cx-btn cx-btn--ghost cx-prac-res-btn" data-act="cx-prac-back-to-browse">' +
              ic("collections_bookmark") + '<span>Back to deck</span>' +
            '</button>' +
          '</div>' +
        '</div>' +
        '</section>';
    }

    // In-progress Viva
    var vIdx = session.vivaIndex;
    var vp = session.vivaSession[vIdx];
    var answered = !!session.vivaAnswered[vIdx];
    var grade = session.vivaAnswered[vIdx];
    var progressPct = Math.round(((vIdx + 1) / session.vivaSession.length) * 100);

    var html = '<section class="cx-sec">' +
      '<div class="cx-prac-q-header">' +
        '<div class="cx-prac-q-meta">' +
          '<span class="cx-prac-q-num">Viva ' + (vIdx + 1) + ' of ' + session.vivaSession.length + '</span>' +
          '<span class="cx-prac-q-kind-tag">' + esc(vp.itemKind) + '</span>' +
        '</div>' +
        '<div class="cx-prog" role="progressbar" aria-valuenow="' + progressPct + '" aria-valuemin="0" aria-valuemax="100">' +
          '<div class="cx-prog-track"><div class="cx-prog-fill" style="width:' + progressPct + '%"></div></div>' +
        '</div>' +
      '</div>' +
      '<div class="cx-prac-card cx-prac-card--viva">' +
        '<div class="cx-prac-viva-top-topic">' + ic("lightbulb") + 'Item: ' + esc(vp.itemTitle) + '</div>' +
        '<div class="cx-prac-viva-rehearsal-q"><strong>Examiner:</strong> ' + esc(vp.q) + '</div>' +
        (!answered
          ? '<button type="button" class="cx-btn cx-btn--ghost cx-prac-viva-reveal-btn" data-act="cx-prac-viva-reveal-answer">' +
              ic("visibility") + '<span>Reveal model answer</span>' +
            '</button>'
          : '<div class="cx-prac-viva-rehearsal-a">' +
              '<div class="cx-prac-viva-rehearsal-a-txt"><strong>Model Answer:</strong> ' + esc(vp.a) + '</div>' +
              '<div class="cx-prac-qviva-grade">' +
                '<span class="cx-prac-grade-lbl">How did you answer?</span>' +
                '<button type="button" class="cx-prac-grade-btn' + (grade === "got" ? " cx-prac-grade-btn--got-act" : "") + '" data-act="cx-prac-viva-self-grade" data-g="got">' +
                  ic("check") + '<span>Got it</span>' +
                '</button>' +
                '<button type="button" class="cx-prac-grade-btn' + (grade === "missed" ? " cx-prac-grade-btn--missed-act" : "") + '" data-act="cx-prac-viva-self-grade" data-g="missed">' +
                  ic("close") + '<span>Missed it</span>' +
                '</button>' +
              '</div>' +
            '</div>'
        ) +
        (answered
          ? '<div class="cx-prac-next-bar">' +
              '<button type="button" class="cx-btn cx-btn--primary cx-prac-next-btn" data-act="cx-prac-viva-next">' +
                '<span>' + (vIdx === session.vivaSession.length - 1 ? "Finish rehearsal" : "Next question") + '</span>' +
                ic("arrow_forward") +
              '</button>' +
            '</div>'
          : ''
        ) +
      '</div>' +
      '</section>';

    return html;
  }

  /* ── 8. Action Dispatcher ────────────────────────────────────────────────── */

  function handleAction(act, elem, state, H) {
    if (!act) return false;
    var repaint = H.repaint;
    var haptic = H.haptic;

    switch (act) {
      case "cx-prac-pick-subject":
        haptic("tap");
        session.subject = elem.getAttribute("data-id");
        session.deckFile = null;
        session.selectedItemId = null;
        repaint();
        return true;

      case "cx-prac-back-to-subjects":
        haptic("light");
        session.subject = null;
        session.deckFile = null;
        session.selectedItemId = null;
        repaint();
        return true;

      case "cx-prac-open-deck":
        haptic("tap");
        session.deckFile = elem.getAttribute("data-file");
        session.viewMode = "browse";
        session.selectedItemId = null;
        session.quizQuestions = [];
        session.quizAnswers = {};
        session.quizFinished = false;
        session.vivaSession = [];
        session.vivaAnswered = {};
        session.vivaFinished = false;
        repaint();
        return true;

      case "cx-prac-back-to-decks":
        haptic("light");
        session.deckFile = null;
        session.selectedItemId = null;
        repaint();
        return true;

      case "cx-prac-set-mode":
        haptic("tap");
        session.viewMode = elem.getAttribute("data-id") || "browse";
        repaint();
        return true;

      case "cx-prac-filter-group":
        haptic("tap");
        session.browseGroup = elem.getAttribute("data-id") || "all";
        repaint();
        return true;

      case "cx-prac-clear-search":
        session.browseQuery = "";
        repaint();
        return true;

      case "cx-prac-select-item":
        haptic("tap");
        session.selectedItemId = elem.getAttribute("data-id");
        repaint();
        return true;

      case "cx-prac-close-item":
        haptic("light");
        session.selectedItemId = null;
        repaint();
        return true;

      case "cx-prac-nav-item": {
        var nid = elem.getAttribute("data-id");
        if (nid) {
          haptic("tap");
          session.selectedItemId = nid;
          repaint();
        }
        return true;
      }

      case "cx-prac-toggle-viva": {
        haptic("tap");
        var vi = elem.getAttribute("data-idx");
        var aBox = document.getElementById("cxPracVivaA_" + vi);
        if (aBox) {
          var isHidden = aBox.style.display === "none";
          aBox.style.display = isHidden ? "flex" : "none";
          elem.innerHTML = isHidden
            ? H.ic("visibility_off") + "<span>Hide model answer</span>"
            : H.ic("visibility") + "<span>Reveal model answer</span>";
        }
        return true;
      }

      case "cx-prac-start-quiz":
        haptic("tap");
        session.quizQuestions = buildSpotterQuiz(session.deckItems, session.candidatePool);
        session.quizIndex = 0;
        session.quizAnswers = {};
        session.quizFinished = false;
        repaint();
        return true;

      case "cx-prac-subject-quiz":
        haptic("tap");
        loadSubjectDecks(session.subject).then(function (sub) {
          session.candidatePool = sub.items;
          session.quizQuestions = buildSpotterQuiz(sub.items, sub.items);
          session.quizIndex = 0;
          session.quizAnswers = {};
          session.quizFinished = false;
          session.viewMode = "quiz";
          // Pick first deck as fallback anchor
          if (sub.meta && sub.meta.length) session.deckFile = sub.meta[0].file;
          repaint();
        });
        return true;

      case "cx-prac-answer-opt": {
        var oIdx = parseInt(elem.getAttribute("data-idx"), 10);
        var q = session.quizQuestions[session.quizIndex];
        if (q && !session.quizAnswers[session.quizIndex]) {
          var opt = q.options[oIdx];
          var isCorrect = !!(opt && opt.correct);
          haptic(isCorrect ? "success" : "warning");
          session.quizAnswers[session.quizIndex] = {
            chosenId: opt ? opt.id : null,
            chosenTitle: opt ? opt.title : "",
            correct: isCorrect,
            viva: {},
            revealedViva: {}
          };
          repaint();
        }
        return true;
      }

      case "cx-prac-quiz-viva-reveal": {
        var qi = session.quizIndex;
        var vi2 = parseInt(elem.getAttribute("data-vi"), 10);
        if (session.quizAnswers[qi]) {
          session.quizAnswers[qi].revealedViva[vi2] = true;
          repaint();
        }
        return true;
      }

      case "cx-prac-quiz-viva-grade": {
        var qi2 = session.quizIndex;
        var vi3 = parseInt(elem.getAttribute("data-vi"), 10);
        var grade = elem.getAttribute("data-g");
        if (session.quizAnswers[qi2]) {
          haptic("tap");
          session.quizAnswers[qi2].viva[vi3] = grade;
          repaint();
        }
        return true;
      }

      case "cx-prac-quiz-next":
        haptic("tap");
        if (session.quizIndex < session.quizQuestions.length - 1) {
          session.quizIndex++;
        } else {
          session.quizFinished = true;
        }
        repaint();
        return true;

      case "cx-prac-restart-quiz":
        haptic("tap");
        session.quizQuestions = buildSpotterQuiz(session.deckItems, session.candidatePool);
        session.quizIndex = 0;
        session.quizAnswers = {};
        session.quizFinished = false;
        repaint();
        return true;

      case "cx-prac-back-to-browse":
        haptic("light");
        session.viewMode = "browse";
        session.selectedItemId = null;
        repaint();
        return true;

      case "cx-prac-start-viva":
        haptic("tap");
        session.vivaSession = buildVivaSession(session.deckItems);
        session.vivaIndex = 0;
        session.vivaAnswered = {};
        session.vivaFinished = false;
        repaint();
        return true;

      case "cx-prac-viva-reveal-answer":
        haptic("tap");
        session.vivaAnswered[session.vivaIndex] = "revealed";
        repaint();
        return true;

      case "cx-prac-viva-self-grade": {
        haptic("tap");
        var g2 = elem.getAttribute("data-g");
        session.vivaAnswered[session.vivaIndex] = g2;
        repaint();
        return true;
      }

      case "cx-prac-viva-next":
        haptic("tap");
        if (session.vivaIndex < session.vivaSession.length - 1) {
          session.vivaIndex++;
        } else {
          session.vivaFinished = true;
        }
        repaint();
        return true;

      case "cx-prac-restart-viva":
        haptic("tap");
        session.vivaSession = buildVivaSession(session.deckItems);
        session.vivaIndex = 0;
        session.vivaAnswered = {};
        session.vivaFinished = false;
        repaint();
        return true;

      default:
        return false;
    }
  }

  function setSubject(subjectId) {
    session.subject = subjectId;
    session.deckFile = null;
    session.selectedItemId = null;
  }

  function hasSubject(subjectId) {
    if (!subjectId) return false;
    if (_cache.index && Array.isArray(_cache.index.decks)) {
      for (var i = 0; i < _cache.index.decks.length; i++) {
        if (_cache.index.decks[i].subject === subjectId) return true;
      }
    }
    return subjectId === "obgyn" || subjectId === "paediatrics" || subjectId === "surgery";
  }

  /* ── 5. Public API ───────────────────────────────────────────────────────── */

  var API = {
    // Pure logic
    hashSeed: hashSeed,
    seededRandom: seededRandom,
    shuffle: shuffle,
    getTitle: getTitle,
    maskTitle: maskTitle,
    getKeyIdentifyingPoints: getKeyIdentifyingPoints,
    getDistractors: getDistractors,
    generateOptions: generateOptions,
    buildQuestion: buildQuestion,
    buildSpotterQuiz: buildSpotterQuiz,
    buildVivaSession: buildVivaSession,
    filterItems: filterItems,
    calculateQuizScore: calculateQuizScore,

    // Storage
    store: {
      KEY: STORE_KEY,
      read: readStore,
      write: writeStore,
      markSeen: markSeen,
      isItemSeen: isItemSeen,
      recordQuizScore: recordQuizScore,
      getDeckProgress: getDeckProgress,
      clearProgress: clearProgress
    },

    // Content loading
    loadIndex: loadIndex,
    loadDeck: loadDeck,
    loadSubjectDecks: loadSubjectDecks,
    _cache: function () { return _cache; },

    // UI hooks
    render: render,
    onSearchInput: onSearchInput,
    handleAction: handleAction,
    setSubject: setSubject,
    hasSubject: hasSubject,
    getSession: function () { return session; },
    resetSession: function () {
      session = {
        subject: null, deckFile: null, deckData: null, deckItems: [], candidatePool: [],
        viewMode: "browse", browseGroup: "all", browseQuery: "", selectedItemId: null,
        quizQuestions: [], quizIndex: 0, quizAnswers: {}, quizFinished: false,
        vivaSession: [], vivaIndex: 0, vivaAnswered: {}, vivaFinished: false
      };
    }
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = API;
  }
  if (typeof window !== "undefined") {
    window.SMD_CLINIX_PRACTICALS = API;
  }
})(typeof window !== "undefined" ? window : globalThis);
