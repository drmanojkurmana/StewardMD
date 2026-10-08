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
   FSRS cards under "p:deck-<deckId>". They keep prov "AI" (6.4) and carry gen "AI", so the runner labels them
   "AI-generated, auto-checked". Pure helpers load under node for tests. */
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
  var MONTH_CAP = 10, DAY_CAP = 3;
  var PROFILE = { id: "neet-pg", v: 1, cog: { recall: 0.4, application: 0.4, reasoning: 0.2 }, d: { 1: 0.3, 2: 0.5, 3: 0.2 } };

  /* ---------- errors (6.0): { error, reason, retryAfter? } -> one short message ---------- */
  var MSG = {
    "bad-input": "The source could not be used. Try a shorter or cleaner piece of text.",
    "sign-in": "Sign in to make a deck. Your decks stay on this phone.",
    "needs-plan": "Making decks is not part of your plan.",
    "too-large": "This source is too large for one deck. Pick fewer pages.",
    "rate": "Too many requests at once. Wait a few seconds and try again.",
    "circuit-breaker": "Deck making is paused for today. Please try again tomorrow.",
    "daily-calls": "You have reached today's limit for making questions. Try again tomorrow.",
    "daily-decks": "You have made 3 decks today, the daily limit. Try again tomorrow.",
    "month-decks": "You have made 10 decks this month, the monthly limit. Your decks still work for practice.",
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
  var STOPS = { "deck-not-started": 1, "sign-in": 1, "needs-plan": 1, "bad-input": 1, "too-large": 1, "circuit-breaker": 1, "daily-calls": 1, "daily-decks": 1, "month-decks": 1, "token-cap": 1 };
  // Codes the manifest records in cost.stopped (6.7).
  var CAP_STOPS = { "token-cap": 1, "month-decks": 1, "daily-decks": 1, "daily-calls": 1, "circuit-breaker": 1 };
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
  function mixFor(n, prof) { prof = prof || PROFILE; return { dl: weights(prof.d || PROFILE.d), cog: weights(prof.cog || PROFILE.cog) }; }

  /* ---------- usage, caps and cost lines ---------- */
  function addUsage(cost, u) {
    if (!u) return cost;
    cost.inTok += +u.inTok || 0; cost.outTok += +u.outTok || 0; cost.thinkTok += +u.thinkTok || 0;
    cost.inr = Math.round((cost.inr + (+u.inr || 0)) * 10000) / 10000;
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
    if (caps.month != null && caps.at.slice(0, 7) === today.slice(0, 7)) parts.push(caps.month + " of " + MONTH_CAP + " decks this month");
    if (caps.day != null && caps.at === today) parts.push(caps.day + " of " + DAY_CAP + " today");
    return parts.join(", ");
  }
  // A cap refusal says where the counter stands even though no usage came back: the month or the day is full.
  function capsAfterStop(caps, code, today) {
    if (code !== "month-decks" && code !== "daily-decks") return caps;
    var c = caps && caps.at === today ? { month: caps.month, day: caps.day, at: today } : { month: caps && caps.at && caps.at.slice(0, 7) === today.slice(0, 7) ? caps.month : null, day: null, at: today };
    if (code === "month-decks") c.month = MONTH_CAP; else c.day = DAY_CAP;
    return c;
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
  function factPayload(f, fi, byN) {
    var out = { fi: fi, fid: f.id, ft: f.ft, cq: f.cq, sn: f.sn, fk: f.fk, p: f.p, h: f.h };
    if (/^[a-z0-9-]{1,40}$/.test(String(f.sec || ""))) out.t = f.sec;   // the server stamps it on the item
    out.sents = f.sn.map(function (n) { var s = byN[n]; return { n: n, tx: s ? s.tx : "" }; });
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
  function newRound(target) { return { target: target, accepted: 0, maxBatches: Math.ceil(target * 1.4 / BATCH), started: 0, batches: [], failed: [] }; }
  /* o = { m (manifest), sents, sections, facts (stored), items (stored), saved, target, profile, ctx } */
  function newJob(o) {
    var job = { m: o.m, deckId: o.m.id, sents: o.sents, sections: o.sections || [], byN: {}, chunks: SR.chunkSentences(o.sents), order: [], done: {},
      facts: {}, factOrder: [], stems: [], tlist: [], round: newRound(o.target || TARGET), saved: !!o.saved, stopReq: false, stopped: null,
      steps: 0, phase: "", caps: null, profile: o.profile || PROFILE, ctx: o.ctx || {} };
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
     (ceil(target x 1.4 / 7): 2 for 10 questions) are spent, so a round's cost has a ceiling. */
  function nextOp(job) {
    var r = job.round, st = ["mcq", "solve", "review"], i, k;
    if (job.stopped || job.stopReq) return null;
    for (k = 0; k < st.length; k++) for (i = 0; i < r.batches.length; i++) if (r.batches[i].stage === st[k]) return { op: st[k], b: i };
    if (r.failed.length) return { op: "regen" };
    if (r.accepted >= r.target) return null;
    var need = r.maxBatches - r.started;
    if (need <= 0) return null;
    var unused = unusedFids(job).length;
    if (unused < need * BATCH) { var c = nextChunk(job); if (c != null) return { op: "facts", chunk: c }; }
    if (unused) return { op: "batch" };
    return null;
  }
  var PHASE = { facts: "Finding the key facts in your source", mcq: "Writing questions", solve: "Checking each answer blind", review: "Reviewing each question", regen: "Rewriting the questions that failed a check", batch: "Writing questions" };

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
  function saveDeck(job, store) { return store.putDeck(job.m); }

  /* Run one op. deps = { send(body) -> Promise(json), store: PREP_DECKS-like, onCaps(caps)? }. Resolves when the op's
     result is applied and saved. A failed send leaves the job as it was, so the same op (same idem) is re-sent. */
  function step(job, op, deps) {
    var r = job.round, m = job.m, store = deps.store, body, b;
    job.phase = op.op;
    if (op.op === "batch") {
      var ids = unusedFids(job), n = Math.min(r.maxBatches - r.started, Math.ceil(ids.length / BATCH)), size = Math.min(BATCH, Math.ceil(ids.length / n));
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
        var first = job.saved ? Promise.resolve() : store.putSrc(srcRec(job));
        return first.then(function () { job.saved = true; return store.putFacts(fresh); }).then(function () { return store.putCards(cards); }).then(function () { return saveDeck(job, store); });
      });
    }
    b = r.batches[op.b];
    if (op.op === "mcq") {
      body.facts = b.fids.map(function (id, fi) { return factPayload(job.facts[id], fi, job.byN); });
      body.mix = mixFor(b.fids.length, job.profile);
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
        r.accepted += keep.length; m.stats.accepted += keep.length;
        m.topics = DK.topicsFor(job.deckId, job.tlist, job.sections);
        return store.putItems(keep).then(function () { return saveDeck(job, store); });
      });
    }
    return Promise.reject(new Error("unknown op " + op.op));
  }
  function applyUsage(job, res, deps) {
    addUsage(job.m.cost, res && res.usage);
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
        return Promise.resolve({ ok: true, accepted: job.round.accepted, more: hasMore(job), stopped: stoppedByUser });
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
      var done = job.saved ? deps.store.putDeck(job.m).then(null, function () {}) : Promise.resolve();
      return done.then(function () { return { ok: false, code: code, message: MSG[code], retry: canRetry(code), accepted: job.round.accepted, more: hasMore(job) }; });
    });
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
    errorCode: errorCode, errorMessage: errorMessage, canRetry: canRetry, shouldRetry: shouldRetry, opError: opError,
    idemKey: idemKey, deckIdFor: deckIdFor, mixFor: mixFor, addUsage: addUsage, dayKey: dayKey, capsFrom: capsFrom, capLine: capLine, capsAfterStop: capsAfterStop, costLine: costLine,
    factRecord: factRecord, factPayload: factPayload, paraFor: paraFor, gatesPass: gatesPass, toStored: toStored, toCard: toCard, jaccard: jaccard, nearDup: nearDup,
    deckKey: deckKey, cardDeckKey: cardDeckKey, deckProgress: deckProgress, purgeStore: purgeStore, defaultTitle: defaultTitle, readNote: readNote, unreadableMessage: unreadableMessage,
    newRound: newRound, newJob: newJob, nextOp: nextOp, unusedFids: unusedFids, hasMore: hasMore, step: step, runRound: runRound, callOp: callOp
  };
  if (isNode) { module.exports = PURE; return; }

  /* ================= browser ================= */
  var CAPS_KEY = "smd_prep_c_caps";
  var cs = { kind: "paste", text: "", title: "", own: false, pdf: null, pagesSpec: "", err: "", busy: "", pending: null };
  var job = null, jobResult = null, profiles = {}, note = "";   // note: what the reader could not read as text (readNote)

  function readCaps() { try { return JSON.parse(G.localStorage.getItem(CAPS_KEY) || "null"); } catch (e) { return null; } }
  function writeCaps(c) { try { G.localStorage.setItem(CAPS_KEY, JSON.stringify(c)); } catch (e) {} }
  function capsNow() { return capLine((job && job.caps) || readCaps(), dayKey()); }
  function newJobCaps(j) { j.caps = readCaps(); return j; }
  function user() { var a = G.SMD_AUTH; return a && a.currentUser ? a.currentUser : null; }
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

  /* ---------- Your decks ---------- */
  function renderDecks(host) {
    var esc = host.esc, cl = capsNow();
    host.paint(host.bar("Your decks", "Questions and cards from your PDF or notes", "back") + '<div class="pn-body" id="pcDecksView"><div id="pcHb"></div>' +
      '<button type="button" class="pn-btn pri" data-act="c-new">' + host.ico("plus") + " Make a deck</button>" +
      (cl ? '<p class="pn-mut pn-small" id="pcCapLine">' + esc(cl) + "</p>" : "") +
      (job && !jobResult ? '<button type="button" class="pn-mod" data-act="c-prog"><span class="pn-mb"><b>Making questions for ' + esc(job.m.title) + "</b><small>Show progress</small></span>" + host.ico("chev") + "</button>" : "") +
      '<div id="pcDecks" class="pc-decks"><p class="pn-load" role="status">Loading your decks…</p></div>' +
      '<p class="pn-note">Decks stay on this phone. Removing the app or clearing its data deletes them.</p></div>');
    DK.listDecks().then(function (list) {
      var box = host.root() && host.root().querySelector("#pcDecks");
      if (!box) return;
      var s = host.store(), td = host.today(), hb = host.root().querySelector("#pcHb");
      if (hb && list.length && host.hband) {
        var nq = 0, nc = 0, due = 0;
        list.forEach(function (m) { var pg = deckProgress(s, m.id, td); nq += DK.questionCount(m); nc += m.stats.cards || 0; due += (pg.due || 0) + (pg.cardsDue || 0); });
        hb.innerHTML = host.hband("decks", host.fmt(list.length), list.length === 1 ? "deck" : "decks", host.fmt(nq) + (nq === 1 ? " question" : " questions") + " and " + host.fmt(nc) + (nc === 1 ? " card" : " cards") + (due ? ", " + host.fmt(due) + " due today." : ", all on this phone."));
      }
      box.innerHTML = list.length ? list.map(function (m) { return deckRow(host, m, deckProgress(s, m.id, td)); }).join("") :
        '<p class="pn-empty pn-art-decks">No decks yet. Make one from a PDF or your notes, and practise it like any module.</p>';
    }, function () {
      var box = host.root() && host.root().querySelector("#pcDecks");
      if (box) box.innerHTML = '<p class="pn-err" role="alert">Your decks could not be read on this phone.</p>';
    });
  }
  function deckRow(host, m, pg) {
    var esc = host.esc, n = DK.questionCount(m), t = esc(m.title), id = esc(m.id), busy = job && !jobResult && job.deckId === m.id;
    var line = host.fmt(n) + (n === 1 ? " question" : " questions") + " · " + host.fmt(m.stats.cards || 0) + " cards" + (pg.due ? " · " + host.fmt(pg.due) + " due" : "") + (pg.cardsDue ? " · " + host.fmt(pg.cardsDue) + " cards due" : "");
    var hue = 0; for (var i = 0; i < m.title.length; i++) hue = (hue * 31 + m.title.charCodeAt(i)) % 360;
    return '<section class="pn-panel pc-deck" aria-label="' + t + '"><div class="pc-dh"><span class="pn-ic sm" style="--h:' + hue + '" aria-hidden="true">' + host.ico("deck") + '</span><span class="pn-mb"><b>' + t + "</b><small>" + line + "</small>" +
      ((m.source && m.source.ocr) || (m.cost && m.cost.stopped) ? '<small class="pc-lab">' + [m.source && m.source.ocr ? "Partly read by OCR" : "", m.cost && m.cost.stopped ? "Stopped: " + esc(stopWord(m.cost.stopped)) : ""].filter(Boolean).join(" · ") + "</small>" : "") + "</span>" +
      '<button type="button" class="pn-ib" data-act="c-del" data-d="' + id + '" aria-label="Delete the deck ' + t + '">' + host.ico("x") + "</button></div>" +
      '<div class="pc-acts">' +
      '<button type="button" class="pn-btn sm pri" data-act="c-prac" data-d="' + id + '" aria-label="Practise ' + t + '"' + (n ? "" : " disabled") + ">" + host.ico("play") + " Practise</button>" +
      '<button type="button" class="pn-btn sm" data-act="c-test" data-d="' + id + '" aria-label="Timed test on ' + t + '"' + (n ? "" : " disabled") + ">" + host.ico("clock") + " Timed test</button>" +
      '<button type="button" class="pn-btn sm" data-act="c-cards" data-d="' + id + '" aria-label="Flashcards for ' + t + '"' + (m.stats.cards ? "" : " disabled") + ">Cards</button>" +
      '<button type="button" class="pn-btn sm" data-act="c-more" data-d="' + id + '" aria-label="Make 10 more questions for ' + t + '"' + (busy ? " disabled" : "") + ">" + host.ico("plus") + " 10 more</button>" +
      "</div></section>";
  }
  function stopWord(code) { return { "token-cap": "size limit reached", "month-decks": "monthly limit", "daily-decks": "daily limit", "daily-calls": "daily limit", "circuit-breaker": "paused" }[code] || code; }

  /* ---------- Make a deck ---------- */
  function renderCreate(host) {
    var esc = host.esc, ex = host.exam(), cl = capsNow();
    var chip = function (v, label) { return '<button type="button" class="pn-chip' + (cs.kind === v ? " on" : "") + '" aria-pressed="' + (cs.kind === v) + '" data-act="c-src" data-v="' + v + '">' + label + "</button>"; };
    var src = cs.kind === "paste" ?
      '<label class="pc-lbl" for="pcText">Your notes</label><textarea id="pcText" class="pc-in pc-ta" rows="9" placeholder="Paste text from your notes or a chapter. Headings on their own line become sections.">' + esc(cs.text) + "</textarea>" +
      '<p class="pn-mut pn-small" id="pcChars">' + host.fmt(cs.text.length) + " characters</p>" :
      '<button type="button" class="pn-btn" data-act="c-pick">' + host.ico("dl") + (cs.pdf ? " Choose another PDF" : " Choose a PDF") + "</button>" +
      '<input type="file" id="pcFile" accept="application/pdf,.pdf" hidden aria-hidden="true" tabindex="-1">' +
      (cs.busy ? '<p class="pn-load" role="status">' + esc(cs.busy) + "</p>" : "") +
      (cs.pdf ? '<p class="pc-file"><b>' + esc(cs.pdf.name) + "</b> · " + host.fmt(cs.pdf.pages) + " pages</p>" +
        '<label class="pc-lbl" for="pcPages">Pages to use</label><input id="pcPages" class="pc-in" inputmode="numeric" autocomplete="off" value="' + esc(cs.pagesSpec) + '">' +
        '<p class="pn-mut pn-small">' + SR.PAGE_CAP + " pages at most. Example: 1-20, 25. Pick the chapter you are studying.</p>" : "") +
      '<p class="pn-mut pn-small">' + (SR.canOcr() ? "Scanned pages are read on this phone by on-device OCR, up to " + SR.OCR_PAGE_CAP + " in one deck. Nothing is uploaded for this." : "Scanned pages are read only in the StewardMD phone app. Here, only PDFs with real text work.") + "</p>";
    host.paint(host.bar("Make a deck", esc(ex.label), "back") + '<div class="pn-body" id="pcCreateView">' +
      '<div class="pn-wrap" role="group" aria-label="Source">' + chip("paste", "Paste notes") + chip("pdf", "PDF") + "</div>" + src +
      '<label class="pc-lbl" for="pcTitle">Deck name (optional)</label><input id="pcTitle" class="pc-in" maxlength="80" autocomplete="off" value="' + esc(cs.title) + '">' +
      '<p class="pn-mut pn-small">Questions are written for ' + esc(ex.label) + ". Change the exam on the PrepNucleus home.</p>" +
      '<button type="button" class="pc-check" data-act="c-own" aria-pressed="' + cs.own + '"><span class="pc-box" aria-hidden="true">' + (cs.own ? host.ico("check") : "") + "</span>" +
      "<span>These are my own notes, or material I am allowed to use for study.</span></button>" +
      '<p class="pn-mut pn-small">Before anything is sent, names, phone numbers and ID numbers are looked for and removed. Only the text is sent, never the file. Questions are made from it and checked automatically.</p>' +
      (cl ? '<p class="pn-mut pn-small" id="pcCapLine">' + esc(cl) + "</p>" : "") +
      (cs.err ? '<p class="pn-err" role="alert" id="pcErr" tabindex="-1">' + esc(cs.err) + "</p>" : "") +
      '<button type="button" class="pn-btn pri" data-act="c-go"' + (cs.busy ? " disabled" : "") + ">Make 10 questions</button>" +
      '<p class="pn-mut pn-small">Limits: 10 decks a month and 3 a day. Asking for 10 more questions on a deck does not count as a new deck.</p></div>', cs.err ? "#pcErr" : null);
    var r = host.root();
    if (!r) return;
    var ta = r.querySelector("#pcText"), ti = r.querySelector("#pcTitle"), pg = r.querySelector("#pcPages"), fi = r.querySelector("#pcFile");
    if (ta) ta.addEventListener("input", function () { cs.text = ta.value; var c = r.querySelector("#pcChars"); if (c) c.textContent = host.fmt(cs.text.length) + " characters"; });
    if (ti) ti.addEventListener("input", function () { cs.title = ti.value; });
    if (pg) pg.addEventListener("input", function () { cs.pagesSpec = pg.value; });
    if (fi) fi.addEventListener("change", function () { if (fi.files && fi.files[0]) pickPdf(fi.files[0], host); });
  }
  function pickPdf(file, host) {
    cs.err = ""; cs.pdf = null; cs.busy = "Opening the PDF…";
    host.rerender();
    SR.openPdf(file).then(function (pdf) {
      cs.busy = ""; cs.pdf = pdf; cs.pagesSpec = SR.defaultPages(pdf.pages);
      if (!cs.title) cs.title = pdf.name.replace(/\.pdf$/i, "").slice(0, 80);
      if (onTop("#pcCreateView", host)) host.rerender();
    }, function () {
      cs.busy = ""; cs.err = "This PDF could not be opened. It may be protected by a password or damaged.";
      if (onTop("#pcCreateView", host)) host.rerender();
    });
  }
  function createError(host, msg) { cs.err = msg; cs.busy = ""; if (onTop("#pcCreateView", host)) host.rerender(); }
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
    var pp = SR.parsePages(cs.pagesSpec, cs.pdf.pages);
    if (pp.error) return createError(host, pp.error);
    cs.busy = "Reading page 1 of " + pp.pages.length + "…";
    host.rerender();
    var ocrOn = SR.canOcr();
    SR.readPdfPages(cs.pdf.doc, pp.pages, function (d, n, phase) {
      var el = host.root() && host.root().querySelector("#pcCreateView .pn-load");
      if (!el) return;
      if (phase === "ocr") el.textContent = d < n ? "Reading scanned page " + (d + 1) + " of " + n + " on this phone" : "Scanned pages read";
      else if (d < n) el.textContent = "Reading page " + (d + 1) + " of " + n + "…";
    }).then(function (rd) {
      cs.busy = "";
      if (!rd.pages.length) return createError(host, unreadableMessage(rd, ocrOn));
      review(host, { kind: "pdf", raw: rd.pages, title: cs.title, name: cs.pdf.name, pages: pp.pages, scanned: rd.scanned, ocr: rd.ocrPages.length, skipped: rd.skipped.length, note: readNote(rd, ocrOn) });
    }, function () { createError(host, "The pages could not be read. Try other pages or another PDF."); });
  }
  function rawText(src) {
    if (src.kind === "paste") return src.text;
    return src.raw.map(function (pg) { return pg.lines.map(function (l) { return l.tx; }).join("\n"); }).join("\n");
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
    else doc = SR.docFromPdfPages(src.raw.map(function (pg) { return { p: pg.p, ocr: !!pg.ocr, lines: pg.lines.map(function (l) { return { tx: SR.prepScrub(l.tx), size: l.size, ocr: !!l.ocr }; }) }; }), src.title);
    var chk = SR.capCheck(doc, src.pages ? src.pages.length : 1);
    if (chk.error) { if (onTop("#pcScrubView", host)) host.back(); return createError(host, chk.error); }
    var ex = host.exam(), u = user(), sha = DK.sha256(SR.docText(doc)), title = (src.title || "").trim() || defaultTitle(doc, src.name);
    cs.text = ""; cs.title = ""; cs.pdf = null; cs.pending = null; cs.own = false;
    note = src.note || "";
    loadProfile(ex.id).then(function (prof) {
      var id = deckIdFor({ uid: u && u.uid, sha: sha, exam: ex.id, profileV: prof.v || 1, pv: PV, model: MODEL });
      return DK.getDeck(id).then(function (old) {
        if (old) { host.toast("You already have a deck from this source. Adding 10 more questions to it."); return startMore(host, old.id, true); }
        var m = DK.newManifest({ id: id, title: title, exam: ex.id, profileV: prof.v || 1, pv: PV, model: MODEL, source: { type: src.kind, name: src.name, pages: SR.pageSpan(src.pages), sha: sha } });
        if (src.ocr) m.source.ocr = src.ocr;
        if (src.skipped) m.source.skipped = src.skipped;
        note = src.note || "";
        start(host, newJob({ m: m, sents: doc.sents, sections: doc.sections, facts: [], items: [], saved: false, target: TARGET, profile: prof, ctx: ctxOf(m) }), true);
      });
    }).then(null, function () { createError(host, MSG.storage); });
  }
  function ctxOf(m) { return { doc: m.source.sha.slice(0, 12), name: m.source.name || m.title, exam: m.exam, pv: m.pv, model: m.model }; }
  function startMore(host, deckId, fromCreate) {
    if (!fromCreate) note = "";
    if (job && !jobResult) { host.toast("A deck is being made. Wait for it to finish first."); return Promise.resolve(); }
    return Promise.all([DK.getDeck(deckId), DK.getSrc(deckId), DK.facts(deckId), DK.items(deckId)]).then(function (a) {
      var m = a[0], src = a[1];
      if (!m || !src) { host.toast("This deck's source is missing on this phone, so no more questions can be made."); return; }
      return loadProfile(m.exam).then(function (prof) {
        m.cost.stopped = null;
        start(host, newJob({ m: m, sents: src.sents, sections: src.sections, facts: a[2], items: a[3], saved: true, target: TARGET, profile: prof, ctx: ctxOf(m) }), fromCreate);
      });
    });
  }
  // Leave the Create (and warning) screens under the progress screen, so back from it lands on Your decks.
  function start(host, j, fromCreate) {
    job = newJobCaps(j); jobResult = null;
    if (fromCreate) { while (onTop("#pcScrubView", host) || onTop("#pcCreateView", host)) host.back(); }
    host.push(function () { renderProgress(host); });
    runRound(job, { send: send, store: DK, today: dayKey(), onCaps: writeCaps, onStep: function () { updateProgress(host); } }).then(function (res) {
      jobResult = res;
      if (onTop("#pcProgView", host)) host.rerender();
      else if (res.ok) host.toast(res.accepted + " new questions are ready in " + j.m.title + ".");
      else host.toast(res.message);
    });
  }

  /* ---------- progress ---------- */
  function progressBits(host) {
    var r = job.round, pct = Math.min(100, Math.round(r.accepted * 100 / r.target));
    var net = job.phase === "facts" || job.phase === "mcq" || job.phase === "solve" || job.phase === "review";
    return { pct: pct, count: r.accepted + " of " + r.target, phase: (PHASE[job.phase] || "Getting ready") + (net ? " (step " + (job.steps + 1) + ")" : ""), caps: capsNow() };
  }
  function renderProgress(host) {
    if (!job) return host.back();
    var esc = host.esc, b = progressBits(host), res = jobResult, id = esc(job.deckId), body;
    if (!res) body = '<section class="pn-panel pc-progp" aria-live="polite"><p class="pn-big" id="pcCount">' + b.count + "</p><p class=\"pn-mut\">questions ready</p>" +
      '<span class="pn-prog pc-bar" aria-hidden="true"><i id="pcBarI" style="transform:scaleX(' + (b.pct / 100) + ')"></i></span>' +
      '<p id="pcPhase">' + esc(b.phase) + '</p><p class="pn-mut pn-small" id="pcCaps">' + esc(b.caps) + "</p></section>" +
      '<button type="button" class="pn-btn" data-act="c-stop"' + (job.stopReq ? " disabled" : "") + ">" + (job.stopReq ? "Stopping after this step" : "Stop after this step") + "</button>" +
      (note ? '<p class="pn-mut pn-small" id="pcNote">' + esc(note) + "</p>" : "") +
      '<p class="pn-mut pn-small">Each step is checked before the next. You can go back; the deck keeps building.</p>';
    else if (!res.ok && !job.saved) {
      body = '<p class="pn-err" role="alert" id="pcErr" tabindex="-1">' + esc(res.message) + "</p>" + (b.caps ? '<p class="pn-mut pn-small" id="pcCaps">' + esc(b.caps) + "</p>" : "") +
        '<p class="pn-mut pn-small">Nothing was saved and no deck was counted.</p>' +
        (res.retry ? '<button type="button" class="pn-btn pri" data-act="c-resume">Try again</button>' : "") +
        '<button type="button" class="pn-btn" data-act="c-done">Done</button>';
    } else {
      var n = res.accepted, has = DK.questionCount(job.m);
      body = '<section class="pn-panel pn-score"><p class="pn-big">' + n + '</p><p class="pn-mut">' + (n === 1 ? "new question" : "new questions") + " · " + has + " in the deck</p>" +
        (b.caps ? '<p class="pn-mut pn-small" id="pcCaps">' + esc(b.caps) + "</p>" : "") + "</section>" +
        (note ? '<p class="pn-mut pn-small" id="pcNote">' + esc(note) + "</p>" : "") +
        (res.ok ? '<p class="pn-mut">' + (res.stopped ? "Stopped. What was made is saved." : n ? "Saved on this phone." : res.more ? "No question passed the checks this time. Try 10 more." : "Every part of this source has been used. Make a new deck from more material.") + "</p>" :
          '<p class="pn-err" role="alert" id="pcErr" tabindex="-1">' + esc(res.message) + "</p>") +
        (has ? '<button type="button" class="pn-btn pri" data-act="c-prac" data-d="' + id + '">' + host.ico("play") + " Practise this deck</button>" : "") +
        (job.m.stats.cards ? '<button type="button" class="pn-btn" data-act="c-cards" data-d="' + id + '">Flashcards</button>' : "") +
        (!res.ok && res.retry ? '<button type="button" class="pn-btn" data-act="c-resume">Try again</button>' :
          res.more && (res.ok || res.code === "rate") ? '<button type="button" class="pn-btn" data-act="c-more" data-d="' + id + '">' + host.ico("plus") + " 10 more</button>" : "") +
        '<button type="button" class="pn-btn" data-act="c-done">Done</button>';
    }
    host.paint(host.bar(res ? (res.ok ? "Deck saved" : job.saved ? "Deck paused" : "Deck not made") : "Making your deck", esc(job.m.title), "back") + '<div class="pn-body" id="pcProgView">' + body + "</div>", res && !res.ok ? "#pcErr" : null);
  }
  function updateProgress(host) {
    var r = host.root();
    if (!r || !r.querySelector("#pcProgView") || jobResult) return;
    var b = progressBits(host), set = function (sel, t) { var el = r.querySelector(sel); if (el) el.textContent = t; };
    set("#pcCount", b.count); set("#pcPhase", b.phase); set("#pcCaps", b.caps);
    var bar = r.querySelector("#pcBarI"); if (bar) bar.style.transform = "scaleX(" + (b.pct / 100) + ")";
  }
  function resume(host) {
    if (!job || !jobResult || jobResult.ok) return;
    jobResult = null; job.stopped = null; job.stopReq = false;
    var j = job;
    host.rerender();
    runRound(j, { send: send, store: DK, today: dayKey(), onCaps: writeCaps, onStep: function () { updateProgress(host); } }).then(function (res) {
      jobResult = res;
      if (onTop("#pcProgView", host)) host.rerender(); else host.toast(res.ok ? res.accepted + " new questions are ready." : res.message);
    });
  }

  /* ---------- practise, cards, delete ---------- */
  function practise(host, deckId, mode) {
    Promise.all([DK.getDeck(deckId), DK.items(deckId)]).then(function (a) {
      var m = a[0], items = (a[1] || []).filter(function (it) { return it && it.o && it.o.length === 4; });
      if (!m || !items.length) return host.toast("This deck has no questions yet.");
      items.forEach(function (it) { it._s = "deck"; it._m = "deck-" + deckId; });
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
    if (G.confirm && !G.confirm("Delete this deck? Its questions, cards and progress are removed from this phone.")) return;
    DK.deleteDeck(deckId).then(function () {
      purgeStore(host.store(), deckId); host.save();
      if (job && job.deckId === deckId) { job = null; jobResult = null; }
      host.toast("Deck deleted."); host.rerender();
    }, function () { host.toast("The deck could not be deleted. Try again."); });
  }

  /* ---------- events (prep.js forwards every data-act starting "c-") ---------- */
  function act(a, el, host) {
    if (a.indexOf("c-k") === 0) return G.PREP_CARDS && G.PREP_CARDS.act(a, el, host);
    if (a === "c-home") return host.push(function () { renderDecks(host); });
    if (a === "c-new") { cs.err = ""; return host.push(function () { renderCreate(host); }); }
    if (a === "c-src") { cs.kind = el.getAttribute("data-v") === "pdf" ? "pdf" : "paste"; cs.err = ""; return host.rerender(); }
    if (a === "c-pick") { var f = host.root() && host.root().querySelector("#pcFile"); if (f) f.click(); return; }
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
    if (a === "c-more") {
      var d = deckIdOf(el);
      if (onTop("#pcProgView", host)) host.back();
      return startMore(host, d, false);
    }
    if (a === "c-del") return remove(host, deckIdOf(el));
  }

  G.PREP_C = { act: act, cfg: cfg, _pure: PURE, _cs: cs, _job: function () { return { job: job, result: jobResult }; } };
})(typeof window !== "undefined" ? window : this);
