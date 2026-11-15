/* Study Studio pure helpers (study.js): flag rule, page-relative maths, eraser hit test, undo/redo stacks, pressure.
 * The IndexedDB stroke store is covered end to end by test/run-study-ui.mjs (no fake-indexeddb dependency here).
 * node --test --experimental-test-module-mocks --experimental-sqlite test/study.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const S = createRequire(import.meta.url)("../study.js");

test("flag: default off, needs prep, ?study overrides storage", () => {
  const ls = (v) => (k) => (k === "smd_study" ? v : null);
  assert.equal(S.enabled("", ls(null), true), false);
  assert.equal(S.enabled("", ls("1"), true), true);
  assert.equal(S.enabled("", ls("1"), false), false);
  assert.equal(S.enabled("?study=1", ls(null), true), true);
  assert.equal(S.enabled("?prep=1&study=0", ls("1"), true), false);
});

test("page-relative transform round trips at any zoom", () => {
  const r = { left: 10, top: 20, width: 200, height: 400 };
  const [x, y] = S.toRel(110, 220, r);
  assert.deepEqual([x, y], [0.5, 0.5]);
  assert.deepEqual(S.toAbs(x, y, 400, 800), [200, 400]);
});

test("eraser hit: near a segment hits, far misses, single point works", () => {
  const s = { w: 0.004, pts: [[0.1, 0.1, 0.5], [0.9, 0.1, 0.5]] };
  assert.equal(S.hit(s, 0.5, 0.1, 12, 500, 500), true);
  assert.equal(S.hit(s, 0.5, 0.2, 12, 500, 500), false);   // 50 px away
  assert.equal(S.hit(s, 0.5, 0.1 + 10 / 500, 12, 500, 500), true);   // 10 px away, radius 12
  assert.equal(S.hit(s, 0.95, 0.1, 12, 500, 500), false);   // past the end
  assert.equal(S.hit({ w: 0.004, pts: [[0.5, 0.5, 0.5]] }, 0.5, 0.5, 5, 100, 100), true);
  assert.equal(S.hit({ w: 0.004, pts: [] }, 0.5, 0.5, 5, 100, 100), false);
});

test("undo and redo: add, erase, redo cleared by a new op, empty stack", () => {
  const st = S.newStack();
  assert.equal(S.undo(st), null);
  S.push(st, { t: "add", id: "a" }); S.push(st, { t: "del", ids: ["a"] });
  let u = S.undo(st);   // undo the erase: stroke comes back
  assert.deepEqual([S.opIds(u.op), u.gone], [["a"], false]);
  u = S.undo(st);       // undo the add: stroke goes
  assert.deepEqual([S.opIds(u.op), u.gone], [["a"], true]);
  let r = S.redo(st);   // redo the add
  assert.equal(r.gone, false);
  S.push(st, { t: "add", id: "b" });
  assert.equal(st.r.length, 0);
  assert.equal(S.redo(st), null);
  assert.equal(st.u.length, 2);
});

test("stack is capped at 200 and survives a JSON round trip", () => {
  const st = S.newStack();
  for (let i = 0; i < 250; i++) S.push(st, { t: "add", id: "s" + i });
  assert.equal(st.u.length, 200);
  const back = S.newStack(JSON.parse(JSON.stringify(st)));
  assert.equal(S.undo(back).op.id, "s249");
});

test("pressure: pen value kept, 0 or other pointer types fall back to 0.5", () => {
  assert.equal(S.pressure({ pointerType: "pen", pressure: 0.8 }), 0.8);
  assert.equal(S.pressure({ pointerType: "pen", pressure: 0 }), 0.5);
  assert.equal(S.pressure({ pointerType: "touch", pressure: 1 }), 0.5);
  assert.equal(S.pressure({ pointerType: "mouse", pressure: 0.5 }), 0.5);
  assert.equal(S.pressure({}), 0.5);
});

test("page order: move up and down, ends stay put, input not mutated", () => {
  const a = [1, 2, 3];
  assert.deepEqual(S.moveItem(a, 1, -1), [2, 1, 3]);
  assert.deepEqual(S.moveItem(a, 1, 1), [1, 3, 2]);
  assert.deepEqual(S.moveItem(a, 0, -1), [1, 2, 3]);
  assert.deepEqual(S.moveItem(a, 2, 1), [1, 2, 3]);
  assert.deepEqual(a, [1, 2, 3]);
});

test("page backgrounds: blank empty, ruled rows, grid squares, Cornell margin and summary", () => {
  assert.equal(S.bgLines("blank", 1.414).length, 0);
  const ruled = S.bgLines("ruled", 1.414);
  assert.ok(ruled.length > 20 && ruled.every((l) => l[1] === l[3] && l[3] < 1.414 && l[0] === 0 && l[2] === 1));
  const grid = S.bgLines("grid", 2), cols = grid.filter((l) => l[0] === l[2]), rows = grid.filter((l) => l[1] === l[3]);
  assert.ok(cols.length === 19 && rows.length > 30 && cols.every((l) => l[3] === 2));
  const c = S.bgLines("cornell", 1.414);
  assert.ok(c.some((l) => l[0] === 0.3 && l[2] === 0.3) && c.some((l) => l[1] === 1.414 * 0.8 && l[3] === 1.414 * 0.8));
  assert.ok(c.every((l) => l[1] <= 1.414 * 0.8 + 1e-9));
});

test("snippet: case-insensitive, highlight split, ellipsis at cut ends, no match is null", () => {
  assert.deepEqual(S.snip("Page two body text", "TWO", 40), { pre: "Page ", hit: "two", post: " body text" });
  const long = "a".repeat(100) + "needle" + "b".repeat(100), r = S.snip(long, "needle", 10);
  assert.deepEqual([r.pre, r.hit, r.post], ["..." + "a".repeat(10), "needle", "b".repeat(10) + "..."]);
  assert.equal(S.snip("abc", "zz", 5), null);
  assert.equal(S.snip("abc", "", 5), null);
});

test("indexing label: shown until every page is done", () => {
  assert.equal(S.ixLabel(3, 20), "Indexing, 3 of 20 pages");
  assert.equal(S.ixLabel(0, 2), "Indexing, 0 of 2 pages");
  assert.equal(S.ixLabel(20, 20), "");
});

const req = createRequire(import.meta.url);
test("A7 page range: empty is the page on screen, typed ranges use Layer C's parser and cap", () => {
  const SR = req("../prep-source.js");
  assert.deepEqual(S.pageSel("", 7, 20, SR), { pages: [7] });
  assert.deepEqual(S.pageSel("  ", 3, 20, SR), { pages: [3] });
  assert.deepEqual(S.pageSel("3-5, 9", 1, 20, SR), { pages: [3, 4, 5, 9] });
  assert.match(S.pageSel("abc", 1, 20, SR).error, /Write pages like/);
  assert.match(S.pageSel("30", 1, 20, SR).error, /has 20 pages/);
  assert.match(S.pageSel("1-61", 1, 100, SR).error, /60 pages/);
});

test("A7 source ref: items and cards made from a Study Studio document carry std, others are unchanged", () => {
  const C = req("../prep-create.js");
  const it = { q: "Q?", o: ["a", "b", "c", "d"], a: 1, exp: "e", prov: "AI" }, f = { id: "f1", sec: "sec-0", p: [4], h: "H", sn: [2] };
  const withStd = C.toStored(it, f, "deck1", { doc: "abc", name: "N", std: "doc-id", exam: "neet-pg" });
  assert.deepEqual(withStd.src, { doc: "abc", name: "N", p: [4], h: "H", sn: [2], std: "doc-id" });
  assert.deepEqual(C.toStored(it, f, "deck1", { doc: "abc", name: "N", exam: "neet-pg" }).src, { doc: "abc", name: "N", p: [4], h: "H", sn: [2] });
  assert.equal(C.toCard({ id: "f1", cq: "c", ft: "t", p: [4], h: "H", sn: [2] }, "deck1", { doc: "abc", name: "N", std: "doc-id" }).src.std, "doc-id");
});
