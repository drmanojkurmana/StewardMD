/* StewardMD one authored celebration (smd-celebrate.js) -> window.SMD_CELEBRATE.show({ title, detail, key }).
 *
 * Owner decision 2026-10-03: celebrate the CLINICIAN'S OWN progress (level-ups, badges, logbook month
 * authenticated, module completed). NEVER patient events (discharge, recovery, ...); callers must not
 * route those here.
 *
 * The StewardMD mark draws itself using the boot splash's own trace paths (index.html .sbs-logo-trace,
 * copied here, the splash is not edited), a check settles, the title rises in, success haptic. ~700 ms.
 * Compact card on the bottom safe area; no confetti, no focus steal, never blocks the page behind it
 * (the host is pointer-events:none, only the card takes touches). Tap or swipe down dismisses;
 * auto-dismiss ~2.6 s; exit is faster than enter. Queue plays one at a time.
 * Kill switch: localStorage "smd_celebrate" = "0". Reduced motion: static mark + text, fade only (CSS).
 * `key` makes an achievement fire once ever (persisted in "smd_celebrated"), so a re-render or reload
 * of the same achievement never repeats it. */
(function () {
  "use strict";
  if (window.SMD_CELEBRATE) return;

  var PATHS = [
    "M143 53 Q143 53 145.4 53.45 L156.6 55.55 Q159 56 161.25 57.05 L171.75 61.95 Q174 63 179.4 68.25 L204.6 92.75 Q210 98 210 98.45 L210 100.55 Q210 101 208.05 102.5 L198.95 109.5 Q197 111 196.4 111 L193.6 111 Q193 111 188.95 106.8 L170.05 87.2 Q166 83 163.45 81.8 L151.55 76.2 Q149 75 145.85 75 L131.15 75 Q128 75 125.6 76.05 L114.4 80.95 Q112 82 110.2 83.8 L101.8 92.2 Q100 94 99.25 95.5 L95.75 102.5 Q95 104 94.7 104.9 L93.3 109.1 Q93 110 93 113.15 L93 127.85 Q93 131 94.5 133.85 L101.5 147.15 Q103 150 107.05 153.9 L125.95 172.1 Q130 176 127.75 177.95 L117.25 187.05 Q115 189 109.9 183.9 L86.1 160.1 Q81 155 79.65 151.1 L73.35 132.9 Q72 129 72.15 125.55 L72.85 109.45 Q73 106 74.2 103 L79.8 89 Q81 86 83.7 83 L96.3 69 Q99 66 102.45 64.35 L118.55 56.65 Q122 55 125.15 54.7 L139.85 53.3 Q143 53 143 53 Z",
    "M186 171 Q186 171 176.85 178.95 L134.15 216.05 Q125 224 122.75 225.35 L112.25 231.65 Q110 233 108.05 233.45 L98.95 235.55 Q97 236 95.05 235.85 L85.95 235.15 Q84 235 82.5 234.55 L75.5 232.45 Q74 232 72.2 230.8 L63.8 225.2 Q62 224 62 223.7 L62 222.3 Q62 222 64.25 220.35 L74.75 212.65 Q77 211 78.35 211.6 L84.65 214.4 Q86 215 89 214.7 L103 213.3 Q106 213 122.05 199.65 L196.95 137.35 Q213 124 216.3 123.1 L231.7 118.9 Q235 118 238.15 118.3 L252.85 119.7 Q256 120 258.7 121.35 L271.3 127.65 Q274 129 275.5 130.35 L282.5 136.65 Q284 138 284 138.45 L284 140.55 Q284 141 282.05 142.5 L272.95 149.5 Q271 151 270.55 151 L268.45 151 Q268 151 266.65 149.8 L260.35 144.2 Q259 143 257.5 142.4 L250.5 139.6 Q249 139 246.15 139 L232.85 139 Q230 139 227.9 140.05 L218.1 144.95 Q216 146 211.5 149.75 L190.5 167.25 Q186 171 186 171 Z",
    "M180 201 Q180 201 180.75 200.4 L184.25 197.6 Q185 197 185.6 197 L188.4 197 Q189 197 190.65 198.95 L198.35 208.05 Q200 210 194.75 214.35 L170.25 234.65 Q165 239 164.85 239.45 L164.15 241.55 Q164 242 169.1 247.1 L192.9 270.9 Q198 276 199.05 276.75 L203.95 280.25 Q205 281 207.25 281.6 L217.75 284.4 Q220 285 223 284.55 L237 282.45 Q240 282 242.25 280.2 L252.75 271.8 Q255 270 256.2 267.75 L261.8 257.25 Q263 255 263.15 252.6 L263.85 241.4 Q264 239 262.8 236 L257.2 222 Q256 219 249.4 212.4 L218.6 181.6 Q212 175 213.95 173.2 L223.05 164.8 Q225 163 225.45 163 L227.55 163 Q228 163 234.6 169.45 L265.4 199.55 Q272 206 273.05 207.65 L277.95 215.35 Q279 217 279.75 219.25 L283.25 229.75 Q284 232 284 235.45 L284 251.55 Q284 255 282.8 258.15 L277.2 272.85 Q276 276 274.2 278.25 L265.8 288.75 Q264 291 262.2 292.2 L253.8 297.8 Q252 299 249.6 299.9 L238.4 304.1 Q236 305 233.9 305.15 L224.1 305.85 Q222 306 219 305.4 L205 302.6 Q202 302 199.45 300.5 L187.55 293.5 Q185 292 177.5 284.5 L142.5 249.5 Q135 242 135.15 241.55 L135.85 239.45 Q136 239 137.05 238.4 L141.95 235.6 Q143 235 148.55 229.9 L174.45 206.1 Q180 201 180 201 Z"
  ];
  var HOLD_MS = 2600, EXIT_MS = 160, GAP_MS = 220, SEEN_KEY = "smd_celebrated", MAX_SEEN = 200, MAX_QUEUE = 6;
  var queue = [], showing = null, host = null, css = false, seenMem = null;

  function enabled() { try { return localStorage.getItem("smd_celebrate") !== "0"; } catch (e) { return true; } }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }

  function seen() {
    if (seenMem) return seenMem;
    try { seenMem = JSON.parse(localStorage.getItem(SEEN_KEY) || "[]"); } catch (e) { seenMem = []; }
    if (!Array.isArray(seenMem)) seenMem = [];
    return seenMem;
  }
  function remember(k) {
    var a = seen(); a.push(k);
    if (a.length > MAX_SEEN) a.splice(0, a.length - MAX_SEEN);
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(a)); } catch (e) {}
  }

  function injectCSS() {
    if (css) return; css = true;
    var s = document.createElement("style"); s.id = "smdCelebCss";
    s.textContent = [
      "#smdCeleb{position:fixed;left:0;right:0;bottom:0;z-index:100000;display:flex;justify-content:center;padding:0 12px calc(12px + var(--sai-bottom,env(safe-area-inset-bottom,0px)));pointer-events:none}",
      "#smdCeleb .sc-card{pointer-events:auto;touch-action:none;user-select:none;-webkit-user-select:none;display:flex;align-items:center;gap:12px;width:100%;max-width:420px;box-sizing:border-box;padding:10px 16px 10px 10px;border-radius:18px;background:var(--hpanel,#fff);color:var(--hink,#0f172a);border:1px solid var(--hbd,#e6efec);box-shadow:0 10px 28px rgba(6,32,29,.16),0 2px 6px rgba(6,32,29,.08);font-family:var(--hfont,system-ui,-apple-system,sans-serif);--sc-c:#0e6a5f;transform:translateY(0);opacity:1;transition:transform " + EXIT_MS + "ms cubic-bezier(.23,1,.32,1),opacity " + EXIT_MS + "ms cubic-bezier(.23,1,.32,1)}",
      // the host hangs off <body>, outside #homeV2 / .hv-sheet where the --h* tokens live, so it carries
      // the home palette itself (home.js #homeV2 + body.dark #homeV2 values)
      "#smdCeleb{--hpanel:#fff;--hbd:#E2E8F0;--hink:#0F172A;--hmut:#64748B}",
      "body.dark #smdCeleb,body.v3-dark #smdCeleb{--hpanel:#111B2E;--hbd:#1E2B43;--hink:#E7EDF5;--hmut:#8597AD}",
      "body.dark #smdCeleb .sc-card,body.v3-dark #smdCeleb .sc-card{--sc-c:#4fd6c2;box-shadow:0 10px 28px rgba(0,0,0,.45),0 2px 6px rgba(0,0,0,.3)}",
      "#smdCeleb .sc-card.sc-in{animation:scIn 340ms cubic-bezier(.23,1,.32,1) both}",
      "#smdCeleb .sc-card.sc-out{transform:translateY(24px);opacity:0}",
      "#smdCeleb .sc-card.sc-drag{transition:none}",
      "#smdCeleb .sc-mk{position:relative;flex:none;width:48px;height:48px;border-radius:14px;background:color-mix(in srgb,var(--sc-c) 12%,transparent);display:flex;align-items:center;justify-content:center}",
      "#smdCeleb .sc-mk svg.sc-trace{width:34px;height:34px;overflow:visible;color:var(--sc-c)}",
      "#smdCeleb .sc-trace path{fill:none;stroke:currentColor;stroke-width:15;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;stroke-dashoffset:1;animation:scTrace 260ms cubic-bezier(.23,1,.32,1) both}",
      "#smdCeleb .sc-trace path:nth-child(2){animation-delay:110ms}",
      "#smdCeleb .sc-trace path:nth-child(3){animation-delay:220ms;animation-duration:300ms}",
      "#smdCeleb .sc-ck{position:absolute;right:-5px;bottom:-5px;width:20px;height:20px;border-radius:50%;background:var(--sc-c);display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 2px var(--hpanel,#fff);animation:scCk 220ms cubic-bezier(.23,1,.32,1) 440ms both}",
      "#smdCeleb .sc-ck svg{width:12px;height:12px;stroke:#fff;fill:none;stroke-width:3.2;stroke-linecap:round;stroke-linejoin:round}",
      "body.dark #smdCeleb .sc-ck svg,body.v3-dark #smdCeleb .sc-ck svg{stroke:#06201d}",
      "#smdCeleb .sc-tx{min-width:0;animation:scRise 300ms cubic-bezier(.23,1,.32,1) 200ms both}",
      "#smdCeleb .sc-t{font-weight:650;font-size:15px;line-height:1.25;letter-spacing:-.005em;text-wrap:balance}",
      "#smdCeleb .sc-d{margin-top:2px;font-weight:500;font-size:13px;line-height:1.3;color:var(--hmut,#5e7e78);overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}",
      "@keyframes scIn{from{transform:translateY(28px);opacity:0}to{transform:translateY(0);opacity:1}}",
      "@keyframes scTrace{to{stroke-dashoffset:0}}",
      "@keyframes scCk{from{transform:scale(.6);opacity:0}to{transform:scale(1);opacity:1}}",
      "@keyframes scRise{from{transform:translateY(6px);opacity:0}to{transform:translateY(0);opacity:1}}",
      "@keyframes scFade{from{opacity:0}to{opacity:1}}",
      "@media (prefers-reduced-motion:reduce){#smdCeleb .sc-card.sc-in{animation:scFade 200ms ease-out both}#smdCeleb .sc-trace path{animation:none;stroke-dashoffset:0}#smdCeleb .sc-ck,#smdCeleb .sc-tx{animation:none}#smdCeleb .sc-card.sc-out{transform:none}}"
    ].join("\n");
    document.head.appendChild(s);
  }

  function getHost() {
    if (host && host.parentNode) return host;
    host = document.createElement("div");
    host.id = "smdCeleb";
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    document.body.appendChild(host);
    return host;
  }

  function markup(o) {
    var trace = PATHS.map(function (d) { return '<path pathLength="1" d="' + d + '"/>'; }).join("");
    return '<div class="sc-mk" aria-hidden="true"><svg class="sc-trace" viewBox="0 0 368 368" focusable="false">' + trace + '</svg>' +
      '<span class="sc-ck"><svg viewBox="0 0 24 24" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span></div>' +
      '<div class="sc-tx"><div class="sc-t">' + esc(o.title) + '</div>' + (o.detail ? '<div class="sc-d">' + esc(o.detail) + '</div>' : "") + '</div>';
  }

  function next() {
    if (showing || !queue.length) return;
    var o = queue.shift();
    injectCSS();
    var card = document.createElement("div");
    card.className = "sc-card sc-in";
    card.innerHTML = markup(o);
    var rec = { card: card, timer: null, done: false };
    showing = rec;
    getHost().appendChild(card);
    try { if (window.SMD_HAPTICS && window.SMD_HAPTICS.success) window.SMD_HAPTICS.success(); } catch (e) {}
    rec.timer = setTimeout(function () { dismiss(rec); }, HOLD_MS);
    // tap or swipe down dismisses; a quick flick counts, distance is not required
    var y0 = null, t0 = 0, dy = 0;
    function reset() { y0 = null; card.classList.remove("sc-drag"); card.style.transform = ""; }
    card.addEventListener("pointerdown", function (e) { y0 = e.clientY; t0 = Date.now(); dy = 0; card.classList.add("sc-drag"); });
    card.addEventListener("pointermove", function (e) {
      if (y0 == null) return;
      dy = Math.max(0, e.clientY - y0);
      card.style.transform = "translateY(" + dy + "px)";
    });
    card.addEventListener("pointerup", function () {
      if (y0 == null) return;
      var v = dy / Math.max(1, Date.now() - t0), go = dy < 6 || dy > 36 || v > 0.11;
      reset();
      if (go) dismiss(rec);
    });
    card.addEventListener("pointercancel", reset);
  }

  function dismiss(rec) {
    if (!rec || rec.done) return;
    rec.done = true; clearTimeout(rec.timer);
    rec.card.classList.add("sc-out");
    setTimeout(function () {
      try { rec.card.remove(); } catch (e) {}
      if (showing === rec) showing = null;
      setTimeout(next, GAP_MS);
    }, EXIT_MS);
  }

  // show({title, detail, key}) -> true when accepted (queued or shown), false when suppressed.
  function show(o) {
    try {
      if (!o || !o.title || !enabled()) return false;
      if (o.key) { if (seen().indexOf(o.key) >= 0) return false; remember(o.key); }
      if (queue.length >= MAX_QUEUE) queue.shift();
      queue.push({ title: String(o.title), detail: o.detail ? String(o.detail) : "" });
      next();
      return true;
    } catch (e) { return false; }
  }

  window.SMD_CELEBRATE = { show: show, enabled: enabled, _state: function () { return { queued: queue.length, showing: !!showing }; } };
})();
