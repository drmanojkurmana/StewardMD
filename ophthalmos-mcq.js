/* Ophthalmós question bank. ES5. Loaded after ophthalmos-screens.js.
   3,035 single-answer ophthalmology questions (MedMCQA, MIT) in ten subspecialties, each with its explanation.
   Study mode signs every answer at once; exam mode is timed and marks at the end. Every answer is an FSRS review
   (deck key "mcq"), so the bank brings each question back just before it would be forgotten. The deck (2.5 MB) is
   loaded the first time the bank opens. */
(function (G) {
  "use strict";
  var O = G.OPHTHALMOS;
  if (!O || !O._internal) return;
  var I = O._internal, st = O._st, C = G.OPHTHALMOS_CORE, D = G.OPHTHALMOS_DATA, A = I.ACTIONS, K = I.KEYS;
  var ico = I.ico, esc = I.esc, fmt = I.fmt;
  var DECK = "mcq", SIZE = 20, NEW_CAP = 20, EXAM_N = 30, EXAM_SEC = 90;
  var LETTERS = ["A", "B", "C", "D"];
  var SHORT = { fundamentals: "Fundamentals" };
  var DIFF = ["", "Easy", "Medium", "Hard"];
  // The level's pool: MBBS sets leave out hard questions (d 3), Resident sets draw all (ophthalmos-data.js mcqPool).
  function pool(items) { return D.mcqPool(items, I.level()); }
  function levelLine() {
    var lv = I.level(), name = esc(st.cfg.levels[lv].label);
    return lv === "resident" ? name + ": all questions, hard clinical vignettes included." + (I.trial("mcq.resident") === "open" ? "" : " " + I.lockBadge("mcq.resident"))
      : name + ": easy and medium questions. Switch to Resident on the home screen for hard ones.";
  }
  // Resident study sets are Pro with one free trial (owner decision 2026-09-28, feature mcq.resident); MBBS sets stay free.
  function levelGate(run) { return I.level() === "resident" ? I.gate("mcq.resident", run) : run(); }
  var Q = { deck: null, loading: null, err: null, run: null, mode: "study", timer: 0 };

  function $(id) { return G.document.getElementById(id); }
  function topicLabel(t) { return SHORT[t] || (Q.deck && Q.deck.topics[t]) || t; }
  function flags() { return st.store.flags || (st.store.flags = {}); }
  function cardOf(id) { return st.store.cards[C.key(DECK, id)]; }

  /* ---------- data ---------- */
  function load() {
    if (Q.deck) return Promise.resolve(Q.deck);
    if (Q.loading) return Q.loading;
    Q.err = null;
    Q.loading = I.getJSON("decks/mcq.json").then(function (d) {
      d.byId = {};
      d.items.forEach(function (it) { d.byId[it.id] = it; it.hay = (it.q + " " + it.o.join(" ")).toLowerCase(); });
      Q.deck = d; Q.loading = null; return d;
    }).catch(function (e) { Q.err = e; Q.loading = null; throw e; });
    return Q.loading;
  }
  // The session builder balances new items across a..., so hand it the topic as the class.
  function view(items) { return { id: DECK, items: items.map(function (it) { return { id: it.id, a: it.t, x: it }; }) }; }
  function session(items, size, newCap) {
    return C.buildSession(view(items), st.store, I.today(), { size: size, newCap: newCap }).map(function (v) { return v.x; });
  }
  function stats() {
    var today = I.today(), seen = 0, due = 0, k;
    for (k in st.store.cards) if (k.indexOf(DECK + ":") === 0) { seen++; if (st.store.cards[k][3] <= today) due++; }
    return { seen: seen, due: due };
  }

  /* ---------- bank screen ---------- */
  function open() {
    stopTimer();
    if (Q.mode === "exam" && I.trial("exam") !== "open") Q.mode = "study"; // a locked exam is picked on purpose, never carried over
    st.view = "mcq-bank";
    if (!Q.deck) {
      I.paint(I.top("Back to clinics", "Question bank", "Loading") + '<div class="oph-scroll oph-pad"><p class="oph-mut" aria-live="polite">Loading questions…</p></div>');
      load().then(function () { if (st.view === "mcq-bank") renderBank(); }, function () {
        if (st.view !== "mcq-bank") return;
        I.paint(I.top("Back to clinics", "Question bank", "Could not load") + '<div class="oph-scroll oph-pad"><p>The questions did not load. Check the connection and try again.</p>' +
          '<button class="oph-btn pri" data-act="mcqretry">' + ico("refresh") + " Try again</button></div>");
      });
      return;
    }
    renderBank();
  }

  function renderBank(focusSel) {
    stopTimer();
    st.view = "mcq-bank"; st.onBack = null;
    var d = Q.deck, s = stats(), topics = Object.keys(d.topics), ex = I.trial("exam");
    if (Q.mode === "exam" && ex === "used") Q.mode = "study"; // Pro lapsed or trial spent: never leave a locked mode selected
    var conf = st.store.conf[DECK] || {};
    var rows = topics.map(function (t) {
      var n = 0, seen = 0, due = 0, today = I.today(), row = conf[t] || {}, answered = 0, right = row[t] || 0, k;
      pool(d.items).forEach(function (it) { if (it.t !== t) return; n++; var c = cardOf(it.id); if (c) { seen++; if (c[3] <= today) due++; } });
      for (k in row) answered += row[k];
      var line = fmt(seen) + " of " + fmt(n) + " seen" + (answered ? " · " + Math.round(right * 100 / answered) + "% right" : "") + (due ? " · <b>" + fmt(due) + " due</b>" : "");
      return '<li><button class="mcq-topic" data-act="mcqtopic" data-t="' + t + '"><span class="mcq-topic-b"><b>' + esc(topicLabel(t)) + '</b><span class="oph-small">' + line + "</span></span>" +
        '<span class="oph-chev" aria-hidden="true">' + ico("chev") + "</span></button></li>";
    }).join("");
    var nf = Object.keys(flags()).length;
    var seg = '<div class="oph-seg" role="group" aria-label="Mode">' +
      '<button data-act="mcqmode" data-m="study" aria-pressed="' + (Q.mode === "study") + '">Study</button>' +
      '<button data-act="mcqmode" data-m="exam" aria-pressed="' + (Q.mode === "exam") + '">Exam' + (ex === "open" ? "" : " " + I.lockBadge("exam")) + "</button></div>";
    var modeLine = Q.mode === "exam"
      ? EXAM_N + " questions, " + (EXAM_N * EXAM_SEC / 60) + " minutes, marked at the end."
      : "Each answer is marked at once, with its explanation.";
    I.paint(I.top("Back to clinics", "Question bank", fmt(pool(d.items).length) + " questions") +
      '<div class="oph-scroll oph-pad">' +
      '<div class="oph-levelrow">' + seg + '<span class="oph-small">' + modeLine + "</span></div>" +
      '<section class="oph-today" aria-label="Today"><p class="oph-small mcq-level" id="mcqLevel">' + levelLine() + '</p><p class="oph-today-line">' +
      (s.due ? "<b>" + fmt(s.due) + "</b> " + (s.due === 1 ? "question" : "questions") + " due for review" : s.seen ? "No reviews due. Carry on with new questions." : "Start with a mixed set from every subspecialty.") + "</p>" +
      '<button class="oph-btn pri oph-wide" data-act="mcqstart">' + ico("play") + (Q.mode === "exam" ? " Start exam" : " Start questions") + "</button></section>" +
      '<h2 class="oph-h2">Subspecialties</h2><ul class="mcq-topics">' + rows + "</ul>" +
      '<h2 class="oph-h2" id="mcqSearchH">Search</h2><div class="mcq-search"><input type="search" id="mcqSearch" placeholder="Word or phrase, for example Horner…" aria-labelledby="mcqSearchH" autocomplete="off" spellcheck="false" enterkeyhint="search"></div>' +
      '<ul class="mcq-results" id="mcqResults" aria-live="polite"></ul>' +
      (nf ? '<p class="oph-small">' + fmt(nf) + (nf === 1 ? " question" : " questions") + ' flagged. <button class="oph-link" data-act="mcqflagged">Review flagged</button></p>' : "") +
      '<p class="oph-note">Questions and explanations: ' + esc(st.cfg.sources.medmcqa ? st.cfg.sources.medmcqa.cite : "MedMCQA") + " MIT licence. Answer keys are crowd-sourced: flag any that look wrong.</p></div>", focusSel);
    var inp = $("mcqSearch"), tm = 0;
    if (inp) inp.addEventListener("input", function () { G.clearTimeout(tm); tm = G.setTimeout(function () { search(inp.value); }, 150); });
  }

  function search(term) {
    var out = $("mcqResults");
    if (!out) return;
    term = (term || "").trim().toLowerCase();
    if (term.length < 3) { out.innerHTML = ""; return; }
    var hits = [];
    for (var i = 0; i < Q.deck.items.length && hits.length < 25; i++) if (Q.deck.items[i].hay.indexOf(term) !== -1) hits.push(Q.deck.items[i]);
    out.innerHTML = hits.length ? hits.map(function (it) {
      return '<li><button class="mcq-hit" data-act="mcqone" data-id="' + esc(it.id) + '"><span>' + esc(it.q) + '</span><span class="oph-small">' + esc(topicLabel(it.t)) + "</span></button></li>";
    }).join("") : '<li class="oph-small">No question mentions that.</li>';
  }

  /* ---------- a run of questions ---------- */
  function start(items, exam) {
    if (!items.length) { try { if (G.toast) G.toast("Nothing waiting here today"); } catch (e) {} return; }
    Q.run = { items: items, i: 0, exam: !!exam, picks: [], done: false, t0: Date.now(), limit: exam ? items.length * EXAM_SEC : 0 };
    renderQ();
    if (exam) startTimer();
  }
  function startMixed(n) {
    if (Q.mode === "exam") {
      // The timed exam is a Resident (Pro) feature: every difficulty, one free trial.
      return I.gate("exam", function () {
        var all = Q.deck.items.slice(), out = [];
        while (out.length < EXAM_N && all.length) out.push(all.splice(Math.floor(Math.random() * all.length), 1)[0]);
        start(out, true);
      });
    }
    n = n > 0 ? n : SIZE; // Today's plan asks MBBS for a few questions
    levelGate(function () { start(session(pool(Q.deck.items), n, Math.min(n, NEW_CAP)), false); });
  }
  function startTopic(t) {
    levelGate(function () { start(session(pool(Q.deck.items).filter(function (it) { return it.t === t; }), SIZE, SIZE), false); });
  }

  function renderQ() {
    var r = Q.run, it = r.items[r.i], picked = r.picks[r.i];
    st.view = "mcq-q";
    st.onBack = function () { stopTimer(); renderBank(); return true; };
    st.onLeave = stopTimer;
    var flagged = !!flags()[it.id];
    var opts = it.o.map(function (o, k) {
      return '<button class="oph-ans" data-act="mcqans" data-k="' + k + '"' + (r.exam && picked === k ? ' data-state="picked"' : "") + '><span class="k" aria-hidden="true">' + LETTERS[k] + "</span>" + esc(o) + "</button>";
    }).join("");
    I.paint(I.top("Back to question bank", "Question " + (r.i + 1) + " of " + r.items.length, (r.exam ? '<span id="mcqClock">' + clock() + "</span>" : esc(topicLabel(it.t)) + (it.d ? " · " + DIFF[it.d] : "")), // an exam does not name the subspecialty
        '<button class="oph-icon" data-act="mcqflag" aria-pressed="' + flagged + '" aria-label="' + (flagged ? "Remove flag" : "Flag this answer key") + '">' + ico("flag") + "</button>") +
      '<div class="oph-scroll oph-pad mcq-q" id="mcqPanel"><p class="mcq-stem" id="mcqStem">' + esc(it.q) + "</p>" +
      '<div class="oph-answers" role="group" aria-labelledby="mcqStem">' + opts + "</div>" +
      '<div id="mcqNote" aria-live="polite"></div></div>' +
      '<div class="oph-foot"><button class="oph-btn pri oph-wide" data-act="mcqnext" id="mcqNext"' + (r.exam ? "" : " hidden") + ">" +
      (r.i + 1 < r.items.length ? "Next question" : r.exam ? "Finish and mark" : "Finish") + "</button></div>", ".oph-ans");
  }

  function answer(k) {
    var r = Q.run;
    if (!r || r.done) return;
    var it = r.items[r.i];
    if (r.exam) {
      r.picks[r.i] = k;
      [].forEach.call(G.document.querySelectorAll(".oph-ans"), function (b) {
        if (+b.getAttribute("data-k") === k) b.setAttribute("data-state", "picked"); else b.removeAttribute("data-state");
      });
      I.haptic("tap");
      return;
    }
    r.done = true; r.picks[r.i] = k;
    var right = k === it.a;
    mark(it, right);
    var box = G.document.querySelector(".oph-answers");
    if (box) box.classList.add("done");
    [].forEach.call(G.document.querySelectorAll(".oph-ans"), function (b) {
      var j = +b.getAttribute("data-k");
      b.setAttribute("data-state", j === it.a ? "right" : j === k ? "wrong" : "dim");
      b.setAttribute("aria-disabled", "true");
      if (j === it.a) b.querySelector(".k").innerHTML = ico("check") || LETTERS[j];
    });
    I.haptic(right ? "success" : "error");
    var note = $("mcqNote");
    note.innerHTML = explain(it, right, k);
    var nx = $("mcqNext"); nx.hidden = false;
    try { nx.focus({ preventScroll: true }); } catch (e) {}
  }
  function explain(it, right, k) {
    return '<div class="mcq-x oph-reveal"><p class="oph-verdict ' + (right ? "ok" : "bad") + '">' + ico(right ? "check" : "close") + (right ? " Right" : " Not this one") + "</p>" +
      (right ? "" : '<p class="mcq-key">Answer <b>' + LETTERS[it.a] + ". " + esc(it.o[it.a]) + "</b>" + (k != null ? "; you chose " + LETTERS[k] + "." : ".") + "</p>") +
      '<h3 class="oph-h3">Explanation</h3><p class="mcq-xt">' + esc(it.x) + "</p>" +
      I.maikBtn("Ophthalmology question: " + it.q + " Options: " + it.o.map(function (o, j) { return LETTERS[j] + ") " + o; }).join("; ") +
        ". The keyed answer is " + LETTERS[it.a] + ") " + it.o[it.a] + ". Explain why it is correct and why the others are not.") + "</div>";
  }
  function mark(it, right) {
    C.recordAnswer(st.store, DECK, it.t, right ? it.t : "x");
    C.review(st.store, DECK, it.id, C.gradeFor(right), I.today());
    I.save();
  }
  function next() {
    var r = Q.run;
    if (!r) return;
    if (!r.exam && !r.done) return;
    if (r.i + 1 < r.items.length) { r.i++; r.done = false; renderQ(); return; }
    finish();
  }
  function finish() {
    var r = Q.run;
    stopTimer();
    if (r.exam) r.items.forEach(function (it, i) { mark(it, r.picks[i] === it.a); });
    renderSummary();
  }

  /* ---------- summary ---------- */
  function renderSummary() {
    var r = Q.run, ok = 0, by = {}, wrong = [];
    r.items.forEach(function (it, i) {
      var right = r.picks[i] === it.a, b = by[it.t] || (by[it.t] = { n: 0, ok: 0 });
      b.n++; if (right) { ok++; b.ok++; } else wrong.push(i);
    });
    st.view = "mcq-sum";
    st.onBack = function () { renderBank(); return true; };
    var mins = Math.max(1, Math.round((Date.now() - r.t0) / 60000));
    var topics = Object.keys(by).sort(function (a, b) { return by[a].ok / by[a].n - by[b].ok / by[b].n; }).map(function (t) {
      var pct = Math.round(by[t].ok * 100 / by[t].n);
      return '<li class="oph-srow"><div class="oph-srow-h"><span>' + esc(topicLabel(t)) + "</span><b>" + by[t].ok + " of " + by[t].n + "</b></div>" +
        '<div class="oph-bar" aria-hidden="true"><i style="width:' + pct + '%"></i></div></li>';
    }).join("");
    var misses = wrong.map(function (i) {
      var it = r.items[i];
      return '<li><details class="mcq-miss"><summary><span>' + esc(it.q) + '</span></summary>' + explain(it, false, r.picks[i] == null ? null : r.picks[i]) + "</details></li>";
    }).join("");
    I.paint(I.top("Back to question bank", r.exam ? "Exam marked" : "Set finished", fmt(r.items.length) + " questions · " + mins + " min") +
      '<div class="oph-scroll oph-pad"><p class="mcq-score" id="mcqScore" tabindex="-1"><b>' + ok + " of " + r.items.length + "</b> right · " + Math.round(ok * 100 / r.items.length) + "%</p>" +
      '<p class="oph-small">' + nextDueLine() + "</p>" +
      '<h2 class="oph-h2">By subspecialty</h2><ul class="oph-slist">' + topics + "</ul>" +
      (wrong.length ? '<h2 class="oph-h2">Missed</h2><ul class="mcq-misses">' + misses + "</ul>" : "") + "</div>" +
      '<div class="oph-foot"><div class="mcq-foot2">' +
      (wrong.length ? '<button class="oph-btn sec" data-act="mcqredo">Retry the missed</button>' : '<button class="oph-btn sec" data-act="mcqbank">Question bank</button>') +
      '<button class="oph-btn pri" data-act="mcqstart">Next set</button></div></div>', "#mcqScore");
  }
  function nextDueLine() {
    var n = 0, tomorrow = I.today() + 1, k;
    for (k in st.store.cards) if (k.indexOf(DECK + ":") === 0 && st.store.cards[k][3] <= tomorrow) n++;
    return n ? fmt(n) + (n === 1 ? " question comes" : " questions come") + " back for review by tomorrow." : "Nothing comes back tomorrow.";
  }

  /* ---------- exam clock ---------- */
  function clock() {
    var r = Q.run, left = Math.max(0, r.limit - Math.floor((Date.now() - r.t0) / 1000));
    return Math.floor(left / 60) + ":" + ("0" + (left % 60)).slice(-2) + " left";
  }
  function startTimer() {
    stopTimer();
    Q.timer = G.setInterval(function () {
      var r = Q.run, el = $("mcqClock");
      if (!r || !r.exam) return stopTimer();
      if (el) el.textContent = clock();
      if (Date.now() - r.t0 >= r.limit * 1000) finish();
    }, 1000);
  }
  function stopTimer() { if (Q.timer) { G.clearInterval(Q.timer); Q.timer = 0; } }

  /* ---------- actions ---------- */
  A.mcqretry = open;
  A.mcqbank = function () { renderBank(); };
  A.mcqmode = function (b) {
    var m = b.getAttribute("data-m");
    if (m === "exam" && I.trial("exam") === "used") { I.showPro(); return; }
    Q.mode = m; renderBank("[data-act=mcqmode][data-m=" + m + "]");
  };
  A.mcqstart = function () { startMixed(); };
  A.mcqtopic = function (b) { startTopic(b.getAttribute("data-t")); };
  A.mcqone = function (b) { var it = Q.deck.byId[b.getAttribute("data-id")]; if (it) start([it], false); };
  A.mcqflagged = function () { start(Object.keys(flags()).map(function (id) { return Q.deck.byId[id]; }).filter(Boolean), false); };
  A.mcqredo = function () {
    var r = Q.run, items = [];
    r.items.forEach(function (it, i) { if (r.picks[i] !== it.a) items.push(it); });
    start(items, false);
  };
  A.mcqans = function (b) { answer(+b.getAttribute("data-k")); };
  A.mcqnext = next;
  A.mcqflag = function (b) {
    var it = Q.run.items[Q.run.i], f = flags(), on = !f[it.id];
    if (on) f[it.id] = 1; else delete f[it.id];
    I.save();
    b.setAttribute("aria-pressed", String(on));
    b.setAttribute("aria-label", on ? "Remove flag" : "Flag this answer key");
    try { if (G.toast) G.toast(on ? "Flagged for review" : "Flag removed"); } catch (e) {}
  };

  K["mcq-q"] = function (e) {
    if (e.target && e.target.tagName === "INPUT") return;
    var k = "1234".indexOf(e.key);
    if (k < 0) k = "abcd".indexOf((e.key || "").toLowerCase());
    if (k >= 0 && e.key.length === 1) { e.preventDefault(); answer(k); return; }
    // Enter or Space on a focused button is that button's own click (an option or Next), so only act elsewhere.
    if ((e.key === "Enter" || e.key === " ") && Q.run && (Q.run.done || Q.run.exam) && !(e.target && e.target.tagName === "BUTTON")) { e.preventDefault(); next(); }
  };

  O._banks.push({
    id: "mcq", title: "Question bank", sub: "Explained answers", icon: "list",
    line: function () { var s = stats(); return s.seen ? fmt(s.seen) + " answered" + (s.due ? " · <b>" + fmt(s.due) + " due</b>" : "") : "Mixed sets, topics, timed exam"; },
    open: open,
    start: function (n) { Q.mode = "study"; open(); load().then(function () { startMixed(n); }, function () {}); }, // Today's plan
    topic: function (t) { Q.mode = "study"; open(); load().then(function () { if (Q.deck.topics[t]) startTopic(t); }, function () {}); } // a lesson's "Test yourself"
  });
  O._mcq = Q; // read-only hook for the headless UI test
})(typeof window !== "undefined" ? window : this);
