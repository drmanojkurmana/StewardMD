/* PrepReels (MediGram) feed controller. window.PREP_MEDIGRAM. ES5.
   Loaded lazily by prep-loader.js only when smd_prep_medigram is on; with the flag off this file is never fetched.
   Draws through PREP._host with data-act="mg-*"; prep.js forwards mg-, asks back() first and calls leave() on close.
   One full-screen card per swipe, every format mixed: real bank questions from every subject of the learner's exam
   (FSRS through host.record, like the Play feed), key-point pearls, CliniX teaching videos (prep-medigram-media.js),
   lessons for the modules just drawn, and image cards. Finite: a batch ends on a score card with Keep going / Finish. */
(function (G) {
  "use strict";
  var DATA = G.PREP_MG_DATA, MEDIA = G.PREP_MG_MEDIA;
  if (!DATA) return;

  function lsGet(k) { try { return G.localStorage.getItem(k); } catch (e) { return null; } }
  function prepOn() {
    try { var q = (G.location.search.match(/[?&]prep=([^&]+)/) || [])[1]; if (q != null) return q === "1" || q === "on" || q === "true"; } catch (e) {}
    return lsGet("smd_prep") !== "0";
  }
  var FLAGS = DATA.resolveFlags({ prepEnabled: prepOn(), get: lsGet, search: (G.location && G.location.search) || "" });
  if (!FLAGS.parent) return;

  var BATCH = 18, PER = 2, L = ["A", "B", "C", "D", "E", "F"];
  var S = null;   // { host, mode, cards, loading, err, done, right, top, brk, timer, vt, ct, lt, les, fs, seen }
  var VIDS = null, IMGS = null;

  function H() { return S.host; }
  function esc(s) { return S && S.host ? S.host.esc(s) : String(s == null ? "" : s); }
  function consent() { return { analytics: lsGet("smd_prep_stats") === "1" }; }
  function emit(name, data) {
    var e = DATA.buildEvent(name, data, consent());
    if (e) { try { var k = "smd_prep_medigram_events", old = JSON.parse(lsGet(k) || "[]"); old.push(e); G.localStorage.setItem(k, JSON.stringify(old.slice(-100))); } catch (x) {} }
  }
  function subjName(sid) { try { var sb = H().subjectById(sid); return sb ? H().tx(sb.name) : ""; } catch (e) { return ""; } }
  function firstSentence(t) { t = String(t || "").replace(/\*\*|__/g, "").replace(/[​‌‍⁠﻿]/g, "").replace(/\s+/g, " ").trim(); var m = /^.*?[.!?](\s|$)/.exec(t); return (m ? m[0] : t).trim().slice(0, 260); }
  function libUrl(u) { u = String(u || ""); return u.charAt(0) === "/" && G.SMD_API_BASE && (u.indexOf("/api/") === 0 || u.indexOf("/assets/") === 0) ? String(G.SMD_API_BASE).replace(/\/$/, "") + u : u; }   // as image-library.js imgUrl
  function imgUrl(f) { var u = (H().bankApi || "/api/prep/bank/") + "img/maikimg/" + f; return u.charAt(0) === "/" && G.SMD_API_BASE ? G.SMD_API_BASE + u : u; }

  /* ---------- content ---------- */
  // Random medical knowledge: k random modules across every subject of the exam, their usable items, shuffled.
  function draw(k) {
    var h = H(), ex = h.exam().id;
    return Promise.all(h.subjectsOf(ex).map(function (sb) { return h.loadIndex(sb.id).then(function (ix) { return { sid: sb.id, ix: ix }; }, function () { return null; }); })).then(function (xs) {
      var mods = [];
      xs.forEach(function (x) { if (x && x.ix && x.ix.topics) x.ix.topics.forEach(function (t) { if (t.group !== "mixed" && h.countFor(t, ex) > 0) mods.push({ s: x.sid, m: t.id }); }); });
      // More topics, fewer per topic: at most PER questions from each of k random modules; liked topics come first.
      var liked = likedTopics().filter(function (t) { return mods.some(function (x) { return x.s === t.s && x.m === t.m; }); }).slice(0, 3);
      var rest = h.shuffle(mods).filter(function (x) { return !liked.some(function (t) { return t.s === x.s && t.m === x.m; }); });
      return Promise.all(liked.concat(rest).slice(0, k).map(function (x) { return h.loadModule(x.s, x.m).then(function (items) { return h.shuffle(h.pool(h.poolFor(items, ex, null)).filter(textOnly)).slice(0, PER); }, function () { return []; }); }));
    }).then(function (lists) { var all = []; lists.forEach(function (l) { all = all.concat(l); }); return h.shuffle(all); });
  }
  // A reel card shows text only, so questions that need their figure are left out (same rule as the daily question in prep.js).
  function textOnly(it) {
    if (!it || !it.id || !it.q || !it.o || it.o.length < 2 || it.o.length > L.length || !(it.a >= 0 && it.a < it.o.length)) return false;
    if ((it.img && it.img.length) || /\b(image|shown|figure|photograph|picture|x-?ray below|graph)\b/i.test(it.q)) return false;
    try { if (G.PREP_RAD && G.PREP_RAD.figure(it, H())) return false; } catch (e) {}
    return true;
  }
  function videos() {
    if (VIDS || !FLAGS.youtube || !MEDIA) return Promise.resolve(VIDS || []);
    // The bundled official-channel set (prep-medigram-videos.js) plus the CliniX exam videos.
    var own = (G.PREP_MG_VIDEOS || []).filter(function (v) { return MEDIA.validVideoId(v[0]); }).map(function (v) { return { kind: "video", videoId: v[0], title: v[1], caption: "", by: v[2], s: v[3] }; });
    return G.fetch("/clinix/media/manifest.json").then(function (r) { return r.json(); }).then(function (m) { return MEDIA.videosFrom(m); }, function () { return []; })
      .then(function (cx) { var seen = {}; VIDS = own.concat(cx).filter(function (v) { return !seen[v.videoId] && (seen[v.videoId] = 1); }); return VIDS; });
  }
  function images() {
    if (IMGS) return Promise.resolve(IMGS);
    var base = (H().staticBase || "/prep/").replace(/bank\/?$/, "");
    var get = function (f) { return H().getJSON(base + "imglearn/" + f).then(function (m) { return ((m && m.items) || []).filter(function (x) { return x.img && x.dx; }); }, function () { return []; }); };
    return Promise.all([get("eye.json"), get("psm.json")]).then(function (x) { return (IMGS = x[0].concat(x[1])); });
  }
  /* Image Library (kb/dist/imglib, the same bank the Image Library screen shows: KB figures, lesson images, ECGs, Tokos,
     Ophthalmos, Narke, CliniX and Commons pathology, about 10,000 captioned images). NEET-SS takes its specialty
     systems; every other exam takes a few random systems per batch so a batch never downloads the whole bank. */
  var IGL = "/kb/dist/imglib/", iglIx = null, iglSys = {};
  function iglJSON(u) { return (G.SMD_CONTENT && G.SMD_CONTENT.fetchJSON ? G.SMD_CONTENT.fetchJSON(u) : G.fetch(u).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })); }
  function iglSystem(slug) {
    if (iglSys[slug]) return Promise.resolve(iglSys[slug]);
    return iglJSON(IGL + slug + ".json").then(function (j) {
      return (iglSys[slug] = ((j && j.items) || []).filter(function (e) { return e && e.s && (e.c || e.t); }).map(function (e) { return { kind: "lib", e: e, sys: (j && j.name) || slug, slug: slug }; }));
    }, function () { return []; });
  }
  function libImages(n) {
    var h = H(), ex = h.exam().id, subs = [];
    try { subs = (h.planSubjects ? h.planSubjects() : []).map(function (x) { return x.id; }); if (!subs.length) subs = h.subjectsOf(ex).map(function (x) { return x.id; }); } catch (e) {}
    var want = DATA.imgSystemsFor ? DATA.imgSystemsFor(ex, subs) : null;
    var pick = want ? Promise.resolve(want) : (iglIx ? Promise.resolve(iglIx) : iglJSON(IGL + "index.json").then(function (j) { return (iglIx = ((j && j.systems) || []).map(function (x) { return x.slug; })); }, function () { return []; }));
    return pick.then(function (slugs) {
      slugs = h.shuffle(slugs.slice()).slice(0, want ? 4 : 3);
      return Promise.all(slugs.map(iglSystem));
    }).then(function (lists) { var all = []; lists.forEach(function (l) { all = all.concat(unseen(l)); }); return h.shuffle(all).slice(0, n); });
  }
  function lessonsFor(items) {
    if (!G.PREP_LESSONS || !G.PREP_LESSONS.index) return Promise.resolve([]);
    return G.PREP_LESSONS.index().then(function (ix) {
      var seen = {}, out = [];
      items.forEach(function (it) { var l = ix && ix.modules && ix.modules[it._m]; if (l && !seen[it._m]) { seen[it._m] = 1; out.push({ kind: "lesson", sid: it._s, mid: it._m, title: l.title, minutes: l.minutes }); } });
      return out;
    }, function () { return []; });
  }
  // Extras in a rotation (video, lesson, image) so every format shows up early in a batch.
  function rotate(vids, lessons, imgs, lib) {
    var h = H(), v = h.shuffle(vids.slice()), l = lessons.slice(), im = h.shuffle(imgs.slice()).slice(0, 3).map(function (it) { return { kind: "img", it: it }; }), b = (lib || []).slice(), out = [];
    while (v.length || l.length || im.length || b.length) {
      if (v.length) out.push(v.shift()); if (b.length) out.push(b.shift()); if (l.length) out.push(l.shift()); if (b.length) out.push(b.shift()); if (im.length) out.push(im.shift());
    }
    return out;
  }
  // Nothing repeats inside a session: questions, videos, lessons and images already shown are left out of later batches.
  function keyOf(c) { return c.kind === "q" ? "q:" + c.it.id : c.kind === "video" ? "v:" + c.videoId : c.kind === "lesson" ? "l:" + c.mid : c.kind === "img" ? "i:" + c.it.img : c.kind === "lib" ? "b:" + c.e.s : c.kind === "pearl" ? "p:" + c.text : ""; }
  function fresh(cards) { return cards.filter(function (c) { var k = keyOf(c); if (!k || S.seen[k]) return false; S.seen[k] = 1; return true; }); }
  function unseen(xs, kind) { return xs.filter(function (x) { return !S.seen[keyOf(x.kind ? x : { kind: kind, it: x })]; }); }
  function batch() {
    if (S.mode === "clinical") return Promise.all([videos(), images(), libImages(10)]).then(function (x) { return fresh(rotate(unseen(x[0]), [], unseen(x[1], "img"), x[2]).slice(0, BATCH)); });
    return Promise.all([draw(10), videos(), images(), libImages(8)]).then(function (x) {
      var items = unseen(x[0], "q").slice(0, BATCH);
      return lessonsFor(items).then(function (les) { return fresh(DATA.mixFeed(items, rotate(unseen(x[1]), unseen(les), unseen(x[2], "img"), x[3]), lsGet("smd_prep_medigram_cadence") || 3)); });
    });
  }
  function load(more) {
    S.loading = true; S.err = false;
    if (!more) render();
    var s0 = S;
    var first = S.first && S.mode === "study"; S.first = false;
    Promise.all([batch(), first ? inbox() : Promise.resolve([])]).then(function (x) { return fresh(x[1]).concat(x[0]); }).then(function (cards) {
      if (S !== s0) return;
      S.loading = false;
      if (!cards.length && !S.cards.length) S.err = true;
      if (more && !cards.length) { H().toast("You have seen every card for now. Come back later for more."); return render(S.cards.length); }
      S.cards = S.cards.concat(cards);
      render(more ? S.cards.length - cards.length : -1);
    }, function () { if (S !== s0) return; S.loading = false; if (!S.cards.length) S.err = true; else H().toast("More cards need a connection."); render(); });
  }

  /* ---------- cards ---------- */
  function card(c, i) {
    var h = cardBody(c, i);
    if (c.from) h = h.replace('<p class="pn-mg-tag">', '<p class="pn-mg-from">Sent by ' + esc(c.from) + '</p><p class="pn-mg-tag">');
    return h.replace(/<\/article>$/, actsHtml(c, i) + "</article>");
  }
  function cardBody(c, i) {
    var a = ' data-i="' + i + '"';
    if (c.kind === "pearl") return '<article class="vf-c vf-pearl pn-mg-c"' + a + '><p class="pn-mg-tag">Remember</p><p class="vf-big">' + esc(c.text) + "</p>" + (c.s ? '<p class="pn-mut pn-small">' + esc(subjName(c.s)) + "</p>" : "") + "</article>";
    if (c.kind === "video") {
      return '<article class="vf-c pn-mg-c pn-mg-vid"' + a + ' data-vid="' + esc(c.videoId) + '"><p class="pn-mg-tag">Watch' + (c.s ? " · " + esc(subjName(c.s) || c.s.charAt(0).toUpperCase() + c.s.slice(1)) : "") + "</p>" + '<p class="vf-stem">' + esc(c.title) + "</p>" +
        // The poster is a background, not an <img>: a tap must start the video, never open the image zoom viewer.
        '<div class="pn-mg-frame" data-act="mg-play" data-i="' + i + '" style="background-image:url(\'https://i.ytimg.com/vi/' + esc(c.videoId) + '/hqdefault.jpg\')"><span class="pn-mg-play" aria-hidden="true"><svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span></div>' + vctl() +
        '<p class="pn-mut pn-small">' + esc(c.caption && c.caption !== c.title ? c.caption + " · " : "") + (c.by ? esc(c.by) + " on YouTube" : "YouTube") + "</p></article>";
    }
    if (c.kind === "lesson") {
      return '<article class="vf-c pn-mg-c pn-mg-les"' + a + '><p class="pn-mg-tag">Lesson · ' + esc(subjName(c.sid)) + (c.minutes ? " · " + c.minutes + " min" : "") + '</p><p class="vf-stem">' + esc(c.title) + "</p>" +
        '<div class="pn-mg-story" data-act="mg-les-tap" data-i="' + i + '" aria-live="polite">' + storyHtml(c) + "</div>" +
        '<div class="pn-mg-lctl"><button type="button" class="pn-btn" data-act="mg-les" data-v="listen" data-i="' + i + '" aria-pressed="' + !!c.listen + '">' + (c.listen ? "Stop listening" : "Listen") + '</button>' +
        '<button type="button" class="pn-btn" data-act="mg-lesson" data-i="' + i + '">Full lesson and quiz</button></div></article>';
    }
    if (c.kind === "lib") {
      // An Image Library picture, explained: its caption, plus its article and lesson when it has them. Tap = zoom viewer.
      var e = c.e, cap = e.c || e.a || "";
      return '<article class="vf-c pn-mg-c pn-mg-lib"' + a + '><p class="pn-mg-tag">' + esc([e.k || "Image", c.sys].filter(Boolean).join(" · ")) + '</p>' +
        '<figure class="pn-mg-fig"' + (e.ar ? ' style="--ar:' + (+e.ar || 1.5) + '"' : "") + '><img src="' + esc(libUrl(e.s)) + '" alt="' + esc(e.a || e.t || "Clinical image") + '" loading="lazy" decoding="async"></figure>' +
        '<p class="vf-stem">' + esc(e.t || "") + "</p>" + (cap && cap !== e.t ? '<p class="vf-why pn-mg-cap">' + esc(cap) + "</p>" : "") +
        ((e.ka || e.ls) ? '<div class="pn-mg-lctl">' + (e.ka ? '<button type="button" class="pn-btn" data-act="mg-lib-art" data-i="' + i + '">Read the article</button>' : "") + (e.ls ? '<button type="button" class="pn-btn" data-act="mg-lib-les" data-i="' + i + '">Open the lesson</button>' : "") + "</div>" : "") +
        "</article>";
    }
    if (c.kind === "img") {
      return '<article class="vf-c vf-img pn-mg-c"' + a + '><p class="pn-mg-tag">Spot it · ' + esc(c.it.modality || c.it.deck || "Image") + '</p><figure><img src="' + esc(imgUrl(c.it.img)) + '" alt="Clinical image" loading="lazy" decoding="async"></figure>' +
        (c.shown ? '<p class="vf-big">' + esc(c.it.dx) + "</p>" + (c.it.finding ? '<p class="vf-why">' + esc(c.it.finding) + "</p>" : "") : '<button type="button" class="pn-btn" data-act="mg-reveal" data-i="' + i + '">Show the diagnosis</button>') + "</article>";
    }
    var it = c.it, done = c.ans != null;
    return '<article class="vf-c vf-q pn-mg-c"' + a + '><p class="pn-mg-tag">' + esc(subjName(it._s) || "Question") + '</p><p class="vf-stem">' + esc(it.q) + '</p><ol class="vf-opts">' + it.o.map(function (o, k) {
      var cls = "pn-opt" + (done && k === it.a ? " right" : "") + (done && k === c.ans && k !== it.a ? " wrong" : "");
      return '<li><button type="button" class="' + cls + '" data-act="mg-answer" data-i="' + i + '" data-k="' + k + '"' + (done ? ' aria-disabled="true"' : "") + '><span class="pn-l">' + L[k] + "</span><span>" + esc(o) + "</span></button></li>";
    }).join("") + "</ol>" +
      (done ? '<p class="vf-why" role="status"><b>' + (c.ans === it.a ? "Right. " : "Answer: " + L[it.a] + ". ") + "</b>" + esc(firstSentence(it.exp || (it.x && it.x.key))) + "</p>" +
        '<div class="pn-mg-row"><button type="button" class="pn-btn pri" data-act="mg-next" data-i="' + i + '">Next</button>' +
        (G.PREP_ASK && G.PREP_ASK.open ? '<button type="button" class="pn-btn" data-act="mg-understand" data-i="' + i + '">Explain simply</button>' : "") + "</div>" : "") + "</article>";
  }
  /* Our own controls under the player (YouTube's overlay hides itself on touch screens): back 10 s, play/pause,
     forward 10 s, sound, fullscreen. Commands go to the shim (prep-medigram-media.js command), state comes back. */
  var VI = { back: '<path d="M11 7l-5 5 5 5M18 7l-5 5 5 5"/>', fwd: '<path d="M6 7l5 5-5 5M13 7l5 5-5 5"/>', play: '<path d="M8 5v14l11-7z" fill="currentColor"/>', pause: '<path d="M8 5v14M16 5v14"/>',
    snd: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 9a4 4 0 010 6"/>', mute: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 9l4 6M21 9l-4 6"/>', fs: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>', exit: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>' };
  function vi(n) { return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + VI[n] + "</svg>"; }
  /* ---------- like, save, share (owner 2026-11-17) ----------
     Like: remembered per card; a liked question, lesson or image with a module brings 2 more questions on that topic
     right after it, and the topic leads the next batches. Save: questions go to PrepNucleus Bookmarks (s.bm, same
     format), every card also to the Saved reel (s.mgsv, a reference). Share: WhatsApp, the phone's share sheet, or a
     StewardMD friend (POST /api/prep/social/share with a reference, never content: functions/_prep-social.js). */
  // Only the action row is redrawn, so a playing video or a running lesson story is never torn down by a tap here.
  function redrawActs(i) {
    var el = H().root() && H().root().querySelector('#pnMgFeed .vf-c[data-i="' + i + '"]'), c = S && S.cards[i];
    if (!el || !c) return;
    [].forEach.call(el.querySelectorAll(".pn-mg-acts2, .pn-mg-share"), function (n) { n.parentNode.removeChild(n); });
    el.insertAdjacentHTML("beforeend", actsHtml(c, i));
  }
  function refOf(c) {
    if (!c) return null;
    if (c.kind === "q" && c.it && c.it._s && c.it._m && c.it.id) return { k: "q", s: c.it._s, m: c.it._m, id: c.it.id };
    if (c.kind === "video") return { k: "v", v: c.videoId };
    if (c.kind === "lib" && c.slug) return { k: "b", sys: c.slug, src: c.e.s };
    if (c.kind === "lesson") return { k: "l", s: c.sid, m: c.mid };
    return null;
  }
  function refKey(r) { return r ? r.k + ":" + (r.id || r.v || r.src || r.m) : ""; }
  // A reference back to a card, rebuilt from this phone's own bank (shared and saved cards never carry content).
  function resolveRef(r) {
    var h = H();
    if (!r) return Promise.resolve(null);
    if (r.k === "q") return h.loadModule(r.s, r.m).then(function (items) { var it = (items || []).filter(function (x) { return x.id === r.id; })[0]; return it && textOnly(it) ? { kind: "q", it: it } : null; }, function () { return null; });
    if (r.k === "v") return videos().then(function (vs) { return vs.filter(function (v) { return v.videoId === r.v; })[0] || null; });
    if (r.k === "b") return iglSystem(r.sys).then(function (l) { return l.filter(function (x) { return x.e.s === r.src; })[0] || null; });
    if (r.k === "l") return G.PREP_LESSONS && G.PREP_LESSONS.index ? G.PREP_LESSONS.index().then(function (ix) { var l = ix && ix.modules && ix.modules[r.m]; return l ? { kind: "lesson", sid: r.s, mid: r.m, title: l.title, minutes: l.minutes } : null; }, function () { return null; }) : Promise.resolve(null);
    return Promise.resolve(null);
  }
  function st() { try { return H().store() || {}; } catch (e) { return {}; } }
  function likedTopics() { var s = st(); return ((s.mgtop || [])).slice(-6).reverse(); }
  function topicOf(c) {
    if (c.kind === "q" && c.it) return { s: c.it._s, m: c.it._m };
    if (c.kind === "lesson") return { s: c.sid, m: c.mid };
    if (c.kind === "lib" && c.e && c.e.lsj && c.e.lm) return { s: c.e.lsj, m: c.e.lm };
    return null;
  }
  function isLiked(c) { var s = st(); return !!(s.mglk && s.mglk[refKey(refOf(c)) || ("x:" + keyOf(c))]); }
  function isSaved(c) { var s = st(), r = refOf(c); return !!(r && s.mgsv && s.mgsv[refKey(r)]); }
  var AI = { like: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>', save: '<path d="M6 3h12v18l-6-4-6 4z"/>', share: '<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M12 3v13M7 8l5-5 5 5"/>' };
  function ai(n, on) { return '<svg viewBox="0 0 24 24" width="22" height="22" fill="' + (on ? "currentColor" : "none") + '" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + AI[n] + "</svg>"; }
  function actsHtml(c, i) {
    var lk = isLiked(c), sv = isSaved(c), canSave = !!refOf(c);
    return '<div class="pn-mg-acts2" role="group" aria-label="Actions">' +
      '<button type="button" class="pn-mg-a' + (lk ? " on" : "") + '" data-act="mg-like" data-i="' + i + '" aria-pressed="' + lk + '">' + ai("like", lk) + "<span>" + (lk ? "Liked" : "Like") + "</span></button>" +
      (canSave ? '<button type="button" class="pn-mg-a' + (sv ? " on" : "") + '" data-act="mg-save" data-i="' + i + '" aria-pressed="' + sv + '">' + ai("save", sv) + "<span>" + (sv ? "Saved" : "Save") + "</span></button>" : "") +
      '<button type="button" class="pn-mg-a" data-act="mg-share" data-i="' + i + '" aria-expanded="' + (S.shareI === i) + '">' + ai("share") + "<span>Share</span></button></div>" +
      (S.shareI === i ? shareHtml(c, i) : "");
  }
  function shareHtml(c, i) {
    var f = S.friends, h = '<div class="pn-mg-share" role="group" aria-label="Share">' +
      '<div class="pn-mg-lctl"><button type="button" class="pn-btn" data-act="mg-sh-wa" data-i="' + i + '">WhatsApp</button><button type="button" class="pn-btn" data-act="mg-sh-more" data-i="' + i + '">More apps</button></div>';
    if (refOf(c)) {
      h += '<p class="pn-mg-sn">Send to a StewardMD friend</p>';
      if (f === "load") h += '<p class="pn-mut pn-small">Loading your friends…</p>';
      else if (f && f.err) h += '<p class="pn-mut pn-small">' + esc(f.err) + "</p>";
      else if (f && f.list && f.list.length) h += '<div class="pn-mg-frs">' + f.list.map(function (x) { return '<button type="button" class="pn-btn" data-act="mg-sh-fr" data-i="' + i + '" data-v="' + esc(x.smdId) + '">' + esc(x.name) + "</button>"; }).join("") + "</div>";
      else if (f) h += '<p class="pn-mut pn-small">No friends yet.</p>';
      h += '<button type="button" class="pn-btn" data-act="mg-sh-add">Add a friend by StewardMD ID</button>';
    }
    return h + "</div>";
  }
  function shareText(c) {
    var tail = "\n\nFrom PrepReels in StewardMD";
    if (c.kind === "q") return c.it.q + "\n" + c.it.o.map(function (o, k) { return L[k] + ". " + o; }).join("\n") + "\n\nCan you get it?" + tail;
    if (c.kind === "video") return c.title + "\nhttps://youtu.be/" + c.videoId + tail;
    if (c.kind === "lib") return (c.e.t || "") + (c.e.c ? "\n" + c.e.c : "") + tail;
    if (c.kind === "lesson") return "Lesson: " + c.title + tail;
    if (c.kind === "pearl") return "Remember: " + c.text + tail;
    if (c.kind === "img") return "Spot it: " + (c.it.dx || "") + tail;
    return "PrepReels in StewardMD";
  }
  function openUrl(u) {
    try { var P = G.Capacitor && G.Capacitor.Plugins; if (P && P.Browser && P.Browser.open && /^https:/.test(u)) { P.Browser.open({ url: u }); return; } } catch (e) {}
    try { G.location.href = u; } catch (e) {}
  }
  function nativeShare(text) {
    try { var P = G.Capacitor && G.Capacitor.Plugins; if (P && P.Share && P.Share.share) return P.Share.share({ text: text, dialogTitle: "Share" }); } catch (e) {}
    if (G.navigator && G.navigator.share) return G.navigator.share({ text: text });
    return Promise.reject(new Error("no share"));
  }
  function social() { return G.PrepSocial && G.PrepSocial.api ? G.PrepSocial : null; }
  function socialErr(e) {
    var st0 = e && e.status, code = e && e.body && e.body.error;
    if (st0 === 401) return "Sign in to send to friends.";
    if (code === "consent-required") return "Join the Arena (PrepNucleus friends) to send to friends.";
    if (code === "not_friends") return "You can only send to friends who accepted.";
    if (code === "limit") return "That is today's limit of sends. Try tomorrow.";
    return "Could not reach your friends. Try again online.";
  }
  function loadFriends(i) {
    var P = social();
    if (!P) { S.friends = { err: "Friends are not available here." }; return redrawActs(i); }
    S.friends = "load"; redrawActs(i);
    P.api("GET", "friends").then(function (j) { if (!S) return; S.friends = { list: (j && j.friends || []).filter(function (x) { return x.smdId; }) }; redrawActs(i); }, function (e) { if (!S) return; S.friends = { err: socialErr(e) }; redrawActs(i); });
  }
  // A liked card with a topic brings 2 unseen questions from that module right after it.
  function moreLike(i) {
    var c = S.cards[i], t = c && topicOf(c), h = H();
    if (!t || !t.s || !t.m) return;
    h.loadModule(t.s, t.m).then(function (items) {
      if (!S || S.cards[i] !== c) return;
      var add = h.shuffle(h.pool(h.poolFor(items || [], h.exam().id, null)).filter(textOnly)).filter(function (it) { return !S.seen["q:" + it.id]; }).slice(0, 2);
      if (!add.length) return;
      add.forEach(function (it) { S.seen["q:" + it.id] = 1; });
      var box = h.root().querySelector("#pnMgFeed"), top = box ? box.scrollTop : S.top;
      S.cards.splice.apply(S.cards, [i + 1, 0].concat(add.map(function (it) { return { kind: "q", it: it, more: 1 }; })));
      S.top = top; render();
      try { h.toast(add.length + " more on this topic next"); } catch (e) {}
    }, function () {});
  }
  // Friends' shares: sent cards come first in the reel, marked with who sent them; then they leave the inbox.
  function inbox() {
    var P = social();
    if (!P || S.mode !== "study") return Promise.resolve([]);
    return P.api("GET", "shares").then(function (j) {
      var list = (j && j.shares) || [];
      return Promise.all(list.map(function (x) { return resolveRef(x.ref).then(function (c) { if (c) { c = Object.assign({}, c); c.from = x.from && x.from.name; } return c; }); })).then(function (cards) {
        var ids = list.map(function (x) { return x.id; });
        if (ids.length) P.api("POST", "shares/seen", { ids: ids }).catch(function () {});
        return cards.filter(Boolean);
      });
    }, function () { return []; });
  }

  /* ---------- lessons as a story (passive) ---------- */
  // Each step shows its text (and a small table when it has one) and moves on by itself after a reading time, or when
  // narration ends (Listen). Tap the right of the story for next, the left for back, the middle to pause. It stops at
  // the end of the lesson: nothing scrolls the reel on its own.
  function md(t) { return esc(String(t || "")).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>"); }
  function stepHtml(st) {
    var h = '<p class="pn-mg-stx">' + md(st.tx) + "</p>", v = st.vis;
    if (v && v.kind === "table" && v.cols && v.rows) h += '<div class="pn-mg-tbl"><table><thead><tr>' + v.cols.map(function (x) { return "<th>" + md(x) + "</th>"; }).join("") + "</tr></thead><tbody>" + v.rows.slice(0, 6).map(function (r) { return "<tr>" + r.map(function (x) { return "<td>" + md(x) + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody></table></div>";
    return h;
  }
  function stepMs(st) { var w = String((st && (st.say || st.tx)) || "").split(/\s+/).length; return Math.max(7000, Math.min(30000, w * 330)); }
  function storyHtml(c) {
    if (c.err) return '<p class="pn-mg-stx">This lesson could not load here. Open the full lesson below.</p>';
    if (!c.les) return '<p class="pn-mg-stx pn-mut">Swipe here and the lesson plays.</p>';
    var n = c.les.steps.length, k = Math.min(c.step || 0, n - 1), done = c.step >= n;
    var segs = '<div class="pn-mg-segs" aria-hidden="true">' + c.les.steps.map(function (st, j) {
      var fill = j < k || done ? " full" : j === k && c.playing && !c.listen ? " run" : "";
      return '<span class="pn-mg-seg' + fill + '"><i' + (fill === " run" ? ' style="animation-duration:' + stepMs(st) + 'ms"' : "") + "></i></span>";
    }).join("") + "</div>";
    if (done) return segs + '<p class="pn-mg-stx"><b>Lesson done.</b> Swipe on, or take the quiz in the full lesson.</p>';
    return segs + '<p class="pn-mg-sn">Step ' + (k + 1) + " of " + n + (c.playing ? "" : " · paused") + "</p>" + stepHtml(c.les.steps[k]);
  }
  var TAPX = null;   // where the last tap landed, for the story's back / pause / next thirds
  try { G.document.addEventListener("click", function (e) { TAPX = e.clientX; }, true); } catch (e) {}
  function lesEl(i) { return H().root().querySelector('#pnMgFeed .vf-c[data-i="' + i + '"]'); }
  function lesDraw(i) { var el = lesEl(i), c = S.cards[i]; if (!el || !c) return; var box = el.querySelector(".pn-mg-story"); if (box) box.innerHTML = storyHtml(c); var b = el.querySelector('[data-v="listen"]'); if (b) { b.textContent = c.listen ? "Stop listening" : "Listen"; b.setAttribute("aria-pressed", String(!!c.listen)); } }
  function lesStop() { if (!S) return; G.clearTimeout(S.lt); S.lt = 0; if (S.les != null) hush(); S.les = null; }
  function hush() { try { if (G.SMD_SPEAK) G.SMD_SPEAK.stop(); } catch (e) {} }
  function lesRun(i) {
    var c = S.cards[i];
    G.clearTimeout(S.lt);
    if (!c || !c.les || c.step >= c.les.steps.length || !c.playing) return lesDraw(i);
    lesDraw(i);
    var st = c.les.steps[c.step], k = c.step, adv = function () { if (!S || S.les !== i || c.step !== k) return; c.step++; lesRun(i); };
    // Listen: the app's standard voice (smd-speak.js: Phonon 31M, system voice until it is ready); the step moves on when it ends.
    if (c.listen && G.SMD_SPEAK) { G.SMD_SPEAK.say(st.say || st.tx || "").then(adv, function () { if (S && S.les === i && c.step === k) S.lt = G.setTimeout(adv, stepMs(st)); }); return; }
    S.lt = G.setTimeout(adv, stepMs(st));
  }
  function lesStart(el) {
    var i = Number(el.getAttribute("data-i")), c = S.cards[i];
    if (!c || S.les === i) return;
    lesStop(); S.les = i;
    if (c.step == null) { c.step = 0; c.playing = true; }
    if (c.les) return lesRun(i);
    if (!G.PREP_LESSONS || !G.PREP_LESSONS.file) { c.err = 1; return lesDraw(i); }
    G.PREP_LESSONS.file(c.mid, H()).then(function (les) {
      if (!S || S.cards[i] !== c) return;
      if (!les || !les.steps || !les.steps.length) { c.err = 1; return lesDraw(i); }
      c.les = les; if (S.les === i) lesRun(i); else lesDraw(i);
    }, function () { if (S && S.cards[i] === c) { c.err = 1; lesDraw(i); } });
  }
  function vctl() {
    return '<div class="pn-mg-vctl" role="group" aria-label="Video controls" data-act="mg-ctl">' +
      '<button type="button" data-act="mg-v" data-v="back" aria-label="Back 10 seconds">' + vi("back") + "</button>" +
      '<button type="button" data-act="mg-v" data-v="toggle" data-k="play" aria-label="Pause">' + vi("pause") + "</button>" +
      '<button type="button" data-act="mg-v" data-v="fwd" aria-label="Forward 10 seconds">' + vi("fwd") + "</button>" +
      '<button type="button" data-act="mg-v" data-v="sound" data-k="snd" aria-label="Mute">' + vi("snd") + "</button>" +
      '<button type="button" data-act="mg-fs" aria-label="Full screen">' + vi("fs") + "</button></div>";
  }
  // Reflect the live player in its card's buttons (icon + label), without repainting the reel.
  function showState(live) {
    var card = live && live.holder && live.holder.closest(".pn-mg-vid");
    if (!card) return;
    var t = card.querySelector('[data-v="toggle"]'), m = card.querySelector('[data-v="sound"]'), playing = live.state === 1 || live.state === 3;
    if (t) { t.innerHTML = vi(playing ? "pause" : "play"); t.setAttribute("aria-label", playing ? "Pause" : "Play"); }
    if (m) { m.innerHTML = vi(live.muted ? "mute" : "snd"); m.setAttribute("aria-label", live.muted ? "Unmute" : "Mute"); }
  }
  // Connected to YouTube's own controls: a pause or play there (reported by the shim) brings our bar up too.
  if (MEDIA && MEDIA.onState) MEDIA.onState(function (live) {
    var prev = live._shown; live._shown = live.state;
    showState(live);
    var card = live.holder && live.holder.closest(".pn-mg-vid");
    if (card && (live.state === 1 || live.state === 2) && prev !== live.state) showCtl(card);
  });
  /* The glass controls sit on the video and fade out 3 s after they appear (they stay while the video is paused).
     They come up when a video starts, on any of our buttons, and when YouTube's own controls pause or play it. */
  function showCtl(card) {
    if (!card || !S) return;
    card.classList.add("ctlon");
    G.clearTimeout(S.ct);
    S.ct = G.setTimeout(function () { var l = MEDIA && MEDIA.current(); if (l && l.holder.closest(".pn-mg-vid") === card && l.state === 2) return; hideCtl(card); }, 3000);
  }
  function hideCtl(card) { if (card) card.classList.remove("ctlon"); if (S) G.clearTimeout(S.ct); }
  function setFull(card, on) {
    var box = H().root() && H().root().querySelector("#pnMgFeed");
    if (S.fs && S.fs !== card) S.fs.classList.remove("pn-mg-fs");
    S.fs = on ? card : null;
    if (card) card.classList.toggle("pn-mg-fs", !!on);
    if (box) { box.classList.toggle("pn-mg-fsbox", !!on); var body = box.closest(".pn-body"); if (body) body.classList.toggle("pn-mg-fsbody", !!on); }
    if (MEDIA && MEDIA.fit) { MEDIA.fit(); G.setTimeout(MEDIA.fit, 50); }   // the box changed size: resize the player to match
    var b = card && card.querySelector("[data-act=mg-fs]");
    if (b) { b.innerHTML = vi(on ? "exit" : "fs"); b.setAttribute("aria-label", on ? "Exit full screen" : "Full screen"); }
  }
  function subtitle() { return S.done ? S.right + " of " + S.done + " right" : "Swipe up for the next"; }
  function render(scrollTo) {
    var h = H();
    if (S.mode === "break") return renderBreak();
    var body;
    if (S.loading && !S.cards.length) body = '<p class="pn-load" role="status">Building your reel…</p>';
    else if (S.err && S.mode === "saved") body = '<p class="pn-load" role="status">Nothing saved yet. Tap Save on any card in PrepReels and it shows here.</p>';
    else if (S.err) body = '<p class="pn-err" role="alert">' + esc(G.PREP_BANK_MSG ? G.PREP_BANK_MSG("PrepReels needs a connection the first time. Try again online.") : "PrepReels needs a connection the first time. Try again online.") + '</p><button type="button" class="pn-btn pri" data-act="mg-retry">Try again</button>';
    else body = '<div class="vf pn-mg-feed" id="pnMgFeed" tabindex="-1" aria-label="PrepReels">' + S.cards.map(card).join("") +
      '<article class="vf-c vf-end pn-mg-c"><p class="vf-big">' + (S.done ? S.right + " of " + S.done + " right" : "End of this reel") + '</p><p class="pn-mut">' + S.cards.length + ' cards. Stop here or keep going.</p>' +
      (S.mode === "saved" ? "" : '<button type="button" class="pn-btn pri" data-act="mg-more"' + (S.loading ? " disabled" : "") + ">Keep going" + "</button>") + '<button type="button" class="pn-btn" data-act="mg-done">Finish</button></article></div>';
    h.paint(h.bar("PrepReels", subtitle(), "back") + '<div class="pn-body pv-feed pn-mg">' + modeTabs() + body + "</div>");
    var box = h.root() && h.root().querySelector("#pnMgFeed");
    if (!box) return;
    if (scrollTo >= 0) { var nx = box.querySelectorAll(".vf-c")[scrollTo]; if (nx) box.scrollTop = nx.offsetTop - box.offsetTop; }
    else box.scrollTop = S.top || 0;
    box.addEventListener("scroll", function () { if (!S) return; S.top = box.scrollTop; G.clearTimeout(S.vt); S.vt = G.setTimeout(syncVideo, 150); }, { passive: true });
    syncVideo();
  }
  /* A video autoplays in the app while its card holds the middle of the reel, and is removed when swiped away, so one
     plays at a time. Measured with getBoundingClientRect after scrolling settles (not IntersectionObserver, which did
     not fire for the reel box in the iPad WebView, 2026-11-17 recording). A tap on the poster also plays it. */
  function syncVideo() {
    if (!S || !MEDIA || S.fs || S.mode === "break") return;   // a full-screen video stays put while the reel underneath settles
    var box = H().root() && H().root().querySelector("#pnMgFeed");
    if (!box) return;
    var r = box.getBoundingClientRect(), mid = r.top + r.height / 2, on = null;
    [].some.call(box.querySelectorAll(".vf-c"), function (el) { var c = el.getBoundingClientRect(); if (c.top <= mid && c.bottom >= mid) { on = el; return true; } return false; });
    if (on && on.classList.contains("pn-mg-vid")) { var was = MEDIA.current(); playIn(on); if (!was || was !== MEDIA.current()) showCtl(on); } else MEDIA.release();
    if (on && on.classList.contains("pn-mg-les")) lesStart(on); else lesStop();
  }
  function playIn(el) {
    var holder = el && el.querySelector(".pn-mg-frame");
    if (holder) MEDIA.mount(holder, el.getAttribute("data-vid"), el.querySelector(".vf-stem").textContent);
  }
  function redraw(i) {
    var el = H().root().querySelector('#pnMgFeed .vf-c[data-i="' + i + '"]');
    if (el) el.outerHTML = card(S.cards[i], i);
    var sub = H().root().querySelector(".pn-bar .pn-t p"); if (sub) sub.textContent = subtitle();
  }

  function modeTabs() {
    var tabs = [];
    if (FLAGS.study) tabs.push(["study", "Study"]);
    if (FLAGS.discovery) tabs.push(["clinical", "Clinical"]);
    if (FLAGS.breakMode) tabs.push(["break", "Break"]);
    if (tabs.length < 2) return "";
    return '<div class="pn-mg-tabs" role="tablist" aria-label="PrepReels mode">' + tabs.map(function (t) {
      return '<button type="button" role="tab" class="pn-mg-tab' + (S.mode === t[0] ? " on" : "") + '" aria-selected="' + (S.mode === t[0]) + '" data-act="mg-mode" data-v="' + t[0] + '">' + t[1] + "</button>";
    }).join("") + "</div>";
  }
  function renderBreak() {
    var h = H();
    if (!S.brk) {
      return h.paint(h.bar("Smart Break", "Timed break", "back") + '<div class="pn-body pn-mg">' + modeTabs() + '<section class="pn-mg-card"><h2 class="pn-mg-h">Take a short break</h2><p class="pn-mg-sum">Choose 3 or 5 minutes. The timer is a guide, not a lock. You can return to study at any time.</p><div class="pn-mg-nav"><button type="button" class="pn-mg-btn pri" data-act="mg-break-start" data-v="3">3 minutes</button><button type="button" class="pn-mg-btn" data-act="mg-break-start" data-v="5">5 minutes</button></div></section><button type="button" class="pn-mg-btn" data-act="mg-mode" data-v="study">Return to Study</button></div>');
    }
    var st = DATA.breakState(S.brk, Date.now());
    var mm = Math.floor(st.remainingSec / 60), ss = String(st.remainingSec % 60); if (ss.length < 2) ss = "0" + ss;
    h.paint(h.bar("Smart Break", st.expired ? "Break finished" : "Break in progress", "back") + '<div class="pn-body pn-mg"><section class="pn-mg-card" aria-live="polite"><h2 class="pn-mg-h">' + (st.expired ? "Break finished" : mm + ":" + ss + " left") + '</h2><p class="pn-mg-sum">' + (st.expired ? "Return to study when you are ready. No penalty, no streak loss." : "Rest your eyes. Nothing is playing and nothing will autoplay.") + '</p></section><div class="pn-mg-nav"><button type="button" class="pn-mg-btn pri" data-act="mg-break-return">Return to study</button>' + (st.expired ? "" : '<button type="button" class="pn-mg-btn" data-act="mg-break-extend">Add 3 minutes</button>') + '</div></div>');
  }
  function tickBreak() { if (!S || !S.brk || S.mode !== "break") return stopBreakTimer(); if (DATA.breakState(S.brk, Date.now()).expired) stopBreakTimer(); renderBreak(); }
  function stopBreakTimer() { if (S && S.timer) { G.clearInterval(S.timer); S.timer = 0; } }
  function stopMedia() { if (S && S.fs) setFull(S.fs, false); if (MEDIA) MEDIA.release(); if (S) { G.clearTimeout(S.vt); G.clearTimeout(S.ct); lesStop(); } }
  function setMode(mode) { stopMedia(); stopBreakTimer(); S.brk = null; S.mode = mode; S.cards = []; S.seen = {}; S.top = 0; S.done = S.right = 0; if (mode === "break") return renderBreak(); load(); }

  function start(host, mode) {
    if (G.PrepPro && G.PrepPro.can && !G.PrepPro.can("questions", { items: [] })) { G.PrepPro.openLimit("questions"); return; }
    S = { host: host, mode: "study", cards: [], loading: false, err: false, done: 0, right: 0, top: 0, brk: null, timer: 0, vt: 0, seen: {}, shareI: -1, friends: null, first: true };
    if (mode === "clinical" && FLAGS.discovery) S.mode = "clinical";
    else if (!FLAGS.study && FLAGS.discovery) S.mode = "clinical";
    emit("session_started", { mode: S.mode });
    host.push(function () { render(); });
    if (mode === "saved") { S.mode = "saved"; return; }
    if (S.mode !== "break") load();
  }
  // The Saved reel: every saved card, rebuilt from its reference (newest first).
  function openSaved(host) {
    start(host, "saved");
    if (!S) return;
    S.cards = []; S.loading = true; render();
    var sv = st().mgsv || {}, refs = Object.keys(sv).map(function (k) { return sv[k]; }).sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    var s0 = S;
    Promise.all(refs.map(function (x) { return resolveRef(x.r); })).then(function (cards) {
      if (S !== s0) return;
      S.loading = false; S.cards = cards.filter(Boolean); S.err = !S.cards.length; render();
    });
  }
  function homeRowHtml(host) {
    var icon = (host && host.ico ? host.ico("play") : '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 5l12 7-12 7z"/></svg>');
    if (host && host.row) return host.row("mg-open", icon, "PrepReels", "Questions, videos and pearls, one swipe each");
    var chev = (host && host.ico ? host.ico("chev") : '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>');
    return '<button type="button" class="pn-row" data-act="mg-open"><span class="pn-ri" aria-hidden="true">' + icon + '</span><span class="pn-rb"><b>PrepReels</b><small>Questions, videos and pearls, one swipe each</small></span>' + chev + "</button>";
  }
  /* Home: one card under Solve next (owner 2026-11-17: the one swipe feed; Play's Swipe feed opens it too), with Saved
     beside it once anything is saved. Same .pn-next look as Solve next. */
  function homeHtml(host) {
    if (!FLAGS.study && !FLAGS.discovery && !FLAGS.breakMode) return "";
    var n = 0; try { n = Object.keys((host.store() || {}).mgsv || {}).length; } catch (e) {}
    var ico = host && host.ico ? host.ico : function () { return ""; };
    return '<div class="pn-mgh"><button type="button" class="pn-next" data-act="mg-open"><span class="pn-ri" aria-hidden="true">' + ico("play") +
      '</span><span class="pn-rb"><small>PrepReels</small><b>Questions, videos, images</b></span>' + ico("chev") + "</button>" +
      (n ? '<button type="button" class="pn-next pn-mgh-sv" data-act="mg-saved" aria-label="Saved from PrepReels, ' + n + (n === 1 ? " card" : " cards") + '"><span class="pn-ri" aria-hidden="true">' + ico("bm") + '</span><span class="pn-rb"><small>Saved</small><b>' + n + "</b></span></button>" : "") + "</div>";
  }

  function act(a, el, host) {
    if (a === "mg-open") return start(host, "study");
    if (a === "mg-saved") return openSaved(host);
    if (!S) return;
    var v = el && el.getAttribute("data-v"), i = el ? Number(el.getAttribute("data-i")) : -1, c = S.cards[i];
    if (a === "mg-answer") {
      if (!c || c.kind !== "q" || c.ans != null) return;
      var k = Number(el.getAttribute("data-k")), ok = k === c.it.a;
      c.ans = k; S.done++; if (ok) S.right++;
      try { host.record(c.it, k, { ms: 0 }); } catch (e) {}   // FSRS + stats, exactly as the runner and Play feed do
      emit("mcq_answered", { correct: ok });
      try { if (G.SMD_HAPTICS) G.SMD_HAPTICS[ok ? "success" : "warning"](); } catch (e) {}
      return redraw(i);
    }
    if (a === "mg-next") {
      var box = host.root().querySelector("#pnMgFeed"), nx = box && box.querySelectorAll(".vf-c")[i + 1];
      if (nx) box.scrollTo({ top: nx.offsetTop - box.offsetTop, behavior: G.matchMedia && G.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      return;
    }
    if (a === "mg-like" && c) {
      var s = host.store(), r = refOf(c), lk = refKey(r) || ("x:" + keyOf(c));
      s.mglk = s.mglk || {};
      if (s.mglk[lk]) { delete s.mglk[lk]; host.save(); return redrawActs(i); }
      s.mglk[lk] = Date.now();
      var t = topicOf(c);
      if (t && t.s && t.m) { s.mgtop = (s.mgtop || []).filter(function (x) { return !(x.s === t.s && x.m === t.m); }).concat([{ s: t.s, m: t.m }]).slice(-20); }
      host.save(); redrawActs(i);
      try { if (G.SMD_HAPTICS) G.SMD_HAPTICS.light(); } catch (e) {}
      return moreLike(i);
    }
    if (a === "mg-save" && c) {
      var s2 = host.store(), r2 = refOf(c), k2 = refKey(r2);
      if (!r2) return;
      s2.mgsv = s2.mgsv || {};
      var on = !s2.mgsv[k2];
      if (on) s2.mgsv[k2] = { r: r2, at: Date.now() }; else delete s2.mgsv[k2];
      if (c.kind === "q") { s2.bm = s2.bm || {}; if (on) s2.bm[c.it.id] = [c.it._s, c.it._m || "", Date.now()]; else delete s2.bm[c.it.id]; }   // PrepNucleus Bookmarks, same format as prep.js bmToggle
      host.save(); redrawActs(i);
      try { host.toast(on ? (c.kind === "q" ? "Saved to Bookmarks and your Saved reel" : "Saved to your Saved reel") : "Removed from saved"); } catch (e) {}
      return;
    }
    if (a === "mg-share" && c) { var prev = S.shareI; S.shareI = prev === i ? -1 : i; if (prev >= 0 && prev !== i) redrawActs(prev); if (S.shareI === i && refOf(c) && !S.friends) return loadFriends(i); return redrawActs(i); }
    if (a === "mg-sh-wa" && c) { openUrl("https://wa.me/?text=" + encodeURIComponent(shareText(c))); return; }
    if (a === "mg-sh-more" && c) { nativeShare(shareText(c)).catch(function () { try { host.toast("Sharing is not available here"); } catch (e) {} }); return; }
    if (a === "mg-sh-add") { if (G.PrepSocial && G.PrepSocial.open) { stopMedia(); G.PrepSocial.open("friends"); } return; }
    if (a === "mg-sh-fr" && c) {
      var P = social(), ref = refOf(c);
      if (!P || !ref) return;
      el.disabled = true;
      P.api("POST", "share", { smdId: v, ref: ref }).then(function () { try { host.toast("Sent to " + el.textContent); } catch (e) {} if (S) { S.shareI = -1; redrawActs(i); } }, function (e) { el.disabled = false; try { host.toast(socialErr(e)); } catch (x) {} });
      return;
    }
    if (a === "mg-ctl") return showCtl(el.closest(".pn-mg-vid"));   // a tap on the (hidden) bar area brings it back
    if (a === "mg-les-tap" || a === "mg-les") {
      if (!c || c.kind !== "lesson") return;
      if (a === "mg-les") {   // Listen: narration reads each step and moves on when it ends
        c.listen = !c.listen; c.playing = true;
        if (c.listen) { try { if (G.SMD_SPEAK) G.SMD_SPEAK.unlock(); } catch (e) {} } else hush();   // unlock inside the tap (iOS audio)
        if (S.les !== i) { lesStart(el.closest(".vf-c")); return; }
        return lesRun(i);
      }
      if (!c.les) return lesStart(el.closest(".vf-c"));
      var r = el.getBoundingClientRect(), x = (TAPX != null ? TAPX : r.left + r.width / 2) - r.left;
      if (c.step >= c.les.steps.length) c.step = 0;
      else if (x < r.width / 3) c.step = Math.max(0, c.step - 1);
      else if (x > r.width * 2 / 3) c.step = Math.min(c.les.steps.length, c.step + 1);
      else c.playing = !c.playing;
      if (!c.playing) { G.clearTimeout(S.lt); hush(); return lesDraw(i); }
      S.les = i; return lesRun(i);
    }
    if (a === "mg-play") {
      var vc = el.closest(".pn-mg-vid"), cur = MEDIA && MEDIA.current();
      if (!cur || cur.holder.closest(".pn-mg-vid") !== vc) { playIn(vc); return showCtl(vc); }
      return vc.classList.contains("ctlon") ? hideCtl(vc) : showCtl(vc);
    }
    if (a === "mg-v" || a === "mg-fs") {
      var card = el.closest(".pn-mg-vid"), live = MEDIA && MEDIA.current();
      if (!live || live.holder.closest(".pn-mg-vid") !== card) { playIn(card); live = MEDIA && MEDIA.current(); }   // a control on a card not yet playing starts it
      if (a === "mg-fs") { setFull(card, !card.classList.contains("pn-mg-fs")); return showCtl(card); }
      if (v === "back" || v === "fwd") MEDIA.command("seek", v === "back" ? -10 : 10);
      else if (v === "toggle") MEDIA.command(live && (live.state === 1 || live.state === 3) ? "pause" : "play");
      else if (v === "sound") MEDIA.command(live && live.muted ? "unmute" : "mute");
      return showCtl(card);
    }
    if (a === "mg-lib-art") { if (c && c.e && c.e.ka && G.SMD_KB && G.SMD_KB.open) { stopMedia(); G.SMD_KB.open(c.e.ka); } return; }
    if (a === "mg-lib-les") { if (c && c.e && c.e.ls && G.PREP_LESSONS) { stopMedia(); S.les = null; G.PREP_LESSONS.open(c.e.lsj, c.e.lm, host, c.e.ls); } return; }
    if (a === "mg-reveal") { if (c) { c.shown = true; redraw(i); } return; }
    if (a === "mg-lesson") { if (c && G.PREP_LESSONS) { stopMedia(); S.les = null; emit("lesson_completed", {}); G.PREP_LESSONS.open(c.sid, c.mid, host); } return; }
    if (a === "mg-understand") {
      if (c && G.PREP_ASK && G.PREP_ASK.open) { stopMedia(); try { G.PREP_ASK.open({ kind: "card", title: firstSentence(c.it.q).slice(0, 80), ask: "Explain this question and its answer in plain language with one analogy.", fr: c.it.q + "\n" + c.it.o.map(function (o, k) { return L[k] + ". " + o; }).join("\n"), bk: "Answer: " + L[c.it.a] + ". " + c.it.o[c.it.a] + "\n" + String(c.it.exp || (c.it.x && c.it.x.key) || "") }, host); } catch (e) {} }
      emit("understand_requested", {}); return;
    }
    if (a === "mg-more") { if (!S.loading) { el.disabled = true; stopMedia(); load(true); } return; }
    if (a === "mg-retry") return load();
    if (a === "mg-mode") return setMode(v || "study");
    if (a === "mg-done") { emit("session_finished", { answered: S.done, correct: S.right }); stopMedia(); stopBreakTimer(); S = null; return host.back(); }
    if (a === "mg-break-start") { S.brk = DATA.createBreak(Number(v)); emit("break_started", { minutes: S.brk.durationMin }); stopBreakTimer(); S.timer = G.setInterval(tickBreak, 1000); return renderBreak(); }
    if (a === "mg-break-extend") { S.brk = DATA.extendBreak(S.brk, 3); stopBreakTimer(); S.timer = G.setInterval(tickBreak, 1000); return renderBreak(); }
    if (a === "mg-break-return") { emit("break_returned", {}); return setMode("study"); }
  }
  function back() { if (S && S.fs) { setFull(S.fs, false); return true; } stopMedia(); return false; }
  function leave() { stopMedia(); stopBreakTimer(); S = null; }

  G.PREP_MEDIGRAM = { open: start, act: act, back: back, leave: leave, homeHtml: homeHtml, homeRow: homeRowHtml, _flags: FLAGS, _s: function () { return S; } };
})(typeof window !== "undefined" ? window : this);
