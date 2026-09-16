/* wardsynq/site/pages/registers.js - "Registers": the hospital's statutory registers (functions/_wardsynq/registers.js,
 * controlled-drugs.js, notifiable.js, register-routes.js, register-settings.js). Buildless ES5, registers onto WSQ.
 *
 * Each tab is shown to the people whose role keeps that register; the server refuses everyone else whatever this page
 * shows. A register that failed to load says so and is never drawn as empty. The field labels of a statutory form come
 * from the server in English, as the form is filed (they are legal text, like an English printout); the page around
 * them is translated. Nothing here sends anything to an authority: exports are files for a person to submit.
 *
 * Legal review of 2026-09-17: each register keeps its companion records behind the same tab (a "Register" picker):
 * the Form F printout and monthly report, MTP Forms D and E and Form II, the dying declaration, NDPS Forms 3E, 3J and
 * 3-I. A due date is always said in words beside its colour. Settings (staff.admin) holds the hospital-editable
 * choices where the law is unsettled, each with its note.
 *
 * Legal requirements (owner's legal guidance 2026-09-17, functions/_wardsynq/legal-requirements.js): a read-only list of
 * the requirements for the hospital's State/UT, with source, status, dates, evidence and what is not configured. The same
 * renderer (WSQ._legal) draws Admin > Legal requirements, where staff.admin records the State/UT and edits only the values
 * the registry leaves to the hospital, with a reason.
 */
