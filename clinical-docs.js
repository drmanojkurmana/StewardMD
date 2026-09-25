/* StewardMD - Clinical documents (window.SMD_DOCS).
 *
 * The paperwork every branch writes daily, prepared from the consult and printed or shared by the
 * doctor: medical leave and fitness certificates, a referral letter, consent forms (English, Telugu,
 * Hindi), patient handouts (every specialty kit's advice text, in the same three languages), a police
 * intimation for a medico-legal case, and a cause-of-death draft for MCCD Form 4 / 4A.
 * Nothing is sent anywhere: the document is built on the phone and handed to the OS share sheet (print,
 * save as PDF, WhatsApp) exactly like the prescription (prescription.js rxNativePrint). The doctor's
 * registration number is printed only when verified (SMD_RX.verifiedInfo); otherwise a blank line.
 * Templates and translations: kb/documents/documents.json (scripts/build-documents.mjs; DOCS_V keeps the
 * service-worker cache honest). All templates are ai_drafted and translations machine_drafted until a
 * named reviewer signs them off; the sheet says so. Flag: smd_clinical_docs (default ON, ?docs=0).
 * Buildless ES5 IIFE; the document builders are pure and exported for node tests.
 */
(function (root) {
  "use strict";
  var G = root, D = root.document;
  var DOCS_V = "2974e6d78b78";
  // Heading for the doctor's own procedure-specific risks on a consent form (the template covers the general ones).
  var RISKS_H = { en: "Other risks discussed for this procedure", te: "ఈ ప్రక్రియకు సంబంధించి వివరించిన ఇతర ప్రమాదాలు", hi: "इस प्रक्रिया के लिए बताए गए अन्य जोखिम" };

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function ms(n) { return '<span class="material-symbols-outlined kit-ic" aria-hidden="true">' + n + "</span>"; }
  function flagOn() {
    try {
      var q = (G.location && (G.location.search.match(/[?&]docs=([^&]+)/) || [])[1]);
      if (q === "0" || q === "false") return false; if (q === "1" || q === "true") return true;
      return !(G.localStorage && G.localStorage.getItem("smd_clinical_docs") === "0");
    } catch (e) { return true; }
  }
  function toast(m) { try { (G.toast || G.SMD_toast) && (G.toast || G.SMD_toast)(m); } catch (e) {} }
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtISO(s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || "")); return m ? (+m[3]) + " " + MON[+m[2] - 1] + " " + m[1] : String(s || ""); }
  function todayISO() { var d = new Date(); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  function days(a, b) { var x = /^(\d{4})-(\d{2})-(\d{2})$/.exec(a || ""), y = /^(\d{4})-(\d{2})-(\d{2})$/.exec(b || ""); if (!x || !y) return null; return Math.round((Date.UTC(+y[1], +y[2] - 1, +y[3]) - Date.UTC(+x[1], +x[2] - 1, +x[3])) / 864e5) + 1; }

  /* ================================ document builders (pure) ================================ */
  var LANG_NAME = { en: "English", te: "Telugu", hi: "Hindi" };
  var TYPES = [
    ["leave", "Medical leave certificate", "event_busy"], ["fitness", "Fitness certificate", "verified_user"],
    ["referral", "Referral letter", "forward_to_inbox"], ["consent", "Consent form", "draw"],
    ["handout", "Patient handout", "description"], ["mlc", "Police intimation (MLC)", "gavel"],
    ["mccd", "Cause of death draft (MCCD)", "history_edu"], ["handover", "Shift handover (I-PASS)", "sync_alt"]
  ];
  // Fields per document type: [id, label, type, opts|hint]
  var FORMS = {
    leave: [["name", "Patient name", "text"], ["age", "Age", "text"], ["sex", "Sex", "select", ["Male", "Female", "Other"]], ["dx", "Diagnosis or reason", "textarea"],
      ["from", "Unfit for work or school from", "date"], ["to", "to (inclusive)", "date"], ["resume", "Fit to resume on", "date"], ["remarks", "Remarks", "textarea"]],
    fitness: [["name", "Patient name", "text"], ["age", "Age", "text"], ["sex", "Sex", "select", ["Male", "Female", "Other"]], ["purpose", "Purpose", "select", ["Resuming work or school after illness", "Employment", "Sports", "Travel", "Other"]],
      ["findings", "Relevant findings", "textarea"], ["opinion", "Opinion", "select", ["Fit", "Fit with restrictions", "Temporarily unfit", "Unfit"]], ["restrictions", "Restrictions or conditions", "textarea"]],
    referral: [["name", "Patient name", "text"], ["age", "Age", "text"], ["sex", "Sex", "select", ["Male", "Female", "Other"]], ["to", "Referred to (doctor, department or hospital)", "text"],
      ["urgency", "Urgency", "select", ["Routine", "Soon (within 2 weeks)", "Urgent (within 24 hours)", "Emergency (now)"]], ["reason", "Reason for referral", "textarea"],
      ["history", "History and findings", "textarea"], ["investigations", "Investigations so far", "textarea"], ["treatment", "Treatment given", "textarea"], ["question", "Question for the specialist", "textarea"]],
    consent: [["name", "Patient name", "text"], ["age", "Age", "text"], ["guardian", "Guardian (if the patient is a minor or cannot consent)", "text"], ["operation", "Procedure details (side, site, surgeon)", "textarea"], ["risks", "Risks specific to this procedure, as discussed", "textarea"]],
    handout: [["name", "Patient name (optional)", "text"]],
    mlc: [["ps", "Police station", "text"], ["mlcno", "MLC number", "text"], ["name", "Patient name", "text"], ["age", "Age", "text"], ["sex", "Sex", "select", ["Male", "Female", "Other"]],
      ["address", "Address", "text"], ["broughtBy", "Brought by", "text"], ["when", "Date and time of arrival", "text"], ["history", "Alleged history (as told, with who told it)", "textarea"],
      ["findings", "Injuries or findings in brief", "textarea"], ["condition", "Present condition", "select", ["Stable", "Serious", "Critical", "Brought dead", "Died during treatment"]]],
    handover: [["unit", "Ward or unit", "text"], ["shift", "Shift", "select", ["Morning to evening", "Evening to night", "Night to morning", "Weekend or holiday"]],
      ["from", "Handed over by", "text"], ["to", "Handed over to", "text"]],
    mccd: [["name", "Name of the deceased", "text"], ["age", "Age", "text"], ["sex", "Sex", "select", ["Male", "Female", "Other"]], ["when", "Date and time of death", "text"],
      // Form 4 / 4A Part I has three lines, (a) to (c); the lowest line used is the underlying cause.
      ["c0", "Part I (a) immediate cause", "text"], ["i0", "Interval (a)", "text"], ["c1", "(b) due to (or as a consequence of)", "text"], ["i1", "Interval (b)", "text"],
      ["c2", "(c) due to (or as a consequence of)", "text"], ["i2", "Interval (c)", "text"],
      ["p2", "Part II other significant conditions", "textarea"], ["manner", "Manner of death", "select", ["Natural", "Accident", "Suicide", "Homicide", "Pending investigation"]]]
  };
  function line(label, v) { return v ? "<p><b>" + esc(label) + ":</b> " + esc(v) + "</p>" : ""; }
  function para(v) { return v ? "<p>" + esc(v).replace(/\n/g, "<br>") + "</p>" : ""; }
  function who(v) { return [v.name, v.age ? v.age + (/^\d+$/.test(String(v.age).trim()) ? " years" : "") : "", v.sex].filter(Boolean).join(", "); }

  /** Pure: the body HTML of a document. v = field values, x = { doc, bundle, lang, advice } */
  function bodyHtml(type, v, x) {
    v = v || {}; x = x || {};
    if (type === "leave") {
      var n = days(v.from, v.to);
      return "<p>This is to certify that " + esc(who(v) || "the patient") + " was examined by me and was suffering from " + esc(v.dx || "an illness") + ".</p>" +
        (v.from ? "<p>In my opinion the patient was unfit for work or school from " + esc(fmtISO(v.from)) + (v.to ? " to " + esc(fmtISO(v.to)) + (n ? " (" + n + " day" + (n === 1 ? "" : "s") + ")" : "") : "") + ".</p>" : "") +
        (v.resume ? "<p>The patient is fit to resume duties on " + esc(fmtISO(v.resume)) + ".</p>" : "") + line("Remarks", v.remarks);
    }
    if (type === "fitness") {
      return "<p>This is to certify that I have examined " + esc(who(v) || "the patient") + (v.purpose ? " for the purpose of: " + esc(v.purpose.toLowerCase()) : "") + ".</p>" +
        line("Relevant findings", v.findings) + (v.opinion ? "<p><b>Opinion:</b> " + esc(v.opinion) + ".</p>" : "") + line("Restrictions or conditions", v.restrictions);
    }
    if (type === "referral") {
      return line("To", v.to) + line("Patient", who(v)) + line("Urgency", v.urgency) + line("Reason for referral", v.reason) + line("History and findings", v.history) +
        line("Investigations so far", v.investigations) + line("Treatment given", v.treatment) + line("Question for you", v.question) + "<p>Thank you for seeing this patient.</p>";
    }
    if (type === "consent") {
      var c = x.consent, L = x.lang || "en"; if (!c) return "<p>Choose a consent template.</p>";
      var t = function (o) { return (o && (o[L] || o.en)) || ""; };
      return '<p class="dl-proc"><b>' + esc(t(c.procedure)) + "</b>" + (v.operation ? "<br>" + esc(v.operation) : "") + "</p>" + line("Patient", who(v)) + line("Guardian", v.guardian) +
        (c.sections || []).map(function (s) {
          return "<h3>" + esc(t(s.heading)) + "</h3>" + (s.text ? para(t(s.text)) : "") + (s.items ? "<ul>" + ((s.items[L] || s.items.en) || []).map(function (i) { return "<li>" + esc(i) + "</li>"; }).join("") + "</ul>" : "");
        }).join("") + (v.risks ? "<h3>" + esc(t(RISKS_H)) + "</h3>" + para(v.risks) : "") + '<div class="dl-decl">' + para(t(c.declaration)) + "</div>" +
        '<table class="dl-sign"><tr><td>Patient or guardian<br><br>Signature ______________________<br>Name and relation ______________________</td><td>Witness<br><br>Signature ______________________<br>Name ______________________</td></tr></table>';
    }
    if (type === "handout") {
      var items = x.advice || [];
      if (!items.length) return "<p>Choose the advice to print.</p>";
      return (v.name ? "<p>For: " + esc(v.name) + "</p>" : "") + items.map(function (a) { return "<h3>" + esc(a.title) + "</h3>" + para(a.text); }).join("");
    }
    if (type === "mlc") {
      return "<p>To,<br>The Station House Officer,<br>" + esc(v.ps || "____________ Police Station") + "</p>" +
        "<p>Sir or Madam,</p><p>This is to inform you that " + esc(who(v) || "a patient") + (v.address ? ", resident of " + esc(v.address) : "") + ", was brought to this hospital" +
        (v.broughtBy ? " by " + esc(v.broughtBy) : "") + (v.when ? " on " + esc(v.when) : "") + " and has been registered as a medico-legal case" + (v.mlcno ? " (MLC No. " + esc(v.mlcno) + ")" : "") + ".</p>" +
        line("Alleged history", v.history) + line("Injuries or findings in brief", v.findings) + line("Present condition", v.condition) + "<p>Kindly take necessary action.</p>";
    }
    if (type === "handover") {
      var pts = x.handover || [], SEV = { unstable: "Unstable", watcher: "Watcher", stable: "Stable" };
      return line("Ward or unit", v.unit) + line("Shift", v.shift) + line("Handed over by", v.from) + line("Handed over to", v.to) +
        (pts.length ? '<table class="dl-table"><thead><tr><th>Bed / patient</th><th>Illness severity</th><th>Patient summary</th><th>Action list</th><th>Situation awareness and contingency</th></tr></thead><tbody>' +
          pts.map(function (p) { return "<tr><td>" + esc(p.bed || "") + "</td><td>" + esc(SEV[p.sev] || "") + "</td><td>" + esc(p.summary || "").replace(/\n/g, "<br>") + "</td><td>" + esc(p.actions || "").replace(/\n/g, "<br>") + "</td><td>" + esc(p.cont || "").replace(/\n/g, "<br>") + "</td></tr>"; }).join("") +
          "</tbody></table>" : "<p>No patients added.</p>") +
        '<p class="dl-note">I-PASS: Illness severity, Patient summary, Action list, Situation awareness and contingency planning, Synthesis by the receiver (read back the plan together).</p>';
    }
    if (type === "mccd") {
      var rows = [0, 1, 2].filter(function (i) { return v["c" + i]; }).map(function (i) { return "<tr><td>(" + "abc".charAt(i) + ")</td><td>" + esc(v["c" + i]) + "</td><td>" + esc(v["i" + i] || "") + "</td></tr>"; }).join("");
      return line("Deceased", who(v)) + line("Date and time of death", v.when) +
        '<h3>Part I</h3><table class="dl-table"><thead><tr><th></th><th>Disease or condition</th><th>Interval between onset and death</th></tr></thead><tbody>' + (rows || '<tr><td colspan="3">Not filled</td></tr>') + "</tbody></table>" +
        "<h3>Part II</h3>" + para(v.p2 || "None stated") + line("Manner of death", v.manner) +
        '<p class="dl-note">Draft for transcription onto the official Form 4 (institutional) or Form 4A (non-institutional) death certificate. This draft is not the certificate.</p>';
    }
    return "";
  }
  /** Pure: a complete, self-contained HTML document for printing or sharing. */
  function documentHtml(type, v, x) {
    x = x || {}; var doc = x.doc || {}, clinic = x.clinic || {}, L = x.lang || "en";
    var title = (TYPES.filter(function (t) { return t[0] === type; })[0] || [0, "Document"])[1];
    if (type === "consent" && x.consent) title = (x.consent.title && (x.consent.title[L] || x.consent.title.en)) || title;
    var head = (clinic.name || clinic.address || clinic.phone) ? '<header class="dl-head"><div class="dl-cn">' + esc(clinic.name || "") + "</div><div>" + esc([clinic.address, clinic.phone].filter(Boolean).join(" | ")) + "</div></header>"
      : '<header class="dl-head"><div class="dl-cn">' + esc(doc.name ? "Dr " + String(doc.name).replace(/^Dr\.?\s*/i, "") : "") + "</div></header>";
    var sign = type === "handout" ? "" : '<div class="dl-signdoc"><div>Date: ' + esc(fmtISO(x.date || todayISO())) + '</div><div class="dl-sig">Signature and seal<br><br><b>' + esc(doc.name ? "Dr " + String(doc.name).replace(/^Dr\.?\s*/i, "") : "Doctor's name ______________________") + "</b>" +
      (doc.degree ? "<br>" + esc(doc.degree + (doc.speciality ? ", " + doc.speciality : "")) : "") + "<br>Reg. No. " + esc(doc.regNo || "______________________") + "</div></div>";
    var foot = x.footer ? '<footer class="dl-foot">' + esc(x.footer) + "</footer>" : "";
    return '<!doctype html><html lang="' + L + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + esc(title) + "</title><style>" +
      "body{font:14px/1.55 system-ui,-apple-system,'Segoe UI',Roboto,'Noto Sans Telugu','Noto Sans Devanagari',sans-serif;color:#111;margin:0;padding:28px 32px;max-width:760px}" +
      ".dl-head{border-bottom:2px solid #00685f;padding-bottom:8px;margin-bottom:14px;font-size:12.5px;color:#333}.dl-cn{font-size:18px;font-weight:700;color:#00685f}" +
      "h1{font-size:19px;margin:6px 0 14px;text-align:center;letter-spacing:.01em}h3{font-size:14.5px;margin:14px 0 4px}ul{margin:4px 0 8px 20px;padding:0}li{margin:2px 0}" +
      ".dl-decl{margin-top:16px;padding:10px 12px;border:1px solid #bbb;border-radius:6px}.dl-sign,.dl-table{width:100%;border-collapse:collapse;margin-top:14px}.dl-sign td{width:50%;vertical-align:top;padding:8px;font-size:13px}" +
      ".dl-table th,.dl-table td{border:1px solid #bbb;padding:6px 8px;text-align:left;font-size:13px}.dl-signdoc{display:flex;justify-content:space-between;align-items:flex-end;margin-top:34px;font-size:13px}.dl-sig{text-align:right}" +
      ".dl-note{font-size:12px;color:#555;margin-top:12px}.dl-foot{margin-top:28px;border-top:1px solid #ddd;padding-top:6px;font-size:10.5px;color:#777}@media print{body{padding:12mm}}" +
      "</style></head><body>" + head + "<h1>" + esc(title) + "</h1>" + bodyHtml(type, v, x) + sign + foot + "</body></html>";
  }

  /* ======================================== state ======================================== */
  var BUNDLE = null, pend = null, PROF = {}, KITB = null;
  // handover: kept in memory only (never stored on the phone); the doctor shares it before closing.
  var S = { type: "", vals: {}, lang: "en", consentId: "", adviceSel: {}, advQ: "", kitId: "", ctx: null, regNo: "", handover: [] };
  function load() {
    if (BUNDLE) return Promise.resolve(BUNDLE); if (pend) return pend;
    pend = fetch("/kb/documents/documents.json?v=" + encodeURIComponent(DOCS_V)).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (b) { BUNDLE = b; pend = null; return b; }, function (e) { pend = null; throw e; });
    return pend;
  }
  function kitsBundle() {
    if (KITB) return Promise.resolve(KITB);
    if (!(G.SMD_KITS && G.SMD_KITS.loadKits)) return Promise.resolve(null);
    return G.SMD_KITS.loadKits().then(function (b) { KITB = b; return b; }, function () { return null; });
  }
  if (D && D.addEventListener) D.addEventListener("smd:profile-loaded", function (e) { var d = (e && e.detail) || {}; PROF = { degree: d.degree || "", speciality: d.speciality || "" }; });
  function doctor() {
    var name = "";
    try { var p = G.SMD_ACCOUNT && G.SMD_ACCOUNT.profile && G.SMD_ACCOUNT.profile(); name = (p && (p.name || p.displayName)) || ""; } catch (e) {}
    if (!name) { try { var a = JSON.parse(G.localStorage.getItem("stewardmd_account") || "null"); name = (a && (a.name || a.displayName)) || ""; } catch (e) {} }
    return { name: name, degree: PROF.degree || "", speciality: PROF.speciality || "", regNo: S.regNo };
  }
  function clinic() { try { return (G.SMD_RX && G.SMD_RX.getClinic && G.SMD_RX.getClinic()) || {}; } catch (e) { return {}; } }
  function consentList() { return (BUNDLE && BUNDLE.consent) || []; }
  function consentById(id) { return consentList().filter(function (c) { return c.id === id; })[0] || null; }
  // Every advice text in every kit, in the chosen language when a translation exists.
  // The kit the documents were opened from comes first, so its advice is at the top of the list.
  function adviceAll() {
    var out = [], tr = (BUNDLE && BUNDLE.handouts && BUNDLE.handouts[S.lang]) || null, first = S.kitId;
    ((KITB && KITB.kits) || []).slice().sort(function (a, b) { return (b.id === first) - (a.id === first); }).forEach(function (k) {
      (k.advice || []).forEach(function (a) {
        var key = k.id + "/" + a.id, t = tr && tr.texts && tr.texts[key];
        out.push({ key: key, kit: k.short || k.label, title: t ? t.title : a.title, text: t ? t.text : a.text, translated: !!t || S.lang === "en" });
      });
    });
    return out;
  }
  // Ticked items always stay visible; the search matches the specialty, title and text.
  function adviceListHtml() {
    var q = String(S.advQ || "").toLowerCase().trim();
    var list = adviceAll().filter(function (a) { return !q || S.adviceSel[a.key] || (a.kit + " " + a.title + " " + a.text).toLowerCase().indexOf(q) >= 0; });
    return list.length ? list.map(function (a) {
      return '<label class="kit-check"><input type="checkbox" data-dl-adv="' + esc(a.key) + '"' + (S.adviceSel[a.key] ? " checked" : "") + "><span><b>" + esc(a.kit) + ":</b> " + esc(a.title) + (a.translated ? "" : " (English)") + "</span></label>";
    }).join("") : '<p class="kit-muted">No advice matches.</p>';
  }
  // Prefill from the open consult (OPD host passes patient + assessment values; nothing is stored).
  function prefill(type) {
    var c = S.ctx || {}, p = c.patient || {}, a = c.vals || {}, v = {};
    if (p.name) v.name = p.name; if (p.age) v.age = String(p.age); if (/^m/i.test(p.sex || "")) v.sex = "Male"; else if (/^f/i.test(p.sex || "")) v.sex = "Female";
    var dx = a.provisional_diagnosis || "";
    if (type === "leave") { v.dx = dx; v.from = todayISO(); }
    if (type === "referral") { v.reason = dx; v.history = [a.Chief_complaints_duration, a.History_present_illness].filter(Boolean).join("\n"); v.treatment = a.management_plan || ""; }
    if (type === "fitness") v.findings = dx ? "Treated for " + dx + "." : "";
    return v;
  }

  /* ======================================== sheet ======================================== */
  function reviewNote() {
    if (S.type === "consent") {
      var c = consentById(S.consentId);
      if (c && c.review) return '<div class="kit-status" role="note">' + ms("info") + "<span><strong>Draft template, pending clinical review" + (S.lang !== "en" && c.review.translation !== "reviewed" ? " and a native-speaker check of the " + LANG_NAME[S.lang] + " translation" : "") + ".</strong> Explain the procedure yourself and follow your hospital's consent policy.</span></div>";
    }
    if (S.type === "handout" && S.lang !== "en") return '<div class="kit-status" role="note">' + ms("translate") + "<span><strong>Machine-drafted " + LANG_NAME[S.lang] + " translation, pending a native-speaker check.</strong> Items without a translation print in English.</span></div>";
    if (S.type === "mlc" || S.type === "mccd") return '<div class="kit-status" role="note">' + ms("gavel") + "<span><strong>Draft format.</strong> Check the format your hospital and state require before signing.</span></div>";
    return "";
  }
  function fieldHtml(f) {
    var id = "dl_" + f[0], v = S.vals[f[0]] == null ? "" : S.vals[f[0]], lab = '<span class="kit-fl">' + esc(f[1]) + "</span>";
    if (f[2] === "select") return '<label class="kit-field" for="' + id + '">' + lab + '<select id="' + id + '" class="kit-inp" data-dl-f="' + f[0] + '"><option value=""></option>' + f[3].map(function (o) { return '<option' + (o === v ? " selected" : "") + ">" + esc(o) + "</option>"; }).join("") + "</select></label>";
    if (f[2] === "textarea") return '<label class="kit-field wide" for="' + id + '">' + lab + '<textarea id="' + id + '" rows="3" class="kit-inp" data-dl-f="' + f[0] + '">' + esc(v) + "</textarea></label>";
    return '<label class="kit-field" for="' + id + '">' + lab + '<input id="' + id + '" class="kit-inp" type="' + (f[2] === "date" ? "date" : "text") + '" data-dl-f="' + f[0] + '" value="' + esc(v) + '"></label>';
  }
  function langRow() {
    return '<div class="kit-row" role="group" aria-label="Language">' + ["en", "te", "hi"].map(function (l) {
      return '<button type="button" class="kit-seg' + (S.lang === l ? " on" : "") + '" data-dl-act="lang:' + l + '" aria-pressed="' + (S.lang === l) + '">' + LANG_NAME[l] + "</button>";
    }).join("") + "</div>";
  }
  function render() {
    var el = D && D.getElementById("smdDocs"); if (!el) return;
    var body = el.querySelector(".kit-sheet-body"), top = body.scrollTop, html;
    if (!S.type) {
      html = '<p class="kit-muted">Prepared on this phone from the consult, then printed or shared by you. Nothing is sent anywhere.</p><div class="dl-types">' +
        TYPES.map(function (t) { return '<button type="button" class="dl-type" data-dl-act="type:' + t[0] + '">' + ms(t[2]) + "<span>" + esc(t[1]) + "</span></button>"; }).join("") + "</div>";
    } else {
      var t = TYPES.filter(function (x) { return x[0] === S.type; })[0], extra = "";
      if (S.type === "consent") {
        if (!BUNDLE) { load().then(render, function () { toast("Consent templates could not be loaded."); }); extra = '<p class="kit-muted">Loading templates…</p>'; }
        else extra = langRow() + '<div class="kit-links">' + consentList().map(function (c) { return '<button type="button" class="kit-pill' + (c.id === S.consentId ? " on" : "") + '" data-dl-act="consent:' + esc(c.id) + '">' + esc(c.title.en) + "</button>"; }).join("") + "</div>";
      }
      if (S.type === "handout") {
        if (!BUNDLE || !KITB) { Promise.all([load().catch(function () { return null; }), kitsBundle()]).then(render); extra = '<p class="kit-muted">Loading advice texts…</p>'; }
        else extra = langRow() + '<label class="kit-field wide" for="dl_advq"><span class="kit-fl">Find advice</span><input id="dl_advq" type="search" class="kit-inp" data-dl-q value="' + esc(S.advQ) + '" placeholder="e.g. fever, diabetes, wound" autocomplete="off"></label>' +
          '<div data-dl-advlist>' + adviceListHtml() + "</div>";
      }
      if (S.type === "handover") extra = handoverHtml();
      html = '<button type="button" class="kit-link" data-dl-act="back">' + ms("arrow_back") + "All documents</button><h2 class=\"dl-h\">" + esc(t[1]) + "</h2>" + reviewNote() +
        '<div class="kit-grid">' + FORMS[S.type].map(fieldHtml).join("") + "</div>" + extra +
        '<div class="kit-row"><button type="button" class="kit-add" data-dl-act="print">' + ms("ios_share") + "Print or share</button>" +
        '<button type="button" class="kit-clear" data-dl-act="preview">Preview</button>' +
        ((S.type === "referral" || S.type === "handover") && G.SMD_SHARE && G.SMD_SHARE.on && G.SMD_SHARE.on() ? '<button type="button" class="kit-pill" data-dl-act="kxsend">' + ms("send") + (S.type === "referral" ? "Send to a colleague in StewardMD" : "Send to the receiving doctor") + "</button>" : "") +
        '</div><div class="dl-preview" hidden></div>';
    }
    body.innerHTML = '<div class="kit dl">' + html + "</div>";
    body.scrollTop = top;
  }
  function handoverHtml() {
    var SEV = [["unstable", "Unstable"], ["watcher", "Watcher"], ["stable", "Stable"]];
    return '<div class="kit-status" role="note">' + ms("lock_clock") + "<span><strong>Not saved on this phone.</strong> Share or print the handover before you close the app. Use bed numbers or initials where you can.</span></div>" +
      S.handover.map(function (p, i) {
        var f = function (k, lab, rows) { return '<label class="kit-field wide" for="dlh_' + i + "_" + k + '"><span class="kit-fl">' + esc(lab) + '</span><textarea id="dlh_' + i + "_" + k + '" rows="' + rows + '" class="kit-inp" data-dl-h="' + i + ":" + k + '">' + esc(p[k] || "") + "</textarea></label>"; };
        return '<fieldset class="kit-ms"><legend>Patient ' + (i + 1) + '</legend><div class="kit-grid">' +
          '<label class="kit-field" for="dlh_' + i + '_bed"><span class="kit-fl">Bed or initials</span><input id="dlh_' + i + '_bed" class="kit-inp" data-dl-h="' + i + ':bed" value="' + esc(p.bed || "") + '"></label>' +
          '<label class="kit-field" for="dlh_' + i + '_sev"><span class="kit-fl">Illness severity</span><select id="dlh_' + i + '_sev" class="kit-inp" data-dl-h="' + i + ':sev"><option value=""></option>' +
          SEV.map(function (x) { return '<option value="' + x[0] + '"' + (p.sev === x[0] ? " selected" : "") + ">" + x[1] + "</option>"; }).join("") + "</select></label>" +
          f("summary", "Patient summary (diagnosis, course, current status)", 3) + f("actions", "Action list (what, who, by when)", 3) + f("cont", "Situation awareness and contingency (if this, then that)", 2) +
          '</div><div class="kit-row"><button type="button" class="kit-clear" data-dl-act="hrm:' + i + '">Remove patient ' + (i + 1) + "</button></div></fieldset>";
      }).join("") + '<div class="kit-row"><button type="button" class="kit-clear" data-dl-act="hadd">' + ms("person_add") + "Add a patient</button></div>";
  }
  function currentX() {
    var x = { doc: doctor(), clinic: clinic(), lang: S.lang, date: todayISO() };
    if (S.type === "consent") { x.consent = consentById(S.consentId); x.footer = "Template " + (x.consent ? x.consent.id + ", " + x.consent.review.compiled : "") + ". Use together with your hospital's consent process."; }
    if (S.type === "handover") x.handover = S.handover;
    if (S.type === "handout") { var sel = adviceAll().filter(function (a) { return S.adviceSel[a.key]; }); x.advice = sel; x.footer = "Advice from StewardMD specialty kits. Ask your doctor if you have questions."; }
    return x;
  }
  function open(opts) {
    if (!D || !flagOn()) return;
    opts = opts || {};
    var el = D.getElementById("smdDocs");
    if (!el) {
      el = D.createElement("div"); el.id = "smdDocs"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Clinical documents");
      el.innerHTML = '<div class="kit-sheet"><header class="kit-sheet-top"><button type="button" class="kit-x" data-dl-act="close" aria-label="Close documents">' + ms("close") + '</button><h1>Clinical documents</h1><span></span></header><div class="kit-sheet-body"></div></div>';
      D.body.appendChild(el);
    }
    S.ctx = opts.ctx || null; S.type = opts.type || ""; S.vals = S.type ? prefill(S.type) : {};
    if (opts.consentId) S.consentId = opts.consentId;
    S.kitId = opts.kitId || ""; S.kitSummary = opts.kitSummary || ""; S.advQ = "";
    el.classList.add("on");
    if (G.SMD_RX && G.SMD_RX.verifiedInfo) G.SMD_RX.verifiedInfo().then(function (v) { S.regNo = (v && v.verified && v.regNo) || ""; }, function () {});
    render();
  }
  function close() { var el = D && D.getElementById("smdDocs"); if (el) el.classList.remove("on"); S.ctx = null; S.vals = {}; S.adviceSel = {}; S.advQ = ""; S.kitSummary = ""; S.handover = []; }

  // Output exactly as the prescription does: native = file + OS share sheet; web = hidden iframe print.
  function output(html, name) {
    var C = G.Capacitor, P = (C && C.Plugins) || {}, native = false;
    try { native = !!(C && (C.isNativePlatform ? C.isNativePlatform() : C.isNative)); } catch (e) {}
    if (native && P.Filesystem && P.Filesystem.writeFile && P.Share && P.Share.share) {
      P.Filesystem.writeFile({ path: "stewardmd-" + name + ".html", data: html, directory: "CACHE", encoding: "utf8" })
        .then(function (res) { return P.Share.share({ title: "StewardMD document", url: res.uri, dialogTitle: "Print or share" }); })
        .catch(function () { toast("Could not open the share sheet."); });
      return;
    }
    try {
      var f = D.createElement("iframe"); f.setAttribute("aria-hidden", "true"); f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
      D.body.appendChild(f); var d = f.contentWindow.document; d.open(); d.write(html); d.close();
      setTimeout(function () { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) {} setTimeout(function () { try { f.remove(); } catch (e) {} }, 1500); }, 300);
    } catch (e) { toast("Printing is not available here."); }
  }

  function onClick(e) {
    var b = e.target && e.target.closest && e.target.closest("[data-dl-act]"); if (!b || !b.closest("#smdDocs")) return;
    var act = b.getAttribute("data-dl-act"), i = act.indexOf(":"), cmd = i < 0 ? act : act.slice(0, i), arg = i < 0 ? "" : act.slice(i + 1);
    if (cmd === "close") { close(); return; }
    if (cmd === "back") { S.type = ""; S.vals = {}; render(); return; }
    if (cmd === "type") { S.type = arg; S.vals = prefill(arg); S.adviceSel = {}; render(); var bd = D.querySelector("#smdDocs .kit-sheet-body"); if (bd) bd.scrollTop = 0; return; }
    if (cmd === "lang") { S.lang = arg; render(); return; }
    if (cmd === "hadd") { S.handover.push({}); render(); return; }
    if (cmd === "hrm") { S.handover.splice(+arg, 1); render(); return; }
    if (cmd === "consent") { S.consentId = arg; render(); return; }
    // Wave 2 (kits-share.js): the same content, sent to a verified colleague instead of printed.
    if (cmd === "kxsend" && G.SMD_SHARE) {
      var v = S.vals;
      if (S.type === "referral") G.SMD_SHARE.compose({ kind: "referral", kitId: S.kitId, urgency: v.urgency || "Routine", payload: { patient: { name: v.name || "", age: v.age || "", sex: v.sex || "" },
        reason: v.reason || "", history: v.history || "", investigations: v.investigations || "", treatment: v.treatment || "", question: v.question || "", kitSummary: S.kitSummary || "" } });
      else { if (!S.handover.length) { toast("Add at least one patient."); return; } G.SMD_SHARE.compose({ kind: "handover", payload: { unit: v.unit || "", shift: v.shift || "", rows: S.handover.slice() } }); }
      return;
    }
    if (cmd === "preview" || cmd === "print") {
      if (S.type === "consent" && !consentById(S.consentId)) { toast("Choose a consent template first."); return; }
      if (S.type === "handover" && !S.handover.length) { toast("Add at least one patient."); return; }
      if (S.type === "handout" && !adviceAll().some(function (a) { return S.adviceSel[a.key]; })) { toast("Tick at least one advice text."); return; }
      var html = documentHtml(S.type, S.vals, currentX());
      if (cmd === "print") { output(html, S.type); return; }
      var pv = D.querySelector("#smdDocs .dl-preview");
      if (pv) { pv.hidden = false; pv.innerHTML = '<iframe title="Document preview" class="dl-frame"></iframe>'; var fr = pv.querySelector("iframe"); fr.srcdoc = html; }
    }
  }
  function onInput(e) {
    var el = e.target; if (!el || !el.closest || !el.closest("#smdDocs")) return;
    var f = el.getAttribute("data-dl-f"); if (f) { S.vals[f] = el.value; return; }
    var h = el.getAttribute("data-dl-h"); if (h) { var hp = h.split(":"), row = S.handover[+hp[0]]; if (row) row[hp[1]] = el.value; return; }
    var a = el.getAttribute("data-dl-adv"); if (a) { if (el.checked) S.adviceSel[a] = true; else delete S.adviceSel[a]; return; }
    if (el.hasAttribute("data-dl-q")) { S.advQ = el.value; var box = D.querySelector("#smdDocs [data-dl-advlist]"); if (box) box.innerHTML = adviceListHtml(); }
  }
  if (D && D.addEventListener && !G.__smdDocsWired) {
    G.__smdDocsWired = true;
    D.addEventListener("click", onClick, false); D.addEventListener("input", onInput, false); D.addEventListener("change", onInput, false);
  }

  var API = { open: open, close: close, on: flagOn, load: load, TYPES: TYPES, FORMS: FORMS, DOCS_V: DOCS_V,
    _bodyHtml: bodyHtml, _documentHtml: documentHtml, _forms: FORMS, _setBundle: function (b) { BUNDLE = b; }, _setKits: function (b) { KITB = b; }, _state: function () { return S; }, _prefill: prefill };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  G.SMD_DOCS = API;
})(typeof window !== "undefined" ? window : globalThis);
