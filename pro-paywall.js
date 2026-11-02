/* StewardMD — Pro paywall / subscribe UI.
 *
 * Augments window.SMD_PRO (defined in account.js) with openPaywall() + refresh(). The SERVER is the
 * source of truth (/api/billing/*): this only renders the plans, drives Razorpay Standard Checkout on
 * web/Android (grantPro happens server-side off the webhook, never the client success callback), and
 * reflects entitlement. iOS uses native IAP (StoreKit) once wired. NOTE: routing Razorpay through the
 * Android app's own paywall (not just the stewardmd.in web page) needs Play's User Choice Billing
 * enrolment for India to stay policy-compliant on a Play-distributed build — see docs/native-only-lock.md.
 * During the launch promo everyone is already Pro — the sheet says so and still lets you subscribe
 * early (and test the flow).
 */
(function () {
  "use strict";
  function apiUrl(p) { return (window.SMD_API_BASE || "") + p; }
  function plat() { try { var C = window.Capacitor; return (C && (typeof C.getPlatform === "function" ? C.getPlatform() : C.platform)) || "web"; } catch (e) { return "web"; } }
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
  /* Sized icon: the app registry returns a bare viewBox svg, so stamp width/height for the one
   * place that renders it. With no ICONS on the page this is still "". */
  function ppIcoPx(n, px){
    var s = ppIco(n); if (!s) return "";
    px = px || 20;
    return String(s).replace("<svg ", '<svg width="' + px + '" height="' + px + '" ');
  }

  /* Default view: ANNUAL, three cards, Physician preselected. Trainee and Co-Resident are one tap
   * away behind the "I'm a student or resident" link — self-selection, not a hidden price: every
   * tier stays reachable and buyable, and the link opens automatically if one of them is selected. */
  var _root = null, _tier = "physician", _cycle = "annual", _status = null, _plans = null, _showAll = false;
  var TIER_ORDER = ["student", "coresident", "pro", "physician", "physicianpro"];
  var TIER_MAIN = ["pro", "physician", "physicianpro"];
  var TIER_QUIET = ["student", "coresident"];
  var TIER_BADGE = { pro: "MOST POPULAR", physician: "BEST VALUE", physicianpro: "BEST FOR CLINICS" };
  /* What the doctor GETS, one short sentence per card. Benefit statements only: no clinical
   * outcome claim (readmissions, recovery, complications, mortality), no statistic, no testimonial.
   * Unproven medical claims fail App Store review and cost a clinician's trust, which is worth more
   * than the conversion they would buy. */
  var TIER_BENEFIT = {
    student: "Learn the examination, not just the textbook.",
    coresident: "Split it with your co-resident. Two logins, one bill.",
    pro: "The whole clinical engine, on call at the bedside.",
    physician: "Runs your clinic: queue, billing, recovery calls, and notes that think with you.",
    physicianpro: "We host it. Your records, every device, nothing to set up.",
  };
  var TIER_NOTE = { physician: "MaiK Voice Scribe writes the note, then offers the differentials worth considering." };
  /* Everyday-spend comparison, keyed by CYCLE then tier: what a year costs is not what a month
   * costs, so the sentence differs. Words only, never a number: the price itself is already on the
   * card and comes from the server, so a KV price edit can never make one of these lines quote a
   * figure we no longer charge. quarterly/halfyearly are here for the day those cycles are shown;
   * a tier or cycle with no entry renders NOTHING rather than borrowing another tier's line. */
  var TIER_SPEND = {
    monthly: {
      student: "Less than a pizza.",
      coresident: "Less than one movie ticket, split two ways.",
      pro: "Less than a movie night with the family.",
      physician: "Less than one dinner out.",
      physicianpro: "Less than a tank of petrol.",
    },
    annual: {
      student: "Less than a pair of good shoes.",
      coresident: "Less than one weekend away, for the two of you.",
      pro: "Less than one family holiday weekend.",
      physician: "Less than one family dinner a month.",
      physicianpro: "Less than a new phone, and it runs your clinic for a year.",
    },
    quarterly: {
      pro: "Less than a family lunch out.",
      physician: "Less than a weekend away.",
      physicianpro: "Less than a month of school fees.",
    },
    halfyearly: {
      pro: "Less than one wedding gift.",
      physician: "Less than a new pair of spectacles.",
      physicianpro: "Less than a weekend at a resort.",
    },
  };
  var ADDON_SPEND = { onco: "Less than a coffee." };
  /* The per-day hero line. The WORDS are fixed here; the NUMBER is always recomputed from the
   * server price for the selected cycle, so a KV price override moves the figure and leaves the
   * comparison alone. A tier with no entry shows the bare "\u20b9N a day" and invents nothing. */
  var TIER_DAY_NOTE = {
    student: "Less than a cup of chai.",
    coresident: "Split with your co-resident.",
    pro: "Less than a samosa.",
    physician: "Less than a samosa, and it runs your clinic.",
    physicianpro: "One consultation fee covers your month.",
  };
  var TIER_BLURB = {
    student: "Full MaiK AI · voice dictation · every CliniX system",
    coresident: "2 accounts · shared AI pool · 4 imaging/day each",
    pro: "Imaging AI · Patient Summary · Research · Lab Watch · Ultra voice",
    physician: "Your clinic (own Drive) · FollowCare · MaiK Voice Scribe · unlimited billing",
    // "in beta" is not marketing softener, it is the honest status: these four models are clinically
    // unvalidated (docs/fundx/VALIDATION-PROGRAM.md). Do not drop it from this line.
    physicianpro: "Cloud clinic (we host) · more AI · OncoTree + ONCQIS included · Early access to ThoreX, KardiQ X, SknX and FundX imaging AI, in beta",
  };
  var TIER_IAP = { student: "trainee", coresident: "coresident", pro: "pro", physician: "physician", physicianpro: "physicianpro" };
  function iosNativeIap() { return plat() === "ios" && window.SMD_IAP && typeof SMD_IAP.purchase === "function"; }
  function productIdFor(body) {
    if (body.productId) return body.productId;   // PrepNucleus Pro: the server quote names the product
    if (body.tier) return "in.stewardmd." + (TIER_IAP[body.tier] || body.tier) + "." + (body.cycle === "annual" ? "annual" : "monthly");
    if (body.addon === "onco") return "in.stewardmd.onco.monthly";
    if (body.pack) return "in.stewardmd.tokens." + body.pack;
    if (body.quotaPack) return "in.stewardmd." + body.quotaPack;   // care.25 / scribe.50 / msg.100 …
    if (body.msgTier) return "in.stewardmd.msg." + body.msgTier + ".monthly";   // Clinic Messaging
    return null;
  }

  function close() { if (_root) { try { _root.remove(); } catch (e) {} _root = null; document.body.style.overflow = ""; } }

  // SMD-09: plan text uses the Apple system font (--pp-f), and the sheet stops below the status bar
  // and Dynamic Island so the StewardMD Pro title is never cut off.
  function shell(inner) {
    /* The focus <style> sits AFTER the dialog so #proPay firstChild stays the dialog: wire()
     * compares click targets against it. */
    return '<div id="proPay" style="--pp-f:-apple-system,BlinkMacSystemFont,\'SF Pro Text\',\'SF Pro Display\',system-ui,\'Helvetica Neue\',sans-serif;position:fixed;inset:0;z-index:760;background:rgba(6,14,20,.5);display:flex;align-items:flex-end;justify-content:center;font-family:var(--pp-f);-webkit-font-smoothing:antialiased">' +
      '<div role="dialog" aria-modal="true" aria-label="StewardMD Pro" style="background:var(--paper,#f6f7f5);color:var(--ink,#14202b);width:100%;max-width:520px;max-height:calc(100vh - env(safe-area-inset-top, 0px) - 14px);max-height:calc(100dvh - env(safe-area-inset-top, 0px) - 14px);overflow:auto;border-radius:20px 20px 0 0;box-shadow:0 -12px 44px rgba(0,0,0,.28)">' + inner + '</div>' +
      '<style>#proPay button:focus-visible,#proPay input:focus-visible{outline:2px solid var(--teal,#0e6e63);outline-offset:2px}</style></div>';
  }
  // Header for the other sheets (loading, AI limit, token top-up). The Pro sheet uses hero().
  function header(sub) {
    return '<div style="position:sticky;top:0;background:var(--paper,#f6f7f5);padding:18px 20px 10px;display:flex;align-items:flex-start;gap:10px;z-index:2">' +
      '<div style="flex:1"><div style="font:800 20px var(--pp-f);color:var(--ink)">StewardMD <span style="color:var(--teal,#0e6e63)">Pro</span></div>' +
      (sub ? '<div style="font:500 12.5px var(--pp-f);color:var(--slate-soft,#5a7184);margin-top:2px">' + sub + '</div>' : '') + '</div>' +
      '<button data-pp="close" aria-label="Close" style="flex:none;width:44px;height:44px;border-radius:50%;border:none;background:var(--panel,#fff);color:var(--slate,#2d4356);font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,.1)">' + ppIcoPx("close", 18) + '</button></div>';
  }
  /* Layout follows a designer's "fix the AI-slop paywall" teardown (ux.amish, 2026-11-02):
   * a full-bleed brand hero with the headline over a picture of the OUTCOME, a white sheet that
   * rises over it, a single row of icon benefits, plan rows with a radio, one CTA. */
  /* The hero follows the plan being looked at: StewardMD is an antibiotic-decision, drug-learning
   * and clinic app, so a resident and a clinic owner each see THEIR outcome. Words and pictures are
   * illustrative (assistive framing, no statistic, no outcome claim). */
  var TIER_HERO = {
    student:      { h: "Make residency the easy part.", grid: "YOUR LEARNING STREAK", ben: [["microbe", "Antibiotic<br>decisions"], ["pills", "Learn<br>drugs"], ["antibiogram", "Local<br>antibiogram"]] },
    coresident:   { h: "Make residency the easy part, together.", grid: "YOUR LEARNING STREAK", ben: [["microbe", "Antibiotic<br>decisions"], ["pills", "Learn<br>drugs"], ["antibiogram", "Local<br>antibiogram"]] },
    pro:          { h: "The right antibiotic, at the bedside.", grid: "BEDSIDE DECISIONS", ben: [["microbe", "Antibiotic<br>decisions"], ["antibiogram", "Local<br>antibiogram"], ["xray", "Imaging<br>AI"]] },
    physician:    { h: "MaiK writes your notes while you see patients.", grid: "NOTES MAIK DRAFTED", ben: [["mic", "Voice<br>scribe"], ["rounds", "Smart OPD<br>queue"], ["bell", "FollowCare<br>recalls"]] },
    physicianpro: { h: "Your whole clinic, hosted for you.", grid: "CLINIC DAYS, IN THE CLOUD", ben: [["cloud", "Cloud<br>clinic"], ["device", "Every<br>device"], ["xray", "Imaging AI<br>(beta)"]] },
  };
  function heroOf(id) { return TIER_HERO[id] || TIER_HERO.physician; }
  /* The habit, drawn: 20 weeks x 6 days, each square one day of use, brighter = more, getting
   * busier towards today; the highlighted square is today. A light tint of the theme's own accent,
   * so every appearance theme carries over. Illustrative (aria-hidden), no count is claimed. */
  function streakGrid(label) {
    var cells = "", COLS = 20, ROWS = 6, A = [0.07, 0.16, 0.34, 0.62, 0.92];
    for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) {
      var h = ((c * 7 + r * 13 + c * r * 3) % 11) / 11;   // fixed pseudo-noise, same picture every open
      var lv = Math.max(0, Math.min(4, Math.floor(c / COLS * 4.2 + h * 1.6 - 0.4)));
      var today = (r === 3 && c === COLS - 1);
      cells += '<i style="display:block;aspect-ratio:1/1;border-radius:4px;background:' +
        (today ? '#9fe3d4;background:color-mix(in srgb,var(--sphere-hi,#2f9184) 45%,#fff)' : "rgba(255,255,255," + A[lv] + ")") + '"></i>';
    }
    return '<div style="margin-top:24px">' +
      '<div style="font:700 10.5px var(--pp-f);letter-spacing:.1em;color:rgba(255,255,255,.62);margin-bottom:10px">' + esc(label) + '</div>' +
      '<div aria-hidden="true" style="display:grid;grid-template-columns:repeat(' + COLS + ',1fr);gap:3px">' + cells + '</div>' +
      '<div aria-hidden="true" style="display:flex;justify-content:space-between;margin-top:10px;font:500 11.5px var(--pp-f);color:rgba(255,255,255,.6)"><span>4 months ago</span><span>Today</span></div>' +
    '</div>';
  }
  function hero(title) {
    var cfg = heroOf(_tier);
    return '<div id="ppHero" data-tier="' + esc(_tier) + '" style="background:var(--sphere-base,#06231e);color:#fff;padding:12px 20px 46px">' +
      '<div style="display:flex;align-items:center;justify-content:space-between">' +
        '<button data-pp="close" aria-label="Close" style="flex:none;width:44px;height:44px;margin-left:-6px;border-radius:50%;border:none;background:rgba(255,255,255,.1);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center">' + ppIcoPx("close", 18) + '</button>' +
        '<span style="display:flex;align-items:center;gap:8px;font:700 13px var(--pp-f);letter-spacing:.01em;color:rgba(255,255,255,.9)"><img src="/logo.png" alt="" width="30" height="30" style="display:block;filter:brightness(0) invert(1)">StewardMD Pro</span>' +
      '</div>' +
      '<h2 style="margin:20px 0 0;font:700 29px/1.1 var(--smd-dsp,var(--pp-f));letter-spacing:-.02em;color:#fff;text-wrap:balance;max-width:19ch">' + esc(title || cfg.h) + '</h2>' +
      streakGrid(cfg.grid) +
    '</div>';
  }
  /* One row of icon benefits for the plan being looked at, icons from the app's ICONS registry. */
  function benefitRow() {
    return '<div id="ppBenefits" role="list" aria-label="What this plan does for you" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:0 20px">' +
      heroOf(_tier).ben.map(function (b) {
        return '<div role="listitem" style="display:flex;flex-direction:column;align-items:center;gap:9px;text-align:center;min-width:0">' +
          '<span style="width:40px;height:40px;box-sizing:border-box;border-radius:12px;background:var(--teal-soft,#e3f1ee);color:var(--teal,#0e6e63);display:flex;align-items:center;justify-content:center">' + ppIcoPx(b[0], 20) + '</span>' +
          '<span style="font:600 12.5px/1.3 var(--pp-f);color:var(--ink,#14202b)">' + b[1] + '</span></div>';
      }).join("") + '</div>' +
      '<div style="text-align:center;font:500 12px/1.5 var(--pp-f);color:var(--slate-soft,#5a7184);margin:16px 20px 0">Assistive AI. You review and decide, every time.</div>';
  }
  /* PRICING IS SERVER TRUTH. Every number below is derived from /api/billing/plans:
   *   t.amount  — monthly price now        t.annual  — annual price now
   *   t.regular — the price we charge from the end of the launch window. It is the ONLY anchor
   *               allowed in a strike-through; nothing here invents a "was" price, and a tier whose
   *               payload has no `regular` (or a `regular` that is not higher) shows no strike-through
   *               and no SAVE pill. Indian MRP law and App Store review both turn on exactly this.
   */
  function isAnnual(t) { return _cycle === "annual" && !!(t && t.annual); }   // per CARD: a tier with no annual price stays monthly
  function tierPrice(t) { return isAnnual(t) ? t.annual : t.amount; }
  function tierPer(t) { return isAnnual(t) ? "/year" : "/month"; }
  // The true anchor: regular (x12 when the card is showing a year). 0 = show nothing.
  function tierStrike(t) {
    if (!t || !t.regular || !(t.regular > t.amount)) return 0;
    var a = isAnnual(t) ? t.regular * 12 : t.regular;
    return a > tierPrice(t) ? a : 0;
  }
  function savePct(t) { var a = tierStrike(t); return a ? Math.round((1 - tierPrice(t) / a) * 100) : 0; }
  function seatsOf(t) { return Math.max(1, +((t && t.seats) || 1)); }   // Co-Resident is 2 accounts: the per-day figure is per doctor
  function perDay(t) { var days = isAnnual(t) ? 365 : 30; return Math.round((tierPrice(t) / 100) / seatsOf(t) / days); }
  function perDayTxt(t) {
    var d = perDay(t), each = seatsOf(t) > 1 ? " each" : "";
    return d >= 1 ? ("₹" + d.toLocaleString("en-IN") + " a day" + each) : ("Under ₹1 a day" + each);
  }
  function perDayLine(id, t) { var n = TIER_DAY_NOTE[id]; return perDayTxt(t) + "." + (n ? " " + n : ""); }
  function spendLine(id, t) { var m = TIER_SPEND[isAnnual(t) ? "annual" : _cycle] || TIER_SPEND.monthly; return (m && m[id]) || ""; }
  function tierOf(id) { return (_plans && _plans.tiers && _plans.tiers[id]) || null; }

  /* FIX 4 (one clear plan). While the launch promo runs, the card states exactly what is
   * charged afterwards and when: "then Rs X/year from <date>". Both figures are server truth
   * (the `regular` anchor, x12 on a yearly card, else the plan's own price) and the date is the
   * server's promo end. No trial exists on any purchase path here, so nothing else promises one. */
  function promoAfterLine(t) {
    if (!(_status && _status.promo)) return "";
    var until = fdate(_status.promoUntil || _status.until);
    if (!until) return "";
    var price, per;
    if (isAnnual(t)) { price = (t.regular && t.regular > t.amount) ? t.regular * 12 : tierPrice(t); per = "/year"; }
    else { price = (t.regular && t.regular > t.amount) ? t.regular : tierPrice(t); per = "/month"; }
    return "then " + inr(price) + per + " from " + until + ".";
  }
  /* Which plan: a quiet chip per tier. The billing choice is the two price cards below. */
  function tierChip(id, t) {
    var on = _tier === id;
    return '<button data-pp="tier" data-tier="' + id + '" aria-pressed="' + (on ? "true" : "false") + '" style="flex:1 1 30%;min-height:40px;padding:0 8px;border:none;border-radius:9px;background:' + (on ? "var(--panel,#fff)" : "transparent") + ';box-shadow:' + (on ? "0 1px 3px rgba(0,0,0,.12)" : "none") + ';color:' + (on ? "var(--ink,#14202b)" : "var(--slate,#2d4356)") + ';font:' + (on ? "700" : "600") + ' 13px var(--pp-f);cursor:pointer;white-space:nowrap">' + esc(t.label) + '</button>';
  }
  function cardsFor(ids) {
    return ids.filter(function (id) { return tierOf(id); }).map(function (id) { return tierChip(id, tierOf(id)); }).join("");
  }
  /* The selected tier in words. Every tier keeps its own lines (badge, benefit, note, feature
   * list, per-day figure and everyday comparison); only the selected tier's lines are shown. */
  function tierDetail() {
    var id = _tier, t = tierOf(id); if (!t) return "";
    var badge = TIER_BADGE[id] || (t.popular ? "MOST POPULAR" : "");
    var spend = spendLine(id, t), note = TIER_NOTE[id] || "";
    return '<div id="ppTier" data-detail="' + id + '" style="margin:20px 20px 0;padding:16px 2px 0;border-top:1px solid var(--line,#dfe3dc)">' +
      (badge ? '<div style="font:700 10.5px var(--pp-f);letter-spacing:.07em;color:var(--slate-soft,#5a7184)">' + esc(badge) + (t.requiresVerify ? ' · VERIFIED TRAINEE' : '') + '</div>' : (t.requiresVerify ? '<div style="font:700 10.5px var(--pp-f);letter-spacing:.07em;color:var(--slate-soft,#5a7184)">VERIFIED TRAINEE</div>' : '')) +
      (TIER_BENEFIT[id] ? '<div style="font:600 14px/1.45 var(--pp-f);color:var(--ink,#14202b);margin-top:4px">' + esc(TIER_BENEFIT[id]) + '</div>' : '') +
      (note ? '<div style="font:500 12.5px/1.45 var(--pp-f);color:var(--slate,#2d4356);margin-top:4px">' + esc(note) + '</div>' : '') +
      (TIER_BLURB[id] ? '<div style="font:500 12.5px/1.5 var(--pp-f);color:var(--slate-soft,#5a7184);margin-top:6px">' + esc(TIER_BLURB[id]) + '</div>' : '') +
      (tierStrike(t) ? '<div style="font:500 12.5px/1.5 var(--pp-f);color:var(--slate-soft,#5a7184);margin-top:6px">Launch price, regular <span style="text-decoration:line-through">' + inr(tierStrike(t)) + '</span> (SAVE ' + savePct(t) + '%)</div>' : '') +
      '<div style="font:600 12.5px/1.5 var(--pp-f);color:var(--teal,#0e6e63);margin-top:4px">' + esc(perDayLine(id, t)) + (spend ? ' <span style="font-weight:500;color:var(--slate,#2d4356)">' + esc(spend) + '</span>' : '') + '</div>' +
    '</div>';
  }
  /* Yearly / Monthly as two cards side by side, the selected one ticked. The yearly card's
   * "Save N%" compares the server's yearly price with twelve of its monthly price: both are
   * current prices, so it never invents a was-price. The launch `regular` anchor, when the
   * server sends one, is shown struck through under the price, exactly as before. */
  function cycleCards() {
    var t = tierOf(_tier); if (!t) return "";
    function card(cyc) {
      var on = _cycle === cyc || (cyc === "monthly" && !t.annual);
      var annual = cyc === "annual";
      var price = annual ? t.annual : t.amount;
      var save = annual && t.amount ? Math.round((1 - t.annual / (t.amount * 12)) * 100) : 0;
      var tick = on
        ? '<span aria-hidden="true" style="flex:none;width:22px;height:22px;border-radius:50%;background:var(--teal,#0e6e63);color:#fff;display:flex;align-items:center;justify-content:center">' + ppIcoPx("check", 13) + '</span>'
        : '<span aria-hidden="true" style="flex:none;width:22px;height:22px;box-sizing:border-box;border-radius:50%;border:1.5px solid var(--line,#c9d0c7)"></span>';
      return '<button data-pp="cycle" data-cycle="' + cyc + '" aria-pressed="' + (on ? "true" : "false") + '" style="position:relative;flex:1;min-width:0;text-align:left;min-height:96px;box-sizing:border-box;padding:16px 14px 14px;border-radius:16px;border:' + (on ? "1.5px solid var(--teal,#0e6e63)" : "1px solid var(--line,#dfe3dc)") + ';background:var(--panel,#fff);color:var(--ink,#14202b);cursor:pointer">' +
        (save > 0 ? '<span style="position:absolute;top:-10px;left:12px;font:700 11px var(--pp-f);color:var(--teal,#0e6e63);background:var(--teal-soft,#e3f1ee);border:1px solid var(--paper,#f6f7f5);border-radius:7px;padding:3px 8px">Save ' + save + '%</span>' : '') +
        '<div style="display:flex;align-items:center;gap:8px"><span style="flex:1;font:600 14px var(--pp-f)">' + (annual ? "Yearly" : "Monthly") + '</span>' + tick + '</div>' +
        '<div style="font:700 21px var(--smd-dsp,var(--pp-f));letter-spacing:-.01em;margin-top:6px;white-space:nowrap">' + inr(price) + '<span style="font:600 13px var(--pp-f)">' + (annual ? "/yr" : "/mo") + '</span></div>' +
        '<div style="font:500 12px var(--pp-f);color:var(--slate-soft,#5a7184);margin-top:3px">' +
          (annual ? inr(Math.round(price / 12)) + "/mo" : "Billed monthly") + '</div>' +
      '</button>';
    }
    return '<div role="group" aria-label="Billing period" style="display:flex;gap:10px;margin:24px 20px 0">' + (t.annual ? card("annual") : "") + card("monthly") + '</div>';
  }
  // Quiet self-selection link. Nothing is hidden from someone who needs it; the default view just
  // does not open on the two cheapest tiers.
  function moreTiersLink() {
    if (!TIER_QUIET.filter(function (id) { return tierOf(id); }).length) return "";
    if (_showAll) return '<div style="padding:8px 20px 0;font:500 12px var(--pp-f);color:var(--slate-soft)">Trainee and resident plans need a verified registration.</div>';
    return '<div style="padding:10px 20px 0;text-align:center"><button data-pp="showall" style="min-height:44px;background:none;border:none;padding:0 2px;font:600 13px var(--pp-f);color:var(--teal,#0e6e63);text-decoration:underline;text-underline-offset:3px;cursor:pointer">I’m a student or resident</button></div>';
  }

  /* Onco add-on: available on EVERY tier, because browsing oncology is free for everyone and the
   * add-on is what buys the oncology AI. Priced from the server (plans.addons.onco); the trial line
   * only appears if the server sends a trial length, so the sheet never promises one that does not
   * exist. */
  function addonRow() {
    var a = _plans && _plans.addons && _plans.addons.onco; if (!a) return "";
    var trialDays = +(a.trialDays || 0);
    return '<div style="margin:4px 20px 14px;padding:14px;border:none;border-radius:12px;background:var(--panel,#fff)">' +
      '<div style="display:flex;align-items:center;gap:8px">' + ppIcoPx("plus", 16) +
      '<div style="flex:1;font:800 13px var(--pp-f);color:var(--ink)">Oncology AI add-on</div>' +
      '<div style="font:800 13px var(--pp-f);color:var(--ink)">+' + inr(a.amount) + '<span style="font:600 10.5px var(--pp-f);color:var(--slate-soft)">/month</span></div></div>' +
      '<div style="font:500 11.5px/1.5 var(--pp-f);color:var(--slate-soft);margin-top:5px">Protocols, staging and toxicity are free on every plan. This adds the AI that reads the evidence with you: evidence overlay, protocol recommendations and higher onco AI limits.' +
      (trialDays ? ' Everyone gets a ' + trialDays + '-day trial first.' : '') + '</div>' +
      '<div style="font:700 12px var(--pp-f);color:var(--teal,#0e6e63);margin-top:4px">' + esc("₹" + Math.round((a.amount / 100) / 30).toLocaleString("en-IN") + " a day.") + (ADDON_SPEND.onco ? ' <span style="font:600 11.5px var(--pp-f);color:var(--slate,#2d4356)">' + esc(ADDON_SPEND.onco) + '</span>' : '') + '</div>' +
      '<button data-pp="buy-addon" data-addon="onco" style="margin-top:9px;width:100%;min-height:44px;border:1.5px solid var(--teal,#0e6e63);background:transparent;color:var(--teal,#0e6e63);border-radius:10px;padding:10px;font:800 12.5px var(--pp-f);cursor:pointer">Add to any plan</button></div>';
  }

  function tokenStore() {
    var tk = _plans && _plans.tokens; if (!tk) return "";
    var packs = ["boost", "plus", "power"].filter(function (k) { return tk[k]; });
    if (!packs.length) return "";
    return '<div style="padding:10px 20px 6px"><div style="font:800 13px var(--pp-f);color:var(--ink)">MaiK Token top-ups</div>' +
      '<div style="font:500 11px var(--pp-f);color:var(--slate-soft);margin:2px 0 8px">One wallet for all AI. Buy once, spend on anything.</div>' +
      '<div style="display:flex;gap:8px">' + packs.map(function (k) {
        var p = tk[k], strike = (p.regular && p.regular > p.amount) ? p.regular : 0;
        return '<button data-pp="token" data-pack="' + k + '" style="flex:1;text-align:left;border:2px solid ' + (p.popular ? "var(--teal,#0e6e63)" : "var(--line,#d7dee3)") + ';border-radius:12px;padding:10px;background:var(--panel,#fff);cursor:pointer">' +
          '<div style="font:800 15px var(--pp-f);color:var(--ink)">' + (p.mt >= 1000000 ? (p.mt / 1000000) + "M" : Math.round(p.mt / 1000) + "k") + '</div><div style="font:500 9px var(--pp-f);color:var(--slate-soft)">MaiK Tokens</div>' +
          '<div style="margin-top:5px">' + (strike ? '<span style="font:600 10px var(--pp-f);color:var(--slate-soft);text-decoration:line-through">' + inr(strike) + '</span> ' : '') + '<span style="font:800 13px var(--pp-f);color:var(--teal,#0e6e63)">' + inr(p.amount) + '</span></div></button>';
      }).join("") + '</div></div>';
  }
  /* Sticky CTA. It always states exactly what the tap does: the tier, the amount, and the period,
   * read off the SELECTED card and cycle. It does NOT say "start N days free": no purchase path here
   * begins with a free period (Razorpay charges on the spot, and no StoreKit introductory offer is
   * configured), so that sentence would be a false claim to a doctor and to App Store review. The
   * free access some accounts already have is stated by the banner above, from the server payload. */
  function ctaLabel() {
    var t = tierOf(_tier);
    if (!t) return "Subscribe";
    return "Subscribe to " + t.label + " \u00b7 " + inr(tierPrice(t)) + tierPer(t);
  }
  function ctaBar(inner) {
    return '<div style="position:sticky;bottom:0;z-index:3;background:var(--paper,#f6f7f5);padding:12px 20px calc(14px + env(safe-area-inset-bottom,0px))">' + inner + '</div>';
  }
  function ctaBlock() {
    var BTN = "width:100%;min-height:52px;padding:14px;border:none;border-radius:14px;font:600 15.5px var(--pp-f);";
    if (!fbUser()) return ctaBar('<button data-pp="signin" style="' + BTN + 'background:var(--teal,#0e6e63);color:#fff;cursor:pointer">Sign in to subscribe</button>');
    if (plat() === "ios" && !iosNativeIap()) return ctaBar('<button disabled style="' + BTN + 'background:var(--line,#d7dee3);color:var(--slate,#2d4356)">Subscriptions coming soon on iOS</button>');
    var t = tierOf(_tier), after = t ? promoAfterLine(t) : "";
    var store = plat() === "ios" ? "the App Store" : plat() === "android" ? "Google Play" : "";
    // One honest line under the button: what is charged and when, then how. Never a trial.
    var line = t ? (after ? "Free until the launch ends, " + after.replace(/\.$/, "") : inr(tierPrice(t)) + tierPer(t) + " \u00b7 " + perDayTxt(t)) + ". Cancel anytime." : "Cancel anytime.";
    return ctaBar('<button data-pp="buy" style="' + BTN + 'background:var(--teal,#0e6e63);color:#fff;cursor:pointer">' + esc(ctaLabel()) + '</button>' +
      '<div style="font:500 12px/1.5 var(--pp-f);color:var(--slate-soft);text-align:center;margin-top:10px">' + esc(line) +  (store ? '<br>Secure payment via ' + store : '') + '</div>' +
      ((iosNativeIap() && typeof SMD_IAP.restore === "function") ? '<div style="text-align:center"><button data-pp="restore" style="min-height:44px;border:none;background:none;font:600 12.5px var(--pp-f);color:var(--slate,#2d4356);text-decoration:underline;text-underline-offset:3px;cursor:pointer">Restore purchases</button></div>' : ''));
  }

  // Institution coupon redeem — a doctor whose hospital paid enters the code to unlock Pro.
  function redeemBlock() {
    return '<div style="padding:4px 20px 24px"><div style="border-top:1px solid var(--line,#d7dee3);padding-top:14px">' +
      '<div style="font:700 12.5px var(--pp-f);color:var(--slate,#2d4356);margin-bottom:8px">Have an institution code?</div>' +
      '<div style="display:flex;gap:8px"><input id="pp-code" placeholder="Enter code" autocapitalize="characters" spellcheck="false" style="flex:1;min-height:44px;box-sizing:border-box;padding:11px 12px;border:1.5px solid var(--line,#d7dee3);border-radius:11px;font:600 14px var(--pp-f);letter-spacing:.06em;text-transform:uppercase;background:var(--panel,#fff);color:var(--ink)">' +
      '<button data-pp="redeem" style="flex:none;min-height:44px;box-sizing:border-box;padding:11px 16px;border:none;border-radius:11px;background:var(--slate,#2d4356);color:#fff;font:800 13px var(--pp-f);cursor:pointer">Redeem</button></div>' +
      '<div id="pp-code-msg" style="font:600 11.5px var(--pp-f);margin-top:6px;min-height:14px"></div></div></div>';
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
          if (msg) { msg.style.color = "var(--teal,#0e6e63)"; msg.textContent = x.d.already ? "Already redeemed on this account." : "Code accepted. Pro unlocked."; }
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
    /* FIX 2: the launch banner states the offer in words. The sparkle icon is gone; the
     * outcome preview below shows what Pro produces instead. FIX 5: one accent (teal) here. */
    if (promoOn) banner = '<div style="margin:18px 20px 0;padding:12px 14px;border-radius:12px;background:var(--panel,#fff);border:1px solid var(--line,#dfe3dc);font:500 13px/1.5 var(--pp-f);color:var(--ink,#14202b)">Launch period: Pro is <b>free for everyone until ' + esc(fdate(_status.promoUntil || _status.until)) + '</b>. Subscribe anytime to keep it after.</div>';
    else if (isPaid) banner = '<div style="margin:18px 20px 0;padding:12px 14px;border-radius:12px;background:var(--panel,#fff);border:1px solid var(--line,#dfe3dc);font:600 13px var(--pp-f);color:var(--ink,#14202b)">' + ppIcoPx("check", 15) + ' Pro active' + (_status.until ? ' until ' + esc(fdate(_status.until)) : '') + '. Thank you!</div>';

    var ios = plat() === "ios", body;
    if (_plans && _plans.tiers) {
      if (!tierOf(_tier)) { for (var i = TIER_ORDER.length - 1; i >= 0; i--) if (tierOf(TIER_ORDER[i])) _tier = TIER_ORDER[i]; }
      if (TIER_QUIET.indexOf(_tier) > -1) _showAll = true;   // a revealed tier never re-hides itself
      body = '<div style="background:var(--paper,#f6f7f5);border-radius:24px 24px 0 0;margin-top:-22px;position:relative;padding-top:24px">' +
        benefitRow() + banner +
        '<div role="group" aria-label="Plan" style="display:flex;flex-wrap:wrap;gap:3px;margin:24px 20px 0;padding:3px;border-radius:12px;background:var(--rds-surface-2,#eaeeec)">' + cardsFor(TIER_MAIN) + (_showAll ? cardsFor(TIER_QUIET) : "") + '</div>' +
        cycleCards() + tierDetail() + moreTiersLink() +
        '<div style="height:18px"></div>' + addonRow() + tokenStore() + '</div>';
    } else {
      body = '<div style="padding:20px 20px;text-align:center;color:var(--slate-soft);font:500 13px var(--pp-f)">Loading plans…</div>';
    }
    /* FIX 1: the headline says what the doctor gets, in one concrete line. No outcome claim,
     * no statistic, no testimonial (see the TIER_BENEFIT rule above). */
    var sub = isPaid ? "You\u2019re a Pro member." : "";
    // The CTA is LAST in the DOM so position:sticky pins it to the bottom of the scrolling sheet.
    _root.querySelector("#proPay > div").innerHTML = (_plans && _plans.tiers ? hero(sub) : header("")) + body + (ios ? "" : redeemBlock()) + (_plans && _plans.tiers ? ctaBlock() : "");   // coupon hidden on iOS
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
        if (k === "showall") { _showAll = true; return paint(); }
        if (k === "signin") { try { if (window.SMD_signInWithGoogle) SMD_signInWithGoogle(); } catch (e) {} return; }
        if (k === "buy") return doBuy({ tier: _tier, cycle: _cycle }, b);
        if (k === "buy-addon") return doBuy({ addon: b.getAttribute("data-addon") }, b);
        if (k === "token") return doBuy({ pack: b.getAttribute("data-pack") }, b);
        if (k === "qpack") return doBuy({ quotaPack: b.getAttribute("data-qpack") }, b);
        if (k === "msgtier") return doBuy({ msgTier: b.getAttribute("data-msgtier") }, b);
        if (k === "redeem") return redeem();
        if (k === "restore") {
          b.disabled = true;
          return SMD_IAP.restore().then(function () { toast("Purchases restored."); try { if (window.SMD_PRO && SMD_PRO.sync) SMD_PRO.sync(); } catch (e) {} refresh(); },
            function () { b.disabled = false; toast("No purchase to restore on this Apple ID."); });
        }
        if (k === "ailimit-upgrade") { close(); return openPaywall(); }
      };
    });
    r.addEventListener("click", function (e) { if (e.target === r.firstChild) close(); }, { once: true });
  }

  // Razorpay Checkout.js — loaded once, lazily (only when a non-iOS purchase is actually attempted).
  var _rzpReady = null;
  function loadRazorpay() {
    if (_rzpReady) return _rzpReady;
    _rzpReady = new Promise(function (resolve, reject) {
      if (window.Razorpay) return resolve();
      var s = document.createElement("script");
      s.src = "https://checkout.razorpay.com/v1/checkout.js";
      s.onload = function () { resolve(); };
      s.onerror = function () { _rzpReady = null; reject(new Error("razorpay-script-failed")); };
      document.head.appendChild(s);
    });
    return _rzpReady;
  }
  // Poll /api/billing/status briefly after a successful checkout — grantPro happens server-side from
  // Razorpay's webhook (not the client success callback), which can lag a few seconds behind the modal.
  function pollProUntilActive(tries) {
    tries = tries == null ? 8 : tries;
    return refresh().then(function (st) {
      if ((st && st.pro) || tries <= 0) return st;
      return new Promise(function (r) { setTimeout(r, 1500); }).then(function () { return pollProUntilActive(tries - 1); });
    });
  }
  // Route a purchase: iOS -> StoreKit via SMD_IAP (Session A's plugin); web/Android -> Razorpay Standard Checkout.
  /* The Trainee plan needs a reviewed account (audit finding 12): registration-verified, a student/intern
   * approved by the owner (traineeVerified), or in manual review. Checked BEFORE any store sheet opens,
   * because an App Store purchase cannot be refused after the money moves. The server refuses web
   * orders the same way (functions/api/billing traineeGate). */
  function traineeReady() {
    var u = fbUser();
    if (!u || typeof u.getIdTokenResult !== "function") return Promise.resolve(true);   // fail-open; server still checks web
    /* Ask the app's ONE verification answer first (verify.js isReviewed: registered doctor OR
     * approved student/intern, with the server consulted when the token is stale). This used to
     * read the cached token claim on its own, which lags an approval by up to an hour, so a doctor
     * verified minutes earlier was sent back to "verify your college ID". */
    var V = window.SMD_VERIFY;
    var reviewed = (V && typeof V.isReviewed === "function") ? V.isReviewed().catch(function () { return false; }) : Promise.resolve(false);
    return reviewed.then(function (ok) {
      if (ok) return true;
      return u.getIdTokenResult().then(function (r) {
        var c = (r && r.claims) || {};
        return c.verified === true || c.traineeVerified === true || (+c.provUntil || 0) > Date.now();
      }, function () { return true; });
    });
  }
  var TRAINEE_VERIFY_MSG = "The Trainee plan is for verified students, interns and residents. Verify your college ID first, then choose the plan.";
  function doBuy(body, btn) {
    if (!fbUser()) { try { if (window.SMD_signInWithGoogle) SMD_signInWithGoogle(); } catch (e) {} return; }
    if (body && body.tier === "student" && !body._traineeChecked) {
      traineeReady().then(function (ok) {
        if (ok) return doBuy(Object.assign({}, body, { _traineeChecked: true }), btn);
        toast(TRAINEE_VERIFY_MSG);
        try { if (window.SMD_VERIFY && SMD_VERIFY.openPanel) { close(); SMD_VERIFY.openPanel(); } } catch (e) {}
      });
      return;
    }
    if (body && body._traineeChecked) { body = Object.assign({}, body); delete body._traineeChecked; }
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
    loadRazorpay()
      .then(function () { return api("/api/billing/razorpay/order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); })
      .then(function (x) {
        if (x.s !== 200 || !x.d || !x.d.orderId) {
          if (btn) btn.disabled = false;
          toast(x.d && x.d.error === "razorpay-not-configured" ? "Payments aren’t switched on yet." : (x.d && x.d.error === "signin-required" ? "Sign in first." : (x.d && x.d.error === "verify-first" ? TRAINEE_VERIFY_MSG : "Couldn’t start checkout. Try again.")));
          return;
        }
        var o = x.d;
        var rzp = new Razorpay({
          key: o.keyId, amount: o.amount, currency: o.currency, order_id: o.orderId,
          name: "StewardMD", description: o.label || "StewardMD Pro",
          theme: { color: "#0e6e63" },
          handler: function () { toast("Payment received. Activating…"); pollProUntilActive().then(function () { if (btn) btn.disabled = false; }); },
          modal: { ondismiss: function () { if (btn) btn.disabled = false; } },
        });
        rzp.on("payment.failed", function () { if (btn) btn.disabled = false; toast("Payment failed. Try again."); });
        rzp.open();
      })
      .catch(function () { if (btn) btn.disabled = false; toast("Network error. Try again."); });
  }

  function loadAndPaint() {
    Promise.all([
      api("/api/billing/status").then(function (x) { return x.d || {}; }, function () { return {}; }),
      fetch(apiUrl("/api/billing/plans")).then(function (r) { return r.json(); }, function () { return {}; }),
    ]).then(function (res) { _status = res[0]; _plans = (res[1] && res[1].plans) || null; if (_root) paint(); });
  }

  function noticeReason() {
    try { var N = window.SMD_PRO_NOTICE; return (N && N.reason) ? N.reason() : null; } catch (e) { return null; }
  }
  function openPaywall(feature, fresh) {
    if (_root) return;
    /* Never sell a subscription to someone whose problem is verification. An unverified doctor who
     * pays here gets nothing they would not have got free by uploading a certificate, so hand them
     * to the explainer instead. SMD_PRO_NOTICE routes them onward and never bounces back here for
     * this reason, so there is no loop.
     *
     * DECIDE ON A FRESH VERDICT (reported 2026-09-02). The reason comes from the /api/billing/status
     * payload account.js cached at sign-in. A doctor who verified DURING this session still had the
     * pre-verification verdict cached, so tapping Subscription told them to verify again - while the
     * header badge, which reads the claim, already said Pro. Opening the paywall is a rare,
     * user-initiated tap, so one status round trip before bouncing is cheap and ends the lie. The
     * second pass (`fresh`) never re-syncs, so a still-unverified account is shown the explainer
     * exactly once and nothing loops. */
    var r = noticeReason();
    if (r === "unverified" || r === "pending") {
      if (!fresh && window.SMD_PRO && typeof window.SMD_PRO.sync === "function") {
        var again = function () { openPaywall(feature, true); };
        try { window.SMD_PRO.sync().then(again, again); } catch (e) { again(); }
        return;
      }
      try { window.SMD_PRO_NOTICE.show(feature); } catch (e) {}
      return;
    }
    var div = document.createElement("div");
    div.innerHTML = shell(header("") + '<div style="padding:40px;text-align:center;color:var(--slate-soft);font:500 13px var(--pp-f)">Loading…</div>');
    _root = div.firstChild; document.body.appendChild(_root); document.body.style.overflow = "hidden";
    _root.querySelector('[data-pp="close"]').onclick = close;
    loadAndPaint();
  }

  // "AI limit hit" sheet — shown when an AI call returns 429 { reason:"ai-cost-cap" }. Offers the
  // daily-reset time, current credit balance, and a route to upgrade / add credits.
  /* Top-up sheet for the per-patient quota meters. Opened straight off a server 402
   * { error:"quota-exhausted", feature, packs, copy } — it needs no /plans fetch, so it works the
   * moment a refusal lands. ADDITIVE: nothing else in this file reads it. */
  function openTopUp(info) {
    info = info || {}; close();
    var c = info.copy || {}, packs = info.packs || [];
    var title = info.feature === "scribe" ? "MaiK Voice Scribe consults" : info.feature === "msg" ? "Clinic Messaging" : info.feature === "dict" ? "Dictation credits" : "Patient credits";
    var unitWord = info.feature === "scribe" ? "consults" : info.feature === "dict" ? "credits" : "patients";
    var lines = (c.lines || []).map(function (t) {
      return '<div style="font:500 13px/1.6 var(--pp-f);color:var(--slate,#2d4356);margin-top:4px">' + esc(t) + '</div>';
    }).join("");
    /* ANTI-STEERING: on iOS the store price is the ONLY price that may appear, and no stewardmd.in
     * purchase link may appear at all. Not a style choice - in the India storefront a "cheaper on the
     * web" hint is a straight App Store rejection, and this app is mid-submission. The outbound
     * SMS/WhatsApp/email nudge is permitted (Apple's 2021 anti-steering settlement) and lives
     * server-side in functions/_quota.js webUpsellSms(), which never ships in the app bundle. */
    var webOk = plat() !== "ios";
    /* One everyday-spend comparison per price (owner-approved). The server owns the map in
     * functions/_quota.js COMPARE, keyed by pack / tier, so there is exactly one place to edit it and
     * a price with no line renders nothing rather than getting one invented for it here. */
    var cmp = function (t) {
      return t ? '<div data-pp-compare="1" style="margin-top:5px;font:500 9.5px/1.35 var(--pp-f);color:var(--slate-soft)">' + esc(t) + '</div>' : '';
    };
    /* Clinic Messaging subscriptions. Same anti-steering gate as the packs: on iOS the store price is
     * the only price that may render, and no stewardmd.in link may render at all. */
    var tiers = (info.tiers || []).map(function (t) {
      var web = webOk && t.webAmount > 0 && t.webAmount < t.amount ? t.webAmount : 0;
      return '<button data-pp="msgtier" data-msgtier="' + esc(t.key) + '" style="width:100%;text-align:left;border:2px solid ' + (t.popular ? "var(--teal,#0e6e63)" : "var(--line,#d7dee3)") + ';border-radius:12px;padding:11px 13px;background:var(--panel,#fff);cursor:pointer;margin-top:8px">' +
        '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px">' +
        '<div style="font:800 14px var(--pp-f);color:var(--ink)">' + esc(t.label) + '</div>' +
        '<div style="font:800 14px var(--pp-f);color:var(--teal,#0e6e63)">' + inr(web || t.amount) + '<span style="font:600 10px var(--pp-f);color:var(--slate-soft)"> a month</span></div>' +
        '</div>' +
        '<div style="margin-top:3px;font:500 11.5px/1.45 var(--pp-f);color:var(--slate,#2d4356)">' + esc(t.units) + ' patients a month. ' + esc(t.line || "") + '</div>' +
        cmp(t.compare) +
        '</button>';
    }).join("");
    var cards = packs.map(function (p) {
      var web = webOk && p.webAmount > 0 && p.webAmount < p.amount ? p.webAmount : 0;
      return '<button data-pp="qpack" data-qpack="' + esc(p.key) + '" style="flex:1;text-align:left;border:2px solid ' + (p.popular ? "var(--teal,#0e6e63)" : "var(--line,#d7dee3)") + ';border-radius:12px;padding:11px;background:var(--panel,#fff);cursor:pointer">' +
        '<div style="font:800 17px var(--pp-f);color:var(--ink)">' + esc(p.units) + '</div>' +
        '<div style="font:500 9.5px var(--pp-f);color:var(--slate-soft)">' + unitWord + '</div>' +
        '<div style="margin-top:6px;font:800 13px var(--pp-f);color:var(--teal,#0e6e63)">' + inr(web || p.amount) + '</div>' +
        (p.perUnit > 0 ? '<div style="font:500 9.5px var(--pp-f);color:var(--slate-soft)">' + esc("₹" + (web ? Math.round(web / 100 / p.units) : p.perUnit)) + ' each</div>' : '') +
        cmp(p.compare) +
        '</button>';
    }).join("");
    var inner = header(title) +
      (c.alert ? '<div style="padding:6px 18px 0"><div style="padding:11px 13px;border-radius:12px;background:var(--amber-bg,#fff4e0);border:1px solid var(--amber-line,#f0d090);font:700 12.5px/1.5 var(--pp-f);color:var(--ink)">' + esc(c.alert) + '</div></div>' : '') +
      '<div style="padding:6px 18px 2px"><div style="font:800 17px/1.4 var(--pp-f);color:var(--ink)">' + esc(c.headline || "") + '</div>' + lines + '</div>' +
      (c.price ? '<div style="padding:10px 18px 2px"><div style="padding:11px 13px;border-radius:12px;background:var(--teal-soft,#e3f1ee);border:1px solid var(--teal,#0e6e63);font:700 13px/1.5 var(--pp-f);color:var(--teal,#0e6e63)">' + esc(c.price) + '</div></div>' : '') +
      (tiers ? '<div style="padding:8px 18px 2px">' + tiers + '</div>' : '') +
      (cards ? '<div style="padding:12px 18px 2px;display:flex;gap:8px">' + cards + '</div>' : '') +
      '<div style="padding:10px 18px 22px;font:500 11.5px/1.5 var(--pp-f);color:var(--slate-soft);text-align:center">' + esc(c.expiry || "") + '</div>';
    var div = document.createElement("div");
    div.innerHTML = shell(inner);
    _root = div.firstChild; document.body.appendChild(_root); document.body.style.overflow = "hidden";
    wire();
  }

  function openAiLimit(info) {
    info = info || {}; close();
    var reset = info.resetAt ? new Date(+info.resetAt) : null;
    var resetTxt = reset ? reset.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "midnight";
    // The server sends the balance in MaiK Tokens (creditsMt); the ₹ fallback is for an older payload.
    var mt = (typeof info.creditsMt === "number") ? info.creditsMt : ((typeof info.credits === "number") ? Math.round(info.credits * 2000) : null);
    var msg = info.message || "You've used today's MaiK Tokens.";
    var inner = header("Today's MaiK Tokens are used up") +
      '<div style="padding:6px 18px 4px"><div style="padding:13px 14px;border-radius:12px;background:var(--amber-bg,#fff4e0);border:1px solid var(--amber-line,#f0d090);font:600 13px/1.6 var(--pp-f);color:var(--ink)">' + ppIcoPx("bell", 16) + ' ' + esc(msg) + '</div></div>' +
      '<div style="padding:8px 18px 2px;font:500 12.5px/1.6 var(--pp-f);color:var(--slate-soft)">Your allowance resets at <b>' + esc(resetTxt) + '</b>.' + (mt != null ? ' MaiK Token balance: <b>' + esc(mt.toLocaleString("en-IN")) + '</b>.' : '') + '</div>' +
      '<div style="padding:14px 18px 22px"><button data-pp="ailimit-upgrade" style="width:100%;padding:14px;border:none;border-radius:13px;background:var(--teal,#0e6e63);color:#fff;font:800 15px var(--pp-f);cursor:pointer">Add MaiK Tokens or upgrade</button>' +
      '<div style="font:500 11.5px/1.5 var(--pp-f);color:var(--slate-soft);text-align:center;margin-top:8px">Or wait for the daily reset. No charge.</div></div>';
    var div = document.createElement("div");
    div.innerHTML = shell(inner);
    _root = div.firstChild; document.body.appendChild(_root); document.body.style.overflow = "hidden";
    wire();
  }

  // Force a token refresh so isPro() picks up a just-granted `pro` claim, then re-check status.
  function refresh() { return token(true).then(function () { return api("/api/billing/status").then(function (x) { _status = x.d || {}; if (_root) paint(); return _status; }); }); }

  function attach() { if (!window.SMD_PRO) return setTimeout(attach, 300); window.SMD_PRO.openPaywall = openPaywall; window.SMD_PRO.openAiLimit = openAiLimit; window.SMD_PRO.openTopUp = openTopUp; window.SMD_PRO.refresh = refresh; window.SMD_PRO.buy = doBuy; }
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
          /* The OPD queue never 402s - running out of Clinic Messaging must not block the queue - so
           * it reports a spent allowance as `msgQuota` on an ordinary 200 and the sheet opens off that. */
          if (url.indexOf("/api/queue/") > -1) {
            return p.then(function (r) {
              if (r && r.status === 200) { try { r.clone().json().then(function (d) { if (d && d.msgQuota && d.msgQuota.error === "quota-exhausted") openTopUp(d.msgQuota); }, function () {}); } catch (e) {} }
              return r;
            });
          }
          if (url.indexOf("/api/ai/") > -1 || url.indexOf("/api/followcare/") > -1) {
            return p.then(function (r) {
              if (r && r.status === 429) { try { r.clone().json().then(function (d) { if (d && d.reason === "ai-cost-cap") openAiLimit(d); }, function () {}); } catch (e) {} }
              // Per-patient quota meters: a 402 quota-exhausted opens the top-up sheet.
              if (r && r.status === 402) { try { r.clone().json().then(function (d) { if (d && d.error === "quota-exhausted") openTopUp(d); }, function () {}); } catch (e) {} }
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
        refresh().then(function (s) { if ((s && s.pro && !s.promo) || tries >= 8) { clearInterval(iv); if (s && s.pro && !s.promo) toast("Pro activated. Thank you!"); } });
      }, 2500);
      try { history.replaceState(null, "", location.pathname); } catch (e) {}
    }, 700);
  }
})();
