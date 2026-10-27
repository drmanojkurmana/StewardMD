/* Rehomes AngioLAB controls into a fluoro stage plus an instrument sheet.
   React nodes keep their handlers. Projection stays in the view store. */
(function () {
  "use strict";

  var TOOL = "arm";
  var DETENT = "peek";
  var placing = false;
  var passes = 0;

  function svg(paths) {
    return '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + "</svg>";
  }

  var ICONS = {
    vessel: svg('<circle cx="6.5" cy="10" r="2"/><path d="M8.5 10h4"/><path d="M12.5 10c1-2 2-3.2 4-4"/><path d="M12.5 10c1 2 2 3.2 4 4"/>'),
    arm: svg('<path d="M4 14.5a7 7 0 0 1 12-5"/><path d="M15 5.5V9h-3.5"/>'),
    views: svg('<rect x="3" y="3.5" width="6" height="5" rx="1"/><rect x="11" y="3.5" width="6" height="5" rx="1"/><rect x="3" y="11.5" width="6" height="5" rx="1"/><rect x="11" y="11.5" width="6" height="5" rx="1"/>'),
    display: svg('<path d="M2 10s3-4.5 8-4.5 8 4.5 8 4.5-3 4.5-8 4.5S2 10 2 10z"/><circle cx="10" cy="10" r="2"/>'),
    study: svg('<path d="M5 3.5h8l2 2V16.5H5z"/><path d="M8 9h4M8 12h4"/>'),
    reset: svg('<path d="M4 10a6 6 0 1 1 1.6 4.1"/><path d="M4 5.5V10h4.5"/>')
  };

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html) n.innerHTML = html;
    return n;
  }

  function move(node, parent) {
    if (!node || !parent || node.parentElement === parent) return;
    parent.appendChild(node);
  }

  function orderChildren(parent, nodes) {
    if (!parent) return;
    var want = nodes.filter(Boolean);
    var same = want.length === parent.children.length;
    for (var i = 0; i < want.length; i++) {
      if (parent.children[i] !== want[i]) same = false;
    }
    if (same) return;
    for (var j = 0; j < want.length; j++) parent.appendChild(want[j]);
  }

  function phone() {
    return window.innerWidth < 900;
  }

  function toolBtn(id, label, icon) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "angio-tool";
    b.setAttribute("data-tool", id);
    b.setAttribute("aria-label", label);
    b.title = label;
    b.innerHTML = icon + "<span>" + label + "</span>";
    b.addEventListener("click", function () { selectTool(id, true); });
    return b;
  }

  function ensureShell() {
    var app = document.querySelector(".app");
    if (!app) return null;
    var body = app.querySelector(".angio-body");
    if (!body) {
      body = el("div", "angio-body");
      var tools = el("nav", "angio-tools");
      tools.setAttribute("aria-label", "Instruments");
      tools.appendChild(toolBtn("vessel", "Vessel", ICONS.vessel));
      tools.appendChild(toolBtn("arm", "C-arm", ICONS.arm));
      tools.appendChild(toolBtn("views", "Views", ICONS.views));
      tools.appendChild(toolBtn("display", "Display", ICONS.display));
      tools.appendChild(toolBtn("study", "Study", ICONS.study));

      var stage = el("div", "angio-stage");
      var top = el("div", "angio-top");
      var angle = el("div", "angio-angle");
      angle.setAttribute("aria-live", "polite");
      top.appendChild(angle);

      var sheet = el("aside", "angio-sheet");
      sheet.setAttribute("aria-label", "Controls");
      var grab = el("button", "angio-grab", "<span></span>");
      grab.type = "button";
      grab.setAttribute("aria-label", "Resize controls");
      var scroll = el("div", "angio-sheet-scroll");
      var summary = el("div", "angio-summary");
      var vesselBtn = el("button", "angio-vessel");
      vesselBtn.type = "button";
      vesselBtn.innerHTML = '<span class="angio-vessel-k">Vessel</span><span class="angio-vessel-v">Left, right dominant</span>';
      vesselBtn.addEventListener("click", function () { openSection("vessel"); });
      var displayBtn = el("button", "angio-display-jump");
      displayBtn.type = "button";
      displayBtn.setAttribute("aria-label", "Display");
      displayBtn.innerHTML = ICONS.display;
      displayBtn.addEventListener("click", function () { openSection("display"); });
      summary.appendChild(vesselBtn);
      summary.appendChild(displayBtn);

      var vessel = el("section", "angio-sec");
      vessel.setAttribute("data-tool", "vessel");
      vessel.appendChild(el("h2", "angio-h", "Vessel"));
      var arm = el("section", "angio-sec");
      arm.setAttribute("data-tool", "arm");
      arm.appendChild(el("h2", "angio-h", "C-arm"));
      var nudge = el("div", "angio-nudge");
      nudge.appendChild(stepper("RAO", "Decrease rotation 1 degree", -1, 0));
      nudge.appendChild(stepper("LAO", "Increase rotation 1 degree", 1, 0));
      nudge.appendChild(stepper("CAU", "Decrease angulation 1 degree", 0, -1));
      nudge.appendChild(stepper("CRA", "Increase angulation 1 degree", 0, 1));
      arm.appendChild(nudge);
      var views = el("section", "angio-sec");
      views.setAttribute("data-tool", "views");
      views.appendChild(el("h2", "angio-h", "Standard views"));
      var display = el("section", "angio-sec");
      display.setAttribute("data-tool", "display");
      display.appendChild(el("h2", "angio-h", "Display"));
      var study = el("section", "angio-sec");
      study.setAttribute("data-tool", "study");
      study.appendChild(el("h2", "angio-h", "Study"));

      scroll.appendChild(summary);
      scroll.appendChild(vessel);
      scroll.appendChild(arm);
      scroll.appendChild(views);
      scroll.appendChild(display);
      scroll.appendChild(study);
      sheet.appendChild(grab);
      sheet.appendChild(scroll);
      body.appendChild(tools);
      body.appendChild(stage);
      body.appendChild(top);
      body.appendChild(sheet);
      app.appendChild(body);
      bindSheet(grab, sheet);
    }
    return {
      app: app,
      top: app.querySelector(".angio-top"),
      stage: app.querySelector(".angio-stage"),
      vessel: app.querySelector('.angio-sec[data-tool="vessel"]'),
      arm: app.querySelector('.angio-sec[data-tool="arm"]'),
      views: app.querySelector('.angio-sec[data-tool="views"]'),
      display: app.querySelector('.angio-sec[data-tool="display"]'),
      study: app.querySelector('.angio-sec[data-tool="study"]')
    };
  }

  function stepper(text, label, da, db) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "angio-step";
    b.textContent = text;
    b.setAttribute("aria-label", label);
    b.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (window.__angioLab && window.__angioLab.nudge) window.__angioLab.nudge(da, db);
    });
    return b;
  }

  function selectTool(id, fromUser) {
    TOOL = id;
    document.documentElement.setAttribute("data-tool", id);
    var buttons = document.querySelectorAll(".angio-tool");
    for (var i = 0; i < buttons.length; i++) {
      var on = buttons[i].getAttribute("data-tool") === id;
      buttons[i].setAttribute("aria-current", on ? "true" : "false");
    }
    if (fromUser && phone() && id !== "arm") setDetent("full");
  }

  function setDetent(id) {
    DETENT = id;
    document.documentElement.setAttribute("data-detent", id);
    var sheet = document.querySelector(".angio-sheet");
    if (sheet) {
      sheet.classList.remove("is-dragging");
      sheet.style.height = "";
    }
  }

  function openSection(id) {
    selectTool(id, true);
    if (phone()) setDetent("full");
    var sec = document.querySelector('.angio-sec[data-tool="' + id + '"]');
    if (sec && sec.scrollIntoView) sec.scrollIntoView({ block: "start" });
  }

  function nearestDetent(height, velocity) {
    var h = window.innerHeight;
    var peek = 112;
    var half = Math.round(h * 0.48);
    var full = Math.round(h - 64);
    var projected = height + velocity * 0.18;
    var best = "peek";
    var bestD = Infinity;
    var options = [["peek", peek], ["half", half], ["full", full]];
    for (var i = 0; i < options.length; i++) {
      var d = Math.abs(options[i][1] - projected);
      if (d < bestD) { bestD = d; best = options[i][0]; }
    }
    return best;
  }

  function bindSheet(grab, sheet) {
    if (grab.dataset.bound) return;
    grab.dataset.bound = "1";
    var startY = 0;
    var startH = 0;
    var lastY = 0;
    var lastT = 0;
    var vel = 0;
    grab.addEventListener("pointerdown", function (e) {
      if (!phone()) return;
      grab.setPointerCapture(e.pointerId);
      startY = e.clientY;
      lastY = e.clientY;
      lastT = Date.now();
      startH = sheet.getBoundingClientRect().height;
      sheet.classList.add("is-dragging");
    });
    grab.addEventListener("pointermove", function (e) {
      if (!sheet.classList.contains("is-dragging")) return;
      var now = Date.now();
      var dy = lastY - e.clientY;
      if (now > lastT) vel = dy / (now - lastT) * 16;
      lastY = e.clientY;
      lastT = now;
      var next = startH + (startY - e.clientY);
      var max = window.innerHeight - 64;
      if (next < 96) next = 96 + (next - 96) * 0.35;
      if (next > max) next = max + (next - max) * 0.35;
      sheet.style.height = next + "px";
    });
    function end() {
      if (!sheet.classList.contains("is-dragging")) return;
      var h = sheet.getBoundingClientRect().height;
      setDetent(nearestDetent(h, vel));
      vel = 0;
    }
    grab.addEventListener("pointerup", end);
    grab.addEventListener("pointercancel", end);
  }

  function presetAngles(text) {
    var rao = /RAO\s+(\d+)/.exec(text);
    var lao = /LAO\s+(\d+)/.exec(text);
    var cra = /CRA\s+(\d+)/.exec(text);
    var cau = /CAU\s+(\d+)/.exec(text);
    var ap = /\bAP\b/.test(text);
    var a = rao ? -Number(rao[1]) : lao ? Number(lao[1]) : ap ? 0 : null;
    var b = cra ? Number(cra[1]) : cau ? -Number(cau[1]) : null;
    if (a === null && /\b0\b/.test(text)) a = 0;
    if (b === null && /CRA\s+0|CAU\s+0|\b0\b/.test(text)) b = 0;
    return { a: a, b: b };
  }

  function thumbFor(btn) {
    if (btn.querySelector(".angio-thumb")) return;
    var ang = presetAngles((btn.innerText || "").replace(/\s+/g, " "));
    var a = ang.a || 0;
    var b = ang.b || 0;
    var x = 32 + Math.max(-24, Math.min(24, a / 90 * 24));
    var y = 20 - Math.max(-14, Math.min(14, b / 45 * 14));
    var svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgEl.setAttribute("class", "angio-thumb");
    svgEl.setAttribute("viewBox", "0 0 64 40");
    svgEl.setAttribute("aria-hidden", "true");
    svgEl.innerHTML = '<path d="M32 6v28M10 20h44" stroke="#C7C7CC" stroke-width="1"/>' +
      '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="3.2" fill="#1C1C1E"/>';
    btn.insertBefore(svgEl, btn.firstChild);
  }

  function shortName(text) {
    var t = (text || "").replace(/\s+/g, " ").trim();
    if (/both/i.test(t)) return "Both";
    if (/left/i.test(t)) return "Left";
    if (/right/i.test(t)) return "Right";
    if (/^co/i.test(t)) return "Co";
    return t;
  }

  function pressedButton(root) {
    if (!root) return null;
    var buttons = root.querySelectorAll("button");
    for (var i = 0; i < buttons.length; i++) {
      if (buttons[i].getAttribute("aria-pressed") === "true" || buttons[i].getAttribute("data-on") === "true") return buttons[i];
    }
    return null;
  }

  function syncChrome() {
    var reads = document.querySelectorAll(".gantry-readout");
    var parts = [];
    for (var i = 0; i < reads.length; i++) {
      var t = (reads[i].textContent || "").replace(/\s+/g, " ").trim();
      if (t) parts.push(t);
    }
    var angle = document.querySelector(".angio-angle");
    if (angle) {
      var next = parts.join("   ");
      if (angle.textContent !== next) angle.textContent = next;
    }
    var sys = pressedButton(document.querySelector('[aria-label="Injected system"]'));
    var dom = pressedButton(document.querySelector('[aria-label="Dominance"]'));
    var graft = pressedButton(document.querySelector('[aria-label="Bypass grafts"]'));
    var ramusOn = false;
    var ramusBtns = document.querySelectorAll(".o-astrip button");
    for (var r = 0; r < ramusBtns.length; r++) {
      if ((ramusBtns[r].innerText || "").indexOf("Ramus") >= 0 && ramusBtns[r].getAttribute("aria-pressed") === "true") ramusOn = true;
    }
    var line = shortName(sys && sys.innerText);
    if (!line) line = "Left";
    var d = shortName(dom && dom.innerText) || "Right";
    if (d === "Co") line += ", co-dominant";
    else if (d === "Left") line += ", left dominant";
    else line += ", right dominant";
    if (ramusOn) line += ", ramus";
    if (graft) {
      var g = (graft.innerText || "").replace(/\s+/g, " ").trim();
      if (g && !/off/i.test(g)) line += ", " + g;
    }
    var v = document.querySelector(".angio-vessel-v");
    if (v && v.textContent !== line) v.textContent = line;
  }

  function ensureSources(study) {
    if (!study || study.querySelector(".angio-sources")) return;
    var b = document.createElement("button");
    b.type = "button";
    b.className = "angio-sources";
    b.textContent = "For educational purposes";
    b.addEventListener("click", function () {
      var hit = document.querySelector(".hit-area");
      if (hit) hit.click();
    });
    study.appendChild(b);
  }

  function parkSliders() {
    var body = document.querySelector(".angio-body");
    if (!body) return;
    var host = body.querySelector(".angio-keys");
    if (!host) {
      host = el("div", "angio-keys");
      body.appendChild(host);
    }
    var sliders = document.querySelectorAll(".gslider");
    for (var i = 0; i < sliders.length; i++) {
      if (sliders[i].parentElement !== host) host.appendChild(sliders[i]);
    }
  }

  function ensureResetIcon() {
    var b = document.querySelector(".angio-reset");
    if (!b || b.querySelector("svg")) return;
    b.insertAdjacentHTML("afterbegin", ICONS.reset);
  }

  function placeAll() {
    if (placing || passes > 40) return;
    passes++;
    var shell = ensureShell();
    if (!shell) return;
    placing = true;
    var isPhone = phone();
    document.documentElement.classList.toggle("is-phone", isPhone);
    document.documentElement.classList.add("angio-dock", "angio-ready");
    if (!document.documentElement.getAttribute("data-tool")) selectTool(TOOL);
    else selectTool(document.documentElement.getAttribute("data-tool") || TOOL);
    if (!document.documentElement.getAttribute("data-detent")) setDetent(DETENT);

    var header = document.querySelector(".app > header");
    var angle = shell.top.querySelector(".angio-angle");
    var h1 = (header && header.querySelector("h1")) || shell.top.querySelector("h1");
    var status = (header && header.querySelector(".font-mono")) || shell.top.querySelector(".font-mono");
    orderChildren(shell.top, [
      h1,
      status,
      angle,
      document.querySelector(".angio-reset"),
      document.querySelector('button[aria-label="Full screen"], button[aria-label="Exit full screen"]')
    ]);
    ensureResetIcon();

    move(document.querySelector(".o-angio"), shell.stage);
    move(document.querySelector(".o-astrip"), shell.vessel);
    move(document.querySelector(".o-pad"), shell.arm);
    move(document.querySelector(".o-gantry"), shell.views);
    move(document.querySelector(".o-hstrip"), shell.display);
    move(document.querySelector(".o-heart"), shell.display);
    move(document.querySelector(".o-room"), shell.display);
    move(document.querySelector(".o-card"), shell.study);
    move(document.querySelector(".o-table"), shell.study);
    move(document.querySelector(".o-foot"), shell.study);
    orderChildren(shell.arm, [
      shell.arm.querySelector(".angio-h"),
      document.querySelector(".o-pad"),
      shell.arm.querySelector(".angio-nudge")
    ]);
    orderChildren(shell.views, [
      shell.views.querySelector(".angio-h"),
      document.querySelector(".o-gantry")
    ]);
    ensureSources(shell.study);
    parkSliders();
    var presets = document.querySelectorAll(".preset");
    for (var i = 0; i < presets.length; i++) thumbFor(presets[i]);
    placing = false;
    syncChrome();
    document.documentElement.setAttribute("data-passes", String(passes));
    clearTimeout(placeAll.timer);
    placeAll.timer = setTimeout(function () { passes = 0; }, 1000);
  }

  function boot() {
    if (!document.querySelector(".app")) {
      requestAnimationFrame(boot);
      return;
    }
    placeAll();
    var obs = new MutationObserver(function () {
      if (placing) return;
      placeAll();
    });
    obs.observe(document.querySelector(".app"), { childList: true, subtree: true });
    var watch = new MutationObserver(syncChrome);
    watch.observe(document.querySelector(".app"), { subtree: true, characterData: true, attributes: true, attributeFilter: ["aria-pressed", "data-on"] });
    window.addEventListener("resize", function () { placeAll(); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
