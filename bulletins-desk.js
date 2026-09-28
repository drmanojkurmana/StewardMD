/* StewardMD - Clinical Bulletins signing desk (window.SMD_BULLETINS_DESK), the "Clinical updates" tab of the
 * Review Desk (review-desk.js). Shown only to registered signers and owners (GET /api/updates/bulletins/me).
 *
 * Unlike the other Review Desk tabs (decisions kept on the phone, exported as JSON), this tab talks to the
 * server: a signature only means something if the server attests who made it. The preview is drawn by
 * SMD_BULLETINS.card, the same function the disease reader uses, and the sign request carries the hash of
 * the exact text previewed; the server refuses it if anything changed since. Buildless ES5.
 */
(function (root) {
  "use strict";
  var G = root, D = root.document;
  var BASE = "/api/updates/bulletins";
  var TYPE_KIND = { safety_alert: "safety", drug_approval: "approval", guideline: "guideline", trial: "trial" };
  var CHECKS = [
    ["source_read", "I have read the primary source, not only the summary."],
    ["numbers_match", "Every number in this bulletin matches the source."],
    ["india_checked", "I have checked the India (CDSCO) status."],
    ["own_words", "It is written in my own words (at most one quoted sentence)."],
  ];
  var FIELD_LABEL = {
    headline: "Headline", what_changed: "What changed", applies_to: "Applies to", evidence_note: "Evidence note",
    source_label: "Source name", source_url: "Source link", source_date: "Source date", doi: "DOI", pmid: "PMID",
    kind: "Type", evidence_type: "Evidence type", regulator: "Regulator", india_status: "India status",
    review_months: "Review interval", disease_ids: "Diseases", update_id: "Source item",
  };
  var ERR = {
    required: "is required", "too-short": "is too short", "too-long": "is too long", invalid: "is not valid",
    "not-https": "must be an https link", future: "cannot be in the future", unknown: "has a disease the app does not know",
    "too-many": "has more than 5 diseases", "em-dash": "contains an em-dash; use a comma or full stop",
  };

  // "Draft from source": suggestions only. The signer rewrites in their own words and checks every number;
  // India status is never pre-filled (it must be a conscious choice), and nothing is ever signed automatically.
  var TYPE_EVID = { safety_alert: "regulatory_safety", drug_approval: "regulatory_approval", guideline: "guideline", trial: "rct" };
  var REGS = [["FDA", /\bFDA\b|Food and Drug Administration/i], ["EMA", /\bEMA\b|European Medicines Agency/i], ["MHRA", /\bMHRA\b/i],
    ["CDSCO", /\bCDSCO\b/i], ["WHO", /\bWHO\b|World Health Organi[sz]ation/i], ["ICMR", /\bICMR\b|Indian Council of Medical Research/i]];
  function firstSentences(s, max) {
    s = String(s || "").replace(/\*\*/g, "").replace(/^[\s\u2022*-]+/gm, "").replace(/\s+/g, " ").trim();
    if (s.length <= max) return s;
    var cut = s.slice(0, max), end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
    return (end > Math.min(60, max / 2) ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "")).trim();
  }
  // Numbers a signer must check against the source (percentages, ratios, intervals, doses, counts).
  function numbersIn(s) {
    var out = [], seen = {};
    String(s || "").replace(/\b(?:HR|RR|OR|NNT|ARR|CI|P)\b[^.;,]{0,24}?\d[\d.,\u2013-]*%?|\d[\d.,]*\s?(?:%|(?:mg\/kg|mg|mcg|g|mL|ml|units?|IU|months?|weeks?|days?|years?|patients|participants)\b)|\d+\.\d+/gi, function (m) {
      m = m.trim(); if (!seen[m] && out.length < 12) { seen[m] = 1; out.push(m); } return m;
    });
    return out;
  }
  // Library diseases named in the source text: whole-word match on the disease name, longest names first.
  function suggestDiseases(text, have) {
    var b = (G.KB_ENRICHMENT && G.KB_ENRICHMENT.byId) || {}, t = " " + String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ") + " ", out = [];
    Object.keys(b).map(function (k) { return [k, String((b[k] && b[k].name) || "")]; })
      .filter(function (x) { return x[1].length >= 5; })
      .sort(function (x, y) { return y[1].length - x[1].length; })
      .forEach(function (x) {
        if (out.length >= 6 || (have || []).indexOf(x[0]) >= 0) return;
        var n = " " + x[1].toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + " ";
        if (t.indexOf(n) >= 0 && !out.some(function (o) { return (" " + o[1].toLowerCase() + " ").indexOf(n) >= 0; })) out.push(x);
      });
    return out;
  }
  // CDSCO lookup: evidence for the signer's India choice, never the choice itself.
  function cdscoQuery(c) {
    if (c._cq != null) return c._cq;
    var m = String((c._src || {}).title || "").match(/\(([^)]{4,80})\)/);
    return m ? m[1] : "";
  }
  function cdscoPanel(c) {
    var r = c._cdsco, out = '<div class="kit-field wide"><span class="kit-fl">Check the CDSCO new-drug lists (generic name)</span><div class="kit-row">' +
      '<input id="bl_cq" class="kit-inp" maxlength="160" value="' + esc(cdscoQuery(c)) + '" autocomplete="off">' +
      '<button type="button" class="kit-pill" data-bl-act="cdsco">' + ms("search") + "Check</button></div>";
    if (r && r.error) out += '<p class="kit-muted" role="status">' + esc(r.error) + "</p>";
    else if (r && !(r.checked || []).length) out += '<p class="kit-muted" role="status">The CDSCO lists have not been downloaded yet. They refresh with the daily sync.</p>';
    else if (r && r.matches.length) out += '<div class="bl-cdsco found" role="status"><b>Found in the CDSCO lists.</b> Choose "Approved by CDSCO" only if it is the same drug, form and indication.<ul>' +
      r.matches.map(function (m) { return "<li>" + esc(m.list) + (m.date ? ", approved " + esc(m.date) : "") + ": " + esc(m.excerpt) + "</li>"; }).join("") + "</ul></div>";
    else if (r) {
      var yrs = r.checked.map(function (x) { return x.year; }), upd = Math.max.apply(null, r.checked.map(function (x) { return x.fetched_ts || 0; }));
      out += '<div class="bl-cdsco" role="status"><b>Not found</b> in the CDSCO new-drug lists for ' + esc(Math.min.apply(null, yrs) + " to " + Math.max.apply(null, yrs)) +
        " (updated " + esc(isoDate(upd)) + "). That does not prove it is unapproved in India: older approvals and new strengths are published elsewhere.</div>";
    }
    return out + "</div>";
  }

  function draftFromSource(c) {
    var s = c._src || {}, text = [s.title, s.summary].join(" ");
    c.headline = c.headline || String(s.title || "").slice(0, 120);
    c.what_changed = firstSentences(s.summary, 400);
    c.evidence_type = c.evidence_type || TYPE_EVID[s.type] || "";
    if (!c.regulator) { for (var i = 0; i < REGS.length; i++) if (REGS[i][1].test([s.org, s.title].join(" "))) { c.regulator = REGS[i][0]; break; } }
    c._drafted = true;
    c._suggest = suggestDiseases(text, c.disease_ids);
  }

  var DS = { me: null, probing: null, view: "list", queue: null, loading: false, cur: null, saved: null, msg: "", busy: false, dq: "", signers: null, look: null };

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function ms(n) { return '<span class="material-symbols-outlined kit-ic" aria-hidden="true">' + n + "</span>"; }
  function toast(m) { try { (G.toast || G.SMD_toast) && (G.toast || G.SMD_toast)(m); } catch (e) {} }
  function rerender() { try { if (G.SMD_REVIEW && G.SMD_REVIEW._render) G.SMD_REVIEW._render(); } catch (e) {} }
  function B() { return G.SMD_BULLETINS; }

  function token() {
    try { var u = G.SMD_AUTH && G.SMD_AUTH.currentUser; return (u && u.getIdToken) ? u.getIdToken() : Promise.resolve(null); } catch (e) { return Promise.resolve(null); }
  }
  function api(method, path, body) {
    return token().then(function (t) {
      var h = { "Content-Type": "application/json" };
      if (t) h.Authorization = "Bearer " + t;
      return G.fetch((G.SMD_API_BASE || "") + BASE + path, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
    }).then(function (r) {
      return r.json().then(function (d) { return { status: r.status, data: d || {} }; }, function () { return { status: r.status, data: {} }; });
    }, function () { return { status: 0, data: { error: "offline" } }; });
  }

  /* ---------------- gating ---------------- */
  function probe() {
    if (DS.probing) return DS.probing;
    DS.probing = api("GET", "/me").then(function (r) {
      DS.me = r.status === 200 ? r.data : null;
      return !!(DS.me && (DS.me.canSign || DS.me.isOwner));
    }).then(function (on) { DS.probing = null; return on; });
    return DS.probing;
  }

  function loadQueue() {
    DS.loading = true;
    return api("GET", "/queue").then(function (r) {
      DS.loading = false;
      if (r.status === 200) DS.queue = r.data; else DS.msg = "Could not load the queue (" + (r.data.reason || r.data.error || r.status) + ").";
      rerender();
    });
  }
  function loadSigners() {
    return api("GET", "/signers").then(function (r) { DS.signers = r.status === 200 ? r.data.signers : []; rerender(); });
  }

  /* ---------------- helpers ---------------- */
  function isoDate(ts) { var d = new Date(Number(ts) || 0); return isNaN(d.getTime()) || !ts ? "" : d.toISOString().slice(0, 10); }
  function diseaseName(id) { var b = G.KB_ENRICHMENT && G.KB_ENRICHMENT.byId; return (b && b[id] && b[id].name) || id; }
  function fromCandidate(c) {
    return {
      update_id: c.id, kind: TYPE_KIND[c.type] || "", headline: String(c.title || "").slice(0, 120), what_changed: "", applies_to: "",
      evidence_type: "", evidence_note: "", regulator: "", india_status: "", source_label: c.organization || "",
      source_url: B() && B()._httpsUrl(c.official_url) ? c.official_url : "", source_date: isoDate(c.published_ts),
      doi: c.doi || "", pmid: c.pmid || "", review_months: 12, disease_ids: [],
      _src: { title: c.title, org: c.organization, url: c.official_url, date: c.published_ts, summary: c.summary, type: c.type },
    };
  }
  function fromItem(it) {
    var o = {};
    ["id", "update_id", "kind", "headline", "what_changed", "applies_to", "evidence_type", "evidence_note", "regulator", "india_status",
      "source_label", "source_url", "source_date", "doi", "pmid", "review_months", "updated_ts", "body_hash", "state"].forEach(function (k) { o[k] = it[k]; });
    o.disease_ids = (it.disease_ids || []).slice();
    o._src = { title: it.u_title, org: it.u_org, url: it.u_url, date: it.u_published_ts, summary: it.u_summary, change: it.source_change };
    return o;
  }
  // What the bedside would show if this were signed now by the current signer.
  function previewOf(c) {
    var s = (DS.me && DS.me.signer) || {}, t = Date.now();
    return {
      kind: c.kind, headline: c.headline, what_changed: c.what_changed, applies_to: c.applies_to, evidence_type: c.evidence_type,
      evidence_note: c.evidence_note, india_status: c.india_status, source_label: c.source_label, source_url: c.source_url, source_date: c.source_date,
      signed_name: s.name || "", signed_reg: s.regNo || "", signed_council: s.council || "", signed_ts: t,
      review_due_ts: t + (Number(c.review_months) || 12) * 2629800000,
    };
  }
  function errText(r) {
    var d = r.data || {};
    if (d.error === "invalid" && d.errors) return d.errors.map(function (e) { return (FIELD_LABEL[e.field] || e.field) + " " + (ERR[e.code] || e.code); }).join(". ") + ".";
    if (d.error === "changed" || d.error === "stale") return "The text changed. Review it again before signing.";
    if (d.error === "source-changed") return "The source changed since this draft was saved. Read the source again, save, then sign.";
    if (d.error === "checklist-incomplete") return "Tick every item before signing.";
    if (d.reason === "not-a-signer") return "You are not registered as a signer.";
    if (d.error === "offline") return "No connection. Try again when online.";
    return "Could not save (" + (d.error || r.status) + ").";
  }
  function sel(id, opts, cur, blank) {
    return '<select id="' + id + '" class="kit-inp">' + (blank ? '<option value="">Choose</option>' : "") + opts.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (String(cur) === String(o[0]) ? " selected" : "") + ">" + esc(o[1]) + "</option>";
    }).join("") + "</select>";
  }
  function field(id, label, input, wide) { return '<label class="kit-field' + (wide ? " wide" : "") + '" for="' + id + '"><span class="kit-fl">' + label + "</span>" + input + "</label>"; }
  function txt(id, v, max, rows) {
    return rows ? '<textarea id="' + id + '" class="kit-inp" rows="' + rows + '" maxlength="' + max + '">' + esc(v || "") + "</textarea>"
      : '<input id="' + id + '" class="kit-inp" maxlength="' + max + '" value="' + esc(v || "") + '">';
  }
  function val(id) { var el = D.getElementById(id); return el ? el.value : ""; }

  // Copy form inputs into DS.cur so a re-render (disease chip, search) never loses typing.
  function collect() {
    var c = DS.cur; if (!c || !D.getElementById("bl_headline")) return;
    ["headline", "what_changed", "applies_to", "evidence_note", "source_label", "source_url", "source_date", "doi", "pmid",
      "kind", "evidence_type", "regulator", "india_status", "review_months"].forEach(function (k) { c[k] = val("bl_" + k); });
    c.review_months = Number(c.review_months) || 12;
    if (D.getElementById("bl_cq")) c._cq = val("bl_cq");
  }

  /* ---------------- views ---------------- */
  function rowBtn(act, title, sub, pill) {
    return '<button type="button" class="rv-row" data-bl-act="' + esc(act) + '"><span class="rv-t">' + esc(title) + '</span><span class="rv-s">' + esc(sub || "") + "</span>" + (pill ? "<span>" + pill + "</span>" : "") + "</button>";
  }
  function section(title, rows) { return rows.length ? '<h3 class="dl-h">' + esc(title) + " (" + rows.length + ')</h3><div class="rv-list">' + rows.join("") + "</div>" : ""; }

  function listView(tabs) {
    var me = DS.me || {}, q = DS.queue;
    var head = tabs + (DS.msg ? '<p class="kit-muted" role="status">' + esc(DS.msg) + "</p>" : "");
    if (me.killed) head += '<p class="rv-pill" role="status">Practice updates are switched off for everyone.</p>';
    var tools = "";
    if (me.isOwner) {
      tools = '<div class="kit-row"><button type="button" class="kit-pill" data-bl-act="signers">' + ms("badge") + "Signers</button>" +
        '<button type="button" class="kit-pill" data-bl-act="kill">' + ms(me.killed ? "toggle_on" : "block") + (me.killed ? "Switch back on" : "Switch off for everyone") + "</button></div>";
    }
    if (!me.canSign) {
      return head + '<p class="kit-muted">Practice updates appear on the disease page only after a registered doctor signs them. ' +
        (me.isOwner ? "You can manage signers. Add yourself to sign." : "You are not registered to sign.") + "</p>" + tools;
    }
    if (!q) { if (!DS.loading) loadQueue(); return head + tools + '<p class="kit-muted">Loading…</p>'; }
    var items = q.items || [], soon = Date.now() + 30 * 86400000;
    var by = function (f) { return items.filter(f).map(function (it) { return rowBtn("edit:" + it.id, it.headline, (it.disease_ids || []).map(diseaseName).join(", "), '<span class="rv-pill">' + esc(stateLabel(it)) + "</span>"); }); };
    return head + tools +
      '<p class="kit-muted">Write each update in your own words from the primary source. Nothing reaches the disease page until it is signed, and any later change takes it off until it is signed again.</p>' +
      section("Source changed, review again", by(function (i) { return i.state === "source_changed"; })) +
      section("Review due", by(function (i) { return i.state === "review_due" || (i.state === "live" && i.review_due_ts < soon); })) +
      section("Drafts", by(function (i) { return i.state === "draft" || i.state === "edited"; })) +
      section("New sources without a bulletin", (q.candidates || []).map(function (c) { return rowBtn("new:" + c.id, c.title, (c.organization || "") + " " + isoDate(c.published_ts), '<span class="rv-pill">Write one</span>'); })) +
      section("Live on the disease page", by(function (i) { return i.state === "live" && !(i.review_due_ts < soon); })) +
      section("Disease no longer in the library", by(function (i) { return (i.orphaned || []).length > 0; })) +
      (items.length || (q.candidates || []).length ? "" : '<p class="kit-muted">Nothing to review.</p>');
  }
  function stateLabel(it) {
    return { live: "Live", draft: "Draft", edited: "Edited, needs signing", source_changed: "Source changed", review_due: "Review due", source_missing: "Source removed" }[it.state] || it.state;
  }

  function sourcePanel(c) {
    var s = c._src || {};
    var ch = s.change && s.change.whats_changed_json ? (function () { try { return JSON.parse(s.change.whats_changed_json) || []; } catch (e) { return []; } })() : [];
    return '<div class="kit-card"><p class="kit-fl">Source item</p><p><b>' + esc(s.title || "") + "</b></p>" +
      '<p class="kit-muted">' + esc(s.org || "") + (s.date ? ", " + esc(isoDate(s.date)) : "") + "</p>" +
      (B() && B()._httpsUrl(s.url) ? '<p><a href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">Open the primary source</a></p>' : "") +
      (ch.length ? '<p class="kit-fl">What changed in the source</p><ul>' + ch.map(function (x) { return "<li>" + esc(x.topic || "") + ": " + esc(x.previous || "") + " to " + esc(x.current || "") + "</li>"; }).join("") + "</ul>" : "") +
      (s.summary ? '<details><summary>AI summary, not reviewed</summary><p class="kit-muted">' + esc(String(s.summary).slice(0, 1500)) + "</p></details>" : "") + "</div>";
  }

  function diseasePicker(c) {
    var b = (G.KB_ENRICHMENT && G.KB_ENRICHMENT.byId) || {}, q = DS.dq.toLowerCase().trim(), hits = [];
    if (q.length >= 2) {
      var keys = Object.keys(b);
      for (var i = 0; i < keys.length && hits.length < 8; i++) {
        var nm = String((b[keys[i]] && b[keys[i]].name) || keys[i]);
        if (nm.toLowerCase().indexOf(q) >= 0 && c.disease_ids.indexOf(keys[i]) < 0) hits.push([keys[i], nm]);
      }
    }
    return '<div class="kit-field wide"><span class="kit-fl">Diseases this applies to (1 to 5)</span><div class="kit-row">' +
      c.disease_ids.map(function (d) { return '<button type="button" class="kit-pill" data-bl-act="undz:' + esc(d) + '" aria-label="Remove ' + esc(diseaseName(d)) + '">' + esc(diseaseName(d)) + " " + ms("close") + "</button>"; }).join("") + "</div>" +
      ((c._suggest || []).filter(function (x) { return c.disease_ids.indexOf(x[0]) < 0; }).length ? '<div class="kit-row"><span class="kit-fl">Named in the source:</span>' +
        c._suggest.filter(function (x) { return c.disease_ids.indexOf(x[0]) < 0; }).map(function (x) { return '<button type="button" class="kit-pill" data-bl-act="dz:' + esc(x[0]) + '">' + ms("add") + esc(x[1]) + "</button>"; }).join("") + "</div>" : "") +
      '<input id="bl_dq" type="search" class="kit-inp" placeholder="Search the library" autocomplete="off" value="' + esc(DS.dq) + '">' +
      (hits.length ? '<div class="rv-list">' + hits.map(function (h) { return rowBtn("dz:" + h[0], h[1], h[0]); }).join("") + "</div>" : "") + "</div>";
  }

  function editView() {
    var c = DS.cur, Bk = B();
    var kinds = [["safety", "Safety alert"], ["approval", "New approval"], ["guideline", "Guideline change"], ["trial", "Trial result"]];
    var evid = Object.keys(Bk.EVID).map(function (k) { return [k, Bk.EVID[k]]; });
    var india = Object.keys(Bk.INDIA).map(function (k) { return [k, Bk.INDIA[k][0]]; });
    var regs = [["", "None"], ["FDA", "FDA"], ["EMA", "EMA"], ["MHRA", "MHRA"], ["CDSCO", "CDSCO"], ["WHO", "WHO"], ["ICMR", "ICMR"], ["SOCIETY", "Professional society"]];
    return '<button type="button" class="kit-link" data-bl-act="back">' + ms("arrow_back") + "Back to the queue</button>" +
      '<h2 class="dl-h">' + (c.id ? "Edit bulletin" : "New bulletin") + "</h2>" +
      (DS.msg ? '<p class="kit-muted" role="alert">' + esc(DS.msg) + "</p>" : "") + sourcePanel(c) +
      ((c._src || {}).summary && !c.id ? '<div class="kit-row"><button type="button" class="kit-pill" data-bl-act="draft">' + ms("edit_note") + "Draft from source</button></div>" : "") +
      (c._drafted ? '<p class="bl-drafted" role="status">Drafted from the AI summary. Rewrite it in your own words and check every number against the primary source before signing. India status is yours to set.</p>' : "") +
      '<div class="kit-grid">' +
      field("bl_kind", "Type", sel("bl_kind", kinds, c.kind, true)) +
      field("bl_india_status", "India status", sel("bl_india_status", india, c.india_status, true), true) +
      cdscoPanel(c) +
      field("bl_headline", "Headline (up to 120 characters)", txt("bl_headline", c.headline, 120), true) +
      field("bl_what_changed", "What changed (up to 400)", txt("bl_what_changed", c.what_changed, 400, 4), true) +
      field("bl_applies_to", "Applies to (population)", txt("bl_applies_to", c.applies_to, 200), true) +
      field("bl_evidence_type", "Evidence type", sel("bl_evidence_type", evid, c.evidence_type, true)) +
      field("bl_regulator", "Regulator", sel("bl_regulator", regs, c.regulator, false)) +
      field("bl_evidence_note", "Evidence note (only a grade the source itself states)", txt("bl_evidence_note", c.evidence_note, 120), true) +
      field("bl_source_label", "Source name (journal, regulator notice)", txt("bl_source_label", c.source_label, 160), true) +
      field("bl_source_url", "Source link (https)", txt("bl_source_url", c.source_url, 500), true) +
      field("bl_source_date", "Source date", '<input id="bl_source_date" type="date" class="kit-inp" value="' + esc(c.source_date || "") + '">') +
      field("bl_review_months", "Review again in", sel("bl_review_months", [["6", "6 months"], ["12", "12 months"], ["24", "24 months"]], c.review_months, false)) +
      field("bl_doi", "DOI (optional)", txt("bl_doi", c.doi, 100)) +
      field("bl_pmid", "PMID (optional)", txt("bl_pmid", c.pmid, 10)) +
      diseasePicker(c) + "</div>" +
      (function () {
        var nums = numbersIn(c.what_changed + " " + c.applies_to + " " + c.headline);
        return nums.length ? '<div class="bl-nums"><span class="kit-fl">Numbers to check against the source</span><div class="kit-row">' +
          nums.map(function (n) { return '<span class="bl-num">' + esc(n) + "</span>"; }).join("") + "</div></div>" : "";
      })() +
      '<p class="kit-fl">Preview, exactly as the disease page will show it</p><div class="bl-preview">' + Bk.card(previewOf(c)) + "</div>" +
      '<div class="kit-row"><button type="button" class="kit-add" data-bl-act="save"' + (DS.busy ? " disabled" : "") + ">" + ms("save") + "Save draft</button>" +
      '<button type="button" class="kit-pill" data-bl-act="savesign"' + (DS.busy ? " disabled" : "") + ">" + ms("verified") + "Save and sign</button>" +
      (c.id ? '<button type="button" class="kit-clear" data-bl-act="retract">Retract</button>' : "") + "</div>" +
      (c.id && DS.cur._retracting ? '<label class="kit-field wide" for="bl_rreason"><span class="kit-fl">Why is it being retracted? (10 to 300 characters)</span>' + txt("bl_rreason", "", 300, 2) + '</label><div class="kit-row"><button type="button" class="kit-clear" data-bl-act="retractgo">Retract now</button></div>' : "");
  }

  function signView() {
    var it = DS.saved, s = (DS.me && DS.me.signer) || {};
    return '<button type="button" class="kit-link" data-bl-act="toedit">' + ms("arrow_back") + "Back to editing</button>" +
      '<h2 class="dl-h">Sign this bulletin</h2>' + (DS.msg ? '<p class="kit-muted" role="alert">' + esc(DS.msg) + "</p>" : "") +
      '<div class="bl-preview">' + B().card(previewOf(it)) + "</div>" +
      '<fieldset class="kit-field wide"><legend class="kit-fl">Before you sign</legend>' + CHECKS.map(function (c) {
        return '<label class="kit-check"><input type="checkbox" id="bl_ck_' + c[0] + '"> ' + esc(c[1]) + "</label>";
      }).join("<br>") + "</fieldset>" +
      '<div class="kit-row"><button type="button" class="kit-add" data-bl-act="signgo"' + (DS.busy ? " disabled" : "") + ">" + ms("verified") +
      "Sign as " + esc(/^dr\.?\s/i.test(s.name || "") ? s.name : "Dr " + (s.name || "")) + ", Reg. No. " + esc(s.regNo || "") + "</button></div>";
  }

  function signersView() {
    var me = DS.me || {}, L = DS.look;
    if (!DS.signers) loadSigners();
    return '<button type="button" class="kit-link" data-bl-act="back">' + ms("arrow_back") + "Back to the queue</button><h2 class=\"dl-h\">Signers</h2>" +
      (DS.msg ? '<p class="kit-muted" role="status">' + esc(DS.msg) + "</p>" : "") +
      '<p class="kit-muted">Only doctors listed here can sign. Check each name and registration number against the NMC register before saving.</p>' +
      '<div class="rv-list">' + (DS.signers || []).map(function (s) {
        return '<div class="rv-row"><span class="rv-t">' + esc(s.name) + '</span><span class="rv-s">Reg. No. ' + esc(s.reg_no) + ", " + esc(s.council) + "</span><span>" +
          (s.active ? '<button type="button" class="kit-clear" data-bl-act="deact:' + esc(s.uid) + '">Remove</button>' : '<span class="rv-pill">Removed</span>') + "</span></div>";
      }).join("") + "</div>" +
      '<h3 class="dl-h">Add a signer</h3><div class="kit-row">' + (me.self ? '<button type="button" class="kit-pill" data-bl-act="addme">' + ms("person_add") + "Add me</button>" : "") + "</div>" +
      field("bl_lemail", "Or find a verified doctor by email", '<input id="bl_lemail" type="email" class="kit-inp" autocomplete="off">', true) +
      '<div class="kit-row"><button type="button" class="kit-pill" data-bl-act="lookup">Find</button></div>' +
      (L ? '<div class="kit-grid">' + (L.verified === false ? '<p class="kit-muted" role="alert">This account is not a verified doctor, so it cannot be added.</p>' : "") +
        field("bl_sname", "Name as on the register", txt("bl_sname", L.name, 120), true) + field("bl_sreg", "Registration number", txt("bl_sreg", L.reg_no, 40)) +
        field("bl_scouncil", "Council", txt("bl_scouncil", L.council, 120)) + '</div><div class="kit-row"><button type="button" class="kit-add" data-bl-act="saveSigner">Save signer</button></div>' : "");
  }

  function killView() {
    var on = !(DS.me && DS.me.killed);
    return '<button type="button" class="kit-link" data-bl-act="back">' + ms("arrow_back") + "Back to the queue</button>" +
      '<h2 class="dl-h">' + (on ? "Switch off practice updates for everyone" : "Switch practice updates back on") + "</h2>" +
      '<p class="kit-muted">' + (on ? "Every phone stops showing them on its next sync. Nothing is deleted." : "Signed, current updates show again on each phone's next sync.") + "</p>" +
      field("bl_kreason", "Reason (10 to 300 characters)", txt("bl_kreason", "", 300, 3), true) +
      '<div class="kit-row"><button type="button" class="' + (on ? "kit-clear" : "kit-add") + '" data-bl-act="killgo">' + (on ? "Switch off now" : "Switch on") + "</button></div>";
  }

  function deskCSS() {
    if (!D || D.getElementById("smdBulletinDeskCss")) return;
    var s = D.createElement("style"); s.id = "smdBulletinDeskCss";
    s.textContent = ".bl-drafted{margin:8px 0;padding:8px 10px;border-radius:10px;background:rgba(180,83,9,.1);color:#92400e;font-size:13px;font-weight:600}" +
      ".bl-cdsco{margin:6px 0;padding:8px 10px;border-radius:10px;background:rgba(100,116,139,.1);font-size:13px}.bl-cdsco.found{background:rgba(15,118,110,.1)}.bl-cdsco ul{margin:6px 0 0;padding-left:18px}" +
      ".bl-nums{margin:8px 0}.bl-num{display:inline-block;margin:2px 4px 2px 0;padding:2px 8px;border-radius:999px;background:rgba(180,83,9,.12);color:#92400e;font:600 12px var(--sans,system-ui)}" +
      "body.dark .bl-drafted,body.dark .bl-num{color:#fbbf24}";
    (D.head || D.documentElement).appendChild(s);
  }
  function html(tabs) {
    if (!B()) return tabs + '<p class="kit-muted">Not available in this build.</p>';
    B().injectCSS(); deskCSS();
    if (DS.view === "edit" && DS.cur) return editView();
    if (DS.view === "sign" && DS.saved) return signView();
    if (DS.view === "signers") return signersView();
    if (DS.view === "kill") return killView();
    return listView(tabs || "");
  }

  /* ---------------- actions ---------------- */
  function save(thenSign) {
    collect();
    var c = DS.cur, body = {};
    Object.keys(c).forEach(function (k) { if (k.charAt(0) !== "_" && k !== "state" && k !== "body_hash") body[k] = c[k]; });
    DS.busy = true; DS.msg = ""; rerender();
    return api("POST", "", body).then(function (r) {
      DS.busy = false;
      if (r.status !== 200) { DS.msg = errText(r); rerender(); return; }
      var it = r.data.item, src = c._src;
      DS.cur = fromItem(it); DS.cur._src = src;
      DS.queue = null;
      if (thenSign) { DS.saved = Object.assign({}, DS.cur); DS.view = "sign"; }
      else DS.msg = "Draft saved. It is not on the disease page until you sign it.";
      rerender();
    });
  }
  function signGo() {
    var cl = {}, missing = false;
    CHECKS.forEach(function (c) { var el = D.getElementById("bl_ck_" + c[0]); cl[c[0]] = !!(el && el.checked); if (!cl[c[0]]) missing = true; });
    if (missing) { DS.msg = "Tick every item before signing."; rerender(); return; }
    DS.busy = true; DS.msg = ""; rerender();
    api("POST", "/" + encodeURIComponent(DS.saved.id) + "/sign", { body_hash: DS.saved.body_hash, checklist: cl }).then(function (r) {
      DS.busy = false;
      if (r.status !== 200) {
        DS.msg = errText(r);
        if (r.status === 409) { DS.view = "edit"; DS.queue = null; }
        rerender(); return;
      }
      toast("Signed. It shows on the disease page after the next sync.");
      DS.view = "list"; DS.cur = null; DS.saved = null; DS.queue = null; DS.msg = "Signed.";
      try { B().sync(true); } catch (e) {}
      rerender();
    });
  }

  function onClick(e) {
    var b = e.target && e.target.closest && e.target.closest("[data-bl-act]"); if (!b || !b.closest("#smdReview")) return;
    var act = b.getAttribute("data-bl-act"), i = act.indexOf(":"), cmd = i < 0 ? act : act.slice(0, i), arg = i < 0 ? "" : act.slice(i + 1);
    if (cmd !== "back" && cmd !== "toedit") collect();
    if (cmd === "back") { DS.view = "list"; DS.cur = null; DS.msg = ""; DS.look = null; DS.queue = null; rerender(); return; }
    if (cmd === "toedit") { DS.view = "edit"; DS.msg = ""; rerender(); return; }
    if (cmd === "new") {
      var cand = ((DS.queue && DS.queue.candidates) || []).filter(function (x) { return x.id === arg; })[0];
      if (cand) { DS.cur = fromCandidate(cand); DS.view = "edit"; DS.msg = ""; DS.dq = ""; rerender(); }
      return;
    }
    if (cmd === "edit") {
      var it = ((DS.queue && DS.queue.items) || []).filter(function (x) { return x.id === arg; })[0];
      if (it) { DS.cur = fromItem(it); DS.view = "edit"; DS.msg = it.state === "source_changed" ? "The source changed. Read it again, update the text if needed, then save and sign." : ""; DS.dq = ""; rerender(); }
      return;
    }
    if (cmd === "dz") { if (DS.cur && DS.cur.disease_ids.length < 5 && DS.cur.disease_ids.indexOf(arg) < 0) DS.cur.disease_ids.push(arg); DS.dq = ""; rerender(); return; }
    if (cmd === "undz") { if (DS.cur) DS.cur.disease_ids = DS.cur.disease_ids.filter(function (x) { return x !== arg; }); rerender(); return; }
    if (cmd === "draft") { if (DS.cur) draftFromSource(DS.cur); rerender(); return; }
    if (cmd === "cdsco" && DS.cur) {
      var cq = String(DS.cur._cq || "").trim();
      if (cq.length < 4) { DS.cur._cdsco = { error: "Type at least 4 letters of the generic name." }; rerender(); return; }
      var cur = DS.cur;
      api("GET", "/cdsco?q=" + encodeURIComponent(cq)).then(function (r) {
        cur._cdsco = r.status === 200 ? r.data : { error: errText(r) };
        rerender();
      });
      return;
    }
    if (cmd === "save") { save(false); return; }
    if (cmd === "savesign") { save(true); return; }
    if (cmd === "signgo") { signGo(); return; }
    if (cmd === "retract") { DS.cur._retracting = true; rerender(); return; }
    if (cmd === "retractgo") {
      var reason = val("bl_rreason").trim();
      if (reason.length < 10) { DS.msg = "Give a reason of at least 10 characters."; rerender(); return; }
      api("POST", "/" + encodeURIComponent(DS.cur.id) + "/retract", { reason: reason }).then(function (r) {
        if (r.status !== 200) { DS.msg = errText(r); rerender(); return; }
        DS.view = "list"; DS.cur = null; DS.queue = null; DS.msg = "Retracted. Phones drop it on their next sync.";
        try { B().sync(true); } catch (e) {}
        rerender();
      });
      return;
    }
    if (cmd === "signers") { DS.view = "signers"; DS.msg = ""; DS.signers = null; DS.look = null; rerender(); return; }
    if (cmd === "addme") { var sf = DS.me.self || {}; DS.look = { uid: sf.uid, name: sf.name || "", reg_no: sf.reg_no || "", council: sf.council || "", verified: true }; rerender(); return; }
    if (cmd === "lookup") {
      var em = val("bl_lemail").trim();
      if (!em) return;
      api("GET", "/signers/lookup?email=" + encodeURIComponent(em)).then(function (r) {
        if (r.status !== 200) { DS.msg = r.data.error === "no-account" ? "No StewardMD account has that email." : errText(r); DS.look = null; rerender(); return; }
        var p = r.data.prefill || {};
        DS.look = { uid: r.data.uid, name: p.name || "", reg_no: p.reg_no || "", council: p.council || "", verified: r.data.verified };
        DS.msg = ""; rerender();
      });
      return;
    }
    if (cmd === "saveSigner" && DS.look) {
      api("POST", "/signers", { uid: DS.look.uid, name: val("bl_sname"), reg_no: val("bl_sreg"), council: val("bl_scouncil") }).then(function (r) {
        if (r.status !== 200) { DS.msg = r.data.error === "not-verified-doctor" ? "This account is not a verified doctor." : "Check the name, registration number and council."; rerender(); return; }
        DS.look = null; DS.signers = null; DS.msg = "Signer saved.";
        probe().then(rerender);
      });
      return;
    }
    if (cmd === "deact") { api("POST", "/signers/" + encodeURIComponent(arg) + "/deactivate").then(function () { DS.signers = null; probe().then(rerender); }); return; }
    if (cmd === "kill") { DS.view = "kill"; DS.msg = ""; rerender(); return; }
    if (cmd === "killgo") {
      var kr = val("bl_kreason").trim(), killed = !(DS.me && DS.me.killed);
      if (kr.length < 10) { toast("Give a reason of at least 10 characters."); return; }
      api("POST", "/kill", { killed: killed, reason: kr }).then(function (r) {
        if (r.status !== 200) { DS.msg = errText(r); rerender(); return; }
        DS.view = "list"; DS.msg = killed ? "Switched off for everyone." : "Switched back on.";
        try { B().sync(true); } catch (e) {}
        probe().then(rerender);
      });
    }
  }
  function onInput(e) {
    var el = e.target;
    if (!el || el.id !== "bl_dq") return;
    collect(); DS.dq = el.value; var pos = el.selectionStart; rerender();
    var q = D.getElementById("bl_dq"); if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch (x) {} }
  }
  if (D && D.addEventListener && !G.__smdBulletinDeskWired) { G.__smdBulletinDeskWired = true; D.addEventListener("click", onClick, false); D.addEventListener("input", onInput, false); }

  var API = { probe: probe, html: html, reset: function () { DS.view = "list"; DS.queue = null; DS.cur = null; DS.msg = ""; }, _state: DS, _previewOf: previewOf,
    _numbersIn: numbersIn, _suggestDiseases: suggestDiseases, _firstSentences: firstSentences };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  G.SMD_BULLETINS_DESK = API;
})(typeof window !== "undefined" ? window : globalThis);
