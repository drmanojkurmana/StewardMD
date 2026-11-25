/* StewardMD - ResearchMD CONSORT flow diagram (SMD_RESEARCH.screens.consort).
 * ES5 only. Plan v2 item 5: CONSORT 2025 boxes, live SVG, calm mismatch
 * banners (never blocking), PNG and DOCX export. Stored as kind "consort".
 */
(function (G) {
  "use strict";

  var SMD = G.SMD_RESEARCH = G.SMD_RESEARCH || {};
  SMD.screens = SMD.screens || {};

  var ARM_FIELDS = [
    ["allocated", "Allocated"], ["received", "Received the allocated intervention"],
    ["notReceived", "Did not receive it"], ["notReceivedWhy", "Reasons", "text"],
    ["lost", "Lost to follow-up"], ["lostWhy", "Reasons", "text"],
    ["discontinued", "Discontinued the intervention"], ["discontinuedWhy", "Reasons", "text"],
    ["analysed", "Analysed"], ["excludedAnalysis", "Excluded from analysis"], ["excludedAnalysisWhy", "Reasons", "text"]
  ];

  function num(x) { var n = Number(x); return x === "" || x == null || !isFinite(n) ? null : n; }

  function blank(arms) {
    var c = { assessed: "", notMeeting: "", declined: "", otherReasons: "", randomised: "", arms: [] }, i;
    for (i = 0; i < (arms || ["Intervention", "Control"]).length; i++) c.arms.push({ name: (arms || ["Intervention", "Control"])[i] });
    return c;
  }

  /* The four CONSORT sums. Returns plain sentences; empty when everything adds up or is not filled in. */
  function checks(c) {
    var out = [], i, a, alloc = 0, allocKnown = true;
    var ex = [num(c.notMeeting), num(c.declined), num(c.otherReasons)], exSum = 0, exKnown = false;
    for (i = 0; i < ex.length; i++) if (ex[i] !== null) { exSum += ex[i]; exKnown = true; }
    if (num(c.assessed) !== null && num(c.randomised) !== null && exKnown && num(c.assessed) !== exSum + num(c.randomised)) {
      out.push("Assessed (" + num(c.assessed) + ") should equal excluded (" + exSum + ") plus randomised (" + num(c.randomised) + ").");
    }
    for (i = 0; i < c.arms.length; i++) {
      a = c.arms[i];
      if (num(a.allocated) === null) allocKnown = false; else alloc += num(a.allocated);
      if (num(a.allocated) !== null && num(a.received) !== null && num(a.notReceived) !== null && num(a.allocated) !== num(a.received) + num(a.notReceived)) {
        out.push(a.name + ": allocated (" + num(a.allocated) + ") should equal received (" + num(a.received) + ") plus did not receive (" + num(a.notReceived) + ").");
      }
      if (num(a.allocated) !== null && num(a.analysed) !== null && num(a.analysed) + (num(a.excludedAnalysis) || 0) !== num(a.allocated)) {
        out.push(a.name + ": analysed (" + num(a.analysed) + ") plus excluded from analysis (" + (num(a.excludedAnalysis) || 0) + ") should equal allocated (" + num(a.allocated) + ").");
      }
    }
    if (allocKnown && c.arms.length && num(c.randomised) !== null && alloc !== num(c.randomised)) {
      out.push("Randomised (" + num(c.randomised) + ") should equal the sum allocated to the arms (" + alloc + ").");
    }
    return out;
  }

  function show(x) { return x === "" || x == null ? "?" : String(x); }
  function xmlEsc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  function box(x, y, w, lines) {
    var h = 18 + lines.length * 15, s = '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="6" fill="#ffffff" stroke="#555555" stroke-width="1.2"/>', i;
    for (i = 0; i < lines.length; i++) s += '<text x="' + (x + 8) + '" y="' + (y + 18 + i * 15) + '" font-family="Arial, sans-serif" font-size="11" fill="#111111">' + xmlEsc(lines[i]) + '</text>';
    return { svg: s, h: h };
  }

  function why(t) { return t ? "  " + String(t).slice(0, 48) : ""; }

  /* Full SVG string (also used for the PNG export). */
  function svg(c) {
    var W = 360 * Math.max(2, c.arms.length) + 20, cx = W / 2, parts = [], y = 10, b, i, a, colW = 340;
    b = box(cx - 150, y, 300, ["Assessed for eligibility (n = " + show(c.assessed) + ")"]); parts.push(b.svg); var y1 = y + b.h;
    var ex = box(cx + 170, y + b.h + 10, 230, ["Excluded", "Not meeting criteria (n = " + show(c.notMeeting) + ")", "Declined (n = " + show(c.declined) + ")", "Other reasons (n = " + show(c.otherReasons) + ")"]);
    parts.push(ex.svg);
    y = y1 + 20 + ex.h;
    parts.push('<line x1="' + cx + '" y1="' + y1 + '" x2="' + cx + '" y2="' + y + '" stroke="#555555"/>');
    parts.push('<line x1="' + cx + '" y1="' + (y1 + 10 + ex.h / 2) + '" x2="' + (cx + 170) + '" y2="' + (y1 + 10 + ex.h / 2) + '" stroke="#555555"/>');
    b = box(cx - 100, y, 200, ["Randomised (n = " + show(c.randomised) + ")"]); parts.push(b.svg);
    var top = y + b.h + 20, maxY = top;
    for (i = 0; i < c.arms.length; i++) {
      a = c.arms[i];
      var x = 10 + i * (W - 20) / c.arms.length + ((W - 20) / c.arms.length - colW) / 2, yy = top;
      parts.push('<line x1="' + cx + '" y1="' + (y + b.h) + '" x2="' + (x + colW / 2) + '" y2="' + top + '" stroke="#555555"/>');
      var b1 = box(x, yy, colW, ["Allocated to " + a.name + " (n = " + show(a.allocated) + ")", "Received it (n = " + show(a.received) + ")", "Did not receive it (n = " + show(a.notReceived) + ")" + why(a.notReceivedWhy)]);
      parts.push(b1.svg); yy += b1.h + 14;
      var b2 = box(x, yy, colW, ["Lost to follow-up (n = " + show(a.lost) + ")" + why(a.lostWhy), "Discontinued (n = " + show(a.discontinued) + ")" + why(a.discontinuedWhy)]);
      parts.push(b2.svg); yy += b2.h + 14;
      var b3 = box(x, yy, colW, ["Analysed (n = " + show(a.analysed) + ")", "Excluded from analysis (n = " + show(a.excludedAnalysis) + ")" + why(a.excludedAnalysisWhy)]);
      parts.push(b3.svg); yy += b3.h;
      if (yy > maxY) maxY = yy;
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + (maxY + 10) + '" viewBox="0 0 ' + W + ' ' + (maxY + 10) + '"><rect width="100%" height="100%" fill="#ffffff"/>' + parts.join("") + '</svg>';
  }

  function textVersion(c) {
    var lines = ["Assessed for eligibility: " + show(c.assessed),
      "Excluded: not meeting criteria " + show(c.notMeeting) + ", declined " + show(c.declined) + ", other reasons " + show(c.otherReasons),
      "Randomised: " + show(c.randomised)], i, a;
    for (i = 0; i < c.arms.length; i++) {
      a = c.arms[i];
      lines.push(a.name + ": allocated " + show(a.allocated) + "; received " + show(a.received) + "; did not receive " + show(a.notReceived) + why(a.notReceivedWhy) +
        "; lost to follow-up " + show(a.lost) + why(a.lostWhy) + "; discontinued " + show(a.discontinued) + why(a.discontinuedWhy) +
        "; analysed " + show(a.analysed) + "; excluded from analysis " + show(a.excludedAnalysis) + why(a.excludedAnalysisWhy));
    }
    return lines.join("\n");
  }

  var st = { c: null, notice: "" };

  function render(container) {
    var K = SMD.kit, proj = K.project();
    if (!proj) { K.noProject(container); return; }
    st.notice = "";
    container.innerHTML = K.header("CONSORT flow diagram", "Loading...");
    K.load(proj.id, "consort").then(function (v) { st.c = v && v.arms ? v : blank(); draw(container, proj); });
  }

  function draw(container, proj) {
    var K = SMD.kit, c = st.c, h = [], i, j, warn = checks(c);
    h.push(K.header("CONSORT flow diagram", "How patients moved through the trial"));
    for (i = 0; i < warn.length; i++) h.push(K.banner(warn[i]));
    h.push('<div class="rmd-card rmd-mc-tablewrap" style="overflow-x:auto">' + svg(c) + '</div>');
    h.push('<div class="rmd-card rmd-form" data-rmd-cs="top">');
    h.push(K.field({ name: "assessed", label: "Assessed for eligibility", type: "number", value: c.assessed }));
    h.push(K.field({ name: "notMeeting", label: "Excluded: not meeting criteria", type: "number", value: c.notMeeting }));
    h.push(K.field({ name: "declined", label: "Excluded: declined", type: "number", value: c.declined }));
    h.push(K.field({ name: "otherReasons", label: "Excluded: other reasons", type: "number", value: c.otherReasons }));
    h.push(K.field({ name: "randomised", label: "Randomised", type: "number", value: c.randomised }));
    h.push('</div>');
    for (i = 0; i < c.arms.length; i++) {
      h.push('<div class="rmd-card rmd-form" data-rmd-cs-arm="' + i + '">');
      h.push(K.field({ name: "name", label: "Arm name", value: c.arms[i].name }));
      for (j = 0; j < ARM_FIELDS.length; j++) {
        h.push(K.field({ name: ARM_FIELDS[j][0], label: ARM_FIELDS[j][1], type: ARM_FIELDS[j][2] || "number", value: c.arms[i][ARM_FIELDS[j][0]] }));
      }
      h.push('</div>');
    }
    h.push('<div class="rmd-mc-actions"><button type="button" class="rmd-btn rmd-btn-primary" data-rmd-cs="save">Save and redraw</button> ' +
      '<button type="button" class="rmd-btn" data-rmd-cs="png">Save PNG</button> <button type="button" class="rmd-btn" data-rmd-cs="docx">Save DOCX</button></div>');
    if (st.notice) h.push('<p class="rmd-mut" role="status">' + K.esc(st.notice) + '</p>');
    container.innerHTML = '<div class="rmd-cs-screen">' + h.join("") + '</div>';
    container.querySelector('[data-rmd-cs="save"]').onclick = function () {
      var n = K.read(container.querySelector('[data-rmd-cs="top"]'), {}), arms = container.querySelectorAll("[data-rmd-cs-arm]"), k;
      n.arms = [];
      for (k = 0; k < arms.length; k++) n.arms.push(K.read(arms[k], {}));
      K.save(proj.id, "consort", "main", n).then(function () { st.c = n; st.notice = "Saved on this phone."; draw(container, proj); });
    };
    container.querySelector('[data-rmd-cs="png"]').onclick = function () { savePng(svg(st.c)); };
    container.querySelector('[data-rmd-cs="docx"]').onclick = function () {
      var text = textVersion(st.c);
      if (SMD.docxFromSections && SMD.p2 && SMD.p2.downloadBytes) {
        SMD.p2.downloadBytes("consort-flow.docx", SMD.docxFromSections("CONSORT flow diagram", [{ id: "consort", heading: "CONSORT flow diagram", level: 1, text: text }]),
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "CONSORT flow diagram");
      } else K.download("consort-flow.txt", text, "text/plain");
    };
  }

  function savePng(svgText) {
    try {
      var img = new G.Image();
      img.onload = function () {
        var cv = G.document.createElement("canvas"), scale = 2;
        cv.width = img.width * scale; cv.height = img.height * scale;
        var ctx = cv.getContext("2d");
        ctx.scale(scale, scale); ctx.drawImage(img, 0, 0);
        cv.toBlob(function (blob) {
          if (blob && SMD.p2 && SMD.p2.saveFile) SMD.p2.saveFile("consort-flow.png", blob, "CONSORT flow diagram");
        }, "image/png");
      };
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgText);
    } catch (e) {}
  }

  SMD.screens.consort = { render: render, checks: checks, svg: svg, blank: blank, textVersion: textVersion };

})(typeof window !== "undefined" ? window : globalThis);
