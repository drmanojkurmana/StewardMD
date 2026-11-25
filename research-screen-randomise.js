/* StewardMD - ResearchMD randomisation step (SMD_RESEARCH.screens.randomise).
 * ES5 only. Plan v2 item 5: the list keeper makes a block randomisation list
 * with SMD_RESEARCH_RANDOMISE.blockList, exports it (CSV, envelope labels,
 * keeper sheet) and by default removes it from this phone, keeping only the
 * SHA-256 fingerprint (kind randomfingerprint). Also the blinding card
 * (kind blinding) and a link to the CONSORT flow diagram.
 */
(function (G) {
  "use strict";

  var SMD = G.SMD_RESEARCH = G.SMD_RESEARCH || {};
  SMD.screens = SMD.screens || {};

  var KEEPER_LINE = "Ask your guide or statistician to make the list on their phone.";
  var GUIDE = [
    "Allocation concealment means keeping the next assignment hidden from whoever recruits the patient, so nobody can choose who gets which treatment.",
    "Put each assignment in a sequentially numbered, opaque, sealed envelope and open it only after the patient has consented and been enrolled.",
    "Do not use alternate days, odd and even hospital numbers or dates of birth: anyone can predict them, so they are not random."
  ];
  var BLIND_GROUPS = [["participants", "Participants"], ["providers", "Care providers"], ["assessors", "Outcome assessors"], ["analysts", "Data analysts"]];

  /* Methods paragraph for blinding: names the groups, never single, double or triple. */
  function blindingText(b) {
    var v = b || {}, names = [], i;
    if (v.nobody) return "Nobody was blinded" + (v.why ? ", because " + String(v.why).replace(/^\s+|\s+$|\.$/g, "") : "") + ".";
    for (i = 0; i < BLIND_GROUPS.length; i++) if (v[BLIND_GROUPS[i][0]]) names.push(BLIND_GROUPS[i][1].toLowerCase());
    if (!names.length) return "";
    var list = names.length === 1 ? names[0] : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
    var s = list.charAt(0).toUpperCase() + list.slice(1) + " did not know which treatment each patient received";
    if (v.how) s += " (" + String(v.how).replace(/^\s+|\s+$|\.$/g, "") + ")";
    return s + ".";
  }

  function splitList(s) {
    var a = String(s || "").split(","), out = [], i, t;
    for (i = 0; i < a.length; i++) { t = a[i].replace(/^\s+|\s+$/g, ""); if (t) out.push(t); }
    return out;
  }

  function nums(s) {
    var a = splitList(String(s || "").replace(/:/g, ",")), out = [], i;
    for (i = 0; i < a.length; i++) out.push(Number(a[i]));
    return out;
  }

  function envelopeSheet(res) {
    var lines = ["Envelope labels (envelope numbers only)", ""], i;
    for (i = 0; i < res.rows.length; i++) lines.push("Envelope " + res.rows[i].envelope + (res.rows[i].stratum !== "All" ? "  (" + res.rows[i].stratum + ")" : ""));
    return lines.join("\n") + "\n";
  }

  function keeperSheet(res, fp) {
    var lines = ["Randomisation list: keep this private", "Seed: " + res.seed, "Fingerprint (SHA-256 of the CSV): " + fp, ""], i;
    for (i = 0; i < res.rows.length; i++) lines.push(res.rows[i].envelope + "  " + res.rows[i].arm);
    return lines.join("\n") + "\n";
  }

  var st = { keeper: false, form: {}, result: null, fingerprint: "", saved: null, blinding: {}, notice: "", error: "" };

  function render(container) {
    var K = SMD.kit, proj = K.project();
    if (!proj) { K.noProject(container); return; }
    st.result = null; st.notice = ""; st.error = "";
    container.innerHTML = K.header("Randomisation", "Loading...");
    Promise.all([K.load(proj.id, "randomfingerprint"), K.load(proj.id, "blinding"), K.load(proj.id, "samplesize"), K.gateBannersHtml(proj)]).then(function (r) {
      st.saved = r[0]; st.blinding = r[1] || {};
      if (!st.form.n && r[2] && r[2].total) st.form.n = r[2].total;
      draw(container, proj, r[3]);
    });
  }

  function draw(container, proj, gates) {
    var K = SMD.kit, h = [], i, f = st.form;
    h.push(K.header("Randomisation", "Who gets which treatment"));
    if (gates) h.push(gates);
    h.push('<div class="rmd-card"><h3 class="rmd-card-heading">Who is making this list?</h3>');
    h.push(K.field({ name: "keeper", type: "check", label: "I am the list keeper (I do not recruit or assess patients)", value: st.keeper }));
    if (!st.keeper) h.push('<p class="rmd-p">' + K.esc(KEEPER_LINE) + '</p>');
    h.push('</div>');
    if (st.saved && st.saved.fingerprint) {
      h.push('<div class="rmd-card"><p class="rmd-p">A list was made on ' + K.esc(String(st.saved.madeAt || "").slice(0, 10)) + '. Its fingerprint is kept so you can check later that it was not changed:</p><p class="rmd-mut">' + K.esc(st.saved.fingerprint) + '</p></div>');
    }
    if (st.keeper) {
      h.push('<div class="rmd-card rmd-form">');
      h.push(K.field({ name: "arms", label: "Arms, separated by commas", value: f.arms || "A, B", example: "A, B" }));
      h.push(K.field({ name: "ratio", label: "Ratio", value: f.ratio || "1:1", example: "1:1 or 2:1" }));
      h.push(K.field({ name: "n", label: "Number of patients", type: "number", value: f.n || "" }));
      h.push(K.field({ name: "blocks", label: "Block sizes, separated by commas", value: f.blocks || "4, 6", help: "Mixing two block sizes makes the next assignment harder to guess." }));
      h.push(K.field({ name: "strata", label: "Strata (optional), separated by commas", value: f.strata || "", example: "Male, Female" }));
      h.push(K.field({ name: "seed", label: "Seed (any word or number; keep it private)", value: f.seed || "" }));
      if (st.error) h.push(K.banner(st.error, "warn"));
      h.push('<button type="button" class="rmd-btn rmd-btn-primary" data-rmd-rz="make">Make the list</button></div>');
    }
    if (st.result) {
      var res = st.result;
      h.push('<div class="rmd-card"><h3 class="rmd-card-heading">Your list: ' + res.rows.length + ' places</h3>');
      for (i = 0; i < res.warnings.length; i++) h.push(K.banner(res.warnings[i]));
      h.push('<p class="rmd-mut">Fingerprint: ' + K.esc(st.fingerprint) + '</p>');
      h.push('<div class="rmd-mc-actions"><button type="button" class="rmd-btn" data-rmd-rz="csv">Save CSV</button> ' +
        '<button type="button" class="rmd-btn" data-rmd-rz="env">Save envelope labels</button> ' +
        '<button type="button" class="rmd-btn" data-rmd-rz="keep">Save keeper sheet</button></div>');
      h.push(K.field({ name: "remove", type: "check", label: "Remove the list from this phone", value: st.remove !== false }));
      h.push('<button type="button" class="rmd-btn rmd-btn-primary" data-rmd-rz="done">Done</button></div>');
    }
    if (st.notice) h.push('<p class="rmd-mut" role="status">' + K.esc(st.notice) + '</p>');
    h.push('<div class="rmd-card"><h3 class="rmd-card-heading">Keeping it fair</h3>');
    for (i = 0; i < GUIDE.length; i++) h.push('<p class="rmd-p">' + K.esc(GUIDE[i]) + '</p>');
    h.push('</div>');
    h.push(blindingCard());
    h.push('<button type="button" class="rmd-btn rmd-btn-subtle" data-rmd-rz="consort">CONSORT flow diagram</button>');
    container.innerHTML = '<div class="rmd-rz-screen">' + h.join("") + '</div>';
    bind(container, proj, gates);
  }

  function blindingCard() {
    var K = SMD.kit, b = st.blinding, h = ['<div class="rmd-card rmd-form" data-rmd-blind="1"><h3 class="rmd-card-heading">Blinding</h3><p class="rmd-p">Who did not know which treatment each patient received?</p>'], i;
    for (i = 0; i < BLIND_GROUPS.length; i++) h.push(K.field({ name: "b_" + BLIND_GROUPS[i][0], type: "check", label: BLIND_GROUPS[i][1], value: !!b[BLIND_GROUPS[i][0]] }));
    h.push(K.field({ name: "b_how", label: "How", value: b.how, example: "identical tablets, sham procedure or coded samples" }));
    h.push(K.field({ name: "b_nobody", type: "check", label: "Nobody was blinded", value: !!b.nobody }));
    h.push(K.field({ name: "b_why", label: "Because", value: b.why, example: "the two operations look different" }));
    var txt = blindingText(b);
    if (txt) h.push('<p class="rmd-mc-sentence">' + K.esc(txt) + '</p>');
    h.push('<button type="button" class="rmd-btn" data-rmd-rz="blind">Save blinding</button></div>');
    return h.join("");
  }

  /* DOCX through the manuscript screen's writer when it is loaded, else plain text. */
  function saveSheet(slug, title, text) {
    if (SMD.docxFromSections && SMD.p2 && SMD.p2.downloadBytes) {
      var bytes = SMD.docxFromSections(title, [{ id: slug, heading: title, level: 1, text: text }]);
      SMD.p2.downloadBytes(slug + ".docx", bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", title);
      return;
    }
    SMD.kit.download(slug + ".txt", text, "text/plain");
  }

  function bind(container, proj, gates) {
    var K = SMD.kit;
    function on(sel, fn) { var el = container.querySelector(sel); if (el) el.onclick = fn; }
    var kc = container.querySelector('[data-k="keeper"]');
    if (kc) kc.onchange = function () { st.keeper = !!kc.checked; draw(container, proj, gates); };
    on('[data-rmd-rz="make"]', function () {
      var o = K.read(container.querySelector(".rmd-form"), {});
      st.form = o;
      var strata = splitList(o.strata);
      var res = G.SMD_RESEARCH_RANDOMISE.blockList({
        seed: o.seed, arms: splitList(o.arms), ratio: nums(o.ratio), n: Number(o.n),
        blockSizes: nums(o.blocks), strata: strata.length ? strata : null
      });
      if (!res.ok) { st.error = res.warnings[0]; st.result = null; draw(container, proj, gates); return; }
      st.error = "";
      K.sha256Hex(res.csv).then(function (fp) { st.result = res; st.fingerprint = fp; st.remove = true; draw(container, proj, gates); },
        function (e) { st.error = String(e && e.message || e).replace(/^research: /, ""); draw(container, proj, gates); });
    });
    on('[data-rmd-rz="csv"]', function () { K.download("randomisation-list.csv", st.result.csv, "text/csv"); });
    on('[data-rmd-rz="env"]', function () { saveSheet("envelope-labels", "Envelope labels", envelopeSheet(st.result)); });
    on('[data-rmd-rz="keep"]', function () { saveSheet("keeper-sheet", "Randomisation keeper sheet", keeperSheet(st.result, st.fingerprint)); });
    on('[data-rmd-rz="done"]', function () {
      var rm = container.querySelector('[data-k="remove"]'), remove = !rm || rm.checked, res = st.result, fp = st.fingerprint;
      var meta = { fingerprint: fp, madeAt: new Date().toISOString(), places: res.rows.length };
      var work = [K.save(proj.id, "randomfingerprint", "main", meta)];
      if (!remove) work.push(K.save(proj.id, "randomlist", "main", { csv: res.csv, seed: res.seed }));
      else if (G.RMDStore) work.push(G.RMDStore.remove(proj.id, "randomlist", "main"));
      Promise.all(work).then(function () {
        st.saved = meta; st.result = null; st.fingerprint = ""; st.form.seed = "";
        st.notice = remove ? "The list was removed from this phone. Only its fingerprint is kept." : "The list is kept on this phone.";
        draw(container, proj, gates);
      });
    });
    on('[data-rmd-rz="blind"]', function () {
      var o = K.read(container.querySelector('[data-rmd-blind="1"]'), {}), b = {}, i;
      for (i = 0; i < BLIND_GROUPS.length; i++) b[BLIND_GROUPS[i][0]] = !!o["b_" + BLIND_GROUPS[i][0]];
      b.how = o.b_how || ""; b.nobody = !!o.b_nobody; b.why = o.b_why || ""; b.text = blindingText(b);
      K.save(proj.id, "blinding", "main", b).then(function () { st.blinding = b; st.notice = "Blinding saved."; draw(container, proj, gates); });
    });
    on('[data-rmd-rz="consort"]', function () { if (SMD.navigate) SMD.navigate("consort", {}); });
  }

  SMD.screens.randomise = { render: render, blindingText: blindingText, envelopeSheet: envelopeSheet, keeperSheet: keeperSheet, KEEPER_LINE: KEEPER_LINE };

})(typeof window !== "undefined" ? window : globalThis);
