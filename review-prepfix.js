/* PrepNucleus content editor inside the Clinical review desk (window.SMD_PREPFIX). ES5, buildless.
 * Owners and registered signers (the tester doctors) open a reported question or lesson, correct its wording, explanation, key point
 * or figure, and Save: the fix goes live for every student within about 30 minutes (no app release). Server and rules:
 * functions/_prepfix.js and functions/api/prep/fix.js. The fix holds only what changed; the previous fix is merged in, so editing
 * the explanation twice never loses an earlier option edit. History (who, when, what) is shown per item and Revert removes the fix.
 * The desk (review-desk.js) lists the reports and calls: me(), open(report), active(), html(), act(cmd, arg), back handled here. */
(function (G) {
  "use strict";
  var D = G.document, P = null, ME = null;
  var API = G.SMD_PREP_FIX_API || "/api/prep/fix";
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function toast(m) { try { (G.toast || G.SMD_toast) && (G.toast || G.SMD_toast)(m); } catch (e) {} }
  function ms(n) { return '<span class="material-symbols-outlined kit-ic" aria-hidden="true">' + n + "</span>"; }
  function token() { try { var u = G.SMD_AUTH && G.SMD_AUTH.currentUser; return (u && u.getIdToken) ? u.getIdToken() : Promise.resolve(null); } catch (e) { return Promise.resolve(null); } }
  function api(method, qs, body, raw, type) {
    return token().then(function (t) {
      var h = {}; if (t) h.Authorization = "Bearer " + t;
      if (raw) h["Content-Type"] = type || "application/octet-stream"; else if (body) h["Content-Type"] = "application/json";
      return G.fetch(API + (qs || ""), { method: method, headers: h, body: raw || (body ? JSON.stringify(body) : undefined), cache: "no-store" });
    }).then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d || {} }; }, function () { return { status: r.status, data: {} }; }); }, function () { return { status: 0, data: {} }; });
  }
  function me() {
    if (ME) return ME;
    ME = api("GET", "?me=1").then(function (r) { return r.status === 200 ? r.data : { editor: false }; });
    return ME;
  }
  var ERR = { "bad-question": "The question needs at least 8 characters.", "bad-options": "Every option needs text (2 to 8 options).", "key-needed": "Pick which option is correct.", "bad-key": "The correct option is out of range.",
    "bad-explanation": "The explanation cannot be empty.", "bad-image": "That image is not accepted.", "empty-fix": "Nothing changed yet.", "bad-title": "The title cannot be empty.", "bad-text": "A step's text cannot be empty.", "bad-steps": "A step is out of range.",
    forbidden: "Only owners and registered signers can edit.", "image-too-large": "That image is too large after shrinking. Try a smaller one.", "image-only": "That file is not an image.", "not-configured": "The server is not set up for this yet." };
  function errText(r) { return ERR[(r.data && r.data.error) || ""] || (r.status === 0 ? "No connection. Try again." : "Could not save (" + (r.status || "error") + ").") ; }

  /* ---------- pure helpers (also used by the tests through SMD_PREPFIX._pure) ---------- */
  function strip(fx) { var o = {}, k; for (k in (fx || {})) if (k !== "by" && k !== "name" && k !== "role" && k !== "ts" && k !== "note") o[k] = fx[k]; return o; }
  function sameArr(a, b) { a = a || []; b = b || []; if (a.length !== b.length) return false; for (var i = 0; i < a.length; i++) if (String(a[i]) !== String(b[i])) return false; return true; }
  /* diffQuestion(item, form, prev) -> the fix to send: the previous fix with this edit on top. form: { q, o[], a, exp, kp, img[], imgPlace }. */
  function diffQuestion(item, form, prev) {
    var fx = strip(prev), changed = false;
    function put(k, v) { fx[k] = v; changed = true; }
    if (String(form.q) !== String(item.q || "")) put("q", form.q);
    if (!sameArr(form.o, item.o) || form.a !== item.a) { put("o", form.o); put("a", form.a); }
    if (String(form.exp) !== String(item.exp || "")) put("exp", form.exp);
    if (String(form.kp) !== String(item.kp || "")) put("kp", form.kp);
    if (!sameArr(form.img, item.img) || (form.img.length && (form.imgPlace || "stem") !== (item.imgPlace || "stem"))) { put("img", form.img); put("imgPlace", form.imgPlace || "stem"); }
    return changed ? fx : null;
  }
  function diffLesson(les, form, prev) {
    var fx = strip(prev), changed = false, steps = {}, k, i;
    for (k in (fx.steps || {})) steps[k] = fx.steps[k];
    if (form.title !== les.title) { fx.title = form.title; changed = true; }
    for (i = 0; i < form.steps.length; i++) {
      var s = les.steps[i] || {}, f = form.steps[i], cur = steps[String(i)] ? JSON.parse(JSON.stringify(steps[String(i)])) : {}, c = false;
      if (f.tx !== String(s.tx || "")) { cur.tx = f.tx; c = true; }
      if (f.say !== String(s.say || "")) { cur.say = f.say; c = true; }
      if (f.fig) { cur.fig = f.fig; c = true; }
      if (c) { steps[String(i)] = cur; changed = true; }
    }
    if (Object.keys(steps).length) fx.steps = steps;
    return changed ? fx : null;
  }
  function changedFields(fx) {
    var out = [], k; fx = fx || {};
    var names = { q: "question", o: "options", a: "correct option", exp: "explanation", kp: "key point", img: "image", imgPlace: "", title: "title", steps: "lesson steps" };
    for (k in fx) if (names[k]) out.push(names[k]);
    return out;
  }

  /* ---------- images: shrink in the browser, WebP when the device can encode it, else JPEG ---------- */
  function loadBitmap(file) {
    if (G.createImageBitmap) return G.createImageBitmap(file);
    return new Promise(function (res, rej) {
      var u = G.URL.createObjectURL(file), im = new G.Image(); im.onload = function () { res(im); }; im.onerror = function () { rej(new Error("image")); }; im.src = u;
    });
  }
  function encode(canvas, type, q) { return new Promise(function (res) { canvas.toBlob(function (b) { res(b); }, type, q); }); }
  function shrink(file) {
    return loadBitmap(file).then(function (bmp) {
      var w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight;
      function draw(maxSide) {
        var k = Math.min(1, maxSide / Math.max(w, h)), c = D.createElement("canvas"); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
        var x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(bmp, 0, 0, c.width, c.height);
        return encode(c, "image/webp", 0.85).then(function (b) { return b && b.type === "image/webp" ? b : encode(c, "image/jpeg", 0.88); });
      }
      return draw(1400).then(function (b) { return b && b.size > 1500000 ? draw(1000) : b; });
    });
  }
  function uploadImage(file) {
    return shrink(file).then(function (blob) {
      if (!blob) throw new Error("image");
      return api("POST", "?image=1", null, blob, blob.type);
    }).then(function (r) { if (r.status !== 200 || !r.data.path) throw new Error(errText(r)); return r.data.path; });
  }
  function imgUrl(path) { return (G.SMD_API_BASE || "") + "/api/prep/bank/" + path; }

  /* ---------- state and loading ---------- */
  function active() { return !!P; }
  function open(x) {
    P = { x: x, kind: x.itemType === "lesson" ? "lesson" : "question", id: x.itemId, mod: x.module, subject: x.subject, loading: true, err: "", busy: false, prev: null, log: null, item: null, les: null, img: [], place: "stem", figs: {} };
    refresh();
    var loader = G.PREP_LOADER && G.PREP_LOADER.load ? G.PREP_LOADER.load() : Promise.reject(new Error("PrepNucleus is not available"));
    loader.then(function (PREP) {
      return api("GET", "?module=" + encodeURIComponent(x.module)).then(function (fr) {
        var fx = fr.status === 200 ? fr.data : { q: {}, l: {} };
        P.prev = (P.kind === "lesson" ? fx.l : fx.q)[P.id] || null;
        if (P.kind === "lesson") {
          var L = G.PREP_LESSONS; if (!L || !L.file) throw new Error("Lessons are not available");
          return L.file(P.id, PREP._host).then(function (les) { P.les = JSON.parse(JSON.stringify(les)); P.base = JSON.parse(JSON.stringify(les)); });
        }
        return PREP.loadItems(x.subject, x.module).then(function (items) {
          var it = null; (items || []).forEach(function (i) { if (String(i.id) === String(P.id)) it = i; });
          if (!it) throw new Error("That question is no longer in this module.");
          P.item = JSON.parse(JSON.stringify(it)); P.base = JSON.parse(JSON.stringify(it)); P.img = (it.img || []).slice(); P.place = it.imgPlace === "exp" ? "exp" : "stem";
        });
      });
    }).then(function () { P.loading = false; refresh(); return api("GET", "?log=1&kind=" + P.kind + "&id=" + encodeURIComponent(P.id)); })
      .then(function (r) { if (P && r) { P.log = r.status === 200 ? (r.data.log || []) : []; refresh(); } }, function (e) { if (P) { P.loading = false; P.err = String((e && e.message) || "It did not load."); refresh(); } });
  }
  function refresh() { try { if (G.SMD_REVIEW && G.SMD_REVIEW._render) G.SMD_REVIEW._render(); } catch (e) {} }
  function close(reload) { P = null; try { if (G.SMD_REVIEW && G.SMD_REVIEW.afterEdit) G.SMD_REVIEW.afterEdit(!!reload); } catch (e) {} refresh(); }

  /* ---------- form ---------- */
  function val(id) { var e = D.getElementById(id); return e ? e.value : ""; }
  function readForm() {
    if (!P) return null;
    if (P.kind === "lesson") {
      var steps = [], i;
      for (i = 0; i < P.les.steps.length; i++) {
        var fig = P.figs[i] ? { src: P.figs[i].src, alt: val("pf_alt" + i) || "Figure", caption: val("pf_cap" + i) } : null;
        steps.push({ tx: val("pf_tx" + i), say: val("pf_say" + i), fig: fig });
      }
      return { title: val("pf_title"), steps: steps };
    }
    var o = [], k = 0, a = -1, el;
    while ((el = D.getElementById("pf_o" + k))) { o.push(el.value); var rb = D.getElementById("pf_a" + k); if (rb && rb.checked) a = k; k++; }
    return { q: val("pf_q"), o: o, a: a, exp: val("pf_exp"), kp: val("pf_kp"), img: P.img.slice(), imgPlace: val("pf_place") || P.place };
  }
  function keepForm() {   // before a re-render that must not lose typing
    var f = readForm(); if (!f) return;
    P.note = val("pf_note");
    if (P.kind === "lesson") { P.les.title = f.title; f.steps.forEach(function (s, i) { P.les.steps[i].tx = s.tx; P.les.steps[i].say = s.say; if (P.figs[i]) { P.figs[i].alt = s.fig ? s.fig.alt : ""; P.figs[i].caption = s.fig ? s.fig.caption : ""; } }); }
    else { P.item.q = f.q; P.item.o = f.o; P.item.a = f.a; P.item.exp = f.exp; P.item.kp = f.kp; P.place = f.imgPlace; }
  }
  function imgRow(path, k) { return '<div class="pf-img"><img src="' + esc(imgUrl(path)) + '" alt="" loading="lazy"><button type="button" class="kit-clear" data-rv-act="pfrmimg:' + k + '">Remove</button></div>'; }
  function histHtml() {
    if (!P.log || !P.log.length) return "";
    return '<details class="pf-hist"><summary>History (' + P.log.length + ")</summary><ul>" + P.log.slice().reverse().map(function (e) {
      var d = ""; try { d = new Date(e.ts).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); } catch (x) {}
      return "<li><b>" + esc(e.name || e.by || "?") + "</b> (" + esc(e.role || "") + ") · " + esc(d) + " · " + (e.after ? "changed " + esc(changedFields(e.after).join(", ") || "the item") + (e.after.note ? ' · "' + esc(e.after.note) + '"' : "") : "reverted to the original") + "</li>";
    }).join("") + "</ul></details>";
  }
  function html() {
    if (!P) return "";
    var back = '<button type="button" class="kit-link" data-rv-act="pfback">' + ms("arrow_back") + "Back to the reports</button>";
    if (P.loading) return back + '<p class="kit-muted">Loading…</p>';
    if (P.err) return back + '<p class="kit-muted">' + esc(P.err) + "</p>";
    var head = '<h2 class="dl-h">' + (P.kind === "lesson" ? "Edit lesson" : "Edit question") + '</h2><p class="kit-muted">' + esc(P.mod) + " · " + esc(P.id) + ". Changes go live for every student within about 30 minutes. Your name and the time are kept in the history, and Revert brings the original back." + "</p>" +
      (P.prev ? '<p class="kit-muted"><span class="rv-pill ok">Already corrected by ' + esc(P.prev.name || "an editor") + "</span> Showing the corrected text.</p>" : "");
    var body = "";
    if (P.kind === "question") {
      var it = P.item, L = "ABCDEFGH";
      body += '<div class="kit-grid"><label class="kit-field wide" for="pf_q"><span class="kit-fl">Question</span><textarea id="pf_q" rows="5" class="kit-inp" maxlength="1500">' + esc(it.q) + "</textarea></label>";
      body += '<div class="kit-field wide"><span class="kit-fl">Options (tick the correct one)</span>' + (it.o || []).map(function (o, k) {
        return '<div class="pf-opt"><label class="pf-key"><input type="radio" id="pf_a' + k + '" name="pf_a" value="' + k + '"' + (k === it.a ? " checked" : "") + '><span>' + L[k] + '</span></label><input id="pf_o' + k + '" class="kit-inp" maxlength="300" value="' + esc(o) + '" aria-label="Option ' + L[k] + '"></div>';
      }).join("") + '<div class="kit-row">' + ((it.o || []).length < 8 ? '<button type="button" class="kit-pill" data-rv-act="pfaddopt">' + ms("add") + "Add option</button>" : "") + ((it.o || []).length > 2 ? '<button type="button" class="kit-clear" data-rv-act="pfdelopt">Remove last option</button>' : "") + "</div></div>";
      body += '<label class="kit-field wide" for="pf_exp"><span class="kit-fl">Explanation</span><textarea id="pf_exp" rows="9" class="kit-inp" maxlength="6000">' + esc(it.exp || "") + '</textarea></label>' +
        '<label class="kit-field wide" for="pf_kp"><span class="kit-fl">Key point (one line to remember)</span><input id="pf_kp" class="kit-inp" maxlength="700" value="' + esc(it.kp || "") + '"></label>';
      body += '<div class="kit-field wide"><span class="kit-fl">Images (up to 3)</span>' + P.img.map(imgRow).join("") +
        (P.img.length < 3 ? '<label class="kit-pill pf-file">' + ms("add_photo_alternate") + (P.busy ? "Uploading…" : "Add an image") + '<input id="pf_file" type="file" accept="image/*" hidden></label>' : "") +
        '<label class="kit-field" for="pf_place"><span class="kit-fl">Show the image</span><select id="pf_place" class="kit-inp"><option value="stem"' + (P.place === "stem" ? " selected" : "") + '>With the question</option><option value="exp"' + (P.place === "exp" ? " selected" : "") + ">With the explanation</option></select></label></div></div>";
    } else {
      var les = P.les;
      body += '<div class="kit-grid"><label class="kit-field wide" for="pf_title"><span class="kit-fl">Lesson title</span><input id="pf_title" class="kit-inp" maxlength="160" value="' + esc(les.title) + '"></label>';
      les.steps.forEach(function (s, i) {
        var fig = P.figs[i];
        body += '<div class="kit-field wide pf-step"><span class="kit-fl">Step ' + (i + 1) + '</span><label for="pf_tx' + i + '" class="pf-sub">Text</label><textarea id="pf_tx' + i + '" rows="6" class="kit-inp" maxlength="3000">' + esc(s.tx || "") + '</textarea>' +
          '<label for="pf_say' + i + '" class="pf-sub">Spoken summary</label><textarea id="pf_say' + i + '" rows="3" class="kit-inp" maxlength="2000">' + esc(s.say || "") + "</textarea>" +
          (fig ? imgRow(fig.src, "s" + i) + '<input id="pf_alt' + i + '" class="kit-inp" maxlength="240" placeholder="What the figure shows (alt text)" value="' + esc(fig.alt || "") + '"><input id="pf_cap' + i + '" class="kit-inp" maxlength="300" placeholder="Caption" value="' + esc(fig.caption || "") + '">'
            : '<label class="kit-pill pf-file">' + ms("add_photo_alternate") + (P.busy === i ? "Uploading…" : (s.vis && s.vis.kind === "image" ? "Replace the figure" : "Add a figure")) + '<input type="file" accept="image/*" hidden data-pf-step="' + i + '"></label>') + "</div>";
      });
      body += "</div>";
    }
    body += '<label class="kit-field wide" for="pf_note"><span class="kit-fl">What did you change and why? (kept in the history, optional)</span><input id="pf_note" class="kit-inp" maxlength="300" value="' + esc(P.note || "") + '"></label>';
    return back + head + body + '<p class="pf-msg" id="pf_msg" role="status"></p><div class="kit-row"><button type="button" class="kit-add" data-rv-act="pfsave">' + ms("task_alt") + "Save: goes live</button>" +
      (P.prev ? '<button type="button" class="kit-clear" data-rv-act="pfrevert">Revert to the original</button>' : "") + "</div>" + histHtml();
  }
  function msg(t, bad) { var e = D.getElementById("pf_msg"); if (e) { e.textContent = t || ""; e.className = "pf-msg" + (bad ? " bad" : ""); } }

  function refreshCache() {   // this phone's own PrepNucleus should see the fix sooner than the 30 minute index
    try { if (G.PREP && G.PREP.refreshFixes) G.PREP.refreshFixes(); } catch (e) {}
  }
  function save() {
    if (!P || P.busy) return;
    var f = readForm(), fx;
    if (P.kind === "lesson") fx = diffLesson(P.base, f, P.prev);
    else {
      if (f.a < 0) { msg(ERR["key-needed"], true); return; }
      fx = diffQuestion(P.base, f, P.prev);
    }
    if (!fx) { msg(ERR["empty-fix"], true); return; }
    P.busy = true; msg("Saving…");
    api("POST", "", { kind: P.kind, id: P.id, module: P.mod, subject: P.subject, fix: fx, note: val("pf_note") }).then(function (r) {
      P.busy = false;
      if (r.status !== 200) { msg(errText(r), true); return; }
      refreshCache(); toast("Saved. Students see it within about 30 minutes."); close(true);
    });
  }
  function revert() {
    if (!P || P.busy) return;
    if (G.confirm && !G.confirm("Remove this correction and bring the original text back?")) return;
    P.busy = true; msg("Reverting…");
    api("DELETE", "", { kind: P.kind, id: P.id, module: P.mod }).then(function (r) {
      P.busy = false;
      if (r.status !== 200) { msg(errText(r), true); return; }
      refreshCache(); toast("Reverted to the original."); close(true);
    });
  }
  function act(cmd, arg) {
    if (!P) return false;
    if (cmd === "pfback") { close(false); return true; }
    if (cmd === "pfsave") { save(); return true; }
    if (cmd === "pfrevert") { revert(); return true; }
    if (cmd === "pfaddopt") { keepForm(); P.item.o = (P.item.o || []).concat([""]); refresh(); return true; }
    if (cmd === "pfdelopt") { keepForm(); if (P.item.o.length > 2) { P.item.o = P.item.o.slice(0, -1); if (P.item.a >= P.item.o.length) P.item.a = 0; } refresh(); return true; }
    if (cmd === "pfrmimg") { keepForm(); if (arg.charAt(0) === "s") delete P.figs[Number(arg.slice(1))]; else P.img.splice(Number(arg), 1); refresh(); return true; }
    return false;
  }
  // File inputs: a change event, not a click.
  function onChange(e) {
    var t = e.target; if (!P || !t || t.type !== "file" || !t.files || !t.files[0] || !t.closest || !t.closest("#smdReview")) return;
    var step = t.getAttribute("data-pf-step"), file = t.files[0]; t.value = "";
    keepForm(); P.busy = step != null ? Number(step) : true; refresh();
    uploadImage(file).then(function (path) {
      if (!P) return; P.busy = false;
      if (step != null) P.figs[Number(step)] = { src: path, alt: "", caption: "" }; else if (P.img.length < 3) P.img.push(path);
      refresh();
    }, function (err) { if (P) { P.busy = false; refresh(); toast(String((err && err.message) || "The image did not upload.")); } });
  }
  if (D && D.addEventListener) D.addEventListener("change", onChange, true);

  G.SMD_PREPFIX = { me: me, open: open, active: active, html: html, act: act, _pure: { diffQuestion: diffQuestion, diffLesson: diffLesson, changedFields: changedFields, strip: strip } };
})(typeof window !== "undefined" ? window : this);
