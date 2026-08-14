/* StewardMD - ONCQIS Phase J-b: Knowledge Center REVIEW / APPROVAL side (J7-J14). PURE: no DOM, no
 * fetch, no I/O, deterministic. Logic + HTML string builders (same shape as onco-evidence.js). Fully
 * unit-testable in Node. window.SMD_ONCOREVIEW + module.exports.
 *
 * THE HARD SAFETY RULES (structural, spec, non-negotiable) encoded here:
 *  1. A Proposed Protocol Version is ALWAYS a NEW DRAFT (via lifecycle.newDraftVersion) and NEVER
 *     mutates the ACTIVE source. Every function that "changes" a version deep-clones first and returns
 *     a fresh object; the inputs are never written to (unit tests prove deepEqual before/after).
 *  2. Activation needs TWO human gates: R1 CLINICAL APPROVAL then INSTITUTIONAL APPROVAL. canActivate
 *     is false until BOTH are recorded and no VERIFY is unresolved. AI never activates (activate()
 *     refuses an actor whose role is "ai").
 *  3. An existing patient Treatment Plan keeps its exact snapshot version. A newly-ACTIVE version never
 *     touches a plan; planNeedsUpdate() only REPORTS an UPDATE AVAILABLE - the physician decides.
 *  4. The audit trail is append-only: appendAudit() returns a NEW array and never mutates the input;
 *     events are frozen so before/after cannot be edited after the fact.
 *
 * Depends on onco-protocol-lifecycle.js (SMD_ONCOLIFECYCLE) + onco-evidence.js (SMD_ONCOEV). */
