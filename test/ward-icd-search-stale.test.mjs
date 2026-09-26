/* test/ward-icd-search-stale.test.mjs — UI-04 from the frontend audit (audit-E.md E4).
 *
 * Same load() pattern as test/ward-ui.test.mjs: a real ward.js run through `new Function`, with
 * global.fetch stubbed so two overlapping ICD searches can be made to answer OUT OF ORDER on purpose -
 * the exact race the audit described (type "asth", pause long enough for that search to fire, then
 * type on to "asthma exacerbation" while the first is still in flight; the broader search's answer
 * arrives last).
 *
 * node --test test/ward-icd-search-stale.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../ward.js", import.meta.url), "utf8");

function makeDoc() {
  const els = new Map();
  return {
    getElementById: (id) => els.get(id) || null,
    createElement: () => ({ classList: { add() {}, remove() {} } }),
    body: { appendChild() {} },
    querySelector: () => null,
    _set: (id, el) => { els.set(id, el); return els.get(id); },
  };
}
function load(doc) {
  const win = {};
  new Function("window", "document", "location", "localStorage", SRC)(win, doc, { search: "" }, { getItem: () => null, setItem: () => {} });
  return win.WARD;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("UI-04: a slow, broader search answering after a faster, narrower one does not overwrite it", async () => {
  const doc = makeDoc();
  const candidates = doc._set("wIcdCandidates", { innerHTML: "" });
  const W = load(doc);

  // "asth" (broad) fires first but is deliberately slow; "asthma exacerbation" (narrow, typed after a
  // pause) fires later but is fast - so its answer arrives well BEFORE the broad, stale one, which is
  // exactly the out-of-order case the audit described.
  global.fetch = (url) => {
    const u = String(url);
    if (u.indexOf("q=asth") >= 0 && u.indexOf("exacerbation") < 0) {
      return sleep(500).then(() => ({ json: async () => ({ results: [{ code: "J45", title: "Asthma, broad", system: "icd10" }] }) }));
    }
    return sleep(10).then(() => ({ json: async () => ({ results: [{ code: "J45.901", title: "Asthma exacerbation", system: "icd10" }] }) }));
  };
  try {
    W._onInput({ target: { id: "wProbText", value: "asth" } });
    await sleep(320); // past the 300ms debounce: the slow, broad search's fetch is now in flight
    W._onInput({ target: { id: "wProbText", value: "asthma exacerbation" } });
    await sleep(320); // past the second debounce: the fast, narrow search's fetch starts too

    await sleep(400); // the narrow answer lands quickly, then the slow broad (stale) one lands after it

    assert.equal(W._st.icd.length, 1);
    assert.equal(W._st.icd[0].code, "J45.901", "the newer, narrower result is what st.icd holds");
    assert.match(candidates.innerHTML, /J45\.901/, "and it is what is offered on screen");
    assert.doesNotMatch(candidates.innerHTML, /Asthma, broad/, "the stale, broader result never overwrites it");
  } finally { delete global.fetch; }
});

test("UI-04: clearing the box invalidates whatever search is still in flight", async () => {
  const doc = makeDoc();
  const candidates = doc._set("wIcdCandidates", { innerHTML: "" });
  const W = load(doc);

  global.fetch = () => sleep(80).then(() => ({ json: async () => ({ results: [{ code: "X1", title: "Something", system: "icd10" }] }) }));
  try {
    W._onInput({ target: { id: "wProbText", value: "asth" } });
    await sleep(320); // the search fires and is now in flight
    W._onInput({ target: { id: "wProbText", value: "a" } }); // backspaced to under 2 characters
    await sleep(150); // the in-flight fetch answers after the field was cleared

    assert.equal(W._st.icd, undefined, "a cleared search stays cleared");
    assert.equal(candidates.innerHTML, "", "no stale result is painted after the box was cleared");
  } finally { delete global.fetch; }
});
