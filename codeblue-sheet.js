/* Code Blue log review and code sheet (phone side, vanilla JS).
 *
 * A self-contained review screen for a finished code: timeline, label edits,
 * delete with undo, free-text notes, recomputed totals, a debrief card, share
 * as text and a one-page A4 PDF. It never attaches anything to a patient
 * record; the existing timeline summary behaviour is untouched.
 *
 * Pure helpers (parse, counts, debrief, plain text, PDF bytes) have no DOM
 * dependency and are unit tested. open() needs a DOM and degrades silently
 * without one. window.CodeBlueSheet + module.exports.
 */
(function () {
  "use strict";

  var CLINICAL_DISCLAIMER = "Timer, reminder, documentation and practice aid only. " +
    "Not a substitute for clinical judgement, formal resuscitation training or your institution's protocol.";
  var MOTION_DISCLAIMER = "Motion-based estimates, not a measure of CPR quality or depth.";

  var MODES = { adult: "Adult", paediatric: "Paediatric", pediatric: "Paediatric", neonatal: "Neonatal" };
  var NON_EPI = /amiodarone|lidocaine|lignocaine|atropine|adenosine|vasopressin|calcium|bicarb|magnesium|sodium|fluid|oxygen/i;

  function asNum(x, fb) { x = Number(x); return isFinite(x) && x >= 0 ? x : fb; }
  function asStr(x, fb) { return (typeof x === "string" && x.trim()) ? x : fb; }

  function normKind(k) {
    k = String(k == null ? "" : k).trim().toLowerCase();
    var map = {
      cprstart: "cprStart", shock: "shock", drug: "drug", pausestart: "pauseStart",
      resume: "resume", switchcompressor: "switchCompressor", rosc: "rosc",
      cprend: "cprEnd", rhythm: "rhythm", procedure: "procedure",
      rearrest: "reArrest", note: "note", modeset: "modeSet"
    };
    return map[k] || (k ? k : "note");
  }

  function defaultLabel(kind) {
    switch (kind) {
      case "cprStart": return "CPR started";
      case "cprEnd": return "CPR ended";
      case "shock": return "Shock delivered";
      case "drug": return "Medicine given";
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

  function normEvent(raw, i) {
    raw = raw || {};
    var kind = normKind(raw.kind);
    return {
      id: asStr(raw.id, "ev-" + i),
      elapsed: asNum(raw.elapsed, 0),
      kind: kind,
      label: asStr(raw.label, defaultLabel(kind)),
      edited: raw.edited === true
    };
  }

  /* Parse a code sheet payload. Accepts a v2 object, a JSON string, a v1
   * object (no "v") or anything falsy; missing fields get safe defaults. */
  function parsePayload(input) {
    var p = input;
    if (typeof p === "string") {
      try { p = JSON.parse(p); } catch (e) { p = null; }
    }
    if (!p || typeof p !== "object") p = {};
    var mode = String(p.mode || "adult").toLowerCase();
    if (mode === "pediatric") mode = "paediatric";
    if (!MODES[mode]) mode = "adult";
    var rawEvents = Array.isArray(p.events) ? p.events : [];
    var events = rawEvents.map(normEvent);
    events.sort(function (a, b) { return a.elapsed - b.elapsed; });
    var s = p.summary || {};
    return {
      v: p.v === 2 ? 2 : 1,
      mode: mode,
      startedAt: asStr(p.startedAt, ""),
      durationSeconds: asNum(p.durationSeconds, events.length ? events[events.length - 1].elapsed : 0),
      cycles: asNum(p.cycles, 0),
      events: events,
      summary: {
        compressions: asNum(s.compressions, 0),
        averageRateCPM: asNum(s.averageRateCPM, 0),
        compressionFractionPct: (typeof s.compressionFractionPct === "number" && isFinite(s.compressionFractionPct)) ? s.compressionFractionPct : null,
        targetRatePct: asNum(s.targetRatePct, 0),
        shockCount: asNum(s.shockCount, 0),
        adrenalineCount: asNum(s.adrenalineCount, 0),
        rosc: s.rosc === true
      },
      training: p.training === true,
      scene: normScene(p.scene),
      disclaimer: asStr(p.disclaimer || s.disclaimer, "")
    };
  }

  function isShock(ev) { return ev.kind === "shock"; }
  function isEpi(ev) { return ev.kind === "drug" && !NON_EPI.test(ev.label || ""); }
  function isPause(ev) { return ev.kind === "pauseStart"; }
  function isResume(ev) { return ev.kind === "resume"; }
  function isRhythm(ev) { return ev.kind === "rhythm"; }

  /* Counts are always recomputed from the event list, after any edit. */
  function computeCounts(events) {
    var epi = 0, shocks = 0;
    (events || []).forEach(function (ev) {
      if (isShock(ev)) shocks++;
      if (isEpi(ev)) epi++;
    });
    return { epi: epi, shocks: shocks };
  }

  function firstElapsed(events, pred) {
    var t = null;
    (events || []).forEach(function (ev) {
      if (pred(ev) && (t === null || ev.elapsed < t)) t = ev.elapsed;
    });
    return t;
  }

  function pauseStats(events, duration) {
    var pauses = 0, secs = 0, longest = 0, openAt = null;
    (events || []).forEach(function (ev) {
      if (isPause(ev)) { pauses++; if (openAt === null) openAt = ev.elapsed; }
      else if (isResume(ev) && openAt !== null) {
        var len = Math.max(0, ev.elapsed - openAt);
        secs += len; if (len > longest) longest = len; openAt = null;
      }
    });
    if (openAt !== null) {
      var openLen = Math.max(0, duration - openAt);
      secs += openLen; if (openLen > longest) longest = openLen;
    }
    return { pauses: pauses, pauseSeconds: Math.round(secs), longestPauseSeconds: Math.round(longest) };
  }

  function normScene(raw) {
    var out = { weightKg: null, setting: "", arrest: "", bystanderCpr: "", downTimeMin: null, shocksBeforeArrival: null, location: "", team: [] };
    if (!raw || typeof raw !== "object") return out;
    function num(x) { if (x == null || x === "") return null; var n = Number(x); return isFinite(n) && n >= 0 ? n : null; }
    out.weightKg = num(raw.weightKg); out.downTimeMin = num(raw.downTimeMin); out.shocksBeforeArrival = num(raw.shocksBeforeArrival);
    if (["In-hospital", "Out-of-hospital"].indexOf(raw.setting) >= 0) out.setting = raw.setting;
    if (["Witnessed", "Unwitnessed"].indexOf(raw.arrest) >= 0) out.arrest = raw.arrest;
    if (["Yes", "No"].indexOf(raw.bystanderCpr) >= 0) out.bystanderCpr = raw.bystanderCpr;
    out.location = String(raw.location == null ? "" : raw.location).slice(0, 80);
    if (Array.isArray(raw.team)) out.team = raw.team.map(function (n) { return String(n == null ? "" : n).trim().slice(0, 40); }).filter(Boolean).slice(0, 20);
    return out;
  }

  function computeDebrief(state) {
    var dur = state.durationSeconds;
    var ps = pauseStats(state.events, dur);
    var frac = state.summary.compressionFractionPct;
    if (frac === null) {
      frac = dur > 0 ? Math.max(0, Math.min(100, Math.round((dur - ps.pauseSeconds) / dur * 100))) : null;
    }
    var rhythms = state.events.filter(isRhythm).length;
    return {
      pauses: ps.pauses,
      pauseSeconds: ps.pauseSeconds,
      longestPauseSeconds: ps.longestPauseSeconds,
      compressionFractionPct: frac,
      timeToFirstShock: firstElapsed(state.events, isShock),
      timeToFirstEpi: firstElapsed(state.events, isEpi),
      rhythmCycles: rhythms > 0 ? rhythms : state.cycles
    };
  }

  function fmtMMSS(sec) {
    sec = Math.max(0, Math.floor(asNum(sec, 0)));
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? "0" + m : "" + m) + ":" + (s < 10 ? "0" + s : "" + s);
  }

  function fmtTimeOrDash(sec) { return sec === null ? "Not logged" : fmtMMSS(sec); }

  function modeLabel(mode) { return MODES[mode] || "Adult"; }

  /* Plain-text rendering, the shared fallback across platforms. */
  function renderText(state) {
    var c = computeCounts(state.events);
    var d = computeDebrief(state);
    var L = [];
    L.push("Code sheet (" + modeLabel(state.mode).toLowerCase() + ")" + (state.training ? " TRAINING" : ""));
    if (state.startedAt) L.push("Started: " + state.startedAt);
    L.push("Duration: " + fmtMMSS(state.durationSeconds));
    L.push("");
    L.push("Timeline:");
    if (!state.events.length) {
      L.push("  No events logged.");
    } else {
      state.events.forEach(function (ev) {
        L.push("  " + fmtMMSS(ev.elapsed) + "  " + ev.label + (ev.edited ? " (edited)" : ""));
      });
    }
    L.push("");
    L.push("Totals: epinephrine " + c.epi + ", shocks " + c.shocks + ".");
    L.push("Pauses: " + d.pauses + " (" + d.pauseSeconds + " s). Longest pause: " + d.longestPauseSeconds + " s.");
    if (state.scene && (state.scene.location || state.scene.setting || state.scene.team.length)) {
      var sc = state.scene;
      L.push("Scene: " + [sc.setting, sc.arrest, sc.location].filter(Boolean).join(", ") +
        (sc.team.length ? ". Team: " + sc.team.join(", ") : "") + ".");
    }
    L.push("Estimated compression fraction: " + (d.compressionFractionPct === null ? "not available" : d.compressionFractionPct + "%") + ".");
    L.push("Time to first shock: " + fmtTimeOrDash(d.timeToFirstShock) + ".");
    L.push("Time to first epinephrine: " + fmtTimeOrDash(d.timeToFirstEpi) + ".");
    L.push("Rhythm check cycles: " + d.rhythmCycles + ".");
    L.push("");
    L.push(CLINICAL_DISCLAIMER);
    L.push(MOTION_DISCLAIMER);
    return L.join("\n");
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  /* One A4 page: header, blank patient line, timeline table, totals, disclaimer.
   * JSImpl defaults to the repo's vendored jsPDF; tests inject a mock. */
  function buildPdfBytes(state, JSImpl) {
    var JS = JSImpl || null;
    if (!JS && typeof window !== "undefined") JS = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF || null;
    if (!JS) throw new Error("PDF engine unavailable");
    var pdf = new JS({ unit: "pt", format: "a4" });
    var W = pdf.internal.pageSize.getWidth();
    var H = pdf.internal.pageSize.getHeight();
    var mg = 48, y = 56, maxY = H - 60;
    var c = computeCounts(state.events);
    var d = computeDebrief(state);

    function line(text, size, bold, gap) {
      pdf.setFont("helvetica", bold ? "bold" : "normal");
      pdf.setFontSize(size);
      var parts = pdf.splitTextToSize(String(text), W - mg * 2);
      for (var i = 0; i < parts.length && y < maxY; i++) {
        pdf.text(parts[i], mg, y);
        y += size * 1.35;
      }
      y += (gap == null ? 4 : gap);
    }

    line("Code sheet (" + modeLabel(state.mode).toLowerCase() + ")" + (state.training ? " TRAINING" : ""), 16, true, 2);
    if (state.startedAt) line("Started: " + state.startedAt, 10, false, 0);
    line("Duration: " + fmtMMSS(state.durationSeconds), 10, false, 2);
    line("Patient: ________________________________", 11, false, 8);
    line("Timeline", 12, true, 2);
    pdf.setFont("courier", "normal");
    pdf.setFontSize(9.5);
    var rows = state.events.length ? state.events : [{ elapsed: 0, label: "No events logged.", edited: false }];
    var shown = 0;
    for (var r = 0; r < rows.length; r++) {
      if (y > maxY - 14) break;
      var row = fmtMMSS(rows[r].elapsed) + "  " + rows[r].label + (rows[r].edited ? " (edited)" : "");
      var cut = pdf.splitTextToSize(row, W - mg * 2);
      if (y + cut.length * 12 > maxY) break;
      cut.forEach(function (part) { pdf.text(part, mg, y); y += 12; });
      shown++;
    }
    if (shown < rows.length) {
      pdf.setFont("helvetica", "normal"); pdf.setFontSize(9.5);
      pdf.text("+ " + (rows.length - shown) + " further events (see phone log).", mg, y); y += 16;
    } else { y += 4; }
    line("Totals: epinephrine " + c.epi + ", shocks " + c.shocks + ".", 10, true, 0);
    line("Pauses: " + d.pauses + " (" + d.pauseSeconds + " s). Estimated compression fraction: " +
      (d.compressionFractionPct === null ? "not available" : d.compressionFractionPct + "%") + ".", 10, false, 0);
    line("Time to first shock: " + fmtTimeOrDash(d.timeToFirstShock) + ". " +
      "Time to first epinephrine: " + fmtTimeOrDash(d.timeToFirstEpi) + ". " +
      "Rhythm check cycles: " + d.rhythmCycles + ".", 10, false, 6);
    line(CLINICAL_DISCLAIMER, 8.5, false, 0);
    line(MOTION_DISCLAIMER, 8.5, false, 0);

    var out = pdf.output("arraybuffer");
    var bytes = out instanceof Uint8Array ? out : new Uint8Array(out || []);
    var pages = (typeof pdf.getNumberOfPages === "function") ? pdf.getNumberOfPages() : 1;
    return { bytes: bytes, pages: pages };
  }

  /* Map a native watch event to a payload. v2 JSON travels as ev.payload or
   * ev.json (object or string); anything else yields safe defaults. */
  function fromWatchEvent(ev) {
    if (!ev || typeof ev !== "object") return parsePayload(null);
    var p = ev.payload !== undefined ? ev.payload : ev.json;
    if (p === undefined) {
      if (typeof ev.detail === "string" && ev.detail) {
        try { return parsePayload(JSON.parse(ev.detail)); } catch (e) { return parsePayload(null); }
      }
      return parsePayload(null);
    }
    return parsePayload(p);
  }

  /* ---- Review screen (DOM) ---- */

  var _openHandle = null;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function closeSheet() {
    if (_openHandle && _openHandle.overlay && _openHandle.overlay.remove) {
      _openHandle.overlay.remove();
    }
    _openHandle = null;
  }

  function setStatus(handle, msg) {
    if (handle.statusEl) handle.statusEl.textContent = msg;
  }

  function shareText(handle) {
    var text = renderText(handle.state);
    var nav = (typeof navigator !== "undefined") ? navigator : {};
    try {
      if (typeof nav.share === "function") {
        return nav.share({ text: text }).then(function () {
          setStatus(handle, "Shared.");
        }, function () {
          setStatus(handle, "Share cancelled.");
        });
      }
      throw new Error("no share");
    } catch (e) {
      try {
        if (nav.clipboard && typeof nav.clipboard.writeText === "function") {
          return nav.clipboard.writeText(text).then(function () {
            setStatus(handle, "Copied to clipboard.");
          }, function () {
            setStatus(handle, "Copy failed. The sheet text is on screen.");
          });
        }
        setStatus(handle, "Sharing is not available. The sheet text is on screen.");
      } catch (e2) {
        setStatus(handle, "Sharing is not available. The sheet text is on screen.");
      }
    }
    return Promise.resolve();
  }

  function pdfAction(handle) {
    var nav = (typeof navigator !== "undefined") ? navigator : {};
    var built;
    try {
      built = buildPdfBytes(handle.state);
    } catch (e) {
      setStatus(handle, "PDF engine unavailable. Use Share as text.");
      return Promise.resolve();
    }
    try {
      var blob = new Blob([built.bytes], { type: "application/pdf" });
      var file = null;
      try { file = new File([blob], "code-sheet.pdf", { type: "application/pdf" }); } catch (e2) { file = null; }
      if (file && typeof nav.share === "function" && (!nav.canShare || nav.canShare({ files: [file] }))) {
        return nav.share({ files: [file], title: "Code sheet" }).then(function () {
          setStatus(handle, "Shared.");
        }, function () {
          setStatus(handle, "Share cancelled.");
        });
      }
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "code-sheet.pdf";
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { try { URL.revokeObjectURL(url); a.remove(); } catch (e3) {} }, 4000);
      setStatus(handle, "PDF downloaded.");
    } catch (e4) {
      setStatus(handle, "PDF failed. Use Share as text.");
    }
    return Promise.resolve();
  }

  function renderBody(handle) {
    var st = handle.state;
    var body = handle.listEl;
    while (body.firstChild) body.removeChild(body.firstChild);
    if (!st.events.length) {
      var empty = el("p", "cb-empty", "No events logged on this code.");
      empty.setAttribute("role", "status");
      body.appendChild(empty);
    }
    st.events.forEach(function (ev) {
      var row = el("div", "cb-row");
      row.setAttribute("data-ev", ev.id);
      var t = el("span", "cb-t", fmtMMSS(ev.elapsed));
      var mid = el("div", "cb-mid");
      if (handle.editingId === ev.id) {
        var input = el("input", "cb-edit");
        input.type = "text";
        input.value = ev.label;
        input.setAttribute("aria-label", "Event label");
        input.maxLength = 140;
        mid.appendChild(input);
        handle.editInput = input;
      } else {
        var lab = el("span", "cb-label", ev.label);
        mid.appendChild(lab);
        if (ev.edited) mid.appendChild(el("span", "cb-edited", "edited"));
        mid.appendChild(el("span", "cb-kind", ev.kind));
      }
      var acts = el("div", "cb-acts");
      if (handle.editingId === ev.id) {
        var save = el("button", "cb-btn cb-small", "Save");
        save.type = "button";
        save.addEventListener("click", function () { commitEdit(handle, ev.id, handle.editInput ? handle.editInput.value : ev.label); });
        var cancel = el("button", "cb-btn cb-small cb-quiet", "Cancel");
        cancel.type = "button";
        cancel.addEventListener("click", function () { handle.editingId = null; renderBody(handle); });
        acts.appendChild(save); acts.appendChild(cancel);
      } else {
        var eb = el("button", "cb-btn cb-small", "Edit");
        eb.type = "button";
        eb.setAttribute("aria-label", "Edit label for event at " + fmtMMSS(ev.elapsed));
        eb.addEventListener("click", function () { handle.editingId = ev.id; renderBody(handle); if (handle.editInput) handle.editInput.focus(); });
        var db = el("button", "cb-btn cb-small cb-quiet", "Delete");
        db.type = "button";
        db.setAttribute("aria-label", "Delete event at " + fmtMMSS(ev.elapsed));
        db.addEventListener("click", function () { deleteEvent(handle, ev.id); });
        acts.appendChild(eb); acts.appendChild(db);
      }
      row.appendChild(t); row.appendChild(mid); row.appendChild(acts);
      body.appendChild(row);
    });

    var c = computeCounts(st.events);
    handle.totalsEl.textContent = "Epinephrine " + c.epi + "  |  Shocks " + c.shocks;
    var d = computeDebrief(st);
    handle.debriefEl.innerHTML = "";
    var items = [
      ["Pauses", d.pauses ? d.pauses + ", longest " + d.longestPauseSeconds + " s" : "None"],
      ["Estimated compression fraction", d.compressionFractionPct === null ? "Not available" : d.compressionFractionPct + "%"],
      ["Time to first shock", fmtTimeOrDash(d.timeToFirstShock)],
      ["Time to first epinephrine", fmtTimeOrDash(d.timeToFirstEpi)],
      ["Rhythm check cycles", String(d.rhythmCycles)]
    ];
    items.forEach(function (pair) {
      var dt = document.createElement("div");
      dt.className = "cb-dt";
      var k = el("span", "cb-dk", pair[0]);
      var v = el("span", "cb-dv", pair[1]);
      dt.appendChild(k); dt.appendChild(v);
      handle.debriefEl.appendChild(dt);
    });

    if (handle.undoStack.length) {
      handle.undoEl.style.display = "";
      handle.undoEl.querySelector("span").textContent = "Event deleted.";
    } else {
      handle.undoEl.style.display = "none";
    }
  }

  function commitEdit(handle, id, label) {
    label = String(label == null ? "" : label).trim().slice(0, 140);
    for (var i = 0; i < handle.state.events.length; i++) {
      if (handle.state.events[i].id === id) {
        if (label) {
          handle.state.events[i].label = label;
          handle.state.events[i].edited = true;
        }
        break;
      }
    }
    handle.editingId = null;
    renderBody(handle);
  }

  function deleteEvent(handle, id) {
    for (var i = 0; i < handle.state.events.length; i++) {
      if (handle.state.events[i].id === id) {
        handle.undoStack.push({ ev: handle.state.events[i], index: i });
        handle.state.events.splice(i, 1);
        break;
      }
    }
    if (handle.editingId === id) handle.editingId = null;
    renderBody(handle);
  }

  function undoDelete(handle) {
    var last = handle.undoStack.pop();
    if (!last) return;
    handle.state.events.splice(Math.min(last.index, handle.state.events.length), 0, last.ev);
    renderBody(handle);
  }

  function addNote(handle, text) {
    text = String(text == null ? "" : text).trim().slice(0, 280);
    if (!text) return false;
    var n = 1;
    handle.state.events.forEach(function (ev) { if (ev.id.indexOf("note-") === 0) n++; });
    handle.state.events.push({ id: "note-" + Date.now() + "-" + n, elapsed: handle.state.durationSeconds, kind: "note", label: text, edited: false });
    handle.state.events.sort(function (a, b) { return a.elapsed - b.elapsed; });
    renderBody(handle);
    return true;
  }

  function open(payload) {
    if (typeof document === "undefined" || !document.createElement || !document.body) return null;
    closeSheet();
    var state = parsePayload(payload);
    var overlay = el("div", "cb-sheet-ov");
    var card = el("div", "cb-sheet");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-label", "Code sheet review");

    var head = el("div", "cb-head");
    var titleWrap = el("div", "cb-titlewrap");
    titleWrap.appendChild(el("h2", "cb-title", "Code sheet"));
    var sub = el("p", "cb-sub", modeLabel(state.mode) + "  |  " + fmtMMSS(state.durationSeconds) +
      (state.training ? "  |  TRAINING" : ""));
    titleWrap.appendChild(sub);
    head.appendChild(titleWrap);
    var close = el("button", "cb-x", "Close");
    close.type = "button";
    close.setAttribute("aria-label", "Close code sheet");
    close.addEventListener("click", closeSheet);
    head.appendChild(close);
    card.appendChild(head);

    var note = el("p", "cb-attach", "Not attached to a patient record. Kept on this device only.");
    card.appendChild(note);

    card.appendChild(el("h3", "cb-h", "Timeline"));
    var list = el("div", "cb-list");
    card.appendChild(list);

    var undo = el("div", "cb-undo");
    undo.style.display = "none";
    var umsg = el("span", "", "Event deleted.");
    var ubtn = el("button", "cb-btn cb-small", "Undo");
    ubtn.type = "button";
    undo.appendChild(umsg); undo.appendChild(ubtn);
    card.appendChild(undo);

    card.appendChild(el("h3", "cb-h", "Add a note"));
    var noteRow = el("div", "cb-noterow");
    var noteInput = el("input", "cb-note");
    noteInput.type = "text";
    noteInput.setAttribute("aria-label", "Free text note");
    noteInput.setAttribute("placeholder", "Free text note");
    noteInput.maxLength = 280;
    var noteBtn = el("button", "cb-btn", "Add");
    noteBtn.type = "button";
    noteRow.appendChild(noteInput); noteRow.appendChild(noteBtn);
    card.appendChild(noteRow);

    card.appendChild(el("h3", "cb-h", "Totals"));
    var totals = el("p", "cb-totals", "");
    card.appendChild(totals);

    card.appendChild(el("h3", "cb-h", "Debrief"));
    var debrief = el("div", "cb-debrief");
    card.appendChild(debrief);

    var discs = el("div", "cb-discs");
    discs.appendChild(el("p", "cb-disc", CLINICAL_DISCLAIMER));
    discs.appendChild(el("p", "cb-disc", state.disclaimer || MOTION_DISCLAIMER));
    card.appendChild(discs);

    var actions = el("div", "cb-actions");
    var shareBtn = el("button", "cb-btn cb-primary", "Share as text");
    shareBtn.type = "button";
    var pdfBtn = el("button", "cb-btn", "PDF");
    pdfBtn.type = "button";
    pdfBtn.setAttribute("aria-label", "Download or share PDF code sheet");
    actions.appendChild(shareBtn); actions.appendChild(pdfBtn);
    card.appendChild(actions);
    var status = el("p", "cb-status", "");
    status.setAttribute("role", "status");
    card.appendChild(status);

    overlay.appendChild(card);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) closeSheet(); });

    var handle = {
      overlay: overlay, card: card, state: state, listEl: list,
      totalsEl: totals, debriefEl: debrief, undoEl: undo, statusEl: status,
      undoStack: [], editingId: null, editInput: null,
      durationSeconds: state.durationSeconds,
      close: closeSheet,
      share: function () { return shareText(handle); },
      pdf: function () { return pdfAction(handle); },
      editLabel: function (id, label) { commitEdit(handle, id, label); },
      deleteEvent: function (id) { deleteEvent(handle, id); },
      undo: function () { undoDelete(handle); },
      addNote: function (t) {
        var ok = addNote(handle, t);
        if (ok) noteInput.value = "";
        return ok;
      }
    };
    ubtn.addEventListener("click", function () { undoDelete(handle); });
    noteBtn.addEventListener("click", function () {
      if (addNote(handle, noteInput.value)) noteInput.value = "";
      else noteInput.focus();
    });
    shareBtn.addEventListener("click", function () { shareText(handle); });
    pdfBtn.addEventListener("click", function () { pdfAction(handle); });

    renderBody(handle);
    document.body.appendChild(overlay);
    try {
      if (typeof window !== "undefined" && window.CodeBluePrefs) {
        window.CodeBluePrefs.apply(card);
      }
    } catch (e) {}
    _openHandle = handle;
    if (close.focus) { try { close.focus(); } catch (e) {} }
    return handle;
  }

  var API = {
    open: open,
    fromWatchEvent: fromWatchEvent,
    parsePayload: parsePayload,
    computeCounts: computeCounts,
    computeDebrief: computeDebrief,
    renderText: renderText,
    buildPdfBytes: buildPdfBytes,
    fmtMMSS: fmtMMSS,
    CLINICAL_DISCLAIMER: CLINICAL_DISCLAIMER,
    MOTION_DISCLAIMER: MOTION_DISCLAIMER,
    _esc: esc
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.CodeBlueSheet = API;
})();
