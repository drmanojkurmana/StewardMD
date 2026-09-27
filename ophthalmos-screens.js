/* Ophthalmós screens: the Clinic encounter layout (docs/DESIGN.md). ES5.
   Hub = today's clinic list; drill = an encounter (patient card, image, impression, signed note);
   clinic summary; case conference. Loaded after ophthalmos.js. */
(function (G) {
  "use strict";
  var O = G.OPHTHALMOS, I = O._internal, st = O._st;
  var C = G.OPHTHALMOS_CORE, D = G.OPHTHALMOS_DATA, S = G.OPHTHALMOS_STAGE;
  var ico = I.ico, esc = I.esc, fmt = I.fmt;

  /* ================= hub: today's clinic list ================= */
  function counts(t, lv) {
    return C.counts(D.levelDeck(t, st.decks[t.id], lv), st.store, I.today());
  }
  function modalityLine(t) { return t.modality; }

  function renderHub() {
    st.view = "hub";
    var lv = I.level(), locked = I.levelLocked(lv), pro = I.isPro();
    var due = 0;
    if (!locked) I.drillTracks().forEach(function (t) { due += counts(t, lv).due; });
    var streak = C.streak(st.store, I.today());
    var seg = ["foundation", "resident"].map(function (l) {
      var lk = D.levelLocked(st.cfg, l, pro);
      return '<button data-act="level" data-l="' + l + '" aria-pressed="' + (lv === l) + '">' + esc(st.cfg.levels[l].label) +
        (lk ? ' <span class="oph-pro">' + ico("lock") + "Pro</span>" : "") + "</button>";
    }).join("");

    var today;
    if (!locked) today = planHtml(lv, streak);
    else {
      today = '<p class="oph-today-line">The Resident level uses the full classification for every clinic. It is part of StewardMD Pro.</p>' +
        '<button class="oph-btn pri oph-wide" data-act="pro">' + ico("lock") + " Unlock Resident level</button>";
    }

    var rows = st.cfg.tracks.map(function (t) {
      var d = st.decks[t.id], thumbs = (d.thumbs || []).slice(0, 3).map(function (x) {
        return '<img src="' + esc(I.imgUrl(x.img)) + '" alt="" loading="lazy" decoding="async">';
      }).join("");
      var line;
      if (t.selfRated) {
        var worked = casesWorked();
        line = fmt(worked) + " of " + fmt(d.items.length) + " cases worked";
      } else {
        var c = counts(t, lv);
        line = fmt(c.seen) + " of " + fmt(c.total) + " seen" + (c.due && !locked ? " · <b>" + fmt(c.due) + " waiting</b>" : "");
      }
      var act = t.selfRated ? "cases" : "clinic";
      return '<li><button class="oph-clinic" data-act="' + act + '" data-t="' + t.id + '">' +
        '<span class="oph-strip" aria-hidden="true">' + thumbs + "</span>" +
        '<span class="oph-clinic-b"><b>' + esc(t.clinic) + "</b><span>" + esc(modalityLine(t)) + '</span><span class="oph-small">' + line + "</span></span>" +
        '<span class="oph-chev" aria-hidden="true">' + ico("chev") + "</span></button></li>";
    }).join("");

    I.paint(
      '<div class="oph-top"><button class="oph-back" data-act="back" aria-label="Close Ophthalmós">‹</button>' +
      '<div class="oph-title"><b class="oph-mark">Ophthalmós</b><span>Eye imaging clinic</span></div>' +
      '<button class="oph-icon" data-act="stats" aria-label="Your accuracy">' + ico("trend") + "</button>" +
      '<button class="oph-icon" data-act="sources" aria-label="Images and sources">' + ico("info") + "</button></div>" +
      '<div class="oph-scroll oph-pad">' +
      '<div class="oph-levelrow"><div class="oph-seg" role="group" aria-label="Level">' + seg + "</div>" +
      '<span class="oph-small">' + esc(st.cfg.levels[lv].sub) + "</span></div>" +
      '<section class="oph-today" aria-label="Today">' + today + "</section>" +
      '<h2 class="oph-h2">Clinics</h2><ul class="oph-clinics">' + rows + "</ul>" + bankRows() + readRows() + simRows() + toolRows() + fundxRow() +
      '<p class="oph-note">Beta: teaching points and plans await review by an ophthalmologist. ' +
      '<button class="oph-link" data-act="sources">Images and sources</button></p></div>');
  }

  // Simulators registered in O._sims (ophthalmos-retino.js, ophthalmos-neuro.js). Same row as a clinic,
  // an icon tile in place of the image strip because a simulator renders its own model, not a photo.
  // Question banks registered in O._banks (ophthalmos-mcq.js): same row, an icon tile for the strip.
  function bankRows() {
    var banks = O._banks || [];
    if (!banks.length) return "";
    return '<h2 class="oph-h2">Questions</h2><ul class="oph-clinics">' + banks.map(function (b) {
      return '<li><button class="oph-clinic" data-act="bank" data-b="' + esc(b.id) + '">' +
        '<span class="oph-strip" aria-hidden="true"><span class="oph-tile">' + ico(b.icon) + "</span></span>" +
        '<span class="oph-clinic-b"><b>' + esc(b.title) + "</b><span>" + esc(b.sub) + '</span><span class="oph-small">' + b.line() + "</span></span>" +
        '<span class="oph-chev" aria-hidden="true">' + ico("chev") + "</span></button></li>";
    }).join("") + "</ul>";
  }

  function simRows() {
    var sims = O._sims || [];
    if (!sims.length) return "";
    return '<h2 class="oph-h2">Simulators</h2><ul class="oph-clinics">' + sims.map(function (s) {
      var r = (st.store.sims || {})[s.id];
      var line = s.line ? s.line(r) : r && r.n ? fmt(r.ok) + " of " + fmt(r.n) + " cases right" : "Not started";
      return '<li><button class="oph-clinic" data-act="sim" data-s="' + esc(s.id) + '">' +
        '<span class="oph-strip" aria-hidden="true"><span class="oph-tile">' + ico(s.icon) + "</span></span>" +
        '<span class="oph-clinic-b"><b>' + esc(s.title) + "</b><span>" + esc(s.sub) + '</span><span class="oph-small">' + line + "</span></span>" +
        '<span class="oph-chev" aria-hidden="true">' + ico("chev") + "</span></button></li>";
    }).join("") + "</ul>";
  }

  // Calculators registered in O._tools (ophthalmos-tools.js). Same row as a simulator; the third line names the
  // source, and the section says once that these are for learning, not for clinical decisions.
  // One hub row for the calculators; the list lives on its own screen so the hub stays a clinic list.
  function toolRow(t) {
    return '<li><button class="oph-clinic" data-act="tool" data-s="' + esc(t.id) + '">' +
      '<span class="oph-strip" aria-hidden="true"><span class="oph-tile">' + ico(t.icon) + "</span></span>" +
      '<span class="oph-clinic-b"><b>' + esc(t.title) + "</b><span>" + esc(t.sub) + '</span><span class="oph-small">' + esc(t.src) + "</span></span>" +
      '<span class="oph-chev" aria-hidden="true">' + ico("chev") + "</span></button></li>";
  }
  function toolRows() {
    var tools = O._tools || [];
    if (!tools.length) return "";
    return '<h2 class="oph-h2">Tools</h2><ul class="oph-clinics"><li><button class="oph-clinic" data-act="tools">' +
      '<span class="oph-strip" aria-hidden="true"><span class="oph-tile">' + ico("calc") + "</span></span>" +
      '<span class="oph-clinic-b"><b>Clinical calculators</b><span>' + esc(tools.map(function (t) { return t.title; }).join(", ")) + "</span>" +
      '<span class="oph-small">' + fmt(tools.length) + " tools</span></span>" +
      '<span class="oph-chev" aria-hidden="true">' + ico("chev") + "</span></button></li></ul>";
  }
  function renderTools() {
    var tools = O._tools || [];
    st.view = "tools"; st.onBack = null;
    I.paint(I.top("Back to clinics", "Clinical calculators", fmt(tools.length) + " tools") +
      '<div class="oph-scroll oph-pad"><p class="oph-small oph-tools-note">For learning, not for clinical decisions. Each result shows its rule and source.</p>' +
      '<ul class="oph-clinics" aria-label="Calculators">' + tools.map(toolRow).join("") + "</ul></div>");
  }

  // Reading registered in O._reads (ophthalmos-notes.js): the clinic row again, led by real images from the notes.
  function readRows() {
    var reads = O._reads || [];
    if (!reads.length) return "";
    return '<h2 class="oph-h2">Notes</h2><ul class="oph-clinics">' + reads.map(function (r) {
      var th = (r.thumbs ? r.thumbs() : []).slice(0, 3).map(function (p) {
        return '<img src="' + esc(I.imgUrl(p)) + '" alt="" loading="lazy" decoding="async">';
      }).join("") || '<span class="oph-tile">' + ico(r.icon) + "</span>";
      return '<li><button class="oph-clinic" data-act="read" data-r="' + esc(r.id) + '">' +
        '<span class="oph-strip" aria-hidden="true">' + th + "</span>" +
        '<span class="oph-clinic-b"><b>' + esc(r.title) + "</b><span>" + esc(r.sub) + '</span><span class="oph-small">' + r.line() + "</span></span>" +
        '<span class="oph-chev" aria-hidden="true">' + ico("chev") + "</span></button></li>";
    }).join("") + "</ul>";
  }

  // FundX AI (the host's smartphone fundus module) behind the host's access-code gate
  // (SMD_XACCESS: one code, one device, server-verified). No row without both, so it never opens ungated.
  function fundxRow() {
    var X = G.SMD_XACCESS;
    if (!(X && X.gate && G.FUNDX)) return "";
    var on = false; try { on = !!(X.isActiveCached && X.isActiveCached("fundx")); } catch (e) {}
    return '<h2 class="oph-h2">Your own images</h2><ul class="oph-clinics"><li><button class="oph-clinic" data-act="fundx">' +
      '<span class="oph-strip" aria-hidden="true"><span class="oph-tile">' + ico("eye") + "</span></span>" +
      '<span class="oph-clinic-b"><b>FundX AI</b><span>Fundus capture, AI read</span><span class="oph-small">' +
      (on ? "Unlocked on this device" : '<span class="oph-pro">' + ico("lock") + "Access code</span>") + "</span></span>" +
      '<span class="oph-chev" aria-hidden="true">' + ico("chev") + "</span></button></li></ul>";
  }
  // Same path as the Home tile (home.js retinalscan). Ophthalmós closes first: the access gate and the
  // FundX overlay are host layers, and swipe-back checks Ophthalmós before FundX.
  function openFundx() {
    var X = G.SMD_XACCESS;
    if (!(X && X.gate)) return;
    O.close();
    X.gate("fundx", function () { try { G.localStorage.setItem("smd_fundx", "1"); } catch (e) {} if (G.FUNDX && G.FUNDX.open) G.FUNDX.open(); });
  }

  /* Today's plan: built each day from what is due, not a fixed path. Images (due reviews, topped up with new
     referrals), questions from the bank, and one graded simulator patient, rotating by day. A part is done
     when today's reviews reach its target: at least 10, at most 20 or what was due. */
  function reviewedToday(prefixes) {
    var n = 0, d = I.today(), k, i;
    for (k in st.store.cards) {
      if (st.store.cards[k][2] !== d) continue;
      for (i = 0; i < prefixes.length; i++) if (k.indexOf(prefixes[i]) === 0) { n++; break; }
    }
    return n;
  }
  function planItems(lv) {
    var d = I.today(), items = [], due = 0;
    I.drillTracks().forEach(function (t) { due += counts(t, lv).due; });
    var done = reviewedToday(I.drillTracks().map(function (t) { return C.key(D.levelKey(t.id, lv), ""); }));
    var target = Math.max(10, Math.min(20, due + done));
    items.push({ act: "today", title: "Images", done: done >= target,
      line: done >= target ? fmt(done) + " read today" : due ? fmt(due) + " waiting · " + fmt(done) + " of " + fmt(target) + " today" : "New referrals · " + fmt(done) + " of " + fmt(target) + " today" });
    (O._banks || []).forEach(function (b) {
      if (!b.start) return;
      var bd = 0, k;
      for (k in st.store.cards) if (k.indexOf(b.id + ":") === 0 && st.store.cards[k][3] <= d) bd++;
      var bdone = reviewedToday([b.id + ":"]), bt = Math.max(10, Math.min(20, bd + bdone));
      items.push({ act: "planbank", key: b.id, title: "Questions", done: bdone >= bt,
        line: bdone >= bt ? fmt(bdone) + " answered today" : (bd ? fmt(bd) + " due · " : "") + fmt(bdone) + " of " + fmt(bt) + " today" });
    });
    var sims = (O._sims || []).filter(function (s) { return s.startCase; });
    if (sims.length) {
      var s = sims[d % sims.length], r = (st.store.sims || {})[s.id], sdone = !!(r && r.last === d);
      items.push({ act: "plansim", key: s.id, title: s.title, done: sdone, line: sdone ? "Patient seen today" : "One graded patient" });
    }
    return items;
  }
  function planHtml(lv, streak) {
    var items = planItems(lv), left = items.filter(function (x) { return !x.done; }), all = !left.length;
    var rows = items.map(function (x) {
      return '<li><button class="oph-plan-row" data-act="' + x.act + '"' + (x.key ? ' data-k="' + esc(x.key) + '"' : "") + ' data-done="' + x.done + '">' +
        '<span class="oph-plan-ck" aria-hidden="true">' + (x.done ? ico("check") : "") + "</span>" +
        '<span class="oph-plan-b"><b>' + esc(x.title) + "</b><span>" + x.line + "</span></span>" +
        '<span class="oph-chev" aria-hidden="true">' + ico("chev") + '</span><span class="oph-sr">' + (x.done ? "done" : "to do") + "</span></button></li>";
    }).join("");
    var nx = left[0];
    return '<div class="oph-plan-h"><b>Today</b><span class="oph-mut">' + (all ? "Plan done" : fmt(items.length - left.length) + " of " + fmt(items.length) + " done") +
      (streak ? " · " + streak + (streak === 1 ? " day" : " days") + " in a row" : "") + "</span></div>" +
      '<ol class="oph-day">' + rows + "</ol>" +
      '<button class="oph-btn pri oph-wide" data-act="' + (nx ? nx.act : "today") + '"' + (nx && nx.key ? ' data-k="' + esc(nx.key) + '"' : "") + ">" + ico("play") +
      (all ? " Keep going with images" : " Start " + esc(nx.title.toLowerCase())) + "</button>";
  }

  function casesWorked() {
    var n = 0, d = st.decks.cases;
    d.items.forEach(function (c) { if (st.store.cards[C.key("cases", c.id + ":0")]) n++; });
    return n;
  }

  /* ================= sessions ================= */
  function lockedGate() { if (I.levelLocked()) { I.showPro(); return true; } return false; }

  function buildFor(t, lv, size, newCap) {
    var ld = D.levelDeck(t, st.decks[t.id], lv);
    return C.buildSession(ld, st.store, I.today(), { size: size, newCap: newCap }).map(function (x) { return { t: t.id, it: x.it }; });
  }

  // "Start clinic": everything waiting across clinics, least retrievable first per clinic, interleaved;
  // topped up with new referrals spread across clinics when fewer than the session size wait.
  function startToday() {
    if (lockedGate()) return;
    var lv = I.level(), lists = I.drillTracks().map(function (t) { return buildFor(t, lv, I.SESSION_SIZE, 0); });
    var q = interleave(lists).slice(0, I.SESSION_SIZE);
    if (q.length < I.SESSION_SIZE) {
      var room = I.SESSION_SIZE - q.length, per = Math.max(1, Math.ceil(room / lists.length));
      var fresh = interleave(I.drillTracks().map(function (t) { return buildFor(t, lv, per, per).filter(isNew(t, lv)); }));
      q = q.concat(fresh.slice(0, room));
    }
    run(q, "Today’s clinic");
  }
  function startClinic(tid) {
    if (lockedGate()) return;
    var t = I.track(tid);
    run(buildFor(t, I.level(), I.SESSION_SIZE, I.NEW_CAP), t.clinic);
  }
  // Weak-spots drill (stats screen): due cards of the two confused classes first, then new, up to 12.
  function startFocus(trackId, a, b) {
    if (lockedGate()) return;
    var t = I.track(trackId), lv = I.level(), ld = D.levelDeck(t, st.decks[t.id], lv);
    var items = ld.items.filter(function (x) { return x.a === a || x.a === b; });
    var q = C.buildSession({ id: ld.id, items: items }, st.store, I.today(), { size: 12, newCap: 12 })
      .map(function (x) { return { t: t.id, it: x.it }; });
    run(q, t.clinic + " · drill");
  }
  function isNew(t, lv) { return function (x) { return !st.store.cards[C.key(D.levelKey(t.id, lv), x.it.id)]; }; }
  function interleave(lists) {
    var out = [], i = 0, more = true;
    while (more) { more = false; lists.forEach(function (l) { if (i < l.length) { out.push(l[i]); more = true; } }); i++; }
    return out;
  }

  function run(queue, name) {
    if (!queue.length) {
      st.view = "hub"; renderHub();
      try { if (G.toast) G.toast("Nothing waiting in this clinic today"); } catch (e) {}
      return;
    }
    st.session = { name: name, q: queue, i: 0, done: false, results: [], requeued: {} };
    renderEncounter();
  }

  /* ================= encounter ================= */
  function contextLine(t, it) {
    if (t.id === "rop") {
      var bits = [];
      if (it.ga) bits.push("GA\u00a0" + it.ga + "\u00a0weeks");
      if (it.bw) bits.push("birth weight " + fmt(it.bw) + "\u00a0g");
      if (it.sex) bits.push(it.sex);
      return "Preterm infant · " + bits.join(" · ");
    }
    return t.modality;
  }

  function renderEncounter() {
    var s = st.session, e = s.q[s.i], t = I.track(e.t), it = e.it, lv = I.level();
    var opts = D.optionsFor(t, st.decks[t.id], lv);
    st.view = "encounter"; s.done = false; s.chosen = null;
    var ans = opts.map(function (o, k) {
      return '<button class="oph-ans" data-act="ans" data-id="' + esc(o.id) + '"><span class="k" aria-hidden="true">' + (k + 1) + "</span>" + esc(o.label) + "</button>";
    }).join("");
    I.paint(
      I.top("Back to clinics", "Patient " + (s.i + 1) + " of " + s.q.length, esc(t.clinic) + " · " + esc(st.cfg.levels[lv].label),
        '<button class="oph-icon" data-act="zoomreset" aria-label="Fit image">' + ico("target") + "</button>") +
      '<div class="oph-enc">' +
      '<div class="oph-card"><div class="oph-card-l"><b>' + esc(t.prompt || st.decks[t.id].prompt) + "</b><span>" + esc(contextLine(t, it)) + "</span></div>" +
      '<div class="oph-card-imp" id="ophImp"><span><span class="oph-imp-k">Answer</span>after your impression</span></div></div>' +
      '<div class="oph-stage" id="ophStage" style="aspect-ratio:' + it.w + " / " + it.h + '">' +
      '<img id="ophImg" src="' + esc(I.imgUrl(it.img)) + '" alt="' + esc(t.modality) + ', patient ' + (s.i + 1) + '" width="' + it.w + '" height="' + it.h + '" decoding="async" fetchpriority="high">' +
      '<div class="oph-load" id="ophLoad">Loading image…</div></div>' +
      '<div class="oph-panel oph-scroll" id="ophPanel"><h2 class="oph-q" id="ophQ">Your impression</h2>' +
      '<div class="oph-answers" role="group" aria-labelledby="ophQ">' + ans + "</div>" +
      '<div id="ophNote" aria-live="polite"></div></div>' +
      '<div class="oph-foot"><button class="oph-btn pri oph-wide" data-act="next" id="ophNext" hidden>Next patient</button></div></div>',
      ".oph-ans");
    var img = G.document.getElementById("ophImg"), stage = G.document.getElementById("ophStage");
    img.onload = function () { var l = G.document.getElementById("ophLoad"); if (l) l.hidden = true; };
    img.onerror = function () {
      var l = G.document.getElementById("ophLoad");
      if (l) l.innerHTML = 'Image did not load. <button class="oph-link" data-act="skip">Skip patient</button>';
    };
    s.zoom = S.attach(stage, img);
    if (img.complete && img.naturalWidth) img.onload();
  }

  function answer(id, viaKey) {
    var s = st.session;
    if (!s || s.done) return;
    var e = s.q[s.i], t = I.track(e.t), it = e.it, lv = I.level();
    var truth = D.truthFor(t, lv, it.a), right = id === truth, key = D.levelKey(t.id, lv);
    s.done = true; s.chosen = id;
    C.recordAnswer(st.store, key, truth, id);
    C.review(st.store, key, it.id, C.gradeFor(right), I.today());
    I.save();
    s.results.push({ t: t.id, it: it, truth: truth, chosen: id, right: right });
    // A wrong call comes back once later in the same clinic.
    if (!right && !s.requeued[e.t + it.id] && s.q.length - s.i > 3) {
      s.requeued[e.t + it.id] = 1;
      s.q.splice(Math.min(s.q.length, s.i + 5), 0, e);
    }
    I.haptic(right ? "success" : "error");

    var opts = D.optionsFor(t, st.decks[t.id], lv), labels = {};
    opts.forEach(function (o) { labels[o.id] = o.label; });
    var wrap = G.document.querySelector(".oph-answers");
    wrap.classList.add("done");
    Array.prototype.forEach.call(wrap.querySelectorAll(".oph-ans"), function (b) {
      var bid = b.getAttribute("data-id"), k = b.querySelector(".k");
      if (bid === truth) { b.setAttribute("data-state", "right"); k.innerHTML = ico("check") || "✓"; }
      else if (bid === id) { b.setAttribute("data-state", "wrong"); k.innerHTML = ico("close") || "x"; }
      else b.setAttribute("data-state", "dim");
      b.setAttribute("aria-disabled", "true");
    });
    var imp = G.document.getElementById("ophImp");
    imp.className = "oph-card-imp " + (right ? "ok" : "bad");
    imp.innerHTML = (right ? ico("check") : ico("close")) + '<span><span class="oph-imp-k">Answer</span>' + esc(t.labels[it.a]) + "</span>";

    var note = G.document.getElementById("ophNote");
    note.innerHTML = noteHtml(t, it, truth, id, right, labels, lv);
    var block = note.firstChild;
    if (!viaKey && block) {
      block.classList.add("pre");
      G.requestAnimationFrame(function () { G.requestAnimationFrame(function () { block.classList.remove("pre"); }); });
    }
    var nx = G.document.getElementById("ophNext");
    nx.hidden = false;
    nx.textContent = s.i + 1 < s.q.length ? "Next patient" : "Finish clinic";
    try { nx.focus({ preventScroll: true }); } catch (x) {}
    // Bring the verdict into view inside the answer panel only; scrolling any ancestor would
    // push the image stage off the top of the fixed overlay.
    var panel = G.document.getElementById("ophPanel");
    try { panel.scrollTo({ top: Math.max(0, note.offsetTop - panel.offsetTop - 8), behavior: viaKey ? "auto" : "smooth" }); } catch (x) { panel.scrollTop = note.offsetTop; }
  }

  function noteHtml(t, it, truth, chosen, right, labels, lv) {
    var fine = it.a, signs = (t.teach[fine] || []).map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("");
    var verdict = right
      ? '<p class="oph-verdict ok">' + ico("check") + "<span>Right: " + esc(labels[truth]) + "</span></p>"
      : '<p class="oph-verdict bad">' + ico("close") + "<span>Not this time. You said " + esc(labels[chosen]) + "</span></p>";
    var ref = lv === "foundation" && labels[truth] !== t.labels[fine]
      ? '<p class="oph-small">This image: ' + esc(t.labels[fine]) + "</p>" : "";
    var contrast = "";
    if (!right) {
      var group = D.optionsFor(t, st.decks[t.id], lv).filter(function (o) { return o.id === chosen; })[0];
      var of = group ? group.of : [chosen];
      contrast = '<h3 class="oph-h3">What ' + esc(labels[chosen]) + " would show</h3><ul class=\"oph-signs\">" +
        of.map(function (c) {
          var tt = t.teach[c] || [];
          return of.length > 1 ? "<li><b>" + esc(t.labels[c]) + ":</b> " + esc(tt[0] || "") + "</li>" : tt.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("");
        }).join("") + "</ul>";
    }
    if (!right) contrast += examples(t, of);
    var plan = t.plan && t.plan[fine] ? '<h3 class="oph-h3">Plan</h3><p class="oph-plan">' + esc(t.plan[fine]) + "</p>" : "";
    return '<div class="oph-reveal">' + verdict + ref +
      '<h3 class="oph-h3">Signs of ' + esc(t.labels[fine]) + '</h3><ul class="oph-signs">' + signs + "</ul>" +
      contrast + plan + (t.pearl ? '<p class="oph-pearl">' + esc(t.pearl) + "</p>" : "") +
      I.maikBtn("I am learning to read " + t.modality + ". The reference diagnosis for this image is " + t.labels[fine] +
        (right ? "." : "; I said " + labels[chosen] + ".") + " What signs distinguish " + t.labels[fine] +
        (right ? "" : " from " + labels[chosen]) + ", and what are the next steps in management?") + "</div>";
  }

  // A real image of what the learner's pick looks like (a different patient), so a miss teaches the visual
  // difference, not only the words. One exemplar per class from the deck's hub thumbnails.
  function examples(t, classes) {
    var d = st.decks[t.id], byClass = {};
    if (!d.exIndex) { d.exIndex = {}; var ids = {}; (d.thumbs || []).forEach(function (x) { ids[x.id] = 1; }); d.items.forEach(function (it) { if (ids[it.id] && !d.exIndex[it.a]) d.exIndex[it.a] = it; }); }
    byClass = d.exIndex;
    var figs = classes.slice(0, 2).map(function (c) {
      var it = byClass[c];
      if (!it) return "";
      return '<figure class="oph-ex"><img src="' + esc(I.imgUrl(it.img)) + '" width="' + it.w + '" height="' + it.h + '" alt="Example of ' + esc(t.labels[c]) + ', another patient" loading="lazy" decoding="async">' +
        "<figcaption>" + esc(t.labels[c]) + ", another patient</figcaption></figure>";
    }).join("");
    return figs ? '<div class="oph-exs">' + figs + "</div>" : "";
  }

  function next() {
    var s = st.session;
    if (!s) return;
    if (s.i + 1 >= s.q.length) return renderSummary();
    s.i++;
    renderEncounter();
  }

  /* ================= clinic summary ================= */
  function renderSummary() {
    var s = st.session, r = s.results, right = r.filter(function (x) { return x.right; }).length;
    st.view = "summary";
    var misses = r.filter(function (x) { return !x.right; });
    var seenMiss = {}, missRows = misses.filter(function (x) {
      var k = x.t + x.it.id; if (seenMiss[k]) return false; seenMiss[k] = 1; return true;
    }).map(function (x) {
      var t = I.track(x.t), th = x.it.img;
      return '<li><img src="' + esc(I.imgUrl(th)) + '" alt="" loading="lazy" decoding="async"><span><b>' + esc(t.labels[x.it.a]) +
        '</b><span class="oph-small">' + esc(t.clinic) + "</span></span></li>";
    }).join("");
    var tomorrow = 0, lv = I.level();
    I.drillTracks().forEach(function (t) { tomorrow += D.dueOn(st.store, D.levelKey(t.id, lv) + ":", I.today() + 1); });
    I.paint(I.top("Back to clinics", "Clinic finished", esc(s.name)) +
      '<div class="oph-scroll oph-pad"><p class="oph-score"><b>' + right + "</b> of " + r.length + " right</p>" +
      '<p class="oph-mut">' + fmt(tomorrow) + (tomorrow === 1 ? " patient" : " patients") + " will be waiting tomorrow. Spaced review brings each image back just before you would forget it.</p>" +
      (missRows ? '<h3 class="oph-h3">To look at again</h3><ul class="oph-misses">' + missRows + "</ul>" : '<p>No misses in this clinic.</p>') +
      '<div class="oph-actions"><button class="oph-btn pri" data-act="today">' + ico("play") + " Next clinic</button>" +
      '<button class="oph-btn sec" data-act="back">Back to clinics</button></div></div>', ".oph-btn.pri");
    st.session = null;
  }

  /* ================= case conference ================= */
  // only: case ids to work (a note's "Practise this"); otherwise due cases first, then unworked ones.
  function startCases(only) {
    var d = st.decks.cases, pro = I.isPro(), t = I.track("cases");
    var list = d.items.map(function (c, i) { return { c: c, i: i }; }).filter(function (x) { return !D.caseLocked(st.cfg, x.i, pro); });
    if (only) {
      list = list.filter(function (x) { return only.indexOf(x.c.id) >= 0; });
      if (!list.length) return I.showPro();
      st.caseRun = { q: list, i: 0, t: t };
      return renderCase();
    }
    // Cases with a due question first, then unworked ones in order.
    var today = I.today(), due = [], fresh = [];
    list.forEach(function (x) {
      var anyDue = false, seen = false;
      for (var q = 0; q < x.c.qs.length; q++) {
        var cd = st.store.cards[C.key("cases", x.c.id + ":" + q)];
        if (cd) { seen = true; if (cd[3] <= today) anyDue = true; }
      }
      if (anyDue) due.push(x); else if (!seen) fresh.push(x);
    });
    var q = due.concat(fresh).slice(0, 3);
    if (!q.length) {
      if (!pro && d.items.length > (st.cfg.access.freeCases || 10)) return I.showPro();
      try { if (G.toast) G.toast("All cases worked. They come back when due."); } catch (e) {}
      return;
    }
    st.caseRun = { q: q, i: 0, t: t };
    renderCase();
  }

  function renderCase() {
    var r = st.caseRun, x = r.q[r.i], c = x.c, t = r.t;
    st.view = "case";
    var rows = c.qs.map(function (q, k) {
      var cd = st.store.cards[C.key("cases", c.id + ":" + k)];
      return '<li class="oph-cq" data-k="' + k + '"><button class="oph-cq-q" data-act="reveal" data-k="' + k + '" aria-expanded="false">' +
        '<span class="n">' + (k + 1) + "</span><span>" + esc(q.q) + "</span>" + (cd ? '<span class="oph-rated" aria-label="Rated">' + ico("check") + "</span>" : "") +
        '</button><div class="oph-cq-a" hidden><p>' + esc(q.a) + "</p>" +
        '<div class="oph-seg oph-rate" role="group" aria-label="How did you do?">' +
        '<button data-act="rate" data-k="' + k + '" data-g="3">Knew it</button>' +
        '<button data-act="rate" data-k="' + k + '" data-g="2">Partly</button>' +
        '<button data-act="rate" data-k="' + k + '" data-g="1">Missed</button></div>' +
        '<details class="oph-ai"><summary>GPT-4V’s answer in the OphthalVQA study</summary><p>' + esc(q.ai) + "</p></details>" +
        I.maikBtn("Ophthalmology case, " + (t.types[c.type] || c.type) + ". Question: " + q.q + " Expert answer: " + q.a + ". Explain the reasoning behind this answer.") + "</div></li>";
    }).join("");
    I.paint(I.top("Back to clinics", "Case " + (x.i + 1) + " of " + st.decks.cases.items.length, esc(t.types[c.type] || c.type)) +
      '<div class="oph-scroll"><div class="oph-stage oph-stage-case" id="ophStage" style="aspect-ratio:' + c.w + " / " + c.h + '">' +
      '<img id="ophImg" src="' + esc(I.imgUrl(c.img)) + '" alt="Case ' + (x.i + 1) + ", " + esc(t.types[c.type] || c.type) + '" width="' + c.w + '" height="' + c.h + '" decoding="async" fetchpriority="high">' +
      '<div class="oph-load" id="ophLoad">Loading image…</div></div>' +
      '<div class="oph-pad"><p class="oph-mut">Answer each question in your head, then reveal the expert answer and rate yourself.</p>' +
      '<ol class="oph-cqs">' + rows + "</ol>" +
      '<button class="oph-btn pri oph-wide" data-act="nextcase">' + (r.i + 1 < r.q.length ? "Next case" : "Finish") + "</button></div></div>", ".oph-cq-q");
    var img = G.document.getElementById("ophImg");
    img.onload = function () { var l = G.document.getElementById("ophLoad"); if (l) l.hidden = true; };
    img.onerror = function () { var l = G.document.getElementById("ophLoad"); if (l) l.textContent = "Image did not load"; };
    S.attach(G.document.getElementById("ophStage"), img);
    if (img.complete && img.naturalWidth) img.onload();
  }

  function reveal(b) {
    var li = b.parentNode, a = li.querySelector(".oph-cq-a"), open = a.hidden;
    a.hidden = !open;
    b.setAttribute("aria-expanded", String(open));
  }
  function rate(b) {
    var r = st.caseRun, c = r.q[r.i].c, k = +b.getAttribute("data-k"), g = +b.getAttribute("data-g");
    C.review(st.store, "cases", c.id + ":" + k, g, I.today());
    I.save();
    Array.prototype.forEach.call(b.parentNode.querySelectorAll("button"), function (x) { x.setAttribute("aria-pressed", String(x === b)); });
    var q = b.closest(".oph-cq").querySelector(".oph-cq-q");
    if (!q.querySelector(".oph-rated")) q.insertAdjacentHTML("beforeend", '<span class="oph-rated" aria-label="Rated">' + ico("check") + "</span>");
    I.haptic("tap");
  }
  function nextCase() {
    var r = st.caseRun;
    if (r.i + 1 < r.q.length) { r.i++; renderCase(); } else { st.caseRun = null; renderHub(); }
  }

  /* ================= wiring ================= */
  var A = I.ACTIONS;
  A.level = function (b) {
    var l = b.getAttribute("data-l");
    st.prefs.level = l; D.savePrefs(I.ls(), st.prefs);
    renderHub();
    if (D.levelLocked(st.cfg, l, I.isPro())) I.showPro();
  };
  A.pro = function () { I.showPro(); };
  A.today = startToday;
  A.clinic = function (b) { startClinic(b.getAttribute("data-t")); };
  A.drill = function (b) { startFocus(b.getAttribute("data-t"), b.getAttribute("data-a"), b.getAttribute("data-b")); };
  A.cases = function (b) { var c = b && b.getAttribute && b.getAttribute("data-c"); startCases(c ? c.split(",") : null); };
  A.fundx = openFundx;
  A.read = function (b) { var id = b.getAttribute("data-r"); (O._reads || []).forEach(function (r) { if (r.id === id) r.open(); }); };
  A.bank = function (b) { var id = b.getAttribute("data-b"); (O._banks || []).forEach(function (x) { if (x.id === id) x.open(); }); };
  A.planbank = function (b) { var k = b.getAttribute("data-k"); (O._banks || []).forEach(function (x) { if (x.id === k) x.start(); }); };
  A.plansim = function (b) { var k = b.getAttribute("data-k"); (O._sims || []).forEach(function (x) { if (x.id === k) x.startCase(); }); };
  A.sim = function (b) { var id = b.getAttribute("data-s"); (O._sims || []).forEach(function (s) { if (s.id === id) s.open(); }); };
  A.tools = renderTools;
  // Back from a calculator returns to the list; leave() first so the calculator keeps its last values.
  A.tool = function (b) {
    var id = b.getAttribute("data-s");
    (O._tools || []).forEach(function (t) { if (t.id === id) { t.open(); st.onBack = function () { I.leave(); renderTools(); return true; }; } });
  };
  A.ans = function (b) { answer(b.getAttribute("data-id"), false); };
  A.next = next;
  A.skip = function () {
    var s = st.session; if (!s) return;
    s.q.splice(s.i, 1);
    if (s.i >= s.q.length) return s.results.length ? renderSummary() : O.back();
    renderEncounter();
  };
  A.zoomreset = function () { if (st.session && st.session.zoom) st.session.zoom.reset(); };
  A.reveal = reveal;
  A.rate = rate;
  A.nextcase = nextCase;

  I.KEYS.encounter = function (e) {
    var s = st.session; if (!s) return;
    if (!s.done && /^[1-9]$/.test(e.key)) {
      var b = G.document.querySelectorAll(".oph-ans")[+e.key - 1];
      if (b) { e.preventDefault(); answer(b.getAttribute("data-id"), true); }
    } else if (s.done && (e.key === "Enter" || e.key === " ") && e.target.id !== "ophNext") {
      e.preventDefault(); next();
    }
  };

  O._renderHub = renderHub;
})(typeof window !== "undefined" ? window : this);
