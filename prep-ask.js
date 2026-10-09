/* PrepNucleus Ask MaiK: one sheet, on this phone or online. window.PREP_ASK. ES5.
   Plan: vault/plans/PrepNucleus-iPad-Confetti-MaikLines.md section 5, with the owner's decisions of 2026-10-09:
   - Ask MaiK shows on every answer (right or wrong), review, lesson step and flashcard, on the web too. It never hides
     because the on-phone model is missing; the sheet says why instead.
   - First use asks once: "On this phone" or "Online", with a "Don't ask again" box. The choice is kept in the store
     (key "ask" { m: "local" | "online", q: 1 when not to ask again }), synced by prep-sync.js, and changed in Your plan
     settings. Without the box ticked the sheet asks again next time, with the last choice selected.
   - A phone that cannot run MaiK on the phone is told so at once, in plain words, and offered Online. An unknown phone
     gets the online offer, never a block.
   - Online answers come from POST /api/ai/prep-teach (functions/api/ai/_prep-teach.js), signed in, paid from the
     student's MaiK Tokens by the app's existing token rules; when they run out, the app's own "MaiK Tokens are used up"
     sheet opens (pro-paywall.js watches every /api/ai/ 429 "ai-cost-cap").
   Both paths run prep-teacher.js teach() / teachStep(): the same grounding, the same system prompt, and the same check
   (every drug and number must appear in the stored text) before anything is shown. A failed check shows the stored
   explanation. The app-wide MaiK engine setting is never changed here; with it on Local, an online ask asks first.

   Device check, shown before any download or generation (deviceVerdict):
   - Today (any build): the llama plugin's total memory (SMD_MAIK_MODELS.refreshDevice) and, on Android, the Android
     version from the WebView user agent.
   - With the next store build: the official Capacitor Device plugin (@capacitor/device) adds the model identifier
     ("iPhone16,1", "iPad13,4") matched against prep/device-capability.json. Feature-checked: without the native
     plugin (web, the current store build) the memory rule alone decides.
   Chat (owner, 2026-10-09 evening): the sheet is a short conversation on that one MCQ, lesson step or card. After the
   first answer a box takes follow-up doubts; each goes with the same grounding, the last few turns and a summary of
   older ones (prep-teacher.js chatContext, small on purpose: MaiK Tokens), through the same place (on this phone or
   online, POST /api/ai/prep-teach kind "chat") and the same check; MaiK Tokens are shown under every online answer.
   After 10 student messages (the first ask counts) the box gives way to "Continue this in MaiK Assistant", which opens
   the app's main MaiK (home.js SMD_askMaikHandoff) with the topic and a short summary typed in. A thread is kept per
   item for the session and, small, on the phone (pruneThreads). The avatars and buttons carry the MaiK AI mark
   (maik-ai-mark.js, assets/maik-ai-mark.svg).
   Pure helpers load under node for tests. */
