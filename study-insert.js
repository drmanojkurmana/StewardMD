/* PrepNucleus Study Studio - Phase 4: text, insert, laser (study-insert.js)
   ES5 IIFE. Loaded by prep-loader.js after study.js. window.STUDY_INSERT.
   Items stored in IndexedDB "study", store "items": (id, doc, page, kind, x, y, w, h, rot, data, gone, t)
   Drawn on layer ABOVE the page and BELOW ink. Never hard-deleted (flag gone).
   Each add/move/resize/delete is one undo step. */
(function (G) {
  "use strict";

  /* ================= pure helpers ================= */
  var STYLES = {
    title: { label: "Title", size: 28, weight: "bold", font: "sans", lineH: 1.2 },
    h1: { label: "Heading 1", size: 22, weight: "bold", font: "sans", lineH: 1.25 },
    h2: { label: "Heading 2", size: 18, weight: "600", font: "sans", lineH: 1.3 },
    body: { label: "Body", size: 15, weight: "normal", font: "sans", lineH: 1.4 }
  };

  var FONTS = {
    sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', Cambria, serif",
    mono: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
  };

  var FILLS = [
    { label: "None", val: "transparent" },
    { label: "White", val: "#ffffff" },
    { label: "Yellow", val: "#fffde7" },
    { label: "Green", val: "#e8f5e9" },
    { label: "Blue", val: "#e1f5fe" }
  ];

  var BORDERS = [
    { label: "None", val: "none" },
    { label: "Mint", val: "1.5px solid #42cdb5" },
    { label: "Gray", val: "1.5px solid #334155" },
    { label: "Dark", val: "2px solid #071318" }
  ];

  var STICKERS = {
    heart: '<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/><path d="M12 5v4M10 7h4"/></svg>',
    lungs: '<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v9M9 6l3 3M15 6l-3 3"/><path d="M12 12c-2-3-7-3-8 1s0 8 4 8c2.5 0 3.5-2 4-4"/><path d="M12 12c2-3 7-3 8 1s0 8-4 8c-2.5 0-3.5-2-4-4"/></svg>',
    kidney: '<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3C7 3 4 7 4 12s3 9 8 9c3.5 0 8-2 8-7 0-3-2-4-4-4s-3-2-3-4c0-3.5 2-6-1-6Z"/><path d="M12 12v6"/></svg>',
    pill: '<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m10.5 20.5 7-7a4.95 4.95 0 1 0-7-7l-7 7a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/></svg>',
    syringe: '<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 2 4 4M17 7l3-3M19 9l-8.5 8.5M15 13l2 2M11 9l2 2M5 19l-3 3M7 17l-3 3M9 15l-4 4"/></svg>',
    ecg: '<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="2 12 6 12 8 8 11 17 13 5 15 14 17 10 19 12 22 12"/></svg>',
    arrowRight: '<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
    arrowLeft: '<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
    arrowCurved: '<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4v6h6"/><path d="M4 10a9 9 0 0 1 15.3-4.3L21 7"/></svg>',
    tick: '<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    cross: '<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    calloutSpeech: '<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    calloutThought: '<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10a4 4 0 0 0-7.8-1.3A3.5 3.5 0 0 0 5 12a3.5 3.5 0 0 0 1 6.8h12a4 4 0 0 0 0-8.8Z"/><circle cx="7" cy="20" r="1"/><circle cx="5" cy="22" r="0.5"/></svg>',
    calloutBanner: '<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="7" y1="13" x2="17" y2="13"/></svg>'
  };

  var STICKER_LABELS = {
    heart: "Heart",
    lungs: "Lungs",
    kidney: "Kidney",
    pill: "Pill",
    syringe: "Syringe",
    ecg: "ECG",
    arrowRight: "Arrow right",
    arrowLeft: "Arrow left",
    arrowCurved: "Curved arrow",
    tick: "Tick",
    cross: "Cross",
    calloutSpeech: "Speech callout",
    calloutThought: "Thought callout",
    calloutBanner: "Box callout"
  };

  var INSERT_ICO = {
    crop: '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/></svg>',
    copy: '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    image: '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
    camera: '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
    scan: '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
    sparkle: '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/></svg>',
    mic: '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>',
    kbHide: '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="4" rx="2"/><line x1="6" y1="8" x2="6" y2="8.01"/><line x1="10" y1="8" x2="10" y2="8.01"/><line x1="14" y1="8" x2="14" y2="8.01"/><line x1="18" y1="8" x2="18" y2="8.01"/><line x1="6" y1="12" x2="6" y2="12.01"/><line x1="18" y1="12" x2="18" y2="12.01"/><line x1="10" y1="12" x2="14" y2="12"/><polyline points="8 21 12 18 16 21"/></svg>',
    ret: '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/></svg>'
  };

  function uid() {
    return "it_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function r4(n) {
    return Math.round(n * 10000) / 10000;
  }

  function makeItem(docId, page, kind, x, y, w, h, data) {
    return {
      id: uid(),
      doc: docId,
      page: page,
      kind: kind,
      x: r4(x),
      y: r4(y),
      w: r4(w),
      h: r4(h),
      rot: 0,
      data: data || {},
      gone: false,
      t: Date.now()
    };
  }

  function moveItemGeom(item, dx, dy) {
    var nx = Math.max(0, Math.min(1 - item.w, item.x + dx));
    var ny = Math.max(0, Math.min(1 - item.h, item.y + dy));
    item.x = r4(nx);
    item.y = r4(ny);
    return item;
  }

  function resizeItemGeom(item, handle, dx, dy, minW, minH) {
    minW = minW || 0.05;
    minH = minH || 0.02;
    var x = item.x, y = item.y, w = item.w, h = item.h;
    if (handle === "se") {
      w = Math.max(minW, Math.min(1 - x, w + dx));
      h = Math.max(minH, Math.min(1 - y, h + dy));
    } else if (handle === "sw") {
      var nw = Math.max(minW, Math.min(x + w, w - dx));
      x = x + (w - nw);
      w = nw;
      h = Math.max(minH, Math.min(1 - y, h + dy));
    } else if (handle === "ne") {
      w = Math.max(minW, Math.min(1 - x, w + dx));
      var nh = Math.max(minH, Math.min(y + h, h - dy));
      y = y + (h - nh);
      h = nh;
    } else if (handle === "nw") {
      var nw2 = Math.max(minW, Math.min(x + w, w - dx));
      var nh2 = Math.max(minH, Math.min(y + h, h - dy));
      x = x + (w - nw2);
      y = y + (h - nh2);
      w = nw2;
      h = nh2;
    }
    item.x = r4(x);
    item.y = r4(y);
    item.w = r4(w);
    item.h = r4(h);
    return item;
  }

  function rotateItemGeom(item, angleDeg) {
    var a = Math.round(angleDeg) % 360;
    if (a < 0) a += 360;
    if (Math.abs(a - 0) < 4 || Math.abs(a - 360) < 4) a = 0;
    else if (Math.abs(a - 90) < 4) a = 90;
    else if (Math.abs(a - 180) < 4) a = 180;
    else if (Math.abs(a - 270) < 4) a = 270;
    item.rot = a;
    return item;
  }

  function compressDimensions(w, h, maxEdge) {
    maxEdge = maxEdge || 2048;
    var longEdge = Math.max(w, h);
    if (longEdge <= maxEdge) return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)), scale: 1 };
    var k = maxEdge / longEdge;
    return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)), scale: k };
  }

  function laserFilterPoints(pts, now, maxAgeMs) {
    maxAgeMs = maxAgeMs || 1000;
    return (pts || []).filter(function (p) {
      return (now - p.t) <= maxAgeMs;
    });
  }

  function laserFadeAlpha(ageMs, maxAgeMs) {
    maxAgeMs = maxAgeMs || 1000;
    if (ageMs <= 0) return 1;
    if (ageMs >= maxAgeMs) return 0;
    return r4(1 - ageMs / maxAgeMs);
  }

  /* Laser trail opacity: "keep" or still drawing -> 1; "trail" (Fade) -> visible 5 s after lift, fading over the last 0.6 s. */
  function laserStrokeAlpha(now, lift, mode, holdMs, fadeMs) {
    holdMs = holdMs || 5000; fadeMs = fadeMs || 600;
    if (mode === "keep" || !lift) return 1;
    var age = now - lift;
    if (age >= holdMs) return 0;
    if (age <= holdMs - fadeMs) return 1;
    return r4((holdMs - age) / fadeMs);
  }

  var PURE = {
    laserStrokeAlpha: laserStrokeAlpha,
    makeItem: makeItem,
    moveItemGeom: moveItemGeom,
    resizeItemGeom: resizeItemGeom,
    rotateItemGeom: rotateItemGeom,
    compressDimensions: compressDimensions,
    laserFilterPoints: laserFilterPoints,
    laserFadeAlpha: laserFadeAlpha,
    STYLES: STYLES,
    FONTS: FONTS,
    FILLS: FILLS,
    BORDERS: BORDERS,
    STICKERS: STICKERS,
    STICKER_LABELS: STICKER_LABELS
  };

  if (typeof module !== "undefined" && module.exports && !(G && G.document)) {
    module.exports = PURE;
    return;
  }

  /* ================= browser implementation ================= */
  var D = G.document;

  function appRoot() {
    return (S().host() && S().host().root && S().host().root()) || D.querySelector(".pn-root") || D.body;
  }
  var selectedItemId = null;
  var curTextPreset = "body";
  var curFont = "sans";
  var curAlign = "left";
  var curTextColor = "#111111";
  var curFill = "transparent";
  var curBorder = "none";
  function laserPref(k, d) { try { return (G.localStorage && G.localStorage.getItem("smd_study_laser_" + k)) || d; } catch (e) { return d; } }
  function laserSave(k, v) { try { if (G.localStorage) G.localStorage.setItem("smd_study_laser_" + k, v); } catch (e) {} }
  var LASER_COLORS = ["#ff2d55", "#22c55e", "#3b82f6"];
  var laserMode = laserPref("mode", "trail"); // "trail" = fade 5 s after lift | "keep" = stays until Clear / tool change | "dot"
  var laserColor = laserPref("color", "#ff2d55");
  var laserStrokes = []; // { n, pts: [{x, y}], lift: 0 | ms }
  var laserPoints = [];
  var laserActive = false;
  var laserRaf = 0;
  var laserLiftTime = 0;
  var cropState = null;
  var activeEditingTextId = null;

  function S() {
    return G.STUDY;
  }

  function V() {
    return S() && S()._state ? S()._state() : null;
  }

  /* ---- Image Compression (JPEG 0.85, max 2048 px long edge; PNG preserved for transparency) ---- */
  function compressImage(fileOrDataUrl) {
    return new Promise(function (resolve, reject) {
      var isPng = false;
      if (typeof fileOrDataUrl === "string") {
        if (fileOrDataUrl.indexOf("data:image/png") === 0) isPng = true;
      } else if (fileOrDataUrl && fileOrDataUrl.type === "image/png") {
        isPng = true;
      }
      var img = new G.Image();
      img.onload = function () {
        var dims = compressDimensions(img.naturalWidth || img.width, img.naturalHeight || img.height, 2048);
        var cv = D.createElement("canvas");
        cv.width = dims.w;
        cv.height = dims.h;
        var ctx = cv.getContext("2d");
        if (!isPng) {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, dims.w, dims.h);
        }
        ctx.drawImage(img, 0, 0, dims.w, dims.h);
        var dataUrl = isPng ? cv.toDataURL("image/png") : cv.toDataURL("image/jpeg", 0.85);
        cv.width = 0; cv.height = 0;
        resolve({
          data: dataUrl,
          w: dims.w,
          h: dims.h,
          ratio: dims.h / dims.w
        });
      };
      img.onerror = function () { reject(new Error("image-load-failed")); };
      if (typeof fileOrDataUrl === "string") {
        img.src = fileOrDataUrl;
      } else {
        var reader = new G.FileReader();
        reader.onload = function () { img.src = reader.result; };
        reader.onerror = function () { reject(new Error("file-read-failed")); };
        reader.readAsDataURL(fileOrDataUrl);
      }
    });
  }

  function deleteItemById(dId) {
    var v = V(), h = S() && S().host ? S().host() : null;
    if (v && v.items) {
      var it = v.items.find(function (x) { return x.id === dId; });
      if (it) {
        it.gone = true;
        S().put("items", it);
        S().pushUndo({ t: "del", ids: [dId] });
        selectedItemId = null;
        var pgN = S().posOf(it.page);
        if (v.pg && v.pg[pgN]) renderPageItems(pgN, v.pg[pgN]);
        if (h && h.toast) h.toast("Item deleted.");
      }
    }
  }

  /* ---- Laser Pointer (NEVER stored, never in undo) ---- */
  function getLaserCanvas(n) {
    var v = V();
    if (!v || !v.pg[n]) return null;
    var el = v.pg[n].el;
    var lcv = el.querySelector(".st-laser-cv");
    if (!lcv) {
      lcv = D.createElement("canvas");
      lcv.className = "st-laser-cv";
      lcv.style.position = "absolute";
      lcv.style.left = "0";
      lcv.style.top = "0";
      lcv.style.width = "100%";
      lcv.style.height = "100%";
      lcv.style.pointerEvents = "none";
      lcv.style.zIndex = "10";
      el.appendChild(lcv);
    }
    var cw = el.clientWidth, ch = el.clientHeight;
    var dpr = Math.min(G.devicePixelRatio || 1, 2);
    if (lcv.width !== Math.floor(cw * dpr) || lcv.height !== Math.floor(ch * dpr)) {
      lcv.width = Math.floor(cw * dpr);
      lcv.height = Math.floor(ch * dpr);
    }
    return lcv;
  }

  function laserPath(ctx, pts, cw, ch) {
    ctx.beginPath();
    for (var i = 0; i < pts.length; i++) {
      var x = pts[i].x * cw, y = pts[i].y * ch;
      if (!i) { ctx.moveTo(x, y); continue; }
      if (i < pts.length - 1) { var mx = (x + pts[i + 1].x * cw) / 2, my = (y + pts[i + 1].y * ch) / 2; ctx.quadraticCurveTo(x, y, mx, my); }
      else ctx.lineTo(x, y);
    }
    if (pts.length === 1) ctx.lineTo(pts[0].x * cw + 0.01, pts[0].y * ch);
  }
  function drawLaserFrame(n) {
    var lcv = getLaserCanvas(n);
    if (!lcv) return;
    var ctx = lcv.getContext("2d");
    var dpr = Math.min(G.devicePixelRatio || 1, 2);
    ctx.clearRect(0, 0, lcv.width, lcv.height);
    var cw = lcv.clientWidth || (lcv.width / dpr);
    var ch = lcv.clientHeight || (lcv.height / dpr);
    var now = Date.now();
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (laserMode === "dot") {
      var lp = laserPoints[laserPoints.length - 1];
      if (lp && laserActive) {
        var px = lp.x * cw, py = lp.y * ch;
        ctx.shadowColor = laserColor; ctx.shadowBlur = 16;
        ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fillStyle = laserColor; ctx.fill();
        ctx.shadowBlur = 0; ctx.beginPath(); ctx.arc(px, py, 2.2, 0, Math.PI * 2); ctx.fillStyle = "#ffffff"; ctx.fill();
      }
      ctx.restore(); return;
    }
    laserStrokes.forEach(function (st) {
      if (st.n !== n || !st.pts.length) return;
      var al = laserStrokeAlpha(now, st.lift, laserMode);
      if (al <= 0) return;
      /* glow: coloured halo, then a coloured body, then a white core (GoodNotes laser look) */
      ctx.globalAlpha = al;
      ctx.shadowColor = st.color; ctx.shadowBlur = 18; ctx.strokeStyle = st.color; ctx.lineWidth = 7;
      laserPath(ctx, st.pts, cw, ch); ctx.stroke();
      ctx.shadowBlur = 6; ctx.lineWidth = 4.5; laserPath(ctx, st.pts, cw, ch); ctx.stroke();
      ctx.shadowBlur = 0; ctx.strokeStyle = "rgba(255,255,255,0.92)"; ctx.lineWidth = 1.8;
      laserPath(ctx, st.pts, cw, ch); ctx.stroke();
    });
    ctx.restore();
  }

  function laserPages() { var o = {}; laserStrokes.forEach(function (st) { o[st.n] = 1; }); return Object.keys(o).map(Number); }
  function laserVisible(now) { for (var i = 0; i < laserStrokes.length; i++) if (laserStrokeAlpha(now, laserStrokes[i].lift, laserMode) > 0) return true; return false; }
  function startLaserLoop(n) {
    if (laserRaf) return;
    function loop() {
      var now = Date.now();
      if (laserMode !== "keep") laserStrokes = laserStrokes.filter(function (st) { return laserStrokeAlpha(now, st.lift, laserMode) > 0; });
      var pages = laserPages(); if (pages.indexOf(n) === -1) pages.push(n);
      pages.forEach(function (pn) { drawLaserFrame(pn); });
      /* keep looping while drawing or while a Fade trail is still on screen; Keep mode is static after lift */
      if (laserActive || (laserMode === "trail" && laserVisible(now))) { laserRaf = G.requestAnimationFrame(loop); return; }
      laserRaf = 0;
    }
    laserRaf = G.requestAnimationFrame(loop);
  }

  function clearLaser() {
    laserStrokes = []; laserPoints = [];
    if (laserRaf) { G.cancelAnimationFrame(laserRaf); laserRaf = 0; }
    Array.prototype.forEach.call(D.querySelectorAll(".st-laser-cv"), function (c) { c.getContext("2d").clearRect(0, 0, c.width, c.height); });
  }

  function laserDown(e, n, ov, relPt) {
    laserActive = true;
    laserPoints = [{ x: relPt[0], y: relPt[1], t: Date.now() }];
    if (laserMode !== "dot") laserStrokes.push({ n: n, color: laserColor, pts: [{ x: relPt[0], y: relPt[1] }], lift: 0 });
    startLaserLoop(n);
  }

  function laserMove(e, n, ov, relPt) {
    if (!laserActive) return;
    laserPoints.push({ x: relPt[0], y: relPt[1], t: Date.now() });
    var st = laserStrokes[laserStrokes.length - 1];
    if (laserMode !== "dot" && st && !st.lift) st.pts.push({ x: relPt[0], y: relPt[1] });
    if (!laserRaf) startLaserLoop(n);
  }

  function laserUp(e, n, ov) {
    laserActive = false;
    laserLiftTime = Date.now();
    var st = laserStrokes[laserStrokes.length - 1];
    if (st && !st.lift) st.lift = laserLiftTime;
    if (laserMode === "dot") { laserPoints = []; drawLaserFrame(n); return; }
    if (laserRaf) { G.cancelAnimationFrame(laserRaf); laserRaf = 0; }
    startLaserLoop(n);
  }

  /* ---- Render Items for a Page ---- */
  function renderPageItems(n, p) {
    var v = V();
    if (!v || !p || !p.itemLayer) return;
    var pageId = S().pid(n);
    var items = (v.items || []).filter(function (it) {
      return it.page === pageId && !it.gone;
    });

    // Clear and re-render
    p.itemLayer.innerHTML = "";
    items.forEach(function (item) {
      var el = buildItemElement(item, n);
      p.itemLayer.appendChild(el);
    });

    // Bind page click for creating text box when text tool is active
    if (!p.itemLayer._boundClick) {
      p.itemLayer._boundClick = true;
      p.itemLayer.addEventListener("pointerdown", function (e) {
        if (!V() || V().tool !== "text") return;
        if (e.target.closest(".st-item")) return;
        // User tapped empty page area while text tool is active: create text box
        var rect = p.el.getBoundingClientRect();
        var rx = Math.max(0.02, Math.min(0.9, (e.clientX - rect.left) / rect.width));
        var ry = Math.max(0.02, Math.min(0.9, (e.clientY - rect.top) / rect.height));
        var w = Math.min(0.45, 0.96 - rx);
        var preset = STYLES[curTextPreset] || STYLES.body;
        var h = Math.max(0.04, 0.08);

        var newItem = makeItem(V().id, pageId, "text", rx, ry, w, h, {
          text: "",
          preset: curTextPreset,
          size: preset.size,
          font: curFont,
          align: curAlign,
          color: curTextColor,
          fill: curFill,
          border: curBorder
        });

        V().items.push(newItem);
        S().put("items", newItem);
        S().pushUndo({ t: "add", id: newItem.id });
        selectedItemId = newItem.id;
        renderPageItems(n, p);

        // Focus the newly added text box
        G.setTimeout(function () {
          var tEl = p.itemLayer.querySelector('.st-item[data-id="' + newItem.id + '"] .st-text-editable');
          if (tEl) {
            tEl.focus();
            showFormatBar(newItem);
          }
        }, 50);
      });
    }
  }

  function onPageFree(n) {
    // Laser cleanup
    if (laserRaf) { G.cancelAnimationFrame(laserRaf); laserRaf = 0; }
    laserPoints = [];
  }

  function buildItemElement(item, n) {
    var el = D.createElement("div");
    el.className = "st-item st-item-" + item.kind + (selectedItemId === item.id ? " selected" : "");
    el.setAttribute("data-id", item.id);
    el.setAttribute("data-n", n);
    el.style.left = (item.x * 100) + "%";
    el.style.top = (item.y * 100) + "%";
    el.style.width = (item.w * 100) + "%";
    el.style.height = (item.h * 100) + "%";
    if (item.rot) {
      el.style.transform = "rotate(" + item.rot + "deg)";
    }

    var content = D.createElement("div");
    content.className = "st-item-content";

    if (item.kind === "text") {
      var d = item.data || {};
      var fontFam = FONTS[d.font] || FONTS.sans;
      var fSize = d.size || 16;
      var textDiv = D.createElement("div");
      textDiv.className = "st-text-editable";
      textDiv.contentEditable = "true";
      textDiv.spellcheck = false;
      textDiv.style.fontFamily = fontFam;
      textDiv.style.fontSize = fSize + "px";
      textDiv.style.textAlign = d.align || "left";
      textDiv.style.color = d.color || "#111111";
      textDiv.style.backgroundColor = d.fill || "transparent";
      textDiv.style.border = d.border || "none";
      textDiv.style.borderRadius = "4px";
      textDiv.style.padding = "4px 8px";
      textDiv.style.lineHeight = "1.3";
      textDiv.style.minHeight = "100%";
      textDiv.style.wordBreak = "break-word";
      textDiv.style.whiteSpace = "pre-wrap";
      textDiv.style.outline = "none";
      textDiv.textContent = d.text || "";

      textDiv.addEventListener("focus", function () {
        activeEditingTextId = item.id;
        selectedItemId = item.id;
        el.classList.add("selected");
        showFormatBar(item);
      });

      textDiv.addEventListener("input", function () {
        d.text = textDiv.textContent;
        // Reflow auto-height
        var rect = textDiv.getBoundingClientRect();
        var pRect = el.parentNode ? el.parentNode.getBoundingClientRect() : null;
        if (pRect && rect.height > el.clientHeight) {
          item.h = r4(rect.height / pRect.height);
          el.style.height = (item.h * 100) + "%";
        }
      });

      textDiv.addEventListener("blur", function () {
        d.text = textDiv.textContent;
        S().put("items", item);
      });

      content.appendChild(textDiv);
    } else if (item.kind === "image") {
      var img = D.createElement("img");
      img.className = "st-item-img";
      img.src = item.data.src;
      img.alt = "Inserted image";
      img.draggable = false;
      img.style.width = "100%";
      img.style.height = "100%";
      img.style.objectFit = "fill";
      img.style.pointerEvents = "none";
      img.style.borderRadius = "4px";
      content.appendChild(img);
    } else if (item.kind === "sticker") {
      var stWrap = D.createElement("div");
      stWrap.className = "st-sticker-wrap";
      stWrap.style.width = "100%";
      stWrap.style.height = "100%";
      stWrap.style.display = "flex";
      stWrap.style.alignItems = "center";
      stWrap.style.justifyContent = "center";
      stWrap.style.color = item.data.color || "#42cdb5";
      stWrap.innerHTML = item.data.svg || "";
      var svg = stWrap.querySelector("svg");
      if (svg) {
        svg.setAttribute("width", "100%");
        svg.setAttribute("height", "100%");
      }
      content.appendChild(stWrap);
    }

    el.appendChild(content);

    // Context controls & handles when selected
    var handlesWrap = D.createElement("div");
    handlesWrap.className = "st-item-handles";

    var dragBar = D.createElement("div");
    dragBar.className = "st-drag-bar";
    dragBar.title = "Drag to move";
    dragBar.innerHTML = '<i></i>';
    handlesWrap.appendChild(dragBar);

    var hNW = D.createElement("div"); hNW.className = "st-handle nw"; hNW.setAttribute("data-h", "nw");
    var hNE = D.createElement("div"); hNE.className = "st-handle ne"; hNE.setAttribute("data-h", "ne");
    var hSW = D.createElement("div"); hSW.className = "st-handle sw"; hSW.setAttribute("data-h", "sw");
    var hSE = D.createElement("div"); hSE.className = "st-handle se"; hSE.setAttribute("data-h", "se");
    handlesWrap.appendChild(hNW);
    handlesWrap.appendChild(hNE);
    handlesWrap.appendChild(hSW);
    handlesWrap.appendChild(hSE);

    // Rotation handle for images and stickers
    if (item.kind === "image" || item.kind === "sticker") {
      var rotH = D.createElement("div");
      rotH.className = "st-rot-handle";
      rotH.title = "Rotate";
      handlesWrap.appendChild(rotH);
      bindRotate(rotH, item, el, n);
    }

    // Mini contextual action bar
    var actBar = D.createElement("div");
    actBar.className = "st-item-bar";
    var delBtn = '<button type="button" class="st-ib-btn bad" data-act="st-item-del" data-id="' + item.id + '" title="Delete" aria-label="Delete">' + INSERT_ICO.trash + '</button>';
    var copyBtn = '<button type="button" class="st-ib-btn" data-act="st-item-copy" data-id="' + item.id + '" title="Duplicate" aria-label="Duplicate">' + INSERT_ICO.copy + '</button>';
    var extraBtn = "";
    if (item.kind === "image") {
      extraBtn = '<button type="button" class="st-ib-btn" data-act="st-img-crop" data-id="' + item.id + '" title="Crop" aria-label="Crop">' + INSERT_ICO.crop + ' Crop</button>';
    }
    actBar.innerHTML = copyBtn + extraBtn + delBtn;
    handlesWrap.appendChild(actBar);

    el.appendChild(handlesWrap);

    // Bind selection & drag
    el.addEventListener("pointerdown", function (e) {
      if (selectedItemId !== item.id) {
        selectedItemId = item.id;
        Array.prototype.forEach.call(D.querySelectorAll(".st-item.selected"), function (other) {
          other.classList.remove("selected");
        });
        el.classList.add("selected");
      }
    });

    bindDrag(dragBar, item, el, n);
    bindResize(hNW, item, el, n, "nw");
    bindResize(hNE, item, el, n, "ne");
    bindResize(hSW, item, el, n, "sw");
    bindResize(hSE, item, el, n, "se");

    return el;
  }

  function bindDrag(dragEl, item, el, n) {
    dragEl.addEventListener("pointerdown", function (e) {
      e.stopPropagation();
      e.preventDefault();
      try { dragEl.setPointerCapture(e.pointerId); } catch (x) {}
      var pEl = el.parentNode;
      var pRect = pEl.getBoundingClientRect();
      var startX = e.clientX, startY = e.clientY;
      var origX = item.x, origY = item.y;
      var before = { x: origX, y: origY, w: item.w, h: item.h, rot: item.rot };

      function onMove(ev) {
        var dx = (ev.clientX - startX) / pRect.width;
        var dy = (ev.clientY - startY) / pRect.height;
        moveItemGeom(item, origX + dx - item.x, origY + dy - item.y);
        el.style.left = (item.x * 100) + "%";
        el.style.top = (item.y * 100) + "%";
      }

      function onUp(ev) {
        dragEl.removeEventListener("pointermove", onMove);
        dragEl.removeEventListener("pointerup", onUp);
        dragEl.removeEventListener("pointercancel", onUp);
        G.removeEventListener("pointermove", onMove);
        G.removeEventListener("pointerup", onUp);
        G.removeEventListener("pointercancel", onUp);
        if (item.x !== before.x || item.y !== before.y) {
          S().put("items", item);
          S().pushUndo({ t: "item_mod", id: item.id, before: before, after: { x: item.x, y: item.y, w: item.w, h: item.h, rot: item.rot } });
        }
      }

      dragEl.addEventListener("pointermove", onMove);
      dragEl.addEventListener("pointerup", onUp);
      dragEl.addEventListener("pointercancel", onUp);
      G.addEventListener("pointermove", onMove);
      G.addEventListener("pointerup", onUp);
      G.addEventListener("pointercancel", onUp);
    });
  }

  function bindResize(hEl, item, el, n, handle) {
    hEl.addEventListener("pointerdown", function (e) {
      e.stopPropagation();
      e.preventDefault();
      try { hEl.setPointerCapture(e.pointerId); } catch (x) {}
      var pEl = el.parentNode;
      var pRect = pEl.getBoundingClientRect();
      var startX = e.clientX, startY = e.clientY;
      var origX = item.x, origY = item.y, origW = item.w, origH = item.h;
      var before = { x: origX, y: origY, w: origW, h: origH, rot: item.rot };

      function onMove(ev) {
        var dx = (ev.clientX - startX) / pRect.width;
        var dy = (ev.clientY - startY) / pRect.height;
        // Temporarily reset to original and apply total delta
        item.x = origX; item.y = origY; item.w = origW; item.h = origH;
        resizeItemGeom(item, handle, dx, dy);
        el.style.left = (item.x * 100) + "%";
        el.style.top = (item.y * 100) + "%";
        el.style.width = (item.w * 100) + "%";
        el.style.height = (item.h * 100) + "%";
      }

      function onUp(ev) {
        hEl.removeEventListener("pointermove", onMove);
        hEl.removeEventListener("pointerup", onUp);
        hEl.removeEventListener("pointercancel", onUp);
        G.removeEventListener("pointermove", onMove);
        G.removeEventListener("pointerup", onUp);
        G.removeEventListener("pointercancel", onUp);
        if (item.w !== before.w || item.h !== before.h || item.x !== before.x || item.y !== before.y) {
          S().put("items", item);
          S().pushUndo({ t: "item_mod", id: item.id, before: before, after: { x: item.x, y: item.y, w: item.w, h: item.h, rot: item.rot } });
        }
      }

      hEl.addEventListener("pointermove", onMove);
      hEl.addEventListener("pointerup", onUp);
      hEl.addEventListener("pointercancel", onUp);
      G.addEventListener("pointermove", onMove);
      G.addEventListener("pointerup", onUp);
      G.addEventListener("pointercancel", onUp);
    });
  }

  function bindRotate(rotEl, item, el, n) {
    rotEl.addEventListener("pointerdown", function (e) {
      e.stopPropagation();
      e.preventDefault();
      try { rotEl.setPointerCapture(e.pointerId); } catch (x) {}
      var rect = el.getBoundingClientRect();
      var cx = rect.left + rect.width / 2;
      var cy = rect.top + rect.height / 2;
      var before = { x: item.x, y: item.y, w: item.w, h: item.h, rot: item.rot || 0 };

      function onMove(ev) {
        var angleRad = Math.atan2(ev.clientY - cy, ev.clientX - cx);
        var angleDeg = (angleRad * 180 / Math.PI) + 90;
        rotateItemGeom(item, angleDeg);
        el.style.transform = "rotate(" + item.rot + "deg)";
      }

      function onUp(ev) {
        rotEl.removeEventListener("pointermove", onMove);
        rotEl.removeEventListener("pointerup", onUp);
        rotEl.removeEventListener("pointercancel", onUp);
        G.removeEventListener("pointermove", onMove);
        G.removeEventListener("pointerup", onUp);
        G.removeEventListener("pointercancel", onUp);
        if (item.rot !== before.rot) {
          S().put("items", item);
          S().pushUndo({ t: "item_mod", id: item.id, before: before, after: { x: item.x, y: item.y, w: item.w, h: item.h, rot: item.rot } });
        }
      }

      rotEl.addEventListener("pointermove", onMove);
      rotEl.addEventListener("pointerup", onUp);
      rotEl.addEventListener("pointercancel", onUp);
      G.addEventListener("pointermove", onMove);
      G.addEventListener("pointerup", onUp);
      G.addEventListener("pointercancel", onUp);
    });
  }

  /* ---- Format Bar (Feature 4.3) ---- */
  function showFormatBar(item) {
    hideFormatBar();
    var bar = D.createElement("div");
    bar.id = "stFormatBar";
    bar.className = "st-format-bar";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Text format bar");

    bar.innerHTML =
      '<div class="st-fb-group">' +
        '<button type="button" class="st-fb-btn" data-act="st-fb-prev" title="Previous character" aria-label="Previous">‹</button>' +
        '<button type="button" class="st-fb-btn" data-act="st-fb-next" title="Next character" aria-label="Next">›</button>' +
        '<button type="button" class="st-fb-btn" data-act="st-fb-hidekb" title="Hide keyboard" aria-label="Hide keyboard">' +
          '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="6" y1="8" x2="6" y2="8"/><line x1="10" y1="8" x2="10" y2="8"/><line x1="14" y1="8" x2="14" y2="8"/><line x1="18" y1="8" x2="18" y2="8"/><line x1="7" y1="16" x2="17" y2="16"/></svg>' +
        '</button>' +
      '</div>' +
      '<span class="st-fb-sep"></span>' +
      '<div class="st-fb-group">' +
        '<button type="button" class="st-fb-btn" data-act="st-fb-styles" title="Text styles" aria-label="Styles">Aa</button>' +
        '<button type="button" class="st-fb-btn" data-act="st-fb-b" title="Bold" aria-label="Bold"><b>B</b></button>' +
        '<button type="button" class="st-fb-btn" data-act="st-fb-i" title="Italic" aria-label="Italic"><i>I</i></button>' +
        '<button type="button" class="st-fb-btn" data-act="st-fb-u" title="Underline" aria-label="Underline"><u>U</u></button>' +
        '<button type="button" class="st-fb-btn" data-act="st-fb-s" title="Strikethrough" aria-label="Strikethrough"><s>S</s></button>' +
      '</div>' +
      '<span class="st-fb-sep"></span>' +
      '<div class="st-fb-group">' +
        '<button type="button" class="st-fb-btn" data-act="st-fb-mic" title="Dictation" aria-label="Dictation">' +
          '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>' +
        '</button>' +
        '<button type="button" class="st-fb-btn st-fb-ret" data-act="st-fb-return" title="Return / Done" aria-label="Return">' + INSERT_ICO.ret + '</button>' +
      '</div>';

    // Position format bar above visual viewport if on mobile
    function updatePos() {
      if (G.visualViewport) {
        var bottomOffset = Math.max(0, G.innerHeight - G.visualViewport.height - G.visualViewport.offsetTop);
        bar.style.bottom = bottomOffset + "px";
      }
    }
    if (G.visualViewport) {
      G.visualViewport.addEventListener("resize", updatePos);
      G.visualViewport.addEventListener("scroll", updatePos);
    }
    updatePos();

    appRoot().appendChild(bar);
  }

  function hideFormatBar() {
    var bar = D.getElementById("stFormatBar");
    if (bar && bar.parentNode) {
      bar.parentNode.removeChild(bar);
    }
  }

  function showStyleSheet(item) {
    closeStyleSheet();
    var d = item.data || {};
    var sheet = D.createElement("div");
    sheet.id = "stStyleSheet";
    sheet.className = "st-sheet";
    sheet.innerHTML =
      '<div class="st-sh smd-books-keep smd-emo-keep">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
          '<h3>Text Style &amp; Font</h3>' +
          '<button type="button" class="pn-btn sm" data-act="st-fb-close-styles">Done</button>' +
        '</div>' +
        '<div class="st-style-presets" style="display:flex;gap:6px;margin-bottom:12px;" role="group" aria-label="Presets">' +
          ['title', 'h1', 'h2', 'body'].map(function (k) {
            return '<button type="button" class="st-ink-seg' + (d.preset === k ? ' on' : '') + '" data-act="st-set-preset" data-v="' + k + '" aria-pressed="' + (d.preset === k) + '">' + STYLES[k].label + '</button>';
          }).join("") +
        '</div>' +
        '<div class="st-style-row" style="margin-bottom:10px;">' +
          '<label style="font-size:13px;display:block;margin-bottom:4px;color:var(--pn-sub,#94a3b8);">Font family</label>' +
          '<div style="display:flex;gap:6px;" role="group" aria-label="Font family">' +
            ['sans', 'serif', 'mono'].map(function (f) {
              return '<button type="button" class="st-ink-seg' + (d.font === f ? ' on' : '') + '" data-act="st-set-font" data-v="' + f + '" aria-pressed="' + (d.font === f) + '">' + (f === 'sans' ? 'Sans-Serif' : f === 'serif' ? 'Serif' : 'Mono') + '</button>';
            }).join("") +
          '</div>' +
        '</div>' +
        '<div class="st-style-row" style="margin-bottom:10px;">' +
          '<label style="font-size:13px;display:block;margin-bottom:4px;color:var(--pn-sub,#94a3b8);">Alignment</label>' +
          '<div style="display:flex;gap:6px;" role="group" aria-label="Alignment">' +
            ['left', 'center', 'right'].map(function (al) {
              return '<button type="button" class="st-ink-seg' + (d.align === al ? ' on' : '') + '" data-act="st-set-align" data-v="' + al + '" aria-pressed="' + (d.align === al) + '">' + al.charAt(0).toUpperCase() + al.slice(1) + '</button>';
            }).join("") +
          '</div>' +
        '</div>' +
        '<div class="st-style-row" style="margin-bottom:10px;">' +
          '<label style="font-size:13px;display:block;margin-bottom:4px;color:var(--pn-sub,#94a3b8);">Box Fill</label>' +
          '<div style="display:flex;gap:6px;" role="group" aria-label="Box Fill">' +
            FILLS.map(function (fi) {
              return '<button type="button" class="st-ink-seg' + (d.fill === fi.val ? ' on' : '') + '" data-act="st-set-fill" data-v="' + fi.val + '" aria-pressed="' + (d.fill === fi.val) + '">' + fi.label + '</button>';
            }).join("") +
          '</div>' +
        '</div>' +
        '<div class="st-style-row" style="margin-bottom:10px;">' +
          '<label style="font-size:13px;display:block;margin-bottom:4px;color:var(--pn-sub,#94a3b8);">Box Border</label>' +
          '<div style="display:flex;gap:6px;" role="group" aria-label="Box Border">' +
            BORDERS.map(function (bo) {
              return '<button type="button" class="st-ink-seg' + (d.border === bo.val ? ' on' : '') + '" data-act="st-set-border" data-v="' + bo.val + '" aria-pressed="' + (d.border === bo.val) + '">' + bo.label + '</button>';
            }).join("") +
          '</div>' +
        '</div>' +
      '</div>';

    appRoot().appendChild(sheet);
  }

  function closeStyleSheet() {
    var s = D.getElementById("stStyleSheet");
    if (s && s.parentNode) s.parentNode.removeChild(s);
  }

  /* ---- Sticker Tray (Feature 4.8) ---- */
  function showStickerTray() {
    closeStickerTray();
    var tray = D.createElement("div");
    tray.id = "stStickerTray";
    tray.className = "st-sheet st-sticker-sheet";
    tray.setAttribute("role", "dialog");
    tray.setAttribute("aria-label", "Stickers and elements");

    var userElems = [];
    try {
      userElems = JSON.parse(G.localStorage.getItem("smd_study_elements") || "[]");
    } catch (e) {}

    tray.innerHTML =
      '<div class="st-sh smd-books-keep smd-emo-keep" style="max-height:80vh;overflow-y:auto;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">' +
          '<h3>Elements &amp; Stickers</h3>' +
          '<button type="button" class="pn-btn sm" data-act="st-close-stickers">Done</button>' +
        '</div>' +
        '<div class="st-sticker-tabs">' +
          '<h4 style="margin:8px 0 6px 0;font-size:13px;color:var(--pn-km-mint,#42cdb5);font-weight:600;">Medical Line Icons</h4>' +
          '<div class="st-sticker-grid">' +
            ['heart', 'lungs', 'kidney', 'pill', 'syringe', 'ecg'].map(function (k) {
              var lbl = STICKER_LABELS[k] || k;
              return '<button type="button" class="st-sticker-btn" data-act="st-insert-sticker" data-name="' + k + '" title="' + lbl + '" aria-label="' + lbl + '">' + STICKERS[k] + '<span>' + lbl + '</span></button>';
            }).join("") +
          '</div>' +
          '<h4 style="margin:14px 0 6px 0;font-size:13px;color:var(--pn-km-mint,#42cdb5);font-weight:600;">Arrows &amp; Marks</h4>' +
          '<div class="st-sticker-grid">' +
            ['arrowRight', 'arrowLeft', 'arrowCurved', 'tick', 'cross'].map(function (k) {
              var lbl = STICKER_LABELS[k] || k;
              return '<button type="button" class="st-sticker-btn" data-act="st-insert-sticker" data-name="' + k + '" title="' + lbl + '" aria-label="' + lbl + '">' + STICKERS[k] + '<span>' + lbl + '</span></button>';
            }).join("") +
          '</div>' +
          '<h4 style="margin:14px 0 6px 0;font-size:13px;color:var(--pn-km-mint,#42cdb5);font-weight:600;">Callouts</h4>' +
          '<div class="st-sticker-grid">' +
            ['calloutSpeech', 'calloutThought', 'calloutBanner'].map(function (k) {
              var lbl = STICKER_LABELS[k] || k;
              return '<button type="button" class="st-sticker-btn" data-act="st-insert-sticker" data-name="' + k + '" title="' + lbl + '" aria-label="' + lbl + '">' + STICKERS[k] + '<span>' + lbl + '</span></button>';
            }).join("") +
          '</div>' +
          (userElems.length ?
            '<h4 style="margin:14px 0 6px 0;font-size:13px;color:var(--pn-km-mint,#42cdb5);font-weight:600;">My Saved Elements (' + userElems.length + ')</h4>' +
            '<div class="st-sticker-grid">' +
              userElems.map(function (ue, idx) {
                return '<button type="button" class="st-sticker-btn" data-act="st-insert-saved-elem" data-idx="' + idx + '" title="' + ue.name + '" aria-label="' + ue.name + '">' + (ue.svg || STICKERS.calloutBanner) + '<span>' + ue.name + '</span></button>';
              }).join("") +
            '</div>' : "") +
        '</div>' +
      '</div>';

    appRoot().appendChild(tray);
  }

  function closeStickerTray() {
    var t = D.getElementById("stStickerTray");
    if (t && t.parentNode) t.parentNode.removeChild(t);
  }

  /* ---- Image & Photo Picker (Features 4.5 & 4.6) ---- */
  function pickImageFile() {
    var inp = D.getElementById("stInsertFileInput");
    if (!inp) {
      inp = D.createElement("input");
      inp.type = "file";
      inp.id = "stInsertFileInput";
      inp.accept = "image/*";
      inp.style.display = "none";
      appRoot().appendChild(inp);
    }
    inp.onchange = function () {
      if (inp.files && inp.files[0]) {
        insertImageFromFile(inp.files[0]);
      }
      inp.value = "";
    };
    inp.click();
  }

  function pickCamera() {
    var plugins = (G.Capacitor && G.Capacitor.Plugins) || {};
    if (plugins.Camera && plugins.Camera.getPhoto) {
      plugins.Camera.getPhoto({
        quality: 85,
        resultType: "dataUrl",
        source: "CAMERA"
      }).then(function (photo) {
        if (photo && (photo.dataUrl || photo.base64String)) {
          var src = photo.dataUrl || ("data:image/jpeg;base64," + photo.base64String);
          insertImageFromDataUrl(src);
        }
      }).catch(function (err) {
        if (!/cancel/i.test(String(err))) {
          if (S().host()) S().host().toast("Camera could not capture image.");
        }
      });
      return;
    }

    // Fallback: input with capture
    var inp = D.getElementById("stCameraCaptureInput");
    if (!inp) {
      inp = D.createElement("input");
      inp.type = "file";
      inp.id = "stCameraCaptureInput";
      inp.accept = "image/*";
      inp.capture = "environment";
      inp.style.display = "none";
      appRoot().appendChild(inp);
    }
    inp.onchange = function () {
      if (inp.files && inp.files[0]) {
        insertImageFromFile(inp.files[0]);
      }
      inp.value = "";
    };
    inp.click();
  }

  function insertImageFromFile(file) {
    compressImage(file).then(function (res) {
      insertImageRecord(res.data, res.w, res.h);
    }).catch(function () {
      if (S().host()) S().host().toast("Could not process selected image.");
    });
  }

  function insertImageFromDataUrl(dataUrl) {
    compressImage(dataUrl).then(function (res) {
      insertImageRecord(res.data, res.w, res.h);
    }).catch(function () {
      if (S().host()) S().host().toast("Could not process camera image.");
    });
  }

  function insertImageRecord(dataUrl, w, h) {
    var v = V();
    if (!v) return;
    var n = v.cur || 1;
    var pageId = S().pid(n);
    var ratio = h / w;
    var itemW = 0.55;
    var itemH = Math.min(0.8, itemW * ratio * (1 / (v.ratio || 1.414)));
    var itemX = (1 - itemW) / 2;
    var itemY = 0.15;

    var item = makeItem(v.id, pageId, "image", itemX, itemY, itemW, itemH, {
      src: dataUrl,
      origW: w,
      origH: h
    });

    v.items.push(item);
    S().put("items", item);
    S().pushUndo({ t: "add", id: item.id });
    selectedItemId = item.id;
    if (v.pg[n]) renderPageItems(n, v.pg[n]);
    if (S().host()) S().host().toast("Image inserted.");
  }

  /* ---- Scan Into Page (Feature 4.7) ---- */
  function scanIntoPage() {
    var v = V();
    if (!v) return;
    var S_mod = S();
    var sc = S_mod.scanner();
    if (!sc) {
      if (S_mod.host()) S_mod.host().toast("Scanning is not available on this phone.");
      return;
    }
    var fs = G.Capacitor && G.Capacitor.Plugins && G.Capacitor.Plugins.Filesystem;
    var got = [];
    var uri = function (p) { return /^file:/.test(p) ? p : "file://" + p; };

    sc.scan({ maxPages: 30 }).then(function (r) {
      var shots = [];
      got = (r && r.pages) || [];
      return got.reduce(function (p, pg) {
        return p.then(function () {
          return fs.readFile({ path: uri(pg.path) }).then(function (f) {
            shots.push({ data: "data:image/jpeg;base64," + f.data, w: pg.width || 1, h: pg.height || 1.414 });
          });
        });
      }, Promise.resolve()).then(function () {
        if (!shots.length) return;
        var curN = v.cur || 1;
        var d = v.nb;
        if (d) {
          // In a notebook: insert new pages in order after curN
          shots.forEach(function (shot, idx) {
            var newPageId = d.next++;
            d.ord.splice(curN + idx, 0, newPageId);
            var shotItem = makeItem(v.id, newPageId, "image", 0, 0, 1, 1, {
              src: shot.data,
              origW: shot.w,
              origH: shot.h
            });
            S_mod.put("items", shotItem);
            if (v.items) v.items.push(shotItem);
          });
          d.pageCount = d.ord.length;
          return S_mod.put("docs", d).then(function () {
            S_mod.reloadNb(curN + 1);
            if (S_mod.host()) S_mod.host().toast("Added " + shots.length + " scanned pages in order.");
          });
        } else {
          // If viewing PDF: alert or create new notebook pages
          if (S_mod.host()) S_mod.host().toast("Scanned " + shots.length + " pages.");
        }
      });
    }).catch(function (e) {
      if (!/cancel/i.test(String(e && e.code))) {
        if (S_mod.host()) S_mod.host().toast("Scan could not be saved.");
      }
    }).finally(function () {
      got.forEach(function (pg) {
        try { fs.deleteFile({ path: uri(pg.path) }).catch(function () {}); } catch (x) {}
      });
    });
  }

  /* ---- Image Cropping (Feature 4.5) ---- */
  function startCrop(itemId) {
    var v = V();
    if (!v) return;
    var item = v.items.find(function (it) { return it.id === itemId; });
    if (!item || item.kind !== "image") return;

    closeCrop();
    cropState = {
      itemId: itemId,
      item: item,
      cropBox: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }
    };

    var overlay = D.createElement("div");
    overlay.id = "stCropOverlay";
    overlay.className = "st-crop-overlay";
    overlay.innerHTML =
      '<div class="st-crop-bar">' +
        '<button type="button" class="pn-btn sm" data-act="st-crop-cancel">Cancel</button>' +
        '<span>Crop Image</span>' +
        '<button type="button" class="pn-btn sm pri" data-act="st-crop-apply">Apply</button>' +
      '</div>' +
      '<div class="st-crop-container">' +
        '<img src="' + item.data.src + '" class="st-crop-preview" />' +
        '<div class="st-crop-frame" id="stCropFrame">' +
          '<div class="st-crop-h nw"></div><div class="st-crop-h ne"></div>' +
          '<div class="st-crop-h sw"></div><div class="st-crop-h se"></div>' +
        '</div>' +
      '</div>';

    appRoot().appendChild(overlay);
  }

  function closeCrop() {
    var o = D.getElementById("stCropOverlay");
    if (o && o.parentNode) o.parentNode.removeChild(o);
    cropState = null;
  }

  function applyCrop() {
    if (!cropState || !cropState.item) return closeCrop();
    var item = cropState.item;
    var img = new G.Image();
    img.onload = function () {
      var iw = img.naturalWidth, ih = img.naturalHeight;
      var box = cropState.cropBox;
      var sx = Math.floor(iw * box.x);
      var sy = Math.floor(ih * box.y);
      var sw = Math.max(10, Math.floor(iw * box.w));
      var sh = Math.max(10, Math.floor(ih * box.h));

      var cv = D.createElement("canvas");
      cv.width = sw;
      cv.height = sh;
      var ctx = cv.getContext("2d");
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      var newSrc = cv.toDataURL("image/jpeg", 0.85);

      var before = {
        x: item.x, y: item.y, w: item.w, h: item.h, rot: item.rot,
        data: { src: item.data.src, origW: item.data.origW, origH: item.data.origH }
      };

      item.data.src = newSrc;
      item.data.origW = sw;
      item.data.origH = sh;
      item.h = r4(item.w * (sh / sw));

      var after = {
        x: item.x, y: item.y, w: item.w, h: item.h, rot: item.rot,
        data: { src: newSrc, origW: sw, origH: sh }
      };

      S().put("items", item);
      S().pushUndo({ t: "item_mod", id: item.id, before: before, after: after });

      var n = V() && V().cur || 1;
      if (V() && V().pg[n]) renderPageItems(n, V().pg[n]);
      closeCrop();
      if (S().host()) S().host().toast("Image cropped.");
    };
    img.src = item.data.src;
  }

  /* ---- AI on Selection (Feature 4.10) ---- */
  function renderSelectionToCanvas(lasso) {
    var v = V();
    if (!v || !lasso || !lasso.ids) return null;
    var n = lasso.n;
    var p = v.pg[n];
    if (!p || !p.el) return null;

    // Calculate bounding box of selection
    var minX = 1, minY = 1, maxX = 0, maxY = 0;
    var hasPts = false;
    v.strokes.forEach(function (s) {
      if (lasso.ids.indexOf(s.id) !== -1 && s.pts) {
        s.pts.forEach(function (pt) {
          hasPts = true;
          if (pt[0] < minX) minX = pt[0];
          if (pt[0] > maxX) maxX = pt[0];
          if (pt[1] < minY) minY = pt[1];
          if (pt[1] > maxY) maxY = pt[1];
        });
      }
    });

    if (!hasPts) { minX = 0.2; minY = 0.2; maxX = 0.8; maxY = 0.8; }
    // Add 5% padding
    var pad = 0.04;
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(1, maxX + pad);
    maxY = Math.min(1, maxY + pad);

    var bw = Math.max(0.05, maxX - minX);
    var bh = Math.max(0.05, maxY - minY);

    var dpr = Math.min(G.devicePixelRatio || 1, 2);
    var pageW = p.el.clientWidth || 400;
    var pageH = p.el.clientHeight || 560;

    var outW = Math.floor(bw * pageW);
    var outH = Math.floor(bh * pageH);

    var cv = D.createElement("canvas");
    cv.width = Math.max(50, Math.floor(outW * dpr));
    cv.height = Math.max(50, Math.floor(outH * dpr));
    var ctx = cv.getContext("2d");
    ctx.scale(dpr, dpr);

    // Draw page background
    if (p.cv) {
      ctx.drawImage(p.cv, minX * p.cv.width, minY * p.cv.height, bw * p.cv.width, bh * p.cv.height, 0, 0, outW, outH);
    } else {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, outW, outH);
    }

    // Draw strokes in selection
    v.strokes.forEach(function (s) {
      if (lasso.ids.indexOf(s.id) !== -1 && s.pts && s.pts.length) {
        ctx.save();
        ctx.strokeStyle = s.color;
        ctx.lineWidth = Math.max(1, s.w * pageW);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        for (var i = 0; i < s.pts.length; i++) {
          var sx = (s.pts[i][0] - minX) * pageW;
          var sy = (s.pts[i][1] - minY) * pageH;
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.stroke();
        ctx.restore();
      }
    });

    return {
      canvas: cv,
      dataUrl: cv.toDataURL("image/jpeg", 0.85),
      minX: minX, minY: minY, maxX: maxX, maxY: maxY
    };
  }

  function handleLassoAi(kind) {
    var v = V();
    if (!v || !v.lasso) return;
    var sel = renderSelectionToCanvas(v.lasso);
    if (!sel) return;

    var cp = v.cur || 1;
    var ground = "Diagram on page " + cp + " of " + (v.title || "Study notes") + " (" + v.lasso.ids.length + " selected elements)";

    if (kind === "explain") {
      S().sheet(
        '<h2>Explain Diagram Selection</h2>' +
        '<div style="text-align:center;margin:12px 0;">' +
          '<img src="' + sel.dataUrl + '" style="max-width:100%;max-height:160px;border-radius:4px;border:1px solid #1c333b;" alt="Selection preview" />' +
        '</div>' +
        '<p>This selected diagram area will be analyzed and explained.</p>',
        function () {
          S().sheet('<p role="status">Analyzing diagram...</p>');
          S().askAi(ground).then(function (r) {
            S().sheet(
              '<p class="st-from">From <b>' + S().host().esc(v.title) + '</b>, page ' + cp + ' (Selection)</p>' +
              (r.text ? '<p class="st-ans">' + S().host().esc(r.text) + '</p>' : '<p>' + S().host().esc(r.error) + '</p>')
            );
          });
        },
        "Send and explain"
      );
    } else if (kind === "summary") {
      S().sheet(
        '<h2>Summary of Selection</h2>' +
        '<div style="text-align:center;margin:12px 0;">' +
          '<img src="' + sel.dataUrl + '" style="max-width:100%;max-height:160px;border-radius:4px;border:1px solid #1c333b;" alt="Selection preview" />' +
        '</div>' +
        '<p>Summarize key points of this visual section.</p>',
        function () {
          S().sheet('<p role="status">Summarizing diagram...</p>');
          S().askAi("Summarize the key concepts shown in this diagram: " + ground).then(function (r) {
            S().sheet(
              '<p class="st-from">From <b>' + S().host().esc(v.title) + '</b>, page ' + cp + '</p>' +
              (r.text ? '<p class="st-ans">' + S().host().esc(r.text) + '</p>' : '<p>' + S().host().esc(r.error) + '</p>')
            );
          });
        },
        "Send and summarize"
      );
    } else if (kind === "make") {
      S().makeDeck();
    }
  }

  function saveSelectionAsElement() {
    var v = V();
    if (!v || !v.lasso || !v.lasso.ids.length) return;
    var name = G.prompt("Name this element:") || "Custom Element";
    name = name.trim().slice(0, 30);
    if (!name) return;

    var sel = renderSelectionToCanvas(v.lasso);
    var svg = sel ? '<img src="' + sel.dataUrl + '" style="width:100%;height:100%;object-fit:contain;" />' : STICKERS.star;

    var userElems = [];
    try {
      userElems = JSON.parse(G.localStorage.getItem("smd_study_elements") || "[]");
    } catch (e) {}

    userElems.push({
      id: "elem_" + Date.now(),
      name: name,
      svg: svg,
      dataUrl: sel ? sel.dataUrl : null
    });

    try {
      G.localStorage.setItem("smd_study_elements", JSON.stringify(userElems.slice(-20)));
    } catch (e) {}

    if (S().host()) S().host().toast("Saved '" + name + "' to Elements!");
    if (G.STUDY_SELECT && G.STUDY_SELECT.removePanels) G.STUDY_SELECT.removePanels(S().host() && S().host().root());
  }

  /* ---- Sync Toolbar & Options ---- */
  function syncTb(v, root) {
    if (v && v.tool !== "laser" && laserStrokes.length) clearLaser(); /* Keep-mode trails live only while the laser is the tool */
    if (!v || !root) return;
    var insertOpt = root.querySelector("#stInsertOptions");
    if (!insertOpt) return;

    if (v.tool === "text") {
      insertOpt.hidden = false;
      insertOpt.innerHTML =
        '<div class="st-text-strip">' +
          '<div class="st-fb-group" role="group" aria-label="Text preset">' +
            ['title', 'h1', 'h2', 'body'].map(function (k) {
              return '<button type="button" class="st-ink-seg' + (curTextPreset === k ? ' on' : '') + '" data-act="st-tb-set-preset" data-v="' + k + '" aria-pressed="' + (curTextPreset === k) + '">' + STYLES[k].label + '</button>';
            }).join("") +
          '</div>' +
          '<span class="st-fb-sep"></span>' +
          '<div class="st-fb-group" role="group" aria-label="Font family">' +
            ['sans', 'serif', 'mono'].map(function (f) {
              return '<button type="button" class="st-ink-seg' + (curFont === f ? ' on' : '') + '" data-act="st-tb-set-font" data-v="' + f + '" aria-pressed="' + (curFont === f) + '">' + (f === 'sans' ? 'Sans' : f === 'serif' ? 'Serif' : 'Mono') + '</button>';
            }).join("") +
          '</div>' +
          '<span class="st-fb-sep"></span>' +
          '<div class="st-fb-group" role="group" aria-label="Alignment">' +
            ['left', 'center', 'right'].map(function (al) {
              return '<button type="button" class="st-ink-seg' + (curAlign === al ? ' on' : '') + '" data-act="st-tb-set-align" data-v="' + al + '" aria-pressed="' + (curAlign === al) + '">' + al.charAt(0).toUpperCase() + '</button>';
            }).join("") +
          '</div>' +
        '</div>';
    } else if (v.tool === "image") {
      insertOpt.hidden = false;
      insertOpt.innerHTML =
        '<div class="st-insert-strip">' +
          '<button type="button" class="pn-btn sm" data-act="st-img-pick">' + INSERT_ICO.image + ' Photos</button>' +
          '<button type="button" class="pn-btn sm" data-act="st-camera-pick">' + INSERT_ICO.camera + ' Camera</button>' +
          '<button type="button" class="pn-btn sm" data-act="st-scan-page">' + INSERT_ICO.scan + ' Scan into page</button>' +
        '</div>';
    } else if (v.tool === "elements") {
      insertOpt.hidden = false;
      insertOpt.innerHTML =
        '<div class="st-insert-strip">' +
          '<button type="button" class="pn-btn sm pri" data-act="st-open-stickers">' + INSERT_ICO.sparkle + ' Sticker Tray</button>' +
        '</div>';
    } else if (v.tool === "laser") {
      insertOpt.hidden = false;
      insertOpt.innerHTML =
        '<div class="st-laser-strip" role="group" aria-label="Laser options">' +
          '<button type="button" class="st-ink-seg' + (laserMode === 'trail' ? ' on' : '') + '" data-act="st-laser-trail" aria-pressed="' + (laserMode === 'trail') + '">Fade in 5 s</button>' +
          '<button type="button" class="st-ink-seg' + (laserMode === 'keep' ? ' on' : '') + '" data-act="st-laser-keep" aria-pressed="' + (laserMode === 'keep') + '">Keep</button>' +
          '<button type="button" class="st-ink-seg' + (laserMode === 'dot' ? ' on' : '') + '" data-act="st-laser-dot" aria-pressed="' + (laserMode === 'dot') + '">Dot</button>' +
          LASER_COLORS.map(function (c) { return '<button type="button" class="st-laser-col' + (laserColor === c ? ' on' : '') + '" data-act="st-laser-color" data-v="' + c + '" aria-label="Laser colour ' + c + '" aria-pressed="' + (laserColor === c) + '" style="--lc:' + c + '"></button>'; }).join('') +
          '<button type="button" class="st-ink-seg" data-act="st-laser-clear">Clear</button>' +
        '</div>';
    } else {
      insertOpt.hidden = true;
      insertOpt.innerHTML = "";
      hideFormatBar();
    }
  }

  /* ---- Undo / Redo for item modification ---- */
  function flipItemMod(op, undone) {
    var v = V();
    if (!v || !v.items) return;
    var item = v.items.find(function (it) { return it.id === op.id; });
    if (!item) return;
    var state = undone ? op.before : op.after;
    if (state.x !== undefined) item.x = state.x;
    if (state.y !== undefined) item.y = state.y;
    if (state.w !== undefined) item.w = state.w;
    if (state.h !== undefined) item.h = state.h;
    if (state.rot !== undefined) item.rot = state.rot;
    if (state.data) {
      for (var k in state.data) item.data[k] = state.data[k];
    }
    S().put("items", item);
    var pNum = S().posOf(item.page);
    if (v.pg[pNum]) renderPageItems(pNum, v.pg[pNum]);
  }

  /* ---- Draw Item to Canvas for Flattened Export ---- */
  function drawItemToCanvas(ctx, item, cw, ch) {
    if (!item || item.gone) return;
    var ix = item.x * cw, iy = item.y * ch, iw = item.w * cw, ih = item.h * ch;
    ctx.save();
    if (item.rot) {
      ctx.translate(ix + iw / 2, iy + ih / 2);
      ctx.rotate((item.rot * Math.PI) / 180);
      ctx.translate(-(ix + iw / 2), -(iy + ih / 2));
    }

    if (item.kind === "text") {
      var d = item.data || {};
      if (d.fill && d.fill !== "transparent") {
        ctx.fillStyle = d.fill;
        ctx.fillRect(ix, iy, iw, ih);
      }
      if (d.border && d.border !== "none") {
        ctx.strokeStyle = "#42cdb5";
        ctx.lineWidth = 2;
        ctx.strokeRect(ix, iy, iw, ih);
      }
      ctx.fillStyle = d.color || "#111111";
      var fSize = Math.max(10, Math.round((d.size || 16) * (cw / 400)));
      ctx.font = fSize + "px " + (FONTS[d.font] || FONTS.sans);
      ctx.textBaseline = "top";

      var lines = String(d.text || "").split("\n");
      var curY = iy + 4;
      lines.forEach(function (ln) {
        ctx.fillText(ln, ix + 4, curY, iw - 8);
        curY += fSize * 1.3;
      });
    } else if (item.kind === "image" && item.data && item.data.src) {
      var img = new G.Image();
      img.src = item.data.src;
      if (img.complete && img.naturalWidth) {
        ctx.drawImage(img, ix, iy, iw, ih);
      }
    }
    ctx.restore();
  }

  /* ---- Action Router (Called by study.js act) ---- */
  function act(a, el, h, v) {
    if (a === "st-tool" && el && el.getAttribute("data-v") === "elements") {
      showStickerTray();
      return false;
    }
    // Laser mode switches
    if (a === "st-laser-trail" || a === "st-laser-keep" || a === "st-laser-dot") {
      laserMode = a === "st-laser-keep" ? "keep" : a === "st-laser-dot" ? "dot" : "trail";
      laserSave("mode", laserMode);
      if (laserMode === "trail") laserStrokes.forEach(function (st) { if (st.lift) st.lift = Date.now(); });
      if (laserStrokes.length) startLaserLoop(laserStrokes[0].n);
      syncTb(v, h.root());
      return true;
    }
    if (a === "st-laser-color") {
      laserColor = el.getAttribute("data-v") || laserColor;
      laserSave("color", laserColor);
      syncTb(v, h.root());
      return true;
    }
    if (a === "st-laser-clear") {
      clearLaser();
      return true;
    }

    // Stickers
    if (a === "st-open-stickers") {
      showStickerTray();
      return true;
    }
    if (a === "st-close-stickers") {
      closeStickerTray();
      return true;
    }
    if (a === "st-insert-sticker") {
      var sName = el.getAttribute("data-name");
      var svg = STICKERS[sName];
      if (svg && v) {
        var n = v.cur || 1;
        var sItem = makeItem(v.id, S().pid(n), "sticker", 0.35, 0.35, 0.25, 0.25 * (v.ratio || 1.414), {
          name: sName,
          svg: svg,
          color: "#42cdb5"
        });
        v.items.push(sItem);
        S().put("items", sItem);
        S().pushUndo({ t: "add", id: sItem.id });
        selectedItemId = sItem.id;
        if (v.pg[n]) renderPageItems(n, v.pg[n]);
        closeStickerTray();
        if (h && h.toast) h.toast("Sticker inserted.");
      }
      return true;
    }
    if (a === "st-insert-saved-elem") {
      var idx = parseInt(el.getAttribute("data-idx"), 10);
      try {
        var userElems = JSON.parse(G.localStorage.getItem("smd_study_elements") || "[]");
        var ue = userElems[idx];
        if (ue && v) {
          var n2 = v.cur || 1;
          var ueItem = makeItem(v.id, S().pid(n2), "sticker", 0.35, 0.35, 0.3, 0.3 * (v.ratio || 1.414), {
            name: ue.name,
            svg: ue.svg,
            color: "#42cdb5"
          });
          v.items.push(ueItem);
          S().put("items", ueItem);
          S().pushUndo({ t: "add", id: ueItem.id });
          selectedItemId = ueItem.id;
          if (v.pg[n2]) renderPageItems(n2, v.pg[n2]);
          closeStickerTray();
          if (h && h.toast) h.toast("Inserted element: " + ue.name);
        }
      } catch (x) {}
      return true;
    }

    // Image & Camera
    if (a === "st-img-pick") {
      pickImageFile();
      return true;
    }
    if (a === "st-camera-pick") {
      pickCamera();
      return true;
    }
    if (a === "st-scan-page") {
      scanIntoPage();
      return true;
    }

    // Crop actions
    if (a === "st-img-crop") {
      var cId = el.getAttribute("data-id");
      startCrop(cId);
      return true;
    }
    if (a === "st-crop-cancel") {
      closeCrop();
      return true;
    }
    if (a === "st-crop-apply") {
      applyCrop();
      return true;
    }

    // Item deletion & duplication
    if (a === "st-item-del") {
      var dId = el.getAttribute("data-id");
      if (v && v.items) {
        var it = v.items.find(function (x) { return x.id === dId; });
        if (it) {
          it.gone = true;
          S().put("items", it);
          S().pushUndo({ t: "del", ids: [dId] });
          selectedItemId = null;
          var pgN = S().posOf(it.page);
          if (v.pg[pgN]) renderPageItems(pgN, v.pg[pgN]);
          if (h && h.toast) h.toast("Item deleted.");
        }
      }
      return true;
    }
    if (a === "st-item-copy") {
      var cpId = el.getAttribute("data-id");
      if (v && v.items) {
        var it2 = v.items.find(function (x) { return x.id === cpId; });
        if (it2) {
          var copy = makeItem(v.id, it2.page, it2.kind, Math.min(0.9, it2.x + 0.04), Math.min(0.9, it2.y + 0.04), it2.w, it2.h, JSON.parse(JSON.stringify(it2.data)));
          v.items.push(copy);
          S().put("items", copy);
          S().pushUndo({ t: "add", id: copy.id });
          selectedItemId = copy.id;
          var pgN2 = S().posOf(copy.page);
          if (v.pg[pgN2]) renderPageItems(pgN2, v.pg[pgN2]);
          if (h && h.toast) h.toast("Item duplicated.");
        }
      }
      return true;
    }

    // Format bar buttons
    if (a === "st-fb-prev" || a === "st-fb-next") {
      var sel = G.getSelection();
      if (sel && sel.modify) {
        sel.modify("move", a === "st-fb-prev" ? "backward" : "forward", "character");
      }
      return true;
    }
    if (a === "st-fb-hidekb") {
      if (D.activeElement && D.activeElement.blur) D.activeElement.blur();
      hideFormatBar();
      return true;
    }
    if (a === "st-fb-styles") {
      if (activeEditingTextId && v) {
        var curIt = v.items.find(function (x) { return x.id === activeEditingTextId; });
        if (curIt) showStyleSheet(curIt);
      }
      return true;
    }
    if (a === "st-fb-close-styles") {
      closeStyleSheet();
      return true;
    }
    if (a === "st-fb-b") {
      D.execCommand("bold", false, null);
      return true;
    }
    if (a === "st-fb-i") {
      D.execCommand("italic", false, null);
      return true;
    }
    if (a === "st-fb-u") {
      D.execCommand("underline", false, null);
      return true;
    }
    if (a === "st-fb-s") {
      D.execCommand("strikeThrough", false, null);
      return true;
    }
    if (a === "st-fb-mic") {
      // Dictation
      var Speech = G.SpeechRecognition || G.webkitSpeechRecognition;
      if (Speech) {
        var rec = new Speech();
        rec.lang = "en-US";
        rec.continuous = false;
        rec.interimResults = false;
        rec.onresult = function (ev) {
          if (ev.results && ev.results[0] && ev.results[0][0]) {
            var transcript = ev.results[0][0].transcript;
            D.execCommand("insertText", false, transcript);
          }
        };
        rec.onerror = function () { h.toast("Dictation error."); };
        rec.start();
        h.toast("Listening...");
      } else {
        h.toast("Dictation not supported on this device.");
      }
      return true;
    }
    if (a === "st-fb-return") {
      D.execCommand("insertParagraph", false, null);
      return true;
    }

    // Text formatting presets
    if (a === "st-set-preset" || a === "st-tb-set-preset") {
      var pres = el.getAttribute("data-v");
      curTextPreset = pres;
      if (activeEditingTextId && v) {
        var itText = v.items.find(function (x) { return x.id === activeEditingTextId; });
        if (itText) {
          itText.data.preset = pres;
          itText.data.size = STYLES[pres].size;
          S().put("items", itText);
          var pN = S().posOf(itText.page);
          if (v.pg[pN]) renderPageItems(pN, v.pg[pN]);
        }
      }
      if (v) syncTb(v, h.root());
      return true;
    }
    if (a === "st-set-font" || a === "st-tb-set-font") {
      var fnt = el.getAttribute("data-v");
      curFont = fnt;
      if (activeEditingTextId && v) {
        var itFont = v.items.find(function (x) { return x.id === activeEditingTextId; });
        if (itFont) {
          itFont.data.font = fnt;
          S().put("items", itFont);
          var pN2 = S().posOf(itFont.page);
          if (v.pg[pN2]) renderPageItems(pN2, v.pg[pN2]);
        }
      }
      if (v) syncTb(v, h.root());
      return true;
    }
    if (a === "st-set-align" || a === "st-tb-set-align") {
      var alg = el.getAttribute("data-v");
      curAlign = alg;
      if (activeEditingTextId && v) {
        var itAlg = v.items.find(function (x) { return x.id === activeEditingTextId; });
        if (itAlg) {
          itAlg.data.align = alg;
          S().put("items", itAlg);
          var pN3 = S().posOf(itAlg.page);
          if (v.pg[pN3]) renderPageItems(pN3, v.pg[pN3]);
        }
      }
      if (v) syncTb(v, h.root());
      return true;
    }
    if (a === "st-set-fill") {
      var fil = el.getAttribute("data-v");
      curFill = fil;
      if (activeEditingTextId && v) {
        var itFil = v.items.find(function (x) { return x.id === activeEditingTextId; });
        if (itFil) {
          itFil.data.fill = fil;
          S().put("items", itFil);
          var pN4 = S().posOf(itFil.page);
          if (v.pg[pN4]) renderPageItems(pN4, v.pg[pN4]);
        }
      }
      return true;
    }
    if (a === "st-set-border") {
      var bor = el.getAttribute("data-v");
      curBorder = bor;
      if (activeEditingTextId && v) {
        var itBor = v.items.find(function (x) { return x.id === activeEditingTextId; });
        if (itBor) {
          itBor.data.border = bor;
          S().put("items", itBor);
          var pN5 = S().posOf(itBor.page);
          if (v.pg[pN5]) renderPageItems(pN5, v.pg[pN5]);
        }
      }
      return true;
    }

    // Lasso AI chips
    if (a === "st-lasso-ai-explain") {
      handleLassoAi("explain");
      return true;
    }
    if (a === "st-lasso-ai-summary") {
      handleLassoAi("summary");
      return true;
    }
    if (a === "st-lasso-ai-make") {
      handleLassoAi("make");
      return true;
    }
    if (a === "st-lasso-save-elem") {
      saveSelectionAsElement();
      return true;
    }

    return false;
  }

  function back(root) {
    if (D.getElementById("stCropOverlay")) {
      closeCrop();
      return true;
    }
    if (D.getElementById("stStyleSheet")) {
      closeStyleSheet();
      return true;
    }
    if (D.getElementById("stStickerTray")) {
      closeStickerTray();
      return true;
    }
    if (D.getElementById("stFormatBar")) {
      hideFormatBar();
      return true;
    }
    if (selectedItemId) {
      selectedItemId = null;
      Array.prototype.forEach.call(D.querySelectorAll(".st-item.selected"), function (el) {
        el.classList.remove("selected");
      });
      return true;
    }
    return false;
  }

  G.STUDY_INSERT = {
    _pure: PURE,
    act: act,
    back: back,
    syncTb: syncTb,
    renderPageItems: renderPageItems,
    onPageFree: onPageFree,
    laserDown: laserDown,
    laserMove: laserMove,
    laserUp: laserUp,
    flipItemMod: flipItemMod,
    drawItemToCanvas: drawItemToCanvas,
    compressImage: compressImage,
    insertImageFromDataUrl: insertImageFromDataUrl,
    insertImageFromFile: insertImageFromFile,
    deleteItem: deleteItemById,
    ICO: {
      text: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><polyline points="4 7 4 4 20 4 20 7"/><line x1="12" y1="4" x2="12" y2="20"/></svg>',
      image: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
      elements: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
      laser: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="m13 13 6 6"/><circle cx="20" cy="20" r="1"/></svg>'
    }
  };

})(typeof window !== "undefined" ? window : this);
