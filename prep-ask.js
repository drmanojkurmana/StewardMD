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
   Chat (owner, 2026-10-09 evening; reworked 2026-10-10 after the owner's iPhone recording): a near-full bottom sheet
   that slides up from Ask MaiK and fits the visible screen (the keyboard included: onVV follows the visual viewport).
   Header (mark, Ask MaiK, close), one bar with the place switch and the one status line ("7 of 10 left" online,
   "Unlimited" on this phone), ONE scroll region (the question as a collapsed one-line chip, then the conversation,
   following the newest message), the composer pinned below (three quick replies and the box). MaiK replies to what the
   student actually wrote (prep-teacher.js CHAT_SYSTEM / intentHint, multi-turn chatContext), drawn word by word once
   checked. Limits (owner): on this phone unlimited; online 10 student messages a chat, counted per chat (`on`, chat id
   `cid`) and enforced again by the server (429 chat-limit); at 10 a card offers Start a new chat and Continue on this
   phone (unlimited). On this phone never falls back to Online by itself: it says why and offers Online. A thread is
   kept per item for the session and, small, on the phone (pruneThreads). The avatars and buttons carry the MaiK AI
   mark (maik-ai-mark.js, assets/maik-ai-mark.svg).
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
    if (status === 429 && j.reason === "chat-limit") return { error: "chat-limit", note: "This chat has reached " + ONLINE_MAX + " online questions." };
    if (status === 429 && j.reason === "rate") return { error: "rate", note: "MaiK is still answering your last question. Try again in a few seconds." };
    if (status === 429 || status === 503) return { error: "busy", note: (j.message && !/\bAI\b/.test(j.message)) ? String(j.message) : "Ask MaiK online is busy just now. Try again later." };
    if (status === 0) return { error: "offline", note: "Ask MaiK online needs a connection. Here is the stored explanation." };
    return { error: "online-error", note: "MaiK could not answer online just now. Here is the stored explanation." };
  }
  /* ---- limits (owner 2026-10-10): on this phone unlimited; online 10 student messages a chat ----
     Counted per chat in the thread record (`on`, so a long phone chat that outgrows the stored window keeps the count);
     the server counts the same chat id (functions/api/ai/_prep-teach.js, 429 chat-limit). */
  var ONLINE_MAX = 10;
  function onlineCount(turns) { var n = 0; (turns || []).forEach(function (t) { if (t && t.r === "u" && t.m === "online") n++; }); return n; }
  function onlineLeft(rec) { return Math.max(0, ONLINE_MAX - ((rec && rec.on) | 0)); }
  function atCap(rec, mode) { return mode === "online" && onlineLeft(rec) === 0; }
  function newCid() { return (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).replace(/[^a-z0-9]/g, "").slice(-12); }
  /* quickReplies(ctx) -> three one-tap messages for the composer: an MCQ asks about the student's own wrong pick (or the
     first other option when they were right); a step or card asks for an example. */
  function quickReplies(ctx) {
    ctx = ctx || {};
    if (ctx.kind !== "mcq") return ["Explain simply", "Give an example", "Give a mnemonic"];
    var it = ctx.item || {}, a = typeof it.a === "number" ? it.a : -1, ch = typeof ctx.chosen === "number" ? ctx.chosen : -1, o = -1, i;
    if (ch >= 0 && ch !== a) o = ch; else for (i = 0; i < ((it.o && it.o.length) || 0); i++) if (i !== a) { o = i; break; }
    return ["Explain simply", o >= 0 ? "Why not " + ["A", "B", "C", "D", "E"][o] + "?" : "Why is this right?", "Give a mnemonic"];
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
      var rec = { ts: r.ts, mode: r.mode === "local" || r.mode === "online" ? r.mode : null, turns: turns };
      rec.on = typeof r.on === "number" && r.on >= 0 ? Math.min(ONLINE_MAX, Math.floor(r.on)) : onlineCount(turns);
      if (typeof r.cid === "string" && /^[a-z0-9]{4,16}$/.test(r.cid)) rec.cid = r.cid;
      if (r.nc) rec.nc = 1;
      out[e[0]] = rec;
    });
    return out;
  }
  // The idempotency id of one follow-up: the same thread, message number and text replay the same answer for free.
  function idemFor(k, n, messages) {
    var last = messages && messages.length ? messages[messages.length - 1].t : "";
    return ("ck" + hash(k + "|" + n) + hash(last) + "00000000").slice(0, 24);
  }
  var PURE = { RULES: RULES, MSG: MSG, deviceVerdict: deviceVerdict, verdictMsg: verdictMsg, localOk: localOk, androidVerOf: androidVerOf,
    firstChoice: firstChoice, skipChoice: skipChoice, onlineNote: onlineNote, rowFor: rowFor, TH: TH, threadKey: threadKey, pruneThreads: pruneThreads, idemFor: idemFor,
    ONLINE_MAX: ONLINE_MAX, onlineCount: onlineCount, onlineLeft: onlineLeft, atCap: atCap, quickReplies: quickReplies, newCid: newCid };
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

  /* ---------- threads: one chat per MCQ, lesson step or card ----------
     Kept for the app session in memory and, small, on the phone (localStorage THREAD_KEY, pruned by pruneThreads: at
     most TH.max threads of TH.turns turns of TH.chars characters, dropped after TH.days days). Exam text only:
     the student's own doubts and MaiK's answers, nothing about a patient. A record also carries `on` (online student
     messages in this chat), `cid` (this chat's id: "Start a new chat" makes a new one) and `nc` (a new chat, opened
     empty: no automatic first question). */
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
    if (!all[k]) all[k] = { ts: Date.now(), mode: null, turns: [], on: 0, cid: newCid() };
    if (!all[k].cid) all[k].cid = newCid();
    if (typeof all[k].on !== "number") all[k].on = onlineCount(all[k].turns);
    return { k: k, rec: all[k] };
  }
  // The chat id the server counts the online 10 against: this item's thread and this chat.
  function chatId() { return ("pa" + hash(S.th.k) + S.th.rec.cid).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64); }

  /* ---------- the sheet ---------- */
  function root() { return S && S.host && S.host.root && S.host.root(); }
  function el() { var r = root(); return r && r.querySelector("#pnAsk"); }
  function sheet() { var w = el(); return w && w.querySelector(".pn-sheet"); }
  function body() { var s = sheet(); return s && s.querySelector(".pa-body"); }
  function turns() { return S.th.rec.turns; }
  function chosenOf(c) { return c.kind === "mcq" && typeof c.chosen === "number" ? c.chosen : -1; }
  function title() {
    var c = S.ctx;
    if (c.kind === "mcq") { var a = keyOf(c.item), ch = chosenOf(c); return ch >= 0 && ch !== a ? "Why is " + L(ch) + " wrong?" : "Why is " + L(a) + " right?"; }
    if (c.kind === "card") return "Explain this card another way.";
    return "Explain this step another way.";
  }
  var CHEV = '<svg class="pa-chev" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
  /* The question as one line at the top of the conversation ("Question 2 · You chose C · Answer C"); a tap opens the
     stem and the options. It scrolls with the chat (one scroll region), never pinned over it. */
  function ctxHtml() {
    var c = S.ctx, open = S.cxOpen ? " open" : "", inner;
    if (c.kind === "mcq") {
      var a = keyOf(c.item), ch = chosenOf(c), wrong = ch >= 0 && ch !== a;
      var line = '<span class="pa-cxk">' + (c.n ? "Question " + esc(c.n) : "Question") + "</span>" +
        (ch >= 0 ? '<span class="pa-cxp ' + (wrong ? "bad" : "ok") + '">You chose ' + L(ch) + "</span>" : "") + (a >= 0 ? '<span class="pa-cxp ok">Answer ' + L(a) + "</span>" : "");
      var opts = (c.item.o || []).map(function (o, i) { return '<li class="' + (i === a ? "key" : i === ch ? "pick" : "") + '"><b>' + L(i) + "</b><span>" + esc(o) + "</span></li>"; }).join("");
      inner = '<summary class="pa-cxs" aria-label="The question: ' + esc((c.n ? "question " + c.n + ", " : "") + (ch >= 0 ? "you chose " + L(ch) + ", " : "") + "answer " + L(a)) + '">' + line + CHEV + '</summary><div class="pa-cxb"><p class="pa-cxq">' + esc(c.item.q) + '</p><ol class="pa-cxo">' + opts + "</ol></div>";
    } else {
      inner = '<summary class="pa-cxs"><span class="pa-cxk">' + (c.kind === "card" ? "Card" : "Lesson step") + '</span><span class="pa-cxt">' + esc(c.title || "") + "</span>" + CHEV + '</summary><div class="pa-cxb"><p class="pa-cxq">' + esc(String(c.step.tx || "").replace(/\*\*/g, "")) + "</p></div>";
    }
    return '<li class="pa-ctx" data-key="ctx"><details class="pa-cx"' + open + ">" + inner + "</details></li>";
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
      optHtml("local", S.sel === "local", !canLocal, "phone", "On this phone", "Works without signal. Your question stays on this phone. No limit on questions.", cantLocal ? "" : esc(msg)) +
      optHtml("online", S.sel === "online", false, "cloud", "Online", "Faster and more detailed. Needs a connection and sign-in. Up to " + ONLINE_MAX + " questions a chat, from your MaiK Tokens.", "") +
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
  // Paragraphs, and runs of "- " lines as a list. Text only (escaped).
  function para(t) {
    var out = "", list = [];
    var flush = function () { if (list.length) { out += '<ul class="pa-ul">' + list.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>"; list = []; } };
    String(t || "").split(/\n+/).forEach(function (p) {
      p = p.trim(); if (!p) return;
      var m = /^[-•]\s+(.*)$/.exec(p);
      if (m) list.push(m[1]); else { flush(); out += '<p class="pn-exp">' + esc(p) + "</p>"; }
    });
    flush();
    return out;
  }
  function storedHtml() {
    var c = S.ctx, p = P();
    if (c.kind !== "mcq") return para(String(c.step.tx || "").replace(/\*\*/g, ""));
    var f = p.fallbackFor(c.item, chosenOf(c));
    return (f.why ? "<h3>Why " + esc(f.chosen) + " is wrong</h3>" + para(f.why) : "") + "<h3>Answer " + esc(f.key) + "</h3>" +
      (f.exp ? para(f.exp) : '<p class="pn-mut">No explanation is stored for this question yet.</p>') + (f.kp ? '<p class="pn-kp"><b>Remember:</b> ' + esc(f.kp) + "</p>" : "");
  }
  function typing(cap) { return '<li class="pt-msg ai" data-key="typing">' + avatar() + '<div class="pt-bub pt-typing"><span class="pt-dots" aria-hidden="true"><i></i><i></i><i></i></span><p class="pn-mut pn-small" role="status">' + cap + "</p></div></li>"; }
  function reply(key, html, note, last) { return '<li class="pt-msg ai" data-key="' + key + '">' + avatar() + '<div class="pt-col"><section class="pt-bub pt-ans-b' + (last ? " pa-last" : "") + '"' + (last ? ' role="status"' : "") + ' tabindex="-1">' + html + "</section>" + (note ? '<p class="pt-note">' + note + "</p>" : "") + "</div></li>"; }
  function fmt(n) { try { return Number(n).toLocaleString("en-IN"); } catch (e) { return String(n); } }
  function canHand() { return !!(G.SMD_askMaikHandoff || G.SMD_askMaik); }
  /* The small line under one of MaiK's answers, only when it says something: an honest note when the answer names a
     figure or drug that is not in the stored text, and the MaiK Tokens an online answer used. */
  function noteFor(t) {
    var n = [];
    if (t.beyond && t.beyond.length) n.push('<span class="pa-bey">Not in this question\'s notes: ' + esc(t.beyond.join(", ")) + ". Check before you rely on it.</span>");
    if (t.mode !== "local" && t.mt != null) n.push(fmt(t.mt) + " MaiK Tokens" + (t.capOn && t.bal != null ? " · " + fmt(t.bal) + " left in your account" : ""));
    return n.join(" ");
  }
  function turnHtml(t, i, all, lastIdle) {
    var c = S.ctx, last = i === all.length - 1;
    if (t.r === "u") return '<li class="pt-msg me" data-key="t' + i + '"><p class="pt-bub">' + esc(t.t) + "</p></li>";
    if (t.ok) {
      return reply("t" + i, '<div class="pa-txt">' + para(t.t) + "</div>", noteFor(t), last) +
        (t.first && c.kind === "mcq" ? '<li class="pa-more" data-key="more' + i + '"><details class="pt-more"><summary class="pn-chip pt-chip">Show the stored explanation</summary><div class="pt-bub pt-stored">' + storedHtml() + "</div></details></li>" : "") +
        (last && lastIdle && t.why === "not-covered" && canHand() ? handChip() : "");
    }
    var acts = "";
    if (last && lastIdle) {
      if (t.why === "tokens" && G.SMD_PRO && G.SMD_PRO.openAiLimit) acts += '<button type="button" class="pn-btn pri" data-act="ak-tokens">Add MaiK Tokens</button>';
      if (t.why === "no-local") acts += '<button type="button" class="pn-btn pri" data-act="ak-mode" data-v="online">Ask online instead</button>';
      if (t.retry) acts += '<button type="button" class="pn-btn" data-act="ak-retry">Try again</button>';
      if (acts) acts = '<div class="pa-row">' + acts + "</div>";
    }
    return reply("t" + i, '<p class="pn-mut pn-small">' + esc(t.note || "MaiK could not answer just now.") + "</p>" + acts + (t.first ? storedHtml() : ""), "", last) +
      (last && lastIdle && t.why === "not-covered" && canHand() ? handChip() : "");
  }
  function handChip() { return '<li class="pa-hchip" data-key="hchip"><button type="button" class="pn-chip pt-chip" data-act="ak-hand">' + mkSmall() + "Continue in MaiK Assistant</button></li>"; }
  function mkSmall() { var M = G.SMD_MAIK_MARK; return M ? M.html("mark", { size: 18 }) : ""; }
  function threadHtml() {
    var all = turns(), idle = S.phase !== "run" && S.phase !== "consent", msgs = ctxHtml();
    if (!all.length && S.phase !== "run") msgs += '<li class="pa-empty" data-key="empty">' + avatar() + '<p>New chat. Ask MaiK anything about this ' + (S.ctx.kind === "mcq" ? "question" : S.ctx.kind === "card" ? "card" : "step") + ".</p></li>";
    all.forEach(function (t, i) { msgs += turnHtml(t, i, all, idle); });
    if (S.phase === "consent") msgs += reply("consent", '<p>Your MaiK setting keeps answers on this phone. Send this question to StewardMD\'s server for this one answer?</p><div class="pa-row"><button type="button" class="pn-btn pri" data-act="ak-consent">Send online</button><button type="button" class="pn-btn" data-act="ak-mode" data-v="local"' + (localOk(S.vd, S.ready) ? "" : ' aria-disabled="true"') + ">On this phone</button></div>", "", true);
    else if (S.phase === "run") msgs += typing(S.mode === "local" ? 'MaiK is thinking on this phone · <span id="paSecs">0</span> s' : "MaiK is typing…");
    else if (S.phase === "busy") msgs += reply("busy", "<p>MaiK is still working on another answer on this phone. Try again in a moment.</p>", "", true);
    return '<ol class="pt-thread">' + msgs + "</ol>";
  }
  // The one status line: online, how many of this chat's 10 are left; on this phone, no limit.
  function statusText() { return S.mode === "local" ? "Unlimited" : onlineLeft(S.th.rec) + " of " + ONLINE_MAX + " left"; }
  // Below the thread: the composer (quick replies and the box), or at the online limit a short card with the ways on.
  function footHtml() {
    var all = turns(), last = all[all.length - 1], run = S.phase === "run";
    if (S.phase === "consent") return "";
    if (atCap(S.th.rec, S.mode) && !run) {
      var can = localOk(S.vd, S.ready);
      return '<div class="pa-cap" data-key="cap" role="status"><p><b>That is ' + ONLINE_MAX + " online questions in this chat.</b> Start a new chat, or keep going on this phone with no limit.</p>" +
        '<div class="pa-row"><button type="button" class="pn-btn pri" data-act="ak-new">Start a new chat</button><button type="button" class="pn-btn" data-act="ak-mode" data-v="local"' + (can ? "" : ' aria-disabled="true"') + ">Continue on this phone (unlimited)</button></div>" +
        (can ? "" : '<p class="pn-mut pn-small">' + esc(S.vd ? verdictMsg(S.vd, S.ready) : MSG.unknown).replace(/ You can ask MaiK online[^.]*\.$/, "") + "</p>") +
        (canHand() ? '<button type="button" class="pn-link pa-hlink" data-act="ak-hand">' + mkSmall() + "Or continue in MaiK Assistant</button>" : "") + "</div>";
    }
    var p = P(), qr = "";
    // Always drawn (no jump when MaiK starts or stops typing); not pressable while MaiK answers.
    var wait = run || (last && last.r === "u");
    qr = '<div class="pa-qr" data-key="qr" role="group" aria-label="Quick replies">' + quickReplies(S.ctx).map(function (q) { return '<button type="button" class="pa-q" data-act="ak-quick" data-v="' + esc(q) + '"' + (wait ? ' aria-disabled="true"' : "") + ">" + esc(q) + "</button>"; }).join("") + "</div>";
    return '<div class="pa-cmp" data-key="cmp">' + qr + '<div class="pa-box" data-key="box"><textarea id="paIn" rows="1" maxlength="' + (p ? p.CHAT_LIM.user : 300) + '" aria-label="Message MaiK" name="paIn" placeholder="Ask MaiK anything…" enterkeyhint="send" autocomplete="off">' + esc(S.draft || "") + "</textarea>" +
      '<button type="button" class="pa-send" data-act="ak-send" aria-label="Send"' + (run ? ' aria-disabled="true"' : "") + ">" + ic("send", 20) + "</button></div></div>";
  }
  function chatHtml() {
    return '<span class="pn-grab" aria-hidden="true"></span><div class="pa-top">' + avatar(30) + '<h2 id="paT">' + askLbl() + '</h2>' +
      '<button type="button" class="pn-ib" data-act="ak-close" aria-label="Close Ask MaiK">' + ic("close") + "</button></div>" +
      '<div class="pa-bar">' + segHtml() + '<p class="pa-stat" id="paStat">' + esc(statusText()) + "</p></div>" +
      '<div class="pa-body pt-chat">' + threadHtml() + "</div>" + footHtml();
  }
  // Is the conversation scrolled to (near) its end? Then new content keeps it there.
  function atEnd(b) { return !b || b.scrollHeight - b.scrollTop - b.clientHeight < 24; }
  /* The newest message in view: while MaiK types, the end of the chat; a new answer from its top when it is taller
     than the view, else the end. */
  function follow(b, sh) {
    b = b || body(); sh = sh || sheet(); if (!b || !sh) return;
    var li = S.phase === "run" ? null : sh.querySelector(".pa-last");
    li = li && li.closest ? li.closest("li") : null;
    if (li) {
      var d = li.getBoundingClientRect().top - b.getBoundingClientRect().top;
      if (li.offsetHeight > b.clientHeight - 16) { b.scrollTop += d - 8; return; }
    }
    b.scrollTop = b.scrollHeight;
  }
  function draw(focusSel) {
    var sh = sheet(); if (!sh) return;
    var b0 = sh.querySelector(".pa-body"), y = b0 ? b0.scrollTop : 0;
    // Patched in place (native pass 2): the thread keeps its node and its scroll; a view change (choose, chat) rebuilds.
    var html = S.view === "choose" ? chooseHtml() : chatHtml(), same = sh.getAttribute("data-view") === S.view;
    if (same && sh.firstChild && G.PREP_DOM) G.PREP_DOM.patch(sh, html); else sh.innerHTML = html;
    sh.setAttribute("data-view", S.view);
    sh.classList.toggle("pa-chat", S.view !== "choose");
    var b = sh.querySelector(".pa-body");
    if (b && !same) b.scrollTop = y;
    if (focusSel) { var f = sh.querySelector(focusSel), act = D.activeElement; if (f && !(act && act.id === "paIn" && focusSel === ".pa-last")) try { f.focus({ preventScroll: true }); } catch (e) {} }
    if (b && S.view !== "choose" && S.scroll) { S.scroll = false; follow(b, sh); }
    if (S.reveal >= 0) { var ri = S.reveal; S.reveal = -1; reveal(ri); }
  }
  /* Streaming-style reveal of a new answer: the checked text is already here, it is drawn word by word over 0.45 to
     1.4 s (transform-free, text only) with the chat following it. Off under reduced motion; screen readers get the
     whole answer once (aria-busy while it is drawn). */
  function reveal(idx) {
    var sh = sheet(), li = sh && sh.querySelector('.pt-msg[data-key="t' + idx + '"]'), box = li && li.querySelector(".pa-txt");
    if (!box || reduced() || !D.createTreeWalker) return;
    var tok = S.token, nodes = [], w = D.createTreeWalker(box, 4, null, false), n, total = 0;
    while ((n = w.nextNode())) { nodes.push([n, n.nodeValue]); total += n.nodeValue.length; }
    if (!total) return;
    var bub = box.parentNode, b = body(), t0 = Date.now(), dur = Math.min(1400, Math.max(450, total * 6));
    bub.setAttribute("aria-busy", "true"); bub.classList.add("pa-rev");
    var raf = G.requestAnimationFrame ? function (f) { G.requestAnimationFrame(f); } : function (f) { G.setTimeout(f, 16); };
    function put(k) {
      var shown = Math.round(total * k), used = 0;
      nodes.forEach(function (x) {
        var full = x[1], take = Math.max(0, Math.min(full.length, shown - used));
        if (take > 0 && take < full.length) { var sp = full.indexOf(" ", take); take = sp < 0 ? full.length : sp; }
        x[0].nodeValue = full.slice(0, take); used += full.length;
      });
    }
    function done() { put(1); bub.removeAttribute("aria-busy"); bub.classList.remove("pa-rev"); }
    function step() {
      if (!alive(tok) || !nodes[0][0].isConnected) return;
      var k = Math.min(1, (Date.now() - t0) / dur);
      var stick = b && li.getBoundingClientRect().top - b.getBoundingClientRect().top > 8;
      put(k);
      if (stick) b.scrollTop = b.scrollHeight;
      if (k < 1) raf(step); else done();
    }
    put(0); raf(step);
  }

  /* ---------- the on-screen keyboard ----------
     iOS (WKWebView, no Keyboard plugin) keeps the layout viewport and lays the keyboard over it; only the visual
     viewport shrinks, and WebKit pans it down to reveal the focused box. While Ask MaiK is open its wrap covers exactly
     the visible part of the screen, so the header, the conversation and the composer sit above the keyboard. Android
     (and a resized web view) shrinks the page itself; then the wrap simply fills the overlay as usual. A pinch zoom is
     left alone.
     Owner's iPhone (2026-10-10 recording): the sheet showed only its header, right above the keyboard. The old code put
     the wrap at visualViewport.offsetTop - rootRect.top; in the app's WKWebView the overlay's client rect moves with
     the pan (rootRect.top = -offsetTop), so the pan was counted twice and the wrap sat a keyboard height too low,
     clipped by the overlay. The place is now worked out in the overlay's own CSS px, from either measure, and checked:
     - visualViewport numbers are screen CSS px; the overlay lives inside html { zoom } (SMD_ZOOM), so they are divided
       by that zoom;
     - the wrap's top is where the visible area starts inside the overlay: the overlay's own client offset when the
       client rects move with the pan, else visualViewport.offsetTop;
     - the visible area can never reach below the overlay (it is fixed to the layout viewport), so a top that would put
       the wrap's bottom past it is pulled up until the wrap's bottom meets the overlay's bottom.
     It is re-measured on every visual viewport event, window resize and orientation change, and for 0.9 s after the box
     gains or loses focus (WebKit's events can stop before its pan does). */
  function zoomOf() {
    var de = D.documentElement, z = parseFloat(de.style.zoom);
    if (!(z > 0)) try { z = parseFloat(G.getComputedStyle(de).zoom); } catch (e) { z = 1; }
    return z > 0.3 && z < 4 ? z : 1;
  }
  function kbPlace(vv, r) {
    var z = zoomOf(), rr = r.getBoundingClientRect(), rh = r.clientHeight || (rr.height / z) || 0;
    var kr = rh ? (rr.height / rh) || z : z;                       // client px per overlay px (rects may or may not carry the zoom)
    var h = vv.height / z, top = rr.top < -1 ? -rr.top / kr : (vv.offsetTop || 0) / z;
    if (top + h > rh + 1) top = Math.max(0, rh - h);
    return { top: Math.max(0, top), h: Math.min(h, rh || h), full: rh, gap: rh - h };
  }
  function onVV() {
    var w = el(), vv = G.visualViewport, r = root(); if (!w || !vv || !r) return;
    if (r.scrollTop) r.scrollTop = 0;                                // the overlay itself never scrolls (a reveal must not move it)
    var b = body(), end = atEnd(b) || (S && S.kbFollow > Date.now()), p = kbPlace(vv, r);
    if ((vv.scale && Math.abs(vv.scale - 1) > 0.01) || (p.gap < 1 && p.top < 1)) {
      if (w.style.height) { w.style.top = ""; w.style.height = ""; w.style.bottom = ""; }
      w.classList.remove("pa-kb"); w.classList.remove("pa-kbs");
    } else {
      w.style.top = (Math.round(p.top * 10) / 10) + "px"; w.style.height = (Math.round(p.h * 10) / 10) + "px"; w.style.bottom = "auto";
      w.classList.toggle("pa-kb", p.gap > 120);
      w.classList.toggle("pa-kbs", p.gap > 120 && p.h < 300);       // a landscape phone: the place switch gives its row to the chat
    }
    if (b && end) follow(b, sheet());
  }
  // Re-measure each frame for a while: WebKit animates the keyboard and its pan, and its last event can come early.
  var kbRaf = 0, kbUntil = 0;
  function kbSettle(ms) {
    kbUntil = Math.max(kbUntil, Date.now() + (ms || 900));
    if (kbRaf) return;
    var raf = G.requestAnimationFrame || function (f) { return G.setTimeout(f, 16); };
    (function tick() { kbRaf = 0; if (!S) return; onVV(); if (Date.now() < kbUntil) kbRaf = raf(tick) || 1; })();
  }
  function onKbFocus(e) {
    if (!S || !e.target || e.target.id !== "paIn") return;
    if (e.type === "focusin") S.kbFollow = Date.now() + 1200;      // typing: the newest message comes into view with the keyboard
    kbSettle(900);
  }
  function onWinResize() { kbSettle(500); }
  function vvOn(on) {
    var vv = G.visualViewport, m = on ? "addEventListener" : "removeEventListener";
    G[m]("resize", onWinResize); G[m]("orientationchange", onWinResize);
    if (!vv || !vv.addEventListener) return;
    vv[m]("resize", onVV); vv[m]("scroll", onVV);
    if (on) onVV();
  }

  /* open(ctx, host). ctx: { kind: "mcq", item, chosen, n?, topic? } | { kind: "step", step, title } | { kind: "card", fr, bk, title }. */
  function open(ctx, host) {
    if (!ctx || !host || !host.root || !host.root()) return false;
    close(true);
    if (ctx.kind === "card") ctx = { kind: "card", step: { tx: String(ctx.fr || "") + "\n" + String(ctx.bk || "") }, title: ctx.title || "Card" };
    var ready = packReady(), pf = pref(host), th = threadFor(ctx);
    S = { ctx: ctx, host: host, prev: D.activeElement, vd: null, ready: ready, sel: firstChoice(pf, ready), dont: !!(pf && pf.q), view: "choose", mode: null, phase: "", token: ++seq, consented: false, th: th, draft: "", scroll: true, reveal: -1, cxOpen: false };
    var w = D.createElement("div");
    w.className = "pn-sheet-wrap pa-wrap" + (side() && ctx.side ? " pa-side" : "");
    w.id = "pnAsk";
    w.innerHTML = '<div class="pn-scrim" data-act="ak-close"></div><section class="pn-sheet pa-sheet" role="dialog" aria-modal="true" aria-labelledby="paT" tabindex="-1"></section>';
    host.root().appendChild(w);
    w.addEventListener("input", onInput);
    w.addEventListener("keydown", onComposeKey);
    w.addEventListener("focusin", onKbFocus); w.addEventListener("focusout", onKbFocus);
    w.addEventListener("toggle", function (e) { if (S && e.target && e.target.classList && e.target.classList.contains("pa-cx")) S.cxOpen = e.target.open; }, true);
    var mine = S;
    // A remembered choice that still works skips the question; else the sheet asks where, as before. Either way a thread
    // already started on this item continues (resume()).
    if (skipChoice(pf, ready)) { S.view = "chat"; resume(pf.m); }
    else draw();
    try { sheet().focus({ preventScroll: true }); } catch (e) {}
    vvOn(true);
    verdict().then(function (vd) {
      if (S !== mine) return;
      S.vd = vd; S.ready = packReady();
      // A phone that cannot run MaiK starts the choice on Online, said at once. The chat itself never switches places
      // by itself: an ask on this phone that cannot run says so and offers Online.
      if (!localOk(vd, S.ready) && S.sel === "local") S.sel = "online";
      if (S.phase !== "run") draw();
    });
    return true;
  }
  function close(quiet) {
    var w = el(), prev = S && S.prev;
    vvOn(false);
    if (w) w.parentNode.removeChild(w);
    S = null;
    if (!quiet && prev && prev.isConnected) try { prev.focus({ preventScroll: true }); } catch (e) {}
    return !!w;
  }
  function alive(tok) { return !!(S && S.token === tok && el()); }
  function onInput(e) { if (S && e.target && e.target.id === "paIn") S.draft = e.target.value; }
  function onComposeKey(e) {
    if (!S || !e.target || e.target.id !== "paIn") return;
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  }
  function addTurn(t) { var all = turns(); all.push(t); S.th.rec.ts = Date.now(); if (S.mode) S.th.rec.mode = S.mode; saveThreads(); }

  /* ask(mode, retry): MaiK's answer to the student's message at the end of the thread (the first, automatic ask on a
     fresh item, or the student's own), on the phone or online. Online counts the message toward this chat's 10 once
     (a retry or a re-ask in the same place does not count again); on this phone nothing is counted. */
  function ask(mode, retry) {
    var c = S.ctx, t = T(), p = P(), tok = S.token, all = turns(), rec = S.th.rec;
    if (!t || !p) { S.mode = mode; S.phase = ""; if (!all.length) all.push({ r: "u", t: title(), auto: 1 }); all.push({ r: "m", t: "", ok: false, first: all.length === 1, note: "Ask MaiK did not load. Close and open PrepNucleus again." }); return draw(); }
    S.mode = mode; S.usage = null; S.wallet = null; S.reveal = -1;
    if (!all.length) addTurn({ r: "u", t: title(), auto: 1 });
    var lastU = all[all.length - 1], first = all.length === 1 && (lastU.auto || lastU.t === title());
    // On this phone without a model that can run: said plainly, with Online one tap away (never a silent switch).
    if (mode === "local" && !localOk(S.vd || { v: "unknown" }, S.ready)) {
      S.phase = ""; S.scroll = true;
      addTurn({ r: "m", t: "", ok: false, mode: "local", first: first, why: "no-local", note: (S.vd ? verdictMsg(S.vd, S.ready) : MSG.nopack).replace(/ You can ask MaiK online[^.]*\.$/, "") + " Ask online to get an answer now." });
      return draw();
    }
    if (mode === "online" && !cloudAllowed() && !S.consented) { S.phase = "consent"; S.scroll = true; return draw(".pa-body [data-act=ak-consent]"); }
    if (mode === "online") {
      if (lastU.m !== "online") {
        if (atCap(rec, "online")) { S.phase = ""; S.scroll = true; return draw(); }
        lastU.m = "online"; rec.on = (rec.on | 0) + 1;
      }
    } else { if (lastU.m === "online") rec.on = Math.max(0, (rec.on | 0) - 1); lastU.m = "local"; }
    saveThreads();
    S.phase = "run"; S.t0 = Date.now(); S.scroll = true; draw();
    if (mode === "local") tick(tok);
    var finish = function (res) {
      if (mode === "local") t.setBusy(false);
      if (!alive(tok) || S.mode !== mode) return;
      res = res || { ok: false };
      var why = res.why || res.reason;
      var turn = res.ok ? { r: "m", t: res.text, ok: true, mode: mode } : { r: "m", t: "", ok: false, mode: mode, note: res.note, why: why, retry: retryable(res) };
      if (res.ok && res.beyond && res.beyond.length) turn.beyond = res.beyond;
      if (first) turn.first = true;
      if (mode === "local") turn.pack = t.packLabel();
      else if (S.usage && S.usage.mt != null) { turn.mt = S.usage.mt; if (S.wallet) { turn.bal = S.wallet.balanceMt; turn.capOn = !!S.wallet.costCapOn; } }
      if (why === "chat-limit") rec.on = ONLINE_MAX;
      S.phase = ""; S.scroll = true; addTurn(turn);
      if (res.ok) S.reveal = all.length - 1;
      draw(".pa-last");
    };
    var chosen = chosenOf(c), lex = G.SMD_DRUG_LEXICON || null;
    if (mode === "local") {
      if (t.isBusy()) { S.phase = "busy"; return draw(); }
      t.setBusy(true);
      return t.available().then(function (ok) {
        if (!ok) return { ok: false, why: "no-local", note: "MaiK Lite is not ready on this phone. Download it in Settings, MaiK, or ask online now." };
        return groundP().then(function (g) {
          if (!first) return p.teachChat(g.ground, turns(), { generate: function (prompt, system) { return t.localGenerate(prompt, system, { chat: true }); }, lexicon: lex, local: true });
          if (c.kind === "mcq") return p.teach(c.item, chosen, { generate: t.localGenerate, lexicon: lex, sents: g.sents });
          return p.teachStep(c.step, c.title, { generate: t.localGenerate, lexicon: lex });
        });
      }).then(finish, function () { finish({ ok: false, note: "MaiK could not answer on this phone just now." }); });
    }
    // Online: the same grounding the phone would use, sent to the server with this chat's id; checked here like the phone's.
    var n = rec.on, th = chatId();
    groundP().then(function (g) {
      if (!first) {
        return p.teachChat(g.ground, turns(), { lexicon: lex, generate: function (prompt, system, cx) {
          var body = { kind: "chat", base: c.kind === "mcq" ? "mcq" : "step", ground: g.ground, turn: n, messages: cx.messages, idem: idemFor(S.th.k + "|" + S.th.rec.cid, n, cx.messages), thread: th };
          if (cx.summary) body.summary = cx.summary;
          return online(body);
        } });
      }
      var body = c.kind === "mcq" ? { kind: "mcq", ground: g.ground, key: keyOf(c.item), chosen: chosen, thread: th, turn: n } : { kind: "step", ground: g.ground, title: String(c.title || "").slice(0, 200), thread: th, turn: n };
      var gen = function () { return online(body); };
      return c.kind === "mcq" ? p.teach(c.item, chosen, { generate: gen, lexicon: lex, sents: g.sents }) : p.teachStep(c.step, c.title, { generate: gen, lexicon: lex });
    }).then(finish, function () { finish({ ok: false, note: "MaiK could not answer online just now." }); });
  }
  // The grounding for this item: an MCQ's stored text (with a student deck's source sentences), or the step or card.
  function groundP() {
    var c = S.ctx, t = T(), p = P(), chosen = chosenOf(c);
    if (c.kind !== "mcq") return Promise.resolve({ ground: p.stepGround(c.step, c.title), sents: [] });
    return Promise.resolve(t.sourceSentences(c.item)).then(function (sents) { return { ground: p.groundingText(c.item, chosen, sents), sents: sents }; }, function () { return { ground: p.groundingText(c.item, chosen, []), sents: [] }; });
  }
  // A failure the student can retry as it is (connection, busy, an empty or failed answer); not a check failure,
  // tokens, sign-in, the chat limit or a phone that cannot run MaiK.
  function retryable(res) { var w = res && (res.why || res.reason); return !!w && w !== "check" && w !== "not-covered" && w !== "tokens" && w !== "sign-in" && w !== "no-grounding" && w !== "no-local" && w !== "chat-limit"; }
  /* send(text?): the student's message (the box, or a quick reply). Trimmed, at most CHAT_LIM.user characters, ignored
     while MaiK is answering; online it stops at this chat's 10, on this phone it never stops. */
  function send(quick) {
    var p = P(); if (!S || !p || S.phase === "run" || S.phase === "consent") return;
    var box = sheet() && sheet().querySelector("#paIn"), txt = String(quick || (box && box.value) || S.draft || "").replace(/\s+/g, " ").trim().slice(0, p.CHAT_LIM.user);
    var mode = S.mode || "online";
    if (!txt) return;
    if (atCap(S.th.rec, mode)) return draw();
    if (!quick || (box && !box.value)) { S.draft = ""; if (box) box.value = ""; }
    S.th.rec.nc = 0;
    addTurn({ r: "u", t: txt });
    ask(mode);
  }
  /* resume(mode): open the chat in this place. A fresh thread asks its first question (a "new chat" opens empty); a
     thread whose last answer failed asks that message again; one that ended on an answer just shows (no new call). */
  function resume(mode) {
    var all = turns(), last = all[all.length - 1];
    if (!all.length) { if (S.th.rec.nc) { S.mode = mode; S.phase = ""; return draw(); } return ask(mode); }
    if (last.r === "u" || !last.ok) { if (last.r === "m") { all.pop(); saveThreads(); } return ask(mode); }
    S.mode = mode; S.phase = ""; S.scroll = true; return draw();
  }
  // Try again: MaiK's failed answer to the last message is dropped and asked again (not a new student message).
  function retry() {
    var all = turns(), last = all[all.length - 1];
    if (!last || last.r !== "m" || last.ok) return;
    all.pop(); saveThreads();
    ask(S.mode || "online", true);
  }
  // Start a new chat on the same item: the turns and this chat's online count go, a new chat id, the place stays.
  function newChat() {
    var r = S.th.rec;
    r.turns.length = 0; r.on = 0; r.cid = newCid(); r.nc = 1; r.ts = Date.now();
    S.phase = ""; S.scroll = true; S.draft = ""; saveThreads();
    draw("#paIn");
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
      // No answer yet, or the last one failed: ask it again in the new place. Otherwise the next message goes there.
      if ((!all.length && !S.th.rec.nc) || S.phase === "consent" || S.phase === "busy" || (last && last.r === "m" && !last.ok)) {
        if (last && last.r === "m" && !last.ok) { all.pop(); saveThreads(); }
        S.phase = ""; return ask(v);
      }
      if (v === S.mode) return;
      S.mode = v; S.th.rec.mode = v; saveThreads(); return draw('.pa-seg [data-act=ak-mode][data-v="' + v + '"]');
    }
    if (a === "ak-consent") { S.consented = true; return ask("online"); }
    if (a === "ak-send") { if (b.getAttribute("aria-disabled") === "true") return; return send(); }
    if (a === "ak-quick") { if (b.getAttribute("aria-disabled") === "true") return; return send(v); }
    if (a === "ak-new") return newChat();
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
