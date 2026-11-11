/* StewardMD "You are the boss" celebration (owner 2026-11-11) -> window.SMD_BOSS_CELE.play({ eyebrow, title, detail, key }).
 *
 * A full-screen clip made with Gemini (assets/celebrate/boss-male.mp4 and boss-female.mp4, 720x1280, about 10 s):
 * a doctor's coat flies on with a teal glow, then a hero pose. The doctor matches the profile's gender
 * (window.SMD_GENDER, Male unless the doctor chose Female at sign-up or in Profile). The words are drawn here, over
 * the clip, at the moment of the hero pose, with the app's confetti and the celebration buzz.
 * Played on a PrepNucleus boss win and on 100% in any set of 5 or more questions.
 *
 * Tap Skip (or Continue at the end) to close. Reduced motion: the last frame as a still with the words, no video.
 * No video file (offline before it was ever cached, or a decode error): falls back to SMD_CELEBRATE's card.
 * Kill switch: localStorage "smd_boss_video" = "0" (card only). `key` plays once ever (shared with SMD_CELEBRATE). */
(function () {
  "use strict";
  if (window.SMD_BOSS_CELE) return;

  var GKEY = "smd_gender";
  window.SMD_GENDER = window.SMD_GENDER || {
    get: function () { try { return localStorage.getItem(GKEY) === "female" ? "female" : "male"; } catch (e) { return "male"; } },
    set: function (g) { try { localStorage.setItem(GKEY, g === "female" ? "female" : "male"); } catch (e) {} }
  };

  var CLIP = {
    male: { src: "/assets/celebrate/boss-male.mp4", end: "/assets/celebrate/boss-male-end.webp", start: "/assets/celebrate/boss-male-start.webp", hero: 4.4 },
    female: { src: "/assets/celebrate/boss-female.mp4", end: "/assets/celebrate/boss-female-end.webp", start: "/assets/celebrate/boss-female-start.webp", hero: 5.4 }
  };
  var V = "1";
  var SEEN = "smd_celebrated";

  function on() { try { return localStorage.getItem("smd_boss_video") !== "0"; } catch (e) { return true; } }
  function reduced() { try { return !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; } }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }
  function seenKey(k) { try { var a = JSON.parse(localStorage.getItem(SEEN) || "[]"); return Array.isArray(a) && a.indexOf(k) >= 0; } catch (e) { return false; } }
  function remember(k) { try { var a = JSON.parse(localStorage.getItem(SEEN) || "[]"); if (!Array.isArray(a)) a = []; a.push(k); if (a.length > 200) a.splice(0, a.length - 200); localStorage.setItem(SEEN, JSON.stringify(a)); } catch (e) {} }
  function buzz() { try { var H = window.SMD_HAPTICS; if (H && H.celebrate) H.celebrate(); else if (H && H.success) H.success(); } catch (e) {} }
  function card(o) { try { if (window.SMD_CELEBRATE) return window.SMD_CELEBRATE.show({ title: o.title, detail: [o.eyebrow, o.detail].filter(Boolean).join(" · "), big: true }); } catch (e) {} return false; }

  var css = false;
  function injectCSS() {
    if (css) return; css = true;
    var s = document.createElement("style"); s.id = "smdBossCss";
    s.textContent = [
      "#smdBoss{position:fixed;inset:0;z-index:100002;background:#071318;display:flex;align-items:center;justify-content:center;overflow:hidden;opacity:0;transition:opacity .28s ease;-webkit-user-select:none;user-select:none}",
      "#smdBoss.on{opacity:1}",
      "#smdBoss video,#smdBoss .bc-still{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#071318}",
      "#smdBoss .bc-shade{position:absolute;inset:0;pointer-events:none;background:linear-gradient(180deg,rgba(7,19,24,.78) 0,rgba(7,19,24,.2) 30%,transparent 45%,transparent 70%,rgba(7,19,24,.85) 100%)}",
      "#smdBoss .bc-top{position:absolute;left:0;right:0;top:calc(env(safe-area-inset-top,0px) + 64px);text-align:center;padding:0 24px;pointer-events:none}",
      "#smdBoss .bc-eb,#smdBoss .bc-t,#smdBoss .bc-d,#smdBoss .bc-go{opacity:0;transform:translateY(14px);transition:opacity .45s cubic-bezier(.2,.8,.2,1),transform .55s cubic-bezier(.2,.8,.2,1)}",
      "#smdBoss.hero .bc-eb,#smdBoss.hero .bc-t,#smdBoss.hero .bc-d{opacity:1;transform:none}",
      "#smdBoss.hero .bc-t{transition-delay:.08s}#smdBoss.hero .bc-d{transition-delay:.3s}",
      "#smdBoss .bc-eb{font:700 13px/1.2 var(--rds-font,system-ui);letter-spacing:.16em;text-transform:uppercase;color:#8fe3c8}",
      "#smdBoss .bc-t{margin-top:8px;font:800 44px/1.02 var(--rds-font,system-ui);letter-spacing:-.02em;background:linear-gradient(180deg,#fff6d6 0%,#ffd36b 45%,#f4a62a 100%);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 2px 14px rgba(244,166,42,.45)) drop-shadow(0 0 2px rgba(0,0,0,.6))}",
      "#smdBoss .bc-bot{position:absolute;left:0;right:0;bottom:calc(env(safe-area-inset-bottom,0px) + 22px);display:flex;flex-direction:column;align-items:center;gap:14px;padding:0 24px}",
      "#smdBoss .bc-d{font:600 16px/1.35 var(--rds-font,system-ui);color:#e8f6f1;text-align:center;text-shadow:0 1px 8px rgba(0,0,0,.6)}",
      "#smdBoss .bc-go{pointer-events:none;width:100%;max-width:360px;min-height:52px;border:0;border-radius:16px;background:#3fc4a0;color:#04201a;font:800 16px var(--rds-font,system-ui);cursor:pointer}",
      "#smdBoss.end .bc-go{opacity:1;transform:none;pointer-events:auto}",
      "#smdBoss .bc-skip{position:absolute;top:calc(env(safe-area-inset-top,0px) + 12px);right:14px;min-width:64px;min-height:36px;border:0;border-radius:999px;background:rgba(255,255,255,.14);color:#e8f6f1;font:700 13px var(--rds-font,system-ui);cursor:pointer;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}",
      "#smdBoss.end .bc-skip{display:none}",
      "#smdBoss .bc-snd{position:absolute;top:calc(env(safe-area-inset-top,0px) + 12px);left:14px;width:36px;height:36px;border:0;border-radius:50%;background:rgba(255,255,255,.14);color:#e8f6f1;font:700 15px/1 var(--rds-font,system-ui);cursor:pointer;display:none}",
      "#smdBoss.muted .bc-snd{display:block}",
      "@media (min-width:600px){#smdBoss video,#smdBoss .bc-still{object-fit:contain}#smdBoss .bc-t{font-size:56px}}",
      "@media (prefers-reduced-motion:reduce){#smdBoss,#smdBoss *{transition:none!important}}"
    ].join("\n");
    document.head.appendChild(s);
  }

  var active = null;
  function play(o) {
    o = o || {};
    o.title = o.title || "You are the boss";
    if (o.key) { if (seenKey(o.key)) return false; remember(o.key); }
    if (active) return false;
    if (!on() || !document.body) return card(o);
    injectCSS();
    var clip = CLIP[window.SMD_GENDER.get()] || CLIP.male;
    var still = reduced();
    var el = document.createElement("div");
    el.id = "smdBoss"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", o.title);
    el.innerHTML = (still ? '<img class="bc-still" alt="" src="' + clip.end + "?v=" + V + '">'
        : '<video playsinline webkit-playsinline preload="auto" poster="' + clip.start + "?v=" + V + '" src="' + clip.src + "?v=" + V + '"></video>') +
      '<div class="bc-shade"></div>' +
      '<div class="bc-top">' + (o.eyebrow ? '<div class="bc-eb">' + esc(o.eyebrow) + "</div>" : "") + '<div class="bc-t">' + esc(o.title) + "</div></div>" +
      '<div class="bc-bot">' + (o.detail ? '<div class="bc-d">' + esc(o.detail) + "</div>" : "") + '<button type="button" class="bc-go">Continue</button></div>' +
      (still ? "" : '<button type="button" class="bc-skip" aria-label="Skip">Skip</button><button type="button" class="bc-snd" aria-label="Turn sound on">&#9834;</button>');
    document.body.appendChild(el);
    var rec = active = { el: el, done: false, heroT: 0, endT: 0 };
    requestAnimationFrame(function () { el.classList.add("on"); });

    function hero() {
      if (rec.done || el.classList.contains("hero")) return;
      el.classList.add("hero");
      try { if (window.SMD_CELEBRATE && SMD_CELEBRATE.confetti) SMD_CELEBRATE.confetti({ count: 200 }); } catch (e) {}
      buzz();
    }
    function ended() { if (rec.done) return; hero(); el.classList.add("end"); }
    function close() {
      if (rec.done) return; rec.done = true; clearTimeout(rec.heroT); clearTimeout(rec.endT);
      var v = el.querySelector("video"); if (v) { try { v.pause(); } catch (e) {} }
      el.classList.remove("on");
      setTimeout(function () { try { v && v.removeAttribute("src"); v && v.load(); } catch (e) {} el.remove(); if (active === rec) active = null; }, 300);
      document.removeEventListener("keydown", onKey, true);
    }
    function onKey(e) { if (e.key === "Escape") { e.preventDefault(); close(); } }
    document.addEventListener("keydown", onKey, true);
    el.querySelector(".bc-go").addEventListener("click", close);

    if (still) { hero(); ended(); return true; }

    var v = el.querySelector("video");
    el.querySelector(".bc-skip").addEventListener("click", close);
    el.querySelector(".bc-snd").addEventListener("click", function () { v.muted = false; el.classList.remove("muted"); try { v.play(); } catch (e) {} });
    var failed = false;
    function fail() { if (failed || rec.done) return; failed = true; rec.done = true; el.remove(); active = null; document.removeEventListener("keydown", onKey, true); card(o); }
    v.addEventListener("error", fail);
    v.addEventListener("ended", ended);
    v.addEventListener("timeupdate", function () { if (v.currentTime >= clip.hero) hero(); });
    // With sound when the WebView allows it (it follows the tap that finished the fight); else muted, with a sound button.
    var p;
    try { v.muted = false; p = v.play(); } catch (e) { p = null; }
    if (p && p.catch) p.catch(function () { v.muted = true; el.classList.add("muted"); var q = v.play(); if (q && q.catch) q.catch(fail); });
    // Belt and braces: the words and the burst land even if timeupdate is slow, and a stalled clip still ends.
    rec.heroT = setTimeout(hero, (clip.hero + 0.8) * 1000);
    rec.endT = setTimeout(ended, 14000);
    return true;
  }

  window.SMD_BOSS_CELE = { play: play, clips: CLIP, _active: function () { return !!active; } };
})();
