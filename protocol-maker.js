/* StewardMD - Custom Protocol Maker. A clinician authors their own chemo protocol (name, disease, intent,
 * cycles + per-drug: name / dosing basis / dose / unit / route / days / frequency / notes, plus premeds,
 * supportive care, monitoring, instructions). Builds a schema-valid protocol object the dose engine + the
 * Protocol Sheet render directly, saved to a local library. For when a new guideline drops and the doctor
 * needs a protocol now. window.SMD_PROTOMAKER. Buildless ES5 IIFE. DRAFT / decision-support only.
 */
(function (root) {
  "use strict";
  var G = root, D = root.document;
  var LSKEY = "smd_custom_protocols";
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function ms(n) { return '<span class="material-symbols-outlined">' + n + "</span>"; }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }
  function DOSE() { return G.SMD_ONCODOSE; }

  var UNIT = { bsa: "mg/m2", flat: "mg", mgkg: "mg/kg", auc: "AUC", fixed: "mg" };
  var BASES = [["bsa", "Body-surface area (mg/m2)"], ["flat", "Flat dose (mg)"], ["mgkg", "Per weight (mg/kg)"], ["auc", "Carboplatin AUC"]];
  var ROUTES = ["IV", "PO", "SC", "IM", "IT", "intravesical", "intra-arterial", "topical"];
  var INTENTS = ["curative", "adjuvant", "neoadjuvant", "palliative", "maintenance"];

  var mk = blank(), view = "list", ctx = {};
  function blank() { return { id: null, name: "", diseaseId: "", intent: "curative", cycles: 4, cycleLengthDays: 21, drugs: [newDrug()], premeds: "", supportive: "", monitoring: "", instructions: "" }; }
  function newDrug() { return { name: "", basis: "bsa", dosePerUnit: "", unit: "mg/m2", route: "IV", days: "1", frequency: "", notes: "" }; }

  function loadCustoms() { try { return JSON.parse(G.localStorage.getItem(LSKEY) || "[]"); } catch (e) { return []; } }
  function saveCustoms(a) { try { G.localStorage.setItem(LSKEY, JSON.stringify(a)); } catch (e) {} }
  function slug(s) { return String(s || "rx").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "rx"; }
  function stamp() { try { return "" + (new (G.Date)()).getTime(); } catch (e) { return "0"; } }
  function today() { try { var d = new (G.Date)(); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); } catch (e) { return ""; } }
  function lines(s) { return String(s || "").split("\n").map(function (t) { return t.trim(); }).filter(Boolean); }
  function parseDays(s) { return String(s || "").split(/[,\s]+/).map(function (t) { return num(t); }).filter(function (n) { return n != null; }); }

  // ---- build the schema-valid protocol object ---------------------------------------------------
  function toProtocol(m) {
    return {
      id: m.id || ("custom-" + slug(m.name) + "-" + stamp()),
      diseaseId: m.diseaseId ? slug(m.diseaseId) + "_cancer" : "custom",
      name: m.name || "Custom protocol", version: "1.0",
      lifecycleState: "custom", experimental: true, custom: true,
      intentOptions: [m.intent || "curative"],
      cycles: num(m.cycles) || 1, cycleLengthDays: num(m.cycleLengthDays) || 21, caps: "protocol",
      source: { nccn: "Clinician-authored (custom protocol)", textbook: "" },
      premedications: lines(m.premeds).map(function (t) { return { name: t }; }),
      supportiveCare: lines(m.supportive), monitoring: lines(m.monitoring),
      specialInstructions: (m.instructions || ""),
      drugs: (m.drugs || []).filter(function (d) { return d.name; }).map(function (d) {
        return { id: slug(d.name), name: d.name, basis: d.basis || "flat", dosePerUnit: num(d.dosePerUnit),
          unit: d.unit || UNIT[d.basis] || "mg", route: d.route || "IV", days: parseDays(d.days),
          frequency: d.frequency || "", notes: d.notes || "", caps: { perDose: null } };
      }),
      author: ctx.author || "", createdAt: today()
    };
  }

  // ---- live example dose (so the author sees the maths as they type) ----------------------------
  function exDose(d) {
    if (!DOSE() || d.dosePerUnit === "" || d.dosePerUnit == null) return "";
    var dp = num(d.dosePerUnit); if (dp == null) return "";
    if (d.basis === "flat") return "= " + dp + " " + (d.unit || "mg");
    if (d.basis === "bsa") return "≈ " + (Math.round(dp * 1.73 * 100) / 100) + " mg @ BSA 1.73";
    if (d.basis === "mgkg") return "≈ " + (Math.round(dp * 70 * 100) / 100) + " mg @ 70 kg";
    if (d.basis === "auc") return "Calvert: dose = AUC x (GFR + 25)";
    return "";
  }

  // ---- render -----------------------------------------------------------------------------------
  function opt(list, sel) { return list.map(function (o) { var v = o instanceof Array ? o[0] : o, l = o instanceof Array ? o[1] : o; return '<option value="' + esc(v) + '"' + (v === sel ? " selected" : "") + ">" + esc(l) + "</option>"; }).join(""); }

  function drugCardHtml(d, i) {
    return '<div class="mkp-drug" data-mk-i="' + i + '">' +
      '<div class="mkp-drug-hd"><span class="mkp-drug-n">Drug ' + (i + 1) + '</span>' +
        '<button class="mkp-iconbtn" data-mk-act="remove-drug" data-mk-i="' + i + '" aria-label="Remove drug">' + ms("delete") + "</button></div>" +
      '<label class="mkp-f mkp-wide"><span>Drug name</span><input data-mk-drug="name" data-mk-i="' + i + '" value="' + esc(d.name) + '" placeholder="e.g. Cisplatin"></label>' +
      '<label class="mkp-f"><span>Dosing basis</span><select data-mk-drug="basis" data-mk-i="' + i + '">' + opt(BASES, d.basis) + "</select></label>" +
      '<label class="mkp-f"><span>Dose</span><input data-mk-drug="dosePerUnit" data-mk-i="' + i + '" type="number" step="any" value="' + esc(d.dosePerUnit) + '" placeholder="75"></label>' +
      '<label class="mkp-f"><span>Unit</span><input data-mk-drug="unit" data-mk-i="' + i + '" value="' + esc(d.unit) + '"></label>' +
      '<label class="mkp-f"><span>Route</span><select data-mk-drug="route" data-mk-i="' + i + '">' + opt(ROUTES, d.route) + "</select></label>" +
      '<label class="mkp-f"><span>Days of cycle</span><input data-mk-drug="days" data-mk-i="' + i + '" value="' + esc(d.days) + '" placeholder="1  or  1,8,15"></label>' +
      '<label class="mkp-f"><span>Frequency</span><input data-mk-drug="frequency" data-mk-i="' + i + '" value="' + esc(d.frequency) + '" placeholder="once / BID"></label>' +
      '<label class="mkp-f mkp-wide"><span>Notes</span><input data-mk-drug="notes" data-mk-i="' + i + '" value="' + esc(d.notes) + '" placeholder="premed, infusion time, source..."></label>' +
      (exDose(d) ? '<div class="mkp-exdose">' + ms("calculate") + esc(exDose(d)) + "</div>" : "") +
      "</div>";
  }

  function editorHtml() {
    var m = mk;
    return '<div class="mkp-section">' +
        '<div class="mkp-sec-h">Protocol</div>' +
        '<div class="mkp-grid">' +
          '<label class="mkp-f mkp-wide"><span>Protocol name *</span><input data-mk-field="name" value="' + esc(m.name) + '" placeholder="e.g. Cisplatin + Etoposide"></label>' +
          '<label class="mkp-f"><span>Diagnosis / disease</span><input data-mk-field="diseaseId" value="' + esc(m.diseaseId) + '" placeholder="e.g. lung"></label>' +
          '<label class="mkp-f"><span>Intent</span><select data-mk-field="intent">' + opt(INTENTS, m.intent) + "</select></label>" +
          '<label class="mkp-f"><span>No. of cycles</span><input data-mk-field="cycles" type="number" min="1" value="' + esc(m.cycles) + '"></label>' +
          '<label class="mkp-f"><span>Cycle length (days)</span><input data-mk-field="cycleLengthDays" type="number" min="1" value="' + esc(m.cycleLengthDays) + '"></label>' +
        "</div></div>" +
      '<div class="mkp-section"><div class="mkp-sec-h">Drugs</div>' +
        (m.drugs || []).map(drugCardHtml).join("") +
        '<button class="mkp-add" data-mk-act="add-drug">' + ms("add") + "Add drug</button></div>" +
      '<div class="mkp-section"><div class="mkp-sec-h">Supportive &amp; instructions</div><div class="mkp-grid">' +
        '<label class="mkp-f mkp-wide"><span>Premedications (one per line)</span><textarea data-mk-field="premeds" rows="2" placeholder="Ondansetron 8 mg IV\nDexamethasone 12 mg IV">' + esc(m.premeds) + "</textarea></label>" +
        '<label class="mkp-f mkp-wide"><span>Supportive care (one per line)</span><textarea data-mk-field="supportive" rows="2">' + esc(m.supportive) + "</textarea></label>" +
        '<label class="mkp-f mkp-wide"><span>Monitoring (one per line)</span><textarea data-mk-field="monitoring" rows="2">' + esc(m.monitoring) + "</textarea></label>" +
        '<label class="mkp-f mkp-wide"><span>Special instructions</span><textarea data-mk-field="instructions" rows="2">' + esc(m.instructions) + "</textarea></label>" +
      "</div></div>";
  }

  function listHtml() {
    var saved = loadCustoms();
    var rows = saved.length ? saved.map(function (p, i) {
      return '<div class="mkp-item">' +
        '<button class="mkp-item-main" data-mk-act="open" data-mk-id="' + esc(p.id) + '">' +
          '<span class="mkp-item-name">' + esc(p.name) + "</span>" +
          '<span class="mkp-item-sub">' + esc((p.drugs || []).length) + " drug" + ((p.drugs || []).length === 1 ? "" : "s") + " &middot; " + esc(p.cycles || "?") + " cycle" + (p.cycles === 1 ? "" : "s") + (p.diseaseId ? " &middot; " + esc(String(p.diseaseId).replace(/_cancer$/, "")) : "") + "</span></button>" +
        '<button class="mkp-iconbtn" data-mk-act="edit" data-mk-id="' + esc(p.id) + '" aria-label="Edit">' + ms("edit") + "</button>" +
        '<button class="mkp-iconbtn" data-mk-act="delete" data-mk-id="' + esc(p.id) + '" aria-label="Delete">' + ms("delete") + "</button>" +
        "</div>";
    }).join("") : '<div class="mkp-empty">' + ms("science") + "No custom protocols yet. Create one for a new regimen or guideline.</div>";
    return '<div class="mkp-list">' + rows + "</div>";
  }

  function shellHtml() {
    var editing = view === "editor";
    return '<div class="mkp-wrap">' +
      '<header class="mkp-header">' +
        '<button class="mkp-hbtn" data-mk-act="' + (editing ? "back-to-list" : "close") + '" aria-label="Back">' + ms(editing ? "arrow_back" : "close") + "</button>" +
        '<div class="mkp-htitle"><span class="mkp-hkicker">Custom protocol</span><span class="mkp-hname">' + (editing ? (mk.id ? "Edit protocol" : "New protocol") : "My protocols") + "</span></div>" +
        (editing ? "" : '<button class="mkp-hbtn" data-mk-act="new" aria-label="New">' + ms("add") + "</button>") +
      "</header>" +
      '<div class="mkp-scroll">' + (editing ? editorHtml() : listHtml()) + "</div>" +
      (editing ?
        '<div class="mkp-actionbar">' +
          '<button class="mkp-btn ghost" data-mk-act="preview">' + ms("visibility") + "Preview sheet</button>" +
          '<button class="mkp-btn primary" data-mk-act="save-open">' + ms("save") + "Save</button>" +
        "</div>"
        : '<div class="mkp-actionbar"><button class="mkp-btn primary" data-mk-act="new">' + ms("add") + "Create new protocol</button></div>") +
      "</div>";
  }

  function paint() { var el = D && D.getElementById("smdProtoMaker"); if (el) el.innerHTML = shellHtml(); }

  // ---- read the form back into state (so focus is never lost while typing) ----------------------
  function commitForm() {
    if (!D || view !== "editor") return;
    D.querySelectorAll("[data-mk-field]").forEach(function (el) { mk[el.getAttribute("data-mk-field")] = el.value; });
    D.querySelectorAll("[data-mk-drug]").forEach(function (el) {
      var i = +el.getAttribute("data-mk-i"), k = el.getAttribute("data-mk-drug");
      if (mk.drugs[i]) mk.drugs[i][k] = el.value;
    });
  }

  function validateForm() {
    commitForm();
    var errs = [];
    if (!mk.name) errs.push("Give the protocol a name.");
    var real = (mk.drugs || []).filter(function (d) { return d.name; });
    if (!real.length) errs.push("Add at least one drug.");
    real.forEach(function (d) { if (d.basis !== "auc" && (d.dosePerUnit === "" || d.dosePerUnit == null)) errs.push(d.name + ": enter a dose."); });
    return errs;
  }

  function doSaveOpen() {
    var errs = validateForm();
    if (errs.length) { try { G.toast && G.toast(errs[0]); } catch (e) {} return; }
    var proto = toProtocol(mk);
    var saved = loadCustoms();
    var idx = -1; for (var i = 0; i < saved.length; i++) if (saved[i].id === proto.id) idx = i;
    if (idx >= 0) saved[idx] = proto; else saved.unshift(proto);
    saveCustoms(saved);
    mk.id = proto.id;
    try { G.toast && G.toast("Custom protocol saved."); } catch (e2) {}
    if (G.SMD_PROTOSHEET) { close(); G.SMD_PROTOSHEET.open(proto, ctx.patient || {}, { today: today(), onAssign: ctx.onAssign }); }
    else { view = "list"; paint(); }
  }
  function doPreview() {
    var errs = validateForm();
    if (errs.length) { try { G.toast && G.toast(errs[0]); } catch (e) {} return; }
    if (G.SMD_PROTOSHEET) G.SMD_PROTOSHEET.open(toProtocol(mk), ctx.patient || {}, { today: today() });
    else try { G.toast && G.toast("Protocol sheet unavailable."); } catch (e) {}
  }

  function onClick(e) {
    var t = e.target && e.target.closest ? e.target.closest("[data-mk-act]") : null;
    if (!t) return;
    var act = t.getAttribute("data-mk-act"), id = t.getAttribute("data-mk-id"), i = t.getAttribute("data-mk-i");
    if (act === "close") return close();
    if (act === "new") { mk = blank(); view = "editor"; paint(); return; }
    if (act === "back-to-list") { view = "list"; paint(); return; }
    if (act === "add-drug") { commitForm(); mk.drugs.push(newDrug()); paint(); return; }
    if (act === "remove-drug") { commitForm(); mk.drugs.splice(+i, 1); if (!mk.drugs.length) mk.drugs.push(newDrug()); paint(); return; }
    if (act === "save-open") return doSaveOpen();
    if (act === "preview") return doPreview();
    if (act === "open") { var p = findCustom(id); if (p && G.SMD_PROTOSHEET) { close(); G.SMD_PROTOSHEET.open(p, ctx.patient || {}, { today: today(), onAssign: ctx.onAssign }); } return; }
    if (act === "edit") { var pe = findCustom(id); if (pe) { mk = fromProtocol(pe); view = "editor"; paint(); } return; }
    if (act === "delete") { var s = loadCustoms().filter(function (x) { return x.id !== id; }); saveCustoms(s); paint(); return; }
  }
  // re-render the drugs section on basis change so the unit default follows (keeps other fields via commit)
  function onChange(e) {
    var el = e.target;
    if (el && el.getAttribute && el.getAttribute("data-mk-drug") === "basis") {
      commitForm(); var i = +el.getAttribute("data-mk-i");
      if (mk.drugs[i]) mk.drugs[i].unit = UNIT[el.value] || mk.drugs[i].unit;
      paint();
    }
  }

  function findCustom(id) { var a = loadCustoms(); for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i]; return null; }
  function fromProtocol(p) {
    return {
      id: p.id, name: p.name || "", diseaseId: (p.diseaseId || "").replace(/_cancer$/, ""),
      intent: (p.intentOptions || ["curative"])[0], cycles: p.cycles || 1, cycleLengthDays: p.cycleLengthDays || 21,
      drugs: (p.drugs || []).map(function (d) { return { name: d.name || "", basis: d.basis || "bsa", dosePerUnit: d.dosePerUnit == null ? "" : d.dosePerUnit, unit: d.unit || "", route: d.route || "IV", days: (d.days || []).join(","), frequency: d.frequency || "", notes: d.notes || "" }; }) || [newDrug()],
      premeds: (p.premedications || []).map(function (x) { return x.name || x; }).join("\n"),
      supportive: (p.supportiveCare || []).join("\n"), monitoring: (p.monitoring || []).join("\n"), instructions: p.specialInstructions || ""
    };
  }

  // ---- open / close -----------------------------------------------------------------------------
  function ensureEl() {
    var el = D.getElementById("smdProtoMaker");
    if (!el) { el = D.createElement("div"); el.id = "smdProtoMaker"; el.className = "mkp-overlay"; D.body.appendChild(el); el.addEventListener("click", onClick); el.addEventListener("change", onChange); }
    return el;
  }
  function open(opts) {
    if (!D) return;
    ctx = opts || {};
    view = ctx.startNew ? "editor" : "list";
    if (ctx.startNew) mk = blank();
    var el = ensureEl(); el.style.display = "block"; if (D.body) D.body.classList.add("mkp-open");
    paint();
  }
  function close() { var el = D && D.getElementById("smdProtoMaker"); if (el) el.style.display = "none"; if (D && D.body) D.body.classList.remove("mkp-open"); }

  var API = { open: open, close: close, _toProtocol: toProtocol, _list: loadCustoms, _st: function () { return mk; }, _version: "1.0" };
  if (root) root.SMD_PROTOMAKER = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : this);
