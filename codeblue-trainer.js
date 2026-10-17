/* codeblue-trainer.js — Megacode and ACLS practice module (StewardMD Code Blue trainer).
 * Vanilla JS, no framework, fully offline. State in localStorage key smd.cbtrain.v1 (try/catch).
 * Exposes window.CodeBlueTrainer = { open(), close(), isOpen(), _engine }.
 * The lead wires the entry point; this file creates its own overlay root on open().
 * No doses anywhere. British spelling. No emojis, no em-dashes.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.CodeBlueTrainer = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var STORE_KEY = "smd.cbtrain.v1";
  var DISCLAIMER = "Timer, reminder, documentation and practice aid only. Not a substitute for clinical judgement, formal resuscitation training or your institution's protocol.";
  var MODES = ["adult", "paediatric", "neonatal"];
  var MODE_LABEL = { adult: "Adult", paediatric: "Paediatric", neonatal: "Neonatal" };

  function getData() {
    if (typeof window !== "undefined" && window.CodeBlueTrainerData) return window.CodeBlueTrainerData;
    try { return require("./codeblue-trainer-data.js"); } catch (e) { return null; }
  }

  // ---------------- pure engine (DOM-free, unit-tested) ----------------

  function scenarios(mode) {
    var D = getData(); if (!D) return [];
    return D.SCENARIOS.filter(function (s) { return !mode || s.mode === mode; });
  }
  function cases(mode) {
    var D = getData(); if (!D) return [];
    return D.CASES.filter(function (c) { return !mode || c.mode === mode; });
  }
  function findScenario(id) {
    var list = scenarios(); for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function findCase(id) {
    var list = cases(); for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function correctIdx(state) {
    for (var i = 0; i < state.o.length; i++) if (state.o[i][1] === 1) return i;
    return -1;
  }
  function fmtClock(simSec) {
    simSec = Math.max(0, Math.floor(simSec));
    var m = Math.floor(simSec / 60), s = simSec % 60;
    return (m < 10 ? "0" + m : "" + m) + ":" + (s < 10 ? "0" + s : "" + s);
  }

  // Guided: wrong picks explained, learner continues until correct.
  // A wrong pick costs 30 sim seconds when the caller passes the sim clock.
  function newGuided(id) {
    var scn = findScenario(id); if (!scn) return null;
    return { scn: scn, idx: 0, wrong: 0, picks: 0, done: false, penaltySec: 0 };
  }
  function pickGuided(sess, optIdx, simSec) {
    if (!sess || sess.done) return { status: "done" };
    var st = sess.scn.states[sess.idx];
    if (!st || !st.o[optIdx]) return { status: "invalid" };
    sess.picks++;
    if (st.o[optIdx][1] === 1) {
      var last = sess.idx === sess.scn.states.length - 1;
      sess.idx++;
      if (last) sess.done = true;
      return { status: "correct", coach: st.c, done: sess.done };
    }
    sess.wrong++;
    if (typeof simSec === "number" && isFinite(simSec)) {
      sess.penaltySec += 30;
      return { status: "wrong", why: st.o[optIdx][2], costSec: 30 };
    }
    return { status: "wrong", why: st.o[optIdx][2] };
  }

  // Practice case rhythm: hard cases hide it until the learner asks.
  function caseRhythm(c) {
    if (!c) return null;
    if (c.conceal) return { hidden: true, rhythm: c.rhythm || "" };
    return { hidden: false, rhythm: c.rhythm || "" };
  }
  function rhythmText(c) {
    if (!c || !c.rhythm) return "";
    if (c.mode === "neonatal") return "Heart rate check: " + c.rhythm + ".";
    return "Monitor shows " + c.rhythm + ".";
  }
  function newCaseSession(c) {
    if (!c) return null;
    return { c: c, qi: 0, answers: [], rhythmRevealed: !c.conceal, revealAt: null };
  }
  function revealRhythm(sess, simSec) {
    if (!sess || sess.rhythmRevealed) return false;
    sess.rhythmRevealed = true;
    sess.revealAt = (typeof simSec === "number" && isFinite(simSec)) ? simSec : null;
    return true;
  }

  // Test station: one pick per state, timed on the sped-up clock, no coaching.
  function newTest(id) {
    var scn = findScenario(id); if (!scn) return null;
    return { scn: scn, idx: 0, stateStart: 0, log: [], done: false };
  }
  function pickTest(sess, optIdx, simSec) {
    if (!sess || sess.done) return { status: "done" };
    var st = sess.scn.states[sess.idx];
    if (!st || !st.o[optIdx]) return { status: "invalid" };
    var ci = correctIdx(st), ok = optIdx === ci;
    var late = (simSec - sess.stateStart) > st.due;
    sess.log.push({ state: sess.idx, picked: optIdx, correct: ok, late: ok && late, at: simSec });
    sess.idx++;
    sess.stateStart = simSec;
    if (sess.idx >= sess.scn.states.length) sess.done = true;
    return { status: ok ? "correct" : "wrong", done: sess.done };
  }
  function finishTest(sess) {
    var rows = [], pts = 0, n = sess.scn.states.length;
    for (var i = 0; i < n; i++) {
      var st = sess.scn.states[i], ci = correctIdx(st), entry = null;
      for (var k = 0; k < sess.log.length; k++) if (sess.log[k].state === i) entry = sess.log[k];
      if (!entry) {
        rows.push({ kind: "missed", prompt: st.p, expected: st.o[ci][0] });
      } else if (entry.correct && !entry.late) {
        pts += 1;
        rows.push({ kind: "correct", prompt: st.p, expected: st.o[ci][0], at: entry.at });
      } else if (entry.correct && entry.late) {
        pts += 0.5;
        rows.push({ kind: "late", prompt: st.p, expected: st.o[ci][0], at: entry.at, due: st.due });
      } else {
        rows.push({ kind: "missed", prompt: st.p, expected: st.o[ci][0], picked: st.o[entry.picked][0], at: entry.at });
      }
    }
    return { pct: Math.round(100 * pts / n), rows: rows, log: sess.log.slice() };
  }

  // Practice case quiz grading.
  function gradeCase(caseObj, answers) {
    var per = [], score = 0;
    for (var i = 0; i < caseObj.quiz.length; i++) {
      var q = caseObj.quiz[i], ok = answers[i] === q.a;
      if (ok) score++;
      per.push({ ok: ok, why: q.why, topic: q.topic });
    }
    return { score: score, total: caseObj.quiz.length, per: per };
  }

  // ---------------- training store (localStorage, try/catch) ----------------

  function blankStore() { return { v: 1, best: {}, hist: [], topics: {} }; }
  function memStorage() {
    var m = {};
    return { getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
      setItem: function (k, v) { m[k] = String(v); }, removeItem: function (k) { delete m[k]; } };
  }
  function defaultStorage() {
    try {
      if (typeof localStorage !== "undefined") return localStorage;
    } catch (e) {}
    return memStorage();
  }
  function loadStore(storage) {
    storage = storage || defaultStorage();
    try {
      var raw = storage.getItem(STORE_KEY);
      if (!raw) return blankStore();
      var s = JSON.parse(raw);
      if (!s || typeof s !== "object") return blankStore();
      if (!s.best || typeof s.best !== "object") s.best = {};
      if (!Array.isArray(s.hist)) s.hist = [];
      if (!s.topics || typeof s.topics !== "object") s.topics = {};
      return s;
    } catch (e) { return blankStore(); }
  }
  function saveStore(storage, s) {
    storage = storage || defaultStorage();
    try { storage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) {}
  }
  function recordResult(s, id, pct, topicStats) {
    if (s.best[id] == null || pct > s.best[id]) s.best[id] = pct;
    try { s.hist.push({ id: id, pct: pct, at: Date.now() }); } catch (e) { s.hist.push({ id: id, pct: pct, at: 0 }); }
    if (s.hist.length > 100) s.hist = s.hist.slice(s.hist.length - 100);
    (topicStats || []).forEach(function (t) {
      var r = s.topics[t.topic] || { asked: 0, missed: 0 };
      r.asked += t.asked; r.missed += t.missed;
      s.topics[t.topic] = r;
    });
    return s;
  }
  function weakSpots(s) {
    var out = [];
    Object.keys(s.topics).forEach(function (topic) {
      var r = s.topics[topic];
      if (r.asked > 0) out.push({ topic: topic, asked: r.asked, missed: r.missed, rate: r.missed / r.asked });
    });
    out.sort(function (a, b) { return b.rate - a.rate; });
    return out;
  }
  function trend(s, n) {
    return s.hist.slice(Math.max(0, s.hist.length - (n || 10)));
  }
  function weekKey(ts) {
    var d = new Date(ts), day = (d.getDay() + 6) % 7;
    var mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
    function p(x) { return (x < 10 ? "0" + x : "" + x); }
    return mon.getFullYear() + "-" + p(mon.getMonth() + 1) + "-" + p(mon.getDate());
  }
  // Weekly trend: per Monday-starting week, attempts and mean score.
  function weeklyTrend(s, nWeeks) {
    var groups = {};
    (s.hist || []).forEach(function (h) {
      if (!h || !(h.at > 0)) return;
      var k = weekKey(h.at);
      if (!groups[k]) groups[k] = { n: 0, sum: 0 };
      groups[k].n++;
      groups[k].sum += (+h.pct || 0);
    });
    var weeks = Object.keys(groups).sort();
    if (nWeeks) weeks = weeks.slice(Math.max(0, weeks.length - nWeeks));
    return weeks.map(function (k) {
      return { week: k, n: groups[k].n, avg: Math.round(groups[k].sum / groups[k].n) };
    });
  }
  // Weakest topic proposes the next case: unplayed first, then lowest best.
  function suggestNext(s, caseList) {
    var w = weakSpots(s).filter(function (x) { return x.asked > 0; });
    if (!w.length || !caseList || !caseList.length) return null;
    for (var i = 0; i < w.length; i++) {
      var cands = caseList.filter(function (c) {
        return (c.quiz || []).some(function (q) { return q.topic === w[i].topic; });
      });
      if (!cands.length) continue;
      cands.sort(function (a, b) {
        var ba = s.best[a.id], bb = s.best[b.id];
        var pa = (ba == null) ? -1 : ba, pb = (bb == null) ? -1 : bb;
        if (pa !== pb) return pa - pb;
        return a.id < b.id ? -1 : 1;
      });
      return { caseId: cands[0].id, topic: w[i].topic, missed: w[i].missed, asked: w[i].asked };
    }
    return null;
  }
  function exportText(s, D) {
    function title(id) {
      if (!D) return id;
      var scn = null, cs = null;
      try {
        scn = findScenario(id);
        cs = scn || findCase(id);
      } catch (e) { cs = null; }
      return (cs && cs.title) ? cs.title + " (" + id + ")" : id;
    }
    var lines = ["Code Blue training results", "Exported " + new Date().toISOString().slice(0, 10), ""];
    var keys = Object.keys(s.best || {}).sort();
    lines.push("Best scores (" + keys.length + " completed):");
    if (!keys.length) lines.push("None yet.");
    keys.forEach(function (k) { lines.push(title(k) + ": " + s.best[k] + "%"); });
    lines.push("");
    lines.push("Weekly trend:");
    var wt = weeklyTrend(s, 8);
    if (!wt.length) lines.push("No dated attempts yet.");
    wt.forEach(function (x) { lines.push(x.week + ": " + x.n + " attempts, mean " + x.avg + "%"); });
    lines.push("");
    lines.push("Weak topics:");
    var w = weakSpots(s).slice(0, 5);
    if (!w.length) lines.push("None yet.");
    w.forEach(function (x) { lines.push(x.topic + ": missed " + x.missed + " of " + x.asked); });
    return lines.join("\n");
  }
  function resetStore(s) {
    var b = blankStore();
    s.best = b.best; s.hist = b.hist; s.topics = b.topics;
    return s;
  }

  // Content validity: run by the unit test and usable in-app.
  // extra (test only): {lessons:[ids], modules:[ids]} to verify PrepNucleus links exist.
  function validateContent(D, extra) {
    var errs = [];
    if (!D) return ["no data"];
    var need = { adult: 14, paediatric: 9, neonatal: 7 };
    MODES.forEach(function (m) {
      var n = D.SCENARIOS.filter(function (s) { return s.mode === m; }).length;
      if (n < need[m]) errs.push("scenarios " + m + ": " + n + " < " + need[m]);
      var c = D.CASES.filter(function (x) { return x.mode === m; }).length;
      if (c < 8) errs.push("cases " + m + ": " + c + " < 8");
      ["easy", "medium", "hard"].forEach(function (lv) {
        if (!D.CASES.some(function (x) { return x.mode === m && x.level === lv; })) errs.push("cases " + m + " missing " + lv);
      });
    });
    if (D.CASES.length < 48) errs.push("cases total " + D.CASES.length + " < 48");
    var quizTotal = 0, ids = {};
    D.SCENARIOS.forEach(function (s, si) {
      if (!s.id || ids[s.id]) errs.push("scenario[" + si + "] bad/duplicate id");
      ids[s.id] = 1;
      if (!s.title) errs.push(s.id + ": no title");
      if (!s.src) errs.push(s.id + ": no source");
      if (!Array.isArray(s.states) || s.states.length < 3) errs.push(s.id + ": fewer than 3 states");
      (s.states || []).forEach(function (st, i) {
        if (!st.p) errs.push(s.id + " s" + i + ": no prompt");
        if (!Array.isArray(st.o) || st.o.length < 3) errs.push(s.id + " s" + i + ": fewer than 3 options");
        var nCorrect = st.o.filter(function (o) { return o[1] === 1; }).length;
        if (nCorrect !== 1) errs.push(s.id + " s" + i + ": " + nCorrect + " correct options");
        if (!st.c) errs.push(s.id + " s" + i + ": no coach line");
        if (!(st.due > 0)) errs.push(s.id + " s" + i + ": bad due");
        if (s.mode === "neonatal") {
          if (st.due !== 60) errs.push(s.id + " s" + i + ": neonatal due must be 60 s, got " + st.due);
        } else if ([60, 90, 120, 180].indexOf(st.due) < 0) {
          errs.push(s.id + " s" + i + ": adult/paediatric due must be 60, 90, 120 or 180 s, got " + st.due);
        }
        if (!Array.isArray(st.t) || !st.t.length) errs.push(s.id + " s" + i + ": no topics");
        (st.t || []).forEach(function (t) { if (D.TOPICS.indexOf(t) < 0) errs.push(s.id + " s" + i + ": unknown topic " + t); });
      });
    });
    D.CASES.forEach(function (c, ci) {
      if (!c.id || ids[c.id]) errs.push("case[" + ci + "] bad/duplicate id");
      ids[c.id] = 1;
      if (!c.vignette) errs.push(c.id + ": no vignette");
      if (!Array.isArray(c.clues) || !c.clues.length) errs.push(c.id + ": no clues");
      if (!Array.isArray(c.quiz) || !c.quiz.length) errs.push(c.id + ": no quiz");
      if (c.level === "hard") {
        if (c.conceal !== true) errs.push(c.id + ": hard case must conceal its rhythm");
        if (!c.rhythm || typeof c.rhythm !== "string") errs.push(c.id + ": hard case needs a rhythm label");
        if ((c.quiz || []).length < 4) errs.push(c.id + ": hard case needs at least 4 questions");
      }
      quizTotal += (c.quiz || []).length;
      (c.quiz || []).forEach(function (q, i) {
        if (!q.q || !Array.isArray(q.o) || q.o.length !== 4) errs.push(c.id + " q" + i + ": bad stem/options");
        if (!(q.a >= 0 && q.a < 4)) errs.push(c.id + " q" + i + ": bad answer");
        if (!q.why) errs.push(c.id + " q" + i + ": no rationale");
        else {
          var body = q.why.replace(/\.\s*$/, "");
          if (/[.!?]/.test(body)) errs.push(c.id + " q" + i + ": rationale must be one sentence");
        }
        if (D.TOPICS.indexOf(q.topic) < 0) errs.push(c.id + " q" + i + ": unknown topic");
        if (q.link != null) {
          if ((q.link.kind !== "lesson" && q.link.kind !== "module") || typeof q.link.id !== "string" || !q.link.id) {
            errs.push(c.id + " q" + i + ": bad link");
          } else {
            var dest = (D.LINK_DEST || {})[q.link.id];
            if (!dest || typeof dest.s !== "string" || typeof dest.m !== "string") {
              errs.push(c.id + " q" + i + ": link id has no PREP destination: " + q.link.id);
            }
            if (extra) {
              if (q.link.kind === "lesson" && extra.lessons.indexOf(q.link.id) < 0) {
                errs.push(c.id + " q" + i + ": lesson link does not exist: " + q.link.id);
              }
              if (q.link.kind === "module" && extra.modules.indexOf(q.link.id) < 0) {
                errs.push(c.id + " q" + i + ": module link does not exist: " + q.link.id);
              }
            }
          }
        }
      });
    });
    if (quizTotal < 150) errs.push("quiz total " + quizTotal + " < 150");
    var texts = [];
    JSON.stringify(D, function (k, v) { if (typeof v === "string") texts.push(v); return v; });
    var banned = [/[0-9]\s?(mg|mcg|microgram|mmol|millimol)/i, /joule/i, /[0-9]\s?J(\/| |$)/, /mg\/kg/i, /\u2014/, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u];
    var doseWords = ["1 mg", "300 mg", "360 J", "200 J", "120 J"];
    texts.forEach(function (t) {
      banned.forEach(function (re) { if (re.test(t)) errs.push("banned pattern " + re + " in: " + t.slice(0, 60)); });
      if (/pediatric/i.test(t)) errs.push("American spelling in: " + t.slice(0, 60));
      doseWords.forEach(function (w) { if (t.indexOf(w) >= 0) errs.push("dose text " + w + " in: " + t.slice(0, 60)); });
    });
    return errs;
  }

  var _engine = { scenarios: scenarios, cases: cases, findScenario: findScenario, findCase: findCase,
    newGuided: newGuided, pickGuided: pickGuided, newTest: newTest, pickTest: pickTest,
    finishTest: finishTest, gradeCase: gradeCase, fmtClock: fmtClock, correctIdx: correctIdx,
    caseRhythm: caseRhythm, rhythmText: rhythmText, newCaseSession: newCaseSession, revealRhythm: revealRhythm,
    STORE_KEY: STORE_KEY, DISCLAIMER: DISCLAIMER, MODES: MODES, MODE_LABEL: MODE_LABEL,
    blankStore: blankStore, loadStore: loadStore, saveStore: saveStore, recordResult: recordResult,
    weakSpots: weakSpots, trend: trend, weeklyTrend: weeklyTrend, weekKey: weekKey,
    suggestNext: suggestNext, exportText: exportText,
    resetStore: resetStore, validateContent: validateContent,
    memStorage: memStorage };

  // ---------------- UI layer (browser only) ----------------

  var rootEl = null, clockTimer = null, clockSim = 0, clockCb = null;
  var store = null, uiMode = "adult";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function hasDOM() { return typeof document !== "undefined"; }
  function getStore() {
    if (!store) store = loadStore();
    return store;
  }
  function persist() { try { saveStore(undefined, getStore()); } catch (e) {} }

  function startClock(onTick) {
    stopClock();
    clockSim = 0; clockCb = onTick || null;
    clockTimer = setInterval(function () {
      var D = getData();
      var speed = (D && D.TIMINGS && D.TIMINGS.clockSpeed) || 20;
      clockSim += 0.25 * speed;
      if (clockCb) { try { clockCb(clockSim); } catch (e) {} }
    }, 250);
  }
  function stopClock() {
    if (clockTimer) { try { clearInterval(clockTimer); } catch (e) {} }
    clockTimer = null; clockCb = null;
  }

  function shell(activeStation, title, body) {
    return '<div class="cbt-top">' +
      '<span class="cbt-title">' + esc(title) + '</span>' +
      '<span class="cbt-badge">TRAINING</span>' +
      '<button type="button" class="cbt-back" data-act="home" aria-label="Back to trainer home">Back</button>' +
      '<button type="button" class="cbt-back" data-cbp-settings aria-label="Display settings">Display</button>' +
      '<button type="button" class="cbt-close" data-act="close" aria-label="Close trainer">Close</button></div>' +
      '<div class="cbt-scroll"><h2 class="cbt-h" tabindex="-1">' + esc(title) + '</h2><div class="cbt-layout">' + body + "</div></div>";
  }
  function modeTabs() {
    var html = '<div class="cbt-modes" role="tablist" aria-label="Mode">';
    MODES.forEach(function (m) {
      html += '<button type="button" role="tab" aria-selected="' + (m === uiMode) + '" class="cbt-mode' +
        (m === uiMode ? " on" : "") + '" data-act="mode" data-mode="' + m + '">' + MODE_LABEL[m] + "</button>";
    });
    return html + "</div>";
  }
  function levelTag(lv) { return '<span class="cbt-lv cbt-lv-' + esc(lv) + '">' + esc(lv) + "</span>"; }

  function show(html, station) {
    if (!rootEl) return;
    rootEl.innerHTML = html;
    rootEl.setAttribute("data-station", station || "home");
    var h = rootEl.querySelector(".cbt-h");
    if (h && station !== "home") { try { h.focus({ preventScroll: true }); } catch (e) {} }
    try { rootEl.querySelector(".cbt-scroll").scrollTop = 0; } catch (e) {}
  }

  function showHome() {
    stopClock();
    var html = '<div class="cbt-top"><span class="cbt-title">Code Blue Trainer</span><span class="cbt-badge">TRAINING</span>' +
      '<button type="button" class="cbt-back" data-cbp-settings aria-label="Display settings">Display</button>' +
      '<button type="button" class="cbt-close" data-act="close" aria-label="Close trainer">Close</button></div>' +
      '<div class="cbt-scroll"><h2 class="cbt-h" tabindex="-1">Megacode and ACLS practice</h2><div class="cbt-layout">' +
      '<p class="cbt-disc">' + esc(DISCLAIMER) + "</p>" +
      '<p class="cbt-note">Practice only. The clock runs sped up and labelled TRAINING. Nothing here writes to a patient record.</p>' +
      '<button type="button" class="cbt-station" data-act="go-guided"><b>Guided Megacode</b><span>Step through arrest scenarios with coaching.</span></button>' +
      '<button type="button" class="cbt-station" data-act="go-test"><b>Test station</b><span>Same scenarios, timed, no coaching, scored debrief.</span></button>' +
      '<button type="button" class="cbt-station" data-act="go-cases"><b>Practice cases</b><span>Timed clues plus quiz questions.</span></button>' +
      '<button type="button" class="cbt-station" data-act="go-mine"><b>My training</b><span>Best scores, trend and weak spots.</span></button></div></div>';
    show(html, "home");
  }

  function scenarioList(kind) {
    var list = scenarios(uiMode);
    var html = modeTabs();
    list.forEach(function (s) {
      html += '<button type="button" class="cbt-card" data-act="' + kind + '" data-id="' + esc(s.id) + '">' +
        "<b>" + esc(s.title) + "</b>" + levelTag(s.level) +
        '<span class="cbt-meta">' + s.states.length + " steps. " + esc(s.src) + "</span></button>";
    });
    return html;
  }

  function showGuidedList() { show(shell(0, "Guided Megacode", scenarioList("start-guided")), "list"); }
  function showTestList() { show(shell(0, "Test station", '<p class="cbt-note">Timed on a sped-up clock. No coaching. Your actions are logged.</p>' + scenarioList("start-test")), "list"); }
  function showCaseList() {
    var list = cases(uiMode), html = modeTabs();
    list.forEach(function (c) {
      var best = getStore().best[c.id];
      html += '<button type="button" class="cbt-card" data-act="start-case" data-id="' + esc(c.id) + '">' +
        "<b>" + esc(c.title) + "</b>" + levelTag(c.level) +
        '<span class="cbt-meta">' + c.quiz.length + " questions" + (best != null ? ". Best " + best + "%" : "") + "</span></button>";
    });
    show(shell(0, "Practice cases", html), "list");
  }

  // ---- guided run (sped-up clock; a wrong pick costs 30 sim seconds) ----
  var guided = null;
  function showGuided() {
    var st = guided.scn.states[guided.idx];
    var n = guided.scn.states.length;
    var html = clockBar('<span class="cbt-step">Step ' + (guided.idx + 1) + " of " + n + ". " + esc(guided.scn.src) + "</span>") +
      '<div class="cbt-state"><p class="cbt-p">' + esc(st.p) + "</p></div>" +
      '<div class="cbt-opts" role="group" aria-label="Choose the next action">';
    st.o.forEach(function (o, i) {
      html += '<button type="button" class="cbt-opt" data-act="g-pick" data-i="' + i + '">' + esc(o[0]) + "</button>";
    });
    show(shell(0, guided.scn.title, html + '</div><div class="cbt-fb" id="cbtFb" aria-live="polite"></div>'), "guided");
    startClock(function (sim) {
      var t = rootEl.querySelector("#cbtTime");
      if (t) t.textContent = fmtClock(sim);
    });
    clockSim = guided.keptSim || 0;
  }
  function guidedPick(btn) {
    guided.keptSim = clockSim;
    var r = pickGuided(guided, +(btn.getAttribute("data-i")), clockSim);
    var fb = rootEl.querySelector("#cbtFb");
    if (r.status === "wrong") {
      btn.disabled = true; btn.classList.add("off");
      fb.innerHTML = '<p class="cbt-why"><b>Not quite.</b> ' + esc(r.why) +
        " That cost about 30 seconds of sim time. Try again.</p>";
    } else if (r.status === "correct") {
      var opts = rootEl.querySelectorAll(".cbt-opt");
      for (var i = 0; i < opts.length; i++) opts[i].disabled = true;
      btn.classList.add("hit");
      fb.innerHTML = '<p class="cbt-coach"><b>Coach.</b> ' + esc(r.coach) + "</p>" +
        (r.done ? "" : '<button type="button" class="cbt-next" data-act="g-next">Next step</button>');
      if (r.done) {
        stopClock();
        fb.innerHTML += '<p class="cbt-done">Scenario complete' +
          (guided.penaltySec > 0 ? " with " + fmtClock(guided.penaltySec) + " lost to wrong picks." : ".") + "</p>" +
          '<button type="button" class="cbt-next" data-act="go-guided">More scenarios</button>';
      }
    }
  }

  // ---- test run ----
  var testSess = null;
  function clockBar(extra) {
    return '<div class="cbt-clock" role="timer" aria-label="Training clock"><span class="cbt-badge">TRAINING</span>' +
      '<span class="cbt-time" id="cbtTime">' + fmtClock(clockSim) + "</span>" +
      (extra || "") + "</div>";
  }
  function showTest() {
    var st = testSess.scn.states[testSess.idx];
    var n = testSess.scn.states.length;
    var logHtml = testSess.log.map(function (e) {
      return '<li>' + fmtClock(e.at) + " . " + esc(testSess.scn.states[e.state].o[e.picked][0]) + "</li>";
    }).join("");
    var html = clockBar('<span class="cbt-step">Step ' + (testSess.idx + 1) + " of " + n + "</span>") +
      '<div class="cbt-state"><p class="cbt-p">' + esc(st.p) + "</p></div>" +
      '<div class="cbt-opts" role="group" aria-label="Choose the next action">';
    st.o.forEach(function (o, i) {
      html += '<button type="button" class="cbt-opt" data-act="t-pick" data-i="' + i + '">' + esc(o[0]) + "</button>";
    });
    html += '</div><h3 class="cbt-sub">Action log</h3><ul class="cbt-log" aria-live="polite">' + (logHtml || "<li>No actions yet.</li>") + "</ul>";
    show(shell(0, testSess.scn.title, html), "test");
    startClock(function (sim) {
      var t = rootEl.querySelector("#cbtTime");
      if (t) t.textContent = fmtClock(sim);
    });
    clockSim = testSess.keptSim || 0;
  }
  function testPick(btn) {
    var r = pickTest(testSess, +(btn.getAttribute("data-i")), clockSim);
    testSess.keptSim = clockSim;
    if (r.done) { showDebrief(); return; }
    showTest();
    testSess.keptSim = clockSim;
  }
  function showDebrief() {
    stopClock();
    var res = finishTest(testSess);
    var D = getData();
    var rc = D.TIMINGS.rhythmCheckSec[testSess.scn.mode];
    var ref = "Reference timings: rhythm check every " + rc + " s (" + MODE_LABEL[testSess.scn.mode] +
      "), epinephrine due 180 s after the last dose and overdue at 300 s.";
    var topics = [];
    res.rows.forEach(function (row, i) {
      var st = testSess.scn.states[i];
      st.t.forEach(function (t) { topics.push({ topic: t, asked: 1, missed: row.kind === "correct" ? 0 : 1 }); });
    });
    recordResult(getStore(), testSess.scn.id, res.pct, topics);
    persist();
    var chipFor = { correct: "Correct", late: "Late", missed: "Missed" };
    var allRows = res.rows.map(function (r) {
      var meta = "";
      if (r.at != null) meta = "At " + fmtClock(r.at) + " sim" + (r.due != null ? ", allowed " + r.due + " s" : "") + ". ";
      if (r.picked) meta += "You picked: " + r.picked + ". ";
      return '<div class="cbt-rrow"><span class="cbt-rrow-label">' + esc(r.expected) + '</span>' +
        '<span class="cbt-chip cbt-chip-' + esc(r.kind) + '">' + esc(chipFor[r.kind] || r.kind) + '</span>' +
        '<span class="cbt-rrow-text">' + esc(meta + r.prompt) + "</span></div>";
    }).join("");
    var html = '<div class="cbt-result"><div class="cbt-result-side"><div class="cbt-result-head">' +
      '<span class="cbt-result-score">' + res.pct + '%</span><span class="cbt-result-label">Test debrief</span></div>' +
      '<p class="cbt-note">' + esc(ref) + '</p><div class="cbt-result-actions">' +
      '<button type="button" class="cbt-next" data-act="start-test" data-id="' + esc(testSess.scn.id) + '">Try again</button>' +
      '<button type="button" class="cbt-next ghost" data-act="go-mine">My training</button></div></div>' +
      '<div class="cbt-result-rows">' + (allRows || '<p class="cbt-note">No steps scored.</p>') + "</div></div>";
    testSess = null;
    show(shell(0, "Test debrief", html), "debrief");
  }

  // ---- practice case run (hard cases hide the rhythm until asked) ----
  var caseSess = null;
  function prepOpen() {
    try {
      if (typeof window !== "undefined" && window.PREP && window.PREP.open) return window.PREP;
    } catch (e) {}
    return null;
  }
  function reviewBtn(link) {
    if (!link || !prepOpen()) return "";
    var D = getData();
    if (!D || !D.LINK_DEST || !D.LINK_DEST[link.id]) return "";
    return '<button type="button" class="cbt-review" data-act="c-review" data-kind="' + esc(link.kind) +
      '" data-id="' + esc(link.id) + '">Review this in PrepNucleus</button>';
  }
  function rhythmBox() {
    if (!caseSess) return "";
    if (caseSess.rhythmRevealed) {
      var t = rhythmText(caseSess.c);
      if (!t) return "";
      return '<div class="cbt-state" id="cbtRhythm"><p class="cbt-p">' + esc(t) + "</p></div>";
    }
    var label = caseSess.c.mode === "neonatal" ? "Ask for a heart rate check" : "Ask for a rhythm check";
    return '<div class="cbt-state" id="cbtRhythm"><p class="cbt-p">The rhythm is hidden. ' + esc(label) +
      ' when ready.</p><button type="button" class="cbt-next" data-act="c-rhythm">' + esc(label) + "</button></div>";
  }
  function showCaseRun() {
    var html = clockBar('<span class="cbt-step">' + levelTag(caseSess.c.level) + "</span>") +
      '<div class="cbt-state"><p class="cbt-p">' + esc(caseSess.c.vignette) + "</p></div>" +
      rhythmBox() +
      '<h3 class="cbt-sub">Clues</h3><ul class="cbt-log" id="cbtClues" aria-live="polite"></ul>' +
      '<div id="cbtQuiz"></div>';
    show(shell(0, caseSess.c.title, html), "case");
    startClock(function (sim) {
      var t = rootEl.querySelector("#cbtTime");
      if (t) t.textContent = fmtClock(sim);
      renderClues(sim);
    });
    renderClues(0);
    renderQuiz();
  }
  function rhythmAsk() {
    if (!caseSess || caseSess.rhythmRevealed) return;
    revealRhythm(caseSess, clockSim);
    var box = rootEl.querySelector("#cbtRhythm");
    if (box) {
      box.innerHTML = '<p class="cbt-p">' + esc(rhythmText(caseSess.c)) + "</p>";
      try { box.querySelector(".cbt-p").setAttribute("tabindex", "-1"); box.querySelector(".cbt-p").focus({ preventScroll: true }); } catch (e) {}
    }
  }
  function renderClues(sim) {
    var box = rootEl.querySelector("#cbtClues");
    if (!box) return;
    var shown = caseSess.c.clues.filter(function (c) { return sim >= c.at; });
    box.innerHTML = shown.length
      ? shown.map(function (c) { return "<li>" + esc(c.text) + "</li>"; }).join("")
      : "<li>Watch for timed clues.</li>";
  }
  function renderQuiz() {
    var box = rootEl.querySelector("#cbtQuiz");
    if (!box) return;
    var i = caseSess.qi, q = caseSess.c.quiz[i];
    if (!q) { finishCase(); return; }
    var html = '<h3 class="cbt-sub">Question ' + (i + 1) + " of " + caseSess.c.quiz.length + "</h3>" +
      '<div class="cbt-state"><p class="cbt-p">' + esc(q.q) + "</p></div>" + '<div class="cbt-opts" role="group" aria-label="Answer">';
    q.o.forEach(function (o, k) {
      html += '<button type="button" class="cbt-opt" data-act="c-pick" data-i="' + k + '">' + esc(o) + "</button>";
    });
    box.innerHTML = html + '</div><div class="cbt-fb" id="cbtFb" aria-live="polite"></div>';
  }
  function casePick(btn) {
    var i = caseSess.qi, q = caseSess.c.quiz[i], fb = rootEl.querySelector("#cbtFb");
    var ok = +(btn.getAttribute("data-i")) === q.a;
    caseSess.answers.push(+(btn.getAttribute("data-i")));
    var opts = rootEl.querySelectorAll("#cbtQuiz .cbt-opt");
    for (var k = 0; k < opts.length; k++) opts[k].disabled = true;
    btn.classList.add(ok ? "hit" : "off");
    fb.innerHTML = '<p class="' + (ok ? "cbt-coach" : "cbt-why") + '"><b>' + (ok ? "Correct." : "Not quite.") +
      "</b> " + esc(q.why) + "</p>" + reviewBtn(q.link) +
      '<button type="button" class="cbt-next" data-act="c-next">Continue</button>';
  }
  function finishCase() {
    stopClock();
    var res = gradeCase(caseSess.c, caseSess.answers);
    var pct = Math.round(100 * res.score / res.total);
    var topics = res.per.map(function (p) { return { topic: p.topic, asked: 1, missed: p.ok ? 0 : 1 }; });
    recordResult(getStore(), caseSess.c.id, pct, topics);
    persist();
    var caseRows = res.per.map(function (p, j) {
        var link = (caseSess.c.quiz[j] || {}).link;
        return '<div class="cbt-rrow"><span class="cbt-rrow-label">' + esc(p.topic) + '</span>' +
          '<span class="cbt-chip cbt-chip-' + (p.ok ? "correct" : "missed") + '">' + (p.ok ? "Correct" : "Missed") + '</span>' +
          '<span class="cbt-rrow-text">' + esc(p.why) + "</span>" + (reviewBtn(link) || "") + "</div>";
      }).join("");
    var html = '<div class="cbt-result"><div class="cbt-result-side"><div class="cbt-result-head">' +
      '<span class="cbt-result-score">' + res.score + " of " + res.total + '</span><span class="cbt-result-label">Case result</span></div>' +
      '<div class="cbt-result-actions">' +
      '<button type="button" class="cbt-next" data-act="go-cases">More cases</button>' +
      '<button type="button" class="cbt-next ghost" data-act="go-mine">My training</button></div></div>' +
      '<div class="cbt-result-rows">' + caseRows + "</div></div>";
    caseSess = null;
    show(shell(0, "Case result", html), "result");
  }

  // ---- my training: best per scenario, weekly trend, weak topics, export ----
  function showMine() {
    stopClock();
    var s = getStore(), keys = Object.keys(s.best).sort();
    var D = getData();
    var html = "";
    if (!keys.length) {
      html = '<p class="cbt-note">No training recorded yet. Finish a test station or a practice case to start your record.</p>';
    } else {
      var scnKeys = keys.filter(function (k) { return !!findScenario(k); });
      var caseKeys = keys.filter(function (k) { return !findScenario(k); });
      function bestList(list) {
        return '<ul class="cbt-log">' + list.map(function (k) {
          var cs = findScenario(k) || findCase(k);
          return "<li>" + esc(cs ? cs.title : k) + " . <b>" + s.best[k] + "%</b></li>";
        }).join("") + "</ul>";
      }
      if (scnKeys.length) html += '<h3 class="cbt-sub">Best scenario scores</h3>' + bestList(scnKeys);
      if (caseKeys.length) html += '<h3 class="cbt-sub">Best case scores</h3>' + bestList(caseKeys);
      var t = trend(s, 10);
      html += '<h3 class="cbt-sub">Recent trend</h3><ul class="cbt-log">' + t.map(function (h) {
        return "<li>" + esc(h.id) + " . " + h.pct + "%</li>";
      }).join("") + "</ul>";
      var wt = weeklyTrend(s, 8);
      html += '<h3 class="cbt-sub">Weekly trend</h3>';
      html += wt.length ? '<ul class="cbt-log">' + wt.map(function (x) {
        return "<li>Week of " + esc(x.week) + " . " + x.n + " attempts, mean <b>" + x.avg + "%</b></li>";
      }).join("") + "</ul>" : '<p class="cbt-note">No dated attempts yet.</p>';
      var w = weakSpots(s).slice(0, 5);
      html += '<h3 class="cbt-sub">Weak spots by topic</h3>';
      html += w.length ? '<ul class="cbt-log">' + w.map(function (x) {
        return "<li>" + esc(x.topic) + " . missed " + x.missed + " of " + x.asked + "</li>";
      }).join("") + "</ul>" : "<p>None yet.</p>";
      var sug = (D && D.CASES) ? suggestNext(s, D.CASES) : null;
      if (sug) {
        var sugCase = findCase(sug.caseId);
        html += '<div class="cbt-state"><p class="cbt-p">Suggested next: <b>' + esc(sugCase ? sugCase.title : sug.caseId) +
          "</b> for weak topic " + esc(sug.topic) + " (missed " + sug.missed + " of " + sug.asked + ").</p>" +
          '<button type="button" class="cbt-next" data-act="start-case" data-id="' + esc(sug.caseId) + '">Practise this case</button></div>';
      }
      html += '<h3 class="cbt-sub">Export results</h3>' +
        '<label class="cbt-step" for="cbtExport">Plain text summary, ready to copy.</label>' +
        '<textarea class="cbt-export" id="cbtExport" rows="8" readonly>' + esc(exportText(s, D)) + "</textarea>" +
        '<button type="button" class="cbt-next ghost" data-act="copy-export">Copy results</button>';
    }
    html += '<button type="button" class="cbt-next danger" data-act="reset">Reset my training</button>';
    show(shell(0, "My training", html), "mine");
  }
  function copyExport() {
    var box = rootEl.querySelector("#cbtExport");
    if (!box) return;
    function done(btn, label) {
      if (!btn) return;
      btn.textContent = label;
      setTimeout(function () { try { btn.textContent = "Copy results"; } catch (e) {} }, 2000);
    }
    var btn = rootEl.querySelector('[data-act="copy-export"]');
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(box.value).then(function () { done(btn, "Copied"); }, function () { done(btn, "Copy failed: select manually"); });
        return;
      }
    } catch (e) {}
    try { box.focus(); box.select(); document.execCommand("copy"); done(btn, "Copied"); }
    catch (e) { done(btn, "Copy failed: select manually"); }
  }

  function onClick(e) {
    var el = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
    if (!el || !rootEl || !rootEl.contains(el)) return;
    var act = el.getAttribute("data-act"), id = el.getAttribute("data-id");
    if (act === "close") { close(); return; }
    if (act === "home" || act === "go-guided") { if (act === "go-guided" && !el.classList.contains("cbt-next")) { showGuidedList(); return; } if (act === "home") { showHome(); return; } showGuidedList(); return; }
    if (act === "go-test") { showTestList(); return; }
    if (act === "go-cases") { showCaseList(); return; }
    if (act === "go-mine") { showMine(); return; }
    if (act === "mode") { uiMode = el.getAttribute("data-mode") || "adult"; var st = rootEl.getAttribute("data-station"); if (st === "list") { if (rootEl.querySelector('[data-act="start-test"]')) showTestList(); else if (rootEl.querySelector('[data-act="start-case"]')) showCaseList(); else showGuidedList(); } return; }
    if (act === "start-guided") { guided = newGuided(id); clockSim = 0; if (guided) { guided.keptSim = 0; showGuided(); } return; }
    if (act === "g-pick") { guidedPick(el); return; }
    if (act === "g-next") { if (guided) guided.keptSim = clockSim; showGuided(); return; }
    if (act === "start-test") { testSess = newTest(id); clockSim = 0; if (testSess) showTest(); return; }
    if (act === "t-pick") { testPick(el); return; }
    if (act === "start-case") { var c = findCase(id); if (c) { caseSess = newCaseSession(c); clockSim = 0; showCaseRun(); } return; }
    if (act === "c-pick") { casePick(el); return; }
    if (act === "c-next") { caseSess.qi++; renderQuiz(); return; }
    if (act === "c-rhythm") { rhythmAsk(); return; }
    if (act === "c-review") {
      var P = prepOpen(), D = getData();
      var dest = D && D.LINK_DEST ? D.LINK_DEST[el.getAttribute("data-id")] : null;
      if (P && dest) { try { P.open({ subject: dest.s, module: dest.m }); } catch (e) {} }
      return;
    }
    if (act === "copy-export") { copyExport(); return; }
    if (act === "reset") {
      try {
        if (window.confirm && !window.confirm("Reset all training records?")) return;
      } catch (err) {}
      resetStore(getStore()); persist(); showMine(); return;
    }
  }
  function onKey(e) {
    if (e.key === "Escape" && isOpen()) { try { close(); } catch (err) {} }
  }

  function open() {
    if (!hasDOM() || !getData()) return false;
    if (!rootEl) {
      rootEl = document.createElement("div");
      rootEl.id = "cbtRoot";
      document.body.appendChild(rootEl);
      rootEl.addEventListener("click", onClick);
      document.addEventListener("keydown", onKey);
    }
    rootEl.classList.add("on");
    try { document.body.classList.add("cbt-lock"); } catch (e) {}
    uiMode = "adult";
    showHome();
    try {
      if (typeof window !== "undefined" && window.CodeBluePrefs) {
        window.CodeBluePrefs.apply(rootEl);
      }
    } catch (e2) {}
    return true;
  }
  function close() {
    stopClock();
    guided = null; testSess = null; caseSess = null;
    if (rootEl) rootEl.classList.remove("on");
    try { document.body.classList.remove("cbt-lock"); } catch (e) {}
  }
  function isOpen() { return !!(rootEl && rootEl.classList.contains("on")); }

  return { open: open, close: close, isOpen: isOpen, _engine: _engine };
});

