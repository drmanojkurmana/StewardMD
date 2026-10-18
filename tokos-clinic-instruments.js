/* Tokós Instruments plugin: Atlas explorer & Spotter clinic on the Specialty Engine. ES5.
   - Atlas: browse 29 O&G instruments across 6 groups with group filters, name/aka search,
     responsive card grid, zoom stage, and detailed view with image above and text below.
   - Spotter (clinic id "instruments"): FSRS spaced-repetition spotter station.
     MBBS: 4 options for instrument name -> check -> reveal.
     Resident: 6 options for name -> step 2: 4 options for true use -> check -> combined reveal.
   Deterministic option generation preferring same group first.
   Pure functions exported under node for unit tests; registers on host in the browser. */
(function (G) {
  "use strict";
  var node = typeof module !== "undefined" && module.exports;

  /* ================= Pure logic & algorithms ================= */
  // 32-bit FNV-1a hash
  function hashSeed(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // Generate name options for Spotter question.
  // Returns array of instrument cases containing c, preferring same group first, deterministic.
  function nameOptions(deck, c, level) {
    if (!deck || !deck.cases || !c) return [];
    var count = level === "resident" ? 6 : 4;
    var seed = hashSeed(c.id + ":" + level + ":name");
    var same = deck.cases.filter(function (x) { return x.group === c.group && x.id !== c.id; });
    var other = deck.cases.filter(function (x) { return x.group !== c.group; });

    same.sort(function (a, b) { return hashSeed(seed + ":" + a.id) - hashSeed(seed + ":" + b.id); });
    other.sort(function (a, b) { return hashSeed(seed + ":" + a.id) - hashSeed(seed + ":" + b.id); });

    var needSame = Math.min(same.length, count - 1);
    var picked = same.slice(0, needSame);
    if (picked.length < count - 1) {
      picked = picked.concat(other.slice(0, count - 1 - picked.length));
    }
    var all = picked.concat([c]);
    all.sort(function (a, b) { return hashSeed(seed + ":pos:" + a.id) - hashSeed(seed + ":pos:" + b.id); });
    return all;
  }

  // Generate 4 use options for Resident step 2.
  // 1 true use from c.uses + 3 distractors from other cases (same group first, then other groups).
  // Distractors never match trueUse and never match any use in c.uses.
  function useOptions(deck, c) {
    if (!deck || !deck.cases || !c || !c.uses || !c.uses.length) return { trueUse: "", options: [] };
    var seed = hashSeed(c.id + ":resident:use");
    var trueUseIdx = seed % c.uses.length;
    var trueUse = c.uses[trueUseIdx];
    var myUses = {};
    c.uses.forEach(function (u) { myUses[u] = 1; });

    var sameOther = deck.cases.filter(function (x) { return x.group === c.group && x.id !== c.id; });
    var otherGroup = deck.cases.filter(function (x) { return x.group !== c.group; });

    function getCandidateUses(cases) {
      var list = [];
      cases.forEach(function (x) {
        (x.uses || []).forEach(function (u, uIdx) {
          if (!myUses[u]) list.push({ text: u, id: x.id + ":" + uIdx });
        });
      });
      return list;
    }

    var sameUses = getCandidateUses(sameOther);
    var otherUses = getCandidateUses(otherGroup);

    sameUses.sort(function (a, b) { return hashSeed(seed + ":" + a.id) - hashSeed(seed + ":" + b.id); });
    otherUses.sort(function (a, b) { return hashSeed(seed + ":" + a.id) - hashSeed(seed + ":" + b.id); });

    var picked = [];
    var pickedTexts = {};
    pickedTexts[trueUse] = 1;

    for (var i = 0; i < sameUses.length; i++) {
      var txt = sameUses[i].text;
      if (!pickedTexts[txt]) {
        pickedTexts[txt] = 1;
        picked.push(txt);
        if (picked.length === 3) break;
      }
    }
    if (picked.length < 3) {
      for (var j = 0; j < otherUses.length; j++) {
        var oTxt = otherUses[j].text;
        if (!pickedTexts[oTxt]) {
          pickedTexts[oTxt] = 1;
          picked.push(oTxt);
          if (picked.length === 3) break;
        }
      }
    }

    var opts = picked.map(function (u) { return { text: u, ok: false }; }).concat([{ text: trueUse, ok: true }]);
    opts.sort(function (a, b) { return hashSeed(seed + ":pos:" + a.text) - hashSeed(seed + ":pos:" + b.text); });
    return { trueUse: trueUse, options: opts };
  }

  // Filter instruments by group and query (searches name.en and aka). Pure function.
  function filterInstruments(cases, group, query) {
    if (!cases) return [];
    var q = (query || "").trim().toLowerCase();
    return cases.filter(function (c) {
      if (group && group !== "all" && c.group !== group) return false;
      if (!q) return true;
      var nameMatch = c.name && c.name.en && c.name.en.toLowerCase().indexOf(q) >= 0;
      if (nameMatch) return true;
      if (c.aka && c.aka.length) {
        for (var i = 0; i < c.aka.length; i++) {
          if (c.aka[i].toLowerCase().indexOf(q) >= 0) return true;
        }
      }
      return false;
    });
  }

  // Resident grading mapping: both right = Good (3), name only = Hard (2), wrong name = Again (1).
  function gradeResident(nameOk, useOk) {
    if (nameOk && useOk) return 3; // Good
    if (nameOk) return 2;          // Hard
    return 1;                      // Again
  }

  // Bilingual strings for chrome text (no em-dash or en-dash)
  var L10N = {
    en: {
      backHub: "Back to Tokos", backLearn: "Back to Learn", backAtlas: "Back to atlas",
      caseOf: "Case {i} of {n}", zoomIn: "Zoom in", fit: "Fit", zoomHint: "Pinch or double-tap to zoom",
      imgErr: "The image did not load. Check your connection and try again.", tryAgain: "Try again",
      whichInstrument: "Which instrument is this?", stateOneUse: "State one use",
      check: "Check", continueBtn: "Continue",
      pickOne: "Choose one instrument", pickUse: "Choose one use",
      right: "Correct", wrong: "Not this instrument", partial: "Name correct, use incorrect",
      yours: "Yours", key: "Answer", instrument: "Instrument", use: "Use",
      howToRecognise: "How to recognise it", uses: "Uses", cautions: "Cautions", aka: "Also known as",
      draftMark: "Draft, pending obstetric review", credit: "Image",
      nextReview: "Next review in", day: "day", days: "days", next: "Next case",
      prevInstrument: "Previous", nextInstrument: "Next",
      searchPlaceholder: "Search instruments...", searchAria: "Search by instrument name or alternative name",
      groupFilter: "Filter by group", allGroups: "All", noMatch: "No instrument matches",
      atlasTitle: "Instrument atlas", atlasSub: "Browse 29 obstetric and gynaecological instruments",
      spotterTitle: "Instruments", spotterSub: "Spot the instrument and learn its uses"
    },
    hi: {
      backHub: "टोकोस पर वापस", backLearn: "सीखें पर वापस", backAtlas: "एटलस पर वापस",
      caseOf: "{n} में से केस {i}", zoomIn: "ज़ूम करें", fit: "पूरा देखें", zoomHint: "ज़ूम के लिए पिंच या डबल-टैप करें",
      imgErr: "तस्वीर लोड नहीं हुई। कनेक्शन जांचें और फिर कोशिश करें।", tryAgain: "फिर कोशिश करें",
      whichInstrument: "यह कौन सा उपकरण है?", stateOneUse: "एक उपयोग बताएं",
      check: "जांचें", continueBtn: "आगे बढ़ें",
      pickOne: "एक उपकरण चुनें", pickUse: "एक उपयोग चुनें",
      right: "सही", wrong: "यह उपकरण नहीं", partial: "नाम सही, उपयोग गलत",
      yours: "आपका", key: "उत्तर", instrument: "उपकरण", use: "उपयोग",
      howToRecognise: "इसे कैसे पहचानें", uses: "उपयोग", cautions: "सावधानियां", aka: "अन्य नाम",
      draftMark: "ड्राफ़्ट, प्रसूति विशेषज्ञ की समीक्षा बाकी", credit: "तस्वीर",
      nextReview: "अगला दोहराव", day: "दिन में", days: "दिन में", next: "अगला केस",
      prevInstrument: "पिछला", nextInstrument: "अगला",
      searchPlaceholder: "उपकरण खोजें...", searchAria: "उपकरण या अन्य नाम से खोजें",
      groupFilter: "समूह अनुसार फ़िल्टर करें", allGroups: "सभी", noMatch: "कोई उपकरण मेल नहीं खाता",
      atlasTitle: "उपकरण एटलस", atlasSub: "प्रसूति और स्त्री रोग के 29 उपकरण देखें",
      spotterTitle: "उपकरण", spotterSub: "उपकरण पहचानें और उसके उपयोग सीखें"
    }
  };

  var API = {
    hashSeed: hashSeed,
    nameOptions: nameOptions,
    useOptions: useOptions,
    filterInstruments: filterInstruments,
    gradeResident: gradeResident,
    L10N: L10N
  };

  if (node) { module.exports = API; return; }
  G.TOKOS_INSTRUMENTS = API;

  /* ================= Browser integration ================= */
  var host = G.TOKOS;
  if (!host || !host.registerClinic || !G.document) return;

  var I = host._internal, st = host._st, S = G.SPECIALTY_STAGE, C = G.SPECIALTY_CORE, D = G.SPECIALTY_DATA;
  var SVGNS = "http://www.w3.org/2000/svg";

  var ins = {
    deck: null, deckP: null, credits: null, creditsP: null, stage: null,
    group: "all", query: "", detailId: null, done: null,
    resStep: 1, pickName: null, pickUse: null, result: null
  };

  function W() { return L10N[I.lang()] || L10N.en; }
  function esc(s) { return I.esc(s); }
  function $(id) { return G.document.getElementById(id); }
  function icoH(n) { var i = I.ico(n); return i ? '<span class="tok-i" aria-hidden="true">' + i + "</span>" : ""; }
  function caseLine() { var s = st.session; return String(W().caseOf).replace("{i}", s.i + 1).replace("{n}", s.list.length); }
  function current() { var s = st.session; return s && s.list[s.i] ? s.list[s.i].c : null; }

  function getDeck() {
    if (st.decks && st.decks.instruments) { ins.deck = st.decks.instruments; return Promise.resolve(ins.deck); }
    if (ins.deck) return Promise.resolve(ins.deck);
    if (!ins.deckP) {
      ins.deckP = I.getJSON("decks/instruments.json").then(function (d) {
        ins.deck = d;
        if (st.decks) st.decks.instruments = d;
        return d;
      }, function () { ins.deckP = null; return null; });
    }
    return ins.deckP;
  }

  function getCredits() {
    if (!ins.creditsP) {
      ins.creditsP = I.getJSON("media/credits.json").then(function (c) {
        ins.credits = c; return c;
      }, function () { ins.creditsP = null; return null; });
    }
    return ins.creditsP;
  }

  function groupLabel(deck, gid) {
    if (!deck || !deck.groups) return gid;
    for (var i = 0; i < deck.groups.length; i++) {
      if (deck.groups[i].id === gid) return I.t(deck.groups[i].label);
    }
    return gid;
  }

  function unmount() { ins.stage = null; }

  function stageHtml(c, altText) {
    var alt = altText || (c.name.en + ", instrument photograph");
    return '<div class="tus-stage tok-instr-stage" id="tokInstrStage" style="aspect-ratio:' + c.w + " / " + c.h + '">' +
      '<svg id="tokInstrSvg" xmlns="' + SVGNS + '" width="' + c.w + '" height="' + c.h + '" viewBox="0 0 ' + c.w + " " + c.h + '" role="img" aria-label="' + esc(alt) + '">' +
      '<image href="' + esc(I.imgUrl("media/" + c.img)) + '" x="0" y="0" width="' + c.w + '" height="' + c.h + '" preserveAspectRatio="none"/>' +
      '</svg></div>';
  }

  function zoomBar() {
    var w = W();
    return '<div class="tok-zoom">' +
      '<button type="button" class="tok-icon" data-act="tin-zoom" aria-label="' + esc(w.zoomIn) + '" title="' + esc(w.zoomHint) + '">' + (icoH("plus") || "+") + "</button>" +
      '<button type="button" class="tok-icon tok-fit" data-act="tin-fit">' + esc(w.fit) + "</button></div>";
  }

  function mountStage() {
    var stage = $("tokInstrStage"), svg = $("tokInstrSvg");
    if (!stage || !svg || !S) return;
    ins.stage = S.attach(stage, svg);
    ins.stage.reset();
    var img = svg.querySelector("image");
    if (img) {
      img.addEventListener("error", function () {
        stage.innerHTML = '<div class="tok-err tus-err" role="alert"><p>' + esc(W().imgErr) + '</p>' +
          '<button type="button" class="tok-btn sec" data-act="tin-retry">' + esc(W().tryAgain) + "</button></div>";
      });
    }
  }

  function creditHtml(c, deck) {
    var w = W(), src = (deck && deck.source) || {};
    var ds = src.dataset || "Owner-supplied practicals sheet (Instruments)";
    var nt = src.note || "Licence unconfirmed; confirm or replace before public release.";
    return '<p class="tok-instr-credit">' + esc(w.credit) + ": " + esc(ds) + ". " + esc(nt) + "</p>";
  }

  /* ================= Atlas Views ================= */
  function renderCard(c, deck) {
    var grp = groupLabel(deck, c.group);
    return '<button type="button" class="tok-instr-card" data-act="tin-open" data-id="' + esc(c.id) + '">' +
      '<div class="tok-instr-card-img-wrap"><img src="' + esc(I.imgUrl("media/" + c.img)) + '" alt="' + esc(c.name.en + ", instrument photograph") + '" width="' + c.w + '" height="' + c.h + '" loading="lazy"></div>' +
      '<div class="tok-instr-card-body">' +
      '<span class="tok-instr-card-group">' + esc(grp) + "</span>" +
      '<h3 class="tok-instr-card-title">' + esc(c.name.en) + "</h3>" +
      (c.aka && c.aka.length ? '<p class="tok-instr-card-aka">' + esc(c.aka.join(", ")) + "</p>" : "") +
      "</div></button>";
  }

  function renderAtlasList() {
    var w = W(), deck = ins.deck;
    if (!deck) return '<div class="sp-scroll tok-scroll"><div class="sp-pad"><p>Loading...</p></div></div>';
    var matched = filterInstruments(deck.cases, ins.group, ins.query);
    var cardsHtml = matched.map(function (c) { return renderCard(c, deck); }).join("");

    var chipsHtml = '<button type="button" class="tok-instr-chip" data-act="tin-group" data-g="all" aria-pressed="' + (ins.group === "all") + '">' + esc(w.allGroups) + "</button>" +
      (deck.groups || []).map(function (g) {
        return '<button type="button" class="tok-instr-chip" data-act="tin-group" data-g="' + esc(g.id) + '" aria-pressed="' + (ins.group === g.id) + '">' + esc(I.t(g.label)) + "</button>";
      }).join("");

    return I.top(w.backLearn, esc(w.atlasTitle), esc(w.atlasSub), I.langBtn()) +
      '<div class="sp-scroll tok-scroll" id="tokInstrScroll">' +
      '<div class="tok-instr-search-wrap">' +
      '<input type="search" id="tokInstrSearch" class="tok-instr-search" placeholder="' + esc(w.searchPlaceholder) + '" aria-label="' + esc(w.searchAria) + '" value="' + esc(ins.query) + '">' +
      "</div>" +
      '<div class="tok-instr-filters" role="tablist" aria-label="' + esc(w.groupFilter) + '">' + chipsHtml + "</div>" +
      '<div class="tok-instr-grid" id="tokInstrGrid">' + cardsHtml +
      '<div class="tok-instr-empty" id="tokInstrEmpty" role="status"' + (matched.length ? ' style="display:none;"' : "") + ">" + esc(w.noMatch) + "</div>" +
      "</div></div>";
  }

  function renderAtlasDetail(c) {
    var w = W(), deck = ins.deck;
    var grp = groupLabel(deck, c.group);
    var akaHtml = c.aka && c.aka.length ? '<p class="tok-instr-detail-aka"><span class="tok-mut">' + esc(w.aka) + ": </span>" + esc(c.aka.join(", ")) + "</p>" : "";
    var cautionsHtml = c.cautions && c.cautions.length ? '<div class="tok-instr-section"><h3>' + esc(w.cautions) + "</h3><ul>" +
      c.cautions.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></div>" : "";

    var cases = deck.cases;
    var idx = -1;
    for (var i = 0; i < cases.length; i++) { if (cases[i].id === c.id) { idx = i; break; } }
    var prevC = idx > 0 ? cases[idx - 1] : cases[cases.length - 1];
    var nextC = idx < cases.length - 1 ? cases[idx + 1] : cases[0];

    var maikPrompt = "I am studying obstetric and gynaecological instruments. The instrument is " + c.name.en +
      (c.aka && c.aka.length ? " (also known as " + c.aka.join(", ") + ")" : "") +
      ". Explain how to recognise it, its primary clinical uses in obstetrics and gynaecology, and key cautions.";

    return I.top(w.backAtlas, esc(c.name.en), esc(grp), I.langBtn()) +
      '<div class="sp-scroll tok-scroll"><div class="tus-hold">' + stageHtml(c) +
      '<div class="tus-bar tok-pad"><span class="sp-small">' + esc(w.zoomHint) + "</span>" + zoomBar() + "</div></div>" +
      '<div class="tok-instr-detail-body tok-pad">' +
      '<h2 class="tok-instr-detail-title">' + esc(c.name.en) + "</h2>" +
      akaHtml +
      '<span class="tok-instr-group-chip">' + esc(grp) + "</span>" +
      '<div class="tok-instr-section"><h3>' + esc(w.howToRecognise) + "</h3><ul>" +
      (c.identify || []).map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></div>" +
      '<div class="tok-instr-section"><h3>' + esc(w.uses) + "</h3><ul>" +
      (c.uses || []).map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></div>" +
      cautionsHtml +
      '<p class="tok-draft tok-instr-draft">' + esc(w.draftMark) + "</p>" +
      creditHtml(c, deck) +
      I.maikBtn(maikPrompt) +
      '<div class="tok-instr-nav">' +
      '<button type="button" class="tok-btn sec" data-act="tin-prev" data-id="' + esc(prevC.id) + '">' + esc(w.prevInstrument) + "</button>" +
      '<button type="button" class="tok-btn sec" data-act="tin-next" data-id="' + esc(nextC.id) + '">' + esc(w.nextInstrument) + "</button>" +
      "</div></div></div>";
  }

  function paintAtlas(focusSel) {
    unmount();
    st.view = "instr-atlas";
    var c = null;
    if (ins.detailId && ins.deck) {
      for (var i = 0; i < ins.deck.cases.length; i++) {
        if (ins.deck.cases[i].id === ins.detailId) { c = ins.deck.cases[i]; break; }
      }
    }
    if (c) {
      st.onBack = function () { ins.detailId = null; paintAtlas(); return true; };
      st.again = function () { paintAtlas(); };
      I.paint(renderAtlasDetail(c), focusSel || ".tok-instr-detail-title");
      mountStage();
    } else {
      ins.detailId = null;
      st.onBack = null;
      st.again = function () { paintAtlas(); };
      I.paint(renderAtlasList(), focusSel || "#tokInstrSearch");
      wireSearchInput();
    }
  }

  function wireSearchInput() {
    var inp = $("tokInstrSearch");
    if (!inp) return;
    inp.addEventListener("input", function () {
      ins.query = inp.value;
      if (!ins.deck) return;
      var grid = $("tokInstrGrid");
      var empty = $("tokInstrEmpty");
      if (!grid) return;
      var matched = filterInstruments(ins.deck.cases, ins.group, ins.query);
      var cardsHtml = matched.map(function (c) { return renderCard(c, ins.deck); }).join("");
      grid.innerHTML = cardsHtml + '<div class="tok-instr-empty" id="tokInstrEmpty" role="status"' +
        (matched.length ? ' style="display:none;"' : "") + ">" + esc(W().noMatch) + "</div>";
    });
  }

  /* ================= Spotter Views ================= */
  function renderSpotterQuestion() {
    var c = current(), w = W(), deck = ins.deck, lv = I.level();
    if (!c || !deck) return '<div class="sp-scroll tok-scroll"><div class="sp-pad"><p>Loading...</p></div></div>';

    var questionHtml = "";
    if (lv !== "resident" || ins.resStep === 1) {
      var opts = nameOptions(deck, c, lv);
      var optsHtml = opts.map(function (o) {
        var on = ins.pickName === o.id;
        return '<button type="button" class="tok-opt" aria-pressed="' + on + '" data-act="tin-pick-name" data-id="' + esc(o.id) + '">' + esc(o.name.en) + "</button>";
      }).join("");
      var canSubmit = !!ins.pickName;
      var nextAct = lv === "resident" ? "tin-step2" : "tin-check";
      var nextLabel = lv === "resident" ? w.continueBtn : w.check;

      questionHtml = '<fieldset class="tok-q"><legend>' + esc(w.whichInstrument) + '</legend>' +
        '<div class="tok-opts">' + optsHtml + "</div></fieldset>" +
        '<div class="tok-foot"><span class="tok-count" aria-live="polite">' + (canSubmit ? "" : esc(w.pickOne)) + "</span>" +
        '<button type="button" class="tok-btn pri" data-act="' + nextAct + '"' + (canSubmit ? "" : " disabled") + ">" + esc(nextLabel) + "</button></div>";
    } else {
      var uInfo = useOptions(deck, c);
      var uOptsHtml = uInfo.options.map(function (o, idx) {
        var on = ins.pickUse === o.text;
        return '<button type="button" class="tok-opt tok-opt-left" aria-pressed="' + on + '" data-act="tin-pick-use" data-idx="' + idx + '">' + esc(o.text) + "</button>";
      }).join("");
      var canCheck = !!ins.pickUse;

      questionHtml = '<fieldset class="tok-q"><legend>' + esc(w.stateOneUse) + '</legend>' +
        '<div class="tok-opts tok-opts-col">' + uOptsHtml + "</div></fieldset>" +
        '<div class="tok-foot"><span class="tok-count" aria-live="polite">' + (canCheck ? "" : esc(w.pickUse)) + "</span>" +
        '<button type="button" class="tok-btn pri" data-act="tin-check"' + (canCheck ? "" : " disabled") + ">" + esc(w.check) + "</button></div>";
    }

    return I.top(w.backHub, esc(I.t(spotterClinic.title)), esc(caseLine()), I.langBtn()) +
      '<div class="sp-scroll tok-scroll"><div class="tus-hold">' + stageHtml(c) +
      '<div class="tus-bar tok-pad"><span class="sp-small">' + esc(w.zoomHint) + "</span>" + zoomBar() + "</div></div>" +
      '<div class="tok-pad">' + questionHtml + "</div></div>";
  }

  function renderSpotterReveal() {
    var c = current(), w = W(), deck = ins.deck, r = ins.result, lv = I.level();
    if (!c || !deck || !r) return '<div class="sp-scroll tok-scroll"><div class="sp-pad"><p>Loading...</p></div></div>';

    var verdictClass = r.grade === 3 ? "ok" : r.grade === 2 ? "close" : "no";
    var verdictText = r.grade === 3 ? w.right : r.grade === 2 ? w.partial : w.wrong;
    var verdictIcon = r.grade === 3 ? "check" : r.grade === 2 ? "warn" : "x";

    var concordanceHtml = '<li class="tok-row ' + (r.nameOk ? "ok" : "no") + '"><div class="tok-row-h"><b>' + esc(w.instrument) + "</b></div>" +
      (r.nameOk ? '<p class="tok-ans">' + esc(c.name.en) + "</p>"
        : '<p class="tok-ans mine"><span>' + esc(w.yours) + "</span>" + esc(r.pickNameText) + '</p><p class="tok-ans key"><span>' + esc(w.key) + "</span>" + esc(c.name.en) + "</p>") +
      "</li>";

    if (lv === "resident") {
      concordanceHtml += '<li class="tok-row ' + (r.useOk ? "ok" : "no") + '"><div class="tok-row-h"><b>' + esc(w.use) + "</b></div>" +
        (r.useOk ? '<p class="tok-ans">' + esc(r.pickUse) + "</p>"
          : '<p class="tok-ans mine"><span>' + esc(w.yours) + "</span>" + esc(r.pickUse) + '</p><p class="tok-ans key"><span>' + esc(w.key) + "</span>" + esc(r.trueUse) + "</p>") +
        "</li>";
    }

    var cautionsHtml = c.cautions && c.cautions.length ? '<div class="tok-instr-section"><h3>' + esc(w.cautions) + "</h3><ul>" +
      c.cautions.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></div>" : "";

    var maikPrompt = "I am learning obstetric and gynaecological instruments. The instrument shown is " + c.name.en +
      (r.grade === 3 ? "" : "; I answered " + r.pickNameText) +
      ". Explain how to identify this instrument and its clinical uses.";

    return I.top(w.backHub, esc(I.t(spotterClinic.title)), esc(caseLine()), I.langBtn()) +
      '<div class="sp-scroll tok-scroll"><div class="tok-reveal tok-pad">' +
      '<p class="tok-score tus-verdict ' + verdictClass + '" tabindex="-1">' + icoH(verdictIcon) + "<b>" + esc(verdictText) + "</b></p>" +
      '<ol class="tok-concord">' + concordanceHtml + "</ol>" +
      '<div class="tus-thumb" style="aspect-ratio:' + c.w + " / " + c.h + '">' +
      '<img src="' + esc(I.imgUrl("media/" + c.img)) + '" alt="' + esc(c.name.en + ", instrument photograph") + '" width="' + c.w + '" height="' + c.h + '">' +
      "</div>" +
      creditHtml(c, deck) +
      '<div class="tok-instr-detail-body">' +
      '<h2 class="tok-instr-detail-title">' + esc(c.name.en) + "</h2>" +
      (c.aka && c.aka.length ? '<p class="tok-instr-detail-aka"><span class="tok-mut">' + esc(w.aka) + ": </span>" + esc(c.aka.join(", ")) + "</p>" : "") +
      '<span class="tok-instr-group-chip">' + esc(groupLabel(deck, c.group)) + "</span>" +
      '<div class="tok-instr-section"><h3>' + esc(w.howToRecognise) + "</h3><ul>" +
      (c.identify || []).map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></div>" +
      '<div class="tok-instr-section"><h3>' + esc(w.uses) + "</h3><ul>" +
      (c.uses || []).map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></div>" +
      cautionsHtml +
      '<p class="tok-draft tok-instr-draft">' + esc(w.draftMark) + "</p>" +
      "</div>" +
      '<p class="tok-next">' + esc(w.nextReview) + " <b>" + r.ivl + "</b> " + esc(r.ivl === 1 ? w.day : w.days) + "</p>" +
      I.maikBtn(maikPrompt) +
      '</div><div class="tok-foot tok-pad"><button type="button" class="tok-btn pri" data-act="tin-next-case">' + esc(w.next) + "</button></div></div>";
  }

  function paintSpotter(focusSel) {
    unmount();
    if (!current()) return;
    st.again = function () { paintSpotter(); };
    var html = st.view === "instr-spotter-reveal" ? renderSpotterReveal() : renderSpotterQuestion();
    I.paint(html, focusSel || (st.view === "instr-spotter-reveal" ? ".tus-verdict" : null));
    if (st.view === "instr-spotter") mountStage();
  }

  function startSpotter(done) {
    ins.done = done;
    ins.resStep = 1;
    ins.pickName = null;
    ins.pickUse = null;
    ins.result = null;
    st.view = "instr-spotter";
    st.onLeave = unmount;
    getDeck();
    getCredits();
  }

  function checkSpotterAnswer() {
    var c = current(), deck = ins.deck, lv = I.level(), today = I.today();
    if (!c || !deck) return;

    var nameOk = ins.pickName === c.id;
    var pickCase = deck.cases.filter(function (x) { return x.id === ins.pickName; })[0];
    var pickNameText = pickCase ? pickCase.name.en : (ins.pickName || "");

    var grade = 1, useOk = false, trueUse = "";
    if (lv === "resident") {
      var uInfo = useOptions(deck, c);
      trueUse = uInfo.trueUse;
      useOk = ins.pickUse === trueUse;
      grade = gradeResident(nameOk, useOk);
    } else {
      grade = nameOk ? 3 : 1;
    }

    var cardKey = D.levelKey("instruments", lv);
    var card = C.review(st.store, cardKey, c.id, grade, today);
    C.recordAnswer(st.store, cardKey, c.name.en, pickNameText);
    I.save();
    I.haptic(grade === 3 ? "success" : grade === 2 ? "selection" : "error");

    ins.result = {
      grade: grade,
      nameOk: nameOk,
      useOk: useOk,
      pickNameText: pickNameText,
      pickUse: ins.pickUse,
      trueUse: trueUse,
      ivl: card[3] - today
    };

    st.view = "instr-spotter-reveal";
    getCredits().then(function () {
      if (st.view === "instr-spotter-reveal" && current() === c) paintSpotter(".tus-verdict");
    });
  }

  /* ================= Action Handlers ================= */
  var A = I.ACTIONS;
  A["tin-group"] = function (b) {
    ins.group = b.getAttribute("data-g");
    paintAtlas();
  };
  A["tin-open"] = function (b) {
    ins.detailId = b.getAttribute("data-id");
    paintAtlas();
  };
  A["tin-prev"] = function (b) {
    ins.detailId = b.getAttribute("data-id");
    paintAtlas();
  };
  A["tin-next"] = function (b) {
    ins.detailId = b.getAttribute("data-id");
    paintAtlas();
  };
  A["tin-test"] = function () {
    I.startClinic("instruments");
  };
  A["tin-pick-name"] = function (b) {
    ins.pickName = b.getAttribute("data-id");
    [].forEach.call(I.root().querySelectorAll("[data-act=tin-pick-name]"), function (x) {
      x.setAttribute("aria-pressed", String(x === b));
    });
    var btn = I.root().querySelector("[data-act=tin-check], [data-act=tin-step2]");
    if (btn) btn.disabled = false;
    var cnt = I.root().querySelector(".tok-count");
    if (cnt) cnt.textContent = "";
  };
  A["tin-step2"] = function () {
    if (!ins.pickName) return;
    ins.resStep = 2;
    paintSpotter();
  };
  A["tin-pick-use"] = function (b) {
    var c = current(), deck = ins.deck;
    if (!c || !deck) return;
    var uInfo = useOptions(deck, c);
    var idx = +b.getAttribute("data-idx");
    if (uInfo.options[idx]) {
      ins.pickUse = uInfo.options[idx].text;
    }
    [].forEach.call(I.root().querySelectorAll("[data-act=tin-pick-use]"), function (x) {
      x.setAttribute("aria-pressed", String(x === b));
    });
    var btn = I.root().querySelector("[data-act=tin-check]");
    if (btn) btn.disabled = false;
    var cnt = I.root().querySelector(".tok-count");
    if (cnt) cnt.textContent = "";
  };
  A["tin-check"] = function () {
    checkSpotterAnswer();
  };
  A["tin-next-case"] = function () {
    if (ins.done) ins.done();
  };
  A["tin-zoom"] = function () {
    if (ins.stage) ins.stage.zoomBy(2);
  };
  A["tin-fit"] = function () {
    if (ins.stage) ins.stage.reset();
  };
  A["tin-retry"] = function () {
    if (st.view === "instr-spotter") paintSpotter();
    else if (st.view === "instr-atlas") paintAtlas();
  };

  /* ================= Registrations ================= */
  var atlasExplorer = {
    id: "instruments",
    icon: "grid",
    title: { en: "Instruments", hi: "उपकरण" },
    line: { en: "Spot the instrument and learn its uses", hi: "उपकरण पहचानें और उसके उपयोग सीखें" },
    test: { clinic: "instruments" },
    open: function (h, x, focusSel) {
      ins.detailId = null;
      getDeck().then(function () { paintAtlas(focusSel); });
    }
  };

  var spotterClinic = {
    id: "instruments",
    icon: "grid",
    deck: "decks/instruments.json",
    size: 10,
    newCap: 10,
    title: { en: "Instruments", hi: "उपकरण" },
    sub: { en: "Spot the instrument and learn its uses", hi: "उपकरण पहचानें और उसके उपयोग सीखें" },
    items: function (d) {
      return (d.cases || []).map(function (c) {
        return { id: c.id, a: c.name.en, c: c };
      });
    },
    render: function (h, item, done) {
      startSpotter(done);
      getDeck().then(function () {
        paintSpotter(st.session && st.session.i > 0 ? ".tok-instr-stage" : null);
      });
    }
  };

  function register() {
    host.registerExplorer(atlasExplorer);
    host.registerClinic(spotterClinic);
  }
  if (host._syncers) host._syncers.push(register);
  register();

  host.INSTRUMENTS_L10N = L10N;
})(typeof window !== "undefined" ? window : this);
