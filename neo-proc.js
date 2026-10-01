/* StewardMD - neonatal procedures (window.SMD_NEO_PROC). Phase 9, flags smd_neo + smd_neo_proc.
 *
 * Line-length and tube calculators (UAC / UVC, ETT depth and size, PICC, LP depth, exchange volume,
 * chest drain) from data/neo/procedures.json, plus links to the step guides in kb/clinical-protocols
 * (IO access, LP, chest drain, pericardiocentesis, exchange transfusion).
 * Formula machine types (see the file's _comment): linear (const + sum of coef x var, then ops in
 * order, never pre-simplified), table (rows with their own when / src / quote), measure (the measured
 * value is the answer), nomogram (not computable: values not published openly), exchange
 * (multiplier x weight x blood volume per kg for the chosen maturity).
 * Every result says to confirm the tip position on imaging when the source says so.
 * The engine is pure and exported for node tests.
 */
(function (G) {
  "use strict";
  function num(v) { if (v == null || v === "") return null; var n = Number(String(v).replace(",", ".")); return isFinite(n) ? n : null; }
  function PE() { return G.SMD_NEO_ENGINE || (G.SMD_NEO && G.SMD_NEO.engine); }

  /* vals: { var: number }. ctx: SMD_NEO_ENGINE.context for table rows. opts: { maturity }. */
  function evaluate(calc, vals, ctx, opts) {
    var m = calc.formula && calc.formula.machine; if (!m) return { error: "No formula on file." };
    vals = vals || {};
    if (m.type === "linear") {
      var v = m["const"] || 0, miss = [];
      (m.terms || []).forEach(function (t) { var x = num(vals[t.var]); if (x == null) { miss.push(t.var); return; } var c = t.coef != null ? t.coef : 1; v += (t.neg ? -1 : 1) * c * x; });
      if (miss.length) return { needs: miss };
      (m.then || []).forEach(function (o) { if (o.op === "add") v += o.v; else if (o.op === "sub") v -= o.v; else if (o.op === "mul") v *= o.v; else if (o.op === "div") v /= o.v; });
      return { value: Math.round(v * 100) / 100, unit: m.unit };
    }
    if (m.type === "measure") { var mv = num(vals[m.var]); return mv == null ? { needs: [m.var] } : { value: mv, unit: m.unit, measured: true }; }
    if (m.type === "nomogram") return { error: "Not computable here: the nomogram values are not published under an open licence." };
    if (m.type === "exchange") {
      var w = num(vals[m.var]); if (w == null) return { needs: [m.var] };
      var mat = opts && opts.maturity, bv = (m.blood_volume_ml_per_kg || []).filter(function (b) { return b.when === mat; })[0];
      if (!bv) return { needs: ["maturity"] };
      return { value: Math.round(m.multiplier * w * bv.v), unit: m.unit, working: m.multiplier + " x " + w + " kg x " + bv.v + " mL/kg" };
    }
    if (m.type === "table") {
      var E = PE(), rows = m.rows || [], hits = [], unknown = [];
      rows.forEach(function (r) {
        if (!r.when) { hits.push(r); return; }
        var mm = E ? E.matches(r.when, ctx || {}) : { ok: null };
        if (mm.ok === true) hits.push(r); else if (mm.ok === null) unknown.push(r);
      });
      return { rows: hits, unknown: unknown, all: rows, nasalAdd: m.nasal_add_cm };
    }
    return { error: "Unknown formula type." };
  }
  var ENGINE = { evaluate: evaluate };
  if (typeof module !== "undefined" && module.exports) { module.exports = ENGINE; return; }

  /* ================================ UI ================================ */
  var GUIDES = [["neonatal-intraosseous-access", "Intraosseous access"], ["neonatal-lumbar-puncture", "Lumbar puncture"], ["neonatal-chest-drain", "Chest drain"], ["neonatal-pericardiocentesis", "Pericardiocentesis"], ["neonatal-exchange-transfusion", "Exchange transfusion"]];
  var LABEL = { UAC: "Umbilical artery line (UAC)", UVC: "Umbilical vein line (UVC)", ETT: "Breathing tube (ETT)", PICC: "PICC line", Exchange: "Exchange transfusion", LP: "Lumbar puncture (LP)", "Chest drain": "Chest drain" };
  var GROUPS = [["UAC", /^uac-|umbilical/], ["UVC", /^uvc-|umbilical/], ["ETT", /^ett-/], ["PICC", /^picc-/], ["Exchange", /^exchange/], ["LP", /^lp-/], ["Chest drain", /^chest/]];
  var S = { grp: "UVC", vals: {}, maturity: "" };
  function recordVals(d) { return { bw_kg: d.birthWeightG != null ? d.birthWeightG / 1000 : null, wt_kg: d.weightG != null ? d.weightG / 1000 : null, ga_wk: d.gaDays != null ? Math.floor(d.gaDays / 7) : null }; }
  function valueText(row) {
    var skip = { when: 1, src: 1, quote: 1, unit: 1 }, p = [];
    Object.keys(row).forEach(function (k) { if (!skip[k] && row[k] != null && typeof row[k] !== "object") p.push(k.replace(/_/g, " ") + " " + row[k]); });
    return p.join(", ") + (row.unit ? " (" + row.unit + ")" : "");
  }
  function calcHtml(A, doc, c, d) {
    var esc = A.esc, rv = recordVals(d), vals = {}, h = "";
    (c.inputs || []).forEach(function (i) { vals[i.var] = S.vals[c.id + ":" + i.var] != null && S.vals[c.id + ":" + i.var] !== "" ? S.vals[c.id + ":" + i.var] : rv[i.var]; });
    var r = evaluate(c, vals, PE().context(d), { maturity: S.maturity });
    h += '<div class="nh-row"><div class="nh-lbl">' + esc(c.name) + "</div>";
    (c.inputs || []).forEach(function (i) {
      if (i.var === "maturity") { h += '<span class="nh-seg" role="group" aria-label="Maturity"><button type="button" data-proc-mat="preterm" aria-pressed="' + (S.maturity === "preterm") + '">Preterm</button><button type="button" data-proc-mat="term" aria-pressed="' + (S.maturity === "term") + '">Term</button></span>'; return; }
      var fromRec = rv[i.var] != null && (S.vals[c.id + ":" + i.var] == null || S.vals[c.id + ":" + i.var] === "");
      h += '<label>' + esc(i.label) + '<span class="nh-u"><input inputmode="decimal" data-proc="' + esc(c.id + ":" + i.var) + '" value="' + esc(S.vals[c.id + ":" + i.var] || "") + '" placeholder="' + esc(fromRec ? String(rv[i.var]) + " (from baby details)" : "") + '"><span>' + esc(i.unit || "") + "</span></span></label>";
    });
    var line = "";
    if (r.error) h += A.note(r.error, "info");
    else if (r.needs) h += A.note("Enter " + r.needs.map(function (n) { var i = (c.inputs || []).filter(function (x) { return x.var === n; })[0]; return i ? i.label.toLowerCase() : n; }).join(", ") + ".", "info");
    else if (r.rows) {
      if (!r.rows.length && !r.unknown.length) h += A.noData("a row that fits this baby");
      h += '<div class="nh-scroll"><table class="nh-tbl"><tr><th>Row</th><th>Value</th></tr>' + r.all.map(function (row) { var hit = r.rows.indexOf(row) >= 0; if (hit) line = valueText(row); return '<tr class="' + (hit ? "hit" : "") + '"><td>' + esc(row.when ? PE().condText(row.when) : "") + "</td><td>" + esc(valueText(row)) + "</td></tr>"; }).join("") + "</table></div>";
      if (r.nasalAdd) h += '<div class="nh-work">' + esc("Nasal tube: add " + r.nasalAdd + " cm") + "</div>";
      r.rows.forEach(function (row) { if (row.src) h += A.srcLine(doc, row); });
    } else {
      line = r.value + " " + (r.unit || "");
      h += '<div class="nh-val">' + esc(line) + "</div>" + (r.working ? '<div class="nh-work">' + esc(r.working) + "</div>" : "");
    }
    h += '<div class="nh-work" style="font-family:inherit">' + esc(c.formula.text || "") + "</div>" + A.srcLine(doc, c) + (c.also ? A.srcLine(doc, c.also) : "");
    (c.notes || []).forEach(function (n) { h += A.note(n.text, "info") + A.srcLine(doc, n); });
    h += "</div>";
    return { html: h, line: line ? c.name + ": " + line : "" };
  }
  function screen(el, A) {
    el.innerHTML = '<section class="nh-card"><div class="nh-none">Loading…</div></section>';
    A.dataOrNull("procedures").then(function (doc) {
      var esc = A.esc, d = A.neo();
      var h = '<section class="nh-card"><h3>Lines and tubes ' + (doc ? A.badge(doc) : "") + '</h3><div class="nh-work" style="font-family:inherit">Pick what you are doing:</div><div class="nh-tabs" role="group" aria-label="Procedure">' + GROUPS.map(function (g) { return '<button type="button" data-proc-grp="' + esc(g[0]) + '" aria-pressed="' + (S.grp === g[0]) + '">' + esc(LABEL[g[0]] || g[0]) + "</button>"; }).join("") + "</div>";
      if (!doc) h += A.noData("procedures");
      else {
        var re = GROUPS.filter(function (g) { return g[0] === S.grp; })[0][1], lines = [];
        var calcs = (doc.calcs || []).filter(function (c) { return re.test(c.id) && (S.grp !== "UAC" || !/^uvc-/.test(c.id) && (c.catheter !== "UVC")) && (S.grp !== "UVC" || !/^uac-/.test(c.id) && (c.catheter !== "UAC")); });
        if (!calcs.length) h += A.noData(S.grp);
        calcs.forEach(function (c) { var x = calcHtml(A, doc, c, d); h += x.html; if (x.line) lines.push(x.line); });
        h += A.note("Check every line and tube tip on an X-ray or scan before using it.", "info") + A.actionsHtml("proc");
        A.setSheet("proc", { title: S.grp + " calculations", tag: "Neonatal procedures", lines: ["Baby: " + G.SMD_NEO.summary()].concat(lines) });
      }
      h += '<div class="nh-row"><div class="nh-lbl">Step-by-step guides</div>' + GUIDES.map(function (g) { return '<button type="button" class="nh-li" data-proc-guide="' + esc(g[0]) + '"><span>' + esc(g[1]) + "</span><small>Knowledge Library</small></button>"; }).join("") + "</div></section>";
      el.innerHTML = h;
      el.oninput = function (e) { var k = e.target.getAttribute && e.target.getAttribute("data-proc"); if (!k) return; S.vals[k] = e.target.value; var pos = e.target.selectionStart; screen(el, A); setTimeout(function () { var n = el.querySelector('[data-proc="' + k + '"]'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (x) {} } }, 0); };
      el.onclick = function (e) {
        var t = e.target.closest && e.target; if (!t) return;
        var g = t.closest("[data-proc-grp]"); if (g) { S.grp = g.getAttribute("data-proc-grp"); screen(el, A); return; }
        var m = t.closest("[data-proc-mat]"); if (m) { S.maturity = m.getAttribute("data-proc-mat"); screen(el, A); return; }
        var gd = t.closest("[data-proc-guide]"); if (gd) { var P = G.SMD_KBPROTO; if (P && P.open) { G.SMD_NEO_HUB.close(); P.open({ id: gd.getAttribute("data-proc-guide") }); } else A.toast("Knowledge Library loading…"); }
      };
    });
  }
  G.SMD_NEO_PROC = { engine: ENGINE };
  if (G.SMD_NEO_HUB) G.SMD_NEO_HUB.register({ id: "proc", flag: "proc", order: 9, icon: "vital_signs", title: "Procedures", sub: "UVC, UAC, ETT, PICC, exchange", kw: "uvc uac umbilical catheter ett endotracheal tube depth picc exchange transfusion volume lumbar puncture chest drain intraosseous pericardiocentesis", render: screen });
})(typeof window !== "undefined" ? window : globalThis);
