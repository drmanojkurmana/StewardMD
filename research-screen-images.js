/* StewardMD - ResearchMD de-identify images screen.
 * ES5 IIFE. Registers SMD.screens.images. Plan item 2.
 * Downscale longest side to 2048 px, draw black boxes, pinch to zoom, then burn
 * the boxes in and re-encode as a fresh JPEG (quality 0.9) so EXIF is gone.
 * Saved as a base64 data URL string, never a Blob. RMDStore kind image.
 * Nothing is uploaded. No em or en dashes.
 */
(function (G) {
  "use strict";
  var SMD = G.SMD_RESEARCH = G.SMD_RESEARCH || {};
  SMD.screens = SMD.screens || {};
  var KEY = "images";
  var MAX_SIDE = 2048;
  var CHECK_ITEMS = [
    { key: "name", label: "Patient name" },
    { key: "hospital", label: "Hospital number" },
    { key: "dates", label: "Dates" },
    { key: "face", label: "Face" },
    { key: "tattoos", label: "Tattoos" },
    { key: "logo", label: "Hospital logo" }
  ];

  function esc(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function labelFor(name) {
    var C = G.SMD_RESEARCH_CONTRACTS;
    if (C && C.STEP_LABELS && C.STEP_LABELS[name]) return C.STEP_LABELS[name];
    return name;
  }

  /* Pure: fit within a square of side max, never upscale. */
  function fitSize(w, h, max) {
    if (!(w > 0) || !(h > 0) || !(max > 0)) return { width: 0, height: 0 };
    var m = Math.max(w, h);
    if (m <= max) return { width: Math.round(w), height: Math.round(h) };
    var s = max / m;
    return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
  }

  function normRect(d) {
    var x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1);
    return { x: x, y: y, w: Math.abs(d.x1 - d.x0), h: Math.abs(d.y1 - d.y0) };
  }

  var st = null;
  var editor = null;
  var drag = null;
  var moveDrag = null;
  var pointers = {};
  var pinchDist = 0;
  var idCounter = 0;

  function freshState(pid) {
    return { pid: pid, container: null, saved: [], loading: true, error: null, notice: "", mode: "draw" };
  }

  function newId() {
    idCounter++;
    return "img_" + Date.now() + "_" + idCounter;
  }

  function injectCss() {
    var D = G.document;
    if (!D || D.getElementById("rmdImagesCss")) return;
    var s = D.createElement("style");
    s.id = "rmdImagesCss";
    s.textContent = [
      "#researchMD .rmd-img-stage { overflow: auto; max-height: 60vh; border: 1px solid var(--rmd-line); border-radius: 12px; background: var(--rmd-bg); touch-action: none; }",
      "#researchMD .rmd-img-canvas { display: block; margin: 0 auto; touch-action: none; user-select: none; -webkit-user-select: none; cursor: crosshair; }",
      "#researchMD .rmd-img-toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0; }",
      "#researchMD .rmd-img-tool { min-height: 44px; min-width: 44px; padding: 8px 12px; border-radius: 10px; border: 1px solid var(--rmd-line); background: var(--rmd-panel); color: var(--rmd-ink); font: 600 13.5px var(--rmd-f); cursor: pointer; }",
      "#researchMD .rmd-img-tool-active { border-color: var(--rmd-acc); background: var(--rmd-acc-soft); color: var(--rmd-acc); }",
      "#researchMD .rmd-img-check { list-style: none; margin: 8px 0 0; padding: 0; }",
      "#researchMD .rmd-img-check li { display: flex; gap: 10px; align-items: flex-start; padding: 10px 0; border-top: 1px solid var(--rmd-line); min-height: 44px; }",
      "#researchMD .rmd-img-check li:first-child { border-top: 0; }",
      "#researchMD .rmd-img-check input[type=checkbox] { width: 22px; height: 22px; margin-top: 2px; flex: 0 0 auto; accent-color: var(--rmd-acc); }",
      "#researchMD .rmd-img-check label { font: 400 14px/1.4 var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-img-thumbs { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; margin-top: 10px; }",
      "#researchMD .rmd-img-thumb { border: 1px solid var(--rmd-line); border-radius: 12px; overflow: hidden; background: var(--rmd-panel); }",
      "#researchMD .rmd-img-thumb img { display: block; width: 100%; height: 96px; object-fit: cover; }",
      "#researchMD .rmd-img-thumbbody { padding: 8px; }",
      "#researchMD .rmd-img-thumbname { font: 600 12.5px/1.3 var(--rmd-f); color: var(--rmd-ink); word-break: break-word; }",
      "#researchMD .rmd-img-thumbmeta { font: 400 11.5px var(--rmd-f); color: var(--rmd-mut); margin-top: 2px; }",
      "#researchMD .rmd-img-thumbactions { display: flex; gap: 6px; margin-top: 6px; }",
      /* Shared base only forces 44px targets at iPad width; scope phone fixes here. */
      "#researchMD .rmd-images-screen .rmd-btn, #researchMD .rmd-images-screen label.rmd-btn { min-height: 44px; }",
      "#researchMD .rmd-images-screen input[type=text], #researchMD .rmd-images-screen select, #researchMD .rmd-images-screen textarea { min-height: 44px; }",
      "#researchMD .rmd-images-screen .rmd-img-tool { min-height: 44px; }"
    ].join("\n");
    D.head.appendChild(s);
  }

  function stepBannerHtml() {
    var proj = SMD.store && SMD.store.getActiveProject ? SMD.store.getActiveProject() : null;
    var journey = SMD.journeyFor ? SMD.journeyFor(proj) : [];
    var idx = -1, i;
    for (i = 0; i < journey.length; i++) if (journey[i] === KEY) idx = i;
    var nextName = (idx >= 0 && idx + 1 < journey.length) ? journey[idx + 1] : "";
    var stepNo = idx >= 0 ? idx + 1 : 1;
    var stepCount = journey.length || 1;
    var nextLabel = nextName ? labelFor(nextName) : "continue when this step is ready";
    var h = '<div class="rmd-step-banner" role="status">';
    h += '<div class="rmd-step-line"><span class="rmd-step-text"><strong>Step ' + stepNo + ' of ' + stepCount + '</strong> ' + esc(labelFor(KEY)) + '</span></div>';
    h += '</div>';
    h += '<p class="rmd-next-line">Next: ' + esc(nextLabel) + '</p>';
    return h;
  }

  function allChecked() {
    if (!editor) return false;
    for (var i = 0; i < CHECK_ITEMS.length; i++) if (!editor.checklist[CHECK_ITEMS[i].key]) return false;
    return true;
  }

  function editorHtml() {
    var h = [], i, item;
    h.push('<div class="rmd-card">');
    h.push('<h3>De-identify this image</h3>');
    h.push('<p class="rmd-muted">Drag on the image to draw a black box over anything that could identify the patient. Pinch or use the zoom buttons to get close. The box is burned into the saved image.</p>');
    h.push('<div class="rmd-img-toolbar" role="toolbar" aria-label="Image tools">');
    h.push('<button type="button" class="rmd-img-tool' + (st.mode === "draw" ? " rmd-img-tool-active" : "") + '" data-rmd-img-mode="draw" aria-pressed="' + (st.mode === "draw") + '">Black box</button>');
    h.push('<button type="button" class="rmd-img-tool' + (st.mode === "move" ? " rmd-img-tool-active" : "") + '" data-rmd-img-mode="move" aria-pressed="' + (st.mode === "move") + '">Move</button>');
    h.push('<button type="button" class="rmd-img-tool" data-rmd-img="zoomin" aria-label="Zoom in">Zoom in</button>');
    h.push('<button type="button" class="rmd-img-tool" data-rmd-img="zoomout" aria-label="Zoom out">Zoom out</button>');
    h.push('<button type="button" class="rmd-img-tool" data-rmd-img="zoomreset">Reset zoom</button>');
    h.push('<button type="button" class="rmd-img-tool" data-rmd-img="undo">Undo box</button>');
    h.push('</div>');
    h.push('<div class="rmd-img-stage" id="rmdImgStage"><canvas id="rmdImgCanvas" class="rmd-img-canvas" width="' + editor.width + '" height="' + editor.height + '" aria-label="Image being de-identified"></canvas></div>');
    h.push('<p class="rmd-muted">' + editor.boxes.length + ' black box' + (editor.boxes.length === 1 ? "" : "es") + ' drawn. ' + editor.width + ' by ' + editor.height + ' pixels.</p>');
    h.push('<div class="rmd-field"><label for="rmdImgName">Image label (no patient name)</label>');
    h.push('<input type="text" id="rmdImgName" value="' + esc(editor.name) + '" autocomplete="off" placeholder="e.g. ECG on admission"></div>');
    h.push('<h4>Before you save, tick each item you have covered or confirmed is not in the image</h4>');
    h.push('<ul class="rmd-img-check">');
    for (i = 0; i < CHECK_ITEMS.length; i++) {
      item = CHECK_ITEMS[i];
      h.push('<li><input type="checkbox" id="rmdImgChk' + i + '" data-rmd-img-check="' + item.key + '"' + (editor.checklist[item.key] ? " checked" : "") + '><label for="rmdImgChk' + i + '">' + esc(item.label) + '</label></li>');
    }
    h.push('</ul>');
    h.push('<div class="rmd-modal-footer">');
    h.push('<button type="button" class="rmd-btn rmd-btn-subtle" data-rmd-img="cancel">Cancel</button>');
    h.push('<button type="button" class="rmd-btn rmd-btn-primary" data-rmd-img="save"' + (allChecked() ? "" : " disabled") + '>Burn in and save</button>');
    h.push('</div>');
    h.push('<p class="rmd-muted">Images stay on this phone and are never uploaded. Saving re-encodes a fresh JPEG, which removes camera location and device tags (EXIF).</p>');
    h.push('</div>');
    return h.join("");
  }

  function savedHtml() {
    var h = [], i, rec, v;
    h.push('<div class="rmd-card">');
    h.push('<h3>Images</h3>');
    h.push('<p class="rmd-muted">Add a clinical image, cover anything identifying, and save a de-identified copy. Everything stays on this phone.</p>');
    h.push('<label class="rmd-btn rmd-btn-primary" for="rmdImgFile" style="display:inline-block;cursor:pointer;">Add an image</label>');
    h.push('<input type="file" id="rmdImgFile" accept="image/*" style="position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;">');
    if (st.saved.length) {
      h.push('<div class="rmd-img-thumbs">');
      for (i = 0; i < st.saved.length; i++) {
        rec = st.saved[i];
        v = rec.value || {};
        h.push('<div class="rmd-img-thumb">');
        if (v.dataUrl) h.push('<img src="' + esc(v.dataUrl) + '" alt="' + esc(v.name || "De-identified image") + '">');
        h.push('<div class="rmd-img-thumbbody">');
        h.push('<div class="rmd-img-thumbname">' + esc(v.name || "Image") + '</div>');
        h.push('<div class="rmd-img-thumbmeta">' + (v.width || 0) + ' by ' + (v.height || 0) + (v.redacted ? " · de-identified" : "") + '</div>');
        h.push('<div class="rmd-img-thumbactions">');
        h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd-img-open="' + esc(rec.id) + '">Open</button>');
        h.push('<button type="button" class="rmd-btn rmd-btn-quiet rmd-btn-sm" data-rmd-img-del="' + esc(rec.id) + '">Delete</button>');
        h.push('</div></div></div>');
      }
      h.push('</div>');
    } else {
      h.push('<p class="rmd-muted">No images saved yet.</p>');
    }
    h.push('</div>');
    return h;
  }

  function draw() {
    if (!st || !st.container) return;
    var h = [];
    h.push('<div class="rmd-p2-screen rmd-' + KEY + '-screen">');
    h.push(stepBannerHtml());
    if (st.notice) h.push('<div class="rmd-banner rmd-banner-info" role="status">' + esc(st.notice) + '</div>');
    if (st.error) h.push('<div class="rmd-card">' + (SMD.p2 ? SMD.p2.errHtml(st.error) : '<div class="rmd-banner rmd-banner-error" role="alert">' + esc(st.error.message) + '</div>') + '</div>');
    if (st.loading) {
      h.push('<div class="rmd-card">' + (SMD.p2 ? SMD.p2.loadingHtml("Opening images") : "Loading") + '</div>');
    } else {
      if (editor) h.push(editorHtml());
      h.push(savedHtml());
    }
    h.push('</div>');
    st.container.innerHTML = h.join("");
    bind();
    layout();
    paint();
  }

  function layout() {
    if (!editor || !st.container) return;
    var cv = st.container.querySelector("#rmdImgCanvas");
    var stage = st.container.querySelector("#rmdImgStage");
    if (!cv || !stage || !editor.width) return;
    var avail = stage.clientWidth || 320;
    var baseW = Math.min(avail, editor.width);
    var w = baseW * editor.zoom;
    var hgt = w * (editor.height / editor.width);
    cv.style.width = w + "px";
    cv.style.height = hgt + "px";
  }

  function paint() {
    if (!editor || !st.container) return;
    var cv = st.container.querySelector("#rmdImgCanvas");
    if (!cv) return;
    var ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(editor.baseCanvas, 0, 0);
    ctx.fillStyle = "#000";
    var i, b;
    for (i = 0; i < editor.boxes.length; i++) {
      b = editor.boxes[i];
      ctx.fillRect(b.x, b.y, b.w, b.h);
    }
    if (drag) {
      var r = normRect(drag);
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
  }

  function toImageCoords(clientX, clientY) {
    var cv = st.container.querySelector("#rmdImgCanvas");
    var rect = cv.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left) / rect.width * editor.width,
      y: (clientY - rect.top) / rect.height * editor.height
    };
  }

  function setZoom(z) {
    editor.zoom = Math.max(1, Math.min(8, z));
    layout();
  }

  function openImage(dataUrl, name, id) {
    if (!st) return;
    var img = new Image();
    img.onload = function () {
      var fit = fitSize(img.naturalWidth, img.naturalHeight, MAX_SIDE);
      if (!fit.width || !fit.height) {
        st.error = { message: "This image has no readable size." };
        draw();
        return;
      }
      var base = G.document.createElement("canvas");
      base.width = fit.width;
      base.height = fit.height;
      base.getContext("2d").drawImage(img, 0, 0, fit.width, fit.height);
      var checklist = {}, i;
      for (i = 0; i < CHECK_ITEMS.length; i++) checklist[CHECK_ITEMS[i].key] = false;
      editor = {
        id: id || newId(), baseCanvas: base, width: fit.width, height: fit.height,
        boxes: [], name: name || "Image", zoom: 1, checklist: checklist
      };
      st.error = null;
      st.mode = "draw";
      draw();
    };
    img.onerror = function () {
      st.error = { message: "This image could not be opened on this phone. Try a JPEG or PNG." };
      draw();
    };
    img.src = dataUrl;
  }

  function addBox(box) {
    if (!editor || !box) return;
    var x = Math.max(0, Number(box.x) || 0);
    var y = Math.max(0, Number(box.y) || 0);
    var w = Math.max(0, Number(box.w) || 0);
    var h = Math.max(0, Number(box.h) || 0);
    if (w <= 0 || h <= 0) return;
    editor.boxes.push({ x: x, y: y, w: w, h: h });
    paint();
  }

  function setCheck(key, val) {
    if (!editor) return;
    editor.checklist[key] = !!val;
  }

  /* Burn the boxes in and re-encode as a fresh JPEG. Returns a data URL string. */
  function exportJpeg() {
    if (!editor) return "";
    var c = G.document.createElement("canvas");
    c.width = editor.width;
    c.height = editor.height;
    var ctx = c.getContext("2d");
    ctx.drawImage(editor.baseCanvas, 0, 0);
    ctx.fillStyle = "#000";
    for (var i = 0; i < editor.boxes.length; i++) {
      var b = editor.boxes[i];
      ctx.fillRect(b.x, b.y, b.w, b.h);
    }
    return c.toDataURL("image/jpeg", 0.9);
  }

  function saveImage() {
    var store = G.RMDStore;
    if (!editor || !store) return Promise.resolve();
    if (!allChecked()) return Promise.resolve();
    var nameInput = st.container && st.container.querySelector("#rmdImgName");
    if (nameInput) editor.name = nameInput.value;
    var dataUrl = exportJpeg();
    var value = { dataUrl: dataUrl, width: editor.width, height: editor.height, name: editor.name, redacted: true };
    var id = editor.id;
    return store.put(st.pid, "image", id, value).then(function (res) {
      if (res && res.ok === false) {
        st.error = { message: (res.warnings && res.warnings[0]) || "Could not save the image on this phone." };
        draw();
        return;
      }
      editor = null;
      st.notice = "Saved on this phone. Nothing was uploaded.";
      return loadSaved();
    }).catch(function () {
      st.error = { message: "Could not save the image on this phone. Try again." };
      draw();
    });
  }

  function loadSaved() {
    var store = G.RMDStore;
    if (!store || !store.list) {
      st.saved = [];
      st.loading = false;
      draw();
      return Promise.resolve();
    }
    return store.list(st.pid, "image").then(function (recs) {
      st.saved = recs || [];
      st.loading = false;
      draw();
    }).catch(function () {
      st.saved = [];
      st.loading = false;
      st.error = { message: "Could not open the saved images on this phone." };
      draw();
    });
  }

  function onFile(input) {
    var file = input.files && input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      openImage(String(reader.result), file.name, null);
    };
    reader.onerror = function () {
      st.error = { message: "This file could not be read on this phone." };
      draw();
    };
    reader.readAsDataURL(file);
  }

  function bind() {
    var c = st.container, i, els;
    var file = c.querySelector("#rmdImgFile");
    if (file) file.onchange = function () { onFile(this); };

    els = c.querySelectorAll("[data-rmd-img-check]");
    for (i = 0; i < els.length; i++) {
      els[i].onchange = function () {
        setCheck(this.getAttribute("data-rmd-img-check"), this.checked);
        var saveBtn = c.querySelector('[data-rmd-img="save"]');
        if (saveBtn) {
          if (allChecked()) saveBtn.removeAttribute("disabled");
          else saveBtn.setAttribute("disabled", "disabled");
        }
      };
    }

    var nameInput = c.querySelector("#rmdImgName");
    if (nameInput) nameInput.oninput = function () { if (editor) editor.name = this.value; };

    var cv = c.querySelector("#rmdImgCanvas");
    var stage = c.querySelector("#rmdImgStage");
    if (cv && stage && editor) bindPointer(cv, stage);

    c.onclick = function (ev) {
      var el = ev.target, attr;
      while (el && el !== c) {
        if (el.getAttribute) {
          attr = el.getAttribute("data-rmd-img-mode");
          if (attr) { st.mode = attr; draw(); return; }
          attr = el.getAttribute("data-rmd-img");
          if (attr) { handleTool(attr); return; }
          attr = el.getAttribute("data-rmd-img-open");
          if (attr != null && attr !== "") { openSaved(attr); return; }
          attr = el.getAttribute("data-rmd-img-del");
          if (attr != null && attr !== "") { deleteSaved(attr); return; }
        }
        el = el.parentNode;
      }
    };
  }

  function bindPointer(cv, stage) {
    cv.onpointerdown = function (ev) {
      if (!editor) return;
      pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      var ids = Object.keys(pointers);
      if (ids.length === 2) {
        pinchDist = dist(pointers[ids[0]], pointers[ids[1]]);
        drag = null;
        moveDrag = null;
        return;
      }
      if (cv.setPointerCapture) { try { cv.setPointerCapture(ev.pointerId); } catch (e) {} }
      if (st.mode === "draw") {
        var p = toImageCoords(ev.clientX, ev.clientY);
        drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      } else {
        moveDrag = { x: ev.clientX, y: ev.clientY, sl: stage.scrollLeft, st: stage.scrollTop };
      }
      ev.preventDefault();
    };
    cv.onpointermove = function (ev) {
      if (!editor || !pointers[ev.pointerId]) return;
      pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      var ids = Object.keys(pointers);
      if (ids.length === 2) {
        var d = dist(pointers[ids[0]], pointers[ids[1]]);
        if (pinchDist > 0 && d > 0) setZoom(editor.zoom * (d / pinchDist));
        pinchDist = d;
        return;
      }
      if (drag) {
        var p = toImageCoords(ev.clientX, ev.clientY);
        drag.x1 = p.x;
        drag.y1 = p.y;
        paint();
      } else if (moveDrag) {
        stage.scrollLeft = moveDrag.sl - (ev.clientX - moveDrag.x);
        stage.scrollTop = moveDrag.st - (ev.clientY - moveDrag.y);
      }
    };
    function endPointer(ev) {
      if (!editor) return;
      delete pointers[ev.pointerId];
      if (Object.keys(pointers).length < 2) pinchDist = 0;
      if (drag) {
        var r = normRect(drag);
        if (r.w >= 2 && r.h >= 2) editor.boxes.push(r);
        drag = null;
        paint();
      }
      moveDrag = null;
    }
    cv.onpointerup = endPointer;
    cv.onpointercancel = endPointer;
  }

  function dist(a, b) {
    var dx = a.x - b.x, dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function handleTool(action) {
    if (!editor && action !== "cancel") return;
    if (action === "zoomin") { setZoom(editor.zoom * 1.25); return; }
    if (action === "zoomout") { setZoom(editor.zoom / 1.25); return; }
    if (action === "zoomreset") { setZoom(1); return; }
    if (action === "undo") { editor.boxes.pop(); paint(); return; }
    if (action === "cancel") { editor = null; st.notice = ""; draw(); return; }
    if (action === "save") { saveImage(); return; }
  }

  function openSaved(id) {
    for (var i = 0; i < st.saved.length; i++) {
      if (st.saved[i].id === id) {
        var v = st.saved[i].value || {};
        if (v.dataUrl) openImage(v.dataUrl, v.name, id);
        return;
      }
    }
  }

  function deleteSaved(id) {
    var store = G.RMDStore;
    if (!store) return;
    if (G.confirm && !G.confirm("Delete this de-identified image from this phone?")) return;
    store.remove(st.pid, "image", id).then(function () {
      return loadSaved();
    }).catch(function () {
      st.error = { message: "Could not delete the image on this phone." };
      draw();
    });
  }

  function render(container, params) {
    if (!container) return;
    var proj = SMD.store && SMD.store.getActiveProject ? SMD.store.getActiveProject() : null;
    var pid = (params && params.projectId) || (proj && proj.id) || "local";
    st = freshState(pid);
    st.container = container;
    editor = null;
    drag = null;
    pointers = {};
    injectCss();
    draw();
    loadSaved();
  }

  SMD.screens[KEY] = {
    render: render,
    openImage: openImage,
    addBox: addBox,
    setCheck: setCheck,
    exportJpeg: exportJpeg,
    saveImage: saveImage,
    getEditor: function () { return editor; }
  };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { render: render, fitSize: fitSize, normRect: normRect };
  }
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
