/* PrepNucleus play (owner 2026-10-30): swipe feed, spot diagnosis of the day, boss battles, voice mode, focus room,
   wrapped, seasons, mnemonic lab, earned streak freezes and quick fire. window.PREP_PLAY. ES5.
   Loaded by prep-loader.js after prep.js (optional: without it nothing changes); draws through PREP._host. prep.js
   forwards every data-act starting "v-" here, asks back() first, calls homeHtml() for the Play section, mnHtml(it)
   under an explained question, noteAnswer() from record() and leave() on close. Flag smd_prep_play, default ON
   (localStorage "0" or ?play=0: PREP_PLAY stays undefined).

   Honest by rule (vault/decisions/Decisions.md 2026-10-06 "every line true"): live counts, boards and seasons come
   from the server (functions/api/prep/play) and show nothing when there is nothing real; no fake urgency, no paid
   streaks. Store (smd_prep_v1): hr[0..23] answers by hour; wm["YYYY-MM"][subject] answers this month; frz = { bank,
   used: [day], earned: day }; boss[subject] = { won, best, tries }; spot = { day, ok, ms }, spoth[day] = 1|0;
   fxm["YYYY-MM"] = focus minutes. Pure helpers load under node for tests. */
(function (G) {
  "use strict";
  var NODE = typeof module !== "undefined" && module.exports && !(G && G.document);
  var FREEZE_MAX = 2, FREEZE_EXTRA = 50, BOSS_N = 20, BOSS_LIVES = 3, SPOT_MS = 10000, FEED_BATCH = 24;
  var L = ["A", "B", "C", "D", "E", "F"];

  /* ================= pure ================= */
  function hashStr(s) { var h = 2166136261; s = String(s); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
  function rng(seed) { var x = hashStr(seed) || 1; return function () { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
  function shuffled(a, seed) { var r = rng(seed), o = a.slice(); for (var i = o.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)), t = o[i]; o[i] = o[j]; o[j] = t; } return o; }
  function ym(ms) { var d = new Date(ms); return d.getFullYear() + "-" + (d.getMonth() < 9 ? "0" : "") + (d.getMonth() + 1); }

  /* Spot diagnosis of the day: one image item for everyone on an IST day, the right diagnosis and three others from
     the same deck (the whole set when the deck has fewer than 4 diagnoses), options in a seeded order. */
  function spotPick(pool, day) {
    if (!pool || !pool.length) return null;
    var it = pool[hashStr("spot:" + day) % pool.length];
    var same = pool.filter(function (x) { return x.set === it.set && x.deck === it.deck; }), dxs = uniq(same.map(function (x) { return x.dx; }));
    if (dxs.length < 4) dxs = uniq(pool.filter(function (x) { return x.set === it.set; }).map(function (x) { return x.dx; }));
    if (dxs.length < 4) dxs = uniq(pool.map(function (x) { return x.dx; }));
    var others = shuffled(dxs.filter(function (d) { return d !== it.dx; }), "spot-o:" + day).slice(0, 3);
    var opts = shuffled([it.dx].concat(others), "spot-k:" + day);
    return { item: it, o: opts, a: opts.indexOf(it.dx), day: day };
  }
  // The first sentence of an explanation, for the feed and voice mode.
  function firstSentence(t, max) { t = String(t || "").replace(/\s+/g, " ").trim(); var m = /^.*?[.!?](\s|$)/.exec(t); return (m ? m[0] : t).trim().slice(0, max || 220); }
  function uniq(a) { var seen = {}, o = []; a.forEach(function (x) { if (x && !seen[x]) { seen[x] = 1; o.push(x); } }); return o; }
  // The IST day "YYYY-MM-DD" of a time (the server's day for the board).
  function istDay(t) { return new Date(t + 5.5 * 3600e3).toISOString().slice(0, 10); }

  /* Voice answers: "B", "option b", "answer bee", "two", "the second", or most of an option's words. Commands: skip,
     repeat, stop. -> { k } | { cmd } | null.
     Letter words are split by risk. SAFE homophones (bee, cee, dee) may count in a short phrase or after a strong
     cue ("option", "answer", "letter", "choice"); RISKY ones are ordinary English words too, so they count only
     as the whole utterance (RISKY_WHOLE, plus every risky word) or after a strong cue (RISKY_CUE only). The bare
     article-like "a" and the word after "is" never count on their own: "it is a beta blocker" is the option's own
     words, not A. No Telugu/Hindi variants are added: none is attested from the recognisers, and a guessed word
     here costs a false answer. */
  var LET_SAFE = { ay: 0, aye: 0, eh: 0, ae: 0, hey: 0, bee: 1, bea: 1, bi: 1, cee: 2, si: 2, dee: 3, de: 3, di: 3, ee: 4 };
  var LET_RISKY_CUE = { a: 0, be: 1, to: 1, too: 1, see: 2, sea: 2, the: 3, for: 3 };
  var LET_RISKY_WHOLE = { eight: 0, pee: 1, p: 1, she: 2, t: 3, tee: 3 };
  var NUMW = { one: 0, first: 0, two: 1, second: 1, three: 2, third: 2, four: 3, fourth: 3, five: 4, fifth: 4 };
  var CUEW = { option: 1, answer: 1, letter: 1, choice: 1 };
  var SKIP_AFTER_CUE = { is: 1, its: 1, s: 1, would: 1, be: 1, number: 1 };
  var PHRASE_LEAD = { i: 1, ill: 1, ll: 1, im: 1, think: 1, thinks: 1, go: 1, going: 1, with: 1, definitely: 1, my: 1, would: 1, be: 1, it: 1, its: 1, s: 1, is: 1, choose: 1, pick: 1, say: 1, want: 1, the: 1, probably: 1, maybe: 1, just: 1, answer: 1 };
  var PARTIAL_MS = 500, SETTLE_MS = 1200;
  function words(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean); }
  // Joined cue forms ("optionb") become two tokens; brackets and stops already became spaces in words().
  function voiceTokens(text) {
    var out = [];
    words(text).forEach(function (t) { var m = /^option([a-f1-5])$/.exec(t); if (m) { out.push("option", m[1]); } else out.push(t); });
    return out;
  }
  function stripPlease(w) { var o = w.slice(); while (o.length && o[0] === "please") o.shift(); while (o.length && o[o.length - 1] === "please") o.pop(); return o; }
  // mode: "whole" (the utterance is just this), "cue" (right after a strong cue), "mid" (a short phrase).
  function letterOf(t, mode) {
    if (/^[a-f]$/.test(t)) return t.charCodeAt(0) - 97;
    if (LET_SAFE[t] != null) return LET_SAFE[t];
    if (mode === "whole" && LET_RISKY_WHOLE[t] != null) return LET_RISKY_WHOLE[t];
    if (mode !== "mid" && LET_RISKY_CUE[t] != null) return LET_RISKY_CUE[t];
    return null;
  }
  function numOf(t) { if (/^[1-6]$/.test(t)) return +t - 1; return NUMW[t] != null ? NUMW[t] : null; }
  function letterOrNum(t, mode) { var k = letterOf(t, mode); return k != null ? k : numOf(t); }
  function lev(a, b, cap) {
    var m = a.length, n = b.length, i, j, prev = [], cur = [];
    if (Math.abs(m - n) > cap) return cap + 1;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur[0] = i; var lo = cap + 1;
      for (j = 1; j <= n; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1)); if (cur[j] < lo) lo = cur[j]; }
      if (lo > cap) return cap + 1;
      var t = prev; prev = cur; cur = t;
    }
    return prev[n];
  }
  // Most of an option's own words (3+ letters): the best option over 60%, and only a clear winner. A recogniser
  // may split a drug name ("met forming"), so adjacent spoken words may join, and words of 5+ letters tolerate a
  // small edit distance. A tie between options is no answer. Exact words win first: near-identical medical
  // words (hypo/hyperkalemia, ileum/ilium) are within fuzzy distance of each other, so a fuzzy tie must never
  // erase an exact clear winner. Fuzzy is tried only when exact matching has no clear winner, and a fuzzy
  // result must still have a clear winner.
  function optionScores(w, options, fuzzy) {
    var scores = [];
    (options || []).forEach(function (o, k) {
      var ow = words(o).filter(function (x) { return x.length >= 3; }); if (!ow.length) { scores[k] = 0; return; }
      var hit = 0;
      ow.forEach(function (x) {
        if (w.indexOf(x) >= 0) { hit++; return; }
        var i;
        for (i = 0; i + 1 < w.length; i++) if (x === w[i] + w[i + 1]) { hit++; return; }
        if (!fuzzy || x.length < 5) return;
        var cap = x.length >= 8 ? 2 : 1;
        for (i = 0; i < w.length; i++) { if (lev(x, w[i], cap) <= cap || (i + 1 < w.length && lev(x, w[i] + w[i + 1], cap) <= cap)) { hit++; return; } }
      });
      scores[k] = hit / ow.length;
    });
    return scores;
  }
  function clearWinner(scores) {
    var best = -1, bs = 0, ss = 0;
    scores.forEach(function (sc, k) { if (sc > bs) { ss = bs; bs = sc; best = k; } else if (sc > ss) ss = sc; });
    return bs >= 0.6 && bs > ss ? best : null;
  }
  function matchOptionsExact(w, options) { return clearWinner(optionScores(w, options, false)); }
  function matchOptions(w, options) {
    var ex = matchOptionsExact(w, options);
    return ex != null ? ex : clearWinner(optionScores(w, options, true));
  }
  // A word in LET_RISKY_CUE that got its letter only from that risky table (not a bare b-f letter, not a safe
  // homophone): it is an ordinary English word too, so after a cue it counts only when nothing but a closing
  // phrase ("is correct", "is right") follows it.
  function riskyCueWord(t) { return LET_RISKY_CUE[t] != null && LET_SAFE[t] == null && !/^[b-f]$/.test(t); }
  function closingOnly(rest) {
    if (!rest.length) return true;
    if (rest.length === 1) return rest[0] === "correct" || rest[0] === "right";
    return rest.length === 2 && rest[0] === "is" && (rest[1] === "correct" || rest[1] === "right");
  }
  function parseVoice(text, options) {
    var n = (options || []).length || 4, w = voiceTokens(text);
    if (!w.length) return null;
    // A correction replaces everything before it: "B no wait C" is C. A trailing "wait" alone is no answer.
    var wi = w.lastIndexOf("wait");
    if (wi >= 0) return wi === w.length - 1 ? null : parseVoice(w.slice(wi + 1).join(" "), options);
    var c = stripPlease(w);
    if (!c.length) return null;
    // A negation never guesses an answer: "not A", "not metformin". The one exception is an option whose own
    // words contain "not" ("Not indicated") matched exactly: that option wins, the negation is its name.
    if (c.indexOf("not") >= 0) {
      var nk = matchOptionsExact(c, options);
      return nk != null && words((options || [])[nk]).indexOf("not") >= 0 ? { k: nk } : null;
    }
    // A strong cue, then the letter or number (filler between them is skipped: "answer is dee", "option number two").
    for (var i = 0; i < c.length; i++) {
      if (!CUEW[c[i]]) continue;
      var j = i + 1; while (j < c.length && SKIP_AFTER_CUE[c[j]]) j++;
      if (j >= c.length) {
        // Skipping ran out of words ("option be"): the last skipped word is the candidate.
        if (j > i + 1) { var ek = letterOrNum(c[c.length - 1], "cue"); if (ek != null && ek < n) return { k: ek }; }
        break;
      }
      // A risky word after a cue followed by more than a closing phrase is not a letter ("answer is the
      // liver" is the option Liver): fall through to the option's own words. Safe letters keep counting here.
      if (riskyCueWord(c[j]) && !closingOnly(c.slice(j + 1))) break;
      var ck = letterOrNum(c[j], "cue"); if (ck != null && ck < n) return { k: ck };
      break;
    }
    // The whole utterance is one letter (risky words count here), or one letter said twice ("A A", "B B").
    if (c.length === 1 || (c.length === 2 && c[0] === c[1])) { var wk = letterOrNum(c[0], "whole"); if (wk != null && wk < n) return { k: wk }; }
    // A natural short phrase ending in the answer: "I'll go with B", "I think C", "definitely A".
    if (c.length >= 2 && c.length <= 6) {
      var lk = letterOrNum(c[c.length - 1], "mid"), lead = lk != null;
      for (var li = 0; lk != null && li < c.length - 1; li++) if (!PHRASE_LEAD[c[li]] && !CUEW[c[li]]) lead = false;
      if (lead && lk < n) return { k: lk };
    }
    // The option's own words beat a command word inside them: "stop codon" is the option, not Stop.
    var om = matchOptions(c, options);
    if (om != null) return { k: om };
    // Two words at most: a safe homophone, a number or a B-F letter (never the article "a", never a risky word).
    if (c.length <= 2) {
      var seen = {}, cnt = 0;
      for (var s2 = 0; s2 < c.length; s2++) { var sk = /^[b-f]$/.test(c[s2]) ? letterOf(c[s2], "mid") : (LET_SAFE[c[s2]] != null ? LET_SAFE[c[s2]] : numOf(c[s2])); if (sk != null && sk < n && !seen[sk]) { seen[sk] = 1; cnt++; } }
      if (cnt === 1) return { k: +Object.keys(seen)[0] };
      if (cnt > 1) return null;
    }
    // A command must be a short utterance that is plainly a command.
    if (c.length <= 3) {
      if (c.indexOf("stop") >= 0) return { cmd: "stop" };
      if (c.indexOf("skip") >= 0 || c.indexOf("next") >= 0) return { cmd: "skip" };
      if (c.indexOf("repeat") >= 0 || c.indexOf("again") >= 0) return { cmd: "repeat" };
    }
    return null;
  }
  // A clear standalone letter answer: just the letter, the letter twice, or a strong cue plus the letter.
  function standaloneLetter(text, options) {
    var n = (options || []).length || 4, c = stripPlease(voiceTokens(text));
    if (!c.length) return null;
    if (c.length === 1 || (c.length === 2 && c[0] === c[1])) { var k = letterOf(c[0], "whole"); return k != null && k < n ? k : null; }
    if (c.length <= 3 && CUEW[c[0]]) {
      var j = 1; while (j < c.length && SKIP_AFTER_CUE[c[j]]) j++;
      if (j === c.length - 1) { var ck = letterOf(c[j], "cue"); return ck != null && ck < n ? ck : null; }
      // Skipping ran out of words ("option be"): the last skipped word is the candidate.
      if (j >= c.length && c.length > 1) { var ek = letterOf(c[c.length - 1], "cue"); return ek != null && ek < n ? ek : null; }
    }
    return null;
  }
  // The fast settle set: a true letter or a safe homophone as the whole utterance ("a", "bee", "dee", "B B").
  function fastLetter(text, options) {
    var n = (options || []).length || 4, c = stripPlease(voiceTokens(text));
    if (!c.length || c.length > 2 || (c.length === 2 && c[0] !== c[1])) return false;
    var t = c[0], k = /^[a-f]$/.test(t) ? t.charCodeAt(0) - 97 : (LET_SAFE[t] != null ? LET_SAFE[t] : null);
    return k != null && k < n;
  }
  /* A partial result commits only when the whole transcript has stayed unchanged: a bare letter or safe
     homophone for PARTIAL_MS, anything else that parses (a phrase, option words, a command, a risky word as
     the whole utterance) for SETTLE_MS. iOS sends no final on silence, so this settle is what answers there.
     The vote compares the whole normalised text, not only the parsed k: "a" followed by "a beta blocker"
     restarts the clock even though both parse to A, and a transcript that stops parsing clears the vote.
     Pure timeline: seen = { k, text, at, ms } | null, now in ms. */
  function partialVote(seen, text, options, now) {
    var p = parseVoice(text, options);
    if (!p) return { seen: null, commit: null };
    var norm = voiceTokens(text).join(" "), ms = fastLetter(text, options) ? PARTIAL_MS : SETTLE_MS;
    if (!seen || seen.text !== norm) return { seen: { k: p.k != null ? p.k : null, text: norm, at: now, ms: ms }, commit: null };
    return now - seen.at >= (seen.ms || ms) ? { seen: seen, commit: p } : { seen: seen, commit: null };
  }
  // Ranked recogniser alternatives: the first that gives a letter wins; else the first that parses at all.
  function pickAlternative(list, options) {
    if (!list || !list.length) return "";
    var cmd = "";
    for (var i = 0; i < list.length; i++) {
      var t = String(list[i] || ""), p = parseVoice(t, options);
      if (p && p.k != null) return t;
      if (p && !cmd) cmd = t;
    }
    return cmd || String(list[0] || "");
  }
  function choicePrompt(n) {
    n = Math.max(1, Math.min(L.length, n || 4));
    var ls = L.slice(0, n);
    return "say " + (ls.length === 1 ? ls[0] : ls.slice(0, -1).join(", ") + " or " + ls[ls.length - 1]);
  }
  // Which voice reads: Phonon when ready and fast enough, the system voice otherwise, "wait" while it loads.
  function voiceChoice(v) {
    if (!v || !v.available) return "system";
    if (v.state === "error") return "system";
    if (v.state === "ready") return v.usable ? "phonon" : "system";
    return "wait";
  }
  // No say() may hang the session: allow the spoken time plus rendering slack, by length.
  function sayWatchdogMs(text) { var ms = 6000 + String(text || "").length * 150; return ms > 60000 ? 60000 : ms; }
  // sayChunks may end a piece at "Option B."; keep the letter with its option text.
  function joinOptionChunks(chunks) {
    var out = [];
    (chunks || []).forEach(function (c) { if (out.length && /^option [a-f]\.?$/i.test(String(out[out.length - 1]).trim())) out[out.length - 1] += " " + c; else out.push(c); });
    return out;
  }

  /* Streak freezes, earned and never bought: one for every day with FREEZE_EXTRA answers beyond the daily goal, at most
     FREEZE_MAX banked. applyFreezes covers a gap of missed days right before today when the streak stood before it and
     the bank holds enough; it returns how many it used. specialty-core.js streak() treats used days as links. */
  function earnFreeze(s, td, goal) {
    var f = s.frz || (s.frz = { bank: 0, used: [], earned: null });
    if (f.earned === td || (s.days[td] || 0) < (goal || 30) + FREEZE_EXTRA || f.bank >= FREEZE_MAX) return false;
    f.bank++; f.earned = td; return true;
  }
  function applyFreezes(s, td) {
    var f = s.frz; if (!f || !f.bank) return 0;
    var used = f.used || (f.used = []), on = function (d) { return !!(s.days[d] || used.indexOf(d) >= 0); }, gap = [];
    for (var d = td - 1; !on(d) && gap.length <= f.bank; d--) gap.push(d);
    if (!gap.length || gap.length > f.bank || !on(td - 1 - gap.length)) return 0;
    gap.forEach(function (x) { used.push(x); });
    f.used = used.slice(-30); f.bank -= gap.length;
    return gap.length;
  }

  /* Boss battle questions: the hard ones (d 3, very hard) first, then medium, seeded per attempt; BOSS_N at most. */
  function bossPick(items, seed) {
    var hard = items.filter(function (x) { return x.vh === true || x.d >= 3; }), mid = items.filter(function (x) { return !(x.vh === true || x.d >= 3) && x.d === 2; });
    return shuffled(hard, seed).concat(shuffled(mid, seed + ":m")).slice(0, BOSS_N);
  }
  function livesLeft(r) { var w = 0; r.items.forEach(function (it, i) { if (r.ans[i] >= 0 && r.ans[i] !== it.a) w++; }); return BOSS_LIVES - w; }

  /* Study hour persona from hr[0..23]. */
  function persona(hr) {
    var b = { "Night owl": [22, 23, 0, 1, 2, 3], "Early bird": [4, 5, 6, 7, 8], "Day scholar": [9, 10, 11, 12, 13, 14, 15, 16], "Evening grinder": [17, 18, 19, 20, 21] };
    var best = null, n = 0, tot = 0;
    Object.keys(b).forEach(function (k) { var c = b[k].reduce(function (a, h) { return a + ((hr && hr[h]) || 0); }, 0); tot += c; if (c > n) { n = c; best = k; } });
    if (!best || tot < 20) return null;
    var peak = 0; for (var h = 1; h < 24; h++) if ((hr[h] || 0) > (hr[peak] || 0)) peak = h;
    return { name: best, share: Math.round(n * 100 / tot), peak: peak };
  }
  /* Wrapped for a month "YYYY-MM": counts from the store only. dayNum(ms) maps a time to the store's day numbers. */
  function wrapped(s, month, dayNum, subjectOfModule) {
    var y = +month.slice(0, 4), m = +month.slice(5, 7) - 1, d0 = dayNum(new Date(y, m, 1, 12).getTime()), d1 = dayNum(new Date(y, m + 1, 1, 12).getTime()) - 1;
    var n = 0, active = 0, run = 0, best = 0;
    for (var d = d0; d <= d1; d++) { var c = (s.days && s.days[d]) || 0; n += c; if (c) { active++; run++; if (run > best) best = run; } else run = 0; }
    var wm = (s.wm && s.wm[month]) || {}, top = null;
    Object.keys(wm).forEach(function (k) { if (!top || wm[k] > wm[top]) top = k; });
    var strong = null;
    var by = {}; Object.keys(s.mod || {}).forEach(function (mid) { var sid = subjectOfModule(mid), x = s.mod[mid]; if (!sid || !x || !x.t) return; var b = by[sid] || (by[sid] = { t: 0, ok: 0 }); b.t += x.t; b.ok += x.ok; });
    Object.keys(by).forEach(function (k) { if (by[k].t >= 20 && (!strong || by[k].ok / by[k].t > by[strong].ok / by[strong].t)) strong = k; });
    var spot = 0; Object.keys(s.spoth || {}).forEach(function (k) { if (k.slice(0, 7) === month && s.spoth[k]) spot++; });
    var bosses = 0; Object.keys(s.boss || {}).forEach(function (k) { if (s.boss[k].won && ym(s.boss[k].won) === month) bosses++; });
    return { month: month, n: n, active: active, days: d1 - d0 + 1, best: best, top: top, topN: top ? wm[top] : 0, strong: strong, strongPct: strong ? Math.round(by[strong].ok * 100 / by[strong].t) : 0,
      persona: persona(s.hr), spot: spot, bosses: bosses, focus: (s.fxm && s.fxm[month]) || 0 };
  }

  var PURE = { hashStr: hashStr, shuffled: shuffled, spotPick: spotPick, istDay: istDay, parseVoice: parseVoice, standaloneLetter: standaloneLetter, partialVote: partialVote, pickAlternative: pickAlternative, choicePrompt: choicePrompt, voiceChoice: voiceChoice, sayWatchdogMs: sayWatchdogMs, joinOptionChunks: joinOptionChunks, PARTIAL_MS: PARTIAL_MS, SETTLE_MS: SETTLE_MS, earnFreeze: earnFreeze, applyFreezes: applyFreezes,
    bossPick: bossPick, livesLeft: livesLeft, firstSentence: firstSentence, feedCards: feedCards, persona: persona, wrapped: wrapped, ym: ym, FREEZE_MAX: FREEZE_MAX, FREEZE_EXTRA: FREEZE_EXTRA, BOSS_N: BOSS_N, BOSS_LIVES: BOSS_LIVES };
  if (NODE) { module.exports = PURE; return; }

  /* ================= browser ================= */
  try { var qf = (G.location.search.match(/[?&]play=([^&]+)/) || [])[1]; if (qf === "0" || (qf == null && G.localStorage.getItem("smd_prep_play") === "0")) return; } catch (e) {}
  var D = G.document, H = null;
  var P = { sheet: null, prev: null, feed: null, spot: null, spotT: 0, focusT: 0, focusN: null, mn: {}, mnAsk: {}, voice: null, season: null, wrap: null, freezeDay: null, bossSid: null };
  var API = G.SMD_PREP_PLAY_API || "/api/prep/play/";
  function esc(s) { return H.esc(s); }
  function store() { return H.store(); }
  function ic(path, size) { return '<svg viewBox="0 0 24 24" width="' + (size || 20) + '" height="' + (size || 20) + '" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + path + "</svg>"; }
  var IC = { feed: '<rect x="6" y="3" width="12" height="18" rx="2"/><path d="M10 9l4 3-4 3z"/>', spot: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    boss: '<path d="M4 20h16M6 20l-1-11 4 3 3-6 3 6 4-3-1 11"/>', voice: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    focus: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/>', wrap: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 15l3-3 2 2 3-4"/>',
    season: '<path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/>', ice: '<path d="M12 2v20M4 6l16 12M20 6L4 18"/>', bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>' };
  function user() { try { var a = G.SMD_AUTH || (G.firebase && G.firebase.auth && G.firebase.auth()); return a && a.currentUser; } catch (e) { return null; } }
  function joinedHere() { try { return G.localStorage.getItem("smd_prep_arena_in") === "1"; } catch (e) { return false; } }
  function api(method, path, body) {
    var u = user();
    return Promise.resolve(u && u.getIdToken ? u.getIdToken() : null).then(function (tok) {
      if (!tok) { var e0 = new Error("signin"); e0.status = 401; throw e0; }
      var o = { method: method, headers: { Authorization: "Bearer " + tok }, cache: "no-store" };
      if (body) { o.headers["Content-Type"] = "application/json"; o.body = JSON.stringify(body); }
      return G.fetch(API + path, o);
    }).then(function (r) { return r.json().then(null, function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error((j && j.error) || "HTTP " + r.status); e.status = r.status; e.body = j; throw e; } return j; }); });
  }
  function onScreen(view) { if (H.stackTop() === view) H.rerender(); }
  function planSubs() { var s = H.planSubjects ? H.planSubjects() : []; return s && s.length ? s : H.subjectsOf(H.exam().id); }
  function subjName(sid) { var sb = H.subjectById(sid); return sb ? H.tx(sb.name) : sid; }
  function imgUrl(f) { var u = (H.bankApi || "/api/prep/bank/") + "img/maikimg/" + f; return u.charAt(0) === "/" && G.SMD_API_BASE ? G.SMD_API_BASE + u : u; }
  function proOk() { if (G.PrepPro && G.PrepPro.can && !G.PrepPro.can("questions", { items: [] })) { G.PrepPro.openLimit("questions"); return false; } return true; }

  // Questions from the plan's subjects: k random modules that have questions, their usable items, shuffled.
  function draw(k, seed) {
    var subs = planSubs(), ex = H.exam().id;
    return Promise.all(subs.map(function (sb) { return H.loadIndex(sb.id).then(function (ix) { return { sid: sb.id, ix: ix }; }, function () { return null; }); })).then(function (xs) {
      var mods = [];
      xs.forEach(function (x) { if (x && x.ix && x.ix.topics) x.ix.topics.forEach(function (t) { if (t.group !== "mixed" && H.countFor(t, ex) > 0) mods.push({ s: x.sid, m: t.id }); }); });
      mods = H.shuffle(mods).slice(0, k);
      return Promise.all(mods.map(function (x) { return H.loadModule(x.s, x.m).then(function (items) { return H.pool(H.poolFor(items, ex, null)); }, function () { return []; }); }));
    }).then(function (lists) { var all = []; lists.forEach(function (l) { all = all.concat(l); }); return H.shuffle(all); });
  }

  /* ---------- record hook ---------- */
  function noteAnswer(s, it, ok, td) {
    var h = new Date().getHours(), hr = s.hr || (s.hr = []);
    hr[h] = (hr[h] || 0) + 1;
    var m = ym(Date.now()), wm = s.wm || (s.wm = {}), row = wm[m] || (wm[m] = {}), sid = it._s;
    if (sid && sid !== "deck") row[sid] = (row[sid] || 0) + 1;
    Object.keys(wm).sort().slice(0, -13).forEach(function (k) { delete wm[k]; });
    if (earnFreeze(s, td, s.goal)) { try { H && H.toast("Streak freeze earned. " + s.frz.bank + " of " + FREEZE_MAX + " banked."); } catch (e) {} }
  }

  /* ---------- home ---------- */
  function homeHtml(h) {
    H = h;
    var s = store(), td = H.today();
    if (P.freezeDay !== td) { P.freezeDay = td; var used = applyFreezes(s, td); if (used) { H.save(); H.toast(used === 1 ? "A streak freeze kept your streak." : used + " streak freezes kept your streak."); } }
    var sp = s.spot && s.spot.day === istDay(Date.now()) ? s.spot : null, f = s.frz || { bank: 0 };
    var beaten = Object.keys(s.boss || {}).filter(function (k) { return s.boss[k].won; }).length;
    var arena = !!(G.PREP_ARENA && G.PREP_ARENA.enabled && G.PREP_ARENA.enabled());
    return '<h2 class="pn-h">Play</h2><div class="pn-group">' +
      H.row("v-feed", ic(IC.feed), "Swipe feed", "Questions, pearls and images, one swipe each") +
      H.row("v-spot", ic(IC.spot), "Spot diagnosis of the day", sp ? (sp.ok ? "Right in " + (sp.ms / 1000).toFixed(1) + " s today" : "Done for today") + " · see the board" : "One image, 10 seconds") +
      H.row("v-boss", ic(IC.boss), "Boss battles", (beaten ? beaten + " beaten · " : "") + BOSS_N + " hard questions, " + BOSS_LIVES + " lives") +
      H.row("v-quick", ic(IC.bolt), "Quick fire", "One question, right now") +
      H.row("v-voice", ic(IC.voice), "Voice mode", "Hear the question, say the answer") +
      H.row("v-focus", ic(IC.focus), "Focus room", focusOn() ? "In session: " + focusLeft() + " min left" : "A timed session with others studying now") +
      H.row("v-wrap", ic(IC.wrap), "Wrapped", "Your month in cards, ready to share") +
      (arena ? H.row("v-season", ic(IC.season), "Season", "8-week league, Bronze to Diamond") : "") +
      H.row("v-freeze", ic(IC.ice), "Streak freezes", f.bank + " of " + FREEZE_MAX + " banked · earn one with " + FREEZE_EXTRA + " extra questions in a day") + "</div>";
  }

  /* ---------- swipe feed ---------- */
  function feedCard(c, i) {
    if (c.kind === "pearl") return '<article class="vf-c vf-pearl" data-i="' + i + '"><p class="pn-eb">Remember</p><p class="vf-big">' + esc(c.text) + '</p><p class="pn-mut pn-small">' + esc(subjName(c.s)) + "</p></article>";
    if (c.kind === "img") return '<article class="vf-c vf-img" data-i="' + i + '"><figure><img src="' + esc(imgUrl(c.it.img)) + '" alt="' + esc(c.it.dx) + '" loading="lazy" decoding="async"></figure><p class="pn-eb">' + esc(c.it.modality || c.it.deck || "Image") + '</p><p class="vf-big">' + esc(c.it.dx) + "</p>" + (c.it.finding ? '<p class="vf-why">' + esc(c.it.finding) + "</p>" : "") + "</article>";
    var it = c.it;
    return '<article class="vf-c vf-q" data-i="' + i + '"><p class="pn-eb">' + esc(subjName(it._s)) + '</p><p class="vf-stem">' + esc(it.q) + '</p><ol class="vf-opts">' + it.o.map(function (o, k) {
      return '<li><button type="button" class="pn-opt" data-act="v-fa" data-i="' + i + '" data-k="' + k + '"><span class="pn-l">' + L[k] + "</span><span>" + esc(o) + "</span></button></li>";
    }).join("") + '</ol><p class="vf-why" hidden></p></article>';
  }
  // The feed's rhythm: after every 3rd question a pearl from a question already passed (never one still to come, which
  // would give its answer away), after every 5th an image card.
  function feedCards(items, imgs, pearlsSeen) {
    var out = [], pearls = [];
    items.forEach(function (it, i) {
      out.push({ kind: "q", it: it });
      if (it.kp && !pearlsSeen[it.id]) pearls.push(it);
      if (i % 3 === 2 && pearls.length) { var pe = pearls.shift(); pearlsSeen[pe.id] = 1; out.push({ kind: "pearl", text: pe.kp, s: pe._s }); }
      if (imgs.length && i % 5 === 4) out.push({ kind: "img", it: imgs[Math.floor(Math.random() * imgs.length)] });
    });
    return out;
  }
  function openFeed() {
    if (!proOk()) return;
    P.feed = { cards: [], seen: {}, imgs: [], loading: true, done: 0, right: 0 };
    H.push(renderFeed);
    Promise.all([draw(4, "feed"), spotPool()]).then(function (x) {
      var f = P.feed; if (!f) return;
      f.imgs = x[1] || []; f.cards = feedCards(x[0].slice(0, FEED_BATCH), f.imgs, f.seen); f.loading = false;
      onScreen(renderFeed);
    }, function () { if (P.feed) { P.feed.loading = false; P.feed.err = true; onScreen(renderFeed); } });
  }
  function renderFeed() {
    var f = P.feed;
    var body = !f || f.loading ? '<p class="pn-load" role="status">Building your feed…</p>' : f.err || !f.cards.length ? '<p class="pn-err" role="alert">The feed needs a connection the first time. Try again online.</p>' :
      '<div class="vf" id="pvFeed" tabindex="-1" aria-label="Swipe feed">' + f.cards.map(feedCard).join("") + '<article class="vf-c vf-end"><p class="vf-big">That is ' + f.cards.length + ' cards.</p><button type="button" class="pn-btn pri" data-act="v-more">Keep going</button></article></div>';
    H.paint(H.bar("Swipe feed", f && f.done ? f.right + " of " + f.done + " right" : "Swipe up for the next", "back") + '<div class="pn-body pv-feed">' + body + "</div>");
  }
  function feedAnswer(b) {
    var f = P.feed, i = Number(b.getAttribute("data-i")), k = Number(b.getAttribute("data-k")), c = f && f.cards[i];
    if (!c || c.kind !== "q" || c.ans != null) return;
    if (!proOk()) return;
    c.ans = k; f.done++; if (k === c.it.a) f.right++;
    H.record(c.it, k, { ms: 0 });
    var card = b.closest(".vf-c");
    [].forEach.call(card.querySelectorAll(".pn-opt"), function (o) {
      var kk = Number(o.getAttribute("data-k")); o.setAttribute("aria-disabled", "true");
      if (kk === c.it.a) o.classList.add("right"); else if (kk === k) o.classList.add("wrong");
    });
    var why = card.querySelector(".vf-why"), ex = firstSentence(c.it.exp || (c.it.x && c.it.x.key), 220);
    why.hidden = false; why.textContent = (k === c.it.a ? "Right. " : "The answer is " + L[c.it.a] + ". ") + ex;
    var sub = H.root().querySelector(".pn-bar .pn-t p"); if (sub) sub.textContent = f.right + " of " + f.done + " right";
  }
  function feedMore() {
    var f = P.feed; if (!f || f.loading) return;
    f.loading = true;
    draw(4, "feed" + Date.now()).then(function (items) {
      var box = H.root().querySelector("#pvFeed"), start = f.cards.length, more = feedCards(items.slice(0, FEED_BATCH), f.imgs, f.seen);
      f.cards = f.cards.concat(more); f.loading = false;
      if (!box) return onScreen(renderFeed);
      var end = box.querySelector(".vf-end");
      end.insertAdjacentHTML("beforebegin", more.map(function (c, j) { return feedCard(c, start + j); }).join(""));
      end.querySelector(".vf-big").textContent = "That is " + f.cards.length + " cards.";
      var next = box.querySelectorAll(".vf-c")[start]; if (next) next.scrollIntoView({ behavior: "smooth", block: "start" });
    }, function () { f.loading = false; H.toast("More cards need a connection."); });
  }

  /* ---------- spot diagnosis ---------- */
  var SPOT_POOL = null;
  function spotPool() {
    if (SPOT_POOL) return Promise.resolve(SPOT_POOL);
    var base = (H.staticBase || "/prep/").replace(/bank\/?$/, "");
    var get = function (f) { return H.getJSON(base + "imglearn/" + f).then(function (m) { return ((m && m.items) || []).filter(function (x) { return x.img && x.dx; }).map(function (x) { var y = {}, k; for (k in x) y[k] = x[k]; y.set = m.set || f; return y; }); }, function () { return []; }); };
    return Promise.all([get("eye.json"), get("psm.json")]).then(function (x) { return (SPOT_POOL = x[0].concat(x[1])); });
  }
  function openSpot() {
    var day = istDay(Date.now()), s = store();
    P.spot = { day: day, pick: null, t0: 0, ans: null, ms: 0, board: null, done: !!(s.spot && s.spot.day === day) };
    H.push(renderSpot);
    spotPool().then(function (pool) { if (!P.spot) return; P.spot.pick = spotPick(pool, day); P.spot.empty = !P.spot.pick; onScreen(renderSpot); if (P.spot.done) loadBoard(); });
  }
  function renderSpot() {
    var x = P.spot, s = store(); if (!x) return;
    var body;
    if (!x.pick) body = x.empty ? '<p class="pn-err" role="alert">The image set did not load. Try again online.</p>' : '<p class="pn-load" role="status">Loading today\'s image…</p>';
    else if (!x.t0 && !x.done) body = '<section class="pn-panel pv-spot-intro"><p class="vf-big">One image. Four diagnoses. 10 seconds.</p><p class="pn-mut">Everyone gets the same image today. The fastest right answers top the board.</p><button type="button" class="pn-btn pri" data-act="v-spotgo">' + H.ico("play") + " Start</button></section>";
    else {
      var it = x.pick.item, shown = x.ans != null || x.done, mine = x.done && s.spot ? s.spot : null;
      body = '<figure class="pv-spot-fig"><img src="' + esc(imgUrl(it.img)) + '" alt="Today\'s image' + (shown ? ": " + esc(it.dx) : "") + '"></figure>' +
        (shown ? "" : '<div class="pv-tbar" aria-hidden="true"><i style="animation-duration:' + SPOT_MS + 'ms"></i></div>') +
        '<ol class="pn-opts">' + x.pick.o.map(function (o, k) {
          var cls = "pn-opt" + (shown ? (k === x.pick.a ? " right" : k === x.ans ? " wrong" : "") : "");
          return '<li><button type="button" class="' + cls + '" data-act="v-spota" data-k="' + k + '"' + (shown ? ' aria-disabled="true"' : "") + '><span class="pn-l">' + L[k] + "</span><span>" + esc(o) + "</span></button></li>";
        }).join("") + "</ol>" +
        (shown ? '<section class="pn-fb ' + ((mine ? mine.ok : x.ans === x.pick.a) ? "ok" : "no") + '" role="status"><p class="pn-verdict"><b>' + ((mine ? mine.ok : x.ans === x.pick.a) ? "Right" + (mine ? " in " + (mine.ms / 1000).toFixed(1) + " s" : "") : x.ans === -1 ? "Time up" : "Not this time") + "</b></p>" +
          "<p><b>" + esc(it.dx) + "</b></p>" + (it.finding ? "<p>" + esc(it.finding) + "</p>" : "") + (it.reason ? '<p class="pn-mut">' + esc(it.reason) + "</p>" : "") +
          (it.credit ? '<p class="pn-mut pn-small">Image: ' + esc(it.credit) + (it.licence ? " · " + esc(it.licence) : "") + "</p>" : "") + "</section>" + boardHtml() : "");
    }
    H.paint(H.bar("Spot diagnosis", esc(x.day), "back") + '<div class="pn-body pv-spot">' + body + "</div>");
  }
  function boardHtml() {
    var x = P.spot;
    if (!user() || !joinedHere()) return '<p class="pn-mut pn-small">Join the Arena (Compete on home) to see today\'s board.</p>';
    if (!x.board) return '<p class="pn-load" role="status">Loading today\'s board…</p>';
    if (x.board.err) return '<p class="pn-mut pn-small">' + esc(x.board.err) + "</p>";
    var b = x.board;
    return '<h2 class="pn-sec">Today\'s board</h2>' + (b.rows.length ? '<ol class="pv-board">' + b.rows.map(function (r) { return '<li class="' + (r.me ? "me" : "") + '"><span>' + r.rank + "</span><b>" + esc(r.name) + "</b><span>" + (r.ms / 1000).toFixed(1) + " s</span></li>"; }).join("") + "</ol>" : '<p class="pn-mut">No right answers yet today.</p>') +
      '<p class="pn-mut pn-small">' + b.n + (b.n === 1 ? " doctor has" : " doctors have") + " played today." + (b.me && b.me.rank ? " You are " + b.me.rank + "." : "") + "</p>";
  }
  function loadBoard(post) {
    var x = P.spot; if (!x || !user() || !joinedHere()) return;
    (post ? api("POST", "spot", post) : api("GET", "spot")).then(function (j) { if (P.spot === x) { x.board = j; onScreen(renderSpot); } }, function (e) {
      if (e && e.status === 409) return loadBoard();
      if (P.spot === x) { x.board = { err: e && e.status === 403 ? "Join the Arena to see today's board." : "The board needs a connection." }; onScreen(renderSpot); }
    });
  }
  function spotGo() {
    var x = P.spot; if (!x || !x.pick || x.t0) return;
    x.t0 = Date.now(); H.rerender();
    G.clearTimeout(P.spotT);
    P.spotT = G.setTimeout(function () { if (P.spot === x && x.ans == null) spotAnswer(-1); }, SPOT_MS);
  }
  function spotAnswer(k) {
    var x = P.spot; if (!x || !x.t0 || x.ans != null || x.done) return;
    G.clearTimeout(P.spotT);
    x.ans = k; x.ms = Math.min(SPOT_MS, Date.now() - x.t0);
    var ok = k === x.pick.a, s = store();
    s.spot = { day: x.day, ok: ok, ms: x.ms }; (s.spoth || (s.spoth = {}))[x.day] = ok ? 1 : 0; H.save();
    x.done = true; H.rerender();
    loadBoard({ day: x.day, ok: ok, ms: x.ms });
  }

  /* ---------- boss battles ---------- */
  function renderBossList() {
    var s = store(), subs = planSubs();
    H.paint(H.bar("Boss battles", BOSS_N + " hard questions, " + BOSS_LIVES + " lives", "back") + '<div class="pn-body pv-boss">' +
      '<p class="pn-mut">Each subject has a boss. Three wrong answers and it beats you. Get through all ' + BOSS_N + " and it is yours.</p>" +
      '<div class="pn-group">' + subs.map(function (sb) {
        var b = (s.boss || {})[sb.id] || {};
        return H.row("v-bossgo", H.subjIco ? H.subjIco(sb.id) : ic(IC.boss), esc(H.tx(sb.name)) + " boss", b.won ? "Beaten " + esc(new Date(b.won).toLocaleDateString("en-IN", { day: "numeric", month: "short" })) + (b.best != null ? " · best " + b.best + "/" + BOSS_N : "") : b.tries ? b.tries + (b.tries === 1 ? " try" : " tries") + " · best " + (b.best || 0) + "/" + BOSS_N : "Not fought yet", ' data-v="' + esc(sb.id) + '"');
      }).join("") + "</div></div>");
  }
  function startBoss(sid) {
    if (!proOk()) return;
    H.loadingScreen(subjName(sid) + " boss", "Summoning the boss…");
    var ex = H.exam().id;
    H.loadIndex(sid).then(function (ix) {
      var mods = H.shuffle(((ix && ix.topics) || []).filter(function (t) { return t.group !== "mixed" && H.countFor(t, ex) > 0; })).slice(0, 10);
      return Promise.all(mods.map(function (t) { return H.loadModule(sid, t.id).then(function (items) { return H.pool(H.poolFor(items, ex, null)); }, function () { return []; }); }));
    }).then(function (lists) {
      var all = []; lists.forEach(function (l) { all = all.concat(l); });
      var items = bossPick(all, sid + ":" + Date.now());
      if (items.length < 10) { H.toast("Not enough hard questions here yet. Try another subject."); return H.rerender(); }
      var title = subjName(sid) + " boss";
      H.run(items, "study", title + " · " + BOSS_LIVES + " lives", { custom: { submit: bossDone, render: bossResult }, onAnswer: function (r) {
        var left = livesLeft(r);
        r.title = title + " · " + Math.max(0, left) + (left === 1 ? " life" : " lives");
        if (left <= 0) { r.bossLost = true; H.finish(); }
      }, sid: sid });
      var r = H.run_(); if (r) r.bossSid = sid;
    }, function () { H.toast("The boss needs a connection the first time."); H.rerender(); });
  }
  function bossDone(r) {
    var s = store(), sid = r.bossSid, b = (s.boss || (s.boss = {}))[sid] || (s.boss[sid] = { tries: 0 });
    var right = r.items.filter(function (it, i) { return r.ans[i] === it.a; }).length, answered = r.ans.filter(function (x) { return x >= 0; }).length;
    r.bossWon = !r.bossLost && answered === r.items.length;
    b.tries = (b.tries || 0) + 1; b.best = Math.max(b.best || 0, right); if (r.bossWon && !b.won) b.won = Date.now();
    r.bossRight = right; H.save();
    bossResult(r);
  }
  function bossResult(r) {
    var won = r.bossWon, sid = r.bossSid;
    H.paint(H.bar(esc(subjName(sid)) + " boss", "", "back") + '<div class="pn-body"><section class="pn-panel pn-score pv-boss-end ' + (won ? "won" : "lost") + '"' + (won ? ' data-cele="balloons" data-big="1"' : "") + ">" +
      '<p class="pn-big">' + (won ? "Boss beaten" : "The boss won") + "</p><p>" + r.bossRight + " of " + r.items.length + " right" + (won ? ", " + livesLeft(r) + (livesLeft(r) === 1 ? " life" : " lives") + " to spare." : ". Three wrong ends the fight.") + "</p></section>" +
      '<div class="pn-navrow"><button type="button" class="pn-btn" data-act="back">Done</button><button type="button" class="pn-btn pri" data-act="v-bossgo" data-v="' + esc(sid) + '">' + (won ? "Fight again" : "Try again") + "</button></div></div>");
  }

  /* ---------- quick fire ---------- */
  function quick() {
    if (!proOk()) return;
    H.loadingScreen("Quick fire", "Finding one question…");
    draw(2, "quick" + Date.now()).then(function (items) {
      var s = store(), td = H.today(), C = H.core && H.core();
      // Prefer one already due for review; else any.
      var due = items.filter(function (it) { var c = s.cards["p:" + (it._m || it.t) + ":" + it.id]; return c && c[3] <= td; });
      var it = (due.length ? due : items)[0];
      if (!it) { H.toast("Quick fire needs a connection the first time."); return H.rerender(); }
      H.run([it], "study", "Quick fire");
    }, function () { H.toast("Quick fire needs a connection the first time."); H.rerender(); });
  }

  /* ---------- voice mode ----------
     All speech goes through the lessons' natural voice (window.PREP_VOICE, Phonon 31M) when it can run on this
     phone, with the system voice as the fallback from the first word when it cannot, and for any single sentence
     it fails on. Text is shaped by the lessons' own sayText/sayChunks and the system voice is chosen by their
     bestVoice (prep-lessons.js PURE, loaded before this file), so Voice mode sounds like a lesson. */
  function tts() { try { var C = G.Capacitor; return C && C.isNativePlatform && C.isNativePlatform() && C.Plugins && C.Plugins.TextToSpeech || null; } catch (e) { return null; } }
  function phonon() { try { return G.PREP_VOICE || null; } catch (e) { return null; } }
  function phononOk() { var V = phonon(); try { return !!(V && V.available && V.available()); } catch (e) { return false; } }
  function canSpeak() { return !!(phononOk() || tts() || (G.speechSynthesis && G.SpeechSynthesisUtterance)); }
  // On-device speech: the native SpeechRecognition plugin through SMD_NATIVE.transcribe (it throws without the plugin),
  // else the Web Speech recognizer where the WebView has one.
  function nativeListen() { try { var C = G.Capacitor; return !!(G.SMD_NATIVE && G.SMD_NATIVE.transcribe && C && C.Plugins && C.Plugins.SpeechRecognition); } catch (e) { return false; } }
  function canListen() { return !!(nativeListen() || G.SpeechRecognition || G.webkitSpeechRecognition); }
  function lessonPure() { try { return (G.PREP_LESSONS && G.PREP_LESSONS._pure) || null; } catch (e) { return null; } }
  function sayChunksOf(text) { var P = lessonPure(); try { if (P && P.sayChunks) return P.sayChunks(text); } catch (e) {} return text ? [String(text)] : []; }
  function bestVoiceOf(voices) { var P = lessonPure(); try { if (P && P.bestVoice) return P.bestVoice(voices); } catch (e) {} return -1; }
  var sysIx = null;
  function sysVoiceIx(T) {
    if (sysIx !== null) return Promise.resolve(sysIx);
    if (!T.getSupportedVoices) { sysIx = -1; return Promise.resolve(-1); }
    return T.getSupportedVoices().then(function (r) { sysIx = bestVoiceOf(r && r.voices); return sysIx; }, function () { sysIx = -1; return -1; });
  }
  function webVoicePick() { try { var vs = G.speechSynthesis.getVoices ? G.speechSynthesis.getVoices() : [], i = bestVoiceOf(vs); return i >= 0 ? vs[i] : null; } catch (e) { return null; } }
  function hush() {
    try { var V = phonon(); if (V && V.stop) V.stop(); } catch (e) {}
    try { var T = tts(); if (T && T.stop) T.stop().catch(function () {}); else if (G.speechSynthesis) G.speechSynthesis.cancel(); } catch (e) {}
  }
  /* Like the lessons' naturalStart: a voice saved before loads quietly; a first download shows its progress in
     Voice mode's own card and reading waits for it. Resolves true when Phonon will read. Leaving meanwhile
     (P.voice no longer V) resolves false and nothing is spoken afterwards. */
  function prepareVoice(V) {
    var PV = phonon();
    var snap = PV ? { available: phononOk(), state: PV.state ? PV.state() : "", usable: !!(PV.usable && PV.usable()) } : { available: false, state: "", usable: false };
    var choice = voiceChoice(snap);
    if (choice === "system") { V.usePhonon = false; return Promise.resolve(false); }
    if (choice === "phonon") { V.usePhonon = true; return Promise.resolve(true); }
    var show = !(PV.saved && PV.saved());
    if (show) V.dl = PV.progress ? PV.progress() : 0;
    return PV.download(show ? function (p) { if (P.voice === V) { V.dl = p; voiceDlPaint(); } } : null).then(function () {
      V.dl = null; voiceDlPaint();
      V.usePhonon = !!(PV.usable && PV.usable());
      return V.usePhonon;
    }, function () { V.dl = null; voiceDlPaint(); V.usePhonon = false; return false; });
  }
  function voiceDlHtml() {
    var V = P.voice;
    if (!V || V.dl == null) return "";
    var pc = Math.round(V.dl * 100);
    return '<div class="pn-vdl pv-vdl" role="status" aria-live="polite"><div class="pn-vdl-row"><span class="pn-vdl-t"><b>Getting the natural voice</b><small>One time, 65 MB. Reading starts when it is ready.</small></span><span class="pn-vdl-pc">' + pc + '%</span></div><div class="pn-vdl-track"><i style="width:' + pc + '%"></i></div></div>';
  }
  function voiceDlPaint() {
    var r = H && H.root && H.root(), el = r && r.querySelector("#pvVoiceDl");
    if (!el) return;
    var V = P.voice;
    if (!V || V.dl == null) { el.innerHTML = ""; return; }
    if (!el.firstChild) { el.innerHTML = voiceDlHtml(); return; }
    var pc = Math.round(V.dl * 100), f = el.querySelector(".pn-vdl-track i"), t = el.querySelector(".pn-vdl-pc");
    if (f) f.style.width = pc + "%";
    if (t) t.textContent = pc + "%";
  }
  // One sentence on the system voice (the lessons' bestVoice choice); done runs on end, on error or on watchdog.
  // alive, when given, is checked again right before speaking: sysVoiceIx resolves async, and a session
  // stopped meanwhile must never start a sentence.
  function systemSay(part, done, alive) {
    var settled = false, wd = G.setTimeout(fin, sayWatchdogMs(part) + 4000);
    function fin() { if (settled) return; settled = true; G.clearTimeout(wd); done(); }
    try {
      var T = tts();
      if (T) { sysVoiceIx(T).then(function (vi) { if (alive && !alive()) { fin(); return; } var o = { text: part, lang: "en-IN", rate: 1, pitch: 1, volume: 1, category: "playback" }; if (vi >= 0) o.voice = vi; return T.speak(o); }).then(fin, fin); return; }
      if (G.speechSynthesis && G.SpeechSynthesisUtterance) {
        if (alive && !alive()) { fin(); return; }
        var u = new G.SpeechSynthesisUtterance(part), wv = webVoicePick();
        u.lang = "en-IN"; if (wv) { u.voice = wv; u.lang = wv.lang || u.lang; }
        u.onend = fin; u.onerror = fin;
        G.speechSynthesis.speak(u); return;
      }
    } catch (e) {}
    G.setTimeout(fin, 50);
  }
  /* Speak a text (or a list of segments, so "Option B." stays with its option) a chunk at a time through Phonon,
     the next chunk rendered ahead; a chunk Phonon fails on, or one that overruns its watchdog, is read by the
     system voice and reading carries on. done fires only while this speak is still the session's current one. */
  function speak(text, done) {
    var V = P.voice; if (!V) return;
    var tok = ++V.tok, fin = function () { if (P.voice === V && tok === V.tok) done(); };
    hush();
    var segs = Object.prototype.toString.call(text) === "[object Array]" ? text : [text], chunks = [];
    segs.forEach(function (s) { sayChunksOf(s).forEach(function (c) { chunks.push(c); }); });
    chunks = joinOptionChunks(chunks);
    if (!chunks.length) { G.setTimeout(fin, 30); return; }
    var idx = 0;
    function next() {
      if (P.voice !== V || tok !== V.tok) return;
      if (idx >= chunks.length) { fin(); return; }
      var part = chunks[idx++], settled = false, routed = false;
      function after() { if (settled) return; settled = true; G.setTimeout(next, idx >= chunks.length ? 0 : 120); }
      function sys() { if (routed) return; routed = true; systemSay(part, after, function () { return P.voice === V && tok === V.tok; }); }
      var PV = phonon();
      if (!V.usePhonon || !PV || !(PV.usable && PV.usable())) { sys(); return; }
      try { if (V.afterMic) { V.afterMic = false; PV.unlock(); } } catch (e) {}   // the mic session may have quieted <audio>; re-prime it
      try { if (chunks[idx]) PV.prefetch(chunks[idx]); } catch (e) {}
      var wd = G.setTimeout(function () { try { PV.stop(); } catch (e) {} sys(); }, sayWatchdogMs(part));
      function ok() { if (routed) return; routed = true; G.clearTimeout(wd); after(); }
      function bad() { G.clearTimeout(wd); sys(); }
      try { PV.say(part, 1).then(ok, bad); } catch (e) { bad(); }
    }
    if (V.usePhonon == null && V.readyP) V.readyP.then(function (ok) { if (P.voice !== V || tok !== V.tok) return; if (V.usePhonon == null) V.usePhonon = !!ok; next(); });
    else next();
  }
  function stopListen(V) { G.clearTimeout(V.lt); G.clearTimeout(V.gt); G.clearTimeout(V.pt); if (V.stopL) { try { V.stopL(); } catch (e) {} V.stopL = null; } }
  function listen(done) {
    var V = P.voice; if (!V) return;
    var got = false, fin = function (t) { if (got) return; got = true; stopListen(V); V.afterMic = true; if (P.voice === V) done(String(t || "")); };
    function hint(t) { var el = H.root().querySelector("#pvVoiceT"); if (el && t) el.textContent = "Listening… \u201C" + String(t).slice(0, 60) + "\u201D"; }
    // A partial commits only from its top-ranked text, never from a lower-ranked alternative, and only once
    // the whole transcript has settled (partialVote). The V.pt timer fires the commit with no further
    // partial arriving, which is the only answer path on iPhone, where silence sends no final.
    function partial(t) {
      if (got || !t) return;
      V.heard = t; V.heardAt = Date.now(); hint(t);
      var vote = partialVote(V.seen, t, V.opts, Date.now());
      V.seen = vote.seen;
      G.clearTimeout(V.pt);
      if (vote.commit) { fin(t); return; }
      if (vote.seen) armSettle((vote.seen.ms || PARTIAL_MS) + 30);
    }
    function armSettle(ms) {
      G.clearTimeout(V.pt);
      V.pt = G.setTimeout(function () {
        if (got || P.voice !== V) return;
        var v2 = partialVote(V.seen, V.heard, V.opts, Date.now());
        V.seen = v2.seen;
        if (v2.commit) { fin(V.heard); return; }
        if (v2.seen) armSettle(Math.max(10, (v2.seen.at + (v2.seen.ms || PARTIAL_MS)) - Date.now()));
      }, ms);
    }
    try {
      if (nativeListen()) {
        V.stopL = G.SMD_NATIVE.transcribe({ language: "en-IN", onDevice: "prefer",
          onPartial: function (t) { partial(t); },
          onMatches: function (ms) { if (ms && ms.length) partial(String(ms[0])); },
          // Only this final event's own text: alternatives from an earlier partial are stale and once
          // resurrected the wrong answer ("a kidney problem I think" + a stale "a" recorded A).
          onFinal: function (t) { fin(t); },
          onError: function () { fin(""); } });
      } else {
        var SR = G.SpeechRecognition || G.webkitSpeechRecognition, rec = new SR();
        rec.lang = "en-IN"; rec.interimResults = true; rec.maxAlternatives = 3;
        rec.onresult = function (e) {
          var res = e.results[e.results.length - 1], alts = [];
          for (var i = 0; i < res.length; i++) alts.push(res[i].transcript);
          if (res.isFinal === false) partial(alts[0]); else fin(pickAlternative(alts, V.opts));
        };
        rec.onerror = function () { fin(""); }; rec.onend = function () { fin(V.heard || ""); };
        V.stopL = function () { try { rec.stop(); } catch (e) {} };
        rec.start();
      }
    } catch (e) { return fin(""); }
    // About 10 s to think; a word still arriving at the limit buys a little more rather than being cut off.
    V.lt = G.setTimeout(function check() {
      if (got) return;
      if (V.heard && Date.now() - (V.heardAt || 0) < 1000 && !V.extended) { V.extended = true; V.lt = G.setTimeout(check, 2000); return; }
      fin(V.heard || "");
    }, 10000);
  }
  function startVoice() {
    // Synchronous inside the row's tap (prep.js forwards the click straight here): iOS only unlocks audio in the gesture.
    var PV0 = phonon();
    if (PV0 && PV0.available && PV0.available()) { try { PV0.unlock(); } catch (e) {} }
    if (!canSpeak()) return H.toast("Voice mode needs speech on this phone.");
    if (!proOk()) return;
    if (P.voice) stopVoice();
    var V = P.voice = { tok: 0, step: {}, listen: canListen(), heard: "", heardAt: 0, opts: [], dl: null, usePhonon: null, readyP: null };
    V.readyP = prepareVoice(V);
    H.loadingScreen("Voice mode", "Picking 10 questions…");
    draw(3, "voice" + Date.now()).then(function (items) {
      if (P.voice !== V) return;   // left while loading or downloading: nothing starts
      items = items.slice(0, 10);
      if (!items.length) { stopVoice(); H.toast("Voice mode needs a connection the first time."); return H.rerender(); }
      H.run(items, "study", "Voice mode", { onRender: voiceStep });
      if (!V.listen) H.toast("Listening is not available here: tap your answer after each question.");
    }, function () { if (P.voice !== V) return; stopVoice(); H.toast("Voice mode needs a connection the first time."); H.rerender(); });
  }
  function stopVoice() {
    var V = P.voice; if (!V) return;
    P.voice = null;
    stopListen(V);
    hush();
    try { var PV = phonon(); if (PV && PV.release) PV.release(); } catch (e) {}   // as the lessons do on leaving
  }
  function voiceStep(r) {
    var V = P.voice; if (!V) return;
    if (!V.r) V.r = r;   // the first paint happens inside H.run, before startVoice can note the run
    if (V.r !== r) return;
    if (r.done) return stopVoice();
    var i = r.i, it = r.items[i], st = V.step[i] || (V.step[i] = { asked: false, told: false });
    var bar = H.root().querySelector(".pn-bar"), chip = H.root().querySelector("#pvVoice");
    if (bar && !chip) bar.insertAdjacentHTML("afterend", '<div class="pv-voicebar" id="pvVoice" role="status"><span>' + ic(IC.voice, 18) + ' <span id="pvVoiceT">Voice mode</span></span><button type="button" class="pn-link" data-act="v-voicestop">Stop voice</button></div><div id="pvVoiceDl"></div>');
    voiceDlPaint();
    var say = function (t) { var el = H.root().querySelector("#pvVoiceT"); if (el) el.textContent = t; };
    // The mic opens only once playback has fully ended, with a short gap so the voice's own tail is not heard.
    function doListen() {
      if (P.voice !== V || V.r !== r || r.i !== i || r.ans[i] >= 0) return;
      say("Listening… " + choicePrompt(it.o.length));
      V.heard = ""; V.seen = null; V.extended = false;
      V.gt = G.setTimeout(function () {
        if (P.voice !== V || V.r !== r || r.i !== i || r.ans[i] >= 0) return;
        listen(function (t) {
          if (P.voice !== V || V.r !== r || r.i !== i || r.ans[i] >= 0) return;
          var p = parseVoice(t, it.o);
          if (p && p.cmd === "stop") { stopVoice(); var c = H.root().querySelector("#pvVoice"); if (c) c.remove(); var d = H.root().querySelector("#pvVoiceDl"); if (d) d.remove(); return; }
          if (p && p.cmd === "repeat") { st.asked = false; return voiceStep(r); }
          if (p && p.cmd === "skip") { var nx = H.root().querySelector("[data-act=next]"); r.ans[i] = -2; return nx ? nx.click() : H.finish(); }
          if (!p) {
            // Two misses on a question: stop asking and wait for a tap (no endless "sorry" loop). A first miss
            // only repeats the short prompt and listens again; "repeat" is what re-reads the whole question.
            st.miss = (st.miss || 0) + 1;
            if (st.miss >= 2) return say("Tap your answer");
            say("Did not catch that. Say it again");
            return speak("Sorry, " + choicePrompt(it.o.length) + ".", function () { doListen(); });
          }
          var b = H.root().querySelector('.pn-opt[data-k="' + p.k + '"]'); if (b) b.click();
        });
      }, 250);
    }
    if (r.ans[i] < 0 && !st.asked) {
      st.asked = true; V.opts = it.o;
      say("Reading the question");
      speak([it.q + "."].concat(it.o.map(function (o, k) { return "Option " + L[k] + ". " + o + "."; })), function () {
        if (!V.listen || r.ans[i] >= 0) return say("Tap your answer");
        doListen();
      });
    } else if (r.ans[i] >= 0 && !st.told) {
      st.told = true;
      stopListen(V);
      var ok = r.ans[i] === it.a, why = firstSentence(it.exp || (it.x && it.x.key), 240);
      say(ok ? "Right" : "The answer is " + L[it.a]);
      speak([(ok ? "Right. " : "Not quite. The answer is " + L[it.a] + ", " + it.o[it.a] + ". "), why], function () {
        if (P.voice !== V || r.i !== i) return;
        var nx = H.root().querySelector("[data-act=next]"); if (nx) nx.click();
      });
    }
  }
  // Backgrounding must never leave audio or the mic running, nor fire a stale callback afterwards.
  if (G.document && G.document.addEventListener) G.document.addEventListener("visibilitychange", function () {
    if (G.document.visibilityState !== "hidden" || !P.voice) return;
    var V = P.voice; V.tok++;
    stopListen(V);
    hush();
    // Nothing resumes while hidden, so do not leave a stale "Listening…" behind: the tap path is live.
    try { var el = H && H.root && H.root().querySelector("#pvVoiceT"); if (el) el.textContent = "Tap your answer"; } catch (e) {}
  });

  /* ---------- focus room ---------- */
  var FKEY = "smd_prep_focus";
  function focusState() { try { return JSON.parse(G.localStorage.getItem(FKEY) || "null"); } catch (e) { return null; } }
  function focusOn() { var f = focusState(); return !!(f && f.end > Date.now()); }
  function focusLeft() { var f = focusState(); return f ? Math.max(0, Math.ceil((f.end - Date.now()) / 60e3)) : 0; }
  function beat(on) { if (!user()) return; api("POST", "focus", { on: !!on }).then(function (j) { P.focusN = j.now; onScreen(renderFocus); }, function () {}); }
  function focusTick() {
    var f = focusState();
    if (!f) { G.clearInterval(P.focusT); P.focusT = 0; return; }
    if (f.end <= Date.now()) return endFocus(true);
    beat(true);
    var el = H && H.root() && H.root().querySelector("#pvFocusLeft"); if (el) el.textContent = focusLeft() + " min";
  }
  function startFocus(min) {
    try { G.localStorage.setItem(FKEY, JSON.stringify({ start: Date.now(), end: Date.now() + min * 60e3, min: min })); } catch (e) {}
    beat(true); G.clearInterval(P.focusT); P.focusT = G.setInterval(focusTick, 60e3);
    H.rerender();
  }
  function endFocus(done) {
    var f = focusState(); try { G.localStorage.removeItem(FKEY); } catch (e) {}
    G.clearInterval(P.focusT); P.focusT = 0; beat(false);
    if (f) {
      var mins = Math.round((Math.min(Date.now(), f.end) - f.start) / 60e3);
      if (mins < 1) H.toast("Session ended.");
      else { var s = store(), m = ym(Date.now()), x = s.fxm || (s.fxm = {}); x[m] = (x[m] || 0) + mins; H.save(); H.toast(done ? "Session done: " + mins + " focused minutes." : mins + " focused minutes saved."); }
    }
    if (H.stackTop() === renderFocus) H.rerender();
  }
  function renderFocus() {
    var on = focusOn(), s = store(), mins = (s.fxm && s.fxm[ym(Date.now())]) || 0;
    if (P.focusN == null && user()) api("GET", "focus").then(function (j) { P.focusN = j.now; onScreen(renderFocus); }, function () { P.focusN = -1; });
    var live = P.focusN > 0 ? '<p class="pv-live"><b>' + H.fmt(P.focusN) + "</b> " + (P.focusN === 1 ? "doctor is" : "doctors are") + " in a focus session now</p>" : "";
    H.paint(H.bar("Focus room", mins ? mins + " focused minutes this month" : "", "back") + '<div class="pn-body pv-focus">' +
      (on ? '<section class="pn-panel pv-fnow"><p class="pn-eb">In session</p><p class="pv-fbig" id="pvFocusLeft">' + focusLeft() + " min</p>" + live +
        '<button type="button" class="pn-btn pri" data-act="v-fpractise">' + H.ico("play") + ' Practise now</button><button type="button" class="pn-btn" data-act="v-fend">End session</button></section>'
        : '<section class="pn-panel"><p class="vf-big">Pick a session, put the phone on silent, and study.</p>' + live +
        '<div class="pn-wrap pn-seg4">' + [25, 50, 90].map(function (m) { return '<button type="button" class="pn-chip" data-act="v-fstart" data-v="' + m + '">' + m + " min</button>"; }).join("") + "</div>" +
        '<p class="pn-mut pn-small">' + (user() ? "Others see only the count, never your name." : "Sign in to see how many are studying with you.") + "</p></section>") + "</div>");
  }

  /* ---------- mnemonic lab ---------- */
  function mnHtml(it) {
    if (!H || !it || it.id == null || it._s === "deck" || it.qg || !user()) return "";
    var x = P.mn[it.id];
    if (x === undefined && !P.mnAsk[it.id]) {
      P.mnAsk[it.id] = 1;
      api("GET", "mn?item=" + encodeURIComponent(it.id)).then(function (j) { P.mn[it.id] = j.items || []; var r = H.run_(); if (r && !r.done && r.items[r.i] && r.items[r.i].id === it.id) H.rerender(); }, function () { P.mn[it.id] = null; });
    }
    if (!x) return x === null ? "" : '<section class="pv-mn" aria-busy="true"><h3>Memory aids</h3><p class="pn-mut pn-small">Loading…</p></section>';
    return '<section class="pv-mn"><h3>Memory aids from students</h3>' + (x.length ? '<ul class="pv-mnl">' + x.map(function (m) {
      return '<li><p>' + esc(m.text) + '</p><div class="pv-mnr">' + (m.mine ? '<span class="pn-mut pn-small">Yours · ' + m.up + ' up</span><button type="button" class="pn-link" data-act="v-mndel" data-v="' + esc(m.id) + '">Delete</button>' :
        '<button type="button" class="pn-chip sm' + (m.voted ? " on" : "") + '" data-act="v-mnup" data-v="' + esc(m.id) + '" aria-pressed="' + !!m.voted + '" aria-label="Helpful, ' + m.up + ' so far">Helpful · ' + m.up + '</button><button type="button" class="pn-link" data-act="v-mnrep" data-v="' + esc(m.id) + '">Report</button>') + "</div></li>";
    }).join("") + "</ul>" : '<p class="pn-mut pn-small">None yet. Be the first.</p>') +
      '<button type="button" class="pn-link" data-act="v-mnadd">' + H.ico("plus") + " Add your memory aid</button><p class=\"pn-mut pn-small\">Written by students and not checked by StewardMD.</p></section>";
  }
  function curItem() { var r = H.run_(); return r && r.items[r.i]; }
  function mnSheet() {
    var it = curItem(); if (!it) return;
    closeSheet(true);
    var el = D.createElement("div"); el.className = "pn-sheet-wrap"; el.id = "pvSheet";
    el.innerHTML = '<div class="pn-scrim" data-act="v-close"></div><section class="pn-sheet" role="dialog" aria-modal="true" aria-labelledby="pvMnT" tabindex="-1"><span class="pn-grab" aria-hidden="true"></span><h2 id="pvMnT">Your memory aid</h2>' +
      '<p class="pn-mut pn-small">A mnemonic or a one-line trick for this question. Plain text, no links. Others can mark it helpful.</p>' +
      '<label class="pn-sr" for="pvMnIn">Memory aid</label><textarea id="pvMnIn" class="pn-in px-ta" rows="4" maxlength="280"></textarea><p class="pn-mut pn-small" id="pvMnMsg" role="status"></p>' +
      '<div class="pn-sheet-act"><button type="button" class="pn-btn" data-act="v-close">Cancel</button><button type="button" class="pn-btn pri" data-act="v-mnsave">Post</button></div></section>';
    P.sheet = el; P.prev = D.activeElement; H.root().appendChild(el);
    try { el.querySelector("#pvMnIn").focus({ preventScroll: true }); } catch (e) {}
  }
  function mnSave() {
    var it = curItem(), el = P.sheet; if (!it || !el) return;
    var t = el.querySelector("#pvMnIn").value, msg = el.querySelector("#pvMnMsg");
    api("POST", "mn", { item: String(it.id), text: t }).then(function () { closeSheet(); delete P.mn[it.id]; delete P.mnAsk[it.id]; H.toast("Posted"); H.rerender(); }, function (e) {
      var c = e && e.body && e.body.error;
      msg.textContent = c === "length" ? "Write 6 to 280 characters." : c === "no-links" ? "Links, handles and phone numbers are not allowed." : c === "limit" ? "That is 5 today. Post more tomorrow." : "Could not post. Check the connection.";
    });
  }
  function mnAct(kind, id) {
    var it = curItem(); if (!it) return;
    var list = P.mn[it.id] || [], m = list.filter(function (x) { return x.id === id; })[0];
    if (kind === "up" && m) { var up = !m.voted; api("POST", "mn/vote", { id: id, up: up }).then(function (j) { m.voted = up; m.up = j.up; H.rerender(); }, function () { H.toast("Could not vote. Check the connection."); }); }
    if (kind === "rep") api("POST", "mn/report", { id: id }).then(function () { P.mn[it.id] = list.filter(function (x) { return x.id !== id; }); H.toast("Reported. Thank you."); H.rerender(); }, function () {});
    if (kind === "del") api("POST", "mn/delete", { id: id }).then(function () { P.mn[it.id] = list.filter(function (x) { return x.id !== id; }); H.rerender(); }, function () {});
  }
  function closeSheet(quiet) { if (!P.sheet) return false; if (P.sheet.parentNode) P.sheet.parentNode.removeChild(P.sheet); P.sheet = null; if (!quiet) try { if (P.prev && P.prev.isConnected) P.prev.focus({ preventScroll: true }); } catch (e) {} return true; }

  /* ---------- seasons ---------- */
  function openSeason() {
    var go = function () { P.season = null; H.push(renderSeason); api("GET", "season?exam=" + encodeURIComponent(H.exam().id)).then(function (j) { P.season = j; onScreen(renderSeason); }, function (e) { P.season = { err: e && e.status === 403 ? "Join the Arena first." : "The season needs a connection." }; onScreen(renderSeason); }); };
    if (G.PREP_ARENA && G.PREP_ARENA.joined) return G.PREP_ARENA.joined(go);
    go();
  }
  function renderSeason() {
    var j = P.season, body;
    if (!j) body = '<p class="pn-load" role="status">Loading the season…</p>';
    else if (j.err) body = '<p class="pn-err" role="alert">' + esc(j.err) + "</p>";
    else {
      var me = j.me, left = Math.max(0, Math.ceil((j.season.end - Date.now()) / 864e5)), nx = me.next;
      var pct = nx ? Math.max(0, Math.min(1, (me.points - me.at) / (nx.at - me.at))) : 1;
      body = '<section class="pn-panel pv-tier t-' + esc(me.tier.toLowerCase()) + '"><p class="pn-eb">Season ' + j.season.n + " · " + left + (left === 1 ? " day" : " days") + ' left</p><p class="pv-tname">' + esc(me.tier) + "</p>" +
        "<p><b>" + me.points + "</b> points" + (me.rank ? " · rank " + me.rank : "") + "</p>" +
        (nx ? '<span class="pn-prog" aria-hidden="true"><i style="transform:scaleX(' + pct.toFixed(3) + ')"></i></span><p class="pn-mut pn-small">' + (nx.at - me.points) + " more to " + esc(nx.tier) + "</p>" : '<p class="pn-mut pn-small">Top tier.</p>') + "</section>" +
        (j.last ? '<p class="pn-mut">Last season: ' + esc(j.last.tier) + ", " + j.last.points + " points.</p>" : "") +
        '<p class="pn-mut pn-small">Points: a battle win 3, a draw 1, each daily sprint or grand test 1. Everyone starts at zero each season.</p>' +
        '<h2 class="pn-sec">Top this season</h2>' + (j.rows.length ? '<ol class="pv-board">' + j.rows.map(function (r) { return '<li class="' + (r.me ? "me" : "") + '"><span>' + r.rank + "</span><b>" + esc(r.name) + "</b><span>" + r.points + " · " + esc(r.tier) + "</span></li>"; }).join("") + "</ol>" : '<p class="pn-mut">No points yet this season. Win a battle to open the board.</p>');
    }
    H.paint(H.bar("Season", esc(H.planExamLabel ? H.planExamLabel() : H.exam().label), "back") + '<div class="pn-body pv-season">' + body + "</div>");
  }

  /* ---------- wrapped ---------- */
  function wrapMonth() {
    var now = new Date(), cur = ym(now.getTime()), prev = ym(new Date(now.getFullYear(), now.getMonth() - 1, 15).getTime());
    return now.getDate() <= 5 ? prev : cur;
  }
  function openWrapped() {
    var dayNum = function (ms) { var C = H.core(); return C.dayNum(ms, new Date(ms).getTimezoneOffset()); };
    P.wrap = { i: 0, w: wrapped(store(), wrapMonth(), dayNum, function (m) { return H.subjectOfModule(m); }) };
    H.push(renderWrapped);
  }
  function monthName(m) { try { return new Date(+m.slice(0, 4), +m.slice(5, 7) - 1, 15).toLocaleDateString("en-IN", { month: "long" }); } catch (e) { return m; } }
  function slides(w) {
    var out = [];
    out.push(["Your " + monthName(w.month), H.fmt(w.n), w.n === 1 ? "question answered" : "questions answered", w.active + " of " + w.days + " days you showed up."]);
    out.push(["Longest run", String(w.best), w.best === 1 ? "day in a row" : "days in a row", w.best >= 7 ? "A full week and more without a break." : "Every day counts. Next month, longer."]);
    if (w.top) out.push(["Most time on", subjName(w.top), H.fmt(w.topN) + " questions", "Your go-to subject this month."]);
    if (w.strong) out.push(["Strongest", subjName(w.strong), w.strongPct + "% right", "Your best accuracy, over all your answers so far."]);
    if (w.persona) out.push(["You are a", w.persona.name, w.persona.share + "% of your answers", "Most active around " + (w.persona.peak % 12 || 12) + (w.persona.peak < 12 ? " am" : " pm") + "."]);
    if (w.bosses || w.spot || w.focus) out.push(["Extras", String(w.bosses), w.bosses === 1 ? "boss beaten" : "bosses beaten", w.spot + " spot diagnoses right · " + w.focus + " focused minutes"]);
    return out;
  }
  function renderWrapped() {
    var x = P.wrap; if (!x) return;
    var sl = slides(x.w), last = x.i >= sl.length, c = sl[Math.min(x.i, sl.length - 1)];
    var dots = '<div class="pv-dots" aria-hidden="true">' + sl.concat([0]).map(function (z, i) { return '<i class="' + (i <= x.i ? "on" : "") + '"></i>'; }).join("") + "</div>";
    var card = last ? '<section class="pv-slide pv-share"><p class="pv-eb">That was ' + esc(monthName(x.w.month)) + '</p><p class="pv-num">' + H.fmt(x.w.n) + '</p><p class="pv-unit">questions</p><button type="button" class="pn-btn pri" data-act="v-wshare">Share my Wrapped</button><button type="button" class="pn-btn" data-act="back">Done</button></section>' :
      '<button type="button" class="pv-slide s' + (x.i % 4) + '" data-act="v-wnext" aria-label="Next card"><p class="pv-eb">' + esc(c[0]) + '</p><p class="pv-num">' + esc(c[1]) + '</p><p class="pv-unit">' + esc(c[2]) + '</p><p class="pv-sub">' + esc(c[3]) + '</p><span class="pv-tap">Tap for the next</span></button>';
    H.paint(H.bar("Wrapped", esc(monthName(x.w.month)), "back") + '<div class="pn-body pv-wrap">' + dots + card + "</div>");
  }
  function shareWrapped(btn) {
    var w = P.wrap.w, W = 1080, HT = 1920, cv = D.createElement("canvas"); cv.width = W; cv.height = HT;
    var x = cv.getContext("2d"), F = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif', M = 96;
    x.fillStyle = "#1a1a2e"; x.fillRect(0, 0, W, HT);
    x.fillStyle = "#efc07b"; x.font = "700 52px " + F; x.fillText("PrepNucleus Wrapped", M, 180);
    x.fillStyle = "#f5f3ee"; x.font = "600 64px " + F; x.fillText(monthName(w.month), M, 270);
    var rows = [[H.fmt(w.n), "questions"], [String(w.active), "days studied"], [String(w.best), "day best run"]];
    if (w.top) rows.push([subjName(w.top), "most played"]);
    if (w.persona) rows.push([w.persona.name, "study style"]);
    rows.slice(0, 5).forEach(function (r, i) {
      var y = 480 + i * 260;
      x.fillStyle = "#f5f3ee"; x.font = "700 " + (r[0].length > 12 ? 84 : 140) + "px " + F; x.fillText(r[0], M, y);
      x.fillStyle = "#a9b1c7"; x.font = "600 44px " + F; x.fillText(r[1], M, y + 64);
    });
    x.fillStyle = "#8c95ae"; x.font = "600 34px " + F; x.fillText("StewardMD", M, HT - 110);
    btn.disabled = true;
    var Pl = G.Capacitor && G.Capacitor.Plugins, data = cv.toDataURL("image/png"), name = "prepnucleus-wrapped.png";
    var p = G.SMD_IS_NATIVE && Pl && Pl.Filesystem && Pl.Share ? Pl.Filesystem.writeFile({ path: name, data: data.split(",")[1], directory: "CACHE" }).then(function (wr) { return Pl.Share.share({ title: "My PrepNucleus Wrapped", url: wr.uri, dialogTitle: "Share Wrapped" }); }) :
      new Promise(function (res) { cv.toBlob(res, "image/png"); }).then(function (b) {
        var f = null; try { f = new G.File([b], name, { type: "image/png" }); } catch (e) {}
        if (f && G.navigator.canShare && G.navigator.canShare({ files: [f] })) return G.navigator.share({ files: [f], title: "My PrepNucleus Wrapped" });
        var a = D.createElement("a"); a.href = data; a.download = name; D.body.appendChild(a); a.click(); a.remove();
      });
    P.lastShare = data.length;
    p.then(null, function (e) { if (!(e && e.name === "AbortError")) H.toast("Wrapped could not be shared."); }).then(function () { btn.disabled = false; });
  }

  /* ---------- actions ---------- */
  function act(a, b, h) {
    H = h;
    var v = b.getAttribute("data-v");
    if (a === "v-feed") return openFeed();
    if (a === "v-fa") return feedAnswer(b);
    if (a === "v-more") return feedMore();
    if (a === "v-spot") return openSpot();
    if (a === "v-spotgo") return spotGo();
    if (a === "v-spota") return spotAnswer(Number(b.getAttribute("data-k")));
    if (a === "v-boss") return H.push(renderBossList);
    if (a === "v-bossgo") { if (H.stackTop() !== renderBossList) { var stk = H.stack(); while (stk.length > 1 && stk[stk.length - 1] !== renderBossList) stk.pop(); } return startBoss(v); }
    if (a === "v-quick") return quick();
    if (a === "v-voice") return startVoice();
    if (a === "v-voicestop") { stopVoice(); var c = H.root().querySelector("#pvVoice"); if (c) c.remove(); return; }
    if (a === "v-focus") { P.focusN = null; return H.push(renderFocus); }
    if (a === "v-fstart") return startFocus(Number(v) || 25);
    if (a === "v-fend") return endFocus(false);
    if (a === "v-fpractise") return H.startPlan ? H.startPlan() : H.back();
    if (a === "v-wrap") return openWrapped();
    if (a === "v-wnext") { P.wrap.i++; return H.rerender(); }
    if (a === "v-wshare") return shareWrapped(b);
    if (a === "v-season") return openSeason();
    if (a === "v-freeze") return H.toast("Answer " + FREEZE_EXTRA + " more than your daily goal in a day to earn a freeze (" + FREEZE_MAX + " at most). A freeze covers a missed day on its own.");
    if (a === "v-mnadd") return mnSheet();
    if (a === "v-mnsave") return mnSave();
    if (a === "v-mnup") return mnAct("up", v);
    if (a === "v-mnrep") return mnAct("rep", v);
    if (a === "v-mndel") return mnAct("del", v);
    if (a === "v-close") return closeSheet();
  }
  function back() {
    if (closeSheet()) return true;
    if (P.voice) stopVoice();
    if (P.spot && H && H.stackTop() === renderSpot) { G.clearTimeout(P.spotT); if (P.spot.t0 && P.spot.ans == null && !P.spot.done) spotAnswer(-1); P.spot = null; }
    return false;
  }
  function leave() { stopVoice(); G.clearTimeout(P.spotT); closeSheet(true); P.feed = null; }
  function open(kind, h) {
    H = h;
    if (kind === "quick") return quick();
    if (kind === "spot") return openSpot();
    if (kind === "feed") return openFeed();
    if (kind === "focus") return H.push(renderFocus);
  }
  // A focus session that outlives a closed PrepNucleus picks its heartbeat back up on the next open.
  function bind(h) { H = h; if (focusOn() && !P.focusT) P.focusT = G.setInterval(focusTick, 60e3); }

  G.PREP_PLAY = { act: act, back: back, leave: leave, open: open, bind: bind, homeHtml: function (h) { bind(h); return homeHtml(h); }, mnHtml: mnHtml, noteAnswer: noteAnswer, _pure: PURE, _p: P };
})(typeof window !== "undefined" ? window : this);
