/* PrepNucleus Layer C: make a question deck from the student's own PDF or notes. window.PREP_C. ES5.
   Contract: vault/plans/PrepNucleus-LayerC.md 6.0 (one op per HTTP call), 6.1 to 6.7, 8.2 labels, 8.5 privacy, 9.3 caps.
   Needs prep-source.js (PREP_SRC), prep-decks.js (PREP_DECKS) and prep-cards.js (PREP_CARDS) loaded first; prep.js
   forwards every data-act starting "c-" to PREP_C.act(act, button, HOST) and draws the screens through HOST.

   The phone drives the pipeline. For "10 questions" (and every "10 more"): `facts` on the first chunk of each section
   until there are at least 14 unused facts, then `mcq` x2 (7 facts each), `solve` x2 (blind check of the key),
   `review` x2 (gates), one regeneration per failed fact (batched, with the reasons in `avoid`), and the phone saves what
   passed. Each op is one POST /api/ai/prep-generate with a Firebase ID token and an idempotency key (sha12 of op plus
   payload), so a retry is free; a 504 is retried once after 4 s. Nothing pasted or read from a PDF is logged or sent
   anywhere else, and only scrubbed, numbered sentences are sent. Bank first is skipped: matching a whole source
   against the bank needs each subject's search.json (not shipped with the app), which is not cheap on a phone.

   Items are stored in the engine format with _s "deck" and _m "deck-<deckId>", so the shared runner writes their
   FSRS cards under "p:deck-<deckId>". No AI or source label is shown anywhere (owner rule). Pure helpers load under
   node for tests.

   Owner 2026-10-09: 5 new decks a day and 30 a month (the server's prepCaps agrees); at most 50 questions a deck,
   made 10 at a time ("Make 10 more", "20 of 50"), each round under the same cost ceiling (ceil(10 x 1.4 / 7) mcq
   batches); a deck screen holds the deck's questions as a module with progress; the MaiK Tokens a round is expected to
   use are shown before it and what it used after (usage.mt). A round is saved as it goes (manifest run), so a round cut
   off by the app going to the background, or closing, continues where it stopped. A PDF's pages are chosen on a page
   picker (thumbnails, 60 at most), never taken silently.

   Image questions (PDF only): after the text is read, the pictures on the chosen pages are cut out on the phone
   (PREP_SRC.extractImages: at least 200 x 200 px, no logos or running headers, at most 20, at most 1280 px) and shown as
   a strip; the student keeps the ones to use. After the text round, each kept image is one `imcq` call with the page
   text near it (PREP_SRC.nearSents); the server keeps a question only when the page text states its key, else the image
   is skipped. An image that got a question is stored with the deck (prep-imgs, a data: URL) and shown with the stem
   (imgPlace "stem") through the PYQ figure and zoom. The image is sent only for that call and kept nowhere else. */
