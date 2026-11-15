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
