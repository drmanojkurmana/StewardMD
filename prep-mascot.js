/* PrepNucleus mascot "Nucleo": a cell nucleus, stained the hematoxylin blue-violet every medic knows from histology,
   with a nuclear membrane and its pores, a nucleolus, a curl of chromatin, and a graduation cap with an amber tassel
   (PrepNucleus amber and navy). window.PREP_MASCOT. ES5.
   Owner 2026-11-20: "Create new mascot to suit prepnucleus" (after the MaiK buddy, prep-buddy.js).
   One inline SVG; faces and poses are CSS states (data-face, data-pose on the root), motion is CSS keyframes, so there is
   no animation loop: a blink timer and a few timeouts only. Reduced motion: faces change, nothing moves or floats.
   Decorative: aria-hidden; only the figure itself takes taps (tap = opts.onTap, swipe left = hide, the tab brings him back).
   API (same shape prep-buddy.js uses for the MaiK companion): mount(host, opts) -> { el, cue("quiz", {kind, n}), state(),
   setHidden(h), destroy() }. Kinds: right, streak, back, wrong, slump, done (n = percent), perfect; and the clock ones:
   tense (n = 0 calm, 1 tense, 2 panic), timeout, newq (a new question on screen).
   Owner 2026-11-20 (2): "mascot should be very lively. And can also get tensed turn red when time is almost up".
   Lively: an idle life of his own every 3-6 s (glance, read the question, stretch, sway, peek, tassel flick, hop, a little
   dance when the set goes well), eyes that follow taps and scrolling, drowsy after 45 s without a touch and asleep at 60 s
   (a tap wakes him with a start). Tense: the body colour runs from hematoxylin blue to flushed red (registered custom
   properties, so it fades), sweat drops, gritted teeth, a tremble and glances up at the clock; panic adds steam from
   under the cap, a scream face and flailing arms; time up is mind-blown (the cap shoots off). Relief: colour back, a wipe
   of the brow. */
