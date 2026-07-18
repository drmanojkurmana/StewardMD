/* StewardMD — Pro paywall / subscribe UI.
 *
 * Augments window.SMD_PRO (defined in account.js) with openPaywall() + refresh(). The SERVER is the
 * source of truth (/api/billing/*): this only renders the plans, drives PhonePe checkout on
 * web/Android, and reflects entitlement. iOS/Android native IAP buttons appear once StoreKit/Play
 * Billing are wired. During the launch promo everyone is already Pro — the sheet says so and still
 * lets you subscribe early (and test the flow).
 */
(function () {
  "use strict";
  function apiUrl(p) { return (window.SMD_API_BASE || "") + p; }
  function plat() { try { var C = window.Capacitor; return (C && (typeof C.getPlatform === "function" ? C.getPlatform() : C.platform)) || "web"; } catch (e) { return "web"; } }
  function isNative() { var p = plat(); return p === "ios" || p === "android"; }
  function fbUser() { try { return (window.SMD_AUTH && SMD_AUTH.currentUser) || null; } catch (e) { return null; } }
  function token(fresh) { var u = fbUser(); return u ? u.getIdToken(!!fresh) : Promise.resolve(null); }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function inr(paise) { return "₹" + Math.round((+paise || 0) / 100).toLocaleString("en-IN"); }
  function fdate(ms) { try { return new Date(+ms).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }); } catch (e) { return ""; } }
  function api(path, opts) {
    return token().then(function (t) {
      opts = opts || {}; opts.headers = Object.assign({}, opts.headers || {}, t ? { "Authorization": "Bearer " + t } : {});
      return fetch(apiUrl(path), opts).then(function (r) { return r.json().then(function (d) { return { s: r.status, d: d }; }, function () { return { s: r.status, d: {} }; }); });
    });
  }
  function toast(m) { try { if (window.SMD_toast) return SMD_toast(m); if (window.toast) return toast(m); } catch (e) {} }

  var FEATURES = [
    ["🤖", "MaiK AI assistant", "Deep review, imaging, scribe, evidence — unlimited"],
    ["🏥", "Ward Sync", "Pull a patient’s labs, imaging & meds from the hospital"],
    ["🔔", "Lab Watch 24/7", "Background alerts when a critical result lands"],
    ["👥", "Team collaboration", "Shared ICU/Ward units, round tasks & handover"],
    ["☁️", "Sync & share", "Cases across devices + shareable case links"],
    ["💊", "Full drug database", "Unlimited brand / price / monograph lookups"],
  ];

  var _root = null, _plan = "annual", _status = null, _plans = null;

  function close() { if (_root) { try { _root.remove(); } catch (e) {} _root = null; document.body.style.overflow = ""; } }

  function shell(inner) {
    return '<div id="proPay" style="position:fixed;inset:0;z-index:760;background:rgba(6,14,20,.5);display:flex;align-items:flex-end;justify-content:center;font-family:var(--sans,system-ui)">' +
      '<div role="dialog" aria-label="StewardMD Pro" style="background:var(--paper,#f6f7f5);color:var(--ink,#14202b);width:100%;max-width:520px;max-height:94vh;overflow:auto;border-radius:20px 20px 0 0;box-shadow:0 -12px 44px rgba(0,0,0,.28)">' + inner + '</div></div>';
  }
  function header(sub) {
    return '<div style="position:sticky;top:0;background:var(--paper,#f6f7f5);padding:16px 18px 8px;display:flex;align-items:flex-start;gap:10px;z-index:2">' +
      '<div style="flex:1"><div style="font:800 20px var(--serif,Georgia,serif);color:var(--ink)">StewardMD <span style="color:var(--teal,#0e6e63)">Pro</span></div>' +
      (sub ? '<div style="font:500 12.5px var(--sans);color:var(--slate-soft,#5a7184);margin-top:2px">' + sub + '</div>' : '') + '</div>' +
      '<button data-pp="close" aria-label="Close" style="flex:none;width:34px;height:34px;border-radius:50%;border:none;background:var(--panel,#fff);color:var(--slate,#2d4356);font-size:18px;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.1)">✕</button></div>';
  }
  function featureList() {
    return '<div style="padding:4px 18px 8px">' + FEATURES.map(function (f) {
      return '<div style="display:flex;gap:11px;align-items:flex-start;padding:9px 0;border-bottom:1px solid var(--line,#d7dee3)">' +
        '<span style="font-size:19px;flex:none">' + f[0] + '</span><div><div style="font:700 14px var(--sans);color:var(--ink)">' + esc(f[1]) + '</div>' +
        '<div style="font:500 12.5px/1.45 var(--sans);color:var(--slate-soft,#5a7184)">' + esc(f[2]) + '</div></div></div>';
    }).join("") + '</div>';
  }
  function planCard(id, p, best) {
    var on = _plan === id;
    var per = id === "annual" ? "/year" : "/month";
    var save = (id === "annual" && _plans && _plans.monthly) ? Math.round((1 - (p.amount / 12) / _plans.monthly.amount) * 100) : 0;
    return '<button data-pp="plan" data-plan="' + id + '" style="flex:1;text-align:left;border:2px solid ' + (on ? "var(--teal,#0e6e63)" : "var(--line,#d7dee3)") + ';background:' + (on ? "var(--teal-soft,#e3f1ee)" : "var(--panel,#fff)") + ';border-radius:14px;padding:13px 14px;cursor:pointer;position:relative">' +
      (best ? '<span style="position:absolute;top:-9px;right:12px;font:800 9px var(--sans);letter-spacing:.04em;text-transform:uppercase;color:#fff;background:var(--teal,#0e6e63);border-radius:999px;padding:3px 9px">Best value</span>' : '') +
      '<div style="font:700 13px var(--sans);color:var(--slate,#2d4356)">' + esc(p.label) + '</div>' +
      '<div style="font:800 22px var(--serif,Georgia,serif);color:var(--ink);margin-top:2px">' + inr(p.amount) + '<span style="font:600 12px var(--sans);color:var(--slate-soft)"> ' + per + '</span></div>' +
      (save > 0 ? '<div style="font:700 11px var(--sans);color:var(--green,#1c7a4a);margin-top:2px">Save ~' + save + '%</div>' : '') + '</div>';
  }
  function ctaBlock() {
    if (!fbUser()) return '<button data-pp="signin" style="width:100%;padding:14px;border:none;border-radius:13px;background:var(--teal,#0e6e63);color:#fff;font:800 15px var(--sans);cursor:pointer">Sign in to subscribe</button>';
    if (plat() === "ios") {
      // Native StoreKit IAP not wired yet — Apple requires it for in-app digital goods, so no PhonePe here.
      return '<button disabled style="width:100%;padding:14px;border:none;border-radius:13px;background:var(--line,#d7dee3);color:var(--slate,#2d4356);font:800 15px var(--sans);cursor:default">Subscriptions coming soon on iOS</button>' +
        '<div style="font:500 11.5px/1.5 var(--sans);color:var(--slate-soft);text-align:center;margin-top:8px">In-app purchase is being set up. Everything is free during the launch period.</div>';
    }
    return '<button data-pp="buy" style="width:100%;padding:14px;border:none;border-radius:13px;background:var(--teal,#0e6e63);color:#fff;font:800 15px var(--sans);cursor:pointer">Subscribe with PhonePe</button>' +
      '<div style="font:500 11px/1.5 var(--sans);color:var(--slate-soft);text-align:center;margin-top:8px">Secure payment via PhonePe · UPI / cards / netbanking · cancel anytime</div>';
  }

  function paint() {
    var promoOn = _status && _status.promo;
    var isPaid = _status && _status.pro && !promoOn;
    var banner = "";
    if (promoOn) banner = '<div style="margin:6px 18px 4px;padding:11px 13px;border-radius:12px;background:var(--green-bg,#e7f5ec);border:1px solid var(--green-line,#aedcc1);font:600 12.5px/1.5 var(--sans);color:var(--green,#1c7a4a)">🎉 Launch period — Pro is <b>free for everyone until ' + esc(fdate(_status.promoUntil || _status.until)) + '</b>. Subscribe anytime to keep it after.</div>';
    else if (isPaid) banner = '<div style="margin:6px 18px 4px;padding:11px 13px;border-radius:12px;background:var(--teal-soft,#e3f1ee);border:1px solid var(--teal,#0e6e63);font:700 12.5px var(--sans);color:var(--teal,#0e6e63)">✓ Pro active' + (_status.until ? ' until ' + esc(fdate(_status.until)) : '') + '. Thank you!</div>';

    var plansHtml = "";
    if (_plans) {
      plansHtml = '<div style="padding:10px 18px 6px"><div style="display:flex;gap:10px">' +
        planCard("monthly", _plans.monthly, false) + planCard("annual", _plans.annual, true) + '</div></div>' +
        '<div style="padding:6px 18px 20px calc(18px)">' + ctaBlock() + '</div>';
    } else {
      plansHtml = '<div style="padding:20px 18px;text-align:center;color:var(--slate-soft);font:500 13px var(--sans)">Loading plans…</div>';
    }
    var sub = promoOn ? "Everything unlocked — free until the launch period ends" : (isPaid ? "You’re a Pro member" : "Unlock the full clinical intelligence layer");
    _root.querySelector("#proPay > div").innerHTML = header(sub) + banner + featureList() + plansHtml;
    wire();
  }

  function wire() {
    var r = _root; if (!r) return;
    r.querySelectorAll("[data-pp]").forEach(function (b) {
      b.onclick = function () {
        var k = b.getAttribute("data-pp");
        if (k === "close") return close();
        if (k === "plan") { _plan = b.getAttribute("data-plan"); return paint(); }
        if (k === "signin") { try { if (window.SMD_signInWithGoogle) SMD_signInWithGoogle(); } catch (e) {} return; }
        if (k === "buy") return buy();
      };
    });
    r.addEventListener("click", function (e) { if (e.target === r.firstChild) close(); }, { once: true });
  }

  function buy() {
    var btn = _root && _root.querySelector('[data-pp="buy"]');
    if (btn) { btn.disabled = true; btn.textContent = "Opening PhonePe…"; }
    api("/api/billing/phonepe/pay", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan: _plan }) })
      .then(function (x) {
        if (x.s === 200 && x.d && x.d.redirectUrl) {
          // Web: navigate to PhonePe. Native: open in the system browser so the return URL works.
          try {
            if (isNative() && window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Browser) { Capacitor.Plugins.Browser.open({ url: x.d.redirectUrl }); }
            else window.location.href = x.d.redirectUrl;
          } catch (e) { window.location.href = x.d.redirectUrl; }
        } else {
          if (btn) { btn.disabled = false; btn.textContent = "Subscribe with PhonePe"; }
          toast(x.d && x.d.error === "phonepe-not-configured" ? "Payments aren’t switched on yet." : (x.d && x.d.error === "signin-required" ? "Sign in first." : "Couldn’t start checkout — try again."));
        }
      })
      .catch(function () { if (btn) { btn.disabled = false; btn.textContent = "Subscribe with PhonePe"; } toast("Network error — try again."); });
  }

  function loadAndPaint() {
    Promise.all([
      api("/api/billing/status").then(function (x) { return x.d || {}; }, function () { return {}; }),
      fetch(apiUrl("/api/billing/plans")).then(function (r) { return r.json(); }, function () { return {}; }),
    ]).then(function (res) { _status = res[0]; _plans = (res[1] && res[1].plans) || null; if (_root) paint(); });
  }

  function openPaywall() {
    if (_root) return;
    var div = document.createElement("div");
    div.innerHTML = shell(header("") + '<div style="padding:40px;text-align:center;color:var(--slate-soft);font:500 13px var(--sans)">Loading…</div>');
    _root = div.firstChild; document.body.appendChild(_root); document.body.style.overflow = "hidden";
    _root.querySelector('[data-pp="close"]').onclick = close;
    loadAndPaint();
  }

  // Force a token refresh so isPro() picks up a just-granted `pro` claim, then re-check status.
  function refresh() { return token(true).then(function () { return api("/api/billing/status").then(function (x) { _status = x.d || {}; if (_root) paint(); return _status; }); }); }

  function attach() { if (!window.SMD_PRO) return setTimeout(attach, 300); window.SMD_PRO.openPaywall = openPaywall; window.SMD_PRO.refresh = refresh; }
  attach();

  // Deep-link: ?pro=1 / ?pro=open / #pro opens the paywall directly (shareable URL).
  if (/[?&]pro=(1|open|upgrade)\b/.test(location.search) || location.hash === "#pro") {
    setTimeout(openPaywall, 800);
  }
  // After returning from PhonePe (?pro=return), reopen the sheet and poll for the grant to land.
  if (/[?&]pro=return/.test(location.search)) {
    setTimeout(function () {
      openPaywall();
      var tries = 0;
      var iv = setInterval(function () {
        tries++;
        refresh().then(function (s) { if ((s && s.pro && !s.promo) || tries >= 8) { clearInterval(iv); if (s && s.pro && !s.promo) toast("Pro activated — thank you!"); } });
      }, 2500);
      try { history.replaceState(null, "", location.pathname); } catch (e) {}
    }, 700);
  }
})();
