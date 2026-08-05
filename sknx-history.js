// sknx-history.js - SknX structured clinical-history model, intake form, and the history->engine-features
// mapping.
//
// Phase 1: the danger-sign fields (changing/bleeding/rapidGrowth/systemic + ABCDE) map onto the EXACT
// feature keys sknx-engines.redFlag() reads, so an optional history can force a referral the image model
// cannot trigger on its own (the melanoma/cancer safety net). The non-danger fields (itch/scale/onset/
// pain/site/note) are carried for the Phase-2 LLM reasoner and are deliberately NOT features here.
(function () {
  "use strict";

  var SINGLE = { itch: ["none", "mild", "severe"], scale: ["none", "dry", "greasy"], onset: ["acute", "subacute", "chronic"] };
  var SINGLE_LABEL = { itch: "Itch", scale: "Scale", onset: "Onset" };
  var ONSET_HINT = { acute: "days", subacute: "weeks", chronic: "months" };
  var BOOL = [
    { k: "pain", label: "Painful / tender" },
    { k: "changing", label: "Changing (size/color/shape)" },
    { k: "bleeding", label: "Bleeding / non-healing" },
    { k: "rapidGrowth", label: "Rapidly growing" },
    { k: "systemic", label: "Systemic (fever / mucosal / unwell)" }
  ];
  var SITES = ["face", "scalp", "trunk", "flexures", "hands/feet", "sun-exposed", "widespread"];
  var ABCDE = [
    { k: "asymmetry", label: "Asymmetry" }, { k: "border", label: "Border irregular" },
    { k: "color", label: "Color varied" }, { k: "diameter6", label: "Diameter >=6mm" }
  ];

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function historyToFeatures(h) {
    h = h || {};
    var f = {};
    if (h.changing) f.evolving = true;
    if (h.bleeding) { f.bleeding = true; f.ulceration = true; }   // "bleeding / non-healing"
    if (h.rapidGrowth) f.rapidGrowth = true;
    if (h.systemic) f.systemicSymptoms = true;
    var a = h.abcde || {};
    if (a.asymmetry) f.asymmetry = true;
    if (a.border) f.borderIrregular = true;
    if (a.color) f.colorVariegation = true;
    if (a.diameter6) f.diameterMm = 6;   // redFlag counts diameterMm>=6 as one ABCDE point
    return f;
  }

  // Static markup for the intake form. All fields optional. Chips carry data-field/data-value/aria-pressed;
  // single-select groups share a data-group; toggles are input[type=checkbox][data-field]; free text is a
  // textarea[data-field=note]. bindForm() wires the chip toggling.
  function chip(field, value, label, group) {
    return '<button type="button" class="sknx-chip" data-field="' + esc(field) + '" data-value="' + esc(value) + '"' +
      (group ? ' data-group="' + esc(group) + '"' : "") + ' aria-pressed="false">' + esc(label) + "</button>";
  }
  function formHtml() {
    var h = '<div class="sknx-hx">';
    Object.keys(SINGLE).forEach(function (field) {
      h += '<div class="sknx-hx-row"><div class="sknx-hx-label">' + esc(SINGLE_LABEL[field]) + '</div><div class="sknx-hx-chips">';
      SINGLE[field].forEach(function (v) { h += chip(field, v, v + (field === "onset" ? " (" + ONSET_HINT[v] + ")" : ""), field); });
      h += "</div></div>";
    });
    h += '<div class="sknx-hx-row"><div class="sknx-hx-label">Signs</div><div class="sknx-hx-toggles">';
    BOOL.forEach(function (b) { h += '<label class="sknx-hx-toggle"><input type="checkbox" data-field="' + esc(b.k) + '"><span>' + esc(b.label) + "</span></label>"; });
    h += "</div></div>";
    h += '<div class="sknx-hx-row"><div class="sknx-hx-label">Site</div><div class="sknx-hx-chips">';
    SITES.forEach(function (s) { h += chip("site", s, s); });
    h += "</div></div>";
    h += '<details class="sknx-hx-abcde"><summary>Pigmented mole (ABCDE)</summary><div class="sknx-hx-toggles">';
    ABCDE.forEach(function (a) { h += '<label class="sknx-hx-toggle"><input type="checkbox" data-field="abcde-' + esc(a.k) + '"><span>' + esc(a.label) + "</span></label>"; });
    h += "</div></details>";
    h += '<div class="sknx-hx-row"><div class="sknx-hx-label">Other</div>' +
      '<textarea class="sknx-hx-note" data-field="note" rows="2" placeholder="Brief history - no names or IDs"></textarea></div>';
    h += "</div>";
    return h;
  }

  // Wire chip toggling: single-select (data-group) is exclusive within its group; site chips multi-toggle.
  function bindForm(root) {
    if (!root || !root.addEventListener) return;
    root.addEventListener("click", function (ev) {
      var el = ev.target && ev.target.closest ? ev.target.closest(".sknx-chip") : null;
      if (!el || !root.contains(el)) return;
      var pressed = el.getAttribute("aria-pressed") === "true";
      var group = el.getAttribute("data-group");
      if (group && !pressed) {
        var sibs = root.querySelectorAll('.sknx-chip[data-group="' + group + '"]');
        Array.prototype.forEach.call(sibs, function (s) { s.setAttribute("aria-pressed", "false"); });
      }
      el.setAttribute("aria-pressed", pressed ? "false" : "true");
    });
  }

  // Pure: turn a list of field records into a history object (unit-testable without a DOM).
  function parseState(records) {
    var h = {}, sites = [], abcde = {};
    (records || []).forEach(function (r) {
      if (!r || !r.field) return;
      if (r.field === "note") { if (r.text && r.text.trim()) h.note = r.text.trim(); return; }
      if (r.field === "site") { if (r.pressed) sites.push(r.value); return; }
      if (r.field.indexOf("abcde-") === 0) { if (r.checked) abcde[r.field.slice(6)] = true; return; }
      if (r.isCheckbox) { if (r.checked) h[r.field] = true; return; }   // BOOL toggles
      if (r.pressed) h[r.field] = r.value;   // SINGLE-select chips
    });
    if (sites.length) h.site = sites;
    if (Object.keys(abcde).length) h.abcde = abcde;
    return h;
  }
  // Read the rendered form's state (one query) -> records -> parseState.
  function readForm(root) {
    if (!root || !root.querySelectorAll) return {};
    var records = [];
    Array.prototype.forEach.call(root.querySelectorAll("[data-field]"), function (el) {
      var type = (el.getAttribute && el.getAttribute("type")) || el.type;
      records.push({
        field: el.getAttribute("data-field"),
        value: el.getAttribute("data-value"),
        pressed: el.getAttribute("aria-pressed") === "true",
        checked: !!el.checked,
        isCheckbox: type === "checkbox",
        text: (el.value != null ? el.value : "")
      });
    });
    return parseState(records);
  }

  var API = { historyToFeatures: historyToFeatures, formHtml: formHtml, bindForm: bindForm, readForm: readForm, parseState: parseState, EMPTY: {} };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_SKNX_HISTORY = API;
})();
