/* StewardMD - ResearchMD CTRI registration step (SMD_RESEARCH.screens.ctri).
 * ES5 only. Plan v2 item 5: status, CTRI number and date, stored as RMDStore
 * kind "ctri". Gives the manuscript the registration sentence and the data
 * sharing statement placeholder (ICMJE requires one for trials).
 */
(function (G) {
  "use strict";

  var SMD = G.SMD_RESEARCH = G.SMD_RESEARCH || {};
  SMD.screens = SMD.screens || {};

  var STATUS = [["not_started", "Not started"], ["submitted", "Submitted"], ["registered", "Registered"]];
  var WHY = "CTRI accepts only prospective registration: register before the first participant is enrolled. ICMJE journals will not publish a trial that was registered late.";
  var DATA_SHARING = "Data sharing statement: [Say whether de-identified participant data will be shared, which data, when, with whom and how to ask.]";

  function sentence(v) {
    if (!v || !v.number) return "";
    return "The trial was registered prospectively with the Clinical Trials Registry - India (" + v.number + ")" +
      (v.date ? " on " + v.date : "") + ".";
  }

  var st = { value: null, saved: false, error: "" };

  function render(container) {
    var K = SMD.kit, proj = K.project();
    if (!proj) { K.noProject(container); return; }
    st.value = null; st.saved = false; st.error = "";
    container.innerHTML = K.header("CTRI registration", "Loading...");
    K.load(proj.id, "ctri").then(function (v) { st.value = v || {}; draw(container, proj); });
  }

  function draw(container, proj) {
    var K = SMD.kit, v = st.value, h = [];
    h.push(K.header("CTRI registration", "Register the trial before the first patient"));
    if (!(v.number && K.CTRI_RE.test(v.number))) h.push(K.banner(K.CTRI_BANNER));
    h.push('<div class="rmd-card"><p class="rmd-p">' + K.esc(WHY) + '</p></div>');
    h.push('<div class="rmd-card rmd-form">');
    h.push(K.field({ name: "status", label: "Status", type: "select", value: v.status || "not_started", options: STATUS }));
    h.push(K.field({ name: "number", label: "CTRI number", value: v.number, example: "CTRI/2026/01/012345" }));
    h.push(K.field({ name: "date", label: "Date registered", type: "date", value: v.date }));
    if (st.error) h.push(K.banner(st.error, "warn"));
    h.push('<button type="button" class="rmd-btn rmd-btn-primary" data-rmd-ctri="save">Save</button>');
    if (st.saved) h.push('<p class="rmd-mut" role="status">Saved on this phone.</p>');
    h.push('</div>');
    if (sentence(v)) {
      h.push('<div class="rmd-card"><h3 class="rmd-card-heading">For your manuscript</h3><p class="rmd-p">' + K.esc(sentence(v)) + '</p><p class="rmd-p">' + K.esc(DATA_SHARING) + '</p></div>');
    }
    container.innerHTML = '<div class="rmd-ctri-screen">' + h.join("") + '</div>';
    container.querySelector('[data-rmd-ctri="save"]').onclick = function () {
      var o = K.read(container, {}), num = String(o.number || "").replace(/\s+/g, "").toUpperCase();
      if (num && !K.CTRI_RE.test(num)) {
        st.error = "A CTRI number looks like CTRI/2026/01/012345. Check it.";
        st.value = { status: o.status, number: o.number, date: o.date };
        draw(container, proj);
        return;
      }
      var out = { status: num ? "registered" : o.status, number: num, date: o.date || "" };
      K.save(proj.id, "ctri", "main", out).then(function () { st.value = out; st.saved = true; st.error = ""; draw(container, proj); });
    };
  }

  SMD.screens.ctri = { render: render, sentence: sentence, DATA_SHARING: DATA_SHARING };

})(typeof window !== "undefined" ? window : globalThis);
