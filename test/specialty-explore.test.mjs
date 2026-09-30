// Specialty engine Explore (host part): the explorer registry and "explored" progress. The explorer models
// (for Ophthalmós the visual-field and focus models) stay with each specialty and carry their own tests.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const X = createRequire(import.meta.url)("../specialty-explore.js");

test("validateExplorer: id, bilingual title and line, an open function", () => {
  const ok = { id: "cycle", title: { en: "Menstrual cycle", hi: "मासिक चक्र" }, line: { en: "Move through the days", hi: "दिन बदलें" }, open: function () {} };
  assert.deepEqual(X.validateExplorer(ok), []);
  const e = X.validateExplorer({ id: "Bad Id", title: { hi: "x" } }).join("\n");
  for (const m of [/id: lowercase/, /title: needs \{en, hi\}/, /line: needs \{en, hi\}/, /open: a function/]) assert.match(e, m);
});

test("mark records the first day only; explored counts registered explorers seen", () => {
  const store = {};
  assert.equal(X.mark(store, "cycle", 10), true);
  assert.equal(X.mark(store, "cycle", 11), false);
  assert.deepEqual(store.explore, { cycle: 10 });
  assert.equal(X.explored(store, [{ id: "cycle" }, { id: "popq" }]), 1);
  assert.equal(X.explored({}, [{ id: "cycle" }]), 0);
});
