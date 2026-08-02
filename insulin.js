/* insulin.js - Insulin module UI shell + calculators (combined / meal / correction).
 * Wires the pure engine (INSULIN_ENGINE) + safety engine (INSULIN_SAFETY) to a
 * transparent, confirm-gated UI. Overlay module: window.INSULIN = {open, close, isOn}.
 * Motion via window.Motion (vendored). Hard-gated on the smd_insulin flag. */
(function () {
  "use strict";
  if (typeof window === "undefined" || typeof document === "undefined") return;

  var ROOT_ID = "insulinRoot";

  function flags() { return window.SMD_INSULIN_FLAGS; }
  function on() { var f = flags(); return !!(f && f.bool("smd_insulin")); }
  function reduced() { try { return !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; } }

  var st = {
    mode: "combined",
    glucose: 180, target: 120, carbs: 45, icr: 10, isf: 50, iob: 2, increment: 1,
    ctx: { age: 40, weightKg: 70, pregnancy: false, renal: false, hepatic: false },
    acked: false, confirmed: false
  };

  var ICON_AI = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v2M12 19v2M5 12H3M21 12h-2M6.3 6.3 4.9 4.9M19.1 19.1l-1.4-1.4M17.7 6.3l1.4-1.4M4.9 19.1l1.4-1.4"/><circle cx="12" cy="12" r="4"/></svg>';

  /* ---------- Motion helpers ---------- */
  function withMotion(cb) {
    if (window.Motion && window.Motion.animate) return cb(window.Motion);
    if (!document.getElementById("smd-motion-js")) {
      var s = document.createElement("script"); s.id = "smd-motion-js"; s.src = "/vendor/motion/motion.js"; s.defer = true;
      (document.head || document.documentElement).appendChild(s);
    }
    var tries = 0;
    (function wait() { if (window.Motion && window.Motion.animate) return cb(window.Motion); if (tries++ > 60) return; setTimeout(wait, 40); })();
  }
  function springIn(el) {
    if (reduced()) return;
    withMotion(function (M) {
      // Use Motion's typed transform props (scale/y), NOT a transform string with "none":
      // this build mis-interpolates the string form and can settle at scale(0).
      try { M.animate(el, { opacity: [0, 1], scale: [0.985, 1], y: [8, 0] },
        { duration: 0.42, easing: [0.2, 0.7, 0.2, 1] }); } catch (e) {}
    });
  }
  function countUp(el, to) {
    var target = Number(to) || 0;
    if (reduced()) { el.textContent = fmt(target); return; }
    var start = 0, t0 = null, dur = 460;
    function frame(ts) {
      if (t0 === null) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      var cur = start + (target - start) * eased;
      el.textContent = fmt(st.increment === 0.5 ? Math.round(cur * 2) / 2 : Math.round(cur));
      if (p < 1) requestAnimationFrame(frame); else el.textContent = fmt(target);
    }
    requestAnimationFrame(frame);
  }
  function fmt(n) { return (Math.round(Number(n) * 10) / 10).toString(); }

  /* ---------- DOM ---------- */
  function root() {
    var el = document.getElementById(ROOT_ID);
    if (el) return el;
    el = document.createElement("div");
    el.id = ROOT_ID;
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "Insulin dose calculator");
    el.innerHTML =
      '<div class="ins-gridbg"></div>' +
      '<div class="ins-scroll"><div class="ins-wrap">' +
        '<div class="ins-head ins-bf">' +
          '<div class="ins-badge">Iu</div>' +
          '<div><div class="ins-title">Insulin dose</div><div class="ins-sub">Clinical decision support</div></div>' +
          '<button class="ins-x" data-ins="close" aria-label="Close">&times;</button>' +
        '</div>' +
        '<div class="ins-ai ins-bf">' + ICON_AI +
          '<div><b>AI-assisted recommendation.</b> The treating physician makes the final decision. ' +
          'Every value below is shown with its formula and assumptions - nothing is hidden.</div>' +
        '</div>' +
        '<div class="ins-seg ins-bf" role="tablist">' +
          seg("combined", "Combined") + seg("meal", "Meal bolus") + seg("correction", "Correction") +
        '</div>' +
        '<div class="ins-card ins-bf" id="insInputs"></div>' +
        '<div id="insOut"></div>' +
      '</div></div>';
    document.body.appendChild(el);
    el.addEventListener("click", onClick);
    el.addEventListener("input", onInput);
    return el;
  }
  function seg(mode, label) {
    return '<button role="tab" data-ins="mode" data-mode="' + mode + '" aria-pressed="' +
      (st.mode === mode ? "true" : "false") + '">' + label + '</button>';
  }

  function stepper(id, val, stepv) {
    return '<div class="ins-step">' +
      '<button data-ins="dec" data-f="' + id + '" data-s="' + stepv + '" aria-label="decrease">-</button>' +
      '<input data-ins="num" data-f="' + id + '" type="number" inputmode="decimal" value="' + val + '">' +
      '<button data-ins="inc" data-f="' + id + '" data-s="' + stepv + '" aria-label="increase">+</button>' +
    '</div>';
  }
  function mini(id, label, val) {
    return '<div class="ins-mini"><label>' + label + '</label>' +
      '<input data-ins="num" data-f="' + id + '" type="number" inputmode="decimal" value="' + val + '"></div>';
  }
  function ctxChip(key, label) {
    return '<button class="ins-chip" data-ins="ctx" data-k="' + key + '" aria-pressed="' +
      (st.ctx[key] ? "true" : "false") + '">' + label + '</button>';
  }

  function renderInputs() {
    var m = st.mode, h = "";
    if (m !== "meal") {
      h += '<div class="ins-field"><div class="ins-lab">Current glucose <span class="u">mg/dL</span></div>' +
        stepper("glucose", st.glucose, 5) +
        '<div class="ins-chips" style="margin-top:9px">' +
          tgtChip(100) + tgtChip(120) + tgtChip(140) +
        '</div></div>';
    }
    if (m !== "correction") {
      h += '<div class="ins-field"><div class="ins-lab">Carbohydrates <span class="u">g</span></div>' +
        stepper("carbs", st.carbs, 5) + '</div>';
    }
    h += '<div class="ins-field"><div class="ins-grid2">';
    if (m !== "meal") { h += mini("target", "Target mg/dL", st.target) + mini("isf", "ISF mg/dL/u", st.isf); }
    if (m !== "correction") { h += mini("icr", "ICR g/u", st.icr); }
    if (m === "combined") { h += mini("iob", "Active insulin (IOB) u", st.iob); }
    h += '</div></div>';
    h += '<div class="ins-field"><div class="ins-lab">Rounding</div><div class="ins-round">' +
      '<button data-ins="round" data-v="1" aria-pressed="' + (st.increment === 1 ? "true" : "false") + '">1 unit</button>' +
      '<button data-ins="round" data-v="0.5" aria-pressed="' + (st.increment === 0.5 ? "true" : "false") + '">0.5 unit</button>' +
    '</div></div>';
    h += '<div class="ins-field"><div class="ins-lab">Patient context</div><div class="ins-chips">' +
      ctxChip("pregnancy", "Pregnancy") + ctxChip("renal", "Renal") + ctxChip("hepatic", "Hepatic") +
      '<button class="ins-chip" data-ins="peds" aria-pressed="' + (st.ctx.age < 18 ? "true" : "false") + '">Pediatric</button>' +
    '</div></div>';
    document.getElementById("insInputs").innerHTML = h;
  }
  function tgtChip(v) {
    return '<button class="ins-chip" data-ins="target-chip" data-v="' + v + '" aria-pressed="' +
      (st.target === v ? "true" : "false") + '">Target ' + v + '</button>';
  }

  /* ---------- Compute + render output ---------- */
  function compute() {
    var E = window.INSULIN_ENGINE;
    if (st.mode === "meal") return E.mealBolus({ carbs: st.carbs, icr: st.icr, increment: st.increment });
    if (st.mode === "correction") return E.correctionDose({ glucose: st.glucose, target: st.target, isf: st.isf, increment: st.increment });
    return E.combinedDose({ carbs: st.carbs, icr: st.icr, glucose: st.glucose, target: st.target, isf: st.isf, iob: st.iob, increment: st.increment });
  }
  function safety(res) {
    var S = window.INSULIN_SAFETY;
    var input = { glucose: st.glucose, target: st.target, iob: st.mode === "combined" ? st.iob : 0 };
    return S.evaluate(st.ctx, input, res);
  }

  function render() {
    st.acked = false; st.confirmed = false;
    var res = compute();
    var warns = safety(res);
    var hasCritical = warns.some(function (w) { return w.interrupt; });
    var out = document.getElementById("insOut");

    if (res.error || res.rounded == null) {
      out.innerHTML = '<div class="ins-card ins-result"><div class="ins-card-t">Recommendation</div>' +
        '<p style="color:var(--ins-muted);font-size:13px;margin:0">' + res.error + '</p></div>';
      return;
    }

    var stepsHTML = res.steps.map(function (s) {
      return '<li><span class="k">' + s.label + '<br><span class="e">' + s.expr + '</span></span>' +
        '<span class="v">' + s.value + '</span></li>';
    }).join("");

    var assumeHTML = (res.assumptions || []).concat(res.clinicalNotes || []).map(function (a) {
      return '<li>' + a + '</li>';
    }).join("");
    var refsHTML = (res.refs || []).map(function (r) { return '<li>' + r + '</li>'; }).join("");

    var warnHTML = warns.map(function (w) {
      return '<div class="ins-warn ' + w.severity + '"><span class="dot ' + w.severity + '"></span>' +
        '<div><span class="wt">' + w.title + '</span>' + w.detail + '</div></div>';
    }).join("");

    var extraRaw = "";
    if (st.mode === "combined") {
      extraRaw = 'meal ' + res.mealComponent + 'u + correction ' + res.correctionComponent + 'u - IOB ' + res.iobSubtracted + 'u';
    }

    out.innerHTML =
      '<div class="ins-card ins-result ins-bf"><div class="ins-card-t">Recommended dose</div>' +
        '<div class="ins-dose"><span class="n" id="insDoseN">0</span><span class="unit">' + res.unit + '</span></div>' +
        '<div class="ins-fromraw">Computed ' + res.result + ' ' + res.unit + ', rounded to ' + st.increment + ' unit' +
          (extraRaw ? ' &middot; ' + extraRaw : '') + '</div>' +
        '<div class="ins-formula">' + res.formula + '</div>' +
        '<ul class="ins-steps">' + stepsHTML + '</ul>' +
        '<details class="ins-fold"><summary>Assumptions and notes</summary><ul>' + assumeHTML +
          (refsHTML ? '</ul><summary style="cursor:default">References</summary><ul>' + refsHTML : '') +
        '</ul></details>' +
      '</div>' +
      (warnHTML ? '<div class="ins-card ins-warns ins-bf"><div class="ins-card-t">Safety checks</div>' + warnHTML +
        (hasCritical ? '<label class="ins-ack"><input type="checkbox" data-ins="ack"> I have reviewed the critical warning above and take clinical responsibility.</label>' : '') +
        '</div>' : '') +
      '<button class="ins-cta" data-ins="confirm"' + (hasCritical ? ' disabled' : '') + '>' +
        'Accept ' + res.rounded + ' ' + res.unit + ' recommendation</button>' +
      '<div class="ins-done" id="insDone" style="display:none">Recorded to dose history. The order remains the physician\'s to place.</div>';

    var dn = document.getElementById("insDoseN");
    if (dn) countUp(dn, res.rounded);
  }

  /* ---------- Events ---------- */
  function onClick(e) {
    var t = e.target.closest("[data-ins]"); if (!t) return;
    var a = t.getAttribute("data-ins");
    if (a === "close") return close();
    if (a === "mode") { st.mode = t.getAttribute("data-mode"); syncSeg(); renderInputs(); render(); return; }
    if (a === "inc" || a === "dec") {
      var f = t.getAttribute("data-f"), s = parseFloat(t.getAttribute("data-s"));
      st[f] = Math.max(0, (Number(st[f]) || 0) + (a === "inc" ? s : -s));
      var inp = t.parentNode.querySelector('input[data-f="' + f + '"]'); if (inp) inp.value = st[f];
      render(); return;
    }
    if (a === "round") { st.increment = parseFloat(t.getAttribute("data-v")); pressGroup("round"); render(); return; }
    if (a === "target-chip") { st.target = parseFloat(t.getAttribute("data-v")); renderInputs(); render(); return; }
    if (a === "ctx") { var k = t.getAttribute("data-k"); st.ctx[k] = !st.ctx[k]; t.setAttribute("aria-pressed", st.ctx[k]); render(); return; }
    if (a === "peds") { st.ctx.age = st.ctx.age < 18 ? 40 : 8; t.setAttribute("aria-pressed", st.ctx.age < 18); render(); return; }
    if (a === "ack") return; // handled in onInput
    if (a === "confirm") return confirmDose(t);
  }
  function onInput(e) {
    var t = e.target.closest("[data-ins]"); if (!t) return;
    var a = t.getAttribute("data-ins");
    if (a === "num") { var f = t.getAttribute("data-f"); st[f] = parseFloat(t.value); render(); return; }
    if (a === "ack") {
      st.acked = t.checked;
      var cta = document.querySelector('.ins-cta'); if (cta) cta.disabled = !st.acked;
    }
  }
  function syncSeg() {
    var btns = document.querySelectorAll('[data-ins="mode"]');
    for (var i = 0; i < btns.length; i++)
      btns[i].setAttribute("aria-pressed", btns[i].getAttribute("data-mode") === st.mode);
  }
  function pressGroup(name) {
    var btns = document.querySelectorAll('[data-ins="' + name + '"]');
    for (var i = 0; i < btns.length; i++)
      btns[i].setAttribute("aria-pressed", parseFloat(btns[i].getAttribute("data-v")) === st.increment);
  }
  function confirmDose(btn) {
    if (btn.disabled) return;
    var res = compute(), warns = safety(res);
    var entry = { mode: st.mode, inputs: snapshot(), calculatedDose: res.rounded, confirmedDose: res.rounded,
      unit: res.unit, warnings: warns.map(function (w) { return w.id; }), engineVersion: 1 };
    try {
      var key = "smd_insulin_log_demo";
      var log = JSON.parse(localStorage.getItem(key) || "[]");
      log.unshift(entry); localStorage.setItem(key, JSON.stringify(log.slice(0, 50)));
    } catch (e) {}
    btn.style.display = "none";
    var d = document.getElementById("insDone"); if (d) { d.style.display = "block"; springIn(d); }
  }
  function snapshot() {
    return { glucose: st.glucose, target: st.target, carbs: st.carbs, icr: st.icr, isf: st.isf,
      iob: st.iob, increment: st.increment, ctx: JSON.parse(JSON.stringify(st.ctx)) };
  }

  /* ---------- Open / close ---------- */
  function open() {
    if (!on()) return; // hard gate: flag OFF -> no-op
    if (!window.INSULIN_ENGINE || !window.INSULIN_SAFETY) return;
    var el = root();
    el.classList.add("ins-open");
    document.documentElement.classList.add("ins-lock");
    document.body.classList.add("ins-lock");
    syncSeg(); renderInputs(); render();
    springIn(el.querySelector(".ins-wrap"));
  }
  function close() {
    var el = document.getElementById(ROOT_ID);
    if (el) el.classList.remove("ins-open");
    document.documentElement.classList.remove("ins-lock");
    document.body.classList.remove("ins-lock");
  }

  window.INSULIN = { open: open, close: close, isOn: on };
})();
