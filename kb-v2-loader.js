/* Schema v2 disease content (flowcharts, value tables) for the Knowledge Library disease reader.
 *
 * ON for everyone (owner 2026-10-09: app is tester-only). Per-device kill switch: ?kbv2=0 (persists as
 * localStorage smd_kb_v2 = "0"); ?kbv2=1 turns it back on.
 * reasoning.js emits <div class="kbv2-slot" data-kbv2-id="ID" data-kbv2-kind="KIND"></div> only when
 * SMD_KBV2_ON is true; the disease reader puts one slot per kind in the section it belongs to.
 * This file watches for those slots, fetches the one bucket that holds the id (once, cached by bucket),
 * and renders each slot's kind with kb-flowchart.js and kb-highyield.js.
 */
(function () {
  "use strict";
  var on = true;
  try {
    var q = new URLSearchParams(location.search).get("kbv2");
    if (q === "0") localStorage.setItem("smd_kb_v2", "0");
    if (q === "1") localStorage.removeItem("smd_kb_v2");
    on = localStorage.getItem("smd_kb_v2") !== "0";
  } catch (e) { on = true; }
  window.SMD_KBV2_ON = on;
  initHandouts();   // independent of the v2 switch: shows only when kb/dist/handouts holds a handout for the disease
  if (!on) return;

  var BUCKETS = 64;
  var cache = {};
  function bucketOf(id) {
    var h = 5381;
    for (var i = 0; i < id.length; i++) h = ((h * 33) ^ id.charCodeAt(i)) >>> 0;
    return h % 64;
  }
  function pad2(b) { return (b < 10 ? "0" : "") + b; }
  function load(id) {
    var b = bucketOf(id);
    if (!cache[b]) {
      cache[b] = fetch("/kb/dist/v2/b" + pad2(b) + ".json?v=kbv22")
        .then(function (r) { return r.ok ? r.json() : {}; })
        .catch(function () { return {}; });
    }
    return cache[b].then(function (all) { return all[id] || null; });
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function hy(t) { return window.KBHy ? window.KBHy.html(t || "") : esc(t || ""); }

  var KIND = { diagnostic: "Diagnostic criteria and key values", ddx: "Differential diagnosis", treatment: "Treatment" };
  var NOTE = '<p class="kbv2-foot">AI-drafted from cited sources. Not clinician reviewed.</p>';
  // A flowchart that only works a problem up belongs with Diagnosis; anything that treats goes to Management.
  function fcKind(fc) {
    var t = String(fc.title || "").toLowerCase();
    return (/work(?:ing)?[\s-]?up|diagnos|evaluat|approach|picking|choosing/.test(t) && !/manag|treat/.test(t)) ? "flowchart-dx" : "flowchart";
  }
  function flowHTML(fc, titled) {
    return '<section class="kbv2-sec"><h4 class="kbv2-h">' + (titled ? "Flowchart: " : "") + esc(fc.title || "") + "</h4>" + window.KBFlowchart.render(fc) + "</section>";
  }
  function tableHTML(vt, cites, titled) {
    var cols = (vt.columns || []).slice();
    if (cols.length && String(cols[0]).toLowerCase() === "parameter") cols = cols.slice(1);
    // three or fewer columns fit a phone; wider tables get a floor and scroll inside their own box
    var n = cols.length + 1, floor = n >= 4 ? ' style="min-width:' + (n * 120) + 'px"' : "";
    var head = "<th scope=\"col\">" + esc(vt.rowHeader || "Item") + "</th>" + cols.map(function (c) { return "<th scope=\"col\">" + esc(c) + "</th>"; }).join("");
    var rows = (vt.rows || []).map(function (r) {
      return '<tr><th scope="row">' + esc(r.parameter || "") + (r.unit ? '<span class="kbv2-unit">' + esc(r.unit) + "</span>" : "") + "</th>" +
        (r.cells || []).map(function (c) {
          var pend = String(c.text || "").indexOf("needs-source") >= 0 ? ' class="kbv2-pending"' : "";
          return "<td" + pend + ">" + hy(c.text) + "</td>";
        }).join("") + "</tr>";
    }).join("");
    var label = (titled ? esc(KIND[vt.kind] || "Table") + ": " : "") + esc(vt.title || "");
    return '<section class="kbv2-sec"><h4 class="kbv2-h">' + label + "</h4>" +
      '<div class="kbv2-scroll" tabindex="0" role="region" aria-label="' + esc(vt.title || "Table") + '"><table class="kbv2-tbl"' + floor + "><thead><tr>" + head + "</tr></thead><tbody>" + rows + "</tbody></table></div>" +
      (vt.footnote ? '<p class="kbv2-foot">' + hy(vt.footnote) + "</p>" : "") + "</section>";
  }
  /* kind (data-kbv2-kind on the slot) picks what this slot shows, so the reader can place each kind
   * in its own section: diagnostic | ddx | treatment (valueTables), flowchart | flowchart-dx, foot
   * (the AI-drafted note, once). No kind = everything plus the note, the original single-slot form. */
  function render(x, kind) {
    var cites = {};
    (x.citations || []).forEach(function (c) { cites[c.id] = c.label || c.id; });
    var fcs = x.flowcharts || [], vts = x.valueTables || [];
    if (kind === "foot") return (fcs.length || vts.length) ? NOTE : "";
    var html = "";
    fcs.forEach(function (fc) {
      if (!window.KBFlowchart) return;
      if (!kind || fcKind(fc) === kind) html += flowHTML(fc, !kind);
    });
    vts.forEach(function (vt) { if (!kind || vt.kind === kind) html += tableHTML(vt, cites, !kind); });
    if (html && !kind) html += NOTE;
    return html;
  }
  // A reader section that holds nothing but slots disappears (with its jump chip) when they all come back empty.
  function settle(slot) {
    var sec = slot.closest ? slot.closest("[data-kbr-slotonly]") : null;
    if (!sec) return;
    var all = sec.querySelectorAll(".kbv2-slot");
    for (var i = 0; i < all.length; i++) if (!all[i].getAttribute("data-kbv2-done") || all[i].innerHTML) return;
    sec.hidden = true;
    var chip = document.querySelector('.kbr-chip[data-jump="' + sec.id + '"]');
    if (chip) chip.hidden = true;
  }
  /* Drug names in a treatment flowchart open the Drug Index entry, through the same matcher and
   * open call every other reading surface uses (drug-link.js: SMD_DRUGLINK.find / openMonograph, tapped
   * through its document-level handler). drug-link.js skips <svg>, so the flowchart text is wrapped here.
   * Whole words only; a name wrapped across two lines of a box is left as plain text. */
  function linkFlowDrugs(slot) {
    var DL = window.SMD_DRUGLINK, n = 0;
    if (!DL || !DL.find || (DL.enabled && !DL.enabled()) || !slot.querySelectorAll) return 0;
    var NS = "http://www.w3.org/2000/svg", doc = slot.ownerDocument, texts = slot.querySelectorAll("svg text");
    for (var t = 0; t < texts.length; t++) {
      var tw = doc.createTreeWalker(texts[t], 4, null, false), nodes = [], nd;
      while ((nd = tw.nextNode())) if (nd.nodeValue && nd.nodeValue.length >= 4) nodes.push(nd);
      for (var k = 0; k < nodes.length; k++) {
        var tn = nodes[k], text = tn.nodeValue, hits = DL.find(text);
        if (DL.isPartial) hits = hits.filter(function (x) { return !DL.isPartial(x); });
        if (!hits.length) continue;
        var frag = doc.createDocumentFragment(), at = 0;
        for (var h = 0; h < hits.length; h++) {
          if (hits[h].start > at) frag.appendChild(doc.createTextNode(text.slice(at, hits[h].start)));
          var sp = doc.createElementNS(NS, "tspan");
          sp.setAttribute("class", "smd-drug kbfc-drug");
          sp.setAttribute("data-smd-drug", hits[h].generic);
          sp.setAttribute("role", "button");
          sp.setAttribute("tabindex", "0");
          sp.setAttribute("aria-label", "Open the " + hits[h].text + " entry in the Drug Index");
          sp.textContent = hits[h].text;
          frag.appendChild(sp); at = hits[h].end; n++;
        }
        if (at < text.length) frag.appendChild(doc.createTextNode(text.slice(at)));
        tn.parentNode.replaceChild(frag, tn);
      }
    }
    return n;
  }
  function fill(slot) {
    if (slot.getAttribute("data-kbv2-done") || slot.getAttribute("data-kbv2-busy")) return;
    slot.setAttribute("data-kbv2-busy", "1");
    load(slot.getAttribute("data-kbv2-id")).then(function (x) {
      slot.removeAttribute("data-kbv2-busy");
      slot.setAttribute("data-kbv2-done", "1");
      if (x) {
        slot.innerHTML = render(x, slot.getAttribute("data-kbv2-kind") || "");
        if (slot.getAttribute("data-kbv2-kind") === "flowchart") linkFlowDrugs(slot);
      }
      settle(slot);
    });
  }
  function scan(rootEl) {
    if (!rootEl || !rootEl.querySelectorAll) return;
    if (rootEl.matches && rootEl.matches(".kbv2-slot")) fill(rootEl);
    rootEl.querySelectorAll(".kbv2-slot").forEach(fill);
  }
  new MutationObserver(function (muts) {
    muts.forEach(function (m) { m.addedNodes.forEach(scan); });
  }).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", function () { scan(document.body); });

  /* Patient handout (kb/dist/handouts, bucketed with the same hash as kb/dist/v2). The reader emits an
   * empty <div class="kbh-slot" data-kbh-id="ID">; it gets a button only when a handout exists for ID,
   * so a disease without one shows nothing. Record: {id, title, sections:[{h, items[]}], urgent[], status}. */
  function initHandouts() {
    var hcache = {};
    function hload(id) {
      var b = bucketOf(id);
      if (!hcache[b]) {
        hcache[b] = fetch("/kb/dist/handouts/b" + pad2(b) + ".json?v=kbh1")
          .then(function (r) { return r.ok ? r.json() : {}; })
          .catch(function () { return {}; });
      }
      return hcache[b].then(function (all) { var x = all && all[id]; return x && typeof x === "object" ? x : null; });
    }
    function list(items) {
      var a = (items || []).filter(function (i) { return i && String(i).trim(); });
      return a.length ? "<ul>" + a.map(function (i) { return "<li>" + esc(i) + "</li>"; }).join("") + "</ul>" : "";
    }
    function body(x) {
      var h = '<h4 class="kbh-title">' + esc(x.title || "Patient handout") + "</h4>";
      (x.sections || []).forEach(function (s) {
        var l = list(s && s.items);
        if (l) h += '<section class="kbh-sec"><h5>' + esc(s.h || "") + "</h5>" + l + "</section>";
      });
      var u = list(x.urgent);
      if (u) h += '<section class="kbh-sec kbh-urgent"><h5>Get urgent care if</h5>' + u + "</section>";
      return h + '<p class="kbh-note">' + (x.status === "ai_drafted" ? "AI-drafted from cited sources. Not clinician reviewed. " : "") + "Plain-language leaflet for the patient.</p>";
    }
    function fillH(slot) {
      if (slot.getAttribute("data-kbh-done")) return;
      slot.setAttribute("data-kbh-done", "1");
      hload(slot.getAttribute("data-kbh-id") || "").then(function (x) {
        if (!x || !(x.sections && x.sections.length)) return;
        var pid = "kbh-" + Math.floor(Math.random() * 1e9);
        slot.innerHTML = '<button type="button" class="kbh-btn" aria-expanded="false" aria-controls="' + pid + '">Patient handout</button>' +
          '<div class="kbh-panel" id="' + pid + '" hidden>' + body(x) + "</div>";
        var btn = slot.firstChild, panel = slot.lastChild;
        btn.addEventListener("click", function () {
          var open = btn.getAttribute("aria-expanded") !== "true";
          btn.setAttribute("aria-expanded", open ? "true" : "false");
          panel.hidden = !open;
        });
      });
    }
    function scanH(rootEl) {
      if (!rootEl || !rootEl.querySelectorAll) return;
      if (rootEl.matches && rootEl.matches(".kbh-slot")) fillH(rootEl);
      rootEl.querySelectorAll(".kbh-slot").forEach(fillH);
    }
    new MutationObserver(function (muts) { muts.forEach(function (m) { m.addedNodes.forEach(scanH); }); })
      .observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener("DOMContentLoaded", function () { scanH(document.body); });
  }

  var css = document.createElement("style");
  css.textContent = ".kbv2-sec{margin:16px 0;min-width:0}.kbv2-h{font-size:15px;margin:0 0 8px}" +
    ".kbv2-scroll{overflow-x:auto;max-width:100%;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain}" +
    ".kbv2-tbl{border-collapse:collapse;width:100%;font-size:13px;font-variant-numeric:tabular-nums}" +
    ".kbv2-tbl th,.kbv2-tbl td{border:1px solid rgba(127,127,127,.35);padding:6px 8px;text-align:left;vertical-align:top}" +
    ".kbv2-unit{display:block;font-weight:400;opacity:.75;font-size:11px}.kbv2-cite{font-size:11px;opacity:.8}" +
    ".kbv2-pending{font-style:italic;background:rgba(200,120,0,.12)}.kbv2-foot{font-size:12px;opacity:.8;margin:6px 0 0}" +
    ".kb-hy{font-weight:700;text-decoration:underline;text-decoration-thickness:.12em;text-underline-offset:.18em}" +
    ".kbfc-wrap{background:#fff;border-radius:8px;padding:8px;overscroll-behavior-x:contain}" +
    ".kbfc-wrap .kbfc-drug{cursor:pointer;fill:#0b5d8f;text-decoration:underline dotted;text-underline-offset:2px;font-weight:700;-webkit-text-fill-color:currentColor;background:none;animation:none;filter:none}" +
    ".kbfc-wrap .kbfc-drug:hover{fill:#073f61;background:none;animation:none;filter:none;-webkit-text-fill-color:currentColor}";
  document.head.appendChild(css);
})();
