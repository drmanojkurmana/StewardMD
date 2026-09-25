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
  // The real CliniX logo (owner-supplied, clinix-logo.png - same asset as home.js's live tile
  // icon, same brightness(0) invert(1) white-forcing trick used for maitri-logo.png). STATIC
  // here: the module banner is read, not glanced at from a grid, so no pulse.
  var CX_LOGO_MARK = '<img class="cx-hero-logo" src="/clinix-logo.png" alt="" aria-hidden="true" ' +
    'style="width:38px;height:auto;object-fit:contain;filter:brightness(0) invert(1)">';
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

  /* The shim must live on an https origin we control. It cannot be served locally: local means
   * capacitor://, which is the very origin YouTube rejects.
   * It sits under /_site/ deliberately - functions/_middleware.js 404s the app bundle from the
   * public web (after a scraping incident) but passes /_site/* straight through, so the shim needs
   * no hole in that wall. */
  var YT_SHIM = "https://stewardmd.in/_site/yt";
  var YT_TIMEOUT_MS = 5000;

  function C() { try { return window.SMD_CLINIX_CONTENT || null; } catch (e) { return null; } }
  function M() { try { return window.SMD_CLINIX_MODEL || null; } catch (e) { return null; } }
  function P() { try { return window.SMD_CLINIX_PROGRESS || null; } catch (e) { return null; } }
  function readMode() {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        return window.localStorage.getItem("smd_clinix_mode") || "mbbs";
      }
    } catch (e) {}
    return "mbbs";
  }

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
    ytFailed: {},
    ytOk: {},
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
    mode: readMode(),
    presentationId: null,
    presentationBuilt: null,
    presentationTab: "redflags",
    scriptData: null,
    abgValues: { ph: 7.40, paco2: 40, hco3: 24, na: 140, cl: 102, alb: 4.0 },
    spotterIndex: 0,
    spotterTimer: null,
    spotterSeconds: 60,
    spotterAnswers: {},
    spotterDone: false,
    chiefIndex: 0,
    chiefAnswered: {},
    chiefDone: false,
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
      '<div class="cx-hero-mark">' + CX_LOGO_MARK + "CliniX</div>" +
      '<div class="cx-hero-tag">Clinical reasoning operating system. From symptom to diagnosis.</div>' +
      "</section>";

    // Persona Track Switcher: MBBS Exam vs PG Resident
    var isPg = state.mode === "pg";
    html += '<div class="cx-mode-bar">' +
      '<button type="button" class="cx-mode-btn' + (!isPg ? " cx-mode-btn--active" : "") + '" data-act="cx-mode" data-id="mbbs">' +
      ic("school") + " MBBS Exam Track</button>" +
      '<button type="button" class="cx-mode-btn' + (isPg ? " cx-mode-btn--active" : "") + '" data-act="cx-mode" data-id="pg">' +
      ic("clinical_notes") + " PG Resident Track</button></div>";

    // Track guidance chip
    html += '<div class="cx-sec" style="padding-top:10px;"><div class="cx-notice" style="margin:0;font-size:12.5px;">' +
      ic(isPg ? "auto_awesome" : "verified") +
      "<div><b>" + (isPg ? "PG Resident / Clinic Track active" : "MBBS Clinical Exam Track active") + "</b>" +
      "<span>" + (isPg
        ? "Focus: Diagnostic dilemmas, POCUS (BLUE/FOCUS), invasive hemodynamics, and clinical trials."
        : "Focus: NMC CBME practical syllabus, Long/Short cases, bedside maneuvers, and viva traps.") +
      "</span></div></div></div>";

    // Continue where you left off.
    if (pos && pos.diseaseId) {
      var label = pos.skillId ? pos.skillId.split(".").pop().replace(/_/g, " ") : "your lesson";
      html += '<section class="cx-sec"><div class="cx-sec-h">Continue learning</div>' +
        '<button type="button" class="cx-resume" data-act="cx-resume">' +
        '<div class="cx-resume-txt"><div class="cx-resume-t">' + esc(String(pos.diseaseId).toUpperCase()) + "</div>" +
        '<div class="cx-resume-s">' + esc(label) + "</div></div>" + ic("play_arrow") + "</button></section>";
    }

    // Symptom-first Clinical Presentations
    html += '<section class="cx-sec"><div class="cx-sec-h">Learn by presentation</div><div class="cx-rows">' +
      row("cx-presentations", "emergency", "Symptom-first approaches", "Acute dyspnoea, chest pain, weakness, jaundice, acute abdomen") +
      "</div></section>";

    // Learning the examination itself comes NEXT.
    html += '<section class="cx-sec"><div class="cx-sec-h">Learn the examination</div><div class="cx-rows">' +
      row("cx-skills", "stethoscope", "Examination skills", "Technique, step by step, with demonstrations") +
      "</div></section>";

    // Systems
    html += '<section class="cx-sec"><div class="cx-sec-h">Learn by disease</div><div class="cx-sys-grid">';
    var systems = cat.systems || [];
    for (var i = 0; i < systems.length; i++) {
      var s = systems[i];
      var n = (s.diseases || []).length;
      var chapters = s.module && s.module.chapters;
      var label = n ? (n + (n === 1 ? " topic" : " topics"))
        : chapters ? (chapters + (chapters === 1 ? " chapter" : " chapters"))
        : "Coming soon";
      var empty = !n && !chapters;
      html += '<button type="button" class="cx-sys' + (empty ? " cx-sys--empty" : "") + '" data-act="cx-system" data-id="' + esc(s.id) + '">' +
        '<span class="cx-sys-ic">' + ic(s.icon || "stethoscope") + "</span>" +
        '<span class="cx-sys-t">' + esc(s.title) + "</span>" +
        '<span class="cx-sys-n">' + esc(label) + "</span>" +
        "</button>";
    }
    html += "</div></section>";

    // Practice modes
    html += '<section class="cx-sec"><div class="cx-sec-h">Practice & Simulation</div><div class="cx-rows">' +
      row("cx-practice-osce", "assignment_turned_in", "OSCE stations", "Timed, with an objective marking scheme") +
      row("cx-practice-viva", "record_voice_over", "Viva Voce", "Adaptive examiner questioning") +
      row("cx-chief", "military_tech", "The Chief's Ward Round", "Strict Professor viva under exam pressure") +
      row("cx-spotter", "timer", "Spotter Arena", "60-second rapid-fire visual challenge") +
      row("cx-abg", "science", "ABG Simulator", "Winter's formula, anion gap, and triple acid-base disorders") +
      row("cx-soundlab", "hearing", "Auscultation Sound Lab", "Cardiac and pulmonary acoustic stethoscope library") +
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

    var html = header(sys.title, "Start with the examination, then the diseases");

    /* The system MODULE comes first and is visually the primary action. A student who has never
     * examined a chest should not have to pick a disease before they can learn how. The diseases
     * below are specialisations of this, not alternatives to it. */
    if (sys.module) {
      html += '<section class="cx-sec"><div class="cx-sec-h">Start here</div>' +
        '<button type="button" class="cx-modcard" data-act="cx-disease" data-id="' + esc(sys.module.id) + '">' +
          '<span class="cx-modcard-ic">' + ic("stethoscope") + "</span>" +
          '<span class="cx-modcard-txt">' +
            '<span class="cx-modcard-t">' + esc(sys.module.title) + "</span>" +
            '<span class="cx-modcard-s">' + esc(sys.module.subtitle || "") + "</span>" +
            '<span class="cx-modcard-meta">' + esc(String(sys.module.chapters || 0)) + " chapters &middot; about " +
              esc(String(sys.module.estMinutes || 0)) + " min</span>" +
          "</span>" + ic("chevron_right") + "</button></section>";
    }

    var ds = sys.diseases || [];
    if (!ds.length) {
      html += '<section class="cx-sec"><div class="cx-sec-h">Diseases</div></section>';
      html += emptyState("hourglass_top", "Disease modules are coming",
        "The engine is system-agnostic, so a new system needs content rather than code.");
      host.innerHTML = html; return;
    }

    html += '<section class="cx-sec"><div class="cx-sec-h">Then a disease</div>' +
      '<div class="cx-blurb cx-blurb--tight">Each one assumes the examination above and teaches what changes.</div>' +
      '<div class="cx-rows">';
    for (var i = 0; i < ds.length; i++) {
      var d = ds[i];
      html += '<button type="button" class="cx-row cx-row--dz" data-act="cx-disease" data-id="' + esc(d.id) + '">' +
        '<span class="cx-row-txt"><span class="cx-row-t">' + esc(d.title) + "</span>" +
        '<span class="cx-row-s">' + esc(d.subtitle || "") + "</span>" +
        '<span class="cx-row-meta">' + esc(String(d.chapters || 0)) + " chapters &middot; about " + esc(String(d.estMinutes || 0)) + " min</span>" +
        "</span>" + ic("chevron_right") + "</button>";
    }
    html += "</div></section>";
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

    var html = header(ch.title, (b.disease && b.disease.name) || "");
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

  function skillKindLabel(kind) {
    return kind === "approach" ? "Approaching the patient"
      : kind === "history" ? "Taking a history"
      : kind === "general_exam" ? "General examination"
      : kind === "exam" ? "Systemic examination"
      : kind === "investigation" ? "Investigations"
      : kind === "reasoning" ? "Clinical reasoning"
      : kind === "treatment" ? "Treatment principles"
      : kind === "presentation" ? "Presenting a case"
      : kind === "annexure" ? "Reference" : "Examination skill";
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

    // A skill opened from the Examination Skills library has NO disease. Reading b.disease.name
    // unguarded threw here, show() swallowed it, and the screen silently never rendered - which
    // presents as "nothing opens" rather than as an error.
    var ctxName = (b.disease && b.disease.name) || skillKindLabel(sk.kind);
    var html = header(sk.title, ctxName + " \u00b7 step " + (i + 1) + " of " + state.turns.length);
    html += '<div class="cx-lesson-prog">' + progressBar(pct) + "</div>";
    html += '<div class="cx-turn cx-turn--' + esc(t.kind) + '">' + turnHtml(t, i, sk) + "</div>";
    html += lessonNav(i, t);
    html += sourceLine(sk);
    host.innerHTML = html;
  }

  function turnHtml(t, i, sk) {
    switch (t.kind) {
      case "show": return showTurn(t);
      case "teach": return teachTurn(t);
      case "tools": return toolsTurn(t);
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
    // A secondary media turn sits right after the primary one (both up front, before teaching -
    // see compileLesson), but it is still the SECOND thing shown, so it reads as "also" rather
    // than re-claiming "first".
    var verb = t.secondary ? "Also worth a look" : (m ? mediaVerb(m.kind) : "Look first");
    var head = '<div class="cx-eyebrow">' + esc(verb) + "</div>";
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

    // 3. Video, played INLINE by the rights holder's own player.
    //    YouTube refuses to initialise when the embedding origin is not http(s), and this app is
    //    capacitor://localhost - verified on device, three URL variants all loaded the iframe and
    //    none ever reported onReady ("Error 153"). Switching the app scheme to https would fix the
    //    origin but the origin IS the storage key, so it would orphan every user's localStorage.
    //    Instead we iframe our own https shim, which gives YouTube an origin it accepts.
    //    If the shim does not report in (offline, or not yet deployed), ytFailed flips and we fall
    //    back to a card that hands off to the YouTube app.
    if (m.embeddable && m.videoId) {
      var vid = m.videoId;
      var credit = '<figcaption class="cx-media-cap">' + esc(m.caption) +
        '<span class="cx-media-src">' + esc(m.title) + " \u00b7 " + esc(m.attribution) +
        ' \u00b7 <a href="' + esc(m.sourceUrl) + '" target="_blank" rel="noopener">on YouTube</a></span></figcaption>';

      if (!state.ytFailed[vid]) {
        watchYt(vid);
        return head + '<figure class="cx-media cx-media--embed">' +
          '<div class="cx-embed-frame"><iframe src="' + YT_SHIM + "?v=" + esc(vid) + '" ' +
            'title="' + esc(m.title || m.caption) + '" frameborder="0" allowfullscreen ' +
            'allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"></iframe></div>' +
          credit + "</figure>";
      }
      // Fallback: YouTube's own thumbnail, handing off to the official app or browser.
      return head + '<figure class="cx-media cx-media--embed">' +
        '<button type="button" class="cx-ytcard" data-act="cx-watch" data-id="' + esc(vid) + '" aria-label="Play ' + esc(m.title || m.caption) + ' on YouTube">' +
          '<img class="cx-ytthumb" alt="" loading="lazy" src="https://i.ytimg.com/vi/' + esc(vid) + '/hqdefault.jpg" ' +
            'onerror="this.style.display=\'none\';this.parentNode.classList.add(\'cx-ytcard--nothumb\')">' +
          '<span class="cx-ytplay">' + ic("play_arrow") + "</span>" +
          '<span class="cx-ytbadge">Watch on YouTube</span>' +
        "</button>" + credit + "</figure>";
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

  /* Calculator deep-links. CliniX owns no calculators; where an annexure needs arithmetic it opens
   * the app's own Calculators module. A calculator this build does not have is simply not rendered,
   * the same fail-soft behaviour calc-links.js relies on - but silence is how three dead ids shipped
   * in SURGX, so test/clinix-annexure.test.mjs resolves every id against the real catalog. */
  function toolsTurn(t) {
    var ids = t.calcs || [], out = [], i, c;
    for (i = 0; i < ids.length; i++) {
      try { c = (window.MEDCALC && MEDCALC.get) ? MEDCALC.get(ids[i]) : null; } catch (e) { c = null; }
      if (!c) continue;
      out.push('<button class="cx-btn cx-calc" data-act="cx-calc" data-id="' + esc(ids[i]) + '">' +
        ic("calculate") + " " + esc(c.title || ids[i]) + "</button>");
    }
    if (!out.length) return "";
    return '<div class="cx-eyebrow">' + ic("calculate") + " " + esc(t.heading || "Work it out") + "</div>" +
      '<div class="cx-btnrow">' + out.join("") + "</div>" +
      '<div class="cx-teach-note">' + ic("lightbulb") +
      "<span>Opens the StewardMD Calculators module. CliniX keeps no calculators of its own.</span></div>";
  }

  /* The teaching turn. One idea per screen, short paragraphs, and a quiet "2 of 5" so the student
   * can see how much learning is left before they are asked to do anything. */
  function teachTurn(t) {
    var b = t.block || {};
    var html = '<div class="cx-eyebrow cx-eyebrow--learn">' + ic("school") + " Learning" +
      (t.total > 1 ? ' <span class="cx-eyebrow-n">' + (t.index + 1) + " of " + t.total + "</span>" : "") + "</div>";
    html += '<h3 class="cx-teach-h">' + esc(b.heading) + "</h3>";

    if (b.body) {
      // Author paragraphs are split on blank lines so long prose never arrives as one wall.
      var paras = String(b.body).split(/\n\s*\n/);
      for (var p = 0; p < paras.length; p++) {
        if (paras[p].trim()) html += '<p class="cx-body">' + esc(paras[p].trim()) + "</p>";
      }
    }
    if (b.points && b.points.length) {
      html += '<ul class="cx-teach-list">';
      for (var i = 0; i < b.points.length; i++) {
        var pt = b.points[i];
        if (typeof pt === "string") html += "<li>" + esc(pt) + "</li>";
        else html += "<li><b>" + esc(pt.t || "") + "</b> " + esc(pt.d || "") + "</li>";
      }
      html += "</ul>";
    }
    if (b.table && b.table.cols && b.table.rows) {
      html += '<div class="cx-tablewrap"><table class="cx-table"><thead><tr>';
      for (var c = 0; c < b.table.cols.length; c++) html += "<th>" + esc(b.table.cols[c]) + "</th>";
      html += "</tr></thead><tbody>";
      for (var r = 0; r < b.table.rows.length; r++) {
        html += "<tr>";
        for (var k = 0; k < b.table.rows[r].length; k++) html += "<td>" + esc(b.table.rows[r][k]) + "</td>";
        html += "</tr>";
      }
      html += "</tbody></table></div>";
    }
    if (b.wideTable) html += wideTableHtml(b.wideTable);
    if (b.note) html += '<div class="cx-teach-note">' + ic("lightbulb") + "<span>" + esc(b.note) + "</span></div>";
    return html;
  }

  /* The full comparison table the source actually prints, which is too wide for a portrait phone.
   * Rather than crush it into six-point text, show a rotate prompt and render the real table full
   * width for landscape (CSS shows/hides by orientation), while a "view anyway" fallback keeps it
   * reachable, horizontally scrollable, for anyone who cannot or will not rotate. */
  function wideTableHtml(wt) {
    var id = "wt" + Math.random().toString(36).slice(2, 8);
    var html = '<div class="cx-widewrap" id="' + id + '">' +
      '<button type="button" class="cx-rotate-hint" data-act="cx-wide-toggle" data-id="' + id + '">' +
        ic("screen_rotation") + '<span><b>Full comparison table</b><br>Rotate your phone for the easiest view, or tap to see it here</span>' +
      "</button>" +
      '<div class="cx-tablewrap cx-tablewrap--wide"><table class="cx-table"><thead><tr>';
    for (var c = 0; c < wt.cols.length; c++) html += "<th>" + esc(wt.cols[c]) + "</th>";
    html += "</tr></thead><tbody>";
    for (var r = 0; r < wt.rows.length; r++) {
      html += "<tr>";
      for (var k = 0; k < wt.rows[r].length; k++) html += "<td>" + esc(wt.rows[r][k]) + "</td>";
      html += "</tr>";
    }
    html += "</tbody></table></div></div>";
    return html;
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
      if (!a) html += '<button type="button" class="cx-showans" data-act="cx-answer-show">' + ic("visibility") + "Show me the answer</button>";
    } else {
      html += '<div class="cx-free">' +
        '<textarea class="cx-input" id="cxAnswer" rows="3" placeholder="Answer in your own words"' + (a ? " disabled" : "") + ">" +
        (a ? esc(a.given) : "") + "</textarea>" +
        (a ? "" : '<button type="button" class="cx-btn cx-btn--primary" data-act="cx-answer-text">Check my answer</button>') +
        (a ? "" : '<button type="button" class="cx-showans" data-act="cx-answer-show">' + ic("visibility") + "Show me the answer</button>") +
        "</div>";
    }

    if (a) {
      var good = a.correct === true;
      var unk = a.correct === null;
      html += '<div class="cx-fb ' + (good ? "cx-fb--ok" : unk ? "cx-fb--neutral" : "cx-fb--no") + '">' +
        '<div class="cx-fb-h">' + ic(good ? "check_circle" : unk ? "info" : "cancel") + " " +
        esc(good ? "Correct" : a.revealed ? "The answer" : unk ? "Here is the model answer" : "Not quite") + "</div>" +
        '<p class="cx-fb-a">' + esc(p.a || "") + "</p>";
      if (a.missed && a.missed.length) {
        html += '<div class="cx-fb-missed">You did not mention: ' + esc(a.missed.join(", ")) + "</div>";
      }
      if (a.revealed) {
        html += '<div class="cx-fb-missed">Shown without an attempt, so it does not count towards this skill. ' +
          "Come back to it later and it will.</div>";
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
      html += '<div class="cx-pt' + (t.unmatched ? " cx-pt--unmatched" : "") + (t.pending ? " cx-pt--pending" : "") + '">' +
        '<span class="cx-pt-who">' + esc((cd.patient && cd.patient.name) || "Patient") + "</span>" +
        (t.pending ? ic("progress_activity") + " " : "") + esc(t.a) + "</div>";
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

    html += '<div style="margin:16px 16px 8px;"><button type="button" class="cx-btn cx-btn--primary" style="width:100%;" data-act="cx-script-gen" data-id="' + esc(cd.id || state.diseaseId || "breathlessness") + '">' +
      ic("record_voice_over") + ' Generate Ward Round Spoken Script</button></div>';

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
      repaint();
    } else if (flag("smd_clinix_tutor") && window.SMD_CLINIX_TUTOR && SMD_CLINIX_TUTOR.available()) {
      var entry = { q: text, a: "Thinking…", pending: true };
      state.caseLog.push(entry);
      haptic("tap");
      repaint();
      SMD_CLINIX_TUTOR.answerAsPatient(cd, text).then(function (res) {
        entry.pending = false;
        entry.a = (res && res.text) || M().unmatchedReply(cd);
        // If student question matches cues of any uncredited history topic, credit it
        var normQ = M().normalizeAnswer(text);
        var hist = (cd && cd.history) || {};
        for (var k in hist) {
          if (hist[k] && state.caseTaken.asked.indexOf(k) < 0) {
            var cues = hist[k].cues || [];
            for (var ci = 0; ci < cues.length; ci++) {
              var nc = M().normalizeAnswer(cues[ci]);
              if (nc && (" " + normQ + " ").indexOf(" " + nc + " ") >= 0) {
                state.caseTaken.asked.push(k);
                break;
              }
            }
          }
        }
        repaint();
      }).catch(function () {
        entry.pending = false;
        entry.a = M().unmatchedReply(cd);
        entry.unmatched = true;
        repaint();
      });
    } else {
      state.caseLog.push({ q: text, a: M().unmatchedReply(cd), unmatched: true });
      haptic("warning");
      repaint();
    }
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
    if (P()) {
      // Choosing to examine a relevant finding is a real clinical decision, but tapping to reveal
      // it demonstrates neither reading nor interpreting it - no question is asked. Record null
      // ("seen", never "correct"), the same "shown is not known" rule Learn and Viva already use
      // for a revealed answer, so Case can no longer mint free mastery for a tap.
      for (var i = 0; i < state.caseTaken.examined.length; i++) {
        P().record(state.caseTaken.examined[i], null, { mode: "case" });
      }
      // A key history topic never asked is a real gap worth surfacing - but caseDef.history keys
      // ("smoking", "dyspnea_grade", ...) are case-local topic labels, not skill ids: writing them
      // straight to the skill table used to fall back to a single hardcoded id
      // (skill.hx.chief_complaints) for EVERY miss, on EVERY case, corrupting that one shared
      // skill's competency stats. Only record when the case data explicitly names the real skill
      // this topic maps to; otherwise the miss still shows in the case-result screen (r.history),
      // it just does not falsely blame an unrelated skill.
      var hist = (state.caseDef && state.caseDef.history) || {};
      for (var k = 0; k < r.history.missedKey.length; k++) {
        var topic = hist[r.history.missedKey[k]];
        var sid = topic && topic.skillId;
        if (sid) P().record(sid, false, { mode: "case", probe: "Key history topic missed: " + r.history.missedKey[k] });
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
    var html = header("Viva", ((state.built && state.built.disease && state.built.disease.name) || "CliniX") + " \u00b7 level " + state.vivaState.level);

    if (!cur) {
      html += emptyState("task_alt", "That is the end of this viva",
        "You answered " + state.vivaState.count + " questions, reaching level " + state.vivaState.best + ".",
        '<button type="button" class="cx-btn cx-btn--primary" data-act="cx-back">Done</button>');
      host.innerHTML = html; return;
    }

    var a = state.vivaState.lastAnswer;
    var tier = state.vivaState.tier || "mbbs";
    var voiceOn = flag("smd_clinix_viva_voice");
    html += '<div class="cx-viva-toprow"><div class="cx-vivalvl">' + levelName(cur.q.level) + "</div>" +
      '<div class="cx-viva-tier"><button type="button" class="cx-tier-btn' + (tier === "mbbs" ? " cx-tier-btn--on" : "") + '" data-act="cx-viva-tier" data-id="mbbs">MBBS</button>' +
      '<button type="button" class="cx-tier-btn' + (tier === "pg" ? " cx-tier-btn--on" : "") + '" data-act="cx-viva-tier" data-id="pg">PG</button></div>' +
      '<button type="button" class="cx-voice-btn' + (voiceOn ? " cx-voice-btn--on" : "") + '" data-act="cx-viva-voice-toggle" aria-label="Voice mode">' + ic(voiceOn ? "volume_up" : "volume_off") + "</button></div>";
    html += '<div class="cx-turn cx-turn--ask"><p class="cx-q">' + esc(cur.q.probe.q) + "</p>";
    if (voiceOn && state.vivaSpokenFor !== cur.key) { state.vivaSpokenFor = cur.key; speakText(cur.q.probe.q); }
    if (!a) {
      var listening = state.vivaListening;
      var transcribing = state.vivaTranscribing;
      html += '<div class="cx-free">' +
        '<textarea class="cx-input" id="cxAnswer" rows="3" placeholder="Answer as you would to an examiner">' + esc(state.vivaPartial || "") + "</textarea>";
      if (voiceOn) {
        html += '<button type="button" class="cx-mic-btn' + (listening ? " cx-mic-btn--on" : transcribing ? " cx-mic-btn--busy" : "") + '" data-act="cx-viva-mic">' +
          (transcribing ? ic("progress_activity") + "Transcribing your answer\u2026" : ic(listening ? "mic" : "mic_none") + (listening ? "Listening\u2026 tap to stop" : "Tap to speak your answer")) + "</button>";
      }
      html += '<button type="button" class="cx-btn cx-btn--primary" data-act="cx-viva-answer">Answer</button>' +
        '<button type="button" class="cx-showans" data-act="cx-viva-show">' + ic("visibility") + "Show me the answer</button></div>";
    } else if (a.pending) {
      html += '<div class="cx-viva-pending">' + ic("progress_activity") + " MaiK is examining your answer…</div>";
    } else {
      var partial = a.examinerVerdict === "partial";
      var cls = a.correct === true ? "cx-fb--ok" : partial ? "cx-fb--partial" : a.correct === null ? "cx-fb--neutral" : "cx-fb--no";
      var icon = a.correct === true ? "check_circle" : partial ? "error" : a.correct === null ? "info" : "cancel";
      var label = a.correct === true ? "Good" : partial ? "Nearly there"
        : a.revealed ? "The answer" : a.correct === null ? "Model answer" : "Not quite";
      html += '<div class="cx-fb ' + cls + '">' +
        '<div class="cx-fb-h">' + ic(icon) + " " + esc(label) + "</div>";
      if (!a.revealed && a.given) {
        html += '<p class="cx-fb-given"><b>You answered:</b> ' + esc(a.given) + "</p>";
      }
      html += '<p class="cx-fb-a"><b>' + (a.correct === true ? "Model answer:" : "Correct answer:") + '</b> ' + esc(cur.q.probe.a) + "</p>";
      if (a.examinerFeedback) {
        html += '<p class="cx-fb-examiner"><b>MaiK, examining your answer:</b> ' + esc(a.examinerFeedback) + "</p>";
      }
      html += "</div>";
      if (!a.revealed && !a.examinerVerdict && flag("smd_clinix_tutor") && window.SMD_CLINIX_TUTOR && SMD_CLINIX_TUTOR.vivaAvailable()) {
        html += '<button type="button" class="cx-askmaik-sm" data-act="cx-viva-ask-maik">' + ic("forum") + "Ask MaiK to review this answer</button>";
      }
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

  function setMode(m) {
    state.mode = (m === "pg" ? "pg" : "mbbs");
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem("smd_clinix_mode", state.mode);
      }
    } catch (e) {}
    haptic("tap");
    repaint();
  }

  /* ── screen: presentations (symptom-first library) ────────────────────────── */

  var PRESENTATIONS_LIST = [
    { id: "breathlessness", title: "Approach to the Breathless Patient", subtitle: "Acute vs chronic dyspnoea, red flags, and step-by-step diagnostic reasoning", icon: "air", estMinutes: 45 },
    { id: "chest_pain", title: "Approach to Acute Chest Pain", subtitle: "STEMI vs NSTEMI, Aortic Dissection, PE, Pneumothorax, and Esophageal Rupture", icon: "ecg_heart", estMinutes: 50 },
    { id: "acute_weakness", title: "Approach to Acute Neurological Deficit", subtitle: "Acute hemiplegia, paraplegia, quadriplegia, stroke vs mimics, neuroaxis localization", icon: "neurology", estMinutes: 50 },
    { id: "jaundice", title: "Approach to Jaundice and Liver Failure", subtitle: "Pre-hepatic, hepatocellular, and cholestatic jaundice, acute liver failure triage", icon: "water_drop", estMinutes: 45 },
    { id: "acute_abdomen", title: "Approach to the Acute Abdomen", subtitle: "Peritonitis, hollow viscus perforation, bowel obstruction, acute vascular ischemia", icon: "medical_services", estMinutes: 50 }
  ];

  function openPresentations() {
    state.loading = true;
    go("presentations");
  }

  function renderPresentations(host) {
    var html = header("Clinical Presentations", "Symptom-first diagnostic reasoning", "cx-back");
    html += '<section class="cx-sec"><div class="cx-notice cx-notice--review" style="margin-bottom:12px;">' +
      ic("emergency") + '<div><b>Symptom-First Clinical Reasoning</b>' +
      '<span>In the emergency room or outpatient clinic, patients present with symptoms, not textbook diagnoses. ' +
      'Master the 7-layer framework: Red Flags &rarr; Tempo &rarr; Discriminators &rarr; Don\'t-Miss &rarr; Tiered Tests.</span></div></div>' +
      '<div class="cx-rows">';

    for (var i = 0; i < PRESENTATIONS_LIST.length; i++) {
      var p = PRESENTATIONS_LIST[i];
      html += '<button type="button" class="cx-row" data-act="cx-presentation" data-id="' + esc(p.id) + '">' +
        '<span class="cx-row-ic">' + ic(p.icon || "emergency") + '</span>' +
        '<span class="cx-row-txt"><span class="cx-row-t">' + esc(p.title) + '</span>' +
        '<span class="cx-row-s">' + esc(p.subtitle) + '</span>' +
        '<span class="cx-row-meta">' + esc(p.estMinutes) + ' min &middot; 7 clinical layers</span></span>' +
        ic("chevron_right") + '</button>';
    }
    html += '</div></section>';
    host.innerHTML = html;
  }

  function openPresentation(id) {
    state.presentationId = id;
    state.presentationTab = "redflags";
    state.loading = true;
    go("presentation");
    C().loadPresentation(id).then(function (built) {
      if (state.presentationId !== id) return;
      state.presentationBuilt = built;
      state.loading = false;
      repaint();
    });
  }

  function renderPresentation(host) {
    var b = state.presentationBuilt;
    if (!b || !b.presentation || state.loading) {
      host.innerHTML = header("Presentation", "Loading...") + skeleton();
      return;
    }
    var p = b.presentation;
    var layers = p.layers || {};
    var tab = state.presentationTab || "redflags";

    var html = header(p.title, p.subtitle, "cx-presentations");

    // Action banner: Present Case to Consultant
    html += '<div class="cx-sec"><div class="cx-notice" style="background:var(--cx-teach-soft);border:1px solid rgba(29,78,216,.2);margin-bottom:12px;">' +
      ic("record_voice_over") + '<div><b>Present to Consultant</b>' +
      '<span>Ready for university ward rounds or exam presentation? Generate the exact spoken script.</span></div>' +
      '<button type="button" class="cx-btn cx-btn--primary" style="margin-top:8px;width:100%;" data-act="cx-script-gen" data-id="' + esc(p.id) + '">' +
      ic("assignment") + ' Generate Spoken Presentation Script</button></div></div>';

    // Tabs
    var tabs = [
      { id: "redflags", label: "Red Flags & Vitals" },
      { id: "classify", label: "Classification" },
      { id: "discriminators", label: "Discriminators" },
      { id: "dontmiss", label: "Don't Miss" },
      { id: "investigations", label: "Investigations" },
      { id: "skills", label: "Skills & Pearls" }
    ];
    html += '<div class="cx-tabs" role="tablist" style="display:flex;overflow-x:auto;padding:0 16px;gap:6px;border-bottom:1px solid var(--cx-line);background:var(--cx-surface);">';
    for (var t = 0; t < tabs.length; t++) {
      var actv = tab === tabs[t].id;
      html += '<button type="button" class="cx-tab' + (actv ? " cx-tab--active" : "") + '" role="tab" aria-selected="' + actv + '" ' +
        'style="padding:10px 12px;font-size:13px;font-weight:700;border:0;background:transparent;border-bottom:2px solid ' +
        (actv ? "var(--cx-primary)" : "transparent") + ';color:' + (actv ? "var(--cx-primary)" : "var(--cx-muted)") + ';white-space:nowrap;cursor:pointer;" ' +
        'data-act="cx-pres-tab" data-id="' + esc(tabs[t].id) + '">' + esc(tabs[t].label) + '</button>';
    }
    html += '</div>';

    html += '<div class="cx-sec" style="padding-top:14px;">';

    if (tab === "redflags") {
      var rf = (layers.recognise && layers.recognise.redFlags) || [];
      html += '<div class="cx-sec-h" style="margin-left:0;">Life-Threatening Red Flags</div>';
      for (var r = 0; r < rf.length; r++) {
        html += '<div class="cx-pres-redflag">' + ic("warning") + '<span>' + esc(rf[r]) + '</span></div>';
      }
      var vp = (layers.recognise && layers.recognise.vitalsPriorities) || [];
      if (vp.length) {
        html += '<div class="cx-sec-h" style="margin-left:0;margin-top:16px;">Vitals & Bedside Triage Priorities</div>';
        for (var v = 0; v < vp.length; v++) {
          html += '<div class="cx-pres-step">' + ic("monitor_heart") + ' ' + esc(vp[v]) + '</div>';
        }
      }
    } else if (tab === "classify") {
      var cl = layers.classify || {};
      if (cl.tempo) {
        html += '<div class="cx-sec-h" style="margin-left:0;">Classification by Tempo</div>';
        for (var k in cl.tempo) {
          if (!Object.prototype.hasOwnProperty.call(cl.tempo, k)) continue;
          var label = k.replace(/_/g, " ").toUpperCase();
          html += '<div class="cx-pres-card"><div class="cx-pres-step-title">' + esc(label) + '</div><ul class="cx-qlist">';
          var items = cl.tempo[k];
          for (var j = 0; j < items.length; j++) html += '<li>' + esc(items[j]) + '</li>';
          html += '</ul></div>';
        }
      }
      var sysObj = cl.organSystems || cl.syndromes || cl.neuroaxis || cl.mechanism;
      if (sysObj) {
        html += '<div class="cx-sec-h" style="margin-left:0;margin-top:16px;">Etiological / Anatomical Breakdown</div>';
        for (var sk in sysObj) {
          if (!Object.prototype.hasOwnProperty.call(sysObj, sk)) continue;
          var sLabel = sk.replace(/_/g, " ").toUpperCase();
          html += '<div class="cx-pres-card"><div class="cx-pres-step-title">' + esc(sLabel) + '</div><ul class="cx-qlist">';
          var sItems = sysObj[sk];
          for (var sj = 0; sj < sItems.length; sj++) html += '<li>' + esc(sItems[sj]) + '</li>';
          html += '</ul></div>';
        }
      }
    } else if (tab === "discriminators") {
      var disc = layers.discriminators || [];
      html += '<div class="cx-sec-h" style="margin-left:0;">High-Yield Clinical Discriminators</div>';
      for (var d = 0; d < disc.length; d++) {
        html += '<div class="cx-pres-card">' +
          '<div style="font-weight:700;font-size:15px;color:var(--cx-primary);margin-bottom:6px;">' + esc(disc[d].title) + '</div>' +
          '<div style="font-size:14px;line-height:1.5;margin-bottom:8px;">' + esc(disc[d].finding) + '</div>' +
          '<div style="padding:8px 10px;background:var(--cx-warn-bg);border-radius:var(--cx-r-ctl);font-size:12.5px;color:var(--cx-warn);display:flex;align-items:center;gap:6px;">' +
          ic("lightbulb") + '<span><b>High-Yield Pearl:</b> ' + esc(disc[d].highYield) + '</span></div></div>';
      }
    } else if (tab === "dontmiss") {
      var dm = layers.dontMiss || [];
      html += '<div class="cx-sec-h" style="margin-left:0;">Emergency "Don\'t Miss" Diagnoses</div>';
      for (var m = 0; m < dm.length; m++) {
        html += '<div class="cx-pres-card" style="border-left:4px solid var(--cx-bad);">' +
          '<div style="font-weight:800;font-size:16px;color:var(--cx-bad);margin-bottom:4px;">' + esc(dm[m].disease) + '</div>' +
          '<div style="font-size:13.5px;margin-bottom:6px;"><b>Clinical Clue:</b> ' + esc(dm[m].clue) + '</div>' +
          '<div style="font-size:13.5px;background:var(--cx-bad-bg);padding:8px 10px;border-radius:var(--cx-r-ctl);color:var(--cx-bad);line-height:1.45;">' +
          '<b>Immediate Action:</b> ' + esc(dm[m].action) + '</div></div>';
      }
    } else if (tab === "investigations") {
      var ix = layers.investigations || {};
      html += '<div class="cx-sec-h" style="margin-left:0;">Tiered Diagnostic Strategy</div>';
      var tiers = [
        { key: "step1_immediate", title: "Step 1: Immediate Bedside & Stat Orders", icon: "bolt" },
        { key: "step2_urgent", title: "Step 2: Urgent Labs & Imaging", icon: "timelapse" },
        { key: "step3_confirmatory", title: "Step 3: Confirmatory / Specialized Investigations", icon: "check_circle" }
      ];
      for (var ti = 0; ti < tiers.length; ti++) {
        var tList = ix[tiers[ti].key] || [];
        if (!tList.length) continue;
        html += '<div class="cx-pres-card"><div class="cx-pres-step-title">' + ic(tiers[ti].icon) + ' ' + esc(tiers[ti].title) + '</div>' +
          '<ul class="cx-qlist">';
        for (var tj = 0; tj < tList.length; tj++) html += '<li>' + esc(tList[tj]) + '</li>';
        html += '</ul></div>';
      }
    } else if (tab === "skills") {
      var skIds = layers.skills || [];
      html += '<div class="cx-sec-h" style="margin-left:0;">Linked Core Clinical Skills (The Atom)</div><div class="cx-rows">';
      for (var s = 0; s < skIds.length; s++) {
        var skObj = b.skills && b.skills[skIds[s]];
        var sTitle = (skObj && skObj.title) || prettySkill(skIds[s]);
        var sOneLine = (skObj && skObj.oneLine) || "Tap to practice this clinical skill";
        html += '<button type="button" class="cx-row" data-act="cx-skill" data-id="' + esc(skIds[s]) + '">' +
          '<span class="cx-row-ic">' + ic("touch_app") + '</span>' +
          '<span class="cx-row-txt"><span class="cx-row-t">' + esc(sTitle) + '</span>' +
          '<span class="cx-row-s">' + esc(sOneLine) + '</span></span>' +
          ic("chevron_right") + '</button>';
      }
      html += '</div>';

      var pearls = layers.examPearls || [];
      if (pearls.length) {
        html += '<div class="cx-sec-h" style="margin-left:0;margin-top:18px;">University Exam & Viva Pearls</div>';
        for (var pi = 0; pi < pearls.length; pi++) {
          html += '<div class="cx-pres-card" style="background:var(--cx-surface-2);">' +
            '<div style="font-weight:700;font-size:14px;color:var(--cx-teach);margin-bottom:4px;">' + esc(pearls[pi].topic) + '</div>' +
            '<div style="font-size:13.5px;line-height:1.5;">' + esc(pearls[pi].text) + '</div></div>';
        }
      }
    }

    html += '</div>';
    host.innerHTML = html;
  }

  /* ── screen: spoken case presentation script ──────────────────────────────── */

  function generateScriptForPresentation(id) {
    var b = state.presentationBuilt;
    var p = (b && b.presentation) || {};
    var pid = id || (p && p.id) || "breathlessness";

    if (pid === "chest_pain") {
      return {
        title: "Spoken Case Presentation: Acute Chest Pain (ACS)",
        sections: [
          {
            heading: "1. Demographic Particulars & Chief Complaints",
            text: "Respectful greetings, Sir/Madam. I am presenting the case of Mr. Suresh Menon, a 58-year-old gentleman, bank branch manager, residing at Ernakulam, with no previous history of angina, who presented to the emergency triage with:\n" +
              "1. Severe crushing retrosternal chest pain radiating to left shoulder and jaw for 3 hours\n" +
              "2. Profuse cold sweating and nausea for 3 hours."
          },
          {
            heading: "2. History of Present Illness (HPI)",
            text: "The patient was in his usual state of health until 3 hours ago, when while at rest he developed sudden-onset, severe, retrosternal chest heaviness, described as an 'iron weight' pressing on the sternum (VAS 9/10). The pain radiated to the medial aspect of the left arm, left shoulder, and angle of the jaw. It was unprovoked and unrelieved by rest.\n\n" +
              "Negative History Rule-Outs: The pain is NOT pleuritic or posture-dependent (arguing against acute pericarditis). NO sudden tearing interscapular back pain or loss of pulse in either arm (arguing against Acute Aortic Dissection). NO sudden-onset breathlessness, hemoptysis, or unilateral calf swelling (arguing against acute pulmonary embolism). NO retrosternal burning related to food or relieved by antacids."
          },
          {
            heading: "3. Past, Personal & Drug History",
            text: "Past History: Known type 2 diabetes mellitus for 8 years on oral Metformin; hypertensive for 5 years on Telmisartan. No previous history of myocardial infarction or PCI.\n" +
              "Personal History: Non-smoker, non-alcoholic. Sedentary lifestyle, high occupational stress.\n" +
              "Drug History: Compliant with Metformin 500 mg BD and Telmisartan 40 mg OD. No known drug allergies."
          },
          {
            heading: "4. General Physical Examination",
            text: "Patient is anxious, distressed, clutching chest (Levine sign), pale and diaphoretic. Vitals: Pulse is 98 beats per minute, regular, normal volume, all peripheral pulses equally palpable, no radio-femoral delay. Blood pressure is 144/92 mmHg in both arms. Respiratory rate is 22 breaths per minute, abdomino-thoracic. SpO2 is 96% on room air. Capillary refill time is < 2 seconds.\n\n" +
              "General Survey: No pallor, icterus, cyanosis, clubbing, pedal edema, or lymphadenopathy. JVP is not elevated."
          },
          {
            heading: "5. Systemic Cardiovascular Examination",
            text: "Inspection & Palpation: Precordium is normal. Apex beat is in the 5th left intercostal space, midclavicular line, normal character. No thrills or left parasternal heave.\n" +
              "Percussion: Normal cardiac borders.\n" +
              "Auscultation: First and second heart sounds (S1, S2) heard normally. A fourth heart sound (S4 gallop) is present at the apex with the bell, indicating reduced LV compliance. No third heart sound. No murmurs (ruling out acute mitral regurgitation from papillary muscle dysfunction or VSR). No pericardial friction rub.\n" +
              "Respiratory System: Bilateral vesicular breath sounds with fine bibasilar inspiratory crackles (Killip Class II)."
          },
          {
            heading: "6. Summary & Problem Representation",
            text: "In summary, this is a 58-year-old gentleman, with known diabetes and hypertension, presenting with hyperacute onset crushing retrosternal chest pain, autonomic symptoms, S4 gallop, and bibasilar crackles, presenting within 3 hours of symptom onset, highly suggestive of an acute coronary syndrome."
          },
          {
            heading: "7. Provisional Diagnosis",
            text: "1. Anatomical: Left anterior descending (LAD) coronary artery distribution.\n" +
              "2. Etiological: Atherosclerotic plaque rupture with superimposed acute occlusive thrombus.\n" +
              "3. Functional / Severity: Acute ST-Elevation Myocardial Infarction (Killip Class II), presenting in the early window period (< 12 hours)."
          },
          {
            heading: "8. Bedside Plan of Management",
            text: "1. Immediate Emergency Antiplatelet & Anticoagulant Loading: Soluble Aspirin 325 mg chewed immediately + Ticagrelor 180 mg loading dose (or Clopidogrel 600 mg). High-intensity statin: Atorvastatin 80 mg.\n" +
              "2. Pain & Hemodynamic Stabilization: IV Fentanyl or Morphine titrated; Sublingual Nitroglycerin (with strict check that SBP > 100 mmHg and no RV infarction signs).\n" +
              "3. Revascularization Strategy: Immediate activation of Cath Lab for Primary Percutaneous Coronary Intervention (PPCI), target door-to-balloon time < 90 minutes. If Cath Lab not available within 120 minutes, immediate IV thrombolysis with Tenecteplase.\n" +
              "4. Bedside Monitoring & Telemetry: Continuous ECG rhythm monitoring for ventricular arrhythmias, serial hs-Troponin I, bedside echocardiogram for regional wall motion abnormalities (RWMA) and mechanical complications."
          }
        ]
      };
    }

    if (pid === "acute_weakness") {
      return {
        title: "Spoken Case Presentation: Acute Neurological Deficit (Stroke)",
        sections: [
          {
            heading: "1. Demographic Particulars & Chief Complaints",
            text: "Respectful greetings, Sir/Madam. I am presenting the case of Mrs. Savitri Devi, a 62-year-old lady, homemaker, residing in Vellore, who was brought to our emergency service with:\n" +
              "1. Sudden weakness of right upper and lower limbs for 2 hours\n" +
              "2. Inability to speak and deviation of mouth to left side for 2 hours."
          },
          {
            heading: "2. History of Present Illness (HPI)",
            text: "The patient was in her usual health until this morning at 07:30 AM when, while drinking tea, she dropped the cup from her right hand and slumped onto the chair. Family members noted complete inability to move the right arm and leg, inability to articulate words, and deviation of mouth to the left side. Last known normal was strictly verified as 07:15 AM today.\n\n" +
              "Negative History Rule-Outs: NO preceding headache, projectile vomiting, or neck stiffness (arguing against subarachnoid hemorrhage or acute raised ICP). NO history of generalized or focal seizures, post-ictal confusion, or tongue bite (arguing against Todd's palsy). NO history of fever or ear discharge. NO history of antecedent head trauma (arguing against chronic or acute subdural hematoma). NO history of fluctuating diplopia, sensory levels, or radicular pain."
          },
          {
            heading: "3. Past, Personal & Drug History",
            text: "Past History: Known hypertensive for 12 years; known chronic non-valvular atrial fibrillation for 3 years. History of ischemic heart disease 4 years ago. No previous history of stroke or TIA.\n" +
              "Personal History: Vegetarian, non-smoker, no history of substance use.\n" +
              "Drug History: Taking Amlodipine 5 mg OD and Digoxin 0.25 mg OD. Was prescribed oral anticoagulation (Rivaroxaban 20 mg) but discontinued it herself 4 months ago due to financial constraints."
          },
          {
            heading: "4. General Physical Examination",
            text: "Patient is conscious, alert, making eye contact, attempting to speak with grunting sounds (expressive dysphasia), obeying simple non-verbal commands. Vitals: Pulse is 112 beats per minute, irregularly irregular in rhythm, variable volume, pulse deficit of 18 bpm (consistent with atrial fibrillation). Blood pressure is 176/98 mmHg in right upper limb. Respiratory rate is 18 breaths per minute, regular. SpO2 is 98% on room air. Capillary blood glucose is 128 mg/dL (ruling out stroke-mimicking hypoglycemia).\n\n" +
              "General Survey: No carotid bruits. No peripheral markers of infective endocarditis (Osler nodes, Janeway lesions, splinter hemorrhages absent)."
          },
          {
            heading: "5. Systemic Neurological Examination",
            text: "Higher Mental Functions: Glasgow Coma Scale is E4 V3 M6 (13/15). Right-handed individual. Severe expressive (Broca's) aphasia with preserved comprehension of simple commands. No neglect.\n" +
              "Cranial Nerves: Right upper motor neuron (UMN) facial nerve palsy with flattening of right nasolabial fold and deviation of angle of mouth to left, with normal forehead wrinkling. Normal pupil reaction and extraocular movements.\n" +
              "Motor System: Bulk is symmetric. Tone is flaccid on right upper and lower limbs (hypotonia of acute shock stage). Power: Right upper limb 0/5, right lower limb 1/5; Left upper and lower limbs 5/5. Deep tendon reflexes: Biceps, triceps, supinator, knee, and ankle jerks are diminished on right (acute stage), brisk on left. Plantar response: Extensor (Babinski positive) on right, flexor on left.\n" +
              "Sensory System: Reduced sensation to pinprick over right hemibody.\n" +
              "Calculated NIHSS Score: 14 (Moderate-to-severe neurological deficit)."
          },
          {
            heading: "6. Summary & Problem Representation",
            text: "In summary, this is a 62-year-old lady with uncontrolled atrial fibrillation and poor anticoagulant compliance, presenting within 2 hours of hyperacute right hemiplegia, right UMN facial palsy, and Broca's aphasia, with an NIHSS score of 14, in the acute hyperacute stroke window."
          },
          {
            heading: "7. Provisional Diagnosis",
            text: "1. Anatomical / Vascular Localization: Left Middle Cerebral Artery (MCA) superior division territory, cortical motor strip and Broca's area.\n" +
              "2. Pathological / Etiological: Acute cardioembolic ischemic stroke secondary to non-valvular atrial fibrillation (TOAST classification: Cardioembolic).\n" +
              "3. Functional / Severity: Dense right hemiplegia and motor aphasia (NIHSS 14), within the 4.5-hour intravenous thrombolysis window."
          },
          {
            heading: "8. Bedside Plan of Management",
            text: "1. Emergency Neuroimaging: Immediate Non-Contrast Computed Tomography (NCCT) of the brain + CT angiography of head and neck vessels to exclude hemorrhage and evaluate for large vessel occlusion (LVO) of left M1/M2 MCA.\n" +
              "2. Revascularization Strategy: If NCCT shows no hemorrhage and ASPECTS score is > 6, initiate intravenous thrombolysis with Tenecteplase 0.25 mg/kg (or Alteplase 0.9 mg/kg) within the 4.5-hour therapeutic window. Prepare for mechanical thrombectomy if LVO is confirmed.\n" +
              "3. Blood Pressure Management: Maintain BP < 185/110 mmHg prior to thrombolysis (using IV Labetalol or Nicardipine) and < 180/105 mmHg for 24 hours post-thrombolysis.\n" +
              "4. Supportive & Stroke Unit Care: Strict NPO until formal swallow screen (prevent aspiration pneumonia); target normoglycemia (140-180 mg/dL), normothermia, and DVT prophylaxis after 24-hour follow-up scan."
          }
        ]
      };
    }

    if (pid === "jaundice") {
      return {
        title: "Spoken Case Presentation: Jaundice & Hepatobiliary Disease",
        sections: [
          {
            heading: "1. Demographic Particulars & Chief Complaints",
            text: "Respectful greetings, Sir/Madam. I am presenting the case of Mr. Prakash Rao, a 46-year-old gentleman, accountant, resident of Hubli, who presented with:\n" +
              "1. Yellowish discoloration of eyes and dark high-colored urine for 3 weeks\n" +
              "2. Severe colicky pain in right upper abdomen for 2 days\n" +
              "3. High-grade fever with chills and rigors for 2 days."
          },
          {
            heading: "2. History of Present Illness (HPI)",
            text: "The patient was well until 3 weeks ago when he noticed progressive yellowing of the sclera, accompanied by high-colored dark urine and pale, clay-colored stools. He developed intense generalized pruritus, most prominent on palms and soles. For the past 2 days, he developed severe, episodic, gripping pain in the right hypochondrium radiating to the right inferior scapular angle, accompanied by fever with shaking chills.\n\n" +
              "Negative History Rule-Outs: NO prodromal anorexia, aversion to smoking, or viral prodrome (arguing against acute viral hepatitis). NO history of massive alcohol consumption. NO history of abdominal distension, hematemesis, melena, or altered sleep-wake cycle (arguing against decompensated cirrhosis with portal hypertension). NO history of unprovoked progressive painless jaundice or significant cachexia (arguing against periampullary carcinoma)."
          },
          {
            heading: "3. Past, Personal & Drug History",
            text: "Past History: History of recurrent post-prandial fatty food intolerance and dyspepsia for 2 years. No previous jaundice, blood transfusions, or surgeries.\n" +
              "Personal History: Non-alcoholic, non-smoker, vegetarian diet.\n" +
              "Drug History: Taking over-the-counter antacids; no history of hepatotoxic drug intake, herbal supplements, or ATT."
          },
          {
            heading: "4. General Physical Examination",
            text: "Patient is conscious, febrile (102.4 F), visibly deeply jaundiced, in moderate painful distress. Vitals: Pulse is 108 beats per minute, regular, full volume. Blood pressure is 114/72 mmHg. Respiratory rate is 20 breaths per minute. SpO2 is 98% on room air.\n\n" +
              "General Survey: Deep greenish-yellow icterus on sclera, under-surface of tongue, and soft palate. Multiple linear excoriations (scratch marks) on both forearms and abdomen. No pallor, cyanosis, clubbing, or pedal edema. No peripheral stigmata of chronic liver disease (spider angiomas, palmar erythema, dupuytren contracture, gynecomastia are all absent)."
          },
          {
            heading: "5. Systemic Abdominal & Hepatobiliary Examination",
            text: "Inspection: Abdomen is flat, moves symmetrically with respiration. Umbilicus is central and inverted. No dilated veins or visible caput medusae.\n" +
              "Palpation: Abdomen is soft. Marked tenderness in the right hypochondrium and epigastrium. Positive Murphy sign. Liver is palpable 2 cm below right costal margin, tender, smooth surface, firm edge. Courvoisier Sign: Gallbladder is NOT palpable (consistent with fibrotic shrunken gallbladder from recurrent calculous cholecystitis obstructing the CBD). Spleen is not palpable.\n" +
              "Percussion: Liver span is 13 cm. No shifting dullness or fluid thrill (no ascites).\n" +
              "Auscultation: Normal bowel sounds present. No hepatic or arterial bruits."
          },
          {
            heading: "6. Summary & Problem Representation",
            text: "In summary, this is a 46-year-old gentleman presenting with a 3-week history of obstructive jaundice (pruritus, dark urine, acholic stools), now complicated by the acute onset of Charcot's triad (right upper quadrant pain, jaundice, and high-grade fever with rigors), indicating acute ascending cholangitis secondary to choledocholithiasis."
          },
          {
            heading: "7. Provisional Diagnosis",
            text: "1. Anatomical: Extrahepatic biliary tree, common bile duct (CBD).\n" +
              "2. Etiological: Choledocholithiasis (secondary CBD stone from chronic cholelithiasis).\n" +
              "3. Functional / Complications: Acute ascending calculous cholangitis (Charcot's triad) with severe obstructive cholestasis."
          },
          {
            heading: "8. Bedside Plan of Management",
            text: "1. Emergency Sepsis Resuscitation: Immediate IV fluid resuscitation with balanced crystalloids; blood cultures drawn before starting antibiotics.\n" +
              "2. Broad-Spectrum Intravenous Antibiotics: IV Piperacillin-Tazobactam 4.5 g q6h (or Ceftriaxone + Metronidazole) covering biliary enteric gram-negative bacilli and anaerobes.\n" +
              "3. Diagnostic Imaging: Urgent high-resolution USG Abdomen & pelvis (to confirm dilated CBD > 8 mm, identify intraductal calculus, and assess gallbladder wall thickening) followed by MRCP.\n" +
              "4. Urgent Biliary Decompression: Emergent Endoscopic Retrograde Cholangiopancreatography (ERCP) with endoscopic biliary sphincterotomy, stone extraction, and stent placement within 24-48 hours. If ERCP fails or unavailable, Percutaneous Transhepatic Biliary Drainage (PTBD)."
          }
        ]
      };
    }

    if (pid === "acute_abdomen") {
      return {
        title: "Spoken Case Presentation: Acute Abdomen (Appendicitis)",
        sections: [
          {
            heading: "1. Demographic Particulars & Chief Complaints",
            text: "Respectful greetings, Sir/Madam. I am presenting the case of Mr. Amit Verma, a 24-year-old gentleman, postgraduate student, residing in Bangalore, who presented with:\n" +
              "1. Pain in the abdomen for 24 hours\n" +
              "2. Anorexia and two episodes of vomiting for 18 hours\n" +
              "3. Low-grade fever for 12 hours."
          },
          {
            heading: "2. History of Present Illness (HPI)",
            text: "The patient was in normal health until yesterday morning when he developed dull, aching, poorly localized periumbilical pain. After approximately 8 hours, the pain shifted and localized sharply to the right iliac fossa (Murphy's classic triad of symptoms). The pain is constant, exacerbated by coughing, walking, and sudden movements, and relieved slightly by lying still with right hip flexed. He experienced total loss of appetite (hamburger sign positive) followed by two episodes of non-bilious vomiting.\n\n" +
              "Negative History Rule-Outs: NO severe burning micturition, gross hematuria, or pain radiating to the groin/testis (arguing against right ureteric calculus). NO profuse watery diarrhea or bloody stools (arguing against acute gastroenteritis or inflammatory bowel disease). NO severe upper abdominal pain radiating through to the mid-back (arguing against acute pancreatitis). NO history of previous abdominal surgery (ruling out adhesive bowel obstruction)."
          },
          {
            heading: "3. Past, Personal & Drug History",
            text: "Past History: No history of major medical illnesses, diabetes, or hypertension. No history of recurrent abdominal pain.\n" +
              "Personal History: Non-smoker, non-alcoholic. Bowel movements were normal prior to the onset of illness.\n" +
              "Drug History: Took an over-the-counter paracetamol tablet 12 hours ago with minimal relief. No known drug allergies."
          },
          {
            heading: "4. General Physical Examination",
            text: "Patient is conscious, alert, oriented, lying still in supine position with the right thigh slightly flexed to relieve peritoneal tension. Vitals: Pulse is 96 beats per minute, regular, normal volume. Blood pressure is 120/78 mmHg. Temperature is 99.6 F (low-grade pyrexia). Respiratory rate is 18 breaths per minute, predominantly thoracic due to peritoneal guarding.\n\n" +
              "General Survey: Tongue is dry with mild furring. No pallor, icterus, cyanosis, clubbing, or pedal edema. No supraclavicular lymphadenopathy."
          },
          {
            heading: "5. Systemic Surgical & Abdominal Examination",
            text: "Inspection: Abdomen is flat, moves with respiration, but movement is visibly restricted in the right lower quadrant. No visible peristalsis, distension, scars, or cough impulses at hernial orifices.\n" +
              "Palpation: Point of maximum tenderness is at McBurney's point (junction of lateral 1/3 and medial 2/3 of line from ASIS to umbilicus). Involuntary localized muscle guarding and cutaneous hyperesthesia (Sherren's triangle) in right iliac fossa. Rebound tenderness (Blumberg's sign) is positive. Rovsing's sign is positive (pressure in left iliac fossa elicits pain in right iliac fossa). Psoas sign is positive (pain on hyperextension of right hip). Obturator sign is positive on internal rotation of flexed right hip.\n" +
              "Percussion: Percussion tenderness over right iliac fossa. Normal liver dullness preserved (no pneumoperitoneum).\n" +
              "Auscultation: Hypoactive bowel sounds in all four quadrants.\n" +
              "Digital Rectal Examination: Tenderness localized to the right pelvic peritoneum.\n" +
              "Alvarado Score: 9 out of 10 (Highly predictive of acute appendicitis)."
          },
          {
            heading: "6. Summary & Problem Representation",
            text: "In summary, this is a 24-year-old young man presenting with the classic sequence of visceral periumbilical pain shifting to somatic right iliac fossa pain over 24 hours, anorexia, nausea, fever, McBurney's point tenderness with localized guarding, rebound tenderness, and an Alvarado score of 9, consistent with acute appendicitis."
          },
          {
            heading: "7. Provisional Diagnosis",
            text: "1. Anatomical: Vermiform appendix in the retrocecal / pelvic position.\n" +
              "2. Etiological: Acute luminal obstruction by a fecalith / lymphoid hyperplasia with bacterial superinfection.\n" +
              "3. Functional / Stage: Acute suppurative appendicitis approaching gangrenous perforation."
          },
          {
            heading: "8. Bedside Plan of Management",
            text: "1. Immediate Preoperative Preparation: Keep strictly NPO (nil per os); establish wide-bore IV access; initiate IV fluid resuscitation with Ringer's Lactate to replace deficit.\n" +
              "2. Preoperative Antimicrobial Prophylaxis: IV Ceftriaxone 1 g + IV Metronidazole 500 mg 30-60 minutes prior to surgical incision.\n" +
              "3. Analgesia: IV Paracetamol and titrated opioid analgesia (proven safe without masking peritoneal signs).\n" +
              "4. Surgical Intervention: Emergency Laparoscopic Appendectomy (or open appendectomy via McBurney's / Lanz incision), with peritoneal washout if perforation or localized peritonitis is identified intraoperatively."
          }
        ]
      };
    }

    // Default: Respiratory / Breathlessness (matches test expectations exactly)
    return {
      title: "Spoken Case Presentation: " + (p.title || "Approach to the Breathless Patient"),
      sections: [
        {
          heading: "1. Demographic Particulars & Chief Complaints",
          text: "Respectful greetings, Sir/Madam. I am presenting the case of Mr. Ramesh Kumar, a 54-year-old gentleman, farmer by occupation, resident of Belgaum, who presented to our medical outpatient department with chief complaints of:\n" +
            "1. Breathlessness on exertion for the past 6 months, worsening since the last 5 days\n" +
            "2. Cough with expectoration for the past 2 months\n" +
            "3. Swelling over both lower limbs for the past 2 weeks."
        },
        {
          heading: "2. History of Present Illness (HPI)",
          text: "The patient was reasonably asymptomatic 6 months ago, when he first noticed breathlessness. The onset was insidious, initially mMRC Grade 1, progressing over 6 months to mMRC Grade 3. For the last 5 days, breathlessness acutely worsened to mMRC Grade 4 following a febrile upper respiratory illness.\n\n" +
            "Negative History Rule-Outs: There is NO history of orthopnoea or paroxysmal nocturnal dyspnoea. NO history of crushing retrosternal chest pain or syncope (arguing against acute coronary syndrome or critical aortic stenosis). NO history of haemoptysis, evening rise of temperature, drenching night sweats, or significant weight loss (arguing against pulmonary tuberculosis or malignancy). NO history of calf pain, prolonged immobilisation, or previous deep vein thrombosis (arguing against acute pulmonary embolism)."
        },
        {
          heading: "3. Past, Personal & Drug History",
          text: "Past History: Patient has a 10-year history of chronic productive cough, previously treated as chronic bronchitis. No history of diabetes, hypertension, or ischemic heart disease.\n" +
            "Personal History: Patient has a 25 pack-year smoking history (Smoking index: 500), stopped 1 year ago. No alcohol consumption. Bowel and bladder habits are regular.\n" +
            "Drug History: Taking inhaled salbutamol occasionally with incomplete relief. No known drug allergies."
        },
        {
          heading: "4. General Physical Examination",
          text: "Patient is conscious, alert, cooperative, sitting upright in bed with audible expiratory wheeze. Vitals: Pulse is 104 beats per minute, regular, normal volume and character. Blood pressure is 126/82 mmHg in right upper limb in supine posture. Respiratory rate is 28 breaths per minute, abdomino-thoracic with pursed-lip breathing and accessory muscle use. SpO2 is 89% on room air. Temperature is 98.4 F.\n\n" +
            "General Survey: Mild central cyanosis is noted on the ventral surface of the tongue. Grade 2 bilateral pitting pedal edema extending up to the lower third of the shins. No pallor, icterus, clubbing, or generalised lymphadenopathy. JVP is elevated 4 cm above the sternal angle at 45 degrees with prominent 'a' waves."
        },
        {
          heading: "5. Systemic Respiratory Examination",
          text: "Inspection: Barrel-shaped chest with increased anteroposterior diameter. Trachea is central with reduced cricosternal distance (2 fingerbreadths). Bilateral chest expansion is symmetrically reduced (2 cm).\n" +
            "Palpation: Apex beat is palpable in the epigastrium (suggesting RV heave). Tactile vocal fremitus is symmetrically decreased over all lung zones.\n" +
            "Percussion: Hyperresonant percussion note bilaterally with obliteration of cardiac dullness and lower border of liver pushed down to 7th intercostal space.\n" +
            "Auscultation: Vesicular breath sounds with prolonged expiration. Polyphonic expiratory wheezes heard throughout both hemithoraces. Bilateral early inspiratory coarse crackles at the bases which do not clear with coughing. Vocal resonance is symmetrically decreased."
        },
        {
          heading: "6. Summary & Problem Representation",
          text: "In summary, this is a 54-year-old gentleman, chronic heavy smoker with a 6-month history of progressive dyspnoea and chronic cough, presenting with an acute exacerbation, hypoxemia, hyperinflated chest, polyphonic wheezing, and physical signs of secondary pulmonary hypertension and right ventricular failure (cor pulmonale)."
        },
        {
          heading: "7. Provisional Diagnosis",
          text: "1. Anatomical: Chronic obstructive pulmonary disease (COPD) involving airways and lung parenchyma.\n" +
            "2. Etiological: Tobacco-smoke induced chronic obstructive bronchitis with emphysema.\n" +
            "3. Functional / Severity: Acute Exacerbation of COPD (Anthonisen Type 1), with Cor Pulmonale and decompensated right heart failure, in Type 2 respiratory failure."
        },
        {
          heading: "8. Bedside Plan of Management",
          text: "1. Immediate Stabilization: Controlled supplemental oxygen via Venturi mask (target SpO2 strictly 88-92% to prevent loss of hypoxic ventilatory drive). Upright positioning.\n" +
            "2. Nebulization: Nebulized short-acting beta-2 agonist (Salbutamol 2.5 mg) + anticholinergic (Ipratropium 500 mcg) via air-driven nebulizer.\n" +
            "3. Systemic Corticosteroids: Oral Prednisolone 40 mg daily for 5 days.\n" +
            "4. Immediate Investigations: Arterial Blood Gas (ABG) to assess PaCO2 and pH; 12-lead ECG (P-pulmonale, RV strain); Erect Chest Radiograph (hyperinflation, rule out pneumothorax or consolidation); CBC, CRP, and renal function panel."
        }
      ]
    };
  }

  function openScript(id) {
    state.scriptData = generateScriptForPresentation(id);
    go("script");
  }

  function renderScript(host) {
    var sd = state.scriptData;
    if (!sd) { host.innerHTML = header("Presentation Script") + emptyState("error", "No script available", "Select a case or presentation first."); return; }

    var html = header(sd.title, "Formal spoken presentation for examiners & ward rounds", "cx-presentation");

    html += '<div class="cx-script-bar">' +
      '<button type="button" class="cx-btn cx-btn--primary" style="flex:1;" data-act="cx-script-copy">' + ic("content_copy") + ' Copy Full Script</button>' +
      '<button type="button" class="cx-btn cx-btn--ghost" style="flex:1;" data-act="cx-script-read">' + ic("record_voice_over") + ' Read Aloud</button>' +
      '</div>';

    html += '<div class="cx-script-box">';
    for (var i = 0; i < sd.sections.length; i++) {
      var s = sd.sections[i];
      html += '<div class="cx-script-sec">' +
        '<div class="cx-script-h">' + esc(s.heading) + '</div>' +
        '<div class="cx-script-body">' + esc(s.text).replace(/\n/g, "<br>") + '</div>' +
        '</div>';
    }
    html += '</div>';

    html += '<div class="cx-nav" style="padding:0 16px 20px;"><button type="button" class="cx-btn cx-btn--primary" style="width:100%;" data-act="cx-back">Back to Presentation</button></div>';
    host.innerHTML = html;
  }

  /* ── screen: ABG Simulator & Interpretation Engine ────────────────────────── */

  var ABG_PRESETS = {
    dka: { name: "DKA (High AG Acidosis)", ph: 7.15, paco2: 20, hco3: 7, na: 135, cl: 98, alb: 4.0 },
    diarrhea: { name: "Severe Diarrhea (Normal AG)", ph: 7.24, paco2: 26, hco3: 11, na: 140, cl: 118, alb: 4.0 },
    asthma: { name: "Acute Severe Asthma (Resp Acidosis)", ph: 7.25, paco2: 60, hco3: 26, na: 140, cl: 102, alb: 4.0 },
    panic: { name: "Hyperventilation (Resp Alkalosis)", ph: 7.55, paco2: 24, hco3: 21, na: 140, cl: 104, alb: 4.0 },
    vomiting: { name: "Severe Vomiting (Met Alkalosis)", ph: 7.52, paco2: 48, hco3: 38, na: 138, cl: 88, alb: 4.0 },
    triple: { name: "Triple Mixed Disorder", ph: 7.40, paco2: 40, hco3: 24, na: 145, cl: 95, alb: 4.0 }
  };

  function openAbg() {
    go("abg");
  }

  function solveAbg(vals) {
    var ph = vals.ph || 7.40;
    var paco2 = vals.paco2 || 40;
    var hco3 = vals.hco3 || 24;
    var na = vals.na || 140;
    var cl = vals.cl || 102;
    var alb = vals.alb || 4.0;

    var stateStr = ph < 7.35 ? "Acidemia" : ph > 7.45 ? "Alkalemia" : "Normal pH";

    var primary = "Normal acid-base balance";
    if (ph < 7.35) {
      if (paco2 > 45 && hco3 < 22) primary = "Combined Respiratory & Metabolic Acidosis";
      else if (paco2 > 45) primary = "Primary Respiratory Acidosis";
      else if (hco3 < 22) primary = "Primary Metabolic Acidosis";
      else primary = "Acidemia with mixed compensation";
    } else if (ph > 7.45) {
      if (paco2 < 35 && hco3 > 26) primary = "Combined Respiratory & Metabolic Alkalosis";
      else if (paco2 < 35) primary = "Primary Respiratory Alkalosis";
      else if (hco3 > 26) primary = "Primary Metabolic Alkalosis";
      else primary = "Alkalemia with mixed compensation";
    } else {
      if (paco2 > 45 && hco3 > 26) primary = "Compensated Respiratory Acidosis or Metabolic Alkalosis";
      else if (paco2 < 35 && hco3 < 22) primary = "Compensated Respiratory Alkalosis or Metabolic Acidosis";
    }

    var ag = na - (cl + hco3);
    var corrAg = ag + (2.5 * (4.0 - alb));
    var agState = corrAg > 14 ? "High Anion Gap (HAGMA)" : corrAg < 8 ? "Low Anion Gap" : "Normal Anion Gap (NAGMA)";

    var compStr = "";
    if (primary.indexOf("Metabolic Acidosis") >= 0) {
      var expPaco2 = (1.5 * hco3) + 8;
      var minP = expPaco2 - 2, maxP = expPaco2 + 2;
      if (paco2 < minP) compStr = "Concomitant Respiratory Alkalosis (PaCO2 " + paco2 + " < expected " + minP.toFixed(1) + "–" + maxP.toFixed(1) + ")";
      else if (paco2 > maxP) compStr = "Concomitant Respiratory Acidosis (PaCO2 " + paco2 + " > expected " + minP.toFixed(1) + "–" + maxP.toFixed(1) + ")";
      else compStr = "Appropriate Respiratory Compensation by Winter's Formula (expected PaCO2 " + minP.toFixed(1) + "–" + maxP.toFixed(1) + ")";
    } else if (primary.indexOf("Respiratory Acidosis") >= 0) {
      var deltaP = paco2 - 40;
      var expAcuteHco3 = 24 + (deltaP * 0.1);
      var expChronicHco3 = 24 + (deltaP * 0.35);
      compStr = "Acute compensation expects HCO3 ~" + expAcuteHco3.toFixed(1) + "; Chronic compensation expects HCO3 ~" + expChronicHco3.toFixed(1);
    }

    var deltaStr = "";
    if (corrAg > 12 && (24 - hco3) > 0) {
      var deltaRatio = (corrAg - 12) / (24 - hco3);
      if (deltaRatio < 0.8) deltaStr = "Delta Ratio = " + deltaRatio.toFixed(2) + " (< 0.8: Mixed HAGMA + Normal Anion Gap Metabolic Acidosis)";
      else if (deltaRatio > 2.0) deltaStr = "Delta Ratio = " + deltaRatio.toFixed(2) + " (> 2.0: Mixed HAGMA + Pre-existing Metabolic Alkalosis)";
      else deltaStr = "Delta Ratio = " + deltaRatio.toFixed(2) + " (0.8–2.0: Pure High Anion Gap Metabolic Acidosis)";
    }

    return {
      ph: ph, paco2: paco2, hco3: hco3, na: na, cl: cl, alb: alb,
      stateStr: stateStr, primary: primary, ag: ag, corrAg: corrAg,
      agState: agState, compStr: compStr, deltaStr: deltaStr
    };
  }

  function renderAbg(host) {
    var v = state.abgValues;
    var sol = solveAbg(v);

    var html = header("ABG Simulator & Diagnostic Engine", "6-step acid-base evaluation with Winter's formula and Delta-Delta ratio", "cx-back");

    html += '<div class="cx-sec"><div class="cx-sec-h" style="margin-left:0;">Quick Clinical Presets</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;">';
    for (var k in ABG_PRESETS) {
      html += '<button type="button" class="cx-btn cx-btn--ghost" style="font-size:12px;padding:6px 10px;" data-act="cx-abg-preset" data-id="' + esc(k) + '">' +
        esc(ABG_PRESETS[k].name) + '</button>';
    }
    html += '</div></div>';

    html += '<div class="cx-abg-box">' +
      '<div class="cx-sec-h" style="margin-left:0;margin-top:0;">Arterial Blood Gas & Electrolyte Values</div>' +
      '<div class="cx-abg-grid">' +
        '<div class="cx-abg-input-wrap"><span class="cx-abg-label">pH (7.35–7.45)</span>' +
          '<input type="number" class="cx-abg-input" id="cxAbgPh" step="0.01" value="' + sol.ph + '"></div>' +
        '<div class="cx-abg-input-wrap"><span class="cx-abg-label">PaCO₂ mmHg (35–45)</span>' +
          '<input type="number" class="cx-abg-input" id="cxAbgPaco2" step="1" value="' + sol.paco2 + '"></div>' +
        '<div class="cx-abg-input-wrap"><span class="cx-abg-label">HCO₃⁻ mEq/L (22–26)</span>' +
          '<input type="number" class="cx-abg-input" id="cxAbgHco3" step="1" value="' + sol.hco3 + '"></div>' +
        '<div class="cx-abg-input-wrap"><span class="cx-abg-label">Na⁺ mEq/L (135–145)</span>' +
          '<input type="number" class="cx-abg-input" id="cxAbgNa" step="1" value="' + sol.na + '"></div>' +
        '<div class="cx-abg-input-wrap"><span class="cx-abg-label">Cl⁻ mEq/L (96–106)</span>' +
          '<input type="number" class="cx-abg-input" id="cxAbgCl" step="1" value="' + sol.cl + '"></div>' +
        '<div class="cx-abg-input-wrap"><span class="cx-abg-label">Albumin g/dL (4.0)</span>' +
          '<input type="number" class="cx-abg-input" id="cxAbgAlb" step="0.1" value="' + sol.alb + '"></div>' +
      '</div>' +
      '<button type="button" class="cx-btn cx-btn--primary" style="width:100%;" data-act="cx-abg-calc">' + ic("calculate") + ' Calculate Acid-Base Diagnosis</button>' +

      '<div class="cx-abg-verdict">' +
        '<div class="cx-abg-verdict-title">' + esc(sol.primary) + '</div>' +
        '<div class="cx-abg-verdict-step"><b>Step 1 (pH):</b> ' + esc(sol.stateStr) + ' (pH ' + sol.ph.toFixed(2) + ')</div>' +
        '<div class="cx-abg-verdict-step"><b>Step 2 (Anion Gap):</b> AG = ' + sol.ag.toFixed(1) + ' mEq/L &middot; Albumin-Corrected AG = <b>' + sol.corrAg.toFixed(1) + ' mEq/L</b> (' + esc(sol.agState) + ')</div>' +
        (sol.compStr ? '<div class="cx-abg-verdict-step"><b>Step 3 (Compensation):</b> ' + esc(sol.compStr) + '</div>' : '') +
        (sol.deltaStr ? '<div class="cx-abg-verdict-step"><b>Step 4 (Delta-Delta):</b> ' + esc(sol.deltaStr) + '</div>' : '') +
      '</div></div>';

    host.innerHTML = html;
  }

  /* ── screen: spotter arena ────────────────────────────────────────────────── */

  var SPOTTER_QUESTIONS = [
    {
      q: "A 42-year-old female presents with breathlessness. The jugular venous pulse shows giant, prominent 'a' waves. Which condition is the most likely cause?",
      opts: ["Tricuspid Regurgitation", "Tricuspid Stenosis / Severe Pulmonary HTN", "Constrictive Pericarditis", "Atrial Fibrillation"],
      correct: 1,
      why: "Giant 'a' waves occur when the right atrium contracts forcefully against an increased resistance (stenosed tricuspid valve or high pulmonary arterial pressure). Cannon 'a' waves occur in complete heart block when RA contracts against a closed tricuspid valve."
    },
    {
      q: "In an acute right-sided hemiplegia, the patient can wrinkle their forehead symmetrically when looking up, but cannot smile on the right side. Where is the lesion?",
      opts: ["Right Facial Nerve at stylomastoid foramen", "Left Corticobulbar Tract (Upper Motor Neuron)", "Right Pontine Facial Nucleus", "Cerebellopontine angle"],
      correct: 1,
      why: "The frontalis muscle receives bilateral corticobulbar innervation. Supranuclear / UMN lesions spare the forehead. Lower Motor Neuron lesions paralyze the entire hemiface including the forehead."
    },
    {
      q: "A 65-year-old male has a harsh crescendo-decrescendo ejection systolic murmur loudest in the right 2nd intercostal space. To which site does this murmur classically radiate?",
      opts: ["Left Axilla", "Bilateral Carotid Arteries", "Epigastrium", "Left Scapular angle"],
      correct: 1,
      why: "The harsh ejection systolic murmur of Aortic Stenosis radiates along the direction of high-velocity jet flow into both carotid arteries."
    },
    {
      q: "During abdominal examination, shifting dullness requires approximately how much free peritoneal fluid to be clinically detectable at the bedside?",
      opts: ["100–200 mL", "500 mL", "1500 mL", "5000 mL"],
      correct: 2,
      why: "Shifting dullness requires at least 1500 mL of fluid to shift reliably with gravity. Smaller volumes (< 1500 mL) require ultrasound for reliable detection."
    },
    {
      q: "On pupillary examination, the pupils are small and irregular. They constrict briskly to accommodation but do NOT react to direct or consensual light. What is this sign?",
      opts: ["Horner's syndrome", "Argyll Robertson Pupil", "Adie's tonic pupil", "Marcus Gunn pupil"],
      correct: 1,
      why: "Light-near dissociation in Argyll Robertson pupil is classically caused by neurosyphilis affecting the midbrain pretectal area."
    },
    {
      q: "Spoon-shaped, concave nails (Koilonychia) are a characteristic physical sign of which disorder?",
      opts: ["Hypothyroidism", "Severe Chronic Iron Deficiency Anemia", "Chronic Liver Disease", "Cyanotic Heart Disease"],
      correct: 1,
      why: "Koilonychia reflects chronic tissue iron depletion leading to thinning and concavity of the nail plates."
    },
    {
      q: "A patient with acute spinal cord compression has complete loss of pinprick and light touch sensation below the umbilicus. What is the sensory spinal level?",
      opts: ["T4", "T7", "T10", "L1"],
      correct: 2,
      why: "T4 corresponds to the nipples, T10 to the umbilicus, and L1 to the inguinal ligament."
    },
    {
      q: "During thoracic inspection of an emphysematous patient, the subcostal angle is widened and the lower costal margins move inward paradoxically during inspiration. What is this sign called?",
      opts: ["Kussmaul sign", "Hoover's sign", "Campbell's sign", "Pemberton's sign"],
      correct: 1,
      why: "Hoover's sign is paradoxical inward movement of the lower lateral ribcage during inspiration, caused by flat, hyperinflated diaphragms pulling the ribs inward rather than downward."
    },
    {
      q: "A 22-year-old patient with jaundice and tremors has a golden-brown ring visible at the limbus of the cornea. What is the diagnostic substance deposited?",
      opts: ["Bilirubin", "Copper", "Iron", "Calcium"],
      correct: 1,
      why: "Kayser-Fleischer rings represent copper deposition in Descemet's membrane of the cornea, pathognomonic of Wilson's disease."
    },
    {
      q: "On cardiac auscultation at the apex in left lateral position, an opening snap is heard 0.08s after S2, followed by a low-pitched mid-diastolic rumble. What is the valve pathology?",
      opts: ["Mitral Stenosis", "Mitral Regurgitation", "Aortic Regurgitation", "Tricuspid Stenosis"],
      correct: 0,
      why: "In Mitral Stenosis, high left atrial pressure forcibly opens the stenosed mitral valve with an Opening Snap, followed by turbulent diastolic inflow creating the mid-diastolic rumble."
    }
  ];

  function openSpotter() {
    state.spotterIndex = 0;
    state.spotterAnswers = {};
    state.spotterSeconds = 60;
    state.spotterDone = false;
    startSpotterTimer();
    go("spotter");
  }

  function startSpotterTimer() {
    stopSpotterTimer();
    state.spotterSeconds = 60;
    state.spotterTimer = setInterval(function () {
      state.spotterSeconds--;
      if (state.spotterSeconds <= 0) {
        stopSpotterTimer();
        if (state.spotterAnswers[state.spotterIndex] == null) {
          state.spotterAnswers[state.spotterIndex] = -1;
          haptic("fail");
          repaint();
        }
      } else {
        var el = document.getElementById("cxSpotterTime");
        if (el) {
          el.textContent = state.spotterSeconds + "s";
          if (state.spotterSeconds <= 15) el.parentElement.classList.add("cx-spotter-timer--urgent");
        }
      }
    }, 1000);
  }

  function stopSpotterTimer() {
    if (state.spotterTimer) { clearInterval(state.spotterTimer); state.spotterTimer = null; }
  }

  function renderSpotter(host) {
    if (state.spotterDone) {
      renderSpotterResults(host);
      return;
    }
    var sq = SPOTTER_QUESTIONS[state.spotterIndex];
    if (!sq) { renderSpotterResults(host); return; }

    var html = header("Spotter Arena", "Question " + (state.spotterIndex + 1) + " of " + SPOTTER_QUESTIONS.length, "cx-back");

    html += '<div class="cx-spotter-arena">' +
      '<div class="cx-spotter-timer' + (state.spotterSeconds <= 15 ? " cx-spotter-timer--urgent" : "") + '">' +
        '<span>' + ic("timer") + ' Rapid-Fire Spotter</span>' +
        '<span id="cxSpotterTime">' + state.spotterSeconds + 's</span></div>';

    html += '<div style="font-size:16px;font-weight:700;line-height:1.45;margin-bottom:14px;">' + esc(sq.q) + '</div>';

    var answered = state.spotterAnswers[state.spotterIndex] != null;
    var given = state.spotterAnswers[state.spotterIndex];

    for (var i = 0; i < sq.opts.length; i++) {
      var optCls = "cx-spotter-opt";
      if (answered) {
        if (i === sq.correct) optCls += " cx-spotter-opt--correct";
        else if (i === given) optCls += " cx-spotter-opt--wrong";
      }
      html += '<button type="button" class="' + optCls + '" ' + (answered ? "disabled" : "") +
        ' data-act="cx-spotter-ans" data-i="' + i + '">' +
        '<span style="display:inline-block;width:24px;font-weight:800;">' + String.fromCharCode(65 + i) + '.</span>' +
        '<span>' + esc(sq.opts[i]) + '</span></button>';
    }

    if (answered) {
      html += '<div style="margin-top:14px;padding:12px;border-radius:var(--cx-r-ctl);background:var(--cx-surface-2);font-size:13.5px;line-height:1.5;">' +
        '<b>Explanation:</b> ' + esc(sq.why) + '</div>';

      var isLast = state.spotterIndex >= SPOTTER_QUESTIONS.length - 1;
      html += '<div class="cx-nav" style="margin-top:16px;"><button type="button" class="cx-btn cx-btn--primary" style="width:100%;" data-act="cx-spotter-next">' +
        (isLast ? "View Final Score" : "Next Spotter") + ' ' + ic("arrow_forward") + '</button></div>';
    }

    html += '</div>';
    host.innerHTML = html;
  }

  function renderSpotterResults(host) {
    stopSpotterTimer();
    var correctCount = 0;
    for (var i = 0; i < SPOTTER_QUESTIONS.length; i++) {
      if (state.spotterAnswers[i] === SPOTTER_QUESTIONS[i].correct) correctCount++;
    }
    var pct = Math.round((correctCount / SPOTTER_QUESTIONS.length) * 100);

    var html = header("Spotter Arena Results", "Final Performance Summary", "cx-back");
    html += '<div class="cx-score ' + (pct >= 70 ? "cx-score--pass" : "cx-score--fail") + '">' +
      '<div class="cx-score-v">' + pct + '% (' + correctCount + ' of ' + SPOTTER_QUESTIONS.length + ')</div>' +
      '<div class="cx-score-l">' + (pct >= 80 ? "Honors Distinction" : pct >= 50 ? "Pass with Merit" : "Needs Review") + '</div></div>';

    html += '<div class="cx-sec"><div class="cx-sec-h">Spotter Breakdown</div><div class="cx-rows">';
    for (var j = 0; j < SPOTTER_QUESTIONS.length; j++) {
      var isRight = state.spotterAnswers[j] === SPOTTER_QUESTIONS[j].correct;
      html += '<div class="cx-weak"><div class="cx-weak-t">' + (isRight ? ic("check_circle") : ic("cancel")) +
        ' ' + esc(SPOTTER_QUESTIONS[j].q.substring(0, 60)) + '...</div>' +
        '<div class="cx-weak-b" style="font-size:12px;color:var(--cx-muted);margin-top:2px;">' +
        'Correct: ' + esc(SPOTTER_QUESTIONS[j].opts[SPOTTER_QUESTIONS[j].correct]) + '</div></div>';
    }
    html += '</div></div>';

    html += '<div class="cx-nav" style="padding:16px;"><button type="button" class="cx-btn cx-btn--primary" style="width:100%;" data-act="cx-spotter-retry">' +
      ic("replay") + ' Try Spotter Arena Again</button></div>';
    host.innerHTML = html;
  }

  /* ── screen: the chief's ward round (strict professor viva) ───────────────── */

  var CHIEF_QUESTIONS = [
    {
      q: "Patil! Look at Bed 14: A 52-year-old chronic smoker presenting with acute respiratory distress. The trachea is deviated to the left, and the entire right hemithorax is stony dull with absent breath sounds. What is your immediate syndromic diagnosis?",
      opts: ["Right Tension Pneumothorax", "Massive Right Pleural Effusion", "Right Lobar Pneumonia", "Right Total Lung Collapse"],
      correct: 1,
      examinerPraise: "Good. Stony dullness with absent breath sounds and contralateral shift is the hallmark of massive effusion. You didn't fall for pneumonia.",
      examinerScold: "Careless! A collapsed lung pulls the trachea towards the lesion, and pneumothorax is hyperresonant! Stony dullness means fluid!"
    },
    {
      q: "Explain the physics of why the trachea shifted to the opposite side. What is the intrapleural pressure in a massive effusion?",
      opts: ["The fluid volume exceeds lung recoil and exerts positive intrapleural pressure", "The contralateral lung pulls the trachea", "Diaphragmatic paralysis pulls the mediastinum", "Negative suction pressure in the fluid"],
      correct: 0,
      examinerPraise: "Precisely. The large volume of fluid creates positive pressure, pushing the mobile mediastinum away.",
      examinerScold: "Wrong! Normal intrapleural pressure is negative. When massive fluid accumulates, it builds positive intrapleural pressure that pushes the mediastinum."
    },
    {
      q: "You perform a diagnostic thoracocentesis. The pleural fluid protein is 4.4 g/dL and serum protein is 6.8 g/dL. What does Light's criteria conclude?",
      opts: ["Transudate because fluid protein < 5 g/dL", "Exudate because pleural/serum protein ratio is > 0.5", "Chylothorax", "Inconclusive without LDH"],
      correct: 1,
      examinerPraise: "Accurate. 4.4 / 6.8 is 0.65, which is strictly > 0.5. Meets Light's criteria for an exudate.",
      examinerScold: "Nonsense! Light's first criterion is pleural protein / serum protein > 0.5! 4.4 divided by 6.8 is 0.65, which is an exudate!"
    },
    {
      q: "An intern offers to drain 3 Liters of fluid in 10 minutes to relieve the patient's breathlessness. What life-threatening danger do you stop them from causing?",
      opts: ["Tension Pneumothorax", "Re-expansion Pulmonary Oedema", "Acute Hemothorax", "Air Embolism"],
      correct: 1,
      examinerPraise: "Well stopped. Rapid drainage creates intense negative intrapleural pressure, damaging alveolar capillary membranes and causing fatal re-expansion pulmonary oedema.",
      examinerScold: "You would have killed the patient! Draining more than 1.5 L at once causes sudden severe re-expansion pulmonary oedema!"
    },
    {
      q: "For an exudative lymphocytic effusion in an Indian adult, what is the single most important confirmatory diagnostic workup?",
      opts: ["Empirical course of broad-spectrum antibiotics", "Pleural fluid ADA, GeneXpert MTB/RIF, and Closed/Thoracoscopic Pleural Biopsy", "Serum ACE levels and high-resolution CT", "Immediate empirical steroid therapy"],
      correct: 1,
      examinerPraise: "Excellent clinical sense. Tuberculosis is the commonest etiology; pleural biopsy provides histological and microbiological confirmation.",
      examinerScold: "Never treat empirically without tissue or microbiological confirmation! TB pleurisy is endemic; pleural fluid ADA and pleural biopsy are mandatory!"
    }
  ];

  function openChief() {
    state.chiefIndex = 0;
    state.chiefAnswered = {};
    state.chiefDone = false;
    go("chief");
  }

  function renderChief(host) {
    if (state.chiefDone) {
      renderChiefResults(host);
      return;
    }
    var cq = CHIEF_QUESTIONS[state.chiefIndex];
    if (!cq) { renderChiefResults(host); return; }

    var html = header("The Chief's Ward Round", "Prof. Dr. V. K. Ramanathan, MD, FRCP", "cx-back");

    html += '<div class="cx-chief-banner">' +
      '<div class="cx-chief-title">' + ic("military_tech") + ' Medicine Ward 4B &middot; Morning Grand Round</div>' +
      '<div class="cx-chief-sub">Bedside viva with the Senior Professor of Medicine. Direct questions, zero tolerance for vague answers.</div></div>';

    html += '<div class="cx-chief-q">' + esc(cq.q) + '</div>';

    var answered = state.chiefAnswered[state.chiefIndex] != null;
    var given = state.chiefAnswered[state.chiefIndex];

    html += '<div class="cx-sec" style="padding-top:0;"><div class="cx-rows">';
    for (var i = 0; i < cq.opts.length; i++) {
      var optCls = "cx-spotter-opt";
      if (answered) {
        if (i === cq.correct) optCls += " cx-spotter-opt--correct";
        else if (i === given) optCls += " cx-spotter-opt--wrong";
      }
      html += '<button type="button" class="' + optCls + '" ' + (answered ? "disabled" : "") +
        ' data-act="cx-chief-ans" data-i="' + i + '">' +
        '<span style="font-weight:800;width:24px;">' + String.fromCharCode(65 + i) + '.</span>' +
        '<span>' + esc(cq.opts[i]) + '</span></button>';
    }
    html += '</div></div>';

    if (answered) {
      var isRight = given === cq.correct;
      html += '<div class="cx-sec"><div class="cx-notice ' + (isRight ? "" : "cx-notice--review") + '">' +
        ic(isRight ? "sentiment_satisfied" : "sentiment_very_dissatisfied") +
        '<div><b>The Professor says:</b><span>' + esc(isRight ? cq.examinerPraise : cq.examinerScold) + '</span></div></div></div>';

      var isLast = state.chiefIndex >= CHIEF_QUESTIONS.length - 1;
      html += '<div class="cx-nav" style="padding:16px;"><button type="button" class="cx-btn cx-btn--primary" style="width:100%;" data-act="cx-chief-next">' +
        (isLast ? "Complete Ward Round" : "Next Bedside Question") + ' ' + ic("arrow_forward") + '</button></div>';
    }

    host.innerHTML = html;
  }

  function renderChiefResults(host) {
    var correctCount = 0;
    for (var i = 0; i < CHIEF_QUESTIONS.length; i++) {
      if (state.chiefAnswered[i] === CHIEF_QUESTIONS[i].correct) correctCount++;
    }
    var pct = Math.round((correctCount / CHIEF_QUESTIONS.length) * 100);

    var html = header("Ward Round Completed", "Prof. Ramanathan's Evaluation", "cx-back");
    html += '<div class="cx-score ' + (pct >= 80 ? "cx-score--pass" : "cx-score--fail") + '">' +
      '<div class="cx-score-v">' + pct + '% Composure</div>' +
      '<div class="cx-score-l">' + (pct >= 80 ? "Professor says: 'Excellent clinical grounding, Patil.'" : "Professor says: 'Read Macleod and Alagappan again tonight.'") + '</div></div>';

    html += '<div class="cx-nav" style="padding:16px;"><button type="button" class="cx-btn cx-btn--primary" style="width:100%;" data-act="cx-chief-retry">' +
      ic("replay") + ' Repeat the Ward Round</button></div>';
    host.innerHTML = html;
  }

  /* ── screen: auscultation sound lab ────────────────────────────────────────── */

  var SOUND_MODELS = [
    { kind: "vesicular", label: "Normal Vesicular Breathing", type: "resp", icon: "air", desc: "Rustling wind in trees. Inspiratory phase 3x longer than expiratory. No gap between inspiration and expiration." },
    { kind: "bronchial", label: "Tubular Bronchial Breathing", type: "resp", icon: "air", desc: "Hollow, tubular breath sound with a distinct pause/gap between inspiration and expiration. Hallmark of consolidation." },
    { kind: "wheeze", label: "Polyphonic Expiratory Wheeze", type: "resp", icon: "graphic_eq", desc: "Musical chords of variable pitches during expiration due to diffuse airway narrowing (Asthma, COPD)." },
    { kind: "monophonic", label: "Monophonic Wheeze", type: "resp", icon: "graphic_eq", desc: "Single-pitch wheeze from fixed localized airway obstruction (foreign body, endobronchial tumor)." },
    { kind: "stridor", label: "Inspiratory Stridor", type: "resp", icon: "warning", desc: "Harsh, high-pitched monophonic inspiratory sound over trachea. Upper airway obstruction emergency." },
    { kind: "fine", label: "Fine End-Inspiratory Crackles", type: "resp", icon: "grain", desc: "Velcro-like sound of sudden alveolar re-opening. Bibasal in pulmonary edema and interstitial fibrosis." },
    { kind: "coarse", label: "Coarse Pan-Inspiratory Crackles", type: "resp", icon: "grain", desc: "Bubbling sound of air passing through secretions in large bronchi. Clears with coughing." },
    { kind: "rub", label: "Pleural Friction Rub", type: "resp", icon: "texture", desc: "Leathery creaking sound during both inspiration and expiration. Disappears when effusion separates pleura." },
    { kind: "s1_s2_normal", label: "Normal S1 & S2 Heart Sounds", type: "cardiac", icon: "favorite", desc: "LUB-DUB cycle with physiological S1 and S2 closure snaps." },
    { kind: "s1_s2_split", label: "Physiological S2 Split", type: "cardiac", icon: "favorite", desc: "Inspiratory widening of A2-P2 split due to increased venous return to right ventricle." },
    { kind: "s3_gallop", label: "S3 Ventricular Gallop ('Kentucky')", type: "cardiac", icon: "favorite", desc: "Dull, low-pitched early diastolic sound of rapid ventricular filling in volume overload / heart failure." },
    { kind: "s4_gallop", label: "S4 Atrial Gallop ('Tennessee')", type: "cardiac", icon: "favorite", desc: "Late diastolic sound of atrial kick against a stiff, non-compliant ventricle (LVH, hypertension)." },
    { kind: "mitral_stenosis", label: "Mitral Stenosis (OS + Rumble)", type: "cardiac", icon: "hearing", desc: "Loud S1 + Opening Snap + Low-pitched mid-diastolic rumbling murmur with presystolic accentuation." },
    { kind: "mitral_regurgitation", label: "Mitral Regurgitation (Pansystolic)", type: "cardiac", icon: "hearing", desc: "Blowing holosystolic murmur radiating to the left axilla. Soft S1." },
    { kind: "aortic_stenosis", label: "Aortic Stenosis (Ejection Systolic)", type: "cardiac", icon: "hearing", desc: "Harsh crescendo-decrescendo ejection systolic murmur radiating to carotids with slow-rising pulse." },
    { kind: "aortic_regurgitation", label: "Aortic Regurgitation (Early Diastolic)", type: "cardiac", icon: "hearing", desc: "High-pitched early diastolic decrescendo murmur best heard at Erb's point leaning forward in expiration." },
    { kind: "pericardial_rub", label: "Pericardial Friction Rub", type: "cardiac", icon: "texture", desc: "Triphasic scratchy, superficial sound (atrial systole, ventricular systole, rapid filling) in acute pericarditis." }
  ];

  function openSoundLab() {
    state.diaMode = "all";
    go("soundlab");
  }

  function renderSoundLab(host) {
    var html = header("Auscultation Sound Lab", "Synthesized pulmonary & cardiac acoustics", "cx-back");

    var filter = state.diaMode || "all";

    html += '<div class="cx-sec"><div class="cx-notice" style="margin-bottom:12px;">' +
      ic("volume_up") + '<div><b>Offline Stethoscope Audio Engine</b>' +
      '<span>Real-time synthesized acoustics powered by the Web Audio API. Zero streaming bandwidth, works offline. Tap any acoustic pattern to listen.</span></div></div>' +
      '<div style="display:flex;gap:6px;margin-bottom:14px;">' +
        '<button type="button" class="cx-mode-btn' + (filter === "all" ? " cx-mode-btn--active" : "") + '" data-act="cx-sound-filter" data-id="all">All (15)</button>' +
        '<button type="button" class="cx-mode-btn' + (filter === "resp" ? " cx-mode-btn--active" : "") + '" data-act="cx-sound-filter" data-id="resp">Respiratory</button>' +
        '<button type="button" class="cx-mode-btn' + (filter === "cardiac" ? " cx-mode-btn--active" : "") + '" data-act="cx-sound-filter" data-id="cardiac">Cardiac</button>' +
      '</div><div class="cx-rows">';

    for (var i = 0; i < SOUND_MODELS.length; i++) {
      var s = SOUND_MODELS[i];
      if (filter !== "all" && s.type !== filter) continue;
      var isPlaying = state.audioKind === s.kind;
      html += '<div class="cx-pres-card" style="padding:14px;margin-bottom:8px;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">' +
          '<div style="font-weight:700;font-size:15px;color:var(--cx-ink);">' + esc(s.label) + '</div>' +
          '<button type="button" class="cx-btn ' + (isPlaying ? "cx-btn--ghost" : "cx-btn--primary") + '" style="padding:6px 12px;font-size:13px;" data-act="cx-audio" data-id="' + esc(s.kind) + '">' +
            ic(isPlaying ? "stop" : "play_arrow") + ' ' + (isPlaying ? "Stop" : "Listen") + '</button></div>' +
        '<div style="font-size:13px;color:var(--cx-muted);line-height:1.45;">' + esc(s.desc) + '</div></div>';
    }

    html += '</div></div>';
    host.innerHTML = html;
  }

  /* ── router ──────────────────────────────────────────────────────────────── */

  var SCREENS = {
    home: renderHome, system: renderSystem, disease: renderDisease, chapter: renderChapter,
    lesson: renderLesson, station: renderStation, viva: renderViva, competency: renderCompetency,
    tutor: renderTutor, case: renderCase, skills: renderSkills,
    presentations: renderPresentations, presentation: renderPresentation, script: renderScript,
    abg: renderAbg, spotter: renderSpotter, chief: renderChief, soundlab: renderSoundLab
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
    try {
      fn(h);
    } catch (e) {
      // Swallowing this silently left a BLANK screen, which reads as "nothing opens" and sent the
      // owner and me hunting in the wrong place. A screen that fails must say so.
      try { console.warn("[CliniX] screen " + key, e); } catch (_) {}
      try {
        h.innerHTML = header("Something went wrong", key) +
          emptyState("error", "This screen could not be drawn",
            "That is a bug in CliniX, not something you did. Go back and try another route.",
            '<button type="button" class="cx-btn cx-btn--ghost" data-act="cx-back">Go back</button>') +
          '<div class="cx-src">' + esc(String((e && e.message) || e)) + "</div>";
      } catch (_) {}
    }
    try { h.scrollTop = keepScroll ? prev : 0; } catch (_) {}
  }

  function go(key) {
    key = String(key || "");
    if (!SCREENS[key]) return;
    stopAudio();
    vivaStopListening();
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

  function closeMod() { stopAudio(); vivaStopListening(); try { if (window.CLINIX && CLINIX.close) CLINIX.close(); } catch (e) {} }

  /* Audio must never outlive the screen that started it. A breath sound still playing after the
   * student has moved on is disorienting and reads as a bug. */
  /* Hand off to the platform. A bare <a target="_blank"> is unreliable inside a WKWebView, so try
   * the Capacitor Browser plugin first, then window.open, then a plain navigation. */
  function openExternal(url) {
    try {
      var P = window.Capacitor && Capacitor.Plugins;
      if (P && P.Browser && P.Browser.open) { P.Browser.open({ url: url }); return; }
    } catch (e) {}
    try { if (window.open(url, "_blank")) return; } catch (e) {}
    try { window.location.href = url; } catch (e) {}
  }

  /* The shim posts up as soon as it loads, and relays the player's own events. Silence means the
   * shim never arrived (offline, or not deployed yet), so swap to the hand-off card rather than
   * leaving a black rectangle. */
  var _ytWired = false, _ytTimers = {};
  function watchYt(vid) {
    if (!_ytWired) {
      _ytWired = true;
      try {
        window.addEventListener("message", function (e) {
          var d = e && e.data;
          if (!d || d.clinixYt !== true || !d.v) return;
          state.ytOk[d.v] = true;
          if (_ytTimers[d.v]) { clearTimeout(_ytTimers[d.v]); delete _ytTimers[d.v]; }
        });
      } catch (er) {}
    }
    if (state.ytOk[vid] || _ytTimers[vid]) return;
    _ytTimers[vid] = setTimeout(function () {
      delete _ytTimers[vid];
      if (state.ytOk[vid]) return;
      state.ytFailed[vid] = true;
      if (state.stack[state.stack.length - 1] === "lesson") repaint();
    }, YT_TIMEOUT_MS);
  }

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
      // Open A, back out, open B before A's fetch resolves - A's response can land after B's. Only
      // apply it if this disease is still the one the student is looking at (same guard shape as
      // vivaAnswer's state.vivaCurrent !== cur check).
      if (state.diseaseId !== id) return;
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

  function revealAnswer() {
    var i = state.turnIndex, t = state.turns[i];
    if (!t || (t.kind !== "ask" && t.kind !== "check") || state.answered[i]) return;
    state.answered[i] = { correct: null, given: "", revealed: true, missed: [] };
    if (P()) P().record(state.skillId, null, { mode: "learn", probe: t.probe.q, given: "(shown)" });
    haptic("tap");
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
    /* One recorded attempt per CHECKLIST ITEM, exactly like Learn and Viva record one per probe.
     *
     * This used to collapse every item for a skill into a single verdict -
     * record(sid, ps.correct === ps.seen) - so ticking 5 of 6 items filed one hard WRONG against
     * the whole skill, and a student who examined the chest well twice was told chest expansion
     * was a weak area. Recording each item keeps the store's seen/correct counters proportionate
     * (5 right, 1 wrong) with no threshold to argue about, and gives the miss log the ONE thing
     * that makes "Weak areas" useful: which step was actually missed. */
    if (P()) {
      for (var n = 0; n < state.station.items.length; n++) {
        var it = state.station.items[n];
        if (!it.skillId) continue;
        var got = !!state.stationChecked[it.id];
        P().record(it.skillId, got, {
          mode: "osce",
          probe: it.label || it.text || state.station.title,
          given: got ? "(performed)" : "(not performed)"
        });
      }
    }
    haptic(r.passed ? "success" : "error");
    repaint();
  }

  // MBBS/PG is a student preference (persisted via SMD_CLINIX_FLAGS, same "?query -> localStorage
  // -> default" pattern as every other CliniX flag), never an authoring flag. mbbs caps at level 3
  // (no postgraduate-tier probes); pg starts one level higher and can reach level 4.
  function vivaTier() { return flagVal("smd_clinix_viva_tier") === "pg" ? "pg" : "mbbs"; }
  function vivaTierOpts(tier) { return tier === "pg" ? { startLevel: 2, maxLevel: 4 } : { startLevel: 1, maxLevel: 3 }; }
  function flagVal(k) { try { return window.SMD_CLINIX_FLAGS && SMD_CLINIX_FLAGS.get(k); } catch (e) { return null; } }

  function startViva() {
    var tier = vivaTier(), opts = vivaTierOpts(tier);
    var v = C().vivaFor(state.built, opts);
    if (!v || !v.pool.length) { toast("No viva questions available yet"); return; }
    state.viva = v;
    state.vivaState = { level: v.startLevel, asked: {}, count: 0, best: v.startLevel, lastAnswer: null, tier: tier };
    state.vivaCurrent = M().nextVivaQuestion(v, state.vivaState);
    state.vivaSpokenFor = null;
    go("viva");
  }

  // Switching tier ends the current viva and restarts fresh at the new tier's floor - a mid-session
  // jump in difficulty would be a strange examiner, not an adaptive one.
  function vivaSetTier(tier) {
    try { window.SMD_CLINIX_FLAGS && SMD_CLINIX_FLAGS.set("smd_clinix_viva_tier", tier); } catch (e) {}
    if (state.viva) startViva();
  }

  // The AI examiner is used ONLY when the free, offline check in markAnswer() cannot decide
  // (a probe with no accept[] list - res.needsJudge). Every probe WITH an accept list is graded
  // for free, instantly, no network call - that is most probes, so this is the exception path,
  // not the default one. That is the entire cost design: MaiK never generates a viva question,
  // and is only ever asked to examine an answer the deterministic check could not grade itself.
  function vivaAnswer(given) {
    var cur = state.vivaCurrent;
    if (!cur || state.vivaState.lastAnswer) return;
    var res = M().markAnswer(cur.q.probe, given);
    state.vivaState.count++;   // answering counts now, whether or not a verdict is in yet
    if (res.needsJudge && flag("smd_clinix_tutor") && window.SMD_CLINIX_TUTOR && SMD_CLINIX_TUTOR.vivaAvailable()) {
      state.vivaState.lastAnswer = { correct: null, given: given, pending: true };
      repaint();
      SMD_CLINIX_TUTOR.judgeVivaAnswer(cur.q.probe, given).then(function (r) {
        // The student may already have moved on (tapped Next while MaiK was still examining) -
        // only apply the verdict if this is still the same unanswered question.
        if (state.vivaCurrent !== cur || !state.vivaState.lastAnswer || !state.vivaState.lastAnswer.pending) return;
        applyVivaVerdict(cur, given, r);
      });
      return;
    }
    finishVivaAnswer(cur, given, res.correct);
  }

  function finishVivaAnswer(cur, given, correct, examinerFeedback, examinerVerdict) {
    state.vivaState.lastAnswer = { correct: correct, given: given, examinerFeedback: examinerFeedback || "", examinerVerdict: examinerVerdict || "" };
    if (P()) P().record(cur.q.skillId, correct, { mode: "viva", probe: cur.q.probe.q, given: String(given) });
    /* Three outcomes, three signals. `null` means MaiK could not judge the answer (offline, quota,
     * timeout) - vivaNext deliberately refuses to demote the student for it, so buzzing the
     * wrong-answer haptic contradicted the module's own rule and told them they had failed. */
    haptic(correct === true ? "success" : correct === null ? "light" : "warning");
    repaint();
  }

  function applyVivaVerdict(cur, given, r) {
    if (!r || r.error) {
      // MaiK could not judge it (offline, quota, timeout) - degrade honestly to the neutral
      // "needs a human to check" state rather than pretending it was marked.
      finishVivaAnswer(cur, given, null);
      return;
    }
    // partial and incorrect both count as not-yet-correct for mastery (same strict rule as the
    // keyword check: mastery is not one lucky answer), but the student still sees MaiK's real
    // feedback distinguishing "nearly there" from "wrong".
    var correct = r.verdict === "correct" ? true : false;
    finishVivaAnswer(cur, given, correct, r.feedback, r.verdict);
  }

  // Opt-in second opinion on an answer the offline check already graded for free. Never automatic -
  // the student explicitly taps for it, so it never adds cost unless they choose to spend it.
  function vivaAskMaik() {
    var cur = state.vivaCurrent, a = state.vivaState.lastAnswer;
    if (!cur || !a || a.pending || a.revealed || a.examinerVerdict) return;
    if (!(window.SMD_CLINIX_TUTOR && SMD_CLINIX_TUTOR.vivaAvailable())) { toast("MaiK is not available right now"); return; }
    a.pending = true;
    repaint();
    SMD_CLINIX_TUTOR.judgeVivaAnswer(cur.q.probe, a.given).then(function (r) {
      if (state.vivaCurrent !== cur || state.vivaState.lastAnswer !== a) return;
      a.pending = false;
      if (r && r.verdict) { a.examinerFeedback = r.feedback; a.examinerVerdict = r.verdict; }
      else toast((r && r.message) || "MaiK could not review that just now");
      repaint();
    });
  }

  /* ── Voice mode: MaiK speaks the question, the student answers by voice ────
   * Reuses the app's existing on-device speech stack rather than building anything new -
   * native TextToSpeech (same Capacitor plugin maik-ask.js already uses for spoken history-
   * taking) and SMD_VOICE.listen (the same on-device STT MaiK Ask and MaiK Scribe use). Audio
   * never leaves the device either way, and this never touches the AI examiner endpoint - voice
   * mode only changes how the ANSWER gets into the textbox, not who grades it. */
  function speakText(text) {
    text = String(text || "").trim(); if (!text) return;
    try {
      var P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.TextToSpeech;
      if (P && P.speak) P.speak({ text: text, lang: "en-IN", rate: 1.0, pitch: 1.0, category: "playback" }).catch(function () {});
    } catch (e) {}
  }

  function vivaVoiceToggle() {
    var on = flag("smd_clinix_viva_voice");
    try { window.SMD_CLINIX_FLAGS && SMD_CLINIX_FLAGS.set("smd_clinix_viva_voice", !on); } catch (e) {}
    if (on) vivaStopListening();
    repaint();
  }

  // Hard cleanup for navigating away entirely (go()/closeMod()) - always kills the session outright,
  // transcribing or not, since there is no screen left to show the result on.
  function vivaStopListening() {
    if (state.vivaListenHandle) { try { state.vivaListenHandle.stop(); } catch (e) {} state.vivaListenHandle = null; }
    state.vivaListening = false;
    state.vivaTranscribing = false;
  }

  // Whisper ("clinical") first, since the student explicitly wants it and it is the more accurate
  // on-device model - but it is NOT built for every platform yet (see voice.js's own gating), and
  // SMD_VOICE never silently falls back to the cloud for it. If Whisper genuinely is not available
  // here, retry once with the device's default on-device recognizer rather than leaving voice mode
  // dead - both keep audio on-device, this only changes which local model transcribes it.
  // Dictation continues what was typed rather than replacing it.
  function joinSpoken(typed, spoken) {
    var a = String(typed || "").trim(), b = String(spoken || "").trim();
    if (!a) return b;
    if (!b) return a;
    return a + " " + b;
  }

  function vivaMicToggle() {
    // Whisper (the "clinical" engine, now registered on Android too) is a BATCH engine: it never
    // streams live captions, and only produces a transcript once stop() is called, which then
    // takes a few seconds of on-device CPU inference. The old code treated a manual stop tap as
    // fully idle immediately (mic reverted to "tap to speak", empty textbox, no indication
    // anything was happening) for that whole multi-second gap, then silently auto-submitted
    // whatever came back - which reads exactly like "voice input does not work", and a student
    // who taps the mic again during that silent gap orphans the pending transcript entirely (a
    // fresh session supersedes it via the native-bridge session token, so it is discarded when it
    // finally arrives). Show the gap honestly instead, and block a second tap during it.
    if (state.vivaTranscribing) { toast("Still transcribing your answer - one moment"); return; }
    if (state.vivaListening) {
      state.vivaListening = false;
      state.vivaTranscribing = true;
      repaint();
      try { if (state.vivaListenHandle) state.vivaListenHandle.stop(); } catch (e) {}
      return;
    }
    if (!(window.SMD_VOICE && SMD_VOICE.listen)) { toast("Voice input is not available on this device"); return; }
    /* #cxAnswer is re-rendered from state.vivaPartial on every repaint, and typed text lives only
     * in the DOM until submit - so blanking vivaPartial here and repainting DESTROYED whatever the
     * student had already written. Carry it over instead and let dictation continue the sentence. */
    var typed = textAnswer();
    state.vivaPartial = typed;
    state.vivaListening = true;
    // Captured so a transcript that arrives after the student has moved to a DIFFERENT viva
    // question (not just left the screen, which vivaStopListening already handles) is discarded
    // rather than wrongly answering the new question with old speech.
    var startedFor = state.vivaCurrent;
    repaint();
    function onFinal(t) {
      state.vivaListenHandle = null;
      state.vivaListening = false;
      state.vivaTranscribing = false;
      if (state.vivaCurrent !== startedFor) { repaint(); return; }
      state.vivaPartial = joinSpoken(typed, t);
      vivaSubmitVoiceAnswer();
    }
    function onPartial(t) { state.vivaPartial = joinSpoken(typed, t); try { var el = document.getElementById("cxAnswer"); if (el) el.value = state.vivaPartial; } catch (e) {} }
    function fail() { state.vivaListening = false; state.vivaTranscribing = false; state.vivaListenHandle = null; toast("Voice input is not available on this device"); repaint(); }
    // SMD_VOICE.listen({engine:"clinical"}) calls onError SYNCHRONOUSLY (before it returns) on any
    // platform where Whisper isn't registered (a bug fixed for Android on 2026-08-23, but still the
    // right defensive shape - e.g. a build with the plugin missing). When that happens, the
    // fallback started inside onError below already ran, and state.vivaListenHandle is already
    // correctly set (or fail() already toasted), by the time this outer call returns null. The
    // old code assigned that null straight into state.vivaListenHandle here, clobbering the
    // fallback's real handle and toasting "unavailable" even though native STT had just started
    // listening - orphaned, with no stop handle, and the mic UI wrongly showing off. Guard the
    // assignment on truthiness so a genuine (non-Android) clinical success is still recorded, and
    // a synchronous failure never overwrites what onError already decided.
    var handle = SMD_VOICE.listen({
      engine: "clinical", language: "en", noCloud: true,
      onPartial: onPartial, onFinal: onFinal,
      onError: function (why) {
        if (why === "clinical-unavailable") {
          var fh = SMD_VOICE.listen({ language: "en", noCloud: true, onPartial: onPartial, onFinal: onFinal, onError: fail });
          if (fh) state.vivaListenHandle = fh; else fail();
          return;
        }
        fail();
      }
    });
    if (handle) state.vivaListenHandle = handle;
  }

  // Spoken final answer submits directly - a real oral viva does not pause for the student to
  // proofread before the examiner hears it. The transcript is still shown in the textbox first,
  // so if it heard the answer wrong the student sees why, and can retype before tapping Answer if
  // they stop the mic instead of letting it auto-submit (vivaMicToggle only auto-submits onFinal).
  function vivaSubmitVoiceAnswer() {
    var given = (state.vivaPartial || "").trim();
    state.vivaPartial = "";
    if (!given) { repaint(); return; }
    vivaAnswer(given);
  }

  /* Same rule as the lesson: shown is not known. A real examiner would move you DOWN a level for
   * not knowing, so revealing does too. */
  function vivaReveal() {
    var cur = state.vivaCurrent;
    if (!cur || state.vivaState.lastAnswer) return;
    state.vivaState.lastAnswer = { correct: null, given: "", revealed: true };
    state.vivaState.count++;
    if (P()) P().record(cur.q.skillId, null, { mode: "viva", probe: cur.q.probe.q, given: "(shown)" });
    haptic("tap");
    repaint();
  }

  function vivaNext() {
    var s = state.vivaState, cur = state.vivaCurrent;
    if (!cur) return;
    s.asked[cur.key] = 1;
    var la = s.lastAnswer;
    // correct===null covers two very different cases: the student explicitly gave up
    // (revealed:true - demote, same as always) and MaiK could not judge an AI-needed answer
    // (offline/timeout/quota - not the student's fault, hold the level rather than punish them
    // for an infrastructure failure they had no control over).
    if (!(la && la.correct === null && !la.revealed)) {
      s.level = M().adaptLevel(s.level, la && la.correct === true, state.viva.maxLevel);
    }
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
    /* Captured so an answer that arrives after the student opened a DIFFERENT lesson is dropped.
     * openLesson replaces state.tutorLog wholesale, and the old closure kept writing into the
     * detached array - invisible, but it still fired a haptic and a repaint for an answer that
     * belonged to a lesson no longer on screen. Same shape as the viva's startedFor guard. */
    var log = state.tutorLog;
    log.push(entry);
    repaint();

    SMD_CLINIX_TUTOR.answer(tutorContext(), question, function (accumulated) {
      if (state.tutorLog !== log) return;
      entry.partial = accumulated;
      if (state.stack[state.stack.length - 1] === "tutor") repaint();
    }).then(function (r) {
      if (state.tutorLog !== log) return;
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
      /* Open the app's own calculator. CliniX stays OPEN behind it: the lift rule in clinix.css
       * (html.cx-lock .mc-overlay) puts it above the CliniX overlay, so the student returns to the
       * same lesson step on closing it. Without that lift it opens invisibly behind. */
      case "cx-calc":
        haptic("tap");
        try { if (window.MEDCALC && MEDCALC.open) { MEDCALC.open(id); return; } } catch (er) {}
        toast("Calculators are still loading");
        return;

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
      /* Revealing is allowed, but it is recorded as SEEN and never as correct. The store already
       * treats a null result that way, so a revealed answer cannot mint mastery. Making it easy to
       * peek is good teaching; letting a peek count as knowing it is not. */
      case "cx-answer-show": revealAnswer(); return;
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
      case "cx-station-retry":
        if (!state.stationDef) { toast("Could not restart this station"); back(); return; }
        startStation(state.stationDef.id); return;

      case "cx-dia-focus": state.diaFocus = id; haptic("tap"); repaint(); return;
      case "cx-dia-mode": state.diaMode = id; haptic("tap"); repaint(); return;
      case "cx-dia-view": state.diaView = id; haptic("tap"); repaint(); return;
      case "cx-dia-zone":
      case "cx-dia-region": state.diaZone = (state.diaZone === id ? null : id); haptic("tap"); repaint(); return;
      case "cx-wide-toggle": {
        var w = document.getElementById(id);
        if (w) w.classList.toggle("cx-widewrap--open");
        haptic("tap"); return;
      }
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
      case "cx-watch": {
        openExternal("https://www.youtube.com/watch?v=" + id);
        haptic("tap"); return;
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
      case "cx-viva-show": vivaReveal(); return;
      case "cx-viva-next": vivaNext(); return;
      case "cx-viva-ask-maik": vivaAskMaik(); return;
      case "cx-viva-tier": haptic("tap"); vivaSetTier(id === "pg" ? "pg" : "mbbs"); return;
      case "cx-viva-voice-toggle": haptic("tap"); vivaVoiceToggle(); return;
      case "cx-viva-mic": haptic("tap"); vivaMicToggle(); return;

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

      case "cx-mode": setMode(id); return;
      case "cx-presentations": haptic("tap"); openPresentations(); return;
      case "cx-presentation": haptic("tap"); openPresentation(id); return;
      case "cx-pres-tab": state.presentationTab = id; haptic("tap"); repaint(); return;
      case "cx-script-gen": haptic("tap"); openScript(id); return;
      case "cx-script-copy": {
        try {
          var sTxt = "";
          var sd = state.scriptData;
          if (sd && sd.sections) {
            for (var si = 0; si < sd.sections.length; si++) sTxt += sd.sections[si].heading + "\n" + sd.sections[si].text + "\n\n";
          }
          if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(sTxt).then(function () { toast("Presentation script copied to clipboard!"); });
          } else {
            toast("Copied script to clipboard");
          }
        } catch (e) { toast("Copied"); }
        haptic("tap"); return;
      }
      case "cx-script-read": {
        try {
          if (window.speechSynthesis) {
            if (window.speechSynthesis.speaking) {
              window.speechSynthesis.cancel();
              toast("Audio paused");
            } else {
              var fullTxt = "";
              var sdat = state.scriptData;
              if (sdat && sdat.sections) {
                for (var sdi = 0; sdi < sdat.sections.length; sdi++) fullTxt += sdat.sections[sdi].heading + ". " + sdat.sections[sdi].text + " ";
              }
              var utter = new SpeechSynthesisUtterance(fullTxt.substring(0, 1500));
              utter.rate = 0.95;
              window.speechSynthesis.speak(utter);
              toast("Narrating presentation script...");
            }
          } else {
            toast("Speech synthesis not supported on this device");
          }
        } catch (e) {}
        haptic("tap"); return;
      }
      case "cx-abg": haptic("tap"); openAbg(); return;
      case "cx-abg-preset": {
        var pre = ABG_PRESETS[id];
        if (pre) {
          state.abgValues = { ph: pre.ph, paco2: pre.paco2, hco3: pre.hco3, na: pre.na, cl: pre.cl, alb: pre.alb };
          haptic("tap"); repaint();
        }
        return;
      }
      case "cx-abg-calc": {
        var elPh = document.getElementById("cxAbgPh");
        var elPaco2 = document.getElementById("cxAbgPaco2");
        var elHco3 = document.getElementById("cxAbgHco3");
        var elNa = document.getElementById("cxAbgNa");
        var elCl = document.getElementById("cxAbgCl");
        var elAlb = document.getElementById("cxAbgAlb");
        state.abgValues = {
          ph: elPh ? parseFloat(elPh.value) || 7.40 : 7.40,
          paco2: elPaco2 ? parseFloat(elPaco2.value) || 40 : 40,
          hco3: elHco3 ? parseFloat(elHco3.value) || 24 : 24,
          na: elNa ? parseFloat(elNa.value) || 140 : 140,
          cl: elCl ? parseFloat(elCl.value) || 102 : 102,
          alb: elAlb ? parseFloat(elAlb.value) || 4.0 : 4.0
        };
        haptic("tap"); repaint(); return;
      }
      case "cx-spotter": haptic("tap"); openSpotter(); return;
      case "cx-spotter-ans": {
        var optIdx = parseInt(t.getAttribute("data-i"), 10);
        state.spotterAnswers[state.spotterIndex] = optIdx;
        stopSpotterTimer();
        var curQ = SPOTTER_QUESTIONS[state.spotterIndex];
        if (optIdx === (curQ && curQ.correct)) haptic("success"); else haptic("fail");
        repaint(); return;
      }
      case "cx-spotter-next": {
        state.spotterIndex++;
        if (state.spotterIndex >= SPOTTER_QUESTIONS.length) {
          state.spotterDone = true;
        } else {
          startSpotterTimer();
        }
        haptic("tap"); repaint(); return;
      }
      case "cx-spotter-retry": openSpotter(); return;
      case "cx-chief": haptic("tap"); openChief(); return;
      case "cx-chief-ans": {
        var cOptIdx = parseInt(t.getAttribute("data-i"), 10);
        state.chiefAnswered[state.chiefIndex] = cOptIdx;
        var cCurQ = CHIEF_QUESTIONS[state.chiefIndex];
        if (cOptIdx === (cCurQ && cCurQ.correct)) haptic("success"); else haptic("fail");
        repaint(); return;
      }
      case "cx-chief-next": {
        state.chiefIndex++;
        if (state.chiefIndex >= CHIEF_QUESTIONS.length) {
          state.chiefDone = true;
        }
        haptic("tap"); repaint(); return;
      }
      case "cx-chief-retry": openChief(); return;
      case "cx-soundlab": haptic("tap"); openSoundLab(); return;
      case "cx-sound-filter": state.diaMode = id; haptic("tap"); repaint(); return;
    }
  }

  function resume() {
    var pos = P() && P().position();
    if (!pos || !pos.diseaseId) return;
    state.chapterId = pos.chapterId;
    state.diseaseId = pos.diseaseId;
    C().loadDisease(pos.diseaseId).then(function (built) {
      // Same stale-response guard as openDisease(): bail if the student navigated to a different
      // disease while this fetch was in flight.
      if (state.diseaseId !== pos.diseaseId) return;
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

  /* At LOAD, not on mount: a module the student never opened this session would otherwise
   * keep the previous account's data through a sign-out. wireSignout() is idempotent. */
  wireSignout();

  var API = {
    mount: mount, go: go, back: back, wipe: wipe,
    SCREENS: SCREENS,
    _state: function () { return state; },
    _finishStation: finishStation,
    _tutorContext: tutorContext,
    _prettySkill: prettySkill
  };

  if (typeof window !== "undefined") window.SMD_CLINIX_SCREENS = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
