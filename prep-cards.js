/* PrepNucleus Layer C: flashcards from a deck's facts. window.PREP_CARDS. ES5.
   Contract: vault/plans/PrepNucleus-LayerC.md 6.5. A card is { id, fid, front (the fact's question), back (the fact),
   src, prov, deckId }. The view shows the front, reveals the back with its section heading, and grades with two
   buttons: "I knew it" (Good) and "I did not" (Again), the engine's gradeFor. FSRS memory lives in the PrepNucleus
   store (host.store()) under deck key "p:cards-<deckId>", apart from the deck's questions ("p:deck-<deckId>").
   The queue is due cards first (least remembered first), then up to 10 new ones, 20 in all. No AI here.
   Opened by prep-create.js (PREP_C forwards every data-act starting "c-k"). Pure helpers load under node for tests. */
(function (G) {
  "use strict";

  /* ================= pure ================= */
  var SIZE = 20, NEW = 10;
  function cardDeckKey(deckId) { return "p:cards-" + deckId; }
  // Due cards first, then new ones; C is specialty-core.js.
  function dueQueue(cards, store, today, C, opts) {
    opts = opts || {};
    return C.buildSession({ id: cardDeckKey(opts.deckId || (cards[0] && cards[0].deckId) || ""), items: cards || [] }, store, today,
      { size: opts.size || SIZE, newCap: opts.all ? opts.size || SIZE : NEW, rnd: opts.rnd });
  }
  function counts(cards, store, today, C) { return C.counts({ id: cardDeckKey((cards[0] && cards[0].deckId) || ""), items: cards || [] }, store, today); }
  function grade(store, C, card, knew, today) { return C.review(store, cardDeckKey(card.deckId), card.id, C.gradeFor(!!knew), today); }
  // Where the fact came from: the section heading. No page numbers on screen (owner rule, 2026-09-24: emoji-icons.js
  // strips page locators from the rendered page); src.p stays stored for "View source".
  function srcLine(card) { var s = card && card.src; return s && s.h ? "From your source: " + s.h : ""; }
  function nextDueText(store, cards, today) {
    var min = null;
    (cards || []).forEach(function (c) { var v = store.cards[cardDeckKey(c.deckId) + ":" + c.id]; if (v && v[3] > today && (min == null || v[3] < min)) min = v[3]; });
    if (min == null) return "";
    var d = min - today;
    return d <= 1 ? "Next cards are due tomorrow." : "Next cards are due in " + d + " days.";
  }
  var PURE = { SIZE: SIZE, NEW: NEW, cardDeckKey: cardDeckKey, dueQueue: dueQueue, counts: counts, grade: grade, srcLine: srcLine, nextDueText: nextDueText };
  if (typeof module !== "undefined" && module.exports && !(G && G.document)) { module.exports = PURE; return; }

  /* ================= browser ================= */
  var ss = null;   // { deck, cards, list, i, shown, knew, missed }

  function begin(host, all) {
    var C = host.core();
    ss.list = dueQueue(ss.cards, host.store(), host.today(), C, { deckId: ss.deck.id, all: all });
    ss.i = 0; ss.shown = false; ss.knew = 0; ss.missed = 0;
  }
  function render(host) {
    if (!ss) return host.back();
    var esc = host.esc, title = esc(ss.deck.title);
    if (!ss.list.length) {
      var n = counts(ss.cards, host.store(), host.today(), host.core());
      return host.paint(host.bar("Flashcards", title, "back") + '<div class="pn-body" id="pcCardsView"><p class="pn-empty">No cards are due. ' + esc(nextDueText(host.store(), ss.cards, host.today())) + "</p>" +
        '<p class="pn-mut pn-small">' + n.total + " cards · " + n.seen + " studied</p>" +
        '<button type="button" class="pn-btn pri" data-act="c-kall">Study ' + Math.min(SIZE, ss.cards.length) + " cards anyway</button></div>");
    }
    if (ss.i >= ss.list.length) {
      return host.paint(host.bar("Cards done", title, "back") + '<div class="pn-body" id="pcCardsView"><section class="pn-panel pn-score" tabindex="-1" id="pcCardsEnd">' +
        '<p class="pn-big">' + ss.knew + " / " + ss.list.length + '</p><p class="pn-mut">you knew</p></section>' +
        '<p class="pn-mut pn-small">Cards you did not know come back tomorrow; the ones you knew come back just before you would forget them. ' + esc(nextDueText(host.store(), ss.cards, host.today())) + "</p>" +
        '<div class="pn-navrow"><button type="button" class="pn-btn" data-act="c-kagain">Study again</button><button type="button" class="pn-btn pri" data-act="c-kdone">Done</button></div></div>', "#pcCardsEnd");
    }
    var c = ss.list[ss.i];
    host.paint(host.bar("Flashcards", "Card " + (ss.i + 1) + " of " + ss.list.length, "back") + '<div class="pn-body" id="pcCardsView">' +
      '<section class="pn-panel pc-card" aria-label="Card ' + (ss.i + 1) + '"><p class="pc-front">' + esc(c.front) + "</p>" +
      (ss.shown ? '<div class="pc-back" id="pcBack" tabindex="-1"><p>' + esc(c.back) + "</p></div>" : "") + "</section>" +
      (ss.shown ? '<div class="pn-navrow"><button type="button" class="pn-btn" data-act="c-kno">I did not</button><button type="button" class="pn-btn pri" data-act="c-kyes">I knew it</button></div>' :
        '<button type="button" class="pn-btn pri" data-act="c-kflip" id="pcFlip">Show answer</button>') +
      '<p class="pn-mut pn-small">' + esc(title) + "</p></div>", ss.shown ? "#pcBack" : "#pcFlip");
  }
  function mark(host, knew) {
    if (!ss || !ss.shown) return;
    var c = ss.list[ss.i];
    grade(host.store(), host.core(), c, knew, host.today());
    host.save();
    if (knew) ss.knew++; else ss.missed++;
    ss.i++; ss.shown = false;
    render(host);
  }
  function start(host, deck, cards) {
    ss = { deck: deck, cards: (cards || []).filter(function (c) { return c && c.front && c.back; }) };
    begin(host, false);
    host.push(function () { render(host); });
  }
  function act(a, el, host) {
    if (!ss) return;
    if (a === "c-kflip") { ss.shown = true; return render(host); }
    if (a === "c-kyes") return mark(host, true);
    if (a === "c-kno") return mark(host, false);
    if (a === "c-kall") { begin(host, true); return render(host); }
    if (a === "c-kagain") { begin(host, true); return render(host); }
    if (a === "c-kdone") { ss = null; return host.back(); }
  }
  G.PREP_CARDS = { start: start, act: act, _pure: PURE, _ss: function () { return ss; } };
})(typeof window !== "undefined" ? window : this);
