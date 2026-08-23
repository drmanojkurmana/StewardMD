/* clinix-screens.js — CliniX · screens + router + the lesson runner.
 * Sibling of thorex-screens.js / sknx-screens.js. Scoped to #clinixRoot / #clinixScroll / .cx-*.
 *
 * The lesson runner is the product. A lesson is NOT a page that scrolls: it is a sequence of turns
 * played one at a time, where the student is asked before being told and has to tap to reveal a
 * finding. That is what makes the phone feel like a teacher rather than a textbook.
 *
 * All data-act values are prefixed cx-* so they cannot collide with home.js's ACT map.
 * Back/close controls use .cx-back / .cx-close so swipe-back.js picks them up with no wiring.
 */
(function () {
  "use strict";

  /* ── helpers ─────────────────────────────────────────────────────────────── */

  function ic(n) { return '<span class="material-symbols-rounded" aria-hidden="true">' + n + "</span>"; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function haptic(k) {
    try {
      if (window.SMD_CLINIX_FLAGS && SMD_CLINIX_FLAGS.bool("smd_clinix_haptics") &&
          window.SMD_HAPTICS && SMD_HAPTICS[k]) SMD_HAPTICS[k]();
    } catch (e) {}
  }
  function toast(m) { try { if (window.toast) window.toast(m); } catch (e) {} }

  function C() { try { return window.SMD_CLINIX_CONTENT || null; } catch (e) { return null; } }
  function M() { try { return window.SMD_CLINIX_MODEL || null; } catch (e) { return null; } }
  function P() { try { return window.SMD_CLINIX_PROGRESS || null; } catch (e) { return null; } }
  function flag(k) { try { return !!(window.SMD_CLINIX_FLAGS && SMD_CLINIX_FLAGS.bool(k)); } catch (e) { return false; } }

  /* ── state ───────────────────────────────────────────────────────────────── */

  var state = {
    stack: [],
    catalog: null,
    built: null,
    skillsAll: null,          // the loaded disease bundle
    systemId: null,
    diseaseId: null,
    chapterId: null,
    skillId: null,
    turns: [],
    turnIndex: 0,
    answered: {},         // turnIndex -> {correct, given, revealed}
    revealed: {},         // turnIndex -> true
    station: null,
    stationChecked: {},
    stationEndsAt: 0,
    stationTimer: null,
    diaFocus: "both",
    diaZone: null,
    diaMode: null,
    diaView: "both",
    audioKind: null,
    caseDef: null,
    casePhase: "history",
    caseLog: [],
    caseTaken: { asked: [], examined: [], investigated: [], differential: null, diagnosis: null, management: null },
    caseReveal: {},
    caseResult: null,
    tutorLog: [],
    viva: null,
    vivaState: null,
    vivaCurrent: null,
    loading: false
  };

  /* ── shared chrome ───────────────────────────────────────────────────────── */

  function header(title, sub, backAct) {
    return '<header class="cx-head">' +
      '<button type="button" class="cx-back" data-act="' + esc(backAct || "cx-back") + '" aria-label="Back">' + ic("arrow_back") + "</button>" +
      '<div class="cx-head-txt"><div class="cx-head-title">' + esc(title) + "</div>" +
      (sub ? '<div class="cx-head-sub">' + esc(sub) + "</div>" : "") + "</div>" +
      '<button type="button" class="cx-close" data-act="cx-close" aria-label="Close CliniX">' + ic("close") + "</button>" +
      "</header>";
  }

  function progressBar(pct, label) {
    pct = Math.max(0, Math.min(100, pct | 0));
    return '<div class="cx-prog" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100">' +
      '<div class="cx-prog-track"><div class="cx-prog-fill" style="width:' + pct + '%"></div></div>' +
      (label ? '<div class="cx-prog-label">' + esc(label) + "</div>" : "") + "</div>";
  }

  function emptyState(icon, title, msg, actHtml) {
    return '<div class="cx-state">' +
      '<div class="cx-state-icon">' + ic(icon) + "</div>" +
      '<div class="cx-state-title">' + esc(title) + "</div>" +
      '<div class="cx-state-msg">' + esc(msg) + "</div>" +
      (actHtml || "") + "</div>";
  }

  /* A pending-review notice. Never render a short pathway silently: a UI that degrades by omission
   * lies about the data, which is the lesson recorded in the profile-page decision of 2026-08-22. */
  function pendingNotice(avail) {
    if (!avail || !avail.pending) return "";
    return '<div class="cx-notice cx-notice--review">' + ic("gpp_maybe") +
      "<div><b>" + avail.pending + " of " + avail.total + " lessons are awaiting clinical sign-off</b>" +
      "<span>CliniX shows a lesson to students only after a clinician has approved it. " +
      "Turn on author mode to review the drafts.</span></div></div>";
  }

  /* ── screen: home ────────────────────────────────────────────────────────── */

  function renderHome(host) {
    var cat = state.catalog;
    if (!cat) { host.innerHTML = header("CliniX", "Clinical learning") + skeleton(); return; }

    var pos = P() && P().position();
    var html = "";

    html += '<section class="cx-hero">' +
      '<button type="button" class="cx-close cx-hero-close" data-act="cx-close" aria-label="Close CliniX">' + ic("close") + "</button>" +
      '<div class="cx-hero-mark">CliniX</div>' +
      '<div class="cx-hero-tag">Clinical learning. From patient to treatment.</div>' +
      "</section>";

    // Continue where you left off. This is the first thing on the screen because resuming is the
    // commonest reason a student opens a learning app at all.
    if (pos && pos.diseaseId) {
      var label = pos.skillId ? pos.skillId.split(".").pop().replace(/_/g, " ") : "your lesson";
      html += '<section class="cx-sec"><div class="cx-sec-h">Continue learning</div>' +
        '<button type="button" class="cx-resume" data-act="cx-resume">' +
        '<div class="cx-resume-txt"><div class="cx-resume-t">' + esc(String(pos.diseaseId).toUpperCase()) + "</div>" +
        '<div class="cx-resume-s">' + esc(label) + "</div></div>" + ic("play_arrow") + "</button></section>";
    }

    // Learning the examination itself comes FIRST. A student who wants to know how to percuss
    // should not have to pick a disease to get there.
    html += '<section class="cx-sec"><div class="cx-sec-h">Learn the examination</div><div class="cx-rows">' +
      row("cx-skills", "stethoscope", "Examination skills", "Technique, step by step, with demonstrations") +
      "</div></section>";

    // Systems
    html += '<section class="cx-sec"><div class="cx-sec-h">Learn by disease</div><div class="cx-sys-grid">';
    var systems = cat.systems || [];
    for (var i = 0; i < systems.length; i++) {
      var s = systems[i];
      var n = (s.diseases || []).length;
      html += '<button type="button" class="cx-sys' + (n ? "" : " cx-sys--empty") + '" data-act="cx-system" data-id="' + esc(s.id) + '">' +
        '<span class="cx-sys-ic">' + ic(s.icon || "stethoscope") + "</span>" +
        '<span class="cx-sys-t">' + esc(s.title) + "</span>" +
        '<span class="cx-sys-n">' + (n ? n + (n === 1 ? " topic" : " topics") : "Coming soon") + "</span>" +
        "</button>";
    }
    html += "</div></section>";

    // Practice modes. They are listed here, but they are not separate content: every one of them
    // runs over the same skill objects the lessons use.
    html += '<section class="cx-sec"><div class="cx-sec-h">Practice</div><div class="cx-rows">' +
      row("cx-practice-osce", "assignment_turned_in", "OSCE stations", "Timed, with a marking scheme") +
      row("cx-practice-viva", "record_voice_over", "Viva", "An examiner that adapts to your answers") +
      "</div></section>";

    // Weak areas, driven by the same competency records every mode writes.
    var weak = P() ? P().weakest(4) : [];
    if (weak.length) {
      html += '<section class="cx-sec"><div class="cx-sec-h">Needs work</div><div class="cx-rows">';
      for (var w = 0; w < weak.length; w++) {
        var pct = Math.round((weak[w].accuracy || 0) * 100);
        html += '<div class="cx-weak"><div class="cx-weak-t">' + esc(prettySkill(weak[w].skillId)) + "</div>" +
          '<div class="cx-weak-b">' + progressBar(pct, pct + "% correct over " + weak[w].seen + " attempts") + "</div></div>";
      }
      html += "</div></section>";
    }

    html += '<section class="cx-sec"><div class="cx-rows">' +
      row("cx-competency", "insights", "Your competency", "Skill by skill, across every mode") +
      "</div></section>";

    html += disclaimer();
    host.innerHTML = html;
  }

  function row(act, icon, title, sub) {
    return '<button type="button" class="cx-row" data-act="' + esc(act) + '">' +
      '<span class="cx-row-ic">' + ic(icon) + "</span>" +
      '<span class="cx-row-txt"><span class="cx-row-t">' + esc(title) + "</span>" +
      '<span class="cx-row-s">' + esc(sub) + "</span></span>" + ic("chevron_right") + "</button>";
  }

  function prettySkill(id) {
    var parts = String(id).split(".");
    return parts[parts.length - 1].replace(/_/g, " ").replace(/^./, function (c) { return c.toUpperCase(); });
  }

  function disclaimer() {
    return '<div class="cx-disclaimer">CliniX is a learning tool for medical students. ' +
      "It does not prescribe, does not give advice about a real patient, and never replaces your clinical teachers. " +
      "Confirm every dose against your current national or institutional guideline.</div>";
  }

  function skeleton() {
    return '<div class="cx-skel"><div class="cx-skel-line"></div><div class="cx-skel-line cx-skel-sm"></div>' +
      '<div class="cx-skel-block"></div><div class="cx-skel-block"></div></div>';
  }

  /* ── screen: system ──────────────────────────────────────────────────────── */

  function renderSystem(host) {
    var cat = state.catalog;
    var sys = C() && C().systemById(cat, state.systemId);
    if (!sys) { host.innerHTML = header("Systems") + emptyState("error", "System not found", "Go back and pick another system."); return; }

    var html = header(sys.title, "Choose a topic");
    var ds = sys.diseases || [];
    if (!ds.length) {
      html += emptyState("hourglass_top", sys.title + " is coming",
        "The CliniX engine is system-agnostic, so this system needs content rather than code. Respiratory is the reference implementation.");
      host.innerHTML = html; return;
    }
    html += '<div class="cx-rows cx-rows--pad">';
    for (var i = 0; i < ds.length; i++) {
      var d = ds[i];
      html += '<button type="button" class="cx-row cx-row--dz" data-act="cx-disease" data-id="' + esc(d.id) + '">' +
        '<span class="cx-row-txt"><span class="cx-row-t">' + esc(d.title) + "</span>" +
        '<span class="cx-row-s">' + esc(d.subtitle || "") + "</span>" +
        '<span class="cx-row-meta">' + esc(String(d.chapters || 0)) + " chapters &middot; about " + esc(String(d.estMinutes || 0)) + " min</span>" +
        "</span>" + ic("chevron_right") + "</button>";
    }
    html += "</div>";
    host.innerHTML = html;
  }

  /* ── screen: SKILLS LIBRARY ──────────────────────────────────────────────── */

  /* The door that was missing. Skills were always teachable on their own - compileLesson() never
   * needed a disease - but the only way in was through a disease pathway, so "teach me how to
   * percuss" was unreachable. This lists every skill by what you are DOING. */
  function renderSkills(host) {
    var b = state.skillsAll;
    if (!b) { host.innerHTML = header("Examination skills", "Learn the technique itself") + skeleton(); return; }
    var groups = C().skillGroups(b);
    var html = header("Examination skills", "Learn the technique, no disease needed");

    if (!groups.length) {
      html += emptyState("gpp_maybe", "Awaiting clinical review", "No skill is approved for students yet.");
      host.innerHTML = html; return;
    }
    var totalIds = [], gi, si;
    for (gi = 0; gi < groups.length; gi++) for (si = 0; si < groups[gi].skills.length; si++) totalIds.push(groups[gi].skills[si].id);
    var comp = P() ? P().competency(totalIds) : { mastered: 0 };
    html += '<div class="cx-pathhead">' + progressBar(
      totalIds.length ? Math.round((comp.mastered / totalIds.length) * 100) : 0,
      comp.mastered + " of " + totalIds.length + " skills mastered") + "</div>";

    for (gi = 0; gi < groups.length; gi++) {
      var g = groups[gi];
      html += '<section class="cx-sec"><div class="cx-sec-h">' + esc(g.title) + "</div>" +
        '<div class="cx-blurb cx-blurb--tight">' + esc(g.blurb) + "</div>" + '<div class="cx-rows">';
      for (si = 0; si < g.skills.length; si++) {
        var sk = g.skills[si];
        var m = P() ? P().mastery(sk.id) : { level: "new", pct: 0 };
        var nMedia = countRenderableMedia(b, sk);
        html += '<button type="button" class="cx-row cx-row--skill" data-act="cx-skill" data-id="' + esc(sk.id) + '">' +
          '<span class="cx-row-ic cx-m-' + esc(m.level) + '">' + ic(masteryIcon(m.level)) + "</span>" +
          '<span class="cx-row-txt"><span class="cx-row-t">' + esc(sk.title) + "</span>" +
          '<span class="cx-row-s">' + esc(sk.oneLine || "") + "</span>" +
          '<span class="cx-row-meta">' + esc(masteryLabel(m)) + (nMedia ? " &middot; " + nMedia + " visual" + (nMedia > 1 ? "s" : "") : "") + "</span></span>" +
          (nMedia ? '<span class="cx-row-media">' + ic("play_circle") + "</span>" : "") +
          ic("chevron_right") + "</button>";
      }
      html += "</div></section>";
    }
    html += disclaimer();
    host.innerHTML = html;
  }

  function countRenderableMedia(built, sk) {
    var ids = sk.media || [], n = 0;
    for (var i = 0; i < ids.length; i++) {
      var m = C().media(built, ids[i]);
      if (m && (m.renderable || m.embeddable)) n++;
    }
    return n;
  }

  function openSkills() {
    state.loading = true;
    go("skills");
    C().loadAllSkills().then(function (b) {
      state.skillsAll = b;
      if (!b) { toast("Could not load the skill library"); back(); return; }
      repaint();
    });
  }

  /* Open a skill on its own: no disease, so no emphasis overlay. */
  function openSkillLesson(skillId) {
    var b = state.skillsAll;
    if (!b) return;
    state.built = b;
    state.diseaseId = null;
    state.chapterId = null;
    state.skillId = skillId;
    state.turns = C().lessonFor(b, skillId, null);
    state.turnIndex = 0;
    state.answered = {}; state.revealed = {}; state.tutorLog = [];
    state.diaFocus = "both"; state.diaZone = null; state.diaMode = null; state.diaView = "both";
    stopAudio();
    if (!state.turns.length) { toast("That skill is not available yet"); return; }
    go("lesson");
  }

  /* ── screen: disease pathway ─────────────────────────────────────────────── */

  function renderDisease(host) {
    var b = state.built;
    if (!b) { host.innerHTML = header("Loading") + skeleton(); return; }

    var pathway = C().pathwayFor(b);
    var avail = C().availability(b);
    var d = b.disease;

    var html = header(d.name, d.oneLine);
    html += pendingNotice(avail);

    if (!pathway.length || avail.visible === 0) {
      html += emptyState("gpp_maybe", "Awaiting clinical review",
        "All " + avail.total + " lessons for " + d.name + " are drafted and cited but not yet signed off by a clinician. " +
        "Nothing is shown to a student until it is.",
        '<button type="button" class="cx-btn cx-btn--ghost" data-act="cx-authormode">Turn on author mode</button>');
      host.innerHTML = html;
      return;
    }

    // The pathway rail. Every chapter is shown even when empty, so the student sees the shape of
    // the journey rather than a mysteriously short list.
    var allIds = M().pathwaySkillIds(pathway);
    var comp = P() ? P().competency(allIds) : { mastered: 0, total: allIds.length, pct: 0 };
    html += '<div class="cx-pathhead">' + progressBar(
      allIds.length ? Math.round((comp.mastered / allIds.length) * 100) : 0,
      comp.mastered + " of " + allIds.length + " skills mastered") + "</div>";

    html += '<ol class="cx-rail">';
    for (var i = 0; i < pathway.length; i++) {
      var c = pathway[i];
      var cComp = P() ? P().competency(c.skillIds) : { mastered: 0, total: c.count };
      var done = c.count > 0 && cComp.mastered === c.count;
      html += '<li class="cx-rail-item' + (c.empty ? " cx-rail-item--empty" : "") + (done ? " cx-rail-item--done" : "") + '">' +
        '<button type="button" class="cx-rail-btn" data-act="cx-chapter" data-id="' + esc(c.id) + '"' + (c.empty ? " disabled" : "") + ">" +
        '<span class="cx-rail-n">' + (done ? ic("check") : String(i + 1)) + "</span>" +
        '<span class="cx-rail-txt"><span class="cx-rail-t">' + esc(c.title) + "</span>" +
        '<span class="cx-rail-s">' + esc(c.empty ? "Awaiting review" : (c.blurb || (c.count + (c.count === 1 ? " skill" : " skills")))) + "</span></span>" +
        (c.empty ? ic("lock") : ic("chevron_right")) + "</button></li>";
    }
    html += "</ol>";

    var cases = C().casesFor(b);
    if (cases.length) {
      html += '<section class="cx-sec"><div class="cx-sec-h">Clinical cases</div><div class="cx-rows">';
      for (var ci = 0; ci < cases.length; ci++) {
        html += '<button type="button" class="cx-row" data-act="cx-case" data-id="' + esc(cases[ci].id) + '">' +
          '<span class="cx-row-ic">' + ic("personal_injury") + "</span>" +
          '<span class="cx-row-txt"><span class="cx-row-t">' + esc(cases[ci].title) + "</span>" +
          '<span class="cx-row-s">A simulated patient. History, examination, tests, then commit.</span></span>' +
          ic("chevron_right") + "</button>";
      }
      html += "</div></section>";
    }

    var sts = (d.osce && d.osce.stations) || [];
    if (sts.length) {
      html += '<section class="cx-sec"><div class="cx-sec-h">Assess yourself</div><div class="cx-rows">';
      for (var s = 0; s < sts.length; s++) {
        html += '<button type="button" class="cx-row" data-act="cx-station" data-id="' + esc(sts[s].id) + '">' +
          '<span class="cx-row-ic">' + ic("timer") + "</span>" +
          '<span class="cx-row-txt"><span class="cx-row-t">' + esc(sts[s].title) + "</span>" +
          '<span class="cx-row-s">' + Math.round((sts[s].seconds || 300) / 60) + " minute station</span></span>" + ic("chevron_right") + "</button>";
      }
      html += row("cx-viva", "record_voice_over", "Viva on " + d.name, "One question at a time, adapting as you go");
      html += "</div></section>";
    }

    host.innerHTML = html;
  }

  /* ── screen: chapter ─────────────────────────────────────────────────────── */

  function renderChapter(host) {
    var b = state.built;
    var pathway = C().pathwayFor(b);
    var ch = null;
    for (var i = 0; i < pathway.length; i++) if (pathway[i].id === state.chapterId) ch = pathway[i];
    if (!ch) { host.innerHTML = header("Chapter") + emptyState("error", "Chapter not found", "Go back to the pathway."); return; }

    var html = header(ch.title, b.disease.name);
    if (ch.blurb) html += '<div class="cx-blurb">' + esc(ch.blurb) + "</div>";
    html += '<div class="cx-rows cx-rows--pad">';
    for (var s = 0; s < ch.skills.length; s++) {
      var sk = ch.skills[s];
      var m = P() ? P().mastery(sk.id) : { level: "new", pct: 0 };
      html += '<button type="button" class="cx-row cx-row--skill" data-act="cx-lesson" data-id="' + esc(sk.id) + '">' +
        '<span class="cx-row-ic cx-m-' + esc(m.level) + '">' + ic(masteryIcon(m.level)) + "</span>" +
        '<span class="cx-row-txt"><span class="cx-row-t">' + esc(sk.title) + "</span>" +
        '<span class="cx-row-s">' + esc(sk.oneLine || "") + "</span>" +
        '<span class="cx-row-meta">' + esc(masteryLabel(m)) + "</span></span>" + ic("chevron_right") + "</button>";
    }
    html += "</div>";
    host.innerHTML = html;
  }

  function masteryIcon(level) {
    return level === "mastered" ? "task_alt" : level === "learning" ? "hourglass_bottom"
      : level === "struggling" ? "priority_high" : "radio_button_unchecked";
  }
  function masteryLabel(m) {
    if (m.level === "new") return "Not started";
    if (m.level === "mastered") return "Mastered";
    return (m.pct || 0) + "% correct so far";
  }

  /* ── screen: THE LESSON RUNNER ───────────────────────────────────────────── */

  function renderLesson(host) {
    var b = state.built;
    var sk = C().skill(b, state.skillId);
    if (!sk || !state.turns.length) {
      host.innerHTML = header("Lesson") + emptyState("error", "Lesson unavailable", "This skill is not available yet.");
      return;
    }

    var i = Math.max(0, Math.min(state.turns.length - 1, state.turnIndex));
    var t = state.turns[i];
    var pct = Math.round(((i + 1) / state.turns.length) * 100);

    var html = header(sk.title, b.disease.name + " · step " + (i + 1) + " of " + state.turns.length);
    html += '<div class="cx-lesson-prog">' + progressBar(pct) + "</div>";
    html += '<div class="cx-turn cx-turn--' + esc(t.kind) + '">' + turnHtml(t, i, sk) + "</div>";
    html += lessonNav(i, t);
    html += sourceLine(sk);
    host.innerHTML = html;
  }

  function turnHtml(t, i, sk) {
    switch (t.kind) {
      case "show": return showTurn(t);
      case "tell": return tellTurn(t);
      case "ask": return askTurn(t, i, "Before we start");
      case "check": return askTurn(t, i, "Check yourself");
      case "reveal": return revealTurn(t, i);
      case "doit": return doitTurn(t, i);
      default: return "";
    }
  }

  // The verb has to match the medium: you do not "watch" a percussion diagram or a breath sound.
  function mediaVerb(kind) {
    if (kind === "audio") return "Listen first";
    if (kind === "video" || kind === "embed" || kind === "animation" || kind === "gif") return "Watch first";
    return "Look first";
  }

  function showTurn(t) {
    var m = C().media(state.built, t.media);
    var head = '<div class="cx-eyebrow">' + esc(m ? mediaVerb(m.kind) : "Look first") + "</div>";
    if (!m) {
      return head + '<div class="cx-media cx-media--pending">' + ic("videocam_off") +
        '<div class="cx-media-cap">A demonstration for this step has not been added yet.</div></div>';
    }

    // 1. Self-authored inline SVG. Always clearable, inherits the theme, and can be interactive.
    if (m.renderable && m.inline && m.diagramId && window.SMD_CLINIX_DIAGRAMS && SMD_CLINIX_DIAGRAMS.has(m.diagramId)) {
      var svg = SMD_CLINIX_DIAGRAMS.render(m.diagramId, {
        focus: state.diaFocus, selected: state.diaZone, mode: state.diaMode, view: state.diaView
      });
      return head + '<figure class="cx-media cx-media--dia">' + svg +
        '<figcaption class="cx-media-cap">' + esc(m.caption) +
        '<span class="cx-media-src">' + esc(m.attribution) + " \u00b7 " + esc(m.licence) + "</span></figcaption></figure>";
    }

    // 2. Synthesized audio. Generated at play time, so there is no recording and no rights holder,
    //    but the student must be told it is a model rather than a patient.
    if (m.renderable && m.synth && m.audioKind) {
      var playing = state.audioKind === m.audioKind;
      var hint = "";
      try { if (window.SMD_CLINIX_AUDIO) hint = SMD_CLINIX_AUDIO.hintOf(m.audioKind); } catch (e) {}
      return head + '<figure class="cx-media cx-media--snd">' +
        '<button type="button" class="cx-snd' + (playing ? " cx-snd--on" : "") + '" data-act="cx-audio" data-id="' + esc(m.audioKind) + '">' +
          '<span class="cx-snd-ic">' + ic(playing ? "stop_circle" : "play_circle") + "</span>" +
          '<span class="cx-snd-txt"><span class="cx-snd-t">' + esc(m.caption.replace(" (synthesized)", "")) + "</span>" +
          '<span class="cx-snd-s">' + esc(playing ? "playing three breaths" : "tap to listen") + "</span></span>" +
          '<span class="cx-snd-wave' + (playing ? " cx-snd-wave--on" : "") + '"><i></i><i></i><i></i><i></i><i></i></span>' +
        "</button>" +
        (hint ? '<div class="cx-snd-hint">' + esc(hint) + "</div>" : "") +
        '<figcaption class="cx-media-cap"><span class="cx-media-src">Synthesized teaching model, not a patient recording. ' +
        'Learn what to listen FOR, then listen to real patients.</span></figcaption></figure>';
    }

    // 3. Embedded video, through the rights holder's own player. Never downloaded, never re-hosted.
    //    embeddable is only true when the YouTube oEmbed endpoint returned 200 for this video.
    if (m.embeddable && m.videoId) {
      return head + '<figure class="cx-media cx-media--embed">' +
        '<div class="cx-embed-frame"><iframe src="https://www.youtube-nocookie.com/embed/' + esc(m.videoId) +
          '?rel=0&modestbranding=1&playsinline=1" title="' + esc(m.title || m.caption) +
          '" frameborder="0" loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>' +
        '<figcaption class="cx-media-cap">' + esc(m.caption) +
        '<span class="cx-media-src">' + esc(m.title) + " \u00b7 " + esc(m.attribution) +
        ' \u00b7 <a href="' + esc(m.sourceUrl) + '" target="_blank" rel="noopener">watch on YouTube</a></span></figcaption></figure>';
    }

    // 4. A hosted file (openly licensed or owner-produced).
    if (m.renderable && m.src) {
      var inner = m.kind === "audio"
        ? '<audio controls src="' + esc(m.src) + '"></audio>'
        : m.kind === "video"
          ? '<video controls playsinline src="' + esc(m.src) + '"></video>'
          : '<img alt="' + esc(m.caption) + '" src="' + esc(m.src) + '">';
      return head + '<figure class="cx-media">' + inner +
        '<figcaption class="cx-media-cap">' + esc(m.caption) +
        '<span class="cx-media-src">' + esc(m.attribution) + " \u00b7 " + esc(m.licence) + "</span></figcaption></figure>";
    }

    // 5. Not cleared. Honest text beats a broken image or a blank space.
    return head + '<div class="cx-media cx-media--pending">' + ic("image_not_supported") +
      '<div class="cx-media-cap"><b>' + esc(m.caption) + "</b>" +
      '<span class="cx-media-pending">' + esc(m.pendingNote) + "</span></div></div>";
  }

  function tellTurn(t) {
    var html = '<div class="cx-eyebrow">' + esc(t.heading || "") + "</div>";
    if (t.emphasis) html = '<div class="cx-eyebrow cx-eyebrow--em">' + esc(t.heading || "") + "</div>";
    if (t.body) html += '<p class="cx-body' + (t.emphasis ? " cx-body--em" : "") + '">' + esc(t.body) + "</p>";
    if (t.steps && t.steps.length) {
      html += '<ol class="cx-steps">';
      for (var i = 0; i < t.steps.length; i++) {
        var s = t.steps[i];
        html += "<li>" + esc(typeof s === "string" ? s : (s.text || "")) + "</li>";
      }
      html += "</ol>";
    }
    return html;
  }

  /* Ask before tell. The student commits to an answer, and only then sees whether they were right
   * and why. Nothing about the answer is on screen until they have submitted. */
  function askTurn(t, i, eyebrow) {
    var a = state.answered[i];
    var p = t.probe || {};
    var html = '<div class="cx-eyebrow">' + esc(eyebrow) + "</div>" +
      '<p class="cx-q">' + esc(p.q || "") + "</p>";

    if (p.options && p.options.length) {
      html += '<div class="cx-opts">';
      for (var o = 0; o < p.options.length; o++) {
        var cls = "cx-opt";
        if (a) {
          if (o === p.correctIndex) cls += " cx-opt--right";
          else if (o === a.given) cls += " cx-opt--wrong";
        }
        html += '<button type="button" class="' + cls + '" data-act="cx-answer" data-i="' + o + '"' + (a ? " disabled" : "") + ">" +
          esc(p.options[o]) + "</button>";
      }
      html += "</div>";
    } else {
      html += '<div class="cx-free">' +
        '<textarea class="cx-input" id="cxAnswer" rows="3" placeholder="Answer in your own words"' + (a ? " disabled" : "") + ">" +
        (a ? esc(a.given) : "") + "</textarea>" +
        (a ? "" : '<button type="button" class="cx-btn cx-btn--primary" data-act="cx-answer-text">Check my answer</button>') +
        "</div>";
    }

    if (a) {
      var good = a.correct === true;
      var unk = a.correct === null;
      html += '<div class="cx-fb ' + (good ? "cx-fb--ok" : unk ? "cx-fb--neutral" : "cx-fb--no") + '">' +
        '<div class="cx-fb-h">' + ic(good ? "check_circle" : unk ? "info" : "cancel") + " " +
        esc(good ? "Correct" : unk ? "Here is the model answer" : "Not quite") + "</div>" +
        '<p class="cx-fb-a">' + esc(p.a || "") + "</p>";
      if (a.missed && a.missed.length) {
        html += '<div class="cx-fb-missed">You did not mention: ' + esc(a.missed.join(", ")) + "</div>";
      }
      html += "</div>";
    }
    return html;
  }

  /* Tap to reveal. The delay is the point: a finding you had to ask for is remembered better than
   * one that was already on the screen. */
  function revealTurn(t, i) {
    var open = !!state.revealed[i];
    var html = '<div class="cx-eyebrow">' + esc(t.heading || "") + "</div>";
    html += '<div class="cx-reveals">';
    for (var k = 0; k < (t.items || []).length; k++) {
      var it = t.items[k];
      html += '<button type="button" class="cx-reveal' + (open ? " cx-reveal--open" : "") + '" data-act="cx-reveal" data-i="' + i + '">' +
        '<span class="cx-reveal-l">' + esc(it.label) + "</span>" +
        (open ? '<span class="cx-reveal-b">' + esc(it.body) + "</span>"
              : '<span class="cx-reveal-hint">' + ic("touch_app") + "Tap to reveal</span>") +
        "</button>";
    }
    html += "</div>";
    return html;
  }

  function doitTurn(t, i) {
    var html = '<div class="cx-eyebrow">' + esc(t.heading || "Now you do it") + "</div>" +
      '<p class="cx-body">' + esc(t.body || "") + "</p>";
    if (t.rubric && t.rubric.length) {
      html += '<div class="cx-checklist"><div class="cx-checklist-h">Mark yourself</div>';
      for (var k = 0; k < t.rubric.length; k++) {
        var r = t.rubric[k];
        var on = !!state.stationChecked["doit:" + r.id];
        html += '<button type="button" class="cx-check' + (on ? " cx-check--on" : "") + '" data-act="cx-selfcheck" data-id="' + esc(r.id) + '">' +
          ic(on ? "check_box" : "check_box_outline_blank") + "<span>" + esc(r.text) + "</span>" +
          (r.critical ? '<span class="cx-crit">critical</span>' : "") + "</button>";
      }
      html += "</div>";
    }
    return html;
  }

  function lessonNav(i, t) {
    var last = i >= state.turns.length - 1;
    var needsAnswer = (t.kind === "ask" || t.kind === "check") && !state.answered[i];
    var html = '<div class="cx-nav">';
    if (i > 0) html += '<button type="button" class="cx-btn cx-btn--ghost cx-prevturn" data-act="cx-turn-prev">Back</button>';
    if (needsAnswer) {
      html += '<button type="button" class="cx-btn cx-btn--ghost" data-act="cx-turn-next">Skip</button>';
    } else {
      html += '<button type="button" class="cx-btn cx-btn--primary" data-act="' + (last ? "cx-lesson-done" : "cx-turn-next") + '">' +
        (last ? "Finish" : "Continue") + "</button>";
    }
    html += "</div>";
    if (flag("smd_clinix_tutor")) {
      html += '<button type="button" class="cx-ask-maik" data-act="cx-ask">' + ic("neurology") + "Ask MaiK about this step</button>";
    }
    return html;
  }

  function sourceLine(sk) {
    var src = sk.sources || [];
    if (!src.length) return "";
    var parts = [];
    for (var i = 0; i < src.length; i++) parts.push(src[i].source + (src[i].locator ? " (" + src[i].locator + ")" : ""));
    var draft = M().reviewStatus(sk) !== "approved" && M().reviewStatus(sk) !== "published";
    return '<div class="cx-src">' + (draft ? '<span class="cx-src-draft">Draft, pending clinician review</span>' : "") +
      "Source: " + esc(parts.join("; ")) + "</div>";
  }

  /* ── screen: OSCE station ────────────────────────────────────────────────── */

  function renderStation(host) {
    var st = state.station;
    if (!st) { host.innerHTML = header("Station") + emptyState("error", "Station unavailable", "Go back and try again."); return; }

    if (state.stationResult) return renderStationResult(host, st);

    var left = Math.max(0, Math.ceil((state.stationEndsAt - Date.now()) / 1000));
    var mm = Math.floor(left / 60), ss = left % 60;
    var html = header(st.title, "OSCE station");
    html += '<div class="cx-timer' + (left <= 30 ? " cx-timer--low" : "") + '">' + ic("timer") +
      "<span>" + mm + ":" + (ss < 10 ? "0" : "") + ss + "</span></div>";
    html += '<div class="cx-task">' + esc(st.task) + "</div>";
    html += '<div class="cx-checklist"><div class="cx-checklist-h">Tick what you did</div>';
    for (var i = 0; i < st.items.length; i++) {
      var it = st.items[i];
      var on = !!state.stationChecked[it.id];
      html += '<button type="button" class="cx-check' + (on ? " cx-check--on" : "") + '" data-act="cx-station-check" data-id="' + esc(it.id) + '">' +
        ic(on ? "check_box" : "check_box_outline_blank") + "<span>" + esc(it.text) + "</span>" +
        (it.critical ? '<span class="cx-crit">critical</span>' : "") + "</button>";
    }
    html += "</div>";
    html += '<div class="cx-nav"><button type="button" class="cx-btn cx-btn--primary" data-act="cx-station-finish">Finish station</button></div>';
    host.innerHTML = html;
  }

  function renderStationResult(host, st) {
    var r = state.stationResult;
    var html = header(st.title, "Result");
    html += '<div class="cx-score ' + (r.passed ? "cx-score--pass" : "cx-score--fail") + '">' +
      '<div class="cx-score-pct">' + r.pct + "%</div>" +
      '<div class="cx-score-l">' + r.score + " of " + r.maxScore + " marks</div>" +
      '<div class="cx-score-v">' + (r.passed ? "Pass" : r.failedOnCritical ? "Fail on a critical step" : "Below the pass mark") + "</div></div>";

    // A critical miss is reported as its own thing. Losing a mark and failing on safety are not the
    // same event, and a score alone would hide the difference.
    if (r.failedOnCritical) {
      html += '<div class="cx-notice cx-notice--crit">' + ic("gpp_bad") +
        "<div><b>Critical steps missed</b><span>You would fail this station regardless of your total, because these are safety steps.</span></div></div>";
      html += '<ul class="cx-misslist">';
      for (var c = 0; c < r.missedCritical.length; c++) html += '<li class="cx-miss--crit">' + esc(r.missedCritical[c].text) + "</li>";
      html += "</ul>";
    }
    if (r.missed.length) {
      html += '<div class="cx-sec-h">Everything you missed</div><ul class="cx-misslist">';
      for (var m = 0; m < r.missed.length; m++) html += "<li>" + esc(r.missed[m].text) + "</li>";
      html += "</ul>";
    }
    var qs = (state.stationDef && state.stationDef.examinerQuestions) || [];
    if (qs.length) {
      html += '<div class="cx-sec-h">The examiner would then ask</div><ul class="cx-qlist">';
      for (var q = 0; q < qs.length; q++) html += "<li>" + esc(qs[q]) + "</li>";
      html += "</ul>";
    }
    html += '<div class="cx-nav"><button type="button" class="cx-btn cx-btn--ghost" data-act="cx-station-retry">Try again</button>' +
      '<button type="button" class="cx-btn cx-btn--primary" data-act="cx-back">Done</button></div>';
    host.innerHTML = html;
  }

  /* ── screen: CASE. A simulated patient over the same skills ──────────────── */

  // Short labels on purpose: six full words do not fit a 393px phone and truncated to
  // "EXAMIN..." / "DIFFERE...". DDx and Dx are the shorthand students already use.
  var CASE_STEPS = [
    { id: "history", label: "History" },
    { id: "examination", label: "Exam" },
    { id: "investigations", label: "Tests" },
    { id: "differential", label: "DDx" },
    { id: "diagnosis", label: "Dx" },
    { id: "management", label: "Plan" }
  ];

  function casePhaseBar() {
    var html = '<ol class="cx-phases">';
    var cur = 0, i;
    for (i = 0; i < CASE_STEPS.length; i++) if (CASE_STEPS[i].id === state.casePhase) cur = i;
    for (i = 0; i < CASE_STEPS.length; i++) {
      var cls = i < cur ? "cx-phase cx-phase--done" : i === cur ? "cx-phase cx-phase--now" : "cx-phase";
      html += '<li class="' + cls + '"><span>' + esc(CASE_STEPS[i].label) + "</span></li>";
    }
    return html + "</ol>";
  }

  function caseSkillTitle(id) {
    var s = state.built ? C().skill(state.built, id) : null;
    return s ? s.title : prettySkill(id);
  }

  function renderCase(host) {
    var cd = state.caseDef;
    if (!cd) { host.innerHTML = header("Case") + emptyState("error", "Case unavailable", "This case is not available yet."); return; }
    if (state.caseResult) { renderCaseResult(host, cd); return; }

    var html = header(cd.title, "Clinical case");
    html += casePhaseBar();

    if (state.casePhase === "history") html += casePhaseHistory(cd);
    else if (state.casePhase === "examination") html += casePhaseExam(cd);
    else if (state.casePhase === "investigations") html += casePhaseIx(cd);
    else html += casePhaseFreeText(cd);

    host.innerHTML = html;
  }

  function casePhaseHistory(cd) {
    var html = '<div class="cx-case-open">' + esc(cd.opening) + "</div>";
    html += '<div class="cx-case-log">';
    for (var i = 0; i < state.caseLog.length; i++) {
      var t = state.caseLog[i];
      html += '<div class="cx-tq">' + esc(t.q) + "</div>";
      html += '<div class="cx-pt' + (t.unmatched ? " cx-pt--unmatched" : "") + '">' +
        '<span class="cx-pt-who">' + esc((cd.patient && cd.patient.name) || "Patient") + "</span>" +
        esc(t.a) + "</div>";
    }
    html += "</div>";
    html += '<div class="cx-tutor-input">' +
      '<textarea class="cx-input" id="cxCaseQ" rows="2" placeholder="Ask the patient a question"></textarea>' +
      '<button type="button" class="cx-btn cx-btn--primary" data-act="cx-case-ask">Ask</button></div>';
    html += '<div class="cx-case-count">' + state.caseTaken.asked.length + " topics covered</div>";
    html += '<div class="cx-nav"><button type="button" class="cx-btn cx-btn--primary" data-act="cx-case-next">Move to examination</button></div>';
    return html;
  }

  function casePhaseExam(cd) {
    var html = '<div class="cx-case-hint">Choose what you want to examine. You only see a finding for something you actually did.</div>';
    html += '<div class="cx-rows cx-rows--pad">';
    for (var id in cd.exam) {
      if (!Object.prototype.hasOwnProperty.call(cd.exam, id)) continue;
      var done = state.caseReveal["ex:" + id];
      html += '<button type="button" class="cx-row cx-row--exam' + (done ? " cx-row--done" : "") + '" data-act="cx-case-exam" data-id="' + esc(id) + '">' +
        '<span class="cx-row-ic">' + ic(done ? "visibility" : "touch_app") + "</span>" +
        '<span class="cx-row-txt"><span class="cx-row-t">' + esc(caseSkillTitle(id)) + "</span>" +
        (done ? '<span class="cx-finding">' + esc(cd.exam[id].finding) + "</span>" : '<span class="cx-row-s">Tap to perform</span>') +
        "</span></button>";
    }
    html += "</div>";
    html += '<div class="cx-nav"><button type="button" class="cx-btn cx-btn--primary" data-act="cx-case-next">Move to investigations</button></div>';
    return html;
  }

  function casePhaseIx(cd) {
    var html = '<div class="cx-case-hint">Order only what you would actually order. Every test you request is recorded, including the ones that were not indicated.</div>';
    html += '<div class="cx-rows cx-rows--pad">';
    for (var id in cd.investigations) {
      if (!Object.prototype.hasOwnProperty.call(cd.investigations, id)) continue;
      var ix = cd.investigations[id];
      var done = state.caseReveal["ix:" + id];
      html += '<button type="button" class="cx-row cx-row--ix' + (done ? " cx-row--done" : "") + '" data-act="cx-case-ix" data-id="' + esc(id) + '">' +
        '<span class="cx-row-ic">' + ic(done ? "lab_panel" : "add_circle") + "</span>" +
        '<span class="cx-row-txt"><span class="cx-row-t">' + esc(ix.label) + "</span>" +
        (done
          ? '<span class="cx-finding">' + esc(ix.result) + "</span>" +
            (ix.note ? '<span class="cx-ixnote">' + esc(ix.note) + "</span>" : "")
          : '<span class="cx-row-s">Tap to order</span>') +
        "</span></button>";
    }
    html += "</div>";
    html += '<div class="cx-nav"><button type="button" class="cx-btn cx-btn--primary" data-act="cx-case-next">Give your differential</button></div>';
    return html;
  }

  function casePhaseFreeText(cd) {
    var prompts = {
      differential: { q: "What are your differentials, and what argues for or against each?", ph: "List them, most likely first", next: "Commit to a diagnosis" },
      diagnosis: { q: "What is your diagnosis? Name it, grade it, and state the current state.", ph: "Your full diagnostic statement", next: "Give your management" },
      management: { q: "How would you manage this patient right now?", ph: "Immediate management, then before discharge", next: "Finish the case" }
    };
    var p = prompts[state.casePhase] || prompts.differential;
    var existing = state.caseTaken[state.casePhase] || "";
    return '<div class="cx-turn"><p class="cx-q">' + esc(p.q) + "</p>" +
      '<div class="cx-free"><textarea class="cx-input" id="cxCaseText" rows="5" placeholder="' + esc(p.ph) + '">' + esc(existing) + "</textarea></div></div>" +
      '<div class="cx-nav"><button type="button" class="cx-btn cx-btn--primary" data-act="cx-case-next">' + esc(p.next) + "</button></div>";
  }

  function renderCaseResult(host, cd) {
    var r = state.caseResult;
    var html = header(cd.title, "How you did");

    var verdictText = r.verdict === "good" ? "Well worked up"
      : r.verdict === "right-answer-thin-workup" ? "Right answer, thin workup" : "Incomplete";
    html += '<div class="cx-score ' + (r.verdict === "good" ? "cx-score--pass" : "cx-score--fail") + '">' +
      '<div class="cx-score-v">' + esc(verdictText) + "</div>" +
      '<div class="cx-score-l">' + esc(r.diagnosis.correct ? "Diagnosis correct" : "Diagnosis not reached") + "</div></div>";

    // Reported as separate dimensions on purpose. A single percentage would let a student who
    // guessed the diagnosis after two questions believe they had done well.
    html += '<div class="cx-sec-h">Your workup</div><div class="cx-rows cx-rows--pad">';
    html += caseMetric("History", r.history.asked + " of " + r.history.total + " topics", r.history.pct);
    html += caseMetric("Key questions", r.history.keyAsked + " of " + r.history.keyTotal, r.history.keyTotal ? Math.round((r.history.keyAsked / r.history.keyTotal) * 100) : 0);
    html += caseMetric("Examination", r.examination.done + " of " + r.examination.total + " steps", r.examination.pct);
    html += caseMetric("Essential tests", r.investigations.essential + " of " + r.investigations.essentialTotal, r.investigations.essentialTotal ? Math.round((r.investigations.essential / r.investigations.essentialTotal) * 100) : 0);
    html += "</div>";

    if (r.history.missedKey.length) {
      html += '<div class="cx-sec-h">Key questions you did not ask</div><ul class="cx-misslist">';
      for (var i = 0; i < r.history.missedKey.length; i++) {
        var k = r.history.missedKey[i];
        var topic = cd.history[k];
        html += "<li><b>" + esc(prettySkill(k)) + "</b>" + (topic && topic.reply ? "<br>He would have told you: " + esc(topic.reply) : "") + "</li>";
      }
      html += "</ul>";
    }

    if (r.investigations.unnecessary.length) {
      html += '<div class="cx-notice cx-notice--review">' + ic("receipt_long") +
        "<div><b>Tests that were not indicated</b><span>A panel is not a plan. Each of these costs money, time, and sometimes a further test to chase an incidental result.</span></div></div>";
      html += '<ul class="cx-misslist">';
      for (var u = 0; u < r.investigations.unnecessary.length; u++) {
        var ixd = cd.investigations[r.investigations.unnecessary[u]];
        html += "<li><b>" + esc(ixd.label) + "</b>" + (ixd.note ? "<br>" + esc(ixd.note) : "") + "</li>";
      }
      html += "</ul>";
    }

    html += '<div class="cx-sec-h">The diagnosis</div><div class="cx-turn"><p class="cx-body">' + esc(cd.diagnosis.answer) + "</p></div>";

    if (cd.teachingPoints && cd.teachingPoints.length) {
      html += '<div class="cx-sec-h">What this case was teaching</div><ul class="cx-qlist">';
      for (var t = 0; t < cd.teachingPoints.length; t++) html += "<li>" + esc(cd.teachingPoints[t]) + "</li>";
      html += "</ul>";
    }

    html += '<div class="cx-nav"><button type="button" class="cx-btn cx-btn--ghost" data-act="cx-case-retry">Try again</button>' +
      '<button type="button" class="cx-btn cx-btn--primary" data-act="cx-back">Done</button></div>';
    host.innerHTML = html;
  }

  function caseMetric(label, detail, pct) {
    return '<div class="cx-weak"><div class="cx-weak-t">' + esc(label) + " &middot; " + esc(detail) + "</div>" +
      '<div class="cx-weak-b">' + progressBar(pct) + "</div></div>";
  }

  function startCase(id) {
    var cd = C().caseFor(state.built, id);
    if (!cd) { toast("Case unavailable"); return; }
    state.caseDef = cd;
    state.casePhase = "history";
    state.caseLog = [];
    state.caseReveal = {};
    state.caseResult = null;
    state.caseTaken = { asked: [], examined: [], investigated: [], differential: null, diagnosis: null, management: null };
    go("case");
  }

  function caseAsk(text) {
    text = String(text || "").trim();
    if (!text) { toast("Type a question first"); return; }
    var cd = state.caseDef;
    var hit = M().matchAsk(cd, text);
    if (hit) {
      state.caseLog.push({ q: text, a: hit.topic.reply });
      if (state.caseTaken.asked.indexOf(hit.key) < 0) state.caseTaken.asked.push(hit.key);
      haptic("tap");
    } else {
      // The patient does not improvise. An unscripted reply would be a clinical fact invented by a
      // model, and a simulated patient that invents a symptom teaches a wrong pattern.
      state.caseLog.push({ q: text, a: M().unmatchedReply(cd), unmatched: true });
      haptic("warning");
    }
    repaint();
  }

  function caseNext() {
    var order = ["history", "examination", "investigations", "differential", "diagnosis", "management"];
    var el;
    if (state.casePhase === "differential" || state.casePhase === "diagnosis" || state.casePhase === "management") {
      el = document.getElementById("cxCaseText");
      var v = el ? String(el.value || "").trim() : "";
      if (!v) { toast("Write your answer first"); return; }
      state.caseTaken[state.casePhase] = v;
    }
    var i = order.indexOf(state.casePhase);
    if (i < 0 || i >= order.length - 1) { finishCase(); return; }
    state.casePhase = order[i + 1];
    haptic("tap");
    repaint();
  }

  function finishCase() {
    var r = M().scoreCase(state.caseDef, state.caseTaken);
    state.caseResult = r;
    // The encounter writes competency for every examination it actually performed, exactly like a
    // lesson or a station does. One key, three modes.
    if (P()) {
      for (var i = 0; i < state.caseTaken.examined.length; i++) {
        P().record(state.caseTaken.examined[i], true, { mode: "case" });
      }
      for (var k = 0; k < r.history.missedKey.length; k++) {
        // A key question never asked is a real gap, recorded so revision can surface it.
        P().record("skill.hx.chief_complaints", false, { mode: "case", probe: "Key history topic missed: " + r.history.missedKey[k] });
      }
    }
    haptic(r.verdict === "good" ? "success" : "warning");
    repaint();
  }

  /* ── screen: viva ────────────────────────────────────────────────────────── */

  function renderViva(host) {
    var v = state.viva;
    if (!v || !v.pool.length) { host.innerHTML = header("Viva") + emptyState("error", "Viva unavailable", "No approved questions yet."); return; }
    var cur = state.vivaCurrent;
    var html = header("Viva", state.built.disease.name + " · level " + state.vivaState.level);

    if (!cur) {
      html += emptyState("task_alt", "That is the end of this viva",
        "You answered " + state.vivaState.count + " questions, reaching level " + state.vivaState.best + ".",
        '<button type="button" class="cx-btn cx-btn--primary" data-act="cx-back">Done</button>');
      host.innerHTML = html; return;
    }

    var a = state.vivaState.lastAnswer;
    html += '<div class="cx-vivalvl">' + levelName(cur.q.level) + "</div>";
    html += '<div class="cx-turn cx-turn--ask"><p class="cx-q">' + esc(cur.q.probe.q) + "</p>";
    if (!a) {
      html += '<div class="cx-free"><textarea class="cx-input" id="cxAnswer" rows="3" placeholder="Answer as you would to an examiner"></textarea>' +
        '<button type="button" class="cx-btn cx-btn--primary" data-act="cx-viva-answer">Answer</button></div>';
    } else {
      html += '<div class="cx-fb ' + (a.correct === true ? "cx-fb--ok" : a.correct === null ? "cx-fb--neutral" : "cx-fb--no") + '">' +
        '<div class="cx-fb-h">' + ic(a.correct === true ? "check_circle" : a.correct === null ? "info" : "cancel") + " " +
        esc(a.correct === true ? "Good" : a.correct === null ? "Model answer" : "Not quite") + "</div>" +
        '<p class="cx-fb-a">' + esc(cur.q.probe.a) + "</p></div>";
      html += '<div class="cx-nav"><button type="button" class="cx-btn cx-btn--primary" data-act="cx-viva-next">Next question</button></div>';
    }
    html += "</div>";
    host.innerHTML = html;
  }

  function levelName(l) {
    return l === 1 ? "Level 1 · basics" : l === 2 ? "Level 2 · clinical reasoning"
      : l === 3 ? "Level 3 · bedside application" : "Level 4 · postgraduate";
  }

  /* ── screen: competency ──────────────────────────────────────────────────── */

  function renderCompetency(host) {
    var html = header("Your competency", "Across learn, OSCE and viva");
    var p = P();
    if (!p) { host.innerHTML = html + emptyState("info", "No progress yet", "Complete a lesson to start building your record."); return; }

    var all = p.all(), ids = [];
    for (var k in all) if (Object.prototype.hasOwnProperty.call(all, k)) ids.push(k.replace(/^cx:/, ""));
    if (!ids.length) {
      html += emptyState("school", "Nothing recorded yet",
        "Your competency is built from every question you answer, in any mode. Complete a lesson to begin.");
      host.innerHTML = html; return;
    }

    var comp = p.competency(ids);
    html += '<div class="cx-pathhead">' + progressBar(
      ids.length ? Math.round((comp.mastered / ids.length) * 100) : 0,
      comp.mastered + " of " + ids.length + " skills mastered") + "</div>";

    var weak = p.weakest();
    if (weak.length) {
      html += '<div class="cx-sec-h">Weakest first</div><div class="cx-rows cx-rows--pad">';
      for (var w = 0; w < weak.length; w++) {
        var pct = Math.round((weak[w].accuracy || 0) * 100);
        html += '<div class="cx-weak"><div class="cx-weak-t">' + esc(prettySkill(weak[w].skillId)) + "</div>" +
          '<div class="cx-weak-b">' + progressBar(pct, pct + "% over " + weak[w].seen + " attempts") + "</div></div>";
      }
      html += "</div>";
    }

    var misses = p.misses(8);
    if (misses.length) {
      html += '<div class="cx-sec-h">Recent mistakes</div><ul class="cx-misslist">';
      for (var m = 0; m < misses.length; m++) {
        html += "<li><b>" + esc(prettySkill(misses[m].skillId)) + "</b>" +
          (misses[m].probe ? "<br>" + esc(misses[m].probe) : "") + "</li>";
      }
      html += "</ul>";
    }
    html += '<div class="cx-disclaimer">Competency here means study progress in CliniX. It is not a statement that you are competent to perform a procedure on a patient.</div>';
    host.innerHTML = html;
  }

  /* ── router ──────────────────────────────────────────────────────────────── */

  var SCREENS = {
    home: renderHome, system: renderSystem, disease: renderDisease, chapter: renderChapter,
    lesson: renderLesson, station: renderStation, viva: renderViva, competency: renderCompetency,
    tutor: renderTutor, case: renderCase, skills: renderSkills
  };

  function host() { return document.getElementById("clinixScroll"); }

  /* keepScroll: a REPAINT of the screen you are already on must not move you. Only a real
   * navigation resets to the top. Without this the OSCE station, which repaints on every timer
   * tick and every checkbox, yanks you back to the top once a second and cannot be scrolled. */
  function show(key, keepScroll) {
    var h = host(), fn = SCREENS[key];
    if (!h || !fn) return;
    var prev = 0;
    try { prev = h.scrollTop || 0; } catch (e) {}
    try { fn(h); } catch (e) { try { console.warn("[CliniX] screen " + key, e); } catch (_) {} }
    try { h.scrollTop = keepScroll ? prev : 0; } catch (_) {}
  }

  function go(key) {
    key = String(key || "");
    if (!SCREENS[key]) return;
    stopAudio();
    if (state.stack[state.stack.length - 1] !== key) state.stack.push(key);
    show(key);
  }

  function repaint() { show(state.stack[state.stack.length - 1] || "home", true); }

  function back() {
    stopTimer();
    stopAudio();
    if (state.stack.length <= 1) { haptic("light"); closeMod(); return; }
    state.stack.pop();
    show(state.stack[state.stack.length - 1] || "home");
  }

  function closeMod() { stopAudio(); try { if (window.CLINIX && CLINIX.close) CLINIX.close(); } catch (e) {} }

  /* Audio must never outlive the screen that started it. A breath sound still playing after the
   * student has moved on is disorienting and reads as a bug. */
  function stopAudio() {
    state.audioKind = null;
    try { if (window.SMD_CLINIX_AUDIO) SMD_CLINIX_AUDIO.stopAll(); } catch (e) {}
  }
  function playAudio(kind) {
    try {
      if (!(window.SMD_CLINIX_AUDIO && SMD_CLINIX_AUDIO.has(kind))) { toast("Sound unavailable on this device"); return; }
      if (!SMD_CLINIX_AUDIO.available()) { toast("This device cannot play generated audio"); return; }
      state.audioKind = kind;
      SMD_CLINIX_AUDIO.play(kind, { breaths: 3, onEnd: function () {
        state.audioKind = null;
        if (state.stack[state.stack.length - 1] === "lesson") repaint();
      } });
    } catch (e) { state.audioKind = null; }
  }

  /* ── actions ─────────────────────────────────────────────────────────────── */

  function openDisease(id) {
    state.diseaseId = id;
    state.loading = true;
    go("disease");
    C().loadDisease(id).then(function (built) {
      state.loading = false;
      state.built = built;
      if (!built) { toast("Could not load this topic"); back(); return; }
      repaint();
    });
  }

  function openLesson(skillId) {
    state.skillId = skillId;
    state.turns = C().lessonFor(state.built, skillId, state.chapterId);
    state.turnIndex = 0;
    state.answered = {};
    state.revealed = {};
    state.tutorLog = [];
    state.diaFocus = "both";
    state.diaZone = null;
    state.diaMode = null;
    state.diaView = "both";
    stopAudio();
    if (P()) P().savePosition({ diseaseId: state.diseaseId, chapterId: state.chapterId, skillId: skillId, turnIndex: 0 });
    go("lesson");
  }

  function nextTurn() {
    if (state.turnIndex < state.turns.length - 1) {
      stopAudio();
      state.turnIndex++;
      if (P()) P().savePosition({ diseaseId: state.diseaseId, chapterId: state.chapterId, skillId: state.skillId, turnIndex: state.turnIndex });
      haptic("tap");
      repaint();
    }
  }
  function prevTurn() {
    if (state.turnIndex > 0) {
      stopAudio(); state.turnIndex--; haptic("tap"); repaint(); }
  }

  function answer(given) {
    var i = state.turnIndex, t = state.turns[i];
    if (!t || (t.kind !== "ask" && t.kind !== "check") || state.answered[i]) return;
    var res = M().markAnswer(t.probe, given);
    state.answered[i] = { correct: res.correct, given: given, missed: res.missed || [] };
    // Every mode writes the same per-skill record. This is what makes competency cross-modal.
    if (P()) P().record(state.skillId, res.correct, { mode: "learn", probe: t.probe.q, given: String(given) });
    haptic(res.correct === true ? "success" : res.correct === false ? "warning" : "tap");
    repaint();
  }

  function finishLesson() {
    if (P()) {
      P().completeLesson(state.skillId, state.diseaseId);
      P().savePosition({ diseaseId: state.diseaseId, chapterId: state.chapterId, skillId: state.skillId, turnIndex: 0 });
    }
    haptic("success");
    back();
  }

  function startStation(id) {
    var st = C().stationFor(state.built, id);
    if (!st) { toast("Station unavailable"); return; }
    var sts = (state.built.disease.osce && state.built.disease.osce.stations) || [];
    state.stationDef = null;
    for (var i = 0; i < sts.length; i++) if (sts[i].id === id) state.stationDef = sts[i];
    state.station = st;
    state.stationChecked = {};
    state.stationResult = null;
    state.stationEndsAt = Date.now() + st.seconds * 1000;
    go("station");
    startTimer();
  }

  /* Surgical tick: rewrite the clock text only. Repainting the whole station once a second was
   * both the scroll bug above and a needless rebuild of a 34-item checklist. */
  function tickTimer() {
    var el = document.querySelector("#clinixRoot .cx-timer");
    if (!el) { repaint(); return; }
    var left = Math.max(0, Math.ceil((state.stationEndsAt - Date.now()) / 1000));
    var mm = Math.floor(left / 60), ss = left % 60;
    var span = el.querySelector("span");
    if (span) span.textContent = mm + ":" + (ss < 10 ? "0" : "") + ss;
    if (left <= 30) el.classList.add("cx-timer--low"); else el.classList.remove("cx-timer--low");
  }

  function startTimer() {
    stopTimer();
    state.stationTimer = setInterval(function () {
      if (state.stack[state.stack.length - 1] !== "station" || state.stationResult) { stopTimer(); return; }
      if (Date.now() >= state.stationEndsAt) { finishStation(); return; }
      tickTimer();
    }, 1000);
  }
  function stopTimer() { if (state.stationTimer) { clearInterval(state.stationTimer); state.stationTimer = null; } }

  function finishStation() {
    stopTimer();
    var checked = [];
    for (var k in state.stationChecked) if (state.stationChecked[k]) checked.push(k);
    var r = M().scoreStation(state.station, checked);
    state.stationResult = r;
    // The station writes competency per skill, exactly like a lesson does.
    if (P()) {
      for (var sid in r.perSkill) {
        if (!Object.prototype.hasOwnProperty.call(r.perSkill, sid)) continue;
        var ps = r.perSkill[sid];
        P().record(sid, ps.correct === ps.seen, { mode: "osce" });
      }
    }
    haptic(r.passed ? "success" : "error");
    repaint();
  }

  function startViva() {
    var v = C().vivaFor(state.built);
    if (!v || !v.pool.length) { toast("No viva questions available yet"); return; }
    state.viva = v;
    state.vivaState = { level: 1, asked: {}, count: 0, best: 1, lastAnswer: null };
    state.vivaCurrent = M().nextVivaQuestion(v, state.vivaState);
    go("viva");
  }

  function vivaAnswer(given) {
    var cur = state.vivaCurrent;
    if (!cur || state.vivaState.lastAnswer) return;
    var res = M().markAnswer(cur.q.probe, given);
    state.vivaState.lastAnswer = { correct: res.correct, given: given };
    state.vivaState.count++;
    if (P()) P().record(cur.q.skillId, res.correct, { mode: "viva", probe: cur.q.probe.q, given: String(given) });
    haptic(res.correct === true ? "success" : "warning");
    repaint();
  }

  function vivaNext() {
    var s = state.vivaState, cur = state.vivaCurrent;
    if (!cur) return;
    s.asked[cur.key] = 1;
    s.level = M().adaptLevel(s.level, s.lastAnswer && s.lastAnswer.correct === true, state.viva.maxLevel);
    if (s.level > s.best) s.best = s.level;
    s.lastAnswer = null;
    state.vivaCurrent = M().nextVivaQuestion(state.viva, s);
    repaint();
  }

  function askMaik() {
    if (!(window.SMD_CLINIX_TUTOR && SMD_CLINIX_TUTOR.available())) {
      toast("The tutor needs MaiK, which is not available right now");
      return;
    }
    haptic("tap");
    go("tutor");
  }

  /* Everything MaiK needs to stop being generic: where the student is, what the lesson itself says
   * about the current step, and what they keep getting wrong. */
  function tutorContext() {
    var t = state.turns[state.turnIndex] || {};
    var b = state.built;
    var sk = b ? C().skill(b, state.skillId) : null;
    var chTitle = "";
    if (b) {
      var chs = (b.disease && b.disease.chapters) || [];
      for (var i = 0; i < chs.length; i++) if (chs[i].id === state.chapterId) chTitle = chs[i].title;
    }
    return {
      system: state.systemId,
      systemTitle: b && b.system ? b.system.title : "",
      diseaseId: state.diseaseId,
      diseaseName: b && b.disease ? b.disease.name : "",
      chapterId: state.chapterId,
      chapterTitle: chTitle,
      skillId: state.skillId,
      skillTitle: sk ? sk.title : "",
      turnKind: t.kind,
      turnHeading: t.heading || "",
      stepWhy: sk ? sk.why : "",
      recentMisses: P() ? P().misses(5) : []
    };
  }

  function renderTutor(host) {
    var ctx = tutorContext();
    var html = header("Ask MaiK", ctx.skillTitle || ctx.diseaseName);
    html += '<div class="cx-tutor-ctx">' + ic("school") +
      "<span>Teaching you about <b>" + esc(ctx.skillTitle || ctx.diseaseName || "this lesson") + "</b></span></div>";

    html += '<div class="cx-tutor-log">';
    for (var i = 0; i < state.tutorLog.length; i++) {
      var turn = state.tutorLog[i];
      html += '<div class="cx-tq">' + esc(turn.q) + "</div>";
      if (turn.pending) {
        html += '<div class="cx-ta cx-ta--pending">' + (turn.partial ? esc(turn.partial) : "Thinking...") + "</div>";
      } else if (turn.error) {
        html += '<div class="cx-ta cx-ta--err">' + ic("cloud_off") + " " + esc(turn.error) + "</div>";
      } else {
        html += '<div class="cx-ta' + (turn.blocked ? " cx-ta--blocked" : "") + '">' + esc(turn.a) + "</div>";
      }
    }
    html += "</div>";

    if (!state.tutorLog.length) {
      html += '<div class="cx-tutor-hints"><div class="cx-sec-h">Try asking</div>';
      var hints = ["Why do we do this step?", "What would I find in this disease?", "What do students usually get wrong here?"];
      for (var h = 0; h < hints.length; h++) {
        html += '<button type="button" class="cx-hint" data-act="cx-tutor-hint" data-q="' + esc(hints[h]) + '">' + esc(hints[h]) + "</button>";
      }
      html += "</div>";
    }

    html += '<div class="cx-tutor-input">' +
      '<textarea class="cx-input" id="cxTutorQ" rows="2" placeholder="Ask about this step"></textarea>' +
      '<button type="button" class="cx-btn cx-btn--primary" data-act="cx-tutor-send">Ask</button></div>';
    html += '<div class="cx-disclaimer">The tutor teaches. It does not give doses and it never advises about a real patient.</div>';
    host.innerHTML = html;
  }

  function tutorSend(question) {
    question = String(question || "").trim();
    if (!question) { toast("Type a question first"); return; }
    var entry = { q: question, pending: true, partial: "" };
    state.tutorLog.push(entry);
    repaint();

    SMD_CLINIX_TUTOR.answer(tutorContext(), question, function (accumulated) {
      entry.partial = accumulated;
      if (state.stack[state.stack.length - 1] === "tutor") repaint();
    }).then(function (r) {
      entry.pending = false;
      if (!r || r.error) {
        entry.error = r && r.error === "quota"
          ? "You have reached today's CliniX tutor limit. It resets at midnight."
          : "MaiK could not answer just now. Try again in a moment.";
      } else {
        entry.a = r.text;
        entry.blocked = !!r.blocked;
      }
      haptic("tap");
      repaint();
    });
  }

  function textAnswer() {
    var el = document.getElementById("cxAnswer");
    return el ? String(el.value || "").trim() : "";
  }

  /* ── events ──────────────────────────────────────────────────────────────── */

  function onClick(e) {
    var t = e.target.closest && e.target.closest("[data-act]");
    if (!t) return;
    var act = t.getAttribute("data-act") || "";
    var id = t.getAttribute("data-id");

    switch (act) {
      case "cx-close": haptic("light"); closeMod(); return;
      case "cx-back": haptic("light"); back(); return;

      case "cx-system": state.systemId = id; haptic("tap"); go("system"); return;
      case "cx-disease": haptic("tap"); openDisease(id); return;
      case "cx-chapter": state.chapterId = id; haptic("tap"); go("chapter"); return;
      case "cx-lesson": haptic("tap"); openLesson(id); return;
      case "cx-competency": haptic("tap"); go("competency"); return;
      case "cx-skills": haptic("tap"); openSkills(); return;
      case "cx-skill": haptic("tap"); openSkillLesson(id); return;

      case "cx-turn-next": nextTurn(); return;
      case "cx-turn-prev": prevTurn(); return;
      case "cx-lesson-done": finishLesson(); return;
      case "cx-answer": answer(parseInt(t.getAttribute("data-i"), 10)); return;
      case "cx-answer-text": {
        var v = textAnswer();
        if (!v) { toast("Write an answer first"); return; }
        answer(v); return;
      }
      case "cx-reveal":
        state.revealed[parseInt(t.getAttribute("data-i"), 10)] = true;
        haptic("tap"); repaint(); return;
      case "cx-selfcheck":
        state.stationChecked["doit:" + id] = !state.stationChecked["doit:" + id];
        haptic("tap"); repaint(); return;

      case "cx-station": haptic("tap"); startStation(id); return;
      case "cx-station-check":
        state.stationChecked[id] = !state.stationChecked[id];
        haptic("tap"); repaint(); return;
      case "cx-station-finish": finishStation(); return;
      case "cx-station-retry": startStation(state.stationDef.id); return;

      case "cx-dia-focus": state.diaFocus = id; haptic("tap"); repaint(); return;
      case "cx-dia-mode": state.diaMode = id; haptic("tap"); repaint(); return;
      case "cx-dia-view": state.diaView = id; haptic("tap"); repaint(); return;
      case "cx-dia-zone": state.diaZone = (state.diaZone === id ? null : id); haptic("tap"); repaint(); return;
      // Tapping an auscultation site both selects it AND plays what you would hear there. That
      // pairing is the point: the site and the sound are one fact, not two.
      case "cx-dia-ausc": {
        var same = state.diaZone === id;
        state.diaZone = same ? null : id;
        stopAudio();
        if (!same && window.SMD_CLINIX_DIAGRAMS && window.SMD_CLINIX_AUDIO) {
          var snd = SMD_CLINIX_DIAGRAMS.soundFor(id);
          if (snd) playAudio(snd);
        }
        haptic("tap"); repaint(); return;
      }
      case "cx-audio": {
        if (state.audioKind === id) stopAudio(); else playAudio(id);
        haptic("tap"); repaint(); return;
      }
      case "cx-case": haptic("tap"); startCase(id); return;
      case "cx-case-ask": {
        var ce = document.getElementById("cxCaseQ");
        var cq = ce ? String(ce.value || "").trim() : "";
        if (ce) ce.value = "";
        caseAsk(cq); return;
      }
      case "cx-case-exam": {
        state.caseReveal["ex:" + id] = true;
        if (state.caseTaken.examined.indexOf(id) < 0) state.caseTaken.examined.push(id);
        haptic("tap"); repaint(); return;
      }
      case "cx-case-ix": {
        state.caseReveal["ix:" + id] = true;
        if (state.caseTaken.investigated.indexOf(id) < 0) state.caseTaken.investigated.push(id);
        haptic("tap"); repaint(); return;
      }
      case "cx-case-next": caseNext(); return;
      case "cx-case-retry": startCase(state.caseDef.id); return;
      case "cx-viva": haptic("tap"); startViva(); return;
      case "cx-viva-answer": {
        var va = textAnswer();
        if (!va) { toast("Write an answer first"); return; }
        vivaAnswer(va); return;
      }
      case "cx-viva-next": vivaNext(); return;

      case "cx-practice-osce":
      case "cx-practice-viva":
        toast("Open a topic first, then choose a station or viva from its page"); return;

      case "cx-resume": resume(); return;
      case "cx-ask": askMaik(); return;
      case "cx-tutor-hint": tutorSend(t.getAttribute("data-q")); return;
      case "cx-tutor-send": {
        var el = document.getElementById("cxTutorQ");
        var q = el ? String(el.value || "").trim() : "";
        if (el) el.value = "";
        tutorSend(q); return;
      }
      case "cx-authormode":
        try { SMD_CLINIX_FLAGS.set("smd_clinix_draft", true); } catch (er) {}
        C().reset();
        toast("Author mode on. Drafts are now visible.");
        openDisease(state.diseaseId); return;
    }
  }

  function resume() {
    var pos = P() && P().position();
    if (!pos || !pos.diseaseId) return;
    state.chapterId = pos.chapterId;
    state.diseaseId = pos.diseaseId;
    C().loadDisease(pos.diseaseId).then(function (built) {
      if (!built) { toast("Could not load that topic"); return; }
      state.built = built;
      state.systemId = built.system.id;
      go("disease");
      if (pos.skillId) {
        state.skillId = pos.skillId;
        state.turns = C().lessonFor(built, pos.skillId, pos.chapterId);
        if (state.turns.length) {
          state.turnIndex = Math.min(pos.turnIndex || 0, state.turns.length - 1);
          state.answered = {}; state.revealed = {};
          go("lesson");
        }
      }
    });
  }

  function onKeydown(e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    var t = e.target.closest && e.target.closest("[data-act]");
    if (!t) return;
    if (t.tagName === "BUTTON" || t.tagName === "TEXTAREA") return;
    e.preventDefault();
    onClick({ target: t });
  }

  function init(root) {
    var r = root || document.getElementById("clinixRoot");
    if (r && !r._cxWired) {
      r._cxWired = true;
      r.addEventListener("click", onClick);
      r.addEventListener("keydown", onKeydown);
    }
    wireSignout();
  }

  function scrollHostOf(root) {
    return root && (root.querySelector("#clinixScroll") || root.querySelector(".cx-scroll"));
  }

  function mount(root) {
    if (!root) return;
    if (!scrollHostOf(root)) root.innerHTML = '<div class="cx-scroll" id="clinixScroll"></div>';
    init(root);
    state.stack = ["home"];
    show("home");
    // Catalog loads after the first paint, so the shell appears immediately and then fills in.
    C().loadCatalog().then(function (cat) {
      state.catalog = cat;
      if (state.stack[state.stack.length - 1] === "home") show("home");
    });
  }

  /* Progress is per person and must not survive into the next account on this device. */
  function wipe() { stopAudio(); try { if (P() && P().deleteAll) P().deleteAll(); } catch (e) {} }
  var _signoutWired = false;
  function wireSignout() {
    if (_signoutWired || typeof window === "undefined") return;
    _signoutWired = true;
    ["smd:signout", "smd-signout", "signout", "smd:logout"].forEach(function (ev) {
      try { window.addEventListener(ev, wipe); } catch (e) {}
    });
    window.SMD_CLINIX_WIPE = wipe;
  }

  var API = {
    mount: mount, go: go, back: back, wipe: wipe,
    SCREENS: SCREENS,
    _state: function () { return state; },
    _tutorContext: tutorContext,
    _prettySkill: prettySkill
  };

  if (typeof window !== "undefined") window.SMD_CLINIX_SCREENS = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
