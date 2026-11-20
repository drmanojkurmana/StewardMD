/* PrepNucleus mascot "Nucleo": a cell nucleus, stained the hematoxylin blue-violet every medic knows from histology,
   with a nuclear membrane and its pores, a nucleolus, a curl of chromatin, and a graduation cap with an amber tassel
   (PrepNucleus amber and navy). window.PREP_MASCOT. ES5.
   Owner 2026-11-20: "Create new mascot to suit prepnucleus" (after the MaiK buddy, prep-buddy.js).
   One inline SVG; faces and poses are CSS states (data-face, data-pose on the root), motion is CSS keyframes, so there is
   no animation loop: a blink timer and a few timeouts only. Reduced motion: faces change, nothing moves or floats.
   Decorative: aria-hidden; only the figure itself takes taps (tap = opts.onTap, swipe left = hide, the tab brings him back).
   API (same shape prep-buddy.js uses for the MaiK companion): mount(host, opts) -> { el, cue("quiz", {kind, n}), state(),
   setHidden(h), destroy() }. Kinds: right, streak, back, wrong, slump, done (n = percent), perfect. */
(function (G) {
  "use strict";
  if (typeof document === "undefined" || G.PREP_MASCOT) return;
  var D = document;

  // Palette: hematoxylin body, membrane, pores, nucleolus; cap in PrepNucleus ink, tassel in its amber.
  var C = { hi: "#7F8FEA", lo: "#3B49A3", rim: "#28337E", pore: "#D6DCFF", nuc: "#26307A", chr: "#B9C3FA",
    cap: "#13203D", capEdge: "#3A4A78", amber: "#EFC07B", amberLo: "#D9A24F", eye: "#FFFFFF", pupil: "#141B3D", cheek: "#F49AB4" };

  function svg() {
    var pores = "", i, a;
    for (i = 0; i < 10; i++) { a = (i / 10) * Math.PI * 2 + 0.3; pores += '<circle cx="' + (32 + Math.cos(a) * 21).toFixed(2) + '" cy="' + (44 + Math.sin(a) * 21).toFixed(2) + '" r="1.05" fill="' + C.pore + '"/>'; }
    return '<svg class="pnm-svg" viewBox="0 0 64 76" width="64" height="76" aria-hidden="true" focusable="false">' +
      '<defs><radialGradient id="pnmG" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="' + C.hi + '"/><stop offset="1" stop-color="' + C.lo + '"/></radialGradient></defs>' +
      '<ellipse class="pnm-shadow" cx="32" cy="72.5" rx="15" ry="2.6" fill="#0b1230" opacity=".22"/>' +
      '<g class="pnm-fig">' +
        // feet
        '<ellipse cx="25" cy="66.5" rx="5" ry="3" fill="' + C.rim + '"/><ellipse cx="39" cy="66.5" rx="5" ry="3" fill="' + C.rim + '"/>' +
        // arms (rotate at the shoulder per pose)
        '<g class="pnm-armL"><ellipse cx="8.4" cy="52.5" rx="3.8" ry="7.6" fill="' + C.lo + '" stroke="' + C.rim + '" stroke-width="1.2"/></g>' +
        '<g class="pnm-armR"><ellipse cx="55.6" cy="52.5" rx="3.8" ry="7.6" fill="' + C.lo + '" stroke="' + C.rim + '" stroke-width="1.2"/></g>' +
        // body: nucleus, membrane, pores, chromatin, nucleolus
        '<circle cx="32" cy="44" r="22" fill="url(#pnmG)" stroke="' + C.rim + '" stroke-width="2.2"/>' + pores +
        '<path d="M18 37c3-4 6-1 8-4s5-3 6 0" fill="none" stroke="' + C.chr + '" stroke-width="1.3" stroke-linecap="round" opacity=".55"/>' +
        '<path d="M41 57c2 1 4 0 5-2" fill="none" stroke="' + C.chr + '" stroke-width="1.2" stroke-linecap="round" opacity=".45"/>' +
        '<ellipse cx="45.5" cy="49" rx="3.6" ry="3.1" fill="' + C.nuc + '" opacity=".75"/><circle cx="44.5" cy="48" r=".9" fill="' + C.chr + '" opacity=".7"/>' +
        '<ellipse cx="24" cy="33" rx="5" ry="3" fill="#fff" opacity=".18" transform="rotate(-25 24 33)"/>' +
        // cheeks
        '<g class="pnm-cheeks" fill="' + C.cheek + '"><ellipse cx="20" cy="49.5" rx="3.3" ry="2" opacity=".55"/><ellipse cx="44" cy="49.5" rx="3.3" ry="2" opacity=".55"/></g>' +
        // brows
        '<g class="pnm-brows" stroke="' + C.pupil + '" stroke-width="1.5" stroke-linecap="round" fill="none"><path class="pnm-browL" d="M21.5 34.2h5"/><path class="pnm-browR" d="M37.5 34.2h5"/></g>' +
        // eyes: open (with pupils that look around), happy arcs, closed lines
        '<g class="pnm-eyes-open"><ellipse cx="25" cy="41" rx="4.4" ry="5" fill="' + C.eye + '"/><ellipse cx="39" cy="41" rx="4.4" ry="5" fill="' + C.eye + '"/>' +
          '<g class="pnm-pupils"><circle cx="25.6" cy="41.6" r="2.6" fill="' + C.pupil + '"/><circle cx="39.6" cy="41.6" r="2.6" fill="' + C.pupil + '"/><circle cx="26.5" cy="40.5" r=".85" fill="#fff"/><circle cx="40.5" cy="40.5" r=".85" fill="#fff"/></g>' +
          '<g class="pnm-lids" fill="' + C.lo + '"><path d="M20.4 36h9.2v4.4c-3-1.4-6.2-1.4-9.2 0z"/><path d="M34.4 36h9.2v4.4c-3-1.4-6.2-1.4-9.2 0z"/></g></g>' +
        '<g class="pnm-eyes-happy" stroke="' + C.pupil + '" stroke-width="1.9" stroke-linecap="round" fill="none"><path d="M21.2 42.2q3.8-4.6 7.6 0"/><path d="M35.2 42.2q3.8-4.6 7.6 0"/></g>' +
        '<g class="pnm-eyes-shut" stroke="' + C.pupil + '" stroke-width="1.8" stroke-linecap="round"><path d="M21.4 41.5h7.2"/><path d="M35.4 41.5h7.2"/></g>' +
        // mouths
        '<path class="pnm-m pnm-m-smile" d="M28.2 50.6q3.8 3.2 7.6 0" fill="none" stroke="' + C.pupil + '" stroke-width="1.7" stroke-linecap="round"/>' +
        '<g class="pnm-m pnm-m-grin"><path d="M26.6 49.6h10.8q-.4 6-5.4 6t-5.4-6z" fill="' + C.pupil + '"/><path d="M29.2 53.6q2.8 1.9 5.6 0" fill="#F27D9B"/></g>' +
        '<path class="pnm-m pnm-m-frown" d="M28.4 53.4q3.6-3 7.2 0" fill="none" stroke="' + C.pupil + '" stroke-width="1.7" stroke-linecap="round"/>' +
        '<path class="pnm-m pnm-m-flat" d="M29 52h6" stroke="' + C.pupil + '" stroke-width="1.7" stroke-linecap="round"/>' +
        '<ellipse class="pnm-m pnm-m-o" cx="32" cy="52" rx="2.2" ry="2.6" fill="' + C.pupil + '"/>' +
        // tear (sad)
        '<path class="pnm-tear" d="M20.6 46.5q-1.6 2.6 0 3.6q1.6-1 0-3.6z" fill="#8FD3FF"/>' +
        // graduation cap: band, board, button, tassel (the tassel swings)
        '<g class="pnm-cap"><path d="M22 23.5h20v5.5q-10 3.2-20 0z" fill="' + C.cap + '" stroke="' + C.capEdge + '" stroke-width=".8"/>' +
          '<path d="M32 13.5L51 20.5L32 27.5L13 20.5z" fill="' + C.cap + '" stroke="' + C.capEdge + '" stroke-width=".9" stroke-linejoin="round"/>' +
          '<circle cx="32" cy="20.5" r="1.5" fill="' + C.amber + '"/>' +
          '<g class="pnm-tassel"><path d="M32 20.5L46 23v8" fill="none" stroke="' + C.amber + '" stroke-width="1.1" stroke-linecap="round"/><path d="M44.6 30.5h2.8l.6 4.6h-4z" fill="' + C.amber + '" stroke="' + C.amberLo + '" stroke-width=".5"/></g></g>' +
      "</g></svg>";
  }

  var CSS = ".pnm{position:absolute;right:0;bottom:0;width:64px;height:76px;pointer-events:none}" +
    ".pnm-hit{position:absolute;inset:-6px;pointer-events:auto;cursor:pointer;touch-action:pan-y;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none}" +
    ".pnm-svg{display:block;overflow:visible;filter:drop-shadow(0 2px 3px rgba(8,19,40,.28))}" +
    "body.dark .pnm-svg{filter:drop-shadow(0 0 1px rgba(214,220,255,.55)) drop-shadow(0 2px 4px rgba(0,0,0,.5))}" +
    ".pnm-fig{transform-origin:32px 70px;transform-box:view-box}" +
    ".pnm-armL{transform-origin:11.5px 45px;transform-box:view-box;transition:transform .25s cubic-bezier(.3,1.4,.5,1)}" +
    ".pnm-armR{transform-origin:52.5px 45px;transform-box:view-box;transition:transform .25s cubic-bezier(.3,1.4,.5,1)}" +
    ".pnm-pupils{transition:transform .2s ease-out}" +
    ".pnm-brows path{transform-box:fill-box;transform-origin:50% 50%;transition:transform .2s ease-out}" +
    ".pnm-tassel{transform-origin:32px 20.5px;transform-box:view-box}" +
    ".pnm-cap{transform-origin:32px 22px;transform-box:view-box}" +
    // face states (default: normal)
    ".pnm-eyes-happy,.pnm-eyes-shut,.pnm-m,.pnm-tear,.pnm-lids{display:none}.pnm-cheeks{opacity:.35;transition:opacity .2s}" +
    ".pnm[data-face=normal] .pnm-m-smile{display:inline}" +
    ".pnm[data-face=happy] .pnm-eyes-open{display:none}.pnm[data-face=happy] .pnm-eyes-happy{display:inline}.pnm[data-face=happy] .pnm-m-grin{display:inline}.pnm[data-face=happy] .pnm-cheeks{opacity:1}" +
    ".pnm[data-face=proud] .pnm-m-grin{display:inline}.pnm[data-face=proud] .pnm-cheeks{opacity:.8}" +
    ".pnm[data-face=sad] .pnm-m-frown,.pnm[data-face=cry] .pnm-m-frown{display:inline}" +
    ".pnm[data-face=sad] .pnm-lids,.pnm[data-face=cry] .pnm-lids{display:inline}" +
    ".pnm[data-face=sad] .pnm-pupils,.pnm[data-face=cry] .pnm-pupils{transform:translateY(1.2px)}" +
    ".pnm[data-face=sad] .pnm-browL,.pnm[data-face=cry] .pnm-browL{transform:translateY(-.6px) rotate(-18deg)}" +
    ".pnm[data-face=sad] .pnm-browR,.pnm[data-face=cry] .pnm-browR{transform:translateY(-.6px) rotate(18deg)}" +
    ".pnm[data-face=cry] .pnm-tear{display:inline}" +
    ".pnm[data-face=wow] .pnm-m-o{display:inline}.pnm[data-face=wow] .pnm-browL{transform:translateY(-1.4px)}.pnm[data-face=wow] .pnm-browR{transform:translateY(-1.4px)}" +
    ".pnm[data-face=think] .pnm-m-flat{display:inline}.pnm[data-face=think] .pnm-pupils{transform:translate(-1px,-1.6px)}.pnm[data-face=think] .pnm-browR{transform:translateY(-1.2px) rotate(8deg)}" +
    ".pnm.blink[data-face=normal] .pnm-eyes-open,.pnm.blink[data-face=think] .pnm-eyes-open,.pnm.blink[data-face=proud] .pnm-eyes-open{display:none}" +
    ".pnm.blink[data-face=normal] .pnm-eyes-shut,.pnm.blink[data-face=think] .pnm-eyes-shut,.pnm.blink[data-face=proud] .pnm-eyes-shut{display:inline}" +
    // poses: arms
    ".pnm[data-pose=cheer] .pnm-armL{transform:rotate(130deg)}.pnm[data-pose=cheer] .pnm-armR{transform:rotate(-130deg)}" +
    ".pnm[data-pose=wave] .pnm-armR{transform:rotate(-140deg);animation:pnm-wave .5s ease-in-out 2}" +
    ".pnm[data-pose=thumbs] .pnm-armR{transform:rotate(-95deg)}" +
    ".pnm[data-pose=droop] .pnm-armL{transform:rotate(14deg)}.pnm[data-pose=droop] .pnm-armR{transform:rotate(-14deg)}" +
    ".pnm[data-pose=hug] .pnm-armL{transform:rotate(-38deg)}.pnm[data-pose=hug] .pnm-armR{transform:rotate(38deg)}" +
    // motion
    ".pnm .pnm-fig{animation:pnm-bob 2.8s ease-in-out infinite}" +
    ".pnm.go-jump .pnm-fig{animation:pnm-jump .62s cubic-bezier(.3,.7,.4,1)}" +
    ".pnm.go-jump2 .pnm-fig{animation:pnm-jump .55s cubic-bezier(.3,.7,.4,1) 2}" +
    ".pnm.go-nod .pnm-fig{animation:pnm-nod .5s ease-in-out}" +
    ".pnm.go-sink .pnm-fig{animation:pnm-sink 1.4s ease-in-out forwards}" +
    ".pnm.go-shake .pnm-fig{animation:pnm-shake .5s ease-in-out}" +
    ".pnm.go-toss .pnm-cap{animation:pnm-toss 1.15s cubic-bezier(.3,.6,.4,1)}" +
    ".pnm.go-jump .pnm-tassel,.pnm.go-jump2 .pnm-tassel,.pnm.go-toss .pnm-tassel{animation:pnm-swing .6s ease-in-out 2}" +
    ".pnm.go-squish .pnm-fig{animation:pnm-squish .32s ease-out}" +
    "@keyframes pnm-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.2px)}}" +
    "@keyframes pnm-jump{0%{transform:translateY(0) scale(1.06,.92)}35%{transform:translateY(-16px) scale(.96,1.05)}70%{transform:translateY(0) scale(1.07,.93)}100%{transform:none}}" +
    "@keyframes pnm-nod{0%,100%{transform:none}40%{transform:translateY(2px) rotate(-3deg)}}" +
    "@keyframes pnm-sink{0%{transform:none}40%{transform:translateY(3px) scale(1.03,.95)}100%{transform:translateY(2px) scale(1.02,.97)}}" +
    "@keyframes pnm-shake{0%,100%{transform:none}25%{transform:rotate(-6deg)}75%{transform:rotate(6deg)}}" +
    "@keyframes pnm-squish{0%{transform:none}40%{transform:scale(1.1,.88)}100%{transform:none}}" +
    "@keyframes pnm-toss{0%{transform:none}45%{transform:translateY(-30px) rotate(200deg)}80%{transform:translateY(2px) rotate(360deg)}100%{transform:rotate(360deg)}}" +
    "@keyframes pnm-swing{0%,100%{transform:none}50%{transform:rotate(-14deg)}}" +
    "@keyframes pnm-wave{0%,100%{transform:rotate(-140deg)}50%{transform:rotate(-115deg)}}" +
    // floating bits: hearts, stars, check, sweat drop
    ".pnm-fx{position:absolute;pointer-events:none;font:700 13px/1 Inter,system-ui,sans-serif;animation:pnm-rise 1.3s ease-out forwards}" +
    "@keyframes pnm-rise{0%{opacity:0;transform:translateY(4px) scale(.6)}20%{opacity:1;transform:translateY(-4px) scale(1)}100%{opacity:0;transform:translateY(-30px) scale(.9)}}" +
    ".pnm-tab{display:none;position:absolute;right:0;bottom:8px;width:22px;height:40px;border:1px solid #d5dde6;border-right:0;border-radius:10px 0 0 10px;background:#fff;color:#3B49A3;font:700 15px/1 Inter,system-ui,sans-serif;pointer-events:auto;padding:0}" +
    "body.dark .pnm-tab{background:#16222b;border-color:#2a3a46;color:#B9C3FA}" +
    ".pnm.hid .pnm-svg,.pnm.hid .pnm-hit{display:none}.pnm.hid .pnm-tab{display:block}" +
    "@media (prefers-reduced-motion: reduce){.pnm .pnm-fig,.pnm .pnm-cap,.pnm .pnm-tassel,.pnm .pnm-armR{animation:none!important}.pnm-fx{display:none}.pnm-armL,.pnm-armR{transition:none}}";
  function css() { if (D.getElementById("pnm-css")) return; var s = D.createElement("style"); s.id = "pnm-css"; s.textContent = CSS; (D.head || D.documentElement).appendChild(s); }

  var FX = {
    heart: '<svg width="12" height="11" viewBox="0 0 10 9"><path d="M5 8.6C1.4 6 0 4.2 0 2.6 0 1.1 1.2 0 2.6 0c1 0 1.9.6 2.4 1.4C5.5.6 6.4 0 7.4 0 8.8 0 10 1.1 10 2.6 10 4.2 8.6 6 5 8.6z" fill="#F2557A"/></svg>',
    star: '<svg width="13" height="13" viewBox="0 0 10 10"><path d="M5 0l1.2 3.6H10L7 5.9 8.1 9.6 5 7.4 1.9 9.6 3 5.9 0 3.6h3.8z" fill="#EFC07B"/></svg>',
    check: '<svg width="16" height="16" viewBox="0 0 14 14"><circle cx="7" cy="7" r="6.4" fill="#1c7a4a"/><path d="M4 7.2l2 2 4-4.2" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    drop: '<svg width="8" height="11" viewBox="0 0 8 11"><path d="M4 0Q0 6 0 7.5A4 3.5 0 0 0 8 7.5Q8 6 4 0z" fill="#8FD3FF"/></svg>'
  };

  function lsGet(k) { try { return G.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { G.localStorage.setItem(k, v); } catch (e) {} }

  function mount(host, opts) {
    opts = opts || {};
    css();
    var reduce = !!opts.reduceMotion, hideKey = opts.hideKey || "smd_prep_buddy_off";
    var el = D.createElement("div"); el.className = "pnm"; el.setAttribute("aria-hidden", "true");
    el.setAttribute("data-face", "normal"); el.setAttribute("data-pose", "rest");
    el.innerHTML = svg() + '<div class="pnm-hit" data-buddy=""></div><button type="button" class="pnm-tab" aria-label="Show the PrepNucleus buddy" tabindex="-1">&#8249;</button>';
    host.appendChild(el);
    var hit = el.querySelector(".pnm-hit"), tab = el.querySelector(".pnm-tab");
    var timers = [], faceT = 0, poseT = 0, goT = 0, blinkT = 0, mood = 0.2, face = "normal", pose = "rest", hidden = false, dead = false;
    function later(fn, ms) { var t = G.setTimeout(function () { if (!dead) fn(); }, ms); timers.push(t); return t; }
    function setFace(f, holdMs, back) {
      face = f; el.setAttribute("data-face", f);
      G.clearTimeout(faceT);
      if (holdMs) faceT = later(function () { setFace(back || (mood < -0.2 ? "sad" : "normal")); }, holdMs);
    }
    function setPose(p, holdMs) {
      pose = p; el.setAttribute("data-pose", p);
      G.clearTimeout(poseT);
      if (holdMs) poseT = later(function () { setPose(mood < -0.2 ? "droop" : "rest"); }, holdMs);
    }
    function go(name, ms) {
      if (reduce) return;
      el.classList.remove("go-jump", "go-jump2", "go-nod", "go-sink", "go-shake", "go-toss", "go-squish");
      void el.offsetWidth;   // restart the keyframes when the same move repeats
      el.classList.add("go-" + name);
      G.clearTimeout(goT);
      if (name !== "sink") goT = later(function () { el.classList.remove("go-" + name); }, ms || 1300);
    }
    function fx(kind, n) {
      if (reduce || hidden) return;
      for (var i = 0; i < (n || 1); i++) (function (i) {
        later(function () {
          var f = D.createElement("span"); f.className = "pnm-fx"; f.innerHTML = FX[kind];
          f.style.left = (14 + i * 14 + Math.random() * 8) + "px"; f.style.top = (-2 - Math.random() * 6) + "px";
          el.appendChild(f); later(function () { if (f.parentNode) f.parentNode.removeChild(f); }, 1400);
        }, i * 130);
      })(i);
    }
    function blink() {
      blinkT = later(function () {
        if (!hidden && !(D.hidden)) { el.classList.add("blink"); later(function () { el.classList.remove("blink"); }, 130); }
        blink();
      }, 2600 + Math.random() * 3600);
    }
    function onQuiz(kind, n) {
      el.classList.remove("go-sink");
      switch (kind) {
        case "right": mood = Math.max(mood, 0) + 0.25; setFace("proud", 1800); setPose("thumbs", 1300); go("squish", 400); fx("check"); break;
        case "streak":
          mood = 0.9; setFace("happy", 2600); setPose("cheer", 1800); go(n >= 5 ? "jump2" : "jump", 1300); fx(n >= 10 ? "star" : "heart", n >= 10 ? 4 : 3);
          break;
        case "back": mood = 0.5; setFace("happy", 2000); setPose("cheer", 1300); go("jump", 700); fx("star", 2); break;
        case "wrong": mood = -0.3; setFace("sad", 0); setPose("droop", 0); go("nod", 600); break;
        case "slump": mood = -0.6; setFace("cry", 0); setPose("droop", 0); go("sink"); fx("drop"); break;
        case "perfect": mood = 1; setFace("happy", 4000); setPose("cheer", 2400); go("toss", 1300); later(function () { go("jump", 700); }, 900); fx("star", 4); break;
        case "done":
          var p = n || 0;
          if (p >= 80) { mood = 0.8; setFace("happy", 3500); setPose("cheer", 2000); go("toss", 1300); fx("star", 3); }
          else if (p >= 50) { mood = 0.3; setFace("proud", 3000); setPose("thumbs", 1800); go("squish", 400); }
          else { mood = -0.1; setFace("think", 3000, "normal"); setPose("hug", 2200); go("nod", 600); }
          break;
        case "calm": mood = 0.1; setFace("normal"); setPose("wave", 1100); break;
      }
    }

    // input: tap = opts.onTap (with a squish), swipe left = hide (kept in hideKey), the tab brings him back
    var pd = null;
    function onDown(e) { e.stopPropagation(); pd = { x: e.clientX, y: e.clientY, moved: false }; }
    function onMove(e) {
      if (!pd) return; var dx = e.clientX - pd.x;
      if (Math.abs(dx) > 8 || Math.abs(e.clientY - pd.y) > 8) pd.moved = true;
      if (pd.moved && dx < 0) el.querySelector(".pnm-svg").style.transform = "translateX(" + Math.round(dx) + "px)";
    }
    function onUp(e) {
      if (!pd) return; var was = pd, dx = e.clientX - was.x; pd = null;
      el.querySelector(".pnm-svg").style.transform = "";
      if (dx < -56) { applyHidden(true, true); return; }
      if (!was.moved) { go("squish", 400); setPose("wave", 1100); if (face === "sad" || face === "cry") setFace("think", 1600); if (opts.onTap) { try { opts.onTap(); } catch (x) {} } }
    }
    function onCancel() { pd = null; el.querySelector(".pnm-svg").style.transform = ""; }
    hit.addEventListener("pointerdown", onDown); hit.addEventListener("pointermove", onMove);
    hit.addEventListener("pointerup", onUp); hit.addEventListener("pointercancel", onCancel);
    function applyHidden(h, persist) {
      hidden = !!h; el.classList.toggle("hid", hidden);
      if (persist) lsSet(hideKey, hidden ? "1" : "0");
      if (!hidden && persist) { setPose("wave", 1100); go("jump", 700); }
    }
    tab.addEventListener("click", function () { applyHidden(false, true); });
    applyHidden(lsGet(hideKey) === "1", false);
    blink();
    if (!reduce && opts.enter !== false) { go("jump", 700); setPose("wave", 1100); }

    return {
      el: el,
      cue: function (kind, data) { try { if (kind === "quiz") onQuiz(data && data.kind, data && data.n); } catch (e) {} },
      // Same fields the MaiK companion reports, so tests read either: mood, face, gesture (pose), mouth.
      state: function () {
        var mouth = { normal: "smile", happy: "grin", proud: "grin", sad: "frown", cry: "frown", wow: "o", think: "flat" }[face] || "smile";
        return { style: "nucleo", mood: Math.round(mood * 100) / 100, face: face, gesture: pose, mouth: mouth, hidden: hidden, reduce: reduce };
      },
      setHidden: function (h) { applyHidden(h, true); },
      destroy: function () {
        dead = true;
        for (var i = 0; i < timers.length; i++) G.clearTimeout(timers[i]);
        timers = [];
        if (el.parentNode) el.parentNode.removeChild(el);
      }
    };
  }

  G.PREP_MASCOT = { version: "1.0.0", name: "Nucleo", mount: mount, svg: svg };
})(typeof window !== "undefined" ? window : this);
