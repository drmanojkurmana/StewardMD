/* FollowCare AI — Doctor Action Center: communication MODEL (Phase-2 enhancement). PURE, deterministic,
 * no I/O, no network, no PHI-at-rest here. The server layer (functions/_followcare_comms.js) does the
 * Firestore/R2/dispatch; this module owns the type registry, validation, structured payloads, the vitals
 * catalogue, the educational-material catalogue, deterministic AI DRAFTS (doctor always approves — nothing
 * here is ever auto-sent), and timeline/status helpers. window.FollowCareComms + module.exports.
 *
 * Every doctor action and every patient response is one entry in the episode's communication log, so
 * "Communication History" is just the sorted log. Backward compatible + additive (flag smd_followcare_actions).
 */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;

  // ---- action-type registry ---------------------------------------------------------------
  // dir:"out" = doctor→patient. requiresResponse => the patient must do something (ack/reply/photo/vitals/
  // review/read). confirm => doctor must confirm before sending. aiDraft => the AI-draft assistant applies.
  var TYPES = {
    instruction:   { id: "instruction",   label: "Send Instruction",        icon: "📨", dir: "out", requiresResponse: "acknowledge", priority: "normal", confirm: false, aiDraft: true,  hasBody: true },
    question:      { id: "question",       label: "Ask Question",            icon: "❓", dir: "out", requiresResponse: "reply",       priority: "normal", confirm: false, aiDraft: true,  hasBody: true },
    photo_request: { id: "photo_request",  label: "Request Photo",           icon: "📷", dir: "out", requiresResponse: "photo",      priority: "normal", confirm: false, aiDraft: false, hasBody: true },
    vitals_request:{ id: "vitals_request", label: "Request Vitals",          icon: "🩺", dir: "out", requiresResponse: "vitals",     priority: "normal", confirm: false, aiDraft: false, hasBody: false },
    earlier_review:{ id: "earlier_review", label: "Request Earlier Review",  icon: "📅", dir: "out", requiresResponse: "review",     priority: "normal", confirm: false, aiDraft: false, hasBody: true },
    video_consult: { id: "video_consult",  label: "Video Consultation",      icon: "🎥", dir: "out", requiresResponse: null,         priority: "normal", confirm: false, aiDraft: false, hasBody: false, comingSoon: true },
    education:     { id: "education",       label: "Send Educational Material",icon: "📄", dir: "out", requiresResponse: "read",       priority: "normal", confirm: false, aiDraft: false, hasBody: false },
    emergency:     { id: "emergency",      label: "Emergency Advice",        icon: "🚨", dir: "out", requiresResponse: "acknowledge", priority: "high",   confirm: true,  aiDraft: true,  hasBody: true },
    close_episode: { id: "close_episode",  label: "Close FollowCare Episode",icon: "✅", dir: "out", requiresResponse: null,         priority: "normal", confirm: true,  aiDraft: false, hasBody: false }
  };
  function types() { return Object.keys(TYPES).map(function (k) { return TYPES[k]; }); }
  function typeDef(t) { return TYPES[t] || null; }

  // ---- vitals catalogue (Request Vitals) --------------------------------------------------
  // key → { label, unit, kind:"number"|"bp", plausible:[min,max] }. Used to build the request AND to
  // validate the patient's submitted values. bp is captured as systolic/diastolic.
  var VITALS = {
    bp:     { key: "bp",     label: "Blood pressure",  unit: "mmHg",    kind: "bp",     plausible: [40, 300] },
    pulse:  { key: "pulse",  label: "Pulse",           unit: "bpm",     kind: "number", plausible: [20, 250] },
    temp:   { key: "temp",   label: "Temperature",     unit: "°C",      kind: "number", plausible: [30, 45] },
    weight: { key: "weight", label: "Weight",          unit: "kg",      kind: "number", plausible: [1, 400] },
    glucose:{ key: "glucose",label: "Blood sugar",     unit: "mg/dL",   kind: "number", plausible: [20, 800] },
    spo2:   { key: "spo2",   label: "SpO₂",            unit: "%",       kind: "number", plausible: [40, 100] },
    rr:     { key: "rr",     label: "Respiratory rate",unit: "/min",    kind: "number", plausible: [4, 80] },
    urine:  { key: "urine",  label: "Urine output",    unit: "mL/24h",  kind: "number", plausible: [0, 8000] }
  };
  function vitalsCatalogue() { return Object.keys(VITALS).map(function (k) { return VITALS[k]; }); }

  // ---- educational-material catalogue -----------------------------------------------------
  // Data-driven so hospitals can extend it. `ref` is a stable slug the server maps to a bundled/R2 asset;
  // the actual file is an owner-provisioning step — the catalogue + delivery/read-tracking are built here.
  var EDUCATION = [
    { ref: "diet_general",     title: "Healthy diet after discharge",        i18nKey: "fc.edu.diet_general",  category: "diet" },
    { ref: "exercise_general", title: "Exercise & activity guide",           i18nKey: "fc.edu.exercise",      category: "activity" },
    { ref: "heart_failure",    title: "Heart failure — living well",         i18nKey: "fc.edu.hf",            category: "cardiology", pathways: ["heart_failure"] },
    { ref: "copd_breathing",   title: "COPD breathing exercises",            i18nKey: "fc.edu.copd",          category: "respiratory", pathways: ["copd"] },
    { ref: "insulin",          title: "Using insulin safely",                i18nKey: "fc.edu.insulin",       category: "endocrine", pathways: ["diabetes"] },
    { ref: "stroke_rehab",     title: "Stroke recovery & rehabilitation",    i18nKey: "fc.edu.stroke",        category: "neurology", pathways: ["stroke"] },
    { ref: "discharge_booklet",title: "Your discharge booklet",              i18nKey: "fc.edu.discharge",     category: "general" }
  ];
  function educationCatalogue() { return EDUCATION.slice(); }
  function educationFor(pathwayId) {
    return EDUCATION.filter(function (e) { return !e.pathways || e.pathways.indexOf(pathwayId) !== -1; });
  }

  var REVIEW_WHEN = ["today", "tomorrow", "within_3_days", "next_available"];
  var CLOSE_REASONS = ["recovered", "transferred", "lost_to_followup", "expired", "other"];
  var MAX_BODY = 2000;

  function str(v) { return String(v == null ? "" : v).trim(); }
  function num(v) { if (v === "" || v == null) return null; var n = Number(v); return isFinite(n) ? n : null; }

  // ---- validate + normalize a doctor action ----------------------------------------------
  // Returns { ok, errors:{field:msg}, value:{type, body, payload, priority, requiresResponse} }.
  function validateAction(type, input) {
    input = input || {};
    var def = TYPES[type];
    var errors = {};
    if (!def) return { ok: false, errors: { type: "Unknown action." }, value: null };
    if (def.comingSoon) return { ok: false, errors: { type: "This action is coming soon." }, value: null };

    var body = str(input.body).slice(0, MAX_BODY);
    var payload = {};

    // A written message is MANDATORY only for these; earlier_review's note + photo_request's examples are optional.
    if (!body && (type === "instruction" || type === "question" || type === "emergency")) errors.body = "Please enter a message.";

    if (type === "vitals_request") {
      var fields = (input.fields || []).filter(function (f) { return !!VITALS[f]; });
      if (!fields.length) errors.fields = "Select at least one measurement.";
      payload.fields = fields;
    } else if (type === "earlier_review") {
      var when = str(input.when);
      if (REVIEW_WHEN.indexOf(when) === -1) errors.when = "Choose when the patient should be reviewed.";
      payload.when = when;
    } else if (type === "education") {
      var ref = str(input.ref);
      if (!EDUCATION.some(function (e) { return e.ref === ref; })) errors.ref = "Choose a material to send.";
      payload.ref = ref;
    } else if (type === "close_episode") {
      var reason = str(input.reason);
      if (CLOSE_REASONS.indexOf(reason) === -1) errors.reason = "Choose a reason.";
      payload.reason = reason;
      payload.notes = str(input.notes).slice(0, MAX_BODY);
    } else if (type === "photo_request") {
      payload.examples = str(input.examples).slice(0, 300);
    }

    if (Object.keys(errors).length) return { ok: false, errors: errors, value: null };
    return {
      ok: true, errors: {},
      value: { type: type, body: body, payload: payload, priority: def.priority, requiresResponse: def.requiresResponse }
    };
  }

  // ---- validate a patient response --------------------------------------------------------
  // kind ∈ acknowledge | reply | vitals | review | read | photo. Returns { ok, errors, value }.
  function validateResponse(kind, input) {
    input = input || {}; var errors = {}, value = { kind: kind };
    if (kind === "acknowledge" || kind === "read" || kind === "review") {
      value.accepted = input.accepted !== false;   // a tap = acknowledged/accepted
    } else if (kind === "reply") {
      var text = str(input.text).slice(0, MAX_BODY);
      if (!text) errors.text = "Please type a reply.";
      value.text = text;
    } else if (kind === "vitals") {
      var out = {}, requested = (input.requested || Object.keys(VITALS));
      requested.forEach(function (k) {
        var vd = VITALS[k]; if (!vd) return;
        if (vd.kind === "bp") {
          var s = num(input[k + "_sys"] != null ? input[k + "_sys"] : (input[k] && input[k].sys));
          var d = num(input[k + "_dia"] != null ? input[k + "_dia"] : (input[k] && input[k].dia));
          if (s != null && d != null) {
            if (s < vd.plausible[0] || s > vd.plausible[1] || d < 20 || d > 200 || d >= s) errors[k] = "Check the blood pressure values.";
            else out[k] = { sys: s, dia: d };
          }
        } else {
          var n = num(input[k]);
          if (n != null) {
            if (n < vd.plausible[0] || n > vd.plausible[1]) errors[k] = "Check the " + vd.label + " value.";
            else out[k] = n;
          }
        }
      });
      if (!Object.keys(out).length && !Object.keys(errors).length) errors._ = "Please enter at least one measurement.";
      value.vitals = out;
    } else if (kind === "photo") {
      var keys = (input.mediaKeys || []).map(str).filter(Boolean);
      if (!keys.length) errors._ = "Please upload at least one photo.";
      value.mediaKeys = keys;
    } else {
      errors.kind = "Unknown response.";
    }
    if (Object.keys(errors).length) return { ok: false, errors: errors, value: null };
    return { ok: true, errors: {}, value: value };
  }

  // ---- uploaded-photo validation (server calls this before presigning) --------------------
  var PHOTO_TYPES = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/heic": "heic", "image/heif": "heic" };
  var PHOTO_MAX_BYTES = 15 * 1024 * 1024;   // 15 MB
  function photoOk(contentType, bytes) {
    var ext = PHOTO_TYPES[String(contentType || "").toLowerCase()];
    if (!ext) return { ok: false, reason: "unsupported_type" };
    if (bytes != null && bytes > PHOTO_MAX_BYTES) return { ok: false, reason: "too_large" };
    return { ok: true, ext: ext };
  }

  // ---- deterministic AI DRAFT assistant (doctor MUST approve — never auto-sent) -----------
  // draft(kind, ctx) → suggested text. ctx: { pathwayId, disease, escalation, score, trend }.
  var DZ = {
    heart_failure: { diet: "maintain a low-salt diet", monitor: "weigh yourself daily", worsen: "your breathing worsens or you develop new swelling" },
    pneumonia:     { diet: "rest and stay well hydrated", monitor: "your temperature", worsen: "fever returns or breathing becomes difficult" },
    copd:          { diet: "continue your breathing exercises", monitor: "your breathing", worsen: "breathlessness worsens or sputum changes colour" },
    diabetes:      { diet: "follow your diabetic diet", monitor: "your blood sugar as advised", worsen: "you feel very drowsy, very thirsty, or sugars stay high/low" },
    acs:           { diet: "take your heart medicines including blood thinners", monitor: "how you feel on exertion", worsen: "you get chest pain, tightness, or breathlessness" },
    cld:           { diet: "avoid alcohol and follow your salt/fluid advice", monitor: "your tummy size and alertness", worsen: "you pass black stools, vomit blood, or become drowsy/confused" },
    aki:           { diet: "stay hydrated as advised", monitor: "your urine output", worsen: "you pass much less urine or become breathless" },
    stroke:        { diet: "continue your rehabilitation exercises", monitor: "your strength and speech", worsen: "you notice new weakness, slurred speech, or facial droop" },
    cellulitis:    { diet: "complete your full course of antibiotics", monitor: "the size and redness of the affected area", worsen: "the redness spreads, or you get fever or severe pain" }
  };
  function dz(p) { return DZ[p] || { diet: "follow your discharge advice", monitor: "how you are feeling", worsen: "you develop any new or worsening symptoms" }; }

  function suggestReply(ctx) {
    ctx = ctx || {}; var d = dz(ctx.pathwayId), esc = ctx.escalation;
    if (esc === "red") {
      return "Based on your latest check-in, you need to be seen urgently. Please go to the nearest emergency department now, or contact the hospital immediately. Your care team has been notified.";
    }
    if (esc === "orange" || esc === "yellow") {
      return "Thank you for your check-in. A few of your answers need a closer look. Please continue your prescribed medicines and " + d.diet + ", and contact us today if things do not improve. Seek urgent care sooner if " + d.worsen + ".";
    }
    return "Your recovery appears to be progressing. Continue your prescribed medications, " + d.diet + ", and monitor " + d.monitor + ". Please contact us immediately if " + d.worsen + ". Otherwise, we will review your progress at your next scheduled follow-up.";
  }
  function draft(kind, ctx) {
    ctx = ctx || {};
    if (kind === "reply") return suggestReply(ctx);
    if (kind === "instruction") { var d = dz(ctx.pathwayId); return "Please continue your prescribed medications and " + d.diet + ". Monitor " + d.monitor + ", and contact us if " + d.worsen + "."; }
    if (kind === "question") { var q = dz(ctx.pathwayId); return "How are you feeling today? In particular, has there been any change in " + q.monitor + "?"; }
    if (kind === "emergency") return "Based on your recent check-in, please attend the Emergency Department immediately or contact your treating hospital urgently. If your symptoms are severe, call your local emergency number now.";
    return "";
  }

  // ---- display / status helpers -----------------------------------------------------------
  var STATUS_ORDER = { queued: 0, sent: 1, delivered: 2, read: 3, replied: 4, failed: 5 };
  function statusRank(s) { return STATUS_ORDER[s] == null ? -1 : STATUS_ORDER[s]; }
  // Merge a new status without regressing (read must not fall back to sent), except failed which always wins.
  function advanceStatus(cur, next) {
    if (next === "failed") return "failed";
    return statusRank(next) > statusRank(cur) ? next : (cur || next);
  }
  // Sort a communication log oldest→newest (stable on createdMs).
  function sortLog(items) {
    return (items || []).slice().sort(function (a, b) { return (a.createdMs || 0) - (b.createdMs || 0); });
  }
  // Short label for a log entry (doctor timeline chip / patient list).
  function entryLabel(entry) {
    var def = TYPES[entry.type];
    if (entry.dir === "in") {
      if (entry.type === "reply") return "Patient replied";
      if (entry.type === "vitals") return "Patient submitted vitals";
      if (entry.type === "photo") return "Patient uploaded photo";
      if (entry.type === "acknowledge") return "Patient acknowledged";
      if (entry.type === "review") return "Patient accepted earlier review";
      if (entry.type === "read") return "Patient read the material";
      return "Patient response";
    }
    return (def && def.label) || entry.type;
  }

  var API = {
    TYPES: TYPES, types: types, typeDef: typeDef,
    VITALS: VITALS, vitalsCatalogue: vitalsCatalogue,
    EDUCATION: EDUCATION, educationCatalogue: educationCatalogue, educationFor: educationFor,
    REVIEW_WHEN: REVIEW_WHEN, CLOSE_REASONS: CLOSE_REASONS, MAX_BODY: MAX_BODY,
    validateAction: validateAction, validateResponse: validateResponse, photoOk: photoOk,
    PHOTO_TYPES: PHOTO_TYPES, PHOTO_MAX_BYTES: PHOTO_MAX_BYTES,
    draft: draft, suggestReply: suggestReply,
    advanceStatus: advanceStatus, statusRank: statusRank, sortLog: sortLog, entryLabel: entryLabel,
    _version: 1
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  G.FollowCareComms = API;
})();
