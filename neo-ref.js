/* StewardMD - age-banded reference values (window.SMD_NEO_REF). Phase 8, flags smd_neo + smd_neo_ref.
 *
 * Vital signs, neonatal CSF, haematology and chemistry from open published sources (not Harriet
 * Lane), in data/neo/ref-values.json with a verbatim quote per row. The rows that fit the pinned baby
 * (age, gestation, day of life) are picked out automatically; every row says what its lo / hi mean
 * (1st/99th centile, 10th/90th, 95th percentile, operational threshold), because the sources differ.
 */
(function (G) {
  "use strict";
  var S = { g: null, mine: true };
  function PE() { return G.SMD_NEO_ENGINE || (G.SMD_NEO && G.SMD_NEO.engine); }
  function fmtRange(r) {
    var p = [];
    if (r.lo != null && r.hi != null) p.push(r.lo + " to " + r.hi);
    else if (r.hi != null) p.push("up to " + r.hi);
    else if (r.lo != null) p.push("from " + r.lo);
    if (r.median != null) p.push("median " + r.median);
    return p.join(", ") + (r.unit ? " " + r.unit : "");
  }
  function screen(el, A) {
    el.innerHTML = '<section class="nh-card"><div class="nh-none">Loading…</div></section>';
    A.dataOrNull("ref-values").then(function (doc) {
      if (!doc || !(doc.groups || []).length) { el.innerHTML = '<section class="nh-card"><h3>Normal values</h3>' + A.noData("reference values") + "</section>"; return; }
      var esc = A.esc, d = A.neo(), E = PE(), ctx = E.context(d);
      if (!S.g) S.g = doc.groups[0].id;
      var grp = doc.groups.filter(function (g) { return g.id === S.g; })[0] || doc.groups[0];
      var rows = grp.rows.map(function (r) { return { r: r, m: E.matches(r.when, ctx) }; });
      var shown = S.mine ? rows.filter(function (x) { return x.m.ok !== false; }) : rows;
      var byA = {}, order = [];
      shown.forEach(function (x) { var k = x.r.analyte; if (!byA[k]) { byA[k] = []; order.push(k); } byA[k].push(x); });
      var h = '<section class="nh-card"><h3>Normal values ' + A.badge(doc) + "</h3>" +
        '<label>What do you want to check?<select data-ref="g">' + doc.groups.map(function (g) { return '<option value="' + esc(g.id) + '"' + (g.id === grp.id ? " selected" : "") + ">" + esc(g.title) + "</option>"; }).join("") + "</select></label>" +
        '<label class="nh-2cl" style="flex-direction:row"><input type="checkbox" data-ref="mine"' + (S.mine ? " checked" : "") + "> Only rows that can fit this baby</label>" +
        (S.mine && (d.pnaDays == null || d.gaDays == null) ? A.note("Rows that need the baby's age or gestation stay listed until the baby details have them.", "info") : "");
      if (!order.length) h += A.noData("this baby's age in this group");
      order.forEach(function (k) {
        h += '<div class="nh-row"><div class="nh-lbl">' + esc(k) + "</div>";
        byA[k].forEach(function (x) {
          var r = x.r, fit = x.m.ok === true;
          h += '<div style="' + (fit ? "background:var(--nh-acc-soft);border-radius:8px;padding:6px 8px" : "padding:0 8px") + '"><div style="font:600 15px var(--nh-f)">' + esc(fmtRange(r)) + (fit ? ' <span class="nh-ok">fits this baby</span>' : "") + '</div><div class="nh-work">' + esc(E.condText(r.when) || "all ages in the source") + "</div>" + (r.note ? '<div class="nh-work" style="font-family:inherit">' + esc(r.note) + "</div>" : "") + A.srcLine(doc, r) + "</div>";
        });
        h += "</div>";
      });
      el.innerHTML = h + '<div class="nh-foot">Normal ranges differ by lab method and population; each row names its source.</div></section>';
      el.onchange = function (e) { var k = e.target.getAttribute && e.target.getAttribute("data-ref"); if (!k) return; if (k === "g") S.g = e.target.value; else S.mine = e.target.checked; screen(el, A); };
    });
  }
  G.SMD_NEO_REF = { fmtRange: fmtRange };
  if (G.SMD_NEO_HUB) G.SMD_NEO_HUB.register({ id: "ref", flag: "ref", order: 8, icon: "lab_panel", title: "Reference values", sub: "Vitals, CSF, blood by age", kw: "reference range normal values heart rate respiratory rate csf cell count protein glucose haemoglobin platelets neutrophils", render: screen });
})(typeof window !== "undefined" ? window : globalThis);