(function () {
  "use strict";
  var WSQ = window.WSQ;
  function T(c, key, en, vars) { return c && c.t ? c.t(key, vars, en) : String(en).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? String(vars[k]) : m; }); }
  function TS(c, key, en, vars) { return c && c.tSafe ? c.tSafe(key, vars, en) : String(T(c, key, en, vars)).replace(/[&<>"']/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]; }); }
  function EN(c, html) { return c && c.en ? c.en(html) : html; }
  function val(id) { var e = document.getElementById(id); return e ? String(e.value || "").trim() : ""; }
  function checked(id) { var e = document.getElementById(id); return !!(e && e.checked); }

  var S = { tab: "", period: "", vitalKind: "birth", week: "", schemas: null, notes: null, data: null, entry: null, form: null, msg: null, extra: null,
    sub: { formf: "formf", mtp: "mtp", mlc: "mlc", ndps: "book" }, year: "", ndpsPatient: "", settings: null, saving: false, legal: null };

  function tabs(c) {
    return [
      { key: "ndps", need: ["register.ndps", "register.ndps.read", "med.administer"], title: T(c, "site.registers.tab.ndps", "Controlled drugs (NDPS)") },
      { key: "formf", need: ["register.pcpndt", "register.pcpndt.read"], title: T(c, "site.registers.tab.formf", "PCPNDT Form F") },
      { key: "mlc", need: ["register.records", "mlc.record"], title: T(c, "site.registers.tab.mlc", "Medico-legal cases") },
      { key: "mtp", need: ["register.mtp"], title: T(c, "site.registers.tab.mtp", "MTP") },
      { key: "vital", need: ["register.records", "emr.treat"], title: T(c, "site.registers.tab.vital", "Births and deaths") },
      { key: "ihip", need: ["register.ihip", "emr.treat"], title: T(c, "site.registers.tab.ihip", "Notifiable diseases") },
      { key: "legal", need: ["staff.admin", "register.ndps", "register.ndps.read", "register.pcpndt", "register.pcpndt.read", "register.records", "mlc.record", "register.mtp", "register.ihip"], title: T(c, "site.legal.tab", "Legal requirements") },
      { key: "settings", need: ["staff.admin"], title: T(c, "site.registers.tab.settings", "Register settings") },
    ].filter(function (t) { return t.need.some(function (n) { return c.can(n); }); });
  }
  /* The records each tab keeps, the register itself first. */
  function subKinds(c) {
    var ndpsAll = [["book", T(c, "site.registers.sub.book", "Register book (Form 3H)")], ["form3eview", T(c, "site.registers.sub.form3eview", "A patient's Form 3E")], ["form3e", T(c, "site.registers.sub.form3e", "Form 3E registrations")],
      ["annual", T(c, "site.registers.sub.annual", "Annual estimate and return (Form 3J, Form 3-I)")], ["form3j", T(c, "site.registers.sub.form3j", "Form 3J estimates recorded")], ["form3i", T(c, "site.registers.sub.form3i", "Form 3-I returns prepared")], ["statreturn", T(c, "site.registers.sub.ndpsReturns", "Returns filed")],
      ["form3hclose", T(c, "site.registers.sub.form3hclose", "Days closed (Form 3H pages)")], ["quarantine", T(c, "site.registers.sub.quarantine", "Quarantine")], ["homecare", T(c, "site.registers.sub.homecare", "Home care (rule 52W)")],
      ["h1", T(c, "site.registers.sub.h1", "Schedule H1 register")], ["schedx", T(c, "site.registers.sub.schedx", "Schedule X register")], ["schedxsupply", T(c, "site.registers.sub.schedxsupply", "Schedule X supply particulars")],
      ["patient", T(c, "site.registers.sub.ndpsPatient", "One patient's controlled drugs (read only)")]];
    return {
      formf: [["formf", T(c, "site.registers.sub.formf", "Form F entries")], ["formfprint", T(c, "site.registers.sub.formfprint", "Authenticated printouts (rule 9(7))")], ["statreturn", T(c, "site.registers.sub.formfReturns", "Monthly reports filed (rule 9(8))")]],
      mtp: [["mtp", T(c, "site.registers.sub.mtp", "Admission Register (Form III)")], ["mtpboard", T(c, "site.registers.sub.mtpboard", "Medical Board opinions (Form D)")], ["mtpforme", T(c, "site.registers.sub.mtpforme", "Two practitioners' opinions (Form E)")], ["statreturn", T(c, "site.registers.sub.mtpReturns", "Form II statements filed")]],
      mlc: [["mlc", T(c, "site.registers.sub.mlc", "Medico-legal cases")], ["dyingdecl", T(c, "site.registers.sub.dyingdecl", "Dying declarations")], ["pocsotask", T(c, "site.registers.sub.pocsotask", "POCSO intimation tasks")]],
      /* A nurse without the NDPS register reads one patient's rows only (legal review F.4.10). */
      ndps: c.can("register.ndps") || c.can("register.ndps.read") ? ndpsAll : ndpsAll.filter(function (o) { return o[0] === "patient"; }),
    };
  }
  /* Read-only doors (legal review B.4.9, F.4.10): the PCPNDT nodal officer files only the monthly report; the NDPS inspector
   * and the nurse write nothing. The server refuses the rest whatever this shows. */
  function readOnly(c) { return S.tab === "formf" ? !c.can("register.pcpndt") : S.tab === "ndps" ? !c.can("register.ndps") : false; }
  var NDPS_VIEWS = ["book", "form3eview", "annual", "h1", "schedx", "patient"];
  /* Sent to the server and recorded as written (the stock ledger's reason), never shown translated. */
  var DESTRUCTION_REASON = "Expired stock destroyed (NDPS Rules r.52V(1))";
  var RETURNS = { formf: ["formf-monthly"], mtp: ["mtp-form2"], ndps: ["ndps-3j", "ndps-3i"] };
  var DOOR = { formf: "/ward/register-formf", mtp: "/ward/register-mtp", mlc: "/ward/register-mlc", ndps: "/ward/register-ndps", ihip: "/ward/register-notification" };
  function thisMonth() { return new Date().toISOString().slice(0, 7); }
  function lastMonday() { var d = new Date(); var day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day - 7); return d.toISOString().slice(0, 10); }
  function monthRange(p) { var y = Number(p.slice(0, 4)), m = Number(p.slice(5, 7)); var to = m === 12 ? (y + 1) + "-01-01" : y + "-" + (m < 9 ? "0" : "") + (m + 1) + "-01"; return { from: p + "-01", to: to }; }
  function refusal(c, r) {
    if (!r) return T(c, "site.registers.noResponse", "No response from the server.");
    var extra = (r.problems && r.problems.length ? " " + r.problems.join("; ") : "");
    return (r.message || r.detail || r.error || T(c, "site.registers.failed", "failed")) + extra;
  }
  function failedBox(c) { return '<div class="msg err">' + TS(c, "site.registers.loadFailed", "This register could not be loaded. Do not read it as empty.") + "</div>"; }
  function loading(c) { return '<p><span class="spin"></span> ' + c.esc(T(c, "site.registers.loading", "Loading...")) + "</p>"; }

  /* ---------------------------------------------------------------------------------------------- clocks, in words */
  function clockText(c, k) {
    if (!k) return "";
    var d = k.dueBy ? String(k.dueBy).slice(0, 16).replace("T", " ") : "";
    switch (k.state) {
      case "open": return T(c, "site.registers.clock.open", "open, due by {d}", { d: d });
      case "due": return T(c, "site.registers.clock.due", "due by {d}", { d: d });
      case "due-soon": return T(c, "site.registers.clock.dueSoon", "due soon, by {d}", { d: d });
      case "escalate": return T(c, "site.registers.clock.escalate", "due by {d}: tell the imaging in-charge today", { d: d });
      case "alert": return T(c, "site.registers.clock.alert", "due by {d}, {n} days gone", { d: d, n: k.days });
      case "overdue": return T(c, "site.registers.clock.overdue", "OVERDUE: was due by {d}", { d: d });
      case "late-permission": return T(c, "site.registers.clock.latePermission", "LATE: after 30 days the District Registrar's permission and a fee are needed (RBD Act s.13)");
      case "submitted": return T(c, "site.registers.clock.submitted", "submitted on {s}", { s: k.submittedOn });
      case "submitted-late": return T(c, "site.registers.clock.submittedLate", "submitted late, on {s}", { s: k.submittedOn });
      case "pending": return T(c, "site.registers.clock.pending", "pending");
      default: return T(c, "site.registers.clock.noDate", "no date recorded");
    }
  }
  function clockClass(k) { return !k ? "note" : (k.state === "overdue" || k.state === "late-permission") ? "err" : /^submitted/.test(k.state) ? "ok" : "note"; }
  function mlcClockName(c, kind) {
    return { "police-intimation": T(c, "site.registers.mlc.clock.police", "Police intimation"), "pocso-report": T(c, "site.registers.mlc.clock.pocso", "Report on the child's condition to the SJPU or police"),
      "io-report": T(c, "site.registers.mlc.clock.io", "Examination report to the investigating officer"), "inquest-papers": T(c, "site.registers.mlc.clock.inquest", "Inquest papers") }[kind] || kind;
  }
  function alertText(c, a) {
    switch (a.kind) {
      case "formb-not-recorded": return T(c, "site.registers.alert.formbMissing", "The Form B registration certificate and its expiry are not recorded (Settings).");
      case "formb-expired": return T(c, "site.registers.alert.formbExpired", "The Form B registration expired on {d}.", { d: a.validUntil });
      case "formb-renewal-due": return T(c, "site.registers.alert.formbRenew", "Form B expires on {d}: apply for renewal in Form A by {r} (rule 8(1)).", { d: a.validUntil, r: a.renewBy });
      case "r13-change-intimation": return T(c, "site.registers.alert.r13", "Planned change ({w}) on {d}: intimate the Appropriate Authority by {r} (rule 13).", { w: a.what, d: a.effectiveOn, r: a.dueBy });
      case "r17-notice": return T(c, "site.registers.alert.r17Notice", "Not recorded: the rule 17(1) notice that disclosure of foetal sex is prohibited, in English and the local language.");
      case "r17-copies": return T(c, "site.registers.alert.r17Copies", "Not recorded: copies of the Act and Rules kept on the premises (rule 17(2)).");
      case "rmi-not-recorded": return T(c, "site.registers.alert.rmiMissing", "The NDPS recognition (Form 3G) and its expiry are not recorded (Settings).");
      case "rmi-expired": return T(c, "site.registers.alert.rmiExpired", "The NDPS recognition expired on {d}. Receipts and dispensing of controlled drugs are refused until a renewal application is recorded.", { d: a.expiresOn });
      case "rmi-renewal-due": return T(c, "site.registers.alert.rmiRenew", "The NDPS recognition expires on {d}: apply for renewal by {r} (rule 52-O).", { d: a.expiresOn, r: a.renewBy });
      case "rmi-doctor-intimation": return T(c, "site.registers.alert.rmiDoctor", "A designated doctor changed on {d}: tell the Controller of Drugs by {r} (rule 52Q).", { d: a.changedOn, r: a.dueBy });
      case "rmi-constitution-intimation": return T(c, "site.registers.alert.rmiConstitution", "The institution's constitution changed on {d}: tell the Controller of Drugs by {r} (rule 52R(2)).", { d: a.changedOn, r: a.dueBy });
      case "rmi-no-overall-in-charge": return T(c, "site.registers.alert.rmiInCharge", "No designated doctor is marked as the over-all in-charge (rule 52Q).");
      default: return a.kind;
    }
  }
  function alertsHtml(c, list) {
    return (list || []).map(function (a) { return '<div class="msg ' + (/expired|overdue/.test(a.kind) || a.overdue ? "err" : "note") + '">' + c.esc(alertText(c, a)) + "</div>"; }).join("");
  }

  /* ---------------------------------------------------------------------------------------------- values */
  var NAME_PARTS = ["first", "middle", "last"], ADDRESS_PARTS = ["houseNo", "locality", "ward", "townVillage", "subDistrict", "district", "state", "pin"];
  function partLabel(c, p) {
    return { first: T(c, "site.registers.part.first", "First name"), middle: T(c, "site.registers.part.middle", "Middle name"), last: T(c, "site.registers.part.last", "Last name"),
      houseNo: T(c, "site.registers.part.houseNo", "House No."), locality: T(c, "site.registers.part.locality", "Locality"), ward: T(c, "site.registers.part.ward", "Ward number (if available)"),
      townVillage: T(c, "site.registers.part.townVillage", "Town or Village"), subDistrict: T(c, "site.registers.part.subDistrict", "Sub-district"), district: T(c, "site.registers.part.district", "District"),
      state: T(c, "site.registers.part.state", "State or Union Territory"), pin: T(c, "site.registers.part.pin", "PIN Code") }[p] || p;
  }
  function show(c, fd, v) {
    if (v == null || v === "") return "";
    if (fd && fd.type === "attest") return EN(c, c.esc(v.name)) + ' <span class="quiet">(' + c.esc(T(c, "site.registers.attested", "attested {at}", { at: String(v.at || "").slice(0, 16).replace("T", " ") })) + ")</span>";
    if (fd && (fd.type === "enum" || fd.type === "multi")) {
      var list = Object.prototype.toString.call(v) === "[object Array]" ? v : [v];
      return EN(c, c.esc(list.map(function (x) { var o = (fd.options || []).filter(function (p) { return p[0] === x; })[0]; return o ? o[1] : x; }).join("; ")));
    }
    if (fd && fd.type === "list") return EN(c, c.esc((v || []).map(function (row) { return fd.row.map(function (s) { return row[s.key]; }).filter(Boolean).join(", "); }).join(" | ")));
    if (fd && (fd.type === "name" || fd.type === "address") && typeof v === "object") return EN(c, c.esc((fd.type === "name" ? NAME_PARTS : (fd.parts || ADDRESS_PARTS)).map(function (p) { return v[p]; }).filter(Boolean).join(fd.type === "name" ? " " : ", ")));
    return EN(c, c.esc(String(v)));
  }
  function fieldOf(schema, key) { return (schema.fields || []).filter(function (f) { return f.key === key; })[0] || null; }

  /* ---------------------------------------------------------------------------------------------- the form */
  function inputHtml(c, fd, v, form) {
    var id = "rgF_" + fd.key, esc = c.esc;
    if (fd.server) return "";
    if (v === undefined && !form.id && fd["default"] !== undefined) v = fd["default"];
    if (fd.type === "longtext") return '<textarea id="' + id + '" rows="3">' + esc(v || "") + "</textarea>";
    if (fd.type === "name" || fd.type === "address") {
      var parts = fd.type === "name" ? NAME_PARTS : (fd.parts || ADDRESS_PARTS), obj = v && typeof v === "object" ? v : {};
      return '<div class="row">' + parts.map(function (p) { return '<label class="f"><span>' + esc(partLabel(c, p)) + '</span><input id="' + id + "_" + p + '" value="' + esc(obj[p] || "") + '"' + (p === "pin" ? ' inputmode="numeric" maxlength="6"' : "") + "></label>"; }).join("") + "</div>";
    }
    if (fd.type === "enum") {
      var opts = fd.options.filter(function (o) { return !form.allowReturns || fd.key !== "returnKind" || form.allowReturns.indexOf(o[0]) >= 0; });
      return '<select id="' + id + '"><option value=""></option>' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === v ? " selected" : "") + ">" + EN(c, esc(o[1])) + "</option>"; }).join("") + "</select>";
    }
    if (fd.type === "multi") return '<div id="' + id + '">' + fd.options.map(function (o) { return '<label class="f" style="flex-direction:row;align-items:center"><input type="checkbox" data-multi="' + esc(fd.key) + '" value="' + esc(o[0]) + '"' + (v && v.indexOf(o[0]) >= 0 ? " checked" : "") + ' style="width:auto;margin:0 8px 0 0"><span>' + EN(c, esc(o[1])) + "</span></label>"; }).join("") + "</div>";
    if (fd.type === "list") {
      var rows = (v || []).concat([{}, {}, {}]).slice(0, Math.max(3, (v || []).length + 1));
      return rows.map(function (row, i) {
        return '<div class="row">' + fd.row.map(function (s) {
          var sid = "rgL_" + fd.key + "_" + i + "_" + s.key;
          if (s.type === "enum") return '<label class="f"><span>' + EN(c, esc(s.label)) + '</span><select id="' + sid + '"><option value=""></option>' + s.options.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (row[s.key] === o[0] ? " selected" : "") + ">" + EN(c, esc(o[1])) + "</option>"; }).join("") + "</select></label>";
          return '<label class="f"><span>' + EN(c, esc(s.label)) + '</span><input id="' + sid + '" value="' + esc(row[s.key] || "") + '"></label>';
        }).join("") + "</div>";
      }).join("") + '<input type="hidden" id="' + id + '" value="' + rows.length + '">';
    }
    var type = fd.type === "date" ? "date" : fd.type === "time" ? "time" : fd.type === "datetime" ? "datetime-local" : (fd.type === "int" || fd.type === "number") ? "number" : "text";
    var shown = fd.type === "attest" ? (v && v.name) || "" : fd.type === "datetime" && v ? String(v).slice(0, 16) : (v == null ? "" : v);
    return '<input id="' + id + '" type="' + type + '"' + (fd.type === "number" ? ' step="any"' : "") + ' value="' + esc(shown) + '">';
  }
  function formHtml(c, schema, form) {
    var esc = c.esc, v = form.fields || {};
    var head = form.id
      ? '<div class="msg note">' + TS(c, "site.registers.correcting", "Correcting version {v}. A correction is a new version and keeps the old one; say why.", { v: form.expectedVersion }) + '</div><label class="f"><span>' + esc(T(c, "site.registers.reason", "Reason for the correction")) + '</span><input id="rgReason"></label>'
      : (schema.patient === "required" || schema.patient === "mother" || schema.patient === "deceased" ? '<div class="row"><label class="f"><span>' + esc(T(c, "site.registers.mrn", "Patient hospital number (MRN)")) + '</span><input id="rgMrn" value="' + esc(form.mrn || "") + '"' + (form.patientId ? " disabled" : "") + "></label>" +
        (form.patientId ? '<span class="quiet">' + esc(T(c, "site.registers.patientFromRecord", "Patient taken from the record.")) + "</span>" : "") +
        (schema.kind === "formf" ? '<label class="f"><span>' + esc(T(c, "site.registers.srId", "Imaging request id (links this Form F to the ultrasound order)")) + '</span><input id="rgSr" value="' + esc(form.serviceRequestId || "") + '"></label>' : "") +
        ((schema.kind === "mlc" || schema.kind === "mtp") ? '<label class="f"><span>' + esc(T(c, "site.registers.encId", "Stay (encounter) id, if admitted or in the ED")) + '</span><input id="rgEnc"></label>' : "") + "</div>" : "");
    var defs = schema.definitions ? '<div id="rgDefs" class="quiet"></div>' : "";
    var fields = (schema.fields || []).filter(function (f) { return !f.server; }).map(function (fd) {
      return '<label class="f"><span>' + EN(c, esc(fd.label)) + (fd.req ? " *" : "") + "</span>" + inputHtml(c, fd, v[fd.key], form) + (fd.hint ? '<span class="quiet">' + EN(c, esc(fd.hint)) + "</span>" : "") + "</label>";
    }).join("");
    return '<div class="card"><h3>' + EN(c, esc(schema.title)) + "</h3>" + (form.note ? '<div class="msg note">' + EN(c, esc(form.note)) + "</div>" : "") +
      (schema.statutoryForm ? "" : '<div class="msg note">' + TS(c, "site.registers.notStatutory", "These fields are the hospital's own record, not a statutory form.") + "</div>") +
      (schema.immutable ? '<div class="msg note">' + TS(c, "site.registers.immutable", "This record cannot be changed after it is saved. A later statement is a new entry that names this one.") + "</div>" : "") +
      (schema.notes || []).map(function (n) { return '<div class="msg note">' + EN(c, esc(n)) + "</div>"; }).join("") +
      '<p class="quiet">' + EN(c, esc(schema.citation)) + "</p>" + head + defs + fields +
      '<p class="quiet">' + esc(T(c, "site.registers.requiredNote", "Fields marked * are needed for the entry to be complete. An incomplete entry is saved and listed as incomplete.")) + "</p>" +
      '<button class="btn" type="button" data-rg="save"' + (S.saving ? " disabled" : "") + ">" + esc(T(c, "site.registers.save", "Save to the register")) + '</button> <button class="btn quiet" type="button" data-rg="cancel">' + esc(T(c, "site.registers.cancel", "Cancel")) + "</button></div>";
  }
  function readForm(schema) {
    var out = {};
    (schema.fields || []).forEach(function (fd) {
      if (fd.server) return;
      if (fd.type === "multi") {
        var boxes = document.querySelectorAll('[data-multi="' + fd.key + '"]'), picked = [];
        for (var i = 0; i < boxes.length; i++) if (boxes[i].checked) picked.push(boxes[i].value);
        if (picked.length) out[fd.key] = picked;
        return;
      }
      if (fd.type === "name" || fd.type === "address") {
        var obj = {}, any = false;
        (fd.type === "name" ? NAME_PARTS : (fd.parts || ADDRESS_PARTS)).forEach(function (p) { var x = val("rgF_" + fd.key + "_" + p); if (x) { obj[p] = x; any = true; } });
        if (any) out[fd.key] = obj;
        return;
      }
      if (fd.type === "list") {
        var n = Number(val("rgF_" + fd.key)) || 0, rows = [];
        for (var r = 0; r < n; r++) { var row = {}, some = false; fd.row.forEach(function (s) { var y = val("rgL_" + fd.key + "_" + r + "_" + s.key); if (y) { row[s.key] = y; some = true; } }); if (some) rows.push(row); }
        if (rows.length) out[fd.key] = rows;
        return;
      }
      var x = val("rgF_" + fd.key);
      if (x === "") return;
      if (fd.type === "int" || fd.type === "number") out[fd.key] = Number(x);
      else if (fd.type === "datetime") out[fd.key] = new Date(x).toISOString();
      else out[fd.key] = x;
    });
    return out;
  }

  /* ---------------------------------------------------------------------------------------------- lists */
  function dueCell(c, e) {
    if (e.clock) return '<span class="msg ' + clockClass(e.clock) + '">' + c.esc(clockText(c, e.clock)) + "</span>";
    if (e.clocks) return e.clocks.map(function (k) { return '<div class="msg ' + clockClass(k) + '">' + c.esc(mlcClockName(c, k.kind) + ": " + clockText(c, k)) + "</div>"; }).join("");
    if (e.flags) return (e.flags.formICertifiedLate ? '<div class="msg err">' + c.esc(T(c, "site.registers.mtp.formILate", "Form I certified more than three hours after termination (regulation 3)")) + "</div>" : "") +
      (e.flags.pocsoPending ? '<div class="msg err">' + c.esc(T(c, "site.registers.mtp.pocsoPending", "A minor: the POCSO intimation is not recorded")) + "</div>" : "");
    return "";
  }
  function entriesTable(c, schema, r) {
    var esc = c.esc;
    if (r == null) return loading(c);
    if (!r.ok) return failedBox(c) + '<div class="msg err">' + EN(c, esc(refusal(c, r))) + "</div>";
    var warn = r.truncated ? '<div class="msg note">' + EN(c, esc(r.truncatedWarning)) + "</div>" : "";
    if (!r.entries.length) return warn + "<p>" + esc(T(c, "site.registers.noEntries", "No entries in this register for this period.")) + "</p>";
    var cols = (schema.listColumns || []).map(function (k) { return fieldOf(schema, k); }).filter(Boolean);
    var hasDue = r.entries.some(function (e) { return e.clock || e.clocks || e.flags; });
    var hasRetention = r.entries.some(function (e) { return e.retentionEnd; });
    return warn + (r.retentionNote ? '<p class="quiet">' + esc(T(c, "site.registers.mtp.retentionNote", "Nothing is deleted. After the retention date the custodian may destroy an entry only by hand, with a destruction record.")) + "</p>" : "") +
      '<div class="tbl"><table><tr><th>' + esc(T(c, "site.registers.colNumber", "Number")) + "</th>" + cols.map(function (fd) { return "<th>" + EN(c, esc(fd.label)) + "</th>"; }).join("") +
      "<th>" + esc(T(c, "site.registers.colComplete", "Complete")) + "</th>" + (hasDue ? "<th>" + esc(T(c, "site.registers.colDue", "Due")) + "</th>" : "") + (hasRetention ? "<th>" + esc(T(c, "site.registers.colRetention", "Kept until at least")) + "</th>" : "") + "<th>" + esc(T(c, "site.registers.colVersion", "Version")) + "</th><th></th></tr>" +
      r.entries.map(function (e) {
        /* A sexual offence or POCSO case this reader may not open (BNS s.72, POCSO Act s.23): its number only. */
        if (e.restricted) return '<tr><td>' + EN(c, esc(e.serial || e.id)) + '</td><td colspan="' + (cols.length + 3 + (hasDue ? 1 : 0) + (hasRetention ? 1 : 0)) + '">' + esc(T(c, "site.registers.mlc.restricted", "Restricted case: it opens only to its treating team, the register's keepers and the people the hospital names (BNS s.72, POCSO Act s.23).")) + "</td></tr>";
        return "<tr" + (e.complete ? "" : ' class="warn"') + "><td>" + EN(c, esc(e.serial || e.id)) + "</td>" + cols.map(function (fd) { return "<td>" + show(c, fd, e.fields[fd.key]) + "</td>"; }).join("") +
          "<td>" + esc(e.complete ? T(c, "site.registers.yes", "yes") : T(c, "site.registers.incomplete", "incomplete")) + "</td>" + (hasDue ? "<td>" + dueCell(c, e) + "</td>" : "") + (hasRetention ? "<td>" + esc(e.retentionEnd || "") + "</td>" : "") + "<td>" + esc(e.version) + (e.correction ? " " + esc(T(c, "site.registers.corrected", "corrected")) : "") +
          '</td><td><button class="btn quiet" type="button" data-rg="open" data-id="' + esc(e.id) + '">' + esc(T(c, "site.registers.open", "Open")) + "</button></td></tr>";
      }).join("") + "</table></div>";
  }
  function entryHtml(c, schema, r) {
    var esc = c.esc;
    if (r == null) return loading(c);
    if (!r.ok) return '<div class="msg err">' + EN(c, esc(refusal(c, r))) + "</div>";
    var e = r.entry;
    var body = (schema.fields || []).map(function (fd) { var s = show(c, fd, e.fields[fd.key]); return s ? "<dt>" + EN(c, esc(fd.label)) + "</dt><dd>" + s + "</dd>" : ""; }).join("");
    var hist = r.versions.map(function (v) {
      return "<li>" + esc(T(c, "site.registers.versionLine", "Version {v}, {at}, by {by}", { v: v.version, at: String(v.writtenBy && v.writtenBy.at || "").slice(0, 16).replace("T", " "), by: v.writtenBy && v.writtenBy.id || "" })) +
        (v.correction ? ": " + EN(c, esc(v.correction.reason)) : "") + "</li>";
    }).join("");
    var extra = "";
    if (schema.kind === "formf" && e.complete) extra += ' <button class="btn quiet" type="button" data-rg="print-formf">' + esc(T(c, "site.registers.formf.print", "Authenticated printout (rule 9(7))")) + "</button>";
    if (schema.kind === "mlc" && e.fields.goodSamaritan === "yes") extra += ' <button class="btn quiet" type="button" data-rg="gs-letter">' + esc(T(c, "site.registers.mlc.gsLetter", "Good Samaritan acknowledgement (CMVR r.168)")) + "</button>";
    var writable = !schema.immutable && (!readOnly(c) || schema.kind === "statreturn");
    return '<div class="card"><h3>' + EN(c, esc(e.serial || e.id)) + "</h3>" + (e.complete ? "" : '<div class="msg note">' + esc(T(c, "site.registers.missing", "Incomplete. Missing: {list}", { list: (e.missing || []).join(", ") })) + "</div>") +
      (r.retentionEnd ? '<div class="msg note">' + esc(T(c, "site.registers.mtp.retentionEnd", "Kept until at least {d}. Nothing is deleted: after that date the custodian may destroy it only by hand, with a destruction record.", { d: r.retentionEnd })) + "</div>" : "") +
      '<dl class="kv">' + body + "</dl><h4>" + esc(T(c, "site.registers.history", "History")) + "</h4><ul>" + hist + "</ul>" +
      (!writable ? "" : '<button class="btn" type="button" data-rg="correct">' + esc(T(c, "site.registers.correct", "Correct this entry")) + "</button>") + extra + ' <button class="btn quiet" type="button" data-rg="close">' + esc(T(c, "site.registers.close", "Close")) + "</button></div>";
  }

  function printTable(title, head, rows) {
    var e = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]; }); };
    var w = window.open("", "_blank");
    if (!w) return false;
    w.document.write("<!doctype html><title>" + e(title) + "</title><style>body{font:12px sans-serif}table{border-collapse:collapse;width:100%}td,th{border:1px solid #444;padding:3px;vertical-align:top}</style><h2>" + e(title) + "</h2><table><tr>" +
      head.map(function (h) { return "<th>" + e(h) + "</th>"; }).join("") + "</tr>" + rows.map(function (r) { return "<tr>" + r.map(function (x) { return "<td>" + e(x) + "</td>"; }).join("") + "</tr>"; }).join("") + "</table>");
    w.document.close(); w.focus(); w.print();
    return true;
  }
  function saveCsv(name, csv) {
    var url = URL.createObjectURL(new Blob([csv], { type: "text/csv" })), a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.parentNode.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  }
  function csvToRows(csv) {
    return String(csv || "").split(/\r\n/).filter(Boolean).map(function (line) {
      var out = [], cur = "", q = false;
      for (var i = 0; i < line.length; i++) { var ch = line[i]; if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; } else if (ch === '"') q = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch; }
      out.push(cur); return out;
    });
  }
  function textOf(fd, v) {
    if (v == null || v === "") return "";
    if (fd.type === "attest") return v.name + " (" + String(v.at || "").slice(0, 16).replace("T", " ") + ")";
    if (fd.type === "enum" || fd.type === "multi") return [].concat(v).map(function (x) { var o = (fd.options || []).filter(function (p) { return p[0] === x; })[0]; return o ? o[1] : x; }).join("; ");
    if (fd.type === "name" || fd.type === "address") return (fd.type === "name" ? NAME_PARTS : (fd.parts || ADDRESS_PARTS)).map(function (p) { return v[p]; }).filter(Boolean).join(fd.type === "name" ? " " : ", ");
    if (fd.type === "list") return v.map(function (row) { return fd.row.map(function (s) { return row[s.key]; }).filter(Boolean).join(", "); }).join(" | ");
    return String(v);
  }

  /* ---------------------------------------------------------------------------------------------- which register */
  function kindNow() {
    if (S.tab === "vital") return S.vitalKind;
    if (S.tab === "ihip") return "notification";
    return S.sub[S.tab] || S.tab;
  }
  function postDoor(kind) { return S.tab === "vital" ? (kind === "mccd" ? "/ward/register-mccd" : "/ward/register-vital") : DOOR[S.tab]; }
  function canList(c) {
    if (S.tab === "mlc" || S.tab === "vital") return c.can("register.records");
    if (S.tab === "ihip") return c.can("register.ihip");
    return true;
  }
  function listPath(q, kind) {
    if (S.tab === "vital") return "/ward/register-vital" + q + "&kind=" + kind + "&period=" + S.period;
    if (S.tab === "ihip") return "/ward/register-notification" + q + "&from=" + S.week + "&to=" + new Date(Date.parse(S.week + "T00:00:00Z") + 7 * 86400000).toISOString().slice(0, 10);
    if (S.tab === "ndps") return "/ward/register-ndps" + q + "&view=list&kind=" + kind + "&period=" + S.period;
    return DOOR[S.tab] + q + "&kind=" + kind + "&period=" + S.period;
  }

  /* ---------------------------------------------------------------------------------------------- NDPS */
  function ndpsHtml(c) {
    var esc = c.esc, r = S.data;
    var countForm = '<div class="card"><h3>' + esc(T(c, "site.registers.ndps.countTitle", "Record a shift count")) + '</h3><div class="row">' +
      ["code", "unit", "location", "counted", "shift", "witness", "note"].map(function (k) {
        var label = { code: T(c, "site.registers.ndps.code", "Drug (code or name as in the stock register)"), unit: T(c, "site.registers.ndps.unit", "Unit"), location: T(c, "site.registers.ndps.location", "Location (blank for the main store)"),
          counted: T(c, "site.registers.ndps.counted", "Quantity counted"), shift: T(c, "site.registers.ndps.shift", "Shift"), witness: T(c, "site.registers.ndps.witness", "Witness staff ID (second person)"), note: T(c, "site.registers.ndps.note", "Note") }[k];
        return '<label class="f"><span>' + esc(label) + '</span><input id="rgC_' + k + '"' + (k === "counted" ? ' type="number" min="0" step="any"' : "") + "></label>";
      }).join("") + '<button class="btn" type="button" data-rg="count">' + esc(T(c, "site.registers.ndps.saveCount", "Save count")) + "</button></div>" +
      '<p class="quiet">' + esc(T(c, "site.registers.ndps.countNote", "The server works out what the register holds. A count never changes stock: a difference is flagged for the pharmacist to investigate.")) + "</p></div>";
    var destroyForm = '<div class="card"><h3>' + esc(T(c, "site.registers.ndps.destroyTitle", "Destruction of expired stock (rule 52V(1))")) + '</h3><p class="quiet">' +
      esc(T(c, "site.registers.ndps.destroyNote", "Expired stock is destroyed in the presence of an officer nominated by the Controller of Drugs. Without the officer and the nominating order nothing is recorded.")) + '</p><div class="row">' +
      [["code", T(c, "site.registers.ndps.code", "Drug (code or name as in the stock register)")], ["unit", T(c, "site.registers.ndps.unit", "Unit")], ["location", T(c, "site.registers.ndps.location", "Location (blank for the main store)")],
        ["quantity", T(c, "site.registers.ndps.destroyQty", "Quantity destroyed")], ["batch", T(c, "site.registers.ndps.batch", "Batch")], ["nomineeName", T(c, "site.registers.ndps.nomineeName", "Nominated officer: name")],
        ["nomineeDesignation", T(c, "site.registers.ndps.nomineeDesignation", "Nominated officer: designation")], ["nominatingOrderRef", T(c, "site.registers.ndps.nominatingOrder", "Nominating order reference")],
        ["destroyedOn", T(c, "site.registers.ndps.destroyedOn", "Date destroyed")], ["witness", T(c, "site.registers.ndps.witness", "Witness staff ID (second person)")]].map(function (p) {
        return '<label class="f"><span>' + esc(p[1]) + '</span><input id="rgD_' + p[0] + '"' + (p[0] === "destroyedOn" ? ' type="date"' : p[0] === "quantity" ? ' type="number" min="0" step="any"' : "") + "></label>";
      }).join("") + '<button class="btn" type="button" data-rg="destroy">' + esc(T(c, "site.registers.ndps.destroySave", "Record the destruction")) + "</button></div></div>";
    var field = function (prefix, p) { return '<label class="f"><span>' + esc(p[1]) + '</span><input id="' + prefix + p[0] + '"' + (p[2] ? ' type="' + p[2] + '"' + (p[2] === "number" ? ' min="0" step="any"' : "") : "") + "></label>"; };
    /* A controlled receipt with the Schedule X supplier particulars (r.65(21)(b)) and, above the Form 3J estimate, the
     * revised estimate's reference (r.52U); a transfer, loan or sale to another institution with the Controller's approval
     * (r.52V(3)). Both go to the stock ledger, which refuses what the rules refuse. */
    var receiveForm = '<div class="card"><h3>' + esc(T(c, "site.registers.ndps.receiveTitle", "Receive a controlled drug")) + '</h3><p class="quiet">' +
      esc(T(c, "site.registers.ndps.receiveNote", "A receipt that would take the stock held above this year's Form 3J estimate is refused unless the revised estimate filed with the Controller of Drugs is named (rule 52U).")) + '</p><div class="row">' +
      [["code", T(c, "site.registers.ndps.code", "Drug (code or name as in the stock register)")], ["unit", T(c, "site.registers.ndps.unit", "Unit")], ["quantity", T(c, "site.registers.ndps.receiveQty", "Quantity received"), "number"],
        ["location", T(c, "site.registers.ndps.location", "Location (blank for the main store)")], ["batch", T(c, "site.registers.ndps.batch", "Batch")], ["expiry", T(c, "site.registers.ndps.expiry", "Expiry"), "date"],
        ["receivedFrom", T(c, "site.registers.ndps.receivedFrom", "Received from (supplier)")], ["documentNo", T(c, "site.registers.ndps.documentNo", "Consignment note, bill or invoice number")],
        ["supplierAddress", T(c, "site.registers.ndps.supplierAddress", "Supplier's address (Schedule X)")], ["supplierLicenceNo", T(c, "site.registers.ndps.supplierLicence", "Supplier's licence number (Schedule X)")],
        ["manufacturer", T(c, "site.registers.ndps.manufacturer", "Manufacturer")], ["revisedEstimateRef", T(c, "site.registers.ndps.revisedRef", "Revised Form 3J estimate reference (only above the estimate)")]].map(function (p) { return field("rgR_", p); }).join("") +
      '<button class="btn" type="button" data-rg="receive">' + esc(T(c, "site.registers.ndps.receiveSave", "Record the receipt")) + "</button></div></div>";
    var transferForm = '<div class="card"><h3>' + esc(T(c, "site.registers.ndps.transferTitle", "Transfer, loan or sale to another institution (rule 52V(3))")) + '</h3><p class="quiet">' +
      esc(T(c, "site.registers.ndps.transferNote", "Only with the prior approval of the Controller of Drugs. Without the approval reference nothing is recorded.")) + '</p><div class="row">' +
      [["code", T(c, "site.registers.ndps.code", "Drug (code or name as in the stock register)")], ["unit", T(c, "site.registers.ndps.unit", "Unit")], ["quantity", T(c, "site.registers.ndps.transferQty", "Quantity sent"), "number"],
        ["location", T(c, "site.registers.ndps.location", "Location (blank for the main store)")], ["batch", T(c, "site.registers.ndps.batch", "Batch")], ["toInstitution", T(c, "site.registers.ndps.toInstitution", "Institution sent to")],
        ["controllerApprovalRef", T(c, "site.registers.ndps.approvalRef", "Controller of Drugs approval reference")]].map(function (p) { return field("rgT_", p); }).join("") +
      '<label class="f"><span>' + esc(T(c, "site.registers.ndps.transferKind", "Kind")) + '</span><select id="rgT_transferKind"><option value="transfer">' + esc(T(c, "site.registers.ndps.kindTransfer", "Transfer")) + '</option><option value="loan">' + esc(T(c, "site.registers.ndps.kindLoan", "Loan")) + '</option><option value="sale">' + esc(T(c, "site.registers.ndps.kindSale", "Sale")) + "</option></select></label>" +
      '<button class="btn" type="button" data-rg="transfer">' + esc(T(c, "site.registers.ndps.transferSave", "Record the transfer")) + "</button></div></div>";
    if (readOnly(c)) { countForm = ""; destroyForm = ""; receiveForm = ""; transferForm = ""; }
    if (r == null) return loading(c) + countForm;
    if (!r.ok) return failedBox(c) + '<div class="msg err">' + EN(c, esc(refusal(c, r))) + "</div>" + countForm;
    var rmi = r.rmi ? alertsHtml(c, r.rmi.alerts) : "";
    if (!r.configured) return rmi + '<div class="msg note">' + EN(c, esc(r.message)) + "</div>";
    var head = rmi + '<div class="msg note">' + EN(c, esc(r.policy)) + "</div>" + (r.requireWitness === false ? '<div class="msg note">' + esc(T(c, "site.registers.ndps.witnessOff", "This hospital has switched the second-person witness off (Settings).")) + "</div>" : "") +
      (r.truncated ? '<div class="msg err">' + EN(c, esc(r.truncatedWarning)) + "</div>" : "") +
      (r.withoutForm3e ? '<div class="msg err">' + esc(T(c, "site.registers.ndps.withoutForm3e", "{n} supplies name a patient with no Form 3E registration. Register them below.", { n: r.withoutForm3e })) + "</div>" : "") +
      (r.daysUnclosed ? '<div class="msg err">' + esc(T(c, "site.registers.ndps.daysUnclosed", "{n} past days of Form 3H are not closed by the over-all in-charge. Close them below; a late closure is recorded as late.", { n: r.daysUnclosed })) + "</div>" : "") +
      "<p>" + esc(T(c, "site.registers.ndps.summary", "{items} items, {unwitnessed} unwitnessed events, {discrepancies} count discrepancies", { items: r.items.length, unwitnessed: r.unwitnessed, discrepancies: r.discrepancies })) +
      ' <button class="btn quiet" type="button" data-rg="print3h">' + esc(T(c, "site.registers.ndps.print3h", "Print Form 3H")) + '</button> <button class="btn quiet" type="button" data-rg="csv3h">' + esc(T(c, "site.registers.exportCsv", "Export CSV")) + "</button></p>";
    var items = r.items.map(function (it, idx) {
      /* Form 3H day by day (legal review F.4.3): closed by the over-all in-charge on a numbered page, or not. */
      var days = (it.form3h || []).map(function (d, di) {
        var state = d.closure ? T(c, "site.registers.ndps.dayClosed", "closed, page {p}", { p: d.closure.page }) + (d.closure.late ? " " + T(c, "site.registers.ndps.dayLate", "(late)") : "") + (d.closure.changedSince ? " " + T(c, "site.registers.ndps.dayChanged", "(the ledger changed after closure: correct the closure with a reason)") : "")
          : d.unclosedLate ? T(c, "site.registers.ndps.dayUnclosedLate", "not closed, and the day is over") : T(c, "site.registers.ndps.dayOpen", "not closed yet");
        return "<tr" + (!d.closure && d.unclosedLate || (d.closure && d.closure.changedSince) ? ' class="warn"' : "") + "><td>" + esc(d.date) + "</td><td>" + esc(d.opening) + "</td><td>" + esc(d.received) + "</td><td>" + esc(d.dispensed) + "</td><td>" + esc(d.closing) + "</td><td>" + esc(state) + "</td><td>" +
          (!d.closure && !readOnly(c) ? '<button class="btn quiet" type="button" data-rg="closeday" data-id="' + idx + ":" + di + '">' + esc(T(c, "site.registers.ndps.closeDay", "Close the day")) + "</button>" : "") + "</td></tr>";
      }).join("");
      var daysTable = days ? '<h4>' + esc(T(c, "site.registers.ndps.days", "Form 3H by day")) + "</h4>" + (readOnly(c) ? "" : '<label class="f"><span>' + esc(T(c, "site.registers.ndps.inCharge", "Over-all in-charge closing the day (type full name)")) + '</span><input id="rgClose_' + idx + '"></label>') +
        '<div class="tbl"><table><tr><th>' + esc(T(c, "site.registers.ndps.h.date", "Date")) + "</th><th>" + esc(T(c, "site.registers.ndps.h.opening", "Opening stock")) + "</th><th>" + esc(T(c, "site.registers.ndps.h.received", "Quantity received")) + "</th><th>" + esc(T(c, "site.registers.ndps.h.dispensed", "Quantity dispensed")) +
        "</th><th>" + esc(T(c, "site.registers.ndps.h.closing", "Closing stock")) + "</th><th>" + esc(T(c, "site.registers.ndps.dayState", "Closure")) + "</th><th></th></tr>" + days + "</table></div>" : "";
      var lines = it.lines.map(function (l) {
        var no3e = l.kind === "issue" && l.form3eSerial === null && l.patientId;
        var reason = l.destruction ? T(c, "site.registers.ndps.destroyedLine", "destroyed before {n}, {d}, order {o}", { n: l.destruction.nomineeName + " (" + l.destruction.nomineeDesignation + ")", d: l.destruction.destroyedOn, o: l.destruction.nominatingOrderRef }) : (l.reason || l.receivedFrom || "");
        return "<tr" + (l.unwitnessed || l.balanceAfter < 0 || no3e ? ' class="warn"' : "") + "><td>" + EN(c, esc(String(l.at).slice(0, 16).replace("T", " "))) + "</td><td>" + EN(c, esc(l.kind)) + "</td><td>" + esc(l.quantity) + "</td><td>" + esc(l.balanceAfter) +
          "</td><td>" + EN(c, esc((l.patientId || "") + (l.form3eSerial ? " " + l.form3eSerial : ""))) + (no3e && !readOnly(c) ? ' <button class="btn quiet" type="button" data-rg="reg3e" data-id="' + esc(l.patientId) + '">' + esc(T(c, "site.registers.ndps.register3e", "Register in Form 3E")) + "</button>" : "") +
          "</td><td>" + EN(c, esc(l.by || "")) + "</td><td>" + (l.witnessedBy ? EN(c, esc(l.witnessedBy)) : l.needsWitness ? esc(T(c, "site.registers.ndps.noWitness", "no witness")) : "") + "</td><td>" + EN(c, esc(reason)) + "</td></tr>";
      }).join("");
      return '<div class="card"><h3>' + EN(c, esc(it.display + (it.location ? " (" + it.location + ")" : "") + ", " + it.unit)) + "</h3><p>" + esc(T(c, "site.registers.ndps.openClose", "Opening {o}, closing {cl}", { o: it.opening, cl: it.closing })) + "</p>" +
        (it.ledgerMismatch ? '<div class="msg err">' + esc(T(c, "site.registers.ndps.mismatch", "The register and the stock level disagree ({a} against {b}). Report this.", { a: it.ledgerMismatch.register, b: it.ledgerMismatch.stock })) + "</div>" : "") +
        '<div class="tbl"><table><tr><th>' + esc(T(c, "site.registers.ndps.colWhen", "When")) + "</th><th>" + esc(T(c, "site.registers.ndps.colWhat", "What")) + "</th><th>" + esc(T(c, "site.registers.ndps.colQty", "Quantity")) + "</th><th>" + esc(T(c, "site.registers.ndps.colBalance", "Balance")) +
        "</th><th>" + esc(T(c, "site.registers.ndps.colPatient", "Patient")) + "</th><th>" + esc(T(c, "site.registers.ndps.colBy", "By")) + "</th><th>" + esc(T(c, "site.registers.ndps.colWitness", "Witness")) + "</th><th>" + esc(T(c, "site.registers.ndps.colReason", "Reason or source")) + "</th></tr>" + lines + "</table></div>" + daysTable + "</div>";
    }).join("");
    var doses = r.doses.length ? '<div class="card"><h3>' + esc(T(c, "site.registers.ndps.doses", "Doses given on the wards")) + "</h3><ul>" + r.doses.map(function (d) {
      return "<li" + (d.unwitnessed ? ' class="warn"' : "") + ">" + EN(c, esc(String(d.at).slice(0, 16).replace("T", " ") + " " + d.display + " " + (d.patientId || ""))) + " " + (d.witnessedBy ? EN(c, esc(d.witnessedBy)) : d.needsWitness ? esc(T(c, "site.registers.ndps.noWitness", "no witness")) : "") + "</li>";
    }).join("") + "</ul></div>" : "";
    var counts = '<div class="card"><h3>' + esc(T(c, "site.registers.ndps.counts", "Counts")) + "</h3>" + (r.counts.length ? "<ul>" + r.counts.map(function (e) {
      var f = e.fields;
      return "<li" + (Number(f.variance) !== 0 ? ' class="warn"' : "") + ">" + EN(c, esc(f.countedOn + " " + (f.shift || "") + " " + f.code + " " + (f.location || ""))) + ": " + esc(T(c, "site.registers.ndps.countLine", "counted {n}, register {e}, difference {d}", { n: f.counted, e: f.expected, d: f.variance })) + "</li>";
    }).join("") + "</ul>" : "<p>" + esc(T(c, "site.registers.ndps.noCounts", "No counts recorded in this period.")) + "</p>") + "</div>";
    return head + countForm + items + doses + counts + receiveForm + transferForm + destroyForm;
  }
  /* The Drugs and Cosmetics Rules r.65 registers (legal review F.4.8, F.4.9), from the ledger. */
  function rule65Html(c) {
    var esc = c.esc, r = S.data, which = S.sub.ndps;
    var pick = monthPicker(c);
    if (r == null) return pick + loading(c);
    if (!r.ok) return pick + failedBox(c) + '<div class="msg err">' + EN(c, esc(refusal(c, r))) + "</div>";
    var head = pick + '<p class="quiet">' + EN(c, esc(r.retention)) + "</p>" + (r.truncated ? '<div class="msg err">' + EN(c, esc(r.truncatedWarning)) + "</div>" : "") +
      (r.rule65InpatientRegisters ? "" : '<div class="msg note">' + esc(T(c, "site.registers.ndps.inpatientOff", "This hospital keeps in-patient supplies off the rule 65 registers (Settings).")) + "</div>");
    if (!r.configured) return head + '<div class="msg note">' + EN(c, esc(r.message)) + "</div>";
    if (which === "h1") {
      return head + (r.rows.length ? '<div class="tbl"><table><tr><th>' + esc(T(c, "site.registers.ndps.h.date", "Date")) + "</th><th>" + esc(T(c, "site.registers.ndps.prescriber", "Prescriber: name and address")) + "</th><th>" + esc(T(c, "site.registers.ndps.patientName", "Name of the patient")) + "</th><th>" +
        esc(T(c, "site.registers.ndps.h.drug", "Name of drug")) + "</th><th>" + esc(T(c, "site.registers.ndps.colQty", "Quantity")) + "</th></tr>" + r.rows.map(function (x) {
          return "<tr" + (x.prescriberName ? "" : ' class="warn"') + "><td>" + esc(x.date) + "</td><td>" + (x.prescriberName ? EN(c, esc(x.prescriberName)) : esc(T(c, "site.registers.ndps.prescriberUnknown", "prescriber not named in the staff list"))) + EN(c, esc(x.prescriberAddress ? ", " + x.prescriberAddress : "")) + "</td><td>" + EN(c, esc(x.patientName || x.patientId)) + "</td><td>" + EN(c, esc(x.drug)) + "</td><td>" + EN(c, esc(x.quantity)) +
            (x.returned ? " " + esc(T(c, "site.registers.ndps.returned", "returned")) : "") + "</td></tr>";
        }).join("") + "</table></div>" : "<p>" + esc(T(c, "site.registers.noEntries", "No entries in this register for this period.")) + "</p>");
    }
    return head + (r.withoutParticulars ? '<div class="msg err">' + esc(T(c, "site.registers.ndps.xWithout", "{n} Schedule X supplies have no recorded prescription, bill or supervising signature.", { n: r.withoutParticulars })) + "</div>" : "") +
      (r.receiptsOutsideLockAndKey ? '<div class="msg err">' + esc(T(c, "site.registers.ndps.xLock", "{n} Schedule X receipts went to a location not listed as under lock and key (rule 65(12)).", { n: r.receiptsOutsideLockAndKey })) + "</div>" : "") +
      r.pages.map(function (p) {
        var rec = p.receipts.map(function (x) {
          return "<tr" + (x.missing.length || !x.lockAndKey ? ' class="warn"' : "") + "><td>" + esc(x.date) + "</td><td>" + EN(c, esc(x.quantity)) + "</td><td>" + EN(c, esc([x.supplierName, x.supplierAddress, x.supplierLicenceNo].filter(Boolean).join(", "))) + "</td><td>" + EN(c, esc([x.manufacturer, x.batch].filter(Boolean).join(", "))) + "</td><td>" +
            EN(c, esc(x.documentNo || "")) + "</td><td>" + (x.missing.length ? esc(T(c, "site.registers.missing", "Incomplete. Missing: {list}", { list: x.missing.join(", ") })) : "") + "</td></tr>";
        }).join("");
        var sup = p.supplies.map(function (x) {
          var q = x.particulars;
          return "<tr" + (q || x.returned ? "" : ' class="warn"') + "><td>" + esc(x.date) + "</td><td>" + EN(c, esc(x.quantity)) + "</td><td>" + EN(c, esc((x.patientName || x.patientId) + (q ? ", " + q.patientAddress : ""))) + "</td><td>" + EN(c, esc(q ? [q.manufacturer, x.batch].filter(Boolean).join(", ") : (x.batch || ""))) +
            "</td><td>" + EN(c, esc(q ? q.prescriptionRef + ", " + q.billNo + " " + q.billDate : "")) + "</td><td>" + (q ? EN(c, esc(q.serial + ", " + q.supervisedBy)) : readOnly(c) ? esc(T(c, "site.registers.ndps.unsigned", "not signed")) :
              '<button class="btn quiet" type="button" data-rg="schedx" data-id="' + esc(x.dispenseId) + '" data-patient="' + esc(x.patientId) + '" data-date="' + esc(x.date) + '">' + esc(T(c, "site.registers.ndps.recordParticulars", "Record the particulars")) + "</button>") + "</td></tr>";
        }).join("");
        return '<div class="card"><h3>' + EN(c, esc(p.drug)) + "</h3><h4>" + esc(T(c, "site.registers.ndps.receipts", "Received")) + "</h4>" + (rec ? '<div class="tbl"><table><tr><th>' + esc(T(c, "site.registers.ndps.h.date", "Date")) + "</th><th>" + esc(T(c, "site.registers.ndps.colQty", "Quantity")) + "</th><th>" +
          esc(T(c, "site.registers.ndps.supplier", "Supplier: name, address, licence number")) + "</th><th>" + esc(T(c, "site.registers.ndps.makerBatch", "Manufacturer, batch")) + "</th><th>" + esc(T(c, "site.registers.ndps.h.doc", "Consignment note / bill / invoice no.")) + "</th><th></th></tr>" + rec + "</table></div>" : "<p>" + esc(T(c, "site.registers.vital.noneOwed", "None.")) + "</p>") +
          "<h4>" + esc(T(c, "site.registers.ndps.supplied", "Supplied")) + "</h4>" + (sup ? '<div class="tbl"><table><tr><th>' + esc(T(c, "site.registers.ndps.h.date", "Date")) + "</th><th>" + esc(T(c, "site.registers.ndps.colQty", "Quantity")) + "</th><th>" + esc(T(c, "site.registers.ndps.patientNameAddress", "Patient: name and address")) + "</th><th>" +
          esc(T(c, "site.registers.ndps.makerBatch", "Manufacturer, batch")) + "</th><th>" + esc(T(c, "site.registers.ndps.rxBill", "Prescription reference, bill number and date")) + "</th><th>" + esc(T(c, "site.registers.ndps.supervisor", "Entry number, supervising person")) + "</th></tr>" + sup + "</table></div>" : "<p>" + esc(T(c, "site.registers.vital.noneOwed", "None.")) + "</p>") + "</div>";
      }).join("");
  }
  /* One patient's controlled drugs, read only (legal review F.4.10: nursing reads the patient's own rows). */
  function ndpsPatientHtml(c) {
    var esc = c.esc, r = S.data;
    var pick = '<div class="row"><label class="f"><span>' + esc(T(c, "site.registers.ndps.patientIdAny", "Patient id")) + '</span><input id="rgNdpsPatient" value="' + esc(S.ndpsPatient) + '"></label><button class="btn quiet" type="button" data-rg="load">' + esc(T(c, "site.registers.show", "Show")) + "</button></div>";
    if (!S.ndpsPatient) return pick;
    if (r == null) return pick + loading(c);
    if (!r.ok) return pick + failedBox(c) + '<div class="msg err">' + EN(c, esc(refusal(c, r))) + "</div>";
    var rows = function (list, cells, after) { return list.length ? "<ul>" + list.map(function (x) { return "<li>" + EN(c, esc(cells(x))) + (after ? after(x) : "") + "</li>"; }).join("") + "</ul>" : "<p>" + esc(T(c, "site.registers.vital.noneOwed", "None.")) + "</p>"; };
    return pick + '<p class="quiet">' + esc(T(c, "site.registers.ndps.readOnly", "Read only.")) + "</p><h4>" + esc(T(c, "site.registers.ndps.supplied", "Supplied")) + "</h4>" +
      rows(r.supplies, function (x) { return String(x.at || "").slice(0, 16).replace("T", " ") + " " + x.drug + " " + x.quantity; }, function (x) { return x.state === "returned" ? " " + esc(T(c, "site.registers.ndps.returned", "returned")) : ""; }) +
      "<h4>" + esc(T(c, "site.registers.ndps.doses", "Doses given on the wards")) + "</h4>" +
      rows(r.doses, function (x) { return String(x.at || "").slice(0, 16).replace("T", " ") + " " + x.drug + " " + (x.dose ? x.dose.value + " " + x.dose.unit : "") + " " + (x.by || "") + (x.witnessedBy ? " / " + x.witnessedBy : ""); });
  }
  function form3eViewHtml(c) {
    var esc = c.esc, r = S.data;
    var pick = '<div class="row"><label class="f"><span>' + esc(T(c, "site.registers.ndps.patientId", "Patient id (from the supply on the register book)")) + '</span><input id="rgNdpsPatient" value="' + esc(S.ndpsPatient) + '"></label><button class="btn quiet" type="button" data-rg="load">' + esc(T(c, "site.registers.show", "Show")) + "</button></div>";
    if (!S.ndpsPatient) return pick;
    if (r == null) return pick + loading(c);
    if (!r.ok) return pick + failedBox(c) + '<div class="msg err">' + EN(c, esc(refusal(c, r))) + "</div>";
    var reg = r.registration ? '<p>' + esc(T(c, "site.registers.ndps.registered", "Form 3E registration {n} of {d}", { n: r.registration.serial, d: r.registration.fields.registrationDate })) + "</p>"
      : '<div class="msg err">' + esc(T(c, "site.registers.ndps.notRegistered", "This patient has no Form 3E registration.")) + (readOnly(c) ? "" : ' <button class="btn quiet" type="button" data-rg="reg3e" data-id="' + esc(r.patientId) + '">' + esc(T(c, "site.registers.ndps.register3e", "Register in Form 3E")) + "</button>") + "</div>";
    var rows = r.rows.length ? '<div class="tbl"><table><tr><th>' + esc(T(c, "site.registers.ndps.h.date", "Date")) + "</th><th>" + esc(T(c, "site.registers.ndps.h.drug", "Name of drug")) + "</th><th>" + esc(T(c, "site.registers.ndps.colQty", "Quantity")) + "</th><th>" + esc(T(c, "site.registers.ndps.signature", "Signature / thumb impression of the patient")) + "</th></tr>" +
      r.rows.map(function (x) {
        var sig = x.signature ? EN(c, esc(x.signature.name + (x.signature.representativeName ? " (" + x.signature.representativeName + ")" : ""))) + ' <span class="quiet">(' + esc(T(c, "site.registers.attested", "attested {at}", { at: String(x.signature.at || "").slice(0, 16).replace("T", " ") })) + ")</span>"
          : x.returned ? esc(T(c, "site.registers.ndps.returned", "returned")) : (r.registration && !readOnly(c) ? '<button class="btn quiet" type="button" data-rg="sign3e" data-id="' + esc(x.dispenseId) + '">' + esc(T(c, "site.registers.ndps.recordSignature", "Record the signature")) + "</button>" : esc(T(c, "site.registers.ndps.unsigned", "not signed")));
        /* Rule 52W: a supply taken out for home care, and the unused quantity brought back. */
        if (!x.returned && !readOnly(c)) sig += ' <button class="btn quiet" type="button" data-rg="homecare" data-id="' + esc(x.dispenseId) + '" data-date="' + esc(x.date) + '">' + esc(T(c, "site.registers.ndps.homeCare", "Home care")) + "</button>";
        return "<tr" + (!x.signature && !x.returned ? ' class="warn"' : "") + "><td>" + esc(x.date) + "</td><td>" + EN(c, esc(x.drug)) + "</td><td>" + EN(c, esc(x.quantity)) + "</td><td>" + sig + "</td></tr>";
      }).join("") + "</table></div>" : "<p>" + esc(T(c, "site.registers.ndps.noSupplies", "No supplies of a controlled drug to this patient.")) + "</p>";
    return pick + reg + rows;
  }
  function annualHtml(c) {
    var esc = c.esc, r = S.data;
    var pick = '<div class="row"><label class="f"><span>' + esc(T(c, "site.registers.ndps.year", "Calendar year")) + '</span><input id="rgYear" type="number" min="2015" max="2100" value="' + esc(S.year) + '"></label><button class="btn quiet" type="button" data-rg="load">' + esc(T(c, "site.registers.show", "Show")) + "</button>" +
      (readOnly(c) ? "" : ' <button class="btn" type="button" data-rg="new-kind" data-kind="form3j">' + esc(T(c, "site.registers.ndps.new3j", "Record an estimate (Form 3J)")) + '</button> <button class="btn quiet" type="button" data-rg="new-return">' + esc(T(c, "site.registers.recordSubmission", "Record a submission")) + "</button>") + "</div>";
    if (r == null) return pick + loading(c);
    if (!r.ok) return pick + failedBox(c) + '<div class="msg err">' + EN(c, esc(refusal(c, r))) + "</div>";
    var clocks = r.clocks.map(function (k) { return '<div class="msg ' + clockClass(k) + '">' + esc((k.what === "form3j" ? T(c, "site.registers.ndps.clock3j", "Form 3J estimate for {y}", { y: k.year }) : T(c, "site.registers.ndps.clock3i", "Form 3-I return for {y}", { y: k.year })) + ": " + clockText(c, k)) + "</div>"; }).join("");
    var table = r.form3i.length ? '<div class="tbl"><table><tr><th>' + esc(T(c, "site.registers.ndps.h.drug", "Name of drug")) + "</th><th>" + esc(T(c, "site.registers.ndps.estimate", "Estimate")) + "</th><th>" + esc(T(c, "site.registers.ndps.revised", "Revised estimate")) + "</th><th>" + esc(T(c, "site.registers.ndps.h.opening", "Opening stock")) +
      "</th><th>" + esc(T(c, "site.registers.ndps.procured", "Procured")) + "</th><th>" + esc(T(c, "site.registers.ndps.disbursed", "Disbursed to patients")) + "</th><th>" + esc(T(c, "site.registers.ndps.h.closing", "Closing stock")) + "</th><th></th></tr>" +
      r.form3i.map(function (x, i) {
        return "<tr" + (x.overEstimate || x.noEstimate ? ' class="warn"' : "") + "><td>" + EN(c, esc(x.drug + ", " + x.unit)) + "</td><td>" + esc(x.estimate == null ? T(c, "site.registers.ndps.noEstimate", "none recorded") : x.estimate) + "</td><td>" + esc(x.revisedEstimate == null ? "" : x.revisedEstimate) + "</td><td>" + esc(x.openingStock) + "</td><td>" + esc(x.procured) + "</td><td>" + esc(x.disbursed) +
          (x.overEstimate ? " " + esc(T(c, "site.registers.ndps.over10", "(more than 10 per cent above the estimate: a justification is required)")) : "") + "</td><td>" + esc(x.closingStock) + "</td><td>" + (readOnly(c) ? "" : '<button class="btn quiet" type="button" data-rg="prep3i" data-id="' + i + '">' + esc(T(c, "site.registers.ndps.prepare3i", "Prepare Form 3-I")) + "</button>") + "</td></tr>";
      }).join("") + "</table></div>" : "<p>" + esc(T(c, "site.registers.ndps.noControlled", "No controlled drug moved in this year.")) + "</p>";
    return pick + alertsHtml(c, r.rmi && r.rmi.alerts) + clocks + '<p class="quiet">' + EN(c, esc(r.submission)) + "</p>" + table;
  }

  /* ---------------------------------------------------------------------------------------------- the register tabs */
  function registerHtml(c) {
    var esc = c.esc, kind = kindNow(), schema = S.schemas && S.schemas[kind];
    if (S.schemas === false) return failedBox(c);
    if (S.tab === "ndps" && S.sub.ndps === "book" && !S.form) return subPicker(c) + monthPicker(c) + ndpsHtml(c);
    if (S.tab === "ndps" && S.sub.ndps === "form3eview" && !S.form) return subPicker(c) + form3eViewHtml(c);
    if (S.tab === "ndps" && S.sub.ndps === "annual" && !S.form) return subPicker(c) + annualHtml(c);
    if (S.tab === "ndps" && (S.sub.ndps === "h1" || S.sub.ndps === "schedx") && !S.form) return subPicker(c) + rule65Html(c);
    if (S.tab === "ndps" && S.sub.ndps === "patient" && !S.form) return subPicker(c) + ndpsPatientHtml(c);
    if (S.form) { var fs = S.schemas && S.schemas[S.form.kind || kind]; return fs ? formHtml(c, fs, S.form) : loading(c); }
    if (!schema) return loading(c);
    if (S.entry) return entryHtml(c, schema, S.entry);
    var tools = '<div class="row">';
    if (S.tab === "vital") tools += '<label class="f"><span>' + esc(T(c, "site.registers.vital.kind", "Register")) + '</span><select id="rgVitalKind">' +
      [["birth", T(c, "site.registers.vital.birth", "Births (Form 1)")], ["death", T(c, "site.registers.vital.death", "Deaths (Form 2)")], ["stillbirth", T(c, "site.registers.vital.stillbirth", "Still births (Form 3)")], ["mccd", T(c, "site.registers.vital.mccd", "Cause of death certificates (Form 4/4A)")]]
        .map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === S.vitalKind ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") + "</select></label>";
    if (S.tab === "ihip" && c.can("register.ihip")) tools += '<label class="f"><span>' + esc(T(c, "site.registers.ihip.week", "Week starting Monday")) + '</span><input id="rgWeek" type="date" value="' + esc(S.week) + '"></label>';
    else tools += '<label class="f"><span>' + esc(T(c, "site.registers.month", "Month")) + '</span><input id="rgPeriod" type="month" value="' + esc(S.period) + '"></label>';
    tools += '<button class="btn quiet" type="button" data-rg="load">' + esc(T(c, "site.registers.show", "Show")) + "</button>";
    var canNew = !(S.tab === "vital" && S.vitalKind === "mccd" ? !c.can("emr.treat") : S.tab === "vital" ? !c.can("register.records") : S.tab === "mlc" ? !(c.can("mlc.record") || c.can("register.records")) : S.tab === "ihip" ? !(c.can("emr.treat") || c.can("register.ihip")) : false);
    if (readOnly(c) && kind !== "statreturn") canNew = false;
    /* Records opened from another screen (a supply, the day book) or by the server (a POCSO task) have no blank "New". */
    if (canNew && ["formfprint", "form3i", "form3esign", "form3e", "homecare", "schedxsupply", "pocsotask", "form3hclose"].indexOf(kind) < 0) tools += ' <button class="btn" type="button" data-rg="new">' + esc(T(c, "site.registers.new", "New entry")) + "</button>";
    if (canList(c)) tools += ' <button class="btn quiet" type="button" data-rg="csv">' + esc(T(c, "site.registers.exportCsv", "Export CSV")) + '</button> <button class="btn quiet" type="button" data-rg="print">' + esc(T(c, "site.registers.print", "Print register")) + "</button>";
    if (S.tab === "mlc" && kind === "mlc" && canList(c) && S.data && S.data.stateFormat === "kerala") tools += ' <button class="btn quiet" type="button" data-rg="kerala">' + esc(T(c, "site.registers.mlc.kerala", "Export in the Kerala register format")) + "</button>";
    if (S.tab === "mtp" && kind === "mtp") tools += ' <button class="btn quiet" type="button" data-rg="form2">' + esc(T(c, "site.registers.mtp.form2", "Monthly statement (Form II)")) + "</button>";
    if (S.tab === "formf" && kind === "formf") tools += ' <button class="btn quiet" type="button" data-rg="monthly">' + esc(T(c, "site.registers.formf.monthly", "Monthly report (rule 9(8))")) + "</button>";
    if (S.tab === "vital" && c.can("register.records") && S.vitalKind !== "mccd") tools += ' <button class="btn quiet" type="button" data-rg="pending">' + esc(T(c, "site.registers.vital.pending", "Still owed to the Registrar")) + "</button>";
    tools += "</div>";
    /* Regulation 6: the MTP register is exported only under the authority of law, named here and audited. */
    if (S.tab === "mtp" && kind === "mtp") tools += '<div class="row"><span class="quiet">' + esc(T(c, "site.registers.mtp.authority", "An export or print names the legal authority it is made under (MTP Regulations reg 6):")) + "</span>" +
      [["officer", T(c, "site.registers.mtp.authOfficer", "Requesting officer")], ["law", T(c, "site.registers.mtp.authLaw", "Law")], ["reference", T(c, "site.registers.mtp.authReference", "Reference")]].map(function (p) {
        return '<label class="f"><span>' + esc(p[1]) + '</span><input id="rgAuth' + p[0] + '"></label>';
      }).join("") + "</div>";
    /* Legal review D.4.8: the medico-legal register is exported to the police or a court only on a recorded requisition. */
    if (S.tab === "mlc" && canList(c)) tools += '<div class="row"><span class="quiet">' + esc(T(c, "site.registers.mlc.requisition", "An export or print names the requisition it answers:")) + "</span>" +
      [["from", T(c, "site.registers.mlc.reqFrom", "Police officer or court"), ""], ["ref", T(c, "site.registers.mlc.reqRef", "Requisition reference"), ""], ["date", T(c, "site.registers.mlc.reqDate", "Requisition date"), "date"]].map(function (p) {
        return '<label class="f"><span>' + esc(p[1]) + '</span><input id="rgReq' + p[0] + '"' + (p[2] ? ' type="' + p[2] + '"' : "") + "></label>";
      }).join("") + "</div>";
    var intro = '<p class="quiet">' + EN(c, esc(schema.authority)) + ". " + esc(T(c, "site.registers.manual", "Submission is manual: WardSynQ does not send registers to any authority.")) + "</p>" +
      (schema.retention ? '<p class="quiet">' + EN(c, esc(schema.retention)) + "</p>" : "") + (schema.notes || []).map(function (n) { return '<p class="quiet">' + EN(c, esc(n)) + "</p>"; }).join("") +
      (S.tab === "vital" ? '<div class="msg note">' + esc(T(c, "site.registers.vital.aadhaar", "Aadhaar numbers are not stored here: key them into the CRS portal at submission.")) + "</div>" : "") +
      (S.tab === "vital" && S.vitalKind === "mccd" ? '<div class="msg note">' + esc(T(c, "site.registers.vital.mccdFree", "The certificate of the cause of death is free of charge, and a copy goes to the nearest relative (RBD Act s.10(2)).")) + "</div>" : "");
    var status = statusHtml(c, kind);
    var extra = S.extra ? extraHtml(c) : "";
    /* A treating doctor does not keep the MLC register, but can look up one patient's case by hospital number (sent in the body, never the URL). */
    var lookup = S.tab === "mlc" && !canList(c) ? '<div class="row"><label class="f"><span>' + esc(T(c, "site.registers.mrn", "Patient hospital number (MRN)")) + '</span><input id="rgLookupMrn"></label><button class="btn quiet" type="button" data-rg="mlcpatient">' + esc(T(c, "site.registers.mlc.lookup", "Show this patient's medico-legal cases")) + "</button></div>" + (S.data ? entriesTable(c, schema, S.data) : "") : "";
    return subPicker(c) + intro + tools + status + extra + lookup + (canList(c) ? entriesTable(c, schema, S.data) : '<p class="quiet">' + esc(T(c, "site.registers.createOnly", "You can record entries here; the register itself is kept by its custodian.")) + "</p>");
  }
  function subPicker(c) {
    var list = subKinds(c)[S.tab];
    if (!list) return "";
    return '<div class="row"><label class="f"><span>' + c.esc(T(c, "site.registers.vital.kind", "Register")) + '</span><select id="rgSubKind">' + list.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === S.sub[S.tab] ? " selected" : "") + ">" + c.esc(o[1]) + "</option>"; }).join("") + "</select></label>" +
      '<button class="btn quiet" type="button" data-rg="load">' + c.esc(T(c, "site.registers.show", "Show")) + "</button></div>";
  }
  function monthPicker(c) { return '<div class="row"><label class="f"><span>' + c.esc(T(c, "site.registers.month", "Month")) + '</span><input id="rgPeriod" type="month" value="' + c.esc(S.period) + '"></label><button class="btn quiet" type="button" data-rg="load">' + c.esc(T(c, "site.registers.show", "Show")) + "</button></div>"; }
  /* What the list response says beyond its rows: Form F's presumed contraventions and centre panel, the Form II clock,
   * the medico-legal clock dashboard. */
  function statusHtml(c, kind) {
    var r = S.data, esc = c.esc;
    if (!r || !r.ok) return "";
    var out = "";
    if (kind === "formf") {
      if (r.incomplete) out += '<div class="msg err">' + esc(T(c, "site.registers.formf.incomplete", "{n} incomplete Form F this month: presumed contravention unless the contrary is proved (Act s.4(3)). Complete every one.", { n: r.incomplete })) + "</div>";
      out += alertsHtml(c, r.centre);
      if (r.stateSubmission) out += '<div class="msg note">' + esc(submissionText(c, r.stateSubmission)) + "</div>";
      if (r.portalPending) out += '<div class="msg ' + (r.portalOverdue ? "err" : "note") + '">' + esc(T(c, "site.legal.formf.pending", "{n} Form F not yet recorded as submitted on the State/UT portal, {o} past the deadline.", { n: r.portalPending, o: r.portalOverdue || 0 })) + "</div>";
      out += '<p class="quiet">' + esc(T(c, "site.registers.formf.due5", "The monthly report of every Form F is due by the 5th of the following month (rule 9(8)).")) + "</p>";
    }
    if (kind === "mtp" && r.form2) out += '<div class="msg ' + clockClass(r.form2) + '">' + esc(T(c, "site.registers.mtp.form2Clock", "Form II for {p}: {s}", { p: r.form2.period, s: clockText(c, r.form2) })) + "</div>";
    if (kind === "mlc" && r.clockSummary) {
      var cs = r.clockSummary;
      out += '<div class="msg ' + (cs.overdue ? "err" : "note") + '">' + esc(T(c, "site.registers.mlc.dashboard", "Open cases: {p} police intimations pending, {c} POCSO reports due, {i} reports to the investigating officer due, {q} inquest papers pending, {o} overdue.", { p: cs.policeIntimationPending, c: cs.pocsoReportDue, i: cs.ioReportDue, q: cs.inquestPapersPending, o: cs.overdue })) + "</div>";
      if (cs.pocsoTasksOpen) out += '<div class="msg err">' + esc(T(c, "site.registers.mlc.pocsoTasks", "{n} POCSO intimation tasks are open (POCSO Act s.19(1)). Open them from the register picker.", { n: cs.pocsoTasksOpen })) + "</div>";
      if (r.medleapr) out += '<p class="quiet">' + esc(r.medleapr.required ? T(c, "site.legal.mlc.required", "MedLEaPR is required in this State/UT for medico-legal reports today: a case is complete with its MedLEaPR reference and frozen date.")
        : !r.medleapr.stateUt ? T(c, "site.legal.mlc.noState", "This hospital's State/UT is not recorded, so no MedLEaPR requirement is applied. Follow the State-prescribed medico-legal workflow.")
        : !r.medleapr.configured ? T(c, "site.legal.mlc.notConfigured", "MedLEaPR is not configured for this State/UT. Follow the State-prescribed medico-legal workflow.")
        : T(c, "site.legal.mlc.notRequired", "MedLEaPR is not required in this State/UT for medico-legal reports today. Follow the State-prescribed medico-legal workflow.")) + "</p>";
    }
    return out;
  }

  function vitalLabel(c, k) {
    return { birth: T(c, "site.registers.vital.birth", "Births (Form 1)"), death: T(c, "site.registers.vital.death", "Deaths (Form 2)"), stillbirth: T(c, "site.registers.vital.stillbirth", "Still births (Form 3)"), mccd: T(c, "site.registers.vital.mccd", "Cause of death certificates (Form 4/4A)") }[k] || k;
  }
  function extraHtml(c) {
    var esc = c.esc, x = S.extra;
    if (x.loading) return loading(c);
    if (!x.r || !x.r.ok) return '<div class="msg err">' + EN(c, esc(refusal(c, x.r))) + "</div>";
    if (x.what === "form2") {
      var st = x.r.statement, an = x.r.annex;
      return '<div class="card"><h3>' + EN(c, esc(x.r.form)) + '</h3><dl class="kv">' + Object.keys(st).map(function (k) { return "<dt>" + EN(c, esc(k)) + "</dt><dd>" + EN(c, esc(st[k])) + "</dd>"; }).join("") + "</dl>" +
        (an ? "<h4>" + EN(c, esc(an.title)) + '</h4><dl class="kv">' + Object.keys(an).filter(function (k) { return k !== "title"; }).map(function (k) { return "<dt>" + EN(c, esc(k)) + "</dt><dd>" + esc(an[k]) + "</dd>"; }).join("") + "</dl>" : "") +
        (x.r.annexOmitted ? '<div class="msg note">' + EN(c, esc(x.r.annexOmitted)) + "</div>" : "") +
        "<p>" + esc(T(c, "site.legal.mtp.to", "To:")) + " " + EN(c, esc(x.r.sendTo)) + "<br>" + esc(T(c, "site.legal.mtp.from", "From:")) + " " + EN(c, esc(x.r.from)) + '</p><p class="quiet">' + EN(c, esc(x.r.recipientNote)) + " " + EN(c, esc(x.r.dueNote)) + "</p>" +
        '<div class="msg ' + clockClass(x.r.clock) + '">' + esc(clockText(c, x.r.clock)) + '</div><button class="btn quiet" type="button" data-rg="new-return" data-period="' + esc(x.r.period) + '">' + esc(T(c, "site.registers.recordSubmission", "Record a submission")) + "</button></div>";
    }
    if (x.what === "monthly") {
      return '<div class="card"><h3>' + esc(T(c, "site.registers.formf.monthlyTitle", "Monthly report of Form F, {p}", { p: x.r.period })) + "</h3><p>" + EN(c, esc(x.r.rule)) + "</p>" + (x.r.stateSubmission ? '<p class="quiet">' + esc(submissionText(c, x.r.stateSubmission)) + "</p>" : "") + "<p>" +
        esc(T(c, "site.registers.formf.monthlyCounts", "{t} Form F this month, {i} incomplete (flagged in the report, never left out).", { t: x.r.total, i: x.r.incomplete })) + '</p><div class="msg ' + clockClass(x.r.clock) + '">' + esc(clockText(c, x.r.clock)) + "</div>" +
        '<button class="btn" type="button" data-rg="monthly-csv">' + esc(T(c, "site.registers.formf.downloadReport", "Download the report (CSV)")) + '</button> <button class="btn quiet" type="button" data-rg="new-return" data-period="' + esc(x.r.period) + '">' + esc(T(c, "site.registers.recordSubmission", "Record a submission")) + "</button></div>";
    }
    if (x.what === "pending") {
      var d = x.r.deliveries, dd = x.r.deaths, ns = x.r.notSubmitted || [];
      return '<div class="card"><h3>' + esc(T(c, "site.registers.vital.owed", "Owed to the Registrar this month")) + "</h3>" + (x.r.truncated ? '<div class="msg note">' + EN(c, esc(x.r.truncatedWarning)) + "</div>" : "") +
        "<h4>" + esc(T(c, "site.registers.vital.deliveries", "Deliveries without a birth or still birth report")) + "</h4>" + (d.length ? "<ul>" + d.map(function (p) {
          return "<li>" + EN(c, esc((p.name || "") + " " + (p.mrn || "") + " " + String(p.deliveredAt).slice(0, 10))) + ' <span class="msg ' + clockClass(p.clock) + '">' + esc(clockText(c, p.clock)) + "</span>" +
            ' <button class="btn quiet" type="button" data-rg="prefill" data-kind="birth" data-id="' + esc(p.deliveryId) + '">' + esc(T(c, "site.registers.vital.startBirth", "Start birth report")) + '</button> <button class="btn quiet" type="button" data-rg="prefill" data-kind="stillbirth" data-id="' + esc(p.deliveryId) + '">' + esc(T(c, "site.registers.vital.startStill", "Start still birth report")) + "</button></li>";
        }).join("") + "</ul>" : "<p>" + esc(T(c, "site.registers.vital.noneOwed", "None.")) + "</p>") +
        "<h4>" + esc(T(c, "site.registers.vital.deathsOwed", "Deaths without a death report or cause of death certificate")) + "</h4>" + (dd.length ? "<ul>" + dd.map(function (p) {
          return "<li>" + EN(c, esc((p.name || "") + " " + (p.mrn || "") + " " + String(p.diedAt).slice(0, 10))) + ' <span class="msg ' + clockClass(p.clock) + '">' + esc(clockText(c, p.clock)) + "</span> " +
            (p.deathReport ? "" : '<button class="btn quiet" type="button" data-rg="prefill" data-kind="death" data-id="' + esc(p.patientId) + '">' + esc(T(c, "site.registers.vital.startDeath", "Start death report")) + "</button> ") +
            (p.mccd ? "" : '<span class="quiet">' + esc(T(c, "site.registers.vital.mccdOwed", "cause of death certificate not yet written by the doctor")) + "</span>") + "</li>";
        }).join("") + "</ul>" : "<p>" + esc(T(c, "site.registers.vital.noneOwed", "None.")) + "</p>") +
        "<h4>" + esc(T(c, "site.registers.vital.notSubmitted", "Written but not yet recorded as submitted")) + "</h4>" + (ns.length ? "<ul>" + ns.map(function (e) {
          return '<li><button class="btn quiet" type="button" data-rg="open-kind" data-kind="' + esc(e.kind) + '" data-id="' + esc(e.id) + '">' + esc(vitalLabel(c, e.kind) + " " + (e.eventDate || "")) + '</button> <span class="msg ' + clockClass(e.clock) + '">' + esc(clockText(c, e.clock)) + "</span></li>";
        }).join("") + "</ul>" : "<p>" + esc(T(c, "site.registers.vital.noneOwed", "None.")) + "</p>") + "</div>";
    }
    if (x.what === "week") {
      return '<div class="card"><h3>' + esc(T(c, "site.registers.ihip.weekTitle", "IDSP week {from} to {to}", { from: x.r.week.from, to: x.r.week.to })) + "</h3><p>" + EN(c, esc(x.r.submission)) + "</p>" +
        (x.r.summary.length ? '<div class="tbl"><table><tr><th>' + esc(T(c, "site.registers.ihip.condition", "Condition")) + "</th><th>" + esc(T(c, "site.registers.ihip.form", "Form")) + "</th><th>" + esc(T(c, "site.registers.ihip.cases", "Cases")) + "</th><th>" + esc(T(c, "site.registers.ihip.deaths", "Deaths")) + "</th><th>" + esc(T(c, "site.registers.ihip.notOnIhip", "Not yet on IHIP")) + "</th></tr>" +
          x.r.summary.map(function (s) { return "<tr><td>" + EN(c, esc(s.name)) + "</td><td>" + esc(s.form) + "</td><td>" + esc(s.cases) + "</td><td>" + esc(s.deaths) + "</td><td>" + esc(s.notYetOnIhip) + "</td></tr>"; }).join("") + "</table></div>" : "<p>" + esc(T(c, "site.registers.ihip.noCases", "No cases this week.")) + "</p>") + "</div>";
    }
    return "";
  }

  /* ---------------------------------------------------------------------------------------------- settings */
  var MLC_CATS = ["sexual-assault-adult", "acid-attack", "pocso", "rta", "death-in-custody", "death-woman-married-under-7-years", "bnss33-offence", "assault", "burns", "poisoning", "suspected-suicide", "fall-industrial", "animal-bite", "brought-dead", "unknown-unconscious", "other"];
  function lines(list, keys) { return (list || []).map(function (r) { return keys.map(function (k) { return k === "overallInCharge" ? (r[k] ? "yes" : "") : (r[k] || ""); }).join(" | "); }).join("\n"); }
  function parseLines(id, keys) {
    return String(val(id) || "").split(/\n/).map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) {
      var parts = l.split("|"), o = {};
      keys.forEach(function (k, i) { var v = String(parts[i] || "").trim(); if (k === "overallInCharge") o[k] = /^(yes|y|true)$/i.test(v); else o[k] = v; });
      return o;
    });
  }
  function settingsHtml(c) {
    var esc = c.esc, r = S.settings;
    if (r === null) return loading(c);
    if (r === false) return '<div class="msg err">' + esc(T(c, "site.registers.settings.loadFailed", "The register settings could not be loaded. Do not read this as the defaults.")) + "</div>";
    var s = r.settings, n = r.notes || {}, p = s.pcpndt, m = s.mtp, l = s.mlc, b = s.rbd, nd = s.ndps;
    var catField = S.schemas && S.schemas.mlc && fieldOf(S.schemas.mlc, "category");
    var catLabel = function (k) { var o = catField && catField.options.filter(function (x) { return x[0] === k; })[0]; return o ? o[1] : k; };
    var note = function (k) { return n[k] ? '<span class="quiet">' + EN(c, esc(n[k])) + "</span>" : ""; };
    var input = function (id, label, value, type, extra) { return '<label class="f"><span>' + esc(label) + '</span><input id="' + id + '"' + (type ? ' type="' + type + '"' : "") + ' value="' + esc(value == null ? "" : value) + '"' + (extra || "") + "></label>"; };
    var box = function (id, label, on) { return '<label class="f" style="flex-direction:row;align-items:center"><input type="checkbox" id="' + id + '"' + (on ? " checked" : "") + ' style="width:auto;margin:0 8px 0 0"><span>' + esc(label) + "</span></label>"; };
    var select = function (id, label, value, opts) { return '<label class="f"><span>' + esc(label) + '</span><select id="' + id + '">' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === value ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") + "</select></label>"; };
    var area = function (id, label, value, hint) { return '<label class="f"><span>' + esc(label) + '</span><textarea id="' + id + '" rows="3">' + esc(value) + '</textarea><span class="quiet">' + esc(hint) + "</span></label>"; };
    return '<div class="card"><h3>' + esc(T(c, "site.registers.settings.pcpndt", "PCPNDT")) + '</h3>' +
      '<p class="quiet">' + esc(T(c, "site.legal.settingsMoved", "Online Form F and MedLEaPR follow this hospital's State/UT: see the Legal requirements tab.")) + "</p>" +
      '<div class="row">' + select("rgS_formG", T(c, "site.registers.settings.formG", "Form G version"), p.formGVersion, [["1996", "1996"], ["2024", T(c, "site.registers.settings.formG2024", "2024 revision (only once notified)")]]) + "</div>" + note("formGVersion") +
      '<div class="row">' + input("rgS_formB", T(c, "site.registers.settings.formB", "Form B registration certificate number"), p.centre.formBNumber) + input("rgS_formBUntil", T(c, "site.registers.settings.formBUntil", "Form B valid until"), p.centre.formBValidUntil, "date") +
      box("rgS_r17", T(c, "site.registers.settings.r17Notice", "The rule 17(1) notice is displayed in English and the local language"), p.centre.r17NoticeDisplayed) + box("rgS_r17copies", T(c, "site.registers.settings.r17Copies", "Copies of the Act and Rules are on the premises (rule 17(2))"), p.centre.actAndRulesOnPremises) + "</div>" +
      area("rgS_machines", T(c, "site.registers.settings.machines", "Machines, one per line"), lines(p.centre.machines, ["make", "model", "serial"]), T(c, "site.registers.settings.machinesHint", "make | model | serial number")) +
      area("rgS_changes", T(c, "site.registers.settings.changes", "Planned changes of employee, place or equipment (rule 13), one per line"), lines(p.centre.plannedChanges, ["what", "effectiveOn", "intimatedOn"]), T(c, "site.registers.settings.changesHint", "what | effective on (YYYY-MM-DD) | intimated on (YYYY-MM-DD, blank if not yet)")) + "</div>" +
      '<div class="card"><h3>' + esc(T(c, "site.registers.tab.mtp", "MTP")) + '</h3><div class="row">' +
      input("rgS_f2Day", T(c, "site.registers.settings.f2Day", "Form II due on this day of the following month"), m.formIIDueDay, "number", ' min="1" max="28"') + box("rgS_f2Annex", T(c, "site.registers.settings.f2Annex", "Count terminations over 20 weeks in a separate annex"), m.formIIOver20Annex) + "</div>" +
      note("formIIDueDay") + " " + note("formIIOver20Annex") + "</div>" +
      '<div class="card"><h3>' + esc(T(c, "site.registers.tab.mlc", "Medico-legal cases")) + '</h3><div class="row">' + box("rgS_charter", T(c, "site.registers.settings.charter", "The Good Samaritan charter is displayed at the entrance and on the website (CMVR r.168(5))"), l.goodSamaritanCharterDisplayed) + "</div>" +
      "<p>" + esc(T(c, "site.registers.settings.intimation", "Categories intimated to the police (statutory categories are always intimated)")) + '</p><div class="row">' + MLC_CATS.map(function (k) {
        return '<label class="f" style="flex-direction:row;align-items:center"><input type="checkbox" data-mlccat="' + esc(k) + '"' + (l.intimationCategories.indexOf(k) >= 0 ? " checked" : "") + ' style="width:auto;margin:0 8px 0 0"><span>' + EN(c, esc(catLabel(k))) + "</span></label>";
      }).join("") + "</div>" + note("intimationCategories") +
      '<div class="row">' + select("rgS_stateFormat", T(c, "site.registers.settings.stateFormat", "Medico-legal register format"), l.stateFormat, [["hospital", T(c, "site.registers.settings.formatHospital", "The hospital's own record")], ["kerala", T(c, "site.registers.settings.formatKerala", "Kerala DHS formats")]]) + "</div>" + note("stateFormat") +
      area("rgS_restricted", T(c, "site.registers.settings.restricted", "People who may open sexual offence and POCSO cases besides the keepers and the treating doctors, one staff id or email per line"), (l.restrictedReaders || []).join("\n"), T(c, "site.registers.settings.restrictedHint", "for example the medico-legal officer")) + note("restrictedReaders") + "</div>" +
      '<div class="card"><h3>' + esc(T(c, "site.registers.tab.vital", "Births and deaths")) + '</h3><div class="row">' +
      select("rgS_rbdVersion", T(c, "site.registers.settings.rbdVersion", "Forms under"), b.formVersion, [["model-2024", T(c, "site.registers.settings.rbd2024", "Model RBD (Amendment) Rules 2024")], ["model-1999", T(c, "site.registers.settings.rbd1999", "Model RBD Rules 1999 (state has not notified the 2024 forms)")]]) +
      box("rgS_icd", T(c, "site.registers.settings.icd", "Require an ICD-10 code on the cause of death certificate (hospital coding)"), s.mccd.requireIcd10) + "</div>" + note("rbdFormVersion") + " " + note("requireIcd10") +
      area("rgS_informants", T(c, "site.registers.settings.informants", "Persons authorised by the medical officer in charge to inform the Registrar (RBD Act s.8(1)(b)), one per line"), lines(b.informantAuthorisations, ["name", "authorisedBy", "from"]), T(c, "site.registers.settings.informantsHint", "name | authorised by | from (YYYY-MM-DD)")) + "</div>" +
      '<div class="card"><h3>' + esc(T(c, "site.registers.tab.ndps", "Controlled drugs (NDPS)")) + '</h3><div class="row">' + box("rgS_witness", T(c, "site.registers.settings.witness", "Require a second-person witness and offer the shift count (hospital policy)"), nd.requireWitness) + "</div>" + note("requireWitness") +
      '<div class="row">' + input("rgS_rmiNo", T(c, "site.registers.settings.rmiNo", "Form 3G recognition number"), nd.rmi.form3gNumber) + input("rgS_rmiIssued", T(c, "site.registers.settings.rmiIssued", "Issued on"), nd.rmi.issuedOn, "date") +
      input("rgS_rmiExpires", T(c, "site.registers.settings.rmiExpires", "Valid until"), nd.rmi.expiresOn, "date") + input("rgS_rmiRenewal", T(c, "site.registers.settings.rmiRenewal", "Renewal application reference"), nd.rmi.renewalApplicationRef) + "</div>" + note("rmi") +
      area("rgS_doctors", T(c, "site.registers.settings.doctors", "Designated doctors, one per line"), lines(nd.rmi.designatedDoctors, ["name", "registrationNo", "overallInCharge", "from"]), T(c, "site.registers.settings.doctorsHint", "name | registration number | yes for the over-all in-charge | from (YYYY-MM-DD)")) +
      area("rgS_rmiChanges", T(c, "site.registers.settings.rmiChanges", "Changes to tell the Controller of Drugs, one per line"), lines(nd.rmi.changes, ["kind", "changedOn", "intimatedOn"]), T(c, "site.registers.settings.rmiChangesHint", "designated-doctor or constitution | changed on | intimated on (blank if not yet)")) +
      area("rgS_regimes", T(c, "site.registers.settings.regimes", "Which law each drug's records follow, one drug per line"), lines(nd.drugRegimes, ["drug", "regime"]), T(c, "site.registers.settings.regimesHint", "drug | end-chapter-vb (essential narcotic), state-ndps, psychotropic, schedule-x or schedule-h1")) + note("drugRegimes") +
      '<div class="row">' + box("rgS_rule65", T(c, "site.registers.settings.rule65", "Keep in-patient supplies on the Schedule X and H1 registers"), nd.rule65InpatientRegisters) + "</div>" + note("rule65InpatientRegisters") +
      area("rgS_xLocations", T(c, "site.registers.settings.xLocations", "Store locations under lock and key for Schedule X, one per line"), (nd.scheduleXLocations || []).join("\n"), T(c, "site.registers.settings.xLocationsHint", "as the location is written on the stock register")) + note("scheduleXLocations") + "</div>" +
      '<button class="btn" type="button" data-rg="save-settings"' + (S.saving ? " disabled" : "") + ">" + esc(T(c, "site.registers.settings.save", "Save register settings")) + "</button>";
  }
  function readSettings() {
    var cats = [], boxes = document.querySelectorAll("[data-mlccat]");
    for (var i = 0; i < boxes.length; i++) if (boxes[i].checked) cats.push(boxes[i].getAttribute("data-mlccat"));
    return {
      pcpndt: { formGVersion: val("rgS_formG"),
        centre: { formBNumber: val("rgS_formB"), formBValidUntil: val("rgS_formBUntil"), r17NoticeDisplayed: checked("rgS_r17"), actAndRulesOnPremises: checked("rgS_r17copies"),
          machines: parseLines("rgS_machines", ["make", "model", "serial"]), plannedChanges: parseLines("rgS_changes", ["what", "effectiveOn", "intimatedOn"]) } },
      mtp: { formIIDueDay: Number(val("rgS_f2Day")), formIIOver20Annex: checked("rgS_f2Annex") },
      mlc: { goodSamaritanCharterDisplayed: checked("rgS_charter"), intimationCategories: cats,
        stateFormat: val("rgS_stateFormat"), restrictedReaders: String(val("rgS_restricted") || "").split(/\n/).map(function (x) { return x.trim(); }).filter(Boolean) },
      rbd: { formVersion: val("rgS_rbdVersion"), informantAuthorisations: parseLines("rgS_informants", ["name", "authorisedBy", "from"]) },
      mccd: { requireIcd10: checked("rgS_icd") },
      ndps: { requireWitness: checked("rgS_witness"), rmi: { form3gNumber: val("rgS_rmiNo"), issuedOn: val("rgS_rmiIssued"), expiresOn: val("rgS_rmiExpires"), renewalApplicationRef: val("rgS_rmiRenewal"),
        designatedDoctors: parseLines("rgS_doctors", ["name", "registrationNo", "overallInCharge", "from"]), changes: parseLines("rgS_rmiChanges", ["kind", "changedOn", "intimatedOn"]) },
        drugRegimes: parseLines("rgS_regimes", ["drug", "regime"]), rule65InpatientRegisters: checked("rgS_rule65"),
        scheduleXLocations: String(val("rgS_xLocations") || "").split(/\n/).map(function (x) { return x.trim(); }).filter(Boolean) },
    };
  }

  /* ---------------------------------------------------------------------------------------------- legal requirements */
  /* How a Form F reaches the State/UT (r: the server's formFSubmission). Never "online nationwide": said per State/UT. */
  function submissionText(c, r) {
    if (!r.stateUt) return T(c, "site.legal.formf.noState", "This hospital's State/UT is not recorded (Admin > Legal requirements), so no State/UT Form F submission rule is applied. Form F itself is mandatory everywhere.");
    if (!r.configured) return T(c, "site.legal.formf.notConfigured", "Form F submission is not configured for {state}: WardSynQ requires no portal submission. Form F itself is mandatory everywhere; ask your State/UT Appropriate Authority.", { state: r.stateName });
    if (r.mode === "OFFLINE") return T(c, "site.legal.formf.offline", "In {state} Form F is submitted offline. Keep the signed record.", { state: r.stateName });
    var url = r.portalUrl || T(c, "site.legal.notConfigured", "not configured");
    var t = r.mode === "ONLINE" ? T(c, "site.legal.formf.online", "In {state} Form F is submitted online at {url}.", { state: r.stateName, url: url })
      : T(c, "site.legal.formf.portalRecord", "In {state} Form F is entered on the State portal at {url}, and the Form F record is kept.", { state: r.stateName, url: url });
    if (r.deadlineDays) t += " " + T(c, "site.legal.formf.deadline", "Due within {n} calendar days of the procedure.", { n: r.deadlineDays });
    return t + " " + (r.requiresReference ? T(c, "site.legal.formf.withRef", "An entry is complete with the portal submission date and the acknowledgement.") : T(c, "site.legal.formf.noRef", "An entry is complete with the portal submission date."));
  }
  function legalStatusText(c, q) {
    switch (q.status) {
      case "UNDER_CHALLENGE": return T(c, "site.legal.status.underChallenge", "under challenge in the Supreme Court; not stayed; enforced");
      case "STAYED": return T(c, "site.legal.status.stayed", "stayed; not enforced");
      case "STRUCK_DOWN": return T(c, "site.legal.status.struckDown", "struck down; not enforced");
      case "AMENDED": return T(c, "site.legal.status.amended", "in force as amended");
      case "STATE_SPECIFIC": return T(c, "site.legal.status.stateSpecific", "in force in this State/UT");
      default: return T(c, "site.legal.status.inForce", "in force");
    }
  }
  function appliesText(c, e) {
    if (e.applies) return T(c, "site.legal.applies.yes", "applies today");
    return { "not-yet-effective": T(c, "site.legal.applies.notYet", "not yet in force"), expired: T(c, "site.legal.applies.expired", "no longer in force"),
      stayed: T(c, "site.legal.applies.stayed", "stayed"), "struck-down": T(c, "site.legal.applies.struckDown", "struck down"),
      "state-not-set": T(c, "site.legal.applies.stateNotSet", "State/UT not recorded") }[e.reason] || T(c, "site.legal.applies.no", "does not apply");
  }
  var LEGAL_KEYS = { formF: ["mode", "deadlineDays", "portalUrl", "acknowledgementRequired"], medleapr: ["required", "effectiveFrom", "caseTypes"] };
  function legalKeyLabel(c, k) {
    return { mode: T(c, "site.legal.key.mode", "Submission mode"), deadlineDays: T(c, "site.legal.key.deadlineDays", "Deadline (calendar days after the procedure)"), portalUrl: T(c, "site.legal.key.portalUrl", "Portal address"),
      acknowledgementRequired: T(c, "site.legal.key.ack", "Acknowledgement required"), required: T(c, "site.legal.key.required", "MedLEaPR required"),
      effectiveFrom: T(c, "site.legal.key.effectiveFrom", "Required from"), caseTypes: T(c, "site.legal.key.caseTypes", "Reports it is required for") }[k] || k;
  }
  function legalValueText(c, k, v) {
    if (v == null) return T(c, "site.legal.notConfigured", "not configured");
    if (v === true) return T(c, "site.legal.yes", "yes");
    if (v === false) return T(c, "site.legal.no", "no");
    return Array.isArray(v) ? v.join(", ") : String(v);
  }
  function legalInput(c, kind, k, v, r) {
    var esc = c.esc, id = "lg_" + kind + "_" + k, blank = '<option value="">' + esc(T(c, "site.legal.notConfigured", "not configured")) + "</option>";
    var yn = function () { return '<select id="' + id + '">' + blank + '<option value="yes"' + (v === true ? " selected" : "") + ">" + esc(T(c, "site.legal.yes", "yes")) + '</option><option value="no"' + (v === false ? " selected" : "") + ">" + esc(T(c, "site.legal.no", "no")) + "</option></select>"; };
    var field;
    if (k === "mode") field = '<select id="' + id + '">' + blank + r.modes.map(function (m) { return '<option value="' + esc(m) + '"' + (m === v ? " selected" : "") + ">" + esc(m) + "</option>"; }).join("") + "</select>";
    else if (k === "acknowledgementRequired" || k === "required") field = yn();
    else if (k === "deadlineDays") field = '<input id="' + id + '" type="number" min="1" max="31" value="' + esc(v == null ? "" : v) + '">';
    else if (k === "effectiveFrom") field = '<input id="' + id + '" type="date" value="' + esc(v || "") + '">';
    else if (k === "caseTypes") return '<fieldset class="f"><legend>' + esc(legalKeyLabel(c, k)) + "</legend>" + r.caseTypes.map(function (t) { return '<label><input type="checkbox" data-lgcase="' + esc(kind) + '" value="' + esc(t) + '"' + ((v || []).indexOf(t) >= 0 ? " checked" : "") + "> " + esc(t) + "</label> "; }).join("") + "</fieldset>";
    else field = '<input id="' + id + '" value="' + esc(v || "") + '">';
    return '<label class="f"><span>' + esc(legalKeyLabel(c, k)) + "</span>" + field + "</label>";
  }
  /* r: null = loading, false = could not be loaded (said, never drawn as none), else the server's legalView. admin: Admin's
   * tab, which records the State/UT and edits the values the registry leaves to the hospital (the server refuses the rest). */
  function legalHtml(c, r, admin) {
    var esc = c.esc;
    if (r === null) return loading(c);
    if (r === false) return '<div class="msg err">' + TS(c, "site.legal.loadFailed", "The legal requirements could not be loaded. Do not read this as none applying.") + "</div>";
    var edit = admin && r.canEdit;
    var h = '<div class="card"><h3>' + esc(T(c, "site.legal.title", "Legal requirements for this hospital")) + '</h3><p class="quiet">' +
      esc(T(c, "site.legal.intro", "Each requirement WardSynQ enforces, with its source, status and dates. A requirement under challenge stays enforced unless a court has stayed it. State/UT values change only with their source; values not set for your State/UT are this hospital's to configure.")) + "</p>";
    h += r.stateUt ? "<p>" + esc(T(c, "site.legal.state", "State/UT:")) + " " + EN(c, esc(r.stateName)) + "</p>"
      : '<div class="msg err">' + esc(T(c, "site.legal.noState", "This hospital's State/UT is not recorded, so no State/UT requirement can be selected.")) + "</div>";
    if (edit) h += '<div class="row"><label class="f"><span>' + esc(T(c, "site.legal.chooseState", "State or Union Territory")) + '</span><select id="lgState"><option value="">' + esc(T(c, "site.legal.notRecorded", "not recorded")) + "</option>" +
      r.states.map(function (x) { return '<option value="' + esc(x.code) + '"' + (x.code === r.stateUt ? " selected" : "") + ">" + EN(c, esc(x.name)) + "</option>"; }).join("") +
      '</select></label><button class="btn quiet" type="button" data-lg="state">' + esc(T(c, "site.legal.saveState", "Save State/UT")) + "</button></div>";
    h += "</div>";
    ["formF", "medleapr"].forEach(function (kind) {
      var cf = r.config[kind];
      h += '<div class="card"><h3>' + esc(kind === "formF" ? T(c, "site.legal.kind.formF", "PCPNDT Form F submission") : T(c, "site.legal.kind.medleapr", "MedLEaPR for medico-legal reports")) + "</h3>";
      if (!cf.configured) h += '<div class="msg note">' + esc(T(c, "site.legal.kindNotConfigured", "Not configured for your State/UT.")) + " " + esc(kind === "formF" ? T(c, "site.legal.formF.default", "Form F is still mandatory everywhere; no portal submission is required by WardSynQ.") : T(c, "site.legal.medleapr.default", "No MedLEaPR reference is required; follow the State-prescribed medico-legal workflow.")) + "</div>";
      h += '<dl class="kv">' + LEGAL_KEYS[kind].map(function (k) {
        var src = cf.sources[k];
        return "<dt>" + esc(legalKeyLabel(c, k)) + "</dt><dd>" + EN(c, esc(legalValueText(c, k, cf.values[k]))) + ' <span class="quiet">' +
          esc(src === "registry" ? T(c, "site.legal.src.registry", "from {id}", { id: cf.requirementId }) : src === "hospital" ? T(c, "site.legal.src.hospital", "set by this hospital") : "") + "</span></dd>";
      }).join("") + "</dl>";
      if (edit && cf.editable.length) {
        h += '<div class="row">' + cf.editable.map(function (k) { return legalInput(c, kind, k, cf.sources[k] === "hospital" ? cf.values[k] : null, r); }).join("") + "</div>" +
          '<div class="row"><label class="f"><span>' + esc(T(c, "site.legal.reason", "Reason for the change (audited)")) + '</span><input id="lg_' + kind + '_reason"></label>' +
          '<button class="btn" type="button" data-lg="save" data-kind="' + kind + '">' + esc(T(c, "site.legal.save", "Save")) + "</button></div>";
      }
      h += "</div>";
    });
    h += '<div class="card"><div class="tbl"><table><tr><th>' + esc(T(c, "site.legal.col.requirement", "Requirement")) + "</th><th>" + esc(T(c, "site.legal.col.source", "Source")) + "</th><th>" + esc(T(c, "site.legal.col.jurisdiction", "Jurisdiction")) +
      "</th><th>" + esc(T(c, "site.legal.col.status", "Status")) + "</th><th>" + esc(T(c, "site.legal.col.dates", "Effective")) + "</th><th>" + esc(T(c, "site.legal.col.evidence", "Evidence")) + "</th></tr>" +
      r.requirements.map(function (q) {
        var dates = (q.effectiveFrom || T(c, "site.legal.noDate", "not stated")) + (q.expiresOn ? " " + T(c, "site.legal.until", "until {d}", { d: q.expiresOn }) : "");
        return "<tr><td>" + EN(c, esc(q.title)) + (q.mandatory ? "" : ' <span class="quiet">' + esc(T(c, "site.legal.notMandatory", "(not mandatory in itself)")) + "</span>") + "</td><td>" + EN(c, esc(q.sourceType + ": " + q.instrument + (q.provision ? ", " + q.provision : ""))) +
          (q.notes ? '<br><span class="quiet">' + EN(c, esc(q.notes)) + "</span>" : "") + "</td><td>" + esc(q.jurisdiction === "IN" ? T(c, "site.legal.india", "India") : q.jurisdiction) + "</td><td>" + esc(legalStatusText(c, q)) +
          (q.challenge ? '<br><span class="quiet">' + EN(c, esc(q.challenge.case + ", " + q.challenge.court)) + "</span>" : "") + "<br>" + esc(appliesText(c, q.enforcement)) + "</td><td>" + esc(dates) + "</td><td>" +
          q.evidence.map(function (e) { return '<a href="' + esc(e.url) + '" target="_blank" rel="noopener noreferrer">' + esc(e.kind) + "</a> " + esc(e.verified ? T(c, "site.legal.verified", "(read)") : T(c, "site.legal.unverified", "(not verified)")); }).join("<br>") + "</td></tr>";
      }).join("") + "</table></div></div>";
    return h;
  }
  /* Reads one kind's editable values from Admin's form: blank is null (clears the hospital's value). */
  function readLegal(kind, editable) {
    var out = {};
    editable.forEach(function (k) {
      if (k === "caseTypes") { var b = document.querySelectorAll('[data-lgcase="' + kind + '"]'), l = []; for (var i = 0; i < b.length; i++) if (b[i].checked) l.push(b[i].value); out[k] = l.length ? l : null; return; }
      var v = val("lg_" + kind + "_" + k);
      out[k] = v === "" ? null : (k === "acknowledgementRequired" || k === "required") ? v === "yes" : k === "deadlineDays" ? Number(v) : v;
    });
    return out;
  }
  /* Admin > Legal requirements. body: the tab's element. */
  function renderLegal(c, body) {
    var q = "?orgId=" + encodeURIComponent(c.state.orgId), r = null, msg = null;
    var paint = function () { body.innerHTML = (msg ? '<div class="msg ' + (msg.ok ? "ok" : "err") + '" role="status">' + EN(c, c.esc(msg.text)) + "</div>" : "") + legalHtml(c, r, true); };
    var load = function () { r = null; paint(); c.api("/org/legal-requirements" + q).then(function (x) { r = x && x.ok ? x : false; paint(); }, function () { r = false; paint(); }); };
    body.onclick = function (ev) {
      var b = ev.target.closest && ev.target.closest("[data-lg]"); if (!b || !r) return;
      if (b.getAttribute("data-lg") === "state") {
        b.disabled = true;
        c.api("/org/update", { orgId: c.state.orgId, regionProfile: { stateUt: val("lgState") } }).then(function (x) {
          msg = x && x.ok ? { ok: true, text: T(c, "site.legal.stateSaved", "State/UT saved.") } : { ok: false, text: refusal(c, x) };
          if (x && x.ok) c.state.org = x.org;
          load();
        });
      }
      if (b.getAttribute("data-lg") === "save") {
        var kind = b.getAttribute("data-kind");
        b.disabled = true;
        c.api("/org/legal-requirements", { orgId: c.state.orgId, kind: kind, values: readLegal(kind, r.config[kind].editable), reason: val("lg_" + kind + "_reason") }).then(function (x) {
          if (!x || !x.ok) { b.disabled = false; msg = { ok: false, text: refusal(c, x) }; paint(); return; }
          msg = { ok: true, text: T(c, "site.legal.saved", "Saved. The server now holds the values shown.") }; r = x; paint();
        });
      }
    };
    load();
  }
  WSQ._legal = { html: legalHtml, submissionText: submissionText, render: renderLegal, read: readLegal };

  /* ---------------------------------------------------------------------------------------------- render + actions */
  WSQ.page("registers", { render: function (c) {
    var el = c.el, esc = c.esc, org = c.state.orgId, list = tabs(c);
    if (!S.period) S.period = thisMonth();
    if (!S.week) S.week = lastMonday();
    if (!S.year) S.year = String(new Date().getUTCFullYear());
    if (!list.length) { el.innerHTML = '<div class="title"><h1>' + esc(T(c, "site.registers.heading", "Registers")) + '</h1></div><div class="msg note">' + TS(c, "site.registers.noAccess", "Your role keeps none of the statutory registers.") + "</div>"; return; }
    if (!list.some(function (t) { return t.key === S.tab; })) { S.tab = list[0].key; S.data = null; S.form = null; S.entry = null; S.extra = null; }
    /* A nurse's NDPS tab is the one patient view (legal review F.4.10). */
    if (S.tab === "ndps" && !subKinds(c).ndps.some(function (o) { return o[0] === S.sub.ndps; })) S.sub.ndps = subKinds(c).ndps[0][0];
    var q = "?orgId=" + encodeURIComponent(org);
    var paint = function () {
      el.innerHTML = '<div class="title"><h1>' + esc(T(c, "site.registers.heading", "Registers")) + "</h1></div>" +
        '<div class="tabs" role="tablist">' + list.map(function (t) { return '<button type="button" role="tab" data-rg="tab" data-id="' + t.key + '" aria-selected="' + (t.key === S.tab) + '">' + esc(t.title) + "</button>"; }).join("") + "</div>" +
        (S.msg ? '<div class="msg ' + (S.msg.ok ? "ok" : "err") + '" role="status">' + EN(c, esc(S.msg.text)) + "</div>" : "") +
        (S.tab === "settings" ? settingsHtml(c) : S.tab === "legal" ? legalHtml(c, S.legal, false) : registerHtml(c));
      if (S.form && S.schemas && S.schemas[S.form.kind || kindNow()] && S.schemas[S.form.kind || kindNow()].definitions) {
        var sel = document.getElementById("rgF_condition"), dbox = document.getElementById("rgDefs");
        var draw = function () { var d = S.schemas[kindNow()].definitions.filter(function (x) { return sel && x.key === sel.value; })[0]; if (dbox) dbox.innerHTML = d ? esc(T(c, "site.registers.ihip.defP", "Presumptive (P form):")) + " " + EN(c, esc(d.presumptive)) + (d.confirmed ? " " + esc(T(c, "site.registers.ihip.defL", "Laboratory confirmed (L form):")) + " " + EN(c, esc(d.confirmed)) : "") : ""; };
        if (sel) sel.onchange = draw; draw();
      }
    };
    var load = function () {
      S.data = null; S.extra = null; paint();
      if (S.tab === "legal") { S.legal = null; paint(); return c.api("/org/legal-requirements" + q).then(function (r) { S.legal = r && r.ok ? r : false; paint(); }, function () { S.legal = false; paint(); }); }
      if (S.tab === "settings") { S.settings = null; paint(); return c.api("/org/register-settings" + q).then(function (r) { S.settings = r && r.ok ? r : false; paint(); }); }
      if (S.tab === "ndps" && S.sub.ndps === "book") { var mr = monthRange(S.period); return c.api("/ward/register-ndps" + q + "&from=" + mr.from + "&to=" + mr.to).then(function (r) { S.data = r || { ok: false }; paint(); }); }
      if (S.tab === "ndps" && S.sub.ndps === "annual") return c.api("/ward/register-ndps" + q + "&view=annual&year=" + encodeURIComponent(S.year)).then(function (r) { S.data = r || { ok: false }; paint(); });
      if (S.tab === "ndps" && (S.sub.ndps === "h1" || S.sub.ndps === "schedx")) { var hr = monthRange(S.period); return c.api("/ward/register-ndps" + q + "&view=" + S.sub.ndps + "&from=" + hr.from + "&to=" + hr.to).then(function (r) { S.data = r || { ok: false }; paint(); }); }
      if (S.tab === "ndps" && S.sub.ndps === "patient") { if (!S.ndpsPatient) { S.data = null; paint(); return; } return c.api("/ward/register-ndps" + q + "&view=patient&patientId=" + encodeURIComponent(S.ndpsPatient)).then(function (r) { S.data = r || { ok: false }; paint(); }); }
      if (S.tab === "ndps" && S.sub.ndps === "form3eview") { if (!S.ndpsPatient) { S.data = null; paint(); return; } return c.api("/ward/register-ndps" + q + "&view=form3e&patientId=" + encodeURIComponent(S.ndpsPatient)).then(function (r) { S.data = r || { ok: false }; paint(); }); }
      if (!canList(c)) { paint(); return; }
      return c.api(listPath(q, kindNow())).then(function (r) { S.data = r || { ok: false }; paint(); });
    };
    var schemas = function () {
      if (S.schemas) return load();
      c.api("/ward/register-schema" + q).then(function (r) {
        if (!r || !r.ok) { S.schemas = false; paint(); return; }
        S.schemas = {}; S.notes = r.notes || {}; r.schemas.forEach(function (s) { S.schemas[s.kind] = s; }); load();
      });
    };
    paint(); schemas();

    var authQuery = function () {
      if (S.tab === "mlc") return "&requisitionFrom=" + encodeURIComponent(val("rgReqfrom")) + "&requisitionRef=" + encodeURIComponent(val("rgReqref")) + "&requisitionDate=" + encodeURIComponent(val("rgReqdate"));
      return S.tab === "mtp" ? "&authorityOfficer=" + encodeURIComponent(val("rgAuthofficer")) + "&authorityLaw=" + encodeURIComponent(val("rgAuthlaw")) + "&authorityReference=" + encodeURIComponent(val("rgAuthreference")) : "";
    };
    el.onclick = function (ev) {
      var b = ev.target.closest && ev.target.closest("[data-rg]"); if (!b) return;
      var act = b.getAttribute("data-rg"), id = b.getAttribute("data-id"), kind = kindNow(), schema = S.schemas && S.schemas[kind];
      S.msg = null;
      if (act === "tab") { S.tab = id; S.form = null; S.entry = null; return schemas(); }
      if (act === "load") {
        S.period = val("rgPeriod") || S.period; S.week = val("rgWeek") || S.week; S.year = val("rgYear") || S.year;
        var vk = val("rgVitalKind"); if (vk) S.vitalKind = vk;
        var sk = val("rgSubKind"); if (sk && S.sub[S.tab] !== undefined) S.sub[S.tab] = sk;
        if (document.getElementById("rgNdpsPatient")) S.ndpsPatient = val("rgNdpsPatient");
        S.form = null; S.entry = null; return load();
      }
      if (act === "new") { S.form = { kind: kind, fields: {}, allowReturns: RETURNS[S.tab] }; return paint(); }
      if (act === "new-kind") { S.form = { kind: b.getAttribute("data-kind"), fields: { year: Number(S.year) } }; return paint(); }
      if (act === "new-return") { S.form = { kind: "statreturn", allowReturns: RETURNS[S.tab], fields: { returnKind: RETURNS[S.tab][RETURNS[S.tab].length - 1], period: b.getAttribute("data-period") || S.year } }; return paint(); }
      if (act === "reg3e") { S.form = { kind: "form3e", patientId: id, fields: {}, note: T(c, "site.registers.ndps.reg3eNote", "Registers the patient named on the supply. Nothing else about the patient is read.") }; return paint(); }
      if (act === "sign3e" && S.data && S.data.ok) {
        var row = S.data.rows.filter(function (x) { return x.dispenseId === id; })[0];
        S.form = { kind: "form3esign", patientId: S.data.patientId, fields: { form3eId: S.data.registration.id, dispenseId: id, date: row.date, drug: row.drug, quantity: row.quantity } }; return paint();
      }
      if (act === "prep3i" && S.data && S.data.ok) { var x3 = S.data.form3i[Number(id)]; S.form = { kind: "form3i", fields: { year: S.data.year, drug: x3.drug, unit: x3.unit, preparedOn: new Date().toISOString().slice(0, 10) } }; return paint(); }
      if (act === "mlcpatient") { S.data = null; return c.api("/ward/mlc-patient", { orgId: org, mrn: val("rgLookupMrn") }).then(function (r) { S.data = r || { ok: false }; paint(); }); }
      if (act === "cancel" || act === "close") { S.form = null; S.entry = null; return paint(); }
      if (act === "open" || act === "open-kind") {
        var ok = act === "open-kind" ? b.getAttribute("data-kind") : kind; if (act === "open-kind") S.vitalKind = ok;
        S.entry = null; S.extra = null; paint();
        var p = S.tab === "vital" ? "/ward/register-vital" + q + "&kind=" + ok + "&id=" + encodeURIComponent(id) : S.tab === "ihip" ? "/ward/register-notification" + q + "&id=" + encodeURIComponent(id) : S.tab === "ndps" ? "/ward/register-ndps" + q + "&view=list&kind=" + ok + "&id=" + encodeURIComponent(id) : DOOR[S.tab] + q + "&kind=" + ok + "&id=" + encodeURIComponent(id);
        return c.api(p).then(function (r) { S.entry = r || { ok: false }; paint(); });
      }
      if (act === "correct" && S.entry && S.entry.ok) { var e = S.entry.entry; S.form = { kind: kind, id: e.id, expectedVersion: e.version, fields: e.fields, allowReturns: RETURNS[S.tab] }; S.entry = null; return paint(); }
      if (act === "save" && S.form && !S.saving) {
        var fk = S.form.kind || kind, fschema = S.schemas[fk];
        var body = { orgId: org, kind: fk, fields: readForm(fschema), idempotencyKey: "rg-" + Date.now() + "-" + Math.random().toString(36).slice(2) };
        if (S.form.id) { body.id = S.form.id; body.expectedVersion = S.form.expectedVersion; body.reason = val("rgReason"); }
        else { if (S.form.patientId) body.patientId = S.form.patientId; else if (val("rgMrn")) body.mrn = val("rgMrn"); if (S.form.deliveryId) body.deliveryId = S.form.deliveryId; if (val("rgSr")) body.serviceRequestId = val("rgSr"); if (val("rgEnc")) body.encounterId = val("rgEnc"); }
        S.saving = true; paint();
        return c.api(postDoor(fk), body).then(function (r) {
          S.saving = false;
          if (!r || !r.ok) { S.msg = { ok: false, text: refusal(c, r) }; return paint(); }
          var said = [r.entry.complete ? T(c, "site.registers.saved", "Saved to the register as {n}.", { n: r.entry.serial || r.entry.id }) : T(c, "site.registers.savedIncomplete", "Saved as {n}, but incomplete. Missing: {list}", { n: r.entry.serial || r.entry.id, list: (r.entry.missing || []).join(", ") })];
          [r.warnings && r.warnings.join(" "), r.freeTreatment, r.pocso, r.mlcPrompt].forEach(function (t) { if (t) said.push(t); });
          S.msg = { ok: true, text: said.join(" ") };
          S.form = null; return load();
        }, function () { S.saving = false; S.msg = { ok: false, text: T(c, "site.registers.noResponse", "No response from the server.") }; paint(); });
      }
      if (act === "csv" || act === "print") {
        var path2 = S.tab === "vital" ? "/ward/register-vital" + q + "&kind=" + kind + "&period=" + S.period + "&format=csv" : S.tab === "ihip" ? "/ward/register-notification" + q + "&week=" + S.week + "&format=csv"
          : S.tab === "ndps" ? "/ward/register-ndps" + q + "&view=list&kind=" + kind + "&period=" + S.period + "&format=csv" : DOOR[S.tab] + q + "&kind=" + kind + "&period=" + S.period + "&format=csv" + authQuery();
        return c.api(path2).then(function (r) {
          if (!r || !r.ok || !r.csv) { S.msg = { ok: false, text: refusal(c, r) }; return paint(); }
          if (act === "csv") { saveCsv(r.filename, r.csv); S.msg = { ok: true, text: T(c, "site.registers.exported", "Exported {n} rows. Submission is manual.", { n: r.rows != null ? r.rows : (r.entries || []).length }) }; return paint(); }
          var rows = csvToRows(r.csv);
          if (!printTable(schema.title + " " + (S.tab === "ihip" ? S.week : S.period), rows[0] || [], rows.slice(1))) { S.msg = { ok: false, text: T(c, "site.registers.popupBlocked", "The print window was blocked. Allow pop-ups for this site and try again.") }; paint(); }
        });
      }
      if (act === "form2") { S.extra = { what: "form2", loading: true }; paint(); return c.api("/ward/register-mtp" + q + "&period=" + S.period + "&format=form2").then(function (r) { S.extra = { what: "form2", r: r }; paint(); }); }
      if (act === "monthly") { S.extra = { what: "monthly", loading: true }; paint(); return c.api("/ward/register-formf" + q + "&period=" + S.period + "&format=monthly").then(function (r) { S.extra = { what: "monthly", r: r }; paint(); }); }
      if (act === "monthly-csv" && S.extra && S.extra.r && S.extra.r.ok) { saveCsv(S.extra.r.filename, S.extra.r.csv); return; }
      if (act === "print-formf" && S.entry && S.entry.ok) {
        return c.api("/ward/register-formf" + q + "&id=" + encodeURIComponent(S.entry.entry.id) + "&format=print").then(function (r) {
          if (!r || !r.ok) { S.msg = { ok: false, text: refusal(c, r) }; return paint(); }
          var fschema = S.schemas.formf;
          var rows = fschema.fields.map(function (fd) { return [fd.label, textOf(fd, r.entry.fields[fd.key])]; }).filter(function (x) { return x[1]; })
            .concat([[T(c, "site.registers.formf.printId", "Print id"), r.printId], [T(c, "site.registers.formf.hash", "SHA-256 fingerprint"), r.hash], [T(c, "site.registers.formf.authSign", "Authenticated by (signature, name, registration number, seal, date)"), ""]]);
          if (!printTable(fschema.title + " " + (r.entry.serial || ""), [T(c, "site.registers.field", "Field"), T(c, "site.registers.value", "Value")], rows)) { S.msg = { ok: false, text: T(c, "site.registers.popupBlocked", "The print window was blocked. Allow pop-ups for this site and try again.") }; return paint(); }
          S.sub.formf = "formfprint"; S.entry = null;
          S.form = { kind: "formfprint", fields: { formFId: r.entry.id, formFVersion: r.entry.version, printHash: r.hash, authenticatedOn: new Date().toISOString().slice(0, 10) }, note: r.authenticate };
          paint();
        });
      }
      if (act === "gs-letter" && S.entry && S.entry.ok) {
        var ef = S.entry.entry.fields;
        if (!printTable(T(c, "site.registers.mlc.gsTitle", "Acknowledgement to a Good Samaritan (Central Motor Vehicles Rules r.168(4))"), [T(c, "site.registers.field", "Field"), T(c, "site.registers.value", "Value")], [
          [T(c, "site.registers.mlc.gsHospital", "Hospital"), c.state.org && c.state.org.name || ""], [T(c, "site.registers.mlc.gsWhen", "Date and time"), String(ef.arrivalAt || "").slice(0, 16).replace("T", " ")],
          [T(c, "site.registers.mlc.gsWho", "Name and address (only if the Good Samaritan chose to give them)"), ef.broughtBy || ""],
          [T(c, "site.registers.mlc.gsStatement", "Statement"), T(c, "site.registers.mlc.gsText", "This hospital acknowledges that the person named above brought an injured person to the hospital. No personal information, fee or procedure was required of them.")]])) {
          S.msg = { ok: false, text: T(c, "site.registers.popupBlocked", "The print window was blocked. Allow pop-ups for this site and try again.") }; paint();
        }
        return;
      }
      if (act === "pending") { S.extra = { what: "pending", loading: true }; paint(); return c.api("/ward/register-vital" + q + "&kind=" + kind + "&period=" + S.period + "&pending=1").then(function (r) { S.extra = { what: "pending", r: r }; paint(); }); }
      if (act === "prefill") {
        var pk = b.getAttribute("data-kind");
        return c.api("/ward/register-vital" + q + "&kind=" + pk + "&prefill=" + encodeURIComponent(id)).then(function (r) {
          if (!r || !r.ok) { S.msg = { ok: false, text: refusal(c, r) }; return paint(); }
          S.vitalKind = pk; S.extra = null; S.form = { kind: pk, fields: r.fields, patientId: r.patientId, deliveryId: r.deliveryId || null, note: r.note }; paint();
        });
      }
      if (act === "kerala") {
        return c.api(DOOR.mlc + q + "&kind=mlc&period=" + S.period + "&format=kerala" + authQuery()).then(function (r) {
          if (!r || !r.ok || !r.csv) { S.msg = { ok: false, text: refusal(c, r) }; return paint(); }
          saveCsv(r.filename, r.csv); S.msg = { ok: true, text: T(c, "site.registers.exported", "Exported {n} rows. Submission is manual.", { n: r.rows }) }; paint();
        });
      }
      if (act === "closeday" && S.data && S.data.ok) {
        var ci = String(id).split(":"), cit = S.data.items[Number(ci[0])], cday = cit && cit.form3h[Number(ci[1])];
        if (!cday) return;
        return c.api("/ward/register-ndps", { orgId: org, kind: "form3hclose", fields: { day: cday.date, drug: cit.code, unit: cit.unit, location: cit.location || undefined, closedBy: val("rgClose_" + ci[0]) }, idempotencyKey: "rgh-" + Date.now() }).then(function (r) {
          S.msg = r && r.ok ? { ok: true, text: T(c, "site.registers.ndps.dayClosedSaved", "Day {d} closed on page {p}.", { d: cday.date, p: r.entry.serial }) } : { ok: false, text: refusal(c, r) };
          return load();
        });
      }
      if (act === "receive" || act === "transfer") {
        var pre = act === "receive" ? "rgR_" : "rgT_";
        var mv = { orgId: org, kind: act === "receive" ? "receipt" : "transfer-out", code: val(pre + "code"), quantity: { value: Number(val(pre + "quantity")), unit: val(pre + "unit") }, location: val(pre + "location") || undefined, batch: val(pre + "batch") || undefined, idempotencyKey: "rg" + act + "-" + Date.now() };
        if (act === "receive") ["expiry", "receivedFrom", "documentNo", "supplierAddress", "supplierLicenceNo", "manufacturer", "revisedEstimateRef"].forEach(function (k) { if (val(pre + k)) mv[k] = val(pre + k); });
        else ["toInstitution", "controllerApprovalRef", "transferKind"].forEach(function (k) { if (val(pre + k)) mv[k] = val(pre + k); });
        return c.api("/ward/stock-move", mv).then(function (r) {
          S.msg = r && r.ok ? { ok: true, text: act === "receive" ? T(c, "site.registers.ndps.received", "The receipt is recorded on the register.") + (r.estimateWarning ? " " + r.estimateWarning : "") : T(c, "site.registers.ndps.transferred", "The transfer is recorded on the register.") } : { ok: false, text: refusal(c, r) };
          return load();
        });
      }
      if (act === "homecare" && S.data && S.data.ok) { S.form = { kind: "homecare", patientId: S.data.patientId, fields: { dispenseId: id, issuedOn: b.getAttribute("data-date") } }; return paint(); }
      if (act === "schedx") { S.form = { kind: "schedxsupply", patientId: b.getAttribute("data-patient"), fields: { dispenseId: id, date: b.getAttribute("data-date") } }; return paint(); }
      if (act === "count") {
        return c.api("/ward/register-ndps", { orgId: org, code: val("rgC_code"), unit: val("rgC_unit"), location: val("rgC_location"), counted: val("rgC_counted"), shift: val("rgC_shift"), witnessId: val("rgC_witness"), note: val("rgC_note"), idempotencyKey: "rgc-" + Date.now() }).then(function (r) {
          S.msg = r && r.ok ? { ok: !r.discrepancy, text: r.note } : { ok: false, text: refusal(c, r) };
          return load();
        });
      }
      if (act === "destroy") {
        return c.api("/ward/stock-move", { orgId: org, kind: "wastage", code: val("rgD_code"), quantity: { value: Number(val("rgD_quantity")), unit: val("rgD_unit") }, location: val("rgD_location") || undefined, batch: val("rgD_batch") || undefined,
          reason: DESTRUCTION_REASON, witnessId: val("rgD_witness") || undefined, idempotencyKey: "rgd-" + Date.now(),
          destruction: { nomineeName: val("rgD_nomineeName"), nomineeDesignation: val("rgD_nomineeDesignation"), nominatingOrderRef: val("rgD_nominatingOrderRef"), destroyedOn: val("rgD_destroyedOn") } }).then(function (r) {
          S.msg = r && r.ok ? { ok: true, text: T(c, "site.registers.ndps.destroyed", "The destruction is recorded on the register.") } : { ok: false, text: refusal(c, r) };
          return load();
        });
      }
      if (act === "save-settings" && !S.saving) {
        S.saving = true; paint();
        return c.api("/org/register-settings", { orgId: org, settings: readSettings() }).then(function (r) {
          S.saving = false;
          if (!r || !r.ok) { S.msg = { ok: false, text: refusal(c, r) }; return paint(); }
          S.settings = r; S.msg = { ok: true, text: r.changed.length ? T(c, "site.registers.settings.saved", "Saved: {list}. The server now holds what is shown.", { list: r.changed.map(function (k) { return { pcpndt: T(c, "site.registers.settings.pcpndt", "PCPNDT"), mtp: T(c, "site.registers.tab.mtp", "MTP"), mlc: T(c, "site.registers.tab.mlc", "Medico-legal cases"), rbd: T(c, "site.registers.tab.vital", "Births and deaths"), mccd: T(c, "site.registers.vital.mccd", "Cause of death certificates (Form 4/4A)"), ndps: T(c, "site.registers.tab.ndps", "Controlled drugs (NDPS)") }[k] || k; }).join(", ") }) : T(c, "site.registers.settings.unchanged", "Nothing had changed.") };
          paint();
        }, function () { S.saving = false; S.msg = { ok: false, text: T(c, "site.registers.noResponse", "No response from the server.") }; paint(); });
      }
      if ((act === "print3h" || act === "csv3h") && S.data && S.data.ok) {
        var head = [T(c, "site.registers.ndps.h.drug", "Name of drug"), T(c, "site.registers.ndps.h.date", "Date"), T(c, "site.registers.ndps.h.opening", "Opening stock"), T(c, "site.registers.ndps.h.received", "Quantity received"), T(c, "site.registers.ndps.h.from", "Received from"), T(c, "site.registers.ndps.h.doc", "Consignment note / bill / invoice no."), T(c, "site.registers.ndps.h.dispensed", "Quantity dispensed"), T(c, "site.registers.ndps.h.patients", "Patient registration no. and quantity"), T(c, "site.registers.ndps.h.closing", "Closing stock")];
        var rows3 = [];
        S.data.items.forEach(function (it) { it.form3h.forEach(function (d) { rows3.push([it.display + " (" + it.unit + (it.location ? ", " + it.location : "") + ")", d.date, d.opening, d.received, d.receivedFrom.join("; "), d.documents.join("; "), d.dispensed, d.toPatients.map(function (p) { return (p.form3e || p.patientId || "") + ": " + p.quantity; }).join("; "), d.closing]); }); });
        if (act === "csv3h") { saveCsv("ndps-form-3h-" + S.period + ".csv", [head].concat(rows3).map(function (r) { return r.map(function (x) { var s = String(x == null ? "" : x); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(","); }).join("\r\n") + "\r\n"); return; }
        if (!printTable(T(c, "site.registers.ndps.form3hTitle", "NDPS Form 3H, {period}", { period: S.period }), head, rows3)) { S.msg = { ok: false, text: T(c, "site.registers.popupBlocked", "The print window was blocked. Allow pop-ups for this site and try again.") }; paint(); }
      }
    };
  } });

  WSQ._registers = { formHtml: formHtml, readForm: readForm, entriesTable: entriesTable, ndpsHtml: ndpsHtml, rule65Html: rule65Html, ndpsPatientHtml: ndpsPatientHtml, entryHtml: entryHtml, state: S, csvToRows: csvToRows, settingsHtml: settingsHtml, readSettings: readSettings, clockText: clockText, statusHtml: statusHtml, annualHtml: annualHtml, form3eViewHtml: form3eViewHtml };
})();
