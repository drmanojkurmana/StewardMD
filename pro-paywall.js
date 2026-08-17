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

  function ppIco(n){ return (window.ICONS && ICONS.get) ? ICONS.get(n) : ""; }

  var _root = null, _tier = "pro", _cycle = "monthly", _status = null, _plans = null;
  var TIER_ORDER = ["student", "coresident", "pro", "physician", "physicianpro"];
  var TIER_BLURB = {
    student: "Full MaiK AI · voice dictation · learn atlases",
    coresident: "2 accounts · shared AI pool · 4 imaging/day each",
    pro: "Imaging AI · Patient Summary · Research · Lab Watch · Ultra voice",
    physician: "Your clinic (own Drive) · FollowCare · Scribe · unlimited billing",
    physicianpro: "Cloud clinic (we host) · more AI · OncoTree + ONCQIS included",
  };
  var TIER_IAP = { student: "trainee", coresident: "coresident", pro: "pro", physician: "physician", physicianpro: "physicianpro" };
  function iosNativeIap() { return plat() === "ios" && window.SMD_IAP && typeof SMD_IAP.purchase === "function"; }
  function productIdFor(body) {
    if (body.tier) return "in.stewardmd." + (TIER_IAP[body.tier] || body.tier) + "." + (body.cycle === "annual" ? "annual" : "monthly");
    if (body.addon === "onco") return "in.stewardmd.onco.monthly";
    if (body.pack) return "in.stewardmd.tokens." + body.pack;
    return null;
  }

  function close() { if (_root) { try { _root.remove(); } catch (e) {} _root = null; document.body.style.overflow = ""; } }

  function shell(inner) {
    return '<div id="proPay" style="position:fixed;inset:0;z-index:760;background:rgba(6,14,20,.5);display:flex;align-items:flex-end;justify-content:center;font-family:var(--sans,system-ui)">' +
      '<div role="dialog" aria-label="StewardMD Pro" style="background:var(--paper,#f6f7f5);color:var(--ink,#14202b);width:100%;max-width:520px;max-height:94vh;overflow:auto;border-radius:20px 20px 0 0;box-shadow:0 -12px 44px rgba(0,0,0,.28)">' + inner + '</div></div>';
  }
  function header(sub) {
    return '<div style="position:sticky;top:0;background:var(--paper,#f6f7f5);padding:16px 18px 8px;display:flex;align-items:flex-start;gap:10px;z-index:2">' +
      '<div style="flex:1"><div style="font:800 20px var(--serif,Georgia,serif);color:var(--ink)">StewardMD <span style="color:var(--teal,#0e6e63)">Pro</span></div>' +
      (sub ? '<div style="font:500 12.5px var(--sans);color:var(--slate-soft,#5a7184);margin-top:2px">' + sub + '</div>' : '') + '</div>' +
      '<button data-pp="close" aria-label="Close" style="flex:none;width:34px;height:34px;border-radius:50%;border:none;background:var(--panel,#fff);color:var(--slate,#2d4356);font-size:18px;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.1)">' + ppIco("close") + '</button></div>';
  }
  function tierPrice(t) { return (_cycle === "annual" && t.annual) ? t.annual : t.amount; }
  function tierPer(t) { return (_cycle === "annual" && t.annual) ? "/yr" : "/mo"; }
  function tierStrike(t) {
    if (_cycle === "annual" && t.annual) { var m12 = (t.amount || 0) * 12; return m12 > t.annual ? m12 : 0; }
    return (t.regular && t.regular > t.amount) ? t.regular : 0;
  }
  function cycleToggle() {
    function seg(id, label) { var on = _cycle === id; return '<button data-pp="cycle" data-cycle="' + id + '" style="flex:1;padding:8px;border:none;border-radius:9px;background:' + (on ? "var(--teal,#0e6e63)" : "transparent") + ';color:' + (on ? "#fff" : "var(--slate,#2d4356)") + ';font:800 12px var(--sans);cursor:pointer">' + label + '</button>'; }
    return '<div style="margin:8px 18px 4px;display:flex;gap:2px;background:var(--panel,#eef2f0);border:1px solid var(--line,#d7dee3);border-radius:11px;padding:3px">' + seg("monthly", "Monthly") + seg("annual", "Annual · 2 months free") + '</div>';
  }
  function tierCard(id, t) {
    var on = _tier === id, strike = tierStrike(t), badge = t.popular ? "Most popular" : (t.premium ? "Premium" : "");
    return '<button data-pp="tier" data-tier="' + id + '" style="width:100%;text-align:left;border:2px solid ' + (on ? "var(--teal,#0e6e63)" : "var(--line,#d7dee3)") + ';background:' + (on ? "var(--teal-soft,#e3f1ee)" : "var(--panel,#fff)") + ';border-radius:14px;padding:12px 13px;cursor:pointer;position:relative;margin-bottom:8px">' +
      (badge ? '<span style="position:absolute;top:-9px;right:12px;font:800 9px var(--sans);letter-spacing:.04em;text-transform:uppercase;color:#fff;background:' + (t.premium ? "var(--gold,#b9852a)" : "var(--teal,#0e6e63)") + ';border-radius:999px;padding:3px 9px">' + badge + '</span>' : '') +
      '<div style="display:flex;align-items:baseline;gap:8px"><div style="font:800 15px var(--sans);color:var(--ink);flex:1">' + esc(t.label) + '</div>' +
      (strike ? '<span style="font:600 12px var(--sans);color:var(--slate-soft);text-decoration:line-through">' + inr(strike) + '</span>' : '') +
      '<div style="font:800 18px var(--serif,Georgia,serif);color:var(--ink)">' + inr(tierPrice(t)) + '<span style="font:600 11px var(--sans);color:var(--slate-soft)">' + tierPer(t) + '</span></div></div>' +
      '<div style="font:500 11.5px/1.4 var(--sans);color:var(--slate-soft);margin-top:3px">' + esc(TIER_BLURB[id] || "") + (t.requiresVerify ? " · verified trainee" : "") + '</div></button>';
  }
  function addonRow() {
    // Onco add-on only for Trainee/Pro/Physician (Physician Pro includes it).
    if (_tier === "physicianpro" || _tier === "student" || _tier === "coresident") return "";
    var a = _plans && _plans.addons && _plans.addons.onco; if (!a) return "";
    return '<div style="display:flex;align-items:center;gap:9px;margin:0 18px 6px;padding:10px 12px;border:1px solid var(--line,#d7dee3);border-radius:11px;background:var(--panel,#fff);font:600 12.5px var(--sans);color:var(--ink)">' +
      ppIco("plus") + ' OncoTree + ONCQIS <span style="flex:1"></span><span style="color:var(--slate-soft);margin-right:8px">+' + inr(a.amount) + '/mo</span>' +
      '<button data-pp="buy-addon" data-addon="onco" style="border:1.5px solid var(--teal,#0e6e63);background:transparent;color:var(--teal,#0e6e63);border-radius:9px;padding:6px 12px;font:800 12px var(--sans);cursor:pointer">Add</button></div>';
  }
  function tokenStore() {
    var tk = _plans && _plans.tokens; if (!tk) return "";
    var packs = ["boost", "plus", "power"].filter(function (k) { return tk[k]; });
    if (!packs.length) return "";
    return '<div style="padding:8px 18px 4px"><div style="font:800 13px var(--serif,Georgia,serif);color:var(--ink)">MaiK Token top-ups</div>' +
      '<div style="font:500 11px var(--sans);color:var(--slate-soft);margin:2px 0 8px">One wallet for all AI. Buy once, spend on anything.</div>' +
      '<div style="display:flex;gap:8px">' + packs.map(function (k) {
        var p = tk[k], strike = (p.regular && p.regular > p.amount) ? p.regular : 0;
        return '<button data-pp="token" data-pack="' + k + '" style="flex:1;text-align:left;border:2px solid ' + (p.popular ? "var(--teal,#0e6e63)" : "var(--line,#d7dee3)") + ';border-radius:12px;padding:10px;background:var(--panel,#fff);cursor:pointer">' +
          '<div style="font:800 15px var(--sans);color:var(--ink)">' + (p.mt >= 1000000 ? (p.mt / 1000000) + "M" : Math.round(p.mt / 1000) + "k") + '</div><div style="font:500 9px var(--sans);color:var(--slate-soft)">MaiK Tokens</div>' +
          '<div style="margin-top:5px">' + (strike ? '<span style="font:600 10px var(--sans);color:var(--slate-soft);text-decoration:line-through">' + inr(strike) + '</span> ' : '') + '<span style="font:800 13px var(--sans);color:var(--teal,#0e6e63)">' + inr(p.amount) + '</span></div></button>';
      }).join("") + '</div></div>';
  }
  function ctaBlock() {
    if (!fbUser()) return '<div style="padding:8px 18px 4px"><button data-pp="signin" style="width:100%;padding:14px;border:none;border-radius:13px;background:var(--teal,#0e6e63);color:#fff;font:800 15px var(--sans);cursor:pointer">Sign in to subscribe</button></div>';
    var t = _plans && _plans.tiers && _plans.tiers[_tier];
    if (plat() === "ios" && !iosNativeIap()) return '<div style="padding:8px 18px 4px"><button disabled style="width:100%;padding:14px;border:none;border-radius:13px;background:var(--line,#d7dee3);color:var(--slate,#2d4356);font:800 14px var(--sans)">Subscriptions coming soon on iOS</button></div>';
    var label = t ? ("Subscribe to " + t.label + " · " + inr(tierPrice(t)) + tierPer(t)) : "Subscribe";
    var via = plat() === "ios" ? "the App Store" : "PhonePe · UPI / cards / netbanking";
    return '<div style="padding:8px 18px 4px"><button data-pp="buy" style="width:100%;padding:14px;border:none;border-radius:13px;background:var(--teal,#0e6e63);color:#fff;font:800 14px var(--sans);cursor:pointer">' + esc(label) + '</button>' +
      '<div style="font:500 10.5px/1.5 var(--sans);color:var(--slate-soft);text-align:center;margin-top:7px">Secure payment via ' + via + ' · cancel anytime</div></div>';
  }

  // Institution coupon redeem — a doctor whose hospital paid enters the code to unlock Pro.
  function redeemBlock() {
    return '<div style="padding:2px 18px 22px"><div style="border-top:1px solid var(--line,#d7dee3);padding-top:12px">' +
      '<div style="font:700 12.5px var(--sans);color:var(--slate,#2d4356);margin-bottom:7px">Have an institution code?</div>' +
      '<div style="display:flex;gap:8px"><input id="pp-code" placeholder="Enter code" autocapitalize="characters" spellcheck="false" style="flex:1;padding:11px 12px;border:1.5px solid var(--line,#d7dee3);border-radius:11px;font:600 14px var(--sans);letter-spacing:.06em;text-transform:uppercase;background:var(--panel,#fff);color:var(--ink)">' +
      '<button data-pp="redeem" style="flex:none;padding:11px 16px;border:none;border-radius:11px;background:var(--slate,#2d4356);color:#fff;font:800 13px var(--sans);cursor:pointer">Redeem</button></div>' +
      '<div id="pp-code-msg" style="font:600 11.5px var(--sans);margin-top:6px;min-height:14px"></div></div></div>';
  }
  function redeem() {
    var inp = _root && _root.querySelector("#pp-code"), msg = _root && _root.querySelector("#pp-code-msg");
    var code = inp ? String(inp.value || "").trim().toUpperCase() : "";
    if (!code) { if (msg) { msg.style.color = "var(--slate-soft)"; msg.textContent = "Enter your code first."; } return; }
    if (!fbUser()) { try { if (window.SMD_signInWithGoogle) SMD_signInWithGoogle(); } catch (e) {} return; }
    var btn = _root && _root.querySelector('[data-pp="redeem"]');
    if (btn) { btn.disabled = true; btn.textContent = "…"; }
    if (msg) { msg.style.color = "var(--slate-soft)"; msg.textContent = "Checking…"; }
    api("/api/billing/coupon/redeem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: code }) })
      .then(function (x) {
        if (btn) { btn.disabled = false; btn.textContent = "Redeem"; }
        if (x.s === 200 && x.d && x.d.ok) {
          if (msg) { msg.style.color = "var(--green,#1c7a4a)"; msg.textContent = x.d.already ? "Already redeemed on this account." : "Code accepted. Pro unlocked."; }
          toast("Pro unlocked"); if (window.SMD_PRO && SMD_PRO.sync) try { SMD_PRO.sync(); } catch (e) {}
          refresh();
        } else {
          var why = (x.d && x.d.reason) || "";
          var m = why === "revoked" ? "This code has been revoked." : why === "expired" ? "This code has expired." : why === "exhausted" ? "This code has reached its limit." : why === "not-found" ? "Code not recognised." : "Could not redeem this code.";
          if (msg) { msg.style.color = "var(--danger,#b3261e)"; msg.textContent = m; }
        }
      })
      .catch(function () { if (btn) { btn.disabled = false; btn.textContent = "Redeem"; } if (msg) { msg.style.color = "var(--danger,#b3261e)"; msg.textContent = "Network error. Try again."; } });
  }

  function paint() {
    var promoOn = _status && _status.promo;
    var isPaid = _status && _status.pro && !promoOn;
    var banner = "";
    if (promoOn) banner = '<div style="margin:6px 18px 4px;padding:11px 13px;border-radius:12px;background:var(--green-bg,#e7f5ec);border:1px solid var(--green-line,#aedcc1);font:600 12.5px/1.5 var(--sans);color:var(--green,#1c7a4a)">' + ppIco("spark") + ' Launch period — Pro is <b>free for everyone until ' + esc(fdate(_status.promoUntil || _status.until)) + '</b>. Subscribe anytime to keep it after.</div>';
    else if (isPaid) banner = '<div style="margin:6px 18px 4px;padding:11px 13px;border-radius:12px;background:var(--teal-soft,#e3f1ee);border:1px solid var(--teal,#0e6e63);font:700 12.5px var(--sans);color:var(--teal,#0e6e63)">' + ppIco("check") + ' Pro active' + (_status.until ? ' until ' + esc(fdate(_status.until)) : '') + '. Thank you!</div>';

    var ios = plat() === "ios", body;
    if (_plans && _plans.tiers) {
      var tiers = TIER_ORDER.filter(function (id) { return _plans.tiers[id]; }).map(function (id) { return tierCard(id, _plans.tiers[id]); }).join("");
      body = cycleToggle() + '<div style="padding:2px 18px 4px">' + tiers + '</div>' + addonRow() + ctaBlock() + tokenStore();
    } else {
      body = '<div style="padding:20px 18px;text-align:center;color:var(--slate-soft);font:500 13px var(--sans)">Loading plans…</div>';
    }
    var sub = promoOn ? "Everything unlocked, free until the launch period ends" : (isPaid ? "You’re a Pro member" : "Choose your plan");
    _root.querySelector("#proPay > div").innerHTML = header(sub) + banner + body + (ios ? "" : redeemBlock());   // coupon hidden on iOS
    wire();
  }

  function wire() {
    var r = _root; if (!r) return;
    r.querySelectorAll("[data-pp]").forEach(function (b) {
      b.onclick = function () {
        var k = b.getAttribute("data-pp");
        if (k === "close") return close();
        if (k === "tier") { _tier = b.getAttribute("data-tier"); return paint(); }
        if (k === "cycle") { _cycle = b.getAttribute("data-cycle"); return paint(); }
        if (k === "signin") { try { if (window.SMD_signInWithGoogle) SMD_signInWithGoogle(); } catch (e) {} return; }
        if (k === "buy") return doBuy({ tier: _tier, cycle: _cycle }, b);
        if (k === "buy-addon") return doBuy({ addon: b.getAttribute("data-addon") }, b);
        if (k === "token") return doBuy({ pack: b.getAttribute("data-pack") }, b);
        if (k === "redeem") return redeem();
        if (k === "ailimit-upgrade") { close(); return openPaywall(); }
      };
    });
    r.addEventListener("click", function (e) { if (e.target === r.firstChild) close(); }, { once: true });
  }

  function openUrl(url) {
    try { if (isNative() && window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Browser) { Capacitor.Plugins.Browser.open({ url: url }); } else { window.location.href = url; } }
    catch (e) { window.location.href = url; }
  }
  // Route a purchase: iOS -> StoreKit via SMD_IAP (Session A's plugin); web/Android -> PhonePe.
  function doBuy(body, btn) {
    if (!fbUser()) { try { if (window.SMD_signInWithGoogle) SMD_signInWithGoogle(); } catch (e) {} return; }
    if (plat() === "ios") {
      if (!iosNativeIap()) { toast("Purchases are coming soon on iOS."); return; }
      var pid = productIdFor(body); if (!pid) return;
      if (btn) btn.disabled = true;
      Promise.resolve(SMD_IAP.purchase(pid)).then(
        function () { toast("Purchase complete."); try { if (window.SMD_PRO && SMD_PRO.sync) SMD_PRO.sync(); } catch (e) {} refresh(); },
        function () { if (btn) btn.disabled = false; toast("Purchase cancelled."); });
      return;
    }
    if (btn) btn.disabled = true;
    api("/api/billing/phonepe/pay", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (x) {
        if (x.s === 200 && x.d && x.d.redirectUrl) { openUrl(x.d.redirectUrl); }
        else { if (btn) btn.disabled = false; toast(x.d && x.d.error === "phonepe-not-configured" ? "Payments aren’t switched on yet." : (x.d && x.d.error === "signin-required" ? "Sign in first." : "Couldn’t start checkout — try again.")); }
      })
      .catch(function () { if (btn) btn.disabled = false; toast("Network error — try again."); });
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

  // "AI limit hit" sheet — shown when an AI call returns 429 { reason:"ai-cost-cap" }. Offers the
  // daily-reset time, current credit balance, and a route to upgrade / add credits.
  function openAiLimit(info) {
    info = info || {}; close();
    var reset = info.resetAt ? new Date(+info.resetAt) : null;
    var resetTxt = reset ? reset.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "midnight";
    var mt = (typeof info.credits === "number") ? Math.round(info.credits * 2000) : null;   // ₹ credit → MaiK Tokens
    var msg = info.message || "You've used today's MaiK Tokens.";
    var inner = header("Today's MaiK Tokens are used up") +
      '<div style="padding:6px 18px 4px"><div style="padding:13px 14px;border-radius:12px;background:var(--amber-bg,#fff4e0);border:1px solid var(--amber-line,#f0d090);font:600 13px/1.6 var(--sans);color:var(--ink)">' + ppIco("bell") + ' ' + esc(msg) + '</div></div>' +
      '<div style="padding:8px 18px 2px;font:500 12.5px/1.6 var(--sans);color:var(--slate-soft)">Your allowance resets at <b>' + esc(resetTxt) + '</b>.' + (mt != null ? ' MaiK Token balance: <b>' + esc(mt.toLocaleString("en-IN")) + '</b>.' : '') + '</div>' +
      '<div style="padding:14px 18px 22px"><button data-pp="ailimit-upgrade" style="width:100%;padding:14px;border:none;border-radius:13px;background:var(--teal,#0e6e63);color:#fff;font:800 15px var(--sans);cursor:pointer">Add MaiK Tokens or upgrade</button>' +
      '<div style="font:500 11.5px/1.5 var(--sans);color:var(--slate-soft);text-align:center;margin-top:8px">Or wait for the daily reset. No charge.</div></div>';
    var div = document.createElement("div");
    div.innerHTML = shell(inner);
    _root = div.firstChild; document.body.appendChild(_root); document.body.style.overflow = "hidden";
    wire();
  }

  // Force a token refresh so isPro() picks up a just-granted `pro` claim, then re-check status.
  function refresh() { return token(true).then(function () { return api("/api/billing/status").then(function (x) { _status = x.d || {}; if (_root) paint(); return _status; }); }); }

  function attach() { if (!window.SMD_PRO) return setTimeout(attach, 300); window.SMD_PRO.openPaywall = openPaywall; window.SMD_PRO.openAiLimit = openAiLimit; window.SMD_PRO.refresh = refresh; }
  attach();

  // One central interceptor for the "AI limit hit" sheet: watch AI responses and, on a 429
  // ai-cost-cap, pop the sheet — so no individual AI caller needs to know about the cap. Scoped to
  // /api/ai/ + status 429; everything else passes through byte-for-byte (we read a CLONE).
  try {
    var _origFetch = window.fetch;
    if (_origFetch && !_origFetch._smdPaywrap) {
      var wrapped = function (input, init) {
        var p = _origFetch.apply(this, arguments);
        try {
          var url = (typeof input === "string" ? input : (input && input.url)) || "";
          if (url.indexOf("/api/ai/") > -1) {
            return p.then(function (r) {
              if (r && r.status === 429) { try { r.clone().json().then(function (d) { if (d && d.reason === "ai-cost-cap") openAiLimit(d); }, function () {}); } catch (e) {} }
              return r;
            });
          }
        } catch (e) {}
        return p;
      };
      wrapped._smdPaywrap = true;
      window.fetch = wrapped;
    }
  } catch (e) {}

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
