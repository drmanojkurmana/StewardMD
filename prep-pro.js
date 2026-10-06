/* PrepNucleus Pro: the free "taste" tier gates, the limit sheet and the pricing screen. window.PrepPro. ES5.
   Decision: vault/decisions/Decisions.md "PrepNucleus pricing, free tier and social" (2026-10-06).

   Flag smd_prep_pro_enforce, default OFF (owner: enforce only after a real payment test). localStorage
   smd_prep_pro_enforce = "1" or ?prepenforce=1 turns it on, "0" off. Off: can() is always true; the only visible change
   is the "PrepNucleus Pro" row on the home screen. On and not Pro: CFG below a local day; the daily sprint (Arena runs,
   which never reach the runner's gate) stays free, and the first CFG.open modules of each subject (taxonomy order) are
   fully open. Your own deck questions (_s "deck") are never counted. Pro unlocks all.

   Gates are checked at the START of a question set, lesson or card batch (prep.js, prep-flash.js hooks); use() only
   counts, so a set already started always finishes. ALL gate logic is in can().
   Server (functions/api/entitlements): GET /api/entitlements -> prepPro {active, until, source};
   GET /api/entitlements/prep-quote?plan=year (one plan: first year, then the list price on renewal); POST /api/entitlements/prep-referral {code};
   GET /api/entitlements/prep-offer; POST /api/entitlements/prep-offer/dismiss. Refunds: POST /api/support, else email. Any of them may 404: the screen falls
   back to the base prices and hides what it cannot show. Checkout is pro-paywall.js SMD_PRO.buy (Razorpay on web and
   Android, StoreKit on iOS) with the quote's productId; the client never sends a price. Pure helpers load under node. */
