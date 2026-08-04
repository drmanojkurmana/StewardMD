import { test } from "node:test";
import assert from "node:assert";
import EV from "../sknx-evidence.js";

test("retrieve(['psoriasis']) returns >=1 entry and every result is psoriasis-tagged", () => {
  const results = EV.retrieve(["psoriasis"]);
  assert.ok(results.length >= 1);
  for (const r of results) {
    const tagsLower = r.tags.map((t) => String(t).toLowerCase());
    assert.ok(tagsLower.includes("psoriasis"), "expected tags to include psoriasis, got " + JSON.stringify(r.tags));
  }
});

test("retrieve(['not-a-real-condition']) returns []", () => {
  assert.deepEqual(EV.retrieve(["not-a-real-condition"]), []);
});

test("retrieve([]) and retrieve() (unknown/empty labels) return []", () => {
  assert.deepEqual(EV.retrieve([]), []);
  assert.deepEqual(EV.retrieve(), []);
});

test("citation integrity: every corpus entry has a non-empty source and url", () => {
  assert.ok(EV.CORPUS.length >= 14 && EV.CORPUS.length <= 20, "expected ~14-20 seeded entries, got " + EV.CORPUS.length);
  const validSources = ["AAD", "BAD", "NICE", "WHO", "DermNet"];
  for (const entry of EV.CORPUS) {
    assert.ok(entry.source && String(entry.source).trim().length > 0, "entry " + entry.id + " missing source");
    assert.ok(validSources.indexOf(entry.source) !== -1, "entry " + entry.id + " has unrecognized source " + entry.source);
    assert.ok(entry.url && String(entry.url).trim().length > 0, "entry " + entry.id + " missing url");
    assert.match(entry.url, /^https:\/\//, "entry " + entry.id + " url should be a plausible https link");
    assert.ok(entry.id && entry.title && entry.snippet, "entry " + entry.id + " missing id/title/snippet");
    assert.ok(Array.isArray(entry.tags) && entry.tags.length > 0, "entry " + entry.id + " missing tags");
  }
});

test("ranking: an entry matching two query labels ranks before one matching only one", () => {
  // Find an id known to carry two overlapping tags with a two-label query, and confirm
  // it precedes every result that only matches one of the labels.
  const results = EV.retrieve(["eczema", "contact dermatitis"], { limit: 20 });
  assert.ok(results.length >= 2);
  const overlapCount = (tags) => {
    const lower = tags.map((t) => String(t).toLowerCase());
    var n = 0;
    if (lower.indexOf("eczema") !== -1) n++;
    if (lower.indexOf("contact dermatitis") !== -1) n++;
    return n;
  };
  for (var i = 0; i < results.length - 1; i++) {
    assert.ok(overlapCount(results[i].tags) >= overlapCount(results[i + 1].tags),
      "expected non-increasing overlap count ordering at index " + i);
  }
  // there must be at least one double-overlap entry ranked ahead of a single-overlap entry
  const hasDouble = results.some((r) => overlapCount(r.tags) === 2);
  const hasSingle = results.some((r) => overlapCount(r.tags) === 1);
  assert.ok(hasDouble && hasSingle, "test fixture should exercise both overlap counts");
  assert.equal(overlapCount(results[0].tags), 2, "the double-overlap entry should rank first");
});

test("retrieve is case-insensitive on labels", () => {
  const lower = EV.retrieve(["psoriasis"]);
  const upper = EV.retrieve(["PSORIASIS"]);
  assert.deepEqual(upper.map((r) => r.id), lower.map((r) => r.id));
});

test("opts.limit caps the number of results (default ~6)", () => {
  const many = EV.retrieve(["psoriasis", "eczema", "acne", "tinea", "urticaria", "impetigo"], { limit: 3 });
  assert.ok(many.length <= 3);
});

test("stable order for ties: repeated calls return the same order", () => {
  const a = EV.retrieve(["psoriasis", "eczema"]).map((r) => r.id);
  const b = EV.retrieve(["psoriasis", "eczema"]).map((r) => r.id);
  assert.deepEqual(a, b);
});

test("dual export shape matches other sknx-*.js modules", () => {
  assert.equal(typeof EV.retrieve, "function");
  assert.ok(Array.isArray(EV.CORPUS));
});
