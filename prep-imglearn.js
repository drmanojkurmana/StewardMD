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
  var S = null;   // { kind: "ecg"|"eye", sid, cat }
  var EYE = null;   // the eye atlas manifest (/prep/imglearn/eye.json), once loaded
  function kxOn() { try { return !!(G.KARDIOX && G.KARDIOX.learnOn && G.KARDIOX.learnOn()); } catch (e) { return false; } }
  function ophOn() { try { return !!(G.OPHTHALMOS && G.OPHTHALMOS.open); } catch (e) { return false; } }

  // Subject screen: an atlas button in the actions block (under Practise) for ss-cardiology (ECG)
  // and ophthalmology (Eye).
  function subjectButton(box, sid, topics, host) {
    if (!box) return;
    if (sid === "ss-cardiology") {
      var n = ecgEntries().length;
      if (!n) return;
      if (box.querySelector('[data-act="il-ecg"]')) { box.hidden = false; return; }
      atlasBtn(box, sid, "il-ecg", "ECG atlas", n + " tracings");
    } else if (sid === "ophthalmology") {
      if (box.querySelector('[data-act="il-eye"]')) { box.hidden = false; return; }
      eyeManifest(host, function (m) {
        if (!m || !m.items || !m.items.length || !box.isConnected) return;
        if (box.querySelector('[data-act="il-eye"]')) { box.hidden = false; return; }
        atlasBtn(box, sid, "il-eye", "Eye atlas", m.items.length + " images");
      });
    }
  }
  function atlasBtn(box, sid, act, t, n) {
    var b = G.document.createElement("button");
    b.type = "button"; b.__pnKeep = 1; b.className = "pn-btn pn-sublearn"; b.setAttribute("data-act", act); b.setAttribute("data-s", sid);
    b.innerHTML = '<span class="pn-sl-t">' + t + '</span><span class="pn-sl-n">' + n + "</span>";
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
    S = { kind: "ecg", sid: sid, cat: cat || "" };
    host.push(function () { draw(host); });
  }

  /* ---------- eye atlas (Ophthalmos decks, curated in /prep/imglearn/eye.json) ---------- */
  function eyeManifest(host, cb) {
    if (EYE) return cb(EYE);
    host.getJSON("prep/imglearn/eye.json").then(function (m) { EYE = m; cb(m); }, function () { cb(null); });
  }
  function eyeImg(host, f) {
    var u = (host.bankApi || "/api/prep/bank/") + "img/maikimg/" + f;
    return u.charAt(0) === "/" && G.SMD_API_BASE ? G.SMD_API_BASE + u : u;
  }
  function eyeCats(items) {
    var out = [], at = {};
    (items || []).forEach(function (c) {
      var k = c.deck || "Other";
      if (at[k] == null) { at[k] = out.length; out.push({ name: k, n: 0 }); }
      out[at[k]].n++;
    });
    return out;
  }
  function eyeCard(c, i, esc, host) {
    var cred = (c.credit || "") + (c.licence ? " · " + c.licence : "");
    return '<article class="pn-il-card"><figure class="pn-il-fig"><img src="' + esc(eyeImg(host, c.img)) + '" alt="' + esc(c.dx || "Eye image") + '" loading="lazy" decoding="async">' +
      '<figcaption class="pn-mut"><small>' + esc(c.modality || "") + "</small></figcaption></figure>" +
      '<div class="pn-il-body"><h3>' + esc(c.dx || "") + "</h3>" +
      (c.finding ? '<p class="pn-il-find">' + esc(c.finding) + "</p>" : "") +
      (c.reason ? '<p class="pn-il-why">' + esc(c.reason) + "</p>" : "") +
      (cred ? '<button type="button" class="pn-chip pn-img-credit-chip" data-act="il-credit" data-i="' + i + '">' + esc(cred) + "</button>" : "") + "</div></article>";
  }
  function drawEye(host) {
    var esc = host.esc;
    eyeManifest(host, function (m) {
      var items = (m && m.items) || [];
      var cats = eyeCats(items);
      var cards = items.filter(function (c) { return !S.cat || c.deck === S.cat; });
      host.paint(host.bar("Eye atlas", "Ophthalmology", "back") + '<div class="pn-body pn-il">' +
        '<p class="pn-mut pn-small">Real clinical images from open datasets (OCT, fundus, disc, slit lamp, ultrasound), the same ground truth as the Ophthalmós clinics. ' +
        (ophOn() ? '<button type="button" class="pn-chip" data-act="il-oph">Open in Ophthalmós</button>' : "") + "</p>" +
        '<div class="pn-il-cats" role="group" aria-label="Filter by modality">' +
        '<button type="button" class="pn-chip' + (!S.cat ? " on" : "") + '" data-act="il-ecat" data-v="">All</button>' +
        cats.map(function (c) { return '<button type="button" class="pn-chip' + (S.cat === c.name ? " on" : "") + '" data-act="il-ecat" data-v="' + esc(c.name) + '">' + esc(c.name) + " (" + c.n + ")</button>"; }).join("") + "</div>" +
        '<div class="pn-il-grid">' + cards.map(function (c) { return eyeCard(c, items.indexOf(c), esc, host); }).join("") + "</div>" +
        '<button type="button" class="pn-btn pri" data-act="module" data-s="ophthalmology" data-m="oph-retinal-vascular">Practise image questions</button></div>');
    });
  }
  function openEye(sid, host, cat) {
    S = { kind: "eye", sid: sid, cat: cat || "" };
    host.push(function () { drawEye(host); });
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
    if (a === "il-eye") { openEye(el.getAttribute("data-s") || "ophthalmology", host, ""); return true; }
    if (a === "il-ecat") { if (S) { S.cat = el.getAttribute("data-v") || ""; drawEye(host); } return true; }
    if (a === "il-oph") {
      try { if (G.PREP && G.PREP.close) G.PREP.close(); } catch (e) {}
      try { if (G.OPHTHALMOS && G.OPHTHALMOS.open) G.OPHTHALMOS.open(); } catch (e) {}
      return true;
    }
    if (a === "il-credit") {
      var m = EYE && EYE.items, c = m && m[+el.getAttribute("data-i")];
      if (c && host.openCreditSheet) host.openCreditSheet({ title: c.dx, credit: c.credit, licence: c.licence, licenceUrl: c.licenceUrl, sourceUrl: c.sourceUrl });
      return true;
    }
  }

  G.PREP_IMGLEARN = { subjectButton: subjectButton, act: act, _pure: PURE };
})(typeof window !== "undefined" ? window : this);
