// PrepNucleus Pro (prep-pro.js) pure gates: flag off/on, daily counters and reset, open modules, Pro, never mid-set,
// and the honest price rendering rules (quote-only percent, list price strike only when below, real expiry, cancel line).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const P = createRequire(import.meta.url)("../prep-pro.js");

const TAX = { branches: [{ id: "mbbs", subjects: [
  { id: "anatomy", sections: [{ id: "a1", modules: [{ id: "an-1" }] }, { id: "a2", modules: [{ id: "an-2" }, { id: "an-3" }] }] },
  { id: "physiology", sections: [{ id: "p1", modules: [{ id: "ph-1" }, { id: "ph-2" }, { id: "ph-3" }] }] }] }] };
const OPEN = P.openSet(TAX, 2);
const it = (m, s = "x") => ({ id: m + "-q", _m: m, _s: s });
const st = (o) => Object.assign({ enforce: true, pro: false, open: OPEN, day: "2026-10-06", counts: null }, o);

test("open modules: first 2 of each subject in taxonomy order, deterministic", () => {
  assert.deepEqual(Object.keys(OPEN), ["an-1", "an-2", "ph-1", "ph-2"]);
  assert.deepEqual(P.openSet(TAX, 2), OPEN);
  assert.deepEqual(Object.keys(P.openSet(TAX, 1)), ["an-1", "ph-1"]);
});

test("flag off: every gate passes, whatever the counts", () => {
  const counts = { d: "2026-10-06", questions: 999, cards: 999, lessons: { a: 1, b: 1 } };
  for (const f of ["questions", "lessons", "cards"]) assert.equal(P.gate(f, { items: [it("an-3")], module: "an-3" }, st({ enforce: false, counts })), true);
});

test("flag on: 50 questions, 1 lesson, 10 cards a day outside open modules", () => {
  let s = st();
  for (let i = 0; i < 49; i++) s.counts = P.count("questions", { items: [it("an-3")] }, s);
  assert.equal(P.gate("questions", { items: [it("an-3")] }, s), true);
  s.counts = P.count("questions", { items: [it("an-3")] }, s);
  assert.equal(s.counts.questions, 50);
  assert.equal(P.gate("questions", { items: [it("an-3")] }, s), false);
  // lessons: one a day, reopening the same one is free
  s.counts = P.count("lessons", { module: "an-3" }, s);
  assert.equal(P.gate("lessons", { module: "an-3" }, s), true);
  assert.equal(P.gate("lessons", { module: "ph-3" }, s), false);
  for (let i = 0; i < 10; i++) s.counts = P.count("cards", { module: "ph-3" }, s);
  assert.equal(P.gate("cards", { module: "ph-3" }, s), false);
  assert.equal(P.gate("cards", null, s), false);   // the due queue spans modules: the counter decides
});

test("open modules and own decks stay free and are not counted", () => {
  const s = st({ counts: { d: "2026-10-06", questions: 50, cards: 10, lessons: { z: 1 } } });
  assert.equal(P.gate("questions", { items: [it("an-1"), it("ph-2")] }, s), true);
  assert.equal(P.gate("questions", { items: [it("an-1"), it("an-3")] }, s), false);   // a mixed set counts
  assert.equal(P.gate("questions", { items: [it("deck-1", "deck")] }, s), true);
  assert.equal(P.gate("lessons", { module: "an-2" }, s), true);
  assert.equal(P.gate("cards", { module: "ph-1" }, s), true);
  assert.equal(P.count("questions", { items: [it("an-1"), it("deck-1", "deck")] }, s).questions, 50);
  assert.equal(P.gate("sprint", null, s), true);
});

