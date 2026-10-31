/* kardia-cases.js: Kardia whole patient cases (WP11) with a structured report marker.
   ES5 IIFE. Loaded by kardia-loader.js after kardia.js. It replaces the Cases
   coming soon panel: case list, stem and vitals, tap to reveal history,
   examination with heart sounds through clinix-audio.js, an ECG strip from
   kardiox-ecgwave.js, echo tasks with lesson diagrams and tolerance graded
   measurements, a structured report marked against accept lists, diagnosis
   and management, then a debrief. Attempts are recorded in the engine store
   and as one FSRS card per case through SPECIALTY_CORE.
   Pure grading helpers are exported under node for tests. */
(function (G) {
  "use strict";

  /* ---------- pure helpers (node tests use these) ---------- */
  function normalizeText(s) {
    return String(s == null ? "" : s).toLowerCase()
      .replace(/[\u2018\u2019]/g, "'").replace(/[^a-z0-9%]+/g, " ")
      .replace(/\s+/g, " ").trim();
  }
  function tokensOf(s) { var n = normalizeText(s); return n ? n.split(" ") : []; }
  function containsPhrase(hay, needle) {
    if (!needle.length || needle.length > hay.length) return false;
    for (var i = 0; i + needle.length <= hay.length; i++) {
      var ok = true;
      for (var j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) { ok = false; break; }
      if (ok) return true;
    }
    return false;
  }
  /* Whole token matching only: "ms" never matches "symptoms", and
     "stenosis" alone never satisfies an accept of "mitral stenosis"
     unless the full phrase appears as whole tokens in order. Longer
     answers that contain the accepted phrase do match. */
  function matchAccept(input, accept) {
    var hay = tokensOf(input);
    if (!hay.length || !accept || !accept.length) return false;
    for (var i = 0; i < accept.length; i++) {
      var needle = tokensOf(accept[i]);
      if (needle.length && containsPhrase(hay, needle)) return true;
    }
    return false;
  }
  function gradeTolerance(value, truth, tolerance) {
    var v = typeof value === "number" ? value : parseFloat(String(value == null ? "" : value).replace(/[^0-9.\-]/g, ""));
    var t = Number(truth), tol = Number(tolerance);
    if (!isFinite(v) || !isFinite(t)) return { correct: false, value: null, truth: t, error: null, within: false };
    if (!isFinite(tol) || tol < 0) tol = 0;
    var err = Math.round(Math.abs(v - t) * 1e9) / 1e9;
    return { correct: err <= tol, value: v, truth: t, error: err, within: err <= tol };
  }
  function gradeReport(required, answers) {
    answers = answers || {};
    var fields = (required || []).map(function (r) {
      var given = answers[r.field] == null ? "" : String(answers[r.field]);
      var list = (r.accept || []).slice();
      if (r.answer && list.indexOf(r.answer) < 0) list.unshift(r.answer);
      return { field: r.field, answer: r.answer || "", given: given, correct: matchAccept(given, list) };
    });
    var n = 0; fields.forEach(function (f) { if (f.correct) n++; });
    return { fields: fields, correct: n, total: fields.length, score: fields.length ? n / fields.length : 1 };
  }
  function gradeDiagnosis(diagnosis, text) {
    if (!diagnosis) return { correct: false, answer: "", given: String(text || "") };
    var list = (diagnosis.accept || []).slice();
    if (diagnosis.answer && list.indexOf(diagnosis.answer) < 0) list.unshift(diagnosis.answer);
    return { correct: matchAccept(text, list), answer: diagnosis.answer || "", given: String(text || "") };
  }
  function ecgParamsFor(c) {
    var ecg = (c && c.ecg) || {}, v = (c && c.vitals) || {};
    var text = normalizeText([ecg.rhythm, ecg.axis, (ecg.findings || []).join(" ")].join(" "));
    var p = { rate: ecg.rate || v.hr || 72, rhythm: "regular", p: "upright", pr: "normal", qrs: "narrow", amp: 1, st: "iso", t: "normal", extras: [] };
    if (text.indexOf("atrial fibrillation") >= 0 || text.indexOf(" fibrillation") >= 0) { p.rhythm = "irregular"; p.p = "none"; p.pr = "none"; }
    if (text.indexOf("st elevation") >= 0) p.st = "up";
    else if (text.indexOf("st depression") >= 0) p.st = "down";
    if (text.indexOf("left ventricular hypertrophy") >= 0 || text.indexOf("lvh") >= 0) p.amp = 1.7;
    if (text.indexOf("right axis") >= 0) p.axis = "right";
    else if (text.indexOf("left axis") >= 0) p.axis = "left";
    if (text.indexOf("q wave") >= 0) p.q = true;
    if (text.indexOf("bundle branch block") >= 0) p.qrs = "wide";
    return p;
  }
  function audioKindFor(pathDoc, c) {
    var pid = c && c.pathology ? c.pathology.id : "";
    var byId = { mitral_stenosis: "ms_murmur", aortic_stenosis: "as_murmur", mitral_regurgitation: "mr_murmur", aortic_regurgitation: "ar_murmur", tricuspid_regurgitation: "mr_murmur" };
    if (byId[pid]) return byId[pid];
    var sev = c && c.pathology ? c.pathology.severity : null;
    var snd = null;
    if (pathDoc) {
      snd = (sev && pathDoc.severities && pathDoc.severities[sev] && pathDoc.severities[sev].sound) || pathDoc.sound || null;
    }
    if (snd) {
      if (snd.s3) return "s3_gallop";
      if (snd.s4) return "s4_gallop";
      if (snd.murmur) {
        var tim = String(snd.murmur.timing || "").toLowerCase();
        if (tim.indexOf("diastolic") >= 0) return String(snd.murmur.shape || "").indexOf("decrescendo") >= 0 ? "ar_murmur" : "ms_murmur";
        return String(snd.murmur.shape || "").indexOf("crescendo") >= 0 ? "as_murmur" : "mr_murmur";
      }
    }
    var aus = c && c.exam && c.exam.auscultation ? normalizeText([c.exam.auscultation.added, c.exam.auscultation.murmur].join(" ")) : "";
    if (aus.indexOf("opening snap") >= 0 || aus.indexOf("diastolic rumble") >= 0 || aus.indexOf("mid diastolic") >= 0) return "ms_murmur";
    if (aus.indexOf("pansystolic") >= 0 || aus.indexOf("holosystolic") >= 0) return "mr_murmur";
    if (aus.indexOf("ejection systolic") >= 0) return "as_murmur";
    if (aus.indexOf("early diastolic") >= 0) return "ar_murmur";
    if (aus.indexOf("third heart sound") >= 0 || aus.indexOf("s3") >= 0) return "s3_gallop";
    if (aus.indexOf("fourth heart sound") >= 0 || aus.indexOf("s4") >= 0) return "s4_gallop";
    return "s1s2_normal";
  }
  function murmurSiteFor(pathDoc, c) {
    var sev = c && c.pathology ? c.pathology.severity : null;
    var snd = null;
    if (pathDoc) snd = (sev && pathDoc.severities && pathDoc.severities[sev] && pathDoc.severities[sev].sound) || pathDoc.sound || null;
    if (snd && snd.murmur && snd.murmur.location) return String(snd.murmur.location);
    return "apex";
  }
  function diagramFor(viewId, pathologyId) {
    if (!viewId) return pathologyId ? "diagrams/path_" + pathologyId + ".svg" : "diagrams/view_a4c.svg";
    if (viewId.indexOf("tee_") === 0) return "diagrams/" + viewId + ".svg";
    var base = viewId.replace(/^tte_/, "").replace(/^pocus_/, "");
    if (viewId.indexOf("pocus_") === 0) return "diagrams/pocus_" + base + ".svg";
    return "diagrams/view_" + base + ".svg";
  }
  var HELPERS = { normalizeText: normalizeText, matchAccept: matchAccept, gradeTolerance: gradeTolerance, gradeReport: gradeReport, gradeDiagnosis: gradeDiagnosis, ecgParamsFor: ecgParamsFor, audioKindFor: audioKindFor, murmurSiteFor: murmurSiteFor, diagramFor: diagramFor };
  if (typeof module !== "undefined" && module.exports) module.exports = HELPERS;
  if (!G || typeof G.document === "undefined") return;

  /* ---------- browser: Cases screen on the Kardia host ---------- */
  var STEPS = [
    { id: "stem", label: "Stem" }, { id: "history", label: "History" },
    { id: "exam", label: "Examination" }, { id: "ecg", label: "ECG" },
    { id: "echo", label: "Echo" }, { id: "report", label: "Report" },
    { id: "diagnosis", label: "Diagnosis" }, { id: "debrief", label: "Debrief" }
  ];
  var FREE_CASES = 2;
  var S = { index: null, err: false, loading: false, cur: null, curId: null, step: 0, revealed: {}, listened: {}, playing: false, echoIn: {}, echoGrade: {}, reportIn: {}, reportGrade: null, diagIn: "", diagGrade: null, pathology: null, recorded: false, nav: null };
  var hostRef = null, I = null, st = null;

  function esc(s) { return I ? I.esc(s) : String(s == null ? "" : s); }
  function pro() { try { return !!(G.SMD_PRO && G.SMD_PRO.isProSync && G.SMD_PRO.isProSync()); } catch (e) { return false; } }
  function level() { try { var p = st && st.prefs; return p && p.klevel ? p.klevel : "mbbs"; } catch (e) { return "mbbs"; } }
  function repaint(focusSel) { if (S.nav) S.nav(focusSel); else if (hostRef && hostRef._render) hostRef._render(focusSel); }

  function lessonTitle(lid) {
    var l = S.lix && S.lix.lessons && S.lix.lessons[lid];
    return (l && l.title && (l.title.en || l.title)) || lid.replace(/_/g, " ");
  }
  function openShelf(id) {
    if (!S.index) { S.pendingShelf = id; loadIndex(); return; }
    var entry = null;
    for (var i = 0; i < S.index.cases.length; i++) if (S.index.cases[i].id === id) entry = S.index.cases[i];
    if (!entry) return;
    if (!pro() && entry.level !== "mbbs" && entry.level !== level()) return I.showPro();
    var same = S.index.cases.filter(function (c) { return c.level === entry.level; });
    var idx = -1;
    for (var j = 0; j < same.length; j++) if (same[j].id === id) idx = j;
    if (!pro() && entry.level === "mbbs" && idx >= FREE_CASES) return I.showPro();
    S.err = false; loadCase(entry);
  }
  function loadIndex() {
    if (S.index || S.loading) return;
    S.loading = true; S.err = false;
    /* Lesson titles for the debrief links; a missing index falls back to the id. */
    if (!S.lix) I.getJSON("learn/index.json").then(function (x) { S.lix = x || {}; }, function () { S.lix = {}; });
    I.getJSON("cases/index.json").then(function (ix) {
      S.index = ix && ix.cases ? ix : { cases: [] }; S.loading = false; repaint();
      if (S.pendingShelf) { var pid = S.pendingShelf; S.pendingShelf = null; openShelf(pid); }
    }, function () { S.err = true; S.loading = false; repaint(); });
  }
  function loadCase(entry) {
    S.cur = null; S.curId = entry.id; S.step = 0; S.revealed = {}; S.listened = {}; S.playing = false;
    S.echoIn = {}; S.echoGrade = {}; S.reportIn = {}; S.reportGrade = null; S.diagIn = ""; S.diagGrade = null; S.pathology = null; S.recorded = false;
    repaint();
    I.getJSON("cases/" + entry.file).then(function (c) {
      if (S.curId !== entry.id) return;
      S.cur = c;
      if (c.pathology && c.pathology.id) {
        I.getJSON("pathology/" + c.pathology.id + ".json").then(function (p) { S.pathology = p; if (S.curId === entry.id && S.step === 2) repaint(); }, function () {});
      }
      repaint();
    }, function () { S.err = true; repaint(); });
  }
  function filtered() {
    var lv = level();
    return (S.index ? S.index.cases : []).filter(function (c) { return c.level === lv; });
  }
  function lockedAt(list, i) { return !pro() && level() === "mbbs" && i >= FREE_CASES; }

  function listHtml() {
    var head = '<h2 class="sp-h2">Cases</h2><p class="sp-small">Whole patient cases at the level above. Work through the history, examination, ECG and echo, then write a structured report for marking.</p>';
    if (S.err && !S.index) {
      return head + '<div class="sp-err kc-err" role="alert"><p>Cases did not load. Check the connection and try again.</p>' +
        '<button type="button" class="sp-btn pri" data-act="kcase-retry">Try again</button></div>';
    }
    if (!S.index) { loadIndex(); return head + '<p class="sp-mut" role="status">Loading cases.</p>'; }
    var list = filtered();
    if (!list.length) return head + '<div class="kc-empty"><p>No cases at this level yet.</p><p class="sp-small">Cases at other levels stay listed when you change the level above.</p></div>';
    var rows = list.map(function (c, i) {
      var locked = lockedAt(list, i);
      var sub = (c.pathology ? c.pathology.id.replace(/_/g, " ") : "") + (c.pathology && c.pathology.severity ? " · " + c.pathology.severity : "");
      var done = st && st.store && st.store.sims && st.store.sims["case:" + c.id];
      var line = done ? "Attempted " + done.n + " time" + (done.n === 1 ? "" : "s") : "";
      if (locked) return I.row("kcase-pro", "", I.tile("lock"), esc(c.title), esc(sub), "Pro");
      return I.row("kcase-open", ' data-id="' + esc(c.id) + '"', I.tile("folder"), esc(c.title), esc(sub), line);
    }).join("");
    var note = pro() ? "" : '<div class="krd-note">' + I.ico("lock") + '<span>The first ' + FREE_CASES + ' cases at MBBS are free. The full case library is part of StewardMD Pro.</span></div>';
    return head + '<ul class="sp-rows">' + rows + "</ul>" + note;
  }

  function vitalsHtml(v) {
    if (!v) return "";
    var items = [["Heart rate", v.hr, "per min"], ["Systolic BP", v.sbp, "mmHg"], ["Diastolic BP", v.dbp, "mmHg"], ["Respiratory rate", v.rr, "per min"], ["Oxygen saturation", v.spo2, "percent"], ["Temperature", v.tempC, "deg C"]];
    return '<dl class="kc-vitals">' + items.filter(function (x) { return x[1] != null; }).map(function (x) {
      return "<div><dt>" + esc(x[0]) + "</dt><dd>" + esc(x[1]) + ' <span>' + esc(x[2]) + "</span></dd></div>";
    }).join("") + "</dl>";
  }
  function progressHtml() {
    return '<ol class="kc-steps" aria-label="Case progress">' + STEPS.map(function (s, i) {
      return '<li aria-current="' + (i === S.step ? "step" : "false") + '" data-on="' + (i === S.step) + '" data-done="' + (i < S.step) + '"><span>' + (i + 1) + "</span>" + esc(s.label) + "</li>";
    }).join("") + "</ol>";
  }
  function navHtml(last) {
    var back = S.step > 0 ? '<button type="button" class="sp-btn sec" data-act="kcase-prev">Back</button>' : '<button type="button" class="sp-btn sec" data-act="kcase-list">All cases</button>';
    var next = last ? "" : '<button type="button" class="sp-btn pri" data-act="kcase-next">Continue</button>';
    return '<div class="kc-nav">' + back + next + "</div>";
  }
  function sectionScore(label, frac) {
    var pct = Math.round(100 * (isFinite(frac) ? frac : 0));
    return '<li><span>' + esc(label) + '</span><b>' + pct + ' percent</b><span class="kc-bar" aria-hidden="true"><i style="width:' + pct + '%"></i></span></li>';
  }
  function scores() {
    var c = S.cur, hist = c.history && c.history.length ? Object.keys(S.revealed).length / c.history.length : 1;
    var meas = (c.echoTasks || []).filter(function (t) { return t.measure; });
    var echoF = meas.length ? meas.filter(function (t, i) { return S.echoGrade[i] && S.echoGrade[i].correct; }).length / meas.length : 1;
    return {
      history: hist, echo: echoF,
      report: S.reportGrade ? S.reportGrade.score : 0,
      diagnosis: S.diagGrade && S.diagGrade.correct ? 1 : 0
    };
  }
  function recordAttempt() {
    if (S.recorded || !S.cur) return;
    S.recorded = true;
    try {
      var C = G.SPECIALTY_CORE; if (!C) return;
      var sc = scores(), overall = (sc.history + sc.echo + sc.report + sc.diagnosis) / 4;
      var ok = overall >= 0.6;
      C.recordSim(st.store, "case:" + S.cur.id, ok, ok ? null : "case", I.today());
      var g = overall >= 0.85 ? C.EASY || 4 : overall >= 0.6 ? C.GOOD || 3 : overall >= 0.35 ? C.HARD || 2 : C.AGAIN || 1;
      C.review(st.store, "kardia-case", S.cur.id, g, I.today());
      I.save();
    } catch (e) {}
  }

  function stepHtml() {
    var c = S.cur, id = STEPS[S.step].id;
    if (id === "stem") {
      return '<h2 class="sp-h2">Stem</h2><p class="kc-stem">' + esc(c.stem) + "</p>" + vitalsHtml(c.vitals) + navHtml(false);
    }
    if (id === "history") {
      var qs = (c.history || []).map(function (h, i) {
        var open = !!S.revealed[i];
        return '<li><button type="button" class="kc-q" data-act="kcase-q" data-i="' + i + '" aria-expanded="' + open + '"><span>' + esc(h.q) + '</span><span class="kc-q-state">' + (open ? "Asked" : "Tap to ask") + "</span></button>" +
          (open ? '<p class="kc-a">' + esc(h.a) + "</p>" : "") + "</li>";
      }).join("");
      return '<h2 class="sp-h2">History</h2><p class="sp-small">Tap each question to ask it and reveal the answer.</p><ul class="kc-qs">' + qs + "</ul>" + navHtml(false);
    }
    if (id === "exam") {
      var ex = c.exam || {}, au = ex.auscultation || {};
      var kind = audioKindFor(S.pathology, c), site = murmurSiteFor(S.pathology, c);
      var snd = S.pathology && S.pathology.severities && c.pathology ? (S.pathology.severities[c.pathology.severity] || {}).sound : null;
      var murmur = snd && snd.murmur ? snd.murmur : null;
      var timing = murmur ? (murmur.timing + ", " + murmur.shape + ", grade " + murmur.grade + ", heard best at the " + murmur.location + (murmur.radiation && murmur.radiation !== "none" ? ", radiating to " + murmur.radiation : "")) : (au.murmur || "");
      var hasAudio = !!(G.SMD_CLINIX_AUDIO && G.SMD_CLINIX_AUDIO.has && G.SMD_CLINIX_AUDIO.has(kind));
      var rows = [["General", ex.general], ["Pulse", ex.pulse], ["Jugular venous pressure", ex.jvp], ["Precordium", ex.precordium], ["First heart sound", au.s1], ["Second heart sound", au.s2], ["Added sounds", au.added], ["Murmur", timing || au.murmur], ["Other findings", ex.other]]
        .filter(function (r) { return r[1]; }).map(function (r) { return "<div><dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd></div>"; }).join("");
      var listen = hasAudio
        ? '<button type="button" class="sp-btn ' + (S.playing ? "sec" : "pri") + ' kc-listen" data-act="kcase-listen" data-kind="' + esc(kind) + '">' + (S.playing ? "Stop sound" : "Listen at the " + esc(site)) + '</button><p class="sp-small">Synthesised heart sound for teaching, played at the ' + esc(site) + ". Murmur timing comes from the pathology record.</p>"
        : '<p class="sp-small" role="status">Heart sounds are not available on this device. Read the murmur description above.</p>';
      return '<h2 class="sp-h2">Examination</h2><dl class="kc-exam">' + rows + "</dl>" + listen + navHtml(false);
    }
    if (id === "ecg") {
      var p = ecgParamsFor(c), pts = "";
      try { if (G.SMD_KARDIOX_ECGWAVE) pts = G.SMD_KARDIOX_ECGWAVE.strip(p, 640, 160); } catch (e) {}
      var strip = pts ? '<svg class="kc-ecg" viewBox="0 0 640 160" role="img" aria-label="ECG rhythm strip: ' + esc(c.ecg.rhythm) + '"><polyline points="' + pts + '" fill="none" stroke="currentColor" stroke-width="2"/></svg>' : '<p class="sp-small">The ECG strip could not be drawn. The findings below carry the teaching points.</p>';
      var finds = (c.ecg.findings || []).map(function (f) { return "<li>" + esc(f) + "</li>"; }).join("");
      return '<h2 class="sp-h2">ECG</h2><p><b>' + esc(c.ecg.rhythm) + "</b> · " + esc(c.ecg.rate || (c.vitals && c.vitals.hr) || "") + " per min · " + esc(c.ecg.axis || "") + '</p>' + strip + '<ul class="kc-finds">' + finds + "</ul>" + navHtml(false);
    }
    if (id === "echo") {
      var tasks = (c.echoTasks || []).map(function (t, i) {
        var src = I.imgUrl("learn/" + diagramFor(t.view, c.pathology && c.pathology.id));
        var g = S.echoGrade[i];
        var meas = "";
        if (t.measure) {
          meas = '<label class="kc-meas"><span>' + esc(t.measure.what) + " (" + esc(t.measure.unit) + ')</span><span class="kc-meas-row"><input class="kc-in" inputmode="decimal" data-echo="' + i + '" value="' + esc(S.echoIn[i] == null ? "" : S.echoIn[i]) + '" aria-label="' + esc(t.measure.what) + '"><button type="button" class="sp-btn sec" data-act="kcase-echo-check" data-i="' + i + '">Check</button></span></label>' +
            (g ? '<p class="kc-mark ' + (g.correct ? "ok" : "bad") + '" role="status">' + (g.correct ? "Correct. " : "Not within tolerance. ") + "Expected " + esc(t.measure.truth) + " " + esc(t.measure.unit) + " (tolerance " + esc(t.measure.tolerance) + ").</p>" : "");
        }
        return '<li class="kc-task"><h3 class="sp-h3">' + esc(t.view.replace(/_/g, " ")) + '</h3><img class="kc-diagram" src="' + esc(src) + '" alt="Lesson diagram for ' + esc(t.view) + '"><p>' + esc(t.find) + "</p>" + meas + "</li>";
      }).join("");
      return '<h2 class="sp-h2">Echo</h2><p class="sp-small">Until Echo Lab lands, each task shows the lesson diagram for that view. Enter each measurement for marking against the known value.</p><ul class="kc-tasks">' + tasks + "</ul>" + navHtml(false);
    }
    if (id === "report") {
      var g2 = S.reportGrade;
      var fields = ((c.report && c.report.required) || []).map(function (r) {
        var f = g2 ? g2.fields.filter(function (x) { return x.field === r.field; })[0] : null;
        return '<label class="kc-field"><span>' + esc(r.field) + '</span><input class="kc-in" data-field="' + esc(r.field) + '" value="' + esc(S.reportIn[r.field] == null ? "" : S.reportIn[r.field]) + '" autocomplete="off">' +
          (f ? '<span class="kc-mark ' + (f.correct ? "ok" : "bad") + '">' + (f.correct ? "Marked correct." : "Expected: " + esc(f.answer)) + "</span>" : "") + "</label>";
      }).join("");
      return '<h2 class="sp-h2">Structured report</h2><p class="sp-small">Write each field in your own words. Marking accepts the listed synonyms and normalises case and punctuation.</p><div class="kc-fields">' + fields + '</div><p><button type="button" class="sp-btn pri sp-wide" data-act="kcase-report-check">Mark my report</button></p>' +
        (g2 ? '<p role="status">Score: ' + g2.correct + " of " + g2.total + " fields correct.</p>" : "") + navHtml(false);
    }
    if (id === "diagnosis") {
      var dg = S.diagGrade;
      return '<h2 class="sp-h2">Diagnosis and management</h2><label class="kc-field"><span>Your diagnosis</span><input class="kc-in" data-diag="1" value="' + esc(S.diagIn) + '" autocomplete="off"></label>' +
        '<p><button type="button" class="sp-btn pri sp-wide" data-act="kcase-diag-check">Check diagnosis</button></p>' +
        (dg ? '<div class="kc-model"><p class="kc-mark ' + (dg.correct ? "ok" : "bad") + '" role="status">' + (dg.correct ? "Correct." : "Expected: " + esc(dg.answer)) + '</p><h3 class="sp-h3">Model management</h3><p>' + esc(c.management.model) + '</p><ul class="kc-finds">' + (c.management.keyPoints || []).map(function (k) { return "<li>" + esc(k) + "</li>"; }).join("") + "</ul></div>" : "") + navHtml(true) +
        '<p><button type="button" class="sp-btn pri sp-wide" data-act="kcase-finish">Finish and see debrief</button></p>';
    }
    /* debrief */
    recordAttempt();
    var sc = scores();
    var lessons = (c.lessons || []).map(function (lid) {
      return '<li><button type="button" class="kc-lesson" data-act="kcase-lesson" data-l="' + esc(lid) + '">' + esc(lessonTitle(lid)) + "</button></li>";
    }).join("");
    var teach = (c.teaching || []).map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("");
    return '<h2 class="sp-h2">Debrief</h2><ul class="kc-scores">' + sectionScore("History", sc.history) + sectionScore("Echo measurements", sc.echo) + sectionScore("Structured report", sc.report) + sectionScore("Diagnosis", sc.diagnosis) + "</ul>" +
      (teach ? '<h3 class="sp-h3">Teaching points</h3><ul class="kc-finds">' + teach + "</ul>" : "") +
      (lessons ? '<h3 class="sp-h3">Related lessons</h3><ul class="kc-lessons">' + lessons + "</ul>" : "") +
      '<p><button type="button" class="sp-btn sec sp-wide" data-act="kcase-list">Back to all cases</button></p>';
  }

  function caseHtml() {
    if (S.err && !S.cur) return '<div class="sp-scroll sp-pad"><div class="sp-col"><div class="sp-err" role="alert"><p>This case did not load. Check the connection and try again.</p><button type="button" class="sp-btn pri" data-act="kcase-list">Back to cases</button></div></div></div>';
    if (!S.cur) return '<div class="sp-scroll sp-pad"><div class="sp-col"><p class="sp-mut" role="status">Loading case.</p></div></div>';
    st.view = "kcase";
    st.onBack = function () {
      stopAudio();
      if (S.step > 0) { S.step--; repaint(); return true; }
      S.cur = null; S.curId = null; repaint(); return true;
    };
    st.again = function () { repaint(); };
    return I.top("Cases", S.cur.title, STEPS[S.step].label + " · step " + (S.step + 1) + " of " + STEPS.length) +
      '<div class="sp-scroll sp-pad"><div class="sp-col kc-case">' + progressHtml() + stepHtml() + "</div></div>";
  }
  function html() {
    if (!I) return "";
    if (S.curId) return caseHtml();
    return '<div class="sp-scroll sp-pad"><div class="sp-col">' + listHtml() + "</div></div>";
  }
  function stopAudio() {
    try { if (G.SMD_CLINIX_AUDIO) G.SMD_CLINIX_AUDIO.stopAll(); } catch (e) {}
    S.playing = false;
  }
  function readInputs(sel) {
    var out = {}, els = G.document.querySelectorAll(sel);
    for (var i = 0; i < els.length; i++) out[els[i].getAttribute("data-field") || els[i].getAttribute("data-echo")] = els[i].value;
    return out;
  }

  function attach(h) {
    if (!h || !h._internal || hostRef === h) return;
    hostRef = h; I = h._internal; st = h._st;
    I.ACTIONS["kcase-retry"] = function () { S.err = false; S.index = null; S.loading = false; loadIndex(); repaint(); };
    I.ACTIONS["kcase-pro"] = function () { I.showPro(); };
    I.ACTIONS["kcase-open"] = function (b) {
      var id = b.getAttribute("data-id"), list = filtered();
      for (var i = 0; i < list.length; i++) if (list[i].id === id) {
        if (lockedAt(list, i)) return I.showPro();
        S.err = false; loadCase(list[i]); return;
      }
    };
    I.ACTIONS["kcase-list"] = function () { stopAudio(); S.cur = null; S.curId = null; S.err = false; repaint(); };
    I.ACTIONS["kcase-q"] = function (b) { var i = +b.getAttribute("data-i"); S.revealed[i] = !S.revealed[i]; repaint('[data-act=kcase-q][data-i="' + i + '"]'); };
    I.ACTIONS["kcase-listen"] = function (b) {
      var A = G.SMD_CLINIX_AUDIO; if (!A) return;
      if (S.playing) { stopAudio(); repaint(); return; }
      var kind = b.getAttribute("data-kind");
      try { A.prewarm && A.prewarm(); } catch (e) {}
      var handle = A.play(kind, { beats: 4, onEnd: function () { S.playing = false; repaint(); } });
      S.playing = !!handle; S.listened[kind] = true; repaint();
    };
    I.ACTIONS["kcase-prev"] = function () { if (S.step > 0) S.step--; repaint(); };
    I.ACTIONS["kcase-next"] = function () { if (S.step < STEPS.length - 1) S.step++; repaint(); };
    I.ACTIONS["kcase-finish"] = function () { S.step = STEPS.length - 1; repaint(); };
    I.ACTIONS["kcase-echo-check"] = function (b) {
      var i = +b.getAttribute("data-i"), vals = readInputs("[data-echo]");
      Object.keys(vals).forEach(function (k) { S.echoIn[k] = vals[k]; });
      var t = S.cur.echoTasks[i];
      if (t && t.measure) S.echoGrade[i] = gradeTolerance(vals[String(i)], t.measure.truth, t.measure.tolerance);
      repaint();
    };
    I.ACTIONS["kcase-report-check"] = function () {
      S.reportIn = readInputs("[data-field]");
      S.reportGrade = gradeReport(S.cur.report.required, S.reportIn);
      repaint();
    };
    I.ACTIONS["kcase-diag-check"] = function () {
      var el = G.document.querySelector("[data-diag]");
      S.diagIn = el ? el.value : "";
      S.diagGrade = gradeDiagnosis(S.cur.diagnosis, S.diagIn);
      repaint();
    };
    I.ACTIONS["kcase-lesson"] = function (b) {
      var id = b.getAttribute("data-l"); stopAudio(); S.cur = null; S.curId = null;
      if (I.ACTIONS.lesson) { I.ACTIONS.lesson({ getAttribute: function (n) { return n === "data-l" ? id : null; } }); return; }
      repaint();
    };
  }

  var API = { helpers: HELPERS, attach: attach, html: html, openShelf: openShelf, setNavigator: function (fn) { S.nav = fn; }, _state: S, FREE_CASES: FREE_CASES, STEPS: STEPS };
  G.KARDIA_CASES = API;
  if (G.KARDIA && G.KARDIA._internal) attach(G.KARDIA);
})(typeof window !== "undefined" ? window : this);
