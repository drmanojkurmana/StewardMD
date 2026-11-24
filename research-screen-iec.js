/* StewardMD - ResearchMD ethics committee (IEC) screen, all study types.
 * ES5 IIFE. Registers SMD.screens.iec and replaces the item 0 stub with the
 * real window.RMDIec.status(projectId). Plan item 7.
 * Record: RMDStore kind iec, id "iec", value { status, reference, date, packet }.
 * Case report variant never blocks. Study variant shows the ICMR 2017 line and
 * a calm banner until the committee approves or grants a waiver.
 * No em or en dashes.
 */
(function (G) {
  "use strict";
  var SMD = G.SMD_RESEARCH = G.SMD_RESEARCH || {};
  SMD.screens = SMD.screens || {};
  var KEY = "iec";
  var STATUSES = ["none", "submitted", "approved", "waiver"];
  var STATUS_LABELS = {
    none: "Not submitted",
    submitted: "Submitted",
    approved: "Approved",
    waiver: "Waiver granted"
  };
  var PACKET_ITEMS = [
    { key: "protocol", label: "Protocol (the study plan)" },
    { key: "pisEn", label: "Participant information sheet and consent (English)" },
    { key: "pisLocal", label: "Participant information sheet and consent (local language)" },
    { key: "crf", label: "Case record form (the data collection sheet)" },
    { key: "cv", label: "Investigator CV" }
  ];

  function esc(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function labelFor(name) {
    var C = G.SMD_RESEARCH_CONTRACTS;
    if (C && C.STEP_LABELS && C.STEP_LABELS[name]) return C.STEP_LABELS[name];
    return name;
  }

  function emptyRecord() {
    return {
      status: "none", reference: "", date: "",
      packet: { protocol: false, pisEn: false, pisLocal: false, crf: false, cv: false }
    };
  }

  function normRecord(v) {
    var rec = emptyRecord(), i, item;
    if (!v || typeof v !== "object") return rec;
    if (STATUSES.indexOf(v.status) >= 0) rec.status = v.status;
    if (typeof v.reference === "string") rec.reference = v.reference;
    if (typeof v.date === "string") rec.date = v.date;
    if (v.packet && typeof v.packet === "object") {
      for (i = 0; i < PACKET_ITEMS.length; i++) {
        item = PACKET_ITEMS[i];
        rec.packet[item.key] = !!v.packet[item.key];
      }
    }
    return rec;
  }

  /* Real status reader. Same shape as the item 0 stub: Promise of
   * "none" | "submitted" | "approved" | "waiver". Never rejects. */
  function iecStatus(projectId) {
    var store = G.RMDStore;
    if (!store || !store.get || !projectId) return Promise.resolve("none");
    return store.get(projectId, "iec", "iec").then(function (v) {
      var rec = normRecord(v);
      return rec.status;
    }).catch(function () { return "none"; });
  }

  var st = null;

  function freshState(pid, mode) {
    return { pid: pid, mode: mode, container: null, rec: emptyRecord(), loading: true, error: null, saved: false };
  }

  /* Journeys normalise the study type: casefile means a case study; with a
   * master chart it is a series (study rules), otherwise a single case report. */
  function modeFor(proj) {
    var journey = SMD.journeyFor ? SMD.journeyFor(proj) : [];
    for (var i = 0; i < journey.length; i++) {
      if (journey[i] === "casefile") return journey.indexOf("masterchart") >= 0 ? "series" : "report";
    }
    return "study";
  }

  function injectCss() {
    var D = G.document;
    if (!D || D.getElementById("rmdIecCss")) return;
    var s = D.createElement("style");
    s.id = "rmdIecCss";
    s.textContent = [
      "#researchMD .rmd-iec-packet { list-style: none; margin: 8px 0 0; padding: 0; }",
      "#researchMD .rmd-iec-packet li { display: flex; gap: 10px; align-items: flex-start; padding: 10px 0; border-top: 1px solid var(--rmd-line); min-height: 44px; }",
      "#researchMD .rmd-iec-packet li:first-child { border-top: 0; }",
      "#researchMD .rmd-iec-packet input[type=checkbox] { width: 22px; height: 22px; margin-top: 2px; flex: 0 0 auto; accent-color: var(--rmd-acc); }",
      "#researchMD .rmd-iec-packet label { font: 400 14px/1.4 var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-iec-savestatus { font: 400 12.5px var(--rmd-f); color: var(--rmd-mut); margin: 6px 0 0; }",
      /* Shared base only forces 44px targets at iPad width and skips date inputs; scope phone fixes here. */
      "#researchMD .rmd-iec-screen .rmd-btn, #researchMD .rmd-iec-screen label.rmd-btn { min-height: 44px; }",
      "#researchMD .rmd-iec-screen input[type=text], #researchMD .rmd-iec-screen input[type=date], #researchMD .rmd-iec-screen select { min-height: 44px; }",
      "#researchMD .rmd-iec-screen input[type=date] { width: 100%; border: 1px solid var(--rmd-line); border-radius: 8px; padding: 9px 12px; font: 400 14.5px var(--rmd-f); color: var(--rmd-ink); background: var(--rmd-panel); }"
    ].join("\n");
    D.head.appendChild(s);
  }

  function stepBannerHtml() {
    var proj = SMD.store && SMD.store.getActiveProject ? SMD.store.getActiveProject() : null;
    var journey = SMD.journeyFor ? SMD.journeyFor(proj) : [];
    var idx = -1, i;
    for (i = 0; i < journey.length; i++) if (journey[i] === KEY) idx = i;
    var nextName = (idx >= 0 && idx + 1 < journey.length) ? journey[idx + 1] : "";
    var stepNo = idx >= 0 ? idx + 1 : 1;
    var stepCount = journey.length || 1;
    var nextLabel = nextName ? labelFor(nextName) : "continue when this step is ready";
    var h = '<div class="rmd-step-banner" role="status">';
    h += '<div class="rmd-step-line"><span class="rmd-step-text"><strong>Step ' + stepNo + ' of ' + stepCount + '</strong> ' + esc(labelFor(KEY)) + '</span></div>';
    h += '</div>';
    h += '<p class="rmd-next-line">Next: ' + esc(nextLabel) + '</p>';
    return h;
  }

  function cleared() { return st.rec.status === "approved" || st.rec.status === "waiver"; }

  function draw() {
    if (!st || !st.container) return;
    var h = [], i, item, checked, ready = 0;
    h.push('<div class="rmd-p2-screen rmd-' + KEY + '-screen">');
    h.push(stepBannerHtml());
    if (st.loading) {
      h.push('<div class="rmd-card">' + (SMD.p2 ? SMD.p2.loadingHtml("Opening the ethics step") : "Loading") + '</div>');
      h.push('</div>');
      st.container.innerHTML = h.join("");
      return;
    }
    h.push('<div class="rmd-card">');
    h.push('<h3>Ethics committee</h3>');
    if (st.mode === "report") {
      h.push('<div class="rmd-banner rmd-banner-info" role="note">Ask your ethics committee or HOD whether they need to review it; many institutions issue a permission or waiver letter. Patient consent is still needed.</div>');
    } else {
      h.push('<div class="rmd-banner rmd-banner-info" role="note">Under ICMR 2017 guidelines, only the ethics committee can decide that a study is exempt; you cannot decide it yourself.</div>');
      if (!cleared()) {
        h.push('<div class="rmd-banner rmd-banner-warn" role="status">The committee has not approved this study yet. Prepare your documents now, and enter patient data only after approval or a waiver.</div>');
      }
    }
    if (st.error) {
      h.push(SMD.p2 ? SMD.p2.errHtml(st.error, "iec-retry") : '<div class="rmd-banner rmd-banner-error" role="alert">' + esc(st.error.message) + '</div>');
    }
    h.push('<div class="rmd-form">');
    var sel = '<select id="rmdIecStatus" data-rmd-iec-field="status">';
    for (i = 0; i < STATUSES.length; i++) {
      sel += '<option value="' + STATUSES[i] + '"' + (st.rec.status === STATUSES[i] ? " selected" : "") + '>' + esc(STATUS_LABELS[STATUSES[i]]) + '</option>';
    }
    sel += '</select>';
    h.push('<div class="rmd-field"><label for="rmdIecStatus">Status</label>' + sel + '</div>');
    h.push('<div class="rmd-field"><label for="rmdIecRef">Approval or permission reference</label>');
    h.push('<input type="text" id="rmdIecRef" data-rmd-iec-field="reference" value="' + esc(st.rec.reference) + '" autocomplete="off" placeholder="Letter number from the committee"></div>');
    h.push('<div class="rmd-field"><label for="rmdIecDate">Date on the letter</label>');
    h.push('<input type="date" id="rmdIecDate" data-rmd-iec-field="date" value="' + esc(st.rec.date) + '"></div>');
    h.push('</div>');
    if (cleared()) {
      h.push('<p class="rmd-muted" role="status">Keep the letter. Journals will ask for this reference number at submission.</p>');
    }
    h.push('</div>');

    h.push('<div class="rmd-card">');
    h.push('<h3>Packet checklist</h3>');
    h.push('<p class="rmd-muted">' + (st.mode === "report" ? "If your committee asks for a packet, these are the usual documents." : "Tick each document as it is ready. The committee usually asks for all of these.") + '</p>');
    h.push('<ul class="rmd-iec-packet">');
    for (i = 0; i < PACKET_ITEMS.length; i++) {
      item = PACKET_ITEMS[i];
      checked = st.rec.packet[item.key];
      if (checked) ready++;
      h.push('<li><input type="checkbox" id="rmdIecPk' + i + '" data-rmd-iec-packet="' + item.key + '"' + (checked ? " checked" : "") + '><label for="rmdIecPk' + i + '">' + esc(item.label) + '</label></li>');
    }
    h.push('</ul>');
    h.push('<p class="rmd-muted" role="status">' + ready + ' of ' + PACKET_ITEMS.length + ' ready</p>');
    h.push('<p class="rmd-iec-savestatus" id="rmdIecSaveStatus" role="status" aria-live="polite">' + (st.saved ? "Saved on this phone." : "") + '</p>');
    h.push('</div>');
    h.push('</div>');
    st.container.innerHTML = h.join("");
    bind();
  }

  function save() {
    var store = G.RMDStore;
    if (!store || !st) return Promise.resolve();
    var snapshot = normRecord(st.rec);
    return store.put(st.pid, "iec", "iec", snapshot).then(function (res) {
      if (res && res.ok === false) {
        st.error = { message: (res.warnings && res.warnings[0]) || "Could not save the ethics step on this phone." };
        draw();
        return;
      }
      st.saved = true;
      var el = st.container && st.container.querySelector("#rmdIecSaveStatus");
      if (el) el.textContent = "Saved on this phone.";
    }).catch(function () {
      st.error = { message: "Could not save the ethics step on this phone. Try again." };
      draw();
    });
  }

  function bind() {
    var c = st.container, i, els;
    els = c.querySelectorAll("[data-rmd-iec-field]");
    for (i = 0; i < els.length; i++) {
      els[i].onchange = function () {
        var field = this.getAttribute("data-rmd-iec-field");
        st.rec[field] = this.value;
        st.saved = false;
        if (field === "status") {
          save();
          draw();
        } else {
          save();
        }
      };
    }
    els = c.querySelectorAll("[data-rmd-iec-packet]");
    for (i = 0; i < els.length; i++) {
      els[i].onchange = function () {
        st.rec.packet[this.getAttribute("data-rmd-iec-packet")] = this.checked;
        st.saved = false;
        save();
        draw();
      };
    }
    c.onclick = function (ev) {
      var el = ev.target, attr;
      while (el && el !== c) {
        if (el.getAttribute) {
          attr = el.getAttribute("data-rmd");
          if (attr === "iec-retry") {
            st.error = null;
            load();
            return;
          }
        }
        el = el.parentNode;
      }
    };
  }

  function load() {
    var store = G.RMDStore;
    if (!store || !store.get) {
      st.loading = false;
      st.error = { message: "Research storage is not available on this device yet." };
      draw();
      return;
    }
    st.loading = true;
    draw();
    store.get(st.pid, "iec", "iec").then(function (v) {
      st.rec = normRecord(v);
      st.loading = false;
      st.saved = !!v;
      draw();
    }).catch(function () {
      st.loading = false;
      st.error = { message: "Could not open the ethics step on this phone. Try again." };
      draw();
    });
  }

  function render(container, params) {
    if (!container) return;
    var proj = SMD.store && SMD.store.getActiveProject ? SMD.store.getActiveProject() : null;
    var pid = (params && params.projectId) || (proj && proj.id) || "local";
    st = freshState(pid, modeFor(proj));
    st.container = container;
    injectCss();
    load();
  }

  G.RMDIec = { status: iecStatus };
  SMD.screens[KEY] = { render: render };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { render: render, status: iecStatus, emptyRecord: emptyRecord, normRecord: normRecord, STATUSES: STATUSES };
  }
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
