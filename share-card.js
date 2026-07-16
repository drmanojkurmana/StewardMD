/* StewardMD — Achievement share card (Hero Band).
 * ---------------------------------------------------------------------------
 * Renders the doctor's learning achievement as a designed PNG (NOT a screenshot)
 * via Canvas 2D — the real teal StewardMD mark, the doctor's Google photo, level,
 * streak, and Knowledge Units — then shares it to WhatsApp / Instagram / etc.
 *
 * Recreates the "Hero Band" design (claude.ai/design handoff) pixel-faithfully in
 * three formats: portrait 1080×1350 (default), story 1080×1920, landscape 1200×630.
 * Native sharing uses @capacitor/share + @capacitor/filesystem (already installed);
 * the web build uses the Web Share API (files) with a download fallback. All data
 * comes from SMD_KU.summary() + SMD_ACCOUNT.profile() + Firebase creationTime.
 *
 *   window.SMD_SHARECARD.open()               → open the share sheet (preview + caption)
 *   window.SMD_SHARECARD.render(format)        → Promise<HTMLCanvasElement>
 *   window.SMD_SHARECARD.share(format, caption)→ Promise (native/web share or download)
 */
(function () {
  "use strict";
  if (window.SMD_SHARECARD) return;

  var TEAL = "#0E6A5F", TEAL_D = "#0A4A42", INK = "#10241F", MUT = "#5E7E78", TINT = "#EAF4F1", HAIR = "#E6EFEC", AMBER = "#F4A62A", AMBER_L = "#FCD8A0";
  var FONT = "'Inter','SF Pro Display',-apple-system,'Segoe UI',Roboto,sans-serif";
  var FLAME_D = "M13 1c.4 4.3-1.1 6.6-2.4 8C9 10.6 6 13.2 6 18.5 6 24.9 9.6 30 15 30s9-4.4 9-10.4c0-5-2.9-8.4-4.8-10.6-.6 2.3-2 3.3-2.9 3.3-1.5 0-1.3-3.2-1.3-7.6C14 3.2 13.6 1.8 13 1Z";
  var FLAME_D2 = "M15 30c-3.4 0-5.6-2.4-5.6-5.4 0-2.6 1.7-4 2.7-5.2.2 1.5 1 2.2 1.9 2.2 1.1 0 1.7-1 1.7-2.6 1.3 1.3 2.7 3.1 2.7 5.5C18.4 27.6 16.5 30 15 30Z";
  // Decorative QR modules (design coords, viewBox 100×100).
  var QR_FINDERS = [[8, 8], [66, 8], [8, 66]];
  var QR_DOTS = [[44, 10], [52, 18], [44, 44], [54, 52], [66, 52], [78, 60], [52, 66], [66, 72], [80, 80], [44, 80]];

  var FORMATS = {
    portrait: { w: 1080, h: 1350 },
    story: { w: 1080, h: 1920 },
    landscape: { w: 1200, h: 630 }
  };

  var _imgCache = {};
  function loadImage(src, cross) {
    if (_imgCache[src] && _imgCache[src].__done) return Promise.resolve(_imgCache[src]);
    return new Promise(function (resolve) {
      var img = new Image();
      if (cross) img.crossOrigin = "anonymous";
      img.onload = function () { img.__done = true; _imgCache[src] = img; resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  }

  function fmtNum(n) { try { return Number(n || 0).toLocaleString("en-US"); } catch (e) { return String(n || 0); } }
  function initialsOf(name) {
    return String(name || "").replace(/^(dr\.?|prof\.?|mr\.?|ms\.?|mrs\.?)\s+/i, "").trim().split(/\s+/).filter(Boolean)
      .slice(0, 2).map(function (w) { return w[0].toUpperCase(); }).join("") || "MD";
  }
  function memberSince() {
    try {
      var u = window.firebase && firebase.auth && firebase.auth().currentUser;
      var t = u && u.metadata && (u.metadata.creationTime || u.metadata.createdAt);
      if (t) return new Date(t).toLocaleString("en-US", { month: "short", year: "numeric" });
    } catch (e) {}
    return "";
  }
  function bigPhoto(url) { return String(url || "").replace(/=s\d+(-c)?$/, "=s512-c").replace(/\/s\d+-c\//, "/s512-c/"); }

  // Gather everything the card shows. Prefer the freshest server summary; fall back to cache.
  function gather() {
    var p = {}; try { p = (window.SMD_ACCOUNT && SMD_ACCOUNT.profile && SMD_ACCOUNT.profile()) || {}; } catch (e) {}
    var s = null; try { s = (window.SMD_KU && SMD_KU._cache && SMD_KU._cache()) || null; } catch (e) {}
    if (!s) { try { s = JSON.parse(localStorage.getItem("stewardmd_ku_" + (p.uid || "guest")) || "null"); } catch (e) {} }
    s = s || {};
    var name = p.name || "Doctor";
    return {
      name: name,
      initials: initialsOf(name),
      photoUrl: bigPhoto(p.picture),
      streakDays: s.streak || 0,
      knowledgeUnits: fmtNum(s.balance || 0),
      level: s.level || 1,
      levelName: s.levelName || "Intern",
      memberSince: memberSince(),
      subtitle: "Evidence-based clinical learning"
    };
  }

  function caption(d) {
    return "Committed to continuous evidence-based learning — a " + d.streakDays + "-day StewardMD learning streak and " + d.knowledgeUnits +
      " Knowledge Units so far. Level " + d.level + " · " + d.levelName + ".\n\n#StewardMD #MedicalEducation #EvidenceBasedMedicine #DoctorLife";
  }

  // ── canvas helpers ──
  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function setLS(ctx, px) { try { ctx.letterSpacing = px + "px"; } catch (e) {} }
  function drawFlame(ctx, x, y, w, h) {
    ctx.save(); ctx.translate(x, y); ctx.scale(w / 24, h / 32);
    ctx.fillStyle = AMBER; ctx.fill(new Path2D(FLAME_D));
    ctx.fillStyle = AMBER_L; ctx.fill(new Path2D(FLAME_D2));
    ctx.restore();
  }
  function drawQR(ctx, x, y, size) {
    rr(ctx, x, y, size, size, size * 0.16); ctx.fillStyle = "#fff"; ctx.fill();
    ctx.lineWidth = Math.max(1, size * 0.011); ctx.strokeStyle = HAIR; ctx.stroke();
    var pad = size * 0.08, in_ = size - pad * 2, u = in_ / 100;
    function px(a) { return x + pad + a * u; }
    ctx.fillStyle = TEAL_D;
    QR_FINDERS.forEach(function (f) {
      rr(ctx, px(f[0]), y + pad + f[1] * u, 26 * u, 26 * u, 4 * u); ctx.fill();
      ctx.save(); ctx.fillStyle = "#fff"; rr(ctx, px(f[0] + 6), y + pad + (f[1] + 6) * u, 14 * u, 14 * u, 2 * u); ctx.fill(); ctx.restore();
      ctx.fillStyle = TEAL_D; ctx.fillRect(px(f[0] + 10), y + pad + (f[1] + 10) * u, 6 * u, 6 * u);
    });
    QR_DOTS.forEach(function (dpt) { ctx.fillRect(px(dpt[0]), y + pad + dpt[1] * u, 6 * u, 6 * u); });
  }
  function drawAvatar(ctx, cx, cy, outer, pad, d, photoImg) {
    ctx.save();
    ctx.shadowColor = "rgba(10,74,66,.38)"; ctx.shadowBlur = outer * 0.22; ctx.shadowOffsetY = outer * 0.09;
    ctx.beginPath(); ctx.arc(cx, cy, outer / 2, 0, 7); ctx.fillStyle = "#fff"; ctx.fill();
    ctx.restore();
    var r = outer / 2 - pad;
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.clip();
    if (photoImg) {
      var s = Math.min(photoImg.width, photoImg.height);
      ctx.drawImage(photoImg, (photoImg.width - s) / 2, (photoImg.height - s) / 2, s, s, cx - r, cy - r, r * 2, r * 2);
    } else {
      ctx.fillStyle = TINT; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill();
      ctx.fillStyle = TEAL; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = "600 " + Math.round(r * 0.92) + "px " + FONT;
      ctx.fillText(d.initials, cx, cy + r * 0.04);
    }
    ctx.restore();
  }
  // Centered pill with two text segments separated by a dot: [big label] · [name]
  function drawLevelPill(ctx, cx, top, S, d) {
    var padV = S.pillPadV, padH = S.pillPadH, gap = 12, dot = 5;
    ctx.textBaseline = "middle";
    ctx.font = "600 " + S.lvlSize + "px " + FONT; setLS(ctx, 1);
    var t1 = "LEVEL " + d.level, w1 = ctx.measureText(t1).width; setLS(ctx, 0);
    ctx.font = "500 " + S.lvlNameSize + "px " + FONT;
    var t2 = String(d.levelName || ""), w2 = ctx.measureText(t2).width;
    var contentW = w1 + gap + dot + gap + w2, pillW = contentW + padH * 2, pillH = Math.max(S.lvlSize, S.lvlNameSize) + padV * 2;
    var x = cx - pillW / 2, y = top;
    rr(ctx, x, y, pillW, pillH, pillH / 2); ctx.fillStyle = TINT; ctx.fill();
    var midY = y + pillH / 2, tx = x + padH;
    ctx.textAlign = "left"; ctx.fillStyle = TEAL; ctx.font = "600 " + S.lvlSize + "px " + FONT; setLS(ctx, 1);
    ctx.fillText(t1, tx, midY); tx += w1 + gap; setLS(ctx, 0);
    ctx.fillStyle = "#9DC3BB"; ctx.beginPath(); ctx.arc(tx + dot / 2, midY, dot / 2, 0, 7); ctx.fill(); tx += dot + gap;
    ctx.fillStyle = TEAL_D; ctx.font = "500 " + S.lvlNameSize + "px " + FONT; ctx.fillText(t2, tx, midY);
    ctx.textAlign = "center";
    return pillH;
  }
  function drawKuPill(ctx, cx, top, S, d) {
    var padV = S.kuPadV, padH = S.kuPadH, gap = 16;
    ctx.textBaseline = "middle";
    ctx.font = "600 " + S.kuNumSize + "px " + FONT; var w1 = ctx.measureText(d.knowledgeUnits).width;
    ctx.font = "500 " + S.kuLblSize + "px " + FONT; var w2 = ctx.measureText("Knowledge Units").width;
    var contentW = w1 + gap + w2, pillW = contentW + padH * 2, pillH = S.kuNumSize + padV * 2;
    var x = cx - pillW / 2, y = top, midY = y + pillH / 2;
    rr(ctx, x, y, pillW, pillH, pillH / 2); ctx.fillStyle = TINT; ctx.fill();
    ctx.textAlign = "left";
    ctx.fillStyle = TEAL_D; ctx.font = "600 " + S.kuNumSize + "px " + FONT; ctx.fillText(d.knowledgeUnits, x + padH, midY);
    ctx.fillStyle = MUT; ctx.font = "500 " + S.kuLblSize + "px " + FONT; ctx.fillText("Knowledge Units", x + padH + w1 + gap, midY);
    ctx.textAlign = "center";
    return pillH;
  }
  function drawFooter(ctx, W, H, S, markTeal) {
    var y = H - S.footH;
    ctx.strokeStyle = HAIR; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    var cy = y + S.footH / 2;
    if (markTeal) ctx.drawImage(markTeal, S.padH, cy - S.footMark / 2, S.footMark, S.footMark);
    ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillStyle = TEAL; ctx.font = "500 " + S.dlSize + "px " + FONT;
    ctx.fillText("Download StewardMD", S.padH + S.footMark + 14, cy);
    drawQR(ctx, W - S.padH - S.qr, cy - S.qr / 2, S.qr);
    ctx.textAlign = "center";
  }

  // ── vertical layouts (portrait + story) ──
  var VSTYLE = {
    portrait: { bandH: 452, wmW: 660, wmX: 590, wmY: -150, lockMarkS: 64, lockMarkX: 80, lockMarkY: 76, titleX: 164, titleSize: 40, subSize: 20, avTop: 322, avOuter: 232, avPad: 8, cTop: 596, nameSize: 56, pillPadV: 11, pillPadH: 24, lvlSize: 22, lvlNameSize: 24, memGap: 14, memSize: 22, streakGap: 40, flameW: 86, flameH: 118, numSize: 210, numLS: -8, dayGap: 8, daySize: 32, kuGap: 40, kuPadV: 22, kuPadH: 40, kuNumSize: 42, kuLblSize: 27, padH: 80, footH: 168, footMark: 30, dlSize: 25, qr: 88 },
    story: { bandH: 620, wmW: 760, wmX: 510, wmY: -170, lockMarkS: 70, lockMarkX: 80, lockMarkY: 96, titleX: 172, titleSize: 44, subSize: 22, avTop: 452, avOuter: 280, avPad: 10, cTop: 800, nameSize: 64, pillPadV: 14, pillPadH: 30, lvlSize: 25, lvlNameSize: 27, memGap: 18, memSize: 25, streakGap: 80, flameW: 118, flameH: 162, numSize: 290, numLS: -12, dayGap: 10, daySize: 38, kuGap: 70, kuPadV: 28, kuPadH: 52, kuNumSize: 52, kuLblSize: 32, padH: 90, footH: 210, footMark: 36, dlSize: 30, qr: 106 }
  };

  function drawVertical(ctx, W, H, S, d, imgs) {
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
    // teal band + watermark
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, S.bandH); ctx.clip();
    var g = ctx.createLinearGradient(0, 0, W, S.bandH); g.addColorStop(0, TEAL); g.addColorStop(1, TEAL_D);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, S.bandH);
    if (imgs.white) { ctx.globalAlpha = 0.13; ctx.drawImage(imgs.white, S.wmX, S.wmY, S.wmW, S.wmW); ctx.globalAlpha = 1; }
    ctx.restore();
    // lockup
    if (imgs.white) ctx.drawImage(imgs.white, S.lockMarkX, S.lockMarkY, S.lockMarkS, S.lockMarkS);
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#fff"; ctx.font = "600 " + S.titleSize + "px " + FONT;
    ctx.fillText("StewardMD", S.titleX, S.lockMarkY + S.titleSize * 0.9);
    ctx.fillStyle = "rgba(234,244,241,.82)"; ctx.font = "400 " + S.subSize + "px " + FONT;
    ctx.fillText(d.subtitle, S.titleX, S.lockMarkY + S.titleSize + S.subSize + 4);
    // avatar
    drawAvatar(ctx, W / 2, S.avTop + S.avOuter / 2, S.avOuter, S.avPad, d, imgs.photo);
    // content
    ctx.textAlign = "center";
    var y = S.cTop;
    ctx.textBaseline = "top"; ctx.fillStyle = INK; ctx.font = "600 " + S.nameSize + "px " + FONT;
    ctx.fillText(d.name, W / 2, y); y += S.nameSize + 16;
    y += drawLevelPill(ctx, W / 2, y, S, d) + S.memGap;
    ctx.textBaseline = "top"; ctx.textAlign = "center"; ctx.fillStyle = MUT; ctx.font = "400 " + S.memSize + "px " + FONT;
    if (d.memberSince) { ctx.fillText("Member since " + d.memberSince, W / 2, y); y += S.memSize; }
    y += S.streakGap;
    // streak row: flame + big number, centered as a group
    ctx.font = "600 " + S.numSize + "px " + FONT; setLS(ctx, S.numLS);
    var numW = ctx.measureText(String(d.streakDays)).width; setLS(ctx, 0);
    var groupW = S.flameW + 18 + numW, gx = W / 2 - groupW / 2;
    var rowTop = y, rowH = S.numSize * 0.82;
    drawFlame(ctx, gx, rowTop + (rowH - S.flameH) / 2, S.flameW, S.flameH);
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = TEAL; ctx.font = "600 " + S.numSize + "px " + FONT; setLS(ctx, S.numLS);
    ctx.fillText(String(d.streakDays), gx + S.flameW + 18, rowTop + rowH * 0.98); setLS(ctx, 0);
    ctx.textAlign = "center";
    y = rowTop + rowH + S.dayGap;
    ctx.textBaseline = "top"; ctx.fillStyle = INK; ctx.font = "500 " + S.daySize + "px " + FONT;
    ctx.fillText("day learning streak", W / 2, y); y += S.daySize + S.kuGap;
    drawKuPill(ctx, W / 2, y, S, d);
    // footer
    drawFooter(ctx, W, H, S, imgs.teal);
  }

  // ── landscape (split) ──
  function drawLandscape(ctx, W, H, d, imgs) {
    var LP = 470;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
    // left teal panel
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, LP, H); ctx.clip();
    var g = ctx.createLinearGradient(0, 0, LP, H); g.addColorStop(0, TEAL); g.addColorStop(1, TEAL_D);
    ctx.fillStyle = g; ctx.fillRect(0, 0, LP, H);
    if (imgs.white) { ctx.globalAlpha = 0.12; ctx.drawImage(imgs.white, -130, 330, 440, 440); ctx.globalAlpha = 1; }
    ctx.restore();
    if (imgs.white) ctx.drawImage(imgs.white, 48, 48, 44, 44);
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = "#fff"; ctx.font = "600 28px " + FONT;
    ctx.fillText("StewardMD", 108, 74);
    ctx.fillStyle = "rgba(234,244,241,.8)"; ctx.font = "400 14px " + FONT; ctx.fillText(d.subtitle, 108, 96);
    // centered profile group in left panel
    var cx = LP / 2, gy = H / 2 - 150;
    drawAvatar(ctx, cx, gy + 84, 168, 7, d, imgs.photo);
    ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillStyle = "#fff"; ctx.font = "600 34px " + FONT;
    ctx.fillText(d.name, cx, gy + 190);
    // level pill (translucent on teal)
    ctx.font = "600 17px " + FONT; setLS(ctx, 1); var t1 = "LEVEL " + d.level, w1 = ctx.measureText(t1).width; setLS(ctx, 0);
    ctx.font = "500 19px " + FONT; var t2 = String(d.levelName), w2 = ctx.measureText(t2).width;
    var gap = 11, dot = 4, contentW = w1 + gap + dot + gap + w2, pillW = contentW + 40, ph = 42, px = cx - pillW / 2, py = gy + 236;
    rr(ctx, px, py, pillW, ph, ph / 2); ctx.fillStyle = "rgba(255,255,255,.1)"; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = "rgba(255,255,255,.18)"; ctx.stroke();
    ctx.textAlign = "left"; ctx.textBaseline = "middle"; var tx = px + 20, my = py + ph / 2;
    ctx.fillStyle = AMBER; ctx.font = "600 17px " + FONT; setLS(ctx, 1); ctx.fillText(t1, tx, my); tx += w1 + gap; setLS(ctx, 0);
    ctx.fillStyle = "rgba(255,255,255,.4)"; ctx.beginPath(); ctx.arc(tx + dot / 2, my, dot / 2, 0, 7); ctx.fill(); tx += dot + gap;
    ctx.fillStyle = "rgba(234,244,241,.94)"; ctx.font = "500 19px " + FONT; ctx.fillText(t2, tx, my);
    // right content
    var rx = LP + 70;
    drawFlame(ctx, rx, H / 2 - 150, 94, 128);
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = TEAL; ctx.font = "600 180px " + FONT; setLS(ctx, -8);
    ctx.fillText(String(d.streakDays), rx + 110, H / 2 - 22); setLS(ctx, 0);
    ctx.textBaseline = "top"; ctx.fillStyle = INK; ctx.font = "500 34px " + FONT; ctx.fillText("day learning streak", rx, H / 2 + 30);
    // ku pill
    ctx.font = "600 42px " + FONT; var k1 = ctx.measureText(d.knowledgeUnits).width; ctx.font = "500 26px " + FONT; var k2 = ctx.measureText("Knowledge Units").width;
    var kw = k1 + 16 + k2 + 76, kh = 86, ky = H / 2 + 92;
    rr(ctx, rx, ky, kw, kh, kh / 2); ctx.fillStyle = TINT; ctx.fill();
    ctx.textBaseline = "middle"; ctx.fillStyle = TEAL_D; ctx.font = "600 42px " + FONT; ctx.fillText(d.knowledgeUnits, rx + 38, ky + kh / 2);
    ctx.fillStyle = MUT; ctx.font = "500 26px " + FONT; ctx.fillText("Knowledge Units", rx + 38 + k1 + 16, ky + kh / 2);
    // footer (right side)
    var fy = H - 88;
    if (imgs.teal) ctx.drawImage(imgs.teal, rx, fy + 4, 28, 28);
    ctx.textBaseline = "middle"; ctx.fillStyle = TEAL; ctx.font = "500 23px " + FONT; ctx.fillText("Download StewardMD", rx + 40, fy + 18);
    drawQR(ctx, W - 70 - 80, fy - 12, 80);
    ctx.textAlign = "center";
  }

  function render(format, forceInitials) {
    format = FORMATS[format] ? format : "portrait";
    var F = FORMATS[format];
    var d = gather();
    var assets = [loadImage("/mark-white.png"), loadImage("/mark-teal.png")];
    if (d.photoUrl && !forceInitials) assets.push(loadImage(d.photoUrl, true)); else assets.push(Promise.resolve(null));
    var ready = (document.fonts && document.fonts.ready) ? document.fonts.ready.catch(function () {}) : Promise.resolve();
    return Promise.all([ready].concat(assets)).then(function (r) {
      var imgs = { white: r[1], teal: r[2], photo: r[3] };
      var cv = document.createElement("canvas"); cv.width = F.w; cv.height = F.h;
      var ctx = cv.getContext("2d");
      if (format === "landscape") drawLandscape(ctx, F.w, F.h, d, imgs);
      else drawVertical(ctx, F.w, F.h, VSTYLE[format], d, imgs);
      // taint check: if the Google photo tainted the canvas, re-render with the initials fallback.
      if (imgs.photo && !forceInitials) { try { ctx.getImageData(0, 0, 1, 1); } catch (e) { return render(format, true); } }
      return cv;
    });
  }

  function canvasToBlob(cv) { return new Promise(function (res) { cv.toBlob(function (b) { res(b); }, "image/png", 0.98); }); }

  var C = window.Capacitor;
  var native = !!(C && (typeof C.isNativePlatform === "function" ? C.isNativePlatform() : (C.platform && C.platform !== "web")));

  function share(format, cap) {
    return render(format).then(canvasToBlob).then(function (blob) {
      if (!blob) throw new Error("render-failed");
      var fname = "stewardmd-streak-" + Date.now() + ".png";
      if (native && C.Plugins && C.Plugins.Filesystem && C.Plugins.Share) {
        return blobToBase64(blob).then(function (b64) {
          return C.Plugins.Filesystem.writeFile({ path: fname, data: b64, directory: "CACHE" }).then(function (w) {
            return C.Plugins.Share.share({ title: "My StewardMD learning streak", text: cap || "", url: w.uri, dialogTitle: "Share your achievement" });
          });
        });
      }
      var file = new File([blob], fname, { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file], text: cap || "", title: "My StewardMD learning streak" });
      }
      downloadBlob(blob, fname);
      try { if (navigator.clipboard && cap) navigator.clipboard.writeText(cap); } catch (e) {}
      if (window.SMD_toast) window.SMD_toast("Card downloaded" + (cap ? " · caption copied" : ""));
      return null;
    });
  }
  function blobToBase64(blob) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(String(r.result).split(",")[1]); }; r.onerror = rej; r.readAsDataURL(blob); }); }
  function downloadBlob(blob, name) { var u = URL.createObjectURL(blob); var a = document.createElement("a"); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 4000); }

  // ── share sheet UI (self-contained overlay) ──
  function open() {
    var d = gather(); var cap = caption(d); var format = "portrait";
    var ov = document.createElement("div");
    ov.setAttribute("data-smd-sharecard", "1");
    ov.style.cssText = "position:fixed;inset:0;z-index:100000;background:rgba(6,32,29,.55);backdrop-filter:blur(3px);display:flex;align-items:flex-end;justify-content:center;";
    ov.innerHTML =
      '<div style="background:var(--hpanel,#fff);color:var(--hink,#0f172a);width:100%;max-width:460px;max-height:92vh;overflow:auto;border-radius:22px 22px 0 0;padding:18px 18px 26px;font-family:' + FONT + '">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px"><div style="font-weight:600;font-size:16px">Share your achievement</div><button data-x style="border:0;background:transparent;font-size:22px;color:var(--hmut,#64748b);cursor:pointer;line-height:1">×</button></div>' +
      '<div data-preview style="display:flex;justify-content:center;align-items:center;min-height:220px;background:var(--hbg,#eef2f1);border-radius:14px;padding:12px;margin-bottom:12px"><div style="color:var(--hmut,#64748b);font-size:13px">Rendering…</div></div>' +
      '<div data-fmts style="display:flex;gap:8px;margin-bottom:12px"></div>' +
      '<textarea data-cap rows="4" style="width:100%;box-sizing:border-box;border:1px solid var(--hbd,#e2e8f0);border-radius:12px;padding:10px 12px;font:400 13px ' + FONT + ';color:var(--hink,#0f172a);background:var(--hpanel,#fff);resize:vertical;margin-bottom:12px"></textarea>' +
      '<div style="display:flex;gap:10px"><button data-dl style="flex:1;border:1px solid ' + TEAL + ';background:transparent;color:' + TEAL + ';font:600 14px ' + FONT + ';border-radius:999px;padding:12px;cursor:pointer">Download</button>' +
      '<button data-share style="flex:2;border:0;background:' + TEAL + ';color:#fff;font:600 14px ' + FONT + ';border-radius:999px;padding:12px;cursor:pointer">Share</button></div>' +
      '</div>';
    document.body.appendChild(ov);
    var capEl = ov.querySelector("[data-cap]"); capEl.value = cap;
    var preview = ov.querySelector("[data-preview]");
    var fmtsEl = ov.querySelector("[data-fmts]");
    [["portrait", "Post"], ["story", "Story"], ["landscape", "Link"]].forEach(function (f) {
      var b = document.createElement("button");
      b.textContent = f[1]; b.setAttribute("data-f", f[0]);
      b.style.cssText = "flex:1;border:1px solid var(--hbd,#e2e8f0);background:transparent;color:var(--hink,#0f172a);font:600 12.5px " + FONT + ";border-radius:10px;padding:9px;cursor:pointer";
      fmtsEl.appendChild(b);
    });
    function markFmt() { fmtsEl.querySelectorAll("[data-f]").forEach(function (b) { var on = b.getAttribute("data-f") === format; b.style.borderColor = on ? TEAL : "var(--hbd,#e2e8f0)"; b.style.color = on ? TEAL : "var(--hink,#0f172a)"; b.style.background = on ? TINT : "transparent"; }); }
    function refresh() {
      markFmt();
      preview.innerHTML = '<div style="color:var(--hmut,#64748b);font-size:13px">Rendering…</div>';
      render(format).then(function (cv) {
        var img = new Image(); img.src = cv.toDataURL("image/png");
        img.style.cssText = "max-width:100%;max-height:52vh;border-radius:10px;box-shadow:0 10px 30px -12px rgba(10,74,66,.4)";
        preview.innerHTML = ""; preview.appendChild(img);
      }).catch(function () { preview.innerHTML = '<div style="color:#c0392b;font-size:13px">Could not render card</div>'; });
    }
    fmtsEl.addEventListener("click", function (e) { var b = e.target.closest("[data-f]"); if (b) { format = b.getAttribute("data-f"); refresh(); } });
    function close() { ov.remove(); }
    ov.querySelector("[data-x]").addEventListener("click", close);
    ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
    ov.querySelector("[data-dl]").addEventListener("click", function () { render(format).then(canvasToBlob).then(function (b) { if (b) downloadBlob(b, "stewardmd-streak.png"); }); });
    ov.querySelector("[data-share]").addEventListener("click", function () {
      var btn = ov.querySelector("[data-share]"); btn.textContent = "Preparing…"; btn.disabled = true;
      share(format, capEl.value).then(function () { close(); }).catch(function () { btn.textContent = "Share"; btn.disabled = false; if (window.SMD_toast) window.SMD_toast("Couldn't share — try Download"); });
    });
    refresh();
  }

  window.SMD_SHARECARD = { open: open, render: render, share: share, _gather: gather, _caption: caption };
})();
