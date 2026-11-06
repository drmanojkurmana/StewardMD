/* image-zoom.js: every image in the app opens full screen on a tap, and every opened image can be reported.
 * Owner 2026-11-05: "every image should be zoomable on click and a report button to report corrections or copyright or
 * add correct image so admin will check and approve".
 *
 * A tap on a content image (not an icon, not an image inside a button or link, not one a module already opens itself)
 * opens the one app viewer (prep-viewer.js, PREP_VIEWER: pinch, double tap, swipe down to close; styles in
 * image-viewer.css). Its top bar has "Report": the doctor picks a reason (something in it is wrong, a copyright concern,
 * a better image), may add a note and attach a better image, and it goes to /api/support {action:"image"} as a ticket
 * of kind "image". The owner sees the image, the attachment and where it was seen in the admin console (Support) and
 * approves or declines; the doctor is told in Help & Support. Changing the image itself stays a content edit.
 *
 * window.SMD_IMGZOOM = { open(img), report(info), enabled() }. report({src,title,where}) is also used by the Image
 * Library viewer. Flag smd_img_zoom, default ON: localStorage "0" or ?imgzoom=0 turns tap-to-zoom off (reporting from
 * the Image Library stays). ES5, no dependencies. No PHI is sent: the image address, its title and the screen name. */
