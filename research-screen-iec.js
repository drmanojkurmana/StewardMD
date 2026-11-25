/* StewardMD - ResearchMD ethics committee step (SMD_RESEARCH.screens.iec).
 * ES5 only. Plan v2 item 7: status, approval reference, date and the packet
 * checklist, stored as RMDStore kind "iec". Studies get the ICMR 2017 line;
 * case reports get the permission or waiver line and are never blocked.
 */
(function (G) {
  "use strict";

  var SMD = G.SMD_RESEARCH = G.SMD_RESEARCH || {};
  SMD.screens = SMD.screens || {};

  var STATUS = [["not_submitted", "Not submitted"], ["submitted", "Submitted"], ["approved", "Approved"], ["waiver", "Waiver granted"]];
  var PACKET = [
    ["protocol", "Protocol"],
    ["pis", "Participant information sheet and consent form, in English and the local language"],
    ["crf", "Case record form"],
    ["cv", "Investigator CV"]
  ];
  var STUDY_LINE = "Under ICMR 2017 guidelines, only the ethics committee can decide that a study is exempt; you cannot decide it yourself.";
  var CASE_LINE = "Ask your ethics committee or HOD whether they need to review it; many institutions issue a permission or waiver letter. Patient consent is still needed.";

  var st = { value: null, saved: false };

  function render(container) {
    var K = SMD.kit, proj = K.project();
    if (!proj) { K.noProject(container); return; }
    st.value = null; st.saved = false;
    container.innerHTML = K.header("Ethics committee", "Loading...");
    K.load(proj.id, "iec").then(function (v) { st.value = v || {}; draw(container, proj); });
  }

  function draw(container, proj) {
    var K = SMD.kit;
    var kind = K.typeKey(proj), isCase = kind === "case-report" || kind === "case-series", v = st.value, h = [], i;
    var packet = v.packet || {};
    h.push(K.header("Ethics committee", isCase ? "Permission for your case report" : "Approval before you collect data"));
    h.push('<div class="rmd-card"><p class="rmd-p">' + K.esc(isCase ? CASE_LINE : STUDY_LINE) + '</p></div>');
    h.push('<div class="rmd-card rmd-form">');
    h.push(K.field({ name: "status", label: "Status", type: "select", value: v.status || "not_submitted", options: STATUS }));
    h.push(K.field({ name: "reference", label: "Approval or waiver reference", value: v.reference, example: "IEC/2026/045" }));
    h.push(K.field({ name: "date", label: "Date of the letter", type: "date", value: v.date }));
    if (!isCase) {
      h.push('<h3 class="rmd-card-heading">What goes in the packet</h3>');
      for (i = 0; i < PACKET.length; i++) h.push(K.field({ name: "p_" + PACKET[i][0], label: PACKET[i][1], type: "check", value: !!packet[PACKET[i][0]] }));
    }
    h.push('<button type="button" class="rmd-btn rmd-btn-primary" data-rmd-iec="save">Save</button>');
    if (st.saved) h.push('<p class="rmd-mut" role="status">Saved on this phone.</p>');
    h.push('</div>');
    container.innerHTML = '<div class="rmd-iec-screen">' + h.join("") + '</div>';
    container.querySelector('[data-rmd-iec="save"]').onclick = function () {
      var o = K.read(container, {}), out = { status: o.status, reference: o.reference || "", date: o.date || "", packet: {} };
      for (i = 0; i < PACKET.length; i++) out.packet[PACKET[i][0]] = !!o["p_" + PACKET[i][0]];
      K.save(proj.id, "iec", "main", out).then(function () { st.value = out; st.saved = true; draw(container, proj); });
    };
  }

  SMD.screens.iec = { render: render, STUDY_LINE: STUDY_LINE, CASE_LINE: CASE_LINE, PACKET: PACKET };

})(typeof window !== "undefined" ? window : globalThis);
