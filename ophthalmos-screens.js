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
    if (locked) {
      today = '<p class="oph-today-line">The Resident level uses the full classification for every clinic. It is part of StewardMD Pro.</p>' +
        '<button class="oph-btn pri oph-wide" data-act="pro">' + ico("lock") + " Unlock Resident level</button>";
    } else {
      today = '<p class="oph-today-line">' + (due
        ? "<b>" + fmt(due) + "</b> " + (due === 1 ? "patient" : "patients") + " waiting for review"
        : "No reviews waiting. Start with new referrals.") +
        (streak ? ' <span class="oph-mut">· ' + streak + (streak === 1 ? " day" : " days") + " in a row</span>" : "") + "</p>" +
        '<button class="oph-btn pri oph-wide" data-act="today">' + ico("play") + " Start clinic</button>";
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
      '<h2 class="oph-h2">Clinics</h2><ul class="oph-clinics">' + rows + "</ul>" +
      '<p class="oph-note">Beta: teaching points and plans await review by an ophthalmologist. ' +
      '<button class="oph-link" data-act="sources">Images and sources</button></p></div>');
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
    var plan = t.plan && t.plan[fine] ? '<h3 class="oph-h3">Plan</h3><p class="oph-plan">' + esc(t.plan[fine]) + "</p>" : "";
    return '<div class="oph-reveal">' + verdict + ref +
      '<h3 class="oph-h3">Signs of ' + esc(t.labels[fine]) + '</h3><ul class="oph-signs">' + signs + "</ul>" +
      contrast + plan + (t.pearl ? '<p class="oph-pearl">' + esc(t.pearl) + "</p>" : "") + "</div>";
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
  function startCases() {
    var d = st.decks.cases, pro = I.isPro(), t = I.track("cases");
    var list = d.items.map(function (c, i) { return { c: c, i: i }; }).filter(function (x) { return !D.caseLocked(st.cfg, x.i, pro); });
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
        '<details class="oph-ai"><summary>GPT-4V’s answer in the OphthalVQA study</summary><p>' + esc(q.ai) + "</p></details></div></li>";
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
  A.cases = startCases;
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
