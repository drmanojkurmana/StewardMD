/* codeblue-live.js: phone live code screen (StewardMD Code Blue).
 * Vanilla JS, no framework, fully offline. State in localStorage key smd.cbl.v1 (try/catch).
 * Exposes window.CodeBlueLive = { open(opts), close(), isOpen(), _engine }.
 * Pure domain logic first (DOM-free, unit tested in node); the overlay UI sits
 * below. Calls window.CodeBlueSheet.open(payload) on End when present, never
 * in training. Audio lives in codeblue-audio.js (window.CodeBlueAudio).
 * No drug doses anywhere. British spelling. Plain punctuation throughout.
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

  function newSession(mode, opts) {
    opts = opts || {};
    var wall = (opts.wallNow != null) ? opts.wallNow : Date.now();
    return {
      v: 1, mode: normMode(mode), training: opts.training === true,
      events: [], rosc: false, hadRosc: false, checks: {},
      cycleStart: 0, seq: 0, undo: [], createdWall: wall
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

  /* Counts are always recomputed from the event list, after any edit. */
  function computeCounts(events) {
    var epi = 0, shocks = 0;
    (events || []).forEach(function (ev) {
      if (ev.kind === "shock") shocks++;
      if (isEpiDrug(ev)) epi++;
    });
    return { epi: epi, shocks: shocks };
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
      disclaimer: MOTION_NOTE
    };
  }

  /* Every user-visible string the engine can emit, for the no-dose scan. */
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
    normMode: normMode, fmtMMSS: fmtMMSS, fmtShort: fmtShort, fmtAgo: fmtAgo,
    newSession: newSession, logEvent: logEvent, editEvent: editEvent,
    deleteEvent: deleteEvent, undoDelete: undoDelete, computeCounts: computeCounts,
    lastEpi: lastEpi, lastShock: lastShock, lastRhythm: lastRhythm,
    epiStatus: epiStatus, cycleInfo: cycleInfo, shockAdvised: shockAdvised,
    dueStrip: dueStrip, guideFor: guideFor,
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
    log: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18H6z"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l5 5L20 7"/></svg>'
  };

  function tileSub(kind, elapsed) {
    var counts = computeCounts(sess.events);
    var last, sub;
    if (kind === "shock") {
      last = lastShock(sess);
      sub = counts.shocks === 0 ? "Not logged yet"
        : counts.shocks + " given" + (last ? ", last " + fmtAgo(elapsed - last.elapsed) : "");
      return sub;
    }
    if (kind === "epi") {
      last = lastEpi(sess);
      return counts.epi === 0 ? "Not logged yet"
        : counts.epi + " given" + (last ? ", last " + fmtAgo(elapsed - last.elapsed) : "");
    }
    if (kind === "rhythm") {
      last = lastRhythm(sess);
      return last ? last.label + ", " + fmtAgo(elapsed - last.elapsed) : "Not logged yet";
    }
    if (kind === "proc") {
      var n = sess.events.filter(function (e) { return e.kind === "procedure"; }).length;
      return n === 0 ? "None logged yet" : n + " logged";
    }
    if (kind === "note") {
      var nn = sess.events.filter(function (e) { return e.kind === "note"; }).length;
      return nn === 0 ? "Add a note" : nn + (nn === 1 ? " note" : " notes");
    }
    if (kind === "pause") return paused ? "Paused now" : "Pause compressions";
    if (kind === "rosc") return sess.rosc ? "ROSC logged" : "Log ROSC";
    if (kind === "rearrest") return "Restart CPR cycle";
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

  function statusRow() {
    var modeChip = sess
      ? '<span class="cbl-mode" aria-label="Mode">' + esc(MODE_LABEL[sess.mode]) + "</span>"
      : '<span class="cbl-mode" aria-label="Mode">Code Blue</span>';
    var badge = (sess && sess.training) || (!sess && idleTraining)
      ? '<span class="cbl-badge">TRAINING</span>' : "";
    return '<div class="cbl-status">' + modeChip + badge +
      '<button type="button" class="cbl-iconbtn" data-act="audio" aria-label="Sound settings">' +
      ICONS.sound + '<span>Sound</span></button>' +
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
      '<button type="button" class="cbl-btn cbl-primary cbl-start" data-act="start">Start</button>' +
      audioNotice() +
      "</div></div>";
  }

  function clockView(elapsed) {
    var cyc = cycleInfo(sess.mode, elapsed, sess.cycleStart);
    var frac = Math.max(0, Math.min(1, cyc.remaining / cyc.interval));
    var cls = paused ? "paused" : "running";
    return '<div class="cbl-clock ' + cls + '" data-state="' + (paused ? "paused" : "running") + '">' +
      '<div class="cbl-elapsed" aria-label="Elapsed time">' + esc(fmtMMSS(elapsed)) + "</div>" +
      '<div class="cbl-cycle">Cycle ' + cyc.cycleNumber + " <span aria-hidden='true'>|</span> " +
      (sess.mode === "neonatal" ? "Heart rate check " : "Rhythm check ") +
      (cyc.due ? "due" : "in " + fmtShort(Math.max(0, cyc.remaining))) + "</div>" +
      '<div class="cbl-bar" role="progressbar" aria-label="Time to next rhythm check" aria-valuemin="0" aria-valuemax="' +
      cyc.interval + '" aria-valuenow="' + Math.max(0, Math.round(cyc.remaining)) + '">' +
      '<span class="cbl-barfill" style="width:' + Math.round(frac * 100) + '%"></span></div></div>';
  }

  function dueView(elapsed) {
    var d = dueStrip(sess, elapsed, { paused: paused });
    return '<div class="cbl-due cbl-due-' + d.level + '" data-level="' + d.level +
      '" data-state="due-strip" role="status" aria-live="polite">' +
      '<span class="cbl-dueword">' + esc(dueWord(d.level)) + "</span>" +
      '<span class="cbl-duetext">' + esc(d.text) + "</span></div>";
  }

  function dueWord(level) {
    if (level === "overdue") return "Overdue";
    if (level === "due") return "Due";
    if (level === "rosc") return "ROSC";
    if (level === "paused") return "Paused";
    return "CPR";
  }

  function tilesView(elapsed) {
    var tiles = [
      { kind: "shock", icon: "shock", label: "Shock" },
      { kind: "epi", icon: "epi", label: "Epinephrine" },
      { kind: "rhythm", icon: "rhythm", label: "Rhythm" },
      !paused && (sess.rosc || sess.hadRosc)
        ? { kind: "rearrest", icon: "rearrest", label: "Re-arrest" }
        : { kind: "pause", icon: "pause", label: "Pause" },
      { kind: "proc", icon: "proc", label: "Procedure" },
      { kind: "note", icon: "note", label: "Note" },
      { kind: "rosc", icon: "rosc", label: "ROSC" }
    ];
    /* Re-arrest replaces Pause once ROSC has happened; otherwise Pause shows. */
    var html = '<div class="cbl-grid">';
    tiles.forEach(function (t) {
      html += '<button type="button" class="cbl-tile' + (t.kind === "rearrest" ? " cbl-tile-re" : "") +
        '" data-act="tile-' + t.kind + '" aria-label="' + esc(t.label) + '">' + tileInner(t.kind, t.label, elapsed) + "</button>";
    });
    return html + "</div>";
  }

  function tileInner(kind, label, elapsed) {
    var icon = ICONS[kind === "epi" ? "epi" : kind === "proc" ? "proc" : kind === "rearrest" ? "rearrest" : kind] || ICONS.note;
    return '<span class="cbl-tileicon">' + icon + "</span>" +
      '<span class="cbl-tilelabel">' + esc(label) + "</span>" +
      '<span class="cbl-tilesub">' + esc(tileSub(kind === "rearrest" ? "rearrest" : kind, elapsed)) + "</span>";
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

  function footerView() {
    var showChecks = sess.rosc || sess.hadRosc;
    return '<div class="cbl-foot">' +
      '<button type="button" class="cbl-footbtn" data-act="sheet-log">' + ICONS.log + "<span>Log</span></button>" +
      (showChecks ? '<button type="button" class="cbl-footbtn" data-act="sheet-checks" data-state="checklist-open">' +
        ICONS.check + "<span>Checklist</span></button>" : "") +
      '<button type="button" class="cbl-footbtn cbl-end" data-act="end">End</button></div>';
  }

  function errorView() {
    if (!storeError) return "";
    return '<p class="cbl-error" data-state="error" role="alert">Storage full. The log stays on screen but will not resume after close.</p>';
  }

  function runView() {
    var elapsed = nowElapsed();
    return statusRow() + '<div class="cbl-scroll"><div class="cbl-run">' +
      clockView(elapsed) + dueView(elapsed) + errorView() +
      tilesView(elapsed) + guideView(elapsed) + audioNotice() + "</div></div>" + footerView() +
      '<div class="cbl-toast" data-state="toast" role="status" aria-live="polite"></div>' +
      '<div class="cbl-sheetwrap"></div>';
  }

  function endedView() {
    var elapsed = elapsedOffset;
    var counts = computeCounts(sess.events);
    var interval = MODE_CONFIG[sess.mode].rhythmInterval;
    var canSheet = !sess.training;
    return statusRow() + '<div class="cbl-scroll"><div class="cbl-endview" data-state="ended">' +
      "<h2 class='cbl-h'>Code ended</h2>" +
      '<dl class="cbl-sum">' +
      "<div><dt>Duration</dt><dd>" + esc(fmtMMSS(elapsed)) + "</dd></div>" +
      "<div><dt>Cycles</dt><dd>" + Math.floor(elapsed / interval) + "</dd></div>" +
      "<div><dt>Shocks</dt><dd>" + counts.shocks + "</dd></div>" +
      "<div><dt>Epinephrine</dt><dd>" + counts.epi + "</dd></div>" +
      "<div><dt>ROSC</dt><dd>" + (sess.rosc ? "Yes" : "No") + "</dd></div></dl>" +
      (sess.training
        ? '<p class="cbl-disc">Practice only. Nothing was written to a patient record.</p>'
        : '<p class="cbl-disc">' + esc(DISCLAIMER) + "</p>") +
      (canSheet ? '<button type="button" class="cbl-btn cbl-primary" data-act="open-sheet">Open code sheet</button>' : "") +
      '<button type="button" class="cbl-btn" data-act="close">Done</button>' +
      "</div></div>";
  }

  function render() {
    if (!rootEl) return;
    if (view === "idle") rootEl.innerHTML = idleView();
    else if (view === "ended") rootEl.innerHTML = endedView();
    else rootEl.innerHTML = runView();
    rootEl.setAttribute("data-view", view);
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

  function logRows() {
    var elapsed = nowElapsed();
    if (!sess.events.length) {
      return '<p class="cbl-empty" data-state="empty-log">No events yet. Logged actions will appear here.</p>';
    }
    var rows = sess.events.slice().sort(function (a, b) { return a.elapsed - b.elapsed; });
    return '<ul class="cbl-log">' + rows.map(function (e) {
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
      try { t.classList.remove("on"); } catch (e) {}
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

  /* Repaint only the clock and strip between full renders. */
  function paintClock() {
    if (!rootEl || !sess || view !== "running") return;
    var elapsed = nowElapsed();
    var c = rootEl.querySelector(".cbl-clock");
    if (c) {
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
  }

  /* ---------------- actions ---------------- */

  function doStart() {
    var A = Audio();
    if (A) { try { A.unlock(); A.ensureWakeLock(); } catch (e) {} }
    sess = newSession(idleMode, { training: idleTraining });
    speed = sess.training ? TRAINING_SPEED : 1;
    elapsedOffset = 0;
    runStartWall = Date.now();
    paused = false;
    fired = {};
    storeError = false;
    view = "running";
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
    stopTick();
    var A = Audio();
    if (A) { try { A.shutdown(); } catch (e2) {} }
    if (!sess.training) {
      try { clearSnapshot(defaultStorage()); } catch (e3) {}
    }
    render();
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
        view = "running";
        render();
        startTick();
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
    if (!sess) return;

    if (act === "tile-shock") { afterEvent(logEvent(sess, "shock", null, elapsed), "shockLogged"); return; }
    if (act === "tile-epi") { afterEvent(logEvent(sess, "drug", "Epinephrine", elapsed), null); return; }
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
      var inp = rootEl.querySelector("#cblNoteIn");
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
      if (editEvent(sess, eid, next)) { persist(); refreshLogSheet(); render(); openLogSheet(); }
      return;
    }
    if (act === "log-del") {
      var did = el.getAttribute("data-id");
      if (deleteEvent(sess, did)) {
        persist();
        render();
        toast("Event deleted. ", did);
        openLogSheet();
      }
      return;
    }
    if (act === "toast-undo") {
      var uid = el.getAttribute("data-id");
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
      document.addEventListener("keydown", onKey);
      var css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = (opts.css || "/codeblue-live.css");
      document.head.appendChild(css);
    }
    if (opts.theme) rootEl.setAttribute("data-theme", opts.theme);
    if (opts.mode) idleMode = normMode(opts.mode);
    if (opts.training === true) idleTraining = true;
    if (opts.training === false) idleTraining = false;
    sess = null;
    view = "idle";
    elapsedOffset = 0;
    paused = false;
    pendingResume = null;
    storeError = false;
    lastFocus = document.activeElement;
    if (!opts.training && idleTraining !== true) {
      var snap = loadSnapshot(defaultStorage());
      if (snap) {
        var r = restoreSnapshot(snap, Date.now());
        if (r.ok === "resume") pendingResume = snap;
        else { try { clearSnapshot(defaultStorage()); } catch (e) {} }
      }
    }
    rootEl.classList.add("on");
    try { document.body.classList.add("cbl-lock"); } catch (e2) {}
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
    elapsed: function () { return nowElapsed(); },
    setElapsed: function (s) {
      elapsedOffset = Math.max(0, s);
      runStartWall = Date.now();
      if (view === "running") { fireCues(elapsedOffset); render(); }
    },
    storeError: function () { return storeError; }
  };

  return { open: open, close: close, isOpen: isOpen, _engine: _engine, _rt: _rt };
});




