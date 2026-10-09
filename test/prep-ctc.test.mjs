/* PrepNucleus CTC (tools/prep-ctc.mjs): a scanned review book -> units for the radmax MCQ pipeline, the radbook lesson
 * pipeline under the book's own profile, and the private ship tree. Synthetic pages only (no book text in the repo).
 * node --test --experimental-test-module-mocks --experimental-sqlite test/prep-ctc.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import * as C from "../tools/prep-ctc.mjs";
import * as RB from "../tools/prep-radbook.mjs";
import { gates, setBan, RAD_MODULES, SRD_MODULES } from "../tools/prep-radmax.mjs";

const filler = (n) => Array.from({ length: n }, (_, i) => "Finding " + i + " is described with plain words on this page.").join(" ");
const pages = (from, to, chars) => Array.from({ length: to - from + 1 }, (_, k) => ({ p: from + k, t: filler(Math.ceil(chars / 52)) }));

test("chapters: ordered, non-overlapping, modules exist in their bank", () => {
  let last = 0;
  for (const c of C.CTC_CHAPTERS) {
    assert.ok(c.pages[0] > last && c.pages[1] >= c.pages[0], c.id);
    last = c.pages[1];
    for (const k of ["rad", "srd"]) if (c[k]) for (const m of c[k].match(/\b(?:rad|srd)-[a-z-]+[a-z]/g)) assert.ok((k === "rad" ? RAD_MODULES : SRD_MODULES).includes(m), c.id + " " + m);
    for (const m of c.lmods || []) assert.ok(RAD_MODULES.concat(SRD_MODULES).includes(m), c.id + " " + m);
  }
  assert.equal(C.chapterOf(600), null, "study-strategy pages belong to no chapter");
  assert.equal(C.chapterOf(450).id, "breast");
});

test("textUnits: two banks per window, thin areas page by page, gyn pages rad only, blank pages skipped", () => {
  const ps = pages(1, 1143, 1800); ps[4].t = "short";
  const { units, skipped } = C.textUnits(ps);
  const msk = units.filter((u) => u.chapter === "msk");
  assert.ok(msk.every((u) => u.pages.length <= 2) && msk.some((u) => u.pages.length === 2));
  assert.ok(units.filter((u) => u.chapter === "breast").every((u) => u.pages.length === 1), "thin area: one page a window");
  assert.ok(units.filter((u) => u.chapter === "gyn-obs").every((u) => u.bank === "rad"), "no NEET-SS gynaecology module");
  assert.ok(skipped.some((s) => s.p === 5) && skipped.some((s) => s.p === 600));
  for (const u of units) { assert.ok(u.want.length >= 1 && u.want.length <= 4); assert.ok(["rad", "srd"].includes(u.bank)); assert.equal(u.src, "ctc"); }
  const lv = (b) => units.filter((u) => u.bank === b).flatMap((u) => u.want.map((w) => w.dif));
  const share = (b, d) => lv(b).filter((x) => x === d).length / lv(b).length;
  assert.ok(share("srd", "Very Hard") > share("rad", "Very Hard") && share("rad", "Easy") > share("srd", "Easy"), "NEET-SS leans hard, NEET-PG leans easy");
  for (const b of ["rad", "srd"]) for (const d of ["Easy", "Moderate", "Hard", "Very Hard"]) assert.ok(share(b, d) > 0, b + " " + d);
});

test("imgOk / imageUnits: only clear radiological images; identifiers only when blurred; at most 3 a page", () => {
  const q = { kind: "ct", medical: true, clear: true, match: "yes", third: "", ident: false, shows: "Axial CT of the abdomen" };
  assert.ok(C.imgOk(q));
  assert.ok(!C.imgOk({ ...q, kind: "drawing" }) && !C.imgOk({ ...q, clear: false }) && !C.imgOk({ ...q, third: "logo" }) && !C.imgOk({ ...q, match: "no" }));
  assert.ok(!C.imgOk({ ...q, ident: true }) && C.imgOk({ ...q, ident: true }, "/blurred.webp"));
  const figs = [1, 2, 3, 4].map((k) => ({ id: "ctc-p0450-" + k, page: 450, file: "/f" + k + ".webp", near: "label" })).concat([{ id: "ctc-p0980-1", page: 980, file: "/g.webp", near: "" }]);
  const qa = new Map(figs.map((f) => [f.id, q]));
  const u = C.imageUnits(figs, pages(450, 450, 900).concat(pages(980, 980, 900)), qa, { "ctc-p0450-2": "/b.webp" });
  assert.equal(u.filter((x) => x.pages[0] === 450).length, 3);
  assert.equal(u.find((x) => x.fig.id === "ctc-p0450-2").fig.file, "/b.webp", "the blurred copy is what the writer sees");
  assert.equal(u.find((x) => x.fig.id === "ctc-p0980-1").bank, "rad");
  assert.ok(u.every((x) => x.kind === "img" && x.want[0].fmt === "image" && x.shows));
});

test("radmax gates: a source's private names (setBan) and banter never reach an item", () => {
  const unit = { src: "ctc", bank: "srd", segs: [{ id: "1.1", tx: "Lipoma arborescens shows frond like fatty synovial proliferation with effusion in the knee." }], header: "" };
  const base = { fmt: "recognition", dif: "Easy", mod: "srd-msk-joint", q: "Which lesion shows frond like fatty synovial proliferation?", o: ["Lipoma arborescens", "Synovial sarcoma", "Gout tophus", "Haemophilic arthropathy"], a: 0,
    ky: "Lipoma arborescens is fatty frond like synovium.", others: { B: "Soft tissue mass.", C: "Urate.", D: "Haemosiderin." }, clue: "Fatty fronds", lp: "Think fat in synovium", nt: "## Look\n- " + "fatty fronds of synovium seen with joint effusion on imaging ".repeat(8).trim(), ev: ["1.1"] };
  const g0 = gates({ ...base }, unit);
  assert.ok(!g0.some((x) => /names a source|profane/.test(x)), g0.join("; "));
  setBan(["Doctor Example", "Example Review"]);
  assert.ok(gates({ ...base, lp: "As Doctor Example says, fat" }, unit).some((x) => /names a source/.test(x)));
  assert.ok(gates({ ...base, lp: "from example review notes" }, unit).some((x) => /names a source/.test(x)));
  setBan([]);
  assert.ok(gates({ ...base, clue: "This one sucks" }, unit).some((x) => /profane/.test(x)));
});

test("book profile: CTC lessons get their own set and key prefix; upload refuses while on hold", async () => {
  const b = RB.useBook(C.CTC_BOOK);
  assert.equal(b.set, "ctcbook");
  assert.match(RB.lessonKey({ order: 15, seq: 20, title: "Lipoma arborescens of the knee" }), /^ctcbook-150020-/);
  assert.deepEqual(RB.mergeIndex({ modules: { a: { set: "radnotes" } } }, []).modules, { a: { set: "radnotes" } }, "no live set is dropped");
  await assert.rejects(() => RB.main(["upload", "--dir", "/nonexistent"]), /HOLD/);
  RB.useBook(RB.BOOKS.radbook);
  assert.match(RB.lessonKey({ order: 1, seq: 0, title: "Plain film" }), /^radbook-/);
});

test("mergeShip: live files kept, new items appended with bank image paths, Very Hard marked, live ids never reused", () => {
  const it = (id, lvl, img) => ({ id, q: "q", o: ["a", "b", "c", "d"], a: 0, meta: { lvl }, ...(img ? { img: [img] } : {}) });
  const liveBank = { "srd-breast": [it("rm-1", "Hard")] }, liveOv = { "rad-chest": [it("rm-2", "Easy", "rm-r11-x.webp")] };
  const add = { srd: { "srd-breast": [it("ct-a", "Very Hard", "img/rm-ctc-p0450-1.webp")] }, rad: { "rad-chest": [it("ct-b", "Easy")], "rad-gi": [it("ct-c", "Moderate", "rm-ctc-p0840-1.webp")] } };
  const r = C.mergeShip({ liveBank, liveOv, add, bank: "v10", set: "radmax3" });
  assert.deepEqual(r.mcq["srd-breast"].map((i) => i.id), ["rm-1", "ct-a"]);
  assert.deepEqual(r.mcq["srd-breast"][1].img, ["v10/ss-radiology/img/rm-ctc-p0450-1.webp"]);
  assert.equal(r.mcq["srd-breast"][1].vh, true);
  assert.deepEqual(r.ov["rad-chest"][0].img, ["img/radmax/rm-r11-x.webp"]);
  assert.deepEqual(r.ov["rad-gi"][0].img, ["img/radmax/rm-ctc-p0840-1.webp"]);
  assert.ok(Object.values(r.ov).flat().every((i) => i.set === "radmax3"));
  assert.equal(r.imgs.length, 2);
  assert.throws(() => C.mergeShip({ liveBank, liveOv, add: { srd: { "srd-breast": [it("rm-1", "Easy")] } }, bank: "v10", set: "radmax3" }), /already live/);
  assert.throws(() => C.mergeShip({ liveBank, liveOv, add: { srd: { "srd-ir": [it("ct-z", "Easy")] } }, bank: "v10", set: "radmax3" }), /no live bank file/);
});