(function (G) {
  "use strict";

  /* ================= pure ================= */
  var RULES = { iphoneMinMajor: 16, appleMinRamGB: 7, androidMinRamGB: 7, androidMinSdk: 31 };
  var MSG = {
    yes: "Runs on this phone. About 10 to 40 seconds.",
    nopack: "MaiK Lite needs a one-time download first: Settings, MaiK. You can ask MaiK online now.",
    "no-apple": "MaiK on this phone needs an iPhone 15 Pro or newer, or an iPad with an M1 chip or newer. You can ask MaiK online instead.",
    "no-android": "MaiK on this phone needs a phone with 8 GB of memory or more and Android 12 or newer. You can ask MaiK online instead.",
    unknown: "We could not check this phone. You can ask MaiK online for the best answer.",
    web: "MaiK on this phone works in the StewardMD app. You can ask MaiK online here."
  };
  function num(v) { var n = Number(v); return v == null || v === "" || !isFinite(n) ? null : n; }
  function rowFor(tab, id) {
    var rows = (tab && tab.apple) || [];
    for (var i = 0; i < rows.length; i++) if (rows[i].id && rows[i].id === id) return rows[i];
    return null;
  }
  /* deviceVerdict(info, table) -> { v: "yes" | "no" | "unknown" | "web", fam: "apple" | "android" | "web" | "other", by }.
     info: { native, platform ("ios" | "android" | "web"), model (identifier or null), ramGB (total, or null),
     androidVer (major, or null), sdk (Android API level, or null) }. Unknown never becomes "no". */
  function deviceVerdict(d, tab) {
    d = d || {};
    var R = {}, k, tr = (tab && tab.rules) || {};
    for (k in RULES) R[k] = tr[k] != null ? tr[k] : RULES[k];
    if (!d.native || d.platform === "web") return { v: "web", fam: "web", by: "web" };
    var ram = num(d.ramGB);
    if (d.platform === "ios") {
      var m = String(d.model || ""), row = rowFor(tab, m);
      if (row) return { v: row.ok ? "yes" : "no", fam: "apple", by: "table" };
      var ip = /^iPhone(\d+),\d+$/.exec(m);
      if (ip) return { v: +ip[1] >= R.iphoneMinMajor ? "yes" : "no", fam: "apple", by: "id" };
      if (ram != null) return { v: ram >= R.appleMinRamGB ? "yes" : "no", fam: "apple", by: "ram" };
      return { v: "unknown", fam: "apple", by: "none" };
    }
    if (d.platform === "android") {
      var sdk = num(d.sdk), ver = num(d.androidVer);
      if (ram != null && ram < R.androidMinRamGB) return { v: "no", fam: "android", by: "ram" };
      if ((sdk != null && sdk < R.androidMinSdk) || (sdk == null && ver != null && ver < 12)) return { v: "no", fam: "android", by: "os" };
      if (ram != null && (sdk != null || ver != null)) return { v: "yes", fam: "android", by: "ram" };
      return { v: "unknown", fam: "android", by: "none" };
    }
    return { v: "unknown", fam: "other", by: "none" };
  }
  // What the "On this phone" choice says, from the verdict and whether the pack is downloaded.
  function verdictMsg(vd, packReady) {
    if (!vd) return MSG.unknown;
    if (vd.v === "web") return MSG.web;
    if (vd.v === "no") return vd.fam === "android" ? MSG["no-android"] : MSG["no-apple"];
    if (vd.v === "yes") return packReady ? MSG.yes : MSG.nopack;
    return MSG.unknown;
  }
  // Can the student pick "On this phone"? Yes when capable with the pack; an unknown phone with a pack that fits may try.
  function localOk(vd, packReady) { return !!packReady && !!vd && (vd.v === "yes" || vd.v === "unknown"); }
  // Android major version from a WebView user agent ("... Android 14; ..."), or null.
  function androidVerOf(ua) { var m = /\bAndroid (\d+)/.exec(String(ua || "")); return m ? +m[1] : null; }
  /* The sheet's first choice: the remembered one when it is still possible, else on the phone when it can run there,
     else online. pref = store.ask. */
  function firstChoice(pref, canLocal) {
    var m = pref && pref.m;
    if (m === "local" && canLocal) return "local";
    if (m === "online") return "online";
    return canLocal ? "local" : "online";
  }
  // Skip the question: "Don't ask again" was ticked and the remembered way still works.
  function skipChoice(pref, canLocal) { return !!(pref && pref.q && (pref.m === "online" || (pref.m === "local" && canLocal))); }
  // Server replies to the words the student sees (never the word AI).
  function onlineNote(status, j) {
    j = j || {};
    if (status === 401) return { error: "sign-in", note: "Sign in to ask MaiK online. Online answers use your account's MaiK Tokens." };
    if (status === 429 && j.reason === "ai-cost-cap") return { error: "tokens", note: "You have used today's free MaiK Tokens. Add MaiK Tokens or go Pro to keep asking MaiK online." };
    if (status === 429 && j.reason === "rate") return { error: "rate", note: "MaiK is still answering your last question. Try again in a few seconds." };
    if (status === 429 || status === 503) return { error: "busy", note: (j.message && !/\bAI\b/.test(j.message)) ? String(j.message) : "Ask MaiK online is busy just now. Try again later." };
    if (status === 0) return { error: "offline", note: "Ask MaiK online needs a connection. Here is the stored explanation." };
    return { error: "online-error", note: "MaiK could not answer online just now. Here is the stored explanation." };
  }
  /* ---- chat threads (pure) ---- */
  var TH = { max: 12, turns: 24, chars: 1200, days: 7 };
  function hash(s) { var h = 5381, i; s = String(s || ""); for (i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); }
  /* threadKey(ctx) -> the thread an Ask MaiK sheet belongs to: an MCQ by its id (any pick), a step or card by its text. */
  function threadKey(ctx) {
    ctx = ctx || {};
    if (ctx.kind === "mcq") { var it = ctx.item || {}; return "q:" + (it.id ? String(it.id).slice(0, 80) : hash(it.q)); }
    var tx = ctx.step ? ctx.step.tx : String(ctx.fr || "") + "\n" + String(ctx.bk || "");
    return (ctx.kind === "card" ? "c:" : "s:") + hash(String(ctx.title || "") + "|" + String(tx || ""));
  }
  /* pruneThreads(th, now) -> the threads worth keeping: newer than TH.days, at most TH.max (newest first), each with
     its last TH.turns turns of at most TH.chars characters. Anything malformed is dropped. */
  function pruneThreads(th, now) {
    var out = {}, list = [], k;
    if (!th || typeof th !== "object") return out;
    for (k in th) {
      var r = th[k];
      if (!Object.prototype.hasOwnProperty.call(th, k) || !r || typeof r !== "object" || !Array.isArray(r.turns) || !(r.ts > now - TH.days * 864e5)) continue;
      list.push([k, r]);
    }
    list.sort(function (a, b) { return b[1].ts - a[1].ts; });
    list.slice(0, TH.max).forEach(function (e) {
      var r = e[1], turns = r.turns.filter(function (t) { return t && (t.r === "u" || t.r === "m") && typeof t.t === "string"; }).slice(-TH.turns).map(function (t) {
        var o = {}, f; for (f in t) if (Object.prototype.hasOwnProperty.call(t, f)) o[f] = t[f];
        o.t = t.t.slice(0, TH.chars); if (o.note) o.note = String(o.note).slice(0, 300);
        return o;
      });
      out[e[0]] = { ts: r.ts, mode: r.mode === "local" || r.mode === "online" ? r.mode : null, turns: turns };
    });
    return out;
  }
  // The idempotency id of one follow-up: the same thread, message number and text replay the same answer for free.
  function idemFor(k, n, messages) {
    var last = messages && messages.length ? messages[messages.length - 1].t : "";
    return ("ck" + hash(k + "|" + n) + hash(last) + "00000000").slice(0, 24);
  }
  var PURE = { RULES: RULES, MSG: MSG, deviceVerdict: deviceVerdict, verdictMsg: verdictMsg, localOk: localOk, androidVerOf: androidVerOf,
    firstChoice: firstChoice, skipChoice: skipChoice, onlineNote: onlineNote, rowFor: rowFor, TH: TH, threadKey: threadKey, pruneThreads: pruneThreads, idemFor: idemFor };
  if (typeof module !== "undefined" && module.exports && !(G && G.document)) { module.exports = PURE; return; }

  /* ================= app ================= */
  var D = G.document, URL_TEACH = "/api/ai/prep-teach", TABLE_URL = (G.SMD_PREP_BASE || "/prep/") + "device-capability.json";
  var S = null, seq = 0, devP = null, tabP = null;
  function T() { return G.PREP_TEACHER || null; }
  function P() { var t = T(); return t ? t._pure : null; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function cap() { return G.Capacitor || null; }
  function isNative() { try { var C = cap(); return !!(C && C.isNativePlatform && C.isNativePlatform()); } catch (e) { return false; } }
  function platform() { try { var C = cap(); return C && C.getPlatform ? C.getPlatform() : "web"; } catch (e) { return "web"; } }
  function timeout(p, ms, dflt) { return new Promise(function (res) { var done = false; G.setTimeout(function () { if (!done) { done = true; res(dflt); } }, ms); Promise.resolve(p).then(function (v) { if (!done) { done = true; res(v); } }, function () { if (!done) { done = true; res(dflt); } }); }); }
  function table() {
    if (!tabP) tabP = G.fetch ? G.fetch(TABLE_URL, { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : null; }).then(null, function () { return null; }) : Promise.resolve(null);
    return tabP;
  }
  /* The device facts, once per app session: total memory from the llama plugin (via SMD_MAIK_MODELS), the model
     identifier and OS from @capacitor/device when the native plugin exists (feature check, next store build). */
  function deviceInfo() {
    if (devP) return devP;
    var info = { native: isNative(), platform: platform(), model: null, ramGB: null, androidVer: null, sdk: null };
    if (!info.native) return (devP = Promise.resolve(info));
    var M = G.SMD_MAIK_MODELS, C = cap();
    var pRam = M && M.refreshDevice ? timeout(M.refreshDevice(), 2500, null).then(function (d) { d = d || (M.device && M.device()) || {}; if (d.ramGB != null && !d.ramGBMin) info.ramGB = d.ramGB; }) : Promise.resolve();
    var pDev = Promise.resolve();
    try {
      var Dev = C && C.Plugins && C.Plugins.Device;
      if (Dev && Dev.getInfo && (!C.isPluginAvailable || C.isPluginAvailable("Device"))) pDev = timeout(Dev.getInfo(), 2500, null).then(function (x) {
        if (!x) return;
        if (x.model) info.model = String(x.model);
        if (x.androidSDKVersion != null) info.sdk = Number(x.androidSDKVersion);
        if (info.platform === "android" && x.osVersion) info.androidVer = parseInt(x.osVersion, 10) || null;
      });
    } catch (e) {}
    if (info.platform === "android") info.androidVer = androidVerOf(G.navigator && G.navigator.userAgent);
    return (devP = Promise.all([pRam, pDev]).then(function () { return info; }));
  }
  function verdict() { return Promise.all([deviceInfo(), table()]).then(function (r) { var v = deviceVerdict(r[0], r[1]); v.info = r[0]; return v; }); }
  function packReady() { var t = T(); try { return !!(t && t.ready && t.ready()); } catch (e) { return false; } }
  function user() { var a = G.SMD_AUTH; return a && a.currentUser ? a.currentUser : null; }
  function cloudAllowed() { try { var E = G.SMD_MAIK_ENGINE; return !E || !E.cloudAllowed || E.cloudAllowed(); } catch (e) { return true; } }
  function reduced() { try { return G.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }
  function side() { try { return G.matchMedia("(orientation: landscape) and (min-width: 900px)").matches; } catch (e) { return false; } }
  function pref(host) { var s = host.store(); return s.ask && typeof s.ask === "object" ? s.ask : null; }
  function setPref(host, m, q) { var s = host.store(); s.ask = { m: m, q: q ? 1 : 0 }; host.save(); }

  var ICO = {
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    cloud: '<path d="M7 18h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.6 9.2 4.4 4.4 0 0 0 7 18z"/>',
    check: '<path d="M5 12l5 5 9-10"/>', close: '<path d="M18 6L6 18M6 6l12 12"/>', send: '<path d="M12 19V5M5.5 11.5L12 5l6.5 6.5"/>'
  };
  function ic(n, sz) { return '<svg viewBox="0 0 24 24" width="' + (sz || 20) + '" height="' + (sz || 20) + '" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICO[n] + "</svg>"; }
  function L(k) { return ["A", "B", "C", "D", "E"][k] || "?"; }
  function keyOf(item) { var a = item && item.a; return typeof a === "number" && a >= 0 && item.o && a < item.o.length ? a : -1; }

  /* ---------- threads: one short chat per MCQ, lesson step or card ----------
     Kept for the app session in memory and, small, on the phone (localStorage THREAD_KEY, pruned by pruneThreads: at
     most TH.max threads of TH.turns turns of TH.chars characters, dropped after TH.days days). Exam text only:
     the student's own doubts and MaiK's checked answers, nothing about a patient. */
  var THREAD_KEY = "smd_prep_ask_v1";
  var threads = null;
  function loadThreads() {
    if (threads) return threads;
    threads = {};
    try { var o = JSON.parse(G.localStorage.getItem(THREAD_KEY) || "null"); threads = pruneThreads(o && o.th, Date.now()); } catch (e) { threads = {}; }
    return threads;
  }
  // The stored copy is pruned; the live records stay the same objects (an open sheet holds its own), only dropped ones go.
  function saveThreads() {
    try {
      var keep = pruneThreads(loadThreads(), Date.now()), k;
      for (k in threads) if (Object.prototype.hasOwnProperty.call(threads, k) && !keep[k] && !(S && S.th && S.th.k === k)) delete threads[k];
      G.localStorage.setItem(THREAD_KEY, JSON.stringify({ v: 1, th: keep }));
    } catch (e) {}
  }
  function threadFor(ctx) {
    var all = loadThreads(), k = threadKey(ctx);
    if (!all[k]) all[k] = { ts: Date.now(), mode: null, turns: [] };
    return { k: k, rec: all[k] };
  }

  /* ---------- the sheet ---------- */
  function root() { return S && S.host && S.host.root && S.host.root(); }
  function el() { var r = root(); return r && r.querySelector("#pnAsk"); }
  function sheet() { var w = el(); return w && w.querySelector(".pn-sheet"); }
  function turns() { return S.th.rec.turns; }
  function title() {
    var c = S.ctx;
    if (c.kind === "mcq") { var a = keyOf(c.item), ch = typeof c.chosen === "number" ? c.chosen : -1; return ch >= 0 && ch !== a ? "Why is " + L(ch) + " wrong?" : "Why is " + L(a) + " right?"; }
    if (c.kind === "card") return "Explain this card another way.";
    return "Explain this step another way.";
  }
  function ctxHtml() {
    var c = S.ctx;
    if (c.kind === "mcq") {
      var a = keyOf(c.item), ch = typeof c.chosen === "number" ? c.chosen : -1, wrong = ch >= 0 && ch !== a;
      return '<section class="pt-ctx" aria-label="The question"><p class="pt-q">' + esc(c.item.q) + '</p><p class="pt-pills">' +
        (ch >= 0 ? '<span class="pt-pill ' + (wrong ? "bad" : "ok") + '">You chose ' + L(ch) + "</span>" : "") + (a >= 0 ? '<span class="pt-pill ok">Answer ' + L(a) + "</span>" : "") + "</p></section>";
    }
    return '<section class="pt-ctx" aria-label="' + (c.kind === "card" ? "The card" : "The lesson step") + '"><p class="pt-q">' + esc(String(c.step.tx || "").replace(/\*\*/g, "")) + '</p><p class="pt-pills"><span class="pt-pill">' + esc(c.title || "") + "</span></p></section>";
  }
  // The MaiK AI mark (maik-ai-mark.js, one SVG for the whole app); without it, the old avatar picture.
  function mark(size) { var M = G.SMD_MAIK_MARK; return M ? M.html("tile", { size: size || 34 }) : ""; }
  // "Ask MaiK" with MaiK in the wordmark lettering (maik-ai-mark.js label()); plain text without it.
  function askLbl() { var M = G.SMD_MAIK_MARK; return M ? M.label("Ask MaiK") : "Ask MaiK"; }
  function avatar(size) { var m = mark(size); return '<span class="pt-av' + (m ? " mk" : "") + '" aria-hidden="true">' + m + "</span>"; }
  function optHtml(v, on, dis, icon, name, desc, extra) {
    return '<button type="button" class="pa-opt' + (on ? " on" : "") + '" role="radio" aria-checked="' + on + '" data-act="ak-pick" data-v="' + v + '"' + (dis ? ' aria-disabled="true"' : "") + ' tabindex="' + (on ? 0 : -1) + '">' +
      '<span class="pa-oi" aria-hidden="true">' + ic(icon) + '</span><span class="pa-ob"><b>' + name + "</b><small>" + desc + "</small>" + (extra ? '<small class="pa-ov">' + extra + "</small>" : "") + "</span>" +
      '<span class="pa-dot" aria-hidden="true">' + (on ? ic("check", 16) : "") + "</span></button>";
  }
  function chooseHtml() {
    var vd = S.vd, ready = S.ready, canLocal = localOk(vd, ready), msg = vd ? verdictMsg(vd, ready) : "Checking this phone…";
    var cantLocal = vd && !canLocal;
    return '<span class="pn-grab" aria-hidden="true"></span><div class="pa-head">' + avatar(44) + '<div><h2 id="paT">' + askLbl() + '</h2><p class="pn-mut pn-small">Choose where MaiK answers.</p></div></div>' +
      (cantLocal ? '<p class="pa-note" role="status">' + esc(msg) + "</p>" : "") +
      '<div class="pa-opts" role="radiogroup" aria-labelledby="paT">' +
      optHtml("local", S.sel === "local", !canLocal, "phone", "On this phone", "Works without signal. Your question stays on this phone.", cantLocal ? "" : esc(msg)) +
      optHtml("online", S.sel === "online", false, "cloud", "Online", "Faster and more detailed. Needs a connection and sign-in. Uses MaiK Tokens from your account, usually under 200 an answer.", "") +
      "</div>" +
      '<label class="pa-dont"><input type="checkbox" id="paDont"' + (S.dont ? " checked" : "") + '><span>Don\'t ask again</span></label>' +
      '<p class="pn-mut pn-small pa-later">You can change this in Your plan settings, under Ask MaiK.</p>' +
      '<div class="pn-sheet-act"><button type="button" class="pn-btn pri" data-act="ak-go">Ask MaiK</button><button type="button" class="pn-btn" data-act="ak-close">Not now</button></div>';
  }
  function segHtml() {
    var canLocal = localOk(S.vd, S.ready);
    var b = function (v, label) { var on = S.mode === v, dis = v === "local" && !canLocal; return '<button type="button" class="pa-sb' + (on ? " on" : "") + '" role="radio" aria-checked="' + on + '" tabindex="' + (on ? 0 : -1) + '" data-act="ak-mode" data-v="' + v + '"' + (dis ? ' aria-disabled="true"' : "") + ">" + label + "</button>"; };
    return '<div class="pa-seg" role="radiogroup" aria-label="Where MaiK answers">' + b("local", "On this phone") + b("online", "Online") + "</div>";
  }
  function para(t) { return String(t || "").split(/\n{2,}|\n/).map(function (p) { return p.trim() ? '<p class="pn-exp">' + esc(p.trim()) + "</p>" : ""; }).join(""); }
  function storedHtml() {
    var c = S.ctx, p = P();
    if (c.kind !== "mcq") return para(String(c.step.tx || "").replace(/\*\*/g, ""));
    var f = p.fallbackFor(c.item, typeof c.chosen === "number" ? c.chosen : -1);
    return (f.why ? "<h3>Why " + esc(f.chosen) + " is wrong</h3>" + para(f.why) : "") + "<h3>Answer " + esc(f.key) + "</h3>" +
      (f.exp ? para(f.exp) : '<p class="pn-mut">No explanation is stored for this question yet.</p>') + (f.kp ? '<p class="pn-kp"><b>Remember:</b> ' + esc(f.kp) + "</p>" : "");
  }
  function typing(cap) { return '<li class="pt-msg ai" data-key="typing">' + avatar() + '<div class="pt-bub pt-typing"><span class="pt-dots" aria-hidden="true"><i></i><i></i><i></i></span><p class="pn-mut pn-small" role="status">' + cap + "</p></div></li>"; }
  function reply(key, html, note, last) { return '<li class="pt-msg ai" data-key="' + key + '">' + avatar() + '<div class="pt-col"><section class="pt-bub pt-ans-b' + (last ? " pa-last" : "") + '"' + (last ? ' role="status"' : "") + ' tabindex="-1">' + html + "</section>" + (note ? '<p class="pt-note">' + note + "</p>" : "") + "</div></li>"; }
  function fmt(n) { try { return Number(n).toLocaleString("en-IN"); } catch (e) { return String(n); } }
  function canHand() { return !!(G.SMD_askMaikHandoff || G.SMD_askMaik); }
  // The note under one of MaiK's answers: where it was written, how it was checked, the MaiK Tokens it used.
  function noteFor(t) {
    var c = S.ctx, src = c.kind === "mcq" ? "this question's stored explanation" : c.kind === "card" ? "this card" : "this step";
    var n = (t.mode === "local" ? "Written on this phone by " + esc(t.pack || "MaiK") : "Answered online by MaiK") + " from " + src + ". Checked: every drug and number in it appears there.";
    if (t.mode !== "local" && t.mt != null) n += " Used about " + fmt(t.mt) + " MaiK Tokens" + (t.capOn && t.bal != null ? "; " + fmt(t.bal) + " left in your account." : ".");
    return n;
  }
  function turnHtml(t, i, all, lastIdle) {
    var c = S.ctx, last = i === all.length - 1;
    if (t.r === "u") return '<li class="pt-msg me" data-key="t' + i + '"><p class="pt-bub">' + esc(t.t) + "</p></li>";
    if (t.ok) {
      return reply("t" + i, '<p class="pt-who">MaiK explains</p>' + para(t.t), noteFor(t), last) +
        (t.first && c.kind === "mcq" ? '<li class="pa-more" data-key="more' + i + '"><details class="pt-more"><summary class="pn-chip pt-chip">Show the stored explanation</summary><div class="pt-bub pt-stored">' + storedHtml() + "</div></details></li>" : "") +
        (last && lastIdle && t.why === "not-covered" && canHand() ? handChip() : "");
    }
    var acts = "";
    if (last && lastIdle) {
      if (t.why === "tokens" && G.SMD_PRO && G.SMD_PRO.openAiLimit) acts += '<button type="button" class="pn-btn pri" data-act="ak-tokens">Add MaiK Tokens</button>';
      if (t.retry) acts += '<button type="button" class="pn-btn" data-act="ak-retry">Try again</button>';
      if (acts) acts = '<div class="pa-row">' + acts + "</div>";
    }
    return reply("t" + i, '<p class="pn-mut pn-small">' + esc(t.note || "MaiK could not answer just now.") + "</p>" + acts + (t.first ? storedHtml() : ""), "", last) +
      (last && lastIdle && t.why === "not-covered" && canHand() ? handChip() : "");
  }
  function handChip() { return '<li class="pa-hchip" data-key="hchip"><button type="button" class="pn-chip pt-chip" data-act="ak-hand">' + mkSmall() + "Continue in MaiK Assistant</button></li>"; }
  function mkSmall() { var M = G.SMD_MAIK_MARK; return M ? M.html("mark", { size: 18 }) : ""; }
  function threadHtml() {
    var all = turns(), idle = S.phase !== "run" && S.phase !== "consent", msgs = "";
    all.forEach(function (t, i) { msgs += turnHtml(t, i, all, idle); });
    if (S.phase === "consent") msgs += reply("consent", '<p>Your MaiK setting keeps answers on this phone. Send this question to StewardMD\'s server for this one answer?</p><div class="pa-row"><button type="button" class="pn-btn pri" data-act="ak-consent">Send online</button><button type="button" class="pn-btn" data-act="ak-mode" data-v="local"' + (localOk(S.vd, S.ready) ? "" : ' aria-disabled="true"') + ">On this phone</button></div>", "", true);
    else if (S.phase === "run") msgs += typing(S.mode === "local" ? 'MaiK is working on your phone: <span id="paSecs">0</span> s. This takes 10 to 40 seconds.' : "MaiK is answering online…");
    else if (S.phase === "busy") msgs += reply("busy", "<p>MaiK is still working on another answer on this phone. Try again in a moment.</p>", "", true);
    return '<ol class="pt-thread">' + msgs + "</ol>";
  }
  // Below the thread: the follow-up box, or after 10 student messages the hand-off to the MaiK assistant.
  function footHtml() {
    var all = turns(), p = P(), n = p ? p.userCount(all) : 0, max = p ? p.CHAT_LIM.turns : 10;
    if (!all.length || S.phase === "consent") return "";
    if (n >= max && S.phase !== "run") {
      return '<div class="pa-hand" role="status"><p><b>This chat has reached ' + max + " questions.</b> " + (canHand() ? "Carry on in MaiK Assistant with this topic and a short summary of this chat." : "Open MaiK from the home screen to ask more.") + "</p>" +
        (canHand() ? '<button type="button" class="pn-btn pri" data-act="ak-hand">' + mkSmall() + "Continue this in MaiK Assistant</button>" : "") + "</div>";
    }
    var left = max - n, wait = S.phase === "run";
    return '<div class="pa-cmp"><div class="pa-box"><textarea id="paIn" rows="1" maxlength="' + (p ? p.CHAT_LIM.user : 300) + '" aria-label="Ask MaiK a follow-up doubt" name="paIn" placeholder="Ask a follow-up doubt…" enterkeyhint="send" autocomplete="off">' + esc(S.draft || "") + "</textarea>" +
      '<button type="button" class="pa-send" data-act="ak-send" aria-label="Send"' + (wait ? ' aria-disabled="true"' : "") + ">" + ic("send", 20) + "</button></div>" +
      '<p class="pa-left" id="paLeft">' + (left === 1 ? "1 question left in this chat" : left + " questions left in this chat") + "</p></div>";
  }
  function chatHtml() {
    return '<span class="pn-grab" aria-hidden="true"></span><div class="pa-top">' + avatar(36) + '<h2 id="paT">' + askLbl() + '</h2>' +
      '<button type="button" class="pn-ib" data-act="ak-close" aria-label="Close Ask MaiK">' + ic("close") + "</button></div>" + segHtml() +
      '<div class="pa-body pt-chat">' + ctxHtml() + threadHtml() + "</div>" + footHtml();
  }
  function draw(focusSel) {
    var sh = sheet(); if (!sh) return;
    var body = sh.querySelector(".pa-body"), y = body ? body.scrollTop : 0;
    // Patched in place (native pass 2): the thread keeps its node and its scroll; a view change (choose, chat) rebuilds.
    var html = S.view === "choose" ? chooseHtml() : chatHtml(), same = sh.getAttribute("data-view") === S.view;
    if (same && sh.firstChild && G.PREP_DOM) G.PREP_DOM.patch(sh, html); else sh.innerHTML = html;
    sh.setAttribute("data-view", S.view);
    sh.classList.toggle("pa-chat", S.view !== "choose");
    body = sh.querySelector(".pa-body");
    if (body && !same) body.scrollTop = y;
    if (focusSel) { var f = sh.querySelector(focusSel); if (f) try { f.focus({ preventScroll: false }); } catch (e) {} }
    // The newest message stays in view: MaiK's answer (its top), or the student's own message and the typing dots.
    if (body && S.view !== "choose" && S.scroll) {
      S.scroll = false;
      var tgt = S.phase === "run" ? sh.querySelector('.pt-msg[data-key="typing"]') : sh.querySelector(".pa-hchip") || sh.querySelector(".pa-last") || sh.querySelector(".pa-hand");
      if (tgt && tgt.scrollIntoView) try { tgt.scrollIntoView({ block: S.phase === "run" ? "end" : "nearest" }); } catch (e) {}
    }
  }

  /* open(ctx, host). ctx: { kind: "mcq", item, chosen, topic? } | { kind: "step", step, title } | { kind: "card", fr, bk, title }. */
  function open(ctx, host) {
    if (!ctx || !host || !host.root || !host.root()) return false;
    close(true);
    if (ctx.kind === "card") ctx = { kind: "card", step: { tx: String(ctx.fr || "") + "\n" + String(ctx.bk || "") }, title: ctx.title || "Card" };
    var ready = packReady(), pf = pref(host), th = threadFor(ctx);
    S = { ctx: ctx, host: host, prev: D.activeElement, vd: null, ready: ready, sel: firstChoice(pf, ready), dont: !!(pf && pf.q), view: "choose", mode: null, phase: "", token: ++seq, consented: false, th: th, draft: "", scroll: true };
    var w = D.createElement("div");
    w.className = "pn-sheet-wrap pa-wrap" + (side() && ctx.side ? " pa-side" : "");
    w.id = "pnAsk";
    w.innerHTML = '<div class="pn-scrim" data-act="ak-close"></div><section class="pn-sheet pa-sheet" role="dialog" aria-modal="true" aria-labelledby="paT" tabindex="-1"></section>';
    host.root().appendChild(w);
    w.addEventListener("input", onInput);
    w.addEventListener("keydown", onComposeKey);
    var mine = S;
    // A remembered choice that still works skips the question; else the sheet asks where, as before. Either way a thread
    // already started on this item continues (resume()).
    if (skipChoice(pf, ready)) { S.view = "chat"; resume(pf.m); }
    else draw();
    try { sheet().focus(); } catch (e) {}
    verdict().then(function (vd) {
      if (S !== mine) return;
      S.vd = vd; S.ready = packReady();
      // A phone that cannot run MaiK starts on Online, said at once.
      if (!localOk(vd, S.ready) && S.sel === "local") S.sel = "online";
      if (S.view === "chat" && S.mode === "local" && !localOk(vd, S.ready) && S.phase !== "run") S.mode = "online";
      if (S.view === "choose") draw(); else if (S.phase !== "run") draw();
    });
    return true;
  }
  function close(quiet) {
    var w = el(), prev = S && S.prev;
    if (w) w.parentNode.removeChild(w);
    S = null;
    if (!quiet && prev && prev.isConnected) try { prev.focus(); } catch (e) {}
    return !!w;
  }
  function alive(tok) { return !!(S && S.token === tok && el()); }
  function onInput(e) { if (S && e.target && e.target.id === "paIn") S.draft = e.target.value; }
  function onComposeKey(e) {
    if (!S || !e.target || e.target.id !== "paIn") return;
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  }
  function addTurn(t) { var all = turns(); all.push(t); S.th.rec.ts = Date.now(); if (S.mode) S.th.rec.mode = S.mode; saveThreads(); }

  // The answer for the student's message at turns()[idx] (the first ask, or a follow-up), on the phone or online.
  function ask(mode, retry) {
    var c = S.ctx, t = T(), p = P(), tok = S.token, all = turns();
    if (!t || !p) { S.mode = mode; S.phase = ""; if (!all.length) all.push({ r: "u", t: title() }); all.push({ r: "m", t: "", ok: false, first: all.length === 1, note: "Ask MaiK did not load. Close and open PrepNucleus again." }); return draw(); }
    if (mode === "local" && !localOk(S.vd || { v: "unknown" }, S.ready)) mode = "online";
    S.mode = mode; S.usage = null; S.wallet = null;
    if (!all.length) addTurn({ r: "u", t: title() });
    if (mode === "online" && !cloudAllowed() && !S.consented) { S.phase = "consent"; S.scroll = true; return draw(".pa-body [data-act=ak-consent]"); }
    var first = all.length === 1;
    S.phase = "run"; S.t0 = Date.now(); S.scroll = true; draw();
    if (mode === "local") tick(tok);
    var finish = function (res) {
      if (mode === "local") t.setBusy(false);
      if (!alive(tok) || S.mode !== mode) return;
      res = res || { ok: false };
      var turn = res.ok ? { r: "m", t: res.text, ok: true, mode: mode } : { r: "m", t: "", ok: false, mode: mode, note: res.note, why: res.why || res.reason, retry: retryable(res) };
      if (first) turn.first = true;
      if (mode === "local") turn.pack = t.packLabel();
      else if (S.usage && S.usage.mt != null) { turn.mt = S.usage.mt; if (S.wallet) { turn.bal = S.wallet.balanceMt; turn.capOn = !!S.wallet.costCapOn; } }
      S.phase = ""; S.scroll = true; addTurn(turn); draw(".pa-last");
    };
    var chosen = c.kind === "mcq" ? (typeof c.chosen === "number" ? c.chosen : -1) : -1;
    if (mode === "local") {
      if (t.isBusy()) { S.phase = "busy"; return draw(); }
      t.setBusy(true);
      return t.available().then(function (ok) {
        if (!ok) return { ok: false, note: "MaiK is not ready on this phone. Download MaiK Lite in Settings, MaiK, or ask online." };
        return groundP().then(function (g) {
          if (!first) return p.teachChat(g.ground, turns(), { generate: function (prompt, system) { return t.localGenerate(prompt, system); }, lexicon: G.SMD_DRUG_LEXICON || null, local: true });
          if (c.kind === "mcq") return p.teach(c.item, chosen, { generate: t.localGenerate, lexicon: G.SMD_DRUG_LEXICON || null, sents: g.sents });
          return p.teachStep(c.step, c.title, { generate: t.localGenerate, lexicon: G.SMD_DRUG_LEXICON || null });
        });
      }).then(finish, function () { finish({ ok: false, note: "MaiK could not answer on this phone just now." }); });
    }
    // Online: the same grounding the phone would use, sent to the server; the reply is checked here like the phone's.
    groundP().then(function (g) {
      if (!first) {
        return p.teachChat(g.ground, turns(), { lexicon: G.SMD_DRUG_LEXICON || null, generate: function (prompt, system, cx) {
          var n = p.userCount(turns()), body = { kind: "chat", base: c.kind === "mcq" ? "mcq" : "step", ground: g.ground, turn: n, messages: cx.messages, idem: idemFor(S.th.k, n, cx.messages) };
          if (cx.summary) body.summary = cx.summary;
          return online(body);
        } });
      }
      var body = c.kind === "mcq" ? { kind: "mcq", ground: g.ground, key: keyOf(c.item), chosen: chosen } : { kind: "step", ground: g.ground, title: String(c.title || "").slice(0, 200) };
      var gen = function () { return online(body); };
      return c.kind === "mcq" ? p.teach(c.item, chosen, { generate: gen, lexicon: G.SMD_DRUG_LEXICON || null, sents: g.sents }) : p.teachStep(c.step, c.title, { generate: gen, lexicon: G.SMD_DRUG_LEXICON || null });
    }).then(finish, function () { finish({ ok: false, note: "MaiK could not answer online just now." }); });
  }
  // The grounding for this item: an MCQ's stored text (with a student deck's source sentences), or the step or card.
  function groundP() {
    var c = S.ctx, t = T(), p = P(), chosen = c.kind === "mcq" ? (typeof c.chosen === "number" ? c.chosen : -1) : -1;
    if (c.kind !== "mcq") return Promise.resolve({ ground: p.stepGround(c.step, c.title), sents: [] });
    return Promise.resolve(t.sourceSentences(c.item)).then(function (sents) { return { ground: p.groundingText(c.item, chosen, sents), sents: sents }; }, function () { return { ground: p.groundingText(c.item, chosen, []), sents: [] }; });
  }
  // A failure the student can retry as it is (connection, busy, an empty or failed answer); not a check failure or tokens.
  function retryable(res) { var w = res && (res.why || res.reason); return !!w && w !== "check" && w !== "not-covered" && w !== "tokens" && w !== "sign-in" && w !== "no-grounding"; }
  /* send(): the student's follow-up doubt from the box. Trimmed, at most CHAT_LIM.user characters, ignored while MaiK
     is answering or once the thread has its 10 messages. */
  function send() {
    var p = P(); if (!S || !p || S.phase === "run" || S.phase === "consent") return;
    var box = sheet() && sheet().querySelector("#paIn"), txt = String((box && box.value) || S.draft || "").replace(/\s+/g, " ").trim().slice(0, p.CHAT_LIM.user);
    if (!txt || !p.canAsk(turns())) return;
    S.draft = ""; if (box) box.value = "";
    addTurn({ r: "u", t: txt });
    ask(S.mode || "online");
  }
  /* resume(mode): open the chat in this place. A new thread asks its first question; a thread whose last answer failed
     asks that message again; a thread that ended on an answer just shows, ready for the next doubt (no new call). */
  function resume(mode) {
    var all = turns(), last = all[all.length - 1];
    if (!all.length) return ask(mode);
    if (last.r === "u" || !last.ok) { if (last.r === "m") { all.pop(); saveThreads(); } return ask(mode); }
    S.mode = mode === "local" && !localOk(S.vd || { v: "unknown" }, S.ready) ? "online" : mode;
    S.phase = ""; S.scroll = true; return draw();
  }
  // Try again: MaiK's failed answer to the last message is dropped and asked again (not a new student message).
  function retry() {
    var all = turns(), last = all[all.length - 1];
    if (!last || last.r !== "m" || last.ok) return;
    all.pop(); saveThreads();
    ask(S.mode || "online", true);
  }
  // Continue in MaiK Assistant: the app's main MaiK opens with the topic and a short summary of this chat.
  function handoffNow() {
    var c = S.ctx, p = P(), info;
    if (c.kind === "mcq") { var a = keyOf(c.item); info = { topic: c.topic || c.item.q, q: c.item.q, key: a >= 0 ? L(a) + ". " + c.item.o[a] : "" }; }
    else info = { topic: c.title || (c.kind === "card" ? "Flashcard" : "Lesson") };
    var h = p.handoff(info, turns());
    close(true);
    try {
      if (G.SMD_askMaikHandoff) G.SMD_askMaikHandoff({ topic: h.topic, prefill: h.prefill, from: "prep" });
      else if (G.SMD_askMaik) G.SMD_askMaik(h.prefill);
    } catch (e) {}
    return h;
  }
  // One online call. Resolves { text } or { error, note } (prep-teacher.js teach() shows the note); never rejects.
  function online(body) {
    var u = user(), mine = S;
    if (!u || !u.getIdToken) return Promise.resolve(onlineNote(401));
    if (G.navigator && G.navigator.onLine === false) return Promise.resolve(onlineNote(0));
    return Promise.resolve(u.getIdToken()).then(function (tok) {
      return G.fetch((G.SMD_API_BASE || "") + URL_TEACH, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok }, body: JSON.stringify(body) });
    }).then(function (r) {
      return r.json().then(null, function () { return {}; }).then(function (j) {
        if (r.status === 200 && j && j.text) { if (S === mine) { S.usage = j.usage || null; S.wallet = j.wallet || null; } return { text: j.text, model: "online" }; }
        return onlineNote(r.status, j);
      });
    }, function () { return onlineNote(0); });
  }
  function tick(tok) {
    if (!alive(tok) || S.phase !== "run" || S.mode !== "local") return;
    var e = sheet() && sheet().querySelector("#paSecs"); if (e) e.textContent = String(Math.round((Date.now() - S.t0) / 1000));
    G.setTimeout(function () { tick(tok); }, 1000);
  }
  // Arrow keys move the choice inside a radio group (the two options, or the mode switch).
  function onKey(e) {
    if (!S) return;
    var t = e.target, k = e.key;
    if (!t || !t.getAttribute || !/^ak-(pick|mode)$/.test(t.getAttribute("data-act") || "")) return;
    var step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[k]; if (!step) return;
    e.preventDefault();
    var bs = Array.prototype.slice.call(t.parentNode.querySelectorAll("[role=radio]:not([aria-disabled=true])"));
    var i = bs.indexOf(t); if (i < 0 || bs.length < 2) return;
    bs[(i + step + bs.length) % bs.length].click();
  }

  /* act(a, button): prep.js routes every data-act starting "ak-" here. */
  function act(a, b, host) {
    var v = b.getAttribute("data-v");
    if (a === "ak-pref") return setFromSettings(v, b, host);
    if (!S) return;
    if (a === "ak-close") return close();
    if (a === "ak-pick") { if (b.getAttribute("aria-disabled") === "true") return; S.sel = v; var dn = sheet() && sheet().querySelector("#paDont"); S.dont = !!(dn && dn.checked); return draw('[data-act=ak-pick][data-v="' + v + '"]'); }
    if (a === "ak-go") {
      var d = sheet() && sheet().querySelector("#paDont");
      S.dont = !!(d && d.checked);
      setPref(S.host, S.sel, S.dont);
      S.view = "chat"; return resume(S.sel);
    }
    if (a === "ak-mode") {
      if (b.getAttribute("aria-disabled") === "true" || S.phase === "run") return;
      var all = turns(), last = all[all.length - 1];
      // No answer yet, or the last one failed: ask it again in the new place. Otherwise the next doubt goes there.
      if (!all.length || S.phase === "consent" || S.phase === "busy" || (last && last.r === "m" && !last.ok)) {
        if (last && last.r === "m" && !last.ok) { all.pop(); saveThreads(); }
        S.phase = ""; return ask(v);
      }
      if (v === S.mode) return;
      S.mode = v; S.th.rec.mode = v; saveThreads(); return draw('[data-act=ak-mode][data-v="' + v + '"]');
    }
    if (a === "ak-consent") { S.consented = true; return ask("online"); }
    if (a === "ak-send") { if (b.getAttribute("aria-disabled") === "true") return; return send(); }
    if (a === "ak-retry") return retry();
    if (a === "ak-hand") return handoffNow();
    if (a === "ak-tokens") { try { G.SMD_PRO.openAiLimit({ message: "You have used today's free MaiK Tokens." }); } catch (e) {} return; }
  }
  // Your plan settings: "Ask me each time", "On this phone", "Online".
  function settingsHtml(host) {
    var pf = pref(host) || {}, cur = pf.q && pf.m ? pf.m : "each";
    var o = [["each", "Ask me each time"], ["local", "On this phone"], ["online", "Online"]];
    return '<section class="pl-grp pl-g-ask"><h3 class="pl-sh"><span class="pl-sic" aria-hidden="true">' + ic("phone") + '</span>Ask MaiK</h3><div class="pa-seg pa-set" role="radiogroup" aria-label="Where Ask MaiK answers">' +
      o.map(function (x) { var on = cur === x[0]; return '<button type="button" class="pa-sb' + (on ? " on" : "") + '" role="radio" aria-checked="' + on + '" tabindex="' + (on ? 0 : -1) + '" data-act="ak-pref" data-v="' + x[0] + '">' + x[1] + "</button>"; }).join("") +
      '</div><p class="pn-mut pn-small pl-segsub">Online answers use MaiK Tokens from your account. On this phone needs a capable phone with MaiK Lite downloaded.</p></section>';
  }
  function setFromSettings(v, b, host) {
    var pf = pref(host) || {};
    if (v === "each") setPref(host, pf.m || null, false); else setPref(host, v, true);
    var g = b.parentNode;
    Array.prototype.forEach.call(g.querySelectorAll(".pa-sb"), function (x) { var on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-checked", String(on)); x.tabIndex = on ? 0 : -1; });
    try { b.focus(); } catch (e) {}
  }
  function back() { return S ? (close(), true) : false; }
  function leave() { S = null; }
  if (D && D.addEventListener) D.addEventListener("keydown", onKey, true);

  G.PREP_ASK = { open: open, close: close, back: back, leave: leave, act: act, settingsHtml: settingsHtml, isOpen: function () { return !!(S && el()); },
    verdict: verdict, deviceInfo: deviceInfo, _reset: function () { devP = null; tabP = null; }, _resetThreads: function () { threads = {}; try { G.localStorage.removeItem(THREAD_KEY); } catch (e) {} },
    _pure: PURE, _s: function () { return S; } };
})(typeof window !== "undefined" ? window : this);
