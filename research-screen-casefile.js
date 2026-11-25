/* StewardMD - ResearchMD case file (SMD_RESEARCH.screens.casefile).
 * ES5 only. Plan v2 items 2 and 3: one plain form in CARE order (no name,
 * hospital number or address), stored as RMDStore kind "casefile" (id "1" for
 * a case report, the patient number for a case series). The CARE timeline is
 * built from the dated entries with RMDPhi.timeline (Day 0 = presentation).
 * A case series lists its patients and can turn them into a master chart.
 */
(function (G) {
  "use strict";

  var SMD = G.SMD_RESEARCH = G.SMD_RESEARCH || {};
  SMD.screens = SMD.screens || {};

  /* Worked example: zinc phosphide poisoning with myocardial injury. */
  var FIELDS = [
    { name: "age", label: "Age in years", type: "number", example: "34" },
    { name: "sex", label: "Sex", type: "select", options: [["", "Choose"], ["Male", "Male"], ["Female", "Female"], ["Other", "Other"]] },
    { name: "presentationDate", label: "Date of first presentation (becomes Day 0)", type: "date" },
    { name: "presenting", label: "Presenting complaint", type: "textarea", example: "Vomiting and chest pain 6 hours after swallowing rat poison (zinc phosphide)" },
    { name: "history", label: "History", type: "textarea", example: "No diabetes, hypertension or heart disease. No previous ECG." },
    { name: "examination", label: "Examination", type: "textarea", example: "Pulse 118 per minute, BP 90/60 mmHg, cold peripheries, lungs clear" },
    { name: "diagnosis", label: "Diagnosis", type: "textarea", example: "Acute myocardial injury from zinc phosphide poisoning" },
    { name: "treatment", label: "Treatment", type: "textarea", example: "Gastric lavage, IV fluids, noradrenaline, magnesium sulphate" },
    { name: "outcome", label: "Outcome and follow-up", type: "textarea", example: "ECG changes resolved by Day 7; discharged Day 9; well at 3 months" },
    { name: "novelty", label: "What is new or unusual", type: "textarea", example: "ST elevation mimicking an infarct with normal coronaries" }
  ];
  var INV_EXAMPLE = { test: "Troponin I", value: "2.4", unit: "ng/mL" };

  var st = { kind: "", list: [], id: "", value: null, saved: false, view: "form" };

  function isSeries(proj) { return SMD.kit.typeKey(proj) === "case-series"; }

  function render(container, params) {
    var K = SMD.kit, proj = K.project();
    if (!proj) { K.noProject(container); return; }
    st.saved = false;
    dr.prepared = null; dr.ok = false; dr.draft = null; dr.flagged = []; dr.notice = "";
    container.innerHTML = K.header("Case file", "Loading...");
    if (isSeries(proj) && !(params && params.patient)) {
      G.RMDStore.list(proj.id, "casefile").then(function (rows) { st.list = rows || []; st.view = "list"; drawList(container, proj); });
      return;
    }
    st.id = (params && params.patient) ? String(params.patient) : "1";
    K.load(proj.id, "casefile", st.id).then(function (v) { st.value = v || { investigations: [] }; st.view = "form"; draw(container, proj); });
  }

  function drawList(container, proj) {
    var K = SMD.kit, h = [], i, next = 1;
    for (i = 0; i < st.list.length; i++) next = Math.max(next, (parseInt(st.list[i].id, 10) || 0) + 1);
    h.push(K.header("Case series", "One case file for each patient"));
    h.push('<div class="rmd-card">');
    if (!st.list.length) h.push('<p class="rmd-p">No patients yet. Add the first one.</p>');
    for (i = 0; i < st.list.length; i++) {
      var v = st.list[i].value || {};
      h.push('<button type="button" class="rmd-btn rmd-btn-subtle" data-rmd-cf-open="' + K.esc(st.list[i].id) + '">Patient ' + K.esc(st.list[i].id) +
        (v.diagnosis ? ": " + K.esc(String(v.diagnosis).slice(0, 60)) : "") + '</button> ');
    }
    h.push('</div><div class="rmd-mc-actions">');
    h.push('<button type="button" class="rmd-btn rmd-btn-primary" data-rmd-cf-open="' + next + '">Add patient ' + next + '</button> ');
    if (st.list.length >= 2) h.push('<button type="button" class="rmd-btn" data-rmd-cf="chart">Turn into master chart</button>');
    h.push('</div><p class="rmd-mut">For a surgical case series, many journals ask for PROCESS 2025. Check the journal\'s instructions.</p>');
    container.innerHTML = '<div class="rmd-cf-screen">' + h.join("") + '</div>';
    var opens = container.querySelectorAll("[data-rmd-cf-open]");
    for (i = 0; i < opens.length; i++) {
      opens[i].onclick = function () { render(container, { patient: this.getAttribute("data-rmd-cf-open") }); };
    }
    var ch = container.querySelector('[data-rmd-cf="chart"]');
    if (ch) ch.onclick = function () {
      var rec = toMasterChart(st.list);
      G.RMDStore.put(proj.id, "masterchart", "main", rec).then(function () {
        if (SMD.navigate) SMD.navigate("masterchart", { reload: true, describe: true });
      });
    };
  }

  /* Case series to master chart rows (one row per patient). Values stay as typed. */
  function toMasterChart(list) {
    var cols = ["patient", "age", "sex", "diagnosis", "treatment", "outcome"], extra = {}, order = [], rows = [], i, j, inv, v;
    for (i = 0; i < list.length; i++) {
      inv = (list[i].value && list[i].value.investigations) || [];
      for (j = 0; j < inv.length; j++) {
        var t = String(inv[j].test || "").replace(/^\s+|\s+$/g, "");
        if (t && !extra[t]) { extra[t] = 1; order.push(t); }
      }
    }
    cols = cols.concat(order);
    for (i = 0; i < list.length; i++) {
      v = list[i].value || {};
      var row = [String(list[i].id), str(v.age), str(v.sex), str(v.diagnosis), str(v.treatment), str(v.outcome)];
      inv = v.investigations || [];
      for (j = 0; j < order.length; j++) {
        var hit = "";
        for (var k = 0; k < inv.length; k++) if (String(inv[k].test || "").replace(/^\s+|\s+$/g, "") === order[j]) { hit = str(inv[k].value); break; }
        row.push(hit);
      }
      rows.push(row);
    }
    return { fileName: "Case series", sample: false, columns: cols, rows: rows, types: {} };
  }

  function str(x) { return x == null ? "" : String(x); }

  function draw(container, proj) {
    var K = SMD.kit, v = st.value, h = [], i, inv = v.investigations || [];
    h.push(K.header(isSeries(proj) ? "Patient " + st.id : "Case file", "No name, hospital number or address goes here"));
    h.push('<div class="rmd-card rmd-form">');
    for (i = 0; i < FIELDS.length; i++) {
      var f = FIELDS[i];
      h.push(K.field({ name: f.name, label: f.label, type: f.type, options: f.options, example: f.example ? "For example: " + f.example : "", value: v[f.name] }));
    }
    h.push('<h3 class="rmd-card-heading">Investigations</h3>');
    for (i = 0; i < inv.length + 1; i++) {
      var r = inv[i] || {};
      h.push('<div class="rmd-form-row" data-rmd-inv="' + i + '">' +
        '<div class="rmd-field"><label>Date</label><input type="date" data-inv="date" value="' + K.esc(r.date) + '"></div>' +
        '<div class="rmd-field"><label>Test</label><input type="text" data-inv="test" value="' + K.esc(r.test) + '" placeholder="' + (i === 0 ? K.esc(INV_EXAMPLE.test) : "") + '"></div>' +
        '<div class="rmd-field"><label>Value</label><input type="text" data-inv="value" value="' + K.esc(r.value) + '" placeholder="' + (i === 0 ? K.esc(INV_EXAMPLE.value) : "") + '"></div>' +
        '<div class="rmd-field"><label>Unit</label><input type="text" data-inv="unit" value="' + K.esc(r.unit) + '" placeholder="' + (i === 0 ? K.esc(INV_EXAMPLE.unit) : "") + '"></div></div>');
    }
    h.push('<button type="button" class="rmd-btn rmd-btn-primary" data-rmd-cf="save">Save</button>');
    if (st.saved) h.push('<p class="rmd-mut" role="status">Saved on this phone.</p>');
    h.push('</div>');
    var tl = G.RMDPhi ? G.RMDPhi.timeline(v) : { rows: [] };
    if (tl.rows.length) {
      h.push('<div class="rmd-card"><h3 class="rmd-card-heading">Timeline</h3>');
      if (!tl.day0Known) h.push('<p class="rmd-mut">Add the date of first presentation; until then Day 0 is the earliest date.</p>');
      h.push('<table class="rmd-mc-table"><tbody>');
      for (i = 0; i < tl.rows.length; i++) h.push('<tr><td>' + K.esc(tl.rows[i].label) + '</td><td>' + K.esc(tl.rows[i].text) + '</td></tr>');
      h.push('</tbody></table></div>');
    }
    if (isSeries(proj)) h.push('<button type="button" class="rmd-btn rmd-btn-subtle" data-rmd-cf="back">All patients</button>');
    else h.push(draftCardHtml());
    container.innerHTML = '<div class="rmd-cf-screen">' + h.join("") + '</div>';
    if (!isSeries(proj)) bindDraft(container, proj);
    container.querySelector('[data-rmd-cf="save"]').onclick = function () {
      var out = K.read(container.querySelector(".rmd-form"), {}), rows = container.querySelectorAll("[data-rmd-inv]"), list = [], j, q, row;
      for (j = 0; j < rows.length; j++) {
        q = rows[j].querySelectorAll("[data-inv]"); row = {};
        for (var k = 0; k < q.length; k++) row[q[k].getAttribute("data-inv")] = q[k].value;
        if (row.test || row.value) list.push(row);
      }
      out.investigations = list;
      K.save(proj.id, "casefile", st.id, out).then(function () { st.value = out; st.saved = true; draw(container, proj); });
    };
    var back = container.querySelector('[data-rmd-cf="back"]');
    if (back) back.onclick = function () { render(container, {}); };
  }

  /* ---------- Draft the case report (plan v2 item 2) ---------- */

  var NOT_IN_FILE = "This number is not in your case file. Check it.";
  var dr = { prepared: null, ok: false, ai: null, draft: null, flagged: [], notice: "" };

  function draftText(d) {
    var out = [], i, secs = (d && d.sections) || [];
    for (i = 0; i < secs.length; i++) out.push(secs[i].heading + "\n" + secs[i].text);
    return out.join("\n\n");
  }

  /* Pure: the draft as HTML with every number that is not in the case text marked. */
  function markNumbers(text, flagged, escFn) {
    var e = escFn || SMD.kit.esc, set = {}, i;
    for (i = 0; i < flagged.length; i++) set[flagged[i]] = 1;
    return e(text).replace(/&#?\w+;|\d[\d,]*(?:\.\d+)?/g, function (m) {
      if (m.charAt(0) === "&") return m;
      var v = m.replace(/,/g, "");
      v = v.indexOf(".") >= 0 ? v.replace(/0+$/, "").replace(/\.$/, "") : v;
      v = v.replace(/^0+(?=\d)/, "");
      return set[v] ? '<mark title="' + NOT_IN_FILE + '">' + m + '</mark>' : m;
    }).replace(/\n/g, "<br>");
  }

  function draftCardHtml() {
    var K = SMD.kit, h = ['<div class="rmd-card" data-rmd-cd="card"><h3 class="rmd-card-heading">Draft the case report</h3>'], i;
    if (!dr.ai) dr.ai = SMD.ai ? SMD.ai.state() : { busy: false, error: null, drafted: {} };
    h.push('<p class="rmd-p">Save the case file first. We remove the name, hospital number, address and phone, turn dates into Day N and show you exactly what would be sent.</p>');
    h.push('<button type="button" class="rmd-btn" data-rmd-cd="prep">Show the text to send</button>');
    if (dr.prepared) {
      if (dr.prepared.blocked) {
        h.push(K.banner("Edit the case file to remove these before sending: " + dr.prepared.findings.join("; ")));
      }
      h.push('<pre class="rmd-quote-block" style="white-space:pre-wrap">' + K.esc(dr.prepared.text) + '</pre>');
      if (!dr.prepared.blocked) {
        h.push(K.field({ name: "cd_ok", type: "check", label: "This text has no name, hospital number, address or phone number", value: dr.ok }));
        if (dr.ok && SMD.ai) h.push(SMD.ai.barHtml(dr.ai, { label: "case report", cost: 3 }));
      }
    }
    if (dr.draft) {
      h.push('<span class="rmd-ai-note">Drafted by MaiK, check it</span>');
      if (dr.flagged.length) h.push(K.banner(dr.flagged.length + " number" + (dr.flagged.length === 1 ? " is" : "s are") + " not in your case file: " + dr.flagged.join(", ") + ". " + NOT_IN_FILE));
      h.push('<div class="rmd-p">' + markNumbers(draftText(dr.draft), dr.flagged) + '</div>');
    }
    if (dr.notice) h.push('<p class="rmd-mut" role="status">' + K.esc(dr.notice) + '</p>');
    h.push('</div>');
    return h.join("");
  }

  function bindDraft(container, proj) {
    var K = SMD.kit, card = container.querySelector('[data-rmd-cd="card"]');
    if (!card) return;
    var redraw = function () { draw(container, proj); };
    var prep = card.querySelector('[data-rmd-cd="prep"]');
    if (prep) prep.onclick = function () { dr.prepared = G.RMDPhi.prepareCaseText(st.value); dr.ok = false; redraw(); };
    var ok = card.querySelector('[data-k="cd_ok"]');
    if (ok) ok.onchange = function () { dr.ok = !!ok.checked; redraw(); };
    if (SMD.ai && dr.ok && dr.prepared && !dr.prepared.blocked) {
      SMD.ai.bind(card, dr.ai, {
        pid: K.apiPid(proj), task: "case_report_draft",
        input: function () { return { caseText: dr.prepared.text }; },
        apply: function (d) {
          dr.draft = d;
          dr.flagged = G.RMDPhi.numbersNotIn(draftText(d), dr.prepared.text);
          K.save(proj.id, "draftmeta", "casedraft", { draft: d, flagged: dr.flagged, sourceText: dr.prepared.text });
          if (SMD.appendManuscriptResults) {
            SMD.appendManuscriptResults(proj.id, "Drafted by MaiK, check it\n\n" + draftText(d)).then(function () {
              dr.notice = "Added to the end of your manuscript. Nothing you wrote was replaced.";
              redraw();
            });
          }
          return [];
        },
        render: redraw
      });
    }
  }

  SMD.screens.casefile = { render: render, FIELDS: FIELDS, toMasterChart: toMasterChart, markNumbers: markNumbers, draftText: draftText, NOT_IN_FILE: NOT_IN_FILE };

})(typeof window !== "undefined" ? window : globalThis);
