/* StewardMD - ResearchMD image de-identification (SMD_RESEARCH.screens.images).
 * ES5 only. Plan v2 item 2: pick an image, downscale so the longest side is at
 * most 2048 px, drag black boxes over identifiers, then re-encode as JPEG
 * (quality 0.9) through a canvas, so EXIF is gone and the boxes are burned in.
 * Nothing is uploaded. Saved as RMDStore kind "image" { label, data }.
 * CHECK on device: HEIC input and EXIF orientation on iOS.
 */
(function (G) {
  "use strict";

  var SMD = G.SMD_RESEARCH = G.SMD_RESEARCH || {};
  SMD.screens = SMD.screens || {};

  var MAX_SIDE = 2048;
  var CHECKS = ["Name", "Hospital number", "Dates", "Face", "Tattoos", "Hospital logo"];

  /* Pure: target size for the longest side cap. */
  function fitSize(w, h, max) {
    var m = max || MAX_SIDE, s = Math.max(w, h) > m ? m / Math.max(w, h) : 1;
    return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)), scale: s };
  }

  /* Pure: normalise a dragged rectangle to positive width and height inside the image. */
  function normRect(x0, y0, x1, y1, w, h) {
    var x = Math.max(0, Math.min(x0, x1)), y = Math.max(0, Math.min(y0, y1));
    var r = Math.min(w, Math.max(x0, x1)), b = Math.min(h, Math.max(y0, y1));
    return { x: x, y: y, w: Math.max(0, r - x), h: Math.max(0, b - y) };
  }

  var st = { list: [], img: null, boxes: [], label: "", notice: "", ticks: {} };

  function render(container) {
    var K = SMD.kit, proj = K.project();
    if (!proj) { K.noProject(container); return; }
    st.img = null; st.boxes = []; st.notice = ""; st.ticks = {};
    container.innerHTML = K.header("Images", "Loading...");
    G.RMDStore.list(proj.id, "image").then(function (rows) { st.list = rows || []; draw(container, proj); });
  }

  function draw(container, proj) {
    var K = SMD.kit, h = [], i;
    h.push(K.header("Images", "Hide anything that could identify the patient"));
    h.push('<div class="rmd-card"><p class="rmd-p">Images stay on this phone. The saved copy is a new picture, so hidden details cannot be recovered and camera details (EXIF) are removed.</p>');
    h.push('<input type="file" accept="image/*" class="rmd-mc-fileinput" data-rmd-img="pick"></div>');
    if (st.img) {
      h.push('<div class="rmd-card"><p class="rmd-mut">Drag across the picture to draw a black box. ' + st.boxes.length + ' box' + (st.boxes.length === 1 ? "" : "es") + ' drawn.</p>');
      h.push('<canvas data-rmd-img="canvas" style="max-width:100%;touch-action:none;border:1px solid #ccc"></canvas>');
      h.push('<div class="rmd-mc-actions"><button type="button" class="rmd-btn rmd-btn-subtle" data-rmd-img="undo">Undo last box</button></div>');
      h.push('<h3 class="rmd-card-heading">Check before saving</h3>');
      for (i = 0; i < CHECKS.length; i++) h.push(K.field({ name: "c" + i, type: "check", label: CHECKS[i] + " hidden or not shown", value: !!st.ticks["c" + i] }));
      h.push(K.field({ name: "label", label: "What the image shows", value: st.label, example: "ECG on Day 0" }));
      h.push('<button type="button" class="rmd-btn rmd-btn-primary" data-rmd-img="save">Save the de-identified image</button></div>');
    }
    if (st.notice) h.push('<p class="rmd-mut" role="status">' + K.esc(st.notice) + '</p>');
    if (st.list.length) {
      h.push('<div class="rmd-card"><h3 class="rmd-card-heading">Saved images</h3>');
      for (i = 0; i < st.list.length; i++) {
        var v = st.list[i].value || {};
        h.push('<div class="rmd-sub-card"><img alt="" src="' + K.esc(v.data || "") + '" style="max-width:120px;max-height:120px"> ' + K.esc(v.label || "Image " + st.list[i].id) +
          ' <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd-img-del="' + K.esc(st.list[i].id) + '">Delete</button></div>');
      }
      h.push('</div>');
    }
    container.innerHTML = '<div class="rmd-img-screen">' + h.join("") + '</div>';
    bind(container, proj);
  }

  function paint(cv) {
    var ctx = cv.getContext("2d"), i, b;
    ctx.drawImage(st.img, 0, 0, cv.width, cv.height);
    ctx.fillStyle = "#000000";
    for (i = 0; i < st.boxes.length; i++) { b = st.boxes[i]; ctx.fillRect(b.x, b.y, b.w, b.h); }
  }

  function bind(container, proj) {
    var K = SMD.kit, pick = container.querySelector('[data-rmd-img="pick"]'), cv = container.querySelector('[data-rmd-img="canvas"]');
    if (pick) pick.onchange = function () {
      var f = pick.files && pick.files[0];
      if (!f) return;
      var url = G.URL.createObjectURL(f), im = new G.Image();
      im.onload = function () { st.img = im; st.boxes = []; st.label = ""; st.notice = ""; draw(container, proj); };
      im.onerror = function () { st.notice = "This picture could not be opened. Try a JPEG or PNG."; draw(container, proj); };
      im.src = url;
    };
    if (cv && st.img) {
      var size = fitSize(st.img.naturalWidth || st.img.width, st.img.naturalHeight || st.img.height);
      cv.width = size.w; cv.height = size.h;
      paint(cv);
      var start = null;
      var pos = function (e) {
        var r = cv.getBoundingClientRect(), sx = cv.width / (r.width || cv.width), sy = cv.height / (r.height || cv.height);
        return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
      };
      cv.onpointerdown = function (e) { start = pos(e); if (cv.setPointerCapture) cv.setPointerCapture(e.pointerId); };
      cv.onpointermove = function (e) {
        if (!start) return;
        var p = pos(e), r = normRect(start.x, start.y, p.x, p.y, cv.width, cv.height), ctx = cv.getContext("2d");
        paint(cv); ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(r.x, r.y, r.w, r.h);
      };
      cv.onpointerup = function (e) {
        if (!start) return;
        var p = pos(e), r = normRect(start.x, start.y, p.x, p.y, cv.width, cv.height);
        start = null;
        if (r.w > 3 && r.h > 3) st.boxes.push(r);
        keepTicks(container);
        draw(container, proj);
      };
    }
    var undo = container.querySelector('[data-rmd-img="undo"]');
    if (undo) undo.onclick = function () { st.boxes.pop(); keepTicks(container); draw(container, proj); };
    var save = container.querySelector('[data-rmd-img="save"]');
    if (save) save.onclick = function () {
      keepTicks(container);
      var data;
      try { paint(cv); data = cv.toDataURL("image/jpeg", 0.9); } catch (e) { data = ""; }
      if (!data) { st.notice = "This phone could not save the picture."; draw(container, proj); return; }
      var next = 1, i;
      for (i = 0; i < st.list.length; i++) next = Math.max(next, (parseInt(st.list[i].id, 10) || 0) + 1);
      K.save(proj.id, "image", String(next), { label: st.label || "Image " + next, data: data, boxes: st.boxes.length, checked: st.ticks }).then(function () {
        st.img = null; st.boxes = []; st.notice = "Saved. The original picture was not changed or uploaded.";
        return G.RMDStore.list(proj.id, "image");
      }).then(function (rows) { st.list = rows || []; draw(container, proj); });
    };
    var dels = container.querySelectorAll("[data-rmd-img-del]");
    for (var d = 0; d < dels.length; d++) {
      dels[d].onclick = function () {
        var id = this.getAttribute("data-rmd-img-del");
        G.RMDStore.remove(proj.id, "image", id).then(function () { return G.RMDStore.list(proj.id, "image"); })
          .then(function (rows) { st.list = rows || []; draw(container, proj); });
      };
    }
  }

  function keepTicks(container) {
    var o = SMD.kit.read(container, {}), i;
    for (i = 0; i < CHECKS.length; i++) st.ticks["c" + i] = !!o["c" + i];
    if (o.label != null) st.label = o.label;
  }

  SMD.screens.images = { render: render, fitSize: fitSize, normRect: normRect, CHECKS: CHECKS, MAX_SIDE: MAX_SIDE };

})(typeof window !== "undefined" ? window : globalThis);
