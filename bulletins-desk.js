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
      '<button type="button" class="kit-pill" data-bl-act="cdsco">' + ms("search") + "Search lists</button></div>";
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

  var DS = { me: null, probing: null, view: "list", queue: null, loading: false, cur: null, saved: null, msg: "", msgKind: "", busy: false, dq: "", signers: null, look: null,
    filter: "todo", undo: null, open: {}, ck: {}, queueErr: "", busyAct: "" };

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
      if (r.status === 200) { DS.queue = r.data; DS.queueErr = ""; }
      else DS.queueErr = r.status === 0 ? "No connection. The queue loads when you are back online." : "Could not load the queue (" + (r.data.reason || r.data.error || r.status) + ").";
      rerender();
    });
  }
  function loadSigners() {
    return api("GET", "/signers").then(function (r) { DS.signers = r.status === 200 ? r.data.signers : []; rerender(); });
  }

  /* ---------------- helpers ---------------- */
  function isoDate(ts) { var d = new Date(Number(ts) || 0); return isNaN(d.getTime()) || !ts ? "" : d.toISOString().slice(0, 10); }
  function diseaseName(id) { var b = G.KB_ENRICHMENT && G.KB_ENRICHMENT.byId; return (b && b[id] && b[id].name) || id; }
  // Source links: RSS feeds (FDA press releases) give http:// links; the bedside requires https, so upgrade them.
  // DOI and PMID come from the source item, or are recovered from its link; a missing link is rebuilt from them.
  function toHttps(u) {
    u = String(u || "").trim();
    if (!u) return "";
    if (/^\/\//.test(u)) u = "https:" + u;
    else if (/^http:\/\//i.test(u)) u = "https://" + u.slice(7);
    else if (!/^https:\/\//i.test(u) && /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(u)) u = "https://" + u;
    return B() && B()._httpsUrl(u) ? u : "";
  }
  function doiFrom(s) { var m = String(s || "").match(/\b(10\.\d{4,9}\/[^\s"'<>?#]+)/); return m ? decodeURIComponent(m[1]).replace(/[.,;)]+$/, "") : ""; }
  function pmidFrom(s) { var m = String(s || "").match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d{1,10})/); return m ? m[1] : ""; }
  function linkFields(url, doi, pmid) {
    var u = toHttps(url);
    doi = String(doi || "").trim() || doiFrom(url);
    pmid = String(pmid || "").trim() || pmidFrom(url);
    if (!u && doi) u = "https://doi.org/" + doi;
    if (!u && pmid) u = "https://pubmed.ncbi.nlm.nih.gov/" + pmid + "/";
    return { source_url: u, doi: doi, pmid: pmid };
  }
  function doiUrl(doi) { doi = String(doi || "").trim(); return /^10\.\d{4,9}\/\S+$/.test(doi) ? "https://doi.org/" + doi : ""; }
  function pmidUrl(p) { p = String(p || "").trim(); return /^\d{1,10}$/.test(p) ? "https://pubmed.ncbi.nlm.nih.gov/" + p + "/" : ""; }
  // Tappable links so the signer can open and check the exact source; refreshed as the fields change.
  function verifyLinks(c) {
    var a = function (id, href, label) { return '<a id="' + id + '" class="bl-vlink"' + (href ? ' href="' + esc(href) + '"' : ' aria-disabled="true"') + ' target="_blank" rel="noopener noreferrer">' + label + "</a>"; };
    return '<div class="bl-vlinks">' + a("bl_open_url", toHttps(c.source_url), "Open source") + a("bl_open_doi", doiUrl(c.doi), "Open DOI") + a("bl_open_pmid", pmidUrl(c.pmid), "Open in PubMed") + "</div>";
  }
  function refreshVerifyLinks() {
    var set = function (id, href) { var el = D.getElementById(id); if (!el) return; if (href) { el.setAttribute("href", href); el.removeAttribute("aria-disabled"); } else { el.removeAttribute("href"); el.setAttribute("aria-disabled", "true"); } };
    set("bl_open_url", toHttps(val("bl_source_url"))); set("bl_open_doi", doiUrl(val("bl_doi"))); set("bl_open_pmid", pmidUrl(val("bl_pmid")));
  }

  // B / I / U: wraps the selection in [b]..[/b], [i]..[/i], [u]..[/u] (shown formatted by SMD_BULLETINS.card).
  var FMT_FIELDS = ["bl_headline", "bl_what_changed", "bl_applies_to"];
  function applyFmt(tag) {
    var id = FMT_FIELDS.indexOf(DS.fmtField) >= 0 ? DS.fmtField : "bl_what_changed", el = D.getElementById(id);
    if (!el) return;
    var s = el.selectionStart == null ? el.value.length : el.selectionStart, e = el.selectionEnd == null ? s : el.selectionEnd;
    var open = "[" + tag + "]", close = "[/" + tag + "]", v = el.value;
    el.value = v.slice(0, s) + open + v.slice(s, e) + close + v.slice(e);
    collect(); rerender();
    var again = D.getElementById(id);
    if (again) { try { again.focus(); again.setSelectionRange(s + open.length, e + open.length); } catch (x) {} }
  }
  function fmtBar() {
    return '<div class="bl-fmt" role="toolbar" aria-label="Text formatting">' +
      '<button type="button" class="bl-fmt-b" data-bl-act="fmt:b" aria-label="Bold"><b>B</b></button>' +
      '<button type="button" class="bl-fmt-b" data-bl-act="fmt:i" aria-label="Italic"><i>I</i></button>' +
      '<button type="button" class="bl-fmt-b" data-bl-act="fmt:u" aria-label="Underline"><u>U</u></button>' +
      '<span class="kit-muted bl-fmt-hint">Select words, then tap B, I or U.</span></div>';
  }

  function fromCandidate(c) {
    var o = {
      update_id: c.id, kind: TYPE_KIND[c.type] || "", headline: String(c.title || "").slice(0, 120), what_changed: "", applies_to: "",
      evidence_type: "", evidence_note: "", regulator: "", india_status: "", source_label: c.organization || "",
      source_url: "", source_date: isoDate(c.published_ts), doi: "", pmid: "", review_months: 12, disease_ids: [],
      _src: { title: c.title, org: c.organization, url: c.official_url, date: c.published_ts, summary: c.summary, type: c.type },
    };
    var lf = linkFields(c.official_url, c.doi, c.pmid); o.source_url = lf.source_url; o.doi = lf.doi; o.pmid = lf.pmid;
    return o;
  }
  function fromItem(it) {
    var o = {};
    ["id", "update_id", "kind", "headline", "what_changed", "applies_to", "evidence_type", "evidence_note", "regulator", "india_status",
      "source_label", "source_url", "source_date", "doi", "pmid", "review_months", "updated_ts", "body_hash", "state"].forEach(function (k) { o[k] = it[k]; });
    o.disease_ids = (it.disease_ids || []).slice();
    o._src = { title: it.u_title, org: it.u_org, url: it.u_url, date: it.u_published_ts, summary: it.u_summary, change: it.source_change };
    // Drafts saved before links were auto-filled: fill the gaps from the source item.
    var lf = linkFields(o.source_url || it.u_url, o.doi || it.u_doi, o.pmid || it.u_pmid);
    o.source_url = lf.source_url; o.doi = lf.doi; o.pmid = lf.pmid;
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
    return "Could not save (" + (d.error || r.status) + "). Try again in a minute.";
  }
  function say(text, kind) { DS.msg = text || ""; DS.msgKind = kind || "err"; }
  function msgHtml() {
    if (!DS.msg) return "";
    var k = DS.msgKind || "err";
    return '<p class="bl-banner ' + k + '" role="' + (k === "err" ? "alert" : "status") + '">' + ms(k === "ok" ? "check_circle" : k === "warn" ? "info" : "error") + "<span>" + esc(DS.msg) + "</span></p>";
  }
  function field(id, label, input, wide) { return '<label class="kit-field' + (wide ? " wide" : "") + '" for="' + id + '"><span class="kit-fl">' + label + "</span>" + input + "</label>"; }
  function txt(id, v, max, rows) {
    return rows ? '<textarea id="' + id + '" class="kit-inp" rows="' + rows + '" maxlength="' + max + '">' + esc(v || "") + "</textarea>"
      : '<input id="' + id + '" class="kit-inp" maxlength="' + max + '" value="' + esc(v || "") + '">';
  }
  function val(id) { var el = D.getElementById(id); return el ? el.value : ""; }
  function fmtDate(v) { return (B() && B()._fmtDate(v)) || ""; }

  // Copy the text inputs into DS.cur so a re-render (chip, disease, search) never loses typing.
  // Choices made with chips (type, India status, evidence, regulator, review interval) live in DS.cur already.
  function collect() {
    var c = DS.cur; if (!c || !D.getElementById("bl_headline")) return;
    ["headline", "what_changed", "applies_to", "evidence_note", "source_label", "source_url", "source_date", "doi", "pmid"].forEach(function (k) {
      if (D.getElementById("bl_" + k)) c[k] = val("bl_" + k);
    });
    if (D.getElementById("bl_cq")) c._cq = val("bl_cq");
  }

  /* ---------------- what is still missing (mirrors validateDraft in functions/_bulletin_rules.js) ---------------- */
  var LIM = { headline: [10, 120], what_changed: [20, 400], applies_to: [0, 200], evidence_note: [0, 120], source_label: [3, 160] };
  function visLen(s) { return B().plain(String(s || "").replace(/\s+/g, " ").trim()).length; }
  function realDate(s) {
    s = String(s || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var t = Date.parse(s + "T00:00:00Z");
    return isFinite(t) && new Date(t).toISOString().slice(0, 10) === s && t <= Date.now() + 86400000;
  }
  // In page order, so the first entry is the one nearest the top.
  function missing(c) {
    var out = [];
    // fix: something is entered but wrong (too long, an em-dash, a bad link, DOI, PMID or date). Otherwise it is
    // simply not filled in yet (including a headline still being typed), which is not shown as an error.
    function add(k, label, target, src, fix) { out.push({ k: k, label: label, target: target, src: !!src, fix: !!fix }); }
    function text(k, label, target, src) {
      var v = String(c[k] || ""), n = visLen(v), L = LIM[k] || [3, 160];
      if (n > L[1] || v.indexOf("\u2014") >= 0) add(k, label, target, src, true);
      else if (L[0] && n < L[0]) add(k, label, target, src, false);
    }
    var su = String(c.source_url || "").trim(), sd = String(c.source_date || "").trim();
    text("source_label", "Source name", "bl_source_label", true);
    if (su.length < 12 || !B()._httpsUrl(su)) add("source_url", "Source link", "bl_source_url", true, !!su);
    if (!realDate(sd)) add("source_date", "Source date", "bl_source_date", true, !!sd);
    if (c.doi && !/^10\.\d{4,9}\/\S+$/.test(String(c.doi).trim())) add("doi", "DOI", "bl_doi", true, true);
    if (c.pmid && !/^\d{1,10}$/.test(String(c.pmid).trim())) add("pmid", "PMID", "bl_pmid", true, true);
    text("headline", "Headline", "bl_headline");
    text("what_changed", "What changed", "bl_what_changed");
    text("applies_to", "Applies to", "bl_applies_to");
    if (!(c.disease_ids || []).length) add("disease_ids", "Diseases", "bl_dq");
    if (!c.kind) add("kind", "Type", "bl_sec_kind");
    if (!c.india_status) add("india_status", "India status", "bl_sec_india_status");
    if (!c.evidence_type) add("evidence_type", "Evidence", "bl_sec_evidence_type");
    text("evidence_note", "Evidence note", "bl_evidence_note");
    return out;
  }

  /* ---------------- shared pieces ---------------- */
  function typeChip(kind) {
    var lab = (B().KIND || {})[kind];
    return '<span class="bl-type bl-k-' + (lab ? kind : "other") + '">' + esc(lab || "Source item") + "</span>";
  }
  function metaLine(org, date) { var t = [org, fmtDate(date)].filter(Boolean).join(" · "); return t ? '<span class="bl-meta">' + esc(t) + "</span>" : ""; }
  function chev() { return '<span class="material-symbols-outlined kit-ic bl-chev" aria-hidden="true">expand_more</span>'; }
  function fold(key, open, summary, body, cls) {
    return '<details class="bl-fold' + (cls ? " " + cls : "") + '" data-bl-open="' + key + '"' + (open ? " open" : "") + "><summary>" + summary + chev() + "</summary>" + body + "</details>";
  }
  function stepHead(n, id, title) { return '<h3 class="bl-step-h" id="' + id + '"><span class="bl-n" aria-hidden="true">' + n + "</span>" + title + "</h3>"; }

  /* ---------------- queue ---------------- */
  var NOTE = {
    source_changed: ["The source changed since it was signed. Read it again.", "warn", "sync_problem", "Check again"],
    review_due: ["Review due. Check it still holds, then sign again.", "warn", "event_repeat", "Review"],
    source_missing: ["The source item was removed.", "warn", "link_off", "Open"],
    edited: ["Edited, not signed yet.", "", "edit_note", "Continue"],
    draft: ["Draft, not signed yet.", "", "edit_note", "Continue"],
  };
  function bucket(it, soon) {
    if (it.state === "draft" || it.state === "edited") return "draft";
    if (it.state === "live" && !(it.review_due_ts < soon) && !(it.orphaned || []).length) return "live";
    return "check";
  }
  function qCard(kind, attn, top, title, sub, note, acts) {
    var kc = (B().KIND || {})[kind] ? kind : "other";
    return '<article class="bl-q bl-k-' + kc + (attn ? " attn" : "") + '">' + '<h4 class="bl-q-t">' + esc(title) + "</h4>" +
      '<p class="bl-q-top">' + top + "</p>" + (sub ? '<p class="bl-q-s">' + esc(sub) + "</p>" : "") +
      (note ? '<p class="bl-q-n ' + note[1] + '">' + ms(note[2]) + "<span>" + esc(note[0]) + "</span></p>" : "") +
      '<div class="bl-q-act">' + acts + "</div></article>";
  }
  function itemCard(it, soon) {
    var note = NOTE[it.state], label = note ? note[3] : "Open", live = it.state === "live";
    if (live) note = it.review_due_ts < soon ? ["Review due " + fmtDate(it.review_due_ts) + ".", "warn", "event_repeat"] : ["On the disease page until " + fmtDate(it.review_due_ts) + ".", "ok", "verified"];
    if (live && it.review_due_ts < soon) label = "Review";
    if ((it.orphaned || []).length) { note = ["A disease was removed from the library. Choose another.", "warn", "link_off"]; label = "Fix"; }
    var todo = bucket(it, soon) !== "live";
    return qCard(it.kind, todo && note && note[1] === "warn", typeChip(it.kind) + metaLine(it.source_label, it.source_date), B().plain(it.headline),
      (it.disease_ids || []).map(diseaseName).join(", "), note,
      '<button type="button" class="' + (todo ? "kit-add" : "kit-clear") + '" data-bl-act="edit:' + esc(it.id) + '">' + (todo ? ms(label === "Continue" ? "edit" : "fact_check") : "") + esc(label) + "</button>");
  }
  function candCard(c) {
    var kind = TYPE_KIND[c.type] || "";
    return qCard(kind, false, typeChip(kind) + metaLine(c.organization, c.published_ts), c.title, firstSentences(c.summary, 160), null,
      '<button type="button" class="kit-add" data-bl-act="new:' + esc(c.id) + '">' + ms("edit_note") + "Write update</button>" +
      '<button type="button" class="kit-clear" data-bl-act="skip:' + esc(c.id) + '" aria-label="Skip: ' + esc(c.title) + '">Skip</button>');
  }
  function group(title, cards) { return cards.length ? '<h3 class="bl-gh">' + esc(title) + '<span class="bl-gn">' + cards.length + '</span></h3><div class="bl-ql">' + cards.join("") + "</div>" : ""; }
  function empty(icon, text) { return '<div class="bl-empty">' + ms(icon) + "<p>" + esc(text) + "</p></div>"; }

  function listView(tabs) {
    var me = DS.me || {}, q = DS.queue, pd = me.pending;
    var head = tabs + msgHtml();
    if (me.killed) head += '<p class="bl-banner warn" role="status">' + ms("block") + "<span>Practice updates are switched off for everyone.</span></p>";
    var tools = me.isOwner ? '<div class="bl-tools"><p class="bl-gh">Owner tools</p><div class="kit-row"><button type="button" class="kit-pill" data-bl-act="signers">' + ms("badge") + "Signers</button>" +
      '<button type="button" class="kit-pill" data-bl-act="kill">' + ms(me.killed ? "toggle_on" : "block") + (me.killed ? "Switch back on" : "Switch off for everyone") + "</button></div></div>" : "";
    var waiting = pd && pd.total ? "Waiting for you: " + [
      pd.candidates ? pd.candidates + " new source item" + (pd.candidates === 1 ? "" : "s") : "",
      pd.source_changed ? pd.source_changed + " source change" + (pd.source_changed === 1 ? "" : "s") : "",
      pd.drafts ? pd.drafts + " draft" + (pd.drafts === 1 ? "" : "s") : "",
      pd.review_due ? pd.review_due + " due for review" : ""].filter(Boolean).join(", ") + "." : "Nothing waiting for you.";
    head += '<div class="bl-sum"><h2 class="bl-sum-h" tabindex="-1">' + esc(waiting) + '</h2><p class="kit-muted">Nothing reaches a disease page until a doctor signs it.</p></div>';
    if (!me.canSign) {
      return head + '<p class="kit-muted">' + (me.isOwner ? "You can manage signers. Add yourself to sign." : "You are not registered to sign.") + "</p>" + tools;
    }
    if (!q && DS.queueErr) {
      return head + '<div class="bl-banner err" role="alert">' + ms("cloud_off") + "<span>" + esc(DS.queueErr) + '</span></div><button type="button" class="kit-clear bl-retry" data-bl-act="retry">' + ms("refresh") + "Try again</button>" + tools;
    }
    if (!q) {
      if (!DS.loading) loadQueue();
      var sk = '<div class="bl-q bl-sk" aria-hidden="true"><span class="bl-sk-l w80"></span><span class="bl-sk-l w50"></span><span class="bl-sk-l w90"></span><span class="bl-sk-b"></span></div>';
      return head + '<p class="bl-vh" role="status">Loading the queue</p><div class="bl-ql">' + sk + sk + "</div>" + tools;
    }
    var items = q.items || [], cands = q.candidates || [], soon = Date.now() + 30 * 86400000;
    var check = items.filter(function (i) { return bucket(i, soon) === "check"; }), drafts = items.filter(function (i) { return bucket(i, soon) === "draft"; }),
      live = items.filter(function (i) { return bucket(i, soon) === "live"; });
    var todoN = check.length + drafts.length + cands.length, f = DS.filter === "live" ? "live" : "todo";
    var seg = function (k, label, n) { return '<button type="button" data-bl-act="filter:' + k + '" aria-pressed="' + (f === k) + '">' + label + '<span class="bl-badge">' + n + "</span></button>"; };
    var undo = DS.undo ? '<div class="bl-undo" role="status"><span>Skipped. It leaves the queue for every signer.</span><button type="button" class="kit-link" data-bl-act="unskip:' + esc(DS.undo) + '">Undo</button></div>' : "";
    var card = function (it) { return itemCard(it, soon); };
    var body = f === "live"
      ? (live.length ? group("On the disease page", live.map(card)) : empty("verified", "Nothing is live yet. Updates you sign appear here."))
      : (todoN ? group("Check again", check.map(card)) + group("Your drafts", drafts.map(card)) + group("New from journals and regulators", cands.map(candCard))
        : empty("task_alt", "All caught up. New journal and regulator items arrive every day, and you get a reminder on Saturday morning."));
    return head + '<div class="bl-seg" role="group" aria-label="Show">' + seg("todo", "To do", todoN) + seg("live", "Live", live.length) + "</div>" + undo + body + tools;
  }

  /* ---------------- editor: 1 read the source, 2 write, 3 classify ---------------- */
  function sourceStep(c, miss) {
    var s = c._src || {}, isNew = !c.id;
    var ch = s.change && s.change.whats_changed_json ? (function () { try { return JSON.parse(s.change.whats_changed_json) || []; } catch (e) { return []; } })() : [];
    var srcMiss = miss.some(function (m) { return m.src; });
    var srcSum = [c.source_label, fmtDate(c.source_date), c.doi ? "DOI" : "", c.pmid ? "PMID" : ""].filter(Boolean).join(", ");
    return '<section class="kit-card bl-step" aria-labelledby="bl_s1">' + stepHead(1, "bl_s1", "Read the source") +
      '<p class="bl-src-t">' + esc(s.title || c.source_label || "") + "</p>" +
      '<p class="bl-q-top">' + typeChip(c.kind || TYPE_KIND[s.type] || "") + metaLine(s.org, s.date) + "</p>" +
      (ch.length ? '<div class="bl-banner warn">' + ms("sync_problem") + "<div><b>What changed in the source</b><ul>" + ch.map(function (x) { return "<li>" + esc(x.topic || "") + ": " + esc(x.previous || "") + " to " + esc(x.current || "") + "</li>"; }).join("") + "</ul></div></div>" : "") +
      verifyLinks(c) +
      (s.summary ? fold("ai", DS.open.ai, '<span class="bl-fold-l">AI summary, not reviewed</span>', '<p class="kit-muted bl-ai">' + esc(String(s.summary).slice(0, 1500)) + "</p>") : "") +
      (s.summary && isNew && !c._drafted ? '<div class="bl-draftbox"><button type="button" class="kit-add" data-bl-act="draft">' + ms("edit_note") + "Draft from source</button>" +
        '<span class="kit-muted">Fills a first draft from the AI summary. You rewrite it and check every number.</span></div>' : "") +
      fold("src", DS.open.src || srcMiss, '<span class="bl-fold-l">Source details</span><span class="bl-fold-s' + (srcMiss ? " miss" : "") + '">' +
        esc(srcMiss ? "check: " + names(miss.filter(function (m) { return m.src; })) : "filled in: " + srcSum) + "</span>",
        '<div class="kit-grid bl-srcgrid">' +
        field("bl_source_label", "Source name (journal, regulator notice)", txt("bl_source_label", c.source_label, 160), true) +
        field("bl_source_url", "Source link (https)", txt("bl_source_url", c.source_url, 500), true) +
        field("bl_source_date", "Source date", '<input id="bl_source_date" type="date" class="kit-inp" value="' + esc(c.source_date || "") + '">') +
        field("bl_doi", "DOI (optional)", txt("bl_doi", c.doi, 100)) +
        field("bl_pmid", "PMID (optional)", txt("bl_pmid", c.pmid, 10)) + "</div>") +
      "</section>";
  }
  function counter(k, v) { var n = visLen(v), L = LIM[k], bad = n > L[1] || (n > 0 && n < L[0]); return '<span class="bl-cnt' + (bad ? " bad" : "") + '" id="bl_cnt_' + k + '">' + n + " / " + L[1] + "</span>"; }
  function tfield(k, label, v, max, rows, ph) {
    var id = "bl_" + k, a = ' id="' + id + '" class="kit-inp" maxlength="' + max + '" placeholder="' + esc(ph) + '"';
    return '<label class="kit-field wide" for="' + id + '"><span class="bl-lab"><span class="kit-fl">' + label + "</span>" + counter(k, v) + "</span>" +
      (rows ? "<textarea" + a + ' rows="' + rows + '">' + esc(v || "") + "</textarea>" : "<input" + a + ' value="' + esc(v || "") + '">') + "</label>";
  }
  function numbersHtml(c) {
    var nums = numbersIn(c.what_changed + " " + c.applies_to + " " + c.headline);
    return nums.length ? '<span class="kit-fl">Numbers to check against the source</span><div class="kit-row">' + nums.map(function (n) { return '<span class="bl-num">' + esc(n) + "</span>"; }).join("") + "</div>" : "";
  }
  function writeStep(c) {
    return '<section class="kit-card bl-step" aria-labelledby="bl_s2">' + stepHead(2, "bl_s2", "Write it in your own words") +
      (c._drafted ? '<p class="bl-banner warn bl-drafted" role="status">' + ms("edit_note") + "<span>Drafted from the AI summary. Rewrite it in your own words and check every number against the primary source before signing. India status is yours to set.</span></p>" : "") +
      fmtBar() +
      tfield("headline", "Headline", c.headline, 170, 0, "One line a colleague can act on") +
      tfield("what_changed", "What changed", c.what_changed, 520, 4, "What to do differently, for whom, with the key number") +
      tfield("applies_to", "Applies to (optional)", c.applies_to, 260, 0, "For example: adults with eGFR under 30") +
      '<div class="bl-nums" id="bl_nums">' + numbersHtml(c) + "</div>" +
      diseasePicker(c) + "</section>";
  }
  function chips(k, label, opts, cur, hint) {
    return '<div class="bl-grp" id="bl_sec_' + k + '" role="group" aria-labelledby="bl_lbl_' + k + '"><span class="kit-fl" id="bl_lbl_' + k + '">' + esc(label) + "</span>" +
      (hint ? '<span class="bl-hint">' + esc(hint) + "</span>" : "") + '<div class="bl-chips">' + opts.map(function (o) {
        var on = String(cur) === String(o[0]);
        return '<button type="button" class="bl-chip' + (on ? " on" : "") + '" aria-pressed="' + on + '" data-bl-act="set:' + k + ":" + esc(o[0]) + '">' + (on ? ms("check") : "") + esc(o[1]) + "</button>";
      }).join("") + "</div></div>";
  }
  var KIND_OPTS = [["safety", "Safety alert"], ["approval", "New approval"], ["guideline", "Guideline change"], ["trial", "Trial result"]];
  var REG_OPTS = [["", "None"], ["FDA", "FDA"], ["EMA", "EMA"], ["MHRA", "MHRA"], ["CDSCO", "CDSCO"], ["WHO", "WHO"], ["ICMR", "ICMR"], ["SOCIETY", "Professional society"]];
  var REVIEW_OPTS = [["6", "6 months"], ["12", "12 months"], ["24", "24 months"]];
  function classifyStep(c) {
    var Bk = B();
    return '<section class="kit-card bl-step" aria-labelledby="bl_s3">' + stepHead(3, "bl_s3", "Classify") +
      chips("kind", "Type", KIND_OPTS, c.kind) +
      chips("india_status", "India status", Object.keys(Bk.INDIA).map(function (k) { return [k, Bk.INDIA[k][0]]; }), c.india_status, "Your choice. The CDSCO check below is evidence, not the answer.") +
      cdscoPanel(c) +
      chips("evidence_type", "Evidence", Object.keys(Bk.EVID).map(function (k) { return [k, Bk.EVID[k]]; }), c.evidence_type) +
      chips("regulator", "Regulator", REG_OPTS, c.regulator || "") +
      chips("review_months", "Review again in", REVIEW_OPTS, String(c.review_months || 12)) +
      tfield("evidence_note", "Evidence note (optional, only a grade the source states)", c.evidence_note, 160, 0, "For example: Class I, level A") +
      "</section>";
  }
  function names(list) { var n = list.map(function (m) { return m.label; }); return n.slice(0, 3).join(", ") + (n.length > 3 ? " and " + (n.length - 3) + " more" : ""); }
  function barStatus(miss) {
    if (!miss.length) return '<span class="bl-ready">' + ms("check_circle") + "Ready to sign</span>";
    var fix = miss.filter(function (m) { return m.fix; }), fill = miss.filter(function (m) { return !m.fix; });
    var t = fix.length ? "<b>Fix:</b> " + esc(names(fix)) + (fill.length ? ", then " + fill.length + " more to fill in" : "") : "<b>" + fill.length + " to fill in:</b> " + esc(names(fill));
    return '<button type="button" class="bl-left' + (fix.length ? " fix" : "") + '" data-bl-act="jump">' + ms(fix.length ? "error" : "checklist") + "<span>" + t + "</span>" + ms("arrow_forward") + "</button>";
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
    var sug = (c._suggest || []).filter(function (x) { return c.disease_ids.indexOf(x[0]) < 0; });
    return '<div class="bl-grp"><span class="bl-lab"><span class="kit-fl">Diseases this applies to</span><span class="bl-cnt' + (c.disease_ids.length ? "" : " bad") + '">' + c.disease_ids.length + " / 5</span></span>" +
      (c.disease_ids.length ? '<div class="bl-chips">' + c.disease_ids.map(function (d) {
        return '<button type="button" class="bl-chip on" data-bl-act="undz:' + esc(d) + '" aria-label="Remove ' + esc(diseaseName(d)) + '">' + esc(diseaseName(d)) + ms("close") + "</button>";
      }).join("") + "</div>" : "") +
      (sug.length ? '<span class="bl-hint">Named in the source, tap to add:</span><div class="bl-chips">' + sug.map(function (x) {
        return '<button type="button" class="bl-chip" data-bl-act="dz:' + esc(x[0]) + '">' + ms("add") + esc(x[1]) + "</button>";
      }).join("") + "</div>" : "") +
      '<input id="bl_dq" type="search" class="kit-inp" placeholder="' + (c.disease_ids.length >= 5 ? "Five is the limit. Remove one to add another." : "Search the library to add a disease") + '" autocomplete="off" value="' + esc(DS.dq) + '"' + (c.disease_ids.length >= 5 ? " disabled" : "") + ">" +
      (hits.length ? '<div class="bl-hits">' + hits.map(function (h) { return '<button type="button" class="bl-hit" data-bl-act="dz:' + esc(h[0]) + '">' + ms("add") + "<span>" + esc(h[1]) + "</span></button>"; }).join("") + "</div>" : "") + "</div>";
  }

  function editView() {
    var c = DS.cur, miss = missing(c), live = c.state === "live" || c.state === "review_due";
    return '<div class="bl-editor"><button type="button" class="kit-link" data-bl-act="back">' + ms("arrow_back") + "Back to the queue</button>" +
      '<h2 class="dl-h">' + (c.id ? "Edit update" : "New update") + "</h2>" + msgHtml() +
      (live ? '<p class="bl-banner warn">' + ms("info") + "<span>This update is on the disease page. Saving a change takes it off until you sign it again.</span></p>" : "") +
      sourceStep(c, miss) + writeStep(c) + classifyStep(c) +
      fold("prev", DS.open.prev, '<span class="bl-fold-l">Preview on the disease page</span>', '<div class="bl-preview">' + B().card(previewOf(c)) + "</div>", "bl-prevd") +
      (c.id ? '<div class="bl-retract">' + (c._retracting
        ? field("bl_rreason", "Why is it being retracted? (10 to 300 characters)", txt("bl_rreason", "", 300, 2), true) + '<div class="kit-row"><button type="button" class="kit-clear bl-danger" data-bl-act="retractgo">Retract now</button></div>'
        : '<button type="button" class="kit-clear bl-danger" data-bl-act="retract">' + ms("remove_circle") + "Retract this update</button>") + "</div>" : "") +
      '<div class="bl-bar"><div class="bl-bar-s" id="bl_bar_s" aria-live="polite">' + (DS._bar = barStatus(miss)) + "</div>" +
      '<div class="bl-bar-b"><button type="button" class="kit-clear" data-bl-act="save"' + (DS.busy ? " disabled" : "") + ">" + (DS.busy && DS.busyAct === "save" ? "Saving…" : "Save draft") + "</button>" +
      '<button type="button" class="kit-add" data-bl-act="savesign"' + (DS.busy ? " disabled" : "") + ">" + ms("verified") + (DS.busy && DS.busyAct === "savesign" ? "Saving…" : "Preview and sign") + "</button></div></div></div>";
  }
  // Counters, the missing list, the numbers and the preview follow typing without a re-render (keeps focus and keyboard).
  function refreshLive() {
    var c = DS.cur; if (!c) return;
    Object.keys(LIM).forEach(function (k) {
      var el = D.getElementById("bl_cnt_" + k); if (!el) return;
      var n = visLen(c[k]), L = LIM[k]; el.textContent = n + " / " + L[1]; el.className = "bl-cnt" + (n > L[1] || (n > 0 && n < L[0]) ? " bad" : "");
    });
    var bar = barStatus(missing(c)), s = D.getElementById("bl_bar_s");
    if (s && bar !== DS._bar) { s.innerHTML = bar; DS._bar = bar; }
    var nums = D.getElementById("bl_nums"); if (nums) nums.innerHTML = numbersHtml(c);
    var p = D.querySelector("#smdReview .bl-editor .bl-preview"); if (p) p.innerHTML = B().card(previewOf(c));
  }
  function jump() {
    collect();
    var m = missing(DS.cur)[0]; if (!m) return;
    if (m.src && !D.querySelector('#smdReview details[data-bl-open="src"][open]')) { DS.open.src = true; rerender(); }
    var el = D.getElementById(m.target); if (!el) return;
    try { el.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (e) { try { el.scrollIntoView(); } catch (x) {} }
    el.classList.remove("bl-flash", "bad"); void el.offsetWidth; el.classList.add("bl-flash"); if (m.fix) el.classList.add("bad");
    setTimeout(function () { el.classList.remove("bl-flash", "bad"); }, 2400);
    var f = /^(INPUT|TEXTAREA)$/.test(el.tagName) ? el : el.querySelector("button");
    if (f) { try { f.focus({ preventScroll: true }); } catch (e) {} }
  }

  /* ---------------- sign sheet ---------------- */
  function ticked() { var ck = DS.ck || {}; return CHECKS.filter(function (c) { return ck[c[0]]; }).length; }
  function ckStatus(n) { return n === CHECKS.length ? "All four confirmed. You can sign." : "Tick every item before signing. " + n + " of " + CHECKS.length + " done."; }
  function signView() {
    var it = DS.saved, s = (DS.me && DS.me.signer) || {}, ck = DS.ck || {}, n = ticked(), all = n === CHECKS.length;
    return '<button type="button" class="kit-link" data-bl-act="toedit">' + ms("arrow_back") + "Back to editing</button>" +
      '<h2 class="dl-h">Sign this update</h2>' + msgHtml() +
      '<p class="kit-muted">Doctors will see exactly this on ' + esc((it.disease_ids || []).map(diseaseName).join(", ")) + ".</p>" +
      '<div class="bl-preview">' + B().card(previewOf(it)) + "</div>" +
      '<fieldset class="bl-cks"><legend class="kit-fl">Before you sign, confirm each point</legend>' + CHECKS.map(function (c) {
        return '<label class="bl-ck" for="bl_ck_' + c[0] + '"><input type="checkbox" id="bl_ck_' + c[0] + '"' + (ck[c[0]] ? " checked" : "") + "><span>" + esc(c[1]) + "</span></label>";
      }).join("") + "</fieldset>" +
      '<p class="kit-muted">Your name, registration number and today\'s date appear with the update. Any later edit takes it off the disease page until it is signed again.</p>' +
      '<div class="bl-bar bl-signbar"><p id="bl_ck_s" class="bl-ck-s' + (all ? " ok" : "") + '" role="status">' + esc(ckStatus(n)) + "</p>" +
      '<button type="button" class="kit-add bl-signbtn" data-bl-act="signgo"' + (DS.busy || !all ? " disabled" : "") + ">" + ms("verified") +
      (DS.busy ? "Signing…" : "Sign as " + esc(/^dr\.?\s/i.test(s.name || "") ? s.name : "Dr " + (s.name || "")) + ", Reg. No. " + esc(s.regNo || "")) + "</button></div>";
  }

  function signersView() {
    var me = DS.me || {}, L = DS.look;
    if (!DS.signers) loadSigners();
    return '<button type="button" class="kit-link" data-bl-act="back">' + ms("arrow_back") + "Back to the queue</button><h2 class=\"dl-h\">Signers</h2>" + msgHtml() +
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
      '<h2 class="dl-h">' + (on ? "Switch off practice updates for everyone" : "Switch practice updates back on") + "</h2>" + msgHtml() +
      '<p class="kit-muted">' + (on ? "Every phone stops showing them on its next sync. Nothing is deleted." : "Signed, current updates show again on each phone's next sync.") + "</p>" +
      field("bl_kreason", "Reason (10 to 300 characters)", txt("bl_kreason", "", 300, 3), true) +
      '<div class="kit-row"><button type="button" class="' + (on ? "kit-clear" : "kit-add") + '" data-bl-act="killgo">' + (on ? "Switch off now" : "Switch on") + "</button></div>";
  }

  // Styles ride on the Review Desk tokens (specialty-kits.css: --primary, --sc-*, --outline-variant, --error, body.dark).
  // Type colour means what it means on the disease-page card (bulletins.js): red for a safety alert, the accent otherwise.
  var DESK_CSS = [
    "#smdReview{--bl-safety:#b91c1c;--bl-amber:#8a5300;--bl-amber-bg:#fff4e0}",
    "body.dark #smdReview{--bl-safety:#fca5a5;--bl-amber:#f5c26b;--bl-amber-bg:#33270f}",
    "#smdReview .bl-q,#smdReview .bl-type{--bl-c:var(--primary)}#smdReview .bl-k-safety{--bl-c:var(--bl-safety)}#smdReview .bl-k-other{--bl-c:var(--on-surface-variant)}",
    // banners and messages
    "#smdReview .bl-banner{display:flex;align-items:flex-start;gap:8px;margin:0;padding:10px 12px;border-radius:12px;background:var(--sc-low);color:var(--on-surface);font:600 13px/1.45 var(--q-sans)}",
    "#smdReview .bl-banner .kit-ic{font-size:19px;flex:0 0 auto}#smdReview .bl-banner ul{margin:4px 0 0;padding-left:18px;font-weight:500}",
    "#smdReview .bl-banner.warn{background:var(--bl-amber-bg);color:var(--bl-amber)}#smdReview .bl-banner.ok{background:color-mix(in srgb,var(--primary) 10%,var(--sc-lowest));color:var(--primary)}",
    "#smdReview .bl-banner.err{background:var(--error-container);color:var(--on-error-container)}",
    // queue
    "#smdReview .bl-sum{display:flex;flex-direction:column;gap:2px}#smdReview .bl-sum-h{margin:0;font:700 16px/1.35 var(--q-sans);color:var(--on-surface);text-wrap:balance}",
    "#smdReview .bl-seg{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;border-radius:14px;background:var(--sc-low)}",
    "#smdReview .bl-seg button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;border:0;border-radius:10px;background:transparent;color:var(--on-surface-variant);font:650 14px var(--q-sans);cursor:pointer;transition:background-color .15s,color .15s}",
    "#smdReview .bl-seg button[aria-pressed=true]{background:var(--sc-lowest);color:var(--on-surface);box-shadow:0 1px 3px rgba(20,32,43,.14)}",
    "#smdReview .bl-badge{min-width:24px;padding:1px 7px;border-radius:999px;background:var(--sc-high);color:var(--on-surface-variant);font:700 12.5px/1.5 var(--q-sans);font-variant-numeric:tabular-nums}",
    "#smdReview .bl-seg button[aria-pressed=true] .bl-badge{background:var(--primary);color:var(--on-primary)}",
    "#smdReview .bl-gh{display:flex;align-items:center;gap:8px;margin:10px 0 0;color:var(--on-surface-variant);font:700 12.5px/1.3 var(--q-sans);letter-spacing:.05em;text-transform:uppercase}",
    "#smdReview .bl-gn{padding:0 7px;border-radius:999px;background:var(--sc-high);font-variant-numeric:tabular-nums;letter-spacing:0}",
    "#smdReview .bl-ql{display:flex;flex-direction:column;gap:10px}",
    "#smdReview .bl-q{display:flex;flex-direction:column;gap:4px;min-width:0;padding:14px;border:1px solid var(--outline-variant);border-radius:14px;background:var(--sc-lowest)}",
    "#smdReview .bl-q.attn{border-color:color-mix(in srgb,var(--bl-amber) 45%,var(--outline-variant))}",
    "#smdReview .bl-q-top{display:flex;flex-wrap:wrap;align-items:center;gap:2px 12px;min-width:0;margin:0}",
    "#smdReview .bl-type{display:inline-flex;align-items:center;gap:6px;color:var(--bl-c);font:650 12.5px/1.4 var(--q-sans);white-space:nowrap}",
    "#smdReview .bl-type::before{content:'';width:7px;height:7px;border-radius:50%;background:currentColor}",
    "#smdReview .bl-meta{min-width:0;color:var(--on-surface-variant);font:500 12.5px/1.4 var(--q-sans);overflow-wrap:anywhere}",
    "#smdReview .bl-q-t{margin:0;color:var(--on-surface);font:650 15px/1.4 var(--q-sans);overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}",
    "#smdReview .bl-q-s{margin:2px 0 0;color:var(--on-surface-variant);font:400 13px/1.45 var(--q-sans);overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}",
    "#smdReview .bl-q-n{display:flex;align-items:flex-start;gap:6px;margin:0;color:var(--on-surface-variant);font:600 13px/1.4 var(--q-sans)}#smdReview .bl-q-n .kit-ic{font-size:18px}",
    "#smdReview .bl-q-n.warn{color:var(--bl-amber)}#smdReview .bl-q-n.ok{color:var(--primary)}",
    "#smdReview .bl-q-act{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}#smdReview .bl-q-act button{min-height:48px}",
    "#smdReview .bl-undo{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 4px 4px 14px;border-radius:12px;background:var(--on-surface);color:var(--bg);font:500 14px/1.4 var(--q-sans)}",
    "#smdReview .bl-undo .kit-link{min-height:48px;padding:6px 12px;color:var(--bg);font-weight:750;text-decoration:underline}",
    "#smdReview .bl-empty{display:flex;flex-direction:column;align-items:center;gap:6px;padding:28px 16px;text-align:center;color:var(--on-surface-variant);font:500 14px/1.5 var(--q-sans)}",
    "#smdReview .bl-empty p{margin:0;max-width:34ch}#smdReview .bl-empty .kit-ic{font-size:36px;color:var(--primary)}",
    "#smdReview .bl-sk{gap:10px}#smdReview .bl-sk-l,#smdReview .bl-sk-b{display:block;height:12px;border-radius:6px;background:var(--sc-high)}#smdReview .bl-sk-b{width:128px;height:48px;border-radius:12px;margin-top:6px}",
    "#smdReview .bl-sk-l.w80{width:80%;height:15px}#smdReview .bl-sk-l.w50{width:50%}#smdReview .bl-sk-l.w90{width:90%}",
    "@keyframes blPulse{50%{opacity:.55}}#smdReview .bl-sk>*{animation:blPulse 1.4s ease-in-out infinite}",
    "#smdReview .bl-vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}#smdReview .bl-retry{align-self:flex-start}",
    "#smdReview .bl-tools{display:flex;flex-direction:column;gap:8px;margin-top:10px;padding-top:12px;border-top:1px solid var(--sc-high)}",
    // editor
    "#smdReview .bl-editor{display:flex;flex-direction:column;gap:12px}#smdReview .bl-editor>.kit-link{align-self:flex-start}",
    "#smdReview .bl-step{gap:12px}#smdReview .bl-step-h{display:flex;align-items:center;gap:10px;margin:0;color:var(--on-surface);font:700 16px/1.3 var(--q-sans)}",
    "#smdReview .bl-n{display:inline-flex;flex:0 0 auto;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:var(--primary);color:var(--on-primary);font:750 13px var(--q-sans)}",
    "#smdReview .bl-src-t{margin:0;color:var(--on-surface);font:650 15px/1.45 var(--q-sans);overflow-wrap:anywhere}",
    "#smdReview .bl-fold{border-top:1px solid var(--sc-high)}#smdReview .bl-fold>summary{display:flex;align-items:center;gap:8px;min-height:48px;list-style:none;cursor:pointer;color:var(--on-surface);font:650 14px var(--q-sans)}",
    "#smdReview .bl-fold>summary::-webkit-details-marker{display:none}#smdReview .bl-fold-l{flex:0 0 auto}",
    "#smdReview .bl-fold-s{flex:1 1 auto;min-width:0;color:var(--on-surface-variant);font:500 12.5px var(--q-sans);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#smdReview .bl-fold-s.miss{color:var(--bl-amber);font-weight:650}",
    "#smdReview .bl-chev{margin-left:auto;color:var(--on-surface-variant);transition:transform .15s}#smdReview .bl-fold[open]>summary .bl-chev{transform:rotate(180deg)}",
    "#smdReview .bl-fold[open]>summary{margin-bottom:6px}#smdReview .bl-ai{white-space:pre-line}",
    "#smdReview .bl-prevd{border-bottom:1px solid var(--sc-high)}#smdReview .bl-prevd[open]{padding-bottom:12px}",
    "#smdReview .bl-retract{display:flex;flex-direction:column;gap:8px}#smdReview .bl-danger{align-self:flex-start;color:var(--error);border-color:color-mix(in srgb,var(--error) 40%,var(--outline-variant))}",
    "#smdReview .bl-draftbox{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding:12px;border-radius:12px;background:color-mix(in srgb,var(--primary) 7%,var(--sc-lowest))}#smdReview .bl-draftbox .kit-muted{flex:1 1 180px}",
    "#smdReview .bl-lab{display:flex;align-items:baseline;justify-content:space-between;gap:8px}",
    "#smdReview .bl-cnt{flex:0 0 auto;color:var(--on-surface-variant);font:600 12.5px var(--q-sans);font-variant-numeric:tabular-nums}#smdReview .bl-cnt.bad{color:var(--error)}",
    "#smdReview .bl-grp{display:flex;flex-direction:column;gap:6px;min-width:0;border-radius:12px}#smdReview .bl-hint{color:var(--on-surface-variant);font:500 12.5px/1.4 var(--q-sans)}",
    "#smdReview .bl-chips{display:flex;flex-wrap:wrap;gap:8px}",
    "#smdReview .bl-chip{display:inline-flex;align-items:center;gap:4px;max-width:100%;min-height:48px;padding:8px 14px;border:1px solid var(--outline-variant);border-radius:999px;background:var(--surface);color:var(--on-surface);font:600 14px/1.25 var(--q-sans);text-align:left;overflow-wrap:anywhere;cursor:pointer}",
    "@media (hover:hover){#smdReview .bl-chip:hover,#smdReview .bl-hit:hover{border-color:var(--primary)}}#smdReview .bl-chip .kit-ic{font-size:18px}#smdReview .bl-chip.on{border-color:var(--primary);background:color-mix(in srgb,var(--primary) 14%,var(--sc-lowest));color:var(--primary)}",
    "#smdReview .bl-hits{display:flex;flex-direction:column;border:1px solid var(--outline-variant);border-radius:12px;overflow:hidden}",
    "#smdReview .bl-hit{display:flex;align-items:center;gap:8px;min-height:48px;padding:8px 12px;border:0;border-top:1px solid var(--sc-high);background:var(--sc-lowest);color:var(--on-surface);font:500 14px/1.3 var(--q-sans);text-align:left;cursor:pointer}#smdReview .bl-hit:first-child{border-top:0}#smdReview .bl-hit .kit-ic{color:var(--primary)}",
    "#smdReview .bl-cdsco{margin:6px 0;padding:8px 10px;border-radius:10px;background:var(--sc-low);font:500 13px/1.45 var(--q-sans)}#smdReview .bl-cdsco.found{background:color-mix(in srgb,var(--primary) 10%,var(--sc-lowest))}#smdReview .bl-cdsco ul{margin:6px 0 0;padding-left:18px}",
    "#smdReview .bl-fmt{display:flex;align-items:center;gap:6px;flex-wrap:wrap}",
    "#smdReview .bl-fmt-b{min-width:48px;min-height:48px;border:1px solid var(--outline-variant);border-radius:10px;background:var(--sc-lowest);color:var(--on-surface);font:15px var(--q-sans);cursor:pointer}#smdReview .bl-fmt-hint{flex:1 1 160px;font-size:12.5px}",
    "#smdReview .bl-vlinks{display:flex;flex-wrap:wrap;gap:8px}",
    "#smdReview .bl-vlink{display:inline-flex;align-items:center;min-height:48px;padding:4px 14px;border-radius:999px;border:1px solid var(--primary);color:var(--primary);font:650 14px var(--q-sans);text-decoration:none}",
    "#smdReview .bl-vlink[aria-disabled=true]{border-color:var(--outline-variant);color:var(--on-surface-variant);pointer-events:none}",
    "#smdReview .bl-nums:empty{display:none}#smdReview .bl-nums{display:flex;flex-direction:column;gap:6px}",
    "#smdReview .bl-num{display:inline-block;padding:3px 9px;border-radius:999px;background:var(--bl-amber-bg);color:var(--bl-amber);font:650 12.5px var(--q-sans);font-variant-numeric:tabular-nums}",
    // bottom bar
    "#smdReview .bl-bar{position:sticky;bottom:calc(-28px - env(safe-area-inset-bottom,0px));z-index:3;display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin:4px -16px 0;padding:8px 16px calc(10px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--outline-variant);background:var(--bg)}",
    "#smdReview .bl-bar-s{flex:1 1 200px;min-width:0}#smdReview .bl-bar-b{display:flex;flex:1 1 250px;gap:8px}#smdReview .bl-bar-b button{flex:1 1 auto;justify-content:center;min-height:48px}",
    "#smdReview .bl-left{display:flex;align-items:center;gap:8px;width:100%;min-height:48px;padding:2px 0;border:0;background:transparent;color:var(--on-surface);font:500 14px/1.35 var(--q-sans);text-align:left;cursor:pointer}",
    "#smdReview .bl-left span:not(.kit-ic){flex:1 1 auto;min-width:0}#smdReview .bl-left .kit-ic{color:var(--primary)}#smdReview .bl-left.fix,#smdReview .bl-left.fix .kit-ic{color:var(--error)}",
    "#smdReview .bl-ready{display:flex;align-items:center;gap:6px;min-height:48px;color:var(--primary);font:650 14px var(--q-sans)}",
    // sign sheet
    "#smdReview .bl-cks{display:flex;flex-direction:column;gap:8px;min-width:0;margin:0;padding:0;border:0}#smdReview .bl-cks legend{margin-bottom:8px;padding:0}",
    "#smdReview .bl-ck{display:flex;align-items:flex-start;gap:12px;min-height:52px;padding:12px 14px;border:1px solid var(--outline-variant);border-radius:14px;background:var(--sc-lowest);color:var(--on-surface);font:500 15px/1.45 var(--q-sans);cursor:pointer;transition:background-color .15s,border-color .15s}",
    "#smdReview .bl-ck input{flex:0 0 auto;width:22px;height:22px;margin:1px 0 0;accent-color:var(--primary)}",
    "#smdReview .bl-ck:has(input:checked){border-color:var(--primary);background:color-mix(in srgb,var(--primary) 9%,var(--sc-lowest))}",
    "#smdReview .bl-ck-s{margin:0;color:var(--on-surface-variant);font:600 13px/1.4 var(--q-sans)}#smdReview .bl-ck-s.ok{color:var(--primary)}",
    "#smdReview .bl-signbtn{width:100%;justify-content:center;min-height:52px;font-size:15px;text-align:center}#smdReview .bl-signbar .bl-ck-s{flex:1 1 100%}",
    // focus and the jump highlight
    "#smdReview :is(.bl-chip,.bl-seg button,.bl-q button,.bl-bar button,.bl-fold>summary,.bl-vlink,.bl-hit,.bl-fmt-b,.bl-undo button):focus-visible,#smdReview .bl-ck:has(input:focus-visible){outline:3px solid color-mix(in srgb,var(--primary) 55%,transparent);outline-offset:2px}",
    "#smdReview [tabindex='-1']:focus{outline:none}",
    "@keyframes blFlash{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--fl) 50%,transparent)}100%{box-shadow:0 0 0 12px transparent}}",
    "#smdReview .bl-flash{--fl:var(--primary);outline:2px solid var(--fl);outline-offset:3px;animation:blFlash .9s cubic-bezier(.16,1,.3,1) 2}#smdReview .bl-flash.bad{--fl:var(--error)}",
    "@media (prefers-reduced-motion:reduce){#smdReview .bl-flash,#smdReview .bl-sk>*{animation:none}#smdReview .bl-chev,#smdReview .bl-ck,#smdReview .bl-seg button{transition:none}}",
  ].join("");
  function deskCSS() {
    if (!D || D.getElementById("smdBulletinDeskCss")) return;
    var s = D.createElement("style"); s.id = "smdBulletinDeskCss"; s.textContent = DESK_CSS;
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
    var c = DS.cur, miss = missing(c), body = {};
    if (miss.length) { jump(); return; }   // the bottom bar already names every gap
    Object.keys(c).forEach(function (k) { if (k.charAt(0) !== "_" && k !== "state" && k !== "body_hash") body[k] = c[k]; });
    DS.busy = true; DS.busyAct = thenSign ? "savesign" : "save"; say(""); rerender();
    return api("POST", "", body).then(function (r) {
      DS.busy = false;
      if (r.status !== 200) { say(errText(r)); rerender(); return; }
      var it = r.data.item, src = c._src;
      DS.cur = fromItem(it); DS.cur._src = src;
      DS.queue = null;
      if (thenSign) { DS.saved = Object.assign({}, DS.cur); DS.ck = {}; DS.view = "sign"; }
      else say("Draft saved. It is not on the disease page until you sign it.", "ok");
      rerender();
      if (thenSign) scrollTop();
    });
  }
  function signGo() {
    var cl = {}, missingTick = false;
    CHECKS.forEach(function (c) { var el = D.getElementById("bl_ck_" + c[0]); cl[c[0]] = !!(el && el.checked); if (!cl[c[0]]) missingTick = true; });
    if (missingTick) { say("Tick every item before signing."); rerender(); return; }
    DS.busy = true; say(""); rerender();
    api("POST", "/" + encodeURIComponent(DS.saved.id) + "/sign", { body_hash: DS.saved.body_hash, checklist: cl }).then(function (r) {
      DS.busy = false;
      if (r.status !== 200) {
        say(errText(r));
        if (r.status === 409) { DS.view = "edit"; DS.queue = null; }
        rerender(); if (r.status === 409) scrollTop(); return;
      }
      toast("Signed. It shows on the disease page after the next sync.");
      DS.view = "list"; DS.cur = null; DS.saved = null; DS.queue = null; say("Signed. It shows on the disease page after the next sync.", "ok");
      try { B().sync(true); } catch (e) {}
      rerender(); scrollTop();
      probe().then(rerender);   // refresh the waiting count on the tab
    });
  }
  function skip(id, undo) {
    var q = DS.queue || {}, cands = q.candidates || [], cand = cands.filter(function (x) { return x.id === id; })[0], p = DS.me && DS.me.pending;
    if (!undo) {
      if (!cand) return;
      q.candidates = cands.filter(function (x) { return x.id !== id; });   // at once; put back if the server refuses
      DS.undo = id; say("");
      if (p && p.candidates) { p.candidates--; p.total = Math.max(0, (p.total || 1) - 1); }
      rerender();
      var u = D.querySelector('#smdReview [data-bl-act="unskip:' + id + '"]'); if (u) { try { u.focus({ preventScroll: true }); } catch (e) {} }
    } else { DS.undo = null; rerender(); }
    api("POST", "/skip", { update_id: id, undo: !!undo }).then(function (r) {
      if (r.status !== 200) { say(errText(r)); DS.undo = null; DS.queue = null; probe().then(rerender); return; }
      if (undo) { DS.queue = null; say("Back in the queue.", "ok"); }
      probe().then(rerender);
    });
  }

  function onClick(e) {
    var b = e.target && e.target.closest && e.target.closest("[data-bl-act]"); if (!b || !b.closest("#smdReview")) return;
    var act = b.getAttribute("data-bl-act"), i = act.indexOf(":"), cmd = i < 0 ? act : act.slice(0, i), arg = i < 0 ? "" : act.slice(i + 1);
    if (cmd !== "back" && cmd !== "toedit") collect();
    if (cmd === "back") { DS.view = "list"; DS.cur = null; say(""); DS.look = null; DS.queue = null; DS.undo = null; rerender(); scrollTop(); return; }
    if (cmd === "toedit") { DS.view = "edit"; say(""); rerender(); scrollTop(); return; }
    if (cmd === "filter") { DS.filter = arg === "live" ? "live" : "todo"; DS.undo = null; say(""); rerender(); return; }
    if (cmd === "skip") { skip(arg, false); return; }
    if (cmd === "retry") { DS.queueErr = ""; rerender(); return; }
    if (cmd === "unskip") { skip(arg, true); return; }
    if (cmd === "new") {
      var cand = ((DS.queue && DS.queue.candidates) || []).filter(function (x) { return x.id === arg; })[0];
      if (cand) { DS.cur = fromCandidate(cand); DS.view = "edit"; say(""); DS.dq = ""; DS.undo = null; DS.open = { prev: DS.open.prev }; rerender(); scrollTop(); }
      return;
    }
    if (cmd === "edit") {
      var it = ((DS.queue && DS.queue.items) || []).filter(function (x) { return x.id === arg; })[0];
      if (it) {
        DS.cur = fromItem(it); DS.view = "edit"; DS.dq = ""; DS.undo = null; DS.open = { prev: DS.open.prev };
        if (it.state === "source_changed") say("The source changed. Read it again, update the text if needed, then save and sign.", "warn"); else say("");
        rerender(); scrollTop();
      }
      return;
    }
    if (cmd === "set" && DS.cur) {
      var j = arg.indexOf(":"), k = arg.slice(0, j), v = arg.slice(j + 1);
      if (["kind", "india_status", "evidence_type", "regulator", "review_months"].indexOf(k) >= 0) { DS.cur[k] = k === "review_months" ? (Number(v) || 12) : v; rerender(); }
      return;
    }
    if (cmd === "jump") { jump(); return; }
    if (cmd === "dz") { if (DS.cur && DS.cur.disease_ids.length < 5 && DS.cur.disease_ids.indexOf(arg) < 0) DS.cur.disease_ids.push(arg); DS.dq = ""; rerender(); return; }
    if (cmd === "undz") { if (DS.cur) DS.cur.disease_ids = DS.cur.disease_ids.filter(function (x) { return x !== arg; }); rerender(); return; }
    if (cmd === "fmt") { applyFmt(arg); return; }
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
    if (cmd === "retract") { DS.cur._retracting = true; rerender(); var rr = D.getElementById("bl_rreason"); if (rr) try { rr.focus(); } catch (x) {} return; }
    if (cmd === "retractgo") {
      var reason = val("bl_rreason").trim();
      if (reason.length < 10) { say("Give a reason of at least 10 characters."); rerender(); return; }
      api("POST", "/" + encodeURIComponent(DS.cur.id) + "/retract", { reason: reason }).then(function (r) {
        if (r.status !== 200) { say(errText(r)); rerender(); return; }
        DS.view = "list"; DS.cur = null; DS.queue = null; say("Retracted. Phones drop it on their next sync.", "ok");
        try { B().sync(true); } catch (e) {}
        rerender();
      });
      return;
    }
    if (cmd === "signers") { DS.view = "signers"; say(""); DS.signers = null; DS.look = null; rerender(); scrollTop(); return; }
    if (cmd === "addme") { var sf = DS.me.self || {}; DS.look = { uid: sf.uid, name: sf.name || "", reg_no: sf.reg_no || "", council: sf.council || "", verified: true }; rerender(); return; }
    if (cmd === "lookup") {
      var em = val("bl_lemail").trim();
      if (!em) return;
      api("GET", "/signers/lookup?email=" + encodeURIComponent(em)).then(function (r) {
        if (r.status !== 200) { say(r.data.error === "no-account" ? "No StewardMD account has that email." : errText(r)); DS.look = null; rerender(); return; }
        var p = r.data.prefill || {};
        DS.look = { uid: r.data.uid, name: p.name || "", reg_no: p.reg_no || "", council: p.council || "", verified: r.data.verified };
        say(""); rerender();
      });
      return;
    }
    if (cmd === "saveSigner" && DS.look) {
      api("POST", "/signers", { uid: DS.look.uid, name: val("bl_sname"), reg_no: val("bl_sreg"), council: val("bl_scouncil") }).then(function (r) {
        if (r.status !== 200) { say(r.data.error === "not-verified-doctor" ? "This account is not a verified doctor." : "Check the name, registration number and council."); rerender(); return; }
        DS.look = null; DS.signers = null; say("Signer saved.", "ok");
        probe().then(rerender);
      });
      return;
    }
    if (cmd === "deact") { api("POST", "/signers/" + encodeURIComponent(arg) + "/deactivate").then(function () { DS.signers = null; probe().then(rerender); }); return; }
    if (cmd === "kill") { DS.view = "kill"; say(""); rerender(); scrollTop(); return; }
    if (cmd === "killgo") {
      var kr = val("bl_kreason").trim(), killed = !(DS.me && DS.me.killed);
      if (kr.length < 10) { say("Give a reason of at least 10 characters."); rerender(); return; }
      api("POST", "/kill", { killed: killed, reason: kr }).then(function (r) {
        if (r.status !== 200) { say(errText(r)); rerender(); return; }
        DS.view = "list"; say(killed ? "Switched off for everyone." : "Switched back on.", "ok");
        try { B().sync(true); } catch (e) {}
        probe().then(rerender);
      });
    }
  }
  // A new screen scrolls to its top and takes focus on its heading, so screen readers and keyboards land there too.
  function scrollTop() {
    var b = D.querySelector("#smdReview .kit-sheet-body"); if (b) b.scrollTop = 0;
    var h = D.querySelector("#smdReview .dl-h, #smdReview .bl-sum-h");
    if (h) { h.setAttribute("tabindex", "-1"); try { h.focus({ preventScroll: true }); } catch (e) {} }
  }
  function onInput(e) {
    var el = e.target; if (!el || !el.id || el.id.indexOf("bl_") !== 0) return;
    if (el.id === "bl_dq") {
      collect(); DS.dq = el.value; var pos = el.selectionStart; rerender();
      var q = D.getElementById("bl_dq"); if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch (x) {} }
      return;
    }
    if (DS.view !== "edit" || !DS.cur) return;
    collect();
    if (el.id === "bl_source_url" || el.id === "bl_doi" || el.id === "bl_pmid") refreshVerifyLinks();
    refreshLive();
  }
  function onChange(e) {
    var el = e.target; if (!el || !/^bl_ck_/.test(el.id || "")) return;
    DS.ck = DS.ck || {}; DS.ck[el.id.slice(6)] = !!el.checked;
    var n = ticked(), all = n === CHECKS.length, btn = D.querySelector('#smdReview [data-bl-act="signgo"]'), st = D.getElementById("bl_ck_s");
    if (btn) btn.disabled = DS.busy || !all;
    if (st) { st.textContent = ckStatus(n); st.className = "bl-ck-s" + (all ? " ok" : ""); }
  }
  // Remember which folds (AI summary, source details, preview) are open across re-renders. toggle does not bubble.
  function onToggle(e) { var el = e.target, k = el && el.getAttribute && el.getAttribute("data-bl-open"); if (k) DS.open[k] = !!el.open; }
  function onFocusIn(e) { var el = e.target; if (el && FMT_FIELDS.indexOf(el.id) >= 0) DS.fmtField = el.id; }
  // Keep the text field's selection when a format button is pressed (desktop; iOS keeps it on its own).
  function onMouseDown(e) { var b = e.target && e.target.closest && e.target.closest(".bl-fmt-b"); if (b) e.preventDefault(); }
  if (D && D.addEventListener && !G.__smdBulletinDeskWired) {
    G.__smdBulletinDeskWired = true;
    D.addEventListener("click", onClick, false); D.addEventListener("input", onInput, false); D.addEventListener("change", onChange, false);
    D.addEventListener("toggle", onToggle, true);
    D.addEventListener("focusin", onFocusIn, false); D.addEventListener("mousedown", onMouseDown, false);
  }

  function pendingTotal() { var p = DS.me && DS.me.pending; return (p && p.total) || 0; }
  var API = { probe: probe, html: html, pendingTotal: pendingTotal, reset: function () { DS.view = "list"; DS.queue = null; DS.cur = null; DS.msg = ""; DS.filter = "todo"; DS.undo = null; }, _state: DS, _previewOf: previewOf,
    _numbersIn: numbersIn, _suggestDiseases: suggestDiseases, _firstSentences: firstSentences, _linkFields: linkFields, _toHttps: toHttps, _missing: missing };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  G.SMD_BULLETINS_DESK = API;
})(typeof window !== "undefined" ? window : globalThis);
