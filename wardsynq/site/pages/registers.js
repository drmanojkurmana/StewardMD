/* wardsynq/site/pages/registers.js - "Registers": the hospital's statutory registers (functions/_wardsynq/registers.js,
 * controlled-drugs.js, notifiable.js, register-routes.js). Buildless ES5, registers onto WSQ.
 *
 * Each tab is shown to the people whose role keeps that register; the server refuses everyone else whatever this page
 * shows. A register that failed to load says so and is never drawn as empty. The field labels of a statutory form come
 * from the server in English, as the form is filed (they are legal text, like an English printout); the page around
 * them is translated. Nothing here sends anything to an authority: exports are files for a person to submit.
 */
(function () {
  "use strict";
  var WSQ = window.WSQ;
  function T(c, key, en, vars) { return c && c.t ? c.t(key, vars, en) : String(en).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? String(vars[k]) : m; }); }
  function TS(c, key, en, vars) { return c && c.tSafe ? c.tSafe(key, vars, en) : String(T(c, key, en, vars)).replace(/[&<>"']/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]; }); }
  function EN(c, html) { return c && c.en ? c.en(html) : html; }
  function val(id) { var e = document.getElementById(id); return e ? String(e.value || "").trim() : ""; }

  var S = { tab: "", period: "", vitalKind: "birth", week: "", schemas: null, data: null, entry: null, form: null, msg: null, extra: null };

  function tabs(c) {
    return [
      { key: "ndps", need: ["register.ndps"], title: T(c, "site.registers.tab.ndps", "Controlled drugs (NDPS)") },
      { key: "formf", need: ["register.pcpndt"], title: T(c, "site.registers.tab.formf", "PCPNDT Form F") },
      { key: "mlc", need: ["register.records", "mlc.record"], title: T(c, "site.registers.tab.mlc", "Medico-legal cases") },
      { key: "mtp", need: ["register.mtp"], title: T(c, "site.registers.tab.mtp", "MTP") },
      { key: "vital", need: ["register.records", "emr.treat"], title: T(c, "site.registers.tab.vital", "Births and deaths") },
      { key: "ihip", need: ["register.ihip", "emr.treat"], title: T(c, "site.registers.tab.ihip", "Notifiable diseases") },
    ].filter(function (t) { return t.need.some(function (n) { return c.can(n); }); });
  }
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

  /* ---------------------------------------------------------------------------------------------- values */
  function show(c, fd, v) {
    if (v == null || v === "") return "";
    if (fd && fd.type === "attest") return EN(c, c.esc(v.name)) + ' <span class="quiet">(' + c.esc(T(c, "site.registers.attested", "attested {at}", { at: String(v.at || "").slice(0, 16).replace("T", " ") })) + ")</span>";
    if (fd && (fd.type === "enum" || fd.type === "multi")) {
      var list = Object.prototype.toString.call(v) === "[object Array]" ? v : [v];
      return EN(c, c.esc(list.map(function (x) { var o = (fd.options || []).filter(function (p) { return p[0] === x; })[0]; return o ? o[1] : x; }).join("; ")));
    }
    if (fd && fd.type === "list") return EN(c, c.esc((v || []).map(function (row) { return fd.row.map(function (s) { return row[s.key]; }).filter(Boolean).join(", "); }).join(" | ")));
    return EN(c, c.esc(String(v)));
  }
  function fieldOf(schema, key) { return (schema.fields || []).filter(function (f) { return f.key === key; })[0] || null; }

  /* ---------------------------------------------------------------------------------------------- the form */
  function inputHtml(c, fd, v) {
    var id = "rgF_" + fd.key, esc = c.esc;
    if (fd.server) return "";
    if (fd.type === "longtext") return '<textarea id="' + id + '" rows="3">' + esc(v || "") + "</textarea>";
    if (fd.type === "enum") return '<select id="' + id + '"><option value=""></option>' + fd.options.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === v ? " selected" : "") + ">" + EN(c, esc(o[1])) + "</option>"; }).join("") + "</select>";
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
      : (schema.patient !== "none" ? '<div class="row"><label class="f"><span>' + esc(T(c, "site.registers.mrn", "Patient hospital number (MRN)")) + '</span><input id="rgMrn" value="' + esc(form.mrn || "") + '"' + (form.patientId ? " disabled" : "") + "></label>" +
        (form.patientId ? '<span class="quiet">' + esc(T(c, "site.registers.patientFromRecord", "Patient taken from the record.")) + "</span>" : "") +
        (schema.kind === "formf" ? '<label class="f"><span>' + esc(T(c, "site.registers.srId", "Imaging request id (links this Form F to the ultrasound order)")) + '</span><input id="rgSr" value="' + esc(form.serviceRequestId || "") + '"></label>' : "") +
        (schema.kind === "mlc" ? '<label class="f"><span>' + esc(T(c, "site.registers.encId", "Stay (encounter) id, if admitted or in the ED")) + '</span><input id="rgEnc"></label>' : "") + "</div>" : "");
    var defs = schema.definitions ? '<div id="rgDefs" class="quiet"></div>' : "";
    var fields = (schema.fields || []).filter(function (f) { return !f.server; }).map(function (fd) {
      return '<label class="f"><span>' + EN(c, esc(fd.label)) + (fd.req ? " *" : "") + "</span>" + inputHtml(c, fd, v[fd.key]) + "</label>";
    }).join("");
    return '<div class="card"><h3>' + EN(c, esc(schema.title)) + "</h3>" + (form.note ? '<div class="msg note">' + EN(c, esc(form.note)) + "</div>" : "") +
      (schema.statutoryForm ? "" : '<div class="msg note">' + TS(c, "site.registers.notStatutory", "These fields are the hospital's own record, not a statutory form.") + "</div>") +
      '<p class="quiet">' + EN(c, esc(schema.citation)) + "</p>" + head + defs + fields +
      '<p class="quiet">' + esc(T(c, "site.registers.requiredNote", "Fields marked * are needed for the entry to be complete. An incomplete entry is saved and listed as incomplete.")) + "</p>" +
      '<button class="btn" type="button" data-rg="save">' + esc(T(c, "site.registers.save", "Save to the register")) + '</button> <button class="btn quiet" type="button" data-rg="cancel">' + esc(T(c, "site.registers.cancel", "Cancel")) + "</button></div>";
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
      if (fd.type === "list") {
        var n = Number(val("rgF_" + fd.key)) || 0, rows = [];
        for (var r = 0; r < n; r++) { var row = {}, any = false; fd.row.forEach(function (s) { var x = val("rgL_" + fd.key + "_" + r + "_" + s.key); if (x) { row[s.key] = x; any = true; } }); if (any) rows.push(row); }
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
  function entriesTable(c, schema, r) {
    var esc = c.esc;
    if (r == null) return loading(c);
    if (!r.ok) return failedBox(c) + '<div class="msg err">' + EN(c, esc(refusal(c, r))) + "</div>";
    var warn = r.truncated ? '<div class="msg note">' + EN(c, esc(r.truncatedWarning)) + "</div>" : "";
    if (!r.entries.length) return warn + "<p>" + esc(T(c, "site.registers.noEntries", "No entries in this register for this period.")) + "</p>";
    var cols = (schema.listColumns || []).map(function (k) { return fieldOf(schema, k); }).filter(Boolean);
    return warn + '<div class="tbl"><table><tr><th>' + esc(T(c, "site.registers.colNumber", "Number")) + "</th>" + cols.map(function (fd) { return "<th>" + EN(c, esc(fd.label)) + "</th>"; }).join("") +
      "<th>" + esc(T(c, "site.registers.colComplete", "Complete")) + "</th><th>" + esc(T(c, "site.registers.colVersion", "Version")) + "</th><th></th></tr>" +
      r.entries.map(function (e) {
        return "<tr" + (e.complete ? "" : ' class="warn"') + "><td>" + EN(c, esc(e.serial || e.id)) + "</td>" + cols.map(function (fd) { return "<td>" + show(c, fd, e.fields[fd.key]) + "</td>"; }).join("") +
          "<td>" + esc(e.complete ? T(c, "site.registers.yes", "yes") : T(c, "site.registers.incomplete", "incomplete")) + "</td><td>" + esc(e.version) + (e.correction ? " " + esc(T(c, "site.registers.corrected", "corrected")) : "") +
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
    return '<div class="card"><h3>' + EN(c, esc(e.serial || e.id)) + "</h3>" + (e.complete ? "" : '<div class="msg note">' + esc(T(c, "site.registers.missing", "Incomplete. Missing: {list}", { list: (e.missing || []).join(", ") })) + "</div>") +
      '<dl class="kv">' + body + "</dl><h4>" + esc(T(c, "site.registers.history", "History")) + "</h4><ul>" + hist + "</ul>" +
      '<button class="btn" type="button" data-rg="correct">' + esc(T(c, "site.registers.correct", "Correct this entry")) + '</button> <button class="btn quiet" type="button" data-rg="close">' + esc(T(c, "site.registers.close", "Close")) + "</button></div>";
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

  /* ---------------------------------------------------------------------------------------------- tab bodies */
  var KIND = { formf: "formf", mlc: "mlc", mtp: "mtp", ihip: "notification" };
  var SUB = { formf: "/ward/register-formf", mlc: "/ward/register-mlc", mtp: "/ward/register-mtp", birth: "/ward/register-vital", death: "/ward/register-vital", stillbirth: "/ward/register-vital", mccd: "/ward/register-mccd", notification: "/ward/register-notification" };
  function kindNow() { return S.tab === "vital" ? S.vitalKind : KIND[S.tab]; }
  function canList(c) {
    if (S.tab === "mlc" || S.tab === "vital") return c.can("register.records");
    if (S.tab === "ihip") return c.can("register.ihip");
    return true;
  }

  function ndpsHtml(c) {
    var esc = c.esc, r = S.data;
    var countForm = '<div class="card"><h3>' + esc(T(c, "site.registers.ndps.countTitle", "Record a shift count")) + '</h3><div class="row">' +
      ["code", "unit", "location", "counted", "shift", "witness", "note"].map(function (k) {
        var label = { code: T(c, "site.registers.ndps.code", "Drug (code or name as in the stock register)"), unit: T(c, "site.registers.ndps.unit", "Unit"), location: T(c, "site.registers.ndps.location", "Location (blank for the main store)"),
          counted: T(c, "site.registers.ndps.counted", "Quantity counted"), shift: T(c, "site.registers.ndps.shift", "Shift"), witness: T(c, "site.registers.ndps.witness", "Witness staff ID (second person)"), note: T(c, "site.registers.ndps.note", "Note") }[k];
        return '<label class="f"><span>' + esc(label) + '</span><input id="rgC_' + k + '"' + (k === "counted" ? ' type="number" min="0" step="any"' : "") + "></label>";
      }).join("") + '<button class="btn" type="button" data-rg="count">' + esc(T(c, "site.registers.ndps.saveCount", "Save count")) + "</button></div>" +
      '<p class="quiet">' + esc(T(c, "site.registers.ndps.countNote", "The server works out what the register holds. A count never changes stock: a difference is flagged for the pharmacist to investigate.")) + "</p></div>";
    if (r == null) return loading(c) + countForm;
    if (!r.ok) return failedBox(c) + '<div class="msg err">' + EN(c, esc(refusal(c, r))) + "</div>" + countForm;
    if (!r.configured) return '<div class="msg note">' + EN(c, esc(r.message)) + "</div>";
    var head = '<div class="msg note">' + EN(c, esc(r.policy)) + "</div>" + (r.truncated ? '<div class="msg err">' + EN(c, esc(r.truncatedWarning)) + "</div>" : "") +
      "<p>" + esc(T(c, "site.registers.ndps.summary", "{items} items, {unwitnessed} unwitnessed events, {discrepancies} count discrepancies", { items: r.items.length, unwitnessed: r.unwitnessed, discrepancies: r.discrepancies })) +
      ' <button class="btn quiet" type="button" data-rg="print3h">' + esc(T(c, "site.registers.ndps.print3h", "Print Form 3H")) + '</button> <button class="btn quiet" type="button" data-rg="csv3h">' + esc(T(c, "site.registers.exportCsv", "Export CSV")) + "</button></p>";
    var items = r.items.map(function (it) {
      var lines = it.lines.map(function (l) {
        return "<tr" + (l.unwitnessed || l.balanceAfter < 0 ? ' class="warn"' : "") + "><td>" + EN(c, esc(String(l.at).slice(0, 16).replace("T", " "))) + "</td><td>" + EN(c, esc(l.kind)) + "</td><td>" + esc(l.quantity) + "</td><td>" + esc(l.balanceAfter) +
          "</td><td>" + EN(c, esc(l.patientId || "")) + "</td><td>" + EN(c, esc(l.by || "")) + "</td><td>" + (l.witnessedBy ? EN(c, esc(l.witnessedBy)) : l.needsWitness ? esc(T(c, "site.registers.ndps.noWitness", "no witness")) : "") + "</td><td>" + EN(c, esc(l.reason || l.receivedFrom || "")) + "</td></tr>";
      }).join("");
      return '<div class="card"><h3>' + EN(c, esc(it.display + (it.location ? " (" + it.location + ")" : "") + ", " + it.unit)) + "</h3><p>" + esc(T(c, "site.registers.ndps.openClose", "Opening {o}, closing {cl}", { o: it.opening, cl: it.closing })) + "</p>" +
        (it.ledgerMismatch ? '<div class="msg err">' + esc(T(c, "site.registers.ndps.mismatch", "The register and the stock level disagree ({a} against {b}). Report this.", { a: it.ledgerMismatch.register, b: it.ledgerMismatch.stock })) + "</div>" : "") +
        '<div class="tbl"><table><tr><th>' + esc(T(c, "site.registers.ndps.colWhen", "When")) + "</th><th>" + esc(T(c, "site.registers.ndps.colWhat", "What")) + "</th><th>" + esc(T(c, "site.registers.ndps.colQty", "Quantity")) + "</th><th>" + esc(T(c, "site.registers.ndps.colBalance", "Balance")) +
        "</th><th>" + esc(T(c, "site.registers.ndps.colPatient", "Patient")) + "</th><th>" + esc(T(c, "site.registers.ndps.colBy", "By")) + "</th><th>" + esc(T(c, "site.registers.ndps.colWitness", "Witness")) + "</th><th>" + esc(T(c, "site.registers.ndps.colReason", "Reason or source")) + "</th></tr>" + lines + "</table></div></div>";
    }).join("");
    var doses = r.doses.length ? '<div class="card"><h3>' + esc(T(c, "site.registers.ndps.doses", "Doses given on the wards")) + "</h3><ul>" + r.doses.map(function (d) {
      return "<li" + (d.unwitnessed ? ' class="warn"' : "") + ">" + EN(c, esc(String(d.at).slice(0, 16).replace("T", " ") + " " + d.display + " " + (d.patientId || ""))) + " " + (d.witnessedBy ? EN(c, esc(d.witnessedBy)) : esc(T(c, "site.registers.ndps.noWitness", "no witness"))) + "</li>";
    }).join("") + "</ul></div>" : "";
    var counts = '<div class="card"><h3>' + esc(T(c, "site.registers.ndps.counts", "Counts")) + "</h3>" + (r.counts.length ? "<ul>" + r.counts.map(function (e) {
      var f = e.fields;
      return "<li" + (Number(f.variance) !== 0 ? ' class="warn"' : "") + ">" + EN(c, esc(f.countedOn + " " + (f.shift || "") + " " + f.code + " " + (f.location || ""))) + ": " + esc(T(c, "site.registers.ndps.countLine", "counted {n}, register {e}, difference {d}", { n: f.counted, e: f.expected, d: f.variance })) + "</li>";
    }).join("") + "</ul>" : "<p>" + esc(T(c, "site.registers.ndps.noCounts", "No counts recorded in this period.")) + "</p>") + "</div>";
    return head + countForm + items + doses + counts;
  }

  function registerHtml(c) {
    var esc = c.esc, kind = kindNow(), schema = S.schemas && S.schemas[kind];
    if (S.schemas === false) return failedBox(c);
    if (!schema) return loading(c);
    if (S.form) return formHtml(c, schema, S.form);
    if (S.entry) return entryHtml(c, schema, S.entry);
    var tools = '<div class="row">';
    if (S.tab === "vital") tools += '<label class="f"><span>' + esc(T(c, "site.registers.vital.kind", "Register")) + '</span><select id="rgVitalKind">' +
      [["birth", T(c, "site.registers.vital.birth", "Births (Form 1)")], ["death", T(c, "site.registers.vital.death", "Deaths (Form 2)")], ["stillbirth", T(c, "site.registers.vital.stillbirth", "Still births (Form 3)")], ["mccd", T(c, "site.registers.vital.mccd", "Cause of death certificates (Form 4/4A)")]]
        .map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === S.vitalKind ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") + "</select></label>";
    if (S.tab === "ihip" && c.can("register.ihip")) tools += '<label class="f"><span>' + esc(T(c, "site.registers.ihip.week", "Week starting Monday")) + '</span><input id="rgWeek" type="date" value="' + esc(S.week) + '"></label>';
    else tools += '<label class="f"><span>' + esc(T(c, "site.registers.month", "Month")) + '</span><input id="rgPeriod" type="month" value="' + esc(S.period) + '"></label>';
    tools += '<button class="btn quiet" type="button" data-rg="load">' + esc(T(c, "site.registers.show", "Show")) + "</button>";
    var canNew = !(S.tab === "vital" && S.vitalKind === "mccd" ? !c.can("emr.treat") : S.tab === "vital" ? !c.can("register.records") : S.tab === "mlc" ? !(c.can("mlc.record") || c.can("register.records")) : S.tab === "ihip" ? !(c.can("emr.treat") || c.can("register.ihip")) : false);
    if (canNew) tools += ' <button class="btn" type="button" data-rg="new">' + esc(T(c, "site.registers.new", "New entry")) + "</button>";
    if (canList(c)) tools += ' <button class="btn quiet" type="button" data-rg="csv">' + esc(T(c, "site.registers.exportCsv", "Export CSV")) + '</button> <button class="btn quiet" type="button" data-rg="print">' + esc(T(c, "site.registers.print", "Print register")) + "</button>";
    if (S.tab === "mtp") tools += ' <button class="btn quiet" type="button" data-rg="form2">' + esc(T(c, "site.registers.mtp.form2", "Monthly statement (Form II)")) + "</button>";
    if (S.tab === "vital" && c.can("register.records") && S.vitalKind !== "mccd") tools += ' <button class="btn quiet" type="button" data-rg="pending">' + esc(T(c, "site.registers.vital.pending", "Still owed to the Registrar")) + "</button>";
    tools += "</div>";
    var intro = '<p class="quiet">' + EN(c, esc(schema.authority)) + ". " + esc(T(c, "site.registers.manual", "Submission is manual: WardSynQ does not send registers to any authority.")) + (S.tab === "formf" ? " " + esc(T(c, "site.registers.formf.due", "File the monthly Form F report by the date your District Appropriate Authority sets.")) : "") + "</p>";
    var extra = S.extra ? extraHtml(c) : "";
    /* A treating doctor does not keep the MLC register, but can look up one patient's case by hospital number (sent in the body, never the URL). */
    var lookup = S.tab === "mlc" && !canList(c) ? '<div class="row"><label class="f"><span>' + esc(T(c, "site.registers.mrn", "Patient hospital number (MRN)")) + '</span><input id="rgLookupMrn"></label><button class="btn quiet" type="button" data-rg="mlcpatient">' + esc(T(c, "site.registers.mlc.lookup", "Show this patient's medico-legal cases")) + "</button></div>" + (S.data ? entriesTable(c, schema, S.data) : "") : "";
    return intro + tools + extra + lookup + (canList(c) ? entriesTable(c, schema, S.data) : '<p class="quiet">' + esc(T(c, "site.registers.createOnly", "You can record entries here; the register itself is kept by its custodian.")) + "</p>");
  }

  function extraHtml(c) {
    var esc = c.esc, x = S.extra;
    if (x.loading) return loading(c);
    if (!x.r || !x.r.ok) return '<div class="msg err">' + EN(c, esc(refusal(c, x.r))) + "</div>";
    if (x.what === "form2") {
      var st = x.r.statement;
      return '<div class="card"><h3>' + EN(c, esc(x.r.form)) + '</h3><dl class="kv">' + Object.keys(st).map(function (k) { return "<dt>" + EN(c, esc(k)) + "</dt><dd>" + EN(c, esc(st[k])) + "</dd>"; }).join("") + "</dl><p>" + EN(c, esc(x.r.sendTo)) + "</p></div>";
    }
    if (x.what === "pending") {
      var d = x.r.deliveries, dd = x.r.deaths;
      return '<div class="card"><h3>' + esc(T(c, "site.registers.vital.owed", "Owed to the Registrar this month")) + "</h3>" + (x.r.truncated ? '<div class="msg note">' + EN(c, esc(x.r.truncatedWarning)) + "</div>" : "") +
        "<h4>" + esc(T(c, "site.registers.vital.deliveries", "Deliveries without a birth or still birth report")) + "</h4>" + (d.length ? "<ul>" + d.map(function (p) {
          return "<li>" + EN(c, esc((p.name || "") + " " + (p.mrn || "") + " " + String(p.deliveredAt).slice(0, 10))) + " " + esc(T(c, "site.registers.vital.dueBy", "due by {d}", { d: p.dueBy })) +
            ' <button class="btn quiet" type="button" data-rg="prefill" data-kind="birth" data-id="' + esc(p.deliveryId) + '">' + esc(T(c, "site.registers.vital.startBirth", "Start birth report")) + '</button> <button class="btn quiet" type="button" data-rg="prefill" data-kind="stillbirth" data-id="' + esc(p.deliveryId) + '">' + esc(T(c, "site.registers.vital.startStill", "Start still birth report")) + "</button></li>";
        }).join("") + "</ul>" : "<p>" + esc(T(c, "site.registers.vital.noneOwed", "None.")) + "</p>") +
        "<h4>" + esc(T(c, "site.registers.vital.deathsOwed", "Deaths without a death report or cause of death certificate")) + "</h4>" + (dd.length ? "<ul>" + dd.map(function (p) {
          return "<li>" + EN(c, esc((p.name || "") + " " + (p.mrn || "") + " " + String(p.diedAt).slice(0, 10))) + " " + esc(T(c, "site.registers.vital.dueBy", "due by {d}", { d: p.dueBy })) + " " +
            (p.deathReport ? "" : '<button class="btn quiet" type="button" data-rg="prefill" data-kind="death" data-id="' + esc(p.patientId) + '">' + esc(T(c, "site.registers.vital.startDeath", "Start death report")) + "</button> ") +
            (p.mccd ? "" : '<span class="quiet">' + esc(T(c, "site.registers.vital.mccdOwed", "cause of death certificate not yet written by the doctor")) + "</span>") + "</li>";
        }).join("") + "</ul>" : "<p>" + esc(T(c, "site.registers.vital.noneOwed", "None.")) + "</p>") + "</div>";
    }
    if (x.what === "week") {
      return '<div class="card"><h3>' + esc(T(c, "site.registers.ihip.weekTitle", "IDSP week {from} to {to}", { from: x.r.week.from, to: x.r.week.to })) + "</h3><p>" + EN(c, esc(x.r.submission)) + "</p>" +
        (x.r.summary.length ? '<div class="tbl"><table><tr><th>' + esc(T(c, "site.registers.ihip.condition", "Condition")) + "</th><th>" + esc(T(c, "site.registers.ihip.form", "Form")) + "</th><th>" + esc(T(c, "site.registers.ihip.cases", "Cases")) + "</th><th>" + esc(T(c, "site.registers.ihip.deaths", "Deaths")) + "</th><th>" + esc(T(c, "site.registers.ihip.notOnIhip", "Not yet on IHIP")) + "</th></tr>" +
          x.r.summary.map(function (s) { return "<tr><td>" + EN(c, esc(s.name)) + "</td><td>" + esc(s.form) + "</td><td>" + esc(s.cases) + "</td><td>" + esc(s.deaths) + "</td><td>" + esc(s.notYetOnIhip) + "</td></tr>"; }).join("") + "</table></div>" : "<p>" + esc(T(c, "site.registers.ihip.noCases", "No cases this week.")) + "</p>") + "</div>";
    }
    return "";
  }

  /* ---------------------------------------------------------------------------------------------- render + actions */
  WSQ.page("registers", { render: function (c) {
    var el = c.el, esc = c.esc, org = c.state.orgId, list = tabs(c);
    if (!S.period) S.period = thisMonth();
    if (!S.week) S.week = lastMonday();
    if (!list.length) { el.innerHTML = '<div class="title"><h1>' + esc(T(c, "site.registers.heading", "Registers")) + '</h1></div><div class="msg note">' + TS(c, "site.registers.noAccess", "Your role keeps none of the statutory registers.") + "</div>"; return; }
    if (!list.some(function (t) { return t.key === S.tab; })) { S.tab = list[0].key; S.data = null; S.form = null; S.entry = null; S.extra = null; }
    var q = "?orgId=" + encodeURIComponent(org);
    var paint = function () {
      el.innerHTML = '<div class="title"><h1>' + esc(T(c, "site.registers.heading", "Registers")) + "</h1></div>" +
        '<div class="tabs" role="tablist">' + list.map(function (t) { return '<button type="button" role="tab" data-rg="tab" data-id="' + t.key + '" aria-selected="' + (t.key === S.tab) + '">' + esc(t.title) + "</button>"; }).join("") + "</div>" +
        (S.msg ? '<div class="msg ' + (S.msg.ok ? "ok" : "err") + '">' + EN(c, esc(S.msg.text)) + "</div>" : "") +
        (S.tab === "ndps" ? '<div class="row"><label class="f"><span>' + esc(T(c, "site.registers.month", "Month")) + '</span><input id="rgPeriod" type="month" value="' + esc(S.period) + '"></label><button class="btn quiet" type="button" data-rg="load">' + esc(T(c, "site.registers.show", "Show")) + "</button></div>" + ndpsHtml(c) : registerHtml(c));
      if (S.form && S.schemas && S.schemas[kindNow()] && S.schemas[kindNow()].definitions) {
        var sel = document.getElementById("rgF_condition"), box = document.getElementById("rgDefs");
        var draw = function () { var d = S.schemas[kindNow()].definitions.filter(function (x) { return sel && x.key === sel.value; })[0]; if (box) box.innerHTML = d ? esc(T(c, "site.registers.ihip.defP", "Presumptive (P form):")) + " " + EN(c, esc(d.presumptive)) + (d.confirmed ? " " + esc(T(c, "site.registers.ihip.defL", "Laboratory confirmed (L form):")) + " " + EN(c, esc(d.confirmed)) : "") : ""; };
        if (sel) sel.onchange = draw; draw();
      }
    };
    var load = function () {
      S.data = null; S.extra = null; paint();
      if (S.tab === "ndps") { var mr = monthRange(S.period); return c.api("/ward/register-ndps" + q + "&from=" + mr.from + "&to=" + mr.to).then(function (r) { S.data = r || { ok: false }; paint(); }); }
      if (!canList(c)) { paint(); return; }
      var kind = kindNow(), path = S.tab === "vital" ? "/ward/register-vital" + q + "&kind=" + kind + "&period=" + S.period : SUB[kind] + q + "&period=" + S.period;
      if (S.tab === "ihip") path = "/ward/register-notification" + q + "&from=" + S.week + "&to=" + new Date(Date.parse(S.week + "T00:00:00Z") + 7 * 86400000).toISOString().slice(0, 10);
      return c.api(path).then(function (r) { S.data = r || { ok: false }; paint(); });
    };
    var schemas = function () {
      if (S.schemas) return load();
      c.api("/ward/register-schema" + q).then(function (r) {
        if (!r || !r.ok) { S.schemas = false; paint(); return; }
        S.schemas = {}; r.schemas.forEach(function (s) { S.schemas[s.kind] = s; }); load();
      });
    };
    paint(); schemas();

    el.onclick = function (ev) {
      var b = ev.target.closest && ev.target.closest("[data-rg]"); if (!b) return;
      var act = b.getAttribute("data-rg"), id = b.getAttribute("data-id"), kind = kindNow(), schema = S.schemas && S.schemas[kind];
      S.msg = null;
      if (act === "tab") { S.tab = id; S.form = null; S.entry = null; return load(); }
      if (act === "load") { S.period = val("rgPeriod") || S.period; S.week = val("rgWeek") || S.week; var vk = val("rgVitalKind"); if (vk) S.vitalKind = vk; S.form = null; S.entry = null; return load(); }
      if (act === "new") { S.form = { fields: {} }; return paint(); }
      if (act === "mlcpatient") { S.data = null; return c.api("/ward/mlc-patient", { orgId: org, mrn: val("rgLookupMrn") }).then(function (r) { S.data = r || { ok: false }; paint(); }); }
      if (act === "cancel" || act === "close") { S.form = null; S.entry = null; return paint(); }
      if (act === "open") { S.entry = null; paint(); var p = S.tab === "vital" ? "/ward/register-vital" + q + "&kind=" + kind + "&id=" + encodeURIComponent(id) : SUB[kind] + q + "&id=" + encodeURIComponent(id); return c.api(p).then(function (r) { S.entry = r || { ok: false }; paint(); }); }
      if (act === "correct" && S.entry && S.entry.ok) { var e = S.entry.entry; S.form = { id: e.id, expectedVersion: e.version, fields: e.fields }; S.entry = null; return paint(); }
      if (act === "save" && schema) {
        var body = { orgId: org, fields: readForm(schema), idempotencyKey: "rg-" + Date.now() + "-" + Math.random().toString(36).slice(2) };
        if (S.tab === "vital") body.kind = kind;
        if (S.form.id) { body.id = S.form.id; body.expectedVersion = S.form.expectedVersion; body.reason = val("rgReason"); }
        else { if (S.form.patientId) body.patientId = S.form.patientId; else body.mrn = val("rgMrn"); if (S.form.deliveryId) body.deliveryId = S.form.deliveryId; if (val("rgSr")) body.serviceRequestId = val("rgSr"); if (val("rgEnc")) body.encounterId = val("rgEnc"); }
        return c.api(SUB[kind], body).then(function (r) {
          if (!r || !r.ok) { S.msg = { ok: false, text: refusal(c, r) }; return paint(); }
          S.msg = { ok: true, text: r.entry.complete ? T(c, "site.registers.saved", "Saved to the register as {n}.", { n: r.entry.serial || r.entry.id }) : T(c, "site.registers.savedIncomplete", "Saved as {n}, but incomplete. Missing: {list}", { n: r.entry.serial || r.entry.id, list: (r.entry.missing || []).join(", ") }) };
          S.form = null; return load();
        });
      }
      if (act === "csv" || act === "print") {
        var path2 = S.tab === "vital" ? "/ward/register-vital" + q + "&kind=" + kind + "&period=" + S.period + "&format=csv" : S.tab === "ihip" ? "/ward/register-notification" + q + "&week=" + S.week + "&format=csv" : SUB[kind] + q + "&period=" + S.period + "&format=csv";
        return c.api(path2).then(function (r) {
          if (!r || !r.ok || !r.csv) { S.msg = { ok: false, text: refusal(c, r) }; return paint(); }
          if (act === "csv") { saveCsv(r.filename, r.csv); S.msg = { ok: true, text: T(c, "site.registers.exported", "Exported {n} rows. Submission is manual.", { n: r.rows != null ? r.rows : (r.entries || []).length }) }; return paint(); }
          var rows = csvToRows(r.csv);
          if (!printTable(schema.title + " " + (S.tab === "ihip" ? S.week : S.period), rows[0] || [], rows.slice(1))) { S.msg = { ok: false, text: T(c, "site.registers.popupBlocked", "The print window was blocked. Allow pop-ups for this site and try again.") }; paint(); }
        });
      }
      if (act === "form2") { S.extra = { what: "form2", loading: true }; paint(); return c.api("/ward/register-mtp" + q + "&period=" + S.period + "&format=form2").then(function (r) { S.extra = { what: "form2", r: r }; paint(); }); }
      if (act === "pending") { S.extra = { what: "pending", loading: true }; paint(); return c.api("/ward/register-vital" + q + "&kind=" + kind + "&period=" + S.period + "&pending=1").then(function (r) { S.extra = { what: "pending", r: r }; paint(); }); }
      if (act === "prefill") {
        var pk = b.getAttribute("data-kind");
        return c.api("/ward/register-vital" + q + "&kind=" + pk + "&prefill=" + encodeURIComponent(id)).then(function (r) {
          if (!r || !r.ok) { S.msg = { ok: false, text: refusal(c, r) }; return paint(); }
          S.vitalKind = pk; S.extra = null; S.form = { fields: r.fields, patientId: r.patientId, deliveryId: r.deliveryId || null, note: r.note }; paint();
        });
      }
      if (act === "count") {
        return c.api("/ward/register-ndps", { orgId: org, code: val("rgC_code"), unit: val("rgC_unit"), location: val("rgC_location"), counted: val("rgC_counted"), shift: val("rgC_shift"), witnessId: val("rgC_witness"), note: val("rgC_note"), idempotencyKey: "rgc-" + Date.now() }).then(function (r) {
          S.msg = r && r.ok ? { ok: !r.discrepancy, text: r.note } : { ok: false, text: refusal(c, r) };
          return load();
        });
      }
      if ((act === "print3h" || act === "csv3h") && S.data && S.data.ok) {
        var head = [T(c, "site.registers.ndps.h.drug", "Name of drug"), T(c, "site.registers.ndps.h.date", "Date"), T(c, "site.registers.ndps.h.opening", "Opening stock"), T(c, "site.registers.ndps.h.received", "Quantity received"), T(c, "site.registers.ndps.h.from", "Received from"), T(c, "site.registers.ndps.h.doc", "Consignment note / bill / invoice no."), T(c, "site.registers.ndps.h.dispensed", "Quantity dispensed"), T(c, "site.registers.ndps.h.patients", "Patient registration no. and quantity"), T(c, "site.registers.ndps.h.closing", "Closing stock")];
        var rows3 = [];
        S.data.items.forEach(function (it) { it.form3h.forEach(function (d) { rows3.push([it.display + " (" + it.unit + (it.location ? ", " + it.location : "") + ")", d.date, d.opening, d.received, d.receivedFrom.join("; "), d.documents.join("; "), d.dispensed, d.toPatients.map(function (p) { return (p.patientId || "") + ": " + p.quantity; }).join("; "), d.closing]); }); });
        if (act === "csv3h") { saveCsv("ndps-form-3h-" + S.period + ".csv", [head].concat(rows3).map(function (r) { return r.map(function (x) { var s = String(x == null ? "" : x); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(","); }).join("\r\n") + "\r\n"); return; }
        if (!printTable(T(c, "site.registers.ndps.form3hTitle", "NDPS Form 3H, {period}", { period: S.period }), head, rows3)) { S.msg = { ok: false, text: T(c, "site.registers.popupBlocked", "The print window was blocked. Allow pop-ups for this site and try again.") }; paint(); }
      }
    };
  } });

  WSQ._registers = { formHtml: formHtml, readForm: readForm, entriesTable: entriesTable, ndpsHtml: ndpsHtml, state: S, csvToRows: csvToRows };
})();