test("counters reset on a new local day", () => {
  const s = st({ day: "2026-10-07", counts: { d: "2026-10-06", questions: 50, cards: 10, lessons: { a: 1 } } });
  assert.equal(P.gate("questions", { items: [it("an-3")] }, s), true);
  assert.equal(P.gate("lessons", { module: "ph-3" }, s), true);
  assert.equal(P.count("questions", { items: [it("an-3")] }, s).questions, 1);
  assert.equal(P.dayKey(new Date(2026, 9, 6, 23, 59).getTime()), "2026-10-06");
  assert.equal(P.dayKey(new Date(2026, 9, 7, 0, 1).getTime()), "2026-10-07");
});

test("Pro unlocks all", () => {
  const s = st({ pro: true, counts: { d: "2026-10-06", questions: 500, cards: 500, lessons: { a: 1, b: 1 } } });
  for (const f of ["questions", "lessons", "cards"]) assert.equal(P.gate(f, { items: [it("an-3")], module: "ph-3" }, s), true);
});

test("never mid-set: a set started under the limit counts every answer and nothing re-checks it", () => {
  let s = st({ counts: { d: "2026-10-06", questions: 49, cards: 0, lessons: {} } });
  const set = Array.from({ length: 20 }, () => it("an-3"));
  assert.equal(P.gate("questions", { items: set }, s), true);   // checked once at the start
  set.forEach((q) => { s.counts = P.count("questions", { items: [q] }, s); });   // use() only counts
  assert.equal(s.counts.questions, 69);
  assert.equal(P.gate("questions", { items: set }, s), false);   // the NEXT set is stopped
});

test("price view: launch, intro, student, list price; percent only from the quote", () => {
  const launch = P.quoteView({ listPaise: 599900, firstYearPaise: 149900, renewalPaise: 599900, priceReason: "launch", offPct: 75, launchEndsAt: new Date(2027, 2, 31, 12).getTime() });
  assert.equal(launch.price, "Rs 1,499"); assert.equal(launch.strike, "Rs 5,999"); assert.equal(launch.reason, "Launch price until 31 Mar 2027");
  assert.equal(launch.off, "75% off Rs 5,999, then Rs 5,999/year");
  const noPct = P.quoteView({ listPaise: 599900, firstYearPaise: 119900, priceReason: "student" });
  assert.equal(noPct.reason, "Student price"); assert.doesNotMatch(noPct.off, /%/);
  const list = P.quoteView({ listPaise: 599900, firstYearPaise: 599900, priceReason: "base" });
  assert.equal(list.strike, ""); assert.equal(list.off, ""); assert.equal(list.reason, ""); assert.equal(list.per, "a year");
  const ren = P.quoteView({ listPaise: 599900, firstYearPaise: 599900, renewalPaise: 599900, priceReason: "renewal" });
  assert.equal(ren.strike + ren.off + ren.reason, "");
  const none = P.quoteView(null);
  assert.equal(none.price, "Rs 5,999"); assert.equal(none.strike, "");
  assert.equal(P.rs(12345600), "Rs 1,23,456");
});

test("offer: nothing without one; real static expiry; quote percent", () => {
  assert.equal(P.offerText(null), null);
  const exp = new Date(2026, 9, 8, 16, 30).getTime();
  const o = P.offerText({ kind: "winback", finalPaise: 99900, listPaise: 599900, offPct: 83, saveRupees: 5000, expiresAt: exp });
  assert.equal(o.line, "Rs 999 for your first year (then Rs 5,999 a year). One time offer, valid until Thu 8 Oct, 4:30 pm.");
  assert.equal(o.off, "83% off Rs 5,999"); assert.equal(o.save, "Save Rs 5,000");
  assert.equal(P.offerText({ finalPaise: 99900, basePaise: 149900, listPaise: 599900, saveRupees: 500, expiresAt: exp }).save, "Save Rs 500 on Rs 1,499", "saving names its baseline");
  assert.equal(P.offerText({ finalPaise: 99900, basePaise: 149900, expiresAt: exp }).off, "");
  assert.equal(P.offerText({ finalPaise: 99900, basePaise: 149900, listPaise: 599900, expiresAt: exp }).off, "83% off Rs 5,999");   // vs list when no offPct
});

