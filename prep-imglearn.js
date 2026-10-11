/* PrepNucleus image learning sections: the ECG atlas (KardiqX) and later atlases. window.PREP_IMGLEARN. ES5.
   Each card is { image, finding, diagnosis, one reasoning line }. Sections read the shared content
   modules at runtime (SMD_KARDIOX_CONTENT for ECGs): the same ECGs as KardiqX Learn, no copies.
   Mirrors prep-lessons.js: subjectButton(box, sid, topics, host), act(a, el, host). */
(function (G) {
  "use strict";

  /* ================= pure ================= */
  // The KardiqX Learn-ECG entries, live (kardiox-content.js is loaded by the app shell).
  function ecgEntries(C) {
    C = C || (G && G.SMD_KARDIOX_CONTENT);
    return (C && C.ecgs) || [];
  }
  // Unique categories with counts, in first-seen order.
  function ecgCats(list) {
    var out = [], at = {};
    (list || []).forEach(function (e) {
      var c = e.category || "Other";
      if (at[c] == null) { at[c] = out.length; out.push({ name: c, n: 0 }); }
      out[at[c]].n++;
    });
    return out;
  }
  // One learn card from an ECG entry: image, finding tags, diagnosis, one reasoning line.
  function ecgCard(e) {
    e = e || {};
    var tags = (e.ecgFindingTags || []).slice(0, 4).join(" · ");
    var reason = e.pearl || ((e.diagnosticCriteria || [])[0] || "");
    return { id: e.id || "", img: e.ecgImage || "", title: e.title || "", cat: e.category || "",
      finding: tags, dx: e.title || "", reason: reason, measurements: e.measurements || "" };
  }
  var PURE = { ecgEntries: ecgEntries, ecgCats: ecgCats, ecgCard: ecgCard };
  if (typeof module !== "undefined" && module.exports && !(G && G.document)) { module.exports = PURE; return; }

  /* ================= browser ================= */
  var S = null;   // { sid, cat }
  function kxOn() { try { return !!(G.KARDIOX && G.KARDIOX.learnOn && G.KARDIOX.learnOn()); } catch (e) { return false; } }

  // Subject screen: an "ECG atlas" button in the actions block for ss-cardiology (under Practise).
  function subjectButton(box, sid, topics, host) {
    if (!box || sid !== "ss-cardiology") return;
    var n = ecgEntries().length;
    if (!n) return;
    if (box.querySelector('[data-act="il-ecg"]')) { box.hidden = false; return; }
    var b = G.document.createElement("button");
    b.type = "button"; b.__pnKeep = 1; b.className = "pn-btn pn-sublearn"; b.setAttribute("data-act", "il-ecg"); b.setAttribute("data-s", sid);
    b.innerHTML = '<span class="pn-sl-t">ECG atlas</span><span class="pn-sl-n">' + n + " tracings</span>";
    var last = box.querySelector(".su-lastb");
    box.insertBefore(b, last || null);
    box.hidden = false;
  }

  function cardHtml(c, esc) {
    var kx = kxOn() ? '<button type="button" class="pn-btn" data-act="il-kx" data-id="' + esc(c.id) + '">Open in KardiqX</button>' : "";
    return '<article class="pn-il-card"><figure class="pn-il-fig"><img src="' + esc(c.img) + '" alt="ECG: ' + esc(c.title) + '" loading="lazy" decoding="async">' +
      '<figcaption class="pn-mut"><small>Teaching illustration (KardiqX)</small></figcaption></figure>' +
      '<div class="pn-il-body"><h3>' + esc(c.title) + '</h3>' +
      (c.finding ? '<p class="pn-il-find">' + esc(c.finding) + '</p>' : "") +
      (c.reason ? '<p class="pn-il-why">' + esc(c.reason) + '</p>' : "") + kx + "</div></article>";
  }

  function draw(host) {
    var esc = host.esc, list = ecgEntries(), cats = ecgCats(list);
    var cards = list.filter(function (e) { return !S.cat || e.category === S.cat; }).map(ecgCard);
    host.paint(host.bar("ECG atlas", "ss-cardiology" === S.sid ? "Cardiology" : "", "back") + '<div class="pn-body pn-il">' +
      '<p class="pn-mut pn-small">The same ' + list.length + ' teaching tracings as KardiqX Learn. Drawn illustrations, not patient recordings.</p>' +
      '<div class="pn-il-cats" role="group" aria-label="Filter by category">' +
      '<button type="button" class="pn-chip' + (!S.cat ? " on" : "") + '" data-act="il-cat" data-v="">All</button>' +
      cats.map(function (c) { return '<button type="button" class="pn-chip' + (S.cat === c.name ? " on" : "") + '" data-act="il-cat" data-v="' + esc(c.name) + '">' + esc(c.name) + " (" + c.n + ")</button>"; }).join("") + "</div>" +
      '<div class="pn-il-grid">' + cards.map(function (c) { return cardHtml(c, esc); }).join("") + "</div>" +
      '<button type="button" class="pn-btn pri" data-act="module" data-s="ss-cardiology" data-m="sca-ecg">Practise ECG questions</button></div>');
  }

  function openAtlas(sid, host, cat) {
    S = { sid: sid, cat: cat || "" };
    host.push(function () { draw(host); });
  }

  function act(a, el, host) {
    if (a === "il-ecg") { openAtlas(el.getAttribute("data-s") || "ss-cardiology", host, ""); return true; }
    if (a === "il-cat") { if (S) { S.cat = el.getAttribute("data-v") || ""; draw(host); } return true; }
    if (a === "il-kx") {
      var id = el.getAttribute("data-id") || "";
      try { if (G.PREP && G.PREP.close) G.PREP.close(); } catch (e) {}
      try { if (G.KARDIOX && G.KARDIOX.openLearn) G.KARDIOX.openLearn(id); } catch (e) {}
      return true;
    }
  }

  G.PREP_IMGLEARN = { subjectButton: subjectButton, act: act, _pure: PURE };
})(typeof window !== "undefined" ? window : this);
