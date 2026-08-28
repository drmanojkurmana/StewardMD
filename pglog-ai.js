/* pglog-ai.js — NMC Logbook · MaiK assist. ADVISORY ONLY.
 * ===========================================================================
 * What the brief says, and what this file is built to make structurally true:
 *
 *   AI must not invent NMC requirements.      -> every suggestion is filtered against the resolved
 *                                                pack; an id that is not in it is DROPPED, silently
 *                                                from the model's point of view and visibly in the
 *                                                returned `rejected` list for debugging.
 *   AI must not fabricate clinical activity.  -> no function here creates, edits or submits an
 *                                                entry. pglog-store.saveDraft is never imported.
 *   AI must not mark a competency complete.   -> progress is computed by pglog-model from VERIFIED
 *                                                entries. Nothing here writes progress.
 *   AI must not replace faculty verification. -> there is no verify path here at all.
 *   Records stay deterministic and auditable. -> every number in every report comes from the pure
 *                                                model; this file produces PROSE and SUGGESTIONS.
 *
 * THE DETERMINISTIC PATH IS THE PRIMARY ONE. suggest() runs pglog-curriculum.suggestRequirements()
 * first and returns immediately if it is confident. The model is a SECOND opinion for the ambiguous
 * case, and its output is merged as `source: "ai"` so the UI can (and does) render it differently
 * and require a tap to accept.
 *
 * Gated by smd_pglog_ai. Off = the deterministic matcher only, which is the part that actually maps
 * requirements. Nothing breaks.
 *
 * Transport: the app's existing MaiK endpoint via SMD_AI_HEADERS/api, so usage, quotas and the
 * intent firewall all apply unchanged. No new AI plumbing.
 */
