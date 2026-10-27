/* Rehomes the existing AngioLAB controls into a dock.
   The React nodes keep their handlers. Projection stays in the view store. */
(function () {
  "use strict";

  var TAB = "setup";
  var placing = false;
  var ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';

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
    var same = want.length > 0;
    for (var i = 0; i < want.length; i++) {
      if (parent.children[i] !== want[i]) same = false;
    }
    if (same) return;
    for (var j = 0; j < want.length; j++) parent.appendChild(want[j]);
  }

  function ensureShell() {
    var app = document.querySelector(".app");
    if (!app) return null;
    var body = app.querySelector(".angio-body");
    if (!body) {
      body = el("div", "angio-body");
      var stage = el("div", "angio-stage");
      var dock = el("div", "angio-dock");
      var rail = el("aside", "angio-rail");
      rail.setAttribute("aria-label", "Controls");
      var setup = el("div", "angio-panel");
      setup.setAttribute("data-panel", "setup");
      var views = el("div", "angio-panel");
      views.setAttribute("data-panel", "views");
      rail.appendChild(setup);
      rail.appendChild(views);
      var tabs = el("div", "seg angio-tabseg", "");
      tabs.setAttribute("role", "tablist");
      tabs.setAttribute("aria-label", "Control sections");
      ["setup", "angle", "views"].forEach(function (id, i) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "angio-tab";
        b.setAttribute("role", "tab");
        b.setAttribute("data-tab", id);
        b.setAttribute("aria-selected", i === 0 ? "true" : "false");
        b.textContent = id === "setup" ? "Setup" : id === "angle" ? "Angle" : "Views";
        b.addEventListener("click", function () { selectTab(id); });
        tabs.appendChild(b);
      });
      tabs.appendChild(el("span", "seg-thumb"));
      dock.appendChild(rail);
      dock.appendChild(tabs);
      body.appendChild(stage);
      body.appendChild(dock);
      app.appendChild(body);
      tabs.addEventListener("keydown", onTabKey);
    }
    return {
      app: app,
      stage: app.querySelector(".angio-stage"),
      rail: app.querySelector(".angio-rail"),
      setup: app.querySelector('[data-panel="setup"]'),
      views: app.querySelector('[data-panel="views"]')
    };
  }

  function onTabKey(e) {
    var order = ["setup", "angle", "views"];
    var i = order.indexOf(TAB);
    if (e.key === "ArrowRight") i = (i + 1) % 3;
    else if (e.key === "ArrowLeft") i = (i + 2) % 3;
    else return;
    e.preventDefault();
    selectTab(order[i]);
    var b = document.querySelector('.angio-tab[data-tab="' + order[i] + '"]');
    if (b) b.focus();
  }

  function selectTab(id) {
    TAB = id;
    document.documentElement.setAttribute("data-dock", id);
    var buttons = document.querySelectorAll(".angio-tab");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute("aria-selected", buttons[i].getAttribute("data-tab") === id ? "true" : "false");
    }
    placeThumbs();
  }

  function ensureThumb(seg) {
    if (!seg || seg.classList.contains("seg-grafts")) return;
    if (!seg.querySelector(":scope > .seg-thumb")) seg.appendChild(el("span", "seg-thumb"));
  }

  function placeThumbs() {
    var segs = document.querySelectorAll(".seg:not(.seg-grafts), .angio-tabseg");
    for (var i = 0; i < segs.length; i++) {
      var seg = segs[i];
      var buttons = [];
      for (var c = 0; c < seg.children.length; c++) {
        if (seg.children[c].tagName === "BUTTON") buttons.push(seg.children[c]);
      }
      var thumb = seg.querySelector(":scope > .seg-thumb");
      if (!thumb || !buttons.length) continue;
      var on = 0;
      for (var b = 0; b < buttons.length; b++) {
        var pressed = buttons[b].getAttribute("aria-pressed") === "true" || buttons[b].getAttribute("aria-selected") === "true";
        if (pressed) on = b;
      }
      var sr = seg.getBoundingClientRect();
      var br = buttons[on].getBoundingClientRect();
      if (br.width < 8) continue;
      thumb.style.width = Math.max(0, br.width - 6) + "px";
      thumb.style.transform = "translateX(" + (br.left - sr.left + 3) + "px)";
    }
  }

  function stepper(cls, label, da, db) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "angio-step " + cls;
    b.setAttribute("aria-label", label);
    b.innerHTML = cls.indexOf("dec") >= 0
      ? ICON + '<path d="M3.5 8h9"/></svg>'
      : ICON + '<path d="M8 3.5v9M3.5 8h9"/></svg>';
    b.addEventListener("click", function (e) {
      e.stopPropagation();
      e.preventDefault();
      if (window.__angioLab && window.__angioLab.nudge) window.__angioLab.nudge(da, db);
    });
    return b;
  }

  function ensureSteppers() {
    var rot = document.querySelector('[aria-label="Rotation, RAO / LAO"]');
    if (rot && !rot.querySelector(".angio-dec")) {
      rot.appendChild(stepper("angio-dec", "Decrease rotation 1 degree", -1, 0));
      rot.appendChild(stepper("angio-inc", "Increase rotation 1 degree", 1, 0));
    }
    var col = document.querySelector(".gslider-v");
    col = col && col.parentElement;
    if (col && !col.querySelector(".angio-dec")) {
      col.appendChild(stepper("angio-dec", "Decrease angulation 1 degree", 0, -1));
      col.appendChild(stepper("angio-inc", "Increase angulation 1 degree", 0, 1));
    }
  }

  function ensureResetIcon() {
    var b = document.querySelector(".angio-reset");
    if (!b || b.querySelector("svg")) return;
    b.insertAdjacentHTML("afterbegin", ICON + '<path d="M2.5 8a5.5 5.5 0 0 1 9.3-4"/><path d="M12 2.5V5H9.5"/><path d="M13.5 8a5.5 5.5 0 0 1-9.3 4"/><path d="M4 13.5V11H6.5"/></svg>');
  }

  function ensureSources(views) {
    if (!views || views.querySelector(".angio-sources")) return;
    var b = document.createElement("button");
    b.type = "button";
    b.className = "angio-sources";
    b.textContent = "Sources";
    b.title = "Credits and sources";
    b.addEventListener("click", function () {
      var hit = document.querySelector(".hit-area");
      if (hit) hit.click();
    });
    views.appendChild(b);
  }

  function placeAll() {
    if (placing) return;
    var shell = ensureShell();
    if (!shell) return;
    placing = true;
    var phone = window.innerWidth < 900;
    document.documentElement.classList.toggle("is-phone", phone);
    move(document.querySelector(".o-astrip"), shell.setup);
    move(document.querySelector(".o-hstrip"), shell.setup);
    orderChildren(shell.setup, [
      document.querySelector(".o-astrip"),
      document.querySelector(".o-hstrip")
    ]);
    var heart = document.querySelector(".o-heart");
    var room = document.querySelector(".o-room");
    move(document.querySelector(".o-angio"), shell.stage);
    move(heart, phone ? shell.views : shell.stage);
    move(room, phone ? shell.views : shell.stage);
    if (phone) {
      orderChildren(shell.stage, [document.querySelector(".o-angio")]);
    } else {
      orderChildren(shell.stage, [document.querySelector(".o-angio"), heart, room]);
    }
    move(document.querySelector(".o-card"), shell.views);
    move(document.querySelector(".o-table"), shell.views);
    move(document.querySelector(".o-foot"), shell.views);
    orderChildren(shell.rail, [
      shell.setup,
      document.querySelector(".o-gantry"),
      document.querySelector(".o-pad"),
      shell.views
    ]);
    var segs = document.querySelectorAll(".o-astrip .seg");
    for (var i = 0; i < segs.length; i++) ensureThumb(segs[i]);
    ensureSteppers();
    ensureResetIcon();
    ensureSources(shell.views);
    document.documentElement.classList.add("angio-dock", "angio-ready");
    if (!document.documentElement.getAttribute("data-dock")) selectTab(TAB);
    else placeThumbs();
    placing = false;
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
    window.addEventListener("resize", placeThumbs);
    document.addEventListener("click", function () { requestAnimationFrame(placeThumbs); }, true);
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function () { placeThumbs(); });
      ro.observe(document.documentElement);
    }
    window.addEventListener("resize", function () { placeAll(); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