(function (G) {
  "use strict";
  var D = G.document;
  var MIN_W = 110, MIN_H = 80;   // smaller than this is an icon or a thumbnail strip, not something to read
  var SKIP = "a[href],button,[role=button],[role=link],[data-act],[data-igl],[data-pv],label,summary,select,[contenteditable=true],.pv,.igl-overlay,.izr,[data-nozoom],.no-zoom";

  function enabled() {
    try {
      var q = (G.location.search.match(/[?&]imgzoom=([^&]+)/) || [])[1];
      if (q === "0" || q === "off") G.localStorage.setItem("smd_img_zoom", "0");
      if (q === "1" || q === "on") G.localStorage.removeItem("smd_img_zoom");
      return G.localStorage.getItem("smd_img_zoom") !== "0";
    } catch (e) { return true; }
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function clean(s, n) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n || 200); }

  /* Pure: is this image something to open? (unit tested with plain objects) */
  function qualifies(img) {
    if (!img || img.tagName !== "IMG") return false;
    if (!(img.currentSrc || img.src)) return false;
    var cls = String(img.className || "") + " " + String(img.id || "");
    if (/icon|logo|avatar|badge|emoji|flag|sprite|spinner|orb|glyph/i.test(cls)) return false;
    var r = img.getBoundingClientRect ? img.getBoundingClientRect() : { width: img.width, height: img.height };
    if (r.width < MIN_W || r.height < MIN_H) return false;
    if (img.closest && img.closest(SKIP)) return false;
    return true;
  }

  /* The image's own words: figure caption, then alt, then title. */
  function captionOf(img) {
    var fig = img.closest && img.closest("figure");
    var cap = fig && fig.querySelector("figcaption,.kbr-cap");
    return clean((cap && cap.textContent) || img.alt || img.title || "", 200);
  }
  /* Where it was seen: the nearest heading of the screen or dialog it sits in (a disease, lesson or module name). */
  function whereOf(img) {
    // the nearest box that has a visible heading; an overlay can hold hidden screens with their own headings
    for (var box = img.parentElement; box; box = box.parentElement) {
      var hs = box.querySelectorAll(".dx-mgmt-name,h1,h2");
      for (var i = 0; i < hs.length; i++) if (hs[i].getClientRects().length && clean(hs[i].textContent)) return clean(hs[i].textContent, 120);
    }
    return "";
  }
  /* An address the server and the console can use: the app's own files as a path, web images as https. */
  function addressOf(src) {
    src = String(src || "");
    if (/^data:|^blob:/.test(src)) return "/inline-image";
    try {
      var u = new URL(src, G.location.href);
      if (u.origin === G.location.origin || /^(capacitor|ionic):|localhost$/.test(u.protocol + u.hostname)) return u.pathname + u.search;
      return u.protocol === "https:" ? u.href : "";
    } catch (e) { return ""; }
  }

  var viewerP = null;
  function viewer() {
    if (G.PREP_VIEWER && G.PREP_VIEWER.open) return Promise.resolve(G.PREP_VIEWER);
    if (viewerP) return viewerP;
    viewerP = new Promise(function (res, rej) {
      var s = D.createElement("script"); s.src = "/prep-viewer.js?v=pv-wm1"; s.defer = true;
      s.onload = function () { G.PREP_VIEWER ? res(G.PREP_VIEWER) : rej(new Error("no viewer")); };
      s.onerror = function () { viewerP = null; rej(new Error("viewer did not load")); };
      D.head.appendChild(s);
    });
    return viewerP;
  }

  function open(img) {
    var src = img.currentSrc || img.src, cap = captionOf(img);
    var info = { src: addressOf(src), title: cap, where: whereOf(img) };
    return viewer().then(function (V) {
      return V.open({ src: src, alt: img.alt || cap, caption: cap, from: img, onReport: function () { report(info); } });
    }, function () { return false; });
  }

  /* Modules that already open their images (PrepNucleus, Ophthalmós, the Image Library) handle the tap themselves:
   * after the tap settles, open only if no viewer or dialog appeared. */
  function dialogs() { return D.querySelectorAll(".pv,[aria-modal=true]:not([hidden])").length; }
  function onTap(e) {
    if (!enabled() || e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey) return;
    var img = e.target;
    if (!qualifies(img)) return;
    var before = dialogs();
    G.setTimeout(function () { if (dialogs() > before) return; if (img.isConnected) open(img); }, 0);
  }

  /* ---------- report form ---------- */
  var REASONS = [["correction", "Something in it is wrong"], ["copyright", "Copyright concern"], ["better", "I have a better image"]];
  var sheet = null;
  function report(info) {
    info = info || {};
    if (sheet) close();
    sheet = D.createElement("div");
    sheet.className = "izr"; sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-modal", "true"); sheet.setAttribute("aria-labelledby", "izrH");
    sheet.innerHTML = '<div class="izr-scrim" data-izr="cancel"></div><form class="izr-card" novalidate>' +
      '<h2 id="izrH">Report this image</h2>' +
      (info.title ? '<p class="izr-sub">' + esc(info.title) + '</p>' : "") +
      '<fieldset class="izr-reasons"><legend>What is the problem?</legend>' + REASONS.map(function (r, i) {
        return '<label class="izr-r"><input type="radio" name="izrR" value="' + r[0] + '"' + (i === 0 ? " checked" : "") + '><span>' + r[1] + "</span></label>";
      }).join("") + "</fieldset>" +
      '<label class="izr-l" for="izrT">Details</label><textarea id="izrT" maxlength="1500" rows="3" placeholder="What is wrong, who owns it, or what the better image shows"></textarea>' +
      '<label class="izr-file"><input type="file" accept="image/*" id="izrF"><span>Attach a better image (optional)</span></label>' +
      '<p class="izr-fname" id="izrN" hidden></p>' +
      '<p class="izr-note">Do not attach anything that shows a patient. An admin checks every report before anything changes.</p>' +
      '<p class="izr-msg" id="izrM" role="status"></p>' +
      '<div class="izr-acts"><button type="button" class="izr-b" data-izr="cancel">Cancel</button><button type="submit" class="izr-b izr-send">Send report</button></div></form>';
    D.body.appendChild(sheet);
    var card = sheet.querySelector(".izr-card"), shot = "";
    sheet.addEventListener("click", function (e) { var a = e.target.closest && e.target.closest("[data-izr]"); if (a && a.getAttribute("data-izr") === "cancel") close(); });
    sheet.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.stopPropagation(); close(); } });
    sheet.querySelector("#izrF").addEventListener("change", function (e) {
      var f = e.target.files && e.target.files[0], n = sheet.querySelector("#izrN");
      if (!f) { shot = ""; n.hidden = true; return; }
      n.hidden = false; n.textContent = "Preparing " + f.name + "...";
      shrink(f).then(function (d) { shot = d; n.textContent = "Attached: " + f.name; }, function () { shot = ""; n.textContent = "That file could not be read. Try a JPEG or PNG."; });
    });
    card.addEventListener("submit", function (e) {
      e.preventDefault();
      var reason = (card.querySelector("input[name=izrR]:checked") || {}).value || "correction";
      var text = clean(card.querySelector("#izrT").value, 1500), msg = sheet.querySelector("#izrM"), btn = card.querySelector(".izr-send");
      if (reason === "better" && !shot && !text) { msg.textContent = "Attach the better image or describe it."; return; }
      btn.disabled = true; msg.textContent = "Sending...";
      send({ action: "image", image: { src: info.src || "/inline-image", title: info.title || "", where: info.where || "", route: clean(G.location.hash, 200), reason: reason }, text: text, shot: shot || undefined })
        .then(function (r) {
          if (r && r.ok) { msg.textContent = "Sent. You will see the admin's answer in Help & Support (" + ((r.ticket && r.ticket.id) || "") + ")."; G.setTimeout(close, 1800); return; }
          btn.disabled = false;
          msg.textContent = r && r.error === "sign-in-required" ? "Sign in to send a report." : r && r.error === "too-many" ? "You have sent many reports today. Try again tomorrow." : "It did not send. Try again.";
        }, function () { btn.disabled = false; msg.textContent = "Couldn't reach StewardMD. Check your connection and try again."; });
    });
    try { sheet.querySelector("input[name=izrR]").focus({ preventScroll: true }); } catch (e) {}
    return true;
  }
  function close() { if (sheet && sheet.parentNode) sheet.parentNode.removeChild(sheet); sheet = null; }

  function send(body) {
    var u = null; try { u = G.SMD_AUTH && G.SMD_AUTH.currentUser; } catch (e) {}
    if (!u || typeof u.getIdToken !== "function") return Promise.resolve({ ok: false, error: "sign-in-required" });
    try { var c = G.Capacitor; body.platform = (c && (c.getPlatform ? c.getPlatform() : c.platform)) || "web"; } catch (e) {}
    return u.getIdToken().then(function (tok) {
      return fetch("/api/support", { method: "POST", headers: { "Authorization": "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    }).then(function (r) { return r.json().catch(function () { return { ok: false }; }); });
  }
  /* A photo from the phone is several MB: scale it to 1600 px on the long side and JPEG it so it fits the server cap. */
  function shrink(file) {
    return new Promise(function (res, rej) {
      if (!/^image\//.test(file.type || "")) return rej(new Error("type"));
      var url = URL.createObjectURL(file), im = new Image();
      im.onload = function () {
        try {
          var k = Math.min(1, 1600 / Math.max(im.naturalWidth, im.naturalHeight)), c = D.createElement("canvas");
          c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
          c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
          var q = 0.85, d = c.toDataURL("image/jpeg", q);
          while (d.length > 880 * 1024 && q > 0.4) { q -= 0.15; d = c.toDataURL("image/jpeg", q); }
          URL.revokeObjectURL(url); res(d);
        } catch (e) { URL.revokeObjectURL(url); rej(e); }
      };
      im.onerror = function () { URL.revokeObjectURL(url); rej(new Error("decode")); };
      im.src = url;
    });
  }

  var api = { open: open, report: report, enabled: enabled, _qualifies: qualifies, _addressOf: addressOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  G.SMD_IMGZOOM = api;
  if (D && D.addEventListener) D.addEventListener("click", onTap);
})(typeof window !== "undefined" ? window : globalThis);