test("cancel line: store manage link, truthful one-time text", () => {
  assert.equal(P.cancelView({ autoRenews: false, source: "razorpay" }).kind, "none");
  const st2 = P.cancelView({ autoRenews: true, source: "apple", manageUrl: "https://apps.apple.com/account/subscriptions" });
  assert.equal(st2.kind, "store"); assert.match(st2.url, /^https:/);
  assert.equal(P.cancelView({ autoRenews: false }).text, "Cancel anytime: no auto-renewal, you choose whether to renew.");
});

test("no em-dash in app text", async () => {
  const fs = await import("node:fs");
  assert.doesNotMatch(fs.readFileSync(new URL("../prep-pro.js", import.meta.url), "utf8"), /—/);
});

test("store path (iOS IAP): the price the store charges, never a student or win-back price, no web steering", () => {
  const L = new Date(2027, 2, 31, 12).getTime();
  const stu = { listPaise: 599900, firstYearPaise: 479920, storeFirstYearPaise: 599900, renewalPaise: 599900, priceReason: "student", offPct: 20, firstYear: true };
  assert.equal(P.quoteView(stu, false).price, "Rs 4,799");
  const v = P.quoteView(stu, true);
  assert.equal(v.price, "Rs 5,999"); assert.equal(v.strike + v.off + v.reason, ""); assert.equal(v.per, "a year");
  // win-back during launch: the store's intro (launch) price, labelled, no win-back percent
  const wb = P.quoteView({ listPaise: 599900, firstYearPaise: 99900, storeFirstYearPaise: 149900, renewalPaise: 599900, priceReason: "winback", offPct: 83, launchEndsAt: L, firstYear: true }, true);
  assert.equal(wb.price, "Rs 1,499"); assert.equal(wb.strike, "Rs 5,999"); assert.equal(wb.reason, "Launch price until 31 Mar 2027"); assert.equal(wb.off, "Then Rs 5,999/year");
  // student renewal: the store charges list
  assert.equal(P.quoteView({ listPaise: 599900, firstYearPaise: 479920, storeFirstYearPaise: 599900, priceReason: "student", firstYear: false }, true).price, "Rs 5,999");
  // older server without storeFirstYearPaise: list, never the lower price
  assert.equal(P.quoteView({ listPaise: 599900, firstYearPaise: 99900, priceReason: "winback" }, true).price, "Rs 5,999");
  const launch = P.quoteView({ listPaise: 599900, firstYearPaise: 149900, priceReason: "launch", offPct: 75 }, true);
  assert.equal(launch.price, "Rs 1,499");
  for (const x of [v, wb, launch]) assert.doesNotMatch(JSON.stringify(x), /website|web|stewardmd\.in/i);
});

test("student line only when the student price beats the current first-year price, never on the store path", () => {
  const launchQ = { firstYearPaise: 149900, studentPaise: 479920, studentVerified: false };
  assert.equal(P.studentOffer(launchQ, false), false, "Rs 4,799 student loses to Rs 1,499 launch");
  const after = { firstYearPaise: 599900, studentPaise: 479920, studentVerified: false };
  assert.equal(P.studentOffer(after, false), true);
  assert.equal(P.studentOffer(after, true), false);
  assert.equal(P.studentOffer({ ...after, studentVerified: true }, false), false);
  assert.equal(P.studentOffer(null, false), false);
  assert.equal(P.studentOffer({ firstYearPaise: 599900 }, false), false, "no studentPaise from the server: hidden");
});

test("cancel line before buying matches the checkout path", () => {
  assert.equal(P.buyCancelView(false).text, "Cancel anytime: no auto-renewal, you choose whether to renew.");
  const s = P.buyCancelView(true);
  assert.equal(s.kind, "store"); assert.equal(s.url, "https://apps.apple.com/account/subscriptions");
});