(function (G) {
  "use strict";
  var isNode = typeof module !== "undefined" && module.exports && !(G && G.document);
  var DK = isNode ? require("./prep-decks.js") : G.PREP_DECKS;
  var SR = isNode ? require("./prep-source.js") : G.PREP_SRC;

  /* ================= pure ================= */
  var URL = "/api/ai/prep-generate", MODEL = "gemini-3.1-flash-lite", PV = "p1", BATCH = 7, TARGET = 10, RETRY_MS = 4000, TIMEOUT_MS = 45000;
  /* TIMEOUT_MS: the phone gives up on one call after 45 s, longer than the router's 28 s AI deadline plus the time to
     store the idempotency record, so a slow but successful call has normally been answered (and recorded) before the
     phone resends it with the same idem. Residual risk: if the first request is still in flight on the server when
     the phone's resend arrives (a network stall longer than 45 s, or a server queue), both can reach the model and be
     charged; the server answers the resend from the replay record only once the first one has finished. */
  var MONTH_CAP = 30, DAY_CAP = 5, DECK_MAX = 50, IMG_PER_ROUND = 5;
  /* MaiK Tokens a round of 10 is expected to use before a deck has history: about 30k tokens in and 10k out on
     gemini-3.1-flash-lite (Rs 0.024 / 0.144 per 1k) = Rs 2.2, at 2,000 MT a rupee (_credits.js MT_PER_INR). */
  var MT_ROUND_DEFAULT = 4500;
  // The exams a deck can be written for (the server's EXAM_PROFILES); FMGE decks use the NEET-PG profile.
  var CREATE_EXAMS = [{ id: "neet-pg", label: "NEET-PG" }, { id: "ini-cet", label: "INI-CET" }, { id: "neet-ss", label: "NEET-SS" }, { id: "usmle", label: "USMLE" }];
  var DIFFS = [{ id: "mix", label: "Exam mix" }, { id: 1, label: "Easy" }, { id: 2, label: "Moderate" }, { id: 3, label: "Hard" }];
  function createExam(id) { for (var i = 0; i < CREATE_EXAMS.length; i++) if (CREATE_EXAMS[i].id === id) return id; return "neet-pg"; }
  var PROFILE = { id: "neet-pg", v: 1, cog: { recall: 0.4, application: 0.4, reasoning: 0.2 }, d: { 1: 0.3, 2: 0.5, 3: 0.2 } };

  /* ---------- errors (6.0): { error, reason, retryAfter? } -> one short message ---------- */
  var MSG = {
    "bad-input": "The source could not be used. Try a shorter or cleaner piece of text.",
    "sign-in": "Sign in to make a deck. Your decks are kept on this phone and in your account.",
    "needs-plan": "Making decks is not part of your plan.",
    "too-large": "This source is too large for one deck. Pick fewer pages.",
    "rate": "Too many requests at once. Wait a few seconds and try again.",
    "circuit-breaker": "Deck making is paused for today. Please try again tomorrow.",
    "daily-calls": "You have reached today's limit for making questions. Try again tomorrow.",
    "daily-decks": "You have made 5 decks today, the daily limit. Try again tomorrow, or add questions to a deck you have.",
    "month-decks": "You have made 30 decks this month, the monthly limit. Your decks still work for practice.",
    "ai-cost-cap": "You have used today's free MaiK Tokens. Add MaiK Tokens or go Pro to keep making questions. Your decks still work for practice.",
    "deck-full": "This deck has all its 50 questions. Make a new deck for more.",
    "token-cap": "This deck has reached its size limit. The questions made so far are saved.",
    "ai-failed": "The question writer sent back something unusable. Try again.",
    "ai-timeout": "The question writer took too long. Try again.",
    "offline": "No connection. Check the internet and try again.",
    "storage": "The phone storage is full, so the deck could not be saved. Free some space and try again.",
    "deck-not-started": "The server no longer knows this deck, so it cannot add questions. Make a new deck from the same source.",
    "unknown": "Something went wrong. Try again."
  };
  var BY_STATUS = { 400: "bad-input", 401: "sign-in", 402: "needs-plan", 413: "too-large", 429: "rate", 502: "ai-failed", 504: "ai-timeout" };
  // Codes that end the run for now; "Try again" is offered for the rest.
  var STOPS = { "deck-not-started": 1, "sign-in": 1, "needs-plan": 1, "bad-input": 1, "too-large": 1, "circuit-breaker": 1, "daily-calls": 1, "daily-decks": 1, "month-decks": 1, "token-cap": 1, "ai-cost-cap": 1, "deck-full": 1 };
  // Codes the manifest records in cost.stopped (6.7).
  var CAP_STOPS = { "token-cap": 1, "month-decks": 1, "daily-decks": 1, "daily-calls": 1, "circuit-breaker": 1, "ai-cost-cap": 1, "deck-full": 1 };
  // Codes worth trying again by themselves when the app comes back to the front (the phone lost the network, or the
  // call was cut off while the app was in the background).
  var AUTO_RESUME = { offline: 1, "ai-timeout": 1, unknown: 1, rate: 1 };
  function errorCode(status, body) {
    var b = body && typeof body === "object" ? body : {}, c = [b.reason, b.error, b.code];
    for (var i = 0; i < c.length; i++) if (typeof c[i] === "string" && MSG[c[i]]) return c[i];
    if (status === 0) return "offline";
    return BY_STATUS[status] || "unknown";
  }
  function errorMessage(status, body) { return MSG[errorCode(status, body)]; }
  function canRetry(code) { return !STOPS[code]; }
  /* Milliseconds to wait before the one retry, or 0 for none: a 504 (or the phone's own timeout) after 4 s (6.0); a
     429 "rate" (the per-user 3 s limit) after its retryAfter, at least 3.5 s. Never a second retry. */
  function shouldRetry(status, attempt, code, retryAfter, retryMs) {
    if (attempt !== 0) return 0;
    if (status === 504) return retryMs == null ? RETRY_MS : retryMs;
    if (status === 429 && code === "rate") return Math.max(3500, (+retryAfter || 0) * 1000);
    return 0;
  }
  function opError(status, body) { var e = new Error("prep-generate " + status); e.status = status; e.body = body || null; e.code = errorCode(status, body); return e; }

  /* ---------- ids ---------- */
  function without(o, key) { var out = {}; for (var k in o) if (k !== key) out[k] = o[k]; return out; }
  // sha12 of op plus payload: the same request always carries the same key, so the server can answer a retry from its
  // 10-minute record without a second AI call or charge.
  function idemKey(op, body) { return DK.sha12(op + JSON.stringify(without(body, "idem"))); }
  function deckIdFor(o) { return "gen_" + DK.sha12([o.uid || "anon", o.sha, o.exam, o.profileV, o.pv || PV, o.model || MODEL].join("|")); }

  /* ---------- requested mix: the profile's cog and d shares (6.9) as weights 0 to 1 that sum to 1, which is what the
     server reads (a weight map, or one level). share() turns shares into counts for n questions. ---------- */
  function weights(w) {
    var keys = Object.keys(w || {}), tot = 0, out = {};
    keys.forEach(function (k) { tot += Math.max(0, +w[k] || 0); });
    if (!tot) return null;
    keys.forEach(function (k) { var v = Math.max(0, +w[k] || 0) / tot; if (v > 0) out[k] = Math.round(v * 1000) / 1000; });
    return out;
  }
  function share(n, w) {
    var keys = Object.keys(w), tot = 0, out = {}, rest = [], used = 0;
    keys.forEach(function (k) { tot += +w[k] || 0; });
    if (!tot) return out;
    keys.forEach(function (k) { var x = n * (+w[k] || 0) / tot; out[k] = Math.floor(x); used += out[k]; rest.push({ k: k, r: x - out[k] }); });
    rest.sort(function (a, b) { return b.r - a.r; });
    for (var i = 0; used < n && i < rest.length; i++, used++) out[rest[i].k]++;
    return out;
  }
  // diff: "mix" (the exam's own spread) or one level 1 to 3 chosen on the create screen.
  function mixFor(n, prof, diff) { prof = prof || PROFILE; return { dl: diff === 1 || diff === 2 || diff === 3 ? diff : weights(prof.d || PROFILE.d), cog: weights(prof.cog || PROFILE.cog) }; }

  /* ---------- usage, caps and cost lines ---------- */
  function addUsage(cost, u) {
    if (!u) return cost;
    cost.inTok += +u.inTok || 0; cost.outTok += +u.outTok || 0; cost.thinkTok += +u.thinkTok || 0;
    cost.inr = Math.round((cost.inr + (+u.inr || 0)) * 10000) / 10000;
    cost.mt = (+cost.mt || 0) + (+u.mt || 0);
    return cost;
  }
  function dayKey(d) { d = d || new Date(); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  // The deck counters the server returned, stamped with the day they belong to.
  function capsFrom(u, day) {
    if (!u || (u.monthDecks == null && u.dayDecks == null)) return null;
    return { month: u.monthDecks == null ? null : +u.monthDecks, day: u.dayDecks == null ? null : +u.dayDecks, at: day };
  }
  // "7 of 10 decks this month, 2 of 3 today", or only the parts still current; "" when nothing is known.
  function capLine(caps, today) {
    if (!caps || !caps.at || !today) return "";
    var parts = [];
    if (caps.month != null && caps.at.slice(0, 7) === today.slice(0, 7)) parts.push(Math.min(caps.month, MONTH_CAP) + " of " + MONTH_CAP + " decks this month");
    if (caps.day != null && caps.at === today) parts.push(Math.min(caps.day, DAY_CAP) + " of " + DAY_CAP + " today");
    return parts.join(", ");
  }
  // A cap refusal says where the counter stands even though no usage came back: the month or the day is full.
  function capsAfterStop(caps, code, today) {
    if (code !== "month-decks" && code !== "daily-decks") return caps;
    var c = caps && caps.at === today ? { month: caps.month, day: caps.day, at: today } : { month: caps && caps.at && caps.at.slice(0, 7) === today.slice(0, 7) ? caps.month : null, day: null, at: today };
    if (code === "month-decks") c.month = MONTH_CAP; else c.day = DAY_CAP;
    return c;
  }
  /* MaiK Tokens. The estimate for the next 10: this deck's own average per round once it has one, else the default;
     rounded to 100. */
  function mtEstimate(m) {
    var r = m && m.rounds, mt = m && m.cost && +m.cost.mt;
    var v = r > 0 && mt > 0 ? mt / r : MT_ROUND_DEFAULT;
    return Math.max(100, Math.round(v / 100) * 100);
  }
  // How many questions the next round asks for: 10, or what is left under the deck's 50.
  function roundTarget(count) { return Math.max(0, Math.min(TARGET, DECK_MAX - (+count || 0))); }
  /* A deck as a module: questions, how many were answered at least once, accuracy and what is due today. */
  function deckStats(m, store, today) {
    var n = DK.questionCount(m), pg = deckProgress(store, m.id, today), md = (store && store.mod && store.mod["deck-" + m.id]) || null;
    var t = md ? +md.t || 0 : 0, ok = md ? +md.ok || 0 : 0;
    return { n: n, max: DECK_MAX, answered: Math.min(pg.answered, n), due: pg.due, cardsDue: pg.cardsDue, acc: t ? Math.round(ok * 100 / t) : null, attempts: t, full: n >= DECK_MAX };
  }
  function costLine(cost) {
    if (!cost || !(cost.inTok || cost.outTok)) return "";
    return "Cost so far: Rs " + (+cost.inr || 0).toFixed(2) + " (" + (cost.inTok + cost.outTok + (cost.thinkTok || 0)) + " tokens)";
  }

  /* ---------- server responses -> stored records ---------- */
  function norm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
  function pagesOf(sn, byN) { var out = []; (sn || []).forEach(function (n) { var s = byN[n]; if (s && out.indexOf(s.p) < 0) out.push(s.p); }); return out.sort(function (a, b) { return a - b; }); }
  /* A fact from the facts op (6.1 with fid, quote, p, h) -> the stored fact, or null when it does not cite sentences of
     the chunk it came from. The quote is not kept: the sentences are on the phone already. */
  function factRecord(f, deckId, chunk, byN) {
    if (!f || typeof f.fid !== "string" || !f.ft || !f.cq || !f.sn || !f.sn.length) return null;
    var inChunk = {};
    chunk.sents.forEach(function (s) { inChunk[s.n] = 1; });
    var sn = [];
    for (var i = 0; i < f.sn.length; i++) { var n = +f.sn[i]; if (!inChunk[n]) return null; sn.push(n); }
    var first = byN[sn[0]];
    return { id: f.fid, deckId: deckId, ft: String(f.ft), cq: String(f.cq), sn: sn, fk: f.fk || "recall", p: pagesOf(sn, byN), h: first.h, sec: first.s, used: false, chunk: chunk.i };
  }
  // What the mcq op receives for one fact: its local index fi, the fact and its sentences.
  /* A restored deck (from the account backup) has no source sentences on this phone: its unused facts carry the one or
     two sentences they cite as quote, which the server takes in place of sents. */
  function factPayload(f, fi, byN) {
    var out = { fi: fi, fid: f.id, ft: f.ft, cq: f.cq, sn: f.sn, fk: f.fk, p: f.p, h: f.h };
    if (/^[a-z0-9-]{1,40}$/.test(String(f.sec || ""))) out.t = f.sec;   // the server stamps it on the item
    var all = f.sn.every(function (n) { return byN[n] && byN[n].tx; });
    if (all || !f.quote) out.sents = f.sn.map(function (n) { var s = byN[n]; return { n: n, tx: s ? s.tx : "" }; });
    else out.quote = String(f.quote).slice(0, 4000);
    return out;
  }
  // The review paragraph: sentences n-3 .. n+3 around the cited ones, at most about 250 tokens.
  function paraFor(sn, byN) {
    if (!sn || !sn.length) return "";
    var lo = Math.min.apply(null, sn) - 3, hi = Math.max.apply(null, sn) + 3, out = [];
    for (var n = lo; n <= hi; n++) if (byN[n]) out.push("[" + n + "] " + byN[n].tx);
    var t = out.join(" ");
    return t.length > 1000 ? t.slice(0, 1000) : t;
  }
  function gatesPass(g) {
    if (!g) return false;
    var k = ["g4", "g6", "g7", "g8", "g9", "g10", "g11"];
    for (var i = 0; i < k.length; i++) if (g[k[i]] !== true) return false;
    return true;
  }
  var PROVS = { AI: 1, LIC: 1, SMD: 1, USR: 1, PUB: 1 };
  /* A reviewed item (6.4) -> the stored item for the shared runner, or null when it is not a usable question. */
  function toStored(it, f, deckId, ctx) {
    if (!it || typeof it.q !== "string" || !it.q.trim() || !it.o || it.o.length !== 4) return null;
    var a = +it.a;
    if (!(a >= 0 && a <= 3) || a !== Math.floor(a)) return null;
    for (var i = 0; i < 4; i++) if (typeof it.o[i] !== "string" || !it.o[i].trim()) return null;
    var fid = it.fid || (f && f.id) || "";
    var r = it.r && it.r.length === 4 ? it.r.map(function (x) { return x == null ? "" : String(x); }) : null;
    return {
      id: typeof it.id === "string" && it.id ? it.id : "q_" + DK.sha12(deckId + fid + norm(it.q)),
      q: it.q, o: it.o.slice(0, 4), a: a, exp: String(it.exp || (r && r[a]) || ""), t: (f && f.sec) || it.t || "sec-0",
      d: it.d === 1 || it.d === 3 ? it.d : 2, r: r, kp: it.kp ? String(it.kp) : "", et: it.et && it.et.length === 4 ? it.et : null, cog: it.cog || null, fid: fid,
      src: { doc: ctx.doc, name: ctx.name, p: f ? f.p : [], h: f ? f.h : "", sn: f ? f.sn : [] },
      prov: PROVS[it.prov] ? it.prov : "USR", gen: "AI", ex: [ctx.exam], pv: it.pv || ctx.pv || PV, mv: it.mv || ctx.model || MODEL,
      rv: it.rv || null, deckId: deckId, _s: "deck", _m: "deck-" + deckId
    };
  }
  // One flashcard per fact (6.5): front = the fact's question, back = the fact.
  function toCard(f, deckId, ctx) {
    return { id: "c_" + DK.sha12(deckId + f.id), fid: f.id, front: f.cq, back: f.ft, src: { doc: ctx.doc, name: ctx.name, p: f.p, h: f.h, sn: f.sn }, prov: "AI", deckId: deckId };
  }
  // Gate 12 on the phone: token Jaccard >= 0.6 against the stems already saved in the deck.
  function tokens(s) { var o = {}; (norm(s).match(/[a-z0-9]{3,}/g) || []).forEach(function (w) { o[w] = 1; }); return o; }
  function jaccard(a, b) {
    var ta = tokens(a), tb = tokens(b), inter = 0, uni = 0, k;
    for (k in ta) { uni++; if (tb[k]) inter++; }
    for (k in tb) if (!ta[k]) uni++;
    return uni ? inter / uni : 0;
  }
  function nearDup(stem, stems) { for (var i = 0; i < stems.length; i++) if (jaccard(stem, stems[i]) >= 0.6) return true; return false; }

  /* ---------- deck progress in the host store ---------- */
  function deckKey(deckId) { return "p:deck-" + deckId; }
  function cardDeckKey(deckId) { return "p:cards-" + deckId; }
  function deckProgress(store, deckId, today) {
    var out = { answered: 0, due: 0, cardsSeen: 0, cardsDue: 0 }, q = deckKey(deckId) + ":", c = cardDeckKey(deckId) + ":";
    for (var k in (store && store.cards) || {}) {
      var v = store.cards[k];
      if (k.indexOf(q) === 0) { out.answered++; if (v[3] <= today) out.due++; }
      else if (k.indexOf(c) === 0) { out.cardsSeen++; if (v[3] <= today) out.cardsDue++; }
    }
    return out;
  }
  // Deleting a deck removes its FSRS memory, answer counts and bookmarks from the host store too.
  function purgeStore(store, deckId) {
    var q = deckKey(deckId) + ":", c = cardDeckKey(deckId) + ":", m = "deck-" + deckId, k;
    for (k in store.cards) if (k.indexOf(q) === 0 || k.indexOf(c) === 0) delete store.cards[k];
    if (store.conf) delete store.conf[deckKey(deckId)];
    if (store.mod) delete store.mod[m];
    if (store.bm) for (k in store.bm) if (store.bm[k] && store.bm[k][1] === m) delete store.bm[k];
    if (store.last && store.last.m === m) store.last = null;
    return store;
  }
  /* What the phone could not read as text, in counts (no page numbers on screen): rd = readPages() result,
     canOcr = the app has on-device OCR. "" when every page had a good text layer. */
  function readNote(rd, canOcr) {
    var n = rd && rd.ocrPages ? rd.ocrPages.length : 0, by = {}, out = [];
    ((rd && rd.skipped) || []).forEach(function (x) { by[x.why] = (by[x.why] || 0) + 1; });
    var pg = function (k) { return k + (k === 1 ? " page" : " pages"); };
    if (n) out.push(pg(n) + " read by on-device OCR.");
    if (by["no-text"]) out.push(pg(by["no-text"]) + (canOcr ? " had no text to read." : " skipped: scanned pages are read only in the StewardMD phone app, not on the web."));
    if (by["garbled"]) out.push(pg(by["garbled"]) + " skipped: their text could not be read cleanly.");
    if (by["ocr-cap"]) out.push(pg(by["ocr-cap"]) + " skipped: up to " + SR.OCR_PAGE_CAP + " scanned pages are read by OCR in one deck.");
    if (by["ocr-failed"]) out.push(pg(by["ocr-failed"]) + " could not be read by OCR.");
    return out.join(" ");
  }
  // Nothing readable at all: the one message that says why.
  function unreadableMessage(rd, canOcr) {
    var sk = (rd && rd.skipped) || [];
    if (!canOcr && sk.length && sk.every(function (x) { return x.why === "no-text"; })) return "These pages are scanned images. Scans are read only in the StewardMD phone app, not on the web. Paste the text instead.";
    if (sk.length && sk.every(function (x) { return x.why === "garbled"; })) return "The text on these pages could not be read cleanly. Try other pages, or paste the text instead.";
    return "No readable text was found on these pages. Try other pages, or paste the text instead.";
  }
  function defaultTitle(doc, name) {
    if (name) return String(name).replace(/\.pdf$/i, "").slice(0, 80);
    var h = doc.sections.length && doc.sections[0].title;
    if (h && h !== "General") return h.slice(0, 80);
    var w = ((doc.sents[0] && doc.sents[0].tx) || "My notes").split(/\s+/).slice(0, 6).join(" ");
    return w.replace(/[.,;:]$/, "") || "My notes";
  }

  /* ---------- the step loop ---------- */
  /* A round: target questions (10, or what is left under 50). With images waiting, up to 5 of the 10 are image
     questions: the text part asks for the rest, and its batch ceiling (the cost ceiling) is set from that. */
  function newRound(target, imgN) {
    var ti = target - Math.min(+imgN || 0, IMG_PER_ROUND, target);
    return { target: target, textTarget: ti, accepted: 0, textAcc: 0, maxBatches: Math.ceil(ti * 1.4 / BATCH), started: 0, batches: [], failed: [], mt: 0 };
  }
  // The round as saved in the manifest while it runs (m.run), and back.
  function runSnap(r) { return JSON.parse(JSON.stringify(r)); }
  function runOk(r) { return !!(r && typeof r === "object" && r.target > 0 && Array.isArray(r.batches) && Array.isArray(r.failed)); }
  /* o = { m (manifest), sents, sections, facts (stored), items (stored), saved, target, profile, ctx } */
  function newJob(o) {
    var job = { m: o.m, deckId: o.m.id, sents: o.sents, sections: o.sections || [], byN: {}, chunks: SR.chunkSentences(o.sents), order: [], done: {},
      facts: {}, factOrder: [], stems: [], tlist: [], round: null, saved: !!o.saved, stopReq: false, stopped: null,
      steps: 0, phase: "", caps: null, profile: o.profile || PROFILE, ctx: o.ctx || {}, imgQ: (o.imgs || []).slice(0, SR.IMG_CAP || 20), imgDone: 0, imgKept: 0, wallet: null };
    job.round = runOk(o.m.run) ? runSnap(o.m.run) : newRound(o.target == null ? TARGET : o.target, job.imgQ.length);
    if (job.round.textTarget == null) { job.round.textTarget = job.round.target; job.round.textAcc = job.round.accepted; }
    job.sents.forEach(function (s) { job.byN[s.n] = s; });
    job.order = SR.chunkOrder(job.chunks);
    ((o.m.prog && o.m.prog.done) || []).forEach(function (i) { job.done[i] = 1; });
    var rank = {};
    job.order.forEach(function (ci, i) { rank[ci] = i; });
    (o.facts || []).slice().sort(function (a, b) { return (rank[a.chunk] - rank[b.chunk]) || (a.sn[0] - b.sn[0]); }).forEach(function (f) { job.facts[f.id] = f; job.factOrder.push(f.id); });
    (o.items || []).forEach(function (it) { job.stems.push(it.q); job.tlist.push({ t: it.t }); });
    return job;
  }
  function unusedFids(job) { return job.factOrder.filter(function (id) { return !job.facts[id].used; }); }
  function nextChunk(job) { for (var i = 0; i < job.order.length; i++) if (!job.done[job.order[i]]) return job.order[i]; return null; }
  // Material left for a later "10 more".
  function hasMore(job) { return unusedFids(job).length > 0 || nextChunk(job) != null; }
  /* The next op, or null when the round is over. Batches move stage by stage (all mcq, then all solve, then all
     review), then the failed facts are regenerated once, then the round ends at the target or when its batches
     (ceil(target x 1.4 / 7): 2 for 10 questions) are spent, so a round's cost has a ceiling. A round asks for as many
     facts as questions it still wants (10 for a fresh round), so it never makes more than its 10 and a deck never
     passes 50. */
  /* After the text round: one imcq per chosen image (job.imgQ), once the deck is started on the server (a facts call
     was accepted, so job.saved), unless the student stopped or a cap stopped the run. */
  function nextOp(job) {
    var op = textOp(job);
    if (op || job.stopped || job.stopReq) return op;
    return job.imgQ && job.imgQ.length && job.saved && job.round.accepted < job.round.target ? { op: "imcq" } : null;
  }
  function textOp(job) {
    var r = job.round, st = ["mcq", "solve", "review"], i, k;
    if (job.stopped || job.stopReq) return null;
    for (k = 0; k < st.length; k++) for (i = 0; i < r.batches.length; i++) if (r.batches[i].stage === st[k]) return { op: st[k], b: i };
    if (r.failed.length) return { op: "regen" };
    if (r.textAcc >= r.textTarget || r.accepted >= r.target) return null;
    if (r.maxBatches - r.started <= 0) return null;
    // Facts for the questions still wanted this round (not more: a round of 10 asks for 10, and the failed ones get
    // their one regeneration), read chunk by chunk until there are enough or the source is used up.
    var want = r.textTarget - r.textAcc, unused = unusedFids(job).length;
    if (unused < want) { var c = nextChunk(job); if (c != null) return { op: "facts", chunk: c }; }
    if (unused) return { op: "batch" };
    return null;
  }
  var PHASE = { imcq: "Writing questions on your images", facts: "Finding the key facts in your source", mcq: "Writing questions", solve: "Checking each answer blind", review: "Reviewing each question", regen: "Rewriting the questions that failed a check", batch: "Writing questions" };

  // The server's code-gate names (mcq "rejected") as the reason handed back in avoid.
  var GATE_WHY = { g1: "it did not have exactly four options", g2: "the key was repeated as a distractor", g3: "two options were the same",
    g5: "the key was much longer or shorter than the distractors", g9b: "a number in the key is not in the source", verbatim: "it copied the source word for word",
    g12: "it repeated another question" };
  function base(job, op) { return { op: op, deckId: job.deckId, exam: job.m.exam, profileV: job.m.profileV, pv: job.m.pv }; }
  function fail(job, b, fid, why) {
    if (b.regen) return;
    var r = job.round;
    for (var i = 0; i < r.failed.length; i++) if (r.failed[i].fid === fid) return;
    r.failed.push({ fid: fid, why: String(why || "failed a check").slice(0, 160) });
  }
  function srcRec(job) { return { deckId: job.deckId, name: job.m.source.name, type: job.m.source.type, sents: job.sents, sections: job.sections }; }
  // The manifest with the running round in it, so a round cut off by the app closing continues from here.
  function saveDeck(job, store) { job.m.run = job.over ? null : runSnap(job.round); return store.putDeck(job.m); }
  // An image waiting for its question, as kept on the phone (prep-imgs, pend 1) until its turn.
  function pendImg(job, img) { return { id: "i_" + DK.sha12(job.deckId + img.k), deckId: job.deckId, k: img.k, p: img.p, w: img.w, h: img.h, data: img.data, pend: 1 }; }

  /* Run one op. deps = { send(body) -> Promise(json), store: PREP_DECKS-like, onCaps(caps)? }. Resolves when the op's
     result is applied and saved. A failed send leaves the job as it was, so the same op (same idem) is re-sent. */
  function step(job, op, deps) {
    var r = job.round, m = job.m, store = deps.store, body, b;
    job.phase = op.op;
    if (op.op === "batch") {
      var ids = unusedFids(job).slice(0, Math.max(1, r.textTarget - r.textAcc)), n = Math.min(r.maxBatches - r.started, Math.ceil(ids.length / BATCH)), size = Math.min(BATCH, Math.ceil(ids.length / n));
      var touched = [];
      for (var k = 0; k < n; k++) {
        var part = ids.slice(k * size, (k + 1) * size);
        if (!part.length) continue;
        part.forEach(function (id) { job.facts[id].used = true; touched.push(job.facts[id]); });
        r.batches.push({ fids: part, stage: "mcq", regen: false, items: [] });
        r.started++;
      }
      return store.putFacts(touched);
    }
    if (op.op === "regen") {
      var take = r.failed.slice(0, BATCH);
      r.failed = r.failed.slice(BATCH);
      r.batches.push({ fids: take.map(function (x) { return x.fid; }), stage: "mcq", regen: true, items: [], avoid: take.length === 1 ? { fi: 0, why: take[0].why } : take.map(function (x, fi) { return { fi: fi, why: x.why }; }) });
      m.stats.regenerated += take.length;
      return Promise.resolve();
    }
    job.steps++;
    body = base(job, op.op);
    if (op.op === "imcq") return stepImage(job, body, deps);
    if (op.op === "facts") {
      var chunk = job.chunks[op.chunk];
      body.chunk = SR.chunkPayload(chunk);
      return deps.send(body).then(function (res) {
        applyUsage(job, res, deps);
        var fresh = [], cards = [];
        (res.facts || []).forEach(function (f) {
          var rec = factRecord(f, job.deckId, chunk, job.byN);
          if (!rec || job.facts[rec.id]) return;
          job.facts[rec.id] = rec; job.factOrder.push(rec.id); fresh.push(rec); cards.push(toCard(rec, job.deckId, job.ctx));
        });
        job.done[op.chunk] = 1;
        m.prog.done.push(op.chunk);
        m.stats.facts += fresh.length; m.stats.cards += cards.length;
        var first = job.saved ? Promise.resolve() : store.putSrc(srcRec(job)).then(function () {
          if (!job.imgQ.length || !store.putImgs) return;
          m.imgPend = job.imgQ.map(function (x) { return "i_" + DK.sha12(job.deckId + x.k); });
          return store.putImgs(job.imgQ.map(function (x) { return pendImg(job, x); }));
        });
        return first.then(function () { job.saved = true; return store.putFacts(fresh); }).then(function () { return store.putCards(cards); }).then(function () { return saveDeck(job, store); });
      });
    }
    b = r.batches[op.b];
    if (op.op === "mcq") {
      body.facts = b.fids.map(function (id, fi) { return factPayload(job.facts[id], fi, job.byN); });
      body.mix = mixFor(b.fids.length, job.profile, m.diff);
      if (b.avoid) body.avoid = b.avoid;
      return deps.send(body).then(function (res) {
        applyUsage(job, res, deps);
        var seen = {}, got = {};
        b.items = (res.items || []).filter(function (it) {
          if (!it || typeof it !== "object") return false;
          if (!it.fid && it.fi != null) it.fid = b.fids[+it.fi];
          if (b.fids.indexOf(it.fid) < 0) return false;
          if (!it.id) it.id = "q_" + DK.sha12(job.deckId + it.fid + norm(it.q));
          if (seen[it.id]) return false;
          seen[it.id] = 1; got[it.fid] = 1;
          return true;
        });
        m.stats.generated += b.items.length;
        var gate = {};
        (res.rejected || []).forEach(function (x) { if (x && x.fid && !gate[x.fid]) gate[x.fid] = x.gate; });
        b.fids.forEach(function (fid) { if (!got[fid]) fail(job, b, fid, GATE_WHY[gate[fid]] || "no question passed the format checks"); });
        b.stage = b.items.length ? "solve" : "done";
        return saveDeck(job, store);
      });
    }
    if (op.op === "solve") {
      body.q = b.items.map(function (it) { return { id: it.id, q: it.q, o: it.o, a: it.a }; });
      return deps.send(body).then(function (res) {
        applyUsage(job, res, deps);
        var ok = {};
        (res.solved || []).forEach(function (s, i) { var id = s && (s.id || (b.items[s.i != null ? s.i : i] || {}).id); if (id && s.ok === true) ok[id] = 1; });
        b.items = b.items.filter(function (it) {
          if (ok[it.id]) return true;
          m.stats.rejected++; fail(job, b, it.fid, "a blind check picked a different answer");
          return false;
        });
        b.stage = b.items.length ? "review" : "done";
        return saveDeck(job, store);
      });
    }
    if (op.op === "review") {
      // The server reads id, q, o, a, r and kp. Gate 1 now requires every reason, so r is always complete; the check
      // only guards against items saved before that (an empty reason would make the server refuse the call).
      body.q = b.items.map(function (it) {
        var x = { id: it.id, q: it.q, o: it.o, a: it.a };
        if (it.r && it.r.length === 4 && it.r.every(function (t) { return typeof t === "string" && t.trim(); })) x.r = it.r;
        if (typeof it.kp === "string") x.kp = it.kp;
        return x;
      });
      body.para = {};
      b.items.forEach(function (it) { var f = job.facts[it.fid]; body.para[it.id] = paraFor(f ? f.sn : (it.src && it.src.sn), job.byN); });
      return deps.send(body).then(function (res) {
        applyUsage(job, res, deps);
        var byId = {};
        (res.gates || []).forEach(function (g, i) { if (!g) return; var it = g.id ? null : b.items[g.i != null ? +g.i : i]; byId[g.id || (it && it.id)] = g; });
        var keep = [];
        b.items.forEach(function (it) {
          var g = byId[it.id];
          if (!gatesPass(g)) { m.stats.rejected++; fail(job, b, it.fid, (g && g.why) || "the review found a problem"); return; }
          it.rv = { solved: true, pass: true, old: !!g.old };
          var s = toStored(it, job.facts[it.fid], job.deckId, job.ctx);
          if (!s || nearDup(s.q, job.stems)) { m.stats.rejected++; return; }
          job.stems.push(s.q); job.tlist.push({ t: s.t }); keep.push(s);
        });
        b.stage = "done";
        r.accepted += keep.length; r.textAcc = (r.textAcc || 0) + keep.length; m.stats.accepted += keep.length;
        m.topics = DK.topicsFor(job.deckId, job.tlist, job.sections);
        return store.putItems(keep).then(function () { return saveDeck(job, store); });
      });
    }
    return Promise.reject(new Error("unknown op " + op.op));
  }
  /* One image: its data (re-encoded smaller by deps.fitImage when needed) and the numbered page text near it. A kept
     question is saved with its image; a skipped image (the page text does not support a question) is dropped. */
  function imgB64(dataUrl) { var m = /^data:(image\/(?:jpeg|webp|png));base64,(.+)$/.exec(String(dataUrl || "")); return m ? { mime: m[1], data: m[2] } : null; }
  function stepImage(job, body, deps) {
    var img = job.imgQ[0], m = job.m, store = deps.store;
    var near = SR.nearSents(job.sents, img.p);
    var unpend = function (id) { m.imgPend = (m.imgPend || []).filter(function (x) { return x !== id; }); };
    var pid = "i_" + DK.sha12(job.deckId + img.k);
    var drop = function () { job.imgQ.shift(); job.imgDone++; unpend(pid); return (store.delImgs ? store.delImgs([pid]) : Promise.resolve()).then(function () { return saveDeck(job, store); }); };
    if (!near.length) return drop();
    return Promise.resolve(deps.fitImage ? deps.fitImage(img) : img).then(function (fit) {
      var b = imgB64(fit && fit.data);
      if (!b) return drop();
      body.img = b; body.near = near;
      body.src = { doc: job.ctx.doc, name: job.ctx.name || "" };
      var sec = near[0] && job.byN[near[0].n] && job.byN[near[0].n].s;
      if (/^[a-z0-9-]{1,40}$/.test(String(sec || ""))) body.t = sec;
      return deps.send(body).then(function (res) {
        applyUsage(job, res, deps);
        var it = res && res.items && res.items[0], s = null;
        if (it) {
          s = toStored(it, { id: it.fid, sec: sec || "sec-0", p: (it.src && it.src.p) || [img.p], h: (it.src && it.src.h) || "", sn: (it.src && it.src.sn) || [] }, job.deckId, job.ctx);
          if (s && nearDup(s.q, job.stems)) s = null;
        }
        if (!s) { m.stats.imgSkipped = (m.stats.imgSkipped || 0) + 1; return drop(); }
        var imgId = "i_" + DK.sha12(job.deckId + img.k);
        s.imgId = imgId; s.imgPlace = "stem"; s.rv = { solved: false, pass: true, img: true };
        job.stems.push(s.q); job.tlist.push({ t: s.t });
        job.round.accepted++; m.stats.accepted++; m.stats.img = (m.stats.img || 0) + 1; job.imgKept++;
        m.topics = DK.topicsFor(job.deckId, job.tlist, job.sections);
        job.imgQ.shift(); job.imgDone++; unpend(imgId);
        return store.putImgs([{ id: imgId, deckId: job.deckId, k: img.k, p: img.p, w: img.w, h: img.h, data: img.data }])
          .then(function () { return store.putItems([s]); }).then(function () { return saveDeck(job, store); });
      });
    });
  }
  // Deck items with an image get it back from prep-imgs (img: [data URL]) before they are drawn.
  function attachImages(items, imgs) {
    var by = {}; (imgs || []).forEach(function (r) { if (r && r.id && r.data) by[r.id] = r.data; });
    (items || []).forEach(function (it) { if (it.imgId && by[it.imgId]) { it.img = [by[it.imgId]]; it.imgPlace = "stem"; } });
    return items;
  }
  function applyUsage(job, res, deps) {
    addUsage(job.m.cost, res && res.usage);
    if (res && res.usage) job.round.mt = (+job.round.mt || 0) + (+res.usage.mt || 0);
    if (res && res.wallet) job.wallet = res.wallet;
    var caps = capsFrom(res && res.usage, deps.today || dayKey());
    if (caps) { job.caps = caps; if (deps.onCaps) deps.onCaps(caps); }
  }
  /* Run the round to its end. Never rejects: resolves { ok, code?, accepted, more }. A cap stop is written to the
     manifest (cost.stopped); everything that passed before it stays saved. */
  function runRound(job, deps) {
    function loop() {
      var op = nextOp(job);
      if (!op) {
        var stoppedByUser = job.stopReq;
        return endRound(job, deps).then(function () { return { ok: true, accepted: job.round.accepted, more: hasMore(job), stopped: stoppedByUser, mt: job.round.mt || 0, full: DK.questionCount(job.m) >= DECK_MAX }; });
      }
      job.phase = op.op;
      if (deps.onStep) deps.onStep(job, op);
      return step(job, op, deps).then(loop);
    }
    return loop().then(null, function (e) {
      var code = e && e.code ? e.code : e && e.name === "QuotaExceededError" ? "storage" : e && e.status != null ? errorCode(e.status, e.body) : "storage";
      if (CAP_STOPS[code]) { job.stopped = code; job.m.cost.stopped = code; }
      var eb = e && e.body && typeof e.body === "object" ? e.body : null;
      if (eb && eb.usage) applyUsage(job, eb, deps);   // a failed AI call is still metered
      else if (eb && (eb.monthDecks != null || eb.dayDecks != null)) { var c0 = capsFrom(eb, deps.today || dayKey()); job.caps = c0; if (deps.onCaps) deps.onCaps(c0); }
      var after = capsAfterStop(job.caps, code, deps.today || dayKey());
      if (after !== job.caps) { job.caps = after; if (deps.onCaps) deps.onCaps(after); }
      // A stop the student cannot retry ends the round; anything else keeps it in the manifest to continue later.
      var done = !job.saved ? Promise.resolve() : (canRetry(code) ? saveDeck(job, deps.store) : endRound(job, deps)).then(null, function () {});
      return done.then(function () { return { ok: false, code: code, message: MSG[code], retry: canRetry(code), accepted: job.round.accepted, more: hasMore(job), mt: job.round.mt || 0, full: DK.questionCount(job.m) >= DECK_MAX }; });
    });
  }

  // The round is over: it leaves the manifest, its MaiK Tokens count toward this deck's average.
  function endRound(job, deps) {
    job.over = true;
    if (job.round.mt > 0) job.m.rounds = (+job.m.rounds || 0) + 1;
    if (!job.saved) return Promise.resolve();
    job.m.run = null;
    return deps.store.putDeck(job.m).then(function () { if (deps.store.changed) deps.store.changed(job.deckId); });
  }

  /* ---------- one HTTP call ---------- */
  /* deps = { fetch, url, token() -> Promise(idToken|null), wait(ms) -> Promise, timeout?, AbortController?, setTimeout?,
     clearTimeout?, retryMs? }. Adds the idem key, sends, returns the JSON or rejects with opError (status, body, code).
     One retry with the same key, as shouldRetry says. */
  function callOp(body, deps) {
    var payload = without(body, "idem");
    payload.idem = idemKey(body.op, body);
    var json = JSON.stringify(payload);
    function once() {
      return Promise.resolve().then(function () { return deps.token(); }).then(null, function () { return null; }).then(function (tok) {
        if (!tok) throw opError(401, { error: "sign-in" });
        var ctl = deps.AbortController && deps.timeout ? new deps.AbortController() : null, timer = null;
        if (ctl) timer = deps.setTimeout(function () { ctl.abort(); }, deps.timeout);
        var clear = function () { if (timer && deps.clearTimeout) deps.clearTimeout(timer); };
        return deps.fetch(deps.url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok }, body: json, signal: ctl ? ctl.signal : undefined, cache: "no-store" })
          .then(function (res) {
            clear();
            return res.text().then(function (t) {
              var j = null;
              try { j = t ? JSON.parse(t) : null; } catch (e) { j = null; }
              if (!res.ok) throw opError(res.status, j);
              if (!j || typeof j !== "object") throw opError(502, { error: "ai-failed" });
              return j;
            });
          }, function (e) { clear(); throw e && e.name === "AbortError" ? opError(504, { error: "ai-timeout" }) : opError(0, null); });
      });
    }
    return once().then(null, function (e) {
      var ms = shouldRetry(e.status, 0, e.code, e.body && e.body.retryAfter, deps.retryMs);
      if (ms) return deps.wait(ms).then(once);
      throw e;
    });
  }

  var PURE = {
    URL: URL, MODEL: MODEL, PV: PV, BATCH: BATCH, TARGET: TARGET, RETRY_MS: RETRY_MS, PROFILE: PROFILE, MSG: MSG,
    MONTH_CAP: MONTH_CAP, DAY_CAP: DAY_CAP, DECK_MAX: DECK_MAX, IMG_PER_ROUND: IMG_PER_ROUND, MT_ROUND_DEFAULT: MT_ROUND_DEFAULT, CREATE_EXAMS: CREATE_EXAMS, AUTO_RESUME: AUTO_RESUME,
    createExam: createExam, mtEstimate: mtEstimate, roundTarget: roundTarget, deckStats: deckStats, runOk: runOk,
    errorCode: errorCode, errorMessage: errorMessage, canRetry: canRetry, shouldRetry: shouldRetry, opError: opError,
    idemKey: idemKey, deckIdFor: deckIdFor, mixFor: mixFor, addUsage: addUsage, dayKey: dayKey, capsFrom: capsFrom, capLine: capLine, capsAfterStop: capsAfterStop, costLine: costLine,
    factRecord: factRecord, factPayload: factPayload, paraFor: paraFor, gatesPass: gatesPass, toStored: toStored, toCard: toCard, jaccard: jaccard, nearDup: nearDup,
    deckKey: deckKey, cardDeckKey: cardDeckKey, deckProgress: deckProgress, purgeStore: purgeStore, defaultTitle: defaultTitle, readNote: readNote, unreadableMessage: unreadableMessage,
    newRound: newRound, newJob: newJob, nextOp: nextOp, attachImages: attachImages, imgB64: imgB64, unusedFids: unusedFids, hasMore: hasMore, step: step, runRound: runRound, callOp: callOp
  };
  if (isNode) { module.exports = PURE; return; }

  /* ================= browser ================= */
  var CAPS_KEY = "smd_prep_c_caps";
  /* The create flow is three steps: the source (paste or PDF), the pages (PDF only: the page picker), then the
     settings (exam, difficulty, name, the own-material check) and "Make 10 questions". cs holds them across screens. */
  var cs = { kind: "paste", text: "", title: "", own: false, pdf: null, sel: [], anchor: 0, rangeOn: false, pgMsg: "", spec: "", exam: null, diff: "mix",
    err: "", busy: "", pending: null, imgs: null, imgOn: {}, pendingImg: null };
  var job = null, jobResult = null, profiles = {}, note = "", restoredOnce = false;   // note: what the reader could not read as text (readNote)

  function readCaps() { try { return JSON.parse(G.localStorage.getItem(CAPS_KEY) || "null"); } catch (e) { return null; } }
  function writeCaps(c) { try { G.localStorage.setItem(CAPS_KEY, JSON.stringify(c)); } catch (e) {} }
  function capsNow() { return capLine((job && job.caps) || readCaps(), dayKey()); }
  function newJobCaps(j) { j.caps = readCaps(); return j; }
  function user() { var a = G.SMD_AUTH; return a && a.currentUser ? a.currentUser : null; }
  function fmtN(n) { try { return Number(n).toLocaleString("en-IN"); } catch (e) { return String(n); } }
  function mtLine(n) { return "about " + fmtN(n) + " MaiK Tokens"; }
  /* An image too large for one request (the server takes about 270 KB) is drawn again smaller as a JPEG, at most
     three times. The stored copy stays as it was cut. */
  var IMG_B64_MAX = 340000;
  function fitImage(img) {
    var b = imgB64(img.data);
    if (b && b.data.length <= IMG_B64_MAX) return Promise.resolve(img);
    return new Promise(function (res) {
      var im = new G.Image();
      im.onload = function () {
        var sc = 0.8, out = null;
        for (var t = 0; t < 3; t++) {
          var cv = G.document.createElement("canvas");
          cv.width = Math.max(1, Math.round(im.naturalWidth * sc)); cv.height = Math.max(1, Math.round(im.naturalHeight * sc));
          var cx = cv.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(im, 0, 0, cv.width, cv.height);
          out = cv.toDataURL("image/jpeg", 0.72); cv.width = 0; cv.height = 0;
          if (out.length - 23 <= IMG_B64_MAX) break;
          sc *= 0.75;
        }
        res({ p: img.p, k: img.k, w: img.w, h: img.h, data: out });
      };
      im.onerror = function () { res(null); };
      im.src = img.data;
    });
  }
  function wait(ms) { return new Promise(function (res) { G.setTimeout(res, ms); }); }
  var cfg = { gap: 3200, retryMs: RETRY_MS }, lastStart = 0;
  // The server allows one call per user every 3 s; keep the calls at least that far apart.
  function send(body) {
    var w = Math.max(0, cfg.gap - (Date.now() - lastStart));
    return (w ? wait(w) : Promise.resolve()).then(function () { lastStart = Date.now(); return callOne(body); });
  }
  function callOne(body) {
    return callOp(body, { retryMs: cfg.retryMs, fetch: function (u, o) { return G.fetch(u, o); }, url: (G.SMD_API_BASE || "") + URL, timeout: TIMEOUT_MS,
      AbortController: G.AbortController, setTimeout: function (f, ms) { return G.setTimeout(f, ms); }, clearTimeout: function (t) { G.clearTimeout(t); },
      wait: wait, token: function () { var u = user(); return u && u.getIdToken ? u.getIdToken() : null; } });
  }
  function loadProfile(exam) {
    if (profiles[exam]) return Promise.resolve(profiles[exam]);
    var url = (G.SMD_PREP_BASE || "/prep/") + "profiles/" + exam + ".json";
    return G.fetch(url, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error("no profile"); return r.json(); })
      .then(function (p) { return (profiles[exam] = p && p.cog && p.d ? p : PROFILE); }, function () { return (profiles[exam] = { id: exam, v: PROFILE.v, cog: PROFILE.cog, d: PROFILE.d }); });
  }
  function onTop(sel, host) { var r = host.root(); return !!(r && r.querySelector(sel)); }
  function deckIdOf(el) { return el && el.getAttribute("data-d"); }
  function hueOf(t) { var hue = 0; t = String(t || ""); for (var i = 0; i < t.length; i++) hue = (hue * 31 + t.charCodeAt(i)) % 360; return hue; }
  var store = { putDeck: DK.putDeck, putSrc: DK.putSrc, putFacts: DK.putFacts, putItems: DK.putItems, putCards: DK.putCards, putImgs: DK.putImgs, delImgs: DK.delImgs, changed: DK.changed };

  /* ---------- Your decks ---------- */
  function keepNote() {
    if (!DK.durable()) return "This browser is not keeping data, so a deck made here lasts until it closes. Use the StewardMD app to keep your decks.";
    return user() ? "Your decks are kept on this phone and in your account, so they come back on a new phone after you sign in." : "Your decks are kept on this phone. Sign in to keep a copy in your account too.";
  }
  function renderDecks(host) {
    var esc = host.esc, cl = capsNow();
    host.paint(host.bar("Your decks", "Questions and cards from your PDF or notes", "back") + '<div class="pn-body" id="pcDecksView"><div id="pcHb"></div>' +
      '<button type="button" class="pn-btn pri" data-act="c-new">' + host.ico("plus") + " Make a deck</button>" +
      (cl ? '<p class="pn-mut pn-small pc-capl" id="pcCapLine">' + esc(cl) + "</p>" : "") +
      (job && !jobResult ? '<button type="button" class="pn-mod pc-live" data-act="c-prog"><span class="pc-pulse" aria-hidden="true"></span><span class="pn-mb"><b>Making questions for ' + esc(job.m.title) + "</b><small>" + job.round.accepted + " of " + job.round.target + " ready. Show progress</small></span>" + host.ico("chev") + "</button>" : "") +
      '<div id="pcDecks" class="pc-decks" aria-busy="true"><div class="pc-skel" aria-hidden="true"></div><div class="pc-skel" aria-hidden="true"></div><p class="pn-load" role="status">Loading your decks…</p></div>' +
      '<p class="pn-note" id="pcKeep">' + esc(keepNote()) + "</p></div>");
    fillDecks(host);
    // Decks missing on this phone come back from its files, then from the account (once a session, after sign-in).
    if (!restoredOnce) {
      restoredOnce = true;
      DK.restore().then(function (r) {
        var n = (r.files || 0) + (r.account || 0);
        if (!n) return;
        host.toast(n === 1 ? "1 deck was brought back." : n + " decks were brought back.");
        if (onTop("#pcDecksView", host)) fillDecks(host);
      });
    }
  }
  function fillDecks(host) {
    DK.listDecks().then(function (list) {
      var box = host.root() && host.root().querySelector("#pcDecks");
      if (!box) return;
      box.removeAttribute("aria-busy");
      var s = host.store(), td = host.today(), hb = host.root().querySelector("#pcHb");
      if (hb && list.length && host.hband) {
        var nq = 0, nc = 0, due = 0;
        list.forEach(function (m) { var st = deckStats(m, s, td); nq += st.n; nc += m.stats.cards || 0; due += (st.due || 0) + (st.cardsDue || 0); });
        hb.innerHTML = host.hband("decks", host.fmt(list.length), list.length === 1 ? "deck" : "decks", host.fmt(nq) + (nq === 1 ? " question" : " questions") + " and " + host.fmt(nc) + (nc === 1 ? " card" : " cards") + (due ? ", " + host.fmt(due) + " due today." : "."));
      }
      box.innerHTML = list.length ? list.map(function (m) { return deckRow(host, m, deckStats(m, s, td)); }).join("") :
        '<div class="pn-empty pn-art-decks pc-empty"><p><b>No decks yet</b></p><p>Turn a chapter PDF or your notes into exam questions and flashcards, then practise them like any module.</p></div>';
    }, function () {
      var box = host.root() && host.root().querySelector("#pcDecks");
      if (box) { box.removeAttribute("aria-busy"); box.innerHTML = '<p class="pn-err" role="alert">Your decks could not be read just now.</p><button type="button" class="pn-btn" data-act="c-home-retry">Try again</button>'; }
    });
  }
  function deckRow(host, m, st) {
    var esc = host.esc, t = esc(m.title), busy = job && !jobResult && job.deckId === m.id, paused = !busy && runOk(m.run);
    var bits = [host.fmt(st.n) + " of " + st.max + " questions"];
    if (st.acc != null) bits.push(st.acc + "% correct");
    if (st.due) bits.push(host.fmt(st.due) + " due");
    var tag = busy ? "Making" : paused ? "Paused" : m.cost && m.cost.stopped && m.cost.stopped !== "deck-full" ? stopWord(m.cost.stopped) : "";
    var frac = st.n ? Math.min(1, st.answered / st.n) : 0;
    return '<button type="button" class="pn-panel pc-drow" data-act="c-open" data-d="' + esc(m.id) + '" aria-label="' + t + ", " + esc(bits.join(", ")) + (tag ? ", " + esc(tag) : "") + '">' +
      '<span class="pn-ic sm" style="--h:' + hueOf(m.title) + '" aria-hidden="true">' + host.ico("deck") + "</span>" +
      '<span class="pn-mb"><b>' + t + "</b><small>" + esc(bits.join(" · ")) + "</small>" +
      '<span class="pn-prog pc-mini" aria-hidden="true"><i style="transform:scaleX(' + frac.toFixed(3) + ')"></i></span></span>' +
      (tag ? '<span class="pc-tag' + (busy ? " on" : "") + '">' + esc(tag) + "</span>" : "") + host.ico("chev") + "</button>";
  }
  function stopWord(code) { return { "token-cap": "Size limit", "month-decks": "Monthly limit", "daily-decks": "Daily limit", "daily-calls": "Daily limit", "circuit-breaker": "Paused", "ai-cost-cap": "Out of MaiK Tokens", "deck-full": "Full" }[code] || ""; }

  /* ---------- one deck, as a module ---------- */
  function renderDeck(host, deckId) {
    var esc = host.esc;
    host.paint(host.bar("Your deck", "", "back") + '<div class="pn-body" id="pcDeckView" data-d="' + esc(deckId) + '"><p class="pn-load" role="status">Opening the deck…</p></div>');
    Promise.all([DK.getDeck(deckId), DK.facts(deckId).then(null, function () { return []; }), DK.getSrc(deckId).then(null, function () { return null; })]).then(function (a) {
      var m = a[0], v = host.root() && host.root().querySelector("#pcDeckView");
      if (!v || v.getAttribute("data-d") !== deckId) return;
      if (!m) { v.innerHTML = '<p class="pn-err" role="alert">This deck is not on this phone any more.</p>'; return; }
      var st = deckStats(m, host.store(), host.today()), id = esc(m.id), busy = job && !jobResult && job.deckId === m.id, paused = !busy && runOk(m.run);
      var unused = (a[1] || []).filter(function (f) { return !f.used; }).length, srcLeft = !!a[2] && (m.prog && m.prog.done ? m.prog.done.length : 0) < SR.chunkSentences(a[2].sents || []).length;
      var canMore = !st.full && (unused > 0 || srcLeft || paused);
      var tb = host.root().querySelector(".pn-bar .pn-t");
      if (tb) tb.innerHTML = "<h1>" + esc(m.title) + "</h1><p>" + esc(examLabel(m.exam)) + (m.diff && m.diff !== "mix" ? " · " + esc(diffLabel(m.diff)) : "") + "</p>";
      var frac = st.n ? Math.min(1, st.answered / st.n) : 0;
      var more;
      if (st.full) more = '<p class="pc-morel"><b>All ' + st.max + ' questions made.</b> Make a new deck from the next chapter for more.</p>';
      else if (busy) more = '<button type="button" class="pn-btn pri" data-act="c-prog">' + host.ico("bolt") + " Show progress</button>";
      else if (paused) more = '<button type="button" class="pn-btn pri" data-act="c-cont" data-d="' + id + '">' + host.ico("play") + " Continue making questions</button>" +
        '<p class="pn-mut pn-small">' + m.run.accepted + " of " + m.run.target + " were ready when it paused. It picks up where it stopped.</p>";
      else if (canMore) more = '<button type="button" class="pn-btn pri" data-act="c-more" data-d="' + id + '">' + host.ico("plus") + " Make " + roundTarget(st.n) + " more questions</button>" +
        '<p class="pn-mut pn-small" id="pcMoreLine">' + st.n + " of " + st.max + " in this deck. Uses " + mtLine(mtEstimate(m)) + ".</p>";
      else more = '<p class="pc-morel">' + (m.noSrc ? "Every saved fact of this deck has a question. To add more, make a deck again from the same pages." : "Every part of this source has been used. Make a new deck from more material.") + "</p>";
      v.innerHTML = '<section class="pn-panel pc-dhero" aria-label="Progress">' +
        '<p class="pc-dfig"><b class="pn-big">' + host.fmt(st.n) + '</b><span class="pn-mut">of ' + st.max + " questions</span></p>" +
        '<span class="pn-prog pc-bar" aria-hidden="true"><i style="transform:scaleX(' + frac.toFixed(3) + ')"></i></span>' +
        '<p class="pn-small pc-dstat">' + (st.answered ? host.fmt(st.answered) + " answered" + (st.acc != null ? " · " + st.acc + "% correct" : "") + (st.due ? " · " + host.fmt(st.due) + " due today" : "") : "Not started yet") + "</p></section>" +
        '<h2 class="pn-sec">Practise</h2><div class="pn-group">' +
        (st.n ? host.row("c-prac", host.ico("play"), "Questions", host.fmt(st.n) + (st.n === 1 ? " question" : " questions") + ", with explanations and Ask MaiK", ' data-d="' + id + '"') +
          host.row("c-test", host.ico("clock"), "Timed test", "Exam conditions, review at the end", ' data-d="' + id + '"') :
          '<p class="pn-mut pn-small pc-pad">Questions appear here once they are made.</p>') +
        (m.stats.cards ? host.row("c-cards", host.ico("deck"), "Flashcards", host.fmt(m.stats.cards) + " cards" + (st.cardsDue ? ", " + host.fmt(st.cardsDue) + " due" : ""), ' data-d="' + id + '"') : "") +
        "</div>" +
        '<h2 class="pn-sec">Add questions</h2><section class="pn-panel pc-more">' + more + "</section>" +
        '<button type="button" class="pn-btn pc-danger" data-act="c-del" data-d="' + id + '"' + (busy ? " disabled" : "") + ">" + host.ico("x") + " Delete this deck</button>";
    }, function () {
      var v = host.root() && host.root().querySelector("#pcDeckView");
      if (v) v.innerHTML = '<p class="pn-err" role="alert">This deck could not be read just now. Go back and try again.</p>';
    });
  }
  function examLabel(id) { for (var i = 0; i < CREATE_EXAMS.length; i++) if (CREATE_EXAMS[i].id === id) return CREATE_EXAMS[i].label; return "NEET-PG"; }
  function diffLabel(d) { for (var i = 0; i < DIFFS.length; i++) if (DIFFS[i].id === d) return DIFFS[i].label; return "Exam mix"; }

  /* ---------- Make a deck: steps ---------- */
  function steps(host, at) {
    var list = cs.kind === "pdf" ? ["Source", "Pages", "Settings"] : ["Source", "Settings"];
    return '<ol class="pc-steps" aria-label="Step ' + (at + 1) + " of " + list.length + '">' + list.map(function (n, i) {
      return '<li class="' + (i < at ? "done" : i === at ? "on" : "") + '"' + (i === at ? ' aria-current="step"' : "") + "><span>" + (i < at ? host.ico("check") : i + 1) + "</span>" + n + "</li>";
    }).join("") + "</ol>";
  }
  function resetCreate(host) {
    cs.kind = "paste"; cs.text = ""; cs.title = ""; cs.own = false; cs.pdf = null; cs.sel = []; cs.anchor = 0; cs.rangeOn = false; cs.pgMsg = ""; cs.spec = "";
    cs.exam = createExam(host.exam().id); cs.diff = "mix"; cs.err = ""; cs.busy = "";
  }
  function renderCreate(host) {
    var esc = host.esc;
    var chip = function (v, label) { return '<button type="button" class="pn-chip' + (cs.kind === v ? " on" : "") + '" aria-pressed="' + (cs.kind === v) + '" data-act="c-src" data-v="' + v + '">' + label + "</button>"; };
    var src = cs.kind === "paste" ?
      '<label class="pc-lbl" for="pcText">Your notes</label><textarea id="pcText" class="pc-in pc-ta" rows="9" placeholder="Paste text from your notes or a chapter. Headings on their own line become sections.">' + esc(cs.text) + "</textarea>" +
      '<p class="pn-mut pn-small" id="pcChars">' + host.fmt(cs.text.length) + " characters</p>" +
      '<button type="button" class="pn-btn pri" data-act="c-next">Continue</button>' :
      '<button type="button" class="pc-drop" data-act="c-pick"' + (cs.busy ? " disabled" : "") + '><span class="pn-ic sm" style="--h:174" aria-hidden="true">' + host.ico("dl") + "</span><span><b>" + (cs.pdf ? "Choose another PDF" : "Choose a PDF") + "</b><small>A chapter or a whole book. You pick up to " + SR.PAGE_CAP + " pages next.</small></span></button>" +
      '<input type="file" id="pcFile" accept="application/pdf,.pdf" hidden aria-hidden="true" tabindex="-1">' +
      (cs.busy ? '<p class="pn-load pc-busy" role="status"><span class="pc-spin" aria-hidden="true"></span>' + esc(cs.busy) + "</p>" : "") +
      (cs.pdf && !cs.busy ? '<button type="button" class="pn-mod" data-act="c-pages"><span class="pn-mb"><b>' + esc(cs.pdf.name) + "</b><small>" + host.fmt(cs.pdf.pages) + " pages · " + cs.sel.length + " chosen</small></span>" + host.ico("chev") + "</button>" : "") +
      '<p class="pn-mut pn-small">' + (SR.canOcr() ? "Scanned pages are read on this phone, up to " + SR.OCR_PAGE_CAP + " in one deck. Nothing is uploaded for this." : "Scanned pages are read only in the StewardMD phone app. Here, only PDFs with real text work.") + "</p>";
    host.paint(host.bar("Make a deck", "", "back") + '<div class="pn-body" id="pcCreateView">' + steps(host, 0) +
      '<div class="pn-wrap pc-seg" role="group" aria-label="Source">' + chip("paste", "Paste notes") + chip("pdf", "PDF") + "</div>" + src +
      (cs.err ? '<p class="pn-err" role="alert" id="pcErr" tabindex="-1">' + esc(cs.err) + "</p>" : "") + "</div>", cs.err ? "#pcErr" : null);
    var r = host.root();
    if (!r) return;
    var ta = r.querySelector("#pcText"), fi = r.querySelector("#pcFile");
    if (ta) ta.addEventListener("input", function () { cs.text = ta.value; var c = r.querySelector("#pcChars"); if (c) c.textContent = host.fmt(cs.text.length) + " characters"; });
    if (fi) fi.addEventListener("change", function () { if (fi.files && fi.files[0]) pickPdf(fi.files[0], host); });
  }
  function pickPdf(file, host) {
    cs.err = ""; cs.pdf = null; cs.sel = []; cs.busy = "Opening the PDF…";
    host.rerender();
    SR.openPdf(file).then(function (pdf) {
      cs.busy = ""; cs.pdf = pdf; cs.sel = SR.selInitial(pdf.pages); cs.anchor = 0; cs.rangeOn = false; cs.pgMsg = ""; cs.spec = "";
      if (!cs.title) cs.title = pdf.name.replace(/\.pdf$/i, "").slice(0, 80);
      if (onTop("#pcCreateView", host)) { host.rerender(); host.push(function () { renderPages(host); }); }
    }, function () {
      cs.busy = ""; cs.err = "This PDF could not be opened. It may be protected by a password or damaged.";
      if (onTop("#pcCreateView", host)) host.rerender();
    });
  }
  function createError(host, msg) { cs.err = msg; cs.busy = ""; if (onTop("#pcSetView", host) || onTop("#pcCreateView", host)) host.rerender(); }

  /* ---------- the page picker: lazy thumbnails in a virtual grid, 60 pages at most ---------- */
  var pg = { thumbs: {}, order: [], queue: [], busy: false, lastW: 0, ro: null, aspect: 1.414, cols: 3, cellW: 100, rowH: 170, win: { from: 1, to: 0 }, doc: null, scrollEl: null, onScroll: null };
  var THUMB_KEEP = 240, GAP = 10, CAP_H = 26;
  function thumbPut(p, url) { if (!pg.thumbs[p]) pg.order.push(p); pg.thumbs[p] = url; while (pg.order.length > THUMB_KEEP) { var old = pg.order.shift(); if (old < pg.win.from || old > pg.win.to) delete pg.thumbs[old]; else pg.order.push(old); } }
  function renderPages(host) {
    if (!cs.pdf) return host.back();
    var esc = host.esc, n = cs.sel.length, cap = SR.PAGE_CAP;
    host.paint(host.bar("Choose pages", esc(cs.pdf.name) + " · " + host.fmt(cs.pdf.pages) + " pages", "back") + '<div class="pn-body pc-pgbody" id="pcPagesView">' + steps(host, 1) +
      '<div class="pc-pgtop">' +
      '<p class="pc-pgn" id="pcPgN" role="status" aria-live="polite"><b>' + n + "</b> of " + cap + " selected</p>" +
      '<form class="pc-pgform" id="pcPgForm" autocomplete="off"><label class="pc-sr" for="pcPgSpec">Type the pages you want</label>' +
      '<input id="pcPgSpec" name="pages" class="pc-in" inputmode="numeric" spellcheck="false" placeholder="Type a range, e.g. 120-160" value="' + esc(cs.spec) + '"><button type="submit" class="pn-btn sm">Select</button></form>' +
      '<div class="pc-pgacts"><button type="button" class="pn-chip' + (cs.rangeOn ? " on" : "") + '" data-act="c-pgrange" aria-pressed="' + cs.rangeOn + '">Select a range</button>' +
      (cs.pdf.pages <= cap ? '<button type="button" class="pn-chip" data-act="c-pgall">All pages</button>' : "") +
      '<button type="button" class="pn-chip" data-act="c-pgclear"' + (n ? "" : " disabled") + ">Clear</button></div>" +
      '<p class="pc-pgmsg" id="pcPgMsg" role="alert">' + esc(cs.pgMsg) + "</p></div>" +
      '<div class="pc-pg" id="pcPg" role="group" aria-label="Pages of the PDF"></div>' +
      '<div class="pc-pgfoot"><button type="button" class="pn-btn pri" data-act="c-pgok" id="pcPgOk"' + (n ? "" : " disabled") + ">" + (n ? "Continue with " + n + (n === 1 ? " page" : " pages") : "Pick at least one page") + "</button></div></div>");
    var r = host.root(), form = r && r.querySelector("#pcPgForm");
    if (form) form.addEventListener("submit", function (e) { e.preventDefault(); applySpec(host); });
    var sp = r && r.querySelector("#pcPgSpec");
    if (sp) sp.addEventListener("input", function () { cs.spec = sp.value; });
    pg.doc = cs.pdf.doc;
    SR.pageAspect(cs.pdf.doc).then(function (a) { pg.aspect = a; layoutGrid(host); });
    // A rotation, a split-view resize or the app's text zoom changes the grid's width: lay it out again for the new
    // width, keeping the same pages in view. Watched on the grid itself (the zoom lands after the window's resize event).
    var grid0 = r && r.querySelector("#pcPg");
    if (grid0 && G.ResizeObserver) {
      if (pg.ro) pg.ro.disconnect();
      var rt = 0;
      pg.ro = new G.ResizeObserver(function () {
        if (rt) return;
        rt = G.setTimeout(function () {
          rt = 0;
          var h = G.PREP && G.PREP._host, rr = h && h.root(), body = rr && rr.querySelector("#pcPagesView"), grid = rr && rr.querySelector("#pcPg");
          if (!body || !grid || !cs.pdf || Math.abs(grid.clientWidth - pg.lastW) < 2) return;
          var first = pg.win.from || 1;
          layoutGrid(h);
          body.scrollTop = Math.max(0, grid.offsetTop + Math.floor((first - 1) / pg.cols) * pg.rowH - 8);
          drawWindow(h);
        }, 80);
      });
      pg.ro.observe(grid0);
    }
  }
  function layoutGrid(host) {
    var r = host.root(), grid = r && r.querySelector("#pcPg"), body = r && r.querySelector("#pcPagesView");
    if (!grid || !body) return;
    var w = grid.clientWidth || 358, total = cs.pdf.pages;
    pg.lastW = w;
    pg.cols = Math.max(3, Math.min(8, Math.floor((w + GAP) / (96 + GAP))));
    pg.cellW = Math.floor((w - GAP * (pg.cols - 1)) / pg.cols);
    pg.rowH = Math.round(pg.cellW * pg.aspect) + CAP_H + GAP;
    grid.style.height = Math.ceil(total / pg.cols) * pg.rowH - GAP + "px";
    grid.style.setProperty("--pc-cw", pg.cellW + "px");
    grid.style.setProperty("--pc-ch", Math.round(pg.cellW * pg.aspect) + "px");
    grid.innerHTML = "";
    pg.win = { from: 1, to: 0 };
    if (pg.scrollEl && pg.onScroll) pg.scrollEl.removeEventListener("scroll", pg.onScroll);
    var tick = false;
    pg.scrollEl = body;
    pg.onScroll = function () { if (tick) return; tick = true; (G.requestAnimationFrame || G.setTimeout)(function () { tick = false; drawWindow(host); }); };
    body.addEventListener("scroll", pg.onScroll, { passive: true });
    drawWindow(host);
  }
  function cellHtml(p) {
    var on = cs.sel.indexOf(p) >= 0, row = Math.floor((p - 1) / pg.cols), col = (p - 1) % pg.cols, t = pg.thumbs[p];
    return '<button type="button" class="pc-pc' + (on ? " on" : "") + (cs.anchor === p ? " anchor" : "") + '" data-act="c-pg" data-p="' + p + '" aria-pressed="' + on + '" aria-label="Page ' + p + " of " + cs.pdf.pages + '" style="transform:translate(' + col * (pg.cellW + GAP) + "px," + row * pg.rowH + 'px)">' +
      '<span class="pc-pimg">' + (t ? '<img src="' + t + '" alt="" decoding="async">' : "") + '<span class="pc-ptick" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg></span></span>' +
      '<span class="pc-pnum" aria-hidden="true">' + p + "</span></button>";
  }
  function drawWindow(host) {
    var r = host.root(), grid = r && r.querySelector("#pcPg"), body = pg.scrollEl;
    if (!grid || !body || !cs.pdf) return;
    var top = grid.offsetTop, w = SR.gridWindow(body.scrollTop, body.clientHeight, top, pg.rowH, pg.cols, cs.pdf.pages, 2);
    var keep = {}, p, i;
    [].slice.call(grid.children).forEach(function (el) { var n = +el.getAttribute("data-p"); if (n < w.from || n > w.to) grid.removeChild(el); else keep[n] = 1; });
    var html = "";
    for (p = w.from; p <= w.to; p++) if (!keep[p]) html += cellHtml(p);
    if (html) grid.insertAdjacentHTML("beforeend", html);
    pg.win = w;
    pg.queue = [];
    for (i = w.from; i <= w.to; i++) if (!pg.thumbs[i]) pg.queue.push(i);
    pumpThumbs(host);
  }
  // One thumbnail at a time, only for pages in (or near) view; a page scrolled away before its turn is skipped.
  function pumpThumbs(host) {
    if (pg.busy || !pg.queue.length || !cs.pdf) return;
    var p = pg.queue.shift();
    if (pg.thumbs[p] || p < pg.win.from || p > pg.win.to) return pumpThumbs(host);
    pg.busy = true;
    var doc = cs.pdf.doc;
    SR.renderThumb(doc, p, pg.cellW).then(function (u) {
      pg.busy = false;
      if (!cs.pdf || cs.pdf.doc !== doc) return;
      thumbPut(p, u);
      var el = host.root() && host.root().querySelector('#pcPg [data-p="' + p + '"] .pc-pimg');
      if (el && !el.querySelector("img")) el.insertAdjacentHTML("afterbegin", '<img src="' + u + '" alt="" decoding="async">');
      pumpThumbs(host);
    }, function () { pg.busy = false; pumpThumbs(host); });
  }
  // Selection changed: the cells in view, the counter and the Continue button, without a repaint (the grid keeps its scroll).
  function syncSel(host) {
    var r = host.root();
    if (!r || !r.querySelector("#pcPagesView")) return;
    [].slice.call(r.querySelectorAll("#pcPg .pc-pc")).forEach(function (el) {
      var p = +el.getAttribute("data-p"), on = cs.sel.indexOf(p) >= 0;
      el.classList.toggle("on", on); el.classList.toggle("anchor", cs.anchor === p); el.setAttribute("aria-pressed", String(on));
    });
    var n = cs.sel.length, nEl = r.querySelector("#pcPgN"), ok = r.querySelector("#pcPgOk"), msg = r.querySelector("#pcPgMsg"), clr = r.querySelector('[data-act="c-pgclear"]'), rg = r.querySelector('[data-act="c-pgrange"]');
    if (nEl) nEl.innerHTML = "<b>" + n + "</b> of " + SR.PAGE_CAP + " selected";
    if (ok) { ok.disabled = !n; ok.textContent = n ? "Continue with " + n + (n === 1 ? " page" : " pages") : "Pick at least one page"; }
    if (msg) { msg.textContent = cs.pgMsg; msg.classList.toggle("warn", /up to/.test(cs.pgMsg)); }
    if (clr) clr.disabled = !n;
    if (rg) { rg.classList.toggle("on", cs.rangeOn); rg.setAttribute("aria-pressed", String(cs.rangeOn)); }
  }
  function tapPage(host, p) {
    var total = cs.pdf.pages, res;
    if (cs.rangeOn) {
      if (!cs.anchor) { cs.anchor = p; cs.pgMsg = "Now tap the last page of the range."; return syncSel(host); }
      res = SR.selRange(cs.sel, cs.anchor, p, total);
      cs.anchor = 0; cs.rangeOn = false;
      cs.pgMsg = res.error || "";
    } else { res = SR.selToggle(cs.sel, p, total); cs.pgMsg = res.error || ""; }
    cs.sel = res.sel;
    syncSel(host);
  }
  function applySpec(host) {
    var r = host.root(), sp = r && r.querySelector("#pcPgSpec");
    if (sp) cs.spec = sp.value;
    var res = SR.selFromSpec(cs.spec, cs.pdf.pages);
    if (res.error) { cs.pgMsg = res.error; return syncSel(host); }
    cs.sel = res.sel; cs.pgMsg = ""; cs.anchor = 0; cs.rangeOn = false;
    syncSel(host);
    // Bring the first chosen page into view.
    var grid = r && r.querySelector("#pcPg");
    if (grid && pg.scrollEl && cs.sel.length) { pg.scrollEl.scrollTop = grid.offsetTop + Math.floor((cs.sel[0] - 1) / pg.cols) * pg.rowH - 80; drawWindow(host); }
  }

  /* ---------- settings and go ---------- */
  function renderSettings(host) {
    var esc = host.esc, cl = capsNow(), ok = user();
    var exChip = function (x) { var on = cs.exam === x.id; return '<button type="button" class="pn-chip' + (on ? " on" : "") + '" aria-pressed="' + on + '" data-act="c-exam" data-v="' + x.id + '">' + x.label + "</button>"; };
    var dChip = function (x) { var on = cs.diff === x.id; return '<button type="button" class="pn-chip' + (on ? " on" : "") + '" aria-pressed="' + on + '" data-act="c-diff" data-v="' + x.id + '">' + x.label + "</button>"; };
    var srcLine = cs.kind === "pdf" && cs.pdf ? esc(cs.pdf.name) + " · " + cs.sel.length + (cs.sel.length === 1 ? " page" : " pages") : host.fmt(cs.text.length) + " characters of notes";
    host.paint(host.bar("Make a deck", "", "back") + '<div class="pn-body" id="pcSetView">' + steps(host, cs.kind === "pdf" ? 2 : 1) +
      '<p class="pc-file">' + srcLine + "</p>" +
      '<p class="pc-lbl" id="pcExL">Exam</p><div class="pn-wrap pc-seg" role="group" aria-labelledby="pcExL">' + CREATE_EXAMS.map(exChip).join("") + "</div>" +
      '<p class="pc-lbl" id="pcDfL">Difficulty</p><div class="pn-wrap pc-seg" role="group" aria-labelledby="pcDfL">' + DIFFS.map(dChip).join("") + "</div>" +
      '<label class="pc-lbl" for="pcTitle">Deck name</label><input id="pcTitle" class="pc-in" maxlength="80" autocomplete="off" placeholder="Taken from the file or the first heading" value="' + esc(cs.title) + '">' +
      '<button type="button" class="pc-check" data-act="c-own" aria-pressed="' + cs.own + '"><span class="pc-box" aria-hidden="true">' + (cs.own ? host.ico("check") : "") + "</span>" +
      "<span>These are my own notes, or material I am allowed to use for study.</span></button>" +
      (cs.busy ? '<section class="pn-panel pc-readp" role="status" aria-live="polite"><span class="pc-spin" aria-hidden="true"></span><p class="pn-load">' + esc(cs.busy) + "</p></section>" : "") +
      (cs.err ? '<p class="pn-err" role="alert" id="pcErr" tabindex="-1">' + esc(cs.err) + "</p>" : "") +
      '<button type="button" class="pn-btn pri" data-act="c-go"' + (cs.busy ? " disabled" : "") + ">Make 10 questions</button>" +
      '<p class="pn-mut pn-small pc-mtl">Uses ' + mtLine(MT_ROUND_DEFAULT) + ". You can add 10 more at a time later, up to " + DECK_MAX + ".</p>" +
      (!ok ? '<p class="pn-mut pn-small">Sign in first: decks are made on our server and kept in your account.</p>' : "") +
      '<p class="pn-mut pn-small">Names, phone numbers and ID numbers are looked for and removed before anything is sent. Only the text is sent, never the file.</p>' +
      '<p class="pn-mut pn-small">' + (cl ? esc(cl) + ". " : "") + "Up to " + DAY_CAP + " new decks a day and " + MONTH_CAP + " a month. Adding questions to a deck does not count as a new deck.</p></div>", cs.err ? "#pcErr" : null);
    var r = host.root(), ti = r && r.querySelector("#pcTitle");
    if (ti) ti.addEventListener("input", function () { cs.title = ti.value; });
  }
  function toSettings(host) {
    cs.err = "";
    if (cs.kind === "paste" && cs.text.replace(/\s+/g, "").length < 20) return createError(host, "Paste your notes first.");
    host.push(function () { renderSettings(host); });
  }
  // Read the source, then warn about personal details before anything is built or sent.
  function go(host) {
    cs.err = "";
    if (job && !jobResult) return createError(host, "A deck is being made. Wait for it to finish first.");
    if (!cs.own) return createError(host, "Confirm that these are your own notes or material you may use.");
    if (!user()) return createError(host, MSG["sign-in"]);
    if (cs.kind === "paste") {
      if (cs.text.replace(/\s+/g, "").length < 20) return createError(host, "Paste your notes first.");
      return review(host, { kind: "paste", text: cs.text, title: cs.title, name: "", pages: null, scanned: [] });
    }
    if (!cs.pdf) return createError(host, "Choose a PDF first.");
    if (!cs.sel.length) return createError(host, "Pick at least one page.");
    var pages = cs.sel.slice();
    cs.busy = "Reading page 1 of " + pages.length + "…";
    host.rerender();
    var ocrOn = SR.canOcr();
    var say = function (t) { var el = host.root() && host.root().querySelector("#pcSetView .pc-readp .pn-load"); if (el) el.textContent = t; };
    SR.readPdfPages(cs.pdf.doc, pages, function (d, n, phase) {
      if (phase === "ocr") say(d < n ? "Reading scanned page " + (d + 1) + " of " + n + " on this phone" : "Scanned pages read");
      else if (d < n) say("Reading page " + (d + 1) + " of " + n + "…");
    }).then(function (rd) {
      if (!rd.pages.length) { cs.busy = ""; return createError(host, unreadableMessage(rd, ocrOn)); }
      var src = { kind: "pdf", raw: rd.pages, title: cs.title, name: cs.pdf.name, pages: pages, scanned: rd.scanned, ocr: rd.ocrPages.length, skipped: rd.skipped.length, note: readNote(rd, ocrOn) };
      findImages(say, cs.pdf.doc, pages).then(function (imgs) {
        cs.busy = "";
        if (!imgs.length) return review(host, src);
        cs.imgs = imgs; cs.imgOn = {}; imgs.forEach(function (x) { cs.imgOn[x.k] = 1; });
        cs.pendingImg = src;
        host.push(function () { renderImages(host); });
      });
    }, function () { createError(host, "The pages could not be read. Try other pages or another PDF."); });
  }
  // Pictures on the chosen pages; none (or a failure) just means a text-only deck.
  function findImages(say, doc, pages) {
    if (!SR.extractImages || !G.pdfjsLib) return Promise.resolve([]);
    return SR.extractImages(doc, pages, function (d, n, phase) { say(phase === "cut" ? "Cutting out image " + Math.min(d + 1, n) + " of " + n + "…" : "Looking for images, page " + Math.min(d + 1, n) + " of " + n + "…"); })
      .then(null, function () { return []; });
  }
  /* The strip of images found: each one a toggle, all on at first. Continue keeps the chosen ones for image questions. */
  function renderImages(host) {
    var esc = host.esc, list = cs.imgs || [], on = list.filter(function (x) { return cs.imgOn[x.k]; }).length;
    host.paint(host.bar("Images in your PDF", esc((cs.pendingImg && cs.pendingImg.name) || ""), "back") + '<div class="pn-body" id="pcImgView">' +
      '<h2 class="pn-sec pc-imgh">Use these images for image questions</h2>' +
      '<p class="pn-mut pn-small">' + list.length + (list.length === 1 ? " image was" : " images were") + " found on the pages you chose. Up to " + IMG_PER_ROUND + " of each 10 questions are on your images, when the text near an image says what it shows.</p>" +
      '<div class="pc-strip" role="group" aria-label="Images found">' + list.map(function (x, i) {
        var sel = !!cs.imgOn[x.k];
        return '<button type="button" class="pc-thumb' + (sel ? " on" : "") + '" data-act="c-img" data-v="' + esc(x.k) + '" aria-pressed="' + sel + '" aria-label="Image ' + (i + 1) + " of " + list.length + (sel ? ", kept" : ", left out") + '">' +
          // The page number sits by a page glyph: emoji-icons.js rewrites any "Page 3" text in the app as a book citation.
          '<img src="' + esc(x.data) + '" alt="" width="' + x.w + '" height="' + x.h + '" decoding="async"><span class="pc-tp" aria-hidden="true"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/></svg>' + x.p + '</span><span class="pc-tick" aria-hidden="true">' + host.ico("check") + "</span></button>";
      }).join("") + "</div>" +
      '<p class="pn-mut pn-small" id="pcImgN" role="status">' + on + " of " + list.length + " kept</p>" +
      '<p class="pn-mut pn-small">Use images from study material, not patient images. A kept image is sent once, with the text around it, to write its question, and stays on this phone with the deck.</p>' +
      '<div class="pn-navrow"><button type="button" class="pn-btn" data-act="c-imgskip">Skip images</button><button type="button" class="pn-btn pri" data-act="c-imgok"' + (on ? "" : " disabled") + ">" + (on ? "Use " + on + (on === 1 ? " image" : " images") : "Continue") + "</button></div></div>");
  }
  function imagesChosen(host, keep) {
    var src = cs.pendingImg; if (!src) return;
    src.imgs = keep ? (cs.imgs || []).filter(function (x) { return cs.imgOn[x.k]; }) : [];
    cs.imgs = null; cs.imgOn = {}; cs.pendingImg = null;
    host.back();
    review(host, src);
  }
  function rawText(src) {
    if (src.kind === "paste") return src.text;
    return src.raw.map(function (p) { return p.lines.map(function (l) { return l.tx; }).join("\n"); }).join("\n");
  }
  function review(host, src) {
    var f = SR.scrubFind(rawText(src));
    cs.pending = src;
    if (!f.total) return build(host, src);
    host.push(function () {
      host.paint(host.bar("Check before sending", "", "back") + '<div class="pn-body" id="pcScrubView"><section class="pn-panel pc-warn" role="alert" tabindex="-1">' +
        "<p><b>This text seems to contain personal details:</b> " + host.esc(SR.scrubSummary(f)) + ".</p>" +
        "<p>They will be removed before anything is sent. Use study material, not patient notes.</p></section>" +
        '<button type="button" class="pn-btn pri" data-act="c-scrubok">Remove them and continue</button>' +
        '<button type="button" class="pn-btn" data-act="back">Go back and edit</button></div>', ".pc-warn");
    });
  }
  // Scrub, number the sentences, check the caps, then start (or continue) the deck.
  function build(host, src) {
    var doc;
    if (src.kind === "paste") doc = SR.docFromNotes(SR.prepScrub(src.text), src.title);
    else doc = SR.docFromPdfPages(src.raw.map(function (p) { return { p: p.p, ocr: !!p.ocr, lines: p.lines.map(function (l) { return { tx: SR.prepScrub(l.tx), size: l.size, ocr: !!l.ocr }; }) }; }), src.title);
    var chk = SR.capCheck(doc, src.pages ? src.pages.length : 1);
    if (chk.error) { if (onTop("#pcScrubView", host)) host.back(); return createError(host, chk.error); }
    var exam = createExam(cs.exam || host.exam().id), diff = cs.diff, u = user(), sha = DK.sha256(SR.docText(doc)), title = (src.title || "").trim() || defaultTitle(doc, src.name);
    note = src.note || "";
    loadProfile(exam).then(function (prof) {
      var id = deckIdFor({ uid: u && u.uid, sha: sha, exam: exam, profileV: prof.v || 1, pv: PV, model: MODEL });
      return DK.getDeck(id).then(function (old) {
        resetCreate(host); cs.pending = null;
        if (old) { host.toast("You already have a deck from this source. Adding questions to it."); return startMore(host, old.id, true, src.imgs); }
        var m = DK.newManifest({ id: id, title: title, exam: exam, profileV: prof.v || 1, pv: PV, model: MODEL, source: { type: src.kind, name: src.name, pages: SR.pageSpan(src.pages), sha: sha } });
        m.diff = diff;
        if (src.ocr) m.source.ocr = src.ocr;
        if (src.skipped) m.source.skipped = src.skipped;
        if (src.pages && src.pages.length) m.source.sel = SR.selSpec(src.pages);
        start(host, newJob({ m: m, sents: doc.sents, sections: doc.sections, facts: [], items: [], saved: false, target: TARGET, profile: prof, ctx: ctxOf(m), imgs: src.imgs }), true);
      });
    }).then(null, function () { createError(host, MSG.storage); });
  }
  function ctxOf(m) { return { doc: m.source.sha.slice(0, 12), name: m.source.name || m.title, exam: m.exam, pv: m.pv, model: m.model }; }
  /* "Make 10 more" and "Continue": the deck's sentences (when this phone has them), facts and questions, its images
     still waiting, and the round saved in the manifest when one was cut off. */
  function startMore(host, deckId, fromCreate, imgs) {
    if (!fromCreate) note = "";
    if (job && !jobResult) { host.toast("A deck is being made. Wait for it to finish first."); return Promise.resolve(); }
    return Promise.all([DK.getDeck(deckId), DK.getSrc(deckId), DK.facts(deckId), DK.items(deckId), DK.imgs(deckId).then(null, function () { return []; })]).then(function (a) {
      var m = a[0], src = a[1];
      if (!m) { host.toast("This deck is not on this phone any more."); return; }
      var n = DK.questionCount(m), target = roundTarget(n);
      if (!target && !runOk(m.run)) { host.toast(MSG["deck-full"]); return; }
      var waiting = (a[4] || []).filter(function (x) { return x.pend; }).sort(function (x, y) { return (m.imgPend || []).indexOf(x.id) - (m.imgPend || []).indexOf(y.id); });
      var q = (imgs && imgs.length ? imgs : waiting.map(function (x) { return { p: x.p, k: x.k, w: x.w, h: x.h, data: x.data }; }));
      return loadProfile(m.exam).then(function (prof) {
        m.cost.stopped = null;
        start(host, newJob({ m: m, sents: (src && src.sents) || [], sections: (src && src.sections) || [], facts: a[2], items: a[3], saved: true, target: target, profile: prof, ctx: ctxOf(m), imgs: q }), fromCreate);
      });
    }, function () { host.toast("This deck could not be read just now. Try again."); });
  }
  // Leave the create screens under the progress screen, so back from it lands where the student started.
  function start(host, j, fromCreate) {
    job = newJobCaps(j); jobResult = null;
    if (fromCreate) { while (onTop("#pcScrubView", host) || onTop("#pcCreateView", host) || onTop("#pcImgView", host) || onTop("#pcPagesView", host) || onTop("#pcSetView", host)) host.back(); }
    host.push(function () { renderProgress(host); });
    runJob(host, j);
  }
  function runJob(host, j) {
    runRound(j, { send: send, store: store, today: dayKey(), onCaps: writeCaps, fitImage: fitImage, onStep: function () { updateProgress(host); } }).then(function (res) {
      if (job !== j) return;
      jobResult = res;
      if (onTop("#pcProgView", host)) host.rerender();
      else if (onTop("#pcDeckView", host) || onTop("#pcDecksView", host)) host.rerender();
      if (!onTop("#pcProgView", host)) host.toast(res.ok ? res.accepted + " new questions are ready in " + j.m.title + "." : res.message);
    });
  }

  /* ---------- progress: real counts only (questions that passed every check), no made-up percentage ---------- */
  var STAGES = [["facts", "Finding the key facts"], ["mcq", "Writing questions"], ["solve", "Checking each answer"], ["review", "Reviewing each question"]];
  function stageOf(ph) { return ph === "regen" || ph === "batch" ? "mcq" : ph; }
  function progressBits() {
    var r = job.round, cur = stageOf(job.phase);
    return { pct: r.target ? Math.min(1, r.accepted / r.target) : 0, count: r.accepted + " of " + r.target, cur: cur, img: cur === "imcq", phase: cur === "imcq" ? "Writing questions on your images" : (PHASE[job.phase] || "Getting ready"), caps: capsNow() };
  }
  function stageList(b) {
    var at = -1; STAGES.forEach(function (s, i) { if (s[0] === b.cur) at = i; });
    return '<ol class="pc-stages" aria-hidden="true">' + STAGES.map(function (s, i) { return '<li class="' + (b.img ? "done" : i < at ? "done" : i === at ? "on" : "") + '">' + s[1] + "</li>"; }).join("") +
      (job.imgQ.length || job.imgDone ? '<li class="' + (b.img ? "on" : "") + '">Questions on your images</li>' : "") + "</ol>";
  }
  function renderProgress(host) {
    if (!job) return host.back();
    var esc = host.esc, b = progressBits(), res = jobResult, id = esc(job.deckId), body;
    if (!res) body = '<section class="pn-panel pc-progp" aria-live="polite"><p class="pc-dfig"><b class="pn-big" id="pcCount">' + job.round.accepted + '</b><span class="pn-mut" id="pcOf">of ' + job.round.target + " questions ready</span></p>" +
      '<span class="pn-prog pc-bar" aria-hidden="true"><i id="pcBarI" style="transform:scaleX(' + b.pct.toFixed(3) + ')"></i></span>' +
      '<p class="pc-sr" id="pcPhaseT">' + esc(b.phase) + "</p>" + '<div id="pcStages">' + stageList(b) + "</div></section>" +
      '<p class="pn-mut pn-small">Each question is written, answered blind and reviewed before it is saved. You can leave this screen or the app: if it is cut off, it continues from here.</p>' +
      (note ? '<p class="pn-mut pn-small" id="pcNote">' + esc(note) + "</p>" : "") +
      '<button type="button" class="pn-btn" data-act="c-stop"' + (job.stopReq ? " disabled" : "") + ">" + (job.stopReq ? "Stopping after this step" : "Stop after this step") + "</button>";
    else if (!res.ok && !job.saved) {
      body = '<p class="pn-err" role="alert" id="pcErr" tabindex="-1">' + esc(res.message) + "</p>" + (b.caps ? '<p class="pn-mut pn-small" id="pcCaps">' + esc(b.caps) + "</p>" : "") +
        '<p class="pn-mut pn-small">Nothing was saved and no deck was counted.</p>' +
        (res.retry ? '<button type="button" class="pn-btn pri" data-act="c-resume">Try again</button>' : "") +
        '<button type="button" class="pn-btn" data-act="c-done">Done</button>';
    } else {
      var n = res.accepted, has = DK.questionCount(job.m), ni = job.imgKept || 0, ns = job.imgDone - ni, next = roundTarget(has);
      body = '<section class="pn-panel pn-score pc-res"><p class="pn-big">' + n + '</p><p class="pn-mut">' + (n === 1 ? "new question" : "new questions") + " · " + has + " of " + DECK_MAX + " in the deck</p>" +
        (job.imgDone ? '<p class="pn-mut pn-small" id="pcImgLine">' + ni + (ni === 1 ? " question on your images" : " questions on your images") + (ns > 0 ? ", " + ns + (ns === 1 ? " image" : " images") + " left out: the text near " + (ns === 1 ? "it" : "them") + " did not say clearly what " + (ns === 1 ? "it shows" : "they show") : "") + ".</p>" : "") +
        (res.mt ? '<p class="pn-mut pn-small" id="pcMt">Used ' + fmtN(res.mt) + " MaiK Tokens" + (job.wallet && job.wallet.costCapOn && job.wallet.balanceMt != null ? ", " + fmtN(job.wallet.balanceMt) + " left in your account" : "") + ".</p>" : "") +
        (b.caps ? '<p class="pn-mut pn-small" id="pcCaps">' + esc(b.caps) + "</p>" : "") + "</section>" +
        (note ? '<p class="pn-mut pn-small" id="pcNote">' + esc(note) + "</p>" : "") +
        (res.ok ? '<p class="pn-mut">' + (res.stopped ? "Stopped. What was made is saved." : res.full ? "This deck now has all its " + DECK_MAX + " questions. Make a new deck from the next chapter for more." : n ? "Saved on this phone" + (user() ? " and in your account." : ".") : res.more ? "No question passed the checks this time. Try again for 10 more." : "Every part of this source has been used. Make a new deck from more material.") + "</p>" :
          '<p class="pn-err" role="alert" id="pcErr" tabindex="-1">' + esc(res.message) + "</p>") +
        (has ? '<button type="button" class="pn-btn pri" data-act="c-prac" data-d="' + id + '">' + host.ico("play") + " Practise this deck</button>" : "") +
        (!res.ok && res.retry ? '<button type="button" class="pn-btn" data-act="c-resume">Try again</button>' :
          res.more && next && (res.ok || res.code === "rate") ? '<button type="button" class="pn-btn" data-act="c-more" data-d="' + id + '">' + host.ico("plus") + " Make " + next + " more<small class=\"pc-btnsub\">" + has + " of " + DECK_MAX + " · " + mtLine(mtEstimate(job.m)) + "</small></button>" : "") +
        '<button type="button" class="pn-btn" data-act="c-done">Done</button>';
    }
    host.paint(host.bar(res ? (res.ok ? "Deck saved" : job.saved ? "Deck paused" : "Deck not made") : "Making your deck", esc(job.m.title), "back") + '<div class="pn-body" id="pcProgView">' + body + "</div>", res && !res.ok ? "#pcErr" : null);
  }
  function updateProgress(host) {
    var r = host.root();
    if (!r || !r.querySelector("#pcProgView") || jobResult) return;
    var b = progressBits(), set = function (sel, t) { var el = r.querySelector(sel); if (el) el.textContent = t; };
    set("#pcCount", String(job.round.accepted)); set("#pcPhaseT", b.phase);
    var st = r.querySelector("#pcStages"); if (st) st.innerHTML = stageList(b);
    var bar = r.querySelector("#pcBarI"); if (bar) bar.style.transform = "scaleX(" + b.pct.toFixed(3) + ")";
  }
  function resume(host) {
    if (!job || !jobResult || jobResult.ok) return;
    jobResult = null; job.stopped = null; job.stopReq = false;
    if (onTop("#pcProgView", host)) host.rerender();
    runJob(host, job);
  }
  // Back from the background: a round cut off by a network or timeout error goes on by itself.
  if (G.document) G.document.addEventListener("visibilitychange", function () {
    if (G.document.visibilityState !== "visible" || !job || !jobResult || jobResult.ok || !AUTO_RESUME[jobResult.code] || !job.saved) return;
    var h = G.PREP && G.PREP._host;
    if (h) resume(h);
  });

  /* ---------- practise, cards, delete ---------- */
  function practise(host, deckId, mode) {
    Promise.all([DK.getDeck(deckId), DK.items(deckId), DK.imgs ? DK.imgs(deckId).then(null, function () { return []; }) : []]).then(function (a) {
      var m = a[0], items = (a[1] || []).filter(function (it) { return it && it.o && it.o.length === 4; });
      attachImages(items, a[2]);
      // An image question restored from the account has no picture on this phone: it is left out.
      items = items.filter(function (it) { return !it.imgId || it.img; });
      if (!m || !items.length) return host.toast("This deck has no questions yet.");
      items.forEach(function (it) { it._s = "deck"; it._m = "deck-" + deckId; });
      // The practice setup sheet (prep-setup.js): type, count, new or repeat, difficulty, mode, timer. Bookmarks do not apply.
      if (G.PREP_SETUP && G.PREP_SETUP.enabled()) {
        return G.PREP_SETUP.open({ kind: "deck", id: deckId, title: m.title, sub: "Your deck", mode: mode, load: function () { return [items]; },
          start: function (list, md, ro) { host.run(list, md, m.title, ro); } }, host);
      }
      var C = host.core(), list;
      if (mode === "exam") list = shuffle(items.slice()).slice(0, 20);
      else list = C.buildSession({ id: deckKey(deckId), items: items }, host.store(), host.today(), { size: 20, newCap: 20 });
      if (!list.length) return host.toast("Nothing to practise here right now.");
      host.run(list, mode, m.title);
    }, function () { host.toast("This deck could not be read on this phone."); });
  }
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), x = a[i]; a[i] = a[j]; a[j] = x; } return a; }
  function cards(host, deckId) {
    Promise.all([DK.getDeck(deckId), DK.cards(deckId)]).then(function (a) {
      if (!a[0] || !a[1] || !a[1].length) return host.toast("This deck has no cards yet.");
      if (G.PREP_CARDS) G.PREP_CARDS.start(host, a[0], a[1]);
    });
  }
  function remove(host, deckId) {
    if (job && !jobResult && job.deckId === deckId) return host.toast("This deck is being made. Wait for it to finish first.");
    if (G.confirm && !G.confirm("Delete this deck? Its questions, cards and progress are removed from this phone and from your account.")) return;
    DK.deleteDeck(deckId).then(function () {
      purgeStore(host.store(), deckId); host.save();
      if (job && job.deckId === deckId) { job = null; jobResult = null; }
      host.toast("Deck deleted.");
      if (onTop("#pcDeckView", host)) host.back(); else host.rerender();
    }, function () { host.toast("The deck could not be deleted. Try again."); });
  }

  /* ---------- events (prep.js forwards every data-act starting "c-") ---------- */
  function act(a, el, host) {
    if (a.indexOf("c-k") === 0) return G.PREP_CARDS && G.PREP_CARDS.act(a, el, host);
    if (a === "c-home") return host.push(function () { renderDecks(host); });
    if (a === "c-home-retry") return fillDecks(host);
    if (a === "c-open") { var od = deckIdOf(el); return host.push(function () { renderDeck(host, od); }); }
    if (a === "c-new") { resetCreate(host); return host.push(function () { renderCreate(host); }); }
    if (a === "c-src") { cs.kind = el.getAttribute("data-v") === "pdf" ? "pdf" : "paste"; cs.err = ""; return host.rerender(); }
    if (a === "c-pick") { var f = host.root() && host.root().querySelector("#pcFile"); if (f) f.click(); return; }
    if (a === "c-next") { var ta = host.root() && host.root().querySelector("#pcText"); if (ta) cs.text = ta.value; return toSettings(host); }
    if (a === "c-pages") return host.push(function () { renderPages(host); });
    if (a === "c-pg") return tapPage(host, +el.getAttribute("data-p"));
    if (a === "c-pgrange") { cs.rangeOn = !cs.rangeOn; cs.anchor = 0; cs.pgMsg = cs.rangeOn ? "Tap the first page of the range." : ""; return syncSel(host); }
    if (a === "c-pgclear") { cs.sel = []; cs.anchor = 0; cs.pgMsg = ""; return syncSel(host); }
    if (a === "c-pgall") { cs.sel = SR.selInitial(cs.pdf.pages); cs.pgMsg = ""; return syncSel(host); }
    if (a === "c-pgapply") return applySpec(host);
    if (a === "c-pgok") { if (!cs.sel.length) return; cs.err = ""; return host.push(function () { renderSettings(host); }); }
    if (a === "c-exam") { cs.exam = createExam(el.getAttribute("data-v")); return host.rerender(); }
    if (a === "c-diff") { var dv = el.getAttribute("data-v"); cs.diff = dv === "mix" ? "mix" : +dv; return host.rerender(); }
    if (a === "c-own") { cs.own = !cs.own; if (cs.own && /^Confirm/.test(cs.err)) cs.err = ""; return host.rerender(); }
    if (a === "c-go") return go(host);
    if (a === "c-scrubok") { if (cs.pending) build(host, cs.pending); return; }
    if (a === "c-stop") { if (job) { job.stopReq = true; host.rerender(); } return; }
    if (a === "c-resume") return resume(host);
    if (a === "c-prog") return host.push(function () { renderProgress(host); });
    if (a === "c-done") return host.back();
    if (a === "c-prac") return practise(host, deckIdOf(el), "study");
    if (a === "c-test") return practise(host, deckIdOf(el), "exam");
    if (a === "c-cards") return cards(host, deckIdOf(el));
    if (a === "c-more" || a === "c-cont") {
      var d = deckIdOf(el);
      if (onTop("#pcProgView", host)) host.back();
      return startMore(host, d, false);
    }
    if (a === "c-del") return remove(host, deckIdOf(el));
    if (a === "c-img") { var k = el.getAttribute("data-v"); if (cs.imgOn[k]) delete cs.imgOn[k]; else cs.imgOn[k] = 1; return host.rerender(); }
    if (a === "c-imgok") return imagesChosen(host, true);
    if (a === "c-imgskip") return imagesChosen(host, false);
  }

  G.PREP_C = { act: act, cfg: cfg, _pure: PURE, _cs: cs, _job: function () { return { job: job, result: jobResult }; }, _pg: pg };
})(typeof window !== "undefined" ? window : this);