(function (root) {
  "use strict";

  // ---- dependency + deep-clone plumbing (UMD; works in node --test, the browser AND a bundled
  // Cloudflare Worker). Deps come from the window globals (browser), a guarded require (node), or an
  // explicit injection via setDeps (server route ESM import, where require may not resolve). Every
  // require is wrapped so a bundler that cannot resolve the path never throws at module load. -------
  function _tryRequire(p) { try { return (typeof require === "function") ? require(p) : null; } catch (e) { return null; } }
  var LIFE = (root && root.SMD_ONCOLIFECYCLE) || _tryRequire("./onco-protocol-lifecycle.js");
  var EV = (root && root.SMD_ONCOEV) || _tryRequire("./onco-evidence.js");
  function setDeps(deps) { deps = deps || {}; if (deps.lifecycle) LIFE = deps.lifecycle; if (deps.evidence) EV = deps.evidence; }

  function deepClone(v) {
    if (typeof structuredClone === "function") return structuredClone(v);
    return JSON.parse(JSON.stringify(v));
  }
  function _s(v) { return String(v == null ? "" : v); }
  function esc(s) { return _s(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  var VERIFY = "VERIFY";

  // ================================================================================================
  // J14  AUDIT TRAIL - immutable, append-only event log for the whole chain
  //   source uploaded -> AI analysis -> changes detected -> draft created -> reviewer decisions ->
  //   clinical approval -> institutional approval -> activation.
  // ================================================================================================

  // One immutable event. Shape (spec J14): { action, user, timestamp, object, version, source,
  // before, after }. The event is frozen so a persisted decision can never be silently rewritten.
  function auditEvent(action, actor, detail) {
    detail = detail || {};
    var ev = {
      action: _s(action),
      user: _s((actor && actor.email) || (actor && actor.id) || actor || ""),
      role: _s(actor && actor.role) || "",
      timestamp: detail.at != null ? detail.at : (typeof Date !== "undefined" ? Date.now() : 0),
      object: detail.object != null ? _s(detail.object) : "",
      version: detail.version != null ? _s(detail.version) : "",
      source: detail.source != null ? _s(detail.source) : "",
      before: detail.before === undefined ? null : detail.before,
      after: detail.after === undefined ? null : detail.after
    };
    try { Object.freeze(ev); } catch (e) {}
    return ev;
  }

  // APPEND-ONLY: returns a NEW array = old log + event. The input log is never mutated.
  function appendAudit(log, event) {
    var base = Array.isArray(log) ? log.slice() : [];
    base.push(event);
    return base;
  }

  // ================================================================================================
  // J8  PROPOSED-VERSION GENERATION - a NEW DRAFT from an Update Impact Report + extraction.
  // ================================================================================================

  // The current (ACTIVE) value for a change, read from the ACTIVE protocol where derivable, else the
  // guideline-stated "from", else "not set". PURE read - never writes the protocol.
  function _currentValue(active, change) {
    active = active || {}; change = change || {};
    var drugs = (active.regimen && active.regimen.drugs) || active.drugs || [];
    if (change.drug) {
      for (var i = 0; i < drugs.length; i++) {
        var d = drugs[i] || {};
        if (_s(d.name).toLowerCase() === _s(change.drug).toLowerCase() || _s(d.id).toLowerCase() === _s(change.drug).toLowerCase()) {
          if (change.category === "dose_change" && d.dosePerUnit != null) return _s(d.dosePerUnit) + (d.unit ? " " + d.unit : "");
          if (change.category === "schedule_change" && d.days) return "days " + (d.days || []).join(",");
        }
      }
    }
    return change.from ? _s(change.from) : "not set";
  }

  // Turn one impact-report change into a Change Record. AI fills NOTHING it cannot source: an
  // unverified source or a missing target value becomes the literal VERIFY (blocks ACTIVE).
  function _changeRecord(active, change, idx) {
    change = change || {};
    var proposed = change.to && change.to !== VERIFY ? _s(change.to) : VERIFY;
    var srcLoc = change.sourceLocation ? _s(change.sourceLocation) : VERIFY;
    var isVerify = proposed === VERIFY || srcLoc === VERIFY;
    return {
      id: "chg_" + idx,
      type: _s(change.category),
      field: _s(change.category) + (change.drug ? " · " + _s(change.drug) : ""),
      drug: _s(change.drug),
      description: _s(change.description),
      old: _currentValue(active, change),
      proposed: proposed,
      sourceLocation: srcLoc,
      aiConfidence: change.aiConfidence != null ? change.aiConfidence : null,
      reviewState: "pending",   // pending -> accepted | rejected | edited | verify
      resolved: null,           // the value a human accepted/edited (null until decided)
      verify: isVerify          // an unsourced/blank change starts life BLOCKING until a human resolves it
    };
  }

  // Verify-field dotted paths for the current change set (schema: any unresolved VERIFY blocks ACTIVE).
  function _verifyFields(records) {
    return (records || []).filter(function (r) { return r.verify; }).map(function (r) { return "changeRecords." + r.id; });
  }

  // proposedVersion(active, report, extraction, opts): build a Proposed Protocol Version as a NEW DRAFT.
  //   - The DRAFT is lifecycle.newDraftVersion(active): a deep clone with a bumped protocolVersion and
  //     reset governance. The ACTIVE source is deep-UNCHANGED (proven by test).
  //   - Change Records are derived from the report's relevant changes for THIS protocol (falling back to
  //     the extraction's raw changes). Each carries { type, old, proposed, sourceLocation, aiConfidence }.
  //   - The draft's audit is seeded with the whole detected chain so far.
  function proposedVersion(active, report, extraction, opts) {
    if (!active || typeof active !== "object") throw new Error("active_protocol_required");
    if (!LIFE || typeof LIFE.newDraftVersion !== "function") throw new Error("lifecycle_unavailable");
    opts = opts || {};
    var draft = LIFE.newDraftVersion(active);   // deep clone, DRAFT, bumped version, governance reset

    // Which changes apply to this protocol? Prefer the impact report's per-protocol relevantChanges.
    var changes = [];
    if (report && Array.isArray(report.protocols)) {
      var match = report.protocols.filter(function (pr) { return pr && _s(pr.protocolId) === _s(active.id); })[0];
      if (match && Array.isArray(match.relevantChanges)) changes = match.relevantChanges;
    }
    if (!changes.length && extraction && Array.isArray(extraction.changes)) changes = extraction.changes;

    var records = changes.map(function (c, i) { return _changeRecord(active, c, i); });
    draft.changeRecords = records;
    draft.verifyFields = _verifyFields(records);
    draft.institutionalApprovalStatus = null;   // second gate, not yet given

    // Seed the audit chain (append-only from here). Optional upstream events (source upload, AI
    // analysis) are carried through when the caller supplies them.
    var actor = opts.actor || { id: "system" };
    var v = _s(draft.protocolVersion);
    var log = Array.isArray(opts.audit) ? opts.audit.slice() : [];
    if (report) log = appendAudit(log, auditEvent("changes_detected", actor, { object: active.id, version: _s(active.protocolVersion), source: (report.guideline && report.guideline.title) || "", after: records.length + " change(s)" }));
    log = appendAudit(log, auditEvent("draft_created", actor, { object: active.id, version: v, before: _s(active.protocolVersion), after: v }));
    draft.audit = log;
    draft.reviewMeta = {
      fromVersion: _s(active.protocolVersion),
      extractionId: (extraction && extraction.id) || (opts.extractionId != null ? _s(opts.extractionId) : null),
      guideline: (report && report.guideline) || (extraction ? { title: extraction.title, org: extraction.org, version: extraction.version } : null)
    };
    return draft;
  }

  // Author submits a DRAFT into R1_REVIEW (DRAFT -> R1_REVIEW). Fresh clone, audit appended.
  function submitForReview(draft, actor) {
    if (!draft || typeof draft !== "object") throw new Error("draft_required");
    if (!LIFE.validTransition(_s(draft.status), "R1_REVIEW")) throw new Error("invalid_transition:" + draft.status + "->R1_REVIEW");
    var next = deepClone(draft);
    next.status = "R1_REVIEW";
    next.audit = appendAudit(draft.audit, auditEvent("submitted_for_review", actor, { object: draft.id, version: draft.protocolVersion }));
    return next;
  }

  // ================================================================================================
  // J7 / J9  PER-CHANGE REVIEWER DECISIONS - accept / reject / edit / mark-verify.
  //   Every decision returns a FRESH draft and appends exactly one audit event. Never mutates input.
  // ================================================================================================
  var DECISIONS = ["accept", "reject", "edit", "verify"];

  function decideChange(draft, changeId, decision, actor, opts) {
    if (!draft || typeof draft !== "object") throw new Error("draft_required");
    if (DECISIONS.indexOf(decision) < 0) throw new Error("bad_decision:" + decision);
    opts = opts || {};
    var next = deepClone(draft);
    var recs = next.changeRecords || [];
    var rec = null;
    for (var i = 0; i < recs.length; i++) { if (recs[i].id === changeId) { rec = recs[i]; break; } }
    if (!rec) throw new Error("change_not_found:" + changeId);
    var before = { reviewState: rec.reviewState, resolved: rec.resolved, verify: rec.verify };

    if (decision === "accept") {
      // Adopt the AI-proposed value - but only if it is actually SOURCED. An unsourced proposal
      // (sourceLocation VERIFY or a blank target) cannot be accepted into an activatable draft; it
      // stays BLOCKING and a human must EDIT a real, sourced value in.
      rec.reviewState = "accepted";
      rec.resolved = rec.proposed;
      rec.verify = (rec.proposed === VERIFY || rec.sourceLocation === VERIFY);
    } else if (decision === "reject") {
      // Keep the current ACTIVE value - drop the proposal. No longer blocking.
      rec.reviewState = "rejected";
      rec.resolved = rec.old;
      rec.verify = false;
    } else if (decision === "edit") {
      // Human supplies the value. A blank edit leaves it BLOCKING (still VERIFY).
      var val = opts.value == null ? "" : _s(opts.value);
      rec.reviewState = "edited";
      rec.editedValue = val;
      rec.resolved = val || VERIFY;
      rec.verify = !val;
    } else if (decision === "verify") {
      // Explicitly flag for verification - blocks approval until resolved.
      rec.reviewState = "verify";
      rec.verify = true;
    }
    next.verifyFields = _verifyFields(recs);
    var ev = auditEvent("review_" + decision, actor, {
      object: draft.id, version: draft.protocolVersion, source: rec.sourceLocation,
      before: before, after: { reviewState: rec.reviewState, resolved: rec.resolved, verify: rec.verify }
    });
    next.audit = appendAudit(draft.audit, ev);
    return { draft: next, event: ev };
  }

  // Unresolved BLOCKING verifies (a change still flagged verify, or pending with an unsourced proposal).
  function unresolvedVerify(draft) {
    return ((draft && draft.changeRecords) || []).filter(function (r) {
      return r.verify || r.reviewState === "verify" || (r.reviewState === "pending" && r.proposed === VERIFY);
    });
  }

  // ================================================================================================
  // J9  CLINICAL REVIEW COMPLETE -> R1_REVIEW to INSTITUTIONAL_APPROVAL (gate 1: CLINICAL APPROVAL)
  // ================================================================================================
  function clinicalApprove(draft, actor) {
    if (!draft || typeof draft !== "object") throw new Error("draft_required");
    if (_s(draft.status) !== "R1_REVIEW") throw new Error("not_in_review:" + draft.status);
    var blockers = unresolvedVerify(draft);
    if (blockers.length) { var e = new Error("unresolved_verify"); e.blockers = blockers.map(function (b) { return b.id; }); throw e; }
    if (!LIFE.validTransition("R1_REVIEW", "INSTITUTIONAL_APPROVAL")) throw new Error("invalid_transition");
    var next = deepClone(draft);
    next.status = "INSTITUTIONAL_APPROVAL";
    next.clinicalApprovalStatus = "approved";
    next.clinicalApprovedBy = _s((actor && actor.email) || (actor && actor.id) || "");
    next.verifyFields = [];   // all resolved (guaranteed by the blocker check above)
    next.audit = appendAudit(draft.audit, auditEvent("clinical_approved", actor, { object: draft.id, version: draft.protocolVersion, after: "INSTITUTIONAL_APPROVAL" }));
    return next;
  }

  // ================================================================================================
  // J10  INSTITUTIONAL APPROVAL (gate 2). Version becomes eligible to activate. Status unchanged
  //      (stays INSTITUTIONAL_APPROVAL) - it is the ACTIVATE step that flips it to ACTIVE.
  // ================================================================================================
  function institutionalApprove(draft, actor) {
    if (!draft || typeof draft !== "object") throw new Error("draft_required");
    if (_s(draft.status) !== "INSTITUTIONAL_APPROVAL") throw new Error("not_awaiting_institutional:" + draft.status);
    if (draft.clinicalApprovalStatus !== "approved") throw new Error("clinical_approval_required_first");
    // Two DISTINCT humans: the clinical reviewer cannot also give institutional approval (separation of
    // duties - the two gates are never cleared by one person).
    var me = _s((actor && actor.email) || (actor && actor.id) || "");
    if (me && draft.clinicalApprovedBy && me.toLowerCase() === _s(draft.clinicalApprovedBy).toLowerCase()) throw new Error("same_actor_both_gates");
    var next = deepClone(draft);
    next.institutionalApprovalStatus = "approved";
    next.institutionalApprovedBy = _s((actor && actor.email) || (actor && actor.id) || "");
    next.audit = appendAudit(draft.audit, auditEvent("institutional_approved", actor, { object: draft.id, version: draft.protocolVersion, after: "eligible-to-activate" }));
    return next;
  }

  // BOTH gates + no VERIFY + correct status. This is the two-human-gate check.
  function canActivateVersion(draft) {
    if (!draft || typeof draft !== "object") return false;
    if (_s(draft.status) !== "INSTITUTIONAL_APPROVAL") return false;
    if (draft.institutionalApprovalStatus !== "approved") return false;
    return LIFE.canActivate(draft);   // clinicalApprovalStatus === approved AND no verifyFields
  }

  // ================================================================================================
  // J11  ACTIVATION - never automatic; needs BOTH approvals. vN -> SUPERSEDED, vN+1 -> ACTIVE.
  //      AI NEVER activates (an actor whose role is "ai" is refused).
  // ================================================================================================
  function activate(draft, currentActive, actor) {
    if (actor && _s(actor.role).toLowerCase() === "ai") throw new Error("ai_cannot_activate");
    if (!canActivateVersion(draft)) throw new Error("not_eligible_to_activate");   // both gates enforced
    if (!LIFE.validTransition("INSTITUTIONAL_APPROVAL", "ACTIVE")) throw new Error("invalid_transition");
    var activated = deepClone(draft);
    activated.status = "ACTIVE";
    var superseded = null;
    if (currentActive && typeof currentActive === "object") {
      if (!LIFE.validTransition(_s(currentActive.status), "SUPERSEDED")) throw new Error("cannot_supersede:" + currentActive.status);
      superseded = deepClone(currentActive);
      superseded.status = "SUPERSEDED";
      superseded.supersededBy = _s(activated.protocolVersion);
    }
    activated.audit = appendAudit(draft.audit, auditEvent("activated", actor, {
      object: draft.id, version: draft.protocolVersion,
      before: currentActive ? _s(currentActive.protocolVersion) : null, after: _s(activated.protocolVersion) + " ACTIVE"
    }));
    return { activated: activated, superseded: superseded };
  }

  // ================================================================================================
  // J12  EXISTING-PATIENT UPDATE AVAILABLE - a plan on vN never changes when vN+1 activates.
  // ================================================================================================
  function _planVersion(plan) { return _s((plan && (plan.lockedVersion || plan.sourceProtocolVersion || plan.protocolVersion)) || ""); }
  function _planProtocolId(plan) { return _s((plan && (plan.sourceProtocolId || plan.protocolId)) || ""); }

  // planNeedsUpdate(plan, newActive): true when the plan is on the SAME protocol but an OLDER version.
  // PURE read - the plan object is never touched (the physician decides, nothing is auto-applied).
  function planNeedsUpdate(plan, newActive) {
    if (!plan || !newActive) return false;
    if (_planProtocolId(plan) !== _s(newActive.id)) return false;
    var pv = _planVersion(plan), nv = _s(newActive.protocolVersion);
    return !!(pv && nv && pv !== nv);
  }

  // renderPlanUpdateAvailable(plan, newActive): reuse onco-evidence.renderUpdateAvailable. Returns "" if
  // the plan is already current. NEVER modifies the plan; only offers the physician a decision.
  function renderPlanUpdateAvailable(plan, newActive) {
    if (!planNeedsUpdate(plan, newActive)) return "";
    if (!EV || typeof EV.renderUpdateAvailable !== "function") return "";
    var snap = plan.lockedTemplate || plan.snapshot || { name: _planProtocolId(plan), protocolVersion: _planVersion(plan), regimen: (plan.lockedTemplate && plan.lockedTemplate.regimen) || {} };
    var ge = { name: newActive.name, regimen: newActive.regimen || {}, version: newActive.protocolVersion, source: "StewardMD Standard Protocol " + _s(newActive.protocolVersion) };
    return EV.renderUpdateAvailable(snap, ge);
  }

  // ================================================================================================
  // J13  REVIEW-DUE DASHBOARD - by lastReviewedAt / nextReviewAt / reviewDue. REVIEW DUE != invalid.
  // ================================================================================================
  function reviewRows(protocols, now) {
    now = now || (typeof Date !== "undefined" ? Date.now() : 0);
    return (protocols || []).map(function (p) {
      p = p || {};
      var r = p.review || {};
      var next = r.nextReviewAt || null;
      var dueByDate = !!(next && Date.parse(next) && Date.parse(next) <= now);
      var due = r.reviewDue === true || dueByDate;
      return {
        id: _s(p.id), name: _s(p.name || p.id), status: _s(p.status || p.lifecycleState),
        lastReviewedAt: r.lastReviewedAt || null, nextReviewAt: next, reviewInterval: r.reviewInterval || null,
        reviewDue: due
      };
    }).sort(function (a, b) { return (b.reviewDue ? 1 : 0) - (a.reviewDue ? 1 : 0); });
  }

  // ================================================================================================
  // HTML BUILDERS (pure strings; classes shared with admin/oncology.html + the CDP harness)
  // ================================================================================================

  // J7 diff UI: COMPARE vN ACTIVE vs vN+1 DRAFT. Per-change rows Field | Current | Proposed | Evidence,
  // with the four actions [ACCEPT] [REJECT] [EDIT] [MARK VERIFY].
  var ACTIONS = [{ k: "accept", l: "ACCEPT" }, { k: "reject", l: "REJECT" }, { k: "edit", l: "EDIT" }, { k: "verify", l: "MARK VERIFY" }];
  function _evidenceCell(rec, gl) {
    var parts = [];
    if (gl && gl.title) parts.push(gl.title);
    if (gl && gl.version) parts.push("v" + gl.version);
    parts.push("loc: " + (rec.sourceLocation || VERIFY));
    return esc(parts.join(" · "));
  }
  function renderDiff(active, draft) {
    active = active || {}; draft = draft || {};
    var recs = draft.changeRecords || [];
    var gl = (draft.reviewMeta && draft.reviewMeta.guideline) || null;
    var head = "<tr><th>Field</th><th>Current (v" + esc(active.protocolVersion) + " ACTIVE)</th><th>Proposed (v" +
      esc(draft.protocolVersion) + " DRAFT)</th><th>Evidence</th><th>Decision</th><th>Actions</th></tr>";
    var body = recs.map(function (r) {
      var acts = ACTIONS.map(function (a) {
        return '<button class="orv-act" data-onco-rev-act="' + a.k + '" data-change-id="' + esc(r.id) + '">' + a.l + "</button>";
      }).join("");
      var verifyCls = r.verify ? " orv-verify" : "";
      var state = r.reviewState + (r.resolved != null ? " → " + esc(r.resolved) : "");
      return '<tr class="orv-row' + verifyCls + '" data-onco-rev="change" data-change-id="' + esc(r.id) +
        '"><td>' + esc(r.field) + "</td><td>" + esc(r.old) + '</td><td class="orv-proposed">' + esc(r.proposed) +
        "</td><td>" + _evidenceCell(r, gl) + '</td><td class="orv-state">' + esc(state) + "</td><td>" + acts + "</td></tr>";
    }).join("");
    return '<section class="orv-diff" data-onco-rev-diff="' + esc(draft.id) + '">' +
      '<div class="orv-diff-h">COMPARE v' + esc(active.protocolVersion) + " ACTIVE &rarr; v" + esc(draft.protocolVersion) + " DRAFT</div>" +
      '<table class="orv-table" data-onco-rev="diff"><thead>' + head + "</thead><tbody>" +
      (body || '<tr><td colspan="6">No changes proposed</td></tr>') + "</tbody></table>" +
      '<div class="orv-note">Nothing here mutates the ACTIVE protocol. This is a DRAFT; every decision is audited. Clinical approval then institutional approval are required to activate.</div>' +
      "</section>";
  }

  // J14 audit trail render.
  function renderAudit(log) {
    var head = "<tr><th>Time</th><th>User</th><th>Action</th><th>Object / version</th><th>Source</th><th>Before &rarr; After</th></tr>";
    var body = (log || []).map(function (e) {
      e = e || {};
      var ba = _s(_fmt(e.before)) + " → " + _s(_fmt(e.after));
      return "<tr><td>" + esc(_fmtTs(e.timestamp)) + "</td><td>" + esc(e.user || "-") + '</td><td><span class="orv-badge">' + esc(e.action) +
        "</span></td><td>" + esc((e.object || "-") + (e.version ? " v" + e.version : "")) + "</td><td>" + esc(e.source || "-") +
        "</td><td>" + esc(ba) + "</td></tr>";
    }).join("");
    return '<table class="orv-table" data-onco-rev="audit"><thead>' + head + "</thead><tbody>" +
      (body || '<tr><td colspan="6">No events</td></tr>') + "</tbody></table>";
  }
  function _fmt(v) { if (v == null) return "-"; if (typeof v === "object") { try { return JSON.stringify(v); } catch (e) { return "[obj]"; } } return _s(v); }
  function _fmtTs(ts) { if (!ts) return "-"; try { return new Date(ts).toISOString().replace("T", " ").slice(0, 19); } catch (e) { return "-"; } }

  // J13 review-due render.
  function renderReviewDue(protocols, now) {
    var rows = reviewRows(protocols, now);
    var head = "<tr><th>Protocol</th><th>Status</th><th>Last reviewed</th><th>Next review</th><th>Review state</th></tr>";
    var body = rows.map(function (r) {
      var flag = r.reviewDue ? '<span class="orv-flag orv-flag-due">REVIEW DUE</span>' : '<span class="orv-flag">current</span>';
      return '<tr data-onco-rev-review="' + esc(r.id) + '"><td>' + esc(r.name) + '</td><td><span class="orv-badge">' + esc(r.status || "-") +
        "</span></td><td>" + esc(r.lastReviewedAt || "-") + "</td><td>" + esc(r.nextReviewAt || "-") + "</td><td>" + flag + "</td></tr>";
    }).join("");
    return '<table class="orv-table" data-onco-rev="review-due"><thead>' + head + "</thead><tbody>" +
      (body || '<tr><td colspan="5">No protocols</td></tr>') + "</tbody></table>" +
      '<div class="orv-note">REVIEW DUE flags a protocol for re-review against current evidence. It does NOT make the protocol invalid; it stays ACTIVE and usable until a new version is activated.</div>';
  }

  var API = {
    // J14
    auditEvent: auditEvent, appendAudit: appendAudit,
    // J8
    proposedVersion: proposedVersion, submitForReview: submitForReview,
    // J7/J9
    DECISIONS: DECISIONS, decideChange: decideChange, unresolvedVerify: unresolvedVerify,
    // J9/J10/J11 gates
    clinicalApprove: clinicalApprove, institutionalApprove: institutionalApprove,
    canActivateVersion: canActivateVersion, activate: activate,
    // J12
    planNeedsUpdate: planNeedsUpdate, renderPlanUpdateAvailable: renderPlanUpdateAvailable,
    // J13
    reviewRows: reviewRows,
    // render
    renderDiff: renderDiff, renderAudit: renderAudit, renderReviewDue: renderReviewDue,
    _version: "1.0"
  };
  if (root) root.SMD_ONCOREVIEW = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : null));