(function () {
  "use strict";

  var G = (typeof window !== "undefined") ? window : null;
  function M() { try { return G && G.SMD_PGLOG_MODEL; } catch (e) { return null; } }
  /* Scrub free text on the way OUT to the model. FAIL CLOSED: if the model module is not loaded we
   * send nothing rather than send it unscrubbed — a worse suggestion is cheaper than a patient's
   * name reaching a third-party provider. */
  function scrub(v) { var m = M(); return (m && m.scrubForAi) ? m.scrubForAi(v) : ""; }
  function C() { try { return G && G.SMD_PGLOG_CURRICULUM; } catch (e) { return null; } }
  function on() { try { return !!(G && G.SMD_PGLOG_FLAGS && G.SMD_PGLOG_FLAGS.bool("smd_pglog_ai")); } catch (e) { return false; } }
  function arr(x) { return Array.isArray(x) ? x : []; }

  var AI_URL = "/api/ai/maik";
  var LABEL = "MaiK suggestion — check before accepting";

  function headers() {
    var h = { "Content-Type": "application/json" };
    try {
      if (G.SMD_AI_HEADERS) { var extra = G.SMD_AI_HEADERS("pglog") || {}; for (var k in extra) h[k] = extra[k]; }
      else { var t = G.SMD_IDTOKEN && G.SMD_IDTOKEN(); if (t) h.Authorization = "Bearer " + t; }
    } catch (e) {}
    return h;
  }

  // One transport for every call here. Times out rather than hanging a form the resident is trying
  // to submit — an AI suggestion is never worth blocking a logbook entry.
  function ask(prompt, opts) {
    opts = opts || {};
    if (!on()) return Promise.reject(new Error("ai_off"));
    var ctrl = null;
    try { ctrl = new AbortController(); } catch (e) {}
    var timer = setTimeout(function () { try { ctrl && ctrl.abort(); } catch (e) {} }, opts.timeoutMs || 12000);
    return G.fetch(AI_URL, {
      method: "POST", headers: headers(), signal: ctrl ? ctrl.signal : undefined,
      body: JSON.stringify({ module: "pglog", messages: [{ role: "user", content: prompt }], stream: false, maxTokens: opts.maxTokens || 500 })
    }).then(function (r) {
      clearTimeout(timer);
      if (!r.ok) throw new Error("ai_http_" + r.status);
      return r.json();
    }).then(function (j) {
      return String((j && (j.text || j.answer || (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content))) || "").trim();
    }).catch(function (e) { clearTimeout(timer); throw e; });
  }

  function parseJson(text) {
    var t = String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    try { return JSON.parse(t); } catch (e) {}
    var m = t.match(/[[{][\s\S]*[\]}]/);
    if (m) { try { return JSON.parse(m[0]); } catch (e2) {} }
    return null;
  }

  /* ── 1. Requirement suggestion ───────────────────────────────────────────────
   * Deterministic first. The AI is asked ONLY to choose from a numbered list of requirement ids
   * that were resolved from the curriculum pack — so the worst it can do is choose badly, never
   * invent. Anything it returns that is not in the list is dropped. */
  function suggest(entry, requirements, opts) {
    opts = opts || {};
    var c = C();
    var deterministic = c ? c.suggestRequirements(entry, requirements, opts) : [];
    deterministic.forEach(function (d) { d.source = "rule"; });
    // A strong deterministic hit (an exact procedure or activity-type match) needs no model call.
    var confident = deterministic.length && deterministic[0].score >= 60;
    if (!on() || confident || !requirements.length) {
      return Promise.resolve({ suggestions: deterministic, usedAi: false, rejected: [] });
    }
    var allowed = requirements.slice(0, 60).map(function (r) { return { id: r.id, label: r.label, kind: r.kind }; });
    var allowedIds = {};
    allowed.forEach(function (r) { allowedIds[r.id] = 1; });
    var prompt =
      "You are helping an Indian postgraduate medical resident tag a logbook entry with the training " +
      "requirement(s) it satisfies.\n\n" +
      "CHOOSE ONLY FROM THIS LIST. Never invent an id, a requirement, or a regulation.\n" +
      JSON.stringify(allowed) + "\n\n" +
      // The free-text fields are scrubbed on the way OUT. What is stored stays readable to the
      // resident and their guide; what leaves the device for a model does not carry a patient's name.
      "THE ENTRY:\n" + JSON.stringify({
        kind: entry.kind, setting: entry.setting,
        title: scrub(entry.title), topic: scrub(entry.topic),
        procedureText: scrub(entry.procedureText),
        academicType: entry.academicType, subtype: entry.subtype,
        role: entry.role, category: entry.category
      }) + "\n\n" +
      "Reply with JSON only: {\"ids\":[\"id1\",\"id2\"],\"why\":\"one short sentence\"}. " +
      "Return an EMPTY ids array if none clearly applies. Do not guess.";
    return ask(prompt, { maxTokens: 250 }).then(function (text) {
      var j = parseJson(text) || {};
      var rejected = [], picked = [];
      arr(j.ids).slice(0, 4).forEach(function (id) {
        if (!allowedIds[id]) { rejected.push(id); return; }   // the hard filter: not in the pack -> dropped
        if (deterministic.some(function (d) { return d.id === id; })) return;
        var r = requirements.filter(function (x) { return x.id === id; })[0];
        picked.push({ id: id, label: r.label, score: 30, why: String(j.why || "").slice(0, 160), source: "ai", advisory: true });
      });
      return { suggestions: deterministic.concat(picked), usedAi: true, rejected: rejected, label: LABEL };
    }, function () {
      // The model failing is not an error the resident should see; the deterministic answer stands.
      return { suggestions: deterministic, usedAi: false, rejected: [], aiUnavailable: true };
    });
  }

  /* ── 2. Progress summary (prose) ─────────────────────────────────────────────
   * The NUMBERS are computed by pglog-model and passed IN. The model is asked to write two
   * paragraphs about numbers it did not produce and cannot change. */
  function progressSummary(ctx) {
    if (!on()) return Promise.reject(new Error("ai_off"));
    var facts = {
      trainingYear: ctx.trainingYear, weeksLogged: ctx.weekly && ctx.weekly.logged,
      weeksTotal: ctx.weekly && ctx.weekly.weeks, weeklyPct: ctx.weekly && ctx.weekly.pct,
      verified: ctx.summary && ctx.summary.verified, total: ctx.summary && ctx.summary.total,
      awaitingVerification: ctx.summary && ctx.summary.submitted,
      byKind: ctx.summary && ctx.summary.byKind,
      gaps: arr(ctx.gaps).slice(0, 8).map(function (g) { return { label: g.label, done: g.done, expected: g.expected, target: g.target }; }),
      monthsOverdue: arr(ctx.months).filter(function (m) { return m.overdue; }).map(function (m) { return m.period; })
    };
    var prompt =
      "Write a short progress summary for an Indian PG medical resident's NMC logbook. Two short " +
      "paragraphs, plain professional English, no bullet points, no emoji, no praise.\n\n" +
      "USE ONLY THESE FACTS. Do not add a requirement, a number or a regulation that is not here. " +
      "Do not say the resident is compliant, eligible, or on track for the examination — that is not " +
      "yours to say.\n\n" + JSON.stringify(facts);
    return ask(prompt, { maxTokens: 400 }).then(function (t) { return { text: t, advisory: true, label: LABEL }; });
  }

  /* ── 3. Faculty review draft ─────────────────────────────────────────────────
   * Produces a DRAFT the faculty member edits and owns. It is never stored as the assessment until
   * the human saves it — the store has no AI caller. */
  function facultyReviewDraft(ctx) {
    if (!on()) return Promise.reject(new Error("ai_off"));
    var facts = {
      trainingYear: ctx.trainingYear,
      entries: ctx.summary, weekly: ctx.weekly,
      roleMix: ctx.roleMix, gaps: arr(ctx.gaps).slice(0, 6).map(function (g) { return g.label; }),
      recentActivity: arr(ctx.recent).slice(0, 12).map(function (e) {
        return { date: e.occurredAt, kind: e.kind, role: e.role, activity: scrub(e.title || e.topic || e.procedureText || "") };
      })
    };
    var prompt =
      "Draft formative-assessment feedback for an Indian PG medical resident, for a faculty member " +
      "to edit and sign. Three short sections: Strengths, Areas for development, Suggested actions. " +
      "Ground every statement in the facts below and say nothing they do not support. Do not assign " +
      "a score, do not judge examination eligibility, and do not invent clinical events.\n\n" +
      JSON.stringify(facts);
    return ask(prompt, { maxTokens: 550 }).then(function (t) {
      return { text: t, advisory: true, label: "Draft — you are the author. Edit before saving.", editable: true };
    });
  }

  /* ── 4. Gap narrative ────────────────────────────────────────────────────────
   * gaps() itself is PURE (pglog-model). This only turns the list into a sentence. */
  function gapNarrative(gaps) {
    if (!on() || !arr(gaps).length) return Promise.reject(new Error("ai_off"));
    var prompt =
      "Turn this list of training gaps into three short, practical sentences addressed to the " +
      "resident. No preamble, no encouragement, no invented requirements.\n\n" +
      JSON.stringify(arr(gaps).slice(0, 8).map(function (g) { return { requirement: g.label, done: g.done, expected: g.expected, target: g.target }; }));
    return ask(prompt, { maxTokens: 220 }).then(function (t) { return { text: t, advisory: true, label: LABEL }; });
  }

  /* ── 5. Incomplete-entry detection — PURE, no AI ─────────────────────────────
   * The brief lists "detect missing or incomplete logbook entries" as an AI feature. It is not one:
   * it is a validator plus a date arithmetic, both of which must be deterministic because they feed
   * a regulatory record. Implemented here as pure code so the AI flag being off changes nothing. */
  function incomplete(entries, ctx) {
    var m = M(); if (!m) return [];
    var out = [];
    arr(entries).forEach(function (e) {
      if (e.deleted || e.status === "verified") return;
      var v = m.validateEntry(e, ctx || {});
      if (!v.ok) out.push({ id: e.id, reason: "incomplete", errors: v.errors, occurredAt: e.occurredAt });
      else if (e.status === "draft") out.push({ id: e.id, reason: "never_submitted", occurredAt: e.occurredAt });
      else if (e.status === "returned") out.push({ id: e.id, reason: "returned", detail: e.returnReason, occurredAt: e.occurredAt });
    });
    return out.sort(function (a, b) { return String(a.occurredAt).localeCompare(String(b.occurredAt)); });
  }

  /* ── 6. Reminders — PURE, no AI ──────────────────────────────────────────────
   * Same reasoning: a reminder about a regulatory deadline must be right, not plausible. */
  function reminders(ctx) {
    var m = M(); if (!m) return [];
    var today = ctx.today || m.isoDate(Date.now());
    var out = [];
    arr(ctx.requirements).forEach(function (r) {
      if (!r.dueAt) return;
      var p = arr(ctx.requirementProgress).filter(function (x) { return x.requirementId === r.id; })[0];
      if (p && p.target != null && p.done >= p.target) return;
      var days = m.daysBetween(today, r.dueAt);
      if (days < 0) out.push({ kind: "overdue", label: r.label, dueAt: r.dueAt, days: -days, source: r.source, clause: r.clause, severity: "high" });
      else if (days <= 60) out.push({ kind: "due_soon", label: r.label, dueAt: r.dueAt, days: days, source: r.source, clause: r.clause, severity: days <= 14 ? "high" : "medium" });
    });
    arr(ctx.rotations).forEach(function (rot) {
      if (rot.status === "completed" || !rot.endDate) return;
      var days = m.daysBetween(today, rot.endDate);
      if (days >= 0 && days <= (ctx.rotationEndNoticeDays || 7)) {
        out.push({ kind: "rotation_ending", label: rot.name + " ends " + rot.endDate, dueAt: rot.endDate, days: days, severity: "medium" });
      }
    });
    arr(ctx.months).forEach(function (mo) {
      if (mo.overdue) out.push({ kind: "attestation_overdue", label: "Guide authentication missing for " + mo.period,
        dueAt: mo.period, severity: "high", source: "nmc_regulation", clause: "5.2(vi)" });
    });
    return out.sort(function (a, b) { return (a.severity === "high" ? 0 : 1) - (b.severity === "high" ? 0 : 1) || (a.days || 0) - (b.days || 0); });
  }

  var API = {
    isOn: on, LABEL: LABEL,
    suggest: suggest, progressSummary: progressSummary, facultyReviewDraft: facultyReviewDraft,
    gapNarrative: gapNarrative,
    // deliberately pure — see the comments above
    incomplete: incomplete, reminders: reminders,
    _ask: ask, _parseJson: parseJson
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_PGLOG_AI = API;
})();
