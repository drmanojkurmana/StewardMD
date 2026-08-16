/* StewardMD - onco-plan-flow.js. ONCQIS Phase D: the doctor FIND -> COMPARE -> SELECT ->
 * patient-specific Tata digital-protocol flow (window.SMD_ONCOFLOW). Buildless ES5 IIFE.
 *
 * DECISION SUPPORT ONLY. SELECT is ALWAYS an explicit physician click - the flow NEVER auto-selects
 * a protocol, and NEVER invents a dose (every proposed dose comes from SMD_ONCODOSE, with the full
 * lineage protocol dose -> patient input -> calculated -> rounding/cap -> proposed always visible).
 * It reuses the Phase B engine (SMD_ONCORECOMMEND.recommend), the Phase C evidence panels
 * (SMD_ONCOEV), the existing Tata matrix + dose drawer (SMD_ONCOUI), and the dose engine
 * (SMD_ONCODOSE). EDIT + CREATE TREATMENT PLAN do NOT persist here (Phase E/F): they build the
 * in-memory patient-specific object and emit a "smd-onco-flow" DOM event for the caller to act on.
 *
 * Gated behind BOTH flags smd_onco_protocols AND smd_onco_recommend (both default OFF).
 * window.SMD_ONCOFLOW + module.exports (the pure builders, for node --test). */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
  function flag(name) { try { return !!(G.SMD_QUEUE_FLAGS && G.SMD_QUEUE_FLAGS.bool && G.SMD_QUEUE_FLAGS.bool(name)); } catch (e) { return false; } }
  function flagOn() { return flag("smd_onco_protocols") && flag("smd_onco_recommend"); }
  function toast(m) { try { var f = G.toast || G.SMD_toast; if (f) f(m); } catch (e) {} }

  // PHASE E: dose edits are STRUCTURED, never free text. The reason is a fixed enum (+ an optional free-
  // text detail); the client mirror of the server's override-needs-reason rule (functions/_onco_store.js).
  var OVERRIDE_REASONS = ["protocol-defined", "organ-function", "toxicity", "previous-cycle-adjustment", "clinical-judgment", "other"];

  /* ---- pure derivation ---------------------------------------------------------------------- */
  // Phenotype keys mirror what SMD_ONCORECOMMEND.recommend() reads (diseaseId/stage/setting/intent/
  // line/biomarkers). Never invents: an absent field stays null (recommend surfaces it as unconfirmed).
  function derivePhenotype(ctx) {
    ctx = ctx || {};
    return {
      diseaseId: ctx.diseaseId || null, stage: ctx.stage || null,
      setting: ctx.treatmentSetting || null, intent: ctx.treatmentIntent || null,
      line: ctx.lineOfTherapy || null, biomarkers: ctx.biomarkers || null
    };
  }
  // Patient params for SMD_ONCODOSE. Pass-through only (no fabricated defaults).
  function deriveParams(ctx) {
    ctx = ctx || {};
    return { height: ctx.heightCm, weight: ctx.weightKg, age: ctx.age, sex: ctx.sex,
      creatinine: ctx.creatinine, bsa: ctx.bsa, gfr: ctx.gfr,
      carboplatinMaxDoseMg: ctx.carboplatinMaxDoseMg, creatinineFloor: ctx.creatinineFloor };
  }

  function recommend(pheno, protocols) {
    try { return (G.SMD_ONCORECOMMEND && G.SMD_ONCORECOMMEND.recommend) ? G.SMD_ONCORECOMMEND.recommend(pheno, protocols) : { applicable: [], reviewRequired: true }; }
    catch (e) { return { applicable: [], reviewRequired: true }; }
  }
  function evStatusOf(p) { try { return (G.SMD_ONCORECOMMEND && G.SMD_ONCORECOMMEND._evidenceStatusOf) ? G.SMD_ONCORECOMMEND._evidenceStatusOf(p && p.evidence) : "unknown"; } catch (e) { return "unknown"; } }

  /* ---- FIND: applicable-protocol list ------------------------------------------------------- */
  function chip(txt, cls) { return '<span class="of-chip ' + (cls || "") + '">' + esc(txt) + "</span>"; }
  function phenotypeStrip(p) {
    p = p || {}; var c = [];
    if (p.diseaseId) c.push(chip("disease " + p.diseaseId));
    if (p.stage) c.push(chip("stage " + p.stage));
    if (p.setting) c.push(chip(p.setting));
    if (p.intent) c.push(chip(p.intent));
    if (p.line) c.push(chip("line " + p.line));
    var bm = p.biomarkers || {};
    for (var k in bm) { if (Object.prototype.hasOwnProperty.call(bm, k)) c.push(chip(k + " " + bm[k])); }
    if (!c.length) return "";
    return '<section class="of-pheno"><div class="of-pheno-h">Derived phenotype <span class="of-tag">verify</span></div>' +
      '<div class="of-pheno-row">' + c.join("") + "</div>" +
      '<div class="of-note">Decision support only. StewardMD never auto-selects a protocol.</div></section>';
  }
  function evPanel(status, coreSrc) {
    try { return (G.SMD_ONCOEV && G.SMD_ONCOEV.build) ? G.SMD_ONCOEV.build([{ kind: "guideline", why: "Evidence status: " + (status || "unknown"), source: { name: coreSrc || "see protocol evidence" } }]) : ""; }
    catch (e) { return ""; }
  }
  function coreSource(p) { try { var c = (p && p.evidence && p.evidence.core || [])[0]; return c && c.source; } catch (e) { return null; } }

  function findEntryHtml(entry, protocol, compareOn) {
    entry = entry || {};
    var conf = Object.keys(entry.matched || {}).filter(function (k) { return entry.matched[k]; });
    var matchTxt = conf.length ? conf.join(", ") : "none fully confirmed";
    var needTxt = (entry.unconfirmed && entry.unconfirmed.length) ? entry.unconfirmed.join(", ") : "";
    return '<div class="of-entry" data-of-id="' + esc(entry.id) + '">' +
      '<div class="of-entry-h">' + esc(entry.name || entry.id) + (entry.protocolVersion ? ' <span class="of-ver">v' + esc(entry.protocolVersion) + "</span>" : "") + "</div>" +
      '<div class="of-entry-crit"><b>Matched criteria:</b> ' + esc(matchTxt) + "</div>" +
      (needTxt ? '<div class="of-entry-crit of-need"><b>Needs verification:</b> ' + esc(needTxt) + "</div>" : "") +
      '<div class="of-entry-why"><b>Why suggested:</b> ' + esc(entry.rationale || "") + "</div>" +
      '<div class="of-entry-ev">Evidence status: ' + esc(entry.evidenceStatus || "unknown") + "</div>" +
      evPanel(entry.evidenceStatus, coreSource(protocol)) +
      '<div class="of-entry-actions">' +
        '<button class="oe-btn ghost" data-of-act="details:' + esc(entry.id) + '">VIEW DETAILS</button>' +
        '<button class="oe-btn ghost' + (compareOn ? " on" : "") + '" data-of-act="cmp:' + esc(entry.id) + '">COMPARE' + (compareOn ? " (selected)" : "") + "</button>" +
        '<button class="oe-btn primary" data-of-act="select:' + esc(entry.id) + '">SELECT</button>' +
      "</div></div>";
  }

  function protoById(protocols, id) {
    for (var i = 0; i < (protocols || []).length; i++) { if (protocols[i] && protocols[i].id === id) return protocols[i]; }
    return null;
  }

  // renderFind(pheno, protocols, compareIds): the APPLICABLE STANDARD PROTOCOLS list. Honest empty
  // state when nothing applies (never a fabricated protocol). Header note when exactly one applies.
  function renderFind(pheno, protocols, compareIds) {
    compareIds = compareIds || [];
    var applicable = recommend(pheno, protocols).applicable || [];
    var head = '<div class="of-sec-h">APPLICABLE STANDARD PROTOCOLS</div>';
    if (applicable.length === 1) head += '<div class="of-note of-review">1 applicable protocol identified - review required</div>';
    var listHtml;
    if (!applicable.length) {
      listHtml = '<div class="of-empty">No applicable ACTIVE Standard Protocol - none published yet.</div>';
    } else {
      listHtml = applicable.map(function (e) {
        return findEntryHtml(e, protoById(protocols, e.id), compareIds.indexOf(e.id) >= 0);
      }).join("");
    }
    var cmpBar = compareIds.length >= 2 ? '<button class="oe-btn primary of-cmpbar" data-of-act="cmp-go">COMPARE ' + compareIds.length + " SELECTED</button>" : "";
    return phenotypeStrip(pheno) + head + cmpBar + listHtml;
  }

  /* ---- COMPARE: side-by-side ---------------------------------------------------------------- */
  function cmpRow(k, v) { return '<div class="of-cmp-row"><span class="of-cmp-k">' + esc(k) + '</span><span class="of-cmp-v">' + esc(v == null || v === "" ? "verify" : v) + "</span></div>"; }
  function cmpCol(p) {
    p = p || {}; var reg = p.regimen || {};
    var drugs = (reg.drugs || []).map(function (d) { return d && (d.name || d.id); }).filter(Boolean).join(", ");
    return '<div class="of-cmp-col"><div class="of-cmp-h">' + esc(p.name || p.id) + (p.protocolVersion ? " v" + esc(p.protocolVersion) : "") + "</div>" +
      cmpRow("Regimen", drugs) +
      cmpRow("Cycle length", reg.cycleLengthDays != null ? reg.cycleLengthDays + " days" : "") +
      cmpRow("Cycles", reg.cycles != null ? String(reg.cycles) : "") +
      cmpRow("Evidence status", evStatusOf(p)) +
      '<button class="oe-btn primary" data-of-act="select:' + esc(p.id) + '">SELECT</button></div>';
  }
  // compare(protocols): side-by-side of the passed protocols (regimen / cycle / evidence status).
  function renderCompare(protocols) {
    protocols = (protocols || []).filter(Boolean);
    if (!protocols.length) return '<div class="of-empty">Select two or more protocols to compare.</div>';
    return '<div class="of-sec-h">COMPARE PROTOCOLS</div><div class="of-cmp">' + protocols.map(cmpCol).join("") + "</div>";
  }

  /* ---- SELECT: build the patient-specific digital protocol (Tata matrix) -------------------- */
  function planDoses(regimen, params) {
    try { return (G.SMD_ONCODOSE && G.SMD_ONCODOSE.planDoses) ? G.SMD_ONCODOSE.planDoses(regimen, params) : []; }
    catch (e) { return []; }
  }
  function bsaOf(params) {
    try { var b = (G.SMD_ONCODOSE && G.SMD_ONCODOSE.bsaMosteller) ? G.SMD_ONCODOSE.bsaMosteller(params.height, params.weight) : null; return b == null ? null : Math.round(b * 100) / 100; }
    catch (e) { return null; }
  }
  function biomarkerText(bm) {
    if (!bm) return ""; var out = [];
    for (var k in bm) { if (Object.prototype.hasOwnProperty.call(bm, k)) out.push(k + " " + bm[k]); }
    return out.join(", ");
  }

  // buildDigitalProtocol(protocol, pheno, params, ctx): the in-memory PATIENT-SPECIFIC DIGITAL
  // PROTOCOL. NEVER persisted here. Doses come only from SMD_ONCODOSE (never invented).
  function buildDigitalProtocol(protocol, pheno, params, ctx) {
    protocol = protocol || {}; pheno = pheno || {}; params = params || {}; ctx = ctx || {};
    var reg = protocol.regimen || {};
    var lineages = planDoses(reg, params);
    var cycles = Number(reg.cycles); if (!(cycles > 0)) cycles = 0;
    var pat = ctx.patient || {};
    return {
      patientName: pat.name || "", mrn: pat.mrn || pat.patientId || ctx.mrn || "",
      diagnosis: ctx.diagnosis || protocol.disease || pheno.diseaseId || "",
      stage: pheno.stage || "", biomarkers: pheno.biomarkers || null,
      bsa: bsaOf(params), intent: pheno.intent || "",
      protocolId: protocol.id || "", protocolName: protocol.name || protocol.id || "",
      protocolVersion: protocol.protocolVersion || protocol.version || "",
      cycles: cycles, lineages: lineages,
      plan: { lockedTemplate: { drugs: reg.drugs || [] }, plannedCycles: cycles, calculatedDoses: lineages },
      protocol: protocol, phenotype: pheno, params: params
    };
  }

  function hrow(k, v) { return '<div class="of-hrow"><span class="of-hk">' + esc(k) + '</span><span class="of-hv">' + esc(v == null || v === "" ? "verify" : v) + "</span></div>"; }
  // One always-visible lineage line per drug: protocol dose -> input(s) -> calculated -> rounding/cap
  // -> proposed. "verify" (never a guessed number) whenever a step is not computable.
  function lineageRow(drug, lin) {
    drug = drug || {}; lin = lin || {};
    var unit = drug.unit ? " " + drug.unit : "";
    var chain = [];
    chain.push("protocol " + (lin.protocolDose != null ? lin.protocolDose + unit : "verify"));
    var inp = lin.inputs || {};
    if (inp.bsa != null) chain.push("BSA " + inp.bsa + " m2");
    if (inp.gfr != null) chain.push("GFR " + inp.gfr + " mL/min");
    if (inp.weight != null) chain.push("weight " + inp.weight + " kg");
    chain.push("calculated " + (lin.calculated != null ? lin.calculated + " mg" : "verify"));
    if (lin.rounded != null) chain.push("rounded " + lin.rounded + " mg");
    if (lin.capApplied) chain.push("cap applied");
    chain.push("proposed " + (lin.final != null ? lin.final + " mg" : "verify"));
    return '<div class="of-lin"><span class="of-lin-d">' + esc(drug.name || drug.id || "") + '</span><span class="of-lin-c">' + esc(chain.join(" -> ")) + "</span></div>";
  }
  function lineageBlock(d) {
    var drugs = (d.plan && d.plan.lockedTemplate && d.plan.lockedTemplate.drugs) || [];
    var byId = {}; (d.lineages || []).forEach(function (l) { if (l && l.drugId) byId[l.drugId] = l; });
    var rows = drugs.map(function (drug) { return lineageRow(drug, byId[drug.id]); }).join("");
    return '<section class="of-lineage"><div class="of-sec-h">Dose lineage (patient-specific)</div>' +
      '<div class="of-note">protocol dose -> patient input -> calculated -> rounding/cap -> proposed. Tap a matrix cell for the full calculation.</div>' +
      rows + "</section>";
  }

  function matrix(d) {
    try { return (G.SMD_ONCOUI && G.SMD_ONCOUI._buildOncoMatrix) ? G.SMD_ONCOUI._buildOncoMatrix(d.plan) : '<div class="of-empty">Matrix builder unavailable.</div>'; }
    catch (e) { return '<div class="of-empty">Matrix builder unavailable.</div>'; }
  }
  function actionBtn(act, label, primary) { return '<button class="oe-btn ' + (primary ? "primary" : "ghost") + '" data-of-act="' + act + '">' + label + "</button>"; }
  // Once CREATE has fired, the primary action becomes CONFIRM & ACTIVATE (never both at once, and
  // never auto-shown before an explicit CREATE click).
  function actionsRow(created) {
    return '<div class="of-actions">' +
      actionBtn("edit", "EDIT") + actionBtn("viewcalc", "VIEW CALCULATION") + actionBtn("viewev", "VIEW EVIDENCE") +
      actionBtn("compareguide", "COMPARE GUIDELINE") + actionBtn("print", "PRINT/PDF") +
      (created ? actionBtn("activate", "CONFIRM & ACTIVATE TREATMENT PLAN", true) : actionBtn("create", "CREATE TREATMENT PLAN", true)) +
      "</div>";
  }

  /* ---- PHASE E: structured dose edit + staged overrides -------------------------------------- */
  function reasonOptions(sel) {
    return ['<option value="">Reason for change (required)</option>'].concat(OVERRIDE_REASONS.map(function (r) {
      return '<option value="' + esc(r) + '"' + (sel === r ? " selected" : "") + ">" + esc(r) + "</option>";
    })).join("");
  }
  function editRow(drug, lin, ov) {
    drug = drug || {}; lin = lin || {};
    var orig = lin.final;
    var origTxt = orig == null ? "verify" : orig + " mg";
    var note = ov ? '<div class="of-note of-edit-note">Staged: original ' + esc(origTxt) + " &rarr; " + esc(ov.modifiedDose) + " mg &middot; " + esc(ov.reason) + (ov.reasonDetail ? " - " + esc(ov.reasonDetail) : "") + "</div>" : "";
    return '<div class="of-edit-row"><div class="of-edit-h"><b>' + esc(drug.name || drug.id || "") + "</b>" +
      '<span class="of-edit-orig">Calculated (original): ' + esc(origTxt) + "</span></div>" + note +
      '<div class="of-edit-ctrl">' +
        '<input class="oe-inp" type="number" step="any" data-of-inp="edit-dose:' + esc(drug.id) + '" placeholder="' + (orig != null ? esc(orig) : "mg") + '" value="' + (ov ? esc(ov.modifiedDose) : "") + '">' +
        '<select class="oe-inp" data-of-inp="edit-reason:' + esc(drug.id) + '">' + reasonOptions(ov && ov.reason) + "</select>" +
        '<input class="oe-inp" type="text" data-of-inp="edit-detail:' + esc(drug.id) + '" placeholder="Detail (optional)" value="' + (ov && ov.reasonDetail ? esc(ov.reasonDetail) : "") + '">' +
        '<button class="oe-btn ghost" data-of-act="ov-save:' + esc(drug.id) + '">Save edit</button>' +
      "</div></div>";
  }
  function editPanel(d) {
    var drugs = (d.plan && d.plan.lockedTemplate && d.plan.lockedTemplate.drugs) || [];
    var linById = {}; (d.lineages || []).forEach(function (l) { if (l && l.drugId) linById[l.drugId] = l; });
    var ovById = {}; (st.overrides || []).forEach(function (o) { if (o && o.drugId) ovById[o.drugId] = o; });
    var rows = drugs.map(function (drug) { return editRow(drug, linById[drug.id], ovById[drug.id]); }).join("");
    return '<section class="of-edit"><div class="of-sec-h">STRUCTURED DOSE EDIT</div>' +
      '<div class="of-note">The original calculated dose is preserved. Every change records the modified dose, a reason, the physician and a timestamp.</div>' +
      rows + "</section>";
  }
  // Apply staged overrides onto a DISPLAY-ONLY confirmedDoses[] (the matrix prefers it). d.lineages /
  // d.plan.calculatedDoses (the ORIGINAL calculated lineage) are never mutated - each confirmed entry is
  // a fresh clone, so the original dose is never destroyed (HARD RULE).
  function applyOverrides(d) {
    if (!d || !d.plan) return;
    if (!(st.overrides && st.overrides.length)) { d.plan.confirmedDoses = []; return; }
    var ovById = {}; st.overrides.forEach(function (o) { if (o && o.drugId) ovById[o.drugId] = o; });
    d.plan.confirmedDoses = (d.lineages || []).map(function (lin) {
      var o = lin && ovById[lin.drugId];
      return o ? Object.assign({}, lin, { modified: o.modifiedDose, modifiedReason: o.reason + (o.reasonDetail ? ": " + o.reasonDetail : ""), final: o.modifiedDose }) : lin;
    });
  }
  function inpVal(name) { try { var el = (G.document || document).querySelector('#smdOncoFlow [data-of-inp="' + name + '"]'); return el ? el.value : ""; } catch (e) { return ""; } }
  // Stage one structured edit: { drugId, field, originalCalculatedDose, modifiedDose, reason(enum),
  // reasonDetail?, physicianId, timestamp }. Rejects (toast, no stage) a non-numeric dose or a missing
  // reason - reason is a required enum, never free text.
  function stageEdit(drugId) {
    if (!st.digital) return;
    var lin = null; (st.digital.lineages || []).forEach(function (l) { if (l && l.drugId === drugId) lin = l; });
    var doseRaw = inpVal("edit-dose:" + drugId), reason = inpVal("edit-reason:" + drugId), detail = inpVal("edit-detail:" + drugId);
    var mod = Number(doseRaw);
    if (!(doseRaw !== "" && isFinite(mod))) { toast("Enter a valid modified dose."); return; }
    if (!reason) { toast("Select a reason for the change."); return; }
    var entry = { drugId: drugId, field: "dose:" + drugId, originalCalculatedDose: lin ? lin.final : null, modifiedDose: mod,
      reason: reason, reasonDetail: detail || "", physicianId: (st.ctx && (st.ctx.physicianId || st.ctx.doctorUid)) || "", timestamp: Date.now() };
    st.overrides = (st.overrides || []).filter(function (o) { return o && o.drugId !== drugId; }).concat([entry]);
    render();
  }
  // Structured client override -> server override shape ({drugId,was,now,reason,by}). The enum reason
  // (+ optional detail) collapses into the server's required non-empty `reason` string.
  function toServerOverride(o) {
    return { drugId: o.drugId, was: o.originalCalculatedDose, now: o.modifiedDose, reason: o.reason + (o.reasonDetail ? ": " + o.reasonDetail : ""), by: o.physicianId || "" };
  }
  // PHASE F: the exact body POST onco/plan (createPlan) persists. Multi-tenant: hospitalId /
  // hospitalImplementationVersion are null when no hospital overlay applies (never hard-coded).
  function createPayload(d) {
    d = d || {}; var ctx = st.ctx || {};
    return {
      protocolId: d.protocolId, sourceProtocolId: d.protocolId, sourceProtocolVersion: d.protocolVersion,
      hospitalId: ctx.hospitalId || null, orgId: ctx.orgId || ctx.hospitalId || null,
      hospitalImplementationVersion: ctx.hospitalImplementationVersion || null,
      ghisPatientId: d.mrn || "", doctorUid: ctx.doctorUid || "", intent: d.intent || "",
      patientParams: st.params || {}, patientParameters: st.params || {}, patientPhenotype: st.pheno || {},
      evidenceSnapshot: (d.protocol && d.protocol.evidence) || null, doseLineage: d.lineages || [],
      overrides: (st.overrides || []).map(toServerOverride)
    };
  }
  // POST onco/plan/confirm body. physicianConfirmed:true is set ONLY here, on the explicit CONFIRM &
  // ACTIVATE click - never inferred - so the server gate can never activate automatically.
  function confirmPayload() {
    return { planId: st.planId || "", overrides: (st.overrides || []).map(toServerOverride), physicianConfirmed: true };
  }
  function subPanel(d, sub) {
    if (!sub) return "";
    try {
      if (sub === "ev" && G.SMD_ONCOEV && G.SMD_ONCOEV.renderEvidenceLayers) return '<div class="of-sub">' + G.SMD_ONCOEV.renderEvidenceLayers(d.protocol) + "</div>";
      if (sub === "guide" && G.SMD_ONCOEV && G.SMD_ONCOEV.renderUpdateAvailable) return '<div class="of-sub">' + G.SMD_ONCOEV.renderUpdateAvailable(d.protocol, {}) + "</div>";
    } catch (e) {}
    return "";
  }

  // renderDigitalProtocol(d, sub): header + Tata matrix + always-visible lineage + actions. The matrix
  // reflects any staged edits (applyOverrides); the always-visible lineage keeps showing the ORIGINAL
  // calculated dose, so an edit never hides what was originally computed.
  function renderDigitalProtocol(d, sub) {
    d = d || {};
    applyOverrides(d);
    var header = '<section class="of-dp-head"><div class="of-sec-h">PATIENT-SPECIFIC DIGITAL PROTOCOL</div>' +
      hrow("Patient", d.patientName) + hrow("MRN", d.mrn) + hrow("Diagnosis", d.diagnosis) +
      hrow("Stage", d.stage) + hrow("Biomarkers", biomarkerText(d.biomarkers)) +
      hrow("BSA", d.bsa != null ? d.bsa + " m2 (computed)" : "") + hrow("Treatment intent", d.intent) +
      hrow("Standard Protocol", d.protocolName) + hrow("Protocol version", d.protocolVersion) +
      hrow("Number of cycles", d.cycles ? String(d.cycles) : "") + "</section>";
    return header + '<section class="of-dp-matrix">' + matrix(d) + "</section>" +
      lineageBlock(d) + actionsRow(st.created) + (sub === "edit" ? editPanel(d) : subPanel(d, sub));
  }

  /* ---- overlay driver (mirrors onco-home.js) ------------------------------------------------ */
  var st = { ctx: null, pheno: null, params: null, protocols: [], compareIds: [], digital: null, mode: "find", sub: null, drawer: null, detailsId: null, overrides: [], created: false, planId: "" };

  function rootEl() { var el = document.getElementById("smdOncoFlow"); if (!el) { el = document.createElement("div"); el.id = "smdOncoFlow"; el.className = "oh-overlay"; document.body.appendChild(el); } return el; }
  function backBar(act, label) { return '<button class="of-back" data-of-act="' + act + '">&lsaquo; ' + esc(label) + "</button>"; }

  function body() {
    if (st.mode === "select" && st.digital) {
      if (st.drawer) { try { return G.SMD_ONCOUI.doseDrawerView(st.drawer); } catch (e) { return '<div class="of-empty">Lineage unavailable.</div>'; } }
      return backBar("find", "Back to protocols") + renderDigitalProtocol(st.digital, st.sub);
    }
    if (st.mode === "compare") return backBar("find", "Back") + renderCompare(cmpProtocols());
    if (st.mode === "details" && st.detailsId) return backBar("find", "Back") + detailsHtml(st.detailsId);
    return renderFind(st.pheno, st.protocols, st.compareIds);
  }
  function detailsHtml(id) {
    var p = protoById(st.protocols, id);
    if (!p) return '<div class="of-empty">Protocol not found.</div>';
    var reg = p.regimen || {}, drugs = (reg.drugs || []).map(function (d) { return d.name || d.id; }).join(", ");
    var layers = ""; try { layers = (G.SMD_ONCOEV && G.SMD_ONCOEV.renderEvidenceLayers) ? G.SMD_ONCOEV.renderEvidenceLayers(p) : ""; } catch (e) {}
    return '<div class="of-sec-h">' + esc(p.name || p.id) + "</div>" +
      '<div class="of-entry-crit"><b>Regimen:</b> ' + esc(drugs) + "</div>" +
      '<div class="of-entry-crit"><b>Cycle:</b> ' + esc(reg.cycleLengthDays != null ? reg.cycleLengthDays + " days" : "verify") + ", " + esc(reg.cycles != null ? reg.cycles : "verify") + " cycles</div>" +
      layers +
      '<div class="of-entry-actions"><button class="oe-btn primary" data-of-act="select:' + esc(p.id) + '">SELECT</button></div>';
  }
  function cmpProtocols() { return st.compareIds.map(function (id) { return protoById(st.protocols, id); }).filter(Boolean); }

  function render() { var el = rootEl(); el.innerHTML =
    '<div class="oh-top"><button class="oh-back" data-of-act="close" aria-label="Close">&lsaquo; Close</button>' +
    '<div class="oh-title">ONCO PROTOCOL</div><span style="width:64px"></span></div>' +
    '<div class="oh-body">' + body() + "</div>"; }

  function findActive(id) { var p = protoById(st.protocols, id); return (p && p.status === "ACTIVE") ? p : null; }
  function toggleCompare(id) { var i = st.compareIds.indexOf(id); if (i >= 0) st.compareIds.splice(i, 1); else st.compareIds.push(id); }

  // The ONLY place a protocol becomes selected - reached solely from an explicit SELECT click (or a
  // direct API call). Never called during a render or on open. NEVER auto-selects.
  function select(protocol, params, ctx) {
    st.digital = buildDigitalProtocol(protocol, st.pheno || derivePhenotype(ctx || st.ctx), params || st.params, ctx || st.ctx);
    st.mode = "select"; st.sub = null; st.drawer = null; st.overrides = []; st.created = false; st.planId = ""; render();
    return st.digital;
  }
  function doSelect(id) { var p = findActive(id); if (!p) { toast("Protocol not available."); return; } select(p, st.params, st.ctx); }

  function openDrawer(cy, drugId) {
    if (!st.digital) return;
    var drugs = (st.digital.plan.lockedTemplate.drugs) || [], drug = null;
    for (var i = 0; i < drugs.length; i++) { if (drugs[i].id === drugId) { drug = drugs[i]; break; } }
    var lin = null, ls = st.digital.lineages || [];
    for (var j = 0; j < ls.length; j++) { if (ls[j].drugId === drugId) { lin = ls[j]; break; } }
    st.drawer = { cycleNo: cy, drugId: drugId, drug: drug || {}, lineage: lin };
    render();
  }
  // Emit the DOM event the caller (opd-emr) POSTs from. CREATE/ACTIVATE carry the exact server body so
  // the caller only forwards it via its authed oncoPost - the flow itself never fetches.
  function emit(action) {
    try {
      var detail = { action: action, digitalProtocol: st.digital };
      if (action === "create") detail.payload = createPayload(st.digital);
      if (action === "activate") detail.payload = confirmPayload();
      var e = new CustomEvent("smd-onco-flow", { detail: detail });
      (G.document || document).dispatchEvent(e);
    } catch (x) {}
  }

  function onClick(e) {
    var t = e.target;
    var cell = (t && t.closest) ? t.closest("[data-oe-act]") : null;
    if (cell) {
      var oe = cell.getAttribute("data-oe-act") || "";
      if (oe === "onco-drawer-close") { st.drawer = null; render(); return; }
      if (oe.indexOf("onco-cell:") === 0) { var pp = oe.split(":"); openDrawer(Number(pp[1]), pp[2]); return; }
    }
    var b = (t && t.closest) ? t.closest("[data-of-act]") : null;
    if (!b) return;
    var act = b.getAttribute("data-of-act") || "";
    var i = act.indexOf(":"), verb = i >= 0 ? act.slice(0, i) : act, arg = i >= 0 ? act.slice(i + 1) : "";
    if (verb === "close") { close(); return; }
    if (verb === "find") { st.mode = "find"; st.digital = null; st.drawer = null; st.sub = null; st.detailsId = null; render(); return; }
    if (verb === "details") { st.mode = "details"; st.detailsId = arg; render(); return; }
    if (verb === "cmp") { toggleCompare(arg); render(); return; }
    if (verb === "cmp-go") { st.mode = "compare"; render(); return; }
    if (verb === "select") { doSelect(arg); return; }
    if (verb === "viewcalc") { var d0 = (st.digital.plan.lockedTemplate.drugs || [])[0]; if (d0) openDrawer(1, d0.id); return; }
    if (verb === "viewev") { st.sub = st.sub === "ev" ? null : "ev"; render(); return; }
    if (verb === "compareguide") { st.sub = st.sub === "guide" ? null : "guide"; render(); return; }
    if (verb === "edit") { st.sub = st.sub === "edit" ? null : "edit"; render(); return; }         // PHASE E: structured edit panel
    if (verb === "ov-save") { stageEdit(arg); return; }                                            // stage one structured override
    if (verb === "print") { emit("print"); try { G.print && G.print(); } catch (x) {} return; }
    if (verb === "create") { st.created = true; st.sub = null; emit("create"); render(); return; } // PHASE F: emit createPlan payload, reveal CONFIRM & ACTIVATE
    if (verb === "activate") { emit("activate"); toast("Confirm & activate sent - the physician confirmation is required server-side."); return; }   // NEVER auto: explicit click only
  }

  // openFind(ctx, protocols): the entry point. Derives the phenotype, runs recommend(), renders the
  // applicable list. NOTHING is selected until the physician clicks SELECT. protocols is the ACTIVE
  // Standard Protocol list (recommend() re-filters to status ACTIVE defensively); when omitted, the
  // honest "none published yet" state is shown rather than a fabricated protocol.
  function openFind(ctx, protocols) {
    if (!flagOn()) { toast("Onco protocol flow is off"); return; }
    st.ctx = ctx || null;
    st.protocols = (protocols || (ctx && ctx.protocols) || []).filter(Boolean);
    st.pheno = derivePhenotype(ctx);
    st.params = deriveParams(ctx);
    st.compareIds = []; st.digital = null; st.mode = "find"; st.sub = null; st.drawer = null; st.detailsId = null; st.overrides = []; st.created = false; st.planId = "";
    var el = rootEl();
    el.removeEventListener("click", onClick); el.addEventListener("click", onClick);
    render();
    el.classList.add("on"); document.body.classList.add("oh-lock");
  }
  function close() { var el = document.getElementById("smdOncoFlow"); if (el) el.classList.remove("on"); try { document.body.classList.remove("oh-lock"); } catch (e) {} }

  try { document.addEventListener("keydown", function (e) { var el = document.getElementById("smdOncoFlow"); if (e.key === "Escape" && el && el.classList.contains("on")) close(); }); } catch (e) {}

  var API = {
    openFind: openFind, open: openFind, close: close, select: select, compare: renderCompare, isOn: flagOn,
    derivePhenotype: derivePhenotype, deriveParams: deriveParams,
    buildDigitalProtocol: buildDigitalProtocol,
    renderFind: renderFind, renderCompare: renderCompare, renderDigitalProtocol: renderDigitalProtocol,
    OVERRIDE_REASONS: OVERRIDE_REASONS, _st: st, _version: "1.1"
  };
  G.SMD_ONCOFLOW = API;
  if (typeof module !== "undefined" && module.exports) module.exports = {
    derivePhenotype: derivePhenotype, deriveParams: deriveParams, buildDigitalProtocol: buildDigitalProtocol,
    renderFind: renderFind, renderCompare: renderCompare, renderDigitalProtocol: renderDigitalProtocol
  };
})();
