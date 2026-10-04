/* StewardMD - Adult normal values (window.SMD_ADULT_REF). Owner-approved 2026-10-04; clinical sign-off by the owner 2026-10-05.
 *
 * Adult lab reference ranges from data/ref/adult-ref-values.json: every row carries its value, unit,
 * source and the source row as read. Same look as the neonatal "Reference values" screen (neo-ref.js),
 * but its own full-screen page, so it works with the neonatal layer off. Reached from search
 * (search.js EXTRA_TOOLS "adultref"), home.js ACT.adultref, and MaiK / Edge cards (home.js
 * maikToolOpener, which passes the question so the asked analyte is highlighted).
 * The pure part (match, isNeonatal, rowsFor, passage) is used by maik-local.js to ground value
 * questions and is unit-tested under node (test/adult-ref.test.mjs).
 */
(function (G) {
  "use strict";
  var VER = "aref1", URL_ = "/data/ref/adult-ref-values.json";
  var doc = null, pend = null;

  /* ---------------- pure ---------------- */
  function clean(s) { return String(s == null ? "" : s).replace(/[–—−]/g, "-"); }
  function base(name) { return String(name || "").replace(/\s*\(.*?\)\s*/g, " ").trim().toLowerCase(); }
  function reEsc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  var NEO = /\b(neonat\w*|newborns?|new-born|nicu|preterm|premature|infants?|bab(?:y|ies)|paediatric|pediatric|child(?:ren)?)\b/i;
  function isNeonatal(text) { return NEO.test(String(text || "")); }
  /* Analyte names (and aliases of 3+ characters: "na", "mg", "pt" are too ambiguous in free text)
   * found in the text. A name inside a longer matched name ("protein" in "urine protein") is dropped. */
  function match(text, d) {
    d = d || doc; if (!d) return [];
    var t = " " + String(text || "").toLowerCase().replace(/[–—−]/g, "-") + " ", hits = [];
    (d.groups || []).forEach(function (g) {
      (g.rows || []).forEach(function (r) {
        [base(r.analyte), r.analyte.toLowerCase()].concat(r.aka || []).forEach(function (term) {
          term = String(term).toLowerCase(); if (term.length < 3) return;
          var re = new RegExp("(^|[^a-z0-9])" + reEsc(term) + "(?=[^a-z0-9+]|$)", "g"), m;
          while ((m = re.exec(t))) hits.push({ a: r.analyte, s: m.index + m[1].length, e: m.index + m[1].length + term.length });
        });
      });
    });
    var keep = hits.filter(function (h) { return !hits.some(function (o) { return o !== h && o.s <= h.s && o.e >= h.e && (o.e - o.s) > (h.e - h.s) && o.a !== h.a; }); });
    var out = [];
    keep.sort(function (x, y) { return x.s - y.s; }).forEach(function (h) { if (out.indexOf(h.a) < 0) out.push(h.a); });
    return out;
  }
  function rowsFor(analytes, d) {
    d = d || doc; var out = [];
    if (!d) return out;
    (d.groups || []).forEach(function (g) { (g.rows || []).forEach(function (r) { if (analytes.indexOf(r.analyte) > -1) out.push(r); }); });
    return out;
  }
  function srcName(sid, d) {
    var s = ((d || doc || {}).sources || {})[sid] || {};
    return sid === "abim-2026" ? "ABIM Laboratory Test Reference Ranges, January 2026" : sid === "rcpa-spia" ? "RCPA SPIA harmonised reference intervals" : (s.title || sid);
  }
  function rowText(r, d) {
    return clean((r.sex ? (r.sex === "male" ? "men" : "women") + " " : "") + r.value + (r.unit ? " " + r.unit : "") + " (" + srcName(r.src, d) + ")");
  }
  /* One evidence passage per analyte: every row with its source named, plus the lab-variation note. */
  function passage(analyte, d) {
    d = d || doc; var rows = rowsFor([analyte], d);
    if (!rows.length) return null;
    var sp = rows[0].specimen ? " (" + rows[0].specimen + ")" : "";
    var notes = []; rows.forEach(function (r) { if (r.note && notes.indexOf(r.note) < 0) notes.push(clean(r.note)); });
    return {
      heading: "StewardMD Adult Reference Ranges > " + analyte,
      text: "Adult reference range for " + analyte + sp + ": " + rows.map(function (r) { return rowText(r, d); }).join("; ") + ". " +
        (notes.length ? notes.join(" ") + " " : "") + "Ranges vary by laboratory and method; use the patient's own laboratory range.",
      curated: true, ref: true, sources: rows.map(function (r) { return srcName(r.src, d); }).filter(function (s, i, a) { return a.indexOf(s) === i; })
    };
  }
  function setDoc(d) { doc = d; return d; }
  function load() {
    if (doc) return Promise.resolve(doc);
    if (pend) return pend;
    if (typeof fetch !== "function") return Promise.resolve(null);
    pend = fetch(URL_ + "?v=" + VER).then(function (r) { if (!r.ok) throw new Error("adult ref " + r.status); return r.json(); })
      .then(function (j) { pend = null; return setDoc(j); }, function () { pend = null; return null; });
    return pend;
  }

  var API = { VER: VER, load: load, setDoc: setDoc, doc: function () { return doc; }, match: match, isNeonatal: isNeonatal, rowsFor: rowsFor, passage: passage, srcName: srcName };
  G.SMD_ADULT_REF = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  var D = G.document;
  if (!D || !D.createElement) return;

  /* ---------------- page ---------------- */
  var root = null, query = "", hit = [];
  function esc(s) { return clean(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function css() {
    if (D.getElementById("arCss")) return;
    var s = D.createElement("style"); s.id = "arCss";
    s.textContent = [
      "#adultRef{--nh-bg:#f4f7f6;--nh-panel:#fff;--nh-ink:#12202a;--nh-mut:#5b6b75;--nh-line:#dce4e2;--nh-acc:#0f766e;--nh-acc-soft:#e3f2ef;--nh-warn:#9a5b00;--nh-warn-soft:#fff3dd;--nh-f:-apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif;--nh-mono:ui-monospace,'SF Mono',Menlo,monospace;position:fixed;inset:0;z-index:10040;background:var(--nh-bg);color:var(--nh-ink);font:15px/1.45 var(--nh-f);display:flex;flex-direction:column;-webkit-font-smoothing:antialiased}",
      "#adultRef[hidden]{display:none!important}",
      "body.dark #adultRef,body.v3-dark #adultRef{--nh-bg:#0d1417;--nh-panel:#151f23;--nh-ink:#e3ecea;--nh-mut:#93a4a8;--nh-line:#26363b;--nh-acc:#37b8a6;--nh-acc-soft:#153430;--nh-warn:#f0b454;--nh-warn-soft:#352812}",
      "#adultRef *{box-sizing:border-box}",
      "#adultRef .nh-top{display:flex;align-items:center;gap:8px;padding:calc(env(safe-area-inset-top,0px) + 8px) 12px 8px;border-bottom:1px solid var(--nh-line);background:var(--nh-panel)}",
      "#adultRef .nh-x{border:0;background:none;color:var(--nh-acc);font:600 16px var(--nh-f);padding:6px 4px;min-height:44px;min-width:44px;cursor:pointer;text-align:left}",
      "#adultRef .nh-t{flex:1;min-width:0;font:700 17px var(--nh-f);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      "#adultRef .nh-body{flex:1;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:12px 16px calc(env(safe-area-inset-bottom,0px) + 30px);display:flex;flex-direction:column;gap:12px}",
      "#adultRef .nh-card{background:var(--nh-panel);border:1px solid var(--nh-line);border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:10px;min-width:0}",
      "#adultRef h3{margin:0;font:700 13px var(--nh-f);letter-spacing:.06em;text-transform:uppercase;color:var(--nh-mut);display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
      "#adultRef input[type=search]{width:100%;font:500 16px var(--nh-f);color:var(--nh-ink);background:var(--nh-panel);border:1.5px solid var(--nh-line);border-radius:10px;padding:10px 11px;min-height:44px;-webkit-appearance:none;appearance:none}",
      "#adultRef input[type=search]:focus-visible{outline:2px solid var(--nh-acc);outline-offset:1px;border-color:var(--nh-acc)}",
      "#adultRef .nh-note{font:500 13px/1.45 var(--nh-f);color:var(--nh-warn);background:var(--nh-warn-soft);border-radius:9px;padding:8px 10px}",
      "#adultRef .nh-draft{font:700 10.5px var(--nh-f);letter-spacing:.05em;text-transform:uppercase;color:var(--nh-warn);background:var(--nh-warn-soft);border-radius:999px;padding:3px 8px}",
      "#adultRef .nh-row{border-top:1px solid var(--nh-line);padding-top:10px;display:flex;flex-direction:column;gap:6px;min-width:0}#adultRef .nh-row:first-of-type{border-top:0;padding-top:0}",
      "#adultRef .nh-lbl{font:700 11px var(--nh-f);letter-spacing:.06em;text-transform:uppercase;color:var(--nh-acc)}",
      "#adultRef .ar-v{padding:4px 8px;border-radius:8px}#adultRef .nh-row.hit .ar-v{background:var(--nh-acc-soft)}",
      "#adultRef .ar-n{font:600 15px var(--nh-f);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}",
      "#adultRef .nh-work{font:500 13px/1.45 var(--nh-f);color:var(--nh-mut);overflow-wrap:anywhere}",
      "#adultRef .nh-none{font:600 14px var(--nh-f);color:var(--nh-mut);background:var(--nh-bg);border:1px dashed var(--nh-line);border-radius:10px;padding:10px 12px}",
      "#adultRef .nh-src{font:500 12.5px/1.5 var(--nh-f);color:var(--nh-mut);border-left:3px solid var(--nh-line);padding-left:9px}#adultRef .nh-src summary{cursor:pointer;min-height:32px;display:flex;align-items:center;color:var(--nh-acc);font-weight:600}#adultRef .nh-src blockquote{margin:6px 0;font:500 12.5px/1.5 var(--nh-mono);overflow-wrap:anywhere}#adultRef .nh-src a{color:var(--nh-acc)}",
      "#adultRef .ar-srcs{font:500 12.5px/1.5 var(--nh-f);color:var(--nh-mut);display:flex;flex-direction:column;gap:8px}#adultRef .ar-srcs b{color:var(--nh-ink)}#adultRef .ar-srcs a{color:var(--nh-acc);overflow-wrap:anywhere}",
      "#adultRef .nh-foot{font:500 12px var(--nh-f);color:var(--nh-mut);text-align:center;padding:4px 8px}",
      "@media(min-width:720px){#adultRef .nh-body{max-width:760px;margin:0 auto;width:100%}}"
    ].join("\n");
    D.head.appendChild(s);
  }
  function srcLine(r) {
    var s = (doc.sources || {})[r.src] || {};
    return '<details class="nh-src"><summary>Where this comes from</summary><div style="font-weight:600;color:var(--nh-ink)">' + esc(s.title || r.src) + "</div>" +
      (r.quote ? '<blockquote>"' + esc(r.quote) + '"</blockquote>' : "") +
      (s.url ? '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.publisher || s.url) + "</a>" : "") + (s.accessed ? " · Accessed " + esc(s.accessed) : "") + "</details>";
  }
  function hay(r, g) { return (r.analyte + " " + (r.aka || []).join(" ") + " " + g.title + " " + (r.specimen || "")).toLowerCase(); }
  function listHtml() {
    var q = query.trim().toLowerCase(), terms = q.split(/\s+/).filter(Boolean), h = "", n = 0;
    (doc.groups || []).forEach(function (g) {
      var rows = g.rows.filter(function (r) { var x = hay(r, g); return terms.every(function (t) { return x.indexOf(t) > -1; }); });
      if (!rows.length) return;
      var byA = {}, order = [];
      rows.forEach(function (r) { if (!byA[r.analyte]) { byA[r.analyte] = []; order.push(r.analyte); } byA[r.analyte].push(r); });
      h += '<section class="nh-card" aria-label="' + esc(g.title) + '"><h3>' + esc(g.title) + "</h3>";
      order.forEach(function (a) {
        n++;
        h += '<div class="nh-row' + (hit.indexOf(a) > -1 ? " hit" : "") + '" data-analyte="' + esc(a) + '"><div class="nh-lbl">' + esc(a) + "</div>";
        byA[a].forEach(function (r) {
          h += '<div class="ar-v"><div class="ar-n">' + esc(r.value + (r.unit ? " " + r.unit : "")) + (r.sex ? ' <span class="nh-work">' + (r.sex === "male" ? "men" : "women") + "</span>" : "") + "</div>" +
            '<div class="nh-work">' + esc([r.specimen, srcName(r.src)].filter(Boolean).join(" · ")) + "</div>" + (r.note ? '<div class="nh-work">' + esc(r.note) + "</div>" : "") + srcLine(r) + "</div>";
        });
        h += "</div>";
      });
      h += "</section>";
    });
    return n ? h : '<div class="nh-none">No adult range on file for "' + esc(query) + '".</div>';
  }
  function sourcesHtml() {
    var S = doc.sources || {};
    return '<section class="nh-card"><h3>Sources</h3><div class="ar-srcs">' + Object.keys(S).map(function (k) {
      var s = S[k]; return "<div><b>" + esc(s.title) + "</b><br>" + esc(s.publisher || "") + (s.url ? '<br><a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.url) + "</a>" : "") + (s.accessed ? "<br>Accessed " + esc(s.accessed) : "") + (s.licence ? "<br>" + esc(s.licence) : "") + "</div>";
    }).join("") + "</div></section>";
  }
  function paintList() { var l = root.querySelector("[data-ar=list]"); if (l) l.innerHTML = listHtml(); }
  function paint() {
    var b = root.querySelector(".nh-body");
    if (!doc) { b.innerHTML = '<section class="nh-card"><div class="nh-none">Could not load the adult reference ranges. Check the connection and try again.</div></section>'; return; }
    b.innerHTML = '<div class="nh-note" role="note">' + esc(doc.note) + "</div>" +
      '<section class="nh-card"><h3>Adult normal values</h3>' +
      '<label for="arQ" class="nh-work">Search a test (name or abbreviation)</label><input id="arQ" type="search" autocomplete="off" spellcheck="false" enterkeyhint="search" placeholder="Potassium, ALT, TSH…" value="' + esc(query) + '"></section>' +
      '<div data-ar="list" aria-live="polite" style="display:flex;flex-direction:column;gap:12px">' + listHtml() + "</div>" + sourcesHtml() +
      '<div class="nh-foot">Adults only. Each value names its source. Use your own laboratory\'s range where it differs.</div>';
    if (hit.length) { var el = b.querySelector(".nh-row.hit"); if (el && el.scrollIntoView) setTimeout(function () { try { el.scrollIntoView({ block: "nearest" }); } catch (e) {} }, 60); }
  }
  function close() { if (root) root.hidden = true; D.body.classList.remove("smd-adultref-open"); }
  function open(opts) {
    css();
    if (!root) {
      root = D.createElement("div"); root.id = "adultRef"; root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true"); root.setAttribute("aria-label", "Adult normal values");
      root.innerHTML = '<div class="nh-top"><button type="button" class="nh-x" data-ar="back" aria-label="Close">‹ Close</button><div class="nh-t">Adult normal values</div></div><div class="nh-body"><section class="nh-card"><div class="nh-none">Loading…</div></section></div>';
      root.addEventListener("click", function (e) { if (e.target.closest && e.target.closest("[data-ar=back]")) close(); });
      root.addEventListener("input", function (e) { if (e.target.id === "arQ") { query = e.target.value; hit = []; paintList(); } });
      D.body.appendChild(root);
    }
    root.hidden = false; D.body.classList.add("smd-adultref-open");
    var q = (opts && opts.q) || "";
    return load().then(function () {
      hit = q && doc ? match(q) : [];
      query = hit.length ? hit[0] : (opts && opts.search) || "";
      paint();
      return true;
    });
  }
  API.open = open; API.close = close; API.isOpen = function () { return !!(root && !root.hidden); };
  D.addEventListener("keydown", function (e) { if (e.key === "Escape" && API.isOpen()) close(); }, false);
})(typeof window !== "undefined" ? window : globalThis);
