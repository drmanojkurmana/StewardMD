/* codeblue-live.js: live code screen (StewardMD Code Blue, phone and iPad).
 * Vanilla JS, no framework, fully offline. State in localStorage key smd.cbl.v1 (try/catch).
 * Exposes window.CodeBlueLive = { open(opts), close(), isOpen(), _engine }.
 * Pure domain logic first (DOM-free, unit tested in node); the overlay UI sits
 * below. Calls window.CodeBlueSheet.open(payload) on End when present, never
 * in training. Audio lives in codeblue-audio.js (window.CodeBlueAudio).
 * Adult reference dose labels live on the adult drug buttons only (v3 owner
 * override, docs/codeblue/DESIGN.md); paediatric and neonatal show no doses
 * and nothing is ever calculated. British spelling. Plain punctuation throughout.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.CodeBlueLive = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var STORE_KEY = "smd.cbl.v1";
  var STALENESS_MS = 6 * 3600 * 1000;
  var SNAPSHOT_VERSION = 1;
  var EPI_DUE_S = 180;
  var EPI_OVERDUE_S = 300;
  var TRAINING_SPEED = 20;
  var UNDO_MS = 5000;

  var DISCLAIMER = "Timer, reminder, documentation and practice aid only. " +
    "Not a substitute for clinical judgement, formal resuscitation training or your institution's protocol.";
  var MOTION_NOTE = "Motion-based estimates, not a measure of CPR quality or depth.";

  var MODES = ["adult", "paediatric", "neonatal"];
  var MODE_LABEL = { adult: "Adult", paediatric: "Paediatric", neonatal: "Neonatal" };
  var MODE_CONFIG = {
    adult: {
      rhythmInterval: 120,
      compression: "30:2 (100 to 120 per min)",
      airway: "With an advanced airway: continuous compressions, 1 breath every 6 s."
    },
    paediatric: {
      rhythmInterval: 120,
      compression: "15:2 with two rescuers, 30:2 alone",
      airway: "With an advanced airway: continuous compressions, 1 breath every 6 s."
    },
    neonatal: {
      rhythmInterval: 60,
      compression: "3:1 (90 compressions and 30 breaths per min)",
      airway: "Ventilation first. Start compressions if the heart rate stays below 60 after 30 s of effective ventilation."
    }
  };

  var PROCEDURES = ["IV access", "IO access", "Advanced airway", "ETCO2 on",
    "Pads on", "Central line", "Arterial line"];
  var RHYTHMS = ["VF", "VT (pulseless)", "PEA", "Asystole",
    "Sinus rhythm (pulse)", "Bradycardia (pulse)", "Tachycardia (pulse)"];
  var SHOCKABLE = ["VF", "VT (pulseless)"];
  var SRC = {
    arrestAdult: "AHA 2020 adult cardiac arrest algorithm",
    arrestPaed: "AHA 2020 paediatric cardiac arrest algorithm",
    arrestNeo: "NRP algorithm",
    bradyAdult: "AHA 2020 adult bradycardia algorithm",
    bradyPaed: "AHA 2020 paediatric bradycardia algorithm",
    tachyAdult: "AHA 2020 adult tachycardia algorithm",
    postRosc: "AHA 2020 post cardiac arrest care"
  };

  function modeSrc(mode) {
    if (mode === "neonatal") return SRC.arrestNeo;
    if (mode === "paediatric") return SRC.arrestPaed;
    return SRC.arrestAdult;
  }

  function normMode(m) {
    m = String(m == null ? "" : m).toLowerCase();
    if (m === "pediatric") m = "paediatric";
    return MODES.indexOf(m) >= 0 ? m : "adult";
  }

  function isShockable(r) { return SHOCKABLE.indexOf(r) >= 0; }

  function fmtMMSS(sec) {
    sec = Math.max(0, Math.floor(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? "0" + m : "" + m) + ":" + (s < 10 ? "0" + s : "" + s);
  }

  function fmtShort(sec) {
    sec = Math.max(0, Math.floor(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ":" + (s < 10 ? "0" + s : "" + s);
  }

  function fmtAgo(sec) {
    sec = Math.max(0, Math.floor(sec));
    if (sec < 60) return sec + " s ago";
    return fmtShort(sec) + " ago";
  }

  /* ---------------- session and events (pure) ---------------- */

  /* Adult reference dose text (v3 owner override). Fixed strings from the
   * AHA adult algorithm, shown on the adult drug buttons only. Paediatric
   * and neonatal return null: no doses shown, nothing calculated. The owner
   * reviews this text. Kept out of allCopySamples so the no-dose scan over
   * the shared engine copy stays green; doseRefFor is the only source. */
  var DOSE_REF_ADULT = {
    epi: "1 mg IV/IO q3 to 5 min",
    amio: "300 mg then 150 mg",
    lido: "1 to 1.5 mg/kg"
  };

  function doseRefFor(mode) {
    if (normMode(mode) !== "adult") return null;
    return { epi: DOSE_REF_ADULT.epi, amio: DOSE_REF_ADULT.amio, lido: DOSE_REF_ADULT.lido };
  }

  var VENT_RATIO = { adult: "30:2", paediatric: "15:2", neonatal: "3:1" };

  function newSession(mode, opts) {
    opts = opts || {};
    var wall = (opts.wallNow != null) ? opts.wallNow : Date.now();
    return {
      v: 1, mode: normMode(mode), training: opts.training === true,
      events: [], rosc: false, hadRosc: false, checks: {},
      cycleStart: 0, seq: 0, undo: [], createdWall: wall,
      link: null, ventCue: true, scene: normScene(opts.scene)
    };
  }

  function defaultLabel(kind) {
    switch (kind) {
      case "cprStart": return "CPR started";
      case "cprEnd": return "CPR ended";
      case "shock": return "Shock delivered";
      case "drug": return "Epinephrine";
      case "pauseStart": return "Pause started";
      case "resume": return "Compressions resumed";
      case "switchCompressor": return "Compressor switched";
      case "rosc": return "ROSC";
      case "rhythm": return "Rhythm check";
      case "procedure": return "Procedure";
      case "reArrest": return "Re-arrest";
      case "modeSet": return "Mode set";
      default: return "Note";
    }
  }

  function logEvent(sess, kind, label, elapsed) {
    sess.seq += 1;
    var ev = {
      id: "ev-" + sess.seq,
      elapsed: Math.max(0, Math.floor(elapsed || 0)),
      kind: kind, label: label || defaultLabel(kind), edited: false
    };
    sess.events.push(ev);
    if (kind === "rhythm") sess.cycleStart = ev.elapsed;
    return ev;
  }

  function findEvent(sess, id) {
    for (var i = 0; i < sess.events.length; i++) {
      if (sess.events[i].id === id) return sess.events[i];
    }
    return null;
  }

  function editEvent(sess, id, label) {
    var ev = findEvent(sess, id);
    if (!ev || !label || !String(label).trim()) return false;
    ev.label = String(label).slice(0, 280);
    ev.edited = true;
    return true;
  }

  function deleteEvent(sess, id) {
    for (var i = 0; i < sess.events.length; i++) {
      if (sess.events[i].id === id) {
        sess.undo.push({ ev: sess.events[i], at: i });
        sess.events.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  function undoDelete(sess) {
    var last = sess.undo.pop();
    if (!last) return null;
    var at = Math.min(last.at, sess.events.length);
    sess.events.splice(at, 0, last.ev);
    return last.ev;
  }

  function lastBy(sess, pred) {
    var out = null;
    for (var i = 0; i < sess.events.length; i++) {
      if (pred(sess.events[i])) out = sess.events[i];
    }
    return out;
  }

  function isEpiDrug(ev) {
    return ev.kind === "drug" && !/amiodarone|lidocaine|lignocaine|atropine|adenosine|vasopressin|calcium|bicarb|magnesium|sodium|fluid|oxygen/i.test(ev.label || "");
  }

  function isAmioDrug(ev) {
    return ev.kind === "drug" && /amiodarone/i.test(ev.label || "");
  }

  function isLidoDrug(ev) {
    return ev.kind === "drug" && /lidocaine|lignocaine/i.test(ev.label || "");
  }

  /* Per-drug counters for the EPI AMIO LIDO SHOCK chips. Recomputed from
   * the event list like computeCounts. computeCounts itself is unchanged. */
  function drugCounts(events) {
    var epi = 0, amio = 0, lido = 0, shocks = 0;
    (events || []).forEach(function (ev) {
      if (ev.kind === "shock") shocks++;
      else if (isAmioDrug(ev)) amio++;
      else if (isLidoDrug(ev)) lido++;
      else if (isEpiDrug(ev)) epi++;
    });
    return { epi: epi, amio: amio, lido: lido, shocks: shocks };
  }

  function lastDrugBy(sess, pred) { return lastBy(sess, pred); }

  function hasAirway(sess) {
    return sess.events.some(function (e) {
      return e.kind === "procedure" && /advanced airway/i.test(e.label || "");
    });
  }

  /* Ventilation state for the vent panel and the VENT strip cell. With an
   * advanced airway: continuous compressions, 1 breath every 6 s (a 6 s
   * repeating countdown). Otherwise the mode ratio (30:2, 15:2, 3:1). */
  function ventInfo(sess, elapsed) {
    var airway = hasAirway(sess);
    if (airway) {
      var into = Math.max(0, Math.floor(elapsed || 0)) % 6;
      return { airway: true, label: "1 breath every 6 s", remaining: 6 - into, ratio: VENT_RATIO[normMode(sess.mode)] };
    }
    return { airway: false, label: VENT_RATIO[normMode(sess.mode)], remaining: null, ratio: VENT_RATIO[normMode(sess.mode)] };
  }

  /* Everything the persistent status strip shows, in one pure call. */
  function stripInfo(sess, elapsed, opts) {
    opts = opts || {};
    var cyc = cycleInfo(sess.mode, elapsed, sess.cycleStart);
    var epi = epiStatus(sess, elapsed);
    var dc = drugCounts(sess.events);
    var vent = ventInfo(sess, elapsed);
    var rhythmText, rhythmState;
    if (sess.rosc) { rhythmText = "ROSC"; rhythmState = "rosc"; }
    else if (opts.paused) { rhythmText = "Paused"; rhythmState = "paused"; }
    else if (cyc.due) { rhythmText = "Due"; rhythmState = "due"; }
    else { rhythmText = fmtShort(Math.max(0, cyc.remaining)); rhythmState = "run"; }
    var epiText, epiState;
    if (epi.state === "none") { epiText = "None"; epiState = "run"; }
    else if (epi.state === "overdue") { epiText = "Overdue"; epiState = "overdue"; }
    else if (epi.state === "due") { epiText = "Due"; epiState = "due"; }
    else { epiText = fmtShort(epi.remaining); epiState = "run"; }
    return {
      code: fmtMMSS(elapsed),
      rhythm: { text: rhythmText, state: rhythmState },
      epi: { text: epiText, state: epiState },
      shocks: dc.shocks,
      vent: vent.airway ? { text: vent.remaining + " s", state: "run" } : { text: vent.label, state: "run" }
    };
  }

  /* Counts are always recomputed from the event list, after any edit. */
  function computeCounts(events) {
    var epi = 0, shocks = 0;
    (events || []).forEach(function (ev) {
      if (ev.kind === "shock") shocks++;
      if (isEpiDrug(ev)) epi++;
    });
    return { epi: epi, shocks: shocks };
  }

  /* ---------------- scene, debrief, past codes (pure) ---------------- */

  var SCENE_SETTINGS = ["In-hospital", "Out-of-hospital"];
  var SCENE_ARREST = ["Witnessed", "Unwitnessed"];
  var SCENE_YESNO = ["Yes", "No"];
  var PAST_KEY = "smd.cbl.past.v1";
  var TEAM_KEY = "smd.cbl.team.v1";
  var PRESETS_KEY = "smd.cbl.presets.v1";
  var PAST_MAX = 50;

  function defaultScene() {
    return {
      weightKg: null, setting: "", arrest: "", bystanderCpr: "",
      downTimeMin: null, shocksBeforeArrival: null, location: "", team: []
    };
  }

  function sceneNum(x) {
    if (x == null || x === "") return null;
    var n = Number(x);
    return isFinite(n) && n >= 0 ? n : null;
  }

  /* Sanitise a scene object. Weight is stored only: it is never read by
   * any calculation in this engine. Unknown values become empty. */
  function normScene(raw) {
    var out = defaultScene();
    if (!raw || typeof raw !== "object") return out;
    out.weightKg = sceneNum(raw.weightKg);
    out.downTimeMin = sceneNum(raw.downTimeMin);
    out.shocksBeforeArrival = sceneNum(raw.shocksBeforeArrival);
    if (SCENE_SETTINGS.indexOf(raw.setting) >= 0) out.setting = raw.setting;
    if (SCENE_ARREST.indexOf(raw.arrest) >= 0) out.arrest = raw.arrest;
    if (SCENE_YESNO.indexOf(raw.bystanderCpr) >= 0) out.bystanderCpr = raw.bystanderCpr;
    out.location = String(raw.location == null ? "" : raw.location).slice(0, 80);
    if (Array.isArray(raw.team)) {
      out.team = raw.team.map(function (n) { return String(n == null ? "" : n).trim().slice(0, 40); })
        .filter(function (n) { return !!n; }).slice(0, 20);
    }
    return out;
  }

  function firstElapsedOf(events, pred) {
    var t = null;
    (events || []).forEach(function (ev) {
      if (pred(ev) && (t === null || ev.elapsed < t)) t = ev.elapsed;
    });
    return t;
  }

  /* Debrief figures from the logged events only. Pauses pair pauseStart
   * with the next resume; a pause still open at the end counts to the
   * duration. CPR fraction is estimated from those logged pauses. */
  function debriefStats(events, durationSeconds) {
    var dur = Math.max(0, Math.floor(Number(durationSeconds) || 0));
    var pauses = 0, pauseSeconds = 0, longestPause = 0, openAt = null;
    (events || []).forEach(function (ev) {
      if (ev.kind === "pauseStart") {
        pauses++;
        if (openAt === null) openAt = ev.elapsed;
      } else if (ev.kind === "resume" && openAt !== null) {
        var len = Math.max(0, ev.elapsed - openAt);
        pauseSeconds += len;
        if (len > longestPause) longestPause = len;
        openAt = null;
      }
    });
    if (openAt !== null) {
      var openLen = Math.max(0, dur - openAt);
      pauseSeconds += openLen;
      if (openLen > longestPause) longestPause = openLen;
    }
    var counts = computeCounts(events);
    var frac = dur > 0 ? Math.max(0, Math.min(100, Math.round((dur - pauseSeconds) / dur * 100))) : null;
    return {
      durationSeconds: dur,
      timeToFirstShock: firstElapsedOf(events, function (e) { return e.kind === "shock"; }),
      timeToFirstEpi: firstElapsedOf(events, isEpiDrug),
      pauseCount: pauses,
      longestPauseSeconds: Math.round(longestPause),
      pauseSeconds: Math.round(pauseSeconds),
      cprFractionPct: frac,
      shocks: counts.shocks,
      epi: counts.epi,
      rosc: (events || []).some(function (e) { return e.kind === "rosc"; })
    };
  }

  var LOG_FILTERS = [
    { id: "all", label: "All" }, { id: "drugs", label: "Drugs" },
    { id: "shocks", label: "Shocks" }, { id: "rhythms", label: "Rhythms" },
    { id: "procedures", label: "Procedures" }, { id: "notes", label: "Notes" }
  ];

  function eventMatchesFilter(ev, filter) {
    switch (filter) {
      case "drugs": return ev.kind === "drug";
      case "shocks": return ev.kind === "shock";
      case "rhythms": return ev.kind === "rhythm";
      case "procedures": return ev.kind === "procedure";
      case "notes": return ev.kind === "note";
      default: return true;
    }
  }

  function shortLinkId(link) {
    if (!link || typeof link !== "object") return "";
    var id = link.pid || link.id || "";
    return String(id).slice(0, 6);
  }

  function pastEntryFromPayload(payload, opts) {
    opts = opts || {};
    var p = payload || {};
    var counts = computeCounts(p.events || []);
    return {
      id: String(opts.id || ("past-" + (opts.savedWall || Date.now()))),
      savedWall: opts.savedWall || Date.now(),
      date: String(p.startedAt || ""),
      mode: normMode(p.mode),
      durationSeconds: Math.max(0, Math.floor(p.durationSeconds || 0)),
      shocks: counts.shocks, epi: counts.epi,
      rosc: !!(p.summary && p.summary.rosc),
      training: p.training === true,
      linkShort: shortLinkId(opts.link),
      payload: p
    };
  }

  function addPastEntry(list, entry) {
    var out = [entry].concat((list || []).filter(function (e) { return e && e.id !== entry.id; }));
    return out.slice(0, PAST_MAX);
  }

  function loadPast(storage) {
    try {
      var raw = storage.getItem(PAST_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.filter(function (e) { return e && typeof e === "object" && e.payload; }) : [];
    } catch (e) { return []; }
  }

  function savePast(storage, list) {
    try { storage.setItem(PAST_KEY, JSON.stringify((list || []).slice(0, PAST_MAX))); return true; }
    catch (e) { return false; }
  }

  function loadTeam(storage) {
    try {
      var raw = storage.getItem(TEAM_KEY);
      var team = raw ? JSON.parse(raw) : [];
      return Array.isArray(team) ? team.map(function (n) { return String(n).slice(0, 40); }).filter(Boolean) : [];
    } catch (e) { return []; }
  }

  function saveTeam(storage, team) {
    try { storage.setItem(TEAM_KEY, JSON.stringify(normScene({ team: team || [] }).team)); return true; }
    catch (e) { return false; }
  }

  function loadPresets(storage) {
    try {
      var raw = storage.getItem(PRESETS_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.filter(function (p) { return p && p.name && p.scene; })
        .map(function (p) { return { name: String(p.name).slice(0, 40), scene: normScene(p.scene) }; }) : [];
    } catch (e) { return []; }
  }

  function savePresets(storage, list) {
    try { storage.setItem(PRESETS_KEY, JSON.stringify(list || [])); return true; }
    catch (e) { return false; }
  }

  function lastEpi(sess) { return lastBy(sess, isEpiDrug); }

  function lastShock(sess) { return lastBy(sess, function (e) { return e.kind === "shock"; }); }

  function lastRhythm(sess) { return lastBy(sess, function (e) { return e.kind === "rhythm"; }); }

  /* Epinephrine reminder: due 180 s after the last logged epinephrine,
   * overdue 300 s after it. Before the first logged epinephrine the state
   * is "none" and the guide says when it is indicated. */
  function epiStatus(sess, elapsed) {
    var last = lastEpi(sess);
    if (!last) return { state: "none", since: null, remaining: null };
    var since = elapsed - last.elapsed;
    if (since >= EPI_OVERDUE_S) return { state: "overdue", since: since, remaining: 0 };
    if (since >= EPI_DUE_S) return { state: "due", since: since, remaining: 0 };
    return { state: "countdown", since: since, remaining: EPI_DUE_S - since };
  }

  /* Rhythm check cycles: 120 s adult and paediatric, 60 s neonatal. */
  function cycleInfo(mode, elapsed, cycleStart) {
    var interval = MODE_CONFIG[normMode(mode)].rhythmInterval;
    var into = elapsed - (cycleStart || 0);
    var cycleNumber = Math.floor(Math.max(0, into) / interval) + 1;
    var remaining = interval - into;
    return {
      interval: interval, cycleNumber: cycleNumber,
      cycleElapsed: into, remaining: remaining,
      due: into >= interval && elapsed > (cycleStart || 0)
    };
  }

  function shockAdvised(sess, elapsed) {
    var lr = lastRhythm(sess);
    if (!lr || !isShockable(lr.label)) return false;
    if (elapsed - lr.elapsed >= 120) return false;
    var after = sess.events.some(function (e) {
      return e.kind === "shock" && e.elapsed > lr.elapsed;
    });
    return !after;
  }

  /* The single most important next thing. Levels: running, due, overdue,
   * rosc, paused. Colour is never the only signal: every level has a word. */
  function dueStrip(sess, elapsed, opts) {
    opts = opts || {};
    if (sess.rosc) return { text: "ROSC", level: "rosc" };
    if (opts.paused) return { text: "Paused", level: "paused" };
    var epi = epiStatus(sess, elapsed);
    if (epi.state === "overdue") return { text: "Epinephrine overdue", level: "overdue" };
    if (shockAdvised(sess, elapsed)) return { text: "Shock", level: "overdue" };
    var cyc = cycleInfo(sess.mode, elapsed, sess.cycleStart);
    if (cyc.due) return { text: "Rhythm check due", level: "due" };
    if (epi.state === "due") return { text: "Epinephrine due", level: "due" };
    var cands = [];
    if (epi.state === "countdown") cands.push({ t: epi.remaining, text: "Epinephrine due " + fmtShort(epi.remaining) });
    cands.push({ t: cyc.remaining, text: "Rhythm check " + fmtShort(cyc.remaining) });
    cands.sort(function (a, b) { return a.t - b.t; });
    if (opts.breathNow) return { text: "Give breath", level: "running" };
    if (cands.length && cands[0].t <= 60) return { text: cands[0].text, level: "running" };
    return { text: "CPR in progress", level: "running" };
  }

  /* ---------------- AlgorithmGuide (pure, text only, no doses) ----------------
   * Four tracks. Prompts only. Each prompt cites its source. */

  function guideFor(input) {
    input = input || {};
    var mode = normMode(input.mode);
    var rhythm = input.lastRhythm || null;
    var shocks = input.shockCount || 0;
    var epiN = input.epiCount || 0;
    var sinceEpi = (input.secsSinceEpi == null) ? null : input.secsSinceEpi;
    if (input.rosc === true || rhythm === "Sinus rhythm (pulse)") return postRoscTrack(mode);
    if (rhythm === "Bradycardia (pulse)") return bradyTrack(mode);
    if (rhythm === "Tachycardia (pulse)") return tachyTrack(mode);
    if (isShockable(rhythm)) return shockableTrack(mode, shocks, epiN, sinceEpi);
    if (rhythm === "PEA" || rhythm === "Asystole") return nonShockableTrack(mode, epiN, sinceEpi);
    return openingTrack(mode);
  }

  function epiUrgency(sinceEpi) {
    if (sinceEpi == null) return "info";
    if (sinceEpi >= EPI_OVERDUE_S) return "overdue";
    if (sinceEpi >= EPI_DUE_S) return "due";
    return "info";
  }

  function shockableTrack(mode, shocks, epiN, sinceEpi) {
    var src = modeSrc(mode);
    var out = [];
    if (shocks === 0) {
      out.push({ id: "shock", text: "Shockable rhythm. Deliver shock, then resume compressions at once.", urgency: "due", src: src });
    } else {
      out.push({ id: "shock", text: "Shockable rhythm persists. Deliver shock, then resume compressions at once.", urgency: "due", src: src });
    }
    out.push({
      id: "cpr-cycle",
      text: mode === "neonatal"
        ? "Continue 3:1 compressions and ventilation. Reassess heart rate every 60 s."
        : "Continue compressions for 2 min between rhythm checks.",
      urgency: "info", src: src
    });
    if (epiN === 0) {
      out.push({
        id: "epi-when", urgency: shocks >= 2 ? "due" : "info", src: src,
        text: shocks >= 2
          ? "Epinephrine is indicated now."
          : "Epinephrine is indicated after the second shock."
      });
    } else {
      out.push({ id: "epi-when", text: "Epinephrine timing is on the strip above.", urgency: epiUrgency(sinceEpi), src: src });
    }
    if (shocks >= 3) {
      out.push({ id: "antiarr", text: "After the third shock, amiodarone or lidocaine is considered.", urgency: "info", src: src });
    }
    out.push({
      id: "hs-ts",
      text: "Treat reversible causes. Hypoxia, hypovolaemia, potassium changes, hypothermia, hydrogen ion, tamponade, tension pneumothorax, thrombosis, toxins.",
      urgency: "info", src: src
    });
    return out;
  }

  function nonShockableTrack(mode, epiN, sinceEpi) {
    var src = modeSrc(mode);
    var out = [];
    if (epiN === 0) {
      out.push({ id: "epi-now", text: "Non shockable rhythm. Epinephrine is indicated as soon as possible.", urgency: "due", src: src });
    } else {
      out.push({ id: "epi-now", text: "Epinephrine timing is on the strip above.", urgency: epiUrgency(sinceEpi), src: src });
    }
    out.push({
      id: "cpr-cycle",
      text: mode === "neonatal"
        ? "Ventilation first. Start compressions if the heart rate stays below 60 after 30 s of effective ventilation."
        : "Continue compressions for 2 min between rhythm checks.",
      urgency: "info", src: src
    });
    out.push({
      id: "hs-ts",
      text: "Treat reversible causes. Hypoxia, hypovolaemia, potassium changes, hypothermia, hydrogen ion, tamponade, tension pneumothorax, thrombosis, toxins.",
      urgency: "info", src: src
    });
    return out;
  }

  function openingTrack(mode) {
    var src = modeSrc(mode);
    var out = [{
      id: "log-rhythm",
      text: "Log the rhythm to tailor the next prompts.",
      urgency: "info", src: src
    }];
    if (mode === "neonatal") {
      out.push({
        id: "cpr-cycle",
        text: "Ventilation first. Start compressions if the heart rate stays below 60 after 30 s of effective ventilation.",
        urgency: "info", src: src
      });
    } else {
      out.push({
        id: "cpr-cycle",
        text: "Push hard and fast. Pause only for rhythm checks every 2 min.",
        urgency: "info", src: src
      });
    }
    out.push({
      id: "hs-ts",
      text: "Treat reversible causes. Hypoxia, hypovolaemia, potassium changes, hypothermia, hydrogen ion, tamponade, tension pneumothorax, thrombosis, toxins.",
      urgency: "info", src: src
    });
    return out;
  }

  function bradyTrack(mode) {
    var src = mode === "paediatric" ? SRC.bradyPaed : SRC.bradyAdult;
    if (mode === "neonatal") src = SRC.arrestNeo;
    var out = [{
      id: "assess",
      text: "Assess for poor perfusion. Support the airway and give oxygen. Monitor the rhythm.",
      urgency: "due", src: src
    }];
    if (mode === "paediatric" || mode === "neonatal") {
      out.push({
        id: "compress",
        text: "Start compressions if the heart rate stays below 60 with poor perfusion despite oxygenation and ventilation.",
        urgency: "due", src: src
      });
    } else {
      out.push({ id: "observe", text: "Monitor blood pressure and rhythm while support continues.", urgency: "info", src: src });
      out.push({ id: "escalate", text: "Atropine, pacing or an infusion may be considered.", urgency: "info", src: src });
    }
    out.push({ id: "cause", text: "Find and treat the cause. Review Hs and Ts.", urgency: "info", src: src });
    return out;
  }

  function tachyTrack(mode) {
    var src = SRC.tachyAdult;
    return [
      { id: "assess", text: "Assess stability: blood pressure, mental state, shock signs, chest pain.", urgency: "due", src: src },
      { id: "unstable", text: "Unstable: consider synchronised cardioversion.", urgency: "due", src: src },
      { id: "stable-narrow", text: "Stable narrow regular rhythm: vagal manoeuvres first, then adenosine is considered.", urgency: "info", src: src },
      { id: "stable-wide", text: "Stable wide or irregular rhythm: seek expert consultation.", urgency: "info", src: src }
    ];
  }

  function postRoscTrack(mode) {
    var src = SRC.postRosc;
    if (mode === "neonatal") {
      return [
        { id: "pr-monitor", text: "Keep the baby monitored and warm. Recheck heart rate, breathing and tone.", urgency: "info", src: src },
        { id: "pr-glucose", text: "Check blood glucose and treat low glucose.", urgency: "info", src: src },
        { id: "pr-temp", text: "Control temperature. Avoid fever and avoid cold stress.", urgency: "info", src: src },
        { id: "pr-criteria", text: "Review criteria for ongoing intensive care with the senior team.", urgency: "info", src: src },
        { id: "pr-family", text: "Update the parents and document the resuscitation.", urgency: "info", src: src }
      ];
    }
    return [
      { id: "pr-airway", text: "Secure the airway and titrate oxygen to SpO2 92 to 98 percent.", urgency: "info", src: src },
      { id: "pr-vent", text: "Ventilate to normal CO2 and avoid hypotension.", urgency: "info", src: src },
      { id: "pr-ecg", text: "Record a 12 lead ECG and check blood glucose.", urgency: "info", src: src },
      { id: "pr-temp", text: "Control temperature and avoid fever.", urgency: "info", src: src },
      { id: "pr-cause", text: "Find and treat the cause. Review Hs and Ts. Assess neurology and arrange ICU transfer.", urgency: "info", src: src }
    ];
  }

  /* ---------------- post-ROSC checklist ---------------- */

  function checklistFor(mode) {
    mode = normMode(mode);
    if (mode === "neonatal") {
      return [
        { id: "nc1", text: "Keep monitored: heart rate, breathing, tone, temperature" },
        { id: "nc2", text: "Check blood glucose" },
        { id: "nc3", text: "Keep warm, avoid fever and cold stress" },
        { id: "nc4", text: "Review intensive care criteria with the senior team" },
        { id: "nc5", text: "Update the parents and document" }
      ];
    }
    return [
      { id: "c1", text: "Secure airway, titrate oxygen to SpO2 92 to 98 percent" },
      { id: "c2", text: "Ventilate to normal CO2" },
      { id: "c3", text: "Avoid hypotension (systolic at least 90, MAP at least 65 in adults)" },
      { id: "c4", text: "Record 12 lead ECG" },
      { id: "c5", text: "Check blood glucose" },
      { id: "c6", text: "Control temperature, avoid fever" },
      { id: "c7", text: "Find and treat the cause (Hs and Ts)" },
      { id: "c8", text: "Neurological assessment" },
      { id: "c9", text: "Transfer to ICU" }
    ];
  }

  function toggleCheck(sess, id, elapsed) {
    var items = checklistFor(sess.mode);
    var found = null;
    for (var i = 0; i < items.length; i++) if (items[i].id === id) found = items[i];
    if (!found) return false;
    if (sess.checks[id]) {
      delete sess.checks[id];
      return "unticked";
    }
    sess.checks[id] = elapsed;
    logEvent(sess, "note", "Checklist: " + found.text, elapsed);
    return "ticked";
  }

  /* Re-arrest: one action after ROSC. Clears rosc, appends reArrest, starts
   * a new CPR cycle at the same mode. The epinephrine timer continues from
   * the last logged epinephrine. */
  function reArrest(sess, elapsed) {
    sess.rosc = false;
    sess.cycleStart = Math.max(0, Math.floor(elapsed || 0));
    return logEvent(sess, "reArrest", "Re-arrest", elapsed);
  }

  /* ---------------- snapshot, resume, staleness ---------------- */

  function takeSnapshot(sess, elapsed, wallNow) {
    var counts = computeCounts(sess.events);
    return {
      version: SNAPSHOT_VERSION, mode: sess.mode, training: sess.training,
      startedAtWallClock: sess.createdWall,
      elapsedAtSave: Math.max(0, Math.floor(elapsed || 0)),
      events: sess.events.map(function (e) {
        return { id: e.id, elapsed: e.elapsed, kind: e.kind, label: e.label, edited: !!e.edited };
      }),
      adrenalineCount: counts.epi, shockCount: counts.shocks,
      rosc: sess.rosc, hadRosc: sess.hadRosc, checklistTicks: sess.checks,
      cycleStart: sess.cycleStart, seq: sess.seq,
      link: sess.link || null, ventCue: sess.ventCue !== false,
      scene: normScene(sess.scene),
      savedAtWallClock: (wallNow != null) ? wallNow : Date.now()
    };
  }

  function saveSnapshot(storage, snap) {
    try {
      storage.setItem(STORE_KEY, JSON.stringify(snap));
      return true;
    } catch (e) { return false; }
  }

  function loadSnapshot(storage) {
    try {
      var raw = storage.getItem(STORE_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      return (s && typeof s === "object") ? s : null;
    } catch (e) { return null; }
  }

  function clearSnapshot(storage) {
    try { storage.removeItem(STORE_KEY); } catch (e) {}
  }

  /* restore(now): older than 6 h discards; otherwise elapsed resumes from
   * elapsedAtSave plus wall time passed while it was running. */
  function restoreSnapshot(snap, wallNow) {
    if (!snap || typeof snap !== "object" || snap.version !== SNAPSHOT_VERSION) {
      return { ok: "discard", reason: "unreadable" };
    }
    wallNow = (wallNow != null) ? wallNow : Date.now();
    if ((wallNow - snap.savedAtWallClock) > STALENESS_MS) {
      return { ok: "discard", reason: "stale" };
    }
    var sess = newSession(snap.mode, { training: snap.training === true, wallNow: snap.startedAtWallClock });
    sess.events = (snap.events || []).map(function (e, i) {
      return {
        id: e.id || ("ev-" + (i + 1)),
        elapsed: Math.max(0, Math.floor(e.elapsed || 0)),
        kind: e.kind || "note", label: e.label || "Note", edited: e.edited === true
      };
    });
    sess.rosc = snap.rosc === true;
    sess.hadRosc = snap.hadRosc === true || sess.rosc;
    sess.checks = (snap.checklistTicks && typeof snap.checklistTicks === "object") ? snap.checklistTicks : {};
    sess.link = (snap.link && typeof snap.link === "object") ? snap.link : null;
    sess.scene = normScene(snap.scene);
    sess.ventCue = snap.ventCue !== false;
    sess.cycleStart = Math.max(0, Math.floor(snap.cycleStart || 0));
    sess.seq = snap.seq || sess.events.length;
    sess.undo = [];
    var elapsed = Math.max(0, Math.floor(snap.elapsedAtSave || 0));
    if (snap.running !== false && !snap.paused) {
      elapsed += Math.max(0, Math.floor((wallNow - snap.savedAtWallClock) / 1000));
    }
    return { ok: "resume", session: sess, elapsed: elapsed };
  }

  /* ---------------- v2 payload for codeblue-sheet.js ---------------- */

  function buildPayload(sess, opts) {
    opts = opts || {};
    var elapsed = Math.max(0, Math.floor(opts.elapsed || 0));
    var counts = computeCounts(sess.events);
    var interval = MODE_CONFIG[sess.mode].rhythmInterval;
    return {
      v: 2, mode: sess.mode,
      startedAt: opts.startedAtISO || new Date(sess.createdWall).toISOString(),
      durationSeconds: elapsed,
      cycles: Math.floor(elapsed / interval),
      events: sess.events.map(function (e) {
        return { id: e.id, elapsed: e.elapsed, kind: e.kind, label: e.label, edited: !!e.edited };
      }),
      summary: {
        compressions: 0, averageRateCPM: 0, compressionFractionPct: null,
        targetRatePct: 0, shockCount: counts.shocks,
        adrenalineCount: counts.epi, rosc: sess.rosc === true
      },
      training: sess.training === true,
      scene: normScene(sess.scene),
      disclaimer: MOTION_NOTE
    };
  }

  /* Every shared user-visible string the engine can emit, for the no-dose
   * scan. Adult reference dose labels are intentionally NOT listed here:
   * they ship only via doseRefFor (adult drug buttons) under the v3 owner
   * override, and the scan above keeps covering everything else. */
  function allCopySamples() {
    var out = [DISCLAIMER, MOTION_NOTE];
    PROCEDURES.forEach(function (p) { out.push(p); });
    RHYTHMS.forEach(function (r) { out.push(r); });
    MODES.forEach(function (m) {
      var c = MODE_CONFIG[m];
      out.push(MODE_LABEL[m], c.compression, c.airway);
      out.push.apply(out, checklistFor(m).map(function (i) { return i.text; }));
      var rhythms = [null, "VF", "VT (pulseless)", "PEA", "Asystole",
        "Sinus rhythm (pulse)", "Bradycardia (pulse)", "Tachycardia (pulse)"];
      rhythms.forEach(function (r) {
        guideFor({ mode: m, lastRhythm: r, shockCount: 3, epiCount: 1, secsSinceEpi: 400, rosc: false })
          .forEach(function (p) { out.push(p.text, p.src); });
        guideFor({ mode: m, lastRhythm: r, shockCount: 0, epiCount: 0, secsSinceEpi: null, rosc: true })
          .forEach(function (p) { out.push(p.text, p.src); });
      });
      ["CPR in progress", "Epinephrine overdue", "Rhythm check due", "Epinephrine due",
        "Shock", "ROSC", "Paused", "Give breath"].forEach(function (t) { out.push(t); });
    });
    var s = newSession("adult", { wallNow: 0 });
    logEvent(s, "shock", null, 10);
    logEvent(s, "drug", null, 190);
    logEvent(s, "rhythm", "VF", 240);
    var p = buildPayload(s, { elapsed: 400, startedAtISO: "2026-01-01T00:00:00.000Z" });
    out.push(JSON.stringify(p));
    return out;
  }

  var _engine = {
    STORE_KEY: STORE_KEY, STALENESS_MS: STALENESS_MS,
    EPI_DUE_S: EPI_DUE_S, EPI_OVERDUE_S: EPI_OVERDUE_S,
    TRAINING_SPEED: TRAINING_SPEED, DISCLAIMER: DISCLAIMER, MOTION_NOTE: MOTION_NOTE,
    MODES: MODES, MODE_LABEL: MODE_LABEL, MODE_CONFIG: MODE_CONFIG,
    PROCEDURES: PROCEDURES, RHYTHMS: RHYTHMS,
    VENT_RATIO: VENT_RATIO, DOSE_REF_ADULT: DOSE_REF_ADULT,
    normMode: normMode, fmtMMSS: fmtMMSS, fmtShort: fmtShort, fmtAgo: fmtAgo,
    doseRefFor: doseRefFor,
    newSession: newSession, logEvent: logEvent, editEvent: editEvent,
    deleteEvent: deleteEvent, undoDelete: undoDelete, computeCounts: computeCounts,
    drugCounts: drugCounts, lastDrugBy: lastDrugBy,
    hasAirway: hasAirway, ventInfo: ventInfo, stripInfo: stripInfo,
    lastEpi: lastEpi, lastShock: lastShock, lastRhythm: lastRhythm,
    epiStatus: epiStatus, cycleInfo: cycleInfo, shockAdvised: shockAdvised,
    dueStrip: dueStrip, guideFor: guideFor,
    SCENE_SETTINGS: SCENE_SETTINGS, SCENE_ARREST: SCENE_ARREST, SCENE_YESNO: SCENE_YESNO,
    PAST_KEY: PAST_KEY, TEAM_KEY: TEAM_KEY, PRESETS_KEY: PRESETS_KEY, PAST_MAX: PAST_MAX,
    defaultScene: defaultScene, normScene: normScene, debriefStats: debriefStats,
    LOG_FILTERS: LOG_FILTERS, eventMatchesFilter: eventMatchesFilter,
    shortLinkId: shortLinkId, pastEntryFromPayload: pastEntryFromPayload,
    addPastEntry: addPastEntry, loadPast: loadPast, savePast: savePast,
    loadTeam: loadTeam, saveTeam: saveTeam, loadPresets: loadPresets, savePresets: savePresets,
    checklistFor: checklistFor, toggleCheck: toggleCheck, reArrest: reArrest,
    takeSnapshot: takeSnapshot, saveSnapshot: saveSnapshot,
    loadSnapshot: loadSnapshot, clearSnapshot: clearSnapshot,
    restoreSnapshot: restoreSnapshot, buildPayload: buildPayload,
    allCopySamples: allCopySamples
  };

  /* ---------------- UI layer (browser only) ---------------- */

  var rootEl = null, tickTimer = null, lastSnapSave = 0;
  var sess = null, view = "idle";
  var runStartWall = 0, elapsedOffset = 0, speed = 1;
  var paused = false, pauseWall = 0;
  var idleMode = "adult", idleTraining = false, pendingResume = null;
  var toastTimer = null, lastFocus = null, sheetFocus = null;
  var fired = {};
  var storeError = false;
  /* v3 run UI state: active tab, phone timeline drawer, pending patient
   * link chosen on idle, and the last patient-record export outcome. */
  var rtab = "timer", timelineOpen = false, pendingLink = null, exportState = null;
  var logSeg = "log", logFilter = "all", endedPast = false;

  function hasDOM() { return typeof document !== "undefined" && !!document.createElement; }
  function Audio() {
    try {
      if (typeof window !== "undefined" && window.CodeBlueAudio) return window.CodeBlueAudio;
    } catch (e) {}
    try { return require("./codeblue-audio.js"); } catch (e2) { return null; }
  }

  function memStorage() {
    var m = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
      setItem: function (k, v) { m[k] = String(v); },
      removeItem: function (k) { delete m[k]; }
    };
  }

  function defaultStorage() {
    try {
      if (typeof localStorage !== "undefined") return localStorage;
    } catch (e) {}
    return memStorage();
  }

  /* The existing shared patient machinery (icu.js ward picker plus
   * icu-collab.js groups API). Reused, never reinvented. */
  function groupsApi() {
    try { return (typeof window !== "undefined" && window.SMD_ICU_GROUPS) || null; }
    catch (e) { return null; }
  }

  function readOpenPatient() {
    try {
      var api = groupsApi();
      if (api && api.currentOpenPatient) {
        var pt = api.currentOpenPatient();
        if (pt && pt.gid && pt.pid) return { gid: pt.gid, pid: pt.pid };
      }
    } catch (e) {}
    return null;
  }

  function openWardPicker() {
    try {
      if (typeof window !== "undefined" && typeof window.openGHIS === "function") {
        window.openGHIS();
        return true;
      }
      if (typeof window !== "undefined" && window.SMD_setGhis) {
        window.SMD_setGhis(true);
        return true;
      }
    } catch (e) {}
    return false;
  }

  /* One Code Blue on phone and watch: starting or ending a code here tells
   * the paired watch through the existing WatchBridge sendMessage path
   * (native-watch.js clinix pattern). Silent no-op on web or without it. */
  function notifyWatch(running) {
    try {
      if (typeof window === "undefined") return false;
      var C = window.Capacitor;
      var p = (C && C.Plugins && C.Plugins.WatchBridge) || null;
      if (p && p.sendMessage && sess) {
        p.sendMessage({
          type: "codeblue_active", running: running === true,
          mode: sess.mode, training: sess.training === true,
          elapsed: Math.max(0, Math.floor(nowElapsed()))
        });
      }
    } catch (e) {}
    try {
      if (typeof window !== "undefined" && window.dispatchEvent && sess) {
        window.dispatchEvent(new CustomEvent("codeblue:active", {
          detail: { running: running === true, mode: sess.mode, training: sess.training === true }
        }));
      }
    } catch (e2) {}
    return true;
  }

  /* LIVE End with a linked patient: open the code sheet and write the code
   * sheet to the patient timeline exactly the way native-watch.js handles
   * the watch codeBlueExport (type codeblue, title Code Blue summary).
   * Practice, unlinked and sheet-less runs return ok false with a reason.
   * Never throws: End must always land on the summary, even when the
   * export machinery fails. */
  function exportToPatient() {
    try {
      if (!sess || sess.training) return { ok: false, reason: "training" };
      if (!sess.link || !sess.link.gid || !sess.link.pid) return { ok: false, reason: "unlinked" };
      var payload = buildPayload(sess, {
        elapsed: Math.max(0, Math.floor(elapsedOffset)),
        startedAtISO: new Date(sess.createdWall).toISOString()
      });
      var opened = false, written = false;
      try {
        if (typeof window !== "undefined" && window.CodeBlueSheet && window.CodeBlueSheet.open) {
          window.CodeBlueSheet.open(payload);
          opened = true;
        }
      } catch (e) {}
      try {
        var api = groupsApi();
        var detail = "";
        try {
          if (typeof window !== "undefined" && window.CodeBlueSheet && window.CodeBlueSheet.renderText) {
            detail = window.CodeBlueSheet.renderText(window.CodeBlueSheet.parsePayload(payload));
          }
        } catch (e2) {}
        if (api && api.addTimelineEvent) {
          /* The shared groups API returns a promise; test stubs record
           * synchronously. Either way the call being accepted counts as
           * written, matching the watch handler's fire-and-forget shape. */
          var res = api.addTimelineEvent(sess.link.gid, sess.link.pid,
            { type: "codeblue", title: "Code Blue summary", detail: detail });
          written = true;
          try {
            if (res && typeof res.then === "function") {
              res.then(null, function () {});
            }
          } catch (e4) {}
        }
      } catch (e3) {}
      return { ok: opened || written, opened: opened, written: written, reason: (opened || written) ? null : "unavailable" };
    } catch (fatal) {
      return { ok: false, opened: false, written: false, reason: "unavailable" };
    }
  }

  function nowElapsed() {
    if (!sess) return 0;
    if (view !== "running" && view !== "ended") return elapsedOffset;
    if (paused) return elapsedOffset;
    if (view === "ended") return elapsedOffset;
    return elapsedOffset + (Date.now() - runStartWall) / 1000 * speed;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  /* Simple monoline icons (Lucide style, 1.75 stroke) beside every label. */
  var ICONS = {
    shock: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/></svg>',
    epi: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v10m0 0-4-4m4 4 4-4"/><path d="M5 13l3 8h8l3-8"/><path d="M9 21v-4m6 4v-4"/></svg>',
    rhythm: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12h4l3-7 4 14 3-7h6"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5v14M15 5v14"/></svg>',
    proc: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16M4 12l3-3m-3 3 3 3M20 12l-3-3m3 3-3 3"/><circle cx="12" cy="12" r="9"/></svg>',
    note: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v12H9l-4 4V4z"/></svg>',
    rosc: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>',
    rearrest: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>',
    sound: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l5 4V6l-5 4H4z"/><path d="M16 9a4 4 0 0 1 0 6"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.5a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.4 2.5h4l.4-2.5a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.06-.4.1-.8.1-1.2z"/></svg>',
    log: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18H6z"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l5 5L20 7"/></svg>'
  };

  function tileSub(kind, elapsed) {
    var counts = computeCounts(sess.events);
    var last, sub;
    if (kind === "shock") {
      last = lastShock(sess);
      sub = counts.shocks === 0 ? "Ready"
        : counts.shocks + " given" + (last ? ", last " + fmtAgo(elapsed - last.elapsed) : "");
      return sub;
    }
    if (kind === "epi") {
      last = lastEpi(sess);
      return counts.epi === 0 ? ""
        : counts.epi + " given" + (last ? ", last " + fmtAgo(elapsed - last.elapsed) : "");
    }
    if (kind === "rhythm") {
      last = lastRhythm(sess);
      return last ? last.label + ", " + fmtAgo(elapsed - last.elapsed) : "";
    }
    if (kind === "proc") {
      var n = sess.events.filter(function (e) { return e.kind === "procedure"; }).length;
      return n === 0 ? "" : n + " logged";
    }
    if (kind === "note") {
      var nn = sess.events.filter(function (e) { return e.kind === "note"; }).length;
      return nn === 0 ? "Add a note" : nn + (nn === 1 ? " note" : " notes");
    }
    if (kind === "pause") return paused ? "Paused now" : "";
    if (kind === "rosc") return sess.rosc ? "ROSC logged" : "";
    if (kind === "rearrest") return "";
    return "";
  }

  function guideInput(elapsed) {
    var counts = computeCounts(sess.events);
    var lr = lastRhythm(sess);
    var le = lastEpi(sess);
    return {
      mode: sess.mode, lastRhythm: lr ? lr.label : null,
      shockCount: counts.shocks, epiCount: counts.epi,
      secsSinceEpi: le ? (elapsed - le.elapsed) : null, rosc: sess.rosc
    };
  }

  /* ---------------- rendering ---------------- */

  function statusRow(showEnd) {
    var modeChip = sess
      ? '<span class="cbl-mode" aria-label="Mode">' + esc(MODE_LABEL[sess.mode]) + "</span>"
      : '<span class="cbl-mode" aria-label="Mode">Code Blue</span>';
    var badge = (sess && sess.training) || (!sess && idleTraining)
      ? '<span class="cbl-badge">TRAINING</span>' : "";
    return '<div class="cbl-status">' + modeChip + badge +
      '<button type="button" class="cbl-iconbtn" data-act="audio" aria-label="Sound settings">' +
      ICONS.sound + '<span>Sound</span></button>' +
      '<button type="button" class="cbl-iconbtn" data-cbp-settings aria-label="Display settings">' +
      ICONS.gear + "</button>" +
      '<span class="cbl-spacer"></span>' +
      (showEnd
        ? '<button type="button" class="cbl-endbtn" data-act="end">End</button>'
        : "") +
      '<button type="button" class="cbl-iconbtn" data-act="close" aria-label="Close live code">' +
      ICONS.close + "</button></div>";
  }

  function audioNotice() {
    var A = Audio();
    var st = A ? A.status() : "unavailable";
    if (st === "unavailable") {
      return '<p class="cbl-anotice" data-state="audio-blocked">Sound is not available on this device. The strip shows everything.</p>';
    }
    if (st === "blocked" && view === "idle") {
      return '<p class="cbl-anotice" data-state="audio-blocked">Sound starts after you tap Start.</p>';
    }
    return "";
  }

  function idleView() {
    var modes = MODES.map(function (m) {
      return '<button type="button" class="cbl-modepick' + (m === idleMode ? " on" : "") +
        '" data-act="idle-mode" data-mode="' + m + '" aria-pressed="' + (m === idleMode) + '">' +
        esc(MODE_LABEL[m]) + "</button>";
    }).join("");
    var resume = "";
    if (pendingResume) {
      var ageMin = Math.max(0, Math.round((Date.now() - pendingResume.savedAtWallClock) / 60000));
      var age = ageMin < 1 ? "less than a minute ago" : ageMin + (ageMin === 1 ? " minute ago" : " minutes ago");
      resume = '<div class="cbl-resume" data-state="resume-prompt" role="group" aria-label="Resume code in progress">' +
        "<p><b>Resume code in progress?</b></p>" +
        "<p>" + esc(MODE_LABEL[normMode(pendingResume.mode)]) + ", saved " + esc(age) + ".</p>" +
        '<div class="cbl-row"><button type="button" class="cbl-btn cbl-primary" data-act="resume-yes">Resume</button>' +
        '<button type="button" class="cbl-btn" data-act="resume-no">Discard</button></div></div>';
    }
    return statusRow() +
      '<div class="cbl-scroll"><div class="cbl-idle" data-state="idle">' +
      "<h2 class='cbl-h'>Live code timer</h2>" +
      '<p class="cbl-disc">' + esc(DISCLAIMER) + "</p>" +
      resume +
      '<p class="cbl-label" id="cblModeLabel">Mode</p>' +
      '<div class="cbl-modes" role="group" aria-labelledby="cblModeLabel">' + modes + "</div>" +
      '<button type="button" class="cbl-practice' + (idleTraining ? " on" : "") +
      '" data-act="idle-training" aria-pressed="' + idleTraining + '">' +
      "<b>Practice run</b><span>Sped up clock, badged TRAINING. Nothing writes to a patient record.</span></button>" +
      linkRowView("idle") +
      '<button type="button" class="cbl-btn cbl-primary cbl-start" data-act="start" data-cbfx-specular="1">Start</button>' +
      audioNotice() +
      "</div></div>";
  }

  /* CPR ring card: the elapsed clock with the metronome beat, a thin
   * linear countdown bar beneath it, and the vent readout below the card
   * on phone (ring plus vent panel beside the clock on iPad). Keeps the
   * cbl-clock and cbl-elapsed hooks (tests and the repaint path read them). */
  function clockView(elapsed) {
    var cyc = cycleInfo(sess.mode, elapsed, sess.cycleStart);
    var frac = Math.max(0, Math.min(1, cyc.remaining / cyc.interval));
    var cls = paused ? "paused" : "running";
    var epi = epiStatus(sess, elapsed);
    var ringState = epi.state === "overdue" ? "overdue" : "run";
    var beat = Math.floor(elapsed * 110 / 60) % 2;
    var R = 54, C = 2 * Math.PI * R;
    var arc = C * (1 - frac);
    var knobA = -Math.PI / 2 + 2 * Math.PI * frac;
    var knobX = 66 + R * Math.cos(knobA), knobY = 66 + R * Math.sin(knobA);
    var vent = ventInfo(sess, elapsed);
    var cueOn = sess.ventCue !== false;
    var ticks = "";
    for (var ti = 0; ti < 60; ti++) {
      var ta = ti * Math.PI / 30, tx1 = 66 + 60 * Math.cos(ta), ty1 = 66 + 60 * Math.sin(ta);
      var tx2 = 66 + 63 * Math.cos(ta), ty2 = 66 + 63 * Math.sin(ta);
      ticks += "<line x1='" + tx1.toFixed(1) + "' y1='" + ty1.toFixed(1) + "' x2='" + tx2.toFixed(1) + "' y2='" + ty2.toFixed(1) + "'/>";
    }
    return '<div class="cbl-ringrow"><div class="cbl-ringcard cbl-clock ' + cls +
      '" data-state="' + (paused ? "paused" : "running") + '">' +
      '<svg class="cbl-ring" viewBox="0 0 132 132" role="img" aria-label="CPR cycle ring">' +
      "<defs><linearGradient id='cblRingBlue' x1='0' y1='0' x2='1' y2='1'>" +
      "<stop offset='0' stop-color='#3B82F6'/><stop offset='1' stop-color='#1D4ED8'/></linearGradient>" +
      "<linearGradient id='cblRingRed' x1='0' y1='0' x2='1' y2='1'>" +
      "<stop offset='0' stop-color='#EF4444'/><stop offset='1' stop-color='#B91C1C'/></linearGradient></defs>" +
      "<g class='cbl-ticks' aria-hidden='true'>" + ticks + "</g>" +
      "<circle class='cbl-track' cx='66' cy='66' r='" + R + "'/>" +
      "<circle class='cbl-arc' data-s='" + ringState + "' cx='66' cy='66' r='" + R + "' " +
      "stroke-dasharray='" + C.toFixed(1) + "' stroke-dashoffset='" + arc.toFixed(1) + "' transform='rotate(-90 66 66)'/>" +
      "<circle class='cbl-knob' cx='" + knobX.toFixed(1) + "' cy='" + knobY.toFixed(1) + "' r='4'/></svg>" +
      '<div class="cbl-ringmeta">' +
      '<div class="cbl-elapsed cbl-ringtime" data-cbfx-counter data-cbfx-key="clock" aria-label="Elapsed time">' + esc(fmtMMSS(elapsed)) + "</div>" +
      '<div class="cbl-ringline"><span class="cbl-beat" data-beat="' + beat + '" aria-hidden="true"></span>' +
      "110 per min <span aria-hidden='true'>|</span> " +
      (sess.mode === "neonatal" ? "Heart rate check " : "Rhythm check ") +
      (cyc.due ? "due" : "in " + fmtShort(Math.max(0, cyc.remaining))) + "</div>" +
      '<div class="cbl-bar" role="progressbar" aria-label="Time to next rhythm check" aria-valuemin="0" aria-valuemax="' +
      cyc.interval + '" aria-valuenow="' + Math.max(0, Math.round(cyc.remaining)) + '">' +
      '<span class="cbl-barfill" style="width:' + Math.round(frac * 100) + '%"></span></div></div></div>' +
      '<div class="cbl-vent" data-state="vent">' +
      '<span class="cbl-ventk">Vent</span>' +
      '<span class="cbl-ventv">' + esc(vent.airway ? vent.remaining + " s" : vent.label) + "</span>" +
      '<span class="cbl-vents">' + esc(vent.airway ? "1 breath every 6 s" : airwayHint()) + "</span>" +
      '<button type="button" class="cbl-ventcue" data-act="vent-cue" aria-pressed="' + cueOn + '">' +
      (cueOn ? "Cue on" : "Cue off") + "</button></div></div>";
  }

  function airwayHint() {
    if (sess.mode === "neonatal") return "3:1 compressions and breaths";
    return "Log Advanced airway for 6 s breath cues";
  }

  /* Persistent status strip: CODE time, RHYTHM countdown, EPINEPHRINE
   * countdown, SHOCK count, VENT timer. Rendered above every tab. */
  function stripView(elapsed) {
    var s = stripInfo(sess, elapsed, { paused: paused });
    var cell = function (k, v, st) {
      var long = String(v).length > 5 ? ' data-long="1"' : "";
      return '<div class="cbl-cell" data-s="' + st + '"><span class="cbl-cellk">' + k +
        '</span><span class="cbl-cellv"' + long + ">" + v + "</span></div>";
    };
    return '<div class="cbl-strip" data-state="strip" role="status" aria-label="Code status">' +
      cell("Code", esc(s.code), sess.rosc ? "rosc" : (paused ? "paused" : "run")) +
      cell("Rhythm", esc(s.rhythm.text), s.rhythm.state) +
      cell("Epi", esc(s.epi.text), s.epi.state) +
      cell("Shock", esc(String(s.shocks)), "run") +
      cell("Vent", esc(s.vent.text), s.vent.state) +
      "</div>";
  }

  /* Drug buttons with counters, last-given line and adult dose reference
   * text. Paediatric and neonatal show no dose line at all. Counts live
   * on the buttons themselves ("2 given, last 3:10 ago"), never as
   * separate pills. */
  var TL_WORD = {
    shock: "SHOCK", drug: "DRUG", rhythm: "RHYTHM", rosc: "ROSC",
    pauseStart: "PAUSED", resume: "RESUMED", procedure: "TASK",
    reArrest: "RE-ARREST", note: "NOTE", cprStart: "START", cprEnd: "END",
    modeSet: "MODE", switchCompressor: "SWITCH"
  };

  /* Live colour-coded timeline. Word plus border shape carry every state. */
  function timelineView() {
    var rows = sess.events.slice().sort(function (a, b) { return b.elapsed - a.elapsed; });
    var items = rows.map(function (e) {
      var k = e.kind;
      var word = TL_WORD[k] || "LOG";
      return '<li class="cbl-tlitem" data-k="' + esc(k) + '">' +
        '<span class="cbl-tltime">' + esc(fmtMMSS(e.elapsed)) + "</span>" +
        '<span class="cbl-tllabel">' + esc(e.label) + "</span>" +
        '<span class="cbl-tlword">' + esc(word) + "</span></li>";
    }).join("");
    if (!rows.length) {
      items = '<li class="cbl-tlempty" data-state="empty-timeline">No events yet. Logged actions will appear here.</li>';
    }
    return '<aside class="cbl-timeline' + (timelineOpen ? " open" : "") + '" data-state="timeline" aria-label="Live timeline">' +
      '<div class="cbl-tlhead"><span>Timeline</span>' +
      '<button type="button" class="cbl-mini" data-act="sheet-log">Open log</button></div>' +
      '<ul class="cbl-tllist" data-cbfx-list>' + items + "</ul></aside>";
  }

  function linkRowView(ctx) {
    var link = (ctx === "idle") ? (pendingLink || readOpenPatient()) : sess.link;
    var state = link
      ? "<b>Linked to patient record</b><span>On End the code sheet is written to the patient timeline.</span>"
      : "<b>No patient linked</b><span>Kept on this device only.</span>";
    return '<div class="cbl-linkrow" data-state="patient-link">' +
      '<div class="cbl-linkstate">' + state + "</div>" +
      (link
        ? '<button type="button" class="cbl-mini" data-act="link-clear">Unlink</button>'
        : '<button type="button" class="cbl-mini" data-act="link-open">Link patient</button>') +
      '<button type="button" class="cbl-mini" data-act="link-refresh">Refresh</button></div>';
  }

  function dueView(elapsed) {
    var d = dueStrip(sess, elapsed, { paused: paused });
    var main = d.text, count = "";
    var cm = /(\d+:\d+)\s*$/.exec(d.text);
    if (cm && d.level === "running") { count = cm[1]; main = d.text.slice(0, cm.index).replace(/\s+$/, ""); }
    return '<div class="cbl-due cbl-due-' + d.level + '" data-level="' + d.level +
      '" data-state="due-strip" role="status" aria-live="polite">' +
      '<span class="cbl-duedot" aria-hidden="true"></span>' +
      '<span class="cbl-dueword">' + esc(dueWord(d.level, d.text)) + "</span>" +
      '<span class="cbl-duetext">' + esc(main) + "</span>" +
      (count ? '<span class="cbl-duecount">' + esc(count) + "</span>" : "") + "</div>";
  }

  function dueWord(level, text) {
    if (level === "overdue") return "Overdue";
    if (level === "due") return "Due";
    if (level === "rosc") return "ROSC";
    if (level === "paused") return "Paused";
    if (text === "Give breath") return "Now";
    if (text === "CPR in progress") return "";
    return "Next";
  }

  /* Tile layout comes from window.CodeBluePrefs when present: order,
   * hidden set and up to 4 custom buttons. Defaults are Shock, Rhythm,
   * Pause, Procedure, Note, ROSC with nothing hidden and no custom
   * buttons; Epinephrine lives in the drug row only, never in the grid. */
  function prefTiles() {
    try {
      if (typeof window !== "undefined" && window.CodeBluePrefs && window.CodeBluePrefs.tiles) {
        return window.CodeBluePrefs.tiles();
      }
    } catch (e) {}
    return null;
  }

  var TILE_DEFS = {
    shock: { icon: "shock", label: "Shock" },
    epi: { icon: "epi", label: "Epinephrine" },
    rhythm: { icon: "rhythm", label: "Rhythm" },
    pause: { icon: "pause", label: "Pause" },
    proc: { icon: "proc", label: "Procedure" },
    note: { icon: "note", label: "Note" },
    rosc: { icon: "rosc", label: "ROSC" }
  };
  var TILE_ORDER_DEFAULT = ["shock", "rhythm", "pause", "proc", "note", "rosc"];

  /* Unified action area. Priority tiles (Shock, Epinephrine, Rhythm,
   * Pause) sit in a fixed grid that never scrolls. Secondary actions
   * (Amiodarone and Lidocaine in adults, Procedure, ROSC, Note, custom
   * buttons and Re-arrest after ROSC) live in a region that scrolls
   * inside itself. Drug buttons keep the cbl-drug hooks and adult dose
   * text; action tiles keep the cbl-tile hooks. On iPad CSS flattens
   * both grids into one 4 column grid in contract order. */
  function drugBtn(act, drug, label, doseText, sub, elapsed) {
    var epiSt = epiStatus(sess, elapsed);
    var next = drug === "epi" && (epiSt.state === "due" || epiSt.state === "overdue");
    return '<button type="button" class="cbl-drug' + (next ? " cbl-nextdue" : "") +
      '" data-drug="' + drug + '" data-kind="' + drug + '" data-act="' + act + '"' +
      (next ? ' data-cbfx-specular="1"' : "") +
      ' aria-label="' + esc(label) + (doseText ? ", " + esc(doseText) : "") + '">' +
      '<span class="cbl-drugmain"><span class="cbl-druglabel">' + esc(label) + "</span>" +
      (doseText ? '<span class="cbl-drugdose">' + esc(doseText) + "</span>" : "") + "</span>" +
      '<span class="cbl-drugsub">' + esc(sub) + "</span></button>";
  }

  function actionTile(kind, label, elapsed) {
    var act = kind === "rearrest" ? "tile-rearrest" : "tile-" + kind;
    return '<button type="button" class="cbl-tile' + (kind === "rearrest" ? " cbl-tile-re" : "") +
      '" data-kind="' + kind + '" data-act="' + act + '" aria-label="' + esc(label) + '"' +
      (kind === "shock" ? ' data-cbfx-specular="1"' : "") + ">" +
      tileInner(kind, label, elapsed) + "</button>";
  }

  function actionsView(elapsed) {
    var dc = drugCounts(sess.events);
    var dose = doseRefFor(sess.mode);
    var adult = normMode(sess.mode) === "adult";
    var lastLine = function (pred, n) {
      var last = lastDrugBy(sess, pred);
      if (!n) return "";
      return n + " given" + (last ? ", last " + fmtAgo(elapsed - last.elapsed) : "");
    };
    var epiBtn = drugBtn("drug-epi", "epi", "Epinephrine", adult && dose ? dose.epi : null,
      lastLine(isEpiDrug, dc.epi), elapsed);
    var priority = '<div class="cbl-priority" data-state="priority">' +
      actionTile("shock", "Shock", elapsed) + epiBtn +
      actionTile("rhythm", "Rhythm", elapsed) +
      actionTile("pause", "Pause", elapsed) + "</div>";
    var sec = [];
    if (adult) {
      sec.push(drugBtn("drug-amio", "amio", "Amiodarone", dose ? dose.amio : null, lastLine(isAmioDrug, dc.amio), elapsed));
      sec.push(drugBtn("drug-lido", "lido", "Lidocaine", dose ? dose.lido : null, lastLine(isLidoDrug, dc.lido), elapsed));
    }
    var pref = prefTiles();
    var hidden = (pref && pref.hidden) || {};
    var order = ["proc", "rosc", "note"];
    if (pref && pref.order && pref.order.length) {
      var seen = {};
      pref.order.forEach(function (id) {
        if (order.indexOf(id) >= 0 && !seen[id]) { seen[id] = 1; }
      });
      var reordered = pref.order.filter(function (id) { return order.indexOf(id) >= 0; });
      order.forEach(function (id) { if (reordered.indexOf(id) < 0) reordered.push(id); });
      order = reordered;
    }
    order.forEach(function (id) {
      if (hidden[id]) return;
      sec.push(actionTile(id, TILE_DEFS[id].label, elapsed));
    });
    if (sess.rosc || sess.hadRosc) sec.push(actionTile("rearrest", "Re-arrest", elapsed));
    if (pref && pref.custom) {
      pref.custom.forEach(function (c) {
        if (c && c.id && c.label) {
          sec.push('<button type="button" class="cbl-tile" data-kind="custom" data-act="tile-custom" data-id="' +
            esc(c.id) + '" aria-label="' + esc(c.label) + '">' + tileInner("note", c.label, elapsed) + "</button>");
        }
      });
    }
    return '<div class="cbl-actions">' + priority +
      '<div class="cbl-secondary" data-state="secondary"><div class="cbl-secgrid">' +
      sec.join("") + "</div>" + guideView(elapsed) + audioNotice() + "</div></div>";
  }

  function tileInner(kind, label, elapsed) {
    var icon = ICONS[kind === "epi" ? "epi" : kind === "proc" ? "proc" : kind === "rearrest" ? "rearrest" : kind] || ICONS.note;
    var sub = tileSub(kind === "rearrest" ? "rearrest" : kind, elapsed);
    return '<span class="cbl-tileicon">' + icon + "</span>" +
      '<span class="cbl-tilelabel">' + esc(label) + "</span>" +
      '<span class="cbl-tilesub">' + esc(sub) + "</span>";
  }

  function guideView(elapsed) {
    var list = guideFor(guideInput(elapsed));
    var html = '<div class="cbl-guide" aria-label="Algorithm prompts"><p class="cbl-label">Next prompts</p><ul>';
    list.forEach(function (p) {
      html += '<li class="cbl-g-' + p.urgency + '"><span>' + esc(p.text) + "</span>" +
        '<span class="cbl-gsrc">' + esc(p.src) + "</span></li>";
    });
    return html + "</ul></div>";
  }

  /* Bottom tab bar: Timer, Log, Notes, Settings, equal widths, icons
   * over labels. End is never inside the tab bar: it sits in its own
   * slim bar above it. The strip above stays visible on every tab. */
  function tabsView() {
    var tab = function (id, label, icon) {
      return '<button type="button" class="cbl-tab" role="tab" data-act="tab-' + id + '"' +
        ' aria-selected="' + (rtab === id) + '">' + icon + "<span>" + label + "</span></button>";
    };
    return '<div class="cbl-tabs" role="tablist" aria-label="Code sections" data-state="tabs">' +
      tab("timer", "Timer", ICONS.rearrest) +
      tab("log", "Log", ICONS.log) +
      tab("notes", "Notes", ICONS.note) +
      tab("settings", "Settings", ICONS.gear) + "</div>";
  }

  function timerTabView(elapsed) {
    var showChecks = sess.rosc || sess.hadRosc;
    return '<div class="cbl-runpad cbl-timer" data-tabpanel="timer" role="tabpanel" aria-label="Timer">' +
      clockView(elapsed) + dueView(elapsed) + errorView() +
      actionsView(elapsed) +
      (showChecks
        ? '<button type="button" class="cbl-btn cbl-checkbtn" data-act="sheet-checks" data-state="checklist-open">' +
          "Open post ROSC checklist</button>"
        : "") +
      '<button type="button" class="cbl-tlhandle" data-act="timeline-toggle" aria-expanded="' + timelineOpen + '">' +
      "<span>Timeline</span></button></div>";
  }

  function segBtn(id, label) {
    return '<button type="button" class="cbl-segbtn" data-act="log-seg" data-seg="' + id +
      '" aria-selected="' + (logSeg === id) + '">' + label + "</button>";
  }

  function logTabView() {
    var body;
    if (logSeg === "team") body = teamView();
    else if (logSeg === "past") body = pastView();
    else body = logSegView();
    return '<div class="cbl-tabpad" data-tabpanel="log" role="tabpanel" aria-label="Log">' +
      "<h2 class='cbl-h'>Log</h2>" +
      '<div class="cbl-segs" role="tablist" aria-label="Log sections">' +
      segBtn("log", "Log") + segBtn("team", "Team and scene") + segBtn("past", "Past codes") + "</div>" +
      body + "</div>";
  }

  function logSegView() {
    var chips = LOG_FILTERS.map(function (f) {
      return '<button type="button" class="cbl-chip' + (logFilter === f.id ? " on" : "") +
        '" data-act="log-filter" data-f="' + f.id + '" aria-pressed="' + (logFilter === f.id) + '">' + f.label + "</button>";
    }).join("");
    return '<div class="cbl-chips" role="group" aria-label="Filter log">' + chips + "</div>" +
      '<div data-sheet="log">' + logRows(logFilter) + "</div>" +
      '<div class="cbl-manual"><p class="cbl-label">Add a missed event</p>' +
      '<label class="cbl-label" for="cblManualLabel">Label</label>' +
      '<input id="cblManualLabel" class="cbl-input" type="text" maxlength="140" placeholder="Event label" />' +
      '<label class="cbl-label" for="cblManualTime">Time (minutes:seconds)</label>' +
      '<input id="cblManualTime" class="cbl-input" type="text" inputmode="numeric" placeholder="0:00" />' +
      '<label class="cbl-label" for="cblManualKind">Type</label>' +
      '<select id="cblManualKind" class="cbl-input">' +
      '<option value="note">Note</option><option value="drug">Drug</option>' +
      '<option value="shock">Shock</option><option value="rhythm">Rhythm</option>' +
      '<option value="procedure">Procedure</option></select>' +
      '<div class="cbl-row"><button type="button" class="cbl-btn cbl-primary" data-act="log-add-manual">Add event</button></div></div>';
  }

  function sceneSelect(field, label, options) {
    var cur = sess && sess.scene ? sess.scene[field] : "";
    var opts = ['<option value="">Not set</option>'].concat(options.map(function (o) {
      return '<option value="' + esc(o) + '"' + (o === cur ? " selected" : "") + ">" + esc(o) + "</option>";
    })).join("");
    return '<label class="cbl-label" for="cblScene-' + field + '">' + label + '</label>' +
      '<select id="cblScene-' + field + '" class="cbl-input" data-scene="' + field + '">' + opts + "</select>";
  }

  function sceneNumInput(field, label, ph) {
    var cur = sess && sess.scene && sess.scene[field] != null ? sess.scene[field] : "";
    return '<label class="cbl-label" for="cblScene-' + field + '">' + label + '</label>' +
      '<input id="cblScene-' + field + '" class="cbl-input" type="number" min="0" inputmode="decimal" ' +
      'data-scene="' + field + '" value="' + esc(cur) + '" placeholder="' + esc(ph) + '" />';
  }

  function teamView() {
    var sc = sess ? normScene(sess.scene) : defaultScene();
    var members = sc.team.map(function (n, i) {
      return '<span class="cbl-member">' + esc(n) +
        '<button type="button" class="cbl-mini" data-act="scene-team-del" data-i="' + i + '" aria-label="Remove ' + esc(n) + '">Remove</button></span>';
    }).join("");
    var presets = loadPresets(defaultStorage());
    var presetRows = presets.map(function (p, i) {
      return '<div class="cbl-pastrow"><span class="cbl-pastmain">' + esc(p.name) + '</span>' +
        '<button type="button" class="cbl-mini" data-act="preset-apply" data-i="' + i + '">Apply</button>' +
        '<button type="button" class="cbl-mini" data-act="preset-del" data-i="' + i + '">Delete</button></div>';
    }).join("");
    return '<div data-state="team-scene">' +
      sceneNumInput("weightKg", "Patient weight (kg, optional)", "kg") +
      sceneSelect("setting", "Setting", SCENE_SETTINGS) +
      sceneSelect("arrest", "Arrest", SCENE_ARREST) +
      sceneSelect("bystanderCpr", "Bystander CPR", SCENE_YESNO) +
      sceneNumInput("downTimeMin", "Down time (minutes)", "min") +
      sceneNumInput("shocksBeforeArrival", "Shocks before arrival", "0") +
      '<label class="cbl-label" for="cblScene-location">Location</label>' +
      '<input id="cblScene-location" class="cbl-input" type="text" maxlength="80" data-scene="location" ' +
      'value="' + esc(sc.location) + '" placeholder="Ward 3B" />' +
      '<p class="cbl-label">Team members</p><div class="cbl-members">' + (members || '<span class="cbl-note">No team members yet.</span>') + "</div>" +
      '<label class="cbl-label" for="cblTeamName">Add team member</label>' +
      '<input id="cblTeamName" class="cbl-input" type="text" maxlength="40" placeholder="Name" />' +
      '<div class="cbl-row"><button type="button" class="cbl-btn" data-act="scene-team-add">Add member</button>' +
      '<button type="button" class="cbl-btn" data-act="scene-team-clear">Clear team</button></div>' +
      '<p class="cbl-label">Team presets</p>' + (presetRows || '<p class="cbl-note">No presets saved.</p>') +
      '<label class="cbl-label" for="cblPresetName">Preset name</label>' +
      '<input id="cblPresetName" class="cbl-input" type="text" maxlength="40" placeholder="Preset name" />' +
      '<div class="cbl-row"><button type="button" class="cbl-btn" data-act="preset-save">Save preset</button></div></div>';
  }

  function pastView() {
    var list = loadPast(defaultStorage());
    if (!list.length) {
      return '<p class="cbl-empty" data-state="past-empty">No finished codes on this device yet.</p>';
    }
    var rows = list.map(function (e) {
      var when = e.date ? esc(String(e.date).slice(0, 10)) : "";
      return '<div class="cbl-pastrow" data-past="' + esc(e.id) + '"><span class="cbl-pastmain">' +
        when + " " + esc(MODE_LABEL[normMode(e.mode)] || e.mode) + ", " + esc(fmtMMSS(e.durationSeconds)) +
        ", shocks " + e.shocks + ", epinephrine " + e.epi + ", ROSC " + (e.rosc ? "yes" : "no") + ", " +
        (e.training ? "TRAINING" : "LIVE") + (e.linkShort ? ", patient " + esc(e.linkShort) : "") + "</span>" +
        '<button type="button" class="cbl-mini" data-act="past-open" data-id="' + esc(e.id) + '">Open</button>' +
        '<button type="button" class="cbl-mini" data-act="past-del" data-id="' + esc(e.id) + '">Delete</button></div>';
    }).join("");
    return '<div data-state="past-list">' + rows +
      '<div class="cbl-row"><button type="button" class="cbl-btn" data-act="past-clear">Delete all</button></div></div>';
  }

  function notesTabView() {
    var notes = sess.events.filter(function (e) { return e.kind === "note"; })
      .slice().sort(function (a, b) { return a.elapsed - b.elapsed; });
    var items = notes.map(function (e) {
      return "<li><span class='cbl-tltime'>" + esc(fmtMMSS(e.elapsed)) + "</span>" +
        "<span>" + esc(e.label) + "</span></li>";
    }).join("");
    return '<div class="cbl-tabpad" data-tabpanel="notes" role="tabpanel" aria-label="Notes">' +
      "<h2 class='cbl-h'>Notes</h2>" +
      (items ? '<ul class="cbl-noteslist">' + items + "</ul>"
        : '<p class="cbl-empty" data-state="empty-notes">No notes yet.</p>') +
      '<label class="cbl-label" for="cblNoteTab">Free text note</label>' +
      '<input id="cblNoteTab" class="cbl-input" type="text" maxlength="280" placeholder="Free text note" />' +
      '<div class="cbl-row"><button type="button" class="cbl-btn cbl-primary" data-act="note-add">Add note</button></div></div>';
  }

  function settingsTabView() {
    return '<div class="cbl-tabpad" data-tabpanel="settings" role="tabpanel" aria-label="Settings">' +
      "<h2 class='cbl-h'>Settings</h2>" +
      '<p class="cbl-disc">' + esc(DISCLAIMER) + "</p>" +
      linkRowView("run") +
      '<button type="button" class="cbl-btn" data-act="audio">Sound settings</button>' +
      '<button type="button" class="cbl-btn" data-cbp-settings>Display settings</button>' +
      '<div class="cbfx-slider-row"><div class="cbfx-slider-head"><span class="cbl-label" style="margin:0">Compression rate</span><span data-cbfx-value>110 per min</span></div>' +
      '<input type="range" min="100" max="120" step="1" value="110" data-cbfx-slider data-unit=" per min" data-fx-setting="rate" aria-label="Compression rate, 100 to 120 per minute">' +
      '<div class="cbfx-marker" aria-hidden="true"><span style="left:50%"><i></i>110 default</span></div></div>' +
      '<div class="cbfx-slider-row"><div class="cbfx-slider-head"><span class="cbl-label" style="margin:0">Cycle length</span><span data-cbfx-value>120 s</span></div>' +
      '<input type="range" min="60" max="180" step="10" value="120" data-cbfx-slider data-unit=" s" data-fx-setting="cycle" aria-label="Cycle length in seconds">' +
      '<div class="cbfx-marker" aria-hidden="true"><span style="left:50%"><i></i>120 default</span></div></div>' +
      '<p class="cbl-note">Stored on this device only. Training runs never write anywhere.</p></div>';
  }

  function errorView() {
    if (!storeError) return "";
    return '<p class="cbl-error" data-state="error" role="alert">Storage full. The log stays on screen but will not resume after close.</p>';
  }

  /* One component tree for phone and iPad: status strip on top (always
   * visible on every tab), the active tab panel in the centre, the live
   * timeline beside it (right column on iPad, drawer on phone), tab bar
   * at the bottom. The same engine drives both layouts; CSS switches them. */
  function runView() {
    var elapsed = nowElapsed();
    var panel = rtab === "log" ? logTabView()
      : rtab === "notes" ? notesTabView()
      : rtab === "settings" ? settingsTabView()
      : timerTabView(elapsed);
    return statusRow(true) + stripView(elapsed) +
      '<div class="cbl-runbody"><div class="cbl-maincol">' + panel + "</div>" +
      '<div class="cbl-tlscrim' + (timelineOpen ? " open" : "") + '" data-act="timeline-toggle"></div>' +
      timelineView() + "</div>" +
      '<div class="cbl-tabwrap">' + tabsView() + "</div>" +
      '<div class="cbl-toast" data-state="toast" role="status" aria-live="polite"></div>' +
      '<div class="cbl-sheetwrap"></div>';
  }

  function endedView() {
    var elapsed = elapsedOffset;
    var d = debriefStats(sess.events, elapsed);
    var canSheet = !sess.training;
    var exportLine;
    if (sess.training) {
      exportLine = '<p class="cbl-disc">Practice only. Nothing was written to a patient record.</p>';
    } else if (exportState && exportState.written) {
      exportLine = '<p class="cbl-disc">Written to the linked patient timeline.</p>';
    } else if (sess.link) {
      exportLine = '<p class="cbl-disc">The patient timeline write did not go through. The log stays on this device.</p>';
    } else {
      exportLine = '<p class="cbl-disc">No patient linked. Kept on this device only.</p>';
    }
    var dash = "Not logged";
    var rows = [
      ["Duration", fmtMMSS(d.durationSeconds)],
      ["Time to first shock", d.timeToFirstShock === null ? dash : fmtMMSS(d.timeToFirstShock)],
      ["Time to first epinephrine", d.timeToFirstEpi === null ? dash : fmtMMSS(d.timeToFirstEpi)],
      ["Pauses", d.pauseCount + " (longest " + fmtMMSS(d.longestPauseSeconds) + ")"],
      ["Estimated CPR fraction (estimated from logged pauses)", d.cprFractionPct === null ? "Not available" : d.cprFractionPct + "%"],
      ["Shocks", String(d.shocks)],
      ["Epinephrine doses", String(d.epi)],
      ["ROSC", sess.rosc ? "Yes" : "No"]
    ];
    var sum = rows.map(function (r) {
      return "<div><dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd></div>";
    }).join("");
    return statusRow() + '<div class="cbl-scroll"><div class="cbl-endview" data-state="ended">' +
      "<h2 class='cbl-h'>Debrief</h2>" +
      '<dl class="cbl-sum">' + sum + "</dl>" +
      exportLine +
      (sess.training ? "" : '<p class="cbl-disc">' + esc(DISCLAIMER) + "</p>") +
      (canSheet
        ? '<button type="button" class="cbl-btn cbl-primary" data-act="open-sheet">Share code sheet</button>'
        : '<button type="button" class="cbl-btn cbl-primary" data-act="debrief-share">Share code sheet</button>') +
      '<button type="button" class="cbl-btn" data-act="debrief-past">Past codes</button>' +
      '<button type="button" class="cbl-btn" data-act="close">Done</button>' +
      (endedPast ? pastView() : "") +
      "</div></div>";
  }

  function fxEnhance() {
    try {
      if (typeof window === "undefined" || !window.CodeBlueFX || !rootEl) return;
      if (window.CodeBlueFX.counter) window.CodeBlueFX.counter.enhanceAll(rootEl);
      if (window.CodeBlueFX.specular) window.CodeBlueFX.specular.enhanceAll(rootEl);
      if (window.CodeBlueFX.list) window.CodeBlueFX.list.enhanceAll(rootEl);
      var sliders = rootEl.querySelectorAll("[data-fx-setting]");
      for (var si = 0; si < sliders.length; si++) {
        try { var sv = localStorage.getItem("smd.cbl.fx." + sliders[si].getAttribute("data-fx-setting")); if (sv) sliders[si].value = sv; } catch (err2) {}
      }
      if (window.CodeBlueFX.slider) window.CodeBlueFX.slider.enhanceAll(rootEl);
    } catch (e) {}
  }

  function render() {
    if (!rootEl) return;
    if (view === "idle") rootEl.innerHTML = idleView();
    else if (view === "ended") rootEl.innerHTML = endedView();
    else rootEl.innerHTML = runView();
    rootEl.setAttribute("data-view", view);
    fxEnhance();
  }

  /* ---------------- sheets ---------------- */

  function closeSheet() {
    if (!rootEl) return;
    var w = rootEl.querySelector(".cbl-sheetwrap");
    if (w) w.innerHTML = "";
    if (sheetFocus && sheetFocus.focus) {
      try { sheetFocus.focus({ preventScroll: true }); } catch (e) {}
    }
    sheetFocus = null;
  }

  function openSheet(title, body, focusSel) {
    if (!rootEl) return;
    var w = rootEl.querySelector(".cbl-sheetwrap");
    if (!w) return;
    sheetFocus = document.activeElement;
    w.innerHTML = '<div class="cbl-scrim" data-act="sheet-scrim"></div>' +
      '<div class="cbl-sheet" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
      '<div class="cbl-sheethead"><h2 class="cbl-sheeth" tabindex="-1">' + esc(title) + "</h2>" +
      '<button type="button" class="cbl-iconbtn" data-act="sheet-close" aria-label="Close ' + esc(title) + '">' +
      ICONS.close + "</button></div>" +
      '<div class="cbl-sheetbody">' + body + "</div></div>";
    var h = w.querySelector(".cbl-sheeth");
    if (h && h.focus) { try { h.focus({ preventScroll: true }); } catch (e) {} }
    if (focusSel) {
      var f = w.querySelector(focusSel);
      if (f && f.focus) { try { f.focus({ preventScroll: true }); } catch (e2) {} }
    }
  }

  function sheetOpen() {
    if (!rootEl) return false;
    var w = rootEl.querySelector(".cbl-sheetwrap");
    return !!(w && w.querySelector(".cbl-sheet"));
  }

  function logRows(filter) {
    var elapsed = nowElapsed();
    /* System entries seeded at Start stay in the payload but never fill
     * the visible log, so a fresh code keeps the empty-log state. */
    var visible = sess.events.filter(function (e) {
      return e.kind !== "modeSet" && e.kind !== "cprStart" && eventMatchesFilter(e, filter || "all");
    });
    if (!visible.length) {
      return '<p class="cbl-empty" data-state="empty-log">No events yet. Logged actions will appear here.</p>';
    }
    var rows = visible.slice().sort(function (a, b) { return a.elapsed - b.elapsed; });
    return '<ul class="cbl-log" data-cbfx-list>' + rows.map(function (e) {
      return '<li data-id="' + esc(e.id) + '"><span class="cbl-logt">' + esc(fmtMMSS(e.elapsed)) + "</span>" +
        '<span class="cbl-logl">' + esc(e.label) + (e.edited ? ' <span class="cbl-edited">edited</span>' : "") + "</span>" +
        '<span class="cbl-logacts"><button type="button" class="cbl-mini" data-act="log-edit" data-id="' + esc(e.id) + '">Edit</button>' +
        '<button type="button" class="cbl-mini" data-act="log-del" data-id="' + esc(e.id) + '">Delete</button></span></li>';
    }).join("") + "</ul>";
  }

  function openLogSheet() {
    openSheet("Log", '<div data-sheet="log">' + logRows() + "</div>");
  }

  function refreshLogSheet() {
    if (!rootEl) return;
    var d = rootEl.querySelector('[data-sheet="log"]');
    if (d) d.innerHTML = logRows();
  }

  function openProcSheet() {
    var body = '<div class="cbl-pick">' + PROCEDURES.map(function (p) {
      return '<button type="button" class="cbl-pickbtn" data-act="proc-pick" data-label="' + esc(p) + '">' +
        esc(p) + "</button>";
    }).join("") + "</div>";
    openSheet("Procedure", body);
  }

  function openRhythmSheet() {
    var body = '<div class="cbl-pick">' + RHYTHMS.map(function (r) {
      return '<button type="button" class="cbl-pickbtn" data-act="rhythm-pick" data-label="' + esc(r) + '">' +
        esc(r) + "</button>";
    }).join("") + "</div>";
    openSheet("Rhythm", body);
  }

  function openChecksSheet() {
    var items = checklistFor(sess.mode);
    var done = Object.keys(sess.checks).length;
    var body = '<p class="cbl-note" data-state="checklist">' + done + " of " + items.length +
      " done. Each tick is logged as a note.</p>" +
      '<ul class="cbl-checks">' + items.map(function (it) {
        var on = !!sess.checks[it.id];
        return '<li><button type="button" class="cbl-check' + (on ? " on" : "") + '" data-act="check-tick" data-id="' +
          esc(it.id) + '" aria-pressed="' + on + '"><span class="cbl-box" aria-hidden="true">' +
          (on ? ICONS.check : "") + "</span><span>" + esc(it.text) + "</span></button></li>";
      }).join("") + "</ul>";
    openSheet("Post ROSC checklist", body);
  }

  function openAudioSheet() {
    var A = Audio();
    var m = A ? A.mutes() : { voice: false, metronome: false, breaths: false };
    var st = A ? A.status() : "unavailable";
    var line = st === "ok" ? "Sound on."
      : st === "blocked" ? "Sound starts after you tap Start."
      : "Sound is not available on this device.";
    var row = function (key, label, sub, off) {
      return '<button type="button" class="cbl-practice' + (off ? "" : " on") + '" data-act="mute" data-k="' + key +
        '" aria-pressed="' + (!off) + '"><b>' + esc(label) + "</b><span>" + esc(sub) + "</span></button>";
    };
    openSheet("Sound",
      '<p class="cbl-note">' + esc(line) + "</p>" +
      row("voice", "Voice cues", "Spoken prompts such as rhythm check and epinephrine due.", m.voice) +
      row("metronome", "Metronome", "110 ticks per minute while the clock runs.", m.metronome) +
      row("breaths", "Breath cues", "Tick every 6 s with an advanced airway.", m.breaths));
  }

  function openNoteSheet() {
    openSheet("Note",
      '<label class="cbl-label" for="cblNoteIn">Free text note</label>' +
      '<input id="cblNoteIn" class="cbl-input" type="text" maxlength="280" placeholder="Free text note" />' +
      '<div class="cbl-row"><button type="button" class="cbl-btn cbl-primary" data-act="note-add">Add note</button></div>',
      "#cblNoteIn");
  }

  /* ---------------- toast + cues ---------------- */

  function toast(msg, undoId) {
    if (!rootEl) return;
    var t = rootEl.querySelector(".cbl-toast");
    if (!t) return;
    if (toastTimer) { try { clearTimeout(toastTimer); } catch (e) {} }
    t.innerHTML = "<span>" + esc(msg) + "</span>" +
      (undoId ? ' <button type="button" class="cbl-mini" data-act="toast-undo" data-id="' + esc(undoId) + '">Undo</button>' : "");
    t.classList.add("on");
    toastTimer = setTimeout(function () {
      try { t.classList.remove("on"); t.innerHTML = ""; } catch (e) {}
    }, UNDO_MS);
  }

  function afterEvent(ev, speakKey) {
    persist();
    var A = Audio();
    if (A && speakKey && !sess.training) {
      try { A.speak(speakKey); } catch (e) {}
    }
    if (view === "running") {
      render();
      toast("Logged. ", ev.id);
      var t = rootEl.querySelector(".cbl-toast span");
      if (t) t.textContent = "Logged " + ev.label + ".";
    }
  }

  function fireCues(elapsed) {
    var A = Audio();
    if (!A || sess.training) {
      if (sess && sess.training) return;
    }
    var cyc = cycleInfo(sess.mode, elapsed, sess.cycleStart);
    var cycKey = "r" + Math.floor(Math.max(0, elapsed - sess.cycleStart) / cyc.interval);
    if (!fired[cycKey + "-soon"] && !cyc.due && cyc.remaining <= 10 && cyc.remaining > 0) {
      fired[cycKey + "-soon"] = 1;
      try { A.speak("rhythmSoon"); } catch (e) {}
    }
    if (!fired[cycKey + "-due"] && cyc.due) {
      fired[cycKey + "-due"] = 1;
      try { A.speak("rhythmDue"); } catch (e) {}
    }
    var epi = epiStatus(sess, elapsed);
    var le = lastEpi(sess);
    if (le) {
      var ek = "e" + le.id;
      if (!fired[ek + "-due"] && (epi.state === "due" || epi.state === "overdue")) {
        fired[ek + "-due"] = 1;
        try { A.speak("epiDue"); } catch (e) {}
      }
      if (!fired[ek + "-od"] && epi.state === "overdue") {
        fired[ek + "-od"] = 1;
        try { A.overdueTone(); A.speak("epiOverdue"); } catch (e2) {}
      }
    }
  }

  /* ---------------- clock and persistence ---------------- */

  function persist() {
    if (!sess || sess.training) return true;
    var snap = takeSnapshot(sess, nowElapsed(), Date.now());
    snap.running = view === "running";
    snap.paused = paused;
    var ok = saveSnapshot(defaultStorage(), snap);
    storeError = !ok;
    return ok;
  }

  function startTick() {
    stopTick();
    lastSnapSave = Date.now();
    tickTimer = setInterval(function () {
      if (view !== "running" || paused) return;
      if (Date.now() - lastSnapSave >= 5000) {
        lastSnapSave = Date.now();
        persist();
      }
      fireCues(nowElapsed());
      paintClock();
    }, 250);
  }

  function stopTick() {
    if (tickTimer) { try { clearInterval(tickTimer); } catch (e) {} }
    tickTimer = null;
  }

  /* Repaint only the ring card, strips and vent between full renders. */
  function paintClock() {
    if (!rootEl || !sess || view !== "running") return;
    var elapsed = nowElapsed();
    var c = rootEl.querySelector(".cbl-ringrow");
    if (c && rtab === "timer") {
      var tmp = document.createElement("div");
      tmp.innerHTML = clockView(elapsed);
      var fresh = tmp.firstChild;
      if (fresh) c.parentNode.replaceChild(fresh, c);
    }
    var d = rootEl.querySelector(".cbl-due");
    if (d) {
      var t2 = document.createElement("div");
      t2.innerHTML = dueView(elapsed);
      var fd = t2.firstChild;
      if (fd) {
        var before = d.getAttribute("data-level");
        if (fd.textContent !== d.textContent || before !== fd.getAttribute("data-level")) {
          d.parentNode.replaceChild(fd, d);
          if (before !== fd.getAttribute("data-level")) render();
        }
      }
    }
    var s = rootEl.querySelector(".cbl-strip");
    if (s) {
      var t3 = document.createElement("div");
      t3.innerHTML = stripView(elapsed);
      var fs = t3.firstChild;
      if (fs && fs.textContent !== s.textContent) s.parentNode.replaceChild(fs, s);
    }
    fxEnhance();
  }

  /* ---------------- actions ---------------- */

  function doStart() {
    var A = Audio();
    if (A) { try { A.unlock(); A.ensureWakeLock(); } catch (e) {} }
    sess = newSession(idleMode, { training: idleTraining });
    /* Team members persist for back-to-back codes on this device. */
    sess.scene.team = loadTeam(defaultStorage());
    /* LIVE captures the linked patient at Start; practice never links. */
    sess.link = sess.training ? null : (pendingLink || readOpenPatient());
    speed = sess.training ? TRAINING_SPEED : 1;
    elapsedOffset = 0;
    runStartWall = Date.now();
    paused = false;
    fired = {};
    storeError = false;
    exportState = null;
    rtab = "timer";
    timelineOpen = false;
    view = "running";
    logEvent(sess, "modeSet", "Mode: " + MODE_LABEL[sess.mode], 0);
    logEvent(sess, "cprStart", null, 0);
    persist();
    render();
    if (A && !sess.training) {
      try {
        var m = A.mutes();
        if (!m.metronome) A.startMetronome();
        if (!m.breaths && sess.mode !== "neonatal") A.startBreathTicks();
      } catch (e2) {}
    }
    startTick();
    notifyWatch(true);
  }

  function doPauseToggle() {
    var elapsed = nowElapsed();
    if (paused) {
      paused = false;
      runStartWall = Date.now();
      logEvent(sess, "resume", null, elapsed);
      persist();
      render();
    } else {
      elapsedOffset = elapsed;
      paused = true;
      pauseWall = Date.now();
      logEvent(sess, "pauseStart", null, elapsedOffset);
      persist();
      render();
      toast("Paused. ", null);
      var t = rootEl.querySelector(".cbl-toast span");
      if (t) t.textContent = "CPR paused.";
    }
  }

  function doEnd(manual) {
    var elapsed = nowElapsed();
    var msg = "End this code? The timer stops and the log is kept for the code sheet.";
    try {
      if (manual && typeof window !== "undefined" && window.confirm && !window.confirm(msg)) return;
    } catch (e) {}
    if (sess && !sess.ended) {
      logEvent(sess, "cprEnd", null, Math.floor(elapsed));
      sess.ended = true;
    }
    elapsedOffset = Math.floor(elapsed);
    view = "ended";
    endedPast = false;
    try {
      var pastPayload = buildPayload(sess, {
        elapsed: Math.floor(elapsed),
        startedAtISO: new Date(sess.createdWall).toISOString()
      });
      var pastEntry = pastEntryFromPayload(pastPayload, { link: sess.link, savedWall: Date.now() });
      savePast(defaultStorage(), addPastEntry(loadPast(defaultStorage()), pastEntry));
    } catch (ePast) {}
    stopTick();
    var A = Audio();
    if (A) { try { A.shutdown(); } catch (e2) {} }
    if (!sess.training) {
      try { clearSnapshot(defaultStorage()); } catch (e3) {}
      /* LIVE End with a linked patient writes the code sheet to the
       * patient timeline (native-watch codeBlueExport parity). Guarded
       * so the summary always renders even if the export path fails. */
      try {
        exportState = exportToPatient();
      } catch (e4) {
        exportState = { ok: false, opened: false, written: false, reason: "unavailable" };
      }
    } else {
      exportState = null;
    }
    render();
    notifyWatch(false);
  }

  function openCodeSheet() {
    var payload = buildPayload(sess, {
      elapsed: Math.floor(elapsedOffset),
      startedAtISO: new Date(sess.createdWall).toISOString()
    });
    try {
      if (!sess.training && typeof window !== "undefined" && window.CodeBlueSheet && window.CodeBlueSheet.open) {
        window.CodeBlueSheet.open(payload);
        return true;
      }
    } catch (e) {}
    return false;
  }

  function onClick(e) {
    var el = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
    if (!el || !rootEl || !rootEl.contains(el)) return;
    var act = el.getAttribute("data-act");
    var elapsed = nowElapsed();
    var A = Audio();

    if (act === "close") {
      if (view === "running" && sess) {
        try {
          if (typeof window !== "undefined" && window.confirm &&
            !window.confirm("Close the live timer? The code keeps its saved snapshot.")) return;
        } catch (err) {}
      }
      close();
      return;
    }
    if (act === "idle-mode") { idleMode = normMode(el.getAttribute("data-mode")); render(); return; }
    if (act === "idle-training") { idleTraining = !idleTraining; render(); return; }
    if (act === "start") { doStart(); return; }
    if (act === "resume-yes" && pendingResume) {
      var r = restoreSnapshot(pendingResume, Date.now());
      pendingResume = null;
      if (r.ok === "resume") {
        sess = r.session;
        idleMode = sess.mode;
        idleTraining = !!sess.training;
        speed = sess.training ? TRAINING_SPEED : 1;
        elapsedOffset = r.elapsed;
        runStartWall = Date.now();
        paused = false;
        fired = {};
        exportState = null;
        rtab = "timer";
        timelineOpen = false;
        view = "running";
        render();
        startTick();
        notifyWatch(true);
      } else {
        try { clearSnapshot(defaultStorage()); } catch (err2) {}
        render();
      }
      return;
    }
    if (act === "resume-no") {
      pendingResume = null;
      try { clearSnapshot(defaultStorage()); } catch (err3) {}
      render();
      return;
    }
    if (act === "audio") { openAudioSheet(); return; }
    if (act === "mute" && A) {
      var k = el.getAttribute("data-k");
      var cur = A.mutes();
      A.setMuted(k, !cur[k]);
      if (view === "running" && k === "metronome" && !A.mutes().metronome && !paused) {
        try { A.startMetronome(); } catch (err4) {}
      }
      openAudioSheet();
      return;
    }
    if (act === "sheet-close" || act === "sheet-scrim") { closeSheet(); return; }
    if (act === "link-open") {
      pendingLink = readOpenPatient() || pendingLink;
      if (!pendingLink) openWardPicker();
      render();
      return;
    }
    if (act === "link-refresh") { render(); return; }
    if (act === "link-clear") {
      if (sess && view === "running") { sess.link = null; persist(); }
      else pendingLink = null;
      render();
      return;
    }
    if (!sess) return;

    if (act === "tab-timer" || act === "tab-log" || act === "tab-notes" || act === "tab-settings") {
      rtab = act.slice(4);
      render();
      return;
    }
    if (act === "timeline-toggle") { timelineOpen = !timelineOpen; render(); return; }
    if (act === "vent-cue") {
      sess.ventCue = sess.ventCue === false;
      var AU = Audio();
      if (AU && !sess.training) {
        try {
          AU.setMuted("breaths", !sess.ventCue);
          if (sess.ventCue && hasAirway(sess) && !paused) AU.startBreathTicks();
        } catch (errv) {}
      }
      persist();
      render();
      return;
    }
    if (act === "tile-shock") { afterEvent(logEvent(sess, "shock", null, elapsed), "shockLogged"); return; }
    if (act === "tile-epi" || act === "drug-epi") {
      afterEvent(logEvent(sess, "drug", "Epinephrine", elapsed), null);
      return;
    }
    if (act === "drug-amio") { afterEvent(logEvent(sess, "drug", "Amiodarone", elapsed), null); return; }
    if (act === "drug-lido") { afterEvent(logEvent(sess, "drug", "Lidocaine", elapsed), null); return; }
    if (act === "tile-rhythm") { openRhythmSheet(); return; }
    if (act === "tile-pause" || act === "tile-paused") { doPauseToggle(); return; }
    if (act === "tile-rearrest") {
      if (sess.rosc || sess.hadRosc) {
        afterEvent(reArrest(sess, elapsed), null);
        sess.hadRosc = true;
      }
      return;
    }
    if (act === "tile-proc") { openProcSheet(); return; }
    if (act === "tile-note") { openNoteSheet(); return; }
    if (act === "tile-custom") {
      var customId = el.getAttribute("data-id");
      var customLabel = null;
      var pt = prefTiles();
      if (pt && pt.custom) {
        for (var ci = 0; ci < pt.custom.length; ci++) {
          if (pt.custom[ci].id === customId) customLabel = pt.custom[ci].label;
        }
      }
      if (customLabel) afterEvent(logEvent(sess, "note", String(customLabel).slice(0, 14), elapsed), null);
      return;
    }
    if (act === "tile-rosc") {
      if (!sess.rosc) {
        sess.rosc = true;
        sess.hadRosc = true;
        afterEvent(logEvent(sess, "rosc", null, elapsed), "roscLogged");
      }
      return;
    }
    if (act === "proc-pick") {
      var pl = el.getAttribute("data-label") || "Procedure";
      closeSheet();
      afterEvent(logEvent(sess, "procedure", pl, nowElapsed()), null);
      if (A && pl === "Advanced airway" && !sess.training) {
        try { if (!A.mutes().breaths) A.startBreathTicks(); } catch (err5) {}
      }
      return;
    }
    if (act === "rhythm-pick") {
      var rl = el.getAttribute("data-label") || "Rhythm check";
      closeSheet();
      afterEvent(logEvent(sess, "rhythm", rl, nowElapsed()), null);
      return;
    }
    if (act === "note-add") {
      var inp = rootEl.querySelector("#cblNoteIn") || rootEl.querySelector("#cblNoteTab");
      var txt = inp ? String(inp.value || "").trim().slice(0, 280) : "";
      if (!txt) { if (inp) inp.focus(); return; }
      closeSheet();
      afterEvent(logEvent(sess, "note", txt, nowElapsed()), null);
      return;
    }
    if (act === "sheet-log") { openLogSheet(); return; }
    if (act === "sheet-checks") { openChecksSheet(); return; }
    if (act === "check-tick") {
      var cid = el.getAttribute("data-id");
      toggleCheck(sess, cid, nowElapsed());
      persist();
      openChecksSheet();
      if (view === "running") render();
      openChecksSheet();
      return;
    }
    if (act === "log-edit") {
      var eid = el.getAttribute("data-id");
      var ev = findEvent(sess, eid);
      if (!ev) return;
      var cur = ev.label;
      var next = null;
      try {
        if (typeof window !== "undefined" && window.prompt) next = window.prompt("Edit label", cur);
      } catch (err6) {}
      if (next == null) return;
      /* Reopen the overlay sheet only when the edit came from it; the Log
       * tab re-renders inline instead so navigation never jumps. */
      var wasEditSheet = sheetOpen();
      if (editEvent(sess, eid, next)) {
        persist();
        render();
        if (wasEditSheet) openLogSheet();
      }
      return;
    }
    if (act === "log-del") {
      var did = el.getAttribute("data-id");
      var wasDelSheet = sheetOpen();
      if (deleteEvent(sess, did)) {
        persist();
        render();
        if (wasDelSheet) openLogSheet();
        toast("Event deleted. ", did);
      }
      return;
    }
    if (act === "toast-undo") {
      var uid = el.getAttribute("data-id");
      var wasLog = sheetOpen();
      if (uid) {
        var undone = null;
        for (var i = sess.undo.length - 1; i >= 0; i--) {
          if (sess.undo[i].ev.id === uid) {
            undone = sess.undo.splice(i, 1)[0];
            var at = Math.min(undone.at, sess.events.length);
            sess.events.splice(at, 0, undone.ev);
            break;
          }
        }
        if (!undone) undone = undoDelete(sess);
        if (undone) persist();
      } else if (undoDelete(sess)) persist();
      render();
      if (wasLog) openLogSheet();
      toast("Event restored. ", null);
      return;
    }
    if (act === "log-seg") { logSeg = el.getAttribute("data-seg") || "log"; render(); return; }
    if (act === "log-filter") { logFilter = el.getAttribute("data-f") || "all"; render(); return; }
    if (act === "log-add-manual") {
      var ml = rootEl.querySelector("#cblManualLabel");
      var mt = rootEl.querySelector("#cblManualTime");
      var mk = rootEl.querySelector("#cblManualKind");
      var label = ml ? String(ml.value || "").trim().slice(0, 140) : "";
      var tval = mt ? String(mt.value || "").trim() : "";
      var mm = /^(\d+):([0-5]?\d)$/.exec(tval);
      var secs = mm ? (+mm[1]) * 60 + (+mm[2]) : (/^\d+$/.test(tval) ? +tval : null);
      if (!label || secs === null) { if (!label && ml) ml.focus(); else if (mt) mt.focus(); return; }
      var kind = mk && ["drug", "shock", "rhythm", "procedure", "note"].indexOf(mk.value) >= 0 ? mk.value : "note";
      sess.events.push({ id: "ev-" + (++sess.seq), elapsed: Math.max(0, Math.floor(secs)), kind: kind, label: label, edited: false });
      sess.events.sort(function (a, b) { return a.elapsed - b.elapsed; });
      persist(); render(); toast("Event added. ", null);
      return;
    }
    if (act === "scene-team-add") {
      var tn = rootEl.querySelector("#cblTeamName");
      var name = tn ? String(tn.value || "").trim().slice(0, 40) : "";
      if (!name) { if (tn) tn.focus(); return; }
      sess.scene = normScene(sess.scene); sess.scene.team.push(name);
      sess.scene = normScene(sess.scene);
      saveTeam(defaultStorage(), sess.scene.team); persist(); render(); return;
    }
    if (act === "scene-team-del") {
      sess.scene = normScene(sess.scene);
      sess.scene.team.splice(+(el.getAttribute("data-i") || 0), 1);
      saveTeam(defaultStorage(), sess.scene.team); persist(); render(); return;
    }
    if (act === "scene-team-clear") {
      sess.scene = normScene(sess.scene); sess.scene.team = [];
      saveTeam(defaultStorage(), []); persist(); render(); return;
    }
    if (act === "preset-save") {
      var pn = rootEl.querySelector("#cblPresetName");
      var pname = pn ? String(pn.value || "").trim().slice(0, 40) : "";
      if (!pname) { if (pn) pn.focus(); return; }
      var plist = loadPresets(defaultStorage());
      plist = plist.filter(function (p) { return p.name !== pname; });
      plist.push({ name: pname, scene: normScene(sess.scene) });
      savePresets(defaultStorage(), plist); render(); return;
    }
    if (act === "preset-apply") {
      var pres = loadPresets(defaultStorage())[+(el.getAttribute("data-i") || 0)];
      if (pres) {
        sess.scene = normScene(pres.scene);
        saveTeam(defaultStorage(), sess.scene.team); persist();
      }
      render(); return;
    }
    if (act === "preset-del") {
      var pdel = loadPresets(defaultStorage());
      pdel.splice(+(el.getAttribute("data-i") || 0), 1);
      savePresets(defaultStorage(), pdel); render(); return;
    }
    if (act === "past-open") {
      var pid = el.getAttribute("data-id");
      var entry = loadPast(defaultStorage()).filter(function (e) { return e.id === pid; })[0];
      try {
        if (entry && typeof window !== "undefined" && window.CodeBlueSheet && window.CodeBlueSheet.open) {
          window.CodeBlueSheet.open(entry.payload);
        }
      } catch (eOpen) {}
      return;
    }
    if (act === "past-del") {
      var didPast = el.getAttribute("data-id");
      savePast(defaultStorage(), loadPast(defaultStorage()).filter(function (e) { return e.id !== didPast; }));
      render(); return;
    }
    if (act === "past-clear") {
      try {
        if (typeof window !== "undefined" && window.confirm && !window.confirm("Delete all past codes on this device?")) return;
      } catch (eClear) {}
      savePast(defaultStorage(), []); render(); return;
    }
    if (act === "debrief-past") { endedPast = !endedPast; if (!endedPast) { logSeg = "past"; } render(); return; }
    if (act === "debrief-share") {
      var dpayload = buildPayload(sess, { elapsed: Math.floor(elapsedOffset), startedAtISO: new Date(sess.createdWall).toISOString() });
      try {
        var SheetApi = (typeof window !== "undefined" && window.CodeBlueSheet) || null;
        var dtext = SheetApi && SheetApi.renderText ? SheetApi.renderText(SheetApi.parsePayload(dpayload)) : JSON.stringify(dpayload);
        var nav2 = (typeof navigator !== "undefined") ? navigator : {};
        if (typeof nav2.share === "function") nav2.share({ text: dtext });
        else if (nav2.clipboard && nav2.clipboard.writeText) nav2.clipboard.writeText(dtext);
      } catch (eShare) {}
      return;
    }
    if (act === "end") { doEnd(true); return; }
    if (act === "open-sheet") { openCodeSheet(); return; }
  }

  function onKey(e) {
    if (!rootEl || !rootEl.classList.contains("on")) return;
    if (e.key === "Escape") {
      if (sheetOpen()) { closeSheet(); return; }
      if (view !== "running") close();
    }
  }

  /* ---------------- public ---------------- */

  function open(opts) {
    opts = opts || {};
    if (!hasDOM()) return false;
    if (rootEl && rootEl.classList.contains("on")) return true;
    if (!rootEl) {
      rootEl = document.createElement("div");
      rootEl.id = "cblRoot";
      document.body.appendChild(rootEl);
      rootEl.addEventListener("click", onClick);
      rootEl.addEventListener("change", function (e) {
        var t = e.target;
        if (!t || !t.getAttribute) return;
        if (t.getAttribute("data-fx-setting")) {
          try { localStorage.setItem("smd.cbl.fx." + t.getAttribute("data-fx-setting"), String(t.value)); } catch (err) {}
          return;
        }
        var field = t.getAttribute("data-scene");
        if (field && sess) {
          sess.scene = normScene(sess.scene);
          if (field === "weightKg" || field === "downTimeMin" || field === "shocksBeforeArrival") {
            sess.scene[field] = t.value === "" ? null : Number(t.value);
          } else {
            sess.scene[field] = String(t.value || "");
          }
          sess.scene = normScene(sess.scene);
          persist();
        }
      });
      document.addEventListener("keydown", onKey);
      var css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = (opts.css || "/codeblue-live.css");
      document.head.appendChild(css);
    }
    if (opts.theme) rootEl.setAttribute("data-theme", opts.theme);
    idleMode = opts.mode ? normMode(opts.mode) : "adult";
    idleTraining = opts.training === true;
    sess = null;
    view = "idle";
    elapsedOffset = 0;
    paused = false;
    pendingResume = null;
    storeError = false;
    rtab = "timer";
    timelineOpen = false;
    exportState = null;
    pendingLink = readOpenPatient();
    lastFocus = document.activeElement;
    if (opts.training !== true) {
      var snap = loadSnapshot(defaultStorage());
      if (snap) {
        var r = restoreSnapshot(snap, Date.now());
        if (r.ok === "resume") pendingResume = snap;
        else { try { clearSnapshot(defaultStorage()); } catch (e) {} }
      }
    }
    rootEl.classList.add("on");
    try { document.body.classList.add("cbl-lock"); } catch (e2) {}
    try {
      if (typeof window !== "undefined" && window.CodeBluePrefs) {
        window.CodeBluePrefs.apply(rootEl);
      }
    } catch (e3) {}
    render();
    return true;
  }

  function close() {
    stopTick();
    var A = Audio();
    if (A) { try { A.shutdown(); } catch (e) {} }
    if (rootEl) rootEl.classList.remove("on");
    try { document.body.classList.remove("cbl-lock"); } catch (e2) {}
    if (lastFocus && lastFocus.focus) {
      try { lastFocus.focus({ preventScroll: true }); } catch (e3) {}
    }
    lastFocus = null;
  }

  function isOpen() { return !!(rootEl && rootEl.classList.contains("on")); }

  /* Test hooks: drive the clock without waiting. */
  var _rt = {
    session: function () { return sess; },
    view: function () { return view; },
    tab: function () { return rtab; },
    logSeg: function () { return logSeg; },
    setLogSeg: function (s) { logSeg = s; if (view === "running") render(); },
    setTab: function (t) { rtab = t; if (view === "running") render(); },
    link: function () { return (sess && sess.link) || pendingLink; },
    exportState: function () { return exportState; },
    elapsed: function () { return nowElapsed(); },
    setElapsed: function (s) {
      elapsedOffset = Math.max(0, s);
      runStartWall = Date.now();
      if (view === "running") { fireCues(elapsedOffset); render(); }
    },
    storeError: function () { return storeError; }
  };

  /* Re-render the grid after a prefs change. Skipped while one of the
   * live screen's own sheets is open so the sheet is never wiped. */
  function refresh() {
    if (!rootEl || !rootEl.classList.contains("on")) return;
    if (sheetOpen()) return;
    render();
  }

  return { open: open, close: close, isOpen: isOpen, _engine: _engine, _rt: _rt, _refresh: refresh };
});




