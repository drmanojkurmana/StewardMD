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
    "not-applicable-approval": "cannot be Not applicable for an approval; choose approved by CDSCO, not yet approved, or not confirmed",
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

  /* ---------------- pre-sign checks ----------------
   * Things a second doctor would catch. They never block signing; the codes the signer saw are sent with the
   * signature and kept in the audit (functions/_bulletin_rules.js WARNING_CODES), so the numbers can show whether
   * signing with a warning showing goes with later corrections. */
  var INDEX_WORDS = { news: 1, "news-events": 1, newsroom: 1, "press-releases": 1, "press-announcements": 1, press: 1, updates: 1,
    "whats-new": 1, guidelines: 1, publications: 1, index: 1, "index.html": 1, "index.htm": 1, home: 1, homepage: 1, media: 1,
    announcements: 1, notifications: 1, "public-notices": 1 };
  // A list or home page, not the item: no path, or a last segment that names a listing (language codes ignored).
  function isIndexLink(u) {
    var path;
    try { path = new G.URL(String(u || "")).pathname; } catch (e) { return false; }
    var segs = path.split("/").filter(function (x) { return x && !/^[a-z]{2}(-[a-z]{2})?$/i.test(x); });
    return !segs.length || !!INDEX_WORDS[segs[segs.length - 1].toLowerCase()];
  }
  function words(s) { return String(s || "").toLowerCase().replace(/\[\/?[biu]\]/g, "").replace(/[^a-z0-9%.]+/g, " ").trim().split(" ").filter(Boolean); }
  // Share of the text's 5-word runs that also occur in the source summary (1 = copied).
  function overlap(text, src) {
    var a = words(text), b = words(src), n = 5;
    if (a.length < n || b.length < n) return 0;
    var set = {}, hit = 0, tot = 0;
    for (var i = 0; i + n <= b.length; i++) set[b.slice(i, i + n).join(" ")] = 1;
    for (var j = 0; j + n <= a.length; j++) { tot++; if (set[a.slice(j, j + n).join(" ")]) hit++; }
    return tot ? hit / tot : 0;
  }
  // Numbers in the text whose digits appear nowhere in the source title or summary.
  function numbersNotIn(text, src) {
    var have = {};
    String(src || "").replace(/\d+(?:\.\d+)?/g, function (m) { have[m] = 1; return m; });
    return numbersIn(text).filter(function (n) {
      var ds = n.match(/\d+(?:\.\d+)?/g) || [];
      return ds.length && ds.some(function (d) { return !have[d]; });
    });
  }
  function checksFor(c) {
    var w = [], s = c._src || {}, src = [s.title, s.summary].join(" "), r = c._cdsco;
    if (c.source_url && isIndexLink(c.source_url)) w.push(["index_link", "The source link opens a list page, not the item itself. Link the exact announcement or paper."]);
    if (r && !r.error && (r.checked || []).length) {
      var q = String(r.q || cdscoQuery(c));
      if ((r.matches || []).length && (c.india_status === "not_approved_india" || c.india_status === "unknown"))
        w.push(["cdsco_contradiction", "The CDSCO new-drug lists show a match for " + q + ". Check whether it is the same drug and form before saying it is not approved in India."]);
      if (!(r.matches || []).length && c.india_status === "cdsco_approved")
        w.push(["cdsco_unconfirmed", "Not found in the CDSCO new-drug lists. Make sure you confirmed the approval another way."]);
    }
    if (s.summary && overlap(c.what_changed, s.summary) >= 0.6) w.push(["ai_verbatim", "What changed is still mostly the AI summary's wording. Rewrite it in your own words."]);
    if (s.summary) {
      var nn = numbersNotIn([c.headline, c.what_changed, c.applies_to].join(" "), src);
      if (nn.length) w.push(["numbers_unsourced", "Not in the source summary: " + nn.join(", ") + ". Check each against the paper."]);
    }
    return w;
  }
  function checksHtml(w, title) {
    return w.length ? '<div class="bl-banner warn bl-checks" id="bl_checks">' + ms("warning") + "<div><b>" + esc(title) + "</b><ul>" +
      w.map(function (x) { return "<li>" + esc(x[1]) + "</li>"; }).join("") + '</ul><span class="bl-hint">These do not stop you signing. What you saw is kept with your signature.</span></div></div>' : "";
  }
  // Approvals: look the drug up in the CDSCO lists as soon as the editor opens, so the check above can run.
  function autoCdsco(c) {
    if (!c || c.kind !== "approval" || c._cdscoAuto || c._cdsco) return;
    var q = String(cdscoQuery(c) || "").trim();
    if (q.length < 4) return;
    c._cdscoAuto = true;
    api("GET", "/cdsco?q=" + encodeURIComponent(q)).then(function (r) { if (r.status === 200) { c._cdsco = r.data; if (DS.cur === c || DS.sec === c) rerender(); } });
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
    o._returned = it.returned_note || "";
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
    if (d.error === "same-signer") return "You signed this one. A different doctor must be the second reader.";
    if (d.error === "not-awaiting-second") return "This update no longer needs a second reader. Go back to the queue.";
    if (d.error === "note-required") return "Write what needs fixing (10 to 500 characters).";
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
    else if (c.kind === "approval" && c.india_status === "not_applicable") add("india_status", "India status", "bl_sec_india_status", false, true);
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
    if (it.state === "awaiting_second") return it.can_cosign ? "second" : "waiting2";
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
    if (it.state === "awaiting_second") {
      return it.can_cosign
        ? qCard(it.kind, true, typeChip(it.kind) + metaLine(it.source_label, it.source_date), B().plain(it.headline), (it.disease_ids || []).map(diseaseName).join(", "),
          ["Signed by " + drName(it.signed_name) + ". Needs a second doctor before it shows.", "warn", "group"],
          '<button type="button" class="kit-add" data-bl-act="second:' + esc(it.id) + '">' + ms("fact_check") + "Read and confirm</button>")
        : qCard(it.kind, false, typeChip(it.kind) + metaLine(it.source_label, it.source_date), B().plain(it.headline), (it.disease_ids || []).map(diseaseName).join(", "),
          ["You signed it. Waiting for a second doctor to confirm.", "", "hourglass_top"],
          '<button type="button" class="kit-clear" data-bl-act="edit:' + esc(it.id) + '">Open</button>');
    }
    if (it.returned_note && (it.state === "draft" || it.state === "edited")) {
      return qCard(it.kind, true, typeChip(it.kind) + metaLine(it.source_label, it.source_date), B().plain(it.headline), (it.disease_ids || []).map(diseaseName).join(", "),
        ["Sent back by the second doctor: " + it.returned_note, "warn", "undo"],
        '<button type="button" class="kit-add" data-bl-act="edit:' + esc(it.id) + '">' + ms("edit") + "Fix and sign again</button>");
    }
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
  function specName(k) { var o = ((DS.me && DS.me.specialtyOptions) || []).filter(function (x) { return x[0] === k; })[0]; return o ? o[1] : k; }
  function drName(n) { n = String(n || "").replace(/^\s*dr\.?\s+/i, ""); return n ? "Dr " + n : "another doctor"; }
  function group(title, cards) { return cards.length ? '<h3 class="bl-gh">' + esc(title) + '<span class="bl-gn">' + cards.length + '</span></h3><div class="bl-ql">' + cards.join("") + "</div>" : ""; }
  function empty(icon, text) { return '<div class="bl-empty">' + ms(icon) + "<p>" + esc(text) + "</p></div>"; }

  function listView(tabs) {
    var me = DS.me || {}, q = DS.queue, pd = me.pending;
    var head = tabs + msgHtml();
    if (me.killed) head += '<p class="bl-banner warn" role="status">' + ms("block") + "<span>Practice updates are switched off for everyone.</span></p>";
    var tools = me.canSign || me.isOwner ? '<div class="bl-tools"><p class="bl-gh">Desk tools</p><div class="kit-row">' +
      '<button type="button" class="kit-pill" data-bl-act="numbers">' + ms("monitoring") + "Numbers</button>" +
      (me.isOwner ? '<button type="button" class="kit-pill" data-bl-act="signers">' + ms("badge") + "Signers</button>" +
        '<button type="button" class="kit-pill" data-bl-act="second-reader">' + ms("group") + "Second reader: " + (me.secondReader === false ? "off" : "on") + "</button>" +
        '<button type="button" class="kit-pill" data-bl-act="kill">' + ms(me.killed ? "toggle_on" : "block") + (me.killed ? "Switch back on" : "Switch off for everyone") + "</button>" : "") +
      "</div></div>" : "";
    var waiting = pd && pd.total ? "Waiting for you: " + [
      pd.candidates ? pd.candidates + " new source item" + (pd.candidates === 1 ? "" : "s") : "",
      pd.source_changed ? pd.source_changed + " source change" + (pd.source_changed === 1 ? "" : "s") : "",
      pd.drafts ? pd.drafts + " draft" + (pd.drafts === 1 ? "" : "s") : "",
      pd.review_due ? pd.review_due + " due for review" : "",
      pd.second_reads ? pd.second_reads + " to read as second doctor" : ""].filter(Boolean).join(", ") + "." : "Nothing waiting for you.";
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
    // Specialties: a signer who set theirs sees their items (and items no specialty claims) unless they ask for all.
    var mySpec = (me.signer && me.signer.specialties) || [], narrow = mySpec.length && !DS.allSpec;
    var keep = function (x) { return !narrow || x.mine !== false; };
    var items = (q.items || []).filter(keep), cands = (q.candidates || []).filter(keep), soon = Date.now() + 30 * 86400000;
    var hidden = (q.items || []).length + (q.candidates || []).length - items.length - cands.length;
    var by = function (b) { return items.filter(function (i) { return bucket(i, soon) === b; }); };
    var check = by("check"), drafts = by("draft"), live = by("live"), second = by("second"), waiting2 = by("waiting2");
    var todoN = check.length + drafts.length + cands.length + second.length, f = DS.filter === "live" ? "live" : "todo";
    var specLine = mySpec.length ? '<p class="bl-spec" role="status">' + (narrow
      ? "Your specialties: " + esc(mySpec.map(specName).join(", ")) + (hidden ? ". " + hidden + " other item" + (hidden === 1 ? " is" : "s are") + " hidden." : ".") + ' <button type="button" class="kit-link" data-bl-act="allspec:1">Show all</button>'
      : 'Showing every specialty. <button type="button" class="kit-link" data-bl-act="allspec:0">Only mine</button>') + "</p>" : "";
    var seg = function (k, label, n) { return '<button type="button" data-bl-act="filter:' + k + '" aria-pressed="' + (f === k) + '">' + label + '<span class="bl-badge">' + n + "</span></button>"; };
    var undo = DS.undo ? '<div class="bl-undo" role="status"><span>Skipped. It leaves the queue for every signer.</span><button type="button" class="kit-link" data-bl-act="unskip:' + esc(DS.undo) + '">Undo</button></div>' : "";
    var card = function (it) { return itemCard(it, soon); };
    var body = f === "live"
      ? (live.length ? group("On the disease page", live.map(card)) : empty("verified", "Nothing is live yet. Updates you sign appear here."))
      : (todoN ? group("Read as second doctor", second.map(card)) + group("Check again", check.map(card)) + group("Your drafts", drafts.map(card)) +
          group("New from journals and regulators", cands.map(candCard))
        : empty("task_alt", "All caught up. New journal and regulator items arrive every day, and you get a reminder on Saturday morning.")) +
        group("Waiting for a second doctor", waiting2.map(card));
    return head + '<div class="bl-seg" role="group" aria-label="Show">' + seg("todo", "To do", todoN) + seg("live", "Live", live.length) + "</div>" + specLine + undo + body + tools;
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
      chips("india_status", "India status", Object.keys(Bk.INDIA).map(function (k) { return [k, Bk.INDIA[k][0]]; }), c.india_status,
        c.kind === "approval" && c.india_status === "not_applicable" ? "An approval always has an India status: approved by CDSCO, not yet approved, or not confirmed."
          : "Your choice. The CDSCO check below is evidence, not the answer.") +
      cdscoPanel(c) +
      chips("evidence_type", "Evidence", Object.keys(Bk.EVID).map(function (k) { return [k, Bk.EVID[k]]; }), c.evidence_type) +
      chips("regulator", "Regulator", REG_OPTS, c.regulator || "") +
      chips("review_months", "Review again in", REVIEW_OPTS, String(c.review_months || 12)) +
      tfield("evidence_note", "Evidence note (optional, only a grade the source states)", c.evidence_note, 160, 0, "For example: Class I, level A") +
      "</section>";
  }
  function names(list) { var n = list.map(function (m) { return m.label; }); return n.slice(0, 3).join(", ") + (n.length > 3 ? " and " + (n.length - 3) + " more" : ""); }
  function barStatus(miss, checks) {
    if (!miss.length && (checks || []).length) return '<button type="button" class="bl-left chk" data-bl-act="checks">' + ms("warning") + "<span><b>Ready to sign,</b> with " + checks.length +
      " check" + (checks.length === 1 ? "" : "s") + " to look at</span>" + ms("arrow_forward") + "</button>";
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
    var c = DS.cur, miss = missing(c), live = c.state === "live" || c.state === "review_due" || c.state === "awaiting_second", checks = checksFor(c);
    autoCdsco(c);
    return '<div class="bl-editor"><button type="button" class="kit-link" data-bl-act="back">' + ms("arrow_back") + "Back to the queue</button>" +
      '<h2 class="dl-h">' + (c.id ? "Edit update" : "New update") + "</h2>" + msgHtml() +
      (c._returned ? '<p class="bl-banner warn" role="status">' + ms("undo") + "<span><b>Sent back by the second doctor:</b> " + esc(c._returned) + "</span></p>" : "") +
      (live ? '<p class="bl-banner warn">' + ms("info") + "<span>" + (c.state === "awaiting_second" ? "This update is waiting for a second doctor. Saving a change means both of you sign again."
        : "This update is on the disease page. Saving a change takes it off until you sign it again.") + "</span></p>" : "") +
      sourceStep(c, miss) + writeStep(c) + classifyStep(c) +
      '<div id="bl_checks_wrap">' + (DS._checks = checksHtml(checks, "Checks before signing")) + "</div>" +
      fold("prev", DS.open.prev, '<span class="bl-fold-l">Preview on the disease page</span>', '<div class="bl-preview">' + B().card(previewOf(c)) + "</div>", "bl-prevd") +
      (c.id ? '<div class="bl-retract">' + (c._retracting
        ? field("bl_rreason", "Why is it being retracted? (10 to 300 characters)", txt("bl_rreason", "", 300, 2), true) + '<div class="kit-row"><button type="button" class="kit-clear bl-danger" data-bl-act="retractgo">Retract now</button></div>'
        : '<button type="button" class="kit-clear bl-danger" data-bl-act="retract">' + ms("remove_circle") + "Retract this update</button>") + "</div>" : "") +
      '<div class="bl-bar"><div class="bl-bar-s" id="bl_bar_s" aria-live="polite">' + (DS._bar = barStatus(miss, checks)) + "</div>" +
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
    var ch = checksFor(c), bar = barStatus(missing(c), ch), s = D.getElementById("bl_bar_s");
    if (s && bar !== DS._bar) { s.innerHTML = bar; DS._bar = bar; }
    var cw = D.getElementById("bl_checks_wrap"), chHtml = checksHtml(ch, "Checks before signing");
    if (cw && chHtml !== DS._checks) { cw.innerHTML = chHtml; DS._checks = chHtml; }
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
  function ckStatus(n) {
    var confirm = DS.view === "second";
    return n === CHECKS.length ? (confirm ? "All four checked. You can confirm." : "All four confirmed. You can sign.")
      : "Tick every item before " + (confirm ? "confirming" : "signing") + ". " + n + " of " + CHECKS.length + " done.";
  }
  function signView() {
    var it = DS.saved, s = (DS.me && DS.me.signer) || {}, ck = DS.ck || {}, n = ticked(), all = n === CHECKS.length;
    return '<button type="button" class="kit-link" data-bl-act="toedit">' + ms("arrow_back") + "Back to editing</button>" +
      '<h2 class="dl-h">Sign this update</h2>' + msgHtml() +
      '<p class="kit-muted">Doctors will see exactly this on ' + esc((it.disease_ids || []).map(diseaseName).join(", ")) + ".</p>" +
      checksHtml(checksFor(it), "Look at these before signing") +
      (DS.me && DS.me.secondReader !== false && (it.kind === "approval" || it.kind === "safety")
        ? '<p class="bl-banner">' + ms("group") + "<span>An approval or safety alert also needs a second doctor to confirm it before it shows.</span></p>" : "") +
      '<div class="bl-preview">' + B().card(previewOf(it)) + "</div>" +
      '<fieldset class="bl-cks"><legend class="kit-fl">Before you sign, confirm each point</legend>' + CHECKS.map(function (c) {
        return '<label class="bl-ck" for="bl_ck_' + c[0] + '"><input type="checkbox" id="bl_ck_' + c[0] + '"' + (ck[c[0]] ? " checked" : "") + "><span>" + esc(c[1]) + "</span></label>";
      }).join("") + "</fieldset>" +
      '<p class="kit-muted">Your name, registration number and today\'s date appear with the update. Any later edit takes it off the disease page until it is signed again.</p>' +
      '<div class="bl-bar bl-signbar"><p id="bl_ck_s" class="bl-ck-s' + (all ? " ok" : "") + '" role="status">' + esc(ckStatus(n)) + "</p>" +
      '<button type="button" class="kit-add bl-signbtn" data-bl-act="signgo"' + (DS.busy || !all ? " disabled" : "") + ">" + ms("verified") +
      (DS.busy ? "Signing…" : "Sign as " + esc(/^dr\.?\s/i.test(s.name || "") ? s.name : "Dr " + (s.name || "")) + ", Reg. No. " + esc(s.regNo || "")) + "</button></div>";
  }

  /* ---------------- second reader ---------------- */
  function fromSigned(it) {
    var o = fromItem(it);
    o._signedName = it.signed_name; o._signedReg = it.signed_reg; o._signedCouncil = it.signed_council; o._signedTs = it.signed_ts; o._due = it.review_due_ts;
    return o;
  }
  function secondPreview(it) {
    var p = previewOf(it), me = (DS.me && DS.me.signer) || {};
    p.signed_name = it._signedName; p.signed_reg = it._signedReg; p.signed_council = it._signedCouncil; p.signed_ts = it._signedTs; p.review_due_ts = it._due;
    p.second_name = me.name || ""; p.second_reg = me.regNo || ""; p.second_council = me.council || "";
    return p;
  }
  function secondView() {
    var it = DS.sec, ck = DS.ck || {}, n = ticked(), all = n === CHECKS.length, me = (DS.me && DS.me.signer) || {};
    return '<button type="button" class="kit-link" data-bl-act="back">' + ms("arrow_back") + "Back to the queue</button>" +
      '<h2 class="dl-h">Read as second doctor</h2>' + msgHtml() +
      '<p class="kit-muted">Signed by ' + esc(drName(it._signedName)) + ", Reg. No. " + esc(it._signedReg || "") + ", on " + esc(fmtDate(it._signedTs)) +
      ". Read it against the source and confirm only if you would sign it yourself.</p>" +
      checksHtml(checksFor(it), "Checks") + verifyLinks(it) +
      '<div class="bl-preview">' + B().card(secondPreview(it)) + "</div>" +
      ((it._src || {}).summary ? fold("ai2", DS.open.ai2, '<span class="bl-fold-l">AI summary of the source, not reviewed</span>', '<p class="kit-muted bl-ai">' + esc(String(it._src.summary).slice(0, 1500)) + "</p>") : "") +
      '<fieldset class="bl-cks"><legend class="kit-fl">Before you confirm, check each point yourself</legend>' + CHECKS.map(function (c) {
        return '<label class="bl-ck" for="bl_ck_' + c[0] + '"><input type="checkbox" id="bl_ck_' + c[0] + '"' + (ck[c[0]] ? " checked" : "") + "><span>" + esc(c[1]) + "</span></label>";
      }).join("") + "</fieldset>" +
      '<div class="bl-retract">' + (DS.sendingBack
        ? field("bl_rnote", "What needs fixing? " + esc(drName(it._signedName)) + " will see this (10 to 500 characters)", txt("bl_rnote", "", 500, 3), true) +
          '<div class="kit-row"><button type="button" class="kit-clear bl-danger" data-bl-act="sendbackgo">' + ms("undo") + "Send back to " + esc(drName(it._signedName)) + "</button></div>"
        : '<button type="button" class="kit-clear" data-bl-act="sendback">' + ms("undo") + "Send back with a note</button>") + "</div>" +
      '<div class="bl-bar bl-signbar"><p id="bl_ck_s" class="bl-ck-s' + (all ? " ok" : "") + '" role="status">' + esc(ckStatus(n)) + "</p>" +
      '<button type="button" class="kit-add bl-signbtn" data-bl-act="cosigngo"' + (DS.busy || !all ? " disabled" : "") + ">" + ms("verified") +
      (DS.busy ? "Confirming…" : "Confirm as " + esc(drName(me.name)) + ", Reg. No. " + esc(me.regNo || "")) + "</button></div>";
  }

  /* ---------------- numbers ---------------- */
  function loadMetrics() {
    DS.mLoading = true;
    return api("GET", "/metrics?days=" + (DS.mWin || 90)).then(function (r) {
      DS.mLoading = false;
      DS.metrics = r.status === 200 ? r.data : { error: errText(r) };
      rerender();
    });
  }
  function pct(a, b) { return b ? Math.round((a / b) * 100) + "%" : "none yet"; }
  function numbersView() {
    var m = DS.metrics, win = DS.mWin || 90;
    if (!m && !DS.mLoading) loadMetrics();
    var chips = '<div class="bl-chips" role="group" aria-label="Period">' + [30, 90, 365].map(function (d) {
      return '<button type="button" class="bl-chip' + (d === win ? " on" : "") + '" aria-pressed="' + (d === win) + '" data-bl-act="mwin:' + d + '">' + (d === 365 ? "12 months" : d + " days") + "</button>";
    }).join("") + "</div>";
    var head = '<button type="button" class="kit-link" data-bl-act="back">' + ms("arrow_back") + "Back to the queue</button><h2 class=\"dl-h\">Numbers</h2>" +
      '<p class="kit-muted">Are signed updates reaching doctors fast, complete and right? From the signing record, last ' + (win === 365 ? "12 months" : win + " days") + ".</p>" + chips;
    if (!m) return head + '<p class="kit-muted" role="status">Loading…</p>';
    if (m.error) return head + '<p class="bl-banner err" role="alert">' + ms("error") + "<span>" + esc(m.error) + "</span></p>";
    var d = m.days_to_page || {}, c = m.correction || {}, v = m.coverage || {}, b = m.backlog || {};
    var row = function (t, dd, note) { return "<div><dt>" + esc(t) + "</dt><dd>" + dd + (note ? '<span class="bl-hint">' + esc(note) + "</span>" : "") + "</dd></div>"; };
    var kv = '<dl class="rv-kv bl-num-kv">' +
      row("Days from publication to the disease page", d.n ? "Median " + esc(d.median) + ", 90% within " + esc(d.p90) + " (" + d.n + " update" + (d.n === 1 ? "" : "s") + ")" : "No signed updates yet") +
      row("Correction rate", c.of ? esc(c.rate) + "% (" + c.corrected + " of " + c.of + " later edited, sent back or retracted)" : "No signed updates yet", "Aim: under 5%. Second reader is " + (m.second_reader ? "on" : "off") + " for approvals and safety alerts.") +
      row("Coverage", v.total ? v.signed + " of " + v.total + " source items signed (" + pct(v.signed, v.total) + "), " + v.skipped + " skipped, " + v.waiting + " waiting" : "No source items in this period") +
      row("Waiting", (b.waiting || 0) + " item" + (b.waiting === 1 ? "" : "s") + (b.oldest_days != null ? ", oldest " + b.oldest_days + " days" : "") + "; " + (b.drafts || 0) + " draft" + (b.drafts === 1 ? "" : "s") + "; " + (b.second_reads || 0) + " second read" + (b.second_reads === 1 ? "" : "s")) +
      row("Signed with checks showing", String(m.signed_with_warnings || 0), "Signed while a pre-sign check (list-page link, CDSCO mismatch, AI wording, unsourced number) was showing.") +
      "</dl>";
    var table = function (cols, rows) {
      return rows.length ? '<div class="bl-tbl"><table class="kit-table"><thead><tr>' + cols.map(function (x, i) { return "<th" + (i ? ' class="n"' : "") + ">" + esc(x) + "</th>"; }).join("") + "</tr></thead><tbody>" +
        rows.map(function (r) { return "<tr>" + r.map(function (x, i) { return "<td" + (i ? ' class="n"' : "") + ">" + esc(x) + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody></table></div>" : "";
    };
    return head + kv +
      '<h3 class="bl-gh">By source</h3>' + (table(["Source", "Items", "Signed", "Skipped", "Waiting"], (v.by_source || []).map(function (r) { return [r.source, r.total, r.signed, r.skipped, r.waiting]; })) || '<p class="kit-muted">No source items in this period.</p>') +
      '<h3 class="bl-gh">Signers</h3>' + (table(["Doctor", "Signed", "Second reads", "Sent back"], (m.signers || []).map(function (r) { return [drName(r.name), r.signs, r.cosigns, r.returns]; })) || '<p class="kit-muted">No active signers.</p>');
  }

  function secondReaderView() {
    var on = !(DS.me && DS.me.secondReader === false), m = DS.metrics, c = (m && m.correction) || {};
    if (!m && !DS.mLoading) loadMetrics();
    return '<button type="button" class="kit-link" data-bl-act="back">' + ms("arrow_back") + "Back to the queue</button>" +
      '<h2 class="dl-h">Second reader for approvals and safety alerts</h2>' + msgHtml() +
      '<p class="kit-muted">' + (on ? "On: a new approval or safety alert shows only after a second doctor confirms the same text. Keep it on until the correction rate stays under 5%."
        : "Off: one signature is enough. Switching on applies to updates signed from then on.") + "</p>" +
      '<p class="kit-muted">Correction rate, last 90 days: ' + (c.of ? esc(c.rate) + "% (" + c.corrected + " of " + c.of + ")" : "no signed updates yet") + ".</p>" +
      (on ? '<p class="bl-banner warn">' + ms("info") + "<span>Switching off releases approvals and safety alerts that are waiting for a second doctor.</span></p>" : "") +
      field("bl_sreason", "Reason (10 to 300 characters)", txt("bl_sreason", "", 300, 3), true) +
      '<div class="kit-row"><button type="button" class="' + (on ? "kit-clear" : "kit-add") + '" data-bl-act="srgo">' + (on ? "Switch off" : "Switch on") + "</button></div>";
  }

  function specChips(sel) {
    var opts = (DS.me && DS.me.specialtyOptions) || [];
    return '<div class="bl-grp" role="group" aria-labelledby="bl_lbl_spec"><span class="kit-fl" id="bl_lbl_spec">Specialties they sign for</span>' +
      '<span class="bl-hint">None chosen: they see every item. Chosen: their specialties first, with Show all one tap away.</span><div class="bl-chips">' +
      opts.map(function (o) { var on = sel.indexOf(o[0]) >= 0; return '<button type="button" class="bl-chip' + (on ? " on" : "") + '" aria-pressed="' + on + '" data-bl-act="spec:' + esc(o[0]) + '">' + (on ? ms("check") : "") + esc(o[1]) + "</button>"; }).join("") +
      "</div></div>";
  }

  function signersView() {
    var me = DS.me || {}, L = DS.look;
    if (!DS.signers) loadSigners();
    return '<button type="button" class="kit-link" data-bl-act="back">' + ms("arrow_back") + "Back to the queue</button><h2 class=\"dl-h\">Signers</h2>" + msgHtml() +
      '<p class="kit-muted">Only doctors listed here can sign. Check each name and registration number against the NMC register before saving.</p>' +
      '<div class="rv-list">' + (DS.signers || []).map(function (s) {
        var sp = String(s.specialties || "").split(",").filter(Boolean);
        return '<div class="rv-row"><span class="rv-t">' + esc(s.name) + '</span><span class="rv-s">Reg. No. ' + esc(s.reg_no) + ", " + esc(s.council) + "</span>" +
          '<span class="rv-s">' + esc(sp.length ? sp.map(specName).join(", ") : "All specialties") + '</span><span class="kit-row">' +
          (s.active ? '<button type="button" class="kit-clear" data-bl-act="editsigner:' + esc(s.uid) + '">Edit</button><button type="button" class="kit-clear" data-bl-act="deact:' + esc(s.uid) + '">Remove</button>'
            : '<span class="rv-pill">Removed</span>') + "</span></div>";
      }).join("") + "</div>" +
      '<h3 class="dl-h">Add a signer</h3><div class="kit-row">' + (me.self ? '<button type="button" class="kit-pill" data-bl-act="addme">' + ms("person_add") + "Add me</button>" : "") + "</div>" +
      field("bl_lemail", "Or find a verified doctor by email", '<input id="bl_lemail" type="email" class="kit-inp" autocomplete="off">', true) +
      '<div class="kit-row"><button type="button" class="kit-pill" data-bl-act="lookup">Find</button></div>' +
      (L ? '<div class="kit-grid">' + (L.verified === false ? '<p class="kit-muted" role="alert">This account is not a verified doctor, so it cannot be added.</p>' : "") +
        field("bl_sname", "Name as on the register", txt("bl_sname", L.name, 120), true) + field("bl_sreg", "Registration number", txt("bl_sreg", L.reg_no, 40)) +
        field("bl_scouncil", "Council", txt("bl_scouncil", L.council, 120)) + "</div>" + specChips(L.specialties || []) +
        '<div class="kit-row"><button type="button" class="kit-add" data-bl-act="saveSigner">Save signer</button></div>' : "");
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
    // specialties, checks, numbers
    "#smdReview .bl-spec{margin:0;color:var(--on-surface-variant);font:500 13px/1.45 var(--q-sans)}#smdReview .bl-spec .kit-link{min-height:44px;padding:4px 6px;font-size:13px}",
    "#smdReview .bl-checks ul{margin:4px 0 6px;padding-left:18px;font-weight:500}#smdReview .bl-checks .bl-hint{color:inherit;opacity:.85}",
    "#smdReview .bl-left.chk,#smdReview .bl-left.chk .kit-ic{color:var(--bl-amber)}",
    "#smdReview .bl-num-kv dd{display:flex;flex-direction:column;gap:2px;font-variant-numeric:tabular-nums}#smdReview .bl-num-kv .bl-hint{font-weight:500}",
    "#smdReview .bl-tbl{overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--outline-variant);border-radius:12px;background:var(--sc-lowest)}",
    "#smdReview .bl-tbl .kit-table{width:100%;border-collapse:collapse;font:500 13px/1.4 var(--q-sans)}#smdReview .bl-tbl th,#smdReview .bl-tbl td{padding:8px 10px}",
    "#smdReview .bl-tbl .n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}#smdReview .bl-tbl tr:last-child td{border-bottom:0}",
    "#smdReview .rv-row .kit-row{gap:8px}",
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
    if (DS.view === "second" && DS.sec) return secondView();
    if (DS.view === "numbers") return numbersView();
    if (DS.view === "second-reader") return secondReaderView();
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
      DS.cur = fromItem(it); DS.cur._src = src; DS.cur._cdsco = c._cdsco; DS.cur._cq = c._cq; DS.cur._cdscoAuto = c._cdscoAuto;
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
    var shown = checksFor(DS.saved).map(function (w) { return w[0]; });
    api("POST", "/" + encodeURIComponent(DS.saved.id) + "/sign", { body_hash: DS.saved.body_hash, checklist: cl, warnings: shown }).then(function (r) {
      DS.busy = false;
      if (r.status !== 200) {
        say(errText(r));
        if (r.status === 409) { DS.view = "edit"; DS.queue = null; }
        rerender(); if (r.status === 409) scrollTop(); return;
      }
      var needs2 = r.data.item && r.data.item.state === "awaiting_second";
      var done = needs2 ? "Signed. It shows once a second doctor confirms it." : "Signed. It shows on the disease page after the next sync.";
      toast(done);
      DS.view = "list"; DS.cur = null; DS.saved = null; DS.queue = null; say(done, "ok");
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
    if (cmd === "back") { DS.view = "list"; DS.cur = null; DS.sec = null; DS.sendingBack = false; DS.metrics = null; say(""); DS.look = null; DS.queue = null; DS.undo = null; rerender(); scrollTop(); return; }
    if (cmd === "allspec") { DS.allSpec = arg === "1"; rerender(); return; }
    if (cmd === "checks") { var ce = D.getElementById("bl_checks"); if (ce) { try { ce.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (x) { ce.scrollIntoView(); } } return; }
    if (cmd === "second") {
      var sit = ((DS.queue && DS.queue.items) || []).filter(function (x) { return x.id === arg; })[0];
      if (sit) { DS.sec = fromSigned(sit); DS.ck = {}; DS.sendingBack = false; DS.view = "second"; say(""); autoCdsco(DS.sec); rerender(); scrollTop(); }
      return;
    }
    if (cmd === "cosigngo" && DS.sec) {
      var cl2 = {}, gap = false;
      CHECKS.forEach(function (c) { var el = D.getElementById("bl_ck_" + c[0]); cl2[c[0]] = !!(el && el.checked); if (!cl2[c[0]]) gap = true; });
      if (gap) { say("Tick every item before confirming."); rerender(); return; }
      DS.busy = true; say(""); rerender();
      api("POST", "/" + encodeURIComponent(DS.sec.id) + "/cosign", { body_hash: DS.sec.body_hash, checklist: cl2 }).then(function (r) {
        DS.busy = false;
        if (r.status !== 200) { say(errText(r)); rerender(); return; }
        var ok2 = "Confirmed. It shows on the disease page after the next sync.";
        toast(ok2); DS.view = "list"; DS.sec = null; DS.queue = null; say(ok2, "ok");
        try { B().sync(true); } catch (e) {}
        rerender(); scrollTop(); probe().then(rerender);
      });
      return;
    }
    if (cmd === "sendback") { DS.sendingBack = true; rerender(); var rn = D.getElementById("bl_rnote"); if (rn) try { rn.focus(); } catch (x) {} return; }
    if (cmd === "sendbackgo" && DS.sec) {
      var note = val("bl_rnote").trim();
      if (note.length < 10) { say("Write what needs fixing (10 to 500 characters)."); rerender(); return; }
      var who = drName(DS.sec._signedName);
      api("POST", "/" + encodeURIComponent(DS.sec.id) + "/return", { note: note }).then(function (r) {
        if (r.status !== 200) { say(errText(r)); rerender(); return; }
        DS.view = "list"; DS.sec = null; DS.queue = null; say("Sent back to " + who + " with your note.", "ok");
        rerender(); scrollTop(); probe().then(rerender);
      });
      return;
    }
    if (cmd === "numbers") { DS.view = "numbers"; DS.metrics = null; say(""); rerender(); scrollTop(); return; }
    if (cmd === "mwin") { DS.mWin = Number(arg) || 90; DS.metrics = null; rerender(); return; }
    if (cmd === "second-reader") { DS.view = "second-reader"; DS.metrics = null; say(""); rerender(); scrollTop(); return; }
    if (cmd === "srgo") {
      var sr = val("bl_sreason").trim(), turnOn = DS.me && DS.me.secondReader === false;
      if (sr.length < 10) { say("Give a reason of at least 10 characters."); rerender(); return; }
      api("POST", "/second-reader", { on: turnOn, reason: sr }).then(function (r) {
        if (r.status !== 200) { say(errText(r)); rerender(); return; }
        DS.view = "list"; DS.queue = null; say(turnOn ? "Second reader switched on." : "Second reader switched off.", "ok");
        probe().then(rerender);
      });
      return;
    }
    if (cmd === "editsigner") {
      var sg = (DS.signers || []).filter(function (x) { return x.uid === arg; })[0];
      if (sg) { DS.look = { uid: sg.uid, name: sg.name, reg_no: sg.reg_no, council: sg.council, verified: true, specialties: String(sg.specialties || "").split(",").filter(Boolean) }; say(""); rerender(); }
      return;
    }
    if (cmd === "spec" && DS.look) {
      if (D.getElementById("bl_sname")) { DS.look.name = val("bl_sname"); DS.look.reg_no = val("bl_sreg"); DS.look.council = val("bl_scouncil"); }
      var sp = DS.look.specialties || (DS.look.specialties = []), at = sp.indexOf(arg);
      if (at >= 0) sp.splice(at, 1); else sp.push(arg);
      rerender(); return;
    }
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
      if (["kind", "india_status", "evidence_type", "regulator", "review_months"].indexOf(k) >= 0) { DS.cur[k] = k === "review_months" ? (Number(v) || 12) : v; autoCdsco(DS.cur); rerender(); }
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
    if (cmd === "addme") { var sf = DS.me.self || {}; DS.look = { uid: sf.uid, name: sf.name || "", reg_no: sf.reg_no || "", council: sf.council || "", verified: true, specialties: [] }; rerender(); return; }
    if (cmd === "lookup") {
      var em = val("bl_lemail").trim();
      if (!em) return;
      api("GET", "/signers/lookup?email=" + encodeURIComponent(em)).then(function (r) {
        if (r.status !== 200) { say(r.data.error === "no-account" ? "No StewardMD account has that email." : errText(r)); DS.look = null; rerender(); return; }
        var p = r.data.prefill || {};
        DS.look = { uid: r.data.uid, name: p.name || "", reg_no: p.reg_no || "", council: p.council || "", verified: r.data.verified, specialties: [] };
        say(""); rerender();
      });
      return;
    }
    if (cmd === "saveSigner" && DS.look) {
      api("POST", "/signers", { uid: DS.look.uid, name: val("bl_sname"), reg_no: val("bl_sreg"), council: val("bl_scouncil"), specialties: DS.look.specialties || [] }).then(function (r) {
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
    var n = ticked(), all = n === CHECKS.length, btn = D.querySelector("#smdReview .bl-signbtn"), st = D.getElementById("bl_ck_s");
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
    _numbersIn: numbersIn, _suggestDiseases: suggestDiseases, _firstSentences: firstSentences, _linkFields: linkFields, _toHttps: toHttps, _missing: missing,
    _checksFor: checksFor, _isIndexLink: isIndexLink, _overlap: overlap, _numbersNotIn: numbersNotIn };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  G.SMD_BULLETINS_DESK = API;
})(typeof window !== "undefined" ? window : globalThis);
