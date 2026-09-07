/* test/wardsynq-drug-lookup.test.mjs — the brand -> composition lookup, and the four rules that make
 * a network dependency acceptable on a clinical path at all.
 *
 * The safety engine is deterministic, synchronous and offline, and must stay that way. This lookup
 * therefore lives in the ASYNC pre-check and only ever hands the engine a plain composition string.
 * What is asserted here is not that it works when the network works - that is the easy half - but
 * that every way it can FAIL degrades to "we could not check this", never to "nothing found".
 *
 * node --test test/wardsynq-drug-lookup.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { lookupComposition, queryTermFor, isTrustworthyMatch, _resetCache } from "../functions/_wardsynq/drug-lookup.js";

const ENV = {};
const ok = (results) => async () => ({ ok: true, json: async () => ({ results }) });
const AUGMENTIN = [{ brand: "Augmentin 625 Duo Tablet", composition: "Amoxycillin + Clavulanic Acid" }];

test("queryTermFor: a prescriber's line reduces to the brand the index is keyed on", () => {
  assert.equal(queryTermFor("Augmentin 625 Duo Tablet"), "augmentin");
  assert.equal(queryTermFor("Monocef 1g"), "monocef");
  assert.equal(queryTermFor("  ZOSYN 4.5g  "), "zosyn");
  // Nothing usable must produce no query at all rather than a wild one.
  assert.equal(queryTermFor(""), "");
  assert.equal(queryTermFor("   "), "");
  assert.equal(queryTermFor("500mg"), "");
  assert.equal(queryTermFor("ab"), "");
});

test("a hit returns the composition, and is cached so the same drug is not asked for twice", async () => {
  _resetCache();
  let calls = 0;
  const fetchImpl = async (...a) => { calls++; return ok(AUGMENTIN)(...a); };
  assert.equal(await lookupComposition("Augmentin 625", ENV, { fetchImpl }), "Amoxycillin + Clavulanic Acid");
  assert.equal(await lookupComposition("Augmentin 1.2gm Injection", ENV, { fetchImpl }), "Amoxycillin + Clavulanic Acid");
  assert.equal(calls, 1, "the second call is served from the per-isolate memo");
});

test("FAIL SAFE: every failure mode returns null so the drug stays unresolved, never silently clean", async () => {
  const cases = {
    "network error": async () => { throw new Error("ECONNREFUSED"); },
    "timeout": async () => { throw Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" }); },
    "rate limited": async () => ({ ok: false, status: 429, json: async () => ({}) }),
    "server error": async () => ({ ok: false, status: 500, json: async () => ({}) }),
    "bad JSON": async () => ({ ok: true, json: async () => { throw new SyntaxError("Unexpected token"); } }),
    "empty results": ok([]),
    "row without composition": ok([{ brand: "Augmentin 625", composition: null }]),
  };
  for (const [name, fetchImpl] of Object.entries(cases)) {
    _resetCache();
    const out = await lookupComposition("Augmentin 625", ENV, { fetchImpl });
    assert.equal(out, null, `${name} must return null, not throw and not guess`);
  }
});

test("it must not resolve the WRONG drug: a near match is refused", async () => {
  // A search index returns neighbours. Accepting one would put a different molecule's allergy
  // profile on this order, which is worse than no answer at all.
  assert.equal(isTrustworthyMatch("augmentin", { brand: "Augmentin 625 Duo" }), true);
  assert.equal(isTrustworthyMatch("augmentin", { brand: "Azithral 500" }), false);
  assert.equal(isTrustworthyMatch("augmentin", {}), false);
  assert.equal(isTrustworthyMatch("", { brand: "Anything" }), false);
  // The brand's first word must EQUAL the term. Found against live data: searching "Mox" (an
  // amoxicillin brand in India) returns "Moxifloxacin 400mg Tablet", which merely CONTAINS "mox".
  // Checking amoxicillin against a fluoroquinolone's profile would report no penicillin allergy.
  assert.equal(isTrustworthyMatch("mox", { brand: "Moxifloxacin 400mg Tablet" }), false, "a prefix is not a match");
  assert.equal(isTrustworthyMatch("mox", { brand: "Mox 500 Capsule" }), true);
  assert.equal(isTrustworthyMatch("taxim", { brand: "Taxim-O 200 Tablet" }), true, "the same separators split both sides");
  assert.equal(isTrustworthyMatch("pan", { brand: "Pantop 40" }), false);

  _resetCache();
  const wrong = await lookupComposition("Augpentin 625", ENV, { fetchImpl: ok([{ brand: "Augmentin 625 Duo", composition: "Amoxycillin + Clavulanic Acid" }]) });
  assert.equal(wrong, null, "a typo must not silently become a real drug");
});

test("it can be switched off entirely, and never fires without a usable name", async () => {
  _resetCache();
  let called = false;
  const fetchImpl = async (...a) => { called = true; return ok(AUGMENTIN)(...a); };
  assert.equal(await lookupComposition("Augmentin 625", { DRUG_API_BASE: "" }, { fetchImpl }), null);
  assert.equal(called, false, "DRUG_API_BASE='' makes no request at all");
  assert.equal(await lookupComposition("", ENV, { fetchImpl }), null);
  assert.equal(called, false);
});

test("the URL is the brand-search endpoint on the configured host, and carries a timeout", async () => {
  _resetCache();
  let seenUrl = null, seenInit = null;
  await lookupComposition("Augmentin 625", { DRUG_API_BASE: "https://example.test/" },
    { fetchImpl: async (u, i) => { seenUrl = u; seenInit = i; return { ok: true, json: async () => ({ results: AUGMENTIN }) }; } });
  assert.equal(seenUrl, "https://example.test/brand-search?q=augmentin&limit=3", "trailing slash trimmed, term lowercased");
  assert.ok(seenInit && seenInit.signal, "every request is abortable - it must never hang a prescription");
});
