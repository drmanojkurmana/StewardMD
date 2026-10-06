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
 * Every protocol shows its source caveat. Decision support only; nothing here is an order.
 * window.SMD_KBPROTO. Buildless ES5 IIFE.
 */
(function (root) {
  "use strict";
  var G = root, D = root.document;
  var CONTENT_V = "4fb9dffa7c44";
  var BASE = "/kb/clinical-protocols/";

  var KINDS = {
    recognise: "Recognise", immediate: "Act now", investigations: "Investigate", treatment: "Treat",
    monitoring: "Monitor", escalate: "Escalate", disposition: "Disposition", special: "Special situations",
    prevention: "Prevent", pitfalls: "Pitfalls"
  };
  // Guideline basis: which family of guidance a protocol follows (schema field "basis").
  var BASIS = { international: "International", india: "India" };
  var BASIS_LONG = { international: "International guidelines", india: "India national guidelines" };
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
    // Body text also carries the guideline family and the cited bodies, so "malaria WHO",
    // "dengue india" or "hypertension ESC" narrow to the right version.
    var all = head + " " + norm(entry.summary) + " " + norm(subjectLabel || "") + " " + norm(entry.population) + " " +
      norm(BASIS_LONG[entry.basis] || "") + " " + norm((entry.sources || []).join(" "));
    for (var i = 0; i < toks.length; i++) if (!hasTok(all, toks[i])) return -1;
    if (title.indexOf(nq) === 0) return 100;
    if ((nq.length > 3 && title.indexOf(nq) >= 0) || hasTok(title, nq)) return 85;
    var al = entry.aliases || [];
    for (var j = 0; j < al.length; j++) { if (norm(al[j]) === nq) return 90; }
    if ((nq.length > 3 && aliases.indexOf(nq) >= 0) || hasTok(aliases, nq)) return 75;
    if (toks.every(function (t) { return hasTok(head, t); })) return 60;
    return 20;
  }
  /** Filter + rank the catalogue. subject: "all" or a subject key; basis: "all", "international" or
   *  "india" (the guideline family a protocol follows). Returns index entries. */
  function searchIndex(index, q, subject, basis) {
    if (!index || !index.protocols) return [];
    var labels = {}; (index.subjects || []).forEach(function (s) { labels[s.key] = s.label; });
    var out = [];
    index.protocols.forEach(function (p, i) {
      if (subject && subject !== "all" && p.subject !== subject) return;
      if (basis && basis !== "all" && p.basis !== basis) return;
      var s = rank(p, q, labels[p.subject]);
      if (s < 0) return;
      out.push({ p: p, s: s, i: i });
    });
    out.sort(function (a, b) { return (b.s - a.s) || (a.i - b.i); });
    return out.map(function (x) { return x.p; });
  }

  /* ---- state + data ---------------------------------------------------------------------------- */
  var st = { index: null, loading: false, error: "", q: "", subject: "all", basis: "all", view: "list", openId: null, cache: {}, listScroll: 0, pending: null, nav: 0 };

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
  // the Knowledge Library banner (logo + name) from reasoning.js, with the same markup as a fallback
  function brandHTML() {
    if (typeof G.SMD_KB_BANNER === "function") return G.SMD_KB_BANNER();
    return '<div class="smd-kb-banner"><img class="smd-kb-logo" src="/logo.png" alt="" width="34" height="34"><div class="smd-kb-brand"><strong>StewardMD</strong><span>Knowledge Base</span></div></div>';
  }
  function shell(inner) {
    var body = bodyEl(); if (!body) return;
    body.className = "sbref-body kblib-tool-page kblib-tool-protocols";
    body.innerHTML = tabsHTML() + inner;
    var title = D.getElementById("sbrefTitle"); if (title) title.textContent = "Knowledge Library";
    fitTabs(body.querySelector(".sbref-tabs"));
  }
  // The five tabs scroll sideways on phones: keep the active one in view and flip the edge fade at the end.
  function fitTabs(tabs) {
    if (!tabs || tabs.__kbpFit) { if (tabs) centreActive(tabs); return; }
    tabs.__kbpFit = true;
    tabs.addEventListener("scroll", function () { edgeState(tabs); }, { passive: true });
    centreActive(tabs);
  }
  // the edge fade only exists while the row actually scrolls (all five fit from 375px up)
  function edgeState(tabs) {
    var sc = tabs.scrollWidth > tabs.clientWidth + 1;
    tabs.classList.toggle("can-scroll", sc);
    tabs.classList.toggle("at-end", sc && tabs.scrollLeft + tabs.clientWidth >= tabs.scrollWidth - 2);
  }
  function centreActive(tabs) {
    var act = tabs.querySelector(".sbref-tab.active");
    if (act && tabs.scrollWidth > tabs.clientWidth + 1) {
      var x = act.getBoundingClientRect().left - tabs.getBoundingClientRect().left + tabs.scrollLeft;
      tabs.scrollLeft = Math.max(0, x - (tabs.clientWidth - act.offsetWidth) / 2);
    }
    edgeState(tabs);
  }

  function renderList() {
    st.view = "list"; st.openId = null;
    var idx = st.index;
    var total = idx ? idx.count : 0, nSubj = idx ? idx.subjects.length : 0;
    var intro = '<header class="kblib-tool-intro">' + brandHTML() +
      '<h1>Protocols</h1>' +
      "<p>" + (idx ? "<strong>" + plural(total, "protocol") + "</strong> across " + plural(nSubj, "subject") + ", " : "Stepwise protocols ") +
      "compiled from current national and international guidelines. Each protocol cites its sources.</p>" +
      '<label for="kbpQ">Search protocols</label><div class="kblib-searchbox"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>' +
      '<input id="kbpQ" class="kblib-tool-search" type="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Condition, drug or abbreviation" value="' + esc(st.q) + '"></div>' +
      '<div id="kbpCount" class="kblib-tool-count" role="status"></div></header>';
    if (!idx) {
      shell(intro + (st.error
        ? '<div class="kbp-empty" role="alert"><p>' + esc(st.error) + '</p><button type="button" class="kbp-btn" data-kbp-retry>Try again</button></div>'
        : '<div class="kbp-empty" aria-busy="true">Loading protocols…</div>'));
      return;
    }
    var notice = total
      ? '<div class="kbp-status kbp-status-note" role="note">Each protocol cites the guidelines it follows. Verify doses and thresholds against the source and your local protocol before use.</div>'
      : "";
    var chip = function (key, label, count) {
      var on = st.subject === key;
      return '<button type="button" class="kbp-chip' + (on ? " on" : "") + '" aria-pressed="' + on + '" data-kbp-subject="' + esc(key) + '">' + esc(label) + (count != null ? " <small>" + count + "</small>" : "") + "</button>";
    };
    // Subject counts follow the International / India choice, so a chip never promises rows it hides.
    var inBasis = idx.protocols.filter(function (p) { return st.basis === "all" || p.basis === st.basis; });
    var per = {}; inBasis.forEach(function (p) { per[p.subject] = (per[p.subject] || 0) + 1; });
    var chips = '<div class="kbp-subjects" role="group" aria-label="Filter by subject">' + chip("all", "All", inBasis.length) +
      idx.subjects.filter(function (s) { return per[s.key] || st.subject === s.key; }).map(function (s) { return chip(s.key, s.label, per[s.key] || 0); }).join("") + "</div>";
    var seg = function (key, label, count) {
      var on = st.basis === key;
      return '<button type="button" class="kbp-seg' + (on ? " on" : "") + '" aria-pressed="' + on + '" data-kbp-basis="' + key + '">' + esc(label) + (count != null ? " <small>" + count + "</small>" : "") + "</button>";
    };
    var bases = idx.bases || [];
    var basisBar = bases.length ? '<div class="kbp-basis" role="group" aria-label="Guideline basis">' + seg("all", "All", total) +
      bases.map(function (b) { return seg(b.key, b.label, b.count); }).join("") + "</div>" : "";
    shell(intro + notice + basisBar + chips + '<div id="kbpList" class="kbp-list"></div>');
    paintList();
  }

  function rowHTML(p) {
    var src = (p.sources || []).slice(0, 2).join(" · ") + ((p.sources || []).length > 2 ? " · +" + (p.sources.length - 2) : "");
    return '<button type="button" class="kbp-row" data-kbp-open="' + esc(p.id) + '">' +
      '<span class="kbp-row-eye">' + esc(subjectLabel(p.subject)) + " · " + esc(p.population) +
      (BASIS[p.basis] ? ' <span class="kbp-basis-pill kbp-b-' + esc(p.basis) + '">' + esc(BASIS[p.basis]) + "</span>" : "") + "</span>" +
      '<span class="kbp-row-title">' + esc(p.title) + "</span>" +
      '<span class="kbp-row-sum">' + esc(p.summary) + "</span>" +
      (src ? '<span class="kbp-row-src">' + esc(src) + "</span>" : "") + "</button>";
  }
  function paintList() {
    var list = D.getElementById("kbpList"); if (!list || !st.index) return;
    var res = searchIndex(st.index, st.q, st.subject, st.basis);
    // while searching, the verify-sources note steps aside so matches sit above the on-screen keyboard
    list.parentNode.classList.toggle("kbp-searching", !!st.q);
    var cnt = D.getElementById("kbpCount");
    if (cnt) cnt.textContent = res.length ? (st.q || st.subject !== "all" || st.basis !== "all" ? "Showing " + res.length + " of " + plural(st.index.count, "protocol") : plural(st.index.count, "protocol")) : "";
    if (!res.length) { list.innerHTML = '<div class="kbp-empty">No protocol matches. Try a broader term or another subject.</div>'; return; }
    if (st.q || st.subject !== "all" || st.basis !== "all") { list.innerHTML = '<div class="kbp-group">' + res.map(rowHTML).join("") + "</div>"; return; }
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
    return '<div class="kbp-status kbp-status-note" role="note">' + (date ? "Compiled " + date + " from the guidelines cited below. " : "") +
      "Verify every dose and threshold against the source and your local protocol before use.</div>";
  }
  /** The protocol reader as an HTML string. Shared by the Knowledge Library and the OPD Protocol tab.
   *  opts.idPrefix  prefix for section ids (jump targets), so two readers in one DOM never collide
   *  opts.back      render the "All protocols" Back control (the Knowledge Library owns it)
   *  opts.brand     render the StewardMD Knowledge Base banner (its styles live under #sbrefOverlay)
   *  opts.openAttr  function(id) -> attribute string that opens another protocol in the host
   *                 (default data-kbp-open, handled by the Knowledge Library) */
  function readerHTML(p, opts) {
    opts = opts || {};
    var pre = opts.idPrefix || "kbp";
    var meta = (BASIS_LONG[p.basis] ? '<span class="kbp-meta kbp-b-' + esc(p.basis) + '">' + esc(BASIS_LONG[p.basis]) + "</span>" : "") +
      [p.population, p.setting].filter(Boolean).map(function (m) { return '<span class="kbp-meta">' + esc(m) + "</span>"; }).join("");
    // The same topic under the other guideline family (e.g. malaria: India NCVBDC and WHO).
    var twin = "";
    if (p.counterpart) {
      var other = ((st.index && st.index.protocols) || []).filter(function (x) { return x.id === p.counterpart; })[0];
      var attr = opts.openAttr ? opts.openAttr(p.counterpart) : 'data-kbp-open="' + esc(p.counterpart) + '"';
      var ob = other ? other.basis : (p.basis === "india" ? "international" : "india");
      twin = '<button type="button" class="kbp-twin" ' + attr + '><span>Also available · ' + esc(BASIS_LONG[ob] || "another guideline") + "</span><strong>" + esc(other ? other.title : "Open the other version") + "</strong></button>";
    }
    var secs = (p.sections || []).map(function (s, i) {
      var tag = s.kind === "immediate" ? "ol" : "ul";
      return '<section class="kbp-sec kbp-k-' + esc(s.kind) + '" id="' + pre + "Sec" + i + '"><h2><span class="kbp-kind">' + esc(KINDS[s.kind] || s.kind) + "</span>" + esc(s.title) + "</h2><" + tag + ">" +
        (s.items || []).map(function (it) { return "<li>" + (typeof G.SMD_MEDFORMAT === "function" ? G.SMD_MEDFORMAT(it) : esc(it)) + "</li>"; }).join("") + "</" + tag + "></section>";
    }).join("");
    var toc = (p.sections || []).map(function (s, i) { return '<button type="button" class="kbp-jump" data-kbp-jump="' + pre + "Sec" + i + '">' + esc(s.title) + "</button>"; });

    // Decision-tree flowchart: numbered step badges joined by inline SVG arrows (no dependencies,
    // so it renders in the Knowledge Library and in embedded readers alike).
    var flowArrow = '<svg class="kbp-flow-arrow" viewBox="0 0 16 20" width="16" height="20" aria-hidden="true"><line x1="8" y1="1" x2="8" y2="12" stroke="currentColor" stroke-width="2"/><path d="M3 10l5 6 5-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    var algos = (p.algorithms && p.algorithms.length)
      ? p.algorithms.map(function (a, i) {
          var steps = (a.steps || []).map(function (st, idx) {
            return '<div class="kbp-flow-node' + (st.critical ? " kbp-flow-crit" : "") + '">' +
              '<div class="kbp-flow-head"><span class="kbp-flow-idx">' + (idx + 1) + '</span><span class="kbp-flow-step">' + esc(st.step) + '</span>' +
              (st.branch ? '<span class="kbp-flow-branch">' + esc(st.branch) + '</span>' : '') + '</div>' +
              '<div class="kbp-flow-action">' + esc(st.action) + '</div>' +
              '</div>';
          }).join(flowArrow);
          return '<section class="kbp-sec kbp-sec-algo" id="' + pre + 'Algo' + i + '"><h2><span class="kbp-kind">Algorithm</span>' + esc(a.title) + '</h2>' +
            '<div class="kbp-flowchart">' + steps + '</div>' +
            (a.caption ? '<p class="kbp-caption">' + esc(a.caption) + '</p>' : '') + '</section>';
        }).join("")
      : "";
    if (p.algorithms && p.algorithms.length) {
      p.algorithms.forEach(function (a, i) { toc.push('<button type="button" class="kbp-jump" data-kbp-jump="' + pre + 'Algo' + i + '">' + esc(a.title) + '</button>'); });
    }

    var tables = (p.tables && p.tables.length)
      ? p.tables.map(function (t, i) {
          var ths = (t.headers || []).map(function (h) { return '<th>' + esc(h) + '</th>'; }).join("");
          var trs = (t.rows || []).map(function (r) {
            return '<tr>' + (r || []).map(function (cell) { return '<td>' + esc(cell) + '</td>'; }).join("") + '</tr>';
          }).join("");
          return '<section class="kbp-sec kbp-sec-tbl" id="' + pre + 'Tbl' + i + '"><h2><span class="kbp-kind">Matrix</span>' + esc(t.title) + '</h2>' +
            '<div class="kbp-table-wrap"><table class="kbp-tbl"><thead><tr>' + ths + '</tr></thead><tbody>' + trs + '</tbody></table></div>' +
            (t.caption ? '<p class="kbp-caption">' + esc(t.caption) + '</p>' : '') + '</section>';
        }).join("")
      : "";
    if (p.tables && p.tables.length) {
      p.tables.forEach(function (t, i) { toc.push('<button type="button" class="kbp-jump" data-kbp-jump="' + pre + 'Tbl' + i + '">' + esc(t.title) + '</button>'); });
    }

    // Clinical diagrams and diagnostic imaging: annotated figures (ECG, X-ray, CT schematic)
    // with structured callout badges for each annotation. Each card is a jump target.
    var DTYPE = { ecg: "ECG", xray: "X-ray", ct: "CT", diagram: "Diagram", ultrasound: "Ultrasound" };
    var diagrams = (p.diagrams && p.diagrams.length)
      ? '<section class="kbp-sec kbp-sec-diagrams" id="' + pre + 'Diagrams"><h2><span class="kbp-kind">Imaging</span>Clinical diagrams and imaging</h2>' +
        p.diagrams.map(function (d, i) {
          var src = String(d.src || "");
          var media = src.charAt(0) === "#"
            ? '<svg class="kbp-diagram-img" role="img" aria-label="' + esc(d.title) + '"><use href="' + esc(src) + '"></use></svg>'
            : '<img class="kbp-diagram-img" src="' + esc(src) + '" alt="' + esc(d.title) + '" loading="lazy">';
          var ann = (d.annotations && d.annotations.length)
            ? '<ul class="kbp-diagram-ann">' + d.annotations.map(function (a) {
                return '<li><strong>' + esc(a.label) + '</strong><span>' + esc(a.description) + '</span></li>';
              }).join("") + '</ul>' : '';
          return '<figure class="kbp-diagram-card" id="' + pre + 'Diagram' + i + '"><span class="kbp-diagram-type">' + esc(DTYPE[d.type] || d.type) + '</span>' +
            media + '<figcaption><strong>' + esc(d.title) + '</strong><span class="kbp-diagram-meta">' + esc(d.caption) + '</span></figcaption>' + ann + '</figure>';
        }).join("") + '</section>'
      : "";
    if (p.diagrams && p.diagrams.length) {
      p.diagrams.forEach(function (d, i) { toc.push('<button type="button" class="kbp-jump" data-kbp-jump="' + pre + 'Diagram' + i + '">' + esc(d.title) + '</button>'); });
    }

    var calcs = (p.calculators && p.calculators.length)
      ? '<section class="kbp-sec kbp-sec-calcs" id="' + pre + 'Calcs"><h2><span class="kbp-kind">Decision Tools</span>Calculators and Scores</h2><div class="kbp-calc-grid">' +
        p.calculators.map(function (c) {
          return '<div class="kbp-calc-card"><div class="kbp-calc-meta"><strong>' + esc(c.title) + '</strong>' +
            (c.description ? '<p>' + esc(c.description) + '</p>' : '') + '</div>' +
            '<button type="button" class="kbp-calc-btn" data-kbp-calc="' + esc(c.linkId) + '">Open ' + esc(c.title) + ' &rarr;</button></div>';
        }).join("") + '</div></section>'
      : "";
    if (calcs) toc.push('<button type="button" class="kbp-jump" data-kbp-jump="' + pre + 'Calcs">Calculators</button>');

    var drugs = (p.drugs && p.drugs.length)
      ? '<section class="kbp-sec kbp-drugs" id="' + pre + 'Drugs"><h2><span class="kbp-kind">Drugs</span>Key drugs and doses</h2><dl>' + p.drugs.map(function (d) {
          return '<div class="kbp-drug"><dt>' + esc(d.name) + '</dt><dd class="kbp-dose">' + esc(d.dose) + "</dd>" + (d.notes ? '<dd class="kbp-note">' + esc(d.notes) + "</dd>" : "") + "</div>";
        }).join("") + "</dl></section>"
      : "";
    if (drugs) toc.push('<button type="button" class="kbp-jump" data-kbp-jump="' + pre + 'Drugs">Drugs</button>');
    toc.push('<button type="button" class="kbp-jump" data-kbp-jump="' + pre + 'Sources">Sources</button>');
    var sources = '<section class="kbp-sec kbp-sources" id="' + pre + 'Sources"><h2><span class="kbp-kind">Evidence</span>Sources</h2><ol>' + (p.sources || []).map(function (s) {
      return '<li><a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title) + '</a><span>' + esc(s.org) + " · " + esc(s.year) + "</span></li>";
    }).join("") + '</ol><p class="kbp-foot">Links open the official source. Always consult the current published version. Decision support only: not a substitute for clinical judgement. ' + esc(DUTY_LINE) + '</p></section>';
    return '<div class="kbp-reader">' +
      (opts.back ? '<button type="button" class="kbp-back" data-kbp-back aria-label="Back to protocols"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg><span>All protocols</span></button>' : "") +
      '<header class="kblib-tool-intro kbp-hero">' + (opts.brand ? brandHTML() : "") + '<span class="kblib-tool-kicker">' + esc(subjectLabel(p.subject)) + "</span><h1>" + esc(p.title) + "</h1>" +
      (meta ? '<div class="kbp-metas">' + meta + "</div>" : "") + '<p class="kbp-summary">' + esc(p.summary) + "</p></header>" +
      statusHTML(p) + twin + '<nav class="kbp-toc" aria-label="Jump to section">' + toc.join("") + "</nav>" + secs + algos + tables + diagrams + calcs + drugs + sources + "</div>";
  }
  /* ---- assign: a protocol as case-sheet instructions (flag smd_protocol_assign) ------------------
   * Everything here is PURE (no DOM, no state, unit-tested): the host owns the patient record.
   *
   * assignLines(p)      one tickable line per instruction, each carrying the case-sheet field it
   *                     belongs in and whether it starts ticked. Recognise / special situations /
   *                     pitfalls and the drug doses start UNticked: they are reading matter or need a
   *                     deliberate choice, not a default order.
   * assignText(p, ids)  the blocks to append, per field, in case-sheet format (numbered, grouped by
   *                     the protocol's own section headings, with the sources named).
   * Nothing is prescribed or ordered: the doctor ticks each line, edits the text in the form, and the
   * normal Save writes it, exactly as the specialty kit's "Add to ..." works.
   */
  var PLAN_FIELD = "management_plan", ADVICE_FIELD = "diet_lifestyle_advice";
  // One sentence, one place. Shown small under the reader and under the assign list: the doctor owns
  // what is used or recorded, not StewardMD (mirrors disclaimer.html sections 8 and 9).
  var DUTY_LINE = "The treating doctor is responsible for every instruction used or recorded; StewardMD accepts no liability.";
  // kind -> [case-sheet field, ticked by default]
  var ASSIGN_KIND = {
    immediate: [PLAN_FIELD, true], treatment: [PLAN_FIELD, true], investigations: [PLAN_FIELD, true],
    monitoring: [PLAN_FIELD, true], escalate: [PLAN_FIELD, true], disposition: [PLAN_FIELD, true],
    prevention: [ADVICE_FIELD, true], recognise: [PLAN_FIELD, false], special: [PLAN_FIELD, false],
    pitfalls: [PLAN_FIELD, false]
  };
  var FIELD_LABEL = {}; FIELD_LABEL[PLAN_FIELD] = "Management plan"; FIELD_LABEL[ADVICE_FIELD] = "Diet & lifestyle advice";
  function assignLines(p) {
    var out = [];
    ((p && p.sections) || []).forEach(function (s, si) {
      var rule = ASSIGN_KIND[s.kind] || [PLAN_FIELD, false];
      (s.items || []).forEach(function (it, ii) {
        out.push({ id: "s" + si + "-" + ii, kind: s.kind, kindLabel: KINDS[s.kind] || s.kind,
          group: s.title || KINDS[s.kind] || s.kind, text: String(it), field: rule[0], on: rule[1] });
      });
    });
    ((p && p.drugs) || []).forEach(function (d, di) {
      var t = [d.name, d.dose].filter(Boolean).join(": ");
      if (d.notes) t += (/[.!?]$/.test(t) ? " " : ". ") + d.notes;
      out.push({ id: "d" + di, kind: "drugs", kindLabel: "Drugs", group: "Key drugs and doses",
        text: t, field: PLAN_FIELD, on: false });
    });
    return out;
  }
  /** ids: array (or map) of the line ids the doctor ticked; edits: {lineId: the doctor's own wording,
   *  which wins over the protocol's}. Returns { blocks:[{field,label,text}], count }. */
  function assignText(p, ids, edits) {
    var want = {};
    if (ids && ids.length != null) { for (var i = 0; i < ids.length; i++) want[ids[i]] = true; }
    else { for (var k in (ids || {})) if (ids[k]) want[k] = true; }
    var lines = assignLines(p).filter(function (l) { return want[l.id]; }).map(function (l) {
      var e = edits && edits[l.id] != null ? String(edits[l.id]).trim() : "";
      return e ? { id: l.id, kind: l.kind, kindLabel: l.kindLabel, group: l.group, text: e, field: l.field, on: l.on, edited: true } : l;
    });
    if (!lines.length) return { blocks: [], count: 0 };
    var src = ((p && p.sources) || []).slice(0, 2).map(function (x) {
      return x.title + " (" + [x.org, x.year].filter(Boolean).join(", ") + ")";
    }).join("; ");
    var order = [PLAN_FIELD, ADVICE_FIELD], blocks = [];
    order.forEach(function (field) {
      var mine = lines.filter(function (l) { return l.field === field; });
      if (!mine.length) return;
      var head = "Protocol: " + (p.title || p.id) + (BASIS[p.basis] ? " (" + BASIS[p.basis] + " guidelines)" : "");
      var body = [], n = 0, last = "";
      mine.forEach(function (l) {
        if (l.group !== last) { body.push(l.group + ":"); last = l.group; }
        n++; body.push(n + ". " + l.text);
      });
      var foot = field === PLAN_FIELD
        ? "Verify every dose and threshold against the source and your local protocol." + (src ? " Source: " + src + "." : "")
        : "";
      blocks.push({ field: field, label: FIELD_LABEL[field] || field, count: mine.length,
        text: [head].concat(body).concat(foot ? [foot] : []).join("\n") });
    });
    return { blocks: blocks, count: lines.length };
  }
  /** The tick list. Every line is EDITABLE before it is added (owner, 2026-09-27): a dose, a threshold
   *  or a wording can be changed to local practice here, not only after it lands in the form. Drug
   *  doses still start unticked.
   *  opts: { act(cmd), inp(name) -> the host's input attribute, edits, editing, disabled, note }. */
  function assignHTML(p, sel, opts) {
    opts = opts || {}; sel = sel || {};
    var act = opts.act || function (cmd) { return 'data-kbp-act="' + esc(cmd) + '"'; };
    var inp = opts.inp || function (name) { return 'data-kbp-inp="' + esc(name) + '"'; };
    var edits = opts.edits || {}, editing = opts.editing || "";
    var lines = assignLines(p), n = 0, last = "", rows = "";
    lines.forEach(function (l) {
      if (l.group !== last) { rows += '<div class="kbp-as-grp"><span class="kbp-kind">' + esc(l.kindLabel) + "</span>" + esc(l.group) + "</div>"; last = l.group; }
      var on = sel[l.id] !== undefined ? !!sel[l.id] : l.on;
      if (on) n++;
      var mine = edits[l.id] != null ? String(edits[l.id]) : "", txt = mine.trim() ? mine : l.text;
      var changed = !!mine.trim() && mine.trim() !== l.text;
      var tick = '<input type="checkbox"' + (on ? " checked" : "") + " " + act("proto-as-line:" + l.id) + ' aria-label="' + esc(txt.slice(0, 80)) + '">';
      var pencil = '<button type="button" class="kbp-as-ed" ' + act("proto-as-edit:" + l.id) +
        ' aria-label="' + (editing === l.id ? "Stop editing" : "Edit") + ' this instruction">' + (editing === l.id ? "Done" : "Edit") + "</button>";
      if (editing === l.id) {
        rows += '<div class="kbp-as-row edit' + (on ? " on" : "") + '"><label class="kbp-as-tickonly">' + tick + "</label>" +
          '<textarea class="kbp-as-tx" rows="4" ' + inp("proto-as-txt:" + l.id) + ' aria-label="Instruction text">' + esc(txt) + "</textarea>" +
          '<span class="kbp-as-side">' + pencil +
          (changed ? '<button type="button" class="kbp-as-ed" ' + act("proto-as-undo:" + l.id) + ' aria-label="Undo this edit">Undo</button>' : "") + "</span></div>";
        return;
      }
      rows += '<div class="kbp-as-row' + (on ? " on" : "") + '"><label>' + tick + "<span>" + esc(txt) + "</span></label>" +
        (changed ? '<em class="kbp-as-to edited">edited</em>' : "") +
        (l.field === ADVICE_FIELD ? '<em class="kbp-as-to">advice</em>' : "") + pencil + "</div>";
    });
    var counts = assignText(p, Object.keys(lines.reduce(function (m, l) {
      var on = sel[l.id] !== undefined ? !!sel[l.id] : l.on; if (on) m[l.id] = 1; return m;
    }, {})), edits);
    var where = counts.blocks.map(function (b) { return b.count + " to " + b.label; }).join(" · ");
    return '<div class="kbp-assign">' +
      '<div class="kbp-as-head"><strong>Add to this patient\'s case sheet</strong>' +
      '<p>Tick the instructions that apply, and tap Edit to change any wording or dose before it goes in. They are appended to the case sheet as text you can edit there too; nothing is saved until you save the assessment, and nothing is prescribed or ordered.</p>' +
      '<div class="kbp-as-bulk"><button type="button" class="kbp-as-b" ' + act("proto-as-all") + ">Select all</button>" +
      '<button type="button" class="kbp-as-b" ' + act("proto-as-none") + ">Clear</button>" +
      '<button type="button" class="kbp-as-b" ' + act("proto-as-reset") + ">Reset</button></div></div>" +
      rows +
      '<div class="kbp-as-foot"><span class="kbp-as-n">' + (n ? n + " instruction" + (n === 1 ? "" : "s") + (where ? " · " + esc(where) : "") : "Nothing ticked yet") + "</span>" +
      '<div class="kbp-as-acts"><button type="button" class="kbp-as-cancel" ' + act("proto-as-cancel") + ">Cancel</button>" +
      '<button type="button" class="kbp-as-add"' + (n && !opts.disabled ? "" : " disabled") + " " + act("proto-as-apply") + ">" + (opts.addLabel || "Add to case sheet") + "</button></div>" +
      (opts.note ? '<p class="kbp-as-note">' + esc(opts.note) + "</p>" : "") +
      '<p class="kbp-as-duty">' + esc(DUTY_LINE) + "</p></div></div>";
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
    fitTabs(tabs);
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
      // Calculator bridges work wherever a reader is embedded. Same open order as reasoning.js:
      // SB.calc when the shell provides it, else the calculator engine directly.
      var calcBtn = t.closest("[data-kbp-calc]");
      if (calcBtn) {
        var cid = calcBtn.getAttribute("data-kbp-calc");
        try {
          if (G.SB && typeof G.SB.calc === "function") { G.SB.calc(cid); return; }
          if (G.MEDCALC && typeof G.MEDCALC.open === "function") { G.MEDCALC.open(cid); return; }
        } catch (err) {}
        try { if (G.toast) G.toast("The calculator could not be opened right now."); } catch (err2) {}
        return;
      }
      if (!t.closest("#sbrefBody")) return;
      if (t.closest("[data-kbp-tab]")) { e.preventDefault(); if (G.SB && G.SB.openRef) G.SB.openRef("protocols"); else open(); return; }
      var go = t.closest("[data-kbp-go]"); if (go) { if (G.SB && G.SB.openRef) G.SB.openRef(go.getAttribute("data-kbp-go")); return; }
      var row = t.closest("[data-kbp-open]"); if (row) { openProtocol(row.getAttribute("data-kbp-open")); return; }
      if (t.closest("[data-kbp-back]")) { backToList(); return; }
      if (t.closest("[data-kbp-retry]")) { open(); return; }
      var seg = t.closest("[data-kbp-basis]");
      if (seg) { st.basis = seg.getAttribute("data-kbp-basis") || "all"; renderList(); return; }
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

  var API = { open: open, search: function (q, subject, basis) { return searchIndex(st.index, q, subject || "all", basis || "all"); }, BASIS: BASIS, loadIndex: loadIndex, loadProtocol: loadProtocol, readerHTML: readerHTML, DUTY_LINE: DUTY_LINE, assignLines: assignLines, assignText: assignText, assignHTML: assignHTML, ASSIGN_FIELDS: { plan: PLAN_FIELD, advice: ADVICE_FIELD }, subjectLabel: subjectLabel, index: function () { return st.index; }, CONTENT_V: CONTENT_V, _searchIndex: searchIndex, _rank: rank, _kinds: KINDS, _state: st };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  G.SMD_KBPROTO = API;
  if (D && D.addEventListener) {
    if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", install); else install();
  }
})(typeof window !== "undefined" ? window : globalThis);