(function (G) {
  "use strict";
  if (typeof document === "undefined" || G.PREP_MASCOT) return;
  var D = document;

  // Palette: hematoxylin body, membrane, pores, nucleolus; cap in PrepNucleus ink, tassel in its amber.
  var C = { hi: "#7F8FEA", lo: "#3B49A3", rim: "#28337E", pore: "#D6DCFF", nuc: "#26307A", chr: "#B9C3FA",
    cap: "#13203D", capEdge: "#3A4A78", amber: "#EFC07B", amberLo: "#D9A24F", eye: "#FFFFFF", pupil: "#141B3D", cheek: "#F49AB4" };

  var seq = 0;
  // gid: this mascot's own gradient id (two on one page would otherwise both paint with the first one's colours).
  function svg(gid) {
    gid = gid || "pnmG";
    var pores = "", i, a;
    for (i = 0; i < 10; i++) { a = (i / 10) * Math.PI * 2 + 0.3; pores += '<circle cx="' + (32 + Math.cos(a) * 21).toFixed(2) + '" cy="' + (44 + Math.sin(a) * 21).toFixed(2) + '" r="1.05" fill="' + C.pore + '"/>'; }
    return '<svg class="pnm-svg" viewBox="0 0 64 76" width="64" height="76" aria-hidden="true" focusable="false">' +
      '<defs><radialGradient id="' + gid + '" cx="38%" cy="32%" r="75%"><stop offset="0" style="stop-color:var(--pnm-hi)"/><stop offset="1" style="stop-color:var(--pnm-lo)"/></radialGradient></defs>' +
      '<ellipse class="pnm-shadow" cx="32" cy="72.5" rx="15" ry="2.6" fill="#0b1230" opacity=".22"/>' +
      '<g class="pnm-fig">' +
        // feet
        '<ellipse cx="25" cy="66.5" rx="5" ry="3" style="fill:var(--pnm-rim)"/><ellipse cx="39" cy="66.5" rx="5" ry="3" style="fill:var(--pnm-rim)"/>' +
        // arms (rotate at the shoulder per pose)
        '<g class="pnm-armL"><ellipse cx="8.4" cy="52.5" rx="3.8" ry="7.6" stroke-width="1.2" style="fill:var(--pnm-lo);stroke:var(--pnm-rim)"/></g>' +
        '<g class="pnm-armR"><ellipse cx="55.6" cy="52.5" rx="3.8" ry="7.6" stroke-width="1.2" style="fill:var(--pnm-lo);stroke:var(--pnm-rim)"/></g>' +
        // body: nucleus, membrane, pores, chromatin, nucleolus
        '<circle cx="32" cy="44" r="22" fill="url(#' + gid + ')" stroke-width="2.2" style="stroke:var(--pnm-rim)"/>' + pores +
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
          '<g class="pnm-look"><g class="pnm-pupils"><circle cx="25.6" cy="41.6" r="2.6" fill="' + C.pupil + '"/><circle cx="39.6" cy="41.6" r="2.6" fill="' + C.pupil + '"/><circle cx="26.5" cy="40.5" r=".85" fill="#fff"/><circle cx="40.5" cy="40.5" r=".85" fill="#fff"/></g></g>' +
          '<g class="pnm-lids" style="fill:var(--pnm-lo)"><path d="M20.4 36h9.2v4.4c-3-1.4-6.2-1.4-9.2 0z"/><path d="M34.4 36h9.2v4.4c-3-1.4-6.2-1.4-9.2 0z"/></g></g>' +
        '<g class="pnm-eyes-happy" stroke="' + C.pupil + '" stroke-width="1.9" stroke-linecap="round" fill="none"><path d="M21.2 42.2q3.8-4.6 7.6 0"/><path d="M35.2 42.2q3.8-4.6 7.6 0"/></g>' +
        '<g class="pnm-eyes-shut" stroke="' + C.pupil + '" stroke-width="1.8" stroke-linecap="round"><path d="M21.4 41.5h7.2"/><path d="M35.4 41.5h7.2"/></g>' +
        // mouths
        '<path class="pnm-m pnm-m-smile" d="M28.2 50.6q3.8 3.2 7.6 0" fill="none" stroke="' + C.pupil + '" stroke-width="1.7" stroke-linecap="round"/>' +
        '<g class="pnm-m pnm-m-grin"><path d="M26.6 49.6h10.8q-.4 6-5.4 6t-5.4-6z" fill="' + C.pupil + '"/><path d="M29.2 53.6q2.8 1.9 5.6 0" fill="#F27D9B"/></g>' +
        '<path class="pnm-m pnm-m-frown" d="M28.4 53.4q3.6-3 7.2 0" fill="none" stroke="' + C.pupil + '" stroke-width="1.7" stroke-linecap="round"/>' +
        '<path class="pnm-m pnm-m-flat" d="M29 52h6" stroke="' + C.pupil + '" stroke-width="1.7" stroke-linecap="round"/>' +
        '<ellipse class="pnm-m pnm-m-o" cx="32" cy="52" rx="2.2" ry="2.6" fill="' + C.pupil + '"/>' +
        // tense: gritted teeth; panic: a scream
        '<g class="pnm-m pnm-m-grit"><rect x="26.4" y="49.6" width="11.2" height="5" rx="1.8" fill="#fff" stroke="' + C.pupil + '" stroke-width="1.2"/><path d="M26.6 52.1h10.8M30.2 49.8v4.6M33.8 49.8v4.6" stroke="' + C.pupil + '" stroke-width=".8"/></g>' +
        '<g class="pnm-m pnm-m-yell"><ellipse cx="32" cy="53" rx="3.6" ry="4.4" fill="' + C.pupil + '"/><ellipse cx="32" cy="55.4" rx="2.2" ry="1.4" fill="#F27D9B"/></g>' +
        // sweat (tense) and steam (panic)
        '<g class="pnm-sweat" fill="#9FDCFF" stroke="#5FB4E6" stroke-width=".5"><path class="s1" d="M48.6 31.5q-2.2 3.6 0 5q2.2-1.4 0-5z"/><path class="s2" d="M15.6 35q-1.8 3 0 4.1q1.8-1.1 0-4.1z"/></g>' +
        '<g class="pnm-steam" fill="#F4F2F7" opacity=".9"><g class="p1"><circle cx="11" cy="21" r="3"/><circle cx="8.6" cy="18.6" r="2.2"/></g><g class="p2"><circle cx="53" cy="21" r="3"/><circle cx="55.4" cy="18.6" r="2.2"/></g></g>' +
        // tear (sad)
        '<path class="pnm-tear" d="M20.6 46.5q-1.6 2.6 0 3.6q1.6-1 0-3.6z" fill="#8FD3FF"/>' +
        // graduation cap: band, board, button, tassel (the tassel swings)
        '<g class="pnm-cap"><path d="M22 23.5h20v5.5q-10 3.2-20 0z" fill="' + C.cap + '" stroke="' + C.capEdge + '" stroke-width=".8"/>' +
          '<path d="M32 13.5L51 20.5L32 27.5L13 20.5z" fill="' + C.cap + '" stroke="' + C.capEdge + '" stroke-width=".9" stroke-linejoin="round"/>' +
          '<circle cx="32" cy="20.5" r="1.5" fill="' + C.amber + '"/>' +
          '<g class="pnm-tassel"><path d="M32 20.5L46 23v8" fill="none" stroke="' + C.amber + '" stroke-width="1.1" stroke-linecap="round"/><path d="M44.6 30.5h2.8l.6 4.6h-4z" fill="' + C.amber + '" stroke="' + C.amberLo + '" stroke-width=".5"/></g></g>' +
      "</g></svg>";
  }

  var CSS = "@property --pnm-hi{syntax:'<color>';inherits:true;initial-value:#7F8FEA}" +
    "@property --pnm-lo{syntax:'<color>';inherits:true;initial-value:#3B49A3}" +
    "@property --pnm-rim{syntax:'<color>';inherits:true;initial-value:#28337E}" +
    ".pnm{position:absolute;right:0;bottom:0;width:64px;height:76px;pointer-events:none;--pnm-hi:" + C.hi + ";--pnm-lo:" + C.lo + ";--pnm-rim:" + C.rim + ";transition:--pnm-hi .8s ease,--pnm-lo .8s ease,--pnm-rim .8s ease}" +
    // the flush: tense, then panic red
    ".pnm.t1{--pnm-hi:#F0A08F;--pnm-lo:#C84A5C;--pnm-rim:#8F2A40}" +
    ".pnm.t2{--pnm-hi:#FF7B66;--pnm-lo:#C21F2F;--pnm-rim:#7A0E1C;transition-duration:.45s}" +
    ".pnm-hit{position:absolute;inset:-6px;pointer-events:auto;cursor:pointer;touch-action:pan-y;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none}" +
    ".pnm-svg{display:block;overflow:visible;filter:drop-shadow(0 2px 3px rgba(8,19,40,.28))}" +
    "body.dark .pnm-svg{filter:drop-shadow(0 0 1px rgba(214,220,255,.55)) drop-shadow(0 2px 4px rgba(0,0,0,.5))}" +
    ".pnm-fig{transform-origin:32px 70px;transform-box:view-box}" +
    ".pnm-armL{transform-origin:11.5px 45px;transform-box:view-box;transition:transform .25s cubic-bezier(.3,1.4,.5,1)}" +
    ".pnm-armR{transform-origin:52.5px 45px;transform-box:view-box;transition:transform .25s cubic-bezier(.3,1.4,.5,1)}" +
    ".pnm-pupils{transition:transform .2s ease-out}" +
    ".pnm-look{transition:transform .28s cubic-bezier(.23,1,.32,1)}" +
    ".pnm-brows path{transform-box:fill-box;transform-origin:50% 50%;transition:transform .2s ease-out}" +
    ".pnm-tassel{transform-origin:32px 20.5px;transform-box:view-box}" +
    ".pnm-cap{transform-origin:32px 22px;transform-box:view-box}" +
    // face states (default: normal)
    ".pnm-eyes-happy,.pnm-eyes-shut,.pnm-m,.pnm-tear,.pnm-lids,.pnm-sweat,.pnm-steam{display:none}.pnm-cheeks{opacity:.35;transition:opacity .2s}" +
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
    // tense: worried brows, wide eyes, gritted teeth; panic: brows up, scream; drowsy: heavy lids; sleep: eyes shut
    ".pnm[data-face=tense] .pnm-m-grit{display:inline}.pnm[data-face=panic] .pnm-m-yell{display:inline}" +
    ".pnm[data-face=tense] .pnm-browL{transform:translateY(-.8px) rotate(-16deg)}.pnm[data-face=tense] .pnm-browR{transform:translateY(-.8px) rotate(16deg)}" +
    ".pnm[data-face=panic] .pnm-browL{transform:translateY(-2.2px) rotate(-22deg)}.pnm[data-face=panic] .pnm-browR{transform:translateY(-2.2px) rotate(22deg)}" +
    ".pnm[data-face=tense] .pnm-eyes-open ellipse,.pnm[data-face=panic] .pnm-eyes-open ellipse{transform:scale(1.08,1.12);transform-box:fill-box;transform-origin:50% 50%}" +
    ".pnm[data-face=panic] .pnm-pupils{animation:pnm-dart .5s steps(2) infinite}" +
    ".pnm[data-face=drowsy] .pnm-m-smile{display:inline}.pnm[data-face=drowsy] .pnm-lids{display:inline}.pnm[data-face=drowsy] .pnm-lids path{transform:translateY(1.6px)}" +
    ".pnm[data-face=sleep] .pnm-eyes-open{display:none}.pnm[data-face=sleep] .pnm-eyes-shut{display:inline}.pnm[data-face=sleep] .pnm-m-o{display:inline;transform:scale(.6);transform-box:fill-box;transform-origin:50% 50%}" +
    ".pnm.t1 .pnm-sweat,.pnm.t2 .pnm-sweat{display:inline}.pnm.t1 .pnm-sweat .s2{display:none}.pnm.t2 .pnm-steam{display:inline}" +
    ".pnm-sweat path{animation:pnm-drip 1.3s ease-in infinite}.pnm-sweat .s2{animation-delay:.55s}" +
    ".pnm-steam g{transform-box:fill-box;transform-origin:50% 100%;animation:pnm-puff 1s ease-out infinite}.pnm-steam .p2{animation-delay:.5s}" +
    // poses: arms
    ".pnm[data-pose=cheer] .pnm-armL{transform:rotate(130deg)}.pnm[data-pose=cheer] .pnm-armR{transform:rotate(-130deg)}" +
    ".pnm[data-pose=wave] .pnm-armR{transform:rotate(-140deg);animation:pnm-wave .5s ease-in-out 2}" +
    ".pnm[data-pose=thumbs] .pnm-armR{transform:rotate(-95deg)}" +
    ".pnm[data-pose=droop] .pnm-armL{transform:rotate(14deg)}.pnm[data-pose=droop] .pnm-armR{transform:rotate(-14deg)}" +
    ".pnm[data-pose=hug] .pnm-armL{transform:rotate(-38deg)}.pnm[data-pose=hug] .pnm-armR{transform:rotate(38deg)}" +
    ".pnm[data-pose=flail] .pnm-armL{animation:pnm-flailL .32s ease-in-out infinite alternate}.pnm[data-pose=flail] .pnm-armR{animation:pnm-flailR .32s ease-in-out infinite alternate}" +
    ".pnm[data-pose=wipe] .pnm-armR{transform:rotate(-165deg);animation:pnm-wipe .45s ease-in-out 2}" +
    ".pnm[data-pose=stretch] .pnm-armL{transform:rotate(160deg)}.pnm[data-pose=stretch] .pnm-armR{transform:rotate(-160deg)}" +
    ".pnm[data-pose=point] .pnm-armL{transform:rotate(120deg)}" +
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
    // idle life
    ".pnm.go-hop .pnm-fig{animation:pnm-hop .5s cubic-bezier(.3,.7,.4,1)}" +
    ".pnm.go-stretch .pnm-fig{animation:pnm-stretch 1.1s ease-in-out}" +
    ".pnm.go-sway .pnm-fig{animation:pnm-sway 1.6s ease-in-out}" +
    ".pnm.go-peek .pnm-fig{animation:pnm-peek 1.5s cubic-bezier(.23,1,.32,1)}" +
    ".pnm.go-dance .pnm-fig{animation:pnm-dance .9s ease-in-out 2}" +
    ".pnm.go-flick .pnm-tassel{animation:pnm-swing .4s ease-in-out 3}" +
    ".pnm.go-startle .pnm-fig{animation:pnm-jump .5s cubic-bezier(.3,.7,.4,1)}" +
    ".pnm.go-boom .pnm-cap{animation:pnm-blow 1.3s cubic-bezier(.2,.7,.3,1)}.pnm.go-boom .pnm-fig{animation:pnm-squish .5s ease-out}" +
    ".pnm.go-exhale .pnm-fig{animation:pnm-exhale 1.1s ease-in-out}" +
    // the tremble (tense) and the shake (panic) live on the svg, so they stack with any move of the figure
    ".pnm.t1 .pnm-svg{animation:pnm-quake .18s linear infinite}.pnm.t2 .pnm-svg{animation:pnm-quake2 .1s linear infinite}" +
    ".pnm.t1 .pnm-look{animation:pnm-clock 2.6s ease-in-out infinite}" +
    ".pnm.sleep .pnm-fig{animation:pnm-snore 3.4s ease-in-out infinite}" +
    "@keyframes pnm-hop{0%,100%{transform:none}40%{transform:translateY(-7px)}}" +
    "@keyframes pnm-stretch{0%,100%{transform:none}45%,60%{transform:scale(.96,1.08)}}" +
    "@keyframes pnm-sway{0%,100%{transform:none}25%{transform:rotate(-7deg)}75%{transform:rotate(7deg)}}" +
    "@keyframes pnm-peek{0%,100%{transform:none}30%,70%{transform:translateX(-3px) rotate(-11deg)}}" +
    "@keyframes pnm-dance{0%,100%{transform:none}25%{transform:translateY(-5px) rotate(-8deg)}50%{transform:none}75%{transform:translateY(-5px) rotate(8deg)}}" +
    "@keyframes pnm-blow{0%{transform:none}35%{transform:translateY(-38px) rotate(-200deg)}75%{transform:translateY(-6px) rotate(-340deg)}100%{transform:rotate(-360deg)}}" +
    "@keyframes pnm-exhale{0%,100%{transform:none}35%{transform:scale(1.05,.95)}}" +
    "@keyframes pnm-snore{0%,100%{transform:scale(1,1)}50%{transform:scale(1.03,.98)}}" +
    "@keyframes pnm-quake{0%,100%{transform:translateX(0)}25%{transform:translateX(-.6px)}75%{transform:translateX(.6px)}}" +
    "@keyframes pnm-quake2{0%,100%{transform:translate(0,0)}25%{transform:translate(-1.3px,.4px)}50%{transform:translate(.9px,-.5px)}75%{transform:translate(1.3px,.3px)}}" +
    "@keyframes pnm-clock{0%,55%,100%{transform:none}65%,90%{transform:translate(1.7px,-1.8px)}}" +
    "@keyframes pnm-dart{0%{transform:translateX(-1px)}100%{transform:translateX(1px)}}" +
    "@keyframes pnm-drip{0%{opacity:0;transform:translateY(-2px)}25%{opacity:1}100%{opacity:0;transform:translateY(7px)}}" +
    "@keyframes pnm-puff{0%{opacity:0;transform:translateY(2px) scale(.5)}30%{opacity:.95}100%{opacity:0;transform:translateY(-10px) scale(1.25)}}" +
    "@keyframes pnm-flailL{from{transform:rotate(110deg)}to{transform:rotate(150deg)}}" +
    "@keyframes pnm-flailR{from{transform:rotate(-150deg)}to{transform:rotate(-110deg)}}" +
    "@keyframes pnm-wipe{0%,100%{transform:rotate(-165deg)}50%{transform:rotate(-140deg)}}" +
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
    "@media (prefers-reduced-motion: reduce){.pnm .pnm-fig,.pnm .pnm-cap,.pnm .pnm-tassel,.pnm .pnm-armL,.pnm .pnm-armR,.pnm .pnm-svg,.pnm .pnm-look,.pnm .pnm-pupils,.pnm-sweat path,.pnm-steam g{animation:none!important}.pnm-fx{display:none}.pnm-armL,.pnm-armR,.pnm-look{transition:none}}";
  function css() { if (D.getElementById("pnm-css")) return; var s = D.createElement("style"); s.id = "pnm-css"; s.textContent = CSS; (D.head || D.documentElement).appendChild(s); }

  var FX = {
    heart: '<svg width="12" height="11" viewBox="0 0 10 9"><path d="M5 8.6C1.4 6 0 4.2 0 2.6 0 1.1 1.2 0 2.6 0c1 0 1.9.6 2.4 1.4C5.5.6 6.4 0 7.4 0 8.8 0 10 1.1 10 2.6 10 4.2 8.6 6 5 8.6z" fill="#F2557A"/></svg>',
    star: '<svg width="13" height="13" viewBox="0 0 10 10"><path d="M5 0l1.2 3.6H10L7 5.9 8.1 9.6 5 7.4 1.9 9.6 3 5.9 0 3.6h3.8z" fill="#EFC07B"/></svg>',
    check: '<svg width="16" height="16" viewBox="0 0 14 14"><circle cx="7" cy="7" r="6.4" fill="#1c7a4a"/><path d="M4 7.2l2 2 4-4.2" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    drop: '<svg width="8" height="11" viewBox="0 0 8 11"><path d="M4 0Q0 6 0 7.5A4 3.5 0 0 0 8 7.5Q8 6 4 0z" fill="#8FD3FF"/></svg>',
    zz: '<span style="font:800 11px/1 Inter,system-ui,sans-serif;color:#8C95AE">z</span>',
    bang: '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M11 0l2.6 6.4L20 4l-3.4 5.8L22 13l-6.4 1.2L17 21l-6-4.2L5 21l1.4-6.8L0 13l5.4-3.2L2 4l6.4 2.4z" fill="#FFB547" stroke="#C2410C" stroke-width=".8"/></svg>'
  };

  function lsGet(k) { try { return G.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { G.localStorage.setItem(k, v); } catch (e) {} }

  function mount(host, opts) {
    opts = opts || {};
    css();
    var reduce = !!opts.reduceMotion, hideKey = opts.hideKey || "smd_prep_buddy_off";
    var el = D.createElement("div"); el.className = "pnm"; el.setAttribute("aria-hidden", "true");
    el.setAttribute("data-face", "normal"); el.setAttribute("data-pose", "rest");
    el.innerHTML = svg("pnmG" + (++seq)) + '<div class="pnm-hit" data-buddy=""></div><button type="button" class="pnm-tab" aria-label="Show the PrepNucleus buddy" tabindex="-1">&#8249;</button>';
    host.appendChild(el);
    var hit = el.querySelector(".pnm-hit"), tab = el.querySelector(".pnm-tab");
    var timers = [], faceT = 0, poseT = 0, goT = 0, blinkT = 0, mood = 0.2, face = "normal", pose = "rest", hidden = false, dead = false;
    var tens = 0, lastReact = 0, lastInput = Date.now(), sleepy = 0, idleT = 0, zzT = 0, lookT = 0, acts = 0;
    function later(fn, ms) {
      var t = G.setTimeout(function () { var k = timers.indexOf(t); if (k >= 0) timers.splice(k, 1); if (!dead) fn(); }, ms);
      timers.push(t); return t;
    }
    // Where face and arms settle after a reaction: the clock's tension first, then the mood.
    function baseFace() { return tens === 2 ? "panic" : tens === 1 ? "tense" : sleepy === 2 ? "sleep" : sleepy === 1 ? "drowsy" : mood < -0.2 ? "sad" : "normal"; }
    function basePose() { return tens === 2 ? "flail" : tens === 1 ? "hug" : mood < -0.2 ? "droop" : "rest"; }
    function setFace(f, holdMs, back) {
      face = f; el.setAttribute("data-face", f);
      G.clearTimeout(faceT);
      if (holdMs) faceT = later(function () { setFace(back || baseFace()); }, holdMs);
    }
    function setPose(p, holdMs) {
      pose = p; el.setAttribute("data-pose", p);
      G.clearTimeout(poseT);
      if (holdMs) poseT = later(function () { setPose(basePose()); }, holdMs);
    }
    var MOVES = ["go-jump", "go-jump2", "go-nod", "go-sink", "go-shake", "go-toss", "go-squish", "go-hop", "go-stretch", "go-sway", "go-peek", "go-dance", "go-flick", "go-startle", "go-boom", "go-exhale"];
    function go(name, ms) {
      if (reduce) return;
      for (var i = 0; i < MOVES.length; i++) el.classList.remove(MOVES[i]);
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
        if (!hidden && !(D.hidden) && !sleepy) {
          el.classList.add("blink"); later(function () { el.classList.remove("blink"); }, 130);
          if (Math.random() < 0.2) later(function () { el.classList.add("blink"); later(function () { el.classList.remove("blink"); }, 120); }, 260);   // a double blink now and then
        }
        blink();
      }, 2200 + Math.random() * 3400);
    }
    /* Eyes: look(dx, dy) moves the pupils (in SVG units, at most about 2) and they drift back to the middle. */
    var lookEl = el.querySelector(".pnm-look");
    function look(dx, dy, ms) {
      if (sleepy === 2) return;
      lookEl.style.transform = "translate(" + Math.max(-2.2, Math.min(2.2, dx)).toFixed(2) + "px," + Math.max(-2, Math.min(2, dy)).toFixed(2) + "px)";
      G.clearTimeout(lookT);
      lookT = later(function () { lookEl.style.transform = ""; }, ms || 1300);
    }
    function lookAt(x, y) {
      var r = el.getBoundingClientRect(); if (!r.width) return;
      var dx = x - (r.left + r.width / 2), dy = y - (r.top + r.height * 0.55), d = Math.sqrt(dx * dx + dy * dy) || 1;
      look(dx / d * 2.1, dy / d * 1.9, 1500);
    }
    /* His idle life: one small thing every 3-6 s while nothing else is going on (no reaction in the last 2.5 s, no clock
       tension, not asleep, visible). Happy sets dance more; a slow set reads and peeks more. */
    function idle() {
      idleT = later(function () {
        var now = Date.now();
        if (!hidden && !D.hidden && !tens && now - lastReact > 2500) {
          var since = now - lastInput;
          if (since > 60000) { if (sleepy !== 2) sleep(); }
          else if (since > 45000) { if (!sleepy) { sleepy = 1; setFace("drowsy"); if (!reduce) { setFace("wow", 900, "drowsy"); } } }
          else if (!sleepy) idleAct();
        }
        idle();
      }, 3000 + Math.random() * 3000);
    }
    function idleAct() {
      acts++;
      var r = Math.random(), happy = mood > 0.5;
      if (reduce) { if (r < 0.5) look(-2, -1.6, 1400); else look(2, 0, 1200); return; }
      if (happy && r < 0.22) { go("dance", 1900); setPose("cheer", 1700); return; }
      if (r < 0.2) { look(-2.1, -1.7, 1800); go("peek", 1500); return; }                 // a look at the question
      if (r < 0.34) { look(-2.2, -1, 450); later(function () { look(0.6, -1, 450); }, 500); later(function () { look(-2.2, -0.4, 450); }, 1000); later(function () { look(0.6, -0.4, 500); }, 1500); return; }   // reading
      if (r < 0.46) { var s = Math.random() < 0.5 ? -1 : 1; look(2 * s, (Math.random() - 0.5) * 2, 1200); return; }   // a glance
      if (r < 0.56) { go("stretch", 1100); setPose("stretch", 900); return; }
      if (r < 0.66) { go("sway", 1600); return; }
      if (r < 0.75) { go("flick", 1200); look(1.5, -1.8, 900); return; }                // flicks his tassel and looks at it
      if (r < 0.84) { go("hop", 500); return; }
      if (r < 0.92) { setPose("wave", 1100); return; }
      setFace("wow", 700); look(0, -2, 700);                                                // a thought
    }
    function sleep() {
      sleepy = 2; setFace("sleep"); setPose("rest"); el.classList.add("sleep");
      (function z() { zzT = later(function () { if (sleepy === 2) { fx("zz", 1); z(); } }, 1700); })();
    }
    function wake(startle) {
      lastInput = Date.now();
      if (!sleepy) return;
      var was = sleepy; sleepy = 0; el.classList.remove("sleep"); G.clearTimeout(zzT);
      if (was === 2 && startle && !tens) { setFace("wow", 900); go("startle", 600); later(function () { setPose("wave", 1100); }, 500); }
      else setFace(baseFace());
    }
    function onDocDown(e) { if (dead || hidden) return; wake(true); if (!el.contains(e.target)) lookAt(e.clientX, e.clientY); }
    var lastSY = null;
    function onDocScroll(e) {
      if (dead || hidden || sleepy === 2) return;
      var t = e.target, y = t && t.scrollTop; if (typeof y !== "number") return;
      if (lastSY !== null && Math.abs(y - lastSY) > 24) { look(-0.6, y > lastSY ? 1.6 : -1.8, 700); lastInput = Date.now(); }
      lastSY = y;
    }
    D.addEventListener("pointerdown", onDocDown, true);
    D.addEventListener("scroll", onDocScroll, true);

    /* The clock: 0 calm, 1 tense (flushed, sweat, gritted teeth, tremble, glances at the clock), 2 panic (red, steam,
       scream, flailing). Falling back to 0 is relief: the colour drains back and he wipes his brow. */
    function setTension(n) {
      n = n | 0; if (n === tens) return;
      var was = tens; tens = n;
      wake(false);
      el.classList.toggle("t1", n === 1); el.classList.toggle("t2", n === 2);
      if (n === 2) { setFace("panic"); setPose("flail"); fx("drop", 2); go("startle", 500); }
      else if (n === 1) { setFace("tense"); setPose("hug"); fx("drop"); go("nod", 500); }
      else if (was) {
        // An answer that just got its own reaction keeps its face; the relief is the colour and a breath.
        if (Date.now() - lastReact > 1500) { setFace("normal", 0); setPose("wipe", 1000); go("exhale", 1100); }
        else later(function () { if (!tens) setPose("wipe", 900); }, 1200);
      }
    }
    function timeUp() {
      lastReact = Date.now();
      el.classList.remove("t1"); el.classList.add("t2");
      setFace("wow", 1300, "sad"); setPose("cheer", 900); go("boom", 1300); fx("bang"); fx("star", 3);
      later(function () { tens = 0; el.classList.remove("t1", "t2"); mood = Math.min(mood, -0.25); setPose("droop"); }, 1500);
    }
    function onQuiz(kind, n) {
      wake(false);
      if (kind === "tense") return setTension(n);
      if (kind === "timeout") return timeUp();
      if (kind === "newq") { if (!tens && !reduce) { setFace("wow", 700, baseFace()); look(-2, -1.8, 1400); go("hop", 500); } return; }
      lastReact = Date.now();
      el.classList.remove("go-sink");
      switch (kind) {
        case "right": mood = Math.max(mood, 0) + 0.25; setFace("proud", 1800); setPose("thumbs", 1300); go("squish", 400); fx("check"); break;
        case "streak":
          mood = 0.9; setFace("happy", 2600); setPose("cheer", 1800); go(n >= 5 ? "jump2" : "jump", 1300); fx(n >= 10 ? "star" : "heart", n >= 10 ? 4 : 3);
          if (!reduce && n >= 5) later(function () { go("dance", 1900); }, 1300);
          break;
        case "back": mood = 0.5; setFace("happy", 2000); setPose("cheer", 1300); go("jump", 700); fx("star", 2); break;
        case "wrong": mood = -0.3; setFace("sad", 0); setPose("droop", 0); go("nod", 600); break;
        case "slump": mood = -0.6; setFace("cry", 0); setPose("droop", 0); go("sink"); fx("drop"); break;
        case "perfect": mood = 1; setFace("happy", 4000); setPose("cheer", 2400); go("toss", 1300); later(function () { go("dance", 1900); }, 1300); fx("star", 4); break;
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
      if (!was.moved) { lastReact = Date.now(); go("squish", 400); setPose(tens ? basePose() : "wave", 1100); if (face === "sad" || face === "cry") setFace("think", 1600); if (opts.onTap) { try { opts.onTap(); } catch (x) {} } }
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
    blink(); idle();
    if (!reduce && opts.enter !== false) { go("jump", 700); setPose("wave", 1100); }

    return {
      el: el,
      cue: function (kind, data) { try { if (kind === "quiz") onQuiz(data && data.kind, data && data.n); } catch (e) {} },
      // Same fields the MaiK companion reports, so tests read either: mood, face, gesture (pose), mouth.
      state: function () {
        var mouth = { normal: "smile", happy: "grin", proud: "grin", sad: "frown", cry: "frown", wow: "o", think: "flat", tense: "grit", panic: "yell", drowsy: "smile", sleep: "o" }[face] || "smile";
        return { style: "nucleo", mood: Math.round(mood * 100) / 100, face: face, gesture: pose, mouth: mouth, hidden: hidden, reduce: reduce, tension: tens, sleepy: sleepy, acts: acts };
      },
      setHidden: function (h) { applyHidden(h, true); },
      // Test hooks: run one idle act now; pretend he has been left alone for ms.
      idleNow: function () { idleAct(); },
      leftAlone: function (ms) { lastInput = Date.now() - ms; },
      destroy: function () {
        dead = true;
        D.removeEventListener("pointerdown", onDocDown, true);
        D.removeEventListener("scroll", onDocScroll, true);
        for (var i = 0; i < timers.length; i++) G.clearTimeout(timers[i]);
        timers = [];
        if (el.parentNode) el.parentNode.removeChild(el);
      }
    };
  }

  G.PREP_MASCOT = { version: "1.1.0", name: "Nucleo", mount: mount, svg: svg };
})(typeof window !== "undefined" ? window : this);
