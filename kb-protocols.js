/* StewardMD - Knowledge Library "Protocols" tab: bedside clinical protocols across specialties.
 *
 * Content is data: kb/clinical-protocols/<id>.json, catalogued by kb/clinical-protocols/index.json
 * (built + validated by scripts/build-clinical-protocols.mjs). The catalogue loads when the tab opens;
 * each protocol body loads when opened. Both are fetched with ?v=CONTENT_V because sw.js caches static
 * files by full URL; the build script keeps CONTENT_V in step with the index hash.
 *
 * How it joins the Knowledge Library (app.js SB.openRef renders the four original tabs):
 *   - SB.openRef is wrapped: "protocols" renders here; every other tab passes through untouched.
 *   - A MutationObserver on #sbrefBody adds a fifth "Protocols" button to whatever tab row app.js
 *     just rendered (openRef, SB.abgOrg re-renders), so the tab is reachable from every tab.
 * Flag: smd_kb_protocols (kb-protocols-flags.js, default ON, ?kbproto=0 to hide).
 * Every protocol shows its review status. Decision support only; nothing here is an order.
 * window.SMD_KBPROTO. Buildless ES5 IIFE.
 */
(function (root) {
  "use strict";
  var G = root, D = root.document;
  var CONTENT_V = "96bb483f2038";
  var BASE = "/kb/clinical-protocols/";

  var KINDS = {
    recognise: "Recognise", immediate: "Act now", investigations: "Investigate", treatment: "Treat",
    monitoring: "Monitor", escalate: "Escalate", disposition: "Disposition", special: "Special situations",
    prevention: "Prevent", pitfalls: "Pitfalls"
  };
  var TABS = [["syndromes", "Syndromes"], ["antibiogram", "Antibiogram"], ["aware", "AWaRe"], ["guidelines", "Guidelines"], ["protocols", "Protocols"]];

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function plural(n, w) { return n + " " + w + (n === 1 ? "" : "s"); }
  function norm(s) { return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
  function flagOn() { try { return !G.SMD_KBPROTO_FLAGS || G.SMD_KBPROTO_FLAGS.on(); } catch (e) { return true; } }
  function ico(n) { try { return (G.ICONS && G.ICONS.get) ? G.ICONS.get(n) : ""; } catch (e) { return ""; } }

  /* ---- search (pure; unit-tested) ---------------------------------------------------------------
   * Every query token must match somewhere (title, aliases, summary, subject label). Ranking: title
   * starts with the query > title or alias contains the phrase > all tokens in title/aliases > body.
   * Short tokens (3 chars or fewer, e.g. "dka", "pe", "tb") match whole words only, so "pe" does not
   * hit "peptic". */
  function hasTok(text, tok) {
    if (tok.length > 3) return text.indexOf(tok) >= 0;
    return (" " + text + " ").indexOf(" " + tok + " ") >= 0;
  }
  function rank(entry, q, subjectLabel) {
    var nq = norm(q); if (!nq) return 0;
    var toks = nq.split(" ");
    var title = norm(entry.title), aliases = norm((entry.aliases || []).join(" | "));
    var head = title + " " + aliases;
    var all = head + " " + norm(entry.summary) + " " + norm(subjectLabel || "") + " " + norm(entry.population);
    for (var i = 0; i < toks.length; i++) if (!hasTok(all, toks[i])) return -1;
    if (title.indexOf(nq) === 0) return 100;
    if ((nq.length > 3 && title.indexOf(nq) >= 0) || hasTok(title, nq)) return 85;
    var al = entry.aliases || [];
    for (var j = 0; j < al.length; j++) { if (norm(al[j]) === nq) return 90; }
    if ((nq.length > 3 && aliases.indexOf(nq) >= 0) || hasTok(aliases, nq)) return 75;
    if (toks.every(function (t) { return hasTok(head, t); })) return 60;
    return 20;
  }
  /** Filter + rank the catalogue. subject "all" or a subject key. Returns index entries. */
  function searchIndex(index, q, subject) {
    if (!index || !index.protocols) return [];
    var labels = {}; (index.subjects || []).forEach(function (s) { labels[s.key] = s.label; });
    var out = [];
    index.protocols.forEach(function (p, i) {
      if (subject && subject !== "all" && p.subject !== subject) return;
      var s = rank(p, q, labels[p.subject]);
      if (s < 0) return;
      out.push({ p: p, s: s, i: i });
    });
    out.sort(function (a, b) { return (b.s - a.s) || (a.i - b.i); });
    return out.map(function (x) { return x.p; });
  }

  /* ---- state + data ---------------------------------------------------------------------------- */
  var st = { index: null, loading: false, error: "", q: "", subject: "all", view: "list", openId: null, cache: {}, listScroll: 0, pending: null, nav: 0 };

  function getJSON(path) {
    return fetch(BASE + path + "?v=" + encodeURIComponent(CONTENT_V)).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }
  function loadIndex() {
    if (st.index) return Promise.resolve(st.index);
    if (st.pending) return st.pending;
    st.loading = true; st.error = "";
    st.pending = getJSON("index.json").then(function (idx) {
      st.index = idx; st.loading = false; st.pending = null; return idx;
    }).catch(function (e) {
      st.loading = false; st.pending = null; st.error = "The protocol library could not be loaded. Check your connection and try again.";
      throw e;
    });
    return st.pending;
  }
  function loadProtocol(id) {
    if (st.cache[id]) return Promise.resolve(st.cache[id]);
    return getJSON(encodeURIComponent(id) + ".json").then(function (p) { st.cache[id] = p; return p; });
  }
  function subjectLabel(key) {
    var s = ((st.index && st.index.subjects) || []).filter(function (x) { return x.key === key; })[0];
    return s ? s.label : key;
  }

  /* ---- render ---------------------------------------------------------------------------------- */
  function bodyEl() { return D.getElementById("sbrefBody"); }
  function tabsHTML() {
    return '<div class="sbref-tabs kbp-5">' + TABS.map(function (t) {
      var on = t[0] === "protocols";
      return '<button type="button" class="sbref-tab' + (on ? " active" : "") + '"' + (on ? ' aria-current="page" data-kbp-tab' : ' data-kbp-go="' + t[0] + '"') + ">" + esc(t[1]) + "</button>";
    }).join("") + "</div>";
  }
  function brandHTML() {
    return '<img class="smd-kb-watermark" src="/android-chrome-192x192.png" alt="" aria-hidden="true"><div class="smd-kb-brand"><strong>StewardMD</strong><span>Knowledge Base</span></div>';
  }
  function shell(inner) {
    var body = bodyEl(); if (!body) return;
    body.className = "sbref-body kblib-tool-page kblib-tool-protocols";
    body.innerHTML = tabsHTML() + inner;
    var title = D.getElementById("sbrefTitle"); if (title) title.textContent = "Knowledge Library";
  }

  function renderList() {
    st.view = "list"; st.openId = null;
    var idx = st.index;
    var total = idx ? idx.count : 0, nSubj = idx ? idx.subjects.length : 0;
    var drafts = idx ? idx.protocols.filter(function (p) { return p.status === "ai_drafted"; }).length : 0;
    var intro = '<header class="kblib-tool-intro">' + brandHTML() +
      '<span class="kblib-tool-kicker">Bedside clinical protocols</span><h1>Protocols</h1>' +
      "<p>" + (idx ? "<strong>" + plural(total, "protocol") + "</strong> across " + plural(nSubj, "subject") + ", " : "Stepwise protocols ") +
      "compiled from current national and international guidelines. Each protocol cites its sources.</p>" +
      '<label for="kbpQ">Search protocols</label><input id="kbpQ" class="kblib-tool-search" type="search" autocomplete="off" placeholder="Condition, drug or abbreviation" value="' + esc(st.q) + '">' +
      '<div id="kbpCount" class="kblib-tool-count" role="status"></div></header>';
    if (!idx) {
      shell(intro + (st.error
        ? '<div class="kbp-empty" role="alert"><p>' + esc(st.error) + '</p><button type="button" class="kbp-btn" data-kbp-retry>Try again</button></div>'
        : '<div class="kbp-empty" aria-busy="true">Loading protocols…</div>'));
      return;
    }
    var notice = drafts
      ? '<div class="kbp-status kbp-status-ai_drafted" role="note"><strong>' + (drafts === total ? "All protocols are drafts" : drafts + " of " + total + " protocols are drafts") +
        " pending clinical review.</strong> They were compiled with AI assistance from the guidelines each one cites. Verify doses and thresholds against the source and your local protocol before use.</div>"
      : "";
    var chip = function (key, label, count) {
      var on = st.subject === key;
      return '<button type="button" class="kbp-chip' + (on ? " on" : "") + '" aria-pressed="' + on + '" data-kbp-subject="' + esc(key) + '">' + esc(label) + (count != null ? " <small>" + count + "</small>" : "") + "</button>";
    };
    var chips = '<div class="kbp-subjects" role="group" aria-label="Filter by subject">' + chip("all", "All", total) +
      idx.subjects.map(function (s) { return chip(s.key, s.label, s.count); }).join("") + "</div>";
    shell(intro + notice + chips + '<div id="kbpList" class="kbp-list"></div>');
    paintList();
  }

  function rowHTML(p) {
    var src = (p.sources || []).slice(0, 2).join(" · ") + ((p.sources || []).length > 2 ? " · +" + (p.sources.length - 2) : "");
    return '<button type="button" class="kbp-row" data-kbp-open="' + esc(p.id) + '">' +
      '<span class="kbp-row-eye">' + esc(subjectLabel(p.subject)) + " · " + esc(p.population) + "</span>" +
      '<span class="kbp-row-title">' + esc(p.title) + "</span>" +
      '<span class="kbp-row-sum">' + esc(p.summary) + "</span>" +
      (src ? '<span class="kbp-row-src">' + esc(src) + "</span>" : "") + "</button>";
  }
  function paintList() {
    var list = D.getElementById("kbpList"); if (!list || !st.index) return;
    var res = searchIndex(st.index, st.q, st.subject);
    var cnt = D.getElementById("kbpCount");
    if (cnt) cnt.textContent = res.length ? (st.q || st.subject !== "all" ? "Showing " + res.length + " of " + plural(st.index.count, "protocol") : plural(st.index.count, "protocol")) : "";
    if (!res.length) { list.innerHTML = '<div class="kbp-empty">No protocol matches. Try a broader term or another subject.</div>'; return; }
    if (st.q || st.subject !== "all") { list.innerHTML = '<div class="kbp-group">' + res.map(rowHTML).join("") + "</div>"; return; }
    // Browsing everything: group under subject headings, in the catalogue's subject order.
    list.innerHTML = st.index.subjects.map(function (s) {
      var rows = res.filter(function (p) { return p.subject === s.key; });
      if (!rows.length) return "";
      return '<section class="kbp-group" aria-label="' + esc(s.label) + '"><h2 class="kbp-group-h">' + esc(s.label) + " <small>" + rows.length + "</small></h2>" + rows.map(rowHTML).join("") + "</section>";
    }).join("");
  }

  function fmtDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ""); if (!m) return "";
    var mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+m[2] - 1];
    return (+m[3]) + " " + mon + " " + m[1];
  }
  function statusHTML(p) {
    var r = p.review || {}, date = fmtDate(r.compiled);
    if (r.status === "approved") return '<div class="kbp-status kbp-status-approved" role="note"><strong>Approved</strong>' + (r.reviewer ? " by " + esc(r.reviewer) : "") + ". Still verify against the cited source and your local protocol.</div>";
    if (r.status === "reviewed") return '<div class="kbp-status kbp-status-reviewed" role="note"><strong>Clinically reviewed</strong>' + (r.reviewer ? " by " + esc(r.reviewer) : "") + ". Verify against the cited source and your local protocol.</div>";
    return '<div class="kbp-status kbp-status-ai_drafted" role="note"><strong>Draft, pending clinical review.</strong> Compiled' + (date ? " " + date : "") +
      " with AI assistance from the guidelines cited below. Verify every dose and threshold against the source and your local protocol before use.</div>";
  }
  /** The protocol reader as an HTML string. Shared by the Knowledge Library and the OPD Protocol tab.
   *  opts.idPrefix  prefix for section ids (jump targets), so two readers in one DOM never collide
   *  opts.back      render the "All protocols" Back control (the Knowledge Library owns it)
   *  opts.brand     render the StewardMD Knowledge Base banner (its styles live under #sbrefOverlay) */
  function readerHTML(p, opts) {
    opts = opts || {};
    var pre = opts.idPrefix || "kbp";
    var meta = [p.population, p.setting].filter(Boolean).map(function (m) { return '<span class="kbp-meta">' + esc(m) + "</span>"; }).join("");
    var secs = (p.sections || []).map(function (s, i) {
      var tag = s.kind === "immediate" ? "ol" : "ul";
      return '<section class="kbp-sec kbp-k-' + esc(s.kind) + '" id="' + pre + "Sec" + i + '"><h2><span class="kbp-kind">' + esc(KINDS[s.kind] || s.kind) + "</span>" + esc(s.title) + "</h2><" + tag + ">" +
        (s.items || []).map(function (it) { return "<li>" + esc(it) + "</li>"; }).join("") + "</" + tag + "></section>";
    }).join("");
    var toc = (p.sections || []).map(function (s, i) { return '<button type="button" class="kbp-jump" data-kbp-jump="' + pre + "Sec" + i + '">' + esc(s.title) + "</button>"; });
    var drugs = (p.drugs && p.drugs.length)
      ? '<section class="kbp-sec kbp-drugs" id="' + pre + 'Drugs"><h2><span class="kbp-kind">Drugs</span>Key drugs and doses</h2><dl>' + p.drugs.map(function (d) {
          return '<div class="kbp-drug"><dt>' + esc(d.name) + '</dt><dd class="kbp-dose">' + esc(d.dose) + "</dd>" + (d.notes ? '<dd class="kbp-note">' + esc(d.notes) + "</dd>" : "") + "</div>";
        }).join("") + "</dl></section>"
      : "";
    if (drugs) toc.push('<button type="button" class="kbp-jump" data-kbp-jump="' + pre + 'Drugs">Drugs</button>');
    toc.push('<button type="button" class="kbp-jump" data-kbp-jump="' + pre + 'Sources">Sources</button>');
    var sources = '<section class="kbp-sec kbp-sources" id="' + pre + 'Sources"><h2><span class="kbp-kind">Evidence</span>Sources</h2><ol>' + (p.sources || []).map(function (s) {
      return '<li><a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title) + '</a><span>' + esc(s.org) + " · " + esc(s.year) + "</span></li>";
    }).join("") + '</ol><p class="kbp-foot">Links open the official source. Always consult the current published version. Decision support only: not a substitute for clinical judgement.</p></section>';
    return '<div class="kbp-reader">' +
      (opts.back ? '<button type="button" class="kbp-back" data-kbp-back aria-label="Back to protocols"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg><span>All protocols</span></button>' : "") +
      '<header class="kblib-tool-intro kbp-hero">' + (opts.brand ? brandHTML() : "") + '<span class="kblib-tool-kicker">' + esc(subjectLabel(p.subject)) + "</span><h1>" + esc(p.title) + "</h1>" +
      (meta ? '<div class="kbp-metas">' + meta + "</div>" : "") + '<p class="kbp-summary">' + esc(p.summary) + "</p></header>" +
      statusHTML(p) + '<nav class="kbp-toc" aria-label="Jump to section">' + toc.join("") + "</nav>" + secs + drugs + sources + "</div>";
  }
  function renderReader(p) {
    st.view = "reader"; st.openId = p.id;
    shell(readerHTML(p, { idPrefix: "kbp", back: true, brand: true }));
    var body = bodyEl(); if (body) body.scrollTop = 0;
  }
  // Every navigation bumps st.nav, so a protocol that finishes loading after the user moved on
  // (back, another tab, closed the sheet) is dropped instead of painting over what they chose.
  function onProtocolsPage() { var b = bodyEl(); return !!(b && overlayOpen() && b.classList.contains("kblib-tool-protocols")); }
  function openProtocol(id) {
    var body = bodyEl(), nav = ++st.nav;
    if (st.view === "list" && body) st.listScroll = body.scrollTop;
    loadProtocol(id).then(function (p) { if (nav === st.nav && onProtocolsPage()) renderReader(p); }).catch(function () {
      try { if (G.toast) G.toast("This protocol could not be loaded. Check your connection."); } catch (e) {}
    });
  }
  function backToList() {
    st.nav++;
    renderList();
    var body = bodyEl(); if (body) body.scrollTop = st.listScroll || 0;
  }

  /* ---- open / close ---------------------------------------------------------------------------- */
  function overlayOpen() { var o = D.getElementById("sbrefOverlay"); return !!(o && o.classList.contains("open")); }
  // Mirrors app.js SB.openRef: close the drawer, render, show the overlay, lock page scroll.
  function showOverlay() {
    try { if (G.SB && G.SB.close) G.SB.close(); } catch (e) {}
    var o = D.getElementById("sbrefOverlay"); if (!o) return false;
    o.classList.add("open"); o.scrollTop = 0; D.body.style.overflow = "hidden";
    return true;
  }
  /** Open the Protocols tab. opts.id opens that protocol's reader directly. */
  function open(opts) {
    if (!showOverlay()) return;
    var id = opts && opts.id, nav = ++st.nav;
    st.view = "list";
    renderList();
    var body = bodyEl(); if (body) body.scrollTop = 0;
    loadIndex().then(function () {
      if (nav !== st.nav || !onProtocolsPage()) return;
      if (id) openProtocol(id); else { renderList(); var b = bodyEl(); if (b) b.scrollTop = 0; }
    }).catch(function () { if (nav === st.nav && onProtocolsPage()) renderList(); });
  }

  /* ---- wiring ---------------------------------------------------------------------------------- */
  function ensureTab() {
    if (!flagOn()) return;
    var body = bodyEl(); if (!body) return;
    var tabs = body.querySelector(".sbref-tabs");
    if (!tabs || tabs.querySelector("[data-kbp-tab]")) return;
    var b = D.createElement("button");
    b.type = "button"; b.className = "sbref-tab"; b.setAttribute("data-kbp-tab", "");
    b.innerHTML = ico("list") + " Protocols";
    tabs.appendChild(b); tabs.classList.add("kbp-5");
  }
  function wrapOpenRef() {
    var SB = G.SB;
    if (!SB || typeof SB.openRef !== "function" || SB.__smdKbProtoWrapped) return !!(SB && SB.__smdKbProtoWrapped);
    var orig = SB.openRef;
    SB.__smdKbProtoWrapped = true;
    SB.openRef = function (tab) {
      if (tab === "protocols" && flagOn()) { open(); return; }
      st.nav++;
      var r = orig.apply(this, arguments);
      try { ensureTab(); } catch (e) {}
      return r;
    };
    return true;
  }
  function wire() {
    var body = bodyEl();
    if (body && G.MutationObserver && !body.__kbpObserved) {
      body.__kbpObserved = true;
      new G.MutationObserver(function () { try { ensureTab(); } catch (e) {} }).observe(body, { childList: true });
    }
    D.addEventListener("click", function (e) {
      var t = e.target; if (!t || !t.closest) return;
      // Section jumps work wherever a reader is embedded (Knowledge Library, OPD Protocol tab).
      var jump = t.closest("[data-kbp-jump]");
      if (jump) { var sec = D.getElementById(jump.getAttribute("data-kbp-jump")); if (sec && sec.scrollIntoView) sec.scrollIntoView({ block: "start", behavior: "smooth" }); return; }
      if (!t.closest("#sbrefBody")) return;
      if (t.closest("[data-kbp-tab]")) { e.preventDefault(); if (G.SB && G.SB.openRef) G.SB.openRef("protocols"); else open(); return; }
      var go = t.closest("[data-kbp-go]"); if (go) { if (G.SB && G.SB.openRef) G.SB.openRef(go.getAttribute("data-kbp-go")); return; }
      var row = t.closest("[data-kbp-open]"); if (row) { openProtocol(row.getAttribute("data-kbp-open")); return; }
      if (t.closest("[data-kbp-back]")) { backToList(); return; }
      if (t.closest("[data-kbp-retry]")) { open(); return; }
      var chip = t.closest("[data-kbp-subject]");
      if (chip) {
        st.subject = chip.getAttribute("data-kbp-subject");
        Array.prototype.forEach.call(D.querySelectorAll("[data-kbp-subject]"), function (c) { var on = c === chip; c.classList.toggle("on", on); c.setAttribute("aria-pressed", String(on)); });
        paintList(); return;
      }
    }, false);
    D.addEventListener("input", function (e) {
      if (e.target && e.target.id === "kbpQ") { st.q = String(e.target.value || "").trim(); paintList(); }
    }, false);
  }
  function install() {
    wire();
    if (wrapOpenRef()) return;
    var n = 0, iv = setInterval(function () { if (wrapOpenRef() || ++n > 120) clearInterval(iv); }, 250);
  }

  var API = { open: open, search: function (q, subject) { return searchIndex(st.index, q, subject || "all"); }, loadIndex: loadIndex, loadProtocol: loadProtocol, readerHTML: readerHTML, subjectLabel: subjectLabel, index: function () { return st.index; }, CONTENT_V: CONTENT_V, _searchIndex: searchIndex, _rank: rank, _kinds: KINDS, _state: st };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  G.SMD_KBPROTO = API;
  if (D && D.addEventListener) {
    if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", install); else install();
  }
})(typeof window !== "undefined" ? window : globalThis);