(function (G) {
  "use strict";

  /* ================= pure ================= */
  var CFG = { questions: 50, lessons: 1, cards: 10, open: 2 };
  // Fallback display only (published prices); the quote is the truth and checkout never sends a price.
  var PLAN = { id: "prep_pro_year", listPaise: 599900 };
  var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function dayKey(ms) { var d = new Date(ms); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  // "Thu 8 Oct, 4:30 pm" in local time: the real expiry, never a ticking countdown.
  function fmtWhen(ms) { var d = new Date(ms), h = d.getHours(); return DAYS[d.getDay()] + " " + d.getDate() + " " + MONTHS[d.getMonth()] + ", " + (h % 12 || 12) + ":" + pad(d.getMinutes()) + " " + (h < 12 ? "am" : "pm"); }
  function fmtDate(ms) { var d = new Date(ms); return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear(); }
  function rs(paise) { var n = Math.round((+paise || 0) / 100); var s = String(n), out = s.slice(-3), rest = s.slice(0, -3); while (rest.length > 2) { out = rest.slice(-2) + "," + out; rest = rest.slice(0, -2); } return "Rs " + (rest ? rest + "," + out : out); }
  // The open modules: the first n of each subject in taxonomy order (sections, then modules), as an id -> 1 map.
  function openSet(tax, n) {
    var out = {};
    ((tax && tax.branches) || []).forEach(function (b) { (b.subjects || []).forEach(function (s) {
      var k = 0; (s.sections || []).forEach(function (sec) { (sec.modules || []).forEach(function (m) { if (k < n) { out[m.id] = 1; k++; } }); });
    }); });
    return out;
  }
  // Bank modules a set draws from; deck items are the student's own and never count.
  function modulesOf(ctx) {
    if (!ctx) return [];
    if (ctx.module) return [ctx.module];
    var seen = {}, out = [];
    (ctx.items || []).forEach(function (it) { if (!it || it._s === "deck") return; var m = it._m || it.t || "?"; if (!seen[m]) { seen[m] = 1; out.push(m); } });
    return out;
  }
  function freshDay(c, day) { return c && c.d === day ? c : { d: day, questions: 0, cards: 0, lessons: {} }; }
  function used(c, feature) { return feature === "lessons" ? Object.keys(c.lessons || {}).length : c[feature] || 0; }
  /* The gate. state = { enforce, pro, open, day, counts }. True when: enforcement is off, Pro is active, the feature is
     the sprint, every module the set touches is open, a set of only the student's own deck items, a lesson already
     opened today, or the day's count is under the limit. */
  function gate(feature, ctx, state) {
    if (!state.enforce || state.pro || feature === "sprint") return true;
    var c = freshDay(state.counts, state.day), mods = modulesOf(ctx);
    if (ctx && ctx.items && !mods.length) return true;
    if (mods.length && mods.every(function (m) { return state.open[m]; })) return true;
    if (feature === "lessons" && ctx && ctx.module && c.lessons[ctx.module]) return true;
    return used(c, feature) < (CFG[feature] == null ? Infinity : CFG[feature]);
  }
  // Counts one use: a question or card outside the open modules, a lesson by module (reopening the same one is free).
  function count(feature, ctx, state) {
    var c = freshDay(state.counts, state.day), mods = modulesOf(ctx);
    if (!mods.length || mods.every(function (m) { return state.open[m]; })) return c;
    if (feature === "lessons") c.lessons[mods[0]] = 1;
    else if (feature === "questions" || feature === "cards") c[feature] += ctx.items ? ctx.items.filter(function (it) { return it && it._s !== "deck" && !state.open[it._m || it.t]; }).length : 1;
    return c;
  }
  /* What the plan card shows, from the server quote only (owner, 2026-10-06): the first-year price, the list price
     struck through only when the first year is below it (the list price is the real renewal price), the quote's own
     percent, reason and dates, and the renewal price. No quote (offline, endpoint missing): the list price, nothing off. */
  var REASONS = { intro: "Introductory price", student: "Student price", launch: "Launch price", winback: "One time price" };
  /* store: checkout is store IAP (iOS), which charges its own price (the intro offer set in App Store Connect) and
     cannot apply a per-user student or win-back price. So on that path a student / win-back quote shows the store
     price (quote.storeFirstYearPaise: launch or intro first year, else list) with no percent (the quote's percent is
     for the other price). No "cheaper on the website" line: the India storefront rejects any steering (pro-paywall.js
     ANTI-STEERING). */
  function quoteView(q, store) {
    q = q || {};
    if (store && (q.priceReason === "student" || q.priceReason === "winback")) {
      var l0 = q.listPaise || PLAN.listPaise, f0 = q.storeFirstYearPaise != null ? q.storeFirstYearPaise : l0;
      return quoteView({ listPaise: l0, renewalPaise: q.renewalPaise, firstYearPaise: f0, launchEndsAt: q.launchEndsAt,
        priceReason: f0 >= l0 || q.firstYear === false ? "renewal" : q.launchEndsAt ? "launch" : "intro" });
    }
    var list = q.listPaise || PLAN.listPaise, first = q.firstYearPaise != null ? q.firstYearPaise : list, renew = q.renewalPaise || list, below = first < list && q.priceReason !== "renewal";
    return { price: rs(first), per: below ? "first year" : "a year", strike: below ? rs(list) : "",
      reason: below ? (REASONS[q.priceReason] || "") + (q.priceReason === "launch" && q.launchEndsAt ? " until " + fmtDate(q.launchEndsAt) : "") : "",
      off: below ? (q.offPct ? q.offPct + "% off " + rs(list) + ", then " : "Then ") + rs(renew) + "/year" : "" };
  }
  // The "verify for the student price" line: only off the store path, only when the server's student price would
  // actually beat the current first-year price (20% off list loses to the Rs 1,499 launch price). No quote: hidden.
  function studentOffer(q, store) { return !!(!store && q && !q.studentVerified && q.studentPaise > 0 && q.firstYearPaise != null && q.studentPaise < q.firstYearPaise); }
  // The cancel line before buying, by checkout path: store subscriptions auto-renew and cancel in the store;
  // Razorpay sells a one-time year, so there is nothing to cancel.
  var STORE_SUBS = "https://apps.apple.com/account/subscriptions";
  function buyCancelView(store) { return store ? { kind: "store", text: "Cancel anytime in your App Store subscriptions.", url: STORE_SUBS } : cancelView({}); }
  /* The cancel line for a Pro entitlement { active, until, source, autoRenews, manageUrl }: a store subscription opens
     its manage page (manageUrl); a one-time purchase (Razorpay orders) says truthfully that it does not renew. */
  function cancelView(e) {
    e = e || {};
    if (!e.autoRenews) return { kind: "none", text: "Cancel anytime: no auto-renewal, you choose whether to renew." };
    if (e.manageUrl) return { kind: "store", text: "Cancel anytime from your store subscriptions.", url: e.manageUrl };
    return { kind: "none", text: "Cancel anytime from your store subscriptions." };
  }
  function offerText(o) {
    if (!o || o.finalPaise == null || !o.expiresAt) return null;
    var list = o.listPaise || o.basePaise, pct = o.offPct || (o.listPaise && o.listPaise > o.finalPaise ? Math.round((1 - o.finalPaise / o.listPaise) * 100) : 0);
    return { line: rs(o.finalPaise) + " for your first year (then " + rs(list) + " a year). One time offer, valid until " + fmtWhen(o.expiresAt) + ".",
      price: rs(o.finalPaise), then: "Then " + rs(list) + " a year. One time offer, valid until " + fmtWhen(o.expiresAt) + ".",
      // Name each baseline: the percent is off the list price, the saving (server) is off the first-year price walked away from.
      off: pct ? pct + "% off " + rs(list) : "", save: o.saveRupees ? "Save " + rs(o.saveRupees * 100) + (o.basePaise && o.basePaise < list ? " on " + rs(o.basePaise) : "") : "" };
  }
  var PURE = { CFG: CFG, PLAN: PLAN, dayKey: dayKey, fmtWhen: fmtWhen, rs: rs, openSet: openSet, modulesOf: modulesOf, freshDay: freshDay, used: used, gate: gate, count: count, quoteView: quoteView, cancelView: cancelView, buyCancelView: buyCancelView, studentOffer: studentOffer, offerText: offerText };
  if (typeof module !== "undefined" && module.exports && !(G && G.document)) { module.exports = PURE; return; }

  /* ================= browser ================= */
  var D = G.document, KEY_DAY = "smd_prep_pro_day", KEY_ENT = "smd_prep_pro", FLAG = "smd_prep_pro_enforce";
  var P = { quote: null, offer: null, ent: null, sheet: null, prevFocus: null, msg: "" };

  function ls(k, v) { try { if (v === undefined) return G.localStorage.getItem(k); G.localStorage.setItem(k, v); } catch (e) {} return null; }
  function enforce() {
    try { var q = (G.location.search.match(/[?&]prepenforce=([^&]+)/) || [])[1]; if (q != null) return q === "1" || q === "on" || q === "true"; } catch (e) {}
    return ls(FLAG) === "1";
  }
  function ent() { if (!P.ent) { try { P.ent = JSON.parse(ls(KEY_ENT) || "null"); } catch (e) { P.ent = null; } } return P.ent || {}; }
  function isPro() { var e = ent(); return !!e.active && (!e.until || e.until > Date.now()); }
  function counts() { try { return JSON.parse(ls(KEY_DAY) || "null"); } catch (e) { return null; } }
  function host() { return G.PREP && G.PREP._host; }
  function tax() { var p = G.PREP && G.PREP._st; return p && p.tax; }
  var openCache = { tax: null, set: {} };
  function open() { var t = tax(); if (t !== openCache.tax) { openCache = { tax: t, set: openSet(t, CFG.open) }; } return openCache.set; }
  function state() { return { enforce: enforce(), pro: isPro(), open: open(), day: dayKey(Date.now()), counts: counts() }; }

  function can(feature, ctx) { try { return gate(feature, ctx, state()); } catch (e) { return true; } }
  function use(feature, ctx) { var s = state(); if (!s.enforce || s.pro) return; ls(KEY_DAY, JSON.stringify(count(feature, ctx, s))); }
  function status() {
    var s = state(), c = freshDay(s.counts, s.day);
    return { enforce: s.enforce, pro: s.pro, until: ent().until || null, used: { questions: c.questions, lessons: used(c, "lessons"), cards: c.cards }, limits: { questions: CFG.questions, lessons: CFG.lessons, cards: CFG.cards } };
  }

  /* ---------- server ---------- */
  function api(method, path, body) {
    var u = G.SMD_AUTH && G.SMD_AUTH.currentUser;
    return (u && u.getIdToken ? u.getIdToken() : Promise.resolve(null)).then(function (tok) {
      var h = { "Content-Type": "application/json" }; if (tok) h.Authorization = "Bearer " + tok;
      return G.fetch((G.SMD_API_BASE || "") + "/api/entitlements" + path, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined });
    }).then(function (r) { return r.json().then(function (d) { return { s: r.status, d: d || {} }; }, function () { return { s: r.status, d: {} }; }); });
  }
  // pro-paywall.js doBuy sends iOS purchases to StoreKit (SMD_IAP); web and Android go through Razorpay.
  function storePath() { try { return !!(G.SMD_IAP && G.SMD_IAP.isIOS && G.SMD_IAP.isIOS()); } catch (e) { return false; } }
  function signedIn() { return !!(G.SMD_AUTH && G.SMD_AUTH.currentUser); }
  function refreshEnt() {
    if (!signedIn()) return Promise.resolve(ent());
    return api("GET", "").then(function (x) {
      if (x.s === 200 && x.d.prepPro) { var pp = x.d.prepPro; P.ent = { active: !!pp.active, until: pp.until || null, source: pp.source || null, autoRenews: !!pp.autoRenews, manageUrl: /^https:\/\//.test(pp.manageUrl || "") ? pp.manageUrl : null, ts: Date.now() }; ls(KEY_ENT, JSON.stringify(P.ent)); }
      return ent();
    }, function () { return ent(); });
  }
  function loadQuotes() {
    return api("GET", "/prep-quote?plan=year").then(function (x) { P.quote = x.s === 200 && x.d.firstYearPaise != null ? x.d : null; }, function () {});
  }
  function loadOffer() {
    // Never on the store path: the first GET starts the one-time 48 h window, and the card is not shown there.
    if (!signedIn() || storePath()) return Promise.resolve(null);
    return api("GET", "/prep-offer").then(function (x) { P.offer = x.s === 200 && x.d.offer && offerText(x.d.offer) ? x.d.offer : null; return P.offer; }, function () { return null; });
  }

  /* ---------- markup ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var STAR = '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>';
  function star() { return '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + STAR + "</svg>"; }
  // Home: the pricing row (always) and the win-back card when the server offers one (filled after the fetch).
  function homeHtml(H) {
    var sub = isPro() ? "Active" + (ent().until ? " until " + fmtDate(ent().until) : "") : "Plans, free tier and refunds";
    return '<div id="ppOfferSlot"></div><div class="pn-group">' + H.row("pro-open", star(), "PrepNucleus Pro", esc(sub)) + "</div>";
  }
  function homeMounted() { if (isPro()) return; loadOffer().then(function () { var el = D.querySelector("#ppOfferSlot"); if (el) el.innerHTML = offerHtml(); }); }
  function offerHtml() {
    var t = offerText(P.offer); if (!t || isPro() || storePath()) return "";   // the store cannot charge the offer price yet
    return '<section class="pn-panel pp-offer" aria-labelledby="ppOfferT"><h2 class="pp-price" id="ppOfferT"><b>' + t.price + "</b> <span>first year</span></h2>" +
      '<p class="pp-offer-line">' + esc(t.then) + "</p>" +
      (t.off || t.save ? '<p class="pp-save">' + esc([t.off, t.save].filter(Boolean).join(" \u00b7 ")) + "</p>" : "") +
      '<p class="pn-mut pn-small pp-cancel">' + esc(buyCancelView(false).text) + "</p>" +
      '<div class="pn-navrow"><button type="button" class="pn-btn" data-act="pro-odismiss">Dismiss</button><button type="button" class="pn-btn pri" data-act="pro-obuy">Get this price</button></div></section>';
  }
  function planHtml() {
    var store = storePath(), v = quoteView(P.quote, store), c = buyCancelView(store);
    return '<section class="pn-panel pp-plan" aria-labelledby="ppPlanT"><h2 class="pp-price" id="ppPlanT"><b>' + v.price + "</b> <span>" + v.per + "</span>" + (v.strike ? ' <s class="pp-strike" aria-label="List price ' + v.strike + '">' + v.strike + "</s>" : "") + "</h2>" +
      (v.reason ? '<p class="pp-why">' + esc(v.reason) + "</p>" : "") + (v.off ? '<p class="pp-save">' + esc(v.off) + "</p>" : "") +
      '<button type="button" class="pn-btn pri" data-act="pro-buy">Get PrepNucleus Pro</button>' +
      (c.url ? '<a class="pn-link pp-start pp-cancel" href="' + esc(c.url) + '" target="_blank" rel="noopener">' + esc(c.text) + "</a>" : '<p class="pn-mut pn-small pp-cancel">' + esc(c.text) + "</p>") + "</section>";
  }
  function manageHtml() {
    var e = ent(), c = cancelView(e);
    return '<section class="pn-panel pp-manage" aria-labelledby="ppManT"><h2 class="pp-offer-line pp-h" id="ppManT">PrepNucleus Pro is active' + (e.until ? ' until <span class="pp-nw">' + esc(fmtDate(e.until)) + "</span>" : "") + ".</h2>" +
      '<p class="pn-mut pn-small" id="ppCancelMsg" aria-live="polite">' + esc(c.text) + "</p>" +
      (c.kind === "store" ? '<button type="button" class="pn-btn" data-act="pro-manage">Manage or cancel subscription</button>' : "") + "</section>";
  }
  var ROWS = [["Questions a day", "50", "No limit"], ["Lessons a day", "1", "No limit"], ["Flashcards a day", "10", "No limit"], ["Daily sprint", "Yes", "Yes"], ["Modules", "2 per subject", "All"]];
  function renderPricing(H) {
    var pro = isPro();
    var ios = G.SMD_IAP && G.SMD_IAP.available && G.SMD_IAP.available();
    H.paint(H.bar("PrepNucleus Pro", pro ? "Active" : "", "back") + '<div class="pn-body pp-body" id="ppPricing">' +
      (pro ? manageHtml() : offerHtml() + planHtml() +
        (!studentOffer(P.quote, storePath()) ? "" : '<p class="pn-mut pn-small pp-line">Students: verify your college ID for the student price. <button type="button" class="pn-link pp-inl" data-act="pro-verify">Verify</button></p>')) +
      '<h2 class="pn-sec">Free and Pro</h2><table class="pp-cmp"><thead><tr><th scope="col"><span class="pp-sr">Feature</span></th><th scope="col">Free</th><th scope="col">Pro</th></tr></thead><tbody>' +
      ROWS.map(function (r) { return '<tr><th scope="row">' + r[0] + "</th><td>" + r[1] + "</td><td>" + r[2] + "</td></tr>"; }).join("") + "</tbody></table>" +
      (pro ? "" : '<h2 class="pn-sec">Referred by a friend?</h2><label class="pn-sl" for="ppRef"><span class="pn-mut pn-small">Their StewardMD ID (optional)</span>' +
        '<span class="pp-refrow"><input id="ppRef" name="referral" class="pn-in" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="done">' +
        '<button type="button" class="pn-btn sm" data-act="pro-ref">Apply</button></span></label><p class="pn-mut pn-small" id="ppRefMsg" aria-live="polite">' + esc(P.msg) + "</p>") +
      '<section class="pn-panel pp-refund"><p><b>7-day full refund.</b> Not for you? Ask within 7 days of paying and you get all of it back.</p>' +
      '<button type="button" class="pn-link pp-start" data-act="pro-refund">Request refund</button>' +
      (ios ? '<button type="button" class="pn-link pp-start" data-act="pro-restore">Restore purchases</button>' : "") + "</section>" +
      (pro ? "" : '<p class="pn-mut pn-small">Your free questions, lesson and cards reset every night at midnight. The daily sprint is always free.</p>') + "</div>");
  }
  function openPricing() {
    var H = host(); if (!H) return false;
    closeSheet(true);
    H.push(function () { renderPricing(H); });
    Promise.all([refreshEnt(), loadQuotes(), loadOffer()]).then(function () { if (H.stackTop && H.root() && H.root().querySelector("#ppPricing")) renderPricing(H); });
    return true;
  }

  /* ---------- limit sheet ---------- */
  var WHAT = { questions: ["questions", "free questions"], lessons: ["lesson", "free lesson"], cards: ["cards", "free flashcards"] };
  function openLimit(feature) {
    var H = host(), root = H && H.root(); if (!root) return false;
    closeSheet(true);
    var st = status(), w = WHAT[feature] || WHAT.questions, n = st.limits[feature] || st.limits.questions, u = Math.min(st.used[feature] || 0, n);
    var el = D.createElement("div");
    el.className = "pn-sheet-wrap"; el.id = "ppSheet";
    el.innerHTML = '<div class="pn-scrim" data-act="pro-close"></div><section class="pn-sheet pp-sheet" role="dialog" aria-modal="true" aria-labelledby="ppSheetT" tabindex="-1">' +
      '<span class="pn-grab" aria-hidden="true"></span><h2 id="ppSheetT">You have used today’s ' + w[1] + "</h2>" +
      '<p class="pp-used"><b>' + u + " of " + n + "</b> " + w[0] + " used today</p>" +
      '<ul class="pp-list"><li><b>Still free today:</b> the daily sprint, and the first ' + CFG.open + " modules of every subject.</li>" +
      "<li><b>Tomorrow:</b> your free questions, lesson and cards reset at midnight.</li>" +
      "<li><b>With Pro:</b> every module, lesson and card, with no daily limit.</li></ul>" +
      '<div class="pn-sheet-act"><button type="button" class="pn-btn pri" data-act="pro-see">See Pro</button><button type="button" class="pn-btn" data-act="pro-close">Close</button></div></section>';
    P.prevFocus = D.activeElement;
    root.appendChild(el); P.sheet = el;
    el.addEventListener("keydown", trap);
    var f = el.querySelector("[data-act=pro-see]"); try { f.focus(); } catch (e) {}
    return true;
  }
  function trap(e) {
    if (e.key !== "Tab" || !P.sheet) return;
    var b = P.sheet.querySelectorAll("button"), first = b[0], last = b[b.length - 1];
    if (e.shiftKey && D.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && D.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  function closeSheet(quiet) {
    if (!P.sheet) return false;
    if (P.sheet.parentNode) P.sheet.parentNode.removeChild(P.sheet);
    P.sheet = null;
    if (!quiet) try { if (P.prevFocus && P.prevFocus.isConnected) P.prevFocus.focus(); } catch (e) {}
    return true;
  }
  // prep.js back() (and Escape) asks here first: an open sheet closes.
  function back() { return closeSheet(false); }

  /* ---------- actions ---------- */
  function toast(m) { var H = host(); if (H) H.toast(m); }
  function buy(productId, btn) {
    if (!signedIn()) { try { if (G.SMD_signInWithGoogle) return G.SMD_signInWithGoogle(); } catch (e) {} return toast("Sign in to StewardMD first."); }
    if (!(G.SMD_PRO && G.SMD_PRO.buy)) return toast("Payments did not load. Check the connection and try again.");
    G.SMD_PRO.buy({ productId: productId, prepPlan: "year" }, btn);
    // Activation lands server side (webhook or store verify): look again a few times.
    [5e3, 15e3, 40e3].forEach(function (t) { G.setTimeout(function () { refreshEnt(); }, t); });
  }
  // Refund request through the in-app support desk (POST /api/support); without sign-in or on failure, an email.
  function refund(btn) {
    var mail = function () { try { G.location.href = "mailto:support@stewardmd.in?subject=Refund%20request%20(PrepNucleus)"; } catch (e) {} };
    var u = G.SMD_AUTH && G.SMD_AUTH.currentUser; if (!u || !u.getIdToken) return mail();
    btn.disabled = true;
    u.getIdToken().then(function (tok) {
      return G.fetch((G.SMD_API_BASE || "") + "/api/support", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok },
        body: JSON.stringify({ action: "create", kind: "help", subject: "Refund request (PrepNucleus)", text: "Please refund my PrepNucleus Pro purchase under the 7-day full refund." }) });
    }).then(function (r) { btn.disabled = false; if (r.ok) toast("Refund request sent. The team replies by email."); else mail(); }, function () { btn.disabled = false; mail(); });
  }
  function act(a, b, H) {
    if (a === "pro-open" || a === "pro-see") { closeSheet(true); return openPricing(); }
    if (a === "pro-close") return closeSheet(false);
    if (a === "pro-buy") return buy((P.quote && P.quote.productId) || PLAN.id, b);
    if (a === "pro-obuy") return P.offer && buy(P.offer.productId || PLAN.id, b);
    if (a === "pro-odismiss") { P.offer = null; api("POST", "/prep-offer/dismiss").then(null, function () {}); D.querySelectorAll(".pp-offer").forEach(function (x) { x.parentNode.removeChild(x); }); return; }
    if (a === "pro-manage") { var mu = cancelView(ent()).url; if (mu) try { G.open(mu, "_blank"); } catch (e) {} return; }
    if (a === "pro-verify") { try { if (G.SMD_VERIFY && G.SMD_VERIFY.openPanel) return G.SMD_VERIFY.openPanel(); } catch (e) {} return toast("Verification opens from your StewardMD profile."); }
    if (a === "pro-refund") return refund(b);
    if (a === "pro-restore") {
      if (!(G.SMD_IAP && G.SMD_IAP.restore)) return;
      return G.SMD_IAP.restore().then(function () { toast("Purchases restored."); return refreshEnt().then(function () { renderPricing(H); }); }, function () { toast("No purchase to restore on this Apple ID."); });
    }
    if (a === "pro-ref") {
      var inp = D.querySelector("#ppRef"), code = String(inp && inp.value || "").trim();
      if (!code) { P.msg = "Type your friend's StewardMD ID first."; return renderMsg(); }
      if (!signedIn()) { P.msg = "Sign in to StewardMD to use a referral."; return renderMsg(); }
      return api("POST", "/prep-referral", { code: code }).then(function (x) {
        P.msg = x.s === 200 ? "Referral saved. Your friend gets credit when you subscribe." : x.s === 404 && !x.d.error ? "Referrals are not switched on yet." : "That ID did not work. Check it and try again.";
        renderMsg();
      }, function () { P.msg = "No connection. Try again."; renderMsg(); });
    }
  }
  function renderMsg() { var el = D.querySelector("#ppRefMsg"); if (el) el.textContent = P.msg; }

  if (signedIn()) G.setTimeout(refreshEnt, 0);
  G.PrepPro = { can: can, use: use, status: status, openPricing: openPricing, openLimit: openLimit, back: back, act: act, homeHtml: homeHtml, homeMounted: homeMounted, _pure: PURE, _p: P };
})(typeof window !== "undefined" ? window : this);
