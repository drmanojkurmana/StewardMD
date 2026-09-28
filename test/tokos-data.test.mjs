// test/tokos-data.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const D = createRequire(import.meta.url)("../tokos-data.js");

test("trialState: open when Pro, trial when unused, used when spent", () => {
  const store = { trials: {} };
  assert.equal(D.trialState(store, "clinic.ctg", true), "open");
  assert.equal(D.trialState(store, "clinic.ctg", false), "trial");
  D.useTrial(store, "clinic.ctg", 100);
  assert.equal(D.trialState(store, "clinic.ctg", false), "used");
});

test("useTrial only records the first use", () => {
  const store = { trials: {} };
  assert.equal(D.useTrial(store, "x", 1), true);
  assert.equal(D.useTrial(store, "x", 2), false);
  assert.equal(store.trials.x, 1);
});

test("levelLocked: resident locked unless free-listed or Pro", () => {
  const cfg = { access: { freeLevels: ["mbbs"] } };
  assert.equal(D.levelLocked(cfg, "resident", false), true);
  assert.equal(D.levelLocked(cfg, "resident", true), false);
  assert.equal(D.levelLocked(cfg, "mbbs", false), false);
});

test("loadStore returns a fresh store shape when localStorage is empty or corrupt", () => {
  const fakeLs = { getItem: () => null, setItem: () => {} };
  const s = D.loadStore(fakeLs);
  assert.deepEqual(s.cards, {});
  assert.deepEqual(s.trials, {});
});

test("loadPrefs defaults to mbbs level, English, and no tab until first-run choice", () => {
  const fakeLs = { getItem: () => null };
  const p = D.loadPrefs(fakeLs);
  assert.equal(p.level, "mbbs");
  assert.equal(p.lang, "en");
  assert.equal(p.tab, undefined);
});

test("today() computes a stable local day number", () => {
  const d1 = D.today(Date.UTC(2026, 8, 29, 6, 0));
  const d2 = D.today(Date.UTC(2026, 8, 29, 6, 0) + 3600000);
  assert.equal(d1, d2);
});
